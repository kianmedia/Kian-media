# Vendor & Compliance Center — Go-Live

## 0) What this package reuses vs. creates

**REUSED — extended, never duplicated**

| Object | Why not a new one |
|---|---|
| `public.tvn_documents` | **The** document registry. Company documents are rows with `owner_kind='company'`. A third registry would mean three answers to "is this certificate valid?" — `hr_employee_documents` already gives a second, unverified one. |
| `public.tvn_document_types` | New types (GOSI, Zakat, ZATCA, Nitaqat, national address, chamber, HSE, privacy, AR/EN company profile, …) are **data rows**, plus one additive `never_public` column. |
| `public.tvn_doc_valid()` | The single definition of "valid". **Extended** with a `company` branch; the three existing branches are byte-identical in meaning. |
| `public.tvn_audit` / `tvn_log()` | One audit trail. No second audit table. |
| `public.tvn_event_log` + `comms_*` | One event queue. No second notification pipeline. |
| `public.can_verify_compliance()` | Composed into `can_verify_compliance_documents()` so existing verifiers keep working. |
| `public.opportunity_requests` | Referenced read-only. No second public form, no trigger, no auto-copy, no email. |
| `permissions` / `emp_has_permission` | The shared permission catalogue. Keys are registered, never granted. |

**CREATED — nothing existed (verified across 319 tables)**

`vcc_company_profile`, `vcc_company_contacts`, `vcc_certifications`, `vcc_references`,
`vcc_industry_experience`, `vcc_drone_capability`, `vcc_readiness_requirements`,
`vcc_registration_requests` (+ `_checklist`, `_comments`, `_attachments`),
`vcc_document_grants`, `vcc_grant_documents`, `vcc_grant_access_log`, `vcc_settings`,
and the private storage bucket `compliance-documents`.

**Deliberately NOT created:** a third document registry, a second audit table, a second
notification queue, a second public intake form, a public bucket, any `anon` grant.

`_bak_tvn_documents` is a rollback-era backup snapshot. It is **documented and untouched** —
nothing in this package reads it, and no new surface may.

---

## 1) Run order

```
1. docs/vendor_compliance_center_PREFLIGHT.sql   ← read every verdict column
2. docs/vendor_compliance_center_RUNME.sql       ← one transaction, idempotent
3. docs/vendor_compliance_center_POSTCHECK.sql   ← one result set; all rows PASS or INFO
```

**Dependency:** `docs/talent_vendor_network_RUNME.sql` must already be applied.
The PREFLIGHT raises if `tvn_documents`, `tvn_document_types`, `tvn_audit`, `tvn_event_log`,
`tvn_doc_valid`, `tvn_log`, `can_verify_compliance`, `is_staff`, `is_owner` or `sha256(bytea)`
is missing, or if `tvn_doc_verify_not_self` has disappeared.

### The PREFLIGHT stop that matters most
`tvn_documents.storage_bucket` was unconstrained free text. The RUNME pins it to
`compliance-documents` with a CHECK. If **any** row points elsewhere, both the PREFLIGHT and
the RUNME abort and name the rows. Nothing in this package rewrites a storage reference
automatically — silently editing a file pointer hides evidence. Move the objects by hand,
update the rows deliberately, re-run.

The same applies to a company row holding a full `doc_number`: move it to
`doc_number_masked` yourself, then clear it.

## 2) Code before SQL

The code can ship first and is safe unapplied:

- Internal surfaces render **«الميزة بانتظار تفعيل قاعدة البيانات»** (PGRST202/42P01 →
  `pending_migration` via `lib/portal/pgerror.ts`).
- `/secure-document` reports "this service is not enabled yet" — **not** "invalid link". A
  recipient must not be sent chasing the wrong problem.
- Nothing crashes, nothing fabricates data, no misleading zero. `not_configured` readiness is
  shown as "the rules have not been written yet", never as 0 %.
- **Permission denied is never reported as a missing migration.**

## 3) Permissions to grant after applying

Registered but granted to nobody:

`compliance.view`, `compliance.manage_documents`, `compliance.verify_documents`,
`compliance.issue_grants`, `compliance.view_restricted`, `compliance.manage_registration`,
`compliance.view_request_status`, `compliance.view_operational_documents`

Grant them through the existing permission UI. Until then only the owner sees the centre —
fail-closed, by design. **Do not grant `manage_documents` and `verify_documents` to the same
person** if you want the separation to have teeth (the DB blocks self-verification of a
specific document either way).

## 4) Storage

Bucket `compliance-documents`: **private**, 20 MB, `application/pdf` + jpeg/png/webp.
Policies: SELECT via `vcc_storage_readable(name)` (sensitivity-aware, orphan-hostile) and
INSERT for `company/…` (document managers) or `registration/…` (registration managers).
**No UPDATE and no DELETE policy** — the bucket is append-only, so a file cannot be swapped
under an already-verified document.

Internal viewing signs **as the user** (browser session, RLS applies). The service key is used
in exactly one route, after the database has authorised.

## 5) Environment

| Variable | Needed for |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | `/api/public/secure-document` only. Without it the route returns `server_not_configured` — honest, and grants simply do not open. |
| `SECURE_DOCUMENT_FP_SALT` | Optional. Salt for the audit-log visitor fingerprint; falls back to the Supabase URL. |

## 6) Post-apply verification

1. POSTCHECK: every row `PASS` or `ℹ️ INFO`.
2. `/client-portal/compliance` loads; tabs match your permissions.
3. Register a document **without** a file → status `draft`; with a file → `uploaded`.
   ⚠️ It must **not** say verified.
4. Try to verify a document you uploaded → refused.
5. Verify as a second person → status `verified`; readiness count moves.
6. Create a grant → add a verified document → approve (owner) → issue → the token appears
   **once**. Open `/secure-document#<token>` in a private window.
7. Revoke the document → reload the link → the document disappears / is refused, and the
   denial is in `vcc_grant_audit`.
8. Revoke the grant → the link stops entirely.

## 7) Rollback

`docs/vendor_compliance_center_ROLLBACK.sql`. Sections 1, 2 and 4 are safe (behaviour and UI
disappear, the bucket closes, **no row is lost**). Sections 5–7 destroy real history — the
access log, the manual-submission evidence, the client citation permissions, the verification
trail — and are commented out. Read the header before copying a line.

⚠️ Sections 1 and 3 must be run together or not at all: dropping the normalising trigger while
keeping the new CHECKs makes every legacy `tvn_document_upsert` fail with 23514, which reads
like a missing migration and is not.
