create or replace function app_private.admin_list_accessible_stores()
returns table (
  id uuid,
  name text,
  city text
)
language sql
security definer
set search_path = public, app_private
as $$
  select s.id, s.name, s.city
    from public.stores s
   where app_private.current_user_has_role('developer')
      or app_private.current_user_has_role('super_admin')
      or app_private.current_user_can_access_store(s.id)
   order by s.city, s.name;
$$;

revoke all on function app_private.admin_list_accessible_stores() from public;
grant execute on function app_private.admin_list_accessible_stores() to authenticated;

create or replace function public.admin_list_accessible_stores()
returns table (
  id uuid,
  name text,
  city text
)
language sql
security definer
set search_path = public, app_private
as $$
  select * from app_private.admin_list_accessible_stores();
$$;

revoke all on function public.admin_list_accessible_stores() from public;
grant execute on function public.admin_list_accessible_stores() to authenticated;
