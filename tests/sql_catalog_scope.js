// ════════════════════════════════════════════════════════════════════════════
// tests/sql_catalog_scope.js
//
// كاشف `oid` (وأخواته) **غير المؤهَّل** داخل استعلام يضمّ أكثر من جدول كتالوج.
//
// 🔴 القاعدة: `pg_constraint` و`pg_class` و`pg_proc` و`pg_namespace` … كلّها
//    تملك عمودًا اسمه `oid`. فحالما يُضمّ اثنان منها في نفس نطاق `from`، يصير
//    `oid` المجرَّد **ملتبسًا** ويفشل الاستعلام:
//        ERROR: column reference "oid" is ambiguous
//    ⚠️ وفي استعلام **جدول واحد** لا التباس إطلاقًا — و`oid` المجرَّد صحيح
//    تمامًا هناك. فالكشف يجب أن يكون **بالنطاق** لا بالبحث النصّيّ، وإلّا
//    أعطى عشرات الإنذارات الكاذبة على استعلامات سليمة.
//
// ★ النطاق ★ يُحسب بعمق الأقواس: كل استعلام فرعيّ بين قوسين نطاقٌ مستقلّ بجداوله
//   الخاصّة. فـ`(select relrowsecurity from pg_class where oid = …)` داخل جملة
//   أكبر **سليم**، لأنّ نطاقه يضمّ جدولًا واحدًا.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");

/** أعمدة يملكها أكثر من جدول كتالوج — تلتبس عند الضمّ. */
const AMBIGUOUS_COLS = ["oid", "tableoid"];
const CATALOG_RE = /\b(?:from|join)\s+(?:only\s+)?((?:pg_catalog\.)?pg_[a-z_]+|information_schema\.[a-z_]+)\b/gi;

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

/** يقسّم على `;` **خارج** الأقواس والسلاسل — لئلّا تختلط جملتان في نطاق واحد. */
function statements(code) {
  const out = []; let cur = "", depth = 0, q = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (q) { if (c === "'") q = false; cur += c; continue; }
    if (c === "'") { q = true; cur += c; continue; }
    if (c === "(") depth++;
    if (c === ")") depth = Math.max(0, depth - 1);
    if (c === ";" && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/**
 * يقسّم النصّ إلى **نطاقات استعلام**.
 *
 * 🔴 والقوسان ليسا دائمًا نطاقًا: `pg_get_constraintdef(oid)` قوسا **استدعاء
 *    دالّة**، و`oid` داخلهما ينتمي إلى `from` الخارجيّ — وهذا بالضبط موضع
 *    العطب. فلا يُفتح نطاقٌ جديد إلّا لما يبدأ بـ`select` أو `with`.
 * ⚠️ ويُقسَّم أيضًا على `union`/`intersect`/`except`: كل طرف `from` مستقلّ.
 */
function scopesByDepth(stmt) {
  const parts = [];
  const SETOPS = /\b(?:union\s+all|union|intersect|except)\b/i;

  /** يُعيد النصّ الباقي في **هذا** النطاق، ويدفع نطاقات الأبناء إلى parts. */
  function inline(text) {
    let cur = "", i = 0;
    while (i < text.length) {
      if (text[i] === "(") {
        let d = 0, j = i, q = false;
        for (; j < text.length; j++) {
          const c = text[j];
          if (q) { if (c === "'") q = false; continue; }
          if (c === "'") { q = true; continue; }
          if (c === "(") d++;
          if (c === ")") { d--; if (d === 0) break; }
        }
        const inner = text.slice(i + 1, j);
        if (/^\s*(?:select|with)\b/i.test(inner)) {
          push(inner);                 // استعلام فرعيّ ⇒ نطاق مستقلّ بـfrom خاصّ
          cur += " (…) ";
        } else {
          // ⚠️ قوسا تعبير/استدعاء دالّة: المحتوى يبقى في نطاق أبيه — **لكن**
          //    قد يحوي استعلامًا فرعيًّا أعمق (`not exists (select …)`)، فيُمشّط.
          cur += " " + inline(inner) + " ";
        }
        i = j + 1; continue;
      }
      cur += text[i]; i++;
    }
    return cur;
  }
  function push(text) { for (const seg of inline(text).split(SETOPS)) parts.push(seg); }

  push(stmt);
  return parts;
}

/**
 * عمود مجرَّد داخل نطاق.
 * ⛔ ولا يُحتسب: `x.oid` (مؤهَّل) · `::oid` (تحويل نوع) · `_oid` (جزء من اسم)
 *   · `oid` داخل سلسلة نصّية.
 */
function bareCol(scope, col) {
  const re = new RegExp(`${col}\\b`, "gi");
  const hits = [];
  for (const m of scope.matchAll(re)) {
    const before = scope.slice(Math.max(0, m.index - 2), m.index);
    if (/[.:\w]$/.test(before)) continue;            // ‎x.oid‎ · ‎::oid‎ · ‎relnamespace…‎
    const at = m.index + m[0].length;
    if (/^\w/.test(scope.slice(at, at + 1))) continue;   // ‎oidvectortypes‎
    hits.push(scope.slice(Math.max(0, m.index - 40), at + 20).replace(/\s+/g, " ").trim());
  }
  return hits;
}

/**
 * يفحص نصّ SQL ويُعيد كل نطاق فيه ≥٢ جدول كتالوج **و**عمود ملتبس مجرَّد.
 * @returns {{col:string, tables:string[], snippet:string}[]}
 */
function unqualifiedCatalogCols(sql) {
  const code = stripComments(sql);
  const found = [];
  for (const stmt of statements(code)) {
    for (const scope of scopesByDepth(stmt)) {
      const tables = [...new Set([...scope.matchAll(CATALOG_RE)].map((m) => m[1].toLowerCase()))];
      if (tables.length < 2) continue;                  // نطاقٌ بجدول واحد ⇒ لا التباس
      for (const col of AMBIGUOUS_COLS) {
        for (const ctx of bareCol(scope, col)) found.push({ col, tables, snippet: ctx });
      }
    }
  }
  return found;
}

/** يفحص ملفّات SQL ويُعيد `{file, …}` لكل موضع. */
function scanFiles(files) {
  const out = [];
  for (const f of files) {
    for (const hit of unqualifiedCatalogCols(fs.readFileSync(f, "utf8"))) {
      out.push({ file: path.basename(f), ...hit });
    }
  }
  return out;
}

module.exports = { unqualifiedCatalogCols, scanFiles, stripComments, AMBIGUOUS_COLS };
