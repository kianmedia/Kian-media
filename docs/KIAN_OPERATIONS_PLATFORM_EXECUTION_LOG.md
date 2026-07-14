# Kian Operations Platform V1 — Execution Log

> سجل تنفيذ زمني. الأحدث أعلى. كل إدخال: ما بُني + الملفات + حالة التحقق + الخطوة اليدوية المطلوبة.

---

## 2026-07-14 — Module 1: Testimonials (آراء العملاء) — `code_complete`
**الهدف:** أول قيمة مرئية — تحويل قسم "Reviews" في الرئيسية من حالة فارغة ثابتة إلى نظام حقيقي
(عرض معتمد عام + استقبال عام مع Rate-Limit + اعتدال إداري)، خلف علم `testimonials_enabled` (OFF افتراضيًا).

**ما بُني (كود فعلي — لا واجهات وهمية):**
- **SQL (migration فقط — يُطبّق يدويًا):** [docs/kian_testimonials_v1_RUNME.sql](kian_testimonials_v1_RUNME.sql)
  - علم `testimonials_enabled` (عمود جديد آمن على `custody_enterprise_settings`، default false).
  - جدول `kian_testimonials` + RLS (قراءة PostgREST لـ civ_can_manage فقط، لا صلاحيات anon).
  - RPC عامة `kian_public_testimonials(limit)` (anon) — محكومة بالعلم، حقول آمنة فقط.
  - RPC عامة `kian_submit_testimonial(...)` (anon) — تحقّق + Rate-Limit 3/ساعة على IP.
  - RPCs اعتدال (civ_can_manage): moderate / set_feature / admin_create / admin_settings.
  - RPC تفعيل العرض (civ_can_admin — مالك فقط): set_enabled.
  - Preflight + Validation + Rollback معلّق (غير مدمّر).
- **Client lib:** [lib/portal/testimonials.ts](../lib/portal/testimonials.ts) — قراءة عامة (anon fetch، تتدهور بلطف)
  + استقبال + wrappers الإدارة + خريطة أخطاء عربية.
- **الرئيسية:** [components/Reviews.tsx](../components/Reviews.tsx) — تعرض الشهادات المعتمدة؛ عند التعطيل/الفراغ/
  الفشل تُبقي الحالة الفارغة الأنيقة الحالية **دون أي تراجع** (zero regression).
- **صفحة عامة:** [app/share-experience/page.tsx](../app/share-experience/page.tsx) — نموذج مشاركة عام مع موافقة نشر.
- **اعتدال:** [components/portal/AdminTestimonials.tsx](../components/portal/AdminTestimonials.tsx)
  + [app/client-portal/testimonials/page.tsx](../app/client-portal/testimonials/page.tsx)
  + تبويب `testimonials` في [components/portal/nav.ts](../components/portal/nav.ts) (owner/super_admin/manager).

**التحقق:** بيئة بلا node/build؛ رُوجِع ساكنًا: توازن SQL (begin/commit=1/1، `$$`=8 أزواج)،
منح anon على RPCs العامة فقط، RLS مفعّل، مطابقة civ_can_manage/civ_can_admin لبوابات الواجهة.
`next.config` يتجاهل أخطاء TS/ESLint في البناء ⇒ لا خطر كسر build. لم يُختبر حيًا بعد.

**سلامة عدم التراجع:** كل شيء إضافي + خلف علم OFF ⇒ الرئيسية الحية لا تتغيّر حتى تطبيق SQL + تفعيل العلم.

**الخطوات اليدوية للتفعيل:**
1. Push الفرع.  2. تشغيل `kian_testimonials_v1_RUNME.sql`.  3. (لاحقًا) من تبويب «آراء العملاء»:
   اعتماد شهادة تجريبية ثم تفعيل «العرض العام» (مالك). قبل ذلك تبقى الرئيسية على حالتها.

---

## 2026-07-14 — Phase 0: إصلاحات فرع التأجير الحية — `code_complete` (غير مدفوع/مطبّق)
- إصلاح توقيع العقد للمستأجر (تدفّق signed-upload لمرحلة `contract` + إظهار نص العقد + إظهار الأخطاء) — commit `beccc2a`.
- إصلاح رفع الأدلة (signed-upload) + دورة الإرجاع المضبوطة — commits سابقة على الفرع.
- **حاجز:** غير مرئي في Preview حتى Push + تطبيق `rental_v1_final_production_RUNME.sql` + ضبط env
  (`SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_URL`) على Vercel. انظر [BLOCKERS](KIAN_PLATFORM_BLOCKERS.md).
