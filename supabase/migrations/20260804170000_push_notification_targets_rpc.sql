create or replace view public.push_notification_targets_v as
select
  n.id as notification_id,
  n.recipient_profile_id,
  n.title,
  n.body,
  n.event_type,
  n.related_entity_type,
  n.related_entity_id,
  n.created_at as notification_created_at,
  ps.id as push_subscription_id,
  ps.endpoint,
  ps.p256dh,
  ps.auth,
  ps.user_agent
from public.notifications n
left join public.notification_deliveries nd
  on nd.notification_id = n.id
 and nd.channel = 'push'
 and nd.status = 'sent'
left join public.push_subscriptions ps
  on ps.profile_id = n.recipient_profile_id
 and ps.is_active = true
where nd.id is null;

create or replace function public.push_notification_targets_rpc(
  p_event_type text,
  p_related_entity_type text,
  p_related_entity_id uuid,
  p_recipient_profile_id uuid,
  p_since_minutes integer
)
returns setof public.push_notification_targets_v
language sql
security definer
set search_path = public
as $$
  select *
  from public.push_notification_targets_v
  where notification_created_at >= now() - make_interval(mins => p_since_minutes)
    and (p_event_type is null or event_type = p_event_type)
    and (p_related_entity_type is null or related_entity_type = p_related_entity_type)
    and (p_related_entity_id is null or related_entity_id = p_related_entity_id)
    and (p_recipient_profile_id is null or recipient_profile_id = p_recipient_profile_id)
  order by notification_created_at asc, push_subscription_id asc;
$$;

grant execute on function public.push_notification_targets_rpc(text, text, uuid, uuid, integer) to authenticated;
