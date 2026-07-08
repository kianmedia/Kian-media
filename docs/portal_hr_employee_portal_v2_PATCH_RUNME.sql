-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HR v2 PATCH: جلسات حضور متعددة + مهام ميدانية مفصّلة + إعدادات HR
-- شغّله مرة واحدة في Supabase SQL Editor بعد docs/portal_hr_employee_portal_RUNME.sql
-- (idempotent — آمن للإعادة).
--
-- يتضمن:
--   1) جلسات حضور/انصراف متعددة في اليوم الواحد: إسقاط قيد unique(employee_id,
--      work_date) — كل صف = جلسة (حضور→انصراف). لا حضور جديد وجلسة مفتوحة.
--      الانصراف يقفل أحدث جلسة مفتوحة (نافذة 20 ساعة — تغطي الورديات الليلية).
--   2) حقول المهام الميدانية: العميل، المشروع، نوع المهمة (photo/video/drone/
--      live_stream/editing/delivery/meeting/other)، رابط خرائط، المدينة، ملاحظات
--      تنفيذ، متطلبات خاصة، معدات مطلوبة (نصيًا — لا مساس بنظام العهدة)، الأولوية
--      (low/normal/high/urgent) + RPC إنشاء v2 + RPC تعديل مهمة.
--   3) صورة إلزامية عند إنهاء المهمة (completion_photo_required).
--   4) hr_settings: employee_leave_requests_enabled (افتراضي FALSE — قسم الإجازات
--      مخفي عن الموظفين حتى يفعّله الأدمن). الإرسال عبر RPC يُرفض برسالة
--      leave_requests_disabled عند الإيقاف.
--
-- لا يغيّر قيد أنواع الإشعارات (يعيد استخدام hr_task_new/hr_note_new). لا يمس
-- العهدة/الفوترة/Zoho/الواتساب. كل الدوال SECURITY DEFINER + search_path=public.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) جلسات متعددة: إسقاط قيد الصف الواحد يوميًا ═══════════════════════
-- يُسقط أي قيد unique على (employee_id, work_date) أيًا كان اسمه التلقائي.
do $$
declare c record;
begin
  for c in
    select con.conname
      from pg_constraint con
     where con.conrelid = 'public.hr_attendance_records'::regclass
       and con.contype = 'u'
       and (select array_agg(att.attname order by att.attname)
              from unnest(con.conkey) k
              join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k)
           = array['employee_id','work_date']
  loop
    execute format('alter table public.hr_attendance_records drop constraint %I', c.conname);
  end loop;
end $$;
create index if not exists idx_hr_att_emp_date on public.hr_attendance_records(employee_id, work_date desc);

-- تسجيل حضور v2: جلسة جديدة ما دام لا توجد جلسة مفتوحة (خلال 20 ساعة).
create or replace function public.hr_check_in(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_rec uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  if exists (select 1 from public.hr_employee_profiles where id = v_emp and employment_status <> 'active')
    then raise exception 'employee_not_active'; end if;
  -- قفل استشاري لكل موظف: بعد إسقاط قيد unique صار الحارس check-then-insert —
  -- القفل يمنع ضغطتين متزامنتين من فتح جلستين معًا (يُحرر تلقائيًا بنهاية المعاملة).
  perform pg_advisory_xact_lock(hashtext('hr_att_' || v_emp::text)::bigint);
  -- جلسة مفتوحة؟ لا حضور جديد قبل إغلاقها.
  if exists (select 1 from public.hr_attendance_records
              where employee_id = v_emp and check_in_at is not null and check_out_at is null
                and check_in_at > now() - interval '20 hours')
    then raise exception 'session_already_open'; end if;

  insert into public.hr_attendance_records
    (employee_id, user_id, work_date, check_in_at, check_in_lat, check_in_lng,
     check_in_accuracy, check_in_ip, check_in_user_agent, status)
  values (v_emp, auth.uid(), public.hr_today(), now(), p_lat, p_lng, p_accuracy,
          public.hr_client_ip(), left(coalesce(p_user_agent,''), 300), 'present')
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

-- تسجيل انصراف v2: يقفل أحدث جلسة مفتوحة (ترتيب بوقت الحضور لا التاريخ فقط).
create or replace function public.hr_check_out(
  p_lat double precision, p_lng double precision, p_accuracy double precision, p_user_agent text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_rec uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  v_emp := public.hr_ensure_employee_for(auth.uid());
  -- نفس قفل الموظف المستخدم في hr_check_in — يمنع تسابق حضور/انصراف متزامنين.
  perform pg_advisory_xact_lock(hashtext('hr_att_' || v_emp::text)::bigint);
  select id into v_rec from public.hr_attendance_records
   where employee_id = v_emp
     and check_in_at is not null and check_out_at is null
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

-- ════════ 2) حقول المهام الميدانية v2 ═════════════════════════════════════════
alter table public.hr_field_tasks add column if not exists client_name          text;
alter table public.hr_field_tasks add column if not exists project_name         text;
alter table public.hr_field_tasks add column if not exists task_type            text not null default 'other';
alter table public.hr_field_tasks add column if not exists maps_url             text;
alter table public.hr_field_tasks add column if not exists city                 text;
alter table public.hr_field_tasks add column if not exists execution_notes      text;
alter table public.hr_field_tasks add column if not exists special_requirements text;
alter table public.hr_field_tasks add column if not exists equipment_needed     text;   -- نصي فقط — لا مساس بنظام العهدة
alter table public.hr_field_tasks add column if not exists priority             text not null default 'normal';
alter table public.hr_field_tasks drop constraint if exists hr_field_tasks_task_type_check;
alter table public.hr_field_tasks add constraint hr_field_tasks_task_type_check
  check (task_type in ('photo','video','drone','live_stream','editing','delivery','meeting','other'));
alter table public.hr_field_tasks drop constraint if exists hr_field_tasks_priority_check;
alter table public.hr_field_tasks add constraint hr_field_tasks_priority_check
  check (priority in ('low','normal','high','urgent'));

-- إنشاء مهمة v2 (توقيع جديد بـ 15 معاملًا. توقيع v1 يبقى كغلاف توافق أدناه —
-- كود الإنتاج الحالي على main ما زال يستدعيه حتى يُدمج هذا الفرع).
create or replace function public.hr_admin_create_field_task(
  p_title text, p_description text, p_location text, p_maps_url text, p_city text,
  p_client_name text, p_project_name text, p_task_type text, p_priority text,
  p_equipment text, p_requirements text, p_exec_notes text,
  p_expected_start timestamptz, p_expected_end timestamptz, p_assignees uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_task uuid; v_emp uuid; u uuid; v_count int := 0;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_title),''), null) is null then raise exception 'title_required'; end if;
  if p_assignees is null or array_length(p_assignees, 1) is null then raise exception 'assignees_required'; end if;
  if p_task_type is not null and p_task_type not in ('photo','video','drone','live_stream','editing','delivery','meeting','other')
    then raise exception 'invalid_task_type'; end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent')
    then raise exception 'invalid_priority'; end if;
  if p_expected_end is not null and p_expected_start is not null and p_expected_end < p_expected_start
    then raise exception 'invalid_time_range'; end if;

  insert into public.hr_field_tasks
    (title, description, location_name, maps_url, city, client_name, project_name,
     task_type, priority, equipment_needed, special_requirements, execution_notes,
     expected_start_at, expected_end_at, status, created_by)
  values
    (trim(p_title), nullif(trim(coalesce(p_description,'')),''), nullif(trim(coalesce(p_location,'')),''),
     nullif(trim(coalesce(p_maps_url,'')),''), nullif(trim(coalesce(p_city,'')),''),
     nullif(trim(coalesce(p_client_name,'')),''), nullif(trim(coalesce(p_project_name,'')),''),
     coalesce(nullif(trim(p_task_type),''),'other'), coalesce(nullif(trim(p_priority),''),'normal'),
     nullif(trim(coalesce(p_equipment,'')),''), nullif(trim(coalesce(p_requirements,'')),''),
     nullif(trim(coalesce(p_exec_notes,'')),''), p_expected_start, p_expected_end, 'assigned', auth.uid())
  returning id into v_task;

  foreach u in array p_assignees loop
    if not exists (select 1 from public.profiles
                    where id = u and account_status = 'active'
                      and (staff_role is not null or account_type = 'admin'))
      then raise exception 'assignee_not_staff'; end if;
    v_emp := public.hr_ensure_employee_for(u);
    insert into public.hr_field_task_assignees (task_id, employee_id, user_id)
    values (v_task, v_emp, u)
    on conflict (task_id, user_id) do nothing;
    if not found then continue; end if;
    perform public.hr_notify(u, 'hr_task_new', v_task,
      'مهمة ميدانية جديدة: ' || trim(p_title)
        || coalesce(' — ' || nullif(trim(p_client_name),''), '')
        || coalesce(' — ' || nullif(trim(p_location),''), ''),
      'New field task: ' || trim(p_title) || coalesce(' — ' || nullif(trim(p_location),''), ''));
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, created_by)
    values (v_emp, u, 'task_assigned', 'إسناد مهمة: ' || trim(p_title), auth.uid());
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'assignees_required'; end if;

  return jsonb_build_object('ok', true, 'id', v_task, 'assignees', v_count);
end; $$;
revoke execute on function public.hr_admin_create_field_task(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid[]) from public, anon;
grant  execute on function public.hr_admin_create_field_task(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid[]) to authenticated;

-- توافق خلفي: توقيع v1 (6 معاملات) يفوّض إلى v2 بقيم افتراضية — حتى لا يتعطل
-- إنشاء المهام من كود الإنتاج المنشور قبل دمج هذا الفرع. PostgREST يفرّق بين
-- التوقيعين بأسماء المعاملات المرسلة، فلا التباس. (يمكن إسقاطه في patch لاحق بعد الدمج.)
create or replace function public.hr_admin_create_field_task(
  p_title text, p_description text, p_location text,
  p_expected_start timestamptz, p_expected_end timestamptz, p_assignees uuid[]
) returns jsonb
language sql security definer set search_path = public as $$
  select public.hr_admin_create_field_task(
    p_title, p_description, p_location, null, null, null, null, 'other', 'normal',
    null, null, null, p_expected_start, p_expected_end, p_assignees);
$$;
revoke execute on function public.hr_admin_create_field_task(text,text,text,timestamptz,timestamptz,uuid[]) from public, anon;
grant  execute on function public.hr_admin_create_field_task(text,text,text,timestamptz,timestamptz,uuid[]) to authenticated;

-- تعديل مهمة (أدمن) — ما دامت غير مغلقة؛ يُشعر المسندين (نوع hr_task_new القائم).
-- النموذج يرسل كل الحقول مملوءة بقيمها الحالية، فتُعامل كقيم نهائية:
-- مسح حقل في النموذج = مسحه من القاعدة (لا coalesce إلا للعنوان والنوع والأولوية).
create or replace function public.hr_admin_update_field_task(
  p_task uuid, p_title text, p_description text, p_location text, p_maps_url text,
  p_city text, p_client_name text, p_project_name text, p_task_type text, p_priority text,
  p_equipment text, p_requirements text, p_exec_notes text,
  p_expected_start timestamptz, p_expected_end timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare t record; a record; v_title text;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select * into t from public.hr_field_tasks
   where id = p_task and not is_deleted and status in ('draft','assigned','in_progress');
  if not found then raise exception 'task_not_editable'; end if;
  v_title := coalesce(nullif(trim(p_title),''), t.title);
  if p_task_type is not null and p_task_type not in ('photo','video','drone','live_stream','editing','delivery','meeting','other')
    then raise exception 'invalid_task_type'; end if;
  if p_priority is not null and p_priority not in ('low','normal','high','urgent')
    then raise exception 'invalid_priority'; end if;
  if p_expected_end is not null and p_expected_start is not null and p_expected_end < p_expected_start
    then raise exception 'invalid_time_range'; end if;

  update public.hr_field_tasks set
    title = v_title,
    description = nullif(trim(coalesce(p_description,'')),''),
    location_name = nullif(trim(coalesce(p_location,'')),''),
    maps_url = nullif(trim(coalesce(p_maps_url,'')),''),
    city = nullif(trim(coalesce(p_city,'')),''),
    client_name = nullif(trim(coalesce(p_client_name,'')),''),
    project_name = nullif(trim(coalesce(p_project_name,'')),''),
    task_type = coalesce(nullif(trim(p_task_type),''), task_type),
    priority = coalesce(nullif(trim(p_priority),''), priority),
    equipment_needed = nullif(trim(coalesce(p_equipment,'')),''),
    special_requirements = nullif(trim(coalesce(p_requirements,'')),''),
    execution_notes = nullif(trim(coalesce(p_exec_notes,'')),''),
    expected_start_at = p_expected_start,
    expected_end_at = p_expected_end,
    updated_at = now()
  where id = p_task;

  for a in select user_id, employee_id from public.hr_field_task_assignees
            where task_id = p_task and status in ('assigned','in_progress') loop
    perform public.hr_notify(a.user_id, 'hr_task_new', p_task,
      'تحديث على مهمتك: ' || v_title || ' — راجع التفاصيل',
      'Your task was updated: ' || v_title);
  end loop;
  return true;
end; $$;
revoke execute on function public.hr_admin_update_field_task(uuid,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) from public, anon;
grant  execute on function public.hr_admin_update_field_task(uuid,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) to authenticated;

-- ════════ 3) صورة إلزامية عند إنهاء المهمة ════════════════════════════════════
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
  -- صورة واحدة على الأقل إلزامية لإرسال المهمة للاعتماد.
  if jsonb_typeof(coalesce(p_photos,'[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_photos,'[]'::jsonb)) < 1
    then raise exception 'completion_photo_required'; end if;

  update public.hr_field_task_assignees set
    status = 'submitted', ended_at = now(),
    end_lat = p_lat, end_lng = p_lng, end_accuracy = p_accuracy,
    end_ip = public.hr_client_ip(),
    employee_note = nullif(trim(coalesce(p_note,'')),''), updated_at = now()
  where id = a.id;

  for ph in select value #>> '{}' from jsonb_array_elements(p_photos) loop
    if ph is null or ph not like (auth.uid()::text || '/%') then raise exception 'invalid_photo_path'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-files' and o.name = ph)
      then raise exception 'photo_not_uploaded'; end if;
    insert into public.hr_attachments (task_id, employee_id, file_path, file_type, uploaded_by)
    values (p_task, a.employee_id, ph, 'image', auth.uid());
  end loop;

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

-- ════════ 4) إعدادات HR: طلبات الإجازة مخفية افتراضيًا ═══════════════════════
create table if not exists public.hr_settings (
  id                               int primary key default 1 check (id = 1),
  employee_leave_requests_enabled  boolean not null default false,
  updated_by                       uuid references auth.users(id),
  updated_at                       timestamptz not null default now()
);
insert into public.hr_settings (id) values (1) on conflict (id) do nothing;
alter table public.hr_settings enable row level security;
-- لا سياسات قراءة على الجدول — القراءة عبر hr_get_settings فقط.

create or replace function public.hr_get_settings() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into r from public.hr_settings where id = 1;
  return jsonb_build_object('employee_leave_requests_enabled', coalesce(r.employee_leave_requests_enabled, false));
end; $$;
revoke execute on function public.hr_get_settings() from public, anon;
grant  execute on function public.hr_get_settings() to authenticated;

create or replace function public.hr_admin_update_settings(p_leave_enabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if p_leave_enabled is null then raise exception 'leave_enabled_required'; end if;
  update public.hr_settings set
    employee_leave_requests_enabled = p_leave_enabled,
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
  select * into r from public.hr_settings where id = 1;
  -- توثيق + إشعار مجموعة الإدارة بالقيمة المخزنة فعليًا (نوع hr_note_new القائم).
  perform public.hr_notify_admins('hr_note_new', null,
    case when r.employee_leave_requests_enabled then 'تحديث إعدادات HR: تفعيل طلبات الإجازة/الإذن للموظفين'
         else 'تحديث إعدادات HR: إيقاف طلبات الإجازة/الإذن للموظفين' end,
    case when r.employee_leave_requests_enabled then 'HR settings: employee leave requests ENABLED'
         else 'HR settings: employee leave requests DISABLED' end);
  return jsonb_build_object('ok', true, 'employee_leave_requests_enabled', r.employee_leave_requests_enabled);
end; $$;
revoke execute on function public.hr_admin_update_settings(boolean) from public, anon;
grant  execute on function public.hr_admin_update_settings(boolean) to authenticated;

-- حارس الإرسال: مرفوض عندما تكون الميزة موقوفة.
create or replace function public.hr_submit_leave_request(
  p_type text, p_start date, p_end date, p_start_time time, p_end_time time,
  p_reason text, p_attachment text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_id uuid; v_name text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if not coalesce((select employee_leave_requests_enabled from public.hr_settings where id = 1), false)
    then raise exception 'leave_requests_disabled'; end if;
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

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) قيد الصف الواحد أُسقط + الفهرس الجديد:
select conname from pg_constraint where conrelid='public.hr_attendance_records'::regclass and contype='u';
--    (يجب ألا يظهر hr_attendance_records_employee_id_work_date_key)
-- 2) أعمدة المهام الجديدة:
select column_name from information_schema.columns
 where table_name='hr_field_tasks'
   and column_name in ('client_name','project_name','task_type','maps_url','city',
                       'execution_notes','special_requirements','equipment_needed','priority') order by 1;
-- 3) hr_settings + القيمة الافتراضية false:
select employee_leave_requests_enabled from public.hr_settings where id = 1;
-- 4) الدوال الجديدة/المعدّلة:
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname in ('hr_check_in','hr_check_out','hr_admin_create_field_task',
                   'hr_admin_update_field_task','hr_complete_my_task',
                   'hr_get_settings','hr_admin_update_settings','hr_submit_leave_request') order by 1;
-- 5) اختبار جلستين: سجّل حضورًا → انصرافًا → حضورًا ثانيًا (يجب أن ينجح) من الواجهة.
-- ════════════════════════════════════════════════════════════════════════════
