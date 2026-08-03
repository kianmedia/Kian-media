// ════════════════════════════════════════════════════════════════════════════
// tests/finance_zoho_contract.test.js — ★ لا مزامنة · لا اعتماد · لا ادّعاء ★
//
// الطلب كان: مراجعة المُهيّئ والعقود فقط، وتشخيص اتصال، وتصميم صادر/إعادة إرسال
// — بلا بناء، وبلا بيانات اعتماد، و**بلا قول «متّصل» أبدًا**.
//
// السبب الذي يجعل هذا اختبارًا لا وعدًا: في هذا المستودع سبق أن قُرئت إشارات
// نجاح مزوَّرة على أنّها تسليم فعليّ. البنية هنا تجعل الادّعاء مستحيلًا، وهذا
// الملفّ يحرس البنية.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, TS, read, funcBody, tableDef } = require("./finance_helpers.js");

const CONTRACT = read("docs/ZOHO_BOOKS_INTEGRATION_CONTRACT.md");
const CENTER = read("components/portal/finance/FinanceCenter.tsx");
const FIN_FILES = {
  "lib/portal/financeOps.ts": TS,
  "components/portal/finance/FinanceCenter.tsx": CENTER,
  "components/portal/finance/FinAtoms.tsx": read("components/portal/finance/FinAtoms.tsx"),
  "components/portal/finance/FinForms.tsx": read("components/portal/finance/FinForms.tsx"),
  "components/portal/finance/FinMyRequests.tsx": read("components/portal/finance/FinMyRequests.tsx"),
  "app/(portal)/client-portal/finance/page.tsx": read("app/(portal)/client-portal/finance/page.tsx"),
};

test("★ صندوق الصادر لا يملك حالة إرسال أصلًا ★", () => {
  const def = tableDef("fin_zoho_outbox");
  assert.match(def, /status\s+text not null default 'pending'/, "لا عمود حالة");
  const check = def.match(/check \(status in \(([^)]*)\)\)/);
  assert.ok(check, "قيد الحالات غير موجود — أيّ قيمة تمرّ");
  const states = check[1];
  for (const forbidden of ["sent", "synced", "delivered", "success"]) {
    assert.ok(!states.includes(`'${forbidden}'`),
      `الحالة ${forbidden} موجودة ⇒ صفّ يستطيع ادّعاء ما لم يحدث`);
  }
  assert.match(states, /'held'/, "لا حالة احتجاز — الافتراض سيبدو كطابور يتحرّك");
  // وحارس في الـSELF-TEST يمنع إعادة إدخالها
  assert.match(SQL, /صندوق الصادر يملك حالة إرسال/,
    "الـSELF-TEST بلا حارس يمنع إضافة حالة إرسال لاحقًا");
});

test("التشخيص يثبّت connected=false في جسمه ولا يستطيع قول العكس", () => {
  const b = funcBody("finops_zoho_diagnostic");
  assert.match(b, /'connected', false/, "التشخيص لا يثبّت connected=false");
  assert.ok(!/'connected', true/.test(b), "التشخيص يستطيع ادّعاء الاتصال");
  assert.match(b, /'integration_state', 'not_built'/, "حالة التكامل غير معلنة");
  assert.match(b, /'live_sync_attempted', false/, "لا تصريح بعدم محاولة المزامنة");
  assert.match(b, /'credentials_read', false/, "لا تصريح بعدم قراءة بيانات اعتماد");
  assert.match(b, /'delivered', 0/, "عدّاد التسليم غير مثبَّت صفرًا");
  assert.match(SQL, /تشخيص Zoho يستطيع ادّعاء الاتصال/,
    "الـSELF-TEST بلا حارس على ادّعاء الاتصال");
});

test("الإدراج وإعادة الجدولة يعيدان sent=false ورسالة صريحة", () => {
  const enq = funcBody("finops_zoho_outbox_enqueue");
  assert.match(enq, /'sent', false/, "الإدراج لا يصرّح بعدم الإرسال");
  assert.match(enq, /'held'/, "الإدراج لا يحتجز الصفّ");
  assert.match(enq, /integration_not_built/, "سبب الاحتجاز غير مكتوب");
  assert.match(enq, /لن يُرسَل/, "رسالة الإدراج توهم بالإرسال");
  const rep = funcBody("finops_zoho_outbox_replay");
  assert.match(rep, /'sent', false/, "إعادة الجدولة لا تصرّح بعدم الإرسال");
  assert.match(rep, /لا عامل يقرأ هذا الصندوق/, "إعادة الجدولة توهم بوجود عامل");
});

test("لا مكالمة شبكية خارجية من القاعدة ولا من كود الموديول", () => {
  // من القاعدة: حارس نصّيّ في الـSELF-TEST يمسح كلّ دوالّ finops%
  const st = SQL.slice(SQL.indexOf("-- §9) SELF-TEST"));
  for (const needle of ["pg_net", "http_post", "http_get", "dblink"]) {
    assert.ok(st.includes(needle),
      `الـSELF-TEST لا يمنع ${needle} — مكالمة شبكية من داخل القاعدة ستمرّ`);
  }
  assert.match(st, /تحاول مكالمة شبكية خارجية/, "لا رسالة فشل صريحة لهذا الحارس");
  assert.ok(!/\bpg_net\b\.|net\.http_post\(|net\.http_get\(|dblink\(/.test(SQL),
    "الحزمة تستدعي شبكة من داخل القاعدة");
  // من الواجهة: لا fetch ولا XHR في أيّ ملفّ من ملفّات الموديول
  for (const [name, src] of Object.entries(FIN_FILES)) {
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|axios/.test(src),
      `${name} يفتح اتصالًا خارجيًّا مباشرةً — كلّ الطلبات تمرّ بـprpc`);
  }
});

test("لا بيانات اعتماد في الحزمة ولا في كود الموديول", () => {
  assert.match(SQL, /client_secret\|refresh_token\|access_token\|api_key\|service_role/,
    "الـSELF-TEST لا يمنع ظهور بيانات اعتماد في دوالّ الموديول");
  for (const [name, src] of Object.entries(FIN_FILES)) {
    for (const secret of ["ZOHO_BOOKS_CLIENT_SECRET", "ZOHO_BOOKS_REFRESH_TOKEN",
      "ZOHO_CLIENT_SECRET", "client_secret", "refresh_token", "service_role"]) {
      assert.ok(!src.includes(secret), `${name} يذكر ${secret}`);
    }
  }
});

test("الموديول لا يستدعي المُهيّئ القائم — مراجعة لا تشبيك", () => {
  for (const [name, src] of Object.entries(FIN_FILES)) {
    for (const mod of ["lib/server/zoho", "zohoBooks", "zohoBooksEstimates",
      "createDraftEstimate", "booksConfigured", "readBooksConfig"]) {
      assert.ok(!src.includes(mod), `${name} يستورد/يستدعي ${mod}`);
    }
    assert.ok(!/api\/integrations\/zoho/.test(src),
      `${name} ينادي مسار تكامل Zoho القائم`);
  }
});

test("الشاشة تعرض «غير متّصل» ولا تشتقّ اتصالًا من وجود متغيّرات بيئة", () => {
  assert.match(CENTER, /d\.connected \? "متّصل" : "غير متّصل"/,
    "الشاشة لا تعرض حالة الاتصال من الخادم");
  assert.ok(!/process\.env\.ZOHO/.test(CENTER), "الشاشة تقرأ متغيّرات بيئة Zoho");
  assert.match(CENTER, /أُرسل فعلًا/, "الشاشة لا تعرض عدّاد التسليم الحقيقيّ");
  assert.match(CENTER, /ZOHO_BOOKS_INTEGRATION_CONTRACT\.md/,
    "الشاشة لا تحيل إلى العقد المكتوب");
  // ونوع TypeScript نفسه يمنع القيمة true
  assert.match(TS, /connected: false;/,
    "نوع التشخيص يسمح بـconnected: true — يجب أن يكون النوع حرفيًّا false");
});

test("العقد المكتوب يصف تكاملًا غير مبنيّ ولا يدّعي جاهزية", () => {
  assert.match(CONTRACT, /NOT BUILT|غير مبنيّ/, "العقد لا يعلن أنّ التكامل غير مبنيّ");
  assert.match(CONTRACT, /ما كان \*\*سيلزم\*\*|سيلزم/, "العقد لا يكتب المطلوب بصيغة مستقبلية");
  assert.match(CONTRACT, /idempotency|idempotency_key/i,
    "العقد لا يذكر شرط التنفيذ مرّة واحدة — أوّل سبب لفاتورة مكرّرة");
  assert.match(CONTRACT, /DRY_RUN/, "العقد بلا مرحلة تشغيل جافّ");
  assert.match(CONTRACT, /مسوّدة/, "العقد لا يشترط أن يبقى المستند مسوّدة");
  assert.match(CONTRACT, /tax_id/, "العقد لا يعالج انتقال الضريبة عبر الحدّ");
  assert.match(CONTRACT, /لا يجوز فعله/, "العقد بلا قائمة محظورات للبناء اللاحق");
  // يراجع المُهيّئ القائم صراحةً ويقول إنّ الموديول لا يستعمله
  assert.match(CONTRACT, /lib\/server\/zohoBooks\.ts/, "العقد لا يراجع المُهيّئ القائم");
  assert.match(CONTRACT, /\*\*لا شيء\*\*/, "العقد لا يوضّح انعدام العلاقة بالمُهيّئ القائم");
});

test("لا عامل ولا cron يقرأ صندوق الصادر المالي", () => {
  const routes = read("app/api/cron/zoho-sync/route.ts");
  assert.ok(!/fin_zoho_outbox|finops_/.test(routes),
    "مهمّة cron القائمة تقرأ صندوق الصادر المالي — سيُرسَل شيء بلا قرار");
});
