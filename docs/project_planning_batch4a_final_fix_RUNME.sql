-- ════════════════════════════════════════════════════════════════════════════
-- project_planning_batch4a_final_fix_RUNME.sql
-- الإصلاح النهائي المعماري لتبويب «المخطط الزمني» — استبدال المسار الهش كليًا
-- ────────────────────────────────────────────────────────────────────────────
-- السبب المعماري:
--   مسار القراءة القديم project_gantt_snapshot → (RPC متداخل) project_critical_path،
--   و project_schedule_preview، يبني الحالة عبر CREATE TEMPORARY TABLE. الجداول المؤقتة
--   تعتمد على معاملة قابلة للكتابة وعلى حالة الجلسة/الاتصال — مزيج هشّ تحت اتصالات
--   PostgREST المجمّعة وتنفيذ STABLE للقراءة-فقط. وحتى بعد جعل الدوال VOLATILE، فإن أي
--   خطأ Runtime غير معزول في السلسلة المتداخلة (أو معامل ? / التحويل / الـjoin في استعلام
--   المهام غير المعزول) يُفشل اللقطة بأكملها.
--
-- الحل: إزالة الاعتماد على الجداول المؤقتة والـRPC المتداخل من مسار القراءة نهائيًا،
--   وعزل حساب المسار الحرج (اختياري) بحيث لا يستطيع كسر المخطط أبدًا:
--     • project_critical_path_v2(uuid)                 — CPM بمصفوفات في الذاكرة، بلا جداول مؤقتة (داخلية).
--     • project_schedule_preview_v2(uuid)              — Forward pass بمصفوفات، بلا جداول مؤقتة (عام).
--     • project_gantt_snapshot_core(uuid,boolean)      — يبني اللقطة بـCTE/JSON فقط، يعزل المسار الحرج (داخلية).
--     • project_gantt_snapshot_v2(uuid,boolean)        — بوابة صلاحية ثم يستدعي Core (عام، توقيع واحد بلا Default).
--     • project_gantt_snapshot(uuid,boolean)           — يُعاد تعريفها Wrapper توافقي بسيط (Deprecated) يستدعي V2.
--   جميعها STABLE وتعمل داخل معاملة قراءة-فقط (لا تعتمد على معاملة قابلة للكتابة).
--
-- قيود: Additive · Idempotent · بلا DROP FUNCTION · بلا حذف بيانات · بلا جداول مؤقتة في
--   دوال Runtime · لا يمسّ core_stage/progress/المالي/Zoho/العهدة · داخل Transaction ·
--   اختبار ذاتي يُلغي المعاملة تلقائيًا عند الفشل · notify pgrst.
-- الدوال القديمة project_critical_path/project_schedule_preview تبقى (Deprecated، يستخدمها
--   project_schedule_apply في سياق كتابة آمن) — الواجهة الحديثة لا تعتمد عليها.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ §0) Preflight: الأساس (4A) مطبّق ═══
do $pf$
begin
  if to_regprocedure('public.working_days_between(date,date)') is null
     or to_regprocedure('public.add_working_days(date,integer)') is null
     or to_regclass('public.planning_calendar_settings') is null
     or to_regprocedure('public.pc_can_read_project(uuid)') is null then
    raise exception 'الأساس مفقود — شغّل docs/project_planning_batch4a_RUNME.sql أولًا.';
  end if;
  if not exists (select 1 from information_schema.columns
      where table_schema='public' and table_name='project_tasks' and column_name='is_milestone') then
    raise exception 'أعمدة 4A مفقودة على project_tasks — شغّل docs/project_planning_batch4a_RUNME.sql أولًا.';
  end if;
end $pf$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) project_critical_path_v2 — CPM (ES/EF/LS/LF/Float) بمصفوفات في الذاكرة.
--     بلا CREATE TEMPORARY TABLE، بلا RPC متداخل. آمن للقراءة-فقط. داخلية (REVOKE).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_critical_path_v2(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[]; v_dur int[];
  v_es int[]; v_ef int[]; v_ls int[]; v_lf int[]; v_flt int[];
  v_e_task int[]; v_e_pred int[]; v_e_lag int[];
  v_n int; v_m int; v_i int; v_k int; v_iter int; v_changed boolean;
  v_cand int; v_proj_end int := 0; v_dep_ct int;
  v_crit jsonb; v_floats jsonb;
begin
  -- 1) المهام (غير محذوفة/غير ملغاة) إلى مصفوفات مفهرسة (index = ترتيب ثابت)
  select array_agg(id order by ord), array_agg(dur order by ord)
    into v_ids, v_dur
  from (
    select t.id,
      -- CPM يقيس المدة الفعلية للجدول الحالي: يُقدَّم working_days_between (فارق التواريخ) على
      -- duration_days المقصود. (بخلاف preview_v2 الذي يُقدّم duration_days لأنه يخطّط طول المهمة).
      -- فرق مقصود ومطابق للسلوك السابق — CPM يعكس الواقع، والجدولة تعكس المدة المخطّطة.
      greatest(coalesce(nullif(public.working_days_between(t.start_date, t.due_date),0), t.duration_days, 1), 1) as dur,
      row_number() over (order by t.sort_order nulls last, t.id) as ord
    from public.project_tasks t
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status <> 'cancelled'
  ) q;

  v_n := coalesce(array_length(v_ids,1), 0);
  if v_n = 0 then
    return jsonb_build_object('computable', false, 'critical_task_ids','[]'::jsonb,
      'task_floats','[]'::jsonb, 'total_duration', 0,
      'warnings', jsonb_build_array(jsonb_build_object('type','no_tasks','ar','لا مهام لحساب المسار الحرج')),
      'calculated_at', now());
  end if;

  -- 2) الحواف (FS/FF) بمواقع المصفوفة، lag>=0
  select array_agg(ti), array_agg(pi), array_agg(lg)
    into v_e_task, v_e_pred, v_e_lag
  from (
    select array_position(v_ids, d.task_id) as ti,
           array_position(v_ids, d.depends_on_task_id) as pi,
           greatest(coalesce(d.lag_days,0),0) as lg
    from public.task_dependencies d
    where d.dep_type in ('finish_to_start','finish_to_finish')
      and array_position(v_ids, d.task_id) is not null
      and array_position(v_ids, d.depends_on_task_id) is not null
  ) e;
  v_m := coalesce(array_length(v_e_task,1), 0);
  v_dep_ct := v_m;

  -- تهيئة ES/EF
  v_es := array_fill(0, array[v_n]); v_ef := array_fill(0, array[v_n]);
  for v_i in 1..v_n loop v_ef[v_i] := v_es[v_i] + v_dur[v_i]; end loop;

  -- 3) Forward (longest-path relaxation)، حدّ آمن = v_n+1 (يمنع الحلقات اللانهائية)
  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_changed := false;
    for v_k in 1..greatest(v_m,0) loop
      v_cand := v_ef[v_e_pred[v_k]] + v_e_lag[v_k];
      if v_cand > v_es[v_e_task[v_k]] then
        v_es[v_e_task[v_k]] := v_cand;
        v_ef[v_e_task[v_k]] := v_cand + v_dur[v_e_task[v_k]];
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_iter > v_n + 1;
  end loop;

  for v_i in 1..v_n loop if v_ef[v_i] > v_proj_end then v_proj_end := v_ef[v_i]; end if; end loop;

  -- تهيئة LF/LS ثم Backward
  v_lf := array_fill(v_proj_end, array[v_n]); v_ls := array_fill(0, array[v_n]);
  for v_i in 1..v_n loop v_ls[v_i] := v_lf[v_i] - v_dur[v_i]; end loop;
  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_changed := false;
    for v_k in 1..greatest(v_m,0) loop
      v_cand := v_ls[v_e_task[v_k]] - v_e_lag[v_k];
      if v_cand < v_lf[v_e_pred[v_k]] then
        v_lf[v_e_pred[v_k]] := v_cand;
        v_ls[v_e_pred[v_k]] := v_cand - v_dur[v_e_pred[v_k]];
        v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_iter > v_n + 1;
  end loop;

  -- 4) Floats + المجموعة الحرجة
  v_flt := array_fill(0, array[v_n]);
  for v_i in 1..v_n loop v_flt[v_i] := v_ls[v_i] - v_es[v_i]; end loop;

  select
    coalesce(jsonb_agg(to_jsonb(v_ids[i])) filter (where v_flt[i] <= 0 and v_dep_ct > 0), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('task_id', v_ids[i], 'float', v_flt[i])), '[]'::jsonb)
    into v_crit, v_floats
  from generate_series(1, v_n) as g(i);

  return jsonb_build_object(
    'computable', (v_dep_ct > 0),
    'critical_task_ids', coalesce(v_crit,'[]'::jsonb),
    'task_floats', coalesce(v_floats,'[]'::jsonb),
    'total_duration', v_proj_end,
    'warnings', case when v_dep_ct = 0
      then jsonb_build_array(jsonb_build_object('type','no_dependencies','ar','لا اعتماديات كافية — المسار الحرج غير دقيق'))
      else '[]'::jsonb end,
    'calculated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) project_schedule_preview_v2 — Forward pass (تقويم عمل، deps+lag+قيود، auto فقط)
--     بمصفوفات في الذاكرة، بلا جداول مؤقتة. لا يحفظ شيئًا. عام (بوابة صلاحية).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_schedule_preview_v2(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_ids uuid[]; v_ms boolean[]; v_mode text[]; v_ct text[]; v_cd date[];
  v_dur int[]; v_s0 date[]; v_e0 date[]; v_s date[]; v_e date[]; v_status text[];
  v_e_task int[]; v_e_pred int[]; v_e_type text[]; v_e_lag int[];
  v_n int; v_m int; v_i int; v_k int; v_iter int; v_changed boolean;
  v_proj_start date; v_start date; v_end date; v_dur_i int; v_cand date;
  v_warn jsonb := '[]'::jsonb; v_tasks jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;

  select array_agg(id order by ord), array_agg(is_milestone order by ord), array_agg(scheduling_mode order by ord),
         array_agg(constraint_type order by ord), array_agg(constraint_date order by ord), array_agg(dur order by ord),
         array_agg(s0 order by ord), array_agg(e0 order by ord), array_agg(s0 order by ord), array_agg(e0 order by ord),
         array_agg(status order by ord)
    into v_ids, v_ms, v_mode, v_ct, v_cd, v_dur, v_s0, v_e0, v_s, v_e, v_status
  from (
    select t.id, coalesce(t.is_milestone,false) as is_milestone, coalesce(t.scheduling_mode,'manual') as scheduling_mode,
      t.constraint_type, t.constraint_date,
      -- الجدولة تُقدّم duration_days المقصود (طول المهمة المخطّط) على فارق التواريخ الحالي — مطابق للسلوك السابق.
      greatest(coalesce(t.duration_days, nullif(public.working_days_between(t.start_date,t.due_date),0), 1),1) as dur,
      t.start_date as s0, t.due_date as e0, t.status,
      row_number() over (order by t.sort_order nulls last, t.id) as ord
    from public.project_tasks t
    where t.project_id=p_project and coalesce(t.is_deleted,false)=false and t.status not in ('cancelled')
  ) q;

  v_n := coalesce(array_length(v_ids,1),0);
  if v_n = 0 then
    return jsonb_build_object('project_id', p_project, 'tasks','[]'::jsonb, 'warnings','[]'::jsonb, 'calculated_at', now());
  end if;

  select coalesce(min(s), (now() at time zone 'utc')::date) into v_proj_start from unnest(v_s0) s where s is not null;

  select array_agg(ti), array_agg(pi), array_agg(ty), array_agg(lg)
    into v_e_task, v_e_pred, v_e_type, v_e_lag
  from (
    select array_position(v_ids, d.task_id) ti, array_position(v_ids, d.depends_on_task_id) pi,
           d.dep_type ty, greatest(coalesce(d.lag_days,0),0) lg
    from public.task_dependencies d
    where array_position(v_ids, d.task_id) is not null and array_position(v_ids, d.depends_on_task_id) is not null
  ) e;
  v_m := coalesce(array_length(v_e_task,1),0);

  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_changed := false;
    for v_i in 1..v_n loop
      continue when v_mode[v_i] <> 'auto' or v_status[v_i] = 'done';
      v_dur_i := case when v_ms[v_i] then 0 else greatest(v_dur[v_i],1) end;
      v_start := coalesce(v_s[v_i], v_proj_start);
      -- FS: تبدأ بعد نهاية السابقة + lag+1
      v_cand := null;
      for v_k in 1..greatest(v_m,0) loop
        if v_e_task[v_k]=v_i and v_e_type[v_k]='finish_to_start' and v_e[v_e_pred[v_k]] is not null
          then v_cand := greatest(v_cand, public.add_working_days(v_e[v_e_pred[v_k]], v_e_lag[v_k] + 1)); end if;
      end loop;
      if v_cand is not null then v_start := greatest(v_start, v_cand); end if;
      -- SS
      v_cand := null;
      for v_k in 1..greatest(v_m,0) loop
        if v_e_task[v_k]=v_i and v_e_type[v_k]='start_to_start' and v_s[v_e_pred[v_k]] is not null
          then v_cand := greatest(v_cand, public.add_working_days(v_s[v_e_pred[v_k]], v_e_lag[v_k])); end if;
      end loop;
      if v_cand is not null then v_start := greatest(v_start, v_cand); end if;
      -- قيود البداية
      if v_ct[v_i]='must_start_on' and v_cd[v_i] is not null then v_start := v_cd[v_i];
      elsif v_ct[v_i]='start_no_earlier_than' and v_cd[v_i] is not null then v_start := greatest(v_start, v_cd[v_i]); end if;
      v_start := public.add_working_days(v_start, 0);
      v_end := case when v_dur_i=0 then v_start else public.add_working_days(v_start, v_dur_i-1) end;
      -- FF
      v_cand := null;
      for v_k in 1..greatest(v_m,0) loop
        if v_e_task[v_k]=v_i and v_e_type[v_k]='finish_to_finish' and v_e[v_e_pred[v_k]] is not null
          then v_cand := greatest(v_cand, public.add_working_days(v_e[v_e_pred[v_k]], v_e_lag[v_k])); end if;
      end loop;
      if v_cand is not null and v_end < v_cand then v_end := v_cand;
        v_start := case when v_dur_i=0 then v_end else public.add_working_days(v_end, -(v_dur_i-1)) end; end if;
      -- SF
      v_cand := null;
      for v_k in 1..greatest(v_m,0) loop
        if v_e_task[v_k]=v_i and v_e_type[v_k]='start_to_finish' and v_s[v_e_pred[v_k]] is not null
          then v_cand := greatest(v_cand, public.add_working_days(v_s[v_e_pred[v_k]], v_e_lag[v_k])); end if;
      end loop;
      if v_cand is not null and v_end < v_cand then v_end := v_cand; end if;
      -- قيود النهاية
      if v_ct[v_i]='must_finish_on' and v_cd[v_i] is not null then v_end := v_cd[v_i];
      elsif v_ct[v_i]='finish_no_later_than' and v_cd[v_i] is not null and v_end > v_cd[v_i] then
        v_warn := v_warn || jsonb_build_object('task_id', v_ids[v_i], 'type','constraint_violation','ar','تعذّر احترام «finish_no_later_than»');
      end if;
      if (v_s[v_i] is distinct from v_start) or (v_e[v_i] is distinct from v_end) then
        v_s[v_i] := v_start; v_e[v_i] := v_end; v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_iter > v_n + 1;
  end loop;
  if v_iter > v_n + 1 then v_warn := v_warn || jsonb_build_object('type','not_converged','ar','قد توجد حلقة أو قيود متعارضة'); end if;

  select v_warn || coalesce(jsonb_agg(jsonb_build_object('task_id', v_ids[i], 'type','missing_dates','ar','مهمة بلا بداية/مدة'))
      filter (where v_mode[i]='auto' and v_status[i]<>'done' and v_s[i] is null), '[]'::jsonb)
    into v_warn from generate_series(1,v_n) as g(i);

  select coalesce(jsonb_agg(jsonb_build_object('id', v_ids[i], 'current_start', v_s0[i], 'current_end', v_e0[i],
       'planned_start', v_s[i], 'planned_end', v_e[i],
       'changed', (v_s0[i] is distinct from v_s[i] or v_e0[i] is distinct from v_e[i]))) filter (where v_mode[i]='auto'), '[]'::jsonb)
    into v_tasks from generate_series(1,v_n) as g(i);

  return jsonb_build_object('project_id', p_project, 'tasks', coalesce(v_tasks,'[]'::jsonb),
    'warnings', v_warn, 'calculated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) project_gantt_snapshot_core — يبني اللقطة كاملةً بـSELECT/JSON فقط (بلا جداول
--     مؤقتة، بلا RPC كتابة). يعزل المسار الحرج في BEGIN/EXCEPTION فلا يُفشل المخطط أبدًا.
--     عقد JSON ثابت: كل Array عبر coalesce '[]'، كل Object عبر coalesce '{}'، لا null.
--     داخلية: REVOKE من الجميع، تُستدعى فقط عبر سلسلة V2 (SECURITY DEFINER).
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_gantt_snapshot_core(p_project uuid, p_include_children boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_cp jsonb; v_crit_arr text[]; v_floats jsonb;
  v_tasks jsonb; v_deps jsonb; v_children jsonb := '[]'::jsonb;
  v_cal jsonb; v_proj jsonb; v_warn jsonb;
  v_today date := (now() at time zone 'utc')::date;
begin
  -- المسار الحرج معزول: أي خطأ فيه يُنتج قيمة آمنة ولا يُسقط اللقطة.
  begin
    v_cp := public.project_critical_path_v2(p_project);
  exception when others then
    v_cp := null;
  end;
  if v_cp is null or jsonb_typeof(v_cp) <> 'object' then
    v_cp := jsonb_build_object('computable', false, 'critical_task_ids','[]'::jsonb, 'task_floats','[]'::jsonb,
      'total_duration', 0,
      'warnings', jsonb_build_array(jsonb_build_object('type','critical_path_error','ar','تعذّر حساب المسار الحرج — عُرِضت المهام دونه')),
      'calculated_at', now());
  end if;
  -- مجموعة حرجة كـtext[] (بلا معامل ? الهش) + خريطة floats للبحث السريع
  select array(select jsonb_array_elements_text(coalesce(v_cp->'critical_task_ids','[]'::jsonb))) into v_crit_arr;
  select coalesce(jsonb_object_agg(x->>'task_id', x->'float'), '{}'::jsonb)
    into v_floats from jsonb_array_elements(coalesce(v_cp->'task_floats','[]'::jsonb)) x;

  -- المهام (دائمًا Array). critical/float مشتقّان بأمان.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.title, 'parent_task_id', t.parent_task_id, 'status', t.status, 'priority', t.priority,
    'assignee_id', t.assignee_id, 'assignee', coalesce(pr.full_name, pr.email), 'progress_pct', coalesce(t.progress_pct,0),
    'start', t.start_date, 'end', t.due_date, 'is_milestone', coalesce(t.is_milestone,false),
    'scheduling_mode', coalesce(t.scheduling_mode,'manual'),
    'constraint_type', t.constraint_type, 'constraint_date', t.constraint_date, 'duration_days', t.duration_days,
    'version', coalesce(t.version,0), 'baseline_start', t.baseline_start, 'baseline_end', t.baseline_end,
    'baseline_variance_days', case when t.baseline_end is not null and t.due_date is not null then (t.due_date - t.baseline_end) end,
    'overdue', (t.due_date is not null and t.due_date < v_today and t.status not in ('done','cancelled')),
    'critical', (t.id::text = any(v_crit_arr)),
    'float', (v_floats->>(t.id::text))::int)
    order by t.sort_order nulls last, t.start_date nulls last, t.id), '[]'::jsonb)
  into v_tasks
  from public.project_tasks t
  left join public.profiles pr on pr.id = t.assignee_id
  where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status <> 'cancelled';

  -- الاعتماديات (دائمًا Array)
  select coalesce(jsonb_agg(jsonb_build_object('task_id', d.task_id, 'depends_on', d.depends_on_task_id,
     'type', d.dep_type, 'lag_days', coalesce(d.lag_days,0))), '[]'::jsonb)
  into v_deps
  from public.task_dependencies d join public.project_tasks t on t.id = d.task_id
  where t.project_id = p_project and coalesce(t.is_deleted,false)=false;

  -- التقويم (دائمًا Object)
  select coalesce(jsonb_build_object('work_days', work_days, 'holidays', holidays, 'timezone', timezone), '{}'::jsonb)
    into v_cal from public.planning_calendar_settings where id = 1;
  if v_cal is null then v_cal := '{}'::jsonb; end if;

  -- المشروع (دائمًا Object)
  select coalesce(jsonb_build_object('id', p.id, 'name', p.project_name,
     'start_date', p.start_date, 'due_date', p.due_date, 'status', p.status), '{}'::jsonb)
    into v_proj from public.projects p where p.id = p_project;
  if v_proj is null then v_proj := '{}'::jsonb; end if;

  -- تحذيرات المشروع: مهام بلا تواريخ (لا تمنع تحميل بقية المهام)
  select coalesce(jsonb_agg(jsonb_build_object('type','missing_dates','task_id', t.id,
     'ar','مهمة بلا تواريخ — لن تظهر على المخطط')), '[]'::jsonb)
    into v_warn from public.project_tasks t
    where t.project_id=p_project and coalesce(t.is_deleted,false)=false and t.status<>'cancelled'
      and (t.start_date is null or t.due_date is null);

  -- الأبناء (اختياري)
  if coalesce(p_include_children,false) then
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.project_name,
        'start', (select min(start_date) from public.project_tasks ct where ct.project_id=c.id and coalesce(ct.is_deleted,false)=false),
        'end',   (select max(due_date)   from public.project_tasks ct where ct.project_id=c.id and coalesce(ct.is_deleted,false)=false))), '[]'::jsonb)
      into v_children from public.projects c
      where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false;
  end if;

  return jsonb_build_object(
    'project', v_proj,
    'tasks', coalesce(v_tasks,'[]'::jsonb),
    'dependencies', coalesce(v_deps,'[]'::jsonb),
    'calendar', v_cal,
    'critical_path', v_cp,
    'children', coalesce(v_children,'[]'::jsonb),
    'warnings', coalesce(v_warn,'[]'::jsonb),
    'today', v_today,
    'generated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) project_gantt_snapshot_v2 — عام: بوابة صلاحية ثم Core. توقيع واحد بلا Default.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_gantt_snapshot_v2(p_project uuid, p_include_children boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  return public.project_gantt_snapshot_core(p_project, coalesce(p_include_children, false));
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) Wrapper توافقي (DEPRECATED) — يُعاد تعريف الدالة القديمة لتستدعي V2 (بلا جداول
--     مؤقتة). التوقيع كما هو (لا Overload جديد). الواجهة الحديثة لا تعتمد عليها.
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.project_gantt_snapshot(p_project uuid, p_include_children boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  -- DEPRECATED: أُبقيت للتوافق فقط؛ تفوّض إلى المسار الآمن V2.
  return public.project_gantt_snapshot_v2(p_project, coalesce(p_include_children, false));
end $$;

-- ═══ §6) الصلاحيات: عام لـV2/preview_v2 (authenticated)؛ الداخلية REVOKE من الجميع ═══
revoke execute on function public.project_critical_path_v2(uuid)               from public, anon, authenticated;
revoke execute on function public.project_gantt_snapshot_core(uuid, boolean)   from public, anon, authenticated;

revoke execute on function public.project_gantt_snapshot_v2(uuid, boolean)     from public, anon;
grant  execute on function public.project_gantt_snapshot_v2(uuid, boolean)     to authenticated;
revoke execute on function public.project_schedule_preview_v2(uuid)            from public, anon;
grant  execute on function public.project_schedule_preview_v2(uuid)            to authenticated;
revoke execute on function public.project_gantt_snapshot(uuid, boolean)        from public, anon;
grant  execute on function public.project_gantt_snapshot(uuid, boolean)        to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) اختبار ذاتي — يستدعي Core مباشرة (بلا اعتماد على auth.uid())، يتحقّق من عقد JSON،
--     ويرفع Exception فيُلغى Transaction بأكمله (rollback) عند أي فشل.
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_id uuid; v_res jsonb; v_cp jsonb;
begin
  select id into v_id from public.projects
    where coalesce(is_deleted,false)=false
    order by (project_name ilike '%تست 01%') desc, id
    limit 1;

  if v_id is null then
    raise notice 'final_fix: لا مشروع غير محذوف للاختبار — تُخطّي الاختبار الذاتي (بلا فشل).';
    return;
  end if;

  v_res := public.project_gantt_snapshot_core(v_id, false);

  if v_res is null or jsonb_typeof(v_res) <> 'object'            then raise exception 'final_fix FAIL: اللقطة ليست jsonb object'; end if;
  if jsonb_typeof(v_res->'tasks')         <> 'array'            then raise exception 'final_fix FAIL: tasks ليست array (%)', jsonb_typeof(v_res->'tasks'); end if;
  if jsonb_typeof(v_res->'dependencies')  <> 'array'            then raise exception 'final_fix FAIL: dependencies ليست array'; end if;
  if jsonb_typeof(v_res->'warnings')      <> 'array'            then raise exception 'final_fix FAIL: warnings ليست array'; end if;
  if jsonb_typeof(v_res->'calendar')      <> 'object'           then raise exception 'final_fix FAIL: calendar ليست object'; end if;
  if jsonb_typeof(v_res->'project')       <> 'object'           then raise exception 'final_fix FAIL: project ليست object'; end if;
  if jsonb_typeof(v_res->'critical_path') <> 'object'           then raise exception 'final_fix FAIL: critical_path ليست object'; end if;
  if jsonb_typeof(v_res->'critical_path'->'critical_task_ids') <> 'array' then raise exception 'final_fix FAIL: critical_task_ids ليست array'; end if;
  if jsonb_typeof(v_res->'critical_path'->'task_floats')       <> 'array' then raise exception 'final_fix FAIL: task_floats ليست array'; end if;
  if (v_res->'critical_path'->>'computable') is null            then raise exception 'final_fix FAIL: computable مفقود'; end if;
  if (v_res->>'generated_at') is null                          then raise exception 'final_fix FAIL: generated_at مفقود'; end if;

  v_cp := public.project_critical_path_v2(v_id);
  if v_cp is null or jsonb_typeof(v_cp) <> 'object'            then raise exception 'final_fix FAIL: critical_path_v2 ليست object'; end if;

  raise notice 'final_fix ✅ نجح الاختبار الذاتي — project=% tasks=% deps=% warnings=% computable=%',
    v_id, jsonb_array_length(v_res->'tasks'), jsonb_array_length(v_res->'dependencies'),
    jsonb_array_length(v_res->'warnings'), (v_res->'critical_path'->>'computable');
end $selftest$;

commit;

-- ═══ §8) إعادة تحميل مخطط PostgREST ═══
notify pgrst, 'reload schema';
