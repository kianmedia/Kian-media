// ════════════════════════════════════════════════════════════════════════════
// Wave 0 · V2-0.1 — عقد الموافقة على سياسة الخصوصية
//
// اختبارات ساكنة (قراءة ملفات) + سلوكية (منطق lib/consent.ts عبر تجريد أنواع
// ضيّق). لا قاعدة بيانات · لا شبكة · لا Production.
//
// ★ أهمّ عقد هنا هو الأول: مع إطفاء الراية، النماذج الأربعة كما هي حرفيًا (G6).
//   لو سقط ذلك، تكون موجة السلامة قد غيّرت سلوك الموقع الحيّ بلا قرار.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const FORMS = [
  "components/Contact.tsx",
  "app/(ar)/quote-request/page.tsx",
  "app/(ar)/book-meeting/page.tsx",
  "app/(ar)/upload-files/page.tsx",
];

/**
 * يحمّل lib/consent.ts في سياق معزول مع بيئة مُصطنعة.
 *
 * تجريد أنواع مقصود الضيق: يزيل الاستيراد و`export` وكتلة `interface` وتعليقات
 * أنواع **المعاملات وقيم الإرجاع فقط**. يليه حارس يرفض أي تعليق نوعي متبقٍّ —
 * فلو تغيّر الملف بشكل يكسر التجريد، يفشل الاختبار برسالة واضحة بدل أن يمرّ
 * على منطق مشوَّه أو ينفجر بـSyntaxError غامض.
 */
function loadConsent(env) {
  const src = read("lib/consent.ts")
    .replace(/^import .*$/gm, "")
    .replace(/\bexport (const|function|interface|type)\b/g, "$1")
    .replace(/interface ConsentPayload \{[\s\S]*?\n\}/, "")   // كتلة النوع
    .replace(/\)\s*:\s*[A-Za-z<>|\[\]. ]+\s*\{/g, ") {")       // نوع الإرجاع
    .replace(/\(([A-Za-z_$][\w$]*)\s*:\s*[A-Za-z<>|\[\]. ]+\)/g, "($1)") // نوع المعامل
    .replace(/ as const/g, "");

  const leftover = src.split("\n").find((l) => /^\s*(const|function)\b[^/]*:\s*[A-Z]/.test(l));
  assert.ok(!leftover, `بقي تعليق نوعي غير مُجرَّد — حدّث loadConsent:\n${leftover}`);

  // eslint-disable-next-line no-new-func
  return new Function("process", `${src}
    return { consentEnabled, consentPayload, consentBlocksSubmit,
             CONSENT_VERSION, CONSENT_LABEL, PRIVACY_PATH };`)({ env });
}

const OFF = loadConsent({});
const ON = loadConsent({ NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED: "true" });

// ─── ★ العقد الأهمّ: الراية مطفأة = لا تغيير ★ ─────────────────────────────
test("G6: مع إطفاء الراية لا يُحجب إرسال ولا تُرسَل موافقة", () => {
  assert.equal(OFF.consentEnabled(), false);
  assert.equal(OFF.consentBlocksSubmit(false), false, "🔴 الراية مطفأة ومع ذلك يُحجب الإرسال");
  assert.equal(OFF.consentBlocksSubmit(true), false);
  assert.equal(OFF.consentPayload(true), null, "🔴 تُرسَل موافقة والراية مطفأة");
  assert.equal(OFF.consentPayload(false), null);
});

test("G6: أي قيمة غير 'true' تعني OFF", () => {
  for (const v of ["", "false", "1", "yes", "TRUE", "  true  "]) {
    assert.equal(loadConsent({ NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED: v }).consentEnabled(), false,
      `القيمة ${JSON.stringify(v)} يجب ألّا تُفعّل الراية`);
  }
});

// ─── سلوك الراية وهي مُفعَّلة ───────────────────────────────────────────────
test("V2-0.1: الراية مُفعَّلة تحجب الإرسال بلا موافقة وتسمح معها", () => {
  assert.equal(ON.consentEnabled(), true);
  assert.equal(ON.consentBlocksSubmit(false), true, "يجب أن يُحجب الإرسال بلا موافقة");
  assert.equal(ON.consentBlocksSubmit(true), false);
});

test("V2-0.1-F: الحمولة تحمل الوقت والنسخة، ولا تُسجَّل موافقة سلبية", () => {
  const p = ON.consentPayload(true);
  assert.equal(p.consent_given, true);
  assert.equal(p.consent_version, ON.CONSENT_VERSION);
  assert.ok(!Number.isNaN(Date.parse(p.consent_at)), "consent_at يجب أن يكون ISO صالحًا");
  // غياب السجلّ أصدق من صفّ يدّعي رفضًا لم يُسأل عنه.
  assert.equal(ON.consentPayload(false), null, "الرفض لا يُسجَّل كصفّ");
});

// ─── النصّ والنسخة ──────────────────────────────────────────────────────────
test("V2-0.1-G: النصّ العربي مطابق لما يفرضه v2.1 والرابط لسياسة الخصوصية", () => {
  assert.equal(ON.CONSENT_LABEL.ar, "أوافق على سياسة الخصوصية وعلى تواصل كيان معي بخصوص طلبي");
  assert.ok(ON.CONSENT_LABEL.en.length > 0);
  assert.equal(ON.PRIVACY_PATH, "/privacy-policy");
  assert.ok(fs.existsSync(path.join(ROOT, "app/(ar)/privacy-policy")), "صفحة سياسة الخصوصية غير موجودة");
});

test("★ النسخة مربوطة بالنصّ: تغيير النصّ بلا رفع CONSENT_VERSION يفشل هنا", () => {
  // موافقة بلا نسخة نصّ لا تُثبت شيئًا: لو تغيّرت الصياغة لاحقًا، ادّعت كل
  // الصفوف التاريخية موافقةً على نصّ لم يره أصحابها. البصمة تُجمّد الاقتران.
  const fingerprint = require("node:crypto")
    .createHash("sha256").update(ON.CONSENT_LABEL.ar + "|" + ON.CONSENT_LABEL.en).digest("hex").slice(0, 16);
  assert.equal(fingerprint, "4951b546c8f29d51",
    "تغيّر نصّ الموافقة. ارفع CONSENT_VERSION في lib/consent.ts وحدّث هذه البصمة في نفس الـcommit.");
  assert.match(ON.CONSENT_VERSION, /^\d{4}-\d{2}-\d{2}\.v\d+$/);
});

// ─── الأسلاك في النماذج الأربعة ─────────────────────────────────────────────
test("V2-0.1-A…D: النماذج الأربعة تستخدم المكوّن المشترك وتحجب الإرسال", () => {
  for (const f of FORMS) {
    const s = read(f);
    assert.ok(s.includes("ConsentField"), `${f} لا يعرض حقل الموافقة`);
    assert.ok(s.includes("consentBlocksSubmit"), `${f} لا يحجب الإرسال`);
    assert.ok(s.includes("CONSENT_REQUIRED_MESSAGE"), `${f} لا يُبلغ المستخدم عند الحجب`);
  }
});

test("G13: مصدر واحد للموافقة — لا نصّ مكرر في أي نموذج", () => {
  for (const f of FORMS) {
    assert.ok(!read(f).includes("أوافق على سياسة الخصوصية"),
      `${f} يكرر نصّ الموافقة حرفيًا — يجب أن يأتي من lib/consent.ts وحده`);
  }
});

test("V2-0.1-E: /quick-access لا يحوي نموذجًا فلا موافقة فيه", () => {
  const s = read("app/(ar)/quick-access/page.tsx");
  assert.ok(!s.includes("ConsentField"), "أُضيف حقل موافقة إلى صفحة روابط بلا نموذج");
  assert.ok(!/<form|onSubmit/.test(s), "صار فيها نموذج — راجع قرار شطب V2-0.1-E");
});

// ─── المسار الخادمي: إضافي ولا يكسر الالتقاط ────────────────────────────────
test("V2-0.1-F: شقّ الموافقة منفصل ولا يمسّ استدعاء capture_public_intake", () => {
  const r = read("app/api/public/intake/route.ts");
  assert.ok(r.includes("public_intake_set_consent"), "شقّ الموافقة غير موصول");
  // 🔴 العقد الحاسم: لا معامل موافقة داخل نداء الالتقاط — وإلا فشل كل إرسال
  // بـPGRST202 حتى تُطبَّق الترحيلة.
  const call = r.slice(r.indexOf('rpcAsService<string>("capture_public_intake"'), r.indexOf("});", r.indexOf("capture_public_intake")));
  assert.ok(!/consent/i.test(call),
    "🔴 أُضيف معامل موافقة إلى capture_public_intake — سيكسر كل إرسال عام قبل تطبيق SQL");
  assert.ok(r.includes("PUBLIC_INTAKE_CONSENT_NOT_RECORDED"), "غياب الترحيلة يجب أن يُسجَّل لا أن يُبتلع");
  assert.ok(r.includes("consent_recorded"), "الردّ يجب أن يقول بصدق هل سُجّلت الموافقة");
});
