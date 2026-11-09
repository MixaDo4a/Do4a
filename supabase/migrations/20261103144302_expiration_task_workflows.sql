insert into public.roles (code, name, description)
values ('marketer', 'Маркетолог', 'Разрабатывает и сопровождает акции')
on conflict (code) do update
set name = excluded.name, description = excluded.description, updated_at = now();

create or replace function app_private.role_rank(p_role public.user_role_code)
returns integer language sql immutable set search_path = public, app_private
as $$
  select case p_role::text
    when 'developer' then 0 when 'super_admin' then 1 when 'store_manager' then 2
    when 'buyer' then 3 when 'marketer' then 4 when 'warehouse_manager' then 5
    when 'auditor' then 6 when 'warehouse_assistant' then 7 when 'manager' then 8 else 99
  end;
$$;

alter table public.stores add column if not exists is_warehouse boolean not null default false;
update public.stores
set is_warehouse = true
where lower(name) like 'склад%';

alter table public.tasks
  add column if not exists task_type text not null default 'ordinary',
  add column if not exists expiration_campaign_id uuid,
  add column if not exists completion_outcome text,
  add column if not exists completion_comment text;

alter table public.tasks
  add constraint tasks_task_type_check
    check (task_type in ('ordinary', 'expiration_store', 'expiration_checker', 'expiration_marketer')),
  add constraint tasks_completion_outcome_check
    check (completion_outcome is null or completion_outcome in ('sold_out', 'writeoff', 'distributed'));

create table public.expiration_campaigns (
  id uuid primary key default gen_random_uuid(),
  product_name text not null check (char_length(trim(product_name)) between 1 and 250),
  expiry_date date not null,
  discount_type text not null check (discount_type in ('percent', 'new_price')),
  discount_value numeric(12,2) not null check (discount_value >= 0 and (discount_type <> 'percent' or discount_value <= 100)),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.tasks
  add constraint tasks_expiration_campaign_fk
    foreign key (expiration_campaign_id) references public.expiration_campaigns(id) on delete restrict;

create index tasks_expiration_campaign_idx on public.tasks (expiration_campaign_id, task_type, status);

create table public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 250),
  instructions text not null default '',
  is_required boolean not null default true,
  sort_order integer not null default 0,
  status text not null default 'open' check (status in ('open', 'done')),
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint task_subtasks_completion_check check ((status = 'done') = (completed_at is not null))
);

create index task_subtasks_task_order_idx on public.task_subtasks (task_id, sort_order, created_at);

create table public.task_subtask_events (
  id bigint generated always as identity primary key,
  subtask_id uuid not null references public.task_subtasks(id) on delete cascade,
  old_status text,
  new_status text not null check (new_status in ('open', 'done')),
  actor_profile_id uuid not null references public.profiles(id),
  comment text not null default '',
  created_at timestamptz not null default now()
);

alter table public.expiration_campaigns enable row level security;
alter table public.task_subtasks enable row level security;
alter table public.task_subtask_events enable row level security;

create policy expiration_campaigns_select_related_tasks on public.expiration_campaigns
  for select to authenticated using (
    exists (select 1 from public.tasks t where t.expiration_campaign_id = expiration_campaigns.id and
      (t.created_by = (select auth.uid()) or t.assignee_employee_id = app_private.current_user_employee_id()
       or app_private.current_user_can_access_store(t.store_id)))
  );

create policy task_subtasks_select_related_task on public.task_subtasks
  for select to authenticated using (
    exists (select 1 from public.tasks t where t.id = task_id and
      (t.created_by = (select auth.uid()) or t.assignee_employee_id = app_private.current_user_employee_id()
       or app_private.current_user_can_access_store(t.store_id)))
  );

create policy task_subtask_events_select_related_task on public.task_subtask_events
  for select to authenticated using (
    exists (select 1 from public.task_subtasks s join public.tasks t on t.id = s.task_id where s.id = subtask_id and
      (t.created_by = (select auth.uid()) or t.assignee_employee_id = app_private.current_user_employee_id()
       or app_private.current_user_can_access_store(t.store_id)))
  );

revoke all on public.expiration_campaigns, public.task_subtasks, public.task_subtask_events from anon, authenticated;
grant select on public.expiration_campaigns, public.task_subtasks, public.task_subtask_events to authenticated;
grant all on public.expiration_campaigns, public.task_subtasks, public.task_subtask_events to service_role;
grant usage, select on sequence public.task_subtask_events_id_seq to service_role;

create or replace function public.create_expiration_task_campaign(
  p_product_name text,
  p_expiry_date date,
  p_discount_type text,
  p_discount_value numeric,
  p_store_ids uuid[],
  p_auditor_employee_id uuid,
  p_marketer_employee_id uuid,
  p_extra_subtasks text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_actor uuid := auth.uid();
  v_campaign_id uuid := gen_random_uuid();
  v_store record;
  v_auditor_store uuid;
  v_marketer_store uuid;
  v_task_id uuid;
  v_store_task_ids uuid[] := '{}';
  v_extra text;
begin
  if v_actor is null
    or not (app_private.current_user_has_role('store_manager') or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer') or app_private.current_user_has_role('warehouse_manager')) then
    raise exception 'Недостаточно прав для сроковой кампании.' using errcode = '42501';
  end if;
  if nullif(trim(p_product_name), '') is null or char_length(p_product_name) > 250 or p_expiry_date is null
    or p_discount_type not in ('percent', 'new_price') or p_discount_value is null or p_discount_value < 0
    or (p_discount_type = 'percent' and p_discount_value > 100)
    or coalesce(cardinality(p_store_ids), 0) = 0 or p_auditor_employee_id is null or p_marketer_employee_id is null then
    raise exception 'Проверьте товар, срок, скидку, магазины и исполнителей.' using errcode = '22023';
  end if;
  if (select count(distinct x) from unnest(p_store_ids) x) <> cardinality(p_store_ids) then
    raise exception 'Список магазинов содержит повторы.' using errcode = '22023';
  end if;
  if exists (
    select 1 from unnest(p_store_ids) x
    left join public.stores s on s.id = x
    where s.id is null or s.status <> 'active' or s.is_warehouse or not app_private.current_user_can_access_store(s.id)
  ) then raise exception 'Выбраны недоступные магазины или склад.' using errcode = '42501'; end if;

  select esa.store_id into v_auditor_store
  from public.employee_store_assignments esa
  join public.profiles p on p.employee_id = esa.employee_id
  join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
  join public.roles r on r.id = ur.role_id and r.code = 'auditor'
  where esa.employee_id = p_auditor_employee_id and esa.store_id = any(p_store_ids)
    and esa.valid_from <= current_date and (esa.valid_to is null or esa.valid_to >= current_date)
    and exists (select 1 from public.employees e where e.id = esa.employee_id and e.is_active)
    and (ur.scope_store_id is null or ur.scope_store_id = esa.store_id)
    and (ur.scope_city is null or exists (select 1 from public.stores sc where sc.id = esa.store_id and lower(sc.city) = lower(ur.scope_city)))
  limit 1;
  select esa.store_id into v_marketer_store
  from public.employee_store_assignments esa
  join public.profiles p on p.employee_id = esa.employee_id
  join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
  join public.roles r on r.id = ur.role_id and r.code = 'marketer'
  where esa.employee_id = p_marketer_employee_id and esa.store_id = any(p_store_ids)
    and esa.valid_from <= current_date and (esa.valid_to is null or esa.valid_to >= current_date)
    and exists (select 1 from public.employees e where e.id = esa.employee_id and e.is_active)
    and (ur.scope_store_id is null or ur.scope_store_id = esa.store_id)
    and (ur.scope_city is null or exists (select 1 from public.stores sc where sc.id = esa.store_id and lower(sc.city) = lower(ur.scope_city)))
  limit 1;
  if v_auditor_store is null or v_marketer_store is null then
    raise exception 'Проверяющий и маркетолог должны иметь соответствующую роль и назначение в одном из выбранных магазинов.' using errcode = '22023';
  end if;
  if p_auditor_employee_id = p_marketer_employee_id then
    raise exception 'Проверяющий и маркетолог должны быть разными сотрудниками.' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(coalesce(p_extra_subtasks, '{}')) x where nullif(trim(x), '') is null or char_length(x) > 250)
    or cardinality(coalesce(p_extra_subtasks, '{}')) > 10 then
    raise exception 'Дополнительные подзадачи: до 10 названий по 250 символов.' using errcode = '22023';
  end if;

  insert into public.expiration_campaigns(id, product_name, expiry_date, discount_type, discount_value, created_by)
  values (v_campaign_id, trim(p_product_name), p_expiry_date, p_discount_type, p_discount_value, v_actor);

  for v_store in select s.id, s.name, s.timezone from public.stores s where s.id = any(p_store_ids) order by s.name loop
    v_task_id := gen_random_uuid();
    insert into public.tasks(id, store_id, assignee_employee_id, created_by, title, description, due_at, priority, status, task_type, expiration_campaign_id)
    values (v_task_id, v_store.id, null, v_actor, 'Акция: ' || trim(p_product_name),
      format('Товар: %s. Срок годности: %s. Скидка: %s %s.', trim(p_product_name), to_char(p_expiry_date, 'DD.MM.YYYY'),
        trim(to_char(p_discount_value, 'FM999999990D00')), case p_discount_type when 'percent' then '%' else 'руб. новая цена' end),
      ((p_expiry_date + 1)::timestamp + time '23:59:59') at time zone v_store.timezone,
      'high', 'open', 'expiration_store', v_campaign_id);
    v_store_task_ids := array_append(v_store_task_ids, v_task_id);
    insert into public.task_subtasks(task_id, title, instructions, is_required, sort_order)
    values (v_task_id, 'Опубликовать Stories в Telegram магазина',
      'Снимите видео: расскажите, что это за добавка, зачем она нужна и назовите скидку или акционную цену из основной задачи.', true, 1);
    foreach v_extra in array coalesce(p_extra_subtasks, '{}') loop
      insert into public.task_subtasks(task_id, title, instructions, is_required, sort_order)
      values (v_task_id, trim(v_extra), '', false, 1 + array_position(p_extra_subtasks, v_extra));
    end loop;
  end loop;

  v_task_id := gen_random_uuid();
  insert into public.tasks(id, store_id, assignee_employee_id, created_by, title, description, due_at, priority, status, task_type, expiration_campaign_id)
  values (v_task_id, v_auditor_store, p_auditor_employee_id, v_actor, 'Распределить остатки акции: ' || trim(p_product_name),
    format('Товар: %s. Срок годности: %s. Распределите остатки акционной позиции по магазинам для продажи.', trim(p_product_name), to_char(p_expiry_date, 'DD.MM.YYYY')),
    now() + interval '7 days', 'high', 'open', 'expiration_checker', v_campaign_id);
  v_task_id := gen_random_uuid();
  insert into public.tasks(id, store_id, assignee_employee_id, created_by, title, description, due_at, priority, status, task_type, expiration_campaign_id)
  values (v_task_id, v_marketer_store, p_marketer_employee_id, v_actor, 'Продвижение акции: ' || trim(p_product_name),
    format('Товар: %s. Срок годности: %s. Акция: %s %s.', trim(p_product_name), to_char(p_expiry_date, 'DD.MM.YYYY'),
      trim(to_char(p_discount_value, 'FM999999990D00')), case p_discount_type when 'percent' then '%' else 'руб. новая цена' end),
    now() + interval '7 days', 'high', 'open', 'expiration_marketer', v_campaign_id);
  insert into public.task_subtasks(task_id, title, instructions, is_required, sort_order)
  values
    (v_task_id, 'Разработать акцию для продвижения товара', 'Зафиксируйте механику акции и предложение для покупателей.', true, 1),
    (v_task_id, 'Проконтролировать публикацию акции СММ-менеджером', 'Проверьте, что СММ-менеджер опубликовал материалы об акции.', true, 2);

  return jsonb_build_object('campaign_id', v_campaign_id, 'store_task_ids', v_store_task_ids,
    'auditor_task_id', (select id from public.tasks where expiration_campaign_id = v_campaign_id and task_type = 'expiration_checker'),
    'marketer_task_id', (select id from public.tasks where expiration_campaign_id = v_campaign_id and task_type = 'expiration_marketer'));
end;
$$;

create or replace function public.set_expiration_task_completion(p_task_id uuid, p_outcome text, p_comment text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_task public.tasks%rowtype;
  v_employee_id uuid := app_private.current_user_employee_id();
  v_actor uuid := auth.uid();
  v_store_local_date date;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.task_type not in ('expiration_store', 'expiration_checker') or v_task.status not in ('open', 'in_progress', 'overdue') then
    raise exception 'Сроковая задача не найдена или уже закрыта.' using errcode = '22023';
  end if;
  if not (coalesce(v_task.assignee_employee_id = v_employee_id, false) or (v_task.assignee_employee_id is null and app_private.current_user_can_access_store(v_task.store_id))) then
    raise exception 'Недостаточно прав для завершения задачи.' using errcode = '42501';
  end if;
  select (now() at time zone coalesce(s.timezone, 'Asia/Vladivostok'))::date into v_store_local_date
  from public.stores s where s.id = v_task.store_id;
  if v_task.task_type = 'expiration_store' then
    if p_outcome not in ('sold_out', 'writeoff') or (p_outcome = 'writeoff' and nullif(trim(p_comment), '') is null) then
      raise exception 'Укажите, распродан ли товар или что будет списано.' using errcode = '22023';
    end if;
    if p_outcome = 'writeoff' and exists (select 1 from public.expiration_campaigns c where c.id = v_task.expiration_campaign_id and c.expiry_date > v_store_local_date) then
      raise exception 'Списание можно подтвердить только после срока годности.' using errcode = '22023';
    end if;
  elsif p_outcome <> 'distributed' or nullif(trim(p_comment), '') is null then
    raise exception 'Подтвердите распределение остатков и добавьте комментарий.' using errcode = '22023';
  end if;

  update public.tasks set status = 'done', completed_at = now(), completed_by = v_actor,
    completion_outcome = p_outcome, completion_comment = nullif(trim(p_comment), ''), updated_at = now()
  where id = p_task_id;
  return jsonb_build_object('task_id', p_task_id, 'created_by', v_task.created_by, 'store_id', v_task.store_id,
    'assignee_employee_id', v_task.assignee_employee_id, 'task_type', v_task.task_type, 'outcome', p_outcome);
end;
$$;

create or replace function public.set_task_subtask_status(p_subtask_id uuid, p_status text, p_comment text default '')
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
declare
  v_subtask public.task_subtasks%rowtype;
  v_task public.tasks%rowtype;
  v_employee_id uuid := app_private.current_user_employee_id();
  v_actor uuid := auth.uid();
  v_old_status text;
  v_parent_completed boolean := false;
begin
  if v_actor is null or p_status not in ('open', 'done') then raise exception 'Некорректный запрос.' using errcode = '22023'; end if;
  select * into v_subtask from public.task_subtasks where id = p_subtask_id for update;
  if not found then raise exception 'Подзадача не найдена.' using errcode = 'P0002'; end if;
  select * into v_task from public.tasks where id = v_subtask.task_id for update;
  if v_task.status = 'cancelled' then raise exception 'Основная задача отменена.' using errcode = '22023'; end if;
  v_old_status := v_subtask.status;
  if p_status = 'done' then
    if v_task.status = 'done' or v_subtask.status <> 'open' or not (coalesce(v_task.assignee_employee_id = v_employee_id, false) or
      (v_task.assignee_employee_id is null and app_private.current_user_can_access_store(v_task.store_id))) then
      raise exception 'Недостаточно прав или подзадача уже выполнена.' using errcode = '42501';
    end if;
    update public.task_subtasks set status = 'done', completed_by = v_actor, completed_at = now() where id = p_subtask_id;
  else
    if v_subtask.status <> 'done' or v_task.created_by <> v_actor or nullif(trim(p_comment), '') is null then
      raise exception 'Возобновить подзадачу может только постановщик с комментарием.' using errcode = '42501';
    end if;
    update public.task_subtasks set status = 'open', completed_by = null, completed_at = null where id = p_subtask_id;
    insert into public.task_comments(task_id, author_profile_id, body)
    values (v_task.id, v_actor, format('Подзадача «%s» возобновлена: %s', v_subtask.title, trim(p_comment)));
    if v_task.status = 'done' then
      update public.tasks set status = 'in_progress', completed_at = null, completed_by = null,
        completion_outcome = null, completion_comment = null, updated_at = now() where id = v_task.id;
    end if;
  end if;
  insert into public.task_subtask_events(subtask_id, old_status, new_status, actor_profile_id, comment)
  values (p_subtask_id, v_old_status, p_status, v_actor, coalesce(nullif(trim(p_comment), ''), ''));

  if v_task.task_type = 'expiration_marketer' and p_status = 'done' and not exists (
    select 1 from public.task_subtasks where task_id = v_task.id and is_required and status <> 'done'
  ) then
    update public.tasks set status = 'done', completed_at = now(), completed_by = v_actor, updated_at = now() where id = v_task.id;
    v_parent_completed := true;
  elsif v_task.status in ('open', 'overdue', 'done') then
    update public.tasks set status = 'in_progress', completed_at = null, completed_by = null, updated_at = now() where id = v_task.id;
  end if;

  return jsonb_build_object('task_id', v_task.id, 'created_by', v_task.created_by, 'store_id', v_task.store_id,
    'assignee_employee_id', v_task.assignee_employee_id, 'subtask_id', p_subtask_id, 'status', p_status,
    'parent_completed', v_parent_completed, 'task_type', v_task.task_type);
end;
$$;

revoke all on function public.create_expiration_task_campaign(text, date, text, numeric, uuid[], uuid, uuid, text[]) from public, anon;
revoke all on function public.set_expiration_task_completion(uuid, text, text) from public, anon;
revoke all on function public.set_task_subtask_status(uuid, text, text) from public, anon;
grant execute on function public.create_expiration_task_campaign(text, date, text, numeric, uuid[], uuid, uuid, text[]) to authenticated;
grant execute on function public.set_expiration_task_completion(uuid, text, text) to authenticated;
grant execute on function public.set_task_subtask_status(uuid, text, text) to authenticated;
