drop policy if exists "notifications_insert_managers" on public.notifications;

create policy "notifications_insert_managers"
  on public.notifications
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('developer')
  );
