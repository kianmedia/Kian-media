# Vendor & Compliance Center — Role Matrix

**Package:** `docs/vendor_compliance_center_{PREFLIGHT,RUNME,POSTCHECK,ROLLBACK}.sql`
**Predicates are enforced in the database.** The UI hides what a role cannot do, but hiding is
cosmetic — every RPC re-checks its own gate, and RLS re-checks it again on every row.

---

## 1) The eight predicates

| Predicate | Permission key | Grants |
|---|---|---|
| `can_view_compliance_center()` | `compliance.view` *(or any other compliance key)* | See the centre, the company profile, the non-sensitive document list, readiness |
| `can_manage_compliance_documents()` | `compliance.manage_documents` | Register / edit documents, upload files, edit the company profile. **Never verify.** |
| `can_verify_compliance_documents()` | `compliance.verify_documents` **or** the existing `can_verify_compliance()` | Verify or reject a document, revoke a document |
| `can_issue_secure_document_grants()` | `compliance.issue_grants` | Create grants, attach documents, issue and revoke tokens, read the access log |
| `can_view_restricted_company_documents()` | `compliance.view_restricted` | See `confidential` / `restricted` rows at all, masked numbers, checksums, internal notes, reference contact details |
| `can_manage_vendor_registration()` | `compliance.manage_registration` | Full registration workflow |
| `vcc_can_view_request_status()` | `compliance.view_request_status` | **Status board only** — five fields |
| `vcc_can_view_operational_documents()` | `compliance.view_operational_documents` | HSE / permit / insurance documents only |

Owner (`is_owner()` or `is_admin()`) satisfies all of them.
Every predicate is `SECURITY DEFINER`, pinned `search_path`, returns an explicit boolean,
and is fail-closed on exception.

**Never used as a gate anywhere in this package:** `can_manage_projects()`, `is_kian_member()`.
The POSTCHECK fails if either appears in a predicate body.

---

## 2) What each role actually sees

| Capability | Owner | Compliance manager | Verifier | Grant issuer | Sales | Operations |
|---|---|---|---|---|---|---|
| Company profile (read) | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Company profile (write) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Non-sensitive documents | ✓ | ✓ | ✓ | ✓ | ✗ | HSE/permits only |
| **Bank letter, ID, contracts, signatory** | ✓ | only with `view_restricted` | only with `view_restricted` | only with `view_restricted` | ✗ | ✗ |
| Register / upload a document | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| **Verify / reject** | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Revoke a document | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ |
| Readiness report | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Create / issue grants | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| **Approve a grant** | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Grant access log | ✓ | ✗ | ✗ | ✓ | ✗ | ✗ |
| Registration workflow | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |
| Registration **status only** | ✓ | ✓ | — | — | ✓ | — |
| Approve "ready for submission" | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ |

*(A person may hold several keys; the columns are keys, not job titles.)*

---

## 3) The three separations that are structural, not procedural

1. **The uploader never verifies.**
   `tvn_doc_verify_not_self` is a table CHECK, plus an explicit check in
   `vcc_document_decide`. Rewriting the function does not open the door.
2. **The preparer never approves.**
   `vcc_grant_approve` requires `vcc_is_owner()` — *not* `can_issue_secure_document_grants()`.
   And `vcc_grant_active_needs_token` makes an "active" grant without an approver impossible.
3. **Sales cannot reach a document at all.**
   Not by column filtering — by table. `vcc_registration_requests` RLS is
   `can_manage_vendor_registration()` only; sales reads `vcc_registration_status_board()`,
   a function that selects five columns and never touches `portal_reference`, `notes`,
   contact details, attachments or any document.

---

## 4) Sensitivity levels and who passes

| Level | Meaning | Read requires |
|---|---|---|
| `public` | Publishable | `can_view_compliance_center()` — **but** a `never_public` / identity / financial type is rejected at this level by trigger |
| `internal` | Ordinary company document | `can_view_compliance_center()` |
| `confidential` | Commercially sensitive | `can_view_restricted_company_documents()` |
| `restricted` | Bank / identity / contract | `can_view_restricted_company_documents()` |

`restricted` (the pre-existing boolean read by the live `tvn_docs_read` policy) is **kept**
and only ever tightened: `confidential`/`restricted` force it true; nothing lowers it.

Storage mirrors this: `vcc_storage_readable(name)` looks the object up in the registry and
applies the same rule. **A file with no registry row is unreadable by anyone** — there is no
orphan-readable path and no directory listing.

---

## 5) Anonymous access

`anon` has: no table grant, no RLS policy, no RPC, no storage grant. The only externally
reachable surface is `vcc_grant_open`, which is granted to **`service_role` only** and is
called from one server route that holds the key server-side. The POSTCHECK fails if `anon`
or `authenticated` can execute it.
