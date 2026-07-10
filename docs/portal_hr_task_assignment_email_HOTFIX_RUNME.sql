-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HOTFIX عاجل: بريد إسناد المهمة للموظف (من auth.users لا profiles)
-- شغّله مرة واحدة في Supabase SQL Editor بعد كل ما سبق (idempotent — آمن للإعادة).
--
-- السبب الجذري: بريد موظفي الميدان مخزّن في auth.users.email، وليس بالضرورة في
-- public.profiles.email. النسخة السابقة من hr_task_assignment_recipients كانت
-- تقرأ profiles.email فقط ⇒ employee_email_count = 0 ⇒ لا يصل بريد للموظف، بينما
-- الإدارة (لها بريد في profiles) تصلها الرسائل. الإصلاح: قراءة البريد بالأولوية
-- coalesce(auth.users.email, profiles.email) لكل جمهور — عبر SECURITY DEFINER
-- (الذي يملك صلاحية قراءة auth.users)، ولا يصل service key أو auth.users للمتصفح.
--
-- يعيد استخدام الأنواع المسموحة. لا يمس العهدة/الفوترة/Zoho/Apps Script/واتساب.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- مستلمو إشعار الإسناد (موظفون/إدارة/مشرفون) مع البريد من auth.users أولًا.
create or replace function public.hr_task_assignment_recipients(p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp jsonb; v_admin jsonb; v_sup jsonb;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;

  -- الموظفون المسندون — البريد من auth.users أولًا ثم profiles.
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'user_id', a.user_id,
           'email', coalesce(au.email, p.email),
           'full_name', coalesce(p.full_name, au.email))), '[]'::jsonb)
    into v_emp
    from public.hr_field_task_assignees a
    left join auth.users au on au.id = a.user_id
    left join public.profiles p on p.id = a.user_id
   where a.task_id = p_task;

  -- الإدارة (owner/super_admin/manager/hr النشطون).
  select coalesce(jsonb_agg(distinct jsonb_build_object(
           'user_id', p.id,
           'email', coalesce(au.email, p.email),
           'full_name', coalesce(p.full_name, au.email))), '[]'::jsonb)
    into v_admin
    from public.profiles p
    left join auth.users au on au.id = p.id
   where p.account_status = 'active'
     and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager','hr'));

  -- المشرفون الميدانيون لمسندي المهمة (إن وُجد جدول الروابط).
  if to_regclass('public.hr_employee_supervisor_links') is not null then
    select coalesce(jsonb_agg(distinct jsonb_build_object(
             'user_id', s.user_id,
             'email', coalesce(au.email, sp.email),
             'full_name', coalesce(sp.full_name, au.email))), '[]'::jsonb)
      into v_sup
      from public.hr_field_task_assignees a
      join public.hr_employee_supervisor_links l on l.employee_id = a.employee_id and l.is_active = true
      join public.hr_employee_profiles s on s.id = l.supervisor_employee_id
      left join auth.users au on au.id = s.user_id
      left join public.profiles sp on sp.id = s.user_id
     where a.task_id = p_task and s.is_deleted = false and s.user_id is not null;
  else
    v_sup := '[]'::jsonb;
  end if;

  return jsonb_build_object('employees', v_emp, 'admins', v_admin, 'supervisors', coalesce(v_sup, '[]'::jsonb));
end; $$;
revoke execute on function public.hr_task_assignment_recipients(uuid) from public, anon;
grant  execute on function public.hr_task_assignment_recipients(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) الدالة موجودة:
select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname = 'hr_task_assignment_recipients';
-- 2) تشخيص آمن للموظف الحالي (استبدل UUID المهمة) — يُظهر بوجود البريد دون كشفه:
--    select jsonb_array_length((public.hr_task_assignment_recipients('TASK_UUID')->'employees')) as employee_count,
--           (select bool_or((e->>'email') is not null) from jsonb_array_elements(public.hr_task_assignment_recipients('TASK_UUID')->'employees') e) as any_employee_has_email;
-- 3) تشخيص بريد موظف بعينه دون كشف البريد (استبدل USER_UUID):
--    select (select email is not null from auth.users where id = 'USER_UUID') as has_auth_email,
--           (select email is not null from public.profiles where id = 'USER_UUID') as has_profile_email;
-- ════════════════════════════════════════════════════════════════════════════
