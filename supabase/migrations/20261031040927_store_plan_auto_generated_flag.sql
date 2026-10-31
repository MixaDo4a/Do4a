alter table public.store_sales_plans
  add column if not exists is_auto_generated boolean not null default false;
