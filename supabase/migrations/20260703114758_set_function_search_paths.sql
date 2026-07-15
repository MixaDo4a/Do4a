alter function public.set_updated_at() set search_path = public;

alter function public.calculate_check_depth(integer, integer) set search_path = public;

alter function public.calculate_average_check_amount(numeric, integer) set search_path = public;

alter function public.calculate_checklist_item_result(numeric, integer) set search_path = public;

alter function public.calculate_inventory_amounts(numeric, numeric) set search_path = public;

alter function public.calculate_inventory_employee_amount(numeric, numeric, numeric) set search_path = public;

alter function public.calculate_payroll_total(
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric,
  numeric
) set search_path = public;

alter function public.calculate_shift_sales_pay(numeric, public.shift_participant_role) set search_path = public;
