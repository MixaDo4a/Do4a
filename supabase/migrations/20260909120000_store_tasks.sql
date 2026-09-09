alter table public.tasks
  alter column assignee_employee_id drop not null;

comment on column public.tasks.assignee_employee_id is
  'Individual assignee; null means the task is assigned to the store.';
