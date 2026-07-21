-- ════════════════════════════════════════════════════════════════════════════
-- project_phase3_closure_RUNME.sql — PHASE 3 · CLOSURE (3C.2). Additive · Idempotent
--   · NO DROP · NO data deletion · Production-safe. يُشغَّل بعد 3A/3B/3C.
-- ────────────────────────────────────────────────────────────────────────────
-- يُقفل البنود المؤجّلة: (1) دلالة الاعتماديات الأربعة كاملة. (2) جاهزية المرحلة داخل
--   مسار تغيير دورة الحياة + تجاوز مُدقَّق. (3) لوحة تنفيذ الموظف. (4) تقارير المشروع/
--   الفريق/الشركة. (5) Activity Feed مُصفحَّن. (6) فهارس أداء.
--
-- لا يمسّ: done (يبقى «مكتملة») · core_stage/Timeline · project_progress/snapshot ·
--   project_core_set_stage (يُستدعى كما هو، لا يُعاد تعريفه) · progress_mode · Kanban/
--   Workflow · Deliverables · Phase B · Zoho · العهدة · /projects القديم.
-- يعيد الاستخدام: project_core_set_stage · project_stage_readiness · pc_log · pc_can_read_project
--   · emp_has_permission · project_activity · project_time_logs.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.project_core_set_stage(uuid,text,text)') is null then miss := miss||' project_core_set_stage'; end if;
  if to_regprocedure('public.project_stage_readiness(uuid)')          is null then miss := miss||' project_stage_readiness (3C)'; end if;
  if to_regprocedure('public.pc_task_apply_status(uuid,text,text,text,uuid)') is null then miss := miss||' pc_task_apply_status (3B)'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)') is null then miss := miss||' pc_can_read_project'; end if;
  if to_regprocedure('public.emp_has_permission(text)') is null then miss := miss||' emp_has_permission'; end if;
  if to_regclass('public.project_activity') is null then miss := miss||' project_activity'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%). شغّل 3A/3B/3C أولًا.', miss; end if;
end $pf$;

begin;

-- ═══ 1) دلالة الاعتماديات الأربعة — إعادة اشتقاق pc_task_apply_status (نسخة 3B الأمينة
--        + بوّابة اعتماديات كاملة). started = ليست backlog/todo/cancelled؛ done = 'done'.
--        الملغاة كسابقة لا تحجب. SQL هو المرجع الأمني. ═══
create or replace function public.pc_task_apply_status(p_task uuid, p_from text, p_to text, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_open_subs int; v_dep int;
begin
  if p_to = 'done' then
    select count(*) into v_open_subs from public.project_tasks
      where parent_task_id = p_task and coalesce(is_deleted,false)=false and status not in ('done','cancelled');
    if v_open_subs > 0 and not public.emp_has_permission('tasks.override_subtask_gate') and not public.is_owner() then
      raise exception 'subtasks_incomplete';
    end if;
    -- الإكمال: finish_to_finish يحتاج السابقة done؛ start_to_finish يحتاج السابقة started.
    select count(*) into v_dep
      from public.task_dependencies d join public.project_tasks dt on dt.id = d.depends_on_task_id
      where d.task_id = p_task and coalesce(dt.is_deleted,false)=false and dt.status <> 'cancelled'
        and ( (d.dep_type = 'finish_to_finish' and dt.status <> 'done')
           or (d.dep_type = 'start_to_finish'  and dt.status in ('backlog','todo')) );
    if v_dep > 0 then raise exception 'dependencies_incomplete'; end if;
    update public.project_tasks set progress_pct = 100, completed_at = coalesce(completed_at, now()),
      blocked_reason = null, blocked_at = null, blocked_by = null where id = p_task;

  elsif p_to = 'in_progress' and p_from in ('todo','backlog','blocked') then
    -- البدء: finish_to_start يحتاج السابقة done؛ start_to_start يحتاج السابقة started.
    select count(*) into v_dep
      from public.task_dependencies d join public.project_tasks dt on dt.id = d.depends_on_task_id
      where d.task_id = p_task and coalesce(dt.is_deleted,false)=false and dt.status <> 'cancelled'
        and ( (d.dep_type = 'finish_to_start' and dt.status <> 'done')
           or (d.dep_type = 'start_to_start'  and dt.status in ('backlog','todo')) );
    if v_dep > 0 then raise exception 'dependencies_incomplete'; end if;
    update public.project_tasks set blocked_reason = null, blocked_at = null, blocked_by = null where id = p_task;

  elsif p_from = 'done' and p_to <> 'done' then
    update public.project_tasks set completed_at = null, progress_pct = least(progress_pct, 99) where id = p_task;

  elsif p_to = 'blocked' then
    if coalesce(btrim(p_reason),'') = '' then raise exception 'block_reason_required'; end if;
    update public.project_tasks set blocked_reason = btrim(p_reason), blocked_at = now(), blocked_by = p_actor where id = p_task;

  elsif p_from = 'blocked' then
    update public.project_tasks set blocked_reason = null, blocked_at = null, blocked_by = null where id = p_task;
  end if;
end $$;

-- ═══ 2) تغيير المرحلة مع جاهزية + تجاوز مُدقَّق — يلفّ project_core_set_stage (لا يعيد تعريفه) ═══
create or replace function public.project_stage_advance(p_project uuid, p_target text, p_note text default null, p_override_reason text default null)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare v_ready jsonb; v_ready_bool boolean; r public.project_core; v_from text;
begin
  select core_stage into v_from from public.project_core where project_id = p_project;
  v_ready := public.project_stage_readiness(p_project);
  v_ready_bool := coalesce((v_ready->>'ready')::boolean, true);

  -- الجاهزية استرشادية: إن لم تكن جاهزة ولم يُرسَل سبب تجاوز ⇒ اطلب من الواجهة تأكيدًا.
  if not v_ready_bool and nullif(btrim(coalesce(p_override_reason,'')),'') is null then
    raise exception 'stage_not_ready';
  end if;
  -- التجاوز يتحقق أمنيًا في الـRPC (لا يعتمد على الواجهة) + يُسجَّل مع مؤشرات الجاهزية.
  if not v_ready_bool then
    if not (public.is_owner() or public.emp_has_permission('projects.override_stage_readiness')) then
      raise exception 'not authorized: override_stage_readiness';
    end if;
    perform public.pc_log(p_project, 'stage_readiness_override', 'project', p_project, jsonb_build_object(
      'from', v_from, 'to', p_target, 'reason', btrim(p_override_reason), 'readiness', v_ready));
  end if;

  r := public.project_core_set_stage(p_project, p_target, p_note);   -- المسار الفائز (حرّاس+تقدّم+سجل+مزامنة)
  return r;
end $$;

-- ═══ 3) لوحة تنفيذ الموظف — RPC مركزي (بلا N+1)، مُقيَّد لـauth.uid() داخل الدالة ═══
create or replace function public.employee_execution_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); v jsonb; v_today date := (now() at time zone 'utc')::date;
  v_week_start date := v_today - ((extract(dow from v_today)::int + 1) % 7); v_week_end date;
begin
  if uid is null or not (public.is_staff() or public.is_admin()) then raise exception 'not authorized'; end if;
  v_week_end := v_week_start + 6;
  -- مهام مرئية للموظف: مسند إليه أو مشارك (بلا كشف مهام غير مصرّح بها).
  with mine as (
    select distinct t.* from public.project_tasks t
    left join public.project_task_assignees a on a.task_id = t.id and a.user_id = uid
    where coalesce(t.is_deleted,false)=false and (t.assignee_id = uid or a.user_id = uid)
  )
  select jsonb_build_object(
    'due_today',   (select count(*) from mine where status not in ('done','cancelled') and due_date = v_today),
    'overdue',     (select count(*) from mine where status not in ('done','cancelled') and due_date is not null and due_date < v_today),
    'due_24h',     (select count(*) from mine where status not in ('done','cancelled') and due_date is not null and due_date <= v_today + 1 and due_date >= v_today),
    'due_3d',      (select count(*) from mine where status not in ('done','cancelled') and due_date is not null and due_date <= v_today + 3 and due_date > v_today + 1),
    'in_progress', (select count(*) from mine where status = 'in_progress'),
    'blocked',     (select count(*) from mine where status = 'blocked'),
    'needs_my_review', (select count(*) from public.project_tasks t2 join public.project_task_assignees a2 on a2.task_id=t2.id
                        where a2.user_id=uid and a2.assignment_role='reviewer' and t2.status in ('internal_review','client_review') and coalesce(t2.is_deleted,false)=false),
    'est_hours_week',  coalesce((select round(sum(estimated_hours)::numeric,1) from mine where status not in ('done','cancelled') and due_date between v_week_start and v_week_end),0),
    'logged_hours_week', coalesce((select round(sum(minutes)::numeric/60.0,1) from public.project_time_logs where user_id=uid and logged_for between v_week_start and v_week_end),0),
    'projects', (select coalesce(jsonb_agg(distinct jsonb_build_object('id',p.id,'name',p.project_name)),'[]'::jsonb)
                 from mine m join public.projects p on p.id = m.project_id where m.status not in ('done','cancelled')),
    'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'title',m.title,'project_id',m.project_id,
                'status',m.status,'priority',m.priority,'due_date',m.due_date,
                'overdue',(m.due_date is not null and m.due_date < v_today and m.status not in ('done','cancelled')))
                order by m.due_date asc nulls last, m.priority desc),'[]'::jsonb)
              from mine m where m.status not in ('done','cancelled') limit 200),
    'calculated_at', now()
  ) into v;
  return v;
end $$;

-- ═══ 4) تقرير تنفيذ المشروع (فترة) ═══
create or replace function public.project_execution_report(p_project uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_from date := coalesce(p_from, (now() at time zone 'utc')::date - 90); v_to date := coalesce(p_to, (now() at time zone 'utc')::date);
  v_today date := (now() at time zone 'utc')::date; v_reopened int; v_reviews int;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select count(*) into v_reopened from public.project_activity where project_id=p_project and action='task_moved'
    and detail->>'from' = 'done' and created_at::date between v_from and v_to;
  select count(*) into v_reviews from public.project_activity where project_id=p_project and action='task_review'
    and created_at::date between v_from and v_to;
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'total', count(*) filter (where status <> 'cancelled'),
    'done', count(*) filter (where status='done'),
    'overdue', count(*) filter (where status not in ('done','cancelled') and due_date is not null and due_date < v_today),
    'blocked', count(*) filter (where status='blocked'),
    'review', count(*) filter (where status in ('internal_review','client_review')),
    'completion_rate', round(100.0 * count(*) filter (where status='done') / greatest(count(*) filter (where status<>'cancelled'),1))::int,
    'on_time_rate', round(100.0 * count(*) filter (where status='done' and (due_date is null or completed_at is null or completed_at::date <= due_date))
                     / greatest(count(*) filter (where status='done'),1))::int,
    'avg_completion_days', coalesce(round(avg(extract(epoch from (completed_at - created_at))/86400) filter (where status='done' and completed_at is not null))::numeric,0),
    'reopened', v_reopened, 'change_requests', v_reviews,
    'est_hours', coalesce(round(sum(estimated_hours)::numeric,1) filter (where status<>'cancelled'),0),
    'logged_hours', coalesce((select round(sum(minutes)::numeric/60.0,1) from public.project_time_logs where project_id=p_project),0),
    'bottleneck_by_status', (select jsonb_object_agg(status, c) from (select status, count(*) c from public.project_tasks
       where project_id=p_project and coalesce(is_deleted,false)=false and status not in ('done','cancelled') group by status) q),
    'blocked_reasons', (select coalesce(jsonb_agg(jsonb_build_object('task', title, 'reason', blocked_reason)),'[]'::jsonb)
       from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false and status='blocked' and blocked_reason is not null),
    'health', public.project_execution_health(p_project),
    'calculated_at', now()
  ) into v from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false;
  return v;
end $$;

-- ═══ 5) تقرير الفريق (تشغيلي — للمدير/الإدارة، ليس تقييمًا) ═══
create or replace function public.team_execution_report(p_project uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_today date := (now() at time zone 'utc')::date;
begin
  if not (public.is_owner() or public.can_manage_projects() or public.emp_has_permission('tasks.view_team_performance'))
    then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'user_id', uid, 'name', name, 'assigned', assigned, 'done', done, 'overdue', overdue,
    'blocked', blocked, 'review', review, 'active_projects', projects,
    'est_hours', est, 'logged_hours', logged) order by overdue desc, assigned desc), '[]'::jsonb) into v
  from (
    select t.assignee_id as uid, coalesce(pr.full_name, pr.email) as name,
      count(*) as assigned, count(*) filter (where t.status='done') as done,
      count(*) filter (where t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today) as overdue,
      count(*) filter (where t.status='blocked') as blocked,
      count(*) filter (where t.status in ('internal_review','client_review')) as review,
      count(distinct t.project_id) filter (where t.status not in ('done','cancelled')) as projects,
      coalesce(round(sum(t.estimated_hours)::numeric,1),0) as est,
      coalesce((select round(sum(tl.minutes)::numeric/60.0,1) from public.project_time_logs tl where tl.user_id=t.assignee_id),0) as logged
    from public.project_tasks t
    left join public.profiles pr on pr.id = t.assignee_id
    where coalesce(t.is_deleted,false)=false and t.assignee_id is not null
      and (p_project is null or t.project_id = p_project)
      and (public.staff_reads_all_projects() or public.can_manage_projects() or public.pc_can_read_project(t.project_id))
    group by t.assignee_id, pr.full_name, pr.email
  ) q;
  return jsonb_build_object('members', v, 'calculated_at', now());
end $$;

-- ═══ 6) تقرير الشركة (للمالك/الإدارة فقط) ═══
create or replace function public.company_execution_report()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_today date := (now() at time zone 'utc')::date; v_health jsonb;
begin
  if not (public.is_owner() or public.can_manage_projects()) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_object_agg(st, c),'{}'::jsonb) into v_health from (
    select (public.project_execution_health(p.id)->>'status') as st, count(*) c
    from public.projects p where coalesce(p.is_deleted,false)=false group by 1) h;
  select jsonb_build_object(
    'health_distribution', v_health,
    'total_overdue_tasks', (select count(*) from public.project_tasks where coalesce(is_deleted,false)=false
        and status not in ('done','cancelled') and due_date is not null and due_date < v_today),
    'bottleneck_by_status', (select jsonb_object_agg(status, c) from (select status, count(*) c from public.project_tasks
        where coalesce(is_deleted,false)=false and status not in ('done','cancelled') group by status) q),
    'near_delivery', (select count(*) from public.project_core where core_stage in ('approved','delivered')),
    'est_hours', coalesce((select round(sum(estimated_hours)::numeric,1) from public.project_tasks where coalesce(is_deleted,false)=false and status<>'cancelled'),0),
    'logged_hours', coalesce((select round(sum(minutes)::numeric/60.0,1) from public.project_time_logs),0),
    'calculated_at', now()
  ) into v;
  return v;
end $$;

-- ═══ 7) Activity Feed مُصفحَّن (وصف عربي يُبنى في الواجهة من action+detail) ═══
create or replace function public.project_activity_feed(p_project uuid, p_before timestamptz default null, p_action text default null, p_actor uuid default null, p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'action', a.action, 'entity_type', a.entity_type, 'entity_id', a.entity_id,
      'detail', a.detail, 'actor_id', a.actor_id, 'actor', coalesce(pr.full_name, pr.email), 'created_at', a.created_at)
    order by a.created_at desc), '[]'::jsonb) into v
  from (
    select * from public.project_activity
    where project_id = p_project
      and (p_before is null or created_at < p_before)
      and (p_action is null or action = p_action)
      and (p_actor is null or actor_id = p_actor)
    order by created_at desc limit greatest(1, least(p_limit, 100))
  ) a left join public.profiles pr on pr.id = a.actor_id;
  return jsonb_build_object('events', v, 'has_more', (jsonb_array_length(v) >= greatest(1, least(p_limit,100))));
end $$;

-- ═══ 8) فهارس أداء (عند الحاجة المثبتة) ═══
create index if not exists idx_ptasks_assignee_status on public.project_tasks(assignee_id, status) where is_deleted = false;
create index if not exists idx_ptasks_updated        on public.project_tasks(updated_at) where is_deleted = false;
create index if not exists idx_pactivity_proj_time    on public.project_activity(project_id, created_at desc);
create index if not exists idx_ptimelogs_user_for     on public.project_time_logs(user_id, logged_for);

-- ═══ 9) Grants ═══
do $g$
begin
  execute 'grant execute on function public.project_stage_advance(uuid,text,text,text) to authenticated';
  execute 'grant execute on function public.employee_execution_dashboard() to authenticated';
  execute 'grant execute on function public.project_execution_report(uuid,date,date) to authenticated';
  execute 'grant execute on function public.team_execution_report(uuid) to authenticated';
  execute 'grant execute on function public.company_execution_report() to authenticated';
  execute 'grant execute on function public.project_activity_feed(uuid,timestamptz,text,uuid,int) to authenticated';
  execute 'revoke all on function public.pc_task_apply_status(uuid,text,text,text,uuid) from public, anon, authenticated';
end $g$;

-- ═══ 10) تشخيص ═══
do $d$
declare v_ss boolean;
begin
  v_ss := public.task_transition_allowed('todo','in_progress');   -- سلامة 3B (لم تُكسر)
  raise notice 'phase3 closure: stage_advance=%, emp_exec=%, proj_report=%, team_report=%, company_report=%, activity_feed=%, 3B_matrix_ok=%',
    (to_regprocedure('public.project_stage_advance(uuid,text,text,text)') is not null),
    (to_regprocedure('public.employee_execution_dashboard()') is not null),
    (to_regprocedure('public.project_execution_report(uuid,date,date)') is not null),
    (to_regprocedure('public.team_execution_report(uuid)') is not null),
    (to_regprocedure('public.company_execution_report()') is not null),
    (to_regprocedure('public.project_activity_feed(uuid,timestamptz,text,uuid,int)') is not null), v_ss;
  if not v_ss then raise exception 'كُسِرت مصفوفة انتقال 3B'; end if;
end $d$;

commit;

notify pgrst, 'reload schema';
