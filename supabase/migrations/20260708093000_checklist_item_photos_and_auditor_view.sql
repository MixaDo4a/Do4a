insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'checklist-photos',
  'checklist-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.checklist_submission_item_files (
  id uuid primary key default gen_random_uuid(),
  submission_item_id uuid not null references public.checklist_submission_items(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists checklist_submission_item_files_item_file_unique
  on public.checklist_submission_item_files (submission_item_id, file_id);

alter table public.checklist_submission_item_files enable row level security;

grant select, insert on table public.checklist_submission_item_files to authenticated;

drop policy if exists "checklist_photos_select_authenticated" on storage.objects;
create policy "checklist_photos_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'checklist-photos');

drop policy if exists "checklist_photos_insert_auditor" on storage.objects;
create policy "checklist_photos_insert_auditor"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'checklist-photos'
    and owner = (select auth.uid())
    and (
      app_private.current_user_has_role('auditor')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    )
  );

drop policy if exists "checklist_submission_item_files_select_accessible" on public.checklist_submission_item_files;
create policy "checklist_submission_item_files_select_accessible"
  on public.checklist_submission_item_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.checklist_submission_items csi
      join public.checklist_submissions cs on cs.id = csi.submission_id
      where csi.id = submission_item_id
        and (
          cs.employee_id = app_private.current_user_employee_id()
          or cs.auditor_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(cs.store_id)
          or app_private.current_user_has_role('super_admin')
          or app_private.current_user_has_role('developer')
        )
    )
  );

drop policy if exists "checklist_submission_item_files_insert_auditor" on public.checklist_submission_item_files;
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
        )
    )
  );

do $$
declare
  v_template_id uuid;
  item record;
  v_item_id uuid;
begin
  update public.checklist_templates
  set is_active = false, updated_at = now()
  where is_active = true;

  insert into public.checklist_templates (name, version, is_active)
  values ('Стандартный чек-лист магазина', 2, true)
  on conflict (name, version) do update
  set is_active = true, updated_at = now()
  returning id into v_template_id;

  for item in
    select *
    from (
      values
        (10, 'Порядок на стеллажах', 350::numeric, 300::numeric),
        (20, 'Внешний вид продавца', 240::numeric, 200::numeric),
        (30, 'Скрипт на кассе', 260::numeric, 220::numeric),
        (40, 'Наличие ценников', 300::numeric, 250::numeric),
        (50, 'Рабочий телефон', 110::numeric, 70::numeric),
        (60, 'Порядок во входной группе', 110::numeric, 70::numeric),
        (70, 'Порядок в вещах и экипе', 160::numeric, 120::numeric),
        (80, 'Порядок за стойкой', 150::numeric, 110::numeric),
        (90, 'Музыка и видосы на телевизоре', 90::numeric, 50::numeric),
        (100, 'Порядок в примерочной', 90::numeric, 50::numeric),
        (110, 'Порядок на складе', 90::numeric, 50::numeric),
        (120, 'Подсветка', 50::numeric, 10::numeric)
    ) as checklist_item(sort_order, title, experienced_weight, padawan_weight)
  loop
    insert into public.checklist_items (template_id, title, sort_order, is_active)
    values (v_template_id, item.title, item.sort_order, true)
    on conflict (template_id, sort_order) do update
    set title = excluded.title, is_active = true, updated_at = now()
    returning id into v_item_id;

    insert into public.checklist_item_weights (item_id, employee_status, weight_amount)
    values
      (v_item_id, 'experienced', item.experienced_weight),
      (v_item_id, 'padawan', item.padawan_weight)
    on conflict (item_id, employee_status) do update
    set weight_amount = excluded.weight_amount, updated_at = now();
  end loop;
end $$;
