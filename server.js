import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import { pool, ensureSchema, uid } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "8mb" }));
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

/* ---------------- properties ---------------- */
app.get("/api/properties", async (req, res) => {
  const { market, active, q, status } = req.query;
  const where = [], args = [];
  if (market) { args.push(market); where.push(`p.market_id = $${args.length}`); }
  if (active === "1") where.push(`p.active = true`);
  if (status) { args.push(status); where.push(`p.status = $${args.length}`); }
  if (q) { args.push(`%${q}%`); where.push(`(p.address ilike $${args.length} or p.owner_name ilike $${args.length} or p.phone ilike $${args.length})`); }
  const clause = where.length ? `where ${where.join(" and ")}` : "";
  const { rows } = await pool.query(`
    select p.*, m.name as market_name,
      (select to_char(max(touch_date),'YYYY-MM-DD') from touches t where t.property_id = p.id) as last_touch,
      (select channel from touches t where t.property_id = p.id order by touch_date desc, created_at desc limit 1) as last_channel
    from properties p left join markets m on m.id = p.market_id
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
  const { rows } = await pool.query(`select * from properties where id=$1`, [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  const t = await pool.query(
    `select id, to_char(touch_date,'YYYY-MM-DD') as touch_date, channel, note
     from touches where property_id=$1 order by touch_date desc, created_at desc`, [req.params.id]);
  res.json({ ...rows[0], touches: t.rows });
});

app.patch("/api/properties/:id", async (req, res) => {
  const allowed = ["address", "owner_name", "phone", "email", "unit_count", "status", "active", "next_follow_up", "market_id"];
  const sets = [], args = [];
  for (const k of allowed) if (k in req.body) { args.push(req.body[k] === "" ? null : req.body[k]); sets.push(`${k}=$${args.length}`); }
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
    let n = 0;
    for (const r of rows) {
      if (!r.address || !String(r.address).trim()) continue;
      await client.query(
        `insert into properties (id, market_id, address, owner_name, phone, email, unit_count)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (market_id, lower(address))
         do update set owner_name=excluded.owner_name, phone=excluded.phone,
                       email=excluded.email, unit_count=excluded.unit_count`,
        [uid(), marketId || null, String(r.address).trim(), r.owner_name || "", r.phone || "",
         r.email || "", Number.isFinite(+r.unit_count) && r.unit_count !== "" ? +r.unit_count : null]
      );
      n++;
    }
    await client.query("commit");
    res.json({ imported: n, marketId });
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

const port = process.env.PORT || 3000;
ensureSchema().then(() => console.log("schema ready")).catch((e) => console.error("schema error (will retry on use):", e.message));
app.listen(port, () => console.log(`mf-tracker listening on :${port}`));
