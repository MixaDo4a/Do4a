do $$
begin
  alter type public.schedule_status add value if not exists 'planned_secondary';
exception
  when duplicate_object then null;
end $$;
