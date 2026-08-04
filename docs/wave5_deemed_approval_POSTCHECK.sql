-- WAVE 5 · deemed_approval · POSTCHECK — قراءة فقط. كل سطر يجب أن يقول ✅.
select 'الجدولان + RLS' as check,
       case when count(*) filter (where c.relrowsecurity)=2 then '✅ 2/2' else '🔴 RLS ناقص' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('deemed_approval_config','deemed_approval_notices');

select '🔴 التفعيل يوجب عقدًا موقَّعًا ومهلة وسريانًا' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود — تفعيل بلا عقد ممكن' end as result
from pg_constraint where conname='deemed_requires_contract';

select '🔴 الإشعار الناجح يوجب دليلًا ووقتًا' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود' end as result
from pg_constraint where conname='deemed_notice_delivered_pair';

select '⛔ لا تفعيل عامّ' as check,
       case when count(*)=0 then '✅ لا عمود على مستوى النظام' else '🔴 تفعيل عامّ ممكن' end as result
from information_schema.columns
where table_schema='public' and table_name='deemed_approval_config' and column_name in ('global_enabled','all_projects');

select '⛔ لا سجلّ تدقيق ثانٍ' as check,
       case when count(*)=0 then '✅ يُكتب في activity_log القائم' else '🔴 سجلّ موازٍ' end as result
from pg_tables where schemaname='public' and tablename like 'deemed%audit%';

select 'كل الصفوف معطَّلة افتراضًا' as check,
       case when count(*) filter (where enabled) = 0 then '✅ لا مشروع مفعَّل'
            else '🟡 '||count(*) filter (where enabled)::text||' مشروع مفعَّل — تحقّق من عقودها' end as result
from public.deemed_approval_config;

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public' and table_name like 'deemed_approval%' and grantee in ('anon','PUBLIC');
