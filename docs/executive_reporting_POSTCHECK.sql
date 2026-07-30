-- ════════════════════════════════════════════════════════════════════════════
-- executive_reporting_POSTCHECK.sql                   (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ بعد executive_reporting_RUNME.sql. كلّ استعلام SELECT صِرف، وكلّ قسم
-- مكتوب بنتيجة متوقّعة صريحة: لا «يبدو أنّه نجح».
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الجدولان موجودان وRLS مفعّلة ولهما سياسات ────────────────────────
-- متوقّع: صفّان، present/rls/has_policy = true في كليهما.
select t.name,
       (to_regclass('public.' || t.name) is not null) as present,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = t.name), false) as rls,
       exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.name) as has_policy
from (values ('mgmt_report_cache'), ('mgmt_audit')) t(name);

-- ─── 2) لا سياسة كتابة مباشرة ────────────────────────────────────────────
-- متوقّع: صفر صفّ. أيّ صفّ هنا يعني كتابة تتجاوز الـRPC.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename like 'mgmt\_%' and cmd <> 'SELECT';

-- ─── 3) لا صلاحية anon — لا على جدول ولا على دالّة ───────────────────────
-- متوقّع: صفر صفّ في كليهما.
select table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'mgmt\_%' and grantee = 'anon';

select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'mgmt\_%'
  and exists (select 1 from pg_roles where rolname = 'anon')
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- ─── 4) كلّ دوالّ الموديول بمسار بحث مثبَّت ──────────────────────────────
-- متوقّع: pinned_search_path = true في كلّ صفّ.
select p.proname, p.prosecdef as security_definer, p.provolatile,
       (coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%') as pinned_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'mgmt\_%'
order by p.proname;

-- ─── 5) الدوالّ الداخلية لا تُنفَّذ من الواجهة ───────────────────────────
-- متوقّع: false في كلّ صفّ. mgmt_compute خصوصًا: منحها = قراءة المصادر خارج البوّابة.
select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_exec
from (values ('public.mgmt_compute(jsonb)'),
             ('public.mgmt_read_jsonb(text,text,jsonb,text,text)'),
             ('public.mgmt_read_calendar(date,date)'),
             ('public.mgmt_kpi(text,text,text,boolean,text,text,text,text,numeric,bigint,text,jsonb)'),
             ('public.mgmt_alerts_from(jsonb,boolean)'),
             ('public.mgmt_norm_filters(jsonb)'),
             ('public.mgmt_cache_key(jsonb,boolean)'),
             ('public.mgmt_log(text,text,text,jsonb)')) f(sig)
where to_regprocedure(f.sig) is not null;

-- ─── 6) الواجهة العامّة مُتاحة لـauthenticated ───────────────────────────
-- متوقّع: true في كلّ صفّ (البوّابة داخل الدالّة لا في المنحة).
select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_exec
from (values ('public.mgmt_access()'), ('public.mgmt_sources()'),
             ('public.mgmt_dashboard(jsonb,boolean)'), ('public.mgmt_refresh(jsonb)'),
             ('public.mgmt_export(text,jsonb)'), ('public.mgmt_audit_list(int)'),
             ('public.mgmt_can_view()'), ('public.mgmt_can_view_sensitive()')) f(sig);

-- ─── 7) المُسنَدات لا تعيد NULL (تشغيل بدور postgres ⇒ auth.uid() = NULL) ─
-- متوقّع: false في الأربعة، ولا NULL في أيّها. NULL هنا = انهيار fail-closed.
select public.mgmt_can_view()           as can_view,
       public.mgmt_can_view_sensitive() as can_view_sensitive,
       public.mgmt_can_export()         as can_export,
       public.mgmt_perm('exec_report.view') as perm_view;

-- ─── 8) ★ الطبقة الحسّاسة للمالك وحده ولا مفتاح يفتحها ★ ─────────────────
-- متوقّع: has_is_owner = true وopens_by_key = false.
select (pg_get_functiondef(to_regprocedure('public.mgmt_can_view_sensitive()')) ilike '%is_owner()%') as has_is_owner,
       (pg_get_functiondef(to_regprocedure('public.mgmt_can_view_sensitive()')) ilike '%mgmt_perm%') as opens_by_key;

-- متوقّع: صفر صفّ — لا مفتاح صلاحية للمؤشّرات الحسّاسة، بالتصميم.
select key from public.permissions where key ilike 'exec\_report.%sensitive%';

-- متوقّع: صفّان بالضبط (view وexport) وسنّهما sensitive.
select key, category, sensitivity, label_ar from public.permissions
where key like 'exec\_report.%' order by key;

-- ─── 9) ★ «غير متاح» لا يساوي صفرًا ★ — فحص سلوكيّ لا نصّيّ ──────────────
-- متوقّع: value_is_null = true وcount_is_null = true في الصفّ الأوّل،
--         وzero_survives = true في الثاني (الصفر الحقيقيّ يبقى صفرًا).
select (public.mgmt_kpi('probe','production','count', false,
          'unavailable','module_not_installed','x','x', 42, 42, 'filtered', null)->'value') = 'null'::jsonb
         as value_is_null,
       (public.mgmt_kpi('probe','production','count', false,
          'unavailable','module_not_installed','x','x', 42, 42, 'filtered', null)->'count') = 'null'::jsonb
         as count_is_null;

select (public.mgmt_kpi('probe','production','count', false,
          'ok', null, null, null, 0, 0, 'filtered', null)->>'value') = '0' as zero_survives;

-- ─── 10) التصنيف يفرّق بين المنع والترحيلة الناقصة ───────────────────────
-- متوقّع: restricted / restricted / unavailable / error بهذا الترتيب.
select public.mgmt_classify('42501','permission denied')            as denial_42501,
       public.mgmt_classify('P0001','not authorized')               as denial_raise,
       public.mgmt_classify('42883','function does not exist')      as missing_fn,
       public.mgmt_classify('22012','division by zero')             as generic_error;

-- ─── 11) الطزاجة مُعلَنة، والقديم موسوم ─────────────────────────────────
-- متوقّع: true في الأعمدة الستّة.
select
  (d ilike '%generated_at%')      as declares_generated_at,
  (d ilike '%age_seconds%')       as declares_age,
  (d ilike '%is_stale%')          as declares_stale_flag,
  (d ilike '%recompute_failed%')  as marks_failed_recompute,
  (d ilike '%from_cache%')        as declares_cache_origin,
  (d ilike '%mgmt_cache_key%')    as uses_cache_key
from (select pg_get_functiondef(to_regprocedure('public.mgmt_dashboard(jsonb,boolean)')) as d) s;

-- متوقّع: true في كليهما — مفتاح الذاكرة يفصل المستخدمين ومستويَي الحساسية.
select (k ilike '%auth.uid()%') as key_includes_user,
       (k ilike '%p_sensitive%') as key_includes_sensitivity
from (select pg_get_functiondef(to_regprocedure('public.mgmt_cache_key(jsonb,boolean)')) as k) s;

-- متوقّع: صفّ واحد — سياسة الذاكرة تقصر الصفّ على صاحبه.
select policyname, qual from pg_policies
where schemaname = 'public' and tablename = 'mgmt_report_cache';

-- ─── 11b) الجاهزية التشغيلية محسوبة على نافذتها هي ───────────────────────
-- متوقّع: uses_job_scores = true، subtracts_foreign_window = false،
--         declares_no_score_basis = true.
-- الصيغة الملغاة كانت تطرح عدّادات نقص محسوبة على ١٤/٢١ يومًا من مقام ٨ أيام،
-- وتعدّ المهمّة الناقصة في ثلاثة أوجه ثلاث مرّات ⇒ ٠٪ لفريق جاهز تمامًا.
select (c ilike '%avg_job_readiness_score%')      as uses_job_scores,
       (c ilike '%(d->>''missing_crew'')::bigint%') as subtracts_foreign_window,
       (c ilike '%readiness_not_reported%')       as declares_no_score_basis
from (select pg_get_functiondef(to_regprocedure('public.mgmt_compute(jsonb)')) as c) s;

-- ─── 11c) عمر النسخة المخبّأة يُقصَّر ولا يُمدَّد ────────────────────────
-- متوقّع: capped_at_300 = 300، shorten_honoured = 30.
-- عمر النسخة نافذة قراءة بعد سحب صلاحية في موديول مصدر؛ من يختارها هو النظام
-- لا المتصل.
select (public.mgmt_norm_filters('{"ttl_seconds":3600}'::jsonb)->>'ttl_seconds')::int as capped_at_300,
       (public.mgmt_norm_filters('{"ttl_seconds":30}'::jsonb)->>'ttl_seconds')::int   as shorten_honoured;

-- ─── 12) ★ منصّة المشاريع لم تُمَسّ — ولو بالقراءة ★ ─────────────────────
-- متوقّع: صفر صفّ.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'mgmt\_%'
  and (pg_get_functiondef(p.oid) ~* '\bpublic\.(projects|project_core|deliverables|deliverable_internal)\b'
    or pg_get_functiondef(p.oid) ~* '\bpublic\.(project|large_project)_[a-z_]+\s*\(');

-- متوقّع: دوالّ منصّة المشاريع التنفيذية كما كانت — لم تُنشأ ولم تُستبدَل.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and (p.proname like 'exec\_%' or p.proname like 'executive\_%')
order by p.proname;

-- ─── 13) لا مكالمة خارجية ولا بيانات اعتماد ─────────────────────────────
-- متوقّع: صفر صفّ.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'mgmt\_%'
  and (pg_get_functiondef(p.oid) ~* '\b(pg_net|net\.http_post|net\.http_get|dblink)\b'
    or pg_get_functiondef(p.oid) ~* '(client_secret|refresh_token|access_token|api_key|service_role)');

-- ─── 14) الحزمة لم تُنشئ بيانات ─────────────────────────────────────────
-- متوقّع: 0 و0.
select (select count(*) from public.mgmt_report_cache) as cache_rows,
       (select count(*) from public.mgmt_audit)        as audit_rows;

-- ─── 15) حالة المصادر كما ستراها اللوحة ─────────────────────────────────
-- متوقّع: أربعة صفوف. كلّ installed = false يعني أنّ مؤشّراته ستُعرض
-- «غير متاح» مع اسم ملفّ الـRUNME — ولن تُعرض صفرًا أبدًا.
select m.module, m.runme, (to_regprocedure(m.sig) is not null) as installed
from (values
  ('communications','public.comms_health()','docs/communications_hub_RUNME.sql'),
  ('production','public.prodops_dashboard(jsonb)','docs/operations_center_RUNME.sql'),
  ('sales','public.crm_dashboard(jsonb)','docs/crm_sales_FOUNDATION_RUNME.sql'),
  ('finance','public.finops_dashboard(jsonb)','docs/finance_profitability_RUNME.sql')
) m(module, sig, runme);

-- ─── 16) المِجَسّ لا يرفع استثناء ───────────────────────────────────────
-- متوقّع: ok = true، can_view = false، can_view_sensitive = false (بلا جلسة).
select public.mgmt_access() as access_probe_without_session;

-- ─── 17) خطوة التحقّق التي لا يستطيع هذا الملفّ أداءها ──────────────────
-- هذه الاستعلامات تعمل بدور postgres وauth.uid() = NULL، فهي تُثبت الشكل لا
-- السلوك تحت جلسة حقيقية. التحقّق الحيّ الإلزاميّ (٣ حسابات) موصوف خطوةً خطوة في
-- docs/EXECUTIVE_REPORTING_ACCEPTANCE.md، ولا تُعتبر المرحلة مقبولة قبل تنفيذه.
select 'run docs/EXECUTIVE_REPORTING_ACCEPTANCE.md with owner + non-owner staff + client accounts' as required_live_test;
