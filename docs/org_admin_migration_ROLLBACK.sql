-- ════════════════════════════════════════════════════════════════════════════
-- تراجع ترحيل org_admin
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ **يرفض العمل إن كان أيّ حساب يحمل الدور** — تضييق القيد وقتها يُبطل صفوفًا قائمة
--    ويكسر كل تحديث لاحق على `profiles`. أزِل الدور من الحسابات أوّلًا بقرار واعٍ.
-- المُسنِدات الأربعة الجديدة تُترك قائمة عمدًا: لا شيء يستدعيها، ووجودها بلا ضرر،
-- وحذفها قد يكسر شيئًا كُتب بينهما. التراجع يجب أن يكون أضيق من التقدّم.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
declare v_n int; v_con text; v_cnt int;
begin
  select count(*) into v_n from public.profiles where staff_role = 'org_admin';
  if v_n > 0 then
    raise exception 'تراجُع مرفوض: % حساب يحمل org_admin. أزِل الدور عنها أوّلًا وإلا أبطل القيدُ صفوفًا قائمة', v_n;
  end if;

  select conname into v_con from pg_constraint
   where conrelid = 'public.profiles'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%staff_role%' limit 1;
  if v_con is not null then
    execute format('alter table public.profiles drop constraint %I', v_con);
  end if;
  alter table public.profiles add constraint profiles_staff_role_check
    check (staff_role is null or staff_role in (
      'super_admin','manager','support','editor','sales','hr','readonly','finance',
      'photographer','lighting_tech','camera_assistant','custody_officer'));
  raise notice '✓ تراجُع: عاد القيد إلى الأدوار الـ12. المُسنِدات الجديدة تُركت (غير مستدعاة، وحذفها أخطر من إبقائها)';
end $$;

commit;
