-- Initial core schema for Retail Staff Management System.
-- Covers auth profiles, roles, stores, employees, schedules, shifts,
-- shift closing reports, cash counts, files, and audit log.

create extension if not exists pgcrypto;

create schema if not exists app_private;

do $$
begin
  create type public.user_role_code as enum (
    'manager',
    'auditor',
    'store_manager',
    'super_admin',
    'developer'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.employee_status as enum (
    'padawan',
    'experienced'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.store_status as enum (
    'active',
    'archived'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.schedule_status as enum (
    'planned',
    'cancelled',
    'day_off',
    'vacation',
    'sick_leave'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.shift_status as enum (
    'planned',
    'opened',
    'closed',
    'auto_closed',
    'cancelled',
    'correction_required'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.shift_source as enum (
    'schedule',
    'manual_open'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.shift_participant_role as enum (
    'primary_seller',
    'secondary_seller'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.cash_denomination_kind as enum (
    'banknote',
    'coin',
    'bag'
  );
exception
  when duplicate_object then null;
end $$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.stores (
  id uuid primary key default gen_random_uuid(),
  city text not null,
  name text not null,
  address text,
  timezone text not null default 'Asia/Vladivostok',
  workday_start_time time,
  workday_end_time time,
  status public.store_status not null default 'active',
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint stores_archived_at_check check (
    (status = 'archived' and archived_at is not null)
    or (status <> 'archived')
  )
);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  telegram_user_id bigint,
  telegram_username text,
  email text,
  city text,
  primary_store_id uuid references public.stores(id),
  employee_status public.employee_status not null default 'padawan',
  hired_at date not null,
  terminated_at date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint employees_terminated_check check (
    (is_active = false and terminated_at is not null)
    or (is_active = true)
  )
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  employee_id uuid unique references public.employees(id),
  telegram_user_id bigint unique,
  telegram_username text,
  email text,
  full_name text not null,
  is_blocked boolean not null default false,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code public.user_role_code not null unique,
  name text not null,
  description text,
  is_system boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.roles (code, name, description)
values
  ('manager', 'Менеджер', 'Сотрудник магазина'),
  ('auditor', 'Проверяющий', 'Проводит проверки и чек-листы'),
  ('store_manager', 'Управляющий', 'Управляет магазинами, сотрудниками, графиком и задачами'),
  ('super_admin', 'Супер-администратор', 'Полный доступ к системе'),
  ('developer', 'Разработчик', 'Техническая роль с контролируемым доступом')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role_id uuid not null references public.roles(id),
  scope_store_id uuid references public.stores(id),
  scope_city text,
  assigned_by uuid references public.profiles(id),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_roles_scope_check check (
    scope_store_id is null or scope_city is null
  )
);

create unique index if not exists user_roles_active_unique
  on public.user_roles (profile_id, role_id, coalesce(scope_store_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(scope_city, ''))
  where revoked_at is null;

create table if not exists public.employee_store_assignments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  valid_from date not null,
  valid_to date,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint employee_store_assignments_dates_check check (
    valid_to is null or valid_to >= valid_from
  )
);

create index if not exists employee_store_assignments_employee_idx
  on public.employee_store_assignments (employee_id, valid_from, valid_to);

create index if not exists employee_store_assignments_store_idx
  on public.employee_store_assignments (store_id, valid_from, valid_to);

create table if not exists public.store_sales_plans (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  sales_plan_amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint store_sales_plans_period_check check (period_end >= period_start),
  constraint store_sales_plans_amount_check check (sales_plan_amount >= 0)
);

create unique index if not exists store_sales_plans_store_period_unique
  on public.store_sales_plans (store_id, period_start, period_end);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  employee_id uuid not null references public.employees(id),
  shift_date date not null,
  planned_start_at timestamptz not null,
  planned_end_at timestamptz not null,
  status public.schedule_status not null default 'planned',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint schedules_time_check check (planned_end_at > planned_start_at)
);

create index if not exists schedules_store_date_idx
  on public.schedules (store_id, shift_date);

create index if not exists schedules_employee_date_idx
  on public.schedules (employee_id, shift_date);

create table if not exists public.shifts (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.schedules(id),
  store_id uuid not null references public.stores(id),
  shift_date date not null,
  status public.shift_status not null default 'opened',
  source public.shift_source not null,
  opened_by_employee_id uuid not null references public.employees(id),
  opened_at timestamptz not null default now(),
  closed_by_employee_id uuid references public.employees(id),
  closed_at timestamptz,
  auto_closed_at timestamptz,
  requires_review boolean not null default false,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint shifts_close_time_check check (
    closed_at is null or closed_at >= opened_at
  ),
  constraint shifts_auto_closed_review_check check (
    (status <> 'auto_closed')
    or (auto_closed_at is not null and requires_review = true)
  )
);

create index if not exists shifts_store_date_idx
  on public.shifts (store_id, shift_date);

create index if not exists shifts_opened_by_idx
  on public.shifts (opened_by_employee_id, shift_date);

create index if not exists shifts_requires_review_idx
  on public.shifts (requires_review)
  where requires_review = true;

create table if not exists public.shift_participants (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  participant_role public.shift_participant_role not null,
  sales_percent numeric(6,4) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_participants_percent_check check (
    (participant_role = 'primary_seller' and sales_percent = 0.0200)
    or (participant_role = 'secondary_seller' and sales_percent = 0.0100)
  )
);

create unique index if not exists shift_participants_one_primary
  on public.shift_participants (shift_id)
  where participant_role = 'primary_seller';

create unique index if not exists shift_participants_one_secondary
  on public.shift_participants (shift_id)
  where participant_role = 'secondary_seller';

create unique index if not exists shift_participants_employee_unique
  on public.shift_participants (shift_id, employee_id);

create table if not exists public.shift_closing_reports (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null unique references public.shifts(id) on delete cascade,
  cash_revenue numeric(12,2) not null default 0,
  card_revenue numeric(12,2) not null default 0,
  cash_returns numeric(12,2) not null default 0,
  card_returns numeric(12,2) not null default 0,
  receipt_count integer not null default 0,
  items_sold_count integer,
  gross_revenue numeric(12,2) not null default 0,
  net_revenue numeric(12,2) not null default 0,
  cash_collection_amount numeric(12,2),
  cash_collection_comment text,
  check_depth numeric(10,2),
  advance_amount numeric(12,2),
  created_by_employee_id uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint shift_closing_reports_non_negative_check check (
    cash_revenue >= 0
    and card_revenue >= 0
    and cash_returns >= 0
    and card_returns >= 0
    and receipt_count >= 0
    and (items_sold_count is null or items_sold_count >= 0)
    and gross_revenue >= 0
    and net_revenue >= 0
    and (cash_collection_amount is null or cash_collection_amount >= 0)
    and (advance_amount is null or advance_amount >= 0)
  ),
  constraint shift_closing_reports_collection_comment_check check (
    cash_collection_amount is null
    or cash_collection_amount = 0
    or nullif(btrim(cash_collection_comment), '') is not null
  )
);

create table if not exists public.cash_denominations (
  id uuid primary key default gen_random_uuid(),
  value numeric(10,2) not null,
  kind public.cash_denomination_kind not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint cash_denominations_value_check check (value > 0)
);

create unique index if not exists cash_denominations_value_kind_unique
  on public.cash_denominations (value, kind);

insert into public.cash_denominations (value, kind)
values
  (5000, 'banknote'),
  (2000, 'banknote'),
  (1000, 'banknote'),
  (500, 'banknote'),
  (200, 'banknote'),
  (100, 'banknote'),
  (50, 'banknote'),
  (10, 'coin'),
  (5, 'coin'),
  (2, 'coin'),
  (1, 'coin'),
  (0.50, 'coin'),
  (0.10, 'coin')
on conflict (value, kind) do nothing;

create table if not exists public.shift_cash_counts (
  id uuid primary key default gen_random_uuid(),
  shift_closing_report_id uuid not null references public.shift_closing_reports(id) on delete cascade,
  denomination_id uuid not null references public.cash_denominations(id),
  quantity integer not null default 0,
  line_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_cash_counts_quantity_check check (quantity >= 0),
  constraint shift_cash_counts_line_amount_check check (line_amount >= 0)
);

create unique index if not exists shift_cash_counts_report_denomination_unique
  on public.shift_cash_counts (shift_closing_report_id, denomination_id);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  path text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by uuid references auth.users(id),
  related_entity_type text,
  related_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint files_size_check check (size_bytes is null or size_bytes >= 0)
);

create unique index if not exists files_bucket_path_unique
  on public.files (bucket, path);

create table if not exists public.cash_report_files (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists cash_report_files_shift_file_unique
  on public.cash_report_files (shift_id, file_id);

create table if not exists public.shift_snapshots (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  snapshot_version integer not null default 1,
  data jsonb not null,
  data_quality text not null,
  created_at timestamptz not null default now(),
  constraint shift_snapshots_version_check check (snapshot_version > 0),
  constraint shift_snapshots_data_quality_check check (
    data_quality in ('complete', 'auto_closed_requires_review', 'corrected')
  )
);

create index if not exists shift_snapshots_shift_idx
  on public.shift_snapshots (shift_id, created_at desc);

create table if not exists public.shift_corrections (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  correction_type text not null,
  reason text not null,
  before_data jsonb not null,
  after_data jsonb not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_data jsonb,
  after_data jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx
  on public.audit_log (entity_type, entity_id, created_at desc);

create index if not exists audit_log_actor_idx
  on public.audit_log (actor_profile_id, created_at desc);

create table if not exists public.developer_access_log (
  id uuid primary key default gen_random_uuid(),
  developer_profile_id uuid references public.profiles(id),
  action text not null,
  reason text not null,
  target_entity_type text,
  target_entity_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_before_data jsonb default null,
  p_after_data jsonb default null,
  p_reason text default null
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.audit_log (
    actor_profile_id,
    action,
    entity_type,
    entity_id,
    before_data,
    after_data,
    reason
  )
  values (
    (select p.id from public.profiles p where p.id = (select auth.uid())),
    p_action,
    p_entity_type,
    p_entity_id,
    p_before_data,
    p_after_data,
    p_reason
  );
end;
$$;

create or replace function app_private.current_user_has_role(p_role public.user_role_code)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select exists (
    select 1
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.profile_id
    where ur.profile_id = (select auth.uid())
      and ur.revoked_at is null
      and r.code = p_role
      and p.is_blocked = false
  );
$$;

create or replace function app_private.current_user_employee_id()
returns uuid
language sql
stable
security definer
set search_path = public, app_private
as $$
  select p.employee_id
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_blocked = false;
$$;

create or replace function app_private.current_user_can_access_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select
    app_private.current_user_has_role('super_admin')
    or exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      join public.profiles p on p.id = ur.profile_id
      left join public.stores s on s.id = p_store_id
      where ur.profile_id = (select auth.uid())
        and ur.revoked_at is null
        and p.is_blocked = false
        and r.code in ('store_manager', 'auditor', 'developer')
        and (
          ur.scope_store_id = p_store_id
          or (ur.scope_store_id is null and ur.scope_city is null)
          or (ur.scope_city is not null and ur.scope_city = s.city)
        )
    )
    or exists (
      select 1
      from public.employee_store_assignments esa
      where esa.employee_id = app_private.current_user_employee_id()
        and esa.store_id = p_store_id
        and esa.valid_from <= current_date
        and (esa.valid_to is null or esa.valid_to >= current_date)
    );
$$;

revoke all on function app_private.current_user_has_role(public.user_role_code) from public;
revoke all on function app_private.current_user_employee_id() from public;
revoke all on function app_private.current_user_can_access_store(uuid) from public;
grant execute on function app_private.current_user_has_role(public.user_role_code) to authenticated;
grant execute on function app_private.current_user_employee_id() to authenticated;
grant execute on function app_private.current_user_can_access_store(uuid) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'stores',
    'employees',
    'profiles',
    'roles',
    'user_roles',
    'employee_store_assignments',
    'store_sales_plans',
    'schedules',
    'shifts',
    'shift_participants',
    'shift_closing_reports',
    'cash_denominations',
    'shift_cash_counts',
    'files',
    'cash_report_files',
    'shift_snapshots',
    'shift_corrections',
    'audit_log',
    'developer_access_log'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'stores',
    'employees',
    'profiles',
    'roles',
    'user_roles',
    'employee_store_assignments',
    'store_sales_plans',
    'schedules',
    'shifts',
    'shift_participants',
    'shift_closing_reports',
    'cash_denominations',
    'shift_cash_counts',
    'files'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

create policy "profiles_select_self_or_admin"
  on public.profiles
  for select
  to authenticated
  using (
    id = (select auth.uid())
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "profiles_update_self_limited"
  on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "profiles_admin_all"
  on public.profiles
  for all
  to authenticated
  using (app_private.current_user_has_role('super_admin'))
  with check (app_private.current_user_has_role('super_admin'));

create policy "roles_select_authenticated"
  on public.roles
  for select
  to authenticated
  using (true);

create policy "roles_admin_all"
  on public.roles
  for all
  to authenticated
  using (app_private.current_user_has_role('super_admin'))
  with check (app_private.current_user_has_role('super_admin'));

create policy "user_roles_select_related"
  on public.user_roles
  for select
  to authenticated
  using (
    profile_id = (select auth.uid())
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "user_roles_super_admin_all"
  on public.user_roles
  for all
  to authenticated
  using (app_private.current_user_has_role('super_admin'))
  with check (app_private.current_user_has_role('super_admin'));

create policy "stores_select_accessible"
  on public.stores
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_can_access_store(id)
  );

create policy "stores_admin_manage"
  on public.stores
  for all
  to authenticated
  using (app_private.current_user_has_role('super_admin'))
  with check (app_private.current_user_has_role('super_admin'));

create policy "employees_select_accessible"
  on public.employees
  for select
  to authenticated
  using (
    id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or (
      primary_store_id is not null
      and app_private.current_user_can_access_store(primary_store_id)
    )
  );

create policy "employees_store_manager_insert_manager"
  on public.employees
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "employees_store_manager_update_accessible"
  on public.employees
  for update
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or (
      primary_store_id is not null
      and app_private.current_user_can_access_store(primary_store_id)
      and app_private.current_user_has_role('store_manager')
    )
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      primary_store_id is not null
      and app_private.current_user_can_access_store(primary_store_id)
      and app_private.current_user_has_role('store_manager')
    )
  );

create policy "employee_store_assignments_select_accessible"
  on public.employee_store_assignments
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_can_access_store(store_id)
  );

create policy "employee_store_assignments_manager_manage"
  on public.employee_store_assignments
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "store_sales_plans_select_accessible"
  on public.store_sales_plans
  for select
  to authenticated
  using (app_private.current_user_can_access_store(store_id));

create policy "store_sales_plans_manager_manage"
  on public.store_sales_plans
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "schedules_select_related"
  on public.schedules
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_can_access_store(store_id)
  );

create policy "schedules_manager_manage"
  on public.schedules
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "shifts_select_related"
  on public.shifts
  for select
  to authenticated
  using (
    opened_by_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_can_access_store(store_id)
  );

create policy "shifts_manager_open"
  on public.shifts
  for insert
  to authenticated
  with check (
    opened_by_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "shifts_primary_or_admin_update"
  on public.shifts
  for update
  to authenticated
  using (
    opened_by_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    opened_by_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "shift_participants_select_related"
  on public.shift_participants
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and app_private.current_user_can_access_store(s.store_id)
    )
  );

create policy "shift_participants_manage_related_shift"
  on public.shift_participants
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
          or (
            app_private.current_user_has_role('store_manager')
            and app_private.current_user_can_access_store(s.store_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
          or (
            app_private.current_user_has_role('store_manager')
            and app_private.current_user_can_access_store(s.store_id)
          )
        )
    )
  );

create policy "shift_closing_reports_select_related"
  on public.shift_closing_reports
  for select
  to authenticated
  using (
    created_by_employee_id = app_private.current_user_employee_id()
    or exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and app_private.current_user_can_access_store(s.store_id)
    )
  );

create policy "shift_closing_reports_primary_insert"
  on public.shift_closing_reports
  for insert
  to authenticated
  with check (
    created_by_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
  );

create policy "shift_closing_reports_primary_or_admin_update"
  on public.shift_closing_reports
  for update
  to authenticated
  using (
    created_by_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
  )
  with check (
    created_by_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
  );

create policy "cash_denominations_select_authenticated"
  on public.cash_denominations
  for select
  to authenticated
  using (true);

create policy "cash_denominations_admin_manage"
  on public.cash_denominations
  for all
  to authenticated
  using (app_private.current_user_has_role('super_admin'))
  with check (app_private.current_user_has_role('super_admin'));

create policy "shift_cash_counts_access_via_report"
  on public.shift_cash_counts
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.shift_closing_reports scr
      where scr.id = shift_closing_report_id
        and (
          scr.created_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
          or exists (
            select 1
            from public.shifts s
            where s.id = scr.shift_id
              and app_private.current_user_can_access_store(s.store_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.shift_closing_reports scr
      where scr.id = shift_closing_report_id
        and (
          scr.created_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
        )
    )
  );

create policy "files_select_related"
  on public.files
  for select
  to authenticated
  using (
    uploaded_by = (select auth.uid())
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('auditor')
  );

create policy "files_insert_authenticated"
  on public.files
  for insert
  to authenticated
  with check (uploaded_by = (select auth.uid()));

create policy "cash_report_files_access_via_shift"
  on public.cash_report_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(s.store_id)
        )
    )
  );

create policy "cash_report_files_insert_related"
  on public.cash_report_files
  for insert
  to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
        )
    )
  );

create policy "shift_snapshots_select_related"
  on public.shift_snapshots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(s.store_id)
        )
    )
  );

create policy "shift_snapshots_admin_insert"
  on public.shift_snapshots
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "shift_corrections_select_related"
  on public.shift_corrections
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and app_private.current_user_can_access_store(s.store_id)
    )
  );

create policy "shift_corrections_super_admin_insert"
  on public.shift_corrections
  for insert
  to authenticated
  with check (app_private.current_user_has_role('super_admin'));

create policy "audit_log_select_admin"
  on public.audit_log
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  );

create policy "audit_log_insert_authenticated"
  on public.audit_log
  for insert
  to authenticated
  with check (actor_profile_id = (select auth.uid()));

create policy "developer_access_log_select_admin"
  on public.developer_access_log
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or developer_profile_id = (select auth.uid())
  );

create policy "developer_access_log_insert_developer"
  on public.developer_access_log
  for insert
  to authenticated
  with check (
    developer_profile_id = (select auth.uid())
    and app_private.current_user_has_role('developer')
  );
