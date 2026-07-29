# NOTIFICATIONS — CURRENT STATE AUDIT (pre-Communications-Hub)

**Date:** 2026-07-30 · **HEAD at audit:** `1f0faff` · **Method:** static read of the repo only.
No database was queried, no email was sent, no external call was made. Every claim below is
anchored to `file:line`. Where I could not prove something from the repo I say so instead of
guessing — the owner has already paid for two cycles of forged "sent" signals.

> **The one-line summary.** The internal machinery is real and good. The *delivery* is not.
> Email has never left the building, because the only mail relay the platform has
> (a Google Apps Script Web App) does not contain the handler the platform requires, and
> that file lives in the owner's Google account where no code in this repo can reach it.

---

## 1) Inventory — what exists today

### 1.1 Storage (5 objects, 3 different generations)

| Object | Defined at | Purpose | Generation |
|---|---|---|---|
| `public.notifications` | `docs/phase0_migration.sql:74` | portal inbox (per-recipient rows) | Phase 0 |
| `public.notification_preferences` | `docs/phase0_migration.sql:66` | one global triple per user | Phase 0 |
| `public.notification_events` | `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1938` | event outbox | Batch 7 |
| `public.email_deliveries` | `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1960` | **the** email queue | Batch 7 |
| `public.notification_delivery_log` | `docs/notifications_e2e_repair_batch9d_RUNME.sql:64` | per-recipient trace (telemetry) | Batch 9D |

### 1.2 Resolution & dispatch (SQL)

| Function | Defined at | Role |
|---|---|---|
| `notification_resolve_recipients` | `docs/notifications_e2e_repair_batch9d_RUNME.sql:147` | the single recipient resolver |
| `notification_dispatch_portal` | `docs/notifications_e2e_repair_batch9d_RUNME.sql:264` | writes portal rows, **has** a `p_audience` filter |
| `notify_emit_event` | `docs/global_notifications_core_batch10_RUNME.sql:42` | central email enqueue, idempotency key = dedupe key |
| `pc_event_emit` | `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1994` | older Batch-7 emitter, still installed |
| `civ_rental_enqueue_email` | `docs/email_backbone_phase1_rental_RUNME.sql:163` | rental-only enqueue, **flag-gated off** |
| `pc_notify_monitor_v2` | `docs/notifications_recovery_batch9c_RUNME.sql:101` | monitor read model |
| `notification_trace` | `docs/notifications_e2e_repair_batch9d_RUNME.sql:93` | telemetry writer |

### 1.3 Sending (TypeScript)

| Module | Entry | Path |
|---|---|---|
| `lib/server/notifyEvent.ts:143` | `emitEventEmail()` | enqueue → drain exact IDs (the canonical one) |
| `lib/server/notifyWorker.ts:215` | `processQueue()` | claim / lease / backoff / reap |
| `lib/server/projectNotify.ts:104` | `sendProjectEmail()` | the one provider call |
| `lib/server/custodyNotify.ts` | direct relay POST | legacy, bypasses the queue |
| `lib/server/hrNotify.ts` | direct relay POST | legacy, bypasses the queue |
| `app/api/integrations/rental/notify/route.ts:186` | direct relay POST | legacy, bypasses the queue |
| `lib/portal/notifyEmail.ts:57` | `postNotify()` | **browser**, `mode:"no-cors"` (`:62`) — unverifiable |
| `lib/server/whatsappInternalAlert.ts:19` | Meta Cloud API | staff alerts, **off by default** |

### 1.4 Surfaces

* Portal inbox: `components/portal/NotificationsView.tsx`, `lib/portal/notifications.ts`.
* Admin monitor: `components/portal/projectcore/NotifyMonitor.tsx` — **inside the frozen
  project-platform tree** (`tests/fixtures/project_platform_freeze.json`), so it cannot be
  extended by this or any later phase. Any new admin surface must be independent.
* Preferences: `lib/portal/account.ts:32,42` (read/patch of the Phase-0 triple).

---

## 2) What actually WORKS

Judged as "the code does what its comments claim, end to end, without an external step".

1. **Portal notifications.** Rows are written server-side, RLS-scoped to the recipient,
   read/marked by `lib/portal/notifications.ts:9-42`. The unread badge deliberately counts
   only personally-targeted rows (`:14-25`). This works and is the only channel that has
   ever demonstrably reached a human.
2. **The queue's mechanics.** `lib/server/notifyWorker.ts` is genuinely careful:
   atomic claim `pending→processing` (`:103`), a processing *lease* so an in-flight row is
   never double-sent (`:104`), attempt burned **at claim time** (`:102`, with the reasoning
   at `:94-101`), exponential backoff `5·2^attempts` (`:157`), `MAX_ATTEMPTS=5` (`:25`),
   a reaper for expired leases (`:184`), and a backlog cutoff that refuses to mass-blast old
   rows (`:27`, `:260`).
3. **Provider honesty.** `interpretRelayResponse()` (`lib/server/projectNotify.ts:70`)
   refuses to treat HTTP 200, an opaque body, or even a generic `{"ok":true}` as delivery
   (`:96-100`). Only a reply tagged `handler:"portal_notify"` with `sent>0` counts. This is
   the single most valuable thing in the current system and the hub must not weaken it.
4. **Idempotency, where it is used.** `notify_emit_event` writes
   `idempotency_key = "<event>:<entity>:<user>"` and inserts with
   `on conflict (idempotency_key) where idempotency_key is not null do nothing`
   (`docs/global_notifications_core_batch10_RUNME.sql:74-76`), matching the partial unique
   index at `:30`. Re-pressing a button does not create a second row.
5. **Business-action isolation.** Callers save first and notify best-effort; `emitEventEmail`
   never throws (`lib/server/notifyEvent.ts:143-192`). A mail problem cannot roll back work.
6. **Channel-condition deferral.** `disabled` / `no_endpoint` / `relay_handler_missing` keep
   the row `pending` and *hand the attempt back* (`lib/server/notifyWorker.ts:139-152`), so
   an undeployed relay cannot dead-letter the whole queue. This is why the backlog is
   recoverable rather than destroyed.

---

## 3) What is CODE-READY but has never delivered

**Email. All of it.** Not "some events" — the entire channel.

* The relay is a Google Apps Script Web App (`lib/submitForm.ts:6` `SHEETS_ENDPOINT`,
  overridable by `PORTAL_NOTIFY_ENDPOINT`).
* Every portal notification posts `_type:"portal_notify"`
  (`lib/server/projectNotify.ts:123`).
* The deployed script has **no `portal_notify` branch**. The evidence is in-repo and
  specific: the handler that *would* satisfy the contract exists only as a paste-ready file,
  `docs/apps_script_portal_notify_HANDLER.gs`, and the sender's own comment records a live
  probe of the deployed Web App answering `{"ok":true,"message":"Kian Media forms API is
  live"}` — a health banner, not a send receipt (`lib/server/projectNotify.ts:96-99`).
* Consequence: every send returns `relay_handler_missing`, the row is deferred 30 minutes
  and stays `pending` forever (`lib/server/notifyWorker.ts:139-141`). Nothing is lost.
  Nothing is delivered either.

Also code-ready and dark:

* **Rental queue path** — `civ_rental_enqueue_email` exists but
  `custody_inventory_settings.rental_email_queue_enabled` defaults `false`
  (`docs/email_backbone_phase1_rental_RUNME.sql:56`), so the route takes the *direct* branch
  (`app/api/integrations/rental/notify/route.ts:177`). Deliberate; must stay off.
* **WhatsApp** — `lib/server/whatsappInternalAlert.ts:19` requires
  `WHATSAPP_INTERNAL_ALERTS_ENABLED === "true"` plus live Meta credentials. Internal staff
  alerts only. There is no customer-facing WhatsApp notification path at all.
* **The three `pending` SQL packages.** `notifications_recovery_batch9c_RUNME.sql`,
  `notifications_e2e_repair_batch9d_RUNME.sql`, `global_notifications_*_batch10_RUNME.sql`
  are written and self-testing. Whether they are applied to production **cannot be
  determined from this repo** — the memory notes disagree with each other on exactly this
  point. The hub therefore feature-detects every one of them rather than assuming.

---

## 4) Steps only a human can perform (external blockers)

| # | Step | Where | Why no code can do it |
|---|---|---|---|
| B1 | Paste `docs/apps_script_portal_notify_HANDLER.gs` into the Apps Script project and **Deploy → Manage deployments → New version** | script.google.com, owner's Google account | No credentials in the repo; deploying is explicitly prohibited for this phase |
| B2 | Confirm Vercel env: `PORTAL_NOTIFY_ENDPOINT`, `PROJECT_EMAIL_ALERTS_ENABLED ≠ "false"`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` | Vercel dashboard | Secrets |
| B3 | Run the pending SQL packages in the Supabase SQL editor | Supabase | Running SQL is prohibited for this phase |
| B4 | Gmail send quota: 100/day personal, 1500/day Workspace | Google | Hard external ceiling; a burst above it fails *silently at the relay* |
| B5 | Vercel Hobby cron is **daily** (`vercel.json` → `10 3 * * *`) | Vercel | Retry latency is therefore up to 24h unless an external scheduler calls the route |

---

## 5) Duplicated paths

Five independent pieces of code POST the *same* `_type:"portal_notify"` shape to the *same*
endpoint, with five different bodies, three different enable-flags and two different
opposite defaults:

| # | Path | Enable flag | Queue? | Trace? |
|---|---|---|---|---|
| D1 | `lib/server/projectNotify.ts:104` | `PROJECT_EMAIL_ALERTS_ENABLED` (opt-**out**) | yes | yes |
| D2 | `lib/server/custodyNotify.ts:47` | `CUSTODY_EMAIL_ALERTS_ENABLED` (opt-out) | no | no |
| D3 | `lib/server/hrNotify.ts:34` | `HR_EMAIL_ALERTS_ENABLED` (opt-out) | no | no |
| D4 | `app/api/integrations/rental/notify/route.ts:186` | `CUSTODY_EMAIL_ALERTS_ENABLED` | no | no |
| D5 | `lib/portal/notifyEmail.ts:57` | none | no | no — and **no-cors, so the result is unreadable by construction** |

D5 is the worst of the five and it is still wired to live UI:
`components/portal/AdminStaff.tsx:213` (`notifyStaffAssigned`) and
`components/opportunities/OpportunityForm.tsx:82` (`notifyOpportunityNew` /
`notifyOpportunityAck`, on the **public anonymous** page). These fire from the browser, can
never be confirmed, are never recorded anywhere, and — on the public page — hand an
unauthenticated visitor a direct POST to the mail relay. There is no rate limit on it.

Two further duplications:

* **Two emitters.** `pc_event_emit` (Batch 7) and `notify_emit_event` (Batch 10) both
  enqueue into `email_deliveries`. `pc_event_emit` sets `event_id`; `notify_emit_event`
  does not.
* **Two dedupe mechanisms that do not overlap.** `email_deliveries` has
  `unique (event_id, recipient_id)` (`docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1977`)
  **and** a partial unique on `idempotency_key`. Canonical Batch-10 rows leave `event_id`
  NULL, so the composite constraint protects nothing for them; legacy `pc_event_emit` rows
  leave `idempotency_key` NULL, so the partial index protects nothing for those. Each row is
  covered by exactly one of the two, never both.

---

## 6) Where a double-send can happen

Ranked by how easily it could actually occur.

1. **`emitViaFallback` sends directly, with no dedupe at all.**
   `lib/server/notifyEvent.ts:114-136`. When `notify_emit_event` answers PGRST202 the helper
   loops recipients and calls `sendProjectEmail` per address — no queue row, no idempotency
   key, no trace. Two clicks on the same button = two emails. This is a deliberate
   "never lose the notification" net, but it is the one path in the system with **zero**
   duplicate protection.
2. **Rental, if the flag is ever flipped.** Flipping `rental_email_queue_enabled` to true
   moves the route to the queue branch (`.../rental/notify/route.ts:158-175`) — but any
   producer that also calls the canonical resolver for a `rental.*` event enqueues under a
   *different* key shape (`rental:<event>:…` vs `evt:<event>:<entity>:<user>`, see the key
   parser at `lib/server/notifyWorker.ts:73-76`). Two keys ⇒ two rows ⇒ two emails.
   **This is the concrete reason the flag must stay off.**
3. **Browser + server for the same action.** `AdminDeliverables.tsx:66-67` calls
   `emitProjectDeliverableEvent` (server route, queued, deduped) while `AdminStaff.tsx:213`
   still uses the browser no-cors path for assignment. If a server-side assignment
   notification is ever added without removing D5, both fire.
4. **`sent_unconfirmed`.** `lib/server/notifyWorker.ts:127-131` — the relay accepted but the
   status PATCH failed. The code is honest about it: at-least-once, bounded by
   `MAX_ATTEMPTS`. A redelivery is possible and *accepted*, not a defect.
5. **Concurrent workers.** Guarded properly by the atomic claim (`:103`) and lease. Not a
   real risk.

---

## 7) Safety gaps — client isolation and internal content

These matter most, because the hub's two hard rules are exactly here.

* **The email path has no audience filter.** `notification_dispatch_portal` takes
  `p_audience` (`docs/notifications_e2e_repair_batch9d_RUNME.sql:268-276`). `notify_emit_event`
  does **not** — it filters only on `r.email_allowed is true`
  (`docs/global_notifications_core_batch10_RUNME.sql:69`). Portal has the guard; email does
  not.
* **The resolver's `direct` array is an open door.** Branch (7),
  `docs/notifications_e2e_repair_batch9d_RUNME.sql:247-266`: any caller may pass
  `payload.direct = [{user_id, reason}]` and the resolver returns that user with
  `portal_allowed=true, email_allowed=true` — with **no check of who that user is**. Passing
  a client's uuid on an internal event (`risk.critical_raised`, `deliverable.download_recorded`)
  emails the client. The client allow-list at branch (5) is bypassed entirely. Nothing in
  the current code stops this; only caller discipline does.
* **Client-facing events are a hard-coded 3-element list** at `:154-155`
  (`deliverable.preview_sent`, `deliverable.final_ready`, `project.delivery_recorded`).
  It is not data, so it cannot be reviewed, audited or extended without a migration, and
  the `NOTIFICATION_EVENT_CONTRACT.md` catalogue (which marks far more events "+ العميل")
  does not agree with it.
* **No financial-content rule exists in code anywhere.** The rental route documents that its
  body is composed in SQL so it *cannot* leak cost/margin
  (`.../rental/notify/route.ts:150-156`) — good, but that is one route. The project path
  passes `p_body` as free TypeScript text straight through `notify_emit_event`. Nothing
  inspects it.
* **Preferences are decorative on the email channel.** Every branch of the resolver returns
  the literals `true, true` for `portal_allowed, email_allowed`
  (`:171`, `:193`, `:202`, `:211`, `:220`, `:231`, `:253`). `notification_preferences` is
  never read by the canonical path — and its `email_enabled` default is `false`
  (`docs/phase0_migration.sql:69`), so if it *were* honoured, email would be off for
  everyone. It is also one global triple with no per-category granularity. Batch 10 recorded
  this as deferred item G4; it is still open.

---

## 8) Capability gaps against a real communications system

| Requirement | Today |
|---|---|
| States `queued/processing/sent/delivered/failed/retrying/dead_letter/cancelled` | applied CHECK is `pending/processing/sent/failed/skipped/bounced` (`project_core_ABSOLUTE_FINAL_RUNME.sql:1970`). `retrying`/`dead_letter` are **derived for display only** (`notifyWorker.ts:17-20`); `delivered` and `cancelled` do not exist |
| Cancel before send | **absent** |
| Manual retry | partial — `pcEmailRetry` exists but only inside the **frozen** monitor |
| Dead-letter queue | derived, not a queue; no reprocessing surface |
| Message preview | **absent** |
| Templates / versioning / EN | **absent**. Subjects are Arabic string literals in TS maps: `app/api/integrations/rental/notify/route.ts:26-42`, `lib/server/hrNotify.ts:49-63` |
| Provider response metadata | only `provider_message_id`; the body is discarded |
| Correlation id | canonical path only; D2–D5 have none |
| Per-category preference centre | **absent** (one global triple) |
| Rate limiting on notifications | **absent**. `lib/server/rateLimit.ts` exists and is honest about being per-instance memory (`:12-18`) but is not applied to any notification path |
| Audit of sensitive comms actions | **absent** (telemetry ≠ audit; `notification_delivery_log` records deliveries, not who retried/cancelled/changed a flag) |
| Independent admin dashboard + export | **absent** — the only monitor is frozen |
| Feature flag per channel | env vars per *module*, with inconsistent defaults; not per channel, not runtime-changeable |

---

## 9) What the hub must therefore do (and must not)

**Compose, do not replace.** Keep `notifications` as the portal inbox, keep
`email_deliveries` as the legacy email queue, keep `notification_resolve_recipients` as the
recipient authority when it is present, and keep `interpretRelayResponse` as the delivery
verdict. Add the missing layer above them: catalogue, templates, unified outbox with the
full state machine, preferences, rate limit, audit, and an independent dashboard.

**Do not** create a second recipient resolver, a second provider, or a second cron.
**Do not** touch the frozen project-platform tree.
**Do not** enable the rental queue flag.
**Do not** send anything: the hub ships with every channel `dry_run` and the email channel
disabled, and the provider layer is a mock that records the exact payload and signature it
*would* have sent.

**Assume nothing about production.** Every new surface feature-detects and renders
«الميزة بانتظار تفعيل قاعدة البيانات» rather than crashing, because the owner pushes code
before running SQL.

---

## 10) Confidence and limits of this audit

* Everything in §§1–8 is read from the working tree at `1f0faff` and cited.
* **Not verified:** which SQL packages are actually applied to production; whether the Apps
  Script currently contains *any* handler; whether `notification_preferences` has real rows.
  These need a live read the rules of this phase forbid.
* **Explicitly not asserted:** that any email has ever been delivered. I found no evidence in
  this repo that one has, and I found a documented live probe suggesting none has.
