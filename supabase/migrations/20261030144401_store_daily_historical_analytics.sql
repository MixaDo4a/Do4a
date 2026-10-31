create table public.store_daily_historical_analytics (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  sales_date date not null,
  revenue_amount numeric(20, 2) not null default 0,
  returns_amount numeric(20, 2) not null default 0,
  receipt_count integer not null default 0,
  items_sold_count integer not null default 0,
  source_sheet text not null,
  source_spreadsheet_id text not null,
  imported_at timestamptz not null default now(),
  constraint store_daily_historical_analytics_nonnegative_counts check (receipt_count >= 0 and items_sold_count >= 0),
  constraint store_daily_historical_analytics_store_date_unique unique (store_id, sales_date)
);

create index store_daily_historical_analytics_date_store_idx
  on public.store_daily_historical_analytics (sales_date, store_id);

alter table public.store_daily_historical_analytics enable row level security;

create policy store_daily_historical_analytics_select_accessible
  on public.store_daily_historical_analytics
  for select
  to authenticated
  using (
    app_private.current_user_can_access_store(store_id)
    or app_private.current_user_has_role('super_admin'::user_role_code)
    or app_private.current_user_has_role('developer'::user_role_code)
  );

grant select on public.store_daily_historical_analytics to authenticated;
