create table campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table menus (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  unique (campaign_id, name)
);

create table products (
  id uuid primary key default gen_random_uuid(),
  menu_id uuid not null references menus(id) on delete cascade,
  name text not null,
  price integer not null default 0,
  description text not null default '',
  details text not null default '',
  calories numeric, protein numeric, fat numeric, carbs numeric,
  is_main boolean not null default false,
  image_url text,
  video_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create unique index one_main_product_per_menu on products(menu_id) where is_main;

create table addon_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  sort_order integer not null default 0
);

create table addons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references addon_groups(id) on delete cascade,
  name text not null,
  price integer not null default 0,
  image_url text,
  sort_order integer not null default 0
);

create table product_addon_groups (
  product_id uuid not null references products(id) on delete cascade,
  group_id uuid not null references addon_groups(id) on delete cascade,
  primary key (product_id, group_id)
);
