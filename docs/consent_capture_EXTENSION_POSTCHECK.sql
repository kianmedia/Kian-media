-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — WAVE 0 · V2-0.1-F · POSTCHECK  — **قراءة فقط بالكامل**
-- docs/consent_capture_EXTENSION_POSTCHECK.sql
--
-- ⚠️ لم يُشغَّل. لا INSERT / UPDATE / DELETE / DROP / ALTER / CREATE في هذا الملف.
--    يعيد مجموعة نتائج واحدة، وكل صفّ يحمل نتيجته المتوقَّعة في اسم العمود.
-- ════════════════════════════════════════════════════════════════════════════

select 'C-1 الأعمدة الثلاثة موجودة' as check,
       count(*) filter (where column_name = 'consent_given')   as given_expect_1,
       count(*) filter (where column_name = 'consent_at')      as at_expect_1,
       count(*) filter (where column_name = 'consent_version') as version_expect_1
  from information_schema.columns
 where table_schema = 'public' and table_name = 'public_intake'
   and column_name in ('consent_given','consent_at','consent_version')

union all
select 'C-2 الدالّة موجودة',
       (to_regprocedure('public.public_intake_set_consent(uuid,boolean,text,text)') is not null)::int,
       null, null

union all
select 'C-3 ★ مسار الالتقاط القائم لم يُمَسّ ★',
       (to_regprocedure('public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb)') is not null)::int,
       null, null

union all
select 'C-4 الصلاحية لـservice_role وحده (anon=0 · auth=0 · service=1)',
       has_function_privilege('anon','public.public_intake_set_consent(uuid,boolean,text,text)','execute')::int,
       has_function_privilege('authenticated','public.public_intake_set_consent(uuid,boolean,text,text)','execute')::int,
       has_function_privilege('service_role','public.public_intake_set_consent(uuid,boolean,text,text)','execute')::int

union all
select 'C-5 RLS مفعّلة و anon بلا SELECT (rls=1 · anon_select=0)',
       (select relrowsecurity from pg_class where oid = 'public.public_intake'::regclass)::int,
       (select count(*) from information_schema.role_table_grants
         where table_schema='public' and table_name='public_intake'
           and grantee in ('anon','public') and privilege_type='SELECT')::int,
       null

union all
-- الصفوف التاريخية يجب أن تبقى NULL — «لم تُسجَّل موافقة» لا «رُفضت».
select 'C-6 لا صفّ يدّعي موافقة ناقصة (expect 0)',
       (select count(*) from public.public_intake
         where consent_given is true and (consent_at is null or consent_version is null))::int,
       null, null;
