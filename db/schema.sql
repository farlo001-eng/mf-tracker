-- Reference only. The app creates these automatically on first boot.
-- You can paste this into Railway → Postgres → Query to inspect or run by hand.

create table if not exists markets (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists properties (
  id text primary key,
  market_id text references markets(id) on delete set null,
  address text not null,
  owner_name text not null default '',
  phone text not null default '',
  email text not null default '',
  unit_count integer,
  status text not null default 'New',      -- New | Working | Warm | Dead
  active boolean not null default false,   -- true = on the working Desk
  next_follow_up date,
  created_at timestamptz not null default now()
);

create table if not exists touches (
  id text primary key,
  property_id text not null references properties(id) on delete cascade,
  touch_date date not null,
  channel text not null,                   -- Call | Email | SMS | Mail
  note text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_props_market on properties(market_id);
create index if not exists idx_props_active on properties(active);
create unique index if not exists idx_props_dedup on properties(market_id, lower(address));
create index if not exists idx_touches_prop on touches(property_id);
