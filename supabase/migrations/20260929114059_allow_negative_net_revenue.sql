alter table public.shift_closing_reports
  drop constraint if exists shift_closing_reports_non_negative_check;

alter table public.shift_closing_reports
  add constraint shift_closing_reports_non_negative_check check (
    cash_revenue >= 0
    and card_revenue >= 0
    and cash_returns >= 0
    and card_returns >= 0
    and receipt_count >= 0
    and (items_sold_count is null or items_sold_count >= 0)
    and gross_revenue >= 0
    and (cash_collection_amount is null or cash_collection_amount >= 0)
    and (advance_amount is null or advance_amount >= 0)
  );
