/**
 * ════════════════════════════════════════════════════════════════════════════
 * scripts/seed-preview.ts — بذر بيانات وهمية في بيئة Preview.
 *
 * Wave 0 · V2-0.3-C  (MASTER_BRIEF_v2.1.md §4 WAVE 0)
 *
 * ★ لماذا يوجد ★
 *   v2.1 يشطب `DEMO_MODE` داخل Production بوصفه خطرًا محذوفًا (V2-7.7-A):
 *   بيانات وهمية بجانب بيانات عملاء حقيقيين. البديل المعتمَد هو **بيئة منفصلة
 *   ببيانات وهمية فقط** — وهذا السكربت هو الذي يملؤها.
 *
 * ★ ثلاثة حواجز قبل أي كتابة ★
 *   لا يكفي أن ينوي المشغّل تشغيله على Preview. سكربت بذر يُشغَّل بالخطأ على
 *   الإنتاج يزرع «شركة الأفق» بين عملاء حقيقيين، ولا يوجد تراجع نظيف عن ذلك.
 *   لذلك يرفض العمل ما لم تتحقّق **الثلاثة معًا**:
 *     ١. KIAN_SEED_TARGET=preview            (نيّة صريحة)
 *     ٢. SUPABASE_URL ≠ عنوان الإنتاج        (هوية القاعدة)
 *     ٣. --confirm على سطر الأوامر            (فعل واعٍ)
 *
 *   الحاجز (٢) هو الحقيقي: الأول والثالث يمكن نسخهما بلا تفكير، أمّا مقارنة
 *   عنوان القاعدة فتكشف الخطأ الفعلي — تشغيله وأنت موصول بالإنتاج.
 *
 * ★ التشغيل ★
 *   KIAN_SEED_TARGET=preview \
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   KIAN_PRODUCTION_SUPABASE_URL=... \
 *   npx tsx scripts/seed-preview.ts --confirm
 *
 * ⚠️ Wave 0 يُنشئ **الحواجز والهيكل** فقط. مجموعات البذور الفعلية تُضاف مع كل
 *    موجة تحتاجها — بذر جداول لم تُفعَّل ميزاتها بعد يخلق بيانات لا يقرأها أحد.
 *    ولا يُطبع أي سرّ ولا أي جزء منه (G5).
 * ════════════════════════════════════════════════════════════════════════════
 */

type Guard = { ok: boolean; reason: string };

const FAKE_CLIENT = "شركة الأفق (بيانات تجريبية)";

function checkGuards(argv: string[], env: NodeJS.ProcessEnv): Guard {
  if (env.KIAN_SEED_TARGET !== "preview") {
    return { ok: false, reason: "KIAN_SEED_TARGET ليست 'preview' — ارفض." };
  }
  if (!argv.includes("--confirm")) {
    return { ok: false, reason: "ناقص --confirm — ارفض." };
  }
  const url = (env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  if (!url) {
    return { ok: false, reason: "SUPABASE_URL غير مضبوط — لا يمكن إثبات أي قاعدة سنكتب عليها." };
  }
  const prod = (env.KIAN_PRODUCTION_SUPABASE_URL ?? "").trim();
  if (!prod) {
    // بلا مرجع للإنتاج لا يمكن إثبات الاختلاف — والافتراض الآمن هو الرفض.
    return { ok: false, reason: "KIAN_PRODUCTION_SUPABASE_URL غير مضبوط — لا يمكن إثبات أن الهدف ليس الإنتاج." };
  }
  if (url === prod) {
    return { ok: false, reason: "🔴 الهدف هو قاعدة الإنتاج نفسها — ارفض قطعًا." };
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, reason: "SUPABASE_SERVICE_ROLE_KEY غير مضبوط." };
  }
  return { ok: true, reason: "الحواجز الثلاثة اجتازت." };
}

async function main(): Promise<void> {
  const g = checkGuards(process.argv.slice(2), process.env);
  if (!g.ok) {
    // ❌ لا يُطبع أي عنوان ولا مفتاح — الاسم والحالة فقط (G5).
    console.error(`[seed-preview] رُفض: ${g.reason}`);
    process.exit(1);
  }

  console.log("[seed-preview] الحواجز اجتازت. الهدف ليس الإنتاج.");
  console.log(`[seed-preview] العميل التجريبي: ${FAKE_CLIENT}`);
  console.log("[seed-preview] ⚠️ Wave 0: لا مجموعات بذور بعد — الحواجز والهيكل فقط.");
  console.log("[seed-preview] تُضاف البذور مع كل موجة تحتاجها. لم تُكتب أي بيانات.");
}

// قابل للاختبار بلا تشغيل: tests/wave0_safety_contracts.test.js يستورد checkGuards.
export { checkGuards, FAKE_CLIENT };

if (require.main === module) {
  void main();
}
