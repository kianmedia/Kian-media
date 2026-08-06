// ════════════════════════════════════════════════════════════════════════════
// tests/custody_incidents_release_package.test.js
//
// عقد حزمة `custody_enterprise_incidents_*` — الحزمة التي حلّت محلّ
// `custody_enterprise_03_incidents_alerts_PATCH.sql`، وصارت **prerequisite
// رسميًّا** قبل `wave6_compliance_knowledge_RUNME.sql`.
//
// ما تحرسه هذه الملفّات مجتمعةً (والطفرات في الملفّ المرافق تُثبت أنّه محروس):
//   ذرّية المعاملة · الحسم الفعليّ في PREFLIGHT/POSTCHECK · `to_regprocedure` ·
//   RLS · منع anon/PUBLIC · `custody_run_alerts` لـservice_role وحده ·
//   مُشغِّل الحجز على INSERT **و**UPDATE · ربط الحادثة بأصل الموظّف ·
//   رفع الحجز بصلاحية · لا بذور ولا تنبيهات أثناء التطبيق · ROLLBACK محروس.
//
// ⛔ لا قاعدة ولا شبكة ولا SQL يُنفَّذ.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./custody_incidents_helpers.js");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const R = (f) => fs.readFileSync(path.join(DOCS, f), "utf8");

// ─── ١ · العقد كاملًا على الحزمة الحقيقية ──────────────────────────────────
test("🔴 حزمة الحوادث تجتاز عقدها كاملًا", () => {
  const bad = H.auditPackage(DOCS, ROOT);
  assert.deepEqual(bad, [], "أعطاب:\n" + bad.map((b) => `  [${b.id}] ${b.msg}`).join("\n"));
});

// ─── ٢ · الملفّات الأربعة موجودة والـPATCH موقوف ───────────────────────────
test("الحزمة أربعة ملفّات بالعقد المعتاد", () => {
  for (const f of H.PKG_FILES) {
    assert.ok(fs.existsSync(path.join(DOCS, f)), `مفقود: ${f}`);
  }
});

test("🔴 ملفّ الـPATCH موسوم SUPERSEDED ولا يُشغَّل", () => {
  const patch = R("custody_enterprise_03_incidents_alerts_PATCH.sql");
  const head = patch.slice(0, 1200);
  assert.match(head, /SUPERSEDED/i, "الـPATCH غير موسوم بأنّه متجاوَز");
  assert.match(head, /لا يُشغَّل/, "الـPATCH لا يذكر صراحةً أنّه لا يُشغَّل");
  // 🔴 وسببُ التجاوز الحقيقيّ باقٍ فيه: ثلاث معاملات مستقلّة.
  const tx = (H.stripBodies(H.stripComments(patch)).match(/\bcommit\s*;/gi) ?? []).length;
  assert.ok(tx > 1, `الـPATCH كان يجب أن يحوي أكثر من COMMIT (وجد ${tx}) — وإلّا فالتوصيف خاطئ`);
});

// ─── ٣ · ترتيب الإصدار: الحزمة **قبل** حزمة الامتثال ───────────────────────
/** يستخرج ترتيب التشغيل من مصفوفة الإصدار (نفس ما يقرؤه release-doctor). */
function runOrder() {
  const m = fs.readFileSync(path.join(DOCS, "release/SQL_RELEASE_SELECTION_MATRIX.md"), "utf8");
  const block = m.split("PROPOSED PRODUCTION RUN ORDER")[1] ?? "";
  const fence = block.match(/```[\s\S]*?```/);
  assert.ok(fence, "كتلة الترتيب مفقودة من المصفوفة");
  return [...fence[0].matchAll(/([a-z0-9_]+\.sql)/gi)].map((x) => x[1]);
}

test("🔴 custody_enterprise_incidents قبل wave6_compliance_knowledge في الترتيب", () => {
  const order = runOrder();
  const i = order.indexOf(H.RUNME);
  const j = order.indexOf("wave6_compliance_knowledge_RUNME.sql");
  assert.ok(i !== -1, "حزمة الحوادث ليست في ترتيب التشغيل");
  assert.ok(j !== -1, "حزمة الامتثال ليست في ترتيب التشغيل");
  assert.ok(i < j, `الترتيب معكوس: الحوادث ${i} · الامتثال ${j}`);
});

test("⛔ ملفّ الـPATCH ليس في أيّ ترتيب تشغيل", () => {
  const order = runOrder();
  assert.ok(!order.some((f) => /custody_enterprise_03/.test(f)),
    "الـPATCH المتجاوَز ما زال في ترتيب التشغيل");
});

// ─── ٤ · الاعتماد الحقيقيّ: الامتثال يقرأ custody_incidents بلا حارس ───────
// 🔴 هذا هو **سبب** كون الحزمة prerequisite — يُثبت من ملفّ الامتثال نفسه لا
//    من ادّعاء في وثيقة.
test("🔴 hse_register_v تقرأ custody_incidents في فرع غير محروس", () => {
  const ck = H.stripComments(R("wave6_compliance_knowledge_RUNME.sql"));
  assert.match(ck, /public\.custody_incidents/,
    "حزمة الامتثال لا تشير إلى custody_incidents — فالاعتماد المزعوم لا أساس له");
  // ⛔ ولا حارس وجود من نوع to_regclass حول الفرع.
  assert.ok(!/to_regclass\s*\(\s*'public\.custody_incidents'/i.test(ck),
    "صار هناك حارس وجود — راجع تصنيف الاعتماد");
});

test("🔴 PREFLIGHT الامتثال يسمّي منشئ custody_incidents", () => {
  const p = R("wave6_compliance_knowledge_PREFLIGHT.sql");
  assert.match(p, /custody_enterprise_incidents_RUNME\.sql/,
    "PREFLIGHT الامتثال لا يذكر مَن يُنشئ custody_incidents");
  // ⛔ ولا يُنسخ تعريف الجدول إلى حزمة الامتثال.
  assert.ok(!/create\s+table[^;]*custody_incidents/i.test(R("wave6_compliance_knowledge_RUNME.sql")),
    "حزمة الامتثال تُنشئ custody_incidents — تعريفان لنفس الجدول");
});

// ─── ٥ · مالك واحد للجدول عبر المستودع كلّه ────────────────────────────────
test("🔴 لا حزمة أخرى تُنشئ custody_incidents", () => {
  const owners = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    const t = H.stripComments(fs.readFileSync(path.join(DOCS, f), "utf8"));
    if (/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.custody_incidents\b/i.test(t)) owners.push(f);
  }
  assert.deepEqual(owners.sort(), ["custody_enterprise_03_incidents_alerts_PATCH.sql", H.RUNME].sort(),
    "مُنشئو custody_incidents: " + owners.join(" · "));
});

// ─── ٦ · اعتمادات مُثبتة لا مفترَضة ────────────────────────────────────────
test("🔴 كل بوّابة يشترطها §0 موجودة فعلًا في المستودع", () => {
  // ⚠️ قائمة المهمّة الأصلية ذكرت `civ_is_staff()` — **ولا وجود لها**؛ الاسم
  //    الحقيقيّ `is_staff()`. فتُشتقّ الاعتمادات من المُنشئين لا من القوائم.
  const all = fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))
    .map((f) => H.stripComments(fs.readFileSync(path.join(DOCS, f), "utf8"))).join("\n");
  const gates = H.requiredGates(R(H.RUNME));
  assert.ok(gates.length >= 5, `§0 يفحص ${gates.length} بوّابات فقط`);
  for (const sig of gates) {
    const name = sig.replace(/^public\./, "").replace(/\(.*$/, "");
    const re = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+public\\.${name}\\s*\\(`, "i");
    assert.match(all, re, `البوّابة ${sig} لا مُنشئ لها في المستودع`);
  }
});

test("⛔ لا civ_is_staff — الاسم الحقيقيّ is_staff", () => {
  const run = H.stripComments(R(H.RUNME));
  assert.ok(!/civ_is_staff/.test(run), "RUNME يستدعي دالّة لا وجود لها");
  assert.match(run, /public\.is_staff\(\)/, "RUNME لا يستعمل بوّابة الموظّفين الحقيقية");
});

// ─── ٧ · جداول الحزمة الثلاثة بالضبط ───────────────────────────────────────
test("الحزمة تُنشئ ثلاثة جداول لا أكثر", () => {
  const t = H.createdTables(H.stripComments(R(H.RUNME)));
  assert.deepEqual(t.sort(),
    ["custody_alert_deliveries", "custody_incident_actions", "custody_incidents"]);
});

test("تفرّد incident_number وdedup_key", () => {
  const run = H.stripComments(R(H.RUNME));
  assert.match(run, /incident_number\s+text\s+not\s+null\s+unique/i, "incident_number بلا تفرّد");
  assert.match(run, /dedup_key\s+text\s+not\s+null\s+unique/i, "dedup_key بلا تفرّد");
  // ⚠️ إزالة التكرار تعتمد على قيد التفرّد نفسه — لا فحص-ثمّ-إدراج.
  const once = H.fnBody(run, "civ_alert_once");
  assert.ok(once, "civ_alert_once مفقودة");
  assert.match(once, /exception\s+when\s+unique_violation\s+then\s+return\s+false/i,
    "إزالة التكرار ليست بالتقاط unique_violation");
  assert.ok(!/if\s+not\s+exists\s*\(\s*select[^)]*custody_alert_deliveries/i.test(once),
    "فحص-ثمّ-إدراج: سباق تحت التزامن");
});

// ─── ٨ · القرار المفتوح مسجَّل لا مطموس ────────────────────────────────────
test("🔵 `when others then return false` مُبقًى **موثَّقًا** كقرار مفتوح", () => {
  const raw = R(H.RUNME);
  const once = H.fnBody(H.stripComments(raw), "civ_alert_once");
  assert.match(once, /when\s+others\s+then\s+return\s+false/i, "السلوك تغيّر بلا اختبار على قاعدة");
  assert.match(raw, /when others then return false[\s\S]{0,400}?قرار مفتوح|قرار مفتوح[\s\S]{0,400}?when others/,
    "التغيير مؤجَّل لكنّه غير موثَّق كقرار مفتوح");
});

// ─── ٩ · عقد الصلاحيات النهائيّ — دورًا دورًا ──────────────────────────────
// 🔴 مصدر التوقّع هنا هو **الحالة المرصودة على Preview**، لا ملفّ من الحزمة:
//    anon = Dxtm · authenticated = rDxtm بعد RUNME ناجح، ⛔ وبلا منحة واحدة
//    لـanon في الملفّ. أيّ حرف من Dxtm يجب أن يكون مسحوبًا ومفحوصًا.
const DXTM = { D: "TRUNCATE", x: "REFERENCES", t: "TRIGGER", m: "MAINTAIN" };

test("🔴 كل حرف من Dxtm مسحوب في RUNME ومفحوص في POSTCHECK", () => {
  const run = H.stripComments(R(H.RUNME));
  const post = H.stripComments(R(H.POST));
  // السحب شامل (`revoke all`) لا تعدادًا يدويًّا قد ينسى حرفًا.
  assert.match(run, /revoke\s+all\s+privileges\s+on\s+table/i, "لا سحب شامل");
  for (const [ch, priv] of Object.entries(DXTM)) {
    assert.ok(post.includes(priv), `POSTCHECK لا يفحص ${priv} (${ch} في Dxtm)`);
  }
});

test("🔴 authenticated: SELECT فقط — العقد صراحةً في POSTCHECK", () => {
  const post = H.stripComments(R(H.POST));
  assert.match(post, /authenticated[\s\S]{0,200}SELECT/i, "لا شرط SELECT لـauthenticated");
  assert.match(post, /has_table_privilege\('authenticated'/, "لا قياس فعليّ لـauthenticated");
  assert.match(post, /قراءة فقط|SELECT فقط/, "العقد غير مذكور نصًّا");
});

test("⛔ لا منحة واحدة لـanon على أيّ كائن من الحزمة", () => {
  const run = H.stripComments(R(H.RUNME));
  for (const m of run.matchAll(/grant\s[\s\S]*?to\s+([a-z_, ]+);/gi)) {
    const roles = m[1].split(",").map((r) => r.trim().toLowerCase());
    assert.ok(!roles.includes("anon") && !roles.includes("public"),
      `منحة لـ${roles.join(",")}: ${m[0].slice(0, 80)}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٩-ب · عقد service_role — القرار من **مسح المستهلكين** لا من ملفّ SQL
//
// ★ ما أوقف POSTCHECK على Preview ★ اشتراطُ `SELECT` لـservice_role. والـACL
//   الافتراضيّ للمُنشئ postgres على public هو
//   `anon=Dxtm · authenticated=Dxtm · service_role=Dxtm` — ⛔ ولا SELECT فيه.
//   فالفحص كان يشترط امتيازًا لا يمنحه أحد ولا يحتاجه أحد.
// ════════════════════════════════════════════════════════════════════════════
test("🔴 مسح المستودع: هل يقرأ service_role الجداول الثلاثة مباشرةً؟", () => {
  const consumers = H.serviceRoleTableConsumers(ROOT);
  // ⚠️ إن سقط هذا يومًا، فالمطلوب **منح SELECT** لا تعطيل الاختبار.
  assert.deepEqual(consumers, [],
    "ظهر مستهلك خادميّ مباشر ⇒ أضِف `grant select … to service_role` في RUNME واشترطه في POSTCHECK:\n"
    + consumers.map((c) => `  ${c.file}:${c.line} → ${c.table}`).join("\n"));
});

test("⛔ POSTCHECK لا يشترط SELECT لـservice_role (ولا RUNME يمنحه)", () => {
  const post = H.stripComments(R(H.POST));
  assert.ok(!/if\s+not\s+has_table_privilege\('service_role'[^)]*'SELECT'\)/.test(post),
    "اشتراطُ SELECT بلا مستهلك يجعل POSTCHECK يفشل دائمًا على ACL افتراضيّ سليم");
  const runTop = H.stripBodies(H.stripComments(R(H.RUNME)));
  assert.ok(!/grant\s+select[\s\S]{0,200}?to\s+[a-z_, ]*service_role/i.test(runTop),
    "RUNME يوسّع ACL بلا مستهلك");
});

test("🔴 البديل مُبرهَن: EXECUTE **و** مالك SECURITY DEFINER يقرأ", () => {
  const post = H.stripComments(R(H.POST));
  // ⛔ وEXECUTE على دالّة ليس SELECT على جدول: الطرفان معًا أو لا برهان.
  assert.match(post, /has_function_privilege\('service_role','public\.custody_run_alerts\(\)','EXECUTE'\)/,
    "لا إثبات لـEXECUTE على المحرّك");
  assert.match(post, /prosecdef/, "لا إثبات لـSECURITY DEFINER");
  assert.match(post, /pg_get_userbyid\(p\.proowner\)/, "لا استخراج لمالك الدوالّ");
  assert.match(post, /has_table_privilege\(v_owner/, "لا إثبات لقراءة المالك للجداول");
});

test("service_role: Dxtm الموروثة تُبلَّغ ولا تُفشل · والكتابة تُفشل", () => {
  const post = H.stripComments(R(H.POST));
  // 🟡 موروث من ACL المشروع على كل جدول ⇒ تضييقه قرار عابر للحزم.
  assert.match(post, /raise notice[^;]*TRUNCATE/i,
    "TRUNCATE الموروثة غير مُبلَّغ عنها — سكوتٌ عن امتياز مدمّر");
  assert.ok(!/array_append\(v_bad[^)]*TRUNCATE/.test(post),
    "TRUNCATE الموروثة تُفشل الحزمة — وهي ليست من صنعها");
  // 🔴 أمّا arwd فلا يمنحها الافتراضيّ ولا الحزمة ⇒ ظهورها منحٌ من خارج العقد.
  assert.match(post, /foreach v_p in array array\['SELECT','INSERT','UPDATE','DELETE'\] loop/,
    "لا رفض لصلاحيات الصفوف على service_role");
});

// ─── ١٠ · Cron: الحارس يجب أن يسبق التحليل لا أن يتلوه ────────────────────
test("🔴 لا استعلام ثابت على cron.* في أيّ ملفّ من الحزمة", () => {
  for (const f of H.PKG_FILES) {
    const t = H.stripComments(R(f));
    for (const m of t.matchAll(/(?:from|join)\s+cron\.\w+/gi)) {
      const ctx = t.slice(Math.max(0, m.index - 300), m.index);
      assert.match(ctx, /execute\s/i,
        `${f}: «${m[0]}» خارج SQL ديناميكيّ — PostgreSQL يُحلّل الجملة كاملةً قبل تنفيذها`);
    }
  }
});

test("⛔ غياب pg_cron ليس فشلًا", () => {
  const post = H.stripComments(R(H.POST));
  const i = post.search(/to_regclass\(\s*'cron\.job'\s*\)/i);
  assert.notEqual(i, -1, "لا حارس وجود على cron.job");
  const branch = post.slice(i, i + 400);
  assert.ok(!/is\s+null\s+then[\s\S]{0,120}raise\s+exception/i.test(branch),
    "الفرع «الامتداد غير مثبَّت» يرفع استثناءً — والامتداد الغائب يُثبت العقد لا يخالفه");
});

// ─── ١١ · إعادة التطبيق فوق Preview المطبَّقة ──────────────────────────────
test("🔴 إعادة تشغيل RUNME لا تُسقط ولا تمحو", () => {
  const run = H.stripComments(R(H.RUNME));
  const top = H.stripBodies(run);
  assert.ok(!/drop\s+table/i.test(run), "RUNME يُسقط جدولًا");
  assert.ok(!/truncate/i.test(top), "RUNME يُفرّغ جدولًا");
  assert.ok(!/delete\s+from/i.test(top), "RUNME يحذف صفوفًا");
  // ⚠️ والإنشاء كلّه idempotent.
  const creates = [...run.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.\w+/gi)];
  for (const c of creates) {
    assert.match(c[0], /if\s+not\s+exists/i, `إنشاء غير idempotent: ${c[0]}`);
  }
});

test("PREFLIGHT يصنّف الحالتين ويوقف عند الهجينة", () => {
  const pre = H.stripComments(R(H.PRE));
  for (const token of ["FRESH_APPLY", "MATCHING_REAPPLY", "PARTIAL", "MISMATCH"]) {
    assert.ok(pre.includes(token), `PREFLIGHT بلا تصنيف ${token}`);
  }
  // 🔴 والتصنيف يُحتسب في الحسم لا يُعرض فقط.
  assert.match(pre, /if v_present not in \(0, ?3\) then/, "PARTIAL معروض ولا يُحتسب");
});

// ════════════════════════════════════════════════════════════════════════════
// ١٢ · بناء قائمة الصلاحيات — العطب الذي أوقف POSTCHECK على Preview
//
//   ERROR: malformed array literal: "MAINTAIN"
//   QUERY: v_privs := v_privs || 'MAINTAIN'
//
// السبب ليس MAINTAIN ولا الحارس: `text[] || 'نصّ'` **ليس** إلحاق عنصر. لمعامل
// `||` ثلاثة تحمّلات، والحرف غير المُنمَّط يُحسم لصالح `anyarray||anyarray`
// فيُفسَّر النصّ حرفيّةَ مصفوفة. والعلاج تنميط الطرف الثاني.
//
// 🔴 والاختبار **يُحاكي البلوك** لا يطابق نصًّا: القائمة الناتجة هي المقياس.
// ════════════════════════════════════════════════════════════════════════════
const BASE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];

test("🔴 بناء v_privs ينجح ويُعطي القائمة الصحيحة على 16 و17", () => {
  const post = R(H.POST);
  assert.deepEqual(H.simulatePrivList(post, 160000), BASE_PRIVS,
    "PostgreSQL 16: القائمة يجب أن تكون السبعة بلا MAINTAIN");
  assert.deepEqual(H.simulatePrivList(post, 170000), [...BASE_PRIVS, "MAINTAIN"],
    "PostgreSQL 17+: القائمة يجب أن تضيف MAINTAIN");
});

test("🔴 المحاكاة نفسها ترصد الصيغة المعطوبة (وإلّا فهي بلا قيمة)", () => {
  // ⚠️ تُثبَّت الأداة على نصّ **مُصطنَع** يحمل العطب الأصليّ حرفيًّا.
  const broken = `
do $$ declare v_privs text[];
begin
  v_privs := array['SELECT','INSERT'];
  if current_setting('server_version_num')::int >= 170000 then
    v_privs := v_privs || 'MAINTAIN';
  end if;
end $$;`;
  assert.throws(() => H.simulatePrivList(broken, 170000), H.MalformedArrayLiteral,
    "المحاكاة لا ترصد الصيغة التي أوقفت Preview");
  // ✅ وتقبل البديلين الصحيحين.
  assert.deepEqual(
    H.simulatePrivList(broken.replace("v_privs || 'MAINTAIN'", "array_append(v_privs, 'MAINTAIN')"), 170000),
    ["SELECT", "INSERT", "MAINTAIN"]);
  assert.deepEqual(
    H.simulatePrivList(broken.replace("v_privs || 'MAINTAIN'", "v_privs || array['MAINTAIN']"), 170000),
    ["SELECT", "INSERT", "MAINTAIN"]);
});

test("⛔ لا `v_x := v_x || 'نصّ'` في أيّ ملفّ من الحزمة", () => {
  // 🔴 نفس العطب كان في **١٤ موضعًا**: واحد في مسار النجاح (v_privs) وهو الذي
  //    ظهر، وثلاثة عشر في مسارات الفشل — أي أنّها كانت ستنفجر برسالة مضلِّلة
  //    في اللحظة التي يرصد فيها الفحص خللًا حقيقيًّا، فتحجب النتيجة الحقيقية.
  const hits = [];
  for (const f of H.PKG_FILES) {
    for (const h of H.arrayLiteralAppends(R(f))) hits.push(`${f}:${h.line} ${h.text.slice(0, 60)}`);
  }
  assert.deepEqual(hits, [], "مواضع معطوبة:\n" + hits.join("\n"));
});

test("🔴 حارس PostgreSQL 17 موجود وبالعتبة الصحيحة", () => {
  const post = H.stripComments(R(H.POST));
  assert.match(post, /current_setting\('server_version_num'\)::int\s*>=\s*170000/,
    "MAINTAIN تُفحص بلا حارس إصدار — خادم أقدم يرمي «unrecognized privilege type»");
});
