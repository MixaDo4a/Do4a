-- Harden notification RPCs while preserving the older production overloads.

create or replace function app_private.current_user_can_send_store_notification(p_store_id uuid)
returns boolean language sql stable security definer
set search_path = public, app_private
as $$
  select (
    app_private.current_user_has_role('manager')
    or app_private.current_user_has_role('auditor')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('buyer')
    or app_private.current_user_has_role('warehouse_manager')
  ) and app_private.current_user_can_access_store(p_store_id);
$$;

create or replace function app_private.current_user_can_send_employee_notification(p_employee_id uuid)
returns boolean language sql stable security definer
set search_path = public, app_private
as $$
  select (
    app_private.current_user_has_role('manager')
    or app_private.current_user_has_role('auditor')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('buyer')
    or app_private.current_user_has_role('warehouse_manager')
  ) and exists (
    select 1 from public.employee_store_assignments esa
    where esa.employee_id = p_employee_id
      and esa.valid_from <= current_date
      and (esa.valid_to is null or esa.valid_to >= current_date)
      and app_private.current_user_can_access_store(esa.store_id)
  );
$$;

create or replace function app_private.notify_store_managers(
  p_store_id uuid, p_event_type text, p_title text, p_body text,
  p_related_entity_type text default null, p_related_entity_id uuid default null,
  p_exclude_profile_id uuid default null
)
returns integer language plpgsql security definer
set search_path = public, app_private
as $$
declare v_store_city text; v_count integer := 0;
begin
  select s.city into v_store_city from public.stores s where s.id = p_store_id;
  insert into public.notifications (recipient_profile_id, event_type, title, body, related_entity_type, related_entity_id)
  select distinct p.id, p_event_type, p_title, p_body, p_related_entity_type, p_related_entity_id
  from public.user_roles ur
  join public.roles r on r.id = ur.role_id
  join public.profiles p on p.id = ur.profile_id
  left join public.employees e on e.id = p.employee_id
  where ur.revoked_at is null and p.is_blocked = false
    and r.code in ('super_admin', 'store_manager', 'developer')
    and (p_exclude_profile_id is null or p.id <> p_exclude_profile_id)
    and (r.code = 'developer' or ur.scope_store_id = p_store_id
      or (ur.scope_city is not null and ur.scope_city = v_store_city)
      or exists (
        select 1 from public.employee_store_assignments esa
        where esa.employee_id = e.id and esa.store_id = p_store_id
          and esa.valid_from <= current_date
          and (esa.valid_to is null or esa.valid_to >= current_date)
      ));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function app_private.notify_store_employees(
  p_store_id uuid, p_event_type text, p_title text, p_body text,
  p_exclude_employee_id uuid default null, p_exclude_profile_id uuid default null,
  p_related_entity_type text default null, p_related_entity_id uuid default null,
  p_exclude_employee_id_2 uuid default null
)
returns integer language plpgsql security definer
set search_path = public, app_private
as $$
begin
  insert into public.notifications (recipient_profile_id, event_type, title, body, related_entity_type, related_entity_id)
  select distinct p.id, p_event_type, p_title, p_body, p_related_entity_type, p_related_entity_id
  from public.employee_store_assignments esa
  join public.employees e on e.id = esa.employee_id
  join public.profiles p on p.employee_id = e.id
  where esa.store_id = p_store_id and esa.valid_from <= current_date
    and (esa.valid_to is null or esa.valid_to >= current_date)
    and p.is_blocked = false
    and (p_exclude_employee_id is null or e.id <> p_exclude_employee_id)
    and (p_exclude_profile_id is null or p.id <> p_exclude_profile_id)
    and (p_exclude_employee_id_2 is null or e.id <> p_exclude_employee_id_2)
    and not exists (
      select 1 from public.user_roles ur join public.roles r on r.id = ur.role_id
      where ur.profile_id = p.id and ur.revoked_at is null
        and r.code in ('super_admin', 'store_manager', 'developer')
    );
  return 1;
end;
$$;

create or replace function public.send_employee_notification(
  p_employee_id uuid, p_event_type text, p_title text, p_body text,
  p_related_entity_type text default null, p_related_entity_id uuid default null
)
returns void language plpgsql security definer set search_path = public, app_private
as $$
begin
  if not app_private.current_user_can_send_employee_notification(p_employee_id) then
    raise exception 'Недостаточно прав для отправки уведомления';
  end if;
  perform app_private.notify_employee(p_employee_id, p_event_type, p_title, p_body, p_related_entity_type, p_related_entity_id);
end;
$$;

create or replace function public.send_store_managers_notification(
  p_store_id uuid, p_event_type text, p_title text, p_body text,
  p_related_entity_type text default null, p_related_entity_id uuid default null
)
returns integer language plpgsql security definer set search_path = public, app_private
as $$
begin
  if not app_private.current_user_can_send_store_notification(p_store_id) then
    raise exception 'Недостаточно прав для отправки уведомления по магазину';
  end if;
  return app_private.notify_store_managers(p_store_id, p_event_type, p_title, p_body, p_related_entity_type, p_related_entity_id);
end;
$$;

create or replace function public.send_store_managers_notification(
  p_store_id uuid, p_event_type text, p_title text, p_body text,
  p_related_entity_type text default null, p_related_entity_id uuid default null,
  p_exclude_profile_id uuid default null
)
returns integer language plpgsql security definer set search_path = public, app_private
as $$
begin
  if not app_private.current_user_can_send_store_notification(p_store_id) then
    raise exception 'Недостаточно прав для отправки уведомления по магазину';
  end if;
  return app_private.notify_store_managers(p_store_id, p_event_type, p_title, p_body, p_related_entity_type, p_related_entity_id, p_exclude_profile_id);
end;
$$;

create or replace function public.send_store_employees_notification(
  p_store_id uuid, p_event_type text, p_title text, p_body text,
  p_exclude_employee_id uuid default null, p_related_entity_type text default null,
  p_related_entity_id uuid default null
)
returns integer language plpgsql security definer set search_path = public, app_private
as $$
begin
  if not app_private.current_user_can_send_store_notification(p_store_id) then
    raise exception 'Недостаточно прав для отправки уведомления по магазину';
  end if;
  return app_private.notify_store_employees(p_store_id, p_event_type, p_title, p_body, p_exclude_employee_id, p_related_entity_type, p_related_entity_id);
end;
$$;

create or replace function public.send_store_employees_notification(
  p_store_id uuid, p_event_type text, p_title text, p_body text,
  p_exclude_employee_id uuid default null, p_exclude_profile_id uuid default null,
  p_related_entity_type text default null, p_related_entity_id uuid default null,
  p_exclude_employee_id_2 uuid default null
)
returns integer language plpgsql security definer set search_path = public, app_private
as $$
begin
  if not app_private.current_user_can_send_store_notification(p_store_id) then
    raise exception 'Недостаточно прав для отправки уведомления по магазину';
  end if;
  return app_private.notify_store_employees(p_store_id, p_event_type, p_title, p_body,
    p_exclude_employee_id, p_exclude_profile_id, p_related_entity_type,
    p_related_entity_id, p_exclude_employee_id_2);
end;
$$;

-- Old cron code passes related type/id in positions five and six.
create or replace function app_private.notify_store_employees(
  p_store_id uuid, p_event_type text, p_title text, p_body text,
  p_related_entity_type text, p_related_entity_id uuid
)
returns integer language sql security definer set search_path = public, app_private
as $$
  select app_private.notify_store_employees(p_store_id, p_event_type, p_title, p_body,
    null::uuid, null::uuid, p_related_entity_type, p_related_entity_id, null::uuid);
$$;

revoke execute on function public.run_notification_cron(timestamptz) from anon, authenticated;
grant execute on function public.run_notification_cron(timestamptz) to service_role;
grant execute on function public.send_employee_notification(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.send_store_managers_notification(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.send_store_managers_notification(uuid, text, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.send_store_employees_notification(uuid, text, text, text, uuid, text, uuid) to authenticated;
grant execute on function public.send_store_employees_notification(uuid, text, text, text, uuid, uuid, text, uuid, uuid) to authenticated;
