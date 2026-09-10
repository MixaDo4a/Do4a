create or replace function public.run_day_routine_evening_reminders(
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, app_private
as $$
begin
  if not (
    app_private.current_user_has_role('manager')
    or app_private.current_user_has_role('store_manager')
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  ) then
    raise exception 'Недостаточно прав для запуска напоминаний распорядка';
  end if;

  return app_private.run_day_routine_evening_reminders(p_now);
end;
$$;

grant execute on function public.run_day_routine_evening_reminders(timestamptz) to authenticated;

-- Internal academy helper; client code does not call it directly.
revoke all on function public.academy_user_rank_order(uuid) from public, anon, authenticated;
