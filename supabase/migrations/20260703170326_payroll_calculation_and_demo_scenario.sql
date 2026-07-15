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

grant select on table
  public.payroll_periods,
  public.payroll_entries,
  public.payroll_adjustments,
  public.expiration_writeoffs,
  public.payroll_product_writeoffs,
  public.inventory_periods,
  public.inventory_loss_allocations,
  public.employee_advances,
  public.sales_metrics
to authenticated;

grant insert, update on table
  public.payroll_periods,
  public.payroll_entries
to authenticated;
