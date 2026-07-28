-- ════════════════════════════════════════════════════════════════════════════
-- تراجع إصلاح A — يُعيد `admin_set_staff_role` إلى تعريفها الحيّ قبل الإصلاح
-- ════════════════════════════════════════════════════════════════════════════
-- المصدر: docs/portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39-59 حرفيًا.
--
-- ⚠️ تشغيل هذا الملفّ **يُعيد فتح الثغرة**: يعود أيّ super_admin قادرًا على ترقية
--    موظف عاديّ إلى super_admin (أي مالك جديد) بلا حدّ. لا تُشغّله إلا إن أثبت
--    الإصلاح أنه يمنع عملية مشروعة، وسجّل السبب.
-- ════════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.admin_set_staff_role(p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_manage_staff() then raise exception 'owner only'; end if;
  if p_user = auth.uid() then raise exception 'cannot change your own staff role'; end if;
  if p_role is not null and p_role <> all (array[
       'super_admin','manager','support','editor','sales','hr','readonly','finance',
       'photographer','lighting_tech','camera_assistant','custody_officer']) then
    raise exception 'invalid staff role: %', p_role;
  end if;
  if exists (select 1 from public.profiles where id = p_user
             and (account_type = 'admin' or staff_role = 'super_admin')) then
    raise exception 'protected owner account';
  end if;
  update public.profiles set staff_role = p_role where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;

revoke execute on function public.admin_set_staff_role(uuid,text) from public, anon;
grant  execute on function public.admin_set_staff_role(uuid,text) to authenticated;

do $$
begin
  raise notice '⚠️ تراجُع: عاد منح super_admin متاحًا لأيّ super_admin — الثغرة مفتوحة مجددًا';
end $$;

commit;
