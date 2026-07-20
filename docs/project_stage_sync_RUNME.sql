-- ════════════════════════════════════════════════════════════════════════════
-- project_stage_sync_RUNME.sql  —  توحيد مرحلة المشروع على مصدر حقيقة واحد
-- ────────────────────────────────────────────────────────────────────────────
-- المشكلة: دورة حياة المشروع (project_core.core_stage) تتقدّم، لكن العمود القديم
--   projects.status لا يُزامَن أبدًا منها، فتظهر مرحلة متناقضة (مثال حقيقي:
--   core_stage='delivered' بينما projects.status='request_received'). السطوح
--   القديمة (بطاقات /projects، شارة رأس /projects/[id]) تقرأ projects.status
--   المتجمّد. السطوح الحديثة (project_operational_snapshot, project_core_dashboard,
--   project_progress) تقرأ core_stage أصلًا — لا تغيير عليها.
--
-- التصميم:
--   • مصدر الحقيقة الوحيد = public.project_core.core_stage (13 مرحلة). لا مصدر جديد.
--   • public.projects.status = حقل توافقي (Deprecated) يُزامَن ذرّيًا من core_stage
--     عبر خريطة مركزية وحيدة project_status_for_stage(). لا يُكتب مستقلًا بعد الآن.
--   • المزامنة داخل نفس معاملة project_core_set_stage و project_core_create_project.
--   • Backfill آمن Idempotent للسجلّات القديمة (بلا DROP، بلا حذف بيانات).
--
-- الخريطة المركزية الوحيدة (core_stage 13 → projects.status 7) — عكسٌ للـseed في
--   project_core_UI_COMPLETION_RUNME.sql:
--     lead_approved, project_created                     → request_received
--     planning, ready                                    → pre_production
--     scheduled, in_production                           → shooting_scheduled
--     post_production, revision                          → editing
--     internal_review, client_review, approved           → ready_for_review
--     delivered, closed                                  → delivered
--
-- التشغيل: شغّل هذا الملف مرة واحدة على Production. Idempotent (create or replace /
--   update guarded). لا يعتمد على service key. لا يلمس Zoho ولا Phase B.
--
-- ── استعلام التشخيص (شغّله قبل وبعد — يجب أن يعود 0 بعد) ──────────────────────
--   select count(*) as conflicts
--   from public.projects p join public.project_core pc on pc.project_id = p.id
--   where p.is_deleted = false
--     and p.status is distinct from public.project_status_for_stage(pc.core_stage);
--   -- لعرض العيّنات المتعارضة:
--   -- select p.id, p.status, pc.core_stage, public.project_status_for_stage(pc.core_stage) as should_be
--   --   from public.projects p join public.project_core pc on pc.project_id = p.id
--   --   where p.is_deleted=false and p.status is distinct from public.project_status_for_stage(pc.core_stage);
-- ════════════════════════════════════════════════════════════════════════════

-- ═══ 0) Preflight — تأكّد من الاعتمادات قبل أي تعديل ═══
do $pf$
declare miss text := '';
begin
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='projects' and column_name='status')=0
    then miss := miss || ' projects.status'; end if;
  if (select count(*) from information_schema.columns
      where table_schema='public' and table_name='project_core' and column_name='core_stage')=0
    then miss := miss || ' project_core.core_stage'; end if;
  if to_regprocedure('public.project_core_set_stage(uuid,text,text)') is null
    then miss := miss || ' project_core_set_stage()'; end if;
  if to_regprocedure('public.project_core_create_project(jsonb)') is null
    then miss := miss || ' project_core_create_project()'; end if;
  if to_regprocedure('public.project_progress(uuid)') is null
    then miss := miss || ' project_progress()'; end if;
  if miss <> '' then
    raise exception 'نقص في الاعتمادات (%). شغّل project_core_FINAL_RUNME.sql + project_core_UI_COMPLETION_RUNME.sql + project_core_progress_engine_FIX_RUNME.sql أولًا.', miss;
  end if;
end $pf$;

begin;

-- ═══ 1) الخريطة المركزية الوحيدة: core_stage (13) → projects.status (7) ═══
--     كل شيء يشتقّ المرحلة يمرّ عبر هذه الدالة — يُمنع تكرار الخريطة في أي مكان آخر.
create or replace function public.project_status_for_stage(p_stage text)
returns text language sql immutable set search_path = public as $$
  select case p_stage
    when 'lead_approved'   then 'request_received'
    when 'project_created' then 'request_received'
    when 'planning'        then 'pre_production'
    when 'ready'           then 'pre_production'
    when 'scheduled'       then 'shooting_scheduled'
    when 'in_production'   then 'shooting_scheduled'
    when 'post_production' then 'editing'
    when 'revision'        then 'editing'
    when 'internal_review' then 'ready_for_review'
    when 'client_review'   then 'ready_for_review'
    when 'approved'        then 'ready_for_review'
    when 'delivered'       then 'delivered'
    when 'closed'          then 'delivered'
    else 'request_received'
  end
$$;

-- ═══ 2) set_stage — نسخة أمينة من project_core_progress_engine_FIX_RUNME.sql
--        (المرحلة + السجل + إعادة احتساب التقدّم الذرّي) + مزامنة projects.status
--        داخل نفس المعاملة. أي فشل يُلغي تغيير المرحلة كاملًا (Rollback). ═══
create or replace function public.project_core_set_stage(p_project uuid, p_stage text, p_note text default null)
returns public.project_core language plpgsql security definer set search_path = public as $$
declare r public.project_core; v_from text; v_fi int; v_ti int; v_reason text := nullif(btrim(p_note),'');
  v_order text[] := array['lead_approved','project_created','planning','ready','scheduled','in_production',
                          'post_production','internal_review','client_review','revision','approved','delivered','closed'];
begin
  if not public.can_manage_projects() and not public.can_edit_project(p_project) then raise exception 'not authorized'; end if;
  if not (p_stage = any(v_order)) then raise exception 'bad_stage'; end if;
  select core_stage into v_from from public.project_core where project_id = p_project;
  v_from := coalesce(v_from, 'project_created');
  if v_from = p_stage then
    -- لا تغيير في المرحلة: اضمن مع ذلك أن الحقل التوافقي متوافق (يُصلح أي انجراف سابق).
    update public.projects set status = public.project_status_for_stage(p_stage)
      where id = p_project and status is distinct from public.project_status_for_stage(p_stage);
    select * into r from public.project_core where project_id = p_project; return r;
  end if;
  v_fi := array_position(v_order, v_from); v_ti := array_position(v_order, p_stage);

  if v_ti < v_fi or p_stage = 'closed' then
    if v_reason is null then raise exception 'reason_required'; end if;
    if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  end if;
  if p_stage = 'delivered' and not public.can_manage_projects() then raise exception 'not authorized'; end if;
  if v_ti > v_fi + 1 and not public.is_owner() then raise exception 'no_stage_skip'; end if;
  if p_stage = 'ready' then
    if not exists (select 1 from public.project_members m where m.project_id = p_project and m.role='kian_manager' and m.is_deleted=false)
      then raise exception 'need_manager'; end if;
    if not exists (select 1 from public.project_core pc where pc.project_id = p_project and pc.due_date is not null)
      then raise exception 'need_due_date'; end if;
  end if;

  insert into public.project_core(project_id, core_stage, updated_by)
    values (p_project, p_stage, auth.uid())
    on conflict (project_id) do update set core_stage = p_stage, updated_at = now(), updated_by = auth.uid()
    returning * into r;
  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
    values (p_project, v_from, p_stage, v_reason, auth.uid());
  perform public.pc_log(p_project, 'stage_changed', 'project', p_project, jsonb_build_object('from', v_from, 'to', p_stage));
  perform public.pc_notify_team(p_project, 'project_status_changed', 'project', p_project,
    'تغيّرت مرحلة المشروع إلى '||p_stage, 'Project stage changed to '||p_stage, auth.uid());

  -- ★ إعادة احتساب التقدّم وحفظه داخل نفس المعاملة — بلا ابتلاع أخطاء (كما في محرّك التقدّم).
  update public.project_core
    set progress_pct = (public.project_progress(p_project)->>'pct')::int, updated_at = now()
    where project_id = p_project returning * into r;
  if r.project_id is null then raise exception 'progress_recompute_failed'; end if;

  -- ★ مزامنة الحقل التوافقي projects.status من المصدر الوحيد (core_stage) — نفس المعاملة.
  --   فشل هذا التحديث يُلغي تغيير المرحلة كاملًا (لا حالة متناقضة تُحفَظ).
  update public.projects set status = public.project_status_for_stage(p_stage) where id = p_project;

  return r;
end $$;

-- ═══ 3) create_project — نسخة أمينة من project_core_UI_COMPLETION_RUNME.sql
--        + إدراج projects.status مشتقًّا من المرحلة المختارة (بدل ثابت request_received). ═══
create or replace function public.project_core_create_project(p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_project uuid; v_stage text; v_mgr uuid; v_name text;
begin
  if not public.can_manage_projects() then raise exception 'not authorized'; end if;
  v_name := btrim(coalesce(p_data->>'project_name',''));
  if v_name = '' then raise exception 'name_required'; end if;
  v_stage := coalesce(nullif(p_data->>'core_stage',''),'planning');
  if v_stage not in ('lead_approved','project_created','planning','ready','scheduled','in_production',
                     'post_production','internal_review','client_review','revision','approved','delivered','closed')
    then raise exception 'bad_stage'; end if;

  v_client := nullif(p_data->>'client_id','')::uuid;
  if v_client is not null then
    if not exists (select 1 from public.clients where id = v_client and is_deleted = false) then raise exception 'bad_client'; end if;
  elsif coalesce(btrim(p_data->>'client_name'),'') <> '' then
    insert into public.clients(user_id, full_name, company, email, email_is_placeholder)
      values (null, btrim(p_data->>'client_name'), nullif(btrim(p_data->>'client_company'),''), public.gen_pending_email(), true)
      returning id into v_client;
  else
    raise exception 'client_required';
  end if;

  -- status يُشتقّ من المرحلة المختارة (مزامنة من الإنشاء) بدل ثابت 'request_received'.
  insert into public.projects(project_name, client_id, status, notes)
    values (v_name, v_client, public.project_status_for_stage(v_stage), nullif(btrim(p_data->>'description'),''))
    returning id into v_project;   -- Trigger trg_pc_autoinit ينشئ project_core بمرحلة project_created

  update public.project_core set
    core_stage    = v_stage,
    priority      = coalesce(nullif(p_data->>'priority',''),'normal'),
    start_date    = nullif(p_data->>'start_date','')::date,
    due_date      = nullif(p_data->>'due_date','')::date,
    budget_amount = case when (public.can_manage_projects() or public.can_see_financials())
                          then nullif(p_data->>'budget_amount','')::numeric else null end,
    project_type  = nullif(p_data->>'project_type',''),
    currency      = coalesce(nullif(p_data->>'currency',''),'SAR'),
    updated_at = now(), updated_by = auth.uid()
    where project_id = v_project;

  insert into public.project_members(project_id, user_id, role, added_by)
    values (v_project, auth.uid(), 'kian_manager', auth.uid()) on conflict (project_id, user_id) do nothing;
  v_mgr := nullif(p_data->>'manager_id','')::uuid;
  if v_mgr is not null and v_mgr <> auth.uid() then
    insert into public.project_members(project_id, user_id, role, added_by)
      values (v_project, v_mgr, 'kian_manager', auth.uid()) on conflict (project_id, user_id) do nothing;
  end if;

  insert into public.project_status_history(project_id, from_stage, to_stage, note, changed_by)
    values (v_project, null, v_stage, 'project created', auth.uid());
  perform public.pc_log(v_project, 'project_created', 'project', v_project, jsonb_build_object('name', v_name));
  perform public.pc_notify_team(v_project, 'project_status_changed', 'project', v_project,
    'أُنشئ مشروع جديد: '||v_name, 'New project created: '||v_name, auth.uid());

  return jsonb_build_object('ok', true, 'project_id', v_project, 'stage', v_stage);
end $$;

-- ═══ 4) Backfill آمن — مزامنة projects.status من core_stage للسجلّات المتعارضة فقط.
--        بلا DROP، بلا حذف؛ يلمس فقط الصفوف التي تختلف قيمتها (Idempotent). ═══
do $bf$
declare v_before int; v_after int; v_fixed int;
begin
  select count(*) into v_before
  from public.projects p join public.project_core pc on pc.project_id = p.id
  where p.is_deleted = false
    and p.status is distinct from public.project_status_for_stage(pc.core_stage);

  update public.projects p
     set status = public.project_status_for_stage(pc.core_stage)
    from public.project_core pc
   where pc.project_id = p.id
     and p.is_deleted = false
     and p.status is distinct from public.project_status_for_stage(pc.core_stage);
  get diagnostics v_fixed = row_count;

  select count(*) into v_after
  from public.projects p join public.project_core pc on pc.project_id = p.id
  where p.is_deleted = false
    and p.status is distinct from public.project_status_for_stage(pc.core_stage);

  raise notice 'stage-sync backfill: conflicts before=%, fixed=%, conflicts after=%', v_before, v_fixed, v_after;
  if v_after <> 0 then
    raise exception 'backfill لم يُصفّر التعارضات (متبقٍّ %). راجع قيم core_stage غير المتوقّعة.', v_after;
  end if;
end $bf$;

-- ═══ 5) Grants ═══
do $g$
begin
  execute 'grant execute on function public.project_status_for_stage(text) to authenticated, anon';
  execute 'grant execute on function public.project_core_set_stage(uuid,text,text) to authenticated';
  execute 'grant execute on function public.project_core_create_project(jsonb) to authenticated';
end $g$;

commit;

notify pgrst, 'reload schema';

-- ── تحقّق نهائي (اختياري، بعد الـcommit) ──
--   select count(*) as remaining_conflicts
--   from public.projects p join public.project_core pc on pc.project_id = p.id
--   where p.is_deleted=false and p.status is distinct from public.project_status_for_stage(pc.core_stage);
--   -- يجب أن يعود 0.
