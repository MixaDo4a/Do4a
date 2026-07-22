drop policy if exists "profiles_select_accessible_store_employees" on public.profiles;
create policy "profiles_select_accessible_store_employees"
  on public.profiles
  for select
  to authenticated
  using (app_private.current_user_can_access_profile_role(id));
