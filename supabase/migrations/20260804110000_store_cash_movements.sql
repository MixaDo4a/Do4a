create table if not exists public.store_cash_movements (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  movement_type text not null check (movement_type in ('rko', 'pko')),
  amount numeric(20,2) not null check (amount > 0),
  comment text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists store_cash_movements_store_created_idx
  on public.store_cash_movements (store_id, created_at desc);

drop trigger if exists set_store_cash_movements_updated_at on public.store_cash_movements;
create trigger set_store_cash_movements_updated_at
  before update on public.store_cash_movements
  for each row execute function app_private.set_updated_at();

alter table public.store_cash_movements enable row level security;

grant select, insert, update, delete on table public.store_cash_movements to authenticated;

drop policy if exists "store_cash_movements_select_accessible" on public.store_cash_movements;
create policy "store_cash_movements_select_accessible"
  on public.store_cash_movements
  for select
  using (app_private.current_user_can_access_store(store_id));

drop policy if exists "store_cash_movements_manage_accessible" on public.store_cash_movements;
create policy "store_cash_movements_manage_accessible"
  on public.store_cash_movements
  for all
  using (
    app_private.current_user_can_access_store(store_id)
    and (
      app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    )
  )
  with check (
    app_private.current_user_can_access_store(store_id)
    and (
      app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer')
    )
  );
