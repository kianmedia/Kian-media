-- ════════════════════════════════════════════════════════════════════════════
-- docs/final_platform_acceptance_PREFLIGHT.sql
--
-- قبول المنصّة النهائيّ — الفحص القبْليّ.
-- Final platform acceptance — PREFLIGHT.
--
-- ✅ هذا ملفّ SQL: يُنفَّذ في محرّر SQL.  (‎.md‎ = يُقرأ فقط ولا يُنسخ هنا)
--
-- عقد هذا الملفّ:
--   • قراءة فقط · جملة واحدة · مجموعة نتائج واحدة.
--   • بلا BEGIN/COMMIT · بلا كتابة · بلا اتّصال خارجيّ.
--   • لا ينشئ مستخدمًا ولا مشروعًا ولا بيانات اختبار.
--   • لا ينادي أيّ RPC محميّة نداءً حيًّا: محرّر SQL يعمل بدور postgres
--     وauth.uid() فيه NULL، فنتيجةُ أيّ نداء محميّ هناك بلا معنى.
--   • لا يعرض بريدًا ولا جوّالًا ولا أيّ بيانات شخصيّة: أعدادٌ فقط، وبادئة
--     UUID من ثمانية محارف عند الحاجة إلى تمييز حساب.
--
-- الحكم النهائيّ في الصفّ الأخير، وهو أحد ثلاثة:
--   READY                      — يجوز الانتقال إلى RUNME.
--   READY_WITH_MANUAL_STEPS    — البنية سليمة لكن حسابًا مطلوبًا ناقص أو بندًا
--                                لا يُثبَت إلّا في المتصفّح.
--   STOP                       — كائن مطلوب مفقود أو صلاحية غير آمنة.
-- ولا يظهر READY إذا نقص أيٌّ من حسابات الاختبار الثلاثة.
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── الأدوار ────────────────────────────────────────────────────────────────
t_roles as (
  select
    exists (select 1 from pg_roles where rolname = 'anon')          as has_anon,
    exists (select 1 from pg_roles where rolname = 'authenticated') as has_authenticated,
    exists (select 1 from pg_roles where rolname = 'service_role')  as has_service_role
),

-- ─── حسابات الاختبار — أعداد فقط، بلا أيّ حقل شخصيّ ────────────────────────
--   المالك   = account_type='admin' أو staff_role='super_admin' (نشط)
--   موظّف غير مالك = staff_role غير فارغ وليس super_admin ولا admin (نشط)
--   عميل     = نشط، بلا staff_role، وaccount_type ليس admin
t_accounts as (
  select
    count(*) filter (where p.account_status = 'active'
                       and (p.account_type = 'admin' or p.staff_role = 'super_admin'))   as n_owner,
    count(*) filter (where p.account_status = 'active'
                       and p.staff_role is not null and p.staff_role <> 'super_admin'
                       and coalesce(p.account_type, '') <> 'admin')                      as n_staff_non_owner,
    count(*) filter (where p.account_status = 'active'
                       and p.staff_role is null
                       and coalesce(p.account_type, '') <> 'admin')                      as n_client,
    -- بادئة UUID لحساب مالك واحد: تمييزٌ بلا كشف. لا بريد ولا اسم ولا جوّال.
    coalesce((select left(p2.id::text, 8) from public.profiles p2
               where p2.account_status = 'active'
                 and (p2.account_type = 'admin' or p2.staff_role = 'super_admin')
               order by p2.id limit 1), '—')                                             as owner_uuid8
  from public.profiles p
),

-- ─── الدوالّ والجداول اللازمة ───────────────────────────────────────────────
t_objects as (
  select
    count(*) filter (where obj is null)                       as n_missing,
    coalesce(string_agg(name, ', ') filter (where obj is null), '—') as detail
  from (
    select name, to_regprocedure(name) as obj from (values
      ('public.is_staff()'), ('public.is_owner()'), ('public.is_admin()'),
      ('public.mgmt_can_view()'), ('public.mgmt_can_view_sensitive()'),
      ('public.mgmt_can_export()'), ('public.mgmt_is_client()'),
      ('public.mgmt_revenue_basis(date,date)'), ('public.mgmt_dashboard(jsonb,boolean)'),
      ('public.mgmt_export(text,jsonb)'), ('public.mgmt_sources()')
    ) as f(name)
  ) x
),
t_tables as (
  select
    count(*) filter (where rel is null)                       as n_missing,
    coalesce(string_agg(name, ', ') filter (where rel is null), '—') as detail
  from (
    select name, to_regclass(name) as rel from (values
      ('public.profiles'), ('public.mgmt_report_cache'), ('public.mgmt_audit'),
      ('public.ai_settings')
    ) as t(name)
  ) x
),

-- ─── الحزم الأربع عشرة قائمة ────────────────────────────────────────────────
t_packages as (
  select count(*) as n_missing,
         coalesce(string_agg(x.pkg, ' · ' order by x.pkg), '—') as detail
  from (values
      ('communications_hub','comms\_%'), ('operations_center','ops\_%'),
      ('crm_sales','crm\_%'), ('finance_profitability','fin\_%'),
      ('commercial_subscriptions','csub\_%'), ('smart_quoting','sq\_%'),
      ('lead_scoring_routing','lsr\_%'), ('asset_intelligence','custody\_inventory\_%'),
      ('talent_vendor_network','tvn\_%'), ('vendor_compliance_center','vcc\_%'),
      ('case_studies_platform','cs\_%'), ('live_operations_dashboard','liveops\_%'),
      ('kian_ai_assistant','ai\_%'), ('executive_reporting','mgmt\_%')
    ) as x(pkg, pre)
  where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relkind in ('r','p')
                       and c.relname like x.pre escape '\')
),

-- ─── لا صلاحية تنفيذ لـanon ولا لـPUBLIC على أسطح الحزم الأربع ─────────────
--   anon عضوٌ في PUBLIC، فمنحُ authenticated لا يُلغي الوراثة: يُقاس الأثر
--   الفعليّ بـhas_function_privilege لا بقراءة المنح المباشرة.
t_acl as (
  select count(*) as n,
         coalesce(string_agg(distinct p.proname, ', '), '—') as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'mgmt\_%' or p.proname like 'cs\_%'
      or p.proname like 'liveops\_%' or p.proname like 'ai\_%')
    and exists (select 1 from pg_roles where rolname = 'anon')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
),
t_acl_public as (
  select count(*) as n,
         coalesce(string_agg(distinct p.proname, ', '), '—') as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname like 'mgmt\_%' or p.proname like 'cs\_%'
      or p.proname like 'liveops\_%' or p.proname like 'ai\_%')
    and p.proacl is null                    -- NULL = الافتراضيّ = PUBLIC يملك EXECUTE
),

-- ─── المزوّد الخارجيّ معطَّل: القبول لا يجوز أن يوقظ مزوّدًا ────────────────
t_provider as (
  select coalesce((select bool_or(provider_enabled) from public.ai_settings), false) as enabled
),

-- ─── لا حاجة إلى بيانات دائمة لتنفيذ القبول ────────────────────────────────
--   القبول يقرأ ويحاكي جلسة داخل معاملة تُلغى، فلا ينشئ صفًّا.
t_no_seed_needed as (
  select (select n_owner from t_accounts) > 0
     and (select n_client from t_accounts) > 0 as ok
),

rows_all(sort_key, check_id, verdict, expected, detail) as (
  select 10, '1.roles_present',
         case when has_anon and has_authenticated then 'PASS' else 'FAIL' end,
         'anon + authenticated roles exist',
         'anon=' || has_anon || ' authenticated=' || has_authenticated
           || ' service_role=' || has_service_role
  from t_roles
  union all
  select 20, '2.owner_account_available',
         case when n_owner > 0 then 'PASS' else 'FAIL' end,
         'at least one active owner account',
         'count=' || n_owner || ' sample_uuid8=' || owner_uuid8 from t_accounts
  union all
  select 21, '3.non_owner_staff_available',
         case when n_staff_non_owner > 0 then 'PASS' else 'FAIL' end,
         'at least one active non-owner staff account',
         'count=' || n_staff_non_owner from t_accounts
  union all
  select 22, '4.client_account_available',
         case when n_client > 0 then 'PASS' else 'FAIL' end,
         'at least one active client account',
         'count=' || n_client from t_accounts
  union all
  select 30, '5.required_functions',
         case when n_missing = 0 then 'PASS' else 'FAIL' end,
         'every gate/report function exists',
         'missing: ' || detail from t_objects
  union all
  select 31, '6.required_tables',
         case when n_missing = 0 then 'PASS' else 'FAIL' end,
         'profiles + mgmt_report_cache + mgmt_audit + ai_settings exist',
         'missing: ' || detail from t_tables
  union all
  select 40, '7.all_14_packages_installed',
         case when n_missing = 0 then 'PASS' else 'FAIL' end,
         'all 14 packages present',
         case when n_missing = 0 then 'كلّها قائمة' else 'ناقصة: ' || detail end
  from t_packages
  union all
  select 50, '8.no_anon_execute',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 anon-executable functions across mgmt_/cs_/liveops_/ai_',
         'violations: ' || detail from t_acl
  union all
  select 51, '9.no_default_public_acl',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 functions left at the default PUBLIC EXECUTE (proacl is null)',
         'violations: ' || detail from t_acl_public
  union all
  select 60, '10.ai_provider_disabled',
         case when enabled then 'FAIL' else 'PASS' end,
         'external AI provider stays disabled during acceptance',
         'provider_enabled=' || enabled from t_provider
  union all
  select 70, '11.acceptance_needs_no_seed_data',
         case when ok then 'PASS' else 'INFO' end,
         'acceptance runs read-only against existing accounts; it creates nothing',
         'no user, project, or test row is created by this package'
  from t_no_seed_needed
  union all
  select 80, '12.session_behaviour_not_provable_here',
         'INFO',
         'the SQL editor runs as postgres with auth.uid() = NULL',
         'browser acceptance is listed in docs/FINAL_PLATFORM_ACCEPTANCE_MANUAL.md '
           || '(a Markdown file — read it, never paste it into this editor)'
),

verdict as (
  select
    case
      when exists (select 1 from rows_all where verdict = 'FAIL'
                     and check_id in ('1.roles_present','5.required_functions','6.required_tables',
                                      '7.all_14_packages_installed','8.no_anon_execute',
                                      '9.no_default_public_acl','10.ai_provider_disabled'))
        then 'STOP'
      when exists (select 1 from rows_all where verdict = 'FAIL')
        then 'READY_WITH_MANUAL_STEPS'
      else 'READY'
    end as v
),

final_row(sort_key, check_id, verdict, expected, detail) as (
  select 9999, '★ VERDICT', v,
         'READY | READY_WITH_MANUAL_STEPS | STOP',
         case v
           when 'STOP' then 'مطلوبٌ مفقود أو صلاحية غير آمنة — لا تُشغّل RUNME قبل إصلاحه'
           when 'READY_WITH_MANUAL_STEPS' then
             'البنية سليمة، لكنّ حساب اختبار ناقص: RUNME سيمرّ، والبنود المعتمِدة على '
             || 'ذلك الدور ستُعلَن MANUAL_REQUIRED ولن تُحسب نجاحًا'
           else 'الحسابات الثلاثة موجودة والبنية سليمة — انتقل إلى '
             || 'docs/final_platform_acceptance_RUNME.sql'
         end
  from verdict
)

select check_id as "الفحص", verdict as "الحكم", expected as "المتوقّع", detail as "المرصود"
from (select * from rows_all union all select * from final_row) z
order by sort_key;
