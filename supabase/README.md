# Supabase

## Current state

This folder contains draft SQL migrations for the project database:

- `migrations/202607030001_initial_core.sql`
- `migrations/202607030002_operations.sql`
- `migrations/202607030003_calculation_functions.sql`

The migration is written as plain SQL because Supabase CLI is not installed in the current local environment.

## What the migrations include

### `202607030001_initial_core.sql`

- Core enum types.
- Stores.
- Employees.
- Profiles linked to Supabase Auth users.
- Roles and user roles.
- Store assignments.
- Sales plans.
- Schedules.
- Shifts.
- Shift participants.
- Shift closing reports.
- Cash denominations and cash counts.
- Shift snapshots and corrections.
- File metadata for cash reports.
- Audit log.
- Developer access log.
- Initial RLS policies.

### `202607030002_operations.sql`

- Checklist templates, items, weights, submissions, and score summaries.
- Tasks, recurring task rules, comments, and task files.
- Employee advances.
- Expiration write-offs.
- Payroll product write-offs.
- Inventory periods and inventory loss allocations.
- KPI periods and sales metrics.
- Payroll periods, entries, adjustments, and snapshots.
- Warehouse Google Sheets import logs.
- Notifications and delivery attempts.
- Cron job runs.
- Daily digest runs.
- Additional RLS policies.

### `202607030003_calculation_functions.sql`

- Check depth calculation.
- Average check calculation.
- Checklist item money calculation.
- Inventory compensation and allocation helpers.
- Payroll total calculation.
- Shift sales-pay calculation for primary and secondary sellers.
- Shift snapshot builder.
- `close_shift(...)` RPC for server-side shift closing.
- `auto_close_shift(...)` RPC for marking shifts as auto-closed and requiring review.
- Additional policies needed by server-side calculations.

## Before applying to a real Supabase project

1. Install Supabase CLI.
2. Recreate or validate the migration through the CLI workflow.
3. Run the migration against a local Supabase database first.
4. Run Supabase advisors.
5. Review RLS policies before exposing tables to the Data API.
6. Add the next migrations for RPC functions, calculation jobs, seed data, and storage policies.

## Important security notes

- `service_role` must never be exposed to the frontend.
- Authorization must not rely on user-editable metadata.
- Every exposed table must have RLS enabled.
- Closed shifts and payroll snapshots must not be edited directly.
