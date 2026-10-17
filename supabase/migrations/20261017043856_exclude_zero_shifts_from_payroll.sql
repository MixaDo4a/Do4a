-- A closed shift with no sales, returns, receipts or goods remains in the shift archive
-- but does not earn a shift-based salary.
create or replace function public.calculate_employee_payroll_period(
  p_employee_id uuid,
  p_period_month date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start date;
  v_period_end date;
  v_period_id uuid;
  v_employee public.employees%rowtype;
  v_shift_count numeric(12,2);
  v_gross_revenue numeric(20,2);
  v_sales_pay numeric(20,2);
  v_plan_bonus numeric(20,2);
  v_checklist_per_shift numeric(20,2);
  v_base_salary numeric(20,2);
  v_manual_bonus numeric(20,2);
  v_advances numeric(20,2);
  v_expiration numeric(20,2);
  v_inventory numeric(20,2);
  v_products numeric(20,2);
  v_total numeric(20,2);
begin
  if not (
    p_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('developer')
    or app_private.current_warehouse_can_deduct_employee(p_employee_id)
    or exists (
      select 1
      from public.employee_advances ea
      join public.shifts sh on sh.id = ea.shift_id
      where ea.employee_id = p_employee_id
        and ea.period_month = date_trunc('month', p_period_month)::date
        and ea.source = 'shift_closing'
        and ea.created_by = (select auth.uid())
        and (
          sh.closed_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
        )
    )
  ) then
    raise exception 'Not allowed to calculate this employee payroll';
  end if;

  v_period_start := date_trunc('month', p_period_month)::date;
  v_period_end := (v_period_start + interval '1 month - 1 day')::date;

  select *
  into v_employee
  from public.employees
  where id = p_employee_id
    and is_active = true;

  if not found then
    raise exception 'Employee not found or inactive';
  end if;

  insert into public.payroll_periods (period_month, status, calculated_at)
  values (v_period_start, 'calculated', now())
  on conflict (period_month) do update
  set
    status = 'calculated',
    calculated_at = now(),
    updated_at = now()
  returning id into v_period_id;

  select
    coalesce(count(distinct sm.shift_id) filter (
      where sm.gross_revenue > 0
        or sm.receipt_count > 0
        or coalesce(sm.items_sold_count, 0) > 0
        or exists (
          select 1
          from public.shift_closing_reports report
          where report.shift_id = sm.shift_id
            and (report.cash_returns > 0 or report.card_returns > 0)
        )
    ), 0),
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
      'employee_id', v_employee.id,
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

  return v_period_id;
end;
$$;

revoke all on function public.calculate_employee_payroll_period(uuid, date) from public;
grant execute on function public.calculate_employee_payroll_period(uuid, date) to authenticated;

-- Reconcile only the current, still-calculated payroll period. Older paid periods stay untouched.
with affected as (
  select distinct sm.employee_id
  from public.sales_metrics sm
  join public.shift_closing_reports report on report.shift_id = sm.shift_id
  where sm.period_month = date_trunc('month', current_date)::date
    and report.cash_revenue = 0
    and report.card_revenue = 0
    and report.cash_returns = 0
    and report.card_returns = 0
    and report.receipt_count = 0
    and coalesce(report.items_sold_count, 0) = 0
),
credited as (
  select
    entry.id,
    count(distinct metric.shift_id) filter (
      where metric.gross_revenue > 0
        or metric.receipt_count > 0
        or coalesce(metric.items_sold_count, 0) > 0
        or exists (
          select 1
          from public.shift_closing_reports report
          where report.shift_id = metric.shift_id
            and (report.cash_returns > 0 or report.card_returns > 0)
        )
    ) as shift_count
  from public.payroll_entries entry
  join public.payroll_periods period on period.id = entry.payroll_period_id
  join affected on affected.employee_id = entry.employee_id
  left join public.sales_metrics metric
    on metric.employee_id = entry.employee_id
    and metric.period_month = period.period_month
  where period.period_month = date_trunc('month', current_date)::date
    and period.status = 'calculated'
  group by entry.id
)
update public.payroll_entries entry
set
  shift_count = credited.shift_count,
  base_salary_amount = round(credited.shift_count * entry.checklist_salary_per_shift, 2),
  total_payout_amount = public.calculate_payroll_total(
    entry.sales_pay_amount,
    entry.plan_bonus_amount,
    round(credited.shift_count * entry.checklist_salary_per_shift, 2),
    entry.manual_bonus_amount,
    entry.advance_amount,
    entry.expiration_writeoff_amount,
    entry.inventory_loss_amount,
    entry.product_writeoff_amount
  ),
  calculation_snapshot = entry.calculation_snapshot || jsonb_build_object('zero_shift_recalculated_at', now()),
  updated_at = now()
from credited
where entry.id = credited.id
  and entry.shift_count is distinct from credited.shift_count;
