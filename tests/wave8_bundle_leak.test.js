// ════════════════════════════════════════════════════════════════════════════
// tests/wave8_bundle_leak.test.js — Wave 8 · §٧
//
// يفحص **المخرَج المبنيّ** لا المصدر. والفرق جوهريّ: وحدة يستوردها أيّ مكوّن
// `"use client"` تُشحن إلى المتصفّح مهما كانت حراسات وقت العرض — وهذا بالضبط
// ما جعل رقمَي السجلّ التجاريّ والضريبيّ يصلان الحزمة في Wave 2.
//
// ★ قواعد صارمة ★
//  ⛔ **لا يُطبع السرّ نفسه** إطلاقًا — لا كاملًا ولا مقتطعًا.
//     يُطبع: معرّف النمط · مسار الأثر · بصمة منقَّحة (sha256، ١٢ محرفًا).
//  ⛔ ولا يُفحص المصدر ولا الوثائق: فوثيقة تشرح شكل مفتاح ليست تسريبًا.
//
// ⚠️ يتطلّب بناءً موجودًا. بلا `.next` يُتخطّى صراحةً — ⛔ ولا يُبلَّغ نجاحًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..");
const NEXT = path.join(ROOT, ".next");

/** بصمة قصيرة تسمح بالمطابقة بين تشغيلين ⛔ ولا تكشف القيمة. */
const fingerprint = (s) =>
  crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);

// ─── أنماط التسريب ──────────────────────────────────────────────────────────
//
// كل نمط له مُعرِّف يُطبع عند الفشل بدل القيمة.
const PATTERNS = [
  { id: "supabase_service_role_jwt",
    // JWT دوره service_role — أخطر ما يمكن تسريبه: يتجاوز RLS كلّيًّا.
    re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g,
    refine: (m) => {
      try {
        const payload = JSON.parse(Buffer.from(m.split(".")[1], "base64").toString("utf8"));
        return payload.role === "service_role";
      } catch { return false; }
    } },
  { id: "supabase_secret_key",      re: /\bsb_secret_[A-Za-z0-9_-]{8,}/g },
  { id: "pg_connection_string",     re: /postgres(?:ql)?:\/\/[^\s"'`]+:[^\s"'`]+@[^\s"'`]+/g },
  { id: "authorization_bearer",     re: /Authorization["'\s:]+Bearer\s+[A-Za-z0-9._-]{20,}/gi },
  { id: "expo_access_token",        re: /\bEXPO_ACCESS_TOKEN["'\s:=]+[A-Za-z0-9_-]{10,}/gi },
  { id: "expo_push_token",          re: /ExponentPushToken\[[^\]]+\]/g },
  { id: "zoho_secret",              re: /\bZOHO_[A-Z_]*(SECRET|TOKEN|REFRESH)[A-Z_]*["'\s:=]+[A-Za-z0-9._-]{10,}/gi },
  { id: "whatsapp_token",           re: /\b(WHATSAPP|WA)_[A-Z_]*TOKEN["'\s:=]+[A-Za-z0-9._-]{15,}/gi },
  { id: "webhook_secret",           re: /\bWEBHOOK_SECRET["'\s:=]+[A-Za-z0-9._-]{10,}/gi },
  { id: "storage_signed_url",       re: /\/storage\/v1\/object\/sign\/[^\s"'`]+token=[A-Za-z0-9._-]{20,}/g },
  { id: "aws_signature",            re: /X-Amz-Signature=[A-Fa-f0-9]{40,}/g },
  { id: "private_key_block",        re: /-----BEGIN (RSA |EC )?PRIVATE KEY-----/g },
];

/** يجمع ملفّات المخرَج المبنيّ التي تصل المتصفّح فعلًا. */
function collectArtifacts() {
  const out = [];
  const want = new Set([".js", ".html", ".json", ".css", ".map"]);
  const roots = [
    path.join(NEXT, "static"),
    path.join(NEXT, "server", "app"),
    path.join(NEXT, "server", "pages"),
  ].filter((p) => fs.existsSync(p));

  // المانيفستات — تُقرأ من المتصفّح أيضًا.
  for (const f of ["build-manifest.json", "app-build-manifest.json",
                   "routes-manifest.json", "prerender-manifest.json"]) {
    const p = path.join(NEXT, f);
    if (fs.existsSync(p)) out.push(p);
  }

  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (want.has(path.extname(e.name))) out.push(p);
    }
  };
  for (const r of roots) walk(r);

  // أصول عامّة تُنشر كما هي.
  const pub = path.join(ROOT, "public");
  if (fs.existsSync(pub)) {
    for (const e of fs.readdirSync(pub, { withFileTypes: true })) {
      if (e.isFile() && [".js", ".json", ".webmanifest"].includes(path.extname(e.name))) {
        out.push(path.join(pub, e.name));
      }
    }
  }
  return out;
}

/** يفحص أثرًا واحدًا ويُعيد نتائج **منقَّحة**. */
function scanFile(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const hits = [];
  for (const p of PATTERNS) {
    for (const m of text.match(p.re) ?? []) {
      if (p.refine && !p.refine(m)) continue;
      hits.push({
        pattern: p.id,
        artifact: path.relative(ROOT, file),
        // ⛔ لا القيمة — بصمة فقط.
        redacted_fingerprint: fingerprint(m),
      });
    }
  }
  return hits;
}

// ─── الفحص ──────────────────────────────────────────────────────────────────
test("🔴 لا سرّ في المخرَج المبنيّ", (t) => {
  if (!fs.existsSync(NEXT)) {
    // ⛔ لا يُبلَّغ نجاحًا كاذبًا: بلا بناء لا يوجد ما يُفحص.
    t.skip("لا يوجد .next — شغّل `npm run build` أوّلًا. BUNDLE SCAN NOT RUN");
    return;
  }
  const artifacts = collectArtifacts();
  assert.ok(artifacts.length > 20,
    `عدد الآثار ${artifacts.length} صغير — الجمع نفسه معطوب، والفحص بلا معنى`);

  const findings = artifacts.flatMap(scanFile);
  // الرسالة تحمل النمط والمسار والبصمة — ⛔ ولا تحمل السرّ.
  assert.deepEqual(findings, [],
    `تسريب في المخرَج المبنيّ:\n${JSON.stringify(findings, null, 2)}`);
});

test("الفحص يشمل الحزم والمانيفستات وHTML المبنيّ", (t) => {
  if (!fs.existsSync(NEXT)) { t.skip("لا يوجد .next"); return; }
  const arts = collectArtifacts().map((f) => path.relative(ROOT, f));
  assert.ok(arts.some((f) => f.includes(".next/static") && f.endsWith(".js")),
    "حزم العميل غير مفحوصة");
  assert.ok(arts.some((f) => f.endsWith("routes-manifest.json")),
    "المانيفستات غير مفحوصة");
  assert.ok(arts.some((f) => f.endsWith(".html")), "HTML المبنيّ غير مفحوص");
});

// ─── لا إيجابيات كاذبة من الوثائق ──────────────────────────────────────────
test("⛔ الوثائق والمصدر خارج نطاق الفحص", () => {
  const arts = collectArtifacts().map((f) => path.relative(ROOT, f));
  for (const f of arts) {
    assert.ok(!f.startsWith("docs/"), `وثيقة داخل نطاق الفحص: ${f}`);
    assert.ok(!f.startsWith("lib/") && !f.startsWith("components/"),
      `مصدر داخل نطاق الفحص: ${f}`);
    assert.ok(!f.startsWith("tests/"), `اختبار داخل نطاق الفحص: ${f}`);
  }
});

// ─── ⛔ الحارس لا يطبع سرًّا ─────────────────────────────────────────────────
test("⛔ المخرَج عند الفشل لا يحتوي السرّ نفسه", () => {
  const secret = "sb_secret_ABCDEFGHIJKLMNOP";
  const tmp = path.join(ROOT, ".next", "__leak_probe.js");
  // ⚠️ لو أنشأنا `.next` هنا وتركناه، بدا للتشغيل التالي أنّ بناءً موجود
  //    بينما هو مجلّد فارغ — فيفشل فحص الآثار بلا سبب ظاهر. يُزال إن أنشأناه.
  const hadNext = fs.existsSync(path.join(ROOT, ".next"));
  if (!hadNext) fs.mkdirSync(path.join(ROOT, ".next"), { recursive: true });
  fs.writeFileSync(tmp, `const k=${JSON.stringify(secret)};`);
  try {
    const hits = scanFile(tmp);
    assert.equal(hits.length, 1, "لم يُرصد السرّ في ملفّ اصطناعيّ");
    const printed = JSON.stringify(hits);
    assert.ok(!printed.includes(secret), "🔴 الحارس يطبع السرّ نفسه");
    assert.ok(!printed.includes("ABCDEFGH"), "🔴 الحارس يطبع جزءًا من السرّ");
    assert.equal(hits[0].pattern, "supabase_secret_key");
    assert.equal(hits[0].redacted_fingerprint, fingerprint(secret));
    assert.equal(hits[0].redacted_fingerprint.length, 12);
  } finally {
    fs.unlinkSync(tmp);
    if (!hadNext) fs.rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
  }
});

// ─── تمييز مفتاح الخدمة عن المفتاح العامّ ──────────────────────────────────
test("🔴 يميّز service_role عن anon — والمفتاح العامّ لا يُبلَّغ", () => {
  const mk = (role) => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64")
      .replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    return `${b64({ alg: "HS256" })}.${b64({ role, iss: "supabase" })}.${"s".repeat(30)}`;
  };
  const dir = path.join(ROOT, ".next");
  const hadNext = fs.existsSync(dir);
  if (!hadNext) fs.mkdirSync(dir, { recursive: true });

  const anonFile = path.join(dir, "__anon_probe.js");
  fs.writeFileSync(anonFile, `const k="${mk("anon")}";`);
  const svcFile = path.join(dir, "__svc_probe.js");
  fs.writeFileSync(svcFile, `const k="${mk("service_role")}";`);
  try {
    // 🔴 المفتاح العامّ **يُشحن عمدًا** — الإبلاغ عنه إنذار كاذب يُفقد الحارس قيمته.
    assert.deepEqual(scanFile(anonFile), [], "أُبلغ عن المفتاح العامّ (anon) وهو مقصود");
    const svc = scanFile(svcFile);
    assert.equal(svc.length, 1, "لم يُرصد مفتاح service_role");
    assert.equal(svc[0].pattern, "supabase_service_role_jwt");
  } finally {
    fs.unlinkSync(anonFile); fs.unlinkSync(svcFile);
    if (!hadNext) fs.rmSync(dir, { recursive: true, force: true });
  }
});
