-- ════════════════════════════════════════════════════════════════════════════
-- PREFLIGHT P1 — إحصاء الأدوار · **قراءة فقط، لا يعدّل أيّ صفّ**
-- ════════════════════════════════════════════════════════════════════════════
-- شغّله في محرّر SQL بـSupabase وأرسل النواتج. لا SELECT هنا يكتب شيئًا.
-- الأعمدة الحسّاسة مُقنَّعة: لا بريد كامل ولا معرّف كامل.
-- ════════════════════════════════════════════════════════════════════════════

-- (1) عدد المُلّاك الحقيقيين  (account_type='admin')
select 'owners' as metric, count(*) as n
  from public.profiles where account_type = 'admin';

-- (2) عدد super_admin
select 'super_admins' as metric, count(*) as n
  from public.profiles where staff_role = 'super_admin';

-- (3) أدوار غير معروفة — خارج قائمة الـ12 المعتمدة
select 'unknown_staff_roles' as metric, count(*) as n
  from public.profiles
 where staff_role is not null
   and staff_role <> all (array['super_admin','manager','support','editor','sales','hr',
        'readonly','finance','photographer','lighting_tech','camera_assistant','custody_officer']);

-- (4) مؤشّرات صلاحية متعارضة: مالك يحمل staff_role تشغيليًا في آن واحد
select 'conflicting_indicators' as metric, count(*) as n
  from public.profiles
 where account_type = 'admin' and staff_role is not null and staff_role <> 'super_admin';

-- (5) توزيع كل الأدوار — للسياق
select coalesce(staff_role, '(none)') as staff_role, account_type,
       account_status, count(*) as n
  from public.profiles
 group by 1, 2, 3 order by n desc;

-- (6) الحسابات المتأثّرة، مُقنَّعة
--     يُظهر أول حرف + النطاق فقط، وآخر 4 من المعرّف — يكفي للتمييز دون كشف.
select left(coalesce(email,'?'), 1) || '***' ||
       substring(coalesce(email,'?') from position('@' in coalesce(email,'?'))) as email_masked,
       '…' || right(id::text, 4) as id_tail,
       account_type, staff_role, account_status,
       case when account_type = 'admin' then 'OWNER'
            when staff_role = 'super_admin' then 'SUPER_ADMIN'
            else 'other' end as tier
  from public.profiles
 where account_type = 'admin' or staff_role = 'super_admin'
 order by tier, email_masked;

-- (7) هل anon يملك تنفيذ أيّ من الدوال المستهلِكة للبوّابات الستّ الفاشلة-مفتوحة؟
--     يحسم إن كانت ثغرة كامنة أم حيّة.
select p.proname,
       has_function_privilege('anon', p.oid, 'execute')           as anon_can,
       has_function_privilege('authenticated', p.oid, 'execute')  as auth_can
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('can_manage_hr','can_see_invoices','can_see_opportunities',
                     'can_manage_quotes','can_manage_custody','civ_can_manage')
 order by p.proname;
