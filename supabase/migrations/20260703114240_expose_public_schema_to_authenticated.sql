-- Supabase Data API requires SQL privileges in addition to RLS policies.
-- Keep grants narrow; RLS remains the authorization boundary for rows.

grant usage on schema public to authenticated;

grant select on table
  public.stores,
  public.employees,
  public.profiles,
  public.roles,
  public.user_roles,
  public.employee_store_assignments,
  public.shifts,
  public.shift_participants,
  public.cash_denominations,
  public.tasks
to authenticated;

grant insert, update on table
  public.shifts,
  public.shift_participants,
  public.shift_closing_reports,
  public.shift_cash_counts,
  public.employee_advances,
  public.sales_metrics,
  public.shift_snapshots,
  public.audit_log
to authenticated;

grant delete on table
  public.shift_cash_counts
to authenticated;

grant execute on function public.calculate_check_depth(integer, integer) to authenticated;
grant execute on function public.calculate_average_check_amount(numeric, integer) to authenticated;
grant execute on function public.calculate_shift_sales_pay(numeric, public.shift_participant_role) to authenticated;
grant execute on function public.calculate_shift_snapshot_data(uuid) to authenticated;
grant execute on function public.close_shift(uuid, numeric, numeric, numeric, numeric, integer, integer, numeric, text, numeric, jsonb) to authenticated;
