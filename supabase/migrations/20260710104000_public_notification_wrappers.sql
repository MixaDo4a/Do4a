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
  p_related_entity_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.notify_store_managers(
    p_store_id,
    p_event_type,
    p_title,
    p_body,
    p_related_entity_type,
    p_related_entity_id
  );
end;
$$;

create or replace function public.send_store_employees_notification(
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
  return app_private.notify_store_employees(
    p_store_id,
    p_event_type,
    p_title,
    p_body,
    p_exclude_employee_id,
    p_related_entity_type,
    p_related_entity_id
  );
end;
$$;

create or replace function public.run_notification_cron(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.run_notification_cron(p_now);
end;
$$;

grant execute on function public.send_employee_notification(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.send_store_managers_notification(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.send_store_employees_notification(uuid, text, text, text, uuid, text, uuid) to authenticated;
grant execute on function public.run_notification_cron(timestamptz) to authenticated;
