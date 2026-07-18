-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — AUTHORITATIVE PROJECT PROGRESS (RUN ONCE)  [P0-9]
--
-- One weighted progress calculation derived from REAL project state, returned to
-- Admin and Client identically (same SECURITY DEFINER function → same number). No
-- manual field to contradict it. Recomputed on every read, so it updates after any
-- mutation. Capped at 100, and never reaches 100 until final delivery + dues
-- release. Archived/cancelled projects return safely.
--
--   project_progress(project) → { pct, delivered, phases:[{key,ar,en,weight,pct,earned}] }
--
-- Weighted model (weights sum to 100):
--   initiation 5 · pre-production 20 · scheduling 10 · production 25 ·
--   post-production 20 · client review 10 · approval/final delivery 10
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.projects')     is null then miss := miss || ' projects'; end if;
  if to_regclass('public.deliverables') is null then miss := miss || ' deliverables'; end if;
  if to_regprocedure('public.is_client_side(uuid)')     is null then miss := miss || ' is_client_side'; end if;
  if to_regprocedure('public.can_access_project(uuid)') is null then miss := miss || ' can_access_project'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

create or replace function public.project_progress(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  f_pre numeric := 0; f_sch numeric := 0; f_prod numeric := 0; f_post numeric := 0; f_rev numeric := 0; f_del numeric := 0;
  n int; d int; v_delivered boolean := false; v_dues boolean := false; v_status text; total numeric;
  v_manual int := null; v_final int; v_stage text; v_floor int := 0; v_state text := 'active';
begin
  -- Access: admin, staff on the project, or the project's client — all get the SAME value.
  if not (public.is_admin()
          or (public.is_staff() and public.can_access_project(p_project))
          or public.is_client_side(p_project)) then
    raise exception 'not authorized';
  end if;

  select status into v_status from public.projects where id = p_project;
  if v_status is null then raise exception 'not_found'; end if;

  -- Pre-production: fraction of active items done (approved counts as done).
  if to_regclass('public.preproduction_items') is not null then
    select count(*) filter (where status = 'done' or approved_at is not null), count(*)
      into d, n from public.preproduction_items
      where project_id = p_project and coalesce(is_deleted,false)=false and coalesce(is_active,true)=true;
    f_pre := case when n > 0 then d::numeric / n else 0 end;
  end if;

  -- Scheduling readiness: fraction of shoots confirmed/beyond (not just planned).
  -- Production: fraction of non-cancelled shoots completed.
  if to_regclass('public.project_shoot_sessions') is not null then
    select count(*) filter (where status <> 'cancelled') into n from public.project_shoot_sessions
      where project_id = p_project and coalesce(is_deleted,false)=false;
    if n > 0 then
      select count(*) filter (where status in ('confirmed','in_progress','completed')) into d
        from public.project_shoot_sessions where project_id = p_project and coalesce(is_deleted,false)=false and status <> 'cancelled';
      f_sch := d::numeric / n;
      select count(*) filter (where status = 'completed') into d
        from public.project_shoot_sessions where project_id = p_project and coalesce(is_deleted,false)=false and status <> 'cancelled';
      f_prod := d::numeric / n;
    end if;
  end if;

  -- Post-production: fraction of deliverables that reached approved/final.
  select count(*), count(*) filter (where status in ('approved','final_delivered')) into n, d
    from public.deliverables where project_id = p_project and coalesce(is_deleted,false)=false;
  f_post := case when n > 0 then d::numeric / n else 0 end;
  v_delivered := exists (select 1 from public.deliverables where project_id = p_project and status = 'final_delivered' and coalesce(is_deleted,false)=false);

  -- Client review: engaged once a deliverable is in review/approved/final; full credit
  -- only when there are no unresolved client comments.
  if exists (select 1 from public.deliverables where project_id = p_project and coalesce(is_deleted,false)=false
             and status in ('client_review','revision_requested','approved','final_delivered')) then
    if exists (select 1 from public.client_comments c join public.deliverables dd on dd.id = c.deliverable_id
               where dd.project_id = p_project and coalesce(c.is_deleted,false)=false and coalesce(c.status,'open') <> 'resolved') then
      f_rev := 0.5; else f_rev := 1; end if;
  end if;

  -- Approval / final delivery: final delivered (+ dues cleared for full credit).
  if to_regclass('public.project_delivery_release') is not null then
    select coalesce(bool_or(dues_cleared), false) into v_dues from public.project_delivery_release where project_id = p_project;
  end if;
  f_del := case when v_delivered and v_dues then 1 when v_delivered then 0.6 else 0 end;

  total := 5*1 + 20*f_pre + 10*f_sch + 25*f_prod + 20*f_post + 10*f_rev + 10*f_del;  -- initiation always earned (data-weighted)

  -- LIFECYCLE FLOOR — progress must never fall below the minimum implied by the
  -- operational stage, so "Approved" can never read 10%. project_core.core_stage
  -- (the 13-stage lifecycle) is authoritative; fall back to projects.status.
  if to_regclass('public.project_core') is not null then
    select core_stage, progress_manual into v_stage, v_manual from public.project_core where project_id = p_project;
  end if;
  v_floor := case coalesce(v_stage,'')
    when 'lead_approved' then 5 when 'project_created' then 5
    when 'planning' then 10
    when 'ready' then 25 when 'scheduled' then 25
    when 'in_production' then 35
    when 'post_production' then 60
    when 'internal_review' then 70
    when 'client_review' then 80
    when 'revision' then 80
    when 'approved' then 95
    when 'delivered' then 95
    when 'closed' then 100
    else case coalesce(v_status,'')                      -- fallback to the flat status
      when 'request_received' then 5 when 'pre_production' then 10
      when 'shooting_scheduled' then 25 when 'shooting_completed' then 35
      when 'editing' then 60 when 'ready_for_review' then 80
      when 'delivered' then 95 else 5 end
    end;

  total := greatest(total, v_floor);                     -- data can raise, never lower below the floor

  -- Delivery cap: 100 only when truly delivered + released, or the stage is closed;
  -- never before. Cancelled/archived is a neutral non-progress state (not a fake 100).
  if v_status in ('archived','cancelled') then
    v_state := v_status; total := least(total, 100);
  elsif (v_delivered and v_dues) or coalesce(v_stage,'') = 'closed' then
    total := 100;
  elsif coalesce(v_stage,'') = 'revision' then
    total := least(total, 89);                           -- revision stays below approval
  else
    total := least(total, 95);                           -- never 100 until delivered+released
  end if;

  v_final := coalesce(v_manual, round(least(greatest(total,0),100))::int);

  return jsonb_build_object(
    'pct', v_final,
    'state', v_state, 'stage', v_stage, 'floor', v_floor,
    'overridden', (v_manual is not null),
    'auto_pct', round(least(greatest(total,0),100)),
    'delivered', (v_delivered and v_dues),
    'phases', jsonb_build_array(
      jsonb_build_object('key','initiation','ar','بدء المشروع','en','Initiation','weight',5,'pct',100,'earned',5),
      jsonb_build_object('key','preproduction','ar','ما قبل الإنتاج','en','Pre-Production','weight',20,'pct',round(f_pre*100),'earned',round(20*f_pre)),
      jsonb_build_object('key','scheduling','ar','الجاهزية والجدولة','en','Scheduling','weight',10,'pct',round(f_sch*100),'earned',round(10*f_sch)),
      jsonb_build_object('key','production','ar','الإنتاج/التصوير','en','Production','weight',25,'pct',round(f_prod*100),'earned',round(25*f_prod)),
      jsonb_build_object('key','postproduction','ar','ما بعد الإنتاج','en','Post-Production','weight',20,'pct',round(f_post*100),'earned',round(20*f_post)),
      jsonb_build_object('key','review','ar','مراجعة العميل','en','Client Review','weight',10,'pct',round(f_rev*100),'earned',round(10*f_rev)),
      jsonb_build_object('key','delivery','ar','الاعتماد والتسليم','en','Delivery','weight',10,'pct',round(f_del*100),'earned',round(10*f_del))
    ));
end $$;

revoke all on function public.project_progress(uuid) from public, anon;
grant execute on function public.project_progress(uuid) to authenticated;

do $v$
begin
  if to_regprocedure('public.project_progress(uuid)') is null then raise exception 'فشل: project_progress'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
