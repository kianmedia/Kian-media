// ════════════════════════════════════════════════════════════════════════════
// tests/crm_duplicate_import.test.js — Phase 3: كشف التكرار · الـidempotency ·
// العربية وUnicode · درجة العميل الصريحة.
//
// ثلاث مخاطر تُغطَّى هنا:
//   ١) رفع الملفّ مرّتين يُنتج نسختين من كلّ عميل.
//   ٢) «شركة الكِيان» و«شركه الكيان» يُعدّان سجلَّين مختلفين فيتضاعف العمل.
//   ٣) درجة العميل تصير صندوقًا أسود فلا يثق بها أحد ولا يستطيع تعديلها.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, LIB, read, funcBody, selfTest } = require("./crm_helpers.js");

const CENTER = read("components/portal/crm/CrmCenter.tsx");

// ─── كشف التكرار ───────────────────────────────────────────────────────────

test("التطبيع يوحّد الصور العربية واللاتينية قبل المقارنة", () => {
  const n = funcBody("crm_norm_text");
  // U&'' يكتب الحرف برمزه: أ إ آ ى ة ؤ ئ → ا ا ا ي ه و ي
  assert.match(n, /U&'\\0623\\0625\\0622\\0649\\0629\\0624\\0626'/,
    "لا توحيد للألف والياء والتاء المربوطة والهمزات");
  assert.match(n, /U&'\\0627\\0627\\0627\\064A\\0647\\0648\\064A'/, "خريطة التوحيد ناقصة أو غير متوازنة");
  assert.match(n, /\\0640\\064B-\\0652/, "لا حذف للتطويل والتشكيل");
  assert.match(n, /lower\(/, "لا توحيد لحالة الأحرف اللاتينية");
  assert.match(n, /\\0600-\\06FF/, "الحروف العربية غير مستبقاة في التنظيف");
  // الطولان متساويان في translate وإلّا اقتُطعت الخريطة صامتة
  const src = n.match(/U&'((?:\\[0-9A-Fa-f]{4})+)',\s*\n?\s*U&'((?:\\[0-9A-Fa-f]{4})+)'/);
  assert.ok(src, "تعذّر قراءة خريطة translate");
  assert.equal(src[1].split("\\").length, src[2].split("\\").length,
    "خريطتا translate مختلفتا الطول — سيُقتطع التوحيد صامتًا");
});

test("تطبيع الهاتف يوحّد الصيغ ويرفض الأرقام القصيرة", () => {
  const p = funcBody("crm_norm_phone");
  assert.match(p, /regexp_replace\(coalesce\(p_in, ''\), '\[\^0-9\]', '', 'g'\)/i, "لا تجريد لغير الأرقام");
  assert.match(p, /right\([\s\S]{0,80}, 9\)/, "لا اعتماد على آخر تسع خانات");
  assert.match(p, /< 7 then null/, "رقم قصير يُقبل فيُنتج مطابقات كاذبة");
  // والـself-test يثبت ذلك حيًّا داخل الترحيلة
  const st = selfTest();
  assert.match(st, /crm_norm_phone\('\+966 55 123 4567'\)/, "self-test لا يفحص الصيغة الدولية");
  assert.match(st, /crm_norm_phone\('12345'\) is not null/, "self-test لا يفحص رفض الرقم القصير");
  assert.match(st, /crm_norm_text\('شركة  الكِيان'\)/, "self-test لا يفحص التطبيع العربيّ حيًّا");
});

test("أعمدة التطبيع تُحسب بمُشغِّل — حتى إدراج بـservice_role لا يكذب", () => {
  const t = funcBody("crm_normalize_lead");
  assert.match(t, /new\.email_norm := public\.crm_norm_email\(new\.email\)/i, "لا تطبيع للبريد");
  assert.match(t, /new\.phone_norm := public\.crm_norm_phone\(new\.phone\)/i, "لا تطبيع للهاتف");
  assert.match(t, /new\.company_name_norm := public\.crm_norm_text\(new\.company_name\)/i, "لا تطبيع للشركة");
  assert.match(SQL, /create trigger t_crm_lead_norm before insert or update on public\.crm_leads/i,
    "المُشغِّل لا يعمل على الإدراج والتحديث معًا");
  assert.match(selfTest(), /المُشغِّل % غير موجود/, "self-test لا يفحص وجود المُشغِّلات");
});

test("كشف التكرار يقارن على المطبَّع لا على النصّ الخام", () => {
  const d = funcBody("crm_duplicate_core");
  assert.match(d, /l\.email_norm = v_e/, "لا مقارنة على البريد المطبَّع");
  assert.match(d, /l\.phone_norm = v_p/, "لا مقارنة على الهاتف المطبَّع");
  assert.match(d, /l\.company_name_norm = v_c/, "لا مقارنة على اسم الشركة المطبَّع");
  assert.match(d, /crm_norm_text\(l\.contact_name\) = v_n/, "مطابقة الشركة بلا اسم الشخص — واسعة جدًّا");
  assert.match(d, /is null and v_p is null and v_c is null/, "يفحص بلا مُعرِّف واحد على الأقلّ");
  assert.match(d, /'checked', false/, "لا يصرّح بأنّه لم يفحص");
});

test("كشف التكرار لا يتحوّل إلى تسريب قائمة عملاء الزميل", () => {
  const d = funcBody("crm_duplicate_core");
  assert.match(d, /'visible', coalesce\(public\.crm_can_read_lead\(l\.id\), false\)/i, "لا وسم رؤية");
  for (const col of ["lead_code", "contact_name", "company_name", "status", "created_at"]) {
    assert.match(d, new RegExp(`'${col}',\\s*case when coalesce\\(public\\.crm_can_read_lead\\(l\\.id\\), false\\) then`, "i"),
      `الحقل ${col} يخرج بلا فحص رؤية`);
  }
  assert.match(d, /خارج صلاحيتك/, "السجلّ غير المرئيّ يخرج بلا رسالة تشرح");
});

test("الإنشاء يرفض التكرار المشتبه به ولا يتجاوزه صامتًا", () => {
  const b = funcBody("crm_lead_upsert");
  assert.match(b, /if not coalesce\(\(p->>'confirm_duplicate'\)::boolean, false\) then/i,
    "الفحص يُتجاوز افتراضيًّا");
  assert.match(b, /'duplicate_suspected'/, "لا سبب صريح للرفض");
  assert.match(b, /'duplicates', v_dup/, "الرفض بلا قائمة المطابقات — المستخدم لا يستطيع الحكم");
  // والواجهة تعرض المطابقات وتطلب تأكيدًا بشريًّا
  assert.match(CENTER, /confirm_duplicate/, "الواجهة لا تمرّر تأكيدًا صريحًا");
  assert.match(CENTER, /submit\(true\)/, "الواجهة بلا مسار تأكيد صريح بعد المراجعة");
  assert.match(CENTER, /submit\(false\)/, "الواجهة تؤكّد التكرار افتراضيًّا");
  assert.match(CENTER, /راجعتُها/, "الواجهة تؤكّد بلا مراجعة بشرية معلَنة");
  assert.match(LIB, /crmLeadUpsertRaw/, "طبقة TS لا تُتيح عرض المطابقات كما هي");
});

// ─── Idempotency ───────────────────────────────────────────────────────────

test("المرجع الخارجيّ يجعل إعادة الإنشاء تُعيد الصفّ نفسه", () => {
  const b = funcBody("crm_lead_upsert");
  assert.match(b, /where l\.external_ref = v_ext and l\.is_deleted = false limit 1/i, "لا بحث بالمرجع الخارجيّ");
  assert.match(b, /'idempotent', true/, "لا تصريح بأنّ النداء كان مكرّرًا");
  assert.match(SQL, /create unique index if not exists uq_crm_lead_external on public\.crm_leads\(external_ref\)\s*\n\s*where external_ref is not null and is_deleted = false/i,
    "الفريدية الجزئية غائبة — سباق نداءين سيُنتج توأمًا");
});

test("الاستيراد لا يُدرج شيئًا عند إعادة الرفع بنفس المفتاح", () => {
  const b = funcBody("crm_import_leads");
  assert.match(b, /length\(btrim\(p_idempotency_key\)\) < 8/, "المفتاح اختياريّ أو قصير");
  assert.match(b, /'idempotency_key_required'/, "لا سبب صريح");
  assert.match(b, /select \* into v_prev from public\.crm_import_batches where idempotency_key = btrim\(p_idempotency_key\)/i,
    "لا بحث عن دفعة سابقة");
  const prevIdx = b.indexOf("into v_prev");
  const insIdx = b.indexOf("insert into public.crm_import_batches");
  assert.ok(prevIdx !== -1 && insIdx !== -1 && prevIdx < insIdx,
    "الفحص بعد الإدراج — الدفعة الثانية ستُدرج قبل أن تُكتشف");
  assert.match(b, /'idempotent', true[\s\S]{0,200}مُستوردة سابقًا/, "لا ردّ صادق للدفعة المكرّرة");
  assert.match(SQL, /idempotency_key text not null unique/i, "المفتاح غير فريد في القاعدة");
});

test("الاستيراد يعزل خطأ الصفّ ولا يُسقط الدفعة", () => {
  const b = funcBody("crm_import_leads");
  assert.match(b, /exception when others then\s*\n\s*v_err := v_err \+ 1/i, "خطأ صفّ يُسقط الدفعة كلّها");
  assert.match(b, /'status', 'error', 'detail', sqlerrm/, "الخطأ يُبتلع بلا سبب");
  assert.match(b, /'status', 'duplicate'/, "التكرار لا يُبلَّغ عنه في النتيجة");
  assert.match(b, /'import', nullif\(btrim\(coalesce\(r->>'source_detail'/,
    "الصفّ المستورد لا يُوسم مصدره بـimport");
  // والاستيراد صلاحية مستقلّة
  assert.match(b, /crm_can_import\(\), false\) then raise exception 'not authorized'/i, "الاستيراد بلا مفتاحه");
});

test("مفتاح الاستيراد في الواجهة مستقرّ ويحترم الحدّ الأدنى", () => {
  assert.match(LIB, /export function crmImportKey/, "لا مُشتقّ مفتاح في الواجهة");
  const fn = LIB.match(/export function crmImportKey[\s\S]*?\n\}/)[0];
  assert.match(fn, /fileName|rowCount|firstCell/, "المفتاح لا يشتقّ من محتوى الملفّ");
  assert.match(fn, /imp_/, "المفتاح بلا بادئة تضمن الطول الأدنى (٨ محارف)");
  assert.doesNotMatch(fn, /Math\.random|Date\.now/, "المفتاح عشوائيّ — إعادة الرفع ستُدرج نسخة ثانية");
});

test("قارئ CSV يتعامل مع الاقتباس وBOM وCRLF ولا يُقيَّم", () => {
  const fn = CENTER.match(/export function parseCsv[\s\S]*?\n\}/)[0];
  assert.match(fn, /replace\(\/\^\\uFEFF\/|replace\(\/\^﻿\//, "لا إزالة لعلامة BOM — أوّل عمود سيُقرأ خطأً");
  assert.match(fn, /'"'/, "لا دعم للاقتباس المزدوج");
  assert.match(fn, /\\r/, "لا معالجة لـCRLF");
  assert.doesNotMatch(fn, /eval|new Function/, "تقييم نصّ من ملفّ المستخدم");
});

// ─── الدرجة صريحة لا صندوق أسود ────────────────────────────────────────────

test("الدرجة تُحسب من جدول قواعد قابل للتحرير، لا من معادلة مخفيّة", () => {
  const b = funcBody("crm_score_core");
  assert.match(b, /from public\.crm_lead_score_rules where is_active/i, "الدرجة لا تقرأ جدول القواعد");
  assert.match(b, /'components', v_items/, "لا تفصيل للبنود");
  assert.match(b, /'matched', v_match/, "البنود بلا حالة مطابقة");
  assert.match(b, /'explain'/, "لا شرح لطريقة الحساب");
  assert.match(b, /'rules_total', v_base/, "مجموع القواعد غير مفصول عن التعديل اليدويّ");
  assert.match(b, /'manual_adjust'/, "التعديل اليدويّ غير معلَن");
  assert.match(b, /'override'/, "التجاوز غير معلَن");
  // القائمة البيضاء للحقول والمشغّلات: لا SQL ديناميكيّ من مدخلات المستخدم
  assert.doesNotMatch(b, /execute\s+format|execute\s+'select/i, "الحساب يبني SQL ديناميكيًّا من قاعدة يحرّرها مستخدم");
  const tbl = SQL.match(/create table if not exists public\.crm_lead_score_rules \(([\s\S]*?)\n\);/)[1];
  assert.match(tbl, /field\s+text not null check \(field in \(/i, "حقل القاعدة بلا قائمة بيضاء");
  assert.match(tbl, /operator\s+text not null check \(operator in \(/i, "مشغّل القاعدة بلا قائمة بيضاء");
  assert.match(tbl, /points\s+int not null default 0 check \(points between -50 and 50\)/i, "النقاط بلا حدّ");
});

test("التعديل اليدويّ والتجاوز يتطلّبان سببًا، والتجاوز مفتاح مستقلّ", () => {
  const b = funcBody("crm_lead_score_adjust");
  assert.match(b, /'reason_required'/, "التعديل بلا سبب");
  assert.match(b, /crm_can_manage_scoring\(\), false\) then raise exception 'not authorized'/i,
    "التجاوز بلا مفتاحه المستقلّ");
  assert.match(b, /'adjust_out_of_range'/, "التعديل بلا حدود");
  assert.match(b, /'override_out_of_range'/, "التجاوز بلا حدود");
  // وتحرير القواعد نفسها مفتاح مستقلّ
  assert.match(funcBody("crm_score_rule_upsert"), /crm_can_manage_scoring\(\), false\) then raise exception 'not authorized'/i,
    "تحرير قواعد الدرجة بلا مفتاحه");
});

test("الدرجة محصورة ٠–١٠٠ والتجاوز يحلّ محلّها صراحةً", () => {
  const b = funcBody("crm_score_core");
  assert.match(b, /greatest\(0, least\(100, v_base \+ coalesce\(l\.score_manual_adjust, 0\)\)\)/i,
    "الدرجة غير محصورة");
  assert.match(b, /if l\.score_override is not null then v_total := l\.score_override/i,
    "التجاوز لا يحلّ محلّ الحساب");
  assert.match(b, /'grade'/, "لا تصنيف مقروء (ساخن/دافئ/بارد)");
  assert.match(b, /crm_setting_int\('score_hot_threshold'/, "عتبة التصنيف رقم سحريّ");
});
