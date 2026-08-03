-- WAVE 7 · V2-7.3 · POSTCHECK — قراءة فقط.
select 'الدالّتان' as check,
       case when count(*)=2 then '✅ 2/2' else '🔴 '||count(*)::text||'/2' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('audit_viewer_list','audit_sources_registry');

-- 🔴 لا سجلّ سادس عشر أُنشئ.
select '⛔ لا سجلّ تدقيق جديد' as check,
       case when to_regclass('public.audit_viewer_log') is null
             and to_regclass('public.unified_audit') is null
            then '✅ قراءة فقط' else '🔴 سجلّ إضافيّ' end as result;

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee in ('anon','PUBLIC')
  and routine_name in ('audit_viewer_list','audit_sources_registry');
