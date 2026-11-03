create or replace function app_private.current_warehouse_can_view_city_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.current_user_has_role('warehouse_manager')
    and exists (
      select 1
      from public.profiles actor_profile
      join public.employees actor on actor.id = actor_profile.employee_id
      join public.stores target_store on target_store.id = p_store_id
      where actor_profile.id = (select auth.uid())
        and actor_profile.is_blocked = false
        and nullif(btrim(actor.city), '') is not null
        and lower(btrim(target_store.city)) = lower(btrim(actor.city))
    );
$$;

create or replace function app_private.current_warehouse_can_view_payroll_employee(
  p_employee_id uuid,
  p_period_month date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.current_user_has_role('warehouse_manager')
    and p_period_month is not null
    and exists (
      select 1
      from public.profiles actor_profile
      join public.employees actor on actor.id = actor_profile.employee_id
      join public.employee_store_assignments target_assignment on target_assignment.employee_id = p_employee_id
      join public.stores target_store on target_store.id = target_assignment.store_id
      where actor_profile.id = (select auth.uid())
        and actor_profile.is_blocked = false
        and nullif(btrim(actor.city), '') is not null
        and lower(btrim(target_store.city)) = lower(btrim(actor.city))
        and target_assignment.valid_from <= (
          date_trunc('month', p_period_month::timestamp) + interval '1 month - 1 day'
        )::date
        and (target_assignment.valid_to is null or target_assignment.valid_to >= date_trunc('month', p_period_month::timestamp)::date)
    );
$$;

revoke all on function app_private.current_warehouse_can_view_city_store(uuid) from public, anon, authenticated;
revoke all on function app_private.current_warehouse_can_view_payroll_employee(uuid, date) from public, anon, authenticated;
grant execute on function app_private.current_warehouse_can_view_city_store(uuid) to authenticated;
grant execute on function app_private.current_warehouse_can_view_payroll_employee(uuid, date) to authenticated;

create or replace function public.list_warehouse_payroll_stores()
returns table (id uuid, name text, city text, status text)
language sql
stable
security definer
set search_path = ''
as $$
  select store.id, store.name, store.city, store.status::text
  from public.stores as store
  where app_private.current_warehouse_can_view_city_store(store.id)
  order by store.city, store.name;
$$;

revoke all on function public.list_warehouse_payroll_stores() from public, anon, authenticated;
grant execute on function public.list_warehouse_payroll_stores() to authenticated;

create or replace function public.list_warehouse_payroll_employee_stores(p_period_month date)
returns table (employee_id uuid, store_id uuid, valid_from date, valid_to date)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct assignment.employee_id, assignment.store_id, assignment.valid_from, assignment.valid_to
  from public.employee_store_assignments as assignment
  join public.payroll_entries as entry on entry.employee_id = assignment.employee_id
  join public.payroll_periods as period on period.id = entry.payroll_period_id
  where p_period_month is not null
    and period.period_month = date_trunc('month', p_period_month::timestamp)::date
    and app_private.current_warehouse_can_view_city_store(assignment.store_id)
    and app_private.current_warehouse_can_view_payroll_employee(assignment.employee_id, period.period_month)
    and assignment.valid_from <= (
      date_trunc('month', period.period_month::timestamp) + interval '1 month - 1 day'
    )::date
    and (assignment.valid_to is null or assignment.valid_to >= date_trunc('month', period.period_month::timestamp)::date)
  order by assignment.employee_id, assignment.store_id, assignment.valid_from, assignment.valid_to;
$$;

revoke all on function public.list_warehouse_payroll_employee_stores(date) from public, anon, authenticated;
grant execute on function public.list_warehouse_payroll_employee_stores(date) to authenticated;

create policy employees_warehouse_payroll_city_select
  on public.employees
  for select
  to authenticated
  using (
    app_private.current_user_has_role('warehouse_manager')
    and exists (
      select 1
      from public.payroll_entries as entry
      join public.payroll_periods as period on period.id = entry.payroll_period_id
      where entry.employee_id = employees.id
        and app_private.current_warehouse_can_view_payroll_employee(employees.id, period.period_month)
    )
  );

create policy payroll_entries_warehouse_payroll_city_select
  on public.payroll_entries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.payroll_periods as period
      where period.id = payroll_entries.payroll_period_id
        and app_private.current_warehouse_can_view_payroll_employee(payroll_entries.employee_id, period.period_month)
    )
  );

create policy payroll_adjustments_warehouse_payroll_city_select
  on public.payroll_adjustments
  for select
  to authenticated
  using (app_private.current_warehouse_can_view_payroll_employee(employee_id, period_month));
