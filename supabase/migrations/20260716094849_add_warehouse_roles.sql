alter type public.user_role_code add value if not exists 'warehouse_manager' after 'store_manager';
alter type public.user_role_code add value if not exists 'warehouse_assistant' after 'warehouse_manager';

insert into public.roles (code, name, description)
values
  ('warehouse_manager', 'Кладовщик', 'Ведёт складские вычеты и задачи помощников кладовщика'),
  ('warehouse_assistant', 'Помощник кладовщика', 'Выполняет задачи кладовщика')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

drop policy if exists "tasks_warehouse_insert" on public.tasks;
create policy "tasks_warehouse_insert"
  on public.tasks
  for insert
  to authenticated
  with check (
    (
      app_private.current_user_has_role('warehouse_manager')
      and app_private.current_user_can_access_store(store_id)
    )
    or (
      app_private.current_user_has_role('warehouse_assistant')
      and assignee_employee_id = app_private.current_user_employee_id()
    )
  );

drop policy if exists "payroll_entries_warehouse_select" on public.payroll_entries;
create policy "payroll_entries_warehouse_select"
  on public.payroll_entries
  for select
  to authenticated
  using (
    app_private.current_user_has_role('warehouse_manager')
    and exists (
      select 1
        from public.employee_store_assignments target_assignment
       where target_assignment.employee_id = payroll_entries.employee_id
         and app_private.current_user_can_access_store(target_assignment.store_id)
         and (target_assignment.valid_to is null or target_assignment.valid_to >= current_date)
    )
  );

drop policy if exists "payroll_adjustments_warehouse_select" on public.payroll_adjustments;
create policy "payroll_adjustments_warehouse_select"
  on public.payroll_adjustments
  for select
  to authenticated
  using (
    app_private.current_user_has_role('warehouse_manager')
    and exists (
      select 1
        from public.employee_store_assignments target_assignment
       where target_assignment.employee_id = payroll_adjustments.employee_id
         and app_private.current_user_can_access_store(target_assignment.store_id)
         and (target_assignment.valid_to is null or target_assignment.valid_to >= current_date)
    )
  );

drop policy if exists "payroll_adjustments_warehouse_insert" on public.payroll_adjustments;
create policy "payroll_adjustments_warehouse_insert"
  on public.payroll_adjustments
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('warehouse_manager')
    and adjustment_type <> 'bonus'
    and exists (
      select 1
        from public.employee_store_assignments target_assignment
       where target_assignment.employee_id = payroll_adjustments.employee_id
         and app_private.current_user_can_access_store(target_assignment.store_id)
         and (target_assignment.valid_to is null or target_assignment.valid_to >= current_date)
    )
  );
