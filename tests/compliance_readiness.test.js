// ════════════════════════════════════════════════════════════════════════════
// tests/compliance_readiness.test.js
//
// ★ قواعد صريحة لا ذكاء اصطناعيّ ★ · مصدر صلاحية واحد · حالة «غير مُعدّ» بدل
// صفر مضلّل · تنبيهات ٩٠/٦٠/٣٠/٧ تُدرَج ولا تُرسَل.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODE, SQL, read, funcBody, createdFunctions,
  READINESS_STATES, CODE_FILES, DOCS,
} = require("./compliance_helpers.js");

test("★★ المحرّك قاعديّ ويصرّح بذلك", () => {
  const r = funcBody("vcc_readiness");
  assert.ok(r, "vcc_readiness مفقودة");
  assert.match(r, /'engine'\s*,\s*'rule_based'/i, "المحرّك لا يصرّح بأنّه قاعديّ");
  assert.match(r, /'ai_used'\s*,\s*false/i, "المحرّك لا ينفي استعمال الذكاء الاصطناعيّ");
  for (const bad of ["openai", "embedding", "model_score", "predict", "ml_"]) {
    assert.ok(!r.toLowerCase().includes(bad), `أثر نموذج في محرّك الجاهزية: ${bad}`);
  }
});

test("★★ مصدر صلاحية واحد — tvn_doc_valid وحدها تحكم", () => {
  const r = funcBody("vcc_readiness");
  assert.match(r, /public\.tvn_doc_valid\s*\(\s*'company'/i, "الجاهزية لا تستعمل التعريف الواحد");
  // ولا تعيد تعريف الصلاحية بيدها.
  assert.doesNotMatch(r, /d\.verified\s*=\s*true\s+and\s*\(?\s*d?\.?expires_on/i,
    "الجاهزية تعيد تعريف الصلاحية بدل استدعائها");
  // والأعمدة تُقرأ للشرح فقط، بعد الحكم.
  const verdictAt = r.search(/if\s+not\s+public\.tvn_doc_valid/i);
  const explainAt = r.search(/not\s+v_doc\.verified\s+then/i);
  assert.ok(verdictAt >= 0 && explainAt > verdictAt,
    "الشرح يسبق الحكم ⇒ قد يتباعدان");
});

test("★ الوثيقة المختارة هي «الأفضل» لا «الأحدث» — كي يطابق الشرحُ الحكم", () => {
  const r = funcBody("vcc_readiness");
  assert.match(r, /order\s+by\s+d\.verified\s+desc/i,
    "يُختار أحدث إصدار حتّى لو كان غير موثَّق بينما إصدار أقدم ساري ⇒ شرح يناقض الحكم");
});

test("★★ الحالات الخمس موجودة، و«غير مُعدّ» ليست «غير جاهز»", () => {
  const r = funcBody("vcc_readiness");
  for (const s of READINESS_STATES) {
    assert.ok(r.includes(`'${s}'`), `حالة الجاهزية مفقودة: ${s}`);
  }
  assert.match(r, /if\s+v_total\s*=\s*0\s+then\s*\n?\s*v_state\s*:=\s*'not_configured'/i,
    "غياب القواعد لا يُعطى حالته الخاصّة ⇒ سيُقرأ «غير ممتثل»");
  assert.match(r, /هذه ليست «غير جاهز»/, "لا تفسير للفرق بين «لم تُعدّ» و«غير جاهز»");
});

test("★ ترتيب الأولوية: المنتهي يسبق الناقص يسبق التحذير", () => {
  const r = funcBody("vcc_readiness");
  const expAt = r.search(/elsif\s+v_expired\s*>\s*0\s+then/i);
  const missAt = r.search(/elsif\s+v_missing\s*>\s*0\s+then/i);
  const warnAt = r.search(/elsif\s+v_warn\s*>\s*0\s+then/i);
  assert.ok(expAt > 0 && expAt < missAt && missAt < warnAt,
    "وثيقة إلزامية منتهية قد تُبتلع تحت «ناقص» أو «تحذيرات»");
});

test("★ كلّ متطلَّب يحمل سببه المكتوب من الدالّة نفسها", () => {
  const r = funcBody("vcc_readiness");
  assert.match(r, /'reason_ar'\s*,\s*v_reason/i, "الصفوف بلا سبب");
  assert.match(r, /'verdict'\s*,\s*v_verdict/i, "الصفوف بلا حكم");
  for (const v of ["met", "missing", "unverified", "expired", "wrong_language", "wrong_version"]) {
    assert.ok(r.includes(`'${v}'`), `الحكم مفقود: ${v}`);
  }
  // والرفع ليس توثيقًا يُقال حرفيًّا.
  assert.match(r, /الرفع ليس توثيقًا/, "لا تفريق مكتوب بين المرفوع والموثَّق");
});

test("★ جدول القواعد يمنع متطلَّبًا بلا مرجع (وإلّا قُرئ «مستوفًى» أبدًا)", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_readiness_requirements\s*\(([\s\S]*?)\n\);/i.exec(CODE);
  assert.ok(t, "جدول القواعد غير مقروء");
  assert.match(t[1], /check\s*\(\(kind\s*=\s*'document'\s+and\s+doc_type\s+is\s+not\s+null/i,
    "متطلَّب وثيقة بلا نوع ممكن ⇒ لن يُفحَص أبدًا");
  assert.match(t[1], /required_language/, "لا شرط لغة");
  assert.match(t[1], /min_version/, "لا شرط إصدار");
  assert.match(t[1], /is_mandatory/, "لا تفريق بين الإلزاميّ والاختياريّ");
});

test("القواعد مزروعة وتغطّي ما نصّ عليه العقد", () => {
  const seed = /insert\s+into\s+public\.vcc_readiness_requirements[\s\S]*?on\s+conflict/i.exec(CODE);
  assert.ok(seed, "لا زرع لقواعد الجاهزية");
  for (const key of [
    "commercial_register", "tax_certificate", "zatca_compliance", "zakat_certificate",
    "gosi_certificate", "saudization", "chamber", "national_address",
    "bank_letter", "insurance", "hse_policy", "privacy_policy",
    "company_profile_ar", "company_profile_en", "procurement_contact",
  ]) {
    assert.ok(seed[0].includes(`'${key}'`), `قاعدة الجاهزية المطلوبة مفقودة: ${key}`);
  }
});

test("★ الحقول الإلزامية في ملفّ الشركة تُفحَص فعلًا", () => {
  const r = funcBody("vcc_readiness");
  assert.match(r, /v_profj\s*->>\s*r\.profile_field/i, "حقول الملفّ لا تُقرأ");
  assert.match(r, /purpose\s*=\s*'procurement'/i, "مسؤول المشتريات لا يُفحَص");
});

test("★★ نوافذ ٩٠/٦٠/٣٠/٧ من مصدر واحد لا مصدرين", () => {
  const rd = funcBody("vcc_reminder_days");
  assert.ok(rd, "قارئ النوافذ مفقود");
  assert.match(rd, /tvn_settings/, "لا يُقرأ من إعدادات الشبكة القائمة");
  assert.match(rd, /fallback_reminder_days/, "لا احتياط صريح");
  assert.match(rd, /\{90,60,30,7\}/, "النوافذ المطلوبة غير موجودة");
  const scan = funcBody("vcc_scan_compliance");
  assert.match(scan, /public\.vcc_reminder_days\(\)/, "المسح يستعمل نوافذ خاصّة به");
});

test("★★ إدراج تنبيه ليس إرسالًا — لا لمس للقنوات ولا dry_run", () => {
  const emit = funcBody("vcc_emit");
  assert.ok(emit, "vcc_emit مفقودة");
  assert.doesNotMatch(emit, /comms_channel_set/i, "مسار الأحداث يفعّل قناة");
  assert.doesNotMatch(emit, /dry_run/i, "مسار الأحداث يمرّر dry_run");
  assert.match(emit, /idempotency_key/, "الأحداث بلا منع تكرار");
  assert.match(emit, /comms_enqueue/, "الأحداث لا تمرّ بالمركز القائم");
  // ولا طابور ثانٍ.
  assert.match(emit, /insert\s+into\s+public\.tvn_event_log/i, "أُنشئ سجلّ أحداث ثانٍ");
});

test("⛔ ولا دالّة واحدة في الوحدة تفعّل قناة إرسال", () => {
  for (const fn of createdFunctions()) {
    const b = funcBody(fn);
    if (!b) continue;
    assert.ok(!/comms_channel_set/i.test(b), `${fn} تفعّل قناة إرسال`);
    assert.ok(!/dry_run\s*=\s*false/i.test(b), `${fn} تُطفئ الوضع التجريبيّ`);
  }
});

test("أحداث الامتثال مسجَّلة بقناة portal وحدها", () => {
  const cat = /foreach\s+k\s+in\s+array\s+public\.vcc_event_keys\(\)[\s\S]*?end\s+loop;/i.exec(CODE);
  assert.ok(cat, "لا تسجيل للكتالوج");
  assert.match(cat[0], /array\[%L\]::text\[\][\s\S]{0,400}'portal'/i, "القناة ليست portal وحدها");
  for (const bad of ["'email'", "'whatsapp'", "'sms'"]) {
    assert.ok(!cat[0].includes(bad), `قناة إرسال مسجَّلة: ${bad}`);
  }
});

test("★ المسح يُثبّت الوثائق المنتهية بفعل مخوَّل ومُدقَّق", () => {
  const scan = funcBody("vcc_scan_compliance");
  // ترك verified=true على وثيقة منتهية يجعل tvn_doc_valid تكذب في كلّ تقرير.
  assert.match(scan, /set\s+verified\s*=\s*false\s*,\s*doc_status\s*=\s*'expired'/i,
    "الوثيقة المنتهية تبقى «موثَّقة» في القاعدة");
  assert.match(scan, /if\s+not\s+public\.can_verify_compliance_documents\(\)\s+then\s+raise/i,
    "تثبيت الانتهاء بلا بوّابة");
  assert.match(scan, /vcc_log\s*\(\s*'scan_compliance'/i, "المسح بلا تدقيق");
  // والقراءة وحدها لا تكتب شيئًا.
  assert.match(scan, /if\s+coalesce\(p_emit,\s*false\)\s+then/i, "المسح يكتب حتّى في وضع القراءة");
});

test("★ نتيجة المسح تقول صراحةً إنّ شيئًا لم يُرسَل", () => {
  const scan = funcBody("vcc_scan_compliance");
  assert.match(scan, /لا شيء يُرسَل/, "نتيجة المسح لا تنفي الإرسال");
  const panel = read(CODE_FILES.documents);
  assert.match(panel, /لا شيء يُرسَل/, "الشاشة لا تنفي الإرسال");
});

test("★ الطبقة والشاشة لا تعرضان صفرًا مكان «غير مُعدّ»", () => {
  const ts = read(CODE_FILES.ts);
  assert.match(ts, /READINESS_IS_UNKNOWN/, "لا تمييز لحالة «غير مُعدّ» في الطبقة");
  assert.match(ts, /if\s*\(r\.state\s*===\s*"not_configured"\)\s*return\s*"لم تُعدّ/,
    "نصّ الجاهزية يعرض عددًا في حالة «غير مُعدّ»");
  const panel = read(CODE_FILES.documents);
  assert.match(panel, /ready\.d\.state\s*!==\s*"not_configured"\s*&&/,
    "الشاشة تعرض «٠ من ٠» بدل «لم تُعدّ القواعد»");
});

test("وثيقة نموذج الجاهزية تشرح الحالات والمصدر الواحد", () => {
  const doc = read(DOCS.readiness).toLowerCase();
  for (const p of ["rule-based, not ai", "one definition of \"valid\"", "not_configured", "enqueuing is not sending"]) {
    assert.ok(doc.includes(p), `وثيقة الجاهزية لا تغطّي: ${p}`);
  }
});

test("★ توسعة tvn_doc_valid موثَّقة كسبب مباشر لعطل صامت لولاها", () => {
  const doc = read(DOCS.readiness);
  assert.match(doc, /every company document would read "not valid"/i,
    "الوثيقة لا تشرح لماذا كانت التوسعة ضرورية");
});
