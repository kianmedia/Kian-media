-- WAVE 3 · إغلاق · POSTCHECK — يقرأ ولا يكتب. كل سطر يجب أن يقول ✅.
select 'الجدولان + RLS' as check,
       case when count(*) filter (where c.relrowsecurity) = 2
            then '✅ 2/2 مع RLS' else '🔴 RLS ناقص' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('ops_permits','ops_media');

select 'الدوالّ السبع' as check,
       case when count(*)=7 then '✅ 7/7' else '🔴 '||count(*)::text||'/7' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('prodops_permit_upsert','prodops_permit_delete','prodops_permits_list',
   'prodops_media_attach','prodops_media_delete','prodops_media_list','prodops_permit_alerts_run');

select 'الربط على الجدول القائم' as check,
       case when count(*)=1 then '✅' else '🔴 مفقود' end as result
from information_schema.columns
where table_schema='public' and table_name='ops_job_permits' and column_name='registry_permit_id';

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 الفحص الأمنيّ — **محصور بدوالّ هذه الحزمة وحدها**
--
-- ★ العيب الذي أُصلح هنا ★
--   كان الفحص يمسح `routine_name like 'prodops_%'` — وهذا مرشّح **مساحة اسم**
--   لا مرشّح **حزمة**. فبعد تطبيق `wave3_calendar_tokens` ظهرت
--   `prodops_calendar_feed` — وهي ممنوحة لـ`anon` **عن قصد** ضمن حزمتها —
--   فأحمرّ فحصُ permits_media بسبب دالّة لا يملكها ولا يعرفها.
--   ⇒ صار الفحص **تابعًا لترتيب التطبيق** وغير صالح لإعادة التشغيل.
--
-- ⛔ والعلاج ليس استثناء `prodops_calendar_feed` بالاسم: ذلك يُصلح اليوم ويكسر
--    غدًا مع أوّل حزمة جديدة تمنح `anon` شيئًا. النطاق الآن **قائمة صريحة**
--    بتواقيعها، مستخرَجة من `wave3_permits_media_RUNME.sql` §الصلاحيات.
--
-- ⚠️ ويُطابَق **التوقيع** لا الاسم: دالّة بنفس الاسم وتوقيع مختلف من حزمة أخرى
--    لا تدخل النطاق، ولا تُخفي غياب دالّتنا.
--
-- ★★ 🔴 ولماذا `oidvectortypes` لا `pg_get_function_identity_arguments` ★★
--   الثانية تُعيد **أسماء الوسائط مع أنواعها**: `p_payload jsonb` و
--   `p_id uuid, p_reason text`. فمقارنتها بقائمة أنواع مثل `jsonb` لا تتحقّق
--   أبدًا — وهذا ما جعل الفحص يُصنّف الدوالّ السبع **مفقودة** وهي موجودة كلّها
--   على Preview. والأسوأ أنّ الفشل كان يبدو نقصًا في التطبيق لا عيبًا في الفحص.
--   أمّا `oidvectortypes(proargtypes)` فتُعيد **الأنواع وحدها** بالترتيب
--   (`uuid, text`)، ولا تتأثّر بإعادة تسمية وسيط ولا بقيمة افتراضية.
-- ⚠️ ودالّة بلا وسائط تُعطي **سلسلة فارغة** `''` — لا NULL.
--    (`proargtypes` يشمل وسائط الإدخال فقط، وهو المقصود بالهويّة.)
-- ════════════════════════════════════════════════════════════════════════════
-- ⚠️ الأربعة في **عبارة واحدة**: `WITH` يرتبط ببيان واحد فقط، فتكرار
--    `select` بعده يفشل بـ«relation "resolved" does not exist».
with pkg(fname, fargs, expect_authenticated) as (
  values
    ('prodops_permit_upsert',     'jsonb',                                        true),
    ('prodops_permit_delete',     'uuid, text',                                   true),
    ('prodops_permits_list',      'jsonb',                                        true),
    ('prodops_media_attach',      'text, uuid, text, text, text, text, integer',  true),
    ('prodops_media_delete',      'uuid, text',                                   true),
    ('prodops_media_list',        'text, uuid',                                   true),
    -- 🔴 محرّك التنبيهات: لمفتاح الخدمة وحده — ولا حتّى للمُصادَق.
    ('prodops_permit_alerts_run', '',                                             false)
),
resolved as (
  select k.fname, k.fargs, k.expect_authenticated, p.oid, p.proacl
  from pkg k
  left join pg_proc p
         on p.proname = k.fname
        and p.pronamespace = 'public'::regnamespace
        and pg_catalog.oidvectortypes(p.proargtypes) = k.fargs
),
flags as (
  select r.*,
         -- ⚠️ `proacl is null` = ACL افتراضيّ = **PUBLIC يملك التنفيذ**.
         --    وهي أشيع صورة لهذا التسريب، لا حالة سليمة.
         (r.proacl is null
          or exists (select 1 from aclexplode(r.proacl) a
                      where a.grantee = 0 and a.privilege_type = 'EXECUTE')) as public_exec,
         case when to_regrole('anon') is null then null
              else has_function_privilege('anon', r.oid, 'EXECUTE') end as anon_exec,
         case when to_regrole('authenticated') is null then null
              else has_function_privilege('authenticated', r.oid, 'EXECUTE') end as auth_exec
  from resolved r
)
select 'نطاق الحزمة: الدوالّ السبع بتواقيعها' as check,
       case when count(*) filter (where oid is null) = 0 then '✅ 7/7'
            else '🔴 مفقودة: ' || coalesce(string_agg(fname || '(' || fargs || ')', ', ')
                                           filter (where oid is null), '') end as result
from flags
union all
select 'دوالّ الحزمة: anon بلا تنفيذ',
       case when bool_or(anon_exec is null) then '🟡 دور anon مفقود — تحقّق يدويًّا'
            when count(*) filter (where oid is not null and anon_exec) = 0 then '✅'
            else '🔴 ' || string_agg(fname, ', ')
                 filter (where oid is not null and anon_exec) end
from flags
union all
select 'دوالّ الحزمة: PUBLIC بلا تنفيذ',
       case when count(*) filter (where oid is not null and public_exec) = 0 then '✅'
            else '🔴 ' || string_agg(fname, ', ')
                 filter (where oid is not null and public_exec) end
from flags
union all
select 'دوالّ الحزمة: صلاحية authenticated مطابقة للمقصود',
       case when bool_or(auth_exec is null) then '🟡 دور authenticated مفقود'
            when count(*) filter (where oid is not null
                                    and auth_exec <> expect_authenticated) = 0
                 then '✅ ٦ تشغيلية + محرّك التنبيهات محجوب'
            else '🔴 انحراف: ' || string_agg(
                   fname || '=' || auth_exec::text
                          || ' (المتوقَّع ' || expect_authenticated::text || ')', ', ')
                 filter (where oid is not null and auth_exec <> expect_authenticated) end
from flags;

-- ⚠️ تشخيص عند اختلاف التوقيع — يُعرض دائمًا، ويُقرأ عند احمرار الفحص أعلاه.
--    غيابه هو ما جعل «الدوالّ السبع مفقودة» لغزًا: الفحص لم يُظهر قطّ ما تحويه
--    القاعدة فعلًا، فبدا الخلل في التطبيق لا في المقارنة.
select 'تشخيص التواقيع الفعلية' as check,
       p.proname || '(' || pg_catalog.oidvectortypes(p.proargtypes) || ')' as result
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in ('prodops_permit_upsert','prodops_permit_delete','prodops_permits_list',
                    'prodops_media_attach','prodops_media_delete','prodops_media_list',
                    'prodops_permit_alerts_run')
order by p.proname;
-- المتوقَّع: سبعة صفوف بالتواقيع المذكورة في `pkg` أعلاه حرفًا بحرف.
-- ⚠️ صفر صفوف ⇒ الحزمة غير مطبَّقة. صفوف بتواقيع مختلفة ⇒ انحراف حقيقيّ.

-- 🔴 عيبان صُحّحا هنا:
--  ١. `grantee` نوعه `information_schema.sql_identifier` لا `text`، فمقارنة
--     `array_agg(grantee) = array['…']` تفشل بخطأ
--     `sql_identifier[] = text[]`. الحلّ: `::text` على العنصر و`::text[]`
--     على المصفوفة — ⛔ ولا يُترك التحويل ضمنيًّا.
--  ٢. **مالك الدالّة يظهر هنا**: مَن يملكها (`postgres` على Supabase) له
--     تنفيذٌ ضمنيّ يُدرجه `role_routine_grants`. فاشتراط `{service_role}`
--     وحدها كان يفشل على قاعدة سليمة تمامًا.
select 'محرّك التنبيهات: لا أحد غير service_role/المالك' as check,
       case when coalesce(array_agg(distinct grantee::text
                                    order by grantee::text), '{}'::text[])
                 <@ array['service_role','postgres','supabase_admin']::text[]
            then '✅'
            else '🔴 مِنَح غير متوقَّعة: '
                 || array_to_string(array_agg(distinct grantee::text), ', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and routine_name::text='prodops_permit_alerts_run';

-- ٤ · 🔴 والفحص الحاسم: الصلاحية **الفعليّة** لا سطور الجدول.
--    `has_function_privilege` تُجيب عمّا يستطيعه الدور حقًّا، بما في ذلك ما
--    يرثه من PUBLIC — وهو ما لا تُظهره `role_routine_grants` دائمًا.
-- ⚠️ الأدوار تُفحص بـ`to_regrole` أوّلًا: `has_function_privilege` **ترمي خطأً**
--    لدور غير موجود، فتُجهض بقيّة الملفّ. و«دور مفقود» ليس «صلاحية خاطئة»،
--    فيُميَّزان في المخرَج بدل أن يُخلطا.
select 'محرّك التنبيهات: صلاحية فعليّة' as check,
       case
         when to_regrole('anon') is null
           or to_regrole('authenticated') is null
           or to_regrole('service_role') is null
           then '🟡 دور مفقود — تحقّق يدويًّا (ليست قاعدة Supabase؟)'
         when has_function_privilege('anon',          p.oid, 'EXECUTE') = false
          and has_function_privilege('authenticated', p.oid, 'EXECUTE') = false
          and has_function_privilege('service_role',  p.oid, 'EXECUTE') = true
           then '✅ anon=false · authenticated=false · service_role=true'
         else '🔴 anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')::text
           || ' · authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text
           || ' · service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')::text
       end as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_permit_alerts_run';
-- ⚠️ صفر صفوف ⇒ الدالّة غير موجودة ⇒ RUNME لم يُطبَّق.

select 'لا صلاحية جدول لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 صلاحية مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public' and table_name::text in ('ops_permits','ops_media')
  and grantee::text in ('anon','PUBLIC');

-- ⛔ والجدولان يُنشآن فارغين: لا بيانات مخترعة.
select 'الجدولان فارغان (لا بيانات مخترعة)' as check,
       case when (select count(*) from public.ops_permits) = 0
             and (select count(*) from public.ops_media)   = 0
            then '✅ فارغان' else '🟡 فيهما صفوف — تحقّق من مصدرها' end as result;


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
declare v_fail text[] := '{}'; v_o text;
begin
  if (select count(*) from information_schema.role_table_grants
       where table_schema='public' and grantee::text in ('anon','PUBLIC')
         and table_name::text in ('ops_permits','ops_media')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية جدول لـanon/PUBLIC');
  end if;
  foreach v_o in array array['ops_permits','ops_media'] loop
    if not coalesce((select c.relrowsecurity from pg_class c
                       join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and c.relname=v_o), false) then
      v_fail := array_append(v_fail, 'RLS مطفأ على '||v_o);
    end if;
  end loop;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 3 PERMITS MEDIA POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 3 PERMITS MEDIA POSTCHECK PASSED.';
end $verdict$;
