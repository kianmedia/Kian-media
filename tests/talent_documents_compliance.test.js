// ════════════════════════════════════════════════════════════════════════════
// tests/talent_documents_compliance.test.js — سجلّ الوثائق.
// الرفع ليس توثيقًا · صاحب الملفّ لا يوثّقه · الإقرار المعلن ليس إثباتًا ·
// التنبيهات ٩٠/٦٠/٣٠/٧ · الإلزاميّ الناقص.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, funcBody, tableDef } = require("./talent_helpers.js");

test("★ الرفع ليس توثيقًا ★ الصلاحية = موثَّقة وغير منتهية", () => {
  const body = funcBody("tvn_doc_valid");
  assert.match(body, /d\.verified = true/, "وثيقة غير موثَّقة تُعتبر صالحة");
  assert.match(body, /d\.expires_on is null or d\.expires_on >= current_date/,
    "وثيقة منتهية تُعتبر صالحة");
  assert.match(body, /exception when others then return false/, "لا يفشل مغلقًا");
});

test("دالّة الإدخال لا تقبل verified من المُدخِل إطلاقًا", () => {
  const body = funcBody("tvn_document_upsert");
  const insertBlock = body.slice(body.indexOf("insert into public.tvn_documents"),
                                 body.indexOf("returning id into v_id"));
  assert.doesNotMatch(insertBlock, /\bverified\b\s*,/,
    "★ خرق ★ الإدراج يكتب حالة التوثيق مباشرةً");
  assert.doesNotMatch(body, /tvn_bool\(p_input, 'verified'\)/,
    "★ خرق ★ المُدخِل يقرّر أنّ وثيقته موثَّقة");
  assert.match(body, /'verified', false/, "الدالّة لا تُصرّح بأنّ الناتج غير موثَّق");
});

test("قيد جدوليّ يمنع صاحب الملفّ من توثيق ملفّه — لا فحص داخل دالّة وحده", () => {
  const def = tableDef("tvn_documents");
  assert.match(def, /constraint tvn_doc_verify_not_self check/, "القيد مفقود");
  assert.match(def, /verified_by <> uploaded_by/, "القيد لا يقارن الرافع بالموثِّق");
  const body = funcBody("tvn_document_verify");
  assert.match(body, /d\.uploaded_by = auth\.uid\(\)/, "الدالّة لا تفحص التوثيق الذاتيّ");
  assert.match(body, /self_verification_blocked/, "الرفض بلا أثر تدقيق");
  assert.match(body, /can_verify_compliance\(\)/, "التوثيق بلا بوّابة امتثال");
});

test("تبديل الملفّ يُبطل التوثيق — وإلّا صار التوثيق قابلًا للاستبدال", () => {
  const body = funcBody("tvn_document_upsert");
  assert.match(body, /verified\s+= case when p_input \? 'storage_path'[\s\S]{0,160}then false/,
    "تغيير مسار التخزين لا يُبطل التوثيق");
  assert.match(body, /verified_by = case when p_input \? 'storage_path'[\s\S]{0,160}then null/,
    "الموثِّق يبقى بعد استبدال الملفّ");
});

test("مالك واحد بالضبط لكلّ وثيقة، ومطابق لنوعه", () => {
  const def = tableDef("tvn_documents");
  assert.match(def, /constraint tvn_doc_owner_exact check/, "لا قيد لمالك الوثيقة");
  for (const kind of ["profile", "vendor", "asset"]) {
    assert.match(def, new RegExp(`owner_kind = '${kind}'`), `النوع ${kind} غير مغطّى`);
  }
  assert.match(def, /constraint tvn_doc_dates check/, "تاريخ انتهاء قبل الإصدار مسموح");
});

test("★ الإقرار المعلن ليس إثباتًا ★ بوّابة الإسناد لا تقرأه", () => {
  const profiles = tableDef("tvn_profiles");
  for (const c of ["nda_declared", "insurance_declared", "safety_certs_declared",
                   "drone_permit_declared"]) {
    assert.match(profiles, new RegExp(`\\b${c}\\b`), `العمود ${c} مفقود`);
  }
  const guard = funcBody("tvn_assignment_guard");
  assert.doesNotMatch(guard, /_declared/,
    "★ خرق ★ الحارس يقبل مربّعًا محدَّدًا بدل وثيقة موثَّقة");
  assert.match(guard, /tvn_doc_valid\('profile', p_profile, 'drone_permit'\)/,
    "تصريح الدرون يُقرأ من غير سجلّ الوثائق");
  const suggest = funcBody("tvn_suggest");
  assert.doesNotMatch(suggest, /_declared/, "محرّك الاقتراح يثق بالإقرار المعلن");
});

test("الوثيقة الإلزامية الناقصة تشمل غير الموثَّقة والمنتهية لا الغائبة فقط", () => {
  const body = funcBody("tvn_missing_required_docs");
  assert.match(body, /is_required/, "لا يقرأ الإلزاميّ من الكتالوج");
  assert.match(body, /applies_to @> array\[v_type\]/, "الإلزاميّ لا يُربَط بنوع الملفّ");
  assert.match(body, /if not public\.tvn_doc_valid\('profile', p_profile, t\.key\)/,
    "يفحص الوجود بدل الصلاحية — وثيقة منتهية ستُعدّ موجودة");
});

test("تنبيهات ٩٠/٦٠/٣٠/٧ والمنتهية والإلزاميّ الناقص", () => {
  assert.match(tableDef("tvn_settings"), /doc_reminder_days\s+int\[\]\s+not null default '\{90,60,30,7\}'/,
    "نوافذ التذكير ليست ٩٠/٦٠/٣٠/٧");
  const body = funcBody("tvn_document_alerts");
  assert.match(body, /d\.expires_on < current_date/, "لا فئة «منتهية»");
  assert.match(body, /\(d\.expires_on - current_date\) = any \(v_days\)/, "النوافذ غير مستعملة");
  assert.match(body, /missing_required/, "لا فئة «إلزاميّ ناقص»");
  assert.match(body, /'bucket'/, "التنبيه بلا تصنيف يميّز المنتهي عن المقترب");
});

test("مسح الوثائق يُدرج أحداثًا بمنع تكرار، ولا يُرسل شيئًا", () => {
  const body = funcBody("tvn_document_alerts");
  assert.match(body, /document_expired/, "حدث الانتهاء مفقود");
  assert.match(body, /document_expiring/, "حدث الاقتراب مفقود");
  assert.match(body, /'talent\.doc:' \|\| r\.id::text/, "مفتاح التفرُّد لا يتضمّن الوثيقة");
  assert.match(body, /if not public\.can_verify_compliance\(\) then raise exception/,
    "المسح المُدرِج بلا بوّابة امتثال");
  assert.doesNotMatch(body, /send|smtp|resend|whatsapp/i, "مسار إرسال داخل المسح");
});

test("أنواع الوثائق المزروعة تغطّي ما يحتاجه الحارس", () => {
  for (const k of ["drone_permit", "commercial_registration", "insurance_policy",
                   "safety_certificate", "national_id", "bank_letter", "nda", "contract"]) {
    assert.match(SQL, new RegExp(`\\('${k}'`), `نوع الوثيقة ${k} غير مزروع`);
  }
  // الهوية والمال تُعلَّم مقيَّدة.
  assert.match(SQL, /'national_id'[^\n]*true,\s+false\)/, "الهوية غير معلَّمة identity");
  assert.match(funcBody("tvn_document_upsert"), /is_identity or is_financial/,
    "التقييد لا يُشتقّ من نوع الوثيقة");
});

test("وثائق الهوية والمال محجوبة عن كلّ من يرى الشبكة", () => {
  const idx = SQL.indexOf("create policy tvn_docs_read");
  const policy = SQL.slice(idx, idx + 340);
  assert.match(policy, /case when restricted then \(public\.can_verify_compliance\(\) or public\.tvn_can_view_bank\(\)\)/,
    "الوثيقة المقيَّدة تُقرأ ببوّابة الشبكة العامّة");
  assert.match(policy, /coalesce\(/, "السياسة قد تعيد NULL — وغير المحدَّد ليس منعًا");
});
