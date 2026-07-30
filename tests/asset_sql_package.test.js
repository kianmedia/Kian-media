// ════════════════════════════════════════════════════════════════════════════
// tests/asset_sql_package.test.js — عقد حزمة الـSQL نفسها.
//
// أربعة ملفّات · RUNME معامليّ وقابل لإعادة التشغيل · PREFLIGHT **يُفشل** ولا
// يكتفي بالتحذير · POSTCHECK للقراءة فقط وبمجموعة نتائج واحدة · الفحوص الذاتية
// ساكنة لا تنادي دالّة محميّة · ROLLBACK صادق ولا يُشغَّل بالخطأ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, PREFLIGHT, POSTCHECK, ROLLBACK, CODE, FILES, exists,
  stripComments, stripCommentsAndStrings, selfTest,
} = require("./asset_helpers.js");

test("الحزمة أربعة ملفّات وكلّها موجودة", () => {
  for (const [name, p] of Object.entries(FILES)) {
    assert.ok(exists(p), `${name} مفقود: ${p}`);
  }
});

test("PREFLIGHT وPOSTCHECK للقراءة فقط — لا كتابة ولا DDL", () => {
  for (const [name, src] of [["PREFLIGHT", PREFLIGHT], ["POSTCHECK", POSTCHECK]]) {
    const code = stripCommentsAndStrings(src);
    assert.doesNotMatch(code, /^\s*(insert|update|delete|truncate|grant|revoke)\b/im,
      `${name}: يحتوي كتابة`);
    assert.doesNotMatch(code, /^\s*(create|alter|drop)\s+(table|function|index|policy|trigger)/im,
      `${name}: يحتوي DDL`);
  }
});

test("★ POSTCHECK **مجموعة نتائج واحدة** — المحرّر يعرض الأخيرة فقط", () => {
  // لو كُتبت الفحوص جملًا متتالية لعُرضت الأخيرة وحدها، ولبدا الملفّ ناجحًا وهو
  // لم يُقرأ أصلًا. جملة واحدة تعني أنّ كلّ فحص يظهر في الجدول نفسه.
  const code = stripCommentsAndStrings(POSTCHECK);
  const stmts = code.split(";").filter((s) => s.trim().length > 0);
  assert.equal(stmts.length, 1,
    `POSTCHECK يُرجع ${stmts.length} مجموعة نتائج — يجب أن تكون واحدة`);
});

test("★ POSTCHECK ساكن: لا نداء لأيّ RPC محميّة", () => {
  // محرّر SQL يعمل بدور postgres وauth.uid() = NULL: نداء دالّة محميّة يرفع
  // «not authorized» فيقتل الفحص كلّه.
  const code = stripCommentsAndStrings(POSTCHECK);
  for (const fn of [
    "custody_inv_asset_cost_summary", "custody_inv_asset_utilization",
    "custody_inv_maintenance_signals", "custody_inv_reservation_calendar",
    "custody_inv_qr_scan", "custody_inv_record_meter", "custody_inv_maint_plan_due",
    "civ_can_view_assets", "civ_can_manage",
  ]) {
    assert.doesNotMatch(code, new RegExp(`(?<!')\\bpublic\\.${fn}\\s*\\((?!\\s*(uuid|jsonb|text|timestamptz|int|numeric))`, "i"),
      `POSTCHECK ينادي ${fn} فعليًّا بدل فحص جسمها`);
  }
  assert.match(code, /pg_get_functiondef/, "POSTCHECK لا يفحص الأجسام ساكنًا");
});

test("★ POSTCHECK لا يذكر جدولًا في FROM إلّا عبر to_regclass", () => {
  // PostgreSQL يحلّ أسماء الجداول وقت التحليل: ذكر جدول غائب في FROM ينهار
  // بـ42P01 ويقتل الملفّ بدل أن يُبلّغ عن الغياب.
  const code = stripCommentsAndStrings(POSTCHECK);
  const froms = [...code.matchAll(/\b(from|join)\s+public\.([a-z0-9_]+)/gi)].map((m) => m[2]);
  assert.deepEqual(froms, [], `POSTCHECK يذكر جداول مباشرةً في FROM: ${froms.join(", ")}`);
});

test("★ PREFLIGHT يُفشل ولا يحذّر — بوّابة ترفع استثناءً", () => {
  assert.match(PREFLIGHT, /raise\s+exception/i, "PREFLIGHT بلا استثناء = تحذير يُتجاهَل");
  const raises = [...PREFLIGHT.matchAll(/raise\s+exception/gi)].length;
  assert.ok(raises >= 4, `PREFLIGHT فيه ${raises} استثناء فقط — التبعيات أكثر من ذلك`);
});

test("★ PREFLIGHT يُثبت التبعيات الإلزامية بالاسم", () => {
  for (const dep of [
    "custody_inventory_assets", "custody_inventory_movements",
    "custody_inventory_assignments", "custody_inventory_reservations",
    "civ_can_manage()", "civ_set_avail(uuid)",
    "custody_audit(text,text,uuid,jsonb)", "civ_notify_managers(text,uuid,text,text)",
  ]) {
    assert.ok(PREFLIGHT.includes(dep), `PREFLIGHT لا يتحقّق من ${dep}`);
  }
});

test("★ PREFLIGHT يوقف على prodops نصف المطبَّق", () => {
  // نصف تطبيق أسوأ من الغياب: تقويم حجز ثالث لا يراه أحد بينما تبدو الشاشة مغطّاة.
  assert.match(PREFLIGHT, /prodops_asset_clash/, "PREFLIGHT لا يذكر عقد prodops");
  assert.match(PREFLIGHT, /ops_job_equipment/, "PREFLIGHT لا يفحص جدول prodops");
  const gate = /نصف مطبَّق[\s\S]{0,400}?raise exception|raise exception[\s\S]{0,400}?نصف مطبَّق/.test(PREFLIGHT);
  assert.ok(gate, "PREFLIGHT لا يرفع استثناءً على نصف التطبيق");
});

test("★ PREFLIGHT يرفض التطبيق فوق بوّابة fail-open", () => {
  assert.match(PREFLIGHT, /civ_can_manage[\s\S]{0,300}coalesce/i,
    "PREFLIGHT لا يتحقّق من تحصين civ_can_manage()");
});

test("RUNME معامليّ، بلا CONCURRENTLY، وقابل لإعادة التشغيل", () => {
  const code = stripComments(SQL);
  assert.doesNotMatch(code, /\bconcurrently\b/i, "RUNME يستعمل CONCURRENTLY (لا يعمل داخل معاملة)");
  const begins = [...code.matchAll(/^begin;/gim)].length;
  const commits = [...code.matchAll(/^commit;/gim)].length;
  assert.ok(begins > 0, "RUNME بلا معاملة");
  assert.equal(begins, commits, `معاملات غير متوازنة: ${begins} begin مقابل ${commits} commit`);
});

test("★ RUNME idempotent: كلّ إنشاء بصيغة تحتمل إعادة التشغيل", () => {
  const code = stripComments(SQL);
  const badTable = [...code.matchAll(/create\s+table\s+(?!if\s+not\s+exists)/gi)];
  assert.equal(badTable.length, 0, "create table بلا if not exists");
  const badIndex = [...code.matchAll(/create\s+(unique\s+)?index\s+(?!if\s+not\s+exists)/gi)];
  assert.equal(badIndex.length, 0, "create index بلا if not exists");
  const badFn = [...code.matchAll(/create\s+function\s/gi)];
  assert.equal(badFn.length, 0, "create function بلا or replace");
  // كلّ create trigger مسبوق بـdrop trigger if exists
  const triggers = [...code.matchAll(/create\s+trigger\s+([a-z0-9_]+)/gi)].map((m) => m[1]);
  for (const t of triggers) {
    assert.ok(new RegExp(`drop\\s+trigger\\s+if\\s+exists\\s+${t}\\b`, "i").test(code),
      `المُشغِّل ${t} يُنشأ بلا drop if exists — إعادة التشغيل تفشل`);
  }
});

test("★ كلّ add constraint محروس بفحص وجود (لا add constraint if not exists في PostgreSQL)", () => {
  const code = stripComments(SQL);
  const adds = [...code.matchAll(/add\s+constraint\s+([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.ok(adds.length > 0, "لا قيود مضافة أصلًا");
  for (const c of adds) {
    assert.ok(new RegExp(`conname\\s*=\\s*'${c}'`, "i").test(code),
      `القيد ${c} يُضاف بلا فحص pg_constraint — إعادة التشغيل تفشل بـ42710`);
  }
});

test("★ قيد نافذة الحجز NOT VALID — الجدول حيّ ولا يُعاد كتابة تاريخه", () => {
  // التحقّق الرجعيّ على جدول حيّ كان سيُفشل الترحيلة كلّها بسبب حجز **ملغى**
  // قديم بنافذة مقلوبة، أو يدفع إلى «تصحيح» تاريخ لا يخصّنا.
  assert.match(CODE, /add constraint civ_resv_window_chk[\s\S]{0,200}not valid/i,
    "قيد نافذة الحجز يتحقّق رجعيًّا من صفوف حيّة");
});

test("★ SELF-TEST ساكن بالكامل — لا نداء دالّة محميّة", () => {
  const st = selfTest();
  assert.ok(st.length > 0, "لا كتلة SELF-TEST");
  assert.match(st, /pg_get_functiondef/, "SELF-TEST لا يفحص الأجسام");
  // نداء فعليّ لدالّة محميّة داخل SELF-TEST يرفع «not authorized» ويقتل الترحيلة.
  assert.doesNotMatch(st, /(select|perform)\s+public\.custody_inv_[a-z_]+\s*\(\s*(null|'|[a-z0-9]{4})/i,
    "SELF-TEST ينادي RPC محميّة — auth.uid() = NULL في المحرّر");
});

test("★ SELF-TEST بلا مصيدة شاملة تجعل الفحص ينجح دائمًا", () => {
  const st = selfTest();
  assert.doesNotMatch(st, /exception\s+when\s+others\s+then\s+null/i,
    "SELF-TEST يبتلع أخطاءه فينجح مهما حدث");
});

test("SELF-TEST يقارن بـilike لا بمطابقة حسّاسة (المُفكِّك يرفع حالة COALESCE)", () => {
  const st = selfTest();
  assert.match(st, /ilike/i, "SELF-TEST يستعمل مطابقة حسّاسة لحالة الأحرف");
  assert.doesNotMatch(st, /like\s+'%COALESCE%'/, "مطابقة COALESCE بحالة ثابتة تنكسر مع المُفكِّك");
});

test("★ ROLLBACK صادق: يقول بصراحة إنّ الحذف يمحو تاريخ عهدة حقيقيًّا", () => {
  assert.match(ROLLBACK, /فقدان بيانات|يُتلف|تُمحى|محو/, "ROLLBACK يقدّم نفسه كقابل للعكس");
  assert.match(ROLLBACK, /meter_readings/, "ROLLBACK لا يذكر أثر حذف دفتر الاستخدام");
  assert.match(ROLLBACK, /qr_token/, "ROLLBACK لا يحذّر من إبطال الملصقات المطبوعة");
});

test("★ الأقسام المتلفة في ROLLBACK معطَّلة بالتعليق (لا تُشغَّل بلصقة واحدة)", () => {
  const code = stripComments(ROLLBACK);
  assert.doesNotMatch(code, /drop\s+table\s+if\s+exists\s+public\.custody_inventory_meter_readings/i,
    "حذف دفتر الاستخدام فعّال — لصقة واحدة تمحو كلّ ساعات التشغيل");
  assert.doesNotMatch(code, /drop\s+table\s+if\s+exists\s+public\.custody_inventory_maintenance_plans/i,
    "حذف خطط الصيانة فعّال");
  assert.doesNotMatch(code, /alter\s+table\s+public\.custody_inventory_assets\s+drop\s+column/i,
    "حذف أعمدة جدول العهدة الحيّ فعّال — هذا يمحو سجلّ تخريد حقيقيًّا");
});

test("★ ROLLBACK لا يحذف أيّ بوّابة أو دالّة قائمة لا تخصّ الحزمة", () => {
  const code = stripComments(ROLLBACK);
  for (const fn of [
    "civ_can_manage()", "civ_can_finance()", "civ_can_delete_asset()", "civ_can_admin()",
    "civ_is_employee()", "civ_set_avail(uuid)", "civ_gen_no(text)",
    "custody_inv_admin_create_reservation(jsonb)", "custody_inv_resolve_qr(uuid)",
    "custody_inv_admin_reissue_qr(uuid,text)",
  ]) {
    assert.doesNotMatch(code, new RegExp(`drop\\s+function\\s+if\\s+exists\\s+public\\.${fn.replace(/[()]/g, "\\$&")}`, "i"),
      `ROLLBACK يحذف ${fn} — وهي قائمة قبل الحزمة ويناديها ~١٢٠ موضع`);
  }
});

test("ROLLBACK يُبقي فهرس تفرّد رمز QR", () => {
  const code = stripComments(ROLLBACK);
  assert.doesNotMatch(code, /drop\s+index\s+if\s+exists\s+public\.uq_civ_asset_qr_token/i,
    "حذف الفهرس يسمح برمزين متطابقين على معدّتين");
});

test("الحزمة تُنهي بإعادة تحميل مخطّط PostgREST", () => {
  assert.match(SQL, /notify pgrst, 'reload schema'/i,
    "بلا reload تبقى الدوالّ الجديدة PGRST202 في الواجهة");
});
