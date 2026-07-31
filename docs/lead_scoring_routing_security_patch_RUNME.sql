-- ════════════════════════════════════════════════════════════════════════════
-- docs/lead_scoring_routing_security_patch_RUNME.sql
--
-- رقعة صلاحيات **فقط**. لا تلمس جسم دالّة، ولا صفًّا من بيانات العملاء
-- المحتملين، ولا منصّة المشاريع، ولا تُطلق حدثًا.
--
-- ★ لماذا وُجدت ★
--   lead_scoring_routing_RUNME.sql مطبَّق على الإنتاج ووصل COMMIT. ولا يُعاد
--   تشغيله. لكنّ POST_APPLY_SUMMARY كشف صفًّا واحدًا حقيقيًّا:
--       «مكشوف افتراضيًّا: 2»
--   الترحيلة تُنشئ 53 دالّة lsr_*، وقوائم الصلاحيات الثلاث فيها تسمّي 51.
--   الساقطتان:
--       public.lsr_rules_frozen()   returns trigger
--       public.lsr_touch()          returns trigger
--   فبقيتا بـproacl IS NULL، أي الافتراضيّ: EXECUTE لـPUBLIC.
--
-- ★ ما حجم هذا فعلًا — النصفان معًا ★
--   ثغرة حقيقية في **مصفوفة الصلاحيات الصريحة**: دالّتان بلا قرار مكتوب،
--   والاعتماد على الافتراضيّ هو بالضبط ما تمنعه هذه الحزمة في كلّ ما سواهما.
--   وليست كشفًا فعليًّا للبيانات: الدالّة التي تُعيد `trigger` لا تُستدعى
--   مباشرةً — PostgreSQL يرفض بـ«trigger functions can only be called as
--   triggers» (0A000) قبل تنفيذ سطر واحد من جسمها، وPostgREST لا يعرض الدوالّ
--   ذات الإرجاع trigger أصلًا. فالإغلاق نظافةٌ ودفاعٌ في العمق لا إطفاء حريق.
--   يُقال النصفان: لا تهوين ولا تضخيم.
--
-- ★ لماذا السحب آمن على الزنادات القائمة ★
--   صلاحية EXECUTE على دالّة الزناد تُفحص عند CREATE TRIGGER، لا عند إطلاقه.
--   فالزنادات المُنشأة تبقى تعمل بعد السحب. والفحص أدناه يُثبت بقاءها فعلًا
--   بدل الاكتفاء بهذا القول.
--
-- معاملة واحدة · بلا CONCURRENTLY · قابلة لإعادة التشغيل.
-- شغّل docs/lead_scoring_routing_security_patch_PREFLIGHT.sql أوّلًا.
-- ════════════════════════════════════════════════════════════════════════════

begin;

set local statement_timeout = '2min';
set local lock_timeout = '30s';

do $patch$
declare
  f text;
  v_missing text := '';
  v_trigs_before int;
  v_trigs_after int;
begin
  -- (١) الهدفان موجودان؟ غيابهما ليس نجاحًا صامتًا.
  foreach f in array array['public.lsr_rules_frozen()', 'public.lsr_touch()'] loop
    if to_regprocedure(f) is null then v_missing := v_missing || f || ' '; end if;
  end loop;
  if v_missing <> '' then
    raise exception 'LSR PATCH: دالّة الهدف غائبة (%) — الرقعة تفترض أنّ lead_scoring_routing_RUNME مطبَّق', v_missing;
  end if;

  -- (٢) عدد الزنادات المعتمدة على الدالّتين قبل السحب.
  select count(*) into v_trigs_before
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not t.tgisinternal
     and p.proname in ('lsr_rules_frozen', 'lsr_touch');

  -- (٣) ★ الإغلاق ★ لا EXECUTE لأيّ دور API. الدالّتان زنادان لا سطح تطبيق:
  --     لا تُنادى واحدة منهما من عميل ولا من موظّف ولا من خدمة.
  foreach f in array array['public.lsr_rules_frozen()', 'public.lsr_touch()'] loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f);
      exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f);
      exception when undefined_object then null; end;
    -- service_role لا يُمنح: لا حاجة حقيقية، والزناد يعمل بلا EXECUTE.
    begin execute format('revoke all on function %s from service_role', f);
      exception when undefined_object then null; end;
  end loop;

  -- (٤) الزنادات لم تتأثّر — إثبات لا وعد.
  select count(*) into v_trigs_after
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and not t.tgisinternal
     and p.proname in ('lsr_rules_frozen', 'lsr_touch');
  if v_trigs_after <> v_trigs_before then
    raise exception 'LSR PATCH: عدد الزنادات تغيّر (% ← %) — السحب أثّر في التنفيذ',
      v_trigs_before, v_trigs_after;
  end if;

  -- (٥) الفحص الذاتيّ: proacl لم يعد NULL، ولا PUBLIC ولا anon ولا authenticated.
  foreach f in array array['public.lsr_rules_frozen()', 'public.lsr_touch()'] loop
    if (select proacl is null from pg_proc where oid = to_regprocedure(f)) then
      raise exception 'LSR PATCH SELF-TEST: % ما زالت بـproacl NULL — الافتراضيّ لم يُستبدل بقرار صريح', f;
    end if;
    if has_function_privilege('public', f, 'EXECUTE') then
      raise exception 'LSR PATCH SELF-TEST: % ما زالت مكشوفة لـPUBLIC', f;
    end if;
    begin
      if has_function_privilege('anon', f, 'EXECUTE') then
        raise exception 'LSR PATCH SELF-TEST: % مكشوفة لـanon', f; end if;
    exception when undefined_object then null; end;
    begin
      if has_function_privilege('authenticated', f, 'EXECUTE') then
        raise exception 'LSR PATCH SELF-TEST: % مكشوفة لـauthenticated', f; end if;
    exception when undefined_object then null; end;
  end loop;

  -- (٦) ولا دالّة lsr_* أخرى بقيت بلا قرار صريح — القائمة تُغلق كلّها لا اثنتين.
  select coalesce(string_agg(p.proname, ', ' order by p.proname), '') into v_missing
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'lsr\_%' and p.proacl is null;
  if v_missing <> '' then
    raise exception 'LSR PATCH SELF-TEST: دوالّ lsr_* ما زالت بـproacl NULL: % — أضِفها إلى القرار الصريح', v_missing;
  end if;

  raise notice 'LSR PATCH: أُغلقت الدالّتان، والزنادات (%) سليمة.', v_trigs_after;
end $patch$;

commit;
