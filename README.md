# Outreach Ledger

A single-user web app for tracking multifamily property outreach: import markets, log call notes,
and never lose a follow-up. Built to run on **Railway** with a **Postgres** database — the data lives
in *your* database.

---

## What it does
- **Import a market** from a CSV (map your columns; re-importing the same address updates it instead of duplicating).
- **Warehouse vs. Desk** — the Warehouse holds everything you imported; promote leads (the ★) to your **Desk** to actively work them.
- **Reach out today** panel surfaces every desk lead that's due or overdue.
- **Log touches** (Call / Email / SMS / Mail) with notes and dates, and set the next follow-up in one tap.
- One password to log in.

---

## Deploy to Railway (about 10 minutes)

### 1. Put this code on GitHub
Create a new GitHub repository and upload these files (or push with git). Don't upload `node_modules`.

### 2. Create the Railway project
1. Go to railway.app → **New Project** → **Deploy from GitHub repo** → pick your repo.
2. Railway auto-detects Node, installs, runs `npm run build`, then `npm start`.

### 3. Add a Postgres database
In the project: **New** → **Database** → **Add PostgreSQL**. Railway creates it in the same project.

### 4. Set environment variables
Open your **web service** → **Variables** → add:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}`  ← Railway reference to your DB |
| `APP_PASSWORD` | the password you'll type to log in |
| `AUTH_SECRET` | any long random string (e.g. run `openssl rand -hex 32`) |
| `NODE_ENV` | `production` |

### 5. Done
Railway gives you a URL (Settings → Networking → Generate Domain). Open it, log in with `APP_PASSWORD`,
and click **Import** to load your first market.

> The database tables create themselves automatically on first boot. `db/schema.sql` is included only
> if you ever want to inspect or run them by hand (Railway → Postgres → Query).

---

## Run locally (optional)
```bash
npm install
# create .env.local from .env.example, point DATABASE_URL at any Postgres
npm run build      # build the front-end once
DATABASE_URL=... APP_PASSWORD=test AUTH_SECRET=dev npm start
# open http://localhost:3000
```
For live-reload front-end dev: `npm run dev` (Vite on :5173 proxying the API to :3000).

---

## CSV format
Any CSV with a header row works — you map columns in the import screen. Only **address** is required.
Recognized targets: address, owner_name, phone, email, unit_count. Example:
```
address,owner_name,phone,units
1420 Highland Ave,Birchwood Equity LLC,614-555-0142,12
```

## Cost
A small app + Postgres on Railway typically runs ~$5/month. The app sleeps nothing and stays always-on.
