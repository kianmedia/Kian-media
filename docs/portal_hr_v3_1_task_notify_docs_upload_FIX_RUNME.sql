-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HR v3.1 FIX: إشعارات المهام (بوابة الإدارة) + رفع وثائق خاصة
-- شغّله مرة واحدة في Supabase SQL Editor بعد v1 + v2 + v3 + v3.1
-- (idempotent — آمن للإعادة).
--
-- يعالج مشكلتين ظهرتا في اختبار Preview:
--   1) إنشاء/تعديل المهام كان يُنشئ إشعار بوابة للموظف المسند فقط، ولا يُشعر
--      الإدارة في البوابة إطلاقًا (hr_admin_create_field_task/update لم تستدعِ
--      hr_notify_admins). الإصلاح: إعادة تعريف الدالتين لتُشعرا الإدارة أيضًا
--      (نوع hr_task_new المسموح — لا توسعة لقيد CHECK). إيميل المهام يُرسل من
--      طبقة الـ route (بريد البوابة الحالي) وقد أُثري محتواه وسجلاته في الكود.
--   2) وثائق الموظف الحساسة (هوية/عقد) تحتاج رفع ملف فعلي خاص — لا روابط عامة.
--      الإصلاح: bucket خاص hr-docs (صور + PDF، 10MB) بسياسات محكمة:
--        • الرفع: الإدارة فقط (can_manage_hr).
--        • القراءة (signed URL): الإدارة كل شيء؛ الموظف فقط ملفات وثائقه التي
--          visibility='employee_visible' وغير محذوفة. لا update/delete (ثابتة).
--      + أعمدة file_path/file_name/file_mime_type/file_size_bytes/uploaded_by/
--        uploaded_at على hr_employee_documents + RPC ربط الملف بالوثيقة.
--
-- لا يمس العهدة/التأجير/الفوترة/Zoho/Apps Script/واتساب/n8n/مركز الفرص.
-- لا يوسّع notifications_type_check. كل الدوال SECURITY DEFINER + search_path.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) إشعار الإدارة في البوابة عند إنشاء/تعديل المهام ══════════════════
-- إعادة تعريف دالة الإنشاء (15 معاملًا) — نفس جسم v2 + إشعار الإدارة في النهاية.
create or replace function public.hr_admin_create_field_task(
  p_title text, p_description text, p_location text, p_maps_url text, p_city text,
  p_client_name text, p_project_name text, p_task_type text, p_priority text,
  p_equipment text, p_requirements text, p_exec_notes text,
  p_expected_start timestamptz, p_expected_end timestamptz, p_assignees uuid[]
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_task uuid; v_emp uuid; u uuid; v_count int := 0; v_names text := '';
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
    v_names := v_names || case when v_names = '' then '' else '، ' end
      || coalesce((select nullif(trim(full_name),'') from public.hr_employee_profiles where id = v_emp), '');
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then raise exception 'assignees_required'; end if;

  -- إشعار بوابة لمجموعة الإدارة (نوع hr_task_new المسموح — لا توسعة للقيد).
  perform public.hr_notify_admins('hr_task_new', v_task,
    'مهمة ميدانية جديدة: ' || trim(p_title)
      || coalesce(' — عميل: ' || nullif(trim(p_client_name),''), '')
      || ' — أُسندت إلى: ' || coalesce(nullif(v_names,''), '—'),
    'New field task created: ' || trim(p_title) || ' — assigned to ' || v_count || ' staff');
  return jsonb_build_object('ok', true, 'id', v_task, 'assignees', v_count);
end; $$;
revoke execute on function public.hr_admin_create_field_task(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid[]) from public, anon;
grant  execute on function public.hr_admin_create_field_task(text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid[]) to authenticated;

-- إعادة تعريف دالة التعديل — نفس جسم v2 + إشعار الإدارة في البوابة.
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
  -- إشعار بوابة لمجموعة الإدارة.
  perform public.hr_notify_admins('hr_task_new', p_task,
    'تحديث مهمة ميدانية: ' || v_title, 'Field task updated: ' || v_title);
  return true;
end; $$;
revoke execute on function public.hr_admin_update_field_task(uuid,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) from public, anon;
grant  execute on function public.hr_admin_update_field_task(uuid,text,text,text,text,text,text,text,text,text,text,text,text,timestamptz,timestamptz) to authenticated;

-- ════════ 2) وثائق الموظف: أعمدة الملف + ربط الملف ═══════════════════════════
alter table public.hr_employee_documents add column if not exists file_path       text;
alter table public.hr_employee_documents add column if not exists file_name       text;
alter table public.hr_employee_documents add column if not exists file_mime_type  text;
alter table public.hr_employee_documents add column if not exists file_size_bytes bigint;
alter table public.hr_employee_documents add column if not exists uploaded_by     uuid references auth.users(id);
alter table public.hr_employee_documents add column if not exists uploaded_at     timestamptz;

-- إعادة تعريف upsert الوثيقة: حدث Timeline للوثيقة لم يعد ظاهرًا للموظف إطلاقًا
-- (visible_to_employee=false دائمًا). السبب: خفض وثيقة من employee_visible إلى
-- admin_only كان يُبقي حدثًا قديمًا ظاهرًا يكشف عنوان الوثيقة. الموظف يرى وثائقه
-- الظاهرة في قسم «وثائقي» (محكوم بـ RLS ويختفي فورًا عند الخفض) — لا حاجة لحدث ظاهر.
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

  -- حدث داخلي غير ظاهر للموظف (منع تسريب العنوان عند خفض visibility لاحقًا).
  insert into public.hr_employee_events (employee_id, user_id, event_type, title, visible_to_employee, created_by)
  values (p_employee, e.user_id, 'document_saved', 'حفظ وثيقة: ' || trim(p_title), false, auth.uid());
  perform public.hr_notify_admins('hr_note_new', v_id,
    'وثيقة موظف: ' || e.full_name || ' — ' || trim(p_title),
    'Employee document: ' || e.full_name || ' — ' || trim(p_title));
  -- إشعار الموظف فقط للوثيقة الظاهرة له (إشعار لحظي فقط — لا يبقى في Timeline الظاهر).
  if e.user_id is not null and coalesce(nullif(trim(p_visibility),''),'admin_only') = 'employee_visible' then
    perform public.hr_notify(e.user_id, 'hr_note_new', v_id,
      'أُضيفت وثيقة إلى ملفك: ' || trim(p_title), 'A document was added to your file: ' || trim(p_title));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'created', v_new);
end; $$;
revoke execute on function public.hr_admin_upsert_employee_document(uuid,uuid,text,text,text,date,date,text,text,text) from public, anon;
grant  execute on function public.hr_admin_upsert_employee_document(uuid,uuid,text,text,text,date,date,text,text,text) to authenticated;

-- ربط ملف مرفوع (في bucket hr-docs) بوثيقة موظف — الإدارة فقط. يتحقق من أن
-- المسار يبدأ بمعرّف الموظف (تنظيم owner-first) وأن الملف موجود فعلًا.
create or replace function public.hr_admin_attach_document_file(
  p_id uuid, p_file_path text, p_file_name text, p_mime text, p_size bigint
) returns boolean
language plpgsql security definer set search_path = public as $$
declare d record;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if coalesce(nullif(trim(p_file_path),''), null) is null then raise exception 'file_path_required'; end if;
  if p_mime is not null and p_mime not in ('image/jpeg','image/png','image/webp','application/pdf')
    then raise exception 'invalid_file_type'; end if;
  if p_size is not null and p_size > 10485760 then raise exception 'file_too_large'; end if;
  select * into d from public.hr_employee_documents where id = p_id and is_deleted = false;
  if not found then raise exception 'document_not_found'; end if;
  -- المسار يجب أن يقع تحت مجلد الموظف صاحب الوثيقة (منع ربط ملف موظف آخر).
  if p_file_path not like (d.employee_id::text || '/%') then raise exception 'invalid_file_path'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'hr-docs' and o.name = p_file_path)
    then raise exception 'file_not_uploaded'; end if;

  update public.hr_employee_documents set
    file_path = p_file_path, file_name = nullif(trim(coalesce(p_file_name,'')),''),
    file_mime_type = nullif(trim(coalesce(p_mime,'')),''), file_size_bytes = p_size,
    uploaded_by = auth.uid(), uploaded_at = now(), updated_at = now()
  where id = p_id;
  return true;
end; $$;
revoke execute on function public.hr_admin_attach_document_file(uuid,text,text,text,bigint) from public, anon;
grant  execute on function public.hr_admin_attach_document_file(uuid,text,text,text,bigint) to authenticated;

-- ════════ 3) Storage — bucket خاص hr-docs (صور + PDF، خاص، 10MB) ══════════════
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-docs','hr-docs', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf'];

-- الرفع: الإدارة فقط.
drop policy if exists "hr docs upload" on storage.objects;
create policy "hr docs upload" on storage.objects for insert to authenticated
with check (bucket_id = 'hr-docs' and public.can_manage_hr());

-- القراءة (signed URL): الإدارة كل شيء؛ الموظف فقط ملفات وثائقه الظاهرة له وغير المحذوفة.
-- (سياسة RLS على hr_employee_documents تحصر الموظف أصلًا في صفوفه الظاهرة، والشرط
--  الصريح يضمن ذلك حتى لو تغيّرت السياسة لاحقًا.)
drop policy if exists "hr docs read" on storage.objects;
create policy "hr docs read" on storage.objects for select to authenticated
using (
  bucket_id = 'hr-docs'
  and (
    public.can_manage_hr()
    or exists (
      select 1 from public.hr_employee_documents d
       where d.file_path = storage.objects.name
         and d.user_id = auth.uid()
         and d.visibility = 'employee_visible'
         and d.is_deleted = false)
  )
);
-- لا سياسات update/delete → الملفات ثابتة (immutable).

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) الدالتان تُشعران الإدارة الآن (يجب أن تحتويا hr_notify_admins):
select proname,
       (pg_get_functiondef(oid) ilike '%hr_notify_admins%') as notifies_admins
  from pg_proc
 where proname in ('hr_admin_create_field_task','hr_admin_update_field_task')
   and pronargs >= 6 order by proname, pronargs;
-- 2) أعمدة ملف الوثيقة:
select column_name from information_schema.columns
 where table_name = 'hr_employee_documents'
   and column_name in ('file_path','file_name','file_mime_type','file_size_bytes','uploaded_by','uploaded_at')
 order by 1;
-- 3) bucket خاص + أنواع مسموحة:
select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'hr-docs';
-- 4) سياسات hr-docs:
select policyname, cmd from pg_policies where tablename = 'objects' and policyname like 'hr docs%';
-- 5) دالة ربط الملف:
select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname = 'hr_admin_attach_document_file';
-- ════════════════════════════════════════════════════════════════════════════
