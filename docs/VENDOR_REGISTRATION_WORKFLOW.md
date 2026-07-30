# Vendor Registration Workflow

## 0) Direction — read this first

This module is **outbound**: another organisation wants Kian Media registered as a supplier in
*their* procurement system, so we assemble documents and **hand them over manually**.

`/opportunities` is **inbound**: individuals and suppliers applying to *us*
(`supplier`, `freelancer`, `talent`, `media_partnership` → anon rate-limited
`submit_opportunity_request` → `opportunity_requests`).

They are not the same workflow, which is why no second public form was built. An outbound
request may *reference* an inbound row via `source_opportunity_request_id` — a read-only
pointer, validated for existence, **never copied from, never triggered on, never emailed**.
If `opportunity_requests` is absent, linking is refused with an explicit message rather than
silently ignored.

---

## 1) States

```
received → under_review → information_required ⇄ preparing_documents
         → pending_owner_approval → ready_for_manual_submission
         → submitted_manually → accepted | rejected
                              ↘ expired | closed
```

Allowed transitions are an explicit table inside `vcc_registration_transition`. Anything else
raises `conflict: انتقال غير مسموح من X إلى Y`. There is no "set status" back door — RLS
allows no direct write to the table at all.

| State | Meaning | Gate |
|---|---|---|
| `received` | Logged | `can_manage_vendor_registration()` |
| `under_review` | Being assessed | same |
| `information_required` | Blocked on the other party — **reason mandatory** (CHECK) | same |
| `preparing_documents` | Assembling the file | same |
| `pending_owner_approval` | Complete, awaiting the owner | same (emits an event) |
| `ready_for_manual_submission` | **Owner approved** | `vcc_is_owner()` only |
| `submitted_manually` | A human handed it over | same + proof (below) |
| `accepted` / `rejected` | Their decision, recorded | same |
| `expired` / `closed` | Terminal, reason required | same |

## 2) ⛔ No claim of electronic submission

`submitted_manually` is impossible without all four of `submitted_by`, `submitted_at`,
`submission_reference`, `submission_channel` — enforced by the table CHECK
`vcc_reg_manual_submission_proof`, not by function logic. The UI asks for the reference and
the channel *before* the call, so the user understands why.

There is **no code path anywhere** — SQL, TypeScript, route, or UI — that submits to a
procurement portal. `ready_for_manual_submission` and `submitted_manually` both return
`note_ar` saying so.

Likewise `vcc_reg_owner_approval_proof` makes `ready_for_manual_submission`,
`submitted_manually` and `accepted` impossible without `owner_approved_by/at`.

## 3) Checklist — derived, not ticked

`vcc_registration_checklist` items are `document`, `field` or `action`.

- For `document` items, `satisfied` is **computed** from `tvn_doc_valid('company', null, doc_type)`
  at read time. `vcc_chk_document_not_manual` makes `satisfied_manual` NULL-only for them, so
  nobody can tick "done" over an expired or unverified certificate.
- `field`/`action` items may be ticked manually; the UI labels derived rows explicitly.

Creating a request from `required_doc_types` seeds the document items automatically.

`vcc_registration_get` also returns `missing_or_expired_doc_types` and a full
`vcc_readiness(request.readiness_context)` block, so "what is still missing" and "are we ready"
come from the same definition of valid.

## 4) Fields carried

organisation, sector, contact (name/email/phone), purpose (≥10 chars), required document types,
deadline, procurement portal name + reference, notes, source
(`client_request` | `tender_portal` | `email` | `phone` | `opportunity_form` | `referral` | `other`),
optional opportunity reference, assigned employee, priority, readiness context, plus the full
approval / submission / closure trail and soft-delete columns.

**`portal_reference` is a reference held by the other party — it is not evidence of
submission.** Only the `submitted_manually` proof fields are.

## 5) Comments and attachments

- `vcc_registration_comments` — internal only. Never exposed to any external party and never
  attached to a grant.
- `vcc_registration_attachments` — **metadata plus a constrained storage reference**
  (`compliance-documents`, path `registration/{uuid}/{file}`, no `..`). It deliberately does
  **not** copy the `hr_employee_documents.file_url` pattern, a live precedent of a free-text
  URL that escapes RLS entirely. Reads are gated by `vcc_storage_readable()`, which routes the
  `registration/` prefix to `can_manage_vendor_registration()`.

## 6) Sales visibility

Sales holds `compliance.view_request_status` and calls
**`vcc_registration_status_board()`** — a function whose SELECT list is exactly
`request_number, organization_name, status, priority, deadline`.

The narrowing is structural: the RLS policy on the table does not admit sales at all, so there
is no column-blind row read to leak `portal_reference`, `notes`, contact details or
attachments. The POSTCHECK fails if any of those identifiers appears in the function body.

## 7) Notifications

`registration_awaiting_owner_approval` and `registration_deadline_near` (at 14/7/3/1/0 days)
are **enqueued** to the Communications Hub on the `portal` channel with `dry_run` untouched.
Nothing is sent.
