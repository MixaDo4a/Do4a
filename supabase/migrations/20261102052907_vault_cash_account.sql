create table public.vault_cash_withdrawals (
  id uuid primary key default gen_random_uuid(),
  amount numeric(20,2) not null check (amount > 0),
  comment text not null check (length(btrim(comment)) between 1 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index vault_cash_withdrawals_created_at_idx
  on public.vault_cash_withdrawals (created_at desc);

alter table public.vault_cash_withdrawals enable row level security;
revoke all on public.vault_cash_withdrawals from public, anon;
revoke insert, update, delete on public.vault_cash_withdrawals from authenticated;
grant select on public.vault_cash_withdrawals to authenticated;

create policy vault_cash_withdrawals_admin_read
  on public.vault_cash_withdrawals
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  );

create or replace function public.get_vault_cash_balance()
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_collected numeric(20,2);
  v_withdrawn numeric(20,2);
begin
  if auth.uid() is null or not (
      app_private.current_user_has_role('store_manager')
      or app_private.current_user_has_role('auditor')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    ) or not exists (select 1 from public.admin_list_accessible_stores()) then
    raise exception 'Not allowed to view vault balance';
  end if;

  select coalesce(sum(report.cash_collection_amount), 0)
  into v_collected
  from public.shifts shift
  join public.stores store on store.id = shift.store_id
  join public.shift_closing_reports report on report.shift_id = shift.id
  where shift.shift_date >= date '2026-11-01'
    and shift.status in ('closed', 'auto_closed')
    and lower(store.name) not like '%склад%'
    and lower(store.name) not like '%warehouse%';

  select coalesce(sum(withdrawal.amount), 0)
  into v_withdrawn
  from public.vault_cash_withdrawals withdrawal;

  return v_collected - v_withdrawn;
end;
$$;

revoke all on function public.get_vault_cash_balance() from public, anon;
grant execute on function public.get_vault_cash_balance() to authenticated;

create or replace function public.create_vault_cash_withdrawal(
  p_amount numeric,
  p_comment text
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_collected numeric(20,2);
  v_withdrawn numeric(20,2);
  v_balance numeric(20,2);
begin
  if auth.uid() is null or not app_private.current_user_has_role('super_admin') then
    raise exception 'Only super admins can withdraw vault cash';
  end if;
  if p_amount is null or p_amount <= 0 or round(p_amount, 2) <> p_amount then
    raise exception 'Withdrawal amount must be positive and have at most two decimal places';
  end if;
  if p_comment is null or length(btrim(p_comment)) not between 1 and 1000 then
    raise exception 'Withdrawal comment is required';
  end if;

  perform pg_advisory_xact_lock(2026110201, 1);

  select coalesce(sum(report.cash_collection_amount), 0)
  into v_collected
  from public.shifts shift
  join public.stores store on store.id = shift.store_id
  join public.shift_closing_reports report on report.shift_id = shift.id
  where shift.shift_date >= date '2026-11-01'
    and shift.status in ('closed', 'auto_closed')
    and lower(store.name) not like '%склад%'
    and lower(store.name) not like '%warehouse%';

  select coalesce(sum(withdrawal.amount), 0)
  into v_withdrawn
  from public.vault_cash_withdrawals withdrawal;

  v_balance := v_collected - v_withdrawn;
  if p_amount > v_balance then
    raise exception 'Withdrawal exceeds current vault balance';
  end if;

  insert into public.vault_cash_withdrawals (amount, comment, created_by)
  values (p_amount, btrim(p_comment), auth.uid());

  return v_balance - p_amount;
end;
$$;

revoke all on function public.create_vault_cash_withdrawal(numeric, text) from public, anon;
grant execute on function public.create_vault_cash_withdrawal(numeric, text) to authenticated;
