// ════════════════════════════════════════════════════════════════════════════
// tests/sql_package_hardening_guards.test.js
//
// حارس دائم ضدّ أصناف الأعطال التي ظهرت على الإنتاج في هذا البرنامج. كلّ صنف
// هنا كلّف دورةَ تشغيل واحدة على الأقلّ، وبعضها كلّف ثلاثًا:
//
//   C1  الشرطة السفلية محرف بدل في LIKE/ILIKE.
//   C3  مطابقة تعليق أو سلسلة كأنّها شيفرة تنفيذية.
//   C4  CTE يقرأ CTE معرَّفًا بعده.
//   C5  CASE أو to_regclass لا يحمي FROM مباشرًا لجدول غائب.
//   C6  الفحص الذاتيّ ينادي RPC محميّة من محرّر SQL بلا auth.uid().
//   C11 حدّ تكرار regex يتجاوز 255 (RE_DUP_MAX).
//   C15 افتراض معاملة واحدة بلا عدّ begin/commit.
//   C16 منح authenticated مع بقاء PUBLIC الافتراضيّ.
//
// ★ ولماذا الفاحص نفسه يُفحَص ★ في هذا البرنامج أدان الفاحصُ تعليقًا يشرح
//   الخطر أكثر من مرّة. فكلّ قاعدة هنا لها **حالة تُدين وحالة تبرّئ**، ومصدرها
//   الشيفرة بعد تجريد التعليقات والسلاسل — لا نصّ الملفّ الخام.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

const PKGS = ["case_studies_platform", "live_operations_dashboard",
              "kian_ai_assistant", "executive_reporting"];
const KINDS = ["PREFLIGHT", "RUNME", "POSTCHECK"];
const read = (r) => (fs.existsSync(path.join(ROOT, r)) ? fs.readFileSync(path.join(ROOT, r), "utf8") : null);
const file = (p, k) => `docs/${p}_${k}.sql`;

/** الشيفرة وحدها: بلا تعليقات وبلا محتوى السلاسل (يُستبدَل بفراغ محايد). */
function codeOnly(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) {
      if (c === "'") { if (sql.startsWith("''", i)) { out += "  "; i += 2; continue; } q = false; out += " "; i++; continue; }
      out += c === "\n" ? "\n" : " "; i++; continue;
    }
    if (c === "'") { q = true; out += " "; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") { out += " "; i++; } continue; }
    out += c; i++;
  }
  return out;
}
/** التعليقات محذوفة، السلاسل باقية (لفحوص تحتاج المحتوى الحرفيّ). */
function noComments(sql) {
  let out = "", i = 0, q = false;
  while (i < sql.length) {
    const c = sql[i];
    if (q) { if (c === "'") { if (sql.startsWith("''", i)) { out += "''"; i += 2; continue; } q = false; } out += c; i++; continue; }
    if (c === "'") { q = true; out += c; i++; continue; }
    if (sql.startsWith("--", i)) { while (i < sql.length && sql[i] !== "\n") i++; continue; }
    out += c; i++;
  }
  return out;
}
function ctes(sql) {
  const out = [];
  const re = /^([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s+(?:materialized\s+|not\s+materialized\s+)?\(/gim;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const st = m.index + m[0].length - 1;
    let d = 0, i = st;
    while (i < sql.length) {
      const c = sql[i];
      if (c === "'") { i++; while (i < sql.length) { if (sql[i] === "'") { if (sql.startsWith("''", i)) { i += 2; continue; } break; } i++; } }
      else if (c === "(") d++;
      else if (c === ")") { d--; if (d === 0) break; }
      i++;
    }
    out.push({ name: m[1], line: sql.slice(0, m.index).split("\n").length, body: sql.slice(st, i + 1) });
  }
  return out;
}
function fnBodies(sql) {
  const out = [];
  for (const m of sql.matchAll(/create or replace function public\.[a-z0-9_]+\s*\(/gi)) {
    const h = sql.slice(m.index, m.index + 600);
    const t = h.match(/as (\$[a-z0-9_]*\$)/);
    if (!t) continue;
    const st = m.index + h.indexOf(t[1]) + t[1].length;
    const en = sql.indexOf(t[1], st);
    if (en > -1) out.push([m.index, en + t[1].length]);
  }
  return out;
}
const eachFile = (fn) => { for (const p of PKGS) for (const k of KINDS) { const s = read(file(p, k)); if (s !== null) fn(p, k, s); } };

test("(٠) الملفّات الاثنا عشر موجودة — لا حارس بلا هدف", () => {
  const missing = [];
  for (const p of PKGS) for (const k of KINDS) if (read(file(p, k)) === null) missing.push(file(p, k));
  assert.deepEqual(missing, [], `ملفّات ناقصة: ${missing.join(", ")}`);
});

test("(C1) ★ لا LIKE/ILIKE بشرطة سفلية غير مهروبة ★", () => {
  const bad = [];
  eachFile((p, k, s) => {
    const nc = noComments(s).split("\n");
    nc.forEach((l, i) => {
      const m = l.match(/i?like\s+'%'\s*\|\|\s*([a-z_]\w*)\s*\|\|\s*'%'/i);
      if (m && !/escape/i.test(l)) bad.push(`${p}/${k}:${i + 1} متغيّر ${m[1]} بلا escape`);
    });
  });
  assert.deepEqual(bad, [], "الشرطة السفلية محرف بدل — استعمل replace(x,'_','\\\\_') مع escape:\n  " + bad.join("\n  "));
});

test("(C1-b) الفاحص يميّز المهروب من غيره", () => {
  const scan = (sql) => noComments(sql).split("\n").filter((l) =>
    /i?like\s+'%'\s*\|\|\s*[a-z_]\w*\s*\|\|\s*'%'/i.test(l) && !/escape/i.test(l)).length;
  assert.ok(scan("if d ilike '%' || t || '%' then end if;") > 0, "لا يرى غير المهروب");
  assert.equal(scan("if d ilike '%' || replace(t,'_','\\_') || '%' escape '\\' then end if;"), 0, "إنذار كاذب على المهروب");
  assert.equal(scan("-- if d ilike '%' || t || '%' then"), 0, "أدان تعليقًا");
});

test("(C3) ★ لا catch-all يبتلع فشلًا حقيقيًّا ★", () => {
  const bad = [];
  eachFile((p, k, s) => {
    // `when others then null;` وحده ابتلاع. أمّا `then return <fallback>` فهو
    // إغلاق آمن مقصود، و`when undefined_table then null` استثناء مسمّى.
    for (const m of noComments(s).matchAll(/exception\s+when\s+others\s+then\s+null\s*;/gi)) {
      bad.push(`${p}/${k}:${noComments(s).slice(0, m.index).split("\n").length}`);
    }
  });
  assert.deepEqual(bad, [], "catch-all يبتلع الفشل:\n  " + bad.join("\n  "));
});

test("(C3-b) الفاحص يقبل الاستثناء المسمّى ويرفض العامّ", () => {
  const scan = (x) => [...noComments(x).matchAll(/exception\s+when\s+others\s+then\s+null\s*;/gi)].length;
  assert.ok(scan("exception when others then null;") > 0, "لا يرى الابتلاع");
  assert.equal(scan("exception when undefined_table then null;"), 0, "أدان استثناءً مسمّى");
  assert.equal(scan("exception when others then return null;"), 0, "أدان إغلاقًا آمنًا");
  assert.equal(scan("-- exception when others then null;"), 0, "أدان تعليقًا");
});

test("(C4) ★ لا مرجع CTE أماميّ ★", () => {
  const bad = [];
  eachFile((p, k, s) => {
    const cs = ctes(s), names = cs.map((c) => c.name);
    cs.forEach((c, idx) => {
      for (const o of names) {
        if (o !== c.name && names.indexOf(o) > idx && new RegExp(`\\b${o}\\b`).test(c.body)) {
          bad.push(`${p}/${k}:${c.line} ${c.name} → ${o}`);
        }
      }
    });
  });
  assert.deepEqual(bad, [], "WITH غير تعاودية ترى ما سبق فقط:\n  " + bad.join("\n  "));
});

test("(C5) ★ PREFLIGHT لا يشير إلى علاقة تُنشئها حزمته ★", () => {
  const own = { case_studies_platform: /^cs_/, live_operations_dashboard: /^liveops_/,
                kian_ai_assistant: /^ai_/, executive_reporting: /^(mgmt_|exec_|er_)/ };
  const bad = [];
  for (const p of PKGS) {
    const s = read(file(p, "PREFLIGHT"));
    if (!s) continue;
    const c = codeOnly(s);
    for (const m of c.matchAll(/\b(from|join)\s+public\.([a-z0-9_]+)/gi)) {
      if (own[p].test(m[2])) bad.push(`${p}/PREFLIGHT:${c.slice(0, m.index).split("\n").length} ${m[2]}`);
    }
  }
  assert.deepEqual(bad, [], "مرجع مباشر إلى علاقة غير موجودة في التركيب الأوّل — 42P01 مهما كان الحارس:\n  " + bad.join("\n  "));
});

test("(C6) ★ لا نداء RPC خاصّ بالحزمة وقت التركيب أو في POSTCHECK ★", () => {
  // ⚠️ executive_reporting يستعمل mgmt_ لا exec_/er_ — والبادئة الخاطئة تجعل
  //    الفحص أجوف على تلك الحزمة تحديدًا. تُقاس البادئة من الملفّ لا تُخمَّن.
  const own = /public\.(cs|liveops|ai|exec|er|mgmt)_[a-z0-9_]+\s*\(/i;
  const bad = [];
  eachFile((p, k, s) => {
    if (k === "PREFLIGHT" || k === "POSTCHECK") {
      const c = codeOnly(s);
      for (const m of c.matchAll(/^[ \t]*(select|perform)\s+(public\.[a-z0-9_]+)\s*\(/gim)) {
        if (own.test(m[2] + "(")) bad.push(`${p}/${k}:${c.slice(0, m.index).split("\n").length} ${m[2]}`);
      }
      return;
    }
    const bodies = fnBodies(s);
    for (const m of s.matchAll(/^[ \t]*(select|perform)\s+(public\.[a-z0-9_]+)\s*\(/gim)) {
      if (!own.test(m[2] + "(")) continue;
      if (bodies.some(([a, b]) => m.index >= a && m.index <= b)) continue;
      // ★ استثناء مقصود: نداءٌ **يُثبت المنع** ★ فحصٌ ينادي RPC محميّة ثمّ
      //   يتحقّق أنّها رفعت 'not authorized' هو الطريقة الصحيحة لإثبات
      //   الإغلاق الآمن من محرّر SQL — وهو نقيض العطل لا صورته. العطل أن
      //   يُنادى المُسنَد ويُقرأ false على أنّه كسر. فالتمييز بالسياق.
      const around = s.slice(m.index, m.index + 400);
      if (/sqlerrm/i.test(around) && /not authorized|منع|fail-open/i.test(around)) continue;
      bad.push(`${p}/${k}:${s.slice(0, m.index).split("\n").length} ${m[2]} خارج جسم دالّة وبلا إثبات منع`);
    }
  });
  assert.deepEqual(bad, [], "نداء محميّ من جلسة بلا auth.uid():\n  " + bad.join("\n  "));
});

test("(C11) ★ لا حدّ تكرار regex يتجاوز 255 ★", () => {
  const bad = [];
  eachFile((p, k, s) => {
    for (const m of noComments(s).matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
      for (const g of [m[1], m[2]]) if (g && Number(g) > 255) bad.push(`${p}/${k} ${m[0]}`);
    }
  });
  assert.deepEqual(bad, [], `RE_DUP_MAX=255 — تجاوزه خطأ ترجمة 2201B:\n  ${bad.join("\n  ")}`);
});

test("(C15) ★ عدد المعاملات معلوم ومُعلَن — لا يُفترض ★", () => {
  const declared = { case_studies_platform: 1, live_operations_dashboard: 2,
                     kian_ai_assistant: 1, executive_reporting: 1 };
  for (const p of PKGS) {
    const s = read(file(p, "RUNME"));
    if (!s) continue;
    const b = (s.match(/^begin;$/gim) || []).length, c = (s.match(/^commit;$/gim) || []).length;
    assert.equal(b, c, `${p}: begin/commit غير متوازنة ${b}/${c}`);
    assert.equal(b, declared[p],
      `${p}: عدد المعاملات ${b} والمعلَن ${declared[p]} — عدّل الإعلان بوعي، فالفشل في معاملة لاحقة يترك ما قبلها ثابتًا`);
    if (b > 1) {
      assert.match(s.slice(0, 4000), /معامل|transaction/i,
        `${p}: أكثر من معاملة بلا إعلان في الترويسة — القارئ يفترض التراجع الكامل خطأً`);
    }
    assert.doesNotMatch(codeOnly(s), /concurrently/i, `${p}: CONCURRENTLY داخل معاملة`);
  }
});

test("(C16) ★ منح authenticated يقترن بسحب PUBLIC ★", () => {
  const bad = [];
  for (const p of PKGS) {
    const s = read(file(p, "RUNME"));
    if (!s) continue;
    const nc = noComments(s);
    if (/grant\s+execute\s+on function[\s\S]{0,4000}?to\s+authenticated/i.test(nc)
        && !/revoke[\s\S]{0,200}?from\s+public/i.test(nc)) bad.push(p);
  }
  assert.deepEqual(bad, [], `منح authenticated مع بقاء PUBLIC الافتراضيّ: ${bad.join(", ")}`);
});

test("(POSTCHECK) ★ قراءة فقط · جملة واحدة · بلا معاملة ★", () => {
  for (const p of PKGS) {
    const s = read(file(p, "POSTCHECK"));
    if (!s) continue;
    const c = codeOnly(s);
    assert.doesNotMatch(c, /^\s*(insert|update|delete|create|alter|drop|truncate)\s/im, `${p}/POSTCHECK يكتب`);
    assert.doesNotMatch(c, /\b(begin|commit|rollback)\s*;/i, `${p}/POSTCHECK يفتح معاملة`);
    let d = 0, n = 0;
    for (const ch of c) { if (ch === "(") d++; else if (ch === ")") d--; else if (ch === ";" && d === 0) n++; }
    assert.equal(n, 1, `${p}/POSTCHECK فيه ${n} جملة — المحرّر يعرض الأخيرة فقط`);
  }
});

test("(PREFLIGHT) ★ قراءة فقط ★", () => {
  for (const p of PKGS) {
    const s = read(file(p, "PREFLIGHT"));
    if (!s) continue;
    assert.doesNotMatch(codeOnly(s), /^\s*(insert|update|delete|create|alter|drop|truncate)\s/im, `${p}/PREFLIGHT يكتب`);
  }
});

test("(RUNME) ★ idempotent: زناد وسياسة مسبوقان بحذف، وجدول/فهرس بـif not exists ★", () => {
  const bad = [];
  for (const p of PKGS) {
    const s = read(file(p, "RUNME"));
    if (!s) continue;
    const nc = noComments(s), lines = nc.split("\n"), drops = {};
    lines.forEach((l, i) => { const m = l.match(/drop (?:trigger|policy) if exists\s+(\S+)/i); if (m) (drops[m[1].toLowerCase()] ||= []).push(i); });
    lines.forEach((l, i) => {
      const m = l.match(/^\s*create (trigger|policy)\s+(\S+)/i);
      if (m && !(drops[m[2].toLowerCase()] || []).some((d) => d < i)) bad.push(`${p}: create ${m[1]} ${m[2]} بلا drop سابق`);
    });
    for (const m of nc.matchAll(/^create (table|index)\s+(?!if not exists)/gim)) bad.push(`${p}: create ${m[1]} بلا if-not-exists`);
    assert.match(nc, /raise exception/i, `${p}/RUNME بلا فحص ذاتيّ يرفع خطأً`);
  }
  assert.deepEqual(bad, [], "إعادة التشغيل ستفشل:\n  " + bad.join("\n  "));
});

test("(C1-c) ★ هروب LIKE بمحرف واحد لا اثنين ★", () => {
  // أدخلتُ هذا العطل بنفسي أثناء الإصلاح: مولّد النصّ كتب '\\_' و escape '\\'.
  // مع standard_conforming_strings=on تكون '\\_' **محرفين** لا واحدًا، و
  // escape يشترط محرفًا واحدًا بالضبط فيُرفض. أي أنّ «الإصلاح» كان سيكسر
  // الترحيلة بطريقة أخرى. فالقاعدة تُفحص بعينها.
  const bad = [];
  eachFile((p, k, s) => {
    const nc = noComments(s);
    for (const m of nc.matchAll(/replace\([a-z_]\w*,\s*'_',\s*'([^']*)'\)/g)) {
      if (m[1] !== "\\_") bad.push(`${p}/${k}: replace(...,'_','${m[1]}') — يجب أن يكون \\_ بمحرفين فقط`);
    }
    for (const m of nc.matchAll(/escape\s+'([^']*)'/gi)) {
      if (m[1].length !== 1) bad.push(`${p}/${k}: escape '${m[1]}' طوله ${m[1].length} — يشترط محرفًا واحدًا`);
    }
  });
  assert.deepEqual(bad, [], "هروب LIKE معطوب:\n  " + bad.join("\n  "));
});

test("SAFE: ساكن فقط (لا قاعدة بيانات ولا شبكة)", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const bad of ["fet" + "ch(", "child_" + "process", "service_" + "role"]) {
    assert.ok(!src.includes(bad), `الفاحص يلمس ${bad}`);
  }
});
