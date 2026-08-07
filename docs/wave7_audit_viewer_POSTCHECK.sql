-- WAVE 7 · V2-7.3 · POSTCHECK — قراءة فقط.
select 'الدالّتان' as check,
       case when count(*)=2 then '✅ 2/2' else '🔴 '||count(*)::text||'/2' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('audit_viewer_list','audit_sources_registry');

-- 🔴 لا سجلّ سادس عشر أُنشئ.
select '⛔ لا سجلّ تدقيق جديد' as check,
       case when to_regclass('public.audit_viewer_log') is null
             and to_regclass('public.unified_audit') is null
            then '✅ قراءة فقط' else '🔴 سجلّ إضافيّ' end as result;

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee in ('anon','PUBLIC')
  and routine_name in ('audit_viewer_list','audit_sources_registry');


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
  if (select count(*) from information_schema.role_routine_grants
       where routine_schema='public' and grantee::text in ('anon','PUBLIC')
         and routine_name::text like 'audit\_%') > 0 then
    v_fail := array_append(v_fail, 'صلاحية تنفيذ لـanon/PUBLIC على عارض التدقيق');
  end if;
  -- ⚠️ الاسمان من الفحص التشخيصيّ في هذا الملفّ نفسه، لا من التخمين.
  foreach v_o in array array['audit_viewer_log','unified_audit'] loop
    if to_regclass('public.'||v_o) is not null then
      v_fail := array_append(v_fail, 'نظام موازٍ '||v_o);
    end if;
  end loop;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 7 AUDIT VIEWER POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 7 AUDIT VIEWER POSTCHECK PASSED.';
end $verdict$;
