// ════════════════════════════════════════════════════════════════════════════
// tests/finance_sql_contract.test.js — عقد حزمة SQL للمالية.
//
// الجداول · RLS قراءة فقط · لا anon · SECURITY DEFINER بمسار مثبَّت · التدقيق ·
// الحذف الليّن بسبب · صدق PREFLIGHT/POSTCHECK/ROLLBACK · وصلابة الـSELF-TEST
// نفسه (اختبار لا يمكن أن يفشل ليس اختبارًا).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, funcBody, funcDecl, section, tableDef,
  TABLES, PREDICATES, INTERNAL_FNS, READ_FNS, WRITE_FNS, GATED_READ_FNS,
} = require("./finance_helpers.js");

test("الحزمة معاملة واحدة: begin/commit، وPREFLIGHT خارجها", () => {
  const iPre = SQL.indexOf("do $pre$");
  const iBegin = SQL.indexOf("\nbegin;");
  const iCommit = SQL.lastIndexOf("\ncommit;");
  assert.ok(iPre > 0 && iBegin > iPre, "PREFLIGHT الصلب يجب أن يسبق begin");
  assert.ok(iCommit > iBegin, "لا commit بعد begin");
  assert.match(SQL, /notify pgrst, 'reload schema'/, "لا إعادة تحميل لمخطّط PostgREST");
});

test("الجداول الاثنان والعشرون كلّها مُنشأة بصيغة idempotent", () => {
  for (const t of TABLES) {
    assert.match(SQL, new RegExp(`create table if not exists public\\.${t}\\s*\\(`, "i"),
      `الجدول ${t} غير مُنشأ أو غير idempotent`);
  }
  assert.equal(TABLES.length, 22, "عدد الجداول تغيّر — حدّث المصفوفة والاختبار معًا");
});

test("RLS مفعّلة على كلّ جدول، ولا سياسة كتابة على أيّ منها", () => {
  const rls = section("-- §4) RLS");
  for (const t of TABLES) {
    assert.ok(rls.includes(`'${t}'`), `الجدول ${t} خارج قائمة تفعيل RLS`);
  }
  assert.match(rls, /alter table public\.%I enable row level security/i);
  // لا سياسة insert/update/delete في الحزمة كلّها
  assert.ok(!/create policy[\s\S]{0,200}for\s+(insert|update|delete|all)\b/i.test(SQL),
    "توجد سياسة كتابة مباشرة — كلّ كتابة يجب أن تمرّ بـRPC");
  // وحارس داخل الـSELF-TEST نفسه
  assert.match(SQL, /pg_policies[\s\S]{0,120}cmd <> 'SELECT'/,
    "الـSELF-TEST لا يمنع ظهور سياسة كتابة لاحقًا");
});

test("لا صلاحية anon على أيّ جدول أو دالّة — سحب صريح لا افتراض", () => {
  const grants = section("-- §8) الصلاحيات");
  assert.match(grants, /revoke all on function %s from anon/i, "لا سحب من anon للدوالّ");
  assert.match(grants, /revoke all on table public\.%I from anon/i, "لا سحب من anon للجداول");
  assert.ok(!/grant\s+[a-z ,]*\s+to\s+anon/i.test(SQL), "توجد منحة لـanon في الحزمة");
  // وحارس في الـSELF-TEST
  assert.match(SQL, /has_function_privilege\('anon'/, "الـSELF-TEST لا يفحص anon على الدوالّ");
  assert.match(SQL, /grantee = 'anon'/, "الـSELF-TEST لا يفحص anon على الجداول");
});

test("الجداول للقراءة فقط: منحة SELECT وحدها لـauthenticated", () => {
  const grants = section("-- §8) الصلاحيات");
  assert.match(grants, /revoke all on table public\.%I from authenticated/i);
  assert.match(grants, /grant select on table public\.%I to authenticated/i);
  assert.ok(!/grant\s+(insert|update|delete)[\s\S]{0,60}to authenticated/i.test(SQL),
    "منحة كتابة مباشرة على جدول ماليّ");
});

test("كلّ دالّة عامّة SECURITY DEFINER بمسار بحث مثبَّت", () => {
  for (const f of [...READ_FNS, ...WRITE_FNS, ...PREDICATES, ...INTERNAL_FNS]) {
    const d = funcDecl(f);
    assert.match(d, /security definer/i, `${f} ليست SECURITY DEFINER`);
    assert.match(d, /set search_path = public/i, `${f} بلا search_path مثبَّت`);
  }
});

test("كلّ دالّة كتابة: بوّابة جلسة + منع صريح + تدقيق", () => {
  for (const f of WRITE_FNS) {
    const b = funcBody(f);
    assert.match(b, /auth\.uid\(\) is null/, `${f} بلا بوّابة جلسة`);
    assert.match(b, /not authorized/, `${f} لا ترفع منعًا صريحًا`);
    assert.match(b, /finops_log\(/, `${f} بلا تدقيق`);
  }
});

test("كلّ دالّة قراءة تُغلق قبل أن تقرأ صفًّا — والمِجَسّ وحده لا يرفع استثناء", () => {
  for (const f of GATED_READ_FNS) {
    const b = funcBody(f);
    assert.match(b, /if not \(?coalesce\(public\.finops_can_/,
      `${f} لا تفحص بوّابة قبل القراءة`);
    assert.match(b, /raise exception 'not authorized'/, `${f} لا ترفع منعًا`);
    // البوّابة أوّل ما يُنفَّذ: لا استعلام قبلها
    const gate = b.search(/if not \(?coalesce\(public\.finops_can_/);
    const firstSelect = b.search(/\bselect\b/i);
    assert.ok(firstSelect === -1 || gate < firstSelect,
      `${f} تقرأ صفوفًا قبل فحص الصلاحية`);
  }
  const access = funcBody("finops_access");
  assert.ok(!/raise exception/i.test(access),
    "المِجَسّ يرفع استثناء ⇒ تعجز الواجهة عن التفريق بين المنع والترحيلة الناقصة");
});

test("الدوالّ الداخلية غير ممنوحة لأحد — أخطرها محرّك الربحية", () => {
  const grants = section("-- §8) الصلاحيات");
  const iInternal = grants.indexOf("(ب)");
  assert.ok(iInternal > 0, "لا قسم للدوالّ الداخلية في المنح");
  const internalBlock = grants.slice(iInternal);
  for (const f of INTERNAL_FNS) {
    assert.ok(internalBlock.includes(`public.${f}(`), `${f} ليست في كتلة السحب الداخلية`);
  }
  assert.match(internalBlock, /revoke all on function %s from authenticated/i);
  // ولا تُمنح في كتلة (أ)
  const publicBlock = grants.slice(0, iInternal);
  assert.ok(!publicBlock.includes("public.finops_profit_core("),
    "محرّك الربحية ممنوح لـauthenticated — تسريب هامش مباشر");
  assert.match(SQL, /authenticated يملك EXECUTE على الدالّة الداخلية/,
    "الـSELF-TEST لا يحرس منح الدوالّ الداخلية");
});

test("الحذف ليّن دائمًا وبسبب مكتوب — ولا حذف صلب في الحزمة", () => {
  const b = funcBody("finops_row_delete");
  assert.match(b, /length\(btrim\(coalesce\(p_reason, ''\)\)\) < 3/, "الحذف يمرّ بلا سبب");
  assert.match(b, /is_deleted = true/, "الحذف ليس ليّنًا");
  assert.match(b, /unknown_kind/, "الحذف يقبل نوعًا غير معروف");
  assert.ok(!/\bdelete\s+from\s+public\.fin_/i.test(SQL), "يوجد حذف صلب لصفوف مالية");
  assert.ok(!/\bdrop\s+table\b/i.test(SQL), "الحزمة تُسقط جدولًا");
});

test("PREFLIGHT وPOSTCHECK قراءة فقط — لا جملة كتابة واحدة", () => {
  const forbidden = /^\s*(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/im;
  assert.ok(!forbidden.test(PREFLIGHT), "PREFLIGHT يكتب");
  assert.ok(!forbidden.test(POSTCHECK), "POSTCHECK يكتب");
  assert.match(PREFLIGHT, /is_staff\(\)/, "PREFLIGHT لا يفحص الاعتمادات الإلزامية");
  assert.match(PREFLIGHT, /information_schema\.columns[\s\S]{0,200}projects/,
    "PREFLIGHT لا يقرأ اسم عمود المشروع من الكتالوج — التخمين سبق أن كلّف دورة");
});

test("ROLLBACK صادق: مرحلة تعطيل بلا فقدان، ومرحلة حذف تُسمّي ما يُفقَد", () => {
  assert.match(ROLLBACK, /\(أ\)[\s\S]{0,200}بلا فقدان بيانات/, "لا مرحلة تعطيل آمنة");
  assert.match(ROLLBACK, /سجلّ التدقيق/, "ROLLBACK لا يذكر فقدان سجلّ التدقيق");
  assert.match(ROLLBACK, /الزكاة والضريبة/, "ROLLBACK لا ينبّه إلى الالتزام النظاميّ");
  assert.match(ROLLBACK, /revoke/i, "مرحلة التعطيل لا تسحب صلاحية التنفيذ");
});

test("الـSELF-TEST يمكن أن يفشل فعلًا — لا مصيدة تجعله ينجح مهما حدث", () => {
  const i = SQL.indexOf("-- §9) SELF-TEST");
  assert.ok(i > 0, "لا قسم SELF-TEST");
  const st = SQL.slice(i);
  const raises = (st.match(/raise exception/g) || []).length;
  assert.ok(raises >= 30, `عدد الفحوص الرافعة ${raises} أقلّ من المتوقّع`);
  // لا exception when others يبتلع فحصًا (المصيدة الوحيدة المسموحة تلتقط
  // خطأ finops_money المتوقَّع ثمّ تتحقّق من نصّه — وهي تُفشِل لا تُنجِح)
  const traps = st.match(/exception\s+when\s+others\s+then\s+([\s\S]{0,60})/g) || [];
  for (const t of traps) {
    assert.match(t, /v_err\s*:=\s*SQLERRM/,
      "مصيدة في الـSELF-TEST لا تسجّل الخطأ — قد تجعل الفحص ينجح دائمًا");
  }
  assert.match(st, /if v_err not ilike '%gross_not_writable%'/,
    "فحص رفض الإجمالي لا يتحقّق من سبب الخطأ");
  // يفحص أنّ الترحيلة لم تُنشئ بيانات
  assert.match(st, /الترحيلة أنشأت/, "لا فحص لعدم إنشاء بيانات مالية");
});

test("الـSELF-TEST يستعمل pg_get_functiondef + ilike ولا يستدعي دالّة محميّة", () => {
  const st = SQL.slice(SQL.indexOf("-- §9) SELF-TEST"));
  assert.match(st, /pg_get_functiondef\(to_regprocedure\(/, "لا فحص نصّيّ لأجسام الدوالّ");
  // الاستدعاءات الحيّة الوحيدة المسموحة: مُسنَدات بلا بوّابة + دوالّ لا ترفع منعًا
  for (const f of GATED_READ_FNS) {
    assert.ok(!new RegExp(`(perform|:=)\\s*public\\.${f}\\(`).test(st),
      `الـSELF-TEST يستدعي ${f} المحميّة — auth.uid() = NULL سيُسقط الترحيلة`);
  }
  for (const f of WRITE_FNS) {
    assert.ok(!new RegExp(`(perform|:=)\\s*public\\.${f}\\(`).test(st),
      `الـSELF-TEST يستدعي دالّة الكتابة ${f} — ستُسقط الترحيلة أو تُنشئ بيانات`);
  }
});

test("مفاتيح الصلاحيات تُضاف إلى الكتالوج القائم ولا تُبنى نسخة ثانية", () => {
  const s = section("-- §1) مفاتيح الصلاحيات");
  assert.match(s, /insert into public\.permissions/i, "لا بذر في الكتالوج القائم");
  assert.match(s, /if to_regclass\('public\.permissions'\) is null/, "البذر ليس مكتشَفًا");
  assert.ok(!/create table[\s\S]{0,60}permissions/i.test(SQL), "أُنشئ كتالوج صلاحيات ثانٍ");
  for (const k of ["finance_ops.view", "finance_ops.manage", "finance_ops.approve",
    "finance_ops.view_profit", "finance_ops.manage_receivables", "finance_ops.export",
    "finance_ops.request"]) {
    assert.ok(s.includes(`'${k}'`), `المفتاح ${k} غير مبذور`);
  }
  // لا يُعاد تعريف مفاتيح finance.* الخاصّة بالمنصّة المجمَّدة
  assert.ok(!/'finance\.(view|manage|read)/.test(s),
    "الحزمة تعيد تعريف مفاتيح finance.* التي تخصّ منصّة المشاريع المجمَّدة");
});

test("المرفقات والتدقيق: التدقيق للإدارة، والمرفق لصاحبه أو للمالية", () => {
  const rls = section("-- §4) RLS");
  assert.match(rls, /fin_audit_read[\s\S]{0,200}finops_can_manage_finance\(\)/,
    "سجلّ التدقيق مقروء لغير المالك");
  assert.match(rls, /fin_attachments_read[\s\S]{0,200}uploaded_by = auth\.uid\(\)/,
    "المرفق غير مقيّد برافعه");
});

test("مراجع المشروع اختيارية ولا تفرض ترتيبًا على المنصّة", () => {
  assert.match(SQL, /if to_regclass\('public\.projects'\) is null/, "المفاتيح الخارجية غير مكتشَفة");
  assert.match(SQL, /on delete set null/, "المفتاح الخارجي يمنع حذف مشروع");
  const label = funcBody("finops_project_label");
  assert.match(label, /information_schema\.columns/, "اسم عمود المشروع مُخمَّن لا مقروء");
  assert.match(label, /project_name/, "ترتيب أسماء الأعمدة المحتملة مفقود");
});

test("★ حمولة جزئية لا تمحو عمودًا ★ — التعديل من صفّ قائمة لا يفقد بيانات", () => {
  // شاشة التعديل تُغذَّى من صفّ قائمة لا يحمل كلّ الأعمدة (القائمة تعيد اسم
  // البند لا معرّفه). بلا coalesce كان تعديل مبلغ يمسح مركز التكلفة والميزانية
  // والمورّد بصمت — فقدان بيانات مالية بلا رسالة ولا أثر.
  const EDITED = {
    finops_cost_upsert: ["category_id", "cost_center_id", "budget_id", "supplier_id", "notes"],
    finops_budget_upsert: ["cost_center_id", "notes", "fiscal_year"],
    finops_receivable_upsert: ["cost_center_id", "client_id", "notes"],
    finops_supplier_upsert: ["cr_number", "contact_name", "city", "bank_ref", "notes"],
  };
  for (const [fn, cols] of Object.entries(EDITED)) {
    const b = funcBody(fn);
    for (const c of cols) {
      assert.match(b, new RegExp(`${c}\\s*=\\s*coalesce\\(excluded\\.${c},\\s*t\\.${c}\\)`),
        `${fn}: العمود ${c} يُمحى حين تغيب قيمته عن الحمولة`);
    }
  }
  assert.match(SQL, /تمحو أعمدة غائبة عن الحمولة/,
    "الـSELF-TEST بلا حارس يمنع عودة المحو الصامت");
});

test("فحص تجاوز المتبقّي يشمل التعديل لا الإنشاء وحده", () => {
  const b = funcBody("finops_collection_record");
  assert.ok(!/v_id is null and \(m->>'amount_gross'\)/.test(b),
    "الفحص مقصور على الإنشاء — تعديل دفعة يستطيع تجاوز المستحقّ");
  assert.match(b, /v_outstanding := v_outstanding \+ v_self/,
    "التعديل يقيس المبلغ الجديد على متبقٍّ يتضمّن المبلغ القديم");
  assert.match(b, /v_owner is not null and v_owner <> v_recv/,
    "يمكن تعديل دفعة تتبع ذمّة أخرى عبر تمرير معرّفها");
  assert.match(SQL, /فحص تجاوز المتبقّي مقصور على الإنشاء/,
    "الـSELF-TEST بلا حارس لهذه الثغرة");
});

test("جدول التدقيق يستقبل من كلّ مسار حسّاس بما فيه التصدير", () => {
  assert.match(tableDef("fin_audit"), /actor_id/, "التدقيق بلا فاعل");
  assert.match(funcBody("finops_export"), /finops_log\('export'/, "التصدير غير مُدقَّق");
  assert.match(funcBody("finops_expense_decide"), /finops_log\('expense_decide'/,
    "قرار الاعتماد غير مُدقَّق");
  assert.match(funcBody("finops_expense_decide"), /'self_approved'/,
    "استثناء المالك في الاعتماد الذاتيّ غير مسجَّل — استثناء صامت");
});
