-- WAVE 6 · V2-6.8 · POSTCHECK — قراءة فقط. كل سطر يجب أن يقول ✅.
select 'أعمدة المصدر والتصدير' as check,
       case when count(*)=8 then '✅ 8/8' else '🔴 '||count(*)::text||'/8' end as result
from information_schema.columns
where table_schema='public' and table_name='cs_case_studies'
  and column_name in ('generated_from_project','generation_method','generated_at','generated_by',
                      'source_provenance','exported_at','exported_by','export_target');

select 'الدوالّ الأربع' as check,
       case when count(*)=4 then '✅ 4/4' else '🔴 '||count(*)::text||'/4' end as result
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('cs_source_allowed_fields','cs_generate_draft','cs_draft_queue','cs_mark_exported');

-- ⛔ لا طابور منفصل ولا منصّة ثانية.
select '⛔ لا طابور مسوّدات منفصل' as check,
       case when to_regclass('public.portfolio_drafts') is null then '✅ حالة داخل cs_*'
            else '🔴 جدول موازٍ' end as result;

select 'لا صلاحية لـanon' as check,
       case when count(*)=0 then '✅' else '🔴 '||string_agg(routine_name,', ') end as result
from information_schema.role_routine_grants
where routine_schema='public' and grantee in ('anon','PUBLIC')
  and routine_name in ('cs_generate_draft','cs_draft_queue','cs_mark_exported','cs_source_allowed_fields');

-- 🔴 المولّد لا يُنتج إلّا مسوّدات: لا صفّ مولَّد بحالة أخرى.
select '🔴 كل ما وُلّد مسوّدة أو تجاوزها بمراجعة بشرية' as check,
       case when count(*)=0 then '✅'
            else '🟡 '||count(*)::text||' صفًّا مولَّدًا نُشر — تحقّق من سجلّ المراجعة' end as result
from public.cs_case_studies
where generation_method = 'template_v1' and status = 'published' and approved_by is null;


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
  -- 🔴 REQUIRED BLOCKER: تنفيذ دوالّ المولّد لـanon/PUBLIC.
  if (select count(*) from information_schema.role_routine_grants
       where routine_schema='public' and grantee::text in ('anon','PUBLIC')
         and routine_name::text in ('cs_generate_draft','cs_draft_queue','cs_mark_exported',
                                    'cs_source_allowed_fields')) > 0 then
    v_fail := array_append(v_fail, 'صلاحية تنفيذ لـanon/PUBLIC على دوالّ المولّد');
  end if;
  foreach v_o in array array['public.cs_source_allowed_fields()','public.cs_generate_draft(uuid,text,text)','public.cs_draft_queue(text)','public.cs_mark_exported(uuid,text)'] loop
    if to_regprocedure(v_o) is null then v_fail := array_append(v_fail, 'دالّة مفقودة '||v_o); end if;
  end loop;
  foreach v_o in array array['portfolio_drafts'] loop
    if to_regclass('public.'||v_o) is not null then
      v_fail := array_append(v_fail, 'نظام موازٍ '||v_o);
    end if;
  end loop;

  if array_length(v_fail,1) > 0 then
    raise exception E'🔴 WAVE 6 CASE STUDY GENERATOR POSTCHECK FAILED:\n  %', array_to_string(v_fail, E'\n  ');
  end if;
  raise notice '✅ WAVE 6 CASE STUDY GENERATOR POSTCHECK PASSED.';
end $verdict$;
