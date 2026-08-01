-- ════════════════════════════════════════════════════════════════════════════
-- docs/liveops_acl_repair_PREFLIGHT.sql — رقعة صلاحيات لوحة العمليات المباشرة.
-- ✅ ملفّ SQL يُنفَّذ في محرّر SQL. قراءة فقط · جملة واحدة · بلا معاملة · بلا كتابة.
--
-- العطل: حزمة liveops أنشأت 56 دالّة ولم تسحب EXECUTE من PUBLIC عن أيّ منها.
-- وPostgreSQL يمنح PUBLIC تنفيذًا **افتراضيًّا** عند الإنشاء، وanon عضوٌ في
-- PUBLIC — فيرث تنفيذ كلّ شيء، ومنه كاتبات مثل liveops_incident_open و
-- liveops_bulletin_upsert. و«grant to authenticated» لا يُزيل الوراثة: لا
-- يُزيلها إلّا revoke صريح من PUBLIC على التوقيع نفسه.
-- ════════════════════════════════════════════════════════════════════════════
with
t as (
  select p.oid, p.proname,
         'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig,
         p.proacl is null as default_acl,
         exists (select 1 from pg_roles where rolname = 'anon')
           and has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'liveops\_%'
),
agg as (
  select count(*) as total,
         count(*) filter (where default_acl) as n_default,
         count(*) filter (where anon_can)    as n_anon,
         coalesce(string_agg(distinct proname, ', ') filter (where anon_can), '—') as anon_list
  from t
),
rows_all(sort_key, check_id, verdict, expected, detail) as (
  select 10, '1.package_installed',
         case when total > 0 then 'PASS' else 'FAIL' end,
         'liveops_* functions exist', 'count = ' || total from agg
  union all
  select 20, '2.functions_at_default_public_acl',
         case when n_default = 0 then 'PASS' else 'FAIL' end,
         '0 functions left at the default PUBLIC EXECUTE',
         'at default: ' || n_default || ' / ' || total from agg
  union all
  select 30, '3.anon_effective_execute',
         case when n_anon = 0 then 'PASS' else 'FAIL' end,
         'anon can execute nothing',
         'anon-executable: ' || n_anon || ' — ' || left(anon_list, 300) from agg
  union all
  select 40, '4.roles_present',
         case when exists (select 1 from pg_roles where rolname = 'authenticated')
              then 'PASS' else 'FAIL' end,
         'authenticated exists so the app surface can be re-granted',
         'service_role present = ' ||
           (exists (select 1 from pg_roles where rolname = 'service_role'))::text
),
verdict as (
  select case
    when not exists (select 1 from rows_all where check_id = '1.package_installed' and verdict = 'PASS')
      then 'STOP'
    when exists (select 1 from rows_all where check_id = '4.roles_present' and verdict = 'FAIL')
      then 'STOP'
    when (select n_default + n_anon from agg) = 0 then 'NOT_NEEDED'
    else 'READY' end as v
)
select check_id as "الفحص", verdict as "الحكم", expected as "المتوقّع", detail as "المرصود"
from (select * from rows_all
      union all
      select 9999, '★ VERDICT', v, 'READY | NOT_NEEDED | STOP',
             case v when 'STOP' then 'لا تُشغّل الرقعة'
                    when 'NOT_NEEDED' then 'الصلاحيات مضبوطة أصلًا — لا حاجة للرقعة'
                    else 'شغّل docs/liveops_acl_repair_RUNME.sql' end
      from verdict) z
order by sort_key;
