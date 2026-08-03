// ════════════════════════════════════════════════════════════════════════════
// tests/crm_handoff_contract.test.js — Phase 3: العقد مع منصّة المشاريع.
//
// «التسليم عقد لا أتمتة»: ربح الفرصة يُسجَّل كجاهزية لإنشاء **يدويّ**، ولا
// تُنشئ الوحدة مشروعًا ولا تكتب في المنصّة ولا في طلبات الأسعار.
//
// هذا الاختبار يفحص النصّ المصدريّ للطبقات الثلاث (SQL · TypeScript · الواجهة)
// لأنّ العقد لا يُفرَض بالنيّة: يكفي زرّ واحد لاختراقه.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, LIB, POSTCHECK, read, exists, funcBody, selfTest, FROZEN_TABLES,
} = require("./crm_helpers.js");

const PANEL = read("components/portal/crm/CrmOpportunityPanel.tsx");
const LEADP = read("components/portal/crm/CrmLeadPanel.tsx");
const CENTER = read("components/portal/crm/CrmCenter.tsx");
const CONTRACT_DOC = "docs/CRM_PROJECT_HANDOFF_CONTRACT.md";

const WRITE_RE = (t) =>
  new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?${t}\\b`, "i");

test("وثيقة العقد موجودة وتنصّ على الحدّ صراحةً", () => {
  assert.ok(exists(CONTRACT_DOC), "وثيقة العقد مفقودة");
  const doc = read(CONTRACT_DOC);
  assert.match(doc, /يدويًّا/, "الوثيقة لا تذكر الإنشاء اليدويّ");
  assert.match(doc, /handoff_state/, "الوثيقة لا توثّق حالة التسليم");
  assert.match(doc, /ready_for_manual_creation/, "الوثيقة لا توثّق الحالة الجاهزة");
  assert.match(doc, /manually_created/, "الوثيقة لا توثّق حالة التسجيل");
  assert.match(doc, /crm_handoff_confirm/, "الوثيقة لا تسمّي دالّة التسجيل");
  for (const t of FROZEN_TABLES) {
    assert.ok(doc.includes(t), `الوثيقة لا تذكر ${t} ضمن الممنوع`);
  }
});

test("لا دالّة crm_* تكتب في منصّة المشاريع", () => {
  // نفحص أجسام الدوالّ لا الملفّ كلّه: التعليقات تذكر المنصّة بالاسم عمدًا.
  const bodies = [...SQL.matchAll(
    /create\s+or\s+replace\s+function\s+public\.(crm_\w+)\s*\([^)]*\)[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi)];
  assert.ok(bodies.length >= 80, `عدد الدوالّ المفحوصة ${bodies.length} أقلّ من المتوقّع`);
  for (const [, name, body] of bodies) {
    const code = body.replace(/^\s*--.*$/gm, "");
    for (const t of FROZEN_TABLES) {
      assert.doesNotMatch(code, WRITE_RE(t), `${name}: تكتب في ${t} — خرق التجميد`);
    }
    assert.doesNotMatch(code, WRITE_RE("quote_requests"),
      `${name}: تكتب في quote_requests — المرجع للقراءة فقط`);
    assert.doesNotMatch(code, WRITE_RE("clients"), `${name}: تُنشئ عميلًا خارج الوحدة`);
  }
});

test("التلامس المسموح وحده: مفتاح اختياريّ + قراءة الاسم", () => {
  // FK اختياريّ، on delete set null، ولا يُضاف إلّا إن وُجد جدول المشاريع
  assert.match(SQL, /if to_regclass\('public\.projects'\) is not null[\s\S]{0,220}crm_opp_project_fk/i,
    "المفتاح الخارجيّ يُضاف بلا اكتشاف للجدول");
  assert.match(SQL, /add constraint crm_opp_project_fk foreign key \(handoff_project_id\)[\s\S]{0,120}on delete set null/i,
    "المفتاح ليس on delete set null — حذف مشروع سيُسقط صفّ فرصة");
  // اسم المشروع يُقرأ من الكتالوج ولا يُخمَّن (42703 كلّف دورة إنتاج)
  const label = funcBody("crm_project_label");
  assert.match(label, /information_schema\.columns/i, "اسم عمود المشروع مُخمَّن لا مقروء");
  assert.match(label, /'project_name','title','name'/, "لا ترتيب أفضلية لأسماء العمود");
  assert.doesNotMatch(label, /insert|update|delete/i, "قارئ الاسم يكتب");
});

test("مرجع عرض السعر للقراءة فقط، ويُعلن غيابه بصدق", () => {
  const q = funcBody("crm_quote_ref");
  assert.doesNotMatch(q, /insert|update|delete/i, "قارئ عرض السعر يكتب");
  assert.match(q, /to_regclass\('public\.quote_requests'\) is null/i, "لا اكتشاف لغياب الجدول");
  assert.match(q, /'quote_requests_absent'/, "الغياب لا يُعلَن بصدق (سيظهر 42P01 للمستخدم)");
  assert.match(q, /read_only'',?\s*true|'read_only', true/, "المرجع لا يُعلن أنّه للقراءة فقط");
  const link = funcBody("crm_opportunity_link_quote");
  assert.doesNotMatch(link.replace(/update public\.crm_opportunities[\s\S]*/i, ""), /quote_requests/i,
    "دالّة الربط تلمس جدول طلبات الأسعار");
  assert.match(link, /update public\.crm_opportunities set quote_request_id/i, "الربط لا يكتب في جدول الوحدة");
});

test("ربح الفرصة يسجّل الجاهزية ولا يُنشئ شيئًا", () => {
  const b = funcBody("crm_opportunity_close");
  assert.match(b, /handoff_state = 'ready_for_manual_creation'/, "الربح لا يسجّل الجاهزية");
  assert.match(b, /'creates_project', false/, "التدقيق لا يوثّق أنّه لم يُنشئ مشروعًا");
  assert.match(b, /لم يُنشأ مشروع/, "الردّ لا يصرّح بالعقد للمستخدم");
  for (const t of FROZEN_TABLES) assert.doesNotMatch(b, WRITE_RE(t), `الإغلاق يكتب في ${t}`);
  // والخسارة تتطلّب سببًا
  assert.match(b, /lost_reason_required/, "الخسارة تُقبل بلا سبب");
});

test("تسجيل التسليم: يتحقّق بالقراءة، ويكتب في جدوله هو فقط", () => {
  const b = funcBody("crm_handoff_confirm");
  // مفتاح crm.handoff يسمح بالتسجيل على فرصة **تُرى**، لا على أيّ فرصة:
  // الرؤية شرط أوّل مستقلّ، وإلّا صار المفتاح بابًا جانبيًّا للكتابة.
  const readIdx = b.indexOf("crm_can_read_opportunity(p_opp)");
  const permIdx = b.indexOf("crm_perm('crm.handoff')");
  assert.ok(readIdx !== -1, "لا اشتراط رؤية الفرصة قبل تسجيل التسليم");
  assert.ok(permIdx !== -1 && readIdx < permIdx, "مفتاح التسليم يُقيَّم قبل شرط الرؤية");
  assert.match(b, /o\.status <> 'won'/, "يُسجَّل تسليم لفرصة غير مربوحة");
  assert.match(b, /select exists \(select 1 from public\.projects p where p\.id = \$1\)/i,
    "لا تحقّق من وجود المشروع قبل الربط");
  assert.match(b, /'project_not_found'/, "معرّف مشروع خاطئ يُقبل صامتًا");
  assert.match(b, /'projects_absent'/, "غياب جدول المشاريع لا يُعلَن");
  assert.match(b, /handoff_state = 'manually_created'/, "لا تسجيل للإنشاء اليدويّ");
  assert.match(b, /'created_by_module', false/, "التدقيق لا يوثّق أنّ الوحدة لم تُنشئ");
  assert.match(b, /record_only_no_platform_write/, "التدقيق بلا وسم العقد");
  // الكتابة الوحيدة على crm_opportunities
  const writes = [...b.matchAll(/(insert\s+into|update|delete\s+from)\s+(public\.)?(\w+)/gi)].map((m) => m[3]);
  for (const w of writes) {
    assert.ok(/^crm_/.test(w), `التسليم يكتب في جدول خارج الوحدة: ${w}`);
  }
});

test("إعادة الفتح مرفوضة بعد تسجيل الإنشاء — سجلّ التسليم لا يُفسَد", () => {
  const b = funcBody("crm_opportunity_reopen");
  assert.match(b, /handoff_state = 'manually_created'/, "لا حماية لسجلّ التسليم");
  assert.match(b, /'handoff_recorded'/, "الرفض بلا سبب مقروء");
});

test("التحويل من عميل محتمل يُنشئ فرصة فقط — لا مشروع ولا عميل منصّة", () => {
  const b = funcBody("crm_lead_convert");
  assert.match(b, /insert into public\.crm_opportunities/i, "التحويل لا يُنشئ فرصة");
  assert.match(b, /'creates_project', false/, "التدقيق لا يوثّق العقد");
  assert.match(b, /لم يُنشأ مشروع/, "الردّ لا يصرّح بالعقد");
  for (const t of [...FROZEN_TABLES, "clients", "profiles"]) {
    assert.doesNotMatch(b, WRITE_RE(t), `التحويل يكتب في ${t}`);
  }
});

test("طبقة TypeScript لا تستدعي أيّ مسار إنشاء مشروع", () => {
  const rpcs = [...LIB.matchAll(/prpc<[^>]*>\("([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(rpcs.length >= 40, `عدد الاستدعاءات ${rpcs.length} أقلّ من المتوقّع`);
  for (const r of rpcs) {
    assert.ok(/^crm_/.test(r), `استدعاء خارج نطاق الوحدة: ${r}`);
  }
  for (const forbidden of ["project_create", "project_upsert", "large_project", "pc_create",
                           "project_core", "deliverable"]) {
    assert.ok(!LIB.includes(forbidden), `طبقة TS تذكر مسارًا من المنصّة: ${forbidden}`);
  }
  assert.match(LIB, /CRM_PROJECT_HANDOFF_CONTRACT\.md/, "طبقة TS لا تشير إلى العقد");
});

test("الواجهة: لا زرّ إنشاء مشروع، والزرّ الموجود يصف ما يفعله", () => {
  assert.match(PANEL, /تسجيل أنّ المشروع أُنشئ يدويًّا/, "زرّ التسجيل غائب أو مسمّى بغير اسمه");
  // تُزال أسطر التعليق: ذكر «لا زرّ إنشاء مشروع» في رأس الملفّ توثيق للعقد لا خرق له.
  const code = (s) => s.split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  for (const [src, name] of [[code(PANEL), "CrmOpportunityPanel"], [code(LEADP), "CrmLeadPanel"],
                             [code(CENTER), "CrmCenter"]]) {
    // مسار إنشاء حقيقيّ = مُعرِّف برمجيّ، لا جملة عربية تشرح أنّ الإنشاء يدويّ.
    assert.doesNotMatch(src, /createProject|create_project|project_upsert|projectCore|largeProject|pc_create/i,
      `${name}: يحتوي مسار إنشاء مشروع`);
    // ولا استيراد من طبقة المنصّة إطلاقًا
    const imports = [...src.matchAll(/from "@\/lib\/portal\/([a-zA-Z]+)"/g)].map((m) => m[1]);
    for (const im of imports) {
      assert.ok(["crm", "csv", "i18n", "pgerror"].includes(im),
        `${name}: يستورد طبقة خارج نطاق الوحدة: ${im}`);
    }
    // وزرّ أمر بصيغة «أنشئ مشروعًا» غير موجود
    assert.doesNotMatch(src, /أنشئ (لي )?مشروع/i, `${name}: زرّ إنشاء مشروع`);
  }
  // ويشرح العقد للمستخدم حيث يتوقّع أتمتة
  assert.match(PANEL, /لا تُنشئ مشاريع|لا تُنشئ مشروعًا/, "الواجهة لا تشرح العقد عند الربح");
  assert.match(CENTER, /يدويًّا/, "لوحة الفرص لا تذكر الإنشاء اليدويّ");
});

test("الحزمة لا تلمس أيّ ملفّ من مسارات التجميد", () => {
  const frozen = JSON.parse(read("tests/fixtures/project_platform_freeze.json"));
  const mine = [
    "docs/crm_sales_FOUNDATION_RUNME.sql", "docs/crm_sales_FOUNDATION_PREFLIGHT.sql",
    "docs/crm_sales_FOUNDATION_POSTCHECK.sql", "docs/crm_sales_FOUNDATION_ROLLBACK.sql",
    "lib/portal/crm.ts", "components/portal/crm/CrmCenter.tsx",
    "components/portal/crm/CrmAtoms.tsx", "components/portal/crm/CrmLeadPanel.tsx",
    "components/portal/crm/CrmOpportunityPanel.tsx", "app/(portal)/client-portal/crm/page.tsx",
    CONTRACT_DOC, "docs/CRM_ROLE_MATRIX.md", "docs/CRM_GO_LIVE_GUIDE.md",
  ];
  for (const f of mine) {
    assert.ok(exists(f), `ملفّ الحزمة مفقود: ${f}`);
    for (const p of frozen.paths) {
      assert.ok(!f.startsWith(p), `ملفّ الحزمة ${f} داخل مسار مجمَّد ${p}`);
    }
  }
});

test("SELF-TEST وPOSTCHECK يفرضان العقد آليًّا لا نصًّا", () => {
  const st = selfTest();
  assert.match(st, /تكتب في منصّة المشاريع المجمَّدة/, "self-test لا يمسح الكتابة في المنصّة");
  assert.match(st, /تكتب في quote_requests/, "self-test لا يمسح الكتابة في طلبات الأسعار");
  assert.match(st, /ready_for_manual_creation/, "self-test لا يفحص تسجيل الجاهزية");
  assert.match(st, /manually_created/, "self-test لا يفحص تسجيل الإنشاء اليدويّ");
  assert.match(POSTCHECK, /project_transition_requests/, "POSTCHECK لا يمسح جداول المنصّة");
  assert.match(POSTCHECK, /crm_opp_project_fk/, "POSTCHECK لا يفحص المفتاح الاختياريّ");
});
