alter table public.tasks
  add column if not exists requires_completion_photo boolean not null default false;

alter table public.task_recurrence_rules
  add column if not exists requires_completion_photo boolean not null default false;

create table if not exists public.task_completion_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.tasks(id) on delete cascade,
  storage_path text unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer not null check (size_bytes between 1 and 4194304),
  uploaded_by uuid not null references public.employees(id),
  uploaded_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '6 days'),
  deleted_at timestamptz,
  constraint task_completion_photos_path_check check (storage_path like task_id::text || '/%'),
  constraint task_completion_photos_retention_check check (expires_at <= uploaded_at + interval '7 days')
);

create index if not exists task_completion_photos_expiry_idx
  on public.task_completion_photos (expires_at)
  where deleted_at is null;

alter table public.task_completion_photos enable row level security;
alter table public.task_completion_photos alter column storage_path drop not null;
revoke all on public.task_completion_photos from anon, authenticated;
grant select, insert, delete on public.task_completion_photos to authenticated;
grant all on public.task_completion_photos to service_role;

create policy task_completion_photos_select_scoped
  on public.task_completion_photos for select to authenticated
  using (
    deleted_at is null
    and expires_at > now()
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.status = 'done'
        and (
          t.completed_by = (select auth.uid())
          or (
            ((select app_private.current_user_has_role('store_manager'))
              or (select app_private.current_user_has_role('super_admin'))
              or (select app_private.current_user_has_role('developer')))
            and (select app_private.current_user_can_access_store(t.store_id))
          )
        )
    )
  );

create policy task_completion_photos_insert_assigned_employee
  on public.task_completion_photos for insert to authenticated
  with check (
    uploaded_by = (select app_private.current_user_employee_id())
    and storage_path is not null
    and expires_at > now()
    and expires_at <= now() + interval '7 days'
    and exists (
      select 1 from public.tasks t
      where t.id = task_id
        and t.requires_completion_photo
        and t.status in ('open', 'in_progress', 'overdue')
        and (t.assignee_employee_id is null or t.assignee_employee_id = uploaded_by)
        and (t.assignee_employee_id is not null or exists (
          select 1 from public.employee_store_assignments a
          where a.employee_id = uploaded_by
            and a.store_id = t.store_id
            and a.valid_from <= current_date
            and (a.valid_to is null or a.valid_to >= current_date)
        ))
    )
  );

create policy task_completion_photos_delete_own_upload
  on public.task_completion_photos for delete to authenticated
  using (
    uploaded_by = (select app_private.current_user_employee_id())
    and deleted_at is null
    and exists (select 1 from public.tasks t where t.id = task_id and t.status in ('open', 'in_progress', 'overdue'))
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-completion-photos', 'task-completion-photos', false, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy task_completion_photos_storage_insert_assigned
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-completion-photos'
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
        and t.requires_completion_photo
        and t.status in ('open', 'in_progress', 'overdue')
        and (
          t.assignee_employee_id = (select app_private.current_user_employee_id())
          or (t.assignee_employee_id is null and exists (
            select 1 from public.employee_store_assignments a
            where a.employee_id = (select app_private.current_user_employee_id())
              and a.store_id = t.store_id
              and a.valid_from <= current_date
              and (a.valid_to is null or a.valid_to >= current_date)
          ))
        )
    )
  );

create policy task_completion_photos_storage_select_scoped
  on storage.objects for select to authenticated
  using (
    bucket_id = 'task-completion-photos'
    and exists (
      select 1
      from public.task_completion_photos p
      join public.tasks t on t.id = p.task_id
      where p.storage_path = name
        and p.deleted_at is null
        and p.expires_at > now()
        and t.status = 'done'
        and (
          t.completed_by = (select auth.uid())
          or (
            ((select app_private.current_user_has_role('store_manager'))
              or (select app_private.current_user_has_role('super_admin'))
              or (select app_private.current_user_has_role('developer')))
            and (select app_private.current_user_can_access_store(t.store_id))
          )
        )
    )
  );

create policy task_completion_photos_storage_delete_own_upload
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-completion-photos'
    and owner_id = (select auth.uid())::text
    and exists (
      select 1 from public.tasks t
      where t.id::text = (storage.foldername(name))[1]
        and t.requires_completion_photo
        and t.status in ('open', 'in_progress', 'overdue')
    )
  );

create or replace function app_private.set_store_task_status(
  p_task_id uuid,
  p_status text,
  p_comment text default null
)
returns table (id uuid, created_by uuid)
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_store_id uuid;
  v_assignee_id uuid;
  v_status public.task_status;
  v_requires_photo boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if p_status not in ('done', 'overdue') then
    raise exception 'Unsupported task status';
  end if;

  select t.store_id, t.assignee_employee_id, t.status, t.requires_completion_photo
    into v_store_id, v_assignee_id, v_status, v_requires_photo
    from public.tasks t
   where t.id = p_task_id
   for update;

  if not found then
    raise exception 'Task not found';
  end if;

  if not (
    (select app_private.current_user_has_role('developer'))
    or (select app_private.current_user_has_role('super_admin'))
    or v_assignee_id = (select app_private.current_user_employee_id())
    or app_private.current_user_can_access_store(v_store_id)
  ) then
    raise exception 'No access to task store';
  end if;

  if v_status not in ('open', 'in_progress', 'overdue') then
    raise exception 'Task is already closed';
  end if;

  if p_status = 'done' and v_requires_photo and not exists (
    select 1
    from public.task_completion_photos p
    join storage.objects o on o.bucket_id = 'task-completion-photos' and o.name = p.storage_path
    where p.task_id = p_task_id
      and p.uploaded_by = (select app_private.current_user_employee_id())
      and p.storage_path is not null
      and p.deleted_at is null
      and p.expires_at > now()
  ) then
    raise exception 'A completion photo from the assigned employee is required';
  end if;

  if p_status = 'overdue' then
    insert into public.task_comments (task_id, author_profile_id, body)
    values (p_task_id, (select auth.uid()), coalesce(nullif(trim(p_comment), ''), 'Задача не выполнена.'));
  end if;

  return query
    update public.tasks t
       set status = p_status::public.task_status,
           completed_at = case when p_status = 'done' then now() else null end,
           completed_by = case when p_status = 'done' then (select auth.uid()) else null end,
           updated_at = now()
     where t.id = p_task_id
     returning t.id, t.created_by;
end;
$$;

revoke all on function app_private.set_store_task_status(uuid, text, text) from public, anon;
grant execute on function app_private.set_store_task_status(uuid, text, text) to authenticated;
