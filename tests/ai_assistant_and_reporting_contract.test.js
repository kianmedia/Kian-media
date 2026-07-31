// ════════════════════════════════════════════════════════════════════════════
// tests/ai_assistant_and_reporting_contract.test.js
//   الحزمتان الوحيدتان اللتان كانتا بلا اختبار واحد. العقد هنا:
//   المساعد لا يدّعي ذكاءً حيًّا ولا يتصل بمزوّد ولا يتجاوز صلاحية المستعمل،
//   والتقارير طبقة قراءة لا مصدر حقيقة، ولا تخلط المحصَّل بالمفوتَر.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const AI = () => read("docs/kian_ai_assistant_RUNME.sql") || "";
const ER = () => read("docs/executive_reporting_RUNME.sql") || "";
function codeOnly(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "  "; i += 2; continue; } q = false; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}

// ─── AI Assistant ──────────────────────────────────────────────────────────

test("(AI-1) ★★ لا اتصال خارجيّ ولا مفتاح API في المستودع ★★", () => {
  const c = codeOnly(AI());
  for (const [what, re] of [
    ["pg_net/http/dblink", /\b(pg_net|net\.http|http_(get|post|put|delete)|dblink)\b/i],
    ["مزوّد خارجيّ", /\b(api\.openai|api\.anthropic|generativelanguage)\b/i],
    ["مفتاح مضمَّن", /\b(sk-[a-z0-9]{8,}|bearer\s+[a-z0-9]{16,})/i],
  ]) assert.doesNotMatch(c, re, `${what} داخل حزمة تُعلن أنّها بلا مزوّد`);
});

test("(AI-2) ★★ الوضع معلَن: معطَّل أو يحتاج إعدادًا — لا ادّعاء ★★", () => {
  const s = AI();
  assert.match(s, /disabled|configuration_required|not_connected|telemetry_not_connected/i,
    "لا يُعلن وضعًا صريحًا عند غياب المزوّد");
  // ولا يدّعي ثقة رقمية بلا أساس.
  const c = codeOnly(s);
  assert.doesNotMatch(c, /\bconfidence\s*[:=]\s*0?\.\d/i, "ثقة رقمية مزعومة بلا قياس");
});

test("(AI-3) ★ كلّ أداة تحتاج تفويضًا مستقلًّا، والافتراض قراءة فقط ★", () => {
  const s = AI();
  assert.match(s, /ai_can_|not authorized|insufficient/i, "لا بوّابة تفويض للأدوات");
  assert.match(s, /read_only|readonly|قراءة فقط/i, "لا إعلان أنّ الافتراض قراءة فقط");
});

test("(AI-4) ★★ تنقيح الحقول الحسّاسة قبل أيّ تجميع Prompt ★★", () => {
  const s = AI();
  assert.match(s, /ai_neutralize|redact|تنقيح|مُقنَّع/i, "لا تنقيح قبل بناء الطلب");
  // ولا مالية أو رواتب في مصادر التلخيص المسموحة.
  const c = codeOnly(s);
  for (const t of ["fin_costs", "payroll", "hr_salaries"]) {
    assert.doesNotMatch(c, new RegExp(`\\bfrom\\s+public\\.${t}\\b`, "i"), `مصدر محظور في التلخيص: ${t}`);
  }
});

test("(AI-5) ★ تدقيق لكلّ طلب، ولا كتابة على منصّة المشاريع ★", () => {
  const s = AI(), c = codeOnly(s);
  assert.match(s, /ai_log|ai_audit/i, "بلا تدقيق");
  assert.doesNotMatch(c, /\b(insert into|update|delete from)\s+(public\.)?(projects|project_core|deliverables)\b/i,
    "كتابة على منصّة المشاريع المجمَّدة");
});

// ─── Executive Reporting ───────────────────────────────────────────────────

test("(ER-1) ★★ طبقة قراءة: لا كتابة على المصادر ★★", () => {
  const c = codeOnly(ER());
  for (const t of ["fin_receivables", "fin_revenue", "crm_leads", "csub_ledger", "projects", "deliverables"]) {
    assert.doesNotMatch(c, new RegExp(`\\b(insert into|update|delete from)\\s+(public\\.)?${t}\\b`, "i"),
      `التقارير تكتب على مصدر: ${t}`);
  }
});

test("(ER-2) ★★ لا خلط المحصَّل بالمفوتَر بقيمة العقد ★★", () => {
  const s = ER();
  // المفاهيم الثلاثة يجب أن تُسمّى منفصلةً لا أن تُجمع تحت اسم واحد.
  // ⚠️ ثغرة حقيقية مفتوحة: الحزمة تُخرج ربحًا وهامشًا (estimated_net_profit ·
  //    gross_margin_pct) ولا تفصل **المحصَّل** عن **المفوتَر** عن **قيمة العقد**.
  //    لم أُغلقها في هذه الجولة — إغلاقها قرار دلاليّ ماليّ يخصّ المالك، لا
  //    إعادة تسمية. والحارس هنا يشترط أن تكون الثغرة **معلَنة** في الملفّ حتّى
  //    لا يقرأ أحدٌ رقمًا مركّبًا على أنّه محصَّل. وهو يفشل إذا حُذف الإعلان.
  const named = ["collected", "invoiced", "contract"].filter((k) => new RegExp(k, "i").test(s));
  if (named.length < 2) {
    assert.match(s, /BASIS_NOT_SEPARATED|أساس المبلغ غير مفصول/,
      `التقرير لا يفرّق بين المحصَّل والمفوتَر وقيمة العقد، ولا يُعلن ذلك (وجد: ${named.join(", ") || "لا شيء"})`);
  }
});

test("(ER-3) ★ NULL يبقى مجهولًا ولا يصير صفرًا صامتًا ★", () => {
  const s = ER();
  assert.match(s, /unknown|غير معروف|is null/i, "لا تمييز للمجهول");
  // coalesce(...,0) على مقياس ماليّ يحوّل الغياب إلى صفر — يجب أن يُصرَّح به.
  const c = codeOnly(s);
  const risky = [...c.matchAll(/coalesce\s*\([^)]*\b(amount|revenue|profit|margin|collected)\w*[^)]*,\s*0\s*\)/gi)];
  if (risky.length) {
    assert.match(s, /صفر|zero|unknown/i, "coalesce إلى صفر على مقياس ماليّ بلا تصريح");
  }
});

test("(ER-4) ★★ الربحية للمالك وحده، ولا سطح عامّ ★★", () => {
  const s = ER(), c = codeOnly(s);
  assert.match(s, /is_owner|owner_only|exec_report\.view/i, "لا بوّابة مالك للربحية");
  assert.doesNotMatch(c, /\bgrant[a-z, ]*\bon\s+(function|table)\b[^;]*\bto\b[^;]*\banon\b/i, "منح anon");
});

test("(ER-5) ★ تاريخ التحديث معلَن — لا رقم بلا زمن ★", () => {
  assert.match(ER(), /generated_at|freshness|as_of|محدَّث/i, "لا طابع زمنيّ للنتيجة");
});

test("(ER-6) ★★ التقارير آخر حزمة: POSTCHECK يتحقّق من سابقاتها ★★", () => {
  const pc = read("docs/executive_reporting_POSTCHECK.sql") || "";
  const prev = ["comms_", "crm_", "fin_", "csub_", "sq_", "lsr_", "custody_inv", "tvn_", "cs_", "liveops_", "ai_"];
  // ⚠️ الملفّ يكتب البادئات مهروبةً لـLIKE (csub\_%)، فالمطابقة الحرفية تفوّتها.
  const flat = pc.replace(/\\_/g, "_");
  const found = prev.filter((p) => flat.includes(p));
  assert.ok(found.length >= 6,
    `POSTCHECK لا يتحقّق من الحزم السابقة قبل إعلان الجاهزية (وجد ${found.length}/${prev.length})`);
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
