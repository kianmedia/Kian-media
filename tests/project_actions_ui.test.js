// ════════════════════════════════════════════════════════════════════════════
// tests/project_actions_ui.test.js — «إجراءات المشروع» reaches the REAL page
//
// The owner checked Production and found hold / resume / cancel missing. They were:
// project_core_hold_action was deployed and granted, but there was NO TypeScript wrapper
// and NO UI — the RPC was unreachable from the product. Backend existence is not a
// feature. These pins tie the action to the actual route the user opens.
//
// Route: app/client-portal/project-core/[projectId]/page.tsx → ProjectOps (the lifecycle
// section) → ProjectActionsMenu.
// Static only — no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const ROUTE = R("app/client-portal/project-core/[projectId]/page.tsx");
const OPS = R("components/portal/projectcore/ProjectOps.tsx");
const MENU = R("components/portal/projectcore/ProjectActionsMenu.tsx");
const CORE = R("lib/portal/projectCore.ts");
const LIFE = R("lib/project-core/lifecycle.ts");

// ─── the chain from the real URL to the action ───
test("W1: the route renders ProjectOps, and ProjectOps mounts the actions menu", () => {
  assert.ok(/<ProjectOps/.test(ROUTE), "the real project page renders ProjectOps");
  assert.ok(/import ProjectActionsMenu, \{ stageBarLocked \}/.test(OPS), "menu imported");
  assert.ok(/<ProjectActionsMenu/.test(OPS), "menu actually rendered");
  // and it sits in the lifecycle section, beside the bar
  const i = OPS.indexOf("<ProjectActionsMenu");
  // النافذة أوسع من 1500: بين شريط المراحل والقائمة يقع الآن مسار «طلب انتقال»
  // لمن لا يملك قرار النقل. الثابت المُختبَر واحد: القائمة داخل قسم دورة الحياة.
  const before = OPS.slice(Math.max(0, i - 3000), i);
  assert.ok(/PC_STAGES\.map/.test(before), "rendered right after the stage bar");
});

test("W2: the TS wrapper for the RPC now exists (it did not before)", () => {
  assert.ok(/export const pcHoldAction/.test(CORE), "wrapper exported");
  assert.ok(/"project_core_hold_action"/.test(CORE), "calls the deployed RPC");
  assert.ok(/p_project: projectId, p_action: action, p_reason: reason/.test(CORE), "passes the mandatory reason");
});

// ─── the three actions + reopen ───
test("W3: hold / resume / cancel / reopen are all offered", () => {
  for (const k of ["hold", "resume", "cancel", "reopen"]) assert.ok(MENU.includes(`${k}:`), `${k} defined`);
  for (const label of ["تعليق المشروع", "استئناف المشروع", "إلغاء المشروع", "إعادة فتح المشروع"]) {
    assert.ok(MENU.includes(label), `Arabic label: ${label}`);
  }
});

test("W4: availability follows the current state, and absence is explained", () => {
  assert.ok(/if \(!onHold && !cancelled && !closed\) available\.push\("hold"\)/.test(MENU), "hold only while active");
  assert.ok(/if \(onHold\) available\.push\("resume"\)/.test(MENU), "resume only while on hold");
  assert.ok(/if \(closed && isOwner\) available\.push\("reopen"\)/.test(MENU), "reopen only for the owner on a closed project");
  assert.ok(/إعادة الفتح للمالك فقط/.test(MENU), "a missing action is explained, not silently absent");
});

test("W5: every action demands a reason, shows its impact, and confirms", () => {
  assert.ok(/السبب \(إلزامي\)/.test(MENU), "mandatory reason field");
  assert.ok(/if \(!txt\) \{[\s\S]{0,120}السبب إلزامي/.test(MENU), "empty reason blocked");
  assert.ok(/disabled=\{busy \|\| !reason\.trim\(\)\}/.test(MENU), "confirm disabled until a reason is typed");
  assert.ok(/impact:/.test(MENU) && /confirm:/.test(MENU), "impact text + explicit confirmation per action");
  assert.ok(/يُسجَّل في سجلّ التدقيق/.test(MENU), "the user is told it is audited");
});

test("W6: cancel states plainly that nothing is deleted", () => {
  assert.ok(/الإلغاء لا يحذف شيئًا/.test(MENU));
  assert.ok(/تبقى المخرجات والملفات والتعليقات والاعتمادات وسجلّ التدقيق محفوظة/.test(MENU));
});

test("W7: resume restores the PRE-HOLD stage, and says so", () => {
  assert.ok(/المرحلة التي كان فيها قبل التعليق/.test(MENU), "explains the real behaviour");
  assert.ok(/لا إلى مرحلة ثابتة|not to a fixed stage/.test(MENU), "explicitly not a fixed stage");
});

// ─── the stage bar is suspended in an administrative state ───
test("W8: the linear stage bar is locked while on hold / cancelled / closed", () => {
  assert.ok(/export function stageBarLocked/.test(MENU), "helper exists");
  assert.ok(/isAdminState\(coreStage\) \|\| coreStage === "closed"/.test(MENU), "covers all three");
  assert.ok(/const barLocked = stageBarLocked\(core\?\.core_stage\)/.test(OPS), "computed in the page");
  // canAdminister (مالك/مدير) لا canManage: نقل مرحلة المشروع قرار إداريّ،
  // والمونتير يمرّ عبر «طلب انتقال» بدل زرّ تنفيذ.
  assert.ok(/disabled=\{busy \|\| !canAdminister \|\| barLocked\}/.test(OPS), "stage buttons disabled");
  assert.ok(/cursor-not-allowed/.test(OPS), "and visibly disabled");
  assert.ok(/المراحل موقوفة/.test(OPS), "tooltip explains why");
});

// ─── administrative states are NOT timeline steps ───
test("W9: on_hold / cancelled are administrative states, never stage-bar steps", () => {
  assert.ok(/export const ADMIN_STATES/.test(LIFE), "declared separately");
  const order = /export const LIFECYCLE_STAGES = \[([\s\S]*?)\] as const;/.exec(LIFE);
  assert.ok(order, "found the stage list");
  assert.ok(!/on_hold|cancelled/.test(order[1]), "they are NOT in the 13-step timeline");
  assert.ok(/isAdminState/.test(LIFE) && /adminStateColor/.test(LIFE), "helpers exported");
});

test("W10: every state renders in Arabic — no raw key can leak to the UI", () => {
  assert.ok(/const a = ADMIN_STATES\.find/.test(LIFE), "lifecycleLabel resolves admin states too");
  assert.ok(/ar: "معلّق"/.test(LIFE) && /ar: "ملغى"/.test(LIFE), "Arabic labels defined");
  assert.ok(/t\(lifecycleLabel\(stage\)\)/.test(MENU), "the badge uses the shared label helper");
});

test("W11: the state badge uses the single source of truth (no duplicated label map)", () => {
  assert.ok(/from "@\/lib\/project-core\/lifecycle"/.test(MENU), "imports the canonical module");
  assert.ok(!/const .*STAGE_LABELS.*=.*\{/.test(MENU), "no local copy of the stage labels");
});

test("SAFE: static only (no DB/network)", () => {
  const self = R("tests/project_actions_ui.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
