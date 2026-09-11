-- Cover foreign keys used by routine, task, payroll and role lookups.
create index if not exists idx_checklist_submissions_auditor_employee_id
  on public.checklist_submissions (auditor_employee_id);
create index if not exists idx_checklist_submissions_template_id
  on public.checklist_submissions (template_id);
create index if not exists idx_employees_primary_store_id
  on public.employees (primary_store_id);
create index if not exists idx_payroll_entries_employee_id
  on public.payroll_entries (employee_id);
create index if not exists idx_shifts_schedule_id
  on public.shifts (schedule_id);
create index if not exists idx_tasks_recurrence_rule_id
  on public.tasks (recurrence_rule_id);
create index if not exists idx_user_roles_role_id
  on public.user_roles (role_id);
create index if not exists idx_user_roles_scope_store_id
  on public.user_roles (scope_store_id);
