// ════════════════════════════════════════════════════════════════════════════
// tests/compliance_document_registry.test.js
//
// ★ سجلّ واحد ★ الحزمة توسّع tvn_documents ولا تُنشئ ثالثًا.
// ★ الرفع ليس توثيقًا ★ والتوثيق فعل منفصل بفاعل آخر.
// ★★ أوراكل القراءة العابر للـbuckets مغلق بنيويًّا ★★
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODE, SQL, read, stripCommentsAndStrings, funcBody, selfTest, addedConstraints,
  DOC_STATES, DOC_FIELDS, CRITICAL_CONSTRAINTS, REUSED, CODE_FILES,
} = require("./compliance_helpers.js");

test("★★ السجلّ واحد: الوثيقة تُكتب في tvn_documents لا في جدول جديد", () => {
  const reg = funcBody("vcc_document_register");
  assert.ok(reg, "vcc_document_register مفقودة");
  assert.match(reg, /insert\s+into\s+public\.tvn_documents/i, "التسجيل لا يكتب في السجلّ القائم");
  assert.match(reg, /owner_kind[\s\S]{0,400}'company'/i, "الوثيقة لا تُسجَّل كمملوكة للشركة");
});

test("الكتالوج يُعاد استخدامه: الأنواع الجديدة صفوف بيانات لا جداول", () => {
  assert.match(CODE, /insert\s+into\s+public\.tvn_document_types/i, "لا أنواع مزروعة");
  for (const key of [
    "gosi_certificate", "zakat_certificate", "zatca_compliance", "saudization_certificate",
    "national_address", "chamber_of_commerce", "hse_policy", "privacy_policy_doc",
    "company_profile_ar", "company_profile_en", "drone_operator_license",
  ]) {
    assert.ok(SQL.includes(`'${key}'`), `نوع الوثيقة المطلوب مفقود: ${key}`);
  }
  // ولا جدول أنواع ثانٍ.
  assert.doesNotMatch(CODE, /create\s+table[^\n]*vcc_document_types/i, "أُنشئ كتالوج أنواع ثانٍ");
});

test("★ owner_kind اكتسب company والمالك ما زال واحدًا بالضبط", () => {
  const cons = addedConstraints();
  assert.ok(cons.includes("tvn_doc_owner_kind_v2"), "قيد owner_kind الموسَّع مفقود");
  assert.ok(cons.includes("tvn_doc_owner_exact"), "قيد المالك الواحد مفقود");
  const m = /add\s+constraint\s+tvn_doc_owner_exact\s+check\s*\(([\s\S]*?)\);/i.exec(CODE);
  assert.ok(m, "تعريف tvn_doc_owner_exact غير مقروء");
  for (const kind of ["profile", "vendor", "asset", "company"]) {
    assert.ok(m[1].includes(`'${kind}'`), `فرع ${kind} مفقود من قيد المالك`);
  }
});

test("كلّ حقول الوثيقة المطلوبة في العقد موجودة", () => {
  for (const f of DOC_FIELDS) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(CODE), `حقل الوثيقة مفقود: ${f}`);
  }
});

test("الحالات الثماني معرَّفة في قيد واحد", () => {
  const m = /add\s+constraint\s+tvn_doc_status_chk\s+check\s*\(([\s\S]*?)\);/i.exec(CODE);
  assert.ok(m, "قيد الحالات مفقود");
  for (const s of DOC_STATES) {
    assert.ok(m[1].includes(`'${s}'`), `الحالة ${s} غير مسموحة`);
  }
});

test("★★ الرفع ليس توثيقًا — قيد بنيويّ لا اجتهاد داخل دالّة", () => {
  const cons = addedConstraints();
  assert.ok(cons.includes("tvn_doc_verified_iff_status"),
    "لا قيد يمنع بقاء verified=true على وثيقة مؤرشفة أو ملغاة");
  const m = /add\s+constraint\s+tvn_doc_verified_iff_status\s+check\s*\(([\s\S]*?)\);/i.exec(CODE);
  assert.match(m[1], /verified\s*=\s*false\s+or\s+doc_status\s*=\s*'verified'/i,
    "القيد لا يربط verified بالحالة");
});

test("★ التسجيل لا يقبل verified مهما أرسل العميل", () => {
  const reg = stripCommentsAndStrings(funcBody("vcc_document_register"));
  assert.doesNotMatch(reg, /vcc_bool\s*\(\s*p_input\s*,\s*'?verified/i,
    "التسجيل يقرأ verified من المدخل");
  assert.doesNotMatch(reg, /verified\s*=\s*true/i, "التسجيل يضبط verified=true");
});

test("★★ الرافع لا يوثّق — فحص صريح + قيد جدوليّ خلفه", () => {
  const dec = funcBody("vcc_document_decide");
  assert.ok(dec, "vcc_document_decide مفقودة");
  assert.match(dec, /uploaded_by\s+is\s+not\s+null\s+and\s+d\.uploaded_by\s*=\s*auth\.uid\(\)/i,
    "لا فحص للرافع");
  assert.match(dec, /can_verify_compliance_documents/i, "التوثيق ليس خلف بوّابة التوثيق");
  // والقيد القديم لم يُمسّ.
  assert.match(selfTest(), /tvn_doc_verify_not_self/, "الفحص الذاتيّ لا يحرس القيد القديم");
});

test("★ التوثيق يرفض وثيقة بلا ملفّ أو منتهية، ويشترط ملاحظة", () => {
  const dec = funcBody("vcc_document_decide");
  assert.match(dec, /storage_path\s+is\s+null/i, "يمكن توثيق وثيقة بلا ملفّ");
  assert.match(dec, /expires_on\s*<\s*current_date/i, "يمكن توثيق وثيقة منتهية");
  assert.match(dec, /ملاحظة التوثيق إلزامية/, "التوثيق بلا ملاحظة");
  assert.match(dec, /سبب الرفض إلزاميّ/, "الرفض بلا سبب");
});

test("★ الأرشفة والإلغاء يُنزلان verified — فتخرج الوثيقة من الصلاحية فورًا", () => {
  const st = funcBody("vcc_document_set_status");
  assert.ok(st, "vcc_document_set_status مفقودة");
  assert.match(st, /set\s+verified\s*=\s*false/i, "تغيير الحالة لا يُبطل التوثيق");
  assert.match(st, /archived[\s\S]{0,200}revoked[\s\S]{0,200}expired/i, "الحالات الثلاث غير مغطّاة");
  // والإلغاء أشدّ من الأرشفة.
  assert.match(st, /p_status\s*=\s*'revoked'[\s\S]{0,200}can_verify_compliance_documents/i,
    "الإلغاء ليس خلف بوّابة أشدّ");
});

test("★★ storage_bucket مثبَّت — أوراكل القراءة العابر مغلق", () => {
  const cons = addedConstraints();
  assert.ok(cons.includes("tvn_doc_bucket_pinned"), "الـbucket غير مثبَّت بقيد");
  const m = /add\s+constraint\s+tvn_doc_bucket_pinned\s+check\s*\(([\s\S]*?)\);/i.exec(CODE);
  assert.match(m[1], /'compliance-documents'/, "القيد لا يسمّي الـbucket الوحيد");
  // ولا يذكر أيّ bucket خاصّ آخر كقيمة مسموحة.
  for (const other of ["rental-private-documents", "project-deliverables", "hr-docs", "custody-evidence"]) {
    assert.ok(!m[1].includes(other), `القيد يسمح بـ${other}`);
  }
});

test("★★ نمط المسار مقيَّد — لا `..` ولا مسار حرّ", () => {
  const cons = addedConstraints();
  assert.ok(cons.includes("tvn_doc_path_shape"), "نمط المسار غير مقيَّد");
  const m = /add\s+constraint\s+tvn_doc_path_shape\s+check\s*\(([\s\S]*?)\);/i.exec(CODE);
  assert.match(m[1], /company\|profile\|vendor\|asset/, "النمط لا يحصر بادئة المالك");
  assert.match(m[1], /position\('\.\.'\s+in\s+storage_path\)\s*=\s*0/i, "لا منع لـ`..`");
});

test("★ التسجيل لا يقبل bucket من المتصل إطلاقًا", () => {
  const reg = stripCommentsAndStrings(funcBody("vcc_document_register"));
  assert.doesNotMatch(reg, /vcc_txt\s*\(\s*p_input\s*,\s*'storage_bucket'/i,
    "التسجيل يقرأ الـbucket من المدخل — ولو مع القيد، فذلك سطح لا داعي له");
});

test("★★ القائمة لا تُعيد مرجع تخزين أبدًا", () => {
  const list = funcBody("vcc_document_list");
  assert.ok(list, "vcc_document_list مفقودة");
  assert.doesNotMatch(list, /'storage_path'/, "القائمة تُعيد مسار التخزين");
  assert.doesNotMatch(list, /'storage_bucket'/, "القائمة تُعيد الـbucket");
  assert.match(list, /'has_file'/, "القائمة لا تقول حتّى إن كان هناك ملفّ");
});

test("★ الحساسية تُصفّي **الصفوف** لا الأعمدة فقط", () => {
  const list = funcBody("vcc_document_list");
  assert.match(list, /v_restricted\s+or\s+d\.sensitivity\s+not\s+in\s*\(\s*'confidential'\s*,\s*'restricted'\s*\)/i,
    "الوثيقة المقيَّدة تصل إلى غير المخوَّل ولو بأعمدة فارغة");
  assert.match(list, /can_view_restricted/, "لا بوّابة للمقيَّد");
  // و«غير مصرّح» يُقال صراحةً بدل قائمة قصيرة صامتة.
  assert.match(list, /هذا منع صلاحية لا نقص بيانات/,
    "القائمة لا تفرّق بين «ليس لديك صلاحية» و«لا توجد وثائق»");
});

test("★ الرقم الكامل لا يُخزَّن لوثائق الشركة، والمُقنَّع مقيَّد", () => {
  const cons = addedConstraints();
  assert.ok(cons.includes("tvn_doc_company_no_raw_number"), "لا قيد يمنع الرقم الكامل");
  assert.ok(cons.includes("tvn_doc_masked_number"), "لا قيد على التقنيع");
  const m = /add\s+constraint\s+tvn_doc_masked_number\s+check\s*\(([\s\S]*?)\);/i.exec(CODE);
  assert.match(m[1], /\[0-9\]\{5,\}/, "التقنيع لا يمنع خمسة أرقام متتالية");
});

test("★ المُشغِّل يبقي الدوالّ القديمة عاملة ويشدّد الحساسية", () => {
  const norm = funcBody("vcc_document_normalize");
  assert.ok(norm, "المُشغِّل الموحِّد مفقود");
  assert.match(CODE, /create\s+trigger\s+trg_vcc_document_normalize/i, "المُشغِّل غير مركّب");
  // يشتقّ الحالة من verified كي لا تفشل tvn_document_verify القديمة بـ23514.
  assert.match(norm, /if\s+new\.verified\s+then[\s\S]{0,120}doc_status\s*:=\s*'verified'/i,
    "المُشغِّل لا يشتقّ الحالة ⇒ الدوالّ القديمة ستفشل بـ23514");
  // ولا يُرخي restricted أبدًا.
  assert.match(norm, /new\.restricted\s*:=\s*true/, "المُشغِّل لا يشدّد restricted");
  assert.doesNotMatch(norm, /new\.restricted\s*:=\s*false/, "المُشغِّل يُرخي restricted");
  // ويمنع نشر ما لا يُنشر.
  assert.match(norm, /never_public/, "المُشغِّل لا يقرأ الأنواع الممنوعة من النشر");
});

test("⛔ ما لا يُنشر علنًا أبدًا مُعلَّم في الكتالوج", () => {
  assert.match(CODE, /add\s+column\s+if\s+not\s+exists\s+never_public/i, "العمود مفقود");
  const m = /set\s+never_public\s*=\s*true\s*\n\s*where\s+key\s+in\s*\(([\s\S]*?)\)/i.exec(CODE);
  assert.ok(m, "لا زرع لأنواع never_public");
  for (const k of ["bank_letter", "contract", "nda", "national_id", "passport", "authorized_signatory"]) {
    assert.ok(m[1].includes(`'${k}'`), `النوع ${k} غير معلَّم «لا يُنشر علنًا»`);
  }
});

test("★★ توسعة tvn_doc_valid تحفظ الفروع الثلاثة وتضيف company", () => {
  // بدون فرع company تعيد الدالّة false لكلّ وثيقة شركة (لأنّ p_owner_id فارغ)،
  // فيظهر مركز امتثال كامل وهو يقول «لا شيء صالح» — عطل صامت يبدو نتيجة.
  const v = funcBody("tvn_doc_valid");
  assert.ok(v, "الحزمة لا توسّع tvn_doc_valid");
  assert.match(v, /p_owner_kind\s*=\s*'company'/, "فرع الشركة مفقود");
  assert.match(v, /d\.profile_id\s*=\s*p_owner_id/, "فرع الملفّ الشخصيّ سقط");
  assert.match(v, /d\.vendor_id\s+=\s*p_owner_id/, "فرع المورّد سقط");
  assert.match(v, /d\.asset_id\s+=\s*p_owner_id/, "فرع الأصل سقط");
  assert.match(v, /verified\s*=\s*true/, "الصلاحية لم تعد تشترط التوثيق");
  assert.match(v, /expires_on\s+is\s+null\s+or\s+d\.expires_on\s*>=\s*current_date/i,
    "الصلاحية لم تعد تشترط عدم الانتهاء");
  // والحارس القديم محفوظ لغير الشركة.
  assert.match(v, /p_owner_id\s+is\s+null\s+and\s+coalesce\(p_owner_kind/i,
    "الحارس القديم (معرّف فارغ ⇒ false) لم يُحفَظ لغير الشركة");
});

test("★ ولا دالّة صلاحية ثانية في الحزمة", () => {
  const bad = [...CODE.matchAll(/create\s+or\s+replace\s+function\s+public\.(vcc_doc_valid|vcc_is_document_valid)[^a-z]/gi)];
  assert.equal(bad.length, 0, "أُنشئت دالّة صلاحية موازية");
});

test("★ سياسة التخزين تقرأ حساسية الصفّ وترفض الملفّ اليتيم", () => {
  const s = funcBody("vcc_storage_readable");
  assert.ok(s, "vcc_storage_readable مفقودة");
  assert.match(s, /if\s+v_sens\s+is\s+null\s+then\s+return\s+false/i,
    "ملفّ بلا صفّ في السجلّ يُقرأ ⇒ يتيم مقروء وفهرسة محتملة");
  assert.match(s, /can_view_restricted_company_documents/, "المقيَّد يُقرأ بمجرّد رؤية المركز");
  assert.match(s, /exception\s+when\s+others\s+then\s+return\s+false/i, "ليست fail-closed");
});

test("⛔ لا سياسة UPDATE ولا DELETE على bucket الامتثال", () => {
  // ⚠️ يُقرأ من المصدر الخام: السياستان داخل كتلة `execute $p$ … $p$`، وتجريد
  //    السلاسل يمحو محتوى الاقتباس الدولاريّ فيبدو الملفّ بلا سياسات إطلاقًا —
  //    وهو فحص يمرّ وهو لم يقرأ شيئًا.
  const policies = [...SQL.matchAll(/create\s+policy\s+"compliance documents [a-z]+"\s+on\s+storage\.objects\s+for\s+([a-z]+)/gi)]
    .map((m) => m[1].toLowerCase());
  assert.ok(policies.length > 0, "لم تُقرأ أيّ سياسة تخزين — الفحص لم يقرأ شيئًا");
  assert.deepEqual(policies.sort(), ["insert", "select"],
    `سياسات الـbucket: ${policies.join(", ")} — تبديل ملفّ تحت وثيقة موثَّقة يجب أن يستحيل`);
});

test("الـbucket خاصّ ويُعاد فرضه خاصًّا عند التعارض", () => {
  assert.match(CODE, /insert\s+into\s+storage\.buckets[\s\S]{0,400}false/i, "الـbucket ليس خاصًّا");
  assert.match(CODE, /on\s+conflict\s*\(\s*id\s*\)\s*do\s+update\s+set[\s\S]{0,120}public\s*=\s*false/i,
    "إعادة التشغيل قد تترك الـbucket عامًّا");
});

test("★ الواجهة توقّع بهوية المستخدم لا بمفتاح الخدمة", () => {
  const ts = read(CODE_FILES.ts);
  assert.match(ts, /getValidSession/, "الطبقة لا تستعمل جلسة المستخدم للتخزين");
  assert.doesNotMatch(ts, /SERVICE_ROLE|service_role/i, "مفتاح خدمة في طبقة المتصفّح");
  assert.match(ts, /complianceDocumentStorageRef/, "لا نداء يطلب المرجع من الخادم أوّلًا");
});

test("طبقة TS تقول إنّ «مرفوعة» ليست «صالحة»", () => {
  const ts = read(CODE_FILES.ts);
  assert.match(ts, /DOC_STATUS_HINT_AR/, "لا تلميح يفرّق الرفع عن التوثيق");
  assert.match(ts, /لم يُوثَّق بعد/, "التلميح لا يقول إنّ الرفع ليس توثيقًا");
  for (const s of DOC_STATES) {
    assert.ok(ts.includes(`${s}:`), `الحالة ${s} بلا ترجمة في الطبقة`);
  }
});

test("الاعتماديات المُعاد استخدامها مذكورة فعلًا في RUNME", () => {
  for (const dep of REUSED) {
    assert.ok(CODE.includes(dep), `الاعتماد المُعاد استخدامه غير مذكور: ${dep}`);
  }
});

test("كلّ القيود الحرجة موجودة", () => {
  const cons = addedConstraints();
  for (const c of CRITICAL_CONSTRAINTS) {
    const inline = new RegExp(`constraint\\s+${c}\\b`).test(CODE);
    assert.ok(cons.includes(c) || inline, `القيد الحرج مفقود: ${c}`);
  }
});
