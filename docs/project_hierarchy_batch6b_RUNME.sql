-- ════════════════════════════════════════════════════════════════════════════
-- project_hierarchy_batch6b_RUNME.sql
-- BATCH 6B — HIERARCHY UX & OPERATIONS COMPLETION — RUN ONCE (بعد 6A)
-- ────────────────────────────────────────────────────────────────────────────
-- يُكمل تجربة الهرمية: شجرة مصفّاة من الخادم + إعادة ترتيب ذرّية + لوحة الأب الموسّعة
-- + تنقّل الإخوة (السابق/التالي). لا نظام موازٍ: يُركّب pc_can_read_project و pc_is_subproject
-- و project_subprojects_summary و project_hierarchy_rollup القائمة (6A).
--
-- قرار معماريّ: لم نعدّل project_core_dashboard (VOLATILE + Temp Tables + جسم ~100 سطر في ملف آخر)
-- كي لا نخاطر بنسخ أمين ضخم؛ بدلًا منه قراءة هرمية مخصّصة (كما فعل 6A في masters_list).
-- القائمة المسطّحة تبقى كما هي تمامًا — لا Regression.
--
-- قيود: Additive · Idempotent · داخل Transaction · بلا حذف · بلا DROP FUNCTION/TABLE ·
--   بلا إعادة تعريف access helpers · بلا Temp Tables في دوال القراءة · self-test بلا Side Effects ·
--   notify pgrst · لا يمسّ core_stage/progress/المالية/Zoho/العهدة.
-- ════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regprocedure('public.pc_can_read_project(uuid)') is null then raise exception '6B PREFLIGHT: pc_can_read_project مفقودة'; end if;
  if to_regprocedure('public.hier_can(uuid,text)') is null or to_regprocedure('public.project_hierarchy_rollup(uuid)') is null
     then raise exception '6B PREFLIGHT: دوال 6A مفقودة — طبّق project_hierarchy_batch6a_RUNME.sql أولًا'; end if;
  if to_regprocedure('public.pc_hier_effective_progress(uuid)') is null then raise exception '6B PREFLIGHT: pc_hier_effective_progress مفقودة (6A)'; end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='parent_project_id')
    then raise exception '6B PREFLIGHT: أعمدة الهرمية غير مطبّقة — طبّق 6A أولًا'; end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) صلاحية إدارة الهرمية (إعادة الترتيب) — تُضاف للكتالوج القائم
-- ════════════════════════════════════════════════════════════════════════════
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('hierarchy.manage', 'hierarchy','normal', 975,'إدارة ترتيب الفروع','Manage subproject order')
on conflict (key) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) شجرة المشاريع — قراءة مصفّاة من الخادم (لا تحميل الكل ثم التصفية في المتصفح)
--     الصفوف = المستوى الأعلى (standalone + master) افتراضيًّا؛ الفروع تُجلب عند التوسيع
--     عبر project_subprojects_summary القائمة (Lazy). عزل per-row عبر pc_can_read_project.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_hierarchy_tree(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_has_more boolean := false;
  v_scope text := nullif(p_filters->>'scope','');                 -- all|standalone|master|subproject
  v_parent uuid := nullif(p_filters->>'parent_id','')::uuid;
  v_search text := nullif(btrim(p_filters->>'search'),'');
  v_client uuid := nullif(p_filters->>'client_id','')::uuid;
  v_manager uuid := nullif(p_filters->>'manager_id','')::uuid;
  v_delayed boolean := coalesce((p_filters->>'has_delayed_children')::boolean,false);
  v_critical boolean := coalesce((p_filters->>'has_critical_children')::boolean,false);
  v_limit int := least(greatest(coalesce((p_filters->>'limit')::int,50),1),200);
  v_offset int := greatest(coalesce((p_filters->>'offset')::int,0),0);
  v_today date := (now() at time zone 'utc')::date;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if v_scope is not null and v_scope not in ('all','standalone','master','subproject') then raise exception 'bad_scope'; end if;

  with base as (
    select p.id, p.project_name, p.client_id, p.project_scope, p.parent_project_id, p.sequence_number,
           coalesce(pc.core_stage,'project_created') as core_stage, pc.health, pc.priority, pc.due_date
    from public.projects p
    -- LEFT JOIN إجباريًّا: مشروع بلا صفّ project_core (مثال: مشروع قديم استُعيد بعد الأرشفة) يجب أن يظهر
    -- في الشجرة تمامًا كما يظهر في اللوحة المسطّحة و project_subprojects_summary — وإلّا اختفى صامتًا.
    left join public.project_core pc on pc.project_id = p.id
    where coalesce(p.is_deleted,false) = false
      and public.pc_can_read_project(p.id)                                   -- العزل الحاسم لكل صف
      -- المستوى الأعلى افتراضيًّا؛ أو حسب فلتر النطاق
      and (case
             when v_scope is null or v_scope in ('all') then p.project_scope in ('standalone','master')
             when v_scope = 'standalone' then p.project_scope = 'standalone'
             when v_scope = 'master' then p.project_scope = 'master'
             else p.project_scope = 'subproject' end)
      and (v_parent is null or p.parent_project_id = v_parent)
      and (v_client is null or p.client_id = v_client)
      and (v_manager is null or exists (select 1 from public.project_members m
             where m.project_id=p.id and m.user_id=v_manager and m.role='kian_manager' and coalesce(m.is_deleted,false)=false))
      -- البحث يشمل اسم المشروع واسم أيّ فرع مرئيّ تحته
      and (v_search is null or p.project_name ilike '%'||v_search||'%'
           or exists (select 1 from public.projects ch where ch.parent_project_id = p.id
                        and coalesce(ch.is_deleted,false)=false and public.pc_can_read_project(ch.id)
                        and ch.project_name ilike '%'||v_search||'%'))
      -- فلترة «فروع متأخرة/حرجة» عبر EXISTS (أرخص من count) وقبل التصفّح — تُقيَّم فقط عند تفعيل الفلتر.
      and (not v_delayed or exists (select 1 from public.projects c join public.project_core cc on cc.project_id=c.id
             where c.parent_project_id=p.id and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
               and cc.due_date is not null and cc.due_date < v_today and cc.core_stage not in ('delivered','closed')))
      and (not v_critical or exists (select 1 from public.projects c join public.project_core cc on cc.project_id=c.id
             where c.parent_project_id=p.id and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
               and cc.health = 'off_track'))
  ), paged as (
    -- التصفّح أولًا، ثم تُحسب عدّادات الفروع لصفحة واحدة فقط (لا عمل لكل مشروع مرئيّ).
    -- نجلب صفًّا إضافيًّا (limit+1) لتحديد has_more بدقّة: `returned >= limit` يكذب عند مضاعف تامّ.
    -- ترتيب صريح داخل النافذة: over () لا يضمن ترتيب الإدخال، والصفّ الإضافي يجب أن يكون الأخير حتمًا.
    select q.*, row_number() over (order by (q.project_scope='master') desc, q.project_name, q.id) as rn from (
      select * from base order by (project_scope='master') desc, project_name, id limit v_limit + 1 offset v_offset
    ) q
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'project_id', f.id, 'project_name', f.project_name, 'client_id', f.client_id,
      'project_scope', f.project_scope, 'parent_project_id', f.parent_project_id, 'sequence_number', f.sequence_number,
      'core_stage', f.core_stage, 'health', f.health, 'priority', f.priority, 'due_date', f.due_date,
      'progress_pct', public.pc_hier_effective_progress(f.id),
      -- order by m.created_at: نفس اختيار اللوحة المسطّحة (بلا ترتيب يتغيّر المدير المعروض بين نداءين).
      'manager_name', (select coalesce(pr.full_name, pr.email) from public.project_members m
                        join public.profiles pr on pr.id=m.user_id
                        where m.project_id=f.id and m.role='kian_manager' and coalesce(m.is_deleted,false)=false
                        order by m.created_at limit 1),
      -- coalesce(full_name, company): عميل بلا اسم شخصي وله اسم شركة ليس «بلا عميل» (المعيار في كل اللوحات).
      'client_name', (select nullif(btrim(coalesce(cl.full_name, cl.company)),'') from public.clients cl where cl.id = f.client_id),
      'open_tasks', (select count(*) from public.project_tasks t where t.project_id=f.id and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')),
      'children_total', (select count(*) from public.projects c where c.parent_project_id=f.id and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)),
      -- LEFT JOIN هنا أيضًا: فرع بلا project_core كان يُحسب في children_total ويسقط من children_active
      -- فيظهر «٣ فروع / ٠ نشط» وهو تناقض ظاهري.
      'children_active', (select count(*) from public.projects c left join public.project_core cc on cc.project_id=c.id
         where c.parent_project_id=f.id and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
           and coalesce(cc.core_stage,'project_created') not in ('delivered','closed')),
      'children_delayed', (select count(*) from public.projects c join public.project_core cc on cc.project_id=c.id
         where c.parent_project_id=f.id and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
           and cc.due_date is not null and cc.due_date < v_today and cc.core_stage not in ('delivered','closed')),
      'children_critical', (select count(*) from public.projects c join public.project_core cc on cc.project_id=c.id
         where c.parent_project_id=f.id and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id) and cc.health='off_track'))
    order by (f.project_scope='master') desc, f.project_name) filter (where f.rn <= v_limit), '[]'::jsonb),
    (count(*) > v_limit)
    into v_rows, v_has_more
  from paged f;

  return jsonb_build_object('rows', v_rows, 'limit', v_limit, 'offset', v_offset,
    'returned', jsonb_array_length(v_rows), 'has_more', v_has_more, 'generated_at', now());
end $$;
revoke execute on function public.project_hierarchy_tree(jsonb) from public, anon;
grant execute on function public.project_hierarchy_tree(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) إعادة ترتيب الفروع — ذرّية، FOR UPDATE على مجموعة الإخوة، بلا تكرار تسلسل
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_hierarchy_reorder_subprojects(p_parent uuid, p_ordered_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_cnt int; v_i int := 0; v_id uuid; v_parent_scope text; v_arch uuid[];
begin
  if p_ordered_ids is null or array_length(p_ordered_ids,1) is null then raise exception 'empty_order'; end if;
  if not public.hier_can(p_parent, 'hierarchy.manage') then raise exception 'not authorized'; end if;
  select project_scope into v_parent_scope from public.projects where id = p_parent for update;   -- يسلسل الترتيب/الإضافة
  if v_parent_scope is null then raise exception 'not_found'; end if;
  if v_parent_scope <> 'master' then raise exception 'not_a_master'; end if;

  -- قفل مجموعة الإخوة نفسها (لا الأب فقط): move/detach يقفلان الابن والأب الجديد ولا يلمسان الأب القديم،
  -- فقفل الأب وحده لا يسلسلهما. بترتيب id ثابت لتقليل الجمود (deadlock).
  perform 1 from public.projects c where c.parent_project_id = p_parent order by c.id for update;

  -- شرط الرؤية الكاملة: الدالة SECURITY DEFINER وستكتب على كل الإخوة، فلا يُسمح بإعادة الترتيب
  -- لمن لا يرى المجموعة كاملة (وإلّا فُقد ترتيب فروع غير مرئية له نهائيًّا).
  if exists (select 1 from public.projects c
             where c.parent_project_id = p_parent and coalesce(c.is_deleted,false)=false
               and not public.pc_can_read_project(c.id))
    then raise exception 'order_set_partial_visibility'; end if;

  -- كل المعرّفات يجب أن تكون فروعًا حيّة لهذا الأب ومرئية للمستخدم، وبنفس العدد (لا حذف/إضافة ضمنية).
  select count(*) into v_cnt from public.projects c
    where c.parent_project_id = p_parent and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id);
  if v_cnt <> array_length(p_ordered_ids,1) then raise exception 'order_set_mismatch'; end if;
  if exists (select 1 from unnest(p_ordered_ids) x
             where not exists (select 1 from public.projects c where c.id = x and c.parent_project_id = p_parent
                                 and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)))
    then raise exception 'order_set_mismatch'; end if;
  if (select count(distinct x) from unnest(p_ordered_ids) x) <> array_length(p_ordered_ids,1) then raise exception 'duplicate_ids'; end if;

  -- الفروع المؤرشفة خارج ux_projects_parent_seq (فهرس جزئي على is_deleted=false)، لكنها تعود إليه عند
  -- الاستعادة؛ فلو ضغطنا الأحياء إلى 1..N ستتصادم الاستعادة (23505). نُلحقها بعد N بترتيبها السابق.
  select array_agg(c.id order by coalesce(c.sequence_number, 2147483647), c.project_name, c.id)
    into v_arch from public.projects c
    where c.parent_project_id = p_parent and coalesce(c.is_deleted,false)=true;

  -- تفريغ التسلسل أولًا (يتجنّب تصادم ux_projects_parent_seq أثناء التبديل)، ثم إسناد 1..N.
  update public.projects set sequence_number = null where parent_project_id = p_parent;
  foreach v_id in array p_ordered_ids loop
    v_i := v_i + 1;
    -- إعادة التحقّق داخل نفس UPDATE: move/detach متزامن قد يكون نقل الابن بعد التحقّق أعلاه.
    update public.projects set sequence_number = v_i
      where id = v_id and parent_project_id = p_parent and coalesce(is_deleted,false)=false;
    if not found then raise exception 'order_set_mismatch'; end if;
  end loop;
  if v_arch is not null then
    foreach v_id in array v_arch loop
      v_i := v_i + 1;
      update public.projects set sequence_number = v_i where id = v_id and parent_project_id = p_parent;
    end loop;
  end if;
  v_i := array_length(p_ordered_ids,1);

  perform public.pc_log(p_parent, 'subprojects_reordered', 'project', p_parent, jsonb_build_object('count', v_i));
  return jsonb_build_object('ok', true, 'parent_project_id', p_parent, 'count', v_i);
end $$;
revoke execute on function public.project_hierarchy_reorder_subprojects(uuid,uuid[]) from public, anon;
grant execute on function public.project_hierarchy_reorder_subprojects(uuid,uuid[]) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) لوحة المشروع الرئيسي الموسّعة (مشتقّة فقط — لا تُكتب على الأب)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_hierarchy_parent_dashboard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_roll jsonb; v_own_health text; v_agg_health text; v_earliest date; v_latest date;
  v_risks int:=0; v_issues int:=0; v_conf int:=0; v_appr int:=0; v_children jsonb; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  v_roll := public.project_hierarchy_rollup(p_project);
  select health into v_own_health from public.project_core where project_id = p_project;

  begin
    -- صحّة مجمّعة = أسوأ صحّة بين الفروع المرئية (مشتقّة، لا تُخزَّن).
    select case when count(*) filter (where cc.health='off_track') > 0 then 'off_track'
                when count(*) filter (where cc.health='at_risk')  > 0 then 'at_risk'
                when count(*) > 0 then 'on_track' else null end,
           min(cc.due_date) filter (where cc.core_stage not in ('delivered','closed')),
           max(cc.due_date)
      into v_agg_health, v_earliest, v_latest
    from public.projects c join public.project_core cc on cc.project_id = c.id
    where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id);
  exception when undefined_column then v_agg_health := null; end;

  -- مخاطر/مشكلات/تعارضات/اعتمادات متأخرة عبر الفروع (كلها معزولة إن غابت الأنظمة)
  begin
    select coalesce(sum(public.pc_hier_risk_count(c.id,'risk')),0), coalesce(sum(public.pc_hier_risk_count(c.id,'issue')),0)
      into v_risks, v_issues
    from public.projects c where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id);
  exception when others then v_risks := 0; v_issues := 0; end;
  begin
    select count(*) into v_conf from public.resource_bookings b
      join public.projects c on c.id = b.project_id
      where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
        and coalesce(b.is_deleted,false)=false and b.status in ('hold','pending_approval','confirmed','in_use');
  exception when undefined_table or undefined_column then v_conf := 0; end;
  begin
    select count(*) into v_appr from public.project_approvals a
      join public.projects c on c.id = a.project_id
      where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id)
        and coalesce(a.is_deleted,false)=false and a.status='pending' and a.due_at is not null and a.due_at < now();
  exception when undefined_table or undefined_column then v_appr := 0; end;

  -- حالة إغلاق كل فرع (5C — معزولة)
  begin
    select coalesce(jsonb_agg(jsonb_build_object('project_id', c.id, 'name', c.project_name,
        'closure_status', public.pc_project_closure_status(c.id)) order by coalesce(c.sequence_number,9999)), '[]'::jsonb) into v_children
    from public.projects c where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false and public.pc_can_read_project(c.id);
  exception when others then v_children := '[]'::jsonb; end;

  return jsonb_build_object(
    'project_id', p_project, 'rollup', v_roll,
    'own_health', v_own_health, 'children_aggregate_health', v_agg_health,
    'earliest_child_due', v_earliest, 'latest_child_due', v_latest,
    'children_critical_risks', v_risks, 'children_critical_issues', v_issues,
    'children_open_bookings', v_conf, 'children_overdue_approvals', v_appr,
    'children_closure', v_children, 'generated_at', now());
end $$;
revoke execute on function public.project_hierarchy_parent_dashboard(uuid) from public, anon;
grant execute on function public.project_hierarchy_parent_dashboard(uuid) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) توسيع سياق الهرمية: الإخوة (السابق/التالي) حسب sequence_number
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_hierarchy_context(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_scope text; v_parent uuid; v_pname text; v_can boolean := false; v_seq int;
  v_prev jsonb; v_next jsonb; v_idx int; v_sib int;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  begin
    select project_scope, parent_project_id, sequence_number into v_scope, v_parent, v_seq from public.projects where id = p_project;
    if v_parent is not null then
      v_can := public.pc_can_read_project(v_parent);
      if v_can then select project_name into v_pname from public.projects where id = v_parent; end if;
      -- الإخوة المرئيون مرتّبون؛ السابق/التالي للتنقّل داخل الأب.
      select count(*) into v_sib from public.projects s
        where s.parent_project_id = v_parent and coalesce(s.is_deleted,false)=false and public.pc_can_read_project(s.id);
      select ord into v_idx from (
        select s.id, row_number() over (order by coalesce(s.sequence_number, 9999), s.project_name) ord
        from public.projects s where s.parent_project_id = v_parent and coalesce(s.is_deleted,false)=false and public.pc_can_read_project(s.id)
      ) q where q.id = p_project;
      select to_jsonb(x) into v_prev from (
        select s.id as project_id, s.project_name from (
          select s.id, s.project_name, row_number() over (order by coalesce(s.sequence_number, 9999), s.project_name) ord
          from public.projects s where s.parent_project_id = v_parent and coalesce(s.is_deleted,false)=false and public.pc_can_read_project(s.id)
        ) s where s.ord = v_idx - 1) x;
      select to_jsonb(x) into v_next from (
        select s.id as project_id, s.project_name from (
          select s.id, s.project_name, row_number() over (order by coalesce(s.sequence_number, 9999), s.project_name) ord
          from public.projects s where s.parent_project_id = v_parent and coalesce(s.is_deleted,false)=false and public.pc_can_read_project(s.id)
        ) s where s.ord = v_idx + 1) x;
    end if;
  exception when undefined_column then v_scope := 'standalone'; v_parent := null;
  end;
  return jsonb_build_object('project_id', p_project, 'project_scope', coalesce(v_scope,'standalone'),
    'parent_project_id', v_parent, 'parent_name', v_pname, 'parent_readable', v_can,
    'sequence_number', v_seq, 'sibling_count', coalesce(v_sib,0), 'sibling_index', v_idx,
    'prev_sibling', v_prev, 'next_sibling', v_next,
    'hierarchy_enabled', public.project_hierarchy_enabled(), 'generated_at', now());
end $$;
revoke execute on function public.project_hierarchy_context(uuid) from public, anon;
grant execute on function public.project_hierarchy_context(uuid) to authenticated;

comment on function public.project_hierarchy_tree(jsonb) is '6B: شجرة المشاريع مصفّاة من الخادم (المستوى الأعلى + عدّادات الفروع)؛ الفروع تُجلب عند التوسيع.';
comment on function public.project_hierarchy_reorder_subprojects(uuid,uuid[]) is '6B: إعادة ترتيب الفروع ذرّيًّا (قفل الأب + مجموعة الإخوة، رؤية كاملة إلزامية، تفريغ ثم 1..N والمؤرشفة بعدها).';

-- ════════════════════════════════════════════════════════════════════════════
-- §6) اختبار ذاتي — بلا Side Effects
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
begin
  if to_regprocedure('public.project_hierarchy_tree(jsonb)') is null
     or to_regprocedure('public.project_hierarchy_reorder_subprojects(uuid,uuid[])') is null
     or to_regprocedure('public.project_hierarchy_parent_dashboard(uuid)') is null
     then raise exception '6B FAIL: دوال ناقصة'; end if;
  if not exists (select 1 from public.permissions where key='hierarchy.manage') then raise exception '6B FAIL: صلاحية hierarchy.manage مفقودة'; end if;
  -- سياق الهرمية يعيد مفاتيح التنقّل الجديدة
  if position('prev_sibling' in pg_get_functiondef('public.project_hierarchy_context(uuid)'::regprocedure)) = 0
    then raise exception '6B FAIL: السياق بلا تنقّل الإخوة'; end if;
  -- إعادة الترتيب تقفل الأب ولا تعتمد max()+1
  if position('for update' in pg_get_functiondef('public.project_hierarchy_reorder_subprojects(uuid,uuid[])'::regprocedure)) = 0
    then raise exception '6B FAIL: إعادة الترتيب بلا قفل'; end if;
  -- حارس الرؤية الكاملة: بدونه تُفرَّغ تسلسلات فروع لا يراها المستخدم (DEFINER يكتب خارج نطاق قراءته)
  if position('order_set_partial_visibility' in pg_get_functiondef('public.project_hierarchy_reorder_subprojects(uuid,uuid[])'::regprocedure)) = 0
    then raise exception '6B FAIL: إعادة الترتيب بلا حارس رؤية كاملة'; end if;
  -- الشجرة LEFT JOIN: مشروع بلا صفّ project_core يجب أن يظهر (كما في اللوحة المسطّحة)
  if position('left join public.project_core' in pg_get_functiondef('public.project_hierarchy_tree(jsonb)'::regprocedure)) = 0
    then raise exception '6B FAIL: الشجرة تُسقط المشاريع بلا project_core'; end if;
  raise notice '6B ✅ نجح الاختبار الذاتي — الشجرة/الترتيب/لوحة الأب/تنقّل الإخوة/الصلاحية.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
