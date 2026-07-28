-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — التحقّق بعد التطبيق · **قراءة فقط بالكامل**
-- ════════════════════════════════════════════════════════════════════════════
-- لا يوجد في هذا الملفّ أيّ INSERT / UPDATE / DELETE / DROP / ALTER / CREATE.
-- شغّل القسم المقابل للمرحلة التي أنهيتها للتوّ. كل استعلام يحمل نتيجته المتوقَّعة.
-- ════════════════════════════════════════════════════════════════════════════


-- ═══ §1 · Fix A — منح super_admin مقصور على المالك ═══════════════════════════

-- 1.1 هل الفحص الجديد موجود؟   المتوقَّع: t
select 'FIXA-1 granted-role check present' as check,
       pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
         like '%role_change_denied%' as expect_true;

-- 1.2 هل كل الحرّاس الأصلية باقية؟   المتوقَّع: أربعتها t
select 'FIXA-2 original guards survived' as check,
       d like '%can_manage_staff%'                      as g1_owner_gate,
       d like '%cannot change your own staff role%'     as g2_no_self,
       d like '%protected owner account%'               as g3_protected,
       d like '%custody_officer%'                       as g4_role_list
  from (select pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)')) d) x;

-- 1.3 الصلاحيات لم تتغيّر.   المتوقَّع: anon=f · authenticated=t
select 'FIXA-3 grants' as check,
       has_function_privilege('anon','public.admin_set_staff_role(uuid,text)','execute')          as anon_expect_false,
       has_function_privilege('authenticated','public.admin_set_staff_role(uuid,text)','execute') as auth_expect_true;


-- ═══ §2 · Fix C — البوّابات الستّ لا تُعيد NULL ═══════════════════════════════

-- 2.1 كلّها تحتوي coalesce.   المتوقَّع: 6 صفوف، coalesced = t
select 'FIXC-1 null-proof' as check, p.proname,
       pg_get_functiondef(p.oid) like '%coalesce%' as coalesced_expect_true,
       p.prosecdef                                  as security_definer_expect_true,
       array_to_string(p.proconfig, ',')            as search_path_expect_public
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_manage_hr','can_see_invoices','can_see_opportunities',
                     'can_manage_quotes','can_manage_custody','civ_can_manage')
 order by p.proname;

-- 2.2 صلاحيات anon **لم تتغيّر** — الثلاث المكشوفة تبقى مكشوفة عمدًا.
--     المتوقَّع: quotes/invoices/opportunities anon=t · الثلاث الأخرى anon=f
select 'FIXC-2 anon grants unchanged' as check, p.proname,
       has_function_privilege('anon', p.oid, 'execute')          as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as auth_expect_true
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_manage_hr','can_see_invoices','can_see_opportunities',
                     'can_manage_quotes','can_manage_custody','civ_can_manage')
 order by p.proname;

-- 2.3 لا تُعيد NULL بلا جلسة.   المتوقَّع: كلّها f (لا NULL)
select 'FIXC-3 no NULL without session' as check,
       public.can_manage_hr()           as hr,
       public.can_see_invoices()        as inv,
       public.can_see_opportunities()   as opp,
       public.can_manage_quotes()       as quo,
       public.can_manage_custody()      as cus,
       public.civ_can_manage()          as civ;


-- ═══ §3 · s4pre — فصل صلاحية الهويّة ════════════════════════════════════════

-- 3.1 الدالّتان موجودتان ولا تقبلان can_manage_projects.   المتوقَّع: t ثم f
select 'S4PRE-1 identity separated' as check,
       to_regprocedure('public.can_manage_identity()') is not null as exists_expect_true,
       pg_get_functiondef(to_regprocedure('public.can_manage_identity()'))
         like '%can_manage_projects%' as accepts_projects_expect_FALSE;

-- 3.2 حارس منح الأدوار.   المتوقَّع: t · anon=f
select 'S4PRE-2 grant guard' as check,
       to_regprocedure('public.assert_can_grant_role(uuid,text)') is not null as exists_expect_true,
       has_function_privilege('anon','public.assert_can_grant_role(uuid,text)','execute') as anon_expect_false;


-- ═══ §4 · Fix B — لا can_manage_projects في دوالّ الهويّة ═══════════════════

-- 4.1 السبع كلّها على can_manage_identity ولا واحدة على can_manage_projects.
--     المتوقَّع: identity_gate=t · projects_gate=f لكل صفّ
select 'FIXB-1 identity gate' as check, p.proname,
       pg_get_functiondef(p.oid) like '%can_manage_identity%'  as identity_gate_expect_true,
       pg_get_functiondef(p.oid) like '%can_manage_projects%'  as projects_gate_expect_FALSE
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('admin_set_employee_professions','admin_set_employee_override',
                     'admin_set_profession_permission','admin_copy_profession_permissions',
                     'admin_apply_profession_template','admin_upsert_profession',
                     'admin_delete_profession')
 order by p.proname;


-- ═══ §5 · S4a — المُسنِد ═════════════════════════════════════════════════════

-- 5.1 موجود ويسمح بلا جلسة (فشل-مغلق ممنوع هنا).   المتوقَّع: t ثم t
select 'S4A-1 predicate' as check,
       to_regprocedure('public.mfa_write_ok()') is not null as exists_expect_true,
       public.mfa_write_ok()                                as allows_no_session_expect_TRUE;

-- 5.2 الرافع موجود.   المتوقَّع: t
select 'S4A-2 raiser' as check,
       to_regprocedure('public.mfa_require_aal2(text)') is not null as expect_true;


-- ═══ §6 · S4b — البوّابة على السبع ═══════════════════════════════════════════

-- 6.1 السبع تحمل البوّابة.   المتوقَّع: 7 صفوف، gated = t
select 'S4B-1 gate bound' as check, p.proname,
       pg_get_functiondef(p.oid) like '%mfa_require_aal2%' as gated_expect_true
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('admin_set_staff_role','admin_set_account','admin_set_employee_professions',
                     'admin_set_employee_override','admin_set_profession_permission',
                     'admin_upsert_profession','admin_delete_profession')
 order by p.proname;

-- 6.2 ★ الأهمّ ★ S4b لم يُلغِ Fix A ولا Fix B.   المتوقَّع: كلاهما t
select 'S4B-2 fixes survived' as check,
       pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'))
         like '%role_change_denied%' as fixA_survived_expect_true,
       pg_get_functiondef(to_regprocedure('public.admin_set_profession_permission(uuid,text,boolean)'))
         like '%can_manage_identity%' as fixB_survived_expect_true;

-- 6.3 زرّ الطوارئ **بلا بوّابة**.   المتوقَّع: f
select 'S4B-3 emergency lever ungated' as check,
       pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)'))
         like '%mfa_require_aal2%' as gated_expect_FALSE;


-- ═══ §7 · سلامة عامّة ═══════════════════════════════════════════════════════

-- 7.1 كل دوالّ الحزمة: SECURITY DEFINER و search_path مثبّت.
--     المتوقَّع: secdef=t · proconfig يحوي search_path=public
select 'GEN-1 definer + search_path' as check, p.proname, p.prosecdef as secdef_expect_true,
       array_to_string(p.proconfig, ',') as config_expect_search_path
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and (p.proname like 'mfa\_%' or p.proname like 'admin\_set\_%'
        or p.proname in ('can_manage_identity','assert_can_grant_role','is_org_admin',
                         'is_super_admin','is_privileged_admin','can_change_security_settings'))
 order by p.proname;

-- 7.2 anon لا يملك تنفيذ أيّ دالّة MFA أو هويّة.   المتوقَّع: صفر صفوف
select 'GEN-2 anon holds nothing' as check, p.proname
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and has_function_privilege('anon', p.oid, 'execute')
   and (p.proname like 'mfa\_%' or p.proname like 'admin\_%'
        or p.proname in ('can_manage_identity','assert_can_grant_role'));

-- 7.3 وضع MFA.   المتوقَّع: enrollment (أو off إن استُخدم زرّ الطوارئ)
select 'GEN-3 mfa mode' as check, enforcement_mode, applies_to, updated_at
  from public.mfa_settings where id = 1;

-- 7.4 لم يُنشأ org_admin.   المتوقَّع: 0
select 'GEN-4 no org_admin created' as check, count(*) as expect_zero
  from public.profiles where staff_role = 'org_admin';

-- 7.5 لم تتغيّر الحسابات المميّزة.   المتوقَّع: owners=2 · super_admins=0
select 'GEN-5 privileged accounts unchanged' as check,
       count(*) filter (where account_type = 'admin')      as owners_expect_2,
       count(*) filter (where staff_role = 'super_admin')  as super_admins_expect_0
  from public.profiles;

-- 7.6 لا أدوار غير معروفة.   المتوقَّع: 0
select 'GEN-6 no unknown roles' as check, count(*) as expect_zero
  from public.profiles
 where staff_role is not null
   and staff_role <> all (array['super_admin','org_admin','manager','support','editor','sales',
        'hr','readonly','finance','photographer','lighting_tech','camera_assistant','custody_officer']);

-- 7.7 is_owner() لم تُمسّ.   المتوقَّع: f (لا تعرف org_admin)
select 'GEN-7 is_owner untouched' as check,
       pg_get_functiondef(to_regprocedure('public.is_owner()'))
         like '%org_admin%' as knows_org_admin_expect_FALSE;
