-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — S4-PRE · إغلاق ثغرتَي تصعيد صلاحيات (مستقلّتان عن MFA)
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ تصحيحان للتدقيق — تحقّقتُ منهما بنفسي قبل الكتابة ★
--
--   ✗ ادّعاء التدقيق: «`admin_set_staff_role` يسمح لمدير بتغيير الأدوار».
--     **غير صحيح.** تُبوَّب على `can_manage_staff()` وهي
--     `select coalesce(public.is_owner(), false)` (project_platform_authz_hardening:76) —
--     مالك فقط، ومع `coalesce` صحيح. لم أُصلح ما ليس مكسورًا.
--
--   ✓ لكن فيها ثغرة **أخرى** حقيقية لم يُسمّها التدقيق بدقّة:
--     قائمة الأدوار المسموحة تتضمّن `'super_admin'`، وفحص «الحساب المحميّ» يفحص
--     **حالة الهدف الحالية** فقط (سطر 50-53) ولا يفحص **الدور المُمنَح**.
--     ⇒ يستطيع مالك ترقية موظف عاديّ إلى `super_admin`، و`is_owner()` =
--       `is_admin() OR staff_role='super_admin'` ⇒ **مالك جديد كامل الصلاحية**.
--       وهذا ليس تجاوزًا لبوّابة، بل توسيعٌ دائم لدائرة المُلّاك بنقرة واحدة.
--
--   ✓ الثغرة الثانية مؤكَّدة كما وصفها التدقيق:
--     دوال الصلاحيات (permission_catalog_RUNME.sql:219 و :258) تقبل
--     `is_owner() OR is_admin() OR can_manage_projects()` — و`can_manage_projects()`
--     تشمل `staff_role='manager'` (project_platform_authz_hardening:51-53).
--     ⇒ **مدير مشروع يستطيع إعادة كتابة صلاحيات موظف آخر.**
--
-- ★ حدّ لا أستطيع تجاوزه بلا قرارك — ولن أخترع مفردات ★
--   المصفوفة المطلوبة ثلاث طبقات: owner > super_admin > admin.
--   **المخطّط الحالي لا يعرف ثلاثًا.** `account_type='admin'` محصور في بريدَين
--   مُثبّتين نصًّا (phase1_addendum_s1.sql:152-157) — أي أن «admin» **هو** المالك،
--   ولا توجد طبقة إدارية ثالثة أدنى منه. لذلك:
--     • «owner»       = `account_type='admin'`  (بريدان، ولا يمكن منحه لأحد آخر أصلًا)
--     • «super_admin» = `staff_role='super_admin'`
--     • لا يوجد «admin» منفصل يمكن لأحد منحه.
--   إنشاء طبقة ثالثة يحتاج عمودًا جديدًا وقرارًا منك — ولن أفترضه.
--   ما ينفّذه هذا الملفّ هو المصفوفة القابلة للتعبير عنها **بالمخطّط القائم**.
--
-- ★ السلامة ★  إضافي · idempotent · لا DROP · لا حذف · لا مساس بسياسات SELECT
--   ولا بـ`is_admin()`/`is_owner()`/`can_manage_projects()` أنفسها.
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $$
begin
  if to_regprocedure('public.can_manage_staff()') is null
     or to_regprocedure('public.is_owner()') is null then
    raise exception 'بوّابات الأدوار غير مُثبَّتة — شغّل project_platform_authz_hardening_RUNME.sql أولًا';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §1 · صلاحية إدارة الهويّات — منفصلة عن إدارة المشاريع
-- ─────────────────────────────────────────────────────────────────────────────
-- الفصل هو الإصلاح: «يدير مشاريع» ≠ «يدير حسابات وأدوارًا وصلاحيات».
-- لا نعدّل `can_manage_projects()` — نتوقّف عن قبولها كبديل.
create or replace function public.can_manage_identity()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner(), false);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §2 · حارس منح الأدوار — يمنع توسيع دائرة المُلّاك
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.assert_can_grant_role(p_target uuid, p_role text)
returns void language plpgsql stable security definer set search_path = public as $$
declare v_is_true_owner boolean;
begin
  if not coalesce(public.can_manage_identity(), false) then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'إدارة الأدوار للمالك فقط / role management is owner-only';
  end if;
  -- لا رفع ذاتيّ. (الدالّة الأصلية تمنعه أيضًا — نُبقيه هنا كي لا يعتمد الحارس عليها.)
  if p_target = auth.uid() then
    raise exception 'authorization_denied' using errcode = 'P0003',
      hint = 'لا يمكن تغيير دورك بنفسك / cannot change your own role';
  end if;

  -- ★ الإصلاح: منح `super_admin` = صناعة مالك جديد. مقصور على المالك الحقيقي
  --   (`account_type='admin'` — البريدان المُثبّتان)، لا على كل من يجتاز is_owner().
  --   بدونه يستطيع أيّ super_admin أن يصنع super_admin آخر بلا حدّ.
  if coalesce(p_role, '') = 'super_admin' then
    select exists (select 1 from public.profiles
                    where id = auth.uid() and account_type = 'admin' and account_status = 'active')
      into v_is_true_owner;
    if not coalesce(v_is_true_owner, false) then
      raise exception 'authorization_denied' using errcode = 'P0003',
        hint = 'منح صلاحية المالك مقصور على حساب المالك / granting owner-level is owner-only';
    end if;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- §3 · الصلاحيات
-- ─────────────────────────────────────────────────────────────────────────────
revoke all    on function public.can_manage_identity()            from public, anon;
grant  execute on function public.can_manage_identity()            to authenticated, service_role;
revoke all    on function public.assert_can_grant_role(uuid,text)  from public, anon;
grant  execute on function public.assert_can_grant_role(uuid,text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- §4 · فحص ذاتي
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.can_manage_identity()') is null then
    raise exception 'فشل: can_manage_identity لم تُنشأ';
  end if;
  -- لا يجوز أن تقبل can_manage_projects كبديل — وهي جوهر الإصلاح.
  if pg_get_functiondef(to_regprocedure('public.can_manage_identity()')) ilike '%can_manage_projects%' then
    raise exception 'فشل: can_manage_identity تقبل can_manage_projects — الفصل لم يتحقّق';
  end if;
  if has_function_privilege('anon', 'public.assert_can_grant_role(uuid,text)', 'execute') then
    raise exception 'فشل أمني: anon يملك EXECUTE على حارس منح الأدوار';
  end if;
  raise notice '✓ S4-pre: صلاحية إدارة الهويّات مفصولة · حارس منح الأدوار جاهز';
  raise notice '  ⚠️ لم تُربط بأيّ دالّة بعد — الربط في الملفّ التالي بعد مراجعتك';
end $$;

commit;
