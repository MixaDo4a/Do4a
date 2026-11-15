-- Historical closed shifts must remain recalculable after an employee is archived.
-- Keep the existing payroll calculation and authorization rules unchanged; only
-- remove the active-status guard from the employee lookup used by the function.
do $$
declare
  v_definition text;
  v_old text := E'where id = p_employee_id\n    and is_active = true;';
  v_new text := E'where id = p_employee_id;';
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.calculate_employee_payroll_period_pre_debt_carryover(uuid,date)'::pg_catalog.regprocedure
  );

  if pg_catalog.position(v_old in v_definition) = 0 then
    raise exception 'Expected active employee lookup was not found; review migration before applying';
  end if;

  execute pg_catalog.replace(v_definition, v_old, v_new);
end;
$$;
