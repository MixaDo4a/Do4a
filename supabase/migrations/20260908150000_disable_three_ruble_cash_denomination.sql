update public.cash_denominations
set is_active = false,
    updated_at = now()
where value = 3;
