create or replace function app_private.admin_update_employee_account(
  p_employee_id uuid,
  p_full_name text,
  p_phone text,
  p_email text,
  p_telegram_username text,
  p_city text,
  p_primary_store_id uuid,
  p_employee_status public.employee_status,
  p_is_active boolean,
  p_new_password text default null
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private, auth, extensions
as $$
declare
  v_employee public.employees;
  v_profile_id uuid;
  v_current_email text;
  v_can_edit_auth boolean;
begin
  if not (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Not allowed';
  end if;

  if p_employee_id is null
     or coalesce(btrim(p_full_name), '') = ''
     or coalesce(btrim(p_phone), '') = ''
     or coalesce(btrim(p_email), '') = ''
     or coalesce(btrim(p_telegram_username), '') = ''
     or coalesce(btrim(p_city), '') = ''
     or p_employee_status is null then
    raise exception 'Missing required fields';
  end if;

  select email
    into v_current_email
    from public.employees
   where id = p_employee_id;

  v_can_edit_auth :=
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer');

  if not v_can_edit_auth then
    if coalesce(v_current_email, '') is distinct from coalesce(p_email, '') then
      raise exception 'Only super admin and developer can change employee login';
    end if;
    if coalesce(btrim(p_new_password), '') <> '' then
      raise exception 'Only super admin and developer can change employee password';
    end if;
  end if;

  update public.employees
     set full_name = p_full_name,
         phone = p_phone,
         email = p_email,
         telegram_username = regexp_replace(p_telegram_username, '^@', ''),
         city = p_city,
         primary_store_id = p_primary_store_id,
         employee_status = p_employee_status,
         is_active = p_is_active,
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_employee_id
   returning * into v_employee;

  if not found then
    raise exception 'Employee not found';
  end if;

  select p.id
    into v_profile_id
    from public.profiles p
   where p.employee_id = p_employee_id;

  if v_profile_id is not null then
    update public.profiles
       set full_name = p_full_name,
           email = p_email,
           telegram_username = regexp_replace(p_telegram_username, '^@', ''),
           updated_at = now()
     where id = v_profile_id;

    if v_can_edit_auth then
      update auth.users
         set email = p_email,
             updated_at = now(),
             email_confirmed_at = coalesce(email_confirmed_at, now())
       where id = v_profile_id;

      if coalesce(btrim(p_new_password), '') <> '' then
        update auth.users
           set encrypted_password = crypt(p_new_password, gen_salt('bf')),
               updated_at = now()
         where id = v_profile_id;
      end if;
    end if;
  end if;

  return v_employee;
end;
$$;

revoke all on function app_private.admin_update_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  boolean,
  text
) from public;

grant execute on function app_private.admin_update_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  boolean,
  text
) to authenticated;

create or replace function public.admin_update_employee_account(
  p_employee_id uuid,
  p_full_name text,
  p_phone text,
  p_email text,
  p_telegram_username text,
  p_city text,
  p_primary_store_id uuid,
  p_employee_status public.employee_status,
  p_is_active boolean,
  p_new_password text default null
)
returns public.employees
language plpgsql
security definer
set search_path = public, app_private, auth, extensions
as $$
begin
  return app_private.admin_update_employee_account(
    p_employee_id,
    p_full_name,
    p_phone,
    p_email,
    p_telegram_username,
    p_city,
    p_primary_store_id,
    p_employee_status,
    p_is_active,
    p_new_password
  );
end;
$$;

revoke all on function public.admin_update_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  boolean,
  text
) from public;

grant execute on function public.admin_update_employee_account(
  uuid,
  text,
  text,
  text,
  text,
  text,
  uuid,
  public.employee_status,
  boolean,
  text
) to authenticated;

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
  v_actor_level integer;
  v_target_level integer;
begin
  if not (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Not allowed';
  end if;

  if p_employee_id is null or p_role_code is null then
    raise exception 'Missing role data';
  end if;

  select case
           when app_private.current_user_has_role('developer') then 0
           when app_private.current_user_has_role('super_admin') then 1
           when app_private.current_user_has_role('store_manager') then 2
           when app_private.current_user_has_role('auditor') then 3
           when app_private.current_user_has_role('manager') then 4
           else 99
         end
    into v_actor_level;

  select case p_role_code
           when 'developer' then 0
           when 'super_admin' then 1
           when 'store_manager' then 2
           when 'auditor' then 3
           when 'manager' then 4
           else 99
         end
    into v_target_level;

  if v_target_level < v_actor_level then
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
  v_current_role_rank integer;
  v_target_role_rank integer;
begin
  if not (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Not allowed';
  end if;

  if p_employee_id is null then
    raise exception 'Missing employee id';
  end if;

  select r.code
    into v_target_role
    from public.profiles p
    join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
    join public.roles r on r.id = ur.role_id
   where p.employee_id = p_employee_id
   order by
     case r.code
       when 'developer' then 0
       when 'super_admin' then 1
       when 'store_manager' then 2
       when 'auditor' then 3
       when 'manager' then 4
       else 99
     end
   limit 1;

  v_current_role_rank := case
    when app_private.current_user_has_role('developer') then 0
    when app_private.current_user_has_role('super_admin') then 1
    when app_private.current_user_has_role('store_manager') then 2
    when app_private.current_user_has_role('auditor') then 3
    when app_private.current_user_has_role('manager') then 4
    else 99
  end;

  v_target_role_rank := case v_target_role
    when 'developer' then 0
    when 'super_admin' then 1
    when 'store_manager' then 2
    when 'auditor' then 3
    when 'manager' then 4
    else 99
  end;

  if v_target_role is null then
    raise exception 'Employee role not found';
  end if;

  if v_target_role_rank < v_current_role_rank then
    raise exception 'Cannot delete employee with higher role';
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

  select id
    into v_profile_id
    from public.profiles
   where employee_id = p_employee_id;

  if v_profile_id is not null then
    update public.profiles
       set is_blocked = true,
           updated_at = now()
     where id = v_profile_id;

    update public.user_roles
       set revoked_at = now(),
           updated_at = now()
     where profile_id = v_profile_id
       and revoked_at is null;
  end if;

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
