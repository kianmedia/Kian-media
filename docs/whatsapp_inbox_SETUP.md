# WhatsApp Inbox + CRM — Setup, n8n wiring & acceptance checklist

This feature adds a **read & route** WhatsApp inbox to the Kian admin portal,
fed by the existing n8n → WhatsApp Cloud API flow. It is **additive only** — no
existing table, policy, route, or auth flow was modified. Customer-facing sending
is intentionally **disabled** in this phase.

---

## 1. What was built (files)

### Database (run manually in Supabase)
- `docs/whatsapp_inbox_RUNME.sql` — 6 tables, RLS, ingest RPC, triage RPCs,
  notification-type widening. Idempotent + has a commented rollback block.

### Server (Next.js route handlers / server-only libs)
- `app/api/integrations/whatsapp/incoming/route.ts` — secure ingest endpoint (`POST`).
- `lib/server/supabaseAdmin.ts` — service-role PostgREST helper (server-only, guarded).
- `lib/server/zoho.ts` — Zoho CRM skeleton (safe no-op stub until configured).
- `lib/whatsapp/classify.ts` — rule-based message classifier (Phase 6 foundation).

### Admin UI
- `app/admin/layout.tsx` — chrome for `/admin/*` (separate from the client portal).
- `app/admin/whatsapp/page.tsx` — the inbox route (`/admin/whatsapp`).
- `components/whatsapp/WhatsAppInbox.tsx` — list + chat detail + triage + notes.
- `lib/whatsapp/inbox.ts` — client data layer (reads via anon-key RLS, writes via RPC).
- `lib/whatsapp/types.ts` — row types + bilingual label maps.

### Notifications integration (reused existing system)
- `lib/portal/types.ts` — added `whatsapp_new` to `NotificationType`.
- `components/portal/NotificationsView.tsx` — label + deep-link to
  `/admin/whatsapp?conversation=<id>`.

### Config
- `.env.example` — documented the new env vars.

### SQL migration name to run
- **`whatsapp_inbox_RUNME.sql`**

---

## 2. New environment variables

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `N8N_WHATSAPP_INGEST_SECRET` | Vercel (Server) | **Yes** | Shared secret n8n sends in `x-kian-ingest-secret`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel (Server) | **Yes** | Lets the ingest route call the `whatsapp_ingest_message` RPC. **Never** expose to the browser. |
| `SUPABASE_URL` | Vercel (Server) | Optional | Server-side project URL. Falls back to `NEXT_PUBLIC_SUPABASE_URL`. |
| `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN` / `ZOHO_ACCOUNTS_URL` / `ZOHO_CRM_API_BASE` | Vercel (Server) | Optional | Zoho lead sync. Unset ⇒ safe no-op. |

> None of these are `NEXT_PUBLIC_*`, so Next.js will not bundle them into client
> code. Generate the ingest secret with `openssl rand -hex 32`.

---

## 3. Manual steps you must do

### A) Supabase
1. Open **Supabase Dashboard → SQL Editor**.
2. Paste and run **`docs/whatsapp_inbox_RUNME.sql`**. It wraps everything in a
   transaction and is safe to re-run.
3. Verify: `select * from public.whatsapp_conversations limit 1;` returns no error.

### B) Vercel
1. **Project → Settings → Environment Variables** → add `N8N_WHATSAPP_INGEST_SECRET`
   and `SUPABASE_SERVICE_ROLE_KEY` (Production + Preview as needed). Optionally add
   the Zoho vars.
2. **Redeploy** so the new env vars are picked up.
3. Sanity check: `GET https://www.kianmedia.com/api/integrations/whatsapp/incoming`
   returns `{"ok":true,"service":"whatsapp-ingest","method":"POST"}`.

### C) n8n
See section 4.

---

## 4. n8n HTTP Request node (Phase 8)

Add **one HTTP Request node** on the branch that already handles a real inbound
message (the `IF true` branch that currently writes to Google Sheets / sends the
auto-reply). Place it **in parallel** with the auto-reply so it does **not** block
or delay the customer reply (use a separate branch out of the IF node, or set the
node to "Continue On Fail").

**Node settings**

- **Method:** `POST`
- **URL:** `https://www.kianmedia.com/api/integrations/whatsapp/incoming`
- **Authentication:** None (the secret travels in a header)
- **Send Headers:** ON
  - `Content-Type`: `application/json`
  - `x-kian-ingest-secret`: `{{$env.N8N_WHATSAPP_INGEST_SECRET}}`
- **Send Body:** ON → **Body Content Type:** `JSON` → **Specify Body:** `Using JSON`

**JSON body**

```json
{
  "wa_id": "{{ $('Webhook').first().json.body.entry[0].changes[0].value.contacts[0].wa_id }}",
  "phone": "{{ $('Webhook').first().json.body.entry[0].changes[0].value.messages[0].from }}",
  "display_name": "{{ $('Webhook').first().json.body.entry[0].changes[0].value.contacts[0].profile.name }}",
  "message_id": "{{ $('Webhook').first().json.body.entry[0].changes[0].value.messages[0].id }}",
  "message_type": "{{ $('Webhook').first().json.body.entry[0].changes[0].value.messages[0].type }}",
  "body": "{{ $('Webhook').first().json.body.entry[0].changes[0].value.messages[0].text.body }}",
  "timestamp": "{{ $('Webhook').first().json.body.entry[0].changes[0].value.messages[0].timestamp }}",
  "raw_payload": {{ JSON.stringify($('Webhook').first().json.body) }}
}
```

**Important n8n notes**
- Set `N8N_WHATSAPP_INGEST_SECRET` in n8n's own environment so `{{$env...}}`
  resolves; it **must** equal the value in Vercel.
- Keep this node on the **message branch only**. Meta also sends *status*
  callbacks (delivered/read) with a `statuses[]` array and **no** `messages[]`.
  If one slips through, the endpoint detects "no message content" and safely
  no-ops — but routing the node behind your existing `messages[]` IF avoids the
  call entirely (acceptance test #7).
- For non-text messages, `messages[0].text.body` is empty; the endpoint still
  records the message using `message_type` (e.g. `[image]`).

---

## 5. Security model (how secrets stay safe)

- The ingest route requires the `x-kian-ingest-secret` header; a missing/invalid
  secret → **401**. If the secret env var itself is unset, the route **fails
  closed** (500) rather than accepting anything.
- The **service-role key** is used **only** server-side inside the route and
  `lib/server/supabaseAdmin.ts`, which throws if ever imported in the browser.
- The frontend talks to Supabase with the **anon key only**; RLS decides which
  WhatsApp rows each staff member can read.
- All writes from the UI go through `SECURITY DEFINER` RPCs (`wa_set_conversation`,
  `wa_assign_conversation`, `wa_add_note`) — there are **no table write-grants**.
- The ingest RPC is granted to `service_role` **only** (revoked from anon/auth).

### Who can see what (RLS)
| Role | Access |
|---|---|
| owner / super_admin / manager | all conversations |
| any staff | anything assigned to them |
| sales | unassigned `sales` / `pricing_request` |
| finance | unassigned `finance` |
| support | unassigned `project_support` / `unknown` |
| client / lead | **none** |

Triage controls (status/category/priority/assignee) are owner/manager only;
internal notes are allowed for anyone who can read the conversation.

---

## 6. Acceptance checklist (Phase 9)

| # | Check | How to verify | Status |
|---|---|---|---|
| 1 | Existing client portal still works | Build passes; no `/client-portal/*` files changed except additive notification label/link | ✅ build green |
| 2 | Admin login still works | No auth files modified | ✅ unchanged |
| 3 | Inbound msg creates contact | Send WhatsApp → `select * from whatsapp_contacts` | ⏳ after migration + n8n |
| 4 | Inbound msg creates/updates conversation | `select * from whatsapp_conversations` | ⏳ after migration + n8n |
| 5 | Message appears in `/admin/whatsapp` | Open as owner/admin | ⏳ after deploy |
| 6 | Admin notification appears | `/client-portal/notifications` shows "WhatsApp" | ⏳ after deploy |
| 7 | Status callbacks don't create fake messages | Node is on the `messages[]` branch; endpoint also no-ops empty payloads; dedup on `whatsapp_message_id` | ✅ by design |
| 8 | No secrets client-side | No `NEXT_PUBLIC_*` secret; service key server-only | ✅ |
| 9 | No existing RLS weakened | Migration only *adds* policies + widens one CHECK | ✅ |
| 10 | Build passes | `next build` | ✅ |
| 11 | Typecheck passes | `tsc --noEmit` | ✅ exit 0 |
| 12 | Lint passes | `next lint` | ✅ (see build log) |

Items marked ⏳ require the manual Supabase migration + Vercel env + n8n node,
then a live WhatsApp message to exercise end-to-end.

### Quick end-to-end smoke test (after manual steps)
```bash
curl -X POST https://www.kianmedia.com/api/integrations/whatsapp/incoming \
  -H "Content-Type: application/json" \
  -H "x-kian-ingest-secret: <YOUR_SECRET>" \
  -d '{"wa_id":"9665XXXXXXX","phone":"9665XXXXXXX","display_name":"Test",
       "message_id":"wamid.TEST1","message_type":"text",
       "body":"كم سعر باقة التصوير؟","timestamp":"1718600000","raw_payload":{}}'
# → {"ok":true,"conversation_id":"...","contact_id":"...","message_inserted":true,...}
# Re-running the SAME message_id → {"ok":true,...,"message_inserted":false,"duplicate":true}
```

---

## 7. Risks & rollback

**Risks**
- *Migration not applied* → the ingest route returns `ingest_failed` (502) and
  `/admin/whatsapp` shows an RLS/relation error. Fix: run the migration.
- *Service-role key leak* → mitigated: server-only, non-`NEXT_PUBLIC_`, browser
  import guard. Rotate the key in Supabase if ever exposed.
- *Notification noise* → admin entries are broadcasts (no unread-badge impact);
  sales users are notified only on **new** sales/pricing threads.
- *Classifier accuracy* → rule-based; wrong category is harmless (owner/manager
  re-triages in one click). Swap `classifyWhatsAppMessage` for a real model later.

**Rollback**
- *Code:* revert this branch / the listed files. Nothing else depends on them.
- *Database:* run the commented **ROLLBACK** block at the bottom of
  `whatsapp_inbox_RUNME.sql` (drops the 6 tables + functions and restores the
  pre-WhatsApp `notifications_type_check`).
- *n8n:* delete or disable the HTTP Request node — the auto-reply flow is
  unaffected.

> **Do not auto-deploy.** Deploy only after you have reviewed this and applied
> the Supabase migration + Vercel env vars.
