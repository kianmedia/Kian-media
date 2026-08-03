// ════════════════════════════════════════════════════════════════════════════
// e2e/portal-security.e2e.ts — أمن البوّابة والبحث وعارض التدقيق.
//
// Wave 7 · V2-7.8-A · التغطيات D و E و F
//
// ⛔ لا حساب Production · لا جلسة حقيقية · لا كتابة. الاختبارات تثبت **الرفض**
//    لا الوصول — وهو ما يمكن إثباته بلا اعتماد.
// ════════════════════════════════════════════════════════════════════════════
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**://*.supabase.co/**", (r) => r.abort());
});

test("🔴 مسار محميّ لا يكشف بيانات لزائر بلا جلسة", async ({ page }) => {
  await page.goto("/client-portal/registers");
  await page.waitForTimeout(600);
  const body = (await page.locator("body").innerText()).toLowerCase();
  // لا صفوف ولا أسماء ولا أرقام — إمّا تحويل لتسجيل الدخول أو حالة فارغة.
  for (const leak of ["activity_log", "asset_code", "person_name", "purchase_price"]) {
    expect(body, `تسرّب لزائر بلا جلسة: ${leak}`).not.toContain(leak.toLowerCase());
  }
});

test("🔴 صفحة QR محايدة للمجهول — لا تؤكّد ولا تنفي وجود الرمز", async ({ page }) => {
  await page.goto("/e/11111111-1111-1111-1111-111111111111");
  await page.waitForTimeout(600);
  const body = await page.locator("body").innerText();
  // العقد: لا تأكيد ولا نفي. أيّ من هذه العبارات يكشف حالة الرمز.
  for (const reveal of ["غير موجود", "رمز غير صحيح", "أُلغي", "invalid"]) {
    expect(body, `الرسالة تكشف حالة الرمز: ${reveal}`).not.toContain(reveal);
  }
  // ولا حقل حسّاس بأيّ حال.
  for (const leak of ["purchase_price", "employee", "bucket/"]) {
    expect(body).not.toContain(leak);
  }
});

test("العلم مطفأ ⇒ لا لوحة بحث بـCmd+K ولا مستمع", async ({ page }) => {
  await page.goto("/client-portal");
  await page.keyboard.press("Meta+K");
  await page.waitForTimeout(400);
  await expect(page.getByRole("dialog", { name: "بحث شامل" })).toHaveCount(0);
});

test("العلم مطفأ ⇒ عارض التدقيق غير ظاهر ولا يستدعي شيئًا", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (r) => { if (r.url().includes("audit_viewer_list")) calls.push(r.url()); });
  await page.goto("/client-portal/registers");
  await page.waitForTimeout(600);
  const body = await page.locator("body").innerText();
  expect(body).not.toContain("سجلّ الإجراءات");
  // 🔴 والأهمّ: لا طلب خلفيّ خلف علم مطفأ.
  expect(calls, "استُدعي عارض التدقيق والعلم مطفأ").toHaveLength(0);
});
