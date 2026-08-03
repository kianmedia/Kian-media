-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — WAVE 1 · V2-1.6-C · POSTCHECK — **قراءة فقط بالكامل**
-- ⚠️ لم يُشغَّل. لا INSERT / UPDATE / DELETE / DROP / ALTER / CREATE.
-- ════════════════════════════════════════════════════════════════════════════

select 'A-1 الأعمدة السبعة موجودة (expect 7)' as check,
       count(*)::int as expect_7, null::int as b, null::int as c
  from information_schema.columns
 where table_schema='public' and table_name='public_intake'
   and column_name in ('utm_source','utm_medium','utm_campaign','utm_term','utm_content','referrer','landing_path')

union all
select 'A-2 الدالّة موجودة (expect 1)',
       (to_regprocedure('public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)') is not null)::int,
       null, null

union all
select 'A-3 ★ مسار الالتقاط القائم لم يُمَسّ (expect 1)',
       (to_regprocedure('public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb)') is not null)::int,
       null, null

union all
select 'A-4 الصلاحية لـservice_role وحده (anon=0 · auth=0 · service=1)',
       has_function_privilege('anon','public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)','execute')::int,
       has_function_privilege('authenticated','public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)','execute')::int,
       has_function_privilege('service_role','public.public_intake_set_attribution(uuid,text,text,text,text,text,text,text)','execute')::int

union all
select 'A-5 RLS مفعّلة و anon بلا SELECT (rls=1 · anon=0)',
       (select relrowsecurity from pg_class where oid = 'public.public_intake'::regclass)::int,
       (select count(*) from information_schema.role_table_grants
         where table_schema='public' and table_name='public_intake'
           and grantee in ('anon','public') and privilege_type='SELECT')::int,
       null

union all
-- الصفوف التاريخية يجب أن تبقى NULL — «لم يُلتقط مصدر» لا «مصدر مباشر».
select 'A-6 لا عمود إسناد بقيمة فارغة بدل NULL (expect 0)',
       (select count(*) from public.public_intake
         where utm_source = '' or utm_medium = '' or referrer = '')::int,
       null, null;
