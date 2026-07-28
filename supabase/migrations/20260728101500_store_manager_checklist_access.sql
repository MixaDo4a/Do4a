drop policy if exists "checklist_submissions_auditor_insert" on public.checklist_submissions;
drop policy if exists "checklist_submission_items_auditor_insert" on public.checklist_submission_items;
drop policy if exists "checklist_photos_insert_auditor" on storage.objects;
drop policy if exists "checklist_submission_item_files_insert_auditor" on public.checklist_submission_item_files;

create policy "checklist_submissions_auditor_insert"
  on public.checklist_submissions
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('auditor')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "checklist_submission_items_auditor_insert"
  on public.checklist_submission_items
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.checklist_submissions cs
      where cs.id = submission_id
        and (
          app_private.current_user_has_role('super_admin')
          or app_private.current_user_has_role('developer')
          or cs.auditor_employee_id = app_private.current_user_employee_id()
          or (
            app_private.current_user_has_role('store_manager')
            and app_private.current_user_can_access_store(cs.store_id)
          )
        )
    )
  );

create policy "checklist_photos_insert_auditor"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'checklist-photos'
    and owner = (select auth.uid())
    and (
      app_private.current_user_has_role('auditor')
      or app_private.current_user_has_role('store_manager')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    )
  );

create policy "checklist_submission_item_files_insert_auditor"
  on public.checklist_submission_item_files
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1
      from public.checklist_submission_items csi
      join public.checklist_submissions cs on cs.id = csi.submission_id
      where csi.id = submission_item_id
        and (
          cs.auditor_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
          or app_private.current_user_has_role('developer')
          or (
            app_private.current_user_has_role('store_manager')
            and app_private.current_user_can_access_store(cs.store_id)
          )
        )
    )
  );
