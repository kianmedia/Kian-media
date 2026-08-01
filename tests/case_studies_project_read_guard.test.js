// ════════════════════════════════════════════════════════════════════════════
// tests/case_studies_project_read_guard.test.js
//
// case_studies_platform_RUNME.sql سقط على الإنتاج قبل COMMIT بـ:
//     SELF-TEST: cs_snapshot_build(uuid) تقرأ من منصّة المشاريع
//
// وهو **إنذار كاذب**. الفحص كان `d ilike '%deliverables%'` على نصّ التعريف
// كاملًا، والملتقَط عمودٌ اسمه **deliverables_summary_ar** على cs_case_studies
// نفسها — نصٌّ حرّ تكتبه دراسة الحالة عمّا سُلِّم، لا الجدول المجمَّد.
// والدالّة تقرأ من cs_* وحدها.
//
// عاشر ظهور لصنف «طابق الاسم لا الشكل» في هذا البرنامج. فالحكم الآن على
// **جملة قراءة أو كتابة** تستهدف الاسم كاملًا بحدّ كلمة، على الشيفرة بعد حذف
// التعليقات وتفريغ السلاسل.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const CS = () => read("docs/case_studies_platform_RUNME.sql") || "";

/** نظير cs_exec_code في SQL: تعليقات محذوفة، محتوى السلاسل مُفرَّغ. */
function execCode(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { i += 2; continue; } q = false; out += "''"; } i++; continue; }
    if (c === "'") { q = true; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    out += c; i++;
  }
  return out;
}
/** القاعدة نفسها المكتوبة في الفحص الذاتيّ. */
const READS_PLATFORM = (code) =>
  /\b(from|join|update|into|delete\s+from)\s+(only\s+)?(public\.)?(projects|project_core|deliverables|deliverable_internal)\b/i.test(code)
  || /\b(public\.)?(projects|project_core|deliverables|deliverable_internal)\s*\.\s*[a-z_]/i.test(code)
  || /\bto_jsonb\s*\(\s*(p|proj|projects|d|deliverables)\s*\)/i.test(code);
const judge = (sql) => READS_PLATFORM(execCode(sql));

// ─── Fixtures: يُدان ───────────────────────────────────────────────────────

test("(١) ★★ قراءة فعلية من public.projects تُدان ★★", () => {
  assert.ok(judge("select p.name from public.projects p where p.id = $1;"), "لم تُدن قراءة صريحة");
});
test("(٢) ★ JOIN فعليّ مع projects يُدان ★", () => {
  assert.ok(judge("select 1 from public.cs_case_studies c join public.projects p on p.id = c.project_id;"),
    "لم يُدن ضمّ مع منصّة المشاريع");
});
test("(٣) ★ نسخ صفّ كامل / select * / to_jsonb(project row) يُدان ★", () => {
  assert.ok(judge("insert into public.cs_snapshots select * from public.projects;"), "نسخ صفّ كامل مرّ");
  assert.ok(judge("select to_jsonb(p) from public.projects p;"), "to_jsonb لصفّ مشروع مرّ");
  assert.ok(judge("select projects.name from projects;"), "مرجع مؤهَّل بالجدول مرّ");
});
test("(٤) ★ deliverables الحقيقيّ يُدان ★", () => {
  assert.ok(judge("select d.title from public.deliverables d;"), "قراءة من deliverables مرّت");
});

// ─── Fixtures: يمرّ ────────────────────────────────────────────────────────

test("(٥) ★★ العمود deliverables_summary_ar يمرّ — وهو ما أسقط الإنتاج ★★", () => {
  assert.ok(!judge("select public.cs_sanitize_block(c.deliverables_summary_ar) from public.cs_case_studies c;"),
    "العمود deliverables_summary_ar أُدين بوصفه الجدول المجمَّد");
});
test("(٦) ★ تعليق يذكر projects يمرّ ★", () => {
  assert.ok(!judge("-- لا نقرأ من public.projects إطلاقًا\nselect 1 from public.cs_media;"), "أُدين تعليق");
});
test("(٧) ★ سلسلة نصّية تذكر projects تمرّ ★", () => {
  assert.ok(!judge("select 'لا تُنسخ من public.projects' as note from public.cs_media;"), "أُدينت سلسلة");
});
test("(٨) ★ مفتاح JSON باسم project يمرّ ★", () => {
  assert.ok(!judge("select jsonb_build_object('project_id', c.project_id, 'projects', null) from public.cs_case_studies c;"),
    "أُدين مفتاح JSON");
});
test("(٩) ★ مرجع project_id وحده بلا قراءة الجدول يمرّ ★", () => {
  assert.ok(!judge("select c.project_id from public.cs_case_studies c where c.project_id is not null;"),
    "أُدين مرجع المعرّف — والمرجع هو المسموح، والنسخ هو الممنوع");
});

// ─── الملفّ الحقيقيّ ───────────────────────────────────────────────────────

test("(١٠) ★★ الدوالّ السبع المحروسة لا تقرأ من منصّة المشاريع ★★", () => {
  const s = CS();
  const FNS = ["cs_snapshot_build", "cs_mask", "cs_public_row", "cs_upsert",
               "cs_public_index", "cs_public_study", "cs_publish"];
  const bad = [];
  for (const fn of FNS) {
    const i = s.indexOf(`create or replace function public.${fn}`);
    if (i < 0) continue;
    const h = s.slice(i, i + 400);
    const t = h.match(/as (\$[a-z0-9_]*\$)/);
    if (!t) continue;
    const st = i + h.indexOf(t[1]) + t[1].length;
    const en = s.indexOf(t[1], st);
    if (en < 0) continue;
    if (judge(s.slice(i, en))) bad.push(fn);
  }
  assert.deepEqual(bad, [], `دوالّ تقرأ من منصّة المشاريع: ${bad.join(", ")}`);
});

test("(١١) ★★ الفحص الذاتيّ يحكم بالشكل لا بالسلسلة الجزئية ★★", () => {
  const code = execCode(CS());
  assert.doesNotMatch(code, /d ilike '%deliverables%'/, "عادت السلسلة الجزئية");
  assert.match(code, /cs_exec_code/, "الفحص لا يجرّد التعليقات والسلاسل قبل الحكم");
  // ⚠️ نمط الفحص يقع داخل سلسلة SQL، وexecCode يُفرّغ السلاسل بحكم وظيفته —
  //    فيُقاس على النصّ الخام. أداةُ التجريد تُستعمل حيث تلزم لا في كلّ سؤال.
  assert.match(CS(), /from\|join\|update\|into\|delete/, "الفحص بلا شكل جملة قراءة");
  // ولم يُستثنَ اسم الدالّة التي سقطت.
  assert.doesNotMatch(code, /t\s*<>\s*'cs_snapshot_build/, "استُثنيت الدالّة باسمها بدل إصلاح الحكم");
  assert.match(CS(), /'cs_snapshot_build\(uuid\)'/, "حُذفت الدالّة من قائمة الحراسة");
  // والحارس ما زال **يرفع** — لا يكفي بقاء النمط إن أُفرغ أثره.
  assert.match(CS(), /raise exception 'SELF-TEST: % تقرأ من منصّة المشاريع/,
    "الحارس فقد RAISE — النمط باقٍ بلا أثر");
});

test("(١٢) ★ الحزمة لا تكتب على منصّة المشاريع إطلاقًا ★", () => {
  const code = execCode(CS());
  assert.doesNotMatch(code, /\b(insert\s+into|update|delete\s+from)\s+(public\.)?(projects|project_core|deliverables|deliverable_internal)\b/i,
    "كتابة على منصّة المشاريع المجمَّدة");
});

test("(١٣) ★ لا مصدر حقيقة موازٍ: كلّ جداول الحزمة cs_* ★", () => {
  const tables = [...CS().matchAll(/create table if not exists public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  const rogue = tables.filter((t) => !t.startsWith("cs_"));
  assert.deepEqual(rogue, [], `جدول خارج عائلة cs_: ${rogue.join(", ")}`);
  for (const t of ["cs_projects", "cs_clients", "cs_deliverables"]) {
    assert.ok(!tables.includes(t), `نسخة موازية: ${t}`);
  }
});

// ─── تطابق الحارسين: RUNME وPOSTCHECK ─────────────────────────────────────

const POST = () => read("docs/case_studies_platform_POSTCHECK.sql") || "";

test("(١٤) ★★ RUNME وPOSTCHECK يحكمان بالعقد نفسه ★★", () => {
  // نجح الفحص الذاتيّ في RUNME وأدان POSTCHECK الشيفرة نفسها — وهذا وحده عطب،
  // لأنّ أحد الحكمين كذبٌ حتمًا. القاعدة الآن نصٌّ واحد في الملفّين.
  const RULE = /\\m\(from\|join\|update\|into\|delete\\s\+from\)\\s\+\(only\\s\+\)\?\(public\\\.\)\?\(projects\|project_core\|deliverables\|deliverable_internal\)\\M/;
  for (const [name, sql] of [["RUNME", CS()], ["POSTCHECK", POST()]]) {
    assert.match(sql, RULE, `${name} بلا قاعدة الشكل المشتركة`);
    assert.match(sql, /cs_exec_code/, `${name} لا يجرّد التعليقات والسلاسل قبل الحكم`);
  }
  // ⚠️ الصيغة القديمة **سلسلة نصّية بذاتها** ('%deliverables%')، وexecCode
  //    يُفرّغ محتوى السلاسل بحكم وظيفته — فالبحث عنها فيه مستحيل. تُقاس على
  //    النصّ بعد حذف التعليقات فقط: الشرح يُستثنى، والشيفرة تُقاس بحرفها.
  const noComments = (sql) => sql.split("\n").map((l) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "'") q = !q;
      else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
    }
    return l;
  }).join("\n");
  for (const [name, sql] of [["RUNME", CS()], ["POSTCHECK", POST()]]) {
    assert.doesNotMatch(noComments(sql), /ilike '%deliverables%'|ilike '%public\.projects%'|ilike '%project_core%'/,
      `${name} ما زال يطابق سلسلة جزئية على نصّ التعريف`);
    // وكلّ نداء pg_get_functiondef في فحص التجميد يمرّ عبر cs_exec_code.
    const freeze = noComments(sql).match(/r_no_project_read[\s\S]{0,1400}/);
    if (freeze) {
      const raw = [...freeze[0].matchAll(/pg_get_functiondef\(/g)].length;
      const wrapped = [...freeze[0].matchAll(/cs_exec_code\(pg_get_functiondef\(/g)].length;
      assert.equal(raw, wrapped, `${name}: ${raw - wrapped} نداء pg_get_functiondef بلا تجريد`);
    }
  }
});

test("(١٥) ★★ الحكمان متطابقان على نفس الـFixtures ★★", () => {
  const FIX = [
    ["select public.cs_sanitize_block(c.deliverables_summary_ar) from public.cs_case_studies c;", false],
    ["update public.cs_case_studies set deliverables_summary_ar = 'x';", false],
    ["select c.project_id from public.cs_case_studies c;", false],
    ["-- from public.projects\nselect 1 from public.cs_media;", false],
    ["select 'from public.deliverables' from public.cs_media;", false],
    ["select jsonb_build_object('project', 1) from public.cs_media;", false],
    ["select 1 from public.projects;", true],
    ["select 1 from public.cs_media m join public.deliverables d on d.id = m.id;", true],
    ["update public.projects set name = 'x';", true],
    ["select * from public.projects;", true],
    ["select to_jsonb(p) from public.projects p;", true],
  ];
  for (const [sql, expected] of FIX) {
    assert.equal(judge(sql), expected,
      `حكم مختلف عن المتوقَّع على: ${sql.slice(0, 60)}`);
  }
});

test("(١٦) ★ إزالة حدود الكلمة تُعيد الإنذار الكاذب — وتسقط ★", () => {
  const loose = (sql) => /(from|join|update|into|delete\s+from)?[\s\S]*?(projects|deliverables)/i.test(execCode(sql));
  const col = "select public.cs_sanitize_block(c.deliverables_summary_ar) from public.cs_case_studies c;";
  assert.ok(loose(col), "الصيغة الفضفاضة لا تُظهر الإنذار الكاذب — المقارنة بلا معنى");
  assert.ok(!judge(col), "الصيغة المرسّاة أدانت العمود");
});

test("(١٧) ★ تعطيل تنظيف التعليقات والسلاسل يُعيد الإدانة ★", () => {
  const raw = "-- from public.projects\nselect 1 from public.cs_media;";
  assert.ok(READS_PLATFORM(raw), "بلا تجريد، التعليق يُدان — وهذا ما نمنعه");
  assert.ok(!judge(raw), "مع التجريد، التعليق يمرّ");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
