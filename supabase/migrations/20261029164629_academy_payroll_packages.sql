create table public.academy_payroll_packages (
  id bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id),
  period_month date not null check (extract(day from period_month) = 1),
  package_type text not null check (package_type = 'mentorship'),
  amount numeric(12,2) not null check (amount in (3000, 5000)),
  status text not null default 'assigned' check (status in ('assigned', 'confirmed')),
  reason text not null check (length(btrim(reason)) between 4 and 1000),
  assigned_by uuid not null references auth.users(id),
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint academy_payroll_packages_confirmation_check check (
    (status = 'assigned' and confirmed_by is null and confirmed_at is null)
    or (status = 'confirmed' and confirmed_by is not null and confirmed_at is not null)
  ),
  constraint academy_payroll_packages_employee_period_type_unique unique (employee_id, period_month, package_type)
);

create index academy_payroll_packages_month_status_idx
  on public.academy_payroll_packages (period_month, status, employee_id);

create or replace function app_private.guard_academy_mentorship_package_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created_at timestamptz;
  v_timezone text;
  v_rank integer;
begin
  select e.created_at, coalesce(s.timezone, 'Asia/Vladivostok')
    into v_created_at, v_timezone
  from public.employees e
  left join public.stores s on s.id = e.primary_store_id
  where e.id = new.employee_id;
  if not found then raise exception 'Employee not found'; end if;

  select arh.rank into v_rank
  from public.profiles p
  join public.academy_rank_history arh on arh.user_id = p.id
  where p.employee_id = new.employee_id and arh.pay_effective_from <= new.period_month
  order by arh.pay_effective_from desc, arh.confirmed_at desc
  limit 1;
  if v_rank is null then
    v_rank := case when (v_created_at at time zone v_timezone)::date < date '2026-11-01' then 4 else 1 end;
  elsif (v_created_at at time zone v_timezone)::date < date '2026-11-01' then
    v_rank := greatest(v_rank, 4);
  end if;
  if v_rank < 7 then raise exception 'Mentorship package requires Academy level 7 or higher'; end if;
  return new;
end;
$$;

revoke all on function app_private.guard_academy_mentorship_package_level() from public, anon, authenticated;
create trigger academy_payroll_packages_level_guard
before insert or update of employee_id, period_month on public.academy_payroll_packages
for each row execute function app_private.guard_academy_mentorship_package_level();

alter table public.academy_payroll_packages enable row level security;
revoke all on public.academy_payroll_packages from public, anon, authenticated;
grant select, insert on public.academy_payroll_packages to authenticated;
grant usage, select on sequence public.academy_payroll_packages_id_seq to authenticated;

create policy academy_payroll_packages_read
  on public.academy_payroll_packages for select to authenticated
  using (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
    or (
      (select app_private.current_user_has_role('store_manager'))
      and exists (
        select 1
        from public.employees target
        join public.employees actor on actor.id = app_private.current_user_employee_id()
        where target.id = employee_id and target.city = actor.city
      )
    )
  );

create policy academy_payroll_packages_assign
  on public.academy_payroll_packages for insert to authenticated
  with check (
    assigned_by = (select auth.uid())
    and status = 'assigned'
    and confirmed_by is null
    and confirmed_at is null
    and (
      (select app_private.current_user_has_role('super_admin'))
      or (select app_private.current_user_has_role('developer'))
      or (
        (select app_private.current_user_has_role('store_manager'))
        and exists (
          select 1
          from public.employees target
          join public.employees actor on actor.id = app_private.current_user_employee_id()
          where target.id = employee_id and target.city = actor.city
        )
      )
    )
  );

create function public.confirm_academy_payroll_package(p_package_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_package public.academy_payroll_packages%rowtype;
begin
  if (select auth.uid()) is null then raise exception 'Authentication required'; end if;
  select * into v_package
  from public.academy_payroll_packages
  where id = p_package_id
  for update;
  if not found then raise exception 'Package assignment not found'; end if;
  if v_package.status = 'confirmed' then return; end if;
  if not (
    (select app_private.current_user_has_role('super_admin'))
    or (select app_private.current_user_has_role('developer'))
    or (
      (select app_private.current_user_has_role('store_manager'))
      and exists (
        select 1
        from public.employees target
        join public.employees actor on actor.id = app_private.current_user_employee_id()
        where target.id = v_package.employee_id and target.city = actor.city
      )
    )
  ) then raise exception 'Not allowed to confirm this package'; end if;

  update public.academy_payroll_packages
  set status = 'confirmed', confirmed_by = (select auth.uid()), confirmed_at = now(), updated_at = now()
  where id = p_package_id;
end;
$$;

revoke all on function public.confirm_academy_payroll_package(bigint) from public, anon;
grant execute on function public.confirm_academy_payroll_package(bigint) to authenticated;
