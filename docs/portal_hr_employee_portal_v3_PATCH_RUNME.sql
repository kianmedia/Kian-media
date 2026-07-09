-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HR v3 PATCH: تحكم إداري كامل (soft delete + توثيق) + إعدادات
-- مركزية + تقرير شهري + تقييم أداء + بنية أجهزة الحضور (EZVIZ Y2000 كبنية فقط).
-- شغّله مرة واحدة في Supabase SQL Editor بعد v1 و v2 (idempotent — آمن للإعادة).
--
-- يتضمن:
--   1) توسيع hr_settings: تعدد الجلسات، إلزام الصورة، سماحية التأخير، دوام
--      افتراضي، تقييم الأداء، أجهزة الحضور، الاستيراد اليدوي + RPC تحديث jsonb
--      (توقيع v2 البولياني يبقى كغلاف توافق).
--   2) حذف إداري آمن (soft delete + سبب إلزامي + حدث Timeline + إشعار):
--      إجازات (حذف/تعديل)، حضور (إلغاء إداري is_voided)، مهام (حذف)، ملف موظف
--      (حذف للمالك بسبب) + تغيير حالة موظف. لا hard delete إطلاقًا.
--   3) إعادة تعريف hr_check_in/hr_check_out/hr_complete_my_task لتحترم الإعدادات
--      وتتجاهل السجلات الملغاة.
--   4) hr_task_reviews: تقييم داخلي بعد إغلاق المهمة (يظهر للموظف فقط عند تفعيل
--      show_performance_reviews_enabled — الافتراضي مخفي).
--   5) hr_admin_monthly_report: تجميع شهري (توقيت الرياض؛ عطلة الجمعة/السبت).
--   6) أجهزة الحضور: hr_attendance_devices + device_users + device_events
--      + RPCs (upsert/ربط/استيراد يدوي/معالجة) + سجل EZVIZ Y2000 pending.
--      لا ربط فعلي ولا استدعاء خدمات خارجية — بنية جاهزة للمستقبل فقط.
--
-- لا يغيّر قيد أنواع الإشعارات (يعيد استخدام أنواع hr_* القائمة في notifications).
-- لا يمس العهدة/التأجير/الفوترة/Zoho/Apps Script/واتساب/n8n/مركز الفرص.
-- كل الدوال SECURITY DEFINER + set search_path = public + revoke/grant.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) توسيع hr_settings ═══════════════════════════════════════════════
alter table public.hr_settings add column if not exists multiple_attendance_sessions_enabled boolean not null default true;
alter table public.hr_settings add column if not exists task_completion_photo_required       boolean not null default true;
alter table public.hr_settings add column if not exists late_grace_minutes                   integer not null default 15;
alter table public.hr_settings add column if not exists default_work_start_time              time;
alter table public.hr_settings add column if not exists default_work_end_time                time;
alter table public.hr_settings add column if not exists show_performance_reviews_enabled    boolean not null default false;
alter table public.hr_settings add column if not exists device_attendance_enabled            boolean not null default false;
alter table public.hr_settings add column if not exists manual_device_import_enabled         boolean not null default true;
alter table public.hr_settings drop constraint if exists hr_settings_late_grace_check;
alter table public.hr_settings add constraint hr_settings_late_grace_check
  check (late_grace_minutes between 0 and 240);

-- قراءة الإعدادات (كل المفاتيح) — للموظف والأدمن معًا (قيَم غير حساسة).
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
    'manual_device_import_enabled',          coalesce(r.manual_device_import_enabled, true));
end; $$;
revoke execute on function public.hr_get_settings() from public, anon;
grant  execute on function public.hr_get_settings() to authenticated;

-- تحديث الإعدادات v3: patch جزئي عبر jsonb — يحدّث المفاتيح المرسلة فقط.
create or replace function public.hr_admin_update_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v_changed text[] := '{}'; r record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    then raise exception 'patch_required'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('employee_leave_requests_enabled','multiple_attendance_sessions_enabled',
                 'task_completion_photo_required','late_grace_minutes',
                 'default_work_start_time','default_work_end_time',
                 'show_performance_reviews_enabled','device_attendance_enabled',
                 'manual_device_import_enabled')
      then raise exception 'invalid_setting_key: %', k; end if;
    v_changed := v_changed || k;
  end loop;

  update public.hr_settings set
    employee_leave_requests_enabled = case when p_patch ? 'employee_leave_requests_enabled'
      then coalesce((p_patch->>'employee_leave_requests_enabled')::boolean, employee_leave_requests_enabled)
      else employee_leave_requests_enabled end,
    multiple_attendance_sessions_enabled = case when p_patch ? 'multiple_attendance_sessions_enabled'
      then coalesce((p_patch->>'multiple_attendance_sessions_enabled')::boolean, multiple_attendance_sessions_enabled)
      else multiple_attendance_sessions_enabled end,
    task_completion_photo_required = case when p_patch ? 'task_completion_photo_required'
      then coalesce((p_patch->>'task_completion_photo_required')::boolean, task_completion_photo_required)
      else task_completion_photo_required end,
    late_grace_minutes = case when p_patch ? 'late_grace_minutes'
      then coalesce((p_patch->>'late_grace_minutes')::int, late_grace_minutes)
      else late_grace_minutes end,
    default_work_start_time = case when p_patch ? 'default_work_start_time'
      then nullif(p_patch->>'default_work_start_time','')::time
      else default_work_start_time end,
    default_work_end_time = case when p_patch ? 'default_work_end_time'
      then nullif(p_patch->>'default_work_end_time','')::time
      else default_work_end_time end,
    show_performance_reviews_enabled = case when p_patch ? 'show_performance_reviews_enabled'
      then coalesce((p_patch->>'show_performance_reviews_enabled')::boolean, show_performance_reviews_enabled)
      else show_performance_reviews_enabled end,
    device_attendance_enabled = case when p_patch ? 'device_attendance_enabled'
      then coalesce((p_patch->>'device_attendance_enabled')::boolean, device_attendance_enabled)
      else device_attendance_enabled end,
    manual_device_import_enabled = case when p_patch ? 'manual_device_import_enabled'
      then coalesce((p_patch->>'manual_device_import_enabled')::boolean, manual_device_import_enabled)
      else manual_device_import_enabled end,
    updated_by = auth.uid(), updated_at = now()
  where id = 1;

  select * into r from public.hr_settings where id = 1;
  -- إشعار مجموعة الإدارة فقط (نوع hr_note_new القائم) بالمفاتيح المتغيرة والقيمة المخزنة.
  perform public.hr_notify_admins('hr_note_new', null,
    'تحديث إعدادات الموارد البشرية: ' || array_to_string(v_changed, '، ')
      || case when 'employee_leave_requests_enabled' = any(v_changed)
              then case when r.employee_leave_requests_enabled then ' (الإجازات: مفعّلة)' else ' (الإجازات: موقوفة)' end
              else '' end,
    'HR settings updated: ' || array_to_string(v_changed, ', '));
  return public.hr_get_settings();
end; $$;
revoke execute on function public.hr_admin_update_settings(jsonb) from public, anon;
grant  execute on function public.hr_admin_update_settings(jsonb) to authenticated;

-- توافق خلفي مع توقيع v2 البولياني — يفوّض إلى نسخة jsonb.
create or replace function public.hr_admin_update_settings(p_leave_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if p_leave_enabled is null then raise exception 'leave_enabled_required'; end if;
  return public.hr_admin_update_settings(jsonb_build_object('employee_leave_requests_enabled', p_leave_enabled));
end; $$;
revoke execute on function public.hr_admin_update_settings(boolean) from public, anon;
grant  execute on function public.hr_admin_update_settings(boolean) to authenticated;

-- ════════ 2-أ) الإجازات: حذف إداري (soft) + تعديل إداري ═════════════════════
alter table public.hr_leave_requests add column if not exists is_deleted    boolean not null default false;
alter table public.hr_leave_requests add column if not exists deleted_at    timestamptz;
alter table public.hr_leave_requests add column if not exists deleted_by    uuid references auth.users(id);
alter table public.hr_leave_requests add column if not exists delete_reason text;

create or replace function public.hr_admin_soft_delete_leave_request(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  select * into l from public.hr_leave_requests where id = p_id and is_deleted = false;
  if not found then raise exception 'leave_not_found'; end if;

  update public.hr_leave_requests set
    is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = trim(p_reason), updated_at = now()
  where id = p_id;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (l.employee_id, l.user_id, 'leave_deleted',
          'حذف إداري لطلب إجازة (' || l.leave_type || ') بتاريخ ' || l.start_date,
          'السبب: ' || trim(p_reason), auth.uid());
  perform public.hr_notify(l.user_id, 'hr_note_new', p_id,
    'حُذف طلب إجازتك (' || l.leave_type || ') إداريًا — السبب: ' || trim(p_reason),
    'Your leave request (' || l.leave_type || ') was removed by admin — reason: ' || trim(p_reason));
  return true;
end; $$;
revoke execute on function public.hr_admin_soft_delete_leave_request(uuid,text) from public, anon;
grant  execute on function public.hr_admin_soft_delete_leave_request(uuid,text) to authenticated;

-- تعديل إداري لطلب إجازة معلّق (النموذج يرسل كل الحقول — قيم نهائية).
create or replace function public.hr_admin_update_leave_request(
  p_id uuid, p_type text, p_start date, p_end date,
  p_start_time time, p_end_time time, p_note text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select * into l from public.hr_leave_requests
   where id = p_id and is_deleted = false and status = 'pending';
  if not found then raise exception 'leave_not_editable'; end if;
  if p_type is not null and p_type not in ('annual','sick','emergency','unpaid','permission','late','early_exit')
    then raise exception 'invalid_leave_type'; end if;
  if p_start is null then raise exception 'start_date_required'; end if;
  if p_end is not null and p_end < p_start then raise exception 'invalid_date_range'; end if;

  update public.hr_leave_requests set
    leave_type = coalesce(nullif(trim(p_type),''), leave_type),
    start_date = p_start, end_date = p_end,
    start_time = p_start_time, end_time = p_end_time,
    updated_at = now()
  where id = p_id;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (l.employee_id, l.user_id, 'leave_updated',
          'تعديل إداري على طلب إجازة (' || coalesce(nullif(trim(p_type),''), l.leave_type) || ')',
          nullif(trim(coalesce(p_note,'')),''), auth.uid());
  perform public.hr_notify(l.user_id, 'hr_note_new', p_id,
    'عُدّل طلب إجازتك إداريًا — راجع التفاصيل' || coalesce(': ' || nullif(trim(p_note),''), ''),
    'Your leave request was updated by admin');
  return true;
end; $$;
revoke execute on function public.hr_admin_update_leave_request(uuid,text,date,date,time,time,text) from public, anon;
grant  execute on function public.hr_admin_update_leave_request(uuid,text,date,date,time,time,text) to authenticated;

-- ════════ 2-ب) الحضور: إلغاء إداري (لا حذف نهائي) + مصدر السجل ══════════════
alter table public.hr_attendance_records add column if not exists is_voided       boolean not null default false;
alter table public.hr_attendance_records add column if not exists voided_by       uuid references auth.users(id);
alter table public.hr_attendance_records add column if not exists voided_at       timestamptz;
alter table public.hr_attendance_records add column if not exists void_reason     text;
alter table public.hr_attendance_records add column if not exists source          text not null default 'app';
alter table public.hr_attendance_records add column if not exists device_event_id uuid;
alter table public.hr_attendance_records drop constraint if exists hr_att_source_check;
alter table public.hr_attendance_records add constraint hr_att_source_check
  check (source in ('app','device','admin'));

create or replace function public.hr_admin_void_attendance_record(p_record uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  select * into a from public.hr_attendance_records where id = p_record and is_voided = false;
  if not found then raise exception 'attendance_not_found'; end if;

  update public.hr_attendance_records set
    is_voided = true, voided_by = auth.uid(), voided_at = now(),
    void_reason = trim(p_reason), admin_adjusted_by = auth.uid(), updated_at = now()
  where id = p_record;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (a.employee_id, a.user_id, 'attendance_voided',
          'إلغاء إداري لسجل حضور يوم ' || a.work_date,
          'السبب: ' || trim(p_reason), auth.uid());
  perform public.hr_notify(a.user_id, 'hr_attendance_adjusted', p_record,
    'أُلغي سجل حضورك ليوم ' || a.work_date || ' إداريًا — السبب: ' || trim(p_reason),
    'Your attendance record for ' || a.work_date || ' was voided — reason: ' || trim(p_reason));
  return true;
end; $$;
revoke execute on function public.hr_admin_void_attendance_record(uuid,text) from public, anon;
grant  execute on function public.hr_admin_void_attendance_record(uuid,text) to authenticated;

-- ════════ 2-ج) المهام: حذف إداري (soft) ═════════════════════════════════════
alter table public.hr_field_tasks add column if not exists deleted_at    timestamptz;
alter table public.hr_field_tasks add column if not exists deleted_by    uuid references auth.users(id);
alter table public.hr_field_tasks add column if not exists delete_reason text;

create or replace function public.hr_admin_soft_delete_field_task(p_task uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t record; a record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  select * into t from public.hr_field_tasks where id = p_task and is_deleted = false;
  if not found then raise exception 'task_not_found'; end if;

  update public.hr_field_tasks set
    is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = trim(p_reason), updated_at = now()
  where id = p_task;

  for a in select * from public.hr_field_task_assignees
            where task_id = p_task and status in ('assigned','in_progress','submitted') loop
    update public.hr_field_task_assignees set status = 'cancelled', updated_at = now() where id = a.id;
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
    values (a.employee_id, a.user_id, 'task_deleted',
            'حذف إداري لمهمة: ' || t.title, 'السبب: ' || trim(p_reason), auth.uid());
    perform public.hr_notify(a.user_id, 'hr_task_closed', p_task,
      'حُذفت المهمة: ' || t.title || ' — السبب: ' || trim(p_reason),
      'Task deleted: ' || t.title || ' — reason: ' || trim(p_reason));
  end loop;
  return true;
end; $$;
revoke execute on function public.hr_admin_soft_delete_field_task(uuid,text) from public, anon;
grant  execute on function public.hr_admin_soft_delete_field_task(uuid,text) to authenticated;

-- ════════ 2-د) الموظفون: تغيير حالة (أدمن) + حذف بسبب (مالك فقط) ═══════════
alter table public.hr_employee_profiles add column if not exists delete_reason text;

create or replace function public.hr_admin_update_employee_status(p_id uuid, p_status text, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_status not in ('active','suspended','left') then raise exception 'invalid_status'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  select * into e from public.hr_employee_profiles where id = p_id and is_deleted = false;
  if not found then raise exception 'employee_not_found'; end if;
  if e.employment_status = p_status then raise exception 'status_unchanged'; end if;

  update public.hr_employee_profiles set
    employment_status = p_status,
    left_at = case when p_status = 'left' then coalesce(left_at, (now() at time zone 'Asia/Riyadh')::date)
                   else null end,
    updated_at = now()
  where id = p_id;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (p_id, e.user_id, 'status_changed',
          'تغيير الحالة الوظيفية: ' || e.employment_status || ' ← ' || p_status,
          'السبب: ' || trim(p_reason), auth.uid());
  if e.user_id is not null then
    perform public.hr_notify(e.user_id, 'hr_note_new', p_id,
      case p_status when 'active' then 'تم تفعيل حالتك الوظيفية — أهلاً بعودتك.'
                    when 'suspended' then 'تم إيقاف حالتك الوظيفية مؤقتًا — تواصل مع الإدارة.'
                    else 'تم تحديث حالتك الوظيفية إلى: انتهاء الخدمة.' end,
      'Your employment status changed to: ' || p_status);
  end if;
  perform public.hr_notify_admins('hr_note_new', p_id,
    'تغيير حالة موظف: ' || e.full_name || ' ← ' ||
      case p_status when 'active' then 'نشط' when 'suspended' then 'موقوف' else 'انتهت خدمته' end,
    'Employee status: ' || e.full_name || ' → ' || p_status);
  return true;
end; $$;
revoke execute on function public.hr_admin_update_employee_status(uuid,text,text) from public, anon;
grant  execute on function public.hr_admin_update_employee_status(uuid,text,text) to authenticated;

-- حذف ملف موظف (soft) بسبب إلزامي — للمالك/super_admin فقط.
create or replace function public.hr_owner_soft_delete_employee(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.is_owner() then raise exception 'owner only'; end if;
  if coalesce(nullif(trim(p_reason),''), null) is null then raise exception 'reason_required'; end if;
  select * into e from public.hr_employee_profiles where id = p_id and is_deleted = false;
  if not found then raise exception 'employee_not_found'; end if;

  update public.hr_employee_profiles set
    is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
    delete_reason = trim(p_reason), updated_at = now()
  where id = p_id;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
  values (p_id, e.user_id, 'employee_deleted',
          'حذف ملف الموظف: ' || e.full_name, 'السبب: ' || trim(p_reason), auth.uid());
  perform public.hr_notify_admins('hr_note_new', p_id,
    'حُذف ملف الموظف: ' || e.full_name || ' — السبب: ' || trim(p_reason),
    'Employee profile deleted: ' || e.full_name);
  return true;
end; $$;
revoke execute on function public.hr_owner_soft_delete_employee(uuid,text) from public, anon;
grant  execute on function public.hr_owner_soft_delete_employee(uuid,text) to authenticated;

-- منع "البعث": بعد حذف الملف، أول حضور/فتح بوابة كان يعيد إنشاء ملف جديد نظيف
-- تلقائيًا عبر hr_ensure_employee_for — الآن يُرفض بوضوح حتى يعيد الأدمن التفعيل
-- (أو يُنزع staff_role من الحساب). إعادة تعريف كاملة لنسخة v1 + الحارس الجديد.
create or replace function public.hr_ensure_employee_for(p_user uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_email text; v_phone text; v_role text;
begin
  select id into v_id from public.hr_employee_profiles
   where user_id = p_user and is_deleted = false limit 1;
  if v_id is not null then return v_id; end if;
  -- ملف محذوف لنفس الحساب؟ لا يُعاد إنشاؤه تلقائيًا.
  if exists (select 1 from public.hr_employee_profiles where user_id = p_user and is_deleted = true)
    then raise exception 'employee_deleted'; end if;
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

-- قفل التوقيع القديم بلا سبب (v1): يوجّه إلى الدالة الموثّقة — لا حذف بلا سبب/تدقيق.
create or replace function public.hr_owner_delete_employee(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  raise exception 'reason_required_use_hr_owner_soft_delete_employee';
end; $$;
revoke execute on function public.hr_owner_delete_employee(uuid) from public, anon;
grant  execute on function public.hr_owner_delete_employee(uuid) to authenticated;

-- ════════ 2-هـ) تحصين دوال v1 ضد السجلات المحذوفة/الملغاة (v3) ═══════════════
-- قرار إجازة: لا يُتخذ على طلب محذوف إداريًا.
create or replace function public.hr_admin_decide_leave(
  p_id uuid, p_approve boolean, p_note text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; v_status text;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select * into r from public.hr_leave_requests
   where id = p_id and status = 'pending' and is_deleted = false;
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

-- إلغاء الموظف لطلبه: لا يعمل على طلب محذوف إداريًا.
create or replace function public.hr_cancel_my_leave_request(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update public.hr_leave_requests set status = 'cancelled', updated_at = now()
   where id = p_id and user_id = auth.uid() and status = 'pending' and is_deleted = false;
  if not found then raise exception 'not_cancellable'; end if;
  return true;
end; $$;
revoke execute on function public.hr_cancel_my_leave_request(uuid) from public, anon;
grant  execute on function public.hr_cancel_my_leave_request(uuid) to authenticated;

-- تعديل إداري على حضور: لا يُعدَّل سجل ملغى (voided).
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
  select * into r from public.hr_attendance_records where id = p_record and is_voided = false;
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

-- ════════ 3) إعادة تعريف دوال الحضور/الإنهاء لتحترم الإعدادات والسجلات الملغاة ═
create or replace function public.hr_check_in(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_rec uuid; v_name text; v_multi boolean;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  if exists (select 1 from public.hr_employee_profiles where id = v_emp and employment_status <> 'active')
    then raise exception 'employee_not_active'; end if;
  perform pg_advisory_xact_lock(hashtext('hr_att_' || v_emp::text)::bigint);
  -- جلسة مفتوحة (غير ملغاة)؟ لا حضور جديد قبل إغلاقها.
  if exists (select 1 from public.hr_attendance_records
              where employee_id = v_emp and check_in_at is not null and check_out_at is null
                and is_voided = false and check_in_at > now() - interval '20 hours')
    then raise exception 'session_already_open'; end if;
  -- تعدد الجلسات موقوف؟ جلسة واحدة (غير ملغاة) في اليوم.
  v_multi := coalesce((select multiple_attendance_sessions_enabled from public.hr_settings where id = 1), true);
  if not v_multi and exists (select 1 from public.hr_attendance_records
              where employee_id = v_emp and work_date = public.hr_today()
                and is_voided = false and check_in_at is not null)
    then raise exception 'already_checked_in'; end if;

  insert into public.hr_attendance_records
    (employee_id, user_id, work_date, check_in_at, check_in_lat, check_in_lng,
     check_in_accuracy, check_in_ip, check_in_user_agent, status, source)
  values (v_emp, auth.uid(), public.hr_today(), now(), p_lat, p_lng, p_accuracy,
          public.hr_client_ip(), left(coalesce(p_user_agent,''), 300), 'present', 'app')
  returning id into v_rec;

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

create or replace function public.hr_check_out(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_rec uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  perform pg_advisory_xact_lock(hashtext('hr_att_' || v_emp::text)::bigint);
  select id into v_rec from public.hr_attendance_records
   where employee_id = v_emp
     and check_in_at is not null and check_out_at is null
     and is_voided = false
     and check_in_at > now() - interval '20 hours'
   order by check_in_at desc limit 1;
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

-- إنهاء المهمة: الصورة إلزامية فقط عند تفعيل task_completion_photo_required (الافتراضي: مفعّل).
create or replace function public.hr_complete_my_task(
  p_task uuid, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_note text default null, p_photos jsonb default '[]'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare a record; v_title text; ph text; v_open int; v_photo_required boolean;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into a from public.hr_field_task_assignees
   where task_id = p_task and user_id = auth.uid() and status = 'in_progress';
  if not found then raise exception 'assignment_not_in_progress'; end if;
  v_photo_required := coalesce((select task_completion_photo_required from public.hr_settings where id = 1), true);
  if v_photo_required
     and (jsonb_typeof(coalesce(p_photos,'[]'::jsonb)) <> 'array'
          or jsonb_array_length(coalesce(p_photos,'[]'::jsonb)) < 1)
    then raise exception 'completion_photo_required'; end if;

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

-- ════════ 4) تقييم أداء بسيط بعد إغلاق المهمة ═══════════════════════════════
create table if not exists public.hr_task_reviews (
  id                   uuid primary key default gen_random_uuid(),
  task_id              uuid not null references public.hr_field_tasks(id) on delete cascade,
  employee_id          uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id              uuid not null references auth.users(id),
  punctuality_rating   smallint check (punctuality_rating between 1 and 5),
  quality_rating       smallint check (quality_rating between 1 and 5),
  communication_rating smallint check (communication_rating between 1 and 5),
  admin_review_note    text,
  reviewed_by          uuid references auth.users(id),
  reviewed_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (task_id, employee_id)
);
create index if not exists idx_hr_reviews_user on public.hr_task_reviews(user_id, reviewed_at desc);
drop trigger if exists t_hr_reviews_touch on public.hr_task_reviews;
create trigger t_hr_reviews_touch before update on public.hr_task_reviews
  for each row execute function public.touch_updated_at();
alter table public.hr_task_reviews enable row level security;
-- مساعد SECURITY DEFINER لقراءة إعداد إظهار التقييم داخل سياسة RLS —
-- (استعلام hr_settings مباشرة داخل السياسة يفشل: الجدول بلا سياسات/grants للقارئ).
create or replace function public.hr_show_reviews_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select show_performance_reviews_enabled from public.hr_settings where id = 1), false);
$$;
revoke execute on function public.hr_show_reviews_enabled() from public, anon;
grant  execute on function public.hr_show_reviews_enabled() to authenticated;
-- الأدمن يقرأ الكل؛ الموظف يقرأ تقييمه فقط عندما تكون الميزة مفعّلة (الافتراضي: مخفي).
drop policy if exists hr_reviews_select on public.hr_task_reviews;
create policy hr_reviews_select on public.hr_task_reviews for select
  using (public.can_manage_hr()
         or (user_id = auth.uid() and public.hr_show_reviews_enabled()));
-- لا سياسات كتابة — الكتابة عبر RPC فقط.
-- grant إلزامي: لا default privileges في هذا المشروع (راجع whatsapp_inbox_grants_FIX) —
-- RLS وحدها لا تكفي؛ بدون grant تُرفض القراءة في طبقة الصلاحيات قبل RLS.
grant select on public.hr_task_reviews to authenticated;

create or replace function public.hr_admin_review_task_assignee(
  p_task uuid, p_employee uuid,
  p_punctuality int, p_quality int, p_communication int, p_note text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare t record; a record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select * into t from public.hr_field_tasks where id = p_task and status in ('completed','cancelled');
  if not found then raise exception 'task_not_closed'; end if;
  select * into a from public.hr_field_task_assignees where task_id = p_task and employee_id = p_employee;
  if not found then raise exception 'assignee_not_found'; end if;
  if p_punctuality is not null and p_punctuality not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if p_quality is not null and p_quality not between 1 and 5 then raise exception 'invalid_rating'; end if;
  if p_communication is not null and p_communication not between 1 and 5 then raise exception 'invalid_rating'; end if;

  insert into public.hr_task_reviews
    (task_id, employee_id, user_id, punctuality_rating, quality_rating, communication_rating,
     admin_review_note, reviewed_by, reviewed_at)
  values (p_task, p_employee, a.user_id, p_punctuality, p_quality, p_communication,
          nullif(trim(coalesce(p_note,'')),''), auth.uid(), now())
  on conflict (task_id, employee_id) do update set
    punctuality_rating = excluded.punctuality_rating,
    quality_rating = excluded.quality_rating,
    communication_rating = excluded.communication_rating,
    admin_review_note = excluded.admin_review_note,
    reviewed_by = excluded.reviewed_by, reviewed_at = now(), updated_at = now();

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
  values (p_employee, a.user_id, 'task_reviewed', 'تقييم أداء لمهمة: ' || t.title, auth.uid());
  return true;
end; $$;
revoke execute on function public.hr_admin_review_task_assignee(uuid,uuid,int,int,int,text) from public, anon;
grant  execute on function public.hr_admin_review_task_assignee(uuid,uuid,int,int,int,text) to authenticated;

-- ════════ 5) التقرير الشهري ══════════════════════════════════════════════════
-- المنطق الزمني (موثّق): كل التواريخ بتوقيت الرياض (hr_today / at time zone
-- 'Asia/Riyadh'). أيام العمل = أيام الشهر المنقضية عدا الجمعة والسبت.
-- الغياب = أيام العمل المنقضية − أيام الحضور − أيام الإجازات المعتمدة (الأنواع
-- اليومية فقط: annual/sick/emergency/unpaid) — لا ينزل تحت الصفر. التأخير يُحسب
-- فقط عند ضبط default_work_start_time: أول حضور في اليوم بعد وقت البداية + السماحية.
create or replace function public.hr_admin_monthly_report(p_year int, p_month int, p_user uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_start date; v_end date; v_today date; v_elapsed_end date;
  v_grace int; v_work_start time; v_workdays int;
  e record; rows jsonb := '[]'::jsonb;
  v_present int; v_present_workdays int; v_sessions int; v_hours numeric; v_late int;
  v_leave_count int; v_leave_days int; v_absent int; v_tasks int;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_year is null or p_year not between 2020 and 2100 then raise exception 'invalid_year'; end if;
  if p_month is null or p_month not between 1 and 12 then raise exception 'invalid_month'; end if;
  v_start := make_date(p_year, p_month, 1);
  v_end := (v_start + interval '1 month')::date;           -- حصري
  v_today := public.hr_today();
  v_elapsed_end := least(v_end, v_today + 1);              -- لا نحسب غيابًا عن أيام لم تأتِ بعد
  v_grace := coalesce((select late_grace_minutes from public.hr_settings where id = 1), 15);
  v_work_start := (select default_work_start_time from public.hr_settings where id = 1);
  select count(*) into v_workdays
    from generate_series(v_start, v_elapsed_end - 1, interval '1 day') d
   where extract(dow from d) not in (5, 6);                -- الجمعة=5، السبت=6

  for e in select * from public.hr_employee_profiles
            where is_deleted = false
              and (p_user is null or user_id = p_user)
            order by full_name loop
    select count(distinct work_date),
           count(distinct work_date) filter (where extract(dow from work_date) not in (5, 6)),
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
         group by work_date) d
       where (d.first_in at time zone 'Asia/Riyadh')::time > v_work_start + make_interval(mins => v_grace);
    else
      v_late := 0;
    end if;

    -- أيام الإجازة المعتمدة: أيام العمل المنقضية فقط (بلا جمعة/سبت وبلا أيام مستقبلية)
    -- حتى تُطرح من نفس أساس v_workdays في حساب الغياب.
    select count(*),
           coalesce(sum(case when leave_type in ('annual','sick','emergency','unpaid')
             then (select count(*)
                     from generate_series(greatest(start_date, v_start),
                                          least(coalesce(end_date, start_date), v_elapsed_end - 1),
                                          interval '1 day') g
                    where extract(dow from g) not in (5, 6))
             else 0 end), 0)
      into v_leave_count, v_leave_days
      from public.hr_leave_requests
     where employee_id = e.id and is_deleted = false and status = 'approved'
       and start_date < v_end and coalesce(end_date, start_date) >= v_start;

    v_absent := greatest(0, v_workdays - v_present_workdays - v_leave_days);

    select count(*) into v_tasks
      from public.hr_field_task_assignees
     where employee_id = e.id and status in ('submitted','completed')
       and ended_at is not null
       and (ended_at at time zone 'Asia/Riyadh')::date >= v_start
       and (ended_at at time zone 'Asia/Riyadh')::date < v_end;

    rows := rows || jsonb_build_object(
      'employee_id', e.id, 'user_id', e.user_id, 'full_name', e.full_name,
      'employment_status', e.employment_status,
      'present_days', v_present, 'session_count', v_sessions, 'total_hours', v_hours,
      'absent_days', v_absent, 'late_count', v_late,
      'approved_leaves', v_leave_count, 'approved_leave_days', v_leave_days,
      'tasks_done', v_tasks);
  end loop;

  return jsonb_build_object('year', p_year, 'month', p_month,
    'workdays_elapsed', v_workdays, 'generated_at', now(), 'rows', rows);
end; $$;
revoke execute on function public.hr_admin_monthly_report(int,int,uuid) from public, anon;
grant  execute on function public.hr_admin_monthly_report(int,int,uuid) to authenticated;

-- ════════ 6) أجهزة الحضور — بنية فقط (EZVIZ Y2000 لاحقًا عبر CSV/Webhook/API) ═
create table if not exists public.hr_attendance_devices (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  device_type     text not null default 'other'
                  check (device_type in ('smart_lock','biometric','nfc_reader','qr_station','manual_import','other')),
  brand           text,
  model           text,
  location_name   text,
  connection_mode text not null default 'pending'
                  check (connection_mode in ('pending','manual','csv','webhook','api')),
  is_active       boolean not null default true,
  notes           text,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
drop trigger if exists t_hr_devices_touch on public.hr_attendance_devices;
create trigger t_hr_devices_touch before update on public.hr_attendance_devices
  for each row execute function public.touch_updated_at();
alter table public.hr_attendance_devices enable row level security;
drop policy if exists hr_devices_admin_select on public.hr_attendance_devices;
create policy hr_devices_admin_select on public.hr_attendance_devices for select
  using (public.can_manage_hr());
grant select on public.hr_attendance_devices to authenticated;  -- RLS تحصر القراءة بالإدارة
-- لا سياسات كتابة — الكتابة عبر RPC فقط. الموظف/العميل لا يقرأ شيئًا.

create table if not exists public.hr_attendance_device_users (
  id                     uuid primary key default gen_random_uuid(),
  device_id              uuid not null references public.hr_attendance_devices(id) on delete cascade,
  employee_id            uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id                uuid references auth.users(id),
  device_user_identifier text not null,
  card_id                text,
  pin_label              text,
  fingerprint_label      text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (device_id, device_user_identifier)
);
create index if not exists idx_hr_device_users_emp on public.hr_attendance_device_users(employee_id);
drop trigger if exists t_hr_device_users_touch on public.hr_attendance_device_users;
create trigger t_hr_device_users_touch before update on public.hr_attendance_device_users
  for each row execute function public.touch_updated_at();
alter table public.hr_attendance_device_users enable row level security;
drop policy if exists hr_device_users_admin_select on public.hr_attendance_device_users;
create policy hr_device_users_admin_select on public.hr_attendance_device_users for select
  using (public.can_manage_hr());
grant select on public.hr_attendance_device_users to authenticated;  -- RLS تحصر القراءة بالإدارة

create table if not exists public.hr_attendance_device_events (
  id                     uuid primary key default gen_random_uuid(),
  device_id              uuid not null references public.hr_attendance_devices(id) on delete cascade,
  employee_id            uuid references public.hr_employee_profiles(id),
  user_id                uuid references auth.users(id),
  device_user_identifier text,
  event_type             text not null default 'unknown'
                         check (event_type in ('unlock','check_in','check_out','unknown')),
  event_time             timestamptz not null,
  raw_payload            jsonb,
  note                   text,
  processed_status       text not null default 'pending'
                         check (processed_status in ('pending','processed','ignored','failed')),
  processed_by           uuid references auth.users(id),
  processed_at           timestamptz,
  attendance_record_id   uuid references public.hr_attendance_records(id),
  error_message          text,
  created_by             uuid references auth.users(id),
  created_at             timestamptz not null default now()
);
create index if not exists idx_hr_device_events_status on public.hr_attendance_device_events(processed_status, event_time desc);
create index if not exists idx_hr_device_events_device on public.hr_attendance_device_events(device_id, event_time desc);
alter table public.hr_attendance_device_events enable row level security;
drop policy if exists hr_device_events_admin_select on public.hr_attendance_device_events;
create policy hr_device_events_admin_select on public.hr_attendance_device_events for select
  using (public.can_manage_hr());
grant select on public.hr_attendance_device_events to authenticated;  -- RLS تحصر القراءة بالإدارة

-- سجل EZVIZ Y2000 الافتراضي (pending — بنية فقط، لا ربط فعلي).
insert into public.hr_attendance_devices (name, device_type, brand, model, location_name, connection_mode, notes)
select 'EZVIZ Y2000 - Main Door', 'smart_lock', 'EZVIZ', 'Y2000', 'الباب الرئيسي', 'pending',
       'جاهز للربط لاحقًا عبر CSV أو Webhook أو API — لا ربط فعلي بعد.'
 where not exists (select 1 from public.hr_attendance_devices where brand = 'EZVIZ' and model = 'Y2000');

-- إضافة/تعديل جهاز (النموذج يرسل كل الحقول — قيم نهائية).
create or replace function public.hr_admin_upsert_attendance_device(
  p_id uuid, p_name text, p_type text, p_brand text, p_model text,
  p_location text, p_mode text, p_active boolean, p_notes text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_name),''), null) is null then raise exception 'name_required'; end if;
  if p_type is not null and p_type not in ('smart_lock','biometric','nfc_reader','qr_station','manual_import','other')
    then raise exception 'invalid_device_type'; end if;
  if p_mode is not null and p_mode not in ('pending','manual','csv','webhook','api')
    then raise exception 'invalid_connection_mode'; end if;

  if p_id is not null then
    update public.hr_attendance_devices set
      name = trim(p_name),
      device_type = coalesce(nullif(trim(p_type),''), device_type),
      brand = nullif(trim(coalesce(p_brand,'')),''),
      model = nullif(trim(coalesce(p_model,'')),''),
      location_name = nullif(trim(coalesce(p_location,'')),''),
      connection_mode = coalesce(nullif(trim(p_mode),''), connection_mode),
      is_active = coalesce(p_active, is_active),
      notes = nullif(trim(coalesce(p_notes,'')),''),
      updated_at = now()
    where id = p_id and is_deleted = false
    returning id into v_id;
    if v_id is null then raise exception 'device_not_found'; end if;
  else
    insert into public.hr_attendance_devices
      (name, device_type, brand, model, location_name, connection_mode, is_active, notes)
    values (trim(p_name), coalesce(nullif(trim(p_type),''),'other'),
            nullif(trim(coalesce(p_brand,'')),''), nullif(trim(coalesce(p_model,'')),''),
            nullif(trim(coalesce(p_location,'')),''), coalesce(nullif(trim(p_mode),''),'pending'),
            coalesce(p_active, true), nullif(trim(coalesce(p_notes,'')),''))
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_admin_upsert_attendance_device(uuid,text,text,text,text,text,text,boolean,text) from public, anon;
grant  execute on function public.hr_admin_upsert_attendance_device(uuid,text,text,text,text,text,text,boolean,text) to authenticated;

-- ربط معرف مستخدم/كرت في الجهاز بموظف.
create or replace function public.hr_admin_map_device_user_to_employee(
  p_device uuid, p_employee uuid, p_identifier text,
  p_card text, p_pin text, p_fingerprint text, p_active boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e record; v_id uuid;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_identifier),''), null) is null then raise exception 'identifier_required'; end if;
  if not exists (select 1 from public.hr_attendance_devices where id = p_device and is_deleted = false)
    then raise exception 'device_not_found'; end if;
  select * into e from public.hr_employee_profiles where id = p_employee and is_deleted = false;
  if not found then raise exception 'employee_not_found'; end if;

  insert into public.hr_attendance_device_users
    (device_id, employee_id, user_id, device_user_identifier, card_id, pin_label, fingerprint_label, is_active)
  values (p_device, p_employee, e.user_id, trim(p_identifier),
          nullif(trim(coalesce(p_card,'')),''), nullif(trim(coalesce(p_pin,'')),''),
          nullif(trim(coalesce(p_fingerprint,'')),''), coalesce(p_active, true))
  on conflict (device_id, device_user_identifier) do update set
    employee_id = excluded.employee_id, user_id = excluded.user_id,
    card_id = excluded.card_id, pin_label = excluded.pin_label,
    fingerprint_label = excluded.fingerprint_label,
    is_active = excluded.is_active, updated_at = now()
  returning id into v_id;

  insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
  values (p_employee, e.user_id, 'device_linked',
          'ربط جهاز حضور بالموظف — المعرف: ' || trim(p_identifier), auth.uid());
  perform public.hr_notify_admins('hr_note_new', v_id,
    'ربط جهاز حضور: ' || e.full_name || ' — المعرف: ' || trim(p_identifier),
    'Device user mapped: ' || e.full_name);
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_admin_map_device_user_to_employee(uuid,uuid,text,text,text,text,boolean) from public, anon;
grant  execute on function public.hr_admin_map_device_user_to_employee(uuid,uuid,text,text,text,text,boolean) to authenticated;

-- استيراد حدث جهاز يدويًا (يبقى pending حتى المعالجة).
create or replace function public.hr_admin_import_device_event(
  p_device uuid, p_identifier text, p_event_type text, p_event_time timestamptz,
  p_note text default null, p_payload jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m record; v_id uuid;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if not coalesce((select manual_device_import_enabled from public.hr_settings where id = 1), true)
    then raise exception 'manual_import_disabled'; end if;
  if not exists (select 1 from public.hr_attendance_devices where id = p_device and is_deleted = false)
    then raise exception 'device_not_found'; end if;
  if coalesce(nullif(trim(p_identifier),''), null) is null then raise exception 'identifier_required'; end if;
  if p_event_type is not null and p_event_type not in ('unlock','check_in','check_out','unknown')
    then raise exception 'invalid_event_type'; end if;
  if p_event_time is null then raise exception 'event_time_required'; end if;
  if p_event_time > now() + interval '5 minutes' then raise exception 'event_time_in_future'; end if;

  -- محاولة التعرف على الموظف من الربط (لا فشل إن لم يوجد — يبقى pending).
  select * into m from public.hr_attendance_device_users
   where device_id = p_device and device_user_identifier = trim(p_identifier) and is_active = true
   limit 1;

  insert into public.hr_attendance_device_events
    (device_id, employee_id, user_id, device_user_identifier, event_type, event_time,
     raw_payload, note, created_by)
  values (p_device, m.employee_id, m.user_id, trim(p_identifier),
          coalesce(nullif(trim(p_event_type),''),'unknown'), p_event_time,
          p_payload, nullif(trim(coalesce(p_note,'')),''), auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'matched', m.employee_id is not null);
end; $$;
revoke execute on function public.hr_admin_import_device_event(uuid,text,text,timestamptz,text,jsonb) from public, anon;
grant  execute on function public.hr_admin_import_device_event(uuid,text,text,timestamptz,text,jsonb) to authenticated;

-- معالجة حدث جهاز:
--   بلا ربط موظف ⇒ يبقى pending مع error_message (لا فشل صلب).
--   device_attendance_enabled=false ⇒ يُعلَّم processed دون أي تغيير على الحضور.
--   =true ⇒ check_in يفتح جلسة، check_out يقفل أحدث جلسة مفتوحة، unlock حسب
--   الحالة (جلسة مفتوحة ⇒ انصراف، وإلا ⇒ حضور). التكرار ⇒ ignored.
create or replace function public.hr_admin_process_device_event(p_event uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  ev record; m record; d record; v_enabled boolean; v_action text; v_rec uuid;
  v_open uuid; v_name text; v_date date;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select * into ev from public.hr_attendance_device_events where id = p_event and processed_status = 'pending';
  if not found then raise exception 'event_not_pending'; end if;
  select * into d from public.hr_attendance_devices where id = ev.device_id;

  -- التعرف على الموظف (إن لم يكن محفوظًا في الحدث).
  if ev.employee_id is null then
    select * into m from public.hr_attendance_device_users
     where device_id = ev.device_id and device_user_identifier = ev.device_user_identifier and is_active = true
     limit 1;
    if m.employee_id is null then
      update public.hr_attendance_device_events
         set error_message = 'no_employee_mapping' where id = p_event;
      return jsonb_build_object('ok', true, 'matched', false, 'status', 'pending');
    end if;
    update public.hr_attendance_device_events
       set employee_id = m.employee_id, user_id = m.user_id where id = p_event;
    ev.employee_id := m.employee_id; ev.user_id := m.user_id;
  end if;

  v_enabled := coalesce((select device_attendance_enabled from public.hr_settings where id = 1), false);
  select full_name into v_name from public.hr_employee_profiles where id = ev.employee_id;

  -- موظف بلا حساب بوابة مرتبط: لا يمكن إنشاء سجل حضور (user_id إلزامي) — يُتجاهل بوضوح.
  if v_enabled and ev.user_id is null then
    update public.hr_attendance_device_events set
      processed_status = 'ignored', processed_by = auth.uid(), processed_at = now(),
      error_message = 'employee_not_linked'
    where id = p_event;
    return jsonb_build_object('ok', true, 'matched', true, 'status', 'ignored', 'reason', 'employee_not_linked');
  end if;

  if not v_enabled then
    -- الجهاز غير مفعّل للحضور: توثيق فقط — لا تعديل على سجلات الحضور.
    update public.hr_attendance_device_events set
      processed_status = 'processed', processed_by = auth.uid(), processed_at = now(),
      error_message = null
    where id = p_event;
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
    values (ev.employee_id, ev.user_id, 'device_event',
            'حدث جهاز (' || coalesce(d.name,'') || '): ' || ev.event_type || ' — ' ||
            to_char(ev.event_time at time zone 'Asia/Riyadh','YYYY-MM-DD HH24:MI') || ' (بدون تسجيل حضور — الميزة موقوفة)',
            auth.uid());
    return jsonb_build_object('ok', true, 'matched', true, 'status', 'processed', 'attendance', 'skipped_disabled');
  end if;

  -- الميزة مفعّلة: تحويل الحدث إلى حضور/انصراف.
  perform pg_advisory_xact_lock(hashtext('hr_att_' || ev.employee_id::text)::bigint);
  select id into v_open from public.hr_attendance_records
   where employee_id = ev.employee_id
     and check_in_at is not null and check_out_at is null and is_voided = false
     and check_in_at > ev.event_time - interval '20 hours'
     and check_in_at < ev.event_time
   order by check_in_at desc limit 1;

  v_action := case
    when ev.event_type = 'check_in' then 'check_in'
    when ev.event_type = 'check_out' then 'check_out'
    when v_open is not null then 'check_out'      -- unlock/unknown: جلسة مفتوحة ⇒ انصراف
    else 'check_in' end;

  if v_action = 'check_in' then
    if v_open is not null then
      update public.hr_attendance_device_events set
        processed_status = 'ignored', processed_by = auth.uid(), processed_at = now(),
        error_message = 'session_already_open'
      where id = p_event;
      return jsonb_build_object('ok', true, 'matched', true, 'status', 'ignored', 'reason', 'session_already_open');
    end if;
    v_date := (ev.event_time at time zone 'Asia/Riyadh')::date;
    insert into public.hr_attendance_records
      (employee_id, user_id, work_date, check_in_at, check_in_user_agent, status, source, device_event_id)
    values (ev.employee_id, ev.user_id, v_date, ev.event_time,
            'device:' || coalesce(d.name,''), 'present', 'device', ev.id)
    returning id into v_rec;
    perform public.hr_notify_admins('hr_check_in', v_rec,
      'حضور (جهاز ' || coalesce(d.name,'') || '): ' || coalesce(v_name,'') || ' — ' ||
        to_char(ev.event_time at time zone 'Asia/Riyadh','HH24:MI'),
      'Device check-in: ' || coalesce(v_name,''));
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
    values (ev.employee_id, ev.user_id, 'device_checkin',
            'حضور عبر جهاز (' || coalesce(d.name,'') || ') — ' || to_char(ev.event_time at time zone 'Asia/Riyadh','HH24:MI'),
            auth.uid());
  else
    if v_open is null then
      update public.hr_attendance_device_events set
        processed_status = 'ignored', processed_by = auth.uid(), processed_at = now(),
        error_message = 'no_open_check_in'
      where id = p_event;
      return jsonb_build_object('ok', true, 'matched', true, 'status', 'ignored', 'reason', 'no_open_check_in');
    end if;
    update public.hr_attendance_records set
      check_out_at = ev.event_time,
      check_out_user_agent = 'device:' || coalesce(d.name,''), updated_at = now()
    where id = v_open;
    v_rec := v_open;
    perform public.hr_notify_admins('hr_check_out', v_rec,
      'انصراف (جهاز ' || coalesce(d.name,'') || '): ' || coalesce(v_name,'') || ' — ' ||
        to_char(ev.event_time at time zone 'Asia/Riyadh','HH24:MI'),
      'Device check-out: ' || coalesce(v_name,''));
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
    values (ev.employee_id, ev.user_id, 'device_checkout',
            'انصراف عبر جهاز (' || coalesce(d.name,'') || ') — ' || to_char(ev.event_time at time zone 'Asia/Riyadh','HH24:MI'),
            auth.uid());
  end if;

  update public.hr_attendance_device_events set
    processed_status = 'processed', processed_by = auth.uid(), processed_at = now(),
    attendance_record_id = v_rec, error_message = null
  where id = p_event;
  return jsonb_build_object('ok', true, 'matched', true, 'status', 'processed',
    'action', v_action, 'attendance_record_id', v_rec);
end; $$;
revoke execute on function public.hr_admin_process_device_event(uuid) from public, anon;
grant  execute on function public.hr_admin_process_device_event(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) أعمدة الإعدادات الجديدة:
select column_name from information_schema.columns
 where table_name = 'hr_settings' order by ordinal_position;
-- 2) أعمدة soft delete/void:
select column_name from information_schema.columns
 where table_name = 'hr_leave_requests' and column_name in ('is_deleted','delete_reason');
select column_name from information_schema.columns
 where table_name = 'hr_attendance_records' and column_name in ('is_voided','void_reason','source','device_event_id');
-- 3) الجداول الجديدة:
select table_name from information_schema.tables
 where table_name in ('hr_task_reviews','hr_attendance_devices','hr_attendance_device_users','hr_attendance_device_events');
-- 4) جهاز EZVIZ:
select name, device_type, connection_mode, is_active from public.hr_attendance_devices where model = 'Y2000';
-- 5) الدوال الجديدة/المعدّلة:
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname in ('hr_get_settings','hr_admin_update_settings','hr_admin_soft_delete_leave_request',
                   'hr_admin_update_leave_request','hr_admin_void_attendance_record',
                   'hr_admin_soft_delete_field_task','hr_admin_update_employee_status',
                   'hr_owner_soft_delete_employee','hr_check_in','hr_check_out','hr_complete_my_task',
                   'hr_admin_review_task_assignee','hr_admin_monthly_report',
                   'hr_admin_upsert_attendance_device','hr_admin_map_device_user_to_employee',
                   'hr_admin_import_device_event','hr_admin_process_device_event',
                   'hr_show_reviews_enabled','hr_ensure_employee_for',
                   'hr_admin_decide_leave','hr_cancel_my_leave_request','hr_admin_adjust_attendance')
 order by proname;
-- 7) صلاحيات القراءة على الجداول الجديدة (يجب أن تُظهر authenticated):
select table_name, grantee, privilege_type from information_schema.table_privileges
 where table_name in ('hr_task_reviews','hr_attendance_devices','hr_attendance_device_users','hr_attendance_device_events')
   and grantee = 'authenticated' and privilege_type = 'SELECT';
-- 6) سياسات RLS على جداول الأجهزة والتقييم:
select tablename, policyname from pg_policies
 where tablename in ('hr_task_reviews','hr_attendance_devices','hr_attendance_device_users','hr_attendance_device_events');
-- ════════════════════════════════════════════════════════════════════════════
