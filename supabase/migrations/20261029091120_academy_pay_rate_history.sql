create table public.academy_pay_rates (
  id bigint generated always as identity primary key,
  level smallint not null check (level between 1 and 10),
  effective_from date not null check (extract(day from effective_from) = 1),
  hourly_rate numeric(10,2) not null check (hourly_rate > 0),
  base_commission_percent numeric(5,2) not null check (base_commission_percent between 0 and 100),
  plan_commission_percent numeric(5,2) not null check (
    plan_commission_percent between base_commission_percent and 100
    and (level >= 5 or plan_commission_percent = base_commission_percent)
  ),
  reason text not null check (length(btrim(reason)) >= 4),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index academy_pay_rates_level_effective_idx
  on public.academy_pay_rates (level, effective_from desc, id desc);

alter table public.academy_pay_rates enable row level security;

create policy academy_pay_rates_select_admin
  on public.academy_pay_rates for select to authenticated
  using (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
  );

create policy academy_pay_rates_insert_admin
  on public.academy_pay_rates for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and (
      (select app_private.current_user_has_role('super_admin'))
      or (select app_private.current_user_has_role('developer'))
    )
  );

grant select, insert on public.academy_pay_rates to authenticated;
grant usage, select on sequence public.academy_pay_rates_id_seq to authenticated;

insert into public.academy_pay_rates (
  level, effective_from, hourly_rate, base_commission_percent, plan_commission_percent, reason
)
values
  (1, '2026-11-01', 210, 1.00, 1.00, 'Initial rate grid'),
  (2, '2026-11-01', 240, 1.50, 1.50, 'Initial rate grid'),
  (3, '2026-11-01', 260, 2.00, 2.00, 'Initial rate grid'),
  (4, '2026-11-01', 280, 2.00, 2.00, 'Initial rate grid'),
  (5, '2026-11-01', 300, 2.00, 2.50, 'Initial rate grid'),
  (6, '2026-11-01', 320, 2.00, 2.50, 'Initial rate grid'),
  (7, '2026-11-01', 340, 2.00, 2.50, 'Initial rate grid'),
  (8, '2026-11-01', 360, 2.00, 2.50, 'Initial rate grid'),
  (9, '2026-11-01', 380, 2.00, 2.50, 'Initial rate grid'),
  (10, '2026-11-01', 400, 2.00, 2.50, 'Initial rate grid');
