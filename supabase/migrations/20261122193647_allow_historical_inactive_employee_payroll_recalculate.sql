-- Recalculate salary for inactive employees who have historical payroll data.
-- Preserve the existing function's authorization and all calculation rules.
do $$
declare
  v_function regprocedure;
  v_definition text;
  v_old text := E'where id = p_employee_id\n    and is_active = true;';
  v_new text := E'where id = p_employee_id;';
begin
  v_function := pg_catalog.to_regprocedure(
    'public.calculate_employee_payroll_period_pre_store_expiration(uuid,date)'
  );
  if v_function is null then
    v_function := pg_catalog.to_regprocedure(
      'public.calculate_employee_payroll_period_pre_debt_carryover(uuid,date)'
    );
  end if;
  if v_function is null then
    raise exception 'Expected payroll calculation function was not found';
  end if;

  v_definition := pg_catalog.pg_get_functiondef(v_function);
  if pg_catalog.strpos(v_definition, v_old) = 0 then
    raise exception 'Expected active employee lookup was not found; review migration before applying';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$$;
