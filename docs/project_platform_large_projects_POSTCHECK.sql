-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — منصّة المشاريع الكبيرة · فحص بعْديّ **للقراءة فقط**
-- docs/project_platform_large_projects_POSTCHECK.sql
-- ════════════════════════════════════════════════════════════════════════════
--   شغّله **بعد** docs/project_platform_large_projects_RUNME.sql.
--   لا begin/commit · لا create/alter · لا insert/update/delete · لا grant/revoke
--   · لا جدول مؤقّت. كتلة DO الأخيرة تقرأ فقط وترفع استثناءً عند أيّ FAIL.
--
--   ★ كل استعلام يطبع عمود «المتوقّع» بجانب «النتيجة» — لا تحتاج ذاكرة ولا مرجعًا.
--   ★ قارن الجزء (و) بالجزء (هـ) من الفحص القبْليّ: يجب أن يتطابقا حرفيًّا.
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- (أ) الأعمدة — المتوقّع: 28 صفًّا كلّها PASS
--     الصفوف 19..25 على public.deliverable_internal (الجدول الجانبي).
-- ─────────────────────────────────────────────────────────────────────────────
with want(ord, tbl, col) as (values
  ( 1,'deliverables','stage_id'),          ( 2,'deliverables','content_type'),
  ( 3,'deliverables','platforms'),         ( 4,'deliverables','execution_details'),
  ( 5,'deliverables','proposed_caption'),  ( 6,'deliverables','priority'),
  ( 7,'deliverables','client_visible'),    ( 8,'deliverables','sort_order'),
  ( 9,'deliverables','schedule_status'),   (10,'deliverables','planned_start_date'),
  (11,'deliverables','expected_units'),    (12,'deliverables','completed_units'),
  (13,'deliverables','recurrence_type'),   (14,'deliverables','recurrence_config'),
  (15,'deliverables','requires_shooting'), (16,'deliverables','requires_editing'),
  (17,'deliverables','requires_design'),   (18,'deliverables','requires_printing'),
  (19,'deliverable_internal','deliverable_id'),
  (20,'deliverable_internal','internal_notes'),
  (21,'deliverable_internal','external_key'),
  (22,'deliverable_internal','import_batch_id'),
  (23,'deliverable_internal','source_row_number'),
  (24,'deliverable_internal','source_file_name'),
  (25,'deliverable_internal','metadata'),
  (26,'projects','schedule_status'),       (27,'projects','planned_start_date'),
  (28,'projects','stage_order')
)
select w.ord                                        as "#",
       'public.'||w.tbl||'.'||w.col                 as "العمود",
       'موجود'                                      as "المتوقّع",
       case when c.column_name is null then 'FAIL — غير موجود' else 'PASS' end as "النتيجة",
       coalesce(c.data_type,'—')                    as "النوع",
       coalesce(c.column_default,'—')               as "الافتراضي"
from want w
left join information_schema.columns c
       on c.table_schema='public' and c.table_name=w.tbl and c.column_name=w.col
order by w.ord;


-- ─────────────────────────────────────────────────────────────────────────────
-- (أ-2) ★ الأهمّ أمنيًّا ★ الحقول الداخلية **غادرت** public.deliverables.
--       بقاء أيّ عمود منها = التسريب حيّ: العميل يقرؤه بـ
--       GET /rest/v1/deliverables?select=internal_notes  (RLS تُصفّي صفوفًا لا أعمدة).
-- ─────────────────────────────────────────────────────────────────────────────
with gone(col) as (values ('internal_notes'),('external_key'),('import_batch_id'),
                          ('source_row_number'),('source_file_name'),('metadata'))
select 'public.deliverables.'||g.col                as "العمود",
       'غير موجود'                                  as "المتوقّع",
       case when c.column_name is null then 'PASS'
            else '🔴 FAIL حرج — العمود ما زال على deliverables ⇒ العميل يقرؤه' end as "النتيجة"
from gone g
left join information_schema.columns c
       on c.table_schema='public' and c.table_name='deliverables' and c.column_name=g.col
order by g.col;


-- ─────────────────────────────────────────────────────────────────────────────
-- (أ-3) عزل الجدول الجانبي — RLS مفعّلة · سياستان بـ coalesce · لا منح anon
-- ─────────────────────────────────────────────────────────────────────────────
select '1. RLS مفعّلة على deliverable_internal'      as "المحور",
       'true'                                        as "المتوقّع",
       coalesce((select c.relrowsecurity::text from pg_class c
                  join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname='public' and c.relname='deliverable_internal'), 'الجدول مفقود') as "الفعليّ",
       case when coalesce((select c.relrowsecurity from pg_class c
                            join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname='public' and c.relname='deliverable_internal'), false)
            then 'PASS' else '🔴 FAIL حرج — الجدول مكشوف' end as "النتيجة"
union all
select '2. عدد السياسات', '2',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='deliverable_internal'),
       case when (select count(*) from pg_policies
                   where schemaname='public' and tablename='deliverable_internal') = 2
            then 'PASS' else 'FAIL' end
union all
select '3. سياسات بلا coalesce أو بلا البوّابة (تنهار إلى NULL)', '0',
       (select count(*)::text from pg_policies
         where schemaname='public' and tablename='deliverable_internal'
           and (coalesce(qual,'') not ilike '%coalesce%'
                or coalesce(qual,'') not ilike '%deliverable_internal_is_staff%')),
       case when (select count(*) from pg_policies
                   where schemaname='public' and tablename='deliverable_internal'
                     and (coalesce(qual,'') not ilike '%coalesce%'
                          or coalesce(qual,'') not ilike '%deliverable_internal_is_staff%')) = 0
            then 'PASS' else '🔴 FAIL' end
union all
select '4. منح anon/PUBLIC على deliverable_internal', '0',
       (select count(*)::text from information_schema.role_table_grants
         where table_schema='public' and table_name='deliverable_internal'
           and grantee in ('anon','PUBLIC')),
       case when (select count(*) from information_schema.role_table_grants
                   where table_schema='public' and table_name='deliverable_internal'
                     and grantee in ('anon','PUBLIC')) = 0
            then 'PASS' else '🔴 FAIL حرج' end
union all
select '5. صفوف جانبية يتيمة (بلا مخرج)', '0',
       coalesce((select count(*)::text from public.deliverable_internal i
                  where not exists (select 1 from public.deliverables d where d.id = i.deliverable_id)), '—'),
       case when coalesce((select count(*) from public.deliverable_internal i
                            where not exists (select 1 from public.deliverables d where d.id = i.deliverable_id)), 0) = 0
            then 'PASS' else 'FAIL — المفتاح الخارجي بـ cascade يمنع هذا' end;


-- ─────────────────────────────────────────────────────────────────────────────
-- (ب) ★ القيود ★ — المتوقّع: 0 قيد ضيّق · القيد المفتوح موجود · FK موجود
-- ─────────────────────────────────────────────────────────────────────────────
select '1. قيد type الضيّق (video/photo/other)'          as "المحور",
       '0'                                               as "المتوقّع",
       count(*)::text                                    as "الفعليّ",
       case when count(*) = 0 then 'PASS' else 'FAIL — القيد الضيّق ما زال حيًّا' end as "النتيجة"
  from pg_constraint c
 where c.conrelid = to_regclass('public.deliverables') and c.contype='c'
   and pg_get_constraintdef(c.oid) ilike '%video%' and pg_get_constraintdef(c.oid) ilike '%photo%'
   and pg_get_constraintdef(c.oid) not ilike '%photography%'
union all
select '2. deliverables_type_open_ck', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_constraint where conrelid = to_regclass('public.deliverables') and conname='deliverables_type_open_ck'
union all
select '3. deliverables_content_type_fk (FK إلى الجدول المرجعيّ)', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_constraint where conrelid = to_regclass('public.deliverables') and conname='deliverables_content_type_fk'
union all
select '4. deliverables_schedule_status_ck', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_constraint where conname='deliverables_schedule_status_ck'
union all
select '5. projects_schedule_status_ck', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_constraint where conname='projects_schedule_status_ck'
union all
select '6. العمود القديم deliverables.type لم يُحذف', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL حرج — العمود القديم اختفى' end
  from information_schema.columns
 where table_schema='public' and table_name='deliverables' and column_name='type'
union all
select '7. ux_deliverable_internal_external_key (فريد جزئيّ — idempotency الاستيراد)', '1', count(*)::text,
       case when count(*) = 1 then 'PASS' else 'FAIL' end
  from pg_indexes where schemaname='public' and indexname='ux_deliverable_internal_external_key'
union all
select '8. ux_deliverables_external_key (الفهرس القديم — يجب أن يزول مع عموده)', '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL — العمود القديم ما زال حيًّا' end
  from pg_indexes where schemaname='public' and indexname='ux_deliverables_external_key';


-- ─────────────────────────────────────────────────────────────────────────────
-- (ج) الجدول المرجعيّ والبيانات — المتوقّع: ≥13 نوعًا مفعّلًا · 0 مخرج بلا content_type
-- ─────────────────────────────────────────────────────────────────────────────
select 'أنواع محتوى مفعّلة'                      as "المؤشّر",
       '≥ 13'                                     as "المتوقّع",
       count(*) filter (where is_active)::text    as "الفعليّ",
       case when count(*) filter (where is_active) >= 13 then 'PASS' else 'FAIL' end as "النتيجة"
  from public.deliverable_content_types
union all
select 'أنواع مُدرَجة من انحراف بيانات (غير مفعّلة)', 'عادةً 0',
       count(*) filter (where not is_active)::text,
       case when count(*) filter (where not is_active) = 0 then 'PASS'
            else 'تنبيه — كانت هناك قيم type خارج المفردات؛ حُفظت ولم تُتلف' end
  from public.deliverable_content_types
union all
select 'مخرجات بلا content_type', '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL' end
  from public.deliverables where content_type is null
union all
select 'مخرجات بـ content_type لا يوجد في المرجع', '0', count(*)::text,
       case when count(*) = 0 then 'PASS' else 'FAIL — المفتاح الخارجي كان يجب أن يمنع هذا' end
  from public.deliverables d
 where d.content_type is not null
   and not exists (select 1 from public.deliverable_content_types t where t.key = d.content_type)
union all
select 'اتّساق type ↔ content_type (بعد المزامنة)', '0 خلاف', count(*)::text,
       case when count(*) = 0 then 'PASS'
            else 'تنبيه — صفوف قديمة كُتبت قبل Trigger المزامنة (غير ضارّ: القرّاء لديهم فرع else)' end
  from public.deliverables d
 where d.type is distinct from public.deliverable_content_type_legacy(d.content_type)
union all
select 'قيم schedule_status المتميّزة على المخرجات', 'ضمن المفردات الستّ',
       coalesce(string_agg(distinct coalesce(schedule_status,'∅'), ' · '), '∅'),
       case when count(*) filter (where coalesce(schedule_status,'') not in
              ('awaiting_schedule','scheduled','in_progress','done','on_hold','cancelled')) = 0
            then 'PASS' else 'FAIL' end
  from public.deliverables;


-- ─────────────────────────────────────────────────────────────────────────────
-- (د) الدوالّ والمشغّلات — المتوقّع: كلّها PASS و SECURITY DEFINER حيث يلزم
-- ─────────────────────────────────────────────────────────────────────────────
with want(ord, sig, need_definer) as (values
  ( 1,'public.deliverable_content_type_legacy(text)',      false),
  ( 2,'public.deliverable_status_progress_fraction(text)', false),
  ( 3,'public.project_hierarchy_max_depth()',              false),
  ( 4,'public.project_hierarchy_root(uuid)',               true),
  ( 5,'public.project_hierarchy_depth(uuid)',              true),
  ( 6,'public.project_hierarchy_can_parent(uuid,uuid)',    true),
  ( 7,'public.project_units_can_read(uuid)',               true),
  ( 8,'public.project_units_client_view(uuid)',            true),
  ( 9,'public.project_units_progress(uuid,uuid)',          true),
  (10,'public.project_units_rollup(uuid)',                 true),
  (11,'public.project_stage_progress(uuid)',               true),
  (12,'public.project_breadcrumb(uuid)',                   true),
  (13,'public.deliverable_content_types_list(boolean)',    true),
  (14,'public.deliverables_type_sync()',                   false),
  (15,'public.projects_depth_guard()',                     true),
  (16,'public.deliverables_stage_guard()',                 true)
)
select w.ord                                                          as "#",
       w.sig                                                          as "الدالّة",
       'موجودة + search_path=public'                                  as "المتوقّع",
       case when p.oid is null then 'FAIL — غير موجودة'
            when not exists (select 1 from unnest(coalesce(p.proconfig, array[]::text[])) x
                              where x like 'search_path=%') then 'FAIL — بلا search_path'
            when w.need_definer and not p.prosecdef then 'FAIL — ليست SECURITY DEFINER'
            else 'PASS' end                                           as "النتيجة",
       case when p.prosecdef then 'DEFINER' else 'INVOKER' end         as "الأمان"
from want w left join pg_proc p on p.oid = to_regprocedure(w.sig)
order by w.ord;

select 'trg_deliverables_type_sync'   as "المشغّل", '1' as "المتوقّع", count(*)::text as "الفعليّ",
       case when count(*)=1 then 'PASS' else 'FAIL' end as "النتيجة"
  from pg_trigger where tgrelid = to_regclass('public.deliverables') and tgname='trg_deliverables_type_sync'
union all
select 'trg_deliverables_stage_guard', '1', count(*)::text, case when count(*)=1 then 'PASS' else 'FAIL' end
  from pg_trigger where tgrelid = to_regclass('public.deliverables') and tgname='trg_deliverables_stage_guard'
union all
select 'trg_projects_depth_guard', '1', count(*)::text, case when count(*)=1 then 'PASS' else 'FAIL' end
  from pg_trigger where tgrelid = to_regclass('public.projects') and tgname='trg_projects_depth_guard';


-- ─────────────────────────────────────────────────────────────────────────────
-- (هـ) ★ الأمان ★ — المتوقّع: صفر لكل صفّ
-- ─────────────────────────────────────────────────────────────────────────────
select 'منح anon على deliverable_content_types'      as "المحور", '0' as "المتوقّع",
       count(*)::text                                 as "الفعليّ",
       case when count(*)=0 then 'PASS' else 'FAIL حرج' end as "النتيجة"
  from information_schema.role_table_grants
 where table_schema='public' and table_name='deliverable_content_types' and grantee='anon'
union all
select 'منح anon تنفيذ دوالّ الحزمة', '0', count(*)::text,
       case when count(*)=0 then 'PASS' else 'FAIL حرج' end
  from information_schema.role_routine_grants
 where routine_schema='public' and grantee='anon'
   and routine_name in ('project_units_progress','project_units_rollup','project_stage_progress',
                        'project_breadcrumb','project_hierarchy_can_parent','project_hierarchy_root',
                        'project_hierarchy_depth','deliverable_content_types_list',
                        'project_units_can_read','project_units_client_view')
union all
select 'RLS مفعّل على deliverable_content_types', 'true',
       coalesce((select case when relrowsecurity then 'true' else 'false' end
                   from pg_class where oid = to_regclass('public.deliverable_content_types')),'∅'),
       case when coalesce((select relrowsecurity from pg_class
                            where oid = to_regclass('public.deliverable_content_types')), false)
            then 'PASS' else 'FAIL' end
union all
select 'سياسات الجدول المرجعيّ (dct_read + dct_write)', '2', count(*)::text,
       case when count(*)=2 then 'PASS' else 'FAIL' end
  from pg_policies where schemaname='public' and tablename='deliverable_content_types';


-- ─────────────────────────────────────────────────────────────────────────────
-- (و) البصمات — يجب أن تتطابق حرفيًّا مع الجزء (هـ) من الفحص القبْليّ
--     (الحزمة لا تمسّ أيّ سياسة أو منح قائم على deliverables/projects)
-- ─────────────────────────────────────────────────────────────────────────────
select 'بصمة صلاحيات الجداول' as "المحور",
       coalesce(string_agg(grantee||':'||privilege_type, ' | ' order by grantee, privilege_type), '∅') as "القيمة"
  from information_schema.role_table_grants
 where table_schema='public' and table_name in ('deliverables','projects')
   and grantee in ('anon','authenticated','service_role')
union all
select 'بصمة سياسات RLS (deliverables/projects)',
       coalesce(string_agg(tablename||'.'||policyname, ' | ' order by tablename, policyname), '∅')
  from pg_policies where schemaname='public' and tablename in ('deliverables','projects');


-- ─────────────────────────────────────────────────────────────────────────────
-- (ز) برهان الخوارزمية — سُلّم الحالات وإسقاط النوع القديم، بلا لمس أيّ صفّ
-- ─────────────────────────────────────────────────────────────────────────────
select s                                                  as "الحالة",
       public.deliverable_status_progress_fraction(s)::text as "كسر الإنجاز",
       case s when 'draft' then '0.00' when 'revision_requested' then '0.50'
              when 'internal_review' then '0.60' when 'client_review' then '0.75'
              when 'approved' then '1.00' when 'final_delivered' then '1.00'
              else '0.00' end                             as "المتوقّع",
       case when public.deliverable_status_progress_fraction(s)::text =
                 (case s when 'draft' then '0.00' when 'revision_requested' then '0.50'
                         when 'internal_review' then '0.60' when 'client_review' then '0.75'
                         when 'approved' then '1.00' when 'final_delivered' then '1.00'
                         else '0.00' end)
            then 'PASS' else 'FAIL' end                   as "النتيجة"
from unnest(array['draft','internal_review','client_review','revision_requested',
                  'approved','final_delivered','archived']) s;

select k                                                     as "نوع المحتوى",
       public.deliverable_content_type_legacy(k)             as "الإسقاط على العمود القديم",
       case k when 'video' then 'video' when 'photography' then 'photo' else 'other' end as "المتوقّع",
       case when public.deliverable_content_type_legacy(k) =
                 (case k when 'video' then 'video' when 'photography' then 'photo' else 'other' end)
            then 'PASS' else 'FAIL' end                      as "النتيجة"
from unnest(array['video','photography','design','print','live_stream','event',
                  'field_execution','presentation','gift','report','digital_content',
                  'copywriting','custom']) k;

select 'حدّ عمق الهرمية' as "المحور", '8' as "المتوقّع",
       public.project_hierarchy_max_depth()::text as "الفعليّ",
       case when public.project_hierarchy_max_depth() = 8 then 'PASS' else 'FAIL' end as "النتيجة";


-- ─────────────────────────────────────────────────────────────────────────────
-- (ح) بوّابة الفشل الصاخب — قراءة محضة، ترفع استثناءً عند أيّ FAIL حرج
-- ─────────────────────────────────────────────────────────────────────────────
do $post$
declare v text := ''; c text; f text; n int;
begin
  foreach c in array array[
    'stage_id','content_type','platforms','execution_details','proposed_caption','priority',
    'client_visible','schedule_status','planned_start_date','expected_units',
    'completed_units','recurrence_type','recurrence_config','requires_shooting','requires_editing',
    'requires_design','requires_printing','sort_order']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='deliverables' and column_name=c)
      then v := v || ' deliverables.' || c; end if;
  end loop;

  -- ★ الفحص الأمنيّ الحاسم: الحقول الداخلية غادرت deliverables، والجدول الجانبي
  --   موجود ومعزول. أيّ إخفاق هنا يعني أن التسريب ما زال حيًّا.
  foreach c in array array['internal_notes','external_key','import_batch_id',
                           'source_row_number','source_file_name','metadata']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='deliverables' and column_name=c)
      then v := v || ' ★تسريب-حيّ:-deliverables.' || c || '★'; end if;
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='deliverable_internal' and column_name=c)
      then v := v || ' deliverable_internal.' || c; end if;
  end loop;
  if to_regclass('public.deliverable_internal') is null then
    v := v || ' public.deliverable_internal';
  else
    if not coalesce((select cl.relrowsecurity from pg_class cl
                      join pg_namespace ns on ns.oid = cl.relnamespace
                     where ns.nspname='public' and cl.relname='deliverable_internal'), false)
      then v := v || ' ★RLS-معطّلة-على-deliverable_internal★'; end if;
    select count(*) into n from pg_policies
     where schemaname='public' and tablename='deliverable_internal'
       and (coalesce(qual,'') not ilike '%coalesce%'
            or coalesce(qual,'') not ilike '%deliverable_internal_is_staff%');
    if n > 0 then v := v || ' ★سياسة-قد-تنهار-إلى-NULL★'; end if;
    -- ★ WITH CHECK يُفحص أيضًا (مثل §10 في RUNME): سياسة الكتابة `for all` تحمل
    --   `with_check` مستقلًّا عن `qual`، وكانت خارج الفحص هنا تمامًا.
    select count(*) into n from pg_policies
     where schemaname='public' and tablename='deliverable_internal' and with_check is not null
       and (with_check not ilike '%coalesce%' or with_check not ilike '%deliverable_internal_is_staff%');
    if n > 0 then v := v || ' ★WITH-CHECK-قد-ينهار-إلى-NULL★'; end if;
    select count(*) into n from information_schema.role_table_grants
     where table_schema='public' and table_name='deliverable_internal' and grantee in ('anon','PUBLIC');
    if n > 0 then v := v || ' ★anon-يملك-deliverable_internal★'; end if;
  end if;
  if to_regprocedure('public.deliverable_internal_is_staff(uuid)') is null then
    v := v || ' fn:public.deliverable_internal_is_staff(uuid)'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='ux_deliverable_internal_external_key')
    then v := v || ' ★ux_deliverable_internal_external_key-مفقود★'; end if;
  foreach c in array array['schedule_status','planned_start_date','stage_order']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='projects' and column_name=c)
      then v := v || ' projects.' || c; end if;
  end loop;

  foreach f in array array[
    'public.project_units_progress(uuid,uuid)','public.project_units_rollup(uuid)',
    'public.project_stage_progress(uuid)','public.project_breadcrumb(uuid)',
    'public.project_hierarchy_can_parent(uuid,uuid)','public.deliverable_content_types_list(boolean)']
  loop
    if to_regprocedure(f) is null then v := v || ' fn:' || f; end if;
  end loop;

  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='deliverables' and column_name='type')
    then v := v || ' ★العمود-القديم-type-اختفى★'; end if;

  select count(*) into n from pg_constraint c
   where c.conrelid = to_regclass('public.deliverables') and c.contype='c'
     and pg_get_constraintdef(c.oid) ilike '%video%' and pg_get_constraintdef(c.oid) ilike '%photo%'
     and pg_get_constraintdef(c.oid) not ilike '%photography%';
  if n > 0 then v := v || ' ★القيد-الضيّق-ما-زال-حيًّا★'; end if;

  select count(*) into n from public.deliverables where content_type is null;
  if n > 0 then v := v || ' ★' || n || '-مخرج-بلا-content_type★'; end if;

  select count(*) into n from information_schema.role_routine_grants
   where routine_schema='public' and grantee='anon'
     and routine_name in ('project_units_progress','project_units_rollup','project_stage_progress',
                          'project_breadcrumb','deliverable_content_types_list');
  if n > 0 then v := v || ' ★anon-يملك-تنفيذ★'; end if;

  if v <> '' then raise exception 'POSTCHECK FAIL —%', v; end if;
  raise notice 'POSTCHECK: PASS — الحزمة مطبَّقة بالكامل، الحقول الداخلية معزولة في deliverable_internal (كوادر فقط، والعميل صفر صفوف)، العمود القديم سليم، ولا منح لـ anon.';
end $post$;
