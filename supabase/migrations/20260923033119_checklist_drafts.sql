
create table if not exists public.checklist_drafts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint checklist_drafts_owner_target_unique unique (profile_id, template_id, store_id, employee_id)
);

create index if not exists checklist_drafts_profile_updated_idx
  on public.checklist_drafts (profile_id, updated_at desc);

alter table public.checklist_drafts enable row level security;

drop policy if exists "checklist_drafts_owner_select" on public.checklist_drafts;
create policy "checklist_drafts_owner_select"
  on public.checklist_drafts for select to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "checklist_drafts_owner_insert" on public.checklist_drafts;
create policy "checklist_drafts_owner_insert"
  on public.checklist_drafts for insert to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "checklist_drafts_owner_update" on public.checklist_drafts;
create policy "checklist_drafts_owner_update"
  on public.checklist_drafts for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "checklist_drafts_owner_delete" on public.checklist_drafts;
create policy "checklist_drafts_owner_delete"
  on public.checklist_drafts for delete to authenticated
  using (profile_id = (select auth.uid()));

grant select, insert, update, delete on public.checklist_drafts to authenticated;
