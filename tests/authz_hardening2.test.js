// ════════════════════════════════════════════════════════════════════════════
// tests/authz_hardening2.test.js — the three holes that survived hardening #1
//
// Hardening #1 (applied + verified live: gates now return false, company reports 42501)
// fixed the NULL-collapse. These three are INDEPENDENT of the gates, so they survived:
//
//  §A DATA CORRUPTION — the "reviews insert" RLS policy let a client INSERT straight into
//     deliverable_reviews. trg_review_created then does
//        update deliverables set status = new.decision
//     but does NOT set deliverable_versions.decision. admin_set_final_version requires
//     v.decision='approved', so the deliverable becomes PERMANENTLY undeliverable — and
//     it is no longer in 'client_review', so the UI offers no way back.
//     client_review_version (SECURITY DEFINER) sets BOTH and is the only correct path.
//  §B DIRECT WRITES — project_core_FINAL_RUNME.sql:462 grants insert/update/delete on
//     secondary tables to authenticated, bypassing every RPC guard, soft delete, audit log
//     and notification. Revocation is matched to REAL UI usage so nothing regresses.
//  §C NULL FAIL-OPEN — `client_id is distinct from my_client_id()` is FALSE when both are
//     NULL, so the ownership guard is skipped and default client caps are granted.
//  §D SELF-PROMOTION — pc_member_add accepts can_edit_project, so an editor could call
//     pc_member_add(project, self, 'kian_manager') and widen their own read access.
//
// Static only — no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const FIX = R("docs/project_platform_authz_hardening2_RUNME.sql");
const DELIVERABLES = R("lib/portal/deliverables.ts");

// ─── §A the corruption path is closed, the correct path is preserved ───
test("A1: the direct review-insert policy is dropped", () => {
  assert.ok(/drop policy if exists "reviews insert" on public\.deliverable_reviews/.test(FIX));
  assert.ok(/revoke insert on public\.deliverable_reviews from authenticated/.test(FIX), "grant revoked too");
});
test("A2: the READ policy and the correct RPC path are explicitly preserved", () => {
  assert.ok(!/drop policy if exists "reviews read"/.test(FIX), "read access must survive");
  assert.ok(/reviews read policy was lost/.test(FIX), "self-test guards against losing it");
  assert.ok(/the only correct review path is missing/.test(FIX), "preflight refuses to run without client_review_version");
});
test("A3: preflight refuses to remove the last review path", () => {
  const pre = FIX.slice(0, FIX.indexOf("begin;"));
  assert.ok(/client_review_version\(uuid,text,text\)/.test(pre), "checks the RPC exists BEFORE dropping the policy");
});
test("A4: the dead direct-insert wrapper is removed from the client library", () => {
  assert.ok(!/export async function submitReview/.test(DELIVERABLES), "submitReview is gone");
  assert.ok(/REMOVED — submitReview/.test(DELIVERABLES), "and why is documented");
  assert.ok(!/ppost<DeliverableReview\[\]>\(`deliverable_reviews`/.test(DELIVERABLES), "no direct insert remains");
});
test("A5: a verification query surfaces existing victims without deleting data", () => {
  assert.ok(/status='approved'[\s\S]{0,200}not exists/.test(FIX), "finds deliverables approved with no approved version");
  assert.ok(/لا بحذف بيانات|not by deleting/.test(FIX), "remediation is repair, never deletion");
});

// ─── §B revocation matches real UI usage (no regression) ───
test("B1: read-only tables lose all direct write access", () => {
  for (const t of ["project_shoot_sessions", "project_deliverable_versions"]) {
    assert.ok(new RegExp(`revoke insert, update, delete on public\\.${t} from authenticated`).test(FIX), `${t} fully revoked`);
  }
});
test("B2: tables the UI writes keep INSERT/UPDATE and lose only DELETE", () => {
  for (const t of ["project_locations", "project_templates"]) {
    assert.ok(new RegExp(`revoke delete on public\\.${t} from authenticated`).test(FIX), `${t} DELETE revoked`);
    assert.ok(!new RegExp(`revoke insert[^\\n]*public\\.${t}`).test(FIX), `${t} INSERT preserved (the UI POSTs it)`);
  }
});
test("B3: the self-test asserts NO regression for what the UI actually needs", () => {
  assert.ok(/regression — locations INSERT was revoked/.test(FIX));
  assert.ok(/regression — templates UPDATE was revoked/.test(FIX));
  assert.ok(/regression — shoot sessions SELECT was revoked/.test(FIX));
});
test("B4: only the four verified tables are touched — no blanket revoke", () => {
  const b = FIX.slice(FIX.indexOf("§B"), FIX.indexOf("§C"));
  for (const keep of ["project_costs", "project_risks", "project_meetings", "project_tags", "task_files"]) {
    assert.ok(!b.includes(keep), `${keep} is written by the UI and must NOT be revoked`);
  }
});

// ─── §C NULL fail-open, modelled in SQL three-valued logic ───
const distinct = (a, b) => (a === null && b === null ? false : a === null || b === null ? true : a !== b);
test("C1: the old guard silently fails open when both ids are NULL", () => {
  assert.equal(distinct(null, null), false, "`NULL is distinct from NULL` is FALSE ⇒ guard skipped ⇒ default caps granted");
});
test("C2: the new guard treats NULL on either side as 'not a match'", () => {
  const guard = (projectClient, myClient) => projectClient === null || myClient === null || distinct(projectClient, myClient);
  assert.equal(guard(null, null), true, "denied");
  assert.equal(guard("c1", null), true, "denied");
  assert.equal(guard(null, "c1"), true, "denied");
  assert.equal(guard("c1", "c2"), true, "denied");
  assert.equal(guard("c1", "c1"), false, "the legitimate owner is still allowed through");
});
test("C3: the fix is in the file and keeps the rest of the logic byte-identical", () => {
  assert.ok(/\(select client_id from p\) is null[\s\S]{0,80}my_client_id\(\) is null/.test(FIX), "NULL branches added");
  for (const branch of ["'view'", "'comment'", "'approve'", "'download'", "'view_financials'", "'subproject'", "'standalone','master'"]) {
    assert.ok(FIX.includes(branch), `existing branch ${branch} preserved`);
  }
});

// ─── §D self-promotion ───
test("D1: an editor can no longer promote themselves to project manager", () => {
  assert.ok(/p_user = auth\.uid\(\) and p_role = 'kian_manager' and not public\.can_manage_projects\(\)/.test(FIX));
  assert.ok(/no_self_promotion/.test(FIX));
});
test("D2: legitimate member management is untouched", () => {
  assert.ok(/p_role not in \('kian_manager','kian_editor','kian_photographer','kian_viewer'\)/.test(FIX), "role whitelist kept");
  assert.ok(/on conflict \(project_id, user_id\) do update/.test(FIX), "upsert behaviour kept");
  assert.ok(/pc_log\(p_project, 'member_added'/.test(FIX), "audit logging kept");
});
test("D3: the member notification cannot fail the membership write", () => {
  // the notify call must sit inside its own begin/exception block
  const i = FIX.indexOf("pc_notify_user");
  assert.ok(i > -1, "the member notification exists");
  const around = FIX.slice(Math.max(0, i - 200), i + 400);
  assert.ok(/\bbegin\b/.test(around) && /exception when others then null/.test(around),
    "notification is exception-isolated — the business action is never rolled back by it");
});

// ─── file-level safety ───
test("SAFE: additive, idempotent, self-tested, with verification and rollback", () => {
  const code = FIX.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\bdrop\s+table\b/i.test(code), "no DROP TABLE");
  assert.ok(!/\bdelete\s+from\b/i.test(code) && !/\btruncate\b/i.test(code), "no data deletion");
  assert.ok(/create or replace function/.test(code), "re-runnable definitions");
  assert.ok(/AUTHZ2 FAIL/.test(FIX) && /AUTHZ2 SELF-TEST PASSED/.test(FIX), "self-test present");
  assert.ok(/VERIFICATION/.test(FIX) && /ROLLBACK/.test(FIX), "verification + rollback documented");
  assert.ok(/PREFLIGHT: run project_platform_authz_hardening_RUNME\.sql first/.test(FIX), "ordering enforced");
});
test("SAFE: static only (no DB/network)", () => {
  const self = R("tests/authz_hardening2.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
