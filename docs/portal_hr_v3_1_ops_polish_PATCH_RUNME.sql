-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HR v3.1 OPS POLISH PATCH
-- شغّله مرة واحدة في Supabase SQL Editor بعد v1 + v2 + v3 (idempotent — آمن للإعادة).
--
-- يتضمن:
--   1) طلبات تعديل الحضور من الموظف (correction requests) + قرار الإدارة.
--   2) تقويم HR: أيام العطلة الأسبوعية + العطل الرسمية/أيام العمل الخاصة، ودمجه
--      في احتساب أيام العمل بالتقارير.
--   3) تقرير خصومات/رواتب شهري (أرقام تشغيلية فقط — لا خصم مالي فعلي) + مفاتيح
--      إعداد للخصومات (معطّلة افتراضيًا).
--   4) وثائق الموظف + تنبيهات قرب الانتهاء (30/60/90 يومًا).
--   5) مشرف ميداني: روابط إشراف (mapping) دون تعديل قيد الأدوار — يرى فريقه فقط.
--   6) سجل عمليات موحّد (audit log) عبر hr_employee_events.
--   7) تنبيه الجلسات المفتوحة الطويلة (إعداد open_session_alert_hours).
--   8) تحديث التقرير الشهري ليعتمد تقويم HR.
--
-- لا يغيّر قيد أنواع الإشعارات (يعيد استخدام أنواع hr_* القائمة). لا يمس العهدة/
-- التأجير/الفوترة/Zoho/Apps Script/واتساب/n8n/مركز الفرص. كل الدوال SECURITY
-- DEFINER + set search_path = public + revoke/grant. كل جدول جديد: RLS + grant
-- select to authenticated (لا default privileges في هذا المشروع — درس whatsapp/v3).
-- لا hard delete: كل حذف soft + سبب إلزامي + حدث Timeline + إشعار.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 0) توسيع hr_settings (خصومات + تنبيه الجلسات) ═══════════════════════
alter table public.hr_settings add column if not exists late_deduction_enabled       boolean not null default false;
alter table public.hr_settings add column if not exists absence_deduction_enabled     boolean not null default false;
alter table public.hr_settings add column if not exists early_exit_deduction_enabled  boolean not null default false;
alter table public.hr_settings add column if not exists deduction_notes               text;
alter table public.hr_settings add column if not exists open_session_alert_hours      integer not null default 10;
alter table public.hr_settings drop constraint if exists hr_settings_open_alert_check;
alter table public.hr_settings add constraint hr_settings_open_alert_check
  check (open_session_alert_hours between 1 and 48);

-- قراءة الإعدادات (كل المفاتيح، بما فيها الجديدة) — للموظف والأدمن معًا.
create or replace function public.hr_get_settings() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into r from public.hr_settings where id = 1;
  return jsonb_build_object(
    'employee_leave_requests_enabled',       coalesce(r.employee_leave_requests_enabled, false),
    'multiple_attendance_sessions_enabled',  coalesce(r.multiple_attendance_sessions_enabled, true),
    'task_completion_photo_required',        coalesce(r.task_completion_photo_required, true),
    'late_grace_minutes',                    coalesce(r.late_grace_minutes, 15),
    'default_work_start_time',               r.default_work_start_time,
    'default_work_end_time',                 r.default_work_end_time,
    'show_performance_reviews_enabled',      coalesce(r.show_performance_reviews_enabled, false),
    'device_attendance_enabled',             coalesce(r.device_attendance_enabled, false),
    'manual_device_import_enabled',          coalesce(r.manual_device_import_enabled, true),
    'late_deduction_enabled',                coalesce(r.late_deduction_enabled, false),
    'absence_deduction_enabled',             coalesce(r.absence_deduction_enabled, false),
    'early_exit_deduction_enabled',          coalesce(r.early_exit_deduction_enabled, false),
    'deduction_notes',                       r.deduction_notes,
    'open_session_alert_hours',              coalesce(r.open_session_alert_hours, 10));
end; $$;
revoke execute on function public.hr_get_settings() from public, anon;
grant  execute on function public.hr_get_settings() to authenticated;

-- تحديث الإعدادات (patch جزئي عبر jsonb) — يضيف المفاتيح الجديدة للقائمة البيضاء.
create or replace function public.hr_admin_update_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v_changed text[] := '{}';
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    then raise exception 'patch_required'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('employee_leave_requests_enabled','multiple_attendance_sessions_enabled',
                 'task_completion_photo_required','late_grace_minutes',
                 'default_work_start_time','default_work_end_time',
                 'show_performance_reviews_enabled','device_attendance_enabled',
                 'manual_device_import_enabled','late_deduction_enabled',
                 'absence_deduction_enabled','early_exit_deduction_enabled',
                 'deduction_notes','open_session_alert_hours')
      then raise exception 'invalid_setting_key: %', k; end if;
    v_changed := v_changed || k;
  end loop;

  update public.hr_settings set
    employee_leave_requests_enabled = case when p_patch ? 'employee_leave_requests_enabled'
      then coalesce((p_patch->>'employee_leave_requests_enabled')::boolean, employee_leave_requests_enabled) else employee_leave_requests_enabled end,
    multiple_attendance_sessions_enabled = case when p_patch ? 'multiple_attendance_sessions_enabled'
      then coalesce((p_patch->>'multiple_attendance_sessions_enabled')::boolean, multiple_attendance_sessions_enabled) else multiple_attendance_sessions_enabled end,
    task_completion_photo_required = case when p_patch ? 'task_completion_photo_required'
      then coalesce((p_patch->>'task_completion_photo_required')::boolean, task_completion_photo_required) else task_completion_photo_required end,
    late_grace_minutes = case when p_patch ? 'late_grace_minutes'
      then coalesce((p_patch->>'late_grace_minutes')::int, late_grace_minutes) else late_grace_minutes end,
    default_work_start_time = case when p_patch ? 'default_work_start_time'
      then nullif(p_patch->>'default_work_start_time','')::time else default_work_start_time end,
    default_work_end_time = case when p_patch ? 'default_work_end_time'
      then nullif(p_patch->>'default_work_end_time','')::time else default_work_end_time end,
    show_performance_reviews_enabled = case when p_patch ? 'show_performance_reviews_enabled'
      then coalesce((p_patch->>'show_performance_reviews_enabled')::boolean, show_performance_reviews_enabled) else show_performance_reviews_enabled end,
    device_attendance_enabled = case when p_patch ? 'device_attendance_enabled'
      then coalesce((p_patch->>'device_attendance_enabled')::boolean, device_attendance_enabled) else device_attendance_enabled end,
    manual_device_import_enabled = case when p_patch ? 'manual_device_import_enabled'
      then coalesce((p_patch->>'manual_device_import_enabled')::boolean, manual_device_import_enabled) else manual_device_import_enabled end,
    late_deduction_enabled = case when p_patch ? 'late_deduction_enabled'
      then coalesce((p_patch->>'late_deduction_enabled')::boolean, late_deduction_enabled) else late_deduction_enabled end,
    absence_deduction_enabled = case when p_patch ? 'absence_deduction_enabled'
      then coalesce((p_patch->>'absence_deduction_enabled')::boolean, absence_deduction_enabled) else absence_deduction_enabled end,
    early_exit_deduction_enabled = case when p_patch ? 'early_exit_deduction_enabled'
      then coalesce((p_patch->>'early_exit_deduction_enabled')::boolean, early_exit_deduction_enabled) else early_exit_deduction_enabled end,
    deduction_notes = case when p_patch ? 'deduction_notes'
      then nullif(trim(p_patch->>'deduction_notes'),'') else deduction_notes end,
    open_session_alert_hours = case when p_patch ? 'open_session_alert_hours'
      then greatest(1, least(48, coalesce((p_patch->>'open_session_alert_hours')::int, open_session_alert_hours))) else open_session_alert_hours end,
    updated_by = auth.uid(), updated_at = now()
  where id = 1;

  perform public.hr_notify_admins('hr_note_new', null,
    'تحديث إعدادات الموارد البشرية: ' || array_to_string(v_changed, '، '),
    'HR settings updated: ' || array_to_string(v_changed, ', '));
  return public.hr_get_settings();
end; $$;
revoke execute on function public.hr_admin_update_settings(jsonb) from public, anon;
grant  execute on function public.hr_admin_update_settings(jsonb) to authenticated;

-- ════════ 1) طلبات تعديل الحضور ══════════════════════════════════════════════
create table if not exists public.hr_attendance_correction_requests (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  request_type   text not null check (request_type in
                 ('missed_check_in','missed_check_out','wrong_time','field_task','other')),
  correction_date date not null,
  proposed_time  time,
  employee_note  text,
  task_id        uuid references public.hr_field_tasks(id) on delete set null,
  attachment_url text,
  status         text not null default 'pending'
                 check (status in ('pending','approved','rejected','cancelled')),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  decision_note  text,
  attendance_record_id uuid references public.hr_attendance_records(id),
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_hr_corr_user on public.hr_attendance_correction_requests(user_id, created_at desc);
create index if not exists idx_hr_corr_status on public.hr_attendance_correction_requests(status) where is_deleted = false;
drop trigger if exists t_hr_corr_touch on public.hr_attendance_correction_requests;
create trigger t_hr_corr_touch before update on public.hr_attendance_correction_requests
  for each row execute function public.touch_updated_at();
alter table public.hr_attendance_correction_requests enable row level security;
drop policy if exists hr_corr_select on public.hr_attendance_correction_requests;
create policy hr_corr_select on public.hr_attendance_correction_requests for select
  using (public.can_manage_hr() or user_id = auth.uid());
grant select on public.hr_attendance_correction_requests to authenticated;

-- الموظف يقدّم طلبًا.
create or replace function public.hr_submit_attendance_correction_request(
  p_type text, p_date date, p_proposed_time time, p_note text,
  p_task uuid default null, p_attachment text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_type not in ('missed_check_in','missed_check_out','wrong_time','field_task','other')
    then raise exception 'invalid_request_type'; end if;
  if p_date is null then raise exception 'date_required'; end if;
  if p_date > public.hr_today() then raise exception 'date_in_future'; end if;
  if p_type in ('missed_check_in','missed_check_out','wrong_time') and p_proposed_time is null
    then raise exception 'proposed_time_required'; end if;
  if coalesce(nullif(trim(p_note),''), null) is null then raise exception 'note_required'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  if exists (select 1 from public.hr_employee_profiles where id = v_emp and employment_status <> 'active')
    then raise exception 'employee_not_active'; end if;

  insert into public.hr_attendance_correction_requests
    (employee_id, user_id, request_type, correction_date, proposed_time, employee_note, task_id, attachment_url)
  values (v_emp, auth.uid(), p_type, p_date, p_proposed_time, trim(p_note), p_task, nullif(trim(coalesce(p_attachment,'')),''))
  returning id into v_id;

  select full_name into v_name from public.hr_employee_profiles where id = v_emp;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (v_emp, auth.uid(), 'correction_requested',
          'طلب تعديل حضور (' || p_type || ') بتاريخ ' || p_date, nullif(trim(p_note),''), auth.uid());
  perform public.hr_notify_admins('hr_note_new', v_id,
    'طلب تعديل حضور جديد من ' || v_name || ' (' || p_type || ') — بانتظار القرار',
    'New attendance-correction request from ' || v_name || ' — awaiting decision');
  perform public.hr_notify(auth.uid(), 'hr_note_new', v_id,
    'استلمنا طلب تعديل الحضور (' || p_type || ') — سيُراجع من الإدارة',
    'Your attendance-correction request was received');
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_submit_attendance_correction_request(text,date,time,text,uuid,text) from public, anon;
grant  execute on function public.hr_submit_attendance_correction_request(text,date,time,text,uuid,text) to authenticated;

-- الموظف يلغي طلبه المعلّق.
create or replace function public.hr_cancel_my_attendance_correction_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.hr_attendance_correction_requests set status = 'cancelled', updated_at = now()
   where id = p_id and user_id = auth.uid() and status = 'pending' and is_deleted = false;
  if not found then raise exception 'not_cancellable'; end if;
  return true;
end; $$;
revoke execute on function public.hr_cancel_my_attendance_correction_request(uuid) from public, anon;
grant  execute on function public.hr_cancel_my_attendance_correction_request(uuid) to authenticated;

-- قرار الإدارة: قبول ⇒ ينشئ/يعدّل سجل حضور حسب النوع؛ رفض ⇒ سبب إلزامي.
create or replace function public.hr_admin_decide_attendance_correction_request(
  p_id uuid, p_approve boolean, p_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; v_ts timestamptz; v_rec uuid; v_name text;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select * into r from public.hr_attendance_correction_requests
   where id = p_id and status = 'pending' and is_deleted = false;
  if not found then raise exception 'request_not_pending'; end if;
  if not p_approve and coalesce(nullif(trim(p_note),''), null) is null
    then raise exception 'rejection_reason_required'; end if;

  if p_approve then
    -- الوقت المقترح يُفسَّر بتوقيت الرياض المحلي.
    if r.proposed_time is not null then
      v_ts := (r.correction_date + r.proposed_time) at time zone 'Asia/Riyadh';
    end if;

    if v_ts is not null and r.request_type = 'missed_check_out' then
      select id into v_rec from public.hr_attendance_records
       where employee_id = r.employee_id and work_date = r.correction_date
         and check_in_at is not null and check_out_at is null and is_voided = false
       order by check_in_at desc limit 1;
      if v_rec is not null then
        update public.hr_attendance_records set
          check_out_at = v_ts, status = 'manual_adjusted', source = 'admin',
          admin_adjusted_by = auth.uid(),
          admin_adjustment_reason = 'اعتماد طلب تعديل حضور', updated_at = now()
        where id = v_rec;
      else
        insert into public.hr_attendance_records
          (employee_id, user_id, work_date, check_out_at, status, source, admin_adjusted_by, admin_adjustment_reason)
        values (r.employee_id, r.user_id, r.correction_date, v_ts, 'manual_adjusted', 'admin', auth.uid(), 'اعتماد طلب تعديل حضور')
        returning id into v_rec;
      end if;
    elsif v_ts is not null then
      -- missed_check_in / wrong_time / field_task / other مع وقت مقترح.
      select id into v_rec from public.hr_attendance_records
       where employee_id = r.employee_id and work_date = r.correction_date and is_voided = false
       order by (check_in_at is not null), check_in_at desc limit 1;
      if v_rec is not null and r.request_type = 'wrong_time' then
        update public.hr_attendance_records set
          check_in_at = v_ts, status = 'manual_adjusted', source = 'admin',
          admin_adjusted_by = auth.uid(), admin_adjustment_reason = 'اعتماد طلب تعديل حضور', updated_at = now()
        where id = v_rec;
      elsif v_rec is not null and (select check_in_at from public.hr_attendance_records where id = v_rec) is null then
        update public.hr_attendance_records set
          check_in_at = v_ts, status = 'manual_adjusted', source = 'admin',
          admin_adjusted_by = auth.uid(), admin_adjustment_reason = 'اعتماد طلب تعديل حضور', updated_at = now()
        where id = v_rec;
      else
        insert into public.hr_attendance_records
          (employee_id, user_id, work_date, check_in_at, status, source, admin_adjusted_by, admin_adjustment_reason)
        values (r.employee_id, r.user_id, r.correction_date, v_ts, 'manual_adjusted', 'admin', auth.uid(), 'اعتماد طلب تعديل حضور')
        returning id into v_rec;
      end if;
    end if;
  end if;

  update public.hr_attendance_correction_requests set
    status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = auth.uid(), decided_at = now(),
    decision_note = nullif(trim(coalesce(p_note,'')),''),
    attendance_record_id = v_rec, updated_at = now()
  where id = p_id;

  select full_name into v_name from public.hr_employee_profiles where id = r.employee_id;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (r.employee_id, r.user_id, 'correction_decided',
          case when p_approve then 'اعتماد طلب تعديل حضور (' || r.request_type || ')'
               else 'رفض طلب تعديل حضور (' || r.request_type || ')' end,
          nullif(trim(coalesce(p_note,'')),''), auth.uid());
  perform public.hr_notify(r.user_id, 'hr_note_new', p_id,
    case when p_approve then 'تم اعتماد طلب تعديل الحضور (' || r.request_type || ') وتحديث سجلك'
         else 'نعتذر — رُفض طلب تعديل الحضور' || coalesce(': ' || nullif(trim(p_note),''), '') end,
    case when p_approve then 'Your attendance-correction request was approved'
         else 'Your attendance-correction request was rejected' end);
  return true;
end; $$;
revoke execute on function public.hr_admin_decide_attendance_correction_request(uuid,boolean,text) from public, anon;
grant  execute on function public.hr_admin_decide_attendance_correction_request(uuid,boolean,text) to authenticated;

-- ════════ 2) تقويم HR: أيام العطلة الأسبوعية + العطل ══════════════════════════
create table if not exists public.hr_work_calendar_settings (
  id               int primary key default 1 check (id = 1),
  weekend_days     int[] not null default '{5,6}',   -- 0=أحد … 5=جمعة، 6=سبت
  default_timezone text not null default 'Asia/Riyadh',
  updated_by       uuid references auth.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
insert into public.hr_work_calendar_settings (id) values (1) on conflict (id) do nothing;
alter table public.hr_work_calendar_settings enable row level security;
drop policy if exists hr_calendar_settings_select on public.hr_work_calendar_settings;
create policy hr_calendar_settings_select on public.hr_work_calendar_settings for select
  using (public.is_staff());
grant select on public.hr_work_calendar_settings to authenticated;

create table if not exists public.hr_holidays (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  holiday_date date not null,
  type         text not null default 'public_holiday'
               check (type in ('public_holiday','company_holiday','special_workday','closed_day')),
  description  text,
  created_by   uuid references auth.users(id),
  deleted_by   uuid references auth.users(id),
  delete_reason text,
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_hr_holidays_date on public.hr_holidays(holiday_date) where is_deleted = false;
drop trigger if exists t_hr_holidays_touch on public.hr_holidays;
create trigger t_hr_holidays_touch before update on public.hr_holidays
  for each row execute function public.touch_updated_at();
alter table public.hr_holidays enable row level security;
drop policy if exists hr_holidays_select on public.hr_holidays;
create policy hr_holidays_select on public.hr_holidays for select using (public.can_manage_hr());
grant select on public.hr_holidays to authenticated;

-- هل اليوم يوم عمل؟ (special_workday يتغلّب على العطلة الأسبوعية؛ العطل الأخرى تُلغي العمل)
create or replace function public.hr_is_workday(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.hr_holidays
                  where holiday_date = d and is_deleted = false and type = 'special_workday') then true
    when exists (select 1 from public.hr_holidays
                  where holiday_date = d and is_deleted = false
                    and type in ('public_holiday','company_holiday','closed_day')) then false
    when extract(dow from d)::int = any (
      coalesce((select weekend_days from public.hr_work_calendar_settings where id = 1), '{5,6}')) then false
    else true end;
$$;
revoke execute on function public.hr_is_workday(date) from public, anon;
grant  execute on function public.hr_is_workday(date) to authenticated;

create or replace function public.hr_get_calendar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into c from public.hr_work_calendar_settings where id = 1;
  return jsonb_build_object('weekend_days', coalesce(c.weekend_days, '{5,6}'),
                            'default_timezone', coalesce(c.default_timezone, 'Asia/Riyadh'));
end; $$;
revoke execute on function public.hr_get_calendar() from public, anon;
grant  execute on function public.hr_get_calendar() to authenticated;

create or replace function public.hr_admin_set_weekend_days(p_days int[]) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_days is null then raise exception 'days_required'; end if;
  if exists (select 1 from unnest(p_days) x where x < 0 or x > 6) then raise exception 'invalid_day'; end if;
  update public.hr_work_calendar_settings set weekend_days = p_days, updated_by = auth.uid(), updated_at = now() where id = 1;
  perform public.hr_notify_admins('hr_note_new', null,
    'تحديث أيام العطلة الأسبوعية في تقويم الموارد البشرية', 'HR weekend days updated');
  return public.hr_get_calendar();
end; $$;
revoke execute on function public.hr_admin_set_weekend_days(int[]) from public, anon;
grant  execute on function public.hr_admin_set_weekend_days(int[]) to authenticated;

create or replace function public.hr_admin_upsert_holiday(
  p_id uuid, p_title text, p_date date, p_type text, p_description text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_title),''), null) is null then raise exception 'title_required'; end if;
  if p_date is null then raise exception 'date_required'; end if;
  if p_type is not null and p_type not in ('public_holiday','company_holiday','special_workday','closed_day')
    then raise exception 'invalid_holiday_type'; end if;
  if p_id is not null then
    update public.hr_holidays set
      title = trim(p_title), holiday_date = p_date,
      type = coalesce(nullif(trim(p_type),''), type),
      description = nullif(trim(coalesce(p_description,'')),''), updated_at = now()
    where id = p_id and is_deleted = false
    returning id into v_id;
    if v_id is null then raise exception 'holiday_not_found'; end if;
  else
    insert into public.hr_holidays (title, holiday_date, type, description, created_by)
    values (trim(p_title), p_date, coalesce(nullif(trim(p_type),''),'public_holiday'),
            nullif(trim(coalesce(p_description,'')),''), auth.uid())
    returning id into v_id;
  end if;
  perform public.hr_notify_admins('hr_note_new', v_id,
    'تحديث تقويم الموارد البشرية: ' || trim(p_title) || ' (' || p_date || ')',
    'HR calendar updated: ' || trim(p_title));
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_admin_upsert_holiday(uuid,text,date,text,text) from public, anon;
grant  execute on function public.hr_admin_upsert_holiday(uuid,text,date,text,text) to authenticated;

create or replace function public.hr_admin_soft_delete_holiday(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare h record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  select * into h from public.hr_holidays where id = p_id and is_deleted = false;
  if not found then raise exception 'holiday_not_found'; end if;
  update public.hr_holidays set is_deleted = true, deleted_by = auth.uid(),
    delete_reason = trim(p_reason), updated_at = now() where id = p_id;
  perform public.hr_notify_admins('hr_note_new', p_id,
    'حذف عطلة من التقويم: ' || h.title || ' — السبب: ' || trim(p_reason),
    'HR holiday removed: ' || h.title);
  return true;
end; $$;
revoke execute on function public.hr_admin_soft_delete_holiday(uuid,text) from public, anon;
grant  execute on function public.hr_admin_soft_delete_holiday(uuid,text) to authenticated;

-- ════════ 3) تقرير خصومات/رواتب شهري (أرقام تشغيلية فقط) ═════════════════════
create or replace function public.hr_admin_payroll_report(p_year int, p_month int, p_user uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_today date; v_elapsed_end date; d date;
  v_grace int; v_work_start time; v_work_end time; v_workdays int;
  e record; rows jsonb := '[]'::jsonb;
  v_present int; v_sessions int; v_hours numeric;
  v_late int; v_late_min int; v_early int; v_early_min int;
  v_leave_days int; v_absent int; v_tasks int; v_corr int;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_year is null or p_year not between 2020 and 2100 then raise exception 'invalid_year'; end if;
  if p_month is null or p_month not between 1 and 12 then raise exception 'invalid_month'; end if;
  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month')::date;
  v_today := public.hr_today();
  v_elapsed_end := least(v_end, v_today + 1);
  v_grace := coalesce((select late_grace_minutes from public.hr_settings where id = 1), 15);
  v_work_start := (select default_work_start_time from public.hr_settings where id = 1);
  v_work_end := (select default_work_end_time from public.hr_settings where id = 1);
  v_workdays := 0;
  for d in select generate_series(v_start, v_elapsed_end - 1, interval '1 day')::date loop
    if public.hr_is_workday(d) then v_workdays := v_workdays + 1; end if;
  end loop;

  for e in select * from public.hr_employee_profiles
            where is_deleted = false and (p_user is null or user_id = p_user)
            order by full_name loop
    select count(distinct work_date) filter (where public.hr_is_workday(work_date)),
           count(*),
           round(coalesce(sum(extract(epoch from (check_out_at - check_in_at)) / 3600.0)
                          filter (where check_out_at is not null), 0)::numeric, 1)
      into v_present, v_sessions, v_hours
      from public.hr_attendance_records
     where employee_id = e.id and is_voided = false and check_in_at is not null
       and work_date >= v_start and work_date < v_end;

    v_late := 0; v_late_min := 0; v_early := 0; v_early_min := 0;
    if v_work_start is not null then
      select coalesce(count(*),0),
             coalesce(sum(greatest(0, extract(epoch from
               ((first_in at time zone 'Asia/Riyadh')::time - v_work_start)) / 60.0))::int, 0)
        into v_late, v_late_min
      from (select work_date, min(check_in_at) as first_in
              from public.hr_attendance_records
             where employee_id = e.id and is_voided = false and check_in_at is not null
               and work_date >= v_start and work_date < v_end
             group by work_date) d1
       where (first_in at time zone 'Asia/Riyadh')::time > v_work_start + make_interval(mins => v_grace);
    end if;
    if v_work_end is not null then
      select coalesce(count(*),0),
             coalesce(sum(greatest(0, extract(epoch from
               (v_work_end - (last_out at time zone 'Asia/Riyadh')::time)) / 60.0))::int, 0)
        into v_early, v_early_min
      from (select work_date, max(check_out_at) as last_out
              from public.hr_attendance_records
             where employee_id = e.id and is_voided = false and check_out_at is not null
               and work_date >= v_start and work_date < v_end
             group by work_date) d2
       where (last_out at time zone 'Asia/Riyadh')::time < v_work_end - make_interval(mins => v_grace);
    end if;

    select coalesce(sum(case when leave_type in ('annual','sick','emergency','unpaid')
             then (select count(*)
                     from generate_series(greatest(start_date, v_start),
                                          least(coalesce(end_date, start_date), v_elapsed_end - 1),
                                          interval '1 day') g
                    where public.hr_is_workday(g::date))
             else 0 end), 0)
      into v_leave_days
      from public.hr_leave_requests
     where employee_id = e.id and is_deleted = false and status = 'approved'
       and start_date < v_end and coalesce(end_date, start_date) >= v_start;

    v_absent := greatest(0, v_workdays - v_present - v_leave_days);

    select count(*) into v_corr from public.hr_attendance_correction_requests
     where employee_id = e.id and is_deleted = false and status = 'approved'
       and correction_date >= v_start and correction_date < v_end;

    select count(*) into v_tasks from public.hr_field_task_assignees
     where employee_id = e.id and status in ('submitted','completed') and ended_at is not null
       and (ended_at at time zone 'Asia/Riyadh')::date >= v_start
       and (ended_at at time zone 'Asia/Riyadh')::date < v_end;

    rows := rows || jsonb_build_object(
      'employee_id', e.id, 'user_id', e.user_id, 'full_name', e.full_name,
      'employment_status', e.employment_status,
      'expected_workdays', v_workdays, 'present_days', v_present, 'absent_days', v_absent,
      'late_count', v_late, 'late_minutes', v_late_min,
      'early_exit_count', v_early, 'early_exit_minutes', v_early_min,
      'total_hours', v_hours, 'approved_leave_days', v_leave_days,
      'approved_corrections', v_corr, 'tasks_done', v_tasks);
  end loop;

  return jsonb_build_object('year', p_year, 'month', p_month, 'workdays_expected', v_workdays,
    'generated_at', now(),
    'deduction_flags', jsonb_build_object(
      'late', coalesce((select late_deduction_enabled from public.hr_settings where id = 1), false),
      'absence', coalesce((select absence_deduction_enabled from public.hr_settings where id = 1), false),
      'early_exit', coalesce((select early_exit_deduction_enabled from public.hr_settings where id = 1), false),
      'notes', (select deduction_notes from public.hr_settings where id = 1)),
    'rows', rows);
end; $$;
revoke execute on function public.hr_admin_payroll_report(int,int,uuid) from public, anon;
grant  execute on function public.hr_admin_payroll_report(int,int,uuid) to authenticated;

-- ════════ 4) وثائق الموظف ═════════════════════════════════════════════════════
create table if not exists public.hr_employee_documents (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id         uuid references auth.users(id),
  document_type   text not null default 'other'
                  check (document_type in ('national_id','iqama','contract','driving_license','iban','certificate','medical_insurance','other')),
  title           text not null,
  document_number text,
  issue_date      date,
  expiry_date     date,
  file_url        text,
  visibility      text not null default 'admin_only' check (visibility in ('admin_only','employee_visible')),
  notes           text,
  created_by      uuid references auth.users(id),
  deleted_by      uuid references auth.users(id),
  delete_reason   text,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_hr_docs_emp on public.hr_employee_documents(employee_id) where is_deleted = false;
create index if not exists idx_hr_docs_expiry on public.hr_employee_documents(expiry_date) where is_deleted = false;
drop trigger if exists t_hr_docs_touch on public.hr_employee_documents;
create trigger t_hr_docs_touch before update on public.hr_employee_documents
  for each row execute function public.touch_updated_at();
alter table public.hr_employee_documents enable row level security;
drop policy if exists hr_docs_select on public.hr_employee_documents;
create policy hr_docs_select on public.hr_employee_documents for select
  using (public.can_manage_hr()
         or (user_id = auth.uid() and visibility = 'employee_visible' and is_deleted = false));
grant select on public.hr_employee_documents to authenticated;

create or replace function public.hr_admin_upsert_employee_document(
  p_id uuid, p_employee uuid, p_type text, p_title text, p_number text,
  p_issue date, p_expiry date, p_file_url text, p_visibility text, p_notes text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; v_id uuid; v_new boolean := false;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_title),''), null) is null then raise exception 'title_required'; end if;
  if p_type is not null and p_type not in ('national_id','iqama','contract','driving_license','iban','certificate','medical_insurance','other')
    then raise exception 'invalid_document_type'; end if;
  if p_visibility is not null and p_visibility not in ('admin_only','employee_visible')
    then raise exception 'invalid_visibility'; end if;
  select * into e from public.hr_employee_profiles where id = p_employee and is_deleted = false;
  if not found then raise exception 'employee_not_found'; end if;

  if p_id is not null then
    update public.hr_employee_documents set
      document_type = coalesce(nullif(trim(p_type),''), document_type),
      title = trim(p_title), document_number = nullif(trim(coalesce(p_number,'')),''),
      issue_date = p_issue, expiry_date = p_expiry,
      file_url = nullif(trim(coalesce(p_file_url,'')),''),
      visibility = coalesce(nullif(trim(p_visibility),''), visibility),
      notes = nullif(trim(coalesce(p_notes,'')),''), updated_at = now()
    where id = p_id and is_deleted = false
    returning id into v_id;
    if v_id is null then raise exception 'document_not_found'; end if;
  else
    insert into public.hr_employee_documents
      (employee_id, user_id, document_type, title, document_number, issue_date, expiry_date, file_url, visibility, notes, created_by)
    values (p_employee, e.user_id, coalesce(nullif(trim(p_type),''),'other'), trim(p_title),
            nullif(trim(coalesce(p_number,'')),''), p_issue, p_expiry,
            nullif(trim(coalesce(p_file_url,'')),''), coalesce(nullif(trim(p_visibility),''),'admin_only'),
            nullif(trim(coalesce(p_notes,'')),''), auth.uid())
    returning id into v_id;
    v_new := true;
  end if;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, visible_to_employee, created_by)
  values (p_employee, e.user_id, 'document_saved', 'حفظ وثيقة: ' || trim(p_title),
          coalesce(nullif(trim(p_visibility),''),'admin_only') = 'employee_visible', auth.uid());
  perform public.hr_notify_admins('hr_note_new', v_id,
    'وثيقة موظف: ' || e.full_name || ' — ' || trim(p_title),
    'Employee document: ' || e.full_name || ' — ' || trim(p_title));
  -- إشعار الموظف فقط للوثيقة الظاهرة له.
  if e.user_id is not null and coalesce(nullif(trim(p_visibility),''),'admin_only') = 'employee_visible' then
    perform public.hr_notify(e.user_id, 'hr_note_new', v_id,
      'أُضيفت وثيقة إلى ملفك: ' || trim(p_title), 'A document was added to your file: ' || trim(p_title));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end; $$;
revoke execute on function public.hr_admin_upsert_employee_document(uuid,uuid,text,text,text,date,date,text,text,text) from public, anon;
grant  execute on function public.hr_admin_upsert_employee_document(uuid,uuid,text,text,text,date,date,text,text,text) to authenticated;

create or replace function public.hr_admin_soft_delete_employee_document(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare doc record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  select * into doc from public.hr_employee_documents where id = p_id and is_deleted = false;
  if not found then raise exception 'document_not_found'; end if;
  update public.hr_employee_documents set is_deleted = true, deleted_by = auth.uid(),
    delete_reason = trim(p_reason), updated_at = now() where id = p_id;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (doc.employee_id, doc.user_id, 'document_deleted', 'حذف وثيقة: ' || doc.title, 'السبب: ' || trim(p_reason), auth.uid());
  return true;
end; $$;
revoke execute on function public.hr_admin_soft_delete_employee_document(uuid,text) from public, anon;
grant  execute on function public.hr_admin_soft_delete_employee_document(uuid,text) to authenticated;

-- الوثائق القريبة من الانتهاء (خلال p_days يومًا) — للإدارة.
create or replace function public.hr_admin_list_expiring_documents(p_days int default 90) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rows jsonb;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', d.id, 'employee_id', d.employee_id, 'full_name', p.full_name,
           'document_type', d.document_type, 'title', d.title,
           'expiry_date', d.expiry_date, 'visibility', d.visibility,
           'days_left', (d.expiry_date - public.hr_today())) order by d.expiry_date), '[]'::jsonb)
    into rows
    from public.hr_employee_documents d
    join public.hr_employee_profiles p on p.id = d.employee_id
   where d.is_deleted = false and d.expiry_date is not null
     and d.expiry_date >= public.hr_today()
     and d.expiry_date <= public.hr_today() + greatest(1, coalesce(p_days,90));
  return jsonb_build_object('as_of', public.hr_today(), 'window_days', coalesce(p_days,90), 'rows', rows);
end; $$;
revoke execute on function public.hr_admin_list_expiring_documents(int) from public, anon;
grant  execute on function public.hr_admin_list_expiring_documents(int) to authenticated;

-- ════════ 5) مشرف ميداني (mapping دون تعديل قيد الأدوار) ═════════════════════
create table if not exists public.hr_employee_supervisor_links (
  id                     uuid primary key default gen_random_uuid(),
  supervisor_employee_id uuid not null references public.hr_employee_profiles(id) on delete cascade,
  employee_id            uuid not null references public.hr_employee_profiles(id) on delete cascade,
  is_active              boolean not null default true,
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (supervisor_employee_id, employee_id),
  check (supervisor_employee_id <> employee_id)
);
create index if not exists idx_hr_superv_emp on public.hr_employee_supervisor_links(employee_id) where is_active = true;
create index if not exists idx_hr_superv_sup on public.hr_employee_supervisor_links(supervisor_employee_id) where is_active = true;
drop trigger if exists t_hr_superv_touch on public.hr_employee_supervisor_links;
create trigger t_hr_superv_touch before update on public.hr_employee_supervisor_links
  for each row execute function public.touch_updated_at();
alter table public.hr_employee_supervisor_links enable row level security;
drop policy if exists hr_superv_select on public.hr_employee_supervisor_links;
create policy hr_superv_select on public.hr_employee_supervisor_links for select
  using (public.can_manage_hr()
         or supervisor_employee_id in (select id from public.hr_employee_profiles where user_id = auth.uid()));
grant select on public.hr_employee_supervisor_links to authenticated;

-- هل المستخدم الحالي مشرف على هذا الموظف؟
create or replace function public.hr_supervises(p_employee uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.hr_employee_supervisor_links l
     join public.hr_employee_profiles s on s.id = l.supervisor_employee_id
    where l.employee_id = p_employee and l.is_active = true
      and s.user_id = auth.uid() and s.is_deleted = false);
$$;
revoke execute on function public.hr_supervises(uuid) from public, anon;
grant  execute on function public.hr_supervises(uuid) to authenticated;

-- ربط/فك ربط مشرف بموظف (أدمن).
create or replace function public.hr_admin_set_supervisor_link(
  p_supervisor uuid, p_employee uuid, p_active boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; s record; e record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_supervisor = p_employee then raise exception 'supervisor_is_self'; end if;
  select * into s from public.hr_employee_profiles where id = p_supervisor and is_deleted = false;
  if not found then raise exception 'supervisor_not_found'; end if;
  select * into e from public.hr_employee_profiles where id = p_employee and is_deleted = false;
  if not found then raise exception 'employee_not_found'; end if;

  insert into public.hr_employee_supervisor_links (supervisor_employee_id, employee_id, is_active, created_by)
  values (p_supervisor, p_employee, coalesce(p_active, true), auth.uid())
  on conflict (supervisor_employee_id, employee_id) do update set
    is_active = coalesce(p_active, true), updated_at = now()
  returning id into v_id;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
  values (p_employee, e.user_id, 'supervisor_changed',
          case when coalesce(p_active,true) then 'تعيين مشرف ميداني: ' || s.full_name
               else 'إلغاء إشراف: ' || s.full_name end, auth.uid());
  perform public.hr_notify_admins('hr_note_new', v_id,
    'تحديث إشراف ميداني: ' || s.full_name || ' ← ' || e.full_name,
    'Supervisor link: ' || s.full_name || ' → ' || e.full_name);
  if e.user_id is not null then
    perform public.hr_notify(e.user_id, 'hr_note_new', v_id,
      case when coalesce(p_active,true) then 'تم تعيين مشرفك الميداني: ' || s.full_name
           else 'تم إلغاء إشراف: ' || s.full_name end,
      'Your field supervisor was updated');
  end if;
  if s.user_id is not null then
    perform public.hr_notify(s.user_id, 'hr_note_new', v_id,
      case when coalesce(p_active,true) then 'أُضيف إلى فريقك: ' || e.full_name
           else 'أُزيل من فريقك: ' || e.full_name end,
      'Your team was updated');
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_admin_set_supervisor_link(uuid,uuid,boolean) from public, anon;
grant  execute on function public.hr_admin_set_supervisor_link(uuid,uuid,boolean) to authenticated;

-- فريق المشرف الحالي (بيانات أساسية + حالة الحضور اليوم؛ بلا مواقع/وثائق/رواتب).
create or replace function public.hr_supervisor_my_team() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rows jsonb; v_today date;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_today := public.hr_today();
  select coalesce(jsonb_agg(jsonb_build_object(
           'employee_id', e.id, 'user_id', e.user_id, 'full_name', e.full_name,
           'job_title', e.job_title, 'employment_status', e.employment_status,
           'checked_in_today', exists (select 1 from public.hr_attendance_records a
              where a.employee_id = e.id and a.work_date = v_today and a.check_in_at is not null and a.is_voided = false),
           'open_session', exists (select 1 from public.hr_attendance_records a
              where a.employee_id = e.id and a.check_in_at is not null and a.check_out_at is null and a.is_voided = false
                and a.check_in_at > now() - interval '20 hours')
         ) order by e.full_name), '[]'::jsonb)
    into rows
    from public.hr_employee_supervisor_links l
    join public.hr_employee_profiles e on e.id = l.employee_id and e.is_deleted = false
    join public.hr_employee_profiles s on s.id = l.supervisor_employee_id
   where l.is_active = true and s.user_id = auth.uid() and s.is_deleted = false;
  return jsonb_build_object('rows', rows);
end; $$;
revoke execute on function public.hr_supervisor_my_team() from public, anon;
grant  execute on function public.hr_supervisor_my_team() to authenticated;

-- مهام فريق المشرف (المفتوحة والحديثة).
create or replace function public.hr_supervisor_team_tasks() returns jsonb
language plpgsql security definer set search_path = public as $$
declare rows jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'task_id', t.id, 'title', t.title, 'status', t.status,
           'task_type', t.task_type, 'priority', t.priority, 'city', t.city,
           'client_name', t.client_name, 'expected_start_at', t.expected_start_at)), '[]'::jsonb)
    into rows
    from public.hr_field_task_assignees a
    join public.hr_field_tasks t on t.id = a.task_id and t.is_deleted = false
    join public.hr_employee_supervisor_links l on l.employee_id = a.employee_id and l.is_active = true
    join public.hr_employee_profiles s on s.id = l.supervisor_employee_id
   where s.user_id = auth.uid() and s.is_deleted = false
     and t.status in ('assigned','in_progress','submitted');
  return jsonb_build_object('rows', rows);
end; $$;
revoke execute on function public.hr_supervisor_team_tasks() from public, anon;
grant  execute on function public.hr_supervisor_team_tasks() to authenticated;

-- ملاحظة ميدانية من المشرف على أحد أفراد فريقه (تُوثّق؛ visible اختياري).
create or replace function public.hr_supervisor_add_note(p_employee uuid, p_note text, p_visible boolean default false) returns boolean
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if not (public.hr_supervises(p_employee) or public.can_manage_hr()) then raise exception 'not_supervisor'; end if;
  if coalesce(nullif(trim(p_note),''), null) is null then raise exception 'note_required'; end if;
  select * into e from public.hr_employee_profiles where id = p_employee and is_deleted = false;
  if not found then raise exception 'employee_not_found'; end if;
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, visible_to_employee, created_by)
  values (p_employee, e.user_id, 'supervisor_note', 'ملاحظة مشرف ميداني', trim(p_note), coalesce(p_visible,false), auth.uid());
  perform public.hr_notify_admins('hr_note_new', p_employee,
    'ملاحظة مشرف ميداني على ' || e.full_name, 'Supervisor note on ' || e.full_name);
  if coalesce(p_visible,false) and e.user_id is not null then
    perform public.hr_notify(e.user_id, 'hr_note_new', p_employee,
      'ملاحظة من مشرفك الميداني: ' || trim(p_note), 'A note from your field supervisor');
  end if;
  return true;
end; $$;
revoke execute on function public.hr_supervisor_add_note(uuid,text,boolean) from public, anon;
grant  execute on function public.hr_supervisor_add_note(uuid,text,boolean) to authenticated;

-- ════════ 6) سجل عمليات موحّد (audit log) ════════════════════════════════════
-- يقرأ hr_employee_events (SECURITY DEFINER) ويرفق اسم منفّذ العملية.
create or replace function public.hr_admin_list_audit_log(
  p_user uuid default null, p_types text[] default null,
  p_from date default null, p_to date default null, p_search text default null, p_limit int default 300
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rows jsonb;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(x order by x_created desc), '[]'::jsonb) into rows from (
    select jsonb_build_object(
             'id', ev.id, 'employee_id', ev.employee_id, 'employee_name', p.full_name,
             'event_type', ev.event_type, 'title', ev.title, 'description', ev.description,
             'visible_to_employee', ev.visible_to_employee,
             'actor_id', ev.created_by, 'actor_name', coalesce(ap.full_name, ap.email),
             'created_at', ev.created_at) as x,
           ev.created_at as x_created
      from public.hr_employee_events ev
      join public.hr_employee_profiles p on p.id = ev.employee_id
      left join public.profiles ap on ap.id = ev.created_by
     where (p_user is null or ev.user_id = p_user)
       and (p_types is null or ev.event_type = any (p_types))
       and (p_from is null or (ev.created_at at time zone 'Asia/Riyadh')::date >= p_from)
       and (p_to is null or (ev.created_at at time zone 'Asia/Riyadh')::date <= p_to)
       and (p_search is null or nullif(trim(p_search),'') is null
            or ev.title ilike '%'||trim(p_search)||'%'
            or coalesce(ev.description,'') ilike '%'||trim(p_search)||'%'
            or p.full_name ilike '%'||trim(p_search)||'%')
     order by ev.created_at desc
     limit greatest(1, least(1000, coalesce(p_limit, 300)))) sub;
  return jsonb_build_object('rows', rows);
end; $$;
revoke execute on function public.hr_admin_list_audit_log(uuid,text[],date,date,text,int) from public, anon;
grant  execute on function public.hr_admin_list_audit_log(uuid,text[],date,date,text,int) to authenticated;

-- ════════ 7) الجلسات المفتوحة الطويلة ════════════════════════════════════════
create or replace function public.hr_admin_long_open_sessions() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_hours int; rows jsonb;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  v_hours := coalesce((select open_session_alert_hours from public.hr_settings where id = 1), 10);
  select coalesce(jsonb_agg(jsonb_build_object(
           'record_id', a.id, 'employee_id', a.employee_id, 'user_id', a.user_id,
           'full_name', p.full_name, 'check_in_at', a.check_in_at,
           'hours_open', round(extract(epoch from (now() - a.check_in_at)) / 3600.0, 1)
         ) order by a.check_in_at), '[]'::jsonb)
    into rows
    from public.hr_attendance_records a
    join public.hr_employee_profiles p on p.id = a.employee_id
   where a.check_in_at is not null and a.check_out_at is null and a.is_voided = false
     and a.check_in_at < now() - make_interval(hours => v_hours);
  return jsonb_build_object('threshold_hours', v_hours, 'rows', rows);
end; $$;
revoke execute on function public.hr_admin_long_open_sessions() from public, anon;
grant  execute on function public.hr_admin_long_open_sessions() to authenticated;

-- ════════ 8) تحديث التقرير الشهري ليعتمد تقويم HR ════════════════════════════
create or replace function public.hr_admin_monthly_report(p_year int, p_month int, p_user uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_today date; v_elapsed_end date; d date;
  v_grace int; v_work_start time; v_workdays int;
  e record; rows jsonb := '[]'::jsonb;
  v_present int; v_present_workdays int; v_sessions int; v_hours numeric; v_late int;
  v_leave_count int; v_leave_days int; v_absent int; v_tasks int; v_corr int;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_year is null or p_year not between 2020 and 2100 then raise exception 'invalid_year'; end if;
  if p_month is null or p_month not between 1 and 12 then raise exception 'invalid_month'; end if;
  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month')::date;
  v_today := public.hr_today();
  v_elapsed_end := least(v_end, v_today + 1);
  v_grace := coalesce((select late_grace_minutes from public.hr_settings where id = 1), 15);
  v_work_start := (select default_work_start_time from public.hr_settings where id = 1);
  v_workdays := 0;
  for d in select generate_series(v_start, v_elapsed_end - 1, interval '1 day')::date loop
    if public.hr_is_workday(d) then v_workdays := v_workdays + 1; end if;
  end loop;

  for e in select * from public.hr_employee_profiles
            where is_deleted = false and (p_user is null or user_id = p_user)
            order by full_name loop
    select count(distinct work_date),
           count(distinct work_date) filter (where public.hr_is_workday(work_date)),
           count(*),
           round(coalesce(sum(extract(epoch from (check_out_at - check_in_at)) / 3600.0)
                          filter (where check_out_at is not null), 0)::numeric, 1)
      into v_present, v_present_workdays, v_sessions, v_hours
      from public.hr_attendance_records
     where employee_id = e.id and is_voided = false and check_in_at is not null
       and work_date >= v_start and work_date < v_end;

    if v_work_start is not null then
      select count(*) into v_late from (
        select work_date, min(check_in_at) as first_in
          from public.hr_attendance_records
         where employee_id = e.id and is_voided = false and check_in_at is not null
           and work_date >= v_start and work_date < v_end
         group by work_date) d1
       where (first_in at time zone 'Asia/Riyadh')::time > v_work_start + make_interval(mins => v_grace);
    else
      v_late := 0;
    end if;

    select count(*),
           coalesce(sum(case when leave_type in ('annual','sick','emergency','unpaid')
             then (select count(*)
                     from generate_series(greatest(start_date, v_start),
                                          least(coalesce(end_date, start_date), v_elapsed_end - 1),
                                          interval '1 day') g
                    where public.hr_is_workday(g::date))
             else 0 end), 0)
      into v_leave_count, v_leave_days
      from public.hr_leave_requests
     where employee_id = e.id and is_deleted = false and status = 'approved'
       and start_date < v_end and coalesce(end_date, start_date) >= v_start;

    v_absent := greatest(0, v_workdays - v_present_workdays - v_leave_days);

    select count(*) into v_corr from public.hr_attendance_correction_requests
     where employee_id = e.id and is_deleted = false and status = 'approved'
       and correction_date >= v_start and correction_date < v_end;

    select count(*) into v_tasks from public.hr_field_task_assignees
     where employee_id = e.id and status in ('submitted','completed') and ended_at is not null
       and (ended_at at time zone 'Asia/Riyadh')::date >= v_start
       and (ended_at at time zone 'Asia/Riyadh')::date < v_end;

    rows := rows || jsonb_build_object(
      'employee_id', e.id, 'user_id', e.user_id, 'full_name', e.full_name,
      'employment_status', e.employment_status,
      'present_days', v_present, 'session_count', v_sessions, 'total_hours', v_hours,
      'absent_days', v_absent, 'late_count', v_late,
      'approved_leaves', v_leave_count, 'approved_leave_days', v_leave_days,
      'approved_corrections', v_corr, 'tasks_done', v_tasks);
  end loop;

  return jsonb_build_object('year', p_year, 'month', p_month,
    'workdays_elapsed', v_workdays, 'uses_calendar', true, 'generated_at', now(), 'rows', rows);
end; $$;
revoke execute on function public.hr_admin_monthly_report(int,int,uuid) from public, anon;
grant  execute on function public.hr_admin_monthly_report(int,int,uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) الجداول الجديدة:
select table_name from information_schema.tables where table_schema='public'
 and table_name in ('hr_attendance_correction_requests','hr_work_calendar_settings','hr_holidays',
                    'hr_employee_documents','hr_employee_supervisor_links') order by 1;
-- 2) صلاحيات القراءة (يجب أن تُظهر authenticated لكل جدول جديد):
select table_name, grantee, privilege_type from information_schema.table_privileges
 where table_name in ('hr_attendance_correction_requests','hr_work_calendar_settings','hr_holidays',
                      'hr_employee_documents','hr_employee_supervisor_links')
   and grantee='authenticated' and privilege_type='SELECT' order by 1;
-- 3) أعمدة الإعدادات الجديدة:
select column_name from information_schema.columns where table_name='hr_settings'
 and column_name in ('late_deduction_enabled','absence_deduction_enabled','early_exit_deduction_enabled',
                     'deduction_notes','open_session_alert_hours') order by 1;
-- 4) الدوال الجديدة/المحدّثة:
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname in ('hr_get_settings','hr_admin_update_settings',
                   'hr_submit_attendance_correction_request','hr_cancel_my_attendance_correction_request',
                   'hr_admin_decide_attendance_correction_request','hr_is_workday','hr_get_calendar',
                   'hr_admin_set_weekend_days','hr_admin_upsert_holiday','hr_admin_soft_delete_holiday',
                   'hr_admin_payroll_report','hr_admin_upsert_employee_document',
                   'hr_admin_soft_delete_employee_document','hr_admin_list_expiring_documents',
                   'hr_supervises','hr_admin_set_supervisor_link','hr_supervisor_my_team',
                   'hr_supervisor_team_tasks','hr_supervisor_add_note','hr_admin_list_audit_log',
                   'hr_admin_long_open_sessions','hr_admin_monthly_report') order by 1;
-- 5) تقويم افتراضي (أيام العطلة الأسبوعية):
select weekend_days, default_timezone from public.hr_work_calendar_settings where id = 1;
-- ════════════════════════════════════════════════════════════════════════════
