grant select, insert, update on table
  public.tasks
to authenticated;

grant select, insert on table
  public.task_comments,
  public.task_files
to authenticated;
