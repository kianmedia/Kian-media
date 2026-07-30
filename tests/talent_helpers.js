// ════════════════════════════════════════════════════════════════════════════
// tests/talent_helpers.js — مساعدات مشتركة لاختبارات شبكة المواهب والمورّدين.
// (ليس ملفّ اختبار، فلا يلتقطه node --test ولا تُعاد اختبارات غيره مرّتين.)
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const SQL = read("docs/talent_vendor_network_RUNME.sql");
const PREFLIGHT = read("docs/talent_vendor_network_PREFLIGHT.sql");
const POSTCHECK = read("docs/talent_vendor_network_POSTCHECK.sql");
const ROLLBACK = read("docs/talent_vendor_network_ROLLBACK.sql");
const LIB = read("lib/portal/talentNetwork.ts");

/** جسم دالّة معرَّفة بـ$$ … $$; */
function funcBody(name, src = SQL) {
  const re = new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name +
      "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;",
    "i",
  );
  const m = src.match(re);
  assert.ok(m, `تعذّر إيجاد جسم الدالّة ${name}`);
  return m[1];
}

/** رأس التصريح حتّى $$ — لقراءة volatility / security definer / search_path. */
function funcDecl(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$", "i"));
  assert.ok(m, `تعذّر إيجاد تصريح الدالّة ${name}`);
  return m[0];
}

/** كتلة SELF-TEST كاملة. */
function selfTest(src = SQL) {
  const m = src.match(/do \$st\$[\s\S]*?end \$st\$;/);
  assert.ok(m, "لا يوجد SELF-TEST في الترحيلة");
  return m[0];
}

/** كتلة DO بوسم محدَّد (مثل $bridge$ أو $grants$). */
function doBlock(tag, src = SQL) {
  const m = src.match(new RegExp("do \\$" + tag + "\\$[\\s\\S]*?end \\$" + tag + "\\$;"));
  assert.ok(m, `لا توجد كتلة do $${tag}$`);
  return m[0];
}

/** تعريف جدول (من create table حتّى ); المقابلة). */
function tableDef(name, src = SQL) {
  const start = src.indexOf(`create table if not exists public.${name} (`);
  assert.ok(start >= 0, `تعذّر إيجاد تعريف الجدول ${name}`);
  const end = src.indexOf("\n);", start);
  assert.ok(end > start, `تعريف الجدول ${name} غير مغلق`);
  return src.slice(start, end + 3);
}

const TABLES = [
  "tvn_settings", "tvn_profiles", "tvn_profile_rates", "tvn_profile_bank",
  "tvn_profile_restricted", "tvn_availability", "tvn_document_types", "tvn_documents",
  "tvn_assignments", "tvn_assignment_candidates", "tvn_reviews", "tvn_review_corrections",
  "tvn_incident_flags", "tvn_audit", "tvn_event_log",
];

/** المُسنَدات الستّة بأسمائها المتّفق عليها + المساعدان الأضيق. */
const PREDICATES = [
  "can_view_talent_network", "can_manage_talent_profiles", "can_view_vendor_rates",
  "can_verify_compliance", "can_assign_external_resources", "can_review_resource_performance",
  "tvn_can_view_bank", "tvn_can_approve_cost", "tvn_perm", "tvn_is_staff", "tvn_is_owner",
];

const PROFILE_TYPES = [
  "employee_candidate", "freelancer", "crew_member", "production_company",
  "equipment_vendor", "service_vendor", "studio", "location_provider",
  "transport_provider", "accommodation_provider", "voice_talent", "creative_talent", "other",
];

const AVAILABILITY_STATES = [
  "available", "unavailable", "tentative", "booked", "blocked", "pending_confirmation",
];

/** الأحداث السبعة التي تملكها هذه الحزمة. */
const TALENT_EVENTS = [
  "availability_confirmation_required", "assignment_proposed", "assignment_confirmed",
  "document_expiring", "document_expired", "vendor_suspended", "performance_review_due",
];

/** أحداث الأصول العشرة — تُعرَّف هنا ولا تُملَك هنا. */
const ASSET_EVENTS = [
  "custody_due", "custody_overdue", "asset_returned_pending_inspection",
  "asset_damage_reported", "asset_missing", "maintenance_due", "maintenance_overdue",
  "warranty_expiring", "reservation_conflict", "asset_available_again",
];

/** الموانع الصلبة الأربعة. */
const HARD_BLOCKERS = [
  "profile_not_assignable", "required_document_invalid",
  "schedule_conflict", "drone_permit_missing",
];

/** دوالّ الواجهة العامّة (تُمنَح لـauthenticated). */
const API_FNS = [
  "tvn_access", "tvn_profile_get", "tvn_profile_list", "tvn_profile_upsert",
  "tvn_profile_set_status", "tvn_rates_set", "tvn_bank_set", "tvn_restricted_set",
  "tvn_availability_set", "tvn_availability_confirm", "tvn_document_upsert",
  "tvn_document_verify", "tvn_document_alerts", "tvn_suggest", "tvn_assignment_propose",
  "tvn_assignment_approve", "tvn_assignment_confirm", "tvn_assignment_cancel",
  "tvn_assignment_complete", "tvn_review_submit", "tvn_review_close", "tvn_review_correct",
  "tvn_reviews_for_profile", "tvn_promote_opportunity", "tvn_vendor_link", "tvn_scan_alerts",
];

/** دوالّ داخلية — يجب ألّا تُمنَح لأحد. */
const INTERNAL_FNS = [
  "tvn_rating", "tvn_doc_valid", "tvn_missing_required_docs", "tvn_has_conflict",
  "tvn_assignment_guard", "tvn_emit", "tvn_log", "tvn_perm", "tvn_is_staff", "tvn_is_owner",
  "tvn_txt", "tvn_num", "tvn_bool", "tvn_arr", "tvn_event_keys", "tvn_asset_event_keys",
  "tvn_review_immutable",
];

/** المسارات التي يُمنع أن يدخلها الحقل المقيَّد. */
const SCORING_PATHS = [
  "tvn_suggest", "tvn_rating", "tvn_assignment_guard", "tvn_profile_list", "tvn_profile_get",
];

module.exports = {
  ROOT, read, exists, SQL, PREFLIGHT, POSTCHECK, ROLLBACK, LIB,
  funcBody, funcDecl, selfTest, doBlock, tableDef,
  TABLES, PREDICATES, PROFILE_TYPES, AVAILABILITY_STATES,
  TALENT_EVENTS, ASSET_EVENTS, HARD_BLOCKERS, API_FNS, INTERNAL_FNS, SCORING_PATHS,
};
