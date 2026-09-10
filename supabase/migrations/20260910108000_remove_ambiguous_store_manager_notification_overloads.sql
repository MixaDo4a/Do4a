-- Keep one overload per notification function. The final argument remains
-- optional, so existing six-argument calls stay backward compatible.
drop function if exists public.send_store_managers_notification(
  uuid, text, text, text, text, uuid
);

drop function if exists app_private.notify_store_managers(
  uuid, text, text, text, text, uuid
);
