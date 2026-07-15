create or replace function app_private.run_notification_cron(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_task_deadline_soon integer := 0;
  v_task_overdue integer := 0;
  v_shift_reminder integer := 0;
  v_shift_not_opened integer := 0;
  v_shift_not_closed integer := 0;
begin
  insert into public.cron_job_runs (job_name, status, started_at)
  values ('notification_cron', 'running', p_now);

  with due_tasks as (
    select t.id, t.assignee_employee_id, t.store_id, t.due_at
    from public.tasks t
    where t.status in ('open', 'in_progress')
      and t.due_at is not null
      and t.due_at > p_now
      and t.due_at <= p_now + interval '30 minutes'
      and not exists (
        select 1
        from public.notifications n
        where n.event_type = 'task_deadline_soon'
          and n.related_entity_type = 'task'
          and n.related_entity_id = t.id
      )
  )
  select count(*) into v_task_deadline_soon from due_tasks;

  perform app_private.notify_employee(
    dt.assignee_employee_id,
    'task_deadline_soon',
    'Дедлайн задачи',
    to_char(dt.due_at, 'YYYY-MM-DD HH24:MI'),
    'task',
    dt.id
  )
  from (
    select t.id, t.assignee_employee_id, t.due_at
    from public.tasks t
    where t.status in ('open', 'in_progress')
      and t.due_at is not null
      and t.due_at > p_now
      and t.due_at <= p_now + interval '30 minutes'
      and not exists (
        select 1
        from public.notifications n
        where n.event_type = 'task_deadline_soon'
          and n.related_entity_type = 'task'
          and n.related_entity_id = t.id
      )
  ) dt;

  with overdue_tasks as (
    select t.id, t.assignee_employee_id, t.store_id
    from public.tasks t
    where t.status in ('open', 'in_progress')
      and t.due_at is not null
      and t.due_at <= p_now
      and not exists (
        select 1
        from public.notifications n
        where n.event_type = 'task_overdue'
          and n.related_entity_type = 'task'
          and n.related_entity_id = t.id
      )
  )
  select count(*) into v_task_overdue from overdue_tasks;

  insert into public.notifications (
    recipient_profile_id,
    event_type,
    title,
    body,
    related_entity_type,
    related_entity_id
  )
  select distinct p.id, 'task_overdue', 'Задача просрочена', coalesce(t.title, 'Задача просрочена'), 'task', t.id
  from public.tasks t
  join public.profiles p on p.employee_id = t.assignee_employee_id
  where t.status in ('open', 'in_progress')
    and t.due_at is not null
    and t.due_at <= p_now
    and p.is_blocked = false
    and not exists (
      select 1
      from public.notifications n
      where n.event_type = 'task_overdue'
        and n.related_entity_type = 'task'
        and n.related_entity_id = t.id
        and n.recipient_profile_id = p.id
    );

  perform app_private.notify_store_employees(
    t.store_id,
    'task_overdue',
    'Задача просрочена',
    coalesce(t.title, 'Задача просрочена'),
    'task',
    t.id
  )
  from public.tasks t
  where t.status in ('open', 'in_progress')
    and t.due_at is not null
    and t.due_at <= p_now
    and not exists (
      select 1
      from public.notifications n
      where n.event_type = 'task_overdue'
        and n.related_entity_type = 'task'
        and n.related_entity_id = t.id
    );

  perform app_private.notify_store_managers(
    t.store_id,
    'task_overdue',
    'Задача просрочена',
    coalesce(t.title, 'Задача просрочена'),
    'task',
    t.id
  )
  from public.tasks t
  where t.status in ('open', 'in_progress')
    and t.due_at is not null
    and t.due_at <= p_now
    and not exists (
      select 1
      from public.notifications n
      where n.event_type = 'task_overdue'
        and n.related_entity_type = 'task'
        and n.related_entity_id = t.id
    );

  with upcoming_schedules as (
    select s.id, s.employee_id, s.store_id, s.shift_date, s.planned_start_at
    from public.schedules s
    where s.status = 'planned'
      and s.planned_start_at > p_now
      and s.planned_start_at <= p_now + interval '15 hours'
      and not exists (
        select 1
        from public.notifications n
        where n.event_type = 'shift_reminder'
          and n.related_entity_type = 'schedule'
          and n.related_entity_id = s.id
      )
  )
  select count(*) into v_shift_reminder from upcoming_schedules;

  perform app_private.notify_employee(
    us.employee_id,
    'shift_reminder',
    'Смена скоро',
    to_char(us.planned_start_at, 'YYYY-MM-DD HH24:MI'),
    'schedule',
    us.id
  )
  from (
    select s.id, s.employee_id, s.planned_start_at
    from public.schedules s
    where s.status = 'planned'
      and s.planned_start_at > p_now
      and s.planned_start_at <= p_now + interval '15 hours'
      and not exists (
        select 1
        from public.notifications n
        where n.event_type = 'shift_reminder'
          and n.related_entity_type = 'schedule'
          and n.related_entity_id = s.id
      )
  ) us;

  insert into public.notifications (
    recipient_profile_id,
    event_type,
    title,
    body,
    related_entity_type,
    related_entity_id
  )
  select distinct p.id, 'shift_not_opened', 'Смена не открыта вовремя', s.shift_date::text, 'schedule', s.id
  from public.schedules s
  join public.profiles p on p.employee_id = s.employee_id
  where s.status = 'planned'
    and s.planned_start_at <= p_now
    and p.is_blocked = false
    and not exists (
      select 1
      from public.shifts sh
      where sh.store_id = s.store_id
        and sh.shift_date = s.shift_date
    )
    and not exists (
      select 1
      from public.notifications n
      where n.event_type = 'shift_not_opened'
        and n.related_entity_type = 'schedule'
        and n.related_entity_id = s.id
        and n.recipient_profile_id = p.id
    );
  select count(*) into v_shift_not_opened from public.schedules s
  where s.status = 'planned'
    and s.planned_start_at <= p_now
    and not exists (
      select 1
      from public.shifts sh
      where sh.store_id = s.store_id
        and sh.shift_date = s.shift_date
    );

  insert into public.notifications (
    recipient_profile_id,
    event_type,
    title,
    body,
    related_entity_type,
    related_entity_id
  )
  select distinct p.id, 'shift_not_closed', 'Смена не закрыта вовремя', sh.shift_date::text, 'shift', sh.id
  from public.shifts sh
  join public.profiles p on p.employee_id = sh.opened_by_employee_id
  join public.schedules s on s.store_id = sh.store_id and s.shift_date = sh.shift_date and s.employee_id = sh.opened_by_employee_id
  where sh.status = 'opened'
    and s.planned_end_at <= p_now
    and p.is_blocked = false
    and not exists (
      select 1
      from public.notifications n
      where n.event_type = 'shift_not_closed'
        and n.related_entity_type = 'shift'
        and n.related_entity_id = sh.id
        and n.recipient_profile_id = p.id
    );

  perform app_private.notify_store_managers(
    sh.store_id,
    'shift_not_closed',
    'Смена не закрыта вовремя',
    sh.shift_date::text,
    'shift',
    sh.id
  )
  from public.shifts sh
  join public.schedules s on s.store_id = sh.store_id and s.shift_date = sh.shift_date and s.employee_id = sh.opened_by_employee_id
  where sh.status = 'opened'
    and s.planned_end_at <= p_now
    and not exists (
      select 1
      from public.notifications n
      where n.event_type = 'shift_not_closed'
        and n.related_entity_type = 'shift'
        and n.related_entity_id = sh.id
    );
  select count(*) into v_shift_not_closed
  from public.shifts sh
  join public.schedules s on s.store_id = sh.store_id and s.shift_date = sh.shift_date and s.employee_id = sh.opened_by_employee_id
  where sh.status = 'opened'
    and s.planned_end_at <= p_now;

  insert into public.cron_job_runs (job_name, status, started_at, finished_at, details)
  values (
    'notification_cron',
    'success',
    p_now,
    now(),
    jsonb_build_object(
      'task_deadline_soon', v_task_deadline_soon,
      'task_overdue', v_task_overdue,
      'shift_reminder', v_shift_reminder,
      'shift_not_opened', v_shift_not_opened,
      'shift_not_closed', v_shift_not_closed
    )
  );

  return jsonb_build_object(
    'task_deadline_soon', v_task_deadline_soon,
    'task_overdue', v_task_overdue,
    'shift_reminder', v_shift_reminder,
    'shift_not_opened', v_shift_not_opened,
    'shift_not_closed', v_shift_not_closed
  );
exception
  when others then
    insert into public.cron_job_runs (job_name, status, started_at, finished_at, error_message)
    values ('notification_cron', 'failed', p_now, now(), sqlerrm);
    raise;
end;
$$;
