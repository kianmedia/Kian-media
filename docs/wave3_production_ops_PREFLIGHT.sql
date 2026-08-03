-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · PREFLIGHT — يقرأ ولا يكتب. شغّله أولًا واقرأ المخرجات.
--
-- الغرض: إثبات أنّ ما تفترضه الحزمة قائم فعلًا قبل أن تكتب حرفًا.
-- ⛔ لا CREATE ولا ALTER ولا INSERT هنا. آمن على Production.
-- ════════════════════════════════════════════════════════════════════════════

-- ١. الجداول التي تفترضها الحزمة (المصدر المعتمد بعد حسم D-1/D-3).
select 'TABLE' as kind, t.tablename as name,
       case when t.tablename is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('ops_call_sheets'),('ops_job_weather'),('ops_jobs'),('ops_locations')) v(n)
left join pg_tables t on t.schemaname = 'public' and t.tablename = v.n
order by 2;

-- ٢. الأعمدة التي ستُضاف — يجب أن تكون **غائبة** أو مطابقة.
select 'COLUMN' as kind, c.table_name || '.' || c.column_name as name, c.data_type
from information_schema.columns c
where c.table_schema = 'public'
  and (   (c.table_name = 'ops_call_sheets' and c.column_name in ('backup_date','is_drone_day'))
       or (c.table_name = 'ops_job_weather' and c.column_name in ('wind_gust_kph','fetched_at','source')))
order by 2;

-- ٣. 🔴 الأهم: قيد `source` الحالي على ops_job_weather.
--    الحزمة توسّعه ليقبل 'open_meteo'. اقرأ النصّ الحالي قبل الاستبدال.
select 'CHECK' as kind, con.conname as name, pg_get_constraintdef(con.oid) as definition
from pg_constraint con
join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname = 'public' and rel.relname = 'ops_job_weather' and con.contype = 'c';

-- ٤. بوّابة الصلاحية التي ستُستعمل كما هي — لا تُعاد كتابتها.
select 'FUNCTION' as kind, p.proname as name, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('prodops_can_view','prodops_can_manage')
order by 2;

-- ٥. صفوف قائمة في الجدولين المُجمَّدين — مدخل قرار W3-1 (لا يُحذف شيء هنا).
select 'FROZEN_ROWS' as kind, 'project_call_sheets' as name, count(*)::text as definition
from public.project_call_sheets where is_deleted = false
union all
select 'FROZEN_ROWS', 'project_locations', count(*)::text
from public.project_locations where is_deleted = false;
