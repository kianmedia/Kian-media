// ════════════════════════════════════════════════════════════════════════════
// tests/crm_helpers.js — مساعدات مشتركة لاختبارات وحدة المبيعات (ليست ملفّ
// اختبار، فلا يلتقطها node --test ولا تُعاد اختبارات ملفّ آخر مرّتين).
// ════════════════════════════════════════════════════════════════════════════
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

const SQL = read("docs/crm_sales_FOUNDATION_RUNME.sql");
const PREFLIGHT = read("docs/crm_sales_FOUNDATION_PREFLIGHT.sql");
const POSTCHECK = read("docs/crm_sales_FOUNDATION_POSTCHECK.sql");
const ROLLBACK = read("docs/crm_sales_FOUNDATION_ROLLBACK.sql");
const LIB = read("lib/portal/crm.ts");

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

/** كتلة الـSELF-TEST كاملة. */
function selfTest(src = SQL) {
  const m = src.match(/do \$st\$[\s\S]*?end \$st\$;/);
  assert.ok(m, "لا يوجد SELF-TEST في الترحيلة");
  return m[0];
}

const TABLES = [
  "crm_settings", "crm_teams", "crm_team_members", "crm_companies", "crm_contacts",
  "crm_competitors", "crm_lead_score_rules", "crm_leads", "crm_pipelines", "crm_stages",
  "crm_opportunities", "crm_stage_history", "crm_activities", "crm_targets",
  "crm_commission_plans", "crm_commission_assignments", "crm_commission_records",
  "crm_import_batches", "crm_audit",
];

/** المُسنَدات — كلّها يجب أن تعيد boolean صريحًا ولا تعيد NULL أبدًا. */
const PREDICATES = [
  "crm_perm", "crm_perm_key_exists", "crm_is_owner_role", "crm_can_manage", "crm_can_view",
  "crm_is_client", "crm_can_view_commission", "crm_can_manage_commission",
  "crm_can_manage_targets", "crm_can_manage_pipeline", "crm_can_manage_scoring",
  "crm_can_import", "crm_can_view_team", "crm_can_see_owner", "crm_can_read_lead",
  "crm_can_edit_lead", "crm_can_read_opportunity", "crm_can_edit_opportunity",
  "crm_can_read_activity",
];

/** كلّ دالّة كتابة عامّة: بوّابة جلسة + منع صريح + تدقيق. */
const WRITE_FNS = [
  "crm_company_upsert", "crm_contact_upsert", "crm_competitor_upsert",
  "crm_lead_upsert", "crm_lead_set_status", "crm_lead_score_adjust", "crm_lead_convert",
  "crm_lead_delete", "crm_opportunity_upsert", "crm_opportunity_link_quote",
  "crm_opportunity_set_stage", "crm_opportunity_close", "crm_opportunity_reopen",
  "crm_opportunity_delete", "crm_handoff_confirm", "crm_activity_log", "crm_activity_delete",
  "crm_score_rule_upsert", "crm_settings_set", "crm_team_upsert", "crm_team_member_set",
  "crm_target_upsert", "crm_target_delete", "crm_commission_recalc",
  "crm_commission_plan_upsert", "crm_commission_assign", "crm_commission_set_status",
  "crm_import_leads",
];

const READ_FNS = [
  "crm_access", "crm_lookups", "crm_leads_list", "crm_lead_detail", "crm_duplicates",
  "crm_opportunities_list", "crm_opportunity_detail", "crm_pipeline_board", "crm_forecast",
  "crm_stale_alerts", "crm_activities_list", "crm_targets_list", "crm_commission_list",
  "crm_dashboard", "crm_export", "crm_audit_list",
];

/** الدوالّ الداخلية — لا تُمنح لـauthenticated ولا لـanon. */
const INTERNAL_FNS = [
  "crm_log", "crm_notify", "crm_norm_text", "crm_norm_email", "crm_norm_phone",
  "crm_setting_int", "crm_setting_text", "crm_project_label", "crm_quote_ref",
  "crm_next_code", "crm_score_core", "crm_duplicate_core", "crm_readiness_core",
  "crm_visible_leads", "crm_visible_opportunities", "crm_commission_recalc_core",
];

/** أسماء أشياء منصّة المشاريع التي لا يجوز أن تُكتب من هنا. */
const FROZEN_TABLES = [
  "projects", "project_core", "deliverables", "deliverable_internal",
  "project_transition_requests",
];

module.exports = {
  ROOT, read, exists, SQL, PREFLIGHT, POSTCHECK, ROLLBACK, LIB,
  funcBody, funcDecl, selfTest,
  TABLES, PREDICATES, WRITE_FNS, READ_FNS, INTERNAL_FNS, FROZEN_TABLES,
};
