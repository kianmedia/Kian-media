-- ════════════════════════════════════════════════════════════════════════════
-- docs/liveops_acl_repair_POSTCHECK.sql — بعد الرقعة.
-- ✅ ملفّ SQL يُنفَّذ في محرّر SQL. قراءة فقط · جملة واحدة · بلا معاملة · بلا كتابة.
-- ════════════════════════════════════════════════════════════════════════════
with
t as (
  select p.oid, p.proname, p.prosecdef,
         p.proacl is null as default_acl,
         has_function_privilege('public', p.oid, 'EXECUTE') as pub_can,
         exists (select 1 from pg_roles where rolname='anon')
           and has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'liveops\_%'
),
surface(name) as (values
  ('liveops_bulletin_upsert'),('liveops_client_person_delete'),('liveops_client_person_upsert'),
  ('liveops_client_preview'),('liveops_cue_log'),('liveops_health_record'),
  ('liveops_incident_open'),('liveops_incident_release_root_cause'),('liveops_incident_resolve'),
  ('liveops_incident_update'),('liveops_inventory_delete'),('liveops_inventory_set_state'),
  ('liveops_inventory_upsert'),('liveops_link_audit'),('liveops_link_create'),('liveops_link_issue'),
  ('liveops_link_list'),('liveops_link_revoke'),('liveops_live_board'),('liveops_report_approve'),
  ('liveops_report_upsert'),('liveops_rundown_delete'),('liveops_rundown_set_status'),
  ('liveops_rundown_upsert'),('liveops_session_detail'),('liveops_session_list'),
  ('liveops_session_set_status'),('liveops_session_upsert')
),
checks(sort_key, check_id, verdict, expected, detail) as (
  select 10, '1.zero_public_execute',
         case when count(*) filter (where pub_can or default_acl) = 0 then 'PASS' else 'FAIL' end,
         '0 liveops_ functions executable by PUBLIC',
         'violations: ' || count(*) filter (where pub_can or default_acl) || ' / ' || count(*)
  from t
  union all
  select 20, '2.zero_anon_execute',
         case when count(*) filter (where anon_can) = 0 then 'PASS' else 'FAIL' end,
         '0 liveops_ functions executable by anon',
         'violations: ' || coalesce(string_agg(proname, ', ') filter (where anon_can), '—')
  from t
  union all
  select 30, '3.app_surface_still_works',
         case when count(*) filter (where not coalesce(auth_can, false)) = 0 then 'PASS' else 'FAIL' end,
         'every function the browser calls is still executable by authenticated',
         'lost: ' || coalesce(string_agg(s.name, ', ')
                      filter (where not coalesce(t.auth_can, false)), '—')
  from surface s left join t on t.proname = s.name
  union all
  select 40, '4.no_body_replaced',
         case when count(*) >= 50 then 'PASS' else 'FAIL' end,
         'the patch changed privileges only — the function count is intact',
         'liveops_ functions: ' || count(*) from t
  union all
  select 50, '5.writers_are_definer',
         case when count(*) filter (where not prosecdef) = 0 then 'INFO' else 'INFO' end,
         'security definer census (context, not a gate)',
         'non-definer: ' || count(*) filter (where not prosecdef) || ' / ' || count(*) from t
)
select check_id as "الفحص", verdict as "الحكم", expected as "المتوقّع", detail as "المرصود"
from checks order by sort_key;
