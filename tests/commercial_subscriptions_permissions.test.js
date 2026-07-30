// ════════════════════════════════════════════════════════════════════════════
// tests/commercial_subscriptions_permissions.test.js
//
// نموذج الصلاحيات: لا anon · لا كتابة جدولية · مُسنَدات لا تعيد NULL ·
// لا بوّابة خشنة من منصّة المشاريع · العميل لا يرى بيانات داخلية ·
// المنصّة المجمَّدة لا تُمَسّ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  SQL, funcBody, funcDecl, PREDICATES, WRITE_FNS, READ_FNS, INTERNAL_FNS,
  CLIENT_FNS, TABLES, FROZEN_TABLES, FORBIDDEN_GATES,
} = require("./commercial_subscriptions_helpers.js");

test("لا شيء لـanon — لا دالّة ولا جدول", () => {
  assert.match(SQL, /revoke all on function %s from anon/i, "لا نزع صلاحية دوالّ عن anon");
  assert.match(SQL, /revoke all on table public\.%I from anon/i, "لا نزع صلاحية جداول عن anon");
  assert.ok(!/grant\s+(execute|select)[^\n]*to anon/i.test(SQL), "منح صريح لـanon");
  assert.match(SQL, /anon يملك EXECUTE/, "SELF-TEST لا يفحص غياب anon");
});

test("المُسنَدات كلّها boolean صريح ولا واحد منها يعيد NULL", () => {
  for (const p of PREDICATES) {
    const d = funcDecl(p);
    assert.match(d, /returns boolean/i, `${p} لا تعيد boolean`);
    assert.match(d, /\bstable\b/i, `${p} ليست STABLE`);
    const b = funcBody(p);
    assert.match(b, /coalesce\(/i, `${p} بلا coalesce — انهيار NULL ممكن`);
  }
  // fail-closed لا fail-open: المصيدة تُرجع false
  const perm = funcBody("csub_perm");
  assert.match(perm, /exception when others then\s*\n?\s*return false/i,
    "csub_perm تفشل مفتوحة عند خطأ محرّك الصلاحيات");
});

test("كلّ دالّة كتابة: بوّابة جلسة + منع صريح + تدقيق", () => {
  for (const f of WRITE_FNS) {
    const b = funcBody(f);
    assert.match(b, /auth\.uid\(\) is null then raise exception 'not authorized'/i,
      `${f} بلا بوّابة جلسة`);
    assert.match(b, /csub_can_(view|manage|consume|adjust|approve)/,
      `${f} بلا مُسنَد منع صريح`);
    // التدقيق إمّا هنا، أو في النواة المشتركة التي تفوّض إليها الدالّة. الأغلفة
    // الرقيقة (التفعيل/التجديد) لا تكرّر التدقيق عمدًا — النواة تكتبه مرّة واحدة.
    assert.match(b, /csub_log|csub_approval_submit_core|csub_activate_core|csub_renew_core/,
      `${f} تكتب بلا تدقيق ولا تفويض إلى نواة تُدقّق`);
  }
  // والنواتان المفوَّض إليهما تُدقّقان فعلًا — وإلّا صار التفويض ثغرة.
  for (const core of ["csub_activate_core", "csub_renew_core"]) {
    assert.match(funcBody(core), /csub_log/, `${core} لا تكتب تدقيقًا — التفويض إليها يُسقط الأثر`);
  }
});

test("كلّ دالّة قراءة تفرض بوّابة قبل أن تُعيد صفًّا", () => {
  for (const f of READ_FNS) {
    if (f === "csub_access") continue;                 // مِجَسّ الكشف: يُجيب بلا جلسة عمدًا
    const b = funcBody(f);
    assert.match(b, /auth\.uid\(\) is null then raise exception 'not authorized'/i,
      `${f} تُجيب بلا جلسة`);
  }
  // csub_access لا يمنح شيئًا: يصف القدرات فقط.
  const acc = funcBody("csub_access");
  assert.ok(!/insert|update|delete/i.test(acc), "مِجَسّ الكشف يكتب");
  assert.match(acc, /'can_approve'/, "مِجَسّ الكشف لا يصرّح ببوّابة المالك");
});

test("الدوالّ الداخلية غير ممنوحة لأحد", () => {
  const block = SQL.slice(SQL.indexOf("الدوالّ الداخلية: لا تُمنح لأحد"));
  for (const f of INTERNAL_FNS) {
    assert.ok(block.includes(`public.${f}(`), `${f} غير مذكورة في قائمة النزع`);
  }
  // ولا واحدة منها ممنوحة أعلاه
  const grantBlock = SQL.slice(SQL.indexOf("§15"), SQL.indexOf("الدوالّ الداخلية: لا تُمنح لأحد"));
  for (const f of ["csub_activate_core", "csub_renew_core", "csub_balance_core",
                   "csub_ledger_post", "csub_log"]) {
    assert.ok(!new RegExp(`'public\\.${f}\\(`).test(grantBlock),
      `${f} ممنوحة لـauthenticated — التفاف على سلسلة SECURITY DEFINER`);
  }
});

test("★ لا بوّابة خشنة من منصّة المشاريع في موديول تجاريّ", () => {
  // يُفحص **جسم كلّ دالّة**، لا نصّ الملفّ: النصّ يذكر الاسمين في تعليق تحذيريّ
  // وفي حارس الـSELF-TEST نفسه، وكلاهما يمنعهما ولا يستعملهما.
  for (const f of [...WRITE_FNS, ...READ_FNS, ...PREDICATES, ...INTERNAL_FNS]) {
    const b = funcBody(f);
    for (const g of FORBIDDEN_GATES) {
      assert.ok(!new RegExp(`\\b${g}\\b`).test(b),
        `${f} تستعمل ${g} كبوّابة — دائرة انفجار أوسع من الحاجة`);
    }
  }
  // والـSELF-TEST يحرس هذا بعد التطبيق أيضًا.
  assert.match(SQL, /can_manage_projects\|is_kian_member/,
    "SELF-TEST بلا حارس ضدّ تسلّل بوّابة خشنة لاحقًا");
});

test("★ التجميد: لا كتابة في منصّة المشاريع، وproject_id مرجع بلا مفتاح خارجيّ", () => {
  const code = SQL.replace(/^--.*$/gm, "");
  for (const t of FROZEN_TABLES) {
    const re = new RegExp(`(insert\\s+into|update|delete\\s+from)\\s+public\\.${t}\\b`, "i");
    assert.ok(!re.test(code), `الموديول يكتب في ${t} — خرق تجميد`);
  }
  // المرجع رخو بالتصميم
  assert.ok(!/project_id\s+uuid[^\n,]*references\s+public\.projects/i.test(SQL),
    "project_id مربوط بمفتاح خارجيّ إلى المنصّة المجمَّدة");
  assert.match(SQL, /comment on column public\.csub_subscriptions\.project_id is/i,
    "project_id بلا تعليق يوضّح أنّه مرجع قراءة فقط");
});

test("★ سطح العميل: لا حقل داخليّ، ولا سجلّ تدقيق، ومقيَّد بعميل الجلسة", () => {
  for (const f of CLIENT_FNS) {
    const b = funcBody(f);
    for (const leak of ["internal_notes", "internal_metadata", "csub_audit", "actor_id",
                        "csub_approval_requests", "suspend_reason", "cancel_reason"]) {
      assert.ok(!b.includes(leak), `${f} تعرض ${leak} للعميل`);
    }
    assert.ok(/my_client_id\(\)/.test(b) || /csub_client_owns/.test(b),
      `${f} لا تُقيّد النتيجة بعميل الجلسة`);
  }
  // ولا سياسة RLS تمنح العميل وصولًا جدوليًّا: كلّ سياسات القراءة موظّفية.
  const policies = [...SQL.matchAll(/create policy (csub_\w+) on public\.\w+ for select to authenticated\s*\n?\s*using \(([^;]*?)\);/gi)];
  for (const [, name, qual] of policies) {
    assert.ok(!/my_client_id|csub_is_client|csub_client_owns/.test(qual),
      `السياسة ${name} تمنح العميل وصولًا جدوليًّا — RLS تصفّي صفوفًا لا أعمدة، فالملاحظات الداخلية ستتسرّب`);
  }
});

test("العميل يرى تسعيرته هو (عقده) ولا يرى تكلفة ولا هامشًا", () => {
  const b = funcBody("csub_my_subscriptions");
  for (const ok of ["price_net", "vat_rate", "vat_amount", "price_gross"]) {
    assert.ok(b.includes(ok), `العميل لا يرى ${ok} من عقده هو`);
  }
  for (const bad of ["cost", "margin", "profit"]) {
    assert.ok(!new RegExp(bad, "i").test(b), `سطح العميل يحمل ${bad}`);
  }
  assert.match(b, /auto_renew_note/, "auto_renew يُعرض للعميل بلا توضيح أنّه لا يُجدّد ولا يخصم تلقائيًّا");
});

test("★ المال يُقنَّع بـNULL ولا يُصفَّر — الصفر الكاذب رقم يتصرّف به المستخدم", () => {
  for (const f of ["csub_plans_list", "csub_subscriptions_list", "csub_dashboard"]) {
    const b = funcBody(f);
    assert.match(b, /'pricing_visible'/, `${f} لا تصرّح بما إذا كان المال مرئيًّا`);
    assert.match(b, /then [\w.]*price_net\s+else null end|then\s*\n?\s*\(select coalesce\(sum\(price_net\)/,
      `${f} لا تُقنّع السعر بـNULL`);
    assert.ok(!/else 0 end/.test(b), `${f} تعرض صفرًا بدل «لا تملك صلاحية» — كذبة يتصرّف بها القارئ`);
  }
  // والتفصيل يُسقط الأعمدة بالاسم لا يستبدلها بصفر
  const det = funcBody("csub_subscription_detail");
  assert.match(det, /- 'price_net' - 'vat_rate' - 'vat_amount' - 'price_gross'/,
    "تفصيل الاشتراك لا يُسقط أعمدة المال عند غياب المفتاح");
  assert.match(det, /- 'internal_notes'/, "تفصيل الاشتراك يعرض الملاحظات الداخلية لغير المدير");
});

test("RLS مفعّلة على كلّ جدول، وسياسات القراءة فقط", () => {
  for (const t of TABLES) {
    assert.ok(SQL.includes(`'${t}'`), `الجدول ${t} غير مذكور في كتلة تفعيل RLS`);
  }
  assert.match(SQL, /alter table public\.%I enable row level security/i, "لا تفعيل RLS ديناميكيّ");
  const nonSelect = [...SQL.matchAll(/for (insert|update|delete)\b[^\n]*to authenticated/gi)];
  assert.deepEqual(nonSelect.map((m) => m[0]), [], "سياسة كتابة لـauthenticated");
});

test("مفاتيح الصلاحيات الستّة مبذورة بحسّاسية صحيحة", () => {
  const keys = [
    ["csub.view", "normal"], ["csub.manage", "sensitive"], ["csub.consume", "sensitive"],
    ["csub.adjust", "sensitive"], ["csub.view_pricing", "sensitive"], ["csub.export", "normal"],
  ];
  for (const [k, sens] of keys) {
    assert.match(SQL, new RegExp(`'${k.replace(".", "\\.")}',\\s*'${sens}'`),
      `المفتاح ${k} غير مبذور بحسّاسية ${sens}`);
  }
  assert.match(SQL, /on conflict \(key\) do update set/i, "بذر المفاتيح غير idempotent");
});
