do $$
begin
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    execute 'create publication supabase_realtime';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_telegram_qa_reports'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_telegram_qa_reports';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_telegram_qa_report_history'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_telegram_qa_report_history';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_telegram_qa_owner_questions'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_telegram_qa_owner_questions';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff_telegram_qa_release_approvals'
  ) then
    execute 'alter publication supabase_realtime add table public.staff_telegram_qa_release_approvals';
  end if;
end;
$$;

create or replace function public.staff_claim_next_telegram_qa_report()
returns setof public.staff_telegram_qa_reports
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report public.staff_telegram_qa_reports%rowtype;
  v_old_status text;
begin
  select report.*
    into v_report
  from public.staff_telegram_qa_reports as report
  where report.photo_storage_path is not null
    and (report.status = 'new' or (report.status = 'processing' and report.locked_at < now() - interval '1 hour'))
    and exists (
      select 1 from public.staff_telegram_qa_report_history as history
      where history.report_id = report.id and history.event_type = 'acknowledged'
    )
  order by report.created_at, report.request_no
  for update skip locked
  limit 1;

  if not found then return; end if;

  v_old_status := v_report.status;
  update public.staff_telegram_qa_reports as report
  set status = 'processing',
      locked_at = now(),
      processing_attempts = report.processing_attempts + 1,
      last_error = null,
      updated_at = now()
  where report.id = v_report.id
  returning report.* into v_report;

  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (v_report.id, 'claimed', v_old_status, 'processing', 'worker', jsonb_build_object('attempt', v_report.processing_attempts));

  return next v_report;
end;
$$;
