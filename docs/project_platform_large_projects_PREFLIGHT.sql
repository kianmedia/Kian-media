-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — منصّة المشاريع الكبيرة · فحص قبْليّ **للقراءة فقط**
-- docs/project_platform_large_projects_PREFLIGHT.sql
-- ════════════════════════════════════════════════════════════════════════════
--   شغّله **قبل** docs/project_platform_large_projects_RUNME.sql واقرأ كل صفّ.
--
--   ★ ضمان القراءة فقط ★
--     لا create · لا alter · لا insert/update/delete · لا drop · لا grant/revoke
--     · لا جدول مؤقّت · لا begin/commit. كتلة DO في الجزء (ج) تقرأ الكتالوج فقط
--     وترفع استثناءً عند نقص حاسم — ولا تكتب حرفًا واحدًا.
--
--   ★ ماذا يفعل RUNME (ملخّص ما ستوافق عليه) ★
--     1. يضيف 18 عمودًا إلى public.deliverables (ADD COLUMN IF NOT EXISTS فقط).
--     2. ★ يُنشئ public.deliverable_internal — جدول جانبي 1:1 للحقول الداخلية
--        (internal_notes · external_key · import_batch_id · source_row_number ·
--         source_file_name · metadata) بـ RLS كوادر-فقط: العميل يرى صفر صفوف.
--        السبب: RLS تُصفّي الصفوف لا الأعمدة، وكل المستخدمين على دور واحد
--        (authenticated) ⇒ أيّ عمود على deliverables يقرؤه العميل مباشرةً.
--     3. يُنشئ جدول مرجعيّ public.deliverable_content_types ويزرع 13 نوعًا.
--     4. ★ يُسقط قيد CHECK الضيّق على deliverables.type ★ ويستبدله بقيد مفتوح.
--        العمود القديم `type` **يبقى** ويظلّ مملوءًا عبر Trigger مزامنة.
--     5. يضيف schedule_status / planned_start_date / stage_order إلى public.projects.
--     6. فهرس فريد جزئيّ على deliverable_internal(external_key).
--     7. دوالّ تقدّم موزونة بالوحدات + حارس دورات + حدّ عمق + تجميع + مسار تنقّل.
--     ⛔ لا يُنشئ أيّ مشروع · لا يحذف صفًّا · لا يعدّل بيانات عمل قائمة عدا
--        تعبئة الأعمدة الجديدة (backfill) التي كانت NULL قبل ثانية واحدة.
--     ⚠️ **الاستثناء الوحيد**: إن كنت طبّقت نسخةً أقدم من RUNME فالأعمدة الستّة
--        الداخلية موجودة على deliverables. عندها §1b **يرحّل بياناتها إلى الجدول
--        الجانبي ثم يُسقط الأعمدة** (DROP COLUMN لا يُسترجع). لا يُسقَط شيء قبل
--        أن يُتحقَّق صفًّا بصفّ أن كل قيمة وصلت. الجزء (ج) أدناه يُريك أيّ الأعمدة
--        الستّة موجودة عندك الآن، والجزء (د) كم صفًّا يحمل بيانات فيها.
--
--   ★ الأخطر في الحزمة ★ إسقاط قيد `type`. الجزء (ب) يطبع **كل** قيود CHECK
--     الحيّة على العمود باسمها ونصّها قبل أن يلمسها أحد. احفظ ناتجه.
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- (أ) لوحة التبعيات — ما هو موجود اليوم فعلًا
-- ─────────────────────────────────────────────────────────────────────────────
with dep(ord, kind, label, obj) as (values
  ( 1,'table',    'public.deliverables (الجدول الهدف)',            'public.deliverables'),
  ( 2,'table',    'public.projects',                               'public.projects'),
  ( 3,'table',    'public.project_core (مصدر core_stage/progress)','public.project_core'),
  ( 4,'table',    'public.clients',                                'public.clients'),
  ( 5,'table',    'public.permissions (كتالوج الصلاحيات)',         'public.permissions'),
  ( 6,'table',    'public.deliverable_content_types (سيُنشأ هنا)', 'public.deliverable_content_types'),
  (16,'table',    '★ public.deliverable_internal (سيُنشأ هنا)',    'public.deliverable_internal'),
  (17,'function', 'public.is_kian_member(uuid) — بوّابة الكوادر',  'public.is_kian_member(uuid)'),
  ( 7,'function', 'public.is_admin()',                             'public.is_admin()'),
  ( 8,'function', 'public.is_staff()',                             'public.is_staff()'),
  ( 9,'function', 'public.can_manage_projects()',                  'public.can_manage_projects()'),
  (10,'function', 'public.can_access_project(uuid)',               'public.can_access_project(uuid)'),
  (11,'function', 'public.is_client_side(uuid)',                   'public.is_client_side(uuid)'),
  (12,'function', 'public.pc_can_read_project(uuid)',              'public.pc_can_read_project(uuid)'),
  (13,'function', 'public.emp_has_permission(text)',               'public.emp_has_permission(text)'),
  (14,'function', 'public.pc_log(uuid,text,text,uuid,jsonb)',      'public.pc_log(uuid,text,text,uuid,jsonb)'),
  (15,'function', 'public.project_progress_snapshot(uuid)',        'public.project_progress_snapshot(uuid)')
),
res as (
  select ord, kind, label, obj,
         case when kind = 'table' then (to_regclass(obj)     is not null)
              else                     (to_regprocedure(obj) is not null) end as present
  from dep
)
select
  ord                                                   as "#",
  label                                                 as "الكائن",
  case when present then 'موجود' else 'غير موجود' end   as "الحالة",
  case
    when ord in (1,2,3,4,7,9,10) and not present then '⛔ حاجز — RUNME سيرفض العمل'
    when ord = 6 and present                     then 'ℹ️ الجدول المرجعي موجود مسبقًا ⇒ RUNME يعيد الزرع فقط (idempotent)'
    when ord = 6                                 then 'ℹ️ سيُنشأ في RUNME'
    when ord = 16 and present                    then 'ℹ️ الجدول الجانبي موجود مسبقًا ⇒ RUNME يُكمله فقط (idempotent)'
    when ord = 16                                then 'ℹ️ سيُنشأ في §1b — الحقول الداخلية تنتقل إليه'
    when ord = 17 and not present                then '⛔ حاجز — بوّابة deliverable_internal ستُغلق على الجميع (fail-closed)'
    when ord in (5,13) and not present           then '⚠️ صلاحيات مفصّلة غائبة ⇒ البوّابات تسقط إلى can_manage_projects فقط'
    when ord = 12 and not present                then '⚠️ بوّابة القراءة تسقط إلى is_admin() فقط (الكوادر لن يروا التقدّم)'
    when ord = 15 and not present                then 'ℹ️ اختياري — محرّك الوحدات مستقلّ عن محرّك 3C'
    when ord = 11 and not present                then '⚠️ عرض العميل سيُعطَّل (staff-only)'
    when ord = 14 and not present                then 'ℹ️ اختياري — التدقيق يسقط بصمت'
    else 'جاهز'
  end                                                   as "الأثر"
from res order by ord;


-- ─────────────────────────────────────────────────────────────────────────────
-- (ب) ★ الأهمّ ★ تعداد قيود CHECK الحيّة على public.deliverables
--     RUNME يبحث عن القيد بالاستعلام لا بالاسم. هذه اللوحة تُريك بالضبط ما
--     سيجده وما سيُسقطه — قبل أن يُسقطه. احفظها؛ الفحص البعْديّ يقارن بها.
-- ─────────────────────────────────────────────────────────────────────────────
select
  c.conname                                             as "اسم القيد",
  pg_get_constraintdef(c.oid)                           as "نصّ القيد",
  (select string_agg(a.attname, ', ' order by a.attnum)
     from pg_attribute a
    where a.attrelid = c.conrelid and a.attnum = any (c.conkey)) as "الأعمدة",
  case
    when pg_get_constraintdef(c.oid) ilike '%video%'
     and pg_get_constraintdef(c.oid) ilike '%photo%'
     and pg_get_constraintdef(c.oid) not ilike '%photography%'
      then '🔴 هذا هو القيد الضيّق — **سيُسقَط** ويُستبدل بـ deliverables_type_open_ck'
    else '🟢 لن يُمسّ'
  end                                                   as "قرار RUNME"
from pg_constraint c
where c.conrelid = to_regclass('public.deliverables')
  and c.contype  = 'c'
order by 4 desc, 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- (ج) تعداد الأعمدة — أيّ الأعمدة موجودة مسبقًا (تشغيل مُكرَّر آمن)
--     الصفوف 19..24 هي الحقول الداخلية الستّة: **لن تُضاف** إلى deliverables،
--     وإن كانت موجودة عندك من نسخة أقدم فستُرحَّل إلى deliverable_internal
--     ثم تُسقَط. اقرأ عمود «الحالة» فيها بعناية.
-- ─────────────────────────────────────────────────────────────────────────────
with want(ord, tbl, col, typ) as (values
  ( 1,'deliverables','stage_id',          'uuid'),
  ( 2,'deliverables','content_type',      'text'),
  ( 3,'deliverables','platforms',         'text[]'),
  ( 4,'deliverables','execution_details', 'text'),
  ( 5,'deliverables','proposed_caption',  'text'),
  ( 6,'deliverables','priority',          'text'),
  ( 7,'deliverables','client_visible',    'boolean'),
  ( 9,'deliverables','schedule_status',   'text'),
  (10,'deliverables','planned_start_date','date'),
  (11,'deliverables','expected_units',    'integer'),
  (12,'deliverables','completed_units',   'integer'),
  (13,'deliverables','recurrence_type',   'text'),
  (14,'deliverables','recurrence_config', 'jsonb'),
  (15,'deliverables','requires_shooting', 'boolean'),
  (16,'deliverables','requires_editing',  'boolean'),
  (17,'deliverables','requires_design',   'boolean'),
  (18,'deliverables','requires_printing', 'boolean'),
  (18,'deliverables','sort_order',        'integer'),
  -- ★ الستّة الداخلية: مكانها deliverable_internal، لا deliverables ★
  (19,'deliverables','internal_notes',    '⟶ deliverable_internal'),
  (20,'deliverables','external_key',      '⟶ deliverable_internal'),
  (21,'deliverables','import_batch_id',   '⟶ deliverable_internal'),
  (22,'deliverables','source_row_number', '⟶ deliverable_internal'),
  (23,'deliverables','source_file_name',  '⟶ deliverable_internal'),
  (24,'deliverables','metadata',          '⟶ deliverable_internal'),
  (25,'projects',    'schedule_status',   'text'),
  (26,'projects',    'planned_start_date','date'),
  (27,'projects',    'stage_order',       'integer'),
  (28,'projects',    'parent_project_id', 'uuid   (تبعية — لا يُنشئه RUNME)'),
  (29,'projects',    'project_scope',     'text   (تبعية — لا يُنشئه RUNME)'),
  (30,'projects',    'sequence_number',   'integer (اختياري — مصدر تعبئة stage_order)')
)
select w.ord                                              as "#",
       'public.'||w.tbl||'.'||w.col                       as "العمود",
       w.typ                                              as "النوع المطلوب",
       coalesce(c.data_type, '—')                         as "النوع الحيّ",
       case when w.ord between 19 and 24 and c.column_name is null
              then '✅ غير موجود ⇒ لن يُضاف — مكانه deliverable_internal'
            when w.ord between 19 and 24
              then '🔴 موجود ⇒ §1b سيرحّل بياناته إلى deliverable_internal ثم **يُسقط العمود**'
            when c.column_name is null then 'غير موجود ⇒ سيُضاف'
            else 'موجود ⇒ ADD IF NOT EXISTS يتخطّاه' end  as "الحالة",
       case when w.ord in (28,29) and c.column_name is null
              then '⛔ حاجز — طبّق حزمة الهرمية أولًا'
            when w.ord between 19 and 24 and c.column_name is not null
              then 'DROP COLUMN لا يُسترجع — لا يُنفَّذ إلّا بعد تحقّق صفًّا بصفّ (الجزء د)'
            else '' end as "ملاحظة"
from want w
left join information_schema.columns c
       on c.table_schema = 'public' and c.table_name = w.tbl and c.column_name = w.col
order by w.ord;


-- ─────────────────────────────────────────────────────────────────────────────
-- (د) حجم البيانات وسلامة التحويل — ما الذي سيُعاد تعبئته فعلًا
-- ─────────────────────────────────────────────────────────────────────────────
select 'إجمالي المخرجات'                as "المؤشّر",
       count(*)::text                    as "القيمة",
       'RUNME لا يحذف ولا يُنشئ صفًّا — الفحص الذاتي يُجهض إن تغيّر هذا الرقم' as "الأثر"
  from public.deliverables
union all
select 'مخرجات حيّة (is_deleted=false)', count(*)::text, ''
  from public.deliverables where coalesce(is_deleted,false) = false
union all
select 'إجمالي المشاريع', count(*)::text,
       'RUNME **لا يُنشئ أيّ مشروع** — الفحص الذاتي يُجهض إن تغيّر هذا الرقم'
  from public.projects
union all
select 'قيم type المتميّزة', coalesce(string_agg(distinct coalesce(type,'∅'), ' · '), '∅'),
       'كل قيمة ستُسقَط على content_type: video→video · photo→photography · غير ذلك→custom'
  from public.deliverables
union all
select 'قيم type خارج المفردات القديمة',
       coalesce(count(*) filter (where coalesce(type,'') not in ('video','photo','other'))::text,'0'),
       'إن كان > 0 فهناك انحراف: RUNME يُدرج القيمة في الجدول المرجعي بحالة غير مفعّلة بدل إتلافها'
  from public.deliverables;


-- ─────────────────────────────────────────────────────────────────────────────
-- (د-2) ★ لوحة الترحيل الداخلي ★ كم صفًّا يحمل بيانات في كلّ عمود سيُسقَط.
--       قراءة محضة (SELECT داخل EXECUTE فقط — لا كتابة ولا DDL). الأعمدة قد
--       تكون غير موجودة أصلًا، لذلك تُفحص ديناميكيًّا بدل استعلام ثابت يفشل.
-- ─────────────────────────────────────────────────────────────────────────────
do $mig$
declare c text; n int; v_any boolean := false;
begin
  foreach c in array array['internal_notes','external_key','import_batch_id',
                           'source_row_number','source_file_name','metadata']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='deliverables' and column_name=c) then
      v_any := true;
      execute format(
        'select count(*) from public.deliverables where %s',
        case when c = 'metadata' then 'coalesce(metadata,''{}''::jsonb) <> ''{}''::jsonb'
             else quote_ident(c)||' is not null' end) into n;
      raise notice '  • deliverables.% — % صفًّا يحمل بيانات ⇒ سيُنقَل إلى deliverable_internal ثم يُسقَط العمود.', c, n;
    end if;
  end loop;
  if not v_any then
    raise notice 'لوحة الترحيل الداخلي: لا شيء يُرحَّل ولا عمود يُسقَط — تطبيق نظيف.';
  else
    raise notice '★ إن كان أيّ رقم أعلاه > 0 فخذ نسخة احتياطية قبل RUNME. الترحيل مُتحقَّق منه صفًّا بصفّ، لكن DROP COLUMN لا يُسترجع.';
  end if;
end $mig$;


-- ─────────────────────────────────────────────────────────────────────────────
-- (هـ) بصمة الصلاحيات وسياسات RLS — قارنها حرفيًّا بناتج الفحص البعْديّ
--      RUNME لا يمسّ أيّ سياسة قائمة ولا يمنح anon شيئًا.
-- ─────────────────────────────────────────────────────────────────────────────
select 'بصمة صلاحيات الجداول' as "المحور",
       coalesce(string_agg(grantee||':'||privilege_type, ' | ' order by grantee, privilege_type), '∅') as "القيمة"
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('deliverables','projects')
   and grantee in ('anon','authenticated','service_role')
union all
select 'بصمة سياسات RLS (deliverables/projects)',
       coalesce(string_agg(tablename||'.'||policyname, ' | ' order by tablename, policyname), '∅')
  from pg_policies where schemaname = 'public' and tablename in ('deliverables','projects')
union all
select '★ منح anon على deliverables (يجب أن يكون ∅)',
       coalesce(string_agg(privilege_type, ',' order by privilege_type), '∅')
  from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'deliverables' and grantee = 'anon';


-- ─────────────────────────────────────────────────────────────────────────────
-- (و) بوّابة الرفض — قراءة محضة، ترفع استثناءً ولا تكتب شيئًا
-- ─────────────────────────────────────────────────────────────────────────────
do $pre$
declare
  v_miss    text := '';
  v_warn    text := '';
  v_narrow  int  := 0;
begin
  -- حواجز صلبة: بدونها RUNME يفشل في منتصف المعاملة بدل أن يرفض مبكرًا.
  if to_regclass('public.deliverables')  is null then v_miss := v_miss || ' public.deliverables'; end if;
  if to_regclass('public.projects')      is null then v_miss := v_miss || ' public.projects';     end if;
  if to_regclass('public.project_core')  is null then v_miss := v_miss || ' public.project_core'; end if;
  if to_regprocedure('public.is_admin()')             is null then v_miss := v_miss || ' is_admin()';             end if;
  if to_regprocedure('public.can_manage_projects()')  is null then v_miss := v_miss || ' can_manage_projects()';  end if;
  if to_regprocedure('public.can_access_project(uuid)') is null then v_miss := v_miss || ' can_access_project(uuid)'; end if;
  -- بوّابة الجدول الجانبي تعتمد عليها؛ غيابها يجعل deliverable_internal مغلقًا
  -- على الجميع (fail-closed) — وهو آمن لكنه يعطّل الكوادر بلا سبب مفهوم.
  if to_regprocedure('public.is_kian_member(uuid)') is null then v_miss := v_miss || ' is_kian_member(uuid)'; end if;

  -- الهرمية: العمودان شرط بنيويّ لحارس الدورات ودوالّ التجميع/المسار.
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='projects' and column_name='parent_project_id')
    then v_miss := v_miss || ' projects.parent_project_id'; end if;

  if v_miss <> '' then
    raise exception E'PREFLIGHT حاجز — تبعيات مفقودة:%\n  طبّق حزم المنصّة الأساسية (phase0 / project_core / الهرمية) قبل هذا الملفّ.', v_miss;
  end if;

  -- تحذيرات لا توقف التشغيل.
  if to_regprocedure('public.pc_can_read_project(uuid)') is null then
    v_warn := v_warn || E'\n  • pc_can_read_project مفقودة ⇒ بوّابة قراءة التقدّم تسقط إلى is_admin() فقط.'; end if;
  if to_regprocedure('public.emp_has_permission(text)') is null then
    v_warn := v_warn || E'\n  • emp_has_permission مفقودة ⇒ لا صلاحيات مفصّلة؛ الإدارة فقط.'; end if;
  if to_regprocedure('public.is_client_side(uuid)') is null then
    v_warn := v_warn || E'\n  • is_client_side مفقودة ⇒ عرض العميل معطّل (كوادر فقط).'; end if;
  if to_regclass('public.deliverable_content_types') is not null then
    v_warn := v_warn || E'\n  • deliverable_content_types موجود مسبقًا ⇒ إعادة زرع فقط (on conflict do nothing).'; end if;
  if to_regclass('public.deliverable_internal') is not null then
    v_warn := v_warn || E'\n  • deliverable_internal موجود مسبقًا ⇒ §1b يُكمله ولا يُعيد إنشاءه.'; end if;
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='deliverables'
                and column_name in ('internal_notes','external_key','import_batch_id',
                                    'source_row_number','source_file_name','metadata')) then
    v_warn := v_warn || E'\n  🔴 حقول داخلية ما زالت على public.deliverables ⇒ **العميل يقرؤها اليوم** عبر PostgREST.'
                     || E'\n     §1b سيرحّلها إلى deliverable_internal ثم **يُسقط الأعمدة** (انظر الجزء د-2).'; end if;

  select count(*) into v_narrow
    from pg_constraint c
   where c.conrelid = to_regclass('public.deliverables') and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%video%'
     and pg_get_constraintdef(c.oid) ilike '%photo%'
     and pg_get_constraintdef(c.oid) not ilike '%photography%';

  if v_narrow = 0 then
    v_warn := v_warn || E'\n  • لم يُعثر على قيد type الضيّق (أُسقط سابقًا أو لم يُطبَّق) ⇒ RUNME يضيف القيد المفتوح فقط.';
  else
    v_warn := v_warn || E'\n  🔴 سيُسقَط ' || v_narrow || E' قيد CHECK ضيّق على deliverables.type (انظر الجزء ب).';
  end if;

  if v_warn <> '' then raise notice E'PREFLIGHT ملاحظات:%', v_warn; end if;
  raise notice 'PREFLIGHT: كل الحواجز الصلبة مُجتازة — يمكن تشغيل docs/project_platform_large_projects_RUNME.sql';
end $pre$;
