// ════════════════════════════════════════════════════════════════════════════
// tests/project_portfolio_ux_9b.test.js — Batch 9 Part 2: المحفظة الهرمية.
// الافتراض الحاكم: «الفرع يظهر مرّتين، أو يُحسب مرّتين، أو العميل/الموظف يرى ما لا
// يملك، أو الأرقام لا تعتمد نفس المجموعة المرئية».
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const SQL = read("docs/project_portfolio_ux_batch9b_RUNME.sql");
const TS = read("lib/portal/portfolio.ts");
const UI = read("components/portal/projectcore/PortfolioView.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");
// يزيل التعليقات السطرية والمضمَّنة (لا يوجد -- داخل نصوص هذا الملف).
const codeOf = (s) => s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
const tsCode = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`); return m[1];
}

test("SQL 9B بنيوي: Preflight، Transaction، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*9B PREFLIGHT/i, "لا Preflight");
  assert.equal((SQL.match(/^begin;\s*$/gim) || []).length, 1, "begin; ليس ١");
  assert.equal((SQL.match(/^commit;\s*$/gim) || []).length, 1, "commit; ليس ١");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '9B FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(codeOf(SQL), /create\s+temp(orary)?\s+table/i, "جدول مؤقّت في قراءة Runtime");
  assert.doesNotMatch(codeOf(SQL), /\bdrop\s+(table|function)\b/i, "DROP");
  for (const tag of ["$$", "$pre$", "$selftest$"]) assert.equal((SQL.split(tag).length - 1) % 2, 0, `${tag} غير متوازن`);
});

test("لا متغيّر plpgsql غير مُعرّف", () => {
  const b = codeOf(funcBody("project_portfolio_overview"));
  const decls = new Set();
  for (const dm of b.matchAll(/\bdeclare\b([\s\S]*?)\bbegin\b/gi))
    for (const v of dm[1].matchAll(/(^|;)\s*([a-z_][a-z0-9_]*)\s+[a-z]/gi)) decls.add(v[2].toLowerCase());
  for (const p of (SQL.match(/project_portfolio_overview\s*\(([^)]*)\)/) || ["", ""])[1].matchAll(/\b(p_[a-z0-9_]+)\b/gi)) decls.add(p[1].toLowerCase());
  for (const u of b.matchAll(/\b(v_[a-z0-9_]+)\b/gi)) assert.ok(decls.has(u[1].toLowerCase()), `متغيّر غير مُعرّف ${u[1]}`);
});

test("عزل: الواجهة العامّة is_staff، والمُساعد الداخليّ pc_can_read لكل صفّ وغير ممنوح", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  assert.match(ov, /if not coalesce\(public\.is_staff\(\), false\) then raise exception 'not authorized'/, "لا بوّابة طاقم");
  const rows = codeOf(funcBody("pgf_portfolio_rows"));
  assert.match(rows, /public\.pc_can_read_project\(p\.id\)/, "بلا عزل لكل صفّ");
  assert.match(SQL, /revoke execute on function public\.pgf_portfolio_rows\(\) from public, anon, authenticated/, "المُساعد ممنوح");
  assert.doesNotMatch(SQL, /grant execute on function public\.pgf_portfolio_rows/, "منح للمُساعد الداخليّ");
  assert.match(SQL, /grant execute on function public\.project_portfolio_overview\(jsonb\) to authenticated/, "الواجهة بلا منح");
});

test("لا مالية في المحفظة (لا كشف ميزانية/ربح/تكلفة)", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  const rows = codeOf(funcBody("pgf_portfolio_rows"));
  for (const bad of [/budget/i, /profit/i, /actual_cost/i, /estimated_cost/i]) {
    assert.doesNotMatch(ov, bad, `المحفظة تكشف ${bad}`);
    assert.doesNotMatch(rows, bad, `صفوف المحفظة تكشف ${bad}`);
  }
});

test("الفرع مرّة واحدة: bucket أحاديّ لكل صفّ، لا عدّ مزدوج", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  // تصنيف أحاديّ: master/child/orphan/quick/standard في تعبير case واحد
  assert.match(ov, /as bucket/, "بلا تصنيف bucket");
  assert.match(ov, /when f\.parent_project_id in \(select id from flags where project_scope='master'\)\s*\n?\s*then 'child' else 'orphan' end/, "الفرع بلا رئيسيّ مرئيّ لا يُصنَّف orphan");
  // الأقسام: masters=bucket master، standalone=standard+orphan، quick=quick — لا تداخل
  assert.match(ov, /where m\.bucket = 'master'/, "قسم الرئيسية ليس bucket master");
  assert.match(ov, /where s\.bucket in \('standard','orphan'\)/, "قسم المستقلة ليس standard+orphan");
  assert.match(ov, /where q\.bucket = 'quick'/, "قسم السريعة ليس bucket quick");
  // الفروع (child) لا تظهر كقسم مستقلّ — فقط مضمَّنة تحت الرئيسيّ
  assert.doesNotMatch(ov, /bucket in \('child'/, "الفرع يظهر كقسم مستقلّ (عدّ مزدوج)");
});

test("العدّادات على نفس المجموعة المرئية (classified) لا على استعلام أوسع", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  // كل عدّاد من classified (المجموعة المرئية المصنَّفة)، لا من public.projects مباشرة في العدّادات
  const summaryBlock = ov.slice(ov.indexOf("'summary'"), ov.indexOf("'masters', jsonb_build_object"));
  assert.ok(!/from public\.projects\b/.test(summaryBlock), "عدّاد يقرأ من projects مباشرةً (مجموعة مختلفة)");
  assert.ok((summaryBlock.match(/from classified/g) || []).length >= 10, "العدّادات لا تعتمد classified");
});

test("ترقيم خادميّ لكل قسم (row_number + limit/offset)", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  for (const cte of ["master_rows", "standalone_rows", "quick_rows"]) {
    assert.match(ov, new RegExp(cte + " as \\(\\s*\\n?\\s*select row_number\\(\\) over"), `${cte} بلا row_number`);
  }
  // ترقيم مستقلّ لكل قسم (تصفّح الرئيسية لا يُخفي المستقلة/السريعة)
  assert.match(ov, /rn > v_moff and rn <= v_moff \+ v_limit/, "قسم الرئيسية بلا offset مستقلّ");
  assert.match(ov, /rn > v_soff and rn <= v_soff \+ v_limit/, "قسم المستقلة بلا offset مستقلّ");
  assert.match(ov, /rn > v_qoff and rn <= v_qoff \+ v_limit/, "قسم السريعة بلا offset مستقلّ");
  assert.match(ov, /least\(greatest\(coalesce\(\(p_filters->>'limit'\)::int, 50\), 1\), 200\)/, "الحدّ غير مقيَّد");
});

test("بحث الفرع يشمل رئيسيّه (auto-expand في الواجهة)", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  // master يُطابق البحث إن طابقه أحد فروعه
  assert.match(ov, /exists \(select 1 from classified c where c\.parent_project_id = m\.id and c\.bucket='child'\s*\n?\s*and \(c\.project_name ilike/, "بحث الفرع لا يُظهر الرئيسيّ");
  // الواجهة توسّع الرئيسيّ المطابق فرعه تلقائيًّا
  assert.match(UI, /if \(q\.trim\(\)\) setExpanded\(new Set\(r\.data\.masters\.rows\.filter\(\(m\) => m\.children\.some/, "الواجهة لا توسّع رئيسيّ الفرع المطابق");
});

test("رئيسيّ يحمل تجميع الفروع منفصلًا عن إنجازه الخاصّ", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  assert.match(ov, /'own_progress', m\.progress_pct/, "لا إنجاز خاصّ بالرئيسيّ");
  assert.match(ov, /'children_progress', ru\.children_progress/, "لا إنجاز تجميعيّ للفروع");
  assert.match(ov, /'child_count', coalesce\(ru\.child_count,0\)/, "لا عدّ فروع");
  // التجميع من الفروع المرئية فقط
  assert.match(ov, /from classified c where c\.bucket = 'child' group by c\.parent_project_id/, "التجميع ليس من الفروع المرئية");
});

test("توقيت الرياض للمقارنات اليومية", () => {
  assert.match(codeOf(funcBody("pgf_portfolio_rows")), /now\(\) at time zone 'Asia\/Riyadh'/, "لا توقيت رياض");
});

// ─── الواجهة ───
test("TS: الغلاف يستدعي RPC معرَّف في 9B", () => {
  assert.match(TS, /prpc<PortfolioOverview>\("project_portfolio_overview"/, "الغلاف لا يستدعي RPC 9B");
  assert.match(SQL, /create or replace function public\.project_portfolio_overview/, "RPC غير معرَّف");
});

test("الواجهة: مصدر واحد مشتقّ (لا N+1) + حرس تسلسل/تفكيك + إعادة محاولة", () => {
  assert.match(UI, /projectPortfolioOverview\(/, "لا تستهلك المحفظة");
  assert.equal((tsCode(UI).match(/await (prpc|pget|projectPortfolioOverview)/g) || []).length, 1, "أكثر من نداء (N+1)");
  assert.match(UI, /my !== seq\.current/, "بلا حرس تسلسل");
  assert.match(UI, /alive\.current = false/, "بلا حرس تفكيك");
  assert.match(UI, /إعادة المحاولة/, "بلا إعادة محاولة");
});

test("الواجهة: شارات النوع نصّية (لا لون فقط) + عرض مجمّع/مسطّح", () => {
  assert.match(TS, /portfolioBadge/, "لا مُصنِّف شارات");
  assert.match(TS, /master.*برنامج|برنامج/, "شارة برنامج مفقودة");
  assert.match(TS, /"⚡ سريع"/, "شارة سريع مفقودة");
  assert.match(UI, /view === "grouped" \? \(/, "لا فرع للعرض المجمّع");
  assert.match(UI, /<FlatList/, "لا عرض مسطّح");
  // العرض المسطّح يُظهر الشارات
  assert.match(UI, /badge: portfolioBadge\("master"/, "المسطّح بلا شارة رئيسيّ");
  assert.match(UI, /badge: portfolioBadge\("quick"\)/, "المسطّح بلا شارة سريع");
  assert.match(UI, /"↳ فرعي"/, "المسطّح بلا شارة فرع");
});

test("الواجهة: الرئيسيّ قابل للتوسيع، الضغط عليه يفتح البرنامج/الفروع، والفرع يفتح مباشرة", () => {
  assert.match(UI, /aria-expanded=\{expanded\}/, "بطاقة الرئيسيّ بلا aria-expanded");
  assert.match(UI, /\?tab=\$\{m\.operating_experience === "program" \? "program" : "subprojects"\}/, "الرئيسيّ لا يفتح إدارة البرنامج/الفروع");
  assert.match(UI, /href=\{`\/client-portal\/project-core\/\$\{c\.id\}`\}/, "الفرع لا يُفتح مباشرة");
});

test("الواجهة: بطاقة السريع مختصرة (لا Gantt/حوكمة/موارد)", () => {
  const quickBlock = UI.slice(UI.indexOf("⚡ المشاريع السريعة"), UI.indexOf("view === \"flat\"") > -1 ? UI.length : UI.length);
  assert.doesNotMatch(tsCode(UI), /Gantt|governance|resource_conflict|budget|profit/i, "السريعة تعرض تفاصيل ثقيلة/مالية");
});

test("انحدار: كل قسم له offset مستقلّ في الواجهة (تصفّح قسم لا يُخفي الآخرين)", () => {
  assert.match(UI, /const \[mOff, setMOff\] = useState\(0\); const \[sOff, setSOff\] = useState\(0\); const \[qOff, setQOff\] = useState\(0\)/, "لا offset مستقلّ لكل قسم");
  assert.match(UI, /<Pager total=\{data\.masters\.total\} offset=\{mOff\} onPage=\{setMOff\}/, "ترقيم الرئيسية مشترك");
  assert.match(UI, /<Pager total=\{data\.standalone\.total\} offset=\{sOff\} onPage=\{setSOff\}/, "ترقيم المستقلة مشترك");
  assert.match(UI, /<Pager total=\{data\.quick\.total\} offset=\{qOff\} onPage=\{setQOff\}/, "ترقيم السريعة مشترك");
  assert.match(UI, /master_offset: mo, standalone_offset: so, quick_offset: qo/, "الأوفستات لا تُرسل للخادم");
  // التنقّل في التبويبات يعيد تعيين كل الصفحات
  assert.match(UI, /const resetPages = \(\) => \{ setMOff\(0\); setSOff\(0\); setQOff\(0\); \}/, "لا إعادة تعيين للصفحات عند البحث/الفلتر");
});

test("انحدار: تجميع الرئيسيّ يعيد استخدام rollup (لا مسح مرتبط O(masters×rows))", () => {
  const ov = codeOf(funcBody("project_portfolio_overview"));
  // العدّادات البرنامجية تنضمّ إلى rollup بدل exists المرتبط
  assert.match(ov, /classified m left join rollup ru on ru\.master_id=m\.id\s*\n?\s*where m\.bucket='master' and \(m\.f_late or coalesce\(ru\.late_children,0\) > 0\)/, "عدّاد المتأخر لا يعيد استخدام rollup");
  assert.match(ov, /'nearest_due', ru\.nearest_due/, "nearest_due لا يُقرأ من rollup");
  assert.match(ov, /min\(c\.due_date\) filter \(where c\.due_date is not null\) as nearest_due/, "nearest_due غير مجمَّع في rollup");
});

test("الدمج: المحفظة هي العرض الأساسيّ، والمؤشّرات القديمة خلف قسم كسول قابل للتوسيع", () => {
  assert.match(DASH, /<PortfolioView view=\{pfView\} onView=\{setPfView\}/, "المحفظة ليست العرض الأساسيّ");
  assert.match(DASH, /const \[showClassic, setShowClassic\] = useState\(false\)/, "لا قسم مؤشّرات تفصيلية");
  assert.match(DASH, /if \(showClassic\) void load\(filter, search\)/, "المؤشّرات القديمة لا تُحمَّل كسولًا");
  assert.match(DASH, /المؤشرات التفصيلية/, "لا زرّ توسيع المؤشّرات");
  // العدّادات والقائمة القديمة لا تزال موجودة (لم تُحذف)
  assert.match(DASH, /cards\.map\(\(cd\)/, "عدّادات اللوحة القديمة حُذفت");
  assert.match(DASH, /shownRows\.map\(\(p\) => <ProjectRowCard/, "القائمة القديمة حُذفت");
});
