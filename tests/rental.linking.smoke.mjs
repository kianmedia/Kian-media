// اختبارات إصلاح ربط عميل البوابة (node:test — بلا حزم/DB). PostgREST يطابق أسماء
// البارامترات حرفيًا؛ هذه تحمي التوقيع p_profile_id، منع التكرار، وتطبيع الرد.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const LINK = read("docs/rental_client_linking_HOTFIX_RUNME.sql");
const BASE = read("docs/rental_insurance_production_RUNME.sql");
const OP = read("docs/rental_portal_operational_HOTFIX_RUNME.sql");
const LIB = read("lib/portal/rental.ts");
const TIME = read("lib/portal/rentalTime.ts");
const CONSOLE = read("components/portal/rental/RentalConsole.tsx");

test("linking hotfix file exists", () => {
  assert.ok(existsSync(root + "docs/rental_client_linking_HOTFIX_RUNME.sql"));
});

// ═══ [3] التوقيع القانوني p_profile_id ═══
test("canonical signature p_profile_id uuid + SECURITY DEFINER + search_path public, auth", () => {
  assert.match(LINK, /create function public\.custody_rental_admin_link_portal_client\(p_profile_id uuid\) returns jsonb/);
  assert.match(LINK, /security definer set search_path = public, auth/);
});
test("[4] drops old overload by EXACT signature (uuid), never bare name (name change needs DROP)", () => {
  assert.match(LINK, /drop function if exists public\.custody_rental_admin_link_portal_client\(uuid\)/);
  assert.ok(!/drop function if exists public\.custody_rental_admin_link_portal_client;/.test(LINK), "no bare-name drop");
});

// ═══ منع التكرار ═══
test("dedup via unique index on user_id + upsert reuse (no clobber of existing)", () => {
  assert.match(LINK, /create unique index if not exists uq_rental_customer_user on public\.custody_rental_customers\(user_id\) where user_id is not null/);
  assert.match(LINK, /on conflict \(user_id\) where user_id is not null do update set updated_at = now\(\)/);
  // لا يستقبل الاسم/البريد/الجوال من المتصفح — يقرأ من profiles فقط
  const body = LINK.slice(LINK.indexOf("create function public.custody_rental_admin_link_portal_client"));
  assert.ok(!/p_full_name|p_email|p_mobile|p_name/.test(body), "must not accept name/email/mobile params");
});

// ═══ الرد القانوني + الصلاحيات + الأخطاء ═══
test("canonical response shape + role gate + account validation", () => {
  const body = LINK.slice(LINK.indexOf("create function public.custody_rental_admin_link_portal_client"));
  for (const k of ["rental_customer_id", "profile_id", "full_name", "company", "email", "mobile", "account_type"]) assert.ok(body.includes(`'${k}'`), `response missing ${k}`);
  assert.match(body, /civ_can_admin\(\) or public\.civ_can_manage\(\)/, "owner/super_admin/admin/manager gated");
  assert.match(body, /profile_not_found/);
  assert.match(body, /invalid_account/);
  assert.match(body, /account_type not in \('client','admin'\)/);
});
test("grants authenticated, revoke public/anon, NOTIFY, validation, non-destructive", () => {
  assert.match(LINK, /grant execute on function public\.custody_rental_admin_link_portal_client\(uuid\) to authenticated/);
  assert.match(LINK, /revoke all on function public\.custody_rental_admin_link_portal_client\(uuid\) from public, anon/);
  assert.match(LINK, /notify pgrst, 'reload schema'/);
  assert.match(LINK, /pg_get_function_identity_arguments/);
  assert.ok(!/drop table|truncate|delete from public/i.test(LINK));
});

// ═══ [7] الإصلاح مدمج في base + operational (لا يعود في تثبيت جديد) ═══
test("canonical p_profile_id present in base RUNME and operational hotfix too", () => {
  assert.match(BASE, /create function public\.custody_rental_admin_link_portal_client\(p_profile_id uuid\)/);
  assert.match(BASE, /drop function if exists public\.custody_rental_admin_link_portal_client\(uuid\)/);
  assert.match(OP, /create function public\.custody_rental_admin_link_portal_client\(p_profile_id uuid\)/);
  assert.ok(!/custody_rental_admin_link_portal_client\(p_profile uuid\)/.test(OP), "old p_profile signature must be gone from operational");
});

// ═══ [5] lib: يرسل p_profile_id + يطبّع الرد + يشترط rental_customer_id ═══
test("lib wrapper sends p_profile_id and normalizes response", () => {
  assert.match(LIB, /custody_rental_admin_link_portal_client", \{ p_profile_id: profileId \}/);
  assert.match(LIB, /Array\.isArray\(d\) \? d\[0\] : \(\(d as Record<string, unknown>\)\?\.row \?\? \(d as Record<string, unknown>\)\?\.data \?\? d\)/);
  assert.match(LIB, /const rcid = row\.rental_customer_id \?\? row\.customer_id/);
  assert.match(LIB, /if \(!rcid\) return \{ ok: false, error: "link_no_id" \}/);
});
test("real: response normalization picks row from Array/object/row/data and requires rental_customer_id", () => {
  const pick = (d) => Array.isArray(d) ? d[0] : (d?.row ?? d?.data ?? d);
  assert.deepEqual(pick([{ rental_customer_id: "x" }]), { rental_customer_id: "x" });
  assert.deepEqual(pick({ row: { rental_customer_id: "y" } }), { rental_customer_id: "y" });
  assert.deepEqual(pick({ rental_customer_id: "z" }), { rental_customer_id: "z" });
  const noId = pick({}) ?? {};
  assert.ok(!(noId.rental_customer_id ?? noId.customer_id), "missing id → treated as failure");
});

// ═══ [5,6] UI: يعيد استخدام rental_customer_id، رسائل دقيقة ═══
test("UI reuses rental_customer_id (no re-link) and maps precise link errors", () => {
  assert.match(CONSOLE, /if \(c\.rental_customer_id\)/);
  assert.match(CONSOLE, /flash\(rentalLinkErrorAr\(r\.error\)\)/);
  assert.match(CONSOLE, /d\.rental_customer_id/);
  assert.match(CONSOLE, /phone: d\.mobile/);
});
test("[6] rentalLinkErrorAr precise Arabic messages, no raw PostgREST", () => {
  assert.match(TIME, /خدمة ربط العميل غير مطبقة في قاعدة البيانات/);
  assert.match(TIME, /ليس لديك صلاحية لاختيار هذا العميل/);
  assert.match(TIME, /حساب العميل غير موجود/);
  assert.match(TIME, /الحساب المحدد ليس حساب عميل صالحًا/);
  assert.ok(!/Could not find the function|schema cache/.test(CONSOLE), "no raw PostgREST text in UI");
});
