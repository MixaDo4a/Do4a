-- Historical closed shifts remain valid payroll inputs after an employee is deactivated.
-- Keep the existing authorization and calculations unchanged; only remove the
-- current-employee status gate from the implementation wrapped by the debt RPC.
do $$
declare
  v_definition text;
  v_old text := $sql$  where id = p_employee_id
    and is_active = true;$sql$;
  v_new text := $sql$  where id = p_employee_id;$sql$;
begin
  select pg_get_functiondef(
    'public.calculate_employee_payroll_period_pre_debt_carryover(uuid,date)'::regprocedure
  )
  into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Expected active employee guard was not found';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$$;
