grant insert on public.task_subtasks to authenticated;

create policy task_subtasks_insert_task_creator on public.task_subtasks
  for insert to authenticated with check (
    exists (select 1 from public.tasks t where t.id = task_id and t.created_by = (select auth.uid()))
  );
