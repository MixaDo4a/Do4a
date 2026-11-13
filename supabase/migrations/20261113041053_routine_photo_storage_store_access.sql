drop policy if exists routine_photos_select_authenticated on storage.objects;

create policy routine_photos_select_authenticated
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'routine-photos'
    and exists (
      select 1
      from public.files f
      join public.day_routine_session_item_photos p on p.file_id = f.id
      join public.day_routine_session_items si on si.id = p.session_item_id
      join public.day_routine_sessions s on s.id = si.session_id
      where f.bucket = 'routine-photos'
        and f.path = objects.name
        and (
          s.employee_id = (select app_private.current_user_employee_id())
          or (select app_private.current_user_has_role('developer'::user_role_code))
          or (select app_private.current_user_can_access_store(s.store_id))
        )
    )
  );
