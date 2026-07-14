// اختبارات: الرفع الخادمي الموقّع (Signed Upload) + دورة إرجاع المستأجر المضبوطة.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const SQL = read("docs/rental_evidence_and_return_FINAL_HOTFIX_RUNME.sql");
const UNI = read("docs/rental_v1_final_production_RUNME.sql");
const ADMIN = read("lib/server/supabaseAdmin.ts");
const UPURL = read("app/api/rental/evidence/upload-url/route.ts");
const FIN = read("app/api/rental/evidence/finalize/route.ts");
const LIB = read("lib/portal/rental.ts");
const TIME = read("lib/portal/rentalTime.ts");
const RENTER = read("components/portal/rental/RenterRentalView.tsx");

test("files exist; SQL idempotent + non-destructive", () => {
  for (const p of ["docs/rental_evidence_and_return_FINAL_HOTFIX_RUNME.sql", "app/api/rental/evidence/upload-url/route.ts", "app/api/rental/evidence/finalize/route.ts", "lib/portal/rentalImage.ts"]) assert.ok(existsSync(root + p), `missing ${p}`);
  assert.ok(!/drop table|truncate/i.test(SQL));
  assert.match(SQL, /notify pgrst, 'reload schema'/);
});

// ═══ [2] الرفع عبر Signed Upload URL خادمي — لا يعتمد على سياسة Storage للمستأجر ═══
test("server signs upload URL with service key; browser never sends the path", () => {
  assert.match(ADMIN, /createSignedUploadUrl/);
  assert.match(ADMIN, /object\/upload\/sign\/\$\{bucket\}/);
  assert.match(UPURL, /createSignedUploadUrl\(BUCKET, path\)/);
  // الخادم يبني المسار (لا يقبل path من الجسم)
  assert.ok(!/b\.storage_path|b\.path\b/.test(UPURL), "upload-url must NOT accept a client path");
  assert.match(UPURL, /rental\/\$\{rentalId\}\/\$\{folder\}\/items\/\$\{itemId\}/);
});
test("upload-url authorizes owner/staff + status per stage; item belongs to request", () => {
  assert.match(UPURL, /const isOwner = ownerUid !== "" && ownerUid === caller/);
  assert.match(UPURL, /account_type === "admin" \|\| \["super_admin", "manager", "custody_officer"\]/);
  assert.match(UPURL, /return_request.*\["active", "overdue", "return_requested"\]/s);
  assert.match(UPURL, /item_not_in_request/);
});
test("finalize creates the row via RPC as the USER (auth.uid) + orphan cleanup on failure", () => {
  assert.match(FIN, /rpcAsUser<[^>]*>\("custody_rental_finalize_evidence"/);
  assert.match(FIN, /deleteStorageObjectAsService\(BUCKET, path\)/);
});
test("finalize RPC: ownership/stage/path/storage-object/dedup; signature stored on request", () => {
  const b = SQL.slice(SQL.indexOf("function public.custody_rental_finalize_evidence"));
  assert.match(b, /position\('rental\/'\|\|p_rental_id::text\|\|'\/' in p_storage_path\) <> 1/);
  assert.match(b, /storage\.objects o where o\.bucket_id = 'rental-evidence' and o\.name = p_storage_path/);
  assert.match(b, /file_path = p_storage_path\) then return jsonb_build_object\('ok', true, 'duplicate', true\)/);
  assert.match(b, /consent_signature_path = p_storage_path/);
  assert.match(b, /return_consent_signature_path = p_storage_path/);
  assert.match(b, /set search_path = public, storage/);
});
test("[1] upload error mapping names the failing stage (no generic-only)", () => {
  assert.match(TIME, /function rentalUploadErrorAr/);
  assert.match(TIME, /لا تملك صلاحية رفع صورة لهذا الطلب/);
  assert.match(TIME, /لا يمكن إضافة صور بعد إرسال أو إغلاق الطلب/);
  assert.match(TIME, /خدمة حفظ الصور غير مطبقة في قاعدة البيانات/);
  assert.match(TIME, /تعذر رفع الصورة إلى التخزين/);
  assert.match(TIME, /تم رفع الملف ولكن تعذر ربطه بالطلب/);
  assert.match(LIB, /export async function rentalUploadEvidence/);
  assert.match(LIB, /`attach:\$\{fin\.error\}`/);
});

// ═══ [7-12] دورة إرجاع المستأجر المضبوطة ═══
test("renter return-request requires per-item + overall return photo + signature; sets return_requested only", () => {
  const b = SQL.slice(SQL.indexOf("function public.custody_rental_customer_request_return"));
  assert.match(b, /r\.status not in \('active','overdue'\) then raise exception 'bad_status'/);
  assert.match(b, /return_item_photo_required/);
  assert.match(b, /return_overall_photo_required/);
  assert.match(b, /return_consent_signature_path.*= '' then raise exception 'consent_required'/s);
  assert.match(b, /status = 'return_requested'/);
  // لا يغيّر الأصل إلى available ولا يغلق
  assert.ok(!/quantity_available|status = 'closed'/.test(b), "renter return must not free asset or close");
});
test("[7,2] renter return button only for active/overdue; full form (not prompt)", () => {
  assert.match(RENTER, /\(status === "active" \|\| status === "overdue"\) && !returning/);
  assert.match(RENTER, /function RenterReturn/);
  assert.match(RENTER, /stage: "return_request"/);
  assert.match(RENTER, /RETURN_CONDS/);
});
test("[10] renter cannot close — close/complete stay staff-only (not in renter file)", () => {
  assert.ok(!/rentalClose|rentalCompleteReturn|custody_rental_close|custody_rental_complete_return/.test(RENTER), "renter UI must not call close/complete");
});

// ═══ الملف الموحّد ═══
test("unified has 7 parts incl the final return hotfix; balanced", () => {
  assert.match(UNI, /rental_evidence_and_return_FINAL_HOTFIX/);
  const parts = ["operational_HOTFIX", "signatures_and_availability", "client_linking", "renter_binding_evidence", "damage_invoice", "request_evidence_upload", "evidence_and_return_FINAL"];
  let last = -1; for (const p of parts) { const i = UNI.indexOf(p); assert.ok(i > last, `part order: ${p}`); last = i; }
});
