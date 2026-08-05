// ════════════════════════════════════════════════════════════════════════════
// tests/wave3_calendar_token_bearer_hash.test.js
//
// انحدار أمنيّ — **البصمة المخزَّنة ليست بيان اعتماد**.
//
// ★ العيب الذي يمنعه هذا الملفّ ★
//   كانت `prodops_calendar_feed(p_token_hash)` تطابق البصمة المُرسَلة على العمود
//   المخزَّن مباشرةً، وهي ممنوحة لـ`anon`. فمن يقرأ العمود — نسخة احتياطية،
//   نسخة قراءة، سطر سجلّ — يستدعي الدالّة بالبصمة كما هي فيحصل على التغذية.
//   ⇒ التهشيم لم يكن يحمي شيئًا: البصمة صارت مفتاحًا مكافئًا للرمز.
//
// ⛔ لا قاعدة ولا شبكة: عقود ساكنة + تشغيل المسار بـfetch مُحقَن.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const ROUTE = "app/api/calendar/[token]/route.ts";
const RUNME = "docs/wave3_calendar_tokens_RUNME.sql";

/** يجرّد التعليقات ويُبقي السلاسل — لتأكيد محتوى الشيفرة لا الشرح. */
function noComments(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") q = false; out += c; i++; continue; }
    if (c === "'") { q = true; out += c; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
/** جسم دالّة التغذية وحده — محدود بنهاية الكتلة. */
function feedBody() {
  const s = noComments(R(RUNME));
  const start = s.indexOf("create or replace function public.prodops_calendar_feed");
  assert.ok(start > -1, "دالّة التغذية غير موجودة");
  const end = s.indexOf("$$;", start);
  assert.ok(end > start, "لم تُحدَّد نهاية الدالّة");
  return s.slice(start, end);
}

// ─── ١ · 🔴 العقد الأساسيّ: الرمز الخامّ يدخل، والبصمة تُحسب داخليًّا ───────
test("🔴 الدالّة تستقبل p_token ولا تقبل بصمة وسيطًا", () => {
  const body = feedBody();
  assert.match(body, /function public\.prodops_calendar_feed\(p_token text\)/,
    "التوقيع ليس (p_token text)");
  assert.ok(!/p_token_hash/.test(body),
    "🔴 ما يزال يشير إلى p_token_hash — البصمة تُقبل وسيطًا");
});

test("🔴 البصمة تُحسب داخل الدالّة من الرمز الخامّ", () => {
  const body = feedBody();
  assert.match(body, /digest\s*\(\s*p_token\s*,\s*'sha256'\s*\)/,
    "لا تُحسب sha256 من p_token داخل الدالّة");
  assert.match(body, /where\s+token_hash\s*=\s*v_hash/,
    "المطابقة ليست على البصمة المحسوبة داخليًّا");
  assert.ok(!/where\s+token_hash\s*=\s*p_token\b/.test(body),
    "🔴 يطابق العمود بالوسيط مباشرةً — الثغرة نفسها بصياغة أخرى");
});

test("🔴 إسقاط صريح قبل الإنشاء — وإلّا بقيت النسخة القديمة", () => {
  const s = noComments(R(RUNME));
  const dropAt = s.indexOf("drop function if exists public.prodops_calendar_feed(text)");
  const createAt = s.indexOf("create or replace function public.prodops_calendar_feed");
  assert.ok(dropAt > -1, "لا إسقاط للتوقيع القديم");
  assert.ok(dropAt < createAt,
    "الإسقاط بعد الإنشاء — و`create or replace` يفشل بتغيير اسم وسيط (42P13)");
});

// ─── ٢ · الحراس fail-closed ما تزال قائمة ──────────────────────────────────
test("الرفض قبل أيّ SELECT: null · طول · شكل", () => {
  const body = feedBody();
  assert.match(body, /p_token is null/, "لا رفض لـNULL");
  assert.match(body, /length\(p_token\)\s*<>\s*64/, "لا فحص طول");
  assert.match(body, /p_token\s*!~\s*'\^\[0-9a-f\]\{64\}\$'/, "لا فحص شكل");
  const guardEnd = body.indexOf("invalid_token");
  const firstSelect = body.indexOf("select * into r");
  assert.ok(guardEnd > -1 && guardEnd < firstSelect,
    "🔴 القراءة تسبق الحارس");
});

test("الإلغاء والانتهاء والاستنفاد والنطاق تبقى fail-closed", () => {
  const body = feedBody();
  for (const needle of ["'revoked'", "'expired'", "'exhausted'", "max_opens", "owner_user_id"]) {
    assert.ok(body.includes(needle), `حارس مفقود: ${needle}`);
  }
});

test("⛔ لا معلومات مالية ولا ملاحظات داخلية في المخرَج", () => {
  const body = feedBody();
  const out = body.slice(body.indexOf("jsonb_build_object('id'"));
  for (const bad of ["phone", "rate", "wage", "cost", "amount", "internal_note", "client"]) {
    assert.ok(!new RegExp(`'${bad}'`, "i").test(out), `المخرَج يحمل ${bad}`);
  }
});

// ─── ٣ · الصلاحيات ─────────────────────────────────────────────────────────
test("🔴 anon ينفّذ التغذية وحدها — ولا الإصدار ولا الإلغاء", () => {
  const s = noComments(R(RUNME));
  assert.match(s, /grant execute on function public\.prodops_calendar_feed\(text\)[^;]*to anon/,
    "التغذية غير ممنوحة لـanon");
  for (const fn of ["prodops_calendar_token_issue", "prodops_calendar_token_revoke"]) {
    const re = new RegExp(`grant execute on function public\\.${fn}[^;]*\\bto\\b[^;]*\\banon\\b`, "i");
    assert.ok(!re.test(s), `🔴 ${fn} ممنوحة لـanon`);
    assert.match(s, new RegExp(`revoke all on function public\\.${fn}[^;]*from[^;]*anon`, "i"),
      `${fn} لم تُسحب من anon`);
  }
});

test("🔴 لا وصول مباشر لجدول الرموز لأيّ دور عميل", () => {
  const s = noComments(R(RUNME));
  assert.match(s, /revoke all on public\.ops_calendar_tokens from[^;]*anon/i,
    "لم تُسحب صلاحيات الجدول من anon");
  const grants = s.match(/grant[^;]*on public\.ops_calendar_tokens[^;]*/gi) ?? [];
  for (const g of grants) {
    assert.ok(!/\b(anon|public|authenticated)\b/i.test(g),
      `🔴 مِنحة مباشرة على جدول الرموز: ${g.trim().slice(0, 80)}`);
  }
});

test("definer بمسار بحث صريح، ⛔ وبلا pg_temp في دالّة anon", () => {
  const body = feedBody();
  assert.match(body, /security definer/i);
  const m = body.match(/set search_path\s*=\s*([^\n]+?)\s+as/i);
  assert.ok(m, "لا مسار بحث مثبَّت");
  assert.ok(!/pg_temp/.test(m[1]),
    "pg_temp في مسار دالّة يستدعيها مجهول — جدول مؤقّت قد يُظلّل اسمًا");
});

// ─── ٤ · المسار لا يهشّم ────────────────────────────────────────────────────
test("🔴 route.ts يرسل p_token الخامّ ولا يحسب بصمة", () => {
  const r = R(ROUTE);
  assert.match(r, /p_token:\s*raw/, "لا يرسل الرمز الخامّ");
  assert.ok(!/p_token_hash/.test(r), "ما يزال يرسل بصمة");
  assert.ok(!/createHash|node:crypto/.test(r), "ما يزال يستورد أو يحسب تهشيمًا");
});

// ─── ٥ · سلوك المسار فعليًّا — fetch مُحقَن، ⛔ لا شبكة ────────────────────
function loadRoute(env) {
  const js = ts.transpileModule(R(ROUTE), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  const prevEnv = process.env;
  process.env = { ...prevEnv, ...env };
  try {
    // eslint-disable-next-line no-new-func
    new Function("exports", "module", "require", js)(mod.exports, mod, (id) => {
      if (id.includes("ics")) return { buildIcs: (evts) => `BEGIN:VCALENDAR:${evts.length}` };
      return require(id);
    });
  } finally { process.env = prevEnv; }
  return mod.exports;
}
const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test-key",
  NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED: "true",
};
const RAW = "a".repeat(64);
const HASH_OF_RAW = crypto.createHash("sha256").update(RAW).digest("hex");
const ctx = (t) => ({ params: Promise.resolve({ token: t }) });

async function callRoute(token, { env = ENV, respond } = {}) {
  const mod = loadRoute(env);
  const sent = [];
  const realFetch = global.fetch;
  // ⚠️ العلم يُقرأ **وقت الطلب** لا وقت تحميل الوحدة، فيجب أن تبقى البيئة
  //    مضبوطة أثناء استدعاء GET نفسه — وإلّا عاد 404 لسبب لا علاقة له بالأمن.
  const prevEnv = process.env;
  process.env = { ...prevEnv, ...env };
  global.fetch = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return respond ? respond() : { ok: true, json: async () => ({ ok: true, events: [] }) };
  };
  try { return { res: await mod.GET(new Request("http://x/"), ctx(token)), sent }; }
  finally { global.fetch = realFetch; process.env = prevEnv; }
}

test("🔴 الرمز الخامّ الصحيح يُمرَّر كما هو — بلا تهشيم", async () => {
  const { res, sent } = await callRoute(RAW);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { p_token: RAW }, "لم يُرسَل الرمز الخامّ وحده");
  assert.ok(!("p_token_hash" in sent[0]), "أُرسلت بصمة");
  assert.notEqual(sent[0].p_token, HASH_OF_RAW, "🔴 أُرسلت بصمة الرمز بدل الرمز");
});

test("🔴 بصمة الرمز لا تعمل بوصفها رمزًا خامًّا", async () => {
  // المهاجم يملك token_hash المخزَّن ويرسله كرمز. المسار يمرّره كما هو،
  // والقاعدة تحسب sha256(البصمة) ≠ البصمة ⇒ لا مطابقة.
  const { sent } = await callRoute(HASH_OF_RAW);
  assert.deepEqual(sent[0], { p_token: HASH_OF_RAW });
  const doubleHashed = crypto.createHash("sha256").update(HASH_OF_RAW).digest("hex");
  assert.notEqual(doubleHashed, HASH_OF_RAW,
    "sha256(البصمة) تساوي البصمة — فرضية الإصلاح منهارة");
  // ⚠️ الإثبات النهائيّ في القاعدة؛ وهنا نثبت أنّ المسار **لا يهشّم** فيمنح
  //    المهاجم تحويلًا مجّانيًّا من بصمة إلى رمز.
});

test("الرمز الملغى/المنتهي/المستنفد ⇒ 404 واحد بلا تمييز", async () => {
  const bodies = [];
  for (const reason of ["invalid_token", "revoked", "expired", "exhausted"]) {
    const { res } = await callRoute(RAW, {
      respond: () => ({ ok: true, json: async () => ({ ok: false, reason }) }),
    });
    assert.equal(res.status, 404, `${reason} لم يُعِد 404`);
    bodies.push(await res.text());
  }
  assert.equal(new Set(bodies).size, 1,
    "🔴 الردود تختلف باختلاف السبب — تمنح المُجرِّب مقياسًا");
});

test("الرمز المشوَّه يفشل بلا نداء ولا كشف", async () => {
  for (const bad of ["", "short", "A".repeat(64), "g".repeat(64), "../etc", RAW + "x"]) {
    const { res, sent } = await callRoute(bad);
    assert.equal(res.status, 404, `قُبل رمز مشوَّه: ${bad.slice(0, 12)}`);
    assert.equal(sent.length, 0, `🔴 نُودي الخادم برمز مشوَّه: ${bad.slice(0, 12)}`);
  }
});

test("امتداد .ics مقبول ولا يغيّر الرمز المُرسَل", async () => {
  const { sent } = await callRoute(`${RAW}.ics`);
  assert.deepEqual(sent[0], { p_token: RAW });
});

test("العلم مطفأ ⇒ 404 ولا نداء إطلاقًا", async () => {
  const { res, sent } = await callRoute(RAW, {
    env: { ...ENV, NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED: "false" },
  });
  assert.equal(res.status, 404);
  assert.equal(sent.length, 0);
});

test("⛔ لا Service Key في المسار", () => {
  const r = R(ROUTE);
  assert.ok(!/SERVICE_ROLE/i.test(r), "🔴 مفتاح خدمة في مسار عامّ يتجاوز الحارس");
  assert.match(r, /ANON_KEY/);
});

test("الرمز لا يُخبَّأ ولا يُفهرَس", async () => {
  const { res } = await callRoute(RAW);
  assert.match(res.headers.get("cache-control") ?? "", /no-store/);
  assert.match(res.headers.get("x-robots-tag") ?? "", /noindex/);
});
