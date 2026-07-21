-- ════════════════════════════════════════════════════════════════════════════
-- project_tasks_batch3b_RUNME.sql  —  PHASE 3 · BATCH 3B · Kanban, Workflow & Review
-- ────────────────────────────────────────────────────────────────────────────
-- يطوّر نظام المهام (Batch 3A) — لا نظام موازٍ. Additive · Idempotent · NO DROP ·
-- NO data deletion · Production-safe. يُشغَّل بعد project_tasks_batch3a_RUNME.sql.
--
-- لا يمسّ: done (يبقى «مكتملة») · core_stage/دورة الحياة · project_stage_sync ·
--          نسبة إنجاز المشروع الرئيسية · المخرجات/المراجعات · Phase B · Zoho · العهدة ·
--          المشاريع الأب-فرع · النظام القديم /projects · بوابة العميل.
--
-- المحتوى:
--   §1 أعمدة: blocked_reason/at/by + version (قفل تفاؤلي) على project_tasks.
--   §2 task_dependencies: dep_type (finish_to_start افتراضي) — Additive.
--   §3 مصفوفة انتقال الحالات المركزية (SQL = المرجع الأمني): task_transition_allowed().
--   §4 مفاتيح صلاحية إضافية: tasks.override_subtask_gate.
--   §5 RPCs: pc_task_update (null-clear patch + version) · pc_task_move (نقل+ترتيب ذرّي) ·
--      pc_task_review_action (دورة مراجعة) · pc_task_set_dependency (dep_type + حارس دورات
--      متعدٍّ + finish-to-start gating) · pc_project_tasks_board (لوحة مركزية بلا N+1).
--   §6 فهارس. §7 Grants. §8 تشخيص.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ 0) Preflight ═══
do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_tasks')           is null then miss := miss||' project_tasks'; end if;
  if to_regclass('public.task_dependencies')        is null then miss := miss||' task_dependencies'; end if;
  if to_regclass('public.project_task_assignees')   is null then miss := miss||' project_task_assignees (شغّل 3A أولًا)'; end if;
  if to_regclass('public.permissions')              is null then miss := miss||' permissions'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)')                 is null then miss := miss||' pc_log'; end if;
  if to_regprocedure('public.pc_notify_user(uuid,text,text,uuid,text,text)')      is null then miss := miss||' pc_notify_user'; end if;
  if to_regprocedure('public.emp_has_permission(text)')                          is null then miss := miss||' emp_has_permission'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)')                         is null then miss := miss||' pc_can_read_project'; end if;
  if to_regprocedure('public.can_edit_project(uuid)')                            is null then miss := miss||' can_edit_project'; end if;
  if to_regprocedure('public.is_client_side(uuid)')                              is null then miss := miss||' is_client_side'; end if;
  if to_regprocedure('public.project_task_progress(uuid)')                       is null then miss := miss||' project_task_progress (3A)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%). شغّل Batch 3A أولًا.', miss; end if;
end $pf$;

begin;

-- ═══ 1) أعمدة إضافية على project_tasks ═══
alter table public.project_tasks add column if not exists blocked_reason text;
alter table public.project_tasks add column if not exists blocked_at     timestamptz;
alter table public.project_tasks add column if not exists blocked_by     uuid references auth.users(id) on delete set null;
-- قفل تفاؤلي رقمي (إضافةً لـupdated_at). يُرفع في كل RPC مُعدِّل.
alter table public.project_tasks add column if not exists version        int not null default 0;

-- ═══ 2) dep_type على task_dependencies (Additive، افتراضي finish_to_start) ═══
alter table public.task_dependencies add column if not exists dep_type text not null default 'finish_to_start';
alter table public.task_dependencies drop constraint if exists task_dep_type_chk;
alter table public.task_dependencies add  constraint task_dep_type_chk
  check (dep_type in ('finish_to_start','start_to_start','finish_to_finish','start_to_finish'));

-- ═══ 3) مصفوفة انتقال الحالات المركزية — SQL هو المرجع الأمني النهائي ═══
--     نسخة TypeScript (lib/project-core/taskWorkflow.ts) موثّقة ومطابِقة للعرض فقط.
create or replace function public.task_transition_allowed(p_from text, p_to text)
returns boolean language sql immutable set search_path = public as $$
  select case
    when p_from = p_to then true                              -- لا-حركة مسموحة (idempotent)
    else (p_from, p_to) in (
      values
        ('backlog','todo'), ('backlog','cancelled'),
        ('todo','backlog'), ('todo','in_progress'), ('todo','blocked'), ('todo','cancelled'),
        ('in_progress','todo'), ('in_progress','internal_review'), ('in_progress','blocked'), ('in_progress','cancelled'),
        ('internal_review','in_progress'), ('internal_review','client_review'), ('internal_review','done'), ('internal_review','blocked'),
        ('client_review','in_progress'), ('client_review','internal_review'), ('client_review','done'), ('client_review','blocked'),
        ('blocked','todo'), ('blocked','in_progress'), ('blocked','cancelled'),
        ('done','in_progress'), ('done','internal_review'),
        ('cancelled','backlog'), ('cancelled','todo')
    )
  end;
$$;

-- ═══ 4) مفتاح صلاحية إضافي: تجاوز حارس المهام الفرعية عند الإكمال ═══
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('tasks.override_subtask_gate', 'projects_tasks', 'sensitive', 130, 'تجاوز حارس المهام الفرعية', 'Override subtask gate on complete')
on conflict (key) do update set category=excluded.category, label_ar=excluded.label_ar, label_en=excluded.label_en, sort_order=excluded.sort_order;

-- ═══ 5) الدوال ═══

-- 5.0 مساعد داخلي: تطبيق قواعد done/blocked/reopen على صفّ + بناء جسم التحديث المشترك.
--     (يُستدعى من move/review — منطق واحد غير مكرّر.)
create or replace function public.pc_task_apply_status(p_task uuid, p_from text, p_to text, p_reason text, p_actor uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_open_subs int; v_blocked_deps int;
begin
  -- الانتقال إلى done: حارس المهام الفرعية + finish_to_start deps + 100% + completed_at.
  if p_to = 'done' then
    select count(*) into v_open_subs from public.project_tasks
      where parent_task_id = p_task and coalesce(is_deleted,false)=false and status not in ('done','cancelled');
    if v_open_subs > 0 and not public.emp_has_permission('tasks.override_subtask_gate') and not public.is_owner() then
      raise exception 'subtasks_incomplete';
    end if;
    select count(*) into v_blocked_deps
      from public.task_dependencies d join public.project_tasks dt on dt.id = d.depends_on_task_id
      where d.task_id = p_task and d.dep_type in ('finish_to_start','finish_to_finish')
        and coalesce(dt.is_deleted,false)=false and dt.status not in ('done','cancelled');
    if v_blocked_deps > 0 then raise exception 'dependencies_incomplete'; end if;
    update public.project_tasks set progress_pct = 100, completed_at = coalesce(completed_at, now()),
      blocked_reason = null, blocked_at = null, blocked_by = null where id = p_task;

  -- بدء (in_progress): امنع البدء إن كانت finish_to_start deps غير مكتملة.
  elsif p_to = 'in_progress' and p_from in ('todo','backlog','blocked') then
    select count(*) into v_blocked_deps
      from public.task_dependencies d join public.project_tasks dt on dt.id = d.depends_on_task_id
      where d.task_id = p_task and d.dep_type = 'finish_to_start'
        and coalesce(dt.is_deleted,false)=false and dt.status not in ('done','cancelled');
    if v_blocked_deps > 0 then raise exception 'dependencies_incomplete'; end if;
    update public.project_tasks set blocked_reason = null, blocked_at = null, blocked_by = null where id = p_task;

  -- إعادة الفتح من done: completed_at=null، النسبة لا تبقى 100 (≤99).
  elsif p_from = 'done' and p_to <> 'done' then
    update public.project_tasks set completed_at = null,
      progress_pct = least(progress_pct, 99) where id = p_task;

  -- التعطيل: سبب إلزامي مُدقَّق.
  elsif p_to = 'blocked' then
    if coalesce(btrim(p_reason),'') = '' then raise exception 'block_reason_required'; end if;
    update public.project_tasks set blocked_reason = btrim(p_reason), blocked_at = now(), blocked_by = p_actor where id = p_task;

  -- مغادرة blocked (لغير done/in_progress المعالَجَين أعلاه): امسح الحالة الحالية (السبب يبقى في Audit).
  elsif p_from = 'blocked' then
    update public.project_tasks set blocked_reason = null, blocked_at = null, blocked_by = null where id = p_task;
  end if;
end $$;

-- 5.1 pc_task_update — إعادة اشتقاق بدلالة PATCH صريحة (null-clear) + version.
--     الحقل غير المرسل = لا تغيير؛ المرسل null = مسح؛ المرسل بقيمة = تحديث.
--     status/blocked يمرّان عبر pc_task_move — هنا لا نغيّر status (نتجاهله لتفادي تجاوز الـWorkflow).
create or replace function public.pc_task_update(p_task uuid, p_data jsonb)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_old public.project_tasks; v_exp timestamptz; v_expv int;
  v_ch_dates boolean; v_ch_assignee boolean; v_base boolean; v_new_assignee uuid; has boolean;
begin
  select * into v_old from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_old.id is null then raise exception 'not_found'; end if;
  v_base := public.can_manage_projects() or public.can_edit_project(v_old.project_id);
  if not (v_base or public.emp_has_permission('tasks.edit')) then raise exception 'not authorized'; end if;

  -- قفل تفاؤلي: version (مفضّل) أو updated_at (توافق قديم).
  v_expv := nullif(p_data->>'expected_version','')::int;
  v_exp  := nullif(p_data->>'expected_updated_at','')::timestamptz;
  if v_expv is not null and v_expv <> v_old.version then raise exception 'stale_update'; end if;
  if v_exp  is not null and date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', v_exp) then raise exception 'stale_update'; end if;

  v_ch_dates := (p_data ? 'start_date') or (p_data ? 'due_date');
  v_ch_assignee := p_data ? 'assignee_id';
  if v_ch_dates    and not (v_base or public.emp_has_permission('tasks.change_dates'))    then raise exception 'not authorized: change_dates'; end if;
  if v_ch_assignee and not (v_base or public.emp_has_permission('tasks.assign_employee')) then raise exception 'not authorized: assign'; end if;

  -- PATCH: `p_data ? key` ⇒ الحقل حاضر (قد يكون null=مسح). غيابه ⇒ إبقاء القيمة.
  v_new_assignee := case when p_data ? 'assignee_id' then nullif(p_data->>'assignee_id','')::uuid else v_old.assignee_id end;
  update public.project_tasks set
    title           = case when p_data ? 'title' and btrim(coalesce(p_data->>'title',''))<>'' then btrim(p_data->>'title') else title end,
    description      = case when p_data ? 'description' then nullif(p_data->>'description','') else description end,
    priority        = case when p_data ? 'priority' and nullif(p_data->>'priority','') is not null then p_data->>'priority' else priority end,
    assignee_id     = v_new_assignee,
    start_date      = case when p_data ? 'start_date' then nullif(p_data->>'start_date','')::date else start_date end,
    due_date        = case when p_data ? 'due_date'   then nullif(p_data->>'due_date','')::date   else due_date end,
    estimated_hours = case when p_data ? 'estimated_hours' then nullif(p_data->>'estimated_hours','')::numeric else estimated_hours end,
    actual_hours    = case when p_data ? 'actual_hours'    then nullif(p_data->>'actual_hours','')::numeric    else actual_hours end,
    progress_pct    = case when status = 'done' then 100
                           when p_data ? 'progress_pct' and nullif(p_data->>'progress_pct','') is not null
                             then greatest(0, least(100, (p_data->>'progress_pct')::int)) else progress_pct end,
    labels          = case when jsonb_typeof(p_data->'labels')='array'
                        then coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'labels') x), '{}') else labels end,
    sort_order      = case when p_data ? 'sort_order' and nullif(p_data->>'sort_order','') is not null then (p_data->>'sort_order')::int else sort_order end,
    client_visible  = case when p_data ? 'client_visible' then coalesce((p_data->>'client_visible')::boolean, client_visible) else client_visible end,
    core_stage      = case when p_data ? 'core_stage' then nullif(p_data->>'core_stage','') else core_stage end,
    deliverable_id        = case when p_data ? 'deliverable_id' then nullif(p_data->>'deliverable_id','')::uuid else deliverable_id end,
    shoot_session_id      = case when p_data ? 'shoot_session_id' then nullif(p_data->>'shoot_session_id','')::uuid else shoot_session_id end,
    preproduction_item_id = case when p_data ? 'preproduction_item_id' then nullif(p_data->>'preproduction_item_id','')::uuid else preproduction_item_id end,
    version         = version + 1,
    updated_at = now()
    where id = p_task returning * into r;

  perform public.pc_log(v_old.project_id, 'task_updated', 'task', p_task, jsonb_build_object(
    'patch', p_data - 'labels' - 'expected_updated_at' - 'expected_version',
    'before', jsonb_build_object('assignee', v_old.assignee_id, 'start', v_old.start_date, 'due', v_old.due_date, 'title', v_old.title),
    'after',  jsonb_build_object('assignee', r.assignee_id, 'start', r.start_date, 'due', r.due_date, 'title', r.title)));
  if r.assignee_id is distinct from v_old.assignee_id and r.assignee_id is not null then
    insert into public.task_followers(task_id, user_id) values (p_task, r.assignee_id) on conflict do nothing;
    insert into public.project_task_assignees(task_id, user_id, assignment_role, assigned_by)
      values (p_task, r.assignee_id, 'owner', auth.uid()) on conflict (task_id,user_id,assignment_role) do nothing;
    perform public.pc_notify_user(r.assignee_id, 'project_note_new', 'task', p_task,
      'أُسندت إليك مهمة: '||r.title, 'Task assigned to you: '||r.title);
  end if;
  has := (p_data ? 'assignee_id') and (nullif(p_data->>'assignee_id','') is null);
  if has and v_old.assignee_id is not null then
    delete from public.project_task_assignees where task_id = p_task and user_id = v_old.assignee_id and assignment_role = 'owner';
  end if;
  return r;
end $$;

-- 5.2 pc_task_move — نقل حالة + ترتيب ذرّي واحد. يتحقق: صلاحية · مشروع · انتقال Workflow ·
--     قواعد done/blocked/reopen/deps · قفل تفاؤلي · Audit · إشعار · إعادة النتيجة.
create or replace function public.pc_task_move(p_task uuid, p_target_status text, p_before uuid default null,
  p_after uuid default null, p_expected_version int default null, p_reason text default null)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_old public.project_tasks; v_base boolean;
  v_before_sort int; v_after_sort int; v_new_sort int;
begin
  select * into v_old from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_old.id is null then raise exception 'not_found'; end if;
  v_base := public.can_manage_projects() or public.can_edit_project(v_old.project_id);
  if not (v_base or public.emp_has_permission('tasks.change_status')) then raise exception 'not authorized'; end if;
  if p_target_status is null then p_target_status := v_old.status; end if;
  if not (p_target_status = v_old.status or public.task_transition_allowed(v_old.status, p_target_status)) then
    raise exception 'transition_not_allowed';
  end if;
  -- انتقالات المراجعة/الاعتماد تمرّ عبر pc_task_review_action (تحتاج tasks.review) — لا نسمح بها هنا مباشرة.
  if p_target_status = 'done' and v_old.status in ('internal_review','client_review')
     and not (v_base or public.emp_has_permission('tasks.review')) then
    raise exception 'use_review_action';
  end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then raise exception 'stale_update'; end if;

  -- ترتيب داخل العمود: sort_order بين قبل/بعد (fractional-كامل بإعادة تطبيع بسيطة عند اللزوم).
  if p_before is not null then select sort_order into v_before_sort from public.project_tasks where id = p_before and project_id = v_old.project_id; end if;
  if p_after  is not null then select sort_order into v_after_sort  from public.project_tasks where id = p_after  and project_id = v_old.project_id; end if;
  v_new_sort := case
    when v_before_sort is not null and v_after_sort is not null then (v_before_sort + v_after_sort) / 2
    when v_after_sort  is not null then v_after_sort - 1
    when v_before_sort is not null then v_before_sort + 1
    else coalesce((select max(sort_order) from public.project_tasks where project_id = v_old.project_id and status = p_target_status and coalesce(is_deleted,false)=false), 0) + 1
  end;

  -- طبّق الحالة أولًا (قواعد done/blocked/reopen/deps ترفع استثناءً وتُلغي كل شيء إن فشلت).
  if p_target_status <> v_old.status then
    perform public.pc_task_apply_status(p_task, v_old.status, p_target_status, p_reason, auth.uid());
  end if;
  update public.project_tasks set status = p_target_status, sort_order = v_new_sort,
    version = version + 1, updated_at = now() where id = p_task returning * into r;

  -- إعادة تطبيع عند التصادم (نفس sort_order لمهمتين في العمود) — محدودة بالعمود المستهدف.
  if exists (select 1 from public.project_tasks where project_id = v_old.project_id and status = p_target_status
             and coalesce(is_deleted,false)=false and id <> p_task and sort_order = v_new_sort) then
    with ord as (
      select id, row_number() over (order by sort_order, updated_at) * 10 as rn
      from public.project_tasks where project_id = v_old.project_id and status = p_target_status and coalesce(is_deleted,false)=false)
    update public.project_tasks t set sort_order = ord.rn from ord where ord.id = t.id;
    select * into r from public.project_tasks where id = p_task;
  end if;

  perform public.pc_log(v_old.project_id, 'task_moved', 'task', p_task, jsonb_build_object(
    'from', v_old.status, 'to', p_target_status, 'sort', r.sort_order));
  if r.status is distinct from v_old.status then
    perform public.pc_notify_team_task(p_task, v_old.project_id,
      'تحدّثت حالة مهمة إلى '||p_target_status||': '||r.title,
      'Task moved to '||p_target_status||': '||r.title, auth.uid());
  end if;
  return r;
end $$;

-- 5.3 إشعار مشاركي المهمة (المسؤول/المشاركون/المراجعون/المنشئ/المدير) — بلا مُنفِّذ الإجراء.
create or replace function public.pc_notify_team_task(p_task uuid, p_project uuid, p_ar text, p_en text, p_exclude uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- المشاركون في المهمة.
  perform public.pc_notify_user(a.user_id, 'project_note_new', 'task', p_task, p_ar, p_en)
  from (
    select distinct user_id from public.project_task_assignees where task_id = p_task
    union select assignee_id from public.project_tasks where id = p_task and assignee_id is not null
    union select created_by  from public.project_tasks where id = p_task and created_by  is not null
    union select m.user_id from public.project_members m where m.project_id = p_project and m.role='kian_manager' and m.is_deleted=false
  ) a where a.user_id is not null and a.user_id <> coalesce(p_exclude, '00000000-0000-0000-0000-000000000000'::uuid);
end $$;

-- 5.4 pc_task_review_action — دورة المراجعة (Audit + إشعار). لا يعتمد على status عام.
create or replace function public.pc_task_review_action(p_task uuid, p_action text, p_comment text default null, p_expected_version int default null)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_old public.project_tasks; v_to text; v_base boolean; v_client boolean;
begin
  select * into v_old from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_old.id is null then raise exception 'not_found'; end if;
  if p_expected_version is not null and p_expected_version <> v_old.version then raise exception 'stale_update'; end if;
  v_base   := public.can_manage_projects() or public.can_edit_project(v_old.project_id);
  v_client := public.is_client_side(v_old.project_id);

  if p_action = 'approve_internal' then          -- مراجع داخلي: من internal_review
    if v_old.status <> 'internal_review' then raise exception 'bad_state'; end if;
    if not (v_base or public.emp_has_permission('tasks.review')) then raise exception 'not authorized'; end if;
    v_to := case when v_old.client_visible then 'client_review' else 'done' end;
  elsif p_action = 'send_to_client' then
    if v_old.status <> 'internal_review' then raise exception 'bad_state'; end if;
    if not (v_base or public.emp_has_permission('tasks.review')) then raise exception 'not authorized'; end if;
    if not v_old.client_visible then raise exception 'not_client_visible'; end if;
    v_to := 'client_review';
  elsif p_action = 'approve_client' then         -- العميل يعتمد (أو الطاقم نيابةً)
    if v_old.status <> 'client_review' then raise exception 'bad_state'; end if;
    if not (v_base or (v_client and v_old.client_visible) or public.emp_has_permission('tasks.review')) then raise exception 'not authorized'; end if;
    v_to := 'done';
  elsif p_action = 'request_changes' then        -- يعيد إلى in_progress (طاقم أو عميل مصرّح)
    if v_old.status not in ('internal_review','client_review') then raise exception 'bad_state'; end if;
    if not (v_base or public.emp_has_permission('tasks.review') or (v_client and v_old.client_visible and v_old.status='client_review')) then raise exception 'not authorized'; end if;
    v_to := 'in_progress';
  elsif p_action = 'mark_done' then              -- إكمال مباشر (طاقم مراجِع)
    if v_old.status not in ('internal_review','client_review') then raise exception 'bad_state'; end if;
    if not (v_base or public.emp_has_permission('tasks.review')) then raise exception 'not authorized'; end if;
    v_to := 'done';
  else
    raise exception 'bad_action';
  end if;

  if v_to <> v_old.status then perform public.pc_task_apply_status(p_task, v_old.status, v_to, null, auth.uid()); end if;
  update public.project_tasks set status = v_to, version = version + 1, updated_at = now() where id = p_task returning * into r;

  perform public.pc_log(v_old.project_id, 'task_review', 'task', p_task, jsonb_build_object(
    'action', p_action, 'from', v_old.status, 'to', v_to, 'comment', nullif(btrim(coalesce(p_comment,'')),''), 'by', auth.uid()));
  if nullif(btrim(coalesce(p_comment,'')),'') is not null then
    perform public.pc_task_comment(p_task, '['||p_action||'] '||btrim(p_comment));
  end if;
  perform public.pc_notify_team_task(p_task, v_old.project_id,
    'قرار مراجعة ('||p_action||'): '||r.title, 'Review ('||p_action||'): '||r.title, auth.uid());
  return r;
end $$;

-- 5.5 pc_task_set_dependency — dep_type + حارس دورات متعدٍّ (Recursive) + self/cross-project.
create or replace function public.pc_task_set_dependency(p_task uuid, p_depends_on uuid, p_on boolean default true, p_dep_type text default 'finish_to_start')
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
    -- حارس الدورات: هل p_task قابلة للوصول من p_depends_on عبر سلسلة الاعتماديات؟ (⇒ حلقة)
    if exists (
      with recursive chain as (
        select depends_on_task_id as node from public.task_dependencies where task_id = p_depends_on
        union
        select d.depends_on_task_id from public.task_dependencies d join chain c on d.task_id = c.node
      ) select 1 from chain where node = p_task
    ) then raise exception 'dependency_cycle'; end if;
    insert into public.task_dependencies(task_id, depends_on_task_id, dep_type) values (p_task, p_depends_on, p_dep_type)
      on conflict (task_id, depends_on_task_id) do update set dep_type = excluded.dep_type;
    perform public.pc_log(v_proj, 'task_dep_added', 'task', p_task, jsonb_build_object('depends_on', p_depends_on, 'type', p_dep_type));
  else
    delete from public.task_dependencies where task_id = p_task and depends_on_task_id = p_depends_on;
    perform public.pc_log(v_proj, 'task_dep_removed', 'task', p_task, jsonb_build_object('depends_on', p_depends_on));
  end if;
  return true;
end $$;

-- 5.6 pc_project_tasks_board — لوحة مركزية بلا N+1 (مهمة + مشاركون + عدّادات + روابط + deps).
create or replace function public.pc_project_tasks_board(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_client boolean; v_today date := (now() at time zone 'utc')::date;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  v_client := public.is_client_side(p_project);
  select coalesce(jsonb_agg(trow order by trow->>'status', (trow->>'sort_order')::int), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority,
      'assignee_id', t.assignee_id, 'parent_task_id', t.parent_task_id,
      'start_date', t.start_date, 'due_date', t.due_date, 'progress_pct', t.progress_pct,
      'estimated_hours', t.estimated_hours, 'sort_order', t.sort_order, 'version', t.version,
      'client_visible', t.client_visible, 'core_stage', t.core_stage,
      'deliverable_id', t.deliverable_id, 'shoot_session_id', t.shoot_session_id, 'preproduction_item_id', t.preproduction_item_id,
      'blocked_reason', t.blocked_reason,
      'overdue', (t.due_date is not null and t.due_date < v_today and t.status not in ('done','cancelled')),
      'assignees', (select coalesce(jsonb_agg(jsonb_build_object('user_id', a.user_id, 'role', a.assignment_role,
                      'name', coalesce(pr.full_name, pr.email))), '[]'::jsonb)
                    from public.project_task_assignees a left join public.profiles pr on pr.id = a.user_id where a.task_id = t.id),
      'comments',   (select count(*) from public.task_comments c where c.task_id = t.id and coalesce(c.is_deleted,false)=false),
      'checklist_total', (select count(*) from public.project_task_checklists cl where cl.task_id = t.id),
      'checklist_done',  (select count(*) from public.project_task_checklists cl where cl.task_id = t.id and cl.is_done),
      'subtasks_total',  (select count(*) from public.project_tasks s where s.parent_task_id = t.id and coalesce(s.is_deleted,false)=false),
      'subtasks_done',   (select count(*) from public.project_tasks s where s.parent_task_id = t.id and coalesce(s.is_deleted,false)=false and s.status='done'),
      'deps_total',      (select count(*) from public.task_dependencies d where d.task_id = t.id),
      'deps_blocking',   (select count(*) from public.task_dependencies d join public.project_tasks dt on dt.id=d.depends_on_task_id
                          where d.task_id = t.id and d.dep_type in ('finish_to_start','finish_to_finish')
                            and coalesce(dt.is_deleted,false)=false and dt.status not in ('done','cancelled'))
    ) as trow
    from public.project_tasks t
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false
      and (
        (not v_client and (
              public.can_manage_projects() or public.is_admin() or public.staff_reads_all_projects()
           or public.emp_can('view_all_tasks') or t.assignee_id = auth.uid() or t.created_by = auth.uid()
           or (t.visibility = 'profession' and (t.profession_id is null or t.profession_id = any (public.emp_profession_ids())))
           or exists (select 1 from public.project_task_assignees a where a.task_id = t.id and a.user_id = auth.uid())))
        or (t.client_visible and v_client)
      )
  ) s;
  return jsonb_build_object('tasks', v_rows, 'progress', public.project_task_progress(p_project));
end $$;

-- ═══ 6) فهارس ═══
create index if not exists idx_ptasks_status_sort on public.project_tasks(project_id, status, sort_order) where is_deleted = false;
create index if not exists idx_ptasks_due_active  on public.project_tasks(due_date) where is_deleted = false and status not in ('done','cancelled');
create index if not exists idx_tdeps_dependson     on public.task_dependencies(depends_on_task_id);

-- ═══ 7) Grants ═══
do $g$
begin
  execute 'grant execute on function public.task_transition_allowed(text,text) to authenticated, anon';
  execute 'grant execute on function public.pc_task_update(uuid,jsonb) to authenticated';
  execute 'grant execute on function public.pc_task_move(uuid,text,uuid,uuid,int,text) to authenticated';
  execute 'grant execute on function public.pc_task_review_action(uuid,text,text,int) to authenticated';
  execute 'grant execute on function public.pc_task_set_dependency(uuid,uuid,boolean,text) to authenticated';
  execute 'grant execute on function public.pc_project_tasks_board(uuid) to authenticated';
  -- الدوال الداخلية: تُستدعى من دوال SECURITY DEFINER فقط.
  execute 'revoke all on function public.pc_task_apply_status(uuid,text,text,text,uuid) from public, anon, authenticated';
  execute 'revoke all on function public.pc_notify_team_task(uuid,uuid,text,text,uuid) from public, anon, authenticated';
end $g$;

-- ═══ 8) تشخيص بعد ═══
do $d$
declare v_cols int; v_deptype int; v_matrix boolean;
begin
  select count(*) into v_cols from information_schema.columns where table_schema='public' and table_name='project_tasks'
    and column_name in ('blocked_reason','blocked_at','blocked_by','version');
  select count(*) into v_deptype from information_schema.columns where table_schema='public' and table_name='task_dependencies' and column_name='dep_type';
  v_matrix := public.task_transition_allowed('todo','in_progress') and not public.task_transition_allowed('backlog','done')
              and public.task_transition_allowed('internal_review','done') and not public.task_transition_allowed('done','cancelled');
  raise notice 'batch3b: new project_tasks cols=%/4, task_dependencies.dep_type=%/1, matrix sanity=%', v_cols, v_deptype, v_matrix;
  if v_cols <> 4 then raise exception 'أعمدة blocked/version ناقصة (%/4)', v_cols; end if;
  if v_deptype <> 1 then raise exception 'dep_type ناقص'; end if;
  if not v_matrix then raise exception 'مصفوفة الانتقال غير متوقّعة'; end if;
end $d$;

commit;

notify pgrst, 'reload schema';

-- ── تحقّق اختياري بعد الـcommit ──
--   select public.task_transition_allowed('todo','in_progress');   -- t
--   select public.task_transition_allowed('backlog','done');       -- f
--   select public.pc_project_tasks_board('<PROJECT_ID>');
