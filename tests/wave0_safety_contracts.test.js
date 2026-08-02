// ════════════════════════════════════════════════════════════════════════════
// Wave 0 — عقود السلامة  (MASTER_BRIEF_v2.1.md §4 WAVE 0)
//
// اختبارات ساكنة: تقرأ ملفات المستودع فقط. لا قاعدة بيانات · لا شبكة · لا
// Production. تُشغَّل على Local وPreview وفي CI.
//
// الغرض ليس تغطية سطور، بل تثبيت القرارات التي يسهل التراجع عنها بالخطأ لاحقًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

// ─── ١) G8 — لا مهمّة cron رابعة ────────────────────────────────────────────
test("G8: vercel.json ما زال يحمل ثلاث مهام cron بالضبط", () => {
  const v = JSON.parse(read("vercel.json"));
  assert.equal(v.crons.length, 3, "Wave 0 يجب ألّا تضيف ولا تحذف مهمّة cron");
  const paths = v.crons.map((c) => c.path).sort();
  assert.deepEqual(paths, [
    "/api/cron/custody-alerts",
    "/api/cron/notify-email",
    "/api/cron/zoho-sync",
  ]);
});

test("G8: workflow النسخ الاحتياطي يدويّ — لا schedule مفعّلة", () => {
  const y = read(".github/workflows/db-backup.yml");
  assert.ok(y.includes("workflow_dispatch:"), "يجب أن يكون قابلًا للتشغيل يدويًا");
  // كل سطر schedule/cron يجب أن يكون معلَّقًا حتى تُضبط الأسرار.
  for (const line of y.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) continue;
    assert.ok(!t.startsWith("schedule:"), "schedule مفعّلة — تحتاج قرار خالد أولًا");
    assert.ok(!t.startsWith("- cron:"), "cron مفعّلة — تحتاج قرار خالد أولًا");
  }
});

// ─── ٢) G7 — التكاملات القائمة لم تُمَسّ ────────────────────────────────────
test("G7: مسارات Zoho وWhatsApp والمساعد ما زالت موجودة", () => {
  for (const p of [
    "app/api/integrations/zoho/webhook/route.ts",
    "app/api/integrations/zoho/sync-invoices/route.ts",
    "app/api/integrations/whatsapp/send/route.ts",
    "app/api/integrations/whatsapp/incoming/route.ts",
    "app/api/cron/zoho-sync/route.ts",
    "lib/server/zohoBooks.ts",
    "lib/whatsapp/route.ts",
    "lib/server/aiProvider.ts",
  ]) {
    assert.ok(exists(p), `Wave 0 يجب ألّا تحذف ${p}`);
  }
});

// ─── ٣) G5 — لا أسرار في ما أنتجته الموجة ──────────────────────────────────
test("G5: ملفات Wave 0 خالية من أنماط الأسرار", () => {
  const SECRET = /(eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/;
  const files = [
    "lib/consent.ts", "lib/observability.ts", "components/forms/ConsentField.tsx",
    "scripts/seed-preview.ts", ".github/workflows/db-backup.yml", ".env.example",
    "docs/SECRETS_AUDIT.md", "docs/ENVIRONMENTS.md", "docs/OBSERVABILITY.md",
    "docs/EMAIL_DNS.md", "docs/RESTORE_RUNBOOK.md", "docs/FEATURE_FLAG_REGISTRY.md",
    "docs/PUBLIC_POST_RATE_LIMIT_COVERAGE.md",
    "docs/consent_capture_EXTENSION_RUNME.sql",
  ];
  for (const f of files) assert.ok(!SECRET.test(read(f)), `نمط سرّ في ${f}`);
});

test("G5: .env.example أسماء فقط — لا قيمة بعد '=' عدا الافتراضات غير السرّية", () => {
  const SAFE = /^(false|true|disabled|claude|v\d+\.\d+|https:\/\/[a-z0-9./-]+|\d+)$/i;
  for (const line of read(".env.example").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const value = m[2].split("#")[0].trim();
    if (value === "") continue;
    assert.ok(SAFE.test(value), `قيمة مشبوهة في .env.example عند ${m[1]}`);
  }
});

// ─── ٤) V2-0.6-B — الترويسات الأمنية ────────────────────────────────────────
test("V2-0.6-B: HSTS مضاف، وترويسات Phase 2 لم تُفقد", () => {
  const c = read("next.config.js");
  assert.ok(c.includes("Strict-Transport-Security"), "HSTS مفقود");
  assert.ok(/max-age=\d{7,}/.test(c), "عمر HSTS قصير جدًا");
  assert.ok(c.includes("includeSubDomains"));
  // preload قرار لا رجعة فيه — يحتاج اعتماد خالد وحصر النطاقات الفرعية.
  assert.ok(!/Strict-Transport-Security[\s\S]{0,200}preload/.test(c), "preload يحتاج اعتمادًا صريحًا");
  for (const h of [
    "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy",
    "Permissions-Policy", "Content-Security-Policy",
  ]) assert.ok(c.includes(h), `ترويسة قائمة فُقدت: ${h}`);
  // الدرس الموثَّق: geolocation=() توقف تسجيل حضور الموظفين كليًا.
  assert.ok(c.includes("geolocation=(self)"), "geolocation يجب أن تبقى (self) لا ()");
});

// ─── ٥) V2-0.6-A — تغطية حدّ المعدّل ────────────────────────────────────────
test("V2-0.6-A: كل مسار POST تحت /api/public محدود", () => {
  const dir = path.join(ROOT, "app/api/public");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  for (const f of walk(dir).filter((f) => f.endsWith("route.ts"))) {
    const src = fs.readFileSync(f, "utf8");
    if (!src.includes("export async function POST")) continue;
    assert.ok(/rateLimit\(/.test(src), `مسار عام بلا حدّ: ${path.relative(ROOT, f)}`);
  }
});

// ─── ٦) V2-0.3-C — حواجز سكربت البذر ───────────────────────────────────────
test("V2-0.3-C: البذر يرفض الإنتاج وأي حاجز ناقص", () => {
  const src = read("scripts/seed-preview.ts");
  // تنفيذ منطق الحواجز بلا تشغيل السكربت: يُستخرج نصًّا ويُقيَّم في سياق معزول.
  //
  // ⚠️ تُجرَّد التعليقات النوعية **الثلاثة المعروفة في التوقيع فقط**. المحاولة
  // الأولى استخدمت regex عامًّا لكل ": نوع" فابتلع خصائص الكائنات الحرفية
  // (`{ ok: false }` → `{ ok }`) وانفجر بـReferenceError. التجريد الصريح أضيق
  // وأصدق: لو تغيّر التوقيع فشل الاختبار بدل أن يمرّ على منطق مشوَّه.
  const body = src
    .slice(src.indexOf("function checkGuards"), src.indexOf("async function main"))
    .replace("argv: string[]", "argv")
    .replace("env: NodeJS.ProcessEnv", "env")
    .replace("): Guard {", ") {");
  assert.ok(!/:\s*(string\[\]|NodeJS|Guard)/.test(body), "بقي تعليق نوعي غير مُجرَّد — حدّث الاختبار");
  // eslint-disable-next-line no-new-func
  const checkGuards = new Function(`${body}; return checkGuards;`)();

  const PROD = "https://prod.example.supabase.co";
  const PREV = "https://preview.example.supabase.co";
  const full = {
    KIAN_SEED_TARGET: "preview", SUPABASE_URL: PREV,
    KIAN_PRODUCTION_SUPABASE_URL: PROD, SUPABASE_SERVICE_ROLE_KEY: "x",
  };

  assert.ok(checkGuards(["--confirm"], full).ok, "الحالة السليمة يجب أن تمرّ");
  assert.ok(!checkGuards([], full).ok, "بلا --confirm يجب أن يرفض");
  assert.ok(!checkGuards(["--confirm"], { ...full, KIAN_SEED_TARGET: "production" }).ok);
  // ★ الحاجز الحاسم ★
  assert.ok(!checkGuards(["--confirm"], { ...full, SUPABASE_URL: PROD }).ok,
    "🔴 يجب أن يرفض حين يكون الهدف قاعدة الإنتاج");
  assert.ok(!checkGuards(["--confirm"], { ...full, KIAN_PRODUCTION_SUPABASE_URL: "" }).ok,
    "بلا مرجع للإنتاج لا يمكن إثبات الاختلاف — يرفض");
  assert.ok(!checkGuards(["--confirm"], { ...full, SUPABASE_SERVICE_ROLE_KEY: "" }).ok);
});

// ─── ٧) V2-0.9 — ملفات SQL أُنشئت ولم تُشغَّل ───────────────────────────────
test("V2-0.1-F: حزمة SQL كاملة (RUNME + ROLLBACK + POSTCHECK)", () => {
  for (const f of [
    "docs/consent_capture_EXTENSION_RUNME.sql",
    "docs/consent_capture_EXTENSION_ROLLBACK.sql",
    "docs/consent_capture_EXTENSION_POSTCHECK.sql",
  ]) assert.ok(exists(f), `مفقود: ${f}`);

  const runme = read("docs/consent_capture_EXTENSION_RUNME.sql");
  // إضافي فقط: لا DROP لكائن قائم، ولا لمس لتوقيع دالّة الالتقاط.
  assert.ok(!/^\s*drop\s+(table|function|policy)/im.test(runme), "RUNME يحوي DROP — يجب أن يكون إضافيًا");
  assert.ok(runme.includes("add column if not exists"), "يجب أن يكون idempotent");
  assert.ok(!/create\s+or\s+replace\s+function\s+public\.capture_public_intake/i.test(runme),
    "🔴 RUNME يعيد تعريف capture_public_intake — سيكسر كل إرسال عام");
  assert.ok(runme.includes("raise exception"), "يجب أن يحمل فحصًا ذاتيًا يرفض الالتزام");

  const post = read("docs/consent_capture_EXTENSION_POSTCHECK.sql");
  assert.ok(!/^\s*(insert|update|delete|drop|alter|create)\b/im.test(post),
    "POSTCHECK يجب أن يكون قراءة فقط");
});
