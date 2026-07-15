create or replace function app_private.admin_replace_employee_store_assignments(
  p_employee_id uuid,
  p_store_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, app_private, auth, extensions
as $$
declare
  v_store_id uuid;
begin
  if not (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('developer')
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
