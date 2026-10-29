create or replace function app_private.prevent_profile_employee_relink()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.employee_id is distinct from old.employee_id
    and current_user not in ('postgres', 'service_role') then
    raise exception 'Only a privileged server process can change profiles.employee_id'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function app_private.prevent_profile_employee_relink() from public, anon, authenticated;

drop trigger if exists profiles_prevent_employee_relink on public.profiles;
create trigger profiles_prevent_employee_relink
before update of employee_id on public.profiles
for each row execute function app_private.prevent_profile_employee_relink();
