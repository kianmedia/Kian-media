-- ════════════════════════════════════════════════════════════════════════════
-- WAVE 3 · POSTCHECK — يقرأ ولا يكتب. شغّله بعد RUNME.
-- كل سطر يجب أن يقول ✅. أيّ 🔴 يعني أن RUNME لم يكتمل.
-- ════════════════════════════════════════════════════════════════════════════

select 'الأعمدة المضافة' as check,
       case when count(*) = 6 then '✅ 6/6' else '🔴 ' || count(*)::text || '/6' end as result
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'ops_call_sheets' and column_name in ('backup_date','is_drone_day'))
    or (table_name = 'ops_job_weather' and column_name in ('wind_gust_kph','fetched_at','for_lat','for_lng')));

select 'قيد source يقبل open_meteo' as check,
       case when pg_get_constraintdef(oid) like '%open_meteo%' then '✅' else '🔴' end as result
from pg_constraint where conname = 'ops_job_weather_source_check';

select 'قيد التاريخ البديل' as check,
       case when count(*) = 1 then '✅' else '🔴 مفقود' end as result
from pg_constraint where conname = 'ops_call_sheets_backup_after_sheet';

select 'الفهرس' as check,
       case when count(*) = 1 then '✅' else '🔴 مفقود' end as result
from pg_indexes where schemaname = 'public' and indexname = 'ops_job_weather_job_date_idx';

select 'الدالّة موجودة وبالبادئة المعتمدة' as check,
       case when count(*) = 1 then '✅' else '🔴' end as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_weather_record';

-- 🔴 الأهم أمنيًّا: لا anon ولا PUBLIC ينفّذ الدالّة.
--    ⚠️ ولاحِظ العنوان: **تنفيذ الدالّة** لا صلاحيات الجداول. وكان العنوان
--    «لا صلاحية لـanon/public» فقرأه القارئ حكمًا على الجدولين أيضًا، بينما
--    لا يفحص إلّا دالّةً واحدة. ⇒ ✅ صادقة عن موضوعها، ومضلِّلة عمّا لا تفحصه.
select 'لا تنفيذ لـanon/PUBLIC على prodops_weather_record' as check,
       case when count(*) = 0 then '✅' else '🔴 صلاحية تنفيذ مسرَّبة' end as result
from information_schema.role_routine_grants
where routine_schema = 'public' and routine_name::text = 'prodops_weather_record'
  and grantee::text in ('anon','PUBLIC');

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 ACL الجدولين — كاشفٌ **واحد** للعرض وللحسم معًا
--
-- ★ لماذا لا `information_schema.role_table_grants` ★
--   ١. ⛔ **ولا تعرض MAINTAIN إطلاقًا**: امتياز PostgreSQL 17 خارج المعيار،
--      فحرف `m` في `Dxtm` غير مرئيّ فيها أصلًا.
--   ٢. وهي تسرد المنح **الصريحة** فقط ومقيَّدة بأدوار المستدعي المفعَّلة، بينما
--      `aclexplode` يقرأ `relacl` كما هو، و`has_table_privilege` تُعطي
--      الصلاحية **الفعليّة** شاملةً الموروث عن PUBLIC وعضوية الأدوار.
--   ⇒ العرض والحسم يستعملان الآن **نفس** الكاشف ونفس القائمة. ⛔ ولا يجوز أن
--     يقول التشخيص ✅ ويحكم البلوك 🔴 على الشرط نفسه.
--
-- ★ الملكية ★ `ops_call_sheets` و`ops_job_weather` يُنشئهما
--   `operations_center_RUNME.sql` (٥٤٦ و٣٨٨)، وعقد ACL مملوك هناك (§9-ج).
--   ⛔ وهذه الحزمة تمدّدهما ولا تملكهما: ترصد الخرق وتدلّ على مكان إصلاحه.
-- ════════════════════════════════════════════════════════════════════════════
select 'ACL الجدولين (نفس عقد الحسم)' as check,
       case when count(*) = 0 then '✅ anon=لا شيء · PUBLIC=لا شيء · authenticated=SELECT فقط'
            else '🔴 ' || string_agg(v.msg, ' · ') end as result
from (
  select format('%s: %s يملك %s', x.rel, x.who, x.priv) as msg
  from (
    select c.relname::text as rel,
           case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as who,
           a.privilege_type::text as priv
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace,
    lateral aclexplode(coalesce(c.relacl, '{}'::aclitem[])) a
    where n.nspname = 'public'
      and c.relname in ('ops_call_sheets','ops_job_weather')
  ) x
  where (x.who in ('PUBLIC','anon'))
     or (x.who = 'authenticated' and x.priv <> 'SELECT')
) v;

-- عرضٌ خام للـACL — ليقرأه إنسان بجانب النتيجة أعلاه.
select 'ACL كما هو' as check,
       c.relname::text||': '||coalesce(array_to_string(c.relacl,' · '),'(بلا ACL صريح)') as result
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname='public' and c.relname in ('ops_call_sheets','ops_job_weather');

-- ⛔ ولا جدول ثالث للأوراق ولا رابع للمواقع. (فحصٌ مستقلّ — ⛔ ولا يُخلط بالـACL.)
select 'لا جداول موازية جديدة' as check,
       case when count(*) = 0 then '✅' else '🔴 ' || string_agg(tablename::text, ', ') end as result
from pg_tables where schemaname = 'public'
  and tablename::text in ('call_sheets','locations','crew_members','crew_assignments','crew_documents');


-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الحسم — يفشل فعليًّا لا طباعةً
--
-- ★ لماذا أُضيف ★ Final Preview Sweep أعطى «11/11 PASSED» بحالة خروج 0 بينما
--   كانت السجلّات تحمل صفوفًا حمراء. والسبب أنّ هذا الملفّ كان **SELECT صِرفًا**:
--   يطبع 🔴 ثمّ ينتهي بحالة 0، فالمِكنسة تقيس خروج psql لا نتيجة الفحص.
--   ⇒ فحصٌ بلا `raise exception` **لا يحرس شيئًا**، مهما كثرت صفوفه.
--
-- ⚠️ ولا يُحوَّل تشخيصيّ إلى حاجب بلا دليل: المحسوب هنا هو **REQUIRED BLOCKER**
--    فقط (وجود الكائنات · RLS · تسريب صلاحية · نظام موازٍ). وما يعتمد على
--    البيانات أو على حزمة اختيارية يبقى مطبوعًا خارج الحسم.
-- ⚠️ شغّل بـ`psql -v ON_ERROR_STOP=1`.
-- ════════════════════════════════════════════════════════════════════════════
do $verdict$
declare v_fail text[] := '{}'; v_acl text[] := '{}'; v_parallel text[] := '{}';
        v_privs text[]; v_o text; v_p text;
begin
  -- ── ACL: نفس الكاشف الذي يعرضه التشخيص أعلاه، وبأنواع الصلاحيات الثمانية ──
  -- ⚠️ MAINTAIN من PostgreSQL 17 فصاعدًا: تُضاف بالإصدار، و`array_append`
  --    لا `|| 'MAINTAIN'` (الأخيرة تُفسَّر حرفيّةَ مصفوفة فتفشل).
  v_privs := array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
  if current_setting('server_version_num')::int >= 170000 then
    v_privs := array_append(v_privs, 'MAINTAIN');
  end if;

  foreach v_o in array array['ops_call_sheets','ops_job_weather'] loop
    if to_regclass('public.'||v_o) is null then
      v_acl := array_append(v_acl, v_o||': الجدول مفقود'); continue;
    end if;
    foreach v_p in array v_privs loop
      -- 🔴 anon: لا شيء. وRLS **لا تحكم** TRUNCATE فلا تُقبل ذريعةً هنا.
      if to_regrole('anon') is not null and has_table_privilege('anon','public.'||v_o, v_p) then
        v_acl := array_append(v_acl, format('anon يملك %s على %s', v_p, v_o));
      end if;
      -- authenticated: SELECT فقط (سياسة القراءة في §5 من حزمة المركز تحتاجه).
      if to_regrole('authenticated') is not null then
        if v_p = 'SELECT' then
          if not has_table_privilege('authenticated','public.'||v_o, v_p) then
            v_acl := array_append(v_acl, format('authenticated لا يقرأ %s — سياسة القراءة ميتة', v_o));
          end if;
        elsif has_table_privilege('authenticated','public.'||v_o, v_p) then
          v_acl := array_append(v_acl, format('authenticated يملك %s على %s', v_p, v_o));
        end if;
      end if;
    end loop;
    -- PUBLIC من الكتالوج: ليس دورًا فلا تقبله دوالّ الصلاحيات.
    if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace,
                 lateral aclexplode(coalesce(c.relacl,'{}'::aclitem[])) a
                where n.nspname='public' and c.relname=v_o and a.grantee = 0) then
      v_acl := array_append(v_acl, format('PUBLIC يملك صلاحية مباشرة على %s', v_o));
    end if;
    -- ACL الأعمدة: غير مرئيّ لأيّ فحص جدوليّ.
    if to_regrole('anon') is not null
       and has_any_column_privilege('anon','public.'||v_o,'SELECT,INSERT,UPDATE,REFERENCES') then
      v_acl := array_append(v_acl, format('anon يملك صلاحية على عمود في %s', v_o));
    end if;
  end loop;
  -- ⚠️ service_role: لا يُحتسب — `Dxtm` موروثة من ACL المشروع، ⛔ ولا جرد
  --    مستهلكين أُجري. تُبلَّغ ولا تُفشل. 🔵 قرار مفتوح.
  if to_regrole('service_role') is not null
     and has_table_privilege('service_role','public.ops_call_sheets','TRUNCATE') then
    raise notice '🟡 service_role يملك TRUNCATE على جداول المركز — موروث، خارج نطاق هذه الحزمة.';
  end if;

  if array_length(v_acl,1) > 0 then
    v_fail := array_append(v_fail,
      'ACL (المالك: operations_center_RUNME.sql §9-ج): ' || array_to_string(v_acl, ' | '));
  end if;

  -- ── الأنظمة الموازية: صنفٌ مستقلّ، وكلّ اسم يظهر بنفسه ────────────────────
  -- ⛔ ولا يُدمج في رسالة الـACL: خلطُ الصنفين يجعل قارئ الاستثناء يظنّ العطب
  --    واحدًا فيصلح أحدهما ويترك الآخر.
  foreach v_o in array array['call_sheets','locations','crew_members',
                             'crew_assignments','crew_documents'] loop
    if to_regclass('public.'||v_o) is not null then
      v_parallel := array_append(v_parallel, v_o);
    end if;
  end loop;
  if array_length(v_parallel,1) > 0 then
    v_fail := array_append(v_fail, 'PARALLEL_OBJECT: ' || array_to_string(v_parallel, ', '));
  end if;

  -- 🔴 REQUIRED BLOCKER: تنفيذ الدالّة الوحيدة لـanon/PUBLIC.
  if (select count(*) from information_schema.role_routine_grants
       where routine_schema='public' and routine_name::text='prodops_weather_record'
         and grantee::text in ('anon','PUBLIC')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية تنفيذ لـanon/PUBLIC على prodops_weather_record');
  end if;
  if to_regprocedure('public.prodops_weather_record(uuid,date,jsonb,text)') is null
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                      where n.nspname='public' and p.proname='prodops_weather_record') then
    v_fail := array_append(v_fail, 'prodops_weather_record مفقودة');
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 3 PRODUCTION OPS POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 3 PRODUCTION OPS POSTCHECK PASSED.';
end $verdict$;
