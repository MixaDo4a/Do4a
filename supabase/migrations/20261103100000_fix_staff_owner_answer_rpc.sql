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

  select report.request_no into v_request_no
    from public.staff_telegram_qa_reports as report
   where report.id = v_question.report_id;

  insert into public.staff_telegram_qa_owner_question_history (question_id, event_type, actor_telegram_user_id, details)
  values (p_question_id, 'answered', p_actor_telegram_user_id,
    jsonb_build_object('response_type', p_response_type, 'response_text', btrim(p_response_text)));
  insert into public.staff_telegram_qa_report_history (report_id, event_type, old_status, new_status, actor_type, details)
  values (v_question.report_id, 'owner_answered', 'awaiting_owner', 'processing', 'telegram',
    jsonb_build_object('question_id', p_question_id, 'response_type', p_response_type, 'response_text', btrim(p_response_text)));

  return query select v_question.report_id, v_request_no;
end;
$$;
