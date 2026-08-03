-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · POSTCHECK — يقرأ ولا يكتب. شغّله بعد RUNME.
-- كل سطر يجب أن يقول ✅. أيّ 🔴 يعني أن RUNME لم يكتمل.
-- ════════════════════════════════════════════════════════════════════════════

select 'الأعمدة المضافة' as check,
       case when count(*) = 6 then '✅ 6/6' else '🔴 ' || count(*)::text || '/6' end as result
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'ops_call_sheets' and column_name in ('backup_date','is_drone_day'))
    or (table_name = 'ops_job_weather' and column_name in ('wind_gust_kph','fetched_at','for_lat','for_lng')));

select 'قيد source يقبل open_meteo' as check,
       case when pg_get_constraintdef(oid) like '%open_meteo%' then '✅' else '🔴' end as result
from pg_constraint where conname = 'ops_job_weather_source_check';

select 'قيد التاريخ البديل' as check,
       case when count(*) = 1 then '✅' else '🔴 مفقود' end as result
from pg_constraint where conname = 'ops_call_sheets_backup_after_sheet';

select 'الفهرس' as check,
       case when count(*) = 1 then '✅' else '🔴 مفقود' end as result
from pg_indexes where schemaname = 'public' and indexname = 'ops_job_weather_job_date_idx';

select 'الدالّة موجودة وبالبادئة المعتمدة' as check,
       case when count(*) = 1 then '✅' else '🔴' end as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_weather_record';

-- 🔴 الأهم أمنيًّا: لا anon ولا public يملك التنفيذ.
select 'لا صلاحية لـanon/public' as check,
       case when count(*) = 0 then '✅' else '🔴 صلاحية مسرَّبة' end as result
from information_schema.role_routine_grants
where routine_schema = 'public' and routine_name = 'prodops_weather_record'
  and grantee in ('anon','PUBLIC');

-- ⛔ ولا جدول ثالث للأوراق ولا رابع للمواقع.
select 'لا جداول موازية جديدة' as check,
       case when count(*) = 0 then '✅' else '🔴 ' || string_agg(tablename, ', ') end as result
from pg_tables where schemaname = 'public'
  and tablename in ('call_sheets','locations','crew_members','crew_assignments','crew_documents');
