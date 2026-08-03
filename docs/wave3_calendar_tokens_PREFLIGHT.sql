-- WAVE 3 · V2-3.6 · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.' || v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('ops_jobs'),('ops_job_crew'),('ops_locations'),('ops_calendar_tokens')) v(n);

-- pgcrypto مطلوب لـgen_random_bytes/digest. غيابه يُفشل §3 كاملة.
select 'EXTENSION' as kind, 'pgcrypto' as name,
       case when count(*) = 0 then '🔴 مفقود — الإصدار سيفشل' else '✅ موجود' end as status
from pg_extension where extname = 'pgcrypto';

select 'FUNCTION' as kind, p.proname as name, '✅ موجود' as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('prodops_can_view','prodops_can_manage');

-- 🔴 الأهم: ماذا يملك anon اليوم؟ خطّ الأساس قبل أن نمنحه دالّة واحدة.
select 'ANON_GRANTS' as kind, routine_name as name, privilege_type as status
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee = 'anon' and routine_name like 'prodops%';
