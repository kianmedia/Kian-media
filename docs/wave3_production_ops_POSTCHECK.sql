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


-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الحسم — يفشل فعليًّا لا طباعةً
--
-- ★ لماذا أُضيف ★ Final Preview Sweep أعطى «11/11 PASSED» بحالة خروج 0 بينما
--   كانت السجلّات تحمل صفوفًا حمراء. والسبب أنّ هذا الملفّ كان **SELECT صِرفًا**:
--   يطبع 🔴 ثمّ ينتهي بحالة 0، فالمِكنسة تقيس خروج psql لا نتيجة الفحص.
--   ⇒ فحصٌ بلا `raise exception` **لا يحرس شيئًا**، مهما كثرت صفوفه.
--
-- ⚠️ ولا يُحوَّل تشخيصيّ إلى حاجب بلا دليل: المحسوب هنا هو **REQUIRED BLOCKER**
--    فقط (وجود الكائنات · RLS · تسريب صلاحية · نظام موازٍ). وما يعتمد على
--    البيانات أو على حزمة اختيارية يبقى مطبوعًا خارج الحسم.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ════════════════════════════════════════════════════════════════════════════
do $verdict$
declare v_fail text[] := '{}'; v_o text;
begin
  if (select count(*) from information_schema.role_table_grants
       where table_schema='public' and grantee::text in ('anon','PUBLIC')
         and table_name::text in ('ops_call_sheets','ops_job_weather')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية جدول لـanon/PUBLIC');
  end if;
  -- ⚠️ الأسماء من الفحص التشخيصيّ في هذا الملفّ نفسه ومن RUNME، لا من التخمين:
  --    الحزمة **تمدّد** ops_call_sheets وops_job_weather ولا تُنشئ جدولًا.
  foreach v_o in array array['call_sheets','locations','crew_members',
                             'crew_assignments','crew_documents'] loop
    if to_regclass('public.'||v_o) is not null then
      v_fail := array_append(v_fail, 'نظام موازٍ '||v_o);
    end if;
  end loop;

  -- 🔴 REQUIRED BLOCKER: تنفيذ الدالّة الوحيدة لـanon/PUBLIC.
  if (select count(*) from information_schema.role_routine_grants
       where routine_schema='public' and routine_name::text='prodops_weather_record'
         and grantee::text in ('anon','PUBLIC')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية تنفيذ لـanon/PUBLIC على prodops_weather_record');
  end if;
  if to_regprocedure('public.prodops_weather_record(uuid,date,jsonb,text)') is null
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='public' and p.proname='prodops_weather_record') then
    v_fail := array_append(v_fail, 'prodops_weather_record مفقودة');
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 3 PRODUCTION OPS POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 3 PRODUCTION OPS POSTCHECK PASSED.';
end $verdict$;
