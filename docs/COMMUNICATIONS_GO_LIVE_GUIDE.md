# COMMUNICATIONS HUB — GO-LIVE GUIDE

**Current state: the hub is installed-ready and completely inert.**
Every channel ships `dry_run = true`. Email and WhatsApp ship **disabled**. The provider is
a mock with no network call in it. The Apps Script relay handler is **not deployed**.

Nothing in this phase sends. This guide is the ordered path from *inert* to *live*, and it
is deliberately slow: each step is separately reversible and each has a way to prove it
worked rather than a way to assume it did.

---

## Stage 0 — What is on disk right now

| Piece | Path |
|---|---|
| Audit of the pre-existing system | `docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md` |
| SQL package | `docs/communications_hub_{PREFLIGHT,RUNME,POSTCHECK,ROLLBACK}.sql` |
| Enqueue + drain (server) | `lib/server/commsHub.ts` |
| Provider (mock) + wire contract | `lib/server/commsProvider.ts` |
| Legacy adapter (mutually exclusive) | `lib/server/commsLegacyAdapter.ts` |
| Drain endpoint | `app/api/comms/process/route.ts` |
| Browser client | `lib/portal/comms.ts` |
| Admin dashboard | `components/portal/CommunicationsHub.tsx` |
| Preference centre | `components/portal/CommsPreferences.tsx` |
| Page | `app/client-portal/communications/page.tsx` |
| Provider contract | `docs/EMAIL_PROVIDER_CONTRACT.md` |
| Relay deployment | `docs/APPS_SCRIPT_DEPLOYMENT_GUIDE.md` |

The code is safe to deploy **before** the SQL. Every surface feature-detects and renders
«الميزة بانتظار تفعيل قاعدة البيانات» instead of crashing.

---

## Stage 1 — Install the schema (no behaviour change)

1. Run `docs/communications_hub_PREFLIGHT.sql`. Read the notices. In particular record the
   `LEGACY BASELINE` line: the `email_deliveries` status counts.
2. If the 42P13 check lists any pre-existing `comms_*` function with a different return
   type, drop that function first. Replacing a return type aborts a migration mid-way and
   has already cost this project two production cycles.
3. Run `docs/communications_hub_RUNME.sql`. It is transactional: it either fully applies or
   fully rolls back. It ends with `COMMUNICATIONS HUB SELF-TEST PASSED`.
4. Run `docs/communications_hub_POSTCHECK.sql`. Every check must read `PASS`. Compare
   `LEGACY AFTER` with the baseline from step 1 — **they must be identical**. The hub never
   writes to `email_deliveries`.

**After Stage 1 nothing has changed operationally.** No producer calls the hub yet, and even
if one did, the email channel is disabled.

**Rollback:** `docs/communications_hub_ROLLBACK.sql`, but read its header first — it
destroys the outbox, the audit trail and every user preference. The gentler option is
disabling the channels, which the file documents.

---

## Stage 2 — Look at it (still inert)

> **The page has no navigation entry yet — reach it by URL.** `components/portal/nav.ts`
> was being edited by a concurrent batch when this module landed, and racing another agent
> on a shared file is how a nav registry loses a tab. Adding it is a two-line, additive
> change whenever the file is quiet:
> ```ts
> communications: { href: "/client-portal/communications", ar: "مركز الاتصالات", en: "Communications",
>                   adminAr: "مركز الاتصالات", adminEn: "Communications" },
> ```
> then add `"communications"` to the `admin`, `super_admin` and `manager` sets only.
> Do **not** add it to a client or lead set: the dashboard is staff-only, and the database
> refuses a client even on a direct URL (`comms_can_view()`), but a visible tab that always
> errors is a bad experience and a bad signal.

1. Open `/client-portal/communications` as an owner or manager.
2. The board should show zero rows, all three channel flags, and the read-only legacy queue
   summary beside the hub's own counters.
3. Use **معاينة رسالة** to render a template in Arabic and in English, and for the internal
   and client scopes. Confirm the client-scoped body carries no amounts and no internal ids.
4. Optionally press **استيراد عرض الطابور القديم**. This mirrors only *terminal*
   `email_deliveries` rows for visibility. Live legacy rows are deliberately not copied and
   mirrored rows can never be retried from the hub — `comms_retry` refuses them by design,
   because retrying a mirror is the classic double-send.

---

## Stage 3 — Wire one producer, portal channel only

Pick **one** low-stakes internal event. Suggested: `deliverable.download_recorded`.

1. In the producing route, after the business row is committed, call
   `observeInHub(...)` from `lib/server/commsLegacyAdapter.ts`. That is record-only: it
   never sends and never calls the legacy sender, so the existing behaviour is unchanged.
2. Perform the action. A `portal` row should appear on the board with status
   «محاكاة — لم يُرسل فعليًا».
3. Perform the **same** action again. There must be **no** second row: the idempotency key
   `<event>:<entity>:<user>:<channel>` suppresses it and `duplicates_suppressed` increments.
4. Perform the action as a client account on a client-visible entity. Confirm the board
   shows an increment under **مُنعت لحماية العميل** for any internal event, and check
   `public.comms_audit` for `recipient_blocked_r1` / `content_blocked_r2`.

Do not proceed until step 3 and step 4 both behave.

---

## Stage 4 — Deploy the Apps Script handler

Follow `docs/APPS_SCRIPT_DEPLOYMENT_GUIDE.md` in full, including the **negative test**
(deploy a version without the handler and confirm the system reports
`relay_handler_missing` rather than success).

⚠️ Do this on a different day from Stage 5. One variable at a time.

Success criterion for this stage is *not* "an email arrived from the hub" — the hub's email
channel is still off. It is: the existing legacy path stops reporting
`relay_handler_missing`.

---

## Stage 5 — Replace the mock provider

1. Implement the marked branch in `deliver()` (`lib/server/commsProvider.ts`). Follow
   `docs/EMAIL_PROVIDER_CONTRACT.md` §6 exactly. Change nothing else.
2. Keep `classifyRelayBody()` as the verdict. Never branch on `res.ok`.
3. Deploy. The channel is still disabled, so still nothing sends.

---

## Stage 6 — Enable email, one recipient, one event

1. On the board, take **email** out of dry-run **first**, while it is still disabled.
   Nothing happens — this only proves the two flags are independent.
2. Set `comms_event_catalog.channels` for your single test event to `array['email']` and
   confirm the only recipient is yourself.
3. Enable the **email** channel.
4. Trigger the event once. Then:
   * the row must reach `sent` with `dry_run = false`, a `provider_message_id`, and
     `ack: true` in `provider_response`;
   * `sent_live` on the board must increment by exactly 1;
   * the mail must actually be in your inbox. **If the row says sent and the inbox is
     empty, stop and treat it as a Sev-1** — that is the forged-success failure mode this
     entire design exists to prevent.
5. Trigger it again. There must be no second message.

---

## Stage 7 — Widen, slowly

* One event category per deployment. Watch `dead_letter` and
  `blocked_external_total` after each.
* Add the drain to `vercel.json` only now:
  ```json
  { "path": "/api/comms/process", "schedule": "30 3 * * *" }
  ```
  Adding it earlier would exercise a dark path daily for no reason. Note the platform is on
  a **daily** Hobby cron, so retry latency is up to 24 h unless an external scheduler calls
  the route with `CRON_SECRET`.
* Only after several quiet weeks consider moving a legacy producer from `observeInHub` to
  `notifyViaHubOrLegacy`. That adapter is mutually exclusive by construction: if the hub
  queues an email row it owns the email and the legacy sender is not called; otherwise the
  legacy sender runs unchanged. There is no branch in which both run.

---

## Things that must NOT be done as part of going live

| Do not | Why |
|---|---|
| Flip `custody_inventory_settings.rental_email_queue_enabled` to `true` | The rental route and any resolver-based producer enqueue under two different idempotency-key shapes → two rows → two emails (`docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md` §6.2) |
| Retry a mirrored legacy row from the hub | It reports what the old queue already did. `comms_retry` refuses; do not work around it |
| Enable WhatsApp | There is no customer-facing provider. The placeholder returns `whatsapp_not_implemented` |
| Enable the email channel and deploy the relay handler on the same day | Two variables, one signal |
| Add a second cron, a second queue, or a second resolver | The audit's §5 duplication is the problem this hub exists to stop growing |
| Trust an HTTP 200 | Only `handler:"portal_notify"` with `sent > 0` counts |

---

## Environment variables

| Name | Required for | Notes |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | enqueue + drain | server only, never in the browser |
| `CRON_SECRET` | the drain endpoint | reuses the existing secret; no new one is introduced |
| `PORTAL_NOTIFY_ENDPOINT` | Stage 5+ | overrides `SHEETS_ENDPOINT` |
| `PORTAL_PUBLIC_URL` | deep links | defaults to `https://www.kianmedia.com` |
| `COMMS_RELAY_SIGNING_SECRET` | optional | must match the Apps Script property `KIAN_PORTAL_NOTIFY_SECRET` |
| `COMMS_LEGACY_SENDERS_ENABLED` | optional kill switch | `false` stops the project, custody/rental and HR senders in one action. One-way: it can only disable, never enable |
| `COMMS_LEGACY_RELAY_ENABLED` | optional | asking `/api/comms/legacy-notify` for a real relay. There is no real provider, so it answers `provider_unavailable` — it exists so the intent is visible, not so it sends |
| `NEXT_PUBLIC_COMMS_LEGACY_NOTIFY_ENABLED` | optional | `false` makes the browser helpers inert (`disabled`) without touching any caller |

The hub introduces **no new required environment variable**. Absent optional ones simply
mean unsigned payloads and the default public base.

### The browser can no longer reach the relay

Before this phase, `lib/portal/notifyEmail.ts` posted straight at the Apps Script from the
browser — including from the **public, anonymous** opportunities page. That path is gone.
The helpers now post to `/api/comms/legacy-notify`, which authenticates, re-authorizes in
the database, discards any caller-chosen recipient, and records the event through the hub.
Full detail, including what each old caller does now, is in
`docs/LEGACY_EMAIL_DEDUPLICATION_AUDIT.md`.

Going live therefore does **not** require touching that route: it cannot send, whatever the
channel flags say.

---

## Rollback at any stage

| Stage | Undo |
|---|---|
| 6–7 | Disable the channel on the board. Queued rows stay queued; nothing is lost |
| 5 | Revert `deliver()` to `mockSend`. One function |
| 4 | Redeploy the previous Apps Script version |
| 3 | Remove the `observeInHub` call. The business action never depended on it |
| 1–2 | `docs/communications_hub_ROLLBACK.sql` — read its header; it destroys the audit trail |

The pre-hub notification system is untouched at every stage. Removing the hub does not
remove a message from the legacy path, and does not send one either.
