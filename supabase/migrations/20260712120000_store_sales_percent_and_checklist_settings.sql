alter table public.stores
  add column if not exists sales_share_percent numeric(6,2) not null default 2.00;

alter table public.stores
  drop constraint if exists stores_sales_share_percent_check;

alter table public.stores
  add constraint stores_sales_share_percent_check check (
    sales_share_percent >= 0 and sales_share_percent <= 100
  );

create table if not exists public.store_checklist_item_settings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id) on delete cascade,
  is_enabled boolean not null default true,
  custom_title text,
  weight_padawan numeric(12,2) not null,
  weight_experienced numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint store_checklist_item_settings_weight_check check (
    weight_padawan >= 0 and weight_experienced >= 0
  )
);

alter table public.store_checklist_item_settings
  add column if not exists custom_title text;

create unique index if not exists store_checklist_item_settings_store_item_unique
  on public.store_checklist_item_settings (store_id, item_id);

alter table public.store_checklist_item_settings enable row level security;

grant select, insert, update, delete on table public.store_checklist_item_settings to authenticated;

drop policy if exists "store_checklist_item_settings_select_accessible" on public.store_checklist_item_settings;
create policy "store_checklist_item_settings_select_accessible"
  on public.store_checklist_item_settings
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
    or app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "store_checklist_item_settings_admin_manage" on public.store_checklist_item_settings;
create policy "store_checklist_item_settings_admin_manage"
  on public.store_checklist_item_settings
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  );

create or replace function public.calculate_shift_sales_pay(
  p_store_id uuid,
  p_gross_revenue numeric,
  p_participant_role public.shift_participant_role
)
returns numeric
language sql
stable
set search_path = public
as $$
  select round(
    greatest(coalesce(p_gross_revenue, 0), 0)
    * case
        when p_participant_role = 'primary_seller' then coalesce(s.sales_share_percent, 2.00) / 100
        when p_participant_role = 'secondary_seller' then coalesce(s.sales_share_percent, 2.00) / 200
        else 0
      end,
    2
  )
  from public.stores s
  where s.id = p_store_id;
$$;
