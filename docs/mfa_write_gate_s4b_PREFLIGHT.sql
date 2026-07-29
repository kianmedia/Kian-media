-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — S4b · فحص قبْليّ — الجزء (أ) للقراءة فقط · الجزء (ب) **يرفض ويُوقف**
-- docs/mfa_write_gate_s4b_PREFLIGHT.sql
-- ════════════════════════════════════════════════════════════════════════════
--   شغّله **قبل** docs/mfa_write_gate_s4b_RUNME.sql واقرأ كل صفّ.
--   لا create · لا insert/update/delete · لا drop · لا جدول مؤقّت · لا منح.
--   الجزء (ب) كتلة DO **قراءة محضة** ترفع استثناءً عند أيّ خلل — لا تُطبّق شيئًا.
--   ★ احفظ ناتجه (خصوصًا صفَّي «بصمة الصلاحيات» و«بصمة سياسات RLS») — الفحص
--     البعْديّ يطبع البصمتين نفسيهما لتقارنهما بعينك.
--   ★ auth.mfa_factors تحتاج دور postgres — شغّله في محرّر SQL.
--
-- ════════════════════════════════════════════════════════════════════════════
-- ★★★ التغيير الجوهري في هذه النسخة — اقرأه قبل أيّ شيء ★★★
--
--   النسخة السابقة كانت تُثبت أن البوّابة **موجودة**. وهذا لا يُثبت أنها **تمنع**.
--   `mfa_write_ok()` تفشل مفتوحةً في كل مسار خطأ (s4a:94-100)، ومن ضمنها قراءة
--   `auth.mfa_factors` (s4a:82-88). فإن كان **الدور المالك للدالّة** لا يملك SELECT
--   على ذلك الجدول، تُعيد الدالّة `true` دائمًا: قفلٌ مركّب على باب لا يُغلق —
--   وكل فحص نصّيّ (`like '%mfa_require_aal2%'`) يطبع PASS عليه.
--
--   ⇒ هذا الفحص صار **يرفض** تشغيل S4b ما لم تتحقّق قدرة المنع فعليًّا:
--       R1  البوّابة موجودة · SECURITY DEFINER · جسمها يقرأ العوامل ويقارن aal2
--       R2  ★ مالك البوّابة يملك SELECT على auth.mfa_factors + USAGE على auth
--       R3  لا RLS على auth.mfa_factors تُعمي المالك (أو المالك يتجاوزها)
--       R4  لا anon ولا authenticated يملك SELECT مباشرًا (جدولًا أو عمودًا)
--       R5  enforcement_mode = 'enrollment' (وإلّا فالمنع غير قابل للعرض أصلًا)
--       R6  حساب متميّز واحد على الأقلّ يملك عاملًا مُفعَّلًا (وإلّا فلا أحد يُمنع)
--       R7  ★ إقرار المالك بأنه **شاهد** allowed=false بعينه، بتاريخ حديث
--       R8  الترتيب: إصلاح A حيّ · إصلاح B حيّ على السبع · التسع موجودة ·
--           mfa_admin_set_mode بلا بوّابة
--
--   R2/R3/R4 حقائق تُقاس من الكتالوج ولا يمكن الالتفاف عليها بإقرار.
--   R7 وحده إقرار بشريّ — ولذلك هو **بالإضافة إلى** ما سبق لا بديلًا عنه.
--
-- ★★ كيف تُقرّ بالخطوة R7 ★★
--   شغّل أوّلًا docs/mfa_write_gate_s4_DIAGNOSTIC_RUNME.sql واتبع نصّ القبول فيه:
--   بحساب المالك عند aal1 مع عامل مُفعَّل يجب أن ترى **بعينك**:
--       allowed = false · reason = "denied_aal1" · verdict = "gate_can_deny"
--   ثم — في **نفس جلسة** محرّر SQL التي تُشغّل فيها هذا الملفّ — نفّذ السطر التالي
--   أوّلًا (عدّل التاريخ إلى يوم المشاهدة، صيغة YYYY-MM-DD):
--
--       set kian.s4_deny_demonstrated = 'deny-observed:2026-07-29';
--
--   الإقرار غير دائم (يموت بانتهاء الجلسة) ولا يُقبل إن تجاوز عمره 14 يومًا،
--   فلا يُعاد استعماله بعد أن تتغيّر القاعدة تحته.
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ ★ الإقرار — أزل التعليق وعدّل التاريخ بعد أن تكون قد **شاهدت** المنع ★ ═══
-- (يجب أن يكون في **نفس** جلسة/تبويب محرّر SQL الذي تُشغّل فيه هذا الملفّ)
--
-- set kian.s4_deny_demonstrated = 'deny-observed:2026-07-29';
--
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- (أ) لوحة النتائج — قراءة فقط
-- ─────────────────────────────────────────────────────────────────────────────
with sig(ord, label, sig) as (values
  (1, 'admin_set_staff_role',              'public.admin_set_staff_role(uuid,text)'),
  (2, 'admin_set_account',                 'public.admin_set_account(uuid,text,text,text,uuid)'),
  (3, 'admin_upsert_profession',           'public.admin_upsert_profession(jsonb)'),
  (4, 'admin_set_employee_professions',    'public.admin_set_employee_professions(uuid,uuid[])'),
  (5, 'admin_set_profession_permission',   'public.admin_set_profession_permission(uuid,text,boolean)'),
  (6, 'admin_set_employee_override',       'public.admin_set_employee_override(uuid,text,text,text)'),
  (7, 'admin_delete_profession',           'public.admin_delete_profession(uuid,boolean)'),
  (8, 'admin_copy_profession_permissions', 'public.admin_copy_profession_permissions(uuid,uuid)'),
  (9, 'admin_apply_profession_template',   'public.admin_apply_profession_template(uuid,text)')
),
d as (
  select s.ord, s.label, s.sig,
         to_regprocedure(s.sig)                        as pid,
         pg_get_functiondef(to_regprocedure(s.sig))    as def
  from sig s
),
gate as (
  -- ::oid صراحةً — فتُحسم كل مقارنة ككل واستدعاء has_*_privilege على الحِمل الصحيح،
  -- ويُعيد NULL بدل أن يرفع خطأً لو غاب الكائن.
  select to_regprocedure('public.mfa_write_ok()')::oid as goid,
         to_regclass('auth.mfa_factors')::oid          as toid
),
gown as (
  select (select r.rolname      from pg_proc p join pg_roles r on r.oid = p.proowner, gate
           where p.oid = gate.goid) as owner_name,
         (select r.rolbypassrls from pg_proc p join pg_roles r on r.oid = p.proowner, gate
           where p.oid = gate.goid) as owner_bypassrls
),
att as (
  select coalesce(current_setting('kian.s4_deny_demonstrated', true), '') as raw
),
rows_out(ord, sub, "المحور", "النتيجة", "التفاصيل") as (

  -- ══════════════════════════════════════════════════════════════════════════
  -- ★ 0 · قدرة المنع — المحور الجديد، وهو الذي يوقف كل شيء إن سقط ★
  -- ══════════════════════════════════════════════════════════════════════════
  select 0, 1, '0. ★ مالك mfa_write_ok',
         coalesce((select owner_name from gown), '(البوّابة غير موجودة)'),
         'هذا الدور — لا المتصل — هو من يجب أن يقرأ auth.mfa_factors'
  union all
  select 0, 2, '0. ★★ مالك البوّابة يملك SELECT على auth.mfa_factors',
         case
           when (select owner_name from gown) is null then 'FAIL — البوّابة غير موجودة'
           when (select gate.toid from gate) is null  then 'FAIL — auth.mfa_factors غير مرئي (شغّل بدور postgres)'
           when has_table_privilege((select owner_name from gown), (select gate.toid from gate), 'select')
             and has_schema_privilege((select owner_name from gown), 'auth', 'usage')
                then 'PASS — البوّابة قادرة على رؤية العوامل'
           else 'FAIL حرج — البوّابة **خاملة بنيويًّا**: القراءة تفشل ⇒ return true دائمًا ⇒ لا تمنع أحدًا أبدًا'
         end,
         'SELECT=' || coalesce(has_table_privilege((select owner_name from gown), (select gate.toid from gate), 'select')::text, '?')
         || ' · USAGE(auth)=' || coalesce(has_schema_privilege((select owner_name from gown), 'auth', 'usage')::text, '?')
  union all
  select 0, 3, '0. ★ RLS على auth.mfa_factors لا تُعمي المالك',
         case
           when (select c.relrowsecurity from pg_class c, gate where c.oid = gate.toid) is not true then 'PASS — لا RLS'
           when coalesce((select owner_bypassrls from gown), false) then 'PASS — RLS مفعّلة لكن المالك يتجاوزها'
           else 'FAIL حرج — RLS مفعّلة والمالك لا يتجاوزها ⇒ يقرأ صفر صفوف ⇒ خاملة أيضًا'
         end,
         'relrowsecurity=' || coalesce((select c.relrowsecurity::text from pg_class c, gate where c.oid = gate.toid), '?')
         || ' · rolbypassrls=' || coalesce((select owner_bypassrls::text from gown), '?')
  union all
  select 0, 4, '0. ★★ لا SELECT مباشر لـ anon/authenticated على auth.mfa_factors',
         case when coalesce(has_table_privilege('anon',          (select gate.toid from gate), 'select'), false)
                or coalesce(has_table_privilege('authenticated', (select gate.toid from gate), 'select'), false)
              then 'FAIL أمني — قيد غير قابل للتفاوض سقط'
              else 'PASS' end,
         'anon=' || coalesce(has_table_privilege('anon', (select gate.toid from gate), 'select')::text, '?') ||
         ' · authenticated=' || coalesce(has_table_privilege('authenticated', (select gate.toid from gate), 'select')::text, '?')
  union all
  select 0, 5, '0. ★ منح على مستوى الأعمدة (باب خلفي لا يظهر أعلاه)',
         case when exists (
                select 1 from pg_attribute a, gate
                cross join lateral aclexplode(a.attacl) x
                left join pg_roles r on r.oid = x.grantee
                where a.attrelid = gate.toid and a.attnum > 0 and a.attacl is not null
                  and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC'))
              then 'FAIL أمني — يوجد منح عمود' else 'PASS' end,
         coalesce((select string_agg(distinct coalesce(r.rolname, 'PUBLIC') || '.' || a.attname, ' , ')
                     from pg_attribute a, gate
                     cross join lateral aclexplode(a.attacl) x
                     left join pg_roles r on r.oid = x.grantee
                    where a.attrelid = gate.toid and a.attnum > 0 and a.attacl is not null
                      and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC')),
                  '(لا منح أعمدة — سليم)')
  union all
  select 0, 6, '0. ★ إقرار مشاهدة المنع (R7)',
         case
           when (select raw from att) = '' then 'FAIL — غير مُقَرّ. شغّل التشخيص وشاهد allowed=false ثم نفّذ: set kian.s4_deny_demonstrated = ''deny-observed:YYYY-MM-DD'';'
           when (select raw from att) !~ '^deny-observed:\d{4}-\d{2}-\d{2}$' then 'FAIL — صيغة الإقرار غير صحيحة'
           else 'مُقَرّ — يُتحقَّق من عمره في الجزء (ب)'
         end,
         coalesce(nullif((select raw from att), ''), '(لم يُضبط)')
  union all
  select 0, 7, '0. مِسبار التشخيص',
         case when to_regprocedure('public.mfa_gate_selftest()') is null
              then 'غير موجود (نظيف)' else 'موجود — شغّل docs/mfa_write_gate_s4_DIAGNOSTIC_CLEANUP.sql بعد القبول' end,
         'وجوده لا يمنع S4b، لكنه سطح إضافي بلا مقابل'

  -- ── 1 · s4pre مُطبَّق ─────────────────────────────────────────────────────
  union all
  select 10, 1, '1. s4pre · can_manage_identity()',
         case when to_regprocedure('public.can_manage_identity()') is not null
              then 'PASS' else 'FAIL — شغّل docs/authz_identity_hardening_s4pre_RUNME.sql' end,
         coalesce(pg_get_functiondef(to_regprocedure('public.can_manage_identity()')), '(غير موجودة)')
  union all
  select 10, 2, '1. s4pre · assert_can_grant_role()',
         case when to_regprocedure('public.assert_can_grant_role(uuid,text)') is not null
              then 'PASS' else 'FAIL — شغّل docs/authz_identity_hardening_s4pre_RUNME.sql' end,
         ''
  union all
  select 10, 3, '1. s4pre · can_manage_identity لا تعتمد can_manage_projects',
         case when coalesce(pg_get_functiondef(to_regprocedure('public.can_manage_identity()')), '')
                   ilike '%can_manage_projects%'
              then 'FAIL — بوّابة الهويّة ما زالت مربوطة ببوّابة المشاريع' else 'PASS' end,
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
  select 20, 3, '2. S4a · mfa_write_ok تبدأ بـ service_role',
         case when coalesce(pg_get_functiondef(to_regprocedure('public.mfa_write_ok()')), '') like '%service_role%'
              then 'PASS' else 'FAIL — المُسنِد ليس التعريف المتوقَّع' end, ''
  union all
  select 20, 4, '2. S4a · mfa_write_ok تفشل مفتوحةً (return true في المعالج)',
         case when coalesce(pg_get_functiondef(to_regprocedure('public.mfa_write_ok()')), '') like '%exception when others%'
              then 'PASS — المجهول = اسمح (مقصود) · ولهذا يلزم المحور 0' else 'WARN — راجع يدويًّا' end, ''
  union all
  select 20, 5, '2. ★ S4a · mfa_write_ok · prosecdef + قراءة العوامل + مقارنة aal2',
         case
           when (select p.prosecdef from pg_proc p, gate where p.oid = gate.goid) is not true
                then 'FAIL حرج — ليست SECURITY DEFINER ⇒ تعمل بصلاحيات المتصل ⇒ لا تقرأ العوامل أبدًا'
           when coalesce(pg_get_functiondef(to_regprocedure('public.mfa_write_ok()')), '') not ilike '%mfa_factors%'
                then 'FAIL حرج — الجسم الحيّ لا يقرأ auth.mfa_factors (انحراف عن S4a)'
           when coalesce(pg_get_functiondef(to_regprocedure('public.mfa_write_ok()')), '') not like '%aal2%'
                then 'FAIL حرج — الجسم الحيّ لا يقارن aal2 ⇒ لا شرط منع فيه أصلًا'
           else 'PASS'
         end,
         'proconfig=' || coalesce((select coalesce(array_to_string(p.proconfig, ' , '), '(بلا search_path)')
                                     from pg_proc p, gate where p.oid = gate.goid), '?')

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

  -- ── 4 · إصلاح B مُطبَّق على السبع (شرط ترتيب) ─────────────────────────────
  union all
  select 40, ord, '4. ★ إصلاح B · ' || label,
         case
           when def is null then 'FAIL — الدالّة غير موجودة'
           when def not like '%can_manage_identity%' then 'FAIL — لا تُشغّل S4b: سيُلغي إصلاح B صامتًا. شغّل docs/authz_fixB_identity_permissions_RUNME.sql أولًا'
           when def ilike '%can_manage_projects%'    then 'FAIL — ما زالت تقبل can_manage_projects'
           else 'PASS'
         end,
         'المصدر: docs/authz_fixB_identity_permissions_RUNME.sql'
  from d where ord between 3 and 9

  -- ── 5 · الدوالّ التسع موجودة بصِيَغها الدقيقة ──────────────────────────────
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
  select 80, 1, '8. ★ enforcement_mode',
         case when coalesce((select enforcement_mode from public.mfa_settings where id = 1), '') = 'enrollment'
              then 'PASS — enrollment'
              else 'FAIL — ' || coalesce((select enforcement_mode from public.mfa_settings where id = 1), '(لا صفّ id=1)')
                   || ' ⇒ البوّابة لا تمنع أحدًا، وعرض المنع غير ممكن' end,
         'القيم المشروعة: off | enrollment · الإطفاء: update public.mfa_settings set enforcement_mode = ''off'' where id = 1;'

  -- ── 9 · الحسابات المتميّزة وعوامل TOTP المُفعَّلة ──────────────────────────
  union all
  select 90, 1, '9. عدد الحسابات المتميّزة (admin أو super_admin)',
         (select count(*)::text from public.profiles
           where account_type = 'admin' or staff_role = 'super_admin'),
         'هؤلاء وحدهم في نطاق البوّابة (mfa_write_ok الخطوة 4)'
  union all
  select 90, 2, '9. ★ منهم من يملك عاملًا TOTP مُفعَّلًا (القابلون للمنع)',
         (select count(*)::text from public.profiles p
           where (p.account_type = 'admin' or p.staff_role = 'super_admin')
             and exists (select 1 from auth.mfa_factors f
                          where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp')),
         '★ هؤلاء وحدهم يمكن أن تمنعهم البوّابة. صفر ⇒ لا إقفال ممكن ولا عرض منع ممكن'
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
  select 100, 1, '10. بصمة الصلاحيات (الدوالّ التسع)',
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

  -- ── 11 · حالة anon المعروفة — تنبيه لا رفض ────────────────────────────────
  union all
  select 110, 1, '11. anon · EXECUTE على الدوالّ التسع',
         coalesce((select string_agg(d2.label, ' , ' order by d2.ord) from d d2
                    where d2.pid is not null and has_function_privilege('anon', d2.pid::oid, 'execute')),
                  '(لا شيء — سليم)'),
         'موروث من PUBLIC حيث لا REVOKE صريح — وضع سابق لـS4b وليس من صنعه. عالجه بقرار منفصل؛ ولا تُصدر revoke ... from public أعمى.'
  union all
  select 110, 2, '11. anon · EXECUTE على المُسنِد والرافع',
         case when coalesce(has_function_privilege('anon', to_regprocedure('public.mfa_write_ok()')::oid, 'execute'), false)
                or coalesce(has_function_privilege('anon', to_regprocedure('public.mfa_require_aal2(text)')::oid, 'execute'), false)
              then 'FAIL — S4a يمنعهما صراحةً' else 'PASS' end, ''
  union all
  select 110, 3, '11. anon · EXECUTE المقصود على مسنِدات النماذج العامّة',
         coalesce((select string_agg(x.f, ' , ' order by x.f) from (values
            ('can_manage_quotes'), ('can_see_invoices'), ('can_see_opportunities')) as x(f)
           where coalesce(has_function_privilege('anon', to_regprocedure('public.' || x.f || '()')::oid, 'execute'), false)),
           '(لا شيء — انحراف: كان المتوقَّع الثلاثة)'),
         'مقصود — سحبه قد يكسر النماذج العامّة. مذكور هنا لكشف الانحراف لا لتغييره.'
)
select "المحور", "النتيجة", "التفاصيل"
from rows_out
order by ord, sub;

-- ─────────────────────────────────────────────────────────────────────────────
-- (ب) ★ الرفض ★ — قراءة محضة، لا تكتب ولا تُنشئ ولا تحذف شيئًا.
--     ترفع استثناءً عند أوّل خلل. لا تُشغّل S4b قبل أن تمرّ هذه الكتلة بصمت.
-- ─────────────────────────────────────────────────────────────────────────────
do $refuse$
declare
  sigs text[] := array[
    'public.admin_set_staff_role(uuid,text)',
    'public.admin_set_account(uuid,text,text,text,uuid)',
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)',
    'public.admin_copy_profession_permissions(uuid,uuid)',
    'public.admin_apply_profession_template(uuid,text)'
  ];
  fixb text[] := array[
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)',
    'public.admin_copy_profession_permissions(uuid,uuid)',
    'public.admin_apply_profession_template(uuid,text)'
  ];
  s        text;
  d        text;
  miss     text := '';
  v_owner  text;
  v_bypass boolean;
  v_rls    boolean;
  v_mode   text;
  v_denyable int;
  v_att    text;
  v_when   date;
begin
  -- ═══ R1 · البوّابة موجودة وبنيتها سليمة ═══════════════════════════════════
  if to_regprocedure('public.mfa_write_ok()') is null then
    raise exception 'رفض R1: public.mfa_write_ok() غير موجودة — شغّل docs/mfa_write_gate_s4a_RUNME.sql أولًا';
  end if;
  if to_regprocedure('public.mfa_require_aal2(text)') is null then
    raise exception 'رفض R1: public.mfa_require_aal2(text) غير موجودة — شغّل docs/mfa_write_gate_s4a_RUNME.sql أولًا';
  end if;
  if to_regprocedure('public.can_manage_identity()') is null then
    raise exception 'رفض R1: public.can_manage_identity() غير موجودة — شغّل docs/authz_identity_hardening_s4pre_RUNME.sql أولًا';
  end if;
  if to_regclass('public.mfa_settings') is null then
    raise exception 'رفض R1: public.mfa_settings غير موجود — شغّل docs/mfa_foundation_batch_s1_RUNME.sql أولًا';
  end if;
  if to_regclass('auth.mfa_factors') is null then
    raise exception 'رفض R1: auth.mfa_factors غير مرئي لهذه الجلسة — شغّل الملفّ في محرّر SQL بدور postgres';
  end if;

  if not (select p.prosecdef from pg_proc p where p.oid = to_regprocedure('public.mfa_write_ok()')::oid) then
    raise exception 'رفض R1: mfa_write_ok ليست SECURITY DEFINER ⇒ تعمل بصلاحيات المتصل، ولا متصل يقرأ auth.mfa_factors ⇒ البوّابة لن تمنع أحدًا أبدًا';
  end if;
  d := pg_get_functiondef(to_regprocedure('public.mfa_write_ok()'));
  if d not ilike '%mfa_factors%' then
    raise exception 'رفض R1: جسم mfa_write_ok الحيّ لا يقرأ auth.mfa_factors — انحراف عن S4a، والبوّابة ليست ما يوثّقه المستودع';
  end if;
  if d not like '%aal2%' then
    raise exception 'رفض R1: جسم mfa_write_ok الحيّ لا يقارن aal2 — لا شرط منع فيه أصلًا';
  end if;

  -- ═══ R2 · ★ مالك البوّابة يستطيع فعلًا قراءة auth.mfa_factors ★ ═══════════
  select r.rolname, r.rolbypassrls into v_owner, v_bypass
    from pg_proc p join pg_roles r on r.oid = p.proowner
   where p.oid = to_regprocedure('public.mfa_write_ok()')::oid;
  if v_owner is null then
    raise exception 'رفض R2: تعذّر تحديد مالك mfa_write_ok';
  end if;
  if not has_schema_privilege(v_owner, 'auth', 'usage') then
    raise exception 'رفض R2: مالك البوّابة (%) لا يملك USAGE على مخطّط auth ⇒ قراءة العوامل تفشل ⇒ mfa_write_ok تُعيد true دائمًا (فشل مفتوح) ⇒ S4b سيربط قفلًا لا يُغلق', v_owner;
  end if;
  if not has_table_privilege(v_owner, to_regclass('auth.mfa_factors')::oid, 'select') then
    raise exception 'رفض R2 ★: مالك البوّابة (%) لا يملك SELECT على auth.mfa_factors ⇒ البوّابة **خاملة بنيويًّا**: كل نداء يفشل مفتوحًا ويُعيد true. امنح المالك SELECT على auth.mfa_factors (ولا تمنح anon/authenticated أبدًا) ثم أعد الفحص', v_owner;
  end if;

  -- ═══ R3 · لا RLS تُعمي المالك ═════════════════════════════════════════════
  select c.relrowsecurity into v_rls from pg_class c where c.oid = to_regclass('auth.mfa_factors')::oid;
  if coalesce(v_rls, false) and not coalesce(v_bypass, false) then
    raise exception 'رفض R3: RLS مفعّلة على auth.mfa_factors والمالك (%) لا يتجاوزها ⇒ يقرأ صفر صفوف ⇒ has_verified_factor=false دائمًا ⇒ البوّابة تسمح دائمًا', v_owner;
  end if;

  -- ═══ R4 · القيد غير القابل للتفاوض ════════════════════════════════════════
  if has_table_privilege('anon', to_regclass('auth.mfa_factors')::oid, 'select')
     or has_table_privilege('authenticated', to_regclass('auth.mfa_factors')::oid, 'select') then
    raise exception 'رفض R4 (أمني): anon أو authenticated يملك SELECT مباشرًا على auth.mfa_factors — اسحبه قبل أيّ شيء آخر';
  end if;
  if exists (
       select 1 from pg_attribute a
       cross join lateral aclexplode(a.attacl) x
       left join pg_roles r on r.oid = x.grantee
       where a.attrelid = to_regclass('auth.mfa_factors')::oid and a.attnum > 0 and a.attacl is not null
         and coalesce(r.rolname, 'PUBLIC') in ('anon', 'authenticated', 'PUBLIC')) then
    raise exception 'رفض R4 (أمني): يوجد منح على مستوى الأعمدة لـ anon/authenticated/PUBLIC على auth.mfa_factors';
  end if;
  if has_function_privilege('anon', 'public.mfa_write_ok()', 'execute')
     or has_function_privilege('anon', 'public.mfa_require_aal2(text)', 'execute') then
    raise exception 'رفض R4: anon يملك EXECUTE على المُسنِد/الرافع — S4a يمنعهما صراحةً، فهذا انحراف';
  end if;

  -- ═══ R5 · الوضع يسمح بالمنع أصلًا ═════════════════════════════════════════
  select enforcement_mode into v_mode from public.mfa_settings where id = 1;
  if coalesce(v_mode, '') <> 'enrollment' then
    raise exception 'رفض R5: enforcement_mode = % ⇒ mfa_write_ok تُعيد true عند الفرع الثاني دائمًا، فلا منع ولا إمكان لعرضه. اضبطه على enrollment أوّلًا (زرّ الطوارئ يبقى: update public.mfa_settings set enforcement_mode = ''off'' where id = 1;)', coalesce(v_mode, '(لا صفّ id=1)');
  end if;

  -- ═══ R6 · يوجد من يمكن منعه ═══════════════════════════════════════════════
  select count(*) into v_denyable from public.profiles p
   where (p.account_type = 'admin' or p.staff_role = 'super_admin')
     and exists (select 1 from auth.mfa_factors f
                  where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp');
  if v_denyable = 0 then
    raise exception 'رفض R6: لا حساب متميّز يملك عاملًا TOTP مُفعَّلًا ⇒ لا أحد يمكن أن تمنعه البوّابة ⇒ عرض المنع مستحيل. سجّل عامل المالك أوّلًا';
  end if;

  -- ═══ R7 · ★ إقرار مشاهدة المنع — بشريّ، وبالإضافة إلى ما سبق ★ ════════════
  v_att := coalesce(current_setting('kian.s4_deny_demonstrated', true), '');
  if v_att = '' then
    raise exception 'رفض R7: لم يُثبَت اتّجاه المنع بعد. شغّل docs/mfa_write_gate_s4_DIAGNOSTIC_RUNME.sql، ونفّذ mfa_gate_selftest() بحساب المالك عند aal1 مع عامل مُفعَّل، وتأكّد بعينك من allowed=false و reason=denied_aal1 و verdict=gate_can_deny، ثم أعد تشغيل هذا الفحص بعد سطر: set kian.s4_deny_demonstrated = ''deny-observed:YYYY-MM-DD'';';
  end if;
  if v_att !~ '^deny-observed:\d{4}-\d{2}-\d{2}$' then
    raise exception 'رفض R7: صيغة الإقرار غير صحيحة (%) — المطلوب حرفيًّا: deny-observed:YYYY-MM-DD', v_att;
  end if;
  begin
    v_when := substring(v_att from 15)::date;
  exception when others then
    raise exception 'رفض R7: تاريخ الإقرار غير صالح — %', v_att;
  end;
  if v_when > current_date then
    raise exception 'رفض R7: تاريخ الإقرار في المستقبل (%)', v_when;
  end if;
  if v_when < current_date - 14 then
    raise exception 'رفض R7: الإقرار عمره أكثر من 14 يومًا (%) — أعِد المشاهدة على الحالة الحيّة، فالقاعدة قد تكون تغيّرت تحته', v_when;
  end if;

  -- ═══ R8 · الترتيب: التسع موجودة · إصلاح A حيّ · إصلاح B حيّ · الطوارئ حرّ ══
  foreach s in array sigs loop
    if to_regprocedure(s) is null then miss := miss || ' ' || s; end if;
  end loop;
  if miss <> '' then
    raise exception 'رفض R8: دوالّ مفقودة بصِيَغها الدقيقة —%', miss;
  end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'));
  if d not like '%role_change_denied%' then
    raise exception 'رفض R8: إصلاح A غير مُطبَّق على admin_set_staff_role — S4b سيُلغيه صامتًا. شغّل docs/authz_fixA_super_admin_grant_RUNME.sql أولًا';
  end if;
  if d not like '%custody_officer%' then
    raise exception 'رفض R8: admin_set_staff_role الحيّة ليست التعريف الفائز (قائمة الأدوار الـ12 غائبة)';
  end if;
  if d not like '%protected owner account%' then
    raise exception 'رفض R8: سقطت حماية الحساب المالك من admin_set_staff_role';
  end if;

  foreach s in array fixb loop
    d := pg_get_functiondef(to_regprocedure(s));
    if d not like '%can_manage_identity%' then
      raise exception 'رفض R8: إصلاح B غير مُطبَّق على % — S4b سيُلغيه صامتًا. شغّل docs/authz_fixB_identity_permissions_RUNME.sql أولًا', s;
    end if;
    if d ilike '%can_manage_projects%' then
      raise exception 'رفض R8: % ما زالت تقبل can_manage_projects (إصلاح B غير مُطبَّق)', s;
    end if;
  end loop;

  if to_regprocedure('public.mfa_admin_set_mode(text)') is not null
     and pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)')) ilike '%mfa_require_aal2%' then
    raise exception 'رفض R8: mfa_admin_set_mode مبوَّبة — زرّ الطوارئ خلف القفل الذي يفتحه. أزل البوّابة عنها قبل المتابعة';
  end if;

  -- ═══ تنبيهات لا ترفض ══════════════════════════════════════════════════════
  if to_regprocedure('public.mfa_gate_selftest()') is not null then
    raise warning '⚠️ مِسبار التشخيص ما زال موجودًا — شغّل docs/mfa_write_gate_s4_DIAGNOSTIC_CLEANUP.sql بعد القبول';
  end if;
  declare v_anon text;
  begin
    -- ملاحظة: اسم العمود هنا `fsig` لا `s` — لأن `s` متغيّر plpgsql معلَن أعلاه،
    -- ولو تطابق الاسمان لرفع المحرّك «column reference is ambiguous».
    select string_agg(p.proname, ', ') into v_anon
      from unnest(sigs) as u(fsig)
      join pg_proc p on p.oid = to_regprocedure(u.fsig)::oid
     where has_function_privilege('anon', p.oid, 'execute');
    if v_anon is not null then
      raise warning '⚠️ anon يملك EXECUTE موروثًا من PUBLIC على: % — وضع سابق لـS4b، عالجه بقرار منفصل ولا تُصدر revoke ... from public أعمى', v_anon;
    end if;
  end;

  raise notice '✓ الفحص القبْليّ اجتاز R1..R8:';
  raise notice '  · البوّابة SECURITY DEFINER وجسمها يقرأ العوامل ويقارن aal2';
  raise notice '  · مالكها (%) يملك USAGE(auth) و SELECT على auth.mfa_factors ⇒ **قادرة على المنع**', v_owner;
  raise notice '  · لا anon ولا authenticated يملك SELECT مباشرًا (جدولًا أو عمودًا)';
  raise notice '  · enforcement_mode = enrollment · حسابات قابلة للمنع = %', v_denyable;
  raise notice '  · إقرار مشاهدة المنع بتاريخ % (ضمن 14 يومًا)', v_when;
  raise notice '  · التسع موجودة · إصلاح A حيّ · إصلاح B حيّ على السبع · mfa_admin_set_mode بلا بوّابة';
  raise notice '  ⇒ يجوز الآن تشغيل docs/mfa_write_gate_s4b_RUNME.sql';
  raise notice '  ⚠️ احفظ بصمتَي الصلاحيات وسياسات RLS من الجزء (أ) لمقارنتهما في الفحص البعْديّ';
end $refuse$;
