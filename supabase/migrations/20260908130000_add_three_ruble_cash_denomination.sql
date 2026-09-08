insert into public.cash_denominations (value, kind, is_active)
select 3, 'coin'::cash_denomination_kind, true
where not exists (
  select 1 from public.cash_denominations where value = 3
);
