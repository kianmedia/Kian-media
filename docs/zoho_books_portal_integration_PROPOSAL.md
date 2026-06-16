# Zoho Books / Zoho Invoice ↔ Portal integration — PROPOSAL (not implemented)

Status: **planning only.** No Zoho code, no tokens, no secrets in this branch.
Server-side only; nothing Zoho-related ever runs in the browser.

## Goal

1. Sales creates an estimate/quotation in Zoho Books **from a portal quote request**.
2. The created estimate appears as a **reply/update on that quote request** in the portal.
3. The **client sees** the estimate, and later the **invoice**, inside the portal.
4. The client portal gains an **Invoices tab/icon** (already scaffolded — `/client-portal/invoices`).
5. **Finance / owner / manager** see all invoices; clients see only their own.

## Why this must be server-side

The portal browser uses the Supabase **anon key** only. Zoho OAuth tokens, org id,
client secret, and webhook secrets must NEVER reach the browser. So Zoho work runs
in **server-side Next.js Route Handlers** (`app/api/zoho/*/route.ts`) on Vercel —
the app is a normal (non-static) Next deploy, so route handlers are available
(none exist today). Those handlers hold the secrets and write to Supabase using a
**server-only** key.

## Required Zoho credentials / env vars (Vercel → Project → Settings → Environment Variables, server-side only — NOT `NEXT_PUBLIC_*`)

| Var | Purpose |
|---|---|
| `ZOHO_CLIENT_ID` | Zoho OAuth client id (Self Client / Server-based app) |
| `ZOHO_CLIENT_SECRET` | OAuth client secret |
| `ZOHO_REFRESH_TOKEN` | long-lived refresh token (generated once via OAuth consent) |
| `ZOHO_ORG_ID` | Zoho Books organization id |
| `ZOHO_API_DOMAIN` | regional API base, e.g. `https://www.zohoapis.sa` (KSA) / `.com` |
| `ZOHO_ACCOUNTS_DOMAIN` | token endpoint base, e.g. `https://accounts.zoho.sa` |
| `ZOHO_WEBHOOK_SECRET` | shared secret to verify inbound Zoho webhooks |
| `SUPABASE_SERVICE_ROLE_KEY` | **server-only** — lets the route handler upsert `invoices`/quote rows past RLS. NEVER `NEXT_PUBLIC`, never shipped to the browser. |
| `SUPABASE_URL` | already present |

All of the above are **server-only**. The browser keeps using the anon key.

## OAuth / token strategy (server-side)

- One-time: owner generates a `ZOHO_REFRESH_TOKEN` via the Zoho OAuth consent flow
  with scopes `ZohoBooks.estimates.ALL`, `ZohoBooks.invoices.ALL`,
  `ZohoBooks.contacts.READ` (+ CREATE if we auto-create contacts).
- Each request: the route handler exchanges the refresh token for a short-lived
  access token (cache in memory for its ~1h TTL), then calls the Zoho API.
- Tokens live only in the serverless function's memory/env — never persisted to
  a browser-readable place.

## Flow A — estimate from a quote request (sales)

1. Sales opens a quote request in the portal → clicks "Create Zoho estimate".
2. Browser calls our route handler `POST /api/zoho/estimate` with the quote id +
   the user's Supabase JWT (the handler verifies the caller is owner/manager/sales
   via the JWT before doing anything).
3. Handler: resolve/create the Zoho contact for the client → create an estimate in
   Zoho Books → store `zoho_books_estimate_id` + the hosted estimate URL back on
   `quote_requests` (columns already exist: `zoho_deal_id`, `zoho_books_estimate_id`)
   and post a portal update (a `messages`/quote-thread row) so it shows as a reply.
4. Client sees the estimate link/update on their quote request.

## Flow B — invoice sync

- **Webhook (preferred):** configure a Zoho Books webhook → `POST /api/zoho/webhook`.
  Handler verifies `ZOHO_WEBHOOK_SECRET`, then upserts the invoice into
  `public.invoices` (table proposed in
  docs/staff_assignment_notifications_finance_ADDENDUM.sql) with status/amount/url/
  client linkage.
- **Fallback (scheduled):** a cron route (`/api/zoho/sync`, called by Vercel Cron)
  pulls recent invoices/estimates and upserts them.
- The `invoices` row links to the client via `client_id`/`user_id` so RLS shows it
  to the right people.

## Portal display

- **Invoices tab** (`/client-portal/invoices`) — already scaffolded as a placeholder,
  gated by `caps.canSeeInvoices` (owner/admin/manager/finance). Add a **client**
  invoices view (own invoices) once the table is populated — same route, role-aware.
- **Quote request** detail — show the linked estimate (URL + status) as an update.

## RLS / visibility model (in the addendum, already drafted)

- `invoices` SELECT: `can_see_invoices()` (owner/admin/manager/finance) **or** the
  related client (`user_id = auth.uid()` or `client_id = my_client_id()`), and
  `is_deleted = false` (+ RESTRICTIVE live-rows). No browser write grants — only the
  server-side sync writes (via the service-role key, server-only).
- Finance role: added to `staff_role` + `can_see_invoices()` in the addendum.

## Security risks & mitigations

- **Token/secret leakage** → all Zoho secrets + service-role key are server-only env
  vars; never `NEXT_PUBLIC`, never imported by client components. Add a CI grep to
  fail the build if `ZOHO_`/`SERVICE_ROLE` appears under `app/**client` or `components/**`.
- **Webhook spoofing** → verify `ZOHO_WEBHOOK_SECRET` (and Zoho's signature) before
  trusting any payload.
- **Over-broad service-role writes** → the handler writes ONLY the `invoices` /
  quote-estimate columns; never disables RLS for reads.
- **Caller authz** → every `/api/zoho/*` handler verifies the Supabase JWT + role
  (owner/manager/sales for create; webhook is secret-verified) before acting.

## Rollback

- Remove the `app/api/zoho/*` route handlers; unset the Zoho env vars; (optionally)
  keep the `invoices` table or drop it via the addendum rollback. No client code
  depends on Zoho, so the portal keeps working without it.

## What the owner must provide from Zoho

1. A Zoho Books **organization** (org id) in the correct region (e.g. KSA).
2. A **Self Client / Server-based OAuth app** → `ZOHO_CLIENT_ID` + `ZOHO_CLIENT_SECRET`.
3. A generated **refresh token** with the scopes above (one-time consent).
4. The **API + accounts domains** for the region.
5. Approval to add a **server-only `SUPABASE_SERVICE_ROLE_KEY`** in Vercel (used only
   by the Zoho route handlers to upsert invoices/estimates past RLS).
6. A chosen sync mode (webhook vs. cron) and, if webhook, a generated webhook secret.

Once these are provided, implementation is: the addendum (run) → `app/api/zoho/*`
route handlers → client invoices view + quote-estimate display.
