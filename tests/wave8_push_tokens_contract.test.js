// ════════════════════════════════════════════════════════════════════════════
// tests/wave8_push_tokens_contract.test.js
//
// عقد حزمة Wave 8 · V2-8.3-A الساكن. **لا تشغيل ولا اتصال بقاعدة** — نصّ فقط.
// الغرض أن تُرصد المخالفة في المستودع، لا على Production بعد فوات الأوان.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (r) => fs.readFileSync(path.join(ROOT, r), "utf8");
const P = (n) => `docs/wave8_push_tokens_${n}.sql`;

/** يجرّد التعليقات **والسلاسل**، فلا يُحاكَم النصّ الشارح كأنّه كود. */
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
/** يجرّد التعليقات ويُبقي السلاسل — لتأكيد **محتوى** مثل أسماء القيم. */
function noComments(sql) {
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

const RUNME = () => codeOnly(read(P("RUNME")));
const RUNME_S = () => noComments(read(P("RUNME")));

// ─── ١ · الحزمة الرباعية موجودة ─────────────────────────────────────────────
test("الحزمة كاملة: PREFLIGHT · RUNME · POSTCHECK · ROLLBACK", () => {
  for (const n of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    assert.ok(fs.existsSync(path.join(ROOT, P(n))), `${n} مفقود`);
  }
});

// ─── ٢ · إضافيّة وidempotent ────────────────────────────────────────────────
test("إضافيّة: لا drop/truncate مدمّر في RUNME", () => {
  const sql = RUNME();
  assert.ok(!/\bdrop\s+table\b/i.test(sql), "RUNME يُسقط جدولًا — الحزمة يجب أن تكون إضافيّة");
  assert.ok(!/\btruncate\b/i.test(sql), "RUNME يقتطع جدولًا");
  assert.ok(!/\bdelete\s+from\b/i.test(sql), "RUNME يحذف صفوفًا");
  // إسقاط **قيد** مسموح: القيد يُعاد بناؤه أوسع في نفس المعاملة.
  // ⚠️ يُقرأ من RUNME_S لا من codeOnly: الإسقاط يقع داخل `execute format('…')`،
  //    وcodeOnly يجرّد السلاسل فيختفي — وهي مصيدة أوقعت اختبارات سابقة.
  assert.ok(/drop\s+constraint/i.test(RUNME_S()), "توسعة القيد غائبة");
});

test("idempotent: إنشاءات مشروطة", () => {
  const sql = RUNME();
  assert.ok(/create\s+table\s+if\s+not\s+exists\s+public\.push_tokens/i.test(sql));
  assert.ok(/add\s+column\s+if\s+not\s+exists\s+push_enabled/i.test(sql));
  for (const m of sql.match(/create\s+(unique\s+)?index[^;]*/gi) ?? []) {
    assert.ok(/if\s+not\s+exists/i.test(m), `فهرس بلا if not exists: ${m.slice(0, 60)}`);
  }
});

// ─── ٣ · 🔴 الرمز غير مقروء من أيّ عميل — أهمّ عقد في الحزمة ───────────────
test("لا سياسة SELECT على push_tokens، ولا مِنحة SELECT", () => {
  const sql = RUNME();
  const policies = sql.match(/create\s+policy[\s\S]*?;/gi) ?? [];
  assert.ok(policies.length > 0, "لا سياسات إطلاقًا");
  for (const p of policies) {
    assert.ok(!/\bfor\s+select\b/i.test(p), `سياسة SELECT على الجدول تجعل الرمز مقروءًا: ${p.slice(0, 70)}`);
    assert.ok(!/\bfor\s+all\b/i.test(p), `سياسة ALL تتضمّن SELECT ضمنًا: ${p.slice(0, 70)}`);
  }
  const grants = sql.match(/grant[^;]*on\s+public\.push_tokens[^;]*/gi) ?? [];
  assert.ok(grants.length > 0, "لا مِنَح على الجدول إطلاقًا");
  for (const g of grants) {
    assert.ok(!/\bselect\b/i.test(g), `مِنحة SELECT على الجدول: ${g}`);
    assert.ok(!/\bdelete\b/i.test(g), `مِنحة DELETE تمحو أثر جهاز مفقود: ${g}`);
  }
});

test("RLS مفعَّلة ومفروضة، والمِنَح تُسحب قبل أن تُمنح", () => {
  const sql = RUNME();
  assert.ok(/alter\s+table\s+public\.push_tokens\s+enable\s+row\s+level\s+security/i.test(sql));
  assert.ok(/alter\s+table\s+public\.push_tokens\s+force\s+row\s+level\s+security/i.test(sql),
    "force مفقودة — مالك الجدول يتجاوز RLS بدونها");
  const revokeAt = sql.search(/revoke\s+all\s+on\s+public\.push_tokens/i);
  const grantAt = sql.search(/grant\s+[^;]*on\s+public\.push_tokens/i);
  assert.ok(revokeAt > -1 && grantAt > revokeAt, "المنح يسبق السحب — يُبقي صلاحية موروثة");
});

// ─── ٤ · الملكية مفروضة في كل سياسة ────────────────────────────────────────
test("كل سياسة تقيّد بـauth.uid()", () => {
  for (const p of RUNME().match(/create\s+policy[\s\S]*?;/gi) ?? []) {
    assert.ok(/auth\.uid\(\)/.test(p), `سياسة بلا قيد ملكية: ${p.slice(0, 70)}`);
  }
});

// ─── ٥ · الدوالّ: definer بمسار مثبَّت، وسحب قبل منح ───────────────────────
test("كل دالّة SECURITY DEFINER تثبّت search_path", () => {
  const sql = RUNME();
  const defs = (sql.match(/security\s+definer/gi) ?? []).length;
  const paths = (sql.match(/set\s+search_path\s*=\s*public,\s*pg_temp/gi) ?? []).length;
  assert.ok(defs > 0, "لا دوالّ definer");
  assert.ok(paths >= defs, `دوالّ definer=${defs} بمسار مثبَّت=${paths} — الفارق قابل للاختطاف`);
});

test("🔴 push_mark_invalid لا تُمنح لأيّ دور عميل", () => {
  const sql = RUNME();
  assert.ok(/revoke\s+all\s+on\s+function\s+public\.push_mark_invalid/i.test(sql),
    "السحب مفقود");
  const granted = (sql.match(/grant\s+execute\s+on\s+function\s+public\.push_mark_invalid[^;]*/gi) ?? []);
  assert.equal(granted.length, 0,
    "مُنحت push_mark_invalid لدور عميل — عندئذ يُبطل أيّ مستخدم جهاز غيره ببصمة مخمَّنة");
});

test("الدوالّ المُتاحة للعميل ممنوحة صراحةً لـauthenticated فقط", () => {
  const sql = RUNME();
  for (const fn of ["push_register_token", "push_revoke_my_tokens", "push_my_devices"]) {
    const re = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[^;]*to\\s+authenticated`, "i");
    assert.ok(re.test(sql), `${fn} غير ممنوحة لـauthenticated`);
    const anon = new RegExp(`grant\\s+execute\\s+on\\s+function\\s+public\\.${fn}[^;]*\\bto\\b[^;]*\\banon\\b`, "i");
    assert.ok(!anon.test(sql), `${fn} ممنوحة لـanon — تسجيل جهاز بلا هويّة`);
  }
});

// ─── ٦ · منع التسجيل النشط المكرَّر ────────────────────────────────────────
test("فهرسان فريدان جزئيّان على is_active", () => {
  const sql = RUNME();
  for (const ix of ["ux_push_tokens_active_device", "ux_push_tokens_active_fingerprint"]) {
    const m = sql.match(new RegExp(`create\\s+unique\\s+index[^;]*${ix}[^;]*`, "i"));
    assert.ok(m, `${ix} مفقود`);
    assert.ok(/where\s+is_active/i.test(m[0]),
      `${ix} غير جزئيّ — يمنع إعادة التسجيل بعد الإبطال بدل أن يمنع التكرار النشط`);
  }
});

test("is_active مشتقّة لا مُدخَلة — مصدر واحد للحقيقة", () => {
  const sql = RUNME();
  assert.ok(/is_active\s+boolean\s+generated\s+always\s+as/i.test(sql),
    "is_active عمود عاديّ — سينحرف عن revoked_at/invalidated_at");
});

// ─── ٧ · 🔴 لا تسريب للرمز في أيّ مسار مخرَجات ─────────────────────────────
test("لا دالّة تُعيد token أو token_fingerprint إلى عميل", () => {
  const sql = RUNME_S();
  // نطاق push_my_devices وحدها هي دالّة القراءة المتاحة للعميل.
  const start = sql.search(/create\s+or\s+replace\s+function\s+public\.push_my_devices/i);
  assert.ok(start > -1, "push_my_devices مفقودة");
  const body = sql.slice(start, sql.indexOf("$$;", sql.indexOf("$$", start + 40)));
  assert.ok(!/\btoken\b/i.test(body.replace(/push_tokens/gi, "")),
    "push_my_devices تُعيد الرمز أو تُشير إليه — القراءة الوحيدة المتاحة يجب أن تخلو منه");
});

test("push_mark_invalid تعمل بالبصمة لا بالرمز", () => {
  const sql = RUNME_S();
  const m = sql.match(/create\s+or\s+replace\s+function\s+public\.push_mark_invalid\s*\(([^)]*)\)/i);
  assert.ok(m, "push_mark_invalid مفقودة");
  assert.ok(/p_fingerprint/i.test(m[1]), "لا تأخذ بصمة");
  assert.ok(!/p_token\b/i.test(m[1]),
    "تأخذ الرمز وسيطًا — والوسائط تظهر في سجلّات الأخطاء وخطط التنفيذ");
});

test("⛔ لا رمز في raise/notice/comment على عمود الرمز", () => {
  const sql = RUNME_S();
  for (const r of sql.match(/raise\s+(exception|notice|warning)[^;]*/gi) ?? []) {
    assert.ok(!/\bp_token\b|\btoken\b\s*\|\||\|\|\s*token\b/i.test(r),
      `رسالة تُدرج الرمز: ${r.slice(0, 80)}`);
  }
});

// ─── ٨ · التوسعة لا الاستبدال ──────────────────────────────────────────────
test("🔴 توسّع نطاق الإشعارات القائم ولا تبني موازيًا", () => {
  const sql = RUNME_S();
  assert.ok(/alter\s+table\s+public\.notification_preferences/i.test(sql),
    "لم تُوسَّع التفضيلات القائمة — جدول تفضيلات ثانٍ نظام موازٍ");
  assert.ok(/notification_delivery_log/i.test(sql),
    "لم يُوسَّع سجلّ التسليم القائم");
  for (const bad of ["push_preferences", "push_delivery_log", "push_queue", "push_outbox"]) {
    assert.ok(!new RegExp(`create\\s+table[^;]*${bad}`, "i").test(sql),
      `أنشئ ${bad} — وهو نظام موازٍ للطابور/السجلّ القائم`);
  }
});

test("القيد الموسَّع يحفظ القيم القديمة كلّها", () => {
  const sql = RUNME_S();
  const m = sql.match(/check\s*\(channel\s+in\s*\([^)]*\)/i);
  assert.ok(m, "قيد القناة الجديد مفقود");
  for (const v of ["'portal'", "'email'", "'both'", "'none'", "'push'"]) {
    assert.ok(m[0].includes(v), `القيد الجديد أسقط ${v} — كتابات قائمة ستفشل بـ23514`);
  }
});

test("push_enabled افتراضها false", () => {
  const sql = RUNME_S();
  assert.ok(/push_enabled\s+boolean\s+not\s+null\s+default\s+false/i.test(sql),
    "الدفع مفعَّل افتراضيًّا — مُستقبِل خلفيّ لا يُورَّث بلا اختيار");
});

// ─── ٩ · قرار التشفير مُعلَن لا مُدَّعى ────────────────────────────────────
test("قرار التشفير مسجَّل صراحةً ولا يُدَّعى تشفير غير قائم", () => {
  const raw = read(P("RUNME"));
  assert.ok(/MOBILE PUSH TOKEN ENCRYPTION DECISION/.test(raw),
    "القرار المعلَّق غير مسجَّل في الحزمة");
  const sql = codeOnly(raw);
  assert.ok(!/pgp_sym_encrypt|encrypt\s*\(/i.test(sql),
    "الحزمة تُشفّر فعليًّا — عندئذ يجب أن توثَّق إدارة المفاتيح لا أن تُعلَّق");
});

// ─── ١٠ · التراجع لا يُدمّر بصمت ───────────────────────────────────────────
test("ROLLBACK لا يحذف عمود التفضيل ولا يضيّق القيد فوق بيانات قائمة", () => {
  const sql = codeOnly(read(P("ROLLBACK")));
  assert.ok(!/alter\s+table\s+public\.notification_preferences\s+drop\s+column/i.test(sql),
    "التراجع يحذف push_enabled — يمحو اختيار المستخدم نهائيًّا");
  assert.ok(/count\(\*\)/i.test(sql) && /channel\s*=\s*'push'/i.test(read(P("ROLLBACK"))),
    "التراجع يضيّق القيد بلا فحص صفوف push — يُفشل كل كتابة لاحقة");
});

// ─── ١١ · PREFLIGHT/POSTCHECK للقراءة فقط ──────────────────────────────────
test("PREFLIGHT وPOSTCHECK لا يكتبان شيئًا", () => {
  for (const n of ["PREFLIGHT", "POSTCHECK"]) {
    const sql = codeOnly(read(P(n)));
    for (const w of [/\binsert\s+into\b/i, /\bupdate\s+\w/i, /\bdelete\s+from\b/i,
                     /\bcreate\s+table\b/i, /\balter\s+table\b/i, /\bdrop\b/i, /\bgrant\b/i]) {
      assert.ok(!w.test(sql), `${n} يكتب: ${w}`);
    }
  }
});
