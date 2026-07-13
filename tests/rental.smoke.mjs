// اختبارات دخانية بنيوية لبوابة التأجير V1 (node:test + node:fs — بلا حزم).
// تحمي ضد الانحدارات الحرجة في الأساس والطبقة التشغيلية: وجود الملفات، آلة الحالات،
// منع الازدواج (قفل الأصل)، صلاحية المالية، RLS، الحفاظ على أنواع الإشعارات، buckets.
// ملاحظة: هذه أكيدات ساكنة على الملفات — لا تشغّل SQL. التحقق الحقيقي = CI + تطبيق RUNME.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const RUNME = read("docs/rental_insurance_production_RUNME.sql");
const LIB = read("lib/portal/rental.ts");

test("rental files exist (RUNME, rollback, lib, UI, page, fixtures)", () => {
  for (const p of [
    "docs/rental_insurance_production_RUNME.sql", "docs/rental_insurance_ROLLBACK.md",
    "docs/rental_insurance_fixtures_PREVIEW.sql", "lib/portal/rental.ts",
    "components/portal/rental/RentalConsole.tsx", "components/portal/rental/RentalDetail.tsx",
    "components/portal/rental/RenterRentalView.tsx", "app/client-portal/rentals/page.tsx",
  ]) assert.ok(existsSync(root + p), `missing ${p}`);
});

test("does NOT duplicate patch-05 tables (uses ALTER, not CREATE TABLE for rental core)", () => {
  for (const tbl of ["custody_rental_requests", "custody_rental_items", "custody_rental_contracts", "custody_rental_customers"]) {
    assert.ok(!RUNME.includes(`create table if not exists public.${tbl}`), `RUNME must not recreate ${tbl}`);
    assert.ok(RUNME.includes(`alter table public.${tbl}`), `RUNME should ALTER ${tbl}`);
  }
});

test("concurrency: add_item locks the ASSET row FOR UPDATE (double-booking guard)", () => {
  assert.match(RUNME, /custody_inventory_assets where id = p_asset and is_deleted = false for update/);
  // handover re-checks availability and decrements + rental_out movement
  assert.ok(RUNME.includes("'rental_out'") && RUNME.includes("'rental_return'"), "rental movement types present");
});

test("state machine + lifecycle RPCs exist", () => {
  for (const fn of [
    "custody_rental_transition", "custody_rental_availability", "custody_rental_admin_upsert_request",
    "custody_rental_generate_contract", "custody_rental_sign_contract", "custody_rental_start_handover",
    "custody_rental_complete_handover", "custody_rental_request_return", "custody_rental_inspect_item",
    "custody_rental_complete_return", "custody_rental_add_charge", "custody_rental_approve_charge",
    "custody_rental_finance_price", "custody_rental_finance_deposit", "custody_rental_close",
    "custody_rental_cancel", "custody_rental_mark_overdue", "custody_rental_dashboard",
    "custody_rental_get", "custody_rental_calendar", "custody_rental_customer_get", "custody_rental_customer_list",
  ]) assert.ok(RUNME.includes(`function public.${fn}`), `RPC ${fn} missing`);
});

test("financial actions gated to finance role", () => {
  // price + deposit + approve_charge require civ_can_finance
  const priceBlock = RUNME.slice(RUNME.indexOf("custody_rental_finance_price"), RUNME.indexOf("custody_rental_finance_deposit"));
  assert.match(priceBlock, /civ_can_finance\(\)/);
  const approveBlock = RUNME.slice(RUNME.indexOf("custody_rental_approve_charge"), RUNME.indexOf("custody_rental_close"));
  assert.match(approveBlock, /civ_can_finance\(\)/);
});

test("close requires settlement (no closed before deposit/charges settled)", () => {
  const closeBlock = RUNME.slice(RUNME.indexOf("function public.custody_rental_close"), RUNME.indexOf("custody_rental_cancel"));
  assert.match(closeBlock, /charges_open|status = 'reported'/);
  assert.match(closeBlock, /deposit_unsettled|deposit_status/);
});

test("RLS: reads manager/finance only; renter via safe RPC (no internal_note leak)", () => {
  assert.ok(RUNME.includes("civ_rental_req_read"), "tightens patch-05 request read policy");
  // customer_list must NOT select internal_note / deposit_method / deposit_ref
  const custBlock = RUNME.slice(RUNME.indexOf("function public.custody_rental_customer_list"), RUNME.indexOf("commit;", RUNME.indexOf("custody_rental_customer_list")));
  assert.ok(!/internal_note|deposit_method|deposit_ref_no/.test(custBlock), "customer_list must not expose internal fields");
});

test("notifications CHECK preserves ALL prior types AND adds rental V1 types", () => {
  const prior = ["quote_request_new", "hr_note_new", "civ_self_issue", "rental_request_created", "insurance_claim_updated", "zoho_sync_failed"];
  for (const t of prior) assert.ok(RUNME.includes(`'${t}'`), `dropped prior notification '${t}'`);
  for (const t of ["rental_approved", "rental_activated", "rental_closed", "rental_return_requested"]) assert.ok(RUNME.includes(`'${t}'`), `missing rental type '${t}'`);
});

test("private buckets created (append-only) and cron stays daily", () => {
  for (const b of ["rental-evidence", "rental-contracts", "rental-private-documents"]) assert.ok(RUNME.includes(`'${b}'`), `bucket ${b} missing`);
  assert.ok(read("vercel.json").includes('"0 3 * * *"'), "vercel cron must stay daily (Hobby)");
});

test("lib exposes wrappers for the lifecycle + storage helpers", () => {
  for (const s of ["rentalGenerateContract", "rentalSignContract", "rentalCompleteHandover", "rentalInspectItem",
    "rentalApproveCharge", "rentalClose", "rentalDashboard", "rentalCustomerList", "rentalUpload", "rentalUploadSignature"])
    assert.ok(new RegExp(`export (const|async function|function) ${s}\\b`).test(LIB), `lib missing ${s}`);
});

test("fixtures are PREVIEW-only and marked", () => {
  const fx = read("docs/rental_insurance_fixtures_PREVIEW.sql");
  assert.match(fx, /PREVIEW|لا تشغّله على Production/);
  assert.ok(fx.includes("'FIXTURE'"), "fixtures must be tagged FIXTURE for cleanup");
});
