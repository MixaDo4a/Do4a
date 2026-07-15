alter table public.schedules
  add column if not exists secondary_employee_id uuid references public.employees(id);

create index if not exists schedules_secondary_employee_date_idx
  on public.schedules (secondary_employee_id, shift_date);

grant select, insert, update, delete on table public.schedules to authenticated;
