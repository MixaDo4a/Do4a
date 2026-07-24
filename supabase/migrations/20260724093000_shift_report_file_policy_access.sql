drop policy if exists "cash_report_files_insert_related" on public.cash_report_files;

create policy "cash_report_files_insert_related"
  on public.cash_report_files
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(s.store_id)
          or app_private.current_user_has_role('super_admin')
          or app_private.current_user_has_role('developer')
        )
    )
  );
