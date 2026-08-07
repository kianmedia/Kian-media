// ════════════════════════════════════════════════════════════════════════════
// tests/ops_center_acl_ownership.test.js
//
// Release Blocker من Final Preview Sweep:
//
//     ops_call_sheets · ops_job_weather
//       anon          = Dxtm   (TRUNCATE · REFERENCES · TRIGGER · MAINTAIN)
//       authenticated = rDxtm
//     WAVE 3 PRODUCTION OPS POSTCHECK FAILED
//
// ★ الملكية ★ الجدولان يُنشئهما `operations_center_RUNME.sql`، ⛔ ولا
//   `wave3_production_ops` — تلك تمدّدهما. فمكان إصلاح الـACL هو المالك،
//   وإصلاحه حيث اكتُشف يصنع مالكَين لعقد واحد.
//
// ★ ولماذا مرّ صامتًا ★ التشخيص طبع «لا صلاحية لـanon/public | ✅» وهو يفحص
//   **تنفيذ دالّة** لا صلاحيات جدول: عنوانٌ واحد لموضوعين.
//   و`information_schema.role_table_grants` **لا تعرض MAINTAIN إطلاقًا**.
//
// ⛔ لا قاعدة ولا شبكة: تحليل نصّيّ ساكن.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DOCS = path.join(ROOT, "docs");
const R = (f) => fs.readFileSync(path.join(DOCS, f), "utf8");

const OWNER = "operations_center_RUNME.sql";
const W3_POST = "wave3_production_ops_POSTCHECK.sql";
const W3_RUN = "wave3_production_ops_RUNME.sql";
const TABLES = ["ops_call_sheets", "ops_job_weather"];
const PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"];

function code(sql) {
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
/**
 * مِصْيَدة تبتلع فشل السحب عن anon.
 * ⚠️ المدى `[\s\S]{0,160}` لا `[^;]*`: الأمر نفسه يحوي فاصلة منقوطة
 *    (`…', t);`) قبل `exception`، فنمطٌ يتوقّف عندها لا يُطابق شيئًا أبدًا —
 *    حارسٌ يبدو قائمًا وهو لا يحرس. (نفس عطب `[^)]` في فحص fail-open.)
 */
const FROM_ANON_TRAP =
  /begin\s+execute\s+format\('revoke all[\s\S]{0,80}from anon'[\s\S]{0,160}exception when undefined_object then null/i;

function verdictOf(file) {
  const t = code(R(file));
  const i = t.search(/do\s+\$verdict\$/i);
  return i === -1 ? "" : t.slice(i);
}

// ════════════════════════════════════════════════════════════════════════════
// ١ · الملكية — تُشتقّ من المستودع لا من ادّعاء
// ════════════════════════════════════════════════════════════════════════════
test("🔴 المالك الوحيد للجدولين هو operations_center_RUNME", () => {
  const creators = {};
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    const t = code(fs.readFileSync(path.join(DOCS, f), "utf8"));
    for (const tbl of TABLES) {
      if (new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?public\\.${tbl}\\b`, "i").test(t)) {
        (creators[tbl] ??= []).push(f);
      }
    }
  }
  for (const tbl of TABLES) assert.deepEqual(creators[tbl], [OWNER], `${tbl}: ${creators[tbl]}`);
});

test("⛔ wave3_production_ops تمدّد الجدولين ولا تُنشئهما ولا تمنحهما", () => {
  const t = code(R(W3_RUN));
  for (const tbl of TABLES) {
    assert.ok(!new RegExp(`create\\s+table[^;]*${tbl}`, "i").test(t), `${tbl}: wave3 تُنشئه`);
    assert.match(t, new RegExp(`alter table public\\.${tbl}`), `${tbl}: wave3 لا تمدّده`);
  }
  // 🔴 والإصلاح ليس هنا: حزمةٌ لا تملك الجدول لا تملك عقد وصوله.
  assert.ok(!/(grant|revoke)[^;]*ops_call_sheets|(grant|revoke)[^;]*ops_job_weather/i.test(t),
    "🔴 wave3 تمنح أو تسحب على جدول لا تملكه — مالكان لعقد واحد");
});

test("🔴 المالك يسحب من anon وPUBLIC وauthenticated ثمّ يمنح SELECT", () => {
  const t = code(R(OWNER));
  assert.match(t, /revoke all privileges on table public\.%I from public/, "لا سحب عن PUBLIC");
  assert.match(t, /revoke all privileges on table public\.%I from anon/, "لا سحب عن anon");
  assert.match(t, /revoke all privileges on table public\.%I from authenticated/, "لا سحب عن authenticated");
  assert.match(t, /grant select on table public\.%I to authenticated/, "لا منحة قراءة");
  for (const tbl of TABLES) assert.ok(t.includes(`'${tbl}'`), `${tbl} خارج حلقة الصلاحيات`);
});

// 🔴 السبب الذي جعل السحب لا يُنفَّذ: مِصْيَدة تبتلع الفشل بصمت.
test("🔴 سحب anon ليس داخل مِصْيَدة تبتلع الفشل", () => {
  const t = code(R(OWNER));
  assert.ok(!FROM_ANON_TRAP.test(t),
    "🔴 `exception when undefined_object then null` حول السحب يترك anon ممتلكًا بصمت");
  assert.match(t, /if to_regrole\('anon'\) is not null then\s*\n\s*execute format\('revoke all privileges on table public\.%I from anon'/,
    "السحب غير مشروط بوجود الدور فعلًا");
});

// 🔴 وتحقّق داخل المعاملة يمنع المرور الصامت مهما كان سبب عدم التنفيذ.
test("🔴 المالك يتحقّق من الـACL الناتج داخل المعاملة", () => {
  const t = code(R(OWNER));
  const i = t.indexOf("بقيت صلاحيات");
  assert.notEqual(i, -1, "لا تحقّق بعد السحب — إصدار الأمر ليس إثباتًا لأثره");
  const blk = t.slice(Math.max(0, i - 1400), i + 200);
  assert.match(blk, /aclexplode/, "التحقّق لا يقرأ الـACL من الكتالوج");
  assert.match(blk, /a\.grantee = 0/, "PUBLIC غير محتسَب في التحقّق");
  assert.match(blk, /raise exception/, "التحقّق لا يُلغي المعاملة");
});

test("MATCHING_REAPPLY: قسم الصلاحيات منح وسحب فقط", () => {
  const t = code(R(OWNER));
  const i = t.indexOf("foreach t in array array['ops_locations'");
  const blk = t.slice(i, t.indexOf("ops_job_code_seq"));
  for (const bad of [/drop\s+table/i, /truncate/i, /delete\s+from/i, /create\s+table/i]) {
    assert.ok(!bad.test(blk), `قسم الصلاحيات يلمس البيانات: ${bad}`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٢ · عقد الاستخدام — لا افتراض
// ════════════════════════════════════════════════════════════════════════════
test("🔴 ولا مستهلك مباشر للجدولين من كود التطبيق", () => {
  const hits = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (!["node_modules", ".next"].includes(e.name)) walk(p); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) continue;
      // ⚠️ تُجرَّد تعليقات JS أوّلًا: `ops_job_weather` بين علامتين مائلتين
      //    داخل تعليق عربيّ ليس مرجع جدول — وقد أعطى إنذارًا كاذبًا فعلًا.
      const src = fs.readFileSync(p, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
      for (const tbl of TABLES) {
        // مرجع جدول فعليّ لا ذكرًا في تعليق.
        if (new RegExp(`(?:['"\`/]|rest/v1/)${tbl}[?'"\`]|from\\(\\s*['"\`]${tbl}['"\`]`).test(src)) {
          hits.push(`${path.relative(ROOT, p)} → ${tbl}`);
        }
      }
    }
  };
  ["app", "lib", "components", "supabase", "scripts"].forEach((d) => walk(path.join(ROOT, d)));
  assert.deepEqual(hits, [], "ظهر مستهلك مباشر ⇒ أعِد تقييم العقد:\n" + hits.join("\n"));
});

test("🔴 كل قارئ SQL للجدولين هو SECURITY DEFINER", () => {
  const bad = [];
  for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith(".sql"))) {
    const t = code(fs.readFileSync(path.join(DOCS, f), "utf8"));
    for (const m of t.matchAll(/create or replace function public\.(\w+)([\s\S]*?)\$\$([\s\S]*?)\$\$/g)) {
      if (!TABLES.some((tbl) => m[3].includes(tbl))) continue;
      if (!/security definer/i.test(m[2])) bad.push(`${f}: ${m[1]}`);
    }
  }
  assert.deepEqual(bad, [], "قارئ ليس SECURITY DEFINER ⇒ يحتاج صلاحية المستدعي:\n" + bad.join("\n"));
});

// 🔴 ومع ذلك SELECT مطلوب: سياسة القراءة بلا منحة **ميتة**.
test("🔴 SELECT لـauthenticated مبرَّر بسياسة قراءة محروسة", () => {
  const t = code(R(OWNER));
  assert.match(t, /create policy %I on public\.%I for select to authenticated using \(public\.prodops_can_read_job\(job_id\)\)/,
    "لا سياسة قراءة محروسة على الأبناء");
  const i = t.indexOf("prodops_can_read_job(job_id)");
  const loop = t.slice(Math.max(0, i - 900), i);
  for (const tbl of TABLES) assert.ok(loop.includes(`'${tbl}'`), `${tbl} خارج حلقة سياسات القراءة`);
});

// ════════════════════════════════════════════════════════════════════════════
// ٣ · كاشف واحد للعرض وللحسم
// ════════════════════════════════════════════════════════════════════════════
test("🔴 لا role_table_grants في فحص ACL — لا عرضًا ولا حسمًا", () => {
  const t = code(R(W3_POST));
  assert.ok(!/from\s+information_schema\.role_table_grants/i.test(t),
    "🔴 كاشف لا يعرض MAINTAIN ولا الموروث — وهو سبب ✅ الكاذبة");
});

test("🔴 العرض والحسم على نفس الكاشف ونفس القائمة", () => {
  const t = code(R(W3_POST));
  const v = verdictOf(W3_POST);
  const display = t.slice(0, t.indexOf("do $verdict$"));
  for (const d of [display, v]) {
    assert.match(d, /aclexplode/, "طرف لا يستعمل aclexplode");
    for (const tbl of TABLES) assert.ok(d.includes(tbl), `${tbl} غائب عن أحد الطرفين`);
  }
  assert.match(v, /has_table_privilege/, "الحسم بلا قياس فعليّ");
  assert.match(v, /has_any_column_privilege/, "ACL الأعمدة غير مفحوص");
});

test("🔴 أنواع الصلاحيات الثمانية مع حارس PostgreSQL 17", () => {
  const v = verdictOf(W3_POST);
  for (const p of PRIVS) assert.ok(v.includes(`'${p}'`), `نوع غير مفحوص: ${p}`);
  assert.match(v, /server_version_num'\)::int >= 170000/, "MAINTAIN بلا حارس إصدار");
  assert.match(v, /array_append\(v_privs, 'MAINTAIN'\)/, "ضمّ نصّ مفرد إلى text[]");
});

test("⛔ عنوان التشخيص يصف موضوعه — ولا يوهم بحكمٍ على الجدولين", () => {
  const t = code(R(W3_POST));
  assert.ok(!/'لا صلاحية لـanon\/public' as check/.test(t),
    "🔴 عنوان عامّ لفحص دالّة واحدة — هو مصدر ✅ المضلِّلة");
  assert.match(t, /'لا تنفيذ لـanon\/PUBLIC على prodops_weather_record' as check/,
    "العنوان لا يسمّي موضوعه");
});

test("🔴 الاستثناء يفصل ACL عن الأنظمة الموازية ويسمّي المالك", () => {
  const v = verdictOf(W3_POST);
  assert.match(v, /'PARALLEL_OBJECT: '/, "الأنظمة الموازية بلا وسم مستقلّ");
  assert.match(v, /operations_center_RUNME\.sql/, "الاستثناء لا يدلّ على مالك عقد الـACL");
  // ⛔ ولا يُدمج الصنفان في رسالة واحدة.
  assert.ok(!/نظام موازٍ[\s\S]{0,80}ACL|ACL[\s\S]{0,40}نظام موازٍ/.test(v), "الصنفان مدموجان");
});

test("⛔ RLS ليست بديلًا عن ACL — والعلّة موثَّقة", () => {
  const v = verdictOf(W3_POST);
  assert.match(v, /TRUNCATE/, "TRUNCATE غير مفحوص");
  assert.match(R(W3_POST), /RLS \*\*لا تحكم\*\* TRUNCATE|RLS لا تحكم/,
    "علّة أنّ RLS لا تكفي غير موثَّقة — فتعود ذريعةً");
});

test("⚠️ service_role يُبلَّغ ولا يُفشل بلا جرد مستهلكين", () => {
  const v = verdictOf(W3_POST);
  assert.match(v, /raise notice[^;]*service_role/, "service_role مسكوت عنه تمامًا");
  assert.ok(!/array_append\(v_acl[^)]*service_role/.test(v),
    "🔴 سحب/إفشال على service_role بلا جرد مستهلكين");
});

// ════════════════════════════════════════════════════════════════════════════
// ٤ · طفرات — ⛔ ولا يُلمس `docs/`
// ════════════════════════════════════════════════════════════════════════════
function mutate(file, from, to, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ops-acl-mut-"));
  try {
    const src = R(file);
    const out = src.replace(from, to);
    assert.notEqual(out, src, `التشويه لم يُطبَّق على ${file}`);
    const p = path.join(dir, file);
    fs.writeFileSync(p, out);
    assert.throws(() => check(fs.readFileSync(p, "utf8")), assert.AssertionError,
      `🔴 طفرة غير مرصودة في ${file}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
/** الحسم من نصّ مُشوَّه. */
function verdictOfText(s) {
  const t = code(s);
  const i = t.search(/do\s+\$verdict\$/i);
  return i === -1 ? "" : t.slice(i);
}

const PRIV_ARRAY = "array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']";
for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
  test(`طفرة: إسقاط ${priv} من أنواع الفحص ⇒ anon يمرّ به`, () => {
    // ⚠️ المرساة هي **مصفوفة الأنواع** بعينها: الاسم يتكرّر في الشرح وفي
    //    إشعار service_role، ومرساةٌ أقصر تُشوّه تعليقًا فلا يتغيّر شيء.
    mutate(W3_POST, PRIV_ARRAY, PRIV_ARRAY.replace(`'${priv}',`, "").replace(`,'${priv}'`, ""),
      (s) => {
        const v = verdictOfText(s);
        const m = v.match(/v_privs := (array\[[^\]]*\]);/);
        assert.ok(m && m[1].includes(`'${priv}'`), `${priv} خرج من مصفوفة الفحص`);
      });
  });
}

test("طفرة: إسقاط MAINTAIN من أنواع الفحص على PostgreSQL 17", () => {
  mutate(W3_POST, "    v_privs := array_append(v_privs, 'MAINTAIN');", "    null;",
    (s) => assert.match(verdictOfText(s), /array_append\(v_privs, 'MAINTAIN'\)/));
});

test("طفرة: authenticated يُسمح له بما فوق SELECT", () => {
  mutate(W3_POST, "elsif has_table_privilege('authenticated','public.'||v_o, v_p) then",
    "elsif false then",
    (s) => assert.match(verdictOfText(s),
      /elsif has_table_privilege\('authenticated','public\.'\|\|v_o, v_p\) then/));
});

test("طفرة: العودة إلى role_table_grants كمصدر للحسم", () => {
  mutate(W3_POST, /has_table_privilege\('anon','public\.'\|\|v_o, v_p\)/,
    "exists (select 1 from information_schema.role_table_grants g where g.grantee='anon')",
    (s) => {
      const v = verdictOfText(s);
      assert.ok(!/information_schema\.role_table_grants/i.test(v),
        "🔴 كاشف لا يعرض MAINTAIN ولا الموروث صار مصدر الحسم");
    });
});

test("طفرة: التشخيص يقول ✅ ثابتًا بينما الحسم يفحص فعلًا", () => {
  // 🔴 هذا هو العطب الأصليّ حرفيًّا: ✅ معروضة و🔴 محكومة لنفس الشرط.
  mutate(W3_POST, "lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a\n    where n.nspname = 'public'",
    "lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a\n    where false and n.nspname = 'public'",
    (s) => {
      const t = code(s);
      const display = t.slice(0, t.indexOf("do $verdict$"));
      assert.ok(!/where false/.test(display), "عرضُ الـACL مُعطَّل فيقول ✅ دائمًا");
    });
});

test("طفرة: حارس PostgreSQL 17 محذوف", () => {
  mutate(W3_POST, /if current_setting\('server_version_num'\)::int >= 170000 then/,
    "if true then",
    (s) => assert.match(verdictOfText(s), /server_version_num'\)::int >= 170000/));
});

test("طفرة: خلط الأنظمة الموازية برسالة ACL", () => {
  mutate(W3_POST, "v_fail := array_append(v_fail, 'PARALLEL_OBJECT: ' || array_to_string(v_parallel, ', '));",
    "v_acl := array_append(v_acl, 'نظام موازٍ ' || array_to_string(v_parallel, ', '));",
    (s) => assert.match(verdictOfText(s), /'PARALLEL_OBJECT: '/));
});

test("طفرة: إصلاح ACL يُوضع في الحزمة التي لا تملك الجدول", () => {
  mutate(W3_RUN, "alter table public.ops_call_sheets",
    "revoke all privileges on table public.ops_call_sheets from anon;\nalter table public.ops_call_sheets",
    (s) => assert.ok(
      !/(grant|revoke)[^;]*ops_call_sheets|(grant|revoke)[^;]*ops_job_weather/i.test(code(s)),
      "wave3 تمنح أو تسحب على جدول لا تملكه"));
});

test("طفرة: عودة المِصْيَدة الصامتة حول سحب anon", () => {
  mutate(OWNER, "    if to_regrole('anon') is not null then\n      execute format('revoke all privileges on table public.%I from anon', t);",
    "    begin execute format('revoke all privileges on table public.%I from anon', t); exception when undefined_object then null; end;\n    if false then",
    (s) => assert.ok(
      !FROM_ANON_TRAP.test(code(s)), "مِصْيَدة تبتلع فشل السحب"));
});

test("طفرة: حذف التحقّق داخل المعاملة من المالك", () => {
  mutate(OWNER, /raise exception E'🔴 بقيت صلاحيات لـanon\/PUBLIC بعد السحب على:[^;]*;/,
    "null;",
    (s) => assert.match(code(s), /raise exception E'🔴 بقيت صلاحيات/));
});

test("طفرة: سحب service_role بلا جرد مستهلكين", () => {
  mutate(OWNER, "      execute format('revoke all privileges on table public.%I from anon', t);",
    "      execute format('revoke all privileges on table public.%I from anon, service_role', t);",
    (s) => assert.ok(!/revoke[^;]*from[^;]*service_role/i.test(code(s)),
      "سحب على service_role بلا إثبات مستهلكيه"));
});
