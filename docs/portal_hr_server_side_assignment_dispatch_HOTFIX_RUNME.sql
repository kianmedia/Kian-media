-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HOTFIX: إشعار بوابة موحّد لإسناد المهمة (موظف/مشرف/إدارة)
-- شغّله مرة واحدة في Supabase SQL Editor بعد كل ما سبق (idempotent — آمن للإعادة).
--
-- يدعم زر "إعادة إرسال إشعار الإسناد": ينشئ إشعارات بوابة للجميع دون إعادة إنشاء
-- المهمة. البريد يُرسل من الخادم (lib/server/hrTaskDispatch) بلا حاجة لهذا الملف.
-- الإنشاء العادي يُنشئ إشعارات البوابة للموظف والإدارة عبر RPC الإنشاء وللمشرف عبر
-- hr_notify_task_supervisors — فهذا الملف مطلوب أساسًا لزر إعادة الإرسال.
--
-- يعيد استخدام hr_task_new المسموح (لا توسعة CHECK). SECURITY DEFINER + grants.
-- to_regclass يحمي غياب جدول روابط الإشراف. لا يمس العهدة/الفوترة/Zoho/Apps Script.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.hr_notify_task_assignment(p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v_title text; v_client text; v_emp int := 0; v_sup int := 0;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  select title, client_name into v_title, v_client from public.hr_field_tasks where id = p_task and is_deleted = false;
  if v_title is null then raise exception 'task_not_found'; end if;

  -- الموظفون المسندون.
  for a in select user_id, employee_id from public.hr_field_task_assignees where task_id = p_task loop
    perform public.hr_notify(a.user_id, 'hr_task_new', p_task,
      'مهمة ميدانية مُسندة إليك: ' || v_title || coalesce(' — عميل: ' || nullif(trim(coalesce(v_client,'')),''), ''),
      'A field task is assigned to you: ' || v_title);
    v_emp := v_emp + 1;
  end loop;

  -- الإدارة.
  perform public.hr_notify_admins('hr_task_new', p_task,
    'إشعار إسناد مهمة (إعادة إرسال): ' || v_title, 'Task assignment (resend): ' || v_title);

  -- المشرفون الميدانيون (إن وُجد جدول الروابط).
  if to_regclass('public.hr_employee_supervisor_links') is not null then
    for a in
      select distinct s.user_id
        from public.hr_field_task_assignees ta
        join public.hr_employee_supervisor_links l on l.employee_id = ta.employee_id and l.is_active = true
        join public.hr_employee_profiles s on s.id = l.supervisor_employee_id
       where ta.task_id = p_task and s.is_deleted = false and s.user_id is not null
    loop
      perform public.hr_notify(a.user_id, 'hr_task_new', p_task,
        'مهمة ميدانية مُسندة لأحد أفراد فريقك: ' || v_title,
        'A field task assigned to a member of your team: ' || v_title);
      v_sup := v_sup + 1;
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'employees', v_emp, 'supervisors', v_sup);
end; $$;
revoke execute on function public.hr_notify_task_assignment(uuid) from public, anon;
grant  execute on function public.hr_notify_task_assignment(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) الدالة موجودة:
select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname = 'hr_notify_task_assignment';
-- 2) اختبار (كأدمن — استبدل UUID المهمة): يجب أن يُرجع أعداد الموظفين/المشرفين:
--    select public.hr_notify_task_assignment('TASK_UUID');
-- ════════════════════════════════════════════════════════════════════════════
