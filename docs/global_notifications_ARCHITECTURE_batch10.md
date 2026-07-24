# Kian Notifications — Canonical Architecture & Isolation Law (Batch 10, Phase 1)

This document is the **single source of truth** for how any Kian portal notification
travels from a business event to a portal inbox row and an email. It is the outcome
of the Phase 1 global audit and the contract every later phase (and every future
module) MUST follow. It exists so nobody ever again builds a second queue, a second
provider, or a per-module cron.

## 0. The one pipeline

```
business event (a row is written / a decision is made)
        │  (best-effort, AFTER the business row is committed — see §2)
        ▼
notification_resolve_recipients(event, entity_type, entity_id, project, actor, payload)
        │        → concrete recipients: user_id, email, role, reason,
        │          portal_allowed, email_allowed, action_url, locale, dedupe_key
        ├───────────────► notification_dispatch_portal(...)   → public.notifications   (INBOX)
        │                                                      → notification_delivery_log (TRACE: portal_created)
        └───────────────► notify_emit_event(...)              → public.email_deliveries (QUEUE, one row/recipient,
                                                                 idempotency_key = dedupe_key, correlation_id)
                                        │
                                        ▼
                          processQueue(exact delivery IDs)      ← immediate, in the same request (event-bound)
                                        │                       ← cron notify-email = retry/backlog FALLBACK only
                                        ▼
                          sendProjectEmail → Apps Script relay  (ONE provider; PORTAL_NOTIFY_ENDPOINT || SHEETS_ENDPOINT)
                                        │   provider confirmation via interpretRelayResponse (no false 'sent')
                                        ▼
                          email_deliveries.status = sent|failed|skipped|bounced
                          notification_delivery_log (TRACE: email_sent / email_failed + lifecycle)
```

### The canonical objects — do NOT create alternatives to these
| Concern            | Canonical object                                   | Introduced |
|--------------------|----------------------------------------------------|------------|
| Portal inbox       | `public.notifications`                             | project_core |
| Event outbox       | `public.notification_events`                       | project_core |
| **Email queue**    | `public.email_deliveries` (the ONLY queue)         | project_core |
| Delivery trace     | `public.notification_delivery_log`                 | 9C |
| Preferences        | `public.notification_preferences`                  | 9C |
| Cron telemetry     | `public.notification_cron_runs`                    | 9C |
| **Recipient resolver** | `notification_resolve_recipients(...)` (the ONLY resolver) | 9D |
| Portal dispatch    | `notification_dispatch_portal(...)`                | 9D |
| **Email enqueue**  | `notify_emit_event(...)` (canonical) · `nt_event_enqueue_internal` (review/preview, event-bound) | 10 / 9G |
| Worker             | `lib/server/notifyWorker.ts` `processQueue()`      | 9E–9G |
| Provider           | `sendProjectEmail` → Apps Script relay             | 9D–9E |
| **Dispatch helper**| `lib/server/notifyEvent.ts` `emitEventEmail()`     | 10 |

**Prohibited (from the brief):** no 3rd notifications table, no 2nd email queue, no
parallel email provider, no per-module cron, no mass send.

## 1. The business-action isolation law (Phase 1.3 — site-wide)

Every business action follows the Phase 0 shape, without exception:

1. **Verify** the caller may perform the action.
2. **Save** the operational row in its **own committed step**.
3. **Only after** the save is durable, attempt notifications **best-effort**.
4. A notification failure (resolve/enqueue/provider/worker) is **caught, logged, and
   reported to management** — it **never** rolls back the operational row and **never**
   turns a saved action into an error response.
5. HTTP is a success (200/207) whenever the operational action saved; 4xx/5xx are
   reserved for failures of the **action itself**.

The reference implementation is `app/api/integrations/project/review/route.ts`
(STEP A save → STEP B `emitEventEmail`-shaped best-effort). `emitEventEmail()` is the
reusable embodiment of STEP B.

## 2. Module inventory (Phase 1 audit result)

| Module / event source | Producer today | Inbox | Queue | Immediate process | Status |
|---|---|---|---|---|---|
| Quote request / appointment (**Golden Path**) | `submitForm` → Apps Script (external) | — | — (direct) | n/a | ✅ reliable — **do not touch** |
| Project core events | `pc_event_emit` trigger | ✅ | ✅ `email_deliveries` | cron only → **gap** | needs event-bound process |
| Client review decision | route STEP A/B (Phase 0) | ✅ | ✅ | ✅ event-bound | ✅ done (Phase 0) |
| Deliverable preview sent | preview route (9G) | ✅ | ✅ | ✅ event-bound | ✅ done (9G) |
| Deliverable download receipt | `deliverable-download` → `sendProjectEmail` **direct** | — | ❌ **bypasses queue** | direct | **fragmented** → route via pipeline |
| Custody inventory notify | `custody-inventory/notify` → `sendHrEmail` **direct** | partial | ❌ **bypasses queue** | direct | **fragmented** → route via pipeline |
| HR task assign / notify | `hr/tasks/assign`, `hr/notify` → `sendHrEmail` **direct** | partial | ❌ **bypasses queue** | direct | **fragmented** → route via pipeline |
| Rental lifecycle | `pc_event_emit` / resolver rental branch | ✅ | ✅ | cron only → **gap** | needs event-bound process |

**Direct-send bypass** = resolves recipients then calls a sender synchronously in the
request. It "works" (immediate) but has no queue row, no retry, no trace, no backlog
visibility — so a single relay hiccup silently loses the email. Converting these to the
pipeline keeps the immediate send **and** adds durability/retry/trace.

## 3. Gap register (closed across Phases 2–10)

- **G1 — resolution duplication.** `nt_event_enqueue_internal` resolves recipients with
  its own inline UNION instead of `notification_resolve_recipients`. *(Phase 2: the new
  canonical `notify_emit_event` uses the resolver; review/preview keep their proven path
  and may migrate later.)*
- **G2 — direct-send bypass.** deliverable-download / custody / hr send outside the
  queue. *(Phase 3–6: route through `emitEventEmail`.)*
- **G3 — cron-only processing.** Non-review events wait for the daily cron. *(Phase 3–7:
  event-bound `processQueue` after each event; cron stays as fallback retry.)*
- **G4 — preferences not consulted.** Resolver hardcodes `email_allowed=true`. *(Phase 8:
  consult `notification_preferences`, but management/mandatory events are never blocked.)*
- **G5 — backlog.** Hundreds of historical `pending` rows. *(Phase 10: classify — recent
  eligible after preview / old expired / duplicate suppressed / critical manual retry.
  Never a mass blind send.)*

`entity_access` from the brief's recipient contract is satisfied structurally: the
resolver only ever returns recipients who already have access to the entity (by
membership, role, client-list, or contract), so every returned row is access-true.
