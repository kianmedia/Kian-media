# Phase 2 — Privileged Account MFA (TOTP via Supabase Auth): Implementation Plan

All facts below were re-verified against the working tree, not inherited from the audit.

---

## DECISIVE ANSWERS

### A. WHERE enforcement lives

**A mix, but with one primary and one secondary — and NOT middleware.**

**Primary (covers ~95% of privileged surface): a new SQL predicate `public.mfa_ok()` composed at NAMED privileged WRITE RPC bodies.**

Justification, tied to what the audit found:

- Middleware is *structurally incapable* of working here. `find` over the repo returns no `middleware.*` file, and the session is in `localStorage` under `"kian_portal_session"` (`lib/portalAuth.ts:50`, written at `:53-55`) with zero cookie usage repo-wide. Next.js middleware sees only cookies/headers on a navigation, so it would receive no token and could never fail closed. Worse, it would gate only page navigation while the browser's real data path — `lib/portal/client.ts:72` sending `Authorization: Bearer ${session.access_token}` straight to PostgREST — is untouched. That is hidden-UI protection with a server-side costume.
- Every privileged call, from both the browser (`lib/portal/client.ts:68-78`) and the 30 API routes (`lib/server/supabaseAdmin.ts:185-215` `rpcAsUser`, `:158-177` `selectAsUser`), converges on Postgres carrying the **user's own JWT**, with the anon key as `apikey`. `rpcAsUser`'s own header states it: *"authorization is enforced by the database"* (`lib/server/supabaseAdmin.ts:180-184`). That is the only true chokepoint.

**Secondary (the gap SQL cannot reach): a TS assert for the routes that decide authorization in TypeScript from a service-role `profiles` read.** Those never evaluate any SQL gate, so a DB-side `mfa_ok()` is inert there:
- `app/api/rental/evidence/upload-url/route.ts:51-56`
- `app/api/integrations/rental/notify/route.ts:96-102`
- `app/api/integrations/hr/my-tasks/route.ts:35-40`
- `app/api/integrations/project/notify-admin/route.ts:130-134`

**Explicitly forbidden insertion points** (this is a hard rule, pinned by a test in Subphase 1):
`is_admin()` (`docs/phase0_migration.sql:325-329`), `is_owner()` / `staff_role()` / `is_staff()` (`docs/staff_roles_task_assignment_RUNME.sql:44-63`), `can_manage_projects()` (`docs/project_platform_authz_hardening_RUNME.sql:51-53`), `staff_reads_all_projects()`, `pc_can_read_project()`, `emp_has_permission()`. These are `using` clauses of ~50 RLS **SELECT** policies (e.g. `docs/project_core_FINAL_RUNME.sql:376-390`, `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:2595-2599`) and one **RESTRICTIVE** policy (`docs/staff_roles_task_assignment_RUNME.sql:157`). An aal term there blanks the owner's entire screen with no error — the exact lockout the owner forbade. **Reads are never gated on assurance. Only named writes.**

---

### B. Can Postgres see the `aal` claim?

**Almost certainly yes — but this repo has never proven it, so the plan does not *assume* it.**

The mechanism is sound: PostgREST validates the JWT signature and loads the payload into `request.jwt.claims`; `auth.uid()` is Supabase's wrapper over that same GUC and is used 1,000+ times here in production. `auth.jwt()` reads the identical GUC. The repo already reads a sibling PostgREST GUC in live code — `current_setting('request.headers', true)::json->>'x-forwarded-for'` at `docs/portal_hr_employee_portal_RUNME.sql:46`.

But `grep -rn "auth\.jwt" docs/` returns **0 hits across all 169 SQL files**. Unproven in this project. So Subphase 1 ships a **read-only probe** that must be run and its output pasted back *before any enforcement code is written*:

```sql
create or replace function public.mfa_claim_probe()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_raw text; v_j jsonb;
begin
  begin v_raw := current_setting('request.jwt.claims', true); exception when others then v_raw := null; end;
  begin v_j := v_raw::jsonb; exception when others then v_j := null; end;
  return jsonb_build_object(
    'uid_present',   (auth.uid() is not null),
    'claims_present',(v_j is not null),
    'aal',           v_j ->> 'aal',        -- expect 'aal1' pre-MFA, 'aal2' after verify
    'amr_present',   (v_j ? 'amr'),
    'role',          v_j ->> 'role'
  );
end $$;
```

Note it reads `current_setting('request.jwt.claims', true)` directly rather than `auth.jwt()` — same data, no dependency on the `auth` schema wrapper existing, and `exception`-isolated so it can never raise. The production predicate uses the same accessor.

**Three non-negotiable properties of that accessor:**
1. `service_role` bypass evaluated **first** — `rpcAsService` (`lib/server/supabaseAdmin.ts:63-78`) sends the service key; the JWT carries `role='service_role'` and no `aal`. 15 of 30 route files plus all three nightly crons (`vercel.json`) run this way. Without a first-position bypass, either the crons silently die at 03:00 or the gate fails open.
2. **Never returns NULL.** This repo's governing incident is exactly NULL-collapse in a SECURITY DEFINER gate (`docs/project_platform_authz_hardening_RUNME.sql:12-22` — `false OR NULL = NULL`, so `if not NULL then raise` never fired and an unauthenticated caller read real company data).
3. Because this is a *lockout-capable* control, the NULL/unknown default is **`true` (allow)**, not `false`. This is the one place in the codebase where `coalesce(..., false)` is the wrong answer, and it must carry an inline comment saying so, or a future reviewer will "fix" it into an outage.

**Fallback if the probe shows no `aal`:** enforcement degrades to the TS layer only — `authGetUserAssurance()` (Subphase 3) calls GoTrue `GET /auth/v1/user` and reads the `factors` array, combined with a per-route assert. Weaker coverage (routes only, not browser→PostgREST), but not a blocker for the enrollment phase, which is the only phase Phase 2 ships.

---

### C. `MFA_ENFORCEMENT_MODE` — DB row, not env var

**A single-row DB table, `public.mfa_settings (id = 1)`.** The env var exists only as a **one-way kill switch that can force `off` and can never force enforcement.**

Justified specifically on revert speed and lockout:

| | Env var | DB row |
|---|---|---|
| Revert path | Vercel env edit → **redeploy** → `next build` must pass `typescript`/`eslint` gates (`next.config.js:8-9`) | one `UPDATE ... WHERE id = 1` |
| Time to revert | minutes to hours; can fail on an unrelated type error | seconds |
| Credential path | Vercel account | **Supabase SQL editor — a different credential from the portal login** |
| Available while locked out of the portal? | only if Vercel login works | **yes** |

That last row is the whole argument. If MFA locks the owner out of the portal, the recovery lever must not live behind a build pipeline. The Supabase SQL editor is a separate credential path that a portal lockout cannot touch.

This is also the house pattern, not an invention: `custody_enterprise_settings` (`docs/custody_enterprise_00_feature_flags_PATCH.sql:13-45` — `id int primary key default 1 check (id = 1)`, RLS on with **zero read policies**, RPC-only access), plus `hr_settings`, `project_hierarchy_settings`, `zoho_books_settings`.

**Phase 2 CHECK constraint deliberately omits `'enforced'`:**
```sql
enforcement_mode text not null default 'off'
  check (enforcement_mode in ('off','enrollment'))
```
The owner's constraint "NEVER ship 'enforced'" becomes a database constraint, not a code review promise. Writing `'enforced'` raises `23514`. Adding it later is a deliberate future migration.

Writer gate is **`is_owner()` ONLY** — not `is_owner() or can_manage_projects()` as `docs/project_hierarchy_batch6a_RUNME.sql:191` does, because `can_manage_projects()` resolves to include `staff_role='manager'` (`docs/project_platform_authz_hardening_RUNME.sql:51-53`), which would let any manager disable MFA.

---

### D. LOCK-OUT PREVENTION — the exact design

Ten enumerated vectors. Each has a named mechanism, and most have a pinned test.

| # | Lockout vector | Prevention |
|---|---|---|
| **1** | Enforcement turned on before the owner enrolls | `mfa_ok()` requires aal2 **only for users who already have a verified factor**. No factor ⇒ pass. Structural invariant: *you can only be blocked by MFA if you personally have MFA*. Combined with default `'off'`, flipping the flag early cannot lock anyone out. |
| **2** | Owner enrolls, then loses/wipes the phone | **True break-glass = Supabase Dashboard → Authentication → delete the row in `auth.mfa_factors`** (or `DELETE FROM auth.mfa_factors WHERE user_id = '<uid>'` in the SQL editor). Separate credential path from the portal. Documented verbatim in the RUNME header **and** in `docs/MANUAL_ACTIONS_QUEUE.md` before enrollment is offered. Secondary lever: `UPDATE public.mfa_settings SET enforcement_mode='off' WHERE id=1`. |
| **3** | The `aal` claim never actually arrives in this project ⇒ gate denies every enrolled user | Probe RPC (§B) must be run and its output confirmed **before** Subphase 4 is written. Additionally `mfa_ok()` treats *claims unreadable / `aal` absent* as **pass**, so a claim-plumbing failure degrades to "MFA not enforced", never to "everyone denied". |
| **4** | NULL-collapse — the documented repo incident recurring | `mfa_ok()` is plpgsql with explicit early `return`s, no bare `OR` chains, and a terminal `exception when others then return true;`. Cannot return NULL; cannot raise. Test asserts the function body contains no `coalesce(..., false)` and that its exception handler returns `true`. |
| **5** | aal2 welded into `is_owner()`/`is_admin()`/`staff_role()`/`pc_can_read_project()` ⇒ every read policy denies, owner sees empty screens with no error | Hard architectural rule. Pinned by a static test that greps the MFA RUNME files and **fails the build** if any of those seven function names appears next to `create or replace function`. The blast radius is real: `is_admin()` anchors the RESTRICTIVE policy at `docs/staff_roles_task_assignment_RUNME.sql:157`, so an aal1 owner would additionally lose every soft-deleted row platform-wide. |
| **6** | Mode accidentally set to `'enforced'` | Not a legal value — `CHECK (enforcement_mode in ('off','enrollment'))`. DB-level, not policy-level. |
| **7** | The MFA control RPCs themselves require aal2 ⇒ the owner cannot turn MFA off because MFA is on | Explicit exclusion list. `mfa_settings_get`, `mfa_admin_set_mode`, `mfa_claim_probe`, `mfa_status` **never** call `mfa_ok()`. Pinned by test. |
| **8** | Nightly crons / Zoho webhook / n8n break because service-role JWTs carry no `aal` | `role = 'service_role'` short-circuits `true` as the **first** statement of `mfa_ok()`. Three crons at 03:00/03:10/03:20 (`vercel.json`) would otherwise fail silently. |
| **9** | Token refresh silently downgrades aal2 → aal1 mid-session | GoTrue recomputes AAL from the session's verified factors on a `refresh_token` grant, so `lib/portalAuth.ts:96-116` preserves it unchanged. But we do not rely on that: nothing gates **reads**, so a downgrade degrades to "a write asks you to re-verify", never to a dead portal. Subphase 3 ships the step-up modal that resolves that state. |
| **10** | `mfa.verify` returns a fresh aal2 token that never reaches storage ⇒ user re-challenged forever | Verify must call `saveSession()` (`lib/portalAuth.ts:53-55`) with the new token. Test asserts the verify path calls `saveSession`. |

**The invariant, stated once:** *In Phase 2, no code path can deny a user who has no verified TOTP factor, and no code path gates a read.* Everything above is a mechanism enforcing that sentence.

---

### E. Audit events without violating the table's constraint

Three facts, all verified directly:

1. `activity_log.action` is `action text not null` (`docs/phase0_migration.sql:51`) with **no CHECK**. The only `ALTER TABLE public.activity_log` in the entire repo is `enable row level security` at `:753`. Action vocabulary is **open** — `'mfa.enrolled'` needs no migration.
2. The closed enum is `actor_role` — 12 values (`docs/phase0_migration.sql:48-50`), and `log_activity` coerces anything outside it to NULL (`docs/activity_log_role_hardening_RUNME.sql:36-40`). **Every** `staff_role()` value falls outside it. ⇒ MFA writers pass the **literal `'admin'`** (actor-initiated) or `'system'` (automated), never `staff_role()`.
3. `log_activity` currently has `grant execute ... to authenticated` (`docs/activity_log_role_hardening_RUNME.sql:49`), and takes `p_actor` from the caller with no `auth.uid()` reconciliation — so any signed-in user can POST `/rest/v1/rpc/log_activity` and forge an audit row attributed to the owner. An MFA trail written through that is forgeable.

**Therefore: a dedicated wrapper, modeled exactly on `custody_audit` (`docs/custody_enterprise_00_feature_flags_PATCH.sql:56-62`):**

```sql
create or replace function public.mfa_audit(p_action text, p_uid uuid, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 'mfa.' namespace; actor_role is a HARDCODED in-vocabulary literal.
  -- p_meta must NEVER carry a factor secret, otpauth URI, QR payload or code.
  perform public.log_activity(p_uid, 'admin', 'mfa.' || p_action, 'profile', p_uid,
                              coalesce(p_meta, '{}'::jsonb));
exception when others then return;
end $$;
revoke execute on function public.mfa_audit(text,uuid,jsonb) from public, anon, authenticated;
```

Revoked from `authenticated` (unlike `log_activity`), so it is reachable only from other SECURITY DEFINER bodies or `rpcAsService`. `entity_type = 'profile'` keeps MFA rows out of `project_timeline` (`docs/project_timeline_RUNME.sql:56-59` filters `entity_type in ('project','deliverable')`), so MFA metadata cannot leak into a client-visible feed.

**Because `log_activity` swallows every exception (`:43-45`), the audit row is not the record of truth.** Enrollment state is read live from GoTrue (`auth.mfa_factors`), and mode from `mfa_settings`. Subphase 5 ships a reader RPC so the trail is verifiable rather than write-only.

**Not fixed here (out of scope, flag to owner):** re-revoking `log_activity` from `authenticated` to restore `docs/phase1_addendum_s1.sql:27-30`. Zero TS callers exist, so it is safe — but it is an unrelated security fix and belongs in its own commit.

---

## SUBPHASES

### S1 — SQL foundation: settings singleton, claim probe, audit wrapper. **No enforcement.**

**Why:** Establish the mode carrier, the audit writer, and — critically — *prove* whether Postgres can see `aal` in this project before a single line of enforcement is written. Ships entirely inert: nothing calls `mfa_ok()` yet.

**Files:**
- `docs/mfa_foundation_batch_s1_RUNME.sql` (new)
- `tests/mfa_foundation_s1.test.js` (new)

**SQL (additive, idempotent, no DROP):**
1. `create table if not exists public.mfa_settings (id int primary key default 1 check (id = 1), enforcement_mode text not null default 'off' check (enforcement_mode in ('off','enrollment')), applies_to text not null default 'privileged' check (applies_to in ('privileged','owner_only')), updated_by uuid references auth.users(id), updated_at timestamptz not null default now())` + `insert ... (1) on conflict do nothing` + `enable row level security` with **no read policy** + `revoke insert,update,delete ... from authenticated, anon`.
2. `mfa_claim_probe()` — §B, `stable`, exception-isolated, `revoke from public, anon` / `grant to authenticated`.
3. `mfa_settings_get()` → jsonb, gated `is_staff()`.
4. `mfa_admin_set_mode(p_mode text)` → boolean, gated **`is_owner()` only**, raises on unknown mode, calls `mfa_audit('mode_changed', auth.uid(), jsonb_build_object('mode', p_mode))` **without** an `exception when others then null` swallow around it.
5. `mfa_audit(text,uuid,jsonb)` — §E, revoked from `authenticated`.
6. Self-test `do $$ ... end $$` block in the house style of `docs/project_platform_authz_hardening_RUNME.sql:129-158`, including `has_function_privilege('anon', oid, 'EXECUTE')` assertions.
7. **No** trailing `update ... set enforcement_mode = 'enrollment'` — unlike `docs/project_hierarchy_batch6a_RUNME.sql:207`, this file must never auto-activate.

**Tests (static, `node --test`, house style of `tests/authz_null_collapse.test.js`):**
- CHECK constraint permits exactly `('off','enrollment')` and **not** `'enforced'`.
- Default is `'off'`.
- `mfa_admin_set_mode` gate text is `is_owner()` and contains neither `can_manage_projects` nor `staff_role`.
- `mfa_audit` carries `revoke ... from public, anon, authenticated`.
- File contains no `drop table`, no `drop function`, no `delete from`.
- **Guard test:** the file contains no `create or replace function public.(is_admin|is_owner|is_staff|staff_role|can_manage_projects|staff_reads_all_projects|pc_can_read_project)\b`.

**Risk:** Very low — inert. The residual risk is the probe returning "no `aal`", which is exactly what we want to learn now rather than after enforcement is built.

---

### S2 — TOTP enrollment over GoTrue REST (owner-facing UI)

**Why:** Nothing can be enforced until the owner holds a factor. `@supabase/supabase-js` is not a dependency (`package.json:13-21`: `@dnd-kit/*`, `framer-motion`, `next`, `qrcode`, `react`, `react-dom`), so `supabase.auth.mfa.enroll/challenge/verify` are not callable. We call the identical GoTrue endpoints the SDK wraps — same service, same `auth.mfa_factors`, same `aal` claim, **no parallel auth system**, no new dependency, no second session store.

**Files:**
- `lib/portal/mfa.ts` (new) — `mfaListFactors()`, `mfaEnrollTotp()`, `mfaChallenge()`, `mfaVerify()`, `mfaUnenroll()`. Raw `fetch` in the house style, sending `apikey: SUPABASE_KEY` **plus** `Authorization: Bearer <access_token>` and supporting `GET`/`POST`/`DELETE`.
- `components/portal/MfaEnrollment.tsx` (new) — QR + manual secret + 6-digit verify.
- `components/portal/ProfileSettings.tsx` (edit) — mount `<MfaEnrollment/>`; this is the correct per-user home, routed at `app/client-portal/profile/page.tsx:4`.
- `tests/mfa_client_s2.test.js` (new)

**Endpoints:** `POST /auth/v1/factors` (`{factor_type:'totp', friendly_name}`) → `POST /auth/v1/factors/{id}/challenge` → `POST /auth/v1/factors/{id}/verify` (`{challenge_id, code}`); `GET /auth/v1/factors`; `DELETE /auth/v1/factors/{id}`.

**Do NOT reuse `gotrue()`** at `lib/portal/auth.ts:45-55` — it is module-private, hardcodes `method: "POST"`, and sends no `Authorization` header. Add a sibling in `lib/portal/mfa.ts` rather than widening a helper three unauthenticated flows depend on.

**Secret handling — the owner's hard constraint:**
- The `secret` / `totp.uri` from the enroll response is held in React state only, rendered via `qrSvg()` (`lib/qr/qr.ts:15`, which runs client-side using the already-installed `qrcode@^1.5.4`), and dropped on unmount.
- It never reaches a Next.js route, never reaches Postgres, never reaches `console.*`, never reaches `localStorage`.
- No `console.log/error` of any GoTrue response body anywhere in `lib/portal/mfa.ts`; errors are mapped to a fixed code union, mirroring `mapAuthError` at `lib/portal/auth.ts:35-43`.

**On successful verify:** GoTrue returns a **new aal2 access_token**. It must be written through `saveSession()` (`lib/portalAuth.ts:53-55`) so the single existing session store carries it; every consumer — `lib/portal/client.ts:72` and all Bearer-passing API calls — then picks it up automatically. **No second session store.**

**SQL:** none.

**Tests:** `lib/portal/mfa.ts` contains no `console.`; the verify path calls `saveSession`; the module sends an `Authorization` header; MFA calls hit `/auth/v1/factors` (never `/rest/v1/`); no factor secret is passed to any `prpc`/`ppost`/`fetch('/api/...')`.

**Risk:** Low-medium. Real risk is UX, not security: enrollment failure leaves the user unenrolled, which is the safe state. Verify that MFA is enabled in the Supabase dashboard first (owner step) or `POST /auth/v1/factors` returns 422.

> **HARD GATE:** the owner must complete enrollment and paste the `mfa_claim_probe()` output before S4 is written.

---

### S3 — Server-side assurance visibility + step-up UI. **Still no denial.**

**Why:** `authGetUserId` (`lib/server/supabaseAdmin.ts:119-130`) parses the GoTrue response into `{ id?: string }` and returns only `u.id` at `:128` — 25 call sites, all assurance-blind. Add a sibling (never modify the existing signature). Ship the step-up modal *before* anything can deny, so the recovery UI exists before the failure it recovers from.

**Files:**
- `lib/server/supabaseAdmin.ts` (edit — **additive export only**): `authGetUserAssurance(bearer): Promise<{ userId: string|null; hasFactor: boolean; aal: string|null }>`, reading `factors[]` from the same `GET /auth/v1/user` call.
- `lib/server/mfaAssert.ts` (new): `assertMfaOk(bearer)` → `{ ok: true } | { ok: false; status: 403; reason: 'mfa_required' }`, modeled on `assertHrAdmin` (`lib/server/hrAuth.ts:74-118`), including its **503-for-infrastructure-failure vs 403-for-genuine-denial** distinction — so an MFA outage never reads as a permission denial and never escalates into a lockout.
- `components/portal/MfaStepUp.tsx` (new) — challenge/verify modal.
- `components/portal/PortalShell.tsx` (edit) — mount the modal; **do not** add a `Phase` value (the `Phase` union at `:51` gates the whole shell; an MFA phase there would block reads). Add a comment stating the modal is UX only and non-protective.
- `lib/portal/client.ts` (edit) — classify a `mfa_required` PostgREST error into a distinct result code so callers can raise the modal.
- `tests/mfa_server_s3.test.js` (new)

**Critical: never decode the JWT in TypeScript to read `aal`.** Two in-tree precedents base64-decode the payload with no signature verification — `app/api/integrations/zoho/accept-with-billing/route.ts:36-42` and `app/api/integrations/whatsapp/books-estimate/route.ts:25-33`. Both are safe *only* because their output is re-validated by PostgREST or used for attribution. An `aal` check built that way is forgeable by editing one base64 segment. Assurance comes from the verified GoTrue call or from `request.jwt.claims` inside Postgres. Nowhere else.

**SQL:** none.

**Tests:** `authGetUserId`'s signature is unchanged (25 callers keep compiling); `mfaAssert.ts` contains no `atob`/`Buffer.from(...,'base64')` JWT decode; the 503-vs-403 branch exists; `PortalShell.tsx`'s `Phase` union is unchanged.

**Risk:** Low. Additive; nothing denies yet.

---

### S4 — `mfa_ok()` + enforcement at named write RPCs. Mode still `'off'` at ship time.

**Why:** The actual control. Gated on the S1 probe confirming `aal` arrives.

**Files:**
- `docs/mfa_enforcement_batch_s4_RUNME.sql` (new)
- `tests/mfa_enforcement_s4.test.js` (new)

**SQL — `public.mfa_ok()`, in strict order:**
1. If `role = 'service_role'` → `return true` (crons, webhooks, `rpcAsService`).
2. If `auth.uid() is null` → `return true` (no session ⇒ some other gate is doing the denying; MFA is not an authentication substitute).
3. Read `enforcement_mode` from `mfa_settings`; if `'off'` → `return true`.
4. Read `aal` from `current_setting('request.jwt.claims', true)::jsonb`. If claims unreadable or `aal` absent → `return true` (**fail-open by design; inline comment explains why**).
5. If `aal = 'aal2'` → `return true`.
6. If the caller has **no verified factor** in `auth.mfa_factors` → `return true`. ← *the anti-lockout invariant*
7. Otherwise → `return false`.
8. `exception when others then return true;`

Plus `mfa_require()` — a plpgsql helper raising `insufficient_privilege` with `message = 'mfa_required'` (SQLSTATE `42501` → HTTP 403, matching the repo's denial convention at `docs/project_platform_authz_hardening_RUNME.sql:172`), composed as the **first statement** of a small, explicitly-named set of privileged **write** RPCs:

`admin_set_account`, `admin_set_staff_role`, `admin_set_profession_permission`, `admin_set_employee_override`, `custody_enterprise_admin_update_flags`, `mfa_admin_set_mode`… — **wait, no**: `mfa_admin_set_mode` is on the §D-7 exclusion list and must never be gated. Final list to be fixed in the RUNME header; ~6-10 functions maximum, each verified with `grep` to confirm no RLS policy references it.

**Zero RLS policies are touched. Zero read paths are touched.**

**Tests:** service_role bypass is the first branch; a `no verified factor ⇒ true` branch exists; the terminal exception handler returns `true`; no `coalesce(..., false)` in `mfa_ok`; the guard test from S1 re-run against this file; `mfa_admin_set_mode` / `mfa_settings_get` / `mfa_claim_probe` do **not** call `mfa_require()`; the enforced-function list contains no function name appearing in any `create policy` statement across `docs/*.sql` (mechanically greppable).

**Risk:** **Highest in the plan.** Mitigations: ships with mode `'off'` so it is inert until the owner deliberately flips it; the probe has already proven the claim; the no-factor invariant means even a mistaken flip cannot lock out an unenrolled user; two independent revert levers (§D-2).

---

### S5 — Coverage for TS-decision routes, audit reader, owner Security panel

**Why:** Close the four routes that decide authorization in TypeScript from a service-role `profiles` read and therefore inherit nothing from S4 — and make the MFA trail readable, since `activity_log` has no `authenticated` grant (`docs/phase0_migration.sql:765-767`) and an admin-only SELECT policy (`:874`), so today MFA rows would be write-only.

**Files:**
- `app/api/rental/evidence/upload-url/route.ts` (edit — `:51-56`)
- `app/api/integrations/rental/notify/route.ts` (edit — `:96-102`)
- `app/api/integrations/hr/my-tasks/route.ts` (edit — `:35-40`)
- `app/api/integrations/project/notify-admin/route.ts` (edit — `:130-134`)
- `docs/mfa_audit_reader_s5_RUNME.sql` (new) — `mfa_audit_recent(p_limit int)` selecting `activity_log where action like 'mfa.%'`, gated `is_owner()` **inside the function body**, `revoke from public, anon` / `grant to authenticated`.
- `lib/portal/mfa.ts` (edit) — reader + mode wrappers.
- `components/portal/MfaAdminPanel.tsx` (new)
- `app/client-portal/admin/page.tsx` (edit) — replace the `ComingSoon step="S9"` stub at `:20` with the Security panel. Existing routed admin page; guard at `:11` is **CLIENT-ONLY** and must be documented as such — the protection is `is_owner()` inside the RPC.
- `tests/mfa_coverage_s5.test.js` (new)

**Note on the four routes:** the *right* fix is converting them to `rpcAsUser` against a DB gate, which would simultaneously close the drift the audit found (`upload-url/route.ts:51-52` is the only authorization check under `app/api` that omits `account_status`, so an inactive `custody_officer` still mints signed Storage upload URLs at `:81-83`). That is a real bug but a **separate concern**. This subphase adds only the `assertMfaOk` call; the `account_status` fix goes in its own commit so a security fix is not buried inside a feature batch.

**Tests:** each of the four routes calls `assertMfaOk`; `mfa_audit_recent` is `is_owner()`-gated with `revoke from public, anon`; the reader returns no metadata key matching `/secret|code|uri|qr/i`.

**Risk:** Low-medium. Route edits could over-gate a legitimate caller; bounded because `mfa_ok()` is inert while mode is `'off'`.

---

## IN-REPO vs OWNER

**In-repo (I do this):** all SQL files, `lib/portal/mfa.ts`, `lib/server/supabaseAdmin.ts` additive export, `lib/server/mfaAssert.ts`, all components, the four route edits, all five test files, `tsc`/`next build`/`node --test` verification, adversarial review.

**Owner-only — cannot be done from the repo, must be done in this order:**

1. **Supabase Dashboard → Authentication → Providers/MFA: enable TOTP.** Blocks S2; `POST /auth/v1/factors` returns 422 without it.
2. **Run `docs/mfa_foundation_batch_s1_RUNME.sql`** in the Supabase SQL editor.
3. **Run `select public.mfa_claim_probe();` while signed in as the owner** and paste the JSON back. **This is the hard gate on S4.** Expect `{"uid_present":true,"claims_present":true,"aal":"aal1",...}`. If `aal` is `null`, S4 changes shape (§B fallback).
4. **Scan the QR with an authenticator app and enter the 6-digit code** (S2 UI). Physical act; cannot be automated. Store the authenticator backup/export somewhere recoverable.
5. **Re-run the probe after enrolling** — must now show `"aal":"aal2"`. This confirms end-to-end claim propagation before S4 is written.
6. **Run `docs/mfa_enforcement_batch_s4_RUNME.sql`** and `docs/mfa_audit_reader_s5_RUNME.sql`.
7. **Flip the mode — last, and only after 1-6:** `update public.mfa_settings set enforcement_mode = 'enrollment' where id = 1;`
8. **`git push`** (repo memory records that push is user-manual — no credentials here).

**Break-glass card — save this outside the portal, before step 4:**
```sql
-- 1) turn enforcement off (Supabase SQL editor)
update public.mfa_settings set enforcement_mode = 'off' where id = 1;
-- 2) remove a lost factor for a locked-out user
delete from auth.mfa_factors where user_id = '<owner-uuid>';
```
Both run in the Supabase SQL editor — a credential path independent of the portal login and of Vercel.

**Explicitly NOT in Phase 2:** `'enforced'` mode (blocked by CHECK constraint); Supabase session time-box / inactivity-timeout dashboard settings (affects every user, needs separate owner approval and testing against the five broken 401 handlers at `lib/portal/custody.ts:217`, `custodyInventory.ts:360`, `projectCore.ts:647`, `rental.ts:378`, `hr.ts:787`); re-revoking `log_activity` from `authenticated`; the `account_status` gap at `app/api/rental/evidence/upload-url/route.ts:51-52`.