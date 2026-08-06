// ════════════════════════════════════════════════════════════════════════════
// tests/wave4_dependency_contract.test.js
//
// يحرس عقد اعتمادات Wave 4 والعيب الجذريّ الذي كشفه:
//
//   `to_regproc` تأخذ **اسمًا مجرّدًا**، لا توقيعًا بأقواس. وتمريرُ توقيع
//   يجعلها تُعيد NULL **دائمًا** — فيُبلَّغ عن دالّة موجودة أنّها مفقودة،
//   أو يُتخطّى حارس صلاحية بصمت. الصحيح `to_regprocedure`.
//
// ⛔ لا قاعدة ولا شبكة: تحليل نصّيّ ساكن.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const REL = path.join(DOCS, "release");

/** يجرّد تعليقات `--` ويُبقي السلاسل. */
function code(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") q = false; out += c; i++; continue; }
    if (c === "'") { q = true; out += c; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
const R = (p) => fs.readFileSync(path.join(DOCS, p), "utf8");
const C = (p) => code(R(p));

const RUNME = "wave4_crm_business_RUNME.sql";
const PRE = "wave4_crm_business_PREFLIGHT.sql";
const POST = "wave4_crm_business_POSTCHECK.sql";

// ─── ١ · 🔴 العيب الجذريّ: لا توقيع يُمرَّر إلى to_regproc — في المستودع كلّه ─
test("🔴 لا ملفّ SQL يمرّر توقيعًا إلى to_regproc", () => {
  const bad = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    for (const m of C(f).match(/to_regproc\(\s*'[a-z0-9_.]+\([^']*\)'/gi) ?? []) {
      bad.push(`${f}: ${m}`);
    }
  }
  assert.deepEqual(bad, [],
    "to_regproc بتوقيع تُعيد NULL دائمًا ⇒ بلاغ كاذب أو حارس مُتخطّى:\n" + bad.join("\n"));
});

test("🔴 كل فحص توقيع يستعمل to_regprocedure", () => {
  for (const f of [PRE, POST]) {
    const t = C(f);
    if (!/\(\s*'[a-z0-9_.]+\(/.test(t)) continue;
    assert.match(t, /to_regprocedure\s*\(/,
      `${f}: يفحص تواقيع بلا to_regprocedure`);
  }
});

// ⚠️ الحارس الأهمّ: fail-open في البحث الشامل كان ناتجًا مباشرًا للعيب.
test("🔴 بوّابة can_access_project لا تُتخطّى في البحث الشامل", () => {
  const t = C("wave7_global_search_RUNME.sql");
  const guards = [...t.matchAll(/\(\s*to_regproc(edure)?\s*\(\s*'public\.can_access_project\(uuid\)'\s*\)\s*is null\s*or/gi)];
  assert.ok(guards.length > 0, "لم يُعثر على حارس الوصول — هل غُيّر شكله؟");
  for (const g of guards) {
    assert.equal(g[1], "edure",
      "🔴 `to_regproc(...) is null` صحيحة دائمًا ⇒ يُتخطّى can_access_project ⇒ " +
      "البحث يُعيد كل مشروع ومخرَج لأيّ مستدعٍ");
  }
});

test("🔴 بوّابة نافذة السداد تُنفَّذ فعلًا في رابط التسليم", () => {
  const t = C("wave5_delivery_rights_RUNME.sql");
  assert.match(t, /to_regprocedure\s*\(\s*'public\.pc_release_window_ok\(uuid\)'\s*\)\s*is not null/i,
    "🔴 الحارس بـto_regproc ⇒ لا يُنفَّذ أبدًا ⇒ الرابط يلتفّ على بوّابة السداد");
});

// ─── ٢ · PREFLIGHT: تصنيف صحيح + فشل حقيقيّ ────────────────────────────────
test("🔴 ما تُنشئه RUNME مصنَّف EXPECTED_ABSENT لا BLOCK", () => {
  const t = C(PRE);
  const created = C(RUNME).match(/create table if not exists public\.(crm_[a-z_]+)/gi)
    ?.map((m) => m.split(".").pop()) ?? [];
  assert.ok(created.length >= 2, "لم تُستخرج جداول RUNME");
  const expected = t.slice(t.indexOf("EXPECTED_ABSENT"));
  for (const c of created) {
    assert.ok(expected.includes(c), `${c} تُنشئه RUNME ولم يُصنَّف EXPECTED_ABSENT`);
  }
  // ⛔ ولا يُدرج ضمن الاعتمادات المطلوبة.
  const required = t.slice(t.indexOf("REQUIRED_DEPENDENCY"), t.indexOf("REQUIRED_GATE"));
  for (const c of created) {
    assert.ok(!required.includes(c), `🔴 ${c} مُدرج كاعتماد مطلوب وهو من إنتاج الحزمة`);
  }
});

test("🔴 PREFLIGHT يفشل فعليًّا لا طباعةً", () => {
  const t = C(PRE);
  assert.match(t, /raise exception/i, "لا استثناء — الفشل طباعة فقط وخروج 0");
  assert.match(t, /WAVE 4 PREFLIGHT FAILED/, "رسالة الفشل غير واضحة");
  // ⛔ ولا كتابة.
  for (const w of [/\binsert\s+into\b/i, /\bupdate\s+\w+\s+set\b/i, /\bdelete\s+from\b/i,
                   /\bcreate\s+(table|function)\b/i, /\balter\s+table\b/i, /\bgrant\b/i]) {
    assert.ok(!w.test(t), `PREFLIGHT يكتب: ${w}`);
  }
});

test("🔴 الاعتمادات الاختيارية لا تُحتسب في الحسم", () => {
  const t = C(PRE);
  const decide = t.slice(t.indexOf("do $$"));
  for (const opt of ["kian_testimonials", "can_see_financials"]) {
    assert.ok(!decide.includes(opt),
      `🔴 ${opt} اختياريّ ومُدرج في بلوك الحسم — سيحجب Wave 4 بلا سبب`);
  }
  // والمطلوبة محتسَبة.
  for (const req of ["crm_opportunities", "crm_can_manage()", "pgcrypto"]) {
    assert.ok(decide.includes(req), `${req} مطلوب وغير محتسَب في الحسم`);
  }
});

// ─── ٣ · الشهادات اختيارية ولا تحجب ────────────────────────────────────────
test("🔴 لا مفتاح أجنبيّ غير مشروط على kian_testimonials", () => {
  const t = C(RUNME);
  const ddl = t.slice(t.indexOf("create table if not exists public.crm_testimonial_invites"));
  const tableEnd = ddl.indexOf(");");
  const body = ddl.slice(0, tableEnd);
  assert.ok(!/references\s+public\.kian_testimonials/i.test(body),
    "🔴 مفتاح أجنبيّ داخل DDL ⇒ غياب جدول **اختياريّ** يُفشل إنشاء الجدول ويحجب الحزمة");
  assert.match(body, /testimonial_id\s+uuid\s*,/, "عمود الربط مفقود");
});

test("قيد الشهادات يُضاف شرطيًّا وidempotent", () => {
  const t = C(RUNME);
  assert.match(t, /to_regclass\('public\.kian_testimonials'\)\s+is null/i,
    "لا فحص وجود لجدول الشهادات");
  assert.match(t, /add constraint crm_ti_testimonial_fk[\s\S]{0,160}references public\.kian_testimonials/i,
    "القيد الشرطيّ غير مضاف");
  assert.match(t, /not exists\s*\([\s\S]{0,200}conname\s*=\s*'crm_ti_testimonial_fk'/i,
    "القيد ليس idempotent — إعادة التشغيل ستفشل");
  // ⛔ ولا تُنشئ Wave 4 جدول الشهادات (نظام موازٍ).
  assert.ok(!/create table[^;]*kian_testimonials/i.test(t),
    "🔴 Wave 4 تُنشئ جدول الشهادات — نظام موازٍ");
});

test("🔴 الشهادات مصنَّفة OPTIONAL في PREFLIGHT وفي المصفوفة", () => {
  assert.match(C(PRE), /OPTIONAL_DEPENDENCY[\s\S]{0,200}kian_testimonials/,
    "PREFLIGHT لا يصنّفها اختيارية");
  const matrix = fs.readFileSync(path.join(REL, "SQL_RELEASE_SELECTION_MATRIX.md"), "utf8");
  const row = matrix.split("\n").find((l) => l.includes("kian_testimonials_v1_RUNME.sql") && l.startsWith("|"));
  assert.ok(row, "المصفوفة لا تذكر ملفّ الشهادات في جدولها");
  assert.match(row, /RUNME OPTIONAL/i, "المصفوفة لا تصنّفها RUNME OPTIONAL");
});

// ─── ٤ · بوّابات CRM: prerequisite رسميّ، ولا نسخ ──────────────────────────
test("🔴 بوّابات CRM مطلوبة ومصدرها مذكور", () => {
  const t = C(PRE);
  for (const sig of ["public.crm_can_manage()",
                     "public.crm_can_read_opportunity(uuid)",
                     "public.crm_can_edit_opportunity(uuid)"]) {
    assert.ok(t.includes(sig), `البوّابة ${sig} ليست ضمن الاعتمادات المطلوبة`);
  }
  assert.match(R(PRE), /crm_sales_FOUNDATION_RUNME\.sql/,
    "مصدر البوّابات غير مذكور في PREFLIGHT");
});

test("⛔ Wave 4 لا تُنشئ بوّابات CRM — لا نظام صلاحيات موازٍ", () => {
  const t = C(RUNME);
  for (const g of ["crm_can_manage", "crm_can_read_opportunity", "crm_can_edit_opportunity"]) {
    assert.ok(!new RegExp(`create\\s+(or replace\\s+)?function\\s+public\\.${g}\\b`, "i").test(t),
      `🔴 Wave 4 تُعرّف ${g} — تعريفان متنافسان لنفس البوّابة`);
  }
});

test("ترتيب الإصدار يضع FOUNDATION قبل Wave 4", () => {
  const map = fs.readFileSync(path.join(REL, "WAVE_4_DEPENDENCY_MAP.md"), "utf8");
  const f = map.indexOf("crm_sales_FOUNDATION_RUNME.sql");
  const w = map.indexOf("wave4_crm_business_RUNME.sql", f);
  assert.ok(f > -1 && w > f, "🔴 الترتيب لا يضع FOUNDATION قبل Wave 4");
});

// ─── ٥ · المالية fail-closed ───────────────────────────────────────────────
test("🔴 حارس المالية fail-closed ولا يفترض true", () => {
  const t = C(RUNME);
  assert.match(t, /coalesce\(\s*\(select public\.can_see_financials\(\)[\s\S]{0,200}?false\s*\)/i,
    "🔴 لا coalesce إلى false — الغياب قد يُقرأ NULL ثمّ يُعامَل كشفًا");
  assert.match(t, /to_regprocedure\('public\.can_see_financials\(\)'\)/,
    "الحارس ما يزال بـto_regproc ⇒ الهامش محجوب دائمًا حتّى للمخوَّل");
  // ⛔ ولا افتراض true في أيّ مكان.
  assert.ok(!/v_fin\s*:=\s*true/i.test(t), "🔴 افتراض رؤية المالية");
  assert.match(t, /'margin_visible',\s*v_fin/, "لا يُعلَن أنّ الهامش محجوب");
  assert.match(t, /'avg_margin_pct',\s*null/, "الهامش يُعاد رقمًا بدل null");
});

test("⛔ لا وجود لاسم crm_see_financials في المستودع", () => {
  const hits = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    // ⚠️ يُفحص **الكود** لا التعليقات: الوثائق تذكر الاسم الخاطئ عمدًا لتشرح
    //    أنّه لا وجود له، وذكرُه في شرحٍ ليس استعمالًا.
    if (C(f).includes("crm_see_financials")) hits.push(f);
  }
  assert.deepEqual(hits, [],
    "ظهر اسم crm_see_financials — الاسم الصحيح can_see_financials");
});

// ─── ٦ · POSTCHECK: مطابقة تواقيع + نطاق + فشل حقيقيّ ──────────────────────
test("🔴 POSTCHECK يطابق الاسم + قائمة الأنواع", () => {
  const t = C(POST);
  assert.match(t, /oidvectortypes\s*\(\s*p\.proargtypes\s*\)\s*=\s*k\.fargs/,
    "لا مطابقة على قائمة الأنواع");
  assert.ok(!/pg_get_function_identity_arguments/.test(t),
    "🔴 تُعيد أسماء الوسائط مع الأنواع ⇒ لا تطابق أبدًا");
});

test("🔴 تواقيع POSTCHECK تطابق مِنَح RUNME حرفًا بحرف", () => {
  const grants = new Map();
  for (const m of R(RUNME).matchAll(/on function public\.(crm_[a-z_]+)\(([^)]*)\)/g)) {
    grants.set(m[1], m[2].split(",").map((x) => x.trim()).filter(Boolean));
  }
  const t = C(POST);
  const block = t.slice(t.indexOf("with pkg(fname, fargs)"), t.indexOf("select 'الدوالّ الثماني"));
  const rows = [...block.matchAll(/\(\s*'(crm_[a-z_]+)'\s*,\s*'([^']*)'\s*\)/g)];
  assert.equal(rows.length, 8, `عدد التواقيع ${rows.length} ≠ 8`);
  const alias = { int: "integer" };
  for (const [, fname, fargs] of rows) {
    const g = grants.get(fname);
    assert.ok(g, `🔴 ${fname} في POSTCHECK ولا مِنحة له في RUNME`);
    const expected = g.map((x) => alias[x] ?? x).join(", ");
    assert.equal(fargs, expected,
      `🔴 ${fname}: POSTCHECK يتوقّع (${fargs}) وRUNME يمنح (${expected})`);
  }
});

test("🔴 POSTCHECK يفشل فعليًّا، ونطاقه crm_ وحده", () => {
  const t = C(POST);
  assert.match(t, /raise exception/i, "لا استثناء — فشل دلاليّ بلا فشل فعليّ");
  assert.match(t, /WAVE 4 POSTCHECK FAILED/, "رسالة الفشل غير واضحة");
  // ⛔ ولا يفحص حزمًا أخرى.
  assert.ok(!/prodops_/.test(t), "🔴 يفحص prodops_ — سيحمرّ بسبب حزمة أخرى");
  assert.match(t, /routine_name like 'crm\\?_%'/, "النطاق ليس crm_");
});

test("🔴 لا sql_identifier[] = text[] في حزمة Wave 4", () => {
  for (const f of [PRE, POST]) {
    const t = C(f);
    for (const m of t.match(/array_agg\s*\(\s*(?:distinct\s+)?(grantee|routine_name|table_name)\b(?!\s*::\s*text)/gi) ?? []) {
      assert.fail(`${f}: ${m} بلا ::text`);
    }
    for (const m of t.match(/array_agg[^=]*=\s*array\s*\[[^\]]*\](?!\s*::\s*text\s*\[)/gi) ?? []) {
      assert.fail(`${f}: مقارنة بلا ::text[] ⇒ ${m.slice(0, 60)}`);
    }
  }
});

test("🔴 anon: دالّة التحقّق وحدها", () => {
  const t = C(POST);
  assert.match(t, /array\['crm_testimonial_invite_check'\]::text\[\]/,
    "التوقّع ليس دالّة التحقّق وحدها");
  const runme = C(RUNME);
  const anonGrants = [...runme.matchAll(/grant execute on function public\.(crm_[a-z_]+)\([^)]*\)[^;]*to[^;]*anon/gi)]
    .map((m) => m[1]);
  assert.deepEqual(anonGrants, ["crm_testimonial_invite_check"],
    `🔴 مِنَح anon في RUNME: ${anonGrants.join(", ")}`);
});

// ─── ٧ · تغيير قائمة الاعتمادات أو ترتيبها يكسر الاختبار ──────────────────
test("🔴 قائمة الاعتمادات المطلوبة مثبَّتة", () => {
  const t = C(PRE);
  const block = t.slice(t.indexOf("REQUIRED_DEPENDENCY"), t.indexOf("REQUIRED_GATE"));
  const names = [...block.matchAll(/\(\s*'([a-z0-9_]+)'\s*,/g)].map((m) => m[1]);
  assert.deepEqual(names, [
    "crm_opportunities", "crm_companies", "crm_activities",
    "project_shoot_sessions", "project_closure_requests",
    "fin_payment_milestones", "fin_collections",
  ], "🔴 تغيّرت قائمة الاعتمادات المطلوبة أو ترتيبها — راجع خريطة الاعتمادات");
});

test("🔴 ترتيب الإصدار المعدَّل مثبَّت", () => {
  const map = fs.readFileSync(path.join(REL, "WAVE_4_DEPENDENCY_MAP.md"), "utf8");
  const order = [...map.matchAll(/^\s*\d+\.\s+([a-z0-9_]+\.sql)/gim)].map((m) => m[1]);
  assert.deepEqual(order, [
    "wave3_production_ops_RUNME.sql",
    "wave3_permits_media_RUNME.sql",
    "wave3_calendar_tokens_RUNME.sql",
    "crm_sales_FOUNDATION_RUNME.sql",
    "wave4_crm_business_RUNME.sql",
    "wave6_assets_archive_RUNME.sql",
    // ⬇ أُضيف بعد تدقيق `custody_enterprise_03_..._PATCH`: `hse_register_v`
    //   تقرأ `custody_incidents` في فرع `union` بلا حارس ⇒ prerequisite رسميّ.
    "custody_enterprise_incidents_RUNME.sql",
    "wave6_compliance_knowledge_RUNME.sql",
    "wave6_case_study_generator_RUNME.sql",
    "wave7_global_search_RUNME.sql",
    "wave7_audit_viewer_RUNME.sql",
  ], "🔴 تغيّر ترتيب الإصدار — يجب أن يبقى FOUNDATION قبل Wave 4");
});

// 🔴 والترتيبان يجب أن يتطابقا: الخريطة والمصفوفة مصدران يقرأهما بشرٌ مختلفون،
//    وانحرافهما يعني أنّ أحدهما يكذب على مَن يشغّل الإصدار.
test("🔴 ترتيب الخريطة = ترتيب المصفوفة", () => {
  const map = fs.readFileSync(path.join(REL, "WAVE_4_DEPENDENCY_MAP.md"), "utf8");
  const fromMap = [...map.matchAll(/^\s*\d+\.\s+([a-z0-9_]+\.sql)/gim)].map((m) => m[1]);
  const mx = fs.readFileSync(path.join(REL, "SQL_RELEASE_SELECTION_MATRIX.md"), "utf8");
  const fence = (mx.split("PROPOSED PRODUCTION RUN ORDER")[1] ?? "").match(/```[\s\S]*?```/);
  assert.ok(fence, "كتلة الترتيب مفقودة من المصفوفة");
  const fromMatrix = [...fence[0].matchAll(/([a-z0-9_]+\.sql)/gi)].map((m) => m[1]);
  assert.deepEqual(fromMap, fromMatrix, "🔴 الخريطة والمصفوفة تعطيان ترتيبين مختلفين");
});

test("FOUNDATION له رفاقه الثلاثة", () => {
  for (const k of ["PREFLIGHT", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(fs.existsSync(path.join(DOCS, `crm_sales_FOUNDATION_${k}.sql`)),
      `crm_sales_FOUNDATION_${k}.sql مفقود — prerequisite بلا رفيق`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٨ · 🔴 `crm_client_health_v` — الإسناد عبر الآباء لا عبر عمود غير موجود
//
// العيب: افترضت الـview `crm_activities.company_id`، وهو **غير موجود** في
// المخطّط. الجدول يربط بـ`lead_id`/`opportunity_id`/`contact_id`، وكلٌّ منها
// يحمل `company_id`. وفشل الـview أسقط الحزمة كلّها (معاملة واحدة).
// ════════════════════════════════════════════════════════════════════════════

/** جسم الـview وحده. */
function healthView() {
  const t = C(RUNME);
  const i = t.indexOf("create or replace view public.crm_client_health_v");
  assert.ok(i > -1, "الـview غير موجودة");
  const j = t.indexOf(";", t.indexOf("from public.crm_companies", i));
  return t.slice(i, j + 1);
}

/** يجرّد التعليقات **والسلاسل**: اسمٌ داخل رسالة فحص ليس استعمالًا للعمود. */
function codeNoStrings(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") q = false; out += " "; i++; continue; }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}

test("🔴 لا استعمال لـcrm_activities.company_id في المستودع كلّه", () => {
  const bad = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    // ⚠️ السلاسل مجرّدة: POSTCHECK يذكر الاسم في **رسالة حارس** تمنع عودته،
    //    وذكرُه هناك عكس الاستعمال تمامًا.
    const t = codeNoStrings(R(f));
    if (!/crm_activities/.test(t)) continue;
    // `a.company_id` حيث `a` هو ألياس crm_activities، أو الصيغة الصريحة.
    for (const m of t.match(/\bcrm_activities\s+a\b[\s\S]{0,400}?\ba\.company_id\b/gi) ?? []) {
      bad.push(`${f}: ${m.slice(-40)}`);
    }
    for (const m of t.match(/crm_activities\.company_id/gi) ?? []) bad.push(`${f}: ${m}`);
  }
  assert.deepEqual(bad, [], "🔴 عمود غير موجود — يُفشل الـview ويُسقط الحزمة:\n" + bad.join("\n"));
});

test("🔴 الإسناد يمرّ بالمسارات الثلاثة كلّها", () => {
  const v = healthView();
  for (const [col, tbl] of [["opportunity_id", "crm_opportunities"],
                            ["lead_id", "crm_leads"],
                            ["contact_id", "crm_contacts"]]) {
    assert.ok(v.includes(col), `🔴 مسار ${col} مفقود — نشاط مرتبط به وحده لن يُنسَب`);
    assert.ok(v.includes(tbl), `🔴 لا ربط بـ${tbl}`);
  }
  assert.match(v, /o\.company_id/, "لا مرشّح من الفرصة");
  assert.match(v, /l\.company_id/, "لا مرشّح من العميل المحتمل");
  assert.match(v, /ct\.company_id/, "لا مرشّح من جهة الاتصال");
});

test("🔴 التمييز يمنع مضاعفة النشاط الواحد", () => {
  const v = healthView();
  assert.match(v, /array_agg\s*\(\s*distinct\s+cand\.company_id\s*\)/i,
    "🔴 بلا distinct: روابط متعدّدة لنفس الشركة تُحتسب مرّات");
});

test("🔴 الالتباس fail-closed — مرشّح واحد فقط يُنسَب", () => {
  const v = healthView();
  assert.match(v, /array_length\s*\(\s*companies\s*,\s*1\s*\)\s*=\s*1/i,
    "🔴 لا شرط «مرشّح واحد» ⇒ نشاط بروابط لشركات مختلفة يُنسَب اعتباطيًا");
});

test("⛔ لا COALESCE ذو أولوية عشوائية بين مصادر الشركة", () => {
  const v = healthView();
  // coalesce بين مرشّحات الشركة = اختيار صامت لأحدها عند التعارض.
  assert.ok(!/coalesce\s*\(\s*o\.company_id/i.test(v), "🔴 coalesce يبدأ بالفرصة — أولوية مخترَعة");
  assert.ok(!/coalesce\s*\(\s*l\.company_id/i.test(v), "🔴 coalesce يبدأ بالعميل المحتمل");
  assert.ok(!/coalesce\s*\(\s*ct\.company_id/i.test(v), "🔴 coalesce يبدأ بجهة الاتصال");
  // وcoalesce المسموح: is_deleted و days_silent فقط.
  for (const m of v.match(/coalesce\s*\([^)]*\)/gi) ?? []) {
    assert.ok(/is_deleted/i.test(m), `🔴 coalesce غير مبرَّر: ${m.slice(0, 60)}`);
  }
});

test("🔴 المرشّح الفارغ يُستبعد — نشاط بلا رابط لا يُنسَب", () => {
  const v = healthView();
  assert.match(v, /cand\.company_id is not null/i,
    "🔴 المرشّحات الفارغة تدخل التجميع ⇒ نشاط بلا شركة يُنسَب");
});

test("الآباء المحذوفون لا يُعطون مرشّحًا", () => {
  const v = healthView();
  for (const alias of ["o", "l", "ct"]) {
    assert.ok(new RegExp(`coalesce\\(${alias}\\.is_deleted, false\\) = false`).test(v),
      `الأب ${alias} المحذوف ما يزال يُعطي مرشّحًا`);
  }
  assert.match(v, /coalesce\(a\.is_deleted, false\) = false/, "النشاط المحذوف يُحتسب");
});

test("🔴 days_silent = NULL بلا نشاط، ⛔ لا صفر", () => {
  const v = healthView();
  assert.match(v, /case when la\.last_activity_at is null then null/i,
    "🔴 الصمت رقم بلا نشاط — يجعل الخاملة تبدو الأنشط");
});

test("⛔ لا min(uuid) — غير متاح قبل PostgreSQL 14", () => {
  const v = healthView();
  assert.ok(!/\bmin\s*\(\s*cand\.company_id/i.test(v), "min على uuid غير مدعوم في كل الإصدارات");
  assert.match(v, /\(companies\)\[1\]/, "لا استخراج للمرشّح الوحيد من المصفوفة");
});

test("⛔ لا إضافة company_id إلى crm_activities ولا بنية موازية", () => {
  const t = C(RUNME);
  assert.ok(!/alter table[^;]*crm_activities[^;]*add column[^;]*company_id/i.test(t),
    "🔴 أُضيف company_id إلى crm_activities");
  assert.ok(!/create table[^;]*crm_activity_compan/i.test(t), "🔴 جدول إسناد موازٍ");
});

// ─── الحزمة معاملة واحدة ───────────────────────────────────────────────────
test("🔴 RUNME معاملة واحدة — الفشل يتراجع كاملًا", () => {
  const t = C(RUNME);
  assert.equal((t.match(/^begin;/gim) ?? []).length, 1, "أكثر من begin أو لا شيء");
  assert.equal((t.match(/^commit;/gim) ?? []).length, 1, "أكثر من commit أو لا شيء");
  assert.ok(t.indexOf("begin;") < t.indexOf("commit;"), "commit قبل begin");
  // ⛔ ولا commit وسيط يجعل نصف الحزمة يثبت.
  assert.ok(!/^commit;[\s\S]*^begin;/m.test(t), "🔴 معاملات متعدّدة — تطبيق جزئيّ ممكن");
});

// ─── PREFLIGHT/POSTCHECK للـview ───────────────────────────────────────────
test("🔴 PREFLIGHT يتحقّق من أعمدة الإسناد ويفشل بغيابها", () => {
  const t = C(PRE);
  // ⚠️ يُقرأ **بلوك REQUIRED_COLUMN وحده**: الأسماء تتكرّر في بلوك FK_RELATION،
  //    ففحصُ الملفّ كلّه كان يمرّر حذفَ عمود من قائمة الاعتمادات (طفرة M7).
  const block = t.slice(t.indexOf("REQUIRED_COLUMN"), t.indexOf("MUST_NOT_BE_ASSUMED"));
  const pairs = [...block.matchAll(/\(\s*'([a-z_]+)'\s*,\s*'([a-z_]+)'\s*\)/g)]
    .map((m) => `${m[1]}.${m[2]}`).sort();
  assert.deepEqual(pairs, [
    "crm_activities.contact_id", "crm_activities.lead_id",
    "crm_activities.occurred_at", "crm_activities.opportunity_id",
    "crm_contacts.company_id", "crm_leads.company_id", "crm_opportunities.company_id",
  ], "🔴 تغيّرت قائمة أعمدة الإسناد المطلوبة");

  // والحسم يفحص **القائمة نفسها** لا مجرّد وجود صيغة.
  const decide = t.slice(t.indexOf("do $$"));
  assert.match(decide, /COLUMN ' \|\| v_pair/, "🔴 الأعمدة خارج بلوك الحسم — الغياب لن يُفشل");
  for (const pair of pairs) {
    assert.ok(decide.includes(`'${pair}'`), `🔴 ${pair} مفحوص إعلاميًّا وخارج الحسم`);
  }
});

test("🔴 POSTCHECK يثبت الـview ويُنفّذ SELECT فعليًّا", () => {
  const t = C(POST);
  assert.match(t, /to_regclass\('public\.crm_client_health_v'\)/, "لا فحص وجود للـview");
  assert.match(t, /select count\(\*\)[\s\S]{0,60}from public\.crm_client_health_v/i,
    "🔴 لا تنفيذ فعليّ — تعريف سليم لا يعني استعلامًا ناجحًا");
  assert.match(t, /pg_get_viewdef/, "لا فحص لتعريف الـview");
  assert.match(t, /a\\\.company_id/, "لا حارس ضدّ عودة الافتراض الخاطئ");
  const decide = t.slice(t.indexOf("do $$"));
  assert.ok(decide.includes("crm_client_health_v"), "الـview خارج بلوك الحسم");
});
