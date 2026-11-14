create or replace function public.create_ordinary_task_subtasks(p_task_ids uuid[], p_titles text[])
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_task_id uuid;
  v_title text;
  v_index integer := 0;
begin
  if auth.uid() is null or coalesce(array_length(p_titles, 1), 0) > 10 then
    raise exception 'Некорректный список подзадач.' using errcode = '22023';
  end if;
  foreach v_task_id in array coalesce(p_task_ids, '{}') loop
    if not exists (select 1 from public.tasks where id = v_task_id and created_by = auth.uid() and task_type = 'ordinary') then
      raise exception 'Недостаточно прав для добавления подзадач.' using errcode = '42501';
    end if;
    v_index := 0;
    foreach v_title in array coalesce(p_titles, '{}') loop
      v_index := v_index + 1;
      if char_length(trim(v_title)) not between 1 and 250 then
        raise exception 'Некорректная подзадача.' using errcode = '22023';
      end if;
      insert into public.task_subtasks(task_id, title, instructions, is_required, sort_order)
      values (v_task_id, trim(v_title), '', false, v_index);
    end loop;
  end loop;
end;
$$;

revoke all on function public.create_ordinary_task_subtasks(uuid[], text[]) from public, anon;
grant execute on function public.create_ordinary_task_subtasks(uuid[], text[]) to authenticated;
