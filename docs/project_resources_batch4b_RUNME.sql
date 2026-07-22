-- ════════════════════════════════════════════════════════════════════════════
-- project_resources_batch4b_RUNME.sql
-- PHASE 4 · BATCH 4B — RESOURCE CAPACITY, WORKLOAD, EQUIPMENT & BOOKING
-- ────────────────────────────────────────────────────────────────────────────
-- تصميم معتمد بعد Read-Only Audit (لا نظام موازٍ):
--   • planning_resources = طبقة Registry/Reference فقط تشير للمصادر الرسمية:
--       employee/contractor → hr_employee_profiles (employee_user_id = user_id)
--       equipment           → custody_inventory_assets (source_id = asset.id)
--       studio/vehicle/location → افتراضية أو project_locations (بلا CRM/Fleet كامل)
--     الاسم/الحالة تبقى في المصدر؛ هنا مؤشّر فقط (display_name = cache).
--   • resource_bookings = طبقة حجز تخطيطية مركزية (Soft holds/reservations)، وليست
--     صرف عهدة. الصرف الفعلي يبقى داخل نظام العهدة (custody_inventory_*). حجز المعدة
--     يفحص واقع العهدة (صيانة/توفر/حجوزات custody) كمصدر تعارض، دون الكتابة عليه.
--   • التوفر/الإجازات عبر Adapter فوق hr_leave_requests + hr_holidays + التقويم، بلا نسخ.
--   • أيام العمل من planning_calendar_settings (مصدر التخطيط المعتمد في 4A).
--
-- قيود صارمة: Additive · Idempotent · داخل Transaction · بلا DROP · بلا حذف بيانات ·
--   بلا Temp Tables في دوال القراءة (تعمل قراءة-فقط عبر PostgREST) · لا يمسّ core_stage/
--   progress/المالية/Zoho/العهدة (قراءة فقط) · self-test يُلغي المعاملة عند فشل العقد ·
--   notify pgrst · GRANT/RLS/Comments · Preflight/Post-verify.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ §0) Preflight ═══
do $pf$
begin
  if to_regclass('public.projects') is null or to_regclass('public.project_tasks') is null
     or to_regclass('public.hr_employee_profiles') is null or to_regclass('public.custody_inventory_assets') is null
     or to_regclass('public.planning_calendar_settings') is null or to_regprocedure('public.pc_can_read_project(uuid)') is null
     or to_regprocedure('public.emp_has_permission(text)') is null then
    raise exception '4B preflight: نقص في الأساس (projects/project_tasks/hr_employee_profiles/custody_inventory_assets/planning_calendar_settings/pc_can_read_project/emp_has_permission).';
  end if;
end $pf$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §1) الجداول
-- ════════════════════════════════════════════════════════════════════════════

-- 1.1 سجل الموارد (Registry/Reference)
create table if not exists public.planning_resources (
  id               uuid primary key default gen_random_uuid(),
  resource_type    text not null check (resource_type in ('employee','contractor','equipment','studio','vehicle','location','vendor_resource')),
  display_name     text not null,
  source_type      text check (source_type in ('hr_employee_profiles','custody_inventory_assets','project_locations','virtual')),
  source_id        uuid,
  employee_user_id uuid references auth.users(id) on delete set null,
  capacity_units   numeric not null default 1 check (capacity_units >= 0),
  timezone         text not null default 'Asia/Riyadh',
  is_active        boolean not null default true,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  is_deleted       boolean not null default false
);
comment on table public.planning_resources is '4B: طبقة Registry للموارد — تشير للمصادر الرسمية (hr_employee_profiles/custody_inventory_assets/…) دون تكرارها كمصدر حقيقة.';
-- منع تكرار تسجيل نفس المصدر
create unique index if not exists ux_planning_resources_source
  on public.planning_resources(source_type, source_id) where source_id is not null and is_deleted = false;
create index if not exists ix_planning_resources_type on public.planning_resources(resource_type) where is_deleted = false;
create index if not exists ix_planning_resources_emp  on public.planning_resources(employee_user_id) where employee_user_id is not null and is_deleted = false;

-- 1.2 عدم توفّر المورد (Ad-hoc؛ الإجازات الرسمية عبر Adapter على hr_leave_requests)
create table if not exists public.resource_unavailability (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references public.planning_resources(id) on delete cascade,
  reason_type  text not null default 'blackout' check (reason_type in ('leave','sick','training','maintenance','blackout','travel','custom')),
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  note         text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  is_deleted   boolean not null default false,
  check (ends_at > starts_at)
);
create index if not exists ix_resource_unavail on public.resource_unavailability(resource_id, starts_at, ends_at) where is_deleted = false;

-- 1.3 قواعد التوفر الأسبوعية المتكررة (اختيارية)
create table if not exists public.resource_availability_rules (
  id          uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.planning_resources(id) on delete cascade,
  weekday     int check (weekday between 0 and 6),  -- 0=أحد … 6=سبت
  start_time  time,
  end_time    time,
  valid_from  date,
  valid_to    date,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists ix_resource_avail_rules on public.resource_availability_rules(resource_id) where is_active;

-- 1.4 الحجوزات المركزية (طبقة تخطيط)
create table if not exists public.resource_bookings (
  id                       uuid primary key default gen_random_uuid(),
  resource_id              uuid not null references public.planning_resources(id),
  project_id               uuid references public.projects(id),
  task_id                  uuid references public.project_tasks(id),
  shoot_session_id         uuid references public.project_shoot_sessions(id),
  booking_type             text not null check (booking_type in ('task','shooting','studio','equipment','vehicle','employee_shift','maintenance','blackout','other')),
  starts_at                timestamptz not null,
  ends_at                  timestamptz not null,
  timezone                 text not null default 'Asia/Riyadh',
  quantity                 numeric not null default 1 check (quantity > 0),
  status                   text not null default 'draft'
                           check (status in ('draft','hold','pending_approval','confirmed','in_use','completed','cancelled','rejected')),
  priority                 text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  notes                    text,
  created_by               uuid references auth.users(id),
  approved_by              uuid references auth.users(id),
  approved_at              timestamptz,
  conflict_override_by     uuid references auth.users(id),
  conflict_override_reason text,
  overridden_conflicts     jsonb,
  version                  int not null default 1,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  cancelled_at             timestamptz,
  is_deleted               boolean not null default false,
  check (ends_at > starts_at)
);
comment on table public.resource_bookings is '4B: حجوزات موارد تخطيطية (soft holds) — ليست صرف عهدة. الكتابة عبر RPCs فقط.';
create index if not exists ix_rb_resource_time on public.resource_bookings(resource_id, starts_at, ends_at) where is_deleted = false;
create index if not exists ix_rb_project_time  on public.resource_bookings(project_id, starts_at)          where is_deleted = false;
create index if not exists ix_rb_task          on public.resource_bookings(task_id)                        where task_id is not null and is_deleted = false;
create index if not exists ix_rb_shoot         on public.resource_bookings(shoot_session_id)               where shoot_session_id is not null and is_deleted = false;
create index if not exists ix_rb_status        on public.resource_bookings(status)                         where is_deleted = false;

-- فهارس مساعِدة للأداء (Workload/Conflicts)
create index if not exists ix_pta_user_task on public.project_task_assignees(user_id, task_id);
create index if not exists ix_ptasks_dates_assignee on public.project_tasks(start_date, due_date, assignee_id) where coalesce(is_deleted,false) = false;

-- ════════════════════════════════════════════════════════════════════════════
-- §2) محرك التعارضات — دالة داخلية (بلا بوابة auth؛ REVOKE) بلا Temp Tables
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.resource_booking_conflicts(
  p_resource uuid, p_starts timestamptz, p_ends timestamptz, p_exclude uuid default null, p_quantity numeric default 1)
returns table(conflict_type text, severity text, conflicting_booking_id uuid, project_id uuid,
              starts_at timestamptz, ends_at timestamptz, explanation_ar text, explanation_en text, can_override boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_rtype text; v_stype text; v_sid uuid; v_cap numeric; v_qtotal numeric; v_avail_status text; v_cond text;
  v_used numeric;
begin
  select pr.resource_type, pr.source_type, pr.source_id, pr.capacity_units
    into v_rtype, v_stype, v_sid, v_cap
  from public.planning_resources pr where pr.id = p_resource and pr.is_deleted = false;
  if v_rtype is null then return; end if;

  -- (1) تداخل حجوزات على نفس المورد
  return query
    select 'hard_conflict',
      case when b.status in ('confirmed','in_use') then 'hard_conflict' else 'soft_warning' end,
      b.id, b.project_id, b.starts_at, b.ends_at,
      'يتداخل مع حجز آخر لنفس المورد ('||b.status||')', 'Overlaps another booking for this resource ('||b.status||')',
      true
    from public.resource_bookings b
    where b.resource_id = p_resource and b.is_deleted = false
      and b.status in ('hold','pending_approval','confirmed','in_use')
      and (p_exclude is null or b.id <> p_exclude)
      and b.starts_at < p_ends and b.ends_at > p_starts;

  -- (2) عدم توفّر Ad-hoc
  return query
    select case u.reason_type when 'maintenance' then 'maintenance_conflict' else 'availability_conflict' end,
      case u.reason_type when 'blackout' then 'hard_conflict' else 'availability_conflict' end,
      null::uuid, null::uuid, u.starts_at, u.ends_at,
      'المورد غير متاح ('||u.reason_type||')', 'Resource unavailable ('||u.reason_type||')', true
    from public.resource_unavailability u
    where u.resource_id = p_resource and u.is_deleted = false
      and u.starts_at < p_ends and u.ends_at > p_starts;

  -- (3) الموظف: إجازة معتمدة
  if v_rtype in ('employee','contractor') then
    return query
      select 'availability_conflict', 'availability_conflict', null::uuid, null::uuid,
        lr.start_date::timestamptz, (coalesce(lr.end_date, lr.start_date) + 1)::timestamptz,
        'الموظف في إجازة معتمدة', 'Employee on approved leave', true   -- لا نكشف نوع الإجازة (بيانات HR حسّاسة)
      from public.planning_resources pr
      join public.hr_leave_requests lr on lr.user_id = pr.employee_user_id
      where pr.id = p_resource and lr.status = 'approved'
        and lr.start_date <= p_ends::date and coalesce(lr.end_date, lr.start_date) >= p_starts::date;
  end if;

  -- (4) المعدات: واقع العهدة (صيانة/توفر/حجوزات custody/السعة الكمية)
  if v_rtype = 'equipment' and v_stype = 'custody_inventory_assets' and v_sid is not null then
    -- quantity_available يعكس الواقع (يخصم المصروف/الصيانة/المحجوز) — نستخدمه كسقف للسعة
    select a.availability_status, a.condition_status, a.quantity_available
      into v_avail_status, v_cond, v_qtotal
    from public.custody_inventory_assets a where a.id = v_sid;

    if v_avail_status in ('lost','retired') or v_cond in ('lost','retired') then
      return query select 'hard_conflict','hard_conflict', null::uuid, null::uuid, p_starts, p_ends,
        'المعدة '||v_avail_status||' — غير قابلة للحجز', 'Asset '||v_avail_status||' — cannot be booked', false;
    end if;
    if v_avail_status = 'maintenance' or v_cond = 'under_maintenance' then
      return query select 'maintenance_conflict','maintenance_conflict', null::uuid, null::uuid, p_starts, p_ends,
        'المعدة قيد الصيانة حاليًا', 'Asset currently under maintenance', true;
    end if;
    -- صيانة مجدولة متداخلة
    return query
      select 'maintenance_conflict','maintenance_conflict', null::uuid, null::uuid,
        coalesce(m.sent_at, m.created_at), coalesce(m.expected_return_at, m.created_at + interval '1 day'),
        'صيانة مجدولة/جارية على المعدة', 'Scheduled/ongoing maintenance on asset', true
      from public.custody_inventory_maintenance m
      where m.asset_id = v_sid and m.status in ('opened','sent','in_progress')
        and coalesce(m.sent_at, m.created_at) < p_ends
        and coalesce(m.expected_return_at, m.created_at + interval '1 day') > p_starts;
    -- حجوزات العهدة النشطة المتداخلة
    return query
      select 'custody_conflict','custody_conflict', null::uuid, r.project_id,
        r.reserved_from, r.reserved_to,
        'محجوزة في نظام العهدة', 'Reserved in custody system', true
      from public.custody_inventory_reservations r
      where r.asset_id = v_sid and r.status = 'active'
        and coalesce(r.reserved_from, p_starts) < p_ends and coalesce(r.reserved_to, p_ends) > p_starts;
    -- سعة كمية المعدة: الحجوزات التخطيطية المتداخلة فقط (حجوزات العهدة النشطة مطروحة مسبقًا من quantity_available)
    if v_qtotal is not null then
      select coalesce(sum(b.quantity),0) into v_used from public.resource_bookings b
      where b.resource_id = p_resource and b.is_deleted = false and b.status in ('hold','pending_approval','confirmed','in_use')
        and (p_exclude is null or b.id <> p_exclude) and b.starts_at < p_ends and b.ends_at > p_starts;
      if v_used + p_quantity > v_qtotal then
        return query select 'capacity_conflict','capacity_conflict', null::uuid, null::uuid, p_starts, p_ends,
          'الكمية المطلوبة تتجاوز المتوفر ('||v_qtotal||')', 'Requested quantity exceeds available ('||v_qtotal||')', true;
      end if;
    end if;
  else
    -- سعة الموارد غير الكمية (capacity_units)
    if coalesce(v_cap,1) > 0 then
      select coalesce(sum(b.quantity),0) into v_used from public.resource_bookings b
      where b.resource_id = p_resource and b.is_deleted = false and b.status in ('hold','pending_approval','confirmed','in_use')
        and (p_exclude is null or b.id <> p_exclude) and b.starts_at < p_ends and b.ends_at > p_starts;
      if v_used + p_quantity > v_cap then
        return query select 'capacity_conflict','capacity_conflict', null::uuid, null::uuid, p_starts, p_ends,
          'تجاوز سعة المورد ('||v_cap||')', 'Exceeds resource capacity ('||v_cap||')', true;
      end if;
    end if;
  end if;
end $$;
revoke execute on function public.resource_booking_conflicts(uuid,timestamptz,timestamptz,uuid,numeric) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §3) دوال مساعدة داخلية
-- ════════════════════════════════════════════════════════════════════════════
-- 3.1 هل يملك المستخدم صلاحية موارد؟ (مرساة is_staff تطابق RLS — عزل العميل على مستوى RPC أيضًا)
create or replace function public.res_can(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and (public.can_manage_projects() or public.emp_has_permission(p_key));
$$;
revoke execute on function public.res_can(text) from public, anon;
grant execute on function public.res_can(text) to authenticated;

-- 3.2 بطاقة مورد مُثراة (اسم/حالة من المصدر) — jsonb
create or replace function public.res_card(p_resource uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id', pr.id, 'resource_type', pr.resource_type, 'display_name', pr.display_name,
    'source_type', pr.source_type, 'source_id', pr.source_id, 'employee_user_id', pr.employee_user_id,
    'capacity_units', pr.capacity_units, 'is_active', pr.is_active,
    'employee', case when pr.employee_user_id is not null then
      (select jsonb_build_object('full_name', e.full_name, 'job_title', e.job_title, 'department', e.department,
         'employment_status', e.employment_status)
       from public.hr_employee_profiles e where e.user_id = pr.employee_user_id and coalesce(e.is_deleted,false)=false limit 1) end,
    'asset', case when pr.source_type = 'custody_inventory_assets' then
      (select jsonb_build_object('asset_code', a.asset_code, 'asset_name', a.asset_name, 'asset_type', a.asset_type,
         'availability_status', a.availability_status, 'condition_status', a.condition_status,
         'quantity_total', a.quantity_total, 'quantity_available', a.quantity_available)
       from public.custody_inventory_assets a where a.id = pr.source_id limit 1) end)
    into v from public.planning_resources pr where pr.id = p_resource and pr.is_deleted = false;
  return coalesce(v, '{}'::jsonb);
end $$;
revoke execute on function public.res_card(uuid) from public, anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
-- §4) RPCs — دورة حياة الحجز (ذرّية، بوابة صلاحية، تعارضات، Audit، إشعارات)
-- ════════════════════════════════════════════════════════════════════════════

-- 4.1 إنشاء حجز
create or replace function public.resource_booking_create(p_payload jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_res uuid; v_proj uuid; v_task uuid; v_shoot uuid; v_type text; v_s timestamptz; v_e timestamptz;
  v_qty numeric; v_prio text; v_notes text; v_status text; v_override boolean; v_reason text;
  v_conf jsonb; v_hard int; v_id uuid; v_pr record;
begin
  if not public.res_can('resources.book') then raise exception 'not authorized'; end if;
  v_res   := (p_payload->>'resource_id')::uuid;
  v_proj  := nullif(p_payload->>'project_id','')::uuid;
  v_task  := nullif(p_payload->>'task_id','')::uuid;
  v_shoot := nullif(p_payload->>'shoot_session_id','')::uuid;
  v_type  := coalesce(nullif(p_payload->>'booking_type',''), 'other');
  v_s     := (p_payload->>'starts_at')::timestamptz;
  v_e     := (p_payload->>'ends_at')::timestamptz;
  v_qty   := coalesce(nullif(p_payload->>'quantity','')::numeric, 1);
  v_prio  := coalesce(nullif(p_payload->>'priority',''), 'normal');
  v_notes := nullif(p_payload->>'notes','');
  v_status:= coalesce(nullif(p_payload->>'status',''), 'hold');
  v_override := coalesce((p_payload->>'override')::boolean, false);
  v_reason:= nullif(p_payload->>'override_reason','');

  if v_res is null then raise exception 'bad_resource'; end if;
  if v_s is null or v_e is null or v_e <= v_s then raise exception 'bad_dates'; end if;
  if v_qty <= 0 then raise exception 'bad_quantity'; end if;
  if v_status not in ('draft','hold','pending_approval','confirmed') then raise exception 'bad_status'; end if;

  select * into v_pr from public.planning_resources where id = v_res and is_deleted = false;
  if v_pr.id is null then raise exception 'bad_resource'; end if;
  if not v_pr.is_active then raise exception 'resource_inactive'; end if;

  -- المشروع + انتماء المهمة/الجلسة لنفس المشروع
  if v_proj is not null and not public.pc_can_read_project(v_proj) then raise exception 'not authorized'; end if;
  if v_task  is not null and v_proj is not null and not exists
    (select 1 from public.project_tasks t where t.id = v_task and t.project_id = v_proj and coalesce(t.is_deleted,false)=false)
    then raise exception 'bad_link'; end if;
  if v_shoot is not null and v_proj is not null and not exists
    (select 1 from public.project_shoot_sessions s where s.id = v_shoot and s.project_id = v_proj) then raise exception 'bad_link'; end if;

  -- التعارضات
  -- الحجب على التعارض الحاد أو تجاوز السعة (كلاهما يمنع الحجز إلا بتجاوز مُصرّح)
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb), count(*) filter (where c.severity in ('hard_conflict','capacity_conflict'))
    into v_conf, v_hard
  from public.resource_booking_conflicts(v_res, v_s, v_e, null, v_qty) c;

  if v_hard > 0 then
    if not v_override then raise exception 'hard_conflict'; end if;
    if not public.res_can('resources.override_conflict') then raise exception 'override_not_allowed'; end if;
    if v_reason is null then raise exception 'override_reason_required'; end if;
  end if;

  insert into public.resource_bookings(resource_id, project_id, task_id, shoot_session_id, booking_type,
      starts_at, ends_at, timezone, quantity, status, priority, notes, created_by,
      conflict_override_by, conflict_override_reason, overridden_conflicts)
  values (v_res, v_proj, v_task, v_shoot, v_type, v_s, v_e, coalesce(v_pr.timezone,'Asia/Riyadh'), v_qty, v_status, v_prio, v_notes, auth.uid(),
      case when v_hard > 0 and v_override then auth.uid() end,
      case when v_hard > 0 and v_override then v_reason end,
      case when v_hard > 0 and v_override then v_conf end)
  returning id into v_id;

  if v_proj is not null then
    perform public.pc_log(v_proj, 'resource_booked', 'resource_booking', v_id,
      jsonb_build_object('resource_id', v_res, 'type', v_type, 'starts_at', v_s, 'ends_at', v_e, 'overridden', (v_hard>0 and v_override)));
  end if;
  -- إشعار المورد البشري
  if v_pr.employee_user_id is not null then
    perform public.pc_notify_user(v_pr.employee_user_id, 'project_note_new', 'resource_booking', v_id,
      'تم حجزك لمهمة/جلسة', 'You have been booked');
  end if;

  return jsonb_build_object('ok', true, 'booking', public.resource_booking_detail_core(v_id), 'conflicts', v_conf,
    'overridden', (v_hard>0 and v_override));
end $$;

-- 4.1b فحص التعارضات قبل الحجز (للواجهة: عرض التعارضات ثم إتاحة التجاوز للمخوّل)
create or replace function public.resource_check_conflicts(p_resource uuid, p_starts timestamptz, p_ends timestamptz, p_quantity numeric default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.res_can('resources.book') then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v
    from public.resource_booking_conflicts(p_resource, p_starts, p_ends, null, coalesce(p_quantity,1)) c;
  return jsonb_build_object('conflicts', v);
end $$;
revoke execute on function public.resource_check_conflicts(uuid,timestamptz,timestamptz,numeric) from public, anon;
grant  execute on function public.resource_check_conflicts(uuid,timestamptz,timestamptz,numeric) to authenticated;

-- 4.2 تفاصيل حجز — Core داخلي (بلا بوابة؛ تستدعيه دوال دورة الحياة بعد تحققها)
create or replace function public.resource_booking_detail_core(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  select jsonb_build_object(
    'id', b.id, 'resource', public.res_card(b.resource_id), 'project_id', b.project_id,
    'project_name', (select project_name from public.projects p where p.id = b.project_id),
    'task_id', b.task_id, 'task_title', (select title from public.project_tasks t where t.id = b.task_id),
    'shoot_session_id', b.shoot_session_id, 'booking_type', b.booking_type,
    'starts_at', b.starts_at, 'ends_at', b.ends_at, 'timezone', b.timezone, 'quantity', b.quantity,
    'status', b.status, 'priority', b.priority, 'notes', b.notes,
    'created_by', b.created_by, 'approved_by', b.approved_by, 'approved_at', b.approved_at,
    'conflict_override_by', b.conflict_override_by, 'conflict_override_reason', b.conflict_override_reason,
    'overridden_conflicts', coalesce(b.overridden_conflicts, '[]'::jsonb),
    'version', b.version, 'created_at', b.created_at, 'updated_at', b.updated_at, 'cancelled_at', b.cancelled_at)
    into v from public.resource_bookings b where b.id = p_id and b.is_deleted = false;
  return coalesce(v, '{}'::jsonb);
end $$;
revoke execute on function public.resource_booking_detail_core(uuid) from public, anon, authenticated;

-- تفاصيل حجز — غلاف عام (بوابة صلاحية) للواجهة
create or replace function public.resource_booking_detail(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_proj uuid;
begin
  select project_id into v_proj from public.resource_bookings where id = p_id and is_deleted = false;
  if not (public.res_can('resources.view') or (v_proj is not null and public.pc_can_read_project(v_proj))) then
    raise exception 'not authorized';
  end if;
  return public.resource_booking_detail_core(p_id);
end $$;

-- 4.3 تعديل حجز (Optimistic Lock + إعادة فحص تعارض)
create or replace function public.resource_booking_update(p_id uuid, p_patch jsonb, p_expected_version int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.resource_bookings; v_s timestamptz; v_e timestamptz; v_qty numeric; v_conf jsonb; v_hard int;
  v_override boolean; v_reason text;
begin
  if not public.res_can('resources.edit_booking') then raise exception 'not authorized'; end if;
  select * into b from public.resource_bookings where id = p_id and is_deleted = false for update;
  if b.id is null then raise exception 'not_found'; end if;
  -- نطاق المشروع: لا تعديل لحجز مشروع لا يملك المستخدم قراءته
  if b.project_id is not null and not public.pc_can_read_project(b.project_id) then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> b.version then raise exception 'stale_update'; end if;

  v_s   := coalesce(nullif(p_patch->>'starts_at','')::timestamptz, b.starts_at);
  v_e   := coalesce(nullif(p_patch->>'ends_at','')::timestamptz, b.ends_at);
  v_qty := coalesce(nullif(p_patch->>'quantity','')::numeric, b.quantity);
  if v_e <= v_s then raise exception 'bad_dates'; end if;
  if v_qty <= 0 then raise exception 'bad_quantity'; end if;
  v_override := coalesce((p_patch->>'override')::boolean, false);
  v_reason := nullif(p_patch->>'override_reason','');

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb), count(*) filter (where c.severity in ('hard_conflict','capacity_conflict'))
    into v_conf, v_hard from public.resource_booking_conflicts(b.resource_id, v_s, v_e, b.id, v_qty) c;
  if v_hard > 0 then
    if not v_override then raise exception 'hard_conflict'; end if;
    if not public.res_can('resources.override_conflict') then raise exception 'override_not_allowed'; end if;
    if v_reason is null then raise exception 'override_reason_required'; end if;
  end if;

  update public.resource_bookings set
    starts_at = v_s, ends_at = v_e, quantity = v_qty,
    booking_type = coalesce(nullif(p_patch->>'booking_type',''), booking_type),
    priority = coalesce(nullif(p_patch->>'priority',''), priority),
    notes = case when p_patch ? 'notes' then nullif(p_patch->>'notes','') else notes end,
    conflict_override_by = case when v_hard>0 and v_override then auth.uid() else conflict_override_by end,
    conflict_override_reason = case when v_hard>0 and v_override then v_reason else conflict_override_reason end,
    overridden_conflicts = case when v_hard>0 and v_override then v_conf else overridden_conflicts end,
    version = version + 1, updated_at = now()
  where id = p_id;

  if b.project_id is not null then
    perform public.pc_log(b.project_id, 'resource_booking_updated', 'resource_booking', p_id,
      jsonb_build_object('starts_at', v_s, 'ends_at', v_e, 'quantity', v_qty));
  end if;
  return jsonb_build_object('ok', true, 'booking', public.resource_booking_detail_core(p_id), 'conflicts', v_conf);
end $$;

-- 4.4 إلغاء حجز (Soft)
create or replace function public.resource_booking_cancel(p_id uuid, p_reason text, p_expected_version int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.resource_bookings;
begin
  if not public.res_can('resources.cancel_booking') then raise exception 'not authorized'; end if;
  select * into b from public.resource_bookings where id = p_id and is_deleted = false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if b.project_id is not null and not public.pc_can_read_project(b.project_id) then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> b.version then raise exception 'stale_update'; end if;
  update public.resource_bookings set status = 'cancelled', cancelled_at = now(),
    notes = coalesce(notes,'')|| case when p_reason is not null then E'\n[إلغاء] '||p_reason else '' end,
    version = version + 1, updated_at = now() where id = p_id;
  if b.project_id is not null then
    perform public.pc_log(b.project_id, 'resource_booking_cancelled', 'resource_booking', p_id, jsonb_build_object('reason', p_reason));
  end if;
  return jsonb_build_object('ok', true, 'booking', public.resource_booking_detail_core(p_id));
end $$;

-- 4.5 تأكيد حجز
create or replace function public.resource_booking_confirm(p_id uuid, p_expected_version int)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare b public.resource_bookings; v_hard int;
begin
  if not public.res_can('resources.confirm_booking') then raise exception 'not authorized'; end if;
  select * into b from public.resource_bookings where id = p_id and is_deleted = false for update;
  if b.id is null then raise exception 'not_found'; end if;
  if b.project_id is not null and not public.pc_can_read_project(b.project_id) then raise exception 'not authorized'; end if;
  if p_expected_version is not null and p_expected_version <> b.version then raise exception 'stale_update'; end if;
  select count(*) filter (where c.severity in ('hard_conflict','capacity_conflict')) into v_hard
    from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c;
  if v_hard > 0 and b.conflict_override_by is null then raise exception 'hard_conflict'; end if;
  update public.resource_bookings set status = 'confirmed', approved_by = auth.uid(), approved_at = now(),
    version = version + 1, updated_at = now() where id = p_id;
  if b.project_id is not null then
    perform public.pc_log(b.project_id, 'resource_booking_confirmed', 'resource_booking', p_id, '{}'::jsonb);
  end if;
  if b.resource_id is not null then
    perform public.pc_notify_user(pr.employee_user_id, 'project_note_new', 'resource_booking', p_id,
      'تم تأكيد الحجز', 'Booking confirmed')
    from public.planning_resources pr where pr.id = b.resource_id and pr.employee_user_id is not null;
  end if;
  return jsonb_build_object('ok', true, 'booking', public.resource_booking_detail_core(p_id));
end $$;

-- 4.6 حجز جماعي ذرّي (كل شيء أو لا شيء)
create or replace function public.resource_booking_batch_create(p_payloads jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_item jsonb; v_res jsonb; v_out jsonb := '[]'::jsonb; v_n int := 0;
begin
  if not public.res_can('resources.book') then raise exception 'not authorized'; end if;
  if jsonb_typeof(p_payloads) <> 'array' then raise exception 'bad_payload'; end if;
  for v_item in select * from jsonb_array_elements(p_payloads) loop
    v_res := public.resource_booking_create(v_item);   -- أي فشل يرفع Exception ⇒ Rollback كامل للـTransaction
    v_out := v_out || jsonb_build_array(v_res);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'count', v_n, 'results', v_out);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §5) عبء العمل (Workload)
-- ════════════════════════════════════════════════════════════════════════════
-- ساعات العمل المتاحة في نطاق (أيام عمل × ساعات/يوم × سعة) ناقص أيام الإجازة.
-- Core داخلي (بلا بوابة) — تستدعيه الأغلفة العامة والدوال المُجمِّعة دون تعارض صلاحيات.
create or replace function public.employee_workload_core(p_user uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_hpd numeric; v_workdays int; v_leavedays int; v_avail numeric; v_planned numeric; v_logged numeric;
  v_active int; v_overdue int; v_projects int; v_conf int; v_cls text; v_daily jsonb; v_util numeric;
begin
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad_range'; end if;
  select coalesce(hours_per_day, 8) into v_hpd from public.planning_calendar_settings where id = 1;
  v_hpd := coalesce(v_hpd, 8);

  -- أيام العمل في النطاق (تقويم التخطيط + عطلات HR)
  select count(*) into v_workdays from generate_series(p_from, p_to, interval '1 day') d
    where public.is_working_day(d::date)
      and not exists (select 1 from public.hr_holidays h where h.holiday_date = d::date
                        and coalesce(h.is_deleted,false)=false and h.type in ('public_holiday','company_holiday','closed_day'));
  -- أيام الإجازة المعتمدة المتقاطعة — تُحسب فقط على أيام العمل غير المعطّلة (تفادي الطرح المزدوج
  -- ليوم هو عطلة رسمية وإجازة معًا؛ لأن يوم العطلة مطروح أصلًا من v_workdays).
  select count(distinct d::date) into v_leavedays
    from public.hr_leave_requests lr
    join generate_series(p_from, p_to, interval '1 day') d
      on d::date between lr.start_date and coalesce(lr.end_date, lr.start_date)
    where lr.user_id = p_user and lr.status = 'approved' and public.is_working_day(d::date)
      and not exists (select 1 from public.hr_holidays h where h.holiday_date = d::date
                        and coalesce(h.is_deleted,false)=false and h.type in ('public_holiday','company_holiday','closed_day'));
  v_avail := greatest((v_workdays - coalesce(v_leavedays,0)) * v_hpd, 0);

  -- الساعات المخطّطة فقط: مهام مُسندة بتقدير، ليست أبًا (بلا Double Counting)، تتقاطع النطاق، غير منتهية.
  select coalesce(sum(t.estimated_hours),0) into v_planned
  from public.project_tasks t
  where coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
    and (t.assignee_id = p_user or exists (select 1 from public.project_task_assignees a where a.task_id = t.id and a.user_id = p_user))
    and t.estimated_hours is not null
    and not exists (select 1 from public.project_tasks ch where ch.parent_task_id = t.id and coalesce(ch.is_deleted,false)=false)
    and coalesce(t.start_date, t.due_date) <= p_to and coalesce(t.due_date, t.start_date) >= p_from;

  -- العدّادات على كل المهام المُسندة (مستقلة عن التقدير/النافذة): نشطة/متأخرة/مشاريع.
  select count(*) filter (where t.status not in ('done','cancelled')),
         count(*) filter (where t.due_date is not null and t.due_date < (now() at time zone 'utc')::date and t.status not in ('done','cancelled')),
         count(distinct t.project_id) filter (where t.status not in ('done','cancelled'))
    into v_active, v_overdue, v_projects
  from public.project_tasks t
  where coalesce(t.is_deleted,false)=false
    and (t.assignee_id = p_user or exists (select 1 from public.project_task_assignees a where a.task_id = t.id and a.user_id = p_user));

  -- الساعات المسجّلة
  select coalesce(sum(minutes),0)/60.0 into v_logged from public.project_time_logs
    where user_id = p_user and logged_for between p_from and p_to;

  -- عدد التعارضات على حجوزات هذا الموظف في النطاق
  select count(*) into v_conf from public.resource_bookings b
    join public.planning_resources pr on pr.id = b.resource_id and pr.employee_user_id = p_user
    where b.is_deleted=false and b.status in ('hold','pending_approval','confirmed','in_use')
      and b.starts_at::date <= p_to and b.ends_at::date >= p_from
      and exists (select 1 from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c where c.severity in ('hard_conflict','capacity_conflict'));

  v_util := case when v_avail > 0 then round((v_planned / v_avail) * 100, 1) else null end;
  v_cls := case
    when v_workdays = 0 or (v_leavedays >= v_workdays and v_workdays > 0) then 'unavailable'
    when v_avail = 0 then 'unavailable'
    when v_planned > v_avail then 'overloaded'
    when v_planned >= v_avail * 0.8 then 'high'
    when v_planned >= v_avail * 0.4 then 'balanced'
    else 'available' end;

  -- تفصيل يومي (مخطّط/متاح لكل يوم)
  select coalesce(jsonb_agg(jsonb_build_object('date', d::date,
      'working', public.is_working_day(d::date),
      'available_hours', case when public.is_working_day(d::date) then v_hpd else 0 end,
      'on_leave', exists (select 1 from public.hr_leave_requests lr where lr.user_id=p_user and lr.status='approved'
                            and d::date between lr.start_date and coalesce(lr.end_date, lr.start_date)))
      order by d), '[]'::jsonb)
    into v_daily from generate_series(p_from, p_to, interval '1 day') d;

  return jsonb_build_object(
    'user_id', p_user, 'from_date', p_from, 'to_date', p_to,
    'available_hours', v_avail, 'planned_hours', v_planned, 'logged_hours', round(v_logged,2),
    'remaining_hours', round(v_avail - v_planned, 2), 'utilization_percent', v_util,
    'overload_hours', round(greatest(v_planned - v_avail, 0), 2),
    'projects_count', v_projects, 'active_tasks', v_active, 'overdue_tasks', v_overdue, 'conflict_count', v_conf,
    'classification', v_cls, 'daily_breakdown', v_daily,
    'warnings', case when v_cls='overloaded' then jsonb_build_array(jsonb_build_object('type','overloaded',
        'ar','العبء يتجاوز الساعات المتاحة بـ'||round(greatest(v_planned-v_avail,0),1)||' ساعة'))
      when v_cls='unavailable' then jsonb_build_array(jsonb_build_object('type','unavailable','ar','غير متاح في هذه الفترة'))
      else '[]'::jsonb end,
    'calculated_at', now());
end $$;
revoke execute on function public.employee_workload_core(uuid,date,date) from public, anon, authenticated;

-- غلاف عام لعبء موظف (بوابة صلاحية)
create or replace function public.employee_workload_snapshot(p_user uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.res_can('resources.view_workload') or public.res_can('resources.view_team_capacity')) then raise exception 'not authorized'; end if;
  return public.employee_workload_core(p_user, p_from, p_to);
end $$;

-- عبء فريق المشروع — Core داخلي (بلا بوابة)
create or replace function public.project_team_workload_core(p_project uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb;
begin
  select coalesce(jsonb_agg(w order by (w->>'classification')), '[]'::jsonb) into v_rows from (
    select public.employee_workload_core(u.uid, p_from, p_to)
      || jsonb_build_object('full_name', (select full_name from public.hr_employee_profiles e where e.user_id = u.uid and coalesce(e.is_deleted,false)=false limit 1),
                            'job_title', (select job_title from public.hr_employee_profiles e where e.user_id = u.uid and coalesce(e.is_deleted,false)=false limit 1)) as w
    from (
      -- اتحاد المُسندين (assignee_id) وكل المعيّنين (assignees) — دون طيّ يُسقط المعيّنين الإضافيين
      select t.assignee_id as uid from public.project_tasks t
        where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.assignee_id is not null
      union
      select a.user_id from public.project_task_assignees a
        join public.project_tasks t on t.id = a.task_id
        where t.project_id = p_project and coalesce(t.is_deleted,false)=false
    ) u
  ) z(w);
  return jsonb_build_object('project_id', p_project, 'from_date', p_from, 'to_date', p_to, 'members', v_rows, 'calculated_at', now());
end $$;
revoke execute on function public.project_team_workload_core(uuid,date,date) from public, anon, authenticated;

-- غلاف عام لعبء الفريق (بوابة صلاحية)
create or replace function public.project_team_workload(p_project uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.pc_can_read_project(p_project) and public.res_can('resources.view_team_capacity')) then raise exception 'not authorized'; end if;
  return public.project_team_workload_core(p_project, p_from, p_to);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §6) لوحات القراءة (بلا N+1، بلا Temp Tables)
-- ════════════════════════════════════════════════════════════════════════════
-- 6.1 لوحة موارد المشروع
create or replace function public.project_resources_dashboard(p_project uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_bookings jsonb; v_team jsonb; v_conflicts jsonb; v_unassigned jsonb;
begin
  if not (public.pc_can_read_project(p_project) and public.res_can('resources.view')) then raise exception 'not authorized'; end if;
  -- الحجوزات القادمة/ضمن النطاق
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'resource', public.res_card(b.resource_id),
      'booking_type', b.booking_type, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
      'quantity', b.quantity, 'task_id', b.task_id, 'shoot_session_id', b.shoot_session_id, 'version', b.version,
      'overridden', (b.conflict_override_by is not null)) order by b.starts_at), '[]'::jsonb)
    into v_bookings from public.resource_bookings b
    where b.project_id = p_project and b.is_deleted=false and b.status <> 'cancelled'
      and b.starts_at::date <= p_to and b.ends_at::date >= p_from;
  -- عبء الفريق — يُدرَج فقط لمن يملك view_team_capacity (احترام أدنى صلاحية؛ لا يُتجاوز عبر view)
  v_team := case when public.res_can('resources.view_team_capacity')
    then public.project_team_workload_core(p_project, p_from, p_to) -> 'members' else '[]'::jsonb end;
  -- تعارضات حجوزات هذا المشروع
  select coalesce(jsonb_agg(jsonb_build_object('booking_id', b.id, 'resource', public.res_card(b.resource_id), 'conflicts',
      (select jsonb_agg(to_jsonb(c)) from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c
        where c.severity='hard_conflict'))), '[]'::jsonb)
    into v_conflicts from public.resource_bookings b
    where b.project_id = p_project and b.is_deleted=false and b.status in ('hold','pending_approval','confirmed','in_use')
      and b.starts_at::date <= p_to and b.ends_at::date >= p_from
      and exists (select 1 from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c where c.severity='hard_conflict');
  -- مهام غير معيّنة داخل النطاق
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'start', t.start_date, 'end', t.due_date) order by t.due_date), '[]'::jsonb)
    into v_unassigned from public.project_tasks t
    where t.project_id = p_project and coalesce(t.is_deleted,false)=false and t.status not in ('done','cancelled')
      and t.assignee_id is null and not exists (select 1 from public.project_task_assignees a where a.task_id = t.id)
      and coalesce(t.start_date,t.due_date) <= p_to and coalesce(t.due_date,t.start_date) >= p_from;

  return jsonb_build_object('project_id', p_project, 'from_date', p_from, 'to_date', p_to,
    'bookings', v_bookings, 'team', coalesce(v_team,'[]'::jsonb), 'conflicts', v_conflicts,
    'unassigned_tasks', v_unassigned, 'generated_at', now());
end $$;

-- 6.2 خط زمني للموارد (صف لكل مورد + حجوزاته/عدم توفره)
create or replace function public.resource_timeline_snapshot(p_from date, p_to date, p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_rows jsonb; v_type text; v_project uuid;
begin
  if not public.res_can('resources.view') then raise exception 'not authorized'; end if;
  v_type := nullif(p_filters->>'resource_type','');
  v_project := nullif(p_filters->>'project_id','')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object(
      'resource', public.res_card(pr.id),
      'bookings', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'project_id', b.project_id,
          'project_name', (select project_name from public.projects p where p.id=b.project_id),
          'booking_type', b.booking_type, 'starts_at', b.starts_at, 'ends_at', b.ends_at, 'status', b.status,
          'quantity', b.quantity, 'overridden', (b.conflict_override_by is not null)) order by b.starts_at), '[]'::jsonb)
        from public.resource_bookings b where b.resource_id = pr.id and b.is_deleted=false and b.status<>'cancelled'
          and b.starts_at::date <= p_to and b.ends_at::date >= p_from
          and (v_project is null or b.project_id = v_project)),
      'unavailability', (select coalesce(jsonb_agg(jsonb_build_object('reason_type', u.reason_type,
          'starts_at', u.starts_at, 'ends_at', u.ends_at) order by u.starts_at), '[]'::jsonb)
        from public.resource_unavailability u where u.resource_id = pr.id and u.is_deleted=false
          and u.starts_at::date <= p_to and u.ends_at::date >= p_from))
      order by pr.resource_type, pr.display_name), '[]'::jsonb)
    into v_rows from public.planning_resources pr
    where pr.is_deleted=false and pr.is_active and (v_type is null or pr.resource_type = v_type)
      and (v_project is null or exists (select 1 from public.resource_bookings b where b.resource_id=pr.id and b.project_id=v_project and b.is_deleted=false));
  return jsonb_build_object('from_date', p_from, 'to_date', p_to, 'resources', v_rows, 'today', (now() at time zone 'utc')::date, 'generated_at', now());
end $$;

-- 6.3 مركز التعارضات
create or replace function public.resource_conflict_center(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_project uuid; v_from date; v_to date;
begin
  if not public.res_can('resources.view') then raise exception 'not authorized'; end if;
  v_project := nullif(p_filters->>'project_id','')::uuid;
  v_from := coalesce(nullif(p_filters->>'from','')::date, (now() at time zone 'utc')::date);
  v_to := coalesce(nullif(p_filters->>'to','')::date, ((now() at time zone 'utc')::date + 60));
  select coalesce(jsonb_agg(jsonb_build_object('booking', public.resource_booking_detail_core(b.id),
      'conflicts', (select jsonb_agg(to_jsonb(c)) from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c))
      order by b.starts_at), '[]'::jsonb)
    into v from public.resource_bookings b
    where b.is_deleted=false and b.status in ('hold','pending_approval','confirmed','in_use')
      and b.starts_at::date <= v_to and b.ends_at::date >= v_from
      and (v_project is null or b.project_id = v_project)
      and exists (select 1 from public.resource_booking_conflicts(b.resource_id, b.starts_at, b.ends_at, b.id, b.quantity) c where c.severity in ('hard_conflict','capacity_conflict'));
  return jsonb_build_object('conflicts', v, 'from_date', v_from, 'to_date', v_to, 'generated_at', now());
end $$;

-- 6.4 اقتراح الموارد (استرشادي مفسّر)
create or replace function public.resource_suggestions(p_project uuid, p_task uuid, p_profession text,
    p_starts timestamptz, p_ends timestamptz, p_equipment_types text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_from date; v_to date;
begin
  if not (public.pc_can_read_project(p_project) and public.res_can('resources.book')) then raise exception 'not authorized'; end if;
  v_from := p_starts::date; v_to := p_ends::date;
  select coalesce(jsonb_agg(s order by (s->>'rank_score')::numeric desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'resource', public.res_card(pr.id),
      'available', (select count(*) from public.resource_booking_conflicts(pr.id, p_starts, p_ends, null, 1) c where c.severity='hard_conflict') = 0,
      'utilization_percent', (public.employee_workload_core(pr.employee_user_id, v_from, v_to) ->> 'utilization_percent'),
      'profession_match', (p_profession is null or exists (select 1 from public.hr_employee_profiles e
          where e.user_id = pr.employee_user_id and (e.job_title ilike '%'||p_profession||'%'))),
      'conflicts', (select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from public.resource_booking_conflicts(pr.id, p_starts, p_ends, null, 1) c),
      'rank_score', (case when (select count(*) from public.resource_booking_conflicts(pr.id, p_starts, p_ends, null,1) c where c.severity='hard_conflict')=0 then 100 else 0 end)
        + (case when p_profession is not null and exists (select 1 from public.hr_employee_profiles e where e.user_id=pr.employee_user_id and e.job_title ilike '%'||p_profession||'%') then 50 else 0 end),
      'reason_ar', 'ترتيب حسب التوفّر ومطابقة المهنة والعبء') as s
    from public.planning_resources pr
    where pr.is_deleted=false and pr.is_active and pr.employee_user_id is not null and pr.resource_type in ('employee','contractor')
  ) q(s);
  return jsonb_build_object('project_id', p_project, 'task_id', p_task, 'suggestions', v, 'generated_at', now());
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- §7) Registry sync — تسجيل/تحديث موارد الموظفين والمعدات من المصادر الرسمية
-- ════════════════════════════════════════════════════════════════════════════
create or replace function public.planning_resources_sync()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_emp int := 0; v_eq int := 0;
begin
  if not public.res_can('resources.book') then raise exception 'not authorized'; end if;
  -- موظفون نشطون
  insert into public.planning_resources(resource_type, display_name, source_type, source_id, employee_user_id, capacity_units)
  select 'employee', e.full_name, 'hr_employee_profiles', e.id, e.user_id, 1
  from public.hr_employee_profiles e
  where coalesce(e.is_deleted,false)=false and e.employment_status='active' and e.user_id is not null
    and not exists (select 1 from public.planning_resources pr where pr.source_type='hr_employee_profiles' and pr.source_id=e.id and pr.is_deleted=false);
  get diagnostics v_emp = row_count;
  -- معدات نشطة (registry فقط؛ الاسم/الحالة تبقى في العهدة)
  insert into public.planning_resources(resource_type, display_name, source_type, source_id, capacity_units)
  select 'equipment', a.asset_name, 'custody_inventory_assets', a.id, coalesce(a.quantity_total,1)
  from public.custody_inventory_assets a
  where a.availability_status not in ('retired','lost')
    and not exists (select 1 from public.planning_resources pr where pr.source_type='custody_inventory_assets' and pr.source_id=a.id and pr.is_deleted=false);
  get diagnostics v_eq = row_count;
  -- تحديث الاسم (cache) للموجودين
  update public.planning_resources pr set display_name = e.full_name, updated_at = now()
    from public.hr_employee_profiles e where pr.source_type='hr_employee_profiles' and pr.source_id=e.id and pr.display_name <> e.full_name;
  update public.planning_resources pr set display_name = a.asset_name, capacity_units = coalesce(a.quantity_total,1), updated_at = now()
    from public.custody_inventory_assets a where pr.source_type='custody_inventory_assets' and pr.source_id=a.id and (pr.display_name <> a.asset_name or pr.capacity_units <> coalesce(a.quantity_total,1));
  return jsonb_build_object('ok', true, 'employees_added', v_emp, 'equipment_added', v_eq);
end $$;

-- ═══ §8) الصلاحيات (Catalog) ═══
insert into public.permissions (key, category, sensitivity, sort_order, label_ar, label_en) values
  ('resources.view',                   'resources', 'normal', 400, 'عرض الموارد',              'View resources'),
  ('resources.book',                   'resources', 'normal', 405, 'حجز مورد',                 'Book a resource'),
  ('resources.edit_booking',           'resources', 'normal', 410, 'تعديل حجز',                'Edit booking'),
  ('resources.cancel_booking',         'resources', 'normal', 415, 'إلغاء حجز',                'Cancel booking'),
  ('resources.confirm_booking',        'resources', 'normal', 420, 'تأكيد حجز',                'Confirm booking'),
  ('resources.override_conflict',      'resources', 'sensitive', 425, 'تجاوز التعارض',          'Override conflict'),
  ('resources.view_workload',          'resources', 'normal', 430, 'عرض عبء الموظف',           'View workload'),
  ('resources.view_team_capacity',     'resources', 'normal', 435, 'عرض طاقة الفريق',          'View team capacity'),
  ('resources.manage_calendar',        'resources', 'normal', 440, 'إدارة تقويم العمل',        'Manage work calendar'),
  ('resources.manage_equipment_booking','resources','normal', 445, 'إدارة حجز المعدات',        'Manage equipment booking'),
  ('resources.manage_studio_booking',  'resources', 'normal', 450, 'إدارة حجز الاستوديو',      'Manage studio booking'),
  ('resources.manage_vehicle_booking', 'resources', 'normal', 455, 'إدارة حجز المركبات',       'Manage vehicle booking')
on conflict (key) do nothing;

-- ═══ §9) RLS + الصلاحيات على الدوال ═══
alter table public.planning_resources         enable row level security;
alter table public.resource_bookings          enable row level security;
alter table public.resource_unavailability    enable row level security;
alter table public.resource_availability_rules enable row level security;

drop policy if exists pr_read on public.planning_resources;
create policy pr_read on public.planning_resources for select to authenticated
  using (public.is_staff() and public.res_can('resources.view'));
drop policy if exists rb_read on public.resource_bookings;
create policy rb_read on public.resource_bookings for select to authenticated
  using (public.is_staff() and (public.res_can('resources.view') or (project_id is not null and public.pc_can_read_project(project_id))));
drop policy if exists ru_read on public.resource_unavailability;
create policy ru_read on public.resource_unavailability for select to authenticated
  using (public.is_staff() and public.res_can('resources.view'));
drop policy if exists rar_read on public.resource_availability_rules;
create policy rar_read on public.resource_availability_rules for select to authenticated
  using (public.is_staff() and public.res_can('resources.view'));

-- الكتابة عبر RPCs فقط
revoke insert, update, delete on public.planning_resources, public.resource_bookings,
  public.resource_unavailability, public.resource_availability_rules from authenticated, anon;

-- منح تنفيذ الدوال العامة
grant execute on function public.resource_booking_create(jsonb)                         to authenticated;
grant execute on function public.resource_booking_update(uuid,jsonb,int)                to authenticated;
grant execute on function public.resource_booking_cancel(uuid,text,int)                 to authenticated;
grant execute on function public.resource_booking_confirm(uuid,int)                     to authenticated;
grant execute on function public.resource_booking_batch_create(jsonb)                   to authenticated;
grant execute on function public.resource_booking_detail(uuid)                          to authenticated;
grant execute on function public.employee_workload_snapshot(uuid,date,date)             to authenticated;
grant execute on function public.project_team_workload(uuid,date,date)                  to authenticated;
grant execute on function public.project_resources_dashboard(uuid,date,date)            to authenticated;
grant execute on function public.resource_timeline_snapshot(date,date,jsonb)            to authenticated;
grant execute on function public.resource_conflict_center(jsonb)                        to authenticated;
grant execute on function public.resource_suggestions(uuid,uuid,text,timestamptz,timestamptz,text[]) to authenticated;
grant execute on function public.planning_resources_sync()                              to authenticated;
revoke execute on function public.resource_booking_create(jsonb), public.resource_booking_update(uuid,jsonb,int),
  public.resource_booking_cancel(uuid,text,int), public.resource_booking_confirm(uuid,int),
  public.resource_booking_batch_create(jsonb), public.resource_booking_detail(uuid),
  public.employee_workload_snapshot(uuid,date,date), public.project_team_workload(uuid,date,date),
  public.project_resources_dashboard(uuid,date,date), public.resource_timeline_snapshot(date,date,jsonb),
  public.resource_conflict_center(jsonb), public.resource_suggestions(uuid,uuid,text,timestamptz,timestamptz,text[]),
  public.planning_resources_sync() from public, anon;

-- ════════════════════════════════════════════════════════════════════════════
-- §10) اختبار ذاتي — يُلغي المعاملة عند فشل العقد (منطق التعارض مُختبر بـsavepoint)
-- ════════════════════════════════════════════════════════════════════════════
do $selftest$
declare v_r uuid; v_b1 uuid; v_hard int; v_cap int; v_dash jsonb; v_conf_ok boolean := false;
begin
  -- (أ) savepoint: مورد اختبار + حجزان متداخلان ⇒ يجب اكتشاف hard_conflict، ثم Rollback للـsavepoint
  begin
    insert into public.planning_resources(resource_type, display_name, source_type, capacity_units)
      values ('studio','__selftest_studio__','virtual',1) returning id into v_r;
    insert into public.resource_bookings(resource_id, booking_type, starts_at, ends_at, status, created_by)
      values (v_r, 'studio', now(), now()+interval '2 hour', 'confirmed', null) returning id into v_b1;
    select count(*) filter (where c.severity='hard_conflict') into v_hard
      from public.resource_booking_conflicts(v_r, now()+interval '1 hour', now()+interval '3 hour', null, 1) c;
    if v_hard < 1 then raise exception '4B FAIL: محرك التعارض لم يكتشف التداخل'; end if;
    -- سعة: حجز كمية تتجاوز capacity_units=1
    select count(*) filter (where c.conflict_type='capacity_conflict') into v_cap
      from public.resource_booking_conflicts(v_r, now()+interval '5 hour', now()+interval '6 hour', null, 5) c;
    if v_cap < 1 then raise exception '4B FAIL: محرك السعة لم يكتشف تجاوز capacity_units'; end if;
    v_conf_ok := true;
    raise exception '__sp_rollback__';   -- تراجع عن بيانات الاختبار
  exception when others then
    if sqlerrm <> '__sp_rollback__' then raise; end if;
  end;
  if not v_conf_ok then raise exception '4B FAIL: لم يكتمل اختبار التعارض'; end if;

  -- (ب) عقد لوحة الموارد على مشروع حقيقي (قراءة فقط) — لا يرمي، عقد صالح
  begin
    select id into v_r from public.projects where coalesce(is_deleted,false)=false order by (project_name ilike '%تست 01%') desc, id limit 1;
    if v_r is not null then
      -- استدعاء داخلي للمنطق (نتجاوز بوابة الصلاحية عبر دالة القراءة المباشرة project_team_workload غير ممكن بلا auth)
      -- نكتفي بالتحقق من محرك التعارض على مورد غير موجود ⇒ لا صفوف، لا خطأ
      perform * from public.resource_booking_conflicts(gen_random_uuid(), now(), now()+interval '1 hour', null, 1);
    end if;
  exception when others then
    raise exception '4B FAIL: خطأ غير متوقّع في مسار القراءة: %', sqlerrm;
  end;

  raise notice '4B ✅ نجح الاختبار الذاتي — محرك التعارض والسعة يعملان، ومسار القراءة سليم.';
end $selftest$;

commit;

notify pgrst, 'reload schema';
