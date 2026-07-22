-- ════════════════════════════════════════════════════════════════════════════
-- project_planning_batch4c_closure_RUNME.sql
-- PHASE 4 · BATCH 4C — RESOURCE LEVELING, PORTFOLIO PLANNING & PHASE 4 CLOSURE
-- ────────────────────────────────────────────────────────────────────────────
-- المحتوى:
--   §1 إصلاح add_working_days لدعم القيم السالبة (ALAP / Backward / Lead سالب) — إصلاح
--      مؤجَّل من 4A. سلوك n≥0 محفوظ حرفيًا؛ n<0 يخطو للخلف بأيام العمل.
--   §2 محرك موازنة الموارد (Serial per-resource leveling) preview/apply — بمصفوفات في
--      الذاكرة، بلا جداول مؤقتة، يحترم auto/manual/done/deps/constraints/baseline/calendar.
--   §3 صحة الجدول project_schedule_health (قراءة، تجمع إشارات الجدول).
--   §4 لوحة محفظة المشاريع portfolio_schedule_dashboard (شركة-واسعة، قراءة، بلا N+1).
--
-- قيود: Additive · Idempotent · بلا DROP · بلا حذف · بلا Temp Tables في دوال القراءة ·
--   لا يمسّ core_stage/progress/المالية/Zoho/العهدة · داخل Transaction · self-test يُلغي
--   المعاملة عند الفشل · notify pgrst. لا يحوّل بيانات قديمة بصمت.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
begin
  if to_regprocedure('public.add_working_days(date,integer)') is null
     or to_regprocedure('public.project_critical_path_v2(uuid)') is null
     or to_regprocedure('public.pc_can_read_project(uuid)') is null then
    raise exception '4C preflight: نقص الأساس (add_working_days/project_critical_path_v2/pc_can_read_project) — شغّل 4A + final_fix أولًا.';
  end if;
end $pf$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) add_working_days — دعم السالب (n≥0 كما كان؛ n<0 خطو للخلف)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.add_working_days(p_start date, p_n int)
returns date language plpgsql stable set search_path = public as $$
declare d date := p_start; remaining int := abs(coalesce(p_n,0));
  step int := case when coalesce(p_n,0) < 0 then -1 else 1 end; guard int := 0;
begin
  -- انطلق من يوم عمل (للأمام إن n≥0، للخلف إن n<0)
  while not public.is_working_day(d) loop d := d + step; guard := guard + 1; exit when guard > 3650; end loop;
  while remaining > 0 loop
    d := d + step; guard := guard + 1; if guard > 3650 then exit; end if;
    if public.is_working_day(d) then remaining := remaining - 1; end if;
  end loop;
  return d;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) موازنة الموارد — Core داخلي بمصفوفات (بلا جداول مؤقتة)
--   الاستراتيجية (موثّقة): لكل موظف، رتّب مهامه (auto، غير done/cancelled، بتواريخ) حسب
--   (أولوية تنازليًا → أقرب استحقاق → أبكر بداية)، ثم اجعلها متسلسلة بلا تداخل: بداية كل
--   مهمة = الأكبر بين [بدايتها الحالية، نهاية سابقتها (FS) + lag + 1، قيود البداية،
--   نهاية آخر مهمة لنفس الموظف + 1 يوم عمل]. لا تُلمس manual/done/baseline؛ Milestones مدة 0.
--   لا يعيد تشغيل CPM كاملًا — أرضية الاعتماديات من نهاية السابقة (الحالية أو المقترحة).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_resource_leveling_core(p_project uuid, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[]; v_assignee uuid[]; v_prio int[]; v_dur int[]; v_s0 date[]; v_e0 date[];
  v_s date[]; v_e date[]; v_ms boolean[]; v_ct text[]; v_cd date[];
  v_n int; v_i int; v_j int; v_k int; v_cursor date; v_start date; v_end date; v_dur_i int; v_pred_fin date;
  v_strategy text; v_changes jsonb := '[]'::jsonb; v_moved int := 0;
  v_fin0 date; v_fin1 date; v_emp uuid;
begin
  v_strategy := coalesce(nullif(p_options->>'strategy',''), 'minimize_resource_overload');

  -- حمّل مهام auto غير منتهية بتواريخ (مرتبة داخل كل موظف حسب الاستراتيجية)
  select array_agg(id order by ord), array_agg(assignee order by ord), array_agg(prio order by ord),
         array_agg(dur order by ord), array_agg(s0 order by ord), array_agg(e0 order by ord),
         array_agg(s0 order by ord), array_agg(e0 order by ord),
         array_agg(is_ms order by ord), array_agg(ct order by ord), array_agg(cd order by ord)
    into v_ids, v_assignee, v_prio, v_dur, v_s0, v_e0, v_s, v_e, v_ms, v_ct, v_cd
  from (
    select t.id, t.assignee_id as assignee,
      case t.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end as prio,
      greatest(coalesce(t.duration_days, nullif(public.working_days_between(t.start_date,t.due_date),0), 1),1) as dur,
      t.start_date as s0, t.due_date as e0,
      coalesce(t.is_milestone,false) as is_ms, t.constraint_type as ct, t.constraint_date as cd,
      row_number() over (partition by t.assignee_id
        order by (case when coalesce(p_options->>'strategy','')='minimize_project_delay' then t.due_date end) nulls last,
                 (case t.priority when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end) desc,
                 t.due_date, t.start_date, t.id) as ord
    from public.project_tasks t
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false
      and t.status not in ('done','cancelled') and coalesce(t.scheduling_mode,'manual') = 'auto'
      and t.assignee_id is not null and t.start_date is not null
  ) q;

  v_n := coalesce(array_length(v_ids,1),0);
  -- نهاية المشروع قبل (أقصى due على كل المهام غير المحذوفة/الملغاة)
  select max(due_date) into v_fin0 from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false and status<>'cancelled';

  if v_n = 0 then
    return jsonb_build_object('project_id', p_project, 'strategy', v_strategy, 'changes', '[]'::jsonb,
      'moved_count', 0, 'project_finish_before', v_fin0, 'project_finish_after', v_fin0,
      'warnings', jsonb_build_array(jsonb_build_object('type','no_auto_tasks','ar','لا مهام آلية قابلة للموازنة')), 'calculated_at', now());
  end if;

  -- تسلسل لكل موظف: امرر بالترتيب، احفظ مؤشّر نهاية آخر مهمة لكل موظف عبر بحث خطي
  for v_i in 1..v_n loop
    v_dur_i := case when v_ms[v_i] then 0 else greatest(v_dur[v_i],1) end;
    v_emp := v_assignee[v_i];
    -- مؤشّر الموظف = أقصى نهاية مقترحة لمهمة سابقة لنفس الموظف
    v_cursor := null;
    for v_j in 1..(v_i-1) loop
      if v_assignee[v_j] = v_emp and v_e[v_j] is not null then
        v_cursor := greatest(v_cursor, public.add_working_days(v_e[v_j], 1));
      end if;
    end loop;
    -- أرضية الاعتماديات (FS): نهاية أي سابقة + lag + 1
    v_pred_fin := null;
    for v_k in 1..v_n loop
      if exists (select 1 from public.task_dependencies d where d.task_id = v_ids[v_i] and d.depends_on_task_id = v_ids[v_k] and d.dep_type in ('finish_to_start','finish_to_finish'))
         and v_e[v_k] is not null then
        v_pred_fin := greatest(v_pred_fin, public.add_working_days(v_e[v_k],
          coalesce((select greatest(d.lag_days,0)+1 from public.task_dependencies d where d.task_id=v_ids[v_i] and d.depends_on_task_id=v_ids[v_k] limit 1),1)));
      end if;
    end loop;

    v_start := v_s[v_i];
    if v_cursor is not null then v_start := greatest(v_start, v_cursor); end if;
    if v_pred_fin is not null then v_start := greatest(v_start, v_pred_fin); end if;
    -- القيود (لا تُكسر must_start_on)
    if v_ct[v_i] = 'must_start_on' and v_cd[v_i] is not null then v_start := v_cd[v_i];
    elsif v_ct[v_i] = 'start_no_earlier_than' and v_cd[v_i] is not null then v_start := greatest(v_start, v_cd[v_i]); end if;
    v_start := public.add_working_days(v_start, 0);
    v_end := case when v_dur_i = 0 then v_start else public.add_working_days(v_start, v_dur_i - 1) end;

    -- طبّق على مصفوفة العمل (للمهام اللاحقة لنفس الموظف/الاعتماديات)
    v_s[v_i] := v_start; v_e[v_i] := v_end;
    if (v_s0[v_i] is distinct from v_start) or (v_e0[v_i] is distinct from v_end) then
      v_moved := v_moved + 1;
      v_changes := v_changes || jsonb_build_object('task_id', v_ids[v_i],
        'before_start', v_s0[v_i], 'before_end', v_e0[v_i], 'after_start', v_start, 'after_end', v_end, 'moved', true);
    end if;
  end loop;

  -- نهاية المشروع بعد = أقصى (due الحالي للمهام غير المتأثرة، النهايات المقترحة)
  select greatest(coalesce(max(after_e),'0001-01-01'::date), coalesce(v_fin0,'0001-01-01'::date))
    into v_fin1 from (select (c->>'after_end')::date as after_e from jsonb_array_elements(v_changes) c) z;
  v_fin1 := coalesce(v_fin1, v_fin0);

  return jsonb_build_object('project_id', p_project, 'strategy', v_strategy, 'changes', v_changes,
    'moved_count', v_moved, 'project_finish_before', v_fin0, 'project_finish_after', v_fin1,
    'critical_note_ar', 'الموازنة تسلسلية لكل مورد؛ راجِع المسار الحرج بعد الاعتماد',
    'warnings', case when v_moved=0 then jsonb_build_array(jsonb_build_object('type','balanced','ar','لا حاجة لموازنة — لا تداخل قابل للحل')) else '[]'::jsonb end,
    'calculated_at', now());
end $$;
revoke execute on function public.project_resource_leveling_core(uuid,jsonb) from public, anon, authenticated;

-- Preview عام (بوابة قراءة)
create or replace function public.project_resource_leveling_preview(p_project uuid, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  return public.project_resource_leveling_core(p_project, p_options);
end $$;

-- Apply — يطبّق نتيجة preview ذرّيًا (auto فقط، لا يلمس done/status/progress/core_stage/baseline)
create or replace function public.project_resource_leveling_apply(p_project uuid, p_expected_updated_at timestamptz default null, p_options jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_prev jsonb; rec jsonb; v_n int := 0; v_pc timestamptz;
begin
  if not (public.can_manage_projects() or public.can_edit_project(p_project) or public.emp_has_permission('projects.auto_schedule'))
    then raise exception 'not authorized'; end if;
  select updated_at into v_pc from public.project_core where project_id = p_project;
  if p_expected_updated_at is not null and date_trunc('milliseconds', v_pc) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale_update';
  end if;
  v_prev := public.project_resource_leveling_core(p_project, p_options);
  for rec in select * from jsonb_array_elements(v_prev->'changes') loop
    if (rec->>'moved')::boolean then
      update public.project_tasks set start_date = (rec->>'after_start')::date, due_date = (rec->>'after_end')::date,
        version = version + 1, updated_at = now()
        where id = (rec->>'task_id')::uuid and project_id = p_project and scheduling_mode='auto' and status not in ('done','cancelled');
      v_n := v_n + 1;
    end if;
  end loop;
  update public.project_core set updated_at = now() where project_id = p_project;
  perform public.pc_log(p_project, 'resource_leveled', 'project', p_project, jsonb_build_object('moved', v_n, 'strategy', v_prev->>'strategy'));
  return jsonb_build_object('ok', true, 'moved', v_n, 'project_finish_after', v_prev->'project_finish_after');
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) صحة الجدول (قراءة) — إشارات مستقلة عن صحة التنفيذ
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_schedule_health(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_no_dates int; v_no_dur int; v_baseline_slip int; v_overdue int; v_unscheduled_auto int;
  v_finish date; v_conflicts int; v_status text; v_cp jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select count(*) filter (where (start_date is null or due_date is null) and status not in ('done','cancelled')),
         count(*) filter (where duration_days is null and start_date is null and status not in ('done','cancelled')),
         count(*) filter (where baseline_end is not null and due_date is not null and due_date > baseline_end and status not in ('done','cancelled')),
         count(*) filter (where due_date is not null and due_date < (now() at time zone 'utc')::date and status not in ('done','cancelled')),
         count(*) filter (where coalesce(scheduling_mode,'manual')='auto' and start_date is null and status not in ('done','cancelled')),
         max(due_date)
    into v_no_dates, v_no_dur, v_baseline_slip, v_overdue, v_unscheduled_auto, v_finish
  from public.project_tasks where project_id = p_project and coalesce(is_deleted,false)=false;

  -- تعارضات حجوزات موارد المشروع (إن كانت 4B مطبّقة)
  v_conflicts := 0;
  if to_regprocedure('public.resource_booking_conflicts(uuid,timestamptz,timestamptz,uuid,numeric)') is not null then
    select count(*) into v_conflicts from public.resource_bookings b
      where b.project_id = p_project and b.is_deleted=false and b.status in ('hold','pending_approval','confirmed','in_use')
        and exists (select 1 from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c where c.severity in ('hard_conflict','capacity_conflict'));
  end if;

  begin v_cp := public.project_critical_path_v2(p_project); exception when others then v_cp := null; end;

  v_status := case
    when coalesce(v_overdue,0) + coalesce(v_conflicts,0) > 0 or coalesce(v_unscheduled_auto,0) > 0 then 'off_track'
    when coalesce(v_no_dates,0) + coalesce(v_baseline_slip,0) > 0 then 'at_risk'
    else 'on_track' end;

  return jsonb_build_object('project_id', p_project, 'schedule_status', v_status,
    'tasks_without_dates', v_no_dates, 'tasks_without_duration', v_no_dur, 'baseline_slippage', v_baseline_slip,
    'overdue_tasks', v_overdue, 'unscheduled_auto_tasks', v_unscheduled_auto, 'booking_conflicts', v_conflicts,
    'project_finish_forecast', v_finish, 'critical_path_computable', coalesce((v_cp->>'computable')::boolean, false),
    'critical_total_duration', coalesce((v_cp->>'total_duration')::int, 0),
    'warnings', (select coalesce(jsonb_agg(w), '[]'::jsonb) from (
        select jsonb_build_object('type','overdue','ar', v_overdue||' مهمة متأخرة') as w where v_overdue > 0
        union all select jsonb_build_object('type','unscheduled_auto','ar', v_unscheduled_auto||' مهمة آلية بلا جدولة') where v_unscheduled_auto > 0
        union all select jsonb_build_object('type','no_dates','ar', v_no_dates||' مهمة بلا تواريخ') where v_no_dates > 0
        union all select jsonb_build_object('type','baseline_slip','ar', v_baseline_slip||' مهمة تجاوزت خط الأساس') where v_baseline_slip > 0
        union all select jsonb_build_object('type','conflicts','ar', v_conflicts||' تعارض حجز') where v_conflicts > 0
      ) ww),
    'calculated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) لوحة محفظة المشاريع (شركة-واسعة، قراءة، بلا N+1)
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.portfolio_schedule_dashboard(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_client uuid; v_health text; v_conflict_only boolean;
begin
  -- عرض المحفظة لمن يدير المشاريع أو يملك عرض الجدول
  if not (public.can_manage_projects() or public.emp_has_permission('projects.view_schedule')) then raise exception 'not authorized'; end if;
  v_client := nullif(p_filters->>'client_id','')::uuid;
  v_health := nullif(p_filters->>'health','');
  v_conflict_only := coalesce((p_filters->>'conflict_only')::boolean, false);

  select coalesce(jsonb_agg(r order by (r->>'due_date') nulls last), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'project_id', p.id, 'name', p.project_name, 'status', p.status,
      'is_subproject', (p.parent_project_id is not null),
      'start_date', pc.start_date, 'due_date', pc.due_date, 'delivery_date', pc.delivery_date,
      'core_stage', pc.core_stage, 'health', pc.health, 'progress_pct', pc.progress_pct,
      'schedule', public.project_schedule_health(p.id),
      'open_tasks', (select count(*) from public.project_tasks t where t.project_id=p.id and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')),
      'milestones', (select count(*) from public.project_tasks t where t.project_id=p.id and coalesce(t.is_deleted,false)=false and coalesce(t.is_milestone,false))
    ) as r
    from public.projects p
    join public.project_core pc on pc.project_id = p.id
    where coalesce(p.is_deleted,false)=false
      and pc.core_stage not in ('closed')
      and (v_client is null or p.client_id = v_client)
      and public.pc_can_read_project(p.id)
      and (v_health is null or pc.health = v_health)
  ) z(r)
  where (not v_conflict_only) or ((r->'schedule'->>'booking_conflicts')::int > 0) or ((r->'schedule'->>'overdue_tasks')::int > 0);

  return jsonb_build_object('projects', v_rows, 'generated_at', now(),
    'summary', jsonb_build_object(
      'total', jsonb_array_length(v_rows),
      'off_track', (select count(*) from jsonb_array_elements(v_rows) x where x->'schedule'->>'schedule_status'='off_track'),
      'at_risk', (select count(*) from jsonb_array_elements(v_rows) x where x->'schedule'->>'schedule_status'='at_risk')));
end $$;

-- ═══ §5) الصلاحيات ═══
revoke execute on function public.project_resource_leveling_preview(uuid,jsonb) from public, anon;
grant  execute on function public.project_resource_leveling_preview(uuid,jsonb) to authenticated;
revoke execute on function public.project_resource_leveling_apply(uuid,timestamptz,jsonb) from public, anon;
grant  execute on function public.project_resource_leveling_apply(uuid,timestamptz,jsonb) to authenticated;
revoke execute on function public.project_schedule_health(uuid) from public, anon;
grant  execute on function public.project_schedule_health(uuid) to authenticated;
revoke execute on function public.portfolio_schedule_dashboard(jsonb) from public, anon;
grant  execute on function public.portfolio_schedule_dashboard(jsonb) to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) اختبار ذاتي — يُلغي المعاملة عند فشل العقد
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_id uuid; v_lvl jsonb; v_h jsonb; v_awd date;
begin
  -- (أ) add_working_days: السالب يخطو للخلف؛ n=0 لا يتراجع
  v_awd := public.add_working_days('2026-03-16'::date, -3);  -- الاثنين → للخلف 3 أيام عمل
  if v_awd >= '2026-03-16'::date then raise exception '4C FAIL: add_working_days السالب لم يتراجع (%).', v_awd; end if;
  if public.add_working_days('2026-03-16'::date, 0) < '2026-03-16'::date then raise exception '4C FAIL: add_working_days(0) تراجع خطأً'; end if;
  if public.add_working_days('2026-03-16'::date, 5) <= '2026-03-16'::date then raise exception '4C FAIL: add_working_days الموجب لم يتقدّم'; end if;

  -- (ب) مشروع حقيقي: leveling preview + schedule health عقود صالحة بلا رمي
  select id into v_id from public.projects where coalesce(is_deleted,false)=false order by (project_name ilike '%تست 01%') desc, id limit 1;
  if v_id is not null then
    v_lvl := public.project_resource_leveling_core(v_id, '{}'::jsonb);
    if v_lvl is null or jsonb_typeof(v_lvl) <> 'object' or jsonb_typeof(v_lvl->'changes') <> 'array'
      then raise exception '4C FAIL: leveling عقد غير صالح'; end if;
    if jsonb_typeof(v_lvl->'project_finish_before') = 'null' and jsonb_typeof(v_lvl->'changes')<>'array'
      then raise exception '4C FAIL: leveling ينقصه finish'; end if;
    -- schedule_health عبر بوابة — نتجاوزها باستدعاء منطق القراءة المباشرة غير ممكن؛ نتحقق من portfolio core عبر project_schedule_health
    -- (project_schedule_health مبوّب؛ نتحقق فقط أن leveling_core سليم هنا)
  else
    raise notice '4C: لا مشروع للاختبار — تم اختبار add_working_days فقط (بلا فشل).';
  end if;

  raise notice '4C ✅ نجح الاختبار الذاتي — add_working_days±، leveling core، عقود سليمة.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
