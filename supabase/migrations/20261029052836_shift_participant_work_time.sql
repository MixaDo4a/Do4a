create table public.shift_work_times (
  participant_id uuid primary key references public.shift_participants(id) on delete cascade,
  started_at timestamptz,
  ended_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  paid_hours numeric(6,2),
  store_timezone text,
  workday_start_time time,
  workday_end_time time,
  corrected_at timestamptz,
  corrected_by uuid references auth.users(id),
  correction_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shift_work_times_order_check check (ended_at is null or (started_at is not null and ended_at > started_at)),
  constraint shift_work_times_confirmation_check check (
    confirmed_at is null or (ended_at is not null and confirmed_by is not null and paid_hours is not null)
  ),
  constraint shift_work_times_paid_hours_check check (paid_hours is null or paid_hours >= 0)
);

create table public.shift_work_time_audit (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.shift_participants(id) on delete cascade,
  changed_by uuid not null references auth.users(id),
  previous_value jsonb,
  next_value jsonb not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create index shift_work_time_audit_participant_idx on public.shift_work_time_audit(participant_id, created_at);

alter table public.shift_work_times enable row level security;
alter table public.shift_work_time_audit enable row level security;
revoke all on public.shift_work_times, public.shift_work_time_audit from public, anon, authenticated;
grant select on public.shift_work_times, public.shift_work_time_audit to authenticated;

create policy shift_work_times_read on public.shift_work_times for select to authenticated
using (exists (
  select 1 from public.shift_participants sp
  join public.shifts sh on sh.id = sp.shift_id
  where sp.id = participant_id
    and (sp.employee_id = app_private.current_user_employee_id()
      or (app_private.current_user_has_role('store_manager') and app_private.current_user_can_access_store(sh.store_id))
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer'))
));

create policy shift_work_time_audit_read on public.shift_work_time_audit for select to authenticated
using (exists (
  select 1 from public.shift_participants sp
  join public.shifts sh on sh.id = sp.shift_id
  where sp.id = participant_id
    and ((app_private.current_user_has_role('store_manager') and app_private.current_user_can_access_store(sh.store_id))
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_has_role('developer'))
));

create function app_private.calculate_shift_work_hours(
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_shift_date date,
  p_timezone text,
  p_workday_start_time time,
  p_workday_end_time time
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_window_start timestamp;
  v_window_end timestamp;
  v_overlap_seconds numeric;
begin
  if p_started_at is null or p_ended_at is null or p_ended_at <= p_started_at
    or p_timezone is null or p_workday_start_time is null or p_workday_end_time is null then
    raise exception 'Complete work marks and store hours are required';
  end if;

  v_window_start := p_shift_date + p_workday_start_time;
  v_window_end := p_shift_date + p_workday_end_time;
  if v_window_end <= v_window_start then
    v_window_end := v_window_end + interval '1 day';
  end if;

  v_overlap_seconds := greatest(0, extract(epoch from
    least(p_ended_at at time zone p_timezone, v_window_end)
    - greatest(p_started_at at time zone p_timezone, v_window_start)));

  return least(
    ceil(v_overlap_seconds / 1800) / 2,
    extract(epoch from v_window_end - v_window_start) / 3600
  );
end;
$$;

revoke all on function app_private.calculate_shift_work_hours(timestamptz,timestamptz,date,text,time,time) from public, anon, authenticated;

create function app_private.start_primary_shift_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.participant_role = 'primary_seller' then
    insert into public.shift_work_times(participant_id, started_at)
    select new.id, sh.opened_at from public.shifts sh where sh.id = new.shift_id;
  end if;
  return new;
end;
$$;

revoke all on function app_private.start_primary_shift_work() from public, anon, authenticated;

create trigger shift_participant_start_work
after insert on public.shift_participants
for each row execute function app_private.start_primary_shift_work();

insert into public.shift_work_times(participant_id, started_at)
select sp.id, sh.opened_at
from public.shift_participants sp
join public.shifts sh on sh.id = sp.shift_id
where sp.participant_role = 'primary_seller'
  and sh.status in ('opened', 'correction_required')
on conflict (participant_id) do nothing;

create function app_private.finish_primary_shift_work()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.shift_participants%rowtype;
  v_store public.stores%rowtype;
  v_started_at timestamptz;
  v_ended_at timestamptz;
  v_self_confirmed boolean;
  v_has_store_hours boolean;
begin
  if new.status not in ('closed', 'auto_closed') or old.status in ('closed', 'auto_closed') then
    return new;
  end if;

  select * into v_participant from public.shift_participants
  where shift_id = new.id and participant_role = 'primary_seller';
  if not found then return new; end if;

  select * into v_store from public.stores where id = new.store_id;
  v_ended_at := coalesce(new.closed_at, new.auto_closed_at);
  if v_ended_at is null then return new; end if;
  v_self_confirmed := new.closed_by_employee_id = v_participant.employee_id and auth.uid() is not null;
  v_has_store_hours := v_store.workday_start_time is not null and v_store.workday_end_time is not null;

  insert into public.shift_work_times(participant_id, started_at)
  values (v_participant.id, new.opened_at)
  on conflict (participant_id) do nothing;

  select started_at into v_started_at from public.shift_work_times
  where participant_id = v_participant.id and ended_at is null for update;
  if not found then return new; end if;

  update public.shift_work_times
  set ended_at = v_ended_at,
      confirmed_at = case when v_self_confirmed and v_has_store_hours then now() else null end,
      confirmed_by = case when v_self_confirmed and v_has_store_hours then auth.uid() else null end,
      paid_hours = case when v_has_store_hours then app_private.calculate_shift_work_hours(
        v_started_at, v_ended_at, new.shift_date, v_store.timezone,
        v_store.workday_start_time, v_store.workday_end_time) else null end,
      store_timezone = v_store.timezone,
      workday_start_time = v_store.workday_start_time,
      workday_end_time = v_store.workday_end_time,
      updated_at = now()
  where participant_id = v_participant.id;
  return new;
end;
$$;

revoke all on function app_private.finish_primary_shift_work() from public, anon, authenticated;

create trigger shift_finish_primary_work
after update of status on public.shifts
for each row execute function app_private.finish_primary_shift_work();

create function public.mark_shift_work(p_shift_id uuid, p_action text)
returns public.shift_work_times
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.shift_participants%rowtype;
  v_shift public.shifts%rowtype;
  v_store public.stores%rowtype;
  v_work public.shift_work_times%rowtype;
  v_now timestamptz := clock_timestamp();
  v_has_store_hours boolean;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if p_action not in ('start', 'end') then raise exception 'Invalid work mark'; end if;

  select * into v_participant from public.shift_participants
  where shift_id = p_shift_id and employee_id = app_private.current_user_employee_id();
  if not found then raise exception 'Only a shift participant can mark own work'; end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if v_shift.status not in ('opened', 'correction_required') then
    raise exception 'Shift is not open';
  end if;

  select * into v_store from public.stores where id = v_shift.store_id;
  v_has_store_hours := v_store.workday_start_time is not null and v_store.workday_end_time is not null;
  select * into v_work from public.shift_work_times
  where participant_id = v_participant.id for update;

  if p_action = 'start' then
    if v_work.started_at is not null then raise exception 'Work already started'; end if;
    insert into public.shift_work_times(participant_id, started_at)
    values (v_participant.id, v_now)
    returning * into v_work;
  else
    if v_work.started_at is null or v_work.ended_at is not null then
      raise exception 'Work must be started and not yet ended';
    end if;
    update public.shift_work_times
    set ended_at = v_now,
        confirmed_at = case when v_has_store_hours then v_now else null end,
        confirmed_by = case when v_has_store_hours then auth.uid() else null end,
        paid_hours = case when v_has_store_hours then app_private.calculate_shift_work_hours(
          v_work.started_at, v_now, v_shift.shift_date, v_store.timezone,
          v_store.workday_start_time, v_store.workday_end_time) else null end,
        store_timezone = v_store.timezone,
        workday_start_time = v_store.workday_start_time,
        workday_end_time = v_store.workday_end_time,
        updated_at = v_now
    where participant_id = v_participant.id
    returning * into v_work;
  end if;

  return v_work;
end;
$$;

revoke all on function public.mark_shift_work(uuid,text) from public, anon;
grant execute on function public.mark_shift_work(uuid,text) to authenticated;

create function public.correct_shift_work(
  p_participant_id uuid,
  p_started_local timestamp,
  p_ended_local timestamp,
  p_reason text
)
returns public.shift_work_times
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_participant public.shift_participants%rowtype;
  v_shift public.shifts%rowtype;
  v_store public.stores%rowtype;
  v_previous jsonb;
  v_work public.shift_work_times%rowtype;
  v_started_at timestamptz;
  v_ended_at timestamptz;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
    or app_private.current_user_has_role('store_manager')) then
    raise exception 'Only management can correct work marks';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Correction reason is required'; end if;

  select * into v_participant from public.shift_participants where id = p_participant_id;
  if not found then raise exception 'Shift participant not found'; end if;
  select * into v_shift from public.shifts where id = v_participant.shift_id for update;
  if not (app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer'))
    and not app_private.current_user_can_access_store(v_shift.store_id) then
    raise exception 'Store access denied';
  end if;
  select * into v_store from public.stores where id = v_shift.store_id;
  v_started_at := p_started_local at time zone v_store.timezone;
  v_ended_at := p_ended_local at time zone v_store.timezone;
  if v_started_at is null or v_ended_at is null or v_ended_at <= v_started_at then
    raise exception 'Work end must be after work start';
  end if;

  select to_jsonb(work) into v_previous from public.shift_work_times work
  where participant_id = p_participant_id for update;

  insert into public.shift_work_times(
    participant_id, started_at, ended_at, confirmed_at, confirmed_by, paid_hours,
    store_timezone, workday_start_time, workday_end_time,
    corrected_at, corrected_by, correction_reason)
  values (
    p_participant_id, v_started_at, v_ended_at, now(), auth.uid(),
    app_private.calculate_shift_work_hours(v_started_at, v_ended_at, v_shift.shift_date,
      v_store.timezone, v_store.workday_start_time, v_store.workday_end_time),
    v_store.timezone, v_store.workday_start_time, v_store.workday_end_time,
    now(), auth.uid(), trim(p_reason))
  on conflict (participant_id) do update
  set started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      confirmed_at = excluded.confirmed_at,
      confirmed_by = excluded.confirmed_by,
      paid_hours = excluded.paid_hours,
      store_timezone = excluded.store_timezone,
      workday_start_time = excluded.workday_start_time,
      workday_end_time = excluded.workday_end_time,
      corrected_at = excluded.corrected_at,
      corrected_by = excluded.corrected_by,
      correction_reason = excluded.correction_reason,
      updated_at = now()
  returning * into v_work;

  insert into public.shift_work_time_audit(participant_id, changed_by, previous_value, next_value, reason)
  values (p_participant_id, auth.uid(), v_previous, to_jsonb(v_work), trim(p_reason));
  return v_work;
end;
$$;

revoke all on function public.correct_shift_work(uuid,timestamp,timestamp,text) from public, anon;
grant execute on function public.correct_shift_work(uuid,timestamp,timestamp,text) to authenticated;
