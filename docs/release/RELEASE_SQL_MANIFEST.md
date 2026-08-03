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
