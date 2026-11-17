create or replace function public.update_ordinary_task_with_assignment(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_priority public.task_priority,
  p_subtask_titles text[],
  p_store_id uuid,
  p_assignee_employee_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated boolean;
  v_title text;
  v_position integer := 1;
  v_subtask public.task_subtasks%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if nullif(trim(p_title), '') is null or char_length(trim(p_title)) > 200
    or (p_description is not null and char_length(trim(p_description)) > 5000)
    or p_store_id is null
    or coalesce(cardinality(p_subtask_titles), 0) > 20
    or exists (
      select 1 from unnest(coalesce(p_subtask_titles, array[]::text[])) as item(title)
      where nullif(trim(item.title), '') is null or char_length(trim(item.title)) > 240
    ) then
    raise exception 'Invalid task data' using errcode = '22023';
  end if;
  if not app_private.current_user_can_access_store(p_store_id) then
    raise exception 'Store is not accessible to current user' using errcode = '42501';
  end if;
  if p_assignee_employee_id is not null and not exists (
    select 1
    from public.employees e
    join public.employee_store_assignments a on a.employee_id = e.id
    where e.id = p_assignee_employee_id
      and e.is_active
      and a.store_id = p_store_id
      and a.valid_from <= current_date
      and (a.valid_to is null or a.valid_to >= current_date)
  ) then
    raise exception 'Assignee must be active and assigned to the selected store' using errcode = '22023';
  end if;

  update public.tasks
     set title = trim(p_title),
         description = nullif(trim(p_description), ''),
         due_at = p_due_at,
         priority = p_priority,
         store_id = p_store_id,
         assignee_employee_id = p_assignee_employee_id,
         updated_at = now()
   where id = p_task_id
     and task_type = 'ordinary'
     and status in ('open', 'in_progress', 'overdue')
     and (
       created_by = (select auth.uid())
       or (
         source_checklist_submission_id is not null
         and (select app_private.current_user_has_role('store_manager'))
         and (select app_private.current_user_can_access_store(store_id))
       )
     );
  v_updated := found;
  if not v_updated then
    return false;
  end if;

  for v_title in
    select trim(item.title)
    from unnest(coalesce(p_subtask_titles, array[]::text[])) as item(title)
  loop
    select * into v_subtask
    from public.task_subtasks
    where task_id = p_task_id and sort_order = v_position
    order by created_at, id
    limit 1;

    if found then
      update public.task_subtasks
         set title = v_title,
             status = case when title is distinct from v_title then 'open' else status end,
             completed_by = case when title is distinct from v_title then null else completed_by end,
             completed_at = case when title is distinct from v_title then null else completed_at end
       where id = v_subtask.id;
    else
      insert into public.task_subtasks (task_id, title, instructions, is_required, sort_order, status)
      values (p_task_id, v_title, '', true, v_position, 'open');
    end if;
    v_position := v_position + 1;
  end loop;

  delete from public.task_subtasks
  where task_id = p_task_id and sort_order >= v_position;
  return true;
end;
$$;

revoke all on function public.update_ordinary_task_with_assignment(uuid, text, text, timestamptz, public.task_priority, text[], uuid, uuid) from public, anon;
grant execute on function public.update_ordinary_task_with_assignment(uuid, text, text, timestamptz, public.task_priority, text[], uuid, uuid) to authenticated;
