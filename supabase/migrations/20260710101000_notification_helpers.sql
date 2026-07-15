create or replace function app_private.notify_employee(
  p_employee_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_profile_id uuid;
begin
  select p.id
    into v_profile_id
    from public.profiles p
   where p.employee_id = p_employee_id
     and p.is_blocked = false
   limit 1;

  if v_profile_id is null then
    return;
  end if;

  insert into public.notifications (
    recipient_profile_id,
    event_type,
    title,
    body,
    related_entity_type,
    related_entity_id
  )
  values (
    v_profile_id,
    p_event_type,
    p_title,
    p_body,
    p_related_entity_type,
    p_related_entity_id
  );
end;
$$;

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
  where ur.revoked_at is null
    and p.is_blocked = false
    and r.code in ('super_admin', 'store_manager', 'developer')
    and (
      ur.scope_store_id = p_store_id
      or (ur.scope_store_id is null and ur.scope_city is null)
      or (ur.scope_city is not null and ur.scope_city = v_store_city)
    );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app_private.notify_store_employees(
  p_store_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_exclude_employee_id uuid default null,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
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
  from public.employee_store_assignments esa
  join public.employees e on e.id = esa.employee_id
  join public.profiles p on p.employee_id = e.id
  where esa.store_id = p_store_id
    and esa.valid_from <= current_date
    and (esa.valid_to is null or esa.valid_to >= current_date)
    and p.is_blocked = false
    and (p_exclude_employee_id is null or e.id <> p_exclude_employee_id)
    and not exists (
      select 1
      from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.profile_id = p.id
        and ur.revoked_at is null
        and r.code in ('super_admin', 'store_manager', 'developer')
    );

  return 1;
end;
$$;
