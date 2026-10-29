create table public.city_payroll_modes (
  id bigint generated always as identity primary key,
  city text not null check (length(btrim(city)) > 0),
  effective_from date not null check (extract(day from effective_from) = 1),
  calculation_mode text not null check (calculation_mode in ('legacy', 'academy')),
  reason text not null check (length(btrim(reason)) >= 4),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index city_payroll_modes_city_effective_idx
  on public.city_payroll_modes (city, effective_from desc, created_at desc, id desc);

alter table public.city_payroll_modes enable row level security;
revoke all on public.city_payroll_modes from public, anon, authenticated;
grant select, insert on public.city_payroll_modes to authenticated;
grant usage, select on sequence public.city_payroll_modes_id_seq to authenticated;

create policy city_payroll_modes_admin_read
  on public.city_payroll_modes for select to authenticated
  using ((select app_private.current_user_has_role('super_admin')));

create policy city_payroll_modes_admin_insert
  on public.city_payroll_modes for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (select app_private.current_user_has_role('super_admin'))
  );

create or replace function app_private.payroll_mode_for_city(p_city text, p_period_month date)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select mode.calculation_mode
    from public.city_payroll_modes mode
    where mode.city = p_city
      and mode.effective_from <= date_trunc('month', p_period_month)::date
    order by mode.effective_from desc, mode.created_at desc, mode.id desc
    limit 1
  ), 'legacy')
$$;

revoke all on function app_private.payroll_mode_for_city(text, date) from public, anon, authenticated;

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
    old.product_writeoff_amount, old.total_payout_amount, old.calculation_snapshot
  ) is distinct from row(
    new.shift_count, new.gross_revenue, new.sales_pay_amount, new.plan_bonus_amount,
    new.checklist_salary_per_shift, new.base_salary_amount, new.manual_bonus_amount,
    new.advance_amount, new.expiration_writeoff_amount, new.inventory_loss_amount,
    new.product_writeoff_amount, new.total_payout_amount, new.calculation_snapshot
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

revoke all on function app_private.snapshot_payroll_entry_before_update() from public, anon, authenticated;

create trigger payroll_entry_snapshot_before_update
before update on public.payroll_entries
for each row execute function app_private.snapshot_payroll_entry_before_update();
