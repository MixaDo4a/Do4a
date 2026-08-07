insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'routine-photos',
  'routine-photos',
  false,
  25 * 1024 * 1024,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.day_routine_template_items
  add column if not exists item_key text;

create unique index if not exists day_routine_template_items_template_item_key_unique
  on public.day_routine_template_items (template_id, item_key);

create table if not exists public.day_routine_template_item_settings (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.day_routine_templates(id) on delete cascade,
  item_key text not null,
  requires_photo boolean not null default false,
  ai_review_enabled boolean not null default false,
  reference_photo_file_id uuid references public.files(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (template_id, item_key)
);

create index if not exists day_routine_template_item_settings_template_idx
  on public.day_routine_template_item_settings (template_id, item_key);

create table if not exists public.day_routine_session_item_photos (
  id uuid primary key default gen_random_uuid(),
  session_item_id uuid not null references public.day_routine_session_items(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (session_item_id, file_id)
);

create index if not exists day_routine_session_item_photos_session_item_idx
  on public.day_routine_session_item_photos (session_item_id, created_at desc);

create table if not exists public.day_routine_item_photo_reviews (
  id uuid primary key default gen_random_uuid(),
  session_item_photo_id uuid not null references public.day_routine_session_item_photos(id) on delete cascade,
  template_reference_file_id uuid references public.files(id) on delete set null,
  review_status text not null check (review_status in ('approved', 'needs_attention', 'manual_review', 'error')),
  review_comment text,
  review_payload jsonb,
  reviewed_at timestamptz not null default now(),
  reviewed_by text not null default 'openai'
);

create index if not exists day_routine_item_photo_reviews_photo_idx
  on public.day_routine_item_photo_reviews (session_item_photo_id, reviewed_at desc);

create or replace function app_private.populate_day_routine_item_keys(
  p_template_id uuid,
  p_parent_item_id uuid default null,
  p_prefix text default null
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_row record;
  v_index integer := 0;
  v_item_key text;
begin
  for v_row in
    select id
    from public.day_routine_template_items
    where template_id = p_template_id
      and (
        (p_parent_item_id is null and parent_item_id is null)
        or parent_item_id = p_parent_item_id
      )
    order by sort_order, title, id
  loop
    v_index := v_index + 1;
    v_item_key := case
      when p_prefix is null or p_prefix = '' then v_index::text
      else p_prefix || '.' || v_index::text
    end;

    update public.day_routine_template_items
       set item_key = v_item_key,
           updated_at = now()
     where id = v_row.id;

    perform app_private.populate_day_routine_item_keys(p_template_id, v_row.id, v_item_key);
  end loop;
end;
$$;

revoke all on function app_private.populate_day_routine_item_keys(uuid, uuid, text) from public;
grant execute on function app_private.populate_day_routine_item_keys(uuid, uuid, text) to authenticated;

do $$
declare
  v_template record;
begin
  update public.day_routine_template_items
     set item_key = nullif(item_key, '');

  for v_template in
    select id
    from public.day_routine_templates
  loop
    perform app_private.populate_day_routine_item_keys(v_template.id, null, null);
  end loop;
end;
$$;

alter table public.day_routine_template_items
  alter column item_key set not null;

drop trigger if exists set_day_routine_template_item_settings_updated_at on public.day_routine_template_item_settings;
create trigger set_day_routine_template_item_settings_updated_at
  before update on public.day_routine_template_item_settings
  for each row execute function public.set_updated_at();

alter table public.day_routine_template_item_settings enable row level security;
alter table public.day_routine_session_item_photos enable row level security;
alter table public.day_routine_item_photo_reviews enable row level security;

drop policy if exists "day_routine_template_item_settings_select_accessible" on public.day_routine_template_item_settings;
create policy "day_routine_template_item_settings_select_accessible"
  on public.day_routine_template_item_settings
  for select
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or exists (
      select 1
      from public.day_routine_templates t
      where t.id = template_id
        and (
          app_private.current_user_has_role('super_admin')
          or app_private.current_user_has_role('store_manager')
          or app_private.current_user_has_role('auditor')
        )
        and app_private.current_user_can_access_store(t.store_id)
    )
  );

drop policy if exists "day_routine_session_item_photos_select_accessible" on public.day_routine_session_item_photos;
create policy "day_routine_session_item_photos_select_accessible"
  on public.day_routine_session_item_photos
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.day_routine_session_items si
      join public.day_routine_sessions s on s.id = si.session_id
      where si.id = session_item_id
        and (
          s.employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('developer')
          or app_private.current_user_can_access_store(s.store_id)
        )
    )
  );

drop policy if exists "day_routine_item_photo_reviews_select_accessible" on public.day_routine_item_photo_reviews;
create policy "day_routine_item_photo_reviews_select_accessible"
  on public.day_routine_item_photo_reviews
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.day_routine_session_item_photos sip
      join public.day_routine_session_items si on si.id = sip.session_item_id
      join public.day_routine_sessions s on s.id = si.session_id
      where sip.id = session_item_photo_id
        and (
          s.employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('developer')
          or app_private.current_user_can_access_store(s.store_id)
        )
    )
  );

drop policy if exists "routine_photos_select_authenticated" on storage.objects;
create policy "routine_photos_select_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'routine-photos');

revoke all on public.day_routine_template_item_settings from public;
revoke all on public.day_routine_session_item_photos from public;
revoke all on public.day_routine_item_photo_reviews from public;

grant select on public.day_routine_template_item_settings to authenticated;
grant select on public.day_routine_session_item_photos to authenticated;
grant select on public.day_routine_item_photo_reviews to authenticated;

create or replace function public.save_day_routine_item_settings(
  p_template_id uuid,
  p_settings jsonb
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_user_id uuid := auth.uid();
  v_store_id uuid;
  v_count integer := 0;
  v_row jsonb;
  v_item_key text;
  v_requires_photo boolean;
  v_ai_review_enabled boolean;
  v_reference_photo_file_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select store_id
    into v_store_id
  from public.day_routine_templates
  where id = p_template_id;

  if v_store_id is null then
    raise exception 'Template not found';
  end if;

  if not (
    app_private.current_user_has_role('developer')
    or (
      app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('store_manager')
      or app_private.current_user_has_role('auditor')
    )
  ) then
    raise exception 'Not allowed';
  end if;

  if not app_private.current_user_has_role('developer') and not app_private.current_user_can_access_store(v_store_id) then
    raise exception 'Store is not accessible';
  end if;

  delete from public.day_routine_template_item_settings
  where template_id = p_template_id;

  for v_row in
    select value
    from jsonb_array_elements(coalesce(p_settings, '[]'::jsonb)) as value
  loop
    v_item_key := nullif(trim(both from coalesce(v_row->>'item_key', '')), '');
    if v_item_key is null then
      continue;
    end if;

    v_requires_photo := coalesce((v_row->>'requires_photo')::boolean, false);
    v_ai_review_enabled := coalesce((v_row->>'ai_review_enabled')::boolean, false) and v_requires_photo;
    v_reference_photo_file_id := nullif(trim(both from coalesce(v_row->>'reference_photo_file_id', '')), '')::uuid;

    insert into public.day_routine_template_item_settings (
      template_id,
      item_key,
      requires_photo,
      ai_review_enabled,
      reference_photo_file_id,
      created_by,
      updated_by
    )
    values (
      p_template_id,
      v_item_key,
      v_requires_photo,
      v_ai_review_enabled,
      v_reference_photo_file_id,
      v_user_id,
      v_user_id
    );

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.save_day_routine_item_settings(uuid, jsonb) from public;
grant execute on function public.save_day_routine_item_settings(uuid, jsonb) to authenticated;
