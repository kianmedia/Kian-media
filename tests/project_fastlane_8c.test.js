// ════════════════════════════════════════════════════════════════════════════
// tests/project_fastlane_8c.test.js — حراس Batch 8C (المسار السريع للمشاريع الصغيرة).
// كل حارس هنا يمنع انحرافًا محدّدًا: نظام حالة موازٍ، Checklist مخزَّنة، أعمدة
// Boolean، مصدر نسخ ناقص، زرّ بلا RPC، أو إخفاء قدرة خلف «التبسيط».
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const SQL = read("docs/project_fastlane_batch8c_RUNME.sql");
const SQL7A = read("docs/project_templates_batch7a_RUNME.sql");
const TS = read("lib/portal/fastlane.ts");
const WIZ = read("components/portal/projectcore/FastCreateWizard.tsx");
const PANEL = read("components/portal/projectcore/QuickProjectPanel.tsx");
const OPS = read("components/portal/projectcore/ProjectOps.tsx");
const DASH = read("components/portal/projectcore/ProjectCoreDashboard.tsx");

const codeOf = (s) => s.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");
// أسطر الشيفرة وحدها — تعليق يذكر اسم عمود لا يعني أنّ الشيفرة تمسّه (درس متكرّر).
const tsCode = (s) => s.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
function funcBody(name, src = SQL) {
  const m = src.match(new RegExp("create\\s+or\\s+replace\\s+function\\s+public\\." + name + "\\s*\\([^)]*\\)[\\s\\S]*?\\bas\\s*\\$\\$([\\s\\S]*?)\\$\\$\\s*;", "i"));
  assert.ok(m, `تعذّر إيجاد ${name}`);
  return m[1];
}

// ─────────────────────────── SQL: بنية الملف ───────────────────────────
test("SQL 8C بنيوي: Preflight، Transaction واحدة، self-test، notify، بلا Temp/DROP", () => {
  assert.match(SQL, /do \$pre\$[\s\S]*8C PREFLIGHT/i, "لا Preflight");
  assert.match(SQL, /\bbegin;[\s\S]*\bcommit;/i, "ليس داخل Transaction");
  assert.equal((SQL.match(/^begin;\s*$/gim) || []).length, 1, "أكثر من begin;");
  assert.equal((SQL.match(/^commit;\s*$/gim) || []).length, 1, "أكثر من commit;");
  assert.match(SQL, /do \$selftest\$[\s\S]*raise exception '8C FAIL/i, "لا self-test");
  assert.match(SQL, /notify pgrst/i, "لا notify pgrst");
  assert.doesNotMatch(SQL, /create\s+temp(orary)?\s+table/i, "جداول مؤقتة");
  assert.doesNotMatch(SQL, /^\s*(drop function|drop table)/im, "DROP function/table");
  // ملف غير فارغ ولا شكليّ
  assert.ok(SQL.length > 4000, "ملف SQL شكليّ");
});

test("Preflight يشترط المسار الرسميّ ويتحقّق من 7A فعلًا لا من جدول أقدم منه", () => {
  const pre = SQL.match(/do \$pre\$([\s\S]*?)\$pre\$;/)[1];
  for (const dep of ["pc_can_read_project", "project_core_create_project", "project_templates", "project_scope"]) {
    assert.ok(pre.includes(dep), `Preflight لا يتحقّق من ${dep}`);
  }
  // public.project_templates أنشأه Project Core V1 لا 7A ⇒ وجوده لا يثبت 7A
  assert.match(SQL7A, /add column if not exists template_key/, "افتراض ملكية 7A للأعمدة لم يعد صحيحًا");
  assert.match(pre, /column_name in \('template_key','is_seed','category'\)/, "Preflight لا يكشف غياب 7A");
  assert.match(pre, /pg_indexes[\s\S]{0,200}template_key/, "Preflight لا يتحقّق من الفهرس الفريد الذي يعتمده ON CONFLICT");
});

test("لا متغيّر plpgsql غير مُعرّف في دوال 8C", () => {
  const re = /create or replace function public\.([a-z_]+)\s*\([^)]*\)[\s\S]*?\blanguage plpgsql[\s\S]*?\bas\s*\$\$([\s\S]*?)\$\$\s*;/gi;
  let m, checked = 0;
  while ((m = re.exec(SQL))) {
    const name = m[1];
    const body = codeOf(m[2]);
    // كل أقسام declare (بما فيها الكتل المتداخلة) + معاملات الدالة
    const decls = new Set();
    for (const dm of body.matchAll(/\bdeclare\b([\s\S]*?)\bbegin\b/gi)) {
      for (const v of dm[1].matchAll(/(^|;)\s*([a-z_][a-z0-9_]*)\s+[a-z]/gi)) decls.add(v[2].toLowerCase());
    }
    for (const p of (m[0].match(/\(([^)]*)\)/) || ["", ""])[1].matchAll(/\b(p_[a-z0-9_]+)\b/gi)) decls.add(p[1].toLowerCase());
    for (const u of body.matchAll(/\b(v_[a-z0-9_]+)\b/gi)) {
      assert.ok(decls.has(u[1].toLowerCase()), `${name}: متغيّر غير مُعرّف ${u[1]}`);
    }
    checked++;
  }
  assert.ok(checked >= 4, `عدد الدوال المفحوصة ${checked}`);
});

test("كل دالة 8C: SECURITY DEFINER + search_path + revoke public/anon + grant authenticated", () => {
  const names = ["project_operating_experience", "project_set_operating_experience", "project_quick_snapshot"];
  for (const n of names) {
    const decl = SQL.match(new RegExp("create or replace function public\\." + n + "\\s*\\([^)]*\\)[\\s\\S]{0,200}?as \\$\\$"));
    assert.ok(decl, `${n} مفقودة`);
    assert.match(decl[0], /security definer/i, `${n} بلا SECURITY DEFINER`);
    assert.match(decl[0], /set search_path = public/i, `${n} بلا search_path`);
    assert.match(SQL, new RegExp("revoke execute on function public\\." + n + "[^;]*from public, anon"), `${n} بلا revoke`);
    assert.match(SQL, new RegExp("grant execute on function public\\." + n + "[^;]*to authenticated"), `${n} بلا grant`);
  }
  // دالة المُشغِّل داخلية بحتة — لا تُمنح لأحد (نفس عرف 8A)
  assert.match(SQL, /revoke execute on function public\.fastlane_scope_cleanup\(\) from public, anon, authenticated/,
    "دالة المُشغِّل ممنوحة لمستخدم — توسيع سطح هجوم بلا مقابل");
  assert.doesNotMatch(SQL, /grant execute on function public\.fastlane_scope_cleanup/, "منح تنفيذ لدالة مُشغِّل");
});

test("كل دالة SECURITY DEFINER تبدأ ببوّابة قراءة حقيقية (لا تسريب أسماء مشاريع)", () => {
  for (const n of ["project_operating_experience", "project_set_operating_experience", "project_quick_snapshot"]) {
    const body = codeOf(funcBody(n));
    const gate = body.indexOf("pc_can_read_project");
    assert.ok(gate > -1, `${n} بلا بوّابة قراءة`);
    // البوّابة قبل أيّ قراءة من projects
    const firstRead = body.search(/from public\.(projects|project_core)\b/i);
    assert.ok(firstRead === -1 || gate < firstRead, `${n}: القراءة تسبق البوّابة`);
  }
});

// ───────────────────── لا نظام موازٍ ولا حالة مخزَّنة ─────────────────────
test("لا أعمدة Boolean لحالة مصدرها الرسميّ موجود", () => {
  for (const col of ["shoot_done", "client_approved", "files_uploaded", "preview_sent", "delivered", "final_master"]) {
    assert.doesNotMatch(SQL, new RegExp("add column if not exists\\s+" + col + "\\b", "i"), `عمود Boolean موازٍ: ${col}`);
  }
  // العمود الوحيد المضاف هو تفضيل العرض
  const cols = [...SQL.matchAll(/alter table public\.\w+\s+add column if not exists\s+(\w+)/gi)].map((x) => x[1]);
  assert.deepEqual(cols, ["operating_experience"], `أعمدة غير متوقّعة: ${cols.join(",")}`);
  // والحارس نفسه داخل self-test
  assert.match(SQL, /column_name in \('shoot_done','client_approved','files_uploaded','delivered','preview_sent'\)/,
    "self-test لا يحرس أعمدة الحالة الموازية");
});

test("لا صلاحية ميتة: 8C لا يضيف مفتاحًا بلا نقطة إنفاذ", () => {
  const perms = [...SQL.matchAll(/insert into public\.permissions[\s\S]{0,400}?\('([a-z_.]+)'/g)].map((m) => m[1]);
  assert.deepEqual(perms, [], `صلاحية بلا إنفاذ (درس 7A): ${perms.join(",")}`);
  // والمسار يفرض الصلاحية القائمة لا صلاحية جديدة
  assert.match(codeOf(funcBody("project_set_operating_experience")), /can_manage_projects\(\)|can_edit_project\(/,
    "تبديل التجربة بلا بوّابة إدارة");
});

test("لا جداول جديدة ولا نظام مهام/إغلاق/Checklist موازٍ", () => {
  assert.doesNotMatch(codeOf(SQL), /create table/i, "8C ينشئ جدولًا — الحالة كلّها مشتقّة");
  for (const bad of ["quick_tasks", "quick_checklist", "fastlane_tasks", "project_quick_state", "quick_closure"]) {
    assert.ok(!SQL.includes(bad), `نظام موازٍ: ${bad}`);
  }
});

test("قائمة الإنجاز والإجراء التالي مشتقّان — لا تخزين ولا كتابة من اللقطة", () => {
  const body = codeOf(funcBody("project_quick_snapshot"));
  assert.doesNotMatch(body, /insert into|update\s+public\.|delete from/i, "اللقطة تكتب بيانات");
  assert.match(SQL, /create or replace function public\.project_quick_snapshot\(p_project uuid\)\s*\nreturns jsonb language plpgsql stable/i,
    "اللقطة ليست STABLE ⇒ يمكن أن تكتب");
  assert.match(body, /v_checks := jsonb_build_array\(/, "القائمة ليست مبنيّة داخل الدالة");
  assert.match(body, /v_next := case/, "الإجراء التالي غير مشتقّ");
  // كل بند يعلن مصدره
  const items = [...body.matchAll(/'code','([a-z_]+)'[\s\S]{0,500}?'source','([^']+)'/g)];
  assert.ok(items.length >= 10, `عدد بنود القائمة ${items.length} < 10`);
  for (const [, code, source] of items) assert.ok(source.length > 3, `البند ${code} بلا مصدر معلن`);
});

test("اللقطة لا تكتب progress ولا تغيّر core_stage ولا تلمس المالية/Zoho/العهدة", () => {
  const all = codeOf(SQL);
  for (const bad of [/progress_manual\s*=/, /core_stage\s*=/, /project_core_set_stage/, /zoho/i, /custody/i,
                     /budget_amount\s*=/, /invoice/i, /payment/i]) {
    assert.doesNotMatch(all, bad, `8C يمسّ مصدرًا محظورًا: ${bad}`);
  }
});

// ───────────────────── تجربة التشغيل: مصدر واحد ─────────────────────
test("التجربة مشتقّة للنطاقات غير المستقلّة ومخزَّنة للمستقل فقط", () => {
  const res = codeOf(funcBody("project_operating_experience"));
  assert.match(res, /if v_scope = 'master' then return 'program'/, "master لا يُشتقّ program");
  assert.match(res, /if v_scope = 'subproject' then return 'standard'/, "subproject لا يُشتقّ standard");
  assert.match(res, /return coalesce\(v_stored, 'standard'\)/, "المستقل بلا قيمة افتراضية");
  // الاشتقاق يسبق التخزين نصًّا (قيمة قديمة على master لا تفوز)
  assert.ok(res.indexOf("'program'") < res.indexOf("coalesce(v_stored"), "التخزين يسبق الاشتقاق");

  const set = codeOf(funcBody("project_set_operating_experience"));
  assert.match(set, /if v_scope <> 'standalone' then raise exception 'experience_is_derived'/, "يمكن تخزين تجربة على master/subproject");
  assert.match(set, /for update/, "لا قفل صفّ ⇒ سباق مع تغيير النطاق");
  assert.match(set, /not in \('simple','standard'\).*bad_experience/s, "لا تحقّق من القيمة");
  assert.match(set, /can_manage_projects\(\)|can_edit_project\(/, "الكتابة بفحص قراءة فقط");
  assert.match(set, /pc_log\(/, "التبديل بلا تدقيق");
  // المحذوف/المؤرشف: pc_can_read_project لا يفحصه للأدوار الواسعة
  assert.match(set, /if v_del then raise exception 'project_is_deleted'/, "الكتابة تصيب مشروعًا محذوفًا");
  assert.match(res, /where id = p_project and coalesce\(is_deleted,false\) = false/,
    "المُحلِّل يخالف اللقطة على الصفوف المحذوفة");
});

test("CHECK على العمود + مُشغِّل ينظّف التفضيل عند مغادرة standalone", () => {
  assert.match(SQL, /check \(operating_experience is null or operating_experience in \('simple','standard'\)\)/,
    "لا CHECK على العمود ⇒ قيم حرّة");
  const trg = codeOf(funcBody("fastlane_scope_cleanup"));
  assert.match(trg, /new\.project_scope is distinct from old\.project_scope and new\.project_scope <> 'standalone'/, "شرط التنظيف خاطئ");
  assert.match(trg, /new\.operating_experience := null/, "لا تنظيف ⇒ قيمة ميتة تعود بعد الخفض");
  assert.match(SQL, /create trigger trg_fastlane_scope_cleanup before update of project_scope on public\.projects/, "المُشغِّل ليس BEFORE UPDATE OF");
});

test("8C لا يعيد تعريف أيّ بوّابة وصول ولا دالة قائمة خارج نطاقه", () => {
  const created = [...SQL.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]);
  const allowed = ["project_operating_experience", "project_set_operating_experience", "project_quick_snapshot", "fastlane_scope_cleanup"];
  for (const f of created) assert.ok(allowed.includes(f), `8C يعيد تعريف دالة خارج نطاقه: ${f}`);
  for (const gate of ["can_access_project", "pc_can_read_project", "is_client_owner", "is_client_side", "can_manage_projects", "can_edit_project"]) {
    assert.doesNotMatch(SQL, new RegExp("create or replace function public\\." + gate + "\\b"), `إعادة تعريف بوّابة: ${gate}`);
  }
});

// ───────────────────── مصادر القائمة الحقيقية ─────────────────────
test("«رُفعت الملفات» يعني رفعًا فعليًّا لا مجرّد وجود مخرَج", () => {
  const body = codeOf(funcBody("project_quick_snapshot"));
  assert.ok(/from public\.deliverable_versions\b/.test(body), "مسار التسليم للعميل (deliverable_versions) غير محسوب");
  assert.ok(/from public\.project_deliverable_versions\b/.test(body), "مسار Project Core غير محسوب");
  // t_deliverable_autoversion يُنشئ V1 لكل مخرَج ⇒ عدّ الصفوف وحده = deliverable_created
  assert.match(body, /vimeo_review_url/, "عدّ نسخ العميل بلا اشتراط مرجع أصل ⇒ البند يصدق تلقائيًّا");
  assert.match(body, /file_path/, "عدّ نسخ Project Core بلا اشتراط مرجع أصل");
  assert.match(body, /v_versions := case when v_v1 is null and v_v2 is null then null/, "«غير متاح» لا تتطلّب غياب المصدرين");
  assert.match(body, /'code','files_uploaded'[\s\S]{0,260}case when v_versions is null then null else \(v_versions > 0\) end/,
    "«غير متاح» تُعرض كـ«لم يتم»");
});

test("«النسخة النهائية»: كل المخرجات + المساران + المعنى الآمن ('present')", () => {
  const body = codeOf(funcBody("project_quick_snapshot"));
  // has_final من deliverable_final_master_state يصدق على نسخة نهائية بملفّ مفقود
  assert.doesNotMatch(body, /deliverable_final_master_state/, "الاعتماد على has_final يخفي master مفقود/غير آمن");
  assert.match(body, /final_master_status,'none'\) = 'present'/, "لا يُشترط أنّ النسخة النهائية مخزّنة فعلًا");
  assert.match(body, /project_deliverable_versions pv[\s\S]{0,120}pv\.is_final = true/, "مسار Project Core للنسخة النهائية مفقود");
  // على كل المخرجات لا على المخرَج الأعلى ترتيبًا فقط
  assert.match(body, /v_has_final := case when v_final_all is null or v_final_all = 0 then null\s*\n?\s*else v_final_ok = v_final_all end/,
    "النهائي يُحسب على مخرَج واحد فقط");
});

test("«أُرسلت المعاينة» من سجلّ إظهار حقيقيّ لا من حالة لحظية", () => {
  const body = codeOf(funcBody("project_quick_snapshot"));
  assert.match(body, /v\.client_visible = true[\s\S]{0,80}into v_sent_client/, "المعاينة تُشتقّ من الحالة اللحظية فقط (غير رتيبة)");
  assert.match(body, /'code','preview_sent'[\s\S]{0,220}v_sent_client/, "البند لا يستعمل سجلّ الإظهار");
});

test("المخرجات المحذوفة مستبعَدة من العدّ والحالة والمخرج الحالي", () => {
  const body = codeOf(funcBody("project_quick_snapshot"));
  const dl = [...body.matchAll(/from public\.deliverables d where d\.project_id = p_project([^\n]*)/g)];
  assert.ok(dl.length >= 2, "استعلامات المخرجات ناقصة");
  for (const [, tail] of dl) assert.match(tail, /is_deleted/, "استعلام مخرجات بلا استبعاد المحذوف");
});

test("الإجراء التالي: لا حالة إغلاق بلا إجراء، ولا وجهة ترفض الإجراء", () => {
  const body = codeOf(funcBody("project_quick_snapshot"));
  // project_closure_request_create يرفع stage_not_delivered ما لم تكن المرحلة delivered
  assert.match(body, /when v_stage = 'delivered' and coalesce\(v_closure,'closure_not_started'\) = 'closure_not_started' then 'start_closure'/,
    "«ابدأ الإغلاق» يُرسل إلى تبويب يرفضه");
  assert.match(body, /when coalesce\(v_delivered,false\) and v_stage <> 'delivered' then 'record_delivery'/,
    "لا إجراء ينقل المرحلة إلى «مُسلَّم» ⇒ الإغلاق غير قابل للبلوغ");
  for (const st of ["closure_in_progress", "awaiting_internal_approval", "closure_blocked", "closure_approved", "reopened"]) {
    assert.ok(body.includes(st), `حالة إغلاق بلا إجراء: ${st}`);
  }
  // التصوير لا يعلو على التسليم/الإغلاق
  assert.match(body, /when not coalesce\(v_delivered,false\) and v_stage <> 'delivered' and v_shoot is not null then 'open_shoot'/,
    "جلسة قديمة تُثبّت «افتح جلسة التصوير» على مشروع مُسلَّم");
  // لا يُطلب رفع نسخة نهائية لمخرَج سُلِّم فعلًا
  assert.match(body, /'upload_final'/, "إجراء رفع النسخة النهائية مفقود");
  assert.match(body, /and not coalesce\(v_delivered,false\)\s*\n?\s*and v_has_final is not distinct from false then 'upload_final'/,
    "«ارفع النسخة النهائية» يبقى بعد التسليم إلى الأبد");
});

test("مفردات الحالات مطابقة للمخطّط الحيّ (لا رموز ميتة)", () => {
  const body = codeOf(funcBody("project_quick_snapshot"));
  // مراجعة المهام بعد 3A: in_review لم تعد موجودة
  assert.doesNotMatch(body, /'in_review'/, "رمز مهام ميت بعد 3A (in_review)");
  // جلسات التصوير: القيم من CHECK الحقيقي
  for (const s of ["completed", "cancelled"]) assert.ok(body.includes(`'${s}'`), `حالة جلسة غير مستعملة: ${s}`);
  // المخرجات: حالات موجودة فعلًا
  for (const s of ["client_review", "revision_requested", "approved", "final_delivered", "internal_review"]) {
    assert.ok(body.includes(`'${s}'`), `حالة مخرج غير مستعملة: ${s}`);
  }
  // الإغلاق: الرمز الرسميّ من 5C
  assert.ok(body.includes("closure_not_started"), "رمز حالة الإغلاق غير الرسميّ");
});

test("«غير متاح» ليست «ناقص»، وبنود التصوير تُستثنى للأنواع بلا تصوير", () => {
  const body = funcBody("project_quick_snapshot");
  for (const fn of ["project_closure_readiness", "pc_project_closure_status"]) {
    assert.ok(body.includes(`to_regprocedure('public.${fn}`), `${fn} تُستدعى بلا فحص وجود`);
  }
  // «مونتاج فقط» نوع رسميّ بلا تصوير ⇒ بنداه «غير متاح» وإلّا استحال بلوغ ١٠٠٪
  assert.match(codeOf(body), /v_no_shoot := \(coalesce\(v_type,''\) = 'editing_only'\) and v_shoots_total = 0/,
    "بنود التصوير «لم يتم» أبدًا لمشروع بلا تصوير بالتصميم");
  assert.match(codeOf(body), /'code','shoot_done'[\s\S]{0,160}v_no_shoot or v_shoots_total = 0 then null/,
    "«تم تنفيذ التصوير» يُحسب بلا جلسة أصلًا");
  assert.match(codeOf(body), /'code','final_master'[\s\S]{0,160}'done', v_has_final/, "النسخة النهائية تُجبَر على false");
  assert.match(codeOf(body), /'code','ready_to_close'[\s\S]{0,120}'done', v_ready/, "جاهزية الإغلاق تُجبَر على false");
  assert.match(codeOf(body), /'preview_versions', case when v_versions is null then to_jsonb\('unavailable'/, "«غير متاح» تظهر كـ٠");
});

test("توقيت الرياض للمقارنات اليومية (لا UTC صامت)", () => {
  assert.match(codeOf(funcBody("project_quick_snapshot")), /now\(\) at time zone 'Asia\/Riyadh'/, "التأخّر يُحسب بتوقيت UTC");
});

// ───────────────────── قوالب الأنواع السريعة ─────────────────────
test("بذور القوالب: ON CONFLICT يحمل شرط الفهرس الجزئيّ (وإلّا 42P10)", () => {
  assert.match(SQL, /on conflict \(template_key\) where template_key is not null do nothing/,
    "ON CONFLICT بلا شرط الفهرس الجزئيّ ⇒ 42P10 يُجهض الترحيل كلّه");
  assert.match(SQL7A, /create unique index[\s\S]{0,120}template_key[\s\S]{0,80}where template_key is not null/i,
    "افتراض الفهرس الجزئيّ لم يعد صحيحًا");
});

test("بذور القوالب: أنواع المخرجات ضمن CHECK الحقيقي فقط", () => {
  const seeds = SQL.slice(SQL.indexOf("insert into public.project_templates"));
  const types = [...seeds.matchAll(/'type','([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(types.length >= 10, `عدد مخرجات البذور ${types.length}`);
  for (const ty of types) assert.ok(["video", "photo", "other"].includes(ty), `نوع مخرَج يخالف CHECK: ${ty}`);
  assert.ok(!types.includes("image"), "'image' يخصّ preview_type لا deliverables.type");
});

test("بذور القوالب: كل قيم offset رقمية (لا نصوص تكسر الحساب)", () => {
  const seeds = SQL.slice(SQL.indexOf("insert into public.project_templates"));
  const bad = [...seeds.matchAll(/'(offset_days|due_offset_days)'\s*,\s*'(\d+)'/g)];
  assert.equal(bad.length, 0, `قيم إزاحة نصّية: ${bad.map((b) => b[0]).join(", ")}`);
});

test("كل نوع سريع ذي قالب له بذرة مطابقة بالمفتاح نفسه", () => {
  const keys = new Set([...SQL.matchAll(/\('(seed_[a-z_]+)'\s*,/g)].map((m) => m[1]));
  for (const m of SQL7A.matchAll(/\('(seed_[a-z_]+)'\s*,/g)) keys.add(m[1]);
  const wanted = [...TS.matchAll(/templateKey:\s*"(seed_[a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(wanted.length >= 10, `أنواع سريعة بقوالب: ${wanted.length}`);
  for (const k of wanted) assert.ok(keys.has(k), `النوع السريع يشير إلى قالب غير مبذور: ${k}`);
  // self-test بحدّ ١٢ كان يمرّ رغم سقوط بذرة (٤ من 7A + ٩ من 8C = ١٣)
  assert.match(SQL, /if v_n < 13 then raise exception '8C FAIL: بذور القوالب ناقصة/, "حدّ البذور خاطئ ⇒ الحارس لا يكشف نقصًا");
  for (const k of wanted) assert.ok(SQL.includes(`'${k}'`), `self-test لا يتحقّق من ${k}`);
});

// ───────────────────── طبقة TypeScript ─────────────────────
test("TS: كل غلاف يشير إلى RPC موجود فعلًا في 8C، ولا RPC بلا مستهلك", () => {
  const called = new Set([...TS.matchAll(/prpc<[^>]*>\("([a-z_]+)"/g)].map((m) => m[1]));
  const defined = new Set([...SQL.matchAll(/create or replace function public\.([a-z_0-9]+)\s*\(/gi)].map((m) => m[1]));
  for (const c of called) assert.ok(defined.has(c), `غلاف يستدعي RPC غير معرَّف في 8C: ${c}`);
  for (const d of defined) {
    if (d === "fastlane_scope_cleanup") continue;      // دالة مُشغِّل
    assert.ok(called.has(d), `RPC بلا مستهلك في الواجهة: ${d}`);
  }
});

test("TS: القائمة السريعة قراءة واحدة (لا N+1 ولا قائمة معرّفات في الرابط)", () => {
  assert.match(TS, /projects\?project_scope=eq\.standalone&operating_experience=eq\.simple/, "وسم القائمة ليس قراءة واحدة");
  assert.doesNotMatch(TS, /id=in\.\(/, "قائمة معرّفات في الرابط ⇒ رابط ضخم");
  assert.match(TS, /is_deleted=eq\.false/, "الوسم يشمل المحذوف");
});

test("TS: البند يقبل null (غير متاح) ورسائل الأخطاء مترجَمة بلا تسريب", () => {
  assert.match(TS, /done: boolean \| null/, "البند لا يميّز «غير متاح»");
  assert.match(TS, /preview_versions: number \| "unavailable"/, "النسخ لا تميّز «غير متاح»");
  for (const code of ["experience_is_derived", "bad_experience", "name_required", "client_required", "not authorized"]) {
    assert.ok(TS.includes(code), `fastlaneErr لا يترجم ${code}`);
  }
  assert.match(TS, /does not exist\|schema cache\|PGRST/, "لا رسالة صريحة حين لا يكون 8C مطبّقًا");
});

test("TS: وجهة كل «إجراء تالٍ» تبويب حقيقيّ داخل ProjectOps", () => {
  const tabs = new Set([...OPS.matchAll(/\{ k: "([a-z]+)",/g)].map((m) => m[1]));
  const targets = [...TS.matchAll(/tab: "([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(targets.length >= 8, "وجهات الإجراء التالي ناقصة");
  for (const tg of targets) assert.ok(tabs.has(tg), `وجهة إجراء غير موجودة كتبويب: ${tg}`);
  assert.match(TS, /none:\s*\{ ar: "[^"]+", tab: null \}/, "«لا إجراء» يحمل وجهة");
});

// ───────────────────── معالج الإنشاء السريع ─────────────────────
test("المعالج السريع: خطوتان، والحقول الإلزامية هي الاسم والعميل فقط", () => {
  assert.match(WIZ, /useState<1 \| 2>\(1\)/, "المعالج أكثر من خطوتين");
  assert.match(WIZ, /الخطوة \$\{step\} من ٢/, "لا مؤشّر خطوة");
  // حقول تظهر داخل حارس إلزاميّ. external مُبدِّل وضع (عميل مسجَّل/خارجي) لا حقل.
  const guards = [...WIZ.matchAll(/if \([^{}]*?\) \{ setErr\(/g)].map((m) => m[0]);
  assert.ok(guards.length >= 3, "لا حراس إلزام أصلًا");
  const fields = new Set(guards.flatMap((g) => [...g.matchAll(/f\.([a-z_]+)/g)].map((x) => x[1])));
  for (const r of fields) assert.ok(["project_name", "client_id", "client_name", "external"].includes(r), `حقل إلزامي زائد: ${r}`);
  for (const optional of ["start_date", "due_date", "manager_id", "template_id", "description", "quick_type"]) {
    assert.ok(!fields.has(optional), `حقل اختياري صار إلزاميًّا: ${optional}`);
  }
});

test("المعالج السريع: الإنشاء عبر المسار الرسميّ فقط (لا إدراج مباشر)", () => {
  assert.match(WIZ, /projectCreateFromTemplate\(/, "لا يستخدم مسار القوالب 7A");
  assert.match(WIZ, /pcCreateProject\(/, "لا يستخدم project_core_create_project");
  assert.doesNotMatch(tsCode(WIZ), /ppost\(|from\("projects"\)|projects\?/, "كتابة مباشرة إلى جدول المشاريع");
  assert.doesNotMatch(tsCode(WIZ), /project_scope|parent_project_id/, "المعالج السريع يغيّر نطاق المشروع أو هرميّته");
});

test("المعالج السريع: منع الإرسال المزدوج، وحرس التفكيك، ولا ادّعاء فشل كاذب", () => {
  assert.match(WIZ, /if \(busy\) return;/, "لا منع للإرسال المزدوج");
  assert.match(WIZ, /if \(!mounted\.current\) return;/, "لا حرس تفكيك بعد await");
  // فشل خطوة تكميلية لا يُقدَّم كفشل مشروع — ولا يُبتلع
  assert.match(WIZ, /setDone\(\{ projectId, warn: partial \}\)/, "لا شاشة نجاح صريحة ⇒ نموذج معبّأ يغري بإنشاء نسخة ثانية");
  assert.match(WIZ, /تم إنشاء المشروع بنجاح/, "النجاح غير معلَن");
  assert.match(WIZ, /done\.warn && <p[\s\S]{0,120}text-amber-300/, "فشل الخطوة التكميلية مبتلَع");
  assert.match(WIZ, /shootFailed = !sh\.ok/, "فشل الجلسة غير ملتقَط");
  assert.doesNotMatch(WIZ, /setTimeout\(\(\) => router\.push/, "مؤقّت تنقّل يسابق إغلاق المستخدم");
  assert.match(WIZ, /const expRes = await projectSetOperatingExperience\(projectId, "simple"\)/, "المشروع السريع لا يُوسم simple");
});

test("المعالج السريع: فشل تحميل العملاء ظاهر لا مبتلَع", () => {
  assert.match(WIZ, /setClientsFailed\(true\)/, "فشل قائمة العملاء مبتلَع ⇒ «لا عملاء» كاذبة");
  assert.match(WIZ, /تعذّر تحميل العملاء/, "لا رسالة بديلة للمستخدم");
});

test("المعالج السريع: «مونتاج فقط» لا يقترح جلسة تصوير", () => {
  const m = TS.match(/\{ k: "editing_only"[^}]*\}/);
  assert.ok(m, "النوع editing_only مفقود");
  assert.match(m[0], /suggestsShoot:\s*false/, "«مونتاج فقط» يقترح جلسة تصوير");
  assert.match(WIZ, /create_shoot: !!meta\?\.suggestsShoot/, "الاقتراح غير مربوط بالنوع");
});

// ───────────────────── لوحة المشروع السريع ─────────────────────
test("اللوحة السريعة: نداء واحد مشتقّ + مهلة + حرس تسلسل + إعادة محاولة", () => {
  assert.match(PANEL, /projectQuickSnapshot\(projectId\)/, "اللوحة لا تستهلك اللقطة");
  assert.equal((PANEL.match(/await (pcList|prpc|pget)/g) || []).length, 0, "اللوحة تجمع البيانات بنداءات متعدّدة (N+1)");
  assert.match(PANEL, /quick_timeout/, "بلا مهلة ⇒ تعليق أبديّ");
  assert.match(PANEL, /my !== seq\.current/, "بلا حرس تسلسل");
  assert.match(PANEL, /إعادة المحاولة/, "حالة الخطأ بلا إعادة محاولة");
});

test("اللوحة السريعة: «غير متاح» ليست «مكتملة» ولا تُحتسب في المقام", () => {
  assert.match(PANEL, /c\.done === null \? "–" : c\.done \? "✓" : "○"/, "الرمز لا يميّز «غير متاح»");
  assert.match(PANEL, /filter\(\(c\) => c\.done !== null\)\.length/, "المقام يشمل غير المتاح");
  assert.match(PANEL, /غير متاح/, "لا نصّ صريح لـ«غير متاح»");
  // الحالة نصًّا لا لونًا فقط
  assert.match(PANEL, /c\.done === null \? t\(\{ ar: "غير متاح"[\s\S]{0,120}"تم"[\s\S]{0,80}"لم يتم"/, "الحالة باللون وحده");
});

test("اللوحة السريعة: كل زرّ إجراء مربوط بوجهة حقيقية (لا زرّ وهميّ)", () => {
  assert.match(PANEL, /\{\(next\.tab \|\| next\.lifecycle\) && \(/, "زرّ «افتح» يظهر بلا وجهة");
  // «انقل المرحلة إلى مُسلَّم» لا يتمّ من تبويب — وجهته شريط دورة الحياة، لا زرّ ميت
  assert.match(PANEL, /next\.lifecycle \? onOpenLifecycle\(\)/, "إجراء المرحلة بلا وجهة عاملة");
  assert.match(OPS, /onOpenLifecycle=\{\(\) => \{ setShowDetails\(true\)/, "الأب لا يفتح دورة الحياة");
  assert.match(PANEL, /onGoTab\("shoots"\)/, "بطاقة الجلسة غير قابلة للفتح");
  assert.match(PANEL, /onGoTab\("deliverables"\)/, "بطاقة المخرج غير قابلة للفتح");
  assert.doesNotMatch(PANEL, /onClick=\{\(\) => \{\}\}|href="#"/, "زرّ بلا سلوك");
});

test("لا حقل في اللقطة بلا مستهلك في الواجهة", () => {
  assert.match(PANEL, /quickTypeLabel\(snap\.project_type\)/, "نوع المشروع السريع يعود من الخادم ولا يُعرض");
  assert.match(TS, /quickTypeLabel = \(k: string \| null \| undefined\)/, "مُترجم النوع مفقود");
});

test("اللوحة السريعة: مسار الترقية يعلن أنّه لا يغيّر بيانات", () => {
  assert.match(PANEL, /projectSetOperatingExperience\(projectId, "standard"\)/, "لا مسار ترقية إلى القياسي");
  assert.match(PANEL, /لم تتغيّر أيّ بيانات/, "الترقية بلا طمأنة صريحة");
  assert.match(PANEL, /canManage &&/, "زرّ الترقية يظهر لمن لا يملك التعديل");
});

// ───────────────────── الإظهار التدريجي داخل المشروع ─────────────────────
test("ProjectOps: لا تبويب يُحذف ولا صلاحية تُمنع — الترتيب والظهور فقط", () => {
  assert.match(OPS, /const SIMPLE_TABS: TabKey\[\] = \[/, "لا قائمة تبويبات مختصرة");
  // «المتقدمة» تُطوى ولا تُحذف: shownTabs مشتقّة من visibleTabs نفسها
  assert.match(OPS, /const shownTabs = collapseAdvanced \? visibleTabs\.filter/, "التبويبات المتقدّمة تُحذف بدل أن تُطوى");
  assert.match(OPS, /إدارة متقدمة/, "لا زرّ «إدارة متقدمة»");
  // الفلترة الأمنية القائمة لم تتغيّر
  assert.match(OPS, /tb\.k !== "costs" \|\| caps\.canSeeFinancials/, "فلترة المالية تغيّرت");
  assert.match(OPS, /tb\.k !== "finance" \|\| isFinance/, "عزل الحسابات تغيّر");
  assert.match(OPS, /tb\.k !== "trash" \|\| canManage/, "فلترة المحذوفات تغيّرت");
});

test("ProjectOps: التبويب النشط لا يختفي، وزرّ «المتقدمة» ليس عاجزًا", () => {
  // الفتح التلقائي يضبط الحالة نفسها؛ إجبار المشتقّ كان يجعل الزرّ يقلب حالة بلا أثر
  assert.match(OPS, /useEffect\(\(\) => \{ if \(isSimple && !SIMPLE_TABS\.includes\(tab\)\) setShowAdvanced\(true\); \}/,
    "التبويب النشط المتقدّم يختفي أو يُجبَر المشتقّ");
  assert.match(OPS, /const collapseAdvanced = isSimple && !showAdvanced;/, "المشتقّ لا يتبع الحالة ⇒ زرّ عاجز");
});

test("ProjectOps: الترقية/الخفض تُعيدان قراءة التجربة (المُشغِّل يمسحها على الخادم)", () => {
  const promote = OPS.match(/async function promoteToMaster\(\)[\s\S]*?\n  \}/)[0];
  const demote = OPS.match(/async function demoteToStandalone\(\)[\s\S]*?\n  \}/)[0];
  assert.match(promote, /projectOperatingExperience\(projectId\)/, "بعد الترقية تبقى الواجهة على تجربة ميتة");
  assert.match(demote, /projectOperatingExperience\(projectId\)/, "بعد الخفض يظهر زرّ التبسيط ولا يفعل شيئًا");
});

test("ProjectOps: فشل قراءة التجربة يُبقي السلوك القياسي حرفيًّا", () => {
  assert.match(OPS, /if \(alive && r\.ok\) setExp\(r\.data\)/, "فشل القراءة يغيّر السلوك");
  assert.match(OPS, /const isSimple = exp === "simple"/, "«سريع» ليست شرطًا صريحًا");
  assert.match(OPS, /tb\.k !== "quick" \|\| isSimple/, "تبويب «نظرة سريعة» يظهر في الوضع القياسي");
  assert.match(OPS, /if \(tab === "quick" && !isSimple\) setTab\("tasks"\)/, "التحويل للقياسي يترك منطقة فارغة");
});

test("ProjectOps: الهبوط على «نظرة سريعة» لا يختطف اختيار المستخدم أو الرابط", () => {
  assert.match(OPS, /landedRef\.current = true/, "الهبوط يتكرّر كل render");
  assert.match(OPS, /!touchedRef\.current && \(!initialTab \|\| initialTab === "quick"\)/, "الهبوط يختطف تبويبًا اختاره المستخدم");
  assert.match(OPS, /touchedRef\.current = true; setTab\(k\)/, "نقر التبويب لا يُسجَّل كتفاعل");
});

test("ProjectOps: طيّ دورة الحياة يُخفي العرض ولا يُفكّك المكوّن (بلا جلب مزدوج)", () => {
  assert.match(OPS, /isSimple && tab === "quick" && !showDetails \? "hidden" : "space-y-4"/, "الطيّ يفكّك شريط التقدّم ⇒ إعادة جلب");
  assert.match(OPS, /aria-expanded=\{showDetails\}/, "زرّ الطيّ بلا حالة معلَنة");
});

test("ProjectOps: تبديل التجربة للمستقل فقط، ولا يمسّ مرحلة ولا تقدّمًا", () => {
  const fn = OPS.match(/async function toggleExperience\(\)[\s\S]*?\n  \}/)[0];
  assert.match(fn, /projectSetOperatingExperience\(projectId, next\)/, "التبديل لا يمرّ بـRPC");
  assert.doesNotMatch(fn, /pcSetStage|pcSetProgress|pcSetMeta/, "التبديل يمسّ المرحلة أو التقدّم");
  assert.match(OPS, /hier\?\.project_scope === "standalone" && canManage && exp && \(\s*\n\s*<button onClick=\{\(\) => void toggleExperience\(\)\}/,
    "زرّ التبديل يظهر لنطاق مشتقّ أو لمن لا يملك الإدارة");
});

// ───────────────────── قائمة المشاريع ─────────────────────
test("لوحة المشاريع: زرّ «مشروع سريع» بجانب «إنشاء مشروع» ولإدارة فقط", () => {
  assert.match(DASH, /caps\.isAdminArea && <button onClick=\{\(\) => setShowFast\(true\)\}[\s\S]{0,200}مشروع سريع/, "زرّ «مشروع سريع» مفقود أو بلا بوّابة");
  assert.match(DASH, /\{showFast && <FastCreateWizard/, "الزرّ لا يفتح المعالج");
  const iFast = DASH.indexOf("مشروع سريع"), iNew = DASH.indexOf("إنشاء مشروع", iFast);
  assert.ok(iFast > -1 && iNew > iFast, "الزرّان غير متجاورين");
});

test("لوحة المشاريع: شارة «سريع» + فلتر معلَن النطاق، وفشل الوسم يُخفي الشارة فقط", () => {
  assert.match(DASH, /isQuick && <span[\s\S]{0,120}سريع/, "لا شارة «سريع» على البطاقة");
  assert.match(DASH, /setQuickIds\(q\.ok \? new Set\(q\.data\.map\(\(x\) => x\.id\)\) : null\)/, "فشل الوسم يُعطّل القائمة");
  assert.match(DASH, /ضمن القائمة المعروضة/, "فلتر «السريعة» يوهم بأنّه خادميّ");
  assert.match(DASH, /onlyQuick && shownRows\.length === 0/, "الفلتر يترك قائمة فارغة بلا تفسير");
});

// ───────────────────── الجوال وإتاحة الوصول ─────────────────────
test("الجوال: المعالج واللوحة قابلان للاستخدام بيد واحدة", () => {
  assert.match(WIZ, /grid grid-cols-2 gap-2/, "شبكة الأنواع غير ملائمة للجوال");
  assert.match(WIZ, /min-h-\[56px\]/, "أهداف اللمس أصغر من الحدّ المريح");
  assert.match(WIZ, /env\(safe-area-inset-bottom\)/, "شريط الإجراءات تحت حافة الجهاز");
  assert.match(WIZ, /sticky bottom-0/, "زرّ الإنشاء يحتاج تمريرًا على الجوال");
  assert.match(PANEL, /grid-cols-2 sm:grid-cols-4/, "بطاقات اللوحة لا تلتفّ على الجوال");
});

test("إتاحة الوصول: أدوار ونصوص بديلة وحقول موسومة", () => {
  assert.match(WIZ, /role="dialog" aria-modal="true"/, "الحوار بلا دور");
  assert.match(WIZ, /aria-label=\{t\(\{ ar: "إغلاق"/, "زرّ الإغلاق بلا اسم");
  assert.match(WIZ, /role="alert"/, "الخطأ لا يُعلَن");
  assert.match(WIZ, /aria-live="polite"/, "النجاح لا يُعلَن لقارئ الشاشة");
  const ids = [...WIZ.matchAll(/htmlFor="(fq-[a-z]+)"/g)].map((m) => m[1]);
  assert.ok(ids.length >= 6, "حقول بلا وسوم مرتبطة");
  for (const id of ids) assert.ok(WIZ.includes(`id="${id}"`), `وسم بلا حقل: ${id}`);
  assert.match(PANEL, /role="alert"/, "خطأ اللوحة لا يُعلَن");
  assert.match(OPS, /aria-current=\{tab === tb\.k \? "page" : undefined\}/, "التبويب النشط غير معلَن");
});

test("الواجهات لا تسجّل بيانات في الإنتاج ولا تعرض رسائل خام", () => {
  for (const [n, src] of [["PANEL", PANEL], ["WIZ", WIZ]]) {
    for (const m of src.matchAll(/console\.(log|error|warn)/g)) {
      const at = src.slice(Math.max(0, src.lastIndexOf("\n", src.indexOf(m[0])) - 200), src.indexOf(m[0]));
      assert.match(at, /NODE_ENV !== "production"/, `${n}: تسجيل غير محروس`);
    }
    assert.doesNotMatch(src, /\{r\.error\}|\{err\.message\}/, `${n}: رسالة خام معروضة للمستخدم`);
  }
});
