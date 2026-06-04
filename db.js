import pg from "pg";

const { Pool } = pg;

// Railway injects DATABASE_URL automatically when you attach a Postgres service.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

export const uid = () =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

const SCHEMA = `
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
  status text not null default 'New',
  active boolean not null default false,
  next_follow_up date,
  created_at timestamptz not null default now()
);
create table if not exists touches (
  id text primary key,
  property_id text not null references properties(id) on delete cascade,
  touch_date date not null,
  channel text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table properties add column if not exists extra jsonb not null default '{}'::jsonb;
alter table properties add column if not exists notes text not null default '';
create index if not exists idx_props_market on properties(market_id);
create index if not exists idx_props_active on properties(active);
create unique index if not exists idx_props_dedup on properties(market_id, lower(address));
create index if not exists idx_touches_prop on touches(property_id);
`;

export async function ensureSchema() {
  await pool.query(SCHEMA);
}
