// ════════════════════════════════════════════════════════════════════════════
// Wave 0 · V2-0.1-F — مراجعة ساكنة لحزمة SQL الموافقة
//
// ⛔ **قراءة فقط.** لا يُنفَّذ SQL · لا اتصال بأي قاعدة · لا مساس بالإنتاج.
//    الملفّات تُقرأ نصًّا وتُفحَص خصائصها البنيوية.
//
// يغطّي الأربعة المطلوبة صراحةً: idempotency · RLS · Rollback ·
// عدم كسر الطلبات القديمة التي لا تحمل موافقة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");

const RUNME = read("docs/consent_capture_EXTENSION_RUNME.sql");
const ROLLBACK = read("docs/consent_capture_EXTENSION_ROLLBACK.sql");
const POSTCHECK = read("docs/consent_capture_EXTENSION_POSTCHECK.sql");

/** الشيفرة وحدها: بلا تعليقات `--` وبلا محتوى السلاسل المفردة.
 *  نفس الدرس المثبَّت في tests/sql_package_hardening_guards.test.js — إدانة
 *  تعليقٍ يشرح الخطر بدل شيفرةٍ تُحدثه خطأ متكرّر في هذا المستودع. */
function codeOnly(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) {
      if (c === "'") { if (sql.startsWith("''", i)) { out += "  "; i += 2; continue; } q = false; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
const RUNME_CODE = codeOnly(RUNME);
const ROLLBACK_CODE = codeOnly(ROLLBACK);

/** يجرّد تعليقات `--` فقط ويُبقي السلاسل.
 *  لازم للتحقّقات التي تبحث عن سلسلة حرفية مثل 'anon' — codeOnly يُفرّغ محتوى
 *  السلاسل، فالبحث فيها عن نصّ مقتبس لا يطابق أبدًا. الفرق بين الاثنين مقصود:
 *  codeOnly للسلوك، noComments للحرفيّات. */
const noComments = (sql) => sql.replace(/^\s*--.*$/gm, "").replace(/\s--.*$/gm, "");
const RUNME_NC = noComments(RUNME);

// ═══ ١) IDEMPOTENCY ════════════════════════════════════════════════════════

test("idempotency: كل عمود يُضاف بـif not exists", () => {
  for (const col of ["consent_given", "consent_at", "consent_version"]) {
    const re = new RegExp(`add column if not exists\\s+${col}\\b`, "i");
    assert.ok(re.test(RUNME_CODE), `${col} لا يُضاف بـif not exists`);
  }
  // لا إضافة عمود بلا الحارس.
  const adds = RUNME_CODE.match(/add column(?! if not exists)/gi) || [];
  assert.equal(adds.length, 0, "إضافة عمود بلا if not exists — إعادة التشغيل ستفشل");
});

test("idempotency: القيد مَحمي بفحص pg_constraint قبل إضافته", () => {
  assert.ok(/from pg_constraint[\s\S]{0,200}conname\s*=\s*/i.test(RUNME_CODE),
    "القيد يجب أن يُفحص وجوده أولًا");
  assert.ok(/if not exists \([\s\S]{0,300}pg_constraint[\s\S]{0,300}then[\s\S]{0,400}add constraint/i.test(RUNME_CODE),
    "add constraint يجب أن يكون داخل حارس if not exists");
});

test("idempotency: الدالّة بـcreate or replace، والمنح قابل للتكرار", () => {
  assert.ok(/create or replace function public\.public_intake_set_consent/i.test(RUNME_CODE));
  assert.ok(/revoke execute on function public\.public_intake_set_consent/i.test(RUNME_CODE));
  assert.ok(/grant\s+execute on function public\.public_intake_set_consent\(uuid,boolean,text,text\) to service_role/i.test(RUNME_CODE));
});

test("idempotency: إضافي بالكامل — لا DROP ولا TRUNCATE ولا DELETE", () => {
  assert.ok(!/\bdrop\s+(table|column|constraint|function|policy|index)\b/i.test(RUNME_CODE),
    "RUNME يحوي DROP — لم يعد إضافيًا");
  assert.ok(!/\b(truncate|delete\s+from)\b/i.test(RUNME_CODE), "RUNME يحذف بيانات");
});

test("idempotency: معاملة واحدة متوازنة، وبلا CONCURRENTLY", () => {
  const begins = (RUNME_CODE.match(/^\s*begin;/gim) || []).length;
  const commits = (RUNME_CODE.match(/^\s*commit;/gim) || []).length;
  assert.equal(begins, 1, `متوقَّع begin; واحد، وُجد ${begins}`);
  assert.equal(commits, 1, `متوقَّع commit; واحد، وُجد ${commits}`);
  assert.ok(!/concurrently/i.test(RUNME_CODE), "CONCURRENTLY لا تعمل داخل معاملة");
});

test("idempotency: علامات dollar-quote متوازنة", () => {
  for (const tag of ["$pf$", "$c$", "$rls$", "$v$", "$$"]) {
    const n = RUNME.split(tag).length - 1;
    assert.equal(n % 2, 0, `علامة ${tag} غير متوازنة (${n} ظهورًا)`);
  }
});

// ═══ ٢) RLS ════════════════════════════════════════════════════════════════

test("RLS: الملف يتحقّق أن RLS مفعّلة ويفشل إن لم تكن", () => {
  assert.ok(/relrowsecurity[\s\S]{0,200}raise exception/i.test(RUNME_CODE),
    "يجب أن يفشل إذا كانت RLS معطّلة على public_intake");
});

test("RLS: يفشل إذا ملك anon أو public صلاحية SELECT", () => {
  assert.ok(/role_table_grants/i.test(RUNME_CODE), "لا يفحص منح الجدول");
  // (كان يُطبَّق على نصّ مُجرَّد من كل المسافات بينما الـregex يحوي مسافة — خطأ اختبار.)
  assert.ok(/grantee\s+in\s*\(\s*'anon'\s*,\s*'public'\s*\)/i.test(RUNME_NC),
    "يجب أن يفحص anon و public معًا");
  assert.ok(/privilege_type\s*=\s*'SELECT'/i.test(RUNME_NC), "يجب أن يفحص صلاحية SELECT تحديدًا");
});

test("RLS: ❌ لا سياسة جديدة — سياسة الصفّ القائمة تغطّي الأعمدة", () => {
  assert.ok(!/create policy/i.test(RUNME_CODE),
    "🔴 سياسة قراءة ثانية تُوسّع الوصول لا تُضيّقه");
  assert.ok(!/alter table[\s\S]{0,80}disable row level security/i.test(RUNME_CODE));
});

test("RLS: الدالّة SECURITY DEFINER بـsearch_path مثبَّت، ولخدمة واحدة فقط", () => {
  assert.ok(/security definer set search_path = public/i.test(RUNME_CODE),
    "search_path غير مثبَّت — عرضة لاختطاف المخطط");
  assert.ok(/revoke execute[\s\S]{0,160}from public, anon, authenticated/i.test(RUNME_CODE),
    "يجب سحب التنفيذ من public/anon/authenticated");
  // الفحص الذاتي يثبّت النتيجة بعد التطبيق.
  // ⚠️ يُفحص على RUNME_NC لا RUNME_CODE: الأخير يُفرّغ محتوى السلاسل، فـ'anon'
  //    المقتبسة تختفي منه ولا تطابق أبدًا.
  assert.ok(/has_function_privilege\('anon'/i.test(RUNME_NC),
    "الفحص الذاتي يجب أن يثبّت أن anon لا يملك التنفيذ");
  assert.ok(/has_function_privilege\('service_role'/i.test(RUNME_NC),
    "الفحص الذاتي يجب أن يثبّت أن service_role يملك التنفيذ");
});

// ═══ ٣) عدم كسر الطلبات القديمة بلا موافقة ═════════════════════════════════

test("★ الطلبات القديمة: الأعمدة nullable بلا DEFAULT — NULL يعني «لم تُسجَّل»", () => {
  // DEFAULT false كان سيجعل كل صفّ تاريخي يدّعي رفضًا لم يُسأل عنه.
  assert.ok(!/consent_given\s+boolean[^;\n]*default/i.test(RUNME_CODE),
    "🔴 consent_given له DEFAULT — الصفوف التاريخية ستدّعي قرارًا لم يُتخذ");
  assert.ok(!/consent_given\s+boolean[^;\n]*not null/i.test(RUNME_CODE),
    "🔴 consent_given NOT NULL — إضافته على جدول قائم تفشل أو تكذب");
});

test("★ الطلبات القديمة: القيد يمرّ على NULL (منطق ثلاثي القيم)", () => {
  const m = /check \(([\s\S]*?)\)\s*\n?\s*not valid/i.exec(RUNME_CODE);
  assert.ok(m, "القيد غير موجود أو ليس not valid");
  const expr = m[1].replace(/\s+/g, " ").trim();
  // `NULL is not true` = TRUE ⇒ الصفوف التاريخية تمرّ.
  assert.ok(/consent_given is not true or/i.test(expr),
    `التعبير يجب أن يبدأ بـ"consent_given is not true or" ليمرّ على NULL — وُجد: ${expr}`);
  assert.ok(!/consent_given\s*=\s*false/i.test(expr),
    "🔴 مقارنة = false تُرجع NULL للصفوف التاريخية وتكسر القيد");
});

test("★ الطلبات القديمة: not valid فلا يُفحص التاريخ ولا يُقفل الجدول", () => {
  assert.ok(/not valid/i.test(RUNME_CODE),
    "بدون not valid يفحص Postgres كل صفّ تاريخي ويقفل الجدول");
});

test("★ مسار الالتقاط القائم غير ممسوس — لا كسر لأي إرسال", () => {
  assert.ok(!/create or replace function public\.capture_public_intake/i.test(RUNME_CODE),
    "🔴 RUNME يعيد تعريف capture_public_intake");
  // والفحص الذاتي يثبت بقاء التوقيع بعد التطبيق.
  assert.ok(/to_regprocedure\('public\.capture_public_intake\(uuid,text,text,text,text,text,text,text,text\[\],text,text,text,text,jsonb\)'\)/i.test(RUNME),
    "الفحص الذاتي يجب أن يثبّت توقيع دالّة الالتقاط");
  assert.ok(/فشل خطير/.test(RUNME), "يجب أن يفشل بصوت عالٍ إن تغيّر التوقيع");
});

test("الموافقة الأولى تُثبَّت ولا تُدهَس بإرسال لاحق", () => {
  assert.ok(/consent_at\s*=\s*coalesce\(consent_at,/i.test(RUNME_CODE),
    "consent_at يجب أن يُحفظ بـcoalesce — أول موافقة هي المُلزِمة");
  assert.ok(/consent_version\s*=\s*coalesce\(consent_version,/i.test(RUNME_CODE));
});

test("الرفض لا يُكتب صفًّا", () => {
  assert.ok(/if p_given is not true then return false; end if;/i.test(RUNME_CODE.replace(/\s+/g, " ")),
    "الدالّة يجب أن تخرج مبكرًا على أي قيمة غير true");
});

// ═══ ٤) ROLLBACK ═══════════════════════════════════════════════════════════

test("rollback: الحذف المُتلِف للبيانات معلَّق ولا يُنفَّذ بلصق الملف", () => {
  assert.ok(!/^\s*alter table public\.public_intake drop column/im.test(ROLLBACK_CODE),
    "🔴 drop column غير معلَّق — لصق الملف سيُتلف موافقات حقيقية");
  // لكنه موجود كتعليق موثَّق للحاجة القصوى.
  assert.ok(/drop column if exists consent_version/i.test(ROLLBACK),
    "خطوة التراجع الكامل يجب أن تكون موثَّقة ولو معلَّقة");
});

test("rollback: التراجع الموصى به بلا SQL، وحذف الدالّة آمن", () => {
  assert.ok(/NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED\s*=\s*false/i.test(ROLLBACK),
    "يجب أن يذكر إطفاء الراية كأول تراجع");
  assert.ok(/drop function if exists public\.public_intake_set_consent\(uuid,boolean,text,text\)/i.test(ROLLBACK_CODE),
    "حذف الدالّة يجب أن يكون بـif exists وبالتوقيع الكامل");
});

test("rollback: يطالب بنسخة قبل أي حذف بيانات", () => {
  assert.ok(/backup/i.test(ROLLBACK), "يجب أن يوجّه لأخذ نسخة قبل التراجع الكامل");
});

// ═══ ٥) POSTCHECK قراءة فقط ════════════════════════════════════════════════

test("postcheck: قراءة فقط ويعيد مجموعة نتائج واحدة", () => {
  const code = codeOnly(POSTCHECK);
  assert.ok(!/\b(insert|update|delete|drop|alter|create|grant|revoke|truncate)\b/i.test(code),
    "POSTCHECK يجب ألّا يعدّل شيئًا");
  assert.ok(!/\bbegin;|\bcommit;/i.test(code), "POSTCHECK لا يحتاج معاملة");
  assert.ok((code.match(/union all/gi) || []).length >= 4, "يجب أن يعيد مجموعة نتائج واحدة");
});
