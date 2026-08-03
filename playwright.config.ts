// ════════════════════════════════════════════════════════════════════════════
// playwright.config.ts — E2E فوق ٢٤٠+ ملفّ اختبار قائم، **لا بديلًا عنها**.
//
// Wave 7 · V2-7.8-A
//
// ★ حدود صارمة ★
//  • `baseURL` محلّيّ فقط. ⛔ لا عنوان Production ولا Preview.
//  • `webServer` يبني ويشغّل نسخة الإنتاج محلّيًّا — لا خادم تطوير بطيء الترجمة.
//  • كلّ الأعلام **مطفأة** في بيئة الاختبار إلّا ما يختبره الملفّ صراحةً،
//    فالافتراض المُختبَر هو الافتراض المشحون.
//  • ⛔ لا اعتماد حقيقيّ ولا مفتاح: الاختبارات تعترض الشبكة (`route mocks`).
//  • أثر التتبّع ولقطة الشاشة **عند الفشل فقط** — لا تضخيم مخرَجات.
// ════════════════════════════════════════════════════════════════════════════
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // ⛔ لا يلتقط اختبارات node:test القائمة في tests/ — لكلٍّ مشغّله.
  testMatch: /.*\.e2e\.ts$/,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // ⛔ لا تخزين اعتماد: كلّ اختبار يبدأ بلا جلسة.
    storageState: undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone",   use: { ...devices["Pixel 5"] } },
    { name: "tablet",  use: { ...devices["iPad (gen 7)"] } },
  ],
  webServer: {
    // نسخة إنتاج محلّيّة: الأعلام تُدمج وقت البناء، فاختبارها هنا يختبر ما يُشحن.
    command: `npm run build && npx next start -p ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      // 🔴 الأعلام مطفأة صراحةً — الافتراض المشحون هو المُختبَر.
      NEXT_PUBLIC_SHOW_TRUST_PAGE: "",
      NEXT_PUBLIC_SHOW_SEO_PAGES: "",
      NEXT_PUBLIC_SHOW_TESTIMONIALS: "",
      NEXT_PUBLIC_SHOW_AUDIT_VIEWER: "",
      NEXT_PUBLIC_SHOW_GLOBAL_SEARCH: "",
    },
  },
});
