-- Local development seed data.
-- These IDs are stable so the seed can be rerun without duplicating rows.

insert into public.stores (
  id,
  city,
  name,
  address,
  workday_start_time,
  workday_end_time,
  status
)
values (
  '10000000-0000-0000-0000-000000000001',
  'Владивосток',
  'Ленинградская',
  'Тестовый адрес',
  '10:00',
  '22:00',
  'active'
)
on conflict (id) do update
set
  city = excluded.city,
  name = excluded.name,
  address = excluded.address,
  workday_start_time = excluded.workday_start_time,
  workday_end_time = excluded.workday_end_time,
  status = excluded.status,
  updated_at = now();

insert into public.employees (
  id,
  full_name,
  phone,
  telegram_username,
  email,
  city,
  primary_store_id,
  employee_status,
  hired_at,
  is_active
)
values
  (
    '20000000-0000-0000-0000-000000000001',
    'Артем',
    '+79990000001',
    'artem_test',
    'artem@example.local',
    'Владивосток',
    '10000000-0000-0000-0000-000000000001',
    'experienced',
    '2026-01-10',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000002',
    'Стас',
    '+79990000002',
    'stas_test',
    'stas@example.local',
    'Владивосток',
    '10000000-0000-0000-0000-000000000001',
    'experienced',
    '2026-02-01',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000003',
    'Проверяющий',
    '+79990000003',
    'auditor_test',
    'auditor@example.local',
    'Владивосток',
    '10000000-0000-0000-0000-000000000001',
    'experienced',
    '2026-01-01',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000004',
    'Управляющий',
    '+79990000004',
    'manager_test',
    'manager@example.local',
    'Владивосток',
    '10000000-0000-0000-0000-000000000001',
    'experienced',
    '2026-01-01',
    true
  )
on conflict (id) do update
set
  full_name = excluded.full_name,
  phone = excluded.phone,
  telegram_username = excluded.telegram_username,
  email = excluded.email,
  city = excluded.city,
  primary_store_id = excluded.primary_store_id,
  employee_status = excluded.employee_status,
  hired_at = excluded.hired_at,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.employee_store_assignments (
  id,
  employee_id,
  store_id,
  valid_from,
  is_primary
)
values
  (
    '30000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    '2026-01-10',
    true
  ),
  (
    '30000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    '2026-02-01',
    true
  )
on conflict (id) do update
set
  employee_id = excluded.employee_id,
  store_id = excluded.store_id,
  valid_from = excluded.valid_from,
  is_primary = excluded.is_primary,
  updated_at = now();

insert into public.store_sales_plans (
  id,
  store_id,
  period_start,
  period_end,
  sales_plan_amount
)
values (
  '40000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '2026-07-01',
  '2026-07-31',
  2500000
)
on conflict (store_id, period_start, period_end) do update
set
  sales_plan_amount = excluded.sales_plan_amount,
  updated_at = now();

insert into public.checklist_templates (
  id,
  name,
  version,
  is_active,
  effective_from
)
values (
  '70000000-0000-0000-0000-000000000001',
  'Базовый чек-лист магазина',
  1,
  true,
  '2026-07-01'
)
on conflict (name, version) do update
set
  is_active = excluded.is_active,
  effective_from = excluded.effective_from,
  updated_at = now();

insert into public.checklist_items (
  id,
  template_id,
  title,
  sort_order,
  is_active
)
values
  (
    '71000000-0000-0000-0000-000000000001',
    '70000000-0000-0000-0000-000000000001',
    'Порядок на стеллажах',
    10,
    true
  ),
  (
    '71000000-0000-0000-0000-000000000002',
    '70000000-0000-0000-0000-000000000001',
    'Внешний вид продавца',
    20,
    true
  ),
  (
    '71000000-0000-0000-0000-000000000003',
    '70000000-0000-0000-0000-000000000001',
    'Скрипт на кассе',
    30,
    true
  )
on conflict (template_id, sort_order) do update
set
  title = excluded.title,
  is_active = excluded.is_active,
  updated_at = now();

insert into public.checklist_item_weights (
  item_id,
  employee_status,
  weight_amount
)
values
  ('71000000-0000-0000-0000-000000000001', 'padawan', 300),
  ('71000000-0000-0000-0000-000000000001', 'experienced', 350),
  ('71000000-0000-0000-0000-000000000002', 'padawan', 200),
  ('71000000-0000-0000-0000-000000000002', 'experienced', 240),
  ('71000000-0000-0000-0000-000000000003', 'padawan', 220),
  ('71000000-0000-0000-0000-000000000003', 'experienced', 260)
on conflict (item_id, employee_status) do update
set
  weight_amount = excluded.weight_amount,
  updated_at = now();

insert into public.employees (
  id,
  full_name,
  phone,
  telegram_username,
  email,
  city,
  primary_store_id,
  employee_status,
  hired_at,
  is_active
)
values
  (
    '20000000-0000-0000-0000-000000000005',
    'Тест Супер Админ',
    '+79990000005',
    'super_admin_test',
    'super.admin@do4a.local',
    'Владивосток',
    '10000000-0000-0000-0000-000000000001',
    'experienced',
    '2026-01-01',
    true
  ),
  (
    '20000000-0000-0000-0000-000000000006',
    'Тест Разработчик',
    '+79990000006',
    'developer_test',
    'developer@do4a.local',
    'Владивосток',
    '10000000-0000-0000-0000-000000000001',
    'experienced',
    '2026-01-01',
    true
  )
on conflict (id) do update
set
  full_name = excluded.full_name,
  phone = excluded.phone,
  telegram_username = excluded.telegram_username,
  email = excluded.email,
  city = excluded.city,
  primary_store_id = excluded.primary_store_id,
  employee_status = excluded.employee_status,
  hired_at = excluded.hired_at,
  is_active = excluded.is_active,
  updated_at = now();

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  email_change_token_current,
  phone_change,
  phone_change_token,
  reauthentication_token,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  is_sso_user,
  is_anonymous
)
select
  '00000000-0000-0000-0000-000000000000',
  user_id,
  'authenticated',
  'authenticated',
  email,
  crypt('Do4aTest345', gen_salt('bf')),
  now(),
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name', full_name),
  false,
  now(),
  now(),
  false,
  false
from (
  values
    ('20000000-0000-0000-0000-000000000001'::uuid, 'manager@do4a.local', 'Тест Менеджер'),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'auditor@do4a.local', 'Тест Проверяющий'),
    ('20000000-0000-0000-0000-000000000004'::uuid, 'store.manager@do4a.local', 'Тест Управляющий'),
    ('20000000-0000-0000-0000-000000000005'::uuid, 'super.admin@do4a.local', 'Тест Супер Админ'),
    ('20000000-0000-0000-0000-000000000006'::uuid, 'developer@do4a.local', 'Тест Разработчик')
) as test_accounts(user_id, email, full_name)
on conflict (id) do update
set
  email = excluded.email,
  encrypted_password = excluded.encrypted_password,
  email_confirmed_at = now(),
  confirmation_token = '',
  recovery_token = '',
  email_change_token_new = '',
  email_change = '',
  email_change_token_current = '',
  phone_change = '',
  phone_change_token = '',
  reauthentication_token = '',
  raw_app_meta_data = excluded.raw_app_meta_data,
  raw_user_meta_data = excluded.raw_user_meta_data,
  updated_at = now();

insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  user_id::text,
  user_id,
  jsonb_build_object('sub', user_id::text, 'email', email, 'email_verified', true, 'phone_verified', false),
  'email',
  now(),
  now(),
  now()
from (
  values
    ('20000000-0000-0000-0000-000000000001'::uuid, 'manager@do4a.local'),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'auditor@do4a.local'),
    ('20000000-0000-0000-0000-000000000004'::uuid, 'store.manager@do4a.local'),
    ('20000000-0000-0000-0000-000000000005'::uuid, 'super.admin@do4a.local'),
    ('20000000-0000-0000-0000-000000000006'::uuid, 'developer@do4a.local')
) as test_accounts(user_id, email)
on conflict (provider_id, provider) do update
set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();

insert into public.profiles (
  id,
  employee_id,
  telegram_username,
  email,
  full_name,
  is_blocked
)
values
  ('20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'manager_test', 'manager@do4a.local', 'Тест Менеджер', false),
  ('20000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'auditor_test', 'auditor@do4a.local', 'Тест Проверяющий', false),
  ('20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'manager_test', 'store.manager@do4a.local', 'Тест Управляющий', false),
  ('20000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'super_admin_test', 'super.admin@do4a.local', 'Тест Супер Админ', false),
  ('20000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000006', 'developer_test', 'developer@do4a.local', 'Тест Разработчик', false)
on conflict (id) do update
set
  employee_id = excluded.employee_id,
  telegram_username = excluded.telegram_username,
  email = excluded.email,
  full_name = excluded.full_name,
  is_blocked = excluded.is_blocked,
  updated_at = now();

insert into public.user_roles (
  profile_id,
  role_id,
  assigned_by,
  assigned_at
)
select
  v.profile_id,
  r.id,
  null,
  now()
from (
  values
    ('20000000-0000-0000-0000-000000000001'::uuid, 'manager'),
    ('20000000-0000-0000-0000-000000000002'::uuid, 'auditor'),
    ('20000000-0000-0000-0000-000000000004'::uuid, 'store_manager'),
    ('20000000-0000-0000-0000-000000000005'::uuid, 'super_admin'),
    ('20000000-0000-0000-0000-000000000006'::uuid, 'developer')
) as v(profile_id, role_code)
join public.roles r on r.code = v.role_code::public.user_role_code
on conflict do nothing;

insert into public.employee_store_assignments (
  id,
  employee_id,
  store_id,
  valid_from,
  is_primary
)
values
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '2026-01-01', true),
  ('30000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '2026-01-01', true),
  ('30000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '2026-01-01', true)
on conflict (id) do update
set
  employee_id = excluded.employee_id,
  store_id = excluded.store_id,
  valid_from = excluded.valid_from,
  is_primary = excluded.is_primary,
  updated_at = now();
