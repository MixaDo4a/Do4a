-- Make push subscriptions visible to Supabase Data API and writable for authenticated users.
-- This migration is idempotent and safe to run more than once.

grant usage on schema public to authenticated;

grant select, insert, update, delete on table public.push_subscriptions to authenticated;

-- If the project uses service_role calls through PostgREST, keep access explicit as well.
-- Postgres roles that are not authenticated can still be covered by service_role in Supabase,
-- but this grant is harmless and keeps the table accessible for internal API calls.
grant select, insert, update, delete on table public.push_subscriptions to service_role;

