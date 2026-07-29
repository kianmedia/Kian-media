// ════════════════════════════════════════════════════════════════════════════
// tests/ops_helpers.js — مساعدات مشتركة لاختبارات مركز التشغيل (ليست ملفّ اختبار،
// فلا يلتقطه node --test ولا تُعاد اختبارات ملفّ آخر مرّتين).
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/operations_center_RUNME.sql");

/** جسم دالّة plpgsql/sql مُعرَّفة بـ$$ … $$; */
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

/** رأس التصريح (حتى $$) — لقراءة volatility/security definer/search_path. */
function funcDecl(name, src = SQL) {
  const m = src.match(new RegExp(
    "create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$", "i"));
  assert.ok(m, `تعذّر إيجاد تصريح الدالّة ${name}`);
  return m[0];
}

const TABLES = [
  "ops_locations", "ops_vehicles", "ops_jobs", "ops_job_crew", "ops_job_equipment",
  "ops_job_permits", "ops_job_travel", "ops_job_accommodation", "ops_job_vehicles",
  "ops_job_hse", "ops_job_weather", "ops_media_cards", "ops_media_backups",
  "ops_ingest_jobs", "ops_post_handoff", "ops_daily_reports", "ops_incidents",
  "ops_delays", "ops_call_sheets", "ops_audit",
];

const WRITE_FNS = [
  "prodops_job_upsert", "prodops_job_set_status", "prodops_job_delete",
  "prodops_child_upsert", "prodops_child_delete", "prodops_hse_seed",
  "prodops_confirm_attendance", "prodops_daily_report_upsert",
  "prodops_post_handoff_progress", "prodops_backup_step",
  "prodops_location_upsert", "prodops_vehicle_upsert", "prodops_call_sheet_publish",
];

const READ_FNS = [
  "prodops_access", "prodops_jobs_list", "prodops_job_detail", "prodops_readiness",
  "prodops_my_assignments", "prodops_calendar", "prodops_conflicts",
  "prodops_call_sheet", "prodops_lookups", "prodops_dashboard",
];

const PUBLIC_FNS = [...READ_FNS, ...WRITE_FNS];

/** الأنواع الأربعة عشر التي يقبلها المُحرِّر العامّ (يجب أن تطابق الواجهة). */
const CHILD_KINDS = [
  "crew", "equipment", "permit", "travel", "accommodation", "vehicle_assignment",
  "hse", "weather", "media_card", "ingest", "post_handoff", "incident",
  "delay", "call_sheet",
];

module.exports = { ROOT, read, SQL, funcBody, funcDecl, TABLES, WRITE_FNS, READ_FNS, PUBLIC_FNS, CHILD_KINDS };
