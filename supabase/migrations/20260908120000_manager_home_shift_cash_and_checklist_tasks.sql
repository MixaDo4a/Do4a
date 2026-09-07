alter table public.tasks
  add column if not exists source_checklist_submission_id uuid references public.checklist_submissions(id) on delete set null;

create or replace function app_private.prevent_multiple_active_shifts()
returns trigger
language plpgsql
set search_path = public, app_private
as $$
begin
  if new.status in ('opened', 'correction_required')
     and new.opened_by_employee_id is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(new.opened_by_employee_id::text, 0)
    );

    if exists (
      select 1
      from public.shifts s
      where s.opened_by_employee_id = new.opened_by_employee_id
        and s.status in ('opened', 'correction_required')
        and s.id <> new.id
    ) then
      raise exception 'Employee already has an active shift';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_multiple_active_shifts on public.shifts;
create trigger prevent_multiple_active_shifts
before insert or update of opened_by_employee_id, status on public.shifts
for each row execute function app_private.prevent_multiple_active_shifts();

create unique index if not exists tasks_one_checklist_defect_task
  on public.tasks (source_checklist_submission_id)
  where source_checklist_submission_id is not null;

create table if not exists public.store_cash_counts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  counted_by_employee_id uuid not null references public.employees(id),
  created_by uuid references auth.users(id) on delete set null,
  cash_amount numeric(20,2) not null check (cash_amount >= 0),
  denominations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists store_cash_counts_store_created_idx
  on public.store_cash_counts (store_id, created_at desc);

alter table public.store_cash_counts enable row level security;
grant select, insert on table public.store_cash_counts to authenticated;

drop policy if exists "store_cash_counts_select_accessible" on public.store_cash_counts;
create policy "store_cash_counts_select_accessible"
  on public.store_cash_counts for select to authenticated
  using (app_private.current_user_can_access_store(store_id));

drop policy if exists "store_cash_counts_insert_accessible" on public.store_cash_counts;
create policy "store_cash_counts_insert_accessible"
  on public.store_cash_counts for insert to authenticated
  with check (
    app_private.current_user_can_access_store(store_id)
    and counted_by_employee_id = app_private.current_user_employee_id()
  );

drop policy if exists "tasks_checklist_defect_insert" on public.tasks;
create policy "tasks_checklist_defect_insert"
  on public.tasks for insert to authenticated
  with check (
    source_checklist_submission_id is not null
    and (
      app_private.current_user_has_role('auditor')
      or app_private.current_user_has_role('store_manager')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    )
    and app_private.current_user_can_access_store(store_id)
  );

grant select on table public.tasks to authenticated;
