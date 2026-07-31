-- ════════════════════════════════════════════════════════════════════════════
-- docs/asset_intelligence_security_patch_PREFLIGHT.sql  (READ-ONLY · صفّ واحد)
--   يُثبت الحاجة ولا يفترضها، ويطبع **مصدر** الامتياز: مباشر أم موروث من PUBLIC.
--   آمن في محرّر Supabase مع auth.uid() = NULL. لا يكتب شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
with fns as (
  select p.oid, p.proname, p.oid::regprocedure::text as sig, p.proacl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\')),
pub as (select count(*) n, coalesce(string_agg(proname, ' · ' order by proname) filter (where true), '') s
          from fns where has_function_privilege('public', oid, 'EXECUTE')),
ano as (select count(*) n from fns
         where exists (select 1 from pg_roles where rolname='anon')
           and has_function_privilege('anon', oid, 'EXECUTE')),
direct as (  -- منحة مباشرة لـanon داخل proacl، تمييزًا لها عن الوراثة
  select count(*) n from fns where array_to_string(coalesce(proacl, '{}'), ',') like '%anon=%'),
nullacl as (select count(*) n from fns where proacl is null),
target as (select count(*) n from fns where proname = 'custody_inv_get_settings')
select case when (select count(*) from fns) = 0            then 'STOP'
            when (select n from pub) = 0 and (select n from ano) = 0 then 'NOT_NEEDED'
            else 'READY' end                                                   as verdict,
       (select count(*) from fns)::text || ' دالّة عهدة · PUBLIC ينفّذ '
         || (select n from pub)::text || ' · anon ينفّذ ' || (select n from ano)::text
         || ' · proacl NULL في ' || (select n from nullacl)::text               as scope,
       case when (select n from direct) > 0
            then '★ منحة مباشرة لـanon في ' || (select n from direct)::text || ' دالّة — أخطر من الوراثة'
            else 'لا منحة مباشرة لـanon إطلاقًا — كلّ ما يملكه موروث من PUBLIC، ويزول بسحب PUBLIC' end as anon_source,
       case when (select n from target) = 0 then 'custody_inv_get_settings غائبة'
            when has_function_privilege('public', 'public.custody_inv_get_settings()', 'EXECUTE')
              then 'custody_inv_get_settings(): PUBLIC ينفّذ ⇒ anon يرث. البوّابة الداخلية civ_is_employee ترفض المجهول، لكنّ القرار متروك للافتراض'
            else 'custody_inv_get_settings(): مغلقة بالفعل' end                 as reported_case;
