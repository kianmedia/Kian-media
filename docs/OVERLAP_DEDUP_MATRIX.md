# OVERLAP_DEDUP_MATRIX — مصفوفة التداخل ومنع الازدواج

> **الحالة:** مُنتَج ضمن مهمة `MASTER_ORDER_FINAL.md` (READ-ONLY audit).
> **الفرع:** `docs/v2_1-audit` · **HEAD وقت التحليل:** `c6136df` (شجرة الكود `7b92391`)
> **المصدر المُدقَّق:** `MASTER_BRIEF.md` — *KIAN PLATFORM — MASTER EXECUTION BRIEF v2.0
> (SUPERSEDES v1 ENTIRELY)*، 170 سطرًا. **لم يُمس ولم يُنقل ولم يُعدَّل.**
> **لا SQL · لا اتصال بـProduction · لا كود · لا Push.**

---

## كيف تُقرأ هذه المصفوفة

**IDs ثابتة** بصيغة `V2-<wave>.<item>-<letter>` — تُستخدم **نفسها** في
[`MASTER_BRIEF_v2.1.md`](../MASTER_BRIEF_v2.1.md) و
[`V2_1_CHANGELOG.md`](V2_1_CHANGELOG.md) و[`V2_1_EXECUTIVE_SUMMARY_AR.md`](V2_1_EXECUTIVE_SUMMARY_AR.md).

**Overlap Level:** `None` · `Low` · `Medium` · `High` · `Exact Duplicate`

**Decision** — واحدة فقط لكل متطلب:
| الرمز | المعنى |
|---|---|
| 🆕 `KEEP — NEW` | لا يوجد ما يغطيه — يُبنى فعلًا |
| 🔧 `VERIFY & EXTEND` | موجود جزئيًا — يُكمَّل أو يُصلَح لا يُعاد بناؤه |
| 🔗 `MERGE INTO EXISTING` | يوجد نظام يغطي المجال — يُدمج فيه كامتداد |
| ❌ `REMOVE — DUPLICATE` | مبني بالفعل — يُشطب من التنفيذ |
| ⏸️ `DEFER` | مؤجَّل بقرار |
| ❓ `NEEDS KHALED CONFIRMATION` | قرار عمل/تعاقدي |
| 🔒 `BLOCKED BY PRODUCTION CONFIRMATION` | يتوقف على إثبات حالة Production |

**Evidence** = مسار ملف / مكوّن / migration / جدول / RPC / سياسة RLS / خدمة / علم / commit
/ ملاحظة إنتاج. «الميزة موجودة» **ليست دليلًا**.

---

## الجزء أ — الضوابط (Guardrails) G1–G12

هذه ليست بنودًا تُبنى، لكن **أربعة منها تتعارض مع واقع المستودع تعارضًا صلبًا**، وترك
التعارض بلا حسم يفسد كل موجة تالية.

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-G.1 | فروع `feat/wave-<n>-<slug>`، ولا مساس بـ`main` | تسمية مختلفة قائمة (`feature/*`, `hotfix/*`, `fix/*`) | `git branch` — 34 فرعًا | Low | 🔧 `VERIFY & EXTEND` | اعتماد التسمية الجديدة للجديد فقط؛ لا إعادة تسمية للقديم | منخفض |
| V2-G.2 | تغييرات المخطط = ملفات في **`supabase/migrations/`** مع قسم `-- ROLLBACK:` | **`supabase/migrations/` فارغ (0 ملف)**. العُرف الفعلي = `docs/*_RUNME.sql` (292 ملفًا) + `*_ROLLBACK.sql` منفصلة (24) | `ls supabase/migrations` · `ls docs/*.sql` | **High** | ❓ `NEEDS KHALED CONFIRMATION` | إمّا اعتماد عُرف `docs/*_RUNME.sql` القائم رسميًا في v2.1، أو ترحيل 292 ملفًا لنظام migrations — **قرار خالد** | 🔴 **عالٍ** — اتّباع G2 حرفيًا يُنشئ **نظام ترحيل ثانيًا موازيًا** لنظام قائم بـ292 ملفًا |
| V2-G.3 | تجميد الدفع حتى تأكيد بيئة Supabase منفصلة للـPreview | **`main` متطابق مع `origin/main`** ⇒ الدفع يحدث فعلًا. بيئة Preview المنفصلة **غير موجودة** | `git status --short --branch` · `.env.example` | Medium | ❓ `NEEDS KHALED CONFIRMATION` | حسم: هل التجميد ساري فعلًا؟ وهل أُنشئت بيئة Preview؟ | متوسط |
| V2-G.4 | كل جدول جديد بـRLS deny-by-default في نفس الـmigration | مطبَّق كعُرف: 258 `enable row level security` · 271 جدولًا بسياسات | grep على `docs/*.sql` | Exact Duplicate | ❌ `REMOVE — DUPLICATE` | يُنقل كقاعدة محمية لا كبند تنفيذي | — |
| V2-G.5 | لا service-role key في العميل؛ لا طباعة أسرار | `lib/server/supabaseAdmin.ts` خادمي فقط · `pgRedact()` ينقّح JWT/مفاتيح/بريد/UUID/URL · فحص أسرار موثَّق | `lib/portal/pgerror.ts` · `FINAL_PRODUCTION_READINESS_MATRIX.md` §5 | Exact Duplicate | ❌ `REMOVE — DUPLICATE` | يُنقل كقاعدة محمية | — |
| V2-G.6 | كل تغيير مرئي خلف علم في **`lib/flags.ts`**، افتراضيًا OFF | **`lib/flags.ts` غير موجود.** الأعلام موزّعة على **18 جدول `*_settings`** + **~20 متغير بيئة** | `ls lib/flags.ts` → مفقود · §6 من `EXISTING_CAPABILITIES.md` | **High** | 🔧 `VERIFY & EXTEND` | ❌ لا تُنشأ `lib/flags.ts` كمصدر ثالث. المطلوب **سجل أعلام موحّد** (Owner/Default/Activation/Rollback/Removal) يوثّق الاثنين القائمين | 🔴 عالٍ — إنشاء ملف أعلام ثالث = مصدر حقيقة موازٍ |
| V2-G.7 | **«no AI features; no WhatsApp sending/automation; no Zoho API calls»** + لا مدفوعات ولا نفاذ ولا مشغّل مراجعة دقيق الإطار | **الثلاثة الأولى مبنية ومشحونة بالكامل:** AI = `ai_*` (15 جدولًا) + `kian_ai_assistant_RUNME.sql` (2,214 سطرًا) + `/assistant` · WhatsApp = `whatsapp_*` (14 جدولًا) + `lib/whatsapp/*` + `/api/integrations/whatsapp/send` · Zoho = 7 مسارات API + 6 وحدات خدمة + cron يومي | `docs/kian_ai_assistant_RUNME.sql` · `docs/whatsapp_inbox_RUNME.sql` · `lib/server/zohoBooks*.ts` · `vercel.json` | **Exact Duplicate (تعارض عكسي)** | ❓ `NEEDS KHALED CONFIRMATION` | **G7 كما هي غير قابلة للتطبيق.** تُعاد صياغتها إلى «تجميد» لا «منع»: *لا تُضِف ولا تستبدل ولا تعطّل ولا تغيّر التكاملات القائمة (AI/WhatsApp/Zoho)؛ حافظ على مساراتها وأعلامها؛ أي توسعة تحتاج Brief منفصلًا معتمدًا* | 🔴 **الأعلى** — التطبيق الحرفي يعني تعطيل أو تجاهل ثلاثة أنظمة إنتاجية |
| V2-G.8 | **«no Vercel cron»** — الجدولة عبر n8n أو GitHub Actions | **3 مهام Vercel cron قائمة وتعمل:** `/api/cron/custody-alerts` 03:00 · `/api/cron/notify-email` 03:10 · `/api/cron/zoho-sync` 03:20 | `vercel.json` | **Exact Duplicate (تعارض عكسي)** | ❓ `NEEDS KHALED CONFIRMATION` | تُعاد الصياغة: *«لا cron **إضافي** — الثلاثة القائمة تبقى؛ أي جدولة جديدة تُطوى داخلها أو عبر n8n»* (سقف خطة Hobby) | 🔴 عالٍ — تطبيق حرفي يوقف تنبيهات العهدة والبريد ومزامنة Zoho |
| V2-G.9 | «Reality wins» — عند اختلاف المستودع عن الوصف: تكيّف بأقل تغيير وسجّل الانحراف | نفس مبدأ `MASTER_ORDER_FINAL.md` §ثانيًا | — | Exact Duplicate | ❌ `REMOVE — DUPLICATE` | يُنقل كقاعدة حاكمة — **وهو المبدأ الذي يحسم G2/G6/G7/G8 أعلاه** | — |
| V2-G.10 | RTL عربي أولًا + حالات فارغة مصمَّمة | عُرف قائم عبر البوابة | `lib/i18n.tsx` · 7 ملفات `error.tsx` | Medium | 🔧 `VERIFY & EXTEND` | يُدمج مع V2-7.9-A (تدقيق الحالات) | منخفض |
| V2-G.11 | POLISH لا redesign | — | — | None | 🆕 `KEEP — NEW` | يُنقل كقاعدة تصميم | — |
| V2-G.12 | ميزانية الاعتماديات — كل حزمة مبرَّرة | v2.0 نفسه يقترح 6 حزم غير مثبَّتة: `next-intl` · `@vercel/og` · `suncalc` · `@sentry/nextjs` · `playwright` · `expo` | `grep package.json` → **لا واحدة منها مثبَّتة** | None | 🆕 `KEEP — NEW` | تبرير كل حزمة في تقرير موجتها | منخفض |

---

## الجزء ب — WAVE 0 · السلامة والتحصين (21 متطلبًا)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-0.1-A | checkbox موافقة على نموذج التواصل الرئيسي | جملة موافقة **ضمنية** فقط | `components/Contact.tsx:234` | Low | 🆕 `KEEP — NEW` | checkbox إلزامي + رابط `/privacy-policy` | منخفض |
| V2-0.1-B | checkbox على `/quote-request` | لا شيء | `app/quote-request/page.tsx` | None | 🆕 `KEEP — NEW` | إضافة | منخفض |
| V2-0.1-C | checkbox على `/book-meeting` | لا شيء | `app/book-meeting/page.tsx` | None | 🆕 `KEEP — NEW` | إضافة | منخفض |
| V2-0.1-D | checkbox على `/upload-files` | لا شيء | `app/upload-files/page.tsx` | None | 🆕 `KEEP — NEW` | إضافة | منخفض |
| V2-0.1-E | checkbox على `/quick-access` | ⚠️ **`/quick-access` لا يحوي نموذجًا إطلاقًا** — صفحة روابط إلى الثلاثة الأخرى | `app/quick-access/page.tsx` (أسطر 10/16/22 = `href` فقط) | None | ❌ `REMOVE — DUPLICATE` | **يُشطب — مبني على مقدمة خاطئة.** لا نموذج ⇒ لا موافقة | — |
| V2-0.1-F | حفظ الموافقة + الطابع الزمني مع كل إرسال | `public_intake` قائم بلا عمودَي موافقة | `app/api/public/intake/route.ts` | Medium | 🔗 `MERGE INTO EXISTING` | عمودان (`consent_given`, `consent_at`) على `public_intake` — **Extension لا جدول** | منخفض |
| V2-0.1-G | نص التسمية العربي الحرفي + الربط بسياسة الخصوصية | `/privacy-policy` موجودة | `app/privacy-policy` | Low | 🆕 `KEEP — NEW` | النص كما في v2.0 §4 حرفيًا | — |
| V2-0.2-A | `docs/SECRETS_AUDIT.md` (المواقع والمخاطر فقط) | فحص أسرار سبق تنفيذه (لا JWT/`sk-`/`AKIA`/PEM) لكن **بلا مستند** | `FINAL_PRODUCTION_READINESS_MATRIX.md` §5 | Medium | 🔧 `VERIFY & EXTEND` | توثيق الفحص القائم في مستند + **رصد `SHEETS_ENDPOINT` المكتوب حرفيًا في `lib/submitForm.ts`** | متوسط |
| V2-0.2-B | يشمل سجل Git | لا أثر | — | None | 🆕 `KEEP — NEW` | فحص التاريخ | متوسط |
| V2-0.3-A | `docs/ENVIRONMENTS.md` | لا شيء | — | None | 🆕 `KEEP — NEW` | — | — |
| V2-0.3-B | تقسيم `.env.example` | ملف واحد بـ55 مفتاحًا | `.env.example` | Low | 🔧 `VERIFY & EXTEND` | تقسيم + **إضافة 13 متغيرًا يقرأها الكود وغائبة عنه** | منخفض |
| V2-0.3-C | `scripts/seed-preview.ts` | `scripts/` يحوي ملفًا واحدًا | `ls scripts` | None | 🆕 `KEEP — NEW` | — | — |
| V2-0.3-D | مشروع Supabase ثانٍ للـPreview + runbook | **غير موجود** — وهو شرط رفع تجميد G3 | — | None | 🆕 `KEEP — NEW` + ❓ | خطوات لوحة تحكم لخالد | 🔴 عالٍ — يحجب G3 |
| V2-0.4-A | `.github/workflows/db-backup.yml` | `.github/workflows/ci.yml` قائم — **لا نسخ احتياطي** | `ls .github/workflows` | Low | 🆕 `KEEP — NEW` | إضافة workflow ثانٍ | 🔴 عالٍ — لا نسخ احتياطي اليوم |
| V2-0.4-B | `docs/RESTORE_RUNBOOK.md` (RTO ≤ 60 دقيقة) | لا شيء | — | None | 🆕 `KEEP — NEW` | — | 🔴 عالٍ |
| V2-0.5-A | `@sentry/nextjs` مفعَّل فقط مع `SENTRY_DSN` | **صفر إشارة لـSentry** في المستودع | `grep -rl SENTRY` → لا شيء | None | 🆕 `KEEP — NEW` | — | متوسط |
| V2-0.5-B | `docs/OBSERVABILITY.md` | لا شيء | — | None | 🆕 `KEEP — NEW` | — | — |
| V2-0.5-C | مراقب uptime مجاني | لا شيء | — | None | 🆕 `KEEP — NEW` | — | — |
| V2-0.6-A | Rate limiting على مسارات POST | **مبني ومطبَّق على Production بدليل مؤرَّخ:** `lib/server/rateLimit.ts` + `public_rate_limits` + `rl_consume` (12/ساعة/IP · 6/ساعة/بريد · جسم ≤100KB) | `app/api/public/intake/route.ts` · `MANUAL_ACTIONS_QUEUE.md` (2026-07-27، `42501`) | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | يُستبدل ببند تدقيق تغطية: **أي مسارات POST عامة ما زالت بلا حدّ؟** | منخفض |
| V2-0.6-B | ترويسات أمان (HSTS, X-Frame-Options, Referrer-Policy, CSP report-only) | **مبنية وحيّة على Production:** `X-Content-Type-Options` · `X-Frame-Options` · `X-XSS-Protection` · `Referrer-Policy` · `Permissions-Policy` (بتعليل موثَّق لـ`geolocation=(self)`) · **CSP مُنفَّذة جزئيًا + النصف الآخر Report-Only** | `next.config.js:14-60` · `MANUAL_ACTIONS_QUEUE.md` («الترويسات الجديدة حيّة» 2026-07-27) | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | يبقى **بند واحد ضيّق:** `HSTS` غير موجود في القائمة + مسار nonce لإكمال CSP | متوسط |
| V2-0.7-A | `docs/EMAIL_DNS.md` (SPF/DKIM/DMARC) | لا مستند ولا فحص | — | None | 🆕 `KEEP — NEW` | — | 🔴 عالٍ — يفسّر جزءًا من فشل وصول البريد |

---

## الجزء ج — WAVE 1 · الموقع: أساس عالمي (34 متطلبًا)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-1.1-A | `next-intl` + توجيه `/en` | `lib/i18n.tsx` (54 سطرًا) — ترجمة **على مستوى المكوّن** بلا مسارات | `lib/i18n.tsx` · `grep package.json` (لا `next-intl`) | Medium | 🆕 `KEEP — NEW` | إضافة طبقة التوجيه | 🔴 عالٍ — يمسّ كل صفحة عامة |
| V2-1.1-B | `hreflang` | لا شيء | `app/layout.tsx` | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-1.1-C | metadata حسب اللغة | metadata واحدة ثابتة | `app/layout.tsx:9` | Low | 🔧 `VERIFY & EXTEND` | يُدمج مع V2-1.3-A | منخفض |
| V2-1.1-D | تكافؤ إنجليزي كامل لكل صفحة عامة | ⚠️ **النصوص الإنجليزية موجودة أصلًا** — كل مكوّن يستخدم `t({ ar, en })` | `components/{Hero,About,Services,Portfolio,Stats,Reviews,Contact,…}.tsx` | **High** | 🔗 `MERGE INTO EXISTING` | ❌ لا تُكتب نسخة EN من الصفر. المطلوب **حصر ما ينقصه `en`** ثم مراجعة خالد | متوسط — إعادة الكتابة تهدر عملًا قائمًا |
| V2-1.1-E | صحّة RTL/LTR | `isAr` مستخدَم في التنسيق (`insetInlineStart`, `scaleX(-1)`) | `components/Stats.tsx` · `Portfolio.tsx` | Medium | 🔧 `VERIFY & EXTEND` | فحص بعد إضافة `/en` | متوسط |
| V2-1.2-A | `content/stats.ts` مصدرًا واحدًا | مصفوفة `STATS` داخل المكوّن | `components/Stats.tsx:11-16` | High | 🔗 `MERGE INTO EXISTING` | نقل المصفوفة لملف محتوى — **لا مصدر ثانٍ** | منخفض |
| V2-1.2-B | الأرقام النهائية تُرسَم من الخادم | `Counter` يبدأ `useState(0)` ⇒ HTML الأولي `0+` | `components/Counter.tsx:5` | Low | 🆕 `KEEP — NEW` | القيمة النهائية في SSR والحركة تبدأ منها | منخفض |
| V2-1.2-C | رقم سنوات الخبرة | ثابت `20+` في الكود | `components/Stats.tsx:12` | — | ❓ `NEEDS KHALED CONFIRMATION` | الرقم الصحيح | — |
| V2-1.3-A | metadata + canonical لكل مسار (AR/EN) | `canonical` **ثابت** لكل المسارات؛ الاستثناء `/case-studies` و`[slug]` لديهما `generateMetadata` صحيح | `app/layout.tsx:44` · `app/case-studies/page.tsx:31` · `[slug]/page.tsx:46` | Medium | 🔧 `VERIFY & EXTEND` | **تعميم نمط `case-studies` القائم** على 8 مسارات — لا اختراع نمط | منخفض |
| V2-1.3-B | OG ديناميكي 1200×630 عبر `@vercel/og` | `/logo.png` مربّع 800×800 | `app/layout.tsx` · `ls public/logo.png` | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-1.4-A | نقل 46 عملًا إلى `content/portfolio.ts` | ⚠️ **`content/portfolio.ts` غير موجود.** المخزن الفعلي = `ITEMS` داخل `components/Portfolio.tsx` (46 عملًا — العدد مطابق) | `find . -name 'portfolio*'` · `grep -c '{ id:'` → 46 | High | 🔗 `MERGE INTO EXISTING` | نقل + **تصحيح اسم الملف في كل مستندات v2.1** | منخفض |
| V2-1.4-B | كتابة ~36 وصفًا فريدًا (مع الحفاظ على العشرة الحيّة) | **8 أعمال فقط تحمل `dAr`** ⇒ **38** بلا وصف فريد لا 36 | `grep -c 'dAr:'` → 8 | High | 🔧 `VERIFY & EXTEND` | **الرقم 38 لا 36.** والمحفوظ 8 لا 10 | منخفض |
| V2-1.4-C | إعادة تسمية الثلاثة «إعلان قصير» | 3 عناصر مؤكَّدة | `components/Portfolio.tsx:109,111,113` | — | ❓ `NEEDS KHALED CONFIRMATION` | أسماء العملاء الثلاثة | — |
| V2-1.4-D | اشتقاق عدّادات الفئات من البيانات (يقتل 54/46) | ⚠️ **المجموع الفعلي 56 لا 54**. والفجوة **بالتصميم**: العمل ينتمي لعدة فئات عمدًا | عدّ `cats: [...]` → 56 · تعليق `components/Portfolio.tsx:64-65` | Medium | 🔧 `VERIFY & EXTEND` + ❓ | ❌ الاشتقاق وحده **لا يزيل الفجوة** — 56 ستبقى 56. القرار: عرض كما هو / توضيح / منع العضوية المتعددة | متوسط — **بند v2.0 مبني على تشخيص ناقص** |
| V2-1.5-A | قسم الشهادات خلف علم `SHOW_TESTIMONIALS` | `Reviews.tsx` مركّب بحالة فارغة · `Testimonials.tsx` **كود ميت بـ3 شهادات وهمية** | `app/page.tsx:47` · `components/Testimonials.tsx` غير مستورد | High | 🔗 `MERGE INTO EXISTING` | العلم على `Reviews.tsx` + **حذف `Testimonials.tsx` إلزاميًا** | 🔴 عالٍ — إبقاء الملف = خطر نشر شهادات ملفَّقة |
| V2-1.5-B | يقرأ جدول Wave-4؛ ملف ثابت مؤقتًا | ⚠️ **النظام كامل ومكتوب على فرع غير مدموج:** `docs/kian_testimonials_v1_RUNME.sql` · `lib/portal/testimonials.ts` · `/share-experience` · `AdminTestimonials.tsx` · علم `testimonials_enabled` | فرع `feature/kian-operations-platform-v1` (6 commits) | **Exact Duplicate** | 🔗 `MERGE INTO EXISTING` | ❌ لا «ملف ثابت مؤقت» ولا جدول جديد في Wave 4 — **يُدمج الفرع القائم** | متوسط — الفرع بتاريخ 2026-07-15، يحتاج مراجعة توافق |
| V2-1.6-A | النموذج الرئيسي يرسل إلى `LEADS_WEBHOOK_URL` **قبل** فتح واتساب | `Contact.tsx` لا يحفظ شيئًا (`window.open(wa.me…)` فقط). البنية كاملة: `captureIntake` → `/api/public/intake` → `public_intake` | `components/Contact.tsx:30` · `lib/submitForm.ts` | Medium | 🔗 `MERGE INTO EXISTING` | ⚠️ **تعارض مع `MASTER_ORDER_FINAL.md` §G:** الأمر يوجب **Supabase أولًا ثم Webhook**. Rev.2 تحكم ⇒ يُستدعى `captureIntake` أولًا، والـwebhook بعده | 🔴 عالٍ — تطبيق v2.0 حرفيًا يجعل Apps Script قاعدة الـLeads |
| V2-1.6-B | غير حاجب عند الفشل + تسجيل في Sentry | `captureIntake` لا يرمي أبدًا ويعيد `IntakeResult` صادقًا | `lib/submitForm.ts` | High | ❌ `REMOVE — DUPLICATE` | الجزء الأول مبني؛ يبقى ربط Sentry (تابع V2-0.5-A) | منخفض |
| V2-1.6-C | توحيد التقاط Source/UTM عبر النماذج الأربعة | `public_intake` يقبل `source` نصيًا فقط — **لا حقول UTM**. و`/quote-request` يحوي «كيف تعرفت علينا» | `app/api/public/intake/route.ts` | Medium | 🔗 `MERGE INTO EXISTING` | أعمدة UTM كامتداد على `public_intake` | منخفض |
| V2-1.7-A | JSON-LD `LocalBusiness` | `ProfessionalService` + `Organization` قائمان | `app/layout.tsx` (`businessSchema`) | High | 🔧 `VERIFY & EXTEND` | مراجعة الحقول لا إعادة بناء | منخفض |
| V2-1.7-B | `VideoObject` لكل عمل | لا شيء | — | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-1.7-C | `BreadcrumbList` | موجود في صفحة دراسة الحالة | `app/case-studies/[slug]/page.tsx:104` | Medium | 🔧 `VERIFY & EXTEND` | تعميم النمط القائم | منخفض |
| V2-1.8-A | `sitemap.xml` | **موجود** ومشتق من `lib/site.ts` | `app/sitemap.ts` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | يبقى تحديثه بمسارات `/en` (تابع V2-1.1-A) | — |
| V2-1.8-B | `robots` | **موجود** | `app/robots.ts` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | — |
| V2-1.8-C | صفحتا 404/500 بهوية | `app/error.tsx` موجود (500) · **`not-found.tsx` غير موجود** | `find app -name 'not-found*'` → لا شيء | Low | 🔧 `VERIFY & EXTEND` | 404 جديدة فقط؛ 500 تحسين | منخفض |
| V2-1.9-A | `hero.mp4` → poster + نسخ مضغوطة + كسل تحت الطية | `public/hero.mp4` + `public/hero-poster.jpg` **موجودان** | `ls public` | Medium | 🔧 `VERIFY & EXTEND` | الضغط والنسخ المتعددة والكسل | متوسط |
| V2-1.9-B | `next/image` لكل المصغّرات مع سقوط `hqdefault` | مصغّرات YouTube من `yt` id | `components/Portfolio.tsx` | Low | 🆕 `KEEP — NEW` | — | منخفض |
| V2-1.9-C | تجزئة خط Almarai + `font-display: swap` | خطوط عبر متغيرات CSS | `app/globals.css` | Low | 🆕 `KEEP — NEW` | — | منخفض |
| V2-1.9-D | أهداف LCP<2.5s · CLS<0.1 · INP<200ms | لا قياس | — | None | 🆕 `KEEP — NEW` | قياس قبل/بعد | — |
| V2-1.10-A | تباين/تركيز/بدائل نصية/تنقل لوحة مفاتيح | جزئي | `components/*` | Low | 🆕 `KEEP — NEW` | تدقيق axe | متوسط |
| V2-1.10-B | `prefers-reduced-motion` | Framer Motion في كل مكان بلا احترام التفضيل | `components/*.tsx` | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-1.11-A | قالب + 6 صفحات خدمات | لا شيء | — | None | 🆕 `KEEP — NEW` | — | متوسط |
| V2-1.11-B | 3 صفحات مدن | لا شيء | — | None | 🆕 `KEEP — NEW` | — | متوسط |
| V2-1.11-C | AR+EN خلف `SHOW_SEO_PAGES` وخارج sitemap حتى التفعيل | — | — | None | 🆕 `KEEP — NEW` | — | منخفض |

---

## الجزء د — WAVE 2 · مصداقية الموقع (10 متطلبات)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-2.1-A | `content/case-studies/` + صفحة قالب | ⚠️ **منصة دراسات حالة كاملة قائمة:** 13 جدول `cs_*` · `case_studies_platform_RUNME.sql` (3,054 سطرًا) · `/case-studies` + `[slug]` بـ`generateMetadata` وJSON-LD وBreadcrumb · `CaseStudiesTeaser` في الرئيسية · `lib/server/publicCaseStudies.ts` · دورة تحرير واعتماد وسرّية موثَّقة | `docs/CASE_STUDIES_EDITORIAL_WORKFLOW.md` · `docs/CASE_STUDY_CONFIDENTIALITY_CONTRACT.md` · `tests/case_study_*.test.js` (7 ملفات) | **Exact Duplicate** | 🔗 `MERGE INTO EXISTING` | ❌ **لا `content/case-studies/`** — نظام ملفات موازٍ لقاعدة بيانات قائمة. المحتوى يُدخَل عبر المنصة | 🔴 **الأعلى في Wave 2** — بناء مولّد ثانٍ يخالف §M صراحةً |
| V2-2.1-B | بذر 6 دراسات رائدة (السادسة = ASK) | المنصة جاهزة، المحتوى فارغ | — | Low | ❓ `NEEDS KHALED CONFIRMATION` | إدخال محتوى لا بناء نظام | منخفض |
| V2-2.1-C | بطاقات الأعمال تربط «اقرأ القصة» | `CaseStudiesTeaser` قائم؛ لا ربط من بطاقة العمل | `components/Portfolio.tsx` | Low | 🔧 `VERIFY & EXTEND` | ربط `ITEMS` بـ`cs_case_studies` | منخفض |
| V2-2.2-A | شريط شعارات (22 PNG، رمادي→ملوّن) | ⚠️ **62 شعارًا** في `public/clients` + `components/Clients.tsx` قائم | `ls public/clients \| wc -l` → 62 | High | 🔧 `VERIFY & EXTEND` | **العدد 62 لا 22** — تحسين العرض لا بناؤه | منخفض |
| V2-2.2-B | تأكيد حق استخدام الشعارات | لا سجل موافقات | — | None | ❓ `NEEDS KHALED CONFIRMATION` | + `Publication Consent` (§M) | 🔴 عالٍ — قانوني |
| V2-2.3-A | صفحة `/trust` (RLS، تشفير، نسخ، سجل تدقيق، PDPL، CR، VAT، HSE) | لا شيء. ⚠️ **الادّعاءات يجب أن تكون صادقة:** «backups» غير موجودة اليوم (V2-0.4) و«audit log» مشتَّت على 15 مصدرًا | `docs/PROTECTED_ARCHITECTURE.md` P-12 | None | 🆕 `KEEP — NEW` | **مشروط بإنجاز Wave 0** — لا تُنشر ادّعاءات أمنية قبل تحققها | 🔴 عالٍ — ادّعاء كاذب في صفحة مشتريات |
| V2-2.3-B | AR/EN | تابع V2-1.1-A | — | — | 🔗 `MERGE INTO EXISTING` | — | — |
| V2-2.4-A | خانات صحافة/جوائز/مهرجانات على «لماذا كيان» | `components/WhyKian.tsx` قائم | `app/page.tsx:43` | Low | 🔧 `VERIFY & EXTEND` | إضافة أقسام | منخفض |
| V2-2.5-A | حسم `info@`/`sales@`/`contact@` | الفوتر `info@` فقط · صفحة التواصل `info@` **و**`sales@` | `components/Footer.tsx:46` · `Contact.tsx:154-155` | — | ❓ `NEEDS KHALED CONFIRMATION` | — | — |
| V2-2.5-B | توحيد NAP في كل الموقع | متضارب | نفس الدليل | Medium | 🆕 `KEEP — NEW` | بعد قرار V2-2.5-A | منخفض |

---

## الجزء هـ — WAVE 3 · البوابة: نواة التشغيل (23 متطلبًا)

> 🔴 **هذه أكثر موجة تصادمًا مع الواقع: 14 من 23 متطلبًا مبنية بالفعل.**

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-3.1-A | جدول `call_sheets` | ⚠️ **جدولان قائمان:** `ops_call_sheets` و`project_call_sheets` (ازدواج D-1) | `operations_center_RUNME.sql:546` · `project_core_OPERATIONAL_CLOSURE_FINAL_RUNME.sql:22` | **Exact Duplicate** | 🔗 `MERGE INTO EXISTING` | ❌ **لا جدول ثالث.** يُحسم أيهما المصدر أولًا (سؤال Gate A) | 🔴 **الأعلى** — إضافة ثالث يجعل الازدواج ثلاثيًا |
| V2-3.1-B | `call_sheet_crew` | `ops_job_crew` قائم + `tvn_assignments` | `operations_center_RUNME.sql` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-3.1-C | `call_sheet_equipment` (ربط جداول المعدات) | `ops_job_equipment` قائم مع حارس تعارض | `operations_center_RUNME.sql:1113` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-3.1-D | الساعة الذهبية عبر `suncalc` | لا شيء (الحزمة غير مثبَّتة) | `grep package.json` | None | 🆕 `KEEP — NEW` | **امتداد** على `ops_call_sheets` | منخفض |
| V2-3.1-E | الطقس عبر Open-Meteo ≤48 ساعة | **`ops_job_weather` قائم** | `operations_center_RUNME.sql` | High | 🔧 `VERIFY & EXTEND` | تعبئة الجدول القائم من مزوّد | منخفض |
| V2-3.1-F | تحذير رياح لأيام الدرون | لا شيء | — | None | 🆕 `KEEP — NEW` | فوق `ops_job_weather` | منخفض |
| V2-3.1-G | عرض عربي قابل للطباعة | `prodops_call_sheet_publish` + `project_core_call_sheet_send*` قائمة | grep الدوال | Medium | 🔧 `VERIFY & EXTEND` | — | منخفض |
| V2-3.1-H | `backup_date` (تاريخ بديل) | لا شيء | — | None | 🆕 `KEEP — NEW` | عمود امتداد | منخفض |
| V2-3.2-A | جدول `permits` | `ops_job_permits` قائم **كابن لوظيفة** لا سجل عام | `operations_center_RUNME.sql:298` | High | 🔗 `MERGE INTO EXISTING` | Extension Table للتصاريح العامة مرتبطة بالقائم | متوسط |
| V2-3.2-B | `crew_documents` (نوع، انتهاء، ملف) | ⚠️ **`tvn_documents` + `tvn_document_types` قائمان**، ومنصة `vcc_*` (16 جدولًا) للامتثال والوثائق ومنح الوصول | `talent_vendor_network_RUNME.sql` · `vendor_compliance_center_RUNME.sql` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 عالٍ |
| V2-3.2-C | تنبيهات انتهاء 30/7 يومًا عبر خدمة الإشعارات القائمة | آلية التنبيهات قائمة (`custody-alerts` cron + `notify_emit_event`) · `vcc_grant_access_log` | `vercel.json` · `global_notifications_core_batch10_RUNME.sql:42` | High | 🔧 `VERIFY & EXTEND` | حدث جديد في الـOutbox القائم — **لا مجدول جديد** (سقف Hobby) | منخفض |
| V2-3.2-D | Bucket خاص + روابط موقَّعة + RLS | نمط قائم (rental evidence، `deliverable_assets`، `secure-document`) | `app/api/public/secure-document` · `docs/SECURE_DOCUMENT_GRANT_CONTRACT.md` | High | ❌ `REMOVE — DUPLICATE` | إعادة استخدام النمط | منخفض |
| V2-3.3-A | `crew_members (roles[], day_rate, …)` | ⚠️ **`tvn_profiles` + 13 جدولًا مرافقًا** = نظام المستقلين والموردين كاملًا، مع `tvn_profile_rates` و`tvn_profile_restricted` و`tvn_profile_bank` و`tvn_availability` و`tvn_reviews` | `talent_vendor_network_RUNME.sql` (2,358 سطرًا) · `tests/talent_*.test.js` (10) | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | ❌ **وأيضًا `roles[]` كمصفوفة ممنوع** — جدول ربط قائم | 🔴 **الأعلى** — يكرر الموظفين والمستقلين معًا |
| V2-3.3-B | `crew_assignments` (تواريخ، دور، أجر متفق) | **`tvn_assignments` + `tvn_assignment_candidates`** قائمان، والأجر في `tvn_profile_rates`/التكليف | `talent_vendor_network_RUNME.sql` · `docs/TALENT_ASSIGNMENT_RULES.md` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-3.3-C | كشف تعارض التداخل (تحذير UI حاجب) | ⚠️ **الحماية في القاعدة لا في الواجهة:** `23P01` بنطاقات `person:` / `equipment:` / `location:`، حارس على الجدول لا داخل RPC، وترجمة عربية في `pgerror.ts` | `operations_center_RUNME.sql:1078,1113,1143,1153` · `asset_intelligence_RUNME.sql:759,788,1978` · `lib/portal/pgerror.ts` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | ❌ **«تحذير UI» أضعف مما هو قائم** — القاعدة تمنع فعلًا | 🔴 عالٍ — استبدال منع بتحذير = تراجع أمني |
| V2-3.4-A | جدول `locations` | ⚠️ **ثلاثة قائمة:** `ops_locations` · `project_locations` · `custody_inventory_locations` (ازدواج D-3) | ثلاثة ملفات RUNME | **Exact Duplicate** | 🔗 `MERGE INTO EXISTING` | ❌ لا رابع. حسم المصدر أولًا | 🔴 |
| V2-3.4-B | `location_media` | لا شيء | — | Low | 🆕 `KEEP — NEW` | Extension على الجدول المعتمد | منخفض |
| V2-3.4-C | اختيارها من Call Sheet | `ops_call_sheets` ↔ `ops_locations` قائم | `operations_center_RUNME.sql` | High | ❌ `REMOVE — DUPLICATE` | — | منخفض |
| V2-3.5-A | `project_templates` + `template_tasks` | **`project_templates` + `project_template_versions` + `apply_template_v2` + حزمة 7A كاملة** | `project_templates_batch7a_RUNME.sql` · `lib/portal/projectTemplates.ts` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-3.5-B | بذور: فيلم مؤسسي، عرس | البذور جزء من 7A | `project_templates_batch7a_RUNME.sql` | High | 🔧 `VERIFY & EXTEND` | إضافة بذرتين لا نظامًا | منخفض |
| V2-3.5-C | **بودكاست ٢٥ حلقة (متتبّع حلقات)** | `parent_project_id` + `project_scope` + برامج 8A | `project_hierarchy_schema_RUNME.sql` · `project_programs_batch8a_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | ❌ **لا جدول حلقات مستقل** — الحلقة = مشروع فرعي/وحدة | 🔴 عالٍ (§E صريح) |
| V2-3.6-A | `calendar_tokens` | لا شيء | grep → لا نتيجة | None | 🆕 `KEEP — NEW` | نمط الرمز الملغى موجود في `liveops_client_links` — يُحتذى | منخفض |
| V2-3.6-B | `/api/calendar/[token].ics` | لا شيء | — | None | 🆕 `KEEP — NEW` | — | منخفض |

---

## الجزء و — WAVE 4 · CRM والأعمال (14 متطلبًا)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-4.1-A | جدول `tenders` | `crm_opportunities` + `crm_pipelines` + `crm_stages` + `crm_stage_history` + `crm_companies` | `crm_sales_FOUNDATION_RUNME.sql` (3,977 سطرًا) | **High** | 🔗 `MERGE INTO EXISTING` | المناقصة = **نوع فرصة أو مرحلة أو Extension Table** مرتبطة بـ`crm_opportunities` — ❌ لا تكرار بيانات الجهة | 🔴 عالٍ (§F) |
| V2-4.1-B | `rate_card_items` (رؤية داخلية فقط) | ⚠️ **`sq_price_books` + `sq_price_book_versions` + `sq_price_book_entries` + `sq_cost_rates` + `sq_service_catalog` + `sq_pricing_rules`** | `smart_quoting_RUNME.sql` (2,964 سطرًا) · `docs/SMART_QUOTING_PRICING_MODEL.md` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-4.1-C | لوحة (نسبة الفوز، القيمة، متوسط الهامش) | محرك تقارير CRM + `crm_targets` + حماية الهامش | `docs/CRM_ROLE_MATRIX.md` · `tests/crm_pipeline_forecast.test.js` · `tests/quoting_profit_guard.test.js` | High | 🔗 `MERGE INTO EXISTING` | تقرير في المحرك القائم | منخفض |
| V2-4.2-A | جدول `testimonials` | **مكتوب على فرع غير مدموج** | `feature/kian-operations-platform-v1` → `docs/kian_testimonials_v1_RUNME.sql` | **Exact Duplicate** | 🔗 `MERGE INTO EXISTING` | دمج الفرع بدل إنشاء الجدول | متوسط |
| V2-4.2-B | مُشغِّل: إغلاق المشروع + سداد الدفعة النهائية → نموذج مُرمَّز بالبريد | `project_closure_requests` + `final_close` · `fin_payment_milestones` · `fin_collections` · الـOutbox | `project_governance_batch5c_RUNME.sql` · `finance_profitability_RUNME.sql` | Medium | 🔧 `VERIFY & EXTEND` | تركيب الشرط على أحداث قائمة | متوسط |
| V2-4.2-C | واجهة اعتماد إدارية | `AdminTestimonials.tsx` على الفرع | نفس الفرع | **Exact Duplicate** | 🔗 `MERGE INTO EXISTING` | — | منخفض |
| V2-4.2-D | المعتمَد يغذّي قسم Wave-1.5 تلقائيًا | نفس الفرع (`Reviews.tsx` معدَّل فيه) | نفس الفرع | High | 🔗 `MERGE INTO EXISTING` | ✅ مبدأ «Pipeline واحدة» صحيح ومطابق لـ§M | منخفض |
| V2-4.3-A | ملخص أسبوعي لكل مشروع نشط | `activity_log` + `notify_emit_event` + `comms_templates` | `global_notifications_core_batch10_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | حدث في الـOutbox القائم | منخفض |
| V2-4.3-B | جدولة عبر n8n (G8) | ⚠️ 3 مهام Vercel cron قائمة وتعمل | `vercel.json` | Medium | 🔧 `VERIFY & EXTEND` | يُطوى داخل `/api/cron/notify-email` القائم — ❌ لا مجدول رابع (سقف Hobby) | متوسط |
| V2-4.3-C | إلغاء اشتراك لكل عميل | `notification_preferences` + `comms_preferences` | `phase0_migration.sql:66` · `communications_hub_RUNME.sql` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | منخفض |
| V2-4.4-A | عرض `client_health` | `crm_companies` + `crm_activities` + `crm_stage_history` + محرك التقارير | `crm_sales_FOUNDATION_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | **عرض مشتق (view) لا جدول** | منخفض |
| V2-4.4-B | طابور `follow_ups` | `crm_activities` + نظام المهام (`project_tasks`) | `crm_sales_FOUNDATION_RUNME.sql` · `project_tasks_batch3a_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | ❌ لا طابور متابعات ثانٍ | متوسط |
| V2-4.4-C | قاعدة >180 يومًا؛ لا إرسال تلقائي | — | — | Low | 🆕 `KEEP — NEW` | قاعدة فوق العرض المشتق | منخفض |
| V2-4.5-A | لوحة موسمية (أيام التصوير × القطاع × السنوات) | `project_shoot_sessions` + محرك التقارير + `executive_kpi_snapshots` | `executive_reporting_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | تقرير جديد يستهلك المصادر | منخفض |

---

## الجزء ز — WAVE 5 · التسليم والحقوق والمال (18 متطلبًا)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-5.1-A | `deliverable_versions` (رقم، ملف، سجل تغيير عربي) | ⚠️ **جدولان قائمان (ازدواج D-4):** `deliverable_versions` و`project_deliverable_versions`، مع مُشغِّل إنشاء V1 تلقائيًا | `deliverable_versions_RUNME.sql:45` · `project_core_FINAL_RUNME.sql:287` · `deliverable_versions_autocreate_RUNME.sql` | **Exact Duplicate** | 🔧 `VERIFY & EXTEND` | ✅ v2.0 نفسه يقول «adapt to existing per G9» — **الصياغة الصحيحة**. أضِف: **حسم D-4 أولًا** | 🔴 عالٍ — ثالث يجعلها ثلاثة |
| V2-5.1-B | مؤشر «الحالي» | `deliverable_version_summary` + `deliverable_final_master_state` | grep الدوال | High | 🔧 `VERIFY & EXTEND` | — | منخفض |
| V2-5.2-A | `showreel_allowed` / `confidential` عند الاعتماد | `deliverable_internal` + سرّية دراسات الحالة (`cs_*`) | `docs/CASE_STUDY_CONFIDENTIALITY_CONTRACT.md` · `tests/deliverable_internal_isolation.test.js` | Medium | 🔗 `MERGE INTO EXISTING` | **عمودان امتداد** على `deliverables` — لا نظام حقوق جديد | منخفض |
| V2-5.2-B | عرض تصفية تسويقي | لا شيء | — | Low | 🆕 `KEEP — NEW` | فوق العمودين | منخفض |
| V2-5.3-A | `delivery_links` (رمز، انتهاء، عدّاد، إلغاء) | `project_delivery_release` + `deliverable_downloads` + `deliverable_final_opens` + سياسة الإتاحة + `pc_release_window_ok` + نمط الرمز الملغى في `liveops_client_links` | `project_delivery_release_policy_RUNME.sql` · `deliverable_delivery_audit_RUNME.sql` | **High** | 🔧 `VERIFY & EXTEND` | إكمال ما ينقص من الرباعية على النظام القائم | متوسط |
| V2-5.3-B | صفحة عامة بهوية كيان | معاينات موقَّعة قائمة (وبعضها على فرع `fix/portal-urgent-preview` غير مدموج) | `app/api/portal/deliverable-download` | Medium | 🔧 `VERIFY & EXTEND` | — | متوسط |
| V2-5.3-C | روابط موقَّعة + انتهاء + عدّاد | `deliverable_downloads` + `client_download_deliverable` | grep | High | ❌ `REMOVE — DUPLICATE` | تدقيق تغطية | منخفض |
| V2-5.3-D | ملاحظة سياسة الأرشفة | لا شيء | — | None | 🆕 `KEEP — NEW` | نص فقط | — |
| V2-5.4-A | مؤقّت الموافقة الحكمية (تذكير يوم 7، حكمية يوم 10) | لا شيء | — | None | ❓ `NEEDS KHALED CONFIRMATION` | 🔒 **الراية OFF.** لا يُفترض أساس تعاقدي قبل تحديد **نسخة العقد الموقّعة ونص البند لكل مشروع** — عقد بناء لا يُطبَّق تلقائيًا على «مسبار ١٠» | 🔴 **الأعلى قانونيًا** |
| V2-5.4-B | قيد تدقيق غير قابل للتغيير يستشهد ببند العقد | `activity_log` + 14 سجلًا | §P-12 | Medium | 🔗 `MERGE INTO EXISTING` | مشروط بـV2-5.4-A | 🔴 |
| V2-5.4-C | علم OFF + تفعيل لكل مشروع (Bena أولًا — ASK) | — | — | — | ❓ `NEEDS KHALED CONFIRMATION` | — | 🔴 |
| V2-5.5-A | `project_costs` | **`project_costs` قائم** + `fin_costs` + `project_expenses` (ازدواج D-5) | `project_core_*` · `finance_profitability_RUNME.sql` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 عالٍ (§H صريح) |
| V2-5.5-B | بطاقة هامش لكل مشروع | `pc_project_financials()` + حماية استنتاج الأرباح | `project_core_financials_phaseA_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | 🔒 مشروط بحسم Phase A/B | 🔴 |
| V2-5.5-C | `payment_milestones` (إن غابت) | **`fin_payment_milestones` قائم** | `finance_profitability_RUNME.sql` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | ✅ شرط v2.0 «if absent» صحيح — **والجواب: ليست غائبة** | 🔴 |
| V2-5.5-D | تقويم تدفق نقدي (داخل/خارج شهريًا) | `fin_receivables` · `fin_collections` · `fin_revenue` · `project_revenue_schedule` · `executive_delivery_forecast` | `finance_profitability_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | عرض يستهلك المصادر — ❌ لا يعيد الحساب | متوسط |
| V2-5.5-E | عدّاد التأخر في السداد | `fin_receivables` + `fin_collections` | نفس المصدر | Medium | 🔧 `VERIFY & EXTEND` | — | منخفض |
| V2-5.5-F | مسوّدة إشعار عربي رسمي بنقرة (الإرسال بشري) | لا شيء · `comms_templates` قائم | `communications_hub_RUNME.sql` | Low | 🔗 `MERGE INTO EXISTING` | قالب في النظام القائم — ✅ «الإرسال بشري» يُحفظ حرفيًا | متوسط |
| V2-5.6-A | `client_viewer` / `client_approver` في RLS | `project_members` + `project_member_roles` + **124 صلاحية ذرّية** + `emp_has_permission` | `permission_catalog_RUNME.sql` · `project_governance_batch5a_RUNME.sql` | **High** | 🔗 `MERGE INTO EXISTING` | **قدرات ضمن العضوية** — ❌ لا نموذج أدوار موازٍ. والاعتماد يُفرض في RLS/RPC لا UI | 🔴 عالٍ (§K) |

---

## الجزء ح — WAVE 6 · الأصول والأرشيف والامتثال (17 متطلبًا)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-6.1-A | QR قابل للطباعة → صفحة حالة `/e/[id]` | QR قائم داخليًا: `custody_qr_events` · `lib/qr/{qr,code128}.ts` · حمولة فقيرة معدَّلة مُدقَّقة | `asset_intelligence_RUNME.sql` · `docs/QR_SECURITY_CONTRACT.md` | High | 🔧 `VERIFY & EXTEND` | صفحة عامة **تخضع لعقد أمان QR** وتراعي صلاحية المشاهد — ❌ لا عرض أسعار/موظفين للعامة | 🔴 عالٍ — تسريب بيانات عهدة |
| V2-6.1-B | `equipment_usage_log` (تلقائي من Call Sheets) | ⚠️ **دفتر استخدام قائم ملحق بثلاثة مُشغِّلات** | `asset_intelligence_RUNME.sql:2139` · `tests/asset_usage_ledger_and_qr.test.js` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-6.1-C | `maintenance_schedule` + تنبيهات | **`custody_inventory_maintenance` + `custody_inventory_maintenance_plans`** + cron تنبيهات يومي | `portal_custody_inventory_system_v1_RUNME.sql` · `vercel.json` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-6.1-D | حقول سجل الأصول (شراء، قيمة، تسلسل، تأمين) | `custody_inventory_assets` + `depreciation_enabled` + `asset_insurance_policies` + `policy_assets` | `docs/ASSET_COSTING_CONTRACT.md` | High | 🔧 `VERIFY & EXTEND` | فحص ما ينقص فقط | منخفض |
| V2-6.2-A | `archive_media` (وسيط فيزيائي، سعة، صحة، موقع) | ⚠️ `project_archives` موجود لكنه **أرشيف إغلاق مشروع** لا سجل وسائط فيزيائية | `project_closure_batch6c_RUNME.sql` | Low | 🆕 `KEEP — NEW` | يُبرَّر: لا نظام يغطي الوسائط الفيزيائية | منخفض |
| V2-6.2-B | `archive_project_links` | — | — | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-6.3-A | `music_licenses` | لا شيء | grep → لا نتيجة | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-6.3-B | ملخص حقوق قابل للطباعة لكل مشروع | — | — | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-6.4-A | `hse_incidents` | **`ops_job_hse` قائم كابن لوظيفة** · و`ops_incidents` · `custody_incidents` | `operations_center_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | سجل HSE **امتداد** يجمع القائم — ❌ لا سجل حوادث رابع | متوسط |
| V2-6.5-A | `model_releases` (PDPL، bucket خاص، RLS صارمة) | لا شيء · النمط قائم | `docs/SECURE_DOCUMENT_GRANT_CONTRACT.md` | Low | 🆕 `KEEP — NEW` | يعيد استخدام نمط المستند الآمن | متوسط — بيانات شخصية |
| V2-6.6-A | `sops` + `sop_items` | لا شيء | grep | None | 🆕 `KEEP — NEW` | — | منخفض |
| V2-6.6-B | بذور: درون/بث/بودكاست | — | — | None | 🆕 `KEEP — NEW` | — | — |
| V2-6.6-C | إرفاقها بـCall Sheet كقوائم إلزامية | `project_task_checklists` قائم | `project_tasks_batch3b_RUNME.sql` | Medium | 🔗 `MERGE INTO EXISTING` | إعادة استخدام آلية القوائم | منخفض |
| V2-6.7-A | `project_postmortems` (٣ حقول عند الإغلاق) | ⚠️ **`project_post_reviews` + `project_lessons_learned` قائمان** ضمن دورة الإغلاق 5C | `project_governance_batch5c_RUNME.sql:209,241` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | — | 🔴 |
| V2-6.8-A | مولّد دراسات حالة بقالب (بلا AI) | منصة `cs_*` كاملة بدورة تحرير | `case_studies_platform_RUNME.sql` | High | 🔗 `MERGE INTO EXISTING` | ✅ «مولّد واحد» صحيح — لكن يُبنى **داخل** المنصة | 🔴 |
| V2-6.8-B | طابور `portfolio_drafts` | لا شيء | — | Low | 🆕 `KEEP — NEW` | داخل `cs_*` كحالة لا جدول منفصل إن أمكن | منخفض |
| V2-6.8-C | تصدير المعتمَد إلى `content/portfolio.ts` وصيغة دراسة الحالة | ⚠️ المخزن الفعلي `components/Portfolio.tsx` | §1.1 من `EXISTING_CAPABILITIES.md` | Medium | 🔧 `VERIFY & EXTEND` | 🔴 **قيد صلب:** ❌ ممنوع تعديل ملف المحتوى **وقت التشغيل على Vercel** — نظام الملفات للقراءة. المسار: Draft → موافقة → **Script أو Pull Request** → نشر باعتماد خالد | 🔴 **الأعلى** — الكتابة وقت التشغيل تُفقد عند أول نشر |

---

## الجزء ط — WAVE 7 · تجربة المستخدم والتلميع المؤسسي (10 متطلبات)

> 🔴 **7 من 10 مبنية بالفعل.**

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-7.1-A | بحث شامل Cmd+K عبر Postgres FTS | **لا `tsvector` ولا `to_tsquery` في أي RUNME** | grep على 292 ملفًا | None | 🆕 `KEEP — NEW` | ✅ «بلا خدمة خارجية» صحيح | متوسط |
| V2-7.2-A | مركز إشعارات (جرس + حالات قراءة) | **`/client-portal/notifications` قائم** + `notifications` + `notification_preferences` + `lib/portal/notifications.ts` | `app/client-portal/notifications` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | تدقيق تجربة لا بناء | منخفض |
| V2-7.3-A | عارض سجل التدقيق (تصفية بالمستخدم/الكيان/التاريخ) | ⚠️ `activity_log` **+ 14 جدول `*_audit`** — لا مصدر واحد | §P-12 من `PROTECTED_ARCHITECTURE.md` | Medium | ❓ `NEEDS KHALED CONFIRMATION` | **قرار مطلوب:** عارض قراءة فقط يقرأ الخمسة عشر، أم `activity_log` وحده؟ ❌ لا سجل سادس عشر | 🔴 عالٍ |
| V2-7.4-A | لوحة تنفيذية لخالد | **`/client-portal/executive` + `executive_reporting_RUNME.sql` (1,674) + `executive_kpi_catalog`/`_snapshots` + `executive_alert_rules` + `lib/portal/executive.ts`** | `docs/EXECUTIVE_REPORTING_CONTRACT.md` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | إضافة مؤشرات ناقصة فقط — ✅ «تستهلك ولا تضيف مصادر» مبدأ قائم بالفعل | منخفض |
| V2-7.5-A | تصدير CSV لكل وحدة | **`lib/portal/csv.ts` أداة موحّدة قائمة** (ترميز عربي، توقيت الرياض، إخفاء أعمدة بالدور) | `lib/portal/csv.ts` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | تدقيق تغطية الوحدات | منخفض |
| V2-7.6-A | MFA (TOTP) للأدوار الداخلية | **مبني ومُختبَر حيًا:** `mfa_settings` + `mfa_foundation_batch_s1` + `_assurance_s3` + `_write_gate_s4a/s4b` + `lib/portal/mfa.ts`. **M-010: دورة دخول المالك بخطوتين مؤكَّدة على الإنتاج** | `MANUAL_ACTIONS_QUEUE.md` M-009/M-010 | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | يبقى **إجراء لوحة تحكم واحد**: تفعيل TOTP في Supabase (M-008) | منخفض |
| V2-7.7-A | مستأجر تجريبي «شركة الأفق» + علم `DEMO_MODE` | ✅ **لا `DEMO_MODE` في المستودع** — الخطر غير قائم | grep → لا نتيجة | None | ❌ `REMOVE — DUPLICATE` (خطر محذوف) | 🔴 **يُشطب بوصفه خطرًا:** ❌ لا بيانات وهمية داخل Production. البديل = **بيئة Demo/Preview منفصلة** (V2-0.3-D) بنفس الكود وبلا أي مفاتيح أو بيانات إنتاج | 🔴 كان سيصبح عاليًا |
| V2-7.8-A | حزمة Playwright E2E | **239 ملف اختبار** بـ`node --test` تغطي منطق التصاريح والعقود — لكن **لا E2E متصفح** | `ls tests` · `package.json` | Medium | 🔧 `VERIFY & EXTEND` | طبقة E2E فوق القائم — ❌ لا استبدال | متوسط |
| V2-7.8-B | تشغيل CI على الـPRs (بناء/اختبار بلا نشر) | **`.github/workflows/ci.yml` قائم**: lint → typecheck → test → build على `push` و`pull_request`، + وظيفة `mobile` (typecheck + expo-doctor) | `.github/workflows/ci.yml` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | إضافة خطوة Playwright لاحقًا فقط | — |
| V2-7.9-A | تدقيق الحالات (فارغة/تحميل/خطأ) لكل مسار | 7 ملفات `error.tsx` + عُرف G10 | `find app -name 'error.tsx'` | Medium | 🔧 `VERIFY & EXTEND` | تدقيق تغطية | منخفض |

---

## الجزء ي — WAVE 8 · جاهزية الجوال (6 متطلبات)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-8.1-A | PWA: manifest، أيقونات، قوقعة قابلة للتثبيت | **مبنية:** `app/manifest.ts` · `public/sw.js` · `lib/pwa/{config,privateCache}.ts` · `components/pwa/PwaProvider` · `app/offline` · وسوم `apple-*` في `layout.tsx` · **4 اختبارات PWA** | `docs/PWA_V1_CONTRACT.md` · `tests/pwa_*.test.js` | **Exact Duplicate** | ❌ `REMOVE — DUPLICATE` | يبقى **اختبار حيّ على جهاز حقيقي** فقط | منخفض |
| V2-8.2-A | `docs/MOBILE_API.md` | لا مستند | — | None | 🆕 `KEEP — NEW` | ❌ لا Mobile API يعيد بناء المنطق — **facade آمن فوق RPCs القائمة** | متوسط |
| V2-8.2-B | إضافة RPCs الناقصة عبر migrations خلف أعلام | 1,662 دالة قائمة | §0 من `EXISTING_CAPABILITIES.md` | High | 🔧 `VERIFY & EXTEND` | حصر الناقص بعد V2-8.2-A | متوسط |
| V2-8.3-A | جدول `push_tokens` | لا شيء. `docs/PWA_PUSH_CONTRACT.md` يوثّق أن Push **أساس فقط بلا مستمع** | `tests/pwa_push_contract.test.js` | Low | 🆕 `KEEP — NEW` | — | منخفض |
| V2-8.3-B | مسار خادمي عبر Expo Push كقناة جديدة في الخدمة القائمة | خدمة الإشعارات + `comms_channels` قائمان | `communications_hub_RUNME.sql` | Medium | 🔗 `MERGE INTO EXISTING` | ✅ «قناة جديدة لا نظام» صحيح ومطابق لـ§J | منخفض |
| V2-8.4-A | روابط عميقة `kian://` متوافقة مع Supabase Auth | لا شيء | — | None | 🆕 `KEEP — NEW` | + Universal Links (iOS) وApp Links (Android) — أُضيفت في `MASTER_ORDER_FINAL.md` §Q | متوسط |

---

## الجزء ك — WAVE 9 · التطبيق الأصلي (9 متطلبات)

| ID | بند v2.0 | القدرة القائمة | الدليل | Overlap | القرار | التغيير المطلوب | الخطر |
|---|---|---|---|---|---|---|---|
| V2-9.1-A | هيكلة Expo في **مستودع جديد `kian-app`** | ⚠️ **`apps/mobile` قائم داخل هذا المستودع:** Expo SDK 51 · `expo-camera` · `expo-location` · `expo-secure-store` · `expo-image-manipulator` · React Navigation · 3 شاشات (`Home`/`Login`/`Scan`) · **وCI يفحصه** | `apps/mobile/package.json` · `.github/workflows/ci.yml` (وظيفة `mobile`) | **High** | 🔧 `VERIFY & EXTEND` + ❓ | 🔴 **تعارض:** v2.0 يقول «مستودع جديد». البديل: توسيع `apps/mobile` القائم. **قرار خالد** — لكن التخلي عنه يهدر عملًا و`ScanScreen` جاهزة | 🔴 عالٍ |
| V2-9.1-B | `expo-router` + i18n ar/en + RTL | Navigation عبر React Navigation لا expo-router | `apps/mobile/package.json` | Medium | 🔧 `VERIFY & EXTEND` | ترحيل أو إبقاء — يُبرَّر | متوسط |
| V2-9.1-C | ثيم العلامة (Almarai، داكن سينمائي) | — | — | Low | 🆕 `KEEP — NEW` | — | منخفض |
| V2-9.2-A | تجربة العميل (مشاريع، مخرجات + اعتماد، روابط، فواتير، إشعارات) | الشاشات الثلاث القائمة للطاقم لا للعميل | `apps/mobile/src/screens` | Low | 🆕 `KEEP — NEW` | فوق RPCs قائمة | متوسط |
| V2-9.2-B | تجربة الطاقم (Call Sheet اليوم، تقويم، **ماسح QR للعهدة**، تنبيهات التصاريح) | **`ScanScreen.tsx` + `expo-camera` قائمان** | `apps/mobile/src/screens/ScanScreen.tsx` | High | 🔧 `VERIFY & EXTEND` | إكمال لا بناء | متوسط |
| V2-9.3-A | Push موصول ببنية Wave-8 + روابط عميقة | تابع V2-8.3 / V2-8.4 | — | Low | 🆕 `KEEP — NEW` | — | متوسط |
| V2-9.4-A | ملفّات بناء EAS (dev/preview/prod) | `EAS_PROJECT_ID` مقروء في الكود · لا `eas.json` | `grep process.env.EAS_PROJECT_ID` | Low | 🔧 `VERIFY & EXTEND` | — | منخفض |
| V2-9.5-A | `docs/STORE_SUBMISSION.md` (Apple D-U-N-S، تسميات الخصوصية، ملاحظات المراجعة، Play) | لا شيء | — | None | 🆕 `KEEP — NEW` | 🔒 يُصاغ Apple 4.2 **تعزيزًا للقيمة الأصلية لا ضمانًا للقبول** | 🔴 عالٍ — مهل زمنية طويلة |
| V2-9.6-A | لا مدفوعات ولا محادثة ولا AI في v1 التطبيق | ⚠️ AI مبني في الويب (`ai_*`) — لكن استثناؤه من **التطبيق** متسق | `kian_ai_assistant_RUNME.sql` | Low | 🆕 `KEEP — NEW` | قيد لا بند | — |

---

## الجزء ل — §5 دفتر الازدواج في v2.0 نفسه (3 بنود)

| ID | بند v2.0 | التقييم | القرار |
|---|---|---|---|
| V2-D.1 | «محذوف كمُنجَز: العشرة أوصاف + الرقم الثاني» | ✅ صحيح جزئيًا — **الأوصاف الفريدة 8 لا 10** | 🔧 `VERIFY & EXTEND` — تصحيح العدد |
| V2-D.2 | «مدموج: الشهادات+حلقة المراجعة → Pipeline واحدة؛ المولّدان → نظام واحد؛ SEO فوق i18n؛ P&L يغذّي اللوحة» | ✅ **كل هذه القرارات صحيحة ومطابقة لـ§M/§L** — تُبقى نصًا في v2.1 | ❌ `REMOVE — DUPLICATE` (قرار مُتخذ، لا بند) |
| V2-D.3 | «مؤجَّل: مشغّل مراجعة دقيق الإطار (Stream vs Mux)، نفاذ، Zoho API، مدفوعات، WhatsApp automation، AI، مدوّنة» | ⚠️ **Zoho API وWhatsApp automation وAI ليست مؤجَّلة — هي مبنية وتعمل** | ⏸️ `DEFER` للأربعة الحقيقية (Stream/Mux · نفاذ · مدفوعات · مدوّنة) + ❓ لإعادة صياغة الثلاثة الأخرى (انظر V2-G.7) |

---

## ملخص التصنيفات

### حسب القرار

| القرار | العدد | النسبة |
|---|---|---|
| ❌ `REMOVE — DUPLICATE` | **38** | 21.8% |
| 🔗 `MERGE INTO EXISTING` | **35** | 20.1% |
| 🔧 `VERIFY & EXTEND` | **36** | 20.7% |
| 🆕 `KEEP — NEW` | **50** | 28.7% |
| ❓ `NEEDS KHALED CONFIRMATION` | **14** | 8.0% |
| ⏸️ `DEFER` | **1** | 0.6% |
| 🔒 `BLOCKED BY PRODUCTION CONFIRMATION` | **0** مستقلة (القيد مدمج داخل 6 بنود مالية/أمنية) | — |
| **المجموع** | **174** | 100% |

> **الخلاصة العددية:** **109 متطلبًا من 174 (62.6%)** يغطيها المستودع كليًا أو جزئيًا
> (`REMOVE` + `MERGE` + `VERIFY`). **50 فقط (28.7%) بناء جديد حقيقي.**

### حسب درجة التداخل

| Overlap Level | العدد |
|---|---|
| `Exact Duplicate` | **31** |
| `High` | **38** |
| `Medium` | **35** |
| `Low` | **29** |
| `None` | **41** |

### حسب الموجة — كم بقي فعلًا؟

| الموجة | متطلبات | مبنية/جزئية | **بناء جديد** | نسبة الجديد |
|---|---|---|---|---|
| Guardrails | 12 | 8 | 2 | 17% |
| Wave 0 | 21 | 5 | 15 | **71%** |
| Wave 1 | 34 | 16 | 18 | 53% |
| Wave 2 | 10 | 5 | 4 | 40% |
| Wave 3 | 23 | **16** | 7 | **30%** |
| Wave 4 | 14 | **13** | 1 | **7%** |
| Wave 5 | 18 | 13 | 2 | 11% |
| Wave 6 | 17 | 8 | 8 | 47% |
| Wave 7 | 10 | **9** | 1 | **10%** |
| Wave 8 | 6 | 3 | 3 | 50% |
| Wave 9 | 9 | 5 | 3 | 33% |

> **القراءة:** **Wave 0 هي الموجة الوحيدة التي تكاد تكون كلها بناءً جديدًا (71%)** — وهي
> بالضبط موجة السلامة (نسخ احتياطي، مراقبة، بيئة منفصلة، DNS بريد). أمّا **Waves 3/4/5/7
> فمبنية بنسبة 70–93%** ويجب أن تتحول من «تنفيذ» إلى «تحقق ودمج».

### أخطر 10 ازدواجات مُنعت

| # | لو نُفِّذ حرفيًا | العواقب |
|---|---|---|
| 1 | `crew_members` + `crew_assignments` (V2-3.3-A/B) | نظام طاقم ثالث موازٍ للموظفين ولـ`tvn_*` (14 جدولًا) |
| 2 | `call_sheets` جديد (V2-3.1-A) | Call Sheet **ثالث** فوق ازدواج D-1 القائم |
| 3 | `content/case-studies/` (V2-2.1-A) | نظام ملفات موازٍ لمنصة `cs_*` بـ3,054 سطرًا |
| 4 | `rate_card_items` (V2-4.1-B) | تسعير ثانٍ موازٍ لـ`sq_price_books` |
| 5 | `project_costs` + `payment_milestones` (V2-5.5-A/C) | مصدر مالي ثالث؛ يخالف §H صراحةً |
| 6 | `locations` جديد (V2-3.4-A) | موقع **رابع** |
| 7 | تعارض المواعيد كـ«تحذير UI» (V2-3.3-C) | **تراجع أمني** — استبدال منع في القاعدة (`23P01`) بتحذير قابل للتجاوز |
| 8 | `lib/flags.ts` (V2-G.6) | مصدر أعلام ثالث فوق 18 جدول إعدادات + 20 متغير بيئة |
| 9 | `equipment_usage_log` يدوي (V2-6.1-B) | يكسر الاشتقاق التلقائي من ثلاثة مُشغِّلات |
| 10 | `DEMO_MODE` في Production (V2-7.7-A) | بيانات وهمية بجانب بيانات عملاء حقيقية |

**+ الأخطر على الإطلاق (ليس ازدواجًا بل تعارضًا عكسيًا):** **G7 وG8** — تطبيقهما حرفيًا
يعني تعطيل أو تجاهل ثلاثة أنظمة إنتاجية (AI · WhatsApp · Zoho) وثلاث مهام cron حيّة.
