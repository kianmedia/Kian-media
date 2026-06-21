# Portal Completion — Test Checklist

Legend: ✅ testable now · ⏳ after the relevant approval-gated batch ships (see `PORTAL_COMPLETION_IMPLEMENTATION.md` §7). Run on **Preview only** (never Production). Each DB-backed item requires its batch's `*_RUNME.sql` to be run in Supabase first.

## Build / tooling (always)
- ✅ `./node_modules/.bin/tsc --noEmit` exits 0
- ✅ `next build` compiles (note: `next.config.js` ignores TS/ESLint in build — run `tsc` manually)
- ✅ `next lint` — no new errors (pre-existing `Testimonials.tsx` quote-escape error is out of scope)
- ✅ Existing portal login, quote-request, book-meeting, WhatsApp inbox, Zoho sync still work

## Phase 2 — experience years
- ✅ Home Stats band shows **10+ سنة خبرة / 10+ Years**; Hero counter shows 10 — consistent; no "20+" anywhere

## Phase 10A — technical SEO (no DB)
- ✅ `GET /robots.txt` → allows `/`, disallows `/client-portal`, `/admin`, `/api/`, `/rate`, `/quick-access`, `/upload-files`; lists sitemap
- ✅ `GET /sitemap.xml` → lists `/`, `/quote-request`, `/book-meeting`, `/opportunities`, `/privacy-policy`, `/terms`
- ✅ Home page metadata (title/description/OG/JSON-LD ProfessionalService) still present in `<head>`

## Phase 3 — client portal (⏳ Batch 1)
- ⏳ Client sees only **their own** projects (RLS); status timeline draft→…→final_delivered renders
- ⏳ Preview deliverables show preview link; final files (`عرض الملفات النهائية`) only when `final_delivered`
- ⏳ CTAs: `طلب تعديل` / `اعتماد المعاينة` / `إرسال ملاحظة` work; revision note stored + visible to admin with author role + timestamp; internal vs client comments separated
- ⏳ Quotes: client sees a quote only when `public_portal_visible` or status sent/accepted; read-only; `قبول عرض السعر` / `طلب تعديل` work; price fields not editable
- ⏳ Invoices: read-only, visible only when `public_portal_visible`; no auto Zoho invoice created
- ⏳ Notifications fire on quote sent / invoice visible / revision requested / status change (in-app; email + WhatsApp if configured)

## Phase 4 — visitor/lead dashboard (⏳ Batch 3)
- ⏳ Logged-in lead sees a non-empty dashboard: value header, My Requests Center (by email/phone), brief builder (rule-based summary, no OpenAI required), needs calculator presets, free-resource cards (`قريباً` where no PDF), account-completion %, community teaser
- ⏳ Submitting a brief writes `project_briefs`; CTAs to quote/meeting work

## Phase 5 — WhatsApp AI foundation (⏳ partly live)
- ✅ Existing inbound webhook ingests + classifies + routes (already live)
- ⏳ Intent classification covers quote/meeting/wedding/invoice/complaint/etc.
- ⏳ Auto-reply sends quote/booking links (gated, dry-run by default — already shipped for price intent)
- ⏳ Staff notification jobs created for the assigned department (in-app/email/WhatsApp template)
- ⏳ On conversation close, a `/rate?token=` link is generated; rating submit writes `service_ratings`

## Phase 6 — admin inbox / queues (⏳ Batch 5)
- ⏳ Unified inbox lists WhatsApp + contact + quote + meeting + briefs; filters (new/assigned/waiting/resolved/department/source); assignment; internal notes; close → rating link

## Phase 7 — community forum (⏳ Batch 4)
- ⏳ `/community` readable by public; logged-in users post/comment; first post pending moderation; categories present; rate-limit; admin moderation page; published posts have SEO metadata; empty state encourages discussion; homepage teaser shows 3 latest

## Phase 8 — testimonials (⏳ Batch 2)
- ⏳ Client submits testimonial from portal; visitor only via email-verify/rating token; admin approves before public; homepage shows approved only; no fake placeholders

## Phase 9 — English copy
- ⏳ Key pages read as premium native English (CTAs: Start Your Project / Request a Quote / Book a Production Consultation / View Our Work / Talk to Kian)

## Phase 10B — SEO landing pages (⏳ cross-cutting)
- ⏳ `/services/*` + `/locations/*` bilingual pages with H1/explanation/deliverables/process/CTA/FAQ + JSON-LD; appended to sitemap

## Phase 11 — homepage
- ⏳ CTA block, visitor-portal teaser, community teaser, testimonials teaser, procurement-ready teaser — added without clutter

## Phase 12 — RLS
- ⏳ Each new table: client sees only own rows; visitor only own briefs/requests; staff only assigned department; owner all; public only published/approved; pending/rejected never public

## Mobile / RTL
- ✅/⏳ Arabic RTL + English LTR correct on each new page; mobile layout acceptable; empty states professional + conversion-focused
