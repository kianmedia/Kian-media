// اختبارات دخانية بلا أي حزمة (node:test + node:fs) — تُشغَّل بـ `npm test` / `node --test`.
// تحمي ضد الانحدارات البنيوية الحرجة: وجود ملفات SQL، الحفاظ على أنواع الإشعارات،
// ربط شاشة المزايا بالكونسول، تبعيات QR، وترتيب تشغيل SQL.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");

test("all 8 enterprise SQL patches exist", () => {
  for (let i = 0; i <= 7; i++) {
    const n = String(i).padStart(2, "0");
    const files = ["00_feature_flags", "01_qr_kits", "02_projects_conditions", "03_incidents_alerts",
      "04_gps_offline", "05_rental_insurance", "06_finance_zoho", "07_procurement_maintenance"];
    assert.ok(existsSync(root + `docs/custody_enterprise_${files[i]}_PATCH.sql`), `patch ${n} missing`);
  }
});

test("notifications CHECK preserves legacy types AND adds enterprise types", () => {
  const sql = read("docs/custody_enterprise_00_feature_flags_PATCH.sql");
  const mustHave = ["quote_request_new", "hr_note_new", "custody_claim_acknowledged", "invoice_created",
    "civ_self_issue", "kit_issued", "custody_overdue", "zoho_sync_failed", "insurance_expiring"];
  for (const t of mustHave) assert.ok(sql.includes(`'${t}'`), `notification type '${t}' missing from CHECK`);
});

test("Enterprise settings component is wired into the console (tab + import)", () => {
  const c = read("components/portal/custody-inventory/CustodyInventoryConsole.tsx");
  assert.ok(c.includes("import CustodyEnterpriseSettings"), "component not imported");
  assert.ok(c.includes("<CustodyEnterpriseSettings"), "component not rendered");
  assert.ok(c.includes('"enterprise"'), "enterprise tab not registered");
});

test("qrcode dependency + CI scripts present", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.dependencies.qrcode, "qrcode dependency missing");
  assert.ok(pkg.scripts.typecheck, "typecheck script missing");
  assert.ok(pkg.scripts.test, "test script missing");
});

test("cron alerts route is protected by CRON_SECRET", () => {
  const r = read("app/api/cron/custody-alerts/route.ts");
  assert.ok(r.includes("CRON_SECRET"), "cron route not protected by CRON_SECRET");
  assert.ok(r.includes("custody_run_alerts"), "cron route does not call custody_run_alerts");
});

test("SQL run order doc lists all patches in sequence", () => {
  const d = read("docs/CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md");
  for (const p of ["00_feature_flags", "01_qr_kits", "07_procurement_maintenance"])
    assert.ok(d.includes(p), `run-order missing ${p}`);
});

test("no legacy custody/rental tables are dropped by enterprise patches", () => {
  for (let i = 0; i <= 7; i++) {
    const files = ["00_feature_flags", "01_qr_kits", "02_projects_conditions", "03_incidents_alerts",
      "04_gps_offline", "05_rental_insurance", "06_finance_zoho", "07_procurement_maintenance"];
    const sql = read(`docs/custody_enterprise_${files[i]}_PATCH.sql`);
    assert.ok(!/drop table\s+(if exists\s+)?public\.(custody_records|custody_items|custody_photos|custody_events|renter_profiles)/i.test(sql),
      `patch ${i} drops a legacy custody table`);
  }
});
