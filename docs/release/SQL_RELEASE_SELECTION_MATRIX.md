# SQL_RELEASE_SELECTION_MATRIX — أيّ ملفّ يُشغَّل، وأيّها لا

> 🔴 **لا يُشغَّل أيّ ملفّ من هذه الوثيقة.** التصنيف فقط.
> ⚠️ المستودع يحوي **٣٤١ ملفّ SQL**، منها **١٨٥** يحمل لاحقة `RUNME`.
> ⛔ **ولا يعني ذلك أنّ ١٨٥ ملفًّا ستُشغَّل** — الأغلبية الساحقة **مطبَّقة سلفًا**
> على الإنتاج من مراحل سابقة، ومنها ما هو متجاوَز أو تشخيصيّ أو بذور تطوير.

---

## ٠. 🔴 حدود هذه الوثيقة — اقرأها أوّلًا

**دُقّق يدويًّا:** ٤٢ ملفًّا — حزم موجات v2.1 (Wave 3 · 4 · 6 · 7 · 8) وحدها،
وهي **ما أنتجه هذا البرنامج** وما يُرشَّح فعلًا للتشغيل.

**لم يُدقّق يدويًّا:** ٢٩٩ ملفًّا سابقة لهذا البرنامج. صُنِّفت **آليًّا** بلاحقتها،
وكلّ ما لم تثبت طبيعته وُسم `NEEDS MANUAL REVIEW`.

⛔ **ولم أُصنّف شيئًا `DO NOT RUN` دون دليل**: الوسم يعني «أثبتُّ أنّه ضارّ»، ولا
أملك ذلك الإثبات لملفّ لم أقرأه. و«غير مدقّق» ≠ «آمن» و≠ «خطر».

**والحقيقة العملية المهمّة:** ذاكرة المشروع تُثبت أنّ **٧٦ جدولًا وRPCs أساسية
موجودة على الإنتاج فعلًا** — أي أنّ معظم `RUNME` القديمة **طُبِّقت**. فالفجوة
وظيفية لا نشرية. ⚠️ ومع ذلك **لم أتحقّق من الإنتاج** في هذه الجلسة (لا وصول).

---

## ١. حزم v2.1 — التصنيف الدقيق (٤٢ ملفًّا)

| الحزمة | Wave | RUNME | PREFLIGHT | POSTCHECK | ROLLBACK | التصنيف |
|---|---|---|---|---|---|---|
| `wave3_production_ops_*` | 3 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave3_calendar_tokens_*` | 3 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** 🔴 أعلى مخاطرة |
| `wave3_permits_media_*` | 3 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave3_seeds_DEV_ONLY.sql` | 3 | — | — | — | — | 🌱 **DEVELOPMENT SEED** ⛔ لا يُشغَّل على الإنتاج |
| `wave4_crm_business_*` | 4 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave6_assets_archive_*` | 6 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave6_compliance_knowledge_*` | 6 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave6_case_study_generator_*` | 6 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave6_sop_seeds_DEV_ONLY.sql` | 6 | — | — | — | — | 🌱 **DEVELOPMENT SEED** ⛔ |
| `wave7_global_search_*` | 7 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave7_audit_viewer_*` | 7 | ✅ | ✅ | ✅ | ✅ | **RUNME REQUIRED** |
| `wave8_push_tokens_*` | 8 | ✅ | ✅ | ✅ | ✅ | **RUNME OPTIONAL** — لا لزوم له قبل وجود تطبيق |
| `kian_testimonials_v1_RUNME.sql` | 1 | ✅ | — | — | — | **RUNME OPTIONAL** — مرتبط بعلم آراء العملاء |

**التصنيفات المستعملة للملفّات المرافقة:** كل `*_PREFLIGHT.sql` ⇒ **PREFLIGHT**،
وكل `*_POSTCHECK.sql` ⇒ **POSTCHECK**، وكل `*_ROLLBACK.sql` ⇒ **ROLLBACK**.
⛔ ولا يدخل أيّ منها ترتيب التشغيل (§٣).

---

## ٢. تفصيل كل **RUNME REQUIRED**

### ٢-١ · `wave3_production_ops_RUNME.sql`
- **الغرض:** ورقة النداء والمواقع وعمليات الإنتاج.
- 🔴 **تصحيح (مراجعة يدوية):** **ليس مستقلًّا.** الملفّ **لا يُنشئ** جدولًا واحدًا؛
  هو `ALTER` على `ops_call_sheets` و`ops_job_weather` القائمَين.
  **الشرط المسبق: `operations_center_RUNME.sql` مطبَّق** — والملفّ نفسه يفرضه
  بحارس صلب (`raise exception` يذكر الملفّ بالاسم)، فيفشل بصوت عالٍ لا بصمت.
- **الشرط المسبق:** `wave3_production_ops_PREFLIGHT.sql` بلا توقُّف.
- **العلم:** `NEXT_PUBLIC_SHOW_OPS_SUN_WEATHER`
- **تغييرات Schema:** جداول جديدة · **بيانات:** لا.
- **المخاطرة:** 🟡 متوسّطة (إضافيّ).
- **شرط التوقّف:** أيّ فشل في PREFLIGHT.
- **بعده:** `wave3_production_ops_POSTCHECK.sql` · **تراجع:** ROLLBACK المرافق.
- **تحقّق Production:** 🔴 مطلوب.

### ٢-٢ · `wave3_calendar_tokens_RUNME.sql` — 🔴 **الأعلى مخاطرة في الحزمة كلّها**
- **الغرض:** تغذية iCal برمز.
- **🔴 لماذا الأعلى:** يمنح `anon` صلاحية `EXECUTE` على `prodops_calendar_feed`.
  أي أنّ **الرمز وحده** يفصل بين الزائر ومحتوى التقويم — لا جلسة ولا RLS.
- **الاعتماد:** ⚠️ **مقترن** بـ٢-١ (يحتاج جداول العمليات).
- **العلم:** `NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED` — ⛔ يبقى **OFF** حتّى مراجعة أمنية.
- **المخاطرة:** 🔴 **عالية** — سطح عامّ.
- **شرط التوقّف:** أيّ التباس في نطاق ما يكشفه الرمز ⇒ **لا يُشغَّل**.
- **تحقّق Production:** 🔴 مطلوب **قبل** رفع العلم.

### ٢-٣ · `wave3_permits_media_RUNME.sql`
- **الغرض:** سجلّ التصاريح ووسائط التشغيل. **مقترن** بـ٢-١.
- **العلم:** `NEXT_PUBLIC_SHOW_OPS_PERMITS_REGISTRY` · **المخاطرة:** 🟡.

### ٢-٤ · `wave4_crm_business_RUNME.sql`
- **الغرض:** توسعة CRM. **مستقلّ** عن Wave 3.
- 🔴 **تصحيح:** هذا الملفّ **أيضًا** يمنح `anon` تنفيذًا — فسطح `anon` **اثنان**
  لا واحد، خلافًا لما قالته نسخة سابقة من هذه الوثيقة.
  الدالّة `crm_testimonial_invite_check(text)`.
- ⚠️ **وخطرها أقلّ كثيرًا من تغذية التقويم**، بعد قراءة جسمها:
  تتحقّق من طول الرمز وشكله **قبل** أيّ `SELECT`، وتُعيد `{ok:false}` **واحدة**
  لكلّ حالات الرفض (غير موجود · ملغى · مستعمل · منتهٍ) فلا تصير مُخبِرًا،
  و⛔ **لا تُعيد `project_id`** — الرمز يُثبت الحقّ ولا يكشف ما وراءه.
  بينما `prodops_calendar_feed` تُعيد **محتوى** التقويم.
- **العلم:** `NEXT_PUBLIC_SHOW_CRM_WAVE` · **المخاطرة:** 🟡.

### ٢-٥ · `wave6_assets_archive_RUNME.sql`
- **الغرض:** ربط تغطية التأمين بسجلّ الأصول + الأرشفة.
- **🔴 قرار مُعلَّق:** `RETENTION POLICY DECISION PENDING` — والحذف التلقائيّ
  **معطَّل** (`AUTO-DELETION DISABLED`)، والحجز القانونيّ يمنع الحذف.
- **المخاطرة:** 🟡 · **تحقّق:** 🔴 مطلوب.

### ٢-٦ · `wave6_compliance_knowledge_RUNME.sql`
- **الغرض:** الامتثال والمعرفة فوق `ai_knowledge_sources` القائم.
- **⚠️ البذور منفصلة** (`wave6_sop_seeds_DEV_ONLY.sql`) وتبقى **مسوّدات**
  بوسم `PENDING INTERNAL HSE REVIEW` — ⛔ ولا اسم معتمِد مُختلَق.

### ٢-٧ · `wave6_case_study_generator_RUNME.sql`
- **الغرض:** مولّد دراسات الحالة داخل `cs_*` القائم.
- 🔴 **تصحيح (مراجعة يدوية):** **ليس مستقلًّا.** `ALTER` على `cs_case_studies`.
  **الشرط المسبق: `case_studies_platform_RUNME.sql` مطبَّق** — وحارس صلب يفرضه.
- **العلم:** `NEXT_PUBLIC_SHOW_CASE_STUDY_DRAFTS` · **المخاطرة:** 🟢 منخفضة.

### ٢-٨ · `wave7_global_search_RUNME.sql`
- **الغرض:** بحث شامل على Postgres FTS — ⛔ بلا خدمة خارجية.
- **⚠️ يُنشئ فهارس GIN:** على جداول كبيرة قد يطول القفل.
- **العلم:** `NEXT_PUBLIC_SHOW_GLOBAL_SEARCH` · **المخاطرة:** 🟡 (وقت البناء).

### ٢-٩ · `wave7_audit_viewer_RUNME.sql`
- **الغرض:** عارض تدقيق **جزئيّ** فوق `activity_log` وحده.
- **🔴 قيد دائم:** يجب أن يبقى وسم `PARTIAL AUDIT VIEW — NOT A COMPLETE
  INVESTIGATION RECORD` ظاهرًا. ⛔ ولا يُوصف بأنّه سجلّ كامل.
- **العلم:** `NEXT_PUBLIC_SHOW_AUDIT_VIEWER` · **المخاطرة:** 🟢.

---

## ٣. PROPOSED PRODUCTION RUN ORDER

> ⛔ **RUNME REQUIRED فقط.** لا PREFLIGHT ولا POSTCHECK ولا ROLLBACK ولا بذور
> ولا تدقيقات ولا اختبارات ساكنة ولا ملفّات قديمة.
> ⚠️ ولكلّ خطوة: PREFLIGHT قبلها وPOSTCHECK بعدها — **خارج هذه القائمة**.

```
1. wave3_production_ops_RUNME.sql        ← يشترط operations_center_RUNME مطبَّقًا
2. wave3_permits_media_RUNME.sql         ← مقترن بـ1
3. wave3_calendar_tokens_RUNME.sql       ← مقترن بـ1 · 🔴 عالي المخاطرة · العلم يبقى OFF
4. crm_sales_FOUNDATION_RUNME.sql        ← 🆕 **prerequisite رسميّ لـ5** (بوّابات CRM)
5. wave4_crm_business_RUNME.sql          ← يشترط 4
6. wave6_assets_archive_RUNME.sql        ← مستقلّ
7. wave6_compliance_knowledge_RUNME.sql  ← مستقلّ
8. wave6_case_study_generator_RUNME.sql  ← يشترط case_studies_platform_RUNME
9. wave7_global_search_RUNME.sql         ← مستقلّ · ⚠️ فهارس GIN
10. wave7_audit_viewer_RUNME.sql         ← مستقلّ
```

🔴 **إضافة `crm_sales_FOUNDATION_RUNME.sql` (٤) ليست تفضيلًا:** الحزمة ٥ تستدعي
`crm_can_manage()` **سبع مرّات بلا حارس وجود**، فغيابها خطأ `42883` عند أوّل نداء.
والتفصيل الكامل في `WAVE_4_DEPENDENCY_MAP.md`.
⚠️ وجداول FOUNDATION موجودة على Preview بينما بُلِّغت بوّاباته مفقودة — **بفحص
معطوب** (`to_regproc` بتوقيع)، لا بنقص حقيقيّ. شغّل PREFLIGHT المصحَّح أوّلًا.

🔴 **تصحيح جوهريّ على الترتيب (من المراجعة اليدوية):** الخطوتان ١ و٧ **ليستا
مستقلّتين**. كلتاهما `ALTER` على منصّة قائمة، وتشترطان تطبيق
`operations_center_RUNME.sql` و`case_studies_platform_RUNME.sql` على التوالي.
⚠️ وكلتاهما تفشل **بحارس صلب يسمّي الملفّ المطلوب**، فلا خطر تطبيق أعمى — لكن
وصفهما بـ«مستقلّ» في نسخة سابقة من هذه الوثيقة **كان خطأً**.

**اختياريّة — ⛔ خارج الترتيب أعلاه:**
⚠️ `kian_testimonials_v1_RUNME.sql` **لا تحجب Wave 4**: القيد المرجعيّ صار
شرطيًّا. وتطبيقها **بعد** Wave 4 يستلزم إعادة تشغيل Wave 4 لإضافة القيد.

`wave8_push_tokens_RUNME.sql` (لا لزوم قبل تطبيق جوال) ·
`kian_testimonials_v1_RUNME.sql` (تابع لقرار محتوى).

🔴 **نسخة احتياطية كاملة قبل الخطوة ١، وتمرين استرجاع مُثبَت** — ⛔ ونسخةٌ لم
تُختبر استعادتها ليست نسخة.

---

## ٤. تصنيف بقيّة المستودع (٢٩٩ ملفًّا — آليّ)

| التصنيف | القاعدة | العدد **المقيس** |
|---|---|---|
| **PREFLIGHT** | `*_PREFLIGHT.sql` خارج حزم v2.1 | **٢٣** |
| **POSTCHECK** | `*_POSTCHECK.sql` خارج v2.1 | **٢٥** |
| **ROLLBACK** | `*_ROLLBACK.sql` خارج v2.1 | **٢٨** |
| **READ-ONLY AUDIT** | `*AUDIT*` · `*DIAGNOSTIC*` · `*VERIFY*` | **١٥** |
| **DEVELOPMENT SEED** | `*DEV_ONLY*` · `*seeds*` | **٢** (كلاهما داخل v2.1) |
| **LEGACY / SUPERSEDED** | له خَلَف أحدث موثَّق في `PLATFORM_STABILIZATION` | غير محصور |
| **NEEDS MANUAL REVIEW** | **كل ما تبقّى** — ولم أقرأه | **الأغلبية** |

⛔ **ولا يُشغَّل شيء من هذا القسم بناءً على هذه الوثيقة.**

---

## ٥. ما لا تدّعيه هذه الوثيقة

- ⛔ **لم أفحص ٣٤١ ملفًّا.** فحصت ٤٢، وقلت ذلك صراحةً.
- ⛔ **لم أتحقّق من حالة الإنتاج** — لا وصول، ولا يُطلَب.
- ⛔ **ولم يُشغَّل أيّ ملفّ.**
- ⚠️ ترتيب §٣ **مقترَح** مبنيّ على الاعتماديات المقروءة، لا مُختبَرًا على قاعدة.
