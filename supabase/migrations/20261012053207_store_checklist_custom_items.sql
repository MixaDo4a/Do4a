alter table public.checklist_items
  add column store_id uuid references public.stores(id);

drop index if exists public.checklist_items_template_sort_unique;
create unique index checklist_items_template_global_sort_unique
  on public.checklist_items (template_id, sort_order)
  where store_id is null;
create unique index checklist_items_template_store_sort_unique
  on public.checklist_items (template_id, store_id, sort_order)
  where store_id is not null;
create index checklist_items_store_id_idx
  on public.checklist_items (store_id)
  where store_id is not null;

alter table public.checklist_submission_items
  add column title_snapshot text;

create function public.check_store_checklist_item_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.checklist_items item
    where item.id = new.item_id
      and (item.store_id is null or item.store_id = new.store_id)
  ) then
    raise exception 'Checklist item does not belong to this store';
  end if;
  return new;
end;
$$;

create trigger check_store_checklist_item_scope
  before insert or update of store_id, item_id on public.store_checklist_item_settings
  for each row execute function public.check_store_checklist_item_scope();

drop policy if exists "checklist_items_manager_manage" on public.checklist_items;
create policy "checklist_items_admin_manage"
  on public.checklist_items for all to authenticated
  using (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
  )
  with check (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
  );

create policy "checklist_items_store_manager_insert"
  on public.checklist_items for insert to authenticated
  with check (
    store_id is not null
    and (select app_private.current_user_has_role('store_manager'))
    and app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "checklist_item_weights_manager_manage" on public.checklist_item_weights;
create policy "checklist_item_weights_admin_manage"
  on public.checklist_item_weights for all to authenticated
  using (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
  )
  with check (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
  );

create function public.add_store_checklist_item(
  p_store_id uuid,
  p_template_id uuid,
  p_title text,
  p_weight_padawan numeric,
  p_weight_experienced numeric
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_item_id uuid;
  v_sort_order integer;
begin
  if (select auth.uid()) is null
    or not (
      (select app_private.current_user_has_role('store_manager'))
      or (select app_private.current_user_has_role('super_admin'))
      or (select app_private.current_user_has_role('developer'))
    )
    or not (select app_private.current_user_can_access_store(p_store_id))
  then
    raise exception 'Not authorized to edit this store checklist';
  end if;

  if not exists (
    select 1 from public.checklist_templates
    where id = p_template_id and is_active
  ) then
    raise exception 'Active checklist template not found';
  end if;

  if nullif(btrim(p_title), '') is null or length(btrim(p_title)) > 200
    or p_weight_padawan is null or p_weight_experienced is null
    or p_weight_padawan < 0 or p_weight_experienced < 0
    or p_weight_padawan > 999999999999.99
    or p_weight_experienced > 999999999999.99
  then
    raise exception 'Invalid checklist item';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_store_id::text, 0));
  select coalesce(max(sort_order), -1) + 1 into v_sort_order
  from public.checklist_items
  where template_id = p_template_id
    and (store_id is null or store_id = p_store_id);

  insert into public.checklist_items (template_id, store_id, title, sort_order)
  values (p_template_id, p_store_id, btrim(p_title), v_sort_order)
  returning id into v_item_id;

  insert into public.store_checklist_item_settings (
    store_id, item_id, is_enabled, custom_title,
    weight_padawan, weight_experienced, created_by, updated_by
  ) values (
    p_store_id, v_item_id, true, null,
    round(p_weight_padawan, 2), round(p_weight_experienced, 2),
    (select auth.uid()), (select auth.uid())
  );

  return v_item_id;
end;
$$;

revoke all on function public.add_store_checklist_item(uuid, uuid, text, numeric, numeric) from public, anon;
grant execute on function public.add_store_checklist_item(uuid, uuid, text, numeric, numeric) to authenticated;
