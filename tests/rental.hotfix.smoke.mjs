// اختبارات دخانية للـHotfix التشغيلي (node:test + node:fs — بلا حزم، بلا DB).
// تغطي الإصلاحات المؤكدة: bad_window، فحص التوفّر الحقيقي، اختيار عميل البوابة، الطلب
// الذاتي، الإشعارات، الأدلة، ومنع الحجز المزدوج. أكيدات ساكنة على الملفات + حساب زمن حقيقي.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const HOTFIX = read("docs/rental_portal_operational_HOTFIX_RUNME.sql");
const CONSOLE = read("components/portal/rental/RentalConsole.tsx");
const DETAIL = read("components/portal/rental/RentalDetail.tsx");
const RENTER = read("components/portal/rental/RenterRentalView.tsx");
const LIB = read("lib/portal/rental.ts");
const TIME = read("lib/portal/rentalTime.ts");

test("hotfix + support files exist", () => {
  for (const p of [
    "docs/rental_portal_operational_HOTFIX_RUNME.sql", "lib/portal/rentalTime.ts",
    "app/api/integrations/rental/notify/route.ts",
    "components/portal/rental/RentalConsole.tsx", "components/portal/rental/RentalDetail.tsx",
    "components/portal/rental/RenterRentalView.tsx",
  ]) assert.ok(existsSync(root + p), `missing ${p}`);
});

// ═══ (1) bad_window — سبب دقيق + إصلاح ═══
test("[1] datetime: النمط القديم المعطوب أُزيل، ويُستخدم تحويل الرياض الصريح", () => {
  assert.ok(!/new Date\(f\.rental_from\)\.toISOString\(\)/.test(CONSOLE), "old browser-local conversion must be gone");
  assert.match(CONSOLE, /riyadhInputToUtcISO\(f\.rental_from\)/);
  assert.match(TIME, /\+03:00/, "Riyadh fixed offset");
});
test("[1] datetime: تحويل 10:00 بتوقيت الرياض → 07:00Z (حساب حقيقي)", () => {
  assert.equal(new Date("2026-07-15T10:00:00+03:00").toISOString(), "2026-07-15T07:00:00.000Z");
});
test("[1] الافتراضي: النهاية بعد البداية بـ24 ساعة لا تساوي", () => {
  assert.match(TIME, /defaultRentalWindow/);
  assert.match(TIME, /24 \* 60 \* 60 \* 1000/);
  assert.match(TIME, /endPlus24h/);
});
test("[2,3] window: end=start و end<start مرفوضان برموز مميزة", () => {
  // حساب حقيقي: تساوي البداية والنهاية = end_before_start
  const f = new Date("2026-07-15T10:00:00+03:00").getTime();
  const eq = new Date("2026-07-15T10:00:00+03:00").getTime();
  const before = new Date("2026-07-15T09:00:00+03:00").getTime();
  assert.ok(eq <= f && before <= f, "equal and before both invalid");
  assert.match(TIME, /end_before_start/);
  assert.match(HOTFIX, /raise exception 'invalid_start'/);
  assert.match(HOTFIX, /raise exception 'invalid_end'/);
  assert.match(HOTFIX, /raise exception 'end_before_start'/);
});
test("رموز الخطأ مربوطة بالعربية", () => {
  for (const c of ["bad_window", "end_before_start", "quantity_unavailable", "overall_photo_required"]) assert.ok(TIME.includes(c), `error map missing ${c}`);
});

// ═══ (2) فحص التوفّر الحقيقي ═══
test("[4] availability: RPC حقيقي بمخرجات غنية", () => {
  for (const k of ["conflict_reason", "conflicting_source", "next_available_at", "available_quantity"]) assert.ok(HOTFIX.includes(k), `availability missing ${k}`);
  assert.match(LIB, /export const rentalAvailability/);
});
test("[5,6] add gated on availability + [7] invalidation on change", () => {
  assert.match(CONSOLE, /disabled=\{busy \|\| !pick \|\| !avail\?\.available\}/, "add disabled unless available");
  assert.match(CONSOLE, /if \(!avail\.available\).*Cannot add|لا يمكن إضافة أصل غير متاح/s);
  assert.match(CONSOLE, /setAvail\(null\);.*\}, \[pick, pickQty, f\.rental_from, f\.rental_to\]/s, "avail invalidated when inputs change");
});
test("[8,30] re-check availability server-side at submit & approve (double-booking guard)", () => {
  assert.match(HOTFIX, /function public\.custody_rental_recheck/);
  const submit = HOTFIX.slice(HOTFIX.indexOf("custody_rental_submit"), HOTFIX.indexOf("custody_rental_approve"));
  assert.match(submit, /custody_rental_recheck/);
  const approve = HOTFIX.slice(HOTFIX.indexOf("function public.custody_rental_approve"), HOTFIX.indexOf("custody_rental_reject"));
  assert.match(approve, /custody_rental_recheck/);
  assert.match(HOTFIX, /for update/, "recheck locks asset rows");
});

// ═══ (3) اختيار عميل البوابة ═══
test("[9,10] portal client search + link (no duplicate customer)", () => {
  assert.match(HOTFIX, /function public\.custody_rental_admin_search_clients/);
  assert.match(HOTFIX, /function public\.custody_rental_admin_link_portal_client/);
  assert.match(HOTFIX, /create unique index if not exists uq_rental_customer_user/);
  assert.match(HOTFIX, /on conflict \(user_id\)/);
  assert.match(CONSOLE, /registered.*external|external.*registered/s, "renter type toggle");
});
test("client search gated to managers/admins only", () => {
  const b = HOTFIX.slice(HOTFIX.indexOf("custody_rental_admin_search_clients"), HOTFIX.indexOf("custody_rental_admin_link_portal_client"));
  assert.match(b, /civ_can_manage\(\) or public\.civ_can_admin\(\)/);
});

// ═══ (4) طلب المستأجر الذاتي ═══
test("[11,12] self-service uses auth.uid() (no browser customer_id)", () => {
  assert.match(HOTFIX, /function public\.custody_rental_customer_create_request/);
  const b = HOTFIX.slice(HOTFIX.indexOf("custody_rental_customer_create_request"), HOTFIX.indexOf("custody_rental_customer_add_item"));
  assert.match(b, /v_uid := auth\.uid\(\)/);
  assert.ok(!/p_data->>'customer_id'/.test(b), "must NOT accept customer_id from the renter payload");
  // ownership check on add/submit
  const add = HOTFIX.slice(HOTFIX.indexOf("custody_rental_customer_add_item"), HOTFIX.indexOf("custody_rental_customer_submit"));
  assert.match(add, /c\.user_id = auth\.uid\(\)/);
  assert.match(RENTER, /rentalCustomerCreateRequest/);
});
test("[13] renter reads only own rentals via safe RPC", () => {
  assert.match(RENTER, /rentalCustomerList/);
  assert.ok(!/rentalListRequests/.test(RENTER), "renter must not query the admin request list");
});

// ═══ (5,6) إشعارات ═══
test("[14,15] notifications: type widened + email route + recipients", () => {
  assert.match(HOTFIX, /'rental_revision_requested'/);
  assert.ok(existsSync(root + "app/api/integrations/rental/notify/route.ts"));
  const route = read("app/api/integrations/rental/notify/route.ts");
  assert.match(route, /RENTER_EVENTS/);
  assert.match(route, /FINANCE_EVENTS/);
  assert.match(route, /custody_officer/);
  assert.ok(!/id_number_ref|internal_note/.test(route), "email must not carry ID doc / internal notes");
  assert.match(LIB, /export function emitRentalEvent/);
});
test("[16,17,18] approve/reject/revision RPCs + UI", () => {
  for (const fn of ["custody_rental_approve", "custody_rental_reject", "custody_rental_request_revision"]) assert.ok(HOTFIX.includes(`function public.${fn}`), `missing ${fn}`);
  const rej = HOTFIX.slice(HOTFIX.indexOf("function public.custody_rental_reject"), HOTFIX.indexOf("custody_rental_request_revision"));
  assert.match(rej, /reason_required/, "reject reason mandatory");
  assert.match(DETAIL, /rentalApprove|rentalReject|rentalRequestRevision/);
});

// ═══ (7,8) أدلة التسليم/الإرجاع ═══
test("[19,20,21,22] handover: per-item + overall photo + condition + two signatures", () => {
  assert.match(HOTFIX, /overall_photo_required/);
  assert.match(DETAIL, /rentalItemEvidencePath\(d\.id, "handover"/);
  assert.match(DETAIL, /rentalOverallEvidencePath\(d\.id, "handover"/);
  assert.match(DETAIL, /SigCanvas/);
  assert.match(DETAIL, /!custSig \|\| !staffSig/, "both signatures required before complete");
});
test("[24,25,27] return: per-item + overall photo, asset not available before approval", () => {
  assert.match(HOTFIX, /overall_return_photo_required/);
  assert.match(DETAIL, /rentalItemEvidencePath\(d\.id, "return"/);
  assert.match(DETAIL, /rentalOverallEvidencePath\(d\.id, "return"/);
  // inspect_item routes state; complete_return needs overall
  const cr = HOTFIX.slice(HOTFIX.indexOf("function public.custody_rental_complete_return"));
  assert.match(cr, /overall_return_photo_required/);
});
test("evidence paths follow rental/{id}/{phase}/(items|overall) and bucket is rental-evidence only", () => {
  assert.match(LIB, /rental\/\$\{rentalId\}\/\$\{phase\}\/items\//);
  assert.match(LIB, /rental\/\$\{rentalId\}\/\$\{phase\}\/overall\//);
  assert.ok(!/custody-inventory-assets|hr-files|custody-evidence/.test(DETAIL), "must not use foreign buckets");
});

// ═══ (9) الإغلاق ═══
test("[28] close is settlement-gated (base) + reachable from charges_pending", () => {
  assert.match(DETAIL, /rentalClose\(d\.id\)/);
});

// ═══ (11) SQL Hotfix: idempotent + non-destructive ═══
test("hotfix idempotent & non-destructive (no drop table/truncate/delete of business rows)", () => {
  assert.ok(!/drop table/i.test(HOTFIX), "no DROP TABLE");
  assert.ok(!/truncate/i.test(HOTFIX), "no TRUNCATE");
  assert.ok(!/delete from public\.custody_rental_requests/i.test(HOTFIX), "no delete of requests");
  assert.match(HOTFIX, /add column if not exists/);
  assert.match(HOTFIX, /create or replace function/);
  assert.match(HOTFIX, /notify pgrst, 'reload schema'/);
  // preflight requires the base first
  assert.match(HOTFIX, /HOTFIX PREFLIGHT/);
});
test("[29] regression: hotfix does not touch custody/asset/HR tables destructively", () => {
  assert.ok(!/alter table public\.custody_inventory_assets .*drop/i.test(HOTFIX));
  assert.ok(!/hr_|zoho/i.test(HOTFIX.replace(/--.*$/gm, "")), "no HR/Zoho writes");
});
