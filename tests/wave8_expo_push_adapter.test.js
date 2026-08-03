// ════════════════════════════════════════════════════════════════════════════
// tests/wave8_expo_push_adapter.test.js — Wave 8 · V2-8.3-B
//
// ⛔ لا شبكة إطلاقًا: النقل مُحقَن وهميّ في كلّ حالة.
// ⛔ ولا اعتماد Expo ولا رمز حقيقيّ — الرموز هنا نصوص اختبار.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const SRC = fs.readFileSync(path.join(ROOT, "lib/notifications/expoPush.ts"), "utf8");

// نفس نمط Wave 3 القائم (tests/wave3_solar_weather.js): تُترجَم الوحدة في
// الذاكرة، فلا يُضاف مترجم إلى مسار الاختبار ولا يُعاد بناء المشروع.
const loadTs = (rel) => {
  const js = ts.transpileModule(fs.readFileSync(path.join(ROOT, rel), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "module", "require", js)(m.exports, m, () => ({}));
  return m.exports;
};
const M = loadTs("lib/notifications/expoPush.ts");

const msg = (i) => ({
  token: `ExponentPushToken[xxxxxxxxxxxxxxxxxx${i}]`,
  fingerprint: `fp${i}`, title: "t", body: "b",
});
const okBody = (n) => ({ data: Array.from({ length: n }, (_, i) => ({ status: "ok", id: `r${i}` })) });

// ─── ١ · 🔴 العلم مطفأ ⇒ صفر نداء ──────────────────────────────────────────
test("علم مطفأ: لا يُستدعى النقل إطلاقًا", async () => {
  let calls = 0;
  const t = M.mockTransport(() => { calls++; return okBody(1); });
  for (const env of [{}, { PUSH_EXPO_ENABLED: "" }, { PUSH_EXPO_ENABLED: "0" },
                     { PUSH_EXPO_ENABLED: "true" }, { PUSH_EXPO_ENABLED: "yes" }]) {
    const r = await M.sendPush([msg(1)], { transport: t, correlationId: "c", env });
    assert.equal(r.skippedReason, "flag_off", `القيمة ${JSON.stringify(env)} فعّلت القناة`);
    assert.equal(r.attempted, 0);
  }
  assert.equal(calls, 0, "استُدعي النقل والعلم مطفأ");
});

test('العلم يُفعَّل بـ"1" وحدها', () => {
  assert.equal(M.expoPushEnabled({ PUSH_EXPO_ENABLED: "1" }), true);
  assert.equal(M.expoPushEnabled({ PUSH_EXPO_ENABLED: " 1" }), false);
  assert.equal(M.expoPushEnabled({}), false);
});

const ON = { PUSH_EXPO_ENABLED: "1" };

// ─── ٢ · النجاح ────────────────────────────────────────────────────────────
test("نجاح: تذاكر ok وإيصالات", async () => {
  const t = M.mockTransport(() => okBody(2));
  const r = await M.sendPush([msg(1), msg(2)], { transport: t, correlationId: "c", env: ON });
  assert.equal(r.sent, 2);
  assert.equal(r.failed, 0);
  assert.equal(r.tickets[0].receiptId, "r0");
  assert.deepEqual(r.invalidate, []);
});

// ─── ٣ · المهلة ────────────────────────────────────────────────────────────
test("مهلة: تُسجَّل فشلًا ولا تُبتلع", async () => {
  const t = M.mockTransport(() => { const e = new Error("boom"); throw e; });
  const r = await M.sendPush([msg(1)], {
    transport: t, correlationId: "c", env: ON, maxAttempts: 2, sleep: async () => {},
  });
  assert.equal(r.sent, 0);
  assert.equal(r.failed, 1);
  assert.equal(r.tickets[0].errorCode, "Timeout");
});

// ─── ٤ · استجابة مشوَّهة ليست نجاحًا ───────────────────────────────────────
test("استجابة مشوَّهة: فشل صريح لا تجاهل", async () => {
  for (const bad of [null, {}, { data: "nope" }, { data: [] }, { data: [{}, {}] }]) {
    const r = await M.sendPush([msg(1)], {
      transport: M.mockTransport(() => bad), correlationId: "c", env: ON,
      maxAttempts: 1, sleep: async () => {},
    });
    assert.equal(r.sent, 0, `عُوملت ${JSON.stringify(bad)} كنجاح`);
    assert.equal(r.tickets[0].errorCode, "MalformedResponse");
    assert.equal(r.tickets[0].shouldInvalidate, false, "أُبطل رمز بسبب استجابة مشوَّهة");
  }
});

// ─── ٥ · 429 ───────────────────────────────────────────────────────────────
test("429: قابل لإعادة المحاولة، وينجح عند الثانية", async () => {
  let n = 0;
  const t = M.mockTransport(() => {
    n++;
    if (n === 1) { const e = new Error("rate"); e.code = "RateLimited"; throw e; }
    return okBody(1);
  });
  const r = await M.sendPush([msg(1)], {
    transport: t, correlationId: "c", env: ON, maxAttempts: 3, sleep: async () => {},
  });
  assert.equal(r.sent, 1);
  assert.equal(n, 2);
});

// ─── ٦ · 🔴 الفشل الجزئيّ داخل الدفعة ──────────────────────────────────────
test("فشل جزئيّ: ينجح عنصر ويفشل جاره", async () => {
  const t = M.mockTransport(() => ({
    data: [
      { status: "ok", id: "r0" },
      { status: "error", details: { error: "DeviceNotRegistered" } },
      { status: "ok", id: "r2" },
    ],
  }));
  const r = await M.sendPush([msg(1), msg(2), msg(3)], {
    transport: t, correlationId: "c", env: ON, maxAttempts: 1, sleep: async () => {},
  });
  assert.equal(r.sent, 2);
  assert.equal(r.failed, 1);
  assert.deepEqual(r.invalidate, ["fp2"], "لم تُرشَّح البصمة الواجب إبطالها");
});

// ─── ٧ · الإبطال للأخطاء الدائمة فقط ───────────────────────────────────────
test("الإبطال دائم فقط: تجاوز المعدّل لا يُبطل رمزًا", async () => {
  const t = M.mockTransport(() => ({
    data: [{ status: "error", details: { error: "MessageRateExceeded" } }],
  }));
  const r = await M.sendPush([msg(1)], {
    transport: t, correlationId: "c", env: ON, maxAttempts: 1, sleep: async () => {},
  });
  assert.deepEqual(r.invalidate, [],
    "أُبطل رمز بسبب ازدحام عابر — الجهاز يفقد إشعاراته للأبد");
});

test("DeviceNotRegistered وInvalidCredentials تُبطلان", () => {
  for (const e of ["DeviceNotRegistered", "InvalidCredentials"]) {
    const [t] = M.parseExpoResponse({ data: [{ status: "error", details: { error: e } }] }, [msg(1)]);
    assert.equal(t.shouldInvalidate, true, `${e} لم تُبطل`);
  }
  for (const e of ["MessageTooBig", "MessageRateExceeded", "Whatever"]) {
    const [t] = M.parseExpoResponse({ data: [{ status: "error", details: { error: e } }] }, [msg(1)]);
    assert.equal(t.shouldInvalidate, false, `${e} أبطلت رمزًا وهي غير دائمة`);
  }
});

// ─── ٨ · حدّ إعادة المحاولة ────────────────────────────────────────────────
test("حدّ المحاولات محترَم — لا حلقة لا نهائية", async () => {
  let n = 0;
  const t = M.mockTransport(() => { n++; const e = new Error("x"); e.code = "RateLimited"; throw e; });
  const r = await M.sendPush([msg(1)], {
    transport: t, correlationId: "c", env: ON, maxAttempts: 3, sleep: async () => {},
  });
  assert.equal(n, 3, `عدد المحاولات ${n} ≠ 3`);
  assert.equal(r.failed, 1);
});

// ─── ٩ · التكرار ───────────────────────────────────────────────────────────
test("idempotency: نفس الجهاز ونفس الارتباط لا يُرسَل مرّتين", async () => {
  const seen = new Set();
  const t = M.mockTransport(() => okBody(1));
  const first = await M.sendPush([msg(1)], { transport: t, correlationId: "c1", env: ON, seenKeys: seen });
  assert.equal(first.sent, 1);
  const second = await M.sendPush([msg(1)], { transport: t, correlationId: "c1", env: ON, seenKeys: seen });
  assert.equal(second.attempted, 0, "أُعيد الإرسال لنفس المفتاح");
  // وارتباط آخر يُرسَل عاديًّا.
  const third = await M.sendPush([msg(1)], { transport: t, correlationId: "c2", env: ON, seenKeys: seen });
  assert.equal(third.sent, 1);
});

test("مفتاح التكرار مبنيّ على البصمة لا الرمز", () => {
  const k = M.idempotencyKey("c1", "fp9");
  assert.equal(k, "c1:fp9");
  assert.ok(!k.includes("ExponentPushToken"), "الرمز داخل مفتاح قد يُسجَّل");
});

// ─── ١٠ · حدّ الدفعة ───────────────────────────────────────────────────────
test("الدفعة لا تتجاوز 100 ولو طُلب أكثر", async () => {
  const sizes = [];
  const t = M.mockTransport((p) => { sizes.push(p.length); return okBody(p.length); });
  await M.sendPush(Array.from({ length: 250 }, (_, i) => msg(i)), {
    transport: t, correlationId: "c", env: ON, batchSize: 500,
  });
  assert.deepEqual(sizes, [100, 100, 50]);
});

// ─── ١١ · 🔴 التنقيح — لا رمز في أيّ سجلّ ──────────────────────────────────
test("لا يظهر الرمز في أيّ سطر سجلّ", async () => {
  const lines = [];
  const t = M.mockTransport(() => ({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }));
  await M.sendPush([msg(1)], {
    transport: t, correlationId: "c", env: ON, maxAttempts: 1, sleep: async () => {},
    log: (e, d) => lines.push(JSON.stringify({ e, d })),
  });
  assert.ok(lines.length > 0, "لم يُسجَّل شيء إطلاقًا");
  const all = lines.join("\n");
  assert.ok(!all.includes("ExponentPushToken"), "الرمز ظهر في السجلّ");
  assert.ok(all.includes("fp1"), "البصمة غائبة — لا يمكن تتبّع العطل");
});

test("redactToken لا يُعيد أيّ جزء من الرمز", () => {
  const tok = "ExponentPushToken[abcdef123456]";
  const out = M.redactToken(tok);
  assert.ok(!out.includes("abcdef"), "أعاد جزءًا من الرمز");
  assert.ok(!out.includes("123456"), "أعاد ذيل الرمز — يضيّق التخمين ويربط السجلّات");
  assert.ok(out.includes("redacted"));
});

test("redactPayloadForLog يُعيد مفاتيح data لا قيمها", () => {
  const out = M.redactPayloadForLog([{ ...msg(1), data: { projectId: "p-secret-123" } }]);
  const s = JSON.stringify(out);
  assert.ok(s.includes("projectId"), "المفاتيح غائبة");
  assert.ok(!s.includes("p-secret-123"), "قيمة data ظهرت في السجلّ");
});

// ─── ١٢ · عقود ساكنة ───────────────────────────────────────────────────────
test("⛔ لا نداء شبكة في المسار الافتراضيّ", () => {
  // fetch مذكور مرّة واحدة فقط: داخل httpTransport الذي لا يُستدعى إلّا صراحةً.
  const fetches = (SRC.match(/\bfetch\s*\(/g) ?? []).length;
  assert.equal(fetches, 1, "نداء شبكة خارج httpTransport");
  assert.ok(/export function httpTransport/.test(SRC));
  assert.ok(!/httpTransport\s*\(\s*\)\s*[,;)]/.test(SRC.replace(/export function httpTransport[\s\S]*?\n}/, "")),
    "httpTransport يُستدعى افتراضيًّا داخل الوحدة");
});

test("⛔ لا اعتماد Expo مخزَّن في المستودع", () => {
  assert.ok(!/EXPO_ACCESS_TOKEN\s*=\s*["'][^"']+["']/.test(SRC), "اعتماد مكتوب في الشيفرة");
  // ⚠️ الفحص مقصور على اعتماد **الدفع**. و`EXPO_PUBLIC_SUPABASE_*` القائمة ليست
  //    اعتمادًا لـExpo Push بل إعداد Supabase لتطبيق مستقبليّ — وفحصٌ أوسع كان
  //    يرفضها زورًا. والقيمة تُقرأ بعد تجريد التعليق، وإلّا حُسب `# [PV]` قيمةً.
  for (const f of [".env.example"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*(EXPO_ACCESS_TOKEN|EXPO_PUSH[A-Z_]*|PUSH_EXPO[A-Z_]*)\s*=\s*([^#]*)/);
      if (m) assert.equal(m[2].trim(), "", `${f} يحمل قيمة اعتماد دفع: ${m[1]}`);
    }
  }
});

test("العلم ليس NEXT_PUBLIC — لا يتسرّب إلى حزمة المتصفّح", () => {
  assert.ok(/PUSH_EXPO_ENABLED/.test(SRC));
  assert.ok(!/NEXT_PUBLIC_PUSH_EXPO/.test(SRC),
    "علم إرسال خادميّ مُعرَّض للمتصفّح");
});

test("فشل الدفع لا يُسقط قناة أخرى", () => {
  // العقد: sendPush تُعيد نتيجة ولا ترمي، فلا يمكن أن تُجهض مسار البريد.
  assert.ok(!/throw\s+(new\s+)?Error/.test(
    SRC.slice(SRC.indexOf("export async function sendPush"))),
    "sendPush ترمي — فتُسقط البريد وإشعار البوّابة معها");
});
