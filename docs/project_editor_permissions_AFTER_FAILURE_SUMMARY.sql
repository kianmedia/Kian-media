-- ════════════════════════════════════════════════════════════════════════════
-- مسبار حالة الإنتاج بعد فشل project_editor_permissions_RUNME — **مختصر**
-- Result Set **واحد** · 10 صفوف · قراءة فقط بالكامل
--
-- لماذا هذا الملفّ: محرّر Supabase يعرض آخر Result Set فقط، فالملفّ المفصّل
-- (project_editor_permissions_AFTER_FAILURE_VERIFY.sql) كان يُظهر الفحص العاشر
-- وحده. هنا كل الفحوص العشرة في استعلام واحد، ثم بوّابة تُغلق فشلًا.
--
-- ★ قاعدة القراءة ★
--   الفحصان 3 و4 يصفان **الثغرة القديمة**، ووجودها **قبل** تطبيق الإصلاح
--   هو المتوقَّع الصحيح، ولذلك نتيجتهما `EXPECTED` لا `FAIL`. البوّابة في
--   الأسفل لا تسقط بسببهما — تسقط فقط على **حالة جزئية** لم يتراجع عنها
--   التشغيل الفاشل، أو على انكسار في عمل سابق.
--
-- ⛔ لا create/alter/insert/update/delete/grant/revoke في هذا الملفّ.
-- ⛔ لا يلمس public.project_transition_requests مباشرة (قد لا يكون موجودًا،
--    والإشارة إليه تُفشل الاستعلام كلّه عند التحليل) — الوصول عبر الفهارس فقط.
-- ════════════════════════════════════════════════════════════════════════════

with
-- ── مواد خام من الفهارس (آمنة حتى لو غاب الكائن) ────────────────────────────
new_preds as (
  select count(*)::int as n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('can_move_deliverable','can_send_to_client_review',
                       'can_finalize_deliverable','can_move_project_stage',
                       'can_request_project_transition','can_approve_project_transition')
),
bulk as (
  select to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)') as oid
),
bulk_def as (
  select case when (select oid from bulk) is null then null
              else pg_get_functiondef((select oid from bulk)) end as d
),
units as (
  select case when to_regprocedure('public.project_units_can_write(uuid)') is null then null
              else pg_get_functiondef(to_regprocedure('public.project_units_can_write(uuid)')) end as d
),
tr as (
  select (to_regclass('public.project_transition_requests') is not null) as tbl,
         (to_regprocedure('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)') is not null) as fn_create,
         (to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)') is not null) as fn_decide
),
tr_pol as (
  select count(*)::int as n from pg_policies
   where schemaname = 'public' and tablename = 'project_transition_requests'
),
new_grants as (
  select count(*)::int as n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('can_move_deliverable','can_send_to_client_review',
                       'can_finalize_deliverable','can_move_project_stage',
                       'can_request_project_transition','can_approve_project_transition')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))
),
sec4 as (   -- الدوالّ التي كان §4 سيضيّقها: أيّها صار يحمل الحارس الجديد؟
  select count(*)::int as n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('project_core_set_stage','pc_deliverable_review',
                       'staff_set_deliverable','staff_add_deliverable')
     and pg_get_functiondef(p.oid) ilike '%can_send_to_client_review%'
),
fixes as (
  select
    coalesce((select pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
                ilike '%role_change_denied%'), false) as fix_a,
    coalesce((select pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'))
                ilike '%can_manage_identity%'), false) as fix_b,
    (public.can_manage_hr() is not null) as fix_c
),
platform as (
  select (to_regclass('public.deliverable_internal') is not null) as lp,
         (to_regclass('public.import_batches') is not null)       as bi,
         (to_regclass('public.deliverable_content_types') is not null) as ct
),
-- ── الفحوص العشرة ───────────────────────────────────────────────────────────
rows_ as (
  select 1 as check_number,
         'مُسنِدات الصلاحيات الستّة الجديدة' as check_name,
         '0' as expected,
         (select n::text from new_preds) as actual,
         case when (select n from new_preds) = 0 then 'PASS' else 'FAIL' end as result
  union all
  select 2, 'نسخة large_project_deliverables_bulk_update',
         'النسخة القديمة (بلا حرّاس)',
         case when (select d from bulk_def) is null then 'الدالّة غير موجودة'
              when (select d from bulk_def) ilike '%can_move_deliverable%' then 'النسخة الجديدة'
              else 'النسخة القديمة' end,
         case when (select d from bulk_def) is null then 'FAIL'
              when (select d from bulk_def) ilike '%can_move_deliverable%' then 'FAIL'
              else 'PASS' end
  union all
  select 3, 'project_units_can_write ما زالت تمرّر is_kian_member',
         'true قبل الإصلاح',
         case when (select d from units) is null then 'الدالّة غير موجودة'
              when (select d from units) ilike '%is_kian_member%' then 'true'
              else 'false' end,
         case when (select d from units) is null then 'FAIL'
              when (select d from units) ilike '%is_kian_member%' then 'EXPECTED'
              else 'FIXED' end
  union all
  select 4, 'ثغرة المونتير (stage_id / status / client_visible)',
         'مفتوحة قبل الإصلاح',
         case when (select d from bulk_def) is null then 'غير معروف'
              when (select d from bulk_def) ilike '%can_move_deliverable%' then 'مُغلقة'
              else 'مفتوحة' end,
         case when (select d from bulk_def) is null then 'FAIL'
              when (select d from bulk_def) ilike '%can_move_deliverable%' then 'FIXED'
              else 'EXPECTED' end
  union all
  select 5, 'كائنات Transition Approval (جدول + دالّتان)',
         'لا شيء منها',
         (select (case when tbl then 'جدول ' else '' end ||
                  case when fn_create then 'create ' else '' end ||
                  case when fn_decide then 'decide' else '' end) from tr),
         case when (select (tbl or fn_create or fn_decide) from tr) then 'FAIL' else 'PASS' end
  union all
  select 6, 'سياسات RLS على جدول الطلبات',
         '0',
         (select n::text from tr_pol),
         case when (select n from tr_pol) = 0 then 'PASS' else 'FAIL' end
  union all
  select 7, 'منح EXECUTE على المُسنِدات الجديدة',
         '0',
         (select n::text from new_grants),
         case when (select n from new_grants) = 0 then 'PASS' else 'FAIL' end
  union all
  select 8, 'دوالّ §4 ضُيّقت جزئيًّا؟',
         '0 من 4',
         (select n::text || ' من 4' from sec4),
         case when (select n from sec4) = 0 then 'PASS' else 'FAIL' end
  union all
  select 9, 'Fix A / Fix B / Fix C سليمة',
         'الثلاثة true',
         (select 'A=' || fix_a::text || ' B=' || fix_b::text || ' C=' || fix_c::text from fixes),
         case when (select (fix_a and fix_b and fix_c) from fixes) then 'PASS' else 'FAIL' end
  union all
  select 10, 'Large Projects + Bulk Import سليمة',
         'الثلاثة موجودة',
         (select 'LP=' || lp::text || ' BI=' || bi::text || ' CT=' || ct::text from platform),
         case when (select (lp and bi and ct) from platform) then 'PASS' else 'FAIL' end
)
select check_number, check_name, expected, actual, result
  from rows_
 order by check_number;


-- ════════════════════════════════════════════════════════════════════════════
-- بوّابة fail-closed — ترفع ERROR على **الحالة الجزئية** وحدها.
--   • 3 و4 = EXPECTED قبل الإصلاح ⇒ لا تُسقط البوّابة إطلاقًا.
--   • ما يُسقطها: بقايا من تشغيل فاشل (1,2,5,6,7,8) أو انكسار سابق (9,10).
-- شغّلها بعد قراءة الجدول أعلاه. لا تكتب شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
do $gate$
declare
  v_preds int; v_grants int; v_pol int; v_sec4 int;
  v_tr boolean; v_bulk text; v_units text;
  v_a boolean; v_b boolean; v_c boolean;
  v_lp boolean; v_bi boolean; v_ct boolean;
  v_bad text := '';
begin
  select count(*) into v_preds from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname in ('can_move_deliverable','can_send_to_client_review',
     'can_finalize_deliverable','can_move_project_stage','can_request_project_transition',
     'can_approve_project_transition');

  select count(*) into v_grants from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname in ('can_move_deliverable','can_send_to_client_review',
     'can_finalize_deliverable','can_move_project_stage','can_request_project_transition',
     'can_approve_project_transition')
     and (has_function_privilege('authenticated', p.oid,'execute')
          or has_function_privilege('anon', p.oid,'execute'));

  select count(*) into v_pol from pg_policies
   where schemaname='public' and tablename='project_transition_requests';

  select count(*) into v_sec4 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname in ('project_core_set_stage','pc_deliverable_review',
     'staff_set_deliverable','staff_add_deliverable')
     and pg_get_functiondef(p.oid) ilike '%can_send_to_client_review%';

  v_tr := to_regclass('public.project_transition_requests') is not null
       or to_regprocedure('public.project_transition_request_create(uuid,uuid,text,text,text,text,boolean)') is not null
       or to_regprocedure('public.project_transition_request_decide(uuid,text,text,boolean)') is not null;

  v_bulk  := case when to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)') is null
                  then null else pg_get_functiondef(to_regprocedure(
                    'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)')) end;
  v_units := case when to_regprocedure('public.project_units_can_write(uuid)') is null
                  then null else pg_get_functiondef(to_regprocedure('public.project_units_can_write(uuid)')) end;

  v_a := coalesce(pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
                    ilike '%role_change_denied%', false);
  v_b := coalesce(pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'))
                    ilike '%can_manage_identity%', false);
  v_c := public.can_manage_hr() is not null;

  v_lp := to_regclass('public.deliverable_internal') is not null;
  v_bi := to_regclass('public.import_batches') is not null;
  v_ct := to_regclass('public.deliverable_content_types') is not null;

  -- ── حالة جزئية: بقايا من التشغيل الفاشل ───────────────────────────────────
  if v_preds > 0 then v_bad := v_bad || format(' [1] %s مُسنِدات جديدة بقيت.', v_preds); end if;
  if v_bulk is not null and v_bulk ilike '%can_move_deliverable%'
    then v_bad := v_bad || ' [2] النسخة الجديدة من bulk_update بقيت.'; end if;
  if v_tr    then v_bad := v_bad || ' [5] كائنات Transition Approval أُنشئت جزئيًّا.'; end if;
  if v_pol   > 0 then v_bad := v_bad || format(' [6] %s سياسة على جدول الطلبات.', v_pol); end if;
  if v_grants> 0 then v_bad := v_bad || format(' [7] %s منح EXECUTE جديدة.', v_grants); end if;
  if v_sec4  > 0 then v_bad := v_bad || format(' [8] %s من دوالّ §4 ضُيّقت جزئيًّا.', v_sec4); end if;

  -- ── انكسار في عمل سابق ────────────────────────────────────────────────────
  if v_bulk  is null then v_bad := v_bad || ' [2] large_project_deliverables_bulk_update مفقودة.'; end if;
  if v_units is null then v_bad := v_bad || ' [3] project_units_can_write مفقودة.'; end if;
  if not v_a then v_bad := v_bad || ' [9] Fix A غير سليم.'; end if;
  if not v_b then v_bad := v_bad || ' [9] Fix B غير سليم.'; end if;
  if not v_c then v_bad := v_bad || ' [9] Fix C غير سليم (مُسنِد يعيد NULL).'; end if;
  if not v_lp then v_bad := v_bad || ' [10] deliverable_internal مفقود.'; end if;
  if not v_bi then v_bad := v_bad || ' [10] import_batches مفقود.'; end if;
  if not v_ct then v_bad := v_bad || ' [10] deliverable_content_types مفقود.'; end if;

  if v_bad <> '' then
    raise exception E'⛔ حالة غير متوقَّعة — لا تُعِد تشغيل RUNME. أبلغ أوّلًا:%', v_bad;
  end if;

  -- الثغرة القديمة قائمة؟ هذا **متوقَّع** قبل الإصلاح، وليس فشلًا.
  if v_units ilike '%is_kian_member%' then
    raise notice '✅ التراجع كامل ولا حالة جزئية. الثغرة القديمة ما زالت مفتوحة كما هو متوقَّع — طبّق النسخة المصحَّحة.';
  else
    raise notice '✅ التراجع كامل، ويبدو أن التضييق مُطبَّق سلفًا على project_units_can_write — راجع الفحص 3 قبل إعادة التشغيل.';
  end if;
end $gate$;
