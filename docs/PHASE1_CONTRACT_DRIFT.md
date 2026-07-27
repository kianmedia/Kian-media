## CONTRACT DRIFT AUDIT — `docs/NOTIFICATION_EVENT_CONTRACT.md`

The contract declares its catalog at `docs/NOTIFICATION_EVENT_CONTRACT.md:74-103` (30 events) and calls it "مغلق، لا قيم حرّة" (closed, no free values) at `:115`.

---

## A. CONTRACT EVENTS → PRODUCER STATUS

**3 of 30 have a real producer. 27 are dead contract entries.**

| # | Contract event (line) | Producer? | Evidence |
|---|---|---|---|
| 1 | `project.created` (:74) | **NOT WIRED** | Only an `activity_log` action string: `docs/phase0_migration.sql:660`, `docs/PORTAL_ROADMAP.md:636`. `log_activity` writes to `public.activity_log` (`docs/phase0_migration.sql:58-63`), never to notifications. |
| 2 | `project.status_changed` (:75) | **NOT WIRED** | `activity_log` only (`docs/phase0_migration.sql:663`). Real producer uses a *different* name: `pc_event_emit(..., 'project_status_changed', ...)` at `docs/project_governance_batch5b_RUNME.sql:880`, `docs/project_governance_batch5c_RUNME.sql:641,920,975,1237`. |
| 3 | `project.on_hold` (:76) | **NOT WIRED** | Zero hits outside the contract line. |
| 4 | `project.resumed` (:77) | **NOT WIRED** | Zero hits outside the contract line. |
| 5 | `project.closed` (:78) | **NOT WIRED** | Zero hits. Closure emits `'project_status_changed'` (`docs/project_governance_batch5c_RUNME.sql:920`). |
| 6 | `project.member_assigned` (:79) | **NOT WIRED** | Only a *catalog comment + smoke-test array*: `docs/global_notifications_projects_batch10_RUNME.sql:18,35`. No emitter. |
| 7 | `project.member_removed` (:80) | **NOT WIRED** | Zero hits outside the contract line. |
| 8 | `project.delivery_recorded` (:81) | **NOT WIRED** | Accepted by the route allowlist (`app/api/integrations/project/notify/route.ts:27`), branched on in SQL (`docs/event_bound_email_dispatch_batch9g_RUNME.sql:172`), client-facing in the resolver (`docs/notifications_e2e_repair_batch9d_RUNME.sql:155`) — but **no caller can send it**: the only client of that route, `emitProjectDeliverableEvent`, types its `event` param as `"deliverable.preview_sent" \| "deliverable.final_ready"` (`lib/portal/notifyEmail.ts:38`). Infrastructure with no trigger. |
| 9-11 | `session.created/updated/cancelled` (:82-84) | **NOT WIRED** | Zero hits. Nearest real emitters use other names: `'shoot_tomorrow'` (`docs/project_core_ABSOLUTE_FINAL_RUNME.sql:2103`), `'meeting_soon'` (`:2123`). |
| 12 | `task.due_soon` (:85) | **NOT WIRED** | Zero hits. Real emitter: `'task_due_reminder'` (`docs/project_core_ABSOLUTE_FINAL_RUNME.sql:2079`). |
| 13 | `task.overdue` (:86) | **NOT WIRED** | All non-contract hits are JS property reads `task.overdue` (`components/portal/projectcore/ProjectTasks.tsx:255`, `ProjectTasksBoard.tsx:142`) — not event names. |
| 14 | `deliverable.uploaded` (:87) | **NOT WIRED** | `activity_log` action (`docs/phase0_migration.sql:603`) + a UI label map (`lib/portal/timeline.ts:15`). No notification producer. |
| 15 | `deliverable.internal_review_requested` (:88) | **NOT WIRED** | Zero hits outside the contract line. |
| 16 | **`deliverable.preview_sent`** (:89) | ✅ **WIRED** | `components/portal/AdminDeliverables.tsx:66,176`, `EditorDeliverables.tsx:46,106`, `projectcore/ProjectModules.tsx:217` → `emitProjectDeliverableEvent` (`lib/portal/notifyEmail.ts:38`) → `POST /api/integrations/project/notify` (`route.ts:27` allowlist) → `deliverable_preview_enqueue_notifications` (`docs/event_bound_email_dispatch_batch9g_RUNME.sql:158`) → `nt_event_enqueue_internal` (`:182`). Portal leg: trigger `trg_preview_staff_notify` → `notification_dispatch_portal('deliverable.preview_sent',…)` (`docs/notifications_e2e_repair_batch9d_RUNME.sql:340`). |
| 17 | `deliverable.client_commented` (:90) | **NOT WIRED** | Single hit = the contract line itself. Comment path emits portal type `'project_note_new'` with no event name (`docs/review_thread_email_RUNME.sql:51,54`). |
| 18 | `deliverable.revision_requested` (:91) | **NOT WIRED** | Zero hits. Real name: `'client_revision_requested'` (`docs/notifications_recovery_batch9c_RUNME.sql:302`). |
| 19 | `deliverable.comment_resolved` (:92) | **NOT WIRED** | Zero hits outside the contract line. |
| 20 | `deliverable.version_created` (:93) | **NOT WIRED** | Zero hits outside the contract line. |
| 21 | `deliverable.approved` (:94, also :115, :222) | **NOT WIRED** | `activity_log` action only (`docs/phase0_migration.sql:646`). This is the event the contract uses as its *canonical payload example* (`:115`) and its *Apps Script request example* (`:222`) — and nothing emits it. Real name: `'client_deliverable_approved'` (`docs/notifications_recovery_batch9c_RUNME.sql:305`). |
| 22 | `deliverable.rejected` (:95) | **NOT WIRED** | Zero hits outside the contract line. |
| 23 | **`deliverable.final_ready`** (:96) | ✅ **WIRED** | `components/portal/AdminDeliverables.tsx:67`, `projectcore/ProjectModules.tsx:218` → same chain as #16; `v_final` branch at `docs/event_bound_email_dispatch_batch9g_RUNME.sql:172`. |
| 24 | **`deliverable.download_recorded`** (:97) | ✅ **WIRED** | `app/api/portal/deliverable-download/route.ts:86` → `emitEventEmail` (`lib/server/notifyEvent.ts:143`) → `notify_emit_event` (`docs/global_notifications_core_batch10_RUNME.sql:42`). Outcome logged at `route.ts:96`. |
| 25-28 | `change_request.created/client_pending/approved/rejected` (:98-101) | **NOT WIRED** | Zero hits. **And no snake_case equivalent either** — `pc_change_request_upsert` only calls `pc_log` (audit), `docs/project_governance_batch5a_RUNME.sql:665,687`. The entire change-control module (`project_change_requests`, `:297`) emits **no notification of any kind**. |
| 29 | `risk.critical_raised` (:102) | **NOT WIRED** | Zero hits. Real name: `'risk_critical'` (`docs/notifications_recovery_batch9c_RUNME.sql:213`). |
| 30 | `issue.critical_raised` (:103) | **NOT WIRED** | Zero hits. Real name: `'issue_critical'` (`docs/notifications_recovery_batch9c_RUNME.sql:235`). |

---

## B. EVENT STRINGS ACTUALLY EMITTED (undocumented drift)

### B1 — Dot-namespaced, reaching the canonical pipeline
| String | Site | In contract? |
|---|---|---|
| `deliverable.client_reviewed` | `app/api/integrations/project/review/route.ts:104` (fallback-only branch, gated on `PGRST202` at `:100`); catalog `docs/global_notifications_projects_batch10_RUNME.sql:16,35` | **NO** |
| `project.note_added` | catalog + smoke array only, `docs/global_notifications_projects_batch10_RUNME.sql:17,35,49` — **no producer** | **NO** |
| `diagnostic.self_test` | `app/api/integrations/project/notify-admin/route.ts:77`; `docs/notifications_e2e_repair_batch9d_RUNME.sql:308`; `docs/apps_script_portal_notify_HANDLER.gs:171` | **NO** |
| `custody.test_probe`, `custody.selftest_probe` | `docs/global_notifications_core_batch10_RUNME.sql:110,115` (real `notify_emit_event` calls in the self-test) | **NO** |

### B2 — Dot-namespaced, runtime-constructed at the resolver (14 names, none catalogued anywhere)
`app/api/integrations/custody-inventory/notify/route.ts:102` builds `p_event: "custody." + event` from the `SUBJECTS` map (`:22-36`), producing:
`custody.civ_self_issue`, `custody.civ_assignment_created`, `custody.civ_confirm_pending`, `custody.civ_employee_confirmed`, `custody.civ_employee_rejected`, `custody.civ_return_requested`, `custody.civ_return_accepted`, `custody.civ_return_rejected`, `custody.civ_maintenance_opened`, `custody.civ_maintenance_closed`, `custody.civ_asset_created`, `custody.civ_stock_correction`, `custody.civ_audit_started`, `custody.civ_audit_approved`.
The Batch-10 custody catalog documents a *completely different* vocabulary — `custody.assigned`, `custody.returned`, `custody.compensation_requested`, `custody.compensation_decided` (`docs/global_notifications_custody_rental_batch10_RUNME.sql:16-18,39`) — **none of which any producer emits**. Same for all four `rental.*` names (`:20-22,40`). These exist only in smoke-test arrays and in the resolver's finance branch (`docs/notifications_e2e_repair_batch9d_RUNME.sql:158-159`).

### B3 — `notification_events.event_type` via `pc_event_emit` (20 names, zero overlap with the contract)
`pc_event_emit` definition: `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1994`. All emitted names are snake_case, not `<domain>.<action>`, violating `NOTIFICATION_EVENT_CONTRACT.md:67`:

`task_blocked_long` (`docs/project_tasks_batch3c_RUNME.sql:342`) · `task_review_stuck` (`:361`) · `project_overdue_heavy` (`:385`) · `approval_requested` (`docs/project_governance_batch5a_RUNME.sql:764,834`; `docs/project_platform_stabilization_RUNME.sql:254`) · `resource_conflict` (`docs/project_phase4_final_closure_RUNME.sql:151`) · `resource_booking_soon` (`:169`) · `equipment_maintenance_soon` (`:192`) · `project_status_changed` (`docs/project_governance_batch5b_RUNME.sql:880`; `5c:641,920,975,1237`) · `risk_critical` (`docs/notifications_recovery_batch9c_RUNME.sql:213`) · `issue_critical` (`:235`) · `program_sla_breach` (`:271`) · `client_revision_requested` (`:302`) · `client_deliverable_approved` (`:305`) · `client_final_download` (`:323`) · `task_due_reminder` (`docs/project_core_ABSOLUTE_FINAL_RUNME.sql:2079`) · `shoot_tomorrow` (`:2103`) · `meeting_soon` (`:2123`) · `deliverable_due_reminder` (`:2142`) · `client_payment_overdue` (`:2161`) · `budget_critical` (`:2182`) · `custody_return_overdue` (`:2203`).

`notification_events.event_type` is `text not null` with **no CHECK** (`docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1941`), so nothing enforces the "closed catalog".

### B4 — Event-typeless emitters (contract violation by omission)
`nt_event_enqueue_internal` takes **no event-name parameter at all** — its signature is `(uuid,text,uuid,uuid,uuid,boolean,text,text,text,text)` (`docs/event_bound_email_dispatch_batch9g_RUNME.sql:196`), where the `text` is an *idempotency prefix*, not an event. So the two WIRED preview/final journeys enqueue rows carrying no `event_type` (`docs/event_bound_email_dispatch_batch9g_RUNME.sql:182`), and the client-decision path enqueues `'rev:<version>:<decision>'` (`docs/project_review_decouple_batch10_RUNME.sql:125`). Contract §4 mandates `"event"` in every payload (`:115`).

Additionally: `notify_emit_event` writes **only** `email_deliveries` (`docs/global_notifications_core_batch10_RUNME.sql:73-77`) — it never writes `notification_events` and never calls `notification_dispatch_portal`. The contract diagram (`:18-20`) shows both legs firing from the resolver. Events dispatched through `emitEventEmail` therefore produce email with **no portal row and no event row**.

---

## C. THE `notifications.type` CHECK CONSTRAINT

### C1 — Which definition is authoritative

`notifications_type_check` is dropped and recreated in **16 different SQL files**. Ordering by git-add date (repo run order), the last two are both Batch 9, 2026-07-24, and both replace the enum with a *format regex*:

```sql
-- docs/notifications_recovery_batch9c_RUNME.sql:57-62
  if exists (select 1 from public.notifications where type !~ '^[a-z][a-z0-9_]{2,60}$') then
    raise notice '9C §0: بعض صفوف notifications.type لا تطابق الصيغة — أُبقي القيد القديم كما هو.';
  else
    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications
      add constraint notifications_type_check check (type is not null and type ~ '^[a-z][a-z0-9_]{2,60}$');
  end if;
```
(byte-identical duplicate at `docs/notifications_e2e_repair_batch9d_RUNME.sql:51-56`)

**The authoritative-by-repo-order constraint is the regex.** Every emitted type is lowercase snake_case ≥3 chars, so under the regex **nothing is dropped**.

**But the fix is conditional and can silently no-op.** If a single pre-existing row in `public.notifications` fails the regex, the `else` branch never runs, the *old enum stays in force*, and the file emits only a `raise notice` — no error, no failed run. Whether the guard actually took is not determinable from the repo; it must be verified on production with:
`select pg_get_constraintdef(oid) from pg_constraint where conname='notifications_type_check' and conrelid='public.notifications'::regclass;`

### C2 — If the guard no-op'd, the winning enum is the 105-type list at `docs/rental_closeout_FINAL_RUNME.sql:169-197` (created 2026-07-15, the newest enum). Cross-checking every emitted `notifications.type` against it yields **5 missing families**, all introduced *after* 2026-07-15:

| Missing type | Emitted at | Guarded? | Consequence |
|---|---|---|---|
| **`deliverable_receipt_confirmed`** | `docs/deliverable_final_receipt_RUNME.sql:75` — a **naked** `perform public.notify(...)` inside `deliverable_receipt_confirm` | **NO guard** | `public.notify` has no exception handler (`docs/production_projects_review_deliverables_RUNME.sql:40-55`), so `23514` propagates → **the client's "confirm receipt of final files" RPC aborts entirely and the `deliverable_receipts` row is rolled back.** Not a silent drop — a hard functional break of the final-delivery acceptance journey. `docs/notifications_e2e_repair_batch9d_RUNME.sql:46` names this exact failure. |
| `custody_liability_created` | `docs/custody_liability_RUNME.sql:119,121,123` | via `civ_notify` | **Silently dropped** — `civ_notify` ends with `exception when others then return;` (`docs/custody_notification_matrix_RUNME.sql:64`) |
| `custody_liability_visibility` | `docs/custody_liability_RUNME.sql:160` | via `civ_notify` | Silently dropped |
| `custody_liability_comment` | `docs/custody_liability_RUNME.sql:227,246` | via `civ_notify_managers` | Silently dropped |
| `custody_liability_<status>` — 8 runtime values (`draft`, `pending_admin_approval`, `approved`, `disputed`, `waived`, `paid`, `deducted`, `closed`) | `docs/custody_liability_RUNME.sql:202,204` (`'custody_liability_'||p_status`, statuses enumerated at `:185-186`) | via `civ_notify` | Silently dropped |
| `custody_more_evidence_requested` | `docs/custody_evidence_bundle_RUNME.sql:129` | via `civ_notify` | Silently dropped |

Dot-namespaced event names **never** reach this constraint: `notification_dispatch_portal` maps every event to a fixed safe type — `'deliverable_new'` for client/renter, `'project_note_new'` otherwise (`docs/notifications_e2e_repair_batch9d_RUNME.sql:280`) — and `pc_event_emit` maps severity to `'project_status_changed'` / `'project_note_new'` (`docs/project_core_ABSOLUTE_FINAL_RUNME.sql:2020-2021`).

---

## D. THE THREE DELTAS

### D1 — CONTRACT-ONLY (declared, no producer) — **27 of 30**
`project.created` · `project.status_changed` · `project.on_hold` · `project.resumed` · `project.closed` · `project.member_assigned` · `project.member_removed` · `project.delivery_recorded` · `session.created` · `session.updated` · `session.cancelled` · `task.due_soon` · `task.overdue` · `deliverable.uploaded` · `deliverable.internal_review_requested` · `deliverable.client_commented` · `deliverable.revision_requested` · `deliverable.comment_resolved` · `deliverable.version_created` · `deliverable.approved` · `deliverable.rejected` · `change_request.created` · `change_request.client_pending` · `change_request.approved` · `change_request.rejected` · `risk.critical_raised` · `issue.critical_raised`

Sub-list with **zero references anywhere in the repo** except their own contract line (not even a catalog or comment): `project.on_hold`, `project.resumed`, `project.closed`, `project.member_removed`, `session.created`, `session.updated`, `session.cancelled`, `task.due_soon`, `deliverable.internal_review_requested`, `deliverable.client_commented`, `deliverable.revision_requested`, `deliverable.comment_resolved`, `deliverable.version_created`, `deliverable.rejected`, all four `change_request.*`, `risk.critical_raised`, `issue.critical_raised` — **21 entries.**

Secondary contract-only drift: the contract marks 8 events as client-visible (`:81,75,89,96,92,99,100,101`), but the resolver's client allowlist contains exactly 3 — `docs/notifications_e2e_repair_batch9d_RUNME.sql:154-155`:
```sql
v_client_facing boolean := p_event in (
  'deliverable.preview_sent','deliverable.final_ready','project.delivery_recorded');
```
The fallback path uses a looser regex over the same 3 (`lib/server/notifyEvent.ts:115`). So `change_request.client_pending`/`approved`/`rejected`, `project.status_changed`, and `deliverable.comment_resolved` would not reach the client even if a producer existed.

### D2 — CODE-ONLY (emitted/consumed, undocumented) — **~60 strings**
- **Dot-namespaced, real emitters:** `deliverable.client_reviewed`, `diagnostic.self_test`, `custody.test_probe`, `custody.selftest_probe`
- **Dot-namespaced, runtime-constructed at the resolver (14):** `custody.civ_*` from `app/api/integrations/custody-inventory/notify/route.ts:102`
- **Dot-namespaced, catalogued but never emitted (11):** `project.note_added` · `custody.assigned` · `custody.returned` · `custody.compensation_requested` · `custody.compensation_decided` · `rental.charges_pending` · `rental.deposit_release_pending` · `rental.damage_reported` · `rental.contract_ready` (`docs/global_notifications_custody_rental_batch10_RUNME.sql:39-40`, `docs/global_notifications_projects_batch10_RUNME.sql:35`)
- **Snake_case `notification_events.event_type` (21):** the full B3 list above
- **Event-typeless idempotency prefixes standing in for event names (2):** `'rev:<version>:<decision>'` (`docs/project_review_decouple_batch10_RUNME.sql:125`), `'preview:'/'final:' || <deliverable> || <minute-stamp>` (`docs/event_bound_email_dispatch_batch9g_RUNME.sql:181-182`)

### D3 — CHECK-MISSING (would be rejected if the 9C/9D regex guard did not apply)
1. **`deliverable_receipt_confirmed`** — `docs/deliverable_final_receipt_RUNME.sql:75` — **unguarded → aborts the client final-receipt RPC (23514)**. Highest-severity item in this audit.
2. `custody_liability_created` — `docs/custody_liability_RUNME.sql:119,121,123` — swallowed
3. `custody_liability_visibility` — `docs/custody_liability_RUNME.sql:160` — swallowed
4. `custody_liability_comment` — `docs/custody_liability_RUNME.sql:227,246` — swallowed
5. `custody_liability_{draft,pending_admin_approval,approved,disputed,waived,paid,deducted,closed}` — `docs/custody_liability_RUNME.sql:202,204` — swallowed (8 values)
6. `custody_more_evidence_requested` — `docs/custody_evidence_bundle_RUNME.sql:129` — swallowed

Under the regex constraint (the repo-order winner), **D3 is empty** — but that constraint's installation is conditional (`docs/notifications_recovery_batch9c_RUNME.sql:57`) and cannot be confirmed from the repo. `#1` is the single check worth running against production first.

---

## Bottom line
The contract is not a specification the code implements; it is a parallel document. **3 of its 30 events exist** (`deliverable.preview_sent`, `deliverable.final_ready`, `deliverable.download_recorded`). The system's real vocabulary is ~21 snake_case names on `pc_event_emit` plus a handful of dot-names invented per-route, and its two highest-traffic journeys (preview send, client decision) carry **no event type at all** because `nt_event_enqueue_internal` has no event parameter. The `deliverable.approved` example the contract uses to define its own payload schema (`:115`) and its Apps Script request format (`:222`) has never been emitted by anything.