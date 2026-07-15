grant select, insert, update on table
  public.tasks,
  public.task_comments,
  public.shifts,
  public.shift_closing_reports,
  public.shift_cash_counts,
  public.shift_snapshots,
  public.sales_metrics,
  public.employee_advances
to authenticated;

drop policy if exists "tasks_developer_all" on public.tasks;
create policy "tasks_developer_all"
  on public.tasks
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "task_comments_developer_all" on public.task_comments;
create policy "task_comments_developer_all"
  on public.task_comments
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "shifts_developer_all" on public.shifts;
create policy "shifts_developer_all"
  on public.shifts
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "shift_closing_reports_developer_all" on public.shift_closing_reports;
create policy "shift_closing_reports_developer_all"
  on public.shift_closing_reports
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "shift_cash_counts_developer_all" on public.shift_cash_counts;
create policy "shift_cash_counts_developer_all"
  on public.shift_cash_counts
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "shift_snapshots_developer_all" on public.shift_snapshots;
create policy "shift_snapshots_developer_all"
  on public.shift_snapshots
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "sales_metrics_developer_all" on public.sales_metrics;
create policy "sales_metrics_developer_all"
  on public.sales_metrics
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

drop policy if exists "employee_advances_developer_all" on public.employee_advances;
create policy "employee_advances_developer_all"
  on public.employee_advances
  for all
  to authenticated
  using (app_private.current_user_has_role('developer'))
  with check (app_private.current_user_has_role('developer'));

create or replace function public.close_shift(
  p_shift_id uuid,
  p_cash_revenue numeric,
  p_card_revenue numeric,
  p_cash_returns numeric,
  p_card_returns numeric,
  p_receipt_count integer,
  p_items_sold_count integer,
  p_cash_collection_amount numeric default null,
  p_cash_collection_comment text default null,
  p_advance_amount numeric default null,
  p_cash_counts jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
  v_report_id uuid;
  v_employee_id uuid;
  v_gross_revenue numeric(12,2);
  v_net_revenue numeric(12,2);
  v_check_depth numeric(10,2);
  v_cash_count jsonb;
  v_denomination public.cash_denominations%rowtype;
  v_line_amount numeric(12,2);
begin
  v_employee_id := app_private.current_user_employee_id();

  select *
  into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found then
    raise exception 'Shift not found';
  end if;

  if v_shift.status not in ('opened', 'correction_required') then
    raise exception 'Shift cannot be closed from status %', v_shift.status;
  end if;

  if not (
    v_shift.opened_by_employee_id = v_employee_id
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Only primary seller, super admin, or developer can close shift';
  end if;

  if coalesce(p_cash_revenue, 0) < 0
    or coalesce(p_card_revenue, 0) < 0
    or coalesce(p_cash_returns, 0) < 0
    or coalesce(p_card_returns, 0) < 0
    or coalesce(p_receipt_count, 0) < 0
    or coalesce(p_items_sold_count, 0) < 0
    or coalesce(p_cash_collection_amount, 0) < 0
    or coalesce(p_advance_amount, 0) < 0
  then
    raise exception 'Cash report values cannot be negative';
  end if;

  if coalesce(p_cash_collection_amount, 0) > 0
    and nullif(btrim(coalesce(p_cash_collection_comment, '')), '') is null
  then
    raise exception 'Cash collection comment is required';
  end if;

  v_gross_revenue := round(coalesce(p_cash_revenue, 0) + coalesce(p_card_revenue, 0), 2);
  v_net_revenue := round(v_gross_revenue - coalesce(p_cash_returns, 0) - coalesce(p_card_returns, 0), 2);
  v_check_depth := public.calculate_check_depth(p_items_sold_count, p_receipt_count);

  insert into public.shift_closing_reports (
    shift_id,
    cash_revenue,
    card_revenue,
    cash_returns,
    card_returns,
    receipt_count,
    items_sold_count,
    gross_revenue,
    net_revenue,
    cash_collection_amount,
    cash_collection_comment,
    check_depth,
    advance_amount,
    created_by_employee_id,
    created_by,
    updated_by
  )
  values (
    p_shift_id,
    coalesce(p_cash_revenue, 0),
    coalesce(p_card_revenue, 0),
    coalesce(p_cash_returns, 0),
    coalesce(p_card_returns, 0),
    coalesce(p_receipt_count, 0),
    p_items_sold_count,
    v_gross_revenue,
    v_net_revenue,
    p_cash_collection_amount,
    p_cash_collection_comment,
    v_check_depth,
    p_advance_amount,
    v_shift.opened_by_employee_id,
    (select auth.uid()),
    (select auth.uid())
  )
  on conflict (shift_id) do update
  set
    cash_revenue = excluded.cash_revenue,
    card_revenue = excluded.card_revenue,
    cash_returns = excluded.cash_returns,
    card_returns = excluded.card_returns,
    receipt_count = excluded.receipt_count,
    items_sold_count = excluded.items_sold_count,
    gross_revenue = excluded.gross_revenue,
    net_revenue = excluded.net_revenue,
    cash_collection_amount = excluded.cash_collection_amount,
    cash_collection_comment = excluded.cash_collection_comment,
    check_depth = excluded.check_depth,
    advance_amount = excluded.advance_amount,
    updated_by = (select auth.uid()),
    updated_at = now()
  returning id into v_report_id;

  delete from public.shift_cash_counts
  where shift_closing_report_id = v_report_id;

  for v_cash_count in
    select value
    from jsonb_array_elements(coalesce(p_cash_counts, '[]'::jsonb))
  loop
    select *
    into v_denomination
    from public.cash_denominations
    where id = (v_cash_count->>'denomination_id')::uuid
      and is_active = true;

    if not found then
      raise exception 'Cash denomination not found or inactive';
    end if;

    v_line_amount := round(v_denomination.value * greatest(coalesce((v_cash_count->>'quantity')::integer, 0), 0), 2);

    insert into public.shift_cash_counts (
      shift_closing_report_id,
      denomination_id,
      quantity,
      line_amount
    )
    values (
      v_report_id,
      v_denomination.id,
      greatest(coalesce((v_cash_count->>'quantity')::integer, 0), 0),
      v_line_amount
    );
  end loop;

  if coalesce(p_advance_amount, 0) > 0 then
    insert into public.employee_advances (
      employee_id,
      shift_id,
      period_month,
      amount,
      source,
      created_by,
      updated_by
    )
    values (
      v_shift.opened_by_employee_id,
      p_shift_id,
      date_trunc('month', v_shift.shift_date)::date,
      p_advance_amount,
      'shift_closing',
      (select auth.uid()),
      (select auth.uid())
    );
  end if;

  update public.shifts
  set
    status = 'closed',
    closed_by_employee_id = v_shift.opened_by_employee_id,
    closed_at = now(),
    requires_review = false,
    review_reason = null,
    updated_by = (select auth.uid())
  where id = p_shift_id;

  insert into public.shift_snapshots (
    shift_id,
    snapshot_version,
    data,
    data_quality
  )
  values (
    p_shift_id,
    1,
    public.calculate_shift_snapshot_data(p_shift_id),
    'complete'
  );

  insert into public.sales_metrics (
    shift_id,
    employee_id,
    store_id,
    period_month,
    gross_revenue,
    receipt_count,
    items_sold_count,
    average_check_amount,
    check_depth,
    sales_percent,
    sales_pay_amount
  )
  select
    p_shift_id,
    sp.employee_id,
    v_shift.store_id,
    date_trunc('month', v_shift.shift_date)::date,
    v_gross_revenue,
    coalesce(p_receipt_count, 0),
    p_items_sold_count,
    public.calculate_average_check_amount(v_gross_revenue, p_receipt_count),
    v_check_depth,
    sp.sales_percent,
    public.calculate_shift_sales_pay(v_gross_revenue, sp.participant_role)
  from public.shift_participants sp
  where sp.shift_id = p_shift_id
  on conflict (shift_id, employee_id) do update
  set
    gross_revenue = excluded.gross_revenue,
    receipt_count = excluded.receipt_count,
    items_sold_count = excluded.items_sold_count,
    average_check_amount = excluded.average_check_amount,
    check_depth = excluded.check_depth,
    sales_percent = excluded.sales_percent,
    sales_pay_amount = excluded.sales_pay_amount,
    updated_at = now();

  perform public.log_audit_event(
    'shift.closed',
    'shift',
    p_shift_id,
    to_jsonb(v_shift),
    public.calculate_shift_snapshot_data(p_shift_id),
    'Shift closed by primary seller, super admin, or developer'
  );

  return p_shift_id;
end;
$$;

grant execute on function public.close_shift(
  uuid,
  numeric,
  numeric,
  numeric,
  numeric,
  integer,
  integer,
  numeric,
  text,
  numeric,
  jsonb
) to authenticated;
