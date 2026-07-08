-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HR & EMPLOYEE PORTAL (الموارد البشرية وبوابة الموظفين)
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
-- Prerequisite: the base portal migrations are live (profiles/notify()/is_owner()/
-- staff_role()/is_staff()/touch_updated_at() + custody v2/v4 — all in production).
--
-- ADDS (HR only — touches NOTHING existing except widening the notifications
-- type CHECK with hr_* types, the established superset pattern):
--   • Tables: hr_employee_profiles, hr_attendance_records, hr_leave_requests,
--     hr_field_tasks, hr_field_task_assignees, hr_employee_events, hr_attachments
--   • Helpers: can_manage_hr(), hr_client_ip(), hr_path_ok(), hr_notify(),
--     hr_notify_admins(), hr_ensure_employee_for()
--   • Guarded RPCs: hr_my_profile, hr_admin_list_staff, hr_admin_upsert_employee,
--     hr_check_in, hr_check_out, hr_admin_adjust_attendance,
--     hr_submit_leave_request, hr_cancel_my_leave_request, hr_admin_decide_leave,
--     hr_admin_create_field_task, hr_start_my_task, hr_complete_my_task,
--     hr_admin_close_task, hr_admin_add_employee_event
--   • Storage: private bucket hr-files (task photos) + owner-first policies
--
-- PRIVACY (بدون تتبع مستمر): the location columns are written ONLY by the four
-- explicit actions (check-in / check-out / task start / task end) — each RPC
-- stores one snapshot (lat/lng/accuracy + ip + user_agent + timestamp). There is
-- NO live tracking, NO background updates, NO automatic refresh — nothing else
-- in this schema can write a location.
--
-- ROLES: employee = is_staff() (any staff_role). HR admin = can_manage_hr()
-- = is_owner() OR staff_role in ('manager','hr'). Owner-tier keeps delete power.
-- Clients/leads have ZERO access (RLS + no grants beyond select-with-policies).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Helpers ═════════════════════════════════════════════════════════
create or replace function public.can_manage_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','hr');
$$;
revoke execute on function public.can_manage_hr() from public, anon;
grant  execute on function public.can_manage_hr() to authenticated;

-- Client IP from PostgREST headers (evidence; never throws).
create or replace function public.hr_client_ip() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  v := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1);
  return nullif(trim(v), '');
exception when others then return null;
end; $$;
revoke execute on function public.hr_client_ip() from public, anon;
grant  execute on function public.hr_client_ip() to authenticated;

-- Riyadh-local work date (attendance day boundary).
create or replace function public.hr_today() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'Asia/Riyadh')::date;
$$;
revoke execute on function public.hr_today() from public, anon;
grant  execute on function public.hr_today() to authenticated;

-- ════════ 2) notifications type CHECK — preserve the live 30, add 10 hr ══════
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
  'project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed',
  'custody_checkout_new','rental_request_new','custody_return_submitted',
  'custody_return_shortage','custody_handover_approved','custody_closed',
  'custody_rejected','custody_note_new',
  'custody_claim_pending','custody_claim_acknowledged',
  -- HR (NEW — in-app; email rides the existing relay):
  'hr_check_in','hr_check_out','hr_leave_new','hr_leave_decided',
  'hr_task_new','hr_task_started','hr_task_submitted','hr_task_closed',
  'hr_attendance_adjusted','hr_note_new'));

-- ════════ 3) Tables ══════════════════════════════════════════════════════════

create table if not exists public.hr_employee_profiles (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid references auth.users(id) on delete set null,
  full_name                 text not null,
  email                     text,
  phone                     text,
  job_title                 text,
  department                text,
  staff_role_snapshot       text,
  employment_status         text not null default 'active'
                            check (employment_status in ('active','suspended','left')),
  joined_at                 date,
  left_at                   date,
  notes_internal            text,          -- HR-only (NEVER returned to the employee)
  notes_visible_to_employee text,
  is_deleted                boolean not null default false,
  deleted_at                timestamptz,
  deleted_by                uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_hr_employee_user on public.hr_employee_profiles(user_id)
  where user_id is not null and is_deleted = false;
create index if not exists idx_hr_employee_status on public.hr_employee_profiles(employment_status) where is_deleted = false;
drop trigger if exists t_hr_employee_touch on public.hr_employee_profiles;
create trigger t_hr_employee_touch before update on public.hr_employee_profiles
  for each row execute function public.touch_updated_at();

create table if not exists public.hr_attendance_records (
  id                      uuid primary key default gen_random_uuid(),
  employee_id             uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id                 uuid not null references auth.users(id),
  work_date               date not null,
  check_in_at             timestamptz,
  check_out_at            timestamptz,
  check_in_lat            double precision,
  check_in_lng            double precision,
  check_in_accuracy       double precision,
  check_out_lat           double precision,
  check_out_lng           double precision,
  check_out_accuracy      double precision,
  check_in_ip             text,
  check_out_ip            text,
  check_in_user_agent     text,
  check_out_user_agent    text,
  status                  text not null default 'present'
                          check (status in ('present','late','absent','half_day','manual_adjusted')),
  admin_adjusted_by       uuid references auth.users(id),
  admin_adjustment_reason text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index if not exists idx_hr_att_date on public.hr_attendance_records(work_date desc);
create index if not exists idx_hr_att_user on public.hr_attendance_records(user_id, work_date desc);
drop trigger if exists t_hr_att_touch on public.hr_attendance_records;
create trigger t_hr_att_touch before update on public.hr_attendance_records
  for each row execute function public.touch_updated_at();

create table if not exists public.hr_leave_requests (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  leave_type     text not null check (leave_type in
                 ('annual','sick','emergency','unpaid','permission','late','early_exit')),
  start_date     date not null,
  end_date       date,
  start_time     time,
  end_time       time,
  reason         text not null,
  attachment_url text,
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','cancelled')),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_hr_leave_user on public.hr_leave_requests(user_id, created_at desc);
create index if not exists idx_hr_leave_status on public.hr_leave_requests(status);
drop trigger if exists t_hr_leave_touch on public.hr_leave_requests;
create trigger t_hr_leave_touch before update on public.hr_leave_requests
  for each row execute function public.touch_updated_at();

create table if not exists public.hr_field_tasks (
  id                uuid primary key default gen_random_uuid(),
  title             text not null,
  description       text,
  location_name     text,
  expected_start_at timestamptz,
  expected_end_at   timestamptz,
  status            text not null default 'assigned'
                    check (status in ('draft','assigned','in_progress','submitted','completed','cancelled')),
  created_by        uuid references auth.users(id),
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_hr_tasks_status on public.hr_field_tasks(status) where is_deleted = false;
drop trigger if exists t_hr_tasks_touch on public.hr_field_tasks;
create trigger t_hr_tasks_touch before update on public.hr_field_tasks
  for each row execute function public.touch_updated_at();

create table if not exists public.hr_field_task_assignees (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.hr_field_tasks(id) on delete cascade,
  employee_id    uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  status         text not null default 'assigned'
                 check (status in ('assigned','in_progress','submitted','completed','cancelled')),
  started_at     timestamptz,
  ended_at       timestamptz,
  start_lat      double precision,
  start_lng      double precision,
  start_accuracy double precision,
  end_lat        double precision,
  end_lng        double precision,
  end_accuracy   double precision,
  start_ip       text,
  end_ip         text,
  employee_note  text,
  admin_note     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (task_id, user_id)
);
create index if not exists idx_hr_assignees_user on public.hr_field_task_assignees(user_id, created_at desc);
create index if not exists idx_hr_assignees_task on public.hr_field_task_assignees(task_id);
drop trigger if exists t_hr_assignees_touch on public.hr_field_task_assignees;
create trigger t_hr_assignees_touch before update on public.hr_field_task_assignees
  for each row execute function public.touch_updated_at();

-- Append-only audit / HR record.
create table if not exists public.hr_employee_events (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id             uuid references auth.users(id),
  event_type          text not null,
  title               text not null,
  description         text,
  metadata            jsonb,
  visible_to_employee boolean not null default false,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);
create index if not exists idx_hr_events_employee on public.hr_employee_events(employee_id, created_at desc);

create table if not exists public.hr_attachments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid references public.hr_field_tasks(id) on delete cascade,
  employee_id   uuid references public.hr_employee_profiles(id) on delete cascade,
  attendance_id uuid references public.hr_attendance_records(id) on delete cascade,
  leave_id      uuid references public.hr_leave_requests(id) on delete cascade,
  file_path     text not null,        -- hr-files bucket path (signed URLs only)
  file_type     text,
  uploaded_by   uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_hr_attach_task on public.hr_attachments(task_id);

-- ════════ 4) RLS + grants (reads scoped; ALL writes via SECURITY DEFINER RPCs) ═
alter table public.hr_employee_profiles    enable row level security;
alter table public.hr_attendance_records   enable row level security;
alter table public.hr_leave_requests       enable row level security;
alter table public.hr_field_tasks          enable row level security;
alter table public.hr_field_task_assignees enable row level security;
alter table public.hr_employee_events      enable row level security;
alter table public.hr_attachments          enable row level security;
grant select on public.hr_employee_profiles, public.hr_attendance_records,
                public.hr_leave_requests, public.hr_field_tasks,
                public.hr_field_task_assignees, public.hr_employee_events,
                public.hr_attachments to authenticated;

-- notes_internal is HR-only → the TABLE is readable by HR admins only; the
-- employee reads their own profile through hr_my_profile() which strips it.
drop policy if exists hr_employee_profiles_read on public.hr_employee_profiles;
create policy hr_employee_profiles_read on public.hr_employee_profiles
  for select to authenticated
  using (public.can_manage_hr() and (is_deleted = false or public.is_owner()));

drop policy if exists hr_attendance_read on public.hr_attendance_records;
create policy hr_attendance_read on public.hr_attendance_records
  for select to authenticated
  using (user_id = auth.uid() or public.can_manage_hr());

drop policy if exists hr_leaves_read on public.hr_leave_requests;
create policy hr_leaves_read on public.hr_leave_requests
  for select to authenticated
  using (user_id = auth.uid() or public.can_manage_hr());

drop policy if exists hr_tasks_read on public.hr_field_tasks;
create policy hr_tasks_read on public.hr_field_tasks
  for select to authenticated
  using ((not is_deleted) and (public.can_manage_hr()
         or exists (select 1 from public.hr_field_task_assignees a
                     where a.task_id = id and a.user_id = auth.uid())));

drop policy if exists hr_assignees_read on public.hr_field_task_assignees;
create policy hr_assignees_read on public.hr_field_task_assignees
  for select to authenticated
  using (user_id = auth.uid() or public.can_manage_hr());

drop policy if exists hr_events_read on public.hr_employee_events;
create policy hr_events_read on public.hr_employee_events
  for select to authenticated
  using (public.can_manage_hr() or (user_id = auth.uid() and visible_to_employee));

drop policy if exists hr_attachments_read on public.hr_attachments;
create policy hr_attachments_read on public.hr_attachments
  for select to authenticated
  using (uploaded_by = auth.uid() or public.can_manage_hr());

-- ════════ 5) Notification wrappers (REUSE public.notify — never redefined) ═══
create or replace function public.hr_notify(
  p_recipient uuid, p_type text, p_entity uuid, p_ar text, p_en text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(p_recipient, 'user', p_type, 'hr', p_entity, p_ar, p_en);
end; $$;
revoke execute on function public.hr_notify(uuid,text,uuid,text,text) from public, anon, authenticated;

-- Personal rows (no broadcasts) to: admin accounts + super_admin + manager + hr.
create or replace function public.hr_notify_admins(
  p_type text, p_entity uuid, p_ar text, p_en text
) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.profiles
            where account_status = 'active'
              and (account_type = 'admin' or staff_role in ('super_admin','manager','hr')) loop
    perform public.hr_notify(r.id, p_type, p_entity, p_ar, p_en);
  end loop;
end; $$;
revoke execute on function public.hr_notify_admins(text,uuid,text,text) from public, anon, authenticated;

-- ════════ 6) Employee resolution ══════════════════════════════════════════════
-- Internal: get-or-create the hr_employee_profiles row for a STAFF user.
create or replace function public.hr_ensure_employee_for(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_email text; v_phone text; v_role text;
begin
  select id into v_id from public.hr_employee_profiles
   where user_id = p_user and is_deleted = false limit 1;
  if v_id is not null then return v_id; end if;
  select coalesce(nullif(trim(full_name),''), email), email, mobile, staff_role
    into v_name, v_email, v_phone, v_role
    from public.profiles where id = p_user;
  if v_name is null then raise exception 'profile_not_found'; end if;
  -- اربط أولاً بملف موظف قائم غير مرتبط (أنشأه الأدمن) بنفس البريد/الجوال — لا تكرار.
  update public.hr_employee_profiles set
    user_id = p_user, staff_role_snapshot = coalesce(v_role, staff_role_snapshot), updated_at = now()
  where id = (select id from public.hr_employee_profiles
               where user_id is null and is_deleted = false
                 and ((v_email is not null and lower(coalesce(email,'')) = lower(v_email))
                      or (v_phone is not null and nullif(trim(coalesce(phone,'')),'') = nullif(trim(v_phone),'')))
               order by created_at limit 1)
  returning id into v_id;
  if v_id is not null then return v_id; end if;
  insert into public.hr_employee_profiles
    (user_id, full_name, email, phone, staff_role_snapshot, joined_at)
  values (p_user, v_name, v_email, v_phone, v_role, public.hr_today())
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.hr_ensure_employee_for(uuid) from public, anon, authenticated;

-- ════════ 7) RPCs — employee self-service ════════════════════════════════════

-- ملفي (بدون notes_internal أبداً).
create or replace function public.hr_my_profile() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; r record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_id := public.hr_ensure_employee_for(auth.uid());
  select * into r from public.hr_employee_profiles where id = v_id;
  return jsonb_build_object(
    'id', r.id, 'full_name', r.full_name, 'email', r.email, 'phone', r.phone,
    'job_title', r.job_title, 'department', r.department,
    'staff_role_snapshot', r.staff_role_snapshot,
    'employment_status', r.employment_status, 'joined_at', r.joined_at,
    'notes_visible_to_employee', r.notes_visible_to_employee);
end; $$;
revoke execute on function public.hr_my_profile() from public, anon;
grant  execute on function public.hr_my_profile() to authenticated;

-- تسجيل حضور (موقع لحظة الضغط فقط — لا تتبع).
create or replace function public.hr_check_in(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_day date; v_rec uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  if exists (select 1 from public.hr_employee_profiles where id = v_emp and employment_status <> 'active')
    then raise exception 'employee_not_active'; end if;
  v_day := public.hr_today();
  select id into v_rec from public.hr_attendance_records
   where employee_id = v_emp and work_date = v_day;
  if v_rec is not null and exists (select 1 from public.hr_attendance_records where id = v_rec and check_in_at is not null)
    then raise exception 'already_checked_in'; end if;

  if v_rec is null then
    insert into public.hr_attendance_records
      (employee_id, user_id, work_date, check_in_at, check_in_lat, check_in_lng,
       check_in_accuracy, check_in_ip, check_in_user_agent, status)
    values (v_emp, auth.uid(), v_day, now(), p_lat, p_lng, p_accuracy,
            public.hr_client_ip(), left(coalesce(p_user_agent,''), 300), 'present')
    returning id into v_rec;
  else
    update public.hr_attendance_records set
      check_in_at = now(), check_in_lat = p_lat, check_in_lng = p_lng,
      check_in_accuracy = p_accuracy, check_in_ip = public.hr_client_ip(),
      check_in_user_agent = left(coalesce(p_user_agent,''), 300), updated_at = now()
    where id = v_rec;
  end if;

  select full_name into v_name from public.hr_employee_profiles where id = v_emp;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
  values (v_emp, auth.uid(), 'attendance_checkin', 'تسجيل حضور — ' || to_char(now() at time zone 'Asia/Riyadh','HH24:MI'), auth.uid());
  perform public.hr_notify_admins('hr_check_in', v_rec,
    'حضور: ' || v_name || ' — ' || to_char(now() at time zone 'Asia/Riyadh','HH24:MI'),
    'Check-in: ' || v_name || ' — ' || to_char(now() at time zone 'Asia/Riyadh','HH24:MI'));
  return jsonb_build_object('ok', true, 'record_id', v_rec, 'checked_in_at', now());
end; $$;
revoke execute on function public.hr_check_in(double precision,double precision,double precision,text) from public, anon;
grant  execute on function public.hr_check_in(double precision,double precision,double precision,text) to authenticated;

-- تسجيل انصراف.
create or replace function public.hr_check_out(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_rec uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  -- نافذة يومين: تغطي الورديات الممتدة بعد منتصف الليل (تصوير ليلي) — يُقفل
  -- أحدث سجل مفتوح خلال آخر 20 ساعة.
  select id into v_rec from public.hr_attendance_records
   where employee_id = v_emp
     and work_date >= public.hr_today() - 1
     and check_in_at is not null and check_out_at is null
     and check_in_at > now() - interval '20 hours'
   order by work_date desc limit 1;
  if v_rec is null then raise exception 'no_open_check_in'; end if;

  update public.hr_attendance_records set
    check_out_at = now(), check_out_lat = p_lat, check_out_lng = p_lng,
    check_out_accuracy = p_accuracy, check_out_ip = public.hr_client_ip(),
    check_out_user_agent = left(coalesce(p_user_agent,''), 300), updated_at = now()
  where id = v_rec;

  select full_name into v_name from public.hr_employee_profiles where id = v_emp;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
  values (v_emp, auth.uid(), 'attendance_checkout', 'تسجيل انصراف — ' || to_char(now() at time zone 'Asia/Riyadh','HH24:MI'), auth.uid());
  perform public.hr_notify_admins('hr_check_out', v_rec,
    'انصراف: ' || v_name || ' — ' || to_char(now() at time zone 'Asia/Riyadh','HH24:MI'),
    'Check-out: ' || v_name || ' — ' || to_char(now() at time zone 'Asia/Riyadh','HH24:MI'));
  return jsonb_build_object('ok', true, 'record_id', v_rec, 'checked_out_at', now());
end; $$;
revoke execute on function public.hr_check_out(double precision,double precision,double precision,text) from public, anon;
grant  execute on function public.hr_check_out(double precision,double precision,double precision,text) to authenticated;

-- طلب إجازة/إذن.
create or replace function public.hr_submit_leave_request(
  p_type text, p_start date, p_end date, p_start_time time, p_end_time time,
  p_reason text, p_attachment text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_type not in ('annual','sick','emergency','unpaid','permission','late','early_exit')
    then raise exception 'invalid_leave_type'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  if p_start is null then raise exception 'start_date_required'; end if;
  if p_end is not null and p_end < p_start then raise exception 'invalid_date_range'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  if exists (select 1 from public.hr_employee_profiles where id = v_emp and employment_status <> 'active')
    then raise exception 'employee_not_active'; end if;

  insert into public.hr_leave_requests
    (employee_id, user_id, leave_type, start_date, end_date, start_time, end_time, reason, attachment_url)
  values (v_emp, auth.uid(), p_type, p_start, p_end, p_start_time, p_end_time, trim(p_reason), nullif(trim(coalesce(p_attachment,'')),''))
  returning id into v_id;

  select full_name into v_name from public.hr_employee_profiles where id = v_emp;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
  values (v_emp, auth.uid(), 'leave_requested', 'طلب إجازة/إذن (' || p_type || ') من ' || p_start, auth.uid());
  perform public.hr_notify_admins('hr_leave_new', v_id,
    'طلب إجازة جديد من ' || v_name || ' (' || p_type || ') — بانتظار القرار',
    'New leave request from ' || v_name || ' (' || p_type || ') — awaiting decision');
  perform public.hr_notify(auth.uid(), 'hr_leave_new', v_id,
    'استلمنا طلبك (' || p_type || ') — سيُراجع من الإدارة',
    'Your request (' || p_type || ') was received — awaiting review');
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_submit_leave_request(text,date,date,time,time,text,text) from public, anon;
grant  execute on function public.hr_submit_leave_request(text,date,date,time,time,text,text) to authenticated;

-- إلغاء طلبي (وهو معلّق فقط).
create or replace function public.hr_cancel_my_leave_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.hr_leave_requests set status = 'cancelled', updated_at = now()
   where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'not_cancellable'; end if;
  return true;
end; $$;
revoke execute on function public.hr_cancel_my_leave_request(uuid) from public, anon;
grant  execute on function public.hr_cancel_my_leave_request(uuid) to authenticated;

-- بدء مهمتي (موقع لحظة البدء فقط).
create or replace function public.hr_start_my_task(
  p_task uuid, p_lat double precision, p_lng double precision, p_accuracy double precision
) returns boolean
language plpgsql security definer set search_path = public as $$
declare a record; v_title text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into a from public.hr_field_task_assignees
   where task_id = p_task and user_id = auth.uid() and status = 'assigned';
  if not found then raise exception 'assignment_not_startable'; end if;
  if exists (select 1 from public.hr_employee_profiles where id = a.employee_id and employment_status <> 'active')
    then raise exception 'employee_not_active'; end if;

  update public.hr_field_task_assignees set
    status = 'in_progress', started_at = now(),
    start_lat = p_lat, start_lng = p_lng, start_accuracy = p_accuracy,
    start_ip = public.hr_client_ip(), updated_at = now()
  where id = a.id;
  update public.hr_field_tasks set status = 'in_progress', updated_at = now()
   where id = p_task and status = 'assigned';

  select title into v_title from public.hr_field_tasks where id = p_task;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
  values (a.employee_id, auth.uid(), 'task_start', 'بدء مهمة: ' || coalesce(v_title,''), auth.uid());
  perform public.hr_notify_admins('hr_task_started', p_task,
    'بدأ الموظف مهمة: ' || coalesce(v_title,''),
    'Task started: ' || coalesce(v_title,''));
  return true;
end; $$;
revoke execute on function public.hr_start_my_task(uuid,double precision,double precision,double precision) from public, anon;
grant  execute on function public.hr_start_my_task(uuid,double precision,double precision,double precision) to authenticated;

-- إنهاء مهمتي (موقع لحظة الإنهاء + ملاحظة + صور اختيارية من hr-files).
create or replace function public.hr_complete_my_task(
  p_task uuid, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_note text default null, p_photos jsonb default '[]'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare a record; v_title text; ph text; v_open int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into a from public.hr_field_task_assignees
   where task_id = p_task and user_id = auth.uid() and status = 'in_progress';
  if not found then raise exception 'assignment_not_in_progress'; end if;

  update public.hr_field_task_assignees set
    status = 'submitted', ended_at = now(),
    end_lat = p_lat, end_lng = p_lng, end_accuracy = p_accuracy,
    end_ip = public.hr_client_ip(),
    employee_note = nullif(trim(coalesce(p_note,'')),''), updated_at = now()
  where id = a.id;

  if jsonb_typeof(coalesce(p_photos,'[]'::jsonb)) = 'array' then
    for ph in select value #>> '{}' from jsonb_array_elements(p_photos) loop
      if ph is null or ph not like (auth.uid()::text || '/%') then raise exception 'invalid_photo_path'; end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-files' and o.name = ph)
        then raise exception 'photo_not_uploaded'; end if;
      insert into public.hr_attachments (task_id, employee_id, file_path, file_type, uploaded_by)
      values (p_task, a.employee_id, ph, 'image', auth.uid());
    end loop;
  end if;

  select count(*) into v_open from public.hr_field_task_assignees
   where task_id = p_task and status in ('assigned','in_progress');
  if v_open = 0 then
    update public.hr_field_tasks set status = 'submitted', updated_at = now()
     where id = p_task and status in ('assigned','in_progress');
  end if;

  select title into v_title from public.hr_field_tasks where id = p_task;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (a.employee_id, auth.uid(), 'task_end', 'إنهاء مهمة: ' || coalesce(v_title,''), nullif(trim(coalesce(p_note,'')),''), auth.uid());
  perform public.hr_notify_admins('hr_task_submitted', p_task,
    'سلّم الموظف مهمة: ' || coalesce(v_title,'') || ' — بانتظار اعتماد الإغلاق',
    'Task submitted: ' || coalesce(v_title,'') || ' — awaiting closure approval');
  return true;
end; $$;
revoke execute on function public.hr_complete_my_task(uuid,double precision,double precision,double precision,text,jsonb) from public, anon;
grant  execute on function public.hr_complete_my_task(uuid,double precision,double precision,double precision,text,jsonb) to authenticated;

-- ════════ 8) RPCs — HR admin ═════════════════════════════════════════════════

-- قائمة الطاقم القابل للربط (لا يمكن للمدير قراءة profiles مباشرة).
create or replace function public.hr_admin_list_staff() returns jsonb
language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', p.id, 'full_name', p.full_name, 'email', p.email,
           'mobile', p.mobile, 'staff_role', p.staff_role) order by p.full_name), '[]'::jsonb)
    into out
    from public.profiles p
   where p.account_status = 'active'
     and (p.staff_role is not null or p.account_type = 'admin');
  return out;
end; $$;
revoke execute on function public.hr_admin_list_staff() from public, anon;
grant  execute on function public.hr_admin_list_staff() to authenticated;

-- إنشاء/تعديل ملف موظف.
create or replace function public.hr_admin_upsert_employee(
  p_id uuid, p_user uuid, p_full_name text, p_email text, p_phone text,
  p_job_title text, p_department text, p_status text, p_joined date,
  p_notes_internal text, p_notes_visible text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_role text;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_full_name),''), null) is null then raise exception 'name_required'; end if;
  if p_status is not null and p_status not in ('active','suspended','left') then raise exception 'invalid_status'; end if;
  if p_user is not null then
    select staff_role into v_role from public.profiles where id = p_user;
  end if;

  if p_id is not null then
    update public.hr_employee_profiles set
      user_id = p_user, full_name = trim(p_full_name),
      email = nullif(trim(coalesce(p_email,'')),''), phone = nullif(trim(coalesce(p_phone,'')),''),
      job_title = nullif(trim(coalesce(p_job_title,'')),''), department = nullif(trim(coalesce(p_department,'')),''),
      staff_role_snapshot = coalesce(v_role, staff_role_snapshot),
      employment_status = coalesce(p_status, employment_status),
      joined_at = coalesce(p_joined, joined_at),
      left_at = case when p_status = 'left' then coalesce(left_at, public.hr_today()) else left_at end,
      notes_internal = coalesce(p_notes_internal, notes_internal),
      notes_visible_to_employee = coalesce(p_notes_visible, notes_visible_to_employee),
      updated_at = now()
    where id = p_id and is_deleted = false
    returning id into v_id;
    if v_id is null then raise exception 'employee not found'; end if;
  else
    insert into public.hr_employee_profiles
      (user_id, full_name, email, phone, job_title, department, staff_role_snapshot,
       employment_status, joined_at, notes_internal, notes_visible_to_employee)
    values (p_user, trim(p_full_name), nullif(trim(coalesce(p_email,'')),''), nullif(trim(coalesce(p_phone,'')),''),
            nullif(trim(coalesce(p_job_title,'')),''), nullif(trim(coalesce(p_department,'')),''),
            v_role, coalesce(p_status,'active'), coalesce(p_joined, public.hr_today()),
            nullif(trim(coalesce(p_notes_internal,'')),''), nullif(trim(coalesce(p_notes_visible,'')),''))
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_admin_upsert_employee(uuid,uuid,text,text,text,text,text,text,date,text,text) from public, anon;
grant  execute on function public.hr_admin_upsert_employee(uuid,uuid,text,text,text,text,text,text,date,text,text) to authenticated;

-- حذف/تعطيل ملف موظف — للمالك فقط (soft).
create or replace function public.hr_owner_delete_employee(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  update public.hr_employee_profiles set
    is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
  where id = p_id and is_deleted = false;
  if not found then raise exception 'employee not found'; end if;
  return true;
end; $$;
revoke execute on function public.hr_owner_delete_employee(uuid) from public, anon;
grant  execute on function public.hr_owner_delete_employee(uuid) to authenticated;

-- تعديل إداري على حضور — السبب إلزامي + audit + إشعار الموظف.
create or replace function public.hr_admin_adjust_attendance(
  p_record uuid, p_check_in timestamptz, p_check_out timestamptz,
  p_status text, p_reason text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  if p_status is not null and p_status not in ('present','late','absent','half_day','manual_adjusted')
    then raise exception 'invalid_status'; end if;
  select * into r from public.hr_attendance_records where id = p_record;
  if not found then raise exception 'record not found'; end if;

  update public.hr_attendance_records set
    check_in_at = coalesce(p_check_in, check_in_at),
    check_out_at = coalesce(p_check_out, check_out_at),
    status = coalesce(p_status, 'manual_adjusted'),
    admin_adjusted_by = auth.uid(),
    admin_adjustment_reason = trim(p_reason),
    updated_at = now()
  where id = p_record;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (r.employee_id, r.user_id, 'attendance_adjusted',
          'تعديل إداري على حضور ' || r.work_date, trim(p_reason), auth.uid());
  perform public.hr_notify(r.user_id, 'hr_attendance_adjusted', p_record,
    'عُدّل سجل حضورك ليوم ' || r.work_date || ' — السبب: ' || trim(p_reason),
    'Your attendance for ' || r.work_date || ' was adjusted — reason: ' || trim(p_reason));
  return true;
end; $$;
revoke execute on function public.hr_admin_adjust_attendance(uuid,timestamptz,timestamptz,text,text) from public, anon;
grant  execute on function public.hr_admin_adjust_attendance(uuid,timestamptz,timestamptz,text,text) to authenticated;

-- قرار الإجازة.
create or replace function public.hr_admin_decide_leave(
  p_id uuid, p_approve boolean, p_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; v_status text;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select * into r from public.hr_leave_requests where id = p_id and status = 'pending';
  if not found then raise exception 'request not pending'; end if;
  v_status := case when p_approve then 'approved' else 'rejected' end;
  if not p_approve and coalesce(nullif(trim(p_note),''), null) is null
    then raise exception 'rejection_reason_required'; end if;

  update public.hr_leave_requests set
    status = v_status, decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note,'')),''), updated_at = now()
  where id = p_id;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (r.employee_id, r.user_id, 'leave_decided',
          case when p_approve then 'اعتماد إجازة (' || r.leave_type || ')' else 'رفض إجازة (' || r.leave_type || ')' end,
          nullif(trim(coalesce(p_note,'')),''), auth.uid());
  perform public.hr_notify(r.user_id, 'hr_leave_decided', p_id,
    case when p_approve
      then 'تم اعتماد طلبك (' || r.leave_type || ') من ' || r.start_date
      else 'نعتذر — رُفض طلبك (' || r.leave_type || ')' || coalesce(': ' || nullif(trim(p_note),''), '') end,
    case when p_approve
      then 'Your ' || r.leave_type || ' request from ' || r.start_date || ' was approved'
      else 'Your ' || r.leave_type || ' request was rejected' || coalesce(': ' || nullif(trim(p_note),''), '') end);
  return true;
end; $$;
revoke execute on function public.hr_admin_decide_leave(uuid,boolean,text) from public, anon;
grant  execute on function public.hr_admin_decide_leave(uuid,boolean,text) to authenticated;

-- إنشاء مهمة ميدانية + إسناد (بموظف واحد أو أكثر).
create or replace function public.hr_admin_create_field_task(
  p_title text, p_description text, p_location text,
  p_expected_start timestamptz, p_expected_end timestamptz, p_assignees uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_task uuid; v_emp uuid; u uuid; v_count int := 0;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_title),''), null) is null then raise exception 'title_required'; end if;
  if p_assignees is null or array_length(p_assignees, 1) is null then raise exception 'assignees_required'; end if;
  if p_expected_end is not null and p_expected_start is not null and p_expected_end < p_expected_start
    then raise exception 'invalid_time_range'; end if;

  insert into public.hr_field_tasks (title, description, location_name, expected_start_at, expected_end_at, status, created_by)
  values (trim(p_title), nullif(trim(coalesce(p_description,'')),''), nullif(trim(coalesce(p_location,'')),''),
          p_expected_start, p_expected_end, 'assigned', auth.uid())
  returning id into v_task;

  foreach u in array p_assignees loop
    -- الموظف فقط (staff/أدمن نشط) يمكن إسناده — يمنع إنشاء ملفات موظفين لعملاء.
    if not exists (select 1 from public.profiles
                    where id = u and account_status = 'active'
                      and (staff_role is not null or account_type = 'admin'))
      then raise exception 'assignee_not_staff'; end if;
    v_emp := public.hr_ensure_employee_for(u);
    insert into public.hr_field_task_assignees (task_id, employee_id, user_id)
    values (v_task, v_emp, u)
    on conflict (task_id, user_id) do nothing;
    if not found then continue; end if;   -- uuid مكرر في المصفوفة → لا إشعار/عدّ مزدوج
    perform public.hr_notify(u, 'hr_task_new', v_task,
      'مهمة ميدانية جديدة: ' || trim(p_title) || coalesce(' — ' || nullif(trim(p_location),''), ''),
      'New field task: ' || trim(p_title) || coalesce(' — ' || nullif(trim(p_location),''), ''));
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
    values (v_emp, u, 'task_assigned', 'إسناد مهمة: ' || trim(p_title), auth.uid());
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'assignees_required'; end if;

  return jsonb_build_object('ok', true, 'id', v_task, 'assignees', v_count);
end; $$;
revoke execute on function public.hr_admin_create_field_task(text,text,text,timestamptz,timestamptz,uuid[]) from public, anon;
grant  execute on function public.hr_admin_create_field_task(text,text,text,timestamptz,timestamptz,uuid[]) to authenticated;

-- إغلاق/إلغاء مهمة (اعتماد الأدمن).
create or replace function public.hr_admin_close_task(
  p_task uuid, p_action text, p_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare t record; a record; v_final text;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_action not in ('complete','cancel') then raise exception 'invalid_action'; end if;
  select * into t from public.hr_field_tasks where id = p_task and not is_deleted
    and status in ('assigned','in_progress','submitted');
  if not found then raise exception 'task not closable'; end if;
  v_final := case when p_action = 'complete' then 'completed' else 'cancelled' end;

  update public.hr_field_tasks set
    status = v_final, approved_by = auth.uid(), approved_at = now(), updated_at = now()
  where id = p_task;
  update public.hr_field_task_assignees set
    status = v_final, admin_note = coalesce(nullif(trim(coalesce(p_note,'')),''), admin_note), updated_at = now()
  where task_id = p_task and status <> 'cancelled';

  for a in select user_id, employee_id from public.hr_field_task_assignees where task_id = p_task loop
    perform public.hr_notify(a.user_id, 'hr_task_closed', p_task,
      case when p_action = 'complete' then 'اعتمدت الإدارة إغلاق مهمة: ' || t.title
           else 'أُلغيت مهمة: ' || t.title end,
      case when p_action = 'complete' then 'Task closed & approved: ' || t.title
           else 'Task cancelled: ' || t.title end);
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
    values (a.employee_id, a.user_id, 'task_closed',
            case when p_action = 'complete' then 'إغلاق مهمة: ' else 'إلغاء مهمة: ' end || t.title, auth.uid());
  end loop;
  return true;
end; $$;
revoke execute on function public.hr_admin_close_task(uuid,text,text) from public, anon;
grant  execute on function public.hr_admin_close_task(uuid,text,text) to authenticated;

-- ملاحظة/حدث HR على موظف (مع خيار إظهاره له + إشعاره).
create or replace function public.hr_admin_add_employee_event(
  p_employee uuid, p_title text, p_description text default null, p_visible boolean default false
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_title),''), null) is null then raise exception 'title_required'; end if;
  select * into r from public.hr_employee_profiles where id = p_employee and is_deleted = false;
  if not found then raise exception 'employee not found'; end if;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, visible_to_employee, created_by)
  values (p_employee, r.user_id, 'hr_note', trim(p_title), nullif(trim(coalesce(p_description,'')),''), coalesce(p_visible,false), auth.uid());
  if coalesce(p_visible, false) and r.user_id is not null then
    perform public.hr_notify(r.user_id, 'hr_note_new', p_employee,
      'ملاحظة جديدة من الموارد البشرية: ' || trim(p_title),
      'New HR note: ' || trim(p_title));
  end if;
  return true;
end; $$;
revoke execute on function public.hr_admin_add_employee_event(uuid,text,text,boolean) from public, anon;
grant  execute on function public.hr_admin_add_employee_event(uuid,text,text,boolean) to authenticated;

commit;

-- ════════ 9) Storage — private hr-files bucket (task photos) ═════════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-files','hr-files', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "hr files read" on storage.objects;
create policy "hr files read" on storage.objects for select to authenticated
using (
  bucket_id = 'hr-files'
  and (public.can_manage_hr() or (storage.foldername(name))[1] = auth.uid()::text)
);
drop policy if exists "hr files upload" on storage.objects;
create policy "hr files upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'hr-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);
-- لا سياسات update/delete → الملفات غير قابلة للتغيير (أدلة).

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) الجداول السبعة:
select to_regclass('public.hr_employee_profiles')    as employees,
       to_regclass('public.hr_attendance_records')   as attendance,
       to_regclass('public.hr_leave_requests')       as leaves,
       to_regclass('public.hr_field_tasks')          as tasks,
       to_regclass('public.hr_field_task_assignees') as assignees,
       to_regclass('public.hr_employee_events')      as events,
       to_regclass('public.hr_attachments')          as attachments;
-- 2) كل الدوال:
select proname from pg_proc where proname in
 ('can_manage_hr','hr_my_profile','hr_admin_list_staff','hr_admin_upsert_employee',
  'hr_owner_delete_employee','hr_check_in','hr_check_out','hr_admin_adjust_attendance',
  'hr_submit_leave_request','hr_cancel_my_leave_request','hr_admin_decide_leave',
  'hr_admin_create_field_task','hr_start_my_task','hr_complete_my_task',
  'hr_admin_close_task','hr_admin_add_employee_event','hr_notify','hr_notify_admins',
  'hr_ensure_employee_for','hr_today','hr_client_ip') order by 1;
-- 3) قيد الإشعارات = 40 نوعًا (يشمل hr_*):
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid='public.notifications'::regclass and conname='notifications_type_check';
-- 4) RLS مفعّل على السبعة + سياساتها:
select tablename, rowsecurity from pg_tables where tablename like 'hr_%' order by 1;
select tablename, policyname from pg_policies where tablename like 'hr_%' order by 1;
-- 5) الـ bucket:
select id, public, file_size_limit from storage.buckets where id = 'hr-files';
-- ════════════════════════════════════════════════════════════════════════════
