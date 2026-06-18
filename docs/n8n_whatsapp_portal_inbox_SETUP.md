# n8n → Kian Portal Inbox — fix, test & rollback

> **Scope note:** I work in the Kian code repo, not your n8n instance. I can't open, back up,
> or edit your live workflow directly. This doc gives you (1) importable workflows, (2) the exact
> node config, (3) a root-cause diagnosis, and (4) backup/test/rollback steps **you** run in n8n.
> **Nothing about your live workflow, Meta webhook URL, auto-reply, or Sheets logging is changed by me.**

Files in `docs/n8n/`:
- `kian-whatsapp-ingest-debug.json` — standalone DEBUG workflow (no WhatsApp needed).
- `kian-whatsapp-portal-inbox-TEST.json` — full target structure (`Kian WhatsApp - Portal Inbox TEST`).

---

## 0. Page-path correction (do this — it's part of "messages don't appear")

You said the inbox page is at `/client-portal/admin/whatsapp`, but the code only had it at
`/admin/whatsapp`. So even with working ingest, that URL was effectively empty. I added the page at
**`/client-portal/admin/whatsapp`** (same component) and pointed the in-portal notification link there.
After you redeploy the site, open: `https://www.kianmedia.com/client-portal/admin/whatsapp`.

---

## 1. Back up the live workflow first (manual, 30 seconds)

1. n8n → open **Kian WhatsApp - LIVE Production**.
2. Top-right **⋮ → Download** → saves `Kian WhatsApp - LIVE Production.json`. Keep it safe (this is your rollback).
3. **⋮ → Duplicate** → rename the copy **`Kian WhatsApp - Portal Inbox TEST`**. Work only in the copy.

> Do **not** edit the live workflow until the copy is verified and you approve.

---

## 2. Most likely root cause (diagnosed from the API side)

The ingest endpoint is healthy (`GET` returns `{"ok":true,...}`). The endpoint treats a message as
"nothing to store" and returns `{"ok":true,"ignored":"no_message_content"}` **when both `message_id`
and `body` arrive empty**. That `ok:true` is why the node "succeeds" but no conversation appears.
Three n8n-side causes produce empty fields — the fix addresses all three:

| # | Cause | Why it produces empty fields | Fix |
|---|---|---|---|
| **A** | **Expression path mismatch** | The body uses `…json.body.entry[0]…`, but on your n8n the webhook may expose it as `…json.entry[0]…` (or vice-versa). The mismatched path resolves to `undefined` → empty `message_id`/`body` → endpoint ignores it. | The new **Build Inbox Payload** Code node reads `root.body ?? root`, so it works either way. |
| **B** | **IF not filtering correctly** | If the IF lets Meta **status callbacks** (delivered/read — which have `statuses[]`, no `messages[]`) through, those have no message body → ignored. | New IF checks `…value.messages[0].id` is not empty; the Code node also emits nothing for status events. |
| **C** | **`raw_payload` double-stringify** | `{{ JSON.stringify(...) }}` placed inside a hand-written JSON body can break the outer JSON → endpoint gets `invalid_json` (400), swallowed if "Continue On Fail" is on. | HTTP node sends `={{ JSON.stringify($json) }}` of the **whole** clean object — one valid JSON document; `raw_payload` is a proper nested object. |

Two more real-world contributors the new design handles:
- **Secret mismatch** → endpoint returns **401**. With stop-on-error (testing) you'll see it immediately.
- **Meta retries** when it doesn't get a fast `200` → the same `message_id` arrives again. The Kian DB
  **dedups on `whatsapp_message_id`**, so retries never create duplicates (acceptance test #5/#7).

---

## 3. Isolate the failure in 2 minutes — the DEBUG workflow

Import `docs/n8n/kian-whatsapp-ingest-debug.json`. It is **Manual Trigger → Fixed Test Payload →
Kian Portal Inbox → Inspect Response** — no WhatsApp involved. Set `N8N_WHATSAPP_INGEST_SECRET` in
n8n's environment first, then click **Execute Workflow** and read the response on **Inspect Response**:

| Response you see | Meaning | Fix |
|---|---|---|
| `200 {ok:true, message_inserted:true}` | ✅ End-to-end works. Problem was the **payload/expressions** in production. | Use the TEST workflow's Build Inbox Payload + HTTP nodes. |
| `200 {ok:true, message_inserted:false, duplicate:true}` | ✅ Works; you reused a `message_id`. | Change `message_id` in the Code node to test a fresh insert. |
| `401 unauthorized` | **Secret** wrong/missing. | Make n8n `N8N_WHATSAPP_INGEST_SECRET` exactly equal Vercel's value. |
| `500 ingest_not_configured` | Server has **no secret env**. | Set `N8N_WHATSAPP_INGEST_SECRET` in Vercel, redeploy. |
| `500 server_supabase_not_configured` | Server missing **service-role key**. | Set `SUPABASE_SERVICE_ROLE_KEY` in Vercel, redeploy. |
| `502 ingest_failed` | Reached Supabase but the **RPC failed** (migration not applied / signature). | Re-run `docs/whatsapp_inbox_RUNME.sql` (already fixed). |
| Connection/timeout error | **URL** wrong or site down. | Confirm `https://www.kianmedia.com/api/integrations/whatsapp/incoming`. |

This single test tells you whether the issue is URL / secret / payload / Vercel / Supabase — without
touching production.

> **n8n Cloud note:** `{{ $env.* }}` access is disabled by default on n8n Cloud. If `x-kian-ingest-secret`
> comes through empty (→ 401), either set the secret via **n8n Variables** (`{{ $vars.N8N_WHATSAPP_INGEST_SECRET }}`)
> or create a **Header Auth credential** (name `x-kian-ingest-secret`, value = the secret) and set the node's
> Authentication to *Generic → Header Auth*. Self-hosted n8n: set the env var in n8n's environment and it works as written.

---

## 4. The fixed Portal Inbox node (exact config)

Replace the broken **Kian Portal Inbox** node in your TEST copy with this (or import the TEST workflow and
copy its two nodes — **Build Inbox Payload** + **Kian Portal Inbox** — into the Sheets branch):

**Build Inbox Payload** — a *Code* node placed after your Google Sheets append, before the HTTP node.
Body is in the TEST file; it safely extracts `wa_id / phone / display_name / message_id / message_type /
body / timestamp / raw_payload`, iterates all messages, and emits nothing for status callbacks.

**Kian Portal Inbox** — *HTTP Request* node:
- **Method:** `POST`
- **URL:** `https://www.kianmedia.com/api/integrations/whatsapp/incoming`
- **Authentication:** `None`
- **Headers** (Send Headers = ON):
  - `Content-Type` = `application/json`
  - `x-kian-ingest-secret` = `={{ $env.N8N_WHATSAPP_INGEST_SECRET }}`  *(or `$vars` / Header-Auth credential — see Cloud note)*
- **Body:** Send Body = ON · Content-Type `JSON` · Specify Body = *JSON* · **JSON** = `={{ JSON.stringify($json) }}`
- **Settings → On Error:** `Stop Workflow` **while testing**; change to `Continue (regular output)` once green (non-blocking).
- **Settings → Always Output Data:** ON (so you can read the response).

**Final flow (TEST workflow):**
```
Webhook
 └─ IF Real WhatsApp Message
     ├─ TRUE ─┬─ Meta Auto-Reply (YOUR node) → Respond 200 (message)      [Branch A — unchanged]
     │        └─ Google Sheets Append (YOUR node) → Build Inbox Payload    [Branch B]
     │                                              → Kian Portal Inbox → Inbox Result
     └─ FALSE → Respond 200 (ignored)   [status callbacks: acknowledge only]
```
Branch A and Branch B run in parallel off the same IF=true output, so the **auto-reply never waits on the
portal**, and (once On Error = Continue) a portal outage cannot break the reply.

> The `Meta Auto-Reply` and `Google Sheets Append` nodes in the TEST file are **placeholders** — swap in
> your real, working nodes (I can't replicate your Meta token / sheet credentials). Their config is unchanged.

---

## 5. Required env / credentials

| Where | Name | Purpose |
|---|---|---|
| Vercel (already set) | `N8N_WHATSAPP_INGEST_SECRET` | Validates the `x-kian-ingest-secret` header. |
| Vercel (already set) | `SUPABASE_SERVICE_ROLE_KEY` | Lets the route call the ingest RPC. |
| **n8n** | `N8N_WHATSAPP_INGEST_SECRET` | Same value as Vercel — referenced by `{{ $env.* }}` / `{{ $vars.* }}` / Header-Auth credential. |
| n8n | Google Sheets credential | Re-select on the placeholder Sheets node (your existing one). |
| n8n | WhatsApp/Meta send credential | Stays on your existing auto-reply node — untouched. |

No secret values appear in these files or in this doc.

---

## 6. Test checklist (run on the TEST copy)

1. DEBUG workflow → `200 { ok:true, message_inserted:true }`.
2. Re-run DEBUG with the same `message_id` → `message_inserted:false, duplicate:true` (no duplicate).
3. TEST workflow: send a real WhatsApp text to the number → **auto-reply still arrives**.
4. Google Sheet still gets its row.
5. Kian Portal Inbox node output → `200 ok:true` (or `message_inserted:true`).
6. Conversation appears at `https://www.kianmedia.com/client-portal/admin/whatsapp`.
7. Send a 2nd message from the same number → same conversation, new message (no dup conversation).
8. Trigger a delivered/read status → FALSE branch returns 200, **no** new message row.
9. Owner sees a “WhatsApp” notification in `/client-portal/notifications`.

When 1–9 pass: set the Kian Portal Inbox node **On Error → Continue (regular output)**, then carefully
port the two new nodes into the LIVE workflow (or promote the tested copy) — **only after you approve.**

---

## 7. Rollback

- **n8n:** delete/disable the Kian Portal Inbox + Build Inbox Payload nodes, or re-import your backup
  `Kian WhatsApp - LIVE Production.json`. Auto-reply + Sheets are unaffected.
- **Site:** the `/client-portal/admin/whatsapp` page + notification-link change are additive; revert the
  branch commit to remove them. The ingest endpoint can stay (it just won't be called).
- **No Meta webhook URL change is required at any point**, so there is nothing to roll back there.
