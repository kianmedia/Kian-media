# RELEASE_SQL_MANIFEST — كل حزمة SQL تنتظر التطبيق اليدويّ

> **الحالة العامّة لكلّ ما في هذا الملفّ:**
> **MANUAL APPLICATION REQUIRED · RELEASE VERIFICATION PENDING**
>
> ⛔ **لم يُشغَّل أيّ ملفّ هنا.** لا اتصال بـProduction تمّ، ولا أمر SQL نُفِّذ.
> أيّ عبارة في هذا المستودع توحي بأنّ حزمة «مطبَّقة» لا تخصّ هذه الملفّات.

الفرع: `integration/v2-1-overnight`.

---

## ٠. كيف تُقرأ هذه الوثيقة

كل حزمة تتبع العقد نفسه:

| الملفّ | يفعل | آمن على Production؟ |
|---|---|---|
| `*_PREFLIGHT.sql` | يقرأ ويثبت الافتراضات | ✅ **نعم** — قراءة فقط |
| `*_RUNME.sql` | يطبّق التغيير في معاملة واحدة | ⚠️ يكتب |
| `*_POSTCHECK.sql` | يتحقّق سطرًا سطرًا | ✅ **نعم** — قراءة فقط |
| `*_ROLLBACK.sql` | يتراجع | ⚠️ يكتب |

**الترتيب الإلزاميّ لكلّ حزمة:** PREFLIGHT ← اقرأ المخرجات ← RUNME ← POSTCHECK.
أيّ 🔴 في PREFLIGHT **يوقف** التطبيق.

---

## ١. ترتيب التطبيق

الحزمتان **مستقلّتان تمامًا** — لا تعتمد إحداهما على الأخرى، ويجوز تطبيق
أيّهما وحدها أو تركهما معًا.

| # | الحزمة | Wave | مستقلّة؟ |
|---|---|---|---|
| 1 | `wave3_production_ops_*` | 3 | ✅ نعم |
| 2 | `wave3_calendar_tokens_*` | 3 | ✅ نعم |
| 3 | `wave3_permits_media_*` | 3 | ✅ نعم |
| — | `wave3_seeds_DEV_ONLY.sql` | 3 | ⛔ **ليست خطوة إصدار** — بذور تطوير محروسة |
| 4 | `kian_testimonials_v1_RUNME.sql` | 4 | ✅ نعم |
| 5 | `wave4_crm_business_*` | 4 | 🔴 **لا** — تعتمد `kian_testimonials` (٤ قبلها) |
| — | `consent_capture_EXTENSION_*` | 0 | ✅ نعم — **سابقة، ولم تُطبَّق بعد** |

⚠️ الحزمتان تفترضان أنّ `operations_center_RUNME.sql` **مطبَّق مسبقًا** على
Production. كلتاهما تتحقّق من ذلك في §0 وترفع استثناءً واضحًا إن لم يكن.
هذا الافتراض **غير مُتحقَّق منه** من هنا — PREFLIGHT هو ما يثبته.

---

## ٢. حزمة ١ — `wave3_production_ops_*`

| البند | القيمة |
|---|---|
| **Wave** | 3 · V2-3.1-E · V2-3.1-F · V2-3.1-H |
| **الغرض** | تعبئة الطقس من Open-Meteo · الهبّات · علم يوم الدرون · التاريخ البديل |
| **الاعتماديات** | `ops_call_sheets` · `ops_job_weather` · `ops_jobs` · `prodops_can_manage()` |
| **PREFLIGHT** | `docs/wave3_production_ops_PREFLIGHT.sql` |
| **RUNME** | `docs/wave3_production_ops_RUNME.sql` |
| **POSTCHECK** | `docs/wave3_production_ops_POSTCHECK.sql` |
| **ROLLBACK** | `docs/wave3_production_ops_ROLLBACK.sql` |
| **العلم المرتبط** | `NEXT_PUBLIC_SHOW_OPS_SUN_WEATHER` (OFF) |
| **مستقلّة؟** | ✅ نعم |
| **تحتاج نسخة احتياطية؟** | 🟡 **مستحسنة لا إلزامية** — إضافية بالكامل، ولا حذف صفوف ولا أعمدة |

### ما تفعله
- `ops_call_sheets`: `+ backup_date` · `+ is_drone_day`
- `ops_job_weather`: `+ wind_gust_kph` · `+ fetched_at` · `+ for_lat` · `+ for_lng`
- توسيع قيد `source` ليقبل `'open_meteo'`
- فهرس `(job_id, for_date desc)`
- دالّة واحدة: `prodops_weather_record(...)`

### مخاطر التطبيق
| الخطر | التقييم |
|---|---|
| استبدال قيد `source` | 🟡 **منخفض ومحسوب** — الإسقاط والإضافة داخل معاملة واحدة، فلا نافذة يُقبل فيها أيّ نصّ |
| `backup_date` بقيد `not valid` | 🟢 مقصود: يُطبَّق على الجديد ولا يُسقط صفًّا قائمًا مخالفًا |
| `is_drone_day not null default false` | 🟢 قفل قصير على جدول صغير |
| منح صلاحية جديدة | 🟢 `authenticated` فقط، مع `revoke` صريح عن `public, anon` |

### شروط التوقف
- 🔴 PREFLIGHT §1 يقول إنّ `ops_call_sheets` أو `ops_job_weather` مفقود.
- 🔴 PREFLIGHT §3 يُظهر قيد `source` بصيغة تختلف جوهريًّا عمّا يفترضه RUNME.
- 🔴 POSTCHECK يقول «صلاحية مسرَّبة» لـ`anon`.

---

## ٣. حزمة ٢ — `wave3_calendar_tokens_*` 🔴 **الأعلى خطرًا**

| البند | القيمة |
|---|---|
| **Wave** | 3 · V2-3.6-A/B |
| **الغرض** | روابط تقويم (ICS) برموز طويلة قابلة للإلغاء لأيام التصوير |
| **الاعتماديات** | `ops_jobs` · `ops_job_crew` · `ops_locations` · **`pgcrypto`** · `prodops_can_view/manage()` |
| **PREFLIGHT** | `docs/wave3_calendar_tokens_PREFLIGHT.sql` |
| **RUNME** | `docs/wave3_calendar_tokens_RUNME.sql` |
| **POSTCHECK** | `docs/wave3_calendar_tokens_POSTCHECK.sql` |
| **ROLLBACK** | `docs/wave3_calendar_tokens_ROLLBACK.sql` |
| **العلم المرتبط** | `NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED` (OFF) |
| **مستقلّة؟** | ✅ نعم |
| **تحتاج نسخة احتياطية؟** | 🟢 **لا** — جدول جديد فقط، ولا مساس بجدول قائم |

### 🔴 لماذا هي الأعلى خطرًا رغم أنّها لا تمسّ جدولًا قائمًا

**تمنح `anon` تنفيذ دالّة واحدة:** `prodops_calendar_feed(text)`.

وهذا بالضبط شكل حادثة سابقة في هذه القاعدة: مفتاح `anon` قرأ بيانات شركة حقيقية
بسبب انهيار NULL داخل بوّابة `SECURITY DEFINER` مع غياب `REVOKE`. الحزمة مكتوبة
ضدّ ذلك تحديدًا، وهذه هي نقاط التحقّق:

1. رفض صريح لـ`NULL` وللطول المخالف وللشكل المخالف **قبل** أيّ `SELECT`.
2. مطابقة تامّة على بصمة `^[0-9a-f]{64}$` — لا `LIKE` ولا `lower()`.
3. النطاق يُقيَّم على **`owner_user_id`** لا على `auth.uid()` (وهو `NULL` لقارئ مجهول).
4. `revoke all … from public` **قبل** `grant … to anon`.
5. `revoke all on public.ops_calendar_tokens from anon, public`.
6. المخرجات مُصفّاة: لا هواتف ولا أجور ولا عملاء ولا ملاحظات.

### مخاطر التطبيق
| الخطر | التقييم |
|---|---|
| **وصول `anon` لدالّة** | 🔴 **الأعلى.** POSTCHECK §«anon يملك prodops_calendar_feed فقط» **إلزاميّ** |
| غياب `pgcrypto` | 🟡 PREFLIGHT يكشفه؛ بدونه يفشل الإصدار |
| تسريب رابط | 🟡 مُحتوى: صلاحية محدودة زمنيًّا + سقف فتحات + إلغاء فوريّ + مخرجات مُصفّاة |

### شروط التوقف
- 🔴 PREFLIGHT يقول إنّ `pgcrypto` مفقود.
- 🔴 POSTCHECK يُظهر أنّ `anon` يملك أيّ دالّة غير `prodops_calendar_feed`.
- 🔴 POSTCHECK يُظهر صلاحية جدول لـ`anon`.
- 🔴 RLS غير مفعّل على `ops_calendar_tokens`.

### التراجع السريع
`ROLLBACK §1` **يسحب وصول `anon` في أوّل سطر** ثم يُسقط الدوالّ الثلاث. لا فقد
بيانات. §2 (إسقاط الجدول) معلَّق ويحتاج فعلًا واعيًا.

---

## ٣·١. حزمة ٣ — `wave3_permits_media_*`

| البند | القيمة |
|---|---|
| **Wave** | 3 · V2-3.2-A · V2-3.2-C · V2-3.4-B |
| **الغرض** | سجلّ التصاريح العامّ · وسائط التشغيل · تنبيهات ٣٠/٧ يومًا |
| **الاعتماديات** | `ops_jobs` · `ops_job_permits` · `ops_locations` · `prodops_can_view/manage()` · 🟡 `civ_alert_once` + `civ_notify_managers` (اختيارية — غيابها يجعل التنبيهات تُعلن `disabled` ولا تخترع مسارًا ثانيًا) |
| **PREFLIGHT / RUNME / POSTCHECK / ROLLBACK** | `docs/wave3_permits_media_*.sql` |
| **العلم المرتبط** | `NEXT_PUBLIC_SHOW_OPS_PERMITS_REGISTRY` (OFF) |
| **مستقلّة؟** | ✅ نعم |
| **تحتاج نسخة احتياطية؟** | 🟢 **لا** — جدولان جديدان + عمود واحد إضافيّ على جدول قائم |

### ما تفعله
- `ops_permits` 🆕 — السجلّ العامّ (تصريح له عمر مستقلّ عن أيّ مهمّة)
- `ops_media` 🆕 — وسائط المواقع **والتصاريح** بجدول واحد ومسار تخزين واحد
- `ops_job_permits.registry_permit_id` — ربط اختياريّ `on delete set null`
- ٧ دوالّ `prodops_*` — والتنبيهات لـ`service_role` وحده

### مخاطر التطبيق
| الخطر | التقييم |
|---|---|
| عمود على جدول قائم | 🟢 إضافيّ ونُلّي ولا يُرخّي قيدًا |
| كتابة على `ops_job_permits` | 🟢 لا شيء غير إضافة العمود — مُختبَر (P-2) |
| تنبيهات مكرَّرة | 🟢 مفتاح `civ_alert_once` يحمل `expires_at` لا تاريخ اليوم ⇒ لا تكرار يوميّ، والتجديد يبدأ دورة جديدة تلقائيًّا |
| منطقة زمنية | 🟢 `Asia/Riyadh` صريحة — لا اعتماد على منطقة الخادم |
| وسائط | 🟢 لا رابط مخزَّن؛ التوقيع عند الطلب لخمس دقائق، وبعد أن تُثبت القاعدة الصلاحية |

### شروط التوقف
- 🔴 PREFLIGHT §PARALLEL_CHECK يُظهر جدولًا موازيًا قائمًا (`permits` · `location_media` …).
- 🔴 POSTCHECK يُظهر أيّ صلاحية لـ`anon`.
- 🔴 POSTCHECK يُظهر أنّ محرّك التنبيهات ممنوح لغير `service_role`.
- 🟡 POSTCHECK يُظهر صفوفًا في الجدولين بعد التطبيق مباشرة (يجب أن يكونا فارغين).

---

## ٣·٢. حزم Wave 4

### `kian_testimonials_v1_RUNME.sql` (٤)

| البند | القيمة |
|---|---|
| **Wave** | 4 · V2-4.2-A/C/D |
| **الغرض** | جدول الشهادات + الاعتماد + القراءة العامّة |
| **المصدر** | مستخرَجة من `feature/kian-operations-platform-v1` (لم يُدمج الفرع) |
| **العلم** | `NEXT_PUBLIC_SHOW_TESTIMONIALS` (OFF) |
| **مستقلّة؟** | ✅ نعم |
| **نسخة احتياطية؟** | 🟢 لا — جدول جديد |
| 🔴 **تعديل مقصود** | أُضيف `and consent = true` إلى `kian_public_testimonials`. الاعتماد قرار داخليّ، والموافقة إذن العميل — نشرٌ باسم عميل لم يأذن كان ممكنًا قبله |
| ⚠️ **ناقصة** | لا PREFLIGHT/POSTCHECK/ROLLBACK لها (قادمة من فرع سابق). POSTCHECK حزمة ٥ يغطّي وجود جدولها |

### `wave4_crm_business_*` (٥) — 🔴 **تعتمد على ٤**

| البند | القيمة |
|---|---|
| **Wave** | 4 · V2-4.1-A/C · V2-4.2-B · V2-4.3-A · V2-4.4-A/C · V2-4.5-A |
| **الغرض** | امتداد المناقصة · دعوات الشهادة · عرض صحّة العميل · تقارير الفوز والموسمية والصمت · الملخّص الأسبوعي |
| **الاعتماديات** | `crm_opportunities` · `crm_companies` · `crm_activities` · **`kian_testimonials`** · `pgcrypto` · `crm_can_manage/read_opportunity/edit_opportunity` · 🟡 `can_see_financials` (غيابها ⇒ الهامش محجوب، وهو الافتراض الآمن) |
| **العلم** | `NEXT_PUBLIC_SHOW_CRM_WAVE4` (OFF) |
| **مستقلّة؟** | ❌ **لا** — `crm_testimonial_invites.testimonial_id` يشير إلى `kian_testimonials` |
| **نسخة احتياطية؟** | 🟢 لا — جدولان جديدان + عرض. ⛔ لا تعديل على جدول قائم |

**مخاطر التطبيق**

| الخطر | التقييم |
|---|---|
| وصول `anon` لدالّة واحدة (`crm_testimonial_invite_check`) | 🟡 أقلّ من حزمة رموز التقويم: تُعيد `{ok}` فقط بلا أيّ بيانات |
| عرض `crm_client_health_v` | 🟢 مشتقّ — لا يخزّن ولا يتقادم؛ إسقاطه بلا فقد بيانات |
| قراءة مالية | 🟢 **لا توجد** — أُزيلت عمدًا (تقرير Wave 4 §٣) |

**شروط التوقف**
- 🔴 PREFLIGHT §PARALLEL_CHECK يُظهر `tenders`/`client_health`/`follow_ups` قائمًا.
- 🔴 PREFLIGHT يُظهر `kian_testimonials` مفقودًا (طبّق ٤ أوّلًا).
- 🔴 POSTCHECK يُظهر أنّ `anon` يملك أكثر من `crm_testimonial_invite_check`.
- 🔴 POSTCHECK يُظهر صحّة العميل كجدول لا كعرض.

---

## ٣·٤. حزم Wave 6

### `wave6_assets_archive_*` (٨)

| البند | القيمة |
|---|---|
| **الغرض** | تغطية التأمين · أرشيف الوسائط الفيزيائية · تراخيص الموسيقى · إقرارات الظهور · ملخّص الحقوق |
| **الاعتماديات** | `custody_inventory_assets` · `asset_insurance_policies` · `projects` · `civ_can_view_assets()` · `can_manage_projects()` |
| **العلم** | `NEXT_PUBLIC_SHOW_WAVE6_REGISTERS` (OFF) |
| **مستقلّة؟** | ✅ نعم |
| **نسخة احتياطية؟** | 🟢 لا — ستّة جداول جديدة، ⛔ ولا تعديل على جدول قائم |

🔴 **الأحسّ فيها `model_releases`:** بيانات شخصية بحدّ PDPL الأدنى، ومستندها في
دلو خاصّ. **شرط تفعيل:** وجود الدلو الخاصّ (W6-3) قبل أيّ رفع.

### `wave6_compliance_knowledge_*` (٩)

| البند | القيمة |
|---|---|
| **الغرض** | سجلّ HSE موحَّد (**عرض**) · خطوات الإجراءات · إرفاقها بقوائم المهامّ |
| **الاعتماديات** | `ops_job_hse` · `ops_incidents` · `custody_incidents` · **`ai_knowledge_sources`** · `project_task_checklists` · `prodops_can_view()` |
| **العلم** | نفسه |
| **مستقلّة؟** | ✅ نعم |
| **نسخة احتياطية؟** | 🟢 لا — جدول واحد جديد + عرض |

⚠️ **شرط توقّف:** PREFLIGHT `SOP_TYPE_ALLOWED` يجب أن يعود ✅ — أي أنّ
`operations_procedure` مقبول في قيد `ai_sources_type_known`. وإلّا فشل إدراج أيّ
إجراء.

---

### `wave6_case_study_generator_*` (١٠) — تعتمد `cs_*`

| البند | القيمة |
|---|---|
| **الغرض** | مولّد مسوّدات · طابور كحالة · أثر التصدير |
| **الاعتماديات** | `cs_case_studies` · `cs_is_staff/is_admin` · `cs_slugify` — 🔴 **حزمة المنصّة يجب أن تكون مطبَّقة** |
| **العلم** | `NEXT_PUBLIC_SHOW_CASE_STUDY_DRAFTS` (OFF) |
| **مستقلّة؟** | ❌ **لا** — توسعة أعمدة على `cs_case_studies` |
| **نسخة احتياطية؟** | 🟢 لا — أعمدة إضافية فقط، ⛔ ولا جدول جديد |

🔴 **التصدير ليس في هذه الحزمة ولا يجوز أن يكون.** القاعدة **تسجّل** أنّ التصدير
حدث؛ التنفيذ سكربت تطوير/CI (`scripts/export-case-studies.mjs`) يرفض بيئة النشر
صراحةً — نظام ملفّات Vercel للقراءة، والكتابة تُفقد عند أوّل نشر.

**شرط توقّف:** PREFLIGHT `PARALLEL_CHECK` يُظهر `portfolio_drafts` قائمًا ⇒ توقّف.

---

## ٤. حزمة سابقة لم تُطبَّق — Wave 0

| الحزمة | الغرض | الحالة |
|---|---|---|
| `consent_capture_EXTENSION_{RUNME,POSTCHECK,ROLLBACK}` | التقاط الموافقة والإسناد على النماذج العامّة | **لم تُطبَّق** · العلم غير معتمد على تطبيقها (المسار يعمل بدونها) |

---

## ٥. ما ليس في هذا الملفّ

⛔ **لا حزمة لأيّ من:** جداول أوراق نداء جديدة · جداول مواقع جديدة ·
`crew_members` · `crew_assignments` · `crew_documents` · `project_templates`.
كلّها أُلغيت في [`WAVE_3_ENTRY_DUPLICATION_RESOLUTION.md`](../wave-reports/WAVE_3_ENTRY_DUPLICATION_RESOLUTION.md)
لأنّ أنظمتها قائمة.

⛔ **ولا حزمة تمسّ `project_call_sheets` أو `project_locations`** — مُجمَّدان
بقرار W3-1، ويعملان ويُقرآن كما هما.
