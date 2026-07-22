# Phase 4 — Planning & Resources: Single Source of Truth (Closure)

خريطة نهائية لمصادر الحقيقة بعد Phase 4 (4A + 4B + 4C). أي واجهة/دالة جديدة يجب أن تلتزم بها.

## مصادر الحقيقة الرسمية

| المعنى | المصدر الرسمي | الواجهة الرسمية |
|---|---|---|
| تواريخ المهام | `public.project_tasks.start_date` / `due_date` | «المخطط الزمني» (Planner / **Gantt V2** = `project_gantt_snapshot_v2`) |
| تواريخ المشروع | `public.project_core.start_date` / `due_date` (fallback: اشتقاق من مهام المشروع min/max، وإلا null) | كائن `project` داخل `project_gantt_snapshot_v2` + `portfolio_schedule_dashboard` |
| دورة حياة المشروع | `public.project_core.core_stage` (المصدر الوحيد) | Lifecycle Timeline (يعتمد core_stage فقط) |
| نسبة التقدم | `project_progress_snapshot` / `project_progress()` | شريط التقدم الموحّد |
| الاعتماديات | `public.task_dependencies` (FS/SS/FF/SF + `lag_days`) | Gantt V2 |
| خط الأساس | `project_tasks.baseline_start` / `baseline_end` | Gantt V2 (زر «خط الأساس») |
| أيام العمل / التقويم | `public.planning_calendar_settings` (`work_days` bool[7]، `holidays` date[]، `hours_per_day`) + `is_working_day()` / `add_working_days()` | تقويم التخطيط |
| حجوزات الموارد | `public.resource_bookings` (طبقة تخطيط) عبر `resource_booking_*` RPCs | تبويب «الموارد» |
| سجل الموارد | `public.planning_resources` (Registry يشير للمصادر) | تبويب «الموارد» |
| المعدات (مصدر) | `public.custody_inventory_assets` (نظام العهدة) — قراءة فقط من التخطيط | نظام العهدة (منفصل) |
| الموظفون (مصدر) | `public.hr_employee_profiles` — قراءة فقط | نظام HR (منفصل) |
| الإجازات / العطلات | `public.hr_leave_requests` / `public.hr_holidays` — قراءة فقط (Adapter) | نظام HR |
| عبء العمل | يُحسب حيًّا: `employee_workload_snapshot` / `project_team_workload` (لا يُخزَّن) | تبويب «الموارد» |
| صحة الجدول | تُحسب حيًّا: `project_schedule_health` (لا تُخزَّن) | Portfolio + تبويب المشروع |
| محفظة المشاريع | `portfolio_schedule_dashboard` | «جدولة المشاريع» (لوحة الإدارة) |

## قواعد صارمة

1. **كاتب واحد لتواريخ المهام**: `project_tasks` عبر `pc_task_reschedule` / `pc_task_update` / `pc_task_set_planning` / `project_schedule_apply` / `project_resource_leveling_apply`. لا واجهة تكتب تواريخ المهام مباشرةً.
2. **`project_schedule_items`** (تبويبا «الخطة الزمنية»/«التقويم») طبقة **أحداث/تقويم مستقلة** (تصوير/اجتماعات/معالم يدوية) — ليست تكرارًا لتواريخ المهام. تُحرَّر عبر `pcScheduleUpsert` فقط. **لا تكتب تواريخ المهام.**
3. **`UnifiedGanttTab`** (تبويب «المخطّط») = عرض توافقي **قراءة فقط** يوحّد المهام + عناصر الخطة + الجلسات (`project_core_gantt`). **Deprecated للجدولة**؛ أُضيف مؤشّر يوجّه لـ«المخطط الزمني» (Planner). لم تُحذف بياناته/جداوله (آمن). لا يكتب تواريخ المهام باستقلال.
4. **حجز المورد ≠ صرف عهدة**: `resource_bookings` نيّة تخطيطية؛ الصرف الفعلي يبقى في نظام العهدة. محرك التعارض يقرأ واقع العهدة (صيانة/توفر/حجوزات) دون الكتابة عليه.
5. **قراءة-فقط** على العهدة والمالية وZoho وHR من طبقة التخطيط. لا تعديل `core_stage`/`progress`/المالية.
6. **`done` تبقى `done`** (لا تتحوّل إلى `completed`).
7. **التوقيت**: Asia/Riyadh افتراضيًا (عرض المواعيد بتوقيت الشركة).

## الأنظمة القديمة (Deprecated / Compatibility)

| النظام | الحالة | ملاحظة |
|---|---|---|
| `project_gantt_snapshot` (بلا `_v2`) | Deprecated wrapper → V2 | يفوّض للمسار الآمن؛ الواجهة الحديثة تستدعي `_v2` |
| `project_critical_path` / `project_schedule_preview` (بلا `_v2`) | Deprecated (يستخدمها `project_schedule_apply` في سياق كتابة آمن) | الواجهة تستخدم `_v2` |
| `UnifiedGanttTab` | Compatibility (عرض) | استخدم Planner لجدولة المهام |

## بنود Phase 4 المؤجَّلة (موثّقة — لا تُقفَل ضمنيًا)

- Parent–Child **Aggregate** Gantt (صفوف ملخّص للمشاريع الفرعية داخل مخطّط واحد) — البنية جاهزة (`parent_project_id` + `p_include_children` في V2)، تبقى واجهة الدمج.
- مركز حلّ التعارضات التفاعلي (اقتراحات بديل/تقسيم) — البيانات متاحة عبر `resource_conflict_center`؛ تبقى واجهة الاقتراحات.
- حزمة تقارير التخطيط/الموارد الكاملة + CSV (Utilization/Booking-Conflict/Equipment-Usage/Capacity-Forecast/Baseline-Variance/Milestone) — تبقى واجهات التصدير.
- تنبيهات Cron للموارد (Overallocated/Conflict/Maintenance-approaching/Milestone-at-risk) — يُعاد استخدام Cron الحالي؛ يبقى الربط.
- لوحة صحّة مدمجة (execution + schedule + resource) في تبويب المشروع — `project_schedule_health` جاهزة وتظهر في Portfolio؛ يبقى الدمج داخل تبويب المشروع.
- Mobile/Accessibility closure الكامل للـTimelines (Drag/Resize + keyboard + aria الشامل).

> **الحاجب الفعلي لهذه الجلسة**: المراجعة العدائية الآلية (Workflow subagents) اصطدمت بحدّ الجلسة (session limit)، فتعذّر تشغيلها لـ4C؛ اعتُمد Self-review صارم بدلًا منها. كما أن SQL لم يُطبَّق على Production ولم يُدفَع أي Commit (بحسب القيود).
