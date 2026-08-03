// ════════════════════════════════════════════════════════════════════════════
// tests/wave3_permits_media_seeds.test.js
//
// Wave 3 · إغلاق — سجلّ التصاريح (V2-3.2-A) · التنبيهات (V2-3.2-C) ·
// وسائط المواقع (V2-3.4-B) · البذور (V2-3.5-B) · البودكاست (V2-3.5-C).
//
// عقد ساكن. **لا تشغيل SQL · لا قاعدة · لا شبكة · لا رفع ملفّات.**
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const has = (r) => fs.existsSync(path.join(ROOT, r));

/** يجرّد التعليقات والسلاسل — لا يُحاكَم النصّ الشارح كأنّه كود. */
function codeOnly(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "  "; i += 2; continue; } q = false; } out += c === "\n" ? "\n" : " "; i++; continue; }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
/** يجرّد التعليقات ويُبقي السلاسل — للتحقّق من رسائل ومحتوى نصّيّ. */
const noComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
/** يجرّد أجسام الدوالّ ($$…$$) — ما يبقى هو الـDDL وحده. */
const outsideFunctions = (sql) => sql.replace(/\$\$[\s\S]*?\$\$/g, " /*fn*/ ");
const P = (n) => `docs/wave3_permits_media_${n}.sql`;
const RUNME = () => codeOnly(read(P("RUNME")));
const RAW = () => read(P("RUNME"));

// ─── V2-3.2-A · السجلّ ──────────────────────────────────────────────────────

test("(P-1) ★★ الحزمة كاملة الأربعة ★★", () => {
  for (const n of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(has(P(n)), `${n} مفقود`);
    assert.ok(read(P(n)).length > 400, `${n} أقصر من أن يكون حقيقيًّا`);
  }
});

test("(P-2) ★★★ امتداد لا استبدال: ops_job_permits لا يُمسّ ولا تُرخّى قيوده ★★★", () => {
  const c = RUNME();
  // العمود الوحيد المسموح على الجدول القائم هو الربط.
  const alters = [...c.matchAll(/alter table public\.ops_job_permits([^;]*)/gi)].map((m) => m[1]);
  assert.ok(alters.length > 0, "لا ربط بالجدول القائم — فأين الامتداد؟");
  for (const a of alters) {
    assert.match(a, /add column if not exists registry_permit_id/i, `تعديل غير مصرَّح به: ${a.slice(0,80)}`);
    // 🔴 إرخاء job_id كان سيحوّل جدول المهامّ إلى سجلّ عامّ ضمنًا.
    assert.doesNotMatch(a, /drop\s+(column|constraint)|alter column|drop not null/i,
      "🔴 قيود الجدول القائم تُرخّى");
  }
  assert.match(c, /on delete set null/i, "الربط ليس on delete set null — حذف السجلّ يُفقد أثر استعماله");
  // ⛔ ولا نظام تصاريح موازٍ باسم عامّ.
  for (const bad of ["permits", "permit_registry", "compliance_documents", "location_media", "location_photos"]) {
    assert.doesNotMatch(c, new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${bad}\\b`, "i"),
      `🔴 جدول موازٍ: ${bad}`);
  }
});

test("(P-3) ★★ السجلّ يحمل كلّ حقول الـBrief — والمسؤول أهمّها ★★", () => {
  const ddl = RAW().slice(RAW().indexOf("create table if not exists public.ops_permits"));
  const body = ddl.slice(0, ddl.indexOf(");"));
  for (const col of ["permit_type", "authority_name", "reference_no", "issued_at",
                     "expires_at", "status", "scope", "owner_user_id", "note"]) {
    assert.ok(body.includes(col), `حقل مطلوب مفقود: ${col}`);
  }
  // 🔴 المسؤول هو الحقل الذي لا يوجد أصلًا في ops_job_permits — وهو سبب السجلّ.
  assert.match(body, /owner_user_id\s+uuid references auth\.users/, "المسؤول ليس مرجعًا حقيقيًّا");
  // نطاق يدّعي ارتباطًا يجب أن يحمله.
  assert.match(body, /ops_permits_scope_target/, "لا قيد يربط النطاق بهدفه");
  assert.match(body, /ops_permits_dates/, "لا قيد يمنع انتهاءً قبل الإصدار");
  // مفردات الحالة مطابقة للقائمة القائمة + revoked.
  for (const st of ["not_required","pending","submitted","approved","rejected","expired","revoked"]) {
    assert.ok(body.includes(`'${st}'`), `حالة مفقودة: ${st}`);
  }
});

test("(P-4) ★★★ لا بيانات مخترعة: الجداول تُنشأ فارغة ★★★", () => {
  const c = RUNME();
  // ⚠️ أجسام الدوالّ تُستثنى: `prodops_permit_upsert` يُدرج بالطبع — وهو عمل
  // المستخدم لا بذرة. المقصود إدراج على مستوى الملفّ يزرع صفوفًا عند التطبيق.
  const ddlOnly = outsideFunctions(c);
  const inserts = [...ddlOnly.matchAll(/insert\s+into\s+public\.(ops_permits|ops_media)\b/gi)];
  assert.equal(inserts.length, 0, "🔴 RUNME يزرع تصاريح أو مرفقات — والـBrief يمنع اختراعها");
  // ولا رقم تصريح ولا جهة في النصّ.
  assert.doesNotMatch(RAW(), /reference_no\s*=\s*'[0-9]/, "🔴 رقم تصريح مخترع");
});

// ─── V2-3.2-C · التنبيهات ──────────────────────────────────────────────────

test("(A-1) ★★★ لا خدمة إشعارات ثانية ولا مجدول رابع ★★★", () => {
  const c = RUNME();
  // 🔴 يُعاد استعمال المساعدات القائمة حرفيًّا.
  assert.match(c, /public\.civ_alert_once\(/, "🔴 لا يستعمل منع التكرار القائم");
  assert.match(c, /public\.civ_notify_managers\(/, "🔴 لا يستعمل مسار التسليم القائم");
  // ⛔ ولا جدول تنبيهات/طوابير جديد.
  for (const bad of ["permit_alerts", "ops_alerts", "ops_notifications", "permit_notifications"]) {
    assert.doesNotMatch(c, new RegExp(`create\\s+table[^;]*${bad}`, "i"), `🔴 نظام تنبيهات ثانٍ: ${bad}`);
  }
  // ⛔ ولا إرسال من القاعدة.
  for (const re of [/pg_net/i, /net\.http/i, /http_(get|post)\b/i, /dblink/i, /smtp/i]) {
    assert.doesNotMatch(c, re, "🔴 إرسال خارجيّ من داخل القاعدة");
  }
  // مطويّة في الكرون القائم لا في مسار جديد.
  assert.ok(!has("app/api/cron/permit-alerts/route.ts"), "🔴 مجدول رابع (G8)");
  const cron = read("app/api/cron/custody-alerts/route.ts");
  assert.match(cron, /prodops_permit_alerts_run/, "لم تُطوَ في الكرون القائم");
  assert.match(cron, /rpcAsService/, "لا تُستدعى بمفتاح الخدمة كبقية المحرّكات");
});

test("(A-2) ★★★ التنبيه idempotent — مفتاح لكلّ عتبة، ولا تكرار يوميّ ★★★", () => {
  const fn = RAW().slice(RAW().indexOf("function public.prodops_permit_alerts_run"));
  // ثلاثة مفاتيح متمايزة: ٣٠ · ٧ · منتهٍ. لو تشاركت لابتلع أحدها الآخر.
  for (const k of ["permit30:", "permit7:", "permitexp:"]) {
    assert.ok(fn.includes(k), `مفتاح مفقود: ${k}`);
  }
  // 🔴 المفتاح يحمل expires_at لا تاريخ اليوم: لو حمل اليوم لتكرّر التنبيه
  //    يوميًّا طوال نافذة الثلاثين. وحمله expires_at يجعل **التجديد** ينتج
  //    مفتاحًا جديدًا ⇒ دورة تنبيه جديدة تلقائيًّا.
  const keys = [...fn.matchAll(/'permit(?:30|7|exp):'\|\|([^,]+),/g)].map((m) => m[1]);
  assert.ok(keys.length === 3, `عدد المفاتيح ${keys.length}`);
  for (const k of keys) {
    assert.match(k, /expires_at/, `🔴 المفتاح لا يتضمّن تاريخ الانتهاء: ${k}`);
    assert.doesNotMatch(k, /v_day|current_date|now\(\)/, `🔴 المفتاح يتضمّن اليوم ⇒ تنبيه يوميّ مكرَّر: ${k}`);
  }
});

test("(A-3) ★★★ حدود ٣٠ و٧ واليوم نفسه وبعد الانتهاء ★★★", () => {
  const fn = RAW().slice(RAW().indexOf("function public.prodops_permit_alerts_run"));
  // النافذتان متمايزتان: ٣٠ تستثني ما دون ٧ فلا يُرسَل تنبيهان معًا.
  assert.match(fn, /v_days\s*<=\s*30\s+and\s+v_days\s*>\s*7/, "🔴 نافذة الثلاثين تبتلع نافذة السبعة");
  // اليوم نفسه (0) داخل نافذة السبعة — لا يسقط في الفجوة.
  assert.match(fn, /v_days\s*<=\s*7\s+and\s+v_days\s*>=\s*0/, "🔴 «ينتهي اليوم» خارج التغطية");
  assert.match(fn, /v_days\s*<\s*0/, "لا معالجة لما بعد الانتهاء");
  // ⛔ بلا تاريخ انتهاء لا تنبيه.
  assert.match(fn, /expires_at is not null/, "🔴 تنبيه على تصريح بلا تاريخ انتهاء");
  // ⛔ والملغى/المرفوض/غير المطلوب خارج النطاق — لا «يوشك أن ينتهي».
  assert.match(fn, /status in \('pending','submitted','approved'\)/,
    "🔴 تصاريح ملغاة أو مرفوضة تدخل التنبيهات");
});

test("(A-4) ★★★ المنطقة الزمنية صريحة — لا انتهاء بسبب منطقة الخادم ★★★", () => {
  const fn = RAW().slice(RAW().indexOf("function public.prodops_permit_alerts_run"));
  assert.match(fn, /at time zone 'Asia\/Riyadh'/,
    "🔴 التاريخ يُحسب بمنطقة الخادم — تصريح ينتهي اليوم في الرياض قد يُعدّ منتهيًا أمس");
  // ولا current_date عارٍ داخل حساب الأيام.
  const body = fn.slice(fn.indexOf("v_today :="));
  assert.doesNotMatch(body.slice(0, body.indexOf("loop")), /\bcurrent_date\b/,
    "🔴 current_date عارٍ بجانب حساب صريح — مصدرا تاريخ متعارضان");
});

// ─── V2-3.4-B · الوسائط ────────────────────────────────────────────────────

test("(M-1) ★★★ لا رابط تخزين مخزَّن ولا دائم ★★★", () => {
  const c = RUNME();
  // بلا تعليقات: الشرح نفسه يقول «لا URL عامّ يُخزَّن»، فالبحث الخامّ يرصده.
  const src = noComments(RAW());
  const ddl = src.slice(src.indexOf("create table if not exists public.ops_media"));
  const body = ddl.slice(0, ddl.indexOf(");"));
  assert.match(body, /storage_bucket\s+text not null/, "لا دلو");
  assert.match(body, /storage_path\s+text not null/, "لا مسار");
  // 🔴 لا عمود يحمل رابطًا — رابط مخزَّن يخرج في أيّ تصدير ويبقى بعد سحب الصلاحية.
  assert.doesNotMatch(body, /\b(url|signed_url|public_url|href)\b/i, "🔴 عمود رابط في جدول وسائط");
  // وقيد يمنع دسّ رابط في حقل المسار.
  // ⚠️ على المصدر بلا تعليقات لا على codeOnly: القيد **سلسلة نصّية**، وcodeOnly
  //    يمحو ما بين علامتي الاقتباس فلا يراه إطلاقًا.
  assert.match(src, /storage_path\s*!~\*\s*'\^https\?:/i, "🔴 لا قيد يمنع رابطًا كاملًا في حقل المسار");
  // الحقول التي يطلبها الـBrief.
  for (const col of ["media_type", "caption", "sort_order", "added_by", "created_at", "is_deleted"]) {
    assert.ok(body.includes(col), `حقل وسائط مفقود: ${col}`);
  }
  // مالكان مقيَّدان — لا polymorphism مفتوح.
  assert.match(body, /owner_kind\s+text not null check \(owner_kind in \('location','permit'\)\)/,
    "🔴 المالك غير مقيَّد بقائمة بيضاء");
});

test("(M-2) ★★★ التوقيع: الصلاحية تُفحص في القاعدة قبل مفتاح الخدمة ★★★", () => {
  const r = read("app/api/portal/ops/media-url/route.ts");
  const iList = r.indexOf("prodops_media_list");
  const iSvc = r.indexOf("SERVICE_KEY, Authorization");
  assert.ok(iList > -1 && iSvc > -1, "المسار لا يفعل ما يُفترض");
  // 🔴 الترتيب هو الأمان كلّه.
  assert.ok(iList < iSvc, "🔴 مفتاح الخدمة يُستعمل قبل أن تُثبت القاعدة الصلاحية");
  // 🔴 المسار يُؤخذ من ردّ القاعدة لا من الطلب.
  assert.match(r, /const row = \(payload\?\.rows \?\? \[\]\)\.find\(\(r\) => r\.id === mediaId\)/,
    "🔴 المسار قد يأتي من العميل ⇒ توقيع أيّ ملفّ في الدلو");
  assert.match(r, /expiresIn: SIGN_TTL/, "لا انتهاء للرابط");
  assert.match(r, /SIGN_TTL = 300/, "الرابط أطول من خمس دقائق");
  assert.match(r, /"cache-control": "no-store"/, "رابط موقَّع يُخزَّن وسيطًا");
  assert.match(r, /NEXT_PUBLIC_SHOW_OPS_PERMITS_REGISTRY === "true"/, "بلا حارس علم");
  assert.match(r, /if \(!enabled\(\)\) return bad\("not_found", 404\)/, "المسار المعطَّل يُقرّ بوجوده");
  // والواجهة تفتح بـnoopener/noreferrer فلا يتسرّب الرابط في Referer.
  assert.match(read("components/portal/operations/OpsPermitsRegistry.tsx"),
    /"noopener,noreferrer"/, "🔴 الرابط الموقَّع قد يتسرّب في Referer");
});

// ─── V2-3.5-B · البذور ─────────────────────────────────────────────────────

test("(S-1) ★★★ البذور محروسة: لا تعمل على Production بلا اختيار صريح ★★★", () => {
  const f = "docs/wave3_seeds_DEV_ONLY.sql";
  assert.ok(has(f), "ملفّ البذور مفقود");
  const s = read(f);
  // 🔴 الحارس: بلا موافقة صريحة يرفع استثناءً ولا يكتب صفًّا.
  assert.match(s, /current_setting\('kian\.allow_seed', true\)/, "🔴 بلا حارس تشغيل");
  assert.match(s, /raise exception/, "الحارس لا يوقف التشغيل");
  assert.match(s, /DEV_ONLY|DEVELOPMENT/i, "الاسم أو الترويسة لا تُعلن أنّها للتطوير");
  // كلّ صفّ موسوم ويمكن حذفه بسطر واحد.
  assert.ok((s.match(/\[SEED\]/g) || []).length >= 4, "الصفوف غير موسومة");
  assert.match(s, /'seed', true/, "spec لا يحمل علامة البذرة");
  assert.match(s, /delete from public\.project_templates where name like '\[SEED\]%'/,
    "طريقة الحذف غير موثَّقة");
  // ⛔ ولا تُشغَّل تلقائيًّا: ليست في أيّ RUNME ولا في المانيفست كخطوة إصدار.
  for (const p of ["docs/wave3_permits_media_RUNME.sql", "docs/wave3_production_ops_RUNME.sql",
                   "docs/wave3_calendar_tokens_RUNME.sql"]) {
    assert.doesNotMatch(read(p), /wave3_seeds/, `🔴 ${p} يستدعي البذور`);
  }
  // ⛔ ولا بيانات حقيقية.
  assert.doesNotMatch(s, /kianmedia\.com|@gmail|\+9665\d{8}/, "🔴 بيانات اتصال حقيقية في بذرة");
  assert.match(s, /project_templates/, "البذور لا تستعمل نظام القوالب القائم");
  // ⛔ ولا جدول قوالب ثانٍ.
  assert.doesNotMatch(codeOnly(s), /create\s+table/i, "🔴 البذور تُنشئ جدولًا");
});

test("(S-2) ★ البذرتان المطلوبتان بالاسم — لا أكثر ولا أقلّ ★", () => {
  const s = read("docs/wave3_seeds_DEV_ONLY.sql");
  assert.ok(s.includes("[SEED] فيلم مؤسسي"), "بذرة «فيلم مؤسسي» مفقودة");
  assert.ok(s.includes("[SEED] عرس"), "بذرة «عرس» مفقودة");
  const names = [...s.matchAll(/'\[SEED\] ([^']+)'/g)].map((m) => m[1]);
  assert.equal(new Set(names).size, 2, `عدد البذور ${new Set(names).size} — الـBrief يطلب اثنتين`);
});

// ─── V2-3.5-C · البودكاست ──────────────────────────────────────────────────

test("(D-1) ★★★ لا جدول حلقات ولا نظام مشاريع ثانٍ ★★★", () => {
  const doc = "docs/wave-reports/WAVE_3_PODCAST_AS_SUBPROJECTS.md";
  assert.ok(has(doc), "🔴 البند بلا سبب موثَّق لعدم الحاجة");
  const d = read(doc);
  // يستعمل النظام القائم بالاسم.
  for (const k of ["parent_project_id", "project_scope", "projects_hierarchy_guard",
                   "project_hierarchy_rollup", "project_subprojects_summary"]) {
    assert.ok(d.includes(k), `الوثيقة لا تستند إلى ${k}`);
  }
  // 🔴 ولا جدول حلقات في أيّ حزمة من الموجة.
  for (const p of ["docs/wave3_permits_media_RUNME.sql", "docs/wave3_production_ops_RUNME.sql",
                   "docs/wave3_calendar_tokens_RUNME.sql"]) {
    assert.doesNotMatch(codeOnly(read(p)),
      /create\s+table[^;]*(podcast|episode)/i, `🔴 جدول حلقات في ${p}`);
  }
  // والقرار الماليّ مؤجَّل صراحةً لا مخمَّن.
  assert.match(d, /FINANCIAL SOURCE-OF-TRUTH DECISION/, "القرار الماليّ غير مصنَّف");
  assert.match(d, /لا تجميع ماليّ|لا ازدواج احتساب/, "لا بيان لوضع الازدواج الحاليّ");
});

// ─── الأمن العامّ للحزمة ───────────────────────────────────────────────────

test("(G-1) ★★★ كلّ دالّة محصَّنة، ولا شيء لـanon ★★★", () => {
  const c = RUNME();
  const fns = [...c.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  assert.ok(fns.length >= 7, `عدد الدوالّ ${fns.length}`);
  for (const f of fns) {
    assert.ok(f.startsWith("prodops_"), `🔴 ${f} خارج العائلة المعتمدة (D-2)`);
  }
  // security definer دائمًا مع search_path مثبَّت.
  const defs = (c.match(/security\s+definer/gi) || []).length;
  const paths = (c.match(/set\s+search_path\s*=\s*public/gi) || []).length;
  assert.equal(defs, paths, `🔴 ${defs - paths} دالّة security definer بلا search_path مثبَّت`);
  // REVOKE قبل GRANT لكلّ دالّة.
  for (const f of fns) {
    assert.match(c, new RegExp(`revoke all on function public\\.${f}\\(`), `🔴 ${f} بلا REVOKE`);
  }
  assert.doesNotMatch(c, /grant execute on function[^;]*to[^;]*\banon\b/i, "🔴 دالّة ممنوحة لـanon");
  // ⚠️ `\bto\b` لازم: بدونه تطابق "in**to public**.ops_permits" داخل الدوالّ.
  assert.doesNotMatch(c, /grant\s+all\b|\bto\s+public\b/i, "🔴 منح شامل");
  // محرّك التنبيهات لمفتاح الخدمة وحده.
  assert.match(c, /revoke all on function public\.prodops_permit_alerts_run\(\) from public, anon, authenticated/,
    "🔴 محرّك التنبيهات متاح لمستخدم");
  assert.match(c, /grant execute on function public\.prodops_permit_alerts_run\(\) to service_role/,
    "المحرّك غير ممنوح لمفتاح الخدمة");
  // RLS deny-by-default على الجدولين، ولا صلاحية جدول لـanon.
  assert.equal((c.match(/enable row level security/gi) || []).length, 2, "RLS ناقص");
  assert.match(c, /revoke all on public\.ops_permits from anon, public/, "🔴 الجدول بلا REVOKE");
  assert.match(c, /revoke all on public\.ops_media\s+from anon, public/, "🔴 الجدول بلا REVOKE");
  // ⛔ ولا سياسة كتابة: الكتابة عبر الدوالّ وحدها.
  assert.doesNotMatch(c, /create policy[^;]*for\s+(insert|update|delete)/i,
    "🔴 سياسة كتابة مباشرة تتجاوز الدوالّ المحروسة");
});

test("(G-2) ★★ إضافيّ · idempotent · PREFLIGHT/POSTCHECK لا يكتبان ★★", () => {
  const c = RUNME();
  for (const re of [/drop\s+table/i, /truncate/i, /delete\s+from/i, /drop\s+column/i]) {
    assert.doesNotMatch(c, re, "🔴 RUNME يحذف");
  }
  assert.match(c, /create table if not exists public\.ops_permits/i, "غير idempotent");
  assert.match(c, /create table if not exists public\.ops_media/i, "غير idempotent");
  for (const m of c.matchAll(/add\s+column\s+(if\s+not\s+exists\s+)?/gi)) {
    assert.ok(m[1], "🔴 add column بلا if not exists");
  }
  assert.match(c, /^\s*begin;/im, "بلا معاملة");
  for (const n of ["PREFLIGHT", "POSTCHECK"]) {
    const q = codeOnly(read(P(n)));
    for (const re of [/\bcreate\s+(table|function|index)/i, /\balter\s+table/i, /\binsert\s+into/i, /\bdelete\s+from/i, /\bdrop\s+/i]) {
      assert.doesNotMatch(q, re, `🔴 ${n} يكتب`);
    }
  }
});

// ─── الواجهة ───────────────────────────────────────────────────────────────

test("(U-1) ★★★ العلم مطفأ ⇒ لا تبويب ولا مكوّن ولا استدعاء ★★★", () => {
  const center = read("components/portal/operations/OpsCenter.tsx");
  // 🔴 التبويب لا يُضاف أصلًا — لا تبويب فارغ.
  assert.match(center, /\.\.\.\(opsPermitsEnabled\(\) \? \[\{ k: "permits"/,
    "🔴 التبويب يظهر ثمّ يُخفى محتواه — واجهة فارغة");
  assert.match(center, /active === "permits" && opsPermitsEnabled\(\)/, "المحتوى بلا حارس ثانٍ");
  const lib = read("lib/portal/opsCenter.ts");
  assert.match(lib, /NEXT_PUBLIC_SHOW_OPS_PERMITS_REGISTRY === "true"/, "العلم ليس مقارنة صارمة");
});

test("(U-2) ★★ الحالات الأربع حقيقية، والفارغ يقول ما يُفعل ★★", () => {
  const c = read("components/portal/operations/OpsPermitsRegistry.tsx");
  assert.match(c, /StateView/, "لا تحميل/خطأ/ترحيلة — StateView هو مصدرها");
  assert.match(c, /onRetry=\{reload\}/, "لا إعادة محاولة عند الخطأ");
  assert.match(c, /<Empty message=/, "لا حالة فارغة");
  // الفارغ يشرح الفعل التالي بدل «لا نتائج».
  const empty = c.match(/<Empty message="([^"]+)"/)[1];
  assert.ok(empty.length > 25 && /أضف/.test(empty), `الحالة الفارغة لا تُرشد: ${empty}`);
  // 🔴 وفشل الوسائط معزول: له StateView خاصّ فلا يُسقط بطاقة التصريح.
  assert.ok((c.match(/StateView/g) || []).length >= 2, "🔴 الوسائط غير معزولة عن السجلّ");
  // الحذف يحتاج سببًا — نفس عقد القاعدة.
  assert.match(c, /reason\.length < 3/, "الواجهة تسمح بحذف بلا سبب");
  // ⛔ ولا مفردات مخترعة: الحالات من الخريطة القائمة.
  assert.match(c, /PERMIT_STATUS_AR\[p\.status\]/, "🔴 مفردات حالة مكتوبة في الواجهة");
});

test("(U-3) ★★ عتبات الواجهة = عتبات محرّك التنبيهات ★★", () => {
  const lib = read("lib/portal/opsCenter.ts");
  const fn = lib.slice(lib.indexOf("export function permitExpiryTone"));
  // 🔴 واجهة تُلوّن بعتبة ومحرّك يُنبّه بأخرى يُنتج تناقضًا يراه المستخدم.
  assert.match(fn, /<=\s*7/, "عتبة السبعة مفقودة في الواجهة");
  assert.match(fn, /<=\s*30/, "عتبة الثلاثين مفقودة في الواجهة");
  const sql = RAW();
  assert.ok(sql.includes("<= 30") && sql.includes("<= 7"), "عتبات القاعدة تغيّرت");
});
