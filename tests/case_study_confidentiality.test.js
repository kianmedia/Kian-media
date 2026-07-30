// ════════════════════════════════════════════════════════════════════════════
// tests/case_study_confidentiality.test.js — CASE STUDIES · WHAT CANNOT BE PUBLISHED
//
// The brief lists eight things that must be impossible server-side. Each one is
// asserted twice where the design has two layers: a blocker that refuses the act
// and a mask that removes the field from the output. Static reads only.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/case_studies_platform_RUNME.sql");
const POST = R("docs/case_studies_platform_POSTCHECK.sql");

function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  assert.ok(start > -1, `${name} is defined`);
  const end = sql.indexOf("end $$;", start);
  return sql.slice(start, end > -1 ? end + 7 : sql.length);
}

const BLOCKERS = fnBody(RUNME, "cs_publish_blockers");
const MASK = fnBody(RUNME, "cs_mask");
const ISPUB = fnBody(RUNME, "cs_is_public");

test("a client name cannot be published without an explicit name permission", () => {
  assert.ok(/'code','named_without_permission','severity','blocker'/.test(BLOCKERS));
  assert.ok(/'code','named_without_name','severity','blocker'/.test(BLOCKERS));
  // and the mask independently refuses to emit the name
  assert.ok(/name_ok := perm_ok and coalesce\(p\.permitted_project_name, false\)/.test(MASK));
  assert.ok(/not coalesce\(p\.anonymization_required, false\)/.test(MASK),
    "an anonymization requirement overrides a name permission");
});

test("a logo, approved metrics and a testimonial each need their OWN permission", () => {
  for (const code of ["logo_without_permission", "metrics_without_permission", "testimonial_without_permission"]) {
    assert.ok(new RegExp(`'code','${code}','severity','blocker'`).test(BLOCKERS), `${code} is a hard blocker`);
  }
  assert.ok(/logo_ok\s*:= name_ok and coalesce\(p\.permitted_logo, false\)/.test(MASK));
  assert.ok(/metrics_ok\s*:= perm_ok and coalesce\(p\.permitted_metrics, false\)/.test(MASK));
  assert.ok(/testi_ok\s*:= perm_ok and coalesce\(p\.permitted_testimonial, false\)/.test(MASK));
});

test("an expired permission is not a permission", () => {
  assert.ok(/permission_expires_at, now\(\) \+ interval '100 years'\) >= now\(\)/.test(BLOCKERS));
  assert.ok(/permission_expires_at, now\(\) \+ interval '100 years'\) >= now\(\)/.test(MASK));
});

test("a revoked or refused permission removes the study from the public surface immediately", () => {
  assert.ok(/in \('revoked','refused'\) then return false/.test(ISPUB),
    "cs_is_public reads the LIVE permission row, so a withdrawal takes effect at once");
  assert.ok(/'code','permission_refused_or_revoked','severity','blocker'/.test(BLOCKERS));
});

// ⚠️ كلّ شرط هنا كان قابلًا للحذف دون أن يسقط اختبار واحد: الأرشفة والموعد
//    والنسخة المنشورة والحظر لم يكن لأيٍّ منها تأكيد صريح في أيّ ملفّ.
//    السطر الواحد الحارس للأربعة هو ما يمنع ظهور دراسة لا يجوز ظهورها.
test("the public gate excludes archived, undue, version-less and embargoed studies", () => {
  assert.ok(/if\s+coalesce\(c\.archived,\s*true\)\s+then\s+return false; end if;/.test(ISPUB),
    "an archived study must leave the public surface — and a NULL archived flag fails closed");
  assert.ok(/if\s+c\.publish_at\s+is\s+null\s+or\s+c\.publish_at\s*>\s*now\(\)\s+then\s+return false; end if;/.test(ISPUB),
    "a scheduled study must stay private until its moment actually arrives");
  assert.ok(/if\s+c\.published_version_id\s+is\s+null\s+then\s+return false; end if;/.test(ISPUB),
    "the public surface reads a frozen version, never the live editing row");
  assert.ok(/embargo_until\s+is\s+not\s+null\s+and\s+p\.embargo_until\s*>\s*now\(\)\s+then\s+return false/.test(ISPUB),
    "an embargo holds the study back even after approval");
  assert.ok(/if\s+not\s+coalesce\(en,\s*false\)\s+then\s+return false; end if;/.test(ISPUB),
    "the whole public surface is off unless explicitly enabled");
  // وكلّ مخرج فشل هنا false صريحة — لا NULL يُقرأ لاحقًا قبولًا.
  assert.ok(/exception when others then return false;/.test(ISPUB),
    "the predicate fails closed, never NULL");
});

test("employee names are dropped from the public projection without documented consent", () => {
  assert.ok(/is_employee\s*(=\s*false|is false)|not k\.is_employee|k\.consent_public/.test(MASK),
    "the mask filters credits on consent");
  assert.ok(/consent_public/.test(MASK), "consent is what decides");
  // and the checklist tells the editor how many names will disappear
  const checklist = fnBody(RUNME, "cs_checklist");
  assert.ok(/'employee_consent'/.test(checklist));
  assert.ok(/'suppressed'/.test(checklist), "the count of suppressed names is surfaced, not hidden");
  assert.ok(/'code','credits_suppressed','severity','warning'/.test(BLOCKERS),
    "suppression is announced as intended behaviour, not silence");
});

test("there is no cost or margin column anywhere in the module", () => {
  // The whole package: no financial column may exist to leak in the first place.
  const cols = RUNME.match(/^\s+(cost|margin|profit|budget|price|amount|total_cost)[a-z_]*\s+(numeric|int|money)/gim) ?? [];
  assert.deepEqual(cols, [], `no financial column may be defined, found: ${cols.join(", ")}`);
  assert.ok(/r_no_money_column/.test(POST), "POSTCHECK asserts the absence structurally");
  // Free text is a human judgement, and the code says so with a WARNING not a claim.
  assert.ok(/'code','possible_financial_figure','severity','warning'/.test(BLOCKERS));
});

test("nothing is ever copied from the frozen project platform", () => {
  assert.ok(!/from public\.projects\b/.test(RUNME), "no read of public.projects");
  assert.ok(!/from public\.project_core\b/.test(RUNME), "no read of project_core");
  assert.ok(!/from public\.deliverables\b/.test(RUNME), "no read of deliverables");
  assert.ok(!/references public\.projects/.test(RUNME), "no FK into the frozen platform");
  assert.ok(/project_id\s+uuid,/.test(RUNME), "project_id exists as a plain optional reference");
  assert.ok(/r_no_project_read/.test(POST) && /r_no_frozen_fk/.test(POST),
    "POSTCHECK proves both the absence of reads and the absence of a foreign key");
});

test("project_id and internal notes never reach the public projection", () => {
  assert.ok(!/'project_id'/.test(MASK), "the mask never emits project_id");
  assert.ok(!/'internal_notes'/.test(MASK), "the mask never emits internal notes");
  assert.ok(!/'source_note'/.test(MASK), "a metric's internal provenance stays internal");
  assert.ok(/r_no_internal_leak/.test(POST), "POSTCHECK asserts it too");
});

test("the anonymised form is a recorded label, never an empty guess", () => {
  assert.ok(/constraint cs_anon_label_present check/.test(RUNME));
  assert.ok(/client_identity_visibility <> 'anonymized'/.test(RUNME));
  assert.ok(/default_anonymized_label_ar\s+text not null default 'جهة كبرى في المملكة'/.test(RUNME),
    "there is an approved default label");
  assert.ok(/'code','anonymization_required','severity','blocker'/.test(BLOCKERS));
});

test("an embargo blocks publication and hides an already-public study", () => {
  assert.ok(/'code','embargo_active','severity','blocker'/.test(BLOCKERS));
  assert.ok(/embargo_until is not null and p\.embargo_until > now\(\) then return false/.test(ISPUB));
});

test("the blocker engine fails CLOSED", () => {
  assert.ok(/exception when others then[\s\S]{0,400}'code','blocker_engine_error','severity','blocker'/.test(BLOCKERS),
    "an engine error is a blocker, never a pass");
  assert.ok(/r_blocker_failclosed/.test(POST));
});

test("publication cannot be forged by writing the status column directly", () => {
  assert.ok(/create trigger trg_cs_guard_publish/.test(RUNME));
  assert.ok(/when \(new\.status in \('published','scheduled'\)\)/.test(RUNME));
  const guard = fnBody(RUNME, "cs_guard_publish");
  assert.ok(/cs_publish_blockers\(new\.id\)/.test(guard), "the trigger re-runs the same engine");
  assert.ok(/published_version_id is null then[\s\S]{0,200}raise exception/.test(guard),
    "the public surface must be backed by a published version snapshot");
  // and cs_upsert must not be a back door into status
  const upsert = fnBody(RUNME, "cs_upsert");
  assert.ok(!/status\s*=\s*coalesce\(public\.cs_txt\(p_input, 'status'\)/.test(upsert));
  assert.ok(/r_upsert_no_status/.test(POST));
});

test("the mask takes content from the snapshot but permission state from the LIVE row", () => {
  assert.ok(/snap ->>/.test(MASK), "content is read from the published snapshot");
  assert.ok(/select \* into p from public\.cs_permissions where case_study_id = p_id/.test(MASK),
    "permissions are read live so a withdrawal applies without a republish");
  assert.ok(/r_mask_live/.test(POST));
});

test("public text is sanitised on write AND on output", () => {
  assert.ok(/create or replace function public\.cs_sanitize\(/.test(RUNME));
  assert.ok(/create or replace function public\.cs_sanitize_block\(/.test(RUNME));
  const upsert = fnBody(RUNME, "cs_upsert");
  assert.ok(/cs_sanitize_block\(public\.cs_txt\(p_input, 'summary_ar'\)\)/.test(upsert), "written text is sanitised");
  assert.ok(/cs_sanitize/.test(MASK) || /cs_sanitize/.test(fnBody(RUNME, "cs_snapshot_build")),
    "output passes the sanitiser a second time");
  // CSV export must defuse formula injection
  const csv = fnBody(RUNME, "cs_csv_cell");
  assert.ok(/=|\+|-|@/.test(csv), "the CSV cell guard exists");
  assert.ok(/r_csv/.test(POST));
});

test("clearing a field is explicit, whitelisted and static — no runtime column names", () => {
  const upsert = fnBody(RUNME, "cs_upsert");
  assert.ok(/if p_input \? 'clear' then/.test(upsert), "an explicit clear list is supported");
  assert.ok(!/execute format\(/.test(upsert), "no dynamic SQL builds a column name");
  for (const col of ["testimonial_ar", "client_display_name", "results_en"]) {
    assert.ok(new RegExp(`'${col}'\\s+= any\\(v_clear\\)`).test(upsert), `${col} is clearable`);
  }
  for (const col of ["internal_title", "slug", "client_identity_visibility", "status"]) {
    assert.ok(!new RegExp(`'${col}'\\s+= any\\(v_clear\\)`).test(upsert), `${col} must NOT be clearable`);
  }
  assert.ok(/'cleared', to_jsonb/.test(upsert), "the clear is audited");
});
