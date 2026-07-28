-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — تراجع عن FIX C
-- docs/authz_fixC_null_failopen_gates_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ تحذير — ثمن التراجع ⚠️⚠️
--   تشغيل هذا الملفّ **يُعيد فتح 201 موقع حراسة fail-open** بالضبط:
--     can_manage_hr 48 · can_see_invoices 6 · can_see_opportunities 6 ·
--     can_manage_quotes 16 · can_manage_custody 5 · civ_can_manage 120.
--   في كلٍّ منها يعود `if not <gate>() then raise exception 'not authorized'`
--   كودًا ميّتًا لكلّ زائر غير مُصادَق، **ولكلّ عميل/lead مُسجَّل دخوله**، ولكلّ
--   موظّف حسابه غير active — لأنّ البوّابة تعود لإرجاع NULL بدل false، و
--   `not NULL` ليس TRUE. والدوالّ SECURITY DEFINER فتُنفَّذ الكتابة متجاوزةً RLS.
--   لا تُشغّله إلّا إن ثبت أنّ الإصلاح كسر مسارًا تشغيليًّا لا بديل عنه، وبعد
--   تسجيل ذلك كتابةً. البديل الأصحّ لأي كسر: منح الدور/المهنة الصحيحة للمستخدم
--   المتأثّر، لا إعادة فتح الثغرة.
--
--   الأجسام أدناه منسوخة **حرفيًّا** من التعاريف الفائزة قبل الإصلاح.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- (1) الأصل: docs/portal_hr_employee_portal_RUNME.sql:34-37
create or replace function public.can_manage_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','hr');
$$;

-- (2) الأصل: docs/production_restore_latest_quotes_zoho_RUNME.sql:94-97
create or replace function public.can_see_invoices() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','finance');
$$;

-- (3) الأصل: docs/opportunities_center_RUNME.sql:64-67
create or replace function public.can_see_opportunities() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','hr');
$$;

-- (4) الأصل: docs/production_restore_latest_quotes_zoho_RUNME.sql:89-92
create or replace function public.can_manage_quotes() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','sales','finance');
$$;

-- (5) الأصل: docs/portal_equipment_custody_rental_RUNME.sql:43-46
create or replace function public.can_manage_custody() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager');
$$;

-- (6) الأصل: docs/custody_profession_bridge_RUNME.sql:37-40
--     ⚠ لاحظ الفرع الثالث emp_can('manage_custody') — جسر المِهَن. حتى في التراجع
--       يجب أن يبقى، وإلّا خسرنا وصول «أمين العهدة بالمهنة» فوق خسارة الإصلاح.
create or replace function public.civ_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or public.staff_role() in ('manager','custody_officer')
      or public.emp_can('manage_custody');
$$;

-- لا سطر GRANT/REVOKE هنا أيضًا — CREATE OR REPLACE يحتفظ بـproacl، والمنح
-- لم يتغيّر في الإصلاح فلا شيء يُستعاد.

do $rb$
declare k text; v_def text;
begin
  foreach k in array array['can_manage_hr','can_see_invoices','can_see_opportunities',
                           'can_manage_quotes','can_manage_custody','civ_can_manage'] loop
    v_def := pg_get_functiondef(to_regprocedure('public.' || k || '()'));
    if position('coalesce' in v_def) <> 0 then
      raise exception 'فشل التراجع: % ما زالت تحمل coalesce', k;
    end if;
  end loop;
  if position('emp_can(''manage_custody'')' in
       pg_get_functiondef(to_regprocedure('public.civ_can_manage()'))) = 0 then
    raise exception 'فشل التراجع: سقط جسر المِهَن من civ_can_manage';
  end if;
  raise warning '⚠ تمّ التراجع — 201 موقع حراسة عادت fail-open (بما فيها لكلّ عميل مُسجَّل دخوله)';
end $rb$;

commit;