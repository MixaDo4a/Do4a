create table if not exists public.day_routine_templates (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  routine_kind text not null check (routine_kind in ('morning', 'evening')),
  title text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (store_id, routine_kind)
);

create table if not exists public.day_routine_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.day_routine_templates(id) on delete cascade,
  parent_item_id uuid references public.day_routine_template_items(id) on delete cascade,
  title text not null,
  level integer not null default 0,
  sort_order integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create index if not exists day_routine_template_items_template_idx
  on public.day_routine_template_items(template_id, parent_item_id, sort_order, id);

create table if not exists public.day_routine_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  routine_kind text not null check (routine_kind in ('morning', 'evening')),
  routine_date date not null,
  started_at timestamptz not null default now(),
  started_notification_sent_at timestamptz,
  completed_at timestamptz,
  completed_notification_sent_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  unique (shift_id, employee_id, routine_kind)
);

create index if not exists day_routine_sessions_store_kind_idx
  on public.day_routine_sessions(store_id, routine_kind, routine_date desc, started_at desc);

create table if not exists public.day_routine_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.day_routine_sessions(id) on delete cascade,
  template_item_id uuid references public.day_routine_template_items(id) on delete set null,
  title_snapshot text not null,
  parent_title_snapshot text,
  level integer not null default 0,
  completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  unique (session_id, template_item_id)
);

create index if not exists day_routine_session_items_session_idx
  on public.day_routine_session_items(session_id, completed_at desc);

create table if not exists public.day_routine_reminder_log (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  routine_kind text not null check (routine_kind in ('morning', 'evening')),
  routine_date date not null,
  notification_kind text not null,
  sent_at timestamptz not null default now(),
  unique (shift_id, employee_id, routine_kind, routine_date, notification_kind)
);

create index if not exists day_routine_reminder_log_lookup_idx
  on public.day_routine_reminder_log(store_id, routine_kind, routine_date, notification_kind);

drop trigger if exists set_day_routine_templates_updated_at on public.day_routine_templates;
create trigger set_day_routine_templates_updated_at
  before update on public.day_routine_templates
  for each row execute function public.set_updated_at();

drop trigger if exists set_day_routine_template_items_updated_at on public.day_routine_template_items;
create trigger set_day_routine_template_items_updated_at
  before update on public.day_routine_template_items
  for each row execute function public.set_updated_at();

drop trigger if exists set_day_routine_sessions_updated_at on public.day_routine_sessions;
create trigger set_day_routine_sessions_updated_at
  before update on public.day_routine_sessions
  for each row execute function public.set_updated_at();

alter table public.day_routine_templates enable row level security;
alter table public.day_routine_template_items enable row level security;
alter table public.day_routine_sessions enable row level security;
alter table public.day_routine_session_items enable row level security;
alter table public.day_routine_reminder_log enable row level security;

drop policy if exists "day_routine_templates_select_accessible" on public.day_routine_templates;
create policy "day_routine_templates_select_accessible"
  on public.day_routine_templates
  for select
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (is_active = true and app_private.current_user_can_access_store(store_id))
  );

drop policy if exists "day_routine_template_items_select_accessible" on public.day_routine_template_items;
create policy "day_routine_template_items_select_accessible"
  on public.day_routine_template_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.day_routine_templates t
      where t.id = template_id
        and t.is_active = true
        and (
          app_private.current_user_has_role('developer')
          or app_private.current_user_can_access_store(t.store_id)
        )
    )
  );

drop policy if exists "day_routine_sessions_select_accessible" on public.day_routine_sessions;
create policy "day_routine_sessions_select_accessible"
  on public.day_routine_sessions
  for select
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or app_private.current_user_can_access_store(store_id)
    or employee_id = app_private.current_user_employee_id()
  );

drop policy if exists "day_routine_session_items_select_accessible" on public.day_routine_session_items;
create policy "day_routine_session_items_select_accessible"
  on public.day_routine_session_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.day_routine_sessions s
      where s.id = session_id
        and (
          app_private.current_user_has_role('developer')
          or app_private.current_user_can_access_store(s.store_id)
          or s.employee_id = app_private.current_user_employee_id()
        )
    )
  );

drop policy if exists "day_routine_templates_manage_accessible" on public.day_routine_templates;
create policy "day_routine_templates_manage_accessible"
  on public.day_routine_templates
  for all
  to authenticated
  using (
    app_private.current_user_has_role('developer')
    or (
      app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('store_manager')
      or app_private.current_user_has_role('auditor')
    )
    and app_private.current_user_can_access_store(store_id)
  )
  with check (
    app_private.current_user_has_role('developer')
    or (
      app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('store_manager')
      or app_private.current_user_has_role('auditor')
    )
    and app_private.current_user_can_access_store(store_id)
  );

drop policy if exists "day_routine_sessions_no_direct_writes" on public.day_routine_sessions;
create policy "day_routine_sessions_no_direct_writes"
  on public.day_routine_sessions
  for insert
  to authenticated
  with check (false);

drop policy if exists "day_routine_session_items_no_direct_writes" on public.day_routine_session_items;
create policy "day_routine_session_items_no_direct_writes"
  on public.day_routine_session_items
  for insert
  to authenticated
  with check (false);

drop policy if exists "day_routine_reminder_log_no_direct_access" on public.day_routine_reminder_log;
create policy "day_routine_reminder_log_no_direct_access"
  on public.day_routine_reminder_log
  for all
  to authenticated
  using (false)
  with check (false);

revoke all on public.day_routine_templates from public;
revoke all on public.day_routine_template_items from public;
revoke all on public.day_routine_sessions from public;
revoke all on public.day_routine_session_items from public;
revoke all on public.day_routine_reminder_log from public;
grant select on public.day_routine_templates to authenticated;
grant select on public.day_routine_template_items to authenticated;
grant select on public.day_routine_sessions to authenticated;
grant select on public.day_routine_session_items to authenticated;

create or replace function app_private.day_routine_default_template(p_routine_kind text)
returns jsonb
language sql
immutable
set search_path = public, app_private
as $$
  select case p_routine_kind
    when 'morning' then jsonb_build_array(
      jsonb_build_object(
        'title', 'Подготовка к смене',
        'children', jsonb_build_array(
          jsonb_build_object('title', 'Пересчёт кассы'),
          jsonb_build_object('title', 'Внешний вид')
        )
      ),
      jsonb_build_object('title', 'Порядок на стойке'),
      jsonb_build_object(
        'title', 'Атмосфера магазина',
        'children', jsonb_build_array(
          jsonb_build_object('title', 'Проверить воду в кулере'),
          jsonb_build_object('title', 'Проверить свет неон'),
          jsonb_build_object('title', 'Проверить камеры'),
          jsonb_build_object('title', 'Если с чем-то есть проблемы написать управляющему')
        )
      ),
      jsonb_build_object('title', 'Дегустация'),
      jsonb_build_object('title', 'Интернет заказы'),
      jsonb_build_object('title', 'Сроки Спортпит'),
      jsonb_build_object('title', 'Сроки ПП')
    )
    else jsonb_build_array(
      jsonb_build_object(
        'title', 'Подготовка к закрытию',
        'children', jsonb_build_array(
          jsonb_build_object('title', 'Пересчёт кассы'),
          jsonb_build_object('title', 'Внешний вид')
        )
      ),
      jsonb_build_object('title', 'Порядок на стойке'),
      jsonb_build_object(
        'title', 'Атмосфера магазина',
        'children', jsonb_build_array(
          jsonb_build_object('title', 'Проверить воду в кулере'),
          jsonb_build_object('title', 'Проверить свет неон'),
          jsonb_build_object('title', 'Проверить камеры')
        )
      ),
      jsonb_build_object('title', 'Интернет заказы'),
      jsonb_build_object('title', 'Сроки Спортпит'),
      jsonb_build_object('title', 'Сроки ПП')
    )
  end;
$$;

revoke all on function app_private.day_routine_default_template(text) from public;
grant execute on function app_private.day_routine_default_template(text) to authenticated;

create or replace function app_private.insert_day_routine_template_items(
  p_template_id uuid,
  p_parent_item_id uuid,
  p_items jsonb,
  p_level integer default 0,
  p_created_by uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_item jsonb;
  v_item_id uuid;
  v_children jsonb;
  v_index integer := 0;
begin
  for v_item in
    select value
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as value
  loop
    v_index := v_index + 1;
    insert into public.day_routine_template_items (
      template_id,
      parent_item_id,
      title,
      level,
      sort_order,
      is_active,
      created_by,
      updated_by
    )
    values (
      p_template_id,
      p_parent_item_id,
      coalesce(nullif(trim(both from v_item->>'title'), ''), 'Пункт'),
      p_level,
      coalesce(nullif(v_item->>'sort_order', '')::integer, v_index),
      true,
      p_created_by,
      p_created_by
    )
    returning id into v_item_id;

    v_children := coalesce(v_item->'children', '[]'::jsonb);
    if jsonb_typeof(v_children) = 'array' and jsonb_array_length(v_children) > 0 then
      perform app_private.insert_day_routine_template_items(
        p_template_id,
        v_item_id,
        v_children,
        p_level + 1,
        p_created_by
      );
    end if;
  end loop;
end;
$$;

revoke all on function app_private.insert_day_routine_template_items(uuid, uuid, jsonb, integer, uuid) from public;
grant execute on function app_private.insert_day_routine_template_items(uuid, uuid, jsonb, integer, uuid) to authenticated;

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
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.toggle_day_routine_item_completion(p_shift_id, p_routine_kind, p_template_item_id, p_completed);
end;
$$;

revoke all on function public.toggle_day_routine_item_completion(uuid, text, uuid, boolean) from public;
grant execute on function public.toggle_day_routine_item_completion(uuid, text, uuid, boolean) to authenticated;

create or replace function app_private.run_day_routine_evening_reminders(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_sent integer := 0;
  v_row record;
  v_local_now timestamp;
  v_employee_name text;
  v_store_name text;
begin
  for v_row in
    select sh.id as shift_id,
           sh.opened_by_employee_id,
           sh.store_id,
           sh.shift_date,
           coalesce(s.timezone, 'Asia/Vladivostok') as timezone,
           s.name as store_name
      from public.shifts sh
      join public.stores s on s.id = sh.store_id
     where sh.status = 'opened'
       and s.status = 'active'
  loop
    v_local_now := timezone(v_row.timezone, p_now);
    if to_char(v_local_now, 'HH24:MI') <> '19:00' then
      continue;
    end if;

    if exists (
      select 1
      from public.day_routine_reminder_log l
      where l.shift_id = v_row.shift_id
        and l.employee_id = v_row.opened_by_employee_id
        and l.routine_kind = 'evening'
        and l.routine_date = v_row.shift_date
        and l.notification_kind = 'evening_19_00'
    ) then
      continue;
    end if;

    select full_name into v_employee_name
    from public.employees
    where id = v_row.opened_by_employee_id;
    v_store_name := v_row.store_name;

    perform app_private.notify_employee(
      v_row.opened_by_employee_id,
      'evening_routine_reminder',
      'Вечерний распорядок дня',
      'Проверь вечерний распорядок дня! ' || coalesce(v_employee_name, 'Сотрудник') || ' ' || v_store_name,
      'shift',
      v_row.shift_id
    );

    insert into public.day_routine_reminder_log (
      shift_id,
      employee_id,
      store_id,
      routine_kind,
      routine_date,
      notification_kind,
      sent_at
    )
    values (
      v_row.shift_id,
      v_row.opened_by_employee_id,
      v_row.store_id,
      'evening',
      v_row.shift_date,
      'evening_19_00',
      p_now
    )
    on conflict do nothing;

    v_sent := v_sent + 1;
  end loop;

  return jsonb_build_object('sent', v_sent);
end;
$$;

revoke all on function app_private.run_day_routine_evening_reminders(timestamptz) from public;
grant execute on function app_private.run_day_routine_evening_reminders(timestamptz) to authenticated;

create or replace function public.run_day_routine_evening_reminders(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  return app_private.run_day_routine_evening_reminders(p_now);
end;
$$;

revoke all on function public.run_day_routine_evening_reminders(timestamptz) from public;
grant execute on function public.run_day_routine_evening_reminders(timestamptz) to authenticated;

insert into public.day_routine_templates (store_id, routine_kind, title, is_active, created_by, updated_by)
select s.id, kind.routine_kind, kind.title, true, null, null
from public.stores s
cross join (
  values
    ('morning'::text, 'Утренний распорядок'::text),
    ('evening'::text, 'Вечерний распорядок'::text)
) as kind(routine_kind, title)
where s.status = 'active'
  and not exists (
    select 1
    from public.day_routine_templates t
    where t.store_id = s.id
      and t.routine_kind = kind.routine_kind
  );

do $$
declare
  v_template record;
begin
  for v_template in
    select id, routine_kind
    from public.day_routine_templates
    where title in ('Утренний распорядок', 'Вечерний распорядок')
  loop
    delete from public.day_routine_template_items where template_id = v_template.id;
    perform app_private.insert_day_routine_template_items(
      v_template.id,
      null,
      app_private.day_routine_default_template(v_template.routine_kind),
      0,
      null
    );
  end loop;
end;
$$;
