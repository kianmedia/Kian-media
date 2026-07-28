-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — ترحيل دور `org_admin` (مسؤول إداري) — **لا يُنشئ أحدًا ولا يمنح شيئًا**
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ خامل بالكامل. ★
--   يوسّع القيد ليقبل القيمة، ويضيف مُسنِدات تمييز جديدة. **لا حساب يُنشأ، ولا صفّ
--   يتغيّر، ولا صلاحية تُمنَح.** بعد تشغيله لا يملك أحد هذا الدور، ومن يُمنَحه لاحقًا
--   لا يحصل على شيء حتى تُمنَح صلاحياته صراحةً عبر permission engine.
--
-- ★ إحصاء الإنتاج يجعل هذا أبسط ترحيل ممكن ★
--   `owner_count = 2` · **`super_admin_count = 0`**
--   ⇒ لا Backfill · لا حساب يُحوَّل · لا تخفيض · لا صفّ قائم يتأثّر إطلاقًا.
--
-- ★ لماذا `org_admin` وليس `admin` — قرار غير قابل للنقض ★
--   `lib/portal/roles.ts:12`: `ViewRole = "admin" | "client" | "lead" | StaffRole`.
--   واتحاد TypeScript **مجموعة**: إضافة `"admin"` إلى `StaffRole` **لا تضيف عضوًا**.
--   عندها `roles.ts:46` (`isOwner = view === "admin" || …`) تصير **true**، فيحصل
--   الدور الأدنى على عشر رايات بمستوى المالك، و`nav.ts:37` يخدمه مجموعة تبويبات
--   **أوسع من super_admin** — وكل ذلك **بلا خطأ ترجمة**، لأن الاتحاد لم يتّسع.
--   أمّا `org_admin` فيوسّع الاتحاد فعلًا ⇒ `Record<ViewRole,…>` في `nav.ts:36`
--   **يفشل في الترجمة** حتى تُسنَد له تبويبات. حوّلنا تصعيدًا صامتًا إلى خطأ بناء.
--
-- ⚠️ ★ هذا الملفّ **لا يجعل الدور قابلًا للإسناد** — حدّ مقصود ★
--   `admin_set_staff_role` تحمل قائمة أدوار **خاصّة بها** مكتوبة نصًّا في جسمها
--   (portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:45-49) لا تقرأ القيد.
--   ⇒ بعد هذا الملفّ يقبل **القيد** القيمة، لكن **الـRPC ترفضها** بـ
--     `invalid staff role: org_admin`.
--   هذا **مقصود ومقبول الآن**: المالك قرّر ألّا يُنشأ أيّ org_admin على الإنتاج بعد.
--   ولم أُوسّع القائمة هنا عمدًا لأن `admin_set_staff_role` تُعاد بناؤها أصلًا في
--   Fix A ثم في S4b؛ فملفّ رابع يلمسها يجعل ترتيب التطبيق هشًّا بلا داعٍ.
--   **عند الرغبة في إسناد الدور فعلًا:** يُوسَّع المصفوف داخل آخر ملفّ يُعيد بناء
--   الدالّة (S4b)، بموافقة صريحة — وليس هنا.
--
-- ★ الترتيب مع الكود ★
--   آمن أن يُنشر كود TypeScript **قبل** هذا الملفّ: القيمة تُعرَّف في الاتحاد لكن لا
--   حساب يحملها، و`STAFF_ROLE_OPTIONS` يُخفيها خلف راية مُطفأة فلا يستطيع أحد إسنادها
--   فيصطدم بالقيد. والعكس آمن أيضًا.
--
-- ★ السلامة ★  إضافي · idempotent · لا DROP · لا حذف · لا مساس بـ`is_owner()`
--   ولا `is_admin()` ولا `can_manage_projects()` ولا أيّ سياسة SELECT.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · توسيع القيد ليقبل القيمة (ولا أحد يحملها)
-- ─────────────────────────────────────────────────────────────────────────────
-- القيد الحيّ يُعرَّف في portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:33-37.
-- نعيد بناءه بالقائمة نفسها + `org_admin`. لا قيمة تُحذف — الحذف كان سيُبطل صفوفًا قائمة.
do $$
declare v_con text; v_cnt int;
begin
  -- ⚠️ كان `limit 1` بلا عدّ: لو وُجد أكثر من قيد على staff_role لاختار **واحدًا عشوائيًّا**
  -- وأسقطه وترك الآخر، فيبدو الترحيل ناجحًا بينما القيد الآخر ما زال يرفض org_admin.
  select count(*) into v_cnt from pg_constraint
   where conrelid = 'public.profiles'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%staff_role%';
  if v_cnt > 1 then
    raise exception 'يوجد % قيد على staff_role — توقّف وحدّد أيّها الحيّ قبل التوسيع', v_cnt;
  end if;
  select conname into v_con
    from pg_constraint
   where conrelid = 'public.profiles'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%staff_role%';

  if v_con is null then
    raise notice 'لا يوجد قيد على staff_role — لا شيء يُوسَّع';
  else
    execute format('alter table public.profiles drop constraint %I', v_con);
    execute $q$
      alter table public.profiles add constraint profiles_staff_role_check
      check (staff_role is null or staff_role in (
        'super_admin','org_admin','manager','support','editor','sales','hr','readonly',
        'finance','photographer','lighting_tech','camera_assistant','custody_officer'))
    $q$;
    raise notice 'وُسِّع قيد staff_role ليشمل org_admin (القيد السابق: %)', v_con;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · مُسنِدات التمييز — جديدة كلّها. **لا شيء يستدعيها بعد.**
-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ `is_owner()` **لم تُمسّ**. لها 99 موضع استدعاء، و68 منها يعتمد على شمولها
--    super_admin. تغيير معناها دفعة واحدة يكسر الإنتاج. الانتقال بإضافة مُسنِدات
--    جديدة ونقل مواضع الاستدعاء **واحدًا واحدًا** بموافقة صريحة.

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (select 1 from public.profiles
    where id = auth.uid() and account_status = 'active' and staff_role = 'super_admin'), false);
$$;

create or replace function public.is_org_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (select 1 from public.profiles
    where id = auth.uid() and account_status = 'active' and staff_role = 'org_admin'), false);
$$;

-- «إداريّ مميّز» = مالك أو super_admin أو org_admin. للعمليات التي تناسب الطبقات الثلاث.
-- ليست بديلًا عن is_owner() — بل مُسنِد أوسع يُستخدم عمدًا حيث يُقصد ذلك.
create or replace function public.is_privileged_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner(), false)
      or public.is_org_admin();
$$;

-- إعدادات الأمان العليا: **المالك الحقيقي فقط** (وليس is_owner() التي تشمل super_admin).
create or replace function public.can_change_security_settings()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(exists (select 1 from public.profiles
    where id = auth.uid() and account_status = 'active' and account_type = 'admin'), false);
$$;

revoke all    on function public.is_super_admin()               from public, anon;
grant  execute on function public.is_super_admin()               to authenticated, service_role;
revoke all    on function public.is_org_admin()                  from public, anon;
grant  execute on function public.is_org_admin()                 to authenticated, service_role;
revoke all    on function public.is_privileged_admin()           from public, anon;
grant  execute on function public.is_privileged_admin()          to authenticated, service_role;
revoke all    on function public.can_change_security_settings()  from public, anon;
grant  execute on function public.can_change_security_settings() to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · فحص ذاتي
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n int; v_def text;
begin
  -- القيمة مقبولة الآن.
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.profiles'::regclass
                    and pg_get_constraintdef(oid) ilike '%org_admin%') then
    raise exception 'فشل: القيد لا يقبل org_admin';
  end if;

  -- ★ لا أحد يحمل الدور. هذا الملفّ لا يُنشئ ولا يُحوّل. ★
  select count(*) into v_n from public.profiles where staff_role = 'org_admin';
  if v_n <> 0 then
    raise exception 'فشل: يوجد % حساب بدور org_admin — هذا الملفّ يجب ألّا يُنشئ أحدًا', v_n;
  end if;

  -- لا صفّ تغيّر: عدد المُلّاك وsuper_admin كما رصدهما P1.
  select count(*) into v_n from public.profiles where account_type = 'admin';
  if v_n <> 2 then raise exception 'فشل: عدد المُلّاك % وليس 2 — توقّف وراجع', v_n; end if;
  select count(*) into v_n from public.profiles where staff_role = 'super_admin';
  if v_n <> 0 then raise exception 'فشل: ظهر super_admin (%) — P1 رصد صفرًا', v_n; end if;

  -- is_owner() لم تُمسّ.
  v_def := pg_get_functiondef(to_regprocedure('public.is_owner()'));
  if v_def ilike '%org_admin%' then
    raise exception 'فشل: is_owner() صارت تشمل org_admin — ممنوع قطعًا';
  end if;

  -- org_admin ليس مالكًا ولا super_admin.
  if pg_get_functiondef(to_regprocedure('public.is_super_admin()')) ilike '%org_admin%' then
    raise exception 'فشل: is_super_admin تشمل org_admin';
  end if;
  if pg_get_functiondef(to_regprocedure('public.can_change_security_settings()')) ilike '%org_admin%' then
    raise exception 'فشل: org_admin يستطيع تغيير إعدادات الأمان — ممنوع في اليوم الأول';
  end if;

  raise notice '✓ org_admin: القيمة مقبولة · لا حساب يحملها · is_owner() سليمة · صفر صلاحيات ممنوحة';
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- ما **لا** يفعله هذا الملفّ (بأمر المالك):
--   • لا يُنشئ org_admin ولا يُحوّل حسابًا.  • لا يمنحه أيّ صلاحية.
--   • لا يجعله Owner ولا Super Admin.        • لا يشمله MFA.
--   • لا ينقل أيّ موضع استدعاء من is_owner().
-- التراجع: docs/org_admin_migration_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════
