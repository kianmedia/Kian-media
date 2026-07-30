// ════════════════════════════════════════════════════════════════════════════
// tests/ops_role_scope.test.js
// مصفوفة الأدوار التشغيلية — دورًا دورًا، لا «صلاحية عامّة».
//
//   المالك/الأدمن     → كلّ شيء.
//   مدير التشغيل      → عمليّات فقط، بمفتاح operations.manage الصريح.
//   فرد الطاقم        → مهامّه هو: يرى، يؤكّد حضوره، يكتب تقريره هو.
//   المونتير          → أعمال ما بعد الإنتاج المُسندة إليه هو.
//   موظّف بلا إسناد   → لا تفصيل تشغيليّ إطلاقًا.
//   العميل            → لا شيء (مغطّى أيضًا في ops_client_denial).
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, funcBody, READ_FNS, WRITE_FNS } = require("./ops_helpers");

test("المالك مسموح: كلّ مسار إدارة يبدأ من is_owner/is_admin قبل المفتاح", () => {
  const b = funcBody("prodops_can_manage");
  assert.match(b, /public\.is_owner\(\)/, "المالك خارج المُسنَد");
  assert.match(b, /public\.is_admin\(\)/, "الأدمن خارج المُسنَد");
  assert.match(b, /prodops_perm\('operations\.manage'\)/, "لا مفتاح صريح لمدير التشغيل");
  // ولا يُشتقّ من إدارة المشاريع بأيّ شكل
  assert.doesNotMatch(b, /can_manage_projects|is_kian_member/i,
    "صلاحية التشغيل مشتقّة من موديول آخر");
});

test("مدير التشغيل مُقيَّد بالتشغيل: مفتاحه لا يفتح المنصّة ولا المال", () => {
  // المفتاح المزروع من فئة operations وحدها.
  const seed = SQL.slice(SQL.indexOf("§1)"), SQL.indexOf("§2)"));
  assert.match(seed, /'operations\.manage'/, "المفتاح غير مزروع");
  assert.match(seed, /'operations'/, "الفئة ليست operations");
  const keys = seed.match(/'operations\.[a-z_]+'/g) ?? [];
  assert.ok(keys.length >= 8, `مفاتيح التشغيل ${keys.length} — أقلّ من المتوقّع`);
  for (const k of keys) assert.match(k, /^'operations\./, `مفتاح خارج نطاق التشغيل: ${k}`);
  // ولا دالّة في الموديول تمنح نفسها صلاحية خارج التشغيل
  assert.doesNotMatch(SQL, /prodops_perm\('(?!operations\.)/, "مفتاح صلاحية خارج نطاق operations");
});

test("فرد الطاقم يرى مهامّه هو فقط — والتصفية على الخادم لا في الشاشة", () => {
  const vis = funcBody("prodops_visible_jobs");
  assert.match(vis, /prodops_can_manage\(\), false\)/, "المدير غير مستثنى صراحةً");
  assert.match(vis, /public\.is_staff\(\), false\)/, "غير الموظّف قد يمرّ");
  assert.match(vis, /c\.user_id = auth\.uid\(\)/, "الطاقم لا يُقيَّد بصاحب الجلسة");
  assert.match(vis, /h\.handed_to_user_id = auth\.uid\(\)/, "المونتير لا يُقيَّد بصاحب الجلسة");

  const read = funcBody("prodops_can_read_job");
  assert.match(read, /when not coalesce\(public\.is_staff\(\), false\) then false/,
    "غير الموظّف يمرّ إلى قراءة المهمّة");
  assert.match(read, /prodops_is_crew\(p_job\)/, "قراءة المهمّة لا تعتمد على الإسناد");
});

test("موظّف بلا إسناد لا يرى تفصيلًا تشغيليًّا — «موظّف» ليست تصريحًا", () => {
  // is_staff() تفتح المركز، ولا تفتح مهمّة بعينها: المهمّة تحتاج إسنادًا.
  const read = funcBody("prodops_can_read_job");
  assert.match(read, /prodops_is_crew\(p_job\), false\)\s*\n?\s*or coalesce\(public\.prodops_is_post_assignee/,
    "لا شرط إسناد صريح — كلّ موظّف سيقرأ كلّ مهمّة");
  // وقائمة المهامّ تمرّ عبر المجموعة المرئية لا عبر الجدول مباشرة
  for (const fn of ["prodops_jobs_list", "prodops_calendar"]) {
    assert.match(funcBody(fn), /join public\.prodops_visible_jobs\(\)/,
      `${fn} تقرأ الجدول بلا تصفية إسناد`);
  }
  // والتفصيل الكامل يشترط قراءة المهمّة نفسها
  for (const fn of ["prodops_job_detail", "prodops_call_sheet"]) {
    assert.match(funcBody(fn), /prodops_can_read_job\(p_job\)/, `${fn} بلا فحص إسناد`);
  }
});

test("فرد الطاقم: يؤكّد حضوره هو، ويكتب تقريره هو، ولا شيء غير ذلك", () => {
  const att = funcBody("prodops_confirm_attendance");
  assert.match(att, /where job_id = p_job and user_id = auth\.uid\(\)/,
    "تأكيد الحضور غير مقصور على صاحب الجلسة");
  assert.doesNotMatch(att, /p_user|p_crew_id/, "الدالّة تقبل شخصًا آخر كمعامل");

  const rep = funcBody("prodops_daily_report_upsert");
  assert.match(rep, /prodops_is_crew\(v_job\)/, "غير المُسنَد يكتب تقريرًا لمهمّة ليست له");
  assert.match(rep, /if v_owner <> auth\.uid\(\) then raise exception 'not authorized'/,
    "أحدهم يحرّر تقرير غيره");
  assert.match(rep, /prepared_by = auth\.uid\(\)/, "كاتب التقرير غير مأخوذ من الجلسة");
});

test("المونتير: أعمال ما بعد الإنتاج المُسندة إليه هو فقط", () => {
  const p = funcBody("prodops_post_handoff_progress");
  assert.match(p, /v_to = auth\.uid\(\) or coalesce\(public\.prodops_can_manage/,
    "المونتير يحرّك تسليم غيره");
  const rls = SQL.slice(SQL.indexOf("§5)"), SQL.indexOf("§6)"));
  assert.match(rls, /ops_post_handoff_read[\s\S]{0,200}handed_to_user_id = auth\.uid\(\)/,
    "سياسة قراءة التسليم لا تُقيَّد بالمُسنَد إليه");
  assert.match(rls, /ops_daily_reports_read[\s\S]{0,200}prepared_by = auth\.uid\(\)/,
    "سياسة قراءة التقارير لا تُقيَّد بكاتبها");
});

test("كتابة المهمّة وأبنائها للمدير وحده — والاستثناءات معدودة ومقصودة", () => {
  // كلّ ما يُنشئ/يعدّل بنية المهمّة يمرّ على prodops_can_edit_job (المدير).
  for (const fn of ["prodops_child_upsert", "prodops_child_delete", "prodops_hse_seed",
    "prodops_call_sheet_publish", "prodops_job_delete", "prodops_job_set_status"]) {
    assert.match(funcBody(fn), /prodops_can_edit_job\(/, `${fn} لا تمرّ على مُسنَد التعديل`);
  }
  const edit = funcBody("prodops_can_edit_job");
  assert.match(edit, /prodops_can_manage\(\), false\)/, "تعديل المهمّة ليس مقصورًا على المدير");
  // الاستثناءات المسموح بها للطاقم — ولا شيء غيرها.
  const crewSelfService = ["prodops_confirm_attendance", "prodops_daily_report_upsert",
    "prodops_backup_step", "prodops_post_handoff_progress"];
  for (const fn of WRITE_FNS) {
    const b = funcBody(fn);
    if (crewSelfService.includes(fn)) continue;
    assert.ok(/prodops_can_manage\(|prodops_can_edit_job\(/.test(b),
      `${fn} مفتوحة لغير المدير بلا مبرّر`);
  }
});

test("كلّ دالّة قراءة تُغلق على غير الموظّف قبل أيّ صفّ", () => {
  for (const fn of READ_FNS) {
    if (fn === "prodops_access") continue;              // مِجَسّ الكشف: يُجيب الجميع بقدرات صفر
    const b = funcBody(fn);
    assert.ok(/prodops_can_view\(\)|prodops_can_read_job\(/.test(b), `${fn} بلا بوّابة`);
    assert.match(b, /raise exception 'not authorized'/, `${fn} بلا رفض صريح`);
  }
});

test("لا صلاحية مُشتقّة في المتصفّح: القدرة تأتي من الخادم في كلّ شاشة", () => {
  const fs = require("node:fs"); const path = require("node:path");
  const root = path.join(__dirname, "..", "components/portal/operations");
  for (const f of fs.readdirSync(root)) {
    const src = fs.readFileSync(path.join(root, f), "utf8");
    assert.doesNotMatch(src, /staff_role\s*===|role\s*===\s*['"]admin|isOwner\s*=/,
      `${f}: يشتقّ الصلاحية محلّيًّا بدل قراءتها من الخادم`);
  }
});
