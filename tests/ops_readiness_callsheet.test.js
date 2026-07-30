// ════════════════════════════════════════════════════════════════════════════
// tests/ops_readiness_callsheet.test.js
// حساب الجاهزية · تنبيهات النواقص · عزل بيانات ورقة النداء · الطباعة بلا PDF.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SQL, funcBody } = require("./ops_helpers");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const PRINT = read("components/portal/operations/OpsCallSheetPrint.tsx");
const PANEL = read("components/portal/operations/OpsJobPanel.tsx");
const LIB = read("lib/portal/opsCenter.ts");

test("حساب الجاهزية: نسبة من الإلزاميّ وحده، والاختياريّ لا يخفض الدرجة", () => {
  const b = funcBody("prodops_readiness_core");
  assert.match(b, /count\(\*\) filter \(where \(e->>'required'\)::boolean\)/, "المقام ليس الإلزاميّ");
  assert.match(b, /\(e->>'required'\)::boolean and \(e->>'ok'\)::boolean/, "البسط لا يشترط الإلزاميّ");
  assert.match(b, /case when v_req = 0 then 0 else floor\(\(v_ok::numeric \* 100\) \/ v_req\)::int end/,
    "القسمة بلا حماية من صفر أو بلا floor — درجة عشوائية");
  // الاختياريّ موجود فعلًا في القائمة (وإلّا فالتمييز نظريّ)
  assert.match(b, /'call_sheet'[\s\S]{0,80}'required', false/, "لا فحص اختياريّ واحد على الأقلّ");
  // والمطلوب المشروط مشروط فعلًا بحقل المهمّة لا بثابت
  assert.match(b, /'required', j\.permit_required/, "التصاريح إلزامية دائمًا أو اختيارية دائمًا");
  assert.match(b, /'required', j\.travel_required/, "السفر غير مشروط بحاجة المهمّة");
});

test("الجاهزية تُبلّغ بصدق عن مهمّة غير موجودة بدل صفر مضلِّل", () => {
  const b = funcBody("prodops_readiness_core");
  assert.match(b, /'ok', false[\s\S]{0,120}'reason','job_not_found'/, "لا تمييز بين «صفر» و«غير موجودة»");
});

test("كلّ فحص جاهزية مبنيّ على عدّ حقيقيّ لا على علَم يدويّ", () => {
  const b = funcBody("prodops_readiness_core");
  for (const [ar, tbl] of [
    ["الطاقم", "ops_job_crew"], ["المعدّات", "ops_job_equipment"],
    ["التصاريح", "ops_job_permits"], ["السلامة", "ops_job_hse"],
    ["ورقة النداء", "ops_call_sheets"], ["الحوادث", "ops_incidents"], ["السفر", "ops_job_travel"],
  ]) {
    assert.ok(b.includes(`public.${tbl}`), `${ar}: الفحص لا يعدّ من ${tbl}`);
  }
  assert.match(b, /is_deleted = false/, "الفحص يعدّ صفوفًا مؤرشفة");
});

test("تنبيهات النواقص في اللوحة تُشتقّ من نفس المصادر لا من قائمة ثانية", () => {
  const b = funcBody("prodops_dashboard");
  for (const k of ["missing_crew", "missing_equipment", "missing_permits", "media_not_backed_up"]) {
    assert.ok(b.includes(k), `تنبيه ${k} غائب عن اللوحة`);
  }
  assert.match(b, /prodops_visible_jobs\(\)/, "اللوحة تقرأ خارج المجموعة المرئية");
});

test("عزل بيانات ورقة النداء: الخادم يفحص الإسناد قبل أن يبني الورقة", () => {
  const b = funcBody("prodops_call_sheet");
  assert.match(b, /if not coalesce\(public\.prodops_can_read_job\(p_job\), false\) then raise exception 'not authorized'/,
    "الورقة تُبنى قبل فحص الإسناد");
  // الورقة لا تحمل ملاحظات الإدارة الداخلية ولا ملاحظات الأفراد
  assert.doesNotMatch(b, /internal_notes/, "الورقة تسرّب ملاحظات الإدارة الداخلية");
  assert.doesNotMatch(b, /c\.notes/, "الورقة تسرّب ملاحظة الإدارة عن الفرد");
  // ولا تعرض المعتذر كأنّه ضمن الطاقم
  assert.match(b, /c\.status <> 'declined'/, "المعتذر يظهر في ورقة النداء");
});

test("الطباعة HTML لا PDF: لا مكتبة توليد ولا رفع ملفّ ولا مورد خارجيّ", () => {
  assert.match(PRINT, /window\.print\(\)/, "لا طباعة أصلًا");
  assert.doesNotMatch(PRINT, /jspdf|pdf-lib|html2canvas|puppeteer|\.pdf\b/i, "توليد PDF");
  assert.doesNotMatch(PRINT, /https?:\/\//, "مورد خارجيّ في ورقة تُطبع من الموقع");
  assert.match(PRINT, /@media print/, "لا أنماط طباعة");
  assert.match(PRINT, /@page/, "لا هوامش صفحة");
  // الطباعة تنقلب إلى أسود على أبيض
  assert.match(PRINT, /background: #fff/, "خلفية الطباعة داكنة — ورقة غير مقروءة");
  assert.match(PRINT, /color: #000/, "نصّ الطباعة فاتح على أبيض");
  // ونطاق الأنماط محصور بالورقة لا بالبوّابة كلّها
  assert.match(PRINT, /\.ops-print/, "أنماط الطباعة بلا نطاق");
});

test("الطباعة موصولة فعلًا — لا دالّة معلَّقة بلا زرّ", () => {
  assert.match(PANEL, /import OpsCallSheetPrint/, "شاشة الطباعة غير مركَّبة");
  assert.match(PANEL, /setPrinting\(""\)/, "لا زرّ طباعة على مستوى المهمّة");
  assert.match(PANEL, /setPrinting\(String\(cs\.sheet_date/, "لا طباعة لورقة بعينها");
  assert.match(PRINT, /opsCallSheet\(/, "شاشة الطباعة لا تستدعي دالّة القاعدة");
  // وحذف المهمّة موصول بسبب مكتوب
  assert.match(PANEL, /opsJobDelete\(jobId, delReason\.trim\(\)\)/, "حذف المهمّة غير موصول");
  assert.match(PANEL, /delReason\.trim\(\)\.length < 3/, "الحذف يُرسل بلا سبب فيُرفض من الخادم");
});

test("كلّ دالّة مُصدَّرة في طبقة العقد مستعملة فعلًا — لا مسار ميّت", () => {
  const exported = [...LIB.matchAll(/export const (ops[A-Za-z]+) =/g)].map((m) => m[1]);
  assert.ok(exported.length >= 20, `عدد الدوالّ المُصدَّرة ${exported.length} غير متوقّع`);
  const dir = path.join(ROOT, "components/portal/operations");
  const ui = fs.readdirSync(dir).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
  const dead = exported.filter((n) => !new RegExp(`\\b${n}\\b`).test(ui));
  assert.deepEqual(dead, [], `دوالّ مُصدَّرة بلا مستعمل: ${dead.join(", ")}`);
});

test("التقويم: يوم وأسبوع وشهر — لا مدى واحد ثابت", () => {
  const center = read("components/portal/operations/OpsCenter.tsx");
  assert.match(center, /CAL_SPAN_AR/, "لا مدى قابل للتبديل");
  for (const ar of ["اليوم", "الأسبوع", "الشهر"]) {
    assert.ok(center.includes(`"${ar}"`), `مدى ${ar} غائب`);
  }
  assert.match(center, /spanRange\("week"\)/, "المدى الافتراضيّ غير مضبوط");
  // ومدى «اليوم» يوم واحد فعلًا (والخادم يعامل p_to كشامل)
  assert.match(center, /span === "day"\) return \{ from: opsIsoDay\(base\), to: opsIsoDay\(base\) \}/,
    "مدى اليوم ليس يومًا واحدًا");
  assert.match(funcBody("prodops_calendar"), /\(v_to \+ 1\)::timestamptz/,
    "الخادم يعامل نهاية المدى كحصريّة — «اليوم» سيظهر فارغًا دائمًا");
});

test("إسناد مدير العمليّات والربط بالمشروع موصولان — لا حقل خادم بلا شاشة", () => {
  const form = read("components/portal/operations/OpsJobForm.tsx");
  // مدير العمليّات
  assert.match(form, /owner_user_id/, "لا حقل لمدير العمليّات");
  assert.match(form, /لا يمنح صلاحية/, "الحقل يوهم أنّه يمنح صلاحية");
  assert.match(funcBody("prodops_job_upsert"), /owner_user_id/, "الخادم لا يقبل الحقل");
  // الربط بالمشروع — اختياريّ، ومعطّل بصدق إن غاب الجدول
  assert.match(form, /project_id/, "لا حقل للربط بالمشروع");
  assert.match(form, /projects_source === "unavailable"/, "لا تمييز بين «معطّل» و«لا مشاريع»");
  assert.match(funcBody("prodops_lookups"), /public\.projects/, "المشاريع خارج المراجع");
  assert.match(funcBody("prodops_lookups"), /'projects_source'/, "مصدر المشاريع غير معلَن");
  // ★ والقراءة قراءة فقط: معرّف واسم، ولا كتابة في المنصّة المجمَّدة
  const lk = funcBody("prodops_lookups");
  assert.doesNotMatch(lk, /(insert into|update|delete from)\s+public\.projects/i,
    "الموديول يكتب في المنصّة المجمَّدة");
  // الاستعلام الموجَّه إلى المنصّة وحده — لا يُفحص باقي جسم الدالّة
  const projQuery = lk.slice(lk.indexOf("from (select id, %I from public.projects"));
  const projStmt = projQuery.slice(0, projQuery.indexOf("$q$"));
  assert.match(projStmt, /^from \(select id, %I from public\.projects order by %I limit \d+\) p$/,
    `يقرأ أكثر من المعرّف والاسم من المنصّة المجمَّدة: ${projStmt.trim()}`);
  // ونموذج واحد للإنشاء والتعديل
  assert.match(form, /editing \? "حفظ التعديل" : "إنشاء"/, "لا وضع تعديل");
  const panel = read("components/portal/operations/OpsJobPanel.tsx");
  assert.match(panel, /<OpsJobForm job=\{job\}/, "التعديل غير موصول من لوحة المهمّة");
});

test("رسائل الرفض الجديدة مترجمة في الواجهة — لا «تعذّر تنفيذ الطلب» مبهم", () => {
  assert.match(LIB, /case "double_booked"/, "رفض الحجز المزدوج بلا ترجمة");
  assert.match(LIB, /case "not_card_holder"/, "رفض غير حامل البطاقة بلا ترجمة");
  // وكلّ سبب يعيده الخادم بلا رسالة له ترجمة هنا
  const reasons = [...SQL.matchAll(/'reason','([a-z_]+)'/g)].map((m) => m[1]);
  const missing = [...new Set(reasons)].filter((r) => !LIB.includes(`case "${r}"`));
  assert.deepEqual(missing, [], `أسباب بلا ترجمة عربية: ${missing.join(", ")}`);
});
