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
       -- 🔴 `routine_name` نوعه `information_schema.sql_identifier`، ومقارنته
       --    بـ`text[]` تفشل بخطأ `sql_identifier[] = text[]`. التحويل صريح على
       --    العنصر وعلى المصفوفة معًا.
       case when array_agg(routine_name::text order by routine_name::text)
                 = array['prodops_calendar_feed']::text[]
            then '✅' else '🔴 ' || array_to_string(
                 array_agg(routine_name::text order by routine_name::text), ', ') end as result
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee::text = 'anon'
  and routine_name like 'prodops_calendar%';

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
select 'ANON_EXECUTE' as kind, routine_name::text as name, privilege_type::text as status
from information_schema.role_routine_grants
where routine_schema = 'public' and grantee::text = 'anon'
  and routine_name like 'prodops%'
  -- ⚠️ دالّة مُشغِّل لا RPC — انظر wave3_permits_media_POSTCHECK.sql
  and routine_name::text <> 'prodops_touch';
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
         and table_name::text in ('ops_calendar_tokens')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية جدول لـanon/PUBLIC');
  end if;
  foreach v_o in array array['ops_calendar_tokens'] loop
    if not coalesce((select c.relrowsecurity from pg_class c
                       join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and c.relname=v_o), false) then
      v_fail := array_append(v_fail, 'RLS مطفأ على '||v_o);
    end if;
  end loop;
  -- 🔴 REQUIRED BLOCKER: التغذية تستقبل بصمة بدل الرمز الخام، أو لا تحسبها
  --    داخليًّا. كلاهما كان مطبوعًا «توقّف» ثمّ يمرّ بحالة 0.
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='prodops_calendar_feed'
                and pg_get_function_identity_arguments(p.oid) ilike '%hash%') then
    v_fail := array_append(v_fail, 'التغذية ما تزال تستقبل بصمة كوسيط');
  end if;
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
                  where n.nspname='public' and p.proname='prodops_calendar_feed'
                    and p.prosrc ilike '%digest(%') then
    v_fail := array_append(v_fail, 'التغذية لا تحسب البصمة داخليًّا');
  end if;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='prodops_calendar_feed' and p.prosecdef
                and coalesce(array_to_string(p.proconfig,','),'') not ilike '%search_path%') then
    v_fail := array_append(v_fail, 'التغذية غير محصَّنة بمسار بحث مثبَّت');
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 3 CALENDAR TOKENS POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 3 CALENDAR TOKENS POSTCHECK PASSED.';
end $verdict$;
