# LEGACY EMAIL DEDUPLICATION AUDIT

**Scope:** every code path that can cause an email to be attempted, and the proof that
one business event cannot become two messages. Read
`docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md` first — this document is the *closure* of
its §5 and §6, not a restatement.

> **Standing fact.** Nothing in this repository can deliver an email today. The Apps
> Script `portal_notify` handler is not deployed, so every real attempt classifies as
> `relay_handler_missing`. "Deduplicated" below therefore means *cannot become two
> queued/attempted messages*, which is the property that survives the day the handler
> is finally deployed.

---

## 1) The five paths, before and after

| # | Path | Before | After | Dedupe mechanism now |
|---|---|---|---|---|
| D1 | `lib/server/projectNotify.ts` → `sendProjectEmail()` | server, queued, traced | **unchanged** | `email_deliveries.idempotency_key` partial unique (`global_notifications_core_batch10_RUNME.sql:30,74`) |
| D2 | `lib/server/custodyNotify.ts` | server, direct POST, no queue | **unchanged**, plus the new kill switch | none of its own — see §3 |
| D3 | `lib/server/hrNotify.ts` | server, direct POST, no queue | **unchanged**, plus the new kill switch | none of its own — see §3 |
| D4 | `app/api/integrations/rental/notify/route.ts` | server, direct POST | **unchanged**; queue branch still flag-OFF | request-level; the queue branch stays disabled on purpose |
| D5 | `lib/portal/notifyEmail.ts` → `postNotify()` | **browser, `no-cors`, public anonymous page** | **REMOVED** | replaced by `/api/comms/legacy-notify` → `comms_enqueue` → `comms_outbox.idempotency_key` |

D5 was the only path with *no* authentication, *no* record, *no* dedupe and *no* readable
result. It is the one this phase eliminated.

---

## 2) What replaced D5, precisely

```
browser helper (lib/portal/notifyEmail.ts)
      │  session Bearer, JSON, same-origin
      ▼
POST /api/comms/legacy-notify          ← authenticates, re-authorizes in the DB
      │                                   (comms_is_staff, run AS THE USER)
      ▼
observeInHub()  (lib/server/commsLegacyAdapter.ts)
      │  record-only: it never calls the legacy sender, so it can never be
      │  the second half of a double-send
      ▼
comms_enqueue → comms_outbox (idempotency_key, dry_run, R1/R2 trigger)
      ▼
/api/comms/process → commsDrain → MOCK provider (no network call exists)
```

**Five things the browser lost, all of them on purpose:**

1. **The relay address.** `SHEETS_ENDPOINT` is no longer imported by
   `lib/portal/notifyEmail.ts`. There is no fetch to a provider anywhere in browser code.
2. **The recipient.** The old payload carried a browser-chosen `To`. The route reads it
   only to record `legacy_to_discarded: true` and then throws it away; recipients come
   from `comms_resolve()`.
3. **`payload.direct`.** The resolver's `direct` array returns any user id the caller
   names, with `email_allowed = true` and no check of who that user is
   (audit §7). It cannot be set from a browser: the route never forwards it.
4. **Free-text events.** Five legacy event names map to five catalogue keys; anything
   else is refused with `unknown_legacy_event`.
5. **Anonymous access.** No token ⇒ the helper returns `suppressed_anonymous` **without
   making a request at all**. The route itself has no anonymous door.

### The opportunities page

`components/opportunities/OpportunityForm.tsx` no longer imports any notification
sender. Its two calls are gone. This is not a lost notification: the same submission
already notifies staff **server-side**, inside the RPC that writes the row —
`public.submit_opportunity_request()` calls `notify()` for the admins and for a matching
portal user (`docs/opportunities_notifications_addendum_RUNME.sql:59,70`).

`notifyOpportunityNew()` / `notifyOpportunityAck()` still exist as **refusing stubs**
returning `suppressed_server_side`. They make no network call under any session state.
They are kept rather than deleted so that re-adding the old call to a public page fails
loudly and visibly instead of silently reopening the hole.

---

## 3) The three surviving legacy senders (D2, D3, D4)

They are **not** browser paths: they run on the server, behind authenticated routes, and
each already has its own opt-out env flag. They were left alone deliberately — the brief
is finalization, and rewriting three working modules to gain nothing today is how a
regression is introduced.

What changed is that they can now all be stopped in **one** action:

```
COMMS_LEGACY_SENDERS_ENABLED=false
```

`lib/server/commsKillSwitch.ts` is consulted by `projectEmailEnabled()`,
`custodyEmailEnabled()` and `hrEmailEnabled()`. Its polarity is one-way: it can only turn
a sender **off**, never on, so setting it can never cause a send that was not already
possible. Unset, behaviour is byte-for-byte what it was.

**Residual risk, stated rather than hidden:** D2/D3/D4 write no queue row, so two rapid
identical requests to those routes produce two attempts. That was true before this phase
and is unchanged. It is bounded by the fact that each is reached only through an
authenticated staff action, and by the relay itself once the handler is deployed —
`docs/apps_script_portal_notify_HANDLER.gs` now dedupes on `IdempotencyKey` for six hours
and replays the prior acknowledgment instead of sending twice. Consolidating D2/D3/D4
onto the hub remains open work (task #46), and it must be done as a *move*, never as an
*addition*, or it becomes the sixth path.

---

## 4) The dedupe keys, and why they do not collide

| Producer | Key shape | Uniqueness |
|---|---|---|
| `notify_emit_event` (Batch 10) | `evt:<event>:<entity>:<user>` | partial unique on `email_deliveries.idempotency_key` |
| `pc_event_emit` (Batch 7) | none; sets `event_id` | composite unique `(event_id, recipient_id)` |
| `comms_enqueue` (hub) | `<event>:<entity>:<user>:<channel>` | partial unique `uq_comms_outbox_idem` |

The hub key includes the **channel**. Without it, queueing the portal leg would suppress
the email leg of the same event — a silent loss that looks exactly like a working dedupe.
With it, portal and email are separate rows and each is independently deduplicated.

The hub and the legacy queue are separate tables, so the same event *could* in principle
exist in both. It cannot in practice, for two enforced reasons:

1. **`notifyViaHubOrLegacy()` is mutually exclusive.** If the hub queued an email row
   (`queued_by_channel.email > 0`) the legacy sender is not called; in every other case
   the hub queued no email and the legacy sender runs unchanged. There is no branch in
   which both run (`lib/server/commsLegacyAdapter.ts`).
2. **The legacy mirror is read-only and unretryable.** `comms_adapter_import_legacy()`
   copies only **terminal** `email_deliveries` rows (`sent`/`failed`/`bounced`) for
   display, and `comms_retry()` refuses a mirrored row with
   `legacy_mirror_not_retryable`. A mirrored row can therefore never be re-sent from the
   hub. Both properties are asserted by the migration's own self-tests (§90, checks 13
   and 13b) and again by `tests/comms_safety_rules.test.js`.

---

## 5) The one path with no dedupe at all

`emitViaFallback()` in `lib/server/notifyEvent.ts:114-136`: when `notify_emit_event`
answers PGRST202 it loops recipients and calls `sendProjectEmail` directly — no queue
row, no key, no trace. Two clicks, two emails.

It is **left in place**. It exists so a notification is never lost when the SQL is not
applied, which is the normal state of this repository between a push and a migration.
The mitigation is the relay-side idempotency added in this phase: once the handler is
deployed, a repeat carrying the same `IdempotencyKey` is answered with the earlier
acknowledgment and no second message. Before deployment, nothing is delivered at all, so
the exposure is theoretical rather than live.

---

## 6) How this is kept true

`tests/comms_legacy_isolation.test.js` fails if any of these regress:

* a `no-cors` request, or any `SHEETS_ENDPOINT` fetch, reappears in browser code;
* `components/opportunities/OpportunityForm.tsx` imports a notification sender again;
* the legacy-notify route grows an anonymous door, or forwards `To` / `direct`;
* the opportunity helpers make a network call;
* a legacy sender loses the shared kill switch;
* the adapter stops being mutually exclusive.
