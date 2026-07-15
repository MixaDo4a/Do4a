insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'shift-reports',
  'shift-reports',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "shift_reports_select_authenticated" on storage.objects;
create policy "shift_reports_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'shift-reports');

drop policy if exists "shift_reports_insert_authenticated" on storage.objects;
create policy "shift_reports_insert_authenticated"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'shift-reports' and owner = (select auth.uid()));

drop policy if exists "shift_reports_update_own_or_admin" on storage.objects;
create policy "shift_reports_update_own_or_admin"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'shift-reports'
    and (
      owner = (select auth.uid())
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    )
  )
  with check (
    bucket_id = 'shift-reports'
    and (
      owner = (select auth.uid())
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    )
  );

grant select, insert, update on table
  public.files,
  public.cash_report_files
to authenticated;

drop policy if exists "files_developer_all" on public.files;
create policy "files_developer_all"
  on public.files
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "cash_report_files_developer_all" on public.cash_report_files;
create policy "cash_report_files_developer_all"
  on public.cash_report_files
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));
