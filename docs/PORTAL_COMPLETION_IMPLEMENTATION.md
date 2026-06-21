# Portal Completion — Implementation Note (Phase 1 Audit + Plan)

_Branch: `feature/whatsapp-sales-system` · Status: audit complete; safe no-DB work shipped; DB-heavy phases sequenced as approval-gated batches._

This note audits the current Kian Media site/portal against the 14-phase completion brief, records what already exists (so we **reuse, not duplicate**), lists the gaps, and proposes a safe delivery sequence. The big new features each need an **additive `*_RUNME.sql` migration that the owner runs in Supabase** (per the standing guardrail) — they are not auto-run.

---

## 1. Existing routes (already built)

**Public marketing:** `/` (home), `/quote-request`, `/book-meeting`, `/quick-access`, `/upload-files`, `/opportunities`, `/privacy-policy`, `/terms`.

**Client portal (`/client-portal/*`)** — role-switched via `caps()`:
`/` (overview/admin dashboard), `projects`, `projects/[id]` (timeline + deliverables + 7-state reviews + project messages), `quotes`, `invoices` (launches empty), `messages`, `files`, `offers`, `notifications`, `profile`, `accounts` (admin), `staff` (admin), `opportunities` (admin/HR), `my-opportunities`, `admin` (stub), `admin/whatsapp`, `reset-password`.

**Admin:** `/admin/whatsapp` (WhatsApp inbox).

**API:** `/api/integrations/whatsapp/{incoming,send,start-conversation,quote-request,books-estimate,zoho-sync}`.

## 2. Existing Supabase tables used by the portal

**Live (phase0_migration.sql, executed):** `companies`, `profiles` (account_type lead|client|admin + `staff_role`), `project_members`, `projects`, `quote_requests` (**header-only, no line items**), `messages`, `file_links` (URL-only), `offers`, `project_notes`, `deliverables` (7-state workflow), `deliverable_assets`, `client_comments` / `internal_comments` (split), `deliverable_reviews`, `project_messages`, `admin_notes`, `notifications`, `notification_preferences`, `activity_log`, `integration_outbox`. Soft-delete columns on every table.

**Live (later RUNME files):** the full `whatsapp_*` stack (conversations, messages, contacts, quote_requests, internal_alert_audit, template_audit, send_audit, quote_notify_audit, books_estimate_audit, staff_alert_settings), `opportunity_requests`/notes, staff-role helpers.

**Defined but NOT run (PROPOSAL):** `invoices` (in `staff_assignment_notifications_finance_ADDENDUM.sql`). Must be promoted to a RUNME before the invoices portal works.

**Missing entirely:** `quotes` + `quote_items` (rich financial), `invoice_items`, `community_categories`/`community_posts`/`community_comments`, `testimonials`, `service_ratings`, `project_briefs`, `portal_requests`.

## 3. Existing notification + integration utilities (REUSE these)

- **In-app:** `notify(p_recipient,p_role,p_type,p_etype,p_eid,p_ar,p_en)` SECURITY DEFINER RPC (respects `notification_preferences`). Manual: `admin_notify(...)` + `lib/portal/admin.ts adminNotify()`. Client read: `lib/portal/notifications.ts`.
- **Email:** Apps Script channel — `lib/server/notifyEmail.ts` / `lib/portal/notifyEmail.ts` POST `{_type:"portal_notify"}` to `PORTAL_NOTIFY_ENDPOINT`/`SHEETS_ENDPOINT` (no SMTP keys in repo).
- **WhatsApp:** `lib/server/whatsappCloud.ts sendTextMessage()`, `lib/server/whatsappInternalAlert.ts sendInternalAlerts()`, `lib/server/autoQuoteLink.ts`, `lib/server/quoteConfirm.ts`. **Do not add parallel senders.**
- **Outbox:** `integration_outbox` (zoho/vimeo/email/whatsapp targets).
- **Forms:** `lib/submitForm.ts submitToSheets()` + `makeRef()`; dual-write pattern (Supabase source of truth + best-effort Sheets mirror) in `lib/portal/leads.ts createQuote()`.

## 4. Existing forms

- `quote-request` (24 services, → Sheets + WhatsApp link-back), `book-meeting` (WhatsApp fallback; Calendly placeholder), `upload-files` (link-based), `opportunities` (jobs/talent), portal quote/message/file submit (`lib/portal/leads.ts`). Testimonials = `components/Reviews.tsx` is an **empty "share your experience" state** (no backend yet) — no fake placeholder reviews.

## 5. Auth roles (adapt to this; do not replace)

`account_type`: `lead` | `client` | `admin` (2 fixed owner emails). `staff_role`: `super_admin|manager|support|editor|sales|hr|readonly|finance`. Capability matrix in `lib/portal/roles.ts caps()` (16 flags incl. `isClientSide`, `canSeeFinancials`, `canSeeInvoices`, `canCreateBooksEstimate`). DB helpers: `is_admin()/is_owner()/is_staff()/staff_role()/can_see_financials()/can_access_project()`. RLS pattern: RLS enabled + `GRANT SELECT authenticated` + **no DELETE grants** (soft_delete RPC) + live-rows-only policies.

## 6. Gaps found (vs the 14-phase brief)

| Brief phase | Status |
|---|---|
| Years "20+"→"10+" (P2) | ✅ Fixed (`Stats.tsx` 20→10; Hero already 10) |
| Technical SEO robots/sitemap (P10A) | ✅ Added `app/robots.ts` + `app/sitemap.ts` (no DB) |
| Client portal quotes/invoices line items (P3C/D) | ❌ needs `quotes`/`quote_items`/`invoice_items` + promote `invoices` |
| Client revision notes visible to admin (P3B) | ⚠️ partial — `client_comments`/`deliverable_reviews` exist; needs UI wiring |
| Visitor/lead dashboard, brief builder, calculator, resources (P4) | ❌ needs `project_briefs`/`portal_requests` + UI |
| WhatsApp AI foundation (P5) | ⚠️ inbox/routing/intent largely built; rating link + `service_ratings` missing |
| Admin unified inbox / queues (P6) | ⚠️ WhatsApp inbox exists; unified cross-source inbox missing |
| Community forum (P7) | ❌ needs `community_*` tables + `/community` |
| Testimonials submission + moderation (P8) | ❌ needs `testimonials` + `/testimonials` + moderation |
| English copy polish (P9) | ⚠️ ongoing copy work (no DB) |
| SEO landing pages /services /locations (P10B) | ❌ single-URL i18n → bilingual static pages feasible; **hreflang N/A** |
| Homepage teasers (P11) | ⚠️ CTA/teaser sections (no DB) |
| RLS for new tables (P12) | ❌ ships inside each batch's migration |

## 7. Delivery sequence — approval-gated batches

Each batch = one additive `*_RUNME.sql` (owner-run) + its routes/UI + adversarial verification, following the exact rhythm of the prior WhatsApp batches.

1. **Batch 1 — Quotes & Invoices in portal (P3C/D, P11 finance teaser).** New `quotes`/`quote_items`/`invoice_items`; promote `invoices` from PROPOSAL. Enrich `/client-portal/quotes` + `/client-portal/invoices` (read-only, accept/request-edit CTAs, no client price edits, no auto-invoicing). Effort: **L**.
2. **Batch 2 — Testimonials & service ratings (P8, P5F, P11 teaser).** `testimonials` + `service_ratings`; `/rate?token=`, `/testimonials`, portal submit, admin moderation; approved-only on homepage (replaces the empty Reviews state). Effort: **M**.
3. **Batch 3 — Visitor/lead dashboard + intake (P4).** `project_briefs` + `portal_requests`; brief builder (rule-based summary), needs calculator, free-resource cards, account-completion %, requests center, community teaser. Effort: **M**.
4. **Batch 4 — Community forum (P7).** `community_categories/posts/comments`; `/community` + `/api/community/*`; moderation; homepage teaser. Effort: **L**.
5. **Batch 5 — Unified admin inbox + WhatsApp rating link (P5F/P6).** Cross-source queue + assignment + rating-link-on-close (reuses Batch 2's `service_ratings`). Effort: **M**.
6. **Cross-cutting — SEO landing pages + English copy + homepage teasers (P9/P10B/P11).** Bilingual static `/services/*` + `/locations/*`, JSON-LD per page, CTA/teaser blocks. No DB. Effort: **M**, can interleave.

## 8. Files changed in this pass (no-DB, no-regression)

- `components/Stats.tsx` — experience stat 20 → 10 (Phase 2).
- `app/robots.ts` — **new** (crawl marketing; exclude portal/api/tokenised).
- `app/sitemap.ts` — **new** (public marketing routes).
- `docs/PORTAL_COMPLETION_IMPLEMENTATION.md` — this note.
- `docs/PORTAL_COMPLETION_TEST_CHECKLIST.md` — full-program test checklist.

## 9. Key risks / guardrails (carry into every batch)

- Additive RUNME migrations only, **owner-run**, with rollback; never auto-run.
- `invoices` is mid-flight (PROPOSAL not executed) — promote carefully, don't assume it exists.
- Decide explicitly whether rich `quotes` supersedes or sits beside header-only `quote_requests`.
- Widening `notifications.type` CHECK must **preserve all existing values**.
- Reuse `notify()`/email/WhatsApp senders + soft-delete + role helpers — no parallel infra.
- No realtime / no Supabase Storage today (60s polling, URL-only files) — don't promise either without separate work.
- No official auto-invoicing — invoices are display-only after Zoho/finance approval.
- Single-URL client-toggle i18n → **hreflang is not applicable**; sitemap/per-page metadata/JSON-LD are the safe SEO wins.
