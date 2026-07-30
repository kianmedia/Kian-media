// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_client_sql_contract.test.js — عقد المرحلة ٣ داخل الحزمة.
//
// ★ الفحص الأوّل هو الأهمّ ★: المرحلة ٣ تعيش في §17 من
// docs/commercial_subscriptions_RUNME.sql ولا تُنشئ حزمة ثانية. حزمتان تعنيان
// ترتيب تشغيل غامضًا، وترتيبًا غامضًا يعني رصيدًا يُحسب مرّتين.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, SQL17, POSTCHECK, ROLLBACK, exists, funcBody, funcArgs,
  PHASE3_FNS, PHASE3_TABLES, FOUNDATION_FNS,
} = require("./commercial_client_helpers.js");

test("★ حزمة واحدة: المرحلة ٣ داخل §17، ولا ملفّ SQL ثانٍ ★", () => {
  for (const f of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(exists(`docs/commercial_subscriptions_${f}.sql`), `الملفّ ${f} غائب`);
  }
  for (const stray of [
    "docs/client_production_credits_RUNME.sql",
    "docs/production_requests_RUNME.sql",
    "docs/commercial_requests_RUNME.sql",
    "docs/csub_service_requests_RUNME.sql",
  ]) {
    assert.ok(!exists(stray), `حزمة ثانية: ${stray} — كلّ SQL يذهب إلى commercial_subscriptions_RUNME.sql`);
  }
  assert.match(SQL17, /تُضاف إلى \*\*هذه\*\* الحزمة ولا تُنشأ حزمة ثانية/,
    "§17 لا يعلن انتماءه إلى الحزمة الواحدة");
});

test("§17 داخل المعاملة نفسها وقبل commit", () => {
  const iBegin = SQL.indexOf("\nbegin;");
  const i17 = SQL.indexOf("-- §17) المرحلة ٣");
  const iCommit = SQL.lastIndexOf("\ncommit;");
  assert.ok(iBegin > 0 && i17 > iBegin, "§17 خارج المعاملة");
  assert.ok(iCommit > i17, "§17 بعد commit — لن يُنفَّذ ضمن الترحيلة");
  assert.match(SQL, /notify pgrst, 'reload schema'/, "لا إعادة تحميل لمخطّط PostgREST");
});

test("جدولا المرحلة ٣ مُنشآن بصيغة idempotent", () => {
  for (const t of PHASE3_TABLES) {
    assert.match(SQL17, new RegExp(`create table if not exists public\\.${t}\\s*\\(`, "i"),
      `الجدول ${t} غير مُنشأ أو غير idempotent`);
  }
});

test("RLS مفعّلة على جدولَي المرحلة ٣، ولا سياسة كتابة", () => {
  for (const t of PHASE3_TABLES) {
    assert.match(SQL17, new RegExp(`alter table public\\.${t} enable row level security`, "i"),
      `RLS غير مفعّلة على ${t}`);
    assert.match(SQL17, new RegExp(`create policy ${t}_read on public\\.${t}\\s*\\n?\\s*for select`, "i"),
      `${t} بلا سياسة قراءة — RLS مفعّلة بلا سياسة تحجب الجميع صامتًا`);
  }
  assert.ok(!/create policy[\s\S]{0,200}for\s+(insert|update|delete|all)\b/i.test(SQL17),
    "سياسة كتابة مباشرة في §17 — كلّ كتابة عبر RPC");
});

test("لا صلاحية anon، والجداول قراءة فقط لـauthenticated", () => {
  assert.match(SQL17, /revoke all on function %s from anon/i, "لا سحب من anon للدوالّ");
  assert.match(SQL17, /revoke all on table public\.%I from anon/i, "لا سحب من anon للجداول");
  assert.match(SQL17, /grant select on table public\.%I to authenticated/i);
  assert.ok(!/grant\s+(insert|update|delete)[\s\S]{0,80}to authenticated/i.test(SQL17),
    "منحة كتابة مباشرة لـauthenticated");
  assert.ok(!/to\s+anon\b/i.test(SQL17.replace(/from anon/gi, "")), "منحة صريحة لـanon");
  assert.match(SQL17, /has_function_privilege\('anon'/, "الـSELF-TEST لا يفحص anon");
});

test("الدالّة الداخلية الوحيدة (مفتاح التكرار) لا تُمنح لأحد", () => {
  assert.match(SQL17, /revoke all on function public\.csub_sr_idem\(uuid,text\) from authenticated/i,
    "مفتاح التكرار ممنوح لـauthenticated");
  const grants = SQL17.slice(SQL17.indexOf("§17.6"));
  const pub = grants.slice(0, grants.indexOf("داخليّة"));
  assert.ok(!pub.includes("csub_sr_idem"), "مفتاح التكرار في قائمة المنح العامّة");
});

test("كلّ دالّة في §17 هي SECURITY DEFINER بمسار مثبَّت", () => {
  for (const f of [...PHASE3_FNS, "csub_sr_idem"]) {
    const re = new RegExp(
      `create or replace function public\\.${f}\\s*\\([\\s\\S]*?\\bas\\s*\\$\\$`, "i");
    const m = SQL17.match(re);
    assert.ok(m, `الدالّة ${f} غير موجودة في §17`);
    assert.match(m[0], /security definer/i, `${f} ليست SECURITY DEFINER`);
    assert.match(m[0], /set search_path = public/i, `${f} بلا search_path مثبَّت`);
  }
});

test("★ لا محرّك رصيد ثانٍ: §17 لا تكتب في الدفتر ولا في جدول الاعتماد ★", () => {
  const body = SQL17.replace(/--[^\n]*/g, "");
  assert.ok(!/insert\s+into\s+public\.csub_ledger\b/i.test(body),
    "§17 تكتب في الدفتر مباشرةً — كلّ حركة تمرّ بدوالّ §10");
  assert.ok(!/update\s+public\.csub_ledger\b/i.test(body), "§17 تُحدّث الدفتر");
  assert.ok(!/insert\s+into\s+public\.csub_approval_requests\b/i.test(body),
    "§17 تُنشئ طلب اعتماد مباشرةً بدل csub_approval_submit_core");
  // وتستعمل النوى القائمة فعلًا.
  const t = funcBody("csub_request_transition", SQL17);
  for (const fn of ["csub_reserve", "csub_release", "csub_consume", "csub_approval_submit_core"]) {
    assert.ok(t.includes(fn), `آلة الحالات لا تستعمل ${fn} القائمة`);
  }
  // وحارس في الـSELF-TEST كي لا يتسلّل insert لاحقًا.
  assert.match(SQL17, /تكتب في الدفتر مباشرةً/, "الـSELF-TEST لا يحرس هذا العقد");
});

test("دوالّ الأساس التي تعتمد عليها المرحلة ٣ موجودة فعلًا في الحزمة", () => {
  for (const f of FOUNDATION_FNS) {
    assert.match(SQL, new RegExp(`create or replace function public\\.${f}\\s*\\(`, "i"),
      `دالّة الأساس ${f} غير موجودة — المرحلة ٣ تبني على فراغ`);
  }
});

test("مفتاح التكرار حتميّ — نقرتان لا تُنتجان قيدين", () => {
  const idem = funcBody("csub_sr_idem", SQL17);
  assert.match(idem, /'sr:'/, "المفتاح غير مشتقّ من الطلب");
  assert.ok(!/gen_random_uuid|random\(\)|clock_timestamp/.test(idem),
    "المفتاح عشوائيّ — نقرتان تُنتجان قيدين");
  const t = funcBody("csub_request_transition", SQL17);
  const calls = (t.match(/csub_sr_idem\(/g) || []).length;
  assert.ok(calls >= 3, `نداءات الدفتر بلا مفتاح حتميّ (${calls} فقط)`);
});

test("POSTCHECK وROLLBACK يخصّان الحزمة نفسها ويغطّيان المرحلة ٣", () => {
  // POSTCHECK يفحص عائلة csub_* كلّها بالنمط، فيشمل §17 تلقائيًّا.
  assert.match(POSTCHECK, /csub\\_%/, "POSTCHECK لا يفحص عائلة csub_* بالنمط");
  const stmts = POSTCHECK.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
  assert.equal(stmts.length, 1, `POSTCHECK يعيد ${stmts.length} نتيجة — المطلوب نتيجة واحدة`);
  // وROLLBACK يذكر جدولَي المرحلة ٣ قبل الدفتر (قيود restrict).
  assert.ok(ROLLBACK.includes("csub_service_requests"),
    "ROLLBACK لا يذكر جداول المرحلة ٣ — إسقاط الدفتر سيصطدم بقيد restrict");
  const iSr = ROLLBACK.indexOf("csub_service_requests ");
  const iLedger = ROLLBACK.indexOf("public.csub_ledger  ");
  assert.ok(iSr > 0 && iLedger > iSr, "ترتيب الإسقاط لا يحترم المفاتيح الخارجية");
});

test("الـSELF-TEST للمرحلة ٣ صلب: لا يبتلع، ولا يمرّ بلا هدفه", () => {
  const st = SQL17.slice(SQL17.indexOf("do $st17$"));
  const raises = (st.match(/raise exception/g) || []).length;
  assert.ok(raises >= 15, `§17 SELF-TEST يحوي ${raises} فحصًا فقط — أقلّ من المتوقّع`);
  assert.ok(!/exception\s+when\s+others\s+then\s+null/i.test(st), "الـSELF-TEST يبتلع أخطاءه");
  for (const guard of [
    "ready_for_manual_project_creation", "overage_not_approved", "csub_sr_idem",
    "no_client_profile", "has_entries", "منصّة المشاريع المجمّدة",
  ]) {
    assert.ok(st.includes(guard), `§17 SELF-TEST فقد الفحص المرتبط بـ${guard}`);
  }
  // ولا استدعاء حيّ لدالّة محميّة (auth.uid() = NULL في المحرّر يُسقط الترحيلة).
  for (const f of PHASE3_FNS) {
    assert.ok(!new RegExp(`(select|perform)\\s+public\\.${f}\\s*\\(`).test(st),
      `§17 SELF-TEST يستدعي ${f} حيًّا — سيرفع "not authorized" ويُسقط الترحيلة`);
  }
});

test("توقيع آلة الحالات لا يقبل مبلغًا", () => {
  const args = funcArgs("csub_request_transition", SQL17);
  assert.ok(!/numeric/i.test(args),
    "آلة الحالات تقبل مَعلَمًا رقميًّا — يستطيع موظّف حقن رقم في رصيد عميل");
});
