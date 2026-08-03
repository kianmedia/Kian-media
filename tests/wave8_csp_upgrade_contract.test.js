// ════════════════════════════════════════════════════════════════════════════
// tests/wave8_csp_upgrade_contract.test.js
//
// Wave 8 — يحرس التوجيه الذي كشف تحقيقُ WebKit ضرورةَ ضبطه.
//
// ★ القصّة باختصار ★
//   `upgrade-insecure-requests` يرقّي كلّ أصل فرعيّ إلى https. في الإنتاج بلا
//   أثر (الموقع على https). لكن حزمة Playwright تُقدّم بناء الإنتاج على http
//   على loopback: Chromium يستثني loopback من الترقية، وWebKit لا يستثنيه —
//   فتسقط ورقة الأنماط بأكملها ويُقاس تخطيطٌ بلا CSS.
//
// ★ ما يمنعه هذا الملفّ ★
//   ١. أن يسقط التوجيه من الإنتاج سهوًا (الافتراض **يجب** أن يُصدره).
//   ٢. أن يتحوّل الاستثناء إلى «مطفأ دائمًا» بقيمة عابرة أو متغيّر موجود فارغ.
//   ٣. أن يُضعَّف حارسٌ آخر تحت الغطاء نفسه — HSTS تبقى في الحالتين.
//
// ⛔ لا شبكة ولا متصفّح هنا: تُستدعى `headers()` مباشرةً، فالعقد ثابت ورخيص.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

const CONFIG_PATH = path.join(__dirname, "..", "next.config.js");
const DIRECTIVE = "upgrade-insecure-requests";

/**
 * يحمّل next.config.js **بقيمة بيئة محدّدة** ويعيد ترويسات المسار الشامل.
 * إعادة التحميل ضرورية لأنّ الراية تُقرأ وقت تقييم الوحدة لا وقت الاستدعاء.
 */
async function headersWith(envValue) {
  const previous = process.env.E2E_PLAINTEXT_HTTP;
  if (envValue === undefined) delete process.env.E2E_PLAINTEXT_HTTP;
  else process.env.E2E_PLAINTEXT_HTTP = envValue;
  try {
    delete require.cache[require.resolve(CONFIG_PATH)];
    const cfg = require(CONFIG_PATH);
    const groups = await cfg.headers();
    const all = groups.find((g) => g.source === "/(.*)");
    assert.ok(all, "مجموعة الترويسات الشاملة مفقودة");
    return all.headers;
  } finally {
    delete require.cache[require.resolve(CONFIG_PATH)];
    if (previous === undefined) delete process.env.E2E_PLAINTEXT_HTTP;
    else process.env.E2E_PLAINTEXT_HTTP = previous;
  }
}

const valueOf = (headers, key) =>
  headers.find((h) => h.key.toLowerCase() === key.toLowerCase())?.value ?? null;

// ─── ١ · الافتراض يُصدر التوجيه — وهذا هو الحارس الأهمّ ─────────────────────
test("الافتراض (بلا راية) يُصدر upgrade-insecure-requests", async () => {
  const csp = valueOf(await headersWith(undefined), "Content-Security-Policy");
  assert.ok(csp, "ترويسة CSP المُنفَّذة مفقودة");
  assert.ok(
    csp.split(";").map((s) => s.trim()).includes(DIRECTIVE),
    `الإنتاج فقد ${DIRECTIVE} — هذا إضعافٌ للأمن لا ضبطُ اختبار`,
  );
});

// ─── ٢ · الراية الصريحة وحدها تحذفه ─────────────────────────────────────────
test('E2E_PLAINTEXT_HTTP="1" يحذف التوجيه — ولا شيء غيره', async () => {
  const headers = await headersWith("1");
  const csp = valueOf(headers, "Content-Security-Policy");
  assert.ok(
    !csp.split(";").map((s) => s.trim()).includes(DIRECTIVE),
    "الراية لم تُسقط التوجيه، فحزمة WebKit ستبقى تقيس تخطيطًا بلا CSS",
  );
  // ⛔ الحذف مقصورٌ على توجيه واحد: بقيّة السياسة تبقى كما تُشحن.
  for (const kept of ["frame-ancestors 'self'", "base-uri 'self'", "object-src 'none'"]) {
    assert.ok(csp.includes(kept), `الراية أسقطت ${kept} أيضًا — نطاقها أوسع ممّا يجب`);
  }
  // ⛔ ولا تمسّ HSTS: التجربة J أثبتت أنّها ليست السبب، فلا مبرّر لإضعافها.
  assert.match(
    valueOf(headers, "Strict-Transport-Security") ?? "",
    /max-age=\d+/,
    "HSTS اختفت تحت راية اختبار — لا علاقة لها بالسبب الجذريّ",
  );
});

// ─── ٣ · فشل آمن: كلّ قيمة أخرى تُبقي التوجيه ───────────────────────────────
test("أيّ قيمة غير \"1\" تُبقي التوجيه (fail-safe)", async () => {
  for (const v of ["", "0", "true", "yes", "false", " 1", "1 "]) {
    const csp = valueOf(await headersWith(v), "Content-Security-Policy");
    assert.ok(
      csp.split(";").map((s) => s.trim()).includes(DIRECTIVE),
      `القيمة ${JSON.stringify(v)} أسقطت التوجيه — الشرط ليس مساواةً صارمة بـ"1"`,
    );
  }
});

// ─── ٤ · الاستثناء لا يُعمَّم: الراية لا تُضبط إلّا من حزمة الاختبار ────────
test("الراية لا تُضبط في أيّ ملفّ بيئة أو نشر", async () => {
  const root = path.join(__dirname, "..");
  const suspects = [".env", ".env.local", ".env.production", ".env.example", "vercel.json"];
  for (const f of suspects) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    assert.ok(
      !/E2E_PLAINTEXT_HTTP/.test(fs.readFileSync(p, "utf8")),
      `${f} يضبط E2E_PLAINTEXT_HTTP — الراية تخصّ حزمة الاختبار وحدها`,
    );
  }
  // وتُضبط فعلًا حيث يجب، وإلّا عاد فشل WebKit صامتًا.
  const pw = fs.readFileSync(path.join(root, "playwright.config.ts"), "utf8");
  assert.match(pw, /E2E_PLAINTEXT_HTTP:\s*"1"/, "حزمة Playwright لم تعد تضبط الراية");
});
