# WAVE 4 — خريطة الاعتمادات وقرار كل عنصر

> 🔴 **BLOCK محسوم.** ⛔ لم يُشغَّل SQL ولا استعلام إنتاج — التحليل من المستودع.
> **التاريخ:** ٦ أغسطس ٢٠٢٦

---

## ١. 🔴 السبب الجذريّ — الفحص كان يكذب، لا القاعدة ناقصة

`to_regproc` تأخذ **اسم دالّة مجرَّدًا**. وPREFLIGHT كان يمرّر **توقيعًا بأقواس**:

```sql
to_regproc('public.crm_can_manage()')   -- ⇒ NULL دائمًا
```

فتُعيد `NULL` **مهما كانت الدالّة موجودة**. ⇒ البوّابات الثلاث كانت تُبلَّغ
«مفقودة» وهي على الأرجح موجودة، فبدا الخلل نقصًا في القاعدة وهو في المقارنة.
والصحيح `to_regprocedure` — وهي مستعملة صحيحةً أصلًا في
`activity_log_role_hardening_RUNME.sql` و`SECURITY_POST_APPLY_VERIFICATION.sql`.

**وهذا يفسّر التناقض الذي رُصد على Preview بالضبط:** الجداول ظهرت موجودة
(تُفحص بـ`to_regclass` — صحيحة)، والبوّابات ظهرت مفقودة (تُفحص بـ`to_regproc`
مع توقيع — معطوبة). ⛔ ولا يمكن أن يكون `crm_sales_FOUNDATION` قد طُبِّق جزئيًّا
بهذا الشكل: `crm_can_manage` في السطر ١٦٧ **قبل** `crm_opportunities` في ٥٢٦.

**والعيب ليس في Wave 4 وحدها:** ١٤ موضعًا في ٨ ملفّات (§٦).

---

## ٢. `crm_see_financials` — **اسم لا وجود له**

بحثٌ شاملٌ في المستودع (SQL · TS · TSX · MD) أعطى **صفر نتيجة**.
الاسم الحقيقيّ **`can_see_financials()`**، تُنشئها
`staff_roles_task_assignment_RUNME.sql`، وتشير إليها ١٠+ ملفّات.

⇒ **ليس عيب تطوير ولا اسمًا قديمًا** — بل اسم لم يوجد قطّ. ⛔ ولا مراجع تُصحَّح.

---

## ٣. خريطة الاعتمادات

| العنصر | مَن يُنشئه | التصنيف | مَن يستهلكه في Wave 4 | التوقيع الدقيق | في baseline؟ |
|---|---|---|---|---|---|
| `crm_opportunities` | `crm_sales_FOUNDATION_RUNME.sql` | 🔴 **REQUIRED** | `crm_win_rate_report` · `crm_seasonality_report` · `crm_client_health_v` | جدول | ✅ موجود على Preview |
| `crm_companies` | نفسه | 🔴 **REQUIRED** | `crm_silent_clients` · العرض | جدول | ✅ |
| `crm_activities` | نفسه | 🔴 **REQUIRED** | `crm_silent_clients` · `crm_weekly_digest` | جدول | ✅ |
| `crm_can_manage()` | نفسه (سطر ١٦٧) | 🔴 **REQUIRED** | **٧ استدعاءات بلا حارس** | `public.crm_can_manage()` | ⚠️ بُلِّغ مفقودًا **بفحص معطوب** |
| `crm_can_read_opportunity(uuid)` | نفسه (٨٦٨) | 🔴 **REQUIRED** | سياسة `crm_tender_read` | `(uuid)` | ⚠️ نفسه |
| `crm_can_edit_opportunity(uuid)` | نفسه (٨٧٦) | 🔴 **REQUIRED** | `crm_tender_upsert` | `(uuid)` | ⚠️ نفسه |
| `can_see_financials()` | `staff_roles_task_assignment_RUNME.sql` | 🟡 **OPTIONAL** | `crm_win_rate_report` (حجب الهامش) | `public.can_see_financials()` | ✅ في baseline |
| `kian_testimonials` | `kian_testimonials_v1_RUNME.sql` | 🟡 **OPTIONAL** | قيد مفتاح أجنبيّ **شرطيّ** فقط | جدول | ❌ غير مطبَّق — **ولا يحجب** |
| `project_shoot_sessions` | baseline | 🔴 **REQUIRED** | `crm_client_health_v` | جدول | ✅ |
| `project_closure_requests` | baseline | 🔴 **REQUIRED** | العرض | جدول | ✅ |
| `fin_payment_milestones` | baseline | 🔴 **REQUIRED** | العرض | جدول | ✅ |
| `fin_collections` | baseline | 🔴 **REQUIRED** | العرض | جدول | ✅ |
| `pgcrypto` | امتداد | 🔴 **REQUIRED** | إصدار الدعوات (`digest`) | امتداد | ✅ |
| `crm_opportunity_tender` | **Wave 4 نفسها** | ⚪️ **EXPECTED_ABSENT** | — | جدول | غيابه **صحيح** قبل التشغيل |
| `crm_testimonial_invites` | **Wave 4 نفسها** | ⚪️ **EXPECTED_ABSENT** | — | جدول | غيابه **صحيح** |

---

## ٤. القرار النهائيّ لكل تعارض

### ٤-١ · `kian_testimonials` ⇒ **OPTIONAL** (لا تحجب Wave 4)

**الدليل — من الاستخدام لا من الاسم:**
- الميزة خلف `NEXT_PUBLIC_SHOW_TESTIMONIALS`، **مطفأ**.
- `kian_testimonials_v1_RUNME.sql` مصنَّف `RUNME OPTIONAL` في مصفوفة الإصدار.
- الاستخدام الوحيد في Wave 4 كان **قيد مفتاح أجنبيّ** على عمود `testimonial_id`.
  ⛔ ولا دالّة تقرأ الجدول ولا تكتب فيه.

**العلاج:** أُزيل المفتاح الأجنبيّ من الـDDL، ويُضاف **شرطيًّا وidempotent**
(`crm_ti_testimonial_fk`) إن وُجد الجدول. فإن طُبِّقت الشهادات لاحقًا، أعِد تشغيل
Wave 4 فيُضاف القيد.

🔴 **ولماذا كان هذا حاجبًا حقيقيًّا:** مفتاح أجنبيّ داخل `create table` يُفشل
**إنشاء الجدول كلّه** إن غاب المرجع. فجدولٌ اختياريّ كان يُسقط حزمة CRM كاملة.

### ٤-٢ · بوّابات CRM ⇒ **prerequisite حقيقيّ** (رسميّ في الترتيب)

`crm_can_manage()` تُستدعى **٧ مرّات بلا حارس وجود**. غيابها = خطأ `42883` عند
أوّل نداء، لا تدهور لطيف. ⇒ **prerequisite صريح**.

⛔ **ولم تُنسخ البوّابات إلى Wave 4**: ذلك يصنع تعريفين متنافسين لنفس البوّابة —
نظامًا موازيًا للصلاحيات، وهو أخطر من الاعتماد.

⚠️ **ولا يُشغَّل `crm_sales_FOUNDATION_RUNME.sql` أعمى.** جداوله موجودة على
Preview، فتشغيله كاملًا يُعيد إنشاء ما هو قائم. وهو `idempotent`
(`create table if not exists` + `create or replace function`) — لكن يبقى
**شرط التشغيل: PREFLIGHT الخاص به أوّلًا**، وقراءة مخرجه.

### ٤-٣ · `can_see_financials()` ⇒ **OPTIONAL · fail-closed**

الحارس في Wave 4 كان **صحيح النيّة معطوب التنفيذ**: `to_regproc('…()')` تُعيد
NULL دائمًا ⇒ `v_fin` كان **`false` أبدًا** ⇒ الهامش محجوب دائمًا حتّى للمخوَّل.
⚠️ **آمن لكنّه معطَّل.** صُحِّح إلى `to_regprocedure`، والاتّجاه يبقى fail-closed:
غياب الدالّة ⇒ `coalesce(..., false)` ⇒ حجب.

---

## ٥. ترتيب الإصدار المعدَّل

```
1. wave3_production_ops_RUNME.sql          ← يشترط operations_center مطبَّقًا
2. wave3_permits_media_RUNME.sql
3. wave3_calendar_tokens_RUNME.sql         · العلم يبقى OFF
--- ⬇ جديد: prerequisite رسميّ لـWave 4 ⬇ ---
4. crm_sales_FOUNDATION_RUNME.sql          ← PREFLIGHT/POSTCHECK/ROLLBACK موجودة
5. wave4_crm_business_RUNME.sql
6. wave6_assets_archive_RUNME.sql
7. wave6_compliance_knowledge_RUNME.sql
8. wave6_case_study_generator_RUNME.sql    ← يشترط case_studies_platform
9. wave7_global_search_RUNME.sql
10. wave7_audit_viewer_RUNME.sql
```

**اختياريّة — خارج الترتيب:** `kian_testimonials_v1_RUNME.sql` ·
`wave8_push_tokens_RUNME.sql`.
⚠️ وتطبيق الشهادات **بعد** Wave 4 يستلزم إعادة تشغيل Wave 4 لإضافة القيد.

**المسار الواحد لكل حزمة:** `PREFLIGHT → RUNME → POSTCHECK`، والأعلام **OFF**.

---

## ٦. 🔴 أثر جانبيّ خطير كشفه هذا التدقيق

`to_regproc` بتوقيع كانت في **١٤ موضعًا / ٨ ملفّات**، وكلّها تُعيد NULL دائمًا:

| الملفّ | الأثر | الاتّجاه |
|---|---|---|
| **`wave7_global_search_RUNME.sql:104,118`** | `(is null or can_access_project(...))` ⇒ الطرف الأيسر **صحيح دائمًا** فلا تُقيَّم البوّابة | 🔴 **FAIL-OPEN — تجاوز صلاحية** |
| **`wave5_delivery_rights_RUNME.sql:302`** | بوّابة نافذة السداد **لا تُنفَّذ أبدًا** | 🔴 **تجاوز بوّابة سداد** |
| `wave5_deemed_approval:197` · `wave5_delivery_rights:339` · `wave6_case_study:168` · `wave6_compliance:160` | `log_activity` لا يُستدعى ⇒ **قيود تدقيق لا تُكتب** | 🟠 فقدان أثر |
| `wave7_global_search:126,143` | الأصول والعملاء لا يُبحث فيهما | 🟡 ميزة معطَّلة |
| `wave4_crm_business:174` | الهامش محجوب دائمًا | 🟢 fail-closed |
| `wave3_permits_media:41,330,331` | محرّك التنبيهات يرفع خطأً دائمًا | 🟢 fail-closed |
| `wave7_audit_viewer_PREFLIGHT:5` | بلاغ كاذب | 🟢 |

⇒ **صُحِّحت الأربعة عشر كلّها.** ⛔ وترك تجاوز صلاحية معروف غير مقبول، ولو كان
خارج نطاق Wave 4 اسميًّا.

---

## ٧. ما لا يدّعيه هذا المستند

- ⛔ **لم يُشغَّل SQL ولا استعلام إنتاج.** حالة Preview مأخوذة من تقريرك.
- ⚠️ **«موجود على Preview» ليس تحقّقًا منّي** — يُعاد فحصه بـPREFLIGHT المصحَّح.
- ⛔ ولا تُدَّعى صحّة `crm_sales_FOUNDATION` كاملةً: قُرئت أسطر إنشاء البوّابات
  والجداول، ⛔ ولم يُراجَع الملفّ (١٠٠٠+ سطر) سطرًا سطرًا.
