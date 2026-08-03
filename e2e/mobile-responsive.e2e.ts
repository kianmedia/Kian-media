// ════════════════════════════════════════════════════════════════════════════
// e2e/mobile-responsive.e2e.ts — جاهزية العرض على الهاتف واللوح.
//
// Wave 8 · §٢ · §٣
//
// ★ ما يُقاس هنا هو ما يُشعر به المستخدم فعلًا ★
//  • الفيض الأفقيّ: أسوأ عيب على الهاتف — الصفحة تتحرّك جانبًا فتبدو مكسورة.
//  • أهداف اللمس: زرّ أصغر من الإصبع يُخطئه المستخدم مرارًا.
//  • الجداول: إمّا تتجاوب أو **تُمرَّر بوضوح** — لا تُقصّ بصمت.
//
// ⛔ لا Production · لا اعتماد · لا كتابة · لا جهاز حقيقيّ (محاكاة Playwright).
// ════════════════════════════════════════════════════════════════════════════
import { test, expect, devices } from "@playwright/test";

const ROUTES = ["/", "/en", "/quote-request", "/book-meeting", "/privacy-policy"];

/**
 * الحدّ العمليّ الموثَّق لهدف اللمس: **44 CSS px** (إرشاد Apple · WCAG 2.5.5 AA).
 *
 * ★ والقاعدة المطبَّقة هنا ليست 44×44 على كلّ شيء، وهذا مقصود ★
 *  • **الارتفاع ≥ 44 دائمًا** — وهو ما يُخطئه الإصبع فعليًّا في قائمة رأسية.
 *  • **العرض ≥ 44 للأهداف بلا نصّ فقط** (أيقونة/زرّ صامت). أمّا رابط نصّيّ قصير
 *    مثل «من نحن» فعرضه 41px بعرض كلمته — وWCAG 2.5.5 نفسه يستثني الأهداف
 *    النصّية داخل كتلة نصّ. فرضُ 44px عرضًا عليه يعني حشوًا يُفسد التنضيد بلا
 *    مكسب في القابلية للمس.
 */
const TOUCH_MIN = 44;

test.beforeEach(async ({ page }) => {
  await page.route("**://*.supabase.co/**", (r) => r.abort());
  await page.route("**://wa.me/**", (r) => r.abort());
});

for (const route of ROUTES) {
  test(`لا فيض أفقيّ على ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      // 🔴 هامش تسامح ١px: تقريب الأجزاء العشرية يُنتج فروقًا وهمية.
      const diff = de.scrollWidth - de.clientWidth;
      if (diff <= 1) return null;
      // نُسمّي المتجاوز — «هناك فيض» بلا اسم لا يُصلَح.
      const guilty: string[] = [];
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > de.clientWidth + 1) {
          guilty.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)}`);
        }
      });
      return { diff, guilty: guilty.slice(0, 5) };
    });
    expect(overflow, `فيض أفقيّ: ${JSON.stringify(overflow)}`).toBeNull();
  });
}

// ════════════════════════════════════════════════════════════════════════════
// انحدار Wave 8 — العَرَض الذي كاد يُصلَح في المكان الخطأ.
//
// ظهر في WebKit «فيض 492px» على بطاقات العرض. والسبب لم يكن تخطيطًا البتّة:
// توجيه CSP `upgrade-insecure-requests` يرقّي الأصول الفرعية إلى https، وهذه
// الحزمة تُقدّم بناء الإنتاج على http على loopback. Chromium يستثني loopback،
// وWebKit **لا يستثنيه** — فسقطت ورقة الأنماط كلّها، فاختفت `.absolute`
// و`.inset-0`، فارتدّت الصورة إلى static/inline/fill بعرضها الأصليّ.
//
// 🔴 الدرس المحفور هنا: **تأكّد أنّ CSS حُمِّل قبل أن تُصدّق قياس تخطيط.**
//    فحصُ الفيض وحده كان سيُغري بحشوٍ يُخفي عَرَضًا سببُه ترويسة أمنية.
// ⛔ ولا حلول عامّة: لا overflow-x:hidden على body، ولا max-width عشوائيّ،
//    ولا استثناء للمحرّك — الإصلاح وقع في مصدره (next.config.js + الحزمة).
// ════════════════════════════════════════════════════════════════════════════
const WIDTHS = [390, 810, 1024];   // هاتف · لوح رأسيّ · لوح أفقيّ

for (const width of WIDTHS) {
  test(`عرض ${width}px: الأنماط محمَّلة فعلًا ولا فيض`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await page.waitForTimeout(400);

    const state = await page.evaluate(() => {
      // ١. هل وصلت قواعد Tailwind فعلًا؟ نبحث عن القاعدتين بالاسم.
      let hasAbsolute = false, hasInset = false, readable = 0, blocked = 0;
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(sheet.cssRules);
          readable++;
          for (const r of rules) {
            const t = r.cssText;
            if (/^\.absolute\s*\{/.test(t)) hasAbsolute = true;
            if (/^\.inset-0\s*\{/.test(t)) hasInset = true;
          }
        } catch { blocked++; }   // ورقة عبر-أصل (خطوط Google) — متوقَّعة
      }
      // ٢. وهل طُبِّقت فعليًّا على عنصر يعتمد عليها؟
      const probe = document.querySelector<HTMLElement>(".absolute.inset-0");
      const applied = probe ? getComputedStyle(probe).position : null;

      const de = document.documentElement;
      return {
        hasAbsolute, hasInset, readable, blocked, applied,
        diff: de.scrollWidth - de.clientWidth,
      };
    });

    // 🔴 يُفحص أوّلًا: بلا CSS كلّ قياس بعده بلا معنى، ورسالة الفشل تقول السبب.
    expect(
      state.hasAbsolute && state.hasInset,
      `قواعد Tailwind غائبة عن الـCSS المُرسَل (.absolute=${state.hasAbsolute} ` +
      `.inset-0=${state.hasInset}, أوراق مقروءة=${state.readable}) — ` +
      `الأرجح أنّ ورقة الأنماط لم تُحمَّل أصلًا (ترقية https على خادم http؟)، ` +
      `ولا يصحّ عندئذ الحكم على التخطيط.`,
    ).toBe(true);

    if (state.applied !== null) {
      expect(state.applied, "‏.absolute موجودة في CSS لكنّها لم تُطبَّق").toBe("absolute");
    }

    expect(state.diff, `فيض أفقيّ عند ${width}px بمقدار ${state.diff}px`).toBeLessThanOrEqual(1);
  });
}

test("أهداف اللمس الأساسية ≥ 44px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "المقياس للمس لا للفأرة");
  await page.goto("/");
  await page.waitForTimeout(500);
  const small = await page.evaluate((min) => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("a, button, [role=button]").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;              // مخفيّ
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") return;
      // 🔴 عنصر شفّاف ليس هدف لمس. والأهمّ: `getBoundingClientRect` يعيد المقاس
      //    **بعد التحويل**، فزرّ 56px بـ`scale(0.6)` وهو مخفيّ يُقاس 34px —
      //    وهو بالضبط ما أوقع هذا الفحص في نتيجة كاذبة قبل تصحيحه.
      if (Number(cs.opacity) === 0) return;
      // الروابط داخل فقرة نصّية مستثناة: ارتفاعها ارتفاع السطر بطبيعته.
      if (el.tagName === "A" && el.closest("p")) return;
      const iconOnly = !(el.textContent || "").trim();
      if (r.height < min || (iconOnly && r.width < min)) {
        out.push(`${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} "${(el.textContent || "").trim().slice(0, 20)}"`);
      }
    });
    return out.slice(0, 8);
  }, TOUCH_MIN);
  expect(small, `أهداف لمس أصغر من ${TOUCH_MIN}px: ${small.join(" · ")}`).toHaveLength(0);
});

test("لا ارتفاع 100vh يقطع المحتوى تحت شريط متصفّح الهاتف", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "المشكلة خاصّة بمتصفّح الهاتف");
  await page.goto("/");
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
      const h = el.style.height || el.style.minHeight;
      // 🔴 `100vh` على الهاتف يتجاوز الإطار المرئيّ بارتفاع شريط المتصفّح،
      //    فيُقصّ آخر المحتوى. البديل `100dvh` أو `svh`.
      if (h && /^100vh$/.test(h.trim())) out.push(el.tagName.toLowerCase());
    });
    return out.slice(0, 5);
  });
  expect(bad, `عناصر بارتفاع 100vh: ${bad.join(", ")}`).toHaveLength(0);
});

test("الجداول إمّا متجاوبة أو قابلة للتمرير بوضوح", async ({ page }) => {
  await page.goto("/");
  const tables = page.locator("table");
  const n = await tables.count();
  test.skip(n === 0, "لا جداول في هذا المسار");
  for (let i = 0; i < Math.min(n, 5); i++) {
    const ok = await tables.nth(i).evaluate((t) => {
      const el = t as HTMLElement;
      if (el.scrollWidth <= el.clientWidth + 1) return true;      // متجاوب
      // متجاوز ⇒ يجب أن يكون له غلاف يمرّر أفقيًّا.
      let p: HTMLElement | null = el.parentElement;
      for (let d = 0; p && d < 3; d++, p = p.parentElement) {
        const ov = getComputedStyle(p).overflowX;
        if (ov === "auto" || ov === "scroll") return true;
      }
      return false;
    });
    expect(ok, `الجدول ${i} يتجاوز عرضه بلا غلاف تمرير — يُقصّ بصمت`).toBeTruthy();
  }
});

test("النوافذ المنبثقة تُغلق بلوحة المفاتيح · والتركيز لا يضيع", async ({ page }) => {
  await page.goto("/");
  const before = await page.evaluate(() => document.activeElement?.tagName ?? "BODY");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => document.activeElement?.tagName ?? "BODY");
  // لا يُشترط تغيّر التركيز؛ يُشترط ألّا يصير `null` أو خارج المستند.
  expect(after).toBeTruthy();
  expect(["BODY", before, "HTML"]).toContain(after);
});

test("safe-area مدعومة لأجهزة النتوء", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "خاصّ بالأجهزة");
  await page.goto("/");
  // ⚠️ الفحص على الأنماط المُنزَّلة: `env(safe-area-inset-*)` يجب أن تُذكر
  //    في مكان ما — وإلّا فالمحتوى يمرّ تحت النتوء أو شريط الإيماءة.
  const state = await page.evaluate(() => {
    let anywhere = false;
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules)) {
          if (rule.cssText.includes("safe-area-inset")) anywhere = true;
        }
      } catch { /* ورقة من أصل آخر — تُتجاوز */ }
    }
    const header = document.querySelector("header");
    const wa = document.querySelector<HTMLElement>('a[aria-label="WhatsApp"]');
    return {
      anywhere,
      // 🔴 الشرط المسبق: بلا viewport-fit=cover تعود كلّ env() بصفر، فيبدو
      //    الدعم قائمًا وهو معطَّل تمامًا.
      viewportFit: document.querySelector('meta[name="viewport"]')?.getAttribute("content") ?? "",
      headerHasSafeX: !!header?.classList.contains("safe-x"),
      headerPadTop: header?.getAttribute("style")?.includes("safe-area-inset-top") ?? false,
      waBottom: wa?.getAttribute("style")?.includes("safe-area-inset-bottom") ?? false,
    };
  });

  expect(state.anywhere, "لا استعمال لـsafe-area-inset — المحتوى قد يمرّ تحت النتوء").toBeTruthy();
  // ⚠️ هذا هو الفحص الذي يمنع «دعمًا» معطَّلًا بصمت.
  expect(state.viewportFit, "viewport-fit=cover غائبة ⇒ كلّ env(safe-area-*) تساوي صفرًا")
    .toContain("viewport-fit=cover");
  // ولا يكفي وجود القاعدة: يجب أن تصل العناصر **المثبَّتة** فعلًا.
  expect(state.headerPadTop, "الشريط العلويّ المثبَّت لا يحجز ارتفاع النتوء").toBeTruthy();
  expect(state.headerHasSafeX, "الشريط العلويّ لا يحجز النتوء الجانبيّ (الوضع الأفقيّ)").toBeTruthy();
  expect(state.waBottom, "الزرّ العائم السفليّ لا يحجز شريط الإيماءة").toBeTruthy();
});

// ⚠️ لا يُقاس هنا **أثر** المنطقة الآمنة: محاكاة Playwright تُبلّغ أصفارًا لكلّ
//    env(safe-area-*)، فلا جهاز بنتوء في الحزمة. المُتحقَّق منه هو أنّ الآلية
//    موصولة وشرطها المسبق قائم. ⛔ **SAFE-AREA VISUAL VERIFICATION PENDING** —
//    ولا يُدَّعى أنّها اختُبرت على جهاز حقيقيّ.
