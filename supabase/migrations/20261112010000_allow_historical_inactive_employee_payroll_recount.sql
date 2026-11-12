do $$
declare
  v_definition text;
  v_old_guard text := E'where id = p_employee_id\n    and is_active = true;';
  v_new_guard text := E'where id = p_employee_id\n    and (\n      is_active = true\n      or exists (\n        select 1\n        from public.shift_participants sp\n        join public.shifts sh on sh.id = sp.shift_id\n        where sp.employee_id = p_employee_id\n          and sh.shift_date >= v_period_start\n          and sh.shift_date <= v_period_end\n          and sh.status in (''closed'', ''auto_closed'')\n      )\n    );';
begin
  select pg_get_functiondef(
    'public.calculate_employee_payroll_period_pre_debt_carryover(uuid,date)'::regprocedure
  )
  into v_definition;

  if position(v_old_guard in v_definition) = 0 then
    raise exception 'Unexpected payroll employee guard; review migration before applying';
  end if;

  v_definition := replace(v_definition, v_old_guard, v_new_guard);
  execute v_definition;
end;
$$;
