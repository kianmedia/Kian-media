-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — S4b · فحص قبْليّ **للقراءة فقط** — لا يغيّر شيئًا إطلاقًا
-- docs/mfa_write_gate_s4b_bind_PREFLIGHT.sql
-- ════════════════════════════════════════════════════════════════════════════
--   شغّله **قبل** docs/mfa_write_gate_s4b_bind_RUNME.sql واقرأ كل صفّ.
--   لا begin/commit · لا create · لا insert/update/delete · لا جدول مؤقّت.
--   ★ احفظ ناتجه (خصوصًا صفَّي «بصمة الصلاحيات» و«بصمة سياسات RLS») — الفحص
--     البعْديّ يطبع البصمتين نفسيهما لتقارنهما بعينك.
--   ★ auth.mfa_factors تحتاج دور postgres/service_role — شغّله في محرّر SQL.
-- ════════════════════════════════════════════════════════════════════════════

with sig(ord, label, sig) as (values
  (1, 'admin_set_staff_role',            'public.admin_set_staff_role(uuid,text)'),
  (2, 'admin_set_account',               'public.admin_set_account(uuid,text,text,text,uuid)'),
  (3, 'admin_upsert_profession',         'public.admin_upsert_profession(jsonb)'),
  (4, 'admin_set_employee_professions',  'public.admin_set_employee_professions(uuid,uuid[])'),
  (5, 'admin_set_profession_permission', 'public.admin_set_profession_permission(uuid,text,boolean)'),
  (6, 'admin_set_employee_override',     'public.admin_set_employee_override(uuid,text,text,text)'),
  (7, 'admin_delete_profession',         'public.admin_delete_profession(uuid,boolean)')
),
d as (
  select s.ord, s.label, s.sig,
         to_regprocedure(s.sig)                        as pid,
         pg_get_functiondef(to_regprocedure(s.sig))    as def
  from sig s
),
rows_out(ord, sub, "المحور", "النتيجة", "التفاصيل") as (

  -- ── 1 · s4pre مُطبَّق ─────────────────────────────────────────────────────
  select 10, 1, '1. s4pre · can_manage_identity()',
         case when to_regprocedure('public.can_manage_identity()') is not null
              then 'PASS' else 'FAIL — شغّل docs/authz_identity_hardening_s4pre_RUNME.sql' end,
         coalesce(pg_get_functiondef(to_regprocedure('public.can_manage_identity()')), '(غير موجودة)')
  union all
  select 10, 2, '1. s4pre · assert_can_grant_role()',
         case when to_regprocedure('public.assert_can_grant_role(uuid,text)') is not null
              then 'PASS' else 'FAIL — شغّل docs/authz_identity_hardening_s4pre_RUNME.sql' end,
         ''

  -- ── 2 · S4a مُطبَّق ───────────────────────────────────────────────────────
  union all
  select 20, 1, '2. S4a · mfa_write_ok()',
         case when to_regprocedure('public.mfa_write_ok()') is not null
              then 'PASS' else 'FAIL — شغّل docs/mfa_write_gate_s4a_RUNME.sql' end, ''
  union all
  select 20, 2, '2. S4a · mfa_require_aal2(text)',
         case when to_regprocedure('public.mfa_require_aal2(text)') is not null
              then 'PASS' else 'FAIL — شغّل docs/mfa_write_gate_s4a_RUNME.sql' end, ''
  union all
  select 20, 3, '2. S4a · mfa_write_ok يبدأ بـ service_role',
         case when pg_get_functiondef(to_regprocedure('public.mfa_write_ok()')) like '%service_role%'
              then 'PASS' else 'FAIL — المُسنِد ليس التعريف المتوقَّع' end, ''
  union all
  select 20, 4, '2. S4a · mfa_write_ok يفشل مفتوحًا (return true في المعالج)',
         case when pg_get_functiondef(to_regprocedure('public.mfa_write_ok()')) like '%exception when others%'
              then 'PASS — المجهول = اسمح (مقصود)' else 'WARN — راجع يدويًّا' end, ''

  -- ── 3 · إصلاح A مُطبَّق (شرط ترتيب) ────────────────────────────────────────
  union all
  select 30, 1, '3. ★ إصلاح A · فحص الدور المُمنَح (role_change_denied)',
         case when (select def from d where ord=1) like '%role_change_denied%'
              then 'PASS' else 'FAIL — لا تُشغّل S4b: سيُلغي إصلاح A صامتًا. شغّل docs/authz_fixA_super_admin_grant_RUNME.sql أولًا' end,
         'المصدر: docs/authz_fixA_super_admin_grant_RUNME.sql:48'
  union all
  select 30, 2, '3. ★ إصلاح A · الحيّة هي التعريف الفائز (12 دورًا)',
         case when (select def from d where ord=1) like '%custody_officer%'
              then 'PASS' else 'FAIL — الحيّة ليست portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:39' end, ''
  union all
  select 30, 3, '3. ★ إصلاح A · حماية الحساب المالك باقية',
         case when (select def from d where ord=1) like '%protected owner account%'
              then 'PASS' else 'FAIL' end, ''

  -- ── 4 · إصلاح B مُطبَّق على الخمس (شرط ترتيب) ──────────────────────────────
  union all
  select 40, ord, '4. ★ إصلاح B · ' || label,
         case
           when def is null then 'FAIL — الدالّة غير موجودة'
           when def not like '%can_manage_identity%' then 'FAIL — لا تُشغّل S4b: سيُلغي إصلاح B صامتًا. شغّل docs/authz_fixB_identity_permissions_RUNME.sql أولًا'
           when def ilike '%can_manage_projects%'    then 'FAIL — ما زالت تقبل can_manage_projects'
           else 'PASS'
         end,
         'المصدر: docs/authz_fixB_identity_permissions_RUNME.sql'
  from d where ord between 3 and 7

  -- ── 5 · الدوالّ السبع موجودة بصِيَغها الدقيقة ──────────────────────────────
  union all
  select 50, ord, '5. الدالّة موجودة · ' || label,
         case when pid is not null then 'PASS' else 'FAIL — صيغة مفقودة/مختلفة' end,
         sig
  from d

  -- ── 6 · هل S4b مُطبَّق أصلًا؟ (إعادة التشغيل آمنة لكن اعرف حالتك) ──────────
  union all
  select 60, ord, '6. البوّابة الحالية · ' || label,
         case when def ilike '%mfa_require_aal2%' then 'مربوطة بالفعل' else 'غير مربوطة (متوقَّع قبل S4b)' end,
         ''
  from d

  -- ── 7 · ★ mfa_admin_set_mode يجب أن تبقى بلا بوّابة ★ ──────────────────────
  union all
  select 70, 1, '7. ★ mfa_admin_set_mode بلا بوّابة (زرّ الطوارئ)',
         case
           when to_regprocedure('public.mfa_admin_set_mode(text)') is null then 'FAIL — غير موجودة'
           when pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)')) ilike '%mfa_require_aal2%'
                then 'FAIL حرج — مبوَّبة: مالكٌ فقد جهازه لن يستطيع الإطفاء أبدًا'
           else 'PASS — غير مبوَّبة (هكذا يجب أن تبقى)'
         end,
         'mfa_foundation_batch_s1_RUNME.sql:143 — is_owner() فقط'

  -- ── 8 · وضع الفرض الحالي ──────────────────────────────────────────────────
  union all
  select 80, 1, '8. enforcement_mode',
         coalesce((select enforcement_mode from public.mfa_settings where id = 1), '(لا صفّ id=1)'),
         'القيم المشروعة: off | enrollment — البوّابة لا تعمل إلّا عند enrollment'

  -- ── 9 · الحسابات المتميّزة وعوامل TOTP المُفعَّلة ──────────────────────────
  union all
  select 90, 1, '9. عدد الحسابات المتميّزة (admin أو super_admin)',
         (select count(*)::text from public.profiles
           where account_type = 'admin' or staff_role = 'super_admin'),
         'هؤلاء وحدهم في نطاق البوّابة (mfa_write_ok الخطوة 4)'
  union all
  select 90, 2, '9. ★ منهم من يملك عاملًا TOTP مُفعَّلًا',
         (select count(*)::text from public.profiles p
           where (p.account_type = 'admin' or p.staff_role = 'super_admin')
             and exists (select 1 from auth.mfa_factors f
                          where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp')),
         '★ هؤلاء وحدهم يمكن أن تمنعهم البوّابة. من لم يسجّل عاملًا يمرّ دائمًا ⇒ لا إقفال ممكن'
  union all
  select 90, 3, '9. تفصيل',
         'انظر التفاصيل',
         coalesce((select string_agg(p.email || ' [' || coalesce(p.account_type,'-') || '/' ||
                                     coalesce(p.staff_role,'-') || '] عامل=' ||
                                     case when exists (select 1 from auth.mfa_factors f
                                                        where f.user_id = p.id and f.status='verified'
                                                          and f.factor_type='totp')
                                          then 'نعم' else 'لا' end, E'\n' order by p.email)
                  from public.profiles p
                  where p.account_type = 'admin' or p.staff_role = 'super_admin'), '(لا حسابات متميّزة)')

  -- ── 10 · بصمتان للمقارنة بعد التطبيق ──────────────────────────────────────
  union all
  select 100, 1, '10. بصمة الصلاحيات (الدوالّ السبع)',
         md5(coalesce((select string_agg(coalesce(array_to_string(p.proacl,','),'(افتراضي PUBLIC)'), '|' order by d2.ord)
                       from d d2 join pg_proc p on p.oid = d2.pid::oid), 'none')),
         coalesce((select string_agg(d2.label || ' => ' ||
                    coalesce(array_to_string(p.proacl,' , '), '(بلا ACL صريح ⇒ EXECUTE موروث لـ PUBLIC)'),
                    E'\n' order by d2.ord)
                   from d d2 join pg_proc p on p.oid = d2.pid::oid), '(تعذّرت القراءة)')
  union all
  select 100, 2, '10. بصمة سياسات RLS (كل القاعدة)',
         md5(coalesce((select string_agg(schemaname||'.'||tablename||'.'||policyname||'|'||cmd||'|'||
                                         coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n'
                                         order by schemaname, tablename, policyname)
                       from pg_policies), 'none')),
         'عدد السياسات: ' || (select count(*)::text from pg_policies) ||
         ' · منها SELECT: ' || (select count(*)::text from pg_policies where cmd in ('SELECT','ALL'))
)
select "المحور", "النتيجة", "التفاصيل"
from rows_out
order by ord, sub;