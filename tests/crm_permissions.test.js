// ════════════════════════════════════════════════════════════════════════════
// tests/crm_permissions.test.js — Phase 3: مصفوفة الصلاحيات.
//
// المالك يرى كلّ شيء · الموظّف يرى سجلّاته · مدير الفريق يرى فريقه **إن وُجد
// المفتاح ومُنح وكان مديرًا فعليًّا** · العميل لا شيء إطلاقًا · وتجاوز الواجهة
// بنداء مباشر لا يفتح شيئًا لأنّ المنع في القاعدة لا في الزرّ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, LIB, read, funcBody, funcDecl, selfTest, WRITE_FNS, READ_FNS,
} = require("./crm_helpers.js");

const NAV = read("components/portal/nav.ts");
const CENTER = read("components/portal/crm/CrmCenter.tsx");

test("المفاتيح الأحد عشر مبذورة في الكتالوج القائم — لا محرّك صلاحيات ثانٍ", () => {
  const keys = ["crm.view", "crm.manage", "crm.view_team", "crm.manage_pipeline", "crm.import",
                "crm.export", "crm.view_commission", "crm.manage_commission", "crm.manage_targets",
                "crm.manage_scoring", "crm.handoff"];
  for (const k of keys) assert.match(SQL, new RegExp(`'${k.replace(".", "\\.")}'`), `المفتاح ${k} غير مبذور`);
  assert.match(SQL, /insert into public\.permissions \(key, category, sensitivity, sort_order, label_ar, label_en\)/i,
    "البذر لا يستعمل كتالوج الصلاحيات القائم");
  // لا جدول صلاحيات موازٍ
  assert.doesNotMatch(SQL, /create table if not exists public\.crm_permissions/i, "كتالوج صلاحيات ثانٍ");
  assert.doesNotMatch(SQL, /create table if not exists public\.crm_roles/i, "جدول أدوار موازٍ");
});

test("الحسّاس مُعلَن حسّاسًا — رؤية العمولات وإدارتها والأهداف", () => {
  for (const k of ["crm.view_commission", "crm.manage_commission", "crm.manage_targets",
                   "crm.view_team", "crm.manage_scoring", "crm.import"]) {
    const line = SQL.split("\n").find((l) => l.includes(`'${k}'`) && l.includes("("));
    assert.ok(line, `سطر المفتاح ${k} غير موجود`);
    assert.match(line, /'sensitive'/, `${k} غير معلَّم حسّاسًا`);
  }
});

test("بوّابة الدخول تستبعد العميل والزائر تمامًا", () => {
  const view = funcBody("crm_can_view");
  assert.match(view, /auth\.uid\(\) is not null/i, "لا فحص جلسة");
  assert.match(view, /is_staff\(\)/, "بوّابة العرض لا تشترط كون المستخدم موظّفًا");
  const isClient = funcBody("crm_is_client");
  assert.match(isClient, /not coalesce\(public\.is_staff\(\), false\)/i, "تعريف العميل غير صريح");
  // والمِجَسّ يفصح للعميل عن السبب بدل شاشة فارغة
  assert.match(funcBody("crm_access"), /مخصّصة لفريق العمل الداخليّ/, "المِجَسّ لا يشرح المنع");
});

test("مِجَسّ الكشف ينجح لأيّ جلسة ولا يمنح شيئًا — يفرّق بين «ممنوع» و«ترحيلة ناقصة»", () => {
  const acc = funcBody("crm_access");
  assert.doesNotMatch(acc, /raise exception/i,
    "crm_access ترفع استثناءً — عندها لا تستطيع الواجهة التفريق بين المنع وغياب الترحيلة");
  assert.match(acc, /'ok', true/, "المِجَسّ لا يعيد ok");
  assert.match(acc, /'authenticated', false/, "المِجَسّ لا يميّز الجلسة الغائبة");
  // بقيّة دوالّ القراءة محميّة فعلًا
  for (const f of READ_FNS.filter((x) => x !== "crm_access")) {
    assert.match(funcBody(f), /raise exception 'not authorized'/i, `${f}: بلا بوّابة`);
  }
});

test("رؤية الفريق ثلاثة شروط مجتمعة — وغياب المفتاح لا يعني منحًا ضمنيًّا", () => {
  const b = funcBody("crm_can_view_team");
  assert.match(b, /crm_perm_key_exists\('crm\.view_team'\)/, "لا فحص لوجود المفتاح في الكتالوج");
  assert.match(b, /crm_perm\('crm\.view_team'\)/, "لا فحص لمنح المفتاح");
  assert.match(b, /crm_teams t[\s\S]{0,120}manager_user_id = auth\.uid\(\)/,
    "لا اشتراط أن تكون الجلسة مديرة فريق فعليّ");
  assert.match(b, /is_staff\(\)/, "رؤية الفريق لا تشترط كون المستخدم موظّفًا");
  // وجود المفتاح يُقرأ من الكتالوج ويفشل مغلقًا
  const kx = funcBody("crm_perm_key_exists");
  assert.match(kx, /from public\.permissions where key = \$1/i, "لا قراءة فعلية للكتالوج");
  assert.match(kx, /return false;\s*\nend/i, "غياب الكتالوج لا يفشل مغلقًا");
});

test("جسر محرّك الصلاحيات يفشل مغلقًا لا مفتوحًا", () => {
  const b = funcBody("crm_perm");
  assert.match(b, /if auth\.uid\(\) is null or p_key is null then return false/i, "لا فحص جلسة");
  assert.match(b, /to_regprocedure\('public\.emp_has_permission\(uuid,text\)'\) is null then return false/i,
    "غياب المحرّك لا يُعامَل كمنع");
  assert.match(b, /exception when others then\s*\n\s*return false/i, "المصيدة لا تفشل مغلقة");
  assert.doesNotMatch(b, /exception when others then\s*\n\s*return true/i, "مصيدة تفشل مفتوحة");
});

test("مُسنَد الرؤية المركزيّ: نفسي · فريقي · الكلّ للإدارة — وبلا مالك = للإدارة", () => {
  const b = funcBody("crm_can_see_owner");
  assert.match(b, /when auth\.uid\(\) is null then false/i, "لا حالة «بلا جلسة»");
  assert.match(b, /crm_can_manage\(\), false\) then true/i, "الإدارة لا ترى الكلّ");
  assert.match(b, /when p_owner is null then false/i, "صفّ بلا مالك مفتوح للجميع");
  assert.match(b, /p_owner = auth\.uid\(\) then true/i, "المالك المباشر لا يرى سجلّه");
  assert.match(b, /crm_can_view_team\(\)[\s\S]{0,300}crm_team_members/i, "رؤية الفريق غير مربوطة بعضوية فعلية");
});

test("التحرير أضيق من القراءة — مدير فريق مطّلع لا يحرّر", () => {
  for (const f of ["crm_can_edit_lead", "crm_can_edit_opportunity"]) {
    const b = funcBody(f);
    assert.match(b, /crm_can_manage\(\), false\)/, `${f}: لا يعترف بمدير المبيعات`);
    assert.match(b, /owner_user_id = auth\.uid\(\)/, `${f}: لا يعترف بمالك السجلّ`);
    assert.doesNotMatch(b, /crm_can_view_team/, `${f}: رؤية الفريق تمنح تحريرًا — توسيع غير مقصود`);
  }
});

test("سياسات القراءة مبنيّة على المُسنَدات لا على أعمدة خام", () => {
  const need = [
    /create policy crm_leads_read on public\.crm_leads for select to authenticated\s*\n\s*using \(public\.crm_can_see_owner\(owner_user_id\)\)/i,
    /create policy crm_opportunities_read on public\.crm_opportunities for select to authenticated\s*\n\s*using \(public\.crm_can_see_owner\(owner_user_id\)\)/i,
    /create policy crm_audit_read on public\.crm_audit for select to authenticated\s*\n\s*using \(public\.crm_can_manage\(\)\)/i,
  ];
  for (const re of need) assert.match(SQL, re, `سياسة ناقصة أو غير مبنيّة على مُسنَد: ${re}`);
});

test("تجاوز الواجهة بنداء مباشر لا يفتح شيئًا: المنع داخل كلّ RPC", () => {
  // الفلترة بالمُسنَد لا بالمعامل: تمرير user_id لزميلك يعيد صفرًا لا بياناته.
  const cl = funcBody("crm_commission_list");
  assert.match(cl, /and coalesce\(public\.crm_can_view_commission\(r\.user_id\), false\)/i,
    "قائمة العمولات تُصفّي بالمعامل لا بالمُسنَد — نداء مباشر يسرّب");
  // القوائم تمرّ بمجموعة الرؤية لا بجدول مكشوف
  assert.match(funcBody("crm_leads_list"), /join public\.crm_visible_leads\(\)/i,
    "قائمة العملاء لا تمرّ بمجموعة الرؤية");
  assert.match(funcBody("crm_opportunities_list"), /join public\.crm_visible_opportunities\(\)/i,
    "قائمة الفرص لا تمرّ بمجموعة الرؤية");
  // ومجموعة الرؤية نفسها مبنيّة على المُسنَد
  assert.match(funcBody("crm_visible_leads"), /crm_can_see_owner\(l\.owner_user_id\)/i,
    "مجموعة الرؤية لا تستعمل المُسنَد");
  // الدوالّ SECURITY DEFINER تتجاوز RLS، لذا يجب أن تُطبّق الرؤية صراحةً
  for (const f of ["crm_lead_detail", "crm_opportunity_detail"]) {
    assert.match(funcBody(f), /raise exception 'not authorized'/i, `${f}: بلا بوّابة صفّ`);
  }
  assert.match(funcBody("crm_lead_detail"), /crm_can_read_lead\(p_lead\)/i, "تفاصيل العميل بلا مُسنَد صفّ");
  assert.match(funcBody("crm_opportunity_detail"), /crm_can_read_opportunity\(p_opp\)/i, "تفاصيل الفرصة بلا مُسنَد صفّ");
});

test("إسناد المالك حقّ إداريّ — الموظّف لا يُهدي سجلّه ولا يسحب سجلّ غيره", () => {
  for (const f of ["crm_lead_upsert", "crm_opportunity_upsert", "crm_company_upsert"]) {
    const b = funcBody(f);
    assert.match(b, /owner_user_id[\s\S]{0,200}crm_can_manage\(\)/i,
      `${f}: تعيين المالك بلا اشتراط صلاحية الإدارة`);
  }
});

test("الحذف وإعادة الفتح للإدارة وحدها، وبسبب مكتوب", () => {
  for (const f of ["crm_lead_delete", "crm_opportunity_delete", "crm_opportunity_reopen"]) {
    const b = funcBody(f);
    assert.match(b, /crm_can_manage\(\), false\) then raise exception 'not authorized'/i, `${f}: ليست إدارية`);
    assert.match(b, /length\(btrim\(coalesce\(p_reason, ''\)\)\) < 3/i, `${f}: تقبل بلا سبب`);
  }
});

test("العميل غائب عن التنقّل — وهذا تجميل فوق منع حقيقيّ", () => {
  assert.match(NAV, /crm:\s*\{ href: "\/client-portal\/crm"/, "التبويب غير مسجَّل");
  const sets = NAV.match(/const SETS[\s\S]*?\n\};/)[0];
  const clientLine = sets.split("\n").find((l) => /^\s*client:/.test(l));
  const leadLine = sets.split("\n").find((l) => /^\s*lead:/.test(l));
  assert.ok(clientLine && !clientLine.includes('"crm"'), "التبويب ظاهر للعميل");
  assert.ok(leadLine && !leadLine.includes('"crm"'), "التبويب ظاهر للـlead");
  for (const role of ["admin", "super_admin", "manager", "sales"]) {
    const line = sets.split("\n").find((l) => new RegExp(`^\\s*${role}:`).test(l));
    assert.ok(line && line.includes('"crm"'), `التبويب غائب عن ${role}`);
  }
  // والواجهة تعترف بأنّ المنع من القاعدة
  assert.match(CENTER, /can_view/, "الواجهة لا تقرأ قدرة العرض من الخادم");
  assert.match(CENTER, /Denied/, "الواجهة بلا شاشة منع صريحة");
});

test("لا service_role ولا مفتاح خدمة في كود المتصفّح", () => {
  for (const [name, src] of [["lib/portal/crm.ts", LIB],
                             ["CrmCenter.tsx", CENTER],
                             ["CrmLeadPanel.tsx", read("components/portal/crm/CrmLeadPanel.tsx")],
                             ["CrmOpportunityPanel.tsx", read("components/portal/crm/CrmOpportunityPanel.tsx")]]) {
    assert.doesNotMatch(src, /service_role|SERVICE_ROLE|SUPABASE_SERVICE/i, `${name}: يذكر service_role`);
  }
});

test("SELF-TEST يحرس مصفوفة الصلاحيات نفسها", () => {
  const st = selfTest();
  assert.match(st, /بوّابة العرض لا تستبعد العميل/, "self-test لا يحرس استبعاد العميل");
  assert.match(st, /access تمنح can_view بلا جلسة/, "self-test لا يحرس المِجَسّ");
  assert.match(st, /% بلا بوّابة جلسة/, "self-test لا يحرس بوّابة الجلسة في الكتابة");
  assert.match(st, /% لا ترفع منعًا صريحًا/, "self-test لا يحرس المنع الصريح");
  // وكلّ دالّة كتابة مشمولة بقائمة الفحص
  const list = st.match(/WRITE_FNS constant text\[\] := array\[([\s\S]*?)\];/);
  assert.ok(list, "self-test بلا قائمة دوالّ كتابة");
  for (const f of WRITE_FNS) {
    assert.ok(list[1].includes(`public.${f}(`), `self-test لا يفحص ${f}`);
  }
});
