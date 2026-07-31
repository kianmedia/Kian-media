-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_security_patch_PREFLIGHT.sql   (READ-ONLY · صفّ واحد)
--   يُثبت الترتيب ولا يفترضه: هل الرقعة قابلة للتطبيق، وهل هي لازمة أصلًا.
--   آمن في محرّر Supabase مع auth.uid() = NULL. لا يكتب شيئًا.
-- ════════════════════════════════════════════════════════════════════════════
with t(sig) as (values ('public.lsr_rules_frozen()'), ('public.lsr_touch()')),
present as (select count(*) as n from t where to_regprocedure(t.sig) is not null),
exposed as (
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '') as s
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'lsr\_%' and p.proacl is null),
trigs as (
  select count(*) as n from pg_trigger tg
    join pg_proc p on p.oid = tg.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not tg.tgisinternal
     and p.proname in ('lsr_rules_frozen','lsr_touch'))
select case when (select n from present) <> 2 then 'STOP'
            when (select s from exposed) = ''   then 'NOT_NEEDED'
            else 'READY' end                                    as verdict,
       (select n from present)::text || '/2 دالّة هدف موجودة'    as targets,
       case when (select s from exposed) = '' then 'لا دالّة lsr_* بـproacl NULL — الرقعة مطبَّقة أو غير لازمة'
            else 'مكشوف افتراضيًّا: ' || (select s from exposed) end as exposed_now,
       (select n from trigs)::text || ' زنادًا يعتمد عليهما — يجب أن يبقى العدد كما هو بعد الرقعة' as triggers_before;
