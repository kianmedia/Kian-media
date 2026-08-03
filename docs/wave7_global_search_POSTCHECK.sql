-- WAVE 7 · V2-7.1 · POSTCHECK — قراءة فقط.
select 'دوالّ التطبيع والبحث' as check,
       case when count(*)=4 then '✅ 4/4' else '🔴 '||count(*)::text||'/4' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('search_norm','search_vector','search_query','global_search');

select 'الفهارس التعبيرية' as check,
       case when count(*) >= 1 then '✅ '||count(*)::text else '🔴 لا فهارس' end as result
from pg_indexes where schemaname='public' and indexname like '%_fts_idx';

-- 🔴 لا شيء لـanon: البحث يكشف وجود سجلّات.
select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(routine_name,', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee in ('anon','PUBLIC')
  and routine_name in ('global_search','search_norm','search_vector','search_query');

-- ⛔ ولا جدول بحث مكرَّر للبيانات.
select '⛔ لا فهرس بيانات موازٍ' as check,
       case when to_regclass('public.search_index') is null then '✅ فهارس تعبيرية فقط'
            else '🔴 نسخة ثانية من البيانات' end as result;

-- التطبيع يعمل فعليًّا (قراءة بحتة).
select 'التطبيع العربيّ' as check,
       case when public.search_norm('إنتاج') = public.search_norm('انتاج')
            then '✅ الألف موحَّدة' else '🔴 التطبيع لا يعمل' end as result;
