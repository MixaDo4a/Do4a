-- Push worker RPCs are called with the service role from the server only.
revoke all on function public.push_notification_targets_rpc(text, text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.record_push_delivery(uuid, notification_delivery_status, text) from public, anon, authenticated;
revoke all on function public.deactivate_push_subscription(uuid, text) from public, anon, authenticated;
revoke all on function public.list_push_notification_targets(text, text, uuid, uuid, integer) from public, anon, authenticated;

grant execute on function public.push_notification_targets_rpc(text, text, uuid, uuid, integer) to service_role;
grant execute on function public.record_push_delivery(uuid, notification_delivery_status, text) to service_role;
grant execute on function public.deactivate_push_subscription(uuid, text) to service_role;

create or replace function public.send_city_warehouse_managers_notification(
  p_city text,
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
  v_count integer := 0;
begin
  if not (
    app_private.current_user_has_role('manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('buyer')
    or app_private.current_user_has_role('warehouse_manager')
  ) then
    raise exception 'Недостаточно прав для отправки уведомления складским менеджерам';
  end if;

  insert into public.notifications (
    recipient_profile_id, event_type, title, body,
    related_entity_type, related_entity_id
  )
  select distinct p.id, p_event_type, p_title, p_body,
    p_related_entity_type, p_related_entity_id
  from public.profiles p
  join public.employees e on e.id = p.employee_id
  join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
  join public.roles r on r.id = ur.role_id
  where p.is_blocked = false
    and e.is_active = true
    and r.code = 'warehouse_manager'
    and lower(btrim(e.city)) = lower(btrim(p_city));

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.send_city_warehouse_managers_notification(text, text, text, text, text, uuid) to authenticated;
