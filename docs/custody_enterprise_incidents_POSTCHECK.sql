-- ════════════════════════════════════════════════════════════════════════════
-- CUSTODY ENTERPRISE · INCIDENTS — POSTCHECK. يقرأ ولا يكتب.
-- نطاقه هذه الحزمة وحدها. ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ⛔ ولا يُستدعى `custody_run_alerts()` هنا: تشغيله يُنشئ إشعارات حقيقية.
-- ════════════════════════════════════════════════════════════════════════════

select 'الجداول الثلاثة + RLS' as check,
       case when count(*) filter (where c.relrowsecurity) = 3 then '✅ 3/3'
            else '🔴 '||count(*) filter (where c.relrowsecurity)::text||'/3' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries');

-- الأعمدة والقيود الحاسمة
select 'أعمدة الحجز على الأصول' as check,
       case when count(*)=2 then '✅ on_hold + hold_reason' else '🔴 ناقصة' end as result
from information_schema.columns
where table_schema='public' and table_name::text='custody_inventory_assets'
  and column_name::text in ('on_hold','hold_reason');

select 'on_hold: not null default false' as check,
       case when is_nullable='NO' and column_default like '%false%' then '✅'
            else '🔴 '||coalesce(is_nullable,'?')||'/'||coalesce(column_default,'(بلا افتراض)') end as result
from information_schema.columns
where table_schema='public' and table_name::text='custody_inventory_assets' and column_name::text='on_hold';

select 'تفرّد رقم الحادثة ومفتاح إزالة التكرار' as check,
       case when count(*)=2 then '✅ 2/2' else '🔴 '||count(*)::text||'/2' end as result
from pg_constraint con join pg_class r on r.oid=con.conrelid
where con.contype='u'
  and ((r.relname='custody_incidents'        and pg_get_constraintdef(con.oid) ilike '%incident_number%')
    or (r.relname='custody_alert_deliveries' and pg_get_constraintdef(con.oid) ilike '%dedup_key%'));

select 'قيود CHECK على النوع والحالة' as check,
       case when count(*) >= 3 then '✅' else '🔴 '||count(*)::text||' — راجع incident_type/status/channel' end as result
from pg_constraint con join pg_class r on r.oid=con.conrelid
where con.contype='c'
  and r.relname in ('custody_incidents','custody_alert_deliveries');

select 'المفاتيح الأجنبية' as check,
       case when count(*) >= 5 then '✅' else '🔴 '||count(*)::text||' — راجع الربط' end as result
from pg_constraint con join pg_class r on r.oid=con.conrelid
where con.contype='f' and r.relname in ('custody_incidents','custody_incident_actions');

select 'الفهارس' as check,
       case when count(*)=3 then '✅ 3/3' else '🔴 '||count(*)::text||'/3' end as result
from pg_indexes
where schemaname='public'
  and indexname in ('idx_civ_incidents_status','idx_civ_incidents_asset','idx_civ_alert_deliv');

-- 🔴 المُشغِّل: الجدول الصحيح · الدالّة الصحيحة · وحدثٌ يشمل تعديل asset_id.
select 'مُشغِّل الحجز' as check,
       case
         when t.tgname is null then '🔴 مفقود'
         when c.relname <> 'custody_inventory_assignment_items' then '🔴 على جدول خاطئ: '||c.relname
         when p.proname <> 'civ_item_hold_check' then '🔴 يستدعي دالّة خاطئة: '||p.proname
         -- 4 = INSERT، 16 = UPDATE ضمن tgtype
         when (t.tgtype & 4) = 0 then '🔴 لا يعمل على الإدراج'
         when (t.tgtype & 16) = 0 then '🔴 لا يعمل على التحديث — تغيير asset_id يتجاوز الحجز'
         else '✅ insert + update of asset_id على الجدول الصحيح' end as result
from (select 1) x
left join pg_trigger t on t.tgname='trg_civ_item_hold' and not t.tgisinternal
left join pg_class c on c.oid=t.tgrelid
left join pg_proc  p on p.oid=t.tgfoid;

-- الدوالّ بتواقيعها الدقيقة (oidvectortypes لا identity_arguments)
with pkg(fname, fargs) as (
  values ('civ_item_hold_check',''),
         ('custody_inv_employee_report_incident','jsonb'),
         ('custody_inv_admin_incident_action','uuid, text, text, boolean'),
         ('civ_alert_once','text, text, text, uuid'),
         ('custody_run_alerts','')
)
select 'الدوالّ الخمس بتواقيعها' as check,
       case when count(*) filter (where p.oid is not null)=5 then '✅ 5/5'
            else '🔴 مفقودة: '||coalesce(string_agg(k.fname||'('||k.fargs||')', ', ')
                                          filter (where p.oid is null),'') end as result
from pkg k
left join pg_proc p on p.proname=k.fname and p.pronamespace='public'::regnamespace
      and pg_catalog.oidvectortypes(p.proargtypes)=k.fargs;

select 'SECURITY DEFINER بمسار مثبَّت' as check,
       case when count(*) filter (where p.prosecdef
                                    and coalesce(array_to_string(p.proconfig,','),'') like '%search_path=%') = count(*)
            then '✅ الكلّ محصَّن'
            else '🔴 دالّة بلا تحصين' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('civ_item_hold_check','custody_inv_employee_report_incident',
   'custody_inv_admin_incident_action','civ_alert_once','custody_run_alerts');

-- ⛔ ولا pg_temp في مسار أيّ منها.
select 'لا pg_temp في مسار البحث' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(p.proname,', ') end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('civ_item_hold_check','custody_inv_employee_report_incident',
   'custody_inv_admin_incident_action','civ_alert_once','custody_run_alerts')
  and coalesce(array_to_string(p.proconfig,','),'') ilike '%pg_temp%';

-- 🔴 ربط الحادثة بالأصل — يُفحص المصدر: لا بلاغ عن أصل ليس للموظّف.
select 'ربط الحادثة fail-closed' as check,
       case when p.prosrc ~* 'asset_not_in_assignment' and p.prosrc ~* 'asset_not_yours'
            then '✅ الأصل يجب أن يعود للموظّف/العهدة'
            else '🔴 يمكن ربط حادثة بأصل موظّف آخر' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname='custody_inv_employee_report_incident';

-- الصلاحيات الفعليّة — has_function_privilege لا role_routine_grants وحدها.
select 'صلاحيات التنفيذ الفعليّة' as check,
       case
         when to_regrole('anon') is null or to_regrole('authenticated') is null
           or to_regrole('service_role') is null then '🟡 دور مفقود — تحقّق يدويًّا'
         when has_function_privilege('anon', 'public.custody_inv_employee_report_incident(jsonb)', 'EXECUTE')
           or has_function_privilege('anon', 'public.custody_inv_admin_incident_action(uuid,text,text,boolean)', 'EXECUTE')
           or has_function_privilege('anon', 'public.custody_run_alerts()', 'EXECUTE')
           or has_function_privilege('anon', 'public.civ_alert_once(text,text,text,uuid)', 'EXECUTE')
              then '🔴 anon ينفّذ دالّة من الحزمة'
         when has_function_privilege('authenticated', 'public.custody_run_alerts()', 'EXECUTE')
           or has_function_privilege('authenticated', 'public.civ_alert_once(text,text,text,uuid)', 'EXECUTE')
              then '🔴 authenticated ينفّذ محرّك التنبيهات'
         when not has_function_privilege('authenticated', 'public.custody_inv_employee_report_incident(jsonb)', 'EXECUTE')
           or not has_function_privilege('authenticated', 'public.custody_inv_admin_incident_action(uuid,text,text,boolean)', 'EXECUTE')
              then '🔴 authenticated لا يملك دوالّ البلاغ/الإجراء'
         when not has_function_privilege('service_role', 'public.custody_run_alerts()', 'EXECUTE')
              then '🔴 service_role لا ينفّذ المحرّك'
         else '✅ anon=لا · authenticated=البلاغ والإجراء · service_role=المحرّك' end as result;

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 صلاحيات الجداول — **فعليّة** لا معلَنة
--
-- ★ لماذا لا يكفي `information_schema.role_table_grants` ★
--   ذلك العرض يسرد المنح **الصريحة** فقط. والصلاحية الفعليّة تشمل الموروث عن
--   PUBLIC وعن عضوية الأدوار، وACL الأعمدة لا يظهر فيه أصلًا. والمقياس الصحيح
--   `has_table_privilege` / `has_any_column_privilege` + كتالوج ACL لـPUBLIC
--   (وPUBLIC ليس دورًا، فلا تقبله دوالّ الصلاحيات إطلاقًا).
--
-- ★ ما أثبته Preview ★
--   anon = Dxtm · authenticated = rDxtm على جداول **لم يمنحها هذا الملفّ شيئًا**.
--   D=TRUNCATE · x=REFERENCES · t=TRIGGER · m=MAINTAIN (PostgreSQL 17+).
--   ⇒ RUNME صار يبدأ بـ`revoke all privileges`، وهذا القسم يُثبت أثره.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare
  v_tbl text; v_p text; v_privs text[];
  v_bad text[] := '{}';
begin
  -- ⚠️ MAINTAIN لم توجد قبل PostgreSQL 17، وتمريرها لخادم أقدم **خطأ** لا
  --    نتيجة سالبة. فتُضاف بالإصدار لا بالتمنّي.
  v_privs := array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  if current_setting('server_version_num')::int >= 170000 then
    v_privs := v_privs || 'MAINTAIN';
  end if;

  foreach v_tbl in array array['custody_incidents','custody_incident_actions','custody_alert_deliveries']
  loop
    if to_regclass('public.'||v_tbl) is null then
      v_bad := v_bad || (v_tbl||': الجدول مفقود'); continue;
    end if;

    foreach v_p in array v_privs loop
      -- anon: **لا شيء إطلاقًا**.
      if to_regrole('anon') is not null and has_table_privilege('anon','public.'||v_tbl, v_p) then
        v_bad := v_bad || format('anon يملك %s على %s', v_p, v_tbl);
      end if;
      -- authenticated: SELECT وحده.
      if to_regrole('authenticated') is not null then
        if v_p = 'SELECT' then
          if not has_table_privilege('authenticated','public.'||v_tbl, v_p) then
            v_bad := v_bad || format('authenticated لا يملك SELECT على %s', v_tbl);
          end if;
        elsif has_table_privilege('authenticated','public.'||v_tbl, v_p) then
          v_bad := v_bad || format('authenticated يملك %s على %s — العقد: قراءة فقط', v_p, v_tbl);
        end if;
      end if;
    end loop;

    -- PUBLIC: من الكتالوج مباشرةً (grantee = 0 في aclexplode).
    if exists (
      select 1 from pg_class c
        join pg_namespace n on n.oid = c.relnamespace,
        lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
       where n.nspname='public' and c.relname = v_tbl and a.grantee = 0)
    then v_bad := v_bad || format('PUBLIC يملك صلاحية مباشرة على %s', v_tbl); end if;

    -- ACL الأعمدة: غير مرئيّ لأيّ فحص جدوليّ — وهذا بالذات ما أفشل تدقيقًا سابقًا.
    if to_regrole('anon') is not null
       and has_any_column_privilege('anon','public.'||v_tbl,'SELECT,INSERT,UPDATE,REFERENCES') then
      v_bad := v_bad || format('anon يملك صلاحية على عمود في %s', v_tbl);
    end if;
    if to_regrole('authenticated') is not null
       and has_any_column_privilege('authenticated','public.'||v_tbl,'INSERT,UPDATE,REFERENCES') then
      v_bad := v_bad || format('authenticated يملك صلاحية كتابة على عمود في %s', v_tbl);
    end if;

    -- service_role: العقد يشترط بقاء القراءة (مسارات الخادم).
    if to_regrole('service_role') is not null
       and not has_table_privilege('service_role','public.'||v_tbl,'SELECT') then
      v_bad := v_bad || format('service_role لا يقرأ %s', v_tbl);
    end if;
  end loop;

  -- ⚠️ التسلسلات: المفاتيح uuid ⇒ المتوقَّع صفر. وإن وُجدت فلا صلاحية لأحدهما.
  if exists (
    select 1 from pg_class s
      join pg_namespace sn on sn.oid = s.relnamespace
      join pg_depend d on d.objid = s.oid and d.classid = 'pg_class'::regclass and d.deptype in ('a','i')
      join pg_class t on t.oid = d.refobjid
      join pg_namespace tn on tn.oid = t.relnamespace,
      lateral aclexplode(coalesce(s.relacl,'{}'::aclitem[])) a
     where s.relkind='S' and sn.nspname='public' and tn.nspname='public'
       and t.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries')
       and (a.grantee = 0 or a.grantee in (to_regrole('anon')::oid, to_regrole('authenticated')::oid)))
  then v_bad := v_bad || 'تسلسلة تابعة للحزمة ممنوحة لـanon/authenticated/PUBLIC'; end if;

  if array_length(v_bad,1) > 0 then
    raise exception E'🔴 ACL غير مطابق للعقد:\n  %', array_to_string(v_bad, E'\n  ');
  end if;
  raise notice '✅ ACL مطابق: anon=لا شيء · PUBLIC=لا شيء · authenticated=SELECT فقط.';
end $$;

-- عرضٌ قرائيّ للـACL كما هو — ليقرأه إنسان بجانب النتيجة أعلاه.
select 'ACL كما هو' as check,
       c.relname::text||': '||coalesce(array_to_string(c.relacl,' · '),'(بلا ACL صريح)') as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and c.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries');

-- السياسات: ثلاث سياسات قراءة، ⛔ ولا سياسة تسمح لكلّ authenticated بلا شرط.
select 'سياسات القراءة الثلاث' as check,
       case when count(*)=3 then '✅ 3/3' else '🔴 '||count(*)::text||'/3' end as result
from pg_policy pol join pg_class c on c.oid=pol.polrelid
where c.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries');

select '⛔ لا سياسة مفتوحة بلا شرط' as check,
       case when count(*)=0 then '✅'
            else '🔴 '||string_agg(pol.polname,', ') end as result
from pg_policy pol join pg_class c on c.oid=pol.polrelid
where c.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries')
  and pg_get_expr(pol.polqual, pol.polrelid) !~* '(civ_can_manage|auth\.uid)';

-- ⛔ لا بيانات أُنشئت · ولا تنبيه · ولا cron.
-- ⚠️ فارغة = FRESH_APPLY. وصفوفٌ فيها = MATCHING_REAPPLY فوق بيانات حقيقية،
--    وهي حالة **مشروعة** بعد أن صار الملفّ قابلًا لإعادة التشغيل. ⛔ ولذلك
--    لا تدخل الحسم: إسقاطُ حزمة بسبب بيانات موجودة هو الخطأ الذي نتجنّبه.
select 'حالة البيانات (خارج الحسم)' as check,
       case when (select count(*) from public.custody_incidents)=0
             and (select count(*) from public.custody_incident_actions)=0
             and (select count(*) from public.custody_alert_deliveries)=0
            then '✅ لا بيانات ولا تنبيهات' else '🟡 فيها صفوف — تحقّق من مصدرها' end as result;

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 فحص Cron — والعيب الذي أوقف التشغيل على Preview
--
-- الصيغة السابقة كانت `case when to_regclass('cron.job') is null then … when
-- (select … from cron.job) …`. والحارس **لا يحرس شيئًا**: PostgreSQL يُحلّل
-- الجملة كاملةً قبل تنفيذها، فيفشل عند `cron.job` غير الموجود:
--     ERROR: relation "cron.job" does not exist
-- ⇒ الحلّ SQL ديناميكيّ: النصّ لا يُحلَّل إلّا إن قرّر الحارس تنفيذه.
--
-- ⚠️ وغياب pg_cron **ليس فشلًا**: العقد يشترط ألّا تُنشئ الحزمة مهمّة، والامتداد
--    غير المثبَّت يُثبت ذلك أقوى من أيّ استعلام. ⛔ ولا يُنشَأ امتداد ولا مخطّط هنا.
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_n int;
begin
  if to_regclass('cron.job') is null then
    raise notice '✅ pg_cron غير مثبَّت ⇒ لا مهمّة Cron أنشأتها الحزمة.';
  else
    execute $q$ select count(*) from cron.job where command ilike '%custody_run_alerts%' $q$ into v_n;
    if v_n > 0 then
      raise exception '🔴 % مهمّة Cron تشغّل custody_run_alerts — العقد يمنع الجدولة التلقائية', v_n;
    end if;
    raise notice '✅ pg_cron مثبَّت ولا مهمّة لهذه الحزمة.';
  end if;
end $$;

-- تنفيذ فعليّ آمن: SELECT من الجداول (⛔ ولا استدعاء للمحرّك).
do $$
declare v_n bigint;
begin
  select count(*) into v_n from public.custody_incidents;
  select count(*) into v_n from public.custody_incident_actions;
  select count(*) into v_n from public.custody_alert_deliveries;
  raise notice '✅ SELECT من الجداول الثلاثة نجح.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الحسم — يفشل فعليًّا لا طباعةً
-- ════════════════════════════════════════════════════════════════════════════
do $$
declare v_fail text[] := '{}'; v_n int; v_src text; v_type int2;
begin
  select count(*) into v_n from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relrowsecurity
     and c.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries');
  if v_n <> 3 then v_fail := v_fail || (v_n::text||'/3 جدول بـRLS'); end if;

  select count(*) into v_n
  from (values ('civ_item_hold_check',''),('custody_inv_employee_report_incident','jsonb'),
               ('custody_inv_admin_incident_action','uuid, text, text, boolean'),
               ('civ_alert_once','text, text, text, uuid'),('custody_run_alerts','')) k(f,a)
  where not exists (select 1 from pg_proc p where p.proname=k.f
                     and p.pronamespace='public'::regnamespace
                     and pg_catalog.oidvectortypes(p.proargtypes)=k.a);
  if v_n > 0 then v_fail := v_fail || (v_n::text||' دالّة مفقودة أو بتوقيع مختلف'); end if;

  select t.tgtype into v_type from pg_trigger t join pg_class c on c.oid=t.tgrelid
   where t.tgname='trg_civ_item_hold' and not t.tgisinternal
     and c.relname='custody_inventory_assignment_items';
  if v_type is null then v_fail := v_fail || 'مُشغِّل الحجز مفقود أو على جدول خاطئ';
  else
    if (v_type & 4) = 0  then v_fail := v_fail || 'المُشغِّل لا يعمل على الإدراج'; end if;
    if (v_type & 16) = 0 then v_fail := v_fail || 'المُشغِّل لا يعمل على التحديث — تجاوز الحجز ممكن'; end if;
  end if;

  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='custody_inv_employee_report_incident';
  if v_src is null or v_src !~* 'asset_not_in_assignment' or v_src !~* 'asset_not_yours' then
    v_fail := v_fail || 'ربط الحادثة بالأصل ليس fail-closed';
  end if;

  -- ⚠️ ACL الجداول حُسم أعلاه بـ`has_table_privilege` وبكتالوج ACL، ويرفع
  --    استثناءه بنفسه. ⛔ ولا يُعاد هنا بـ`role_table_grants`: فحصان بمعيارين
  --    مختلفين لنفس الشرط يجعل الأضعف يبدو تأكيدًا للأقوى وهو ليس كذلك.
  --    ويبقى هنا شرطٌ واحد لا يقيسه ذلك القسم: أن يكون المنح صريحًا لا موروثًا.
  if to_regrole('authenticated') is not null
     and not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
                       lateral aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
                      where n.nspname='public' and c.relname='custody_incidents'
                        and a.grantee = to_regrole('authenticated')::oid and a.privilege_type='SELECT') then
    v_fail := v_fail || 'منح SELECT لـauthenticated ليس صريحًا في ACL — لا تعتمد على الوراثة';
  end if;

  if to_regrole('anon') is not null then
    if has_function_privilege('anon','public.custody_run_alerts()','EXECUTE')
       or has_function_privilege('anon','public.custody_inv_admin_incident_action(uuid,text,text,boolean)','EXECUTE') then
      v_fail := v_fail || 'anon ينفّذ دالّة من الحزمة';
    end if;
  end if;
  if to_regrole('authenticated') is not null
     and has_function_privilege('authenticated','public.custody_run_alerts()','EXECUTE') then
    v_fail := v_fail || 'authenticated ينفّذ محرّك التنبيهات';
  end if;
  if to_regrole('service_role') is not null
     and not has_function_privilege('service_role','public.custody_run_alerts()','EXECUTE') then
    v_fail := v_fail || 'service_role لا ينفّذ المحرّك';
  end if;

  if (select count(*) from pg_policy pol join pg_class c on c.oid=pol.polrelid
       where c.relname in ('custody_incidents','custody_incident_actions','custody_alert_deliveries')
         and pg_get_expr(pol.polqual, pol.polrelid) !~* '(civ_can_manage|auth\.uid)') > 0 then
    v_fail := v_fail || 'سياسة مفتوحة بلا شرط';
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 CUSTODY INCIDENTS POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ CUSTODY INCIDENTS POSTCHECK PASSED.';
end $$;
