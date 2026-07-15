-- Widen money columns so unusually large but valid reports do not overflow.
-- UI/server validation still keeps accidental nonsense values out before RPC.

alter table public.store_sales_plans
  alter column sales_plan_amount type numeric(20,2);

alter table public.shift_closing_reports
  alter column cash_revenue type numeric(20,2),
  alter column card_revenue type numeric(20,2),
  alter column cash_returns type numeric(20,2),
  alter column card_returns type numeric(20,2),
  alter column gross_revenue type numeric(20,2),
  alter column net_revenue type numeric(20,2),
  alter column cash_collection_amount type numeric(20,2),
  alter column advance_amount type numeric(20,2);

alter table public.shift_cash_counts
  alter column line_amount type numeric(20,2);

alter table public.checklist_item_weights
  alter column weight_amount type numeric(20,2);

alter table public.checklist_submissions
  alter column salary_per_shift_amount type numeric(20,2);

alter table public.checklist_submission_items
  alter column weight_amount_snapshot type numeric(20,2),
  alter column result_amount type numeric(20,2);

alter table public.expiration_writeoffs
  alter column amount type numeric(20,2);

alter table public.payroll_product_writeoffs
  alter column amount type numeric(20,2);

alter table public.employee_advances
  alter column amount type numeric(20,2);

alter table public.inventory_periods
  alter column turnover_amount type numeric(20,2),
  alter column loss_amount type numeric(20,2),
  alter column company_compensation_amount type numeric(20,2),
  alter column amount_after_compensation type numeric(20,2),
  alter column distributable_amount type numeric(20,2);

alter table public.inventory_loss_allocations
  alter column amount type numeric(20,2);

alter table public.sales_metrics
  alter column gross_revenue type numeric(20,2),
  alter column average_check_amount type numeric(20,2),
  alter column sales_pay_amount type numeric(20,2);

alter table public.payroll_entries
  alter column gross_revenue type numeric(20,2),
  alter column sales_pay_amount type numeric(20,2),
  alter column plan_bonus_amount type numeric(20,2),
  alter column checklist_salary_per_shift type numeric(20,2),
  alter column base_salary_amount type numeric(20,2),
  alter column manual_bonus_amount type numeric(20,2),
  alter column advance_amount type numeric(20,2),
  alter column expiration_writeoff_amount type numeric(20,2),
  alter column inventory_loss_amount type numeric(20,2),
  alter column product_writeoff_amount type numeric(20,2),
  alter column total_payout_amount type numeric(20,2);

alter table public.payroll_adjustments
  alter column amount type numeric(20,2);

create or replace function public.close_shift(
  p_shift_id uuid,
  p_cash_revenue numeric,
  p_card_revenue numeric,
  p_cash_returns numeric,
  p_card_returns numeric,
  p_receipt_count integer,
  p_items_sold_count integer,
  p_cash_collection_amount numeric default null,
  p_cash_collection_comment text default null,
  p_advance_amount numeric default null,
  p_cash_counts jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
  v_report_id uuid;
  v_employee_id uuid;
  v_gross_revenue numeric(14,2);
  v_net_revenue numeric(14,2);
  v_check_depth numeric(10,2);
  v_cash_count jsonb;
  v_denomination public.cash_denominations%rowtype;
  v_line_amount numeric(14,2);
begin
  v_employee_id := app_private.current_user_employee_id();

  select *
  into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found then
    raise exception 'Shift not found';
  end if;

  if v_shift.status not in ('opened', 'correction_required') then
    raise exception 'Shift cannot be closed from status %', v_shift.status;
  end if;

  if not (
    v_shift.opened_by_employee_id = v_employee_id
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Only primary seller, super admin, or developer can close shift';
  end if;

  if coalesce(p_cash_revenue, 0) < 0
    or coalesce(p_card_revenue, 0) < 0
    or coalesce(p_cash_returns, 0) < 0
    or coalesce(p_card_returns, 0) < 0
    or coalesce(p_receipt_count, 0) < 0
    or coalesce(p_items_sold_count, 0) < 0
    or coalesce(p_cash_collection_amount, 0) < 0
    or coalesce(p_advance_amount, 0) < 0
  then
    raise exception 'Cash report values cannot be negative';
  end if;

  if coalesce(p_cash_collection_amount, 0) > 0
    and nullif(btrim(coalesce(p_cash_collection_comment, '')), '') is null
  then
    raise exception 'Cash collection comment is required';
  end if;

  v_gross_revenue := round(coalesce(p_cash_revenue, 0) + coalesce(p_card_revenue, 0), 2);
  v_net_revenue := round(v_gross_revenue - coalesce(p_cash_returns, 0) - coalesce(p_card_returns, 0), 2);
  v_check_depth := public.calculate_check_depth(p_items_sold_count, p_receipt_count);

  insert into public.shift_closing_reports (
    shift_id,
    cash_revenue,
    card_revenue,
    cash_returns,
    card_returns,
    receipt_count,
    items_sold_count,
    gross_revenue,
    net_revenue,
    cash_collection_amount,
    cash_collection_comment,
    check_depth,
    advance_amount,
    created_by_employee_id,
    created_by,
    updated_by
  )
  values (
    p_shift_id,
    coalesce(p_cash_revenue, 0),
    coalesce(p_card_revenue, 0),
    coalesce(p_cash_returns, 0),
    coalesce(p_card_returns, 0),
    coalesce(p_receipt_count, 0),
    p_items_sold_count,
    v_gross_revenue,
    v_net_revenue,
    p_cash_collection_amount,
    p_cash_collection_comment,
    v_check_depth,
    p_advance_amount,
    v_shift.opened_by_employee_id,
    (select auth.uid()),
    (select auth.uid())
  )
  on conflict (shift_id) do update
  set
    cash_revenue = excluded.cash_revenue,
    card_revenue = excluded.card_revenue,
    cash_returns = excluded.cash_returns,
    card_returns = excluded.card_returns,
    receipt_count = excluded.receipt_count,
    items_sold_count = excluded.items_sold_count,
    gross_revenue = excluded.gross_revenue,
    net_revenue = excluded.net_revenue,
    cash_collection_amount = excluded.cash_collection_amount,
    cash_collection_comment = excluded.cash_collection_comment,
    check_depth = excluded.check_depth,
    advance_amount = excluded.advance_amount,
    updated_by = (select auth.uid()),
    updated_at = now()
  returning id into v_report_id;

  delete from public.shift_cash_counts
  where shift_closing_report_id = v_report_id;

  for v_cash_count in
    select value
    from jsonb_array_elements(coalesce(p_cash_counts, '[]'::jsonb))
  loop
    select *
    into v_denomination
    from public.cash_denominations
    where id = (v_cash_count->>'denomination_id')::uuid
      and is_active = true;

    if not found then
      raise exception 'Cash denomination not found or inactive';
    end if;

    v_line_amount := round(v_denomination.value * greatest(coalesce((v_cash_count->>'quantity')::integer, 0), 0), 2);

    insert into public.shift_cash_counts (
      shift_closing_report_id,
      denomination_id,
      quantity,
      line_amount
    )
    values (
      v_report_id,
      v_denomination.id,
      greatest(coalesce((v_cash_count->>'quantity')::integer, 0), 0),
      v_line_amount
    );
  end loop;

  if coalesce(p_advance_amount, 0) > 0 then
    insert into public.employee_advances (
      employee_id,
      shift_id,
      period_month,
      amount,
      source,
      created_by,
      updated_by
    )
    values (
      v_shift.opened_by_employee_id,
      p_shift_id,
      date_trunc('month', v_shift.shift_date)::date,
      p_advance_amount,
      'shift_closing',
      (select auth.uid()),
      (select auth.uid())
    );
  end if;

  update public.shifts
  set
    status = 'closed',
    closed_by_employee_id = v_shift.opened_by_employee_id,
    closed_at = now(),
    requires_review = false,
    review_reason = null,
    updated_by = (select auth.uid())
  where id = p_shift_id;

  insert into public.shift_snapshots (
    shift_id,
    snapshot_version,
    data,
    data_quality
  )
  values (
    p_shift_id,
    1,
    public.calculate_shift_snapshot_data(p_shift_id),
    'complete'
  );

  insert into public.sales_metrics (
    shift_id,
    employee_id,
    store_id,
    period_month,
    gross_revenue,
    receipt_count,
    items_sold_count,
    average_check_amount,
    check_depth,
    sales_percent,
    sales_pay_amount
  )
  select
    p_shift_id,
    sp.employee_id,
    v_shift.store_id,
    date_trunc('month', v_shift.shift_date)::date,
    v_gross_revenue,
    coalesce(p_receipt_count, 0),
    p_items_sold_count,
    public.calculate_average_check_amount(v_gross_revenue, p_receipt_count),
    v_check_depth,
    sp.sales_percent,
    public.calculate_shift_sales_pay(v_gross_revenue, sp.participant_role)
  from public.shift_participants sp
  where sp.shift_id = p_shift_id
  on conflict (shift_id, employee_id) do update
  set
    gross_revenue = excluded.gross_revenue,
    receipt_count = excluded.receipt_count,
    items_sold_count = excluded.items_sold_count,
    average_check_amount = excluded.average_check_amount,
    check_depth = excluded.check_depth,
    sales_percent = excluded.sales_percent,
    sales_pay_amount = excluded.sales_pay_amount,
    updated_at = now();

  perform public.log_audit_event(
    'shift.closed',
    'shift',
    p_shift_id,
    to_jsonb(v_shift),
    public.calculate_shift_snapshot_data(p_shift_id),
    'Shift closed by primary seller, super admin, or developer'
  );

  return p_shift_id;
end;
$$;

create or replace function public.calculate_payroll_period(p_period_month date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_period_start date;
  v_period_end date;
  v_period_id uuid;
  v_employee public.employees%rowtype;
  v_shift_count numeric(8,2);
  v_gross_revenue numeric(14,2);
  v_sales_pay numeric(14,2);
  v_plan_bonus numeric(14,2);
  v_checklist_per_shift numeric(14,2);
  v_base_salary numeric(14,2);
  v_manual_bonus numeric(14,2);
  v_advances numeric(14,2);
  v_expiration numeric(14,2);
  v_inventory numeric(14,2);
  v_products numeric(14,2);
  v_total numeric(14,2);
begin
  if not (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Only manager, super admin, or developer can calculate payroll';
  end if;

  v_period_start := date_trunc('month', p_period_month)::date;
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;

  insert into public.payroll_periods (period_month, status, calculated_at)
  values (v_period_start, 'calculated', now())
  on conflict (period_month) do update
  set
    status = 'calculated',
    calculated_at = now(),
    updated_at = now()
  returning id into v_period_id;

  for v_employee in
    select *
    from public.employees
    where is_active = true
  loop
    select
      coalesce(count(distinct sm.shift_id), 0),
      coalesce(sum(sm.gross_revenue), 0),
      coalesce(sum(sm.sales_pay_amount), 0)
    into v_shift_count, v_gross_revenue, v_sales_pay
    from public.sales_metrics sm
    where sm.employee_id = v_employee.id
      and sm.period_month = v_period_start;

    select coalesce(sum(employee_store_revenue * 0.01), 0)
    into v_plan_bonus
    from (
      select
        sm.store_id,
        sum(sm.gross_revenue) as employee_store_revenue
      from public.sales_metrics sm
      where sm.employee_id = v_employee.id
        and sm.period_month = v_period_start
      group by sm.store_id
    ) employee_sales
    where exists (
      select 1
      from public.store_sales_plans plan
      where plan.store_id = employee_sales.store_id
        and plan.period_start = v_period_start
        and plan.period_end = v_period_end
        and (
          select coalesce(sum(sm2.gross_revenue), 0)
          from public.sales_metrics sm2
          where sm2.store_id = employee_sales.store_id
            and sm2.period_month = v_period_start
        ) >= plan.sales_plan_amount
    );

    select coalesce(avg(cs.salary_per_shift_amount), null)
    into v_checklist_per_shift
    from public.checklist_submissions cs
    where cs.employee_id = v_employee.id
      and cs.period_month = v_period_start;

    if v_checklist_per_shift is null then
      select coalesce(sum(ciw.weight_amount), 0)
      into v_checklist_per_shift
      from public.checklist_templates ct
      join public.checklist_items ci on ci.template_id = ct.id and ci.is_active = true
      join public.checklist_item_weights ciw on ciw.item_id = ci.id
      where ct.is_active = true
        and ciw.employee_status = v_employee.employee_status;
    end if;

    v_checklist_per_shift := round(coalesce(v_checklist_per_shift, 0), 2);
    v_base_salary := round(v_shift_count * v_checklist_per_shift, 2);

    select coalesce(sum(
      case
        when adjustment_type = 'bonus' then amount
        when adjustment_type in ('fine', 'inventory', 'expiration', 'product') then -abs(amount)
        else 0
      end
    ), 0)
    into v_manual_bonus
    from public.payroll_adjustments
    where employee_id = v_employee.id
      and period_month = v_period_start;

    select coalesce(sum(amount), 0)
    into v_advances
    from public.employee_advances
    where employee_id = v_employee.id
      and period_month = v_period_start;

    select coalesce(sum(store_amount / nullif(primary_count, 0)), 0)
    into v_expiration
    from (
      select
        ew.store_id,
        ew.amount as store_amount,
        (
          select count(*)
          from public.employee_store_assignments esa
          join public.employees e on e.id = esa.employee_id
          where esa.store_id = ew.store_id
            and esa.is_primary = true
            and e.is_active = true
            and esa.valid_from <= v_period_end
            and (esa.valid_to is null or esa.valid_to >= v_period_start)
        ) as primary_count
      from public.expiration_writeoffs ew
      where ew.period_month = v_period_start
        and exists (
          select 1
          from public.employee_store_assignments esa
          where esa.employee_id = v_employee.id
            and esa.store_id = ew.store_id
            and esa.is_primary = true
            and esa.valid_from <= v_period_end
            and (esa.valid_to is null or esa.valid_to >= v_period_start)
        )
    ) expiration_share;

    select coalesce(sum(ila.amount), 0)
    into v_inventory
    from public.inventory_loss_allocations ila
    join public.inventory_periods ip on ip.id = ila.inventory_period_id
    where ila.employee_id = v_employee.id
      and ip.period_start <= v_period_end
      and ip.period_end >= v_period_start;

    select coalesce(sum(amount), 0)
    into v_products
    from public.payroll_product_writeoffs
    where employee_id = v_employee.id
      and period_month = v_period_start;

    v_total := public.calculate_payroll_total(
      v_sales_pay,
      v_plan_bonus,
      v_base_salary,
      v_manual_bonus,
      v_advances,
      v_expiration,
      v_inventory,
      v_products
    );

    insert into public.payroll_entries (
      payroll_period_id,
      employee_id,
      shift_count,
      gross_revenue,
      sales_pay_amount,
      plan_bonus_amount,
      checklist_salary_per_shift,
      base_salary_amount,
      manual_bonus_amount,
      advance_amount,
      expiration_writeoff_amount,
      inventory_loss_amount,
      product_writeoff_amount,
      total_payout_amount,
      calculation_snapshot
    )
    values (
      v_period_id,
      v_employee.id,
      v_shift_count,
      v_gross_revenue,
      v_sales_pay,
      v_plan_bonus,
      v_checklist_per_shift,
      v_base_salary,
      v_manual_bonus,
      v_advances,
      v_expiration,
      v_inventory,
      v_products,
      v_total,
      jsonb_build_object(
        'period_month', v_period_start,
        'formula', 'sales + plan + base + bonus - advance - expiration - inventory - products',
        'calculated_at', now()
      )
    )
    on conflict (payroll_period_id, employee_id) do update
    set
      shift_count = excluded.shift_count,
      gross_revenue = excluded.gross_revenue,
      sales_pay_amount = excluded.sales_pay_amount,
      plan_bonus_amount = excluded.plan_bonus_amount,
      checklist_salary_per_shift = excluded.checklist_salary_per_shift,
      base_salary_amount = excluded.base_salary_amount,
      manual_bonus_amount = excluded.manual_bonus_amount,
      advance_amount = excluded.advance_amount,
      expiration_writeoff_amount = excluded.expiration_writeoff_amount,
      inventory_loss_amount = excluded.inventory_loss_amount,
      product_writeoff_amount = excluded.product_writeoff_amount,
      total_payout_amount = excluded.total_payout_amount,
      calculation_snapshot = excluded.calculation_snapshot,
      updated_at = now();
  end loop;

  return v_period_id;
end;
$$;

grant execute on function public.calculate_payroll_period(date) to authenticated;
