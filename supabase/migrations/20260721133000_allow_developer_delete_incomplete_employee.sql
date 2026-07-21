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

  select p.id
    into v_profile_id
    from public.profiles p
   where p.employee_id = p_employee_id;

  if v_profile_id is not null then
    select r.code
      into v_target_role
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
     where ur.profile_id = v_profile_id
     order by
       case when ur.revoked_at is null then 0 else 1 end,
       ur.assigned_at desc
     limit 1;
  end if;

  if v_actor_role <> 'developer' then
    if v_profile_id is null or v_target_role is null then
      raise exception 'Employee role not found';
    end if;

    v_actor_rank := app_private.role_rank(v_actor_role);
    v_target_rank := app_private.role_rank(v_target_role);

    if v_target_rank <= v_actor_rank then
      raise exception 'Only lower role employees can be deleted';
    end if;

    if not exists (
      select 1
      from public.employee_store_assignments esa
      where esa.employee_id = p_employee_id
        and app_private.current_user_can_access_store(esa.store_id)
        and esa.valid_from <= current_date
        and (esa.valid_to is null or esa.valid_to >= current_date)
    ) then
      raise exception 'Only employees from accessible stores can be deleted';
    end if;
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

  if v_profile_id is not null then
    update public.profiles
       set is_blocked = true,
           updated_at = now()
     where id = v_profile_id;
  end if;

  return v_employee;
end;
$$;

revoke all on function app_private.admin_delete_employee(uuid) from public;
grant execute on function app_private.admin_delete_employee(uuid) to authenticated;
