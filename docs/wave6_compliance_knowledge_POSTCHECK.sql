-- WAVE 6 · compliance_knowledge · POSTCHECK — قراءة فقط.
select '🔴 سجلّ HSE **عرض** لا جدول' as check,
       case when (select count(*) from pg_views where schemaname='public' and viewname='hse_register_v')=1
             and (select count(*) from pg_tables where schemaname='public' and tablename like 'hse_%')=0
            then '✅ مشتقّ' else '🔴 سجلّ حوادث رابع' end as result;

select 'العرض يقرأ المصادر الثلاثة' as check,
       case when definition like '%ops_job_hse%' and definition like '%ops_incidents%'
             and definition like '%custody_incidents%' then '✅ 3/3' else '🔴 مصدر ناقص' end as result
from pg_views where schemaname='public' and viewname='hse_register_v';

select '⛔ لا جدول إجراءات موازٍ' as check,
       case when to_regclass('public.sops') is null then '✅ الوثيقة في ai_knowledge_sources'
            else '🔴 قاعدة معرفة ثانية' end as result;

select 'sop_items + RLS' as check,
       case when bool_and(c.relrowsecurity) then '✅' else '🔴 RLS مطفأ' end as result
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='sop_items';

select 'الدوالّ الأربع' as check,
       case when count(*)=4 then '✅ 4/4' else '🔴 '||count(*)::text||'/4' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('sop_attach_to_task','sop_list','sop_items_list','hse_register_list');

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 مسرَّبة' end as result
from information_schema.role_table_grants
where table_schema='public' and table_name in ('sop_items','hse_register_v') and grantee in ('anon','PUBLIC');

select 'sop_items فارغ (لا إجراء مخترع)' as check,
       case when (select count(*) from public.sop_items)=0 then '✅'
            else '🟡 فيه صفوف — تحقّق أنّها بذور تطوير موسومة' end as result;


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
         and table_name::text in ('sop_items')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية جدول لـanon/PUBLIC');
  end if;
  foreach v_o in array array['sop_items'] loop
    if not coalesce((select c.relrowsecurity from pg_class c
                       join pg_namespace n on n.oid=c.relnamespace
                      where n.nspname='public' and c.relname=v_o), false) then
      v_fail := array_append(v_fail, 'RLS مطفأ على '||v_o);
    end if;
  end loop;
  foreach v_o in array array['sops','knowledge_articles','hse_incidents','compliance_registry'] loop
    if to_regclass('public.'||v_o) is not null then
      v_fail := array_append(v_fail, 'نظام موازٍ '||v_o);
    end if;
  end loop;
  -- 🔴 REQUIRED BLOCKER: سجلّ HSE يجب أن يبقى **عرضًا** لا جدولًا رابعًا.
  if exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
              where n.nspname='public' and c.relname='hse_register_v' and c.relkind <> 'v') then
    v_fail := array_append(v_fail, 'hse_register_v صار جدولًا — سجلّ حوادث رابع');
  end if;
  if to_regclass('public.hse_register_v') is null then
    v_fail := array_append(v_fail, 'hse_register_v مفقود');
  end if;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 6 COMPLIANCE KNOWLEDGE POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 6 COMPLIANCE KNOWLEDGE POSTCHECK PASSED.';
end $verdict$;
