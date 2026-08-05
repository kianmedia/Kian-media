-- WAVE 3 · V2-3.6 · PREFLIGHT — يقرأ ولا يكتب. آمن على Production.
select 'TABLE' as kind, v.n as name,
       case when to_regclass('public.' || v.n) is null then '🔴 مفقود' else '✅ موجود' end as status
from (values ('ops_jobs'),('ops_job_crew'),('ops_locations'),('ops_calendar_tokens')) v(n);

-- pgcrypto مطلوب لـgen_random_bytes/digest. غيابه يُفشل §3 كاملة.
select 'EXTENSION' as kind, 'pgcrypto' as name,
       case when count(*) = 0 then '🔴 مفقود — الإصدار سيفشل' else '✅ موجود' end as status
from pg_extension where extname = 'pgcrypto';

select 'FUNCTION' as kind, p.proname as name, '✅ موجود' as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('prodops_can_view','prodops_can_manage');

-- 🔴 الأهم: ماذا يملك anon اليوم؟ خطّ الأساس قبل أن نمنحه دالّة واحدة.
select 'ANON_GRANTS' as kind, routine_name as name, privilege_type as status
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee = 'anon' and routine_name like 'prodops%';

-- ════════════════════════════════════════════════════════════════════════════
-- 🔴 إصلاح أمنيّ — البصمة لم تعد تُقبل وسيطًا
--
-- كانت `prodops_calendar_feed(p_token_hash)` تطابق البصمة المُرسَلة على العمود
-- المخزَّن، فصارت **البصمة المخزَّنة بيان اعتماد صالحًا**. الفحوص أدناه تكشف
-- بقاء النسخة القديمة قبل التطبيق.
-- ════════════════════════════════════════════════════════════════════════════

-- ١ · هل ما تزال النسخة القديمة (وسيط اسمه p_token_hash) موجودة؟
select 'FEED_ARG' as kind,
       coalesce(p.proargnames[1], '(بلا اسم)') as name,
       case
         when p.proargnames[1] = 'p_token_hash' then '🔴 النسخة القديمة — الثغرة قائمة'
         when p.proargnames[1] = 'p_token'      then '✅ النسخة الجديدة'
         else '⚠️ توقيع غير متوقَّع'
       end as status
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'prodops_calendar_feed';
-- 🔴 توقُّف: أيّ صفّ بـ`p_token_hash` يعني أنّ RUNME لم يُطبَّق بعد.
-- ⚠️ صفر صفوف = الدالّة غير موجودة أصلًا (تطبيق أوّل) — وهذا مقبول.

-- ٢ · أين pgcrypto؟ `digest` تُستدعى داخل الدالّة الآن.
select 'PGCRYPTO_SCHEMA' as kind, n.nspname as name,
       '✅ digest متاحة هنا' as status
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';
-- 🔴 توقُّف: إن لم يكن المخطّط `public` أو `extensions` فلن يجدها search_path.

-- ٣ · 🔴 هل يملك anon أو public أيّ وصول **مباشر** لجدول الرموز؟
select 'TOKEN_TABLE_GRANTS' as kind, grantee as name, privilege_type as status
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'ops_calendar_tokens'
  and grantee in ('anon', 'public', 'authenticated');
-- 🔴 توقُّف: أيّ صفّ هنا يعني قراءةً مباشرة للبصمات — وهي أخطر من الثغرة نفسها.
-- المتوقَّع: **صفر صفوف**.

-- ٤ · ماذا ينفّذ anon من دوالّ prodops؟
select 'ANON_EXECUTE' as kind, routine_name as name, privilege_type as status
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee = 'anon'
  and routine_name like 'prodops%'
order by routine_name;
-- المتوقَّع بعد التطبيق: **`prodops_calendar_feed` وحدها**.
-- 🔴 توقُّف: ظهور `..._token_issue` أو `..._token_revoke` يعني أنّ مجهولًا
--    يستطيع إصدار رمز أو إلغاءه.
