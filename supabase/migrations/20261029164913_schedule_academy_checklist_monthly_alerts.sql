create or replace function app_private.notify_missing_academy_checklists(p_period_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start date := date_trunc('month', p_period_month)::date;
  v_next date := (date_trunc('month', p_period_month) + interval '1 month')::date;
  v_store record;
  v_count integer := 0;
begin
  for v_store in
    select s.id, s.name
    from public.stores s
    where s.city is not null
      and app_private.payroll_mode_for_city(s.city, v_start) = 'academy'
      and v_next <= (now() at time zone coalesce(s.timezone, 'Asia/Vladivostok'))::date
      and exists (
        select 1 from public.shifts sh
        where sh.store_id = s.id and sh.status in ('closed', 'auto_closed')
          and coalesce(sh.is_erroneous, false) = false
          and sh.shift_date >= v_start and sh.shift_date < v_next
      )
      and not exists (
        select 1 from public.checklist_submissions cs
        where cs.store_id = s.id and cs.period_month = v_start
      )
  loop
    insert into public.academy_checklist_monthly_alerts (period_month, store_id)
    values (v_start, v_store.id)
    on conflict (period_month, store_id) do nothing;
    if found then
      perform app_private.notify_store_managers(
        v_store.id,
        'academy_checklist_missing',
        'Нет чек-листов за месяц',
        format('В магазине %s за %s нет проведённых проверок. Сотрудникам сохранена премия за пропуск проверок компанией.', v_store.name, to_char(v_start, 'YYYY-MM')),
        'store',
        v_store.id
      );
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on function app_private.notify_missing_academy_checklists(date) from public, anon, authenticated;

create or replace function public.notify_missing_academy_checklists(p_period_month date)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'Service role is required';
  end if;
  return app_private.notify_missing_academy_checklists(p_period_month);
end;
$$;

revoke all on function public.notify_missing_academy_checklists(date) from public, anon, authenticated;
grant execute on function public.notify_missing_academy_checklists(date) to service_role;

select cron.unschedule(jobid) from cron.job where jobname = 'do4a-academy-checklist-monthly-alerts';
select cron.schedule(
  'do4a-academy-checklist-monthly-alerts',
  '5 13 1 * *',
  $$select app_private.notify_missing_academy_checklists((date_trunc('month', current_date) - interval '1 month')::date)$$
);
