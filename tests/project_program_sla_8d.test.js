// ════════════════════════════════════════════════════════════════════════════
// tests/project_program_sla_8d.test.js — حراس Batch 8D.
// الافتراض الحاكم: «نتائج SLA ملفَّقة، أو المقامات خاطئة، أو العميل يرى ما لا يملك».
// كل حارس هنا يمنع واحدًا من هذه الثلاثة تحديدًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SQL = read("docs/project_program_sla_batch8d_RUNME.sql");
const SQL8A = read("docs/project_programs_batch8a_RUNME.sql");
const TS = read("lib/portal/programSla.ts");
const UI = read("components/portal/projectcore/ProgramSlaTab.tsx");
const OPS_UI = read("components/portal/projectcore/OperationsCenter.tsx");
const EXEC_UI = read("components/portal/projectcore/ExecutiveDashboard.tsx");
const PROJOPS = read("components/portal/projectcore/ProjectOps.tsx");

const codeOf = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
const tsCode = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
// كتلة الاختبار الذاتي تذكر الرموز الممنوعة **لتحرسها**، فذكرها ليس استعمالًا.
// (نفس درس الدفعات السابقة: الحارس طابق نفسه.)
const withoutSelftest = (s) => s.replace(/do \$selftest\$[\s\S]*?\$selftest\$;/g, "");
// و`comment on ... is '...'` توثيق أيضًا: نصّه يذكر ما لا نستعمله.
const withoutComments = (s) => s.replace(/comment on [\s\S]*?;\n/g, "");
const liveCode = (s) => codeOf(withoutComments(withoutSelftest(s)));
function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`);
  return m[1];
}
const INTERNAL = ["program_commitment_guard", "pgm_unit_delivered_at", "pgm_commitment_results_core"];

// ═══════════════════════ بنية الملف والترحيل ═══════════════════════
test("SQL 8D بنيوي: Preflight، Transaction واحدة، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*8D PREFLIGHT/i, "لا Preflight");
  assert.equal((SQL.match(/^begin;\s*$/gim) || []).length, 1, "عدد begin; ليس ١");
  assert.equal((SQL.match(/^commit;\s*$/gim) || []).length, 1, "عدد commit; ليس ١");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '8D FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة في قراءات Runtime");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  assert.ok(SQL.length > 20000, "ملف شكليّ");
  // توازن علامات الاقتباس بالدولار
  for (const tag of ["$$", "$pre$", "$perm$", "$selftest$"]) {
    const n = SQL.split(tag).length - 1;
    assert.equal(n % 2, 0, `${tag} غير متوازن (${n})`);
  }
});

test("Preflight يشترط كل تبعية غير محروسة باستثناء", () => {
  const pre = SQL.match(/do \$pre\$([\s\S]*?)\$pre\$;/)[1];
  for (const dep of ["pc_can_read_project", "program_can", "project_program_settings", "pc_is_master",
                     "project_program_plan_runs", "project_status_history", "project_activity",
                     "pc_project_closure_status", "is_client_owner", "ops_can_view", "ops_visible_ids",
                     "exec_visible_projects", "deliverable_reviews", "client_comments",
                     "project_approvals", "wrap_time"]) {
    assert.ok(pre.includes(dep), `Preflight لا يتحقّق من ${dep}`);
  }
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 8D", () => {
  const re = /create or replace function public\.([a-z_0-9]+)\s*\([^)]*\)[\s\S]*?\blanguage plpgsql[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m, checked = 0;
  while ((m = re.exec(SQL))) {
    const name = m[1]; const body = codeOf(m[2]);
    const decls = new Set();
    for (const dm of body.matchAll(/\bdeclare\b([\s\S]*?)\bbegin\b/gi)) {
      for (const v of dm[1].matchAll(/(^|;)\s*([a-z_][a-z0-9_]*)\s+[a-z]/gi)) decls.add(v[2].toLowerCase());
    }
    for (const p of (m[0].match(/\(([^)]*)\)/) || ["", ""])[1].matchAll(/\b(p_[a-z0-9_]+)\b/gi)) decls.add(p[1].toLowerCase());
    for (const f of body.matchAll(/\bfor\s+([a-z_][a-z0-9_]*)(?:\s*,\s*([a-z_][a-z0-9_]*))?\s+in\b/gi)) {
      decls.add(f[1].toLowerCase()); if (f[2]) decls.add(f[2].toLowerCase());
    }
    for (const u of body.matchAll(/\b(v_[a-z0-9_]+)\b/gi)) {
      assert.ok(decls.has(u[1].toLowerCase()), `${name}: متغيّر غير مُعرّف ${u[1]}`);
    }
    checked++;
  }
  assert.ok(checked >= 11, `عدد الدوال المفحوصة ${checked}`);
});

test("كل دالّة 8D: SECURITY DEFINER + search_path + منح/نزع صحيح", () => {
  const fns = [...SQL.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(([^)]*)\)/gi)]
    .map((m) => ({ name: m[1], args: m[2] }));
  assert.ok(fns.length >= 10, `عدد الدوال ${fns.length}`);
  for (const f of fns) {
    const decl = SQL.match(new RegExp("create or replace function public\\." + f.name + "\\s*\\([^)]*\\)[\\s\\S]{0,240}?as \\$\\$"));
    assert.match(decl[0], /security definer/i, `${f.name} بلا SECURITY DEFINER`);
    assert.match(decl[0], /set search_path = public/i, `${f.name} بلا search_path آمن`);
    if (INTERNAL.includes(f.name)) {
      assert.match(SQL, new RegExp("revoke execute on function public\\." + f.name + "[^;]*from public, anon, authenticated"),
        `${f.name} مُساعد داخليّ ولم يُنزع من authenticated`);
      assert.doesNotMatch(SQL, new RegExp("grant execute on function public\\." + f.name + "\\("), `${f.name} مُساعد داخليّ ممنوح`);
    } else {
      assert.match(SQL, new RegExp("revoke execute on function public\\." + f.name + "[^;]*from public, anon"), `${f.name} بلا revoke`);
      assert.match(SQL, new RegExp("grant execute on function public\\." + f.name + "[^;]*to authenticated"), `${f.name} بلا grant`);
    }
  }
});

test("جدول الالتزامات: RLS قراءة فقط + نزع الكتابة صراحةً (عرف 5C)", () => {
  assert.match(SQL, /alter table public\.project_program_commitments enable row level security/, "RLS غير مفعّلة");
  assert.match(SQL, /create policy ppc_read on public\.project_program_commitments for select to authenticated\s*\n?\s*using \(public\.is_staff\(\) and public\.pc_can_read_project\(project_id\)\)/,
    "سياسة القراءة لا تجمع is_staff مع pc_can_read_project");
  assert.doesNotMatch(SQL, /create policy [a-z_]+ on public\.project_program_commitments for (all|insert|update|delete)/i,
    "سياسة كتابة مباشرة على الجدول");
  assert.match(SQL, /revoke insert, update, delete on public\.project_program_commitments from authenticated, anon/,
    "الكتابة لم تُنزع صراحةً من authenticated");
  assert.match(SQL, /grant select on public\.project_program_commitments to authenticated/, "لا منح قراءة");
});

test("الالتزام للبرنامج (master) وحده — حارس قاعدة لا RPC فقط", () => {
  const g = codeOf(funcBody("program_commitment_guard"));
  assert.match(g, /pc_is_master\(new\.project_id\)/, "الحارس لا يفحص master");
  assert.match(g, /raise exception 'program_requires_master'/, "الحارس لا يرفض غير الرئيسي");
  assert.match(SQL, /create trigger trg_program_commitment_guard before insert or update on public\.project_program_commitments/,
    "المُشغِّل ليس BEFORE INSERT OR UPDATE");
  const up = codeOf(funcBody("project_program_commitment_upsert"));
  assert.match(up, /pc_is_master\(p_project\)/, "الـRPC لا يفحص master (دفاع بطبقتين)");
});

// ═══════════════════════ صدق الطوابع الزمنية ═══════════════════════
test("التسليم الفعليّ من سجلّ المراحل حصرًا — ولا تاريخ يدويّ في أيّ دالّة", () => {
  const del = codeOf(funcBody("pgm_unit_delivered_at"));
  assert.match(del, /project_status_history/, "لا يُشتقّ من سجلّ المراحل");
  assert.match(del, /to_stage = 'delivered'/, "لا يقرأ انتقال التسليم");
  assert.match(del, /not in \('delivered','closed'\) then return null/, "يحتسب مرورًا عابرًا بالمرحلة");
  // الفخّان المؤكَّدان: كلاهما تاريخ يكتبه إنسان ولا يُختم عند أيّ حدث
  const all = liveCode(SQL);
  assert.doesNotMatch(all, /\bdelivery_date\b/, "8D يستعمل project_core.delivery_date اليدويّ");
  assert.doesNotMatch(all, /\bactual_release_date\b/, "8D يستعمل projects.actual_release_date اليدويّ");
  // وتوثيق أنّ الفخّ حقيقيّ في 8A لا افتراض
  assert.match(SQL8A, /actual_release_date/, "افتراض وجود العمود لم يعد صحيحًا");
  // والاختبار الذاتي داخل القاعدة يحرس الفخّين بنفسه (لا يعتمد على هذا الملف وحده)
  assert.match(SQL, /8D FAIL: المحرّك يستعمل delivery_date اليدويّ/, "self-test لا يحرس فخّ delivery_date");
  assert.match(SQL, /8D FAIL: المحرّك يستعمل actual_release_date اليدويّ/, "self-test لا يحرس فخّ actual_release_date");
});

test("activity_log لا يُستعمل كمصدر قياس (يبتلع الأخطاء)", () => {
  const all = liveCode(SQL);
  assert.doesNotMatch(all, /\bfrom public\.activity_log\b/, "قياس مبنيّ على سجلّ يبتلع أخطاءه");
  assert.match(all, /from public\.project_activity/, "لا استعمال للسجلّ المعاملاتيّ");
});

test("كل مقارنة يومية بتوقيت الرياض، ولا حساب مدد بالتوقيت المحلّي", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  const dayCmp = [...eng.matchAll(/::date/g)].length;
  assert.ok(dayCmp > 0, "لا مقارنات يومية أصلًا");
  const riyadh = [...eng.matchAll(/at time zone 'Asia\/Riyadh'\)::date/g)].length;
  assert.ok(riyadh >= 6, `مقارنات يومية بلا توقيت الرياض (${riyadh})`);
  // المدد تُحسب من timestamptz مباشرة (epoch) لا من تواريخ محلّية
  assert.match(eng, /extract\(epoch from \(/, "المدد لا تُحسب من الطوابع الزمنية");
});

// ═══════════════════════ صدق المعادلات والمقامات ═══════════════════════
test("كل نتيجة تعلن معادلتها ومقامها وحجم عيّنتها وسبب عدم توفّرها", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  for (const key of ["'formula_key'", "'formula_ar'", "'numerator'", "'denominator'",
                     "'sample_size'", "'source_quality'", "'missing_data_reason'", "'period_from'", "'period_to'"]) {
    assert.ok(eng.includes(key), `مفتاح ناقص في النتيجة: ${key}`);
  }
  // كل نوع التزام له معادلة معلنة
  const formulas = [...eng.matchAll(/v_formula := '([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(formulas.length >= 6, `معادلات معلنة: ${formulas.length}`);
});

test("لا قسمة على صفر ولا رقم عند غياب المقام", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  // نسبة التسليم: القسمة داخل فرع يشترط مقامًا موجبًا
  assert.match(eng, /if coalesce\(v_den,0\) = 0 then\s*\n?\s*v_quality := 'unavailable';/,
    "نسبة التسليم تُحسب بمقام صفر");
  assert.match(eng, /v_actual := round\(v_num \/ v_den \* 100, 1\);/, "معادلة النسبة مفقودة");
  // التنفيذي: نسبة مجمّعة null لا صفر
  const ex = codeOf(funcBody("executive_program_sla"));
  assert.match(ex, /case when v_ot_den > 0 then round\(v_ot_num \/ v_ot_den \* 100, 1\) else null end/,
    "النسبة التنفيذية تعطي ٠٪ بدل «غير متاح»");
});

test("المقام يستبعد ما لا يملك موعدًا مخطَّطًا أو تسليمًا فعليًّا", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /count\(\*\) filter \(where d\.planned is not null and d\.in_window\)/,
    "المقام لا يشترط وجود المخطَّط والتسليم داخل النافذة معًا");
  assert.match(eng, /no_unit_has_both_planned_and_actual/, "لا سبب معلن حين يخلو المقام");
});

test("«غير متاح» حالة أولى: لا رقم بلا مصدر، ولا صفر مكان المجهول", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /if v_quality = 'unavailable' or v_actual is null then\s*\n?\s*v_status := 'unavailable';/,
    "الحالة تُحسب رغم غياب المصدر");
  assert.match(eng, /v_status := 'unavailable'; v_missing := coalesce\(v_missing, 'no_target_value'\)/,
    "التزام بلا هدف يُعطى حالة كأنّه مقيس");
  for (const reason of ["no_units", "shoot_wrap_or_delivery_not_recorded",
                        "no_send_event_paired_with_a_client_decision", "no_revision_followed_by_a_new_version",
                        "no_decided_approval_in_period", "custom_commitment_has_no_declared_formula"]) {
    assert.ok(eng.includes(reason), `سبب غياب غير معلن: ${reason}`);
  }
});

test("اتجاه المقارنة مشتقّ من النوع: مدّة أقلّ أفضل، نسبة أعلى أفضل", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /if v_higher_better then/, "لا اتجاه للمقارنة");
  assert.match(eng, /when v_actual >= c\.target_value then 'met'/, "اتجاه «الأعلى أفضل» مفقود");
  assert.match(eng, /when v_actual <= c\.target_value then 'met'/, "اتجاه «الأقلّ أفضل» مفقود");
  // أنواع المدد تُعلن أنّ الأقلّ أفضل
  const dur = eng.match(/elsif c\.commitment_type = 'delivery_turnaround' then\s*\n\s*v_higher_better := (\w+)/);
  assert.equal(dur && dur[1], "false", "زمن التسليم يُقارن كأنّ الأعلى أفضل");
});

test("زمن التسليم من انتهاء تصوير موثَّق (wrap_time) لا من تاريخ جلسة", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /s\.status = 'completed' and s\.wrap_time is not null/,
    "زمن التسليم يُحسب من جلسة غير مكتملة أو بلا وقت انتهاء");
  assert.doesNotMatch(eng, /s\.session_date/, "استُعمل تاريخ الجلسة المخطَّط بدل الانتهاء الفعليّ");
});

test("زمن مراجعة العميل: من إرسال موثَّق إلى قرار العميل نفسه", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /a\.action = 'deliverable_sent_client'/, "لا حدث إرسال موثَّق");
  assert.match(eng, /public\.deliverable_reviews rv/, "قرار العميل لا يُقرأ من جدول مراجعات العميل");
  assert.match(eng, /a\.created_at <= rv\.created_at/, "قد يُطابَق قرار بإرسال لاحق له (مدّة سالبة)");
  assert.match(eng, /where r\.sent is not null and r\.decided >= r\.sent/, "لا حماية من المدد السالبة");
  // اعتماد الطاقم ليس قرار عميل
  assert.doesNotMatch(eng, /approved_at[\s\S]{0,40}review_turnaround/, "خلط اعتماد الطاقم بقرار العميل");
});

test("زمن التعديل يقبل مسارَي النسخ، وبمرجع أصل حقيقيّ لمسار العميل", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /project_deliverable_versions pv/, "مسار Project Core مفقود");
  assert.match(eng, /deliverable_versions dv/, "مسار تسليم العميل مفقود");
  assert.match(eng, /dv\.vimeo_review_url/, "لم يُشترط مرجع أصل ⇒ نسخة V1 التلقائية تُحتسب رفعًا");
});

test("زمن الاعتماد يعيد استخدام 5A ولا ينشئ نظام اعتماد موازيًا", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /public\.project_approvals ap/, "لا يستعمل جدول الاعتمادات القائم");
  assert.match(eng, /ap\.decided_at is not null and ap\.requested_at is not null/, "لا يشترط طابعَي الطلب والقرار");
  assert.doesNotMatch(liveCode(SQL), /create table if not exists public\.\w*approval/i, "جدول اعتمادات موازٍ");
});

// ═══════════════════════ التوقّع ═══════════════════════
test("التوقّع مشروط: عيّنة كافية، نافذة كافية، معدّل موجب، أفق معقول", () => {
  const f = codeOf(funcBody("project_program_sla_forecast"));
  assert.match(f, /if coalesce\(v_delivered,0\) < 3 then\s*\n?\s*v_freason := 'sample_size_below_minimum'/, "لا حدّ أدنى للعيّنة");
  assert.match(f, /coalesce\(v_days,0\) < 14/, "لا حدّ أدنى لنافذة القياس");
  assert.match(f, /elsif v_rate <= 0 then\s*\n?\s*v_freason := 'zero_delivery_rate'/, "قسمة على معدّل صفر");
  // السقف يُطبَّق على عدد الأيام قبل بناء التاريخ (تجنّب فيض ::int لهدف مبالَغ)
  assert.match(f, /if v_days > 1825 then v_eta := null; v_freason := 'projection_beyond_reasonable_horizon'/,
    "لا سقف للأفق ⇒ تاريخ غير منطقيّ أو فيض ::int");
  assert.match(f, /v_fstatus := 'unavailable'/, "لا حالة «غير متاح» للتوقّع");
  // بداية القياس من تسليم فعليّ (min على التسليم الموثَّق) لا من تاريخ مخطَّط
  assert.match(f, /min\(u\.at\)/, "بداية القياس من تاريخ مخطَّط");
  assert.match(f, /\(v_delivered - 1\) \/ \(v_days \/ 30\.0\)/, "المعدّل متحيّز (n بدل n-١)");
});

test("لا علم خرق مخزَّن — كل شيء مشتقّ", () => {
  assert.match(SQL, /column_name in \('actual_value','status','breached','is_breached','result','last_result'\)/,
    "self-test لا يحرس أعمدة النتيجة المخزَّنة");
  const ddl = SQL.slice(SQL.indexOf("create table if not exists public.project_program_commitments"),
                        SQL.indexOf("create unique index if not exists ux_ppc_project_key"));
  for (const bad of ["breached", "is_breached", "actual_value", "last_result", "current_status"]) {
    assert.ok(!new RegExp(`\\n\\s+${bad}\\s`).test(ddl), `عمود نتيجة مخزَّنة: ${bad}`);
  }
});

// ═══════════════════════ عزل العميل ═══════════════════════
test("سطح العميل: بوّابة عميل صريحة + العلم + فحص كل وحدة على حدة", () => {
  const cs = codeOf(funcBody("project_program_client_summary"));
  assert.match(cs, /if not coalesce\(public\.is_client_owner\(p_project\), false\) then raise exception 'not authorized'/,
    "لا بوّابة عميل صريحة");
  assert.match(cs, /client_program_view_enabled/, "العلم لا يُقرأ ⇒ سطح عميل بلا تفعيل");
  assert.match(cs, /raise exception 'client_program_view_disabled'/, "العلم لا يمنع شيئًا");
  // كل وحدة تُفحَص بذاتها — لا توريث وصول من الأب
  const perUnit = [...cs.matchAll(/coalesce\(public\.is_client_owner\(ch\.id\), false\)/g)].length;
  assert.ok(perUnit >= 2, `فحص الوحدة مستقلًّا ناقص (${perUnit})`);
  assert.doesNotMatch(cs, /pc_can_read_project/, "سطح العميل يستعمل بوّابة الطاقم (لن تمرّ أبدًا) أو يوسّعها");
});

test("سطح العميل لا يمسّ أيّ مصدر داخليّ", () => {
  const cs = codeOf(funcBody("project_program_client_summary"));
  for (const bad of ["project_risks", "project_issues", "project_decisions", "project_lessons",
                     "budget", "cost", "profit", "resource_booking", "planning_resources",
                     "project_costs", "governance", "closure_request", "admin_note_internal"]) {
    assert.ok(!cs.includes(bad), `سطح العميل يمسّ مصدرًا داخليًّا: ${bad}`);
  }
  assert.match(cs, /if coalesce\(\(r->>'client_visible'\)::boolean, false\) then/, "التزام غير معلَن للعميل قد يُعرض له");
});

test("لا دالّة إدارية بلا بوّابة، والبوّابة قبل أوّل قراءة مشروع", () => {
  const admin = ["project_program_commitment_results", "project_program_sla_forecast",
                 "project_program_delivery_matrix", "project_program_client_actions"];
  for (const n of admin) {
    const b = codeOf(funcBody(n));
    const gate = b.indexOf("pc_can_read_project");
    assert.ok(gate > -1, `${n} بلا بوّابة قراءة`);
    const firstRead = b.search(/from public\.(projects|project_core|deliverables)\b/i);
    assert.ok(firstRead === -1 || gate < firstRead, `${n}: القراءة قبل البوّابة`);
    assert.match(b, /program_can\(/, `${n} بلا بوّابة صلاحية البرنامج`);
  }
  // المُحرِّك الداخليّ لا يُمنح لأحد؛ بوّابته من مُستدعيه
  assert.match(SQL, /revoke execute on function public\.pgm_commitment_results_core\(uuid,date,date,boolean\) from public, anon, authenticated/,
    "المُحرِّك الداخليّ ممنوح");
  assert.doesNotMatch(SQL, /grant execute on function public\.pgm_commitment_results_core/, "منح للمُحرِّك الداخليّ");
});

test("8D لا يعيد تعريف أيّ بوّابة وصول ولا دالّة خارج نطاقه", () => {
  const created = [...SQL.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
  const allowed = ["program_commitment_guard", "project_program_commitment_upsert", "project_program_commitment_archive",
    "pgm_unit_delivered_at", "pgm_commitment_results_core", "project_program_commitment_results", "project_program_sla_forecast",
    "project_program_delivery_matrix", "project_program_client_actions", "project_program_client_summary",
    "program_sla_attention", "executive_program_sla"];
  for (const f of created) assert.ok(allowed.includes(f), `دالّة خارج النطاق: ${f}`);
  for (const gate of ["can_access_project", "pc_can_read_project", "is_client_owner", "is_client_side",
                      "can_manage_projects", "can_edit_project", "program_can", "is_staff",
                      "exec_visible_projects", "ops_visible_ids", "pc_is_master"]) {
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + gate + "\\b"), `إعادة تعريف بوّابة: ${gate}`);
  }
});

test("عزل الأب عن الفرع: أبناء مباشرون فقط، وبلا مستوى ثالث", () => {
  for (const n of ["project_program_delivery_matrix", "project_program_client_actions",
                   "project_program_client_summary", "pgm_commitment_results_core"]) {
    const b = codeOf(funcBody(n));
    assert.match(b, /parent_project_id = (p_project|v_pid)/, `${n} لا يقتصر على الأبناء المباشرين`);
    assert.doesNotMatch(b, /with recursive/i, `${n} يتوسّع لمستوى ثالث`);
  }
});

// ═══════════════════════ أداء ═══════════════════════
test("المصفوفة: ترقيم داخل الاستعلام لا FILTER على التجميع", () => {
  const m = codeOf(funcBody("project_program_delivery_matrix"));
  assert.match(m, /limit v_limit offset v_offset/, "لا ترقيم داخل الاستعلام");
  assert.match(m, /counted as \(select count\(\*\) as n from filtered\)/, "الإجمالي لا يُحسب قبل التقطيع");
  // الاستعلامات المرتبطة داخل jsonb_agg تعمل على الصفحة فقط
  const pageIdx = m.indexOf("page as (");
  const aggIdx = m.indexOf("jsonb_agg(jsonb_build_object(");
  assert.ok(pageIdx > -1 && aggIdx > pageIdx, "التجميع لا يعمل على الصفحة");
  assert.match(m, /least\(greatest\(coalesce\(\(p_filters->>'limit'\)::int, 50\), 1\), 200\)/, "الحدّ غير مقيَّد");
});

test("لا استدعاء متكرّر لدالّة التسليم داخل نفس الصفّ", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  const volume = eng.slice(eng.indexOf("total_unit_volume','periodic_unit_volume'"), eng.indexOf("on_time_delivery_rate' then"));
  assert.match(volume, /cross join lateral \(select public\.pgm_unit_delivered_at\(ch\.id\) as delivered_at\)/,
    "التسليم يُحسب أكثر من مرّة لكل وحدة");
  const cnt = [...volume.matchAll(/pgm_unit_delivered_at/g)].length;
  assert.ok(cnt <= 2, `استدعاءات زائدة للتسليم في كتلة الحجم (${cnt})`);
});

test("تكامل العمليات/التنفيذي محدود ومقيَّد بحدّ أعلى", () => {
  const a = codeOf(funcBody("program_sla_attention"));
  assert.match(a, /ops_can_view\(\)/, "مركز العمليات بلا بوّابته");
  assert.match(a, /ops_visible_ids\(/, "لا يعيد استخدام مجموعة العمليات المرئية");
  assert.match(a, /project_scope = 'master'/, "يفحص مشاريع ليست برامج");
  assert.match(a, /limit v_limit/, "بلا حدّ أعلى ⇒ مسح غير محدود");
  const e = codeOf(funcBody("executive_program_sla"));
  assert.match(e, /exec_visible_projects\(/, "التنفيذي لا يستعمل المجموعة المرئية القائمة");
  assert.match(e, /limit v_limit/, "التنفيذي بلا حدّ أعلى");
  assert.match(e, /score_note/, "لا تصريح بأنّ SLA قسم معلوماتيّ");
});

// ═══════════════════════ لا مالية / Zoho / عهدة / تقدّم ═══════════════════════
test("8D لا يكتب مالية ولا Zoho ولا عهدة ولا تقدّم ولا مرحلة", () => {
  const all = liveCode(SQL);
  for (const bad of [/zoho/i, /custody/i, /invoice/i, /\binsert into public\.project_costs\b/,
                     /update\s+public\.project_core\s+set/, /progress_manual/, /\bset\b[^;]*\bcore_stage\s*=/,
                     /delete from public\./]) {
    assert.doesNotMatch(all, bad, `8D يمسّ مصدرًا محظورًا: ${bad}`);
  }
  // الكتابات الوحيدة المسموحة: جدول الالتزامات نفسه + بذر كتالوج الصلاحيات
  const ALLOWED_WRITES = new Set(["project_program_commitments", "permissions"]);
  const writes = [...all.matchAll(/\b(insert into|update)\s+public\.([a-z_]+)/gi)].map((m) => m[2]);
  assert.ok(writes.length > 0, "لا كتابات أصلًا — المسح لم يطابق شيئًا");
  for (const w of writes) assert.ok(ALLOWED_WRITES.has(w), `كتابة خارج نطاق 8D: ${w}`);
});

test("الأرشفة إخفاء ناعم بسبب إلزاميّ — ولا حذف", () => {
  const a = codeOf(funcBody("project_program_commitment_archive"));
  assert.match(a, /raise exception 'reason_required'/, "أرشفة بلا سبب");
  assert.match(a, /set archived_at = now\(\)/, "الأرشفة لا تُسجَّل");
  assert.doesNotMatch(a, /delete from/i, "الأرشفة تحذف");
  assert.match(a, /pc_log\(/, "الأرشفة بلا تدقيق");
});

test("قفل متفائل حقيقيّ: القفل قبل فحص النسخة", () => {
  const u = codeOf(funcBody("project_program_commitment_upsert"));
  const lock = u.indexOf("for update");
  const check = u.indexOf("stale_update");
  assert.ok(lock > -1 && check > lock, "فحص النسخة قبل القفل ⇒ كتابتان متزامنتان تمرّان");
  assert.match(u, /version\s*=\s*version \+ 1/, "النسخة لا تتقدّم");
  assert.match(u, /when unique_violation then raise exception 'duplicate_commitment_key'/, "تصادم المفتاح يظهر كخطأ خام");
});

test("الفهرس الفريد على المفتاح جزئيّ — والمؤرشف لا يحجزه", () => {
  assert.match(SQL, /create unique index if not exists ux_ppc_project_key[\s\S]{0,200}where archived_at is null/,
    "الفهرس غير جزئيّ ⇒ لا يمكن إعادة استخدام مفتاح مؤرشف");
  // لا ON CONFLICT على هذا الفهرس الجزئيّ (سيرفع 42P10 بلا شرطه)
  const conflicts = [...SQL.matchAll(/on conflict \(([^)]*)\)([^;]*)/g)];
  for (const [, cols, rest] of conflicts) {
    if (cols.includes("project_id") && cols.includes("commitment_key")) {
      assert.match(rest, /where/, "ON CONFLICT على فهرس جزئيّ بلا شرطه ⇒ 42P10");
    }
  }
});

// ═══════════════════════ طبقة TypeScript ═══════════════════════
test("TS: كل غلاف يشير إلى RPC معرَّف في 8D، ولا RPC بلا مستهلك", () => {
  const called = new Set([...TS.matchAll(/prpc<[^>]*>\("([a-z_]+)"/g)].map((m) => m[1]));
  const defined = new Set([...SQL.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]));
  for (const c of called) assert.ok(defined.has(c), `غلاف يستدعي RPC غير معرَّف: ${c}`);
  for (const d of defined) {
    if (INTERNAL.includes(d)) continue;
    assert.ok(called.has(d), `RPC بلا مستهلك: ${d}`);
  }
});

test("TS: «غير متاح» ممثَّلة في الأنواع ولا تُعرض صفرًا", () => {
  assert.match(TS, /on_time_delivery_rate: number \| null;/, "النسبة التنفيذية لا تقبل «غير متاح»");
  assert.match(TS, /actual_delivery_at: string \| null;/, "التسليم الفعليّ لا يقبل «غير موثَّق»");
  assert.match(TS, /v == null \? "—"/, "القيمة الغائبة تُطبع ٠");
  for (const r of ["no_units", "shoot_wrap_or_delivery_not_recorded", "no_target_value"]) {
    assert.ok(TS.includes(r), `سبب غياب غير مترجَم: ${r}`);
  }
});

// ═══════════════════════ الواجهة ═══════════════════════
test("الواجهة لا تحسب SLA ولا تشتقّ حالة — الخادم وحده", () => {
  const c = tsCode(UI);
  assert.doesNotMatch(c, /\/\s*denominator|numerator\s*\//, "قسمة SLA في المتصفّح");
  assert.doesNotMatch(c, /status\s*=\s*["'](met|breached)["']/, "اشتقاق حالة في الواجهة");
  assert.match(c, /r\?\.status \?\? "unavailable"/, "الحالة لا تأتي من الخادم");
  assert.match(c, /MISSING_REASON_AR\[r\.missing_data_reason\]/, "سبب الغياب لا يُعرض");
  assert.match(c, /r\.formula_ar/, "المعادلة لا تُعرض للمستخدم");
});

test("الواجهة: تسليم غير موثَّق يُعرض نصًّا لا تاريخًا ملفَّقًا", () => {
  assert.match(UI, /r\.actual_delivery_at \? r\.actual_delivery_at\.slice\(0, 10\) : t\(\{ ar: "غير موثَّق"/,
    "تسليم غير موثَّق يظهر فارغًا أو كتاريخ");
  assert.match(UI, /MISSING_AR/, "تحذيرات نقص البيانات غير معروضة");
});

test("الواجهة: ترقيم وفلاتر خادمية وتصدير CSV بحدود واضحة", () => {
  assert.match(UI, /offset: off/, "الترقيم ليس خادميًّا");
  assert.match(UI, /status: st \|\| undefined, search: q \|\| undefined/, "الفلاتر ليست خادمية");
  assert.match(UI, /csvDownload\(/, "لا تصدير CSV");
  assert.match(UI, /من الصفحة الحالية/, "التصدير يوهم بأنّه يشمل كل الوحدات");
  assert.match(UI, /window\.print\(\)/, "لا طباعة");
  assert.doesNotMatch(tsCode(UI), /budget|profit|cost|amount/i, "بيانات مالية في المصفوفة");
});

test("الواجهة: حرس تسلسل + تفكيك + إعادة محاولة + منع إرسال مزدوج", () => {
  assert.match(UI, /my !== seq\.current/, "بلا حرس آخر-طلب-يفوز");
  assert.match(UI, /alive\.current = false/, "بلا حرس تفكيك");
  assert.ok((UI.match(/إعادة المحاولة/g) || []).length >= 3, "حالة خطأ بلا إعادة محاولة");
  assert.match(UI, /if \(busy\) return;/, "بلا منع إرسال مزدوج");
  assert.match(UI, /initial\?\.version/, "الحفظ بلا نسخة متوقَّعة ⇒ لا قفل متفائل");
});

test("الواجهة: لا تذكير تلقائيّ للعميل ولا قناة إشعارات جديدة", () => {
  const c = tsCode(UI);
  assert.doesNotMatch(c, /notify|reminder|sendEmail|whatsapp/i, "8D ينشئ تذكيرًا أو قناة إشعار");
  assert.match(UI, /\{data\.note\}/, "تنبيه «عرض فقط» غير معروض");
});

test("الواجهة: إتاحة وصول ونماذج موسومة وحوار قابل للإغلاق", () => {
  assert.match(UI, /role="tablist"/, "أقسام بلا tablist");
  assert.match(UI, /role="tab" aria-selected/, "تبويب بلا aria-selected");
  assert.match(UI, /role="tabpanel"/, "لا tabpanel");
  assert.match(UI, /role="dialog" aria-modal="true"/, "حوار بلا دور");
  assert.match(UI, /e\.key === "Escape"/, "الحوار لا يُغلق بـEscape");
  assert.match(UI, /role="alert"/, "الخطأ لا يُعلَن");
  const ids = [...UI.matchAll(/htmlFor="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 8, "حقول بلا وسوم");
  for (const id of ids) assert.ok(UI.includes(`id="${id}"`), `وسم بلا حقل: ${id}`);
  assert.match(UI, /env\(safe-area-inset-bottom\)/, "الحوار تحت حافة الجهاز");
  assert.match(UI, /grid-cols-2 sm:grid-cols-4/, "البطاقات لا تلتفّ على الجوال");
});

test("التبويب مربوط بالمشروع الرئيسي وحده وبتنقّل عميق صحيح", () => {
  assert.match(PROJOPS, /\{ k: "program_sla", ar: "الالتزامات والتسليم"/, "التبويب غير مُعرَّف");
  assert.match(PROJOPS, /tb\.k !== "program_sla" \|\| isMaster/, "التبويب يظهر لغير البرنامج");
  assert.match(PROJOPS, /initialTab === "program_sla" && isMaster/, "الرابط العميق لا يُحسم بعد وصول الهرمية");
  assert.match(PROJOPS, /tab === "program_sla"\) && !isMaster/, "الخفض يترك منطقة فارغة");
  assert.match(PROJOPS, /tab === "program_sla" && isMaster && <ProgramSlaTab/, "التبويب بلا محتوى");
});

test("تكامل مركز العمليات والإدارة التنفيذية موصول فعلًا", () => {
  assert.match(OPS_UI, /programSlaAttention\(/, "مركز العمليات لا يستهلك 8D");
  assert.match(OPS_UI, /\{ k: "sla", ar: "التزامات البرامج"/, "لا تبويب SLA في مركز العمليات");
  assert.match(OPS_UI, /tab === "sla" && <ProgramSlaPanel/, "تبويب بلا محتوى");
  assert.match(OPS_UI, /\?tab=program_sla/, "صفّ SLA لا يفتح وجهة حقيقية");
  assert.match(EXEC_UI, /executiveProgramSla\(/, "الإدارة التنفيذية لا تستهلك 8D");
  assert.match(EXEC_UI, /\{d\.score_note\}/, "لا تصريح بأنّ SLA معلوماتيّ");
  assert.match(EXEC_UI, /d\.on_time_delivery_rate == null \? "غير متاح"/, "النسبة الغائبة تُعرض ٠٪");
});

test("إعادة التطبيق آمنة: كل شيء IF NOT EXISTS / OR REPLACE", () => {
  assert.match(SQL, /create table if not exists public\.project_program_commitments/, "إنشاء جدول غير آمن للإعادة");
  assert.match(SQL, /create unique index if not exists/, "فهرس غير آمن للإعادة");
  assert.match(SQL, /drop trigger if exists trg_program_commitment_guard/, "المُشغِّل غير آمن للإعادة");
  assert.match(SQL, /drop policy if exists ppc_read/, "السياسة غير آمنة للإعادة");
  assert.match(SQL, /on conflict \(key\) do nothing/, "بذر الصلاحيات غير آمن للإعادة");
  // كل الدوال بصيغة OR REPLACE
  const bare = [...SQL.matchAll(/^create function /gim)];
  assert.equal(bare.length, 0, "دالّة بلا OR REPLACE");
});

test("الصلاحيات المضافة لها نقطة إنفاذ فعلية (درس 7A)", () => {
  const keys = [...SQL.matchAll(/\('(programs\.[a-z_.]+)','projects_tasks'/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ["programs.commitments.manage", "programs.commitments.view"], "مفاتيح غير متوقّعة");
  for (const k of keys) {
    const uses = [...SQL.matchAll(new RegExp(`program_can\\([^,]+, '${k.replace(/\./g, "\\.")}'\\)`, "g"))];
    assert.ok(uses.length >= 1, `صلاحية بلا نقطة إنفاذ: ${k}`);
  }
  // والفئة هي الوحيدة القابلة للعرض في شاشة الصلاحيات
  const prof = read("lib/portal/professions.ts");
  assert.match(prof, /projects_tasks/, "الفئة projects_tasks لم تعد معروضة ⇒ مفاتيح غير قابلة للمنح");
});

// ═══════════════════════ حراس انحدار من المراجعة العدائية ═══════════════════════
test("انحدار: النِّسَب والمدد تُقصّ بالنافذة (لا رقم عمريّ بعنوان فترة)", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  // on_time و delivery_turnaround يقصّان على تاريخ التسليم الفعليّ
  const ontime = eng.slice(eng.indexOf("on_time_delivery_rate' then"), eng.indexOf("delivery_turnaround' then"));
  assert.match(ontime, /in_window/, "نسبة التسليم لا تُقصّ بالنافذة");
  const deliv = eng.slice(eng.indexOf("delivery_turnaround' then"), eng.indexOf("review_turnaround' then"));
  assert.match(deliv, /d\.actual at time zone 'Asia\/Riyadh'\)::date >= v_from/, "زمن التسليم لا يُقصّ بالنافذة");
});

test("انحدار: نوع دوريّ بلا نافذة ⇒ غير متاح لا صفر مخروق", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  // النوع الدوريّ يزوّد نافذته الشهرية، وإن بقيت فارغة فالنتيجة غير متاحة
  assert.match(eng, /commitment_type in \('periodic_unit_volume','monthly_output'\) and \(v_from is null or v_to is null\)/,
    "النوع الدوريّ لا يزوّد نافذته");
  assert.match(eng, /if v_units = 0 then\s*\n?\s*v_quality := 'unavailable'; v_missing := 'no_units'; v_actual := null; v_num := null;/,
    "حجم صفر لا يُفرَّغ actual (يظهر ٠ مخروقًا)");
});

test("انحدار: نافذة مقلوبة ⇒ غير متاح", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /if v_from is not null and v_to is not null and v_from > v_to then\s*\n?\s*v_quality := 'unavailable'; v_missing := 'measurement_window_empty'/,
    "النافذة المقلوبة تُنتِج رقمًا");
});

test("انحدار: المدد تُحوَّل لوحدة الهدف أو تُرفض", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /if v_is_duration and v_actual is not null/, "لا تحويل وحدة للمدد");
  assert.match(eng, /c\.target_unit = 'minutes' then v_actual := v_actual \* 60/, "تحويل الدقائق مفقود");
  assert.match(eng, /c\.target_unit = 'days'    then v_actual := v_actual \/ 24/, "تحويل الأيام مفقود");
  assert.match(eng, /target_unit_incompatible_with_duration/, "الوحدة غير المتوافقة لا تُرفض");
});

test("انحدار: الرؤية الجزئية تُعلَن (بسط محكوم برؤية ومقام هدف ثابت)", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(eng, /v_all_units is not null and v_units < v_all_units/, "لا كشف للرؤية الجزئية");
  assert.match(eng, /v_quality := 'partial'; v_missing := 'partial_unit_visibility'/, "الرؤية الجزئية لا تُبلَّغ");
  // v_all_units لا بدّ أن يُعدّ كل الأبناء (بلا فلتر رؤية) وإلّا ساوى v_units دائمًا
  assert.match(eng, /count\(\*\)\s*\n?\s*into v_num, v_units, v_all_units/, "v_all_units ليس عدًّا مطلقًا");
  assert.match(eng, /filter \(where vis\.ok\)/, "عدد الوحدات المرئية لا يحمل فلتر الرؤية بنفسه");
});

test("انحدار: رؤية العميل تُطبَّق في كل فروع القياس لا في الحجم وحده", () => {
  const core = codeOf(funcBody("pgm_commitment_results_core"));
  // كل فرع مقيس يبدّل الرؤية حسب p_client_view — وإلّا ظهر كل التزام نِسبة/مدّة
  // معلَن للعميل «غير متاح» له دائمًا (لا يمرّ pc_can_read_project أبدًا).
  assert.equal((core.match(/is_client_owner\(ch\.id\)/g) || []).length >= 7, true, "رؤية العميل ليست في كل الفروع");
  assert.doesNotMatch(core, /\n\s+and public\.pc_can_read_project\(ch\.id\)\s*\n/, "فرع يقصر الرؤية على الطاقم");
});

test("انحدار: سطح العميل يستدعي المُحرِّك برؤية العميل لا بوّابة الطاقم", () => {
  const cs = codeOf(funcBody("project_program_client_summary"));
  assert.match(cs, /pgm_commitment_results_core\(p_project, null, null, true\)/,
    "ملخّص العميل يستدعي الواجهة المحروسة (تعود فارغة له) بدل المُحرِّك برؤية العميل");
  assert.doesNotMatch(cs, /project_program_commitment_results\(/, "لا يزال يستدعي الواجهة الطاقميّة");
  // المُحرِّك يبدّل مُحدِّد الرؤية حسب p_client_view
  const core = codeOf(funcBody("pgm_commitment_results_core"));
  assert.match(core, /case when p_client_view then coalesce\(public\.is_client_owner\(ch\.id\),false\)/,
    "المُحرِّك لا يبدّل الرؤية للعميل");
});

test("انحدار: سطح العميل له مستهلك حيّ", () => {
  const consumer = read("components/portal/projectcore/ClientProgramSummary.tsx");
  assert.match(consumer, /programClientSummary\(projectId\)/, "المستهلك لا يستدعي RPC العميل");
  const page = read("app/client-portal/projects/[id]/page.tsx");
  assert.match(page, /<ClientProgramSummary projectId=\{id\}/, "الصفحة لا تُركّب سطح العميل");
});

test("انحدار: التنفيذي يحسب عدّادات المحفظة لكل برنامج مرئيّ (لا يُسقطها لمن بلا SLA)", () => {
  const ex = codeOf(funcBody("executive_program_sla"));
  const monthIdx = ex.indexOf("units delivered".length > 0 ? "v_month := v_month" : "v_month");
  const contIdx = ex.indexOf("v_nodata := v_nodata + 1; continue");
  assert.ok(monthIdx > -1 && contIdx > -1 && monthIdx < contIdx, "عدّاد الشهر بعد تخطّي من بلا SLA");
  assert.match(ex, /order by p\.project_name, p\.id/, "مسح غير حتميّ (LIMIT بلا ORDER BY)");
  assert.match(ex, /'programs_truncated'/, "الاقتطاع لا يُبلَّغ");
  assert.match(ex, /not v_ot_counted/, "نسبة التسليم تُحسب أكثر من مرّة لكل برنامج");
});

test("انحدار: مركز العمليات لا يبتلع رفض الصلاحية كـ«لا خطر»", () => {
  const a = codeOf(funcBody("program_sla_attention"));
  assert.match(a, /pgm_commitment_results_core\(v_pid, null, null, false\)/, "لا يزال يستدعي الواجهة المحروسة داخل try/catch");
});

test("انحدار: مصفوفة «متأخّرة» تحترم تاريخ النشر المخطَّط", () => {
  const m = codeOf(funcBody("project_program_delivery_matrix"));
  assert.match(m, /v_status = 'late'[\s\S]{0,240}coalesce\(e\.planned_release_date, e\.due_date\) < v_today/,
    "فلتر «متأخّرة» يتجاهل planned_release_date");
});

test("انحدار: ما ينتظر العميل يحسب waiting_since مرّة (LATERAL) ويرتّب قبل الاقتطاع", () => {
  const ca = codeOf(funcBody("project_program_client_actions"));
  assert.match(ca, /cross join lateral \(\s*\n?\s*select coalesce\(/, "waiting_since لا يُحسب مرّة عبر LATERAL");
  assert.match(ca, /order by ws\.waiting_since asc nulls last\s*\n?\s*limit v_limit/, "LIMIT قبل الترتيب");
});

test("انحدار: الحارس يعفي الأرشفة على برنامج مخفَّض", () => {
  const g = codeOf(funcBody("program_commitment_guard"));
  assert.match(g, /new\.archived_at is not null and old\.archived_at is null/, "الأرشفة لا تُعفى ⇒ صفوف عالقة بعد الخفض");
});

test("انحدار: الصفوف المحذوفة ناعمًا مستبعَدة من القياس", () => {
  const eng = codeOf(funcBody("pgm_commitment_results_core"));
  for (const tbl of ["deliverable_reviews rv", "project_approvals ap", "client_comments cc"]) {
    const alias = tbl.split(" ")[1];
    assert.match(eng, new RegExp(`coalesce\\(${alias}\\.is_deleted,false\\) = false`), `${tbl} بلا استبعاد المحذوف`);
  }
});

test("انحدار: الواجهة تعرض خطأ المحرّك ونافذة القياس، ولا تقرأ الرفض كـ«غير متاح»", () => {
  assert.match(UI, /setResErr\(r\.ok \? "" : slaErr\(r\.error\)\)/, "خطأ المحرّك يُبتلع");
  assert.match(UI, /r\?\.period_from \|\| r\?\.period_to/, "نافذة القياس غير معروضة على البطاقة");
  assert.match(UI, /source_quality === "partial"/, "شارة «جزئيّ» مفقودة");
  assert.match(UI, /CLOSURE_STATUS\[r\.closure_status/, "حالة الإغلاق تُعرض رمزًا خامًّا");
  assert.match(UI, /MATRIX_PRINT_CSS/, "طباعة بلا ورقة أنماط");
});
