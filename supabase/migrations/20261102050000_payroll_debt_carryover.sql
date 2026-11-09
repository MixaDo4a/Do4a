alter table public.payroll_entries
  add column if not exists carryover_debt_amount numeric(12,2) not null default 0;

create or replace function app_private.snapshot_payroll_entry_before_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if row(
    old.shift_count, old.gross_revenue, old.sales_pay_amount, old.plan_bonus_amount,
    old.checklist_salary_per_shift, old.base_salary_amount, old.manual_bonus_amount,
    old.advance_amount, old.expiration_writeoff_amount, old.inventory_loss_amount,
    old.product_writeoff_amount, old.carryover_debt_amount, old.total_payout_amount,
    old.calculation_snapshot
  ) is distinct from row(
    new.shift_count, new.gross_revenue, new.sales_pay_amount, new.plan_bonus_amount,
    new.checklist_salary_per_shift, new.base_salary_amount, new.manual_bonus_amount,
    new.advance_amount, new.expiration_writeoff_amount, new.inventory_loss_amount,
    new.product_writeoff_amount, new.carryover_debt_amount, new.total_payout_amount,
    new.calculation_snapshot
  ) then
    insert into public.payroll_snapshots (payroll_period_id, employee_id, data)
    values (
      old.payroll_period_id,
      old.employee_id,
      to_jsonb(old) || jsonb_build_object('snapshot_reason', 'payroll_entry_recalculated')
    );
  end if;
  return new;
end;
$$;

with previous_results as (
  select distinct on (entry.employee_id)
    entry.employee_id,
    greatest(-entry.total_payout_amount, 0)::numeric(20,2) as debt_amount
  from public.payroll_entries entry
  join public.payroll_periods period on period.id = entry.payroll_period_id
  where period.period_month < date '2026-11-01'
  order by entry.employee_id, period.period_month desc
)
update public.payroll_entries current_entry
set carryover_debt_amount = previous_results.debt_amount,
    total_payout_amount = current_entry.total_payout_amount - previous_results.debt_amount,
    calculation_snapshot = coalesce(current_entry.calculation_snapshot, '{}'::jsonb)
      || jsonb_build_object('carryover_debt_amount', previous_results.debt_amount),
    updated_at = now()
from public.payroll_periods current_period
join previous_results on true
where current_entry.payroll_period_id = current_period.id
  and current_period.period_month = date '2026-11-01'
  and current_period.status <> 'closed'
  and current_entry.employee_id = previous_results.employee_id
  and previous_results.debt_amount > 0;

alter function public.calculate_employee_payroll_period(uuid, date)
  rename to calculate_employee_payroll_period_pre_debt_carryover;
revoke all on function public.calculate_employee_payroll_period_pre_debt_carryover(uuid, date)
  from public, anon, authenticated;

create function public.calculate_employee_payroll_period(
  p_employee_id uuid,
  p_period_month date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_start date := date_trunc('month', p_period_month)::date;
  v_period_id uuid;
  v_carryover numeric(20,2) := 0;
begin
  v_period_id := public.calculate_employee_payroll_period_pre_debt_carryover(p_employee_id, p_period_month);
  if v_period_start < date '2026-11-01' then
    return v_period_id;
  end if;

  select greatest(-entry.total_payout_amount, 0)
  into v_carryover
  from public.payroll_entries entry
  join public.payroll_periods period on period.id = entry.payroll_period_id
  where entry.employee_id = p_employee_id
    and period.period_month < v_period_start
  order by period.period_month desc
  limit 1;
  v_carryover := coalesce(v_carryover, 0);

  update public.payroll_entries entry
  set carryover_debt_amount = v_carryover,
      total_payout_amount = public.calculate_payroll_total(
        entry.sales_pay_amount,
        entry.plan_bonus_amount,
        entry.base_salary_amount,
        entry.manual_bonus_amount,
        entry.advance_amount,
        entry.expiration_writeoff_amount,
        entry.inventory_loss_amount,
        entry.product_writeoff_amount
      ) - v_carryover,
      calculation_snapshot = coalesce(entry.calculation_snapshot, '{}'::jsonb)
        || jsonb_build_object(
          'carryover_debt_amount', v_carryover,
          'carryover_debt_from_period', (
            select period.period_month
            from public.payroll_entries previous_entry
            join public.payroll_periods period on period.id = previous_entry.payroll_period_id
            where previous_entry.employee_id = p_employee_id
              and period.period_month < v_period_start
            order by period.period_month desc
            limit 1
          )
        ),
      updated_at = now()
  where entry.employee_id = p_employee_id
    and entry.payroll_period_id = v_period_id;

  return v_period_id;
end;
$$;

revoke all on function public.calculate_employee_payroll_period(uuid, date) from public, anon;
grant execute on function public.calculate_employee_payroll_period(uuid, date) to authenticated;
