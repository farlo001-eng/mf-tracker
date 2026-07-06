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
create table if not exists attachments (
  id text primary key,
  property_id text not null references properties(id) on delete cascade,
  filename text not null,
  mime text not null default '',
  size integer not null default 0,
  data bytea not null,
  created_at timestamptz not null default now()
);
alter table properties add column if not exists extra jsonb not null default '{}'::jsonb;
alter table properties add column if not exists notes text not null default '';
alter table properties add column if not exists extra_order jsonb not null default '[]'::jsonb;
alter table properties add column if not exists rent_table jsonb not null default '[]'::jsonb;
create index if not exists idx_props_market on properties(market_id);
create index if not exists idx_props_active on properties(active);
create unique index if not exists idx_props_dedup on properties(market_id, lower(address));
create index if not exists idx_touches_prop on touches(property_id);
create index if not exists idx_attach_prop on attachments(property_id);

create table if not exists owners (
  id text primary key,
  name text not null,
  status text not null default 'New',
  active boolean not null default false,
  phone text not null default '',
  email text not null default '',
  mailing_address text not null default '',
  next_follow_up date,
  notes text not null default '',
  created_at timestamptz not null default now()
);
alter table properties add column if not exists owner_id text references owners(id) on delete set null;
create index if not exists idx_props_owner on properties(owner_id);
create index if not exists idx_owners_active on owners(active);

alter table touches add column if not exists owner_id text references owners(id) on delete cascade;
alter table touches alter column property_id drop not null;
do $$ begin
  alter table touches add constraint touches_one_target
    check ((property_id is not null and owner_id is null) or (property_id is null and owner_id is not null));
exception when duplicate_object then null;
end $$;
create index if not exists idx_touches_owner on touches(owner_id);
`;

export async function ensureSchema() {
  await pool.query(SCHEMA);
  await migrateOwnersFromPropertyNames();
}

// One-time backfill: turn free-text properties.owner_name into real owners rows and
// link properties.owner_id. Guarded so it only ever runs against a still-empty owners table.
async function migrateOwnersFromPropertyNames() {
  const { rows: [{ count }] } = await pool.query(`select count(*)::int as count from owners`);
  if (count > 0) return;

  const { rows: names } = await pool.query(`
    select distinct on (lower(trim(owner_name))) trim(owner_name) as name
    from properties
    where trim(owner_name) <> ''
    order by lower(trim(owner_name)), created_at asc
  `);
  if (!names.length) return;

  const client = await pool.connect();
  let propertiesLinked = 0;
  try {
    await client.query("begin");
    for (const { name } of names) {
      const id = uid();
      await client.query(`insert into owners (id, name) values ($1,$2)`, [id, name]);
      const { rowCount } = await client.query(
        `update properties set owner_id = $1 where lower(trim(owner_name)) = lower(trim($2))`,
        [id, name]
      );
      propertiesLinked += rowCount;
    }
    await client.query("commit");
  } catch (e) {
    await client.query("rollback");
    throw e;
  } finally {
    client.release();
  }
  console.log(`owners migration: created ${names.length} owners, linked ${propertiesLinked} properties`);
}
