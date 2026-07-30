-- ════════════════════════════════════════════════════════════════════════════
-- operations_center_POSTCHECK.sql                     (READ-ONLY — لا يكتب شيئًا)
-- يُنفَّذ بعد operations_center_RUNME.sql. كلّ استعلام SELECT صِرف.
-- كلّ قسم مكتوب بحيث تكون النتيجة المتوقّعة صريحة: لا «يبدو أنّه نجح».
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1) الجداول العشرون موجودة وRLS مفعّلة ────────────────────────────────
-- متوقّع: 20 صفًّا، present = true وrls = true في كلّها.
select t.name,
       (to_regclass('public.' || t.name) is not null) as present,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relname = t.name), false) as rls
from (values ('ops_locations'),('ops_vehicles'),('ops_jobs'),('ops_job_crew'),('ops_job_equipment'),
             ('ops_job_permits'),('ops_job_travel'),('ops_job_accommodation'),('ops_job_vehicles'),
             ('ops_job_hse'),('ops_job_weather'),('ops_media_cards'),('ops_media_backups'),
             ('ops_ingest_jobs'),('ops_post_handoff'),('ops_daily_reports'),('ops_incidents'),
             ('ops_delays'),('ops_call_sheets'),('ops_audit')) t(name);

-- ─── 2) لا سياسة كتابة مباشرة على أيّ جدول ────────────────────────────────
-- متوقّع: صفر صفّ. أيّ صفّ هنا يعني أنّ الكتابة تتجاوز الـRPC.
select tablename, policyname, cmd from pg_policies
where schemaname = 'public' and tablename like 'ops\_%' and cmd <> 'SELECT';

-- ─── 3) لا صلاحية anon — لا على جدول ولا على دالّة ────────────────────────
-- متوقّع: صفر صفّ في كليهما.
select table_name, privilege_type from information_schema.role_table_grants
where table_schema = 'public' and table_name like 'ops\_%' and grantee = 'anon';

select p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'prodops%'
  and exists (select 1 from pg_roles where rolname = 'anon')
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- ─── 4) كلّ دوالّ الموديول SECURITY DEFINER بمسار بحث مثبَّت ─────────────
-- متوقّع: كلّ الصفوف security_definer = true وpinned_search_path = true.
select p.proname,
       p.prosecdef as security_definer,
       (coalesce(array_to_string(p.proconfig, ','), '') ilike '%search_path%') as pinned_search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'prodops%' and p.proname <> 'prodops_touch'
order by p.proname;

-- ─── 5) الدوالّ الداخلية لا تُنفَّذ من الواجهة ────────────────────────────
-- متوقّع: false في كلّ صفّ (authenticated لا يملك EXECUTE).
select f.sig, has_function_privilege('authenticated', f.sig, 'EXECUTE') as authenticated_exec
from (values ('public.prodops_conflicts_core(timestamptz,timestamptz,uuid)'),
             ('public.prodops_external_conflicts(timestamptz,timestamptz)'),
             ('public.prodops_readiness_core(uuid)'),
             ('public.prodops_visible_jobs()'),
             ('public.prodops_log(text,text,uuid,uuid,jsonb)'),
             ('public.prodops_next_job_code()')) f(sig)
where to_regprocedure(f.sig) is not null;

-- ─── 6) المُسنَدات لا تعيد NULL (تشغيل بدور postgres ⇒ auth.uid() = NULL) ─
-- متوقّع: صفّ واحد، كلّ الأعمدة = false (ولا واحد NULL).
select public.prodops_can_view()            as can_view,
       public.prodops_can_manage()          as can_manage,
       public.prodops_is_client()           as is_client,
       public.prodops_can_read_job('00000000-0000-0000-0000-000000000000') as can_read_job,
       public.prodops_can_read_job(null)    as can_read_null,
       public.prodops_perm('operations.manage') as perm;

-- ─── 7) مِجَسّ الكشف يعمل ويُعلن انعدام القدرة بدل التظاهر ────────────────
-- متوقّع: ok = true وcan_view = false وauthenticated = false.
select public.prodops_access() as access_probe;

-- ─── 8) مفاتيح الصلاحيات دخلت الكتالوج القائم (إن كان مطبَّقًا) ───────────
-- متوقّع: 8 صفوف إن كان جدول permissions موجودًا، وإلّا صفر (وهذا مقبول).
select key, category, sensitivity from public.permissions
where key like 'operations.%' order by sort_order;

-- ─── 9) ★ تجميد منصّة المشاريع لم يُخرَق ★ ────────────────────────────────
-- متوقّع: صفر صفّ — لا دالّة من الموديول تكتب في المنصّة.
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'prodops%'
  and (pg_get_functiondef(p.oid) ~* 'insert\s+into\s+public\.(projects|project_core|deliverables|deliverable_internal)\b'
    or pg_get_functiondef(p.oid) ~* 'update\s+public\.(projects|project_core|deliverables|deliverable_internal)\b'
    or pg_get_functiondef(p.oid) ~* 'delete\s+from\s+public\.(projects|project_core|deliverables|deliverable_internal)\b');

-- متوقّع: قارن هذه الأعداد بما سجّلته في PREFLIGHT §5 — يجب أن تتطابق تمامًا.
select 'frozen_objects' as label,
  (select count(*) from pg_policies where schemaname='public'
     and tablename in ('projects','project_core','deliverables','deliverable_internal')) as policy_count,
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and (p.proname like 'project\_%' or p.proname like 'large\_project\_%')) as func_count,
  (select count(*) from information_schema.columns
     where table_schema='public' and table_name='projects') as projects_columns;

-- متوقّع: المفتاح الخارجيّ إلى projects موجود ونوعه SET NULL (لا CASCADE ولا RESTRICT).
select conname, confdeltype  -- 'n' = SET NULL
from pg_constraint where conname = 'ops_jobs_project_fk';

-- ─── 10) الطقس Placeholder — لا مصدر آليّ ولا اتصال خارجيّ ────────────────
-- متوقّع: القيد يذكر manual/placeholder فقط.
select conname, pg_get_constraintdef(oid) as def from pg_constraint
where conrelid = 'public.ops_job_weather'::regclass and contype = 'c';

-- ─── 11) قيد النسخ: التحقّق يتطلّب نسختين فعليًّا ─────────────────────────
-- متوقّع: صفّ واحد.
select conname, pg_get_constraintdef(oid) as def from pg_constraint
where conrelid = 'public.ops_media_backups'::regclass and conname = 'ops_backup_verify_needs_two';

-- ─── 12) الترحيلة لم تُنشئ بيانات ────────────────────────────────────────
-- متوقّع: أصفار (ما لم تكن قد أدخلت بيانات بنفسك بعد التشغيل).
select (select count(*) from public.ops_jobs)   as jobs,
       (select count(*) from public.ops_audit)  as audit_rows,
       (select count(*) from public.ops_locations) as locations;

-- ─── 13) الفهارس الحارسة قائمة ───────────────────────────────────────────
-- متوقّع: 6 صفوف present = true.
select i.name, exists (select 1 from pg_indexes where schemaname='public' and indexname = i.name) as present
from (values ('uq_ops_crew_job_user'),('uq_ops_hse_item'),('uq_ops_weather_day'),
             ('uq_ops_card_label'),('uq_ops_backup_card'),('uq_ops_report_day')) i(name);

-- ─── 14) 7B لم تُمَسّ: ops_can_view() القديمة ما زالت كما هي ─────────────
-- متوقّع: true.
select (to_regprocedure('public.ops_can_view()') is not null) as batch7b_intact;

-- ─── 15) ★ منع الحجز المزدوج مُشغِّل على الجدول، لا تحذيرًا في الشاشة ★ ───
-- متوقّع: 3 صفوف، enabled_always_or_origin يساوي 'O' أو 'A' (لا 'D' = معطّل).
-- 'D' هنا يعني أنّ أحدهم عطّل الحارس: الازدواج صار ممكنًا من أيّ مسار.
select g.tgname, c.relname as on_table, g.tgenabled as enabled_always_or_origin,
       ((g.tgtype::int & 4) > 0) as fires_on_insert,
       ((g.tgtype::int & 16) > 0) as fires_on_update
from pg_trigger g join pg_class c on c.oid = g.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and not g.tgisinternal
  and g.tgname in ('trg_ops_crew_no_double_booking','trg_ops_equip_no_double_booking',
                   'trg_ops_job_no_double_booking')
order by g.tgname;

-- متوقّع: 3 صفوف، raises_distinct_code = true في كلّها.
select p.proname, (pg_get_functiondef(p.oid) ilike '%23P01%') as raises_distinct_code
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('prodops_guard_crew','prodops_guard_equipment','prodops_guard_job')
order by p.proname;

-- متوقّع: صفّ واحد بكلّ الأعمدة NULL — كاشف التعارض لا يخترع تعارضًا من العدم.
select public.prodops_person_clash('00000000-0000-0000-0000-000000000000',
         '00000000-0000-0000-0000-000000000000', now(), now() + interval '1 hour') as person_clash,
       public.prodops_asset_clash('00000000-0000-0000-0000-000000000000',
         '00000000-0000-0000-0000-000000000000', now(), now() + interval '1 hour') as asset_clash,
       public.prodops_location_clash('00000000-0000-0000-0000-000000000000',
         '00000000-0000-0000-0000-000000000000', now(), now() + interval '1 hour') as location_clash;

-- متوقّع: صفر صفّ — لا حارس ولا كاشف تعارض مكشوف لدور الواجهة.
select f.sig from (values
  ('public.prodops_person_clash(uuid,uuid,timestamptz,timestamptz)'),
  ('public.prodops_asset_clash(uuid,uuid,timestamptz,timestamptz)'),
  ('public.prodops_location_clash(uuid,uuid,timestamptz,timestamptz)')) f(sig)
where to_regprocedure(f.sig) is not null
  and has_function_privilege('authenticated', f.sig, 'EXECUTE');

-- ─── 16) ★ توقيع النسخ الاحتياطي شخصيّ ★ ─────────────────────────────────
-- متوقّع: صفّ واحد، checks_card_holder = true وrefuses_non_holder = true
-- وsigner_from_session = true. false في أيٍّ منها = زميل يوقّع نيابةً عن غيره.
select (pg_get_functiondef(to_regprocedure('public.prodops_backup_step(uuid,text,boolean,text)'))
          ilike '%holder_user_id%') as checks_card_holder,
       (pg_get_functiondef(to_regprocedure('public.prodops_backup_step(uuid,text,boolean,text)'))
          ilike '%not_card_holder%') as refuses_non_holder,
       (pg_get_functiondef(to_regprocedure('public.prodops_backup_step(uuid,text,boolean,text)'))
          ilike '%verified_by%auth.uid()%') as signer_from_session;
