-- Cash movements are an authenticated application surface, never an anonymous one.
alter policy store_cash_movements_manage_accessible
  on public.store_cash_movements to authenticated;
alter policy store_cash_movements_select_accessible
  on public.store_cash_movements to authenticated;
