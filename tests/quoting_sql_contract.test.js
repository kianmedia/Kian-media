// ════════════════════════════════════════════════════════════════════════════
// tests/quoting_sql_contract.test.js — عقد حزمة SQL للمرحلة ٤+٥.
//
// الحزمة أربعة ملفّات لكلٍّ منها دور لا يتداخل مع غيره:
//   PREFLIGHT  قراءة فقط · **يُثبت** ترتيب الاعتماديات ولا يفترضه
//   RUNME      معاملة واحدة · قابل لإعادة التشغيل · بلا CONCURRENTLY
//   POSTCHECK  قراءة فقط · مجموعة نتائج **واحدة** · بنيويّ ساكن
//   ROLLBACK   للطوارئ · صادق في وصف ما يُفقد
//
// وسبب التشديد على «ساكن»: محرّر SQL يعمل بدور postgres و auth.uid() = NULL،
// فاستدعاء دالّة محميّة حيّة يرفع «not authorized» ويُسقط الترحيلة. هذا كلّف
// دورتَي إنتاج سابقتين، ولذلك يُختبر آليًّا لا يُترك للانضباط.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, SQL_CODE, PREFLIGHT, POSTCHECK, ROLLBACK,
  funcDef, funcBody, tableDef, selfTest, allFuncNames, sqlArray, exists, stripSqlComments,
  TABLES, STATES, TIERS, REQUIRED_INPUTS, SALES_FNS, OWNER_FNS,
} = require("./quoting_helpers.js");

// ─── (١) شكل الحزمة ─────────────────────────────────────────────────────────

test("الملفّات الأربعة موجودة", () => {
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(exists(`docs/smart_quoting_${f}.sql`), `docs/smart_quoting_${f}.sql مفقود`);
  }
});

test("RUNME معاملة واحدة بلا CONCURRENTLY", () => {
  assert.equal((SQL.match(/^begin;$/gm) ?? []).length, 1, "أكثر من begin أو لا begin");
  assert.equal((SQL.match(/^commit;$/gm) ?? []).length, 1, "أكثر من commit أو لا commit");
  assert.ok(SQL.indexOf("\nbegin;") < SQL.indexOf("\ncommit;"), "commit قبل begin");
  // على الكود لا على الشرح: رأس الملفّ يعلن «بلا CONCURRENTLY» بالحروف نفسها.
  assert.ok(!/concurrently/i.test(SQL_CODE), "CONCURRENTLY داخل معاملة — سيفشل");
  assert.match(SQL, /notify pgrst, 'reload schema';/, "لا إعادة تحميل لمخطط PostgREST");
});

test("RUNME قابل لإعادة التشغيل", () => {
  // الجداول والفهارس والتسلسلات بصيغة idempotent
  const creates = [...SQL_CODE.matchAll(/create table (?!if not exists)/g)];
  assert.deepEqual(creates.map((c) => c[0]), [], "create table بلا if not exists");
  const idx = [...SQL_CODE.matchAll(/create index (?!if not exists)/g)];
  assert.deepEqual(idx.map((c) => c[0]), [], "create index بلا if not exists");
  const seq = [...SQL_CODE.matchAll(/create sequence (?!if not exists)/g)];
  assert.deepEqual(seq.map((c) => c[0]), [], "create sequence بلا if not exists");
  // والدوالّ والسياسات تُسقَط أوّلًا في §0 — وهو ما يمنع 42P13 عند تغيير نوع الإرجاع
  assert.match(SQL, /do \$reset\$/, "لا كتلة إعادة تهيئة في §0");
  assert.match(SQL, /drop function if exists %s/, "الدوالّ لا تُسقَط قبل إعادة بنائها");
  assert.match(SQL, /drop policy if exists %I on %I\.%I/, "السياسات لا تُسقَط قبل إعادة بنائها");
});

test("RUNME يمنع بفحص صلب قبل أن يكتب حرفًا", () => {
  const pre = SQL.slice(SQL.indexOf("do $pre$"), SQL.indexOf("$pre$;") + 6);
  assert.match(pre, /public\.is_owner\(\)/, "الفحص الصلب لا يتحقّق من is_owner");
  assert.match(pre, /public\.is_staff\(\)/, "الفحص الصلب لا يتحقّق من is_staff");
  assert.match(pre, /public\.clients/, "الفحص الصلب لا يتحقّق من جدول العملاء");
  assert.match(pre, /raise exception/, "الفحص الصلب ينصح ولا يمنع");
  // ويتحقّق من **نوع** الإرجاع لا من الوجود فقط
  assert.match(pre, /prorettype <> 'boolean'::regtype/,
    "بوّابة لا تُرجع boolean تُنتج سياسات بمعنى غير محدَّد — والفحص لا يكشفها");
});

// ─── (٢) PREFLIGHT يُثبت الترتيب ────────────────────────────────────────────

test("★ PREFLIGHT يُثبت ترتيب الاعتماديات ولا يفترضه ★", () => {
  assert.match(PREFLIGHT, /order_proof/, "لا قسم لإثبات الترتيب");
  // يسمّي التابع والمتبوع صراحةً
  assert.match(PREFLIGHT, /'public\.is_owner\(\)',\s*'public\.sq_can_view_cost\(\)'/,
    "لا يُثبت أنّ is_owner تسبق بوّابة التكلفة");
  assert.match(PREFLIGHT, /'public\.clients',\s*'public\.sq_quotes'/,
    "لا يُثبت أنّ جدول العملاء يسبق جدول العروض");
  assert.match(PREFLIGHT, /rettype_ok/, "لا يفحص نوع إرجاع الاعتماديات");
  assert.match(PREFLIGHT, /BLOCKER/, "لا تصنيف مانع");
});

/**
 * جُمَل الكتابة **في موضع الجملة** — لا داخل سلسلة نصّية ولا في تعليق.
 * POSTCHECK مثلًا يحمل السلسلة '%insert into public.projects%' عمدًا كي يفحص
 * أنّ الموديول لا يكتب في المنصّة المجمَّدة؛ فحصٌ ساذج بالبحث النصّيّ يعُدّ
 * ذلك «كتابةً» ويُفشِل ملفًّا صحيحًا.
 */
function writesInStatementPosition(src) {
  const bare = stripSqlComments(src).replace(/'[^']*'/g, "''");
  const pats = [
    /^\s*insert\s+into\b/im, /^\s*update\s+[\w.]+\s+set\b/im, /^\s*delete\s+from\b/im,
    /^\s*create\s+(table|index|function|policy|sequence|trigger)\b/im,
    /^\s*alter\s+table\b/im, /^\s*drop\s+\w+/im, /^\s*grant\b/im, /^\s*revoke\b/im,
  ];
  return pats.filter((p) => p.test(bare)).map(String);
}

test("PREFLIGHT قراءة فقط", () => {
  assert.deepEqual(writesInStatementPosition(PREFLIGHT), [], "PREFLIGHT يكتب");
});

test("★ PREFLIGHT لا يستدعي دالّة محميّة حيّة ★", () => {
  // الأسماء تُذكر عمدًا كسلاسل نصّية داخل to_regclass/to_regprocedure — وهذا
  // فحص وجود، لا استدعاء. الاستدعاء الحيّ هو ما نمنعه: بدور postgres تكون
  // auth.uid() = NULL، فترجع البوّابة false ويُقرأ ذلك «الحارس مكسور».
  // التعليقات أوّلًا ثمّ السلاسل: رأس الملفّ يشرح لماذا is_owner حرجة،
  // والصفوف تحملها كسلسلة داخل to_regprocedure. كلاهما ليس استدعاءً.
  const bare = stripSqlComments(PREFLIGHT).replace(/'[^']*'/g, "''");
  assert.match(bare, /to_regprocedure/,
    "تجريد التعليقات أتلف الملفّ — الفحص أدناه سيكون بلا معنى");
  for (const f of ["sq_can_view_cost", "sq_can_approve", "sq_quotes_list",
                   "sq_quote_detail", "is_owner", "is_staff"]) {
    assert.ok(!new RegExp(`public\\.${f}\\s*\\(`).test(bare),
      `PREFLIGHT يستدعي ${f} حيًّا خارج سلسلة نصّية`);
  }
  // ومع ذلك يفحصها فعلًا (كسلاسل) — وإلّا لكان الفحص أعلاه بلا معنى
  assert.match(PREFLIGHT, /to_regprocedure/, "PREFLIGHT لا يفحص وجود الدوالّ إطلاقًا");
  assert.ok(PREFLIGHT.includes("'public.is_owner()'"), "PREFLIGHT لا يفحص is_owner كسلسلة");
});

test("★ PREFLIGHT يفحص الجوار الحسّاس — البوّابة المالية ما زالت للمالك ★", () => {
  assert.match(PREFLIGHT, /finops_can_view_finance_sensitive/,
    "لا فحص للبوّابة المالية — ولو ضعُفت لصار الجمع بين الموديولين يكشف الهامش");
  assert.match(PREFLIGHT, /fin_owner_only/, "لا تقييم لكون البوّابة المالية للمالك");
});

// ─── (٣) POSTCHECK ──────────────────────────────────────────────────────────

test("★ POSTCHECK مجموعة نتائج واحدة ★", () => {
  const statements = POSTCHECK.split(/;\s*(?:--[^\n]*\n)*/).filter((s) => /\bselect\b/i.test(s));
  assert.equal(statements.length, 1,
    `POSTCHECK يُنتج ${statements.length} مجموعة نتائج — المطلوب واحدة`);
  assert.match(POSTCHECK, /^with\s/im, "POSTCHECK ليس استعلامًا واحدًا بـWITH");
});

test("POSTCHECK قراءة فقط وبنيويّ ساكن", () => {
  assert.deepEqual(writesInStatementPosition(POSTCHECK), [], "POSTCHECK يكتب");
  // ومع ذلك يذكر جُمَل الكتابة **كسلاسل** ليفحص أنّ الموديول لا يكتب في
  // المنصّة المجمَّدة — وهو فحص مقصود لا مخالفة.
  assert.ok(POSTCHECK.includes("'%insert into public.projects%'"),
    "POSTCHECK لا يفحص الكتابة في المنصّة المجمَّدة");
  // يقرأ التعريفات من كتالوج النظام
  assert.match(POSTCHECK, /pg_get_functiondef/, "لا يفحص تعريفات الدوالّ");
  assert.match(POSTCHECK, /pg_policies/, "لا يفحص السياسات");
  assert.match(POSTCHECK, /pg_constraint/, "لا يفحص القيود");
});

test("★ POSTCHECK لا يستدعي بوّابة محميّة حيّة ★", () => {
  for (const f of ["sq_can_view_cost()", "sq_can_approve()", "sq_can_view()"]) {
    const esc = f.replace("(", "\\(").replace(")", "\\)");
    // مسموح ذكرها داخل سلسلة نصّية للمطابقة (ilike '%…%')، لا استدعاؤها
    const live = [...POSTCHECK.matchAll(new RegExp(`select[^;']*public\\.${esc}`, "gi"))];
    assert.deepEqual(live.map((c) => c[0]), [], `POSTCHECK يستدعي ${f} حيًّا`);
  }
});

test("POSTCHECK يفحص حارس الربحية صراحةً ولا يمرّ بمصيدة", () => {
  assert.match(POSTCHECK, /حارس الربحية/, "لا محور لحارس الربحية");
  assert.match(POSTCHECK, /cost_tokens/, "لا فحص لرموز التكلفة");
  // ★ حارس ضدّ الفحص الفارغ: صفٌّ يتأكّد أنّ الدوالّ المفحوصة موجودة فعلًا
  assert.match(POSTCHECK, /كلّ دالّة سطح بيع موجودة فعلًا/,
    "لا حارس ضدّ فحص يمرّ لأنّ الدوالّ غائبة أصلًا");
  assert.ok(!/case when true then 'PASS'/.test(POSTCHECK), "مصيدة تجعل فحصًا يمرّ دائمًا");
});

test("POSTCHECK يقرأ الـACL مباشرةً لا باسم دور قد لا يوجد", () => {
  // has_function_privilege('anon', …) يرفع خطأً إن غاب الدور، فيُسقط المجموعة كلّها.
  assert.match(POSTCHECK, /aclexplode/, "فحوص المنح لا تقرأ الـACL");
  assert.ok(!/has_function_privilege\('anon'/.test(POSTCHECK),
    "استدعاء باسم دور قد لا يوجد — يرفع خطأً بدل أن يُبلّغ");
});

// ─── (٤) ROLLBACK صادق ──────────────────────────────────────────────────────

test("★ ROLLBACK صادق في وصف ما يُفقد — بالاسم لا بالتعميم ★", () => {
  for (const named of ["sq_quotes", "sq_cost_rates", "sq_pricing_rules",
                       "sq_quote_internal", "sq_audit", "sq_price_book_versions"]) {
    assert.ok(ROLLBACK.includes(named), `ROLLBACK لا يسمّي ${named} ضمن ما يُمحى`);
  }
  assert.match(ROLLBACK, /لا رجعة فيه/, "لا تصريح بأنّ المحو نهائيّ");
  assert.match(ROLLBACK, /لا يصنع نسخًا|لا يصنع نسخة احتياطية/,
    "★ ROLLBACK لا يوضّح أنّه لا يأخذ نسخة احتياطية — وهو أخطر افتراض يقع فيه من يشغّله");
});

test("ROLLBACK متدرّج: المستوى المدمّر معلّق افتراضيًّا", () => {
  // المستوى ١ (تعطيل بلا فقد) وحده فعّال
  const active = ROLLBACK.split("\n").filter((l) => !l.trimStart().startsWith("--"));
  const activeText = active.join("\n");
  assert.ok(!/drop table/i.test(activeText),
    "★ drop table فعّال في ROLLBACK — سطرٌ واحد يمحو كلّ العروض");
  assert.match(activeText, /revoke all on function/, "المستوى الأوّل غير فعّال");
  // والمستويان ٢ و٣ موجودان معلّقين
  assert.match(ROLLBACK, /-- drop table if exists public\.sq_quotes\s+cascade;/,
    "المستوى المدمّر غير موجود ولو معلّقًا");
});

test("ROLLBACK لا يلمس المنصّة المجمَّدة ولا الموديولات الأخرى", () => {
  for (const t of ["public.projects", "public.project_core", "public.deliverables",
                   "public.fin_", "public.crm_", "public.csub_"]) {
    const dropping = new RegExp(`^\\s*drop[^\\n]*${t.replace(".", "\\.")}`, "im");
    assert.ok(!dropping.test(ROLLBACK.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")),
      `ROLLBACK يُسقط ${t}`);
  }
});

// ─── (٥) البنية المطلوبة في المتطلّب ────────────────────────────────────────

test("الجداول الأربعة عشر معرَّفة", () => {
  for (const t of TABLES) {
    assert.ok(new RegExp(`create table if not exists public\\.${t}\\b`).test(SQL),
      `الجدول ${t} غير معرَّف`);
  }
});

test("★ الحالات التسع كلّها — بأسمائها في المتطلّب ★", () => {
  const def = tableDef("sq_quotes");
  const m = def.match(/status\s+text not null default 'draft' check \(status in \(([\s\S]*?)\)\)/);
  assert.ok(m, "قيد الحالات غير موجود");
  for (const s of STATES) {
    assert.ok(m[1].includes(`'${s}'`), `الحالة ${s} غير مسموحة في القيد`);
  }
  const found = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
  assert.deepEqual(found.sort(), [...STATES].sort(), "قائمة الحالات لا تطابق المتطلّب");
});

test("الفئات الأربع", () => {
  const def = tableDef("sq_quotes");
  for (const t of TIERS) assert.ok(def.includes(`'${t}'`), `الفئة ${t} غير مسموحة`);
  const tiers = funcBody("sq_tiers");
  for (const t of TIERS) assert.ok(tiers.includes(`'${t}'`), `الفئة ${t} غائبة عن الكتالوج`);
});

test("★ مدخلات النطاق المطلوبة كلّها ★", () => {
  const def = tableDef("sq_quote_inputs");
  const missing = REQUIRED_INPUTS.filter((k) => !def.includes(k));
  assert.deepEqual(missing, [], "مدخلات ناقصة: " + missing.join("، "));
});

test("مخرجات المتطلّب موجودة — كلٌّ في سطحه الصحيح", () => {
  const sell = tableDef("sq_quotes");
  const own = tableDef("sq_quote_internal");
  // سطح البيع
  for (const k of ["range_low", "range_high", "gross_before_vat", "vat_amount",
                   "total_after_vat", "assumptions", "exclusions", "version_no", "status",
                   "validity_days", "authorized_price"]) {
    assert.ok(sell.includes(k), `المخرَج ${k} غائب عن سطح البيع`);
  }
  // سطح المالك
  for (const k of ["internal_cost_estimate", "recommended_price", "min_price",
                   "gross_profit", "margin_pct", "est_net_profit"]) {
    assert.ok(own.includes(k), `المخرَج ${k} غائب عن سطح المالك`);
  }
});

test("دفعات السداد جدول قائم بذاته بضريبته", () => {
  const def = tableDef("sq_quote_milestones");
  for (const k of ["seq", "label", "pct", "amount_net", "vat_amount", "amount_gross", "due_rule"]) {
    assert.ok(def.includes(k), `عمود الدفعات ${k} مفقود`);
  }
  assert.match(def, /unique \(quote_id, seq\)/, "لا فرادة لترتيب الدفعة");
});

// ─── (٦) SELF-TEST ساكن ─────────────────────────────────────────────────────

test("★ SELF-TEST ساكن — لا يستدعي بوّابة حيّة ★", () => {
  const st = selfTest();
  assert.match(st, /pg_get_functiondef/, "SELF-TEST لا يقرأ التعريفات");
  // لا استدعاء فعليّ: الأسماء تُبنى كسلاسل نصّية وتُمرَّر إلى to_regprocedure
  assert.ok(!/perform public\.sq_can_view_cost\(\)/.test(st),
    "SELF-TEST يستدعي بوّابة حيّة — سيفشل بدور postgres");
  assert.ok(!/select public\.sq_quotes_list\(/.test(st), "SELF-TEST يستدعي دالّة محميّة");
  assert.match(st, /ilike/, "SELF-TEST لا يطابق التعريفات نصًّا");
});

test("★ SELF-TEST بلا مصيدة تجعله يمرّ ★", () => {
  const st = selfTest();
  assert.match(st, /raise exception/, "SELF-TEST لا يرفع عند الفشل");
  assert.ok(!/exception when others then\s*null/.test(st),
    "★ مصيدة تبتلع الفشل — SELF-TEST يمرّ مهما كان");
  // ويجمع كلّ الأخطاء ثمّ يرفع مرّة واحدة تسمّيها
  assert.match(st, /v_bad := v_bad \|\|/, "لا تجميع للأخطاء");
  assert.match(st, /array_to_string\(v_bad/, "لا تسمية للأخطاء عند الرفع");
});

test("SELF-TEST يفحص المحاور الثمانية", () => {
  const st = selfTest();
  for (const axis of ["relrowsecurity", "sq_can_view_cost", "v_cost_tokens", "pg_constraint",
                      "role_table_grants", "has_function_privilege", "pg_trigger"]) {
    assert.ok(st.includes(axis), `SELF-TEST لا يفحص ${axis}`);
  }
});

// ─── (٧) صحّة عامّة ──────────────────────────────────────────────────────────

test("كلّ دالّة SECURITY DEFINER بمسار بحث مثبَّت", () => {
  for (const name of allFuncNames()) {
    const d = funcDef(name);
    if (/security definer/i.test(d)) {
      assert.match(d, /set search_path = public/,
        `${name} دالّة SECURITY DEFINER بلا مسار بحث مثبَّت`);
    }
  }
});

test("كلّ مُسنَد بوّابة يُرجع boolean صريحًا لا NULL", () => {
  for (const f of ["sq_can_view", "sq_can_build", "sq_can_manage_catalog", "sq_can_export",
                   "sq_can_view_cost", "sq_can_approve", "sq_is_owner_role", "sq_is_client"]) {
    const d = funcDef(f);
    assert.match(d, /returns boolean/, `${f} لا تُرجع boolean`);
    assert.match(funcBody(f), /coalesce\(/,
      `${f} قد تُرجع NULL — وNULL في سياسة RLS ليس منعًا بل «غير محدَّد»`);
  }
  // والجسر إلى محرّك الصلاحيات fail-closed
  const perm = funcBody("sq_perm");
  assert.match(perm, /exception when others then\s*\n?\s*return false;/,
    "★ sq_perm تفشل مفتوحةً — المصيدة يجب أن تُفشِل لا أن تُنجِح");
});

test("كلّ دالّة ممنوحة موجودة فعلًا", () => {
  const api = sqlArray("v_api");
  const defined = new Set(allFuncNames());
  const missing = api.filter((f) => !defined.has(f));
  assert.deepEqual(missing, [], "دوالّ في قائمة المنح غير معرَّفة: " + missing.join("، "));
  assert.ok(api.length >= 50, "قائمة الواجهة قصيرة على نحو مريب");
});

test("سطحا البيع والمالك يغطّيان كلّ الدوالّ الممنوحة بلا تداخل", () => {
  const overlap = SALES_FNS.filter((f) => OWNER_FNS.includes(f));
  assert.deepEqual(overlap, [], "دالّة في السطحين معًا: " + overlap.join("، "));
});
