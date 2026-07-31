-- ════════════════════════════════════════════════════════════════════════════
-- docs/asset_intelligence_security_patch_RUNME.sql
--
-- رقعة صلاحيات **فقط**: لا تلمس جسم دالّة، ولا صفًّا من بيانات العهدة، ولا
-- منصّة المشاريع، ولا تُطلق حدثًا. معاملة واحدة · بلا CONCURRENTLY · تُعاد.
--
-- ★ لماذا وُجدت ★
--   الفحص الذاتيّ في المعاملة العاشرة من asset_intelligence_RUNME أوقف الترحيلة:
--       ASSET SELF-TEST: anon يملك تنفيذ custody_inv_get_settings()
--   والفحص **محقّ**. لكنّ المشكلة أوسع من دالّة: من 135 دالّة custody_inv_*/civ_*
--   هناك **78** بلا REVOKE من public، فيرث anon تنفيذها. والوراثة هي الآلية —
--   لا منحة مباشرة واحدة لـanon في المستودع كلّه.
--
-- ★ الآلية بدقّة ★
--   PostgreSQL يمنح EXECUTE لـPUBLIC افتراضيًّا عند إنشاء أيّ دالّة. و
--   `grant execute … to authenticated` **لا يُلغي** ذلك الافتراضيّ — يضيف فوقه.
--   وanon عضو في PUBLIC، فيرث. لا يُزيله إلّا `revoke … from public` صريح.
--   وهذا بالضبط ما حدث مع custody_inv_get_settings: مُنحت لـauthenticated في
--   portal_custody_inventory_system_v1_RUNME.sql:1283 ولم يُسحب PUBLIC قطّ.
--
-- ★ حجم الخطر بلا تهويل ★
--   دقّقت الـ78 واحدةً واحدة: منها دوالّ زناد لا تُستدعى مباشرةً (0A000)،
--   ومنها ما يحمل بوّابة دور (civ_is_employee / civ_can_*)، ومنها ما يحمل
--   بوّابة ملكية (auth.uid() <> v_owner → not_your_assignment)، ومنها مولّدات
--   نصّية بلا وصول بيانات. **لم أجد مسارًا واحدًا يُخرج بيانة لجلسة مجهولة.**
--   فهذه ثغرة حقيقية في مصفوفة الصلاحيات، وليست تسريبًا قائمًا. النصفان معًا.
--
-- ★ ولماذا لا يكفي REVOKE وحده ★
--   من الـ78، هناك **59** تُنادى فعلًا من شيفرة التطبيق، و**20** منها بلا منحة
--   `authenticated` صريحة — أي تعتمد على الافتراضيّ PUBLIC لتعمل. فسحبٌ شاملٌ
--   بلا منح يكسر الواجهة. لذلك: يُسحب PUBLIC وanon من الجميع، ثمّ يُمنح
--   authenticated لسطح التطبيق **المعدَّد أدناه بالاسم** — ولا يُمنح لغيره.
--   القائمة مستخرَجة من نداءات التطبيق الفعلية لا من التخمين.
-- ════════════════════════════════════════════════════════════════════════════

begin;

set local statement_timeout = '5min';
set local lock_timeout = '60s';

do $patch$
declare
  -- سطح التطبيق: كلّ دالّة يناديها الكود فعلًا (rpc/… أو اسمها في lib/portal).
  APP_SURFACE constant text[] := array[
    'civ_allowed_transitions', 'civ_asset_state', 'civ_list_eligible_employees',
    'civ_rental_email_queue_enabled', 'civ_rental_enqueue_email', 'custody_inv_admin_adjust_stock',
    'custody_inv_admin_approve_audit', 'custody_inv_admin_archive_asset', 'custody_inv_admin_archive_asset_file',
    'custody_inv_admin_archive_category', 'custody_inv_admin_archive_location', 'custody_inv_admin_assets_photo_status',
    'custody_inv_admin_cancel_assignment', 'custody_inv_admin_cancel_reservation', 'custody_inv_admin_close_maintenance',
    'custody_inv_admin_confirm_assignment', 'custody_inv_admin_correct_stock', 'custody_inv_admin_count_audit_item',
    'custody_inv_admin_create_asset', 'custody_inv_admin_create_assignment', 'custody_inv_admin_create_reservation',
    'custody_inv_admin_create_reservation_v2', 'custody_inv_admin_delete_asset', 'custody_inv_admin_get_dashboard',
    'custody_inv_admin_get_report', 'custody_inv_admin_incident_action', 'custody_inv_admin_inspect_return',
    'custody_inv_admin_list_archived_photos', 'custody_inv_admin_list_deleted_assets', 'custody_inv_admin_open_maintenance',
    'custody_inv_admin_project_dashboard', 'custody_inv_admin_reissue_qr', 'custody_inv_admin_remove_component',
    'custody_inv_admin_remove_kit_item', 'custody_inv_admin_resend_confirmation', 'custody_inv_admin_restore_asset',
    'custody_inv_admin_restore_asset_file', 'custody_inv_admin_revoke_qr', 'custody_inv_admin_set_primary_photo',
    'custody_inv_admin_snapshot_kit', 'custody_inv_admin_start_audit', 'custody_inv_admin_start_inspection',
    'custody_inv_admin_start_return', 'custody_inv_admin_transfer_asset', 'custody_inv_admin_update_asset',
    'custody_inv_admin_update_settings', 'custody_inv_admin_upsert_category', 'custody_inv_admin_upsert_component',
    'custody_inv_admin_upsert_kit', 'custody_inv_admin_upsert_kit_item', 'custody_inv_admin_upsert_location',
    'custody_inv_asset_cost_summary', 'custody_inv_asset_meter_totals', 'custody_inv_asset_utilization',
    'custody_inv_attach_asset_file', 'custody_inv_attach_evidence', 'custody_inv_can_delete',
    'custody_inv_employee_confirm_assignment', 'custody_inv_employee_issue_kit', 'custody_inv_employee_list_available',
    'custody_inv_employee_report_incident', 'custody_inv_employee_request_return', 'custody_inv_employee_self_issue',
    'custody_inv_employee_submit_return', 'custody_inv_evidence_bundle', 'custody_inv_evidence_diagnostics',
    'custody_inv_expire_reservations', 'custody_inv_fulfil_reservation', 'custody_inv_get_asset_catalog_photos',
    'custody_inv_get_asset_changes', 'custody_inv_get_asset_details', 'custody_inv_get_asset_timeline',
    'custody_inv_get_condition_history', 'custody_inv_get_kit_resolved', 'custody_inv_get_my_assignments',
    'custody_inv_get_settings', 'custody_inv_log_label_print', 'custody_inv_lookup_asset',
    'custody_inv_maint_close_with_inspection', 'custody_inv_maint_plan_archive', 'custody_inv_maint_plan_due',
    'custody_inv_maint_plan_upsert', 'custody_inv_maintenance_signals', 'custody_inv_post_closure_correction',
    'custody_inv_qr_scan', 'custody_inv_record_condition', 'custody_inv_record_meter',
    'custody_inv_record_signature', 'custody_inv_request_more_evidence', 'custody_inv_reservation_calendar',
    'custody_inv_resolve_qr', 'custody_inv_reverse_meter', 'custody_inv_set_project'
  ];
  r record;
  v_sig text;
  v_revoked int := 0;
  v_granted int := 0;
  v_left text := '';
  v_bodies_before int;
  v_bodies_after  int;
  v_trigs_before  int;
  v_trigs_after   int;
begin
  -- (٠) بصمة قبل: عدد الدوالّ والزنادات. الرقعة صلاحيات فقط، فيجب ألّا يتغيّرا.
  select count(*) into v_bodies_before from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\');
  select count(*) into v_trigs_before from pg_trigger where not tgisinternal;

  if v_bodies_before = 0 then
    raise exception 'LSR/ASSET PATCH: لا دالّة custody_inv_*/civ_* — الرقعة تفترض أنّ حزمة العهدة مطبَّقة';
  end if;

  -- (١) سحب PUBLIC وanon من **كلّ** دالّة عهدة. الافتراضيّ يُستبدل بقرار.
  for r in
    select p.oid::regprocedure::text as sig, p.proname
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\')
     order by p.proname
  loop
    execute format('revoke all on function %s from public', r.sig);
    begin execute format('revoke all on function %s from anon', r.sig);
      exception when undefined_object then null; end;
    v_revoked := v_revoked + 1;

    -- (٢) ثمّ يُعاد المنح لسطح التطبيق وحده — بالاسم لا بالبادئة.
    if r.proname = any (APP_SURFACE) then
      begin execute format('grant execute on function %s to authenticated', r.sig);
        v_granted := v_granted + 1;
        exception when undefined_object then null; end;
    end if;
  end loop;

  -- (٣) الفحص الذاتيّ قبل COMMIT: لا PUBLIC ولا anon على أيّ دالّة عهدة.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    select coalesce(string_agg(p.oid::regprocedure::text, ' · ' order by p.proname), '') into v_left
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\')
       and has_function_privilege('anon', p.oid, 'EXECUTE');
    if v_left <> '' then
      raise exception 'ASSET PATCH SELF-TEST: anon ما زال ينفّذ: %', v_left; end if;
  end if;
  select coalesce(string_agg(p.oid::regprocedure::text, ' · ' order by p.proname), '') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\')
     and has_function_privilege('public', p.oid, 'EXECUTE');
  if v_left <> '' then
    raise exception 'ASSET PATCH SELF-TEST: PUBLIC ما زال ينفّذ: %', v_left; end if;

  -- (٤) ولا دالّة عهدة بقيت بـproacl NULL — أي بلا قرار مكتوب.
  select coalesce(string_agg(p.proname, ' · ' order by p.proname), '') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\')
     and p.proacl is null;
  if v_left <> '' then
    raise exception 'ASSET PATCH SELF-TEST: دوالّ بلا قرار صلاحيات (proacl NULL): %', v_left; end if;

  -- (٥) سطح التطبيق ما زال قابلًا للنداء بجلسة مستخدم — وإلّا كسرنا الواجهة.
  select coalesce(string_agg(p.oid::regprocedure::text, ' · ' order by p.proname), '') into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = any (APP_SURFACE)
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if v_left <> '' then
    raise exception 'ASSET PATCH SELF-TEST: سطح تطبيق بلا EXECUTE لـauthenticated — الواجهة ستنكسر: %', v_left; end if;

  -- (٦) البصمة: لا جسم دالّة تغيّر ولا زناد.
  select count(*) into v_bodies_after from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'custody\_inv\_%' escape '\' or p.proname like 'civ\_%' escape '\');
  select count(*) into v_trigs_after from pg_trigger where not tgisinternal;
  if v_bodies_after <> v_bodies_before then
    raise exception 'ASSET PATCH SELF-TEST: عدد الدوالّ تغيّر (% ← %) — الرقعة صلاحيات فقط', v_bodies_before, v_bodies_after; end if;
  if v_trigs_after <> v_trigs_before then
    raise exception 'ASSET PATCH SELF-TEST: عدد الزنادات تغيّر (% ← %)', v_trigs_before, v_trigs_after; end if;

  raise notice 'ASSET PATCH: سُحب PUBLIC/anon من % دالّة · مُنح authenticated لـ% دالّة سطح · الزنادات % سليمة.',
    v_revoked, v_granted, v_trigs_after;
end $patch$;

commit;
