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

## Zoho Estimates architecture patch (run docs/portal_zoho_estimates_RUNME.sql first)
- ⏳ **Open quote** button on a linked request expands the linked formal quote (scrolls to it) and errors clearly if not found — works for both local and Zoho-linked quotes
- ⏳ quote_request → **Create estimate from this request**: with Zoho configured, creates/links a Zoho contact (by email) + a DRAFT Zoho estimate (suggested line items, price = "requires pricing review") + mirrors it locally (source=zoho); with Zoho NOT configured, falls back to a local draft + shows a clear message
- ⏳ Draft estimate (zero-total placeholder prices) is **NOT visible to the client**; admin edits prices in Zoho → "Re-sync from Zoho" pulls the new totals/line items
- ⏳ **Admin approval** ("Approve & show to client") exposes the estimate to the client (public_portal_visible) + marks it "sent" in Zoho if linked + notifies the client; blocked if total<=0
- ⏳ **Same-email**: a visitor/lead who signs up with the email of an existing quote/estimate sees it in /client-portal/quotes (email-match RLS; no risky client-row creation); `promote_and_link_by_email` links it to their client context if they have one
- ⏳ Client **Accept** / **Decline** (+ optional note): updates local client_response + status and, if Zoho configured + linked, calls the Zoho estimate status endpoint; admin is notified; **no invoice is created**
- ⏳ Client never sees a zero/empty estimate; can only accept/decline their own (client_id OR verified email)
- ⏳ Zoho estimate PDF: client sees a clear "official PDF available from Kian on request" note (no usable public link in this foundation); admin gets "Open in Zoho ↗"
- ✅ Zoho **not configured** → routes return `{configured:false}` with a setup message; no crash; 401 without auth; 403 if not owner/sales/finance

## Tax-invoice approval flow (run docs/portal_invoice_approval_RUNME.sql first)
- ⏳ Client **accepts** an estimate → NO invoice is created; the quote shows `invoice_approval_pending`; owner/admin/finance/manager get an **"invoice approval required"** notification
- ⏳ Admin/finance sees **"الموافقة على إنشاء فاتورة ضريبية من Zoho Books / Approve tax invoice creation from Zoho Books"** on the accepted quote (only owner/manager/finance — `can_see_invoices`)
- ⏳ Invoice is **NOT** created before approval
- ⏳ On approve with Zoho configured (+ `ZohoBooks.invoices.CREATE`): an official invoice is created in Zoho **from the accepted estimate**, mirrored locally read-only (number/status/line items/subtotal/VAT/total/due/PDF), quote → `invoice_created`, client gets `invoice_visible`, admin gets `invoice_created`
- ⏳ Client sees the invoice **read-only inside the portal** (expandable: line items + subtotal/VAT/total + PDF) — not redirected to Zoho
- ⏳ **Dedup:** approving again (or for an estimate already invoiced) does not create a second invoice
- ⏳ **Missing Zoho config** → "Client accepted the estimate, but Zoho invoice creation is not configured yet." (approval recorded, no crash)
- ⏳ **Missing `invoices.CREATE` scope / Zoho error** → quote → `invoice_creation_failed`, admin notified, **client acceptance preserved**, clear admin error
- ⏳ No invoice is emailed to the client automatically
- ✅ `/api/integrations/zoho/invoice-from-estimate` → 401 without auth; 403 if not owner/finance; never calls Zoho without a permitted user

## Mobile / RTL
- ✅/⏳ Arabic RTL + English LTR correct; tables/totals readable on mobile; empty states professional
