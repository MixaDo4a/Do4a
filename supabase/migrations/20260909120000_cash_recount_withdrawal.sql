alter table public.store_cash_counts
  add column if not exists counted_amount numeric(20,2);

update public.store_cash_counts
   set counted_amount = cash_amount
 where counted_amount is null;

alter table public.store_cash_counts
  alter column counted_amount set not null,
  add column if not exists withdrawal_amount numeric(20,2) not null default 0,
  add column if not exists withdrawal_comment text;

alter table public.store_cash_counts
  drop constraint if exists store_cash_counts_withdrawal_amount_check,
  add constraint store_cash_counts_withdrawal_amount_check check (withdrawal_amount >= 0 and withdrawal_amount <= counted_amount);

create index if not exists store_cash_counts_shift_created_idx
  on public.store_cash_counts (shift_id, created_at desc);
