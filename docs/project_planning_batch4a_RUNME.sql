-- ════════════════════════════════════════════════════════════════════════════
-- project_planning_batch4a_RUNME.sql — PHASE 4 · BATCH 4A · Gantt & Scheduling Engine
--   Additive · Idempotent · NO DROP · NO data deletion · Production-safe.
-- ────────────────────────────────────────────────────────────────────────────
-- محرك تخطيط/جدولة فوق project_tasks القائم (لا نظام مهام/اعتماديات/مشاريع موازٍ).
--
-- مصدر الحقيقة للتواريخ = project_tasks.start_date / due_date (كما تقرؤها 3B/3C/الـboard/
--   التنبيهات). planned_start ≡ start_date، planned_end ≡ due_date (لا مجموعتان متعارضتان).
--
-- لا يمسّ: done · core_stage/Lifecycle/Timeline · progress_mode · Kanban/Workflow · مراجعات
--   المهام · Deliverables · parent_project_id · Phase B · Zoho · العهدة · /projects القديم ·
--   نظام project_schedule القديم (UnifiedGanttTab) يبقى مستقلًا.
--
-- المحتوى: §1 أعمدة تخطيط (milestone/scheduling_mode/constraint/baseline/duration) +
--   lag_days على الاعتماديات · §2 تقويم العمل (افتراضي Asia/Riyadh) + دوال أيام العمل ·
--   §3 محرك الجدولة (preview/apply) · §4 pc_task_reschedule · §5 المسار الحرج (CPM) ·
--   §6 Baseline · §7 project_gantt_snapshot (استدعاء واحد) · §8 صلاحيات · §9 فهارس · §10 تشخيص.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_tasks') is null then miss := miss||' project_tasks'; end if;
  if to_regclass('public.task_dependencies') is null then miss := miss||' task_dependencies (3B)'; end if;
  if to_regclass('public.permissions') is null then miss := miss||' permissions'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name='version')=0
    then miss := miss||' project_tasks.version (3B)'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)') is null then miss := miss||' pc_can_read_project'; end if;
  if to_regprocedure('public.emp_has_permission(text)') is null then miss := miss||' emp_has_permission'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)') is null then miss := miss||' pc_log'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%). شغّل Phase 3 أولًا.', miss; end if;
end $pf$;

begin;

-- ═══ 1) أعمدة التخطيط (Additive) + lag على الاعتماديات ═══
alter table public.project_tasks add column if not exists is_milestone     boolean not null default false;
alter table public.project_tasks add column if not exists scheduling_mode  text not null default 'manual';
alter table public.project_tasks add column if not exists constraint_type  text not null default 'as_soon_as_possible';
alter table public.project_tasks add column if not exists constraint_date  date;
alter table public.project_tasks add column if not exists duration_days    int;   -- أيام عمل؛ NULL ⇒ تُشتقّ من start..due
alter table public.project_tasks add column if not exists baseline_start   date;
alter table public.project_tasks add column if not exists baseline_end     date;
alter table public.project_tasks add column if not exists baseline_set_at  timestamptz;
alter table public.project_tasks add column if not exists baseline_set_by  uuid references auth.users(id) on delete set null;

alter table public.project_tasks drop constraint if exists project_tasks_sched_mode_chk;
alter table public.project_tasks add  constraint project_tasks_sched_mode_chk check (scheduling_mode in ('manual','auto'));
alter table public.project_tasks drop constraint if exists project_tasks_constraint_chk;
alter table public.project_tasks add  constraint project_tasks_constraint_chk check (constraint_type in
  ('as_soon_as_possible','as_late_as_possible','must_start_on','must_finish_on','start_no_earlier_than','finish_no_later_than'));
alter table public.project_tasks drop constraint if exists project_tasks_duration_chk;
alter table public.project_tasks add  constraint project_tasks_duration_chk check (duration_days is null or duration_days >= 0);

alter table public.task_dependencies add column if not exists lag_days int not null default 0;   -- موجب=Lag، سالب=Lead (أيام عمل)

-- ═══ 2) تقويم العمل (Foundation — افتراضي شركة؛ واجهة إدارة العطلات تُؤجَّل لـ4B) ═══
create table if not exists public.planning_calendar_settings (
  id           int primary key default 1 check (id = 1),
  work_days    boolean[] not null default '{true,true,true,true,true,false,false}',  -- الأحد(0)..السبت(6): عطلة الجمعة/السبت
  holidays     date[] not null default '{}',
  timezone     text not null default 'Asia/Riyadh',
  hours_per_day numeric not null default 8,
  updated_at   timestamptz not null default now(), updated_by uuid
);
insert into public.planning_calendar_settings(id) values (1) on conflict (id) do nothing;
alter table public.planning_calendar_settings enable row level security;
drop policy if exists pcal_read on public.planning_calendar_settings;
create policy pcal_read on public.planning_calendar_settings for select to authenticated using (true);
revoke insert, update, delete on public.planning_calendar_settings from authenticated, anon;
grant select on public.planning_calendar_settings to authenticated;

create or replace function public.is_working_day(p_d date)
returns boolean language sql stable set search_path = public as $$
  select coalesce((select work_days[extract(dow from p_d)::int + 1] and not (p_d = any(holidays))
                   from public.planning_calendar_settings where id = 1), extract(dow from p_d) not in (5,6));
$$;

-- أضف n أيام عمل إلى تاريخ (n=0 ⇒ أقرب يوم عمل ≥ اليوم). حدّ أمان 3650 خطوة.
create or replace function public.add_working_days(p_start date, p_n int)
returns date language plpgsql stable set search_path = public as $$
declare d date := p_start; steps int := 0; remaining int := greatest(p_n, 0); guard int := 0;
begin
  while not public.is_working_day(d) loop d := d + 1; guard := guard + 1; exit when guard > 3650; end loop;  -- انطلق من يوم عمل
  while remaining > 0 loop
    d := d + 1; guard := guard + 1; if guard > 3650 then exit; end if;
    if public.is_working_day(d) then remaining := remaining - 1; end if;
  end loop;
  return d;
end $$;

create or replace function public.working_days_between(p_a date, p_b date)
returns int language plpgsql stable set search_path = public as $$
declare d date; n int := 0; guard int := 0;
begin
  if p_a is null or p_b is null or p_b < p_a then return 0; end if;
  d := p_a;
  while d <= p_b loop if public.is_working_day(d) then n := n + 1; end if; d := d + 1; guard := guard + 1; exit when guard > 3650; end loop;
  return greatest(n, 0);
end $$;

-- ═══ 3) محرك الجدولة — Preview (Forward pass، تقويم عمل، deps+lag+قيود، auto فقط) ═══
--     يقرأ start_date/due_date كمصدر حقيقة؛ لا يحفظ. manual ثابتة. الملغاة/المحذوفة مُستبعدة.
create or replace function public.project_schedule_preview(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rec record; v_changed boolean; v_iter int := 0; v_max int; v_warn jsonb := '[]'::jsonb;
  v_start date; v_end date; v_dur int; v_cand date; v_proj_start date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  -- جدول عمل مؤقت للحساب (start/end الحاليان كنقطة انطلاق). drop-if-exists لأمان الاستدعاء المتعدّد بمعاملة واحدة.
  drop table if exists _sch;
  create temporary table _sch on commit drop as
  select t.id, t.parent_task_id, t.is_milestone, t.scheduling_mode, t.constraint_type, t.constraint_date,
    coalesce(t.duration_days, nullif(public.working_days_between(t.start_date, t.due_date),0), 1) as dur,
    t.start_date as s0, t.due_date as e0,
    t.start_date as s, t.due_date as e, t.status
  from public.project_tasks t
  where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status not in ('cancelled');

  select coalesce(min(s0), (now() at time zone 'utc')::date) into v_proj_start from _sch where s0 is not null;
  select count(*) into v_max from _sch;

  -- Forward relaxation حتى الاستقرار (حدّ = عدد المهام + 1، آمن من الحلقات).
  loop
    v_iter := v_iter + 1; v_changed := false;
    for rec in select * from _sch where scheduling_mode = 'auto' and status <> 'done' loop
      v_dur := case when rec.is_milestone then 0 else greatest(rec.dur, 1) end;
      -- أبكر بداية من الاعتماديات (FS/SS) + lag، ومن القيود.
      v_start := coalesce(rec.s, v_proj_start);
      -- FS: تبدأ بعد نهاية السابقة + lag أيام عمل.
      select max(public.add_working_days(p.e, greatest(d.lag_days,0) + 1)) into v_cand
        from public.task_dependencies d join _sch p on p.id = d.depends_on_task_id
        where d.task_id = rec.id and d.dep_type = 'finish_to_start' and p.e is not null;
      if v_cand is not null then v_start := greatest(v_start, v_cand); end if;
      -- SS: تبدأ بعد بداية السابقة + lag.
      select max(public.add_working_days(p.s, greatest(d.lag_days,0))) into v_cand
        from public.task_dependencies d join _sch p on p.id = d.depends_on_task_id
        where d.task_id = rec.id and d.dep_type = 'start_to_start' and p.s is not null;
      if v_cand is not null then v_start := greatest(v_start, v_cand); end if;
      -- القيود على البداية.
      if rec.constraint_type = 'must_start_on' and rec.constraint_date is not null then v_start := rec.constraint_date;
      elsif rec.constraint_type = 'start_no_earlier_than' and rec.constraint_date is not null then v_start := greatest(v_start, rec.constraint_date);
      end if;
      v_start := public.add_working_days(v_start, 0);   -- اضبطها على يوم عمل
      v_end := case when v_dur = 0 then v_start else public.add_working_days(v_start, v_dur - 1) end;
      -- FF/SF: النهاية يجب ألّا تسبق (نهاية/بداية السابقة + lag).
      select max(public.add_working_days(p.e, greatest(d.lag_days,0))) into v_cand
        from public.task_dependencies d join _sch p on p.id = d.depends_on_task_id
        where d.task_id = rec.id and d.dep_type = 'finish_to_finish' and p.e is not null;
      if v_cand is not null and v_end < v_cand then v_end := v_cand; v_start := case when v_dur=0 then v_end else public.add_working_days(v_end, -(v_dur-1)) end; end if;
      select max(public.add_working_days(p.s, greatest(d.lag_days,0))) into v_cand
        from public.task_dependencies d join _sch p on p.id = d.depends_on_task_id
        where d.task_id = rec.id and d.dep_type = 'start_to_finish' and p.s is not null;
      if v_cand is not null and v_end < v_cand then v_end := v_cand; end if;
      -- قيد finish_no_later_than / must_finish_on (تحذير عند التعارض، لا كسر).
      if rec.constraint_type = 'must_finish_on' and rec.constraint_date is not null then v_end := rec.constraint_date;
      elsif rec.constraint_type = 'finish_no_later_than' and rec.constraint_date is not null and v_end > rec.constraint_date then
        v_warn := v_warn || jsonb_build_object('task_id', rec.id, 'type', 'constraint_violation', 'ar', 'تعذّر احترام «finish_no_later_than»');
      end if;
      if (rec.s is distinct from v_start) or (rec.e is distinct from v_end) then
        update _sch set s = v_start, e = v_end where id = rec.id; v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_iter > v_max + 1;
  end loop;
  if v_iter > v_max + 1 then v_warn := v_warn || jsonb_build_object('type','not_converged','ar','قد توجد حلقة أو قيود متعارضة'); end if;

  -- تحذيرات: مهام بلا تواريخ/مدة.
  v_warn := v_warn || coalesce((select jsonb_agg(jsonb_build_object('task_id', id, 'type','missing_dates','ar','مهمة بلا بداية/مدة'))
    from _sch where scheduling_mode='auto' and status<>'done' and s is null), '[]'::jsonb);

  return jsonb_build_object('project_id', p_project,
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'current_start', s0, 'current_end', e0,
       'planned_start', s, 'planned_end', e, 'changed', (s0 is distinct from s or e0 is distinct from e))) from _sch where scheduling_mode='auto'), '[]'::jsonb),
    'warnings', v_warn, 'calculated_at', now());
end $$;

-- Apply — يطبّق نتيجة preview ذرّيًا (auto فقط، لا يلمس done/status/progress/core_stage). ═══
create or replace function public.project_schedule_apply(p_project uuid, p_expected_updated_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev jsonb; rec jsonb; v_n int := 0; v_pc timestamptz;
begin
  if not (public.can_manage_projects() or public.can_edit_project(p_project) or public.emp_has_permission('projects.auto_schedule'))
    then raise exception 'not authorized'; end if;
  select updated_at into v_pc from public.project_core where project_id = p_project;
  if p_expected_updated_at is not null and date_trunc('milliseconds', v_pc) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'stale_update';
  end if;
  v_prev := public.project_schedule_preview(p_project);
  for rec in select * from jsonb_array_elements(v_prev->'tasks') loop
    if (rec->>'changed')::boolean and (rec->>'planned_start') is not null then
      update public.project_tasks set start_date = (rec->>'planned_start')::date, due_date = (rec->>'planned_end')::date,
        version = version + 1, updated_at = now()
        where id = (rec->>'id')::uuid and project_id = p_project and scheduling_mode='auto' and status<>'done';
      v_n := v_n + 1;
    end if;
  end loop;
  update public.project_core set updated_at = now() where project_id = p_project;
  perform public.pc_log(p_project, 'schedule_applied', 'project', p_project, jsonb_build_object('rescheduled', v_n));
  return jsonb_build_object('ok', true, 'rescheduled', v_n, 'warnings', v_prev->'warnings');
end $$;

-- ═══ 4) إعادة جدولة مهمة (يدوي من Gantt) — ذرّي + قفل + Cascade اختياري ═══
create or replace function public.pc_task_reschedule(p_task uuid, p_planned_start date, p_planned_end date,
  p_cascade boolean default false, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_old public.project_tasks; v_casc jsonb := null; v_base boolean;
begin
  select * into v_old from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_old.id is null then raise exception 'not_found'; end if;
  v_base := public.can_manage_projects() or public.can_edit_project(v_old.project_id);
  if not (v_base or public.emp_has_permission('tasks.change_dates') or public.emp_has_permission('projects.edit_schedule'))
    then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then raise exception 'stale_update'; end if;
  if p_planned_start is not null and p_planned_end is not null and p_planned_end < p_planned_start then raise exception 'bad_dates'; end if;

  update public.project_tasks set start_date = p_planned_start, due_date = p_planned_end,
    version = version + 1, updated_at = now() where id = p_task;
  perform public.pc_log(v_old.project_id, 'task_rescheduled', 'task', p_task, jsonb_build_object(
    'from', jsonb_build_object('start', v_old.start_date, 'end', v_old.due_date),
    'to', jsonb_build_object('start', p_planned_start, 'end', p_planned_end)));
  if v_old.assignee_id is not null then
    perform public.pc_notify_user(v_old.assignee_id, 'project_note_new', 'task', p_task,
      'تغيّر موعد مهمة: '||v_old.title, 'Task rescheduled: '||v_old.title);
  end if;
  -- Cascade: أعِد جدولة التابعين auto فقط (عبر المحرك) — دون لمس manual.
  if p_cascade then v_casc := public.project_schedule_apply(v_old.project_id, null); end if;
  return jsonb_build_object('ok', true, 'task_id', p_task, 'cascade', v_casc);
end $$;

-- ═══ 4.1) ضبط حقول التخطيط للمهمة (milestone/mode/constraint/duration) — Additive ═══
create or replace function public.pc_task_set_planning(p_task uuid, p_data jsonb)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_old public.project_tasks; v_mode text; v_ct text;
begin
  select * into v_old from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_old.id is null then raise exception 'not_found'; end if;
  if not (public.can_manage_projects() or public.can_edit_project(v_old.project_id)
          or public.emp_has_permission('tasks.manage_constraints') or public.emp_has_permission('projects.edit_schedule'))
    then raise exception 'not authorized'; end if;
  v_mode := nullif(p_data->>'scheduling_mode','');
  v_ct   := nullif(p_data->>'constraint_type','');
  if v_mode is not null and v_mode not in ('manual','auto') then raise exception 'bad_mode'; end if;
  if v_ct is not null and v_ct not in ('as_soon_as_possible','as_late_as_possible','must_start_on','must_finish_on','start_no_earlier_than','finish_no_later_than')
    then raise exception 'bad_constraint'; end if;
  update public.project_tasks set
    is_milestone    = case when p_data ? 'is_milestone' then coalesce((p_data->>'is_milestone')::boolean, is_milestone) else is_milestone end,
    scheduling_mode = coalesce(v_mode, scheduling_mode),
    constraint_type = coalesce(v_ct, constraint_type),
    constraint_date = case when p_data ? 'constraint_date' then nullif(p_data->>'constraint_date','')::date else constraint_date end,
    duration_days   = case when p_data ? 'duration_days' then nullif(p_data->>'duration_days','')::int else duration_days end,
    version = version + 1, updated_at = now()
    where id = p_task returning * into r;
  perform public.pc_log(v_old.project_id, 'task_planning_updated', 'task', p_task, jsonb_build_object(
    'is_milestone', r.is_milestone, 'mode', r.scheduling_mode, 'constraint', r.constraint_type, 'constraint_date', r.constraint_date, 'duration', r.duration_days));
  return r;
end $$;

-- ═══ 5) المسار الحرج (CPM: ES/EF/LS/LF/Float) — أيام عمل، deps+lag، بلا الملغاة/المحذوفة ═══
create or replace function public.project_critical_path(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare rec record; v_iter int; v_max int; v_changed boolean; v_cand int; v_proj_end int;
  v_dep_ct int;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select count(*) into v_dep_ct from public.task_dependencies d
    join public.project_tasks t on t.id = d.task_id
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false;
  -- ES/EF بوحدة أيام عمل نسبية (offset من صفر). dur بأيام عمل.
  drop table if exists _cp;
  create temporary table _cp on commit drop as
  select t.id, coalesce(nullif(public.working_days_between(t.start_date, t.due_date),0), t.duration_days, 1) as dur,
    0 as es, 0 as ef, 0 as ls, 0 as lf, 0 as float from public.project_tasks t
  where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status not in ('cancelled');
  update _cp set dur = case when dur < 1 then 1 else dur end;
  select count(*) into v_max from _cp;

  -- Forward: ES = max(pred.EF + lag) عبر finish_to_start؛ EF = ES + dur.
  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_changed := false;
    for rec in select id, dur from _cp loop
      select coalesce(max(p.ef + greatest(d.lag_days,0)), 0) into v_cand
        from public.task_dependencies d join _cp p on p.id = d.depends_on_task_id
        where d.task_id = rec.id and d.dep_type in ('finish_to_start','finish_to_finish');
      if v_cand <> (select es from _cp where id = rec.id) then
        update _cp set es = v_cand, ef = v_cand + rec.dur where id = rec.id; v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_iter > v_max + 1;
  end loop;
  select coalesce(max(ef),0) into v_proj_end from _cp;
  update _cp set lf = v_proj_end, ls = v_proj_end - dur;   -- تهيئة backward

  -- Backward: LF = min(succ.LS - lag)؛ LS = LF - dur.
  v_iter := 0;
  loop
    v_iter := v_iter + 1; v_changed := false;
    for rec in select id, dur from _cp loop
      select min(s.ls - greatest(d.lag_days,0)) into v_cand
        from public.task_dependencies d join _cp s on s.id = d.task_id
        where d.depends_on_task_id = rec.id and d.dep_type in ('finish_to_start','finish_to_finish');
      if v_cand is not null and v_cand <> (select lf from _cp where id = rec.id) then
        update _cp set lf = v_cand, ls = v_cand - rec.dur where id = rec.id; v_changed := true;
      end if;
    end loop;
    exit when not v_changed or v_iter > v_max + 1;
  end loop;
  update _cp set float = ls - es;

  return jsonb_build_object('project_id', p_project,
    'computable', (v_dep_ct > 0),
    'critical_task_ids', coalesce((select jsonb_agg(id) from _cp where float <= 0 and v_dep_ct > 0), '[]'::jsonb),
    'total_duration_working_days', v_proj_end,
    'floats', coalesce((select jsonb_object_agg(id::text, float) from _cp), '{}'::jsonb),
    'warnings', case when v_dep_ct = 0 then jsonb_build_array(jsonb_build_object('type','no_dependencies','ar','لا اعتماديات كافية — المسار الحرج غير دقيق')) else '[]'::jsonb end,
    'calculated_at', now());
end $$;

-- ═══ 5.1) pc_task_set_dependency — نسخة أمينة من 3B + lag_days (موجب=Lag، سالب=Lead) + حدّ ═══
create or replace function public.pc_task_set_dependency(p_task uuid, p_depends_on uuid, p_on boolean default true,
  p_dep_type text default 'finish_to_start', p_lag_days int default 0)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_proj2 uuid;
begin
  select project_id into v_proj  from public.project_tasks where id = p_task and is_deleted = false;
  select project_id into v_proj2 from public.project_tasks where id = p_depends_on and is_deleted = false;
  if v_proj is null or v_proj2 is null then raise exception 'not_found'; end if;
  if v_proj <> v_proj2 then raise exception 'cross_project_dependency'; end if;
  if p_task = p_depends_on then raise exception 'self_dependency'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  if p_on then
    if p_dep_type not in ('finish_to_start','start_to_start','finish_to_finish','start_to_finish') then raise exception 'bad_dep_type'; end if;
    if abs(coalesce(p_lag_days,0)) > 3650 then raise exception 'bad_lag'; end if;   -- حدّ أمان
    if exists (
      with recursive chain as (
        select depends_on_task_id as node from public.task_dependencies where task_id = p_depends_on
        union
        select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.node
      ) select 1 from chain where node = p_task
    ) then raise exception 'dependency_cycle'; end if;
    insert into public.task_dependencies(task_id, depends_on_task_id, dep_type, lag_days)
      values (p_task, p_depends_on, p_dep_type, coalesce(p_lag_days,0))
      on conflict (task_id, depends_on_task_id) do update set dep_type = excluded.dep_type, lag_days = excluded.lag_days;
    perform public.pc_log(v_proj, 'task_dep_added', 'task', p_task, jsonb_build_object('depends_on', p_depends_on, 'type', p_dep_type, 'lag', coalesce(p_lag_days,0)));
  else
    delete from public.task_dependencies where task_id = p_task and depends_on_task_id = p_depends_on;
    perform public.pc_log(v_proj, 'task_dep_removed', 'task', p_task, jsonb_build_object('depends_on', p_depends_on));
  end if;
  return true;
end $$;

-- ═══ 6) Baseline — حفظ/إعادة ضبط بسبب + Audit (صلاحية projects.manage_schedule_baseline) ═══
create or replace function public.project_baseline_set(p_project uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_has boolean;
begin
  if not (public.is_owner() or public.can_manage_projects() or public.emp_has_permission('projects.manage_schedule_baseline'))
    then raise exception 'not authorized'; end if;
  select exists(select 1 from public.project_tasks where project_id=p_project and coalesce(is_deleted,false)=false and baseline_start is not null) into v_has;
  if v_has and coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;   -- إعادة الضبط تتطلب سببًا
  update public.project_tasks set baseline_start = start_date, baseline_end = due_date,
    baseline_set_at = now(), baseline_set_by = auth.uid()
    where project_id = p_project and coalesce(is_deleted,false)=false and status <> 'cancelled';
  get diagnostics v_n = row_count;
  perform public.pc_log(p_project, 'baseline_set', 'project', p_project,
    jsonb_build_object('tasks', v_n, 'reset', v_has, 'reason', nullif(btrim(coalesce(p_reason,'')),'')));
  return jsonb_build_object('ok', true, 'tasks', v_n, 'reset', v_has);
end $$;

-- ═══ 7) project_gantt_snapshot — استدعاء واحد (مهام+مدد+مسؤولون+milestones+deps+baseline+critical) ═══
create or replace function public.project_gantt_snapshot(p_project uuid, p_include_children boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_tasks jsonb; v_deps jsonb; v_cp jsonb; v_children jsonb; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  v_cp := public.project_critical_path(p_project);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id, 'title', t.title, 'parent_task_id', t.parent_task_id, 'status', t.status, 'priority', t.priority,
    'assignee_id', t.assignee_id, 'assignee', coalesce(pr.full_name, pr.email), 'progress_pct', t.progress_pct,
    'start', t.start_date, 'end', t.due_date, 'is_milestone', t.is_milestone, 'scheduling_mode', t.scheduling_mode,
    'constraint_type', t.constraint_type, 'constraint_date', t.constraint_date, 'duration_days', t.duration_days, 'version', t.version,
    'baseline_start', t.baseline_start, 'baseline_end', t.baseline_end,
    'baseline_variance_days', case when t.baseline_end is not null and t.due_date is not null then (t.due_date - t.baseline_end) end,
    'overdue', (t.due_date is not null and t.due_date < v_today and t.status not in ('done','cancelled')),
    'critical', ((v_cp->'critical_task_ids') ? t.id::text), 'float', (v_cp->'floats'->>(t.id::text))::int)
    order by t.sort_order, t.start_date nulls last), '[]'::jsonb) into v_tasks
  from public.project_tasks t left join public.profiles pr on pr.id = t.assignee_id
  where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status <> 'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object('task_id', d.task_id, 'depends_on', d.depends_on_task_id, 'type', d.dep_type, 'lag_days', d.lag_days)), '[]'::jsonb)
    into v_deps from public.task_dependencies d join public.project_tasks t on t.id = d.task_id
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false;

  if p_include_children then
    select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.project_name,
        'start', (select min(start_date) from public.project_tasks ct where ct.project_id=c.id and coalesce(ct.is_deleted,false)=false),
        'end', (select max(due_date) from public.project_tasks ct where ct.project_id=c.id and coalesce(ct.is_deleted,false)=false))), '[]'::jsonb)
      into v_children from public.projects c
      where c.parent_project_id = p_project and coalesce(c.is_deleted,false)=false;
  end if;

  return jsonb_build_object('project_id', p_project, 'tasks', v_tasks, 'dependencies', v_deps,
    'critical_path', v_cp, 'children', coalesce(v_children, '[]'::jsonb),
    'calendar', (select jsonb_build_object('work_days', work_days, 'holidays', holidays, 'timezone', timezone) from public.planning_calendar_settings where id=1),
    'today', v_today, 'calculated_at', now());
end $$;

-- ═══ 8) الصلاحيات (مفاتيح جديدة فقط) ═══
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('projects.view_schedule',           'projects', 'normal', 300, 'عرض الجدول الزمني',       'View schedule'),
  ('projects.edit_schedule',           'projects', 'normal', 305, 'تعديل الجدول الزمني',     'Edit schedule'),
  ('projects.auto_schedule',           'projects', 'normal', 310, 'الجدولة الآلية',          'Auto-schedule'),
  ('projects.manage_schedule_baseline','projects', 'sensitive', 315, 'إدارة خط الأساس',      'Manage baseline'),
  ('projects.view_critical_path',      'projects', 'normal', 320, 'عرض المسار الحرج',        'View critical path'),
  ('tasks.manage_constraints',         'tasks',    'normal', 170, 'إدارة قيود المهام',       'Manage task constraints')
on conflict (key) do update set category=excluded.category, label_ar=excluded.label_ar, label_en=excluded.label_en, sort_order=excluded.sort_order;

-- ═══ 9) فهارس ═══
create index if not exists idx_ptasks_dates    on public.project_tasks(project_id, start_date, due_date) where is_deleted = false;
create index if not exists idx_ptasks_milestone on public.project_tasks(project_id) where is_milestone and is_deleted = false;

-- ═══ 10) Grants + تشخيص ═══
do $g$
begin
  execute 'grant execute on function public.is_working_day(date) to authenticated, anon';
  execute 'grant execute on function public.add_working_days(date,int) to authenticated, anon';
  execute 'grant execute on function public.working_days_between(date,date) to authenticated, anon';
  execute 'grant execute on function public.project_schedule_preview(uuid) to authenticated';
  execute 'grant execute on function public.project_schedule_apply(uuid,timestamptz) to authenticated';
  execute 'grant execute on function public.pc_task_reschedule(uuid,date,date,boolean,int) to authenticated';
  execute 'grant execute on function public.pc_task_set_planning(uuid,jsonb) to authenticated';
  execute 'grant execute on function public.pc_task_set_dependency(uuid,uuid,boolean,text,int) to authenticated';
  execute 'grant execute on function public.project_critical_path(uuid) to authenticated';
  execute 'grant execute on function public.project_baseline_set(uuid,text) to authenticated';
  execute 'grant execute on function public.project_gantt_snapshot(uuid,boolean) to authenticated';
end $g$;

do $d$
declare v_cols int;
begin
  select count(*) into v_cols from information_schema.columns where table_schema='public' and table_name='project_tasks'
    and column_name in ('is_milestone','scheduling_mode','constraint_type','constraint_date','duration_days','baseline_start','baseline_end','baseline_set_at','baseline_set_by');
  raise notice 'batch4a: new project_tasks cols=%/9, lag_days=%/1, calendar=%, gantt_snapshot=%, add_working_days sanity=%',
    v_cols,
    (select count(*) from information_schema.columns where table_schema='public' and table_name='task_dependencies' and column_name='lag_days'),
    (to_regclass('public.planning_calendar_settings') is not null),
    (to_regprocedure('public.project_gantt_snapshot(uuid,boolean)') is not null),
    (public.add_working_days('2026-01-01'::date, 0) is not null);
  if v_cols <> 9 then raise exception 'أعمدة التخطيط ناقصة (%/9)', v_cols; end if;
end $d$;

commit;

notify pgrst, 'reload schema';
