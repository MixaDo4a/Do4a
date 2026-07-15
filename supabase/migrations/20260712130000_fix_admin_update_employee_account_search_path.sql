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
