-- ════════════════════════════════════════════════════════════════════════════
-- project_tasks_batch3a_RUNME.sql  —  PHASE 3 · BATCH 3A · Task Engine Foundation
-- ────────────────────────────────────────────────────────────────────────────
-- يطوّر نظام المهام القائم (public.project_tasks) — لا ينشئ نظامًا موازيًا.
-- Additive · Idempotent · NO DROP TABLE · NO data deletion · Production-safe.
-- يُشغَّل بعد كل ملفات project_core (يعيد تعريف الأجسام الفائزة: pc_task_create @FINAL،
-- pc_task_update @ABSOLUTE_FINAL، ptasks_read @employee_professions) فتفوز نسخنا.
--
-- لا يمسّ: core_stage/دورة الحياة، project_stage_sync، Phase B، Zoho، العهدة،
--          المخرجات/المراجعات، النظام القديم /projects، عدّادات المهام المركزية
--          (نُبقي 'done' كقيمة «مكتملة» فلا تتغيّر أي دالة dashboard/summary).
--
-- ما يفعله:
--   §1 توسعة project_tasks: أعمدة ربط + client_visible + core_stage + توسعة CHECK الحالة.
--   §2 project_task_assignees (owner/contributor/reviewer/watcher) + RLS + Backfill.
--   §3 بذر مفاتيح الصلاحيات الناقصة (tasks.delete/change_status/change_dates/review).
--   §4 RPCs: create/update (بوّابات صلاحيات + حقول جديدة)، assign، set_parent (حارس دورات)،
--      set_status، project_task_progress، قوائم إثرائية (assignees / progress).
--   §5 RLS: توسعة ptasks_read + pc_can_read_task (مشاركون + client_visible للعميل).
--   §6 Grants + notify pgrst.  §7 تشخيص قبل/بعد.
--
-- خريطة الحالة (UI ↔ storage): backlog · todo · in_progress · internal_review ·
--   client_review · blocked · «مكتملة»=done · cancelled.  (in_review مُرحَّلة→internal_review)
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ 0) Preflight ═══
do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_tasks')          is null then miss := miss||' project_tasks'; end if;
  if to_regclass('public.projects')               is null then miss := miss||' projects'; end if;
  if to_regclass('public.project_members')        is null then miss := miss||' project_members'; end if;
  if to_regclass('public.permissions')            is null then miss := miss||' permissions'; end if;
  if to_regclass('public.deliverables')           is null then miss := miss||' deliverables'; end if;
  if to_regclass('public.project_shoot_sessions') is null then miss := miss||' project_shoot_sessions'; end if;
  if to_regclass('public.preproduction_items')    is null then miss := miss||' preproduction_items'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)')                 is null then miss := miss||' pc_log'; end if;
  if to_regprocedure('public.pc_notify_team(uuid,text,text,uuid,text,text,uuid)') is null then miss := miss||' pc_notify_team'; end if;
  if to_regprocedure('public.pc_notify_user(uuid,text,text,uuid,text,text)')      is null then miss := miss||' pc_notify_user'; end if;
  if to_regprocedure('public.emp_has_permission(text)')                          is null then miss := miss||' emp_has_permission'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)')                         is null then miss := miss||' pc_can_read_project'; end if;
  if to_regprocedure('public.can_edit_project(uuid)')                            is null then miss := miss||' can_edit_project'; end if;
  if to_regprocedure('public.is_client_side(uuid)')                              is null then miss := miss||' is_client_side'; end if;
  if miss <> '' then
    raise exception 'نقص في الاعتمادات (%). شغّل ملفات project_core + permission_catalog + employee_professions أولًا.', miss;
  end if;
end $pf$;

begin;

-- ═══ 1) توسعة project_tasks (أعمدة إضافية آمنة + توسعة CHECK الحالة) ═══
alter table public.project_tasks add column if not exists client_visible        boolean not null default false;
alter table public.project_tasks add column if not exists deliverable_id         uuid references public.deliverables(id)           on delete set null;
alter table public.project_tasks add column if not exists shoot_session_id       uuid references public.project_shoot_sessions(id) on delete set null;
alter table public.project_tasks add column if not exists preproduction_item_id  uuid references public.preproduction_items(id)    on delete set null;
alter table public.project_tasks add column if not exists core_stage             text;

-- core_stage اختياري: إمّا NULL أو إحدى مراحل دورة الحياة الـ13 (لا يربط رسميًا بالنسبة، مجرّد وسم).
alter table public.project_tasks drop constraint if exists project_tasks_core_stage_chk;
alter table public.project_tasks add  constraint project_tasks_core_stage_chk check (
  core_stage is null or core_stage in ('lead_approved','project_created','planning','ready','scheduled',
    'in_production','post_production','internal_review','client_review','revision','approved','delivered','closed'));

-- توسعة CHECK الحالة إلى Superset (يضيف backlog/internal_review/client_review، يُبقي القديمة).
-- إسقاط الـCHECK المضمّن (اسمه التلقائي) ديناميكيًا ثم إضافة اسم صريح — بلا كسر لأي صف.
do $st$
declare c text;
begin
  for c in
    select con.conname from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace n on n.oid = rel.relnamespace
    where n.nspname='public' and rel.relname='project_tasks' and con.contype='c'
      and pg_get_constraintdef(con.oid) ilike '%status%' and con.conname <> 'project_tasks_status_chk'
  loop
    execute format('alter table public.project_tasks drop constraint %I', c);
  end loop;
end $st$;
alter table public.project_tasks drop constraint if exists project_tasks_status_chk;
alter table public.project_tasks add  constraint project_tasks_status_chk check (status in
  ('backlog','todo','in_progress','internal_review','client_review','blocked','done','cancelled','in_review'));

-- ترحيل آمن: in_review → internal_review (ليست ضمن أي عدّاد done/cancelled فلا يتأثر شيء).
update public.project_tasks set status='internal_review', updated_at=now() where status='in_review';

-- فهارس للأعمدة/الروابط الجديدة (جزئية على غير المحذوف).
create index if not exists idx_ptasks_client_visible  on public.project_tasks(project_id) where client_visible and is_deleted = false;
create index if not exists idx_ptasks_deliverable      on public.project_tasks(deliverable_id)        where deliverable_id is not null and is_deleted = false;
create index if not exists idx_ptasks_shoot            on public.project_tasks(shoot_session_id)      where shoot_session_id is not null and is_deleted = false;
create index if not exists idx_ptasks_preprod          on public.project_tasks(preproduction_item_id) where preproduction_item_id is not null and is_deleted = false;

-- ═══ 2) project_task_assignees (نموذج المشاركين متعدّد الأدوار) ═══
create table if not exists public.project_task_assignees (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.project_tasks(id) on delete cascade,
  user_id         uuid not null references auth.users(id)          on delete cascade,
  assignment_role text not null default 'contributor'
                  check (assignment_role in ('owner','contributor','reviewer','watcher')),
  assigned_by     uuid references auth.users(id),
  assigned_at     timestamptz not null default now(),
  unique (task_id, user_id, assignment_role)
);
create index if not exists idx_ptask_assignees_task on public.project_task_assignees(task_id);
create index if not exists idx_ptask_assignees_user on public.project_task_assignees(user_id);
create index if not exists idx_ptask_assignees_role on public.project_task_assignees(task_id, assignment_role);

alter table public.project_task_assignees enable row level security;
-- قراءة: من يستطيع رؤية المهمة (pc_can_read_task) يرى مشاركيها. الكتابة عبر RPC (SECURITY DEFINER) فقط.
drop policy if exists ptask_assignees_read on public.project_task_assignees;
create policy ptask_assignees_read on public.project_task_assignees for select to authenticated
  using (public.pc_can_read_task(task_id) or user_id = auth.uid());
revoke insert, update, delete on public.project_task_assignees from authenticated, anon;
grant select on public.project_task_assignees to authenticated;

-- Backfill: كل مهمة لها assignee_id ⇒ صفّ owner (idempotent عبر unique + on conflict).
insert into public.project_task_assignees (task_id, user_id, assignment_role, assigned_by, assigned_at)
select t.id, t.assignee_id, 'owner', t.created_by, t.created_at
from public.project_tasks t
where t.assignee_id is not null and coalesce(t.is_deleted,false)=false
on conflict (task_id, user_id, assignment_role) do nothing;

-- ═══ 3) بذر مفاتيح الصلاحيات الناقصة (الباقي مبذور مسبقًا) ═══
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('tasks.delete',        'projects_tasks', 'normal', 122, 'حذف المهام (Soft)',     'Delete tasks (soft)'),
  ('tasks.change_status', 'projects_tasks', 'normal', 124, 'تغيير حالة المهمة',      'Change task status'),
  ('tasks.change_dates',  'projects_tasks', 'normal', 126, 'تغيير مواعيد المهمة',    'Change task dates'),
  ('tasks.review',        'projects_tasks', 'normal', 128, 'مراجعة المهام',          'Review tasks')
on conflict (key) do update set
  category=excluded.category, label_ar=excluded.label_ar, label_en=excluded.label_en, sort_order=excluded.sort_order;

-- منح المفاتيح الجديدة لمن يملك tasks.edit أصلًا (بقاء التكافؤ للمحرّرين/المدراء) — عبر المهن.
insert into public.profession_permissions (profession_id, permission_id)
select pp.profession_id, np.id
from public.profession_permissions pp
join public.permissions ep on ep.id = pp.permission_id and ep.key = 'tasks.edit'
cross join public.permissions np
where np.key in ('tasks.change_status','tasks.change_dates','tasks.review')
on conflict do nothing;

-- ═══ 4) RPCs ═══

-- 4.1 pc_task_create — نسخة أمينة من FINAL:622 + بوّابة صلاحية + حقول/روابط جديدة + صفّ owner.
create or replace function public.pc_task_create(p_project uuid, p_data jsonb)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_parent uuid; v_assignee uuid;
begin
  if not (public.can_manage_projects() or public.can_edit_project(p_project) or public.emp_has_permission('tasks.create'))
    then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_data->>'title'),'') = '' then raise exception 'title_required'; end if;
  v_parent := nullif(p_data->>'parent_task_id','')::uuid;
  if v_parent is not null and not exists (select 1 from public.project_tasks where id = v_parent and project_id = p_project)
    then raise exception 'bad_parent'; end if;
  v_assignee := nullif(p_data->>'assignee_id','')::uuid;
  insert into public.project_tasks(project_id, parent_task_id, title, description, status, priority,
      assignee_id, start_date, due_date, estimated_hours, labels, sort_order, recurring, created_by,
      client_visible, deliverable_id, shoot_session_id, preproduction_item_id, core_stage)
    values (p_project, v_parent, btrim(p_data->>'title'), nullif(p_data->>'description',''),
      coalesce(nullif(p_data->>'status',''),'todo'), coalesce(nullif(p_data->>'priority',''),'normal'),
      v_assignee, nullif(p_data->>'start_date','')::date, nullif(p_data->>'due_date','')::date,
      nullif(p_data->>'estimated_hours','')::numeric,
      coalesce((select array_agg(x) from jsonb_array_elements_text(case when jsonb_typeof(p_data->'labels')='array' then p_data->'labels' else '[]'::jsonb end) x), '{}'),
      coalesce(nullif(p_data->>'sort_order','')::int, 0), nullif(p_data->>'recurring',''), auth.uid(),
      coalesce((p_data->>'client_visible')::boolean, false),
      nullif(p_data->>'deliverable_id','')::uuid, nullif(p_data->>'shoot_session_id','')::uuid,
      nullif(p_data->>'preproduction_item_id','')::uuid, nullif(p_data->>'core_stage',''))
    returning * into r;
  perform public.pc_log(p_project, 'task_created', 'task', r.id, jsonb_build_object('title', r.title));
  if v_assignee is not null then
    insert into public.task_followers(task_id, user_id) values (r.id, v_assignee) on conflict do nothing;
    insert into public.project_task_assignees(task_id, user_id, assignment_role, assigned_by)
      values (r.id, v_assignee, 'owner', auth.uid()) on conflict (task_id,user_id,assignment_role) do nothing;
    perform public.pc_notify_user(v_assignee, 'project_note_new', 'task', r.id,
      'أُسندت إليك مهمة: '||r.title, 'Task assigned to you: '||r.title);
  end if;
  return r;
end $$;

-- 4.2 pc_task_update — نسخة أمينة من ABSOLUTE:790 (قفل تفاؤلي + Audit + إشعارات) + بوّابات
--     صلاحية حسب الحقول المتغيّرة + حقول جديدة. تبقى دلالة coalesce (set/replace فقط في 3A).
create or replace function public.pc_task_update(p_task uuid, p_data jsonb)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_old public.project_tasks; v_new_assignee uuid; v_exp timestamptz;
  v_ch_status boolean; v_ch_dates boolean; v_ch_assignee boolean; v_base boolean;
begin
  select * into v_old from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_old.id is null then raise exception 'not_found'; end if;

  -- بوّابات: أساس التحرير + بوّابة خاصة لكل نوع تغيير (يتجاوزها المدير/المحرّر بالمشروع).
  v_base := public.can_manage_projects() or public.can_edit_project(v_old.project_id);
  if not (v_base or public.emp_has_permission('tasks.edit')) then raise exception 'not authorized'; end if;
  v_ch_status   := nullif(p_data->>'status','')   is not null and (p_data->>'status')   is distinct from v_old.status;
  v_ch_dates    := (nullif(p_data->>'start_date','') is not null and (nullif(p_data->>'start_date','')::date) is distinct from v_old.start_date)
                or (nullif(p_data->>'due_date','')   is not null and (nullif(p_data->>'due_date','')::date)   is distinct from v_old.due_date);
  v_ch_assignee := nullif(p_data->>'assignee_id','') is not null and (nullif(p_data->>'assignee_id','')::uuid) is distinct from v_old.assignee_id;
  if v_ch_status   and not (v_base or public.emp_has_permission('tasks.change_status')) then raise exception 'not authorized: change_status'; end if;
  if v_ch_dates    and not (v_base or public.emp_has_permission('tasks.change_dates'))  then raise exception 'not authorized: change_dates';  end if;
  if v_ch_assignee and not (v_base or public.emp_has_permission('tasks.assign_employee')) then raise exception 'not authorized: assign'; end if;

  v_exp := nullif(p_data->>'expected_updated_at','')::timestamptz;
  if v_exp is not null and date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', v_exp) then
    raise exception 'stale_update';
  end if;
  v_new_assignee := coalesce(nullif(p_data->>'assignee_id','')::uuid, v_old.assignee_id);
  update public.project_tasks set
    title          = coalesce(nullif(p_data->>'title',''), title),
    description     = coalesce(nullif(p_data->>'description',''), description),
    status          = coalesce(nullif(p_data->>'status',''), status),
    priority        = coalesce(nullif(p_data->>'priority',''), priority),
    assignee_id     = v_new_assignee,
    start_date      = coalesce(nullif(p_data->>'start_date','')::date, start_date),
    due_date        = coalesce(nullif(p_data->>'due_date','')::date, due_date),
    estimated_hours = coalesce(nullif(p_data->>'estimated_hours','')::numeric, estimated_hours),
    actual_hours    = coalesce(nullif(p_data->>'actual_hours','')::numeric, actual_hours),
    labels          = case when jsonb_typeof(p_data->'labels')='array'
                        then coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'labels') x), labels) else labels end,
    sort_order      = coalesce(nullif(p_data->>'sort_order','')::int, sort_order),
    client_visible  = coalesce((p_data->>'client_visible')::boolean, client_visible),
    core_stage      = case when p_data ? 'core_stage' then nullif(p_data->>'core_stage','') else core_stage end,
    -- الإكمال 'done' يفرض 100؛ الخروج من 'done' يسمح بخفض النسبة (لا يجبرها إلا إذا مُرِّرت).
    progress_pct    = case when coalesce(nullif(p_data->>'status',''), status) = 'done' then 100
                           else coalesce(nullif(p_data->>'progress_pct','')::int, progress_pct) end,
    completed_at    = case when coalesce(nullif(p_data->>'status',''), status) = 'done' and completed_at is null then now()
                           when coalesce(nullif(p_data->>'status',''), status) <> 'done' then null else completed_at end,
    updated_at = now()
    where id = p_task returning * into r;
  perform public.pc_log(v_old.project_id, 'task_updated', 'task', p_task, jsonb_build_object(
    'patch', p_data - 'labels' - 'expected_updated_at',
    'before', jsonb_build_object('status', v_old.status, 'assignee', v_old.assignee_id, 'start', v_old.start_date, 'due', v_old.due_date, 'title', v_old.title),
    'after',  jsonb_build_object('status', r.status, 'assignee', r.assignee_id, 'start', r.start_date, 'due', r.due_date, 'title', r.title)));
  if v_new_assignee is distinct from v_old.assignee_id and v_new_assignee is not null then
    insert into public.task_followers(task_id, user_id) values (p_task, v_new_assignee) on conflict do nothing;
    insert into public.project_task_assignees(task_id, user_id, assignment_role, assigned_by)
      values (p_task, v_new_assignee, 'owner', auth.uid()) on conflict (task_id,user_id,assignment_role) do nothing;
    perform public.pc_notify_user(v_new_assignee, 'project_note_new', 'task', p_task,
      'أُسندت إليك مهمة: '||r.title, 'Task assigned to you: '||r.title);
  end if;
  if r.status is distinct from v_old.status then
    perform public.pc_notify_team(v_old.project_id, 'project_note_new', 'task', p_task,
      'تحدّثت حالة مهمة: '||r.title, 'Task status changed: '||r.title, auth.uid());
  end if;
  return r;
end $$;

-- 4.3 pc_task_assign — إضافة/إزالة مشارك بدور (project_task_assignees) + مزامنة owner→assignee_id.
create or replace function public.pc_task_assign(p_task uuid, p_user uuid, p_role text default 'contributor', p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_task public.project_tasks; v_name text;
begin
  select * into v_task from public.project_tasks where id = p_task and is_deleted = false;
  if v_task.id is null then raise exception 'not_found'; end if;
  if not (public.can_manage_projects() or public.can_edit_project(v_task.project_id) or public.emp_has_permission('tasks.assign_employee'))
    then raise exception 'not authorized'; end if;
  if p_role not in ('owner','contributor','reviewer','watcher') then raise exception 'bad_role'; end if;
  if p_user is null then raise exception 'user_required'; end if;
  select coalesce(full_name, email) into v_name from public.profiles where id = p_user;

  if p_on then
    insert into public.project_task_assignees(task_id, user_id, assignment_role, assigned_by)
      values (p_task, p_user, p_role, auth.uid()) on conflict (task_id,user_id,assignment_role) do nothing;
    insert into public.task_followers(task_id, user_id) values (p_task, p_user) on conflict do nothing;
    if p_role = 'owner' then
      update public.project_tasks set assignee_id = p_user, updated_at = now() where id = p_task;
    end if;
    perform public.pc_log(v_task.project_id, 'task_assigned', 'task', p_task,
      jsonb_build_object('user', p_user, 'role', p_role));
    perform public.pc_notify_user(p_user, 'project_note_new', 'task', p_task,
      'أُسندت إليك مهمة ('||p_role||'): '||v_task.title, 'You were added to a task ('||p_role||'): '||v_task.title);
  else
    delete from public.project_task_assignees where task_id = p_task and user_id = p_user and assignment_role = p_role;
    if p_role = 'owner' then
      update public.project_tasks set assignee_id = null, updated_at = now() where id = p_task and assignee_id = p_user;
    end if;
    perform public.pc_log(v_task.project_id, 'task_unassigned', 'task', p_task,
      jsonb_build_object('user', p_user, 'role', p_role));
  end if;
  return jsonb_build_object('ok', true, 'task_id', p_task, 'user_id', p_user, 'role', p_role, 'on', p_on);
end $$;

-- 4.4 pc_task_set_parent — تعيين/إزالة الأب مع حارس دورات (لا حلقات، نفس المشروع، لا self).
create or replace function public.pc_task_set_parent(p_task uuid, p_parent uuid)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_task public.project_tasks;
begin
  select * into v_task from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_task.id is null then raise exception 'not_found'; end if;
  if not (public.can_manage_projects() or public.can_edit_project(v_task.project_id) or public.emp_has_permission('tasks.edit'))
    then raise exception 'not authorized'; end if;

  if p_parent is null then
    update public.project_tasks set parent_task_id = null, updated_at = now() where id = p_task returning * into r;
    perform public.pc_log(v_task.project_id, 'task_updated', 'task', p_task, jsonb_build_object('parent', null));
    return r;
  end if;
  if p_parent = p_task then raise exception 'self_parent'; end if;
  if not exists (select 1 from public.project_tasks where id = p_parent and project_id = v_task.project_id and is_deleted = false)
    then raise exception 'bad_parent'; end if;
  -- حارس الدورات: الأب المقترح يجب ألّا يكون من نسل المهمة (وإلّا تنشأ حلقة).
  if exists (
    with recursive desc_tree as (
      select id from public.project_tasks where parent_task_id = p_task
      union all
      select t.id from public.project_tasks t join desc_tree d on t.parent_task_id = d.id
    ) select 1 from desc_tree where id = p_parent
  ) then raise exception 'cycle_detected'; end if;

  update public.project_tasks set parent_task_id = p_parent, updated_at = now() where id = p_task returning * into r;
  perform public.pc_log(v_task.project_id, 'task_updated', 'task', p_task, jsonb_build_object('parent', p_parent));
  return r;
end $$;

-- 4.5 project_task_progress — تقدّم قائم على المهام، مستقل عن نسبة المشروع (لا يعدّلها).
--     cancelled مُستبعد؛ 'done' = 100؛ النسبة = متوسط progress_pct للمهام غير الملغاة.
create or replace function public.project_task_progress(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_total int; v_active int; v_done int; v_pct int; v_overdue int;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select
    count(*) filter (where status <> 'cancelled'),
    count(*) filter (where status not in ('done','cancelled')),
    count(*) filter (where status = 'done'),
    count(*) filter (where status not in ('done','cancelled') and due_date is not null and due_date < (now() at time zone 'utc')::date),
    coalesce(round(avg(case when status='done' then 100 else progress_pct end)
             filter (where status <> 'cancelled'))::int, 0)
  into v_total, v_active, v_done, v_overdue, v_pct
  from public.project_tasks
  where project_id = p_project and coalesce(is_deleted,false)=false;
  return jsonb_build_object('total', v_total, 'active', v_active, 'done', v_done,
    'overdue', v_overdue, 'pct', coalesce(v_pct,0));
end $$;

-- 4.6 pc_project_task_assignees — كل مشاركي مهام المشروع المرئية (لتفادي N+1 في الواجهة).
create or replace function public.pc_project_task_assignees(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'task_id', a.task_id, 'user_id', a.user_id, 'role', a.assignment_role,
      'name', coalesce(pr.full_name, pr.email))), '[]'::jsonb) into v
  from public.project_task_assignees a
  join public.project_tasks t on t.id = a.task_id and t.project_id = p_project and coalesce(t.is_deleted,false)=false
  left join public.profiles pr on pr.id = a.user_id;
  return v;
end $$;

-- ═══ 5) RLS: توسعة القراءة (مشاركون + client_visible للعميل) — نسخة أمينة من ptasks_read الفائز ═══
create or replace function public.pc_can_read_task(p_task uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.project_tasks t
    where t.id = p_task and (
         public.pc_can_read_project(t.project_id) and (
              public.can_manage_projects() or public.is_admin() or public.staff_reads_all_projects()
           or public.emp_can('view_all_tasks') or t.assignee_id = auth.uid() or t.created_by = auth.uid()
           or (t.visibility = 'profession' and (t.profession_id is null or t.profession_id = any (public.emp_profession_ids())))
           or exists (select 1 from public.project_task_assignees a where a.task_id = t.id and a.user_id = auth.uid())
         )
      or (t.client_visible and public.is_client_side(t.project_id))
    )
  );
$$;

drop policy if exists ptasks_read on public.project_tasks;
create policy ptasks_read on public.project_tasks for select to authenticated
using (
  (
    public.pc_can_read_project(project_id)
    and (
          public.can_manage_projects() or public.is_admin() or public.staff_reads_all_projects()
       or public.emp_can('view_all_tasks') or assignee_id = auth.uid() or created_by = auth.uid()
       or (visibility = 'profession' and (profession_id is null or profession_id = any (public.emp_profession_ids())))
       or exists (select 1 from public.project_task_assignees a where a.task_id = id and a.user_id = auth.uid())
    )
  )
  or (client_visible and public.is_client_side(project_id))
);

-- ═══ 6) Grants + reload ═══
do $g$
begin
  execute 'grant execute on function public.pc_task_create(uuid,jsonb) to authenticated';
  execute 'grant execute on function public.pc_task_update(uuid,jsonb) to authenticated';
  execute 'grant execute on function public.pc_task_assign(uuid,uuid,text,boolean) to authenticated';
  execute 'grant execute on function public.pc_task_set_parent(uuid,uuid) to authenticated';
  execute 'grant execute on function public.project_task_progress(uuid) to authenticated';
  execute 'grant execute on function public.pc_project_task_assignees(uuid) to authenticated';
  execute 'grant execute on function public.pc_can_read_task(uuid) to authenticated';
end $g$;

-- ═══ 7) تشخيص بعد (يُطبع في NOTICE) ═══
do $d$
declare v_tasks int; v_assignees int; v_legacy int; v_newcols int;
begin
  select count(*) into v_tasks from public.project_tasks where coalesce(is_deleted,false)=false;
  select count(*) into v_assignees from public.project_task_assignees;
  select count(*) into v_legacy from public.project_tasks where status='in_review';
  select count(*) into v_newcols from information_schema.columns
    where table_schema='public' and table_name='project_tasks'
      and column_name in ('client_visible','deliverable_id','shoot_session_id','preproduction_item_id','core_stage');
  raise notice 'batch3a: tasks=%, assignees(after backfill)=%, legacy in_review remaining=% (must be 0), new columns present=%/5',
    v_tasks, v_assignees, v_legacy, v_newcols;
  if v_legacy <> 0 then raise exception 'ترحيل in_review لم يكتمل (متبقٍّ %)', v_legacy; end if;
  if v_newcols <> 5 then raise exception 'أعمدة جديدة ناقصة (%/5)', v_newcols; end if;
end $d$;

commit;

notify pgrst, 'reload schema';

-- ── تحقّق اختياري بعد الـcommit ──
--   select key from public.permissions where key in ('tasks.delete','tasks.change_status','tasks.change_dates','tasks.review');
--   select public.project_task_progress('<PROJECT_ID>');
