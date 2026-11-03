alter table public.staff_telegram_qa_reports
  drop constraint staff_telegram_qa_reports_status_check;
alter table public.staff_telegram_qa_reports
  add constraint staff_telegram_qa_reports_status_check
  check (status in ('receiving', 'new', 'processing', 'awaiting_owner', 'reviewed', 'ignored', 'failed'));

alter table public.staff_telegram_qa_report_history
  drop constraint staff_telegram_qa_report_history_event_type_check;
alter table public.staff_telegram_qa_report_history
  add constraint staff_telegram_qa_report_history_event_type_check
  check (event_type in (
    'received', 'photo_saved', 'claimed', 'review_saved', 'claim_released', 'failed',
    'acknowledged', 'owner_questioned', 'owner_answered', 'owner_question_failed'
  ));

create table public.staff_telegram_qa_owner_questions (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.staff_telegram_qa_reports(id) on delete restrict,
  question text not null check (char_length(question) between 1 and 4000),
  context text not null default '' check (char_length(context) <= 5000),
  status text not null default 'pending' check (status in ('pending', 'answered', 'resolved', 'failed')),
  response_type text check (response_type is null or response_type in ('yes', 'no', 'text')),
  response_text text check (response_text is null or char_length(response_text) <= 4000),
  telegram_message_id bigint,
  answered_by_telegram_user_id bigint,
  answered_at timestamptz,
  resolved_at timestamptz,
  resolution_summary text check (resolution_summary is null or char_length(resolution_summary) <= 4000),
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index staff_telegram_qa_owner_questions_one_pending_per_report_idx
  on public.staff_telegram_qa_owner_questions (report_id)
  where status = 'pending';
create index staff_telegram_qa_owner_questions_answered_idx
  on public.staff_telegram_qa_owner_questions (answered_at, id)
  where status = 'answered';
create unique index staff_telegram_qa_owner_questions_message_idx
  on public.staff_telegram_qa_owner_questions (telegram_message_id)
  where telegram_message_id is not null;

create table public.staff_telegram_qa_owner_question_history (
  id bigint generated always as identity primary key,
  question_id uuid not null references public.staff_telegram_qa_owner_questions(id) on delete restrict,
  event_type text not null check (event_type in ('asked', 'answered', 'resolved', 'delivery_failed')),
  actor_telegram_user_id bigint,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index staff_telegram_qa_owner_question_history_idx
  on public.staff_telegram_qa_owner_question_history (question_id, created_at, id);

alter table public.staff_telegram_qa_owner_questions enable row level security;
alter table public.staff_telegram_qa_owner_question_history enable row level security;
revoke all on public.staff_telegram_qa_owner_questions,
  public.staff_telegram_qa_owner_question_history from public, anon, authenticated;
grant all on public.staff_telegram_qa_owner_questions,
  public.staff_telegram_qa_owner_question_history to service_role;
grant usage, select on sequence public.staff_telegram_qa_owner_question_history_id_seq to service_role;

create or replace function public.staff_create_telegram_qa_owner_question(
  p_report_id uuid,
  p_question text,
  p_context text default ''
)
returns table (question_id uuid, request_no bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report public.staff_telegram_qa_reports%rowtype;
  v_question public.staff_telegram_qa_owner_questions%rowtype;
begin
  select * into v_report
    from public.staff_telegram_qa_reports
   where id = p_report_id and status = 'processing'
   for update;
  if not found then return; end if;

  insert into public.staff_telegram_qa_owner_questions (report_id, question, context)
  values (p_report_id, btrim(p_question), btrim(coalesce(p_context, '')))
  returning * into v_question;

  update public.staff_telegram_qa_reports
     set status = 'awaiting_owner', locked_at = null, updated_at = now()
   where id = p_report_id;

  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (p_report_id, 'owner_questioned', 'processing', 'awaiting_owner', 'worker',
    jsonb_build_object('question_id', v_question.id));

  return query select v_question.id, v_report.request_no;
end;
$$;

create or replace function public.staff_answer_telegram_qa_owner_question(
  p_question_id uuid,
  p_response_type text,
  p_response_text text,
  p_actor_telegram_user_id bigint
)
returns table (report_id uuid, request_no bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_question public.staff_telegram_qa_owner_questions%rowtype;
  v_request_no bigint;
begin
  if p_response_type not in ('yes', 'no', 'text') then raise exception 'Invalid response type'; end if;
  if p_response_text is null or char_length(btrim(p_response_text)) = 0 or char_length(p_response_text) > 4000 then
    raise exception 'Invalid response text';
  end if;

  update public.staff_telegram_qa_owner_questions
     set status = 'answered', response_type = p_response_type, response_text = btrim(p_response_text),
         answered_by_telegram_user_id = p_actor_telegram_user_id, answered_at = now(), updated_at = now()
   where id = p_question_id and status = 'pending'
   returning * into v_question;
  if not found then return; end if;

  update public.staff_telegram_qa_reports
     set status = 'processing', locked_at = now(), last_error = null, updated_at = now()
   where id = v_question.report_id and status = 'awaiting_owner';
  if not found then raise exception 'Report is not awaiting owner'; end if;

  select request_no into v_request_no from public.staff_telegram_qa_reports where id = v_question.report_id;

  insert into public.staff_telegram_qa_owner_question_history (question_id, event_type, actor_telegram_user_id, details)
  values (p_question_id, 'answered', p_actor_telegram_user_id,
    jsonb_build_object('response_type', p_response_type, 'response_text', btrim(p_response_text)));
  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (v_question.report_id, 'owner_answered', 'awaiting_owner', 'processing', 'telegram',
    jsonb_build_object('question_id', p_question_id, 'response_type', p_response_type, 'response_text', btrim(p_response_text)));

  return query select v_question.report_id, v_request_no;
end;
$$;

create or replace function public.staff_resolve_telegram_qa_owner_question(
  p_question_id uuid,
  p_summary text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_summary is null or char_length(btrim(p_summary)) = 0 or char_length(p_summary) > 4000 then
    raise exception 'Invalid resolution summary';
  end if;

  update public.staff_telegram_qa_owner_questions
     set status = 'resolved', resolution_summary = btrim(p_summary), resolved_at = now(), updated_at = now()
   where id = p_question_id and status = 'answered';
  if not found then return false; end if;

  insert into public.staff_telegram_qa_owner_question_history (question_id, event_type, details)
  values (p_question_id, 'resolved', jsonb_build_object('summary', btrim(p_summary)));
  return true;
end;
$$;

create or replace function public.staff_fail_telegram_qa_owner_question(
  p_question_id uuid,
  p_error text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_report_id uuid;
begin
  update public.staff_telegram_qa_owner_questions
     set status = 'failed', last_error = left(coalesce(p_error, 'Telegram delivery failed'), 1000), updated_at = now()
   where id = p_question_id and status = 'pending'
   returning report_id into v_report_id;
  if not found then return false; end if;

  update public.staff_telegram_qa_reports
     set status = 'processing', locked_at = now(), last_error = left(coalesce(p_error, 'Telegram delivery failed'), 1000), updated_at = now()
   where id = v_report_id and status = 'awaiting_owner';
  insert into public.staff_telegram_qa_owner_question_history (question_id, event_type, details)
  values (p_question_id, 'delivery_failed', jsonb_build_object('error', left(coalesce(p_error, 'Telegram delivery failed'), 1000)));
  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (v_report_id, 'owner_question_failed', 'awaiting_owner', 'processing', 'system',
    jsonb_build_object('question_id', p_question_id, 'error', left(coalesce(p_error, 'Telegram delivery failed'), 1000)));
  return true;
end;
$$;

revoke all on function public.staff_create_telegram_qa_owner_question(uuid, text, text),
  public.staff_answer_telegram_qa_owner_question(uuid, text, text, bigint),
  public.staff_resolve_telegram_qa_owner_question(uuid, text),
  public.staff_fail_telegram_qa_owner_question(uuid, text)
  from public, anon, authenticated;
grant execute on function public.staff_create_telegram_qa_owner_question(uuid, text, text),
  public.staff_answer_telegram_qa_owner_question(uuid, text, text, bigint),
  public.staff_resolve_telegram_qa_owner_question(uuid, text),
  public.staff_fail_telegram_qa_owner_question(uuid, text)
  to service_role;
