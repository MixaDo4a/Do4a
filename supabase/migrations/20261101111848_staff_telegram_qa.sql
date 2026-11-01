create sequence public.staff_telegram_qa_request_no_seq;
revoke all on sequence public.staff_telegram_qa_request_no_seq from public, anon, authenticated;
grant usage, select on sequence public.staff_telegram_qa_request_no_seq to service_role;

create table public.staff_telegram_qa_reports (
  id uuid primary key default gen_random_uuid(),
  request_no bigint not null unique default nextval('public.staff_telegram_qa_request_no_seq'),
  telegram_update_id bigint not null unique,
  telegram_chat_id bigint not null,
  telegram_message_id bigint not null,
  telegram_thread_id bigint not null,
  telegram_user_id bigint,
  telegram_username text,
  sender_name text,
  caption text not null default '' check (char_length(caption) <= 10000),
  photo_file_id text not null,
  photo_unique_id text not null,
  photo_storage_path text,
  photo_size_bytes bigint check (photo_size_bytes is null or photo_size_bytes between 1 and 10000000),
  photo_mime_type text check (photo_mime_type is null or photo_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  telegram_sent_at timestamptz not null,
  status text not null default 'receiving'
    check (status in ('receiving', 'new', 'processing', 'reviewed', 'ignored', 'failed')),
  processing_attempts integer not null default 0 check (processing_attempts >= 0),
  locked_at timestamptz,
  review_category text check (review_category is null or review_category in ('bug', 'content', 'user_error', 'question', 'duplicate', 'needs_info')),
  review_summary text check (review_summary is null or char_length(review_summary) <= 10000),
  review_basis text check (review_basis is null or char_length(review_basis) <= 10000),
  review_next_step text check (review_next_step is null or char_length(review_next_step) <= 5000),
  reviewed_at timestamptz,
  acknowledgement_message_id bigint,
  acknowledgement_started_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telegram_chat_id, telegram_message_id)
);

create index staff_telegram_qa_reports_queue_idx
  on public.staff_telegram_qa_reports (status, created_at, request_no);

create table public.staff_telegram_qa_report_history (
  id bigint generated always as identity primary key,
  report_id uuid not null references public.staff_telegram_qa_reports(id) on delete restrict,
  event_type text not null check (event_type in ('received', 'photo_saved', 'claimed', 'review_saved', 'claim_released', 'failed', 'acknowledged')),
  old_status text,
  new_status text,
  actor_type text not null check (actor_type in ('telegram', 'worker', 'system')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index staff_telegram_qa_report_history_idx
  on public.staff_telegram_qa_report_history (report_id, created_at, id);

create table public.staff_telegram_qa_release_approvals (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.staff_telegram_qa_reports(id) on delete restrict,
  preview_deployment_id text not null check (char_length(preview_deployment_id) between 1 and 128),
  preview_url text not null check (char_length(preview_url) between 1 and 512),
  commit_sha text not null check (commit_sha ~ '^[0-9a-f]{40,64}$'),
  summary text not null check (char_length(summary) between 1 and 4000),
  status text not null default 'pending'
    check (status in ('pending', 'rejected', 'publishing', 'deploying', 'published', 'failed')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_telegram_user_id bigint,
  telegram_approval_message_id bigint,
  production_deployment_id text check (production_deployment_id is null or char_length(production_deployment_id) between 1 and 128),
  production_url text check (production_url is null or char_length(production_url) between 1 and 512),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index staff_telegram_qa_one_active_release_per_report_idx
  on public.staff_telegram_qa_release_approvals (report_id)
  where status in ('pending', 'publishing', 'deploying');

create index staff_telegram_qa_release_queue_idx
  on public.staff_telegram_qa_release_approvals (status, requested_at, id);

create table public.staff_telegram_qa_release_history (
  id bigint generated always as identity primary key,
  approval_id uuid not null references public.staff_telegram_qa_release_approvals(id) on delete restrict,
  event_type text not null check (event_type in ('requested', 'approved', 'rejected', 'production_started', 'published', 'failed')),
  actor_telegram_user_id bigint,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index staff_telegram_qa_release_history_idx
  on public.staff_telegram_qa_release_history (approval_id, created_at, id);

alter table public.staff_telegram_qa_reports enable row level security;
alter table public.staff_telegram_qa_report_history enable row level security;
alter table public.staff_telegram_qa_release_approvals enable row level security;
alter table public.staff_telegram_qa_release_history enable row level security;

revoke all on public.staff_telegram_qa_reports,
  public.staff_telegram_qa_report_history,
  public.staff_telegram_qa_release_approvals,
  public.staff_telegram_qa_release_history
  from public, anon, authenticated;
grant all on public.staff_telegram_qa_reports,
  public.staff_telegram_qa_report_history,
  public.staff_telegram_qa_release_approvals,
  public.staff_telegram_qa_release_history
  to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-telegram-qa', 'staff-telegram-qa', false, 10000000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
  order by report.created_at, report.request_no
  for update skip locked
  limit 1;

  if not found then
    return;
  end if;

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

create or replace function public.staff_record_telegram_qa_review(
  p_report_id uuid,
  p_category text,
  p_summary text,
  p_basis text,
  p_next_step text,
  p_ignore boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.staff_telegram_qa_reports%rowtype;
  v_status text := case when p_ignore then 'ignored' else 'reviewed' end;
begin
  update public.staff_telegram_qa_reports as report
  set status = v_status,
      review_category = p_category,
      review_summary = btrim(p_summary),
      review_basis = nullif(btrim(p_basis), ''),
      review_next_step = nullif(btrim(p_next_step), ''),
      reviewed_at = now(),
      locked_at = null,
      updated_at = now()
  where report.id = p_report_id and report.status = 'processing'
  returning report.* into v_row;

  if not found then
    return false;
  end if;

  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (v_row.id, 'review_saved', 'processing', v_status, 'worker', jsonb_build_object(
    'category', v_row.review_category,
    'summary', v_row.review_summary,
    'basis', v_row.review_basis,
    'next_step', v_row.review_next_step
  ));
  return true;
end;
$$;

create or replace function public.staff_decide_telegram_qa_release(
  p_approval_id uuid,
  p_decision text,
  p_actor_telegram_user_id bigint
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_decision not in ('publish', 'reject') then
    raise exception 'Invalid release decision';
  end if;

  v_status := case when p_decision = 'publish' then 'publishing' else 'rejected' end;
  update public.staff_telegram_qa_release_approvals as approval
  set status = v_status,
      decided_at = now(),
      decided_by_telegram_user_id = p_actor_telegram_user_id,
      updated_at = now()
  where approval.id = p_approval_id and approval.status = 'pending';

  if not found then
    return null;
  end if;

  insert into public.staff_telegram_qa_release_history (approval_id, event_type, actor_telegram_user_id)
  values (p_approval_id, case when p_decision = 'publish' then 'approved' else 'rejected' end, p_actor_telegram_user_id);
  return v_status;
end;
$$;

create or replace function public.staff_record_telegram_qa_release_state(
  p_approval_id uuid,
  p_status text,
  p_error text default null,
  p_production_deployment_id text default null,
  p_production_url text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event text;
begin
  if p_status not in ('deploying', 'published', 'failed') then
    raise exception 'Invalid release state';
  end if;

  v_event := case p_status when 'deploying' then 'production_started' when 'published' then 'published' else 'failed' end;
  update public.staff_telegram_qa_release_approvals as approval
  set status = p_status,
      last_error = nullif(left(coalesce(p_error, ''), 2000), ''),
      production_deployment_id = coalesce(p_production_deployment_id, approval.production_deployment_id),
      production_url = coalesce(p_production_url, approval.production_url),
      updated_at = now()
  where approval.id = p_approval_id and approval.status in ('publishing', 'deploying');

  if not found then
    return false;
  end if;

  insert into public.staff_telegram_qa_release_history (approval_id, event_type, details)
  values (p_approval_id, v_event, jsonb_build_object(
    'status', p_status,
    'error', nullif(left(coalesce(p_error, ''), 2000), ''),
    'production_deployment_id', p_production_deployment_id,
    'production_url', p_production_url
  ));
  return true;
end;
$$;

create or replace function public.staff_release_telegram_qa_claim(
  p_report_id uuid,
  p_error text default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.staff_telegram_qa_reports%rowtype;
begin
  update public.staff_telegram_qa_reports as report
  set status = 'new',
      locked_at = null,
      last_error = nullif(left(coalesce(p_error, ''), 2000), ''),
      updated_at = now()
  where report.id = p_report_id and report.status = 'processing'
  returning report.* into v_row;

  if not found then
    return false;
  end if;

  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (p_report_id, 'claim_released', 'processing', 'new', 'worker', jsonb_build_object('error', v_row.last_error));
  return true;
end;
$$;

revoke all on function public.staff_claim_next_telegram_qa_report() from public, anon, authenticated;
revoke all on function public.staff_record_telegram_qa_review(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.staff_decide_telegram_qa_release(uuid, text, bigint) from public, anon, authenticated;
revoke all on function public.staff_record_telegram_qa_release_state(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.staff_release_telegram_qa_claim(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_claim_next_telegram_qa_report() to service_role;
grant execute on function public.staff_record_telegram_qa_review(uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.staff_decide_telegram_qa_release(uuid, text, bigint) to service_role;
grant execute on function public.staff_record_telegram_qa_release_state(uuid, text, text, text, text) to service_role;
grant execute on function public.staff_release_telegram_qa_claim(uuid, text) to service_role;
