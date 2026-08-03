-- WAVE 6 · compliance_knowledge · POSTCHECK — قراءة فقط.
select '🔴 سجلّ HSE **عرض** لا جدول' as check,
       case when (select count(*) from pg_views where schemaname='public' and viewname='hse_register_v')=1
             and (select count(*) from pg_tables where schemaname='public' and tablename like 'hse_%')=0
            then '✅ مشتقّ' else '🔴 سجلّ حوادث رابع' end as result;

select 'العرض يقرأ المصادر الثلاثة' as check,
       case when definition like '%ops_job_hse%' and definition like '%ops_incidents%'
             and definition like '%custody_incidents%' then '✅ 3/3' else '🔴 مصدر ناقص' end as result
from pg_views where schemaname='public' and viewname='hse_register_v';

select '⛔ لا جدول إجراءات موازٍ' as check,
       case when to_regclass('public.sops') is null then '✅ الوثيقة في ai_knowledge_sources'
            else '🔴 قاعدة معرفة ثانية' end as result;

select 'sop_items + RLS' as check,
       case when bool_and(c.relrowsecurity) then '✅' else '🔴 RLS مطفأ' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='sop_items';

select 'الدوالّ الأربع' as check,
       case when count(*)=4 then '✅ 4/4' else '🔴 '||count(*)::text||'/4' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('sop_attach_to_task','sop_list','sop_items_list','hse_register_list');

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public' and table_name in ('sop_items','hse_register_v') and grantee in ('anon','PUBLIC');

select 'sop_items فارغ (لا إجراء مخترع)' as check,
       case when (select count(*) from public.sop_items)=0 then '✅'
            else '🟡 فيه صفوف — تحقّق أنّها بذور تطوير موسومة' end as result;
