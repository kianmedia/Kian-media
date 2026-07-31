// ════════════════════════════════════════════════════════════════════════════
// tests/asset_naming_honesty.test.js
//
// asset_intelligence_RUNME.sql سقط على الإنتاج بـ:
//     ASSET SELF-TEST: الإشارات تُسمّى تنبّؤية (ai_) — هي قواعد صريحة
// والفحص كان:  v_def ilike '%' || f || '%'   مع f = 'ai_'
//
// ★ الآلية الجديدة ★ الشرطة السفلية في LIKE/ILIKE **محرف بدل** يطابق أيّ محرف
//   واحد. فـ'%ai_%' معناه «ai يتبعها أيّ محرف» لا «يبدأ بـai_». طابق ٢٨ موضعًا،
//   أوّلها اسم الدالّة نفسها custody_inv_m·ai·ntenance_signals، ثمّ
//   days_rem·ai·ning و r·ai·se. ولا معرّف واحد يبدأ فعلًا بـai_.
//
// هذه خامس مرّة يسقط فيها فحصٌ لأنّه طابق **اسمًا** بدل **شكل**، لكنّها المرّة
// الأولى بهذه الآلية: لا تعليقٌ ولا سلسلة، بل محرف بدل غير مقصود. لذلك يحرس
// هذا الملفّ أمرين معًا: هروب الشرطة السفلية، والحكم على الأسماء الحيّة.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const RUNME = () => read("docs/asset_intelligence_RUNME.sql") || "";

/** يحذف تعليقات `--` ويُبقي السلاسل — الشرح ليس واجهة. */
function noComments(sql) {
  return sql.split("\n").map((l) => {
    let q = false;
    for (let i = 0; i < l.length; i++) {
      if (l[i] === "'") q = !q;
      else if (!q && l[i] === "-" && l[i + 1] === "-") return l.slice(0, i);
    }
    return l;
  }).join("\n");
}

// ─── (أ) فخّ محرف البدل ─────────────────────────────────────────────────────

test("(١) ★★ لا LIKE/ILIKE بمتغيّر يحمل شرطة سفلية بلا هروب ★★", () => {
  const code = noComments(RUNME());
  const bad = [];
  const lines = code.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/i?like\s+'%'\s*\|\|\s*([a-z_][a-z0-9_]*)\s*\|\|\s*'%'/i);
    if (!m) continue;
    if (/escape/i.test(lines[i])) continue;                 // مهروب صراحةً
    // ما القيم التي يأخذها المتغيّر؟ ابحث عن أقرب foreach قبله.
    const back = lines.slice(Math.max(0, i - 10), i).join("\n");
    const arr = [...back.matchAll(/foreach\s+\w+\s+in\s+array\s+array\[([^\]]*)\]/gi)].pop();
    const toks = arr ? [...arr[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : [];
    const risky = toks.filter((t) => t.includes("_") || t.includes("%"));
    if (risky.length) bad.push(`L${i + 1}: ${risky.join(", ")}`);
  }
  assert.deepEqual(bad, [],
    "الشرطة السفلية محرف بدل في LIKE — استعمل replace(f,'_','\\\\_') مع escape، أو تعبيرًا نمطيًّا:\n  " +
    bad.join("\n  "));
});

test("(٢) الفاحص يرصد الفخّ نفسه ويقبل المهروب — غير أجوف", () => {
  const BROKEN = `
    foreach f in array array['purchase_price','cost'] loop
      if v_def ilike '%' || f || '%' then raise exception 'x'; end if;
    end loop;`;
  const FIXED = `
    foreach f in array array['purchase_price','cost'] loop
      if v_def ilike '%' || replace(f, '_', '\\_') || '%' escape '\\' then raise exception 'x'; end if;
    end loop;`;
  const scan = (sql) => {
    const lines = noComments(sql).split("\n");
    let hits = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!/i?like\s+'%'\s*\|\|\s*[a-z_]\w*\s*\|\|\s*'%'/i.test(lines[i])) continue;
      if (/escape/i.test(lines[i])) continue;
      const back = lines.slice(Math.max(0, i - 10), i).join("\n");
      const arr = [...back.matchAll(/foreach\s+\w+\s+in\s+array\s+array\[([^\]]*)\]/gi)].pop();
      const toks = arr ? [...arr[1].matchAll(/'([^']*)'/g)].map((x) => x[1]) : [];
      if (toks.some((t) => t.includes("_"))) hits++;
    }
    return hits;
  };
  assert.ok(scan(BROKEN) > 0, "الفاحص لا يرى الفخّ — فاحص بلا قيمة");
  assert.equal(scan(FIXED), 0, "إنذار كاذب على الصيغة المهروبة");
});

// ─── (ب) صدق التسمية يُحكَم على الأسماء الحيّة ──────────────────────────────

test("(٣) ★★ لا اسم حيّ في الحزمة يدّعي تنبّؤًا أو ذكاءً ★★", () => {
  const s = RUNME();
  const objs = [...s.matchAll(/create (?:or replace )?(?:function|table if not exists|view|materialized view)\s+public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  const cols = [...s.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s+(?:text|numeric|int|integer|bigint|uuid|boolean|jsonb|timestamptz|date)/gim)].map((m) => m[1]);
  const BAD = /^(ai|ml)_|_(ai|ml)$|predict|forecast|machine_learning|neural|deep_learning|intelligen|confidence_score/i;
  assert.ok(objs.length >= 30, `لم تُقرأ إلّا ${objs.length} كائنًا — القارئ لا يرى الملفّ`);
  // ★ ومفاتيح JSON الخارجة فعلًا ★ الاسم الذي يراه المستعمل واجهةٌ حيّة مثل
  //   اسم العمود تمامًا، فلا يكفي حراسة الكتالوج وحده. تُقرأ من مواضع
  //   المفاتيح في jsonb_build_object بعد حذف التعليقات — لا من كلّ نصّ.
  const keys = [...noComments(s).matchAll(/'([a-z_][a-z0-9_]*)'\s*,/g)].map((m) => m[1]);
  const bad = [...new Set([...objs, ...cols, ...keys])].filter((n) => BAD.test(n));
  assert.ok(keys.length >= 50, `لم تُقرأ إلّا ${keys.length} مفتاحًا — القارئ لا يرى المفاتيح`);
  assert.deepEqual(bad, [], `أسماء حيّة تدّعي التنبّؤ: ${bad.join(", ")}`);
});

test("(٤) ★ الفحص الذاتيّ يحكم على الكتالوج لا على نصّ الملفّ ★", () => {
  const code = noComments(RUNME());
  assert.match(code, /from pg_proc p join pg_namespace ns[\s\S]{0,400}custody\\_inv/i,
    "فحص التسمية لا يقرأ أسماء الدوالّ من الكتالوج");
  assert.match(code, /pg_attribute/i, "فحص التسمية لا يقرأ أسماء الأعمدة");
  // ولا يعود إلى مطابقة نصّ التعريف بـilike على قائمة كلمات.
  assert.doesNotMatch(code, /array\['predict','ai_'/, "قائمة الكلمات المجرّدة عادت");
});

test("(٥) الشرح ينفي الذكاء بحرّية — التعليق ليس واجهة", () => {
  const s = RUNME();
  assert.ok(/ليس ذكاءً|لا ذكاء اصطناعيّ|قواعد صريحة|RULE-BASED|rule.based/i.test(s),
    "الحزمة لا تُصرّح أنّها قائمة على قواعد");
  // والتصريح نفسه يجب ألّا يُسقط الفحص: يقع في تعليق، والفحص يقرأ الكتالوج.
  const code = noComments(s);
  assert.ok(!/^\s*--/.test(code), "");
});

// ─── (ج) المحرّك قواعد فعلًا ────────────────────────────────────────────────

test("(٦) ★★ لا عشوائية ولا نداء خارجيّ ولا مزوّد ولا كتابة على المشاريع ★★", () => {
  const code = noComments(RUNME()).replace(/'(?:[^']|'')*'/g, " ");  // الشيفرة وحدها
  for (const [label, re] of [
    ["random()", /\brandom\s*\(/i],
    ["pg_net/http/dblink", /\b(pg_net|net\.http|http_(get|post|put)|dblink)\b/i],
    ["مزوّد خارجيّ", /\b(openai|anthropic|model_endpoint|api_key)\b/i],
    ["كتابة على منصّة المشاريع", /\b(insert\s+into|update|delete\s+from)\s+(public\.)?(projects|project_core|deliverables)\b/i],
  ]) {
    assert.doesNotMatch(code, re, `${label} في محرّك قائم على قواعد`);
  }
});

test("(٧) ★ كلّ إشارة تحمل قاعدتها وأساسها ★", () => {
  const s = RUNME();
  const i = s.indexOf("function public.custody_inv_maintenance_signals");
  assert.ok(i > -1, "دالّة الإشارات غير موجودة");
  const body = s.slice(i, i + 5000);
  for (const k of ["'rule'", "'basis'", "'severity'"]) {
    assert.ok(body.includes(k), `الإشارة بلا ${k} — نتيجة لا تُراجَع ولا تُرفَض`);
  }
});

test("(٨) ★ لا مصدر حقيقة ثانٍ للأصول ★", () => {
  const s = RUNME();
  const tables = [...s.matchAll(/create table if not exists public\.([a-z0-9_]+)/gi)].map((m) => m[1]);
  const rival = tables.filter((t) => /^asset_|^ai_/.test(t));
  assert.deepEqual(rival, [], `جدول أصول موازٍ: ${rival.join(", ")}`);
  assert.ok(tables.every((t) => t.startsWith("custody_inventory_")),
    `جدول خارج عائلة custody_inventory_: ${tables.filter((t) => !t.startsWith("custody_inventory_")).join(", ")}`);
});

// ─── (د) الحقيقة عن الحالة الجزئية ─────────────────────────────────────────

test("(٩) ★★ الحزمة ليست معاملة واحدة — والوثيقة تقول ذلك صراحةً ★★", () => {
  const s = RUNME();
  const begins = (s.match(/^begin;$/gim) || []).length;
  const commits = (s.match(/^commit;$/gim) || []).length;
  assert.equal(begins, commits, `begin=${begins} commit=${commits} — غير متوازنة`);
  const verify = read("docs/asset_intelligence_AFTER_FAILURE_VERIFY.sql");
  assert.ok(verify !== null, "ملفّ ما بعد السقوط غير موجود");
  if (begins > 1) {
    // مع أكثر من معاملة، فشلٌ في الأخيرة يترك ما قبلها ثابتًا. لا يجوز أن
    // يُقال «لا حالة جزئية» — ويجب أن يقول ملفّ التحقّق ذلك بصراحة.
    assert.match(verify, /حالة جزئية|PARTIAL/i,
      `الملفّ فيه ${begins} معاملات، فالفشل يترك حالة جزئية — وملفّ التحقّق لا يُصرّح بذلك`);
    assert.match(verify, /إعادة تشغيل|re-?run/i, "ملفّ التحقّق لا يذكر أنّ العلاج إعادة التشغيل");
  }
});

test("(١٠) ★ إعادة التشغيل آمنة: كلّ زناد وسياسة مسبوقة بـdrop if exists ★", () => {
  const s = noComments(RUNME());
  const lines = s.split("\n");
  const drops = {};
  lines.forEach((l, i) => {
    const m = l.match(/drop (?:trigger|policy) if exists\s+(\S+)/i);
    if (m) (drops[m[1].toLowerCase()] ||= []).push(i);
  });
  const bad = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*create (trigger|policy)\s+(\S+)/i);
    if (!m) return;
    if (!(drops[m[2].toLowerCase()] || []).some((d) => d < i)) bad.push(`${m[1]} ${m[2]}`);
  });
  assert.deepEqual(bad, [], `تُنشأ بلا drop if exists سابق فتفشل إعادة التشغيل:\n  ${bad.join("\n  ")}`);
  // والدوالّ بـcreate or replace، والجداول والفهارس بـif not exists.
  const plainCreate = [...s.matchAll(/^create (table|index)\s+(?!if not exists)/gim)];
  assert.equal(plainCreate.length, 0, "جدول أو فهرس بلا if not exists — إعادة التشغيل تفشل");
});

// ─── (هـ) مصدر الحقيقة الواحد — بالبنية لا بالاسم ──────────────────────────

test("(١١) ★★ كشف المصدر الموازي بنيويّ في الملفّات الثلاثة ★★", () => {
  // asset_insurance_policies أبلغ عنه فحصٌ اسميّ كتبتُه أنا في هذه الجلسة، وهو
  // بوليصة تأمين لا أصل: لا asset_code ولا barcode ولا serial_number، وارتباطها
  // بالأصول عبر جدول الوصل policy_assets بمفتاحين not null. سادس ظهور لصنف
  // «طابق اسمًا لا شكلًا» — وأوّل مرّة يكون المؤلّف هو من أدخله وهو يُصلح الصنف
  // نفسه في الملفّ ذاته. فالقاعدة الآن بنيوية في الثلاثة معًا.
  for (const f of ["docs/asset_intelligence_RUNME.sql",
                   "docs/asset_intelligence_POSTCHECK.sql",
                   "docs/asset_intelligence_AFTER_FAILURE_VERIFY.sql"]) {
    const sql = read(f);
    assert.ok(sql !== null, `ملفّ مفقود: ${f}`);
    const code = noComments(sql);
    assert.match(code, /a\.attnotnull/,
      `${f}: القاعدة لا تشترط رابطًا **إلزاميًّا** — مفتاح أجنبيّ قابل للـNULL يسمح بصفّ بلا أصل`);
    assert.match(code, /attname in \('asset_code'/,
      `${f}: القاعدة لا تعدّ أعمدة الهويّة — فهي تحكم بالاسم لا بالبنية`);
    assert.match(code, /custody_inventory_assets/, `${f}: المالك غير مذكور في القاعدة`);
    // ولا استثناء مكتوب باليد: الاستثناء يُصلح ما عرفناه ويترك ما لم نعرفه.
    assert.doesNotMatch(code, /relname\s*<>\s*'asset_insurance_policies'/,
      `${f}: ما زال يستثني جدولًا باسمه بدل أن يحكم ببنيته`);
    assert.doesNotMatch(code, /relname like 'asset\\_%'/,
      `${f}: ما زال يحكم على البادئة asset_ — امتدادٌ بريء يسقط ومصدرٌ موازٍ بلا البادئة يمرّ`);
  }
});

test("(١٢) ★ نموذج التصنيف: امتداد يمرّ ومصدر موازٍ يسقط ★", () => {
  const IDENT = new Set(["asset_code", "barcode", "qr_code_value", "asset_name",
                         "serial_number", "category_id", "condition_status", "availability_status"]);
  const rival = (cols, linked) => cols.filter((c) => IDENT.has(c)).length >= 2 && !linked;
  // يسقط
  assert.ok(rival(["asset_code", "barcode", "serial_number"], false), "مصدر موازٍ كامل لم يسقط");
  assert.ok(rival(["serial_number", "barcode"], false), "هويّة بلا رابط لم تسقط");
  assert.ok(rival(["condition_status", "availability_status"], false), "حالة مستقلّة لم تسقط");
  // يمرّ
  assert.ok(!rival(["policy_number", "provider", "coverage_amount"], true),
    "بوليصة التأمين سقطت — وهي بلا أعمدة هويّة");
  assert.ok(!rival(["plan_code", "plan_name", "asset_id"], true), "خطّة صيانة سقطت");
  assert.ok(!rival(["asset_id", "reading_value"], true), "قراءة عدّاد سقطت");
  assert.ok(!rival(["policy_number", "provider"], false), "اسم asset_* وحده أسقط جدولًا");
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
