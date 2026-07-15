-- Operational schema: checklists, tasks, KPI, payroll, notifications,
-- inventory, write-offs, warehouse imports, and cron runs.

do $$
begin
  create type public.task_status as enum (
    'open',
    'in_progress',
    'done',
    'overdue',
    'cancelled'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.task_priority as enum (
    'low',
    'normal',
    'high',
    'urgent'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.payroll_period_status as enum (
    'open',
    'calculated',
    'closed'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.kpi_period_status as enum (
    'open',
    'calculated',
    'closed'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.notification_channel as enum (
    'in_app',
    'telegram',
    'email'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.notification_delivery_status as enum (
    'pending',
    'sent',
    'failed'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.import_status as enum (
    'pending',
    'running',
    'success',
    'failed',
    'partial'
  );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.cron_run_status as enum (
    'success',
    'failed',
    'partial'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version integer not null default 1,
  is_active boolean not null default true,
  effective_from date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint checklist_templates_version_check check (version > 0)
);

create unique index if not exists checklist_templates_name_version_unique
  on public.checklist_templates (name, version);

create table if not exists public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id) on delete cascade,
  title text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checklist_items_sort_order_check check (sort_order >= 0)
);

create unique index if not exists checklist_items_template_sort_unique
  on public.checklist_items (template_id, sort_order);

create table if not exists public.checklist_item_weights (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.checklist_items(id) on delete cascade,
  employee_status public.employee_status not null,
  weight_amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checklist_item_weights_amount_check check (weight_amount >= 0)
);

create unique index if not exists checklist_item_weights_item_status_unique
  on public.checklist_item_weights (item_id, employee_status);

create table if not exists public.checklist_submissions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.checklist_templates(id),
  store_id uuid not null references public.stores(id),
  employee_id uuid not null references public.employees(id),
  auditor_employee_id uuid not null references public.employees(id),
  submitted_at timestamptz not null default now(),
  period_month date not null,
  employee_status_snapshot public.employee_status not null,
  average_score numeric(4,2) not null,
  salary_per_shift_amount numeric(12,2) not null,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint checklist_submissions_average_score_check check (
    average_score >= 1 and average_score <= 10
  ),
  constraint checklist_submissions_salary_check check (salary_per_shift_amount >= 0)
);

create index if not exists checklist_submissions_employee_month_idx
  on public.checklist_submissions (employee_id, period_month);

create index if not exists checklist_submissions_store_month_idx
  on public.checklist_submissions (store_id, period_month);

create table if not exists public.checklist_submission_items (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.checklist_submissions(id) on delete cascade,
  item_id uuid not null references public.checklist_items(id),
  score integer not null,
  weight_amount_snapshot numeric(12,2) not null,
  result_amount numeric(12,2) not null,
  comment text,
  created_at timestamptz not null default now(),
  constraint checklist_submission_items_score_check check (score between 1 and 10),
  constraint checklist_submission_items_amount_check check (
    weight_amount_snapshot >= 0 and result_amount >= 0
  )
);

create unique index if not exists checklist_submission_items_submission_item_unique
  on public.checklist_submission_items (submission_id, item_id);

create table if not exists public.store_checklist_score_summaries (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id) on delete cascade,
  period_month date not null,
  average_score numeric(4,2) not null,
  submission_count integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint store_checklist_score_summaries_score_check check (
    average_score >= 1 and average_score <= 10
  ),
  constraint store_checklist_score_summaries_count_check check (submission_count >= 0)
);

create unique index if not exists store_checklist_score_summaries_store_month_unique
  on public.store_checklist_score_summaries (store_id, period_month);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  assignee_employee_id uuid not null references public.employees(id),
  created_by uuid references auth.users(id),
  title text not null,
  description text,
  due_at timestamptz,
  priority public.task_priority not null default 'normal',
  status public.task_status not null default 'open',
  recurrence_rule_id uuid,
  completed_at timestamptz,
  completed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_done_check check (
    (status = 'done' and completed_at is not null)
    or (status <> 'done')
  )
);

create index if not exists tasks_assignee_status_idx
  on public.tasks (assignee_employee_id, status, due_at);

create index if not exists tasks_store_status_idx
  on public.tasks (store_id, status, due_at);

create table if not exists public.task_recurrence_rules (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  assignee_employee_id uuid not null references public.employees(id),
  title text not null,
  description text,
  frequency text not null,
  is_active boolean not null default true,
  next_run_at timestamptz not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.tasks
  add constraint tasks_recurrence_rule_fk
  foreign key (recurrence_rule_id)
  references public.task_recurrence_rules(id);

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_profile_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  file_id uuid not null references public.files(id) on delete cascade,
  file_kind text not null default 'attachment',
  created_at timestamptz not null default now(),
  constraint task_files_kind_check check (file_kind in ('attachment', 'photo_report'))
);

create table if not exists public.employee_advances (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  shift_id uuid references public.shifts(id),
  period_month date not null,
  amount numeric(12,2) not null,
  source text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  constraint employee_advances_amount_check check (amount >= 0),
  constraint employee_advances_source_check check (
    source in ('shift_closing', 'manual_adjustment', 'import')
  )
);

create index if not exists employee_advances_employee_month_idx
  on public.employee_advances (employee_id, period_month);

create table if not exists public.expiration_writeoffs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  period_month date not null,
  amount numeric(12,2) not null,
  source text not null default 'manual',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint expiration_writeoffs_amount_check check (amount >= 0),
  constraint expiration_writeoffs_source_check check (
    source in ('manual', 'warehouse_google_sheet_import')
  )
);

create index if not exists expiration_writeoffs_store_month_idx
  on public.expiration_writeoffs (store_id, period_month);

create table if not exists public.payroll_product_writeoffs (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  period_month date not null,
  amount numeric(12,2) not null,
  approved_by uuid references auth.users(id),
  source text not null default 'manual',
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_product_writeoffs_amount_check check (amount >= 0),
  constraint payroll_product_writeoffs_source_check check (
    source in ('manual', 'warehouse_google_sheet_import')
  )
);

create index if not exists payroll_product_writeoffs_employee_month_idx
  on public.payroll_product_writeoffs (employee_id, period_month);

create table if not exists public.inventory_periods (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  period_start date not null,
  period_end date not null,
  turnover_amount numeric(12,2) not null,
  loss_amount numeric(12,2) not null,
  company_compensation_amount numeric(12,2) not null,
  amount_after_compensation numeric(12,2) not null,
  distributable_amount numeric(12,2) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_periods_dates_check check (period_end >= period_start),
  constraint inventory_periods_amounts_check check (
    turnover_amount >= 0
    and loss_amount >= 0
    and company_compensation_amount >= 0
    and distributable_amount >= 0
  )
);

create index if not exists inventory_periods_store_period_idx
  on public.inventory_periods (store_id, period_start, period_end);

create table if not exists public.inventory_loss_allocations (
  id uuid primary key default gen_random_uuid(),
  inventory_period_id uuid not null references public.inventory_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  worked_days numeric(8,2) not null,
  total_worked_days numeric(8,2) not null,
  share_ratio numeric(10,6) not null,
  amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  constraint inventory_loss_allocations_amounts_check check (
    worked_days >= 0
    and total_worked_days > 0
    and share_ratio >= 0
    and amount >= 0
  )
);

create unique index if not exists inventory_loss_allocations_period_employee_unique
  on public.inventory_loss_allocations (inventory_period_id, employee_id);

create table if not exists public.kpi_periods (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  status public.kpi_period_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpi_periods_dates_check check (period_end >= period_start)
);

create table if not exists public.sales_metrics (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  store_id uuid not null references public.stores(id),
  period_month date not null,
  gross_revenue numeric(12,2) not null,
  receipt_count integer not null,
  items_sold_count integer,
  average_check_amount numeric(12,2),
  check_depth numeric(10,2),
  sales_percent numeric(6,4) not null,
  sales_pay_amount numeric(12,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_metrics_non_negative_check check (
    gross_revenue >= 0
    and receipt_count >= 0
    and (items_sold_count is null or items_sold_count >= 0)
    and sales_pay_amount >= 0
  )
);

create unique index if not exists sales_metrics_shift_employee_unique
  on public.sales_metrics (shift_id, employee_id);

create index if not exists sales_metrics_employee_month_idx
  on public.sales_metrics (employee_id, period_month);

create table if not exists public.payroll_periods (
  id uuid primary key default gen_random_uuid(),
  period_month date not null unique,
  status public.payroll_period_status not null default 'open',
  calculated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payroll_entries (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  shift_count numeric(8,2) not null default 0,
  gross_revenue numeric(12,2) not null default 0,
  sales_pay_amount numeric(12,2) not null default 0,
  plan_bonus_amount numeric(12,2) not null default 0,
  checklist_salary_per_shift numeric(12,2) not null default 0,
  base_salary_amount numeric(12,2) not null default 0,
  manual_bonus_amount numeric(12,2) not null default 0,
  advance_amount numeric(12,2) not null default 0,
  expiration_writeoff_amount numeric(12,2) not null default 0,
  inventory_loss_amount numeric(12,2) not null default 0,
  product_writeoff_amount numeric(12,2) not null default 0,
  total_payout_amount numeric(12,2) not null default 0,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_entries_counts_check check (shift_count >= 0)
);

create unique index if not exists payroll_entries_period_employee_unique
  on public.payroll_entries (payroll_period_id, employee_id);

create table if not exists public.payroll_adjustments (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  period_month date not null,
  adjustment_type text not null,
  amount numeric(12,2) not null,
  reason text not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payroll_adjustments_type_check check (
    adjustment_type in ('bonus', 'fine', 'inventory', 'expiration', 'product')
  )
);

create index if not exists payroll_adjustments_employee_month_idx
  on public.payroll_adjustments (employee_id, period_month);

create table if not exists public.payroll_snapshots (
  id uuid primary key default gen_random_uuid(),
  payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
  employee_id uuid not null references public.employees(id),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists payroll_snapshots_period_employee_idx
  on public.payroll_snapshots (payroll_period_id, employee_id);

create table if not exists public.warehouse_google_sheet_imports (
  id uuid primary key default gen_random_uuid(),
  source_sheet_id text not null,
  import_type text not null,
  period_month date,
  status public.import_status not null default 'pending',
  rows_imported integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references auth.users(id),
  constraint warehouse_google_sheet_imports_rows_check check (rows_imported >= 0),
  constraint warehouse_google_sheet_imports_type_check check (
    import_type in ('expiration_writeoffs', 'payroll_product_writeoffs')
  )
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null,
  title text not null,
  body text not null,
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_read_idx
  on public.notifications (recipient_profile_id, is_read, created_at desc);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  channel public.notification_channel not null,
  status public.notification_delivery_status not null default 'pending',
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists notification_deliveries_notification_idx
  on public.notification_deliveries (notification_id, channel);

create table if not exists public.cron_job_runs (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status public.cron_run_status not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  details jsonb,
  error_message text
);

create index if not exists cron_job_runs_job_started_idx
  on public.cron_job_runs (job_name, started_at desc);

create table if not exists public.daily_digest_runs (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  digest_date date not null,
  summary_data jsonb not null,
  notification_id uuid references public.notifications(id),
  created_at timestamptz not null default now()
);

create unique index if not exists daily_digest_runs_recipient_date_unique
  on public.daily_digest_runs (recipient_profile_id, digest_date);

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'checklist_templates',
    'checklist_items',
    'checklist_item_weights',
    'checklist_submissions',
    'checklist_submission_items',
    'store_checklist_score_summaries',
    'tasks',
    'task_recurrence_rules',
    'task_comments',
    'task_files',
    'employee_advances',
    'expiration_writeoffs',
    'payroll_product_writeoffs',
    'inventory_periods',
    'inventory_loss_allocations',
    'kpi_periods',
    'sales_metrics',
    'payroll_periods',
    'payroll_entries',
    'payroll_adjustments',
    'payroll_snapshots',
    'warehouse_google_sheet_imports',
    'notifications',
    'notification_deliveries',
    'cron_job_runs',
    'daily_digest_runs'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'checklist_templates',
    'checklist_items',
    'checklist_item_weights',
    'checklist_submissions',
    'store_checklist_score_summaries',
    'tasks',
    'task_recurrence_rules',
    'employee_advances',
    'expiration_writeoffs',
    'payroll_product_writeoffs',
    'inventory_periods',
    'kpi_periods',
    'sales_metrics',
    'payroll_periods',
    'payroll_entries',
    'payroll_adjustments'
  ]
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format(
      'create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end $$;

create policy "checklist_templates_select_authenticated"
  on public.checklist_templates
  for select
  to authenticated
  using (true);

create policy "checklist_templates_manager_manage"
  on public.checklist_templates
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "checklist_items_select_authenticated"
  on public.checklist_items
  for select
  to authenticated
  using (true);

create policy "checklist_items_manager_manage"
  on public.checklist_items
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "checklist_item_weights_select_authenticated"
  on public.checklist_item_weights
  for select
  to authenticated
  using (true);

create policy "checklist_item_weights_manager_manage"
  on public.checklist_item_weights
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "checklist_submissions_select_accessible"
  on public.checklist_submissions
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or auditor_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_can_access_store(store_id)
  );

create policy "checklist_submissions_auditor_insert"
  on public.checklist_submissions
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('auditor')
  );

create policy "checklist_submission_items_select_accessible"
  on public.checklist_submission_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.checklist_submissions cs
      where cs.id = submission_id
        and (
          cs.employee_id = app_private.current_user_employee_id()
          or cs.auditor_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(cs.store_id)
        )
    )
  );

create policy "checklist_submission_items_auditor_insert"
  on public.checklist_submission_items
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('auditor')
  );

create policy "store_checklist_score_summaries_select_accessible"
  on public.store_checklist_score_summaries
  for select
  to authenticated
  using (app_private.current_user_can_access_store(store_id));

create policy "tasks_select_related"
  on public.tasks
  for select
  to authenticated
  using (
    assignee_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_can_access_store(store_id)
  );

create policy "tasks_manager_insert"
  on public.tasks
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "tasks_assignee_or_manager_update"
  on public.tasks
  for update
  to authenticated
  using (
    assignee_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    assignee_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "task_recurrence_rules_select_accessible"
  on public.task_recurrence_rules
  for select
  to authenticated
  using (
    assignee_employee_id = app_private.current_user_employee_id()
    or app_private.current_user_can_access_store(store_id)
  );

create policy "task_recurrence_rules_manager_manage"
  on public.task_recurrence_rules
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "task_comments_select_related"
  on public.task_comments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assignee_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(t.store_id)
        )
    )
  );

create policy "task_comments_insert_related"
  on public.task_comments
  for insert
  to authenticated
  with check (
    author_profile_id = (select auth.uid())
    and exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assignee_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(t.store_id)
        )
    )
  );

create policy "task_files_select_related"
  on public.task_files
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assignee_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(t.store_id)
        )
    )
  );

create policy "task_files_insert_related"
  on public.task_files
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.tasks t
      where t.id = task_id
        and (
          t.assignee_employee_id = app_private.current_user_employee_id()
          or app_private.current_user_can_access_store(t.store_id)
        )
    )
  );

create policy "employee_advances_select_related"
  on public.employee_advances
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "employee_advances_manager_insert"
  on public.employee_advances
  for insert
  to authenticated
  with check (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "expiration_writeoffs_select_accessible"
  on public.expiration_writeoffs
  for select
  to authenticated
  using (app_private.current_user_can_access_store(store_id));

create policy "expiration_writeoffs_manager_manage"
  on public.expiration_writeoffs
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "payroll_product_writeoffs_select_related"
  on public.payroll_product_writeoffs
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "payroll_product_writeoffs_manager_manage"
  on public.payroll_product_writeoffs
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "inventory_periods_select_accessible"
  on public.inventory_periods
  for select
  to authenticated
  using (app_private.current_user_can_access_store(store_id));

create policy "inventory_periods_manager_manage"
  on public.inventory_periods
  for all
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  )
  with check (
    app_private.current_user_has_role('super_admin')
    or (
      app_private.current_user_has_role('store_manager')
      and app_private.current_user_can_access_store(store_id)
    )
  );

create policy "inventory_loss_allocations_select_related"
  on public.inventory_loss_allocations
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or exists (
      select 1
      from public.inventory_periods ip
      where ip.id = inventory_period_id
        and app_private.current_user_can_access_store(ip.store_id)
    )
  );

create policy "sales_metrics_select_related"
  on public.sales_metrics
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_can_access_store(store_id)
  );

create policy "payroll_periods_select_authenticated"
  on public.payroll_periods
  for select
  to authenticated
  using (true);

create policy "payroll_entries_select_related"
  on public.payroll_entries
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "payroll_adjustments_select_related"
  on public.payroll_adjustments
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "payroll_adjustments_manager_insert"
  on public.payroll_adjustments
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "payroll_snapshots_select_related"
  on public.payroll_snapshots
  for select
  to authenticated
  using (
    employee_id = app_private.current_user_employee_id()
    or app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "warehouse_google_sheet_imports_select_admin"
  on public.warehouse_google_sheet_imports
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "warehouse_google_sheet_imports_manager_insert"
  on public.warehouse_google_sheet_imports
  for insert
  to authenticated
  with check (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('store_manager')
  );

create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (recipient_profile_id = (select auth.uid()));

create policy "notifications_update_read_own"
  on public.notifications
  for update
  to authenticated
  using (recipient_profile_id = (select auth.uid()))
  with check (recipient_profile_id = (select auth.uid()));

create policy "notification_deliveries_select_own_notification"
  on public.notification_deliveries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.notifications n
      where n.id = notification_id
        and n.recipient_profile_id = (select auth.uid())
    )
  );

create policy "cron_job_runs_select_admin"
  on public.cron_job_runs
  for select
  to authenticated
  using (
    app_private.current_user_has_role('super_admin')
    or app_private.current_user_has_role('developer')
  );

create policy "daily_digest_runs_select_own"
  on public.daily_digest_runs
  for select
  to authenticated
  using (
    recipient_profile_id = (select auth.uid())
    or app_private.current_user_has_role('super_admin')
  );
