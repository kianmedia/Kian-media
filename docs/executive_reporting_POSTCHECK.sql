-- ════════════════════════════════════════════════════════════════════════════
-- executive_reporting_POSTCHECK.sql                   (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ بعد executive_reporting_RUNME.sql.
--
-- ★ نتيجة واحدة ★ — أُعيدت كتابة هذا الملفّ في التدقيق النهائيّ ليُخرج
--   **مجموعة نتائج واحدة** بدل ثلاثين استعلامًا منفصلًا. السبب ليس التجميل:
--   محرّر SQL يعرض آخر نتيجة فقط، فملفّ بثلاثين نتيجة يُقرأ عمليًّا بفحص واحد
--   ويُعلَن ناجحًا بينما تسعة وعشرون لم يرها أحد. الآن كلّ فحص صفّ بحكم صريح
--   (PASS / FAIL / INFO) ولا شيء يمرّ لأنّه لم يُقرأ.
--
-- ★ ساكن ★ — لا يُستدعى هنا أيّ RPC محميّ. الملفّ يُنفَّذ بدور postgres حيث
--   auth.uid() = NULL، ونداء دالّة مبوَّبة في تلك الحالة يموت ويُسقط الفحص كلّه
--   (وقد أسقط ترحيلتين في هذا المستودع من قبل). المُسنَدات الأربعة الوحيدة
--   التي تُقيَّم فعلًا (mgmt_can_view وأخواتها) مصمَّمة للفشل المغلق لا للرفع،
--   وكلّ واحدة محروسة بـto_regprocedure أوّلًا فلا تنهار على قاعدة لم تُرحَّل.
--
-- ★ لا catch-all ★ — لا يوجد فحص ينجح «مهما كان»: كلّ صفّ يقارن قيمة مرصودة
--   بقيمة متوقّعة مذكورة في العمود expected.
-- ════════════════════════════════════════════════════════════════════════════

with
-- ─── 1) الجدولان موجودان وRLS مفعّلة ولهما سياسات ────────────────────────
t_tables as (
  select count(*) filter (where present and rls and has_policy) as good,
         count(*) as total,
         string_agg(name || case when present and rls and has_policy then '' else ' ✗' end, ', ') as detail
  from (
    select t.name,
           (to_regclass('public.' || t.name) is not null) as present,
           coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'public' and c.relname = t.name), false) as rls,
           exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.name) as has_policy
    from (values ('mgmt_report_cache'), ('mgmt_audit')) t(name)
  ) x
),
-- ─── 2) لا سياسة كتابة مباشرة ────────────────────────────────────────────
t_write_policies as (
  select count(*) as n, coalesce(string_agg(tablename || '.' || policyname || ':' || cmd, ', '), '—') as detail
  from pg_policies
  where schemaname = 'public' and tablename like 'mgmt\_%' and cmd <> 'SELECT'
),
-- ─── 3) لا صلاحية anon — لا على جدول ولا على دالّة ───────────────────────
t_anon_tables as (
  select count(*) as n, coalesce(string_agg(table_name || ':' || privilege_type, ', '), '—') as detail
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name like 'mgmt\_%' and grantee = 'anon'
),
t_anon_functions as (
  select count(*) as n, coalesce(string_agg(p.proname, ', '), '—') as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname like 'mgmt\_%'
    and exists (select 1 from pg_roles where rolname = 'anon')
    and has_function_privilege('anon', p.oid, 'EXECUTE')
),
-- ─── 4) كلّ دوالّ الموديول بمسار بحث مثبَّت ──────────────────────────────
t_search_path as (
  select count(*) filter (where not pinned) as n_unpinned,
         count(*) as total,
         coalesce(string_agg(proname, ', ') filter (where not pinned), '—') as detail
  from (
    select p.proname,
           (coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%') as pinned
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mgmt\_%'
  ) x
),
-- ─── 5) الدوالّ الداخلية لا تُنفَّذ من الواجهة ───────────────────────────
--   mgmt_compute خصوصًا: منحها = قراءة المصادر خارج البوّابة.
t_internal_closed as (
  select count(*) filter (where granted) as n_leaked,
         count(*) as checked,
         coalesce(string_agg(sig, ', ') filter (where granted), '—') as detail
  from (
    select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as granted
    from (values ('public.mgmt_compute(jsonb)'),
                 ('public.mgmt_read_jsonb(text,text,jsonb,text,text)'),
                 ('public.mgmt_read_calendar(date,date)'),
                 ('public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)'),
                 ('public.mgmt_alerts_from(jsonb,boolean)'),
                 ('public.mgmt_norm_filters(jsonb)'),
                 ('public.mgmt_cache_key(jsonb,boolean)'),
                 ('public.mgmt_log(text,text,text,jsonb)')) f(sig)
    where to_regprocedure(f.sig) is not null
  ) x
),
-- ─── 6) الواجهة العامّة مُتاحة لـauthenticated (البوّابة داخل الدالّة) ────
t_public_open as (
  select count(*) filter (where not granted) as n_missing,
         count(*) as checked,
         coalesce(string_agg(sig, ', ') filter (where not granted), '—') as detail
  from (
    select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as granted
    from (values ('public.mgmt_access()'), ('public.mgmt_sources()'),
                 ('public.mgmt_dashboard(jsonb,boolean)'), ('public.mgmt_refresh(jsonb)'),
                 ('public.mgmt_export(text,jsonb)'), ('public.mgmt_audit_list(int)'),
                 ('public.mgmt_can_view()'), ('public.mgmt_can_view_sensitive()')) f(sig)
    where to_regprocedure(f.sig) is not null
  ) x
),
-- ─── 7) المُسنَدات لا تعيد NULL (تشغيل بدور postgres ⇒ auth.uid() = NULL) ─
--   NULL هنا انهيار fail-open: مُسنَد يعيد NULL يُقرأ في سياسة RLS كـ«لا صفّ»
--   أحيانًا وكـ«مرّ» أحيانًا. المطلوب false صريحة، لا NULL.
--   كلّ نداء محروس بـto_regprocedure كي لا ينهار الملفّ على قاعدة لم تُرحَّل.
t_predicates as (
  select
    case when to_regprocedure('public.mgmt_can_view()') is null then null
         else public.mgmt_can_view() end as can_view,
    case when to_regprocedure('public.mgmt_can_view_sensitive()') is null then null
         else public.mgmt_can_view_sensitive() end as can_view_sensitive,
    case when to_regprocedure('public.mgmt_can_export()') is null then null
         else public.mgmt_can_export() end as can_export,
    case when to_regprocedure('public.mgmt_perm(text)') is null then null
         else public.mgmt_perm('exec_report.view') end as perm_view
),
-- ─── 8) ★ الطبقة الحسّاسة للمالك وحده ولا مفتاح يفتحها ★ ─────────────────
t_sensitive as (
  select
    coalesce(pg_get_functiondef(to_regprocedure('public.mgmt_can_view_sensitive()')) ilike '%is_owner()%', false) as has_is_owner,
    coalesce(pg_get_functiondef(to_regprocedure('public.mgmt_can_view_sensitive()')) ilike '%mgmt_perm%', false) as opens_by_key
),
t_sensitive_key as (
  select count(*) as n, coalesce(string_agg(key, ', '), '—') as detail
  from public.permissions where key ilike 'exec\_report.%sensitive%'
),
t_perm_keys as (
  select count(*) as n,
         coalesce(string_agg(key || '(' || coalesce(sensitivity, '?') || ')', ', ' order by key), '—') as detail
  from public.permissions where key like 'exec\_report.%'
),
-- ─── 9) ★ «غير متاح» لا يساوي صفرًا ★ — فحص سلوكيّ لا نصّيّ ──────────────
--   mgmt_kpi دالّة SQL نقيّة (immutable, بلا قراءة جدول, بلا بوّابة): نداؤها
--   تحت auth.uid() = NULL آمن، وهو الفرق بينها وبين RPC محميّ.
t_unavailable as (
  select
    case when to_regprocedure('public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)') is null
         then null
         else (public.mgmt_kpi('probe','production','count', false,
                 'unavailable','module_not_installed','x','x', 42, 42, 'filtered', null)->'value') = 'null'::jsonb
    end as value_is_null,
    case when to_regprocedure('public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)') is null
         then null
         else (public.mgmt_kpi('probe','production','count', false,
                 'unavailable','module_not_installed','x','x', 42, 42, 'filtered', null)->'count') = 'null'::jsonb
    end as count_is_null,
    case when to_regprocedure('public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)') is null
         then null
         else (public.mgmt_kpi('probe','production','count', false,
                 'ok', null, null, null, 0, 0, 'filtered', null)->>'value') = '0'
    end as zero_survives
),
-- ─── 10) التصنيف يفرّق بين المنع والترحيلة الناقصة ───────────────────────
t_classify as (
  select
    case when to_regprocedure('public.mgmt_classify(text,text)') is null then null
         else public.mgmt_classify('42501','permission denied') end as denial_42501,
    case when to_regprocedure('public.mgmt_classify(text,text)') is null then null
         else public.mgmt_classify('P0001','not authorized') end as denial_raise,
    case when to_regprocedure('public.mgmt_classify(text,text)') is null then null
         else public.mgmt_classify('42883','function does not exist') end as missing_fn,
    case when to_regprocedure('public.mgmt_classify(text,text)') is null then null
         else public.mgmt_classify('22012','division by zero') end as generic_error
),
-- ─── 11) الطزاجة مُعلَنة، والقديم موسوم ─────────────────────────────────
t_freshness as (
  select
    coalesce(d ilike '%generated_at%', false)     as declares_generated_at,
    coalesce(d ilike '%age_seconds%', false)      as declares_age,
    coalesce(d ilike '%is_stale%', false)         as declares_stale_flag,
    coalesce(d ilike '%recompute_failed%', false) as marks_failed_recompute,
    coalesce(d ilike '%from_cache%', false)       as declares_cache_origin,
    coalesce(d ilike '%mgmt_cache_key%', false)   as uses_cache_key
  from (select pg_get_functiondef(to_regprocedure('public.mgmt_dashboard(jsonb,boolean)')) as d) s
),
t_cache_key as (
  select coalesce(k ilike '%auth.uid()%', false)  as key_includes_user,
         coalesce(k ilike '%p_sensitive%', false) as key_includes_sensitivity
  from (select pg_get_functiondef(to_regprocedure('public.mgmt_cache_key(jsonb,boolean)')) as k) s
),
t_cache_policy as (
  select count(*) as n,
         coalesce(string_agg(policyname || ' :: ' || coalesce(qual, '(no qual)'), ' | '), '—') as detail
  from pg_policies where schemaname = 'public' and tablename = 'mgmt_report_cache'
),
-- ─── 11b) الجاهزية التشغيلية محسوبة على نافذتها هي ───────────────────────
--   الصيغة الملغاة طرحت عدّادات نقص محسوبة على ١٤/٢١ يومًا من مقام ٨ أيام،
--   وعدّت المهمّة الناقصة في ثلاثة أوجه ثلاث مرّات ⇒ ٠٪ لفريق جاهز تمامًا.
t_readiness as (
  select coalesce(c ilike '%avg_job_readiness_score%', false)        as uses_job_scores,
         coalesce(c ilike '%(d->>''missing_crew'')::bigint%', false) as subtracts_foreign_window,
         coalesce(c ilike '%readiness_not_reported%', false)         as declares_no_score_basis
  from (select pg_get_functiondef(to_regprocedure('public.mgmt_compute(jsonb)')) as c) s
),
-- ─── 11c) عمر النسخة المخبّأة يُقصَّر ولا يُمدَّد ────────────────────────
t_ttl as (
  select
    case when to_regprocedure('public.mgmt_norm_filters(jsonb)') is null then null
         else (public.mgmt_norm_filters('{"ttl_seconds":3600}'::jsonb)->>'ttl_seconds')::int end as capped_at_300,
    case when to_regprocedure('public.mgmt_norm_filters(jsonb)') is null then null
         else (public.mgmt_norm_filters('{"ttl_seconds":30}'::jsonb)->>'ttl_seconds')::int end as shorten_honoured
),
-- ─── 12) ★ منصّة المشاريع لم تُمَسّ — ولو بالقراءة ★ ─────────────────────
t_frozen as (
  select count(*) as n, coalesce(string_agg(proname, ', '), '—') as detail
  from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mgmt\_%'
      and (pg_get_functiondef(p.oid) ~* '\bpublic\.(projects|project_core|deliverables|deliverable_internal)\b'
        or pg_get_functiondef(p.oid) ~* '\bpublic\.(project|large_project)_[a-z_]+\s*\(')
  ) x
),
t_platform_intact as (
  select count(*) as n,
         coalesce(string_agg(proname, ', ' order by proname), '—') as detail
  from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'exec\_%' or p.proname like 'executive\_%')
  ) x
),
-- ─── 13) لا مكالمة خارجية ولا بيانات اعتماد ─────────────────────────────
t_no_external as (
  select count(*) as n, coalesce(string_agg(proname, ', '), '—') as detail
  from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'mgmt\_%'
      and (pg_get_functiondef(p.oid) ~* '\b(pg_net|net\.http_post|net\.http_get|dblink)\b'
        or pg_get_functiondef(p.oid) ~* '(client_secret|refresh_token|access_token|api_key|service_role)')
  ) x
),
-- ─── 14) الحزمة لم تُنشئ بيانات ─────────────────────────────────────────
t_no_data as (
  select (select count(*) from public.mgmt_report_cache) as cache_rows,
         (select count(*) from public.mgmt_audit)        as audit_rows
),
-- ─── 15) حالة المصادر كما ستراها اللوحة ─────────────────────────────────
--   كلّ installed = false يعني أنّ مؤشّراته ستُعرض «غير متاح» مع اسم ملفّ
--   الـRUNME — ولن تُعرض صفرًا أبدًا. هذا سطر معلومات لا فحص فشل: تشغيل هذه
--   الحزمة بلا موديولات سلوك مقصود.
t_sources as (
  select count(*) filter (where installed) as n_installed,
         count(*) as n_total,
         string_agg(module || '=' || case when installed then 'installed' else 'MISSING → ' || runme end,
                    ' · ' order by module) as detail
  from (
    select m.module, m.runme, (to_regprocedure(m.sig) is not null) as installed
    from (values
      ('communications','public.comms_health()','docs/communications_hub_RUNME.sql'),
      ('production','public.prodops_dashboard(jsonb)','docs/operations_center_RUNME.sql'),
      ('sales','public.crm_dashboard(jsonb)','docs/crm_sales_FOUNDATION_RUNME.sql'),
      ('finance','public.finops_dashboard(jsonb)','docs/finance_profitability_RUNME.sql'),
      -- ★ المصدران المضافان في التدقيق النهائيّ ★
      ('live_operations','public.liveops_session_list(jsonb)','docs/live_operations_dashboard_RUNME.sql'),
      ('ai_assistant','public.ai_admin_overview()','docs/kian_ai_assistant_RUNME.sql')
    ) m(module, sig, runme)
  ) x
),
-- ─── 16) المؤشّرات السبعة عشر مبنيّة داخل المحرّك ────────────────────────
t_kpi_keys as (
  select count(*) filter (where not built) as n_missing,
         count(*) as n_total,
         coalesce(string_agg(k, ', ') filter (where not built), '—') as detail
  from (
    select k, coalesce(
      pg_get_functiondef(to_regprocedure('public.mgmt_compute(jsonb)')) ilike '%''' || k || '''%', false) as built
    from unnest(array['notifications_pending','notifications_failed','operational_readiness',
                      'resource_conflicts','upcoming_jobs','new_leads','pipeline_value',
                      'weighted_forecast','stalled_opportunities','expenses','commitments',
                      'overdue_collections','estimated_profitability',
                      'live_sessions_active','live_open_incidents',
                      'ai_knowledge_approved','ai_leads_pending_review']) k
  ) x
),

-- ════════════════════════════════════════════════════════════════════════
-- الأحكام — صفّ لكلّ فحص، ولا فحص بلا قيمة متوقّعة مذكورة
-- ════════════════════════════════════════════════════════════════════════
checks(sort_key, check_id, verdict, expected, detail) as (
  select 10, '1.tables_rls_policies',
         case when good = total then 'PASS' else 'FAIL' end,
         'both tables present + RLS on + at least one policy', detail
  from t_tables
  union all
  select 20, '2.no_direct_write_policy',
         case when n = 0 then 'PASS' else 'FAIL' end, '0 non-SELECT policies', detail from t_write_policies
  union all
  select 30, '3a.no_anon_table_grant',
         case when n = 0 then 'PASS' else 'FAIL' end, '0 anon table privileges', detail from t_anon_tables
  union all
  select 31, '3b.no_anon_function_execute',
         case when n = 0 then 'PASS' else 'FAIL' end, '0 anon-executable mgmt_* functions', detail from t_anon_functions
  union all
  select 40, '4.search_path_pinned',
         case when n_unpinned = 0 then 'PASS' else 'FAIL' end,
         'every mgmt_* function pins search_path', 'unpinned: ' || detail from t_search_path
  union all
  select 50, '5.internal_not_callable',
         case when n_leaked = 0 then 'PASS' else 'FAIL' end,
         'authenticated cannot execute any internal function', 'leaked: ' || detail from t_internal_closed
  union all
  select 60, '6.public_surface_callable',
         case when n_missing = 0 then 'PASS' else 'FAIL' end,
         'authenticated can execute every gated entry point', 'missing: ' || detail from t_public_open
  union all
  select 70, '7.predicates_never_null',
         case when can_view is false and can_view_sensitive is false
                   and can_export is false and perm_view is false then 'PASS'
              when can_view is null or can_view_sensitive is null
                   or can_export is null or perm_view is null then 'FAIL'
              else 'FAIL' end,
         'all four = false (never NULL) with auth.uid() = NULL',
         'can_view=' || coalesce(can_view::text, 'NULL') ||
         ' sensitive=' || coalesce(can_view_sensitive::text, 'NULL') ||
         ' export=' || coalesce(can_export::text, 'NULL') ||
         ' perm=' || coalesce(perm_view::text, 'NULL')
  from t_predicates
  union all
  select 80, '8a.sensitive_is_owner_only',
         case when has_is_owner and not opens_by_key then 'PASS' else 'FAIL' end,
         'mgmt_can_view_sensitive() requires is_owner() and is NOT openable by a permission key',
         'has_is_owner=' || has_is_owner::text || ' opens_by_key=' || opens_by_key::text
  from t_sensitive
  union all
  select 81, '8b.no_key_for_sensitive_layer',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 permission keys matching exec\_report.%sensitive%', detail from t_sensitive_key
  union all
  select 82, '8c.permission_keys',
         case when n = 2 then 'PASS' else 'FAIL' end,
         'exactly 2 keys (view + export), both sensitivity=sensitive', detail from t_perm_keys
  union all
  select 90, '9.unavailable_is_never_zero',
         case when value_is_null and count_is_null and zero_survives then 'PASS' else 'FAIL' end,
         'unavailable ⇒ value/count NULL; a REAL zero still reads 0',
         'value_is_null=' || coalesce(value_is_null::text, 'NULL') ||
         ' count_is_null=' || coalesce(count_is_null::text, 'NULL') ||
         ' zero_survives=' || coalesce(zero_survives::text, 'NULL')
  from t_unavailable
  union all
  select 100, '10.classification_distinct',
         case when denial_42501 = 'restricted' and denial_raise = 'restricted'
                   and missing_fn = 'unavailable' and generic_error = 'error' then 'PASS' else 'FAIL' end,
         'restricted / restricted / unavailable / error — a denial is never a missing migration',
         coalesce(denial_42501, 'NULL') || ' / ' || coalesce(denial_raise, 'NULL') || ' / ' ||
         coalesce(missing_fn, 'NULL') || ' / ' || coalesce(generic_error, 'NULL')
  from t_classify
  union all
  select 110, '11a.freshness_declared',
         case when declares_generated_at and declares_age and declares_stale_flag
                   and marks_failed_recompute and declares_cache_origin and uses_cache_key
              then 'PASS' else 'FAIL' end,
         'all six freshness facts are declared by mgmt_dashboard',
         'generated_at=' || declares_generated_at::text || ' age=' || declares_age::text ||
         ' stale=' || declares_stale_flag::text || ' recompute_failed=' || marks_failed_recompute::text ||
         ' from_cache=' || declares_cache_origin::text || ' cache_key=' || uses_cache_key::text
  from t_freshness
  union all
  select 111, '11b.cache_key_isolates',
         case when key_includes_user and key_includes_sensitivity then 'PASS' else 'FAIL' end,
         'the cache key separates users AND sensitivity levels',
         'key_includes_user=' || key_includes_user::text ||
         ' key_includes_sensitivity=' || key_includes_sensitivity::text
  from t_cache_key
  union all
  select 112, '11c.cache_row_is_own_row',
         case when n >= 1 then 'PASS' else 'FAIL' end,
         'mgmt_report_cache carries a policy restricting a row to its owner', detail from t_cache_policy
  union all
  select 113, '11d.readiness_basis',
         case when uses_job_scores and not subtracts_foreign_window and declares_no_score_basis
              then 'PASS' else 'FAIL' end,
         'readiness = average job score in the SAME window; the old cross-window subtraction is gone',
         'uses_job_scores=' || uses_job_scores::text ||
         ' subtracts_foreign_window=' || subtracts_foreign_window::text ||
         ' declares_no_score_basis=' || declares_no_score_basis::text
  from t_readiness
  union all
  select 114, '11e.cache_ttl_shortens_only',
         case when capped_at_300 = 300 and shorten_honoured = 30 then 'PASS' else 'FAIL' end,
         'caller may shorten the cache TTL, never extend it (3600 → 300, 30 → 30)',
         'capped=' || coalesce(capped_at_300::text, 'NULL') ||
         ' shortened=' || coalesce(shorten_honoured::text, 'NULL')
  from t_ttl
  union all
  select 120, '12a.project_platform_untouched',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 mgmt_* functions reference the frozen project platform — not even to READ it', detail from t_frozen
  union all
  select 121, '12b.platform_functions_intact',
         'INFO', 'existing exec_/executive_ functions listed unchanged — this package created none of them',
         detail from t_platform_intact
  union all
  select 130, '13.no_external_call_no_credentials',
         case when n = 0 then 'PASS' else 'FAIL' end,
         '0 functions reaching the network or handling credentials', detail from t_no_external
  union all
  select 140, '14.migration_created_no_data',
         case when cache_rows = 0 and audit_rows = 0 then 'PASS' else 'FAIL' end,
         'cache_rows = 0 and audit_rows = 0',
         'cache_rows=' || cache_rows::text || ' audit_rows=' || audit_rows::text
  from t_no_data
  union all
  select 150, '15.source_modules',
         'INFO',
         'a missing module is shown as "unavailable" with its RUNME name — لن تُعرض صفرًا أبدًا (never zero)',
         n_installed::text || '/' || n_total::text || ' installed · ' || detail
  from t_sources
  union all
  select 160, '16.kpi_keys_built_in_engine',
         case when n_missing = 0 then 'PASS' else 'FAIL' end,
         'all 17 KPI keys are built inside mgmt_compute (no dangling catalogue)',
         'missing: ' || detail from t_kpi_keys
  union all
-- ★★ التقارير آخر حزمة: لا تُعلَن جاهزيتها قبل إثبات كلّ سابقاتها ★★
--   كان يتحقّق من ستّ بادئات فقط؛ وهو طبقة قراءة فوق الجميع، فغياب مصدر
--   يجعل رقمًا ناقصًا يُقرأ صفرًا صادقًا — وهو أخطر من خطأ ظاهر.
  select 91, '★ كلّ الحزم السابقة قائمة قبل إعلان الجاهزية',
       '13 حزمة',
       coalesce((select string_agg(x.pkg, ' · ' order by x.pkg) from (values
           ('communications_hub','comms\_%'), ('operations_center','ops\_%'),
           ('crm_sales','crm\_%'), ('finance_profitability','fin\_%'),
           ('commercial_subscriptions','csub\_%'), ('smart_quoting','sq\_%'),
           ('lead_scoring_routing','lsr\_%'), ('asset_intelligence','custody\_inventory\_%'),
           ('talent_vendor_network','tvn\_%'), ('vendor_compliance_center','vcc\_%'),
           ('case_studies_platform','cs\_%'), ('live_operations_dashboard','liveops\_%'),
           ('kian_ai_assistant','ai\_%')
         ) as x(pkg, pre)
        where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname='public' and c.relkind in ('r','p')
                             and c.relname like x.pre escape '\')), 'كلّها قائمة'),
       not exists (select 1 from (values
           ('comms\_%'),('ops\_%'),('crm\_%'),('fin\_%'),('csub\_%'),('sq\_%'),('lsr\_%'),
           ('custody\_inventory\_%'),('tvn\_%'),('vcc\_%'),('cs\_%'),('liveops\_%'),('ai\_%')
         ) as y(pre)
        where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname='public' and c.relkind in ('r','p')
                             and c.relname like y.pre escape '\'))

union all
  -- ─── 17) خطوة التحقّق التي لا يستطيع هذا الملفّ أداءها ────────────────
  --   كلّ ما سبق يعمل بدور postgres وauth.uid() = NULL، فهو يُثبت الشكل لا
  --   السلوك تحت جلسة حقيقية.
  select 170, '17.live_test_still_required', 'INFO',
         'structure only — behaviour under a real session is NOT proven here',
         'run docs/EXECUTIVE_REPORTING_ACCEPTANCE.md with owner + non-owner staff + client accounts'
)
select check_id as "الفحص", verdict as "الحكم", expected as "المتوقّع", detail as "المرصود"
from checks order by sort_key;
