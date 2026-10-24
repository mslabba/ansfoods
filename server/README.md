# ANS Foods e-commerce backend

Node 20 + Express + PostgreSQL. Serves the storefront, the admin UI
(`/admin/`), and the JSON API. Cashfree keys and SMTP credentials are stored
in the database and edited in the admin panel — nothing secret is hardcoded.

## Quick start (Docker)

```bash
cp ../.env.example ../.env   # from this directory; then fill in ../.env
# generate secrets: openssl rand -hex 32
cd ..
docker compose up --build
```

Open `http://<server>:8090` (storefront) and `http://<server>:8090/admin/` (admin).

## Without Docker

```bash
npm install
export DATABASE_URL=postgresql://ansfoods:secret@localhost:5432/ansfoods
export SESSION_SECRET=$(openssl rand -hex 32)
export ADMIN_EMAIL=you@example.com
export ADMIN_PASSWORD=choose-a-strong-password
export APP_URL=https://shop.example.com   # no trailing slash
export PUBLIC_DIR=/path/to/repo           # serves index.html, assets, admin
npm start
```

On first boot, migrations run and the admin user is seeded from
`ADMIN_EMAIL`/`ADMIN_PASSWORD` (only if no admin exists yet).

## Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (required) |
| `SESSION_SECRET` | Signs admin session cookies (required, 32+ random chars) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seeds the first admin user (first boot only) |
| `APP_URL` | Public store URL; used for the Cashfree `return_url` |
| `PUBLIC_DIR` | Directory served as the website (default: `../../public` from `src/`) |
| `PORT` | API port (default 4000) |

## Cashfree setup

1. Create a Cashfree merchant account for **ANS Foods** (the client's account,
   not InRay Labs — customer money must not flow through the agency account).
2. In the Cashfree dashboard, copy the **App ID** and **Secret Key**
   (sandbox keys for testing, production keys for real money).
3. In `/admin/` → Settings, paste the keys and choose the environment.
4. Webhooks: in the Cashfree dashboard, point webhooks at
   `https://<APP_URL>/api/webhooks/cashfree`.
   Webhooks require **public HTTPS** — they cannot reach localhost, so test
   them on the deployed server (sandbox webhooks work the same way).
5. Sandbox test: create an order, pay with Cashfree's test UPI/cards, watch
   the order flip to `paid` in `/admin/` → Orders.

If webhooks cannot reach the server, use **Sync payment from Cashfree** on the
order detail page in admin — it pulls the latest status from Cashfree directly.

## Email alerts

`/admin/` → Settings → Email alerts. Fill in the store owner's alert email and
SMTP details (host, port, user, password, from). An email is sent on every new
COD order and every successful online payment. Leave blank to disable.

## Order alerts (WhatsApp) — later

`server/src/lib/notify.js` dispatches over `server/src/channels/`. To add
WhatsApp later: create `server/src/channels/whatsapp.js` exporting
`send(event, order, customer)` and register it in `notify.js`. No order or
payment code needs to change.

## API summary

- `POST /api/orders` — create order (total recomputed server-side)
- `GET /api/orders/:id` — public order status (confirmation polling)
- `POST /api/payments/session` — Cashfree payment session for a pending order
- `POST /api/webhooks/cashfree` — Cashfree server-to-server webhook (HMAC verified)
- `/api/admin/*` — login, orders, payment sync, settings, password change
