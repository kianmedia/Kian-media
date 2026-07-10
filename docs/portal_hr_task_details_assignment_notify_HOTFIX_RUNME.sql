-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — HOTFIX عاجل: تفاصيل مهام الموظف + إشعارات الإسناد (موظف/إدارة/مشرف)
-- شغّله مرة واحدة في Supabase SQL Editor بعد كل ما سبق (idempotent — آمن للإعادة).
--
-- يعالج عطلين مؤكدين على Production:
--   1) الموظف يرى بطاقة المهمة وحالتها وأزرارها لكن لا يرى التفاصيل (العنوان/
--      الوصف/العميل/الموقع/الوقت/المتطلبات). السبب: الواجهة تقرأ جدول hr_field_tasks
--      مباشرة عبر PostgREST؛ إن لم يُرجِع صف المهمة (لأي سبب في طبقة القراءة) تظهر
--      حالة الإسناد وأزراره (من صف الإسناد) دون تفاصيل المهمة. الإصلاح الجذري:
--      دالة SECURITY DEFINER مضمونة hr_get_my_field_tasks تُعيد مهام الموظف
--      المسندة له فقط + كل التفاصيل (بلا ملاحظات إدارية داخلية).
--   2) إشعار/إيميل الإسناد لا يصل للموظف. المطلوب وصوله للموظف والإدارة والمشرف
--      الميداني. الإصلاح: (أ) hr_notify_task_supervisors ينشئ إشعار بوابة للمشرفين،
--      (ب) hr_task_assignment_recipients يحلّ المستلمين الثلاثة (مع البريد) ليُرسل
--      الخادم ثلاث رسائل مفصولة الجمهور بلا تكرار.
--
-- الموظف يرى مهامه فقط · العميل ممنوع · لا توسعة وصول عامة · لا تغيير لبيانات المهام.
-- يعيد استخدام hr_task_new المسموح (لا توسعة CHECK). لا يمس العهدة/الفوترة/Zoho/
-- Apps Script/واتساب. كل الدوال SECURITY DEFINER + set search_path = public + grants.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) تفاصيل مهام الموظف — دالة مضمونة (يحل عطل التفاصيل) ═══════════════
-- تُعيد { assignments: [...], tasks: [...] } لصاحب الجلسة فقط. tasks تشمل كل حقول
-- التفاصيل المناسبة للموظف (لا ملاحظات HR داخلية — تلك في جداول أخرى). assignments
-- تشمل صف الإسناد (بما فيه admin_note الظاهر للموظف) بلا عناوين IP.
create or replace function public.hr_get_my_field_tasks() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_assignments jsonb; v_tasks jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;

  select coalesce(jsonb_agg((to_jsonb(a) - 'start_ip' - 'end_ip') order by a.created_at desc), '[]'::jsonb)
    into v_assignments
    from public.hr_field_task_assignees a
   where a.user_id = auth.uid();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
    into v_tasks
    from public.hr_field_tasks t
   where t.is_deleted = false
     and exists (select 1 from public.hr_field_task_assignees a
                  where a.task_id = t.id and a.user_id = auth.uid());

  return jsonb_build_object('assignments', v_assignments, 'tasks', v_tasks);
end; $$;
revoke execute on function public.hr_get_my_field_tasks() from public, anon;
grant  execute on function public.hr_get_my_field_tasks() to authenticated;

-- ════════ 2) إشعار بوابة للمشرفين الميدانيين عند الإسناد ══════════════════════
-- يُستدعى بعد إنشاء/تعديل المهمة (إشعارات الموظف والإدارة تُنشأ في RPC الإنشاء).
-- إن لم يكن جدول روابط الإشراف موجودًا (لم تُشغّل v3.1 ops-polish) يعيد 0 بلا خطأ.
create or replace function public.hr_notify_task_supervisors(p_task uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r record; v_title text; v_n int := 0;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
  if to_regclass('public.hr_employee_supervisor_links') is null then return 0; end if;
  select title into v_title from public.hr_field_tasks where id = p_task;
  for r in
    select distinct s.user_id
      from public.hr_field_task_assignees a
      join public.hr_employee_supervisor_links l on l.employee_id = a.employee_id and l.is_active = true
      join public.hr_employee_profiles s on s.id = l.supervisor_employee_id
     where a.task_id = p_task and s.is_deleted = false and s.user_id is not null
  loop
    perform public.hr_notify(r.user_id, 'hr_task_new', p_task,
      'مهمة ميدانية جديدة لأحد أفراد فريقك: ' || coalesce(v_title,''),
      'New field task for a member of your team: ' || coalesce(v_title,''));
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $$;
revoke execute on function public.hr_notify_task_supervisors(uuid) from public, anon;
grant  execute on function public.hr_notify_task_supervisors(uuid) to authenticated;

-- ════════ 3) حلّ مستلمي إشعار الإسناد (موظفون/إدارة/مشرفون) مع البريد ═════════
-- يُستدعى من طبقة الـ route (بجلسة الأدمن) لإرسال ثلاث رسائل مفصولة الجمهور.
-- يعيد البريد مباشرة (SECURITY DEFINER) — لا يُكشف إلا لمن يملك can_manage_hr.
create or replace function public.hr_task_assignment_recipients(p_task uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp jsonb; v_admin jsonb; v_sup jsonb;
begin
  if not public.can_manage_hr() then raise exception 'not authorized'; end if;

  select coalesce(jsonb_agg(distinct jsonb_build_object('user_id', p.id, 'email', p.email, 'full_name', p.full_name)), '[]'::jsonb)
    into v_emp
    from public.hr_field_task_assignees a
    join public.profiles p on p.id = a.user_id
   where a.task_id = p_task;

  select coalesce(jsonb_agg(distinct jsonb_build_object('user_id', p.id, 'email', p.email, 'full_name', p.full_name)), '[]'::jsonb)
    into v_admin
    from public.profiles p
   where p.account_status = 'active'
     and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager','hr'));

  if to_regclass('public.hr_employee_supervisor_links') is not null then
    select coalesce(jsonb_agg(distinct jsonb_build_object('user_id', sp.id, 'email', sp.email, 'full_name', sp.full_name)), '[]'::jsonb)
      into v_sup
      from public.hr_field_task_assignees a
      join public.hr_employee_supervisor_links l on l.employee_id = a.employee_id and l.is_active = true
      join public.hr_employee_profiles s on s.id = l.supervisor_employee_id
      join public.profiles sp on sp.id = s.user_id
     where a.task_id = p_task and s.is_deleted = false;
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
-- 1) الدوال الثلاث موجودة:
select proname, pg_get_function_identity_arguments(oid) from pg_proc
 where proname in ('hr_get_my_field_tasks','hr_notify_task_supervisors','hr_task_assignment_recipients')
 order by proname;
-- 2) تفاصيل مهام الموظف (شغّلها كموظف مسند — يجب أن تُرجع assignments + tasks غير فارغة):
--    select public.hr_get_my_field_tasks();
-- 3) مستلمو الإسناد لمهمة (كأدمن — استبدل UUID):
--    select public.hr_task_assignment_recipients('00000000-0000-0000-0000-000000000000');
-- ════════════════════════════════════════════════════════════════════════════
