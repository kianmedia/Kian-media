-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HR v3.1 FIX: أدلة تسليم مرنة (صورة/ملف/رابط) + وضع دليل لكل مهمة
--                            + طلب تعديل من الإدارة
-- شغّله مرة واحدة في Supabase SQL Editor بعد v1 + v2 + v3 + v3.1 + الإصلاح السابق
-- (idempotent — آمن للإعادة).
--
-- آمن للنشر ومتوافق رجعيًا:
--   • hr_complete_my_task يبقى بنفس التوقيع (6 معاملات) — لا يتعطل تسليم المهام
--     الحالي أثناء نافذة النشر. المهام القديمة (completion_evidence_mode = null)
--     تحتفظ بسلوكها الحالي تمامًا (صورة إلزامية حسب الإعداد العام).
--   • أدلة الملف/الرابط تُضاف عبر دوال منفصلة جديدة (hr_add_task_evidence) —
--     إن لم تُشغَّل SQL بعد، يفشل الملف/الرابط بلطف بينما يعمل تسليم الصور كالمعتاد.
--
-- الأوضاع (completion_evidence_mode):
--   photo (صورة ≥1) · file (ملف ≥1) · link (رابط ≥1) · any (أيٌّ منها ≥1) · none.
--   null = السلوك القديم (صورة إلزامية حسب task_completion_photo_required).
--
-- لا يوسّع notifications_type_check (يعيد استخدام hr_task_new/hr_task_submitted).
-- لا يمس العهدة/الفوترة/Zoho/Apps Script/واتساب. كل دالة SECURITY DEFINER + revoke/grant.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) وضع دليل التسليم لكل مهمة ═══════════════════════════════════════
alter table public.hr_field_tasks add column if not exists completion_evidence_mode text;
alter table public.hr_field_tasks drop constraint if exists hr_tasks_evidence_mode_check;
alter table public.hr_field_tasks add constraint hr_tasks_evidence_mode_check
  check (completion_evidence_mode is null
         or completion_evidence_mode in ('photo','file','link','any','none'));

create or replace function public.hr_admin_set_task_evidence_mode(p_task uuid, p_mode text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  -- فارغ/null = "حسب الإعداد العام" (يُخزّن null ويحافظ على السلوك الافتراضي).
  if nullif(trim(coalesce(p_mode,'')),'') is not null and p_mode not in ('photo','file','link','any','none')
    then raise exception 'invalid_evidence_mode'; end if;
  update public.hr_field_tasks set completion_evidence_mode = nullif(trim(coalesce(p_mode,'')),''), updated_at = now()
   where id = p_task and not is_deleted;
  if not found then raise exception 'task_not_found'; end if;
  return true;
end; $$;
revoke execute on function public.hr_admin_set_task_evidence_mode(uuid,text) from public, anon;
grant  execute on function public.hr_admin_set_task_evidence_mode(uuid,text) to authenticated;

-- ════════ 2) توسيع hr-files لقبول PDF (أدلة ملفات التسليم) ════════════════════
-- نفس الـ bucket الخاص (owner-first + قراءة الإدارة/المالك) — نضيف نوع PDF فقط.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-files','hr-files', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

-- ════════ 3) جدول أدلة التسليم (ملف/رابط) ═════════════════════════════════════
-- الصور تبقى في hr_attachments عبر مسار الإنهاء؛ الملفات/الروابط هنا.
create table if not exists public.hr_task_evidence (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.hr_field_tasks(id) on delete cascade,
  employee_id    uuid not null references public.hr_employee_profiles(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  kind           text not null check (kind in ('file','link')),
  file_path      text,          -- مسار في hr-files (owner-first) — للنوع file
  link_url       text,          -- رابط — للنوع link
  file_name      text,
  file_mime_type text,
  file_size_bytes bigint,
  is_deleted     boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists idx_hr_task_evidence_task on public.hr_task_evidence(task_id) where is_deleted = false;
create index if not exists idx_hr_task_evidence_user on public.hr_task_evidence(user_id, created_at desc);
alter table public.hr_task_evidence enable row level security;
drop policy if exists hr_task_evidence_select on public.hr_task_evidence;
create policy hr_task_evidence_select on public.hr_task_evidence for select
  using (public.can_manage_hr() or user_id = auth.uid());
grant select on public.hr_task_evidence to authenticated;

-- إضافة دليل ملف/رابط للمهمة الجارية للموظف نفسه.
create or replace function public.hr_add_task_evidence(
  p_task uuid, p_kind text, p_file_path text, p_link_url text,
  p_file_name text, p_mime text, p_size bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v_id uuid;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_kind not in ('file','link') then raise exception 'invalid_evidence_kind'; end if;
  select * into a from public.hr_field_task_assignees
   where task_id = p_task and user_id = auth.uid() and status = 'in_progress';
  if not found then raise exception 'assignment_not_in_progress'; end if;

  if p_kind = 'file' then
    if coalesce(nullif(trim(p_file_path),''), null) is null then raise exception 'file_path_required'; end if;
    if p_file_path not like (auth.uid()::text || '/%') then raise exception 'invalid_file_path'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-files' and o.name = p_file_path)
      then raise exception 'file_not_uploaded'; end if;
    if p_mime is not null and p_mime not in ('image/jpeg','image/png','image/webp','application/pdf')
      then raise exception 'invalid_file_type'; end if;
    if p_size is not null and p_size > 10485760 then raise exception 'file_too_large'; end if;
    insert into public.hr_task_evidence (task_id, employee_id, user_id, kind, file_path, file_name, file_mime_type, file_size_bytes)
    values (p_task, a.employee_id, auth.uid(), 'file', p_file_path,
            nullif(trim(coalesce(p_file_name,'')),''), nullif(trim(coalesce(p_mime,'')),''), p_size)
    returning id into v_id;
  else
    if coalesce(nullif(trim(p_link_url),''), null) is null then raise exception 'link_required'; end if;
    if p_link_url !~* '^https?://' then raise exception 'invalid_link'; end if;
    insert into public.hr_task_evidence (task_id, employee_id, user_id, kind, link_url)
    values (p_task, a.employee_id, auth.uid(), 'link', trim(p_link_url))
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
revoke execute on function public.hr_add_task_evidence(uuid,text,text,text,text,text,bigint) from public, anon;
grant  execute on function public.hr_add_task_evidence(uuid,text,text,text,text,text,bigint) to authenticated;

create or replace function public.hr_remove_my_task_evidence(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare e record;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into e from public.hr_task_evidence where id = p_id and user_id = auth.uid() and is_deleted = false;
  if not found then raise exception 'evidence_not_found'; end if;
  if not exists (select 1 from public.hr_field_task_assignees
                  where task_id = e.task_id and user_id = auth.uid() and status = 'in_progress')
    then raise exception 'not_editable'; end if;
  update public.hr_task_evidence set is_deleted = true where id = p_id;
  return true;
end; $$;
revoke execute on function public.hr_remove_my_task_evidence(uuid) from public, anon;
grant  execute on function public.hr_remove_my_task_evidence(uuid) to authenticated;

-- ════════ 4) إعادة تعريف الإنهاء — تحقق مرن حسب الوضع (نفس التوقيع) ═══════════
create or replace function public.hr_complete_my_task(
  p_task uuid, p_lat double precision, p_lng double precision, p_accuracy double precision,
  p_note text default null, p_photos jsonb default '[]'::jsonb
) returns boolean
language plpgsql security definer set search_path = public as $$
declare a record; v_title text; ph text; v_open int; v_photo_required boolean;
  v_mode text; v_photos int; v_files int; v_links int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select * into a from public.hr_field_task_assignees
   where task_id = p_task and user_id = auth.uid() and status = 'in_progress';
  if not found then raise exception 'assignment_not_in_progress'; end if;

  v_photos := case when jsonb_typeof(coalesce(p_photos,'[]'::jsonb)) = 'array'
                   then jsonb_array_length(coalesce(p_photos,'[]'::jsonb)) else 0 end;
  select count(*) filter (where kind = 'file'), count(*) filter (where kind = 'link')
    into v_files, v_links
    from public.hr_task_evidence where task_id = p_task and user_id = auth.uid() and is_deleted = false;

  select completion_evidence_mode into v_mode from public.hr_field_tasks where id = p_task;
  if v_mode is null then
    -- السلوك القديم تمامًا: صورة إلزامية حسب الإعداد العام.
    v_photo_required := coalesce((select task_completion_photo_required from public.hr_settings where id = 1), true);
    if v_photo_required and v_photos < 1 then raise exception 'completion_photo_required'; end if;
  elsif v_mode = 'photo' and v_photos < 1 then raise exception 'completion_photo_required';
  elsif v_mode = 'file' and v_files < 1 then raise exception 'completion_file_required';
  elsif v_mode = 'link' and v_links < 1 then raise exception 'completion_link_required';
  elsif v_mode = 'any' and (v_photos + v_files + v_links) < 1 then raise exception 'completion_evidence_required';
  end if;  -- 'none' ⇒ لا شرط

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

-- ════════ 5) طلب تعديل من الإدارة (يُعيد المهمة للتنفيذ بملاحظة) ══════════════
create or replace function public.hr_admin_request_task_revision(p_task uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare t record; a record; v_n int := 0;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_note),''), null) is null then raise exception 'note_required'; end if;
  select * into t from public.hr_field_tasks
   where id = p_task and not is_deleted and status in ('submitted','in_progress');
  if not found then raise exception 'task_not_revisable'; end if;

  -- أعِد المسندين المسلّمين إلى التنفيذ مع ملاحظة الإدارة.
  for a in select * from public.hr_field_task_assignees
            where task_id = p_task and status in ('submitted','in_progress') loop
    update public.hr_field_task_assignees set
      status = 'in_progress', admin_note = trim(p_note), updated_at = now()
    where id = a.id;
    insert into public.hr_employee_events (employee_id, user_id, event_type, title, description, created_by)
    values (a.employee_id, a.user_id, 'task_revision_requested',
            'طلب تعديل على مهمة: ' || t.title, trim(p_note), auth.uid());
    perform public.hr_notify(a.user_id, 'hr_task_new', p_task,
      'طلب تعديل على مهمتك: ' || t.title || ' — ' || trim(p_note),
      'Revision requested on your task: ' || t.title);
    v_n := v_n + 1;
  end loop;

  update public.hr_field_tasks set status = 'in_progress', updated_at = now() where id = p_task;
  return true;
end; $$;
revoke execute on function public.hr_admin_request_task_revision(uuid,text) from public, anon;
grant  execute on function public.hr_admin_request_task_revision(uuid,text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) عمود وضع الدليل + قيده:
select column_name from information_schema.columns
 where table_name = 'hr_field_tasks' and column_name = 'completion_evidence_mode';
-- 2) hr-files يقبل PDF الآن:
select allowed_mime_types from storage.buckets where id = 'hr-files';
-- 3) جدول الأدلة + سياسته + grant:
select table_name from information_schema.tables where table_name = 'hr_task_evidence';
select policyname from pg_policies where tablename = 'hr_task_evidence';
select grantee, privilege_type from information_schema.table_privileges
 where table_name = 'hr_task_evidence' and grantee = 'authenticated' and privilege_type = 'SELECT';
-- 4) الدوال الجديدة/المعدّلة:
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname in ('hr_admin_set_task_evidence_mode','hr_add_task_evidence','hr_remove_my_task_evidence',
                   'hr_complete_my_task','hr_admin_request_task_revision') order by proname;
-- ════════════════════════════════════════════════════════════════════════════
