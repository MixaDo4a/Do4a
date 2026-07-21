create or replace function app_private.admin_create_employee_account(
  p_auth_user_id uuid,
  p_full_name text,
  p_phone text,
  p_email text,
  p_telegram_username text,
  p_city text,
  p_primary_store_id uuid,
  p_employee_status public.employee_status,
  p_role_code public.user_role_code,
  p_store_ids uuid[]
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_employee public.employees;
  v_actor_role public.user_role_code;
  v_actor_rank integer;
  v_target_rank integer;
  v_current_city text;
  v_role_id uuid;
begin
  if not (
    app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  ) then
    raise exception 'Not allowed';
  end if;

  if p_auth_user_id is null
     or coalesce(btrim(p_full_name), '') = ''
     or coalesce(btrim(p_phone), '') = ''
     or coalesce(btrim(p_email), '') = ''
     or coalesce(btrim(p_telegram_username), '') = ''
     or coalesce(btrim(p_city), '') = ''
     or p_primary_store_id is null
     or p_employee_status is null
     or p_role_code is null
     or p_store_ids is null
     or coalesce(array_length(p_store_ids, 1), 0) = 0 then
    raise exception 'Missing required employee data';
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

  select r.id
    into v_role_id
    from public.roles r
   where r.code = p_role_code;

  if v_role_id is null then
    raise exception 'Role not found';
  end if;

  if v_actor_role <> 'developer' then
    select e.city
      into v_current_city
      from public.profiles p
      join public.employees e on e.id = p.employee_id
     where p.id = (select auth.uid());

    if coalesce(lower(btrim(v_current_city)), '') <> coalesce(lower(btrim(p_city)), '') then
      raise exception 'Only employees from your city can be created';
    end if;

    if exists (
      select 1
      from unnest(p_store_ids) as s(store_id)
      where not app_private.current_user_can_access_store(s.store_id)
    ) then
      raise exception 'Only accessible stores can be assigned';
    end if;
  end if;

  if not exists (
    select 1
    from unnest(p_store_ids) as s(store_id)
    join public.stores st on st.id = s.store_id
    where st.status = 'active'
  ) then
    raise exception 'At least one active store is required';
  end if;

  if not (p_primary_store_id = any (p_store_ids)) then
    raise exception 'Primary store must be in store assignments';
  end if;

  insert into public.employees (
    full_name,
    phone,
    email,
    telegram_username,
    city,
    primary_store_id,
    employee_status,
    hired_at,
    is_active,
    created_by,
    updated_by
  )
  values (
    p_full_name,
    p_phone,
    p_email,
    regexp_replace(p_telegram_username, '^@', ''),
    p_city,
    p_primary_store_id,
    p_employee_status,
    current_date,
    true,
    auth.uid(),
    auth.uid()
  )
  returning * into v_employee;

  insert into public.profiles (
    id,
    employee_id,
    telegram_username,
    email,
    full_name
  )
  values (
    p_auth_user_id,
    v_employee.id,
    regexp_replace(p_telegram_username, '^@', ''),
    p_email,
    p_full_name
  );

  insert into public.user_roles (
    profile_id,
    role_id,
    assigned_by
  )
  values (
    p_auth_user_id,
    v_role_id,
    auth.uid()
  );

  insert into public.employee_store_assignments (
    employee_id,
    store_id,
    valid_from,
    is_primary,
    created_by,
    updated_by
  )
  select
    v_employee.id,
    s.store_id,
    current_date,
    s.store_id = p_primary_store_id,
    auth.uid(),
    auth.uid()
  from unnest(p_store_ids) as s(store_id);

  return v_employee;
end;
$$;

revoke all on function app_private.admin_create_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  public.user_role_code,
  uuid[]
) from public;

grant execute on function app_private.admin_create_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  public.user_role_code,
  uuid[]
) to authenticated;

create or replace function public.admin_create_employee_account(
  p_auth_user_id uuid,
  p_full_name text,
  p_phone text,
  p_email text,
  p_telegram_username text,
  p_city text,
  p_primary_store_id uuid,
  p_employee_status public.employee_status,
  p_role_code public.user_role_code,
  p_store_ids uuid[]
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.admin_create_employee_account(
    p_auth_user_id,
    p_full_name,
    p_phone,
    p_email,
    p_telegram_username,
    p_city,
    p_primary_store_id,
    p_employee_status,
    p_role_code,
    p_store_ids
  );
end;
$$;

revoke all on function public.admin_create_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  public.user_role_code,
  uuid[]
) from public;

grant execute on function public.admin_create_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  public.user_role_code,
  uuid[]
) to authenticated;
