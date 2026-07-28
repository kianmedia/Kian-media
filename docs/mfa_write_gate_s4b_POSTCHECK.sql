-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — S4b · فحص بعْديّ **للقراءة فقط** — لا يغيّر شيئًا إطلاقًا
-- docs/mfa_write_gate_s4b_bind_POSTCHECK.sql
-- ════════════════════════════════════════════════════════════════════════════
--   شغّله **بعد** docs/mfa_write_gate_s4b_bind_RUNME.sql.
--   لا begin/commit · لا create · لا insert/update/delete · لا جدول مؤقّت.
--   الجزء (أ) استعلام واحد يطبع كل المحاور بـ PASS/FAIL.
--   الجزء (ب) كتلة DO تُعيد الفحوص الحرجة وترفع استثناءً عند أيّ FAIL — لتفشل
--             بصوتٍ عالٍ إن قرأت الجدول بسرعة. الكتلة قراءة محضة (لا كتابة).
--   ★ قارن صفَّي «بصمة الصلاحيات» و«بصمة سياسات RLS» بناتج الفحص القبْليّ:
--     يجب أن يتطابقا حرفيًّا — S4b لا يمسّ صلاحية ولا سياسة.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- (أ) لوحة النتائج
-- ─────────────────────────────────────────────────────────────────────────────
with sig(ord, label, sig, op) as (values
  (1, 'admin_set_staff_role',            'public.admin_set_staff_role(uuid,text)',                    'admin_set_staff_role'),
  (2, 'admin_set_account',               'public.admin_set_account(uuid,text,text,text,uuid)',        'admin_set_account'),
  (3, 'admin_upsert_profession',         'public.admin_upsert_profession(jsonb)',                     'admin_upsert_profession'),
  (4, 'admin_set_employee_professions',  'public.admin_set_employee_professions(uuid,uuid[])',        'admin_set_employee_professions'),
  (5, 'admin_set_profession_permission', 'public.admin_set_profession_permission(uuid,text,boolean)', 'admin_set_profession_permission'),
  (6, 'admin_set_employee_override',     'public.admin_set_employee_override(uuid,text,text,text)',   'admin_set_employee_override'),
  (7, 'admin_delete_profession',         'public.admin_delete_profession(uuid,boolean)',              'admin_delete_profession')
),
d as (
  select s.ord, s.label, s.sig, s.op,
         to_regprocedure(s.sig)                     as pid,
         pg_get_functiondef(to_regprocedure(s.sig)) as def
  from sig s
),
rows_out(ord, sub, "المحور", "النتيجة", "التفاصيل") as (

  -- 1 · البوّابة حاضرة مرّة واحدة بالضبط وباسم العملية الصحيح
  select 10, ord, '1. البوّابة · ' || label,
         case
           when def is null then 'FAIL — الدالّة غير موجودة'
           when (length(def) - length(replace(def,'mfa_require_aal2',''))) / length('mfa_require_aal2') <> 1
                then 'FAIL — عدد الاستدعاءات ≠ 1'
           when def not like ('%mfa_require_aal2(''' || op || ''')%')
                then 'FAIL — اسم العملية غير مطابق'
           else 'PASS — بوّابة واحدة باسم ' || op
         end,
         sig
  from d

  -- 2 · إصلاح A لم يُلغَ + كل حارس أصلي في admin_set_staff_role
  union all
  select 20, 1, '2. ★ إصلاح A لم يُلغَ (role_change_denied)',
         case when (select def from d where ord=1) like '%role_change_denied%' then 'PASS' else 'FAIL حرج — S4b ألغى إصلاح A' end, ''
  union all
  select 20, 2, '2. admin_set_staff_role · can_manage_staff',
         case when (select def from d where ord=1) like '%can_manage_staff%' then 'PASS' else 'FAIL' end, ''
  union all
  select 20, 3, '2. admin_set_staff_role · منع التغيير الذاتي',
         case when (select def from d where ord=1) like '%cannot change your own staff role%' then 'PASS' else 'FAIL' end, ''
  union all
  select 20, 4, '2. admin_set_staff_role · حماية الحساب المالك',
         case when (select def from d where ord=1) like '%protected owner account%' then 'PASS' else 'FAIL' end, ''
  union all
  select 20, 5, '2. admin_set_staff_role · قائمة الأدوار الـ12',
         case when (select def from d where ord=1) like '%custody_officer%' then 'PASS' else 'FAIL' end, ''
  union all
  select 20, 6, '2. admin_set_staff_role · البوّابة بعد فحص التفويض',
         case when position('protected owner account' in (select def from d where ord=1))
                 < position('mfa_require_aal2'        in (select def from d where ord=1))
              then 'PASS — غير المُفوَّض يتلقّى خطأ التفويض لا مطالبة MFA' else 'FAIL — ترتيب معكوس' end, ''

  -- 3 · admin_set_account · كل حارس أصلي
  union all
  select 30, 1, '3. admin_set_account · is_admin',
         case when (select def from d where ord=2) like '%admin only%' then 'PASS' else 'FAIL' end, ''
  union all
  select 30, 2, '3. admin_set_account · فحوص account_type/status/level',
         case when (select def from d where ord=2) like '%invalid account_type%'
               and (select def from d where ord=2) like '%invalid account_status%'
               and (select def from d where ord=2) like '%invalid client_level%' then 'PASS' else 'FAIL' end, ''
  union all
  select 30, 3, '3. admin_set_account · قصر admin على البريدَين',
         case when (select def from d where ord=2) like '%two approved emails%' then 'PASS' else 'FAIL' end, ''
  union all
  select 30, 4, '3. admin_set_account · فحص الشركة',
         case when (select def from d where ord=2) like '%company not found or deleted%' then 'PASS' else 'FAIL' end, ''
  union all
  select 30, 5, '3. admin_set_account · البوّابة بعد فحوص التفويض',
         case when position('two approved emails' in (select def from d where ord=2))
                 < position('mfa_require_aal2'    in (select def from d where ord=2))
              then 'PASS' else 'FAIL — ترتيب معكوس' end, ''

  -- 4 · إصلاح B لم يُلغَ على الخمس
  union all
  select 40, ord, '4. ★ إصلاح B لم يُلغَ · ' || label,
         case
           when def not like '%can_manage_identity%' then 'FAIL حرج — S4b ألغى إصلاح B'
           when def ilike '%can_manage_projects%'    then 'FAIL حرج — عادت تقبل can_manage_projects'
           when position('can_manage_identity' in def) > position('mfa_require_aal2' in def)
                then 'FAIL — البوّابة سبقت فحص التفويض'
           else 'PASS'
         end, ''
  from d where ord between 3 and 7

  -- 5 · الحرّاس الخاصّة بكل دالّة من الخمس
  union all
  select 50, 1, '5. admin_upsert_profession · مفتاح مكرّر/المهنة غير موجودة/أعلام perm_*/تدقيق',
         case when (select def from d where ord=3) like '%المفتاح مستخدم بالفعل%'
               and (select def from d where ord=3) like '%المهنة غير موجودة%'
               and (select def from d where ord=3) like '%perm_manage_custody%'
               and (select def from d where ord=3) like '%profession.upserted%' then 'PASS' else 'FAIL' end, ''
  union all
  select 50, 2, '5. admin_set_employee_professions · وجود الموظف/تدقيق',
         case when (select def from d where ord=4) like '%الموظف غير موجود%'
               and (select def from d where ord=4) like '%employee.professions_changed%' then 'PASS' else 'FAIL' end, ''
  union all
  select 50, 3, '5. admin_set_profession_permission · system_only/sensitive⇒is_owner/تدقيق',
         case when (select def from d where ord=5) like '%system_only%'
               and (select def from d where ord=5) like '%is_owner%'
               and (select def from d where ord=5) like '%profession.permission_changed%' then 'PASS' else 'FAIL' end, ''
  union all
  select 50, 4, '5. admin_set_employee_override · system_only/sensitive⇒is_owner/تدقيق',
         case when (select def from d where ord=6) like '%system_only%'
               and (select def from d where ord=6) like '%is_owner%'
               and (select def from d where ord=6) like '%employee.permission_override%' then 'PASS' else 'FAIL' end, ''
  union all
  select 50, 5, '5. admin_delete_profession · requires_confirm/deleted/archived',
         case when (select def from d where ord=7) like '%requires_confirm%'
               and (select def from d where ord=7) like '%profession.deleted%'
               and (select def from d where ord=7) like '%profession.archived%' then 'PASS' else 'FAIL' end, ''
  union all
  select 50, 6, '5. admin_delete_profession · المعاينة قبل البوّابة',
         case when position('requires_confirm' in (select def from d where ord=7))
                 < position('mfa_require_aal2' in (select def from d where ord=7))
              then 'PASS — التقرير التقريري بلا مطالبة MFA' else 'FAIL' end, ''

  -- 6 · ★ mfa_admin_set_mode ما زالت بلا بوّابة ★
  union all
  select 60, 1, '6. ★ mfa_admin_set_mode بلا بوّابة (زرّ الطوارئ)',
         case
           when to_regprocedure('public.mfa_admin_set_mode(text)') is null then 'FAIL — غير موجودة'
           when pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)')) ilike '%mfa_require_aal2%'
                then 'FAIL حرج — مبوَّبة: تراجع فورًا'
           else 'PASS — غير مبوَّبة'
         end,
         'قفلها يعني أن مالكًا فقد جهاز المصادقة لا يستطيع الإطفاء أبدًا'

  -- 7 · لا دالّة خارج القائمة السبعة صارت مبوَّبة
  union all
  select 70, 1, '7. نطاق الربط محصور في السبعة',
         case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.prokind = 'f'
                       and pg_get_functiondef(p.oid) ilike '%mfa_require_aal2%'
                       and p.proname not in ('mfa_require_aal2',
                             'admin_set_staff_role','admin_set_account','admin_upsert_profession',
                             'admin_set_employee_professions','admin_set_profession_permission',
                             'admin_set_employee_override','admin_delete_profession')) = 0
              then 'PASS — سبع دوالّ فقط' else 'انتبه — دالّة خارج القائمة مبوَّبة (قد تكون دفعة لاحقة مقصودة)' end,
         coalesce((select string_agg(p.proname, ', ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname='public' and p.prokind='f'
                      and pg_get_functiondef(p.oid) ilike '%mfa_require_aal2%'
                      and p.proname not in ('mfa_require_aal2',
                            'admin_set_staff_role','admin_set_account','admin_upsert_profession',
                            'admin_set_employee_professions','admin_set_profession_permission',
                            'admin_set_employee_override','admin_delete_profession')), '(لا شيء)')

  -- 8 · الصلاحيات لم تتغيّر
  union all
  select 80, 1, '8. authenticated يحتفظ بـ EXECUTE على السبعة',
         case when (select bool_and(has_function_privilege('authenticated', pid::oid, 'execute')) from d)
              then 'PASS' else 'FAIL — كسر في الواجهة: راجع فورًا' end, ''
  union all
  select 80, 2, '8. anon ممنوع على الأربع ذات المنع الصريح',
         case when (select bool_or(has_function_privilege('anon', pid::oid, 'execute'))
                    from d where label in ('admin_set_staff_role','admin_set_account',
                                           'admin_upsert_profession','admin_delete_profession'))
              then 'FAIL أمني — anon يملك EXECUTE' else 'PASS' end,
         'المصادر: phase1_addendum_s1.sql:171 · portal_custody_v2…PATCH:58 · professions_grants…:89 · profession_delete_RUNME:58'
  union all
  select 80, 3, '8. تنبيه معروف — ثلاث دوالّ بلا REVOKE صريح',
         case when (select bool_and(has_function_privilege('anon', pid::oid, 'execute'))
                    from d where label in ('admin_set_employee_professions',
                                           'admin_set_profession_permission','admin_set_employee_override'))
              then 'موروث من PUBLIC (وضع سابق لـ S4b — ليس من صنعه)'
              else 'ممنوع (وضع أضيق من المتوقَّع — لا بأس)' end,
         'هذه الثلاث لا REVOKE صريح لها في المستودع. S4b لم يضف ولم يحذف أيّ منح. عالجها بقرار منفصل، ولا تُصدر revoke ... from public أعمى (يقتل الاستدعاء عبر authenticated الموروث).'
  union all
  select 80, 4, '8. ★ بصمة الصلاحيات (قارنها بالفحص القبْليّ)',
         md5(coalesce((select string_agg(coalesce(array_to_string(p.proacl,','),'(افتراضي PUBLIC)'), '|' order by d2.ord)
                       from d d2 join pg_proc p on p.oid = d2.pid::oid), 'none')),
         coalesce((select string_agg(d2.label || ' => ' ||
                    coalesce(array_to_string(p.proacl,' , '), '(بلا ACL صريح ⇒ EXECUTE موروث لـ PUBLIC)'),
                    E'\n' order by d2.ord)
                   from d d2 join pg_proc p on p.oid = d2.pid::oid), '(تعذّرت القراءة)')

  -- 9 · لا سياسة SELECT (ولا أيّ سياسة) تغيّرت
  union all
  select 90, 1, '9. ★ بصمة سياسات RLS (قارنها بالفحص القبْليّ)',
         md5(coalesce((select string_agg(schemaname||'.'||tablename||'.'||policyname||'|'||cmd||'|'||
                                         coalesce(qual,'')||'|'||coalesce(with_check,''), E'\n'
                                         order by schemaname, tablename, policyname)
                       from pg_policies), 'none')),
         'عدد السياسات: ' || (select count(*)::text from pg_policies) ||
         ' · منها SELECT: ' || (select count(*)::text from pg_policies where cmd in ('SELECT','ALL'))
  union all
  select 90, 2, '9. لا سياسة تستدعي البوّابة',
         case when exists (select 1 from pg_policies
                            where coalesce(qual,'') || coalesce(with_check,'') ilike '%mfa_require_aal2%')
              then 'FAIL — سياسة تستدعي البوّابة' else 'PASS — لا سياسة تمسّها' end, ''

  -- 10 · السياق التشغيلي
  union all
  select 100, 1, '10. enforcement_mode',
         coalesce((select enforcement_mode from public.mfa_settings where id = 1), '(لا صفّ id=1)'),
         'البوّابة لا تمنع إلّا عند enrollment'
  union all
  select 100, 2, '10. حسابات متميّزة تملك عاملًا مُفعَّلًا (القابلون للمنع)',
         (select count(*)::text from public.profiles p
           where (p.account_type = 'admin' or p.staff_role = 'super_admin')
             and exists (select 1 from auth.mfa_factors f
                          where f.user_id = p.id and f.status = 'verified' and f.factor_type = 'totp')),
         'من لا يملك عاملًا يمرّ دائمًا (mfa_write_ok الخطوة 5) ⇒ لا إقفال ممكن'
)
select "المحور", "النتيجة", "التفاصيل"
from rows_out
order by ord, sub;

-- ─────────────────────────────────────────────────────────────────────────────
-- (ب) فشل صاخب عند أيّ خلل حرج — قراءة محضة، لا تكتب شيئًا
-- ─────────────────────────────────────────────────────────────────────────────
do $post$
declare
  sigs text[] := array[
    'public.admin_set_staff_role(uuid,text)',
    'public.admin_set_account(uuid,text,text,text,uuid)',
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)'
  ];
  ops text[] := array[
    'admin_set_staff_role','admin_set_account','admin_upsert_profession',
    'admin_set_employee_professions','admin_set_profession_permission',
    'admin_set_employee_override','admin_delete_profession'
  ];
  i int; s text; d text;
begin
  for i in 1 .. array_length(sigs,1) loop
    s := sigs[i];
    d := pg_get_functiondef(to_regprocedure(s));
    if d is null then raise exception 'فشل: % غير موجودة', s; end if;
    if (length(d) - length(replace(d,'mfa_require_aal2',''))) / length('mfa_require_aal2') <> 1 then
      raise exception 'فشل: عدد استدعاءات البوّابة في % ليس 1', s;
    end if;
    if d not like ('%mfa_require_aal2(''' || ops[i] || ''')%') then
      raise exception 'فشل: اسم العملية في % ليس %', s, ops[i];
    end if;
    if not has_function_privilege('authenticated', to_regprocedure(s)::oid, 'execute') then
      raise exception 'فشل: authenticated فقد EXECUTE على %', s;
    end if;
  end loop;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'));
  if d not like '%role_change_denied%'                then raise exception 'فشل حرج: إصلاح A أُلغي'; end if;
  if d not like '%can_manage_staff%'                  then raise exception 'فشل: سقطت can_manage_staff'; end if;
  if d not like '%cannot change your own staff role%' then raise exception 'فشل: سقط منع التغيير الذاتي'; end if;
  if d not like '%protected owner account%'           then raise exception 'فشل: سقطت حماية الحساب المالك'; end if;
  if d not like '%custody_officer%'                   then raise exception 'فشل: سقطت الأدوار الـ12'; end if;

  d := pg_get_functiondef(to_regprocedure('public.admin_set_account(uuid,text,text,text,uuid)'));
  if d not like '%admin only%'                   then raise exception 'فشل: سقطت is_admin'; end if;
  if d not like '%two approved emails%'          then raise exception 'فشل: سقط قصر admin على البريدَين'; end if;
  if d not like '%company not found or deleted%' then raise exception 'فشل: سقط فحص الشركة'; end if;

  foreach s in array array[
    'public.admin_upsert_profession(jsonb)',
    'public.admin_set_employee_professions(uuid,uuid[])',
    'public.admin_set_profession_permission(uuid,text,boolean)',
    'public.admin_set_employee_override(uuid,text,text,text)',
    'public.admin_delete_profession(uuid,boolean)'
  ] loop
    d := pg_get_functiondef(to_regprocedure(s));
    if d not like '%can_manage_identity%' then raise exception 'فشل حرج: إصلاح B أُلغي على %', s; end if;
    if d ilike  '%can_manage_projects%'   then raise exception 'فشل حرج: % عادت تقبل can_manage_projects', s; end if;
  end loop;

  if to_regprocedure('public.mfa_admin_set_mode(text)') is not null
     and pg_get_functiondef(to_regprocedure('public.mfa_admin_set_mode(text)')) ilike '%mfa_require_aal2%' then
    raise exception 'فشل حرج: mfa_admin_set_mode صارت مبوَّبة — تراجع فورًا';
  end if;

  -- نطاق الربط: تحذير لا استثناء (دفعة لاحقة قد تُبوّب دوالّ أخرى بحقّ)
  declare v_extra text;
  begin
    select string_agg(p.proname, ', ') into v_extra
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.prokind='f'
       and pg_get_functiondef(p.oid) ilike '%mfa_require_aal2%'
       and p.proname not in ('mfa_require_aal2', 'admin_set_staff_role','admin_set_account',
             'admin_upsert_profession','admin_set_employee_professions',
             'admin_set_profession_permission','admin_set_employee_override','admin_delete_profession');
    if v_extra is not null then
      raise warning '⚠️ دوالّ خارج القائمة السبعة مبوَّبة: %', v_extra;
    end if;
  end;

  if exists (select 1 from pg_policies
              where coalesce(qual,'') || coalesce(with_check,'') ilike '%mfa_require_aal2%') then
    raise exception 'فشل: سياسة RLS تستدعي البوّابة — S4b لا يمسّ السياسات';
  end if;

  raise notice '✓ الفحص البعْديّ: السبعة مبوَّبة · إصلاح A حيّ · إصلاح B حيّ · لا حارس ساقط · mfa_admin_set_mode بلا بوّابة · لا سياسة مسّها · authenticated يحتفظ بالتنفيذ';
  raise notice '  ⚠️ بقي عليك مقارنة بصمتَي الصلاحيات وسياسات RLS بعينك مع ناتج الفحص القبْليّ';
end $post$;