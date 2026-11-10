create table public.shift_closing_report_audit (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  changed_by uuid not null references auth.users(id),
  changed_by_employee_id uuid references public.employees(id),
  actor_role text not null check (actor_role in ('store_manager', 'super_admin', 'developer')),
  reason text not null check (length(trim(reason)) >= 3),
  previous_shift jsonb not null,
  next_shift jsonb not null,
  previous_report jsonb not null,
  next_report jsonb not null,
  previous_cash_counts jsonb not null,
  next_cash_counts jsonb not null,
  created_at timestamptz not null default now()
);

create index shift_closing_report_audit_shift_idx
  on public.shift_closing_report_audit (shift_id, created_at desc);

alter table public.shift_closing_report_audit enable row level security;
revoke all on public.shift_closing_report_audit from public, anon, authenticated;
grant select on public.shift_closing_report_audit to authenticated;

create policy shift_closing_report_audit_management_read
  on public.shift_closing_report_audit
  for select to authenticated
  using (
    actor_role = 'store_manager'
    and app_private.current_user_has_role('store_manager')
    and not app_private.current_user_has_role('super_admin')
    and not app_private.current_user_has_role('developer')
    and exists (
      select 1 from public.shifts s
      where s.id = public.shift_closing_report_audit.shift_id
        and app_private.current_user_can_access_store(s.store_id)
    )
  );

alter table public.shift_work_time_audit
  add column changed_by_role text check (changed_by_role is null or changed_by_role in ('store_manager', 'super_admin', 'developer'));

create function app_private.stamp_shift_work_audit_role()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.changed_by_role := case
    when app_private.current_user_has_role('developer') then 'developer'
    when app_private.current_user_has_role('super_admin') then 'super_admin'
    when app_private.current_user_has_role('store_manager') then 'store_manager'
    else null
  end;
  return new;
end;
$$;

create trigger shift_work_time_audit_stamp_role
before insert on public.shift_work_time_audit
for each row execute function app_private.stamp_shift_work_audit_role();
revoke all on function app_private.stamp_shift_work_audit_role() from public, anon, authenticated;

create function public.correct_closed_shift_report(
  p_shift_id uuid,
  p_opened_local timestamp,
  p_closed_local timestamp,
  p_cash_revenue numeric,
  p_card_revenue numeric,
  p_cash_returns numeric,
  p_card_returns numeric,
  p_receipt_count integer,
  p_items_sold_count integer,
  p_cash_collection_amount numeric,
  p_cash_collection_comment text,
  p_check_depth numeric,
  p_advance_amount numeric,
  p_actual_cash_amount numeric,
  p_cash_counts jsonb,
  p_reason text
)
returns public.shift_closing_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_store public.stores%rowtype;
  v_report public.shift_closing_reports%rowtype;
  v_report_before jsonb;
  v_counts_before jsonb;
  v_counts_after jsonb;
  v_opened_at timestamptz;
  v_closed_at timestamptz;
  v_gross_revenue numeric(12,2);
  v_net_revenue numeric(12,2);
  v_entry jsonb;
  v_denomination public.cash_denominations%rowtype;
  v_quantity integer;
  v_advance_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not (
    app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Only management can correct closed shifts';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Correction reason is required'; end if;

  select * into v_shift from public.shifts where id = p_shift_id for update;
  if not found then raise exception 'Shift not found'; end if;
  if v_shift.status not in ('closed', 'auto_closed') then raise exception 'Only closed shifts can be corrected'; end if;
  if not (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
    or app_private.current_user_can_access_store(v_shift.store_id)
  ) then raise exception 'Store access denied'; end if;

  select * into v_store from public.stores where id = v_shift.store_id;
  if v_store.timezone is null then raise exception 'Store timezone is missing'; end if;
  if p_opened_local is null or p_closed_local is null then raise exception 'Open and close times are required'; end if;
  v_opened_at := p_opened_local at time zone v_store.timezone;
  v_closed_at := p_closed_local at time zone v_store.timezone;
  if v_closed_at <= v_opened_at then raise exception 'Close time must be after open time'; end if;

  if p_cash_revenue is null or p_card_revenue is null or p_cash_returns is null or p_card_returns is null
    or p_receipt_count is null or p_receipt_count < 0
    or coalesce(p_cash_revenue, 0) < 0 or coalesce(p_card_revenue, 0) < 0
    or coalesce(p_cash_returns, 0) < 0 or coalesce(p_card_returns, 0) < 0
    or coalesce(p_items_sold_count, 0) < 0 or coalesce(p_cash_collection_amount, 0) < 0
    or coalesce(p_check_depth, 0) < 0 or coalesce(p_advance_amount, 0) < 0
    or coalesce(p_actual_cash_amount, 0) < 0 then
    raise exception 'Report values cannot be negative or missing';
  end if;
  v_gross_revenue := round(p_cash_revenue + p_card_revenue, 2);
  v_net_revenue := round(v_gross_revenue - p_cash_returns - p_card_returns, 2);
  if v_net_revenue < 0 then raise exception 'Returns cannot exceed gross revenue'; end if;
  if coalesce(p_cash_collection_amount, 0) > 0 and nullif(trim(coalesce(p_cash_collection_comment, '')), '') is null then
    raise exception 'Cash collection comment is required';
  end if;
  if jsonb_typeof(coalesce(p_cash_counts, '[]'::jsonb)) <> 'array' then raise exception 'Cash counts must be an array'; end if;

  select * into v_report from public.shift_closing_reports where shift_id = p_shift_id for update;
  if not found then
    v_report_before := '{}'::jsonb;
    insert into public.shift_closing_reports (
      shift_id, created_by_employee_id, created_by, updated_by
    ) values (
      p_shift_id, v_shift.opened_by_employee_id, auth.uid(), auth.uid()
    ) returning * into v_report;
  else
    v_report_before := to_jsonb(v_report);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('denomination_id', c.denomination_id, 'value', d.value, 'kind', d.kind,
      'quantity', c.quantity, 'line_amount', c.line_amount) order by d.value desc), '[]'::jsonb)
    into v_counts_before
    from public.shift_cash_counts c
    join public.cash_denominations d on d.id = c.denomination_id
    where c.shift_closing_report_id = v_report.id;

  update public.shifts
  set opened_at = v_opened_at, closed_at = v_closed_at, updated_at = now(), updated_by = auth.uid()
  where id = p_shift_id;

  update public.shift_closing_reports
  set cash_revenue = p_cash_revenue,
      card_revenue = p_card_revenue,
      cash_returns = p_cash_returns,
      card_returns = p_card_returns,
      receipt_count = p_receipt_count,
      items_sold_count = p_items_sold_count,
      gross_revenue = v_gross_revenue,
      net_revenue = v_net_revenue,
      cash_collection_amount = p_cash_collection_amount,
      cash_collection_comment = nullif(trim(coalesce(p_cash_collection_comment, '')), ''),
      check_depth = p_check_depth,
      advance_amount = p_advance_amount,
      actual_cash_amount = p_actual_cash_amount,
      updated_by = auth.uid(),
      updated_at = now()
  where id = v_report.id
  returning * into v_report;

  delete from public.shift_cash_counts where shift_closing_report_id = v_report.id;
  for v_entry in select value from jsonb_array_elements(coalesce(p_cash_counts, '[]'::jsonb)) loop
    if nullif(v_entry->>'denomination_id', '') is null then raise exception 'Cash denomination is required'; end if;
    v_quantity := (v_entry->>'quantity')::integer;
    if v_quantity is null or v_quantity < 0 then raise exception 'Cash quantities cannot be negative'; end if;
    select * into v_denomination from public.cash_denominations
      where id = (v_entry->>'denomination_id')::uuid;
    if not found then raise exception 'Cash denomination not found'; end if;
    insert into public.shift_cash_counts (shift_closing_report_id, denomination_id, quantity, line_amount)
    values (v_report.id, v_denomination.id, v_quantity, round(v_denomination.value * v_quantity, 2));
  end loop;

  select id into v_advance_id from public.employee_advances
  where shift_id = p_shift_id and source = 'shift_closing'
  order by created_at desc limit 1 for update;
  if v_advance_id is null and coalesce(p_advance_amount, 0) > 0 then
    insert into public.employee_advances (
      employee_id, shift_id, period_month, amount, source, created_by, updated_by
    ) values (
      v_shift.opened_by_employee_id, p_shift_id, date_trunc('month', v_shift.shift_date)::date,
      p_advance_amount, 'shift_closing', auth.uid(), auth.uid()
    );
  elsif v_advance_id is not null then
    update public.employee_advances set amount = coalesce(p_advance_amount, 0), updated_at = now(), updated_by = auth.uid()
    where id = v_advance_id;
  end if;

  insert into public.sales_metrics (
    shift_id, employee_id, store_id, period_month, gross_revenue, receipt_count, items_sold_count,
    average_check_amount, check_depth, sales_percent, sales_pay_amount
  )
  select p_shift_id, sp.employee_id, v_shift.store_id, date_trunc('month', v_shift.shift_date)::date,
    v_gross_revenue, p_receipt_count, p_items_sold_count,
    public.calculate_average_check_amount(v_gross_revenue, p_receipt_count),
    coalesce(p_check_depth, public.calculate_check_depth(p_items_sold_count, p_receipt_count)),
    sp.sales_percent, public.calculate_shift_sales_pay(v_gross_revenue, sp.participant_role)
  from public.shift_participants sp
  where sp.shift_id = p_shift_id
  on conflict (shift_id, employee_id) do update
  set gross_revenue = excluded.gross_revenue,
      receipt_count = excluded.receipt_count,
      items_sold_count = excluded.items_sold_count,
      average_check_amount = excluded.average_check_amount,
      check_depth = excluded.check_depth,
      sales_percent = excluded.sales_percent,
      sales_pay_amount = excluded.sales_pay_amount,
      updated_at = now();

  update public.shift_snapshots set data = public.calculate_shift_snapshot_data(p_shift_id)
  where shift_id = p_shift_id;

  select coalesce(jsonb_agg(jsonb_build_object('denomination_id', c.denomination_id, 'value', d.value, 'kind', d.kind,
      'quantity', c.quantity, 'line_amount', c.line_amount) order by d.value desc), '[]'::jsonb)
    into v_counts_after
    from public.shift_cash_counts c
    join public.cash_denominations d on d.id = c.denomination_id
    where c.shift_closing_report_id = v_report.id;

  insert into public.shift_closing_report_audit (
    shift_id, changed_by, changed_by_employee_id, actor_role, reason, previous_shift, next_shift,
    previous_report, next_report, previous_cash_counts, next_cash_counts
  ) values (
    p_shift_id, auth.uid(), app_private.current_user_employee_id(),
    case
      when app_private.current_user_has_role('developer') then 'developer'
      when app_private.current_user_has_role('super_admin') then 'super_admin'
      else 'store_manager'
    end,
    trim(p_reason),
    jsonb_build_object('opened_at', v_shift.opened_at, 'closed_at', v_shift.closed_at),
    jsonb_build_object('opened_at', v_opened_at, 'closed_at', v_closed_at),
    v_report_before, to_jsonb(v_report), v_counts_before, v_counts_after
  );
  return v_report;
end;
$$;

revoke all on function public.correct_closed_shift_report(uuid,timestamp,timestamp,numeric,numeric,numeric,numeric,integer,integer,numeric,text,numeric,numeric,numeric,jsonb,text) from public, anon;
grant execute on function public.correct_closed_shift_report(uuid,timestamp,timestamp,numeric,numeric,numeric,numeric,integer,integer,numeric,text,numeric,numeric,numeric,jsonb,text) to authenticated;
