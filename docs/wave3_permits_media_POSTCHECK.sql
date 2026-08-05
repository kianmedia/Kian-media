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

-- 🔴 الفحص الأمنيّ: لا شيء لـanon، ومحرّك التنبيهات لمفتاح الخدمة وحده.
-- ⚠️ `prodops_touch` مستبعَدة: دالّة **مُشغِّل** (returns trigger) من حزمة
--    operations_center، لا RPC. المُشغِّلات تُنشأ بصلاحية تنفيذ لـPUBLIC
--    افتراضًا، ولا يمكن استدعاؤها عبر PostgREST أصلًا لأنّ نوع إرجاعها
--    `trigger`. فإدراجها هنا إنذار كاذب — و`operations_center_POSTCHECK.sql`
--    يستبعدها بالاسم للسبب نفسه.
-- 🔴 والاستبعاد **بالاسم الصريح وحده**: لا نمط عامّ يبتلع دوالّ أخرى معه.
select 'لا صلاحية دوالّ لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(routine_name::text,', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee::text in ('anon','PUBLIC')
  and routine_name like 'prodops_%'
  and routine_name::text <> 'prodops_touch';

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
