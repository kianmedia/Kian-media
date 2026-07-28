-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — FIX C · انهيار NULL في ستّ بوّابات صلاحية (fail-open)
-- docs/authz_fixC_null_collapse_six_gates_RUNME.sql
-- ════════════════════════════════════════════════════════════════════════════
--
-- ★ الثغرة ★  الشكل الحيّ للبوّابات الستّ:
--       select public.is_owner() or public.staff_role() in (...)
--   • is_owner() = is_admin() OR exists(super_admin)، و is_admin() = exists(...)
--     ⇒ لا تُعيدان NULL أبدًا (phase0_migration.sql:325، staff_roles_task_assignment_RUNME.sql:58).
--   • staff_role() (staff_roles_task_assignment_RUNME.sql:44) استعلام قياسيّ عارٍ:
--         select staff_role from public.profiles
--          where id = auth.uid() and account_status = 'active'
--     ⇒ NULL لكلٍّ من: الزائر غير المُصادَق · **كل عميل/lead مُسجَّل دخوله**
--       (staff_role فارغ) · كل موظّف حسابه غير active.
--   • NULL in ('manager','hr') = NULL ، و false OR NULL = **NULL**.
--   ⇒ البوّابة تُعيد NULL بدل false.
--
--   وفي plpgsql:  if not public.can_manage_hr() then raise exception 'not authorized'; end if;
--   `not NULL` = NULL ⇒ الشرط ليس TRUE ⇒ **لا يُرفع الاستثناء** ⇒ الحارس كود ميّت،
--   والدالّة SECURITY DEFINER تُكمل الكتابة متجاوزةً RLS.
--   مواقع الحراسة المصابة في المستودع: **201**
--     can_manage_hr 48 · can_see_invoices 6 · can_see_opportunities 6 ·
--     can_manage_quotes 16 · can_manage_custody 5 · civ_can_manage 120.
--   ⚠️ الفئة المصابة ليست anon فقط — أيّ عميل مُسجَّل دخوله يقع في نفس الفرع.
--
-- ★ الإصلاح ★  coalesce(<التعبير الأصلي حرفيًّا>, false). لا شرط يُسقَط · لا دور
--   يُضاف أو يُحذف · لا توقيع يتغيّر · **ولا سطر GRANT/REVOKE واحد في هذا الملفّ**
--   (CREATE OR REPLACE يحتفظ بـ proacl؛ والاختبار الذاتي في §2 يُثبت عدم الانزياح).
--
-- ★ برهان تطابق الدلالة ★
--   X ∈ {true,false} ⇒ coalesce(X,false) = X (تطابق تامّ).
--   X = NULL يحدث **فقط** حين is_owner() = false و staff_role() IS NULL — أي بالضبط
--   الفئة التي تقصد كلّ واحدة من هذه البوّابات منعها. لا يفقد أيّ مستخدم مسموح له
--   اليوم أيّ صلاحية.
--
-- ★ التعاريف الفائزة (grep على 177 ملفّ SQL) ★
--   can_manage_hr          → portal_hr_employee_portal_RUNME.sql:34            (تعريف وحيد)
--   can_manage_quotes      → production_restore_latest_quotes_zoho_RUNME.sql:89 (وحيد)
--   can_see_invoices       → production_restore_latest_quotes_zoho_RUNME.sql:94
--        يتقدّم على staff_assignment_notifications_finance_ADDENDUM.sql:49
--        (2026-07-03 مقابل 2026-06-16؛ الجسمان متطابقان نصًّا)
--   can_see_opportunities  → opportunities_center_RUNME.sql:64                 (وحيد)
--   can_manage_custody     → portal_equipment_custody_rental_RUNME.sql:43      (وحيد)
--   civ_can_manage         → custody_profession_bridge_RUNME.sql:37
--        يتقدّم على portal_custody_inventory_system_v1_RUNME.sql:23 (2026-07-18 > 2026-07-11).
--        ★ الفائز هنا حاسم: وحده يحمل الفرع الثالث emp_can('manage_custody').
--          إصلاح النسخة القديمة كان سيحذف جسر المِهَن صامتًا ويقفل وصول
--          «أمين العهدة بالمهنة» — وهو بالضبط ما أُنشئ 64080c8 لإصلاحه.
--
-- ★ ما لا يفعله ★  لا يمسّ is_owner / is_admin / can_manage_projects /
--   can_manage_staff · لا يمسّ أيّ سياسة RLS · لا DROP · لا DELETE · لا تغيير منح.
--
-- ★ التراجع ★  docs/authz_fixC_null_collapse_six_gates_ROLLBACK.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ─── PREFLIGHT (خارج المعاملة — لا يعدّل شيئًا) ──────────────────────────────
do $pre$
declare miss text := '';
begin
  if to_regprocedure('public.is_owner()')              is null then miss := miss || ' is_owner()'; end if;
  if to_regprocedure('public.staff_role()')            is null then miss := miss || ' staff_role()'; end if;
  if to_regprocedure('public.can_manage_hr()')         is null then miss := miss || ' can_manage_hr()'; end if;
  if to_regprocedure('public.can_see_invoices()')      is null then miss := miss || ' can_see_invoices()'; end if;
  if to_regprocedure('public.can_see_opportunities()') is null then miss := miss || ' can_see_opportunities()'; end if;
  if to_regprocedure('public.can_manage_quotes()')     is null then miss := miss || ' can_manage_quotes()'; end if;
  if to_regprocedure('public.can_manage_custody()')    is null then miss := miss || ' can_manage_custody()'; end if;
  if to_regprocedure('public.civ_can_manage()')        is null then miss := miss || ' civ_can_manage()'; end if;
  -- الفرع الثالث في civ_can_manage — بدونه لا يُصرَّح جسم الدالّة أصلًا.
  if to_regprocedure('public.emp_can(text,uuid)')      is null then miss := miss || ' emp_can(text,uuid)'; end if;
  if miss <> '' then
    raise exception 'PREFLIGHT فشل — دوالّ مفقودة:% · لا تُشغّل هذا الملفّ على قاعدة غير مُهيّأة', miss;
  end if;
end $pre$;

begin;

-- ════════════════════════════════════════════════════════════════════════════
-- §0  لقطة الصلاحيات قبل التعديل — دليل قاطع على أنّ المنح لم يتغيّر.
--     جدول مؤقّت بـ on commit drop: لا DROP صريح، ولا أثر بعد المعاملة.
-- ════════════════════════════════════════════════════════════════════════════
create temporary table if not exists _fixc_acl_before (proname text primary key, acl text)
  on commit drop;

insert into _fixc_acl_before (proname, acl)
select p.proname, coalesce(p.proacl::text, '(default: PUBLIC holds EXECUTE)')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.pronargs = 0
   and p.proname in ('can_manage_hr','can_see_invoices','can_see_opportunities',
                     'can_manage_quotes','can_manage_custody','civ_can_manage')
on conflict (proname) do nothing;

-- ════════════════════════════════════════════════════════════════════════════
-- §1  البوّابات الستّ — الجسم الأصلي حرفيًّا، مغلَّفًا بـcoalesce(...,false) فقط.
-- ════════════════════════════════════════════════════════════════════════════

-- (1) can_manage_hr — الفائز: portal_hr_employee_portal_RUNME.sql:34 (تعريف وحيد)
create or replace function public.can_manage_hr() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager','hr'), false);
$$;

-- (2) can_see_invoices — الفائز: production_restore_latest_quotes_zoho_RUNME.sql:94
--     (يتقدّم على staff_assignment_notifications_finance_ADDENDUM.sql:49 — أقدم بشهر،
--      وجسمه متطابق نصًّا فلا خلاف دلاليّ)
create or replace function public.can_see_invoices() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager','finance'), false);
$$;

-- (3) can_see_opportunities — الفائز: opportunities_center_RUNME.sql:64 (تعريف وحيد)
create or replace function public.can_see_opportunities() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager','hr'), false);
$$;

-- (4) can_manage_quotes — الفائز: production_restore_latest_quotes_zoho_RUNME.sql:89 (وحيد)
create or replace function public.can_manage_quotes() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager','sales','finance'), false);
$$;

-- (5) can_manage_custody — الفائز: portal_equipment_custody_rental_RUNME.sql:43 (وحيد)
--     ⚠ دالّة مستقلّة عن civ_can_manage — بوّابة وحدة العهدة/التأجير القديمة، أضيق.
create or replace function public.can_manage_custody() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.is_owner() or public.staff_role() in ('manager'), false);
$$;

-- (6) civ_can_manage — الفائز: custody_profession_bridge_RUNME.sql:37
--     (يتقدّم على portal_custody_inventory_system_v1_RUNME.sql:23)
--     ★ الفرع الثالث emp_can('manage_custody') = جسر المِهَن. حذفه يقفل «أمين العهدة
--       بالمهنة» عن 120 موقع حراسة و66 سياسة. مُعاد هنا حرفيًّا.
--     emp_can (permission_catalog_RUNME.sql:252) plpgsql بـreturn صريح في كل مسار،
--     فلا تُعيد NULL أبدًا — مصدر الـNULL الوحيد هو staff_role().
create or replace function public.civ_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
           public.is_owner()
        or public.staff_role() in ('manager','custody_officer')
        or public.emp_can('manage_custody'),
       false);
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- §2  اختبار ذاتي — يُفشل المعاملة كلّها عند أيّ خلل.
--     يُثبت: (أ) لا NULL بعد اليوم  (ب) لم يسقط أيّ شرط أصليّ  (ج) لا انزياح منح.
-- ════════════════════════════════════════════════════════════════════════════
do $verify$
declare
  v_expect jsonb := jsonb_build_object(
    'can_manage_hr',         jsonb_build_array('is_owner','staff_role','''manager''','''hr'''),
    'can_see_invoices',      jsonb_build_array('is_owner','staff_role','''manager''','''finance'''),
    'can_see_opportunities', jsonb_build_array('is_owner','staff_role','''manager''','''hr'''),
    'can_manage_quotes',     jsonb_build_array('is_owner','staff_role','''manager''','''sales''','''finance'''),
    'can_manage_custody',    jsonb_build_array('is_owner','staff_role','''manager'''),
    'civ_can_manage',        jsonb_build_array('is_owner','staff_role','''manager''','''custody_officer''',
                                               'emp_can(''manage_custody'')')
  );
  k text; s text; v_def text; v_val boolean; v_acl_now text; r record;
  v_anon text; v_auth text;
begin
  for k in select jsonb_object_keys(v_expect) loop
    v_def := pg_get_functiondef(to_regprocedure('public.' || k || '()'));

    -- (أ) الغلاف موجود
    if position('coalesce' in v_def) = 0 then
      raise exception 'فشل: % لم تُغلَّف بـcoalesce', k;
    end if;

    -- (ب) كلّ شرط أصليّ باقٍ — إسقاط أحدها بالخطأ أسوأ من الثغرة نفسها
    for s in select jsonb_array_elements_text(v_expect -> k) loop
      if position(s in v_def) = 0 then
        raise exception 'فشل: سقط شرط أصليّ [%] من %', s, k;
      end if;
    end loop;

    -- (ج) التوقيع لم يتغيّر: صفر وسائط، إرجاع boolean
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname='public' and p.proname = k
                      and p.pronargs = 0 and p.prorettype = 'boolean'::regtype) then
      raise exception 'فشل: تغيّر توقيع %', k;
    end if;

    -- (د) الإثبات الحيّ: في جلسة محرّر SQL لا يوجد auth.uid() ⇒ كانت تُعيد NULL.
    execute format('select public.%I()', k) into v_val;
    if v_val is null then
      raise exception 'فشل: % ما زالت تُعيد NULL', k;
    end if;

    begin
      v_anon := has_function_privilege('anon',          'public.'||k||'()', 'execute')::text;
      v_auth := has_function_privilege('authenticated', 'public.'||k||'()', 'execute')::text;
    exception when undefined_object then v_anon := 'n/a'; v_auth := 'n/a';
    end;
    raise notice '✓ % → %  · anon EXECUTE=% · authenticated EXECUTE=%', k, v_val, v_anon, v_auth;
  end loop;

  -- (هـ) لا انزياح في المنح — ولا سطر GRANT/REVOKE واحد في هذا الملفّ.
  for r in select b.proname, b.acl from _fixc_acl_before b loop
    select coalesce(p.proacl::text, '(default: PUBLIC holds EXECUTE)') into v_acl_now
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.pronargs = 0 and p.proname = r.proname;
    if v_acl_now is distinct from r.acl then
      raise exception 'فشل: تغيّرت صلاحيات % : % ⇒ %', r.proname, r.acl, v_acl_now;
    end if;
  end loop;

  raise notice '════ إصلاح C تمّ: البوّابات الستّ لا تُعيد NULL · كل الشروط سليمة · المنح دون تغيير ════';
end $verify$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- §3  (اختياريّ · **غير مُوصى به الآن** · لا يُنفَّذ ضمن هذا الملفّ)
--     سحب EXECUTE من anon. القرار المُوصى به: **الإبقاء** — بعد §1 تُعيد الدالّة
--     false لـanon ولا تكشف بيانًا البتّة، وكل سياسات RLS المستهلِكة `to authenticated`
--     فلا يبلغها anon أصلًا. وهذا هو نفس تحذير المستودع الحيّ:
--       project_platform_authz_hardening_RUNME.sql:28-31 — «لا تُسحب صلاحية الحرّاس
--       أنفسهم؛ بعضها يُستدعى داخل سياسات RLS وسحبها قد يُعطّل صفحات عامّة».
--
--     ⚠️ فخّ قاتل: can_manage_quotes و can_see_opportunities **لا تملكان أيّ
--     `grant ... to authenticated` في المستودع كلّه** — صلاحية authenticated فيهما
--     موروثة من افتراضيّ PUBLIC. `revoke ... from public` وحده يقتل البوّابتين
--     للمستخدمين المُصادَقين ويُسقط شاشات عروض الأسعار ومركز الفرص.
--     الشكل الآمن الوحيد إن قرّر المالك لاحقًا (والوحيدة المُثبَتة الأمان هي
--     can_see_invoices لأنّ لها منحًا صريحًا في production_restore…:443):
--
-- revoke execute on function public.can_see_invoices() from public, anon;
-- grant  execute on function public.can_see_invoices() to authenticated, service_role;
-- ════════════════════════════════════════════════════════════════════════════