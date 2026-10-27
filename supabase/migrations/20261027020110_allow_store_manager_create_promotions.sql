create policy "supplier_promotions_store_manager_insert"
  on public.supplier_promotions
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('store_manager')
    and app_private.current_user_can_access_store(store_id)
  );
