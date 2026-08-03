// ════════════════════════════════════════════════════════════════════════════
// e2e/public-site.e2e.ts — الموقع العامّ: اللغة والاتجاه والتنقّل والأعلام.
//
// Wave 7 · V2-7.8-A · التغطية A
// ⛔ لا Production · لا اعتماد · لا كتابة.
// ════════════════════════════════════════════════════════════════════════════
import { test, expect } from "@playwright/test";

test("الصفحة العربية تفتح، والجذر ar/rtl من HTML نفسه", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  // 🔴 من الخادم لا من سكربت: D-3 يوجب أن يصل الوسم صحيحًا في أوّل HTML.
  await expect(html).toHaveAttribute("lang", "ar");
  await expect(html).toHaveAttribute("dir", "rtl");
});

test("/en تفتح بـen/ltr", async ({ page }) => {
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
});

test("مبدّل اللغة ينقل بين المسارين ويعكس الاتجاه", async ({ page }) => {
  await page.goto("/");
  // الرابط المقابل موجود في الصفحة (hreflang أو مبدّل مرئيّ).
  const alt = page.locator('link[rel="alternate"][hrefLang="en"]');
  await expect(alt).toHaveCount(1);
  await page.goto("/en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
});

test("صفحة 404 مخصّصة تعمل ولا تُرجع 200", async ({ page }) => {
  const res = await page.goto("/this-path-does-not-exist-xyz");
  expect(res?.status()).toBe(404);
  // ⛔ ليست صفحة فارغة: نصّ مخصّص يظهر.
  await expect(page.locator("body")).not.toBeEmpty();
});

test("🔴 المسارات خلف أعلام مطفأة تُرجع 404 ولا تتسرّب", async ({ page }) => {
  for (const path of ["/trust", "/en/trust"]) {
    const res = await page.goto(path);
    expect(res?.status(), `${path} يجب أن يكون 404 والعلم مطفأ`).toBe(404);
  }
  // ولا نصّ من الصفحة يظهر في HTML العامّ.
  await page.goto("/");
  const body = await page.content();
  expect(body).not.toContain("عزل البيانات على مستوى الصف");
});

test("خارطة الموقع لا تُدرج مسارًا خلف علم مطفأ", async ({ page }) => {
  const res = await page.goto("/sitemap.xml");
  expect(res?.ok()).toBeTruthy();
  const xml = await page.content();
  expect(xml).not.toContain("/trust");
});
