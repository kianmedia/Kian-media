# دليل تشغيل منصّة إدارة المشاريع — Production Runbook

> النطاق: منصّة **Project Core** كاملةً من الطور 3 إلى 8D (المهام، التخطيط،
> الموارد، الحوكمة، الإغلاق، الهرمية، القوالب، العمليات، البرامج، المسار السريع،
> والـSLA). يُحدَّث هذا الملف عند كل دفعة جديدة.
>
> **هذا الملف مرجع تشغيليّ لا يُشغِّل شيئًا بنفسه.** كل خطوة يدويّة يقوم بها المشغِّل.

---

## 0) المبادئ الثابتة

- **كل ملفات `*_RUNME.sql` في هذا الطور مصمَّمة Additive + Idempotent**: داخل
  `begin … commit`، بـ`create or replace` / `create … if not exists` / preflight
  يرفع خطأً واضحًا عند غياب تبعية، وself-test بلا Side Effects، ثمّ
  `notify pgrst, 'reload schema'`. إعادة تشغيل ملفٍ طُبِّق سابقًا آمنة.
- **لا ملف مدمج مُدمِّر (no consolidated destructive migration).** الإصلاحات
  التراكمية تُضاف في ملف `..._RUNME.sql` جديد لا بتعديل ملف منشور.
- **مصادر الحقيقة الوحيدة**: `project_core.core_stage` لدورة الحياة ·
  `project_progress_snapshot`/محرّك 3C للتقدّم · Gantt V2 لتخطيط المهام ·
  `resource_bookings` للموارد · 5A للحوكمة · 5C للإغلاق · 6A/6B للهرمية ·
  `project_status_history` للتسليم الفعليّ.
- **جدار عزل العميل**: `pc_can_read_project` داخل كل دالّة SECURITY DEFINER؛
  `is_staff()` = false للعميل، فلا يجتاز أيّ سطح طاقميّ. سطح العميل الوحيد يمرّ
  بـ`is_client_owner`.

---

## 1) ترتيب تطبيق SQL على Production

طبِّق الملفات بالترتيب أدناه. أيّ ملف طُبِّق في جلسة سابقة يُتخطّى (إعادة تشغيله
آمنة لكن غير ضرورية). شغِّل كل ملف **مرّة واحدة كاملة** في محرّر SQL على Supabase،
وتأكّد من ظهور رسالة `✅` الخاصّة بالـself-test قبل الانتقال للتالي.

### أ) الأساس (طُبِّق أغلبه في جلسات سابقة — تحقّق قبل التخطّي)
1. `project_core_FINAL_RUNME.sql` — **مطبَّق على الإنتاج** (لوحة القيادة الحيّة تُثبته).
2. `project_core_REMAINING_MODULES_FINAL_RUNME.sql`
3. `project_core_ABSOLUTE_FINAL_RUNME.sql` — (يفترض تطبيق وحدة المالية قبله).
4. سلسلة المخرجات (بالترتيب): `deliverable_versions_RUNME.sql` →
   `deliverable_versions_autocreate_RUNME.sql` → `deliverable_final_master_RUNME.sql`
   → `deliverable_final_receipt_RUNME.sql` → `deliverable_delivery_audit_RUNME.sql`
   → `deliverable_comments_resolution_RUNME.sql`.
5. بوّابة التسليم: `project_delivery_payment_gate_RUNME.sql` →
   `project_delivery_release_policy_RUNME.sql`.
6. `project_timeline_RUNME.sql`.
7. `project_core_UI_COMPLETION_RUNME.sql` — لوحة موحّدة + إنشاء + backfill + auto-init.
8. `project_stage_sync_RUNME.sql` — يجعل `project_status` يعكس `core_stage` (١٣ مرحلة).
9. `project_core_progress_engine_FIX_RUNME.sql`.

### ب) الطور 3 — محرّك المهام والتقدّم
10. `project_tasks_batch3a_RUNME.sql` — يطوّر `project_tasks` (assignees/RLS/subtask cycle guard).
11. `project_tasks_batch3b_RUNME.sql` — Kanban + محرّك سير العمل.
12. `project_tasks_batch3c_RUNME.sql` — التقدّم الموحّد + الصحّة + التنبيهات.
13. `project_phase3_closure_RUNME.sql` — دلالات الاعتماديات + جاهزية المرحلة + التقارير.

### ج) الطور 4 — التخطيط والموارد
14. `project_planning_batch4a_RUNME.sql` — Gantt ومحرّك الجدولة والخطوط الأساسية.
15. `project_planning_batch4a_final_fix_RUNME.sql` — **المحرّك النهائي V2** (بلا Temp Tables).
    > ⚠️ يُغني عن `project_planning_batch4a_hotfix_RUNME.sql` و
    > `project_planning_batch4a_runtime_hotfix_RUNME.sql` — **لا تشغّلهما** (Superseded، §4).
16. `project_resources_batch4b_RUNME.sql` — سعة الموارد والحجوزات ومحرّك التعارض.
17. `project_planning_batch4c_closure_RUNME.sql` — التسوية والمحفظة وإغلاق الطور 4.

### د) الطور 5 — الحوكمة والتنفيذيّ والإغلاق (شغِّل بالترتيب 5A → 5B → 5C)
18. `project_governance_batch5a_RUNME.sql` — المخاطر/المشكلات/القرارات/طلبات التغيير + اعتمادات + SLA اعتماد.
19. `project_governance_batch5b_RUNME.sql` — لوحات المحفظة التنفيذية والمؤشّرات.
20. `project_governance_batch5c_RUNME.sql` — الإغلاق/القبول/الدروس/إعادة الفتح/الأرشفة.

### هـ) الطور 6 — الهرمية والإغلاق التنفيذيّ (6A → 6B → 6C)
21. `project_hierarchy_batch6a_RUNME.sql` — تفعيل الهرمية (master ⇄ subproject).
    > ⚠️ يُعيد استخدام نواة `project_hierarchy_schema_RUNME.sql` **ولا** يطوي
    > `project_hierarchy_security_RUNME.sql` (خطر تصعيد كامن) — لا تشغّل الأخير (§4).
22. `project_hierarchy_batch6b_RUNME.sql` — تجربة الهرمية والعمليات.
23. `project_closure_batch6c_RUNME.sql` — دمج الإغلاق في مسارات الإدارة التنفيذية.

### و) الطور 7 — القوالب والعمليات
24. `project_templates_batch7a_RUNME.sql` — نظام القوالب والإعداد السريع.
25. `project_operations_batch7b_RUNME.sql` — مركز العمليات اليوميّة.

### ز) الطور 8 — البرامج والمسار السريع والـSLA (8A → 8B → 8C → 8D)
26. `project_programs_batch8a_RUNME.sql` — إعدادات البرنامج وبيانات الوحدات.
27. `project_program_planner_batch8b_RUNME.sql` — مخطّط الموجة المتدرّجة والإنشاء الجماعيّ.
28. `project_fastlane_batch8c_RUNME.sql` — المسار السريع للمشاريع الصغيرة.
29. `project_program_sla_batch8d_RUNME.sql` — التزامات البرامج ومحرّك القياس ومصفوفة التسليم.

### ح) إصلاحات التثبيت النهائيّة (إن وُجدت)
30. `docs/project_platform_stabilization_RUNME.sql` — يُشغَّل **أخيرًا** إن أُنشئ (§«ملاحظات التثبيت»).

بعد آخر ملف: تحقّق أنّ PostgREST أعاد تحميل المخطّط (ملفات RUNME تُنهي بـ`notify pgrst`).

---

## 2) ترتيب Git (Commit order — على local main، غير مدفوع)

الدفعات مستقلّة وغير مربوطة (لا Squash). أحدث الدفعات في هذه الجلسة:

| الدفعة | Commit |
|---|---|
| 8A برامج | `99ffb79` (+ متابعة `938be38`) |
| 8B مخطّط متدرّج | `9bbb215` (+ متابعة `f286917`) |
| 8C مسار سريع | `b682e0a` |
| 8D SLA ومصفوفة التسليم | `d112100` |
| التثبيت النهائيّ | (هذا الالتزام) |

**إجراء الدفع (يدويّ عبر GitHub Desktop):** `git push origin main`. الدفع محجوب
في بيئة العمل هذه — نفّذه من GitHub Desktop على جهازك.

---

## 3) إجراء Vercel (النشر)

1. ادفع `main` إلى GitHub (الخطوة أعلاه).
2. Vercel يبني تلقائيًّا من `main`. راقب Build Log حتى `✓ Compiled successfully`.
3. **لا تغيّر أيّ متغيّر بيئة (env) أو Secret.** المنصّة تعمل على مفاتيح Supabase
   العامّة القائمة؛ لا مفتاح Service-role في شيفرة العميل.
4. بعد النشر، شغِّل مصفوفة الدخان (§`PROJECT_PLATFORM_SMOKE_TESTS.md`).

---

## 4) ملفات لا تُشغَّل (Superseded)

| الملف | البديل الحيّ | السبب |
|---|---|---|
| `project_planning_batch4a_hotfix_RUNME.sql` | `project_planning_batch4a_final_fix_RUNME.sql` | حلّ مؤقّت غير كافٍ (Temp Tables هشّة). |
| `project_planning_batch4a_runtime_hotfix_RUNME.sql` | `project_planning_batch4a_final_fix_RUNME.sql` | مُدمَج في المحرّك النهائيّ V2. |
| `project_hierarchy_security_RUNME.sql` | `project_hierarchy_batch6a_RUNME.sql` | يعيد تعريف بوّابات الوصول (≈50 سياسة RLS خلفها) وفيه خطر تصعيد كامن `NULL is distinct from NULL = FALSE`. 6A يفحص كل صفّ بذاته بلا توريث. |
| `project_hierarchy_schema_RUNME.sql` | نواته مُعاد استخدامها داخل 6A | تشغيله وحده يترك أعمدة Batch-1 دون منطق (progress_mode/operational_stage/closure_status تملكها 3C/5C). |

**قاعدة عامّة**: أيّ ملف يعيد تعريف `can_access_project`/`pc_can_read_project`/
`is_client_owner`/`is_client_side` لا يُشغَّل إلّا بمراجعة صريحة — الدفعات
اللاحقة كلّها تعتمد التعريفات القائمة.

---

## 5) تحقّق ما بعد التطبيق (Verification SQL — قراءة فقط)

```sql
-- (أ) لا توقيعات مكرّرة غامضة لدوال المنصّة الأساسية
select proname, count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname in
   ('pc_can_read_project','project_core_create_project','project_core_set_stage',
    'pgm_commitment_results_core','project_program_commitment_results')
 group by proname order by 2 desc;
-- توقّع: pc_can_read_project=1، project_core_set_stage=1 (آخر تعريف يفوز عبر OR REPLACE).

-- (ب) RLS مفعّلة على الجداول الحسّاسة الجديدة
select relname, relrowsecurity from pg_class
 where relname in ('project_program_commitments','project_program_settings',
   'project_program_plan_runs','project_closure_requests') order by relname;
-- توقّع: relrowsecurity = true للجميع.

-- (ج) المُحرِّك الداخليّ للـSLA غير ممنوح لـauthenticated
select routine_name, grantee from information_schema.role_routine_grants
 where routine_name='pgm_commitment_results_core';
-- توقّع: لا صفّ لـgrantee='authenticated'.

-- (د) لا عمود نتيجة SLA مخزَّنة (كلّها مشتقّة)
select column_name from information_schema.columns
 where table_name='project_program_commitments'
   and column_name in ('actual_value','status','breached','is_breached');
-- توقّع: صفر صفوف.
```

---

## 6) استرجاع وتراجع (Rollback guidance)

- **لا تراجع مُدمِّر.** ملفات RUNME إضافية؛ لا تحذف بيانات ولا تُسقط جداول/دوال.
- **إذا فشل ملف في منتصفه**: كلّه داخل `begin … commit`، فالفشل يُلغي المعاملة
  بالكامل تلقائيًّا — لا حالة نصف مطبَّقة. اقرأ رسالة `PREFLIGHT`/`FAIL`، عالِج
  التبعية الناقصة، ثمّ أعد تشغيل الملف كاملًا.
- **إذا ظهر سلوك خاطئ بعد دفعة**: بما أنّ الدوال `create or replace`، يمكن إعادة
  نشر النسخة السابقة من الدالّة من ملف الدفعة الأقدم (تراجع منطقيّ لا حذف). سجّل
  الحادثة قبل ذلك.
- **إعادة التطبيق آمنة**: تشغيل أيّ ملف مرّتين لا يكرّر بيانات (idempotent) — تحقّق
  §5 يبقى صحيحًا.

---

## 7) استكشاف الأعطال (Troubleshooting)

| العَرَض | السبب المرجّح | العلاج |
|---|---|---|
| `PGRST202 / function not found` في الواجهة | لم يُطبَّق ملف الدفعة، أو لم يُعِد PostgREST تحميل المخطّط | شغّل ملف الدفعة؛ نفّذ `notify pgrst, 'reload schema';` |
| رسالة عربية «(الدفعة) غير مطبّقة في قاعدة البيانات» | نفس ما سبق (الأغلفة تترجم PGRST) | نفس ما سبق |
| `42P13 cannot change return type` عند تطبيق دفعة | دالّة أُعيد تعريفها بنوع إرجاع مختلف | تحقّق أنّك لم تشغّل ملفًا Superseded؛ راجع §5(أ) |
| `42P10 ON CONFLICT` يُجهض الترحيل | ON CONFLICT على فهرس جزئيّ بلا شرطه | لا يحدث في الملفات الحاليّة (محروس باختبارات)؛ إن ظهر فالملف مُعدَّل يدويًّا |
| لوحة SLA تعرض كل التزام «غير متاح» | لم يُطبَّق 8D، أو لا مصدر بيانات فعليّ | طبّق 8D؛ «غير متاح» صحيحة عند غياب أحداث موثَّقة |
| العميل لا يرى ملخّص البرنامج | `client_program_view_enabled=false` أو المشروع ليس master | فعّل العلم من إعدادات البرنامج |

---

## 8) خطوات استرداد معروفة الأمان (Known-safe recovery)

1. **إعادة تحميل مخطّط PostgREST**: `notify pgrst, 'reload schema';` — آمن دائمًا.
2. **إعادة بناء لقطة تقدّم مشروع**: استدعِ `project_progress(<id>)` (قراءة تُعيد
   الاشتقاق؛ لا كتابة).
3. **إعادة تهيئة صفّ `project_core` مفقود**: `pcEnsure`/`project_core_dashboard`
   يستدعيان auto-init؛ أو شغّل `project_core_UI_COMPLETION` مجدّدًا (idempotent).
4. **تحقّق عزل عميل بعد أيّ تغيير**: سجّل دخول حساب عميل تجريبيّ وتأكّد أنّه لا يرى
   إلّا مشاريعه (لا مركز عمليات، لا SLA طاقميّ، لا مخاطر داخلية).
