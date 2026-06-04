import React, { useState, useEffect, useCallback } from "react";
import Papa from "papaparse";
import {
  Phone, Mail, MessageSquare, Send, Plus, Search, X, Trash2, Clock, Check,
  ChevronDown, ChevronRight, MapPin, User, Upload, Star, LogOut, Building2,
} from "lucide-react";

/* ---------------- constants & helpers ---------------- */
const CHANNELS = {
  Call: { Icon: Phone, color: "var(--rust)" },
  Email: { Icon: Mail, color: "var(--teal)" },
  SMS: { Icon: MessageSquare, color: "var(--amber)" },
  Mail: { Icon: Send, color: "#5b5142" },
};
const STATUSES = { New: "var(--inkSoft)", Working: "var(--teal)", Warm: "var(--amber)", Dead: "var(--muted)" };
const FIELDS = [
  { key: "address", label: "Address *", req: true },
  { key: "owner_name", label: "Owner name" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "unit_count", label: "Unit count" },
];

const TABLE_COLS = [
  { field: "Property Name", label: "Property", extra: true, w: 190 },
  { field: "address", label: "Address", w: 200 },
  { field: "City", label: "City", extra: true, w: 120 },
  { field: "unit_count", label: "Units", num: true, w: 70 },
  { field: "Year Built", label: "Built", extra: true, w: 70 },
  { field: "status", label: "Status", type: "status", w: 110 },
  { field: "next_follow_up", label: "Follow-up", type: "date", w: 130 },
];
const colVal = (p, c) => (c.extra ? (p.extra?.[c.field] ?? "") : (p[c.field] ?? ""));
const colPatch = (c, v) => (c.extra ? { extra: { [c.field]: v } } : { [c.field]: v });

const pad = (n) => String(n).padStart(2, "0");
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmtDate = (s) => { if (!s) return "—"; const [y, m, d] = s.split("-"); return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
const daysFromToday = (s) => { if (!s) return null; const [y, m, d] = s.split("-").map(Number); const a = new Date(y, m - 1, d), n = new Date(); a.setHours(0, 0, 0, 0); n.setHours(0, 0, 0, 0); return Math.round((a - n) / 86400000); };

const api = {
  get: (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(r))),
  send: (u, m, b) => fetch(u, { method: m, headers: { "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }).then((r) => (r.ok ? r.json() : Promise.reject(r))),
};

/* ============================================================ */
export default function App() {
  const [authed, setAuthed] = useState(null);
  useEffect(() => { api.get("/api/me").then(() => setAuthed(true)).catch(() => setAuthed(false)); }, []);
  if (authed === null) return <Center>Loading…</Center>;
  if (!authed) return <Login onOk={() => setAuthed(true)} />;
  return <Tracker onLogout={() => setAuthed(false)} />;
}

const Center = ({ children }) => (
  <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--inkSoft)" }}>{children}</div>
);

/* ---------------- login ---------------- */
function Login({ onOk }) {
  const [pw, setPw] = useState(""); const [err, setErr] = useState(false);
  const submit = async () => { try { await api.send("/api/login", "POST", { password: pw }); onOk(); } catch { setErr(true); } };
  return (
    <Center>
      <div className="card" style={{ padding: 28, width: 320 }}>
        <div className="display" style={{ fontSize: 26, fontWeight: 600, marginBottom: 4 }}>Outreach Ledger</div>
        <div style={{ color: "var(--inkSoft)", fontSize: 13, marginBottom: 18 }}>Enter your password to continue.</div>
        <input className="in" type="password" placeholder="Password" value={pw} autoFocus
          onChange={(e) => { setPw(e.target.value); setErr(false); }}
          onKeyDown={(e) => e.key === "Enter" && submit()} />
        {err && <div style={{ color: "var(--rust)", fontSize: 12, marginTop: 8 }}>Wrong password.</div>}
        <button className="btn btn-primary" style={{ width: "100%", marginTop: 14 }} onClick={submit}>Log in</button>
      </div>
    </Center>
  );
}

/* ---------------- tracker ---------------- */
function Tracker({ onLogout }) {
  const [markets, setMarkets] = useState([]);
  const [market, setMarket] = useState("");      // "" = all
  const [tab, setTab] = useState("desk");        // desk | all
  const [props, setProps] = useState([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("All");
  const [expanded, setExpanded] = useState(null);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadMarkets = useCallback(() => api.get("/api/markets").then(setMarkets).catch(() => {}), []);
  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (market) p.set("market", market);
    if (tab === "desk") p.set("active", "1");
    if (status !== "All") p.set("status", status);
    if (query.trim()) p.set("q", query.trim());
    api.get(`/api/properties?${p}`).then(setProps).catch(() => {});
  }, [market, tab, status, query]);

  useEffect(() => { loadMarkets(); }, [loadMarkets]);
  useEffect(() => { const t = setTimeout(load, query ? 250 : 0); return () => clearTimeout(t); }, [load, query]);

  const today = todayStr();
  const due = props.filter((p) => p.active && p.status !== "Dead" && p.next_follow_up && p.next_follow_up <= today)
    .sort((a, b) => (a.next_follow_up || "").localeCompare(b.next_follow_up || ""));

  const refresh = () => { load(); loadMarkets(); };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 16px 60px" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
        <h1 className="display" style={{ fontSize: 30, fontWeight: 600, margin: 0, letterSpacing: "-.02em" }}>Outreach Ledger</h1>
        <button className="link" onClick={() => api.send("/api/logout", "POST").then(onLogout)}><LogOut size={14} /> Log out</button>
      </div>

      {/* market + tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", margin: "14px 0 16px" }}>
        <select className="in" style={{ width: "auto" }} value={market} onChange={(e) => setMarket(e.target.value)}>
          <option value="">All markets</option>
          {markets.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.property_count})</option>)}
        </select>
        <div style={{ display: "flex", border: "1px solid var(--line)", borderRadius: 8, overflow: "hidden" }}>
          {[["desk", "Desk"], ["all", "Warehouse"]].map(([k, lbl]) => (
            <button key={k} onClick={() => setTab(k)} className="mono"
              style={{ fontSize: 12, padding: "8px 14px", border: "none", cursor: "pointer",
                background: tab === k ? "var(--ink)" : "transparent", color: tab === k ? "#fff" : "var(--inkSoft)" }}>{lbl}</button>
          ))}
        </div>
        <button className="btn btn-primary" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }} onClick={() => setImporting(true)}>
          <Upload size={15} /> Import
        </button>
      </div>

      {/* due panel */}
      <div className="card" style={{ padding: 16, marginBottom: 18 }}>
        <div className="mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--rustDeep)", marginBottom: 10 }}>
          <Clock size={14} /> Reach out today · {due.length}
        </div>
        {due.length === 0
          ? <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--inkSoft)", fontSize: 13 }}><Check size={15} style={{ color: "var(--green)" }} /> Nothing due on your desk.</div>
          : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {due.map((p) => { const d = daysFromToday(p.next_follow_up); return (
                <button key={p.id} className="row-btn" style={{ background: "var(--surface2)", border: "1px solid var(--lineSoft)", borderRadius: 10 }}
                  onClick={() => setExpanded(p.id)}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="truncate" style={{ fontWeight: 600, fontSize: 14 }}>{p.address}</div>
                    <div className="truncate" style={{ color: "var(--inkSoft)", fontSize: 12 }}>{p.owner_name || "—"}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 11, whiteSpace: "nowrap", padding: "3px 9px", borderRadius: 999,
                    border: "1px solid var(--rust)", color: d < 0 ? "#fff" : "var(--rustDeep)", background: d < 0 ? "var(--rust)" : "transparent" }}>
                    {d < 0 ? `${-d}d overdue` : "due today"}</span>
                </button>); })}
            </div>}
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: "var(--muted)" }} />
          <input className="in" style={{ paddingLeft: 32 }} placeholder="Search address, owner, phone…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <button className="btn" style={{ background: "var(--surface)", border: "1px solid var(--line)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 6 }} onClick={() => setAdding((v) => !v)}>
          <Plus size={16} /> Add
        </button>
      </div>

      {/* status pills */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {["All", ...Object.keys(STATUSES)].map((s) => {
          const on = status === s, col = STATUSES[s] || "var(--ink)";
          return <button key={s} className="pill" onClick={() => setStatus(s)}
            style={{ border: `1px solid ${on ? col : "var(--line)"}`, background: on ? col : "transparent", color: on ? "#fff" : "var(--inkSoft)" }}>{s}</button>;
        })}
      </div>

      {adding && <AddForm markets={markets} market={market} onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />}

      {/* table */}
      {props.length === 0 ? (
        <div style={{ textAlign: "center", color: "var(--inkSoft)", fontSize: 13, padding: "28px 0" }}>
          {tab === "desk" ? "Your desk is empty. Promote leads from the Warehouse to work them." : "No properties yet — Import a market to get started."}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 34 }}></th>
                {TABLE_COLS.map((c) => <th key={c.field} style={{ width: c.w, textAlign: c.num ? "right" : "left" }}>{c.label}</th>)}
                <th style={{ width: 34 }}></th>
              </tr>
            </thead>
            <tbody>
              {props.map((p) => (
                <PropertyRow key={p.id} p={p} today={today} open={expanded === p.id}
                  onToggle={() => setExpanded(expanded === p.id ? null : p.id)} onChange={refresh} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mono" style={{ textAlign: "center", color: "var(--muted)", fontSize: 11, marginTop: 26 }}>
        Your data · stored in your own database
      </div>

      {importing && <ImportModal markets={markets} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} />}
    </div>
  );
}

/* ---------------- property row + detail ---------------- */
function PropertyRow({ p, today, open, onToggle, onChange }) {
  const [detail, setDetail] = useState(null);
  const [draft, setDraft] = useState({ channel: "Call", note: "", date: today });
  useEffect(() => { if (open) api.get(`/api/properties/${p.id}`).then(setDetail); else setDetail(null); }, [open, p.id]);

  const patch = (body) => api.send(`/api/properties/${p.id}`, "PATCH", body).then(() => { onChange(); if (open) api.get(`/api/properties/${p.id}`).then(setDetail); });
  const logTouch = () => { if (!draft.note.trim()) return; api.send(`/api/properties/${p.id}/touch`, "POST", { touch_date: draft.date, channel: draft.channel, note: draft.note.trim() }).then(() => { setDraft((d) => ({ ...d, note: "" })); api.get(`/api/properties/${p.id}`).then(setDetail); onChange(); }); };

  return (
    <>
      <tr className="tbl-row" style={open ? { background: "var(--surface2)" } : undefined}>
        <td className="tbl-ctl">
          <Star size={15} style={{ cursor: "pointer", color: p.active ? "var(--amber)" : "var(--line)", fill: p.active ? "var(--amber)" : "none" }}
            onClick={() => patch({ active: !p.active })} title={p.active ? "On desk" : "Promote to desk"} />
        </td>
        {TABLE_COLS.map((c) => (
          <td key={c.field} style={{ textAlign: c.num ? "right" : "left" }}>
            {c.type === "status" ? (
              <select className="cell-sel" value={p.status} onChange={(e) => patch({ status: e.target.value })} style={{ color: STATUSES[p.status] }}>
                {Object.keys(STATUSES).map((s) => <option key={s} style={{ color: "var(--ink)" }}>{s}</option>)}
              </select>
            ) : (
              <CellEdit value={colVal(p, c)} type={c.type} num={c.num} onSave={(v) => patch(colPatch(c, v))} />
            )}
          </td>
        ))}
        <td className="tbl-ctl">
          <button className="cell-exp" onClick={onToggle} title="Details">
            {open ? <ChevronDown size={16} style={{ color: "var(--inkSoft)" }} /> : <ChevronRight size={16} style={{ color: "var(--muted)" }} />}
          </button>
        </td>
      </tr>

      {open && detail && (
        <tr className="tbl-detail">
          <td colSpan={TABLE_COLS.length + 2} style={{ padding: 0 }}>
            <div style={{ borderTop: "2px solid var(--rust)", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
              <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", color: "var(--inkSoft)" }}><MapPin size={13} /> {p.address}{p.market_name ? ` · ${p.market_name}` : ""}</div>
                <Editable icon={<User size={13} />} value={detail.owner_name} ph="Owner name" onSave={(v) => patch({ owner_name: v })} />
                <Editable icon={<Phone size={13} />} value={detail.phone} ph="Phone" onSave={(v) => patch({ phone: v })} />
                <Editable icon={<Mail size={13} />} value={detail.email} ph="Email" onSave={(v) => patch({ email: v })} />
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <select className="in" style={{ width: "auto" }} value={detail.status} onChange={(e) => patch({ status: e.target.value })}>
                  {Object.keys(STATUSES).map((s) => <option key={s}>{s}</option>)}
                </select>
                <input className="in" style={{ width: "auto" }} type="date" value={detail.next_follow_up || ""} onChange={(e) => patch({ next_follow_up: e.target.value })} />
                {[["+3d", 3], ["+1w", 7], ["+2w", 14], ["+1mo", 30]].map(([l, n]) => (
                  <button key={l} className="pill" style={{ color: "var(--teal)" }} onClick={() => patch({ next_follow_up: addDays(n) })}>{l}</button>
                ))}
              </div>

              <div style={{ background: "var(--surface2)", border: "1px solid var(--lineSoft)", borderRadius: 10, padding: 12 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  {Object.entries(CHANNELS).map(([name, { Icon, color }]) => { const on = draft.channel === name; return (
                    <button key={name} onClick={() => setDraft((d) => ({ ...d, channel: name }))}
                      style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, borderRadius: 7, padding: "5px 9px", cursor: "pointer",
                        border: `1px solid ${on ? color : "var(--line)"}`, background: on ? color : "transparent", color: on ? "#fff" : "var(--inkSoft)" }}>
                      <Icon size={13} /> {name}</button>); })}
                  <input className="in" style={{ width: "auto", marginLeft: "auto" }} type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
                </div>
                <textarea className="in" rows={2} placeholder="Call notes (voicemail, spoke 5 min, send comps…)" value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                  <button className="btn btn-ink" disabled={!draft.note.trim()} style={{ opacity: draft.note.trim() ? 1 : .5 }} onClick={logTouch}>Log touch</button>
                </div>
              </div>

              {detail.touches?.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {detail.touches.map((e) => { const C = CHANNELS[e.channel] || CHANNELS.Call; return (
                    <div key={e.id} style={{ display: "flex", gap: 12, fontSize: 13 }}>
                      <div className="mono" style={{ width: 64, flexShrink: 0, fontSize: 11, color: "var(--inkSoft)", paddingTop: 2 }}>{fmtDate(e.touch_date)}</div>
                      <div style={{ flexShrink: 0, paddingTop: 2 }}><C.Icon size={14} style={{ color: C.color }} /></div>
                      <div>{e.note}</div>
                    </div>); })}
                </div>
              )}

              {detail.extra && Object.keys(detail.extra).length > 0 && (
                <details style={{ border: "1px solid var(--lineSoft)", borderRadius: 10, padding: "10px 12px" }}>
                  <summary style={{ cursor: "pointer", fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--inkSoft)" }}>All property data</summary>
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(130px, 38%) 1fr", gap: "4px 14px", marginTop: 12, fontSize: 13 }}>
                    {Object.entries(detail.extra)
                      .filter(([, v]) => v != null && String(v).trim() !== "")
                      .map(([k, v]) => (
                        <React.Fragment key={k}>
                          <div style={{ color: "var(--muted)" }}>{k}</div>
                          <div style={{ color: "var(--ink)", wordBreak: "break-word" }}>{String(v)}</div>
                        </React.Fragment>
                      ))}
                  </div>
                </details>
              )}

              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <button className="link" onClick={() => patch({ active: !detail.active })}>
                  <Star size={13} /> {detail.active ? "Remove from desk" : "Promote to desk"}
                </button>
                <button className="link" onClick={() => api.send(`/api/properties/${p.id}`, "DELETE").then(() => { onChange(); })}><Trash2 size={13} /> Delete</button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CellEdit({ value, type, num, onSave }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value ?? "");
  useEffect(() => setV(value ?? ""), [value]);
  const commit = () => { onSave(String(v).trim()); setEditing(false); };
  if (editing || type === "date") {
    return (
      <input className="cell-input" autoFocus={editing} type={type === "date" ? "date" : num ? "number" : "text"}
        value={v} onChange={(e) => setV(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setV(value ?? ""); setEditing(false); } }} />
    );
  }
  return (
    <div className="cell-view" onClick={() => setEditing(true)} title="Click to edit">
      {value !== "" && value != null ? String(value) : <span style={{ color: "var(--muted)" }}>—</span>}
    </div>
  );
}

function Editable({ icon, value, ph, onSave }) {
  const [edit, setEdit] = useState(false); const [v, setV] = useState(value || "");
  useEffect(() => setV(value || ""), [value]);
  if (edit) return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{ color: "var(--muted)" }}>{icon}</span>
      <input className="in" autoFocus value={v} placeholder={ph} onChange={(e) => setV(e.target.value)}
        onBlur={() => { onSave(v.trim()); setEdit(false); }} onKeyDown={(e) => e.key === "Enter" && (onSave(v.trim()), setEdit(false))} />
    </div>);
  return (
    <button onClick={() => setEdit(true)} style={{ display: "flex", gap: 8, alignItems: "center", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
      <span style={{ color: "var(--muted)" }}>{icon}</span>
      <span style={{ color: value ? "var(--ink)" : "var(--muted)" }}>{value || ph}</span>
    </button>);
}

/* ---------------- add single ---------------- */
function AddForm({ markets, market, onDone, onCancel }) {
  const [f, setF] = useState({ address: "", owner_name: "", phone: "", email: "", market_id: market || "" });
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const submit = () => { if (!f.address.trim()) return; api.send("/api/properties", "POST", { ...f, address: f.address.trim() }).then(onDone); };
  return (
    <div className="card" style={{ borderColor: "var(--rust)", padding: 16, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <span className="mono" style={{ fontSize: 12, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--rustDeep)" }}>New property</span>
        <button className="link" onClick={onCancel}><X size={16} /></button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input className="in" placeholder="Property address *" value={f.address} onChange={set("address")} autoFocus onKeyDown={(e) => e.key === "Enter" && submit()} />
        <input className="in" placeholder="Owner name" value={f.owner_name} onChange={set("owner_name")} />
        <div style={{ display: "flex", gap: 8 }}>
          <input className="in" placeholder="Phone" value={f.phone} onChange={set("phone")} />
          <input className="in" placeholder="Email" value={f.email} onChange={set("email")} />
        </div>
        <select className="in" value={f.market_id} onChange={set("market_id")}>
          <option value="">No market</option>
          {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn btn-primary" disabled={!f.address.trim()} style={{ opacity: f.address.trim() ? 1 : .5 }} onClick={submit}>Add property</button>
      </div>
    </div>);
}

/* ---------------- import ---------------- */
function ImportModal({ markets, onClose, onDone }) {
  const [rows, setRows] = useState(null);     // parsed objects
  const [headers, setHeaders] = useState([]);
  const [map, setMap] = useState({});
  const [marketChoice, setMarketChoice] = useState("__new");
  const [marketName, setMarketName] = useState("");
  const [existingMarket, setExistingMarket] = useState(markets[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const onParsed = (res) => {
    const hs = res.meta.fields || [];
    setHeaders(hs); setRows(res.data);
    // auto-guess mapping
    const guess = {};
    for (const f of FIELDS) {
      const hit = hs.find((h) => h.toLowerCase().replace(/[^a-z]/g, "").includes(f.key.replace(/_/g, "").slice(0, 5)));
      if (hit) guess[f.key] = hit;
    }
    if (!guess.address) guess.address = hs.find((h) => /addr|street|property/i.test(h)) || hs[0];
    if (!guess.owner_name) guess.owner_name = hs.find((h) => /owner|name/i.test(h)) || "";
    if (!guess.unit_count) guess.unit_count = hs.find((h) => /unit/i.test(h)) || "";
    setMap(guess);
  };
  const onFile = (e) => { const f = e.target.files?.[0]; if (f) Papa.parse(f, { header: true, skipEmptyLines: true, complete: onParsed }); };
  const onPaste = (text) => { if (text.trim()) Papa.parse(text.trim(), { header: true, skipEmptyLines: true, complete: onParsed }); };

  const doImport = async () => {
    setBusy(true);
    const payload = rows.map((r) => {
      const o = {};
      for (const f of FIELDS) o[f.key] = map[f.key] ? r[map[f.key]] : "";
      o.extra = r;
      return o;
    }).filter((o) => o.address && String(o.address).trim());
    const body = marketChoice === "__new" ? { marketName: marketName.trim() || "Imported market", rows: payload } : { marketId: existingMarket, rows: payload };
    try { const res = await api.send("/api/import", "POST", body); setResult(res); } catch { setResult({ error: true }); }
    setBusy(false);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card" style={{ width: 560, maxWidth: "100%", padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="display" style={{ fontSize: 20, fontWeight: 600 }}>Import a market</span>
          <button className="link" onClick={onClose}><X size={18} /></button>
        </div>

        {result ? (
          <div>
            {result.error ? <div style={{ color: "var(--rust)" }}>Import failed. Check your file and try again.</div>
              : <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 15 }}><Check size={18} style={{ color: "var(--green)" }} /> Imported {result.imported} properties.</div>}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
              <button className="btn btn-primary" onClick={onDone}>Done</button>
            </div>
          </div>
        ) : !rows ? (
          <div>
            <p style={{ color: "var(--inkSoft)", fontSize: 13, marginTop: 0 }}>Upload a CSV export, or paste rows below. First row must be column headers.</p>
            <label className="btn" style={{ background: "var(--surface2)", border: "1px solid var(--line)", color: "var(--ink)", display: "inline-flex", gap: 8, alignItems: "center" }}>
              <Upload size={15} /> Choose CSV file
              <input type="file" accept=".csv,text/csv" style={{ display: "none" }} onChange={onFile} />
            </label>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", margin: "14px 0 6px" }}>— or paste —</div>
            <textarea className="in" rows={5} placeholder="address,owner_name,phone,units&#10;1420 Highland Ave,Birchwood LLC,614-555-0142,12" onChange={(e) => onPaste(e.target.value)} />
          </div>
        ) : (
          <div>
            <div className="mono" style={{ fontSize: 11, color: "var(--inkSoft)", marginBottom: 10 }}>{rows.length} rows detected · map your columns:</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              {FIELDS.map((f) => (
                <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 110, fontSize: 13, color: f.req ? "var(--ink)" : "var(--inkSoft)" }}>{f.label}</div>
                  <select className="in" value={map[f.key] || ""} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))}>
                    <option value="">— none —</option>
                    {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid var(--lineSoft)", paddingTop: 14 }}>
              <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
                  <input type="radio" checked={marketChoice === "__new"} onChange={() => setMarketChoice("__new")} /> New market
                </label>
                <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", opacity: markets.length ? 1 : .4 }}>
                  <input type="radio" disabled={!markets.length} checked={marketChoice === "__existing"} onChange={() => setMarketChoice("__existing")} /> Existing
                </label>
              </div>
              {marketChoice === "__new"
                ? <input className="in" placeholder="Market name (e.g. Columbus OH)" value={marketName} onChange={(e) => setMarketName(e.target.value)} />
                : <select className="in" value={existingMarket} onChange={(e) => setExistingMarket(e.target.value)}>{markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18 }}>
              <button className="link" onClick={() => setRows(null)}>← Back</button>
              <button className="btn btn-primary" disabled={busy || !map.address} style={{ opacity: busy || !map.address ? .5 : 1 }} onClick={doImport}>
                {busy ? "Importing…" : `Import ${rows.length} rows`}
              </button>
            </div>
            <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>Re-importing the same address into a market updates it instead of duplicating.</div>
          </div>
        )}
      </div>
    </div>
  );
}
