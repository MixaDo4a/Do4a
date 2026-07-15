drop policy if exists "stores_select_accessible_developer" on public.stores;
create policy "stores_select_accessible_developer"
  on public.stores
  for select
  to authenticated
  using (app_private.current_user_has_role('developer'));

drop policy if exists "employees_select_accessible_developer" on public.employees;
create policy "employees_select_accessible_developer"
  on public.employees
  for select
  to authenticated
  using (app_private.current_user_has_role('developer'));

drop policy if exists "employee_store_assignments_select_developer" on public.employee_store_assignments;
create policy "employee_store_assignments_select_developer"
  on public.employee_store_assignments
  for select
  to authenticated
  using (app_private.current_user_has_role('developer'));

drop policy if exists "store_sales_plans_select_developer" on public.store_sales_plans;
create policy "store_sales_plans_select_developer"
  on public.store_sales_plans
  for select
  to authenticated
  using (app_private.current_user_has_role('developer'));

drop policy if exists "schedules_select_developer" on public.schedules;
create policy "schedules_select_developer"
  on public.schedules
  for select
  to authenticated
  using (app_private.current_user_has_role('developer'));

drop policy if exists "shifts_select_developer" on public.shifts;
create policy "shifts_select_developer"
  on public.shifts
  for select
  to authenticated
  using (app_private.current_user_has_role('developer'));
