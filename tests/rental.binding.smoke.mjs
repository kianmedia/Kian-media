// اختبارات إلزام الهوية/التوقيع/الصور عند إنشاء طلب المستأجر + الباركود + التذكير + الوديعة.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const SQL = read("docs/rental_renter_binding_evidence_HOTFIX_RUNME.sql");
const LIB = read("lib/portal/rental.ts");
const TIME = read("lib/portal/rentalTime.ts");
const RENTER = read("components/portal/rental/RenterRentalView.tsx");
const CRON = read("app/api/cron/custody-alerts/route.ts");

test("binding hotfix file exists + idempotent + non-destructive", () => {
  assert.ok(existsSync(root + "docs/rental_renter_binding_evidence_HOTFIX_RUNME.sql"));
  assert.ok(!/drop table|truncate|delete from public/i.test(SQL));
  assert.match(SQL, /PREFLIGHT/);
  assert.match(SQL, /notify pgrst, 'reload schema'/);
});

// ═══ الهوية + الإقرار + الصور (SQL gate على الإرسال) ═══
test("customer_submit enforces identity + per-item photo + overall photo + consent", () => {
  const b = SQL.slice(SQL.indexOf("function public.custody_rental_customer_submit"));
  assert.match(b, /identity_incomplete/);
  assert.match(b, /item_photo_required/);
  assert.match(b, /overall_photo_required/);
  assert.match(b, /consent_required/);
  // identity checks full_name+phone+id_type+id_number_ref+address
  assert.match(b, /full_name.*phone.*id_type.*id_number_ref.*address|c\.id_type/s);
});
test("customer_submit signature widened to accept consent (drop+create)", () => {
  assert.match(SQL, /drop function if exists public\.custody_rental_customer_submit\(uuid\)/);
  assert.match(SQL, /create function public\.custody_rental_customer_submit\(p_request uuid, p_consent_signature_path text default null, p_consent_text text default null\)/);
});
test("consent columns + reminder col + evidence stages widened (request, closeout)", () => {
  for (const c of ["consent_signature_path", "consent_signed_at", "consent_text", "reminder_sent_at"]) assert.match(SQL, new RegExp(`add column if not exists ${c}`));
  assert.match(SQL, /stage in \('handover','return_request','return_inspection','request','closeout'\)/);
});

// ═══ الأدلة (مرحلة request) + الباركود + نص الإقرار ═══
test("renter request-stage evidence RPC (ownership) + barcode lookup + consent text RPC", () => {
  assert.match(SQL, /function public\.custody_rental_customer_add_request_evidence\(p_request uuid, p_item uuid, p_path text\)/);
  assert.match(SQL, /c\.user_id = auth\.uid\(\)/);
  assert.match(SQL, /function public\.custody_rental_customer_lookup_asset\(p_code text, p_from timestamptz, p_to timestamptz\)/);
  assert.match(SQL, /lower\(barcode\) = lower\(v_code\) or lower\(qr_code_value\) = lower\(v_code\) or lower\(asset_code\) = lower\(v_code\)/);
  assert.match(SQL, /function public\.custody_rental_consent_text\(\)/);
});
test("create_request stores identity + returns item ids for photo attach", () => {
  const b = SQL.slice(SQL.indexOf("function public.custody_rental_customer_create_request"), SQL.indexOf("function public.custody_rental_customer_submit"));
  assert.match(b, /id_type   = coalesce/);
  assert.match(b, /id_number_ref = coalesce/);
  assert.match(b, /address   = coalesce/);
  assert.match(b, /returning id into v_item/);
  assert.match(b, /'item_id', v_item/);
});
test("customer assets exposed to renter carry NO cost/internal", () => {
  const b = SQL.slice(SQL.indexOf("function public.custody_rental_customer_lookup_asset"), SQL.indexOf("function public.custody_rental_customer_create_request"));
  assert.ok(!/purchase_price|current_value|internal_note|notes|cost/.test(b));
});

// ═══ التخزين: المستأجر يكتب أدلة الإنشاء (write-only، تحت rental/) ═══
test("renter can insert into rental-evidence (write-only, rental/ prefix)", () => {
  assert.match(SQL, /create policy "rental evidence renter write" on storage\.objects for insert to authenticated/);
  assert.match(SQL, /bucket_id = 'rental-evidence' and \(storage\.foldername\(name\)\)\[1\] = 'rental'/);
  assert.match(LIB, /function rentalUploadConsentSignature/);
  assert.match(LIB, /rental\/\$\{rentalId\}\/consent\//);
});

// ═══ التذكير (بوابة + إيميل، عبر الكرون اليومي) ═══
test("due-reminder fn (idempotent via reminder_sent_at) + cron hook + email", () => {
  assert.match(SQL, /function public\.custody_rental_due_reminders\(p_window_hours int default 2\)/);
  assert.match(SQL, /reminder_sent_at is null/);
  assert.match(SQL, /rental_due_soon/);
  assert.match(CRON, /custody_rental_due_reminders/);
  assert.match(CRON, /custody_rental_mark_overdue/);
  assert.match(CRON, /sendCustodyEmail/);
});

// ═══ lib + UI ═══
test("lib: submit sends consent; create returns items; path helpers accept 'request'", () => {
  assert.match(LIB, /custody_rental_customer_submit", \{ p_request: requestId, p_consent_signature_path: consentPath \?\? null, p_consent_text: consentText \?\? null \}/);
  assert.match(LIB, /items: RentalCreatedItem\[\]/);
  assert.match(LIB, /phase: "handover" \| "return" \| "request"/);
});
test("UI: two-phase (identity+cart → photos+consent); mandatory gates", () => {
  assert.match(RENTER, /phase, setPhase.*"form" \| "evidence"|"form" \| "evidence"/s);
  assert.match(RENTER, /function identityMissing/);
  assert.match(RENTER, /id_number_ref/);
  assert.match(RENTER, /addByBarcode/);
  assert.match(RENTER, /rentalCustomerLookupAsset/);
  assert.match(RENTER, /allItemPhotos/);
  assert.match(RENTER, /!overallPhoto/);
  assert.match(RENTER, /!sigData \|\| !ack/);
  assert.match(RENTER, /ConsentPad/);
});
test("[deposit] renter deposit visible with fallback", () => {
  assert.match(RENTER, /Number\(d\.deposit_amount\) > 0 \?.*تُحدَّد بعد المراجعة/s);
});
test("new error codes mapped to Arabic (no raw)", () => {
  for (const c of ["identity_incomplete", "item_photo_required", "consent_required", "code_required", "asset_not_found"]) assert.ok(TIME.includes(c), `error map missing ${c}`);
});
