alter table public.staff_telegram_qa_owner_questions
  add column response_source text not null default 'telegram'
    check (response_source in ('telegram', 'codex_chat')),
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column next_attempt_at timestamptz default now(),
  add column operator_followup text check (operator_followup is null or char_length(operator_followup) <= 2500);

create index staff_telegram_qa_owner_questions_retry_idx
  on public.staff_telegram_qa_owner_questions (next_attempt_at, answered_at)
  where status = 'answered' and next_attempt_at is not null;

alter table public.staff_telegram_qa_owner_question_history
  drop constraint staff_telegram_qa_owner_question_history_event_type_check;
alter table public.staff_telegram_qa_owner_question_history
  add constraint staff_telegram_qa_owner_question_history_event_type_check
  check (event_type in ('asked', 'answered', 'answer_amended', 'answer_deferred', 'resolved', 'delivery_failed'));

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

  if exists (
    select 1 from public.staff_telegram_qa_owner_questions
     where report_id = p_report_id and status in ('pending', 'answered')
  ) then
    return;
  end if;

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

drop function public.staff_answer_telegram_qa_owner_question(uuid, text, text, bigint);
create function public.staff_answer_telegram_qa_owner_question(
  p_question_id uuid,
  p_response_type text,
  p_response_text text,
  p_actor_telegram_user_id bigint,
  p_response_source text default 'telegram'
)
returns table (report_id uuid, request_no bigint)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_question public.staff_telegram_qa_owner_questions%rowtype;
  v_report public.staff_telegram_qa_reports%rowtype;
  v_event text;
begin
  if p_response_type not in ('yes', 'no', 'text') then raise exception 'Invalid response type'; end if;
  if p_response_source not in ('telegram', 'codex_chat') then raise exception 'Invalid response source'; end if;
  if p_response_source = 'telegram' and p_actor_telegram_user_id is null then raise exception 'Telegram actor is required'; end if;
  if p_response_source = 'codex_chat' and p_response_type <> 'text' then raise exception 'Chat answers must be text'; end if;
  if p_response_text is null or char_length(btrim(p_response_text)) = 0 or char_length(p_response_text) > 4000 then
    raise exception 'Invalid response text';
  end if;

  select * into v_question
    from public.staff_telegram_qa_owner_questions
   where id = p_question_id and status in ('pending', 'answered')
   for update;
  if not found then return; end if;

  select * into v_report
    from public.staff_telegram_qa_reports
   where id = v_question.report_id and status in ('new', 'awaiting_owner', 'processing')
   for update;
  if not found then return; end if;

  v_event := case when v_question.status = 'answered' then 'answer_amended' else 'answered' end;
  update public.staff_telegram_qa_owner_questions
     set status = 'answered', response_type = p_response_type, response_text = btrim(p_response_text),
         response_source = p_response_source, answered_by_telegram_user_id = p_actor_telegram_user_id,
         answered_at = now(), next_attempt_at = now(), operator_followup = null, updated_at = now()
   where id = p_question_id;

  update public.staff_telegram_qa_reports
     set status = 'processing', locked_at = now(), last_error = null, updated_at = now()
   where id = v_report.id;

  insert into public.staff_telegram_qa_owner_question_history (question_id, event_type, actor_telegram_user_id, details)
  values (p_question_id, v_event, p_actor_telegram_user_id,
    jsonb_build_object('response_type', p_response_type, 'response_text', btrim(p_response_text), 'response_source', p_response_source));
  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (v_report.id, 'owner_answered', v_report.status, 'processing',
    case when p_response_source = 'telegram' then 'telegram' else 'worker' end,
    jsonb_build_object('question_id', p_question_id, 'response_type', p_response_type, 'response_source', p_response_source));

  return query select v_report.id, v_report.request_no;
end;
$$;

create or replace function public.staff_defer_telegram_qa_owner_answer(
  p_question_id uuid,
  p_needs_clarification boolean,
  p_clarification text default ''
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_question public.staff_telegram_qa_owner_questions%rowtype;
  v_delay integer;
begin
  select * into v_question
    from public.staff_telegram_qa_owner_questions
   where id = p_question_id and status = 'answered'
   for update;
  if not found then return null; end if;

  if p_needs_clarification then
    update public.staff_telegram_qa_owner_questions
       set next_attempt_at = null,
           operator_followup = nullif(left(btrim(coalesce(p_clarification, '')), 2500), ''),
           updated_at = now()
     where id = p_question_id;
    insert into public.staff_telegram_qa_owner_question_history (question_id, event_type, details)
    values (p_question_id, 'answer_deferred', jsonb_build_object('reason', 'needs_owner_clarification'));
    return 0;
  end if;

  v_delay := least(3600, 300 * power(2, least(v_question.attempt_count, 4))::integer);
  update public.staff_telegram_qa_owner_questions
     set attempt_count = attempt_count + 1,
         next_attempt_at = now() + make_interval(secs => v_delay),
         operator_followup = null,
         updated_at = now()
   where id = p_question_id;
  insert into public.staff_telegram_qa_owner_question_history (question_id, event_type, details)
  values (p_question_id, 'answer_deferred', jsonb_build_object('retry_after_seconds', v_delay));
  return v_delay;
end;
$$;

revoke all on function public.staff_answer_telegram_qa_owner_question(uuid, text, text, bigint, text),
  public.staff_defer_telegram_qa_owner_answer(uuid, boolean, text)
  from public, anon, authenticated;
grant execute on function public.staff_answer_telegram_qa_owner_question(uuid, text, text, bigint, text),
  public.staff_defer_telegram_qa_owner_answer(uuid, boolean, text)
  to service_role;
