# حزمة التنفيذ — الصلاحيات و MFA

> **لا شيء هنا مُطبَّق. لا SQL شُغِّل. لا دور أُنشئ. S4 غير مُفعَّلة.**
> آخر تحديث: 2026-07-28 · الفرع `main`

---

## 1 · الحالة

| العنصر | الحالة |
|---|---|
| Fix A | ✅ `APPLIED AND VERIFIED ON PRODUCTION` |
| S4 Pre | ✅ `APPLIED AND VERIFIED ON PRODUCTION` |
| Fix B | ✅ `APPLIED AND VERIFIED ON PRODUCTION` |
| Fix C | ✅ `APPLIED AND VERIFIED ON PRODUCTION` |
| Public Quote Flow | ⏳ `MANUAL TEST PENDING` |
| org_admin | `MIGRATION PACKAGE READY — NOT APPROVED FOR PRODUCTION` |
| S4a — المُسنِد | `CODE READY — NOT APPLIED` |
| S4b — ربط البوّابات بالتسع | `CODE READY — PRODUCTION DENIAL PROOF REQUIRED` |
| MFA login (S3.5) | ✅ `PASS` — مؤكَّدة على الإنتاج بواسطة المالك |

`enforcement_mode` = `enrollment` · لا تغيير.

---

## 2 · دليل P1 (شغّلها المالك على الإنتاج)

```
owner_count = 2          super_admin_count = 0
owner_and_super_admin_overlap = 0
owner_with_any_staff_role     = 0
super_admin_non_owner         = 0
```

| الدالّة | anon | authenticated |
|---|---|---|
| `can_manage_custody` · `can_manage_hr` · `civ_can_manage` | ❌ | ✅ |
| **`can_manage_quotes` · `can_see_invoices` · `can_see_opportunities`** | **✅** | ✅ |

**ثلاثة استنتاجات:**
1. **لا Backfill** — صفر super_admin ⇒ ترحيل `org_admin` لا يمسّ صفًّا واحدًا.
2. **ثغرة Fix A كامنة اليوم، لا نظرية** — لا أحد يستطيع استغلالها الآن، لكن أيّ مالك
   يستطيع إنشاء أوّل super_admin، **وعندها تصير غير محدودة**. الإصلاح يجب أن يسبق أوّل منح.
3. **ثلاث بوّابات مكشوفة لـanon** ترفع أولوية Fix C من «كامن» إلى «يحتاج إثباتًا».

⏳ استعلام «الأدوار غير المعروفة» لم تصل نتيجته → `M-011` (قراءة فقط، لا يحجب شيئًا).

---

## 3 · Fix A — منع إنشاء Super Admin بلا حدّ

**الثغرة:** `admin_set_staff_role` تفحص **حالة الهدف** ولا تفحص **الدور المُمنَح**، و
`'super_admin'` في قائمتها المسموحة، و`is_owner() = is_admin() OR staff_role='super_admin'`.
⇒ أيّ super_admin يرقّي موظفًا عاديًّا إلى مالك كامل، بلا حدّ للعدد.

**التعريف الحيّ:** `portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39-57`
**لماذا هو الفائز:** أربعة تعريفات متنافسة؛ هذا وحده يقبل الأدوار الـ12 التي يشحنها
`lib/portal/roles.ts:100-102` فعلًا. الملفّ المسمّى باسم الميزة أقدم بأربعة أشهر ومهجور —
إصلاحه كان سيبدو مُنجَزًا وهو لا شيء.

**الملفّات:** `docs/authz_fixA_super_admin_grant_RUNME.sql` ·
`docs/authz_fixA_super_admin_grant_ROLLBACK.sql`

---

## 4 · org_admin — حزمة ترحيل خاملة

**القرار:** `org_admin` · «مسؤول إداري» · Owner > Super Admin > Org Admin > Manager > Employee > Client

**لماذا ليس `admin`:** `ViewRole = "admin" | "client" | "lead" | StaffRole`، والاتحاد
**مجموعة** — إضافة `"admin"` لا تضيف عضوًا، فيصير `isOwner` صحيحًا ويحصل الدور **الأدنى**
على عشر رايات بمستوى المالك وتبويبات أوسع من super_admin، **بلا خطأ ترجمة**.
أمّا `org_admin` فوسّع الاتحاد فعلًا و**أفشل البناء** حتى أسندتُ له تبويبات — الحارس عمل.

**اليوم الأول:** `employee`, `notifications`, `profile` فقط · ليس Owner · ليس Super Admin ·
لا يغيّر إعدادات الأمان · لا MFA · غير قابل للاختيار حتى تُرفع الراية.

**الملفّات:** `docs/org_admin_migration_RUNME.sql` · `docs/org_admin_migration_ROLLBACK.sql`
**الراية:** `NEXT_PUBLIC_ORG_ADMIN_ROLE_ENABLED` (افتراضيًا `false`)

---

## 4b · Fix B — فصل الهوية عن إدارة المشاريع

**الثغرة:** سبع دوالّ كتابة مُبوَّبة على `is_admin() OR can_manage_projects()`،
و`can_manage_projects()` تشمل `manager` ⇒ **أيّ مدير مشروع يُعيد كتابة صلاحيات أيّ موظف،
ويُسند لنفسه مهنة محمّلة بصلاحيات حسّاسة** — تصعيد ذاتي دائم.

**فخّ تعريف مهجور ثانٍ:** `admin_upsert_profession` لها تعريفان؛ الفائز
`professions_grants_and_hardening_RUNME.sql:37` (2026-07-18) لا
`employee_professions_RUNME.sql:241` (2026-07-17). إصلاح الثاني كان لا شيء.

**دالّة ثامنة لم تكن في قائمتي:** `admin_delete_profession` — أرشفة مهنة **تسحب
صلاحياتها فورًا من كل حاملها** (`emp_has_permission` يربط `pr.is_active`)، فهي تلاعب
بالصلاحيات لا تنظيم كتالوج. أُضيفت.

**تُركت عمدًا:** `admin_bulk_set_profession_permissions` — بلا شرط تفويض أصلًا، جسمها
نداء متكرّر للدالّة الداخلية، فترث بوّابتها الجديدة. تعديلها تغيير بلا مبرّر.

**⚠️ تصحيح لاستشهادي:** كنتُ أشرتُ إلى `permission_catalog_RUNME.sql:219/:258` كمواضع
كتابة — وهما داخل `emp_has_permission`/`emp_can`، أي **قراءة**. صُحِّح في مكانه.

## 4c · Fix C — البوّابات الستّ

**الشكل:** `if not <pred>() then raise` مع `<pred>` قد تُعيد NULL ⇒ `not NULL` ليست TRUE
⇒ **الاستثناء لا يُرفع والجسم يُنفَّذ متجاوزًا RLS**. `can_manage_hr` وحدها لها
**48 حارسًا فاشلًا-مفتوحًا**.

**قرار anon — المحافِظ عمدًا:** ثلاث دوالّ مكشوفة لـanon، و**لم يُسحب EXECUTE منها**.
السحب الأعمى قد يكسر نموذج طلب عرض السعر العام؛ الإصلاح يجعلها تُعيد `false` صريحة بدل
NULL — يغلق الفشل-المفتوح دون لمس أيّ مسار عام.

**ملاحظة تمييزية:** سياسات RLS `using` **تفشل مغلقة** (NULL تُخفي صفوفًا ولا تمنح شيئًا).
الخطر في حرّاس الدوالّ فقط.

## 4d · S4b — ربط البوّابة بسبع عمليات

**المحميّة:** `admin_set_staff_role` · `admin_set_account` · `admin_set_employee_professions`
· `admin_set_employee_override` · `admin_set_profession_permission` ·
`admin_upsert_profession` · `admin_delete_profession`

**★ أخطر خاصّية في هذه المرحلة ★** — Fix A و Fix B يُعيدان بناء **نفس** بعض هذه الدوال.
S4b يأتي **بعدهما**، فأجسامه مبنيّة على **الأجسام بعد الإصلاح** + البوّابة.
لو بُنيت من التعريفات الأصلية لكان تطبيق S4b **يُلغي Fix A و Fix B بصمت** — فتُعاد فتح
ثغرتَي إنشاء super_admin بلا حدّ وكتابة المدير للصلاحيات — **بينما فحص ذاتي أخضر يؤكّد
وجود بوّابة MFA**. اختبار يمنع هذا: يتحقّق أن `role_change_denied` و`can_manage_identity`
باقيان في الأجسام المُعاد بناؤها.

**موضع السطر:** بعد فحوص التفويض لا قبلها — فالمتصل غير المخوّل يحصل على خطأ تفويض
لا على مطالبة MFA بلا معنى.

**غير مبوَّطة عمدًا:** `mfa_admin_set_mode` — وضع زرّ الطوارئ خلف القفل الذي يفتحه
يترك مالكًا فقد جهازه بلا مخرج.

**الملفّات:** `mfa_write_gate_s4b_RUNME.sql` · `_ROLLBACK.sql` (منفصل) · `_PREFLIGHT.sql`
· `_POSTCHECK.sql` · `docs/MFA_S4B_MANUAL_ACCEPTANCE.md`
**الواجهة:** `components/portal/useSensitiveWrite.tsx` — إعادة المحاولة **مرّة واحدة**،
بلا حلقات، والإلغاء لا يُنفّذ العملية، وبقاء aal1 بعد التحقّق يُظهر `mfa_session_not_elevated`.

## 5 · جدول القرار

| العنصر | التصنيف |
|---|---|
| كل الـCommits المحلية | **SAFE TO PUSH** |
| `PREFLIGHT_P1_role_census.sql` | **SAFE TO APPLY** (قراءة فقط) |
| `authz_fixA_super_admin_grant_RUNME.sql` | **REQUIRES OWNER APPROVAL** |
| `authz_fixC_null_failopen_gates_RUNME.sql` | **REQUIRES OWNER APPROVAL** |
| `authz_fixB_identity_permissions_RUNME.sql` | **REQUIRES OWNER APPROVAL** (يعتمد على s4pre) |
| `org_admin_migration_RUNME.sql` | **REQUIRES OWNER APPROVAL** |
| `mfa_write_gate_s4a_RUNME.sql` · `authz_identity_hardening_s4pre_RUNME.sql` | **REQUIRES OWNER APPROVAL** |
| رفع `NEXT_PUBLIC_ORG_ADMIN_ROLE_ENABLED` | **REQUIRES OWNER APPROVAL** |
| ربط بوّابات S4b | **DO NOT RUN** — بعد اعتماد النموذج |
| تحويل أيّ حساب إلى `org_admin` | **DO NOT RUN** |
| `enforcement_mode = 'enforced'` | **DO NOT RUN** — ليست قيمة مشروعة أصلًا |

---

## 6 · ترتيب التطبيق المقترح

1. `PREFLIGHT_P1_role_census.sql` — الاستعلام (3) المتبقّي · قراءة فقط
2. `authz_fixA_super_admin_grant_RUNME.sql` — **مستقلّ، لا يعتمد على شيء**
3. `authz_fixC_null_failopen_gates_RUNME.sql` — **يسبق B** (ثلاث بوّابات مكشوفة لـanon)
4. `authz_identity_hardening_s4pre_RUNME.sql` ← **ثم** `authz_fixB_identity_permissions_RUNME.sql`
   (B يستدعي `can_manage_identity()` التي يُنشئها s4pre — الترتيب إلزامي)
5. `org_admin_migration_RUNME.sql` — مستقلّ تمامًا
6. `mfa_write_gate_s4b_PREFLIGHT.sql` (قراءة فقط) ← يتحقّق أن A و B و s4pre و S4a مُطبَّقة
7. `mfa_write_gate_s4a_RUNME.sql` ← ثم `mfa_write_gate_s4b_RUNME.sql`
8. `mfa_write_gate_s4b_POSTCHECK.sql` (قراءة فقط)
9. اختبار المالك اليدوي — `docs/MFA_S4B_MANUAL_ACCEPTANCE.md`

⛔ **S4b يعتمد على تطبيق Fix A و Fix B أوّلًا.** الـPREFLIGHT يرفض غير ذلك.

**زرّ الطوارئ في كل مرحلة:**
```sql
update public.mfa_settings set enforcement_mode = 'off' where id = 1;
```

---

## 7 · مخاطر معروفة

| # | الخطر | التخفيف |
|---|---|---|
| 1 | تعريف مهجور يُصلَح بدل الحيّ ⇒ إصلاح وهميّ | كل ملفّ يذكر التعريف الفائز ودليله؛ حدث فعلًا مع `admin_set_staff_role` |
| 2 | سحب EXECUTE من anon يكسر النماذج العامة | لا سحب قبل إثبات المسار العام؛ القرار لكل دالّة على حدة |
| 3 | تضييق `is_owner()` ⇒ 68 موضعًا يتعطّل | **لم تُمسّ**؛ الانتقال بمُسنِدات جديدة ونقل تدريجي |
| 4 | تراجع `org_admin` تحت صفّ حيّ يُبطل القيد | التراجع **يرفض العمل** إن وُجد حامل للدور |
| 5 | نشر الكود قبل SQL | الراية مُطفأة ⇒ الدور غير قابل للاختيار |
