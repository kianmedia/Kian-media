// ════════════════════════════════════════════════════════════════════════════
// tests/exec_owner_only.test.js
//
// ★ المؤشّرات الحسّاسة للمالك وحده — ولا مفتاح يفتحها ★
// الفرق بين «مقصور على المالك» و«مقصور على من يملك المفتاح» هو الفرق بين ضابط
// بنيويّ وقرار إداريّ عابر. هذه الاختبارات تمنع الانزلاق من الأوّل إلى الثاني.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, TS, DASH, ATOMS, POSTCHECK, funcBody, selfTest,
  SENSITIVE_KEYS, KPI_KEYS,
} = require("./exec_helpers.js");

test("بوّابة الحسّاس = المالك، ولا تُفتَح بمفتاح صلاحية", () => {
  const body = funcBody("mgmt_can_view_sensitive");
  assert.match(body, /is_owner\(\)/, "البوّابة لا تشترط المالك");
  assert.match(body, /is_staff\(\)/, "البوّابة لا تستبعد العميل");
  assert.ok(!/mgmt_perm/.test(body),
    "بوّابة المؤشّرات الحسّاسة تُفتَح بمفتاح — الهامش يخرج بقرار إداريّ عابر");
  assert.ok(!/can_manage_projects/.test(body), "البوّابة تعتمد صلاحية المشاريع");
  assert.match(body, /coalesce\(/i, "البوّابة قد تعيد NULL — انهيار fail-closed");
});

test("لا مفتاح صلاحية للطبقة الحسّاسة في الكتالوج", () => {
  const perms = SQL.slice(SQL.indexOf("do $perm$"), SQL.indexOf("end $perm$;"));
  assert.match(perms, /exec_report\.view/, "مفتاح العرض غير مبذور");
  assert.match(perms, /exec_report\.export/, "مفتاح التصدير غير مبذور");
  // مفتاحان اثنان لا ثالث لهما — عدّ صريح كي لا يتسلّل ثالث بصمت.
  // ⚠️ الفحص على كتلة البذر وحدها: الحزمة **تذكر** exec_report.view_sensitive في
  //    تعليق يشرح سبب غيابه، وفحصٌ يقرأ الملفّ كلّه كان سيعاقب على التوثيق.
  const keys = perms.match(/'exec_report\.[a-z_]+'/g) ?? [];
  assert.deepEqual(keys.sort(), ["'exec_report.export'", "'exec_report.view'"],
    `مفاتيح exec_report المبذورة تغيّرت: ${keys.join(" ")}`);
  assert.ok(!/'exec_report\.[a-z_]*sensitive[a-z_]*'/.test(perms),
    "وُجد مفتاح مبذور يفتح الطبقة الحسّاسة");
  // وحارس داخل الـSELF-TEST نفسه لا في الاختبار وحده
  assert.match(selfTest(), /permissions where key ilike 'exec\\_report\.%sensitive%'/,
    "الـSELF-TEST لا يمنع إضافة مفتاح حسّاس لاحقًا");
});

test("المؤشّرات الستّة الحسّاسة مُعلَّمة sensitive = true", () => {
  const body = funcBody("mgmt_compute");
  for (const k of SENSITIVE_KEYS) {
    const re = new RegExp(`mgmt_kpi\\('${k}','[a-z]+','[a-z]+',\\s*true`, "g");
    assert.ok(re.test(body), `المؤشّر ${k} غير معلَّم حسّاسًا في كلّ مساراته`);
    // ولا مسار واحد يبنيه بـfalse
    const bad = new RegExp(`mgmt_kpi\\('${k}','[a-z]+','[a-z]+',\\s*false`);
    assert.ok(!bad.test(body), `المؤشّر ${k} مبنيّ غير حسّاس في أحد مساراته`);
  }
});

test("المؤشّرات غير الحسّاسة ليست معلَّمة حسّاسة بالخطأ", () => {
  const body = funcBody("mgmt_compute");
  const nonSensitive = KPI_KEYS.filter((k) => !SENSITIVE_KEYS.includes(k));
  for (const k of nonSensitive) {
    const bad = new RegExp(`mgmt_kpi\\('${k}','[a-z]+','[a-z]+',\\s*true`);
    assert.ok(!bad.test(body), `المؤشّر ${k} معلَّم حسّاسًا بلا داعٍ`);
  }
});

test("★ غير المالك لا تُستدعى له المالية أصلًا ★ — لا تسرّب حتى بالعدّاد", () => {
  const body = funcBody("mgmt_compute");
  const iFinance = body.indexOf("-- ── المالية");
  assert.ok(iFinance > 0, "قسم المالية غير موسوم");
  const fin = body.slice(iFinance);
  const iCall = fin.indexOf("finops_dashboard");
  const iGate = fin.indexOf("elsif not v_sens then");
  assert.ok(iGate > 0, "لا بوّابة مالك قبل قسم المالية");
  assert.ok(iGate < iCall,
    "استدعاء finops يسبق بوّابة المالك — غير المالك قد يرى عدّاد الذمم المتأخّرة");
  assert.match(fin, /'restricted','owner_only'/, "الحجب لا يُعلن سببه owner_only");
});

test("التنبيه الحسّاس لا يصل إلى غير المالك", () => {
  const body = funcBody("mgmt_alerts_from");
  assert.match(body,
    /if coalesce\(\(k->>'sensitive'\)::boolean, false\) and not coalesce\(p_sensitive, false\) then continue; end if;/,
    "لا حارس يمنع بناء تنبيه حسّاس لغير المالك");
  // وفحص سلوكيّ داخل الـSELF-TEST
  assert.match(selfTest(), /تنبيه ماليّ حسّاس وصل إلى غير المالك/,
    "الـSELF-TEST لا يفحص تسرّب التنبيه الحسّاس");
});

test("الربحية تحترم بوّابة المالية الأضيق ولا تلتفّ عليها", () => {
  const body = funcBody("mgmt_compute");
  assert.match(body, /profit_visible/,
    "المحرّك لا يقرأ إعلان الحجب الصادر من الموديول المالي");
  assert.match(body, /finance_profit_gate/,
    "حجب الموديول المالي لا يُعلَن بسبب مستقلّ");
  // ولا استدعاء مباشر للدالّة الداخلية التي لا تُمنح لأحد
  assert.ok(!/finops_profit_core/.test(SQL),
    "الحزمة تستدعي finops_profit_core مباشرةً — التفاف على بوّابة الهامش");
});

test("سجلّ التدقيق للمالك وحده", () => {
  const body = funcBody("mgmt_audit_list");
  assert.match(body, /mgmt_can_view_sensitive\(\)/, "سجلّ التدقيق ليس خلف بوّابة المالك");
  assert.match(SQL, /create policy mgmt_audit_sel[\s\S]{0,200}mgmt_can_view_sensitive/,
    "سياسة سجلّ التدقيق ليست خلف بوّابة المالك");
});

test("التصدير لا يوسّع الرؤية: يبني من ناتج اللوحة نفسه", () => {
  const body = funcBody("mgmt_export");
  assert.match(body, /public\.mgmt_dashboard\(p_filters, false\)/,
    "التصدير يقرأ المصادر بنفسه بدل البناء من اللوحة");
  assert.ok(!/finops_|crm_|prodops_|comms_/.test(body),
    "التصدير يقرأ موديولًا مصدرًا مباشرةً — طريق جانبيّ حول بوّابة اللوحة");
  assert.match(body, /mgmt_can_export\(\)/, "التصدير بلا بوّابته الخاصّة");
  assert.match(body, /mgmt_log/, "التصدير غير مُدقَّق");
  assert.match(body, /sensitive_visible/, "التصدير لا يوثّق مستوى رؤية المُصدِّر");
});

test("الواجهة تُعلن الحجب صراحةً بدل عرض أصفار", () => {
  assert.match(DASH, /!d\.sensitive_visible/, "لا لافتة تشرح الحجب لغير المالك");
  assert.ok(/مقصورة على المالك|owner-only/i.test(DASH), "نصّ الحجب غائب");
  assert.match(ATOMS, /المالك فقط|Owner only/, "بطاقة المؤشّر لا تُعلم أنّه حسّاس");
  assert.match(ATOMS, /restricted: \{ ar: "محجوب"/, "لا شارة «محجوب» مستقلّة عن «غير متاح»");
});

test("POSTCHECK يفحص الطبقة الحسّاسة صراحةً", () => {
  assert.match(POSTCHECK, /mgmt_can_view_sensitive\(\)[\s\S]{0,200}is_owner/,
    "POSTCHECK لا يفحص اشتراط المالك");
  assert.match(POSTCHECK, /opens_by_key/, "POSTCHECK لا يفحص أنّ البوّابة لا تُفتَح بمفتاح");
  assert.match(POSTCHECK, /exec\\_report\.%sensitive%/,
    "POSTCHECK لا يفحص غياب مفتاح للطبقة الحسّاسة");
});

test("لا منح تلقائيّ لأحد — الحزمة لا تُسند صلاحية", () => {
  assert.ok(!/insert into public\.(profession_permissions|employee_permission_overrides)/i.test(SQL),
    "الحزمة تُسند صلاحيات تلقائيًّا");
  assert.match(SQL, /لا شيء يُمنَح تلقائيًّا/, "لا تصريح صريح بعدم المنح التلقائيّ");
});

test("مِجَسّ الوصول يفرّق بين «لا صلاحية» و«لا طبقة حسّاسة»", () => {
  const body = funcBody("mgmt_access");
  assert.match(body, /can_view_sensitive/, "المِجَسّ لا يُعلن حالة الطبقة الحسّاسة");
  assert.ok(!/raise exception/.test(body), "المِجَسّ يرفع استثناء فتفقد الواجهة التفريق");
  assert.match(body, /is_client/, "المِجَسّ لا يصرّح بأنّ صاحب الجلسة عميل");
  assert.match(TS, /can_view_sensitive: boolean/, "عقد TypeScript لا يحمل حالة الطبقة الحسّاسة");
});
