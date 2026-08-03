do $$
begin
  alter type public.notification_channel add value if not exists 'push';
exception
  when duplicate_object then null;
end $$;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_subscriptions_profile_active_idx
  on public.push_subscriptions (profile_id, is_active);

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'set_push_subscriptions_updated_at'
  ) then
    create trigger set_push_subscriptions_updated_at
      before update on public.push_subscriptions
      for each row execute function public.set_updated_at();
  end if;
end $$;

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on public.push_subscriptions;
create policy "push_subscriptions_select_own"
  on public.push_subscriptions
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

drop policy if exists "push_subscriptions_insert_own" on public.push_subscriptions;
create policy "push_subscriptions_insert_own"
  on public.push_subscriptions
  for insert
  to authenticated
  with check (profile_id = (select auth.uid()));

drop policy if exists "push_subscriptions_update_own" on public.push_subscriptions;
create policy "push_subscriptions_update_own"
  on public.push_subscriptions
  for update
  to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

drop policy if exists "push_subscriptions_delete_own" on public.push_subscriptions;
create policy "push_subscriptions_delete_own"
  on public.push_subscriptions
  for delete
  to authenticated
  using (profile_id = (select auth.uid()));

create unique index if not exists notification_deliveries_notification_channel_unique
  on public.notification_deliveries (notification_id, channel);

create or replace function public.list_push_notification_targets(
  p_event_type text default null,
  p_related_entity_type text default null,
  p_related_entity_id uuid default null,
  p_recipient_profile_id uuid default null,
  p_since_minutes integer default 30
)
returns table (
  notification_id uuid,
  recipient_profile_id uuid,
  title text,
  body text,
  event_type text,
  related_entity_type text,
  related_entity_id uuid,
  notification_created_at timestamptz,
  push_subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  user_agent text
)
language sql
security definer
set search_path = public
as $$
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
  where nd.id is null
    and n.created_at >= now() - make_interval(mins => greatest(coalesce(p_since_minutes, 30), 1))
    and (p_event_type is null or n.event_type = p_event_type)
    and (p_related_entity_type is null or n.related_entity_type = p_related_entity_type)
    and (p_related_entity_id is null or n.related_entity_id = p_related_entity_id)
    and (p_recipient_profile_id is null or n.recipient_profile_id = p_recipient_profile_id)
  order by n.created_at asc, ps.created_at asc;
$$;

grant execute on function public.list_push_notification_targets(text, text, uuid, uuid, integer) to authenticated;

create or replace function public.record_push_delivery(
  p_notification_id uuid,
  p_status public.notification_delivery_status,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_deliveries (
    notification_id,
    channel,
    status,
    sent_at,
    error_message
  )
  values (
    p_notification_id,
    'push',
    p_status,
    case when p_status = 'sent' then now() else null end,
    p_error_message
  )
  on conflict (notification_id, channel) do update
    set status = excluded.status,
        sent_at = excluded.sent_at,
        error_message = excluded.error_message;
end;
$$;

grant execute on function public.record_push_delivery(uuid, public.notification_delivery_status, text) to authenticated;

create or replace function public.deactivate_push_subscription(
  p_profile_id uuid,
  p_endpoint text
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.push_subscriptions
     set is_active = false
   where profile_id = p_profile_id
     and endpoint = p_endpoint;
$$;

grant execute on function public.deactivate_push_subscription(uuid, text) to authenticated;

