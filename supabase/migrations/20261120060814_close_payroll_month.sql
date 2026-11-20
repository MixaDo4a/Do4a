alter table public.payroll_periods
  add column if not exists closed_by uuid references auth.users(id);

create or replace function app_private.guard_closed_payroll_period()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period_id uuid;
  v_period_month date;
  v_shift_id uuid;
  v_report_id uuid;
  v_payroll_period_id uuid;
begin
  if tg_table_name = 'payroll_periods' then
    if tg_op = 'DELETE' then
      if old.status = 'closed' then raise exception 'Closed payroll periods cannot be deleted'; end if;
      return old;
    end if;
    if tg_op = 'UPDATE' and old.status = 'closed' then
      raise exception 'Closed payroll periods cannot be changed';
    end if;
    if new.status = 'closed' and tg_op = 'INSERT' then
      raise exception 'Create the payroll period before closing it';
    end if;
    if new.status = 'closed' and old.status <> 'closed' then
      if not (app_private.current_user_has_role('store_manager')
        or app_private.current_user_has_role('super_admin')
        or app_private.current_user_has_role('developer')) then
        raise exception 'Only management can close a payroll month';
      end if;
      if date_trunc('month', new.period_month)::date <>
        (date_trunc('month', timezone('Asia/Vladivostok', now())) - interval '1 month')::date then
        raise exception 'Only the previous calendar month can be closed';
      end if;
      if exists (
        select 1 from public.shifts shift
        where date_trunc('month', shift.shift_date)::date = new.period_month
          and shift.status in ('opened', 'correction_required')
      ) then
        raise exception 'There are unfinished shifts in this month';
      end if;
      new.closed_at := now();
      new.closed_by := auth.uid();
    end if;
    return new;
  end if;

  if tg_table_name = 'payroll_entries' then
    v_period_id := coalesce(new.payroll_period_id, old.payroll_period_id);
    select period_month into v_period_month from public.payroll_periods where id = v_period_id;
    if exists (select 1 from public.payroll_periods where id = v_period_id and status = 'closed') then
      raise exception 'Payroll for this month is closed';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name in ('payroll_adjustments', 'expiration_writeoffs', 'payroll_product_writeoffs', 'payroll_manual_kpi_awards') then
    v_period_month := coalesce(new.period_month, old.period_month);
    if exists (
      select 1 from public.payroll_periods period
      where period.period_month = v_period_month and period.status = 'closed'
    ) then
      raise exception 'Payroll inputs for this month are closed';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'payroll_snapshots' then
    v_payroll_period_id := coalesce(new.payroll_period_id, old.payroll_period_id);
    if exists (
      select 1 from public.payroll_periods period
      where period.id = v_payroll_period_id and period.status = 'closed'
    ) then
      raise exception 'Payroll snapshots for this month are closed';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'employee_advances' and coalesce(new.shift_id, old.shift_id) is null then
    v_period_month := coalesce(new.period_month, old.period_month);
    if exists (
      select 1 from public.payroll_periods period
      where period.period_month = v_period_month and period.status = 'closed'
    ) then
      raise exception 'Payroll inputs for this month are closed';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_table_name = 'shifts' then
    if tg_op = 'INSERT' then
      v_period_month := date_trunc('month', new.shift_date)::date;
    else
      v_shift_id := coalesce(new.id, old.id);
    end if;
  elsif tg_table_name = 'shift_closing_reports' then
    v_shift_id := coalesce(new.shift_id, old.shift_id);
  elsif tg_table_name = 'shift_cash_counts' then
    v_report_id := coalesce(new.shift_closing_report_id, old.shift_closing_report_id);
    select shift_id into v_shift_id from public.shift_closing_reports where id = v_report_id;
  elsif tg_table_name in ('sales_metrics', 'employee_advances', 'shift_participants', 'shift_snapshots') then
    v_shift_id := coalesce(new.shift_id, old.shift_id);
  elsif tg_table_name in ('shift_work_times', 'shift_work_time_audit') then
    select participant.shift_id into v_shift_id
    from public.shift_participants participant
    where participant.id = coalesce(new.participant_id, old.participant_id);
  end if;

  if v_period_month is null and v_shift_id is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if v_period_month is null then
    select date_trunc('month', shift_date)::date into v_period_month
    from public.shifts where id = v_shift_id;
  end if;

  if exists (
    select 1 from public.payroll_periods period
    where period.period_month = v_period_month and period.status = 'closed'
  ) and not app_private.current_user_has_role('super_admin') then
    raise exception 'Only a super administrator can edit shifts in a closed month';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function app_private.guard_closed_payroll_period() from public, anon, authenticated;

create trigger payroll_periods_guard_closed
before insert or update or delete on public.payroll_periods
for each row execute function app_private.guard_closed_payroll_period();

create trigger payroll_entries_guard_closed
before insert or update or delete on public.payroll_entries
for each row execute function app_private.guard_closed_payroll_period();

create trigger payroll_adjustments_guard_closed
before insert or update or delete on public.payroll_adjustments
for each row execute function app_private.guard_closed_payroll_period();

create trigger expiration_writeoffs_guard_closed
before insert or update or delete on public.expiration_writeoffs
for each row execute function app_private.guard_closed_payroll_period();

create trigger product_writeoffs_guard_closed
before insert or update or delete on public.payroll_product_writeoffs
for each row execute function app_private.guard_closed_payroll_period();

create trigger payroll_manual_awards_guard_closed
before insert or update or delete on public.payroll_manual_kpi_awards
for each row execute function app_private.guard_closed_payroll_period();

create trigger payroll_snapshots_guard_closed
before insert or update or delete on public.payroll_snapshots
for each row execute function app_private.guard_closed_payroll_period();

create trigger shifts_guard_closed_month
before insert or update or delete on public.shifts
for each row execute function app_private.guard_closed_payroll_period();

create trigger shift_participants_guard_closed_month
before insert or update or delete on public.shift_participants
for each row execute function app_private.guard_closed_payroll_period();

create trigger shift_snapshots_guard_closed_month
before insert or update or delete on public.shift_snapshots
for each row execute function app_private.guard_closed_payroll_period();

create trigger shift_work_audit_guard_closed_month
before insert or update or delete on public.shift_work_time_audit
for each row execute function app_private.guard_closed_payroll_period();

create trigger shift_reports_guard_closed_month
before insert or update or delete on public.shift_closing_reports
for each row execute function app_private.guard_closed_payroll_period();

create trigger shift_cash_counts_guard_closed_month
before insert or update or delete on public.shift_cash_counts
for each row execute function app_private.guard_closed_payroll_period();

create trigger sales_metrics_guard_closed_month
before insert or update or delete on public.sales_metrics
for each row execute function app_private.guard_closed_payroll_period();

create trigger employee_advances_guard_closed_month
before insert or update or delete on public.employee_advances
for each row execute function app_private.guard_closed_payroll_period();

create trigger shift_work_times_guard_closed_month
before insert or update or delete on public.shift_work_times
for each row execute function app_private.guard_closed_payroll_period();

create or replace function public.close_payroll_period(p_period_month date)
returns public.payroll_periods
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.payroll_periods%rowtype;
  v_previous_month date;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')) then
    raise exception 'Only management can close a payroll month';
  end if;

  v_previous_month := (date_trunc('month', timezone('Asia/Vladivostok', now())) - interval '1 month')::date;
  if date_trunc('month', p_period_month)::date <> v_previous_month then
    raise exception 'Only the previous calendar month can be closed';
  end if;

  if exists (
    select 1 from public.shifts shift
    where date_trunc('month', shift.shift_date)::date = v_previous_month
      and shift.status in ('opened', 'correction_required')
  ) then
    raise exception 'There are unfinished shifts in this month';
  end if;

  insert into public.payroll_periods (period_month, status, calculated_at)
  values (v_previous_month, 'calculated', now())
  on conflict (period_month) do nothing;
  select * into v_period from public.payroll_periods
  where period_month = v_previous_month for update;
  if v_period.status <> 'closed' then
    update public.payroll_periods
    set status = 'closed', closed_at = now(), closed_by = auth.uid(), updated_at = now()
    where id = v_period.id
    returning * into v_period;
  end if;
  return v_period;
end;
$$;

revoke all on function public.close_payroll_period(date) from public, anon;
grant execute on function public.close_payroll_period(date) to authenticated;
