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
