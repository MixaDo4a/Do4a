-- SECURITY DEFINER notification functions must not be executable by PUBLIC.
revoke execute on function public.run_notification_cron(timestamptz) from public, anon, authenticated;
grant execute on function public.run_notification_cron(timestamptz) to service_role;

revoke execute on function public.send_employee_notification(uuid, text, text, text, text, uuid) from public, anon;
revoke execute on function public.send_store_managers_notification(uuid, text, text, text, text, uuid) from public, anon;
revoke execute on function public.send_store_managers_notification(uuid, text, text, text, text, uuid, uuid) from public, anon;
revoke execute on function public.send_store_employees_notification(uuid, text, text, text, uuid, text, uuid) from public, anon;
revoke execute on function public.send_store_employees_notification(uuid, text, text, text, uuid, uuid, text, uuid, uuid) from public, anon;

grant execute on function public.send_employee_notification(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.send_store_managers_notification(uuid, text, text, text, text, uuid) to authenticated;
grant execute on function public.send_store_managers_notification(uuid, text, text, text, text, uuid, uuid) to authenticated;
grant execute on function public.send_store_employees_notification(uuid, text, text, text, uuid, text, uuid) to authenticated;
grant execute on function public.send_store_employees_notification(uuid, text, text, text, uuid, uuid, text, uuid, uuid) to authenticated;
