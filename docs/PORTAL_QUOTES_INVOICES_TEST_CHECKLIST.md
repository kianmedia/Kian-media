# Quotes & Invoices — Test Checklist

Run on **Preview only**. DB-backed items require `docs/portal_quotes_invoices_RUNME.sql` to be run in Supabase first. Legend: ✅ before migration · ⏳ after migration.

## Build / tooling
- ✅ `./node_modules/.bin/tsc --noEmit` exits 0
- ✅ `next build` compiles `/client-portal/quotes` + `/client-portal/invoices`
- ✅ `next lint` — no new errors (pre-existing `Testimonials.tsx` error is out of scope)

## Pre-migration safety (tables absent)
- ✅ `/client-portal/quotes` (client) renders the request form + an empty "Official Quotes" state — no crash
- ✅ `/client-portal/quotes` (financier) renders the intake inbox + an empty quotes manager — no crash
- ✅ `/client-portal/invoices` renders the empty state (client) / empty manager (finance) — no crash
- ✅ Existing portal login, projects, messages, files, notifications still work

## Quotes — client (after migration)
- ⏳ Client sees ONLY their own quotes, and only when `public_portal_visible` OR status in (sent, accepted)
- ⏳ Quote card shows number, status, validity, line items, subtotal, VAT, total
- ⏳ "Accept Quote" sets status=accepted + notifies admin; visible only for sent/approved quotes
- ⏳ "Request Quote Revision" stores a note + notifies admin
- ⏳ Client has NO price-edit control anywhere (only Accept + a revision note box)
- ⏳ Empty state: "لا توجد عروض أسعار حتى الآن…" / "No quotes yet…" + CTA to /quote-request

## Quotes — admin/finance/sales (after migration)
- ⏳ Create quote: pick client, set valid-until/VAT/notes → quote created with auto number `Q-YYYY-#####`
- ⏳ Add/remove line items → "Save items + totals" recomputes subtotal/VAT/total server-side
- ⏳ Status dropdown (draft→…→expired); setting "sent" reveals the quote to the client + notifies them
- ⏳ "Show/Hide from client" toggles `public_portal_visible`
- ⏳ Client revision requests appear under the quote

## Invoices (after migration)
- ⏳ Finance creates a display record (number/amounts/due/PDF/Zoho id) + "visible to client" toggle
- ⏳ NO official invoice is created in Zoho by the portal (display record only)
- ⏳ Client sees an invoice ONLY when `public_portal_visible`; read-only; shows number/status/due/total + PDF link
- ⏳ Making an invoice visible notifies the client

## Notifications
- ⏳ quote_sent / quote_accepted / quote_revision_requested / invoice_visible appear in the bell with proper AR/EN labels and link to /client-portal/quotes or /invoices

## RLS / security
- ⏳ A second client account cannot see the first client's quotes/invoices
- ⏳ A lead (no clients row) sees nothing in either section
- ⏳ Public/anon cannot read quotes/invoices (no anon grant)
- ⏳ `select`-only grants; every write rejected unless via the RPCs (price tamper impossible)

## Corrective patch (run docs/portal_quotes_invoices_fix_RUNME.sql first)
- ⏳ Admin quotes screen lists **quote requests awaiting pricing**; "Create formal quote from this request" creates a quote **linked to quote_requests.id**, prefilled (title from services, notes from description), client resolved by membership→email; clicking again opens the same linked draft (no duplicate)
- ⏳ A logged-in user with the **same email** as a quote request sees the resulting quote once it's visible
- ⏳ Empty/zero quote (SAR 0.00, no items) **cannot** be set to sent/accepted or made visible — server raises `empty_or_zero_quote` and the admin sees a clear message; the client never sees it (RLS requires total>0 + items)
- ⏳ The pre-existing SAR 0.00 test quote is now **hidden from the client** until real line items are added
- ⏳ Invoices: "Sync from Zoho by customer email" with **Zoho env missing → clear setup message** (no failure)
- ⏳ With Zoho configured: sync **reads** invoices for that email and stores read-only records (zoho_invoice_id/customer_id/number/status/currency/subtotal/vat/total/due_date/pdf_url); **no invoice is created/sent/voided in Zoho**
- ⏳ Client sees a Zoho-synced invoice **read-only**; manual creation is clearly labeled "fallback"; rows show a Zoho/Manual badge
- ✅ `/api/integrations/zoho/sync-invoices` → 401 without auth; 403 if not owner/finance; never calls Zoho without a permitted user

## Mobile / RTL
- ✅/⏳ Arabic RTL + English LTR correct; tables/totals readable on mobile; empty states professional
