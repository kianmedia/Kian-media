-- ════════════════════════════════════════════════════════════════════════════
-- wave8_push_tokens_POSTCHECK.sql — يُقرأ ولا يكتب. بعد RUNME مباشرةً.
-- Wave 8 · V2-8.3-A
-- ════════════════════════════════════════════════════════════════════════════
\echo '=== WAVE 8 · PUSH TOKENS · POSTCHECK ==='

-- ١ · الجدول وRLS مفعَّلة ومفروضة
select 'table' as grp, c.relname, c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'push_tokens';
-- متوقَّع: صفّ واحد، rls_enabled=t، rls_forced=t. غير ذلك ⇒ توقّف.

-- ٢ · 🔴 لا سياسة SELECT — الرمز غير مقروء من أيّ عميل
select 'policies' as grp, polname, cmd
from (select polname, case polcmd when 'r' then 'SELECT' when 'a' then 'INSERT'
                                  when 'w' then 'UPDATE' when 'd' then 'DELETE'
                                  else 'ALL' end as cmd
      from pg_policy where polrelid = 'public.push_tokens'::regclass) s;
-- متوقَّع: INSERT و UPDATE فقط. أيّ SELECT أو ALL ⇒ 🔴 توقّف: الرمز صار مقروءًا.

-- ٣ · المِنَح على الجدول — لا SELECT ولا DELETE
select 'grants' as grp, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'push_tokens'
order by grantee, privilege_type;
-- متوقَّع: authenticated ⇒ INSERT, UPDATE فقط. أيّ SELECT ⇒ 🔴 توقّف.

-- ٤ · الفهارس الفريدة الجزئية تمنع التكرار النشط
select 'indexes' as grp, indexname,
       indexdef ilike '%where%is_active%' as is_partial
from pg_indexes
where schemaname = 'public' and tablename = 'push_tokens'
order by indexname;
-- متوقَّع: ux_push_tokens_active_device و ux_push_tokens_active_fingerprint بـis_partial=t.

-- ٥ · الدوالّ: SECURITY DEFINER بمسار مثبَّت
select 'functions' as grp, p.proname, p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '(NONE)') as search_path
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname like 'push\_%'
order by p.proname;
-- متوقَّع: أربع دوالّ، security_definer=t، search_path يحتوي 'search_path=public, pg_temp'.
-- أيّ (NONE) ⇒ 🔴 توقّف: دالّة definer بلا مسار مثبَّت قابلة للاختطاف.

-- ٦ · 🔴 push_mark_invalid بلا مِنَح لأيّ دور عميل
select 'exec grants' as grp, p.proname, coalesce(a.grantee, '(none)') as grantee
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join information_schema.role_routine_grants a
       on a.routine_name = p.proname and a.routine_schema = 'public'
where n.nspname = 'public' and p.proname like 'push\_%'
order by p.proname, grantee;
-- متوقَّع: push_mark_invalid لا يظهر لها grantee من anon/authenticated.

-- ٧ · توسعة القيود القائمة نجحت
select 'channel constraint' as grp, pg_get_constraintdef(con.oid) as def
from pg_constraint con join pg_class rel on rel.oid = con.conrelid
join pg_namespace ns on ns.oid = rel.relnamespace
where ns.nspname='public' and rel.relname='notification_delivery_log'
  and con.contype='c' and pg_get_constraintdef(con.oid) ilike '%channel%';
-- متوقَّع: يحتوي 'push' **مع** الحفاظ على portal/email/both/none.

select 'preferences' as grp, column_name, column_default
from information_schema.columns
where table_schema='public' and table_name='notification_preferences'
  and column_name='push_enabled';
-- متوقَّع: صفّ واحد، الافتراض false.

-- ٨ · لا رموز مسرَّبة في أعمدة نصّية عامّة (فحص عدديّ، ⛔ لا يطبع رمزًا)
select 'leak scan' as grp,
       count(*) filter (where meta::text ilike '%ExponentPushToken%') as delivery_log_hits
from public.notification_delivery_log;
-- متوقَّع: 0. أيّ رقم أكبر ⇒ 🔴 توقّف: رمز دفع كُتب في سجلّ تسليم.

\echo '=== انتهى POSTCHECK ==='
