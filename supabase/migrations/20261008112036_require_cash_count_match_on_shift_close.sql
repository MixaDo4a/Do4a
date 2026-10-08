create or replace function public.close_shift_with_advance_recipient(
  p_shift_id uuid,
  p_cash_revenue numeric,
  p_card_revenue numeric,
  p_cash_returns numeric,
  p_card_returns numeric,
  p_receipt_count integer,
  p_items_sold_count integer,
  p_cash_collection_amount numeric,
  p_cash_collection_comment text,
  p_advance_amount numeric,
  p_advance_employee_id uuid,
  p_cash_counts jsonb,
  p_actual_cash_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_result uuid;
  v_employee_id uuid;
  v_advance numeric(12,2) := coalesce(p_advance_amount, 0);
  v_last_counted_amount numeric(20,2);
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if p_actual_cash_amount is null or p_actual_cash_amount < 0 then
    raise exception 'Actual cash amount is required and cannot be negative';
  end if;

  select * into v_shift
  from public.shifts
  where id = p_shift_id;

  if not found then
    raise exception 'Shift not found';
  end if;

  select counted_amount into v_last_counted_amount
  from public.store_cash_counts
  where store_id = v_shift.store_id
  order by created_at desc, id desc
  limit 1;

  if not found then
    raise exception 'Latest cash count is required before closing shift';
  end if;

  if round(v_last_counted_amount, 2) <> round(p_actual_cash_amount, 2) then
    raise exception 'Cash balance mismatch: cash count %, Z-report %',
      v_last_counted_amount, p_actual_cash_amount;
  end if;

  v_employee_id := (select app_private.current_user_employee_id());
  if not (
    v_shift.opened_by_employee_id = v_employee_id
    or (select app_private.current_user_has_role('manager'::public.user_role_code))
    or (select app_private.current_user_has_role('store_manager'::public.user_role_code))
    or (select app_private.current_user_has_role('super_admin'::public.user_role_code))
    or (select app_private.current_user_has_role('developer'::public.user_role_code))
  ) then
    raise exception 'Only assigned staff, manager, or admin can close shift';
  end if;

  if v_advance < 0 then
    raise exception 'Advance amount cannot be negative';
  end if;

  if v_advance > 0 then
    if p_advance_employee_id is null then
      raise exception 'Advance recipient is required';
    end if;

    if not exists (
      select 1
      from public.employees e
      join public.profiles p on p.employee_id = e.id and p.is_blocked = false
      join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
      join public.roles r on r.id = ur.role_id and r.code = 'manager'::public.user_role_code
      join public.stores shift_store on shift_store.id = v_shift.store_id
      where e.id = p_advance_employee_id
        and lower(btrim(e.city)) = lower(btrim(shift_store.city))
        and e.is_active = true
        and e.terminated_at is null
        and (ur.scope_city is null or lower(btrim(ur.scope_city)) = lower(btrim(shift_store.city)))
        and (
          ur.scope_store_id is null
          or exists (
            select 1
            from public.stores scoped_store
            where scoped_store.id = ur.scope_store_id
              and lower(btrim(scoped_store.city)) = lower(btrim(shift_store.city))
          )
        )
    ) then
      raise exception 'Advance recipient must be an active manager in the shift city';
    end if;
  end if;

  v_result := public.close_shift(
    p_shift_id,
    p_cash_revenue,
    p_card_revenue,
    p_cash_returns,
    p_card_returns,
    p_receipt_count,
    p_items_sold_count,
    p_cash_collection_amount,
    p_cash_collection_comment,
    case when v_advance > 0 then null else p_advance_amount end,
    p_cash_counts
  );

  update public.shift_closing_reports
  set actual_cash_amount = p_actual_cash_amount
  where shift_id = p_shift_id;

  if v_advance > 0 then
    update public.shift_closing_reports
    set advance_amount = v_advance
    where shift_id = p_shift_id;

    insert into public.employee_advances (
      employee_id, shift_id, period_month, amount, source, created_by, updated_by
    )
    values (
      p_advance_employee_id,
      p_shift_id,
      date_trunc('month', v_shift.shift_date)::date,
      v_advance,
      'shift_closing',
      (select auth.uid()),
      (select auth.uid())
    );
  end if;

  return v_result;
end;
$$;

revoke all on function public.close_shift_with_advance_recipient(
  uuid, numeric, numeric, numeric, numeric, integer, integer, numeric, text, numeric, uuid, jsonb, numeric
) from public, anon;
grant execute on function public.close_shift_with_advance_recipient(
  uuid, numeric, numeric, numeric, numeric, integer, integer, numeric, text, numeric, uuid, jsonb, numeric
) to authenticated;
