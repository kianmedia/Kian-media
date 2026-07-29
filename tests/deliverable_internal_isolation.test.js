// ════════════════════════════════════════════════════════════════════════════
// tests/deliverable_internal_isolation.test.js
//
// حارس تسريب مؤكَّد: RLS في PostgreSQL تُصفّي **الصفوف** لا **الأعمدة**، وكل
// مستخدمي التطبيق (العميل والموظّف) على دور Postgres واحد هو authenticated.
// فأيّ عمود داخليّ على public.deliverables يقرؤه العميل حرفيًّا بـ
//     GET /rest/v1/deliverables?select=internal_notes,external_key
// على كل صفّ تسمح له سياسة "deliverables read" برؤيته.
//
// هذه الاختبارات تُثبّت الإصلاح البنيويّ: الحقول الستّة تعيش في جدول جانبي 1:1
// (public.deliverable_internal) بسياسة كوادر-فقط ⇒ العميل يحصل على صفر صفوف،
// وidempotency الاستيراد (الفهرس الفريد الجزئيّ على external_key) انتقل معها.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

const RUNME = read("docs/project_platform_large_projects_RUNME.sql");
const PRE = read("docs/project_platform_large_projects_PREFLIGHT.sql");
const POST = read("docs/project_platform_large_projects_POSTCHECK.sql");
const ROLLBACK = read("docs/project_platform_large_projects_ROLLBACK.sql");
const IMPORT_SQL = read("docs/project_bulk_import_RUNME.sql");
const IMPORT_PRE = read("docs/project_bulk_import_PREFLIGHT.sql");
const IMPORT_POST = read("docs/project_bulk_import_POSTCHECK.sql");
const LIB = read("lib/portal/large-projects.ts");
const BACKEND = read("lib/portal/import/batchBackend.ts");
const RPC = read("lib/portal/import/rpc.ts");

/** الحقول التي لا يجوز أن تسكن public.deliverables أبدًا. */
const SECRET = [
  "internal_notes", "external_key", "import_batch_id",
  "source_row_number", "source_file_name", "metadata",
];

// ─── (أ) الأعمدة غادرت الجدول الذي يقرؤه العميل ────────────────────────────

test("لا واحد من الحقول الستّة يُضاف إلى public.deliverables", () => {
  for (const col of SECRET) {
    assert.doesNotMatch(
      RUNME,
      new RegExp(`alter table public\\.deliverables add column if not exists\\s+${col}\\b`),
      `${col} ما زال يُضاف إلى deliverables — التسريب حيّ`);
  }
});

test("الجدول الجانبي يُنشأ بمفتاح 1:1 وحذف متتالٍ", () => {
  const m = RUNME.match(/create table if not exists public\.deliverable_internal \(([\s\S]*?)\n\);/);
  assert.ok(m, "public.deliverable_internal غير مُنشأ");
  const body = m[1];
  assert.match(body, /deliverable_id\s+uuid primary key references public\.deliverables\(id\) on delete cascade/);
  for (const col of SECRET) {
    assert.match(body, new RegExp(`\\b${col}\\b`), `${col} مفقود من الجدول الجانبي`);
  }
  assert.match(body, /metadata\s+jsonb not null default '\{\}'::jsonb/);
});

test("الفحص الذاتي يُجهض إن بقي أيّ حقل داخلي على deliverables", () => {
  const m = RUNME.match(/-- \(1ب\)[\s\S]*?end loop;/);
  assert.ok(m, "فحص «الحقول غادرت» مفقود من §10");
  for (const col of SECRET) assert.match(m[0], new RegExp(`'${col}'`));
  assert.match(m[0], /ما زال على deliverables/);
});

// ─── (ب) العميل يحصل على صفر صفوف — لا أعمدة مُصفّاة ───────────────────────

test("RLS مفعّلة وسياستان، وكل مُسنِد فيهما coalesce(...,false)", () => {
  assert.match(RUNME, /alter table public\.deliverable_internal enable row level security/);
  const policies = [...RUNME.matchAll(
    /create policy deliverable_internal_(read|write) on public\.deliverable_internal[\s\S]*?;/g)];
  assert.equal(policies.length, 2, "يُتوقَّع سياستان بالضبط");
  for (const p of policies) {
    assert.match(p[0], /to authenticated/, "السياسة يجب أن تُقيَّد بـ authenticated");
    const preds = [...p[0].matchAll(/(using|with check)\s*\(([\s\S]*?)\)\s*(?=\n|with check|;)/g)];
    assert.ok(preds.length >= 1, "لا مُسنِد في السياسة");
    for (const pred of preds) {
      assert.match(pred[2], /coalesce\(/, "مُسنِد بلا coalesce قد ينهار إلى NULL");
      assert.match(pred[2], /,\s*false\)/, "coalesce يجب أن يسقط إلى false لا true");
      assert.match(pred[2], /deliverable_internal_is_staff/);
    }
  }
});

test("البوّابة fail-closed: كل نداء خارجيّ داخل begin/exception ويعود false", () => {
  const m = RUNME.match(
    /create or replace function public\.deliverable_internal_is_staff\(p_deliverable uuid\)([\s\S]*?)\$\$;/);
  assert.ok(m, "دالّة البوّابة مفقودة");
  const fn = m[1];
  assert.match(fn, /security definer/);
  assert.match(fn, /set search_path = public/);
  assert.match(fn, /if p_deliverable is null then return false/);
  // كل استدعاء لدالّة صلاحيات محميّ باستثناء يسقط إلى false.
  for (const gate of ["is_admin", "can_manage_projects", "is_kian_member"]) {
    assert.match(fn, new RegExp(`coalesce\\(public\\.${gate}\\(`), `${gate} بلا coalesce`);
  }
  const excepts = fn.match(/exception when others then/g) ?? [];
  assert.ok(excepts.length >= 4, "نداء غير معزول باستثناء ⇒ خطأ واحد يُفجّر السياسة");
  assert.doesNotMatch(fn, /return true;\s*end \$\$/, "لا يجوز أن ينتهي المسار الافتراضي بـ true");
  // حاجز مضاد للعميل صريح.
  assert.match(fn, /if coalesce\(public\.is_client_side\(v_proj\), false\) then return false/);
});

test("لا منح لـ anon على الجدول الجانبي، والمنح لـ authenticated وحده", () => {
  assert.match(RUNME, /revoke all on public\.deliverable_internal from public, anon;/);
  assert.match(RUNME, /grant select, insert, update, delete on public\.deliverable_internal to authenticated;/);
  assert.match(RUNME, /revoke all on function public\.deliverable_internal_is_staff\(uuid\) from public, anon;/);
  assert.doesNotMatch(RUNME, /grant[^;\n]*deliverable_internal[^;\n]*to[^;\n]*anon/i);
});

test("client_visible يبقى على deliverables — راية ظهور لا سرّ", () => {
  assert.match(RUNME, /alter table public\.deliverables add column if not exists client_visible\s+boolean/);
  assert.match(RUNME, /coalesce\(client_visible, true\) = true/, "سياسة القراءة ما زالت تفرض الإخفاء");
});

// ─── (ج) idempotency الاستيراد انتقل سليمًا ────────────────────────────────

test("الفهرس الفريد الجزئيّ انتقل إلى الجدول الجانبي وبقي جزئيًّا", () => {
  assert.match(RUNME,
    /create unique index if not exists ux_deliverable_internal_external_key\s*\n\s*on public\.deliverable_internal \(external_key\) where external_key is not null;/);
  assert.doesNotMatch(RUNME, /create unique index[^;]*on public\.deliverables \(external_key\)/,
    "الفهرس القديم على deliverables ما زال يُنشأ");
  assert.match(POST, /ux_deliverable_internal_external_key/);
  assert.match(IMPORT_SQL, /ux_deliverable_internal_external_key/);
});

test("تكرار المفاتيح يُكتشف قبل إنشاء الفهرس بدل خطأ غامض", () => {
  const m = RUNME.match(/do \$ux\$([\s\S]*?)\$ux\$;/);
  assert.ok(m, "فحص التكرار قبل الفهرس مفقود");
  assert.match(m[1], /group by external_key having count\(\*\) > 1/);
  assert.match(m[1], /raise exception/);
});

test("الاستيراد يبحث عن المفتاح عبر الجدول الجانبي في كل مسار", () => {
  const lookups = [...IMPORT_SQL.matchAll(/from public\.deliverable_internal i\s*\n\s*join public\.deliverables d on d\.id = i\.deliverable_id/g)];
  assert.ok(lookups.length >= 2, "يُتوقَّع بحثان: المعاينة + إعادة الفحص داخل المعاملة (TOCTOU)");
  assert.doesNotMatch(IMPORT_SQL, /from public\.deliverables\s*\n\s*where external_key =/,
    "بحث قديم يقرأ external_key من deliverables");
});

test("الإدراج: deliverables بلا الحقول الداخلية، والجدول الجانبي يتلقّاها", () => {
  const ins = IMPORT_SQL.match(/insert into public\.deliverables \(([\s\S]*?)\)\s*\n\s*values/);
  assert.ok(ins, "إدراج المخرج غير موجود");
  for (const col of SECRET) {
    assert.doesNotMatch(ins[1], new RegExp(`\\b${col}\\b`), `${col} ما زال يُكتب على deliverables`);
  }
  const side = IMPORT_SQL.match(/insert into public\.deliverable_internal \(([\s\S]*?)\)\s*\n\s*values/);
  assert.ok(side, "إدراج الجدول الجانبي مفقود ⇒ المفتاح يضيع وidempotency تنهار");
  for (const col of SECRET) assert.match(side[1], new RegExp(`\\b${col}\\b`));
  assert.match(side[1], /deliverable_id/);
});

test("سباق unique_violation ما زال «تخطّيًا» ويلتقط الصفّ الفائز من الجدول الجانبي", () => {
  const m = IMPORT_SQL.match(/when unique_violation then([\s\S]*?)when others then/);
  assert.ok(m, "معالج السباق مفقود");
  assert.match(m[1], /from public\.deliverable_internal i where i\.external_key = v_key/);
  assert.match(m[1], /status='skipped'/);
});

test("الاستيراد يرفض العمل إن كان التسريب ما زال حيًّا", () => {
  assert.match(IMPORT_SQL, /ما-زال-موجودًا/, "§0 لا يرفض بقاء الأعمدة على deliverables");
  assert.match(IMPORT_PRE, /ما-زال-موجودًا/);
  assert.match(IMPORT_POST, /deliverable_internal/);
});

// ─── (د) الترحيل يعمل في الحالتين ولا يفقد بايتًا ──────────────────────────

test("الترحيل: نقل ⇐ تحقّق ⇐ إسقاط — بهذا الترتيب حصرًا", () => {
  const m = RUNME.match(/do \$mig\$([\s\S]*?)\$mig\$;/);
  assert.ok(m, "كتلة الترحيل مفقودة");
  const mig = m[1];
  const iIns = mig.indexOf("insert into public.deliverable_internal");
  const iChk = mig.indexOf("not exists (select 1 from public.deliverable_internal i where i.deliverable_id = d.id)");
  const iDrop = mig.indexOf("drop column if exists");
  assert.ok(iIns > -1 && iChk > iIns, "التحقّق يجب أن يلي النقل");
  assert.ok(iDrop > iChk, "الإسقاط يجب أن يلي التحقّق — لا إسقاط بلا يقين");
  assert.match(mig, /raise exception[^;]*لم يُنقَل/, "لا استثناء يُجهض عند صفّ لم يُنقَل");
});

test("الحالة النظيفة: لا أعمدة قديمة ⇒ لا ترحيل ولا إسقاط", () => {
  const mig = RUNME.match(/do \$mig\$([\s\S]*?)\$mig\$;/)[1];
  assert.match(mig, /if cardinality\(v_src\) = 0 then/);
  assert.match(mig, /تطبيق نظيف/);
});

test("عرض أو سياسة تعتمد على عمود سيُسقَط تُوقف الترحيل برسالة مفهومة", () => {
  const mig = RUNME.match(/do \$mig\$([\s\S]*?)\$mig\$;/)[1];
  assert.match(mig, /pg_rewrite/);
  assert.match(mig, /relkind in \('v','m'\)/);
  assert.match(mig, /pg_policy/, "تبعية سياسة RLS غير مفحوصة ⇒ إسقاط يفشل في المنتصف");
  assert.match(mig, /raise exception[^;]*كائنات تعتمد/);
});

test("خطر DROP COLUMN معلن بصوت عالٍ في كل ملفّ يمسّه", () => {
  assert.match(RUNME, /DROP COLUMN لا يُسترجع/);
  assert.match(RUNME, /يُسقط ستّة أعمدة/);
  assert.match(PRE, /يُسقط العمود/);
  assert.match(PRE, /لوحة الترحيل الداخلي/);
  assert.doesNotMatch(RUNME, /⛔ لا DROP TABLE · لا DROP COLUMN/,
    "الرأس ما زال يدّعي أنه لا يُسقط أعمدة — ادّعاء كاذب الآن");
});

test("التراجع: §T1 لا يمسّ الجدول الجانبي، و§T2 يُسقطه قبل دالّته", () => {
  const t1 = ROLLBACK.slice(ROLLBACK.indexOf("§T1)"), ROLLBACK.indexOf("§T2)"));
  assert.doesNotMatch(t1, /drop table if exists public\.deliverable_internal/);
  assert.doesNotMatch(t1, /drop function if exists public\.deliverable_internal_is_staff/);
  assert.doesNotMatch(t1, /drop index if exists public\.ux_deliverable_internal_external_key/,
    "إسقاط فهرس idempotency في التعطيل الآمن يفتح باب التكرار الصامت");
  const t2 = ROLLBACK.slice(ROLLBACK.indexOf("§T2)"));
  const iTable = t2.indexOf("drop table    if exists public.deliverable_internal");
  const iFn = t2.indexOf("drop function if exists public.deliverable_internal_is_staff");
  assert.ok(iTable > -1 && iFn > iTable, "الجدول يُسقَط قبل الدالّة التي تعتمد عليها سياساته");
  for (const col of SECRET) {
    assert.doesNotMatch(t2, new RegExp(`alter table public\\.deliverables drop column if exists ${col}`),
      `${col} ما زال مذكورًا كعمود على deliverables في §T2`);
  }
});

// ─── (هـ) الواجهة: لا select لعمود لم يعد موجودًا ──────────────────────────

test("LP_OPTIONAL_COLUMNS لا تحوي أيّ حقل داخلي", () => {
  const block = LIB.match(/LP_OPTIONAL_COLUMNS = \[([\s\S]*?)\] as const;/);
  assert.ok(block);
  for (const col of SECRET) {
    assert.doesNotMatch(block[1], new RegExp(`"${col}"`),
      `${col} ما زال ضمن select على deliverables ⇒ 42703 بعد الترحيلة`);
  }
});

test("LP_INTERNAL_COLUMNS مطابقة حرفيًّا لتعريف الجدول الجانبي", () => {
  const block = LIB.match(/LP_INTERNAL_COLUMNS = \[([\s\S]*?)\] as const;/);
  assert.ok(block, "LP_INTERNAL_COLUMNS مفقودة");
  const cols = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(cols.slice().sort(), SECRET.slice().sort(), "الواجهة تتحدّث مفردات غير موجودة");
  const table = RUNME.match(/create table if not exists public\.deliverable_internal \(([\s\S]*?)\n\);/)[1];
  for (const col of cols) assert.match(table, new RegExp(`\\b${col}\\b`));
  assert.match(LIB, /LP_INTERNAL_TABLE = "deliverable_internal"/);
});

test("الدمج يمرّ عبر الجدول الجانبي ويُجزّئ المعرّفات", () => {
  assert.match(LIB, /async function mergeInternal/);
  assert.match(LIB, /\$\{LP_INTERNAL_TABLE\}\?deliverable_id=in\.\(/);
  assert.match(LIB, /LP_INTERNAL_CHUNK/, "طلب بلا تجزئة قد يتجاوز حدّ طول العنوان");
  assert.match(LIB, /degraded\.push\("deliverable_internal"\)/, "إخفاق الدمج يُعلَن بدل الصمت");
});

test("كشف القدرات: غياب الجدول/العمود ⇒ تعطيل هادئ لا سقوط", () => {
  const m = LIB.match(/async function probeInternal\(\)[\s\S]*?\n\}/);
  assert.ok(m, "probeInternal مفقودة");
  // الغياب يُقاس بمُسنِدات مسمّاة تغطّي أيضًا ذاكرة المخطط القديمة (PGRST204/205)
  // بدل مقارنة نصّية بصنف واحد مدموج.
  assert.match(m[0], /lpObjectUnavailable\(kind\)/);
  assert.match(m[0], /lpColumnUnavailable\(kind\)/);
  assert.match(LIB, /internal: boolean/);
  assert.match(LIB, /if \(caps\.internal && deliverables\.length > 0\)/);
});

test("صفر صفوف عند العميل ليس عطلًا — موثَّق في الطبقة", () => {
  assert.match(LIB, /صفر صفوف/);
  assert.match(LIB, /تُصفّي الصفوف ولا تُصفّي الأعمدة/);
});

test("لا مكان في الشيفرة يطلب حقلًا داخليًّا من جدول deliverables", () => {
  const SRC_DIRS = ["lib", "components", "app"];
  const files = [];
  const walk = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e.name)) files.push(rel);
    }
  };
  SRC_DIRS.forEach(walk);
  const bad = [];
  // التعليقات تشرح الثغرة نفسها (وفيها المثال الحرفيّ) ⇒ تُستبعَد من الفحص.
  const stripComments = (src) => src.split("\n")
    .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
    .join("\n");
  for (const f of files) {
    for (const m of stripComments(read(f)).matchAll(/deliverables\?[^`"'\n]*select=([^&`"'\n]*)/g)) {
      for (const col of SECRET) {
        if (new RegExp(`(^|,)${col}(,|$)`).test(m[1])) bad.push(`${f}: ${col}`);
      }
    }
  }
  assert.deepEqual(bad, [], `select لحقل داخلي من deliverables: ${bad.join(" | ")}`);
});

// ─── (و) عقد طبقة الاستيراد معلن لا شفويّ ─────────────────────────────────

test("طبقة الاستيراد تُصرّح أين تهبط الحقول الداخلية", () => {
  assert.match(BACKEND, /DB_INTERNAL_TABLE = "deliverable_internal"/);
  assert.match(BACKEND, /DB_INTERNAL_PAYLOAD_KEYS = \["internal_notes", "metadata"\] as const/);
  assert.match(BACKEND, /filters ROWS, not\n\/\/    COLUMNS/);
  assert.match(RPC, /ux_deliverable_internal_external_key/);
  assert.match(RPC, /WHERE external_key IS NOT NULL/);
});

test("SAFE: قراءة ملفّات فقط — لا شبكة ولا قاعدة بيانات", () => {
  assert.doesNotMatch(read("tests/deliverable_internal_isolation.test.js"), /require\("node:(net|http)/);
});
