create policy "supplier_promotions_marketer_insert"
  on public.supplier_promotions
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('marketer')
    and app_private.current_user_can_access_store(store_id)
  );
