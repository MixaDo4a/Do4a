create or replace function app_private.admin_replace_employee_roles(
  p_employee_id uuid,
  p_role_codes public.user_role_code[]
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_profile_id uuid;
  v_actor_role public.user_role_code;
  v_actor_rank integer;
  v_role_code public.user_role_code;
  v_role_id uuid;
begin
  if not (
    app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  ) then
    raise exception 'Not allowed';
  end if;

  if p_employee_id is null or p_role_codes is null or coalesce(array_length(p_role_codes, 1), 0) = 0 then
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

  select p.id
    into v_profile_id
    from public.profiles p
   where p.employee_id = p_employee_id;

  if v_profile_id is null then
    raise exception 'Profile not found for employee';
  end if;

  if exists (
    select 1
      from unnest(p_role_codes) as requested(code)
     where app_private.role_rank(requested.code) < v_actor_rank
  ) then
    raise exception 'Cannot assign role above your own level';
  end if;

  if exists (
    select 1
      from unnest(p_role_codes) as requested(code)
     where not exists (select 1 from public.roles r where r.code = requested.code)
  ) then
    raise exception 'Role not found';
  end if;

  update public.user_roles
     set revoked_at = now(),
         updated_at = now()
   where profile_id = v_profile_id
     and revoked_at is null;

  foreach v_role_code in array p_role_codes loop
    select r.id into v_role_id from public.roles r where r.code = v_role_code;

    insert into public.user_roles (profile_id, role_id, assigned_by)
    values (v_profile_id, v_role_id, (select auth.uid()));
  end loop;
end;
$$;

revoke all on function app_private.admin_replace_employee_roles(uuid, public.user_role_code[]) from public;
grant execute on function app_private.admin_replace_employee_roles(uuid, public.user_role_code[]) to authenticated;

create or replace function public.admin_replace_employee_roles(
  p_employee_id uuid,
  p_role_codes public.user_role_code[]
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  perform app_private.admin_replace_employee_roles(p_employee_id, p_role_codes);
end;
$$;

revoke all on function public.admin_replace_employee_roles(uuid, public.user_role_code[]) from public, anon;
grant execute on function public.admin_replace_employee_roles(uuid, public.user_role_code[]) to authenticated;
