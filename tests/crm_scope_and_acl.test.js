// ════════════════════════════════════════════════════════════════════════════
// tests/crm_scope_and_acl.test.js
//
// فصلُ نطاق CRM Foundation عن Wave 4، وACL كائنات Wave 4.
//
// ★ الإنذار الكاذب ★ فحص Foundation مسح `proname like 'crm\_%'` فالتقط
//   `crm_testimonial_invite_check(text)` — دالّة **Wave 4** يملكها anon **عمدًا**
//   (تحقّق من رمز دعوة قبل تسجيل الدخول). حزمةٌ سليمة أُدينت بجارٍ لها في
//   فضاء الأسماء. ⛔ والعلاج حصرُ النطاق لا استثناء اسمٍ بعينه.
//
// ★ العطب الحقيقيّ ★ كائنات Wave 4 احتفظت بـ`Dxtm` لـauthenticated: السحب كان
//   من `anon, public` فقط، وACL المشروع الافتراضيّ يمنح الباقي.
//   ⛔ وRLS **لا تحكم TRUNCATE**.
//
// 🔴 والملكية تُشتقّ من **RUNME كل حزمة**، لا من الملفّ المفحوص.
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

const F_RUN = "crm_sales_FOUNDATION_RUNME.sql";
const F_POST = "crm_sales_FOUNDATION_POSTCHECK.sql";
const W4_RUN = "wave4_crm_business_RUNME.sql";
const W4_POST = "wave4_crm_business_POSTCHECK.sql";

/** يجرّد تعليقات `--` ويُبقي السلاسل — فلا يُحاكَم الشرح كأنّه كود. */
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

/** أسماء الدوالّ التي يُنشئها ملفّ RUNME — **مصدر الملكية**. */
function fnsOf(file) {
  return new Set([...code(R(file)).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)]
    .map((m) => m[1]));
}
/** الجداول والعروض التي يُنشئها ملفّ RUNME. */
function relsOf(file) {
  const t = code(R(file));
  return new Set([
    ...[...t.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.(\w+)/gi)].map((m) => m[1]),
    ...[...t.matchAll(/create\s+(?:or\s+replace\s+)?view\s+public\.(\w+)/gi)].map((m) => m[1]),
  ]);
}
/** بلوك الحسم. */
function verdictOf(file) {
  const t = code(R(file));
  const i = t.search(/do\s+\$[a-z_]*\$/i);
  return i === -1 ? "" : t.slice(i);
}

// ════════════════════════════════════════════════════════════════════════════
// ١ · الملكية: الحزمتان لا تتقاطعان
// ════════════════════════════════════════════════════════════════════════════
const FOUNDATION_FNS = fnsOf(F_RUN);
const W4_FNS = fnsOf(W4_RUN);
const W4_RELS = relsOf(W4_RUN);
const FOUNDATION_TABLES = [
  "crm_settings", "crm_teams", "crm_team_members", "crm_companies", "crm_contacts",
  "crm_competitors", "crm_lead_score_rules", "crm_leads", "crm_pipelines", "crm_stages",
  "crm_opportunities", "crm_stage_history", "crm_activities", "crm_targets",
  "crm_commission_plans", "crm_commission_assignments", "crm_commission_records",
  "crm_import_batches", "crm_audit", "crm_approval_requests",
];

test("🔴 مجموعتا الدوالّ منفصلتان — ولا اسم مشترك", () => {
  const overlap = [...W4_FNS].filter((f) => FOUNDATION_FNS.has(f));
  assert.deepEqual(overlap, [], "تقاطع أسماء بين الحزمتين: " + overlap.join(", "));
  assert.ok(FOUNDATION_FNS.size >= 90, `Foundation فيها ${FOUNDATION_FNS.size} دالّة فقط`);
  assert.ok(W4_FNS.has("crm_testimonial_invite_check"), "دالّة الدعوة ليست من Wave 4");
});

test("🔴 جداول Foundation العشرون كلّها من إنشاء Foundation RUNME", () => {
  const rels = relsOf(F_RUN);
  for (const t of FOUNDATION_TABLES) assert.ok(rels.has(t), `${t} ليس من إنشاء Foundation`);
  // ⛔ وكائنات Wave 4 ليست منها.
  for (const t of ["crm_opportunity_tender", "crm_testimonial_invites", "crm_client_health_v"]) {
    assert.ok(!rels.has(t), `${t} يُنشئه Foundation — راجع الملكية`);
    assert.ok(W4_RELS.has(t), `${t} ليس من إنشاء Wave 4`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// ٢ · Foundation POSTCHECK: نطاق محصور، ⛔ ولا مسحُ فضاء أسماء
// ════════════════════════════════════════════════════════════════════════════
test("🔴 Foundation POSTCHECK لا يمسح فضاء الأسماء crm_%", () => {
  const t = code(R(F_POST));
  const scans = [...t.matchAll(/(?:proname|tablename|table_name|routine_name)[^\n]{0,30}like\s+'crm[^']*'/gi)]
    .map((m) => m[0]);
  assert.deepEqual(scans, [],
    "🔴 مسحُ فضاء الأسماء يلتقط دوالّ Wave 4 — وهو مصدر الإنذار الكاذب:\n" + scans.join("\n"));
});

test("🔴 Foundation POSTCHECK يفحص بالاسم **والتوقيع**", () => {
  const t = code(R(F_POST));
  assert.match(t, /foundation_fn\(fname,\s*fargs\)/, "لا قائمة نطاق بالتوقيع");
  assert.match(t, /oidvectortypes\(p\.proargtypes\)\s*=\s*k\.fargs/,
    "المطابقة ليست بالتوقيع — pg_get_function_identity_arguments تُعيد أسماء الوسائط");
  // 🔴 والقائمة تغطّي **كل** دالّة Foundation — مشتقّة من RUNME لا من الملفّ.
  const listed = new Set([...t.matchAll(/\('(\w+)','[^']*'\)/g)].map((m) => m[1]));
  const missing = [...FOUNDATION_FNS].filter((f) => !listed.has(f));
  assert.deepEqual(missing, [], "دوالّ Foundation خارج النطاق: " + missing.join(", "));
});

test("⛔ ولا كائن من Wave 4 داخل فحوص Foundation", () => {
  const t = code(R(F_POST));
  for (const o of ["crm_opportunity_tender", "crm_testimonial_invites", "crm_client_health_v",
                   "crm_testimonial_invite_check"]) {
    assert.ok(!t.includes(o), `🔴 Foundation يفحص كائن Wave 4: ${o}`);
  }
});

test("🔴 فحوص ACL في Foundation محصورة بالعشرين", () => {
  const v = verdictOf(F_POST);
  for (const t of FOUNDATION_TABLES) assert.ok(v.includes(`'${t}'`), `${t} خارج حسم Foundation`);
  assert.match(v, /grantee::text in \('anon','PUBLIC'\)/, "تسريب anon غير محتسَب");
  assert.match(v, /privilege_type::text <> 'SELECT'/, "authenticated بأكثر من SELECT غير محتسَب");
});

// ════════════════════════════════════════════════════════════════════════════
// ٣ · عقد ACL كائنات Wave 4
// ════════════════════════════════════════════════════════════════════════════
test("🔴 Wave 4 يسحب من authenticated أيضًا لا من anon وحده", () => {
  const t = code(R(W4_RUN));
  for (const o of ["crm_opportunity_tender", "crm_testimonial_invites", "crm_client_health_v"]) {
    const re = new RegExp(`revoke all privileges on table public\\.${o}\\s+from public, anon, authenticated;`);
    assert.match(t, re, `🔴 ${o}: السحب لا يشمل authenticated ⇒ يبقى Dxtm الموروث`);
  }
});

test("🔴 المنح: SELECT للجدولين فقط · ⛔ ولا شيء على العرض", () => {
  const t = code(R(W4_RUN));
  assert.match(t, /grant select on table public\.crm_opportunity_tender\s+to authenticated;/);
  assert.match(t, /grant select on table public\.crm_testimonial_invites to authenticated;/);
  // ⛔ ولا منحة على العرض المشتقّ.
  assert.ok(!/grant\s[^;]*\bcrm_client_health_v\b[^;]*to\s/i.test(t),
    "🔴 منحة على crm_client_health_v — عرضٌ بلا حارس صلاحية ولا مستهلك مباشر");
  // ⛔ ولا منحة كتابة لأيّ دور عميل.
  for (const m of t.matchAll(/grant\s+([a-z ,]+?)\s+on\s+table\s+public\.(crm_\w+)\s+to\s+([a-z_, ]+);/gi)) {
    const privs = m[1].split(",").map((x) => x.trim().toLowerCase());
    const roles = m[3].split(",").map((x) => x.trim().toLowerCase());
    if (roles.includes("authenticated") || roles.includes("anon") || roles.includes("public")) {
      assert.deepEqual(privs, ["select"], `🔴 ${m[2]}: منحة أوسع من SELECT (${privs.join(",")})`);
    }
    assert.ok(!roles.includes("anon") && !roles.includes("public"), `🔴 ${m[2]}: منحة جدولية لـanon/PUBLIC`);
  }
});

// 🔴 السبب الذي يجعل SELECT على الجدولين مطلوبًا: سياسة قراءة بلا منحة **ميتة**.
test("🔴 كل جدول يُمنح SELECT له سياسة قراءة محروسة", () => {
  const t = code(R(W4_RUN));
  assert.match(t, /create policy crm_tender_read on public\.crm_opportunity_tender[\s\S]{0,160}crm_can_read_opportunity/,
    "سياسة قراءة العطاءات غائبة أو غير محروسة");
  assert.match(t, /create policy crm_ti_read on public\.crm_testimonial_invites[\s\S]{0,120}crm_can_manage\(\)/,
    "سياسة قراءة الدعوات غائبة أو غير محروسة");
});

// 🔴 والعرض: لا منحة — والدليل مزدوج (لا مستهلك · ولا حارس داخله).
test("🔴 crm_client_health_v: لا مستهلك مباشر ولا حارس ⇒ لا منحة", () => {
  // ١ · ولا إشارة في كود التطبيق.
  const dirs = ["app", "lib", "components"];
  const hits = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|js|jsx)$/.test(e.name) &&
               fs.readFileSync(p, "utf8").includes("crm_client_health_v")) hits.push(p);
    }
  };
  dirs.forEach((d) => walk(path.join(ROOT, d)));
  assert.deepEqual(hits, [],
    "ظهر مستهلك مباشر ⇒ أعِد النظر في المنحة (والأفضل security_invoker):\n" + hits.join("\n"));

  // ٢ · وقارئاها في SQL كلاهما SECURITY DEFINER ⇒ لا حاجة إلى منحة.
  const t = code(R(W4_RUN));
  for (const m of t.matchAll(/create or replace function public\.(\w+)([\s\S]*?)\$\$([\s\S]*?)\$\$/g)) {
    if (!m[3].includes("crm_client_health_v")) continue;
    assert.match(m[2], /security definer/i, `${m[1]} تقرأ العرض وليست SECURITY DEFINER`);
  }
  // ٣ · والعرض ليس security_invoker وبلا حارس ⇒ منحُه تجاوزٌ لعزل الشركات.
  assert.ok(!/security_invoker/i.test(t),
    "صار security_invoker — راجع القرار، فمنح SELECT قد يصير مقبولًا");
});

test("🔴 Wave 4 POSTCHECK يقيس الصلاحيات الفعليّة بأنواعها الثمانية", () => {
  const t = code(R(W4_POST));
  assert.match(t, /has_table_privilege/, "لا قياس فعليّ");
  assert.match(t, /has_any_column_privilege/, "لا فحص لـACL الأعمدة");
  assert.match(t, /aclexplode/, "لا فحص لـPUBLIC من الكتالوج");
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"]) {
    assert.ok(t.includes(p), `نوع صلاحية غير مفحوص: ${p}`);
  }
  assert.match(t, /server_version_num'\)::int >= 170000/, "MAINTAIN بلا حارس إصدار PostgreSQL 17");
  assert.match(t, /array_append\(v_privs, 'MAINTAIN'\)/, "ضمّ نصّ مفرد إلى text[] — حرفيّة مصفوفة معطوبة");
});

// ⛔ وRLS ليست عذرًا: TRUNCATE خارج نطاقها.
test("⛔ RLS لا تُستعمل تبريرًا لبقاء TRUNCATE", () => {
  const t = code(R(W4_POST));
  const i = t.indexOf("TRUNCATE");
  assert.notEqual(i, -1, "TRUNCATE غير مفحوص إطلاقًا");
  assert.match(R(W4_RUN), /RLS لا تحكم TRUNCATE|RLS لا تحكم/,
    "العلّة غير موثَّقة في RUNME — فتعود ذريعةً لاحقًا");
});

test("🔴 عقد anon المقصود مُثبَت إيجابًا", () => {
  const v = verdictOf(W4_POST);
  assert.match(v, /crm_testimonial_invite_check/, "المنحة المقصودة غير مُثبَتة");
  assert.match(v, /array\['crm_testimonial_invite_check'\]::text\[\]/,
    "الفحص لا يشترط أن تكون **وحدها**");
});

// ════════════════════════════════════════════════════════════════════════════
// ٤ · طفرات — ⛔ ولا يُلمس `docs/`
// ════════════════════════════════════════════════════════════════════════════
function mutate(file, from, to, check) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-scope-mut-"));
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

test("طفرة: عودة مسح crm_% إلى Foundation POSTCHECK", () => {
  mutate(F_POST, "and p.pronamespace = 'public'::regnamespace\n             and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs",
    "and p.proname like 'crm\\_%'",
    (s) => {
      const t = code(s);
      const scans = [...t.matchAll(/(?:proname|tablename|table_name|routine_name)[^\n]{0,30}like\s+'crm[^']*'/gi)];
      assert.deepEqual(scans.map((m) => m[0]), []);
    });
});

test("طفرة: دالّة Wave 4 تدخل نطاق Foundation", () => {
  mutate(F_POST, "('crm_perm','text')", "('crm_testimonial_invite_check','text')",
    (s) => {
      const t = code(s);
      for (const o of ["crm_testimonial_invite_check"]) assert.ok(!t.includes(o));
    });
});

test("طفرة: جدول Wave 4 يدخل فحص ACL في Foundation", () => {
  mutate(F_POST, "'crm_approval_requests')) > 0 then", "'crm_approval_requests','crm_opportunity_tender')) > 0 then",
    (s) => {
      const t = code(s);
      for (const o of ["crm_opportunity_tender"]) assert.ok(!t.includes(o));
    });
});

test("طفرة: إسقاط دالّة Foundation من النطاق", () => {
  mutate(F_POST, /\('crm_can_manage','\'\)/g, "('crm_zzz_absent','')",
    (s) => {
      const listed = new Set([...code(s).matchAll(/\('(\w+)','[^']*'\)/g)].map((m) => m[1]));
      const missing = [...FOUNDATION_FNS].filter((f) => !listed.has(f));
      assert.deepEqual(missing, []);
    });
});

test("طفرة: السحب في Wave 4 يعود anon/public فقط", () => {
  mutate(W4_RUN, "revoke all privileges on table public.crm_opportunity_tender  from public, anon, authenticated;",
    "revoke all privileges on table public.crm_opportunity_tender  from public, anon;",
    (s) => assert.match(code(s),
      /revoke all privileges on table public\.crm_opportunity_tender\s+from public, anon, authenticated;/));
});

test("طفرة: منحة أوسع من SELECT على جدول Wave 4", () => {
  mutate(W4_RUN, "grant select on table public.crm_testimonial_invites to authenticated;",
    "grant select, insert on table public.crm_testimonial_invites to authenticated;",
    (s) => {
      for (const m of code(s).matchAll(/grant\s+([a-z ,]+?)\s+on\s+table\s+public\.(crm_\w+)\s+to\s+([a-z_, ]+);/gi)) {
        const privs = m[1].split(",").map((x) => x.trim().toLowerCase());
        if (m[3].includes("authenticated")) assert.deepEqual(privs, ["select"]);
      }
    });
});

test("طفرة: منحة جدولية لـanon في Wave 4", () => {
  mutate(W4_RUN, "grant select on table public.crm_opportunity_tender  to authenticated;",
    "grant select on table public.crm_opportunity_tender  to authenticated, anon;",
    (s) => {
      for (const m of code(s).matchAll(/grant\s+[a-z ,]+?\s+on\s+table\s+public\.crm_\w+\s+to\s+([a-z_, ]+);/gi)) {
        const roles = m[1].split(",").map((x) => x.trim().toLowerCase());
        assert.ok(!roles.includes("anon"));
      }
    });
});

test("طفرة: عودة منحة SELECT على crm_client_health_v", () => {
  mutate(W4_RUN, "-- ⛔ ولا منحة على crm_client_health_v — انظر الدليل أعلاه.",
    "grant select on table public.crm_client_health_v to authenticated;",
    (s) => assert.ok(!/grant\s[^;]*\bcrm_client_health_v\b[^;]*to\s/i.test(code(s))));
});

test("طفرة: حذف EXECUTE المقصود لـcrm_testimonial_invite_check", () => {
  mutate(W4_RUN, "grant execute on function public.crm_testimonial_invite_check(text) to anon, authenticated;",
    "grant execute on function public.crm_testimonial_invite_check(text) to authenticated;",
    (s) => assert.match(code(s),
      /grant execute on function public\.crm_testimonial_invite_check\(text\) to anon, authenticated;/));
});

test("طفرة: MAINTAIN بلا حارس إصدار في Wave 4 POSTCHECK", () => {
  mutate(W4_POST, /server_version_num'\)::int >= 170000/, "true or 1=1",
    (s) => assert.match(code(s), /server_version_num'\)::int >= 170000/));
});

test("طفرة: إسقاط TRUNCATE من أنواع الصلاحيات المفحوصة", () => {
  mutate(W4_POST, "'DELETE','TRUNCATE','REFERENCES'", "'DELETE','REFERENCES'",
    (s) => {
      const t = code(s);
      assert.ok(t.includes("'TRUNCATE'"), "TRUNCATE خرج من الفحص — وRLS لا تحكمه");
    });
});

// 🔴 عدم الدور: النطاق مشتقّ من **RUNME** لا من الملفّ المفحوص.
test("طفرة (عدم الدور): دالّة جديدة في Foundation RUNME ⇒ النطاق يصير ناقصًا", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "crm-taut-"));
  try {
    const src = R(F_RUN);
    const out = src.replace("create or replace function public.crm_perm(",
      "create or replace function public.crm_brand_new_gate(p_x uuid)\nreturns boolean language sql as $$ select true $$;\n\ncreate or replace function public.crm_perm(");
    assert.notEqual(out, src, "التشويه لم يُطبَّق");
    fs.writeFileSync(path.join(dir, F_RUN), out);
    const newFns = new Set([...code(out).matchAll(/create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)\s*\(/gi)]
      .map((m) => m[1]));
    const listed = new Set([...code(R(F_POST)).matchAll(/\('(\w+)','[^']*'\)/g)].map((m) => m[1]));
    assert.ok(!listed.has("crm_brand_new_gate"),
      "النطاق مشتقّ من الملفّ المفحوص نفسه — فدالّة جديدة في RUNME لا تُغيّر شيئًا");
    assert.ok(newFns.has("crm_brand_new_gate"));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
