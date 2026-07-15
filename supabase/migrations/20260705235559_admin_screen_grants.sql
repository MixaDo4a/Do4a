-- SQL privileges for admin screens.
-- RLS policies still decide which rows and actions are allowed.

grant select on table
  public.schedules,
  public.store_sales_plans,
  public.payroll_adjustments
to authenticated;

grant insert, update on table
  public.stores,
  public.employees,
  public.employee_store_assignments,
  public.schedules,
  public.store_sales_plans,
  public.payroll_adjustments
to authenticated;

grant delete on table
  public.employee_store_assignments
to authenticated;
