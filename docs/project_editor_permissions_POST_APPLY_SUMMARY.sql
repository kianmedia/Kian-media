-- ════════════════════════════════════════════════════════════════════════════
-- حزمة صلاحيات المونتير — ملخّص ما بعد التطبيق · **قراءة فقط بالكامل**
-- Result Set **واحد** · 14 صفًّا · ثم بوّابة ترفع ERROR على الفشل الحقيقيّ.
--
-- محرّر Supabase يعرض آخر Result Set فقط، فهذا الملفّ يجمع الحكم كلّه في جدول
-- واحد. الملفّ المفصّل (project_editor_permissions_POSTCHECK.sql) يبقى للقراءة
-- التفصيلية قسمًا قسمًا.
--
-- ⛔ لا يستدعي أيّ دالّة تحتاج auth.uid(). محرّر SQL يعمل بدور `postgres` بلا
--    جلسة GoTrue، وأيّ نداء محميّ يرفع «not authorized» قبل بلوغ منطقه —
--    وهذا بالضبط ما أسقط النسخة السابقة بعد ترحيل **ناجح**.
--    (المُسنِدات الستّة تُستدعى بـnull هنا، وهي تُعيد false بلا جلسة — لا استثناء.)
--
-- ★ الصفّ 14 ★ project_units_can_write ما زالت تمرّر is_kian_member، و**هذا
--   مقصود**: هي بوّابة خشنة لها مستدعون آخرون، وتضييقها يوسّع دائرة الانفجار.
--   الإغلاق يقع لكل مفتاح حسّاس داخل bulk_update. لذلك نتيجته BY DESIGN لا FAIL.
-- ════════════════════════════════════════════════════════════════════════════

with
bulk as (
  select case when to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)') is null
              then null else pg_get_functiondef(to_regprocedure(
                'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) end as d
),
preds as (
  select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname in ('can_move_deliverable','can_send_to_client_review',
     'can_finalize_deliverable','can_move_project_stage','can_request_project_transition',
     'can_approve_project_transition')
),
nulls as (
  select (public.can_move_deliverable(null)           is not null
      and public.can_send_to_client_review(null)      is not null
      and public.can_finalize_deliverable(null)       is not null
      and public.can_move_project_stage(null)         is not null
      and public.can_request_project_transition(null) is not null
      and public.can_approve_project_transition(null) is not null) as ok
),
anon_exec as (
  select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and (p.proname in ('can_move_deliverable','can_send_to_client_review','can_finalize_deliverable',
          'can_move_project_stage','can_request_project_transition','can_approve_project_transition')
          or p.proname='large_project_deliverables_bulk_update')
     and has_function_privilege('anon', p.oid, 'execute')
),
sec4 as (
  select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname in ('pc_deliverable_review','staff_set_deliverable')
     and pg_get_functiondef(p.oid) ilike '%can_send_to_client_review%'
     and pg_get_functiondef(p.oid) ilike '%can_finalize_deliverable%'
),
units as (
  select case when to_regprocedure('public.project_units_can_write(uuid)') is null then null
              else pg_get_functiondef(to_regprocedure('public.project_units_can_write(uuid)')) end as d
),
tr as (
  select (to_regclass('public.project_transition_requests') is not null
       or to_regprocedure('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)') is not null) as any_obj
),
fixes as (
  select coalesce(pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
                    ilike '%role_change_denied%', false) as a,
         coalesce(pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'))
                    ilike '%can_manage_identity%', false) as b,
         (public.can_manage_hr() is not null) as c
),
plat as (
  select (to_regclass('public.deliverable_internal') is not null) as lp,
         (to_regclass('public.import_batches') is not null)       as bi,
         (to_regclass('public.deliverable_content_types') is not null) as ct
),
rows_ as (
  select 1 as check_number, 'المُسنِدات الستّة الجديدة موجودة' as check_name,
         '6' as expected, (select n::text from preds) as actual,
         case when (select n from preds)=6 then 'PASS' else 'FAIL' end as result
  union all select 2, 'النسخة الجديدة من bulk_update مطبَّقة', 'مطبَّقة',
    case when (select d from bulk) is null then 'مفقودة'
         when (select d from bulk) ilike '%can_move_deliverable%' then 'مطبَّقة'
         else 'النسخة القديمة' end,
    case when (select d from bulk) ilike '%can_move_deliverable%' then 'PASS' else 'FAIL' end
  union all select 3, 'stage_id محروس بـcan_move_deliverable', 'true',
    coalesce(((select d from bulk) ilike '%can_move_deliverable%')::text,'null'),
    case when (select d from bulk) ilike '%can_move_deliverable%' then 'PASS' else 'FAIL' end
  union all select 4, 'client_visible محروس بـcan_send_to_client_review', 'true',
    coalesce(((select d from bulk) ilike '%can_send_to_client_review%')::text,'null'),
    case when (select d from bulk) ilike '%can_send_to_client_review%' then 'PASS' else 'FAIL' end
  union all select 5, 'status محروس بـcan_finalize_deliverable', 'true',
    coalesce(((select d from bulk) ilike '%can_finalize_deliverable%')::text,'null'),
    case when (select d from bulk) ilike '%can_finalize_deliverable%' then 'PASS' else 'FAIL' end
  union all select 6, 'مسار المونتير المشروع draft → internal_review باقٍ', 'true',
    coalesce(((select d from bulk) ilike '%internal_review%')::text,'null'),
    case when (select d from bulk) ilike '%internal_review%' then 'PASS' else 'FAIL' end
  union all select 7, 'القائمة البيضاء احتفظت بمفاتيح المالك', 'الثلاثة',
    coalesce((((select d from bulk) ilike '%''stage_id''%')
          and ((select d from bulk) ilike '%''client_visible''%')
          and ((select d from bulk) ilike '%''status''%'))::text,'null'),
    case when (select d from bulk) ilike '%''stage_id''%'
          and (select d from bulk) ilike '%''client_visible''%'
          and (select d from bulk) ilike '%''status''%' then 'PASS' else 'FAIL' end
  union all select 8, 'بوّابة الجلسة تسبق مسار القائمة الفارغة', 'true',
    coalesce((position('auth.uid() is null' in (select d from bulk))
            < position('cardinality(v_ids) = 0' in (select d from bulk)))::text,'null'),
    case when (select d from bulk) is not null
          and position('auth.uid() is null' in (select d from bulk)) > 0
          and position('auth.uid() is null' in (select d from bulk))
            < position('cardinality(v_ids) = 0' in (select d from bulk)) then 'PASS' else 'FAIL' end
  union all select 9, 'المُسنِدات لا تعيد NULL (نداء فعليّ بـnull)', 'true',
    (select ok::text from nulls),
    case when (select ok from nulls) then 'PASS' else 'FAIL' end
  union all select 10, 'anon لا يملك EXECUTE على أيّ منها', '0',
    (select n::text from anon_exec),
    case when (select n from anon_exec)=0 then 'PASS' else 'FAIL' end
  union all select 11, 'دوالّ §4b/§4c ضُيّقت', '2 من 2',
    (select n::text||' من 2' from sec4),
    case when (select n from sec4)=2 then 'PASS' else 'FAIL' end
  union all select 12, 'Fix A / Fix B / Fix C سليمة', 'الثلاثة true',
    (select 'A='||a::text||' B='||b::text||' C='||c::text from fixes),
    case when (select (a and b and c) from fixes) then 'PASS' else 'FAIL' end
  union all select 13, 'Large Projects + Bulk Import سليمة · Transition لم تُطبَّق', 'كما هو',
    (select 'LP='||lp::text||' BI='||bi::text||' CT='||ct::text from plat)
      ||' TR='||(select case when any_obj then 'موجودة' else 'لا شيء' end from tr),
    case when (select (lp and bi and ct) from plat) and not (select any_obj from tr)
         then 'PASS' else 'FAIL' end
  union all select 14, 'project_units_can_write ما زالت تمرّر is_kian_member', 'true (مقصود)',
    coalesce(((select d from units) ilike '%is_kian_member%')::text,'null'),
    case when (select d from units) is null then 'FAIL'
         when (select d from units) ilike '%is_kian_member%' then 'BY DESIGN'
         else 'NARROWED' end
)
select check_number, check_name, expected, actual, result from rows_ order by check_number;


-- ════════════════════════════════════════════════════════════════════════════
-- البوّابة — ERROR على الفشل الحقيقيّ فقط. الصفّ 14 لا يُسقطها.
-- ════════════════════════════════════════════════════════════════════════════
do $gate$
declare d text; u text; n int; bad text := '';
begin
  d := case when to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)') is null
            then null else pg_get_functiondef(to_regprocedure(
              'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) end;
  u := case when to_regprocedure('public.project_units_can_write(uuid)') is null
            then null else pg_get_functiondef(to_regprocedure('public.project_units_can_write(uuid)')) end;

  if d is null then bad := bad || ' [2] bulk_update مفقودة.'; end if;
  if u is null then bad := bad || ' [14] project_units_can_write مفقودة.'; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in ('can_move_deliverable','can_send_to_client_review',
     'can_finalize_deliverable','can_move_project_stage','can_request_project_transition',
     'can_approve_project_transition');
  if n <> 6 then bad := bad || format(' [1] المُسنِدات %s لا 6.', n); end if;

  if d is not null then
    if d not ilike '%can_move_deliverable%'      then bad := bad || ' [3] stage_id بلا حارس.'; end if;
    if d not ilike '%can_send_to_client_review%' then bad := bad || ' [4] client_visible بلا حارس.'; end if;
    if d not ilike '%can_finalize_deliverable%'  then bad := bad || ' [5] status بلا حارس.'; end if;
    if d not ilike '%internal_review%'           then bad := bad || ' [6] مسار المونتير ضاع.'; end if;
    if d not ilike '%''stage_id''%' or d not ilike '%''client_visible''%' or d not ilike '%''status''%'
      then bad := bad || ' [7] القائمة البيضاء فقدت مفتاحًا — المالك تضرّر.'; end if;
    if position('auth.uid() is null' in d) = 0
       or position('auth.uid() is null' in d) > position('cardinality(v_ids) = 0' in d)
      then bad := bad || ' [8] بوّابة الجلسة لا تسبق مسار القائمة الفارغة.'; end if;
  end if;

  if public.can_move_deliverable(null) is null
     or public.can_send_to_client_review(null) is null
     or public.can_finalize_deliverable(null) is null
     or public.can_move_project_stage(null) is null
     or public.can_request_project_transition(null) is null
     or public.can_approve_project_transition(null) is null
    then bad := bad || ' [9] مُسنِد يعيد NULL — فشل مفتوح.'; end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public'
     and (p.proname in ('can_move_deliverable','can_send_to_client_review','can_finalize_deliverable',
          'can_move_project_stage','can_request_project_transition','can_approve_project_transition')
          or p.proname='large_project_deliverables_bulk_update')
     and has_function_privilege('anon', p.oid, 'execute');
  if n > 0 then bad := bad || format(' [10] anon يملك EXECUTE على %s.', n); end if;

  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname in ('pc_deliverable_review','staff_set_deliverable')
     and pg_get_functiondef(p.oid) ilike '%can_send_to_client_review%'
     and pg_get_functiondef(p.oid) ilike '%can_finalize_deliverable%';
  if n <> 2 then bad := bad || format(' [11] %s من 2 في §4b/§4c.', n); end if;

  if not coalesce(pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
                    ilike '%role_change_denied%', false) then bad := bad || ' [12] Fix A.'; end if;
  if not coalesce(pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'))
                    ilike '%can_manage_identity%', false) then bad := bad || ' [12] Fix B.'; end if;
  if public.can_manage_hr() is null then bad := bad || ' [12] Fix C يعيد NULL.'; end if;

  if to_regclass('public.deliverable_internal') is null
     or to_regclass('public.import_batches') is null
     or to_regclass('public.deliverable_content_types') is null
    then bad := bad || ' [13] المنصّة أو الاستيراد.'; end if;

  if bad <> '' then
    raise exception E'⛔ فشل حقيقيّ:%\n(قراءة فقط — لم يتغيّر شيء. لا تُعِد تشغيل RUNME؛ أبلغ أوّلًا.)', bad;
  end if;

  raise notice '✅ EDITOR SERVER GUARDS: APPLIED — STATICALLY VERIFIED';
  raise notice 'ℹ️  LIVE EDITOR BEHAVIOR: MANUAL ACCEPTANCE REQUIRED — BEHAVIOR_DIAGNOSTIC بجلستَي مونتير ومالك.';
  raise notice 'ℹ️  التالي: project_transition_approval_PREFLIGHT.sql ثم RUNME ثم POSTCHECK، وأخيرًا Push.';
end $gate$;
