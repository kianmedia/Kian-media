-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT CORE — الإغلاق النهائي المطلق (ABSOLUTE FINAL)
-- يُشغَّل مرة واحدة فوق Production الحالية بعد تطبيق:
--   project_core_FINAL_RUNME.sql + project_core_UI_COMPLETION_RUNME.sql
--   + project_core_FINAL_COMPLETION_RUNME.sql + project_core_REMAINING_MODULES_FINAL_RUNME.sql
--   + project_core_OPERATIONAL_CLOSURE_FINAL_RUNME.sql + project_core_FINANCE_RUNME.sql
--
-- Idempotent · Production-safe · لا حذف بيانات · لا Fixtures · لا إعادة إنشاء جداول سابقة.
-- الترتيب: Preflight → BEGIN → جداول → فهارس → دوال → RPCs → Triggers → RLS →
--          Policies → Grants → Validation → NOTIFY → COMMIT.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ PREFLIGHT — فحص الاعتمادات قبل فتح المعاملة (خطأ عربي واضح عند النقص) ═══
do $pf$
declare miss text := '';
begin
  if to_regclass('public.projects')                is null then miss := miss || ' projects'; end if;
  if to_regclass('public.project_core')            is null then miss := miss || ' project_core'; end if;
  if to_regclass('public.project_tasks')           is null then miss := miss || ' project_tasks'; end if;
  if to_regclass('public.project_meetings')        is null then miss := miss || ' project_meetings'; end if;
  if to_regclass('public.project_shoot_sessions')  is null then miss := miss || ' project_shoot_sessions'; end if;
  if to_regclass('public.project_locations')       is null then miss := miss || ' project_locations'; end if;
  if to_regclass('public.project_approvals')       is null then miss := miss || ' project_approvals'; end if;
  if to_regclass('public.task_dependencies')       is null then miss := miss || ' task_dependencies'; end if;
  if to_regclass('public.deliverables')            is null then miss := miss || ' deliverables'; end if;
  if miss <> '' then
    raise exception 'نقص في الاعتمادات: الجداول التالية غير موجودة (%). شغّل project_core_FINAL_RUNME.sql وبقية ملفات Project Core أولًا.', miss;
  end if;
  miss := '';
  if to_regprocedure('public.is_owner()')                                            is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.is_staff()')                                            is null then miss := miss || ' is_staff()'; end if;
  if to_regprocedure('public.can_manage_projects()')                                 is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.can_edit_project(uuid)')                                is null then miss := miss || ' can_edit_project(uuid)'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)')                             is null then miss := miss || ' pc_can_read_project(uuid)'; end if;
  if to_regprocedure('public.pc_log(uuid,text,text,uuid,jsonb)')                     is null then miss := miss || ' pc_log'; end if;
  if to_regprocedure('public.pc_notify_user(uuid,text,text,uuid,text,text)')         is null then miss := miss || ' pc_notify_user'; end if;
  if to_regprocedure('public.pc_notify_team(uuid,text,text,uuid,text,text,uuid)')    is null then miss := miss || ' pc_notify_team'; end if;
  if to_regprocedure('public.pc_touch_updated_at()')                                 is null then miss := miss || ' pc_touch_updated_at()'; end if;
  if miss <> '' then
    raise exception 'نقص في الاعتمادات: الدوال التالية غير موجودة (%). شغّل ملفات Project Core السابقة بالترتيب أولًا.', miss;
  end if;
end $pf$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 1 — الخطة الزمنية الموحّدة (Schedule) + التغذية الموحّدة للتقويم وGantt
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B1.1 جدول عناصر الخطة الزمنية (مصدر الأحداث المستقلة) ═══
create table if not exists public.project_schedule_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  title             text not null,
  description       text,
  event_type        text not null default 'custom_event'
                    check (event_type in ('project_phase','milestone','task','shoot_session','meeting',
                      'internal_review','client_review','deliverable_due','final_delivery',
                      'equipment_preparation','equipment_return','travel','approval','custom_event')),
  start_at          timestamptz not null,
  end_at            timestamptz,
  all_day           boolean not null default false,
  timezone          text not null default 'Asia/Riyadh',
  status            text not null default 'planned'
                    check (status in ('planned','confirmed','in_progress','done','cancelled')),
  priority          text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  progress          int  not null default 0 check (progress between 0 and 100),
  assigned_to       uuid references auth.users(id) on delete set null,
  participants      uuid[] not null default '{}',
  location_id       uuid references public.project_locations(id) on delete set null,
  shoot_session_id  uuid references public.project_shoot_sessions(id) on delete set null,
  task_id           uuid references public.project_tasks(id) on delete set null,
  deliverable_id    uuid references public.deliverables(id) on delete set null,
  meeting_id        uuid references public.project_meetings(id) on delete set null,
  approval_id       uuid references public.project_approvals(id) on delete set null,
  phase             text,
  is_milestone      boolean not null default false,
  client_visible    boolean not null default false,
  reminder_at       timestamptz,
  cancel_reason     text,
  notes             text,
  created_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_by        uuid,
  updated_at        timestamptz not null default now(),
  is_deleted        boolean not null default false,
  deleted_at        timestamptz,
  deleted_by        uuid,
  delete_reason     text,
  constraint psi_dates_ok check (end_at is null or end_at >= start_at)
);

-- ═══ B1.2 اعتماديات عناصر الخطة (منع الذات؛ منع الدائرية في الـRPC) ═══
create table if not exists public.project_schedule_dependencies (
  item_id            uuid not null references public.project_schedule_items(id) on delete cascade,
  depends_on_item_id uuid not null references public.project_schedule_items(id) on delete cascade,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  primary key (item_id, depends_on_item_id),
  constraint psd_no_self check (item_id <> depends_on_item_id)
);

-- ═══ B1.3 الفهارس ═══
create index if not exists idx_psi_project_start on public.project_schedule_items(project_id, start_at) where is_deleted = false;
create index if not exists idx_psi_assigned      on public.project_schedule_items(assigned_to) where is_deleted = false;
create index if not exists idx_psi_reminder      on public.project_schedule_items(reminder_at) where reminder_at is not null and is_deleted = false;
create index if not exists idx_psd_depends       on public.project_schedule_dependencies(depends_on_item_id);

-- ═══ B1.4 إنشاء/تعديل عنصر خطة — تحقّق روابط + قفل تفاؤلي + Audit + إشعار المكلَّف ═══
create or replace function public.pc_schedule_upsert(p_project uuid, p_data jsonb)
returns public.project_schedule_items language plpgsql security definer set search_path = public as $$
declare
  r public.project_schedule_items; v_id uuid; v_exp timestamptz; v_old public.project_schedule_items;
  v_start timestamptz; v_end timestamptz; v_parts uuid[];
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then
    raise exception 'not authorized';
  end if;
  v_id  := nullif(p_data->>'id','')::uuid;
  if coalesce(btrim(p_data->>'title'),'') = '' then raise exception 'title_required'; end if;
  v_start := nullif(p_data->>'start_at','')::timestamptz;
  v_end   := nullif(p_data->>'end_at','')::timestamptz;
  if v_id is null and v_start is null then raise exception 'start_required'; end if;
  if v_start is not null and v_end is not null and v_end < v_start then raise exception 'bad_dates'; end if;
  -- الروابط يجب أن تنتمي لنفس المشروع (سلامة مرجعية عبر المشاريع).
  if nullif(p_data->>'task_id','') is not null and not exists
     (select 1 from public.project_tasks where id = (p_data->>'task_id')::uuid and project_id = p_project) then raise exception 'bad_link'; end if;
  if nullif(p_data->>'meeting_id','') is not null and not exists
     (select 1 from public.project_meetings where id = (p_data->>'meeting_id')::uuid and project_id = p_project) then raise exception 'bad_link'; end if;
  if nullif(p_data->>'shoot_session_id','') is not null and not exists
     (select 1 from public.project_shoot_sessions where id = (p_data->>'shoot_session_id')::uuid and project_id = p_project) then raise exception 'bad_link'; end if;
  if nullif(p_data->>'location_id','') is not null and not exists
     (select 1 from public.project_locations where id = (p_data->>'location_id')::uuid and project_id = p_project) then raise exception 'bad_link'; end if;
  if nullif(p_data->>'approval_id','') is not null and not exists
     (select 1 from public.project_approvals where id = (p_data->>'approval_id')::uuid and project_id = p_project) then raise exception 'bad_link'; end if;
  if nullif(p_data->>'deliverable_id','') is not null and not exists
     (select 1 from public.deliverables where id = (p_data->>'deliverable_id')::uuid and project_id = p_project) then raise exception 'bad_link'; end if;
  -- المنطقة الزمنية: يجب أن تكون معرّفة لدى Postgres وإلا كسرت تحويلات Gantt لاحقًا.
  if nullif(p_data->>'timezone','') is not null then
    begin
      perform now() at time zone (p_data->>'timezone');
    exception when others then
      raise exception 'bad_timezone';
    end;
  end if;
  -- المشاركون: مصفوفة UUIDs من JSON.
  select coalesce(array_agg(x::uuid), '{}') into v_parts
    from jsonb_array_elements_text(case when jsonb_typeof(p_data->'participants')='array' then p_data->'participants' else '[]'::jsonb end) as t(x);

  if v_id is null then
    insert into public.project_schedule_items(
      project_id, title, description, event_type, start_at, end_at, all_day, timezone, status, priority, progress,
      assigned_to, participants, location_id, shoot_session_id, task_id, deliverable_id, meeting_id, approval_id,
      phase, is_milestone, client_visible, reminder_at, notes, created_by, updated_by)
    values (
      p_project, btrim(p_data->>'title'), nullif(btrim(coalesce(p_data->>'description','')),''),
      coalesce(nullif(p_data->>'event_type',''),'custom_event'), v_start, v_end,
      coalesce((p_data->>'all_day')::boolean, false), coalesce(nullif(p_data->>'timezone',''),'Asia/Riyadh'),
      coalesce(nullif(p_data->>'status',''),'planned'), coalesce(nullif(p_data->>'priority',''),'normal'),
      coalesce(nullif(p_data->>'progress','')::int, 0),
      nullif(p_data->>'assigned_to','')::uuid, v_parts,
      nullif(p_data->>'location_id','')::uuid, nullif(p_data->>'shoot_session_id','')::uuid,
      nullif(p_data->>'task_id','')::uuid, nullif(p_data->>'deliverable_id','')::uuid,
      nullif(p_data->>'meeting_id','')::uuid, nullif(p_data->>'approval_id','')::uuid,
      nullif(btrim(coalesce(p_data->>'phase','')),''), coalesce((p_data->>'is_milestone')::boolean, false),
      coalesce((p_data->>'client_visible')::boolean, false), nullif(p_data->>'reminder_at','')::timestamptz,
      nullif(btrim(coalesce(p_data->>'notes','')),''), auth.uid(), auth.uid())
    returning * into r;
    perform public.pc_log(p_project, 'schedule_created', 'schedule', r.id, jsonb_build_object('title', r.title, 'type', r.event_type));
    if r.assigned_to is not null and r.assigned_to <> auth.uid() then
      perform public.pc_notify_user(r.assigned_to, 'project_note_new', 'schedule', r.id,
        'كُلِّفت بموعد في الخطة الزمنية: '||r.title, 'You were assigned a schedule item: '||r.title);
    end if;
  else
    select * into v_old from public.project_schedule_items where id = v_id and project_id = p_project for update;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.is_deleted then raise exception 'item_deleted'; end if;
    -- قفل تفاؤلي — يمنع Lost Update.
    v_exp := nullif(p_data->>'expected_updated_at','')::timestamptz;
    if v_exp is not null and date_trunc('milliseconds', v_old.updated_at) <> date_trunc('milliseconds', v_exp) then
      raise exception 'stale_update';
    end if;
    update public.project_schedule_items set
      title          = btrim(p_data->>'title'),
      description    = case when p_data ? 'description' then nullif(btrim(coalesce(p_data->>'description','')),'') else description end,
      event_type     = coalesce(nullif(p_data->>'event_type',''), event_type),
      start_at       = coalesce(v_start, start_at),
      end_at         = case when p_data ? 'end_at' then v_end else end_at end,
      all_day        = coalesce((p_data->>'all_day')::boolean, all_day),
      timezone       = coalesce(nullif(p_data->>'timezone',''), timezone),
      status         = coalesce(nullif(p_data->>'status',''), status),
      priority       = coalesce(nullif(p_data->>'priority',''), priority),
      progress       = coalesce(nullif(p_data->>'progress','')::int, progress),
      assigned_to    = case when p_data ? 'assigned_to' then nullif(p_data->>'assigned_to','')::uuid else assigned_to end,
      participants   = case when p_data ? 'participants' then v_parts else participants end,
      location_id    = case when p_data ? 'location_id' then nullif(p_data->>'location_id','')::uuid else location_id end,
      shoot_session_id = case when p_data ? 'shoot_session_id' then nullif(p_data->>'shoot_session_id','')::uuid else shoot_session_id end,
      task_id        = case when p_data ? 'task_id' then nullif(p_data->>'task_id','')::uuid else task_id end,
      deliverable_id = case when p_data ? 'deliverable_id' then nullif(p_data->>'deliverable_id','')::uuid else deliverable_id end,
      meeting_id     = case when p_data ? 'meeting_id' then nullif(p_data->>'meeting_id','')::uuid else meeting_id end,
      approval_id    = case when p_data ? 'approval_id' then nullif(p_data->>'approval_id','')::uuid else approval_id end,
      phase          = case when p_data ? 'phase' then nullif(btrim(coalesce(p_data->>'phase','')),'') else phase end,
      is_milestone   = coalesce((p_data->>'is_milestone')::boolean, is_milestone),
      client_visible = coalesce((p_data->>'client_visible')::boolean, client_visible),
      reminder_at    = case when p_data ? 'reminder_at' then nullif(p_data->>'reminder_at','')::timestamptz else reminder_at end,
      notes          = case when p_data ? 'notes' then nullif(btrim(coalesce(p_data->>'notes','')),'') else notes end,
      updated_at = now(), updated_by = auth.uid()
    where id = v_id
    returning * into r;
    if r.end_at is not null and r.end_at < r.start_at then raise exception 'bad_dates'; end if;
    perform public.pc_log(p_project, 'schedule_updated', 'schedule', r.id,
      jsonb_build_object('title', r.title, 'before', jsonb_build_object('start', v_old.start_at, 'end', v_old.end_at, 'status', v_old.status),
                         'after', jsonb_build_object('start', r.start_at, 'end', r.end_at, 'status', r.status)));
    if r.assigned_to is not null and r.assigned_to is distinct from v_old.assigned_to and r.assigned_to <> auth.uid() then
      perform public.pc_notify_user(r.assigned_to, 'project_note_new', 'schedule', r.id,
        'كُلِّفت بموعد في الخطة الزمنية: '||r.title, 'You were assigned a schedule item: '||r.title);
    end if;
  end if;
  return r;
end $$;

-- ═══ B1.5 تغيير حالة عنصر — المدير أو المكلَّف/المشارك؛ الإلغاء بسبب إلزامي ═══
create or replace function public.pc_schedule_set_status(p_item uuid, p_status text, p_reason text default null)
returns public.project_schedule_items language plpgsql security definer set search_path = public as $$
declare r public.project_schedule_items;
begin
  select * into r from public.project_schedule_items where id = p_item and is_deleted = false for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not (public.can_manage_projects() or public.can_edit_project(r.project_id)
          or r.assigned_to = auth.uid() or auth.uid() = any(r.participants)) then
    raise exception 'not authorized';
  end if;
  if p_status not in ('planned','confirmed','in_progress','done','cancelled') then raise exception 'bad_state'; end if;
  if p_status = 'cancelled' and coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  update public.project_schedule_items set
    status = p_status,
    progress = case when p_status = 'done' then 100 else progress end,
    cancel_reason = case when p_status = 'cancelled' then left(btrim(p_reason),500) else null end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_item returning * into r;
  perform public.pc_log(r.project_id, 'schedule_status', 'schedule', r.id, jsonb_build_object('status', p_status, 'reason', p_reason));
  if p_status = 'cancelled' then
    perform public.pc_notify_team(r.project_id, 'project_note_new', 'schedule', r.id,
      'أُلغي موعد من الخطة الزمنية: '||r.title, 'Schedule item cancelled: '||r.title, auth.uid());
  end if;
  return r;
end $$;

-- ═══ B1.6 حذف ناعم بسبب + استعادة ═══
create or replace function public.pc_schedule_delete(p_item uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r public.project_schedule_items;
begin
  select * into r from public.project_schedule_items where id = p_item and is_deleted = false for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(r.project_id) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  update public.project_schedule_items set
    is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), delete_reason = left(btrim(p_reason),500),
    updated_at = now(), updated_by = auth.uid()
  where id = p_item;
  perform public.pc_log(r.project_id, 'schedule_deleted', 'schedule', p_item, jsonb_build_object('title', r.title, 'reason', p_reason));
  return true;
end $$;

create or replace function public.pc_schedule_restore(p_item uuid)
returns public.project_schedule_items language plpgsql security definer set search_path = public as $$
declare r public.project_schedule_items;
begin
  select * into r from public.project_schedule_items where id = p_item and is_deleted = true for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(r.project_id) then raise exception 'not authorized'; end if;
  update public.project_schedule_items set
    is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null,
    updated_at = now(), updated_by = auth.uid()
  where id = p_item returning * into r;
  perform public.pc_log(r.project_id, 'schedule_restored', 'schedule', p_item, jsonb_build_object('title', r.title));
  return r;
end $$;

-- ═══ B1.7 اعتمادية عنصر خطة — منع الذات والدائرية وعبور المشاريع ═══
create or replace function public.pc_schedule_dependency_set(p_item uuid, p_depends_on uuid, p_on boolean default true)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_proj2 uuid;
begin
  select project_id into v_proj  from public.project_schedule_items where id = p_item and is_deleted = false;
  select project_id into v_proj2 from public.project_schedule_items where id = p_depends_on and is_deleted = false;
  if v_proj is null or v_proj2 is null then raise exception 'not_found'; end if;
  if v_proj <> v_proj2 then raise exception 'cross_project_dependency'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  if p_item = p_depends_on then raise exception 'self_dependency'; end if;
  if not p_on then
    delete from public.project_schedule_dependencies where item_id = p_item and depends_on_item_id = p_depends_on;
    return true;
  end if;
  -- تسلسل فحوص الدورة لكل مشروع — يمنع سباق إدخالين متزامنين يكوّنان دورة.
  perform pg_advisory_xact_lock(hashtext('pc_sched_dep:' || v_proj::text));
  -- منع الدورة: هل يصل p_item إلى p_depends_on عبر سلسلة الاعتماديات؟
  if exists (
    with recursive chain as (
      select depends_on_item_id as nid from public.project_schedule_dependencies where item_id = p_depends_on
      union
      select d.depends_on_item_id from public.project_schedule_dependencies d join chain c on d.item_id = c.nid
    ) select 1 from chain where nid = p_item
  ) then raise exception 'circular_dependency'; end if;
  insert into public.project_schedule_dependencies(item_id, depends_on_item_id, created_by)
    values (p_item, p_depends_on, auth.uid()) on conflict do nothing;
  perform public.pc_log(v_proj, 'schedule_dependency', 'schedule', p_item, jsonb_build_object('depends_on', p_depends_on));
  return true;
end $$;

-- ═══ B1.8 التغذية الموحّدة — عناصر الخطة + المهام + الاجتماعات + الجلسات + معالم المشروع ═══
-- مصدر حقيقة واحد للخطة الزمنية والتقويم؛ p_deleted=true يُظهر المحذوف (للمديرين فقط).
create or replace function public.project_core_schedule(
  p_project uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_types text[] default null, p_assignee uuid default null, p_deleted boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_mgr boolean;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  v_mgr := public.can_manage_projects() or public.can_edit_project(p_project);
  select coalesce(jsonb_agg(row order by (row->>'start_at')), '[]'::jsonb) into v from (
    -- عناصر الخطة الزمنية المستقلة
    select jsonb_build_object(
      'id', s.id, 'source', 'schedule', 'event_type', s.event_type, 'title', s.title,
      'description', s.description, 'start_at', s.start_at, 'end_at', s.end_at, 'all_day', s.all_day,
      'status', s.status, 'priority', s.priority, 'progress', s.progress, 'assignee_id', s.assigned_to,
      'participants', to_jsonb(s.participants), 'is_milestone', s.is_milestone, 'client_visible', s.client_visible,
      'phase', s.phase, 'location_id', s.location_id, 'shoot_session_id', s.shoot_session_id, 'task_id', s.task_id,
      'meeting_id', s.meeting_id, 'deliverable_id', s.deliverable_id, 'reminder_at', s.reminder_at, 'notes', s.notes,
      'cancel_reason', s.cancel_reason, 'deleted', s.is_deleted, 'delete_reason', s.delete_reason,
      'updated_at', s.updated_at) as row
    from public.project_schedule_items s
    where s.project_id = p_project
      and (case when p_deleted and v_mgr then true else s.is_deleted = false end)
      and (p_from is null or coalesce(s.end_at, s.start_at) >= p_from)
      and (p_to   is null or s.start_at <= p_to)
      and (p_types is null or s.event_type = any(p_types))
      and (p_assignee is null or s.assigned_to = p_assignee or p_assignee = any(s.participants))
    union all
    -- المهام ذات التواريخ
    select jsonb_build_object(
      'id', t.id, 'source', 'task', 'event_type', 'task', 'title', t.title,
      'start_at', coalesce(t.start_date, t.due_date)::timestamptz, 'end_at', t.due_date::timestamptz, 'all_day', true,
      'status', t.status, 'priority', t.priority, 'progress', t.progress_pct, 'assignee_id', t.assignee_id,
      'is_milestone', false, 'client_visible', false, 'deleted', false, 'updated_at', t.updated_at)
    from public.project_tasks t
    where t.project_id = p_project and t.is_deleted = false and coalesce(t.start_date, t.due_date) is not null
      and (p_from is null or coalesce(t.due_date, t.start_date)::timestamptz >= p_from)
      and (p_to   is null or coalesce(t.start_date, t.due_date)::timestamptz <= p_to)
      and (p_types is null or 'task' = any(p_types))
      and (p_assignee is null or t.assignee_id = p_assignee)
    union all
    -- الاجتماعات
    select jsonb_build_object(
      'id', m.id, 'source', 'meeting', 'event_type', 'meeting', 'title', m.title,
      'start_at', m.scheduled_at, 'end_at', m.scheduled_at + make_interval(mins => coalesce(m.duration_minutes, 60)),
      'all_day', false, 'status', 'planned', 'priority', 'normal', 'progress', 0, 'assignee_id', null,
      'is_milestone', false, 'client_visible', false, 'deleted', false, 'location_text', m.location, 'updated_at', m.created_at)
    from public.project_meetings m
    where m.project_id = p_project and m.is_deleted = false and m.scheduled_at is not null
      and (p_from is null or m.scheduled_at >= p_from) and (p_to is null or m.scheduled_at <= p_to)
      and (p_types is null or 'meeting' = any(p_types))
      and p_assignee is null
    union all
    -- جلسات التصوير
    select jsonb_build_object(
      'id', sh.id, 'source', 'shoot', 'event_type', 'shoot_session', 'title', sh.title,
      'start_at', coalesce(sh.call_time, sh.session_date::timestamptz), 'end_at', null,
      'all_day', sh.call_time is null, 'status', sh.status, 'priority', 'high', 'progress', 0, 'assignee_id', null,
      'is_milestone', false, 'client_visible', false, 'deleted', false, 'location_text', sh.location, 'updated_at', sh.updated_at)
    from public.project_shoot_sessions sh
    where sh.project_id = p_project and sh.is_deleted = false and coalesce(sh.call_time, sh.session_date::timestamptz) is not null
      and (p_from is null or coalesce(sh.call_time, sh.session_date::timestamptz) >= p_from)
      and (p_to   is null or coalesce(sh.call_time, sh.session_date::timestamptz) <= p_to)
      and (p_types is null or 'shoot_session' = any(p_types))
      and p_assignee is null
    union all
    -- معالم المشروع (الموعد النهائي والتسليم)
    select jsonb_build_object(
      'id', pcx.project_id::text || ':' || d.kind, 'source', 'project', 'event_type', 'milestone',
      'title', case when d.kind = 'due' then 'الموعد النهائي للمشروع' else 'موعد تسليم المشروع' end,
      'start_at', d.dt::timestamptz, 'end_at', null, 'all_day', true, 'status', 'planned', 'priority', 'urgent',
      'progress', 0, 'assignee_id', null, 'is_milestone', true, 'client_visible', true, 'deleted', false, 'updated_at', pcx.updated_at)
    from public.project_core pcx
    cross join lateral (values ('due', pcx.due_date), ('delivery', pcx.delivery_date)) as d(kind, dt)
    where pcx.project_id = p_project and d.dt is not null
      and (p_from is null or d.dt::timestamptz >= p_from) and (p_to is null or d.dt::timestamptz <= p_to)
      and (p_types is null or 'milestone' = any(p_types))
      and p_assignee is null
  ) rows(row);
  return jsonb_build_object('items', v);
end $$;

-- ═══ B1.9 Gantt الموحّد — أشرطة (خطة+مهام+جلسات) + اعتماديات (مهام + خطة) ═══
create or replace function public.project_core_gantt(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_bars jsonb; v_deps jsonb;
begin
  if not public.pc_can_read_project(p_project) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(b order by (b->>'start')), '[]'::jsonb) into v_bars from (
    select jsonb_build_object('id', 'sched:'||s.id, 'raw_id', s.id, 'source', 'schedule', 'kind', s.event_type,
      'title', s.title, 'start', (s.start_at at time zone s.timezone)::date, 'end', (coalesce(s.end_at, s.start_at) at time zone s.timezone)::date,
      'progress', s.progress, 'status', s.status, 'assignee_id', s.assigned_to, 'milestone', s.is_milestone, 'phase', s.phase, 'updated_at', s.updated_at) as b
    from public.project_schedule_items s
    where s.project_id = p_project and s.is_deleted = false and s.status <> 'cancelled'
    union all
    select jsonb_build_object('id', 'task:'||t.id, 'raw_id', t.id, 'source', 'task', 'kind', 'task',
      'title', t.title, 'start', coalesce(t.start_date, t.due_date), 'end', coalesce(t.due_date, t.start_date),
      'progress', t.progress_pct, 'status', t.status, 'assignee_id', t.assignee_id, 'milestone', false, 'phase', null, 'updated_at', t.updated_at)
    from public.project_tasks t
    where t.project_id = p_project and t.is_deleted = false and t.status <> 'cancelled' and coalesce(t.start_date, t.due_date) is not null
    union all
    select jsonb_build_object('id', 'shoot:'||sh.id, 'raw_id', sh.id, 'source', 'shoot', 'kind', 'shoot_session',
      'title', sh.title, 'start', sh.session_date, 'end', sh.session_date,
      'progress', case when sh.status = 'completed' then 100 else 0 end, 'status', sh.status, 'assignee_id', null,
      'milestone', false, 'phase', null, 'updated_at', sh.updated_at)
    from public.project_shoot_sessions sh
    where sh.project_id = p_project and sh.is_deleted = false and sh.status <> 'cancelled' and sh.session_date is not null
  ) bars(b);
  select coalesce(jsonb_agg(d), '[]'::jsonb) into v_deps from (
    select jsonb_build_object('from', 'task:'||td.depends_on_task_id, 'to', 'task:'||td.task_id) as d
    from public.task_dependencies td
    join public.project_tasks t on t.id = td.task_id
    where t.project_id = p_project and t.is_deleted = false
    union all
    select jsonb_build_object('from', 'sched:'||sd.depends_on_item_id, 'to', 'sched:'||sd.item_id)
    from public.project_schedule_dependencies sd
    join public.project_schedule_items si on si.id = sd.item_id
    where si.project_id = p_project and si.is_deleted = false
  ) deps(d);
  return jsonb_build_object('bars', v_bars, 'deps', v_deps,
    'project', (select jsonb_build_object('due_date', due_date, 'delivery_date', delivery_date, 'start_date', start_date)
                from public.project_core where project_id = p_project));
end $$;

-- ═══ B1.10 Trigger لمس updated_at ═══
drop trigger if exists trg_psi_touch on public.project_schedule_items;
create trigger trg_psi_touch before update on public.project_schedule_items
  for each row execute function public.pc_touch_updated_at();

-- ═══ B1.11 RLS + سياسات القراءة (الكتابة عبر RPCs فقط) ═══
alter table public.project_schedule_items        enable row level security;
alter table public.project_schedule_dependencies enable row level security;

drop policy if exists psi_read on public.project_schedule_items;
create policy psi_read on public.project_schedule_items for select to authenticated
  using (public.pc_can_read_project(project_id) and (is_deleted = false or public.can_manage_projects() or public.can_edit_project(project_id)));

drop policy if exists psd_read on public.project_schedule_dependencies;
create policy psd_read on public.project_schedule_dependencies for select to authenticated
  using (exists (select 1 from public.project_schedule_items s where s.id = item_id and public.pc_can_read_project(s.project_id)));

-- ═══ B1.12 Grants ═══
grant select on public.project_schedule_items, public.project_schedule_dependencies to authenticated;
do $g1$
declare f text;
begin
  foreach f in array array[
    'public.pc_schedule_upsert(uuid,jsonb)',
    'public.pc_schedule_set_status(uuid,text,text)',
    'public.pc_schedule_delete(uuid,text)',
    'public.pc_schedule_restore(uuid)',
    'public.pc_schedule_dependency_set(uuid,uuid,boolean)',
    'public.project_core_schedule(uuid,timestamptz,timestamptz,text[],uuid,boolean)',
    'public.project_core_gantt(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g1$;

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION — فحص داخل المعاملة؛ أي نقص يُرجع كل شيء
-- ════════════════════════════════════════════════════════════════════════════
do $v$
declare miss text := '';
begin
  if to_regclass('public.project_schedule_items')        is null then miss := miss || ' project_schedule_items'; end if;
  if to_regclass('public.project_schedule_dependencies') is null then miss := miss || ' project_schedule_dependencies'; end if;
  if to_regprocedure('public.pc_schedule_upsert(uuid,jsonb)')            is null then miss := miss || ' pc_schedule_upsert'; end if;
  if to_regprocedure('public.project_core_schedule(uuid,timestamptz,timestamptz,text[],uuid,boolean)') is null then miss := miss || ' project_core_schedule'; end if;
  if to_regprocedure('public.project_core_gantt(uuid)')                  is null then miss := miss || ' project_core_gantt'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.project_schedule_items'::regclass) then miss := miss || ' RLS(project_schedule_items)'; end if;
  if not (select relrowsecurity from pg_class where oid = 'public.project_schedule_dependencies'::regclass) then miss := miss || ' RLS(project_schedule_dependencies)'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'pc_schedule_upsert') <> 1 then miss := miss || ' overload(pc_schedule_upsert)'; end if;
  if miss <> '' then
    raise exception 'فشل التحقق النهائي — عناصر ناقصة:%', miss;
  end if;
end $v$;

notify pgrst, 'reload schema';

commit;

-- فحوص قراءة اختيارية بعد التطبيق (لا تُعدّل شيئًا):
-- select count(*) from public.project_schedule_items;
-- select public.project_core_gantt((select id from public.projects limit 1));
