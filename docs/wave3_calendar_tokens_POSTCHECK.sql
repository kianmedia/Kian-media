-- WAVE 3 · V2-3.6 · POSTCHECK — يقرأ ولا يكتب. كل سطر يجب أن يقول ✅.
select 'الجدول + RLS' as check,
       case when c.relrowsecurity then '✅ RLS مفعّل' else '🔴 RLS مطفأ' end as result
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'ops_calendar_tokens';

select 'قيد شكل البصمة' as check,
       case when count(*) >= 1 then '✅' else '🔴 مفقود — بصمة بأيّ شكل تُقبل' end as result
from pg_constraint con join pg_class r on r.oid = con.conrelid
where r.relname = 'ops_calendar_tokens' and pg_get_constraintdef(con.oid) like '%[0-9a-f]{64}%';

select 'الدوالّ الثلاث' as check,
       case when count(*) = 3 then '✅ 3/3' else '🔴 ' || count(*)::text || '/3' end as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('prodops_calendar_token_issue','prodops_calendar_token_revoke','prodops_calendar_feed');

-- 🔴 الفحص الأمنيّ الحاسم: anon يملك التغذية **وحدها**.
select 'anon يملك prodops_calendar_feed فقط' as check,
       case when array_agg(routine_name order by routine_name) = array['prodops_calendar_feed']
            then '✅' else '🔴 ' || array_to_string(array_agg(routine_name order by routine_name), ', ') end as result
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee = 'anon' and routine_name like 'prodops_calendar%';

select 'لا صلاحية جدول لـanon' as check,
       case when count(*) = 0 then '✅' else '🔴 صلاحية مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ops_calendar_tokens' and grantee in ('anon','PUBLIC');
