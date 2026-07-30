// ════════════════════════════════════════════════════════════════════════════
// tests/compliance_permissions.test.js
//
// المُسنَدات الستّة بأسمائها · fail-closed · لا NULL · لا بوّابة فضفاضة ·
// لا anon · الكتابة عبر RPC وحدها · وكشف الميزة صادق في كلّ سطح.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CODE, SQL, read, exists, stripCommentsAndStrings, funcBody, selfTest,
  createdFunctions, createdTables,
  PREDICATES, EXTRA_PREDICATES, FORBIDDEN_GATES, NEW_TABLES, CODE_FILES, DOCS,
} = require("./compliance_helpers.js");

test("★ المُسنَدات الستّة موجودة بأسمائها الحرفية", () => {
  const fns = createdFunctions();
  for (const p of PREDICATES) {
    assert.ok(fns.includes(p), `المُسنَد المطلوب بالاسم مفقود: ${p}`);
  }
});

test("المُسنَدان الأضيق مضافان فوق الستّة لا بديلًا عنها", () => {
  const fns = createdFunctions();
  for (const p of EXTRA_PREDICATES) {
    assert.ok(fns.includes(p), `المُسنَد الأضيق مفقود: ${p}`);
  }
});

test("★★ كلّ مُسنَد يعيد boolean صريحًا ولا يعيد NULL", () => {
  for (const p of [...PREDICATES, ...EXTRA_PREDICATES, "vcc_perm", "vcc_storage_readable"]) {
    const b = funcBody(p);
    assert.ok(b, `المُسنَد ${p} مفقود`);
    assert.match(b, /returns\s+boolean/i, `${p} لا يعيد boolean`);
    assert.match(b, /coalesce/i, `${p} قد يعيد NULL`);
    assert.match(b, /exception\s+when\s+others\s+then\s+return\s+false/i, `${p} ليس fail-closed`);
  }
});

test("★★ ⛔ لا مُسنَد مبنيّ على can_manage_projects أو is_kian_member", () => {
  for (const p of [...PREDICATES, ...EXTRA_PREDICATES]) {
    const b = funcBody(p);
    for (const bad of FORBIDDEN_GATES) {
      assert.ok(!b.includes(bad), `${p} مبنيّ على بوّابة فضفاضة ممنوعة: ${bad}`);
    }
  }
  // ولا في أيّ دالّة من الوحدة.
  for (const fn of createdFunctions()) {
    const b = funcBody(fn) || "";
    for (const bad of FORBIDDEN_GATES) {
      assert.ok(!b.includes(bad), `${fn} تستعمل ${bad}`);
    }
  }
});

test("★ كلّ مُسنَد موظّف + مفتاح صريح (لا يفتحه دور عامّ)", () => {
  // ⚠️ can_verify_compliance_documents تركّب بوّابة الشبكة القائمة داخل نفس
  //    شرط `vcc_is_staff() and (…)`، فالمطابقة على تجاور حرفيّ كانت سترفض
  //    التركيب الصحيح. نفحص الشرطين منفصلين: موظّف **و** مفتاح صريح.
  for (const p of PREDICATES.filter((x) => x !== "can_view_compliance_center")) {
    const b = funcBody(p);
    assert.match(b, /public\.vcc_is_staff\(\)\s+and\s*\(?/i, `${p} لا يشترط أن يكون الحامل موظّفًا`);
    assert.match(b, /public\.vcc_perm\('compliance\./i, `${p} لا يشترط مفتاحًا صريحًا`);
    // ولا يفتحه دور عامّ بلا مفتاح.
    assert.doesNotMatch(b, /is_staff\(\)\s*,\s*false\)/i, `${p} يفتح لكلّ موظّف بلا مفتاح`);
  }
});

test("★★ بوّابة التوثيق تُركَّب فوق القائمة ولا تستبدلها", () => {
  const b = funcBody("can_verify_compliance_documents");
  assert.match(b, /can_verify_compliance\(\)/, "بوّابة الشبكة القائمة أُهملت ⇒ يفقد موثّقون حاليّون قدرتهم");
  assert.match(b, /compliance\.verify_documents/, "المفتاح الجديد غير مستعمل");
  // ولا تُعاد كتابة الدالّة القائمة.
  assert.doesNotMatch(CODE, /create\s+or\s+replace\s+function\s+public\.can_verify_compliance\s*\(\)/i,
    "الحزمة تعيد تعريف can_verify_compliance ⇒ قد تكسر شبكة المواهب");
});

test("★★ رؤية المقيَّد مفتاح مستقلّ لا يُشتقّ من رؤية المركز", () => {
  const b = funcBody("can_view_restricted_company_documents");
  assert.ok(!b.includes("can_view_compliance_center"),
    "رؤية المقيَّد مشتقّة من رؤية المركز ⇒ خطاب المصرف يصل لكلّ من يفتح الشاشة");
  const g = funcBody("can_issue_secure_document_grants");
  assert.ok(!g.includes("can_view_compliance_center"), "إصدار المنح مشتقّ من رؤية المركز");
});

test("★ إدارة الوثائق لا تمنح التوثيق، والعكس", () => {
  const m = funcBody("can_manage_compliance_documents");
  assert.ok(!m.includes("verify"), "بوّابة الإدارة تمنح التوثيق ⇒ يسقط الفصل");
  const dec = funcBody("vcc_document_decide");
  assert.ok(!dec.includes("can_manage_compliance_documents"), "التوثيق يقبل بوّابة الإدارة");
});

test("المفاتيح الثمانية مسجَّلة في الكتالوج بلا منح ضمنيّ", () => {
  const block = /insert\s+into\s+public\.permissions\(key[\s\S]*?on\s+conflict\s*\(key\)\s*do\s+nothing/i.exec(CODE);
  assert.ok(block, "لا تسجيل للمفاتيح");
  for (const k of [
    "compliance.view", "compliance.manage_documents", "compliance.verify_documents",
    "compliance.issue_grants", "compliance.view_restricted", "compliance.manage_registration",
    "compliance.view_request_status", "compliance.view_operational_documents",
  ]) {
    assert.ok(block[0].includes(`'${k}'`), `المفتاح غير مسجَّل: ${k}`);
  }
  // ⛔ ولا إدراج في جدول ربط الصلاحيات بالأشخاص.
  const code = stripCommentsAndStrings(SQL);
  assert.doesNotMatch(code, /insert\s+into\s+public\.(employee_permissions|profession_permissions|role_permissions)/i,
    "الحزمة تمنح مفاتيح لأحد تلقائيًّا");
});

test("★★ RLS مفعّلة على كلّ جداول الوحدة، والكتابة عبر RPC وحدها", () => {
  const rls = /do\s+\$rls\$([\s\S]*?)end\s+\$rls\$;/i.exec(CODE);
  assert.ok(rls, "كتلة RLS مفقودة");
  for (const t of NEW_TABLES) {
    assert.ok(rls[1].includes(`'${t}'`), `الجدول ${t} خارج كتلة RLS`);
  }
  assert.match(rls[1], /enable\s+row\s+level\s+security/i, "RLS غير مفعّلة");
  assert.match(rls[1], /revoke\s+all\s+on\s+public\.%I\s+from\s+anon/i, "لا سحب لصلاحية anon");
  // كلّ سياسة للقراءة فقط.
  const policies = [...CODE.matchAll(/create\s+policy\s+([a-z0-9_]+)\s+on\s+public\.(vcc_[a-z0-9_]+)\s+for\s+([a-z]+)/gi)];
  assert.ok(policies.length >= 13, `عدد السياسات ${policies.length} — أقلّ من الجداول`);
  for (const p of policies) {
    assert.equal(p[3].toLowerCase(), "select", `سياسة كتابة مباشرة على ${p[2]}: ${p[1]}`);
  }
});

test("★ كلّ جدول من الوحدة له سياسة قراءة (وإلّا صار غير مقروء بصمت)", () => {
  const withPolicy = new Set(
    [...CODE.matchAll(/create\s+policy\s+[a-z0-9_]+\s+on\s+public\.(vcc_[a-z0-9_]+)/gi)].map((m) => m[1]),
  );
  for (const t of NEW_TABLES) {
    assert.ok(withPolicy.has(t), `الجدول ${t} بلا سياسة قراءة`);
  }
});

test("★ سجلّ المنح وسجلّ الوصول أضيق من «رؤية المركز»", () => {
  const g = /create\s+policy\s+vcc_grants_read[\s\S]*?using\s*\(([^)]*)\)/i.exec(CODE);
  assert.match(g[1], /can_issue_secure_document_grants/, "سياسة المنح ليست على بوّابتها");
  assert.ok(!g[1].includes("can_view_compliance_center"), "كلّ من يرى المركز يرى المنح");
  const l = /create\s+policy\s+vcc_access_read[\s\S]*?using\s*\(([^)]*)\)/i.exec(CODE);
  assert.ok(!l[1].includes("can_view_compliance_center"), "سجلّ الوصول مفتوح لكلّ من يرى المركز");
});

test("★ بيانات تواصل المراجع خلف بوّابة المقيَّد", () => {
  const r = /create\s+policy\s+vcc_refs_read[\s\S]*?using\s*\(([^)]*)\)/i.exec(CODE);
  assert.match(r[1], /can_view_restricted_company_documents/,
    "بيانات طرف ثالث مكشوفة لكلّ من يرى المركز");
  const get = funcBody("vcc_company_get");
  assert.match(get, /-\s*'contact_email'\s*-\s*'contact_phone'/,
    "دالّة الملفّ تُعيد بيانات تواصل المراجع لغير المخوَّل");
});

test("★★ الدوالّ الداخلية لا تُمنَح لأحد", () => {
  const grants = /do\s+\$grants\$([\s\S]*?)end\s+\$grants\$;/i.exec(CODE);
  assert.ok(grants, "كتلة الصلاحيات مفقودة");
  const internalBlock = grants[1].split("foreach f in array array[")[2] || "";
  for (const f of ["vcc_emit", "vcc_log", "vcc_storage_readable", "vcc_perm",
    "vcc_document_normalize", "vcc_grant_document_guard"]) {
    assert.ok(internalBlock.includes(f), `${f} ليست في قائمة الدوالّ الداخلية`);
  }
  assert.match(internalBlock, /revoke\s+all\s+on\s+function[^\n]*from\s+authenticated/i,
    "الدوالّ الداخلية لا تُسحب من authenticated");
});

test("★ واجهة المستخدم ممنوحة لـauthenticated (وإلّا فالشاشة تسقط بـ42501)", () => {
  const grants = /do\s+\$grants\$([\s\S]*?)end\s+\$grants\$;/i.exec(CODE)[1];
  for (const f of [
    "vcc_access()", "vcc_company_get()", "vcc_document_register(jsonb)",
    "vcc_document_list(jsonb)", "vcc_readiness(text)", "vcc_grant_create(jsonb)",
    "vcc_registration_upsert(jsonb)", "vcc_registration_status_board()",
    "vcc_scan_compliance(boolean)",
  ]) {
    assert.ok(grants.includes(`'${f}'`), `الدالّة العامّة غير ممنوحة: ${f}`);
  }
  assert.match(grants, /grant\s+execute\s+on\s+function\s+public\.%s\s+to\s+authenticated/i,
    "لا منح تنفيذ للواجهة");
});

test("★★ ⛔ لا صلاحية anon على أيّ شيء", () => {
  const code = stripCommentsAndStrings(SQL);
  assert.doesNotMatch(code, /grant[^;\n]*to\s+anon/i, "منح لـanon");
  assert.doesNotMatch(code, /create\s+policy[^;]*to\s+anon/i, "سياسة لـanon");
  assert.match(selfTest(), /grantee\s*=\s*'anon'/, "الفحص الذاتيّ لا يتحقّق من غياب anon");
});

test("★ خريطة القدرات تعكس المُسنَدات الثمانية", () => {
  const a = funcBody("vcc_access");
  for (const p of [...PREDICATES, ...EXTRA_PREDICATES]) {
    assert.ok(a.includes(p), `خريطة القدرات لا تعرض ${p} ⇒ الواجهة ستخمّن`);
  }
});

test("★★ كشف الميزة: الطبقة تفرّق بين المنع والترحيلة الناقصة", () => {
  const ts = read(CODE_FILES.ts);
  assert.match(ts, /pgIsMigrationPending/, "الطبقة لا تستعمل المُصنِّف المشترك");
  assert.match(ts, /state:\s*"pending_migration"/, "لا حالة ترحيلة ناقصة");
  assert.match(ts, /state:\s*"denied"/, "لا حالة منع");
  // ★ الترتيب مهمّ: المنع يُفحَص بعد الترحيلة لكنّه لا يُبتلع تحت unknown.
  assert.match(ts, /permission_denied[\s\S]{0,200}not authorized/i,
    "«not authorized» النصّية لا تُصنَّف منعًا");
  assert.match(ts, /الميزة بانتظار تفعيل قاعدة البيانات/, "نصّ الترحيلة الناقصة مفقود");
});

test("★ الذرّات تعرض كلّ حالة بشكلها الخاصّ ولا تبتلع واحدة", () => {
  const atoms = read(CODE_FILES.atoms);
  for (const c of ["PendingMigration", "Denied", "EmptyState", "ErrorBox", "OutcomeView"]) {
    assert.ok(atoms.includes(`function ${c}`), `المكوّن ${c} مفقود`);
  }
  assert.match(atoms, /هذا منع صلاحية، لا نقص بيانات ولا عطل/, "المنع لا يُشرح للمستخدم");
});

test("★ الصفحة تُرسَم دائمًا والتصريح داخل اللوحات", () => {
  const page = read(CODE_FILES.portalPage);
  assert.match(page, /complianceAccess\(\)/, "الصفحة لا تقرأ خريطة القدرات");
  assert.match(page, /VCC_ACCESS_CLOSED/, "لا حالة مغلقة افتراضية");
  assert.match(page, /access\.can_issue_grants\s*&&/, "التبويبات لا تتبع القدرات الحقيقية");
});

test("جميع ملفّات الواجهة موجودة", () => {
  for (const [name, p] of Object.entries(CODE_FILES)) {
    assert.ok(exists(p), `ملفّ ${name} مفقود: ${p}`);
  }
});

test("★ /secure-document ممنوع من الفهرسة وغائب عن خريطة الموقع", () => {
  const robots = read(CODE_FILES.robots);
  assert.match(robots, /"\/secure-document"/, "الصفحة الخارجية غير ممنوعة من الفهرسة");
  const sitemap = read("app/sitemap.ts");
  assert.ok(!sitemap.includes("secure-document"), "الصفحة الخارجية في خريطة الموقع");
});

test("مصفوفة الأدوار موثَّقة وتذكر الفصول الثلاثة", () => {
  const doc = read(DOCS.roles);
  for (const p of PREDICATES) assert.ok(doc.includes(p), `المصفوفة لا تذكر ${p}`);
  assert.match(doc, /The uploader never verifies/i, "المصفوفة لا تذكر فصل الرفع عن التوثيق");
  assert.match(doc, /The preparer never approves/i, "المصفوفة لا تذكر فصل الإعداد عن الإذن");
  assert.match(doc, /Sales cannot reach a document at all/i, "المصفوفة لا تذكر تضييق المبيعات");
  assert.match(doc, /can_manage_projects/, "المصفوفة لا تصرّح بالبوّابات الممنوعة");
});

test("دليل التشغيل يصرّح بما أُعيد استخدامه وما أُنشئ", () => {
  const doc = read(DOCS.golive);
  assert.match(doc, /REUSED/, "الدليل لا يفصّل ما أُعيد استخدامه");
  assert.match(doc, /CREATED/, "الدليل لا يفصّل ما أُنشئ");
  assert.match(doc, /Deliberately NOT created/i, "الدليل لا يذكر ما امتنعنا عن إنشائه");
  assert.match(doc, /_bak_tvn_documents/, "الدليل لا يوثّق النسخة الاحتياطية المتروكة");
  assert.match(doc, /documented and untouched/i, "الدليل لا يقول إنّها موثَّقة وغير مبنيّ عليها");
});

test("★ _bak_tvn_documents موثَّقة ولا يُبنى عليها", () => {
  const code = stripCommentsAndStrings(SQL);
  assert.ok(!code.includes("_bak_tvn_documents"), "الحزمة تقرأ النسخة الاحتياطية المتروكة");
});

test("قائمة القبول تغطّي المسارات الحرجة", () => {
  const doc = read(DOCS.acceptance);
  for (const p of [
    "Upload is not verification", "Sensitivity", "no false submission",
    "Secure grants", "Readiness honesty", "Nothing else broke",
  ]) {
    assert.ok(doc.includes(p), `قائمة القبول لا تغطّي: ${p}`);
  }
  assert.match(doc, /project_platform_freeze/, "قائمة القبول لا تتحقّق من حارس التجميد");
});

test("★ الحزمة لا تلمس منصّة المشاريع المجمَّدة", () => {
  const code = stripCommentsAndStrings(SQL);
  for (const frozen of [
    "public.projects", "project_core", "deliverables", "deliverable_internal",
    "project_transition_requests",
  ]) {
    assert.ok(!code.includes(frozen), `الحزمة تمسّ كائنًا مجمَّدًا: ${frozen}`);
  }
  // project_id يُخزَّن كمرجع اختياريّ بلا مفتاح أجنبيّ.
  assert.match(CODE, /project_id\s+uuid,/, "لا مرجع مشروع اختياريّ");
  assert.doesNotMatch(CODE, /project_id\s+uuid\s+references/i, "مفتاح أجنبيّ إلى منصّة مجمَّدة");
});

test("الجداول المُنشأة كلّها تحمل بادئة vcc_ (لا تلوّث فضاء أسماء آخر)", () => {
  for (const t of createdTables()) {
    assert.match(t, /^vcc_/, `جدول خارج بادئة الوحدة: ${t}`);
  }
});
