# FINAL CROSS-MODULE SECURITY AUDIT — fifteen modules

**Scope** — the twelve finished modules (`comms_*`, `prodops_*`, `crm_*`, `fin_*`, `csub_*`,
`sq_*`, `lsr_*`, `custody_inventory_*`, `tvn_*`, `vcc_*`, `cs_*`, `mgmt_*`) plus the three
built in this program: **live operations** (`liveops_*`), **PWA V1** (code only), and the
**Kian assistant** (`ai_*`).

**Method** — nothing was trusted from the phase reports. Every claim below was re-derived
from the working tree. Where a claim could not be re-derived, it is recorded as *unproven*
rather than as a pass. No SQL was executed, nothing was committed or pushed.

---

## 0. Verdict summary

| # | Axis | Verdict |
|---|------|---------|
| 1 | Project-platform freeze | **PASS** — guard green, frozen-path diff empty, zero platform writes in any new RUNME |
| 2 | anon / PUBLIC on communications + notification tables | **PASS after one fix** — see F-1 |
| 3 | Duplicate truth · anonymous relay · double booking · profit inference · finance · vendor/bank data | **PASS** |
| 4 | Live-ops client token | **PASS** |
| 5 | PWA caching · logout · user switch · write replay | **PASS after one fix** — see F-2 |
| 6 | AI injection · cross-tenant retrieval · tool exec · provider calls · CoT | **PASS** |
| 7 | service_role in browser · external sends · NULL predicates | **PASS** |
| 8 | Feature detection with distinct states | **PASS** |
| 9 | Static self-tests · no catch-all · POSTCHECK shape | **PASS after one fix** — see F-3 |
| 10 | Non-vacuity of the security tests | **PROVEN** — five mutations, five failures, five exact restores |

Three findings were opened and all three are fixed in this pass. No finding was deferred.

---

## 1. FREEZE — outranks everything

* `tests/project_platform_freeze.test.js` — **3/3 green**.
* `git diff --name-only 1f0faff` intersected with the 31 paths in
  `tests/fixtures/project_platform_freeze.json` → **empty**. The untracked working tree was
  intersected with the same list → **empty**.
* Grep for `insert|update|delete|alter|drop` against `public.projects`, `project_core`,
  `deliverables`, `deliverable_internal`, `project_transition_requests` across
  `live_operations_dashboard_*.sql` and `kian_ai_assistant_*.sql` → **no match**.
* `project_id` appears in `liveops_sessions` as an **optional, nullable reference column
  only**. It is never written back to and never joined into a platform table.
* The executive package is checked structurally in the same direction: POSTCHECK row
  `12a.project_platform_untouched` fails if any `mgmt_*` function so much as *reads* a
  frozen relation.

**Non-vacuity:** appending a comment line to `lib/portal/transitions.ts` turned the guard
red (2 pass / 1 fail); restoring the file from a byte copy returned it to 3/3 and left
`git diff` on that path empty.

---

## 2. anon / PUBLIC hold ZERO table privileges — and no caller was broken

### What is revoked
`docs/communications_hub_RUNME.sql` §13.b strips **every** privilege type — `SELECT`,
`INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` — from **both** `anon`
and `PUBLIC`, on `notifications`, `notification_events`, `notification_preferences`,
`notification_delivery_log`, `email_deliveries` and every `public.comms_*` table, plus
`USAGE/SELECT/UPDATE` on the sequences those tables own (discovered via `pg_depend`, not by
guessing a `_id_seq` name). It then re-reads `information_schema.role_table_grants` with
**no privilege-type filter** and raises if anything remains.

Why the type list matters and is not ritual: `TRUNCATE` is not subject to RLS at all, so
anon holding it means the browser key can empty the notification tables regardless of every
policy in the database.

### Caller search before revoking
* Direct table access from browser code: **zero**. No component under `components/` touches
  a communications table; the anon-zero test asserts this as a rule, not as a snapshot.
* `email_deliveries` — 8 references, all in `lib/server/notifyWorker.ts` and
  `app/api/integrations/project/notify{,-admin}/route.ts`, all through
  `selectAsService` / `patchAsService` = **service_role**, unaffected by an anon revoke.
* `app/api/cron/notify-email/route.ts` imports `rpcAsService` only — service_role, never anon.
* The one genuinely anonymous entry point is
  `public.submit_opportunity_request(...)`: `SECURITY DEFINER` with a pinned `search_path`,
  so it needs **no table privilege at all**, and it is a *function* grant, which §13.b never
  touches (§13.c handles functions in a separate block and separate catalogue).
* `cs_public_index / cs_public_study / cs_public_slugs` are anon-granted but read case-study
  tables only — no notification table is reachable from them.

### 🔴 F-1 (Major, FIXED) — the PUBLIC revoke rested on an unproven assumption

`authenticated` is a **member of PUBLIC**, so `revoke ... from public` removes any privilege
that role holds only by **inheritance** — without ever naming it. §13.c already handles
exactly this hazard for FUNCTIONS: it re-grants EXECUTE to `authenticated` *before*
revoking PUBLIC. The **table** block did not. It relied on a prose argument that the stock
Supabase grant (`grant all on all tables in schema public to anon, authenticated`) names
`authenticated` directly.

That argument is probably correct and was **never proven against a database**. One real
caller depends on it: `lib/portal/account.ts:32,42` reads and PATCHes
`notification_preferences` directly through PostgREST with a user JWT. The failure mode is
silent — the migration reports success and the account preferences screen starts returning
empty rows later.

**Fix, in three parts:**
1. `communications_hub_PREFLIGHT.sql` §8 — new read-only probe that reports, per legacy
   table and per privilege, whether `authenticated`'s access is **direct** or **inherited
   via PUBLIC**, with a non-vacuity control against `public.profiles` so an all-clear cannot
   be an empty query.
2. `communications_hub_RUNME.sql` §13.b — preserve-then-revoke, mirroring §13.c: for each
   table, any privilege `has_table_privilege('authenticated', …)` reports as effective but
   `information_schema` does not show as a direct grant is re-granted **first**. This widens
   nothing — it can only restate access that exists at that instant.
3. Same block — a closing assertion that fails the whole transaction if `authenticated` has
   lost `SELECT`/`UPDATE` on `notification_preferences`. Closing anon while quietly closing
   the one legitimate logged-in caller is not a success.

Regression: `tests/comms_anon_zero_access.test.js` — two new tests (order of
preserve-vs-revoke, effective-vs-direct probe, the named caller, the PREFLIGHT proof).

### The AI and live-ops packages
Both revoke `anon`, `authenticated` and `public` from every table first, then grant `SELECT`
to `authenticated` only, under RLS. `liveops_client_view` and `liveops_client_payload` are
revoked from **all three** roles and granted to `service_role` alone. Same for
`ai_public_ask` and `ai_public_lead_draft`. `ai_search_sources(text,text[],int)` — which
takes a **roles array as a parameter** — is revoked from public/anon and is *not* in the
`authenticated` grant list, so the parameter cannot be forged from the client; only the
`SECURITY DEFINER` callers `ai_ask` / `ai_public_ask` reach it, and both derive the roles
server-side from `ai_actor_roles()`.

---

## 3. The twelve finished modules — nothing reopened

| Guarantee | Where it is enforced | Regression |
|---|---|---|
| No anonymous relay | one allowlisted `SECURITY DEFINER` RPC, rate-limited, no caller-selected recipient | `comms_safety_rules`, `comms_anon_zero_access` |
| No double booking | `prodops` conflict engine remains the single writer | `ops_double_booking` |
| No profit inference | quote surfaces expose no cost basis | `quoting_profit_guard` |
| Collections cannot reach costs | `fin_*` role split | `finance_collections_isolation` |
| Sensitive finance is owner-only | `mgmt_can_view_sensitive()` requires `is_owner()` and is **not** openable by a permission key | `exec_owner_only`, POSTCHECK `8a`/`8b` |
| Vendor rates / bank data | never selected into any cross-module payload | `talent_rates_privacy`, `compliance_*` |
| Client cannot see internal data | per-module client predicate, checked before any read | `*_client_denial` |

No duplicate source of truth was introduced. The two new executive KPIs **compose** existing
RPCs (`liveops_session_list`, `ai_admin_overview`) rather than re-querying their tables, so
there is exactly one authority per number.

---

## 4. Live operations — the client token

**Can a client token reach an internal incident, a stream key, an IP, a serial number, a
cost or an internal note? — No.**

There is exactly one redaction authority: `public.liveops_client_payload(uuid)`. The public
route passes its output through **verbatim** and assembles nothing of its own, on the stated
grounds that two redaction authorities is how leaks happen. What the payload emits:

* incidents — only rows with `client_summary_approved = true`, only the approved summary;
  `root_cause` is `null` unless `root_cause_released` was explicitly set by a manager.
* cameras — a **count**, never a label, serial or position.
* stream state — three general words (`nominal` / `degraded` / `interrupted` / `unknown`),
  never bitrate, latency, loss, encoder id or destination URL.
* report — emitted only when `status = 'approved'`; a draft or pending report is `null`.
* costs, internal notes, contacts, `internal_ref`, `token_hash`, `adapter_id` — never present.

A `BEFORE` trigger (`liveops_client_text_guard`) additionally rejects client-facing free text
containing an IP, a stream key, a serial, an amount or a connection id, so the human path
cannot leak what the machine path forbids.

**Can a client change status? — No, at three independent layers.** (1) There is no `UPDATE`
policy on any `liveops_*` table — writes exist only through RPCs. (2)
`liveops_can_operate_session()` rejects a client. (3) `liveops_session_guard()` is a `BEFORE
UPDATE` trigger whose **first** branch is `if coalesce(liveops_is_client(), true)` → log and
raise, evaluated before any permission key is consulted; the `coalesce(..., true)` means an
identity it cannot resolve is treated as a client.

**Is unknown-vs-expired identical? — Yes.** `liveops_client_view` returns the constant
`DENY = {ok:false, reason:'invalid_or_expired'}` for malformed, unknown, revoked, not-active,
not-yet-started, expired and exhausted tokens alike. The *table* is corrected for reporting
(`status := 'expired'|'exhausted'`) but the *response* does not change. The route re-flattens
any non-`ok` payload to the same object with the same HTTP 200, so a link never becomes an
oracle telling an attacker they are close. Every attempt is logged, denials included.

**Is manual data ever presented as telemetry? — No.** `telemetry_connected` is hard-coded
`false` in every payload; when no reading exists the state is `unknown` with
`basis = 'telemetry_not_connected'`, never `nominal`. `liveops_report_uptime_guard()`
silently demotes `uptime_basis` from `telemetry_verified` to `manual_estimate` unless a
verified reading with a real `adapter_id` exists, so an uptime percentage cannot be dressed
up as measured.

**Non-vacuity:** making the unknown-token branch return its own reason turned
`tests/liveops_token_isolation.test.js` red (18 pass / 1 fail); restoring returned 19/19.

---

## 5. PWA

**Is any sensitive response cacheable? — No.** `public/sw.js` caches by **allowlist** and
applies three independent vetoes: non-GET is not intercepted at all; a request carrying
`Authorization`, `RSC`, `next-router-state-tree` or `Range`, or `cache: no-store`, is
private; and a response is stored only if it is `type === "basic"`, status 200, carries no
`Set-Cookie`, no `Cache-Control: no-store|private`, and no `Vary: Authorization` / `Vary: *`.
Header access failures fail **closed**. `/api/*`, every authenticated route tree, every
Supabase origin and every `?_rsc` payload are excluded by URL before any of that.

**Is there background write replay? — No.** There is no `sync` and no `periodicsync`
listener, no write queue, and non-GET requests are passed straight to the network so an
offline write fails honestly and immediately. Push is foundation-only: no `push` and no
`pushsubscriptionchange` listener exists.

### 🟠 F-2 (Moderate, FIXED) — a second sign-out path skipped the purge

`PortalShell.signOut` clears the caches and forgets the remembered identity.
`components/portal/StatusScreens.tsx` — the **suspended-account** screen — called `logout()`
and reloaded, purging nothing. That is the account whose device is most likely to be handed
to somebody else. The MFA challenge screen was checked too and is fine: it calls the shell's
`onSignOut` prop.

**Fix:** `StatusScreens.tsx` now signs out through a `signOutAndPurge()` helper — session
first, then `onSignOutClearCaches()` best-effort, then reload. Regression in
`tests/pwa_lifecycle_privacy.test.js` asserts the rule generally: *every* component under
`components/portal/` that imports `logout` from `@/lib/portal/auth` must also call the
purge. A future third sign-out button fails the suite by construction.

User switch is unaffected and was verified: `noteActiveUser()` purges **before** any account
data is fetched, and treats two known-but-different identities as a switch.

**Non-vacuity:** removing the `Authorization`-header veto from `sw.js` turned
`tests/pwa_service_worker_security.test.js` red (18 pass / 1 fail); restoring returned 19/19.

---

## 6. AI assistant

**Does prompt injection through a document work? — No, and the defence is ordered
correctly.** `ai_guard_question()` runs **before any retrieval**; when it flags, the branch
returns without calling `ai_search_sources` at all, so `retrieved_count` is genuinely 0 and
no citation row is created. Retrieved content is additionally passed through
`ai_neutralize()`, which strips tags, zero-width and bidi control characters, signed URLs
(`token=`, `X-Amz-`, `/object/sign/`, `signature=`) and role markers, in Arabic and English.
The response contract states `is_data_not_instructions: true` and `tool_execution: false` on
**every** return path, including the short-question path — so an absent field can never be
read as "maybe a tool ran".

**Cross-client or cross-role retrieval? — No.** `ai_search_sources` takes a roles array, but
the caller cannot supply it: the function is revoked from `public`/`anon` and never granted
to `authenticated`, so it is reachable only from `ai_ask` / `ai_public_ask`, which compute
roles from `ai_actor_roles()` under the caller's own identity. Permission filtering is then
applied **twice** — RLS, then `ai_source_permitted_for(...)` inside the query. The
role↔source matrix is explicit data (`ai_role_source_access`): only the owner reaches
`restricted`; sales never does; collections sees no cost or margin; the public surface is
`public` sensitivity only.

**Any tool execution or provider call? — No.** `lib/server/aiProvider.ts` contains no
`fetch`, no SDK import, no `process.env` read and no header builder — it is an interface.
`ai_provider_describe()` reports `enabled:false` with status `not_configured`, and
`ai_admin_overview()` reports `external_calls: 0` alongside every logged attempt.

**Is chain-of-thought stored? — No.** `ai_messages` stores the user question, the emitted
answer and the guard verdict. There is no reasoning/scratchpad column and no path that would
populate one.

**Does the mock ever imply the assistant works? — No.** Every refusal carries an explicit
`refusal_code`; a query with no approved source answers «لا توجد لدي معلومة معتمدة كافية
للإجابة» with `confidence: 'none'` rather than improvising; and the provider notice states
plainly that the assistant is not yet enabled.

Ingest-side: `ai_forbidden_content()` blocks secrets and national IDs from entering the
knowledge base at all, so the retrieval layer is not the only thing standing between a
credential and an answer.

**Non-vacuity:** disabling the `override_instructions` detector turned
`tests/ai_prompt_injection.test.js` red (17 pass / 1 fail); restoring returned 18/18.

---

## 7. service_role, external sends, NULL predicates

* **No service_role in the browser.** No file containing `SERVICE_ROLE` carries
  `"use client"`; there is no `NEXT_PUBLIC_*SERVICE*` variable anywhere. The service key
  appears only in `runtime = "nodejs"` route handlers.
* **No external sends.** No new code path sends email, WhatsApp or SMS; no AI provider is
  called; Zoho is untouched; Apps Script is not deployed.
* **Predicates never return NULL.** Every gate in `liveops_*`, `ai_*` and `mgmt_*` wraps its
  result in `coalesce(..., false)`, and the ambiguous direction is deliberately biased:
  `liveops_is_client()` returns `true` for a signed-in user with no profile row. POSTCHECK
  row `7.predicates_never_null` fails on a NULL as loudly as on a `true`.
* Secret scan across `app/ lib/ components/ docs/ public/ tests/` for JWT prefixes,
  `sk-…`, `AKIA…` and PEM private keys → **no match**.

---

## 8. Feature detection and distinct states

Code ships before SQL everywhere. `lib/portal/pgerror.ts` is the single classifier, and both
new modules consume it rather than re-implementing it:

| Cause | Surface |
|---|---|
| missing migration | `needs_migration` → «الميزة بانتظار تفعيل قاعدة البيانات» + the RUNME filename, and explicitly *"this is not a permissions problem"* |
| permission denied | `denied` — a denial, never a zero |
| network error | `offline` — "the request never reached the database" |
| conflict | `conflict:`-prefixed server message surfaced verbatim in Arabic — **never** classified as a missing migration |
| provider disabled | `not_configured` / `disabled_by_design`, distinct from each other |
| telemetry not connected | `telemetry_not_connected` with `unknown` state — never `nominal` |
| AI provider not configured | `not_configured`, stated in every response |

The public live-status route keeps the same discipline on the wire: `pending_migration` (503)
for `PGRST202`, `server_not_configured` (503) for missing env, `upstream_error` (502) for a
failed transport — none of which is ever collapsed into "invalid link".

*Observation (not a finding):* `lib/portal/liveOps.ts` carries a conflict **message** but not
a conflict **state** — a conflict lands in `state: "error"` with the correct Arabic text. The
rule that matters ("a conflict is not reported as a missing migration") holds. Promoting it
to its own state would change a union consumed across the live-ops UI, so it is recorded here
rather than churned at audit time.

---

## 9. SQL package shape

* **Self-tests static.** No RUNME self-test calls a protected RPC — the failure mode that
  broke two migrations in this repo. The live-ops self-test verifies triggers, policies and
  grants through catalogue reads.
* **No catch-all.** Every check names an expected value; no branch passes regardless of
  input. The comms revoke verification deliberately omits a `privilege_type` filter, because
  an allowlist of four CRUD verbs is what let `REFERENCES`/`TRIGGER`/`TRUNCATE` survive an
  earlier pass.
* **Dependencies proven in PREFLIGHT.** Including, as of F-1, the `authenticated` grant that
  the PUBLIC revoke depends on.
* **POSTCHECK read-only, single result set.** `live_operations_dashboard`, `kian_ai_assistant`
  and `communications_hub` were already one CTE + one final `SELECT`.

### 🟡 F-3 (Moderate, FIXED) — the executive POSTCHECK was ~30 result sets

`docs/executive_reporting_POSTCHECK.sql` emitted about thirty separate top-level `SELECT`s.
A SQL editor shows the last one, so in practice the file was read as a single check and
declared green while twenty-nine went unseen.

**Fix:** rewritten as **one** result set — a CTE chain plus a final `SELECT` — with one row
per check carrying an explicit `PASS` / `FAIL` / `INFO` verdict, the expected value and the
observed value. Every original check was preserved, plus the new source modules and the
17-key KPI check. The three pure predicate probes are now guarded by `to_regprocedure(...)`
so the file cannot abort on a database where the package is not installed, and no gated RPC
(`mgmt_dashboard`, `mgmt_export`, `mgmt_refresh`, `mgmt_sources`, `mgmt_audit_list`) is
invoked anywhere — a test now enforces that.

---

## 10. Non-vacuity — five security tests proven able to fail

Each mutation was applied to a byte-for-byte backup, the test was run, and the file was
restored by copying the backup back. `git status` / `git diff` on every mutated path is
clean afterwards.

| # | Mutation | Test | Before | After |
|---|---|---|---|---|
| 1 | drop `revoke … from public` on the comms tables | `comms_anon_zero_access` | 50/0 | **49 pass / 1 fail** |
| 2 | let an unknown token return its own reason | `liveops_token_isolation` | 19/0 | **18 pass / 1 fail** |
| 3 | disable the `override_instructions` detector | `ai_prompt_injection` | 18/0 | **17 pass / 1 fail** |
| 4 | remove the `Authorization`-header cache veto | `pwa_service_worker_security` | 19/0 | **18 pass / 1 fail** |
| 5 | append a line to `lib/portal/transitions.ts` | `project_platform_freeze` | 3/0 | **2 pass / 1 fail** |

All five restored to their baseline counts.

---

## 11. What this audit does NOT prove

* **No SQL was executed.** Every SQL verdict is structural — derived from the migration text,
  not from a live database. The PREFLIGHT/POSTCHECK pairs exist so the operator can confirm
  behaviour at apply time; F-1's fix in particular is written to be *self-verifying inside
  the transaction*, but it has not run.
* **No live three-account test.** Owner / non-owner staff / client behaviour under real
  sessions is proven only in shape. `docs/EXECUTIVE_REPORTING_ACCEPTANCE.md` and
  `docs/LIVE_OPS_GO_LIVE.md` describe the required manual runs.
* **Nothing was committed, pushed or deployed.**
