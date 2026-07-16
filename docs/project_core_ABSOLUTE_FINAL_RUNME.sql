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
  if to_regclass('public.project_call_sheets')     is null then miss := miss || ' project_call_sheets (شغّل project_core_OPERATIONAL_CLOSURE_FINAL_RUNME.sql)'; end if;
  if to_regclass('public.project_expenses')        is null then miss := miss || ' project_expenses (شغّل project_core_FINANCE_RUNME.sql)'; end if;
  if to_regclass('public.project_revenue_schedule') is null then miss := miss || ' project_revenue_schedule (شغّل project_core_FINANCE_RUNME.sql)'; end if;
  if to_regclass('public.project_members')         is null then miss := miss || ' project_members'; end if;
  if to_regclass('public.internal_comments')       is null then miss := miss || ' internal_comments'; end if;
  if to_regclass('public.project_templates')       is null then miss := miss || ' project_templates'; end if;
  if to_regclass('public.project_deliverable_versions') is null then miss := miss || ' project_deliverable_versions'; end if;
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
  if to_regprocedure('public.pc_can_see_finance(uuid)')                              is null then miss := miss || ' pc_can_see_finance (شغّل project_core_FINANCE_RUNME.sql)'; end if;
  if to_regprocedure('public.pc_expense_delete(uuid,text)')                          is null then miss := miss || ' pc_expense_delete (شغّل project_core_FINANCE_RUNME.sql)'; end if;
  if to_regprocedure('public.can_final_deliver()')                                   is null then miss := miss || ' can_final_deliver (شغّل staff_roles_task_assignment_RUNME.sql)'; end if;
  if to_regprocedure('public.notify(uuid,text,text,text,uuid,text,text)')            is null then miss := miss || ' notify()'; end if;
  if to_regclass('public.notification_preferences') is null then miss := miss || ' notification_preferences'; end if;
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
-- BATCH 2 — الحذف الناعم الشامل + الاستعادة + مركز المحذوفات + قفل تفاؤلي للمهام
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B2.1 أعمدة بيانات الحذف (سبب/منفّذ/وقت) — إضافية آمنة ═══
do $b2c$
declare tbl text;
begin
  foreach tbl in array array[
    'project_tasks','task_comments','project_meetings','project_shoot_sessions','project_locations',
    'project_risks','project_costs','deliverables','project_call_sheets','project_expenses',
    'project_revenue_schedule','project_members'
  ] loop
    execute format('alter table public.%I add column if not exists deleted_at timestamptz', tbl);
    execute format('alter table public.%I add column if not exists deleted_by uuid', tbl);
    execute format('alter table public.%I add column if not exists delete_reason text', tbl);
  end loop;
end $b2c$;

-- ═══ B2.2 حذف ناعم موحّد بسبب إلزامي + حواجز لكل نوع ═══
create or replace function public.pc_entity_delete(p_type text, p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_title text; v_status text; v_num numeric;
begin
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;

  -- الأنواع ذات المنطق الخاص تُفوَّض لدوالها (حواجزها قائمة).
  if p_type = 'expense'  then perform public.pc_expense_delete(p_id, p_reason);  return jsonb_build_object('ok', true); end if;
  if p_type = 'schedule' then perform public.pc_schedule_delete(p_id, p_reason); return jsonb_build_object('ok', true); end if;

  if p_type = 'task' then
    select project_id, title into v_proj, v_title from public.project_tasks where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    with recursive sub(id) as (
      select id from public.project_tasks where id = p_id
      union all
      select t.id from public.project_tasks t join sub on t.parent_task_id = sub.id
    )
    update public.project_tasks set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500), updated_at = now()
      where id in (select id from sub) and is_deleted = false;
  elsif p_type = 'comment' then
    select t.project_id, left(c.body,80) into v_proj, v_title
      from public.task_comments c join public.project_tasks t on t.id = c.task_id
      where c.id = p_id and c.is_deleted = false;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.task_comments set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'meeting' then
    select project_id, title into v_proj, v_title from public.project_meetings where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_meetings set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'risk' then
    select project_id, title into v_proj, v_title from public.project_risks where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_risks set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'location' then
    select project_id, name into v_proj, v_title from public.project_locations where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_locations set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'cost' then
    select project_id, coalesce(description, category) into v_proj, v_title from public.project_costs where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_costs set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'shoot' then
    select project_id, title, status into v_proj, v_title, v_status
      from public.project_shoot_sessions where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    -- جلسة بدأت أو اكتملت لا تُحذف — تُلغى رسميًا أولًا (سجل تاريخي).
    if v_status in ('in_progress','completed') then raise exception 'must_cancel_first'; end if;
    -- لا حذف وجلستُها معدات غير مرجعة (عهدة فعّالة).
    if public.pc_shoot_equipment_out(p_id) then raise exception 'equipment_out'; end if;
    -- الحجوزات النشطة غير المصروفة تُلغى تلقائيًا مع حذف الجلسة (وإلا بقيت تحجب المعدات).
    if to_regclass('public.custody_inventory_reservations') is not null then
      execute $q$update public.custody_inventory_reservations
        set status = 'cancelled',
            note = coalesce(note,'') || ' | أُلغي بحذف الجلسة: ' || left(btrim($2),300),
            updated_at = now()
        where shoot_session_id = $1 and status = 'active'$q$ using p_id, p_reason;
    end if;
    update public.project_shoot_sessions set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500), updated_at = now() where id = p_id;
  elsif p_type = 'deliverable' then
    select project_id, title, status into v_proj, v_title, v_status from public.deliverables where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    -- مخرَج معتمد/مُسلَّم لا يُحذف — يُؤرشف.
    if v_status in ('approved','final_delivered') then raise exception 'archive_instead'; end if;
    update public.deliverables set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'call_sheet' then
    select project_id, coalesce(title,'Call Sheet'), status into v_proj, v_title, v_status
      from public.project_call_sheets where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    -- نسخة مُرسلة سجلّ تشغيلي — لا تُحذف.
    if v_status = 'sent' then raise exception 'sent_locked'; end if;
    update public.project_call_sheets set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'revenue' then
    select project_id, name, collected_amount into v_proj, v_title, v_num
      from public.project_revenue_schedule where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    if not public.pc_can_see_finance(v_proj) then raise exception 'not authorized'; end if;
    -- دفعة حُصِّل منها شيء = قيد مالي — لا تُحذف.
    if coalesce(v_num,0) > 0 then raise exception 'cannot_delete_collected'; end if;
    update public.project_revenue_schedule set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  elsif p_type = 'member' then
    select project_id into v_proj from public.project_members where id = p_id and is_deleted = false for update;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    v_title := 'عضو فريق';
    update public.project_members set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
      delete_reason = left(btrim(p_reason),500) where id = p_id;
  else
    raise exception 'bad_entity_type';
  end if;

  perform public.pc_log(v_proj, 'entity_deleted', p_type, p_id,
    jsonb_build_object('title', v_title, 'reason', left(btrim(p_reason),500)));
  return jsonb_build_object('ok', true, 'entity', p_type, 'title', v_title);
end $$;

-- ═══ B2.3 استعادة موحّدة ═══
create or replace function public.pc_entity_restore(p_type text, p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_title text;
begin
  if p_type = 'schedule' then perform public.pc_schedule_restore(p_id); return jsonb_build_object('ok', true); end if;

  if p_type = 'task' then
    select project_id, title into v_proj, v_title from public.project_tasks where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    -- الحذف شجري (مهمة + فروعها) — فالاستعادة كذلك.
    with recursive sub(id) as (
      select id from public.project_tasks where id = p_id
      union all
      select t.id from public.project_tasks t join sub on t.parent_task_id = sub.id
    )
    update public.project_tasks set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null,
      updated_at = now() where id in (select id from sub) and is_deleted = true;
  elsif p_type = 'comment' then
    select t.project_id, left(c.body,80) into v_proj, v_title
      from public.task_comments c join public.project_tasks t on t.id = c.task_id where c.id = p_id and c.is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.task_comments set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'meeting' then
    select project_id, title into v_proj, v_title from public.project_meetings where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_meetings set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'risk' then
    select project_id, title into v_proj, v_title from public.project_risks where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_risks set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'location' then
    select project_id, name into v_proj, v_title from public.project_locations where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_locations set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'cost' then
    select project_id, coalesce(description, category) into v_proj, v_title from public.project_costs where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_costs set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'shoot' then
    select project_id, title into v_proj, v_title from public.project_shoot_sessions where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_shoot_sessions set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null,
      updated_at = now() where id = p_id;
  elsif p_type = 'deliverable' then
    select project_id, title into v_proj, v_title from public.deliverables where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.deliverables set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'call_sheet' then
    select project_id, coalesce(title,'Call Sheet') into v_proj, v_title from public.project_call_sheets where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    update public.project_call_sheets set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'revenue' then
    select project_id, name into v_proj, v_title from public.project_revenue_schedule where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    if not public.pc_can_see_finance(v_proj) then raise exception 'not authorized'; end if;
    update public.project_revenue_schedule set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'expense' then
    select project_id, coalesce(description, category) into v_proj, v_title from public.project_expenses where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.pc_can_see_finance(v_proj) then raise exception 'not authorized'; end if;
    update public.project_expenses set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  elsif p_type = 'member' then
    select project_id into v_proj from public.project_members where id = p_id and is_deleted = true;
    if v_proj is null then raise exception 'not_found'; end if;
    if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
    v_title := 'عضو فريق';
    update public.project_members set is_deleted = false, deleted_at = null, deleted_by = null, delete_reason = null where id = p_id;
  else
    raise exception 'bad_entity_type';
  end if;

  perform public.pc_log(v_proj, 'entity_restored', p_type, p_id, jsonb_build_object('title', v_title));
  return jsonb_build_object('ok', true, 'entity', p_type, 'title', v_title);
end $$;

-- ═══ B2.4 مركز المحذوفات — لكل مشروع أو شامل (للمديرين) ═══
create or replace function public.project_core_trash(p_project uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if p_project is not null then
    if not (public.can_manage_projects() or public.can_edit_project(p_project)) then raise exception 'not authorized'; end if;
  else
    if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  end if;
  select coalesce(jsonb_agg(row order by (row->>'deleted_at') desc nulls last), '[]'::jsonb) into v from (
    select * from (
      select jsonb_build_object('entity','task','id',x.id,'title',x.title,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason) as row
      from public.project_tasks x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','meeting','id',x.id,'title',x.title,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_meetings x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','risk','id',x.id,'title',x.title,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_risks x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','location','id',x.id,'title',x.name,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_locations x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','cost','id',x.id,'title',coalesce(x.description,x.category),'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_costs x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','shoot','id',x.id,'title',x.title,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_shoot_sessions x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','deliverable','id',x.id,'title',x.title,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.deliverables x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','call_sheet','id',x.id,'title',coalesce(x.title,'Call Sheet'),'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_call_sheets x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','schedule','id',x.id,'title',x.title,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_schedule_items x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
      union all
      select jsonb_build_object('entity','expense','id',x.id,'title',coalesce(x.description,x.category),'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_expenses x
      where x.is_deleted = true and (p_project is null or x.project_id = p_project) and public.pc_can_see_finance(x.project_id)
      union all
      select jsonb_build_object('entity','revenue','id',x.id,'title',x.name,'project_id',x.project_id,
        'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_revenue_schedule x
      where x.is_deleted = true and (p_project is null or x.project_id = p_project) and public.pc_can_see_finance(x.project_id)
      union all
      select jsonb_build_object('entity','comment','id',c.id,'title',left(c.body,80),'project_id',tk.project_id,
        'deleted_at',c.deleted_at,'deleted_by',c.deleted_by,'reason',c.delete_reason)
      from public.task_comments c join public.project_tasks tk on tk.id = c.task_id
      where c.is_deleted = true and (p_project is null or tk.project_id = p_project)
      union all
      select jsonb_build_object('entity','member','id',x.id,
        'title', coalesce((select pr.full_name from public.profiles pr where pr.id = x.user_id),'عضو فريق'),
        'project_id',x.project_id,'deleted_at',x.deleted_at,'deleted_by',x.deleted_by,'reason',x.delete_reason)
      from public.project_members x where x.is_deleted = true and (p_project is null or x.project_id = p_project)
    ) u
    where p_project is not null or public.pc_can_read_project((u.row->>'project_id')::uuid)
    order by (u.row->>'deleted_at') desc nulls last
    limit 500
  ) rows(row);
  -- إثراء: اسم المشروع + اسم منفّذ الحذف.
  select coalesce(jsonb_agg(
    r || jsonb_build_object(
      'project_name', (select p.project_name from public.projects p where p.id = (r->>'project_id')::uuid),
      'deleted_by_name', (select pr.full_name from public.profiles pr where pr.id = (r->>'deleted_by')::uuid)
    ) order by (r->>'deleted_at') desc nulls last), '[]'::jsonb)
  into v from jsonb_array_elements(v) as t(r);
  return jsonb_build_object('items', v);
end $$;

-- ═══ B2.5 قفل تفاؤلي + Audit قبل/بعد لتحديث المهام (نفس التوقيع — لا Overload) ═══
create or replace function public.pc_task_update(p_task uuid, p_data jsonb)
returns public.project_tasks language plpgsql security definer set search_path = public as $$
declare r public.project_tasks; v_old public.project_tasks; v_new_assignee uuid; v_exp timestamptz;
begin
  select * into v_old from public.project_tasks where id = p_task and is_deleted = false for update;
  if v_old.id is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_old.project_id) then raise exception 'not authorized'; end if;
  -- قفل تفاؤلي اختياري: المرسل يمرّر expected_updated_at داخل p_data.
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
    progress_pct    = coalesce(nullif(p_data->>'progress_pct','')::int, progress_pct),
    labels          = case when jsonb_typeof(p_data->'labels')='array'
                        then coalesce((select array_agg(x) from jsonb_array_elements_text(p_data->'labels') x), labels) else labels end,
    sort_order      = coalesce(nullif(p_data->>'sort_order','')::int, sort_order),
    completed_at    = case when coalesce(nullif(p_data->>'status',''), status) = 'done' and completed_at is null then now()
                           when coalesce(nullif(p_data->>'status',''), status) <> 'done' then null else completed_at end,
    updated_at = now()
    where id = p_task returning * into r;
  -- Audit قبل/بعد للحقول الجوهرية.
  perform public.pc_log(v_old.project_id, 'task_updated', 'task', p_task, jsonb_build_object(
    'patch', p_data - 'labels' - 'expected_updated_at',
    'before', jsonb_build_object('status', v_old.status, 'assignee', v_old.assignee_id, 'start', v_old.start_date, 'due', v_old.due_date, 'title', v_old.title),
    'after',  jsonb_build_object('status', r.status, 'assignee', r.assignee_id, 'start', r.start_date, 'due', r.due_date, 'title', r.title)));
  if v_new_assignee is distinct from v_old.assignee_id and v_new_assignee is not null then
    insert into public.task_followers(task_id, user_id) values (p_task, v_new_assignee) on conflict do nothing;
    perform public.pc_notify_user(v_new_assignee, 'project_note_new', 'task', p_task,
      'أُسندت إليك مهمة: '||r.title, 'Task assigned to you: '||r.title);
  end if;
  if r.status is distinct from v_old.status then
    perform public.pc_notify_team(v_old.project_id, 'project_note_new', 'task', p_task,
      'تحدّثت حالة مهمة: '||r.title, 'Task status changed: '||r.title, auth.uid());
  end if;
  return r;
end $$;

-- ═══ B2.6 Grants (دوال Batch 2) ═══
do $g2$
declare f text;
begin
  foreach f in array array[
    'public.pc_entity_delete(text,uuid,text)',
    'public.pc_entity_restore(text,uuid)',
    'public.project_core_trash(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g2$;

-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 3 — جلسات التصوير (أوقات/طاقم/معدات/حضور/إلغاء بسبب) + إرسال Call Sheet محدد
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B3.1 أعمدة إضافية لجلسة التصوير ═══
alter table public.project_shoot_sessions add column if not exists start_time    timestamptz;
alter table public.project_shoot_sessions add column if not exists wrap_time     timestamptz;
alter table public.project_shoot_sessions add column if not exists cancel_reason text;

-- ═══ B3.2 pc_shoot_upsert موسّع (نفس التوقيع — لا Overload):
--     أوقات + مصفوفات (طاقم/معدات/مركبات/لقطات/حضور) + إلغاء بسبب إلزامي + إشعارات ═══
create or replace function public.pc_shoot_upsert(p_project uuid, p_data jsonb)
returns public.project_shoot_sessions language plpgsql security definer set search_path = public as $$
declare r public.project_shoot_sessions; v_id uuid := nullif(p_data->>'id','')::uuid; v_old_status text;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if v_id is null then
    insert into public.project_shoot_sessions(project_id, title, session_date, call_time, start_time, wrap_time,
        location, client_contact, permits, safety_notes, weather_note, status, created_by,
        crew, equipment, vehicles, shot_list, attendance)
      values (p_project, btrim(coalesce(p_data->>'title','')), nullif(p_data->>'session_date','')::date,
        nullif(p_data->>'call_time','')::timestamptz, nullif(p_data->>'start_time','')::timestamptz,
        nullif(p_data->>'wrap_time','')::timestamptz,
        nullif(btrim(p_data->>'location'),''), nullif(btrim(p_data->>'client_contact'),''),
        nullif(btrim(p_data->>'permits'),''), nullif(btrim(p_data->>'safety_notes'),''), nullif(btrim(p_data->>'weather_note'),''),
        coalesce(nullif(p_data->>'status',''),'planned'), auth.uid(),
        case when jsonb_typeof(p_data->'crew')='array'       then p_data->'crew'       else '[]'::jsonb end,
        case when jsonb_typeof(p_data->'equipment')='array'  then p_data->'equipment'  else '[]'::jsonb end,
        case when jsonb_typeof(p_data->'vehicles')='array'   then p_data->'vehicles'   else '[]'::jsonb end,
        case when jsonb_typeof(p_data->'shot_list')='array'  then p_data->'shot_list'  else '[]'::jsonb end,
        case when jsonb_typeof(p_data->'attendance')='array' then p_data->'attendance' else '[]'::jsonb end)
      returning * into r;
    perform public.pc_log(p_project, 'shoot_added', 'shoot', r.id, '{}');
    perform public.pc_notify_team(p_project, 'project_note_new', 'shoot', r.id,
      'جلسة تصوير جديدة: '||coalesce(r.title,''), 'New shoot session', auth.uid());
  else
    select status into v_old_status from public.project_shoot_sessions
      where id = v_id and project_id = p_project and is_deleted = false for update;
    if v_old_status is null then raise exception 'not_found'; end if;
    -- الإلغاء الرسمي يتطلّب سببًا إلزاميًا.
    if nullif(p_data->>'status','') = 'cancelled' and v_old_status <> 'cancelled'
       and coalesce(btrim(p_data->>'cancel_reason'),'') = '' then
      raise exception 'reason_required';
    end if;
    -- لا إكمال جلسة ومعداتها غير مرجعة (عهدة فعّالة).
    if nullif(p_data->>'status','') = 'completed' and v_old_status <> 'completed'
       and public.pc_shoot_equipment_out(v_id) then
      raise exception 'equipment_out';
    end if;
    update public.project_shoot_sessions set
      title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      session_date = coalesce(nullif(p_data->>'session_date','')::date, session_date),
      call_time  = case when p_data ? 'call_time'  then nullif(p_data->>'call_time','')::timestamptz  else call_time end,
      start_time = case when p_data ? 'start_time' then nullif(p_data->>'start_time','')::timestamptz else start_time end,
      wrap_time  = case when p_data ? 'wrap_time'  then nullif(p_data->>'wrap_time','')::timestamptz  else wrap_time end,
      location = coalesce(nullif(btrim(p_data->>'location'),''), location),
      client_contact = coalesce(nullif(btrim(p_data->>'client_contact'),''), client_contact),
      permits = coalesce(nullif(btrim(p_data->>'permits'),''), permits),
      safety_notes = coalesce(nullif(btrim(p_data->>'safety_notes'),''), safety_notes),
      weather_note = coalesce(nullif(btrim(p_data->>'weather_note'),''), weather_note),
      status = coalesce(nullif(p_data->>'status',''), status),
      cancel_reason = case when nullif(p_data->>'status','') = 'cancelled'
                           then coalesce(nullif(left(btrim(coalesce(p_data->>'cancel_reason','')),500),''), cancel_reason)
                           else cancel_reason end,
      completion_report = coalesce(nullif(btrim(p_data->>'completion_report'),''), completion_report),
      crew       = case when jsonb_typeof(p_data->'crew')='array'       then p_data->'crew'       else crew end,
      equipment  = case when jsonb_typeof(p_data->'equipment')='array'  then p_data->'equipment'  else equipment end,
      vehicles   = case when jsonb_typeof(p_data->'vehicles')='array'   then p_data->'vehicles'   else vehicles end,
      shot_list  = case when jsonb_typeof(p_data->'shot_list')='array'  then p_data->'shot_list'  else shot_list end,
      attendance = case when jsonb_typeof(p_data->'attendance')='array' then p_data->'attendance' else attendance end,
      updated_at = now()
      where id = v_id and project_id = p_project returning * into r;
    perform public.pc_log(p_project, 'shoot_updated', 'shoot', v_id,
      jsonb_build_object('status', r.status, 'from', v_old_status,
        'cancel_reason', case when r.status = 'cancelled' then r.cancel_reason end));
    if r.status = 'cancelled' and v_old_status <> 'cancelled' then
      -- إلغاء الجلسة رسميًا يلغي حجوزات معداتها النشطة غير المصروفة.
      if to_regclass('public.custody_inventory_reservations') is not null then
        execute $q$update public.custody_inventory_reservations
          set status = 'cancelled', note = coalesce(note,'') || ' | أُلغي بإلغاء الجلسة', updated_at = now()
          where shoot_session_id = $1 and status = 'active'$q$ using v_id;
      end if;
      perform public.pc_notify_team(p_project, 'project_note_new', 'shoot', v_id,
        'أُلغيت جلسة تصوير: '||coalesce(r.title,''), 'Shoot session cancelled', auth.uid());
    end if;
  end if;
  return r;
end $$;

-- ═══ B3.3 إرسال Call Sheet لموظفين محددين (يُصدرها إن كانت مسودّة) ═══
create or replace function public.project_core_call_sheet_send_to(p_call_sheet uuid, p_users uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; u uuid; v_n int := 0;
begin
  select * into r from public.project_call_sheets where id = p_call_sheet and is_deleted = false for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(r.project_id) then raise exception 'not authorized'; end if;
  if p_users is null or array_length(p_users, 1) is null then raise exception 'recipients_required'; end if;
  if r.status = 'draft' then
    if r.shoot_date is null or coalesce(btrim(r.location_name),'') = '' then raise exception 'incomplete_call_sheet'; end if;
    update public.project_call_sheets set status = 'sent', sent_at = now(), sent_by = auth.uid() where id = p_call_sheet;
  end if;
  foreach u in array p_users loop
    -- المستلم يجب أن يكون موظفًا فعّالًا — لا عملاء.
    if exists (select 1 from public.profiles pr where pr.id = u and pr.staff_role is not null) then
      perform public.pc_notify_user(u, 'project_note_new', 'shoot', r.shoot_session_id,
        'وصلتك Call Sheet (v'||r.version_number||') لجلسة تصوير', 'You received a Call Sheet (v'||r.version_number||')');
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n = 0 then raise exception 'recipients_required'; end if;
  perform public.pc_log(r.project_id, 'callsheet_sent_to', 'shoot', r.shoot_session_id,
    jsonb_build_object('call_sheet', p_call_sheet, 'version', r.version_number, 'recipients', v_n));
  return jsonb_build_object('ok', true, 'sent_to', v_n, 'version', r.version_number);
end $$;

-- ═══ B3.4 Grants (دوال Batch 3) ═══
do $g3$
begin
  execute 'revoke all on function public.project_core_call_sheet_send_to(uuid,uuid[]) from public, anon';
  execute 'grant execute on function public.project_core_call_sheet_send_to(uuid,uuid[]) to authenticated';
end $g3$;

-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 4 — جسر جلسات التصوير ↔ نظام العهدة والمخزون الحالي (لا نظام موازٍ)
-- الحجز لا يخصم المخزون؛ الخصم والإرجاع حصريًا عبر دورة العهدة القائمة.
-- إن لم يكن نظام العهدة مطبَّقًا على قاعدة البيانات: الدوال تعمل وتُرجع خطأ عربيًا
-- واضحًا وقت الاستدعاء (custody_system_missing) — ولا يفشل هذا الملف.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B4.1 أعمدة ربط إضافية على جدول الحجوزات القائم (شرطية — فقط إن وُجد النظام) ═══
do $b4c$
begin
  if to_regclass('public.custody_inventory_reservations') is not null then
    execute 'alter table public.custody_inventory_reservations add column if not exists shoot_session_id uuid references public.project_shoot_sessions(id) on delete set null';
    execute 'alter table public.custody_inventory_reservations add column if not exists assignment_id uuid';
    execute 'alter table public.custody_inventory_reservations add column if not exists approved_by uuid';
    execute 'alter table public.custody_inventory_reservations add column if not exists approved_at timestamptz';
    execute 'create index if not exists idx_civ_resv_shoot on public.custody_inventory_reservations(shoot_session_id) where status = ''active''';
  end if;
end $b4c$;

-- ═══ B4.2 بحث المعدات (اسم/كود/رقم تسلسلي) — للموظفين ═══
create or replace function public.pc_equipment_search(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if to_regclass('public.custody_inventory_assets') is null then raise exception 'custody_system_missing'; end if;
  if not public.is_staff() then raise exception 'not authorized'; end if;
  -- LIMIT داخل استعلام فرعي — قبل التجميع (وإلا كان بلا أثر على jsonb_agg).
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'code', a.asset_code, 'name', a.asset_name, 'serial', a.serial_number,
      'type', a.asset_type, 'unit', a.unit, 'condition', a.condition_status, 'availability', a.availability_status,
      'total', a.quantity_total, 'available', a.quantity_available,
      'reserved_now', coalesce((select sum(r.quantity) from public.custody_inventory_reservations r
         where r.asset_id = a.id and r.status = 'active' and (r.reserved_to is null or r.reserved_to >= now())), 0)
    ) order by a.asset_name), '[]'::jsonb) into v
  from (
    select * from public.custody_inventory_assets a0
    where a0.is_deleted = false
      and (coalesce(btrim(p_q),'') = '' or a0.asset_name ilike '%'||btrim(p_q)||'%'
           or a0.asset_code ilike '%'||btrim(p_q)||'%' or a0.serial_number ilike '%'||btrim(p_q)||'%')
    order by a0.asset_name
    limit 30
  ) a;
  return jsonb_build_object('items', v);
end $$;

-- ═══ B4.3 فحص التوفر في نافذة زمنية ═══
create or replace function public.pc_equipment_availability(p_asset uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_overlap numeric;
begin
  if to_regclass('public.custody_inventory_assets') is null then raise exception 'custody_system_missing'; end if;
  if not public.is_staff() then raise exception 'not authorized'; end if;
  select * into a from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if a.id is null then raise exception 'not_found'; end if;
  select coalesce(sum(r.quantity), 0) into v_overlap from public.custody_inventory_reservations r
    where r.asset_id = p_asset and r.status = 'active'
      and coalesce(r.reserved_from, '-infinity') < coalesce(p_to, 'infinity')
      and coalesce(r.reserved_to, 'infinity') > coalesce(p_from, '-infinity');
  return jsonb_build_object(
    'total', a.quantity_total, 'available_now', a.quantity_available,
    'reserved_window', v_overlap, 'free_window', greatest(0, a.quantity_total - v_overlap),
    'condition', a.condition_status, 'availability', a.availability_status,
    'blocked', a.condition_status in ('damaged','lost','under_maintenance','retired')
               or a.availability_status in ('maintenance','lost','retired'));
end $$;

-- ═══ B4.4 حجز معدات لجلسة تصوير — قفل صف الأصل + منع التداخل والتجاوز ═══
create or replace function public.pc_shoot_reserve_equipment(
  p_shoot uuid, p_asset uuid, p_qty numeric, p_from timestamptz, p_to timestamptz,
  p_employee uuid default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare sh record; a record; v_overlap numeric; v_id uuid; v_from timestamptz; v_to timestamptz;
begin
  if to_regclass('public.custody_inventory_reservations') is null then raise exception 'custody_system_missing'; end if;
  select * into sh from public.project_shoot_sessions where id = p_shoot and is_deleted = false;
  if sh.id is null then raise exception 'not_found'; end if;
  if sh.status = 'cancelled' then raise exception 'bad_state'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(sh.project_id) then raise exception 'not authorized'; end if;
  -- النافذة: افتراضيًا من Call Time إلى Wrap (أو يوم الجلسة كاملًا).
  v_from := coalesce(p_from, sh.call_time, sh.session_date::timestamptz);
  v_to   := coalesce(p_to, sh.wrap_time, v_from + interval '1 day');
  if v_from is null or v_to is null or v_to <= v_from then raise exception 'bad_window'; end if;
  if coalesce(p_qty, 1) <= 0 then raise exception 'bad_quantity'; end if;

  -- قفل صف الأصل (نفس ترتيب قفل دورة العهدة) — يمنع سباق حجزين متزامنين.
  select * into a from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  if a.id is null then raise exception 'not_found'; end if;
  if a.condition_status in ('damaged','lost','under_maintenance','retired')
     or a.availability_status in ('maintenance','lost','retired') then raise exception 'asset_unavailable'; end if;
  -- منع تكرار حجز نفس الأصل لنفس الجلسة.
  if exists (select 1 from public.custody_inventory_reservations
             where shoot_session_id = p_shoot and asset_id = p_asset and status = 'active') then
    raise exception 'duplicate_reservation';
  end if;
  -- مجموع الحجوزات النشطة المتداخلة زمنيًا + الكمية المطلوبة ≤ الإجمالي.
  select coalesce(sum(quantity), 0) into v_overlap from public.custody_inventory_reservations
    where asset_id = p_asset and status = 'active'
      and coalesce(reserved_from, '-infinity') < v_to and coalesce(reserved_to, 'infinity') > v_from;
  if a.asset_type = 'serialized' then
    if v_overlap > 0 then raise exception 'over_reserved'; end if;
    p_qty := 1;
  elsif v_overlap + coalesce(p_qty, 1) > a.quantity_total then
    raise exception 'over_reserved';
  end if;

  insert into public.custody_inventory_reservations(
      asset_id, quantity, employee_id, project_id, shoot_session_id, reserved_from, reserved_to, note, created_by)
    values (p_asset, coalesce(p_qty, 1), p_employee, sh.project_id, p_shoot, v_from, v_to,
      nullif(btrim(coalesce(p_note, '')), ''), auth.uid())
    returning id into v_id;
  perform public.pc_log(sh.project_id, 'equipment_reserved', 'shoot', p_shoot,
    jsonb_build_object('asset', a.asset_code, 'qty', coalesce(p_qty,1), 'reservation', v_id));
  perform public.civ_notify_managers('civ_reservation_created', p_asset,
    'حجز معدات لجلسة تصوير: '||a.asset_code, 'Equipment reserved for a shoot: '||a.asset_code);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ═══ B4.5 قائمة معدات الجلسة (حجوزات + حالة العهدة المرتبطة) ═══
create or replace function public.pc_shoot_equipment_list(p_shoot uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_proj uuid;
begin
  if to_regclass('public.custody_inventory_reservations') is null then raise exception 'custody_system_missing'; end if;
  select project_id into v_proj from public.project_shoot_sessions where id = p_shoot;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pc_can_read_project(v_proj) then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'asset_id', r.asset_id, 'code', a.asset_code, 'name', a.asset_name,
      'qty', r.quantity, 'from', r.reserved_from, 'to', r.reserved_to, 'status', r.status,
      'employee_id', r.employee_id,
      'employee_name', (select pr.full_name from public.profiles pr where pr.id = r.employee_id),
      'note', r.note, 'approved_at', r.approved_at,
      'assignment_id', r.assignment_id,
      'assignment_no', (select g.assignment_number from public.custody_inventory_assignments g where g.id = r.assignment_id),
      'assignment_status', (select g.status from public.custody_inventory_assignments g where g.id = r.assignment_id)
    ) order by r.created_at), '[]'::jsonb) into v
  from public.custody_inventory_reservations r
  join public.custody_inventory_assets a on a.id = r.asset_id
  where r.shoot_session_id = p_shoot;
  return jsonb_build_object('items', v);
end $$;

-- ═══ B4.6 تعديل/إلغاء/اعتماد الحجز ═══
create or replace function public.pc_reservation_cancel(p_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if to_regclass('public.custody_inventory_reservations') is null then raise exception 'custody_system_missing'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.custody_inventory_reservations where id = p_id and status = 'active' for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.civ_can_manage() and not (r.project_id is not null and
      (public.can_manage_projects() or public.can_edit_project(r.project_id))) then raise exception 'not authorized'; end if;
  update public.custody_inventory_reservations
    set status = 'cancelled',
        note = coalesce(note,'') || ' | إلغاء: ' || left(btrim(p_reason),300),
        updated_at = now() where id = p_id;
  if r.project_id is not null then
    perform public.pc_log(r.project_id, 'equipment_reservation_cancelled', 'shoot', r.shoot_session_id,
      jsonb_build_object('reservation', p_id, 'reason', p_reason));
  end if;
  return true;
end $$;

create or replace function public.pc_reservation_approve(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if to_regclass('public.custody_inventory_reservations') is null then raise exception 'custody_system_missing'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_inventory_reservations where id = p_id and status = 'active' for update;
  if r.id is null then raise exception 'not_found'; end if;
  update public.custody_inventory_reservations set approved_by = auth.uid(), approved_at = now(), updated_at = now()
    where id = p_id;
  if r.project_id is not null then
    perform public.pc_log(r.project_id, 'equipment_reservation_approved', 'shoot', r.shoot_session_id,
      jsonb_build_object('reservation', p_id));
  end if;
  return true;
end $$;

-- ═══ B4.7 تحويل الحجز إلى طلب عهدة — عبر دورة العهدة القائمة (هي التي تخصم المخزون) ═══
create or replace function public.pc_reservation_to_custody(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_res jsonb;
begin
  if to_regclass('public.custody_inventory_reservations') is null then raise exception 'custody_system_missing'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;   -- الصرف = مسؤول العهدة فقط
  select * into r from public.custody_inventory_reservations where id = p_id and status = 'active' for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.employee_id is null then raise exception 'employee_required'; end if;
  if r.assignment_id is not null then raise exception 'custody_already_issued'; end if;   -- منع Duplicate Custody Request
  v_res := public.custody_inv_admin_create_assignment(jsonb_build_object(
    'employee_user_id', r.employee_id, 'assignment_type', 'project',
    'project_id', r.project_id, 'purpose', 'معدات جلسة تصوير (حجز مؤكد)',
    'expected_return_at', r.reserved_to,
    'items', jsonb_build_array(jsonb_build_object('asset_id', r.asset_id, 'quantity', r.quantity))));
  update public.custody_inventory_reservations
    set status = 'fulfilled', assignment_id = (v_res->>'id')::uuid, updated_at = now() where id = p_id;
  if r.project_id is not null then
    perform public.pc_log(r.project_id, 'equipment_custody_issued', 'shoot', r.shoot_session_id,
      jsonb_build_object('reservation', p_id, 'assignment', v_res->>'assignment_number'));
  end if;
  return v_res;
end $$;

-- ═══ B4.8 حارس: لا حذف/إكمال جلسة ومعداتها غير مرجعة ═══
create or replace function public.pc_shoot_equipment_out(p_shoot uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if to_regclass('public.custody_inventory_reservations') is null then return false; end if;
  return exists (
    select 1 from public.custody_inventory_reservations r
    join public.custody_inventory_assignments g on g.id = r.assignment_id
    where r.shoot_session_id = p_shoot
      and g.status in ('pending_employee_confirmation','active','return_requested','under_inspection','partially_returned','disputed'));
end $$;

-- ═══ B4.9 Grants (دوال Batch 4) ═══
do $g4$
declare f text;
begin
  foreach f in array array[
    'public.pc_equipment_search(text)',
    'public.pc_equipment_availability(uuid,timestamptz,timestamptz)',
    'public.pc_shoot_reserve_equipment(uuid,uuid,numeric,timestamptz,timestamptz,uuid,text)',
    'public.pc_shoot_equipment_list(uuid)',
    'public.pc_reservation_cancel(uuid,text)',
    'public.pc_reservation_approve(uuid)',
    'public.pc_reservation_to_custody(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- pc_shoot_equipment_out داخلية (تُستدعى من RPCs أخرى فقط).
  execute 'revoke all on function public.pc_shoot_equipment_out(uuid) from public, anon, authenticated';
end $g4$;

-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 5 — توحيد الميزانية (مصدر الحقيقة: project_finance_settings.approved_budget)
--           + الإغلاق المالي (Checklist + Snapshot + منع تعديل ما بعد الإغلاق) + تقرير شامل
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B5.1 عمود تاريخ الإغلاقات (سجل غير قابل للفقد عند إعادة الفتح) ═══
alter table public.project_finance_settings add column if not exists closure_history jsonb not null default '[]';

-- ═══ B5.2 مرآة الميزانية: approved_budget ← يُعكس تلقائيًا إلى project_core.budget_amount
--     (الكود القديم يقرأ budget_amount؛ المصدر المالي هو الحقيقة — لا Trigger Loop:
--      لا Trigger على project_core يكتب في finance_settings) ═══
-- بذر عند إنشاء صف المالية كسولًا (تعيين محاسب/حفظ إعدادات): إن كانت approved_budget=0
-- والمشروع له ميزانية تشغيلية قديمة > 0 → تُبذر منها (لا يُصفَّر شيء أبدًا).
create or replace function public.pc_budget_seed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.approved_budget, 0) = 0 then
    new.approved_budget := coalesce((select pc.budget_amount from public.project_core pc
                                     where pc.project_id = new.project_id), 0);
  end if;
  return new;
end $$;
drop trigger if exists trg_pfs_budget_seed on public.project_finance_settings;
create trigger trg_pfs_budget_seed before insert on public.project_finance_settings
  for each row execute function public.pc_budget_seed();

create or replace function public.pc_budget_mirror()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- إدراج بقيمة 0 لا يعكس شيئًا (لا تصفير للميزانية التشغيلية عند الإنشاء الكسول).
  if tg_op = 'INSERT' and coalesce(new.approved_budget, 0) = 0 then return new; end if;
  insert into public.project_core(project_id) values (new.project_id) on conflict (project_id) do nothing;
  update public.project_core set budget_amount = new.approved_budget, updated_at = now()
    where project_id = new.project_id and budget_amount is distinct from new.approved_budget;
  return new;
end $$;
drop trigger if exists trg_pfs_budget_mirror on public.project_finance_settings;
create trigger trg_pfs_budget_mirror after insert or update of approved_budget on public.project_finance_settings
  for each row execute function public.pc_budget_mirror();

-- حارس مصدر الحقيقة: أي مسار (set_meta/update_project/أي RPC مستقبلي) لا يستطيع
-- تعديل budget_amount بعيدًا عن approved_budget متى وُجد صف مالي.
create or replace function public.pc_budget_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ab numeric;
begin
  if new.budget_amount is distinct from old.budget_amount then
    select approved_budget into v_ab from public.project_finance_settings where project_id = new.project_id;
    if found and new.budget_amount is distinct from v_ab then
      raise exception 'budget_managed_by_finance';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_pc_budget_guard on public.project_core;
create trigger trg_pc_budget_guard before update of budget_amount on public.project_core
  for each row execute function public.pc_budget_guard();

-- ═══ B5.3 Backfill آمن (مرة واحدة — يتخطى ما سبق ترحيله عبر سجل النشاط):
--     الميزانية التشغيلية القديمة > 0 والمالية 0/غائبة → تُنقل ولا تُستبدل ميزانية مالية موجودة ═══
do $b5f$
declare rec record; v_n int := 0;
begin
  for rec in
    select pc.project_id, pc.budget_amount
    from public.project_core pc
    where coalesce(pc.budget_amount, 0) > 0
      and not exists (select 1 from public.project_activity a
                      where a.project_id = pc.project_id and a.action = 'budget_backfilled')
  loop
    insert into public.project_finance_settings(project_id, approved_budget)
      values (rec.project_id, rec.budget_amount)
      on conflict (project_id) do update set approved_budget = excluded.approved_budget
      where public.project_finance_settings.approved_budget = 0
        or public.project_finance_settings.approved_budget is null;
    -- سجّل فقط إن حدث نقل فعلي (الصف الجديد أو المحدَّث يساوي القيمة القديمة).
    if exists (select 1 from public.project_finance_settings s
               where s.project_id = rec.project_id and s.approved_budget = rec.budget_amount) then
      insert into public.project_activity(project_id, actor_id, action, entity_type, entity_id, detail)
        values (rec.project_id, null, 'budget_backfilled', 'project', rec.project_id,
          jsonb_build_object('from', 'project_core.budget_amount'));
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice 'budget backfill: % مشروعًا رُحِّلت ميزانيته إلى المالية', v_n;
  -- مزامنة المرآة لمرة واحدة للمشاريع التي لديها ميزانية مالية سابقة (الـTrigger يغطي ما بعدها).
  update public.project_core pc set budget_amount = s.approved_budget, updated_at = now()
    from public.project_finance_settings s
    where s.project_id = pc.project_id and coalesce(s.approved_budget,0) > 0
      and pc.budget_amount is distinct from s.approved_budget;
end $b5f$;

-- ═══ B5.4 project_core_set_meta (نفس التوقيع): الميزانية تُدار من «حسابات المشروع»
--     متى وُجد صف مالي — يمنع ازدواج مصدر الحقيقة ═══
create or replace function public.project_core_set_meta(p_project uuid, p_data jsonb)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_fin boolean;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  v_fin := public.can_manage_projects() or public.can_see_financials();
  -- مصدر الحقيقة المالي: بعد إنشاء صف المالية تُعدَّل الميزانية من تبويب الحسابات فقط.
  if p_data ? 'budget_amount' and nullif(p_data->>'budget_amount','') is not null
     and exists (select 1 from public.project_finance_settings s where s.project_id = p_project) then
    raise exception 'budget_managed_by_finance';
  end if;
  insert into public.project_core(project_id, updated_by) values (p_project, auth.uid())
    on conflict (project_id) do nothing;
  update public.project_core set
    priority       = coalesce(nullif(p_data->>'priority','')::text, priority),
    health         = coalesce(nullif(p_data->>'health','')::text, health),
    start_date     = coalesce(nullif(p_data->>'start_date','')::date, start_date),
    due_date       = coalesce(nullif(p_data->>'due_date','')::date, due_date),
    delivery_date  = coalesce(nullif(p_data->>'delivery_date','')::date, delivery_date),
    budget_amount  = case when v_fin then coalesce(nullif(p_data->>'budget_amount','')::numeric, budget_amount) else budget_amount end,
    estimated_cost = case when v_fin then coalesce(nullif(p_data->>'estimated_cost','')::numeric, estimated_cost) else estimated_cost end,
    actual_cost    = case when v_fin then coalesce(nullif(p_data->>'actual_cost','')::numeric, actual_cost) else actual_cost end,
    project_type   = coalesce(nullif(p_data->>'project_type','')::text, project_type),
    progress_pct   = coalesce(nullif(p_data->>'progress_pct','')::int, progress_pct),
    currency       = coalesce(nullif(p_data->>'currency','')::text, currency),
    updated_at = now(), updated_by = auth.uid()
    where project_id = p_project returning * into r;
  perform public.pc_log(p_project, 'meta_updated', 'project', p_project,
    (p_data - 'budget_amount' - 'estimated_cost' - 'actual_cost'));
  return r;
end $$;

-- ═══ B5.5 حارس ما بعد الإغلاق (طبقة البيانات — يسري حتى عبر RPCs المالية القائمة):
--     مسموح فقط: تحويل مصروف إلى refunded/voided. كل ما عداه يرفض project_closed ═══
create or replace function public.pc_finance_closed(p_project uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_finance_settings s
                 where s.project_id = p_project and s.closed_snapshot is not null);
$$;

create or replace function public.pc_finance_closed_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_proj uuid;
begin
  v_proj := coalesce(new.project_id, old.project_id);
  -- تسلسل مع الإغلاق: قفل صف الإعدادات (إن وُجد) يمنع سباق «دفع أثناء الإغلاق»
  -- فلا يلتقط الـSnapshot حالة قديمة (close يقفل نفس الصف).
  perform 1 from public.project_finance_settings where project_id = v_proj for update;
  if not public.pc_finance_closed(v_proj) then
    return coalesce(new, old);
  end if;
  -- الاستثناء الوحيد: Reversal/Refund/Void لمصروف قائم بعد الإغلاق.
  if tg_table_name = 'project_expenses' and tg_op = 'UPDATE'
     and new.status is distinct from old.status and new.status in ('refunded','voided') then
    return new;
  end if;
  raise exception 'project_closed';
end $$;

drop trigger if exists trg_pexp_closed  on public.project_expenses;
create trigger trg_pexp_closed  before insert or update or delete on public.project_expenses
  for each row execute function public.pc_finance_closed_guard();
drop trigger if exists trg_prev_closed  on public.project_revenue_schedule;
create trigger trg_prev_closed  before insert or update or delete on public.project_revenue_schedule
  for each row execute function public.pc_finance_closed_guard();
drop trigger if exists trg_ppb_closed   on public.project_phase_budgets;
create trigger trg_ppb_closed   before insert or update or delete on public.project_phase_budgets
  for each row execute function public.pc_finance_closed_guard();

-- إعدادات المالية نفسها تُجمَّد بعد الإغلاق (عقد/خصم/VAT/ميزانية/حدود):
-- المسموح فقط: عملية الإغلاق (snapshot من null→قيمة) وإعادة الفتح (قيمة→null).
create or replace function public.pc_settings_closed_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.closed_snapshot is not null and new.closed_snapshot is not distinct from old.closed_snapshot then
    raise exception 'project_closed';
  end if;
  return new;
end $$;
drop trigger if exists trg_pfs_closed on public.project_finance_settings;
create trigger trg_pfs_closed before update on public.project_finance_settings
  for each row execute function public.pc_settings_closed_guard();

-- استرداد مصروف مدفوع (Reversal) — المسار الوحيد المسموح بعد الإغلاق مع الإلغاء.
create or replace function public.pc_expense_refund(p_expense uuid, p_reason text)
returns public.project_expenses language plpgsql security definer set search_path = public as $$
declare r public.project_expenses;
begin
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into r from public.project_expenses where id = p_expense and is_deleted = false for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not public.pc_can_see_finance(r.project_id) then raise exception 'not authorized'; end if;
  if r.status <> 'paid' then raise exception 'bad_state'; end if;
  update public.project_expenses set status = 'refunded',
      notes = coalesce(notes,'') || ' | استرداد: ' || left(btrim(p_reason),300), updated_at = now()
    where id = p_expense returning * into r;
  perform public.pc_log(r.project_id, 'expense_refunded', 'expense', p_expense, jsonb_build_object('reason', left(btrim(p_reason),200)));
  return r;
end $$;

-- ═══ B5.6 قائمة تدقيق الإغلاق المالي ═══
create or replace function public.pc_finance_closure_checklist(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_items jsonb := '[]'; v_crit int := 0;
  v_cnt int; v_amt numeric; v_has_custody boolean := false;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;

  -- 1) دفعات عميل غير محصّلة بالكامل.
  select count(*), coalesce(sum(amount_incl_vat - collected_amount), 0) into v_cnt, v_amt
    from public.project_revenue_schedule
    where project_id = p_project and is_deleted = false
      and status not in ('paid','cancelled','refunded') and (amount_incl_vat - collected_amount) > 0;
  v_items := v_items || jsonb_build_object('key','uncollected','ar','دفعات عميل غير محصّلة','count',v_cnt,'amount',v_amt,'ok',v_cnt=0,'critical',true);
  if v_cnt > 0 then v_crit := v_crit + 1; end if;

  -- 2) دفعات متأخرة (تفصيل إعلامي ضمن السابق).
  select count(*) into v_cnt from public.project_revenue_schedule
    where project_id = p_project and is_deleted = false and due_date < current_date
      and status not in ('paid','cancelled','refunded') and (amount_incl_vat - collected_amount) > 0;
  v_items := v_items || jsonb_build_object('key','overdue','ar','دفعات متأخرة عن استحقاقها','count',v_cnt,'ok',v_cnt=0,'critical',false);

  -- 3) مصروفات معلّقة (مسودّة/مقدَّمة/قيد المراجعة).
  select count(*) into v_cnt from public.project_expenses
    where project_id = p_project and is_deleted = false and status in ('draft','submitted','under_review');
  v_items := v_items || jsonb_build_object('key','pending_expenses','ar','مصروفات معلّقة غير مبتوت فيها','count',v_cnt,'ok',v_cnt=0,'critical',true);
  if v_cnt > 0 then v_crit := v_crit + 1; end if;

  -- 4) مصروفات معتمدة غير مدفوعة.
  select count(*), coalesce(sum(amount_incl_vat), 0) into v_cnt, v_amt from public.project_expenses
    where project_id = p_project and is_deleted = false and status in ('approved','scheduled_for_payment','partially_paid');
  v_items := v_items || jsonb_build_object('key','approved_unpaid','ar','مصروفات معتمدة غير مدفوعة','count',v_cnt,'amount',v_amt,'ok',v_cnt=0,'critical',true);
  if v_cnt > 0 then v_crit := v_crit + 1; end if;

  -- 5) مستندات ناقصة: مصروف مدفوع بلا إيصال.
  select count(*) into v_cnt from public.project_expenses
    where project_id = p_project and is_deleted = false and status = 'paid' and coalesce(receipt_url,'') = '';
  v_items := v_items || jsonb_build_object('key','missing_receipts','ar','مصروفات مدفوعة بلا إيصال','count',v_cnt,'ok',v_cnt=0,'critical',false);

  -- 6) عهد/حجوزات معدات مفتوحة على المشروع (إن كان نظام العهدة مطبّقًا).
  if to_regclass('public.custody_inventory_reservations') is not null then
    execute $q2$select exists (
        select 1 from public.custody_inventory_reservations r where r.project_id = $1 and r.status = 'active'
        union all
        select 1 from public.custody_inventory_assignments g where g.project_id = $1 and g.is_deleted = false
          and g.status in ('pending_employee_confirmation','active','return_requested','under_inspection','partially_returned','disputed'))$q2$
      into v_has_custody using p_project;
  end if;
  v_items := v_items || jsonb_build_object('key','open_custody','ar','عهد أو حجوزات معدات مفتوحة','ok', not v_has_custody,'critical',true);
  if v_has_custody then v_crit := v_crit + 1; end if;

  -- 7) تجاوز ميزانيات المراحل (أساس التكلفة: بلا VAT قابلة للاسترداد).
  select count(*) into v_cnt from (
    select b.phase, b.allocated,
      coalesce((select sum(e.amount_excl_vat + case when e.recoverable_vat then 0 else e.vat_amount end)
        from public.project_expenses e
        where e.project_id = p_project and e.is_deleted = false and e.phase = b.phase
          and e.status in ('approved','scheduled_for_payment','partially_paid','paid')), 0) as spent
    from public.project_phase_budgets b where b.project_id = p_project
  ) x where x.allocated > 0 and x.spent > x.allocated;
  v_items := v_items || jsonb_build_object('key','phase_over','ar','مراحل تجاوزت ميزانيتها','count',v_cnt,'ok',v_cnt=0,'critical',false);

  -- 8) تنبيهات مالية حرجة مفتوحة.
  select count(*) into v_cnt from public.project_financial_alerts
    where project_id = p_project and resolved_at is null and level = 'critical';
  v_items := v_items || jsonb_build_object('key','critical_alerts','ar','تنبيهات مالية حرجة مفتوحة','count',v_cnt,'ok',v_cnt=0,'critical',true);
  if v_cnt > 0 then v_crit := v_crit + 1; end if;

  return jsonb_build_object('items', v_items, 'critical_count', v_crit, 'can_close', v_crit = 0,
    'closed', public.pc_finance_closed(p_project));
end $$;

-- ═══ B5.7 الإغلاق المالي — Snapshot غير قابل للتعديل الصامت ═══
create or replace function public.pc_finance_close(p_project uuid, p_override boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record; v_check jsonb; v_snap jsonb;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.is_deleted = false) then raise exception 'not_found'; end if;
  -- مشروع له تاريخ مالي بلا صف إعدادات: يُنشأ (trigger البذر يرث الميزانية القديمة).
  insert into public.project_finance_settings(project_id) values (p_project) on conflict (project_id) do nothing;
  select * into s from public.project_finance_settings where project_id = p_project for update;
  if s.closed_snapshot is not null then raise exception 'already_closed'; end if;
  v_check := public.pc_finance_closure_checklist(p_project);
  if (v_check->>'critical_count')::int > 0 then
    -- تجاوز الإغلاق: المالك فقط + سبب إلزامي.
    if not (p_override and public.is_owner()) then raise exception 'closure_blocked'; end if;
    if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  end if;
  v_snap := jsonb_build_object(
    'summary', public.pc_finance_summary(p_project),
    'checklist', v_check,
    'phase_budgets', coalesce((select jsonb_agg(jsonb_build_object('phase', b.phase, 'allocated', b.allocated)) from public.project_phase_budgets b where b.project_id = p_project), '[]'::jsonb),
    'open_alerts', coalesce((select jsonb_agg(jsonb_build_object('level', a.level, 'kind', a.kind, 'message', a.message)) from public.project_financial_alerts a where a.project_id = p_project and a.resolved_at is null), '[]'::jsonb),
    'closed_by', auth.uid(), 'closed_at', now(),
    'override', case when (v_check->>'critical_count')::int > 0
                     then jsonb_build_object('by', auth.uid(), 'reason', left(btrim(p_reason),500)) end);
  update public.project_finance_settings set closed_snapshot = v_snap where project_id = p_project;
  perform public.pc_log(p_project, 'finance_closed', 'project', p_project,
    jsonb_build_object('override', (v_check->>'critical_count')::int > 0));
  if s.accountant_id is not null and s.accountant_id <> auth.uid() then
    perform public.pc_notify_user(s.accountant_id, 'project_status_changed', 'project', p_project,
      'أُغلقت حسابات المشروع ماليًا', 'Project finances were closed');
  end if;
  return jsonb_build_object('ok', true, 'closed_at', v_snap->>'closed_at');
end $$;

-- ═══ B5.8 إعادة الفتح — المالك فقط، بسبب؛ الـSnapshot القديمة تُحفظ في closure_history ولا تُعدَّل ═══
create or replace function public.pc_finance_reopen(p_project uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s record;
begin
  if not public.is_owner() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into s from public.project_finance_settings where project_id = p_project for update;
  if s.project_id is null or s.closed_snapshot is null then raise exception 'not_closed'; end if;
  update public.project_finance_settings set
    closure_history = closure_history || jsonb_build_object(
      'snapshot', s.closed_snapshot, 'reopened_by', auth.uid(), 'reopened_at', now(), 'reason', left(btrim(p_reason),500)),
    closed_snapshot = null
    where project_id = p_project;
  perform public.pc_log(p_project, 'finance_reopened', 'project', p_project, jsonb_build_object('reason', left(btrim(p_reason),200)));
  return jsonb_build_object('ok', true);
end $$;

-- ═══ B5.9 التقرير المالي الشامل (عزل مالي كامل — finance فقط) ═══
create or replace function public.pc_finance_report(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'summary', public.pc_finance_summary(p_project),
    'checklist', public.pc_finance_closure_checklist(p_project),
    'by_category', coalesce((select jsonb_agg(x order by (x->>'cost')::numeric desc) from (
        select jsonb_build_object('category', e.category,
          'count', count(*),
          'cost', sum(e.amount_excl_vat + case when e.recoverable_vat then 0 else e.vat_amount end) filter (where e.status = 'paid'),
          'committed', sum(e.amount_excl_vat + case when e.recoverable_vat then 0 else e.vat_amount end) filter (where e.status in ('approved','scheduled_for_payment','partially_paid'))) x
        from public.project_expenses e where e.project_id = p_project and e.is_deleted = false
          and e.status in ('approved','scheduled_for_payment','partially_paid','paid')
        group by e.category) q), '[]'::jsonb),
    'by_supplier', coalesce((select jsonb_agg(x order by (x->>'cost')::numeric desc) from (
        select jsonb_build_object('supplier', coalesce(e.supplier,'—'),
          'count', count(*),
          'cost', sum(e.amount_excl_vat + case when e.recoverable_vat then 0 else e.vat_amount end)) x
        from public.project_expenses e where e.project_id = p_project and e.is_deleted = false
          and e.status in ('approved','scheduled_for_payment','partially_paid','paid')
        group by coalesce(e.supplier,'—')) q), '[]'::jsonb),
    'by_phase', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('phase', b.phase, 'allocated', b.allocated,
          'spent', coalesce((select sum(e.amount_excl_vat + case when e.recoverable_vat then 0 else e.vat_amount end)
            from public.project_expenses e where e.project_id = p_project and e.is_deleted = false and e.phase = b.phase
              and e.status in ('approved','scheduled_for_payment','partially_paid','paid')), 0)) x
        from public.project_phase_budgets b where b.project_id = p_project) q), '[]'::jsonb),
    'revenue', coalesce((select jsonb_agg(jsonb_build_object(
        'name', r.name, 'due_date', r.due_date, 'amount_incl_vat', r.amount_incl_vat,
        'collected', r.collected_amount, 'outstanding', r.amount_incl_vat - r.collected_amount,
        'status', r.status, 'overdue', r.due_date < current_date and r.status not in ('paid','cancelled','refunded'))
        order by r.due_date nulls last)
      from public.project_revenue_schedule r where r.project_id = p_project and r.is_deleted = false), '[]'::jsonb),
    'cashflow_monthly', coalesce((select jsonb_agg(x order by (x->>'month')) from (
        select jsonb_build_object('month', m, 'paid_out', sum(po), 'collected_in', sum(ci)) x from (
          select to_char(e.paid_date, 'YYYY-MM') as m,
                 (e.amount_excl_vat + case when e.recoverable_vat then 0 else e.vat_amount end) as po, 0::numeric as ci
            from public.project_expenses e
            where e.project_id = p_project and e.is_deleted = false and e.status = 'paid' and e.paid_date is not null
          union all
          select to_char(r.collected_date, 'YYYY-MM'), 0, r.collected_amount
            from public.project_revenue_schedule r
            where r.project_id = p_project and r.is_deleted = false and r.collected_date is not null and r.collected_amount > 0
        ) raw where m is not null group by m) q), '[]'::jsonb),
    'closed_snapshot', (select s.closed_snapshot from public.project_finance_settings s where s.project_id = p_project),
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ═══ B5.10 Grants (دوال Batch 5) ═══
do $g5$
declare f text;
begin
  foreach f in array array[
    'public.pc_finance_closure_checklist(uuid)',
    'public.pc_finance_close(uuid,boolean,text)',
    'public.pc_finance_reopen(uuid,text)',
    'public.pc_finance_report(uuid)',
    'public.pc_expense_refund(uuid,text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- دوال الـTrigger والمساعدات داخلية بالكامل (لا probing لحالة الإغلاق من العملاء).
  execute 'revoke all on function public.pc_budget_mirror() from public, anon, authenticated';
  execute 'revoke all on function public.pc_budget_seed() from public, anon, authenticated';
  execute 'revoke all on function public.pc_budget_guard() from public, anon, authenticated';
  execute 'revoke all on function public.pc_finance_closed_guard() from public, anon, authenticated';
  execute 'revoke all on function public.pc_settings_closed_guard() from public, anon, authenticated';
  execute 'revoke all on function public.pc_finance_closed(uuid) from public, anon, authenticated';
end $g5$;

-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 6 — القوالب الكاملة (وحدات متعددة + تواريخ نسبية) + دورة حياة المخرجات
--           (إصدارات/اعتماد/رؤية العميل/تسليم نهائي/تجاوز) — فوق الجداول القائمة
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B6.1 أعمدة إضافية ═══
alter table public.deliverables add column if not exists assignee_id uuid references auth.users(id) on delete set null;
alter table public.deliverables add column if not exists due_date date;
alter table public.project_deliverable_versions add column if not exists file_path      text;
alter table public.project_deliverable_versions add column if not exists client_visible boolean not null default false;
alter table public.project_deliverable_versions add column if not exists approved_at    timestamptz;
alter table public.project_deliverable_versions add column if not exists approved_by    uuid;
alter table public.project_deliverable_versions add column if not exists is_final       boolean not null default false;
alter table public.project_deliverable_versions add column if not exists superseded     boolean not null default false;
alter table public.project_templates add column if not exists service_type          text;
alter table public.project_templates add column if not exists default_duration_days int;

-- ═══ B6.2 مخزن ملفات المخرجات — خاص، للموظفين فقط؛ العرض عبر Signed URLs ═══
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-deliverables','project-deliverables', false, 104857600)
on conflict (id) do update set public = false, file_size_limit = 104857600;
drop policy if exists pdlv_files_read on storage.objects;
create policy pdlv_files_read on storage.objects for select to authenticated
  using (bucket_id = 'project-deliverables' and public.is_staff());
drop policy if exists pdlv_files_write on storage.objects;
create policy pdlv_files_write on storage.objects for insert to authenticated
  with check (bucket_id = 'project-deliverables' and public.is_staff());

-- ═══ B6.2b إغلاق الباب الخلفي: كتابة النسخ عبر RPCs فقط (لا PATCH مباشر يتجاوز
--     حواجز الاعتماد/النهائي/الاستبدال). سياسة الكتابة القديمة تُزال والصلاحيات تُسحب. ═══
drop policy if exists project_deliverable_versions_write on public.project_deliverable_versions;
revoke insert, update, delete on public.project_deliverable_versions from authenticated;

-- ═══ B6.2c قراءة التعليقات الداخلية للكوادر (تتماشى مع بوابة الكتابة pc_can_read_project) ═══
drop policy if exists internal_comments_staff_read on public.internal_comments;
create policy internal_comments_staff_read on public.internal_comments for select to authenticated
  using (is_deleted = false and public.pc_can_read_project(
    coalesce(project_id, (select d.project_id from public.deliverables d where d.id = deliverable_id))));

-- ═══ B6.3 إنشاء/تعديل مخرَج ═══
create or replace function public.pc_deliverable_upsert(p_project uuid, p_data jsonb)
returns public.deliverables language plpgsql security definer set search_path = public as $$
declare r public.deliverables; v_id uuid := nullif(p_data->>'id','')::uuid;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if v_id is null then
    if coalesce(btrim(p_data->>'title'),'') = '' then raise exception 'title_required'; end if;
    insert into public.deliverables(project_id, title, type, assignee_id, due_date, watermark_required, allow_download)
      values (p_project, btrim(p_data->>'title'), coalesce(nullif(p_data->>'type',''),'video'),
        nullif(p_data->>'assignee_id','')::uuid, nullif(p_data->>'due_date','')::date,
        coalesce((p_data->>'watermark_required')::boolean, true), coalesce((p_data->>'allow_download')::boolean, false))
      returning * into r;
    perform public.pc_log(p_project, 'deliverable_created', 'deliverable', r.id, jsonb_build_object('title', r.title));
    if r.assignee_id is not null and r.assignee_id <> auth.uid() then
      perform public.pc_notify_user(r.assignee_id, 'project_note_new', 'deliverable', r.id,
        'كُلِّفت بمخرَج: '||r.title, 'Deliverable assigned: '||r.title);
    end if;
  else
    select * into r from public.deliverables where id = v_id and project_id = p_project and is_deleted = false for update;
    if r.id is null then raise exception 'not_found'; end if;
    if r.status = 'final_delivered' and (p_data ? 'title' or p_data ? 'type') then raise exception 'already_final'; end if;
    update public.deliverables set
      title = coalesce(nullif(btrim(p_data->>'title'),''), title),
      type = coalesce(nullif(p_data->>'type',''), type),
      assignee_id = case when p_data ? 'assignee_id' then nullif(p_data->>'assignee_id','')::uuid else assignee_id end,
      due_date = case when p_data ? 'due_date' then nullif(p_data->>'due_date','')::date else due_date end,
      watermark_required = coalesce((p_data->>'watermark_required')::boolean, watermark_required),
      allow_download = coalesce((p_data->>'allow_download')::boolean, allow_download)
      where id = v_id returning * into r;
    perform public.pc_log(p_project, 'deliverable_updated', 'deliverable', v_id, '{}');
  end if;
  return r;
end $$;

-- ═══ B6.4 إضافة نسخة (نفس التوقيع؛ تدعم ملف المخزن + منع الإضافة بعد التسليم النهائي) ═══
create or replace function public.project_core_deliverable_version_add(p_deliverable uuid, p_data jsonb)
returns public.project_deliverable_versions language plpgsql security definer set search_path = public as $$
declare r public.project_deliverable_versions; v_proj uuid; v_ver int; v_status text;
begin
  select project_id, status into v_proj, v_status from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(v_proj) then raise exception 'not authorized'; end if;
  if v_status = 'final_delivered' then raise exception 'already_final'; end if;
  v_ver := coalesce(nullif(p_data->>'version','')::int,
                    (select coalesce(max(version),0)+1 from public.project_deliverable_versions where deliverable_id = p_deliverable));
  if exists (select 1 from public.project_deliverable_versions where deliverable_id = p_deliverable and version = v_ver)
    then raise exception 'duplicate_version'; end if;
  insert into public.project_deliverable_versions(deliverable_id, version, preview_url, file_path, note, created_by)
    values (p_deliverable, v_ver, nullif(btrim(coalesce(p_data->>'preview_url','')),''),
      nullif(btrim(coalesce(p_data->>'file_path','')),''), nullif(btrim(coalesce(p_data->>'note','')),''), auth.uid())
    returning * into r;
  -- نسخة جديدة تعيد المخرَج للمراجعة الداخلية.
  update public.deliverables set status = 'internal_review' where id = p_deliverable and status in ('draft','revision_requested','client_review','approved');
  perform public.pc_log(v_proj, 'deliverable_version_added', 'deliverable', p_deliverable, jsonb_build_object('version', v_ver));
  perform public.pc_notify_team(v_proj, 'project_note_new', 'deliverable', p_deliverable,
    'أُضيفت نسخة جديدة للمخرَج (v'||v_ver||')', 'New deliverable version (v'||v_ver||')', auth.uid());
  return r;
end $$;

-- ═══ B6.5 دورة مراجعة النسخة — send_client/approve/reject/revision/final/unshare/archive ═══
create or replace function public.pc_deliverable_review(p_version uuid, p_action text, p_note text default null, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v record; d record; v_latest int;
begin
  select * into v from public.project_deliverable_versions where id = p_version for update;
  if v.id is null then raise exception 'not_found'; end if;
  select * into d from public.deliverables where id = v.deliverable_id and is_deleted = false for update;
  if d.id is null then raise exception 'not_found'; end if;
  if not public.can_manage_projects() and not public.can_edit_project(d.project_id) then raise exception 'not authorized'; end if;
  select max(version) into v_latest from public.project_deliverable_versions where deliverable_id = d.id;

  -- مخرَج مُسلَّم نهائيًا لا يقبل أي تحوّل مراجعة (الأرشفة فقط).
  if d.status = 'final_delivered' and p_action in ('approve','reject','revision','send_client') then
    raise exception 'already_final';
  end if;

  if p_action = 'send_client' then
    -- إظهار نسخة للعميل = مراجعة عميل رسمية؛ النسخ الداخلية لا تُكشف إلا بهذا المسار.
    update public.project_deliverable_versions set client_visible = true where id = p_version;
    -- واجهة العميل تقرأ معاينة صف المخرَج — تُحدَّث لتطابق النسخة المُرسلة.
    update public.deliverables set status = 'client_review',
      preview_url = coalesce(v.preview_url, preview_url), version = v.version where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_sent_client', 'deliverable', d.id, jsonb_build_object('version', v.version));
  elsif p_action = 'unshare' then
    update public.project_deliverable_versions set client_visible = false where id = p_version;
    perform public.pc_log(d.project_id, 'deliverable_unshared', 'deliverable', d.id, jsonb_build_object('version', v.version));
  elsif p_action = 'approve' then
    if v.approved_at is not null then raise exception 'already_decided'; end if;
    -- اعتماد نسخة أقدم من الأحدث يتطلب تأكيدًا صريحًا.
    if v.version < v_latest and not p_force then raise exception 'old_version'; end if;
    -- النسخة المعتمدة السابقة تُستبدل (Supersede) — لا اعتمادان فعّالان.
    update public.project_deliverable_versions set superseded = true
      where deliverable_id = d.id and approved_at is not null and superseded = false and id <> p_version;
    update public.project_deliverable_versions set approved_at = now(), approved_by = auth.uid(), superseded = false
      where id = p_version;
    update public.deliverables set status = 'approved' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_approved', 'deliverable', d.id, jsonb_build_object('version', v.version, 'forced_old', v.version < v_latest));
    perform public.pc_notify_team(d.project_id, 'project_note_new', 'deliverable', d.id,
      'اعتُمدت نسخة المخرَج v'||v.version||' — '||d.title, 'Deliverable version approved', auth.uid());
  elsif p_action in ('reject','revision') then
    if coalesce(btrim(p_note),'') = '' then raise exception 'reason_required'; end if;
    update public.deliverables set status = 'revision_requested' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_revision', 'deliverable', d.id,
      jsonb_build_object('version', v.version, 'note', left(btrim(p_note),500), 'action', p_action));
    if d.assignee_id is not null then
      perform public.pc_notify_user(d.assignee_id, 'project_note_new', 'deliverable', d.id,
        'طُلب تعديل على المخرَج: '||d.title, 'Revision requested: '||d.title);
    end if;
  elsif p_action = 'final' then
    -- التسليم النهائي والأرشفة للمدير/المالك فقط (يوافق طبقة can_final_deliver القائمة).
    if not public.can_final_deliver() then raise exception 'not authorized'; end if;
    -- لا تسليم نهائي بلا نسخة معتمدة؛ ولا تسليم مزدوج؛ ونسخة أقدم من الأحدث تتطلب تأكيدًا.
    if d.status = 'final_delivered' then raise exception 'already_final'; end if;
    if v.approved_at is null or v.superseded then raise exception 'no_approved_version'; end if;
    if v.version < v_latest and not p_force then raise exception 'old_version'; end if;
    update public.project_deliverable_versions set is_final = true where id = p_version;
    update public.deliverables set status = 'final_delivered' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_final', 'deliverable', d.id, jsonb_build_object('version', v.version));
    perform public.pc_notify_team(d.project_id, 'project_note_new', 'deliverable', d.id,
      'تسليم نهائي للمخرَج: '||d.title||' (v'||v.version||')', 'Final delivery', auth.uid());
  elsif p_action = 'archive' then
    if not public.can_final_deliver() then raise exception 'not authorized'; end if;
    update public.deliverables set status = 'archived' where id = d.id;
    perform public.pc_log(d.project_id, 'deliverable_archived', 'deliverable', d.id, '{}');
  else
    raise exception 'bad_state';
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'version', v.version);
end $$;

-- ═══ B6.6 تعليق داخلي بكود زمني على مخرَج (يستخدم internal_comments القائم) ═══
create or replace function public.pc_deliverable_comment(p_deliverable uuid, p_body text, p_timecode int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_id uuid;
begin
  select project_id into v_proj from public.deliverables where id = p_deliverable and is_deleted = false;
  if v_proj is null then raise exception 'not_found'; end if;
  if not public.pc_can_read_project(v_proj) then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'body_required'; end if;
  -- قيد one_parent: أب واحد فقط — التعليق على مخرَج ⇒ project_id يبقى NULL.
  insert into public.internal_comments(project_id, deliverable_id, author_id, category, body, timecode_seconds)
    values (null, p_deliverable, auth.uid(), 'qa', left(btrim(p_body),4000), p_timecode)
    returning id into v_id;
  perform public.pc_log(v_proj, 'deliverable_comment', 'deliverable', p_deliverable, jsonb_build_object('timecode', p_timecode));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- ═══ B6.7 تطبيق قالب v2 — وحدات متعددة + تواريخ نسبية + منع التكرار + Audit ═══
create or replace function public.project_core_apply_template_v2(
  p_project uuid, p_template uuid, p_modules text[] default null, p_start date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_spec jsonb; elem jsonb; sub jsonb; ck jsonb; v_task uuid; v_base date; v_app uuid := gen_random_uuid();
  v_tasks int := 0; v_miles int := 0; v_dlvs int := 0; v_risks int := 0; v_meets int := 0; v_shoots int := 0; v_ck int;
  v_idx int := 0; v_ids uuid[] := '{}'; v_dep int;
  mod_on boolean;
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  select spec into v_spec from public.project_templates where id = p_template and is_active = true;
  if v_spec is null then raise exception 'template_not_found'; end if;
  if exists (select 1 from public.project_activity where project_id = p_project
             and action in ('template_applied','template_applied_v2')
             and detail->>'template_id' = p_template::text) then raise exception 'already_applied'; end if;
  v_base := coalesce(p_start, (select start_date from public.project_core where project_id = p_project), current_date);
  -- المهام (+ فرعية + قوائم تحقق + اعتماديات بالفهرس)
  mod_on := p_modules is null or 'tasks' = any(p_modules);
  if mod_on and jsonb_typeof(v_spec->'tasks') = 'array' then
    for elem in select value from jsonb_array_elements(v_spec->'tasks') loop
      insert into public.project_tasks(project_id, title, description, priority, estimated_hours, created_by,
          start_date, due_date, sort_order)
        values (p_project, coalesce(nullif(btrim(elem->>'title'),''),'مهمة'), nullif(btrim(coalesce(elem->>'description','')),''),
          coalesce(nullif(elem->>'priority',''),'normal'), nullif(elem->>'estimated_hours','')::numeric, auth.uid(),
          case when (elem->>'offset_days') ~ '^-?[0-9]+$' then v_base + (elem->>'offset_days')::int end,
          case when (elem->>'due_offset_days') ~ '^-?[0-9]+$' then v_base + (elem->>'due_offset_days')::int
               when (elem->>'offset_days') ~ '^-?[0-9]+$' then v_base + (elem->>'offset_days')::int end,
          v_idx)
        returning id into v_task;
      v_ids := v_ids || v_task; v_idx := v_idx + 1; v_tasks := v_tasks + 1;
      v_ck := 0;
      for ck in select value from jsonb_array_elements(case when jsonb_typeof(elem->'checklist')='array' then elem->'checklist' else '[]'::jsonb end) loop
        insert into public.project_task_checklists(task_id, label, sort_order)
          values (v_task, coalesce(nullif(left(coalesce(ck->>'label', ck#>>'{}'),300),''),'بند'), v_ck);
        v_ck := v_ck + 1;
      end loop;
      for sub in select value from jsonb_array_elements(case when jsonb_typeof(elem->'subtasks')='array' then elem->'subtasks' else '[]'::jsonb end) loop
        insert into public.project_tasks(project_id, parent_task_id, title, priority, created_by, sort_order)
          values (p_project, v_task, coalesce(nullif(left(coalesce(sub->>'title', sub#>>'{}'),300),''),'مهمة فرعية'),
            coalesce(nullif(sub->>'priority',''),'normal'), auth.uid(), 0);
        v_tasks := v_tasks + 1;
      end loop;
    end loop;
    -- الاعتماديات بالفهرس (depends_on = فهرس مهمة سابقة في القالب).
    v_idx := 0;
    for elem in select value from jsonb_array_elements(v_spec->'tasks') loop
      v_dep := case when (elem->>'depends_on') ~ '^[0-9]+$' then (elem->>'depends_on')::int end;
      if v_dep is not null and v_dep < v_idx and v_dep >= 0 then
        insert into public.task_dependencies(task_id, depends_on_task_id)
          values (v_ids[v_idx + 1], v_ids[v_dep + 1]) on conflict do nothing;
      end if;
      v_idx := v_idx + 1;
    end loop;
  end if;
  -- المعالم → عناصر الخطة الزمنية
  mod_on := p_modules is null or 'milestones' = any(p_modules);
  if mod_on and jsonb_typeof(v_spec->'milestones') = 'array' then
    for elem in select value from jsonb_array_elements(v_spec->'milestones') loop
      insert into public.project_schedule_items(project_id, title, event_type, start_at, all_day, is_milestone,
          client_visible, created_by, updated_by)
        values (p_project, coalesce(nullif(left(coalesce(elem->>'title', elem#>>'{}'),300),''),'معلَم'), 'milestone',
          (v_base + case when (elem->>'offset_days') ~ '^-?[0-9]+$' then (elem->>'offset_days')::int else 0 end)::timestamptz, true, true,
          coalesce((elem->>'client_visible')::boolean, false), auth.uid(), auth.uid());
      v_miles := v_miles + 1;
    end loop;
  end if;
  -- المخرجات
  mod_on := p_modules is null or 'deliverables' = any(p_modules);
  if mod_on and jsonb_typeof(v_spec->'deliverables') = 'array' then
    for elem in select value from jsonb_array_elements(v_spec->'deliverables') loop
      insert into public.deliverables(project_id, title, type, due_date)
        values (p_project, coalesce(nullif(left(coalesce(elem->>'title', elem#>>'{}'),300),''),'مخرَج'),
          coalesce(nullif(elem->>'type',''),'video'),
          case when (elem->>'offset_days') ~ '^-?[0-9]+$' then v_base + (elem->>'offset_days')::int end);
      v_dlvs := v_dlvs + 1;
    end loop;
  end if;
  -- المخاطر
  mod_on := p_modules is null or 'risks' = any(p_modules);
  if mod_on and jsonb_typeof(v_spec->'risks') = 'array' then
    for elem in select value from jsonb_array_elements(v_spec->'risks') loop
      insert into public.project_risks(project_id, title, severity, likelihood, status, created_by)
        values (p_project, coalesce(nullif(left(coalesce(elem->>'title', elem#>>'{}'),300),''),'خطر'),
          case when elem->>'severity' in ('low','medium','high','critical') then elem->>'severity' else 'medium' end,
          case when elem->>'likelihood' in ('rare','possible','likely','almost_certain') then elem->>'likelihood' else 'possible' end,
          'open', auth.uid());
      v_risks := v_risks + 1;
    end loop;
  end if;
  -- الاجتماعات (Placeholders بتواريخ نسبية)
  mod_on := p_modules is null or 'meetings' = any(p_modules);
  if mod_on and jsonb_typeof(v_spec->'meetings') = 'array' then
    for elem in select value from jsonb_array_elements(v_spec->'meetings') loop
      insert into public.project_meetings(project_id, title, scheduled_at, created_by)
        values (p_project, coalesce(nullif(left(coalesce(elem->>'title', elem#>>'{}'),300),''),'اجتماع'),
          (v_base + case when (elem->>'offset_days') ~ '^-?[0-9]+$' then (elem->>'offset_days')::int else 0 end)::timestamptz + interval '10 hours', auth.uid());
      v_meets := v_meets + 1;
    end loop;
  end if;
  -- جلسات التصوير (Placeholders)
  mod_on := p_modules is null or 'shoots' = any(p_modules);
  if mod_on and jsonb_typeof(v_spec->'shoots') = 'array' then
    for elem in select value from jsonb_array_elements(v_spec->'shoots') loop
      insert into public.project_shoot_sessions(project_id, title, session_date, status, created_by)
        values (p_project, coalesce(nullif(left(coalesce(elem->>'title', elem#>>'{}'),300),''),'جلسة تصوير'),
          v_base + case when (elem->>'offset_days') ~ '^-?[0-9]+$' then (elem->>'offset_days')::int else 0 end, 'planned', auth.uid());
      v_shoots := v_shoots + 1;
    end loop;
  end if;

  perform public.pc_log(p_project, 'template_applied_v2', 'project', p_project, jsonb_build_object(
    'template_id', p_template, 'application_id', v_app, 'base_date', v_base,
    'tasks', v_tasks, 'milestones', v_miles, 'deliverables', v_dlvs, 'risks', v_risks, 'meetings', v_meets, 'shoots', v_shoots));
  perform public.pc_notify_team(p_project, 'project_note_new', 'project', p_project,
    'طُبِّق قالب على المشروع ('||v_tasks||' مهمة، '||v_miles||' معلَم، '||v_dlvs||' مخرَج)',
    'Template applied', auth.uid());
  return jsonb_build_object('ok', true, 'application_id', v_app, 'tasks', v_tasks, 'milestones', v_miles,
    'deliverables', v_dlvs, 'risks', v_risks, 'meetings', v_meets, 'shoots', v_shoots);
end $$;

-- ═══ B6.8 Grants (دوال Batch 6) ═══
do $g6$
declare f text;
begin
  foreach f in array array[
    'public.pc_deliverable_upsert(uuid,jsonb)',
    'public.pc_deliverable_review(uuid,text,text,boolean)',
    'public.pc_deliverable_comment(uuid,text,int)',
    'public.project_core_apply_template_v2(uuid,uuid,text[],date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g6$;

-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 7 — محرك الأحداث/البريد/التذكيرات (Outbox + Queue + Retry + Idempotency)
-- يمتد فوق notifications/notify() القائمة — لا نظام موازيًا للمنصة الداخلية.
-- إرسال البريد الفعلي عبر /api/cron/notify-email (Vercel Cron + مفتاح الخدمة).
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B7.1 صندوق الأحداث الموحّد (Outbox) ═══
create table if not exists public.notification_events (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid references public.projects(id) on delete cascade,
  event_type      text not null,
  entity_type     text,
  entity_id       uuid,
  actor_id        uuid,
  occurred_at     timestamptz not null default now(),
  title_ar        text not null,
  title_en        text not null,
  body_ar         text,
  body_en         text,
  severity        text not null default 'info' check (severity in ('critical','action','info','digest')),
  direct_url      text,
  metadata        jsonb not null default '{}',
  audience        text,
  is_internal     boolean not null default true,
  idempotency_key text unique,
  created_at      timestamptz not null default now()
);

-- ═══ B7.2 طابور البريد (لكل مستلم صف — منع Double Send بقيد فريد) ═══
create table if not exists public.email_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid references public.notification_events(id) on delete cascade,
  notification_id     uuid unique,                       -- جسر إشعارات المنصة الاختيارية بالبريد
  recipient_id        uuid,
  recipient_email     text,
  subject             text not null,
  body_text           text,
  direct_url          text,
  status              text not null default 'pending'
                      check (status in ('pending','processing','sent','failed','skipped','bounced')),
  attempts            int not null default 0,
  next_attempt_at     timestamptz,
  provider_message_id text,
  last_error          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  unique (event_id, recipient_id)
);
create index if not exists idx_edel_pending on public.email_deliveries(status, next_attempt_at) where status = 'pending';

-- ═══ B7.3 تتبع التذكيرات (reminder_key + last_sent + next_eligible) ═══
create table if not exists public.reminder_tracking (
  reminder_key     text primary key,
  user_id          uuid,
  project_id       uuid,
  entity_type      text,
  entity_id        uuid,
  last_sent_at     timestamptz not null default now(),
  next_eligible_at timestamptz not null default now() + interval '20 hours'
);

-- ═══ B7.4 بثّ حدث موحّد (داخلي): Outbox + إشعار منصة + طابور بريد ═══
-- الحرج/المطلوب إجراء ⇒ بريد إلزامي (لا يُعطَّل بالتفضيلات)؛ المعلوماتي ⇒ حسب email_enabled.
create or replace function public.pc_event_emit(
  p_project uuid, p_event text, p_etype text, p_eid uuid, p_severity text,
  p_title_ar text, p_title_en text, p_body_ar text, p_body_en text,
  p_url text, p_recipients uuid[], p_idem text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; u uuid; v_email text; v_pref boolean;
begin
  -- كبح جسر البريد أثناء البثّ — الحدث يصفّ بريده الغني بنفسه (لا بريد مزدوج).
  perform set_config('kian.pc_emit', '1', true);
  if p_idem is not null then
    select id into v_id from public.notification_events where idempotency_key = p_idem;
    if v_id is not null then return v_id; end if;   -- Idempotent: الحدث مبثوث سابقًا
  end if;
  insert into public.notification_events(project_id, event_type, entity_type, entity_id, actor_id,
      title_ar, title_en, body_ar, body_en, severity, direct_url, idempotency_key)
    values (p_project, p_event, p_etype, p_eid, auth.uid(), p_title_ar, p_title_en, p_body_ar, p_body_en,
      coalesce(p_severity,'info'), p_url, p_idem)
    on conflict (idempotency_key) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from public.notification_events where idempotency_key = p_idem;
    return v_id;
  end if;
  foreach u in array coalesce(p_recipients, '{}') loop
    -- إشعار المنصة (notify يحترم portal_enabled داخليًا؛ الأنواع الأساسية القائمة).
    perform public.notify(u, 'user',
      case when coalesce(p_severity,'info') = 'critical' then 'project_status_changed' else 'project_note_new' end,
      p_etype, p_eid, p_title_ar, p_title_en);
    -- البريد: حرِج/إجراء = دائمًا؛ معلوماتي = فقط لمن فعّل email_enabled.
    select email into v_email from public.profiles where id = u;
    select email_enabled into v_pref from public.notification_preferences where user_id = u;
    if coalesce(p_severity,'info') in ('critical','action') or coalesce(v_pref, false) then
      insert into public.email_deliveries(event_id, recipient_id, recipient_email, subject, body_text, direct_url, status)
        values (v_id, u, v_email, p_title_ar, p_body_ar, p_url,
          case when v_email is null or position('@' in coalesce(v_email,'')) = 0 then 'skipped' else 'pending' end)
        on conflict (event_id, recipient_id) do nothing;
    end if;
  end loop;
  return v_id;
end $$;

-- ═══ B7.5 جسر اختياري: إشعار منصة ⟶ بريد لمن فعّل email_enabled (معلوماتي Opt-in) ═══
create or replace function public.pc_notify_email_bridge()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_email text;
begin
  if new.recipient_id is null then return new; end if;
  -- لا بريد مزدوج: أحداث pc_event_emit تصفّ بريدها بنفسها.
  if current_setting('kian.pc_emit', true) = '1' then return new; end if;
  -- نطاق الجسر: إشعارات المشاريع/المخرجات فقط — HR/العهدة/الرسائل لها قنوات بريد مستقلة.
  if new.type not in ('project_note_new','project_status_changed','deliverable_new',
    'revision_requested','deliverable_approved','deliverable_final_delivered','file_link_new') then
    return new;
  end if;
  if not exists (select 1 from public.notification_preferences
                 where user_id = new.recipient_id and email_enabled = true) then return new; end if;
  select email into v_email from public.profiles where id = new.recipient_id;
  if v_email is null or position('@' in v_email) = 0 then return new; end if;
  insert into public.email_deliveries(notification_id, recipient_id, recipient_email, subject, direct_url, status)
    values (new.id, new.recipient_id, v_email, new.title_ar,
      '/client-portal?notif=' || new.id, 'pending')
    on conflict (notification_id) do nothing;
  return new;
end $$;
drop trigger if exists trg_notif_email_bridge on public.notifications;
create trigger trg_notif_email_bridge after insert on public.notifications
  for each row execute function public.pc_notify_email_bridge();

-- ═══ B7.6 ماسح التذكيرات (يستدعيه الكرون بمفتاح الخدمة) — dedup عبر reminder_tracking ═══
create or replace function public.pc_reminders_scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; v_n int := 0; v_key text; v_team uuid[]; v_acct uuid; v_admins uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_admins from public.profiles where account_type = 'admin';

  -- 1) مهام مستحقة غدًا أو متأخرة (للمكلَّف) — Action.
  for rec in
    select t.id, t.title, t.assignee_id, t.project_id, t.due_date
    from public.project_tasks t
    where t.is_deleted = false and t.assignee_id is not null
      and t.status not in ('done','cancelled')
      and t.due_date is not null and t.due_date <= current_date + 1
  loop
    v_key := 'task_due:' || rec.id;   -- مفتاح التتبع بلا تاريخ (البوابة next_eligible_at)
    if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
    perform public.pc_event_emit(rec.project_id, 'task_due_reminder', 'task', rec.id, 'action',
      case when rec.due_date < current_date then 'مهمة متأخرة: ' || rec.title else 'مهمة تستحق غدًا: ' || rec.title end,
      'Task due: ' || rec.title, 'الموعد: ' || rec.due_date::text, null,
      '/client-portal/project-core/' || rec.project_id || '?tab=tasks', array[rec.assignee_id], v_key || ':' || current_date);
    insert into public.reminder_tracking(reminder_key, user_id, project_id, entity_type, entity_id)
      values (v_key, rec.assignee_id, rec.project_id, 'task', rec.id)
      on conflict (reminder_key) do update set last_sent_at = now(),
        -- المتأخر يُذكَّر كل 3 أيام لا يوميًا (لا وابل بريد لمهمة متأخرة 60 يومًا).
        next_eligible_at = now() + case when excluded.entity_id is not null and exists (
          select 1 from public.project_tasks tt where tt.id = excluded.entity_id and tt.due_date < current_date)
          then interval '72 hours' else interval '20 hours' end;
    v_n := v_n + 1;
  end loop;

  -- 2) جلسات تصوير غدًا (لفريق المشروع) — Action.
  for rec in
    select s.id, s.title, s.project_id, s.session_date, s.call_time
    from public.project_shoot_sessions s
    where s.is_deleted = false and s.status in ('planned','confirmed') and s.session_date = current_date + 1
  loop
    v_key := 'shoot:' || rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
    select coalesce(array_agg(pm.user_id), '{}') into v_team from public.project_members pm
      where pm.project_id = rec.project_id and pm.is_deleted = false and pm.role like 'kian_%';
    perform public.pc_event_emit(rec.project_id, 'shoot_tomorrow', 'shoot', rec.id, 'action',
      'جلسة تصوير غدًا: ' || rec.title || coalesce(' · Call ' || to_char(rec.call_time, 'HH24:MI'), ''),
      'Shoot tomorrow: ' || rec.title, null, null,
      '/client-portal/project-core/' || rec.project_id || '?tab=shoots', v_team, v_key || ':' || current_date);
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'shoot', rec.id)
      on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '20 hours';
    v_n := v_n + 1;
  end loop;

  -- 3) اجتماعات خلال 24 ساعة (للفريق) — Info.
  for rec in
    select m.id, m.title, m.project_id, m.scheduled_at
    from public.project_meetings m
    where m.is_deleted = false and m.scheduled_at between now() and now() + interval '24 hours'
  loop
    v_key := 'meeting:' || rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
    select coalesce(array_agg(pm.user_id), '{}') into v_team from public.project_members pm
      where pm.project_id = rec.project_id and pm.is_deleted = false and pm.role like 'kian_%';
    perform public.pc_event_emit(rec.project_id, 'meeting_soon', 'meeting', rec.id, 'info',
      'اجتماع قريب: ' || rec.title || ' · ' || to_char(rec.scheduled_at, 'DD/MM HH24:MI'),
      'Meeting soon: ' || rec.title, null, null,
      '/client-portal/project-core/' || rec.project_id || '?tab=meetings', v_team, v_key);
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'meeting', rec.id)
      on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '20 hours';
    v_n := v_n + 1;
  end loop;

  -- 4) مخرجات تستحق غدًا/متأخرة (للمكلَّف) — Action.
  for rec in
    select d.id, d.title, d.project_id, d.assignee_id, d.due_date
    from public.deliverables d
    where d.is_deleted = false and d.assignee_id is not null and d.due_date is not null
      and d.due_date <= current_date + 1 and d.status not in ('final_delivered','archived','approved')
  loop
    v_key := 'dlv_due:' || rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
    perform public.pc_event_emit(rec.project_id, 'deliverable_due_reminder', 'deliverable', rec.id, 'action',
      'مخرَج يقترب استحقاقه: ' || rec.title, 'Deliverable due: ' || rec.title, 'الموعد: ' || rec.due_date::text, null,
      '/client-portal/project-core/' || rec.project_id || '?tab=deliverables', array[rec.assignee_id], v_key || ':' || current_date);
    insert into public.reminder_tracking(reminder_key, user_id, project_id, entity_type, entity_id)
      values (v_key, rec.assignee_id, rec.project_id, 'deliverable', rec.id)
      on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '20 hours';
    v_n := v_n + 1;
  end loop;

  -- 5) دفعات عميل متأخرة (للمحاسب + الملّاك) — Critical (بريد إلزامي).
  for rec in
    select r.id, r.name, r.project_id, r.due_date, (r.amount_incl_vat - r.collected_amount) as outstanding,
           (select accountant_id from public.project_finance_settings s where s.project_id = r.project_id) as acct
    from public.project_revenue_schedule r
    where r.is_deleted = false and r.due_date < current_date
      and r.status not in ('paid','cancelled','refunded') and (r.amount_incl_vat - r.collected_amount) > 0
  loop
    v_key := 'rev_overdue:' || rec.id;   -- التتبع بلا تاريخ؛ الأسبوعية عبر next_eligible_at
    if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
    perform public.pc_event_emit(rec.project_id, 'client_payment_overdue', 'revenue', rec.id, 'critical',
      'دفعة عميل متأخرة: ' || rec.name, 'Client payment overdue: ' || rec.name,
      'المتبقي: ' || rec.outstanding || ' · الاستحقاق: ' || rec.due_date::text, null,
      '/client-portal/project-core/' || rec.project_id || '?tab=finance',
      (select coalesce(array_agg(distinct x), '{}') from unnest(v_admins || rec.acct) as t(x) where x is not null),
      v_key || ':' || to_char(current_date, 'IYYY-IW'));
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'revenue', rec.id)
      on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '6 days';
    v_n := v_n + 1;
  end loop;

  -- 6) تنبيهات مالية حرجة مفتوحة (خسارة متوقعة/تجاوز) — Critical.
  for rec in
    select a.id, a.project_id, a.message,
           (select accountant_id from public.project_finance_settings s where s.project_id = a.project_id) as acct
    from public.project_financial_alerts a
    where a.resolved_at is null and a.level = 'critical'
  loop
    v_key := 'fin_alert:' || rec.id;
    if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
    perform public.pc_event_emit(rec.project_id, 'budget_critical', 'project', rec.project_id, 'critical',
      'تنبيه مالي حرج: ' || rec.message, 'Critical financial alert', null, null,
      '/client-portal/project-core/' || rec.project_id || '?tab=finance',
      (select coalesce(array_agg(distinct x), '{}') from unnest(v_admins || rec.acct) as t(x) where x is not null),
      v_key || ':' || to_char(current_date, 'IYYY-IW'));
    insert into public.reminder_tracking(reminder_key, project_id, entity_type, entity_id)
      values (v_key, rec.project_id, 'fin_alert', rec.id)
      on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '6 days';
    v_n := v_n + 1;
  end loop;

  -- 7) عهدة تجاوزت موعد الإرجاع (للمستلم) — Action (إن كان نظام العهدة مطبّقًا).
  if to_regclass('public.custody_inventory_assignments') is not null then
    for rec in
      execute $q3$select g.id, g.assignment_number, g.employee_user_id, g.project_id
        from public.custody_inventory_assignments g
        where g.is_deleted = false and g.expected_return_at < now()
          and g.status in ('active','partially_returned')$q3$
    loop
      v_key := 'custody_overdue:' || rec.id;
      if exists (select 1 from public.reminder_tracking where reminder_key = v_key and next_eligible_at > now()) then continue; end if;
      perform public.pc_event_emit(rec.project_id, 'custody_return_overdue', 'custody', rec.id, 'action',
        'موعد إرجاع عهدة تجاوز: ' || rec.assignment_number, 'Custody return overdue', null, null,
        '/client-portal?tab=custody', array[rec.employee_user_id], v_key || ':' || to_char(current_date, 'IYYY-IW'));
      insert into public.reminder_tracking(reminder_key, user_id, entity_type, entity_id)
        values (v_key, rec.employee_user_id, 'custody', rec.id)
        on conflict (reminder_key) do update set last_sent_at = now(), next_eligible_at = now() + interval '6 days';
      v_n := v_n + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'reminders', v_n);
end $$;

-- ═══ B7.7 مراقبة الإشعارات (للإدارة) + إعادة المحاولة/الإلغاء ═══
create or replace function public.pc_notify_monitor(p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'status', d.status, 'attempts', d.attempts, 'subject', d.subject,
      'recipient_email', d.recipient_email,
      'recipient_name', (select pr.full_name from public.profiles pr where pr.id = d.recipient_id),
      'event_type', e.event_type, 'severity', e.severity, 'direct_url', coalesce(d.direct_url, e.direct_url),
      'last_error', d.last_error, 'next_attempt_at', d.next_attempt_at, 'sent_at', d.sent_at, 'created_at', d.created_at
    ) order by d.created_at desc), '[]'::jsonb) into v
  from (select * from public.email_deliveries order by created_at desc limit least(coalesce(p_limit,100), 300)) d
  left join public.notification_events e on e.id = d.event_id;
  return jsonb_build_object(
    'items', v,
    'counts', (select jsonb_object_agg(status, n) from
      (select status, count(*) as n from public.email_deliveries group by status) c));
end $$;

create or replace function public.pc_email_retry(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  update public.email_deliveries set status = 'pending', attempts = 0, next_attempt_at = null, last_error = null
    where id = p_id and status in ('failed','skipped');
  return found;
end $$;

create or replace function public.pc_email_cancel(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  update public.email_deliveries set status = 'skipped', last_error = 'cancelled_by_admin'
    where id = p_id and status in ('pending','processing','failed');
  return found;
end $$;

-- ═══ B7.8 RLS + Grants — الإدارة تقرأ؛ الكتابة عبر الدوال/مفتاح الخدمة فقط ═══
alter table public.notification_events enable row level security;
alter table public.email_deliveries    enable row level security;
alter table public.reminder_tracking   enable row level security;
drop policy if exists nev_admin_read on public.notification_events;
create policy nev_admin_read on public.notification_events for select to authenticated using (public.can_manage_projects());
drop policy if exists edel_admin_read on public.email_deliveries;
create policy edel_admin_read on public.email_deliveries for select to authenticated using (public.can_manage_projects());
grant select on public.notification_events, public.email_deliveries to authenticated;

do $g7$
declare f text;
begin
  foreach f in array array[
    'public.pc_notify_monitor(int)',
    'public.pc_email_retry(uuid)',
    'public.pc_email_cancel(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- داخلية: البثّ والماسح والجسر (تُستدعى من دوال أخرى أو الكرون بمفتاح الخدمة).
  execute 'revoke all on function public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text) from public, anon, authenticated';
  execute 'revoke all on function public.pc_reminders_scan() from public, anon, authenticated';
  execute 'revoke all on function public.pc_notify_email_bridge() from public, anon, authenticated';
  -- مفتاح الخدمة (service_role) يشغّل الماسح من الكرون.
  execute 'grant execute on function public.pc_reminders_scan() to service_role';
end $g7$;

-- ════════════════════════════════════════════════════════════════════════════
-- BATCH 8 — Zoho Books: جداول الربط/الطابور/الخرائط/الـWebhooks (Server-side فقط؛
-- التنفيذ الفعلي عبر /api/cron/zoho-sync بمفتاح الخدمة + ZOHO_BOOKS_SYNC_MODE).
-- كيان = التشغيل والاعتماد؛ Zoho Books = السجل المحاسبي الرسمي. لا Draft يُرحَّل.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ B8.1 إعدادات التكامل (صف واحد) ═══
create table if not exists public.zoho_books_settings (
  id                 int primary key default 1 check (id = 1),
  organization_id    text,
  organization_name  text,
  api_domain         text,
  sync_paused        boolean not null default false,
  estimates_sync_enabled boolean not null default false,
  last_test_at       timestamptz,
  last_test_ok       boolean,
  last_test_error    text,
  last_sync_at       timestamptz,
  updated_at         timestamptz not null default now()
);
insert into public.zoho_books_settings(id) values (1) on conflict (id) do nothing;

-- ═══ B8.2 خرائط الحسابات/الضرائب/طرق الدفع (لا IDs في الكود) ═══
create table if not exists public.zoho_account_mappings (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('expense_account','paid_through','tax','income_account','item')),
  local_key   text not null,            -- فئة مصروف كيان / طريقة دفع / vat15 / revenue
  zoho_id     text not null,
  zoho_name   text,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  unique (kind, local_key)
);

-- ═══ B8.3 ربط الكيانات (Local ↔ Zoho) ═══
create table if not exists public.zoho_entity_mappings (
  id                 uuid primary key default gen_random_uuid(),
  local_entity_type  text not null,     -- expense/bill/vendor_payment/invoice/customer_payment/project/contact/vendor/estimate
  local_entity_id    uuid not null,
  zoho_entity_type   text not null,
  zoho_entity_id     text not null,
  organization_id    text,
  sync_status        text not null default 'synced'
                     check (sync_status in ('not_configured','ready','pending','processing','synced','failed','conflict','needs_review','paused')),
  last_synced_at     timestamptz,
  last_local_version timestamptz,
  last_remote_hash   text,
  last_error         text,
  metadata           jsonb not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (local_entity_type, local_entity_id),
  unique (organization_id, zoho_entity_type, zoho_entity_id)
);

-- ═══ B8.4 طابور المزامنة (Jobs + Attempts + Idempotency) ═══
create table if not exists public.zoho_sync_jobs (
  id               uuid primary key default gen_random_uuid(),
  operation        text not null,       -- create_expense/create_bill/vendor_payment/invoice_upsert/customer_payment/estimate_upsert/project_upsert
  local_entity_type text not null,
  local_entity_id  uuid not null,
  project_id       uuid,
  payload          jsonb not null default '{}',
  payload_hash     text,
  idempotency_key  text unique,         -- KIAN-<TYPE>-<id>[-<op>] — منع التكرار
  status           text not null default 'pending'
                   check (status in ('pending','processing','done','failed','needs_review','cancelled','dry_run_ok')),
  attempts         int not null default 0,
  next_attempt_at  timestamptz,
  response_code    int,
  response_note    text,                -- مُعقَّم — لا أسرار
  provider_id      text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_zjobs_pending on public.zoho_sync_jobs(status, next_attempt_at) where status in ('pending','needs_review');

-- ═══ B8.5 أحداث الـWebhook (Dedup + Audit) ═══
create table if not exists public.zoho_webhook_events (
  id           uuid primary key default gen_random_uuid(),
  remote_event_id text unique,          -- منع Webhook loop/التكرار
  event_type   text,
  entity_type  text,
  entity_id    text,
  organization_id text,
  payload_hash text,
  payload      jsonb not null default '{}',
  processed_at timestamptz,
  process_note text,
  created_at   timestamptz not null default now()
);

-- ═══ B8.6 إدراج مهمة مزامنة (داخلي — تستدعيه الـTriggers) ═══
create or replace function public.zoho_enqueue(
  p_op text, p_ltype text, p_lid uuid, p_project uuid, p_payload jsonb, p_idem text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into public.zoho_sync_jobs(operation, local_entity_type, local_entity_id, project_id, payload, idempotency_key,
      payload_hash)
    values (p_op, p_ltype, p_lid, p_project, coalesce(p_payload,'{}'::jsonb), p_idem, md5(coalesce(p_payload,'{}'::jsonb)::text))
    on conflict (idempotency_key) do nothing
    returning id into v_id;
  return v_id;
end $$;

-- ═══ B8.7 Triggers الترحيل — لا Draft/Submitted/Rejected يصل إلى Zoho ═══
-- المصروف المدفوع مباشرة ⇒ Zoho Expense. المعتمد (لمورد، غير مدفوع) ⇒ Bill.
-- دفع فاتورة مورد سبق ترحيلها كـBill ⇒ Vendor Payment مرتبطة بها.
create or replace function public.zoho_expense_outbox()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'UPDATE' or new.status = old.status then return new; end if;
  if coalesce(new.kind, 'actual') <> 'actual' then return new; end if;   -- لا ترحيل للتقديري
  if new.status = 'approved' and coalesce(btrim(new.supplier),'') <> '' then
    perform public.zoho_enqueue('create_bill', 'expense', new.id, new.project_id,
      jsonb_build_object('expense', row_to_json(new)::jsonb), 'KIAN-BILL-' || new.id);
  elsif new.status = 'paid' then
    -- Bill مرتبطة أو «في الطريق» (مهمة KIAN-BILL قائمة) ⇒ الدفع Vendor Payment لا Expense.
    if exists (select 1 from public.zoho_entity_mappings m
               where m.local_entity_type = 'bill' and m.local_entity_id = new.id)
       or exists (select 1 from public.zoho_sync_jobs j
               where j.idempotency_key = 'KIAN-BILL-' || new.id
                 and j.status in ('pending','processing','done','dry_run_ok','needs_review','failed')) then
      perform public.zoho_enqueue('vendor_payment', 'expense', new.id, new.project_id,
        jsonb_build_object('expense', row_to_json(new)::jsonb), 'KIAN-VPAY-' || new.id);
    else
      perform public.zoho_enqueue('create_expense', 'expense', new.id, new.project_id,
        jsonb_build_object('expense', row_to_json(new)::jsonb), 'KIAN-EXPENSE-' || new.id);
    end if;
  elsif new.status in ('refunded','voided') then
    -- لا Delete لقيد منشور — يُعلَّم للمراجعة اليدوية في Zoho (Adjustment/Reversal وفق السياسة).
    update public.zoho_entity_mappings set sync_status = 'needs_review',
        last_error = 'المصروف ' || new.status || ' محليًا — يحتاج معالجة محاسبية في Zoho', updated_at = now()
      where local_entity_type in ('expense','bill') and local_entity_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists trg_zoho_expense on public.project_expenses;
create trigger trg_zoho_expense after update on public.project_expenses
  for each row execute function public.zoho_expense_outbox();

-- دفعة العميل: invoiced ⇒ Invoice Upsert؛ تحصيل ⇒ Customer Payment.
create or replace function public.zoho_revenue_outbox()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'UPDATE' then return new; end if;
  if new.status in ('invoiced','partially_paid','paid','overdue') and old.status in ('planned','invoice_pending') then
    perform public.zoho_enqueue('invoice_upsert', 'revenue', new.id, new.project_id,
      jsonb_build_object('revenue', row_to_json(new)::jsonb), 'KIAN-INVOICE-' || new.id);
  end if;
  if new.status in ('cancelled','refunded') and old.status not in ('cancelled','refunded') then
    update public.zoho_entity_mappings set sync_status = 'needs_review',
        last_error = 'الدفعة ' || new.status || ' محليًا — عالج الفاتورة في Zoho (Void/Credit Note)', updated_at = now()
      where local_entity_type = 'invoice' and local_entity_id = new.id;
  end if;
  if new.collected_amount > coalesce(old.collected_amount, 0) then
    perform public.zoho_enqueue('customer_payment', 'revenue', new.id, new.project_id,
      jsonb_build_object('revenue', row_to_json(new)::jsonb,
        'delta', new.collected_amount - coalesce(old.collected_amount,0)),
      'KIAN-PAYMENT-' || new.id || '-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'));
  end if;
  return new;
end $$;
drop trigger if exists trg_zoho_revenue on public.project_revenue_schedule;
create trigger trg_zoho_revenue after update on public.project_revenue_schedule
  for each row execute function public.zoho_revenue_outbox();

-- ═══ B8.8 RPCs للواجهة (finance/admin) ═══
create or replace function public.zoho_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.staff_role() in ('finance','manager')) then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'settings', (select row_to_json(s)::jsonb - 'id' from public.zoho_books_settings s where s.id = 1),
    'jobs', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from
      (select status, count(*) n from public.zoho_sync_jobs group by status) x),
    'mappings_count', (select count(*) from public.zoho_entity_mappings),
    'account_mappings', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'local_key', local_key, 'zoho_id', zoho_id, 'zoho_name', zoho_name) order by kind, local_key), '[]'::jsonb)
                         from public.zoho_account_mappings),
    'unprocessed_webhooks', (select count(*) from public.zoho_webhook_events where processed_at is null));
end $$;

create or replace function public.zoho_mapping_set(p_kind text, p_local_key text, p_zoho_id text, p_zoho_name text default null)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.staff_role() = 'finance') then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_zoho_id),'') = '' then
    delete from public.zoho_account_mappings where kind = p_kind and local_key = p_local_key;
    return true;
  end if;
  insert into public.zoho_account_mappings(kind, local_key, zoho_id, zoho_name, updated_by)
    values (p_kind, p_local_key, btrim(p_zoho_id), nullif(btrim(coalesce(p_zoho_name,'')),''), auth.uid())
    on conflict (kind, local_key) do update set zoho_id = excluded.zoho_id, zoho_name = excluded.zoho_name,
      updated_by = auth.uid(), updated_at = now();
  return true;
end $$;

create or replace function public.zoho_sync_pause(p_paused boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.staff_role() = 'finance') then raise exception 'not authorized'; end if;
  update public.zoho_books_settings set sync_paused = p_paused, updated_at = now() where id = 1;
  return true;
end $$;

create or replace function public.zoho_job_retry(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_owner() or public.staff_role() = 'finance') then raise exception 'not authorized'; end if;
  update public.zoho_sync_jobs set status = 'pending', attempts = 0, next_attempt_at = null,
      response_note = null, updated_at = now()
    where id = p_id and status in ('failed','needs_review','cancelled','dry_run_ok');
  return found;
end $$;

-- مزامنة الآن: يعيد بثّ مهام كيانات مشروع لم تُرحَّل بعد (للمالية).
create or replace function public.zoho_sync_project_now(p_project uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec record; v_n int := 0; v_revived int;
begin
  if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  -- الانتقال من dry_run إلى live: أعد مهام التجربة الناجحة إلى الطابور.
  update public.zoho_sync_jobs set status = 'pending', attempts = 0, next_attempt_at = null, updated_at = now()
    where project_id = p_project and status = 'dry_run_ok';
  get diagnostics v_revived = row_count;
  v_n := v_n + coalesce(v_revived, 0);
  for rec in select * from public.project_expenses e
    where e.project_id = p_project and e.is_deleted = false and e.status in ('approved','paid')
      and coalesce(e.kind, 'actual') = 'actual'
      and not exists (select 1 from public.zoho_entity_mappings m
                      where m.local_entity_id = e.id and m.local_entity_type in ('expense','bill'))
  loop
    if rec.status = 'paid' then
      perform public.zoho_enqueue('create_expense','expense',rec.id,p_project,
        jsonb_build_object('expense', row_to_json(rec)::jsonb), 'KIAN-EXPENSE-' || rec.id);
      v_n := v_n + 1;
    elsif coalesce(btrim(rec.supplier),'') <> '' then
      perform public.zoho_enqueue('create_bill','expense',rec.id,p_project,
        jsonb_build_object('expense', row_to_json(rec)::jsonb), 'KIAN-BILL-' || rec.id);
      v_n := v_n + 1;
    end if;
  end loop;
  for rec in select * from public.project_revenue_schedule r
    where r.project_id = p_project and r.is_deleted = false
      and r.status in ('invoiced','partially_paid','paid','overdue')
      and not exists (select 1 from public.zoho_entity_mappings m
                      where m.local_entity_id = r.id and m.local_entity_type = 'invoice')
  loop
    perform public.zoho_enqueue('invoice_upsert','revenue',rec.id,p_project,
      jsonb_build_object('revenue', row_to_json(rec)::jsonb), 'KIAN-INVOICE-' || rec.id);
    v_n := v_n + 1;
  end loop;
  -- تحصيلات سابقة بلا Customer Payment مرحَّلة (Backfill).
  for rec in select * from public.project_revenue_schedule r
    where r.project_id = p_project and r.is_deleted = false and r.collected_amount > 0
      and not exists (select 1 from public.zoho_entity_mappings m
                      where m.local_entity_id = r.id and m.local_entity_type = 'customer_payment')
  loop
    perform public.zoho_enqueue('customer_payment','revenue',rec.id,p_project,
      jsonb_build_object('revenue', row_to_json(rec)::jsonb, 'delta', rec.collected_amount),
      'KIAN-PAYMENT-' || rec.id || '-BF');
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'enqueued', v_n);
end $$;

-- تقرير Reconciliation لمشروع (أو شامل للمالية).
create or replace function public.zoho_reconciliation(p_project uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_project is not null then
    if not public.pc_can_see_finance(p_project) then raise exception 'not authorized'; end if;
  elsif not (public.is_owner() or public.staff_role() = 'finance') then
    raise exception 'not authorized';
  end if;
  return jsonb_build_object(
    'expenses', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'description', coalesce(e.description, e.category), 'amount', e.amount_incl_vat,
        'status', e.status, 'supplier', e.supplier,
        'zoho_type', m.zoho_entity_type, 'zoho_id', m.zoho_entity_id, 'sync_status', coalesce(m.sync_status,
          case when e.status in ('approved','paid') then 'not_configured' else null end),
        'last_error', m.last_error, 'last_synced_at', m.last_synced_at) order by e.created_at desc), '[]'::jsonb)
      from public.project_expenses e
      left join public.zoho_entity_mappings m on m.local_entity_id = e.id and m.local_entity_type in ('expense','bill')
      where e.is_deleted = false and (p_project is null or e.project_id = p_project)
        and e.status in ('approved','scheduled_for_payment','partially_paid','paid','refunded','voided')),
    'revenue', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'amount', r.amount_incl_vat, 'collected', r.collected_amount, 'status', r.status,
        'zoho_id', m.zoho_entity_id, 'sync_status', coalesce(m.sync_status,
          case when r.status in ('invoiced','partially_paid','paid','overdue') then 'not_configured' else null end),
        'remote', m.metadata->'remote', 'last_error', m.last_error) order by r.due_date nulls last), '[]'::jsonb)
      from public.project_revenue_schedule r
      left join public.zoho_entity_mappings m on m.local_entity_id = r.id and m.local_entity_type = 'invoice'
      where r.is_deleted = false and (p_project is null or r.project_id = p_project)),
    'jobs_open', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', j.id, 'operation', j.operation, 'status', j.status, 'attempts', j.attempts,
        'note', j.response_note, 'created_at', j.created_at) order by j.created_at desc), '[]'::jsonb)
      from public.zoho_sync_jobs j
      where j.status in ('pending','processing','failed','needs_review','dry_run_ok')
        and (p_project is null or j.project_id = p_project)),
    'unprocessed_webhooks', (select count(*) from public.zoho_webhook_events where processed_at is null));
end $$;

-- ═══ B8.9 RLS + Grants ═══
alter table public.zoho_books_settings   enable row level security;
alter table public.zoho_account_mappings enable row level security;
alter table public.zoho_entity_mappings  enable row level security;
alter table public.zoho_sync_jobs        enable row level security;
alter table public.zoho_webhook_events   enable row level security;
drop policy if exists zbs_read on public.zoho_books_settings;
create policy zbs_read on public.zoho_books_settings for select to authenticated
  using (public.is_owner() or public.staff_role() in ('finance','manager'));
drop policy if exists zem_read on public.zoho_entity_mappings;
create policy zem_read on public.zoho_entity_mappings for select to authenticated
  using (public.is_owner() or public.staff_role() = 'finance');
grant select on public.zoho_books_settings, public.zoho_entity_mappings to authenticated;

do $g8$
declare f text;
begin
  foreach f in array array[
    'public.zoho_status()',
    'public.zoho_mapping_set(text,text,text,text)',
    'public.zoho_sync_pause(boolean)',
    'public.zoho_job_retry(uuid)',
    'public.zoho_sync_project_now(uuid)',
    'public.zoho_reconciliation(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  execute 'revoke all on function public.zoho_enqueue(text,text,uuid,uuid,jsonb,text) from public, anon, authenticated';
  execute 'revoke all on function public.zoho_expense_outbox() from public, anon, authenticated';
  execute 'revoke all on function public.zoho_revenue_outbox() from public, anon, authenticated';
end $g8$;

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
  -- Batch 2
  if to_regprocedure('public.pc_entity_delete(text,uuid,text)')  is null then miss := miss || ' pc_entity_delete'; end if;
  if to_regprocedure('public.pc_entity_restore(text,uuid)')      is null then miss := miss || ' pc_entity_restore'; end if;
  if to_regprocedure('public.project_core_trash(uuid)')          is null then miss := miss || ' project_core_trash'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'pc_task_update') <> 1 then miss := miss || ' overload(pc_task_update)'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_tasks' and column_name='delete_reason') = 0
    then miss := miss || ' col(project_tasks.delete_reason)'; end if;
  -- Batch 3
  if to_regprocedure('public.project_core_call_sheet_send_to(uuid,uuid[])') is null then miss := miss || ' call_sheet_send_to'; end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'pc_shoot_upsert') <> 1 then miss := miss || ' overload(pc_shoot_upsert)'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_shoot_sessions' and column_name='wrap_time') = 0
    then miss := miss || ' col(project_shoot_sessions.wrap_time)'; end if;
  -- Batch 4
  if to_regprocedure('public.pc_shoot_reserve_equipment(uuid,uuid,numeric,timestamptz,timestamptz,uuid,text)') is null then miss := miss || ' pc_shoot_reserve_equipment'; end if;
  if to_regprocedure('public.pc_reservation_to_custody(uuid)') is null then miss := miss || ' pc_reservation_to_custody'; end if;
  if to_regprocedure('public.pc_shoot_equipment_out(uuid)')    is null then miss := miss || ' pc_shoot_equipment_out'; end if;
  -- إن كان نظام العهدة مطبَّقًا يجب أن يكون عمود الربط قد أُضيف.
  if to_regclass('public.custody_inventory_reservations') is not null and
     (select count(*) from information_schema.columns where table_schema='public'
        and table_name='custody_inventory_reservations' and column_name='shoot_session_id') = 0
    then miss := miss || ' col(custody_inventory_reservations.shoot_session_id)'; end if;
  -- Batch 5
  if to_regprocedure('public.pc_finance_close(uuid,boolean,text)')      is null then miss := miss || ' pc_finance_close'; end if;
  if to_regprocedure('public.pc_finance_reopen(uuid,text)')             is null then miss := miss || ' pc_finance_reopen'; end if;
  if to_regprocedure('public.pc_finance_report(uuid)')                  is null then miss := miss || ' pc_finance_report'; end if;
  if to_regprocedure('public.pc_finance_closure_checklist(uuid)')       is null then miss := miss || ' pc_finance_closure_checklist'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_pexp_closed')      then miss := miss || ' trg_pexp_closed'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_pfs_budget_mirror') then miss := miss || ' trg_pfs_budget_mirror'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_finance_settings' and column_name='closure_history') = 0
    then miss := miss || ' col(project_finance_settings.closure_history)'; end if;
  -- Batch 6
  if to_regprocedure('public.pc_deliverable_review(uuid,text,text,boolean)') is null then miss := miss || ' pc_deliverable_review'; end if;
  if to_regprocedure('public.project_core_apply_template_v2(uuid,uuid,text[],date)') is null then miss := miss || ' apply_template_v2'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='project_deliverable_versions' and column_name='client_visible') = 0
    then miss := miss || ' col(project_deliverable_versions.client_visible)'; end if;
  if not exists (select 1 from storage.buckets where id = 'project-deliverables') then miss := miss || ' bucket(project-deliverables)'; end if;
  -- Batch 7
  if to_regclass('public.notification_events') is null then miss := miss || ' notification_events'; end if;
  if to_regclass('public.email_deliveries')    is null then miss := miss || ' email_deliveries'; end if;
  if to_regclass('public.reminder_tracking')   is null then miss := miss || ' reminder_tracking'; end if;
  if to_regprocedure('public.pc_event_emit(uuid,text,text,uuid,text,text,text,text,text,text,uuid[],text)') is null then miss := miss || ' pc_event_emit'; end if;
  if to_regprocedure('public.pc_reminders_scan()')     is null then miss := miss || ' pc_reminders_scan'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_notif_email_bridge') then miss := miss || ' trg_notif_email_bridge'; end if;
  -- Batch 8
  if to_regclass('public.zoho_sync_jobs')        is null then miss := miss || ' zoho_sync_jobs'; end if;
  if to_regclass('public.zoho_entity_mappings')  is null then miss := miss || ' zoho_entity_mappings'; end if;
  if to_regclass('public.zoho_webhook_events')   is null then miss := miss || ' zoho_webhook_events'; end if;
  if to_regprocedure('public.zoho_reconciliation(uuid)') is null then miss := miss || ' zoho_reconciliation'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_zoho_expense') then miss := miss || ' trg_zoho_expense'; end if;
  if miss <> '' then
    raise exception 'فشل التحقق النهائي — عناصر ناقصة:%', miss;
  end if;
end $v$;

notify pgrst, 'reload schema';

commit;

-- فحوص قراءة اختيارية بعد التطبيق (لا تُعدّل شيئًا):
-- select count(*) from public.project_schedule_items;
-- select public.project_core_gantt((select id from public.projects limit 1));
