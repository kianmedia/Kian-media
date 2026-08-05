-- WAVE 3 · V2-3.6 · POSTCHECK — يقرأ ولا يكتب. كل سطر يجب أن يقول ✅.
select 'الجدول + RLS' as check,
       case when c.relrowsecurity then '✅ RLS مفعّل' else '🔴 RLS مطفأ' end as result
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'ops_calendar_tokens';

select 'قيد شكل البصمة' as check,
       case when count(*) >= 1 then '✅' else '🔴 مفقود — بصمة بأيّ شكل تُقبل' end as result
from pg_constraint con join pg_class r on r.oid = con.conrelid
where r.relname = 'ops_calendar_tokens' and pg_get_constraintdef(con.oid) like '%[0-9a-f]{64}%';

select 'الدوالّ الثلاث' as check,
       case when count(*) = 3 then '✅ 3/3' else '🔴 ' || count(*)::text || '/3' end as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('prodops_calendar_token_issue','prodops_calendar_token_revoke','prodops_calendar_feed');

-- 🔴 الفحص الأمنيّ الحاسم: anon يملك التغذية **وحدها**.
select 'anon يملك prodops_calendar_feed فقط' as check,
       case when array_agg(routine_name order by routine_name) = array['prodops_calendar_feed']
            then '✅' else '🔴 ' || array_to_string(array_agg(routine_name order by routine_name), ', ') end as result
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee = 'anon' and routine_name like 'prodops_calendar%';

select 'لا صلاحية جدول لـanon' as check,
       case when count(*) = 0 then '✅' else '🔴 صلاحية مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ops_calendar_tokens' and grantee in ('anon','PUBLIC');

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 تحقّق الإصلاح الأمنيّ — بعد RUNME مباشرةً
-- ════════════════════════════════════════════════════════════════════════════

-- ١ · التوقيع الجديد وحده، ⛔ ولا أثر للقديم
select 'FEED_SIGNATURE' as kind,
       pg_get_function_identity_arguments(p.oid) as name,
       case when p.proargnames[1] = 'p_token' then '✅ يستقبل الرمز الخامّ'
            else '🔴 ما يزال يستقبل بصمة — توقّف' end as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_calendar_feed';
-- المتوقَّع: **صفّ واحد** بـ`p_token`. أكثر من صفّ ⇒ نسختان متعايشتان ⇒ 🔴 توقّف.

-- ٢ · 🔴 البصمة تُحسب **داخل** الدالّة — يُفحص المصدر لا الاسم
select 'FEED_COMPUTES_DIGEST' as kind, 'digest(p_token' as name,
       case when p.prosrc ~ 'digest\s*\(\s*p_token' then '✅ تُحسب داخليًّا'
            else '🔴 لا تُحسب داخليًّا — توقّف' end as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_calendar_feed';

select 'FEED_REJECTS_HASH_ARG' as kind, 'p_token_hash' as name,
       case when p.prosrc ~ 'p_token_hash' then '🔴 ما يزال يشير إلى بصمة كوسيط'
            else '✅ لا وجود لوسيط بصمة' end as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_calendar_feed';

-- ٣ · definer بمسار صريح آمن
select 'FEED_HARDENING' as kind, p.proname as name,
       case when p.prosecdef and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=%'
            then '✅ definer بمسار مثبَّت' else '🔴 غير محصَّنة — توقّف' end as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_calendar_feed';

-- ٤ · 🔴 صفر وصول مباشر للجدول
select 'TOKEN_TABLE_GRANTS' as kind, coalesce(grantee,'(none)') as name,
       coalesce(privilege_type,'—') as status
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ops_calendar_tokens'
  and grantee in ('anon','public','authenticated');
-- المتوقَّع: **صفر صفوف**. أيّ صفّ ⇒ 🔴 توقّف.

-- ٥ · anon ينفّذ التغذية وحدها
select 'ANON_EXECUTE' as kind, routine_name as name, privilege_type as status
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee = 'anon' and routine_name like 'prodops%';
-- المتوقَّع: صفّ واحد `prodops_calendar_feed`.

-- ٦ · الإصدار والإلغاء يفرضان الهويّة والصلاحية — يُفحص المصدر
select 'ISSUE_REVOKE_GATES' as kind, p.proname as name,
       case when p.prosrc ~ 'auth\.uid\(\)\s+is\s+null' and p.prosrc ~ 'prodops_can_'
            then '✅ بوّابة هويّة وصلاحية' else '🔴 بوّابة ناقصة — توقّف' end as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('prodops_calendar_token_issue','prodops_calendar_token_revoke');

-- ٧ · fail-closed ما يزال قائمًا داخل التغذية
select 'FEED_FAIL_CLOSED' as kind, v.needle as name,
       case when p.prosrc ~ v.needle then '✅ موجود' else '🔴 مفقود — توقّف' end as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
     (values ('revoked'),('expired'),('exhausted'),('max_opens')) v(needle)
where n.nspname = 'public' and p.proname = 'prodops_calendar_feed';
