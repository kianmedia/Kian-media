# WAVE 5 · شرطا الدخول — D-4 والحالة المالية

> `MASTER_BRIEF_v2.1.md` §4 WAVE 5:
> «⛔ **شرطا دخول:** (1) حسم **D-4** (جدولا الإصدارات) · (2) إثبات حالة
> **Phase A/B** المالية — **بدونه لا يُلمس أي بند مالي**.»

**الأدلّة من المستودع وحده.** لا اتصال بـProduction.

---

## ٠. الخلاصة

| الشرط | الحالة |
|---|---|
| **D-4** — أيّ جدول إصدارات هو المصدر؟ | ✅ **محسوم**: `deliverable_versions` |
| **Phase A/B المالية** | 🔴 **غير قابل للإثبات من هنا** — يبقى حاجبًا |

⇒ **Wave 5 تبدأ جزئيًّا:** بنود التسليم والحقوق مفتوحة، وكلّ بند ماليّ
(V2-5.5-B/D/E/F) **يبقى محجوبًا** حتى يُثبت خالد الحالة على Production.

---

## ١. D-4 · جدولا الإصدارات

### الأدلّة

كلاهما ابن لـ**نفس الأب** `public.deliverables(id)` — فهما تاريخان لإصدارات
الشيء نفسه، وهذا ما يجعله ازدواجًا لا اختلاف مجال.

> 🔴 **تصحيح لهذه الوثيقة (أثناء بناء Wave 5).** الجدول القديم **تطوّر بعد
> إنشائه**: `project_core_ABSOLUTE_FINAL_RUNME.sql` و`project_editor_permissions_RUNME.sql`
> أضافا إليه ثمانية أعمدة — منها **`is_final` و`is_approved` و`approved_at`
> و`approved_by`**. فالمقارنة الأولى هنا (٧ أعمدة مقابل ٢١، وغياب `is_final`)
> **كانت خاطئة**، وقُرئت من الـDDL الأصلي وحده. الخلاصة لم تتغيّر، لكنّ سببها
> تغيّر — والأهمّ أنّ خطر «الكاتب النهائيّ المزدوج» صار **مؤكَّدًا لا محتملًا**.

| | `deliverable_versions` | `project_deliverable_versions` (بعد تطوّره) |
|---|---|---|
| الأعمدة | ٢١ | **١٥** |
| القرار (اعتماد/طلب تعديل) | 🟢 `decision` + `revision_reason` | 🟡 `is_approved` فقط — **بلا سبب رفض** |
| النسخة النهائية | 🟢 `is_final` + `is_current` | 🔴 **`is_final` أيضًا** ← مصدر الخطر |
| الاعتماد | 🟢 عبر `client_review_version` | 🟡 `approved_at`/`approved_by` بكاتب مستقلّ |
| العلامة المائية | 🟢 `watermark_required` | ❌ **لا يوجد** |
| نوع المعاينة | 🟢 `preview_type` مُقيَّد | ❌ لا يوجد |
| سلسلة الإصدارات | 🟢 `prev_version_id` | 🟡 `supersedes int` (رقم لا مرجع) |
| ربط التعليقات المعالَجة | 🟢 `addressed_comment_ids` | ❌ لا يوجد |
| الحذف الناعم | 🟢 `is_deleted`/`deleted_at`/`deleted_by` | ❌ **حذف نهائيّ فقط** |
| ملفّات SQL | **٢١** | ٩ |
| ملفّات التطبيق | **٣** | ١ (`projectCore.ts`) |
| مُشغِّل V1 التلقائيّ | 🟢 `dv_autocreate_v1` | ❌ لا يوجد |
| مراجعة العميل | 🟢 `client_review_version` | ❌ لا يوجد |
| بوّابة التنزيل | 🟢 `get_deliverable_download` | ❌ لا يوجد |

### القرار: 🟢 `deliverable_versions` هو المصدر

الجدولان **متداخلان لا متطابقان**: لكلٍّ منهما مفهوم «نهائيّ» و«معتمَد» خاصّ به،
والأوّل يملك ما لا يملكه الثاني إطلاقًا.

وثلاثة أسباب تجعل اعتماد الآخر خطأً لا تفضيلًا:

1. **دورة المراجعة والتسليم كلّها في الأوّل.** `client_review_version` ·
   `get_deliverable_download` · `dv_autocreate_v1` · `deliverable_version_summary`.
   والجدول الآخر يعرف أنّ إصدارًا «معتمَد» لكنّه لا يعرف **لماذا رُفض** سابقًا
   (`revision_reason` غائب) ولا **أيّ تعليقات عولجت**.
2. **العلامة المائية والحذف الناعم غائبان تمامًا.** اعتماد الجدول الآخر يعني
   معاينات بلا `watermark_required`، وحذفًا **نهائيًّا** لإصدار قد يكون محلّ
   نزاع — بلا إمكان استرجاع.
3. **🔒 والـBrief يوجب حفظ كلّ الإصدارات والتعليقات والاعتمادات السابقة**
   (V2-5.1-A/B). وهي لا توجد إلّا في `deliverable_versions`.

### المصير: تجميد لا حذف

| | `project_deliverable_versions` |
|---|---|
| يعمل؟ | ✅ نعم بلا تغيير |
| يُقرأ؟ | ✅ نعم — `projectCore.ts` يستمرّ |
| يُوسَّع؟ | ❌ **لا** — كلّ بناء Wave 5 على `deliverable_versions` |
| يُحذف أو يُرحَّل؟ | ⏸️ **لا يُقرَّر هنا** |

### 🔴 خطر مؤكَّد: كاتبان نهائيّان مستقلّان

**كلا الجدولين يحمل `is_final`، ولكلٍّ كاتبه الحيّ:**

| الجدول | من يضبط `is_final` |
|---|---|
| `deliverable_versions` | `admin_set_final_version` · `admin_set_version_final_master` |
| `project_deliverable_versions` | `project_core_ABSOLUTE_FINAL_RUNME.sql:1763` · `project_editor_permissions_RUNME.sql` |

⇒ يمكن أن يوجد **إصداران نهائيّان مختلفان للمخرَج نفسه**، كلٌّ في جدوله، بلا أيّ
ما يمنع ذلك اليوم. وأيّ قراءة «هل لهذا المخرَج نسخة نهائية؟» تُعطي جوابًا يعتمد
على الجدول الذي سُئل.

**ولهذا فإنّ حارس الكتابة (§4 من أمر التشغيل) ليس احتياطًا بل إغلاق ثغرة قائمة**،
والتدقيق القرائيّ يفحص `conflicting final versions` صراحةً.

**قرار معلَّق: W5-1 · PENDING ROW COUNT + OWNER DECISION.**

```sql
-- قراءة فقط. لا تُشغَّل من هنا.
select count(*) from public.project_deliverable_versions;
select count(*) from public.deliverable_versions where is_deleted = false;
```

- **صفر في الأوّل** ⇒ الازدواج ورقيّ، ويكفي التجميد.
- **صفوف موجودة** ⇒ ترحيل مقصود بحزمة مستقلّة وبقرار خالد. ⛔ **لا حذف قبله**،
  لأنّ الصفوف قد تكون إصدارات سلَّمت لعميل.

---

## ٢. الحالة المالية — 🔴 حاجب، ولا يمكن رفعه من هنا

### ما هو مطلوب إثباته

الملفّان قائمان في المستودع:
`docs/project_core_financials_phaseA_RUNME.sql` ·
`docs/project_core_financials_phaseB_lockdown_RUNME.sql`

**والسؤال «هل Phase B المالية مطبَّقة على Production؟» هو السؤال رقم ٦ في
GATE A من الـBrief نفسه — ولم يُجَب عليه.**

### لماذا لا يُحسم من المستودع

**وجود ملفّ `RUNME` لا يعني أنّه طُبِّق.** هذه قاعدة مثبَّتة في هذا البرنامج منذ
Phase A، ويؤكّدها `docs/DATABASE_APPLICATION_STATUS.md`: خمسة ملفّات فقط من ٢٩٢
تحمل دليل تطبيق مؤرَّخًا. فأيّ ادّعاء هنا بأنّ Phase B مطبَّقة أو غير مطبَّقة
سيكون تخمينًا يُبنى عليه عمل ماليّ.

### الأثر — ما يبقى محجوبًا

| البند | الحالة |
|---|---|
| V2-5.5-B بطاقة الهامش | 🔴 **محجوب** |
| V2-5.5-D تقويم التدفق النقدي | 🔴 **محجوب** |
| V2-5.5-E عدّاد التأخر | 🔴 **محجوب** |
| V2-5.5-F مسوّدة الإشعار الرسميّ | 🔴 **محجوب** (يستهلك حالة السداد) |

الـBrief صريح: «**بدونه لا يُلمس أي بند مالي**». وبناؤها على افتراض أنّ Phase B
مطبَّقة يعني بطاقة هامش تقرأ دوالّ قد لا توجد — أو أسوأ: تعرض أرقامًا من مصدر
نصفيّ.

### كيف يُحسم بأمان (تنفيذ يدويّ، قراءة فقط)

```sql
-- ١) هل دوالّ Phase A موجودة؟
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname in ('pc_project_financials');

-- ٢) هل إحكام Phase B مطبَّق؟ (الأعمدة/السياسات التي يُنشئها الملفّ)
select tablename, policyname from pg_policies
 where schemaname = 'public' and tablename like 'fin_%'
 order by 1, 2;

-- ٣) بوّابة الاستنتاج المالي
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and proname = 'can_see_financials';
```

**قرار معلَّق: W5-2 · MANUAL PRODUCTION VERIFICATION.**

---

## ٣. ما فتحه هذا الحسم وما أبقاه مغلقًا

| البند | الحالة |
|---|---|
| V2-5.1-A/B إصدارات المخرجات | ✅ **مفتوح** — على `deliverable_versions`، مع حفظ كلّ ما سبق |
| V2-5.2-A/B `showreel_allowed` / `confidential` | ✅ **مفتوح** — عمودان امتداد على `deliverables` |
| V2-5.3-A…C رباعية رابط التسليم | ✅ **مفتوح** — إكمال ما ينقص فقط |
| V2-5.3-D ملاحظة سياسة الأرشفة | ✅ **مفتوح** — نصّ |
| V2-5.6-A قدرات `client_viewer`/`client_approver` | ✅ **مفتوح** — ضمن `project_members` |
| V2-5.4-A…C الموافقة الحكمية | 🔴 **محجوب بقرار خالد** — `NEEDS KHALED CONFIRMATION`، والراية OFF، ولكلّ مشروع على حدة |
| V2-5.5-B/D/E/F المالية | 🔴 **محجوب** حتى W5-2 |
| V2-5.5-A/C | ❌ **ملغيان** — `fin_costs`/`project_expenses`/`fin_payment_milestones` قائمة |

---

## ٤. قرارات تنتظر خالد

| # | القرار | التصنيف |
|---|---|---|
| **W5-1** | مصير صفوف `project_deliverable_versions` بعد اعتماد `deliverable_versions` | **PENDING ROW COUNT + OWNER DECISION** |
| **W5-2** | هل Phase A/B المالية مطبَّقة على Production؟ (سؤال GATE A رقم ٦) | **MANUAL PRODUCTION VERIFICATION** |
| **W5-3** | الموافقة الحكمية: نسخة العقد النهائية الموقّعة **ونصّ البند الحرفيّ لكلّ مشروع**. ⛔ لا يُفترض ثبوت الأساس التعاقديّ، ولا يُطبَّق عقد بناء على «مسبار ١٠» | **BLOCKING ONE FEATURE ONLY** |
