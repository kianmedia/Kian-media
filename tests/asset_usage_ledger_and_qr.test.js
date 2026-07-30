// ════════════════════════════════════════════════════════════════════════════
// tests/asset_usage_ledger_and_qr.test.js — الدفتر الملحق ورمز الاستجابة.
//
// دفتر الاستخدام ملحق كدفتر الائتمان تمامًا: UPDATE وDELETE وTRUNCATE ممنوعة
// بمُشغِّلات، والتصحيح **بعكس القيد** لا بتعديله، ومفتاح تعطيل التكرار يحمي من
// إعادة الإرسال ومن تقييد القراءة على الأصل الخطأ.
//
// وQR: رمز غير قابل للتخمين، حمولة عامّة فقيرة عمدًا، تسجيل دخول مطلوب في V1،
// تحديد معدّل، إلغاء صريح، تدقيق على المسح الحسّاس، وبديل بحث حين يتلف الرمز.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODE, SQL, POSTCHECK, funcBody, selfTest, METER_TYPES, stripComments, exists, read,
} = require("./asset_helpers.js");

// ─── دفتر الاستخدام ─────────────────────────────────────────────────────────

test("★★★ الدفتر ملحق: ثلاثة مُشغِّلات تمنع UPDATE وDELETE وTRUNCATE", () => {
  for (const [op, level] of [["update", "for each row"], ["delete", "for each row"], ["truncate", "for each statement"]]) {
    const re = new RegExp(
      `create trigger trg_civ_meter_no_${op}\\s+before ${op}\\s+on public\\.custody_inventory_meter_readings\\s+${level}`, "i");
    assert.match(CODE, re, `لا مُشغِّل يمنع ${op.toUpperCase()} — الدفتر يفقد صفته الوحيدة`);
  }
  assert.match(funcBody("civ_meter_block_write"), /raise exception/i, "المُشغِّل لا يرفع استثناءً");
});

test("★★ التصحيح بعكس القيد فقط — لا تعديل ولا حذف", () => {
  const rev = funcBody("custody_inv_reverse_meter");
  assert.match(rev, /entry_type <> 'reading'[\s\S]{0,80}only_readings_are_reversible/,
    "يمكن عكس عكسٍ — سلسلة لا تنتهي");
  assert.match(rev, /already_reversed/, "يمكن عكس القراءة مرّتين فتُخصم القيمة مرّتين");
  assert.match(rev, /-1 \* r\.value/, "العكس لا يعكس القيمة");
  assert.match(rev, /reverses_reading_id/, "العكس بلا مرجع — ليس تصحيحًا بل قيدًا جديدًا");
});

test("★★ قيد قاعديّ: عكسٌ بلا مرجع، وقراءةٌ بمرجع عكس — كلاهما مرفوض", () => {
  assert.match(CODE, /constraint civ_meter_reversal_chk check \(\s*\(entry_type = 'reversal' and reverses_reading_id is not null\)/,
    "لا قيد يربط نوع القيد بمرجعه");
  assert.match(CODE, /create unique index if not exists uq_civ_meter_one_reversal/,
    "لا فهرس يمنع عكسين لقراءة واحدة");
});

test("★★★ مفتاح تعطيل التكرار فريد **عالميًّا** — حماية عبر-الأصول", () => {
  // مفتاح فريد لكلّ أصل كان يسمح بأن تُقيَّد إعادة الإرسال على الأصل الخطأ بصمت.
  assert.match(CODE,
    /create unique index if not exists uq_civ_meter_idem\s+on public\.custody_inventory_meter_readings\(idempotency_key\)/,
    "المفتاح غير فريد عالميًّا");
  const body = funcBody("custody_inv_record_meter");
  assert.match(body, /ex\.asset_id = v_asset and ex\.meter_type = v_type and ex\.value = v_val/,
    "إعادة الإرسال لا تُقارَن بالأصل والنوع والقيمة");
  assert.match(body, /civ_meter_idempotency_conflict/,
    "المفتاح المستعمل لأصل آخر يمرّ بصمت");
  assert.match(body, /'duplicate', true/, "إعادة الإرسال نفسها لا تُعيد الصفّ نفسه");
});

test("★ أنواع العدّادات المطلوبة كلّها مدعومة", () => {
  for (const m of METER_TYPES) {
    assert.ok(CODE.includes(`'${m}'`), `نوع العدّاد ${m} غير مدعوم`);
  }
  assert.match(CODE, /constraint civ_meter_custom_chk/,
    "عدّاد custom بلا تسمية — رقم بلا وحدة");
});

test("★ المجاميع تُسقط القيد المعكوس وعَكسَه معًا", () => {
  const body = funcBody("custody_inv_asset_meter_totals");
  assert.match(body, /entry_type = 'reading'/, "المجموع يحتسب قيود العكس كقراءات");
  assert.match(body, /not exists \(select 1 from public\.custody_inventory_meter_readings x\s*\n?\s*where x\.reverses_reading_id = m\.id\)/,
    "القراءة المعكوسة ما زالت تُحتسب");
});

test("★ الدفتر يربط القراءة بمصدرها: عهدة وصيانة وأمر تشغيل", () => {
  for (const c of ["assignment_id", "maintenance_id", "job_reference", "recorded_by", "source"]) {
    assert.ok(CODE.includes(c), `الدفتر بلا ${c} — قراءة بلا سياق`);
  }
});

// ─── QR ────────────────────────────────────────────────────────────────────

test("★★ رمز غير قابل للتخمين وفريد", () => {
  assert.match(CODE, /qr_token = gen_random_uuid\(\) where qr_token is null/,
    "لا توليد لرمز عشوائيّ");
  assert.match(CODE, /create unique index if not exists uq_civ_asset_qr_token/,
    "الرمز غير فريد — معدّتان بالرمز نفسه");
  assert.doesNotMatch(CODE, /qr_token\s*=\s*(asset_code|id::text|serial)/i,
    "الرمز مشتقّ من قيمة قابلة للتخمين");
});

test("★★★ الحمولة العامّة فقيرة عمدًا: لا تكلفة ولا موظّف ولا مسار تخزين ولا معرّف", () => {
  const body = funcBody("custody_inv_qr_public_payload");
  for (const w of ["purchase_price", "current_value", "book_value", "file_path",
    "employee_user_id", "auth.users", "supplier_name", "invoice_number"]) {
    assert.ok(!new RegExp(w.replace(".", "\\."), "i").test(body),
      `الحمولة العامّة تحمل ${w} — الملصق قد يراه غريب`);
  }
  assert.doesNotMatch(body, /'asset_id'/, "الحمولة تحمل معرّفًا — يُستَغَلّ للتعداد");
});

test("★★ الحمولة العامّة لا تُنادى مباشرةً — تمرّ عبر المسح (معدّل + تدقيق)", () => {
  assert.match(stripComments(SQL),
    /revoke execute on function public\.custody_inv_qr_public_payload\(uuid\) from public, anon, authenticated/i,
    "الحمولة قابلة للنداء المباشر فتتجاوز الحدّ والتسجيل");
});

test("★★★ V1: تسجيل الدخول مطلوب — لا بحث مجهول الهوية", () => {
  const body = funcBody("custody_inv_qr_scan");
  assert.match(body, /if not coalesce\(public\.is_staff\(\), false\)/,
    "المسح لا يشترط جلسة موظّف، أو يشترطها بتعبير قد يعيد NULL");
  assert.match(body, /errcode = '42501'/, "الرفض بلا رمز صلاحية");
});

test("★★ تحديد المعدّل مقيس من سجلّ قائم، وfail-closed عند الغموض", () => {
  const rate = funcBody("civ_qr_rate_ok");
  assert.match(rate, /custody_qr_events/, "الحدّ يُقاس من جدول عدّادات جديد بدل السجلّ القائم");
  assert.match(rate, /auth\.uid\(\) is null then return false/, "جلسة مجهولة تمرّ");
  assert.match(rate, /exception when others then return false/, "غموض العدّاد يفتح الباب");
  assert.match(funcBody("custody_inv_qr_scan"), /civ_qr_rate_ok/, "المسح بلا تحديد معدّل");
});

test("★★ الإلغاء استراتيجية قائمة: يُبطل الرمز ويُسجَّل ويُدقَّق", () => {
  const rev = funcBody("custody_inv_admin_revoke_qr");
  assert.match(rev, /qr_status = 'revoked'/, "الإلغاء لا يغيّر حالة الرمز");
  assert.match(rev, /custody_qr_events/, "الإلغاء غير مسجّل في سجلّ QR");
  assert.match(rev, /custody_audit/, "الإلغاء بلا تدقيق");
  assert.match(rev, /reason_required_min_5/, "إلغاء بلا سبب");
  assert.match(funcBody("custody_inv_qr_scan"), /qr_revoked/, "المسح لا يحترم الإلغاء");
});

test("★ إعادة الإصدار تُبطل السابق — الدالّة القائمة تُفحَص ولا تُعاد كتابتها", () => {
  assert.doesNotMatch(CODE, /create or replace function public\.custody_inv_admin_reissue_qr/i,
    "الحزمة تُعيد كتابة إعادة الإصدار القائمة");
  assert.match(CODE, /custody_inv_admin_reissue_qr[\s\S]{0,400}old_token/,
    "SELF-TEST لا يتحقّق من أنّ إعادة الإصدار تُبطل الرمز السابق");
});

test("★★ التدقيق على المسح الحسّاس فقط — لا ضجيج على كلّ مسح تشغيليّ", () => {
  const body = funcBody("custody_inv_qr_scan");
  assert.match(body, /if v_level = 'manage' then[\s\S]{0,200}custody_audit/,
    "التدقيق غير مشروط بمستوى الوصول");
  assert.match(body, /qr_scan_unknown_token/, "مسح رمز مجهول لا يُسجَّل — تعدادٌ غير مرئيّ");
});

test("★★ تفصيل المسح حسب الدور: عامّ ثمّ تشغيليّ ثمّ إدارة", () => {
  const body = funcBody("custody_inv_qr_scan");
  for (const lvl of ["public", "operations", "manage"]) {
    assert.ok(body.includes(`'${lvl}'`), `مستوى ${lvl} غير موجود`);
  }
  assert.match(body, /if public\.civ_can_view_assets\(\)/, "التفصيل التشغيليّ بلا بوّابة");
  // ولا شيء ماليّ في أيّ مستوى.
  for (const w of ["purchase_price", "current_value", "book_value"]) {
    assert.ok(!new RegExp(w, "i").test(body), `المسح يكشف ${w}`);
  }
});

test("★ بديل بحث حين يتلف الرمز", () => {
  const body = funcBody("custody_inv_lookup_asset");
  assert.match(body, /asset_code ilike/, "البحث لا يغطّي كود الأصل");
  assert.match(body, /serial_number ilike/, "البحث لا يغطّي الرقم التسلسليّ");
  assert.match(body, /barcode ilike/, "البحث لا يغطّي الباركود");
  assert.match(body, /query_too_short/, "بحث بحرف واحد يسحب الكتالوج كلّه");
  assert.match(body, /civ_can_view_assets/, "البديل بلا بوّابة");
  assert.match(body, /custody_audit/, "البديل بلا تدقيق");
});

test("★★ توليد الرموز في الواجهة بمكتبة محلّية — لا خدمة QR خارجية", () => {
  const pkg = JSON.parse(read("package.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(deps.qrcode, "لا مكتبة QR محلّية في التبعيات");
  const ui = "components/portal/custody-inventory/CustodyQrLabels.tsx";
  assert.ok(exists(ui), "شاشة الملصقات غائبة");
  const src = read(ui);
  assert.doesNotMatch(src, /https?:\/\/[^\s"']*(qrserver|chart\.googleapis|qrickit|goqr)/i,
    "الواجهة تولّد الرمز عبر خدمة خارجية — تسريب كود الأصل إلى طرف ثالث");
  assert.match(src, /print/i, "لا عرض قابل للطباعة");

  // ★ التوليد الفعليّ ليس في الشاشة بل في lib/qr/qr.ts. فحص الشاشة وحدها كان
  //   يمرّ حتّى لو جلبت الوحدةُ الصورةَ من خدمة خارجية — وهو بالضبط التسريب
  //   الذي يمنعه العقد. نفحص وحدة التوليد نفسها.
  const gen = "lib/qr/qr.ts";
  assert.ok(exists(gen), "وحدة توليد QR غائبة");
  const gsrc = read(gen);
  assert.match(gsrc, /from ["']qrcode["']/,
    "وحدة التوليد لا تستورد المكتبة المحلّية");
  assert.match(gsrc, /toDataURL/, "لا توليد محلّي فعليّ للصورة");
  assert.doesNotMatch(gsrc, /https?:\/\/[^\s"']*(qrserver|chart\.googleapis|qrickit|goqr)/i,
    "وحدة التوليد تنادي خدمة QR خارجية");
  assert.doesNotMatch(gsrc, /fetch\s*\(/,
    "وحدة التوليد تجلب الرمز عبر الشبكة بدل توليده محلّيًّا");
});

// ─── النمط المطلق: الصفر الصامت ─────────────────────────────────────────────
// العدّاد يُسجَّل بنمطين. increment زيادة لكلّ جلسة، وabsolute قراءة تراكمية من
// الجهاز (عدّاد غالق ٤٥٠٠٠). أوّل نسخة من الحزمة صفّت المستهلكين على
// reading_mode = 'increment'، فكانت الأصول المقروءة بعدّاد مطلق تُبلّغ عن
// استخدام **صفر** بثقة: لا يحين استحقاق صيانة بالاستخدام أبدًا، ولا إشارة
// استخدام مرتفع، وتكلفة الساعة تقسم على صفر ساعة. هذه الاختبارات تمنع عودته.

test("★★★ النمط المطلق محسوب — لا مستهلك يصفّي increment وحده", () => {
  for (const fn of [
    "custody_inv_asset_meter_totals",
    "custody_inv_maint_plan_due",
    "custody_inv_maintenance_signals",
  ]) {
    const body = funcBody(fn);
    assert.doesNotMatch(
      body, /reading_mode\s*=\s*'increment'/i,
      `${fn} تصفّي النمط increment ⇒ الأصل المقروء بعدّاد مطلق يُبلّغ عن صفر بصمت`);
    assert.match(
      body, /civ_meter_total|civ_meter_usage_between/i,
      `${fn} لا تشتقّ العدّاد من المساعد الموحّد`);
  }
});

test("★★ civ_meter_total: آخر قراءة مطلقة + الزيادات بعدها فقط (لا مضاعفة)", () => {
  const body = funcBody("civ_meter_total");
  assert.match(body, /reading_mode\s*=\s*'absolute'/i, "لا يتعرّف على القراءة المطلقة");
  assert.match(body, /order by[\s\S]{0,60}recorded_at desc/i, "لا يأخذ **آخر** قراءة مطلقة");
  assert.match(body, /recorded_at\s*>\s*\(\s*select[\s\S]{0,60}anchor/i,
    "يجمع الزيادات السابقة للقراءة المطلقة ⇒ مضاعفة");
  assert.match(body, /reverses_reading_id/, "لا يستبعد القيود المعكوسة");
});

test("★★ civ_meter_usage_between: مرجع قبل النافذة وإلّا أوّل قراءة داخلها", () => {
  const body = funcBody("civ_meter_usage_between");
  assert.match(body, /recorded_at\s*<=\s*p_from/i, "لا يبحث عن مرجع قبل النافذة");
  assert.match(body, /order by[\s\S]{0,60}recorded_at asc/i,
    "لا يسقط إلى أوّل قراءة داخل النافذة ⇒ أوّل ربط جهاز يطلق إشارة استخدام مرتفع كاذبة");
  assert.match(body, /greatest\s*\(\s*0\s*,/i, "فرق سالب قد يتسرّب (استبدال جهاز)");
});

test("★ المساعدان داخليّان — لا يُمنَحان لدور مباشرةً", () => {
  assert.match(
    stripComments(SQL),
    /revoke execute on function public\.civ_meter_total\(uuid,text\)[\s\S]{0,200}from public, anon, authenticated/i,
    "مساعد العدّاد مكشوف بلا بوّابة");
});

test("★ الفحص الذاتي وPOSTCHECK يحرسان الصفر الصامت", () => {
  assert.match(selfTest(), /civ_meter_total|النمط المطلق/,
    "الفحص الذاتي لا يمنع عودة تصفية increment");
  assert.match(POSTCHECK, /civ_meter_usage_between/,
    "POSTCHECK لا يتحقّق من حساب النمط المطلق");
});
