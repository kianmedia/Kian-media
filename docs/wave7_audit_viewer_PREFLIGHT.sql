-- WAVE 7 · V2-7.3 · PREFLIGHT — يقرأ ولا يكتب.
select 'TABLE' as kind, 'activity_log' as name,
       case when to_regclass('public.activity_log') is null then '🔴 مفقود' else '✅ موجود' end as status;
select 'GATE' as kind, 'can_manage_projects' as name,
       case when to_regprocedure('public.can_manage_projects()') is null then '🔴 مفقود' else '✅ موجود' end as status;
-- كم سجلّ تدقيق يوجد فعلًا؟ مدخل قرار W7-1.
select 'AUDIT_SOURCES' as kind, c.relname as name, '📋 قائم' as status
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and (c.relname='activity_log' or c.relname like '%audit%')
order by 2;
-- ⛔ لا سجلّ سادس عشر.
select 'PARALLEL_CHECK' as kind, v.n as name,
       case when to_regclass('public.'||v.n) is null then '✅ غير موجود' else '🔴 سجلّ إضافيّ — توقّف' end as status
from (values ('audit_viewer_log'),('unified_audit'),('audit_events')) v(n);
