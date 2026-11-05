drop policy if exists tasks_select_related on public.tasks;
create policy tasks_select_related on public.tasks
  for select to authenticated
  using (
    assignee_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_can_access_store(store_id)
    or created_by = (select auth.uid())
  );

create or replace function public.create_ordinary_task_subtasks(p_task_ids uuid[], p_titles text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task_count integer;
  v_subtask_count integer;
begin
  if (select auth.uid()) is null
    or coalesce(cardinality(p_task_ids), 0) = 0
    or cardinality(p_task_ids) > 200
    or (select count(distinct ids.id) from unnest(p_task_ids) as ids(id)) <> cardinality(p_task_ids)
    or coalesce(cardinality(p_titles), 0) > 20
    or exists (
      select 1 from unnest(coalesce(p_titles, array[]::text[])) as item(title)
      where nullif(trim(item.title), '') is null or char_length(trim(item.title)) > 240
    ) then
    raise exception 'Invalid task subtask data' using errcode = '22023';
  end if;

  select count(*) into v_task_count
  from public.tasks t
  where t.id = any(p_task_ids)
    and t.created_by = (select auth.uid())
    and t.task_type = 'ordinary'
    and t.status = 'open';
  if v_task_count <> cardinality(p_task_ids) then
    raise exception 'Tasks must be newly created by the current user' using errcode = '42501';
  end if;

  insert into public.task_subtasks (task_id, title, instructions, is_required, sort_order, status)
  select task.task_id, trim(item.title), '', true, item.ordinality::integer, 'open'
  from unnest(p_task_ids) as task(task_id)
  cross join unnest(p_titles) with ordinality as item(title, ordinality);
  get diagnostics v_subtask_count = row_count;
  return v_subtask_count;
end;
$$;

create or replace function public.update_ordinary_task_by_creator(
  p_task_id uuid,
  p_title text,
  p_description text,
  p_due_at timestamptz,
  p_priority public.task_priority,
  p_subtask_titles text[]
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
    or (p_description is not null and char_length(p_description) > 5000)
    or coalesce(cardinality(p_subtask_titles), 0) > 20
    or exists (
      select 1 from unnest(coalesce(p_subtask_titles, array[]::text[])) as item(title)
      where nullif(trim(item.title), '') is null or char_length(trim(item.title)) > 240
    ) then
    raise exception 'Invalid task data' using errcode = '22023';
  end if;

  update public.tasks
     set title = trim(p_title),
         description = nullif(trim(p_description), ''),
         due_at = p_due_at,
         priority = p_priority,
         updated_at = now()
   where id = p_task_id
     and created_by = (select auth.uid())
     and task_type = 'ordinary'
     and status in ('open', 'in_progress', 'overdue');
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

revoke all on function public.create_ordinary_task_subtasks(uuid[], text[]) from public, anon;
grant execute on function public.create_ordinary_task_subtasks(uuid[], text[]) to authenticated;
revoke all on function public.update_ordinary_task_by_creator(uuid, text, text, timestamptz, public.task_priority, text[]) from public, anon;
grant execute on function public.update_ordinary_task_by_creator(uuid, text, text, timestamptz, public.task_priority, text[]) to authenticated;
