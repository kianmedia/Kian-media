// ════════════════════════════════════════════════════════════════════════════
// tests/wave8_deep_links.test.js — Wave 8 · V2-8.4-A
// ⛔ لا شبكة. تحقّق من قائمة السماح ومعالجة الرموز.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const loadTs = (rel) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, () => ({}));
  return m.exports;
};
const D = loadTs("lib/mobile/deepLinks.ts");

// ─── ١ · المخطّطات الخطرة ──────────────────────────────────────────────────
test("🔴 المخطّطات النشطة مرفوضة — بكل تمويهاتها", () => {
  const attacks = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD4=",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "blob:https://kianmedia.com/x",
    "about:blank",
  ];
  for (const a of attacks) {
    const r = D.resolveDeepLink(a);
    assert.equal(r.ok, false, `قُبل: ${a}`);
    assert.ok(["dangerous_scheme", "control_characters"].includes(r.reason),
      `سبب غير متوقَّع لـ${a}: ${r.reason}`);
  }
});

// ─── ٢ · التحويل المفتوح ───────────────────────────────────────────────────
test("🔴 روابط بروتوكول-نسبيّة مرفوضة", () => {
  for (const a of ["//evil.tld/x", "///evil.tld", "\\\\evil.tld\\x"]) {
    const r = D.resolveDeepLink(a);
    assert.equal(r.ok, false, `قُبل: ${a}`);
    assert.equal(r.reason, "protocol_relative");
  }
});

test("🔴 المضيف الخارجيّ مرفوض — ولا يخدع المطابقةَ لاحقةٌ مشابهة", () => {
  const attacks = [
    "https://evil.tld/portal",
    "https://evilkianmedia.com/portal",       // endsWith كان يقبله
    "https://kianmedia.com.evil.tld/portal",
    "https://kianmedia.com@evil.tld/portal",  // اسم مستخدم يخدع القراءة البشرية
  ];
  for (const a of attacks) {
    const r = D.resolveDeepLink(a);
    assert.equal(r.ok, false, `قُبل مضيف خارجيّ: ${a}`);
    assert.equal(r.reason, "external_host");
  }
});

test("المضيف الصحيح يُقبل، والنقطة اللاحقة لا تخدع", () => {
  assert.equal(D.resolveDeepLink("https://kianmedia.com/client-portal").ok, true);
  assert.equal(D.resolveDeepLink("https://KIANMEDIA.com/client-portal").ok, true);
  assert.equal(D.resolveDeepLink("https://kianmedia.com./client-portal").ok, true);
});

// ─── ٣ · اجتياز المسار والترميز ────────────────────────────────────────────
test("🔴 اجتياز المسار مرفوض — والترميز المزدوج لا يتجاوزه", () => {
  const attacks = [
    "/portal/../../etc/passwd",
    "/portal/%2e%2e/%2e%2e/etc",
    "/portal/%252e%252e/etc",     // فكّ مزدوج
    "/portal\\..\\..\\etc",
  ];
  for (const a of attacks) {
    const r = D.resolveDeepLink(a);
    assert.equal(r.ok, false, `قُبل اجتياز: ${a}`);
    assert.ok(["path_traversal", "malformed_encoding", "not_in_allow_list"].includes(r.reason),
      `سبب غير متوقَّع لـ${a}: ${r.reason}`);
  }
});

test("الترميز المشوَّه يُرفض ولا يُمرَّر كما هو", () => {
  const r = D.resolveDeepLink("/portal/%E0%A4%A");
  assert.equal(r.ok, false);
  assert.equal(r.reason, "malformed_encoding");
});

test("safeDecodeOnce يرفض بقايا الترميز المزدوج", () => {
  assert.equal(D.safeDecodeOnce("%252e%252e").ok, false);
  assert.equal(D.safeDecodeOnce("normal-path").ok, true);
  assert.equal(D.safeDecodeOnce("%ZZ").ok, false);
});

// ─── ٤ · قائمة السماح ──────────────────────────────────────────────────────
test("🔴 كل مسار خارج القائمة مرفوض", () => {
  for (const p of ["/admin", "/portal/secret", "/api/internal/dump", "/",
                   "/portal/projects", "/portal/projects/a/b"]) {
    const r = D.resolveDeepLink(p);
    assert.equal(r.ok, false, `قُبل مسار خارج القائمة: ${p}`);
  }
});

test("المسارات المسموحة تُحلّ وتُستخرج وسائطها", () => {
  const r = D.resolveDeepLink("/portal/projects/abc-123");
  assert.equal(r.ok, true);
  assert.equal(r.target.key, "project");
  assert.deepEqual(r.params, { id: "abc-123" });
});

test("كل هدف مصنَّف بأحد التصنيفات الأربعة", () => {
  const allowed = new Set(["WEB ROUTE READY", "NEEDS NATIVE MAPPING",
                           "NEEDS HOSTED ASSOCIATION FILE", "SECURITY REVIEW REQUIRED"]);
  assert.ok(D.DEEP_LINK_TARGETS.length >= 9);
  for (const t of D.DEEP_LINK_TARGETS) {
    assert.ok(allowed.has(t.readiness), `${t.key} تصنيفه غير معتمَد: ${t.readiness}`);
    assert.ok(t.pattern.startsWith("/"), `${t.key} نمطه ليس مسارًا`);
  }
});

// ─── ٥ · الرموز ────────────────────────────────────────────────────────────
test("🔴 ردّ محايد واحد لكل حالات الرمز — لا مُخبِر للمهاجم", () => {
  const msgs = new Set(
    ["missing", "expired", "revoked", "invalid"].map((s) => D.neutralUserMessage(s)),
  );
  assert.equal(msgs.size, 1, "الرسائل تختلف باختلاف الحالة — تكشف أيّ رمز كان صحيحًا");
  assert.equal(D.neutralUserMessage("valid"), null);
});

test("نزع الرمز من الرابط بعد الاستهلاك", () => {
  assert.equal(D.stripTokenFromUrl("/reset-password?token=SECRET&x=1"), "/reset-password?x=1");
  assert.equal(D.stripTokenFromUrl("/portal/shared/9?t=SECRET"), "/portal/shared/9");
  // ولا يُمسّ رابط بلا رمز.
  assert.equal(D.stripTokenFromUrl("/portal?page=2"), "/portal?page=2");
  for (const p of ["token", "t", "access_token", "code"]) {
    assert.ok(!D.stripTokenFromUrl(`/x?${p}=SECRET`).includes("SECRET"), `${p} لم يُنزع`);
  }
});

test("🔴 لا رمز ولا مُعرِّف في حمولة التحليلات", () => {
  const res = D.resolveDeepLink("/reset-password?token=SUPERSECRET");
  const payload = JSON.stringify(D.analyticsPayload(res));
  assert.ok(!payload.includes("SUPERSECRET"), "الرمز في التحليلات");
  assert.ok(!payload.includes("abc-123"));
  const res2 = D.resolveDeepLink("/portal/projects/abc-123");
  const p2 = JSON.stringify(D.analyticsPayload(res2));
  assert.ok(!p2.includes("abc-123"), "مُعرِّف الكيان في التحليلات");
  assert.ok(p2.includes("project"), "المفتاح غائب — التحليلات بلا قيمة");
});

test("hasToken يُبلّغ الوجود لا القيمة", () => {
  const r = D.resolveDeepLink("/reset-password?token=abc");
  assert.equal(r.ok, true);
  assert.equal(r.hasToken, true);
  assert.equal(D.resolveDeepLink("/reset-password").hasToken, false);
});

// ─── ٦ · حدود عامّة ────────────────────────────────────────────────────────
test("الفارغ والطويل جدًّا ومحارف التحكّم مرفوضة", () => {
  assert.equal(D.resolveDeepLink("").reason, "empty");
  assert.equal(D.resolveDeepLink("   ").reason, "empty");
  assert.equal(D.resolveDeepLink("/portal/" + "a".repeat(3000)).reason, "too_long");
  assert.equal(D.resolveDeepLink("/portal\u0000/x").reason, "control_characters");
  assert.equal(D.resolveDeepLink("/portal\r\nSet-Cookie: x").reason, "control_characters");
});

// ─── ٧ · ⛔ لا ادّعاء Universal/App Links ──────────────────────────────────
test("⛔ لا ملفّ ارتباط مستضاف في المستودع، ولا ادّعاء بدعمه", () => {
  for (const f of ["public/.well-known/apple-app-site-association",
                   "public/.well-known/assetlinks.json",
                   "public/apple-app-site-association"]) {
    assert.ok(!fs.existsSync(path.join(ROOT, f)),
      `${f} موجود — إمّا أن يكون حقيقيًّا بمُعرِّف تطبيق وبصمة توقيع، أو لا يوجد`);
  }
  const src = fs.readFileSync(path.join(ROOT, "lib/mobile/deepLinks.ts"), "utf8");
  assert.ok(/ليست Universal Links ولا App Links/.test(src),
    "الوحدة لا تُصرّح بحدودها");
});
