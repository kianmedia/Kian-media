// ════════════════════════════════════════════════════════════════════════════
// tests/compliance_registration_workflow.test.js
//
// ★★ لا ادّعاء تقديم إلكترونيّ ★★ · آلة حالة صريحة · قائمة تحقّق مشتقّة ·
// المبيعات ترى الحالة فقط · ولا نموذج عامّ ثانٍ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODE, SQL, read, funcBody, createdTables,
  REGISTRATION_STATES, CODE_FILES, DOCS,
} = require("./compliance_helpers.js");

test("الحالات الإحدى عشرة معرَّفة في قيد واحد", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_registration_requests\s*\(([\s\S]*?)\n\);/i.exec(CODE);
  assert.ok(t, "جدول الطلبات غير مقروء");
  for (const s of REGISTRATION_STATES) {
    assert.ok(t[1].includes(`'${s}'`), `حالة الطلب مفقودة: ${s}`);
  }
});

test("كلّ حقول الطلب المطلوبة في العقد موجودة", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_registration_requests\s*\(([\s\S]*?)\n\);/i.exec(CODE)[1];
  for (const f of [
    "organization_name", "organization_sector", "contact_name", "contact_email",
    "purpose", "required_doc_types", "deadline", "portal_reference", "notes",
    "source", "assigned_to", "priority", "status",
  ]) {
    assert.ok(new RegExp(`\\b${f}\\b`).test(t), `حقل الطلب مفقود: ${f}`);
  }
});

test("★★ «سُلّم يدويًّا» مستحيل بلا فاعل ووقت ومرجع وقناة", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_registration_requests\s*\(([\s\S]*?)\n\);/i.exec(CODE)[1];
  const m = /constraint\s+vcc_reg_manual_submission_proof\s+check\s*\(([\s\S]*?)\)\),/i.exec(t)
    || /constraint\s+vcc_reg_manual_submission_proof\s+check\s*\(([\s\S]*?)\n\s*constraint/i.exec(t);
  assert.ok(m, "قيد إثبات التسليم اليدويّ مفقود");
  for (const f of ["submitted_by", "submitted_at", "submission_reference", "submission_channel"]) {
    assert.ok(m[1].includes(f), `القيد لا يشترط ${f}`);
  }
});

test("★★ «جاهز للتسليم» مستحيل بلا اعتماد المالك", () => {
  assert.match(CODE, /constraint\s+vcc_reg_owner_approval_proof\s+check\s*\([\s\S]{0,300}owner_approved_by\s+is\s+not\s+null/i,
    "لا قيد يشترط اعتماد المالك");
  const tr = funcBody("vcc_registration_transition");
  assert.match(tr, /p_status\s*=\s*'ready_for_manual_submission'[\s\S]{0,200}vcc_is_owner\(\)/i,
    "الانتقال إلى «جاهز للتسليم» ليس محصورًا بالمالك");
});

test("★★ لا مسار في النظام كلّه يقدّم إلكترونيًّا", () => {
  const tr = funcBody("vcc_registration_transition");
  for (const bad of ["http://", "https://", "pg_net", "net.http", "curl", "fetch("]) {
    assert.ok(!tr.includes(bad), `الانتقال يستدعي طرفًا خارجيًّا: ${bad}`);
  }
  assert.match(tr, /النظام لم يُقدّم شيئًا إلكترونيًّا/, "لا تصريح بأنّ التقديم بشريّ");
  const panel = read(CODE_FILES.registration);
  assert.match(panel, /SUBMISSION_TRUTH_AR/, "الشاشة لا تعرض الحقيقة عن التقديم");
  const ts = read(CODE_FILES.ts);
  assert.match(ts, /النظام لا يقدّم إلكترونيًّا/, "الطبقة لا تصرّح بذلك");
});

test("★ آلة الحالة صريحة ولا تقبل قفزة", () => {
  const tr = funcBody("vcc_registration_transition");
  assert.match(tr, /v_allowed\s*:=\s*case\s+r\.status/i, "لا جدول انتقالات");
  assert.match(tr, /not\s*\(v_allowed\s*@>\s*array\[p_status\]\)[\s\S]{0,120}raise\s+exception/i,
    "الانتقال غير المسموح لا يُرفض");
  // مسار «تجهيز» → «سُلّم» مباشرةً ممنوع.
  const prep = /when\s+'preparing_documents'\s+then\s+array\[([^\]]*)\]/i.exec(tr);
  assert.ok(prep, "حالة preparing_documents بلا انتقالات");
  assert.ok(!prep[1].includes("submitted_manually"),
    "يمكن القفز من التجهيز إلى «سُلّم» متجاوزًا اعتماد المالك");
});

test("★ الأسباب إلزامية حيث يجب", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_registration_requests\s*\(([\s\S]*?)\n\);/i.exec(CODE)[1];
  assert.match(t, /vcc_reg_info_required_reason/, "«بانتظار معلومات» بلا سبب");
  assert.match(t, /vcc_reg_closed_reason/, "الإقفال والرفض بلا سبب");
});

test("★★ بند الوثيقة لا يُعلَّم يدويًّا — استيفاؤه مشتقّ", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_registration_checklist\s*\(([\s\S]*?)\n\);/i.exec(CODE);
  assert.ok(t, "جدول قائمة التحقّق غير مقروء");
  assert.match(t[1], /constraint\s+vcc_chk_document_not_manual\s+check\s*\(item_kind\s*<>\s*'document'\s+or\s+satisfied_manual\s+is\s+null\)/i,
    "يمكن تعليم بند وثيقة يدويًّا فوق وثيقة منتهية");
  const get = funcBody("vcc_registration_get");
  assert.match(get, /c\.item_kind\s*=\s*'document'\s*\n?\s*then\s+public\.tvn_doc_valid\('company'/i,
    "الاستيفاء لا يُشتقّ من التعريف الواحد للصلاحية");
  assert.match(get, /'derived'\s*,\s*c\.item_kind\s*=\s*'document'/i,
    "الواجهة لا تُخبَر أيّ بند مشتقّ");
  // والدالّة التي تكتب البند تُصفّر التعليم اليدويّ للوثائق.
  const up = funcBody("vcc_checklist_upsert");
  assert.match(up, /v_kind\s*=\s*'document'\s+then\s+null/i, "الكتابة تسمح بتعليم بند وثيقة");
});

test("★ الطلب يعرض الناقص والجاهزية من المصدر نفسه", () => {
  const get = funcBody("vcc_registration_get");
  assert.match(get, /missing_or_expired_doc_types/, "لا قائمة بالناقص");
  assert.match(get, /public\.vcc_readiness\(r\.readiness_context\)/i, "الطلب لا يعرض الجاهزية");
});

test("★★ المبيعات ترى الحالة فقط — تضييق بنيويّ لا ترشيح في المتصفّح", () => {
  const b = funcBody("vcc_registration_status_board");
  assert.ok(b, "لوحة الحالة مفقودة");
  for (const bad of [
    "portal_reference", "notes", "contact_email", "contact_phone", "contact_name",
    "submission_reference", "info_required_note", "assigned_to", "purpose",
  ]) {
    assert.ok(!b.includes(bad), `لوحة حالة المبيعات تكشف: ${bad}`);
  }
  for (const good of ["request_number", "organization_name", "status", "priority", "deadline"]) {
    assert.ok(b.includes(good), `لوحة الحالة بلا حقل: ${good}`);
  }
  assert.match(b, /vcc_can_view_request_status/, "اللوحة بلا بوّابتها");
});

test("★ سياسة الجدول لا تُدخل المبيعات أصلًا", () => {
  const m = /create\s+policy\s+vcc_reg_read\s+on\s+public\.vcc_registration_requests[\s\S]*?using\s*\(([^)]*)\)/i.exec(CODE);
  assert.ok(m, "سياسة قراءة الطلبات مفقودة");
  assert.match(m[1], /can_manage_vendor_registration/, "السياسة ليست على بوّابة الإدارة");
  assert.ok(!m[1].includes("vcc_can_view_request_status"),
    "سياسة صفّية «عمياء عن الأعمدة» تُدخل المبيعات ⇒ تسريب المرجع والملاحظات");
});

test("★ الشاشة تفرّق بين نطاق الإدارة ونطاق الحالة", () => {
  const panel = read(CODE_FILES.registration);
  assert.match(panel, /if\s*\(!access\.can_manage_registration\)/, "الشاشة لا تفرّق النطاقين");
  assert.match(panel, /registrationStatusBoard\(\)/, "نطاق المبيعات لا يستعمل الدالّة الضيّقة");
});

test("★★ لا نموذج عامّ ثانٍ ولا قراءة تلقائية من سطح الفرص", () => {
  const tables = createdTables();
  for (const bad of ["vcc_public_intake", "vcc_opportunity_requests", "vcc_supplier_applications"]) {
    assert.ok(!tables.includes(bad), `أُنشئ سطح وارد ثانٍ: ${bad}`);
  }
  const up = funcBody("vcc_registration_upsert");
  assert.match(up, /to_regclass\('public\.opportunity_requests'\)\s+is\s+null/i,
    "المرجع إلى سطح الفرص بلا كشف ميزة");
  // ⛔ لا نسخ تلقائيّ من الصفّ.
  assert.doesNotMatch(up, /select[^;]*from\s+public\.opportunity_requests/i,
    "الطلب ينسخ بيانات من سطح الفرص تلقائيًّا");
  // ولا مُشغِّل على الجدول العامّ.
  assert.doesNotMatch(CODE, /create\s+trigger[^\n]*on\s+public\.opportunity_requests/i,
    "أُنشئ مُشغِّل على سطح الفرص العامّ");
});

test("★ المرفقات بيانات وصفية بمرجع مقيَّد — لا رابط حرّ", () => {
  const t = /create\s+table\s+if\s+not\s+exists\s+public\.vcc_registration_attachments\s*\(([\s\S]*?)\n\);/i.exec(CODE);
  assert.ok(t, "جدول المرفقات غير مقروء");
  // سابقة hr_employee_documents.file_url لم تُنسخ.
  assert.ok(!/\bfile_url\b/.test(t[1]), "نُسخت سابقة الرابط الحرّ الذي يعيش خارج RLS");
  assert.match(t[1], /storage_bucket[^,]*check\s*\(storage_bucket\s*=\s*'compliance-documents'\)/i,
    "الـbucket غير مثبَّت في المرفقات");
  assert.match(t[1], /position\('\.\.'\s+in\s+storage_path\)\s*=\s*0/i, "المسار يسمح بـ`..`");
});

test("★ التعليقات داخلية ولا تدخل أيّ منحة", () => {
  assert.match(CODE, /comment\s+on\s+table\s+public\.vcc_registration_comments[\s\S]{0,200}لا تُعرَض لأيّ طرف خارجيّ/i,
    "التعليقات غير موصوفة بأنّها داخلية");
  const open = funcBody("vcc_grant_open");
  assert.ok(!open.includes("vcc_registration_comments"), "الاسترداد الخارجيّ يقرأ تعليقات داخلية");
});

test("★ أحداث الطلب تُدرَج ولا تُرسَل", () => {
  const tr = funcBody("vcc_registration_transition");
  assert.match(tr, /vcc_emit\('registration_awaiting_owner_approval'/i, "لا حدث عند انتظار الاعتماد");
  const scan = funcBody("vcc_scan_compliance");
  assert.match(scan, /registration_deadline_near/, "لا تنبيه لاقتراب الموعد");
  assert.match(scan, /array\[14,7,3,1,0\]/, "نوافذ الموعد غير معرَّفة");
});

test("وثيقة سير العمل تشرح الاتّجاه والفرق عن سطح الفرص", () => {
  const doc = read(DOCS.registration);
  assert.match(doc, /outbound/i, "الوثيقة لا تقول إنّ الوحدة صادرة");
  assert.match(doc, /inbound/i, "الوثيقة لا تقابلها بالوارد");
  assert.match(doc, /No claim of electronic submission/i, "الوثيقة لا تنفي التقديم الإلكترونيّ");
  assert.match(doc, /Checklist — derived, not ticked/i, "الوثيقة لا تشرح اشتقاق قائمة التحقّق");
});
