# WAVE 2 — تقرير الموجة · مصداقية الموقع

> **الحالة:** ✅ **DEVELOPMENT COMPLETE** · ⏳ **RELEASE VERIFICATION PENDING**
> **الفرع:** `feat/wave-2-website-credibility` · **المرجع:** [`MASTER_BRIEF_v2.1.md`](../../MASTER_BRIEF_v2.1.md) §4 WAVE 2
> **التاريخ:** 2026-08-03
>
> ❌ لا Push · ❌ لا Merge إلى `main` · ❌ لا Deploy · ❌ **لم يُشغَّل أي SQL** ·
> ❌ لا اتصال بـProduction · ❌ لم تُمَسّ Zoho/WhatsApp/AI/n8n/Apps Script/cron ·
> ❌ لا حزمة جديدة · ❌ لا سرّ مطبوع · ❌ لم يُستخدم `kian-media-preview`.

---

## ١. نطاق Wave 2 ومعايير القبول

| ID | المعيار | الحالة | الدليل |
|---|---|---|---|
| **V2-2.1-A** | ❌ لا نظام ملفات موازٍ لدراسات الحالة | ✅ **PASS** | `content/case-studies/` **غير موجود** (اختبار يمنعه) · منصة `cs_*` و`/case-studies` كما هي |
| **V2-2.1-B** | بذر ٦ دراسات رائدة | ⏳ **PENDING** | قرار محتوى + الدراسة السادسة ❓ · المنصة جاهزة، والإدخال عبرها لا عبر ملفات |
| **V2-2.1-C** | ربط بطاقات الأعمال بـ«اقرأ القصة» | ⏳ **PENDING** | يحتاج ربط `WORKS.id ↔ cs_case_studies.slug`، **ولا دراسة منشورة اليوم** فالربط سيؤدي إلى لا شيء |
| **V2-2.2-A** | شريط الشعارات (رمادي→ملوّن) | ✅ **PASS** (مبني) | `components/ClientLogoStrip.tsx` · أبعاد ثابتة · `lazy` · بديل نصّي مشتق |
| **V2-2.2-B** | تأكيد حقوق استخدام الشعارات | ⏳ **PENDING** — **العلم مطفأ** | `NEXT_PUBLIC_SHOW_CLIENT_LOGOS=false` · **غير مركَّب في أي صفحة** (اختبار يمنع التركيب) |
| **V2-2.3-A** | صفحة `/trust` بلا ادّعاء غير متحقق | ✅ **PASS** | ٧ ادّعاءات حيّة تُعرض · ٣ مؤجَّلة **لا تُعرض** · مُثبَت على HTML المُولَّد · فحص طفري ٣/٣ |
| **V2-2.3-B** | `/trust` بالعربية والإنجليزية | ✅ **PASS** | `/trust` → `lang="ar"` · `/en/trust` → `lang="en"` · canonical + hreflang + x-default |
| **V2-2.4-A** | خانات صحافة/جوائز/مهرجانات | ✅ **PASS** (بنية) · ⏳ (محتوى) | `content/recognition.ts` **فارغ عمدًا** · العارض يعيد null فلا يظهر عنوان «جوائز» فارغ |
| **V2-2.5-A** | حسم `info@` / `sales@` / `contact@` | ⏳ **PENDING** | قرارك — المصدر الموحّد يحفظ الحالة الحالية حرفيًا |
| **V2-2.5-B** | توحيد NAP في كل الموقع | ✅ **PASS** | `content/nap.ts` · الفوتر + التواصل + `LocalBusiness` كلها تقرأ منه · اختبار يمنع أي رقم/بريد حرفي |

**الخلاصة:** ٦ **PASS** · ٤ **PENDING** — وكلها معلّقة على **قرار محتوى أو حقوق أو
بيانات لا يملكها المستودع**، لا على عمل برمجي متبقٍّ.

---

## ٢. الأنظمة القائمة التي وُسِّعت (لا موازية)

| القائم | ما فُعل به |
|---|---|
| منصة دراسات الحالة `cs_*` (١٣ جدولًا · ٣٬٠٥٤ سطرًا) | **لم تُمَسّ** — ورُفض إنشاء `content/case-studies/` |
| `lib/structuredData.ts` (Wave 1) | وُسِّع: `LocalBusiness` صار يقرأ من `content/nap.ts` |
| `lib/seo.ts` (Wave 1) | وُسِّع بمدخل `trust` ثنائي اللغة |
| `app/sitemap.ts` | وُسِّع بـ`/trust` بلغتيه |
| `components/Footer.tsx` · `Contact.tsx` | حُوِّلا إلى استهلاك `content/nap.ts` بدل قيم حرفية |
| `components/Clients.tsx` | **لم يُمَسّ** — بطاقات الأسماء كما هي والعلم مطفأ |

## ٣. أفكار أُلغيت لأنها تكرّر نظامًا قائمًا

| الفكرة | لماذا أُلغيت |
|---|---|
| `content/case-studies/` + صفحة قالب | منصة كاملة قائمة بدورة تحرير واعتماد وسرّية — نظام ملفات موازٍ يخالف G13-5 |
| مكوّن NAP جديد لكل صفحة | مصدر واحد + استهلاك، لا مكوّن ثانٍ |
| صفحة «شهاداتنا/اعتماداتنا» | لا شهادة ولا اعتماد في المستودع — إنشاؤها اختلاق |
| جدول/RPC جديد لصفحة الثقة | الصفحة محتوى ساكن — **صفر SQL في هذه الموجة** |

---

## ٤. الملفات

**جديدة:** `content/trust.ts` · `content/nap.ts` · `content/recognition.ts` ·
`components/TrustPage.tsx` · `components/ClientLogoStrip.tsx` ·
`app/(ar)/trust/page.tsx` · `app/(en)/en/trust/page.tsx` ·
`tests/wave2_credibility.test.js`

**معدَّلة:** `lib/structuredData.ts` · `lib/seo.ts` · `app/sitemap.ts` ·
`components/Footer.tsx` · `components/Contact.tsx` ·
`tests/wave1_seo_schema_a11y.test.js` · `tests/wave1_i18n_and_leads.test.js`

---

## ٥. الأعلام

| العلم | الافتراضي | الأثر وهو OFF |
|---|---|---|
| `NEXT_PUBLIC_SHOW_CLIENT_LOGOS` | 🔴 **OFF** (جديد) | لا شعار يُعرض · المكوّن **غير مركَّب أصلًا** |
| `NEXT_PUBLIC_SHOW_SEO_PAGES` | 🔴 OFF | كما هي |
| `NEXT_PUBLIC_SHOW_TESTIMONIALS` | 🔴 OFF | كما هي |
| `NEXT_PUBLIC_CONSENT_CHECKBOX_ENABLED` | 🔴 OFF | كما هي |

## ٦. ملفات SQL

**صفر ملف SQL جديد.** Wave 2 محتوى وواجهة فقط — لا تغيير مخطط، فلا حاجة.
المعلَّق من موجات سابقة كما هو: `consent_capture_EXTENSION` · `lead_attribution_utm_EXTENSION`
(**MANUAL APPLICATION REQUIRED** — لم تُشغَّلا).

---

## ٧. `RELEASE VERIFICATION PENDING`

| البند | لماذا |
|---|---|
| مظهر `/trust` في متصفّح حقيقي | تُحقِّق منه على HTML المُولَّد فقط — **لم يُفتح في متصفّح** |
| axe / Lighthouse | **لم يُشغَّلا** — الحالة `STATIC ACCESSIBILITY PASS` |
| صحة NAP مقابل السجلات الرسمية | س.ت والرقم الضريبي **من الـBrief**، لم يُتحقَّق منهما من مصدر حكومي |
| بذر دراسات الحالة | يحتاج إدخالًا عبر المنصة + قرارك |

---

## ٨. قرارات تنتظر خالد

| # | القرار | التصنيف |
|---|---|---|
| W2-1 | **حقوق استخدام ٦٢ شعار عميل** — العلم مطفأ حتى تأكيدك | 🟠 BLOCKING ONE FEATURE ONLY |
| W2-2 | **توحيد البريد** `info@` / `sales@` / `contact@` (V2-2.5-A) | 🟡 NON-BLOCKING CONTENT DECISION |
| W2-3 | **الدراسة الرائدة السادسة** + بذر الخمس الأخرى | 🟡 NON-BLOCKING CONTENT DECISION |
| W2-4 | **نصوص `/trust`** — تعهّدات تُقرأ من فرق مشتريات | 🔴 **PENDING KHALED CONTENT REVIEW** |
| W2-5 | جوائز/تغطية صحفية حقيقية لملء `content/recognition.ts` | 🟡 NON-BLOCKING |

---

## ٩. المخاطر

| # | الخطر | الحدّة |
|---|---|---|
| ١ | **نصوص `/trust` لم يراجعها بشر** وهي تعهّدات قانونية/تقنية | 🔴 **راجعها قبل النشر** |
| ٢ | س.ت والرقم الضريبي منقولان من الـBrief بلا تحقّق رسمي | 🟠 تأكّد منهما |
| ٣ | صفحة `/trust` **ستُفهرس فور النشر** (ليست خلف علم) | 🟠 مقصود — لكنه يعني أن (١) و(٢) يسبقان أي نشر |
| ٤ | تفعيل شريط الشعارات قبل تأكيد الحقوق | 🔴 محجوب بعلم مطفأ |

## ١٠. خطة التراجع

```bash
git revert --no-commit f240130          # تنفيذ Wave 2
# أو إسقاط الفرع كليًا:
git branch -D feat/wave-2-website-credibility
```
كل شيء محلي · **لا SQL شُغِّل** · لا شيء منشور · الأعلام الجديدة OFF.
إخفاء `/trust` وحدها: احذف مجلّدي `app/(ar)/trust` و`app/(en)/en/trust` + سطر
`/trust` من `app/sitemap.ts`.

---

## ١١. الفحوصات

| الفحص | قبل Wave 2 | بعدها | الحكم |
|---|---|---|---|
| `npm test` | 3825/3825 | **3839/3839** | ✅ +14، صفر فشل |
| `npm run typecheck` | exit 0 | **exit 0** | ✅ |
| `npm run lint` | 42 | **42** | ✅ **بلا تحذير جديد** (`<img>` المتعمَّد في شريط الشعارات مُعطَّل بتعليل) |
| `npm run build` | ناجح | **ناجح** | ✅ |

**لم يُضعَّف أي اختبار.** حارسان من Wave 1 عُدِّلا لأن السلوك تغيّر فعليًا:
مُحمِّل `structuredData` صار يحتاج `@/content/nap`، وحارس ترتيب «الحفظ قبل واتساب»
صار يثبّت **الترتيب** بدل نصّ `wa.me` الحرفي الذي انتقل إلى `waLink()` — وهو
أقوى لا أضعف.

**فحص طفري على حارس `/trust`:** قلب `backups` إلى `live` ⇒ فشل · عرض القائمة
كاملة ⇒ فشلان · إضافة ادّعاء ISO ⇒ فشلان. وبعد الاستعادة ١٤/١٤.

---

## ١٢. الـcommits

| Commit | الوصف |
|---|---|
| `f240130` | `/trust` + مصدر NAP الموحّد + شريط الشعارات خلف علم + خانة التقدير الفارغة |
