create function app_private.set_store_task_status(
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
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if p_status not in ('done', 'overdue') then
    raise exception 'Unsupported task status';
  end if;

  select t.store_id, t.assignee_employee_id, t.status
    into v_store_id, v_assignee_id, v_status
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

create function public.set_store_task_status(
  p_task_id uuid,
  p_status text,
  p_comment text default null
)
returns table (id uuid, created_by uuid)
language sql
security invoker
set search_path = public, app_private
as $$
  select * from app_private.set_store_task_status(p_task_id, p_status, p_comment);
$$;

revoke all on function public.set_store_task_status(uuid, text, text) from public, anon;
grant execute on function public.set_store_task_status(uuid, text, text) to authenticated;
