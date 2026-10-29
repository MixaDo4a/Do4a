create table public.payroll_manual_kpi_awards (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id),
  store_id uuid not null references public.stores(id),
  period_month date not null check (extract(day from period_month) = 1),
  metric text not null check (metric in ('average_check', 'check_depth')),
  amount numeric(12,2) not null check (amount >= 0),
  reason text not null check (length(btrim(reason)) between 4 and 1000),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index payroll_manual_kpi_awards_lookup_idx
  on public.payroll_manual_kpi_awards (employee_id, store_id, period_month, metric, id desc);

alter table public.payroll_manual_kpi_awards enable row level security;

create policy payroll_manual_kpi_awards_read
  on public.payroll_manual_kpi_awards for select to authenticated
  using (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
    or (
      (select app_private.current_user_has_role('store_manager'))
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy payroll_manual_kpi_awards_insert
  on public.payroll_manual_kpi_awards for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select app_private.current_user_has_role('super_admin'))
      or (select app_private.current_user_has_role('developer'))
      or (
        (select app_private.current_user_has_role('store_manager'))
        and app_private.current_user_can_access_store(store_id)
      )
    )
  );

grant select, insert on public.payroll_manual_kpi_awards to authenticated;
grant usage, select on sequence public.payroll_manual_kpi_awards_id_seq to authenticated;
