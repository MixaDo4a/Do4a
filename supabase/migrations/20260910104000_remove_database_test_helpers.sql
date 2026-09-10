-- Remove temporary diagnostic functions that were accidentally left in the
-- exposed public schema. They are not referenced by the application.
do $$
declare
  v_function record;
begin
  for v_function in
    select p.oid::regprocedure::text as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like 'test_%' or p.proname like '__codex_%')
  loop
    execute format('drop function if exists public.%s', v_function.signature);
  end loop;
end;
$$;
