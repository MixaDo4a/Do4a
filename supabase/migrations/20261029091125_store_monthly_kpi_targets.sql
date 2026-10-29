alter table public.store_sales_plans
  add column average_check_target numeric(20,2),
  add column check_depth_target numeric(10,2),
  add constraint store_sales_plans_average_check_target_positive
    check (average_check_target is null or average_check_target > 0),
  add constraint store_sales_plans_check_depth_target_positive
    check (check_depth_target is null or check_depth_target > 0);
