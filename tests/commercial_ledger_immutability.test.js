// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_ledger_immutability.test.js
//
// المتطلّب حرفيًّا: «القيود غير قابلة للتعديل — لا UPDATE ولا DELETE أبدًا.
// التصحيح يقع بقيد عكسيّ منفصل فقط. افرض ذلك بمُشغِّل لا بعُرف.»
//
// العُرف يُخترق بأوّل «إصلاح صغير». المُشغِّل لا يُخترق إلّا بقرار صريح مكتوب.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, funcBody, tableDef, POSTCHECK } = require("./commercial_subscriptions_helpers.js");

test("★ ثلاثة مُشغِّلات منع: UPDATE وDELETE وTRUNCATE", () => {
  const wanted = [
    ["t_csub_ledger_no_update", "before update on public.csub_ledger"],
    ["t_csub_ledger_no_delete", "before delete on public.csub_ledger"],
    ["t_csub_ledger_no_truncate", "before truncate on public.csub_ledger"],
  ];
  for (const [name, clause] of wanted) {
    assert.match(SQL, new RegExp(`create trigger ${name}\\s+${clause.replace(/[.]/g, "\\.")}`, "i"),
      `المُشغِّل ${name} غير معرَّف على ${clause}`);
  }
  // TRUNCATE مُشغِّل جملة لا صفّ — لو كُتب for each row لما عمل إطلاقًا.
  assert.match(SQL, /create trigger t_csub_ledger_no_truncate before truncate on public\.csub_ledger\s*\n?\s*for each statement/i,
    "مُشغِّل TRUNCATE ليس on statement — TRUNCATE سيمرّ بلا اعتراض");
});

test("★ دالّة المنع ترفع استثناءً ولا تعيد NEW", () => {
  const body = funcBody("csub_ledger_immutable");
  assert.match(body, /raise exception/i, "دالّة المنع لا ترفع استثناءً");
  assert.match(body, /0A000/, "دالّة المنع بلا رمز حالة صريح");
  assert.doesNotMatch(body, /return new/i, "دالّة المنع تعيد NEW — قد تسمح بالتعديل");
  assert.match(body, /csub_reverse/, "رسالة المنع لا تدلّ على الطريق الصحيح (القيد العكسيّ)");
});

test("★ التصحيح طريقه الوحيد قيد عكسيّ منفصل", () => {
  // لا دالّة في الموديول تُحدِّث أو تحذف من الدفتر.
  const bad = [...SQL.matchAll(/(update|delete from)\s+public\.csub_ledger\b/gi)];
  assert.deepEqual(bad.map((m) => m[0]), [],
    "دالّة تُحدِّث أو تحذف من الدفتر — الدفتر لم يعد دفترًا");
  // والقيد العكسيّ يُنشئ صفًّا جديدًا يشير إلى الأصل.
  const rev = funcBody("csub_reverse");
  assert.match(rev, /insert into public\.csub_ledger/i, "القيد العكسيّ لا يُدرج صفًّا جديدًا");
  assert.match(rev, /reverses_entry_id/, "القيد العكسيّ لا يشير إلى القيد الأصليّ");
  assert.match(rev, /already_reversed/, "قيد واحد قابل للعكس مرّتين");
  assert.match(rev, /reason_required/, "عكس بلا سبب مكتوب");
});

test("★ لا عكس للعكس، ولا عكس مزدوج — بفهرس فريد لا بفحص تطبيقيّ", () => {
  assert.match(SQL, /create unique index if not exists uq_csub_ledger_reversal\s+on public\.csub_ledger\(reverses_entry_id\)/i,
    "لا فهرس فريد يمنع عكس القيد نفسه مرّتين — سباق سيسمح بعكسين");
  const post = funcBody("csub_ledger_post");
  assert.match(post, /cannot_reverse_a_reversal/, "المُشغِّل يسمح بعكس قيد عكسيّ");
  assert.match(post, /reversal_scope_mismatch/, "المُشغِّل لا يفحص أنّ العكس على الاشتراك والوحدة نفسيهما");
});

test("★ العكس نفيٌ دقيق لا تقدير", () => {
  const post = funcBody("csub_ledger_post");
  for (const col of ["d_allocated", "d_reserved", "d_used", "d_expired"]) {
    assert.match(post, new RegExp(`new\\.${col}\\s*:=\\s*-r\\.${col}`),
      `العكس لا ينفي ${col} — الرصيد بعد التصحيح لن يعود إلى ما كان`);
  }
  assert.match(post, /new\.quantity\s*:=\s*-r\.quantity/, "العكس لا ينفي الكميّة");
  assert.match(post, /new\.overage_amount_net\s*:=\s*-r\.overage_amount_net/,
    "العكس لا ينفي مبلغ التجاوز — ستبقى فاتورة تجاوز لقيد ملغى");
});

test("الدفتر بلا حذف ليّن: سجلّ محاسبيّ لا تُخفى صفوفه", () => {
  const def = tableDef("csub_ledger");
  assert.ok(!/\bis_deleted\b/.test(def),
    "csub_ledger فيه is_deleted — الحذف الليّن إخفاء، والإخفاء في دفتر تزوير");
  assert.match(def, /entry_no\s+bigint generated always as identity/i,
    "لا ترقيم متسلسل للقيود — لا رصيد جاري قابل للتدقيق");
});

test("أعمدة الترحيل تُحسب بمُشغِّل ولا تُقبل من المُدرِج", () => {
  const post = funcBody("csub_ledger_post");
  assert.match(post, /new\.d_allocated\s*:=\s*0;\s*new\.d_reserved\s*:=\s*0/,
    "المُشغِّل لا يصفّر أعمدة الترحيل قبل حسابها — قيمة مُدرِج قد تمرّ");
  assert.match(SQL, /create trigger t_csub_ledger_post before insert on public\.csub_ledger/i,
    "مُشغِّل الترحيل ليس before insert");
});

test("لا صلاحية كتابة على الدفتر لأيّ دور تطبيقيّ", () => {
  assert.match(SQL, /revoke all on table public\.%I from authenticated/i,
    "الجداول لا تُنزع منها صلاحيات authenticated قبل منح SELECT");
  assert.match(SQL, /grant select on table public\.%I to authenticated/i,
    "الجداول تُمنح أكثر من SELECT");
  // ولا سياسة RLS للكتابة
  const writePolicies = [...SQL.matchAll(/create policy \w+ on public\.csub_\w+ for (insert|update|delete)/gi)];
  assert.deepEqual(writePolicies.map((m) => m[0]), [], "سياسة كتابة مباشرة على جدول csub_");
  assert.match(POSTCHECK, /privilege_type <> 'SELECT'/,
    "POSTCHECK لا يتحقّق من غياب صلاحية الكتابة بعد التطبيق");
});
