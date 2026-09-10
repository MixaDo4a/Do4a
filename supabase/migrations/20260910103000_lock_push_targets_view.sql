-- Push subscription credentials must never be directly readable through the
-- exposed Data API. The server-side SECURITY DEFINER RPC remains the only
-- access path used by the push dispatcher.
alter view public.push_notification_targets_v set (security_invoker = true);
revoke all on table public.push_notification_targets_v from public, anon, authenticated;
grant select on table public.push_notification_targets_v to service_role;
