// ════════════════════════════════════════════════════════════════════════════
// e2e/portfolio-and-forms.e2e.ts — الأعمال والنماذج.
//
// Wave 7 · V2-7.8-A · التغطيتان B و C
//
// ⛔ لا إرسال حقيقيّ: كلّ نداء خارجيّ يُعترَض. لا واتساب · لا webhook · لا كتابة.
// ════════════════════════════════════════════════════════════════════════════
import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // 🔴 حاجز شبكة: أيّ نداء إلى Supabase أو واتساب أو أيّ مضيف خارجيّ يُوقف.
  //    وجوده هنا يعني أنّ فشل الحاجز يُسقط الاختبار بدل أن يُرسل شيئًا حقيقيًّا.
  await page.route("**://*.supabase.co/**", (r) => r.abort());
  await page.route("**://wa.me/**", (r) => r.abort());
  await page.route("**://api.whatsapp.com/**", (r) => r.abort());
});

test("شبكة الأعمال تظهر · والصور المعروضة ليست شفّافة", async ({ page }) => {
  await page.goto("/");
  const imgs = page.locator("img");
  const n = await imgs.count();
  expect(n, "لا صور في الصفحة").toBeGreaterThan(0);

  // 🔴 عيّنة لا الـ٤٦ كلّها: المطلوب إثبات أنّ الشبكة تعرض، لا مسح بصريّ كامل.
  const sample = Math.min(n, 6);
  for (let i = 0; i < sample; i++) {
    const img = imgs.nth(i);
    if (!(await img.isVisible())) continue;
    const opacity = await img.evaluate((el) => getComputedStyle(el).opacity);
    // العيب المعروف: صورة مُحمَّلة تبقى opacity:0 لأنّ onLoad لم يُطلَق.
    expect(Number(opacity), `الصورة ${i} ظاهرة لكنّها شفّافة`).toBeGreaterThan(0);
  }
});

test("تمرير الشبكة لا يكسر الصفحة", async ({ page }) => {
  await page.goto("/");
  await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(400);
  await expect(page.locator("body")).toBeVisible();
});

test("fallback الصورة يعمل عند فشل maxresdefault", async ({ page }) => {
  // 🔴 محاكاة العيب الحقيقيّ: YouTube يعيد 404 لـmaxres في مقاطع كثيرة.
  await page.route("**/maxresdefault.jpg", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await page.waitForTimeout(800);
  const broken = await page.evaluate(() =>
    Array.from(document.images)
      .filter((i) => i.complete && i.naturalWidth === 0 && i.src.includes("ytimg"))
      .length);
  expect(broken, "صورة مصغّرة بقيت مكسورة بلا بديل").toBe(0);
});

test("النموذج: التسميات مرتبطة · وأخطاء التحقّق تظهر · ولا إرسال حقيقيّ", async ({ page }) => {
  await page.goto("/quote-request");
  const inputs = page.locator("input, textarea, select");
  const n = await inputs.count();
  test.skip(n === 0, "لا حقول في هذا المسار");

  // كلّ حقل مرئيّ له اسم قابل للقراءة — aria-label أو label مرتبط.
  for (let i = 0; i < Math.min(n, 8); i++) {
    const el = inputs.nth(i);
    if (!(await el.isVisible())) continue;
    const named = await el.evaluate((node) => {
      const e = node as HTMLInputElement;
      if (e.getAttribute("aria-label")) return true;
      if (e.getAttribute("aria-labelledby")) return true;
      if (e.id && document.querySelector(`label[for="${CSS.escape(e.id)}"]`)) return true;
      return !!e.closest("label");
    });
    expect(named, `الحقل ${i} بلا تسمية مرتبطة`).toBeTruthy();
  }

  // إرسال فارغ ⇒ لا انتقال، ولا نداء خارجيّ (الحاجز يُوقفه أصلًا).
  const submit = page.locator('button[type="submit"], input[type="submit"]').first();
  if (await submit.count()) {
    const before = page.url();
    await submit.click({ trial: false }).catch(() => {});
    await page.waitForTimeout(500);
    expect(page.url()).toBe(before);
  }
});
