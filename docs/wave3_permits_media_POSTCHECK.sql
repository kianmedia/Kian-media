-- WAVE 3 · إغلاق · POSTCHECK — يقرأ ولا يكتب. كل سطر يجب أن يقول ✅.
select 'الجدولان + RLS' as check,
       case when count(*) filter (where c.relrowsecurity) = 2
            then '✅ 2/2 مع RLS' else '🔴 RLS ناقص' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('ops_permits','ops_media');

select 'الدوالّ السبع' as check,
       case when count(*)=7 then '✅ 7/7' else '🔴 '||count(*)::text||'/7' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('prodops_permit_upsert','prodops_permit_delete','prodops_permits_list',
   'prodops_media_attach','prodops_media_delete','prodops_media_list','prodops_permit_alerts_run');

select 'الربط على الجدول القائم' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود' end as result
from information_schema.columns
where table_schema='public' and table_name='ops_job_permits' and column_name='registry_permit_id';

-- 🔴 الفحص الأمنيّ: لا شيء لـanon، ومحرّك التنبيهات لمفتاح الخدمة وحده.
select 'لا صلاحية دوالّ لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(routine_name,', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee in ('anon','PUBLIC') and routine_name like 'prodops_%';

select 'محرّك التنبيهات لـservice_role فقط' as check,
       case when array_agg(distinct grantee) = array['service_role'] then '✅'
            else '🔴 '||array_to_string(array_agg(distinct grantee),', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and routine_name='prodops_permit_alerts_run';

select 'لا صلاحية جدول لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 صلاحية مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public' and table_name in ('ops_permits','ops_media') and grantee in ('anon','PUBLIC');

-- ⛔ والجدولان يُنشآن فارغين: لا بيانات مخترعة.
select 'الجدولان فارغان (لا بيانات مخترعة)' as check,
       case when (select count(*) from public.ops_permits) = 0
             and (select count(*) from public.ops_media)   = 0
            then '✅ فارغان' else '🟡 فيهما صفوف — تحقّق من مصدرها' end as result;
