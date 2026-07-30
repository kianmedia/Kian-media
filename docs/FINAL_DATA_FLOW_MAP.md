# FINAL DATA FLOW MAP

Where data enters, who may read it, where it may leave, and what is deliberately never
carried across a boundary. Derived from the working tree, not from prior reports.

---

## 1. Identities

| Identity | Where it exists | What it can reach |
|---|---|---|
| `anon` | browser, public pages | **Zero** table privileges on any communications, notification, `liveops_*` or `ai_*` object. Only allowlisted `SECURITY DEFINER` RPCs. |
| `authenticated` | browser, signed-in portal | `SELECT` under RLS on module tables; gated RPCs. Writes only through RPCs. |
| `service_role` | **server route handlers only** (`runtime = "nodejs"`) | the two public redemption paths (`liveops_client_view`, `ai_public_ask` / `ai_public_lead_draft`), the notification worker, the cron. Never present in any `"use client"` file; no `NEXT_PUBLIC_*SERVICE*` variable exists. |
| link bearer (no account) | a URL fragment | `liveops_client_view` **only**, via POST, one session, no directory. |

---

## 2. Inbound

```
public web form ──► submit_opportunity_request()        [SECURITY DEFINER · rate-limited ·
                    (the ONLY anonymous writer)          closed 10-value type list · consent
                                                         required · recipients derived
                                                         server-side, never from the caller]
                          │
                          ├──► opportunity_requests ──► crm_* (lead scoring / routing)
                          └──► notify() ──► notifications ──► email_deliveries

live-status link ──► POST /api/public/live-status ──► liveops_client_view(token, fp)
   (token in the URL FRAGMENT: never in a query string, never in a Referer, never in a log)

assistant (public) ──► POST /api/public/assistant ──► ai_public_ask()
                                                       [public-sensitivity sources only]

portal user ──► pget/ppatch (user JWT = authenticated) ──► RLS-filtered tables
             └─► rpc (user JWT) ──► gated SECURITY DEFINER RPCs
```

Nothing else writes from outside the company. There is no anonymous relay: the one anonymous
RPC cannot name its own recipient.

---

## 3. Live operations — the redaction boundary

```
liveops_sessions / _inventory / _stream_health / _rundown / _cues /
_incidents / _bulletins / _client_people / _reports / _client_links /
_link_access_log / _audit
        │  RLS: SELECT to authenticated USING liveops_can_view()   (clients excluded)
        │  RLS: no INSERT / UPDATE / DELETE policy exists AT ALL
        │
        ├── internal ──► liveops_session_list / _detail / _live_board   (staff only)
        │
        └── external ──► liveops_client_payload(uuid)   ★ the ONE redaction authority ★
                              │
                              ├─ liveops_client_view(token)  → service_role → public route
                              └─ liveops_client_preview(id)  → staff, SAME builder
                                     (so "what will the client see" cannot drift)
```

**Crosses the boundary:** title, client status, planned/actual times, elapsed/remaining,
schedule delay, client-visible rundown item titles, a **camera count**, three general
technical words, named client-facing people, published bulletins, approved incident
summaries, and an **approved** report.

**Never crosses:** stream keys, ingest/RTMP URLs, IP addresses, serial numbers, equipment
labels and positions, internal notes, `internal_ref`, unreleased root causes, unapproved
incidents, draft reports, costs, contacts, `token_hash`, `adapter_id`, and any session id.

`telemetry_connected` is hard-coded `false` on every payload; absent readings produce
`unknown` + `telemetry_not_connected`, never `nominal`. `liveops_report_uptime_guard()`
demotes `telemetry_verified` to `manual_estimate` unless a real verified reading exists.

A `BEFORE` trigger rejects client-facing free text containing an IP, stream key, serial,
amount or connection id — the human path cannot leak what the machine path forbids.

Denial is uniform: malformed / unknown / revoked / not-active / not-started / expired /
exhausted all return the identical `{ok:false, reason:"invalid_or_expired"}`. Every attempt,
denials first, is written to `liveops_link_access_log` with a **salted hash** of IP+UA —
never the raw values.

---

## 4. AI assistant

```
question ──► ai_guard_question()   ★ BEFORE any retrieval ★
                │ blocked → answer + refusal_code, retrieved_count = 0,
                │           ai_search_sources is NOT called, no citation row
                ▼
           ai_search_sources(q, roles_from_ai_actor_roles(), limit)
                │  RLS  +  ai_source_permitted_for(...) applied a SECOND time
                │  every excerpt passed through ai_neutralize()
                ▼
           answer + citations (source id / version / freshness)  ──► ai_messages
```

* Roles are **computed server-side**; the roles parameter is unreachable from a client
  because `ai_search_sources` is granted to nobody but the definer's own callers.
* `ai_role_source_access` is explicit data: owner alone reaches `restricted` (pricing
  guidance, HR, compliance); sales does not; collections sees no cost or margin; the public
  surface is `public` sensitivity only.
* `ai_forbidden_content()` blocks secrets and national IDs at **ingest**, so the retrieval
  filter is not the last line of defence.
* Stored: question, answer, guard verdict, citations. **Not stored:** chain of thought — no
  column exists.
* Leaves the system: **nothing**. No provider is called (`lib/server/aiProvider.ts` has no
  `fetch`, no SDK, no env read); `external_calls` is reported as `0`.
* Lead drafts are drafts: `ai_lead_drafts.status = 'pending_human_review'` — nothing reaches
  the CRM until a human reviews it.

---

## 5. Communications and notifications

```
module event ──► notify_emit_event() ──► notifications
                                    └──► email_deliveries (queue)
                                              │  service_role only
                                              ▼
                                    notifyWorker / cron  ──► provider
comms_* hub  ──► comms_outbox   [BEFORE trigger: external channels fail CLOSED;
                                 dry_run enforced; provenance columns NOT NULL]
```

* `anon` / `PUBLIC`: **zero** privileges of any type on `notifications`,
  `notification_events`, `notification_preferences`, `notification_delivery_log`,
  `email_deliveries`, every `comms_*` table, and their owned sequences.
* `authenticated` keeps exactly what it had — `notification_preferences` is read and PATCHed
  with a user JWT by `lib/portal/account.ts`, and the revoke now **preserves that effective
  privilege before revoking PUBLIC** and fails the transaction if it did not survive.
* Legacy `email_deliveries` rows are mirrored into `comms_outbox` as **terminal, read-only**
  rows marked `is_legacy_mirror` — one queue, one authority, no second worker.

---

## 6. Executive reporting — the LAST package, reads only

```
mgmt_dashboard(filters, sensitive)
      └── mgmt_compute()
             ├─ comms_health()                 → notifications_pending / _failed
             ├─ prodops_dashboard/conflicts/calendar
             │                                 → operational_readiness / resource_conflicts /
             │                                   upcoming_jobs
             ├─ liveops_session_list()   ★new★ → live_sessions_active / live_open_incidents
             ├─ crm_dashboard / crm_leads_list  → new_leads / pipeline_value / …
             ├─ ai_admin_overview()      ★new★ → ai_knowledge_approved / ai_leads_pending_review
             └─ finops_dashboard()             → expenses / commitments / … (owner-only)
```

* Every source is read through `mgmt_read_jsonb`, which **feature-detects first** and
  classifies failure distinctly: `module_not_installed` (naming the RUNME file),
  `not_authorized`, or `error`. A value exists **only** in state `ok` — `mgmt_kpi` is the
  single writer of a KPI object, so a zero can never mean "not installed" or "denied".
* Calls run under the reader's own identity inside `SECURITY DEFINER`, so each source
  module's own gate still decides. **This package grants no new visibility.**
* The two new KPIs are **non-sensitive counts**. No stream key, IP, serial, internal note,
  conversation text, lead PII or cost is read into the engine — a test enumerates the
  forbidden column names and fails if any appears.
* Financial KPIs stay owner-only via `mgmt_can_view_sensitive()`, which requires
  `is_owner()` and is **not** openable by a permission key (no such key exists, by design).
* Cache key includes `auth.uid()` **and** the sensitivity level; TTL may be shortened by the
  caller, never extended.
* The frozen project platform is not read, let alone written — a POSTCHECK row fails if any
  `mgmt_*` function so much as references it.

---

## 7. PWA storage

| Store | Contents | Cleared when |
|---|---|---|
| `kian-pwa-static-v*` | content-hashed `/_next/static/`, icons, offline page | version change, logout, user switch |
| `kian-pwa-public-v*` | public marketing shell, **published** case studies | version change, logout, user switch |
| localStorage `kian_pwa_last_user` | last signed-in user id | logout, and compared on every login |

Never stored: any `/api/*` response, any authenticated route, any Supabase response, any RSC
payload, any token or signed URL, any cross-origin/opaque response, any non-GET request, and
anything carrying `Set-Cookie` or `Cache-Control: no-store|private`.

**Every** sign-out path purges — the shell, the MFA challenge (via the shell's handler) and
the suspended-account screen — and a test now enforces that rule for any future third path.
Offline is strictly read-only: no `sync`, no `periodicsync`, no write queue, no replay.

---

## 8. Boundaries that are never crossed

1. Frozen project platform ← nothing writes; `project_id` is an optional read-only reference.
2. Client ← internal live-ops data, in any form, through any surface.
3. Non-owner ← sensitive finance and profitability.
4. Collections ← cost data.
5. External party ← vendor rates and bank details.
6. Browser ← `service_role`.
7. Any outbound network call ← from inside PostgreSQL (no `pg_net`, no `dblink`).
8. The model ← company data: no provider is called at all in V1.
