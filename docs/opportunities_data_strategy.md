# Opportunities Center — data strategy

How Kian gets long-term value from the data collected by the Opportunities Center.

## Source of truth

**Supabase is the single source of truth.** Every public submission is one row in
`public.opportunity_requests`, with type-specific answers in a clean `details`
JSON column and shared/queryable fields as real columns
(`opportunity_type, full_name, email, phone, city, message, status, priority,
assigned_to, request_number, source, created_at`). Internal follow-up lives in
`opportunity_request_notes`. Access is RLS-restricted to owner/admin/manager/HR.

## Field structure

- **Structured & queryable:** the shared columns above (filterable/searchable in
  the admin center; indexed on type + status).
- **Flexible:** `details` JSON holds each type's specific fields (e.g.
  `desired_position`, `university_or_institution`, `specialty`, `event_date`),
  plus attribution: `source = "website_opportunities_center"` and any
  `utm_source / utm_medium / utm_campaign` captured from the landing URL.
- Every field is shown in the admin/HR detail panel, so nothing is hidden.

## Export (available now)

Admin/HR → Opportunities Center → **"تصدير CSV / Export CSV"**. A client-side
export of the **currently visible (RLS-scoped, filtered)** rows — core columns +
message, UTF-8 BOM so Arabic opens correctly in Excel/Sheets. No server, no extra
permissions; the export only ever contains rows the viewer can already see.

## Suggested tags / categories for analysis

- By `opportunity_type` (the 10 types) — the primary segmentation.
- By `status` funnel: new → under_review → shortlisted → contacted →
  interview_scheduled → accepted/rejected/archived.
- By `priority`, by `city`, by `source`/UTM (campaign performance).
- Future: a free-text `tags` column for ad-hoc labels (e.g. "talent-pool-2026",
  "summer-internship") — would require a small DB column + admin UI (deferred).

## Future: dashboards & CRM (not in this phase)

- **Looker Studio / Google Sheets:** schedule a CSV/Sheets export (or a read-only
  Supabase connection) → a live funnel + source dashboard. Start from the CSV.
- **Zoho CRM (deferred, separate phase):** push *selected* types (e.g. supplier,
  media_partnership, co_production) to Zoho CRM as leads via a **server-side**
  sync (route handler + server-only tokens) — never from the browser. See the
  Zoho proposal doc. HR/recruitment types can stay in Supabase or sync to a
  recruiting tool later.

## Privacy considerations

- Applicants give explicit **consent** ("أوافق على تواصل كيان معي بخصوص هذا الطلب")
  on submission; the public page links the Privacy Policy.
- Personal data (name/email/phone) is visible only to owner/admin/manager/HR via
  RLS — never to clients or other staff roles, and never to the public.
- No personal data in URLs; CSV export is local to the authorized user's browser.
- If syncing to any external tool later, send only the minimum fields needed and
  document the processor in the Privacy Policy.

## Retention / archive

- **Archive** (status `archived`) keeps a request for the record while removing it
  from active triage; it stays filterable and counted.
- A true soft-delete RPC (`archive_opportunity_request`, sets `is_deleted`) exists
  for removal; soft-deleted rows are hidden from everyone except admins (RESTRICTIVE
  live-rows). Nothing is hard-deleted from the browser.
- Suggested policy: keep accepted/active candidate data while relevant; periodically
  review and soft-delete stale rejected/withdrawn requests per your retention rule.
