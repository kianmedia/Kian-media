-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT CORE — REMAINING MODULES HOTFIX
-- يُشغَّل مرة واحدة فوق: project_core_FINAL_RUNME.sql + project_core_UI_COMPLETION_RUNME.sql
-- + project_core_FINAL_COMPLETION_RUNME.sql (المطبَّقة). Idempotent · Production-safe ·
-- لا حذف بيانات · لا Foundation · لا Fixtures · لا تعديل هدّام للتأجير/العهدة/HR.
--
-- يضيف خادميًا: التقدّم التلقائي (auto/manual/final) · تقويم مُثرّى · مخطّط المهام
-- (Gantt: مهام + اعتماديات) · تطبيق قالب على مشروع (منع تكرار) · إضافة نسخة مخرَج
-- (منع تكرار الرقم) · تحويل بند اجتماع إلى مهمة.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ═══ 0) أعمدة التقدّم اليدوي (override + سبب + منفّذ) ═══
alter table public.project_core add column if not exists progress_manual    int check (progress_manual is null or progress_manual between 0 and 100);
alter table public.project_core add column if not exists progress_reason    text;
alter table public.project_core add column if not exists progress_manual_by uuid references auth.users(id);
alter table public.project_core add column if not exists progress_manual_at timestamptz;

-- ═══ 1) التقدّم التلقائي — يمزج المرحلة + المهام؛ final = يدوي إن وُجد وإلا تلقائي ═══
create or replace function public.project_core_compute_progress(p_project uuid)
returns int language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce((array_position(
      array['lead_approved','project_created','planning','ready','scheduled','in_production',
            'post_production','internal_review','client_review','revision','approved','delivered','closed'],
      coalesce(pc.core_stage,'project_created')) - 1), 0)::numeric / 12.0 * 100 as stage_pct
    from public.project_core pc where pc.project_id = p_project
  ), tk as (
    select count(*) filter (where status='done')::numeric as done, count(*)::numeric as total
    from public.project_tasks where project_id = p_project and is_deleted = false and status <> 'cancelled'
  )
  select greatest(0, least(100, round(
    case when (select total from tk) > 0
      then 0.6 * coalesce((select stage_pct from s),0) + 0.4 * ((select done from tk)/(select total from tk)*100)
      else coalesce((select stage_pct from s),0) end
  )))::int;
$$;

-- قراءة {auto, manual, final}
create or replace function public.project_core_progress(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_auto int; v_man int;
begin
  if not public.can_access_project(p_project) then raise exception 'not authorized'; end if;
  v_auto := public.project_core_compute_progress(p_project);
  select progress_manual into v_man from public.project_core where project_id = p_project;
  return jsonb_build_object('auto', v_auto, 'manual', v_man, 'final', coalesce(v_man, v_auto));
end $$;

-- تجاوز يدوي بسبب + Audit (p_pct null يمسح التجاوز فيعود للتلقائي)
create or replace function public.project_core_set_progress(p_project uuid, p_pct int, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if p_pct is not null and (p_pct < 0 or p_pct > 100) then raise exception 'bad_progress'; end if;
  if p_pct is not null and coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  insert into public.project_core(project_id, updated_by) values (p_project, auth.uid()) on conflict do nothing;
  update public.project_core set progress_manual = p_pct,
    progress_reason = case when p_pct is null then null else left(p_reason,500) end,
    progress_manual_by = case when p_pct is null then null else auth.uid() end,
    progress_manual_at = case when p_pct is null then null else now() end,
    progress_pct = coalesce(p_pct, public.project_core_compute_progress(p_project)),
    updated_at = now(), updated_by = auth.uid()
    where project_id = p_project;
  perform public.pc_log(p_project, 'progress_override', 'project', p_project, jsonb_build_object('pct', p_pct));
  return public.project_core_progress(p_project);
end $$;

-- ═══ 2) تقويم مُثرّى — مهام/اجتماعات/جلسات + معالم المشروع (موعد نهائي/تسليم) ═══
create or replace function public.project_core_calendar(p_from date, p_to date, p_project uuid default null)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'title',title,'date',due_date,'status',status,'priority',priority))
              from public.project_tasks where is_deleted=false and due_date between p_from and p_to
                and (p_project is null or project_id = p_project)),'[]'::jsonb),
    'meetings', coalesce((select jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'title',title,'date',(scheduled_at at time zone 'utc')::date,'at',scheduled_at))
              from public.project_meetings where is_deleted=false and (scheduled_at at time zone 'utc')::date between p_from and p_to
                and (p_project is null or project_id = p_project)),'[]'::jsonb),
    'shoots', coalesce((select jsonb_agg(jsonb_build_object('id',id,'project_id',project_id,'title',title,'date',session_date,'call_time',call_time,'status',status))
              from public.project_shoot_sessions where is_deleted=false and session_date between p_from and p_to
                and (p_project is null or project_id = p_project)),'[]'::jsonb),
    'milestones', coalesce((select jsonb_agg(m) from (
        select jsonb_build_object('project_id',p.id,'title',p.project_name,'date',pc.due_date,'kind','due') m
          from public.projects p join public.project_core pc on pc.project_id=p.id
          where p.is_deleted=false and pc.due_date between p_from and p_to and (p_project is null or p.id=p_project)
        union all
        select jsonb_build_object('project_id',p.id,'title',p.project_name,'date',pc.delivery_date,'kind','delivery') m
          from public.projects p join public.project_core pc on pc.project_id=p.id
          where p.is_deleted=false and pc.delivery_date between p_from and p_to and (p_project is null or p.id=p_project)
      ) x),'[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ═══ 3) مخطّط المهام (Gantt) — المهام + الاعتماديات لمشروع واحد ═══
create or replace function public.project_core_task_graph(p_project uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare v jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'priority',t.priority,
                'start_date',t.start_date,'due_date',t.due_date,'progress',t.progress_pct,'assignee_id',t.assignee_id,
                'parent_task_id',t.parent_task_id) order by t.sort_order, t.created_at)
              from public.project_tasks t where t.project_id=p_project and t.is_deleted=false),'[]'::jsonb),
    'deps', coalesce((select jsonb_agg(jsonb_build_object('task_id',d.task_id,'depends_on',d.depends_on_task_id))
              from public.task_dependencies d
              join public.project_tasks t on t.id=d.task_id
              where t.project_id=p_project and t.is_deleted=false),'[]'::jsonb)
  ) into v;
  return v;
end $$;

-- ═══ 4) تطبيق قالب على مشروع — ينشئ مهام من spec.tasks[] (منع تكرار نفس القالب) ═══
create or replace function public.project_core_apply_template(p_project uuid, p_template uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_spec jsonb; elem jsonb; v_task uuid; v_n int := 0; ck jsonb; v_start date; v_ck int;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  select spec into v_spec from public.project_templates where id = p_template and is_active = true;
  if v_spec is null then raise exception 'template_not_found'; end if;
  -- منع تطبيق نفس القالب مرتين على نفس المشروع.
  if exists (select 1 from public.project_activity where project_id=p_project and action='template_applied'
             and detail->>'template_id' = p_template::text) then raise exception 'already_applied'; end if;
  select start_date into v_start from public.project_core where project_id=p_project;

  for elem in select value from jsonb_array_elements(case when jsonb_typeof(v_spec->'tasks')='array' then v_spec->'tasks' else '[]'::jsonb end) as t(value) loop
    v_ck := 0;
    insert into public.project_tasks(project_id, title, description, priority, estimated_hours, created_by,
        due_date, sort_order)
      values (p_project, coalesce(nullif(btrim(elem->>'title'),''),'مهمة'), nullif(btrim(elem->>'description'),''),
        coalesce(nullif(elem->>'priority',''),'normal'), nullif(elem->>'estimated_hours','')::numeric, auth.uid(),
        case when v_start is not null and (elem->>'offset_days') ~ '^[0-9]+$'
             then v_start + ((elem->>'offset_days')::int) else null end, v_n)
      returning id into v_task;
    -- قائمة تحقّق القالب.
    for ck in select value from jsonb_array_elements(case when jsonb_typeof(elem->'checklist')='array' then elem->'checklist' else '[]'::jsonb end) as c(value) loop
      insert into public.project_task_checklists(task_id, label, sort_order)
        values (v_task, coalesce(nullif(left(coalesce(ck->>'label', ck#>>'{}'),300),''),'بند'), v_ck);
      v_ck := v_ck + 1;
    end loop;
    v_n := v_n + 1;
  end loop;

  perform public.pc_log(p_project, 'template_applied', 'project', p_project,
    jsonb_build_object('template_id', p_template, 'tasks', v_n));
  perform public.pc_notify_team(p_project, 'project_note_new', 'project', p_project,
    'طُبِّق قالب على المشروع ('||v_n||' مهمة)', 'A template was applied ('||v_n||' tasks)', auth.uid());
  return jsonb_build_object('ok', true, 'tasks', v_n);
end $$;

-- ═══ 5) إضافة نسخة مخرَج — رقم تلقائي، منع التكرار، Audit + إشعار ═══
create or replace function public.project_core_deliverable_version_add(p_deliverable uuid, p_data jsonb)
returns public.project_deliverable_versions language plpgsql security definer set search_path = public as $$
declare r public.project_deliverable_versions; v_proj uuid; v_ver int;
begin
  select project_id into v_proj from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  v_ver := coalesce(nullif(p_data->>'version','')::int,
                    (select coalesce(max(version),0)+1 from public.project_deliverable_versions where deliverable_id = p_deliverable));
  if exists (select 1 from public.project_deliverable_versions where deliverable_id = p_deliverable and version = v_ver)
    then raise exception 'duplicate_version'; end if;
  insert into public.project_deliverable_versions(deliverable_id, version, preview_url, note, created_by)
    values (p_deliverable, v_ver, nullif(btrim(p_data->>'preview_url'),''), nullif(btrim(p_data->>'note'),''), auth.uid())
    returning * into r;
  perform public.pc_log(v_proj, 'deliverable_version_added', 'deliverable', p_deliverable, jsonb_build_object('version', v_ver));
  perform public.pc_notify_team(v_proj, 'project_note_new', 'deliverable', p_deliverable,
    'أُضيفت نسخة جديدة للمخرَج (v'||v_ver||')', 'New deliverable version (v'||v_ver||')', auth.uid());
  return r;
end $$;

-- ═══ 6) تحويل بند اجتماع إلى مهمة — مع ربط ومنع تكرار ═══
create or replace function public.project_core_meeting_to_task(p_meeting uuid, p_title text, p_assignee uuid default null, p_due date default null)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_proj uuid; v_mtitle text;
begin
  select project_id, title into v_proj, v_mtitle from public.project_meetings where id = p_meeting and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_title),'') = '' then raise exception 'title_required'; end if;
  -- منع تكرار نفس البند من نفس الاجتماع.
  if exists (select 1 from public.project_tasks where project_id=v_proj and is_deleted=false
             and title = btrim(p_title) and description = 'من اجتماع: '||coalesce(v_mtitle,'')) then raise exception 'already_created'; end if;
  insert into public.project_tasks(project_id, title, description, assignee_id, due_date, created_by)
    values (v_proj, btrim(p_title), 'من اجتماع: '||coalesce(v_mtitle,''), p_assignee, p_due, auth.uid())
    returning * into r;
  if p_assignee is not null then
    insert into public.task_followers(task_id, user_id) values (r.id, p_assignee) on conflict do nothing;
    perform public.pc_notify_user(p_assignee, 'project_note_new', 'task', r.id,
      'أُسندت إليك مهمة من اجتماع: '||btrim(p_title), 'Task assigned from a meeting: '||btrim(p_title));
  end if;
  perform public.pc_log(v_proj, 'meeting_action_item', 'meeting', p_meeting, jsonb_build_object('task', r.id));
  return r;
end $$;

-- ═══ 7) الصلاحيات ═══
do $g$
declare fn text;
begin
  for fn in select unnest(array[
    'project_core_progress(uuid)','project_core_set_progress(uuid,integer,text)',
    'project_core_calendar(date,date,uuid)','project_core_task_graph(uuid)','project_core_apply_template(uuid,uuid)',
    'project_core_deliverable_version_add(uuid,jsonb)','project_core_meeting_to_task(uuid,text,uuid,date)'
  ]) loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $g$;
-- compute_progress داخلية فقط (تُستدعى من progress/set_progress بصلاحية definer): امنعها عن الجميع (لا تسريب عبر IDOR).
revoke all on function public.project_core_compute_progress(uuid) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- ════════════════════════════════════════════════════════════════════════════
-- (أ) الأعمدة الجديدة:
select column_name from information_schema.columns
 where table_name='project_core' and column_name in ('progress_manual','progress_reason','progress_manual_by','progress_manual_at') order by 1;
-- (ب) الدوال + صلاحية authenticated + منع anon:
select proname, has_function_privilege('authenticated', oid, 'execute') a, has_function_privilege('anon', oid, 'execute') an
  from pg_proc where proname in ('project_core_progress','project_core_set_progress','project_core_calendar',
    'project_core_task_graph','project_core_apply_template','project_core_deliverable_version_add','project_core_meeting_to_task')
  order by proname;
-- (ج) نسخة واحدة من كل دالة (لا Overload):
select proname, count(*) from pg_proc where proname in ('project_core_calendar','project_core_apply_template',
  'project_core_deliverable_version_add','project_core_meeting_to_task') group by proname;
