do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'notification_deliveries_notification_channel_key'
      and conrelid = 'public.notification_deliveries'::regclass
  ) then
    alter table public.notification_deliveries
      add constraint notification_deliveries_notification_channel_key
      unique (notification_id, channel);
  end if;
end $$;

drop index if exists public.notification_deliveries_notification_idx;
