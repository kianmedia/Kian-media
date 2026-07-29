# MISBAR 10 — حالة Sprint منصة المشاريع الكبيرة

> **الحالة النهائية المستهدفة:**
> `PROJECT PLATFORM: CODE READY — PUSH/SQL/PRODUCTION ACCEPTANCE REQUIRED`
> `MISBAR 10: IMPORT PACKAGE READY — REAL PROJECT NOT CREATED`
>
> لا يُقال LIVE ولا COMPLETE قبل Push + SQL + اختبار الإنتاج بواسطة المالك.

---

## Batch 0 — نقطة الأمان · ✅ منجز

### حالة Git عند بدء الجلسة

| البند | القيمة |
|---|---|
| `HEAD` المحلي | `12902f8` |
| `origin/main` | `d3ede95` |
| Commits غير مرفوعة | **2** |
| Working Tree | **نظيف** — لا حاجة إلى Checkpoint Commit |

**غير المرفوع (بالترتيب الزمني، الأقدم أوّلًا):**

1. `fa92993` — docs(security): تسجيل تطبيق Fix A / s4pre / Fix B / Fix C على الإنتاج
2. `12902f8` — fix(authz): ربط step-up في ستّة call sites + إضافة Fix D

> ⚠️ **تصحيح لعدّ سابق.** أبلغتُ في نهاية جلسة الأمن أن **أربعة** commits تنتظر الدفع.
> الصحيح **اثنان**: `origin/main` عند `d3ede95`، أي أن `46fba2e` و`d3ede95` وصلا فعلًا.
> محاولة الدفع الأخيرة فشلت على المصادقة، لكن دفعة أسبق كانت قد نجحت.

**لم يُنفَّذ ولن يُنفَّذ في هذه الجلسة:** `reset` · `rebase` · `force push` · `checkout` مُتلِف ·
`amend`/`squash` لأيّ commit أمنيّ · **أيّ `push`**.

### حالة الأمن المجمَّدة (لا تُمَسّ في هذا Sprint)

**مطبَّق ومُتحقَّق على الإنتاج:** Fix A · s4pre · Fix B · Fix C
**غير مطبَّق:** Fix D · org_admin · S4a · S4b · أيّ Diagnostic/Cleanup/Rollback

مسارات مجمَّدة (الكود يبقى، ولا يُوسَّع): S4 · Fix D · org_admin · SMS MFA ·
MFA للموظفين والعملاء · CRM · المالية · Zoho · Apps Script · البريد.

---

## 🔴 Batch 1 — النتيجة الحاكمة: ملفّ Excel غير موجود

بحثتُ في المسار المطلوب وفي المستودع كلّه:

```
docs/input/MISBAR10_PLAN.xlsx        ← المجلّد docs/input/ غير موجود أصلًا
find . -iname "*.xlsx" -o -iname "*misbar*" -o -iname "*مسبار*"   ← صفر نتائج
```

**لا يوجد أيّ ملفّ Excel أو CSV لمسبار في المستودع.**

بحسب §2 من التكليف، هذا **لا يوقف العمل**. المُنفَّذ بدلًا منه:

- ✅ نظام استيراد عامّ كامل (XLSX + CSV) لا يعرف شيئًا عن مسبار
- ✅ قالب Excel/CSV جاهز للتعبئة
- ✅ Mapping profile خاصّ بمسبار **كبيانات، خارج قلب المنصة**
- ✅ Fixture اختباريّ **ببنية** مسبار (11 مرحلة) وبيانات **اصطناعية معلَّمة صراحةً**
- ⛔ **لم أخترع نصوص المخرجات الـ79.** العناوين والأوصاف ونصوص الـcaption
  الحقيقية موجودة في ملفّ المالك وحده. اختراعها كان سيُنتج Payload يبدو جاهزًا
  ويجب رميه كاملًا عند وصول الملفّ الحقيقي.

**الخطوة اليدوية المطلوبة:** ضَع الملفّ في `docs/input/MISBAR10_PLAN.xlsx` ثم شغّل
`npm run misbar:build-payload` (موصوف في حزمة Go-Live). العدد الفعلي للمراحل
والمخرجات يُقرأ من الملفّ، ولا يُجبَر على 11/79.

---

## 🔴 السقف البنيويّ المكتشَف — `public.deliverables`

الجدول الحيّ هو الجدول الأصليّ من `docs/phase0_migration.sql` ولم يتوسّع منذ ذلك الحين.
**كل أعمدته: 15 عمودًا.**

```
id · project_id · title · type · version · preview_url · vimeo_video_id
vimeo_review_url · watermark_required · allow_download · status · created_at
+ assignee_id (ALTER لاحق) · due_date (ALTER لاحق)
```

**ثلاث مشاكل تمنع مشروعًا بحجم مسبار:**

1. **`type` قائمة ضيّقة مُقيَّدة بـCHECK:**
   ```sql
   type text not null default 'video' check (type in ('video','photo','other'))
   ```
   وهذا حرفيًّا ما نهى عنه التكليف (§8). طباعة وبثّ مباشر وفعالية وتنفيذ ميدانيّ
   وهدايا وتقارير — كلّها اليوم `other` أو **ترفضها قاعدة البيانات**.
   القيد مُعرَّف في ملفّين: `phase0_migration.sql` و`deliverable_versions_RUNME.sql`.

2. **لا رابط بالمرحلة.** المخرج يرتبط بـ`project_id` فقط. في مسبار المرحلة **هي**
   مشروع فرعيّ، فالربط ممكن — لكن لا يوجد `stage_group` لمستوى ثالث.

3. **13 حقلًا مطلوبًا في §8 غير موجود إطلاقًا:** `platforms` · `execution_details` ·
   `proposed_caption` · `priority` · `client_visibility` · `internal_notes` ·
   `schedule_status` · `planned_start_date` · `expected_units` · `completed_units` ·
   `recurrence_type` · `recurrence_config` · `requires_*` · `external_key` ·
   `import_batch_id` · `source_row_number` · `source_file_name` · `metadata`.

**القرار المعماريّ:** توسيع إضافيّ (`add column if not exists`) + تحويل `type` من
CHECK ضيّق إلى جدول مرجعيّ قابل للتوسّع + `metadata jsonb` للباقي. **لا جدول جديد
موازٍ**، ولا إعادة بناء لأيّ شيء في Platform V1.

---

## حالة الدفعات

| Batch | الحالة |
|---|---|
| 0 — نقطة الأمان | ✅ منجز |
| 1 — التدقيق وتحليل Excel | 🟡 التدقيق منجز · Excel غير موجود |
| 2 — الاستيراد الجماعي العامّ | ⏳ |
| 3 — قدرات المشاريع المعقّدة | ⏳ |
| 4 — Dataset القبول | ⏳ |
| 5 — حزمة Go-Live | ⏳ |
