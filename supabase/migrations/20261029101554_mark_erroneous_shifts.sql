alter table public.shifts
  add column is_erroneous boolean not null default false,
  add column erroneous_marked_at timestamptz,
  add column erroneous_marked_by uuid references auth.users(id);

create index shifts_erroneous_date_idx
  on public.shifts (shift_date, store_id)
  where is_erroneous = true;

create or replace function public.close_shift_with_erroneous_flag(
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
  p_actual_cash_amount numeric,
  p_mark_erroneous boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_shift public.shifts%rowtype;
  v_closed_shift_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Authentication required';
  end if;

  if coalesce(p_mark_erroneous, false) then
    select * into v_shift
    from public.shifts
    where id = p_shift_id
    for update;
    if not found then raise exception 'Shift not found'; end if;

    if not (
      (select app_private.current_user_has_role('manager'::public.user_role_code))
      or (select app_private.current_user_has_role('store_manager'::public.user_role_code))
      or (select app_private.current_user_has_role('super_admin'::public.user_role_code))
      or (select app_private.current_user_has_role('developer'::public.user_role_code))
    ) then
      raise exception 'Only managers can mark a shift erroneous';
    end if;

    if (select app_private.current_user_has_role('store_manager'::public.user_role_code))
      and not (select app_private.current_user_has_role('super_admin'::public.user_role_code))
      and not (select app_private.current_user_has_role('developer'::public.user_role_code))
      and not app_private.current_user_can_access_store(v_shift.store_id) then
      raise exception 'Store access denied';
    end if;
  end if;

  v_closed_shift_id := public.close_shift_with_advance_recipient(
    p_shift_id,
    p_cash_revenue,
    p_card_revenue,
    p_cash_returns,
    p_card_returns,
    p_receipt_count,
    p_items_sold_count,
    p_cash_collection_amount,
    p_cash_collection_comment,
    p_advance_amount,
    p_advance_employee_id,
    p_cash_counts,
    p_actual_cash_amount
  );

  if coalesce(p_mark_erroneous, false) then
    update public.shifts
    set is_erroneous = true,
        erroneous_marked_at = clock_timestamp(),
        erroneous_marked_by = (select auth.uid()),
        updated_by = (select auth.uid())
    where id = v_closed_shift_id and status in ('closed', 'auto_closed');

    if not found then raise exception 'Closed shift could not be marked erroneous'; end if;

    delete from public.sales_metrics where shift_id = v_closed_shift_id;
  end if;

  return v_closed_shift_id;
end;
$$;

revoke all on function public.close_shift_with_erroneous_flag(
  uuid, numeric, numeric, numeric, numeric, integer, integer,
  numeric, text, numeric, uuid, jsonb, numeric, boolean
) from public, anon;
grant execute on function public.close_shift_with_erroneous_flag(
  uuid, numeric, numeric, numeric, numeric, integer, integer,
  numeric, text, numeric, uuid, jsonb, numeric, boolean
) to authenticated;
