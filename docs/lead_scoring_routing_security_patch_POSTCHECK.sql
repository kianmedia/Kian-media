-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_security_patch_POSTCHECK.sql  (READ-ONLY · صفّ واحد)
--   يُشغَّل بعد الرقعة. آمن في المحرّر مع auth.uid() = NULL. لا نداء محميّ.
--   ERROR ليس متوقَّعًا؛ الحكم يظهر في العمود verdict.
-- ════════════════════════════════════════════════════════════════════════════
with t(sig) as (values ('public.lsr_rules_frozen()'), ('public.lsr_touch()')),
acl as (
  select t.sig,
         (select proacl is null from pg_proc where oid = to_regprocedure(t.sig)) as acl_null,
         has_function_privilege('public', t.sig, 'EXECUTE')                      as pub_exec
    from t where to_regprocedure(t.sig) is not null),
still_null as (
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '') as s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'lsr\_%' and p.proacl is null),
trigs as (
  select count(*) as n from pg_trigger tg
    join pg_proc p on p.oid = tg.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not tg.tgisinternal
     and p.proname in ('lsr_rules_frozen','lsr_touch'))
select case when (select count(*) from acl) <> 2                       then 'FAIL'
            when exists (select 1 from acl where acl_null or pub_exec) then 'FAIL'
            when (select s from still_null) <> ''                      then 'FAIL'
            when (select n from trigs) = 0                             then 'FAIL'
            else 'PASS' end                                                as verdict,
       case when (select count(*) from acl) <> 2 then '★ دالّة هدف غائبة ★'
            when exists (select 1 from acl where acl_null)
              then '★ ما زالت بلا قرار صريح ★ ' || (select string_agg(sig, ', ') from acl where acl_null)
            when exists (select 1 from acl where pub_exec)
              then '★ ما زالت مكشوفة لـPUBLIC ★ ' || (select string_agg(sig, ', ') from acl where pub_exec)
            when (select s from still_null) <> ''
              then '★ دوالّ lsr_* أخرى بـproacl NULL ★ ' || (select s from still_null)
            when (select n from trigs) = 0
              then '★ لا زناد يعتمد عليهما — السحب كسر التنفيذ أو الزنادات غائبة ★'
            else 'الدالّتان مُقفَلتان بقرار صريح · لا PUBLIC · لا دالّة lsr_* بلا قرار · '
                 || (select n from trigs)::text || ' زنادًا ما زال يعمل' end  as detail;
