// اختبارات إصلاح رفع صور الطلب (HEIC/الحجم/السياسات/RPC الإرفاق/التطبيع) — node:test.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const SQL = read("docs/rental_request_evidence_upload_HOTFIX_RUNME.sql");
const BASE = read("docs/rental_insurance_production_RUNME.sql");
const UNI = read("docs/rental_v1_final_production_RUNME.sql");
const IMG = read("lib/portal/rentalImage.ts");
const LIB = read("lib/portal/rental.ts");
const RENTER = read("components/portal/rental/RenterRentalView.tsx");
const DETAIL = read("components/portal/rental/RentalDetail.tsx");

test("evidence-upload hotfix exists, idempotent, non-destructive", () => {
  assert.ok(existsSync(root + "docs/rental_request_evidence_upload_HOTFIX_RUNME.sql"));
  assert.ok(!/drop table|truncate/i.test(SQL));
  assert.match(SQL, /notify pgrst, 'reload schema'/);
});

// ═══ [1] السبب الجذري: HEIC + الحجم ═══
test("bucket MIME widened (+heic/heif) + size 20MB in hotfix AND base", () => {
  assert.match(SQL, /allowed_mime_types = array\['image\/jpeg','image\/png','image\/webp','image\/heic','image\/heif'\]/);
  assert.match(SQL, /file_size_limit = 20971520/);
  assert.match(BASE, /'image\/heic','image\/heif'\]\)/, "base bucket includes heic/heif");
});
test("client normalizes any image to JPEG (fixes HEIC/EXIF/size) before upload", () => {
  assert.match(IMG, /createImageBitmap\(file, \{ imageOrientation: "from-image" \}/);
  assert.match(IMG, /canvas\.toBlob\(res, "image\/jpeg"/);
  assert.match(IMG, /تعذّر معالجة صيغة الصورة/, "clear Arabic error for undecodable HEIC");
  assert.match(RENTER, /normalizeImageToJpeg/);
  assert.match(DETAIL, /normalizeImageToJpeg/);
});

// ═══ [9] سياسات Storage مُحكمة النطاق ═══
test("storage policies scoped: staff any / renter own-request; read+write+delete", () => {
  for (const p of ["rental evidence write v2", "rental evidence read v2", "rental evidence delete v2"]) assert.ok(SQL.includes(`"${p}"`), `missing policy ${p}`);
  assert.match(SQL, /req\.id::text = \(storage\.foldername\(name\)\)\[2\]/, "path rental_id scoped to owner");
  assert.match(SQL, /req\.status = 'draft'/, "delete only while draft");
  // old loose policies dropped
  assert.match(SQL, /drop policy if exists "rental evidence renter write"/);
});

// ═══ [7] RPC إرفاق موحّدة ═══
test("attach RPC validates path/type/dedup/storage-object/ownership/not-closed", () => {
  const b = SQL.slice(SQL.indexOf("function public.custody_rental_add_request_evidence"));
  assert.match(b, /p_evidence_type not in \('item_photo','overall_photo'\)/);
  assert.match(b, /item_photo' and p_rental_item_id is null then raise exception 'item_required'/);
  assert.match(b, /overall_photo' and p_rental_item_id is not null then raise exception 'overall_no_item'/);
  assert.match(b, /position\('rental\/'\|\|p_rental_id::text\|\|'\/' in p_storage_path\) <> 1 then raise exception 'bad_path'/);
  assert.match(b, /storage\.objects o where o\.bucket_id = 'rental-evidence' and o\.name = p_storage_path/); // object exists
  assert.match(b, /file_path = p_storage_path\) then\s*\n\s*return jsonb_build_object\('ok', true, 'duplicate', true\)/s); // dedup
  assert.match(b, /r\.status in \('closed','cancelled'\) then raise exception 'not_editable'/);
  assert.match(b, /set search_path = public, storage/);
});
test("unique index prevents duplicate evidence rows by path", () => {
  assert.match(SQL, /create unique index if not exists uq_rental_evidence_path on public\.custody_rental_evidence\(file_path\)/);
});

// ═══ [8] تدفق الواجهة: تطبيع→رفع→إرفاق→تنظيف اليتيم؛ النجاح بعد الإرفاق فقط ═══
test("UI upload flow: normalize→upload→attach→orphan-cleanup; success only after attach", () => {
  const b = RENTER.slice(RENTER.indexOf("async function doUpload"));
  assert.match(b, /const norm = await normalizeImageToJpeg\(file\)/);
  assert.match(b, /rentalUpload\(RENTAL_EVIDENCE_BUCKET, path, norm\.file\)/);
  assert.match(b, /rentalAddRequestEvidence\(created\.id, itemId/);
  assert.match(b, /void rentalDeleteObject\(RENTAL_EVIDENCE_BUCKET, path\)/, "orphan cleanup on attach failure");
  assert.match(b, /status: "done", preview: norm\.previewUrl, path/, "done only after attach ok");
});
test("[5,6] per-item photo button + overall + replace/remove + progress", () => {
  assert.match(RENTER, /إضافة صورة|استبدال/);
  assert.match(RENTER, /removePhoto\(it\.item_id\)/);
  assert.match(RENTER, /st\.status === "uploading"/, "progress state");
  assert.match(RENTER, /accept="image\/\*"[^>]*capture="environment"|capture="environment"/s);
});
test("[10] submit gated on all item photos + overall + signature; no upload-in-progress", () => {
  assert.match(RENTER, /const allItemPhotos = created \? created\.items\.every\(\(it\) => itemEv\[it\.item_id\]\?\.status === "done"\)/);
  assert.match(RENTER, /disabled=\{busy \|\| anyUploading \|\| !allItemPhotos \|\| !overallDone \|\| !sigData \|\| !ack\}/);
});

// ═══ الملف الموحّد + lib ═══
test("unified includes the evidence-upload part (6 parts) + lib helpers", () => {
  assert.match(UNI, /rental_request_evidence_upload_HOTFIX/);
  assert.match(LIB, /export const rentalAddRequestEvidence/);
  assert.match(LIB, /export async function rentalDeleteObject/);
  assert.match(LIB, /export const rentalRequestEvidenceStatus/);
});
