create policy "store_checklist_item_settings_store_manager_insert"
  on public.store_checklist_item_settings
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('store_manager')
    and app_private.current_user_can_access_store(store_id)
  );

create policy "store_checklist_item_settings_store_manager_update"
  on public.store_checklist_item_settings
  for update
  to authenticated
  using (
    app_private.current_user_has_role('store_manager')
    and app_private.current_user_can_access_store(store_id)
  )
  with check (
    app_private.current_user_has_role('store_manager')
    and app_private.current_user_can_access_store(store_id)
  );
