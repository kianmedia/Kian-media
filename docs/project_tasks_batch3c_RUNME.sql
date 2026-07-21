-- ════════════════════════════════════════════════════════════════════════════
-- project_tasks_batch3c_RUNME.sql — PHASE 3 · BATCH 3C · Progress, Alerts, Health,
--   Execution Dashboard. Additive · Idempotent · NO DROP · NO data deletion.
-- ────────────────────────────────────────────────────────────────────────────
-- الهدف: توحيد رؤية تقدم التنفيذ دون خلق مصدر حقيقة جديد يتعارض مع دورة الحياة.
--
-- لا يمسّ: done (يبقى «مكتملة») · project_core.core_stage · Lifecycle Timeline ·
--   project_stage_sync · نسبة دورة الحياة (project_progress يبقى كما هو — نُعيد استخدامه) ·
--   Kanban/Workflow/Deps (3B) · Deliverables · Phase B · Zoho · العهدة · /projects القديم.
-- المشاريع الحالية تبقى progress_mode='lifecycle' افتراضيًا (لا تحويل تلقائي إلى hybrid).
--
-- يُعيد الاستخدام (لا تكرار): project_progress() (يعيد floor/ceiling/auto/pct — خريطة
--   المراحل الوحيدة) · project_task_progress() (يُطوَّر) · reminder_tracking + pc_event_emit
--   (البنية الحالية للتنبيهات — Idempotent، بلا Cron جديد، بلا notifications.type جديد) ·
--   emp_has_permission (الصلاحيات) · progress_manual/_by/_at + project_core_set_progress (اليدوي).
--
-- المحتوى: §1 progress_mode · §2 project_task_progress موزون بلا ازدواج · §3
--   project_progress_snapshot (المصدر المركزي) · §4 set_progress_mode + صلاحية + Audit ·
--   §5 project_execution_health · §6 project_stage_readiness · §7 project_execution_dashboard ·
--   §8 project_alerts (مركز التنبيهات، قراءة) · §9 pc_task_alerts_scan (كنس التنبيهات — Cron) ·
--   §10 صلاحيات · §11 Grants · §12 تشخيص.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ 0) Preflight ═══
do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_core')  is null then miss := miss||' project_core'; end if;
  if to_regclass('public.project_tasks') is null then miss := miss||' project_tasks'; end if;
  if to_regclass('public.reminder_tracking') is null then miss := miss||' reminder_tracking'; end if;
  if to_regprocedure('public.project_progress(uuid)')       is null then miss := miss||' project_progress'; end if;
  if to_regprocedure('public.project_task_progress(uuid)')  is null then miss := miss||' project_task_progress (3A)'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)')    is null then miss := miss||' pc_can_read_project'; end if;
  if to_regprocedure('public.emp_has_permission(text)')     is null then miss := miss||' emp_has_permission'; end if;
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null then miss := miss||' pc_event_emit'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null then miss := miss||' pc_log'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%). شغّل 3A/3B + project_core_ABSOLUTE_FINAL أولًا.', miss; end if;
end $pf$;

begin;

-- ═══ 1) progress_mode على project_core (افتراضي lifecycle — لا تحويل تلقائي) ═══
alter table public.project_core add column if not exists progress_mode text not null default 'lifecycle';
alter table public.project_core drop constraint if exists project_core_progress_mode_chk;
alter table public.project_core add  constraint project_core_progress_mode_chk
  check (progress_mode in ('lifecycle','tasks','hybrid','manual'));
alter table public.project_core add column if not exists progress_mode_by uuid references auth.users(id) on delete set null;
alter table public.project_core add column if not exists progress_mode_at timestamptz;

-- ═══ 2) project_task_progress — موزون + بلا ازدواج (رئيسية/فرعية) + حقول تفسيرية.
--     يبقى متوافقًا (نفس مفاتيح 3A: total/active/done/overdue/pct) + مفاتيح جديدة.
--     الوزن: eligible = المهام الورقية (بلا مهام فرعية نشطة) — الأب يُمثَّل بأبنائه فلا يُحسب مرتين.
--     estimated_hours وزنًا إن كانت لكل المؤهلة > 0 (weighted)، وإلا وزن متساوٍ (equal).
create or replace function public.project_task_progress(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_active int; v_done int; v_overdue int; v_blocked int;
  v_eligible int; v_completed int; v_est numeric; v_all_have_est boolean;
  v_pct int; v_cweight numeric; v_wnum numeric; v_wden numeric; v_eqavg numeric; v_eqcw numeric;
  v_method text; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  -- عدّادات عامة (كل المهام غير الملغاة/المحذوفة) — للعرض.
  select count(*) filter (where status <> 'cancelled'),
         count(*) filter (where status not in ('done','cancelled')),
         count(*) filter (where status = 'done'),
         count(*) filter (where status not in ('done','cancelled') and due_date is not null and due_date < v_today),
         count(*) filter (where status = 'blocked')
    into v_total, v_active, v_done, v_overdue, v_blocked
  from public.project_tasks where project_id = p_project and coalesce(is_deleted,false)=false;

  -- المؤهلة للوزن = الورقية (بلا مهمة فرعية نشطة)، غير ملغاة/محذوفة — منعًا للازدواج (CTE، بلا Temp table).
  with leaf as (
    select case when t.status='done' then 100 else greatest(0, least(100, t.progress_pct)) end as prog,
           coalesce(nullif(t.estimated_hours, 0), 0)::numeric as est, t.status
    from public.project_tasks t
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status <> 'cancelled'
      and not exists (select 1 from public.project_tasks c
                      where c.parent_task_id = t.id and coalesce(c.is_deleted,false)=false and c.status <> 'cancelled')
  )
  select count(*)::int, count(*) filter (where status='done')::int, coalesce(sum(est),0),
         coalesce(bool_and(est > 0), true), coalesce(sum(est*prog),0), coalesce(sum(est),0),
         coalesce(avg(prog),0), coalesce(sum(prog)/100.0,0)
    into v_eligible, v_completed, v_est, v_all_have_est, v_wnum, v_wden, v_eqavg, v_eqcw
  from leaf;

  if v_eligible = 0 then
    v_pct := 0; v_method := 'no_eligible_tasks'; v_cweight := 0;
  elsif v_all_have_est then
    v_method := 'weighted';
    v_pct := round(case when v_wden > 0 then v_wnum / v_wden else 0 end)::int;   -- Σ(est·prog)/Σ(est)
    v_cweight := round(v_wnum / 100.0, 2);
  else
    v_method := 'equal';   -- خلط/غياب تقديرات ⇒ وزن متساوٍ (لا تُفسد مهمة بلا تقدير النتيجة)
    v_pct := round(v_eqavg)::int;
    v_cweight := round(v_eqcw, 2);
  end if;

  return jsonb_build_object(
    'total', v_total, 'active', v_active, 'done', v_done, 'overdue', v_overdue, 'blocked', v_blocked, 'pct', v_pct,
    'eligible_tasks', v_eligible, 'completed_tasks', v_completed, 'overdue_tasks', v_overdue, 'blocked_tasks', v_blocked,
    'total_estimated_hours', round(v_est,1), 'completed_weight', round(v_cweight,2),
    'calculation_method', v_method, 'calculated_at', now());
end $$;

-- ═══ 3) project_progress_snapshot — المصدر المركزي الوحيد للنسبة المعروضة ═══
--     lifecycle: كما هو (project_progress). tasks: تقدم المهام (fallback lifecycle عند لا-مهام).
--     hybrid: floor + task%×(ceiling-floor) داخل نطاق المرحلة (reuse floor/ceiling من project_progress).
--     manual: progress_manual (أو lifecycle عند عدم الضبط). closed=100 عبر بوابة دورة الحياة.
create or replace function public.project_progress_snapshot(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_life jsonb; v_task jsonb; v_mode text; v_stage text; v_state text;
  v_floor int; v_ceiling int; v_life_pct int; v_auto int; v_task_pct int; v_eligible int;
  v_manual int; v_eff int; v_method text;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  v_life := public.project_progress(p_project);          -- المرجع: pct/auto/floor/ceiling/stage/state
  v_task := public.project_task_progress(p_project);
  select coalesce(progress_mode,'lifecycle'), progress_manual into v_mode, v_manual
    from public.project_core where project_id = p_project;
  v_mode := coalesce(v_mode, 'lifecycle');
  v_stage := v_life->>'stage'; v_state := v_life->>'state';
  v_floor := coalesce((v_life->>'floor')::int, 0); v_ceiling := coalesce((v_life->>'ceiling')::int, 95);
  v_life_pct := coalesce((v_life->>'pct')::int, 0); v_auto := coalesce((v_life->>'auto_pct')::int, v_life_pct);
  v_task_pct := coalesce((v_task->>'pct')::int, 0); v_eligible := coalesce((v_task->>'eligible_tasks')::int, 0);

  if v_mode = 'lifecycle' then
    v_eff := v_life_pct; v_method := 'lifecycle';
  elsif v_mode = 'manual' then
    v_eff := coalesce(v_manual, v_auto); v_method := case when v_manual is not null then 'manual' else 'manual_unset_lifecycle' end;
  elsif v_mode = 'tasks' then
    if v_eligible = 0 then v_eff := v_auto; v_method := 'tasks_no_data_lifecycle';
    else v_eff := v_task_pct; v_method := 'tasks'; end if;
  else  -- hybrid
    if coalesce(v_stage,'') = 'closed' or v_state in ('archived','cancelled') then
      v_eff := v_life_pct; v_method := 'hybrid_lifecycle_gate';   -- closed/محايد ⇒ نسبة دورة الحياة (تحفظ بوابة 100)
    elsif v_eligible = 0 then
      v_eff := v_auto; v_method := 'hybrid_no_tasks_lifecycle';
    else
      v_eff := v_floor + round(v_task_pct / 100.0 * (v_ceiling - v_floor));
      v_eff := greatest(v_floor, least(v_ceiling, v_eff)); v_method := 'hybrid';
    end if;
  end if;
  v_eff := greatest(0, least(100, v_eff));

  return jsonb_build_object(
    'progress_mode', v_mode, 'lifecycle_progress', v_life_pct, 'task_progress', v_task_pct,
    'effective_progress', v_eff, 'auto_pct', v_auto, 'core_stage', v_stage,
    'stage_floor', v_floor, 'stage_ceiling', v_ceiling, 'calculation_method', v_method,
    'overridden', coalesce((v_life->>'overridden')::boolean, false),
    'eligible_tasks', v_eligible, 'completed_tasks', coalesce((v_task->>'completed_tasks')::int,0),
    'overdue_tasks', coalesce((v_task->>'overdue_tasks')::int,0), 'blocked_tasks', coalesce((v_task->>'blocked_tasks')::int,0),
    'total_tasks', coalesce((v_task->>'total')::int,0), 'task_method', v_task->>'calculation_method',
    'calculated_at', now());
end $$;

-- ═══ 4) تغيير وضع التقدم — RPC + Audit (لا كتابة مباشرة من الواجهة) ═══
create or replace function public.project_core_set_progress_mode(p_project uuid, p_mode text, p_reason text default null)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_old text;
begin
  if not (public.is_owner() or public.can_manage_projects() or public.emp_has_permission('projects.manage_progress_mode'))
    then raise exception 'not authorized'; end if;
  if p_mode not in ('lifecycle','tasks','hybrid','manual') then raise exception 'bad_mode'; end if;
  select progress_mode into v_old from public.project_core where project_id = p_project;
  update public.project_core set progress_mode = p_mode, progress_mode_by = auth.uid(), progress_mode_at = now(), updated_at = now()
    where project_id = p_project returning * into r;
  if r.project_id is null then raise exception 'not_found'; end if;
  perform public.pc_log(p_project, 'progress_mode_changed', 'project', p_project,
    jsonb_build_object('from', v_old, 'to', p_mode, 'reason', nullif(btrim(coalesce(p_reason,'')),'')));
  perform public.pc_notify_team(p_project, 'project_note_new', 'project', p_project,
    'تغيّرت طريقة حساب الإنجاز إلى: '||p_mode, 'Progress mode changed: '||p_mode, auth.uid());
  return r;
end $$;

-- ═══ 5) صحة تنفيذ المشروع — مشتقة، قابلة للتفسير (score + reasons + severity) ═══
create or replace function public.project_execution_health(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_active int; v_overdue int; v_blocked int; v_review int; v_hours_over int; v_idle_days int;
  v_score int := 100; v_reasons jsonb := '[]'::jsonb; v_status text; v_last timestamptz; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select count(*) filter (where status not in ('done','cancelled')),
         count(*) filter (where status not in ('done','cancelled') and due_date is not null and due_date < v_today),
         count(*) filter (where status = 'blocked'),
         count(*) filter (where status in ('internal_review','client_review')),
         count(*) filter (where status not in ('done','cancelled') and estimated_hours is not null and estimated_hours > 0
                          and actual_hours is not null and actual_hours > estimated_hours)
    into v_active, v_overdue, v_blocked, v_review, v_hours_over
  from public.project_tasks where project_id = p_project and coalesce(is_deleted,false)=false;
  select max(created_at) into v_last from public.project_activity where project_id = p_project;
  v_idle_days := case when v_last is null then 999 else (extract(epoch from (now() - v_last))/86400)::int end;

  -- خصومات مفسَّرة (كل سبب severity + قيمة).
  if v_active > 0 and v_overdue::numeric / greatest(v_active,1) >= 0.4 then
    v_score := v_score - 30; v_reasons := v_reasons || jsonb_build_object('key','overdue_ratio_high','severity','critical',
      'ar', v_overdue||' مهام متأخرة من '||v_active||' نشطة', 'en', v_overdue||'/'||v_active||' tasks overdue');
  elsif v_overdue > 0 then
    v_score := v_score - least(20, v_overdue*5); v_reasons := v_reasons || jsonb_build_object('key','overdue','severity','attention',
      'ar', v_overdue||' مهمة متأخرة', 'en', v_overdue||' overdue tasks');
  end if;
  if v_blocked > 0 then v_score := v_score - least(20, v_blocked*7); v_reasons := v_reasons || jsonb_build_object('key','blocked','severity','at_risk',
    'ar', v_blocked||' مهمة متوقّفة', 'en', v_blocked||' blocked tasks'); end if;
  if v_review > 2 then v_score := v_score - 10; v_reasons := v_reasons || jsonb_build_object('key','review_backlog','severity','attention',
    'ar', v_review||' مهمة بانتظار المراجعة', 'en', v_review||' awaiting review'); end if;
  if v_hours_over > 0 then v_score := v_score - least(15, v_hours_over*5); v_reasons := v_reasons || jsonb_build_object('key','hours_overrun','severity','attention',
    'ar', v_hours_over||' مهمة تجاوزت ساعاتها المقدّرة', 'en', v_hours_over||' tasks over estimate'); end if;
  if v_idle_days >= 14 then v_score := v_score - 15; v_reasons := v_reasons || jsonb_build_object('key','idle','severity','at_risk',
    'ar', 'لا نشاط منذ '||v_idle_days||' يومًا', 'en', 'No activity for '||v_idle_days||' days'); end if;

  v_score := greatest(0, least(100, v_score));
  v_status := case when v_score >= 85 then 'healthy' when v_score >= 65 then 'attention'
                   when v_score >= 40 then 'at_risk' else 'critical' end;
  return jsonb_build_object('status', v_status, 'health_score', v_score, 'reasons', v_reasons,
    'active_tasks', v_active, 'overdue_tasks', v_overdue, 'blocked_tasks', v_blocked,
    'awaiting_review', v_review, 'hours_overrun', v_hours_over, 'idle_days', v_idle_days, 'calculated_at', now());
end $$;

-- ═══ 6) جاهزية الانتقال بين المراحل — استرشادية (لا Hard Block افتراضيًا) ═══
create or replace function public.project_stage_readiness(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_open int; v_overdue int; v_blocked int; v_review int; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select count(*) filter (where status not in ('done','cancelled')),
         count(*) filter (where status not in ('done','cancelled') and due_date is not null and due_date < v_today),
         count(*) filter (where status = 'blocked'),
         count(*) filter (where status in ('internal_review','client_review'))
    into v_open, v_overdue, v_blocked, v_review
  from public.project_tasks where project_id = p_project and coalesce(is_deleted,false)=false;
  return jsonb_build_object('open_tasks', v_open, 'overdue_tasks', v_overdue, 'blocked_tasks', v_blocked,
    'awaiting_review', v_review, 'ready', (v_open = 0 and v_blocked = 0),
    'warning_ar', case when v_open=0 then null else 'يوجد '||v_open||' مهمة غير مكتملة'||
      case when v_overdue>0 then '، منها '||v_overdue||' متأخرة' else '' end||
      case when v_blocked>0 then ' و'||v_blocked||' متوقّفة' else '' end end,
    'warning_en', case when v_open=0 then null else v_open||' open tasks'||
      case when v_overdue>0 then ', '||v_overdue||' overdue' else '' end||
      case when v_blocked>0 then ', '||v_blocked||' blocked' else '' end end);
end $$;

-- ═══ 7) لوحة التنفيذ — استدعاء واحد (بلا N+1) ═══
create or replace function public.project_execution_dashboard(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_snap jsonb; v_health jsonb; v_hours jsonb; v_workload jsonb; v_counts jsonb;
  v_this_week int; v_today date := (now() at time zone 'utc')::date; v_last timestamptz;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  v_snap   := public.project_progress_snapshot(p_project);
  v_health := public.project_execution_health(p_project);

  select jsonb_build_object(
    'total', count(*) filter (where status <> 'cancelled'),
    'todo', count(*) filter (where status in ('backlog','todo')),
    'in_progress', count(*) filter (where status = 'in_progress'),
    'review', count(*) filter (where status in ('internal_review','client_review')),
    'blocked', count(*) filter (where status = 'blocked'),
    'done', count(*) filter (where status = 'done'),
    'overdue', count(*) filter (where status not in ('done','cancelled') and due_date is not null and due_date < v_today),
    'due_this_week', count(*) filter (where status not in ('done','cancelled') and due_date between v_today and v_today + 7)
  ) into v_counts from public.project_tasks where project_id = p_project and coalesce(is_deleted,false)=false;

  -- الساعات: المقدّرة من المهام؛ الفعلية = مصدر واحد (project_time_logs إن وُجدت، وإلا actual_hours).
  select jsonb_build_object(
    'estimated', coalesce((select round(sum(estimated_hours)::numeric,1) from public.project_tasks
                  where project_id = p_project and coalesce(is_deleted,false)=false and status <> 'cancelled'),0),
    'logged', coalesce((select round(sum(minutes)::numeric/60.0,1) from public.project_time_logs where project_id = p_project),0),
    'actual_manual', coalesce((select round(sum(actual_hours)::numeric,1) from public.project_tasks
                  where project_id = p_project and coalesce(is_deleted,false)=false and status <> 'cancelled'),0)
  ) into v_hours;

  -- عبء الفريق: مهام نشطة لكل مكلَّف.
  select coalesce(jsonb_agg(jsonb_build_object('user_id', a.uid, 'name', coalesce(pr.full_name, pr.email),
      'active', a.active, 'overdue', a.overdue) order by a.active desc), '[]'::jsonb) into v_workload
  from (
    select t.assignee_id as uid,
      count(*) filter (where t.status not in ('done','cancelled')) as active,
      count(*) filter (where t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today) as overdue
    from public.project_tasks t where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.assignee_id is not null
    group by t.assignee_id) a
  left join public.profiles pr on pr.id = a.uid;

  select max(created_at) into v_last from public.project_activity where project_id = p_project;
  return jsonb_build_object('progress', v_snap, 'health', v_health, 'counts', v_counts,
    'hours', v_hours, 'workload', v_workload, 'last_activity_at', v_last, 'calculated_at', now());
end $$;

-- ═══ 8) مركز التنبيهات — مشتق وقت القراءة (يحترم رؤية المشروع) ═══
create or replace function public.project_alerts(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(a order by a->>'severity', a->>'due'), '[]'::jsonb) into v from (
    select jsonb_build_object('type', typ, 'severity', sev, 'task_id', id, 'title', title,
      'assignee_id', assignee_id, 'due', due_date, 'ar', ar, 'en', en) as a
    from (
      select t.id, t.title, t.assignee_id, t.due_date,
        case
          when t.due_date is not null and t.due_date < v_today then 'overdue'
          when t.status = 'blocked' then 'blocked'
          when t.due_date is not null and t.due_date <= v_today + 1 then 'due_soon'
          when t.due_date is not null and t.due_date <= v_today + 3 then 'due_3d'
          when t.status in ('internal_review','client_review') then 'awaiting_review'
          when t.estimated_hours is not null and t.estimated_hours>0 and t.actual_hours is not null and t.actual_hours>t.estimated_hours then 'hours_overrun'
          when t.assignee_id is null then 'no_owner'
          when t.due_date is null then 'no_due'
        end as typ,
        case
          when t.due_date is not null and t.due_date < v_today then 'critical'
          when t.status = 'blocked' then 'at_risk'
          when t.due_date is not null and t.due_date <= v_today + 1 then 'attention'
          else 'info' end as sev,
        case when t.due_date is not null and t.due_date < v_today then 'مهمة متأخرة'
             when t.status='blocked' then 'مهمة متوقّفة'
             when t.due_date is not null and t.due_date <= v_today+1 then 'تستحق خلال 24 ساعة'
             when t.due_date is not null and t.due_date <= v_today+3 then 'تستحق خلال 3 أيام'
             when t.status in ('internal_review','client_review') then 'بانتظار المراجعة'
             when t.estimated_hours>0 and t.actual_hours>t.estimated_hours then 'تجاوز الساعات المقدّرة'
             when t.assignee_id is null then 'بلا مسؤول'
             else 'بلا موعد استحقاق' end as ar,
        'Task alert' as en
      from public.project_tasks t
      where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
    ) s where typ is not null
  ) z;
  return jsonb_build_object('project_id', p_project, 'alerts', v, 'calculated_at', now());
end $$;

-- ═══ 9) كنس التنبيهات (Cron) — أنواع إضافية، Idempotent عبر reminder_tracking + pc_event_emit.
--     يُستدعى من /api/cron/notify-email بجانب pc_reminders_scan (لا Cron جديد، لا نوع إشعار جديد).
create or replace function public.pc_task_alerts_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; v_n int := 0; v_key text; v_team uuid[]; v_today date := (now() at time zone 'utc')::date;
begin
  -- مهام متوقّفة > 3 أيام (للمكلَّف) — attention.
  for rec in
    select t.id, t.title, t.assignee_id, t.project_id, t.blocked_at from public.project_tasks t
    where t.is_deleted=false and t.status='blocked' and t.assignee_id is not null
      and t.blocked_at is not null and t.blocked_at < now() - interval '3 days'
  loop
    v_key := 'task_blocked_long:'||rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at > now()) then continue; end if;
    perform public.pc_event_emit(rec.project_id, 'task_blocked_long', 'task', rec.id, 'action',
      'مهمة متوقّفة منذ أكثر من 3 أيام: '||rec.title, 'Task blocked >3d: '||rec.title, null, null,
      '/client-portal/project-core/'||rec.project_id||'?tab=tasks', array[rec.assignee_id], v_key||':'||v_today);
    insert into public.reminder_tracking(reminder_key, user_id, project_id, entity_type, entity_id)
      values (v_key, rec.assignee_id, rec.project_id, 'task', rec.id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at = now() + interval '72 hours';
    v_n := v_n + 1;
  end loop;

  -- مهام عالقة في المراجعة > 5 أيام (لفريق المشروع) — action.
  for rec in
    select t.id, t.title, t.project_id, t.status from public.project_tasks t
    where t.is_deleted=false and t.status in ('internal_review','client_review')
      and t.updated_at < now() - interval '5 days'
  loop
    v_key := 'task_review_stuck:'||rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at > now()) then continue; end if;
    select coalesce(array_agg(pm.user_id),'{}') into v_team from public.project_members pm
      where pm.project_id=rec.project_id and pm.is_deleted=false and pm.role like 'kian_%';
    perform public.pc_event_emit(rec.project_id, 'task_review_stuck', 'task', rec.id, 'action',
      'مهمة في المراجعة منذ أكثر من 5 أيام: '||rec.title, 'Task in review >5d: '||rec.title, null, null,
      '/client-portal/project-core/'||rec.project_id||'?tab=tasks', v_team, v_key||':'||v_today);
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'task', rec.id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at = now() + interval '72 hours';
    v_n := v_n + 1;
  end loop;

  -- مشاريع بنسبة تأخّر عالية (≥40% من النشطة متأخرة، ≥3 متأخرة) — للمدير — at_risk.
  for rec in
    select p.id as project_id,
      count(*) filter (where t.status not in ('done','cancelled')) as active,
      count(*) filter (where t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today) as overdue
    from public.projects p join public.project_tasks t on t.project_id = p.id and coalesce(t.is_deleted,false)=false
    where coalesce(p.is_deleted,false)=false group by p.id
    having count(*) filter (where t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today) >= 3
       and count(*) filter (where t.status not in ('done','cancelled') and t.due_date is not null and t.due_date < v_today)::numeric
           / greatest(count(*) filter (where t.status not in ('done','cancelled')),1) >= 0.4
  loop
    v_key := 'project_overdue_heavy:'||rec.project_id;
    if exists (select 1 from public.reminder_tracking where reminder_key=v_key and next_eligible_at > now()) then continue; end if;
    select coalesce(array_agg(pm.user_id),'{}') into v_team from public.project_members pm
      where pm.project_id=rec.project_id and pm.is_deleted=false and pm.role='kian_manager';
    perform public.pc_event_emit(rec.project_id, 'project_overdue_heavy', 'project', rec.project_id, 'critical',
      'مشروع فيه '||rec.overdue||' مهام متأخرة من '||rec.active||' نشطة', 'Project heavily overdue', null, null,
      '/client-portal/project-core/'||rec.project_id||'?tab=execution', v_team, v_key||':'||v_today);
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'project', rec.project_id)
      on conflict (reminder_key) do update set last_sent_at=now(), next_eligible_at = now() + interval '72 hours';
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('ok', true, 'emitted', v_n);
end $$;

-- ═══ 10) الصلاحيات (مفاتيح جديدة فقط — الباقي مُعاد استخدامه) ═══
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('projects.manage_progress_mode',     'projects', 'normal', 200, 'تغيير طريقة حساب الإنجاز',   'Manage progress mode'),
  ('projects.view_execution_dashboard', 'projects', 'normal', 205, 'عرض لوحة التنفيذ',            'View execution dashboard'),
  ('projects.view_execution_reports',   'projects', 'normal', 210, 'عرض تقارير التنفيذ',          'View execution reports'),
  ('projects.export_execution_reports', 'projects', 'normal', 215, 'تصدير تقارير التنفيذ',        'Export execution reports'),
  ('projects.override_stage_readiness', 'projects', 'sensitive', 220, 'تجاوز جاهزية المرحلة',     'Override stage readiness'),
  ('tasks.view_team_performance',       'tasks',    'normal', 160, 'عرض أداء الفريق',             'View team performance'),
  ('alerts.manage_project_alerts',      'projects', 'normal', 225, 'إدارة تنبيهات المشروع',       'Manage project alerts')
on conflict (key) do update set category=excluded.category, label_ar=excluded.label_ar, label_en=excluded.label_en, sort_order=excluded.sort_order;

-- ═══ 11) Grants ═══
do $g$
begin
  execute 'grant execute on function public.project_task_progress(uuid) to authenticated';
  execute 'grant execute on function public.project_progress_snapshot(uuid) to authenticated';
  execute 'grant execute on function public.project_core_set_progress_mode(uuid,text,text) to authenticated';
  execute 'grant execute on function public.project_execution_health(uuid) to authenticated';
  execute 'grant execute on function public.project_stage_readiness(uuid) to authenticated';
  execute 'grant execute on function public.project_execution_dashboard(uuid) to authenticated';
  execute 'grant execute on function public.project_alerts(uuid) to authenticated';
  -- pc_task_alerts_scan تُستدعى بمفتاح الخدمة من Cron فقط.
  execute 'revoke all on function public.pc_task_alerts_scan() from public, anon, authenticated';
end $g$;

-- ═══ 12) تشخيص ═══
do $d$
declare v_mode int; v_default text;
begin
  select count(*) into v_mode from information_schema.columns where table_schema='public' and table_name='project_core' and column_name='progress_mode';
  select column_default into v_default from information_schema.columns where table_schema='public' and table_name='project_core' and column_name='progress_mode';
  raise notice 'batch3c: progress_mode col=%/1, default=%, snapshot fn=%, health fn=%, alerts_scan fn=%',
    v_mode, v_default,
    (to_regprocedure('public.project_progress_snapshot(uuid)') is not null),
    (to_regprocedure('public.project_execution_health(uuid)') is not null),
    (to_regprocedure('public.pc_task_alerts_scan()') is not null);
  if v_mode <> 1 then raise exception 'progress_mode لم يُضَف'; end if;
  if v_default not like '%lifecycle%' then raise exception 'progress_mode الافتراضي ليس lifecycle (%)!', v_default; end if;
end $d$;

commit;

notify pgrst, 'reload schema';

-- ── تحقّق اختياري بعد الـcommit ──
--   select public.project_progress_snapshot('<PID>');   -- lifecycle للمشاريع الحالية
--   select public.project_execution_dashboard('<PID>');
--   select public.pc_task_alerts_scan();
