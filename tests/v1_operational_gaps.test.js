// ════════════════════════════════════════════════════════════════════════════
// tests/v1_operational_gaps.test.js — V1 CLOSURE: the five operational gaps
//
// 1. CLOSURE POLICY was unreachable — pc_closure_settings_upsert was deployed and granted
//    but had ZERO callers, so every project ran on table defaults and the requirement
//    "a master must not close while a mandatory subproject is open" could not be turned
//    on at all.
// 2. CHANGE REQUESTS were create-only — a title-only draft blocked closure forever.
// 3. ISSUES / DECISIONS could be created but never resolved or closed.
// 4. CLIENT FINAL ACCEPTANCE had no client surface, so staff signed on the client's
//    behalf and the printed handover record carried a staff uid.
// 5. A CLOSED PROJECT stayed fully writable, so re-printing a signed closure report could
//    differ from the original with no trace.
//
// Static only — no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const POLICY = R("components/portal/projectcore/ClosurePolicyPanel.tsx");
const DRAWER = R("components/portal/projectcore/GovernanceItemDrawer.tsx");
const GOVTAB = R("components/portal/projectcore/GovernanceTab.tsx");
const CLOSTAB = R("components/portal/projectcore/ClosureTab.tsx");
const ACCEPT = R("components/portal/ClientFinalAcceptance.tsx");
const CLIENTPAGE = R("app/client-portal/projects/[id]/page.tsx");
const CLOSURELIB = R("lib/portal/projectClosure.ts");
const GUARD = R("docs/project_post_closure_protection_RUNME.sql");

// ─── 1. closure policy is reachable ───
test("P1: the closure policy panel exists and writes through the EXISTING RPC", () => {
  assert.ok(/pcClosureSettingsUpsert/.test(POLICY), "uses the deployed RPC");
  assert.ok(!/create table|new settings table/i.test(POLICY), "no parallel policy store");
  assert.ok(/require_child_projects_closed/.test(POLICY), "the master/subproject rule is configurable");
});
test("P2: it is mounted in the existing Closure tab and hydrated before the first save", () => {
  assert.ok(/<ClosurePolicyPanel/.test(CLOSTAB), "mounted");
  assert.ok(/pcClosureSettingsGet/.test(CLOSTAB) && /pcClosureSettingsGet/.test(CLOSURELIB), "read side added");
  assert.ok(/loadSettings/.test(CLOSTAB), "settings are loaded, not assumed");
});
test("P3: the panel states plainly when the subproject rule is OFF", () => {
  assert.ok(/الرئيسي لن يُغلق قبل اكتمال فروعه/.test(POLICY), "ON message");
  assert.ok(/غير مفعّل لهذا المشروع/.test(POLICY), "OFF warning — no silent default");
});
test("P4: configuring is management-only, client-side AND server-side", () => {
  assert.ok(/disabled=\{!canManage\}/.test(POLICY), "inputs disabled without permission");
  assert.ok(/canManage/.test(POLICY) && /busy \|\| !canManage/.test(POLICY), "save gated");
  // the RPC itself re-checks: is_staff AND (can_manage_projects OR governance.manage_settings)
});

// ─── 2/3. governance lifecycle ───
test("G1: the create-only prompt is gone; items open in a full editor", () => {
  assert.ok(!/async function quickAdd/.test(GOVTAB), "the one-line prompt path is removed");
  assert.ok(/GovernanceItemDrawer/.test(GOVTAB), "drawer wired");
  assert.ok(/onOpen=\{\(raw\) => openItem/.test(GOVTAB), "existing rows are openable");
});
test("G2: the change request walks its real lifecycle, one legal step at a time", () => {
  assert.ok(/CR_NEXT/.test(DRAWER), "explicit transition map");
  for (const s of ["draft", "internal_review", "client_pending", "approved", "rejected", "cancelled", "implemented"]) {
    assert.ok(DRAWER.includes(`${s}:`) || DRAWER.includes(`"${s}"`), `${s} present`);
  }
  assert.ok(/CR_NEXT\[status\]\?\.includes\(to\)/.test(DRAWER), "an illegal jump is refused");
});
test("G3: rejecting a change request demands a reason; sending to the client is confirmed", () => {
  assert.ok(/سبب الرفض \(إلزامي\)/.test(DRAWER), "reason prompt");
  assert.ok(/Reason required|سبب الرفض إلزامي/.test(DRAWER), "empty reason rejected");
  assert.ok(/client_pending[\s\S]{0,200}window\.confirm/.test(DRAWER), "sending to the client is explicit");
});
test("G4: applying an approved change request surfaces the server's own note (idempotent)", () => {
  assert.ok(/projectChangeRequestApply/.test(DRAWER), "uses the existing apply RPC");
  assert.ok(/note_ar/.test(DRAWER), "shows what the server actually did, incl. already_applied");
  assert.ok(/status === "approved"/.test(DRAWER), "apply is offered only when approved");
});
test("G5: closing an issue requires a resolution summary (client mirror of the server rule)", () => {
  assert.ok(/ISSUE_TERMINAL/.test(DRAWER));
  assert.ok(/resolution_summary/.test(DRAWER), "the field the server accepts");
  assert.ok(/A resolution summary is required to close|سبب الإغلاق\/الحل إلزامي/.test(DRAWER));
});
test("G6: decisions gained rationale/alternatives/impact/status — all server-accepted fields", () => {
  for (const f of ["rationale", "alternatives_considered", "impact", "review_date", "decision"]) {
    assert.ok(DRAWER.includes(f), `decision field ${f}`);
  }
});
test("G7: no new entity was introduced — only the existing three RPCs are used", () => {
  assert.ok(/pcIssueUpsert|pcDecisionUpsert|pcChangeRequestUpsert/.test(DRAWER));
  assert.ok(!/create table|insert into/i.test(DRAWER), "no direct table writes from the client");
});

// ─── 4. client acceptance ───
test("A1: the client has their own acceptance surface on the existing client route", () => {
  assert.ok(/<ClientFinalAcceptance/.test(CLIENTPAGE), "mounted on the existing page");
  assert.ok(!/app\/client-portal\/acceptance/.test(CLIENTPAGE), "no second client route invented");
  assert.ok(/projectFinalAcceptanceDecide/.test(ACCEPT), "uses the existing RPC that stamps auth.uid()");
});
test("A2: rejection and change-requests demand a reason; acceptance is explicitly confirmed", () => {
  assert.ok(/A reason is required|السبب إلزامي/.test(ACCEPT));
  assert.ok(/window\.confirm/.test(ACCEPT), "signing off is a deliberate act");
  assert.ok(/تُقرّ باستلام أعمال المشروع/.test(ACCEPT), "the client is told what they are signing");
});
test("A3: it shows only this client's pending rows and nothing internal", () => {
  assert.ok(/acceptance_type=eq\.client_final/.test(CLOSURELIB), "client rows only");
  assert.ok(/status=in\.\(pending,changes_requested\)/.test(CLOSURELIB), "pending only");
  assert.ok(!/cost|budget|margin|profit|internal/i.test(ACCEPT.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "")), "no internal or financial data rendered");
});
test("A4: nothing pending renders nothing (no empty box on the client page)", () => {
  assert.ok(/rows\.length === 0\) return/.test(ACCEPT));
});

// ─── 5. post-closure protection ───
test("C1: a closed project is write-protected at the TABLE level, not per-RPC", () => {
  assert.ok(/pc_block_writes_when_closed/.test(GUARD), "shared trigger function");
  assert.ok(/before insert or update or delete/.test(GUARD), "covers all three, incl. direct PostgREST writes");
  assert.ok(/raise exception 'project_closed'/.test(GUARD), "explicit, not silent");
  assert.ok(/using hint =/.test(GUARD), "tells the user the correct path (reopen)");
});
test("C2: it is a permissioned exception, not a hard block, and the exception is logged", () => {
  assert.ok(/can_manage_projects\(\)/.test(GUARD), "management may still correct");
  assert.ok(/'post_closure_write'/.test(GUARD), "every permitted post-closure write is logged");
  assert.ok(/exception when others then null;   -- التسجيل لا يُفشل التصحيح/.test(GUARD), "logging never breaks the write");
});
test("C3: the guard covers the tables behind the signed closure report", () => {
  for (const tbl of ["deliverables", "project_tasks", "project_costs", "deliverable_versions", "project_time_logs"]) {
    assert.ok(GUARD.includes(`'${tbl}'`), `${tbl} guarded`);
  }
  assert.ok(/deliverables is not guarded/.test(GUARD) && /project_tasks is not guarded/.test(GUARD),
    "the self-test asserts the critical ones really got a trigger");
});
test("C4: tables without project_id are skipped safely rather than erroring", () => {
  assert.ok(/no project_id column/.test(GUARD));
  assert.ok(/to_regclass\('public\.' \|\| t\) is null then continue/.test(GUARD), "absent tables skipped");
});
test("C5: additive, idempotent, self-tested, with verification and rollback", () => {
  const code = GUARD.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\bdrop\s+table\b/i.test(code) && !/\bdelete\s+from\b/i.test(code), "no destruction");
  assert.ok(/drop trigger if exists/.test(code) && /create or replace function/.test(code), "re-runnable");
  assert.ok(/POST-CLOSURE FAIL/.test(GUARD) && /POST-CLOSURE SELF-TEST PASSED/.test(GUARD));
  assert.ok(/VERIFICATION/.test(GUARD) && /ROLLBACK/.test(GUARD));
  assert.ok(/run project_platform_authz_hardening_RUNME\.sql first/.test(GUARD), "ordering enforced");
});

test("SAFE: static only (no DB/network)", () => {
  const self = R("tests/v1_operational_gaps.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
