-- ════════════════════════════════════════════════════════════════════════════
-- operations_center_PREFLIGHT.sql                     (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ قبل operations_center_RUNME.sql. كلّ استعلام هنا SELECT صِرف.
--
-- منهج المطابقة: information_schema/pg_catalog بدل تخمين الأسماء، وilike مع
-- pg_get_functiondef (المُفكِّك يرفع حالة COALESCE).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الاعتمادات الإلزامية ───────────────────────────────────────────────
-- متوقّع: 3 صفوف، exists_now = true في كلّها. أيّ false ⇒ لا تُشغّل RUNME.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.is_staff()'), ('public.is_owner()'), ('public.is_admin()')) f(sig);

-- متوقّع: profiles موجود.
select 'public.profiles' as obj, (to_regclass('public.profiles') is not null) as present;

-- ─── 2) الاعتمادات الاختيارية — الحزمة تكتشفها ولا تفترضها ────────────────
-- متوقّع: توثيقيّ. الغياب مسموح ويُغيّر السلوك بصدق:
--   • permissions/emp_has_permission غائب ⇒ المالك/الأدمن فقط (fail-closed).
--   • projects غائب ⇒ الربط بالمشروع معطّل (اختياريّ أصلًا).
--   • custody_inventory_* غائب ⇒ اختيار الأصول نصّ حرّ، ولا يُدّعى تكامل.
--   • resource_bookings غائب ⇒ لا مسح تعارضات لطبقة التخطيط، ويُعلَن ذلك.
select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.permissions'), ('public.professions'), ('public.employee_professions'),
             ('public.projects'), ('public.hr_employee_profiles'),
             ('public.custody_inventory_assets'), ('public.custody_inventory_reservations'),
             ('public.custody_inventory_assignments'),
             ('public.planning_resources'), ('public.resource_bookings'),
             ('public.notifications')) o(name);

select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.emp_has_permission(uuid,text)'),
             ('public.notify(uuid,text,text,text,uuid,text,text)')) f(sig);

-- ─── 3) اسم عمود اسم المشروع — يُقرأ ولا يُخمَّن ──────────────────────────
-- متوقّع: صفّ واحد على الأقلّ (project_name في هذا المستودع). لو خرج فارغًا
-- فسيعيد prodops_project_label قيمة NULL بصدق بدل رفع 42703.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('project_name','title','name');

-- ─── 4) لا تصادم أسماء: prodops_* حرّة، وops_can_view() لـ7B تبقى كما هي ──
-- متوقّع: صفر صفّ (لا شيء باسم prodops_ قبل التشغيل).
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'prodops%';

-- متوقّع: ops_can_view موجودة (تخصّ Batch 7B) — لن تُلمس.
select 'public.ops_can_view()' as sig, (to_regprocedure('public.ops_can_view()') is not null) as belongs_to_7b;

-- متوقّع: صفر صفّ — لا جدول ops_* قبل التشغيل.
select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'ops\_%';

-- ─── 5) تجميد منصّة المشاريع — لقطة قبل/بعد ──────────────────────────────
-- متوقّع: احتفظ بهذه الأعداد وقارنها في POSTCHECK. أيّ تغيّر ⇒ خرق التجميد.
select 'frozen_objects' as label,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='projects') as projects_columns;

-- ─── 6) لا صلاحية anon على ما سنبني فوقه ─────────────────────────────────
-- متوقّع: false في كلّ صفّ موجود.
select f.sig, has_function_privilege('anon', f.sig, 'EXECUTE') as anon_exec
from (values ('public.is_staff()'), ('public.emp_has_permission(uuid,text)')) f(sig)
where to_regprocedure(f.sig) is not null
  and exists (select 1 from pg_roles where rolname = 'anon');

-- ─── 7) نسخة الخادم تدعم gen_random_uuid ─────────────────────────────────
-- متوقّع: true (pg13+ يوفّرها في core).
select (to_regprocedure('pg_catalog.gen_random_uuid()') is not null
     or to_regprocedure('public.gen_random_uuid()') is not null) as gen_random_uuid_available;

-- ─── 8) قيد notifications.type — يفسّر لماذا الإشعار معزول باستثناء ──────
-- متوقّع: توثيقيّ. إن كان القيد enum قديمًا فلن يقبل ops_crew_assigned، ولذلك
-- prodops_notify يبتلع الفشل حتى لا تسقط عملية تشغيلية صحيحة بسبب إشعار.
select conname, pg_get_constraintdef(oid) as def
from pg_constraint
where conrelid = to_regclass('public.notifications') and contype = 'c';
