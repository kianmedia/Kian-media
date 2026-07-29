-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — الاستيراد الجماعي · فحص قبْليّ **للقراءة فقط**
-- docs/project_bulk_import_PREFLIGHT.sql
-- ════════════════════════════════════════════════════════════════════════════
--   شغّله **قبل** docs/project_bulk_import_RUNME.sql.
--   لا create · لا alter · لا insert/update/delete · لا drop · لا grant/revoke
--   · لا جدول مؤقّت · لا begin/commit. كتلة DO الأخيرة تقرأ فقط وترفع استثناءً
--   عند نقص حاسم.
--
-- ★ الترتيب الإلزامي ★
--     docs/project_platform_large_projects_RUNME.sql   ← **أوّلًا**
--     docs/project_bulk_import_RUNME.sql               ← ثانيًا
--   السبب: idempotency الاستيراد كلّه مبنيّ على
--   public.deliverable_internal.external_key وفهرسه الفريد الجزئيّ، وكلاهما
--   يُنشأ في الحزمة الأولى (§1b). بدونهما «تشغيل نفس الملفّ مرّتين» سيُنشئ
--   نسخًا مكرّرة صامتة.
--   ★ لماذا جدول جانبي؟ RLS في PostgreSQL تُصفّي الصفوف لا الأعمدة، وكل
--     المستخدمين على دور authenticated واحد ⇒ أيّ عمود على deliverables يقرؤه
--     العميل مباشرةً عبر PostgREST. المفاتيح والملاحظات الداخلية ليست بيانات
--     عميل، فنُقلت إلى جدول لا يرى العميل فيه صفًّا واحدًا.
--
-- ★ ما ينشئه RUNME ★
--   • عمودان على public.projects: external_key · import_batch_id  (+ فهرس فريد جزئيّ)
--     (المراحل مشاريع؛ مفاتيحها على projects. مفاتيح المخرجات في deliverable_internal.)
--   • ثلاثة جداول: import_batches · import_rows · import_batch_events
--   • دوالّ: إنشاء دفعة · تحميل صفوف · معاينة · تشغيل تجريبي · تنفيذ · تقرير · إلغاء
--   ⛔ لا يُنشئ أيّ مشروع ولا أيّ مخرج عند التطبيق (الفحص الذاتي يُجهض عند أيّ فرق).
--
-- ★ حدود مقصودة في هذه النسخة (اقرأها قبل أن تبني عليها) ★
--   1. entity_type = 'project' **غير مدعوم**. المشروع الرئيسي يُنشئه المالك بيده،
--      ويُمرَّر معرّفه كهدف للدفعة. السبب: ملفّ Excel يجب ألّا يُنجب مشاريع حقيقية.
--   2. external_key **إلزاميّ** لكل صفّ. بدونه لا يوجد تعريف لـ «نفس الصفّ»،
--      وبالتالي لا يمكن ضمان أن التشغيل الثاني لا يُنشئ شيئًا.
--   3. حالات المخرجات المسموح استيرادها: draft · internal_review فقط.
--      client_review/approved/final_delivered تُطلق إشعارات وبريدًا للعميل
--      (phase0: t_deliverable_change · batch9d: trg_preview_staff_notify)
--      ⇒ استيراد 79 صفًّا كان سيُرسل 79 إشعارًا. تُرفض في المعاينة برسالة صريحة.
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- (أ) التبعيات
-- ─────────────────────────────────────────────────────────────────────────────
with dep(ord, kind, label, obj, blocking) as (values
  ( 1,'column',  '★ deliverable_internal.external_key (الحزمة الأولى §1b)', 'deliverable_internal.external_key', true),
  ( 2,'index',   '★ ux_deliverable_internal_external_key (فريد جزئيّ)', 'ux_deliverable_internal_external_key', true),
  ( 3,'table',   '★ public.deliverable_internal (كوادر فقط)',      'public.deliverable_internal', true),
  ( 4,'column',  'deliverables.stage_id',                          'deliverables.stage_id', true),
  ( 5,'column',  'deliverables.content_type',                      'deliverables.content_type', true),
  ( 6,'table',   'public.deliverable_content_types',               'public.deliverable_content_types', true),
  ( 7,'column',  'projects.parent_project_id',                     'projects.parent_project_id', true),
  ( 8,'column',  'projects.project_scope',                         'projects.project_scope', true),
  ( 9,'column',  'projects.stage_order',                           'projects.stage_order', true),
  (10,'function','public.project_core_create_project(jsonb)',      'public.project_core_create_project(jsonb)', true),
  (11,'function','public.can_manage_projects()',                   'public.can_manage_projects()', true),
  (12,'function','public.emp_has_permission(text)',                'public.emp_has_permission(text)', false),
  (13,'function','public.pc_log(uuid,text,text,uuid,jsonb)',       'public.pc_log(uuid,text,text,uuid,jsonb)', false),
  (14,'column',  'projects.sequence_number (اختياري)',             'projects.sequence_number', false),
  (15,'table',   'public.import_batches (سيُنشأ هنا)',             'public.import_batches', false),
  (16,'table',   'public.import_rows (سيُنشأ هنا)',                'public.import_rows', false)
),
res as (
  select d.ord, d.label, d.blocking,
         case d.kind
           when 'table'    then (to_regclass(d.obj) is not null)
           when 'function' then (to_regprocedure(d.obj) is not null)
           when 'index'    then exists (select 1 from pg_indexes where schemaname='public' and indexname = d.obj)
           else exists (select 1 from information_schema.columns
                         where table_schema='public'
                           and table_name   = split_part(d.obj,'.',1)
                           and column_name  = split_part(d.obj,'.',2))
         end as present
  from dep d
)
select ord as "#", label as "الكائن",
       case when present then 'موجود' else 'غير موجود' end as "الحالة",
       case
         when blocking and not present and ord in (1,2,3,4,5,6)
           then '⛔ حاجز — شغّل docs/project_platform_large_projects_RUNME.sql أوّلًا'
         when blocking and not present then '⛔ حاجز'
         when ord in (15,16) and present then 'ℹ️ موجود مسبقًا ⇒ إعادة تشغيل آمنة'
         when ord in (15,16) then 'ℹ️ سيُنشأ'
         when not present then '⚠️ اختياري — يسقط بأمان'
         else 'جاهز'
       end as "الأثر"
from res order by ord;


-- ─────────────────────────────────────────────────────────────────────────────
-- (ب) حالة البيانات — ماذا سيرى الاستيراد اليوم
-- ─────────────────────────────────────────────────────────────────────────────
select 'مشاريع (كلّها)'                as "المؤشّر", count(*)::text as "القيمة",
       'RUNME لا يُنشئ ولا يحذف مشروعًا' as "ملاحظة" from public.projects
union all
select 'مشاريع حيّة', count(*)::text, 'مرشّحون لأن يكونوا هدف الدفعة'
  from public.projects where coalesce(is_deleted,false) = false
union all
select 'مخرجات (كلّها)', count(*)::text, 'RUNME لا يُنشئ ولا يحذف مخرجًا'
  from public.deliverables
union all
select 'مخرجات تحمل external_key', 
       coalesce((select count(*)::text from public.deliverable_internal where external_key is not null), 'الجدول الجانبي غير موجود'),
       'هذه هي التي سيتخطّاها الاستيراد بدل إعادة إنشائها (المفتاح في deliverable_internal)'
union all
select 'مشاريع تحمل external_key',
       coalesce((select count(*)::text from information_schema.columns
                  where table_schema='public' and table_name='projects' and column_name='external_key'), '0'),
       'العمود نفسه يُضيفه RUNME — الصفر هنا طبيعيّ قبل التطبيق'
union all
select 'أنواع محتوى مفعّلة (مفردات المعاينة)',
       coalesce((select count(*)::text from public.deliverable_content_types where is_active), 'الجدول غير موجود'),
       'كل content_type في الملفّ يجب أن يطابق مفتاحًا مفعّلًا هنا';


-- ─────────────────────────────────────────────────────────────────────────────
-- (ج) ★ المشغّلات التي ستنطلق مع كل صفّ مستورَد ★
--     هذه هي أخطر مفاجأة في أيّ استيراد جماعي: 79 صفًّا = 79 انطلاقة.
-- ─────────────────────────────────────────────────────────────────────────────
select t.tgname                                        as "المشغّل",
       p.proname                                       as "الدالّة",
       case
         when t.tgname = 't_deliverable_change'
           then 'يكتب activity_log لكل صفّ (مقبول: أثر تدقيق). يُشعر العميل **فقط** عند status=client_review ⇒ الاستيراد يمنع هذه الحالة.'
         when t.tgname = 'trg_preview_staff_notify'
           then 'يُشعر الكوادر **فقط** عند status=client_review ⇒ الاستيراد يمنع هذه الحالة.'
         when t.tgname = 't_deliverable_autoversion'
           then 'يُنشئ النسخة V1 لكل مخرج — سلوك المنصّة الطبيعي ومطلوب.'
         when t.tgname = 'trg_deliverables_type_sync'
           then 'يملأ العمود القديم type من content_type — مطلوب.'
         when t.tgname = 'trg_deliverables_stage_guard'
           then 'يتحقّق أن المرحلة في نفس شجرة المشروع — مطلوب.'
         else 'راجعه بنفسك قبل الاستيراد.'
       end                                             as "الأثر عند الاستيراد"
from pg_trigger t join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = to_regclass('public.deliverables') and not t.tgisinternal
order by t.tgname;


-- ─────────────────────────────────────────────────────────────────────────────
-- (د) بصمة الصلاحيات — قارنها بالفحص البعْديّ (RUNME لا يمسّ منحًا قائمًا)
-- ─────────────────────────────────────────────────────────────────────────────
select 'منح anon على projects/deliverables (يجب ∅)' as "المحور",
       coalesce(string_agg(table_name||':'||privilege_type, ' | ' order by table_name, privilege_type), '∅') as "القيمة"
  from information_schema.role_table_grants
 where table_schema='public' and table_name in ('projects','deliverables') and grantee='anon'
union all
select 'سياسات RLS على projects/deliverables',
       coalesce(string_agg(tablename||'.'||policyname, ' | ' order by tablename, policyname), '∅')
  from pg_policies where schemaname='public' and tablename in ('projects','deliverables');


-- ─────────────────────────────────────────────────────────────────────────────
-- (هـ) بوّابة الرفض — قراءة محضة
-- ─────────────────────────────────────────────────────────────────────────────
do $pre$
declare v_miss text := ''; v_warn text := ''; c text;
begin
  foreach c in array array['stage_id','content_type','client_visible',
                           'schedule_status','expected_units','completed_units','sort_order']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_miss := v_miss || ' deliverables.' || c; end if;
  end loop;
  -- الحقول الداخلية: مكانها الجدول الجانبي، ووجودها على deliverables تسريب حيّ.
  if to_regclass('public.deliverable_internal') is null then
    v_miss := v_miss || ' public.deliverable_internal';
  else
    foreach c in array array['deliverable_id','internal_notes','external_key','import_batch_id',
                             'source_row_number','source_file_name','metadata']
    loop
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='deliverable_internal' and column_name=c)
        then v_miss := v_miss || ' deliverable_internal.' || c; end if;
    end loop;
  end if;
  foreach c in array array['internal_notes','external_key','import_batch_id',
                           'source_row_number','source_file_name','metadata']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_miss := v_miss || ' ★deliverables.' || c || '-ما-زال-موجودًا-(تسريب-للعميل)★'; end if;
  end loop;
  foreach c in array array['parent_project_id','project_scope','stage_order','schedule_status','planned_start_date']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='projects' and column_name=c)
      then v_miss := v_miss || ' projects.' || c; end if;
  end loop;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='ux_deliverable_internal_external_key')
    then v_miss := v_miss || ' ux_deliverable_internal_external_key'; end if;
  if to_regclass('public.deliverable_content_types') is null
    then v_miss := v_miss || ' public.deliverable_content_types'; end if;
  if to_regprocedure('public.project_core_create_project(jsonb)') is null
    then v_miss := v_miss || ' project_core_create_project(jsonb)'; end if;
  if to_regprocedure('public.can_manage_projects()') is null
    then v_miss := v_miss || ' can_manage_projects()'; end if;

  if v_miss <> '' then
    raise exception E'BULK_IMPORT PREFLIGHT حاجز — ناقص:%\n  الأرجح أنك لم تُشغّل docs/project_platform_large_projects_RUNME.sql بعد. شغّله أوّلًا.', v_miss;
  end if;

  if to_regprocedure('public.emp_has_permission(text)') is null then
    v_warn := v_warn || E'\n  • emp_has_permission مفقودة ⇒ الاستيراد للإدارة (can_manage_projects) فقط.'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null then
    v_warn := v_warn || E'\n  • pc_log مفقودة ⇒ التدقيق يقتصر على import_batch_events (كافٍ).'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='projects' and column_name='sequence_number') then
    v_warn := v_warn || E'\n  • projects.sequence_number مفقود ⇒ لن يُرقَّم الفرع تلقائيًّا (غير ضارّ).'; end if;
  if to_regclass('public.import_batches') is not null then
    v_warn := v_warn || E'\n  • import_batches موجود مسبقًا ⇒ إعادة تشغيل (create if not exists) بلا فقدان.'; end if;

  if v_warn <> '' then raise notice E'BULK_IMPORT PREFLIGHT ملاحظات:%', v_warn; end if;
  raise notice 'BULK_IMPORT PREFLIGHT: مُجتاز — يمكن تشغيل docs/project_bulk_import_RUNME.sql';
end $pre$;
