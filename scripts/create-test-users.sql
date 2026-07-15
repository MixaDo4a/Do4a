create extension if not exists pgcrypto;

create temporary table test_accounts (
  user_id uuid primary key,
  identity_id uuid not null,
  employee_id uuid not null,
  email text not null,
  full_name text not null,
  role_code text not null,
  store_id uuid
);

insert into test_accounts (user_id, identity_id, employee_id, email, full_name, role_code, store_id)
values
  (
    '91000000-0000-0000-0000-000000000001',
    '92000000-0000-0000-0000-000000000001',
    '93000000-0000-0000-0000-000000000001',
    'manager@do4a.local',
    'Тест Менеджер',
    'manager',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '91000000-0000-0000-0000-000000000002',
    '92000000-0000-0000-0000-000000000002',
    '93000000-0000-0000-0000-000000000002',
    'auditor@do4a.local',
    'Тест Проверяющий',
    'auditor',
    null
  ),
  (
    '91000000-0000-0000-0000-000000000003',
    '92000000-0000-0000-0000-000000000003',
    '93000000-0000-0000-0000-000000000003',
    'store.manager@do4a.local',
    'Тест Управляющий',
    'store_manager',
    '10000000-0000-0000-0000-000000000001'
  ),
  (
    '91000000-0000-0000-0000-000000000004',
    '92000000-0000-0000-0000-000000000004',
    '93000000-0000-0000-0000-000000000004',
    'super.admin@do4a.local',
    'Тест Супер Админ',
    'super_admin',
    null
  ),
  (
    '91000000-0000-0000-0000-000000000005',
    '92000000-0000-0000-0000-000000000005',
    '93000000-0000-0000-0000-000000000005',
    'developer@do4a.local',
    'Тест Разработчик',
    'developer',
    null
  );

insert into public.employees (
  id,
  full_name,
  email,
  city,
  primary_store_id,
  employee_status,
  hired_at,
  is_active
)
select
  employee_id,
  full_name,
  email,
  'Владивосток',
  store_id,
  'experienced'::public.employee_status,
  '2026-07-06',
  true
from test_accounts
on conflict (id) do update
set
  full_name = excluded.full_name,
  email = excluded.email,
  city = excluded.city,
  primary_store_id = excluded.primary_store_id,
  employee_status = excluded.employee_status,
  is_active = true,
  terminated_at = null,
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
from test_accounts
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
  identity_id,
  user_id::text,
  user_id,
  jsonb_build_object('sub', user_id::text, 'email', email, 'email_verified', true, 'phone_verified', false),
  'email',
  now(),
  now(),
  now()
from test_accounts
on conflict (provider_id, provider) do update
set
  user_id = excluded.user_id,
  identity_data = excluded.identity_data,
  updated_at = now();

insert into public.profiles (
  id,
  employee_id,
  email,
  full_name,
  is_blocked
)
select
  user_id,
  employee_id,
  email,
  full_name,
  false
from test_accounts
on conflict (id) do update
set
  employee_id = excluded.employee_id,
  email = excluded.email,
  full_name = excluded.full_name,
  is_blocked = false,
  updated_at = now();

insert into public.employee_store_assignments (
  employee_id,
  store_id,
  valid_from,
  is_primary
)
select
  employee_id,
  store_id,
  '2026-07-06',
  true
from test_accounts
where store_id is not null
  and not exists (
    select 1
    from public.employee_store_assignments esa
    where esa.employee_id = test_accounts.employee_id
      and esa.store_id = test_accounts.store_id
      and esa.valid_to is null
  );

insert into public.user_roles (
  profile_id,
  role_id,
  scope_store_id,
  scope_city,
  assigned_by
)
select
  a.user_id,
  r.id,
  a.store_id,
  null,
  a.user_id
from test_accounts a
join public.roles r on r.code::text = a.role_code
where not exists (
  select 1
  from public.user_roles ur
  where ur.profile_id = a.user_id
    and ur.role_id = r.id
    and coalesce(ur.scope_store_id, '00000000-0000-0000-0000-000000000000'::uuid) =
      coalesce(a.store_id, '00000000-0000-0000-0000-000000000000'::uuid)
    and ur.scope_city is null
    and ur.revoked_at is null
);

select
  p.email,
  p.full_name,
  r.code as role
from public.profiles p
join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
join public.roles r on r.id = ur.role_id
where p.email like '%@do4a.local'
order by r.code, p.email;
