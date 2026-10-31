alter table public.store_daily_historical_analytics
  add column nonzero_turnover_shifts integer not null default 0;

alter table public.store_daily_historical_analytics
  add constraint store_daily_historical_analytics_nonnegative_shift_count
  check (nonzero_turnover_shifts >= 0);
