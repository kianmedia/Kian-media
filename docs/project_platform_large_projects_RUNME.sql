-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — منصّة المشاريع الكبيرة · الترقية الإضافية (ADDITIVE) للمخرجات والمراحل
-- docs/project_platform_large_projects_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الترتيب ★
--   1. docs/project_platform_large_projects_PREFLIGHT.sql   (قراءة فقط — اقرأ ناتجه)
--   2. **هذا الملفّ**
--   3. docs/project_platform_large_projects_POSTCHECK.sql   (قراءة فقط)
--   ثم (اختياريًّا) حزمة الاستيراد: docs/project_bulk_import_PREFLIGHT.sql → RUNME → POSTCHECK
--
-- ★ ما يفعله ★
--   §1  18 عمودًا جديدًا على public.deliverables  (ADD COLUMN IF NOT EXISTS)
--   §1b ★ public.deliverable_internal — جدول جانبي 1:1 للحقول الداخلية ★
--       (internal_notes · external_key · import_batch_id · source_row_number ·
--        source_file_name · metadata) — كوادر فقط، والعميل يرى **صفر صفوف**.
--   §2  جدول مرجعيّ public.deliverable_content_types + 13 نوعًا  ← نموذج قابل للتوسّع
--   §3  ★ استبدال قيد CHECK الضيّق على deliverables.type بقيد مفتوح ★
--   §4  Trigger مزامنة يُبقي العمود القديم `type` صحيحًا للقرّاء القدامى
--   §5  أعمدة الجدولة على public.projects (مستوى المشروع والمرحلة) + stage_order
--   §6  فهارس (والفهرس الفريد الجزئيّ على external_key صار في §1b على الجدول الجانبي)
--   §7  حارس الهرمية: جذر · عمق · دورات · حدّ عمق · حارس ربط المخرج بالمرحلة
--   §8  محرّك التقدّم الموزون بالوحدات (خوارزمية موثّقة) + تجميع + مسار تنقّل
--   §9  الصلاحيات والمنح
--   §10 فحص ذاتي يُجهض المعاملة كلّها عند أيّ خلل
--
-- ★ ما لا يفعله — التزام صريح ★
--   ⛔ لا يُنشئ أيّ مشروع (§10 يقارن العدد قبل/بعد ويُجهض عند أيّ فرق).
--   ⛔ لا ينشئ/يحذف أيّ مخرج (نفس المقارنة).
--   ⛔ لا DROP TABLE · لا DELETE · لا TRUNCATE.
--   ⚠️ استثناء ثانٍ معلن: §1b **يُسقط ستّة أعمدة** من public.deliverables
--      (internal_notes · external_key · import_batch_id · source_row_number ·
--       source_file_name · metadata) — وذلك **بعد** نقل كل قيمة فيها إلى
--      public.deliverable_internal والتحقّق صفًّا بصفًّا أن شيئًا لم يضِع. أيّ صفّ
--      لم يُنقل ⇒ استثناء يُجهض المعاملة كلّها فلا يُسقَط عمود واحد.
--      إن كنت طبّقت نسخةً **أقدم** من هذا الملفّ فالأعمدة موجودة وفيها بيانات:
--      §1b يرحّلها ثم يُسقطها. وإن كان التطبيق نظيفًا فلا شيء يُسقَط أصلًا.
--   ⛔ لا منح لـ anon — أبدًا.
--   ⚠️ استثناء واحد معلن: §8c يُعيد إنشاء سياسة "deliverables read" حرفيًّا كما هي
--      مع شرط واحد إضافيّ على فرع العميل فقط: coalesce(client_visible,true)=true.
--      تضييق صِرف لا توسيع — بدونه يكون مفتاح «إخفاء عن العميل» وعدًا كاذبًا
--      (العميل يقرأ الصفّ المخفيّ مباشرةً عبر PostgREST). فرع الكوادر لم يُمَسّ.
--   ⛔ لا يمسّ MFA ولا أيّ ملفّ أمنيّ مجمَّد.
--   ⛔ لا يعرف شيئًا عن أيّ مشروع بعينه: لا جدول ولا عمود ولا قيمة مُقحَمة باسم عميل
--      أو مشروع. المفردات كلّها عامّة وتصلح لأيّ مشروع كِيان.
--
-- ★ التكرار ★ الملفّ idempotent بالكامل: تشغيله مرّتين لا يغيّر شيئًا في الثانية.
-- ★ التراجع ★ docs/project_platform_large_projects_ROLLBACK.sql (اقرأه قبل التشغيل —
--   فيه ما يُفقد بصراحة، وما **لا يمكن** التراجع عنه).
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- §0 · فحص قبْليّ داخل الملفّ (خارج المعاملة) — يفشل مبكرًا لا في المنتصف
-- ─────────────────────────────────────────────────────────────────────────────
do $pre$
declare v_miss text := ''; c text;
begin
  if to_regclass('public.deliverables') is null then v_miss := v_miss || ' public.deliverables'; end if;
  if to_regclass('public.projects')     is null then v_miss := v_miss || ' public.projects';     end if;
  if to_regclass('public.project_core') is null then v_miss := v_miss || ' public.project_core'; end if;
  if to_regprocedure('public.is_admin()')              is null then v_miss := v_miss || ' is_admin()'; end if;
  if to_regprocedure('public.can_manage_projects()')   is null then v_miss := v_miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.can_access_project(uuid)')is null then v_miss := v_miss || ' can_access_project(uuid)'; end if;
  -- ★ تبعيات صلبة لا تحذيرات: §8c يُعيد إنشاء سياسة "deliverables read" ويذكر
  --   هذه الدوالّ **حرفيًّا داخل CREATE POLICY**؛ تعبير السياسة يُحلَّل وقت
  --   الإنشاء، فغياب أيّها = فشل 42883 في منتصف المعاملة بعد أن أُسقطت السياسة.
  if to_regprocedure('public.is_client_side(uuid)') is null then v_miss := v_miss || ' is_client_side(uuid)'; end if;
  if to_regprocedure('public.is_not_blocked()')     is null then v_miss := v_miss || ' is_not_blocked()';     end if;
  if to_regprocedure('public.is_kian_member(uuid)') is null then v_miss := v_miss || ' is_kian_member(uuid)'; end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='projects' and column_name='parent_project_id')
    then v_miss := v_miss || ' projects.parent_project_id'; end if;
  -- ★ أعمدة يعتمد عليها §8 (محرّك التقدّم) و§8b (التعديل الجماعيّ) داخل أجسام
  --   plpgsql. أجسام plpgsql **لا تُحلَّل وقت الإنشاء**، والفحص الذاتي لا يصل
  --   إليها (auth.uid() = NULL يوقف النداء عند البوّابة) ⇒ غيابها كان يُنتج
  --   ترحيلًا يُعلن PASS ثم ينهار في أوّل استعمال حقيقيّ. نرفض هنا بدلًا من ذلك.
  foreach c in array array['due_date','assignee_id','is_deleted']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_miss := v_miss || ' deliverables.' || c; end if;
  end loop;
  if v_miss <> '' then
    raise exception 'LARGE_PROJECTS PREFLIGHT: تبعيات مفقودة:% — طبّق حزم المنصّة الأساسية أولًا.', v_miss;
  end if;
end $pre$;


begin;

-- بصمة العدّ قبل أيّ تغيير — §10 يقارن بها ويُجهض المعاملة عند أيّ فرق.
select set_config('kian.lp_projects_before',     (select count(*)::text from public.projects),     true),
       set_config('kian.lp_deliverables_before', (select count(*)::text from public.deliverables), true);


-- ════════════════════════════════════════════════════════════════════════════
-- §1) الأعمدة الجديدة على public.deliverables — إضافة فقط
--     ملاحظة أداء: PostgreSQL ≥ 11 يضيف عمودًا بقيمة افتراضية غير متقلّبة بلا
--     إعادة كتابة الجدول (fast default) ⇒ لا قفل طويل حتى على جدول كبير.
-- ════════════════════════════════════════════════════════════════════════════

-- الربط بالمرحلة. في هذا النموذج **المرحلة = مشروع فرعي** (projects.parent_project_id)،
-- فلا جدول مراحل جديد ولا مفردات موازية. on delete set null: حذف/تفكيك المرحلة
-- لا يُبيد المخرجات — تعود «بلا مرحلة» ويعالجها المستخدم.
alter table public.deliverables add column if not exists stage_id           uuid references public.projects(id) on delete set null;

-- التصنيف القابل للتوسّع (المفتاح يشير إلى public.deliverable_content_types).
alter table public.deliverables add column if not exists content_type       text;
alter table public.deliverables add column if not exists platforms          text[];
alter table public.deliverables add column if not exists execution_details  text;
alter table public.deliverables add column if not exists proposed_caption   text;
alter table public.deliverables add column if not exists priority           text;
-- ★ الافتراضي true عمدًا ★ العمود يُضاف على جدول فيه بيانات عاملة بالفعل. لو كان
--   الافتراضي false لانقلب كلّ مخرج تاريخيّ فجأةً إلى «مخفيّ عن العميل» في الواجهة
--   بينما سياسة RLS تُبقيه مقروءًا فعلًا ⇒ رقم يكذب وواجهة تُطمئن بلا سند.
--   true = «كما كان»: الظهور يحكمه status وسياسة RLS، والإخفاء قرار صريح يُتّخذ لاحقًا.
alter table public.deliverables add column if not exists client_visible     boolean not null default true;
-- ⛔ internal_notes **لا يسكن هنا**. راية الظهور بيانات عميل مشروعة؛ الملاحظات
--    الداخلية ليست كذلك. مكانها public.deliverable_internal في §1b — والسبب
--    الكامل مشروح هناك (RLS تُصفّي صفوفًا لا أعمدة).

-- الجدولة. الافتراضي awaiting_schedule: «لم يُجدول بعد» حالة صريحة لا فراغ،
-- وهي **لا تُحتسب تأخيرًا أبدًا** (§8).
alter table public.deliverables add column if not exists schedule_status    text not null default 'awaiting_schedule';
alter table public.deliverables add column if not exists planned_start_date date;

-- الوحدات (المخرجات المتكرّرة: «12 ريلز» = expected_units 12).
alter table public.deliverables add column if not exists expected_units     int;
alter table public.deliverables add column if not exists completed_units    int not null default 0;
alter table public.deliverables add column if not exists recurrence_type    text not null default 'none';
alter table public.deliverables add column if not exists recurrence_config  jsonb;

-- متطلّبات التنفيذ (تُستعمل لتوجيه المهام/الموارد؛ لا تفترض أن كل مخرج فيديو).
alter table public.deliverables add column if not exists requires_shooting  boolean not null default false;
alter table public.deliverables add column if not exists requires_editing   boolean not null default false;
alter table public.deliverables add column if not exists requires_design    boolean not null default false;
alter table public.deliverables add column if not exists requires_printing  boolean not null default false;

-- ⛔ أثر الاستيراد (external_key · import_batch_id · source_row_number ·
--    source_file_name) و metadata **لا تسكن هنا** أيضًا — §1b.
alter table public.deliverables add column if not exists sort_order         int;

-- حزام أمان: لو كانت الأعمدة موجودة من تشغيل سابق وفيها NULL.
-- ⚠️ `true` وليس `false`. العمود مُعرَّف `not null default true` (السطر 118)،
--    و§8c تقرأ `coalesce(client_visible, true)`. تعبئة الفراغ بـ`false` كانت
--    تناقض الاثنين، وهي **نفس** الخطأ الذي أُصلح مرّة عند القيمة الافتراضية:
--    تحت أيّ حالة جزئية سابقة كانت ستُخفي **كل مخرج تاريخيّ عن كل عميل** دفعةً
--    واحدة. السطر ميت اليوم (لا NULL تحت `not null`) — والاتّساق يبقى واجبًا،
--    لأن الحزام الذي يشدّ في الاتجاه الخاطئ أسوأ من غيابه.
update public.deliverables set client_visible    = true                where client_visible    is null;
update public.deliverables set schedule_status   = 'awaiting_schedule' where schedule_status   is null;
update public.deliverables set completed_units   = 0                   where completed_units   is null;
update public.deliverables set recurrence_type   = 'none'              where recurrence_type   is null;
update public.deliverables set requires_shooting = false               where requires_shooting is null;
update public.deliverables set requires_editing  = false               where requires_editing  is null;
update public.deliverables set requires_design   = false               where requires_design   is null;
update public.deliverables set requires_printing = false               where requires_printing is null;

-- قيود المفردات الجديدة (بالاسم — كلّها جديدة فلا خطر تصادم).
do $ck1$
begin
  if not exists (select 1 from pg_constraint where conname = 'deliverables_schedule_status_ck') then
    alter table public.deliverables add constraint deliverables_schedule_status_ck
      check (schedule_status in ('awaiting_schedule','scheduled','in_progress','done','on_hold','cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deliverables_priority_ck') then
    alter table public.deliverables add constraint deliverables_priority_ck
      check (priority is null or priority in ('low','normal','high','urgent'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deliverables_recurrence_type_ck') then
    alter table public.deliverables add constraint deliverables_recurrence_type_ck
      check (recurrence_type in ('none','daily','weekly','biweekly','monthly','quarterly','custom'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'deliverables_units_ck') then
    alter table public.deliverables add constraint deliverables_units_ck
      check ((expected_units is null or expected_units >= 0) and completed_units >= 0);
  end if;
  -- ملاحظة مقصودة: **لا** قيد completed_units <= expected_units. الواقع التشغيلي
  -- يسبق الخطّة أحيانًا (سُلّم 13 وحدة من أصل 12 مخطّطة)؛ محرّك التقدّم يقصّ عند
  -- 100% بدل أن ترفض القاعدة كتابة صحيحة.
  -- ولا قيد CHECK على stage_id: صحّة الربط تعتمد على صفوف أخرى (شجرة المشروع)،
  -- وهذا خارج قدرة CHECK ⇒ يفرضه Trigger في §7.
end $ck1$;


-- ════════════════════════════════════════════════════════════════════════════
-- §1b) ★★ الحقول الداخلية تسكن جدولًا جانبيًّا — إغلاق تسريب مؤكَّد للعميل ★★
--
--   ▸ الثغرة (مؤكَّدة، وهي نفس شكل حادثة حقيقية سبقت في هذا المستودع):
--     RLS في PostgreSQL تُصفّي **الصفوف** ولا تُصفّي **الأعمدة** إطلاقًا، وكل
--     مستخدمي التطبيق — العميل والموظّف — يتشاركون دور Postgres واحدًا هو
--     authenticated. فأيّ عمود يعيش على public.deliverables يصير مقروءًا
--     للعميل حرفيًّا عبر PostgREST بطلب يدويّ واحد:
--         GET /rest/v1/deliverables?select=internal_notes,external_key
--     على كلّ صفّ تسمح له سياسة "deliverables read" برؤيته. النتيجة: نثر
--     داخليّ عن العميل يقرؤه العميل، ومفاتيح/دفعات الاستيراد مكشوفة.
--
--   ▸ الإصلاح البنيويّ (لا التجميلي): تُنقَل الحقول الداخلية إلى جدول جانبي 1:1
--     لا يملك العميل عليه **أيّ صفّ** — لا أعمدة مُصفّاة، بل صفر صفوف. لا يهمّ
--     أيّ select يكتبه: النتيجة مصفوفة فارغة.
--
--   ▸ fail-closed: كل مُسنِد داخل الدالّة الحارسة مغلّف بـ coalesce(...,false)
--     وكل نداء خارجيّ داخل begin/exception ⇒ لا يمكن أن يعود NULL ولا أن ينهار
--     الشرط إلى «مسموح» عند غياب دالّة أو خطأ.
--
--   ▸ ما يبقى على deliverables عمدًا: client_visible. هي **راية ظهور** لا سرّ،
--     وسياسة القراءة نفسها تحتاجها (§8c)؛ نقلها يكسر الإخفاء بدل أن يحميه.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.deliverable_internal (
  deliverable_id    uuid primary key references public.deliverables(id) on delete cascade,
  internal_notes    text,
  external_key      text,
  import_batch_id   uuid,
  source_row_number int,
  source_file_name  text,
  metadata          jsonb not null default '{}'::jsonb
);

-- تشغيل مُكرَّر على جدول أُنشئ ناقصًا من محاولة سابقة.
alter table public.deliverable_internal add column if not exists internal_notes    text;
alter table public.deliverable_internal add column if not exists external_key      text;
alter table public.deliverable_internal add column if not exists import_batch_id   uuid;
alter table public.deliverable_internal add column if not exists source_row_number int;
alter table public.deliverable_internal add column if not exists source_file_name  text;
alter table public.deliverable_internal add column if not exists metadata          jsonb not null default '{}'::jsonb;
update public.deliverable_internal set metadata = '{}'::jsonb where metadata is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1b-أ) الترحيل من الحالة القديمة — يعمل في الحالتين بلا فرق
--   الحالة (1) تطبيق نظيف: الأعمدة الستّة غير موجودة على deliverables ⇒ لا شيء
--             يُنقَل ولا شيء يُسقَط. الكتلة تخرج بإشعار.
--   الحالة (2) نسخة أقدم من هذا الملفّ طُبِّقت فعلًا (وربما استُورد عليها):
--             الأعمدة موجودة وفيها بيانات ⇒ تُنقَل أوّلًا، ثم يُتحقَّق منها صفًّا
--             بصفّ، ثم — وفقط عندئذٍ — تُسقَط.
-- ─────────────────────────────────────────────────────────────────────────────
do $mig$
declare
  v_src   text[] := '{}';
  c       text;
  v_cols  text;
  v_sel   text;
  v_upd   text;
  v_where text := '';
  v_dep   text;
  n       int := 0;
  v_left  int := 0;
begin
  foreach c in array array['internal_notes','external_key','import_batch_id',
                           'source_row_number','source_file_name','metadata']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_src := v_src || c; end if;
  end loop;

  if cardinality(v_src) = 0 then
    raise notice 'LARGE_PROJECTS §1b: لا أعمدة داخلية قديمة على deliverables — تطبيق نظيف، لا ترحيل ولا إسقاط.';
    return;
  end if;

  -- ★ حاجز قبل أيّ إسقاط: لو اعتمد عرض (view/matview) أو سياسة RLS على أحد هذه
  --   الأعمدة، فإسقاطه سيفشل بخطأ تبعية غامض في منتصف المعاملة. نُفشل هنا
  --   برسالة مفهومة بدل ذلك — ولم يُمسّ شيء بعد.
  select string_agg(distinct lbl, ', ') into v_dep from (
    select 'view:'||cl.relname as lbl
      from pg_depend dep
      join pg_rewrite rw on rw.oid = dep.objid
      join pg_class   cl on cl.oid = rw.ev_class
      join pg_attribute a on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
     where dep.refobjid   = 'public.deliverables'::regclass
       and dep.refclassid = 'pg_class'::regclass
       and dep.classid    = 'pg_rewrite'::regclass
       and a.attname      = any (v_src)
       and cl.relkind in ('v','m')
    union all
    select 'policy:'||pol.polname
      from pg_depend dep
      join pg_policy pol on pol.oid = dep.objid
      join pg_attribute a on a.attrelid = dep.refobjid and a.attnum = dep.refobjsubid
     where dep.refobjid   = 'public.deliverables'::regclass
       and dep.refclassid = 'pg_class'::regclass
       and dep.classid    = 'pg_policy'::regclass
       and a.attname      = any (v_src)) t;
  if v_dep is not null then
    raise exception 'LARGE_PROJECTS §1b: كائنات تعتمد على الأعمدة الداخلية (%) — عدّلها أو أسقطها ثم أعد التشغيل. لم يُمسّ شيء.', v_dep;
  end if;

  -- بناء جُمَل الترحيل ديناميكيًّا: لا يُذكر عمود غير موجود إطلاقًا.
  select string_agg(quote_ident(x), ', ' order by x) into v_cols from unnest(v_src) t(x);
  select string_agg(case when x = 'metadata'
                         then 'coalesce(d.metadata, ''{}''::jsonb)'
                         else 'd.'||quote_ident(x) end, ', ' order by x)
    into v_sel from unnest(v_src) t(x);
  -- ملاحظة صياغة: داخل ON CONFLICT DO UPDATE يُشار إلى الجدول الهدف باسمه
  -- المجرَّد (deliverable_internal) لا باسمه المؤهَّل بالمخطّط.
  -- ودلالة الدمج **لا تُتلف**: القيمة القائمة تُصان إن كان الوارد فارغًا.
  select string_agg(case when x = 'metadata'
                         then 'metadata = case when excluded.metadata = ''{}''::jsonb'
                              ||' then deliverable_internal.metadata else excluded.metadata end'
                         else quote_ident(x)||' = coalesce(excluded.'||quote_ident(x)
                              ||', deliverable_internal.'||quote_ident(x)||')' end, ', ' order by x)
    into v_upd from unnest(v_src) t(x);
  select string_agg(case when x = 'metadata'
                         then 'coalesce(d.metadata, ''{}''::jsonb) <> ''{}''::jsonb'
                         else 'd.'||quote_ident(x)||' is not null' end, ' or ' order by x)
    into v_where from unnest(v_src) t(x);

  execute format(
    'insert into public.deliverable_internal (deliverable_id, %s) '
    'select d.id, %s from public.deliverables d where %s '
    'on conflict (deliverable_id) do update set %s',
    v_cols, v_sel, v_where, v_upd);
  get diagnostics n = row_count;

  -- ★★ التحقّق قبل الإسقاط: أيّ صفّ يحمل قيمة على deliverables ولا يقابله صفّ
  --    في الجدول الجانبي ⇒ استثناء يُجهض المعاملة كلّها. لا إسقاط بلا يقين.
  execute format(
    'select count(*) from public.deliverables d '
    'where (%s) and not exists (select 1 from public.deliverable_internal i where i.deliverable_id = d.id)',
    v_where) into v_left;
  if v_left > 0 then
    raise exception 'LARGE_PROJECTS §1b: % صفًّا يحمل بيانات داخلية ولم يُنقَل — أُجهضت المعاملة ولم يُسقَط أيّ عمود.', v_left;
  end if;

  -- الفهارس القديمة تُسقَط صراحةً (وإلّا أُسقطت ضمنًا مع أعمدتها بلا أثر مقروء).
  execute 'drop index if exists public.ux_deliverables_external_key';
  execute 'drop index if exists public.idx_deliverables_batch';

  -- ⚠️⚠️ DROP COLUMN لا يُسترجع بأمر SQL. يُنفَّذ الآن فقط لأن كل قيمة صارت
  --      محفوظة في public.deliverable_internal وتُحقّق منها للتوّ صفًّا بصفّ.
  --      لو أُجهضت المعاملة بعد هذا السطر لأيّ سبب فلا شيء يُفقد: الإسقاط نفسه
  --      داخل المعاملة ويُتراجَع عنه كاملًا.
  foreach c in array v_src loop
    execute format('alter table public.deliverables drop column if exists %I', c);
  end loop;

  raise notice 'LARGE_PROJECTS §1b: نُقل % صفًّا إلى deliverable_internal ثم أُسقطت الأعمدة: %', n, array_to_string(v_src, ', ');
end $mig$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1b-ب) الفهرس الفريد الجزئيّ — أساس idempotency للاستيراد، انتقل معه
-- ─────────────────────────────────────────────────────────────────────────────
do $ux$
declare v_dup int := 0;
begin
  select count(*) into v_dup from (
    select external_key from public.deliverable_internal
     where external_key is not null group by external_key having count(*) > 1) s;
  if v_dup > 0 then
    raise exception 'LARGE_PROJECTS §1b: % مفتاح external_key مكرّر في deliverable_internal — الفهرس الفريد يستحيل. صحّح التكرار ثم أعد التشغيل.', v_dup;
  end if;
end $ux$;

create unique index if not exists ux_deliverable_internal_external_key
  on public.deliverable_internal (external_key) where external_key is not null;
create index if not exists idx_deliverable_internal_batch
  on public.deliverable_internal (import_batch_id) where import_batch_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1b-ج) البوّابة — كوادر فقط، وكل مُسنِد coalesce(...,false)
--   المجموعة المسموح لها هنا مطابقة تمامًا لمجموعة project_units_can_write (§8):
--   من يستطيع تعديل المخرج أصلًا هو من يقرأ/يكتب ملاحظاته الداخلية — لا مجموعة
--   ثالثة تُخترع ولا صلاحية تتوسّع.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.deliverable_internal_is_staff(p_deliverable uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_proj uuid; v boolean := false;
begin
  if p_deliverable is null then return false; end if;

  begin
    select d.project_id into v_proj from public.deliverables d where d.id = p_deliverable;
  exception when others then return false; end;

  -- صفّ يتيم (لا مخرج مقابل): الإدارة وحدها.
  if v_proj is null then
    begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
    return coalesce(v, false);
  end if;

  -- ★ حاجز مضاد للعميل: من يقف على جانب العميل في هذا المشروع يُرفض هنا مهما
  --   قالت البوّابات الأخرى. coalesce(...,false) مقصود: NULL ليس إثباتًا أنه
  --   عميل، والرفض الحقيقي تتكفّل به البوّابات الموجبة أدناه وكلّها fail-closed.
  begin
    if coalesce(public.is_client_side(v_proj), false) then return false; end if;
  exception when others then return false; end;

  begin v := coalesce(public.is_admin(), false);              exception when others then v := false; end;
  if coalesce(v, false) then return true; end if;
  begin v := coalesce(public.can_manage_projects(), false);   exception when others then v := false; end;
  if coalesce(v, false) then return true; end if;
  begin v := coalesce(public.is_kian_member(v_proj), false);  exception when others then v := false; end;
  return coalesce(v, false);
end $$;

alter table public.deliverable_internal enable row level security;

drop policy if exists deliverable_internal_read  on public.deliverable_internal;
create policy deliverable_internal_read on public.deliverable_internal for select to authenticated
  using (coalesce(public.deliverable_internal_is_staff(deliverable_id), false));

drop policy if exists deliverable_internal_write on public.deliverable_internal;
create policy deliverable_internal_write on public.deliverable_internal for all to authenticated
  using      (coalesce(public.deliverable_internal_is_staff(deliverable_id), false))
  with check (coalesce(public.deliverable_internal_is_staff(deliverable_id), false));

revoke all on public.deliverable_internal from public, anon;
grant select, insert, update, delete on public.deliverable_internal to authenticated;  -- السياسة تفصل فعليًّا

revoke all on function public.deliverable_internal_is_staff(uuid) from public, anon;
grant execute on function public.deliverable_internal_is_staff(uuid) to authenticated;


-- ════════════════════════════════════════════════════════════════════════════
-- §2) الجدول المرجعيّ لأنواع المحتوى — بديل قيد CHECK المتحجّر
--     لماذا جدول لا CHECK؟ لأن CHECK يحتاج ترحيلًا لكل نوع عمل جديد، وقيد CHECK
--     ضيّق هو بالضبط ما جعل هذا الجدول عاجزًا عن تمثيل الطباعة/الفعاليات/الهدايا.
--     إضافة نوع جديد = صفّ واحد هنا، بلا SQL migration وبلا نشر.
-- ════════════════════════════════════════════════════════════════════════════
create table if not exists public.deliverable_content_types (
  key        text primary key,
  label_ar   text not null default '',
  label_en   text not null default '',
  is_active  boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

insert into public.deliverable_content_types (key, label_ar, label_en, is_active, sort_order) values
  ('video',            'فيديو',            'Video',            true,  10),
  ('photography',      'تصوير فوتوغرافي',  'Photography',      true,  20),
  ('design',           'تصميم',            'Design',           true,  30),
  ('print',            'طباعة',            'Print',            true,  40),
  ('live_stream',      'بث مباشر',         'Live stream',      true,  50),
  ('event',            'فعالية',           'Event',            true,  60),
  ('field_execution',  'تنفيذ ميداني',     'Field execution',  true,  70),
  ('presentation',     'عرض تقديمي',       'Presentation',     true,  80),
  ('gift',             'هدية',             'Gift',             true,  90),
  ('report',           'تقرير',            'Report',           true, 100),
  ('digital_content',  'محتوى رقمي',       'Digital content',  true, 110),
  ('copywriting',      'كتابة محتوى',      'Copywriting',      true, 120),
  ('custom',           'نوع مخصّص',        'Custom',           true, 900)
on conflict (key) do nothing;   -- تشغيل مُكرَّر لا يدهس تسميات عدّلها المالك


-- ════════════════════════════════════════════════════════════════════════════
-- §3) ★ القيد الضيّق على deliverables.type ★
--
--   الوضع القائم: check (type in ('video','photo','other')) — معرَّف نصًّا في
--   **ملفّين** (docs/phase0_migration.sql و docs/deliverable_versions_RUNME.sql)،
--   والاسم الحيّ قد يكون deliverables_type_check أو أيّ اسم آخر ولّده PostgreSQL.
--   لذلك نبحث عنه في pg_constraint وقت التشغيل — **لا نخمّن اسمًا**.
--
--   ★ لماذا إسقاطه آمن ★
--     (1) لا نفقد بيانات: DROP CONSTRAINT يُزيل قاعدة تحقّق فقط، ولا يمسّ صفًّا
--         واحدًا. كل القيم القائمة (video/photo/other) تبقى قانونية تحت القيد الجديد.
--     (2) لا نكسر قارئًا: القارئ الوحيد الذي يفرّع على القيمة هو
--         docs/deliverable_versions_RUNME.sql:82
--           case d.type when 'video' then 'video' when 'photo' then 'image' else 'other' end
--         وله فرع `else` شامل ⇒ أيّ قيمة جديدة تنحدر إلى 'other' بلا استثناء.
--         وطبقة TypeScript لا تفرّع على العمود إطلاقًا (فحص المستودع كلّه).
--     (3) لا نفتح الباب على مصراعيه: التصنيف الحقيقي انتقل إلى content_type
--         المربوط بمفتاح خارجيّ إلى الجدول المرجعيّ ⇒ الانضباط صار **أقوى** لا أضعف،
--         والـ Trigger في §4 يُبقي `type` ضمن المفردات الثلاث القديمة دائمًا.
--     (4) لا نُسقط قيدًا لا نقصده: الشرط يشترط وجود 'video' و'photo' معًا وغياب
--         'photography' ⇒ قيد status لا يُمسّ، وإعادة التشغيل لا تُسقط قيدنا الجديد.
--
--   العمود القديم `type` **يبقى كما هو** (not null, default 'video') — لا يُحذف.
-- ════════════════════════════════════════════════════════════════════════════
do $ck2$
declare r record; v_att smallint; v_dropped int := 0;
begin
  select a.attnum into v_att from pg_attribute a
   where a.attrelid = 'public.deliverables'::regclass and a.attname = 'type' and not a.attisdropped;
  if v_att is null then raise exception 'deliverables.type غير موجود — بنية غير متوقّعة، أوقف التطبيق.'; end if;

  for r in
    select c.conname, pg_get_constraintdef(c.oid) as def
      from pg_constraint c
     where c.conrelid = 'public.deliverables'::regclass
       and c.contype  = 'c'
       and v_att = any (c.conkey)                       -- القيد يخصّ العمود type فعلًا
  loop
    if r.def ilike '%video%' and r.def ilike '%photo%' and r.def not ilike '%photography%' then
      raise notice 'LARGE_PROJECTS §3: إسقاط القيد الضيّق % ⇐ %', r.conname, r.def;
      execute format('alter table public.deliverables drop constraint %I', r.conname);
      v_dropped := v_dropped + 1;
    end if;
  end loop;

  if v_dropped = 0 then
    raise notice 'LARGE_PROJECTS §3: لا قيد ضيّق (أُسقط سابقًا أو لم يُطبَّق) — نضيف القيد المفتوح فقط.';
  end if;
end $ck2$;

-- القيد المفتوح: يمنع الفراغ فقط. الانضباط الحقيقي في content_type + المفتاح الخارجي.
-- ★ لا نُجهض الترحيل بسبب بيانات فاسدة سابقة: إن وُجد صفّ بـ type فارغ (مستحيل
--   تحت القيد الضيّق، لكنه ممكن إن كان قد أُسقط سابقًا) نتخطّى القيد ونُعلن السبب
--   بصوت عالٍ بدل أن نُسقط المعاملة كلّها أو نُعدّل بيانات عمل بلا إذن.
do $ck3$
declare n int;
begin
  if exists (select 1 from pg_constraint
              where conrelid = 'public.deliverables'::regclass and conname = 'deliverables_type_open_ck') then
    return;
  end if;
  select count(*) into n from public.deliverables where coalesce(btrim(type),'') = '';
  if n > 0 then
    raise notice 'LARGE_PROJECTS §3: لم يُضَف deliverables_type_open_ck — % صفًّا بـ type فارغ. صحّحها ثم أعد التشغيل (الملفّ idempotent).', n;
    return;
  end if;
  alter table public.deliverables add constraint deliverables_type_open_ck
    check (type is null or btrim(type) <> '');
end $ck3$;

-- تعبئة content_type من العمود القديم (مرّة واحدة، للصفوف التي لم تُملأ بعد).
update public.deliverables
   set content_type = case lower(btrim(coalesce(type,'')))
                        when 'video'       then 'video'
                        when 'photo'       then 'photography'
                        when 'photography' then 'photography'
                        when 'other'       then 'custom'
                        else null end
 where content_type is null;

-- انحراف بيانات محتمل (قيمة type خارج المفردات الثلاث): نحفظها كنوع غير مفعّل
-- في الجدول المرجعيّ بدل إتلافها أو إجهاض الترحيل.
insert into public.deliverable_content_types (key, label_ar, label_en, is_active, sort_order)
select distinct lower(btrim(d.type)), lower(btrim(d.type)), lower(btrim(d.type)), false, 950
  from public.deliverables d
 where d.content_type is null and coalesce(btrim(d.type),'') <> ''
on conflict (key) do nothing;

update public.deliverables
   set content_type = lower(btrim(type))
 where content_type is null and coalesce(btrim(type),'') <> '';

update public.deliverables set content_type = 'custom' where content_type is null;

-- المفتاح الخارجي — يُضاف بعد التعبئة فيُصادَق فورًا بلا فشل.
do $fk$
begin
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.deliverables'::regclass and conname = 'deliverables_content_type_fk') then
    alter table public.deliverables add constraint deliverables_content_type_fk
      foreign key (content_type) references public.deliverable_content_types(key) on update cascade;
  end if;
end $fk$;


-- ════════════════════════════════════════════════════════════════════════════
-- §4) مزامنة العمودين — العمود القديم `type` يبقى صحيحًا للأبد
--     القاعدة: content_type هو المصدر؛ `type` إسقاطه على المفردات الثلاث القديمة.
--       video → video · photography → photo · كل ما عداه → other
--     الـ Trigger لا يدهس قيمة `type` التي غيّرها المستدعي صراحةً في نفس العملية.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.deliverable_content_type_legacy(p_key text)
returns text language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_key,'')))
           when 'video'       then 'video'
           when 'photography' then 'photo'
           else 'other' end;
$$;

create or replace function public.deliverables_type_sync() returns trigger
language plpgsql set search_path = public as $$
declare v_given boolean; v_legacy text;
begin
  v_given := (new.content_type is not null and btrim(new.content_type) <> '');

  if v_given then
    new.content_type := lower(btrim(new.content_type));
    v_legacy := public.deliverable_content_type_legacy(new.content_type);
    if tg_op = 'INSERT' then
      -- المستدعي صرّح بنوع المحتوى ⇒ العمود القديم مشتقّ منه دائمًا
      -- (لا يمكن التمييز بين 'video' الصريحة و'video' الافتراضية عند الإدراج).
      new.type := v_legacy;
    elsif new.type is not distinct from old.type
      and new.content_type is distinct from old.content_type then
      new.type := v_legacy;      -- غُيّر النوع الجديد ولم يُلمس القديم ⇒ زامِن
    end if;
  else
    -- لا content_type ⇒ اشتقّه من العمود القديم ولا تلمس `type` إطلاقًا.
    new.content_type := case lower(btrim(coalesce(new.type,'')))
                          when 'video'       then 'video'
                          when 'photo'       then 'photography'
                          when 'photography' then 'photography'
                          when 'other'       then 'custom'
                          else 'custom' end;
  end if;
  return new;
end $$;

drop trigger if exists trg_deliverables_type_sync on public.deliverables;
create trigger trg_deliverables_type_sync
  before insert or update of type, content_type on public.deliverables
  for each row execute function public.deliverables_type_sync();


-- ════════════════════════════════════════════════════════════════════════════
-- §5) الجدولة على public.projects — نفس المفردات على مستوى المشروع والمرحلة
--     (المرحلة صفّ في projects أيضًا ⇒ عمود واحد يخدم المستويين، بلا ازدواج.)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.projects add column if not exists schedule_status    text not null default 'awaiting_schedule';
alter table public.projects add column if not exists planned_start_date date;
alter table public.projects add column if not exists stage_order        int;

update public.projects set schedule_status = 'awaiting_schedule' where schedule_status is null;

-- تعبئة أولية لترتيب المراحل من sequence_number إن كان عمود الهرمية موجودًا،
-- كي لا يبدأ ترتيبان متنافسان من نقطتين مختلفتين. لاحقًا العمودان مستقلّان:
-- sequence_number = رقم الفرع في الهرمية · stage_order = ترتيب العرض القابل للسحب.
do $so$
begin
  if exists (select 1 from information_schema.columns
              where table_schema='public' and table_name='projects' and column_name='sequence_number') then
    execute 'update public.projects set stage_order = sequence_number
              where stage_order is null and sequence_number is not null';
  end if;
end $so$;

do $ck4$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_schedule_status_ck') then
    alter table public.projects add constraint projects_schedule_status_ck
      check (schedule_status in ('awaiting_schedule','scheduled','in_progress','done','on_hold','cancelled'));
  end if;
end $ck4$;


-- ════════════════════════════════════════════════════════════════════════════
-- §6) الفهارس
-- ════════════════════════════════════════════════════════════════════════════
-- ★ الفهرس الفريد الجزئيّ على external_key (أساس idempotency للاستيراد) وفهرس
--   الدفعة انتقلا إلى §1b مع عموديهما: ux_deliverable_internal_external_key و
--   idx_deliverable_internal_batch على public.deliverable_internal.

create index if not exists idx_deliverables_stage        on public.deliverables (stage_id)        where stage_id is not null;
create index if not exists idx_deliverables_schedule     on public.deliverables (schedule_status);
create index if not exists idx_deliverables_content_type on public.deliverables (content_type);
create index if not exists idx_deliverables_project_sort on public.deliverables (project_id, sort_order);
create index if not exists idx_deliverables_platforms    on public.deliverables using gin (platforms);
create index if not exists idx_projects_stage_order      on public.projects (parent_project_id, stage_order)
  where parent_project_id is not null;


-- ════════════════════════════════════════════════════════════════════════════
-- §7) الهرمية — جذر · عمق · حارس دورات · حدّ عمق · ربط المخرج بالمرحلة
--     ملاحظة: حزمة الهرمية (Batch 6A) تفرض بنيويًّا مستويين فقط
--     (subproject ⇐ master). ما هنا **دفاعيّ** لا بديل: يحمي أيّ توسعة مستقبلية
--     ويحمي أيّ تعديل يدويّ مباشر على parent_project_id يتجاوز دوالّ المنصّة.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_hierarchy_max_depth()
returns int language sql immutable set search_path = public as $$ select 8 $$;
comment on function public.project_hierarchy_max_depth() is
  'حدّ عمق الهرمية (الجذر = 0). قيمة واحدة يستعملها كل حارس ودالّة تجميع.';

-- جذر الشجرة. حلقة محدودة: لا تعليق حتى مع دورة فاسدة في البيانات.
create or replace function public.project_hierarchy_root(p_project uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_cur uuid := p_project; v_next uuid; v_d int := 0; v_max int := public.project_hierarchy_max_depth();
begin
  if p_project is null then return null; end if;
  if not exists (select 1 from public.projects where id = p_project) then return null; end if;
  loop
    select parent_project_id into v_next from public.projects where id = v_cur;
    exit when v_next is null;
    if v_next = p_project or v_next = v_cur then raise exception 'circular_hierarchy'; end if;
    v_d := v_d + 1;
    if v_d > v_max then raise exception 'hierarchy_too_deep'; end if;
    v_cur := v_next;
  end loop;
  return v_cur;
end $$;

create or replace function public.project_hierarchy_depth(p_project uuid)
returns int language plpgsql stable security definer set search_path = public as $$
declare v_cur uuid := p_project; v_next uuid; v_d int := 0; v_max int := public.project_hierarchy_max_depth();
begin
  if p_project is null then return null; end if;
  if not exists (select 1 from public.projects where id = p_project) then return null; end if;
  loop
    select parent_project_id into v_next from public.projects where id = v_cur;
    exit when v_next is null;
    if v_next = p_project or v_next = v_cur then raise exception 'circular_hierarchy'; end if;
    v_d := v_d + 1;
    if v_d > v_max then raise exception 'hierarchy_too_deep'; end if;
    v_cur := v_next;
  end loop;
  return v_d;
end $$;

-- هل يجوز أن يصير p_parent أبًا لـ p_child؟ يُستدعى **قبل** النقل من الواجهة،
-- ويُطبَّق أيضًا كحارس Trigger أدناه. لا يرفع استثناءً — يُرجع سببًا قابلًا للعرض.
create or replace function public.project_hierarchy_can_parent(p_child uuid, p_parent uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cur uuid; v_d int := 0; v_max int := public.project_hierarchy_max_depth();
        v_child_sub int; v_parent_depth int;
begin
  if p_child is null or p_parent is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_argument');
  end if;
  if p_child = p_parent then
    return jsonb_build_object('ok', false, 'reason', 'self_parent');
  end if;
  if not exists (select 1 from public.projects where id = p_child  and coalesce(is_deleted,false) = false) then
    return jsonb_build_object('ok', false, 'reason', 'child_not_found');
  end if;
  if not exists (select 1 from public.projects where id = p_parent and coalesce(is_deleted,false) = false) then
    return jsonb_build_object('ok', false, 'reason', 'parent_not_found');
  end if;

  -- (أ) دورة: هل p_parent منحدر من p_child؟
  v_cur := p_parent;
  loop
    select parent_project_id into v_cur from public.projects where id = v_cur;
    exit when v_cur is null;
    if v_cur = p_child then return jsonb_build_object('ok', false, 'reason', 'circular_hierarchy'); end if;
    v_d := v_d + 1;
    if v_d > v_max then return jsonb_build_object('ok', false, 'reason', 'hierarchy_too_deep'); end if;
  end loop;

  -- (ب) حدّ العمق بعد النقل: عمق الأب + 1 + أعمق فرع تحت الابن.
  v_parent_depth := public.project_hierarchy_depth(p_parent);
  with recursive sub(id, d) as (
    select p_child, 0
    union all
    select c.id, s.d + 1 from public.projects c join sub s on c.parent_project_id = s.id
     where coalesce(c.is_deleted,false) = false and s.d < v_max
  )
  select coalesce(max(d), 0) into v_child_sub from sub;

  if coalesce(v_parent_depth,0) + 1 + coalesce(v_child_sub,0) > v_max then
    return jsonb_build_object('ok', false, 'reason', 'hierarchy_too_deep',
      'parent_depth', v_parent_depth, 'child_subtree_depth', v_child_sub, 'max_depth', v_max);
  end if;

  return jsonb_build_object('ok', true, 'reason', 'allowed',
    'parent_depth', v_parent_depth, 'child_subtree_depth', v_child_sub,
    'resulting_depth', coalesce(v_parent_depth,0) + 1 + coalesce(v_child_sub,0), 'max_depth', v_max);
end $$;

-- حارس Trigger على projects: دورات وعمق فقط. لا يمسّ قواعد النطاق/العميل —
-- تلك ملك حارس حزمة الهرمية، والحارسان يتعايشان (Trigger مستقلّ باسم مختلف).
create or replace function public.projects_depth_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if new.parent_project_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.parent_project_id is not distinct from old.parent_project_id then return new; end if;
  if new.parent_project_id = new.id then raise exception 'circular_hierarchy'; end if;
  v := public.project_hierarchy_can_parent(new.id, new.parent_project_id);
  if not coalesce((v->>'ok')::boolean, false) then
    -- الإدراج: الصفّ لم يُكتب بعد فـ can_parent يُرجع child_not_found — نتجاهله
    -- ونكتفي بفحص الدورة عبر سلسلة الأب (لا يمكن أن يكون صفّ جديد أبًا لأحد).
    if tg_op = 'INSERT' and (v->>'reason') = 'child_not_found' then
      perform public.project_hierarchy_depth(new.parent_project_id);   -- يرفع عند دورة/عمق
      if coalesce(public.project_hierarchy_depth(new.parent_project_id),0) + 1
         > public.project_hierarchy_max_depth() then raise exception 'hierarchy_too_deep'; end if;
      return new;
    end if;
    raise exception '%', coalesce(v->>'reason','hierarchy_rejected');
  end if;
  return new;
end $$;

drop trigger if exists trg_projects_depth_guard on public.projects;
create trigger trg_projects_depth_guard
  before insert or update of parent_project_id on public.projects
  for each row execute function public.projects_depth_guard();

-- حارس ربط المخرج بمرحلة: المرحلة يجب أن تكون مشروعًا حيًّا في **نفس الشجرة**.
-- يقبل الشكلين: stage_id = المشروع نفسه · stage_id = فرع من شجرة المشروع.
create or replace function public.deliverables_stage_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_rp uuid; v_rs uuid;
begin
  if new.stage_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.stage_id   is not distinct from old.stage_id
     and new.project_id is not distinct from old.project_id then return new; end if;
  if not exists (select 1 from public.projects p
                  where p.id = new.stage_id and coalesce(p.is_deleted,false) = false)
    then raise exception 'stage_not_found_or_deleted'; end if;
  v_rp := public.project_hierarchy_root(new.project_id);
  v_rs := public.project_hierarchy_root(new.stage_id);
  if v_rp is null or v_rs is null or v_rp <> v_rs then
    raise exception 'stage_must_share_project_tree';
  end if;
  return new;
end $$;

drop trigger if exists trg_deliverables_stage_guard on public.deliverables;
create trigger trg_deliverables_stage_guard
  before insert or update of stage_id, project_id on public.deliverables
  for each row execute function public.deliverables_stage_guard();


-- ════════════════════════════════════════════════════════════════════════════
-- §8) محرّك التقدّم الموزون بالوحدات
--
-- ★★ الخوارزمية — موثّقة سطرًا بسطر ★★
--
--   لكلّ مخرج مؤهَّل نحسب وزنًا W وكسر إنجاز F، والنسبة = Σ(W·F) / Σ(W).
--
--   • المؤهَّلون: is_deleted = false · status <> 'archived' · schedule_status <> 'cancelled'.
--     (المؤرشف والملغى ليسا عملًا مؤجَّلًا — إبقاؤهما يجعل النسبة تكذب إلى الأبد.)
--
--   • الوزن W = expected_units إن كانت معلومة وأكبر من صفر، وإلّا **1**.
--     ⇐ الاحتياطي الموثّق: «مخرج بلا عدد وحدات = وحدة واحدة». لا نُسقطه من المقام
--       (كان سيرفع النسبة كذبًا) ولا نعطيه وزنًا مضخّمًا.
--     ⇐ سقف W = 1000: خطأ إدخال (999999) كان سيمحو كل المخرجات الأخرى من المعادلة.
--
--   • الكسر F:
--       status ∈ (approved, final_delivered)          → 1.00  (سُلّم فعلًا مهما قالت العدّادات)
--       expected_units معلومة > 0                     → min(1, completed_units / expected_units)
--       expected_units مجهولة و completed_units > 0   → max(0.5, سُلّم الحالة)   ← احتياطي موثّق
--       غير ذلك                                       → سُلّم الحالة
--     سُلّم الحالة: draft 0.00 · revision_requested 0.50 · internal_review 0.60 ·
--                  client_review 0.75 · approved/final_delivered 1.00 · أيّ شيء آخر 0.00
--     ⇐ لماذا max(0.5,…)؟ تسجيل وحدات منجزة يجب ألّا **يخفض** النسبة أبدًا مقارنةً
--       بمخرج لم يُسجَّل فيه شيء، ولا يجوز أن يمنح 100% بلا هدف معلوم.
--
--   • التأخير: مخرج متأخّر ⟺ schedule_status ∈ (scheduled, in_progress)
--     و due_date < اليوم و F < 1.
--     ★ awaiting_schedule **لا يُحتسب تأخيرًا أبدًا** — ولا on_hold ولا cancelled.
--       «لم يُجدَول» ليس «تأخّر»؛ خلطهما يُنتج لوحة حمراء بلا معنى في مشروع لم يبدأ.
--
--   • مرحلة فارغة: Σ(W) = 0 ⇒ النسبة **NULL** لا 0. والتجميع يضمّ مخرجات الشجرة
--     كلّها في مقام واحد ⇒ المرحلة الفارغة لا تضيف وزنًا ولا تُشوّه نسبة الأب.
--     (المتوسط الحسابي على المراحل كان سيجعل مرحلة فارغة تسحب الأب إلى الصفر.)
--
--   • مشروع مغلق: core_stage = 'closed' ⇒ تُرجَع النسبة **المجمّدة**
--     (project_core.progress_pct، أو 100 عند غيابها) وطريقة الحساب 'closed_frozen'.
--     العدّادات تُحسب للعرض لكنها لا تغيّر النسبة. لماذا؟ لأن تعديل بيانات بعد
--     الإغلاق كان سيُعيد كتابة نتيجة تاريخية اعتمدها العميل.
--
--   • عرض العميل: يُشتقّ من الهوية ولا يُمرَّر كوسيط (لا يمكن لأحد أن «يطلب» عرض
--     الكوادر). العميل يرى فقط المخرجات التي client_visible = true، ولا يرى قطّ
--     execution_details (الدوالّ تُرجع تجميعات لا صفوفًا). أمّا internal_notes
--     فلم يعد على الجدول أصلًا — انظر §1b.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.deliverable_status_progress_fraction(p_status text)
returns numeric language sql immutable set search_path = public as $$
  select case lower(btrim(coalesce(p_status,'')))
           when 'final_delivered'    then 1.00
           when 'approved'           then 1.00
           when 'client_review'      then 0.75
           when 'internal_review'    then 0.60
           when 'revision_requested' then 0.50
           when 'draft'              then 0.00
           else 0.00 end::numeric;
$$;

-- بوّابات القراءة — plpgsql مع exception حول كل استدعاء خارجيّ: أيّ تبعية غائبة
-- تعني «امنع»، لا «انهَر» ولا «افتح». وكل مسار يعود بـ boolean غير NULL.
create or replace function public.project_units_can_read(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if p_project is null then return false; end if;
  begin v := coalesce(public.pc_can_read_project(p_project), false); exception when others then v := false; end;
  if coalesce(v,false) then return true; end if;
  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if coalesce(v,false) then return true; end if;
  begin v := coalesce(public.can_access_project(p_project), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

-- true ⇒ المستدعي طرف عميل ⇒ يُقصر العدّ على client_visible.
create or replace function public.project_units_client_view(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if p_project is null then return true; end if;               -- الأضيق عند الشكّ
  begin v := coalesce(public.pc_can_read_project(p_project), false); exception when others then v := false; end;
  if coalesce(v,false) then return false; end if;              -- كوادر ⇒ عرض كامل
  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if coalesce(v,false) then return false; end if;
  return true;                                                 -- أيّ وصول آخر ⇒ عرض عميل
end $$;

-- المحرّك الأساسي: مخرجات مشروع واحد (اختياريًّا مرحلة واحدة داخله).
create or replace function public.project_units_progress(p_project uuid, p_stage_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_client boolean; v_today date := (now() at time zone 'utc')::date;
  v_max_w numeric := 1000;
  v_total int; v_counted int; v_archived int; v_cancelled int;
  v_wt numeric; v_wd numeric; v_exp bigint; v_comp bigint;
  v_overdue int; v_await int; v_sched int; v_prog int; v_done int;
  v_pct int; v_method text; v_stage text; v_frozen int;
begin
  if p_project is null then raise exception 'project_required'; end if;
  if not coalesce(public.project_units_can_read(p_project), false) then raise exception 'not authorized'; end if;
  v_client := coalesce(public.project_units_client_view(p_project), true);

  select pc.core_stage, pc.progress_pct into v_stage, v_frozen
    from public.project_core pc where pc.project_id = p_project;

  with base as (
    select d.*,
           case
             when coalesce(d.status,'') in ('approved','final_delivered') then 1.00::numeric
             when d.expected_units is not null and d.expected_units > 0
               then least(1.00, greatest(0, coalesce(d.completed_units,0))::numeric / d.expected_units)
             when coalesce(d.completed_units,0) > 0
               then greatest(0.50, public.deliverable_status_progress_fraction(d.status))
             else public.deliverable_status_progress_fraction(d.status)
           end as f,
           least(greatest(coalesce(nullif(d.expected_units,0), 1), 1), v_max_w)::numeric as w
      from public.deliverables d
     where d.project_id = p_project
       and coalesce(d.is_deleted,false) = false
       and (p_stage_id is null or d.stage_id = p_stage_id)
       and (not v_client or coalesce(d.client_visible,false) = true)
  ), counted as (
    select * from base
     where coalesce(status,'') <> 'archived'
       and coalesce(schedule_status,'awaiting_schedule') <> 'cancelled'
  )
  select (select count(*)::int from base),
         (select count(*)::int from counted),
         (select count(*)::int from base where coalesce(status,'') = 'archived'),
         (select count(*)::int from base where coalesce(schedule_status,'awaiting_schedule') = 'cancelled'),
         (select coalesce(sum(w),0)     from counted),
         (select coalesce(sum(w*f),0)   from counted),
         (select coalesce(sum(coalesce(expected_units,0)),0)  from counted),
         (select coalesce(sum(coalesce(completed_units,0)),0) from counted),
         (select count(*)::int from counted
            where coalesce(schedule_status,'awaiting_schedule') in ('scheduled','in_progress')
              and due_date is not null and due_date < v_today and f < 1.00),
         (select count(*)::int from counted where coalesce(schedule_status,'awaiting_schedule') = 'awaiting_schedule'),
         (select count(*)::int from counted where coalesce(schedule_status,'') = 'scheduled'),
         (select count(*)::int from counted where coalesce(schedule_status,'') = 'in_progress'),
         (select count(*)::int from counted where f >= 1.00)
    into v_total, v_counted, v_archived, v_cancelled, v_wt, v_wd, v_exp, v_comp,
         v_overdue, v_await, v_sched, v_prog, v_done;

  if v_wt > 0 then
    v_pct := greatest(0, least(100, round(100 * v_wd / v_wt)::int));
    v_method := 'units_weighted';
  else
    v_pct := null;                       -- ★ لا صفر — «غير متاح» ليست «صفر إنجاز»
    v_method := 'no_countable_deliverables';
  end if;

  if coalesce(v_stage,'') = 'closed' then
    v_pct := coalesce(v_frozen, 100);    -- ★ المشروع المغلق يحتفظ بنتيجته
    v_method := 'closed_frozen';
  end if;

  return jsonb_build_object(
    'project_id', p_project, 'stage_id', p_stage_id,
    'scope', case when p_stage_id is null then 'project' else 'stage' end,
    'client_view', v_client, 'core_stage', v_stage, 'frozen', (v_method = 'closed_frozen'),
    'total', v_total, 'counted', v_counted, 'archived', v_archived, 'cancelled', v_cancelled,
    'units_expected', v_exp, 'units_completed', v_comp,
    'weight_total', round(v_wt,2), 'weight_done', round(v_wd,2),
    'pct', v_pct, 'calculation_method', v_method,
    'overdue', v_overdue, 'awaiting_schedule', v_await, 'scheduled', v_sched,
    'in_progress', v_prog, 'done', v_done,
    'max_unit_weight', v_max_w, 'calculated_at', now());
end $$;

-- التجميع على الشجرة كلّها: مقام واحد لكل مخرجات المشروع وفروعه ⇒ لا عدّ مزدوج،
-- ولا تشويه من مرحلة فارغة (وزنها صفر فلا تدخل المعادلة أصلًا).
create or replace function public.project_units_rollup(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_client boolean; v_today date := (now() at time zone 'utc')::date;
  v_max int := public.project_hierarchy_max_depth(); v_max_w numeric := 1000;
  v_ids uuid[]; v_nproj int; v_children int;
  v_total int; v_counted int; v_wt numeric; v_wd numeric;
  v_exp bigint; v_comp bigint; v_overdue int; v_await int; v_done int;
  v_pct int; v_method text; v_stage text; v_frozen int;
begin
  if p_project is null then raise exception 'project_required'; end if;
  if not coalesce(public.project_units_can_read(p_project), false) then raise exception 'not authorized'; end if;
  v_client := coalesce(public.project_units_client_view(p_project), true);

  select pc.core_stage, pc.progress_pct into v_stage, v_frozen
    from public.project_core pc where pc.project_id = p_project;

  -- شجرة محدودة العمق: قيد d < v_max يُنهي أيّ دورة فاسدة في البيانات بلا تعليق.
  with recursive tree(id, d) as (
    select p.id, 0 from public.projects p where p.id = p_project
    union all
    select c.id, t.d + 1 from public.projects c join tree t on c.parent_project_id = t.id
     where coalesce(c.is_deleted,false) = false and t.d < v_max
  )
  select array_agg(distinct id), count(distinct id)::int, count(distinct id) filter (where d > 0)::int
    into v_ids, v_nproj, v_children from tree;

  with base as (
    select d.*,
           case
             when coalesce(d.status,'') in ('approved','final_delivered') then 1.00::numeric
             when d.expected_units is not null and d.expected_units > 0
               then least(1.00, greatest(0, coalesce(d.completed_units,0))::numeric / d.expected_units)
             when coalesce(d.completed_units,0) > 0
               then greatest(0.50, public.deliverable_status_progress_fraction(d.status))
             else public.deliverable_status_progress_fraction(d.status)
           end as f,
           least(greatest(coalesce(nullif(d.expected_units,0), 1), 1), v_max_w)::numeric as w
      from public.deliverables d
     where d.project_id = any (v_ids)
       and coalesce(d.is_deleted,false) = false
       and (not v_client or coalesce(d.client_visible,false) = true)
  ), counted as (
    select * from base
     where coalesce(status,'') <> 'archived'
       and coalesce(schedule_status,'awaiting_schedule') <> 'cancelled'
  )
  select (select count(*)::int from base),
         (select count(*)::int from counted),
         (select coalesce(sum(w),0)   from counted),
         (select coalesce(sum(w*f),0) from counted),
         (select coalesce(sum(coalesce(expected_units,0)),0)  from counted),
         (select coalesce(sum(coalesce(completed_units,0)),0) from counted),
         (select count(*)::int from counted
            where coalesce(schedule_status,'awaiting_schedule') in ('scheduled','in_progress')
              and due_date is not null and due_date < v_today and f < 1.00),
         (select count(*)::int from counted where coalesce(schedule_status,'awaiting_schedule') = 'awaiting_schedule'),
         (select count(*)::int from counted where f >= 1.00)
    into v_total, v_counted, v_wt, v_wd, v_exp, v_comp, v_overdue, v_await, v_done;

  if v_wt > 0 then
    v_pct := greatest(0, least(100, round(100 * v_wd / v_wt)::int));
    v_method := 'units_weighted_subtree';
  else
    v_pct := null; v_method := 'no_countable_deliverables';
  end if;

  if coalesce(v_stage,'') = 'closed' then
    v_pct := coalesce(v_frozen, 100); v_method := 'closed_frozen';
  end if;

  return jsonb_build_object(
    'project_id', p_project, 'client_view', v_client, 'core_stage', v_stage,
    'frozen', (v_method = 'closed_frozen'),
    'projects_in_tree', v_nproj, 'child_projects', v_children, 'depth_limit', v_max,
    'total', v_total, 'counted', v_counted,
    'units_expected', v_exp, 'units_completed', v_comp,
    'weight_total', round(v_wt,2), 'weight_done', round(v_wd,2),
    'pct', v_pct, 'calculation_method', v_method,
    'overdue', v_overdue, 'awaiting_schedule', v_await, 'done', v_done,
    'own', public.project_units_progress(p_project, null),
    'calculated_at', now());
end $$;

-- صفوف المراحل (الفروع المباشرة) — لكلّ مرحلة نسبتها الخاصّة بنفس المحرّك.
-- ★ عزل الأخطاء: مرحلة واحدة لا يملك المستدعي قراءتها (أو فيها بيانات فاسدة) يجب
--   ألّا تُسقط اللوحة كلّها ⇒ كل صفّ داخل begin/exception ويظهر بـ progress = null.
create or replace function public.project_stage_progress(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb := '[]'::jsonb; r record; v_prog jsonb; v_err text;
begin
  if p_project is null then raise exception 'project_required'; end if;
  if not coalesce(public.project_units_can_read(p_project), false) then raise exception 'not authorized'; end if;

  for r in
    select c.id, c.project_name, c.stage_order, c.schedule_status, c.planned_start_date
      from public.projects c
     where c.parent_project_id = p_project
       and coalesce(c.is_deleted,false) = false
     order by coalesce(c.stage_order, 999999), coalesce(c.project_name,'')
  loop
    v_prog := null; v_err := null;
    begin
      v_prog := public.project_units_rollup(r.id);
    exception when others then
      v_prog := null; v_err := 'unavailable';
    end;
    v_rows := v_rows || jsonb_build_object(
      'stage_project_id',   r.id,
      'name',               r.project_name,
      'stage_order',        r.stage_order,
      'schedule_status',    coalesce(r.schedule_status,'awaiting_schedule'),
      'planned_start_date', r.planned_start_date,
      'progress',           v_prog,
      'error',              v_err);
  end loop;

  -- النموذج المسطّح أيضًا مدعوم: مخرجات مرتبطة بمرحلة عبر stage_id داخل نفس
  -- صفّ المشروع تظهر ضمن `own` أدناه (project_units_progress بلا مرحلة).
  return jsonb_build_object(
    'project_id', p_project,
    'stages', v_rows,
    'own', public.project_units_progress(p_project, null),
    'calculated_at', now());
end $$;

-- مسار التنقّل من الجذر إلى العقدة (للواجهة: «برنامج ← موسم ← حلقة»).
create or replace function public.project_breadcrumb(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_max int := public.project_hierarchy_max_depth(); v_rows jsonb;
begin
  if p_project is null then raise exception 'project_required'; end if;
  if not coalesce(public.project_units_can_read(p_project), false) then raise exception 'not authorized'; end if;

  with recursive up(id, parent_id, d) as (
    select p.id, p.parent_project_id, 0 from public.projects p where p.id = p_project
    union all
    select q.id, q.parent_project_id, u.d + 1
      from public.projects q join up u on q.id = u.parent_id
     where u.d < v_max
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'project_id',   p.id,
           'name',         p.project_name,
           'stage_order',  p.stage_order,
           'depth',        u.d,
           'is_current',   (p.id = p_project)
         ) order by u.d desc), '[]'::jsonb)
    into v_rows
  from up u join public.projects p on p.id = u.id;

  return jsonb_build_object('project_id', p_project, 'trail', v_rows,
                            'depth', public.project_hierarchy_depth(p_project),
                            'max_depth', v_max);
end $$;

-- قائمة أنواع المحتوى للواجهة (المفعّلة فقط افتراضيًّا).
create or replace function public.deliverable_content_types_list(p_include_inactive boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', t.key, 'label_ar', t.label_ar, 'label_en', t.label_en,
           'is_active', t.is_active, 'sort_order', t.sort_order,
           'legacy_type', public.deliverable_content_type_legacy(t.key)
         ) order by t.sort_order, t.key), '[]'::jsonb)
    into v from public.deliverable_content_types t
   where coalesce(p_include_inactive,false) or t.is_active;
  return coalesce(v, '[]'::jsonb);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- §8b) التعديل الجماعيّ — الدالّة التي تعتمد عليها الواجهة
--
--   ★ لماذا هذا القسم موجود ★
--     طبقة TypeScript (lib/portal/large-projects.ts) تنادي
--     public.large_project_deliverables_bulk_update وتُعطّل كلّ الإجراءات
--     الجماعية إن لم تجدها. بدون هذا القسم يبقى «تعديل ٧٩ مخرجًا دفعة واحدة»
--     معطَّلًا للأبد بلا سبب ظاهر.
--
--   ★ قواعد الأمان ★
--     (1) الصلاحية تُفحص على **الخادم ولكلّ صفّ على حدة** بمشروعه — لا يكفي أن
--         يملك المستدعي صلاحية على مشروع واحد ليكتب على معرّف صفّ من مشروع آخر.
--     (2) قائمة بيضاء صارمة للمفاتيح. لا project_id ولا id ولا أيّ عمود خارجها.
--         المفتاح غير المعروف يُجهض النداء كلّه صراحةً (لا يُتجاهَل بصمت).
--     (3) لا SQL ديناميكيّ إطلاقًا — جملة UPDATE ثابتة ومفاتيح p_patch تُقرأ
--         بـ `?` و`->>` فقط ⇒ لا سطح حقن.
--     (4) عزل لكلّ صفّ: صفّ يرفضه حارس أو قيد لا يُسقط بقية الدفعة، ويُعاد سببه.
--     (5) p_dry_run يفحص كلّ شيء ولا يكتب شيئًا؛ والنداء بقائمة فارغة بلا أثر
--         (هذا هو فحص التوفّر الذي تستعمله الواجهة).
--     (6) أثر التدقيق يُكتب ونُبلّغ عنه بصدق: فشله يُعيد audited=false ولا يُخفى.
-- ════════════════════════════════════════════════════════════════════════════

-- بوّابة الكتابة. fail-closed: كلّ نداء داخل begin/exception، وغياب الدالّة
-- التابعة أو أيّ خطأ ⇒ false لا NULL ولا true.
create or replace function public.project_units_can_write(p_project uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean := false;
begin
  if p_project is null then return false; end if;
  begin v := coalesce(public.is_admin(), false); exception when others then v := false; end;
  if coalesce(v,false) then return true; end if;
  begin v := coalesce(public.can_manage_projects(), false); exception when others then v := false; end;
  if coalesce(v,false) then return true; end if;
  begin v := coalesce(public.is_kian_member(p_project), false); exception when others then v := false; end;
  return coalesce(v, false);
end $$;

create or replace function public.large_project_deliverables_bulk_update(
  p_ids     uuid[],
  p_patch   jsonb,
  p_reason  text    default null,
  p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[]; v_k text; v_id uuid; v_proj uuid; v_n int;
  v_res jsonb := '[]'::jsonb;
  v_dry boolean := coalesce(p_dry_run, false);
  v_reason text; v_audited boolean := false; v_applied int := 0;
  v_allowed constant text[] := array[
    'assignee_id','priority','status','client_visible','due_date','planned_start_date',
    'schedule_status','stage_id','requires_shooting','requires_editing',
    'requires_design','requires_printing'];
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;

  select coalesce(array_agg(distinct x), '{}'::uuid[]) into v_ids
    from unnest(coalesce(p_ids, '{}'::uuid[])) t(x) where x is not null;

  -- نداء بلا معرّفات = فحص توفّر. ينجح بلا أثر ولا يفحص الحمولة.
  if cardinality(v_ids) = 0 then
    return jsonb_build_object('ok', true, 'requested', 0, 'applied', 0,
                              'dry_run', v_dry, 'audited', true, 'results', '[]'::jsonb);
  end if;
  if cardinality(v_ids) > 100 then
    raise exception 'too_many_ids: % (الحدّ 100 في النداء الواحد)', cardinality(v_ids);
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'empty_patch';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason,'')),'');
  if v_reason is null then raise exception 'reason_required'; end if;

  for v_k in select jsonb_object_keys(p_patch) loop
    if not (v_k = any (v_allowed)) then raise exception 'unsupported_patch_key: %', v_k; end if;
  end loop;

  foreach v_id in array v_ids loop
    begin
      select d.project_id into v_proj from public.deliverables d
       where d.id = v_id and coalesce(d.is_deleted,false) = false;

      if v_proj is null then
        v_res := v_res || jsonb_build_object('id', v_id, 'ok', false, 'error', 'not_found');
      elsif not coalesce(public.project_units_can_write(v_proj), false) then
        v_res := v_res || jsonb_build_object('id', v_id, 'ok', false, 'error', 'forbidden');
      elsif v_dry then
        v_res := v_res || jsonb_build_object('id', v_id, 'ok', true, 'error', null);
      else
        update public.deliverables d set
          assignee_id        = case when p_patch ? 'assignee_id'        then nullif(p_patch->>'assignee_id','')::uuid        else d.assignee_id        end,
          priority           = case when p_patch ? 'priority'           then nullif(btrim(p_patch->>'priority'),'')          else d.priority           end,
          status             = case when p_patch ? 'status'             then coalesce(nullif(btrim(p_patch->>'status'),''), d.status) else d.status    end,
          client_visible     = case when p_patch ? 'client_visible'     then coalesce((p_patch->>'client_visible')::boolean, d.client_visible) else d.client_visible end,
          due_date           = case when p_patch ? 'due_date'           then nullif(p_patch->>'due_date','')::date           else d.due_date           end,
          planned_start_date = case when p_patch ? 'planned_start_date' then nullif(p_patch->>'planned_start_date','')::date else d.planned_start_date end,
          schedule_status    = case when p_patch ? 'schedule_status'    then coalesce(nullif(btrim(p_patch->>'schedule_status'),''), d.schedule_status) else d.schedule_status end,
          stage_id           = case when p_patch ? 'stage_id'           then nullif(p_patch->>'stage_id','')::uuid           else d.stage_id           end,
          requires_shooting  = case when p_patch ? 'requires_shooting'  then coalesce((p_patch->>'requires_shooting')::boolean,  d.requires_shooting)  else d.requires_shooting  end,
          requires_editing   = case when p_patch ? 'requires_editing'   then coalesce((p_patch->>'requires_editing')::boolean,   d.requires_editing)   else d.requires_editing   end,
          requires_design    = case when p_patch ? 'requires_design'    then coalesce((p_patch->>'requires_design')::boolean,    d.requires_design)    else d.requires_design    end,
          requires_printing  = case when p_patch ? 'requires_printing'  then coalesce((p_patch->>'requires_printing')::boolean,  d.requires_printing)  else d.requires_printing  end
        where d.id = v_id;
        get diagnostics v_n = row_count;
        if v_n = 1 then
          v_applied := v_applied + 1;
          v_res := v_res || jsonb_build_object('id', v_id, 'ok', true, 'error', null);
        else
          v_res := v_res || jsonb_build_object('id', v_id, 'ok', false, 'error', 'not_updated');
        end if;
      end if;
    exception when others then
      v_res := v_res || jsonb_build_object('id', v_id, 'ok', false,
                                           'error', coalesce(nullif(btrim(sqlerrm),''), 'error'));
    end;
  end loop;

  begin
    insert into public.activity_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
    values (auth.uid(), null,
            case when v_dry then 'deliverables.bulk_update.dry_run' else 'deliverables.bulk_update' end,
            'deliverable', null,
            jsonb_build_object('reason', v_reason, 'patch', p_patch,
                               'requested', cardinality(v_ids), 'applied', v_applied,
                               'ids', to_jsonb(v_ids)));
    v_audited := true;
  exception when others then v_audited := false;
  end;

  return jsonb_build_object('ok', true, 'requested', cardinality(v_ids),
                            'applied', v_applied, 'dry_run', v_dry,
                            'audited', v_audited, 'results', v_res);
end $$;


-- ════════════════════════════════════════════════════════════════════════════
-- §8c) ★ جعل client_visible حقيقيًّا ★
--
--   المشكلة: العمود الجديد يعِد بـ«مخفيّ عن العميل»، لكن سياسة القراءة القائمة
--   (phase0_migration.sql:886) لا تعرفه ⇒ العميل يقرأ الصفّ المخفيّ فعلًا عبر
--   PostgREST مباشرةً. مفتاح إخفاء لا يُخفي أسوأ من غيابه.
--
--   الإصلاح: إعادة إنشاء نفس السياسة حرفيًّا + شرط واحد إضافيّ على **فرع العميل
--   وحده**. تضييق صِرف: فرع الكوادر لم يُمَسّ، وcoalesce(...,true) يعني أنّ أيّ
--   صفّ لم يُتَّخذ فيه قرار إخفاء صريح يبقى كما هو تمامًا ⇒ لا تغيّر سلوك قائم.
-- ════════════════════════════════════════════════════════════════════════════
do $rls$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='deliverables'
                    and column_name='client_visible') then
    raise exception 'deliverables.client_visible غير موجود — §1 لم يُنفَّذ.';
  end if;

  drop policy if exists "deliverables read" on public.deliverables;
  create policy "deliverables read" on public.deliverables for select to authenticated
    using (public.is_admin()
           or (is_deleted = false
               and (public.is_kian_member(project_id)
                    or (public.is_not_blocked() and public.is_client_side(project_id)
                        and coalesce(client_visible, true) = true
                        and status in ('client_review','revision_requested',
                                       'approved','final_delivered')))));
end $rls$;


-- ════════════════════════════════════════════════════════════════════════════
-- §9) الصلاحيات والمنح
--     قاعدة ثابتة في هذه الحزمة: **لا شيء لـ anon، أبدًا.** كل دالّة تُنزع من
--     public و anon أولًا ثم تُمنح لـ authenticated وحده.
-- ════════════════════════════════════════════════════════════════════════════

-- RLS على الجدول المرجعيّ: قراءة للمُصادَقين · الكتابة عبر الإدارة فقط.
alter table public.deliverable_content_types enable row level security;

drop policy if exists dct_read on public.deliverable_content_types;
create policy dct_read on public.deliverable_content_types for select to authenticated
  using (auth.uid() is not null);

drop policy if exists dct_write on public.deliverable_content_types;
create policy dct_write on public.deliverable_content_types for all to authenticated
  using (coalesce(public.can_manage_projects(), false))
  with check (coalesce(public.can_manage_projects(), false));

revoke all on public.deliverable_content_types from public, anon;
grant select on public.deliverable_content_types to authenticated;
grant insert, update, delete on public.deliverable_content_types to authenticated;   -- السياسة تفصل فعليًّا

do $g$
declare f text;
begin
  foreach f in array array[
    'public.deliverable_content_type_legacy(text)',
    'public.deliverable_internal_is_staff(uuid)',
    'public.deliverable_status_progress_fraction(text)',
    'public.project_hierarchy_max_depth()',
    'public.project_hierarchy_root(uuid)',
    'public.project_hierarchy_depth(uuid)',
    'public.project_hierarchy_can_parent(uuid,uuid)',
    'public.project_units_can_read(uuid)',
    'public.project_units_can_write(uuid)',
    'public.project_units_client_view(uuid)',
    'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)',
    'public.project_units_progress(uuid,uuid)',
    'public.project_units_rollup(uuid)',
    'public.project_stage_progress(uuid)',
    'public.project_breadcrumb(uuid)',
    'public.deliverable_content_types_list(boolean)'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

-- دوالّ الـ Trigger لا تُستدعى مباشرة إطلاقًا.
revoke all on function public.deliverables_type_sync()   from public, anon, authenticated;
revoke all on function public.projects_depth_guard()     from public, anon, authenticated;
revoke all on function public.deliverables_stage_guard() from public, anon, authenticated;

-- مفاتيح صلاحيات اختيارية (تُزرع فقط إن كان كتالوج الصلاحيات موجودًا).
do $perm$
begin
  if to_regclass('public.permissions') is not null then
    insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
      ('deliverables.manage_content_types','deliverables','sensitive',1010,'إدارة أنواع المحتوى','Manage content types'),
      ('deliverables.manage_schedule',     'deliverables','normal',   1020,'جدولة المخرجات','Schedule deliverables'),
      ('deliverables.manage_units',        'deliverables','normal',   1030,'تحديث وحدات المخرجات','Update deliverable units')
    on conflict (key) do nothing;
  end if;
end $perm$;

-- التوثيق داخل القاعدة (يبقى بعد أن يُنسى هذا الملفّ).
comment on table  public.deliverable_content_types is
  'مرجع أنواع المخرجات القابل للتوسّع — بديل قيد CHECK الضيّق. إضافة نوع = صفّ، لا ترحيل.';
comment on column public.deliverables.content_type is
  'النوع الحقيقي (FK إلى deliverable_content_types). العمود القديم type إسقاطه على video/photo/other عبر Trigger.';
comment on column public.deliverables.stage_id is
  'المرحلة = مشروع فرعي (projects.id). NULL = بلا مرحلة. الحارس يشترط نفس شجرة المشروع.';
comment on column public.deliverables.schedule_status is
  'awaiting_schedule افتراضيًّا — ولا تُحتسب تأخيرًا أبدًا. المفردات: awaiting_schedule/scheduled/in_progress/done/on_hold/cancelled.';
comment on column public.deliverables.expected_units is
  'عدد الوحدات المخطّط لها للمخرجات المتكرّرة. NULL = مجهول ⇒ وزن 1 في محرّك التقدّم (احتياطي موثّق).';
comment on table  public.deliverable_internal is
  'الحقول الداخلية للمخرج (ملاحظات الكوادر + أثر الاستيراد). جدول جانبي 1:1 لأن RLS تُصفّي الصفوف لا الأعمدة: أيّ عمود على deliverables يقرؤه العميل مباشرةً عبر PostgREST. العميل هنا يرى صفر صفوف.';
comment on column public.deliverable_internal.external_key is
  'مفتاح المصدر الخارجي — أساس idempotency للاستيراد (فهرس فريد جزئيّ ux_deliverable_internal_external_key).';
comment on column public.deliverable_internal.internal_notes is
  'نثر داخليّ للكوادر. لا يصل العميل إليه بأيّ select — الصفّ نفسه محجوب عنه.';
comment on function public.project_units_progress(uuid,uuid) is
  'تقدّم موزون بالوحدات لمشروع/مرحلة. NULL = لا مخرجات محسوبة (ليست صفرًا). closed ⇒ نتيجة مجمّدة.';
comment on function public.project_units_rollup(uuid) is
  'تجميع الشجرة في مقام واحد ⇒ لا عدّ مزدوج ولا تشويه من مرحلة فارغة.';


-- ════════════════════════════════════════════════════════════════════════════
-- §10) الفحص الذاتي — أيّ إخفاق يُجهض المعاملة كلّها ولا يبقى أثر
-- ════════════════════════════════════════════════════════════════════════════
do $self$
declare
  v_missing text := '';
  c text; f text;
  v_before int; v_after int;
  v_narrow int; v_seed int; v_anon int; v_null_ct int; v_att smallint;
begin
  -- (1) الأعمدة الـ18 + الثلاثة على projects
  foreach c in array array[
    'stage_id','content_type','platforms','execution_details','proposed_caption','priority',
    'client_visible','schedule_status','planned_start_date','expected_units',
    'completed_units','recurrence_type','recurrence_config','requires_shooting','requires_editing',
    'requires_design','requires_printing','sort_order']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_missing := v_missing || ' deliverables.' || c; end if;
  end loop;

  -- (1ب) ★ الحقول الداخلية غادرت deliverables فعلًا ★ بقاء أيّ منها = التسريب حيّ.
  foreach c in array array['internal_notes','external_key','import_batch_id',
                           'source_row_number','source_file_name','metadata']
  loop
    if exists (select 1 from information_schema.columns
                where table_schema='public' and table_name='deliverables' and column_name=c)
      then v_missing := v_missing || ' ★ما زال على deliverables: ' || c; end if;
  end loop;

  -- (1ج) الجدول الجانبي وأعمدته
  if to_regclass('public.deliverable_internal') is null then
    v_missing := v_missing || ' public.deliverable_internal';
  else
    foreach c in array array['deliverable_id','internal_notes','external_key','import_batch_id',
                             'source_row_number','source_file_name','metadata']
    loop
      if not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='deliverable_internal' and column_name=c)
        then v_missing := v_missing || ' deliverable_internal.' || c; end if;
    end loop;
  end if;
  foreach c in array array['schedule_status','planned_start_date','stage_order']
  loop
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='projects' and column_name=c)
      then v_missing := v_missing || ' projects.' || c; end if;
  end loop;

  -- (2) الدوالّ
  foreach f in array array[
    'public.deliverable_content_type_legacy(text)','public.deliverable_status_progress_fraction(text)',
    'public.deliverable_internal_is_staff(uuid)',
    'public.project_hierarchy_max_depth()','public.project_hierarchy_root(uuid)',
    'public.project_hierarchy_depth(uuid)','public.project_hierarchy_can_parent(uuid,uuid)',
    'public.project_units_can_read(uuid)','public.project_units_can_write(uuid)',
    'public.project_units_client_view(uuid)',
    'public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)',
    'public.project_units_progress(uuid,uuid)','public.project_units_rollup(uuid)',
    'public.project_stage_progress(uuid)','public.project_breadcrumb(uuid)',
    'public.deliverable_content_types_list(boolean)']
  loop
    if to_regprocedure(f) is null then v_missing := v_missing || ' fn:' || f; end if;
  end loop;
  if v_missing <> '' then raise exception 'SELF-TEST FAIL — كائنات مفقودة:%', v_missing; end if;

  -- (3) القيد الضيّق زال فعلًا والقيد المفتوح حاضر
  -- ★ مقصور على قيود العمود `type` تمامًا كما في §3: قيد على عمود آخر يصادف
  --   احتواؤه على video/photo **لا يُسقطه §3 أبدًا** (حلقته تشترط
  --   v_att = any (conkey))، فمطالبته بالزوال هنا كانت تُنتج فشلًا أبديًّا على
  --   قاعدة سليمة — تشديدٌ في الدقّة لا تخفيف: أيّ قيد ضيّق حقيقيّ على type
  --   يذكر العمود في conkey بالضرورة.
  select a.attnum into v_att from pg_attribute a
   where a.attrelid = 'public.deliverables'::regclass and a.attname = 'type' and not a.attisdropped;
  if v_att is null then raise exception 'SELF-TEST FAIL — العمود deliverables.type اختفى'; end if;
  select count(*) into v_narrow from pg_constraint c
   where c.conrelid = 'public.deliverables'::regclass and c.contype='c'
     and v_att = any (c.conkey)
     and pg_get_constraintdef(c.oid) ilike '%video%' and pg_get_constraintdef(c.oid) ilike '%photo%'
     and pg_get_constraintdef(c.oid) not ilike '%photography%';
  if v_narrow > 0 then raise exception 'SELF-TEST FAIL — القيد الضيّق على type ما زال حيًّا (%)', v_narrow; end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deliverables'::regclass
                  and conname='deliverables_type_open_ck') then
    -- الاستثناء الوحيد المقبول: صفوف بـ type فارغ منعت إضافته (انظر §3).
    select count(*) into v_null_ct from public.deliverables where coalesce(btrim(type),'') = '';
    if v_null_ct = 0 then raise exception 'SELF-TEST FAIL — القيد المفتوح غير مُضاف'; end if;
    raise notice 'SELF-TEST تحذير: القيد المفتوح مُتخطّى بسبب % صفًّا بـ type فارغ — صحّحها وأعد التشغيل.', v_null_ct;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='public.deliverables'::regclass
                  and conname='deliverables_content_type_fk')
    then raise exception 'SELF-TEST FAIL — المفتاح الخارجي لـ content_type غير مُضاف'; end if;

  -- (4) الفهرس الفريد الجزئيّ (انتقل مع عموده إلى الجدول الجانبي)
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='ux_deliverable_internal_external_key')
    then raise exception 'SELF-TEST FAIL — ux_deliverable_internal_external_key مفقود ⇒ idempotency الاستيراد بلا أساس'; end if;

  -- (4ب) ★ عزل الجدول الجانبي ★ RLS مفعّلة · سياستان · لا منح لـ anon ·
  --      وكل مُسنِد في السياستين مغلّف بـ coalesce(...,false) (لا انهيار إلى NULL).
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname='public' and c.relname='deliverable_internal' and c.relrowsecurity)
    then raise exception 'SELF-TEST FAIL — RLS غير مفعّلة على deliverable_internal ⇒ الجدول مكشوف بالكامل'; end if;
  foreach c in array array['deliverable_internal_read','deliverable_internal_write'] loop
    if not exists (select 1 from pg_policies
                    where schemaname='public' and tablename='deliverable_internal' and policyname=c)
      then raise exception 'SELF-TEST FAIL — سياسة % مفقودة على deliverable_internal', c; end if;
  end loop;
  -- ⚠️ `ilike` وليس `like` — وهذا سبب فشل التشغيل الأول على الإنتاج.
  --    `pg_policies.qual` ليست النصّ الذي كتبناه، بل ناتج **إعادة توليد** من
  --    `pg_get_expr`. ومُفكِّك PostgreSQL يطبع `COALESCE(` **بأحرف كبيرة** دائمًا
  --    (ruleutils.c)، بينما نكتبها نحن `coalesce(`. فكان `like '%coalesce%'`
  --    يفشل على سياسة **سليمة تمامًا**. المُعرِّفات (اسم الدالّة، اسم العمود)
  --    تبقى صغيرة، ولذلك مرّت بقية الفحوص. الإصلاح تصحيح للفحص لا تخفيف له:
  --    الشرط نفسه، غير حسّاس لحالة الأحرف.
  if exists (select 1 from pg_policies
              where schemaname='public' and tablename='deliverable_internal'
                and (coalesce(qual,'') not ilike '%coalesce%'
                     or coalesce(qual,'') not ilike '%deliverable_internal_is_staff%'))
    then raise exception 'SELF-TEST FAIL — سياسة على deliverable_internal بلا coalesce/بلا البوّابة ⇒ قد تنهار إلى NULL'; end if;

  -- ★ تشديد: `WITH CHECK` لم تكن مفحوصة إطلاقًا. سياسة الكتابة `for all` تحمل
  --   `with check` مستقلًّا عن `using`؛ لو كُتب بلا coalesce لَمرّ الفحص القديم.
  if exists (select 1 from pg_policies
              where schemaname='public' and tablename='deliverable_internal'
                and with_check is not null
                and (with_check not ilike '%coalesce%'
                     or with_check not ilike '%deliverable_internal_is_staff%'))
    then raise exception 'SELF-TEST FAIL — WITH CHECK على deliverable_internal بلا coalesce/بلا البوّابة'; end if;

  -- ★★ الفحص الأهمّ: **سلوكيّ لا نصّيّ**. مطابقة النصوص خدعتنا للتوّ؛ استدعاء
  --    الدالّة لا يُخدع. لو أعادت NULL يومًا لانهار مُسنِد السياسة إلى NULL
  --    (و`false OR NULL = NULL`) — وهو شكل الحادثة التي جعلت متصلًا غير مُصادَق
  --    يقرأ بيانات شركة حقيقية. لا تحذف هذا الفحص.
  --    `null::uuid` صراحةً لا `null` مجرّدًا: NULL بلا نوع قد يُربك مُحلّل الأنواع،
  --    وما نريده فحصٌ للسلوك لا تشغيلة فاشلة ثانية على الإنتاج بسبب صياغة.
  if public.deliverable_internal_is_staff(null::uuid) is null
     or public.deliverable_internal_is_staff('00000000-0000-0000-0000-000000000000'::uuid) is null
    then raise exception 'SELF-TEST FAIL — deliverable_internal_is_staff تُعيد NULL ⇒ فشل-مفتوح محتمل'; end if;
  select count(*) into v_anon
    from information_schema.role_table_grants
   where table_schema='public' and table_name='deliverable_internal' and grantee in ('anon','PUBLIC');
  if v_anon > 0 then raise exception 'SELF-TEST FAIL — anon/PUBLIC يملك % صلاحية على deliverable_internal', v_anon; end if;

  -- (5) الزرع + عدم بقاء content_type فارغًا
  -- ★ يُفحص **وجود المفاتيح الثلاثة عشر** لا عددُ المُفعَّل منها: is_active بيانات
  --   يملكها المالك (§2 لا يدهسها عند إعادة التشغيل بـ on conflict do nothing)،
  --   فتعطيل المالك لنوع واحد كان سيُسقط ترحيلًا سليمًا تمامًا. والقيمة المضافة
  --   من انحراف البيانات (§3) تدخل بـ is_active = false فلا تُلبّس العدّ.
  select count(*) into v_seed from public.deliverable_content_types
   where key in ('video','photography','design','print','live_stream','event','field_execution',
                 'presentation','gift','report','digital_content','copywriting','custom');
  if v_seed < 13 then raise exception 'SELF-TEST FAIL — الزرع ناقص (% من 13 مفتاحًا)', v_seed; end if;
  select count(*) into v_null_ct from public.deliverables where content_type is null;
  if v_null_ct > 0 then raise exception 'SELF-TEST FAIL — % مخرج بلا content_type', v_null_ct; end if;

  -- (6) ★ لا مشروع أُنشئ ولا مخرج أُنشئ/حُذف ★
  v_before := coalesce(nullif(current_setting('kian.lp_projects_before', true),''),'-1')::int;
  select count(*) into v_after from public.projects;
  if v_before >= 0 and v_before <> v_after then
    raise exception 'SELF-TEST FAIL — تغيّر عدد المشاريع من % إلى % (الترحيل يجب ألّا يُنشئ مشروعًا)', v_before, v_after;
  end if;
  v_before := coalesce(nullif(current_setting('kian.lp_deliverables_before', true),''),'-1')::int;
  select count(*) into v_after from public.deliverables;
  if v_before >= 0 and v_before <> v_after then
    raise exception 'SELF-TEST FAIL — تغيّر عدد المخرجات من % إلى %', v_before, v_after;
  end if;

  -- (7) ★ لا منح لـ anon ★
  select count(*) into v_anon
    from information_schema.role_table_grants
   where table_schema='public' and table_name='deliverable_content_types' and grantee in ('anon','PUBLIC');
  if v_anon > 0 then raise exception 'SELF-TEST FAIL — anon/PUBLIC يملك % صلاحية على الجدول المرجعيّ', v_anon; end if;
  select count(*) into v_anon
    from information_schema.role_routine_grants
   where routine_schema='public' and grantee='anon'
     and routine_name in ('project_units_progress','project_units_rollup','project_stage_progress',
                          'project_breadcrumb','project_hierarchy_can_parent','deliverable_content_types_list');
  if v_anon > 0 then raise exception 'SELF-TEST FAIL — anon يملك تنفيذ % دالّة', v_anon; end if;

  -- (8) سياسة القراءة تعرف client_visible فعلًا (وإلّا فالإخفاء وعد كاذب).
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='deliverables' and policyname='deliverables read'
       and coalesce(qual,'') ilike '%client_visible%')
  then raise exception 'SELF-TEST FAIL — سياسة القراءة لا تفرض client_visible.'; end if;

  -- (9) التعديل الجماعيّ: قائمة فارغة = بلا أثر · مفتاح خارج القائمة البيضاء يُرفض.
  -- ملاحظة: الترحيلة تُنفَّذ بحساب المالك حيث auth.uid() = NULL، فالدالّة تردّ
  -- 'not authorized' وهذا **نجاح** بحدّ ذاته (البوّابة تعمل). لذلك نقبل الحالتين:
  -- إمّا الشكل الصحيح بلا أثر، وإمّا رفض التفويض — وأيّ خطأ آخر إخفاق حقيقيّ.
  declare v_out jsonb; v_err text; v_rejected boolean := false;
          v_body text; v_proved boolean := false;
  begin
    -- ★★ إثبات بنيويّ **قبل** أيّ نداء ★★
    --   النداء أدناه يتوقّف عند `auth.uid() is null` في بيئة المالك، فلا يبلغ
    --   القائمة البيضاء إطلاقًا ⇒ كان الفحص السلوكيّ وحده يمرّ **حتى لو حُذفت
    --   القائمة كلّها** (يكفيه أن ترفع الدالّة أيّ استثناء). هذا بالضبط شكل
    --   «فحص يطبع PASS ولا يُثبت شيئًا». نقرأ جسم الدالّة نفسه:
    --   pg_get_functiondef يُعيد الجسم **كما كُتب** (لا يمرّ بمُفكِّك التعابير
    --   ruleutils الذي خدعنا في qual)، فمطابقة النصّ هنا موثوقة.
    v_body := pg_get_functiondef(
                to_regprocedure('public.large_project_deliverables_bulk_update(uuid[],jsonb,text,boolean)'));
    if coalesce(v_body,'') not like '%unsupported_patch_key%'
       or coalesce(v_body,'') not like '%v_allowed%' then
      raise exception 'SELF-TEST FAIL — القائمة البيضاء لمفاتيح p_patch غائبة من جسم large_project_deliverables_bulk_update';
    end if;

    begin
      v_out := public.large_project_deliverables_bulk_update('{}'::uuid[], '{}'::jsonb, null, true);
      if coalesce(v_out->>'ok','') <> 'true' or coalesce((v_out->>'requested')::int, -1) <> 0 then
        raise exception 'SELF-TEST FAIL — النداء الفارغ لم يُرجع نتيجة بلا أثر: %', v_out;
      end if;
    exception when others then
      v_err := sqlerrm;
      if v_err not like '%not authorized%' and v_err not like 'SELF-TEST FAIL%' then
        raise exception 'SELF-TEST FAIL — النداء الفارغ أخفق بخطأ غير متوقّع: %', v_err;
      end if;
      if v_err like 'SELF-TEST FAIL%' then raise; end if;
    end;

    begin
      v_out := public.large_project_deliverables_bulk_update(
                 array['00000000-0000-0000-0000-000000000000'::uuid],
                 '{"project_id":"00000000-0000-0000-0000-000000000000"}'::jsonb, 'selftest', true);
    exception when others then
      -- ★ `when others then v_rejected := true` وحده كان يبتلع **أيّ** خطأ ويُعلن
      --   نجاحًا. نُميّز الآن: رفض القائمة البيضاء = إثبات · رفض التفويض = بيئة
      --   المالك (مقبول، والإثبات البنيويّ أعلاه يغطّيه) · أيّ خطأ آخر = إخفاق.
      v_err      := sqlerrm;
      v_rejected := true;
      v_proved   := (v_err like '%unsupported_patch_key%');
      if not v_proved and v_err not like '%not authorized%' then
        raise exception 'SELF-TEST FAIL — مفتاح خارج القائمة البيضاء رُفض بخطأ غير متوقّع: %', v_err;
      end if;
    end;
    if not v_rejected then
      raise exception 'SELF-TEST FAIL — مفتاح خارج القائمة البيضاء (project_id) لم يُرفض.';
    end if;
    if not v_proved then
      raise notice 'SELF-TEST: القائمة البيضاء أُثبتت **بنيويًّا** فقط — auth.uid() = NULL في محرّر SQL فالنداء يتوقّف عند البوّابة قبل بلوغها. أعد الاختبار سلوكيًّا من الواجهة بحساب حقيقيّ.';
    end if;
  end;

  raise notice 'LARGE_PROJECTS SELF-TEST: PASS — 18+3 عمودًا · الحقول الداخلية معزولة في deliverable_internal (كوادر فقط) · 13 نوعًا · القيد الضيّق أُزيل · التعديل الجماعيّ حاضر ومحميّ · client_visible مفروض في RLS · لا مشروع أُنشئ · لا منح anon.';
end $self$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- بعد التنفيذ: شغّل docs/project_platform_large_projects_POSTCHECK.sql وقارن
-- بصمة الصلاحيات وسياسات RLS بناتج الفحص القبْليّ — يجب أن تتطابقا حرفيًّا.
-- ════════════════════════════════════════════════════════════════════════════
