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
  v_shift_end_reminder integer := 0;
  v_shift_not_opened integer := 0;
  v_shift_not_closed integer := 0;
  v_task_row record;
  v_schedule_row record;
  v_shift_row record;
begin
  for v_task_row in
    select t.id, t.store_id, t.assignee_employee_id, t.title, t.due_at
    from public.tasks t
    where t.status in ('open', 'in_progress')
      and t.due_at is not null
      and t.due_at > p_now
      and t.due_at <= p_now + interval '30 minutes'
  loop
    if not exists (
      select 1
      from public.notifications n
      join public.profiles p on p.id = n.recipient_profile_id
      where p.employee_id = v_task_row.assignee_employee_id
        and n.event_type = 'task_deadline_soon'
        and n.related_entity_type = 'task'
        and n.related_entity_id = v_task_row.id
    ) then
      perform app_private.notify_employee(
        v_task_row.assignee_employee_id,
        'task_deadline_soon',
        'Дедлайн задачи',
        coalesce(v_task_row.title, to_char(v_task_row.due_at, 'YYYY-MM-DD HH24:MI')),
        'task',
        v_task_row.id
      );
      v_task_deadline_soon := v_task_deadline_soon + 1;
    end if;
  end loop;

  for v_task_row in
    select t.id, t.store_id, t.assignee_employee_id, t.title
    from public.tasks t
    where t.status in ('open', 'in_progress')
      and t.due_at is not null
      and t.due_at <= p_now
  loop
    if not exists (
      select 1
      from public.notifications n
      join public.profiles p on p.id = n.recipient_profile_id
      where p.employee_id = v_task_row.assignee_employee_id
        and n.event_type = 'task_overdue'
        and n.related_entity_type = 'task'
        and n.related_entity_id = v_task_row.id
    ) then
      perform app_private.notify_employee(
        v_task_row.assignee_employee_id,
        'task_overdue',
        'Задача просрочена',
        coalesce(v_task_row.title, 'Задача просрочена'),
        'task',
        v_task_row.id
      );
      perform app_private.notify_store_employees(
        v_task_row.store_id,
        'task_overdue',
        'Задача просрочена',
        coalesce(v_task_row.title, 'Задача просрочена'),
        'task',
        v_task_row.id
      );
      perform app_private.notify_store_managers(
        v_task_row.store_id,
        'task_overdue',
        'Задача просрочена',
        coalesce(v_task_row.title, 'Задача просрочена'),
        'task',
        v_task_row.id
      );
      v_task_overdue := v_task_overdue + 1;
    end if;
  end loop;

  for v_schedule_row in
    select s.id, s.store_id, s.employee_id, s.shift_date, s.planned_start_at
    from public.schedules s
    where s.status = 'planned'
      and s.planned_start_at > p_now
      and s.planned_start_at <= p_now + interval '15 hours'
  loop
    if not exists (
      select 1
      from public.notifications n
      join public.profiles p on p.id = n.recipient_profile_id
      where p.employee_id = v_schedule_row.employee_id
        and n.event_type = 'shift_reminder'
        and n.related_entity_type = 'schedule'
        and n.related_entity_id = v_schedule_row.id
    ) then
      perform app_private.notify_employee(
        v_schedule_row.employee_id,
        'shift_reminder',
        'Смена скоро',
        to_char(v_schedule_row.planned_start_at, 'YYYY-MM-DD HH24:MI'),
        'schedule',
        v_schedule_row.id
      );
      v_shift_reminder := v_shift_reminder + 1;
    end if;
  end loop;

  for v_shift_row in
    select sh.id, sh.store_id, sh.opened_by_employee_id, sh.shift_date, s.planned_end_at
    from public.shifts sh
    join public.schedules s
      on s.store_id = sh.store_id
     and s.shift_date = sh.shift_date
     and s.employee_id = sh.opened_by_employee_id
    where sh.status = 'opened'
      and s.planned_end_at > p_now
      and s.planned_end_at <= p_now + interval '30 minutes'
  loop
    if not exists (
      select 1
      from public.notifications n
      join public.profiles p on p.id = n.recipient_profile_id
      where p.employee_id = v_shift_row.opened_by_employee_id
        and n.event_type = 'shift_end_reminder'
        and n.related_entity_type = 'shift'
        and n.related_entity_id = v_shift_row.id
    ) then
      perform app_private.notify_employee(
        v_shift_row.opened_by_employee_id,
        'shift_end_reminder',
        'Смена скоро закончится',
        to_char(v_shift_row.planned_end_at, 'YYYY-MM-DD HH24:MI'),
        'shift',
        v_shift_row.id
      );
      v_shift_end_reminder := v_shift_end_reminder + 1;
    end if;
  end loop;

  for v_schedule_row in
    select s.id, s.store_id, s.employee_id, s.shift_date
    from public.schedules s
    where s.status = 'planned'
      and s.planned_start_at <= p_now
      and not exists (
        select 1
        from public.shifts sh
        where sh.store_id = s.store_id
          and sh.shift_date = s.shift_date
      )
  loop
    if not exists (
      select 1
      from public.notifications n
      join public.profiles p on p.id = n.recipient_profile_id
      where p.employee_id = v_schedule_row.employee_id
        and n.event_type = 'shift_not_opened'
        and n.related_entity_type = 'schedule'
        and n.related_entity_id = v_schedule_row.id
    ) then
      perform app_private.notify_employee(
        v_schedule_row.employee_id,
        'shift_not_opened',
        'Смена не открыта вовремя',
        v_schedule_row.shift_date::text,
        'schedule',
        v_schedule_row.id
      );
      perform app_private.notify_store_managers(
        v_schedule_row.store_id,
        'shift_not_opened',
        'Смена не открыта вовремя',
        v_schedule_row.shift_date::text,
        'schedule',
        v_schedule_row.id
      );
      v_shift_not_opened := v_shift_not_opened + 1;
    end if;
  end loop;

  for v_shift_row in
    select sh.id, sh.store_id, sh.opened_by_employee_id, sh.shift_date, s.planned_end_at
    from public.shifts sh
    join public.schedules s
      on s.store_id = sh.store_id
     and s.shift_date = sh.shift_date
     and s.employee_id = sh.opened_by_employee_id
    where sh.status = 'opened'
      and s.planned_end_at <= p_now
  loop
    if not exists (
      select 1
      from public.notifications n
      join public.profiles p on p.id = n.recipient_profile_id
      where p.employee_id = v_shift_row.opened_by_employee_id
        and n.event_type = 'shift_not_closed'
        and n.related_entity_type = 'shift'
        and n.related_entity_id = v_shift_row.id
    ) then
      perform app_private.notify_employee(
        v_shift_row.opened_by_employee_id,
        'shift_not_closed',
        'Смена не закрыта вовремя',
        v_shift_row.shift_date::text,
        'shift',
        v_shift_row.id
      );
      perform app_private.notify_store_managers(
        v_shift_row.store_id,
        'shift_not_closed',
        'Смена не закрыта вовремя',
        v_shift_row.shift_date::text,
        'shift',
        v_shift_row.id
      );
      v_shift_not_closed := v_shift_not_closed + 1;
    end if;
  end loop;

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
      'shift_end_reminder', v_shift_end_reminder,
      'shift_not_opened', v_shift_not_opened,
      'shift_not_closed', v_shift_not_closed
    )
  );

  return jsonb_build_object(
    'task_deadline_soon', v_task_deadline_soon,
    'task_overdue', v_task_overdue,
    'shift_reminder', v_shift_reminder,
    'shift_end_reminder', v_shift_end_reminder,
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

grant execute on function app_private.run_notification_cron(timestamptz) to authenticated;
