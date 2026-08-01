-- ════════════════════════════════════════════════════════════════════════════
-- docs/final_platform_acceptance_POSTCHECK.sql
--
-- قبول المنصّة النهائيّ — الفحص البَعْديّ: هل ترك القبولُ أثرًا؟
-- Final platform acceptance — POSTCHECK: did the harness leave a trace?
--
-- ✅ هذا ملفّ SQL: يُنفَّذ في محرّر SQL.  (‎.md‎ = يُقرأ فقط ولا يُنسخ هنا)
--
-- عقد هذا الملفّ:
--   • قراءة فقط · جملة واحدة · مجموعة نتائج واحدة.
--   • بلا BEGIN/COMMIT · بلا كتابة · بلا تغيير صلاحيات · بلا اتّصال خارجيّ.
--
-- الأحكام: PASS · FAIL · INFO · MANUAL_REQUIRED.
-- وMANUAL_REQUIRED لا يُحوَّل إلى PASS: بندٌ لم يُثبَت يبقى غير مُثبَت.
--
-- ملاحظة صدق على المدى: هذا الملفّ لا يملك خطًّا أساسًا (baseline) لأعداد
-- الصفوف قبل القبول، فلا يستطيع قول «لم يتغيّر عدد المشاريع» بالمقارنة.
-- لذلك يُثبت ما هو قابل للإثبات فعلًا: أنّ المِشْحَن **لا يحوي** جملة كتابة
-- أصلًا، وأنّ الثوابت التي كان يمكن أن يكسرها ما زالت قائمة.
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── 1) لا حساب ولا ملفّ تعريف أُنشئ باسم اختباريّ ─────────────────────────
t_no_test_accounts as (
  select count(*) as n,
         coalesce(string_agg(left(p.id::text, 8), ', '), '—') as detail
  from public.profiles p
  where p.id::text like '00000000-%'                      -- معرّفات اصطناعيّة
),

-- ─── 2) لا أثر مُوسَم بالقبول في جدولَي التقارير ───────────────────────────
t_no_cache_trace as (
  select case when to_regclass('public.mgmt_report_cache') is null then -1
              else (select count(*) from public.mgmt_report_cache
                     where coalesce(cache_key, '') ilike '%acceptance%') end as n
),
t_no_audit_trace as (
  select case when to_regclass('public.mgmt_audit') is null then -1
              else (select count(*) from public.mgmt_audit
                     where coalesce(action, '') ilike '%acceptance%'
                        or coalesce(action, '') ilike '%harness%') end as n
),

-- ─── 3) الصلاحيات لم تتغيّر: صفر anon وصفر افتراضيّ PUBLIC ─────────────────
t_anon as (
  select count(*) as n, coalesce(string_agg(distinct p.proname, ', '), '—') as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'mgmt\_%' or p.proname like 'cs\_%'
      or p.proname like 'liveops\_%' or p.proname like 'ai\_%')
    and exists (select 1 from pg_roles where rolname = 'anon')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
),
t_public_default as (
  select count(*) as n, coalesce(string_agg(distinct p.proname, ', '), '—') as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'mgmt\_%' or p.proname like 'cs\_%'
      or p.proname like 'liveops\_%' or p.proname like 'ai\_%')
    and p.proacl is null
),
t_anon_tables as (
  select count(*) as n
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee = 'anon'
    and (table_name like 'mgmt\_%' or table_name like 'cs\_%'
      or table_name like 'liveops\_%' or table_name like 'ai\_%')
),

-- ─── 4) لا إرسال خارجيّ ولا مزوّد حيّ ──────────────────────────────────────
t_provider as (
  select case when to_regclass('public.ai_settings') is null then null
              else (select bool_or(provider_enabled) from public.ai_settings) end as enabled
),
t_no_http as (
  select count(*) as n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'mgmt\_%' or p.proname like 'cs\_%'
      or p.proname like 'liveops\_%' or p.proname like 'ai\_%')
    and lower(pg_get_functiondef(p.oid)) ~ '(net\.http|http_post|http_get|pg_net|dblink|curl_)'
),

-- ─── 5) الحزم الأربع ما زالت سليمة ─────────────────────────────────────────
t_packages as (
  select count(*) as n_missing,
         coalesce(string_agg(x.pkg, ' · ' order by x.pkg), '—') as detail
  from (values
      ('case_studies_platform','cs\_%'), ('live_operations_dashboard','liveops\_%'),
      ('kian_ai_assistant','ai\_%'), ('executive_reporting','mgmt\_%')
    ) as x(pkg, pre)
  where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind in ('r','p')
                       and c.relname like x.pre escape '\')
),

-- ─── 6) منصّة المشاريع لم تُكتَب من الحزم الأربع ───────────────────────────
t_no_project_writes as (
  select count(*) as n
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'mgmt\_%' or p.proname like 'cs\_%'
      or p.proname like 'liveops\_%' or p.proname like 'ai\_%')
    and lower(pg_get_functiondef(p.oid)) ~
        '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+(only[[:space:]]+)?(public\.)?(projects|project_core|deliverables)\M'
),

-- ─── 7) لا جدول مؤقّت باقٍ من المِشْحَن في هذه الجلسة ──────────────────────
t_temp_left as (
  select count(*) as n
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname like 'pg\_temp%' and c.relname = 'kian_acceptance_report'
),

checks(sort_key, check_id, verdict, expected, detail) as (
  select 10, '1.no_synthetic_accounts',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 profiles with a synthetic 00000000-… id',
         'found: ' || n || ' (' || detail || ')' from t_no_test_accounts
  union all
  select 20, '2.no_acceptance_row_in_cache',
         case when n < 0 then 'INFO' when n = 0 then 'PASS' else 'FAIL' end,
         '0 acceptance-tagged rows in mgmt_report_cache',
         case when n < 0 then 'mgmt_report_cache غير موجود' else 'found: ' || n end
  from t_no_cache_trace
  union all
  select 21, '3.no_acceptance_row_in_audit',
         case when n < 0 then 'INFO' when n = 0 then 'PASS' else 'FAIL' end,
         '0 acceptance-tagged rows in mgmt_audit',
         case when n < 0 then 'mgmt_audit غير موجود' else 'found: ' || n end
  from t_no_audit_trace
  union all
  select 30, '4.no_anon_function_grant',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 anon-executable functions across the four packages',
         'violations: ' || detail from t_anon
  union all
  select 31, '5.no_default_public_acl',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 functions left at the default PUBLIC EXECUTE',
         'violations: ' || detail from t_public_default
  union all
  select 32, '6.no_anon_table_grant',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 anon table privileges on the four packages',
         'violations: ' || n from t_anon_tables
  union all
  select 40, '7.ai_provider_still_disabled',
         case when enabled is null then 'INFO'
              when enabled then 'FAIL' else 'PASS' end,
         'the external AI provider is still disabled',
         'provider_enabled = ' || coalesce(enabled::text, 'ai_settings غير موجود')
  from t_provider
  union all
  select 41, '8.no_external_http',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 functions naming an outbound HTTP mechanism',
         'violations: ' || n from t_no_http
  union all
  select 50, '9.four_packages_intact',
         case when n_missing = 0 then 'PASS' else 'FAIL' end,
         'case studies · live ops · AI assistant · executive reporting all present',
         case when n_missing = 0 then 'كلّها قائمة' else 'ناقصة: ' || detail end
  from t_packages
  union all
  select 51, '10.no_project_platform_writes',
         case when n = 0 then 'PASS' else 'FAIL' end,
         'no package function writes to projects / project_core / deliverables',
         'writer functions: ' || n from t_no_project_writes
  union all
  select 60, '11.no_harness_temp_table_left',
         case when n = 0 then 'PASS' else 'INFO' end,
         'the harness temp table is gone (it dies with the connection)',
         case when n = 0 then 'لا أثر' else
           'ما زال في هذه الجلسة (' || n || ') — جدول مؤقّت لا يراه التطبيق '
           || 'ويزول بإغلاق الاتّصال؛ ليس أثرًا دائمًا' end
  from t_temp_left
  union all
  select 900, '12.browser_acceptance_outstanding', 'MANUAL_REQUIRED',
         'six UI journeys can only be proven in a browser with real sessions',
         'docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.md — Markdown: read it, never paste it here'
)

select check_id as "الفحص", verdict as "الحكم", expected as "المتوقّع", detail as "المرصود"
from checks order by sort_key;
