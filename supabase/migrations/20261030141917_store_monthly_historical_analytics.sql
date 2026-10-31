create table public.store_monthly_historical_analytics (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_start date not null,
  revenue_amount numeric(20, 2) not null default 0,
  returns_amount numeric(20, 2) not null default 0,
  receipt_count integer not null default 0,
  items_sold_count integer,
  active_days integer not null default 0,
  missing_revenue_days integer not null default 0,
  missing_receipt_days integer not null default 0,
  missing_item_days integer not null default 0,
  seasonality_coefficient numeric(12, 6),
  seasonality_baseline numeric(20, 2),
  seasonality_reference_year smallint,
  source_sheet text not null,
  source_spreadsheet_id text not null,
  imported_at timestamptz not null default now(),
  constraint store_monthly_historical_analytics_period_first_day check (extract(day from period_start) = 1),
  constraint store_monthly_historical_analytics_nonnegative_counts check (
    receipt_count >= 0 and active_days >= 0 and missing_revenue_days >= 0
    and missing_receipt_days >= 0 and missing_item_days >= 0
  ),
  constraint store_monthly_historical_analytics_store_period_unique unique (store_id, period_start)
);

create index store_monthly_historical_analytics_store_period_idx
  on public.store_monthly_historical_analytics (store_id, period_start desc);

alter table public.store_monthly_historical_analytics enable row level security;

create policy store_monthly_historical_analytics_select_accessible
  on public.store_monthly_historical_analytics
  for select
  to authenticated
  using (
    app_private.current_user_can_access_store(store_id)
    or app_private.current_user_has_role('super_admin'::user_role_code)
    or app_private.current_user_has_role('developer'::user_role_code)
  );

grant select on public.store_monthly_historical_analytics to authenticated;
