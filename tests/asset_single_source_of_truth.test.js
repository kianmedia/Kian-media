// ════════════════════════════════════════════════════════════════════════════
// tests/asset_single_source_of_truth.test.js — الحكم الحاكم.
//
// يوجد نظام أصول كامل: custody_inventory_* (٥٧+ جدولًا، ~١٢٠ RPC، لوحة بأربعة
// عشر تبويبًا). إنشاء عائلة asset_* بجانبه يمنح الكاميرا الواحدة مصدرَي حقيقة —
// وهذا **أسوأ من ميزة ناقصة**، لأنّ أحدًا بعده لا يعرف أيّ رقم هو الصحيح.
//
// هذا الملفّ يمنع ذلك نصًّا: ما أُعيد استخدامه، وما أُنشئ، ولماذا — ولا شيء غيره.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, CODE, POSTCHECK, createdTables, createdFunctions,
  NEW_TABLES, REUSED_TABLES, UNTOUCHABLE_GATES, stripComments,
} = require("./asset_helpers.js");

test("★★ لا جدول باسم asset_* في الحزمة إطلاقًا", () => {
  const bad = createdTables().filter((t) => /^asset_/.test(t));
  assert.deepEqual(bad, [],
    `الحزمة تُنشئ ${bad.join(", ")} — هذا هو مصدر الحقيقة الثاني الذي مُنع صراحةً`);
});

test("★★ الجدولان الجديدان هما الوحيدان، وكلاهما بسابقة custody_inventory_", () => {
  const created = createdTables();
  assert.deepEqual(created.sort(), [...NEW_TABLES].sort(),
    `جداول جديدة غير متوقّعة: ${created.filter((t) => !NEW_TABLES.includes(t)).join(", ")}`);
  for (const t of created) {
    assert.match(t, /^custody_inventory_/, `${t} خارج عائلة custody_inventory_*`);
  }
});

test("★★ كلّ دالّة جديدة بسابقة civ_ أو custody_inv_", () => {
  const bad = createdFunctions().filter((f) => !/^(civ_|custody_inv_)/.test(f));
  assert.deepEqual(bad, [], `دوالّ خارج عائلة الأسماء: ${bad.join(", ")}`);
});

test("★★ الحزمة تُعيد استخدام جداول العهدة القائمة فعلًا لا اسمًا", () => {
  for (const t of REUSED_TABLES) {
    assert.ok(CODE.includes(`public.${t}`), `الحزمة لا تشير إلى ${t} — هل استنسختها؟`);
  }
  // ولا تُنشئ أيًّا منها من جديد.
  for (const t of REUSED_TABLES) {
    assert.ok(!createdTables().includes(t), `الحزمة تُنشئ ${t} من جديد بدل استخدامه`);
  }
});

test("★★★ البوّابات القائمة تُقرأ ولا تُعاد كتابتها أبدًا", () => {
  // إعادة تعريف civ_can_manage() بلا coalesce تُعيد فتح انهيار NULL عبر ~١٢٠
  // موضع نداء: «if not civ_can_manage()» تصير NULL، وnot NULL ليست true، فيُتخطّى
  // الرفض ويمضي الـRPC. النسخة المحصّنة تعيش في authz_fixC وحدها.
  const created = createdFunctions();
  for (const g of UNTOUCHABLE_GATES) {
    assert.ok(!created.includes(g),
      `الحزمة تُعيد تعريف ${g}() — هذا يعيد فتح fail-open في كلّ موضع نداء`);
  }
});

test("★★★ الحزمة تشير إلى البوّابات القائمة (تستهلكها بدل استبدالها)", () => {
  for (const g of ["civ_can_manage", "civ_set_avail", "civ_gen_no"]) {
    assert.ok(CODE.includes(`public.${g}`), `الحزمة لا تستهلك ${g} — هل بنت بديلًا؟`);
  }
});

test("★ لا مفردة قاعدة بيانات جديدة لوصف حالة قائمة", () => {
  // اختراع CHECK جديدة لحالة الأصل هو بالضبط كيف يولد مصدر الحقيقة الثاني:
  // الحالة العشرية تُشتقّ من الأعمدة القائمة ولا تُخزَّن.
  const code = stripComments(SQL);
  assert.doesNotMatch(code,
    /alter table public\.custody_inventory_assets[\s\S]{0,200}(drop|add)\s+constraint[\s\S]{0,120}availability_status/i,
    "الحزمة تعدّل مفردة availability_status القائمة");
  assert.doesNotMatch(code,
    /add column if not exists (asset_state|lifecycle_state|state)\b/i,
    "الحزمة تخزّن الحالة كعمود — سينحرف عن الواقع");
  assert.match(code, /create or replace function public\.civ_asset_state/,
    "لا دالّة اشتقاق للحالة");
});

test("★ مفردات الحالة الثلاث تُوفَّق بجسر لا بمفردة رابعة", () => {
  const code = stripComments(SQL);
  assert.match(code, /create or replace function public\.civ_grade_to_condition/,
    "لا جسر من درجات custody_condition_reports التسعة");
  assert.ok(!createdTables().some((t) => /grade|condition/.test(t)),
    "الحزمة تُنشئ جدول درجات ثالثًا");
});

test("★ الحجز يُحرَس على الجدول القائم — لا جدول حجز ثانٍ", () => {
  assert.ok(!createdTables().some((t) => /reserv|booking/.test(t)),
    "الحزمة تُنشئ تقويم حجز رابعًا");
  assert.match(CODE, /create trigger trg_civ_guard_reservation[\s\S]{0,200}custody_inventory_reservations/i,
    "الحارس ليس على الجدول القائم");
});

test("★ الصيانة: الخطّة تُغذّي جدول الأحداث القائم ولا تحلّ محلّه", () => {
  assert.ok(CODE.includes("public.custody_inventory_maintenance"),
    "خطط الصيانة لا تشير إلى جدول أحداث الصيانة القائم");
  assert.match(CODE, /custody_inv_admin_close_maintenance/,
    "الإغلاق يستبدل الدالّة القائمة بدل أن يستدعيها");
});

test("★ project_id مرجع قراءة اختياريّ فقط — منصّة المشاريع مجمَّدة", () => {
  const code = stripComments(SQL);
  for (const t of ["projects", "project_core", "deliverables", "deliverable_internal"]) {
    assert.doesNotMatch(code, new RegExp(`(insert into|update)\\s+public\\.${t}\\b`, "i"),
      `الحزمة تكتب في ${t} — خرق تجميد`);
    assert.doesNotMatch(code, new RegExp(`alter table public\\.${t}\\b`, "i"),
      `الحزمة تعدّل ${t} — خرق تجميد`);
  }
  assert.doesNotMatch(code, /create or replace function public\.(project|large_project)_/i,
    "الحزمة تُنشئ دالّة project_*");
  // لا مفتاح أجنبيّ على projects: مرجع اختياريّ لا ارتباط صلب.
  assert.doesNotMatch(code, /project_id\s+uuid[^,\n]*references\s+public\.projects/i,
    "project_id مرتبط بمفتاح أجنبيّ — يجب أن يبقى مرجع قراءة");
});

test("★ POSTCHECK يحرس الحكم الحاكم بنفسه بعد التطبيق", () => {
  // كان هذا يشترط فحص البادئة asset_. وقد أبلغت تلك الصيغة عن
  // asset_insurance_policies — بوليصة تأمين لا أصل، بلا عمود هويّة واحد،
  // مرتبطة بالأصول عبر جدول الوصل policy_assets بمفتاحين not null.
  // فالشرط الآن على **البنية**: عدّ أعمدة الهويّة، واشتراط رابط إلزاميّ.
  // هذا أقوى لا أضعف: يمسك مصدرًا موازيًا لا يبدأ اسمه بـasset_ إطلاقًا.
  assert.match(POSTCHECK, /attname in \('asset_code'/,
    "POSTCHECK لا يعدّ أعمدة هويّة الأصل — يحكم بالاسم لا بالبنية");
  assert.match(POSTCHECK, /a\.attnotnull/,
    "POSTCHECK لا يشترط رابطًا إلزاميًّا — مفتاح أجنبيّ قابل للـNULL يسمح بصفّ بلا أصل");
  assert.match(POSTCHECK, /custody_inventory_assets/, "POSTCHECK لا يذكر المالك الوحيد");
  assert.doesNotMatch(POSTCHECK, /relname\s*<>\s*'asset_insurance_policies'/,
    "POSTCHECK يستثني جدولًا باسمه بدل أن يحكم ببنيته");
  assert.match(POSTCHECK, /civ_can_manage/, "POSTCHECK لا يتحقّق من سلامة البوّابة القائمة");
});

test("★ الحزمة تُصرّح بما أعادت استخدامه وما أنشأته ولماذا", () => {
  // ملفّ يوسّع جداول عهدة حيّة بلا هذا التصريح يترك القارئ التالي يخمّن.
  const header = SQL.slice(0, 3000);
  assert.match(header, /ما أُعيد استخدامه/, "الرأس لا يذكر ما أُعيد استخدامه");
  assert.match(header, /ما أُنشئ جديدًا/, "الرأس لا يذكر ما أُنشئ ولماذا");
  for (const t of NEW_TABLES) {
    assert.ok(header.includes(t), `الرأس لا يبرّر إنشاء ${t}`);
  }
});
