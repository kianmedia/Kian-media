// ════════════════════════════════════════════════════════════════════════════
// tests/project_transition_requests_ui.test.js
//
// الثغرة التي تحرسها هذه الاختبارات: مَن staff_role = 'editor' (مونتير) مُسنَد
// بدور مشروع kian_editor كان يُعامَل في الواجهة معاملة المدير (canManage =
// isAdminArea || isEditor)، فيبلغ تبويب الاستيراد الجماعيّ وشريط مراحل المشروع،
// ويحصل على أزرار نقل المخرجات وتغيير حالتها وإظهارها للعميل.
//
// الحدّ الأمنيّ الحقيقيّ هو الخادم (SECURITY DEFINER + RLS). ما تحرسه هذه
// الاختبارات هو الشقّ الثاني من الإصلاح: أن يكون **المسار الأمين ظاهرًا
// والمسار الممنوع غائبًا** — لا زرّ ممنوع «مخفيًّا» ولا صلاحية تُدّعى في المتصفّح.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const OPS = read("components/portal/projectcore/ProjectOps.tsx");
const LIB = read("lib/portal/transitions.ts");
const ATOMS = read("components/portal/TransitionAtoms.tsx");
const MODAL = read("components/portal/TransitionRequestModal.tsx");
const BTN = read("components/portal/TransitionRequestButton.tsx");
const PANEL = read("components/portal/TransitionApprovalsPanel.tsx");
const MATRIX = read("components/portal/DeliverableMatrix.tsx");
const BULK = read("components/portal/LargeProjectBulkBar.tsx");

// ─── (أ) بوّابتان لا واحدة: المونتير ليس مديرًا ──────────────────────────────

test("ProjectOps: canAdminister = isAdminArea بالضبط، وcanManage يبقى التشغيليّ", () => {
  assert.match(OPS, /const canAdminister = caps\.isAdminArea;/, "البوّابة الإدارية غير معرَّفة");
  assert.match(OPS, /const canManage = canAdminister \|\| caps\.isEditor;/, "البوّابة التشغيلية تغيّرت");
  // سلوك المالك/المدير لم يتغيّر: canAdminister هو isAdminArea نفسه، بلا شرط إضافيّ.
  assert.doesNotMatch(OPS, /const canAdminister = caps\.isAdminArea && /, "أُضيف شرط يضيّق صلاحية المالك/المدير");
  assert.doesNotMatch(OPS, /const canManage = caps\.isAdminArea \|\| caps\.isEditor;/, "التعريف القديم ما زال قائمًا");
});

test("الأسطح الإدارية على canAdminister: استيراد/مراحل/إجراءات/تجاوز التقدّم/شكل المشروع", () => {
  assert.match(OPS, /\(tb\.k !== "import" \|\| canAdminister\)/, "تبويب الاستيراد ما زال يشمل المونتير");
  assert.match(OPS, /tab === "import" && canAdminister && <ProjectImportPanel/, "جسم الاستيراد بلا بوّابة إدارية");
  assert.match(OPS, /disabled=\{busy \|\| !canAdminister \|\| barLocked\}/, "شريط المراحل ما زال يشمل المونتير");
  assert.match(OPS, /canManage=\{canAdminister\}\n?\s*isOwner=\{caps\.isOwner\}/, "قائمة الإجراءات الإدارية بلا بوّابة إدارية");
  assert.match(OPS, /<QuickProjectPanel projectId=\{projectId\} canManage=\{canAdminister\}/, "لوحة «نظرة سريعة» بلا بوّابة إدارية");
  assert.match(OPS, /isMaster && canAdminister && <button onClick=\{\(\) => setAddSub\(true\)\}/, "إضافة فرع بلا بوّابة إدارية");
  assert.match(OPS, /isMaster && canAdminister && <button onClick=\{\(\) => void demoteToStandalone\(\)\}/, "الخفض بلا بوّابة إدارية");
});

test("عمل المونتير المشروع لم يُكسر: الأسطح التشغيلية تبقى على canManage", () => {
  for (const frag of [
    'tab === "tasks" && <ProjectTasks projectId={projectId} canManage={canManage}',
    'tab === "shoots" && <ShootsTab projectId={projectId} canManage={canManage}',
    'tab === "deliverables" && <DeliverablesTab projectId={projectId} canManage={canManage}',
    'tab === "team" && <TeamTab projectId={projectId} canManage={canManage}',
  ]) assert.ok(OPS.includes(frag), `سطح تشغيليّ فقد صلاحية المونتير: ${frag}`);
  // «المحذوفات» يبقى تشغيليًّا عمدًا: استرجاع ما حُذف ليس قرارًا إداريًّا.
  assert.match(OPS, /\(tb\.k !== "trash" \|\| canManage\)/, "بوّابة المحذوفات تغيّرت بلا سبب");
});

// ─── (ب) مسنَدات العرض: منطقيّ صريح دائمًا، ولا NULL أبدًا ────────────────────

test("مسنَدات transitions.ts تعيد boolean حرفيًّا في كلّ مسار (لا NULL/undefined)", () => {
  for (const fn of ["trCanRequest", "trCanDecide"]) {
    const body = new RegExp(`export function ${fn}\\([\\s\\S]*?\\n\\}`).exec(LIB);
    assert.ok(body, `${fn} غير موجودة`);
    assert.doesNotMatch(body[0], /return (null|undefined)/, `${fn} قد تعيد NULL — هذا سبب fail-open سابق`);
    assert.match(body[0], /if \(!role\) return false;/, `${fn} لا تفشل مغلقة عند غياب الأدوار`);
  }
  assert.match(LIB, /export function trMustRequest[\s\S]*?trCanRequest\(role\) === true && trCanDecide\(role\) === false/,
    "trMustRequest لا يُشتقّ من المسنَدين صراحةً");
});

test("زرّ القرار لا يُرسَم للمونتير ولا للعميل — استثناء صريح لا ضمنيّ", () => {
  const body = /export function trCanDecide\([\s\S]*?\n\}/.exec(LIB)[0];
  assert.match(body, /if \(role\.isClientSide === true\) return false;/, "العميل غير مستثنى صراحةً");
  assert.match(body, /if \(role\.isEditor === true\) return false;/, "المونتير غير مستثنى صراحةً");
  assert.match(body, /return role\.isAdminArea === true;/, "القرار ليس محصورًا بالمالك/المدير");
  // وفي الشاشة: زرّ الاعتماد داخل شرط trCanDecide لا مجرّد disabled.
  assert.match(PANEL, /const canDecide = trCanDecide\(role\);/, "الشاشة لا تشتقّ صلاحية القرار");
  assert.match(PANEL, /\{isPending && canDecide && \(/, "زرّ الاعتماد يُرسَم لغير المخوَّل ولو معطَّلًا");
});

// ─── (ج) نافذة الطلب: سبب إلزاميّ، قبل/بعد، تحذير، لا تكرار ─────────────────

test("النافذة: لا إرسال بلا سبب، ولا بلا قيمة مطلوبة، ولا بلا هدف", () => {
  assert.match(MODAL, /const canSubmit = !busy && !unavailable && to !== "" && reason\.trim\(\) !== "" && split\.ready\.length > 0 && !overCap;/,
    "شرط الإرسال لا يفرض السبب/القيمة/الهدف");
  assert.match(MODAL, /disabled=\{!canSubmit\}/, "زرّ الإرسال بلا ربط بالشرط");
  assert.match(MODAL, /السبب \(إلزاميّ/, "حقل السبب غير موسوم بالإلزام");
});

test("النافذة: تحذير صريح بأن شيئًا لم يتغيّر، ومقارنة «الحالي ← المطلوب»", () => {
  assert.match(MODAL, /هذا <strong>طلب<\/strong> لا تنفيذ/, "لا تحذير صريح بأنّه طلب");
  assert.match(MODAL, /حتى يوافق صاحب الصلاحية/, "التحذير لا يذكر شرط الاعتماد");
  assert.match(MODAL, /<TrBeforeAfter key=\{tg\.key\} label=\{tg\.label\}/, "لا مقارنة قبل/بعد لكلّ هدف");
  assert.match(MODAL, /بانتظار الموافقة/, "لا حالة «بانتظار الموافقة» بعد الإرسال");
});

test("النافذة: طلب معلَّق مطابق لا يُرسَل ثانيةً (حارس واجهة + إقرار الخادم)", () => {
  // «مطابق» = النوع + المخرج + **القيمة المطلوبة**، أي مفتاح الفهرس الفريد نفسه.
  // حارس أوسع من القاعدة كان سيحجب طلبًا مشروعًا بقيمة أخرى.
  assert.match(MODAL, /if \(to !== "" && pending && pending\(active\.kind, tg\.deliverableId, to\) === true\) \{ blocked\.push\(tg\); continue; \}/,
    "الأهداف المعلَّقة لا تُستبعَد من الإرسال بمفتاح القاعدة نفسه");
  assert.match(MODAL, /x\.outcome\?\.duplicate\s*\n?\s*\?\s*"طلب معلَّق مطابق موجود/, "ردّ duplicate من الخادم لا يُعرض");
  assert.match(LIB, /duplicate: bool\(o\.duplicate\)/, "duplicate لا يُقرأ من ردّ الخادم");
  // 200 وحدها ليست نجاحًا: غياب ok من الردّ لا يُقرأ تسجيلًا.
  assert.match(LIB, /ok: bool\(o\.ok\)/, "نجاح الطلب يُفترض من HTTP وحده");
});

test("الطلب الجماعيّ: حدّ أعلى معلَن، ونتيجة لكلّ عنصر بلا ابتلاع فشل", () => {
  assert.match(LIB, /export const TR_MAX_BATCH = \d+;/, "لا حدّ للطلب الجماعيّ");
  assert.match(LIB, /if \(inputs\.length > TR_MAX_BATCH\) return \{ ok: false, error: "too_many_targets", status: 400 \};/,
    "الحدّ غير مفروض في الوصول");
  assert.match(MODAL, /الحدّ الأقصى <span dir="ltr">\{TR_MAX_BATCH\}<\/span>/, "الحدّ لا يُقال للمستخدم");
  assert.match(MODAL, /\{results\.map\(\(x\) => \(/, "نتيجة كلّ عنصر غير معروضة");
});

// ─── (د) صندوق القرار ───────────────────────────────────────────────────────

test("«طلبات الانتقال»: كل ما يحتاجه القرار معروض + مقارنة قبل الاعتماد", () => {
  for (const label of ["مُقدِّم الطلب", "المشروع", "المخرج", "السبب"]) {
    assert.ok(PANEL.includes(`label="${label}"`), `حقل «${label}» غير معروض في بطاقة الطلب`);
  }
  assert.match(PANEL, /<TrBeforeAfter label="الحالي ← المطلوب"/, "لا مقارنة قبل/بعد في القائمة");
  assert.match(PANEL, /trWhen\(r\.requested_at\)/, "وقت الطلب غير معروض");
  // تأكيد ثانٍ يعرض الأثر قبل التنفيذ.
  assert.match(PANEL, /بالاعتماد يُنفَّذ التغيير فورًا/, "الاعتماد بلا تأكيد يشرح الأثر");
  assert.match(PANEL, /تأكيد الاعتماد والتنفيذ/, "لا خطوة تأكيد صريحة");
  assert.match(PANEL, /سبب الرفض \(إلزاميّ/, "الرفض بلا سبب إلزاميّ");
  assert.match(PANEL, /decision === "reject" && note\.trim\(\) === ""/, "الرفض يمرّ بلا سبب");
});

test("«طلبات الانتقال»: لا ادّعاء تنفيذ بلا إقرار الخادم", () => {
  assert.match(PANEL, /if \(res\.data\.ok !== true\)/, "نجاح القرار يُفترض من HTTP وحده");
  assert.match(PANEL, /لكنّ الخادم لم يؤكّد تنفيذ التغيير/, "التنفيذ غير المؤكَّد يُعرض كنجاح");
  assert.match(PANEL, /res\.data\.applied === true/, "لا تمييز بين «اعتُمد» و«نُفِّذ»");
});

// ─── (هـ) الإشعارات: داخل البوّابة فقط، والعميل لا يُبلَّغ ─────────────────────

test("لا اعتماد على البريد في مسار الطلبات، ولا إشعار للعميل", () => {
  for (const [name, src] of [["transitions.ts", LIB], ["modal", MODAL], ["panel", PANEL], ["button", BTN], ["atoms", ATOMS]]) {
    assert.doesNotMatch(src, /notifyEmail|sendProjectEmail|emitProjectDeliverableEvent|emitEventEmail/,
      `${name} يعتمد على البريد — وهو غير مكتمل التشغيل`);
  }
  assert.match(PANEL, /لا يُبلَّغ العميل/, "الشاشة لا تُعلن أنّ العميل لا يُبلَّغ");
  assert.match(MODAL, /لا يُبلَّغ العميل بشيء/, "النافذة لا تُعلن أنّ العميل لا يُبلَّغ");
  assert.match(LIB, /\*\*لا إشعار للعميل إطلاقًا\.\*\*/, "العقد لا ينصّ على استثناء العميل");
});

// ─── (و) الكشف عن القدرات: تعطيل صريح لا انهيار، وبلا خلط الأسباب ───────────

test("الشيفرة تُنشر قبل الـSQL: تعطيل عربيّ صريح، ورفض الصلاحية ليس ترحيلة ناقصة", () => {
  assert.match(LIB, /import \{ pgClassify, pgLog, pgUserMessageAr, pgIsMigrationPending/, "التصنيف غير مُفوَّض إلى pgerror");
  assert.match(LIB, /function absent\(d: PgDiagnosis\): boolean \{ return pgIsMigrationPending\(d\) === true; \}/,
    "الغياب لا يُقاس بمُصنِّف واحد");
  const note = /export function trUnavailableAr\([\s\S]*?\n\}/.exec(LIB)[0];
  assert.match(note, /case "permission":[\s\S]{0,200}رفض صلاحية/, "رفض الصلاحية يُعرض كترحيلة ناقصة");
  assert.match(note, /case "migration":[\s\S]{0,200}لم تُطبَّق/, "الترحيلة الناقصة لا تُسمّى باسمها");
  // 42501 لا يُحسب غيابًا للكائن (وإلّا صار الرفض «ترحيلة معلّقة»).
  assert.match(LIB, /return \{ present: !absent\(d\), note: noteOf\(d\) \}/, "المسبار يخلط الرفض بالغياب");
  // الشاشات تستعمل حالة التعطيل بدل الانهيار.
  assert.match(PANEL, /<TrUnavailable message=\{unavailable\} onRecheck=\{recheck\}/, "الشاشة تنهار بدل التعطيل");
  assert.match(MODAL, /<TrUnavailable message=\{unavailable\}/, "النافذة تنهار بدل التعطيل");
  assert.match(BTN, /const disabled = targets\.length === 0 \|\| \(caps !== null && unavailable !== null\)/,
    "الزرّ لا يُعطَّل عند غياب الحزمة");
});

// ─── (ز) المصفوفة والشريط الجماعيّ: القرارات الثلاثة تغيب عن الطالب ──────────

test("الشريط الجماعيّ: القرارات الثلاثة تُحذف في وضع الطلب + رفض دفاعيّ", () => {
  assert.match(BULK, /const TRANSITION_KINDS: LpBulkKind\[\] = \["set_status", "set_client_visibility", "move_to_stage"\];/,
    "القرارات الثلاثة غير معرَّفة");
  assert.match(BULK, /const kinds = requestOnly === true \? KINDS\.filter\(\(k\) => !TRANSITION_KINDS\.includes\(k\)\) : KINDS;/,
    "القائمة لا تُصفّى في وضع الطلب");
  assert.match(BULK, /\{kinds\.map\(\(k\) => <option/, "القائمة المعروضة ما زالت الكاملة");
  assert.match(BULK, /if \(requestOnly === true && TRANSITION_KINDS\.includes\(kind\)\) \{/, "لا رفض دفاعيّ عند التنفيذ");
});

test("المصفوفة: زرّ «طلب انتقال» للطالب، وشارة الانتظار، وخصائص الصفّ تبقى بدائية", () => {
  assert.match(MATRIX, /const mustRequest = trMustRequest\(tr\.role\);/, "المصفوفة لا تشتقّ وضع الطلب");
  assert.match(MATRIX, /requestOnly=\{mustRequest\}/, "الشريط الجماعيّ بلا وضع الطلب");
  assert.match(MATRIX, /reqState=\{!mustRequest \? "off" : tr\.caps === null \? "checking" : tr\.caps\.request \? "ready" : "unavailable"\}/,
    "حالة الطلب على الصفّ غير مشتقّة من القدرات");
  assert.match(MATRIX, /reqPending=\{pendingIds\.has\(d\.id\)\}/, "شارة الانتظار غير مربوطة بمجموعة جاهزة");
  assert.match(MATRIX, /onRequest=\{openRequest\}/, "دالّة الفتح غير ثابتة الهوية");
  assert.match(MATRIX, /const openRequest = useCallback\(\(id: string\) => setReqTargets\(\[id\]\), \[\]\);/, "openRequest تتغيّر هويتها كلّ رسم");
  // كلّ الأنواع الثلاثة متاحة للطلب من المصفوفة (ولا اختراع مفردات خارج المطبَّق).
  for (const k of ['kind: "stage"', 'kind: "status"', 'kind: "client_visibility"']) {
    assert.ok(MATRIX.includes(k), `نوع الطلب ${k} غير معروض`);
  }
  assert.match(MATRIX, /if \(caps\.columns\.client_visible\) \{/, "طلب الإظهار يُعرض قبل وجود العمود");
});

// ─── (ح) شريط المراحل: بديل ظاهر لا زرّ معطَّل ─────────────────────────────

test("مرحلة المشروع: من لا يملك القرار يرى «طلب انتقال» بنوعه الصحيح", () => {
  assert.match(OPS, /const mustRequestStage = trMustRequest\(caps\);/, "وضع الطلب غير مشتقّ في الشاشة");
  assert.match(OPS, /\{mustRequestStage && !barLocked && core && \(/, "زرّ الطلب يظهر في حالة موقوفة أو بلا حالة معروفة");
  assert.match(OPS, /kind: "project_stage"/, "نوع الطلب ليس مرحلة المشروع");
  assert.match(OPS, /options: PC_STAGES\.filter\(\(s\) => s !== core\.core_stage\)/, "المرحلة الحالية معروضة كهدف");
  assert.match(OPS, /pending=\{trReq\.pending\}/, "زرّ المرحلة بلا حارس تكرار");
});

test("تبويب «طلبات الانتقال»: يظهر للطالب والمقرِّر فقط، ولا يُرسَم بلا بوّابة", () => {
  assert.match(OPS, /const seesTransitions = trCanRequest\(caps\) \|\| trCanDecide\(caps\);/, "بوّابة التبويب غير مشتقّة");
  assert.match(OPS, /\(tb\.k !== "transitions" \|\| seesTransitions\)/, "التبويب بلا تصفية");
  assert.match(OPS, /tab === "transitions" && seesTransitions && <TransitionApprovalsPanel/, "جسم التبويب بلا بوّابة");
});

// ─── (ط) RTL والجوال ────────────────────────────────────────────────────────

test("عربيّ RTL ويعمل على الجوال", () => {
  assert.match(MODAL, /<div dir="rtl"/, "النافذة بلا اتجاه");
  assert.match(PANEL, /<div dir="rtl"/, "الشاشة بلا اتجاه");
  assert.match(ATOMS, /flex items-end sm:items-center/, "النافذة لا تلتصق بأسفل الشاشة على الجوال");
  assert.match(ATOMS, /w-full sm:max-w-lg max-h-\[92vh\] overflow-y-auto/, "النافذة تفيض على الشاشات الصغيرة");
  assert.match(ATOMS, /flex items-center gap-2 flex-wrap text-\[11px\]/, "بند «قبل ← بعد» يُقصّ بدل أن يلتفّ");
});

test("لا خطّاف يُطلق طلبات لمن لا شأن له بالمسار (عميل/مشاهدة فقط)", () => {
  assert.match(ATOMS, /const active = enabled === true && \(trCanRequest\(role\) === true \|\| trCanDecide\(role\) === true\);/,
    "الخطّاف يقرأ الطلبات لكلّ زائر");
  assert.match(ATOMS, /if \(!active \|\| idsKey === ""\) \{ setCaps\(null\); setRows\(\[\]\); return; \}/, "لا خروج مبكر قبل الجلب");
  // قراءة مشاريع الصفوف لا الرئيسيّ وحده: طلب المخرَج يُسجَّل على مشروع المخرَج.
  assert.match(MATRIX, /const tr = useTransitionRequests\(trProjectIds, true\);/, "المصفوفة تقرأ مشروعًا واحدًا فقط");
  assert.match(ATOMS, /const TR_MAX_PROJECTS = \d+;/, "لا سقف لعدد المشاريع المقروءة");
  // خارج PortalShell: فشل مغلق لا مفتوح.
  assert.match(ATOMS, /try \{ return usePortal\(\)\.caps; \} catch \{ return null; \}/, "غياب الغلاف لا يفشل مغلقًا");
});

// ─── (ي) عقد الواجهة ↔ حزمة SQL (حين تكون الحزمة حاضرة في المستودع) ─────────

test("أسماء الدوالّ ومفردات الأنواع في الواجهة تطابق حزمة الـSQL حرفيًّا", () => {
  const p = path.join(ROOT, "docs/project_transition_approval_RUNME.sql");
  if (!fs.existsSync(p)) return;   // الحزمة تُكتب في مسار منفصل؛ غيابها ليس فشلًا هنا
  const SQL = fs.readFileSync(p, "utf8");
  for (const fn of ["project_transition_request_create", "project_transition_requests_list",
                    "project_transition_request_decide", "project_transition_can_decide"]) {
    assert.ok(SQL.includes(`function public.${fn}(`), `الدالّة ${fn} غير موجودة في الحزمة`);
    assert.ok(LIB.includes(`"${fn}"`), `الواجهة لا تستدعي ${fn}`);
  }
  // مفردات الأنواع: لا اختراع لقيَم خارج ما يقبله القيد.
  const kindCheck = /kind\s+text not null check \(kind in \(([^)]*)\)\)/.exec(SQL);
  assert.ok(kindCheck, "قيد الأنواع غير موجود في الحزمة");
  const kinds = [...kindCheck[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual(kinds, ["client_visibility", "project_stage", "stage", "status"], "مفردات الأنواع تغيّرت");
  assert.match(LIB, /export const TR_KINDS: TrKind\[\] = \["project_stage", "stage", "status", "client_visibility"\];/,
    "مفردات الواجهة لا تطابق القيد");
  // حالة 'expired' موجودة في القاعدة ⇒ لها وسم عربيّ (وإلّا ظهر المفتاح خامًا).
  if (/'expired'/.test(SQL)) assert.match(LIB, /expired:\s*\{ ar: "[^"]+"/, "الحالة expired بلا وسم عربيّ");
  // الفهرس الفريد يشمل to_value ⇒ حارس الواجهة يشمله أيضًا.
  assert.match(SQL, /unique index if not exists uq_ptr_pending_target[\s\S]{0,300}coalesce\(to_value, ''\)/,
    "مفتاح منع التكرار في القاعدة تغيّر — راجع حارس الواجهة");
  assert.match(ATOMS, /if \(toValue !== undefined && \(r\.to_value \?\? null\) !== \(toValue \?\? null\)\) continue;/,
    "حارس الواجهة لا يطابق مفتاح القاعدة");
});
