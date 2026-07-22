alter type public.user_role_code add value if not exists 'buyer' after 'store_manager';

do $$
begin
  if not exists (select 1 from pg_type where typname = 'purchase_order_status') then
    create type public.purchase_order_status as enum ('expected', 'in_work', 'accepted', 'problem');
  end if;
end $$;

insert into public.roles (code, name, description)
values
  ('buyer', 'Закупщик', 'Создаёт заказы поставщикам и акции поставщиков'),
  ('warehouse_manager', 'Кладовщик', 'Обрабатывает складские задачи, вычеты и приёмку заказов'),
  ('warehouse_assistant', 'Помощник кладовщика', 'Выполняет задачи кладовщика')
on conflict (code) do update
set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

create or replace function app_private.role_rank(p_role public.user_role_code)
returns integer
language sql
immutable
set search_path = public, app_private
as $$
  select case p_role::text
    when 'developer' then 0
    when 'super_admin' then 1
    when 'store_manager' then 2
    when 'buyer' then 3
    when 'warehouse_manager' then 4
    when 'auditor' then 5
    when 'warehouse_assistant' then 6
    when 'manager' then 7
    else 99
  end;
$$;

revoke all on function app_private.role_rank(public.user_role_code) from public;
grant execute on function app_private.role_rank(public.user_role_code) to authenticated;

create or replace function app_private.current_user_can_access_profile_role(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select
    p_profile_id = (select auth.uid())
    or app_private.current_user_has_role('developer')
    or exists (
      select 1
      from public.profiles target_profile
      join public.employees target_employee on target_employee.id = target_profile.employee_id
      where target_profile.id = p_profile_id
        and target_employee.is_active = true
        and exists (
          select 1
          from public.employee_store_assignments target_assignment
          where target_assignment.employee_id = target_employee.id
            and target_assignment.valid_from <= current_date
            and (target_assignment.valid_to is null or target_assignment.valid_to >= current_date)
            and app_private.current_user_can_access_store(target_assignment.store_id)
        )
    );
$$;

revoke all on function app_private.current_user_can_access_profile_role(uuid) from public;
grant execute on function app_private.current_user_can_access_profile_role(uuid) to authenticated;

drop policy if exists "user_roles_select_related" on public.user_roles;
create policy "user_roles_select_related"
  on public.user_roles
  for select
  to authenticated
  using (app_private.current_user_can_access_profile_role(profile_id));

drop policy if exists "user_roles_super_admin_all" on public.user_roles;
drop policy if exists "user_roles_admin_manage_scoped" on public.user_roles;
create policy "user_roles_admin_manage_scoped"
  on public.user_roles
  for all
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and app_private.current_user_can_access_profile_role(profile_id)
    )
  )
  with check (
    app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and app_private.current_user_can_access_profile_role(profile_id)
    )
  );

drop policy if exists "employee_store_assignments_manager_manage" on public.employee_store_assignments;
drop policy if exists "employee_store_assignments_admin_manage_scoped" on public.employee_store_assignments;
create policy "employee_store_assignments_admin_manage_scoped"
  on public.employee_store_assignments
  for all
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and app_private.current_user_can_access_store(store_id)
    )
  );

create or replace function app_private.admin_set_employee_role(
  p_employee_id uuid,
  p_role_code public.user_role_code
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_profile_id uuid;
  v_role_id uuid;
  v_actor_role public.user_role_code;
  v_actor_rank integer;
  v_target_rank integer;
begin
  if not (
    app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  ) then
    raise exception 'Not allowed';
  end if;

  if p_employee_id is null or p_role_code is null then
    raise exception 'Missing role data';
  end if;

  select r.code
    into v_actor_role
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
   where ur.profile_id = (select auth.uid())
     and ur.revoked_at is null
   order by app_private.role_rank(r.code)
   limit 1;

  if v_actor_role is null then
    raise exception 'Actor role not found';
  end if;

  v_actor_rank := app_private.role_rank(v_actor_role);
  v_target_rank := app_private.role_rank(p_role_code);

  if v_target_rank < v_actor_rank then
    raise exception 'Cannot assign role above your own level';
  end if;

  select p.id
    into v_profile_id
    from public.profiles p
   where p.employee_id = p_employee_id;

  if v_profile_id is null then
    raise exception 'Profile not found for employee';
  end if;

  select r.id
    into v_role_id
    from public.roles r
   where r.code = p_role_code;

  if v_role_id is null then
    raise exception 'Role not found';
  end if;

  update public.user_roles
     set revoked_at = now(),
         updated_at = now()
   where profile_id = v_profile_id
     and revoked_at is null;

  insert into public.user_roles (
    profile_id,
    role_id,
    assigned_by
  )
  values (
    v_profile_id,
    v_role_id,
    (select auth.uid())
  );
end;
$$;

revoke all on function app_private.admin_set_employee_role(uuid, public.user_role_code) from public;
grant execute on function app_private.admin_set_employee_role(uuid, public.user_role_code) to authenticated;

create or replace function public.admin_set_employee_role(
  p_employee_id uuid,
  p_role_code public.user_role_code
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  perform app_private.admin_set_employee_role(p_employee_id, p_role_code);
end;
$$;

revoke all on function public.admin_set_employee_role(uuid, public.user_role_code) from public;
grant execute on function public.admin_set_employee_role(uuid, public.user_role_code) to authenticated;

create or replace function app_private.admin_replace_employee_store_assignments(
  p_employee_id uuid,
  p_store_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, app_private, auth, extensions
as $$
begin
  if not (
    app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  ) then
    raise exception 'Not allowed';
  end if;

  if p_employee_id is null then
    raise exception 'Missing employee id';
  end if;

  if p_store_ids is null or coalesce(array_length(p_store_ids, 1), 0) = 0 then
    raise exception 'Missing store assignments';
  end if;

  if exists (
    select 1
    from unnest(p_store_ids) as s(store_id)
    where not (
      app_private.current_user_has_role('developer')
      or app_private.current_user_can_access_store(s.store_id)
    )
  ) then
    raise exception 'Можно назначить только доступные вам магазины.';
  end if;

  delete from public.employee_store_assignments
   where employee_id = p_employee_id;

  insert into public.employee_store_assignments (
    employee_id,
    store_id,
    valid_from,
    is_primary,
    created_by,
    updated_by
  )
  select
    p_employee_id,
    s.store_id,
    current_date,
    s.ord = 1,
    auth.uid(),
    auth.uid()
  from unnest(p_store_ids) with ordinality as s(store_id, ord);
end;
$$;

revoke all on function app_private.admin_replace_employee_store_assignments(uuid, uuid[]) from public;
grant execute on function app_private.admin_replace_employee_store_assignments(uuid, uuid[]) to authenticated;

create or replace function public.admin_replace_employee_store_assignments(
  p_employee_id uuid,
  p_store_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, app_private, auth, extensions
as $$
begin
  perform app_private.admin_replace_employee_store_assignments(p_employee_id, p_store_ids);
end;
$$;

revoke all on function public.admin_replace_employee_store_assignments(uuid, uuid[]) from public;
grant execute on function public.admin_replace_employee_store_assignments(uuid, uuid[]) to authenticated;

drop policy if exists "schedules_manager_manage" on public.schedules;
create policy "schedules_manager_manage"
  on public.schedules
  for all
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('developer')
    or (
      (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and app_private.current_user_can_access_store(store_id)
    )
  );

create or replace function app_private.notify_store_managers(
  p_store_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_store_city text;
  v_count integer := 0;
begin
  select s.city into v_store_city
  from public.stores s
  where s.id = p_store_id;

  insert into public.notifications (
    recipient_profile_id,
    event_type,
    title,
    body,
    related_entity_type,
    related_entity_id
  )
  select distinct p.id,
    p_event_type,
    p_title,
    p_body,
    p_related_entity_type,
    p_related_entity_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.profiles p on p.id = ur.profile_id
  left join public.employees e on e.id = p.employee_id
  where ur.revoked_at is null
    and p.is_blocked = false
    and r.code in ('super_admin', 'store_manager', 'developer')
    and (
      r.code = 'developer'
      or ur.scope_store_id = p_store_id
      or (ur.scope_city is not null and ur.scope_city = v_store_city)
      or exists (
        select 1
        from public.employee_store_assignments esa
        where esa.employee_id = e.id
          and esa.store_id = p_store_id
          and esa.valid_from <= current_date
          and (esa.valid_to is null or esa.valid_to >= current_date)
      )
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function app_private.notify_store_managers(uuid, text, text, text, text, uuid) to authenticated;

create or replace function public.send_city_warehouse_managers_notification(
  p_city text,
  p_event_type text,
  p_title text,
  p_body text,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_count integer := 0;
begin
  insert into public.notifications (
    recipient_profile_id,
    event_type,
    title,
    body,
    related_entity_type,
    related_entity_id
  )
  select distinct p.id,
    p_event_type,
    p_title,
    p_body,
    p_related_entity_type,
    p_related_entity_id
  from public.profiles p
  join public.employees e on e.id = p.employee_id
  join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
  join public.roles r on r.id = ur.role_id
  where p.is_blocked = false
    and e.is_active = true
    and r.code = 'warehouse_manager'
    and lower(btrim(e.city)) = lower(btrim(p_city));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.send_city_warehouse_managers_notification(text, text, text, text, text, uuid) from public;
grant execute on function public.send_city_warehouse_managers_notification(text, text, text, text, text, uuid) to authenticated;

create table if not exists public.supplier_promotions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_name text not null,
  product_name text not null,
  promotion_terms text not null,
  starts_on date,
  ends_on date,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists supplier_promotions_store_dates_idx
  on public.supplier_promotions (store_id, starts_on, ends_on);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  supplier_name text not null,
  invoice_file_id uuid references public.files(id) on delete set null,
  status public.purchase_order_status not null default 'expected',
  problem_comment text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_problem_comment_check check (
    status <> 'problem' or coalesce(btrim(problem_comment), '') <> ''
  )
);

create index if not exists purchase_orders_store_status_idx
  on public.purchase_orders (store_id, status, created_at desc);

create table if not exists public.purchase_order_problem_files (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create unique index if not exists purchase_order_problem_files_unique
  on public.purchase_order_problem_files (purchase_order_id, file_id);

alter table public.supplier_promotions enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_problem_files enable row level security;

grant select, insert, update, delete on table public.supplier_promotions to authenticated;
grant select, insert, update, delete on table public.purchase_orders to authenticated;
grant select, insert, update, delete on table public.purchase_order_problem_files to authenticated;

drop policy if exists "supplier_promotions_select_accessible" on public.supplier_promotions;
create policy "supplier_promotions_select_accessible"
  on public.supplier_promotions
  for select
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "supplier_promotions_manage_procurement" on public.supplier_promotions;
create policy "supplier_promotions_manage_procurement"
  on public.supplier_promotions
  for all
  to authenticated
  using (
    (
      app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('buyer')
    )
    and app_private.current_user_can_access_store(store_id)
  )
  with check (
    (
      app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('buyer')
    )
    and app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "purchase_orders_select_accessible" on public.purchase_orders;
create policy "purchase_orders_select_accessible"
  on public.purchase_orders
  for select
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "purchase_orders_insert_buyer" on public.purchase_orders;
create policy "purchase_orders_insert_buyer"
  on public.purchase_orders
  for insert
  to authenticated
  with check (
    (
      app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('buyer')
    )
    and app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "purchase_orders_update_procurement" on public.purchase_orders;
create policy "purchase_orders_update_procurement"
  on public.purchase_orders
  for update
  to authenticated
  using (
    (
      app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('buyer')
      or app_private.current_user_has_role('warehouse_manager')
    )
    and app_private.current_user_can_access_store(store_id)
  )
  with check (
    (
      app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('buyer')
      or app_private.current_user_has_role('warehouse_manager')
    )
    and app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "purchase_order_problem_files_select_accessible" on public.purchase_order_problem_files;
create policy "purchase_order_problem_files_select_accessible"
  on public.purchase_order_problem_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_id
        and (
          app_private.current_user_has_role('developer')
          or app_private.current_user_can_access_store(po.store_id)
        )
    )
  );

drop policy if exists "purchase_order_problem_files_insert_accessible" on public.purchase_order_problem_files;
create policy "purchase_order_problem_files_insert_accessible"
  on public.purchase_order_problem_files
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.purchase_orders po
      where po.id = purchase_order_id
        and (
          app_private.current_user_has_role('developer')
          or app_private.current_user_can_access_store(po.store_id)
        )
    )
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'procurement-files',
  'procurement-files',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do update
set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "procurement_files_select" on storage.objects;
create policy "procurement_files_select"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'procurement-files');

drop policy if exists "procurement_files_insert" on storage.objects;
create policy "procurement_files_insert"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'procurement-files');

drop policy if exists "files_procurement_select" on public.files;
create policy "files_procurement_select"
  on public.files
  for select
  to authenticated
  using (
    bucket = 'procurement-files'
    and (
      uploaded_by = (select auth.uid())
      or app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('buyer')
      or app_private.current_user_has_role('warehouse_manager')
    )
  );

drop policy if exists "files_procurement_update_own" on public.files;
create policy "files_procurement_update_own"
  on public.files
  for update
  to authenticated
  using (bucket = 'procurement-files' and uploaded_by = (select auth.uid()))
  with check (bucket = 'procurement-files' and uploaded_by = (select auth.uid()));
