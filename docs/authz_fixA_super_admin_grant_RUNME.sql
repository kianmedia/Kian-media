-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — إصلاح أمني A · منع إنشاء Super Admin بلا حدّ
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الثغرة (حيّة اليوم) ★
--   `admin_set_staff_role` تفحص **حالة الهدف الحالية** فقط:
--       if exists (... id = p_user and (account_type='admin' or staff_role='super_admin'))
--         then raise 'protected owner account';
--   فهي تمنع **تعديل** مالك قائم، ولا تفحص **الدور المُمنَح** إطلاقًا. و`'super_admin'`
--   ضمن قائمة الأدوار المسموحة. و`is_owner() = is_admin() OR staff_role='super_admin'`.
--   ⇒ أيّ حساب يجتاز `can_manage_staff()` (أي أيّ super_admin) يستطيع ترقية موظف عاديّ
--     إلى `super_admin` ⇒ **مالك جديد كامل الصلاحية**، وبلا حدّ للعدد.
--     ليس تجاوزًا لبوّابة، بل توسيع دائم لدائرة المُلّاك بنقرة.
--
-- ★ الإصلاح ★  سطر واحد مُضاف: منح `super_admin` مقصور على **المالك الحقيقي**
--   (`account_type='admin'` — البريدان المُثبّتان في phase1_addendum_s1.sql:152-157).
--   super_admin يظل يدير كل الأدوار التشغيلية، لكنه لا يصنع super_admin آخر.
--
-- ★ التعريف الحيّ المُعاد بناؤه — والدليل ★
--   المصدر: `docs/portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39-57`.
--   **لماذا هو الفائز:** أربعة تعريفات متنافسة لهذه الدالّة في المستودع، وهذا وحده
--   يقبل مجموعة الـ12 دورًا التي يشحنها `lib/portal/roles.ts:100-102` فعلًا مقابل
--   قاعدة البيانات المنشورة. الملفّ المسمّى باسم الميزة
--   (`staff_roles_task_assignment_RUNME.sql:172`) **أقدم (2026-06-16 مقابل 2026-07-04) ومهجور** —
--   إصلاحه كان سيبدو مُنجَزًا وهو لا شيء.
--   الجسم أدناه منسوخ حرفيًا، **بلا إسقاط أيّ شرط**: بوّابة `can_manage_staff()`،
--   منع تغيير الدور الذاتي، قائمة الأدوار الـ12، حماية الحساب المالك،
--   `get diagnostics` وقيمة الإرجاع. الإضافة الوحيدة هي فحص الدور المُمنَح.
--
-- ★ ما لا يفعله ★  لا يغيّر الصيغة · لا يغيّر المنح · لا يمسّ `is_owner()`
--   ولا `can_manage_staff()` ولا أيّ سياسة SELECT · لا يُنشئ `org_admin` · لا يربط MFA.
--
-- ★ التراجع ★  `docs/authz_fixA_super_admin_grant_ROLLBACK.sql`
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.admin_set_staff_role(uuid,text)') is null then
    raise exception 'admin_set_staff_role غير موجودة — لا تُشغّل هذا الملفّ على قاعدة غير مُهيّأة';
  end if;
  if to_regprocedure('public.can_manage_staff()') is null then
    raise exception 'can_manage_staff غير موجودة — شغّل project_platform_authz_hardening_RUNME.sql أولًا';
  end if;
end $$;

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

  -- ★★ الإضافة الوحيدة — فحص الدور المُمنَح، لا حالة الهدف ★★
  -- منح `super_admin` = صناعة مالك جديد (is_owner() يشمله). لذلك يقتصر على المالك
  -- الحقيقي. بدونه يستطيع أيّ super_admin أن يصنع super_admin آخر بلا نهاية.
  if p_role = 'super_admin' and not exists (
       select 1 from public.profiles
        where id = auth.uid() and account_type = 'admin' and account_status = 'active') then
    raise exception 'role_change_denied' using errcode = 'P0003',
      hint = 'منح صلاحية المالك مقصور على حساب المالك / granting owner-level is owner-only';
  end if;

  if exists (select 1 from public.profiles where id = p_user
             and (account_type = 'admin' or staff_role = 'super_admin')) then
    raise exception 'protected owner account';
  end if;
  update public.profiles set staff_role = p_role where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;

-- الصلاحيات كما كانت حرفيًا (portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:58-59).
revoke execute on function public.admin_set_staff_role(uuid,text) from public, anon;
grant  execute on function public.admin_set_staff_role(uuid,text) to authenticated;

do $$
declare v_def text;
begin
  v_def := pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'));
  if v_def not like '%role_change_denied%' then
    raise exception 'فشل: فحص الدور المُمنَح غير موجود بعد التطبيق';
  end if;
  -- كل شرط أصلي يجب أن يبقى — إسقاط أحدها بالخطأ أسوأ من الثغرة نفسها.
  if v_def not like '%can_manage_staff%'            then raise exception 'فشل: سقطت بوّابة can_manage_staff'; end if;
  if v_def not like '%cannot change your own staff role%' then raise exception 'فشل: سقط منع التغيير الذاتي'; end if;
  if v_def not like '%protected owner account%'     then raise exception 'فشل: سقطت حماية الحساب المالك'; end if;
  if v_def not like '%custody_officer%'             then raise exception 'فشل: سقطت قائمة الأدوار الـ12'; end if;
  if has_function_privilege('anon', 'public.admin_set_staff_role(uuid,text)', 'execute') then
    raise exception 'فشل أمني: anon يملك EXECUTE';
  end if;
  raise notice '✓ إصلاح A: منح super_admin صار مقصورًا على المالك · كل الشروط الأصلية سليمة';
end $$;

commit;
