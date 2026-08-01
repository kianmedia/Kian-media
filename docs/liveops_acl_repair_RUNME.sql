-- ════════════════════════════════════════════════════════════════════════════
-- docs/liveops_acl_repair_RUNME.sql
--
-- رقعة **صلاحيات فقط** للوحة العمليات المباشرة. ✅ ملفّ SQL يُنفَّذ في محرّر SQL.
--
-- ⛔ لا تُستبدل دالّة، ولا يُغيَّر جسم، ولا يُلمس جدول، ولا تُكتب بيانات.
--    معاملة واحدة · فحص ذاتيّ قبل COMMIT · أضيق أثر ممكن.
--
-- العطل: 56 دالّة liveops_* أُنشئت بلا revoke من PUBLIC. وPostgreSQL يمنح
-- PUBLIC تنفيذًا افتراضيًّا عند الإنشاء، وanon عضوٌ في PUBLIC — فورث تنفيذ
-- كلّ شيء، ومنه كاتبات: liveops_incident_open · liveops_bulletin_upsert ·
-- liveops_inventory_upsert · liveops_client_person_upsert. وهي SECURITY
-- DEFINER، فتنفيذها بدور anon يعمل بصلاحيات المالك.
--
-- ★ لماذا لا يكفي «grant to authenticated»: المنح يضيف ولا يُلغي. الوراثة من
--   PUBLIC تبقى حتّى يُسحَب صراحةً من PUBLIC على **التوقيع نفسه**.
--
-- ★ سطح التطبيق يُعاد منحه بالاسم، وإلّا كسر السحبُ الشاملُ كلّ نداء:
--   28 دالّة يناديها المتصفّح بدور authenticated، وliveops_client_view وحدها
--   يناديها الخادم بمفتاح service_role (app/api/public/live-status/route.ts).
-- ════════════════════════════════════════════════════════════════════════════

begin;

do $acl$
declare
  f text;
  v_before int; v_bodies_before int;
  v_pub int; v_anon int; v_surface_lost text := '';
  APP_SURFACE constant text[] := array[
    'liveops_bulletin_upsert','liveops_client_person_delete','liveops_client_person_upsert',
    'liveops_client_preview','liveops_cue_log','liveops_health_record',
    'liveops_incident_open','liveops_incident_release_root_cause','liveops_incident_resolve',
    'liveops_incident_update','liveops_inventory_delete','liveops_inventory_set_state',
    'liveops_inventory_upsert','liveops_link_audit','liveops_link_create','liveops_link_issue',
    'liveops_link_list','liveops_link_revoke','liveops_live_board','liveops_report_approve',
    'liveops_report_upsert','liveops_rundown_delete','liveops_rundown_set_status',
    'liveops_rundown_upsert','liveops_session_detail','liveops_session_list',
    'liveops_session_set_status','liveops_session_upsert'];
  -- ⚠️ liveops_client_text ليست RPC: هي **سلسلة نصّية** يقارنها التطبيق في
  --    نصّ الخطأ (lib/portal/liveOps.ts:323). والكائن الحقيقيّ
  --    liveops_client_text_guard دالّةُ زناد لا تُنادى مباشرةً أصلًا
  --    (0A000)، وصلاحيتها تُفحص عند CREATE TRIGGER لا عند الإطلاق.
  --    منحُها كان سيوسّع السطح بلا سبب.
  SERVER_SURFACE constant text[] := array['liveops_client_view'];
begin
  -- بصمة قبل: عدد الدوالّ لا يتغيّر، فالرقعة لا تُنشئ ولا تحذف.
  select count(*) into v_bodies_before
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'liveops\_%';
  v_before := v_bodies_before;
  if v_bodies_before = 0 then
    raise exception 'ACL REPAIR: لا دالّة liveops_ — الحزمة غير مركَّبة. لا تُشغّل هذه الرقعة';
  end if;

  -- (١) سحب شامل من PUBLIC ومن anon، بالتوقيع الكامل (أنواعٌ فقط) لكلّ overload.
  for f in
    select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'liveops\_%'
  loop
    execute format('revoke all on function %s from public', f);
    begin execute format('revoke all on function %s from anon', f);
    exception when undefined_object then null; end;
    begin execute format('revoke all on function %s from authenticated', f);
    exception when undefined_object then null; end;
  end loop;

  -- (٢) إعادة المنح لسطح التطبيق بالاسم — لا سحب شامل بلا إعادة.
  for f in
    select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(APP_SURFACE)
  loop
    begin execute format('grant execute on function %s to authenticated', f);
    exception when undefined_object then null; end;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    for f in
      select 'public.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(SERVER_SURFACE)
    loop
      execute format('grant execute on function %s to service_role', f);
    end loop;
  end if;

  -- ══ الفحص الذاتيّ — قبل COMMIT ══════════════════════════════════════════
  select count(*) into v_pub
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'liveops\_%'
     and (p.proacl is null or has_function_privilege('public', p.oid, 'EXECUTE'));
  if v_pub > 0 then
    raise exception 'ACL SELF-TEST: % دالّة ما زالت مفتوحة لـPUBLIC', v_pub;
  end if;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    select count(*) into v_anon
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'liveops\_%'
       and has_function_privilege('anon', p.oid, 'EXECUTE');
    if v_anon > 0 then
      raise exception 'ACL SELF-TEST: anon ما زال ينفّذ % دالّة', v_anon;
    end if;
  end if;

  -- سطح التطبيق ما زال يعمل: كسرُ الواجهة أسوأ من الثغرة التي نُغلقها.
  for f in select unnest(APP_SURFACE) loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = f)
       and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and p.proname = f
                          and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    then v_surface_lost := v_surface_lost || ' ' || f; end if;
  end loop;
  if v_surface_lost <> '' then
    raise exception 'ACL SELF-TEST: سطح التطبيق فقد التنفيذ:%', v_surface_lost;
  end if;

  -- ولا دالّة أُنشئت أو حُذفت: رقعة صلاحيات فقط.
  select count(*) into v_bodies_before
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'liveops\_%';
  if v_bodies_before <> v_before then
    raise exception 'ACL SELF-TEST: عدد الدوالّ تغيّر % ← % — الرقعة صلاحيات فقط',
      v_before, v_bodies_before;
  end if;

  raise notice 'ACL REPAIR OK: % دالّة · PUBLIC=0 · anon=0 · سطح التطبيق سليم', v_before;
end
$acl$;

commit;
