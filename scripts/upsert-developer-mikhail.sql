\set ON_ERROR_STOP on

set client_encoding = 'UTF8';

create extension if not exists pgcrypto with schema extensions;

set app.developer_password = :'developer_password';

do $$
declare
  v_email text := 'mixarules@mail.ru';
  v_legacy_email text := 'developer@do4a.local';
  v_full_name text := 'Михаил Куриленко';
  v_phone text := '89241186140';
  v_telegram text := '@Do4akhv';
  v_city text := 'Хабаровск';
  v_user_id uuid;
  v_employee_id uuid;
  v_identity_id uuid;
  v_role_id uuid;
  v_primary_store_id uuid;
begin
  select id into v_user_id
  from auth.users
  where lower(email) = lower(v_email)
  limit 1;

  if v_user_id is null then
    v_user_id := gen_random_uuid();
  end if;

  select id into v_employee_id
  from public.employees
  where lower(email) = lower(v_email)
  limit 1;

  if v_employee_id is null then
    v_employee_id := v_user_id;
  end if;

  select id into v_role_id
  from public.roles
  where code::text = 'developer'
  limit 1;

  if v_role_id is null then
    raise exception 'Role developer not found';
  end if;

  select id into v_primary_store_id
  from public.stores
  where lower(city) = lower(v_city)
    and status = 'active'
  order by name
  limit 1;

  update public.user_roles
     set revoked_at = now()
   where profile_id in (
     select id from public.profiles where lower(email) = lower(v_legacy_email)
   )
     and revoked_at is null;

  update public.profiles
     set is_blocked = true,
         updated_at = now()
   where lower(email) = lower(v_legacy_email);

  update public.employees
     set is_active = false,
         terminated_at = coalesce(terminated_at, current_date),
         updated_at = now()
   where lower(email) = lower(v_legacy_email);

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
  values (
    '00000000-0000-0000-0000-000000000000',
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(current_setting('app.developer_password'), extensions.gen_salt('bf')),
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
    jsonb_build_object('full_name', v_full_name),
    false,
    now(),
    now(),
    false,
    false
  )
  on conflict (id) do update
  set email = excluded.email,
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

  select id into v_identity_id
  from auth.identities
  where user_id = v_user_id
    and provider = 'email'
  limit 1;

  if v_identity_id is null then
    v_identity_id := gen_random_uuid();
  end if;

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
  values (
    v_identity_id,
    v_user_id::text,
    v_user_id,
    jsonb_build_object('sub', v_user_id::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(),
    now(),
    now()
  )
  on conflict (provider_id, provider) do update
  set user_id = excluded.user_id,
      identity_data = excluded.identity_data,
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
    terminated_at,
    is_active
  )
  values (
    v_employee_id,
    v_full_name,
    v_phone,
    v_telegram,
    v_email,
    v_city,
    v_primary_store_id,
    'experienced'::public.employee_status,
    current_date,
    null,
    true
  )
  on conflict (id) do update
  set full_name = excluded.full_name,
      phone = excluded.phone,
      telegram_username = excluded.telegram_username,
      email = excluded.email,
      city = excluded.city,
      primary_store_id = excluded.primary_store_id,
      employee_status = excluded.employee_status,
      hired_at = coalesce(public.employees.hired_at, excluded.hired_at),
      terminated_at = null,
      is_active = true,
      updated_at = now();

  insert into public.profiles (
    id,
    employee_id,
    telegram_username,
    email,
    full_name,
    is_blocked
  )
  values (
    v_user_id,
    v_employee_id,
    v_telegram,
    v_email,
    v_full_name,
    false
  )
  on conflict (id) do update
  set employee_id = excluded.employee_id,
      telegram_username = excluded.telegram_username,
      email = excluded.email,
      full_name = excluded.full_name,
      is_blocked = false,
      updated_at = now();

  update public.user_roles
     set revoked_at = now()
   where profile_id = v_user_id
     and role_id <> v_role_id
     and revoked_at is null;

  insert into public.user_roles (
    profile_id,
    role_id,
    assigned_by,
    assigned_at
  )
  select v_user_id, v_role_id, v_user_id, now()
  where not exists (
    select 1
    from public.user_roles
    where profile_id = v_user_id
      and role_id = v_role_id
      and revoked_at is null
  );

  insert into public.employee_store_assignments (
    employee_id,
    store_id,
    valid_from,
    is_primary
  )
  select v_employee_id,
         stores.id,
         current_date,
         coalesce(stores.id = v_primary_store_id, false)
  from public.stores
  where stores.status = 'active'
    and not exists (
      select 1
      from public.employee_store_assignments existing
      where existing.employee_id = v_employee_id
        and existing.store_id = stores.id
        and existing.valid_to is null
    );
end $$;

select
  p.email,
  p.full_name,
  p.telegram_username,
  e.phone,
  e.city,
  e.is_active,
  p.is_blocked,
  r.code as role,
  count(esa.store_id) filter (where esa.valid_to is null) as active_store_access_count
from public.profiles p
join public.employees e on e.id = p.employee_id
join public.user_roles ur on ur.profile_id = p.id and ur.revoked_at is null
join public.roles r on r.id = ur.role_id
left join public.employee_store_assignments esa on esa.employee_id = e.id
where lower(p.email) = lower('mixarules@mail.ru')
group by p.email, p.full_name, p.telegram_username, e.phone, e.city, e.is_active, p.is_blocked, r.code;
