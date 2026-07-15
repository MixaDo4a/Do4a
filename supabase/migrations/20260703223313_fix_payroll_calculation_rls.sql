create policy "payroll_periods_manager_write"
  on public.payroll_periods
  for all
  to authenticated
  using (
    app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  )
  with check (
    app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  );

create policy "payroll_entries_manager_write"
  on public.payroll_entries
  for all
  to authenticated
  using (
    app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  )
  with check (
    app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  );
