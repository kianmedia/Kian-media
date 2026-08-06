-- WAVE 7 · V2-7.1 · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '🟡 غائب — يُتخطّى' else '✅ موجود' end as status
from (values ('projects'),('clients'),('deliverables'),('custody_inventory_assets')) v(n);

select 'GATE' as kind, v.n as name,
       case when to_regprocedure(v.sig) is null then '🟡 غائب — المصدر يُتخطّى' else '✅ موجود' end as status
from (values ('can_access_project','public.can_access_project(uuid)'),
             ('civ_can_view_assets','public.civ_can_view_assets()'),
             ('can_manage_projects','public.can_manage_projects()')) v(n,sig);

-- ⚠️ حجم الجداول: الفهرس التعبيريّ يُبنى على كامل الجدول. اعرف الكلفة قبلها.
select 'ROW_COUNT' as kind, 'projects' as name, count(*)::text as status from public.projects;

-- ⛔ لا نظام بحث موازٍ ولا عمود tsvector مكرَّر.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 نظام بحث موازٍ' end as status
from (values ('search_index'),('search_documents'),('global_search_index')) v(n);

select 'EXISTING_TSVECTOR_COLUMNS' as kind, table_name||'.'||column_name as name, '🟡 موجود' as status
from information_schema.columns
where table_schema='public' and data_type='tsvector'
order by 2;
