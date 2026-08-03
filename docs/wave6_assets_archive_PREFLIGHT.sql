-- WAVE 6 · assets_archive · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('custody_inventory_assets'),('asset_insurance_policies'),('projects'),
             ('ai_knowledge_sources'),('ai_source_revisions'),('project_task_checklists'),
             ('ops_job_hse'),('ops_incidents'),('custody_incidents'),('project_archives')) v(n);

select 'GATE' as kind, v.n as name,
       case when to_regproc(v.sig) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('civ_can_view_assets','public.civ_can_view_assets()'),
             ('can_manage_projects','public.can_manage_projects()'),
             ('prodops_can_view','public.prodops_can_view()')) v(n,sig);

-- 🔴 نوع الإجراء التشغيليّ يجب أن يكون مقبولًا في القيد القائم — وإلّا فُشل الإدراج.
select 'SOP_TYPE_ALLOWED' as kind, 'operations_procedure' as name,
       case when pg_get_constraintdef(oid) like '%operations_procedure%'
            then '✅ مقبول — لا توسعة قيد' else '🔴 غير مقبول — راجع القيد' end as status
from pg_constraint where conname = 'ai_sources_type_known';

-- ⛔ لا نظام موازٍ. وجود أيّ منها يعني ازدواجًا يجب حسمه قبل التطبيق.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 نظام موازٍ — توقّف' end as status
from (values ('sops'),('knowledge_articles'),('hse_incidents'),('equipment_usage_log'),
             ('maintenance_schedule'),('compliance_registry'),('assets')) v(n);
