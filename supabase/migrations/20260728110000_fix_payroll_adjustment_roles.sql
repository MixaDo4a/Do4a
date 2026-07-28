drop policy if exists "payroll_adjustments_select_related" on public.payroll_adjustments;
drop policy if exists "payroll_adjustments_manager_insert" on public.payroll_adjustments;
drop policy if exists "payroll_adjustments_warehouse_select" on public.payroll_adjustments;
drop policy if exists "payroll_adjustments_warehouse_insert" on public.payroll_adjustments;

create policy "payroll_adjustments_select_related"
  on public.payroll_adjustments
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
        or app_private.current_user_has_role('warehouse_manager')
      )
      and exists (
        select 1
        from public.employee_store_assignments target_assignment
        where target_assignment.employee_id = payroll_adjustments.employee_id
          and app_private.current_user_can_access_store(target_assignment.store_id)
          and target_assignment.valid_from <= current_date
          and (target_assignment.valid_to is null or target_assignment.valid_to >= current_date)
      )
    )
  );

create policy "payroll_adjustments_admin_insert"
  on public.payroll_adjustments
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and exists (
        select 1
        from public.employee_store_assignments target_assignment
        where target_assignment.employee_id = payroll_adjustments.employee_id
          and app_private.current_user_can_access_store(target_assignment.store_id)
          and target_assignment.valid_from <= current_date
          and (target_assignment.valid_to is null or target_assignment.valid_to >= current_date)
      )
    )
  );

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
        and target_assignment.valid_from <= current_date
        and (target_assignment.valid_to is null or target_assignment.valid_to >= current_date)
    )
  );
