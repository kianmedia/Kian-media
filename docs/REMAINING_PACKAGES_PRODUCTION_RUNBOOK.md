# Remaining Packages — Production Runbook

> لا يحتوي هذا الملفّ أيّ بيانات عميل ولا أسرارًا.
> كلّ ما دونه محلّيّ. **لم يُدفَع شيء، ولم يُشغَّل SQL على الإنتاج.**

## ١) الدفع

```bash
git push origin main
```

## ٢) الـCommits التي ستُرفع

تُعرَض بـ`git log --oneline origin/main..HEAD`. جميعها محلّيّة فوق `origin/main`،
بلا `amend` ولا `rebase` ولا تعديل تاريخ.

## ٣) انتظار Vercel

لا تغييرات على شيفرة التطبيق في هذه الجولة — التعديلات كلّها في `docs/*.sql`
و`tests/*`. فلا حاجة لانتظار نشر إن لم يظهر بناء جديد.

## ٤) ملفّات SQL بالترتيب

| # | الملفّ | النتيجة المتوقَّعة |
|---|---|---|
| 1 | `case_studies_platform_PREFLIGHT` | `READY` أو `READY_TO_SEED` |
| 2 | `case_studies_platform_RUNME` | `COMMIT` بلا خطأ (معاملة واحدة) |
| 3 | `case_studies_platform_POSTCHECK` | نتيجة واحدة · كلّ الصفوف PASS |
| 4 | `live_operations_dashboard_PREFLIGHT` | `READY` |
| 5 | `live_operations_dashboard_RUNME` | `COMMIT` بلا خطأ — **معاملة واحدة** بعد الدمج |
| 6 | `live_operations_dashboard_POSTCHECK` | نتيجة واحدة · كلّ الصفوف PASS |
| 7 | `kian_ai_assistant_PREFLIGHT` | `READY` |
| 8 | `kian_ai_assistant_RUNME` | `COMMIT` بلا خطأ (معاملة واحدة) |
| 9 | `kian_ai_assistant_POSTCHECK` | نتيجة واحدة · الوضع **disabled / configuration_required** |
| 10 | `executive_reporting_PREFLIGHT` | `READY` |
| 11 | `executive_reporting_RUNME` | `COMMIT` بلا خطأ (معاملة واحدة) |
| 12 | `executive_reporting_POSTCHECK` | نتيجة واحدة · ومنها الفحص 91: الحزم الثلاث عشرة السابقة قائمة |

## ٥) شروط التوقّف

- أيّ `ERROR` في PREFLIGHT ⇒ **لا تُشغّل RUNME**.
- أيّ صفّ `FAIL` في POSTCHECK ⇒ **لا تنتقل إلى الحزمة التالية**.
- **لا حالة جزئية ممكنة الآن**: الحزم الأربع كلّها معاملة واحدة. أيّ فشل =
  تراجع كامل. أرسل لي نصّ الخطأ ورقم السطر.

## ٦) ملفّات لا تُشغَّل

- أيّ `*_ROLLBACK.sql` — لا يُشغَّل تلقائيًّا إطلاقًا.
- `*_AFTER_FAILURE_VERIFY.sql` للحزم المطبَّقة سابقًا — قراءة فقط، وتُشغَّل عند
  الحاجة للتشخيص لا كخطوة روتينية.

## ٧) سياسة التراجع

**لا ROLLBACK.** جميع RUNME الأربعة idempotent: الدوالّ `create or replace`،
والجداول والفهارس `if not exists`، وكلّ زناد وسياسة مسبوقة بـ`drop … if exists`.
العلاج عند الفشل = إصلاح ثمّ **إعادة تشغيل** RUNME، لا تراجع.

## ٨) اختبارات القبول اليدوية بعد التطبيق

1. **Case Studies**: أنشئ دراسة كمسوّدة → لا تظهر للعامّة · اطلب اعتمادًا →
   يُعتمد من المالك/الأدمن وحده · انشر → تحقّق أنّ الإسقاط العامّ لا يحمل
   مالًا ولا ملاحظات داخلية · اسحب النشر → تختفي فورًا.
2. **Live Operations**: افتح اللوحة بدور موظّف → لا تكلفة ولا هامش ولا سعر
   مورّد · تحقّق من ظهور طابع التحديث · تحقّق أنّ البيانات القديمة تُعلَن قديمة.
3. **AI Assistant**: افتح المساعد → يجب أن يُعلن **معطَّل / يحتاج إعدادًا**، ولا
   يدّعي إجابة. لا يُفعَّل مزوّد في هذه الجولة.
4. **Executive Reporting**: افتح بدور مالك → تظهر الربحية · بدور مدير → لا تظهر ·
   بدور عميل أو موظّف → لا وصول إطلاقًا.

## ٩) حدود معلَنة بصدق

- **`BASIS_NOT_SEPARATED` — أُغلقت.** `mgmt_revenue_basis(date,date)` تُعيد
  أربعة أسس مفصولة: `contract_value_net` · `invoiced_revenue_net` ·
  `collected_revenue_net` · `recognized_revenue_net`. والأخير **NULL** ما لم
  يوجد مصدر اعتراف محاسبيّ معتمد — لا يُشتقّ من فاتورة ولا عقد. والضريبة ليست
  إيرادًا (`vat_included = false`)، ولا تُجمع عملتان
  (`mixed_currency` + `unavailable_grouped_by_currency`). والربح لم يعد
  `coalesce(...,0)`: يبقى NULL عند نقص الأساس. الدالّة **للمالك وحده**.
- **AI Assistant** بلا مزوّد: يعمل بوضع معطَّل معلَن. لا مفاتيح، ولا اتصال، ولا
  ادّعاء ثقة. تفعيله لاحقًا قرار منفصل بإعدادات حقيقية.
- **`live_operations_dashboard` — دُمجت معاملتاه.** كانت الثانية **لا تُنشئ
  شيئًا**: كانت الفحص الذاتيّ **بعد** COMMIT، أي تقريرًا بعد الوقوع لا مانعًا
  قبله — وفشلُه كان يترك 12 جدولًا و56 دالّة مطبَّقةً بلا مصادقة. ولا ضرورة
  تقنية للفصل (لا CONCURRENTLY ولا VACUUM ولا CREATE EXTENSION). صار الفحص
  يسبق COMMIT الوحيد.
- لا شيء ممّا سبق مُثبَت على PostgreSQL: لا وصول لي إلى قاعدة. كلّ التحقّق
  **ساكن** على النصّ. الدليل القاطع هو تشغيلك.

## ١٠) دلالات المقاييس المالية

| المقياس | المعنى | المصدر | عند الغياب |
|---|---|---|---|
| `contract_value_net` | قيمة العرض المعتمد قبل الضريبة | `sq_quotes` (approved) | NULL |
| `invoiced_revenue_net` | الفواتير الصادرة قبل الضريبة | `fin_receivables` | NULL |
| `collected_revenue_net` | المحصَّل فعلًا قبل الضريبة | `fin_receivables` (paid) | NULL |
| `recognized_revenue_net` | الاعتراف المحاسبيّ | **لا مصدر معتمد** | **NULL دائمًا** |
| `estimated_net_profit` | ربح مقدَّر | المالية | **NULL** عند نقص الأساس |

**لا يُعلَن ربح عند أساس ناقص.** ولا يُقرأ أيّ من الأربعة «إيرادًا» مطلقًا.
