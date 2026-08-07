create or replace function public.save_day_routine_template(
  p_store_id uuid,
  p_routine_kind text,
  p_template_title text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_template_id uuid;
  v_user_id uuid := auth.uid();
  v_title text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_routine_kind not in ('morning', 'evening') then
    raise exception 'Invalid routine kind';
  end if;

  if not (
    app_private.current_user_has_role('developer')
    or (
      app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('store_manager')
      or app_private.current_user_has_role('auditor')
    )
  ) then
    raise exception 'Not allowed';
  end if;

  if not app_private.current_user_has_role('developer') and not app_private.current_user_can_access_store(p_store_id) then
    raise exception 'Store is not accessible';
  end if;

  v_title := coalesce(nullif(trim(both from p_template_title), ''), case p_routine_kind when 'morning' then 'Утренний распорядок' else 'Вечерний распорядок' end);

  insert into public.day_routine_templates (store_id, routine_kind, title, is_active, created_by, updated_by)
  values (p_store_id, p_routine_kind, v_title, true, v_user_id, v_user_id)
  on conflict (store_id, routine_kind)
  do update set
    title = excluded.title,
    is_active = true,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning id into v_template_id;

  delete from public.day_routine_template_items where template_id = v_template_id;

  perform app_private.insert_day_routine_template_items(
    v_template_id,
    null,
    coalesce(p_items, app_private.day_routine_default_template(p_routine_kind)),
    0,
    v_user_id
  );

  perform app_private.populate_day_routine_item_keys(v_template_id, null, null);

  return v_template_id;
end;
$$;

revoke all on function public.save_day_routine_template(uuid, text, text, jsonb) from public;
grant execute on function public.save_day_routine_template(uuid, text, text, jsonb) to authenticated;

create or replace function app_private.toggle_day_routine_item_completion(
  p_shift_id uuid,
  p_routine_kind text,
  p_template_item_id uuid,
  p_completed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_user_id uuid := auth.uid();
  v_employee_id uuid;
  v_shift record;
  v_template_id uuid;
  v_session_id uuid;
  v_template_item record;
  v_employee_name text;
  v_store_name text;
  v_store_timezone text;
  v_now timestamptz := now();
  v_local_now timestamp;
  v_started_notification_at timestamptz;
  v_completed_notification_at timestamptz;
  v_total_count integer := 0;
  v_completed_count integer := 0;
  v_result jsonb;
  v_item_exists boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_routine_kind not in ('morning', 'evening') then
    raise exception 'Invalid routine kind';
  end if;

  v_employee_id := app_private.current_user_employee_id();
  if v_employee_id is null then
    raise exception 'Employee profile not found';
  end if;

  select sh.id, sh.store_id, sh.shift_date, sh.status, sh.opened_by_employee_id, s.name, s.timezone
    into v_shift
  from public.shifts sh
  join public.stores s on s.id = sh.store_id
  where sh.id = p_shift_id
    and sh.status in ('opened', 'correction_required')
    and (
      app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('store_manager')
      or sh.opened_by_employee_id = v_employee_id
    );

  if v_shift.id is null then
    raise exception 'Shift not found';
  end if;

  if not app_private.current_user_has_role('developer') and not app_private.current_user_can_access_store(v_shift.store_id) then
    raise exception 'Store is not accessible';
  end if;

  v_store_name := v_shift.name;
  v_store_timezone := coalesce(v_shift.timezone, 'Asia/Vladivostok');
  v_local_now := timezone(v_store_timezone, v_now);

  select id
    into v_template_id
  from public.day_routine_templates
  where store_id = v_shift.store_id
    and routine_kind = p_routine_kind
    and is_active = true;

  if v_template_id is null then
    insert into public.day_routine_templates (store_id, routine_kind, title, is_active, created_by, updated_by)
    values (
      v_shift.store_id,
      p_routine_kind,
      case p_routine_kind when 'morning' then 'Утренний распорядок' else 'Вечерний распорядок' end,
      true,
      v_user_id,
      v_user_id
    )
    returning id into v_template_id;

    perform app_private.insert_day_routine_template_items(
      v_template_id,
      null,
      app_private.day_routine_default_template(p_routine_kind),
      0,
      v_user_id
    );

    perform app_private.populate_day_routine_item_keys(v_template_id, null, null);
  end if;

  select id, started_notification_sent_at, completed_notification_sent_at
    into v_session_id, v_started_notification_at, v_completed_notification_at
  from public.day_routine_sessions
  where shift_id = p_shift_id
    and employee_id = v_employee_id
    and routine_kind = p_routine_kind;

  if v_session_id is null then
    insert into public.day_routine_sessions (
      store_id,
      shift_id,
      employee_id,
      routine_kind,
      routine_date,
      started_at,
      created_by,
      updated_by
    )
    values (
      v_shift.store_id,
      p_shift_id,
      v_employee_id,
      p_routine_kind,
      v_shift.shift_date,
      v_now,
      v_user_id,
      v_user_id
    )
    returning id, started_notification_sent_at into v_session_id, v_started_notification_at;
  end if;

  select id, title, level
    into v_template_item
  from public.day_routine_template_items
  where id = p_template_item_id
    and template_id = v_template_id
    and is_active = true;

  if v_template_item.id is null then
    raise exception 'Template item not found';
  end if;

  if p_completed then
    insert into public.day_routine_session_items (
      session_id,
      template_item_id,
      title_snapshot,
      parent_title_snapshot,
      level,
      created_by
    )
    select
      v_session_id,
      template_item_row.id,
      template_item_row.title,
      parent_item.title,
      template_item_row.level,
      v_user_id
    from public.day_routine_template_items as template_item_row
    left join public.day_routine_template_items parent_item on parent_item.id = template_item_row.parent_item_id
    where template_item_row.id = p_template_item_id
    on conflict (session_id, template_item_id)
    do update set
      title_snapshot = excluded.title_snapshot,
      parent_title_snapshot = excluded.parent_title_snapshot,
      level = excluded.level;

    select count(*) into v_total_count
    from public.day_routine_template_items
    where template_id = v_template_id
      and is_active = true;

    select count(*) into v_completed_count
    from public.day_routine_session_items
    where session_id = v_session_id;

    if v_completed_count > 0 and not exists (
      select 1
      from public.day_routine_sessions s
      where s.id = v_session_id
        and s.started_notification_sent_at is not null
    ) then
      select e.full_name into v_employee_name
      from public.employees e
      where e.id = v_shift.opened_by_employee_id;

      perform app_private.notify_store_managers(
        v_shift.store_id,
        case p_routine_kind when 'morning' then 'morning_routine_started' else 'evening_routine_started' end,
        case p_routine_kind when 'morning' then 'Утренний распорядок начат' else 'Вечерний распорядок начат' end,
        coalesce(v_employee_name, 'Сотрудник') || ' ' || v_store_name || ' начал заполнение ' || case p_routine_kind when 'morning' then 'утреннего' else 'вечернего' end || ' распорядка в ' || to_char(v_local_now, 'HH24:MI'),
        'day_routine',
        v_session_id
      );

      update public.day_routine_sessions
         set started_notification_sent_at = v_now,
             updated_at = now(),
             updated_by = v_user_id
       where id = v_session_id;
    end if;

    if v_total_count > 0 and v_completed_count >= v_total_count and not exists (
      select 1
      from public.day_routine_sessions s
      where s.id = v_session_id
        and s.completed_notification_sent_at is not null
    ) then
      select e.full_name into v_employee_name
      from public.employees e
      where e.id = v_shift.opened_by_employee_id;

      perform app_private.notify_store_managers(
        v_shift.store_id,
        case p_routine_kind when 'morning' then 'morning_routine_completed' else 'evening_routine_completed' end,
        case p_routine_kind when 'morning' then 'Утренний распорядок заполнен' else 'Вечерний распорядок заполнен' end,
        coalesce(v_employee_name, 'Сотрудник') || ' ' || v_store_name || ' заполнил ' || case p_routine_kind when 'morning' then 'утренний' else 'вечерний' end || ' распорядок дня в ' || to_char(v_local_now, 'HH24:MI'),
        'day_routine',
        v_session_id
      );

      update public.day_routine_sessions
         set completed_at = v_now,
             completed_notification_sent_at = v_now,
             updated_at = now(),
             updated_by = v_user_id
       where id = v_session_id;
    end if;
  else
    delete from public.day_routine_session_items
    where session_id = v_session_id
      and template_item_id = p_template_item_id;

    if not exists (
      select 1
      from public.day_routine_session_items
      where session_id = v_session_id
    ) then
      update public.day_routine_sessions
         set completed_at = null,
             completed_notification_sent_at = null,
             updated_at = now(),
             updated_by = v_user_id
       where id = v_session_id;
    end if;
  end if;

  select jsonb_build_object(
    'session_id', v_session_id,
    'template_id', v_template_id,
    'completed_count', (select count(*) from public.day_routine_session_items where session_id = v_session_id),
    'total_count', (select count(*) from public.day_routine_template_items where template_id = v_template_id and is_active = true),
    'started_at', (select started_at from public.day_routine_sessions where id = v_session_id),
    'completed_at', (select completed_at from public.day_routine_sessions where id = v_session_id)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function app_private.toggle_day_routine_item_completion(uuid, text, uuid, boolean) from public;
grant execute on function app_private.toggle_day_routine_item_completion(uuid, text, uuid, boolean) to authenticated;

create or replace function public.toggle_day_routine_item_completion(
  p_shift_id uuid,
  p_routine_kind text,
  p_template_item_id uuid,
  p_completed boolean default true
)
returns jsonb
language sql
security definer
set search_path = public, app_private
as $$
  select app_private.toggle_day_routine_item_completion(p_shift_id, p_routine_kind, p_template_item_id, p_completed);
$$;

revoke all on function public.toggle_day_routine_item_completion(uuid, text, uuid, boolean) from public;
grant execute on function public.toggle_day_routine_item_completion(uuid, text, uuid, boolean) to authenticated;
