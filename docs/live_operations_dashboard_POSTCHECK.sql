-- ════════════════════════════════════════════════════════════════════════════
-- live_operations_dashboard_POSTCHECK.sql       (READ-ONLY — مجموعة نتائج واحدة)
--
-- يُنفَّذ بعد live_operations_dashboard_RUNME.sql. **جملة SQL واحدة** تُرجع جدول
-- فحوص: محرّر SQL يعرض نتيجة الجملة الأخيرة فقط، فلو كُتبت الفحوص جملًا متتالية
-- لضاعت كلّها إلّا الأخيرة، ولبدا الملفّ ناجحًا وهو لم يُقرأ أصلًا.
--
-- ─── لماذا ساكن بالكامل ────────────────────────────────────────────────────
-- المحرّر يعمل بدور postgres و auth.uid() = NULL. أيّ نداء لدالّة محميّة هنا
-- يرفع «not authorized» فيقتل الفحص كلّه، وأيّ نداء لدالّة تكتب يلوّث سجلّ
-- عمليات حقيقيًّا. لذلك كلّ فحص مصدره pg_catalog: وجود الكائن، و**جسمه** عبر
-- pg_get_functiondef مع ilike، وقيوده وسياساته ومنحه.
-- الاستثناء الوحيد: liveops_secret_reason — دالّة immutable خالصة بلا سياق
-- جلسة ولا كتابة، فاستدعاؤها هنا آمن ويثبت السلوك لا الشكل.
--
-- ─── لماذا to_regclass/to_regprocedure في كلّ مرجع ─────────────────────────
-- ذكر جدول غائب في FROM ينهار بـ42P01 ويقتل الملفّ بدل أن يُبلّغ عن الغياب.
--
-- القراءة: كلّ صفّ verdict = '✅ PASS' ⇒ نجاح. أيّ '❌ FAIL' ⇒ اقرأ عمود actual
-- قبل أيّ شيء. صفوف 'ℹ️ INFO' توثيقية ولا تُفشل شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
with
src as (
  select
    to_regprocedure('public.liveops_client_payload(uuid)')                    as oid_payload,
    to_regprocedure('public.liveops_client_view(text,text)')                  as oid_view,
    to_regprocedure('public.liveops_client_preview(uuid)')                    as oid_preview,
    to_regprocedure('public.liveops_session_guard()')                         as oid_guard,
    to_regprocedure('public.liveops_session_set_status(uuid,text,text,text)') as oid_status,
    to_regprocedure('public.liveops_health_record(jsonb)')                    as oid_health,
    to_regprocedure('public.liveops_link_issue(uuid)')                        as oid_issue,
    to_regprocedure('public.liveops_link_list(uuid)')                         as oid_links,
    to_regprocedure('public.liveops_incident_release_root_cause(uuid,boolean,text)') as oid_release,
    to_regprocedure('public.liveops_report_approve(uuid,text)')               as oid_approve,
    to_regprocedure('public.liveops_client_text_guard()')                     as oid_scan,
    to_regprocedure('public.liveops_secret_reason(text)')                     as oid_reason,
    to_regprocedure('public.liveops_can_operate_session(uuid)')               as oid_opsess
),
defs as (
  select
    coalesce(pg_get_functiondef((select oid_payload from src)), '') as d_payload,
    coalesce(pg_get_functiondef((select oid_view    from src)), '') as d_view,
    coalesce(pg_get_functiondef((select oid_preview from src)), '') as d_preview,
    coalesce(pg_get_functiondef((select oid_guard   from src)), '') as d_guard,
    coalesce(pg_get_functiondef((select oid_status  from src)), '') as d_status,
    coalesce(pg_get_functiondef((select oid_health  from src)), '') as d_health,
    coalesce(pg_get_functiondef((select oid_issue   from src)), '') as d_issue,
    coalesce(pg_get_functiondef((select oid_links   from src)), '') as d_links,
    coalesce(pg_get_functiondef((select oid_release from src)), '') as d_release,
    coalesce(pg_get_functiondef((select oid_scan    from src)), '') as d_scan
),
tabs as (
  select v.t
    from (values ('liveops_sessions'),('liveops_inventory'),('liveops_stream_health'),
                 ('liveops_rundown'),('liveops_cues'),('liveops_incidents'),
                 ('liveops_bulletins'),('liveops_client_people'),('liveops_reports'),
                 ('liveops_client_links'),('liveops_link_access_log'),('liveops_audit')) v(t)
),
preds as (
  select v.f,
         coalesce(pg_get_functiondef(to_regprocedure('public.'||v.f)), '') as def,
         coalesce((select p.prorettype = 'boolean'::regtype from pg_proc p
                    where p.oid = to_regprocedure('public.'||v.f)), false)  as is_bool
    from (values ('liveops_is_client()'),('liveops_can_view()'),('liveops_can_manage()'),
                 ('liveops_can_operate()'),('liveops_can_operate_session(uuid)'),
                 ('liveops_can_read_session(uuid)'),('liveops_can_issue_client_link()'),
                 ('liveops_can_reveal_root_cause()'),('liveops_can_approve_report()'),
                 ('liveops_perm(text)')) v(f)
),
-- الأعمدة التي لا يجوز أن يذكرها باني حمولة العميل إطلاقًا.
forbidden as (
  select v.c from (values
    ('internal_notes'),('primary_contact_phone'),('emergency_contact_phone'),
    ('primary_contact_name'),('emergency_contact_name'),('token_hash'),('adapter_id'),
    ('delivered_files_internal'),('internal_summary'),('incident_summary_internal'),
    ('upload_kbps'),('latency_ms'),('packet_loss_pct'),('current_bitrate_kbps'),
    ('target_bitrate_kbps'),('venue'),('control_room'),('session_code'),('internal_ref'),
    ('mitigation'),('operations_manager_id'),('broadcast_director_id'),
    ('technical_director_id'),('assigned_name'),('prodops_job_id'),('project_id')) v(c)
),
checks as (

  -- ١) الجداول موجودة
  select 1 as ord, 'الجداول الاثنا عشر موجودة' as check_name,
         '12' as expected,
         (select count(*)::text from tabs where to_regclass('public.'||t) is not null) as actual,
         case when (select count(*) from tabs where to_regclass('public.'||t) is null) = 0
              then '✅ PASS' else '❌ FAIL' end as verdict

  -- ٢) RLS مفعّلة على الكلّ
  union all select 2, 'RLS مفعّلة على كلّ جدول', '12',
         coalesce((select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname like 'liveops\_%' and c.relrowsecurity), '0'),
         case when (select count(*) from tabs
                     where coalesce((select c.relrowsecurity from pg_class c
                                      join pg_namespace n on n.oid=c.relnamespace
                                     where n.nspname='public' and c.relname = tabs.t), false) = false) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٣) ★ FORCE RLS مطفأة — تفعيلها يُصفّر قراءات دوالّ SECURITY DEFINER
  union all select 3, '★ FORCE RLS مطفأة (وإلّا تعطّلت الوحدة)', '0',
         coalesce((select count(*)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname like 'liveops\_%' and c.relforcerowsecurity), '0'),
         case when coalesce((select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
                    where n.nspname='public' and c.relname like 'liveops\_%' and c.relforcerowsecurity),0) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٤) ★ لا سياسة كتابة: كلّ كتابة عبر دالّة مدقَّقة
  union all select 4, '★ لا سياسة كتابة على أيّ جدول', '0',
         coalesce((select count(*)::text from pg_policies
                    where schemaname='public' and tablename like 'liveops\_%' and cmd <> 'SELECT'), '0'),
         case when coalesce((select count(*) from pg_policies
                    where schemaname='public' and tablename like 'liveops\_%' and cmd <> 'SELECT'),0) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٥) ★★ anon بلا أيّ منح على جداول الوحدة
  union all select 5, '★★ anon/PUBLIC بلا منح على جداول الوحدة', '0',
         coalesce((select count(*)::text from information_schema.role_table_grants
                    where table_schema='public' and table_name like 'liveops\_%'
                      and grantee in ('anon','PUBLIC')), '0'),
         case when coalesce((select count(*) from information_schema.role_table_grants
                    where table_schema='public' and table_name like 'liveops\_%'
                      and grantee in ('anon','PUBLIC')),0) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٦) ★★ جدول الروابط وسجلّه لا يُقرآن مباشرة (لئلّا تخرج بصمة رمز)
  union all select 6, '★★ جدول الروابط وسجلّه بلا منح قراءة مباشرة', '0',
         coalesce((select count(*)::text from information_schema.role_table_grants
                    where table_schema='public'
                      and table_name in ('liveops_client_links','liveops_link_access_log')
                      and grantee in ('authenticated','anon','PUBLIC')), '0'),
         case when coalesce((select count(*) from information_schema.role_table_grants
                    where table_schema='public'
                      and table_name in ('liveops_client_links','liveops_link_access_log')
                      and grantee in ('authenticated','anon','PUBLIC')),0) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٧) ★★ الدالّة الخارجية ليست ممنوحة لدور عامّ
  union all select 7, '★★ liveops_client_view غير ممنوحة لـanon/authenticated', '0',
         coalesce((select count(*)::text from information_schema.role_routine_grants
                    where routine_schema='public' and routine_name='liveops_client_view'
                      and grantee in ('anon','authenticated','PUBLIC')), '0'),
         case when coalesce((select count(*) from information_schema.role_routine_grants
                    where routine_schema='public' and routine_name='liveops_client_view'
                      and grantee in ('anon','authenticated','PUBLIC')),0) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٨) كلّ مُسنَد boolean، وبـcoalesce/case، وبـsearch_path مثبَّت
  union all select 8, 'المُسنَدات العشرة: boolean + لا NULL + search_path', '10 سليمة',
         (select count(*)::text from preds
           where is_bool and def ~* '(coalesce|case)' and def ~* 'search_path'),
         case when (select count(*) from preds
                     where not (is_bool and def ~* '(coalesce|case)' and def ~* 'search_path')) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٩) ★★★ حمولة العميل لا تذكر عمودًا حسّاسًا
  union all select 9, '★★★ حمولة العميل خالية من الأعمدة الحسّاسة', 'صفر تسريب',
         coalesce((select string_agg(c, ', ') from forbidden
                    where (select d_payload from defs) ilike '%'||c||'%'), 'لا شيء'),
         case when (select d_payload from defs) = '' then '❌ FAIL'
              when exists (select 1 from forbidden where (select d_payload from defs) ilike '%'||c||'%')
              then '❌ FAIL' else '✅ PASS' end

  -- ١٠) ★★ حمولة العميل بلا select * وبلا وصف الحادثة الداخليّ
  union all select 10, '★★ لا select * ولا وصف حادثة داخليّ في حمولة العميل', 'كلاهما غائب',
         case when (select d_payload from defs) ilike '%select *%' then 'select * موجود'
              when (select d_payload from defs) ~* '\yi\.description\y' then 'i.description موجود'
              else 'كلاهما غائب' end,
         case when (select d_payload from defs) ilike '%select *%'
                or (select d_payload from defs) ~* '\yi\.description\y'
              then '❌ FAIL' else '✅ PASS' end

  -- ١١) ★★ السبب الجذريّ مشروط بالإفراج، والقياسات مُصرَّح بحالتها
  union all select 11, '★★ السبب الجذريّ مشروط + تصريح حالة القياسات', 'كلاهما موجود',
         case when (select d_payload from defs) !~* 'root_cause_released' then 'شرط الإفراج غائب'
              when (select d_payload from defs) !~* 'telemetry_connected' then 'تصريح القياسات غائب'
              else 'كلاهما موجود' end,
         case when (select d_payload from defs) ~* 'root_cause_released'
               and (select d_payload from defs) ~* 'telemetry_connected'
              then '✅ PASS' else '❌ FAIL' end

  -- ١٢) ★★★ استجابة رفض واحدة لا أوراكل
  union all select 12, '★★★ رمز مجهول/منتهٍ/ملغى ⇒ استجابة واحدة', '3 مسارات ⇒ DENY',
         (select count(*)::text from regexp_matches((select d_view from defs), 'return DENY;', 'g')),
         case when (select count(*) from regexp_matches((select d_view from defs), 'return DENY;','g')) >= 3
               and (select d_view from defs) !~ 'return jsonb_build_object\(''ok'', *false'
               and (select count(*) from regexp_matches((select d_view from defs),'invalid_or_expired','g')) = 1
              then '✅ PASS' else '❌ FAIL' end

  -- ١٣) الرمز يُبصَم قبل البحث ولا يُخزَّن خامًّا
  union all select 13, 'الرمز يُبصَم بـsha256 قبل البحث', 'sha256 موجودة',
         case when (select d_view from defs) ~* 'sha256' then 'موجودة' else 'غائبة' end,
         case when (select d_view from defs) ~* 'sha256'
               and (select d_issue from defs) ~* 'sha256' then '✅ PASS' else '❌ FAIL' end

  -- ١٤) قيد شكل البصمة قائم (٦٤ محرفًا ستّ عشريًّا)
  union all select 14, 'قيد شكل بصمة الرمز قائم', 'liveops_link_hash_shape',
         coalesce((select conname from pg_constraint where conname='liveops_link_hash_shape'), 'غائب'),
         case when exists (select 1 from pg_constraint where conname='liveops_link_hash_shape')
              then '✅ PASS' else '❌ FAIL' end

  -- ١٥) ★★ سرد الروابط لا يُخرج البصمة
  union all select 15, '★★ سرد الروابط لا يُخرج token_hash', 'غائب',
         case when (select d_links from defs) ~* '''token_hash''' then 'موجود' else 'غائب' end,
         case when (select d_links from defs) ~* '''token_hash''' then '❌ FAIL' else '✅ PASS' end

  -- ١٦) ★★★ العميل لا يغيّر الحالة: الحارس مركَّب ويفحص الثلاثة
  union all select 16, '★★★ حارس الحالة مركَّب ويفحص العميل والسلطة والانتقال', 'مركَّب + 3 فحوص',
         case when not exists (select 1 from pg_trigger where tgname='liveops_sessions_guard' and not tgisinternal)
                then 'غير مركَّب'
              when (select d_guard from defs) !~* 'liveops_is_client' then 'لا يفحص العميل'
              when (select d_guard from defs) !~* 'liveops_can_operate_session' then 'لا يفحص السلطة'
              when (select d_guard from defs) !~* 'liveops_status_allowed' then 'لا يفحص الانتقال'
              else 'مركَّب + 3 فحوص' end,
         case when exists (select 1 from pg_trigger where tgname='liveops_sessions_guard' and not tgisinternal)
               and (select d_guard from defs) ~* 'liveops_is_client'
               and (select d_guard from defs) ~* 'liveops_can_operate_session'
               and (select d_guard from defs) ~* 'liveops_status_allowed'
              then '✅ PASS' else '❌ FAIL' end

  -- ١٧) ★★ دالّة تغيير الحالة تبدأ ببوّابة تشغيل الجلسة
  union all select 17, '★★ liveops_session_set_status تبدأ ببوّابة', 'liveops_can_operate_session',
         case when (select d_status from defs) ~* 'liveops_can_operate_session' then 'موجودة' else 'غائبة' end,
         case when (select d_status from defs) ~* 'liveops_can_operate_session'
              then '✅ PASS' else '❌ FAIL' end

  -- ١٨) ★★★ لا مسار يدويّ يُنتج قياسًا موثَّقًا
  union all select 18, '★★★ قيد صدق مصدر القياس + رفض telemetry_verified يدويًّا', 'قيد + رفض',
         case when not exists (select 1 from pg_constraint where conname='liveops_health_source_honest')
                then 'القيد غائب'
              when (select d_health from defs) !~* 'telemetry_not_connected' then 'الدالّة لا تصنّف بصدق'
              else 'قيد + رفض' end,
         case when exists (select 1 from pg_constraint where conname='liveops_health_source_honest')
               and (select d_health from defs) ~* 'telemetry_not_connected'
              then '✅ PASS' else '❌ FAIL' end

  -- ١٩) حارس أساس نسبة التشغيل مركَّب
  union all select 19, 'حارس uptime_basis مركَّب (لا «موثَّق» بلا قراءة)', 'liveops_reports_uptime',
         case when exists (select 1 from pg_trigger where tgname='liveops_reports_uptime' and not tgisinternal)
              then 'مركَّب' else 'غائب' end,
         case when exists (select 1 from pg_trigger where tgname='liveops_reports_uptime' and not tgisinternal)
              then '✅ PASS' else '❌ FAIL' end

  -- ٢٠) ★★ ماسح الأسرار مركَّب على الجداول السبعة
  union all select 20, '★★ ماسح الأسرار مركَّب على 7 جداول', '7',
         (select count(*)::text from pg_trigger
           where tgname like 'liveops\_%\_secret\_scan' and not tgisinternal),
         case when (select count(*) from pg_trigger
                     where tgname like 'liveops\_%\_secret\_scan' and not tgisinternal) = 7
              then '✅ PASS' else '❌ FAIL' end

  -- ٢١) ★★ الماسح يغطّي أصناف الأنماط السبعة.
  --     ⚠️ فحص **ساكن على الجسم**، لا نداء. نداء public.liveops_secret_reason
  --     هنا كان سيبدو آمنًا (دالّة immutable بلا كتابة)، لكنّه يُحلَّل عند بناء
  --     الخطّة: لو فشل RUNME فالدالّة غائبة، فينهار **الملفّ كلّه** بـ42883 بدل
  --     أن يقول «غائبة». الفحص الساكن يبلّغ ولا ينهار. السلوك يُثبَت في
  --     self-test داخل RUNME وفي tests/liveops_client_safe_view.test.js.
  union all select 21, '★★ الماسح يغطّي أصناف الأنماط السبعة', '7 أصناف',
         case when (select oid_reason from src) is null then 'الدالّة غائبة'
              else (select count(*)::text from (values
                     ('ip_address'),('stream_endpoint'),('stream_key'),('credential'),
                     ('storage_path'),('serial_number'),('financial')) k(c)
                    where coalesce(pg_get_functiondef((select oid_reason from src)),'') ilike '%'||k.c||'%')
         end,
         case when (select oid_reason from src) is null then '❌ FAIL'
              when (select count(*) from (values
                     ('ip_address'),('stream_endpoint'),('stream_key'),('credential'),
                     ('storage_path'),('serial_number'),('financial')) k(c)
                    where coalesce(pg_get_functiondef((select oid_reason from src)),'') ilike '%'||k.c||'%') = 7
              then '✅ PASS' else '❌ FAIL' end

  -- ٢٢) ★★ الإفراج عن السبب الجذريّ يمرّ بالماسح
  union all select 22, '★★ الإفراج عن السبب الجذريّ يُمسَح قبل خروجه', 'liveops_has_secret',
         case when (select d_release from defs) ~* 'liveops_has_secret' then 'يُمسَح' else 'لا يُمسَح' end,
         case when (select d_release from defs) ~* 'liveops_has_secret'
               and (select d_release from defs) ~* 'liveops_can_reveal_root_cause'
              then '✅ PASS' else '❌ FAIL' end

  -- ٢٣) ★★ المعاينة والسطح الخارجيّ يتشاركان بانيًا واحدًا
  union all select 23, '★★ المعاينة تستدعي نفس باني حمولة العميل', 'باني واحد',
         case when (select d_preview from defs) ~* 'liveops_client_payload' then 'باني واحد' else 'بانيان' end,
         case when (select d_preview from defs) ~* 'liveops_client_payload'
               and (select d_view from defs) ~* 'liveops_client_payload'
              then '✅ PASS' else '❌ FAIL' end

  -- ٢٤) ★★ لا مفتاح أجنبيّ نحو وحدة مجمَّدة/مكتملة
  union all select 24, '★★ لا مفتاح أجنبيّ نحو projects/ops_jobs/deliverables', '0',
         coalesce((select count(*)::text from pg_constraint c
                    join pg_class ch on ch.oid=c.conrelid join pg_class pr on pr.oid=c.confrelid
                   where c.contype='f' and ch.relname like 'liveops\_%'
                     and pr.relname in ('projects','project_core','deliverables','ops_jobs')), '0'),
         case when coalesce((select count(*) from pg_constraint c
                    join pg_class ch on ch.oid=c.conrelid join pg_class pr on pr.oid=c.confrelid
                   where c.contype='f' and ch.relname like 'liveops\_%'
                     and pr.relname in ('projects','project_core','deliverables','ops_jobs')),0) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٢٥) كلّ دوالّ الوحدة SECURITY DEFINER بـsearch_path مثبَّت
  union all select 25, 'كلّ دوالّ liveops_* المحميّة بـsearch_path مثبَّت', 'صفر بلا تثبيت',
         coalesce((select count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.proname like 'liveops\_%' and p.prosecdef
                      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg
                                       where cfg like 'search_path=%')), '0'),
         case when coalesce((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                    where n.nspname='public' and p.proname like 'liveops\_%' and p.prosecdef
                      and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) cfg
                                       where cfg like 'search_path=%')),0) = 0
              then '✅ PASS' else '❌ FAIL' end

  -- ٢٦) كتالوج الصلاحيات (توثيقيّ — اختياريّ).
  --     ⚠️ لا نقرأ public.permissions هنا: ذكرها في FROM يُحلَّل عند بناء الخطّة،
  --     فلو كانت غائبة انهار الملفّ كلّه بـ42P01 بدل أن يقول «غائبة». الوجود
  --     وحده كافٍ — البذر نفسه مشروط بالوجود داخل RUNME.
  union all select 26, 'كتالوج الصلاحيات موجود (بذر live_ops.* مشروط به)', 'موجود أو غائب',
         case when to_regclass('public.permissions') is null
              then 'غائب — البوّابات تعتمد على المالك/الأدمن (fail closed)'
              else 'موجود — بُذرت مفاتيح live_ops.* الخمسة' end,
         'ℹ️ INFO'

  -- ٢٧) حالة الوحدة — توثيقيّ
  union all select 27, 'حالة الاتصال بالأجهزة في هذه النسخة', 'غير موصولة',
         'telemetry_not_connected — كلّ قيمة فنّية إدخال بشريّ', 'ℹ️ INFO'
)
select ord as "#", check_name as "الفحص", expected as "المتوقّع",
       actual as "الواقع", verdict as "النتيجة"
  from checks order by ord;
