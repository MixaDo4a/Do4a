-- Keep notification RPCs usable by the server application while preventing
-- arbitrary authenticated users from writing notifications for other stores.
create or replace function app_private.current_user_can_send_store_notification(p_store_id uuid)
returns boolean
language sql
stable
security definer
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
  )
  and app_private.current_user_can_access_store(p_store_id);
$$;

create or replace function app_private.current_user_can_send_employee_notification(p_employee_id uuid)
returns boolean
language sql
stable
security definer
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
  )
  and exists (
    select 1
    from public.employee_store_assignments esa
    where esa.employee_id = p_employee_id
      and esa.valid_from <= current_date
      and (esa.valid_to is null or esa.valid_to >= current_date)
      and app_private.current_user_can_access_store(esa.store_id)
  );
$$;

create or replace function public.send_employee_notification(
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
begin
  if not app_private.current_user_can_send_employee_notification(p_employee_id) then
    raise exception 'Недостаточно прав для отправки уведомления';
  end if;

  perform app_private.notify_employee(
    p_employee_id,
    p_event_type,
    p_title,
    p_body,
    p_related_entity_type,
    p_related_entity_id
  );
end;
$$;

create or replace function public.send_store_managers_notification(
  p_store_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null,
  p_exclude_profile_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  if not app_private.current_user_can_send_store_notification(p_store_id) then
    raise exception 'Недостаточно прав для отправки уведомления по магазину';
  end if;

  return app_private.notify_store_managers(
    p_store_id,
    p_event_type,
    p_title,
    p_body,
    p_related_entity_type,
    p_related_entity_id,
    p_exclude_profile_id
  );
end;
$$;

create or replace function public.send_store_employees_notification(
  p_store_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_exclude_employee_id uuid default null,
  p_exclude_profile_id uuid default null,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null,
  p_exclude_employee_id_2 uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  if not app_private.current_user_can_send_store_notification(p_store_id) then
    raise exception 'Недостаточно прав для отправки уведомления по магазину';
  end if;

  return app_private.notify_store_employees(
    p_store_id,
    p_event_type,
    p_title,
    p_body,
    p_exclude_employee_id,
    p_exclude_profile_id,
    p_related_entity_type,
    p_related_entity_id,
    p_exclude_employee_id_2
  );
end;
$$;

-- The cron migration used the old six-argument call after the employee
-- notification function gained exclusion parameters. Keep a compatibility
-- overload so old cron code remains valid on every environment.
create or replace function app_private.notify_store_employees(
  p_store_id uuid,
  p_event_type text,
  p_title text,
  p_body text,
  p_related_entity_type text,
  p_related_entity_id uuid
)
returns integer
language sql
security definer
set search_path = public, app_private
as $$
  select app_private.notify_store_employees(
    p_store_id,
    p_event_type,
    p_title,
    p_body,
    null::uuid,
    null::uuid,
    p_related_entity_type,
    p_related_entity_id,
    null::uuid
  );
$$;

revoke execute on function public.run_notification_cron(timestamptz) from anon, authenticated;
grant execute on function public.run_notification_cron(timestamptz) to service_role;
