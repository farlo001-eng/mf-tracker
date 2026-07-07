import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { pool, ensureSchema, uid } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "20mb" }));
app.use(cookieParser());

/* ---------------- auth (single password) ---------------- */
const COOKIE = "mf_auth";
const token = () =>
  crypto.createHash("sha256")
    .update(`${process.env.APP_PASSWORD || ""}:${process.env.AUTH_SECRET || "dev"}`)
    .digest("hex");

app.post("/api/login", (req, res) => {
  if ((req.body?.password || "") === (process.env.APP_PASSWORD || "")) {
    res.cookie(COOKIE, token(), {
      httpOnly: true, secure: process.env.NODE_ENV === "production",
      sameSite: "lax", maxAge: 1000 * 60 * 60 * 24 * 60,
    });
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "wrong password" });
});
app.post("/api/logout", (req, res) => { res.clearCookie(COOKIE); res.json({ ok: true }); });
app.get("/api/me", (req, res) =>
  req.cookies?.[COOKIE] === token() ? res.json({ authed: true }) : res.status(401).json({ authed: false })
);

// guard every other /api route
app.use("/api", (req, res, next) => {
  if (req.cookies?.[COOKIE] === token()) return next();
  res.status(401).json({ error: "unauthorized" });
});

/* ---------------- markets ---------------- */
app.get("/api/markets", async (_req, res) => {
  const { rows } = await pool.query(`
    select m.id, m.name, count(p.id)::int as property_count,
           count(p.id) filter (where p.active)::int as active_count
    from markets m left join properties p on p.market_id = m.id
    group by m.id order by m.name`);
  res.json(rows);
});
app.post("/api/markets", async (req, res) => {
  const id = uid();
  await pool.query(`insert into markets (id, name) values ($1,$2)`, [id, (req.body.name || "Untitled").trim()]);
  res.json({ id });
});

/* ---------------- owners ---------------- */
const OWNER_TYPES = ["individual", "company"];

app.get("/api/owners", async (req, res) => {
  const { q, type, active } = req.query;
  if (q) {
    const where = ["name ilike $1"], args = [`%${q}%`];
    if (type && OWNER_TYPES.includes(type)) { args.push(type); where.push(`type = $${args.length}`); }
    const { rows } = await pool.query(
      `select id, name, type from owners where ${where.join(" and ")} order by name limit 20`, args
    );
    return res.json(rows);
  }
  const where = [], args = [];
  if (type && OWNER_TYPES.includes(type)) { args.push(type); where.push(`o.type = $${args.length}`); }
  if (active === "true") where.push(`o.active = true`);
  else if (active === "false") where.push(`o.active = false`);
  const clause = where.length ? `where ${where.join(" and ")}` : "";
  const { rows } = await pool.query(`
    select o.id, o.name, o.type, o.status, o.active, o.phone, o.email, o.mailing_address,
           to_char(o.next_follow_up, 'YYYY-MM-DD') as next_follow_up, o.notes, o.created_at,
           count(p.id)::int as property_count,
           coalesce(sum(p.unit_count), 0)::int as total_units,
           (select to_char(max(touch_date),'YYYY-MM-DD') from touches t where t.owner_id = o.id) as last_touch,
           (select channel from touches t where t.owner_id = o.id order by touch_date desc, created_at desc limit 1) as last_channel
    from owners o left join properties p on p.owner_id = o.id
    ${clause}
    group by o.id
    order by o.active desc, o.next_follow_up asc nulls last, o.created_at desc
  `, args);
  res.json(rows);
});

app.post("/api/owners", async (req, res) => {
  const b = req.body || {}, id = uid();
  if (b.type && !OWNER_TYPES.includes(b.type)) return res.status(400).json({ error: "type must be 'individual' or 'company'" });
  await pool.query(
    `insert into owners (id, name, type, status, active, phone, email, mailing_address, next_follow_up, notes)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, (b.name || "Untitled owner").trim(), b.type || "individual", b.status || "New", !!b.active, b.phone || "",
     b.email || "", b.mailing_address || "", b.next_follow_up || null, b.notes || ""]
  );
  res.json({ id });
});

app.get("/api/owners/:id", async (req, res) => {
  const { rows } = await pool.query(`select *, to_char(next_follow_up,'YYYY-MM-DD') as next_follow_up from owners where id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  const p = await pool.query(
    `select id, address, unit_count, status from properties where owner_id=$1 order by address`, [req.params.id]);
  const t = await pool.query(
    `select id, to_char(touch_date,'YYYY-MM-DD') as touch_date, channel, note
     from touches where owner_id=$1 order by touch_date desc, created_at desc`, [req.params.id]);
  const l = await pool.query(
    `select o2.id, o2.name, o2.type
     from owner_links l join owners o2 on o2.id = (case when l.owner_id_a = $1 then l.owner_id_b else l.owner_id_a end)
     where l.owner_id_a = $1 or l.owner_id_b = $1
     order by o2.name`, [req.params.id]);
  res.json({ ...rows[0], properties: p.rows, touches: t.rows, linkedOwners: l.rows });
});

app.patch("/api/owners/:id", async (req, res) => {
  if ("type" in req.body && !OWNER_TYPES.includes(req.body.type)) return res.status(400).json({ error: "type must be 'individual' or 'company'" });
  const allowed = ["name", "type", "status", "active", "phone", "email", "mailing_address", "next_follow_up", "notes"];
  const sets = [], args = [];
  for (const k of allowed) if (k in req.body) { args.push(req.body[k] === "" ? null : req.body[k]); sets.push(`${k}=$${args.length}`); }
  if (!sets.length) return res.json({ ok: true });
  args.push(req.params.id);
  await pool.query(`update owners set ${sets.join(", ")} where id=$${args.length}`, args);
  res.json({ ok: true });
});

app.delete("/api/owners/:id", async (req, res) => {
  await pool.query(`delete from owners where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/owners/:id/touch", async (req, res) => {
  const b = req.body;
  await pool.query(
    `insert into touches (id, owner_id, touch_date, channel, note) values ($1,$2,$3,$4,$5)`,
    [uid(), req.params.id, b.touch_date, b.channel, b.note || ""]
  );
  res.json({ ok: true });
});

app.post("/api/owners/:id/links", async (req, res) => {
  const linkedOwnerId = req.body?.linkedOwnerId;
  if (!linkedOwnerId || linkedOwnerId === req.params.id) return res.status(400).json({ error: "linkedOwnerId required" });
  const [a, b] = [req.params.id, linkedOwnerId].sort();
  await pool.query(
    `insert into owner_links (id, owner_id_a, owner_id_b) values ($1,$2,$3)
     on conflict (least(owner_id_a, owner_id_b), greatest(owner_id_a, owner_id_b)) do nothing`,
    [uid(), a, b]
  );
  res.json({ ok: true });
});

app.delete("/api/owners/:id/links/:linkedOwnerId", async (req, res) => {
  await pool.query(
    `delete from owner_links where (owner_id_a=$1 and owner_id_b=$2) or (owner_id_a=$2 and owner_id_b=$1)`,
    [req.params.id, req.params.linkedOwnerId]
  );
  res.json({ ok: true });
});

app.post("/api/owners/merge", async (req, res) => {
  const { survivorId, loserIds = [] } = req.body || {};
  const losers = loserIds.filter((id) => id && id !== survivorId);
  if (!survivorId || !losers.length) return res.status(400).json({ error: "survivorId and loserIds required" });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`update properties set owner_id=$1 where owner_id = any($2)`, [survivorId, losers]);
    await client.query(`update touches set owner_id=$1 where owner_id = any($2)`, [survivorId, losers]);
    await client.query(`delete from owners where id = any($1)`, [losers]);
    await client.query("commit");
    res.json({ ok: true });
  } catch (e) {
    await client.query("rollback");
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    client.release();
  }
});

/* ---------------- properties ---------------- */
app.get("/api/properties", async (req, res) => {
  const { market, active, q, status } = req.query;
  const where = [], args = [];
  if (market) { args.push(market); where.push(`p.market_id = $${args.length}`); }
  if (active === "1" || active === "true") where.push(`p.active = true`);
  else if (active === "false") where.push(`p.active = false`);
  if (status) { args.push(status); where.push(`p.status = $${args.length}`); }
  if (q) { args.push(`%${q}%`); where.push(`(p.address ilike $${args.length} or p.owner_name ilike $${args.length} or p.phone ilike $${args.length})`); }
  const clause = where.length ? `where ${where.join(" and ")}` : "";
  const { rows } = await pool.query(`
    select p.id, p.market_id, p.address, p.owner_name, p.phone, p.email,
               p.unit_count, p.status, p.active, p.owner_id,
               to_char(p.next_follow_up, 'YYYY-MM-DD') as next_follow_up,
               p.created_at, p.extra, p.extra_order,
               m.name as market_name, o.name as linked_owner_name,
      (select to_char(max(touch_date),'YYYY-MM-DD') from touches t where t.property_id = p.id) as last_touch,
      (select channel from touches t where t.property_id = p.id order by touch_date desc, created_at desc limit 1) as last_channel
    from properties p left join markets m on m.id = p.market_id left join owners o on o.id = p.owner_id
    ${clause}
    order by p.active desc, p.next_follow_up asc nulls last, p.created_at desc
    limit 2000`, args);
  res.json(rows);
});

app.post("/api/properties", async (req, res) => {
  const b = req.body, id = uid();
  await pool.query(
    `insert into properties (id, market_id, address, owner_name, phone, email, unit_count)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [id, b.market_id || null, b.address, b.owner_name || "", b.phone || "", b.email || "", b.unit_count || null]
  );
  res.json({ id });
});

app.get("/api/properties/:id", async (req, res) => {
  const { rows } = await pool.query(
    `select p.*, to_char(p.next_follow_up,'YYYY-MM-DD') as next_follow_up, m.name as market_name, o.name as linked_owner_name
     from properties p left join markets m on m.id = p.market_id left join owners o on o.id = p.owner_id
     where p.id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  const t = await pool.query(
    `select id, to_char(touch_date,'YYYY-MM-DD') as touch_date, channel, note
     from touches where property_id=$1 order by touch_date desc, created_at desc`, [req.params.id]);
  const at = await pool.query(
    `select id, filename, mime, size, to_char(created_at,'YYYY-MM-DD') as created_at
     from attachments where property_id=$1 order by created_at desc`, [req.params.id]);
  res.json({ ...rows[0], touches: t.rows, attachments: at.rows });
});

app.patch("/api/properties/:id", async (req, res) => {
  const allowed = ["address", "owner_name", "phone", "email", "unit_count", "status", "active", "next_follow_up", "market_id", "notes", "owner_id"];
  const sets = [], args = [];
  for (const k of allowed) if (k in req.body) { args.push(req.body[k] === "" ? null : req.body[k]); sets.push(`${k}=$${args.length}`); }
  if (req.body.extra && typeof req.body.extra === "object" && !Array.isArray(req.body.extra)) {
    args.push(JSON.stringify(req.body.extra));
    sets.push(`extra = extra || $${args.length}::jsonb`);
  }
  if (typeof req.body.orderAppend === "string" && req.body.orderAppend) {
    args.push(JSON.stringify([req.body.orderAppend]));
    sets.push(`extra_order = extra_order || $${args.length}::jsonb`);
  }
  if ("rent_table" in req.body) {
    args.push(JSON.stringify(Array.isArray(req.body.rent_table) ? req.body.rent_table : []));
    sets.push(`rent_table = $${args.length}::jsonb`);
  }
  if (!sets.length) return res.json({ ok: true });
  args.push(req.params.id);
  await pool.query(`update properties set ${sets.join(", ")} where id=$${args.length}`, args);
  res.json({ ok: true });
});

app.delete("/api/properties/:id", async (req, res) => {
  await pool.query(`delete from properties where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

app.post("/api/properties/:id/touch", async (req, res) => {
  const b = req.body;
  await pool.query(
    `insert into touches (id, property_id, touch_date, channel, note) values ($1,$2,$3,$4,$5)`,
    [uid(), req.params.id, b.touch_date, b.channel, b.note || ""]
  );
  res.json({ ok: true });
});

/* ---------------- attachments (stored in Postgres) ---------------- */
app.post("/api/properties/:id/attachments", async (req, res) => {
  const { filename, mime, data } = req.body || {};
  if (!filename || !data) return res.status(400).json({ error: "missing file" });
  const buf = Buffer.from(String(data), "base64");
  if (buf.length > 10 * 1024 * 1024) return res.status(413).json({ error: "file too large (max 10MB)" });
  await pool.query(
    `insert into attachments (id, property_id, filename, mime, size, data) values ($1,$2,$3,$4,$5,$6)`,
    [uid(), req.params.id, String(filename), String(mime || ""), buf.length, buf]
  );
  res.json({ ok: true });
});

app.get("/api/attachments/:id", async (req, res) => {
  const { rows } = await pool.query(`select filename, mime, data from attachments where id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.setHeader("Content-Type", rows[0].mime || "application/octet-stream");
  res.setHeader("Content-Disposition", `inline; filename="${String(rows[0].filename).replace(/"/g, "")}"`);
  res.send(rows[0].data);
});

app.delete("/api/attachments/:id", async (req, res) => {
  await pool.query(`delete from attachments where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

app.patch("/api/touches/:id", async (req, res) => {
  const allowed = ["touch_date", "channel", "note"];
  const sets = [], args = [];
  for (const k of allowed) if (k in req.body) { args.push(req.body[k]); sets.push(`${k}=$${args.length}`); }
  if (!sets.length) return res.json({ ok: true });
  args.push(req.params.id);
  await pool.query(`update touches set ${sets.join(", ")} where id=$${args.length}`, args);
  res.json({ ok: true });
});

app.delete("/api/touches/:id", async (req, res) => {
  await pool.query(`delete from touches where id=$1`, [req.params.id]);
  res.json({ ok: true });
});

/* ---------------- bulk import (upsert by market + address) ---------------- */
app.post("/api/import", async (req, res) => {
  const { rows = [] } = req.body;
  let marketId = req.body.marketId;
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (!marketId && req.body.marketName) {
      marketId = uid();
      await client.query(`insert into markets (id, name) values ($1,$2)`, [marketId, req.body.marketName.trim()]);
    }
    let n = 0, ownersCreated = 0;
    const ownerCache = new Map();
    const order = JSON.stringify(Array.isArray(req.body.order) ? req.body.order : []);
    for (const r of rows) {
      if (!r.address || !String(r.address).trim()) continue;
      const { rows: [{ id: propId }] } = await client.query(
        `insert into properties (id, market_id, address, owner_name, phone, email, unit_count, extra, extra_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)
         on conflict (market_id, lower(address))
         do update set owner_name=excluded.owner_name, phone=excluded.phone,
                       email=excluded.email, unit_count=excluded.unit_count,
                       extra=excluded.extra, extra_order=excluded.extra_order
         returning id`,
        [uid(), marketId || null, String(r.address).trim(), r.owner_name || "", r.phone || "",
         r.email || "", Number.isFinite(+r.unit_count) && r.unit_count !== "" ? +r.unit_count : null,
         JSON.stringify(r.extra && typeof r.extra === "object" ? r.extra : {}), order]
      );
      n++;

      const ownerName = String(r.owner_name || "").trim();
      if (ownerName) {
        const key = ownerName.toLowerCase();
        let ownerId = ownerCache.get(key);
        if (!ownerId) {
          const existing = await client.query(`select id from owners where lower(trim(name)) = $1 limit 1`, [key]);
          if (existing.rows[0]) {
            ownerId = existing.rows[0].id;
          } else {
            ownerId = uid();
            await client.query(`insert into owners (id, name) values ($1,$2)`, [ownerId, ownerName]);
            ownersCreated++;
          }
          ownerCache.set(key, ownerId);
        }
        await client.query(`update properties set owner_id=$1 where id=$2`, [ownerId, propId]);
      }
    }
    await client.query("commit");
    res.json({ imported: n, marketId, ownersCreated });
  } catch (e) {
    await client.query("rollback");
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    client.release();
  }
});

/* ---------------- serve built client ---------------- */
const dist = path.join(__dirname, "client", "dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

/* ---------------- desk (follow-ups + hotlist) ---------------- */
const pad2 = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const addDaysStr = (base, n) => {
  const [y, m, d] = base.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
};

app.get("/api/desk", async (req, res) => {
  const { type, status, market_id } = req.query;
  const rows = [];

  if (type !== "owner") {
    const where = ["p.active = true"], args = [];
    if (status) { args.push(status); where.push(`p.status = $${args.length}`); }
    if (market_id) { args.push(market_id); where.push(`p.market_id = $${args.length}`); }
    const { rows: props } = await pool.query(`
      select p.id, p.address as name, p.status,
             to_char(p.next_follow_up, 'YYYY-MM-DD') as next_follow_up,
             (select to_char(max(touch_date),'YYYY-MM-DD') from touches t where t.property_id = p.id) as last_touch,
             (select channel from touches t where t.property_id = p.id order by touch_date desc, created_at desc limit 1) as last_channel
      from properties p where ${where.join(" and ")}`, args);
    props.forEach((r) => rows.push({ type: "property", ...r }));
  }

  if (type !== "property") {
    const where = ["o.active = true"], args = [];
    if (status) { args.push(status); where.push(`o.status = $${args.length}`); }
    const { rows: owns } = await pool.query(`
      select o.id, o.name, o.status,
             to_char(o.next_follow_up, 'YYYY-MM-DD') as next_follow_up,
             (select to_char(max(touch_date),'YYYY-MM-DD') from touches t where t.owner_id = o.id) as last_touch,
             (select channel from touches t where t.owner_id = o.id order by touch_date desc, created_at desc limit 1) as last_channel
      from owners o where ${where.join(" and ")}`, args);
    owns.forEach((r) => rows.push({ type: "owner", ...r }));
  }

  const today = todayStr();
  const weekOut = addDaysStr(today, 7);
  const bucketOf = (nfu) => {
    if (nfu < today) return "overdue";
    if (nfu === today) return "today";
    if (nfu <= weekOut) return "upcoming";
    return "later";
  };
  const bucketOrder = { overdue: 0, today: 1, upcoming: 2, later: 3 };

  const followups = rows
    .filter((r) => r.next_follow_up)
    .map((r) => ({ ...r, bucket: bucketOf(r.next_follow_up) }))
    .sort((a, b) => (bucketOrder[a.bucket] - bucketOrder[b.bucket]) || a.next_follow_up.localeCompare(b.next_follow_up));
  const hotlist = rows.slice().sort((a, b) => a.name.localeCompare(b.name));

  res.json({ followups, hotlist });
});

const port = process.env.PORT || 3000;
ensureSchema().then(() => console.log("schema ready")).catch((e) => console.error("schema error (will retry on use):", e.message));
app.listen(port, () => console.log(`mf-tracker listening on :${port}`));
