// ════════════════════════════════════════════════════════════════════════════
// tests/wave6_assets_archive_compliance.test.js
//
// Wave 6 — الأصول والأرشيف والامتثال والمعرفة.
// V2-6.1-A/D · V2-6.2 · V2-6.3 · V2-6.4 · V2-6.5 · V2-6.6
//
// ⛔ لا SQL يُشغَّل · لا قاعدة · لا شبكة · لا رفع ملفّات · لا حذف.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const has = (r) => fs.existsSync(path.join(ROOT, r));

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
const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const bodyOf = (src, name) => {
  const t = noComments(src);
  const i = t.indexOf(`function public.${name}`);
  return i < 0 ? "" : t.slice(i, t.indexOf("$$;", i));
};

const AA = () => read("docs/wave6_assets_archive_RUNME.sql");
const CK = () => read("docs/wave6_compliance_knowledge_RUNME.sql");
const QR_PAGE = () => read("app/(ar)/e/[token]/page.tsx");
/**
 * الصفحة بلا تعليقات. ⚠️ `noComments` يجرّد تعليقات SQL (`--`) لا تعليقات
 * JS (`//`) — والصفحة TSX، وترويستها تشرح أنّ الحمولة مسحوبة، فتُفسد أيّ بحث خامّ.
 */
const QR_CODE = () =>
  QR_PAGE().replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");

const catches = (label, src, mutate, check) => {
  const m = mutate(src);
  assert.notEqual(m, src, `الطفرة لم تغيّر شيئًا: ${label}`);
  let threw = false;
  try { check(m); } catch { threw = true; }
  assert.ok(threw, `🔴 الطفرة لم تُرصد: ${label}`);
};

// ═══ الحزم ══════════════════════════════════════════════════════════════════

test("(W-1) ★★ الحزمتان كاملتان ★★", () => {
  for (const p of ["assets_archive", "compliance_knowledge"]) {
    for (const n of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
      assert.ok(has(`docs/wave6_${p}_${n}.sql`), `wave6_${p}_${n} مفقود`);
    }
  }
});

// ═══ لا أنظمة موازية ════════════════════════════════════════════════════════

test("(N-1) ★★★ لا نظام أصول ولا عهدة ولا صيانة ولا سجلّ تدقيق ثانٍ ★★★", () => {
  for (const [name, src] of [["assets_archive", AA()], ["compliance_knowledge", CK()]]) {
    const c = codeOnly(src);
    for (const bad of ["assets", "equipment", "equipment_usage_log", "maintenance_schedule",
                       "custody_assignments", "audit_log", "activity_logs", "incidents",
                       "hse_incidents", "compliance_registry", "sops", "knowledge_articles",
                       "employees", "projects"]) {
      assert.doesNotMatch(c, new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${bad}\\b`, "i"),
        `🔴 ${name}: نظام موازٍ — ${bad}`);
    }
    // ⛔ ولا كتابة في الأنظمة القائمة.
    for (const frozen of ["custody_inventory_assets", "ops_incidents", "custody_incidents",
                          "ops_job_hse", "ai_knowledge_sources", "project_archives"]) {
      assert.doesNotMatch(c, new RegExp(`\\balter table public\\.${frozen}\\b`, "i"),
        `🔴 ${name}: تعديل نظام قائم خارج النطاق — ${frozen}`);
      assert.doesNotMatch(c, new RegExp(`\\bdelete\\s+from\\s+public\\.${frozen}\\b`, "i"),
        `🔴 ${name}: حذف من نظام قائم — ${frozen}`);
    }
  }
});

test("(N-2) ★★★ سجلّ HSE عرض مشتقّ يقرأ المصادر الثلاثة — ولا رابع ★★★", () => {
  const c = codeOnly(CK());
  assert.match(c, /create or replace view public\.hse_register_v/i, "ليس عرضًا");
  assert.doesNotMatch(c, /materialized\s+view/i, "🔴 عرض مادّيّ = نسخة تتقادم");
  const v = c.slice(c.indexOf("create or replace view public.hse_register_v"));
  const body = v.slice(0, v.indexOf(";"));
  for (const src of ["ops_job_hse", "ops_incidents", "custody_incidents"]) {
    assert.ok(body.includes(src), `🔴 العرض لا يقرأ ${src}`);
  }
  // ⛔ ولا كتابة في أيّ منها.
  for (const re of [/\binsert\s+into\b/i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i]) {
    assert.doesNotMatch(body, re, "🔴 العرض يكتب في مصدر");
  }

  catches("تحويل سجلّ HSE إلى جدول", CK(),
    (m) => m.replace("create or replace view public.hse_register_v as",
                     "create table if not exists public.hse_register_v as"),
    (m) => assert.match(codeOnly(m), /create or replace view public\.hse_register_v/i));
});

test("(N-3) ★★★ قاعدة المعرفة قائمة — الإجراء وثيقة فيها لا جدول جديد ★★★", () => {
  const c = codeOnly(CK());
  // 🔴 جدول `sops` كان سيصير قاعدة معرفة ثانية.
  assert.doesNotMatch(c, /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?sops\b/i,
    "🔴 قاعدة معرفة ثانية");
  // والخطوات وحدها جديدة، ومرتبطة بالوثيقة القائمة.
  assert.match(c, /create table if not exists public\.sop_items/i, "خطوات الإجراء مفقودة");
  assert.match(c, /source_id\s+uuid not null references public\.ai_knowledge_sources\(id\)/i,
    "🔴 الخطوات غير مرتبطة بقاعدة المعرفة القائمة");
  // الوثيقة تُقرأ بنوعها القائم — لا مفردة جديدة.
  assert.match(noComments(CK()), /source_type = 'operations_procedure'/,
    "🔴 لا يستعمل نوع الإجراء القائم");
  // والرؤية تتبع الوثيقة الأمّ لا مسارًا ثانيًا.
  assert.match(c, /using \(exists \(select 1 from public\.ai_knowledge_sources s where s\.id = source_id\)\)/i,
    "🔴 مسار صلاحية ثانٍ للخطوات");
});

test("(N-4) ★★ إرفاق الإجراء يعيد استعمال قوائم المهامّ القائمة ★★", () => {
  const fn = bodyOf(CK(), "sop_attach_to_task");
  assert.match(fn, /insert into public\.project_task_checklists/i, "🔴 جدول قوائم ثانٍ");
  // 🔴 مسوّدة لا تُفرَض على طاقم.
  assert.match(fn, /s\.status = 'approved'/, "🔴 إجراء غير معتمَد يُرفَق");
  assert.match(fn, /sop_not_approved/, "لا رفض صريح");
  // ⛔ ولا يمحو قائمة قائمة قد تكون نصف منجَزة.
  assert.match(fn, /coalesce\(max\(sort_order\), 0\)/, "🔴 يمحو ترتيب القائمة القائمة");
  assert.doesNotMatch(fn, /delete\s+from\s+public\.project_task_checklists/i,
    "🔴 يحذف قائمة قائمة");
  // ولا تكرار.
  assert.match(fn, /if not exists \([\s\S]{0,200}c\.label = r\.label_ar/, "🔴 يكرّر البنود");
});

// ═══ V2-6.1-A · صفحة QR ═════════════════════════════════════════════════════

test("(Q-1) ★★★ الصفحة لا تؤكّد وجود رمز لمجهول ★★★", () => {
  const p = QR_PAGE();
  // 🔴 عقد الأمان §٥: بحث مجهول ولو بحمولة فقيرة يعطي مجهولًا تأكيد أنّ رمزًا حقيقيّ.
  assert.match(p, /custody_inv_qr_scan/, "🔴 لا تمرّ عبر المدخل الوحيد");
  assert.doesNotMatch(QR_CODE(), /custody_inv_qr_public_payload/,
    "🔴 تنادي الحمولة مباشرةً — فتتجاوز تحديد المعدّل والتدقيق");
  // غير المسجَّل والمجهول يُعامَلان بنفس الحالة تمامًا.
  assert.match(p, /r\.status === 401[\s\S]{0,80}setPhase\(\{ k: "anon" \}\)/,
    "🔴 غير المسجَّل يُميَّز عن المجهول");
  // والرسالة المحايدة لا تنفي ولا تؤكّد.
  const anon = p.slice(p.indexOf('case "anon"'), p.indexOf('case "denied"'));
  assert.doesNotMatch(anon, /غير صحيح|غير موجود|رمز خاطئ|invalid/i,
    "🔴 الرسالة المحايدة تنفي وجود الرمز");
  // «غير موجود» و«ملغى» حالتان منفصلتان لا يصل إليهما مجهول.
  assert.match(p, /case "not_found"/, "لا حالة رمز مجهول");
  assert.match(p, /case "revoked"/, "لا حالة ملصق ملغى");
});

test("(Q-2) ★★★ لا مال ولا شخص ولا مسار ولا uuid على الصفحة ★★★", () => {
  const p = QR_PAGE();
  // قائمة بيضاء صريحة — لا عرض عامّ لكلّ ما يعود.
  assert.match(p, /const FIELDS/, "🔴 لا قائمة بيضاء للحقول");
  assert.doesNotMatch(p, /Object\.keys\(phase\.data\)\.map|Object\.entries\(phase\.data\)/,
    "🔴 تعرض كلّ ما يعود من الخادم بلا قائمة بيضاء");
  // ⛔ الممنوعات في عقد الأمان §٤.
  for (const banned of ["purchase_price", "current_value", "book_value", "employee_user_id",
                        "file_path", "supplier_name", "invoice_number", "asset_id"]) {
    assert.ok(!p.includes(banned), `🔴 حقل ممنوع على ملصق عامّ: ${banned}`);
  }

  catches("عرض كلّ ما يعود من الخادم", QR_PAGE(),
    (m) => m.replace("const shown = FIELDS.filter((f) => {",
                     "const shown = Object.keys(phase.data).map((k) => ({ key: k, ar: k })).filter((f) => {"),
    (m) => assert.doesNotMatch(m, /Object\.keys\(phase\.data\)/));
});

// ═══ V2-6.1-D · تغطية التأمين ═══════════════════════════════════════════════

test("(A-1) ★★ الفجوة الوحيدة: ربط الوثيقة بالأصل — بعلاقة متعدّد لمتعدّد ★★", () => {
  const c = codeOnly(AA());
  assert.match(c, /create table if not exists public\.asset_insurance_coverage/i, "الربط مفقود");
  // 🔴 لا عمود على الأصل: وثيقة تغطّي أصولًا كثيرة، وأصل قد تغطّيه وثيقتان.
  assert.doesNotMatch(c, /alter table public\.custody_inventory_assets/i,
    "🔴 عمود على جدول الأصول — يفرض وثيقة واحدة لكلّ أصل");
  assert.match(c, /references public\.asset_insurance_policies\(id\)/i, "لا مرجع للوثيقة");
  assert.match(c, /aic_window/, "لا قيد يمنع نهاية قبل بداية");
});

// ═══ V2-6.2 · الأرشيف ═══════════════════════════════════════════════════════

test("(R-1) ★★★ الأرشيف ليس حذفًا · والاسترجاع واضح · ولا يستبدل أرشيف الإغلاق ★★★", () => {
  const c = codeOnly(AA());
  // ⛔ لا يمسّ project_archives القائم (أرشيف إغلاق مشروع بسياسة احتفاظ).
  assert.doesNotMatch(c, /alter table public\.project_archives|drop table[^;]*project_archives/i,
    "🔴 يمسّ أرشيف الإغلاق القائم");
  // حالة الرابط تقول أين المادّة — لا أنّها ذهبت.
  // ⚠️ على noComments لا codeOnly: القيم سلاسل نصّية وcodeOnly يمحوها.
  const sa = noComments(AA());
  assert.match(sa, /link_status\s+text not null default 'stored'/i, "لا حالة للمادّة المؤرشَفة");
  assert.match(sa, /'stored','verified','migrated','missing'/, "🔴 لا حالة «مفقود» — الفقد يُخفى");
  // ⛔ ولا حذف نهائيّ في الحزمة.
  for (const re of [/drop\s+table(?!\s+if\s+exists\s+public\.(archive|music|model|asset_insurance_coverage))/i,
                    /truncate/i, /delete\s+from/i]) {
    assert.doesNotMatch(c, re, "🔴 الحزمة تحذف");
  }
  // صحّة الوسيط تُدخَل ولا تُستنتَج.
  assert.match(sa, /health_status\s+text not null default 'unknown'/i,
    "🔴 صحّة الوسيط مفترضة لا مُدخَلة");
  // والسعة المستعمَلة لا تتجاوز الإجمالية.
  assert.match(c, /archive_media_capacity/, "🔴 مساحة مستعمَلة تفوق السعة ممكنة");
});

// ═══ V2-6.5 · إقرارات الظهور — PDPL ═════════════════════════════════════════

test("(P-1) ★★★ أقلّ بيانات شخصية · ولا رابط مخزَّن · وحقّ السحب ★★★", () => {
  const s = noComments(AA());
  const ddl = s.slice(s.indexOf("create table if not exists public.model_releases"));
  const body = ddl.slice(0, ddl.indexOf("\n);"));
  // ⛔ PDPL: لا هويّة ولا عنوان ولا ميلاد.
  for (const pii of ["national_id", "iqama", "passport", "address", "date_of_birth", "dob"]) {
    assert.ok(!body.includes(pii), `🔴 بيان شخصيّ زائد: ${pii}`);
  }
  // ⛔ ولا رابط مخزَّن — bucket+path فقط، مع قيد يمنع دسّ رابط.
  assert.ok(!/\b(url|href|signed_url|public_url)\b/i.test(body), "🔴 عمود رابط في مستند خاصّ");
  assert.match(body, /doc_path\s+text/, "لا مسار للمستند");
  assert.match(s, /doc_path !~\* '\^https\?:/, "🔴 لا قيد يمنع رابطًا كاملًا في حقل المسار");
  // 🔴 حقّ السحب — PDPL يوجبه، والسحب يوجب وقتًا.
  assert.match(body, /withdrawn_at/, "🔴 لا حقّ سحب");
  assert.match(s, /mr_withdrawn_pair/, "🔴 سحب بلا وقت ممكن");

  catches("إضافة رقم هويّة", AA(),
    (m) => m.replace("  person_name   text not null", "  national_id   text,\n  person_name   text not null"),
    (m) => {
      const ss = noComments(m);
      const d = ss.slice(ss.indexOf("create table if not exists public.model_releases"));
      assert.ok(!d.slice(0, d.indexOf("\n);")).includes("national_id"));
    });
});

test("(P-2) ★★★ ملخّص الحقوق لا يطبع اسم شخص ★★★", () => {
  const fn = bodyOf(AA(), "project_rights_summary");
  assert.ok(fn.length > 0, "الدالّة مفقودة");
  // ⛔ الملخّص قابل للطباعة ويُشارَك — فلا اسم فيه، عدد وحالة فقط.
  assert.ok(!fn.includes("person_name"), "🔴 اسم شخص في ملخّص قابل للطباعة");
  assert.ok(!fn.includes("contact_ref"), "🔴 وسيلة تواصل في ملخّص قابل للطباعة");
  assert.match(fn, /'total', count\(\*\)/, "لا عدّ للإقرارات");
  assert.match(fn, /'withdrawn'/, "🔴 لا يُظهر المسحوب — فيُقرأ كأنّه ساري");
  // والترخيص المنتهي يُعلن منتهيًا ولو بقي مربوطًا.
  assert.match(fn, /'expired', \(m\.expires_at is not null and m\.expires_at < current_date\)/,
    "🔴 ترخيص منتهٍ يُقرأ ساريًا");

  catches("طباعة اسم الشخص", AA(),
    (m) => m.replace("           'total', count(*),", "           'names', jsonb_agg(person_name),\n           'total', count(*),"),
    (m) => assert.ok(!bodyOf(m, "project_rights_summary").includes("person_name")));
});

// ═══ الأمن العامّ ═══════════════════════════════════════════════════════════

test("(G-1) ★★★ RLS deny-by-default · لا شيء لـanon · لا سياسة كتابة ★★★", () => {
  for (const [name, src] of [["assets_archive", AA()], ["compliance_knowledge", CK()]]) {
    const c = codeOnly(src);
    assert.match(c, /enable row level security/i, `🔴 ${name}: بلا RLS`);
    // كلّ جدول يُنشأ يجب أن يُفعَّل عليه RLS ويُسحب عن anon.
    for (const m of c.matchAll(/create table if not exists public\.([a-z_]+)/gi)) {
      assert.match(c, new RegExp(`alter table public\\.${m[1]}\\s+enable row level security`, "i"),
        `🔴 ${name}: ${m[1]} بلا RLS`);
      assert.match(c, new RegExp(`revoke all on public\\.${m[1]}\\s+from anon, public`, "i"),
        `🔴 ${name}: ${m[1]} بلا REVOKE عن anon`);
    }
    assert.doesNotMatch(c, /create policy[^;]*for\s+(insert|update|delete)/i,
      `🔴 ${name}: سياسة كتابة تتجاوز الدوالّ المحروسة`);
    assert.doesNotMatch(c, /grant\s+all\b/i, `🔴 ${name}: منح شامل`);
    assert.doesNotMatch(c, /grant execute on function[^;]*\banon\b/i, `🔴 ${name}: دالّة لـanon`);
    // security definer دائمًا بـsearch_path مثبَّت.
    const defs = (c.match(/security\s+definer/gi) || []).length;
    const paths = (c.match(/set\s+search_path\s*=\s*public/gi) || []).length;
    assert.equal(defs, paths, `🔴 ${name}: ${defs - paths} دالّة بلا search_path مثبَّت`);
    // وكلّ دالّة لها REVOKE.
    for (const m of c.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)) {
      assert.match(c, new RegExp(`revoke all on function public\\.${m[1]}\\(`),
        `🔴 ${name}: ${m[1]} بلا REVOKE`);
    }
  }
});

test("(G-2) ★★ إضافيّ · idempotent · PREFLIGHT/POSTCHECK لا يكتبان ★★", () => {
  for (const p of ["assets_archive", "compliance_knowledge"]) {
    const c = codeOnly(read(`docs/wave6_${p}_RUNME.sql`));
    assert.match(c, /^\s*begin;/im, `${p}: بلا معاملة`);
    assert.match(c, /commit;/i, `${p}: بلا commit`);
    for (const m of c.matchAll(/create table (if not exists )?/gi)) {
      assert.ok(m[1], `🔴 ${p}: create table بلا if not exists`);
    }
    for (const n of ["PREFLIGHT", "POSTCHECK"]) {
      const q = codeOnly(read(`docs/wave6_${p}_${n}.sql`));
      for (const re of [/\bcreate\s+(table|function|index|view|trigger)/i, /\balter\s+table/i,
                        /\binsert\s+into/i, /\bdelete\s+from/i, /\bdrop\s+/i]) {
        assert.doesNotMatch(q, re, `🔴 wave6_${p}_${n} يكتب`);
      }
    }
  }
});

test("(G-3) ★★★ لا ادّعاء امتثال ولا سياسة مخترعة ★★★", () => {
  const blob = AA() + CK() + QR_PAGE();
  // ⛔ لا شهادة ولا اعتماد ولا SLA ولا ضمان مخترع.
  for (const re of [/\bISO\s*\d{4,5}\b/i, /\bcertified\b/i, /معتمَد من/, /شهادة (اعتماد|امتثال)/,
                    /\bSLA\b/, /نضمن\b/, /سياسة السلامة المعتمدة/]) {
    assert.doesNotMatch(blob, re, "🔴 ادّعاء امتثال أو اعتماد لا سند له");
  }
  // ولا بيانات أعمال مخترعة في RUNME.
  for (const [name, src] of [["assets_archive", AA()], ["compliance_knowledge", CK()]]) {
    const ddlOnly = codeOnly(src).replace(/\$\$[\s\S]*?\$\$/g, " ");
    assert.doesNotMatch(ddlOnly, /\binsert\s+into\s+public\./i,
      `🔴 ${name}: يزرع بيانات — والجداول تُنشأ فارغة`);
  }
});
