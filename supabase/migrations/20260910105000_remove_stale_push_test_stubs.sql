-- Remove stale no-op overloads left by database diagnostics. The real push
-- RPCs have explicit event/filter parameters and remain untouched.
drop function if exists public.list_push_notification_targets();
drop function if exists public.list_push_notification_targets(uuid);
