-- ════════════════════════════════════════════════════════════════════════════
-- finance_profitability_PREFLIGHT.sql                 (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ قبل finance_profitability_RUNME.sql. كلّ استعلام هنا SELECT صِرف.
--
-- منهج المطابقة: information_schema/pg_catalog بدل تخمين الأسماء، وilike مع
-- pg_get_functiondef (المُفكِّك يرفع حالة COALESCE).
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الاعتمادات الإلزامية ───────────────────────────────────────────────
-- متوقّع: 4 صفوف، exists_now = true في كلّها. أيّ false ⇒ لا تُشغّل RUNME.
select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.is_staff()'), ('public.is_owner()'), ('public.is_admin()'),
             ('public.staff_role()')) f(sig);

-- متوقّع: profiles موجود.
select 'public.profiles' as obj, (to_regclass('public.profiles') is not null) as present;

-- ─── 2) الاعتمادات الاختيارية — الحزمة تكتشفها ولا تفترضها ────────────────
-- متوقّع: توثيقيّ. الغياب مسموح ويُغيّر السلوك بصدق:
--   • permissions/emp_has_permission غائب ⇒ المالك وحده (وهو الافتراض في V1
--     أصلًا: المالية الحسّاسة owner-only ولا مفتاح يفتحها).
--   • projects غائب ⇒ الربط بالمشروع معطّل (اختياريّ أصلًا) ولا مفاتيح خارجية.
--   • custody_purchase_requests غائب ⇒ حقل المرجع يبقى فارغًا، ولا يُدّعى تكامل.
select o.name, (to_regclass(o.name) is not null) as present
from (values ('public.permissions'), ('public.profession_permissions'),
             ('public.employee_permission_overrides'), ('public.projects'),
             ('public.custody_purchase_requests'), ('public.custody_vendors'),
             ('public.invoices'), ('public.quotes')) o(name);

select f.sig, (to_regprocedure(f.sig) is not null) as exists_now
from (values ('public.emp_has_permission(uuid,text)'),
             ('public.civ_can_finance()')) f(sig);

-- ─── 3) اسم عمود اسم المشروع — يُقرأ ولا يُخمَّن ──────────────────────────
-- متوقّع: صفّ واحد على الأقلّ (project_name في هذا المستودع). لو خرج فارغًا
-- فسيعيد finops_project_label قيمة NULL بصدق بدل رفع 42703.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'projects'
  and column_name in ('project_name','title','name');

-- ─── 4) لا تصادم أسماء: fin_* وfinops_* حرّتان قبل التشغيل ───────────────
-- متوقّع: صفر صفّ في كليهما.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'finops%';

select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'fin\_%';

-- متوقّع: الدوالّ المالية القائمة تخصّ موديولات أخرى ولن تُلمَس.
select f.sig, (to_regprocedure(f.sig) is not null) as untouched_by_this_package
from (values ('public.civ_can_finance()'), ('public.can_see_invoices()')) f(sig);

-- ─── 5) مفاتيح الصلاحيات: finance.* القائمة تبقى كما هي ──────────────────
-- متوقّع: قائمة مفاتيح finance.* الحالية. احتفظ بها وقارنها في POSTCHECK:
-- الحزمة تضيف/تعيد وسم finance_ops.* فقط ولا تعدّل أيّ مفتاح finance.* قائم.
select key, category, sensitivity, sort_order from public.permissions
where key like 'finance%' order by sort_order;

-- متوقّع: صفر صفّ (لا مفتاح finance_ops.* قبل التشغيل).
select key from public.permissions where key like 'finance_ops.%';

-- ─── 6) تجميد منصّة المشاريع — لقطة قبل/بعد ──────────────────────────────
-- متوقّع: احتفظ بهذه الأعداد وقارنها في POSTCHECK. أيّ تغيّر ⇒ خرق التجميد.
select 'frozen_objects' as label,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal',
                       'project_transition_requests')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='projects') as projects_columns;

-- متوقّع: توثيقيّ. ماليات المنصّة موجودة وستبقى **غير مقروءة** من هذه الحزمة:
-- الاعتماد على أعمدة سطح مُقفَل كان سيربط موديولًا حيًّا بما لا يُعدَّل.
select o.name, (to_regclass(o.name) is not null) as present_but_not_used
from (values ('public.project_costs'), ('public.project_expenses'),
             ('public.project_phase_budgets'), ('public.project_revenue_schedule'),
             ('public.project_finance_settings')) o(name);

-- ─── 7) لا صلاحية anon على ما سنبني فوقه ─────────────────────────────────
-- متوقّع: false في كلّ صفّ موجود.
select f.sig, has_function_privilege('anon', f.sig, 'EXECUTE') as anon_exec
from (values ('public.is_staff()'), ('public.staff_role()'),
             ('public.emp_has_permission(uuid,text)')) f(sig)
where to_regprocedure(f.sig) is not null
  and exists (select 1 from pg_roles where rolname = 'anon');

-- ─── 8) الأعمدة المولَّدة مدعومة (PG12+) — عليها يقوم عقد الضريبة ────────
-- متوقّع: رقم إصدار ≥ 120000. أقلّ من ذلك ⇒ لا تُشغّل RUNME: الإجمالي المولَّد
-- هو ما يمنع كتابة مجموع يُخفي الضريبة، وبدونه ينهار الضمان الأساسيّ.
select current_setting('server_version_num')::int as server_version_num,
       (current_setting('server_version_num')::int >= 120000) as generated_columns_supported;

-- متوقّع: true (pg13+ يوفّرها في core).
select (to_regprocedure('pg_catalog.gen_random_uuid()') is not null
     or to_regprocedure('public.gen_random_uuid()') is not null) as gen_random_uuid_available;

-- ─── 9) من سيملك المركز يوم التشغيل — اعرفه قبل لا بعد ───────────────────
-- متوقّع: قائمة قصيرة. لو خرجت فارغة فلا أحد غير المالك سيرى المركز، وهذا
-- سلوك صحيح لا عطل: الصلاحية تُمنح بعد التشغيل من شاشة الصلاحيات.
select id, email, staff_role, account_type
from public.profiles
where account_status = 'active' and (account_type = 'admin' or staff_role in ('super_admin','finance'))
order by staff_role nulls first;

-- ─── 9-ب) ★ إعادة التشغيل بعد سقوط §9 ★ ─────────────────────────────────
-- تشغيلٌ سابق سقط **قبل COMMIT** على تأكيد §9:
--   FIN SELF-TEST: public.finops_can_manage() لا تنحدر من البوّابة الحسّاسة
-- كان التأكيد يطلب ذكرًا نصّيًّا مباشرًا لاسم البوّابة داخل جسم الدالّة، بينما
-- finops_can_manage تفوّض بقفزة (→ finops_can_manage_finance → البوّابة). فكان
-- **الفحص** معطوبًا لا الدالّة. أُبدل بمحلّل يمشي على رسم النداء (RUNME §9 20-ب).
--
-- الحزمة معاملة واحدة بلا CONCURRENTLY، فالسقوط تراجع كاملًا. أثبت ذلك قبل
-- إعادة التشغيل: شغّل docs/finance_profitability_AFTER_FAILURE_VERIFY.sql
-- (قراءة فقط · نتيجة واحدة) وتأكّد أنّ كلّ صفّ verdict = 'OK'.
-- متوقّع هنا: صفّ واحد، كلّ الأعداد = 0. أيّ رقم غير صفر ⇒ لا تُشغّل RUNME،
-- شغّل ROLLBACK أوّلًا.
select
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r','p') and c.relname like 'fin\_%') as fin_tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'finops\_%')                          as finops_functions,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'S' and c.relname = 'fin_doc_seq')       as fin_sequences,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'fin\_%') as fin_policies,
  (select count(*) from public.permissions where key like 'finance\_ops.%')             as finance_ops_keys;

-- ─── 9-ج) الحزم الثلاث المطبَّقة سليمة قبل أن نضيف الرابعة ───────────────
-- متوقّع: ثلاثة صفوف، missing = 0 وwithout_rls = 0 في كلّها.
-- قائمة صريحة لا نمط: عدّ «كم جدولًا يبدأ بـ crm_» يمرّ بعد حذف جدول وإضافة آخر.
with expected(pkg, t) as (values
  ('communications_hub','comms_audit'),('communications_hub','comms_channels'),
  ('communications_hub','comms_event_catalog'),('communications_hub','comms_outbox'),
  ('communications_hub','comms_preferences'),('communications_hub','comms_rate_counters'),
  ('communications_hub','comms_templates'),
  ('operations_center','ops_audit'),('operations_center','ops_call_sheets'),
  ('operations_center','ops_daily_reports'),('operations_center','ops_delays'),
  ('operations_center','ops_incidents'),('operations_center','ops_ingest_jobs'),
  ('operations_center','ops_job_accommodation'),('operations_center','ops_job_crew'),
  ('operations_center','ops_job_equipment'),('operations_center','ops_job_hse'),
  ('operations_center','ops_job_permits'),('operations_center','ops_job_travel'),
  ('operations_center','ops_job_vehicles'),('operations_center','ops_job_weather'),
  ('operations_center','ops_jobs'),('operations_center','ops_locations'),
  ('operations_center','ops_media_backups'),('operations_center','ops_media_cards'),
  ('operations_center','ops_post_handoff'),('operations_center','ops_vehicles'),
  ('crm_sales_foundation','crm_settings'),('crm_sales_foundation','crm_teams'),
  ('crm_sales_foundation','crm_team_members'),('crm_sales_foundation','crm_companies'),
  ('crm_sales_foundation','crm_contacts'),('crm_sales_foundation','crm_competitors'),
  ('crm_sales_foundation','crm_lead_score_rules'),('crm_sales_foundation','crm_leads'),
  ('crm_sales_foundation','crm_pipelines'),('crm_sales_foundation','crm_stages'),
  ('crm_sales_foundation','crm_opportunities'),('crm_sales_foundation','crm_stage_history'),
  ('crm_sales_foundation','crm_activities'),('crm_sales_foundation','crm_targets'),
  ('crm_sales_foundation','crm_commission_plans'),('crm_sales_foundation','crm_commission_assignments'),
  ('crm_sales_foundation','crm_commission_records'),('crm_sales_foundation','crm_import_batches'),
  ('crm_sales_foundation','crm_audit'),('crm_sales_foundation','crm_approval_requests')),
live as (
  select c.relname::text as relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p'))
select e.pkg,
       count(*)                                                            as expected_tables,
       count(*) - count(l.relname)                                         as missing,
       count(*) filter (where not coalesce(l.relrowsecurity, false))       as without_rls
from expected e left join live l on l.relname = e.t
group by e.pkg order by e.pkg;

-- ─── 10) Zoho Books: ما هو مبنيّ فعلًا اليوم (مراجعة عقد لا تشغيل) ───────
-- متوقّع: توثيقيّ بالكامل. هذه الحزمة **لا** تتصل بـZoho ولا تقرأ بيانات
-- اعتماد ولا تدّعي اتصالًا. التفاصيل في docs/ZOHO_BOOKS_INTEGRATION_CONTRACT.md.
select 'zoho_reference_columns' as label, count(*) as existing_reference_columns
from information_schema.columns
where table_schema = 'public' and column_name ilike 'zoho%';
