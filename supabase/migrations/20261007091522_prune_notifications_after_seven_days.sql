-- Keep notification rows and push delivery history for only the latest seven days.
create index if not exists notifications_created_at_idx
  on public.notifications (created_at);

alter table public.daily_digest_runs
  drop constraint daily_digest_runs_notification_id_fkey;

alter table public.daily_digest_runs
  add constraint daily_digest_runs_notification_id_fkey
  foreign key (notification_id) references public.notifications(id) on delete set null;

create or replace function app_private.prune_expired_notifications()
returns integer
language plpgsql
security invoker
set search_path = public, app_private
as $$
declare
  cutoff timestamptz := now() - interval '7 days';
  deleted_count integer;
begin
  delete from public.notifications notification
  where notification.created_at < cutoff;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function app_private.prune_expired_notifications() from public, anon, authenticated;

select app_private.prune_expired_notifications();

select cron.schedule(
  'do4a-prune-notifications',
  '0 * * * *',
  'select app_private.prune_expired_notifications()'
);
