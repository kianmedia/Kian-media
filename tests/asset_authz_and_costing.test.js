// ════════════════════════════════════════════════════════════════════════════
// tests/asset_authz_and_costing.test.js — المُسنَدات الستّة والفصل المالي.
//
// قاعدتان لا تُخرقان:
//   ١) كلّ مُسنَد يعيد boolean **صريحًا** على كلّ مسار. مُسنَد يعيد NULL يجعل
//      «if not gate() then raise» يُتخطّى بصمت — وهو العطل نفسه الذي أُصلح في
//      civ_can_manage() عبر authz_fixC.
//   ٢) التكلفة مالكيّة، والعمليات لا ترى مالًا، ولا شيء يلمس جدولًا ماليًّا
//      (لا إعادة فتح لاستنتاج الربح).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { CODE, funcBody, PREDICATES, POSTCHECK, stripComments, SQL } = require("./asset_helpers.js");

test("★ المُسنَدات الستّة كلّها مُعرَّفة بالأسماء المتّفق عليها", () => {
  for (const p of PREDICATES) {
    assert.ok(funcBody(p) || new RegExp(`create or replace function public\\.${p}\\s*\\(`).test(CODE),
      `المُسنَد ${p} غير معرَّف`);
  }
});

test("★★★ لا مُسنَد يعيد NULL — coalesce على كلّ مسار", () => {
  for (const p of PREDICATES) {
    const body = funcBody(p);
    assert.ok(body, `${p} غير موجود`);
    assert.match(body, /coalesce/i,
      `${p} قد يعيد NULL — «if not ${p}()» تُتخطّى بصمت فيمضي الـRPC بلا صلاحية`);
  }
});

test("★ كلّ مُسنَد SECURITY DEFINER بمسار بحث مثبَّت", () => {
  for (const p of PREDICATES) {
    const body = funcBody(p);
    assert.match(body, /security definer/i, `${p} بلا SECURITY DEFINER`);
    assert.match(body, /set search_path\s*=\s*public/i, `${p} بلا مسار بحث مثبَّت`);
  }
});

test("★★ المُسنَدات تُشتقّ من البوّابة العريضة ولا توسّعها", () => {
  // من يملك manage اليوم لا يفقد شيئًا؛ ومن يُمنَح مفتاحًا دقيقًا لا يرث الباقي.
  for (const p of PREDICATES.filter((x) => x !== "civ_can_view_asset_sensitive_costs")) {
    assert.match(funcBody(p), /civ_can_manage/,
      `${p} لا يشتقّ من البوّابة القائمة — قد يمنح صلاحية لا يملكها المدير`);
  }
});

test("★★★ التكلفة الحسّاسة لا تُمنَح بترقية مهنة", () => {
  const body = funcBody("civ_can_view_asset_sensitive_costs");
  assert.match(body, /is_owner/i, "لا فرع مالك");
  assert.match(body, /civ_can_finance/i, "لا فرع مالية");
  assert.doesNotMatch(body, /civ_perm|emp_has_permission/i,
    "سطح التكلفة يُفتح بمفتاح صلاحية دقيق — يجب أن يبقى دور مالك/مالية معلنًا");
});

test("★ civ_can_finance() تُلَفّ هنا ولا تُعاد كتابتها هناك", () => {
  // civ_can_finance() قد تعيد NULL في مصدرها؛ لفّها هنا آمن، وإعادة تعريفها
  // هناك تكسر مواضع نداء خارج هذه الحزمة.
  const body = funcBody("civ_can_view_asset_sensitive_costs");
  assert.match(body, /coalesce\s*\(\s*v\s*,\s*false\s*\)/i, "نتيجة civ_can_finance() غير ملفوفة");
  assert.doesNotMatch(CODE, /create or replace function public\.civ_can_finance/i,
    "الحزمة تُعيد تعريف civ_can_finance()");
});

test("★ جسر الصلاحيات الدقيق fail-closed عند غياب الكتالوج", () => {
  const body = funcBody("civ_perm");
  assert.match(body, /to_regprocedure\('public\.emp_has_permission\(text\)'\)\s*is null[\s\S]{0,60}return false/i,
    "غياب المُحلِّل لا يُغلق الباب — قد يمنح أو ينهار");
  assert.match(body, /exception when others then return false/i, "المصيدة لا تُغلق الباب");
});

test("★★ ملخّص التكلفة مالكيّ حصرًا", () => {
  const body = funcBody("custody_inv_asset_cost_summary");
  assert.match(body, /if not public\.civ_can_view_asset_sensitive_costs\(\)/,
    "ملخّص التكلفة بلا بوّابة حسّاسة");
  assert.match(body, /errcode\s*=\s*'42501'/, "الرفض بلا رمز صلاحية مميّز");
});

test("★★★ ملخّص التكلفة لا يلمس أيّ جدول مالي — لا استنتاج ربح", () => {
  const body = funcBody("custody_inv_asset_cost_summary");
  for (const t of ["fin_", "invoices", "quotes", "opportunities", "zoho", "sq_", "crm_"]) {
    assert.ok(!new RegExp(`public\\.${t}`, "i").test(body),
      `ملخّص التكلفة يقرأ public.${t}* — هذا يعيد فتح استنتاج الربح`);
  }
  assert.match(body, /'finance_tables',\s*false/, "الملخّص لا يُصرّح بأنّه لا يلمس المالية");
});

test("★★ سطح الاستغلال التشغيليّ خالٍ من المال تمامًا", () => {
  const body = funcBody("custody_inv_asset_utilization");
  for (const w of ["purchase_price", "current_value", "book_value", "salvage_value", "cost"]) {
    assert.ok(!new RegExp(w, "i").test(body),
      `دالّة الاستغلال تكشف ${w} — العمليات ترى التوافر والحالة والصيانة والعودة المتوقّعة، ولا ترى مالًا`);
  }
  assert.match(body, /'contains_financials',\s*false/, "لا تُعلن خلوّها من المال للواجهة");
});

test("★ العمليات ترى ما تحتاجه فعلًا: توافر وحالة وصيانة وموعد عودة", () => {
  const util = funcBody("custody_inv_asset_utilization");
  assert.match(util, /days_out|utilization_pct/, "لا مؤشّر استغلال تشغيليّ");
  const scan = funcBody("custody_inv_qr_scan");
  assert.match(scan, /expected_return_at/, "المسح لا يُظهر موعد العودة المتوقّع");
  assert.match(scan, /open_maintenance/, "المسح لا يُظهر حالة الصيانة");
});

test("★ لا صفر يقف مقام «المصدر غير مفعّل»", () => {
  const body = funcBody("custody_inv_asset_cost_summary");
  assert.match(body, /source_available/, "الملخّص لا يُعلن توفّر مصادره");
  assert.match(body, /case when v_rental_src then[\s\S]{0,80}else null end/i,
    "غياب مصدر الإيجار يُعرض صفرًا — الصفر يكذب بقول «لا تكلفة»");
});

test("★ الإهلاك يحترم قيمة الخردة ولا يتجاوز الأصل", () => {
  const body = funcBody("custody_inv_asset_cost_summary");
  assert.match(body, /salvage_value/, "الإهلاك يتجاهل قيمة الخردة");
  assert.match(body, /least\s*\(/, "الإهلاك المتراكم قد يتجاوز قيمة الأصل");
});

test("★★ لا anon ولا service_role في أيّ مكان من الحزمة", () => {
  const code = stripComments(SQL);
  // ⚠️ شكل جملة GRANT حقيقية، لا مجرّد تجاور الكلمتين. الصيغة السابقة طابقت
  //    **شرحًا** يقول إنّ «grant … to authenticated لا يُلغي PUBLIC، وanon يرث»
  //    — أي جملةً تشرح الخطر فأُدينت به. سابع ظهور لصنف «طابق اسمًا لا شكلًا»
  //    في هذا البرنامج. واشتراط `on function|table|schema` بين grant وto يجعل
  //    النثر عاجزًا عن اتّخاذ الشكل، بينما المنحة الحقيقية تتّخذه دائمًا.
  assert.doesNotMatch(code,
    /\bgrant\b[a-z, ]{0,40}\bon\s+(function|table|schema|sequence|all)\b[^;]{0,200}\bto\b[^;]{0,80}\banon\b/i,
    "منح صلاحية لـanon");
  assert.doesNotMatch(code, /service_role/i, "ذكر service_role");
  assert.match(code, /from public,\s*anon/i, "لا سحب صريح للصلاحيات من anon/public");
});

test("★ كلّ دالّة عامّة تُسحب من public/anon ثمّ تُمنَح لـauthenticated وحدها", () => {
  const code = stripComments(SQL);
  const revoked = code.includes("revoke execute on function");
  const granted = /grant execute on function[\s\S]{0,4000}to authenticated/i.test(code);
  assert.ok(revoked && granted, "نمط السحب ثمّ المنح غير مكتمل");
});

test("★★ الحمولة العامّة للـQR لا تُمنَح لأحد — تمرّ عبر المسح", () => {
  const code = stripComments(SQL);
  assert.match(code,
    /revoke execute on function public\.custody_inv_qr_public_payload\(uuid\) from public, anon, authenticated/i,
    "الحمولة العامّة قابلة للنداء مباشرةً فتتجاوز تحديد المعدّل والتدقيق");
});

test("★ كلّ RPC يكتب يبدأ بفحص صلاحية صريح", () => {
  for (const fn of [
    "custody_inv_admin_create_reservation_v2", "custody_inv_fulfil_reservation",
    "custody_inv_expire_reservations", "custody_inv_admin_revoke_qr",
    "custody_inv_record_meter", "custody_inv_reverse_meter",
    "custody_inv_maint_plan_upsert", "custody_inv_maint_plan_archive",
    "custody_inv_maint_close_with_inspection", "custody_inv_post_closure_correction",
  ]) {
    const body = funcBody(fn);
    assert.ok(body, `${fn} غير موجود`);
    assert.match(body, /if not public\.civ_can_[a-z_]+\(\)\s*then\s*raise exception/i,
      `${fn} بلا فحص صلاحية في أوّل سطر`);
  }
});

test("★ كلّ كتابة حسّاسة مُدقَّقة", () => {
  for (const fn of [
    "custody_inv_admin_create_reservation_v2", "custody_inv_fulfil_reservation",
    "custody_inv_admin_revoke_qr", "custody_inv_record_meter", "custody_inv_reverse_meter",
    "custody_inv_maint_plan_upsert", "custody_inv_maint_plan_archive",
    "custody_inv_maint_close_with_inspection", "custody_inv_post_closure_correction",
  ]) {
    assert.match(funcBody(fn), /custody_audit/, `${fn} بلا تدقيق`);
  }
});

test("★ RLS على الجدولين الجديدين: قراءة فقط، وكلّ كتابة عبر RPC", () => {
  const code = stripComments(SQL);
  for (const t of ["custody_inventory_maintenance_plans", "custody_inventory_meter_readings"]) {
    assert.match(code, new RegExp(`alter table public\\.${t}\\s+enable row level security`, "i"),
      `${t} بلا RLS`);
  }
  const policies = [...code.matchAll(/create policy\s+\w+\s+on\s+public\.(custody_inventory_(?:maintenance_plans|meter_readings))\s+for\s+(\w+)/gi)];
  assert.ok(policies.length >= 2, "لا سياسات على الجدولين");
  for (const m of policies) {
    assert.equal(m[2].toLowerCase(), "select", `سياسة كتابة مباشرة على ${m[1]} تتجاوز الـRPC`);
  }
});

test("★ POSTCHECK يحرس الفصل المالي بعد التطبيق", () => {
  assert.match(POSTCHECK, /civ_can_view_asset_sensitive_costs/, "POSTCHECK لا يفحص بوّابة التكلفة");
  assert.match(POSTCHECK, /contains_financials/, "POSTCHECK لا يفحص خلوّ سطح العمليات من المال");
});

// ── مضافة في التحقّق الخصوميّ النهائي ──────────────────────────────────────

test("★★★ 23P01 يُصنَّف تعارضًا في المُصنِّف الأساسي، لا «unknown» ولا ترحيلة", () => {
  // كان assetIntelligence.ts يصنّفه محليًّا فقط، بينما pgClassify الأساسيّة —
  // التي تستعملها كلّ الوحدات الأخرى — تُسقطه في «unknown» فتقول «حاول مرة
  // أخرى»: نصيحةٌ مضمونة الفشل لأنّ الحجز المتعارض سيبقى قائمًا.
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "lib", "portal", "pgerror.ts"), "utf8");
  // النوع نفسه (وليس PgVerdict وحده — الاثنان يحملان الكلمة نفسها).
  // القصّ حتى النوع التالي — لا حتى أوّل «;» (فواصل الجمل داخل التعليقات تقصّه مبكرًا).
  const kinds = /export type PgErrorKind =[\s\S]*?export type PgVerdict/.exec(src);
  assert.ok(kinds && /\|\s*"conflict"/.test(kinds[0]), "PgErrorKind بلا حالة conflict");
  // وفرعُ التصنيف الفعليّ، لا مجرّد تعريف نوع لا يصله شيء.
  assert.match(src, /return build\("conflict",\s*"conflict",\s*"23P01"\)/,
    "لا فرع تصنيف يُنتج conflict — النوع معرَّف ولا أحد يصله");
  assert.match(src, /23p01/i, "pgerror.ts لا يعرف 23P01 إطلاقًا");
  assert.match(src, /export function pgIsConflict/, "لا مساعد pgIsConflict");
  // الحكم الحصريّ: conflict ليس من حالات «الترحيل معلّق».
  const mig = /export function pgIsMigrationPending[\s\S]*?\n}/.exec(src);
  assert.ok(mig, "pgIsMigrationPending غير موجودة");
  assert.ok(!/conflict/.test(mig[0]),
    "pgIsMigrationPending تشمل conflict — تعارض حجز سيُعرض «الترحيلة غير مطبّقة»");
  // ورسالة عربية مستقلّة لا تقول «حاول مرة أخرى».
  const msg = /case "conflict":\s*\n\s*return `([^`]*)`/.exec(src);
  assert.ok(msg, "لا رسالة عربية مخصّصة للتعارض");
  assert.ok(!/حاول مرة أخرى/.test(msg[1]),
    "رسالة التعارض تنصح بإعادة المحاولة — وإعادة المحاولة دون تغيير سترفَض مجددًا");
});

test("★★★ مصفوفة الأدوار لا تدّعي ضبطًا غير قائم على أعمدة السعر", () => {
  // civ_assets_read = using(civ_can_manage()) + grant select على كلّ الأعمدة،
  // وSEL_ASSET يقرأ purchase_price فعلًا. أيّ ⛔ لمدير العهدة هنا كذبة موثّقة.
  const fs = require("node:fs"), path = require("node:path");
  const matrix = fs.readFileSync(
    path.join(__dirname, "..", "docs", "ASSET_INTELLIGENCE_ROLE_MATRIX.md"), "utf8");
  assert.match(matrix, /ثغرة معلنة/,
    "المصفوفة لا تعلن ثغرة القراءة المباشرة لأعمدة السعر");
  assert.match(matrix, /disposal_proceeds/,
    "المصفوفة لا تذكر العمود المالي الجديد disposal_proceeds");
  // ولا تزال الدالّة الحسّاسة هي البوّابة الوحيدة لأيّ رقم مالي مشتقّ.
  const body = funcBody("custody_inv_asset_cost_summary");
  assert.match(body, /civ_can_view_asset_sensitive_costs/,
    "ملخّص التكلفة بلا بوّابة — استنتاج الربح يُعاد فتحه");
  // والادّعاء الحقيقي: SEL_ASSET فعلًا يقرأ السعر، فالثغرة موصوفة لا متخيَّلة.
  const sel = fs.readFileSync(
    path.join(__dirname, "..", "lib", "portal", "custodyInventory.ts"), "utf8");
  assert.match(sel, /SEL_ASSET[\s\S]{0,600}purchase_price/,
    "إن لم يعد الكونسول يقرأ purchase_price فأغلِق الثغرة بمنح على مستوى الأعمدة وحدّث المصفوفة");
});
