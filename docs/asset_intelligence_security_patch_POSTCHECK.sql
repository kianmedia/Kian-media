-- ════════════════════════════════════════════════════════════════════════════
-- docs/asset_intelligence_security_patch_POSTCHECK.sql (READ-ONLY · صفّ واحد)
--   بعد الرقعة. آمن في المحرّر مع auth.uid() = NULL · بلا نداء محميّ · بلا كتابة.
-- ════════════════════════════════════════════════════════════════════════════
with fns as (
  select p.oid, p.proname, p.oid::regprocedure::text as sig, p.proacl, p.prokind
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\')),
open_pub as (select coalesce(string_agg(sig, ' · ' order by proname), '') s
               from fns where has_function_privilege('public', oid, 'EXECUTE')),
open_anon as (select coalesce(string_agg(sig, ' · ' order by proname), '') s
                from fns where exists (select 1 from pg_roles where rolname='anon')
                  and has_function_privilege('anon', oid, 'EXECUTE')),
no_acl as (select coalesce(string_agg(proname, ' · ' order by proname), '') s from fns where proacl is null),
-- سطح التطبيق ما زال يعمل: عيّنة مثبَّتة من الدوالّ التي يناديها الكود فعلًا.
surface(f) as (values ('custody_inv_get_settings'),('custody_inv_get_my_assignments'),
                      ('custody_inv_employee_confirm_assignment'),('custody_inv_lookup_asset'),
                      ('custody_inv_maintenance_signals'),('custody_inv_asset_utilization')),
surface_broken as (
  select coalesce(string_agg(s.f, ' · ' order by s.f), '') as s
    from surface s join fns on fns.proname = s.f
   where not has_function_privilege('authenticated', fns.oid, 'EXECUTE')),
trigs as (select count(*) n from pg_trigger where not tgisinternal)
select case when (select s from open_pub) <> ''       then 'FAIL'
            when (select s from open_anon) <> ''      then 'FAIL'
            when (select s from no_acl) <> ''         then 'FAIL'
            when (select s from surface_broken) <> '' then 'FAIL'
            when (select count(*) from fns) = 0       then 'FAIL'
            else 'PASS' end                                                    as verdict,
       case when (select s from open_pub) <> ''  then '★ PUBLIC ما زال ينفّذ ★ ' || (select s from open_pub)
            when (select s from open_anon) <> '' then '★ anon ما زال ينفّذ ★ ' || (select s from open_anon)
            when (select s from no_acl) <> ''    then '★ دوالّ بلا قرار (proacl NULL) ★ ' || (select s from no_acl)
            when (select s from surface_broken) <> ''
              then '★ سطح تطبيق انكسر — authenticated فقد EXECUTE ★ ' || (select s from surface_broken)
            else 'صفر PUBLIC · صفر anon · لا دالّة بلا قرار · سطح التطبيق يعمل · '
                 || (select count(*) from fns)::text || ' دالّة عهدة · '
                 || (select n from trigs)::text || ' زنادًا سليمًا' end          as detail;
