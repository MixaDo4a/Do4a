-- Server-side calculation and workflow functions.
-- These functions keep core business logic out of the frontend.

create or replace function public.calculate_check_depth(
  p_items_sold_count integer,
  p_receipt_count integer
)
returns numeric
language sql
immutable
as $$
  select case
    when p_receipt_count is null or p_receipt_count <= 0 then null
    when p_items_sold_count is null then null
    else round((p_items_sold_count::numeric / p_receipt_count::numeric), 2)
  end;
$$;

create or replace function public.calculate_average_check_amount(
  p_gross_revenue numeric,
  p_receipt_count integer
)
returns numeric
language sql
immutable
as $$
  select case
    when p_receipt_count is null or p_receipt_count <= 0 then null
    when p_gross_revenue is null then null
    else round((p_gross_revenue / p_receipt_count::numeric), 2)
  end;
$$;

create or replace function public.calculate_checklist_item_result(
  p_weight_amount numeric,
  p_score integer
)
returns numeric
language sql
immutable
as $$
  select round((coalesce(p_weight_amount, 0) / 10.0) * p_score, 2);
$$;

create or replace function public.calculate_inventory_amounts(
  p_turnover_amount numeric,
  p_loss_amount numeric
)
returns table (
  company_compensation_amount numeric,
  amount_after_compensation numeric,
  distributable_amount numeric
)
language sql
immutable
as $$
  select
    round(greatest(coalesce(p_turnover_amount, 0), 0) * 0.003, 2) as company_compensation_amount,
    round(greatest(coalesce(p_loss_amount, 0) - (greatest(coalesce(p_turnover_amount, 0), 0) * 0.003), 0), 2) as amount_after_compensation,
    round(greatest(coalesce(p_loss_amount, 0) - (greatest(coalesce(p_turnover_amount, 0), 0) * 0.003), 0) / 4.0, 2) as distributable_amount;
$$;

create or replace function public.calculate_inventory_employee_amount(
  p_distributable_amount numeric,
  p_worked_days numeric,
  p_total_worked_days numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when coalesce(p_total_worked_days, 0) <= 0 then 0
    else round(greatest(coalesce(p_distributable_amount, 0), 0) * (greatest(coalesce(p_worked_days, 0), 0) / p_total_worked_days), 2)
  end;
$$;

create or replace function public.calculate_payroll_total(
  p_sales_pay_amount numeric,
  p_plan_bonus_amount numeric,
  p_base_salary_amount numeric,
  p_manual_bonus_amount numeric,
  p_advance_amount numeric,
  p_expiration_writeoff_amount numeric,
  p_inventory_loss_amount numeric,
  p_product_writeoff_amount numeric
)
returns numeric
language sql
immutable
as $$
  select round(
    coalesce(p_sales_pay_amount, 0)
    + coalesce(p_plan_bonus_amount, 0)
    + coalesce(p_base_salary_amount, 0)
    + coalesce(p_manual_bonus_amount, 0)
    - coalesce(p_advance_amount, 0)
    - coalesce(p_expiration_writeoff_amount, 0)
    - coalesce(p_inventory_loss_amount, 0)
    - coalesce(p_product_writeoff_amount, 0),
    2
  );
$$;

create or replace function public.calculate_shift_sales_pay(
  p_gross_revenue numeric,
  p_participant_role public.shift_participant_role
)
returns numeric
language sql
immutable
as $$
  select round(
    greatest(coalesce(p_gross_revenue, 0), 0)
    * case
        when p_participant_role = 'primary_seller' then 0.02
        when p_participant_role = 'secondary_seller' then 0.01
        else 0
      end,
    2
  );
$$;

create or replace function public.calculate_shift_snapshot_data(p_shift_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'shift', to_jsonb(s),
    'closing_report', to_jsonb(scr),
    'participants', coalesce((
      select jsonb_agg(to_jsonb(sp) order by sp.participant_role)
      from public.shift_participants sp
      where sp.shift_id = s.id
    ), '[]'::jsonb),
    'cash_counts', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'denomination_id', scc.denomination_id,
          'value', cd.value,
          'kind', cd.kind,
          'quantity', scc.quantity,
          'line_amount', scc.line_amount
        )
        order by cd.value desc
      )
      from public.shift_cash_counts scc
      join public.cash_denominations cd on cd.id = scc.denomination_id
      where scc.shift_closing_report_id = scr.id
    ), '[]'::jsonb)
  )
  from public.shifts s
  left join public.shift_closing_reports scr on scr.shift_id = s.id
  where s.id = p_shift_id;
$$;

-- Managers who opened the shift need to create a snapshot while closing it.
create policy "shift_snapshots_primary_insert"
  on public.shift_snapshots
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and s.opened_by_employee_id = app_private.current_user_employee_id()
    )
  );

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
  ) then
    raise exception 'Only primary seller or super admin can close shift';
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
    'Shift closed by primary seller or super admin'
  );

  return p_shift_id;
end;
$$;

create or replace function public.auto_close_shift(p_shift_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_shift public.shifts%rowtype;
begin
  if not (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  ) then
    raise exception 'Only manager or super admin can auto-close shift';
  end if;

  select *
  into v_shift
  from public.shifts
  where id = p_shift_id
  for update;

  if not found then
    raise exception 'Shift not found';
  end if;

  if v_shift.status <> 'opened' then
    return p_shift_id;
  end if;

  update public.shifts
  set
    status = 'auto_closed',
    auto_closed_at = now(),
    requires_review = true,
    review_reason = 'Auto-closed at end of store workday',
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
    'auto_closed_requires_review'
  );

  perform public.log_audit_event(
    'shift.auto_closed',
    'shift',
    p_shift_id,
    to_jsonb(v_shift),
    (select to_jsonb(s) from public.shifts s where s.id = p_shift_id),
    'Shift auto-closed and marked as requiring review'
  );

  return p_shift_id;
end;
$$;

create policy "sales_metrics_manage_related_shift"
  on public.sales_metrics
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
          or (
            app_private.current_user_has_role('store_manager')
            and app_private.current_user_can_access_store(s.store_id)
          )
        )
    )
  )
  with check (
    exists (
      select 1
      from public.shifts s
      where s.id = shift_id
        and (
          s.opened_by_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_has_role('super_admin')
          or (
            app_private.current_user_has_role('store_manager')
            and app_private.current_user_can_access_store(s.store_id)
          )
        )
    )
  );
