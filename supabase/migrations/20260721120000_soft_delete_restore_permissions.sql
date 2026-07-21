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
    when 'warehouse_manager' then 3
    when 'auditor' then 4
    when 'warehouse_assistant' then 5
    when 'manager' then 6
    else 99
  end;
$$;

revoke all on function app_private.role_rank(public.user_role_code) from public;
grant execute on function app_private.role_rank(public.user_role_code) to authenticated;

create or replace function app_private.current_user_can_access_store(p_store_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app_private
as $$
  select
    app_private.current_user_has_role('developer')
    or exists (
      select 1
      from public.employee_store_assignments esa
      join public.stores s on s.id = esa.store_id
      where esa.employee_id = app_private.current_user_employee_id()
        and esa.store_id = p_store_id
        and esa.valid_from <= current_date
        and (esa.valid_to is null or esa.valid_to >= current_date)
        and s.status = 'active'
    );
$$;

revoke all on function app_private.current_user_can_access_store(uuid) from public;
grant execute on function app_private.current_user_can_access_store(uuid) to authenticated;

create or replace function app_private.admin_list_accessible_stores()
returns table (
  id uuid,
  name text,
  city text
)
language sql
security definer
set search_path = public, app_private
as $$
  select s.id, s.name, s.city
    from public.stores s
   where app_private.current_user_has_role('developer')
      or (s.status = 'active' and app_private.current_user_can_access_store(s.id))
   order by s.city, s.name;
$$;

revoke all on function app_private.admin_list_accessible_stores() from public;
grant execute on function app_private.admin_list_accessible_stores() to authenticated;

create or replace function public.admin_list_accessible_stores()
returns table (
  id uuid,
  name text,
  city text
)
language sql
security definer
set search_path = public, app_private
as $$
  select * from app_private.admin_list_accessible_stores();
$$;

revoke all on function public.admin_list_accessible_stores() from public;
grant execute on function public.admin_list_accessible_stores() to authenticated;

drop policy if exists "stores_select_accessible" on public.stores;
create policy "stores_select_accessible"
  on public.stores
  for select
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (status = 'active' and app_private.current_user_can_access_store(id))
  );

drop policy if exists "stores_admin_manage" on public.stores;
create policy "stores_admin_manage"
  on public.stores
  for all
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (
      status = 'active'
      and (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
      and app_private.current_user_can_access_store(id)
    )
  )
  with check (
    app_private.current_user_has_role('developer')
    or (
      status = 'active'
      and (
        app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('store_manager')
      )
    )
  );

drop policy if exists "employees_select_accessible" on public.employees;
create policy "employees_select_accessible"
  on public.employees
  for select
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (
      is_active = true
      and (
        id = app_private.current_user_employee_id()
        or (
          primary_store_id is not null
          and app_private.current_user_can_access_store(primary_store_id)
        )
        or exists (
          select 1
          from public.employee_store_assignments esa
          where esa.employee_id = public.employees.id
            and app_private.current_user_can_access_store(esa.store_id)
            and esa.valid_from <= current_date
            and (esa.valid_to is null or esa.valid_to >= current_date)
        )
      )
    )
  );

create or replace function app_private.admin_delete_employee(
  p_employee_id uuid
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_employee public.employees;
  v_profile_id uuid;
  v_target_role public.user_role_code;
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

  if p_employee_id is null then
    raise exception 'Missing employee id';
  end if;

  select p.id
    into v_profile_id
    from public.profiles p
   where p.employee_id = p_employee_id;

  if v_profile_id is null then
    raise exception 'Profile not found';
  end if;

  select r.code
    into v_target_role
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
   where ur.profile_id = v_profile_id
   order by
     case when ur.revoked_at is null then 0 else 1 end,
     ur.assigned_at desc
   limit 1;

  if v_target_role is null then
    raise exception 'Employee role not found';
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
  v_target_rank := app_private.role_rank(v_target_role);

  if v_actor_role <> 'developer' and v_target_rank <= v_actor_rank then
    raise exception 'Only lower role employees can be deleted';
  end if;

  if v_actor_role <> 'developer' and not exists (
    select 1
    from public.employee_store_assignments esa
    where esa.employee_id = p_employee_id
      and app_private.current_user_can_access_store(esa.store_id)
      and esa.valid_from <= current_date
      and (esa.valid_to is null or esa.valid_to >= current_date)
  ) then
    raise exception 'Only employees from accessible stores can be deleted';
  end if;

  update public.employees
     set is_active = false,
         terminated_at = coalesce(terminated_at, current_date),
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_employee_id
   returning * into v_employee;

  if not found then
    raise exception 'Employee not found';
  end if;

  update public.profiles
     set is_blocked = true,
         updated_at = now()
   where id = v_profile_id;

  return v_employee;
end;
$$;

revoke all on function app_private.admin_delete_employee(uuid) from public;
grant execute on function app_private.admin_delete_employee(uuid) to authenticated;

create or replace function public.admin_delete_employee(
  p_employee_id uuid
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.admin_delete_employee(p_employee_id);
end;
$$;

revoke all on function public.admin_delete_employee(uuid) from public;
grant execute on function public.admin_delete_employee(uuid) to authenticated;

create or replace function app_private.admin_restore_employee(
  p_employee_id uuid
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_employee public.employees;
  v_profile_id uuid;
begin
  if not app_private.current_user_has_role('developer') then
    raise exception 'Only developer can restore employees';
  end if;

  if p_employee_id is null then
    raise exception 'Missing employee id';
  end if;

  update public.employees
     set is_active = true,
         terminated_at = null,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_employee_id
   returning * into v_employee;

  if not found then
    raise exception 'Employee not found';
  end if;

  select id
    into v_profile_id
    from public.profiles
   where employee_id = p_employee_id;

  if v_profile_id is not null then
    update public.profiles
       set is_blocked = false,
           updated_at = now()
     where id = v_profile_id;

    if not exists (
      select 1
      from public.user_roles
      where profile_id = v_profile_id
        and revoked_at is null
    ) then
      update public.user_roles
         set revoked_at = null,
             updated_at = now()
       where id = (
         select id
         from public.user_roles
         where profile_id = v_profile_id
         order by assigned_at desc
         limit 1
       );
    end if;
  end if;

  return v_employee;
end;
$$;

revoke all on function app_private.admin_restore_employee(uuid) from public;
grant execute on function app_private.admin_restore_employee(uuid) to authenticated;

create or replace function public.admin_restore_employee(
  p_employee_id uuid
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.admin_restore_employee(p_employee_id);
end;
$$;

revoke all on function public.admin_restore_employee(uuid) from public;
grant execute on function public.admin_restore_employee(uuid) to authenticated;

create or replace function app_private.admin_archive_store(
  p_store_id uuid
)
returns public.stores
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_store public.stores;
begin
  if not app_private.current_user_has_role('developer') then
    raise exception 'Only developer can archive stores';
  end if;

  update public.stores
     set status = 'archived',
         archived_at = coalesce(archived_at, now()),
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_store_id
   returning * into v_store;

  if not found then
    raise exception 'Store not found';
  end if;

  return v_store;
end;
$$;

revoke all on function app_private.admin_archive_store(uuid) from public;
grant execute on function app_private.admin_archive_store(uuid) to authenticated;

create or replace function public.admin_archive_store(
  p_store_id uuid
)
returns public.stores
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.admin_archive_store(p_store_id);
end;
$$;

revoke all on function public.admin_archive_store(uuid) from public;
grant execute on function public.admin_archive_store(uuid) to authenticated;

create or replace function app_private.admin_restore_store(
  p_store_id uuid
)
returns public.stores
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_store public.stores;
begin
  if not app_private.current_user_has_role('developer') then
    raise exception 'Only developer can restore stores';
  end if;

  update public.stores
     set status = 'active',
         archived_at = null,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_store_id
   returning * into v_store;

  if not found then
    raise exception 'Store not found';
  end if;

  return v_store;
end;
$$;

revoke all on function app_private.admin_restore_store(uuid) from public;
grant execute on function app_private.admin_restore_store(uuid) to authenticated;

create or replace function public.admin_restore_store(
  p_store_id uuid
)
returns public.stores
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.admin_restore_store(p_store_id);
end;
$$;

revoke all on function public.admin_restore_store(uuid) from public;
grant execute on function public.admin_restore_store(uuid) to authenticated;
