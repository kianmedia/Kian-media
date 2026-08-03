// ════════════════════════════════════════════════════════════════════════════
// tests/case_study_workflow.test.js — CASE STUDIES · EDITORIAL STATE MACHINE
//
// Ten states, an immutable version history, no silent edit after publication,
// and a rollback that adds instead of deleting. Asserted from the migration and
// from the builder UI that drives it.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/case_studies_platform_RUNME.sql");
const POST = R("docs/case_studies_platform_POSTCHECK.sql");
const LIB = R("lib/portal/caseStudies.ts");
const BUILDER = R("components/portal/CaseStudyBuilder.tsx");
const BENCH = R("components/portal/CaseStudiesWorkbench.tsx");
const PAGE = R("app/(portal)/client-portal/case-studies/page.tsx");
const WORKFLOW_DOC = R("docs/CASE_STUDIES_EDITORIAL_WORKFLOW.md");

function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start > -1, `${name} is defined`);
  const end = sql.indexOf("end $$;", start);
  return sql.slice(start, end > -1 ? end + 7 : sql.length);
}

const STATES = ["draft", "internal_review", "legal_review", "client_permission_required",
  "client_permission_received", "approved", "scheduled", "published", "unpublished", "archived"];

test("all ten states exist in the column CHECK, in the client vocabulary, and nowhere else", () => {
  const check = RUNME.slice(RUNME.indexOf("status                    text not null default 'draft'"),
                            RUNME.indexOf("featured                  boolean"));
  for (const s of STATES) assert.ok(check.includes(`'${s}'`), `${s} is an allowed status`);
  for (const s of STATES) assert.ok(new RegExp(`\\b${s}\\b`).test(LIB), `${s} is in the TS union`);
  // No invented vocabulary in the UI: every status label maps to a real state.
  const statusAr = LIB.slice(LIB.indexOf("export const STATUS_AR"), LIB.indexOf("export const STATUS_ORDER"));
  const keys = (statusAr.match(/^\s{2}([a-z_]+):/gm) ?? []).map((k) => k.trim().replace(":", ""));
  assert.deepEqual(keys.sort(), [...STATES].sort(), "the label map covers exactly the ten states");
});

test("each transition is its own function with its own legal source states", () => {
  const expected = {
    cs_submit: ["draft", "unpublished"],
    cs_review_decide: ["internal_review"],
    cs_legal_decide: ["legal_review"],
    cs_permission_confirm: ["client_permission_required"],
    cs_approve: ["client_permission_received", "unpublished"],
    cs_publish: ["approved", "scheduled", "unpublished"],
    cs_schedule: ["approved", "scheduled", "published"],
  };
  for (const [fn, sources] of Object.entries(expected)) {
    const body = fnBody(RUNME, fn);
    assert.ok(/status not in \(|status <> |c\.status/.test(body), `${fn} checks the current status`);
    for (const s of sources) assert.ok(body.includes(`'${s}'`), `${fn} accepts ${s}`);
  }
  // Publishing may never start from a draft.
  const pub = fnBody(RUNME, "cs_publish");
  assert.ok(!/'draft'/.test(pub), "cs_publish cannot run on a draft");
  assert.ok(/approved_version_id is null then[\s\S]{0,160}raise exception/.test(pub),
    "publishing requires an approved version");
});

test("legal approval cannot skip the permission gate", () => {
  const legal = fnBody(RUNME, "cs_legal_decide");
  // 'approve' goes straight to approved ONLY when no permission-shaped blocker is left.
  assert.ok(/cs_publish_blockers\(p_id\)/.test(legal), "the blocker engine is consulted");
  assert.ok(/\(e ->> 'code'\) like '%permission%'/.test(legal), "permission blockers are singled out");
  assert.ok(/raise exception 'validation: لا يمكن الاعتماد القانونيّ قبل تسوية الإذن/.test(legal),
    "an unresolved permission stops the legal approval outright");
  assert.ok(/'need_permission' then 'client_permission_required'/.test(legal),
    "the explicit route to the permission wait state exists");
  // and the only door out of that wait state checks a GRANTED permission
  const confirm = fnBody(RUNME, "cs_permission_confirm");
  assert.ok(/permission_status, 'not_requested'\) <> 'granted'/.test(confirm),
    "confirming receipt requires a recorded granted permission");
});

test("version history is append-only and cannot be rewritten", () => {
  const imm = fnBody(RUNME, "cs_versions_immutable");
  assert.ok(/raise exception/.test(imm));
  assert.ok(/TG_OP = 'DELETE'|delete/i.test(imm), "deletes are refused");
  assert.ok(/r_versions_immutable/.test(POST));
  const vnew = fnBody(RUNME, "cs_version_new");
  assert.ok(/length\(btrim\(p_summary\)\) < 8/.test(vnew), "a version needs a real change summary");
});

test("rollback creates a NEW version and never deletes history", () => {
  const rb = fnBody(RUNME, "cs_rollback");
  assert.ok(/cs_version_new\(/.test(rb), "rollback adds a version");
  assert.ok(!/delete from public\.cs_versions/.test(rb), "rollback deletes nothing");
  assert.ok(/cs_version_new\(p_id, p_summary, p_version\)/.test(rb),
    "the source version is carried into the new version row");
  assert.ok(/'from_version', p_version/.test(rb), "the provenance of the rollback is audited");
  assert.ok(/rolled_back_from/.test(RUNME), "the versions table records where a rollback came from");
  assert.ok(!/status\s*=\s*'published'/.test(rb), "rollback does not republish by itself");
  assert.ok(/r_rollback_adds/.test(POST));
  assert.ok(/الرجوع إلى نسخة <b>يُنشئ نسخة جديدة<\/b>|الرجوع إلى نسخة \*\*يُنشئ نسخة جديدة\*\*/.test(WORKFLOW_DOC)
    || /يُنشئ نسخة جديدة/.test(WORKFLOW_DOC), "the doc states it");
  assert.ok(/يُنشئ نسخة جديدة/.test(BUILDER), "and the UI says it before the user clicks");
});

test("no silent edit after publication", () => {
  const up = fnBody(RUNME, "cs_upsert");
  assert.ok(/published_version_id is not null then[\s\S]{0,320}length\(btrim\(summary\)\) < 8/.test(up),
    "a published study needs a change summary");
  assert.ok(/has_unapproved_changes\s+= case when published_version_id is not null then true/.test(up),
    "any edit after publication is flagged");
  assert.ok(/first_published_at is not null then[\s\S]{0,200}raise exception/.test(up),
    "the slug freezes after the first publication");
  // the UI asks for the summary instead of letting the server surprise the editor
  assert.ok(/ملخّص التغيير \(مطلوب — الدراسة منشورة\)/.test(BUILDER));
  assert.ok(/changeSummary\.trim\(\)\.length < 8/.test(BUILDER));
  assert.ok(/has_unapproved_changes/.test(BENCH), "the list marks unapproved changes");
});

test("scheduling tells the truth about how a scheduled study goes live", () => {
  const sched = fnBody(RUNME, "cs_schedule");
  assert.ok(/p_at <= now\(\)/.test(sched), "the date must be in the future");
  assert.ok(/cs_publish_blockers\(p_id\)/.test(sched), "blockers are re-checked at scheduling time");
  const isPub = fnBody(RUNME, "cs_is_public");
  assert.ok(/status not in \('published','scheduled'\)/.test(isPub),
    "a scheduled study becomes public by itself once the moment arrives");
  const due = fnBody(RUNME, "cs_publish_due");
  assert.ok(/normalised|failed/.test(due), "the sweep reports what it actually did");
  assert.ok(/تسوية دفترية/.test(BUILDER) || /تسوية دفترية/.test(BENCH),
    "the UI calls the sweep a reconciliation, not a switch");
  assert.ok(/لا تنتظر cron|لا تعتمد على cron/.test(WORKFLOW_DOC + BUILDER));
});

test("publish pulls a stale future date back so 'published' always means visible", () => {
  const pub = fnBody(RUNME, "cs_publish");
  assert.ok(/publish_at = case when publish_at is null or publish_at > now\(\) then now\(\)/.test(pub));
  // and the list column never confuses status with visibility
  assert.ok(/is_public_now/.test(LIB) && /export function visibilityAr/.test(LIB));
  assert.ok(/منشورة لكنّها غير ظاهرة/.test(LIB), "the honest in-between state has its own words");
});

test("the UI never computes a publish blocker itself", () => {
  assert.ok(!/no_hero_media\s*=|function computeBlockers/.test(BUILDER), "no local blocker engine");
  assert.ok(/cs_publish_blockers/.test(RUNME));
  assert.ok(/blockerAr\(/.test(BUILDER), "server codes are translated, not re-derived");
  assert.ok(/BLOCKER_AR\[code\] \?\? `مانع غير معروف: \$\{code\}`/.test(LIB),
    "an unknown blocker is shown by its code instead of being hidden");
});

test("the internal page is feature-detected: it renders, then the component reports state", () => {
  assert.ok(/"use client"/.test(PAGE));
  assert.ok(/CaseStudiesWorkbench/.test(PAGE));
  assert.ok(!/if \(!installed\) return null/.test(PAGE), "the page itself does not gate");
  assert.ok(/pending_migration/.test(BENCH) || /kind === "pending"/.test(BENCH));
  assert.ok(/csAccess/.test(BENCH), "capabilities come from the server");
});

test("destructive actions demand a written reason and are audited", () => {
  for (const fn of ["cs_media_delete", "cs_metric_delete", "cs_credit_delete"]) {
    const body = fnBody(RUNME, fn);
    assert.ok(/coalesce\(btrim\(p_reason\), ''\) = '' then raise exception/.test(body), `${fn} requires a reason`);
    assert.ok(/cs_log\(/.test(body), `${fn} is audited`);
  }
  assert.ok(/سبب الحذف/.test(BUILDER), "the UI asks for the reason");
  const arch = fnBody(RUNME, "cs_archive");
  assert.ok(/cs_log\('archive'/.test(arch));
  assert.ok(!/delete from public\.cs_case_studies/.test(RUNME), "archiving never deletes the study");
});

test("every sensitive write lands in the audit table", () => {
  for (const action of ["submit", "media_upsert", "media_delete", "metric_upsert", "credit_upsert",
                        "permission_set", "permission_confirm", "approve", "publish", "schedule",
                        "unpublish", "archive", "restore", "rollback", "settings_set"]) {
    assert.ok(new RegExp(`cs_log\\('${action}'`).test(RUNME), `${action} is logged`);
  }
  // create/edit share one call whose action is chosen at runtime.
  assert.ok(/cs_log\(case when is_new then 'create' else 'edit' end/.test(RUNME),
    "creation and edit are both audited");
  // review and legal decisions are logged with the decision inside the action name.
  assert.ok(/cs_log\('review_' \|\| p_decision/.test(RUNME));
  assert.ok(/cs_log\('legal_' \|\| p_decision/.test(RUNME));
  const pub = fnBody(RUNME, "cs_publish");
  assert.ok(/cs_log\('publish', p_id, false/.test(pub), "a REFUSED publish is logged too");
});
