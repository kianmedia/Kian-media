# External Content & Documents — Current State Audit
**Batch 1 of التميّز الخارجيّ V1.** Read-only audit. No SQL was run, nothing was changed.
Scope: what already exists for *documents* and for *public content*, so Batches 2–4 extend
instead of duplicating. HEAD `dc88c4c`, tree clean.

Every claim below was read out of the repo (SQL files, components, storage policies), not
recalled. File + line are given so a build agent can verify before depending on it.

---

## 1) Existing tables

### 1.1 Document registries — there are already **two** (plus one corpse)

| Table | Defined in | Purpose | Verification? | File reference model |
|---|---|---|---|---|
| `public.tvn_documents` | `talent_vendor_network_RUNME.sql:450` | Talent/vendor compliance documents | **Yes** — full workflow | `storage_bucket` + `storage_path`, both `text`, **unconstrained** |
| `public.tvn_document_types` | `talent_vendor_network_RUNME.sql:437` | Type catalogue: `applies_to`, `is_required`, `requires_expiry`, `is_identity`, `is_financial`, `reminder_days` | n/a | n/a |
| `public.hr_employee_documents` | `portal_hr_v3_1_ops_polish_PATCH_RUNME.sql:534` | HR personnel documents | **No** — no verified/verified_by | `file_url text` (a single free-text URL) |
| `public._bak_tvn_documents` | `talent_vendor_network_ROLLBACK.sql:72` (commented backup step) | Leftover backup snapshot | — | — |

`_bak_tvn_documents` is a rollback-era copy. **Documented, not built on.** It has no RLS
story of its own in the repo and must not be read by any new surface.

`tvn_documents` carries the whole verification contract (`docs/VENDOR_COMPLIANCE_CONTRACT.md`):
- `tvn_doc_verify_not_self` — a table-level CHECK: uploader ≠ verifier (`:480`).
- Changing `storage_path` auto-clears `verified`/`verified_by`/`verified_at` (`:1317-1321`).
- `tvn_document_upsert` never accepts `verified` from the caller (`:1274`).
- `owner_kind` CHECK is `('profile','vendor','asset')` (`:453`) with `tvn_doc_owner_exact`
  enforcing exactly one owner column (`:475`). **There is no `company` owner today.**
- Seeded types already include: national id, iqama, passport, commercial register, tax
  certificate, bank letter, insurance policy, general liability, safety certificate,
  drone permit, driving licence, NDA, contract.
- Validity is one function: `tvn_doc_valid()` (`:692`) = `verified AND (expires_on IS NULL OR expires_on >= current_date)`.
- Readiness/alerts already exist: `tvn_missing_required_docs()` (`:713`), `tvn_document_alerts(p_scan)` with 90/60/30/7 windows.
- RLS `tvn_docs_read` (`:2127`): `restricted` rows → `can_verify_compliance() OR tvn_can_view_bank()`; others → `can_view_talent_network()`. Wrapped in `coalesce(...,false)` — no NULL collapse.

⚠️ **`tvn_documents` has no storage bucket.** No `insert into storage.buckets` anywhere
names a tvn bucket, and no `storage.objects` policy mentions one. The columns exist; the
storage side was never built. See §3.4 — this is the single most important gap in the brief.

⚠️ **`lib/portal/talentNetwork.ts` exists but has NO UI.** `grep -rn talentNetwork app components`
returns nothing. The whole TVN module is code-only, SQL-unapplied, screen-less.

### 1.2 Public intake & abuse control

| Table | Defined in | Notes |
|---|---|---|
| `public.public_intake` | `production_restore_latest_quotes_zoho_RUNME.sql:1207` | quote/meeting/call/files/contact/other. RLS `public_intake_read` (`:1233`) = own `user_id` **or** matching verified email **or** `is_staff()`. **Anon reads nothing.** Contains `file_links jsonb` — `[{label,url}]` supplied by the visitor. |
| `public.public_rate_limits` | `public_portal_rate_limit_RUNME.sql:37` | Durable fixed-window counters. `revoke all ... from anon, authenticated` (`:53`). |
| `public.opportunity_requests` / `_notes` | `opportunities_center_RUNME.sql:20,49` | `select` granted to `authenticated` only; **no anon grants**; writes only through SECURITY DEFINER RPCs. |

`rl_consume(text,int,int)` (`public_portal_rate_limit_RUNME.sql:57`) is SECURITY DEFINER,
`service_role` only, called from *inside* `submit_opportunity_request`. That RPC **is** granted
to `anon` (`:195`) and the file explains at `:13` why revoking it would kill the public form.
Its POSTCHECK asserts anon still has EXECUTE on the form RPC and does **not** have it on
`rl_consume`, and that anon cannot SELECT the counters (`:213-220`).
➡️ Any new anon-callable RPC in Batches 2–4 must reuse `rl_consume`, not invent a limiter.

### 1.3 Portfolio / works / sectors / testimonials / media

Enumerated every `create table if not exists public.*` across all 384 files in `docs/` (319
distinct tables). **Grep for `case_stud`, `portfolio_item`, `publication`, `testimonial`,
`company_profile`, `site_settings`, `brand_` returns nothing.**

The only media-ish tables are internal production ones, unrelated to publishing:
`ops_media_cards` / `ops_media_backups` (`operations_center_RUNME.sql:405`) — camera cards and
offload/backup state for a shoot.

⇒ Case studies, public publishing and a company profile have **no existing home**. Creating
those tables is correct and does not duplicate anything.

---

## 2) Public pages, and how work is displayed today

`app/page.tsx` composes fifteen hardcoded components. **Nothing on the public site reads the
database.** Every number, logo, quote and video on the homepage is a literal in a `.tsx` file.

| Surface | File | Data source |
|---|---|---|
| Showreel | `components/Showreel.tsx:6` | one hardcoded YouTube id (`JN5MRQuEP4M`) |
| Works grid | `components/Portfolio.tsx` | `ITEMS[]` — hardcoded YouTube ids, 9 categories, per-item AR/EN title + description, client-side filter. No DB, no images, no slugs, no permalinks. |
| Stats | `components/Stats.tsx:12-15` | hardcoded counters (20+ years, 4000+ productions, 2000+ clients, 13 regions) |
| Industries/sectors | `components/Industries.tsx:5` | 15 hardcoded bilingual entries |
| Clients | `components/Clients.tsx` → `lib/clients.ts:12` | static array + logo files in `/public/clients/*.png` |
| Reviews | `components/Reviews.tsx` | **an honest empty state** — "real experiences will appear here soon" + a WhatsApp CTA. No testimonial data at all. |
| Testimonials | `components/Testimonials.tsx` | 3 hardcoded quotes + its **own** `CLIENTS` array — **imported nowhere. Dead code.** |

Public routes: `/`, `/quote-request`, `/book-meeting`, `/upload-files`, `/opportunities`,
`/quick-access`, `/privacy-policy`, `/terms`.
`app/robots.ts` disallows `/api/`, `/client-portal/`, `/admin/`, `/quick-access/`.
`app/sitemap.ts` is a **static 7-route list** and says so explicitly ("no query and no chance
of leaking a private URL"). A public case-study route therefore needs a deliberate sitemap
edit — that file is **not** in the freeze list.

Public write paths (only two):
1. `/opportunities` → `submit_opportunity_request` (anon RPC, rate-limited 30/hour/type, `:156`).
   Ten request types incl. `supplier`, `freelancer`, `talent`, `media_partnership` (`lib/opportunities.ts:33-157`).
2. `/quote-request`, `/book-meeting`, `/upload-files` → `app/api/public/intake/route.ts` → `public_intake`.

---

## 3) STORAGE — every bucket, who reads it, and can anything be enumerated

### 3.1 The bucket inventory

**Ten buckets. Every single one is `public = false`.** No `insert into storage.buckets` in the
repo sets `public` to true, and every `on conflict do update` re-forces `public=false`. There
is no anon storage grant anywhere.

| Bucket | Defined | Limit / MIME | SELECT (read *and* list) | INSERT |
|---|---|---|---|---|
| `hr-files` | `portal_hr_employee_portal_RUNME.sql:838` (mime widened to +pdf at `portal_hr_v3_1_task_details_delivery_notify_FIX_RUNME.sql:48`) | 10 MB, images(+pdf) | `can_manage_hr() OR foldername[1] = auth.uid()` | `foldername[1] = auth.uid()` |
| `hr-docs` | `portal_hr_v3_1_task_notify_docs_upload_FIX_RUNME.sql:245` | 10 MB, img+pdf | `can_manage_hr() OR` (employee's own visible, non-deleted `hr_employee_documents` rows) | `can_manage_hr()` only |
| `custody-evidence` | `portal_equipment_custody_rental_RUNME.sql:520` | 10 MB, images | `can_manage_custody() OR foldername[1] = auth.uid()` | `foldername[1] = auth.uid()` |
| `custody-inventory-assets` | `portal_custody_inventory_system_v1_RUNME.sql:1320` | 10 MB, img+pdf | `civ_can_manage()` | `civ_can_manage()` |
| `custody-inventory-evidence` | `portal_custody_inventory_system_v1_RUNME.sql:1325` | 10 MB, images | `civ_can_manage() OR foldername[1] = auth.uid()` | same |
| `custody-inventory-signatures` | `custody_enterprise_02_projects_conditions_PATCH.sql:145` | 3 MB, images | `civ_can_manage() OR foldername[1] = auth.uid()` | `foldername[1] = auth.uid()` |
| `rental-evidence` | `rental_insurance_production_RUNME.sql:806` | 20 MB, images | v2: `civ_can_manage() OR civ_can_finance() OR rental_evidence_is_owner(name,false)` (`rental_evidence_storage_rls_FIX_RUNME.sql:57`) | v2: manager **or** owner, and `foldername[1]='rental'` |
| `rental-contracts` | same, `:806` | 10 MB, pdf+img | `civ_can_manage() OR civ_can_finance()` | `civ_can_manage()` |
| `rental-private-documents` | same, `:806` | 10 MB, pdf+img | `civ_can_finance() OR civ_can_admin()` | same |
| `project-deliverables` | `project_core_ABSOLUTE_FINAL_RUNME.sql:1626` | 100 MB | `is_staff()` | `is_staff()` |

**No bucket exists for `tvn_documents`, and none for public/marketing media.**

### 3.2 Path patterns and whether they can be guessed

| Bucket | Path shape | Guessable by construction? |
|---|---|---|
| `custody-evidence` | `{user_id}/{record_id}/before\|after/{key}.jpg` — `lib/portal/custody.ts:204` | **Yes, fully deterministic.** Two UUIDs + a fixed enum + a fixed key. |
| `custody-inventory-*` | `{user_id}/…` / asset-scoped, `lib/portal/custodyInventory.ts:402` | Partly |
| `rental-evidence` | `rental/{rental_id}/handover/{item}/{uuid}.ext` | UUID leaf — no |
| `hr-files` | `{user_id}/…` | Partly |

The honest reading: **determinism is not the vulnerability today, because in Supabase the
`storage.objects` SELECT policy gates *listing* as well as reading**, and no bucket is public.
Guessing `<uuid>/<uuid>/before/front.jpg` gets a 400/404 without the right JWT.

But it means the safety margin is exactly one mistake wide. The moment any of these happens,
guessable paths become instant enumeration:
- a bucket is flipped `public = true`;
- a server route signs a **caller-supplied** `{bucket, path}` with the service key;
- an anon-callable RPC returns a storage path.

None of the three is true today. **All three must stay false in Batches 2–4.**

### 3.3 The one service-key signing route — the pattern to copy

`app/api/portal/deliverable-download/route.ts` is the only place a service key mints a signed
URL. Its shape is correct and should be the template:
1. It first calls `client_download_deliverable` **as the caller** (Bearer token → RLS + the
   `final_delivered` + dues-cleared gate + the download log row).
2. Only on success does it sign, for **300 seconds**, a `{bucket, path}` derived from the value
   the RPC returned — never from the request body.

Note `toStorageRef()` accepts a bare `"bucket/path"` string, so the bucket is chosen by stored
data. That is safe *only* because the stored value is staff-written and the gate ran first.
Contrast `lib/portal/custodyInventory.ts:442`, which signs for **3600 s** — but as the *user*,
under RLS, so the token it hands out is scoped to what that user could already read.

**Signed URLs are bearer tokens.** Anyone holding the string reads the object until it expires,
with no further auth. Short TTLs are the only control.

### 3.4 Where a document could be exposed — ranked

1. 🔴 **`tvn_documents.storage_bucket` / `storage_path` are unvalidated free text.**
   `tvn_document_upsert` reads both straight out of `p_input` (`:1304`, `:1314-1315`) with no
   allow-list, no prefix check, and no CHECK constraint on the table. Any holder of
   `can_manage_talent_profiles()` can create a "compliance document" row pointing at
   `project-deliverables/…` or `rental-private-documents/…`. Today nothing signs those columns,
   so nothing leaks. **The instant a compliance UI signs `(storage_bucket, storage_path)` with
   the service key, that row becomes a universal cross-bucket read oracle** — a person who
   cannot see finance documents writes a document row aimed at them and reads them through the
   compliance screen. Batch 2 must (a) pin `storage_bucket` to one new dedicated bucket via a
   CHECK, (b) validate the path prefix, and (c) sign **as the user** under a storage policy, not
   with the service key.
2. 🔴 **`hr_employee_documents.file_url` is a single free-text URL** with no bucket/path split
   and no constraint. Nothing stops an admin pasting a Drive "anyone with the link" URL, which
   then lives entirely outside RLS and outside every policy in §3.1. This is an existing,
   already-live precedent for a document escaping the database's control. Do not copy it.
3. 🟠 **`public_intake.file_links jsonb`** stores visitor-supplied `[{label,url}]` from
   `/upload-files`. Untrusted external URLs, rendered to staff. Any new surface that displays
   them must treat them as hostile text (`href` sanitising, no auto-fetch).
4. 🟠 **Four buckets let *any* authenticated user write into `<their-uid>/…`** (`hr-files`,
   `custody-evidence`, `custody-inventory-evidence`, `custody-inventory-signatures`). A client
   account — not just staff — passes that check. Not a read leak, but an unbounded write
   surface. It matters because `lib/portal/custodyInventory.ts:428-432` has a server RPC that
   reads `storage.objects` directly and reports `source: "storage_orphan"` — a listing that
   trusts storage rather than the DB table can surface a blob nobody vetted.
5. 🟡 **Role mismatch if an existing bucket is reused.** `rental-private-documents` is gated on
   `civ_can_finance() OR civ_can_admin()`. Putting Kian's legal/GOSI/ZATCA file there would
   silently hand the whole company legal record to everyone with the finance role. Compliance
   needs its **own** bucket gated on `can_verify_compliance()`.

### 3.5 Existing public or temporary links

- **No public bucket, no permanent public URL, no `getPublicUrl` call anywhere in the repo.**
- **No token table.** Grep for `*_tokens` / `*token*` tables returns nothing — there is no
  magic-link, no share-link, no expiring public token mechanism in the system at all.
- Temporary access is only ever a **signed storage URL** (300 s deliverables, 3600 s custody).
- The one row-level, time-bounded grant model that exists is `client_project_access`
  (`project_hierarchy_security_RUNME.sql:54`): per-user, per-project booleans plus
  `starts_at` / `expires_at` / `revoked_at` / `granted_by` / `note`. **That is the shape a
  document access-grant table should copy** — and it is scoped to `auth.users`, never to anon.

---

## 4) Duplicated data sources (a new module must not add a fourth)

| Fact | Lives in | Risk |
|---|---|---|
| "Is this certificate valid?" | `tvn_documents` (verified+expiry) · `hr_employee_documents` (no verification at all) | Two answers already. A third registry = three. |
| Client names | `lib/clients.ts` · `components/Testimonials.tsx` (own copy) · `/public/clients/*.png` filenames | A case-study `client_name` becomes a 4th. Prefer a slug that points at `lib/clients.ts`. |
| Vendor identity | `tvn_profiles` · `custody_vendors` (`custody_enterprise_07_…:10`) | Already bridged: `tvn_documents.vendor_id` references `custody_vendors.id`. |
| Published work | `components/Portfolio.tsx` `ITEMS[]` · the frozen `projects`/`deliverables` platform | Case studies are a **third**, authored surface. That is acceptable **only** if it is authored by hand and never auto-copies project data. |
| Testimonials | `components/Reviews.tsx` (empty state) · `components/Testimonials.tsx` (dead) | Pick one home. Do not revive the dead component as the data source. |

---

## 5) Decision table

| Capability | Verdict | What exactly |
|---|---|---|
| **Company profile** | 🆕 **NEW (small)** | Nothing exists — no `company_profile`, `site_settings` or equivalent in 319 tables. A single-row table inside the compliance package. Keep it internal; the public site does not need it in V1. |
| **Legal / tax / GOSI / ZATCA documents** | ♻️ **EXTEND `tvn_documents`** | Commercial register, tax certificate, bank letter, insurance, liability, safety, drone permit, NDA, contract are **already seeded types**. GOSI + ZATCA + Saudization = new `tvn_document_types` rows (data, not schema). Company-owned documents need one additive change: widen the `owner_kind` CHECK with `'company'` and add the matching branch to `tvn_doc_owner_exact`. **No third registry.** |
| **Verification workflow** | ✅ **ALREADY EXISTS** | `tvn_doc_verify_not_self` CHECK, `verified/_by/_at`, path-change auto-invalidation, `can_verify_compliance()`, `tvn_document_upsert` refusing `verified`. Reuse verbatim; do not write a parallel verify function. |
| **Sensitivity levels** | ⚠️ **PARTIALLY EXISTS — extend, don't replace** | Today sensitivity is one boolean: `tvn_documents.restricted`, derived from `is_identity OR is_financial`. If more than two levels are needed, add an **additive** `sensitivity` column backfilled from `restricted`, and **keep `restricted`** — the live `tvn_docs_read` policy reads it. |
| **Secure access grants** | 🆕 **NEW table, existing pattern** | No document-level grant exists. Model it on `client_project_access` (`starts_at`/`expires_at`/`revoked_at`/`granted_by` + audit). Authenticated subjects only; **anon never**. |
| **Vendor registration requests** | ✅ **ALREADY EXISTS — compose** | `/opportunities` already has `supplier`, `freelancer`, `talent`, `media_partnership` types → anon `submit_opportunity_request` (rate-limited) → `opportunity_requests`. Build the *promotion* step (accepted request → `tvn_profiles`), **not a second public form**. |
| **Compliance readiness** | ✅ **ALREADY EXISTS — compose** | `tvn_doc_valid()`, `tvn_missing_required_docs()`, `tvn_document_alerts(p_scan)` with 90/60/30/7. A company-level readiness read must call these, never re-implement validity. Remember: enqueuing an alert is not sending one. |
| **Case studies** | 🆕 **NEW TABLES — correct** | Confirmed absent. May carry an **optional, read-only** `project_id`; must never expose it publicly and must never auto-copy project content. |
| **Public case study pages** | 🆕 **NEW route** | No dynamic public route exists. Public read only where `published AND publish_at <= now() AND NOT archived AND approved-for-public`, via a SECURITY DEFINER read RPC (explicit boolean, pinned `search_path`). No anon editing RPC. Sanitise HTML; guard CSV exports against formula injection. Add the route to `app/sitemap.ts` (not frozen). Before the SQL runs, the section **hides** — public pages never show "coming soon" fake data or a misleading zero. |
| **Media publishing** | 🆕 **NEW — and the storage decision must be explicit** | No table, no bucket, and today **every public image is a repo file under `/public/`**. Preferred: keep published media as repo/CDN assets — zero new bucket, zero new exposure. If a bucket is unavoidable it becomes **the only public bucket in the system**: random-UUID path segments (never `{id}/{slug}`), approved-published media only, and never shared with anything private. |

---

## 6) Non-negotiables carried into Batches 2–4

1. **One document registry.** Extend `tvn_documents`; `_bak_tvn_documents` stays untouched.
2. **A new private `compliance-documents` bucket**, gated on `can_verify_compliance()` /
   `can_manage_talent_profiles()`, with `tvn_documents.storage_bucket` CHECK-pinned to it.
   Reusing `rental-private-documents` leaks the company legal file to the finance role.
3. **Never sign a caller-supplied bucket/path with the service key.** Authorise first, derive
   the path from the RPC result, keep TTLs short — the `deliverable-download` shape.
4. **No public bucket** unless §5's media row forces one, and then only under its conditions.
5. **Anon gets no internal RPC**; any anon-callable RPC reuses `rl_consume`.
6. **Code ships before SQL**: internal surfaces render «الميزة بانتظار تفعيل قاعدة البيانات»;
   public surfaces hide the section. Classify errors through `lib/portal/pgerror.ts` —
   permission-denied is never a missing migration.
7. **The project platform is frozen.** `tests/project_platform_freeze.test.js` guards 31 paths;
   `app/sitemap.ts` and `app/robots.ts` are not among them.
