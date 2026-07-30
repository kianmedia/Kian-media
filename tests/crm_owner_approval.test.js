// ════════════════════════════════════════════════════════════════════════════
// tests/crm_owner_approval.test.js — Phase 3 · CRM USABLE V1
//
// السيناريوهات المسمّاة هنا:
//   • تحرير المالك للهدف (owner target edit)
//   • منع الموظّف من الهدف (employee target denial)
//   • قاعدة العمولة لا تتغيّر إلّا باعتماد المالك
//   • معاينة الاستيراد الجافّة قبل أيّ كتابة (CSV preview / dry run)
//
// الفكرة التي تُختبَر هنا وليست تجميلًا: **الطلب المعلَّق ليس تغييرًا.** حامل
// المفتاح يقترح، والمالك وحده يعتمد، ولحظة الاعتماد هي لحظة وقوع التغيير.
// اختبارٌ يكتفي بوجود جدول طلبات يمرّ بينما يبقى المسار القديم مفتوحًا — لذلك
// الفحص هنا على **كلّ مسار كتابة** لا على وجود الجدول.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const { SQL, LIB, read, funcBody, funcDecl, selfTest, POSTCHECK } = require("./crm_helpers");

const UI = read("components/portal/crm/CrmCenter.tsx");

const GATED_WRITES = [
  ["crm_target_upsert", "target"],
  ["crm_target_delete", "target_delete"],
  ["crm_commission_plan_upsert", "commission_plan"],
  ["crm_commission_assign", "commission_assign"],
];

// ─── البوّابة نفسها ────────────────────────────────────────────────────────
test("اعتماد المالك لا يُشترى بمفتاح صلاحية — وهذا هو الفرق كلّه", () => {
  const body = funcBody("crm_can_approve_changes");
  assert.ok(body.includes("crm_is_owner_role()"), "الاعتماد لا يشترط دور المالك");
  assert.ok(
    !body.includes("crm_perm"),
    "الاعتماد يمرّ بكتالوج الصلاحيات ⇒ يمكن منحه ⇒ لم تعد «موافقة مالك»",
  );
  assert.ok(!body.includes("crm_can_manage"), "إدارة المبيعات تمنح الاعتماد");
  assert.match(body, /coalesce\(/i, "المُسنَد قد يعيد NULL");
  assert.ok(body.includes("is_staff()"), "الاعتماد لا يشترط أن يكون صاحبه موظّفًا");
});

test("لا مفتاح crm.approve في الكتالوج — الاعتماد ليس صلاحية تُمنح", () => {
  const seed = SQL.slice(SQL.indexOf("do $perm$"), SQL.indexOf("end $perm$;"));
  assert.ok(!/crm\.approve/i.test(seed), "بُذر مفتاح اعتماد — عاد الاعتماد منحة إداريّة");
});

// ─── كلّ مسار يغيّر هدفًا أو قاعدة عمولة ───────────────────────────────────
for (const [fn, kind] of GATED_WRITES) {
  test(`${fn}: غير المالك يقترح ولا يغيّر`, () => {
    const body = funcBody(fn);

    // 1) البوّابة موجودة، والاقتراح هو الفرع الافتراضيّ لغير المالك.
    assert.ok(
      body.includes("crm_can_approve_changes()"),
      `${fn} تغيّر بيانات حسّاسة بلا بوّابة اعتماد`,
    );
    assert.match(
      body,
      /if not coalesce\(public\.crm_can_approve_changes\(\), false\) then/,
      `${fn} تفحص البوّابة بصيغة قد تعيد NULL`,
    );

    // 2) الفرع المعلَّق يُنشئ طلبًا من النوع الصحيح ويعود فورًا.
    assert.ok(body.includes(`'${kind}'`), `${fn} تُنشئ طلبًا بنوع خاطئ`);
    assert.ok(body.includes("crm_approval_submit_core"), `${fn} لا تمرّ بنواة الطلب`);
    assert.ok(body.includes("pending_approval"), `${fn} لا تُبلّغ بصدق أنّ التغيير معلَّق`);

    // 3) ★ الأهمّ: الفرع المعلَّق لا يكتب في الجدول الهدف. لو كتب، لكانت
    //    «الموافقة» شاشةً فوق تغيير وقع فعلًا.
    const pendingBranch = body.slice(
      body.indexOf("crm_can_approve_changes()"),
      body.indexOf("crm_approval_submit_core") + 400,
    );
    assert.ok(
      !/insert into public\.crm_(targets|commission_plans|commission_assignments)\b/.test(pendingBranch),
      `${fn}: الفرع المعلَّق يكتب في الجدول — الطلب صار تغييرًا`,
    );
  });
}

test("تحرير المالك: مسار مباشر واحد، مُدقَّق باسمه", () => {
  const body = funcBody("crm_target_upsert");
  // المالك يمرّ إلى النواة مباشرةً، وهو الفاعل المسجَّل.
  assert.match(
    body,
    /return public\.crm_target_apply_core\(p, auth\.uid\(\)\)/,
    "مسار المالك لا يمرّ بنواة التطبيق أو لا يمرّر فاعله",
  );
  const core = funcBody("crm_target_apply_core");
  assert.ok(core.includes("set_by = p_actor") || core.includes("p_actor)"), "الفاعل غير مسجَّل");
  assert.ok(core.includes("crm_log('target_upsert'"), "تطبيق الهدف بلا تدقيق");
});

test("منع الموظّف من هدفه قائم كما هو — الاعتماد أضاف طبقة ولم يفتح ثغرة", () => {
  for (const fn of ["crm_target_upsert", "crm_target_delete"]) {
    const body = funcBody(fn);
    assert.ok(body.includes("self_target_denied"), `${fn}: الموظّف يمسّ هدفه`);
    // ولا يجوز أن يلتفّ على المنع بإرساله كطلب اعتماد.
    const selfIdx = body.indexOf("self_target_denied");
    const submitIdx = body.indexOf("crm_approval_submit_core");
    assert.ok(selfIdx > -1 && submitIdx > selfIdx,
      `${fn}: فحص الهدف الذاتيّ يأتي بعد إنشاء الطلب — يمكن اقتراح هدف نفسك`);
  }
  // والبوّابة الأولى ما زالت crm_can_manage_targets: بلا مفتاح لا اقتراح أصلًا.
  assert.ok(funcBody("crm_target_upsert").includes("crm_can_manage_targets()"));
  assert.ok(funcBody("crm_target_delete").includes("crm_can_manage_targets()"));
});

test("منع إسناد العمولة للنفس يسبق الاقتراح كذلك", () => {
  const body = funcBody("crm_commission_assign");
  const selfIdx = body.indexOf("self_commission_denied");
  const submitIdx = body.indexOf("crm_approval_submit_core");
  assert.ok(selfIdx > -1 && submitIdx > selfIdx, "يمكن اقتراح خطّة عمولة لنفسك");
});

// ─── القرار ────────────────────────────────────────────────────────────────
test("القرار للمالك وحده، ولا يُتّخذ مرّتين، ويُطبَّق باسم المعتمِد", () => {
  const body = funcBody("crm_approval_decide");
  assert.match(body, /auth\.uid\(\) is null/);
  assert.match(
    body,
    /if not coalesce\(public\.crm_can_approve_changes\(\), false\) then raise exception 'not authorized'/,
    "القرار بلا بوّابة مالك",
  );
  assert.match(body, /for update/i, "القرار بلا قفل — قراران متزامنان يطبّقان مرّتين");
  assert.ok(body.includes("already_decided"), "يمكن اعتماد الطلب نفسه مرّتين");
  // التطبيق باسم المعتمِد لا باسم مقدّم الطلب.
  assert.ok(body.includes("crm_target_apply_core(r.payload, auth.uid())"));
  assert.ok(body.includes("crm_commission_plan_apply_core(r.payload, auth.uid())"));
  assert.ok(body.includes("crm_commission_assign_core(r.payload, auth.uid())"));
  assert.ok(body.includes("crm_log('approval_approved'"), "الاعتماد بلا تدقيق");
  assert.ok(body.includes("crm_log('approval_rejected'"), "الرفض بلا تدقيق");
});

test("فشل التطبيق لا يُخفى ولا يُعلَن نجاحًا كاذبًا", () => {
  const body = funcBody("crm_approval_decide");
  assert.ok(body.includes("apply_error"), "خطأ التطبيق لا يُحفظ");
  assert.ok(body.includes("'apply_failed'"), "فشل التطبيق يمرّ صامتًا");
  // وعند الفشل يبقى الطلب معلَّقًا: لا يُوسم approved.
  const failBranch = body.slice(body.indexOf("exception when others"), body.indexOf("v_applied :="));
  assert.ok(!/status = 'approved'/.test(failBranch), "الطلب يُعتمَد رغم فشل تطبيقه");
});

test("السحب لصاحب الطلب أو للمالك — لا لطرف ثالث", () => {
  const body = funcBody("crm_approval_withdraw");
  assert.match(
    body,
    /r\.requested_by <> auth\.uid\(\) and not coalesce\(public\.crm_can_approve_changes\(\), false\) then\s*\n?\s*raise exception 'not authorized'/,
    "أيّ موظّف يستطيع سحب طلب غيره",
  );
  assert.ok(body.includes("already_decided"), "يمكن سحب طلب مبتوت");
});

// ─── الرؤية ────────────────────────────────────────────────────────────────
test("الطلب يحمل رقمًا حسّاسًا — فلا يراه إلّا المالك وصاحبه", () => {
  assert.match(
    SQL,
    /create policy crm_approval_requests_read on public\.crm_approval_requests for select to authenticated\s*\n\s*using \(public\.crm_can_approve_changes\(\) or \(public\.crm_can_view\(\) and requested_by = auth\.uid\(\)\)\)/,
    "سياسة قراءة طلبات الاعتماد ليست كما يجب",
  );
  // القائمة SECURITY DEFINER فتتجاوز RLS ⇒ تكرّر التصفية صراحةً.
  const body = funcBody("crm_approvals_list");
  assert.ok(body.includes("v_mine"), "القائمة لا تفرّق بين المالك وغيره");
  assert.ok(
    body.includes("(not v_mine or a.requested_by = auth.uid())"),
    "القائمة تتّكئ على RLS التي تتجاوزها بنفسها",
  );
  assert.match(funcDecl("crm_approvals_list"), /\bstable\b/i, "قائمة الطلبات ليست STABLE");
});

test("الجدول مُفعَّل عليه RLS وبلا سياسة كتابة وبلا anon", () => {
  const grants = SQL.slice(SQL.indexOf("-- §12"), SQL.indexOf("-- §13"));
  assert.ok(grants.includes("'crm_approval_requests'"), "الجدول خارج قائمة المنح/المنع");
  assert.ok(
    !/create policy [\w_]*approval[\w_]* on public\.crm_approval_requests for (insert|update|delete)/i.test(SQL),
    "توجد سياسة كتابة مباشرة على طلبات الاعتماد",
  );
  // النوى الداخلية لا تُمنح لأحد.
  for (const f of [
    "crm_approval_submit_core", "crm_target_apply_core",
    "crm_commission_plan_apply_core", "crm_commission_assign_core",
  ]) {
    assert.ok(grants.includes(f), `${f} خارج قائمة الـREVOKE — قابلة للنداء من الواجهة`);
  }
});

// ─── الواجهة لا تكذب ───────────────────────────────────────────────────────
test("الواجهة تقول «سيُرسَل للاعتماد» قبل الضغط لا بعده", () => {
  assert.ok(UI.includes("can_approve_changes"), "الواجهة لا تعرف من يعتمد");
  assert.ok(
    UI.includes('tr({ ar: "إرسال لاعتماد المالك", en: "Send for owner approval" })'),
    "زرّ الحفظ يعد بحفظ لن يقع",
  );
  // ولا تعرض «حُفظ» على طلب معلَّق.
  const i = UI.indexOf("async function save()");
  const fn = UI.slice(i, i + 1400);
  assert.ok(fn.includes("r.data.pending_approval"), "الواجهة لا تقرأ راية التعليق");
  const pendIdx = fn.indexOf("pending_approval");
  const savedIdx = fn.indexOf('ar: "حُفظ الهدف."');
  assert.ok(pendIdx > -1 && savedIdx > pendIdx, "رسالة «حُفظ» تسبق فحص التعليق");
});

test("عقد الكتابة في الواجهة يعترف بالحالة المعلَّقة", () => {
  assert.ok(LIB.includes("pending_approval?: boolean"), "لا نوع للحالة المعلَّقة");
  assert.ok(LIB.includes("CrmWriteOrPending"), "الكتابة المعلَّقة بلا نوع مستقلّ");
  for (const w of ["crmTargetUpsert", "crmTargetDelete", "crmCommissionPlanUpsert", "crmCommissionAssign"]) {
    const m = LIB.match(new RegExp(`export const ${w} = [\\s\\S]{0,320}?;`));
    assert.ok(m, `${w} غير موجودة`);
    assert.ok(m[0].includes("CrmWriteOrPending"), `${w} لا تُرجع حالة معلَّقة`);
  }
});

// ─── معاينة الاستيراد ──────────────────────────────────────────────────────
test("المعاينة STABLE — المنع من الكتابة من PostgreSQL لا من حسن النيّة", () => {
  assert.match(funcDecl("crm_import_preview"), /\bstable\b/i, "المعاينة ليست STABLE");
  const body = funcBody("crm_import_preview");
  assert.ok(
    !/insert\s+into|update\s+public|delete\s+from/i.test(body),
    "المعاينة تكتب — لم تعد معاينة",
  );
  assert.ok(body.includes("'wrote_nothing'"), "المعاينة لا تُصرّح بأنّها لم تكتب");
  assert.ok(body.includes("'dry_run'"), "الناتج لا يُعلن أنّه تشغيل جافّ");
});

test("المعاينة محميّة كالتنفيذ — لا يعاينها من لا يستورد", () => {
  const body = funcBody("crm_import_preview");
  assert.match(body, /auth\.uid\(\) is null/);
  assert.match(
    body,
    /if not coalesce\(public\.crm_can_import\(\), false\) then raise exception 'not authorized'/,
    "المعاينة تكشف قائمة العملاء لمن لا يملك الاستيراد",
  );
  // ونفس حدّ الصفوف كي لا تصير المعاينة باب إنهاك.
  assert.match(body, /> 1000 then/, "المعاينة بلا حدّ صفوف");
});

test("المعاينة تعطي قرارًا لكلّ صفّ، وتكشف التكرار داخل الملفّ نفسه", () => {
  const body = funcBody("crm_import_preview");
  for (const d of ["'insert'", "'duplicate'", "'skip'"]) {
    assert.ok(body.includes(d), `قرار ${d} غير محسوب`);
  }
  assert.ok(body.includes("crm_duplicate_core"), "المعاينة لا تستعمل كشف التكرار نفسه");
  // ★ التكرار داخل الملفّ: كشف القاعدة لا يراه لأنّ الصفّ لم يُدرج بعد.
  assert.ok(body.includes("duplicate_within_file"), "التكرار داخل الملفّ لا يُكشف");
  assert.ok(body.includes("v_seen_email") && body.includes("v_seen_phone"),
    "التكرار داخل الملفّ لا يُتتبَّع فعليًّا");
  // وتقول إن كانت الدفعة مستهلكة سابقًا بدل أن تفاجئ المستخدم بعد التنفيذ.
  assert.ok(body.includes("already_imported"), "لا تحذير من مفتاح دفعة مستهلَك");
});

test("المعاينة لا تُنشئ دفعة ولا تستهلك مفتاح التكرار", () => {
  const body = funcBody("crm_import_preview");
  assert.ok(!body.includes("insert into public.crm_import_batches"), "المعاينة تُنشئ دفعة");
  // وحدها crm_import_leads تُنشئ الدفعة.
  assert.ok(funcBody("crm_import_leads").includes("insert into public.crm_import_batches"));
});

test("الواجهة: اختيار الملفّ يعاين، والإدراج بضغطة ثانية صريحة", () => {
  assert.ok(UI.includes("crmImportPreview"), "الواجهة لا تعاين أصلًا");
  const onChange = UI.match(/accept="\.csv,text\/csv"[\s\S]{0,220}/);
  assert.ok(onChange, "لا حقل ملفّ للاستيراد");
  assert.ok(onChange[0].includes("doPreview"), "اختيار الملفّ يستورد فورًا");
  assert.ok(!onChange[0].includes("doExecute"), "اختيار الملفّ ينفّذ مباشرةً");

  // زرّ التنفيذ موجود ومنفصل ومعطَّل حين لا يوجد ما يُدرَج.
  assert.ok(UI.includes("void doExecute()"), "لا زرّ تنفيذ منفصل");
  assert.ok(
    UI.includes("disabled={busy || staged.preview.will_insert === 0}"),
    "التنفيذ متاح رغم أنّه لن يُدرج شيئًا",
  );
  // ولا نداء لـcrmImportLeads خارج زرّ التنفيذ.
  const calls = UI.match(/crmImportLeads\(/g) ?? [];
  assert.equal(calls.length, 1, "أكثر من مسار إدراج في الواجهة");
});

test("عقد المعاينة في lib يعكس الخادم بلا اختراع", () => {
  for (const k of [
    "dry_run", "wrote_nothing", "will_insert", "will_skip_duplicate",
    "will_skip_invalid", "duplicate_within_file", "already_imported",
  ]) {
    assert.ok(LIB.includes(k), `حقل المعاينة ${k} مفقود من العقد`);
  }
  assert.ok(LIB.includes("crm_import_preview"), "الغلاف لا ينادي الدالّة الصحيحة");
});

// ─── الحرّاس ───────────────────────────────────────────────────────────────
test("SELF-TEST يحرس العقدين داخل الترحيلة نفسها", () => {
  const st = selfTest();
  assert.ok(st.includes("can_approve_changes"), "SELF-TEST لا يفحص بوّابة الاعتماد");
  assert.ok(st.includes("crm_perm"), "SELF-TEST لا يمنع شراء الاعتماد بمفتاح");
  assert.ok(st.includes("provolatile"), "SELF-TEST لا يفحص أنّ المعاينة STABLE");
  assert.ok(st.includes("wrote_nothing"), "SELF-TEST لا يفحص تصريح المعاينة");
  // ولا يستدعي دالّة محميّة حيًّا (auth.uid() = NULL في محرّر SQL).
  assert.ok(
    !/v\s*:=\s*public\.crm_import_preview\(/.test(st),
    "SELF-TEST ينادي دالّة محميّة حيًّا — سيُسقط الترحيلة كلّها",
  );
  // النداء الحيّ يظهر كإسناد أو perform؛ ذكر التوقيع داخل to_regprocedure
  // /pg_get_functiondef فحصٌ ثابت لا نداء، وهو المطلوب هنا.
  assert.ok(
    !/(:=\s*|perform\s+)public\.crm_(approval_decide|approval_withdraw|target_upsert|commission_plan_upsert)\(/.test(st),
    "SELF-TEST ينادي دالّة كتابة محميّة حيًّا — سيُسقط الترحيلة كلّها",
  );
});

test("POSTCHECK يفحص العقدين بعد التشغيل", () => {
  assert.ok(POSTCHECK.includes("crm_can_approve_changes"), "POSTCHECK لا يفحص بوّابة الاعتماد");
  assert.ok(POSTCHECK.includes("buyable_with_key"), "POSTCHECK لا يفحص شراء الاعتماد بمفتاح");
  assert.ok(POSTCHECK.includes("crm_import_preview"), "POSTCHECK لا يفحص المعاينة");
  assert.ok(POSTCHECK.includes("crm_approval_requests"), "الجدول الجديد خارج POSTCHECK");
});

test("SAFE: static only (no DB/network)", () => {
  const self = read("tests/crm_owner_approval.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) {
    assert.ok(
      ["node:test", "node:assert", "node:assert/strict", "node:fs", "node:path", "./crm_helpers"].includes(r),
      `static (got ${r})`,
    );
  }
});
