create table public.schedule_editor_layouts (
  store_id uuid not null references public.stores(id) on delete cascade,
  month_start date not null,
  employee_ids uuid[] not null default '{}',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (store_id, month_start),
  constraint schedule_editor_layouts_eight_rows check (cardinality(employee_ids) <= 8),
  constraint schedule_editor_layouts_month_start check (extract(day from month_start) = 1)
);

alter table public.schedule_editor_layouts enable row level security;

create policy "schedule_editor_layouts_select" on public.schedule_editor_layouts
  for select to authenticated
  using (
    app_private.current_user_has_role('developer')
    or app_private.current_user_can_access_store(store_id)
  );

create policy "schedule_editor_layouts_manage" on public.schedule_editor_layouts
  for all to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (
      (app_private.current_user_has_role('super_admin') or app_private.current_user_has_role('store_manager'))
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('developer')
    or (
      (app_private.current_user_has_role('super_admin') or app_private.current_user_has_role('store_manager'))
      and app_private.current_user_can_access_store(store_id)
    )
  );

grant select, insert, update, delete on public.schedule_editor_layouts to authenticated;
