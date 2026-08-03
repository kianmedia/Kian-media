// ════════════════════════════════════════════════════════════════════════════
// tests/portal_nav_reachability.test.js
//
// ثلاثة أسطح مبنيّة بالكامل بقيت **بلا مدخل تنقّل**: دراسات الحالة والامتثال
// والاتّصالات. المسارات موجودة والمكوّنات مكتملة، ولا يصل إليها أحد إلّا بكتابة
// الرابط يدويًّا — بما فيهم المالك. ومفتاح تشغيل السطح العامّ لدراسات الحالة
// (public_enabled) لا يوجد إلّا داخل تلك الشاشة المظلمة.
//
// ولم يكن أيّ اختبار يفحص التسجيل، فبقيت الشاشة ميّتة مع مجموعة خضراء كاملة.
// هذا الحارس يمنع تكرار السهو: **كلّ** مسار داخليّ مبنيّ يجب أن يكون مسجَّلًا.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const NAV = fs.readFileSync(path.join(ROOT, "components/portal/nav.ts"), "utf8");
const DIR = path.join(ROOT, "app/(portal)/client-portal");

/** كلّ مسار داخليّ مبنيّ فعلًا: مجلّد ثابت فيه page.tsx. */
function builtRoutes() {
  return fs.readdirSync(DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("[") && !d.name.startsWith("_"))
    .filter((d) => fs.existsSync(path.join(DIR, d.name, "page.tsx")))
    .map((d) => d.name);
}
const roleSet = (r) => {
  const m = new RegExp(`^  ${r}:\\s*\\[([\\s\\S]*?)\\],`, "m").exec(NAV);
  return m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : null;
};

/**
 * مساراتٌ يُوصَل إليها بغير التبويبات — ولكلٍّ سببُه مكتوبًا.
 * ⚠️ ليست استثناءً بالاسم لإخفاء عطل: كلّ سطر هنا يذكر الطريق البديل، ومن
 *    أراد إضافة سطر فعليه أن يذكر طريقًا حقيقيًّا.
 */
const REACHED_OTHERWISE = {
  "reset-password":
    "صفحة هبوط لرابط استعادة كلمة المرور من GoTrue — تُفتح من البريد لا من تبويب",
  admin:
    "حاوية: ابنُها الحقيقيّ /client-portal/admin/whatsapp مسجَّل في nav.ts، " +
    "وصفحتها الجذر لوحةٌ محروسة بالدور تنتظر S9",
};

test("(١) ★★ كلّ مسار داخليّ مبنيّ له مدخل تنقّل ★★", () => {
  const unregistered = builtRoutes()
    .filter((r) => !NAV.includes(`/client-portal/${r}"`))
    .filter((r) => !(r in REACHED_OTHERWISE))
    .sort();
  assert.deepEqual(unregistered, [],
    "مسارات مبنيّة لا يصل إليها أحد إلّا بكتابة الرابط:\n  " + unregistered.join("\n  "));
  // والاستثناءات نفسها لا تتعفّن: كلٌّ منها مسارٌ ما زال موجودًا
  for (const r of Object.keys(REACHED_OTHERWISE))
    assert.ok(fs.existsSync(path.join(DIR, r, "page.tsx")),
      `استثناء لمسار لم يعد موجودًا — احذفه: ${r}`);
  // وابن admin المسجَّل موجود فعلًا، وإلّا صار الاستثناء كذبًا
  assert.ok(NAV.includes("/client-portal/admin/whatsapp"),
    "استثناء admin يتّكئ على ابنٍ غير مسجَّل");
});

test("(٢) ★★ الثلاثة المُصلَحة مسجَّلة للأدوار الإداريّة وحدها ★★", () => {
  for (const k of ["case_studies", "compliance", "communications"]) {
    assert.ok(NAV.includes(`${k}:`), `المفتاح غير معرَّف في السجلّ: ${k}`);
    for (const r of ["admin", "super_admin", "manager"]) {
      const set = roleSet(r);
      assert.ok(set, `مجموعة الدور مفقودة: ${r}`);
      assert.ok(set.includes(k), `${r} لا يرى ${k}`);
    }
    // ★ داخليّ بحت: لا العميل ولا الزائر
    for (const r of ["client", "lead"]) {
      const set = roleSet(r);
      if (!set) continue;
      assert.ok(!set.includes(k), `★ ${r} يرى سطحًا داخليًّا: ${k}`);
    }
  }
});

test("(٣) ★ كلّ مفتاح في أيّ مجموعة دور معرَّف في السجلّ ★", () => {
  const reg = new Set([...NAV.matchAll(/^  ([a-z_]+):\s*\{ href:/gm)].map((m) => m[1]));
  const bad = [];
  for (const m of NAV.matchAll(/^  ([a-z_]+):\s*\[([\s\S]*?)\],/gm))
    for (const k of [...m[2].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]))
      if (!reg.has(k)) bad.push(`${m[1]} → ${k}`);
  assert.deepEqual(bad, [], `مفاتيح بلا تعريف في السجلّ: ${bad.join(", ")}`);
});

test("(٤) ★ كلّ href في السجلّ يشير إلى صفحة موجودة ★", () => {
  const bad = [];
  for (const m of NAV.matchAll(/href:\s*"\/client-portal\/([a-z-]+)"/g))
    if (!fs.existsSync(path.join(DIR, m[1], "page.tsx"))) bad.push(m[1]);
  assert.deepEqual(bad, [], `تبويب يشير إلى صفحة غير موجودة: ${bad.join(", ")}`);
});

test("SAFE: ساكن فقط", () => {
  const src = fs.readFileSync(__filename, "utf8");
  for (const [what, re] of [["شبكة", new RegExp("\\b" + "fet" + "ch\\s*\\(")],
                            ["عمليّة", new RegExp("\\b" + "child_" + "process\\b")]])
    assert.doesNotMatch(src, re, `الفاحص يلمس ${what}`);
});
