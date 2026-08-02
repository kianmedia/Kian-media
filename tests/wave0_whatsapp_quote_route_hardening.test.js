// ════════════════════════════════════════════════════════════════════════════
// Wave 0 · V2-0.6-A — تحصين مسار /api/integrations/whatsapp/quote-request
//
// 🔒 هذا **إصلاح أمني لمسار قائم**، وليس ميزة WhatsApp جديدة ولا توسعة للتكامل.
//    G7 يُبقي التكامل مجمَّدًا، فنصف هذه الاختبارات مخصّص لإثبات أن شيئًا
//    وظيفيًا **لم يتغيّر**: نفس الـRPC، نفس المعاملات، نفس مسار النجاح، نفس
//    الأعلام والاعتمادات.
//
// اختبارات ساكنة على المصدر (نمط tests/comms_*.test.js) — لا شبكة ولا قاعدة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ROUTE = "app/api/integrations/whatsapp/quote-request/route.ts";
const src = fs.readFileSync(path.join(ROOT, ROUTE), "utf8");
const body = src.slice(src.indexOf("export async function POST"));

/** المصدر بلا تعليقات — كي لا يخلط الفحص بين شرحٍ مكتوب وسلوكٍ منفَّذ. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const bodyCode = stripComments(body);

// ═══ أ) الحماية أُضيفت ═════════════════════════════════════════════════════

test("V2-0.6-A: يستخدم الـrate limiter القائم — لا نظام جديد", () => {
  assert.ok(src.includes('from "@/lib/server/rateLimit"'),
    "يجب أن يستورد lib/server/rateLimit.ts القائم");
  assert.ok(/rateLimit\(`wa-quote:ip:\$\{clientKey\(req\)\}`/.test(body),
    "يجب أن يحدّ بالـIP عبر clientKey القائم");
  // ❌ لا محرك حدّ ثانٍ (G13-6).
  assert.ok(!/new\s+Map\(\)|setInterval|Redis|upstash/i.test(src),
    "🔴 يبدو أنه أُنشئ مخزن حدّ خاص بدل استخدام القائم");
});

test("V2-0.6-A: الحدّ يُطبَّق قبل التحليل وقبل الوصول لمفتاح الخدمة", () => {
  const iLimit = body.indexOf("rateLimit(");
  const iParse = body.indexOf("await req.json()");
  const iRpc = body.indexOf("rpcAsService");
  assert.ok(iLimit > -1 && iParse > -1 && iRpc > -1);
  assert.ok(iLimit < iParse, "الحدّ يجب أن يسبق تحليل الجسم");
  assert.ok(iLimit < iRpc, "🔴 الحدّ يجب أن يسبق استدعاء RPC بمفتاح الخدمة");
});

// ═══ ب) لا كشف عبر اختلاف الاستجابة ════════════════════════════════════════

test("★ كل مسارات الفشل تعيد استجابة واحدة متطابقة", () => {
  // كل `return` داخل POST إمّا notLinked() أو استجابة النجاح الوحيدة.
  const returns = body.match(/return\s+[^;]+;/g) || [];
  const failing = returns.filter((r) => !r.includes("ok: true"));
  assert.ok(failing.length >= 3, `متوقَّع عدة مسارات فشل، وُجد ${failing.length}`);
  for (const r of failing) {
    assert.ok(/notLinked\(\)/.test(r),
      `مسار فشل لا يستخدم الاستجابة الموحّدة:\n  ${r.trim()}`);
  }
});

test("★ الاستجابة الموحّدة: نفس الحالة ونفس الجسم دائمًا", () => {
  const m = /const notLinked = \(\) =>\s*NextResponse\.json\(([^;]+)\);/.exec(src);
  assert.ok(m, "notLinked غير معرَّفة كاستجابة واحدة ثابتة");
  const def = m[1];
  assert.ok(def.includes('error: "not_linked"'), "رمز الفشل يجب أن يكون واحدًا مبهمًا");
  assert.ok(def.includes("status: 200"), "كل الإخفاقات بحالة 200 — لا 400 تُميّز فئة");
  // ثابتة تمامًا: لا استيفاء قوالب ولا أي معرّف حرّ ⇒ لا تسرّب سياق.
  // (الفحص السابق استخدم /err/ فطابق كلمة "error:" نفسها — خطأ في الاختبار لا في الكود.)
  assert.ok(!def.includes("${"), "🔴 استيفاء قالب داخل الاستجابة الموحّدة");
  const identifiers = def.replace(/"[^"]*"/g, "").match(/\b[a-zA-Z_$][\w$]*\b/g) || [];
  assert.deepEqual(identifiers.filter((w) => !["ok", "error", "status", "false", "true"].includes(w)), [],
    "🔴 الاستجابة الموحّدة تشير إلى متغيّر — هذا يعيد فتح قناة الكشف");
});

test("🔴 لا رسالة PostgREST خام تصل إلى متصل مجهول", () => {
  assert.ok(!/error:\s*r\.error/.test(bodyCode),
    "🔴 عاد تسريب r.error — يكشف اسم الدالّة وتفاصيل المخطط ويميّز سبب الفشل");
  // يُفحص الكود بلا تعليقات: التعليق يشرح الرموز القديمة عمدًا، والمهم ألّا
  // تظهر في استجابة فعلية.
  const returned = (bodyCode.match(/return\s+[^;]+;/g) || []).join(" ");
  assert.ok(!/conversation_id_required|invalid_json|not_found_or_forbidden/.test(returned),
    "🔴 رمز فشل مميِّز عاد إلى الاستجابة — يسمح بتمييز حالة المحادثة");
});

test("السبب الحقيقي يُسجَّل خادميًا ومُنقَّحًا لا يُبتلع", () => {
  assert.ok(body.includes("WA_QUOTE_LINK_FAILED"), "يجب تسجيل سبب الفشل للتشخيص");
  assert.ok(/pgRedact\(String\(r\.error\)\)/.test(body),
    "السجلّ يجب أن يمرّ عبر pgRedact — الرسالة قد تحمل URL ببيانات فلاتر حقيقية");
});

// ═══ ج) 🔒 لم يتغيّر شيء وظيفي — G7 ════════════════════════════════════════

test("G7: نفس الـRPC بنفس المعاملات الستة عشر — لا توسعة للتكامل", () => {
  const call = body.slice(body.indexOf('rpcAsService<LinkedQuote>("wa_link_quote_request_public"'));
  const params = (call.slice(0, call.indexOf("});")).match(/p_[a-z_]+:/g) || []).sort();
  assert.deepEqual(params, [
    "p_budget_range:", "p_city:", "p_company:", "p_conversation:", "p_duration:",
    "p_email:", "p_external_request_id:", "p_full_name:", "p_lead_source:",
    "p_message:", "p_mode:", "p_phone:", "p_preferred_date:", "p_priority:",
    "p_quote_id:", "p_services:",
  ], "🔴 تغيّرت معاملات الـRPC — هذا توسعة للتكامل لا إصلاح أمني");
});

test("G7: مسار النجاح كما كان حرفيًا", () => {
  assert.ok(/return NextResponse\.json\(\{ ok: true, id: q\.id, mode \}, \{ status: 200 \}\);/.test(body),
    "🔴 تغيّر شكل استجابة النجاح — المتصل الشرعي يعتمد على العقد القائم");
});

test("G7: تأكيدات العميل لم تُمَسّ ولم تُعطَّل", () => {
  assert.ok(body.includes("sendQuoteConfirmations"), "🔴 حُذف استدعاء التأكيدات");
  assert.ok(/catch \{ \/\* confirmations must never fail the customer submission \*\/ \}/.test(body),
    "🔴 تغيّر تعامل التأكيدات مع الفشل");
});

test("G7: لا علم ولا اعتماد ولا متغيّر بيئة جديد في هذا المسار", () => {
  const envs = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual(envs, [], "🔴 المسار صار يقرأ متغيّر بيئة — لم يكن يقرأ أيًّا منها");
  assert.ok(!/WHATSAPP_|ZOHO_|AI_/.test(src), "🔴 أُقحم علم تكامل مجمَّد في هذا المسار");
});

// ═══ د) سلامة الاستجابة الموحّدة سلوكيًا ═══════════════════════════════════

test("notLinked تُنتج فعليًا {ok:false,error:'not_linked'} بحالة 200", () => {
  const m = /const notLinked = \(\) =>\s*NextResponse\.json\(([\s\S]*?)\);\n/.exec(src);
  assert.ok(m);
  // تقييم الوسيطين في سياق معزول بـNextResponse مُصطنَع — لا استيراد Next.
  // eslint-disable-next-line no-new-func
  const out = new Function("NextResponse", `return NextResponse.json(${m[1]});`)({
    json: (b, i) => ({ body: b, init: i }),
  });
  assert.deepEqual(out.body, { ok: false, error: "not_linked" });
  assert.deepEqual(out.init, { status: 200 });
});
