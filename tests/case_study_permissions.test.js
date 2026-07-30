// ════════════════════════════════════════════════════════════════════════════
// tests/case_study_permissions.test.js — CASE STUDIES · ROLE MATRIX
//
// Proves from the migration text and the UI source that the four tiers are real
// and separate: marketing cannot review, review cannot publish, and the publish
// key does not exist at all. No DB, no network.
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

/** Body of a create-or-replace function, up to the closing $$. */
function fnBody(sql, name) {
  // The "(" matters: cs_publish must not match cs_publish_blockers.
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start > -1, `${name} is defined`);
  const end = sql.indexOf("end $$;", start);
  const alt = sql.indexOf("$$;", start);
  return sql.slice(start, end > -1 ? end + 7 : alt + 3);
}

test("the four predicates exist and are SECURITY DEFINER with a pinned search_path", () => {
  for (const fn of [
    "can_view_case_studies_internal", "can_edit_case_studies",
    "can_review_case_studies", "can_publish_case_studies",
  ]) {
    const body = fnBody(RUNME, fn);
    assert.ok(/security definer/.test(body), `${fn} is SECURITY DEFINER`);
    assert.ok(/set search_path = public/.test(body), `${fn} pins search_path`);
    // Every predicate must return an explicit boolean, never NULL.
    assert.ok(/exception when others then return false/.test(body), `${fn} fails closed`);
    assert.ok(/if auth\.uid\(\) is null then return false/.test(body), `${fn} rejects the anonymous caller`);
  }
});

test("publishing is owner-only: no permission key, no is_admin, no is_staff", () => {
  const pub = fnBody(RUNME, "can_publish_case_studies");
  assert.ok(/cs_is_owner\(\)/.test(pub), "publish delegates to ownership");
  assert.ok(!/cs_perm\(/.test(pub), "publish must NOT consult any permission key");
  assert.ok(!/cs_is_admin\(/.test(pub), "publish must NOT accept is_admin");
  assert.ok(!/cs_is_staff\(/.test(pub), "publish must NOT accept is_staff");
  // The key must not exist in the catalogue — and the migration self-tests that.
  assert.ok(/SELF-TEST: وُجد مفتاح case_study\.publish/.test(RUNME),
    "the migration fails loudly if a case_study.publish key ever appears");
  const keyUses = (RUNME.match(/cs_perm\('case_study\.publish'\)/g) ?? []).length;
  assert.equal(keyUses, 0, "nothing resolves a case_study.publish key");
});

test("edit does not imply review, and review does not imply publish", () => {
  const edit = fnBody(RUNME, "can_edit_case_studies");
  const review = fnBody(RUNME, "can_review_case_studies");
  assert.ok(/cs_perm\('case_study\.edit'\)/.test(edit));
  assert.ok(!/case_study\.review/.test(edit), "the edit tier must not resolve the review key");
  assert.ok(/cs_perm\('case_study\.review'\)/.test(review));
  assert.ok(!/case_study\.edit/.test(review), "the review tier must not be satisfied by the edit key");
});

test("no gate is built on the forbidden platform predicates", () => {
  for (const fn of [
    "can_view_case_studies_internal", "can_edit_case_studies",
    "can_review_case_studies", "can_publish_case_studies",
  ]) {
    const body = fnBody(RUNME, fn);
    assert.ok(!/can_manage_projects/.test(body), `${fn} must not gate on can_manage_projects`);
    assert.ok(!/is_kian_member/.test(body), `${fn} must not gate on is_kian_member`);
  }
});

test("every state-machine RPC re-checks authorization inside the database", () => {
  const owner = ["cs_publish", "cs_schedule", "cs_unpublish", "cs_archive", "cs_restore", "cs_settings_set"];
  for (const fn of owner) {
    const body = fnBody(RUNME, fn);
    assert.ok(/can_publish_case_studies\(\)/.test(body), `${fn} is owner-gated`);
    assert.ok(/not_authorized/.test(body), `${fn} raises not_authorized`);
  }
  for (const fn of ["cs_review_decide", "cs_legal_decide", "cs_permission_confirm", "cs_approve",
                    "cs_permission_set", "cs_audit_list", "cs_taxonomy_upsert"]) {
    const body = fnBody(RUNME, fn);
    assert.ok(/can_review_case_studies\(\)/.test(body), `${fn} is review-gated`);
  }
  for (const fn of ["cs_upsert", "cs_set_taxonomy", "cs_media_upsert", "cs_media_delete",
                    "cs_metric_upsert", "cs_credit_upsert", "cs_submit"]) {
    const body = fnBody(RUNME, fn);
    assert.ok(/can_edit_case_studies\(\)|can_review_case_studies\(\)/.test(body), `${fn} is gated`);
  }
});

test("approving a metric or a person's name is a REVIEW act, not an edit act", () => {
  const metric = fnBody(RUNME, "cs_metric_upsert");
  assert.ok(/want_approved and not coalesce\(public\.can_review_case_studies\(\)/.test(metric),
    "approving a metric requires the review tier");
  const credit = fnBody(RUNME, "cs_credit_upsert");
  assert.ok(/can_review_case_studies\(\)/.test(credit), "recording consent requires the review tier");
  assert.ok(/validation:.*مرجع/.test(credit), "consent without a documented reference is rejected");
});

test("legal/permission detail is narrower than module visibility", () => {
  const get = fnBody(RUNME, "cs_get");
  assert.ok(/can_perm := coalesce\(public\.can_review_case_studies\(\), false\)/.test(get));
  assert.ok(/'permission', case when not can_perm then null/.test(get),
    "the full permission row is withheld from the edit tier");
  assert.ok(/'permission_summary'/.test(get), "a decision-only summary is still returned");
});

test("anon holds no internal object: revokes and postcheck rows exist", () => {
  assert.ok(/revoke all on table public\.%I from anon/.test(RUNME), "table privileges are revoked from anon");
  assert.ok(/revoke all on table public\.%I from authenticated/.test(RUNME),
    "table privileges are revoked from authenticated too");
  assert.ok(/revoke all on function public\.%s from public/.test(RUNME),
    "function EXECUTE is revoked from PUBLIC before any grant");
  assert.ok(/r_no_anon_tables/.test(POST), "POSTCHECK proves anon has no table privilege");
  assert.ok(/r_no_authed_tables/.test(POST), "POSTCHECK proves authenticated has no table privilege");
  // Grants are issued from static arrays. Exactly ONE loop may grant to anon,
  // and the array it walks must hold only the three read-only public readers.
  const anonGrants = RUNME.match(/grant execute on function public\.%s to anon[^']*'/g) ?? [];
  assert.equal(anonGrants.length, 1, "there is exactly one place that grants EXECUTE to anon");
  const idx = RUNME.indexOf("grant execute on function public.%s to anon");
  const loopHead = RUNME.slice(RUNME.lastIndexOf("foreach f in array array[", idx), idx);
  assert.ok(/cs_public_index\(jsonb\)/.test(loopHead) && /cs_public_study\(text\)/.test(loopHead)
    && /cs_public_slugs\(\)/.test(loopHead), "the anon loop walks the three public readers");
  assert.ok(!/cs_upsert|cs_publish\(|cs_get|cs_list|cs_preview|cs_settings_set/.test(loopHead),
    "no editing or internal RPC is in the anon grant loop");

  // And the whole internal API array is explicitly revoked from anon.
  const apiIdx = RUNME.indexOf("revoke all on function public.%s from anon");
  assert.ok(apiIdx > -1, "internal API functions are revoked from anon");
});

test("the UI hides owner actions but never claims that hiding is the protection", () => {
  assert.ok(/access\.can_publish/.test(BUILDER), "publish controls are conditioned on the server capability");
  assert.ok(/قرارات ملكيّة/.test(BUILDER), "the non-owner is told publishing is an ownership decision");
  assert.ok(/CS_ACCESS_CLOSED/.test(LIB) && /can_publish: false/.test(LIB),
    "capabilities default to closed when the migration is missing");
  assert.ok(/can_publish/.test(BENCH), "the settings switch is owner-conditioned in the workbench too");
});

test("permission-denied is never reported as a missing migration", () => {
  assert.ok(/d\.kind === "permission_denied"/.test(LIB), "denial is classified distinctly");
  assert.ok(/state: "denied"/.test(LIB));
  assert.ok(/state: "pending_migration"/.test(LIB));
  // The two banners must carry different text.
  assert.ok(/بانتظار تفعيل قاعدة البيانات/.test(BENCH));
  assert.ok(/لا تملك صلاحية/.test(BENCH) || /لا تملك صلاحية/.test(LIB));
});
