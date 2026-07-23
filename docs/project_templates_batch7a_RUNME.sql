-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 7A — قوالب المشاريع والإعداد السريع (Templates & Rapid Setup)
--
-- الوضع قبل هذه الدفعة (تدقيق قراءة فقط) — نظام القوالب **موجود جزئيًّا**:
--   • public.project_templates (name/description/spec jsonb/is_active/service_type/
--     default_duration_days) + RLS (قراءة is_staff، كتابة can_manage_projects).
--   • project_core_apply_template (v1: مهام + قوائم تحقّق) و
--     project_core_apply_template_v2 (مهام/معالم/مخرجات/مخاطر/اجتماعات/تصوير +
--     اختيار الوحدات + تاريخ أساس + اعتماديات) — محرّك التطبيق قائم وسليم.
--   • أغلفة TS (pcListTemplates/Create/Update/Archive/ApplyV2) وواجهة كاملة
--     (ProjectTemplates.tsx: مدير/محرّر/تطبيق + «من هذا المشروع»).
--
-- لذلك 7A **لا تبني محرّك تطبيق جديدًا ولا جدول قوالب جديدًا**. تضيف الناقص فعلًا:
--   1) إنشاء مشروع من قالب في خطوة واحدة (اليوم: أنشئ ثم افتح ثم طبّق).
--   2) إصدارات القوالب (لا يوجد أيّ ترقيم/تاريخ إصدارات اليوم).
--   3) «حفظ كقالب» على الخادم (اليوم يُجمَّع spec في المتصفّح ⇒ قالب ناقص صامت
--      لمن لا يقرأ كل الصفوف، وبلا ذرّية).
--   4) صلاحية دقيقة templates.manage بدل الاعتماد على can_manage_projects وحدها.
--
-- قيود ملتزَم بها: إضافات فقط · لا إعادة تعريف لبوّابات الوصول · core_stage يُكتب
-- عبر project_core_create_project/project_core_set_stage فقط · لا نسخ للملفات أو
-- التعليقات أو الاعتمادات أو التواريخ المطلقة أو الميزانيات أو العميل · لا Zoho.
--
-- ترتيب التشغيل: Project Core → (5A→5B→5C) → (6A→6B→6C) → 7A.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.project_templates') is null
    then raise exception '7A PREFLIGHT: public.project_templates غير موجود — شغّل docs/project_core_FINAL_RUNME.sql أولًا'; end if;
  if to_regprocedure('public.project_core_apply_template_v2(uuid,uuid,text[],date)') is null
    then raise exception '7A PREFLIGHT: محرّك التطبيق project_core_apply_template_v2 مفقود — شغّل docs/project_core_ABSOLUTE_FINAL_RUNME.sql'; end if;
  if to_regprocedure('public.project_core_create_project(jsonb)') is null
    then raise exception '7A PREFLIGHT: project_core_create_project مفقودة'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)') is null
    then raise exception '7A PREFLIGHT: pc_can_read_project مفقودة'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) الصلاحية الدقيقة (تُضاف إلى الكتالوج القائم — لا كتالوج موازٍ)
-- ════════════════════════════════════════════════════════════════════════════
do $perm$
begin
  if to_regclass('public.permissions') is null then
    raise notice '7A: كتالوج الصلاحيات غير موجود — templates.manage تُتخطّى'; return;
  end if;
  insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
    -- projects_tasks هو المفتاح الحقيقي في PERMISSION_CATEGORIES (lib/portal/professions.ts:86)؛
    -- 'projects' لا وجود له فتختفي الصلاحية من محرّري الصلاحيات.
    ('templates.manage','projects_tasks','normal', 900,'إدارة قوالب المشاريع','Manage project templates')
  on conflict (key) do nothing;
end $perm$;

-- بوابة القوالب: تُركّب الصلاحية الدقيقة إن وُجدت، وإلّا تسقط إلى البوابة الخشنة القائمة.
create or replace function public.tpl_can(p_key text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v boolean;
begin
  if not public.is_staff() then return false; end if;
  if coalesce(public.can_manage_projects(), false) then return true; end if;
  begin
    v := public.emp_has_permission(p_key);
  exception when undefined_function or undefined_table then v := false; end;
  return coalesce(v, false);
end $$;
revoke execute on function public.tpl_can(text) from public, anon;
grant execute on function public.tpl_can(text) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) الإصدارات — تاريخ غير مُتلِف لكل قالب (لم يكن موجودًا)
-- ════════════════════════════════════════════════════════════════════════════
alter table public.project_templates add column if not exists template_key   text;
alter table public.project_templates add column if not exists version        int not null default 1;
alter table public.project_templates add column if not exists category       text;
alter table public.project_templates add column if not exists is_seed        boolean not null default false;

-- template_key مفتاح مستقرّ للبذور (لا يعتمد على الاسم القابل للتغيير).
create unique index if not exists ux_project_templates_key
  on public.project_templates (template_key) where template_key is not null;

create table if not exists public.project_template_versions (
  id          uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.project_templates(id) on delete cascade,
  version     int  not null,
  name        text,
  spec        jsonb not null default '{}'::jsonb,
  note        text,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  unique (template_id, version)
);
create index if not exists idx_ptv_template on public.project_template_versions(template_id, version desc);

alter table public.project_template_versions enable row level security;
-- القراءة للموظّفين (نفس سياسة القوالب)، والكتابة عبر RPCs فقط (لا سياسة كتابة).
drop policy if exists ptv_read on public.project_template_versions;
create policy ptv_read on public.project_template_versions for select to authenticated using (public.is_staff());
revoke all on public.project_template_versions from anon;
grant select on public.project_template_versions to authenticated;

-- نشر إصدار: لقطة من spec الحالي، ثم رفع رقم الإصدار. غير مُتلِف إطلاقًا.
create or replace function public.project_template_publish_version(p_template uuid, p_note text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_spec jsonb; v_name text; v_ver int;
begin
  if not public.tpl_can('templates.manage') then raise exception 'not authorized'; end if;
  -- القفل يمنع تسابق إصدارين بنفس الرقم (unique(template_id,version) كان سيرفع 23505).
  select spec, name, coalesce(version,1) into v_spec, v_name, v_ver
    from public.project_templates where id = p_template for update;
  if v_name is null and v_spec is null then raise exception 'template_not_found'; end if;

  insert into public.project_template_versions (template_id, version, name, spec, note, created_by)
    values (p_template, v_ver, v_name, coalesce(v_spec,'{}'::jsonb), nullif(btrim(p_note),''), auth.uid())
  on conflict (template_id, version) do update
    set spec = excluded.spec, name = excluded.name, note = excluded.note, created_at = now();

  update public.project_templates set version = v_ver + 1, updated_at = now() where id = p_template;
  return jsonb_build_object('ok', true, 'template_id', p_template, 'published_version', v_ver, 'next_version', v_ver + 1);
end $$;
revoke execute on function public.project_template_publish_version(uuid,text) from public, anon;
grant execute on function public.project_template_publish_version(uuid,text) to authenticated;

-- استعادة إصدار سابق: تُكتب كإصدار جديد (لا حذف ولا كتابة فوق التاريخ).
create or replace function public.project_template_restore_version(p_template uuid, p_version int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_spec jsonb; v_cur int;
begin
  if not public.tpl_can('templates.manage') then raise exception 'not authorized'; end if;
  select coalesce(version,1) into v_cur from public.project_templates where id = p_template for update;
  if v_cur is null then raise exception 'template_not_found'; end if;
  select spec into v_spec from public.project_template_versions where template_id = p_template and version = p_version;
  if v_spec is null then raise exception 'version_not_found'; end if;

  -- احفظ الحالي أولًا كي لا يضيع عند الاستعادة.
  insert into public.project_template_versions (template_id, version, name, spec, note, created_by)
    select p_template, v_cur, t.name, coalesce(t.spec,'{}'::jsonb), 'auto: قبل الاستعادة', auth.uid()
    from public.project_templates t where t.id = p_template
  on conflict (template_id, version) do nothing;

  update public.project_templates set spec = v_spec, version = v_cur + 1, updated_at = now() where id = p_template;
  return jsonb_build_object('ok', true, 'template_id', p_template, 'restored_from', p_version, 'new_version', v_cur + 1);
end $$;
revoke execute on function public.project_template_restore_version(uuid,int) from public, anon;
grant execute on function public.project_template_restore_version(uuid,int) to authenticated;

create or replace function public.project_template_versions_list(p_template uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',v2.id,'version',v2.version,'name',v2.name,'note',v2.note,
      'created_at',v2.created_at,
      'counts', jsonb_build_object(
        'tasks',        jsonb_array_length(case when jsonb_typeof(v2.spec->'tasks')='array'        then v2.spec->'tasks'        else '[]'::jsonb end),
        'milestones',   jsonb_array_length(case when jsonb_typeof(v2.spec->'milestones')='array'   then v2.spec->'milestones'   else '[]'::jsonb end),
        'deliverables', jsonb_array_length(case when jsonb_typeof(v2.spec->'deliverables')='array' then v2.spec->'deliverables' else '[]'::jsonb end)))
      order by v2.version desc), '[]'::jsonb) into v
    from public.project_template_versions v2 where v2.template_id = p_template;
  return jsonb_build_object('versions', v, 'generated_at', now());
end $$;
revoke execute on function public.project_template_versions_list(uuid) from public, anon;
grant execute on function public.project_template_versions_list(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) «حفظ كقالب» على الخادم — اليوم يُجمَّع spec في المتصفّح (ناقص صامت + بلا ذرّية)
--     لا يُنسخ أبدًا: العميل، التواريخ المطلقة، الميزانيات، الملفات، التعليقات،
--     الاعتمادات، المسنَدون، الحالات الفعلية، أو أيّ بيانات مالية.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_save_as_template(p_project uuid, p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_spec jsonb := '{}'::jsonb; v_start date; v_name text; v_id uuid; v_key text;
  v_tasks jsonb := '[]'::jsonb; v_miles jsonb := '[]'::jsonb; v_dlvs jsonb := '[]'::jsonb; v_risks jsonb := '[]'::jsonb;
begin
  if not public.tpl_can('templates.manage') then raise exception 'not authorized'; end if;
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  -- وبالإضافة إلى القراءة: نفس بوابة محرّك التطبيق (can_manage_projects أو can_edit_project).
  -- الدالة DEFINER وتستخرج مهام/مخاطر/مخرجات المشروع، فلا يكفي مجرّد حقّ القراءة.
  if not (coalesce(public.can_manage_projects(),false) or coalesce(public.can_edit_project(p_project),false))
    then raise exception 'not authorized'; end if;
  v_name := btrim(coalesce(p_data->>'name',''));
  if v_name = '' then raise exception 'name_required'; end if;
  v_key := nullif(btrim(p_data->>'template_key'),'');

  select start_date into v_start from public.project_core where project_id = p_project;

  -- المهام: تواريخ نسبية من بداية المشروع فقط (offset_days)، بلا مسنَدين ولا حالات.
  -- تُلتقط أيضًا قوائم التحقّق والمهام الفرعية والاعتماديات، لأنّ محرّك التطبيق
  -- (project_core_apply_template_v2) يقرأ 'checklist' و'subtasks' و'depends_on' فعلًا؛
  -- إغفالها يعني قالبًا أفقر من المشروع الذي بُني منه (وهو عيب الالتقاط في المتصفّح).
  -- depends_on = **فهرس** مهمة أسبق في نفس المصفوفة (المحرّك يشترط v_dep < v_idx).
  begin
    with ranked as (
      select t.id, t.title, t.description, t.priority, t.estimated_hours, t.start_date, t.due_date,
             (row_number() over (order by t.sort_order, t.title, t.id) - 1)::int as idx
      from public.project_tasks t
      where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.parent_task_id is null
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'title', r.title,
        'description', r.description,
        'priority', r.priority,
        'estimated_hours', r.estimated_hours,
        'offset_days', case when v_start is not null and r.start_date is not null then (r.start_date - v_start) else null end,
        -- ملاحظة سلوك المحرّك: حين تكون due_offset_days فارغة يسقط إلى offset_days،
        -- فتتساوى بداية المهمة واستحقاقها عند الاستعادة. مقصود ومُوثَّق هنا لا مفاجأة.
        'due_offset_days', case when v_start is not null and r.due_date is not null then (r.due_date - v_start) else null end,
        -- أقرب اعتمادية سابقة فقط: المحرّك يدعم depends_on واحدًا ويتجاهل ما ليس أسبق.
        'depends_on', (select max(p.idx) from public.task_dependencies d
                         join ranked p on p.id = d.depends_on_task_id
                        where d.task_id = r.id and p.idx < r.idx),
        'checklist', coalesce((select jsonb_agg(jsonb_build_object('label', c.label) order by c.sort_order, c.label)
                               from public.project_task_checklists c where c.task_id = r.id), '[]'::jsonb),
        'subtasks', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'priority', s.priority)
                                order by s.sort_order, s.title)
                              from public.project_tasks s
                              where s.parent_task_id = r.id and coalesce(s.is_deleted,false)=false), '[]'::jsonb))
        order by r.idx), '[]'::jsonb)
      into v_tasks
    from ranked r;
  exception when undefined_table or undefined_column then v_tasks := '[]'::jsonb; end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('title', s.title,
        'offset_days', case when v_start is not null and s.start_at is not null
             then ((s.start_at at time zone coalesce(s.timezone,'Asia/Riyadh'))::date - v_start) else null end)
        order by s.start_at), '[]'::jsonb)
      into v_miles
    from public.project_schedule_items s
    where s.project_id = p_project and coalesce(s.is_deleted,false)=false and coalesce(s.is_milestone,false)=true;
  exception when undefined_table or undefined_column then v_miles := '[]'::jsonb; end;

  begin
    select coalesce(jsonb_agg(jsonb_build_object('title', d.title, 'type', d.type,
        'offset_days', case when v_start is not null and d.due_date is not null then (d.due_date - v_start) else null end)
        order by d.due_date nulls last, d.title), '[]'::jsonb)
      into v_dlvs
    from public.deliverables d
    where d.project_id = p_project and coalesce(d.is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_dlvs := '[]'::jsonb; end;

  begin
    -- likelihood يقرأه المحرّك أيضًا؛ إغفاله يجعل كل مخاطرة مستعادة 'possible' افتراضًا.
    select coalesce(jsonb_agg(jsonb_build_object('title', r.title, 'severity', r.severity,
        'likelihood', r.likelihood) order by r.title), '[]'::jsonb)
      into v_risks
    from public.project_risks r
    where r.project_id = p_project and coalesce(r.is_deleted,false)=false;
  exception when undefined_table or undefined_column then v_risks := '[]'::jsonb; end;

  v_spec := jsonb_build_object('tasks', v_tasks, 'milestones', v_miles, 'deliverables', v_dlvs, 'risks', v_risks);

  insert into public.project_templates (name, description, spec, is_active, created_by, template_key, version, category,
                                        service_type, default_duration_days)
    values (v_name, nullif(btrim(p_data->>'description'),''), v_spec, true, auth.uid(), v_key, 1,
            nullif(btrim(p_data->>'category'),''), nullif(btrim(p_data->>'service_type'),''),
            nullif(p_data->>'default_duration_days','')::int)
    returning id into v_id;

  perform public.pc_log(p_project, 'saved_as_template', 'project', p_project,
    jsonb_build_object('template_id', v_id, 'tasks', jsonb_array_length(v_tasks),
      'milestones', jsonb_array_length(v_miles), 'deliverables', jsonb_array_length(v_dlvs),
      'risks', jsonb_array_length(v_risks)));

  -- بلا start_date تصير كل الإزاحات NULL ⇒ قالب بلا تواريخ. نُبلّغ بدل إعادة ok صامتة.
  return jsonb_build_object('ok', true, 'template_id', v_id, 'name', v_name,
    'start_date_missing', (v_start is null),
    'counts', jsonb_build_object('tasks', jsonb_array_length(v_tasks), 'milestones', jsonb_array_length(v_miles),
      'deliverables', jsonb_array_length(v_dlvs), 'risks', jsonb_array_length(v_risks)));
end $$;
revoke execute on function public.project_save_as_template(uuid,jsonb) from public, anon;
grant execute on function public.project_save_as_template(uuid,jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) الإعداد السريع — إنشاء مشروع من قالب في خطوة واحدة وذرّية
--     يُركّب الدالتين القائمتين ولا يكرّر منطقهما: project_core_create_project (6A،
--     يشمل الهرمية/العميل/الأعضاء) ثم project_core_apply_template_v2 (محرّك التطبيق).
--     جسم الدالة معاملة واحدة ⇒ فشل التطبيق يُلغي إنشاء المشروع (لا مشروع نصف مُعدّ).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_create_from_template(p_data jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_tpl uuid; v_created jsonb; v_project uuid; v_apply jsonb; v_modules text[]; v_start date; v_tpl_ver int;
begin
  -- بوابة صريحة: project_core_create_project يشترط can_manage_projects() بذاته، فمنح
  -- صلاحية دقيقة «إنشاء من قالب» لغير المدير كان سيعد بما لا يمكن تحقيقه (صلاحية ميتة).
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  v_tpl := nullif(p_data->>'template_id','')::uuid;
  if v_tpl is null then raise exception 'template_required'; end if;
  -- FOR SHARE: يمنع نشر/استعادة متزامنَين من تبديل spec بين قراءة الرقم وتطبيق القالب.
  select coalesce(version,1) into v_tpl_ver from public.project_templates
    where id = v_tpl and is_active = true for share;
  if v_tpl_ver is null then raise exception 'template_not_found'; end if;

  -- الوحدات المختارة. تنبيه: محرّك التطبيق يعتبر NULL = «كل الوحدات»
  -- (project_core_apply_template_v2: `p_modules is null or '<mod>' = any(p_modules)`)،
  -- وarray_agg على مصفوفة فارغة تُعيد NULL ⇒ «لم أختر شيئًا» كانت ستُطبّق كل شيء.
  -- نرفضها صراحةً بدل التخمين.
  if jsonb_typeof(p_data->'modules') = 'array' then
    if jsonb_array_length(p_data->'modules') = 0 then raise exception 'no_modules'; end if;
    -- تُستبعد العناصر الفارغة/الفارغة نصًّا: عنصر null واحد يجعل any(array[...]) تُعيد NULL
    -- فتُتخطّى كل الوحدات صامتًا ويعود ok مع أصفار.
    select array_agg(value::text) into v_modules
      from jsonb_array_elements_text(p_data->'modules') as m(value)
      where value is not null and btrim(value) <> '';
    if v_modules is null or array_length(v_modules,1) is null then raise exception 'no_modules'; end if;
  end if;
  v_start := nullif(p_data->>'start_date','')::date;

  -- الإنشاء عبر الدالة الرسمية (تفرض can_manage_projects وقواعد الهرمية والعميل).
  v_created := public.project_core_create_project(p_data);
  v_project := nullif(v_created->>'project_id','')::uuid;
  if v_project is null then v_project := nullif(v_created->>'id','')::uuid; end if;
  if v_project is null then raise exception 'create_failed'; end if;

  -- التطبيق عبر المحرّك القائم (نفس المعاملة ⇒ ذرّية كاملة).
  v_apply := public.project_core_apply_template_v2(v_project, v_tpl, v_modules, v_start);

  -- تسجيل الإصدار المطبَّق (لا يوجد مكان آخر يحفظه اليوم).
  perform public.pc_log(v_project, 'created_from_template', 'project', v_project,
    jsonb_build_object('template_id', v_tpl, 'template_draft_version', v_tpl_ver, 'applied', v_apply));

  -- projects.template_id قد لا يكون موجودًا (عمود من دفعة هرمية قديمة قد لا تكون مطبّقة).
  begin
    update public.projects set template_id = v_tpl where id = v_project;
  exception when undefined_column then null; end;

  -- template_draft_version: رقم المسودّة الجارية (النشر يلتقط N ثم يرفع إلى N+1)،
  -- وليس رقم إصدار منشور — التسمية تقول ذلك صراحةً.
  return jsonb_build_object('ok', true, 'project_id', v_project, 'template_id', v_tpl,
    'template_draft_version', v_tpl_ver, 'created', v_created, 'applied', v_apply);
end $$;
revoke execute on function public.project_create_from_template(jsonb) from public, anon;
grant execute on function public.project_create_from_template(jsonb) to authenticated;

-- مكتبة القوالب للاختيار السريع (تعدادات مشتقّة من spec — لا تُخزَّن).
create or replace function public.project_templates_library(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_cat text := nullif(p_filters->>'category',''); v_search text := nullif(btrim(p_filters->>'search'),'');
  v_include_archived boolean := coalesce((p_filters->>'include_archived')::boolean, false);
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'name',t.name,'description',t.description,'category',t.category,'template_key',t.template_key,
      'service_type',t.service_type,'default_duration_days',t.default_duration_days,
      'version',coalesce(t.version,1),'is_active',t.is_active,'is_seed',coalesce(t.is_seed,false),
      'counts', jsonb_build_object(
        'tasks',        jsonb_array_length(case when jsonb_typeof(t.spec->'tasks')='array'        then t.spec->'tasks'        else '[]'::jsonb end),
        'milestones',   jsonb_array_length(case when jsonb_typeof(t.spec->'milestones')='array'   then t.spec->'milestones'   else '[]'::jsonb end),
        'deliverables', jsonb_array_length(case when jsonb_typeof(t.spec->'deliverables')='array' then t.spec->'deliverables' else '[]'::jsonb end),
        'risks',        jsonb_array_length(case when jsonb_typeof(t.spec->'risks')='array'        then t.spec->'risks'        else '[]'::jsonb end),
        'meetings',     jsonb_array_length(case when jsonb_typeof(t.spec->'meetings')='array'     then t.spec->'meetings'     else '[]'::jsonb end),
        'shoots',       jsonb_array_length(case when jsonb_typeof(t.spec->'shoots')='array'       then t.spec->'shoots'       else '[]'::jsonb end)))
      order by t.is_active desc, t.name), '[]'::jsonb) into v
    from public.project_templates t
    where (v_include_archived or t.is_active = true)
      and (v_cat is null or t.category = v_cat)
      and (v_search is null or t.name ilike '%'||v_search||'%' or coalesce(t.description,'') ilike '%'||v_search||'%');
  return jsonb_build_object('templates', v, 'can_manage', public.tpl_can('templates.manage'), 'generated_at', now());
end $$;
revoke execute on function public.project_templates_library(jsonb) from public, anon;
grant execute on function public.project_templates_library(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) بذور القوالب — أنواع مشاريع كيان الفعلية. Idempotent عبر template_key،
--     ولا تُكتب فوق قالب عدّله المستخدم (do nothing لا do update).
-- ════════════════════════════════════════════════════════════════════════════
insert into public.project_templates (template_key, name, description, category, service_type, default_duration_days, is_seed, is_active, spec) values
  ('seed_video_production', 'إنتاج فيديو تسويقي', 'مسار إنتاج فيديو كامل من التحضير إلى التسليم', 'production', 'video', 30, true, true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','اجتماع انطلاق مع العميل','priority','high','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','كتابة السيناريو','priority','high','offset_days',1,'due_offset_days',5,
         'checklist', jsonb_build_array(jsonb_build_object('label','مسودّة أولى'), jsonb_build_object('label','مراجعة العميل'))),
       jsonb_build_object('title','لوحة القصّة (Storyboard)','priority','normal','offset_days',5,'due_offset_days',8),
       jsonb_build_object('title','تجهيز المعدّات وفريق التصوير','priority','normal','offset_days',8,'due_offset_days',10),
       jsonb_build_object('title','التصوير','priority','high','offset_days',10,'due_offset_days',13),
       jsonb_build_object('title','المونتاج','priority','high','offset_days',13,'due_offset_days',22),
       jsonb_build_object('title','تصحيح الألوان والصوت','priority','normal','offset_days',22,'due_offset_days',25),
       jsonb_build_object('title','مراجعة داخلية','priority','normal','offset_days',25,'due_offset_days',26),
       jsonb_build_object('title','مراجعة العميل والتعديلات','priority','high','offset_days',26,'due_offset_days',29),
       jsonb_build_object('title','التسليم النهائي','priority','high','offset_days',29,'due_offset_days',30)),
     'milestones', jsonb_build_array(
       jsonb_build_object('title','اعتماد السيناريو','offset_days',5),
       jsonb_build_object('title','انتهاء التصوير','offset_days',13),
       jsonb_build_object('title','التسليم','offset_days',30)),
     'deliverables', jsonb_build_array(
       jsonb_build_object('title','الفيديو النهائي','type','video','offset_days',30),
       jsonb_build_object('title','نسخ وسائل التواصل','type','video','offset_days',30)),
     'risks', jsonb_build_array(
       jsonb_build_object('title','تأخّر اعتماد العميل للسيناريو','severity','high'),
       jsonb_build_object('title','سوء الأحوال الجوّية يوم التصوير','severity','medium')))),
  ('seed_photo_shoot', 'جلسة تصوير فوتوغرافي', 'جلسة تصوير قصيرة مع معالجة وتسليم', 'production', 'photo', 12, true, true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','تحديد المتطلبات مع العميل','priority','high','offset_days',0,'due_offset_days',1),
       jsonb_build_object('title','تجهيز الموقع والمعدّات','priority','normal','offset_days',1,'due_offset_days',3),
       jsonb_build_object('title','يوم التصوير','priority','high','offset_days',3,'due_offset_days',4),
       jsonb_build_object('title','الفرز والمعالجة','priority','normal','offset_days',4,'due_offset_days',9),
       jsonb_build_object('title','مراجعة العميل','priority','normal','offset_days',9,'due_offset_days',11),
       jsonb_build_object('title','التسليم','priority','high','offset_days',11,'due_offset_days',12)),
     'milestones', jsonb_build_array(jsonb_build_object('title','انتهاء التصوير','offset_days',4)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','الصور المعالَجة','type','photo','offset_days',12)),
     'risks', jsonb_build_array(jsonb_build_object('title','تعذّر حجز الموقع','severity','medium')))),
  ('seed_monthly_retainer', 'عقد شهري (محتوى مستمرّ)', 'دورة شهرية متكرّرة لإنتاج المحتوى', 'retainer', 'content', 30, true, true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','خطة المحتوى الشهرية','priority','high','offset_days',0,'due_offset_days',3),
       jsonb_build_object('title','اعتماد الخطة من العميل','priority','high','offset_days',3,'due_offset_days',5),
       jsonb_build_object('title','الإنتاج — الأسبوع الأول','priority','normal','offset_days',5,'due_offset_days',12),
       jsonb_build_object('title','الإنتاج — الأسبوع الثاني','priority','normal','offset_days',12,'due_offset_days',19),
       jsonb_build_object('title','الإنتاج — الأسبوع الثالث','priority','normal','offset_days',19,'due_offset_days',26),
       jsonb_build_object('title','تقرير الأداء الشهري','priority','normal','offset_days',26,'due_offset_days',30)),
     'milestones', jsonb_build_array(jsonb_build_object('title','اعتماد خطة الشهر','offset_days',5)),
     'deliverables', jsonb_build_array(jsonb_build_object('title','حزمة محتوى الشهر','type','other','offset_days',30)),
     'risks', jsonb_build_array(jsonb_build_object('title','تأخّر مواد العميل','severity','medium')))),
  ('seed_event_coverage', 'تغطية فعالية', 'تغطية فعالية بتسليم سريع', 'production', 'event', 10, true, true,
   jsonb_build_object(
     'tasks', jsonb_build_array(
       jsonb_build_object('title','معاينة الموقع وخطة التغطية','priority','high','offset_days',0,'due_offset_days',2),
       jsonb_build_object('title','تجهيز الفريق والمعدّات','priority','high','offset_days',2,'due_offset_days',4),
       jsonb_build_object('title','يوم الفعالية','priority','high','offset_days',5,'due_offset_days',5),
       jsonb_build_object('title','تسليم سريع (Same-day highlights)','priority','high','offset_days',5,'due_offset_days',6),
       jsonb_build_object('title','المونتاج الكامل','priority','normal','offset_days',6,'due_offset_days',9),
       jsonb_build_object('title','التسليم النهائي','priority','high','offset_days',9,'due_offset_days',10)),
     'milestones', jsonb_build_array(jsonb_build_object('title','يوم الفعالية','offset_days',5)),
     'deliverables', jsonb_build_array(
       jsonb_build_object('title','مقطع الملخّص السريع','type','video','offset_days',6),
       jsonb_build_object('title','الفيديو الكامل','type','video','offset_days',10)),
     'risks', jsonb_build_array(jsonb_build_object('title','تغيّر جدول الفعالية','severity','high'))))
-- لا بدّ من تكرار شرط الفهرس الجزئي هنا: بدونه يعجز PostgreSQL عن استنتاج
-- ux_project_templates_key ويرفع 42P10 فيُجهض الترحيل كلّه.
on conflict (template_key) where template_key is not null do nothing;

comment on function public.project_create_from_template(jsonb) is '7A: إنشاء مشروع من قالب في خطوة واحدة (يُركّب create_project + apply_template_v2 في معاملة واحدة).';
comment on function public.project_save_as_template(uuid,jsonb) is '7A: حفظ مشروع كقالب على الخادم (تواريخ نسبية فقط؛ بلا عميل/ميزانية/ملفات/تعليقات/اعتمادات).';
comment on table public.project_template_versions is '7A: تاريخ إصدارات القوالب — غير مُتلِف (الاستعادة تُكتب كإصدار جديد).';

-- ════════════════════════════════════════════════════════════════════════════
-- §6) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_n int; v_def text;
begin
  foreach v_def in array array['public.project_create_from_template(jsonb)','public.project_save_as_template(uuid,jsonb)',
      'public.project_template_publish_version(uuid,text)','public.project_template_restore_version(uuid,int)',
      'public.project_templates_library(jsonb)','public.tpl_can(text)'] loop
    if to_regprocedure(v_def) is null then raise exception '7A FAIL: الدالة % مفقودة', v_def; end if;
  end loop;
  if to_regclass('public.project_template_versions') is null then raise exception '7A FAIL: جدول الإصدارات مفقود'; end if;

  -- الإعداد السريع يجب أن يُركّب الدالتين القائمتين لا أن يكرّرهما
  v_def := pg_get_functiondef('public.project_create_from_template(jsonb)'::regprocedure);
  if position('project_core_create_project' in v_def) = 0 or position('project_core_apply_template_v2' in v_def) = 0
    then raise exception '7A FAIL: الإنشاء من قالب لا يُركّب المحرّكات القائمة'; end if;

  -- «حفظ كقالب» يجب ألّا يلمس الميزانية/العميل/الملفات
  v_def := pg_get_functiondef('public.project_save_as_template(uuid,jsonb)'::regprocedure);
  if position('budget' in v_def) > 0 or position('client_id' in v_def) > 0 or position('project_files' in v_def) > 0
    then raise exception '7A FAIL: القالب ينسخ بيانات ممنوعة (ميزانية/عميل/ملفات)'; end if;

  -- البذور موجودة ومُفهرَسة بمفتاح مستقرّ
  select count(*) into v_n from public.project_templates where coalesce(is_seed,false) = true;
  if v_n < 4 then raise exception '7A FAIL: بذور القوالب ناقصة (%)', v_n; end if;
  select count(*) into v_n from public.project_templates where coalesce(is_seed,false)=true and template_key is null;
  if v_n > 0 then raise exception '7A FAIL: بذرة بلا template_key'; end if;

  raise notice '7A ✅ نجح الاختبار الذاتي — الإصدارات/حفظ كقالب/الإنشاء من قالب/المكتبة/البذور.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
