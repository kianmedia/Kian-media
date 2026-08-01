// ════════════════════════════════════════════════════════════════════════════
// tests/final_platform_acceptance_contract.test.js
//
// حزمة القبول النهائيّ ليست ترحيلة: تقرأ، وتُحاكي جلسةً، وتقرأ ثانية، ثمّ تنتهي
// بلا أثر. وأخطر ما فيها أن تدّعي نجاحًا لا تملك إثباته — فالبنود التي لا
// تُثبَت إلّا في متصفّح يجب أن تبقى MANUAL_REQUIRED ولا تتحوّل إلى PASS.
//
// وهذه الحزمة تُكتب بعد أربعة عشر تطبيقًا على الإنتاج، فتُقاس بكلّ صنف عطلٍ
// ظهر فيها: هويّة دالّة نصّية، ومرجع CTE أماميّ، وUNION مختلف الأعمدة، ومنطقيّ
// في عمود نصّيّ، وفحصٍ لا يفشل، وتعليقٍ يُقرأ شيفرةً، وشرطة سفليّة في LIKE.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const PRE = "docs/final_platform_acceptance_PREFLIGHT.sql";
const RUN = "docs/final_platform_acceptance_RUNME.sql";
const POST = "docs/final_platform_acceptance_POSTCHECK.sql";
const MAN = "docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.md";

function stripComments(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "''"; i += 2; continue; } q = false; } out += c; i++; continue; }
    if (c === "'") { q = true; out += c; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    out += c; i++;
  }
  return out;
}
/** الشيفرة التنفيذيّة: بلا تعليقات ومحتوى السلاسل مُفرَّغ. */
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
const stmtCount = (code) => {
  let d = 0, n = 0;
  for (const ch of code) { if (ch === "(") d++; else if (ch === ")") d--; else if (ch === ";" && d === 0) n++; }
  return n;
};

test("(١) ★ الملفّات الأربعة موجودة وبالامتداد الصحيح ★", () => {
  for (const f of [PRE, RUN, POST, MAN]) assert.ok(read(f), `مفقود: ${f}`);
  assert.ok(!fs.existsSync(path.join(ROOT, "docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.sql")),
    "الدليل اليدويّ حُوِّل إلى SQL");
  for (const f of [PRE, RUN, POST]) assert.doesNotMatch(read(f).trimStart(), /^#{1,6}\s/, `${f} يبدأ بـMarkdown`);
});

test("(٢) ★★ PREFLIGHT: قراءة فقط · جملة واحدة · بلا معاملة ★★", () => {
  const c = execCode(read(PRE));
  assert.doesNotMatch(c, /^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke)\s/im, "يكتب");
  assert.doesNotMatch(c, /\b(begin|commit|rollback)\s*;/i, "يفتح معاملة");
  assert.doesNotMatch(c, /exception when others/i, "catch-all");
  assert.equal(stmtCount(c), 1, "ليست جملة واحدة");
});

test("(٣) ★★ PREFLIGHT: الأحكام الثلاثة، وREADY ممنوع بلا الحسابات ★★", () => {
  const s = read(PRE);
  for (const v of ["READY", "READY_WITH_MANUAL_STEPS", "STOP"]) assert.ok(s.includes(v), `الحكم ${v} مفقود`);
  const c = stripComments(s);
  // أيّ فشل في حساب مطلوب يمنع READY: الحسابات ضمن rows_all وأيّ FAIL يُخرج READY
  assert.match(c, /when exists \(select 1 from rows_all where verdict = 'FAIL'\)[\s\S]{0,80}?READY_WITH_MANUAL_STEPS/,
    "READY لا يُمنَع عند فشل حساب اختبار");
  for (const k of ["owner_account_available", "non_owner_staff_available", "client_account_available"])
    assert.ok(c.includes(k), `فحص الحساب مفقود: ${k}`);
});

test("(٤) ★★ لا بيانات شخصيّة في أيّ مخرَج ★★", () => {
  for (const f of [PRE, RUN, POST]) {
    const c = execCode(read(f));
    for (const [what, re] of [["بريد", /\b(email|e_mail)\b/i], ["جوّال", /\b(phone|mobile|whatsapp)\b/i],
                              ["اسم", /\b(full_name|display_name|first_name|last_name)\b/i]])
      assert.doesNotMatch(c, re, `${f}: يقرأ ${what} — المخرَج يجب أن يكون أعدادًا وبادئة UUID`);
    if (/profiles/.test(c)) assert.match(read(f), /left\(\s*\w+\.?\w*\.?id::text,\s*8\s*\)|count\(\*\)/,
      `${f}: يقرأ profiles بلا اختصار المعرّف إلى ثمانية محارف`);
  }
});

test("(٥) ★★ RUNME: صفر كتابة على أيّ جدول دائم ★★", () => {
  const c = execCode(read(RUN));
  // الكتابة الوحيدة المسموحة: جدول التقرير المؤقّت
  const writes = [...c.matchAll(/\b(insert\s+into|update|delete\s+from)\s+([a-z_.]+)/gi)]
    .map((m) => m[2].toLowerCase())
    .filter((t) => !/kian_acceptance_report/.test(t));
  assert.deepEqual(writes, [], `كتابة على جدول دائم: ${writes.join(", ")}`);
  assert.doesNotMatch(c, /\b(grant|revoke|alter\s+table|alter\s+function)\b/i, "يغيّر صلاحيّات أو بنية");
  assert.doesNotMatch(c, /create\s+(or\s+replace\s+)?(function|table(?!\s+if\s+not\s+exists)?)\s+public\./i,
    "ينشئ كائنًا دائمًا");
  // ولا ينادي الدوالّ الكاتبة
  for (const fn of ["mgmt_dashboard", "mgmt_refresh", "mgmt_export", "mgmt_log"])
    assert.ok(!new RegExp(`public\\.${fn}\\s*\\(`).test(c),
      `ينادي ${fn} — وهي تكتب في mgmt_report_cache/mgmt_audit وتُقدّم المتسلسلات`);
});

test("(٦) ★★ RUNME: برهان الكتابة الصفريّة من المحرّك، وبقاء الجلسة نظيفة ★★", () => {
  const c = execCode(read(RUN));
  assert.match(c, /pg_stat_xact_user_tables/, "لا برهان محرّكيّ على الكتابة الصفريّة");
  // ⚠️ الآليّة تُقاس على الشيفرة، والرسالةُ على النصّ المُبقي للسلاسل:
  //    execCode يُفرّغ محتوى السلاسل، فالبحث عن نصّ الرسالة فيه يمحو المطلوب.
  assert.match(c, /if\s+v_n\s*>\s*0\s+then[\s\S]{0,80}?raise exception/i,
    "لا إجهاض عند اكتشاف كتابة");
  assert.match(stripComments(read(RUN)), /ACCEPTANCE ABORTED/,
    "رسالة الإجهاض لا تسمّي السبب");
  // المحاكاة محلّيّة وتُنظَّف.
  // ⚠️ تُقاس على النصّ المُبقي للسلاسل: «set local role» يُنفَّذ عبر
  //    execute '…' فهو **داخل** سلسلة، وexecCode يُفرّغ السلاسل فيمحوه.
  const sc = stripComments(read(RUN));
  assert.match(sc, /set local role/i, "لا محاكاة دور");
  assert.match(sc, /set_config\('request\.jwt\.claims'[\s\S]{0,120}?,\s*true\s*\)/,
    "المطالبات غير محلّيّة");
  assert.ok((sc.match(/reset role/gi) || []).length >= 4, "الدور لا يُعاد بعد كلّ شخصيّة");
  assert.doesNotMatch(sc, /set_config\('request\.jwt\.claims'[\s\S]{0,120}?,\s*false\s*\)/,
    "مطالبات غير محلّيّة تبقى بعد المعاملة");
});

test("(٧) ★★ RUNME: MANUAL_REQUIRED لا يصير PASS ★★", () => {
  const s = read(RUN);
  const c = stripComments(s);
  // ⚠️ لا عتبة عدديّة: حذفُ بندٍ واحد كان يمرّ لأنّ البنود الشرطيّة تُكمل العدد.
  //    كلّ رحلة واجهة تُطالَب باسمها بحكم MANUAL_REQUIRED.
  for (const j of ["ui.owner_view_renders", "ui.non_owner_denied", "ui.client_denied",
                   "ui.case_studies_lifecycle", "ui.liveops_no_cost", "ui.ai_disabled_state"]) {
    const m = new RegExp(`'${j.replace(".", "\\.")}',\\s*'([A-Z_]+)'`).exec(c);
    assert.ok(m, `رحلة الواجهة مفقودة: ${j}`);
    assert.equal(m[1], "MANUAL_REQUIRED", `${j}: أُعلن ${m[1]} وهو لا يُثبَت إلّا في متصفّح`);
  }
  // الحكم الكلّيّ لا يقول READY وفيها MANUAL_REQUIRED
  assert.match(c, /MANUAL_REQUIRED[\s\S]{0,120}?READY_WITH_MANUAL_STEPS/,
    "وجود MANUAL_REQUIRED لا يمنع READY");
  // وكلّ بند يدويّ يسمّي مكانه
  assert.ok(c.includes("FINAL_PLATFORM_ACCEPTANCE_MANUAL.md"), "لا إحالة إلى الدليل اليدويّ");
});

test("(٨) ★★ RUNME يغطّي عقود الأدوار والمال والحزم ★★", () => {
  const c = stripComments(read(RUN));
  for (const k of ["owner.gates", "staff.no_sensitive", "client.denied", "anon.zero_access",
                   "finance.bases_separated", "finance.recognized_stays_null", "finance.vat_excluded",
                   "finance.mixed_currency_not_summed", "finance.no_profit_inference",
                   "packages.four_intact", "packages.no_project_writes", "packages.no_external_http",
                   "ai.provider_disabled", "harness.wrote_nothing"])
    assert.ok(c.includes(k), `بند القبول مفقود: ${k}`);
});

test("(٩) ★★ POSTCHECK: قراءة فقط · جملة واحدة · أحكام مصنَّفة ★★", () => {
  const c = execCode(read(POST));
  assert.doesNotMatch(c, /^\s*(insert|update|delete|create|alter|drop|truncate|grant|revoke)\s/im, "يكتب");
  assert.doesNotMatch(c, /\b(begin|commit|rollback)\s*;/i, "يفتح معاملة");
  assert.doesNotMatch(c, /exception when others/i, "catch-all");
  assert.equal(stmtCount(c), 1, "ليست جملة واحدة");
  const s = stripComments(read(POST));
  for (const v of ["'PASS'", "'FAIL'", "'INFO'", "'MANUAL_REQUIRED'"])
    assert.ok(s.includes(v), `حكم غير مدعوم: ${v}`);
});

test("(١٠) ★★ أصناف الأعطال السابقة كلّها مُغلقة في الملفّات الثلاثة ★★", () => {
  for (const f of [PRE, RUN, POST]) {
    const s = read(f), c = execCode(s), sc = stripComments(s);
    // ⚠️ الأنماط **سلاسل نصّية**، وexecCode يُفرّغ السلاسل — ففحصُها عليه أجوف
    //    بالبناء: لا يرى شيئًا أبدًا. تُقاس على النصّ المُبقي للسلاسل.
    // شرطة سفليّة في LIKE: '_' محرف بدل — يجب أن تُهرَّب مع escape
    for (const m of sc.matchAll(/like\s+'([^']*)'/gi)) {
      if (/[a-z]_%/.test(m[1]) && !/\\_/.test(m[1]))
        assert.fail(`${f}: LIKE بشرطة سفليّة غير مهرَّبة: ${m[1]}`);
    }
    // هويّة دالّة نصّية: أنواعٌ فقط
    for (const m of stripComments(s).matchAll(/'((?:public\.)?[a-z_][a-z0-9_]*\(([^')]*)\))'/gi)) {
      if (!m[2].trim()) continue;
      for (const a of m[2].split(",")) {
        const p = a.trim().split(/\s+/);
        if (p.length > 1 && !/^(double|timestamp|time|character|bit|with|without)$/i.test(p[0]))
          assert.fail(`${f}: هويّة دالّة باسم وسيط: ${m[1]}`);
      }
    }
    // حدود تكرار regex فوق 255 → 2201B
    for (const m of sc.matchAll(/\{\d*,(\d+)\}/g))
      assert.ok(Number(m[1]) <= 255, `${f}: حدّ تكرار ${m[1]} > 255 يرفع 2201B`);
    // لا فحص عاجز عن الفشل في الملفّين المُصنِّفين
    if (f !== RUN) {
      const cases = [...stripComments(s).matchAll(/case\s+when[\s\S]{0,400}?end/gi)]
        .filter((x) => /'PASS'/.test(x[0]));
      for (const x of cases)
        assert.ok(/'FAIL'|'INFO'|'STOP'|'MANUAL_REQUIRED'|'READY/.test(x[0]),
          `${f}: حكمٌ لا يملك بديلًا عن PASS`);
    }
  }
});

test("(١١) ★★ الدليل اليدويّ توثيقٌ محذَّر ويغطّي الرحلات الستّ ★★", () => {
  const m = read(MAN);
  assert.match(m, /DO NOT PASTE INTO THE SQL EDITOR/, "بلا تحذير إنجليزيّ");
  assert.match(m, /لا يُنسخ إلى محرّر SQL/, "بلا تحذير عربيّ");
  for (const s of ["§1", "§2", "§3", "§4", "§5", "§6"]) assert.ok(m.includes(s), `قسم مفقود: ${s}`);
  // البند الحاسم: مفتاح صلاحيات لا يفتح الحسّاس
  assert.match(m, /exec_report\.view/, "لا اختبار لمفتاح الصلاحيات ضدّ الحسّاس");
  assert.ok(m.length > 3000, "الدليل أقصر من أن يكون قابلًا للتنفيذ");
});

test("SAFE: ساكن فقط (لا شبكة ولا عمليّة ولا مفتاح خدمة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")],
                            ["مفتاح خدمة", new RegExp("\\b" + "service_" + "role\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
