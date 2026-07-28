# حزمة التنفيذ — الصلاحيات و MFA

> **لا شيء هنا مُطبَّق. لا SQL شُغِّل. لا دور أُنشئ. S4 غير مُفعَّلة.**
> آخر تحديث: 2026-07-28 · الفرع `main`

---

## 1 · الحالة

| العنصر | الحالة |
|---|---|
| Fix A — منع إنشاء Super Admin بلا حدّ | `CODE READY — OWNER SQL APPROVAL REQUIRED` |
| Fix B — فصل صلاحيات الهوية عن إدارة المشاريع | ⏳ قيد الإنتاج (تحليل التعريفات الحيّة) |
| Fix C — البوّابات الستّ الفاشلة-مفتوحة | ⏳ قيد الإنتاج |
| org_admin | `MIGRATION PACKAGE READY — NOT APPROVED FOR PRODUCTION` |
| S4b — بوّابات الكتابة الحسّاسة | `PREDICATE READY — NOT BOUND` |
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

## 5 · جدول القرار

| العنصر | التصنيف |
|---|---|
| كل الـCommits المحلية | **SAFE TO PUSH** |
| `PREFLIGHT_P1_role_census.sql` | **SAFE TO APPLY** (قراءة فقط) |
| `authz_fixA_super_admin_grant_RUNME.sql` | **REQUIRES OWNER APPROVAL** |
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
3. Fix C (عند اكتماله) — يسبق Fix B لأن ثلاث بوّابات مكشوفة لـanon
4. Fix B (عند اكتماله) — يعتمد على `can_manage_identity()` في `authz_identity_hardening_s4pre`
5. `org_admin_migration_RUNME.sql` — مستقلّ تمامًا
6. S4a + S4b — **آخر شيء**، وبعد اختبار المالك

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
