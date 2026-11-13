drop policy if exists task_completion_photos_select_scoped on public.task_completion_photos;

create policy task_completion_photos_select_scoped
  on public.task_completion_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_completion_photos.task_id
        and t.status = 'done'
        and (
          t.completed_by = (select auth.uid())
          or (
            (
              (select app_private.current_user_has_role('store_manager'::user_role_code))
              or (select app_private.current_user_has_role('super_admin'::user_role_code))
              or (select app_private.current_user_has_role('developer'::user_role_code))
            )
            and (select app_private.current_user_can_access_store(t.store_id))
          )
        )
    )
  );
