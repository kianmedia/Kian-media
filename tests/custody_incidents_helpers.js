// ════════════════════════════════════════════════════════════════════════════
// tests/custody_incidents_helpers.js
//
// مُدقِّق حزمة `custody_enterprise_incidents_*` — يعمل على **مجلَّد** لا على
// المستودع، ليُشغَّل حرفيًّا نفسه على نسخ مُشوَّهة (mutation) في مجلَّد مؤقّت.
//
// 🔴 قاعدة عدم الدور (non-tautology): توقّعات PREFLIGHT وPOSTCHECK تُشتقّ من
//    **RUNME** — ملفّ آخر. فلو اشتُقّ توقّع الملفّ من الملفّ نفسه، لمرّت كل
//    طفرة عليه (وقد وقع ذلك فعلًا في اختبارات Wave 4 سابقًا).
//
// ⛔ لا قاعدة ولا شبكة: تحليل نصّيّ ساكن.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");

const RUNME = "custody_enterprise_incidents_RUNME.sql";
const PRE = "custody_enterprise_incidents_PREFLIGHT.sql";
const POST = "custody_enterprise_incidents_POSTCHECK.sql";
const ROLL = "custody_enterprise_incidents_ROLLBACK.sql";
const PKG_FILES = [RUNME, PRE, POST, ROLL];

/** يجرّد تعليقات `--` ويُبقي السلاسل النصّية. */
function stripComments(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") q = false; out += c; i++; continue; }
    if (c === "'") { q = true; out += c; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}

/** يجرّد أجسام الدوالّ `$$…$$` — ليبقى ما هو **على مستوى المعاملة**. */
function stripBodies(sql) {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, " <BODY> ");
}

/** أجسام الدوالّ وحدها. */
function bodies(sql) {
  return [...sql.matchAll(/\$\$([\s\S]*?)\$\$/g)].map((m) => m[1]);
}

/**
 * يُدقّق الحزمة في مجلَّد ما. يُعيد مصفوفة أعطاب (فارغة = سليمة).
 * كل عطب: `{ id, msg }`.
 */
function auditPackage(dir) {
  const F = {};
  for (const f of PKG_FILES) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) return [{ id: "missing_file", msg: `ملفّ الحزمة مفقود: ${f}` }];
    F[f] = fs.readFileSync(p, "utf8");
  }
  const bad = [];
  const fail = (id, msg) => bad.push({ id, msg });

  const runRaw = F[RUNME];
  const run = stripComments(runRaw);
  const runTop = stripBodies(run);           // مستوى المعاملة
  const runBodies = bodies(run).join("\n");  // داخل الدوالّ

  // ── ١ · ذرّية المعاملة ──────────────────────────────────────────────────
  const begins = (runTop.match(/\bbegin\s*;/gi) ?? []).length;
  const commits = (runTop.match(/\bcommit\s*;/gi) ?? []).length;
  if (begins !== 1) fail("tx_begin", `RUNME يحوي ${begins} من \`begin;\` — المطلوب واحد`);
  if (commits !== 1) fail("tx_commit", `RUNME يحوي ${commits} من \`commit;\` — المطلوب واحد`);
  if (/\brollback\s*;/i.test(runTop)) fail("tx_rollback", "RUNME يحوي `rollback;` على مستوى المعاملة");
  if (/\bsavepoint\b/i.test(runTop)) fail("tx_savepoint", "RUNME يحوي savepoint — يكسر الذرّية");
  const iCommit = runTop.search(/\bcommit\s*;/i);
  const iNotify = runTop.search(/notify\s+pgrst/i);
  if (iNotify === -1) fail("notify_missing", "RUNME لا يُعيد تحميل مخطّط PostgREST");
  else if (iCommit === -1 || iNotify < iCommit) fail("notify_before_commit", "`notify pgrst` قبل COMMIT");

  // ── ٢ · ⛔ لا بذور ولا تنبيهات ولا cron أثناء التطبيق ───────────────────
  for (const m of runTop.match(/\binsert\s+into\s+[a-z0-9_."]+/gi) ?? []) {
    fail("seed_data", `إدراج بيانات على مستوى المعاملة: ${m.trim()}`);
  }
  for (const m of runTop.match(/\bupdate\s+public\.[a-z0-9_]+/gi) ?? []) {
    fail("seed_update", `تعديل بيانات على مستوى المعاملة: ${m.trim()}`);
  }
  if (/\bperform\s+public\.(civ_notify|civ_alert_once)|select\s+public\.custody_run_alerts/i.test(runTop)) {
    fail("alerts_at_apply", "RUNME يُشغّل محرّك التنبيهات أو يُنشئ تنبيهًا أثناء التطبيق");
  }
  if (/cron\.schedule|pg_cron/i.test(run)) fail("cron", "RUNME يُنشئ cron");

  // ── ٣ · مُشغِّل الحجز ────────────────────────────────────────────────────
  const trg = run.match(/create\s+trigger\s+(\w+)\s+([\s\S]*?)execute\s+function\s+public\.(\w+)/i);
  if (!trg) fail("trigger_missing", "مُشغِّل الحجز غير موجود في RUNME");
  else {
    const [, tname, when, tfn] = trg;
    if (!/before\s+insert/i.test(when)) fail("trigger_not_before_insert", `${tname}: ليس before insert`);
    if (!/update\s+of\s+asset_id/i.test(when)) {
      fail("trigger_insert_only", `${tname}: على الإدراج وحده — تغيير asset_id في صفّ قائم يتجاوز الحجز`);
    }
    if (!/on\s+public\.custody_inventory_assignment_items/i.test(when)) {
      fail("trigger_wrong_table", `${tname}: ليس على custody_inventory_assignment_items`);
    }
    if (tfn !== "civ_item_hold_check") fail("trigger_wrong_fn", `${tname}: يستدعي ${tfn}`);
  }
  if (!/on_hold\s*=\s*true/i.test(runBodies)) fail("hold_check_absent", "دالّة المُشغِّل لا تفحص on_hold");

  // ── ٤ · ربط الحادثة بالأصل — fail-closed ────────────────────────────────
  const reportFn = fnBody(run, "custody_inv_employee_report_incident");
  if (!reportFn) fail("report_fn_missing", "دالّة بلاغ الموظّف غير موجودة");
  else {
    if (!/not_your_assignment/.test(reportFn)) fail("link_assignment", "لا تحقّق من ملكية العهدة");
    if (!/asset_not_in_assignment/.test(reportFn)) {
      fail("link_asset_in_assignment", "أصل + عهدة: لا تحقّق من أنّ الأصل بندٌ في تلك العهدة");
    }
    if (!/asset_not_yours/.test(reportFn)) {
      fail("link_asset_owner", "أصل وحده: لا تحقّق من أنّه ضمن عهدة لهذا الموظّف");
    }
    if (!/raise\s+exception\s+'unauthenticated'/.test(reportFn)) fail("report_anon", "لا رفض للمجهول");
  }

  // ── ٥ · رفع الحجز بصلاحية وطلب صريح ─────────────────────────────────────
  const adminFn = fnBody(run, "custody_inv_admin_incident_action");
  if (!adminFn) fail("admin_fn_missing", "دالّة إجراء الإدارة غير موجودة");
  else {
    if (!/if\s+not\s+public\.civ_can_manage\(\)\s*then\s*raise\s+exception/i.test(adminFn)) {
      fail("release_no_permission", "رفع الحجز بلا حارس civ_can_manage()");
    }
    if (!/coalesce\(\s*p_release_hold\s*,\s*false\s*\)/i.test(adminFn)) {
      fail("release_not_explicit", "رفع الحجز ليس مشروطًا بـp_release_hold صراحةً");
    }
    // ⚠️ لا تُترك حالة `on_hold=false` مع سبب حجز معلّق.
    const rel = adminFn.match(/set\s+on_hold\s*=\s*false[^;]*/i);
    if (rel && !/hold_reason\s*=\s*null/i.test(rel[0])) {
      fail("hold_reason_stale", "تحرير الحجز لا يُصفّر hold_reason");
    }
    if (/delete\s+from\s+public\.custody_incidents/i.test(adminFn)) {
      fail("hard_delete", "حذف فعليّ للحوادث بدل is_deleted");
    }
  }
  if (/delete\s+from\s+public\.custody_incidents/i.test(run)) {
    fail("hard_delete_pkg", "الحزمة تحذف حوادث فعليًّا");
  }

  // ── ٦ · SECURITY DEFINER آمنة ───────────────────────────────────────────
  for (const [name, header] of createdFunctions(run)) {
    if (!/security\s+definer/i.test(header)) continue;   // غير definer ⇒ لا شرط
    if (!/set\s+search_path\s*=\s*public\b/i.test(header)) {
      fail("search_path", `${name}: SECURITY DEFINER بلا search_path مثبَّت`);
    }
    if (/search_path\s*=\s*[^;]*pg_temp/i.test(header)) fail("pg_temp", `${name}: pg_temp في search_path`);
  }

  // ── ٧ · RLS على الجداول الثلاثة ─────────────────────────────────────────
  const tables = createdTables(run);
  for (const t of tables) {
    const re = new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i");
    if (!re.test(run)) fail("rls_off", `${t}: RLS غير مفعَّل`);
  }
  for (const m of run.matchAll(/create\s+policy\s+(\w+)\s+on\s+public\.(\w+)[\s\S]*?using\s*\(([^;]*?)\)\s*;/gi)) {
    if (/^\s*true\s*$/i.test(m[3])) fail("policy_open", `${m[1]}: سياسة مفتوحة (using (true))`);
  }

  // ── ٨ · الصلاحيات ───────────────────────────────────────────────────────
  for (const m of run.matchAll(/grant\s+([a-z ,]+?)\s+on\s+(?:function\s+)?([\s\S]*?)\s+to\s+([a-z_, ]+);/gi)) {
    const roles = m[3].split(",").map((r) => r.trim().toLowerCase());
    const targets = m[2];
    for (const r of roles) {
      if (r === "public" || r === "anon") {
        fail("grant_anon", `منح لـ${r} على ${targets.slice(0, 60).trim()}`);
      }
    }
    if (/custody_run_alerts/i.test(targets)) {
      for (const r of roles) {
        if (r !== "service_role") fail("run_alerts_grant", `custody_run_alerts ممنوحة لـ${r}`);
      }
    }
  }
  if (!/grant\s+execute\s+on\s+function\s+public\.custody_run_alerts\(\)\s+to\s+service_role/i.test(run)) {
    fail("run_alerts_no_service", "custody_run_alerts غير ممنوحة لـservice_role");
  }
  for (const fnName of ["custody_run_alerts", "civ_alert_once", "civ_item_hold_check"]) {
    const re = new RegExp(`revoke\\s+execute\\s+on\\s+function\\s+public\\.${fnName}\\([^)]*\\)\\s+from\\s+([a-z_, ]+);`, "i");
    const m = run.match(re);
    if (!m) fail("no_revoke", `${fnName}: لا REVOKE صريح`);
    else {
      const roles = m[1].split(",").map((r) => r.trim().toLowerCase());
      for (const need of ["public", "anon", "authenticated"]) {
        if (!roles.includes(need)) fail("revoke_partial", `${fnName}: لم يُسحب من ${need}`);
      }
    }
  }

  // ── ٨-ب · ACL الجداول: سحبٌ شامل أوّلًا ثمّ قراءة وحدها ──────────────────
  // 🔴 Preview أثبت أنّ الجداول تولد ومعها Dxtm لـanon **بلا منحة من الحزمة**.
  //    فالمنح تراكميّ: `grant select` وحده لا يُصلح شيئًا.
  const revokeAll = runTop.match(/revoke\s+all\s+privileges\s+on\s+table([\s\S]*?)from\s+([a-z_, ]+);/i);
  if (!revokeAll) fail("no_revoke_all", "RUNME لا يسحب ACL الافتراضيّ عن جداول الحزمة");
  else {
    const roles = revokeAll[2].split(",").map((r) => r.trim().toLowerCase());
    for (const need of ["public", "anon", "authenticated"]) {
      if (!roles.includes(need)) fail("revoke_all_partial", `revoke all لا يشمل ${need}`);
    }
    for (const t of tables) {
      if (!revokeAll[1].includes(t)) fail("revoke_all_table", `revoke all لا يشمل ${t}`);
    }
    // ⚠️ والسحب قبل المنح: العكس يمحو المنحة المقصودة.
    const iRevoke = runTop.search(/revoke\s+all\s+privileges\s+on\s+table/i);
    const iGrant = runTop.search(/grant\s+select\s+on\s+table/i);
    if (iGrant !== -1 && iGrant < iRevoke) fail("grant_before_revoke", "المنح قبل السحب — يُلغى فورًا");
  }
  const tblGrants = [...runTop.matchAll(/grant\s+([a-z ,]+?)\s+on\s+table([\s\S]*?)to\s+([a-z_, ]+);/gi)];
  for (const g of tblGrants) {
    const privs = g[1].split(",").map((p) => p.trim().toLowerCase());
    const roles = g[3].split(",").map((r) => r.trim().toLowerCase());
    if (roles.includes("authenticated") && privs.some((p) => p !== "select")) {
      fail("authenticated_write", `authenticated يُمنح أكثر من SELECT: ${privs.join(",")}`);
    }
  }
  if (!/grant\s+select\s+on\s+table[\s\S]*?to\s+authenticated\s*;/i.test(runTop)) {
    fail("no_select_grant", "authenticated بلا SELECT — الواجهة تُحجب عند طبقة الصلاحيات قبل RLS");
  }

  // ── ٩ · PREFLIGHT — توقّعاته مشتقّة من **RUNME** ─────────────────────────
  const pre = stripComments(F[PRE]);
  if (!/raise\s+exception/i.test(pre)) fail("pre_no_hardstop", "PREFLIGHT لا يرفع استثناء — يطبع 🔴 ويخرج بحالة 0");
  for (const t of requiredTables(runRaw)) {
    if (!new RegExp(`'${t}'`).test(pre)) fail("pre_missing_table", `PREFLIGHT لا يفحص الاعتماد ${t}`);
  }
  for (const sig of requiredGates(runRaw)) {
    if (!pre.includes(`'${sig}'`)) fail("pre_missing_gate", `PREFLIGHT لا يفحص البوّابة ${sig}`);
  }
  for (const t of tables) {
    if (!new RegExp(`'${t}'`).test(pre)) fail("pre_missing_absent", `PREFLIGHT لا يُصنّف ${t} ضمن APPLY_STATE`);
  }
  // 🔴 الحزمة مطبَّقة فعلًا على Preview: اشتراط الغياب يحوّل أيّ إصلاح لاحق
  //    إلى إسقاط جداول. فالمطلوب تصنيف حالة لا شرط غياب.
  if (!/APPLY_STATE/.test(pre)) fail("pre_no_apply_state", "PREFLIGHT لا يُصنّف حالة التطبيق");
  if (!/FRESH_APPLY/.test(pre)) fail("pre_no_fresh", "PREFLIGHT لا يعترف بحالة التطبيق الأوّل");
  if (!/MATCHING_REAPPLY/.test(pre)) fail("pre_no_reapply", "PREFLIGHT يرفض حالة مطبَّقة مطابقة");
  if (!/PARTIAL/.test(pre)) fail("pre_no_partial", "PREFLIGHT لا يوقف عند حالة جزئية");
  if (!/DEFINITION_MATCH/.test(pre) || !/MISMATCH/.test(pre)) {
    fail("pre_no_mismatch", "PREFLIGHT لا يوقف عند جدول يحمل الاسم بتعريف مخالف");
  }
  if (!/not in \(0, 3\)|not in \(0,3\)/.test(pre)) {
    fail("pre_partial_not_enforced", "تصنيف PARTIAL معروض ولا يُحتسب في الحسم");
  }
  if (!/pg_default_acl/.test(pre)) fail("pre_no_defacl", "PREFLIGHT لا يقرأ مصدر المنح التلقائيّ");
  // حالة جزئية غير معروفة: عمود قائم بنوع مختلف · مُشغِّل قائم على جدول آخر.
  if (!/EXISTING_COLUMN_STATE/.test(pre)) fail("pre_no_column_state", "PREFLIGHT لا يفحص حالة الأعمدة القائمة");
  if (!/EXISTING_TRIGGER_STATE/.test(pre)) fail("pre_no_trigger_state", "PREFLIGHT لا يفحص حالة المُشغِّل القائم");
  if (!/PARALLEL_CHECK/.test(pre)) fail("pre_no_parallel", "PREFLIGHT لا يفحص الأنظمة الموازية");

  // ── ١٠ · POSTCHECK — يُثبت لا يطبع ──────────────────────────────────────
  const post = stripComments(F[POST]);
  if (!/raise\s+exception/i.test(post)) fail("post_no_hardstop", "POSTCHECK لا يرفع استثناء");
  for (const [name] of createdFunctions(run)) {
    if (!post.includes(name)) fail("post_missing_fn", `POSTCHECK لا يتحقّق من ${name}`);
  }
  for (const t of tables) {
    if (!post.includes(t)) fail("post_missing_table", `POSTCHECK لا يتحقّق من ${t}`);
  }
  if (!/relrowsecurity|row_security|rowsecurity/i.test(post)) fail("post_no_rls", "POSTCHECK لا يتحقّق من RLS");
  if (!/has_function_privilege/i.test(post)) fail("post_no_privs", "POSTCHECK لا يقيس الصلاحيات الفعلية");
  if (!/tgtype\s*&\s*4/.test(post) || !/tgtype\s*&\s*16/.test(post)) {
    fail("post_no_tgtype", "POSTCHECK لا يُثبت أنّ المُشغِّل على INSERT **و**UPDATE");
  }
  if (!/cron/i.test(post)) fail("post_no_cron", "POSTCHECK لا يُثبت غياب cron");

  // ── ١٠-ب · ACL فعليّ لا معلَن ────────────────────────────────────────────
  if (!/has_table_privilege/.test(post)) fail("post_acl_shallow", "POSTCHECK لا يقيس صلاحيات الجداول الفعليّة");
  if (!/has_any_column_privilege/.test(post)) fail("post_no_column_acl", "POSTCHECK لا يفحص ACL الأعمدة");
  if (!/aclexplode/.test(post)) fail("post_no_public_acl", "POSTCHECK لا يفحص PUBLIC من الكتالوج");
  for (const p of ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
    if (!post.includes(p)) fail("post_missing_priv", `POSTCHECK لا يفحص ${p} — وهو من Dxtm المرصود`);
  }
  // ⚠️ MAINTAIN غير موجودة قبل PostgreSQL 17: تمريرها لخادم أقدم خطأ لا نتيجة.
  if (/MAINTAIN/.test(post) && !/server_version_num/.test(post)) {
    fail("post_no_version_guard", "MAINTAIN تُفحص بلا حارس إصدار");
  }
  if (!/'SELECT'/.test(post)) fail("post_no_select_contract", "POSTCHECK لا يُثبت SELECT لـauthenticated");

  // ── ١٠-ب-٢ · بناء قائمة الصلاحيات: صياغة صالحة + الحارس + MAINTAIN ──────
  // 🔴 هذا هو العطب الذي أوقف POSTCHECK على Preview فعليًّا، ويُفحص هنا
  //    **بمحاكاة البلوك** لا بمطابقة نصّ: القاعدة هي قاعدة PostgreSQL.
  for (const f of PKG_FILES) {
    for (const hit of arrayLiteralAppends(F[f])) {
      fail("array_literal_append",
        `${f}:${hit.line} — «${hit.varName} || 'نصّ'» يُفسَّر حرفيّةَ مصفوفة: ${hit.text.slice(0, 70)}`);
    }
  }
  try {
    const pg16 = simulatePrivList(F[POST], 160000);
    const pg17 = simulatePrivList(F[POST], 170000);
    const base = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
    for (const p of base) {
      if (!pg16.includes(p)) fail("priv_list_incomplete", `قائمة الفحص بلا ${p}`);
    }
    // 🔴 MAINTAIN أُضيفت في PostgreSQL 17: أيّ عتبة أدنى تُمرّرها إلى خادم
    //    يرمي «unrecognized privilege type» — وهو خطأ لا نتيجة سالبة.
    if (pg16.includes("MAINTAIN")) fail("maintain_unguarded", "MAINTAIN تُفحص على خادم أقدم من 17");
    if (!pg17.includes("MAINTAIN")) fail("maintain_missing", "MAINTAIN لا تُفحص على PostgreSQL 17+");
  } catch (e) {
    if (e instanceof MalformedArrayLiteral) fail("array_literal_append", `بناء v_privs يفشل: ${e.message}`);
    else fail("priv_list_unparsable", `تعذّر تتبّع بناء v_privs: ${e.message}`);
  }

  // ── ١٠-ج · Cron: حارس to_regclass ثمّ SQL ديناميكيّ ──────────────────────
  // 🔴 `case when to_regclass('cron.job') is null then … when (select … from
  //    cron.job)` **لا يحرس شيئًا**: الجملة تُحلَّل كاملةً قبل التنفيذ.
  const postCron = post.match(/(?:from|join)\s+cron\.\w+/gi) ?? [];
  for (const m of postCron) {
    // مسموح فقط داخل نصّ يُنفَّذ ديناميكيًّا (execute).
    const at = post.indexOf(m);
    const ctx = post.slice(Math.max(0, at - 300), at);
    if (!/execute\s/i.test(ctx)) fail("post_cron_static", `استعلام ثابت على ${m.trim()} — يفشل بالتحليل إن غاب pg_cron`);
  }
  if (!/to_regclass\(\s*'cron\.job'\s*\)/i.test(post)) fail("post_cron_no_guard", "POSTCHECK بلا حارس to_regclass على cron.job");
  // ⛔ وغياب الامتداد ليس فشلًا.
  const cronBlock = post.slice(post.search(/to_regclass\(\s*'cron\.job'\s*\)/i));
  const cronHead = cronBlock.slice(0, cronBlock.search(/end \$\$/i) + 1);
  if (/is\s+null\s+then[\s\S]{0,120}raise\s+exception/i.test(cronHead)) {
    fail("post_cron_absence_fails", "غياب pg_cron يُعامَل كفشل");
  }
  if (/create\s+(extension|schema)/i.test(post)) {
    fail("post_creates", "POSTCHECK يُنشئ امتدادًا أو مخطّطًا — والفحص يقرأ ولا يكتب");
  }

  // ── ١٠-د · إصلاح الصلاحيات لا يمرّ عبر الإسقاط ──────────────────────────
  // 🔴 الحزمة مطبَّقة على Preview وجداولها قد تحمل بلاغات حقيقية. فإصلاح ACL
  //    بإسقاط الجدول أو حذف صفوفه ليس إصلاحًا بل خسارة.
  for (const t of tables) {
    if (new RegExp(`drop\\s+table\\s+(?:if\\s+exists\\s+)?public\\.${t}`, "i").test(run)) {
      fail("runme_drops_table", `RUNME يُسقط ${t} — إعادة التطبيق تمحو البيانات`);
    }
    if (new RegExp(`(?:truncate|delete\\s+from)\\s+(?:table\\s+)?public\\.${t}`, "i").test(runTop)) {
      fail("runme_truncates", `RUNME يمحو صفوف ${t}`);
    }
  }

  // ── ١١ · `to_regproc` بتوقيع = فحص كاذب دائمًا ──────────────────────────
  for (const f of PKG_FILES) {
    const t = stripComments(F[f]);
    if (/to_regproc\(\s*'[a-z0-9_.]+\([^']*\)'/i.test(t)) fail("to_regproc_sig", `${f}: to_regproc بتوقيع حرفيّ`);
    if (/to_regproc\(\s*(?:[a-z_][a-z0-9_]*\.)?(?:sig|v_sig)\s*\)/i.test(t)) fail("to_regproc_var", `${f}: to_regproc(<متغيّر توقيع>)`);
  }

  // ── ١٢ · ROLLBACK لا يمحو بيانات حقيقية ─────────────────────────────────
  const roll = stripComments(F[ROLL]);
  const firstDrop = roll.search(/drop\s+table/i);
  const guard = roll.search(/raise\s+exception/i);
  if (firstDrop === -1) fail("roll_no_drop", "ROLLBACK لا يُسقط شيئًا");
  if (guard === -1 || (firstDrop !== -1 && guard > firstDrop)) {
    fail("roll_no_guard", "ROLLBACK يُسقط جداول قبل حارس «غير فارغة»");
  }
  const head = firstDrop === -1 ? roll : roll.slice(0, firstDrop);
  for (const t of tables) {
    if (!head.includes(t)) fail("roll_guard_partial", `حارس ROLLBACK لا يشمل ${t}`);
  }
  if (/drop\s+column[^;]*on_hold/i.test(roll)) fail("roll_drops_hold", "ROLLBACK يُسقط on_hold تلقائيًّا");
  for (const m of roll.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?public\.(\w+)/gi)) {
    if (!tables.includes(m[1])) fail("roll_foreign_table", `ROLLBACK يُسقط جدولًا ليس من الحزمة: ${m[1]}`);
  }

  return bad;
}

// ════════════════════════════════════════════════════════════════════════════
// محاكاة بناء المصفوفات في plpgsql — بقاعدة PostgreSQL الفعليّة
//
// 🔴 `text[] || 'X'` **ليس** إلحاق عنصر. لمعامل `||` ثلاثة تحمّلات
//    (`anyarray||anyelement` · `anyelement||anyarray` · `anyarray||anyarray`)،
//    والحرف غير المُنمَّط يُحسم لصالح الأخير ⇒ يُفسَّر النصّ حرفيّةَ مصفوفة:
//        ERROR: malformed array literal: "MAINTAIN"
//    وهذا ما أوقف POSTCHECK على Preview.
// ✅ الصيغ الصحيحة: `array_append(x,'X')` · `x || array['X']` · `x || (expr)`
//    حيث `expr` نصّ **مُنمَّط** (نتيجة `||` بين حرف ومتغيّر text مثلًا).
// ════════════════════════════════════════════════════════════════════════════
class MalformedArrayLiteral extends Error {}

/** كل موضع يُلحق حرفًا غير مُنمَّط بمصفوفة — أي كل تكرار للعطب. */
function arrayLiteralAppends(sql) {
  const out = [];
  const lines = stripComments(sql).split("\n");
  lines.forEach((ln, i) => {
    const m = ln.match(/(v_[a-z_]+)\s*:=\s*\1\s*\|\|\s*'/);
    if (m) out.push({ line: i + 1, varName: m[1], text: ln.trim() });
  });
  return out;
}

/**
 * يُحاكي بناء `v_privs` داخل بلوك صلاحيات الجداول ويُعيد القائمة الفعليّة.
 * يرمي `MalformedArrayLiteral` تمامًا حيث يرمي PostgreSQL.
 * @param {number} serverVersionNum قيمة `server_version_num` المُحاكاة (16 ⇒ 160000).
 *   ⚠️ عدد لا منطقيّ **عمدًا**: العتبة المكتوبة في الملفّ هي ما يُقاس، فتغييرها
 *   إلى 160000 يُرصد بدل أن يمرّ كما لو كان الحارس سليمًا.
 */
function simulatePrivList(postSql, serverVersionNum) {
  const code = stripComments(postSql);
  const seed = code.match(/v_privs\s*:=\s*array\[([^\]]*)\]/i);
  if (!seed) throw new Error("لم يُعثر على تهيئة v_privs");
  let privs = [...seed[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  // الحارس: MAINTAIN لا تُضاف إلّا على 17+.
  const guard = code.match(
    /if\s+current_setting\('server_version_num'\)::int\s*>=\s*(\d+)\s*then([\s\S]*?)end if;/i,
  );
  // ⛔ بلا حارس ⇒ يُطبَّق على كل إصدار (وهو بالضبط العطب الذي يُرصد).
  const applies = guard ? serverVersionNum >= Number(guard[1]) : true;
  const body = guard ? guard[2] : code.slice(seed.index + seed[0].length);

  for (const st of body.split(";")) {
    const bad = st.match(/v_privs\s*:=\s*v_privs\s*\|\|\s*'([^']+)'/);
    if (bad) throw new MalformedArrayLiteral(`malformed array literal: "${bad[1]}"`);
    const ok = st.match(/v_privs\s*:=\s*array_append\(\s*v_privs\s*,\s*'([^']+)'\s*\)/)
            ?? st.match(/v_privs\s*:=\s*v_privs\s*\|\|\s*array\[\s*'([^']+)'\s*\]/i);
    if (ok && applies) privs = [...privs, ok[1]];
  }
  return privs;
}

// ─── مُستخرِجات من RUNME (مصدر الحقيقة) ────────────────────────────────────
/** جسم دالّة باسمها. */
function fnBody(runCode, name) {
  const i = runCode.search(new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\b`, "i"));
  if (i === -1) return null;
  const m = runCode.slice(i).match(/\$\$([\s\S]*?)\$\$/);
  return m ? m[1] : null;
}
/** `[[name, header]]` لكل دالّة تُنشئها الحزمة — header = ما بين الاسم والجسم. */
function createdFunctions(runCode) {
  return [...runCode.matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(([\s\S]*?)\)\s*returns([\s\S]*?)\$\$/gi)]
    .map((m) => [m[1], m[3]]);
}
/** الجداول التي تُنشئها الحزمة. */
function createdTables(runCode) {
  return [...runCode.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]);
}
/** §0 من RUNME: الجداول المطلوبة. */
function section0(runRaw) {
  const a = runRaw.indexOf("§0");
  const b = runRaw.indexOf("§1");
  return a === -1 ? runRaw : runRaw.slice(a, b === -1 ? undefined : b);
}
function requiredTables(runRaw) {
  const s = section0(runRaw);
  return [...s.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])
    .filter((x) => !x.includes("(") && !["TABLE ", "GATE "].includes(x) && /^[a-z][a-z0-9_]*$/.test(x));
}
function requiredGates(runRaw) {
  const s = section0(runRaw);
  return [...s.matchAll(/'(public\.[a-z0-9_]+\([^']*\))'/g)].map((m) => m[1]);
}

module.exports = {
  RUNME, PRE, POST, ROLL, PKG_FILES,
  auditPackage, stripComments, stripBodies,
  MalformedArrayLiteral, arrayLiteralAppends, simulatePrivList,
  createdFunctions, createdTables, requiredTables, requiredGates, fnBody,
};
