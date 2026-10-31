create table public.checklist_monthly_employee_reminders (
  period_month date not null check (extract(day from period_month) = 1),
  employee_id uuid not null references public.employees(id) on delete cascade,
  store_ids uuid[] not null,
  notified_at timestamptz not null default now(),
  primary key (period_month, employee_id)
);

alter table public.checklist_monthly_employee_reminders enable row level security;
revoke all on public.checklist_monthly_employee_reminders from public, anon, authenticated;

create or replace function app_private.notify_missing_employee_checklists(
  p_run_at timestamptz default now(),
  p_dry_run boolean default false
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate record;
  v_reminder_inserted integer;
  v_recipient_count integer;
  v_count integer := 0;
begin
  for v_candidate in
    with store_local_dates as (
      select
        s.id as store_id,
        s.name as store_name,
        (p_run_at at time zone coalesce(s.timezone, 'Asia/Vladivostok'))::date as local_date
      from public.stores s
      where s.status = 'active'
        and s.city is not null
        and lower(s.name) not like '%склад%'
        and lower(s.name) not like '%warehouse%'
        and extract(day from (p_run_at at time zone coalesce(s.timezone, 'Asia/Vladivostok'))::date) = 20
    ), eligible_employees as (
      select
        l.local_date - (extract(day from l.local_date)::integer - 1) as period_month,
        sp.employee_id,
        array_agg(distinct l.store_id) as store_ids,
        string_agg(distinct l.store_name, ', ' order by l.store_name) as store_names
      from store_local_dates l
      join public.shifts sh
        on sh.store_id = l.store_id
       and sh.shift_date >= l.local_date - (extract(day from l.local_date)::integer - 1)
       and sh.shift_date <= l.local_date
       and sh.status in ('opened', 'closed', 'auto_closed', 'correction_required')
       and coalesce(sh.is_erroneous, false) = false
      join public.shift_participants sp on sp.shift_id = sh.id
      where not exists (
        select 1
        from public.checklist_submissions cs
        where cs.employee_id = sp.employee_id
          and cs.period_month = l.local_date - (extract(day from l.local_date)::integer - 1)
      )
      group by 1, sp.employee_id
    )
    select
      e.period_month,
      e.employee_id,
      person.full_name as employee_name,
      e.store_ids,
      e.store_names
    from eligible_employees e
    join public.employees person on person.id = e.employee_id
    order by e.period_month, person.full_name
  loop
    v_count := v_count + 1;
    if p_dry_run then
      continue;
    end if;

    insert into public.checklist_monthly_employee_reminders (period_month, employee_id, store_ids)
    values (v_candidate.period_month, v_candidate.employee_id, v_candidate.store_ids)
    on conflict (period_month, employee_id) do nothing;
    get diagnostics v_reminder_inserted = row_count;
    if v_reminder_inserted = 0 then
      v_count := v_count - 1;
      continue;
    end if;

    insert into public.notifications (
      recipient_profile_id, event_type, title, body
    )
    select distinct
      p.id,
      'checklist_monthly_reminder',
      'Не проведён чек-лист сотруднику',
      format(
        'За %s сотруднику %s пока не проведён чек-лист. Сотрудник работал: %s. Проведите проверку до конца месяца.',
        to_char(v_candidate.period_month, 'YYYY-MM'),
        v_candidate.employee_name,
        v_candidate.store_names
      )
    from public.user_roles ur
    join public.roles r on r.id = ur.role_id
    join public.profiles p on p.id = ur.profile_id
    left join public.employees role_employee on role_employee.id = p.employee_id
    where ur.revoked_at is null
      and p.is_blocked = false
      and r.code in ('auditor', 'store_manager', 'super_admin')
      and (
        ur.scope_store_id = any(v_candidate.store_ids)
        or (ur.scope_store_id is null and ur.scope_city is null)
        or exists (
          select 1
          from public.stores scoped_store
          where scoped_store.id = any(v_candidate.store_ids)
            and scoped_store.city = ur.scope_city
        )
        or exists (
          select 1
          from public.employee_store_assignments esa
          where esa.employee_id = role_employee.id
            and esa.store_id = any(v_candidate.store_ids)
            and esa.valid_from <= current_date
            and (esa.valid_to is null or esa.valid_to >= current_date)
        )
      );
    get diagnostics v_recipient_count = row_count;

    if v_recipient_count = 0 then
      delete from public.checklist_monthly_employee_reminders
      where period_month = v_candidate.period_month
        and employee_id = v_candidate.employee_id;
      v_count := v_count - 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function app_private.notify_missing_employee_checklists(timestamptz, boolean) from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'do4a-checklist-monthly-employee-reminders';

select cron.schedule(
  'do4a-checklist-monthly-employee-reminders',
  '0 2 * * *',
  $$select app_private.notify_missing_employee_checklists(now(), false)$$
);
