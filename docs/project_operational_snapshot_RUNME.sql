-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — ONE AUTHORITATIVE OPERATIONAL SNAPSHOT (RUN ONCE)  [P0-1/2/3]
--
-- Single source for progress + phase + shooting/review/delivery/payment status +
-- lifecycle-step states, so no surface can contradict another (e.g. 100% delivered
-- while "حالة التصوير" reads "لم يبدأ التصوير"). Every status is DERIVED from the
-- authoritative data (project_core.core_stage, deliverables, deliverable_reviews,
-- shoot sessions, delivery/release gate) — never from the stale flat projects.status.
--
--   project_operational_snapshot(project) → {
--     overall_progress, current_phase, lifecycle_status, shooting_status,
--     review_status, delivery_status, payment_release_status, current_version,
--     unresolved_comments, progress_breakdown, lifecycle_steps[] }
--
-- lifecycle_steps carry state completed/current/upcoming/blocked/not_applicable.
-- Read-only, SECURITY DEFINER, same value for admin/owner/staff/client. Idempotent.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.projects')     is null then miss := miss || ' projects'; end if;
  if to_regclass('public.deliverables') is null then miss := miss || ' deliverables'; end if;
  if to_regprocedure('public.project_progress(uuid)') is null then miss := miss || ' project_progress (شغّل project_progress_RUNME.sql)'; end if;
  if to_regprocedure('public.is_client_side(uuid)')     is null then miss := miss || ' is_client_side'; end if;
  if to_regprocedure('public.can_access_project(uuid)') is null then miss := miss || ' can_access_project'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

create or replace function public.project_operational_snapshot(p_project uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_prog jsonb; v_stage text; v_status text; v_pct int; v_state text;
  v_final boolean := false; v_approved boolean := false; v_clirev boolean := false;
  v_intrev boolean := false; v_revreq boolean := false; v_dues boolean := false; v_revoked boolean := false;
  v_shoot_total int := 0; v_shoot_done int := 0; v_shoot_sched int := 0; v_shoot_prog int := 0;
  v_unresolved int := 0; v_curver int := 0; v_advanced boolean;
  v_shoot text; v_review text; v_delivery text; v_cur_idx int; steps jsonb;
begin
  if not (public.is_admin()
          or (public.is_staff() and public.can_access_project(p_project))
          or public.is_client_side(p_project)) then
    raise exception 'not authorized';
  end if;

  select status into v_status from public.projects where id = p_project;
  if v_status is null then raise exception 'not_found'; end if;

  v_prog := public.project_progress(p_project);          -- authoritative progress + phases
  v_pct  := (v_prog->>'pct')::int;
  v_stage := v_prog->>'stage';
  v_state := coalesce(v_prog->>'state','active');

  -- Deliverable-derived signals.
  select bool_or(status='final_delivered'), bool_or(status='approved'),
         bool_or(status='client_review'), bool_or(status='internal_review'),
         bool_or(status='revision_requested'), coalesce(max(version),0)
    into v_final, v_approved, v_clirev, v_intrev, v_revreq, v_curver
    from public.deliverables where project_id = p_project and coalesce(is_deleted,false)=false;

  select count(*) into v_unresolved
    from public.client_comments c join public.deliverables d on d.id = c.deliverable_id
    where d.project_id = p_project and coalesce(c.is_deleted,false)=false and coalesce(c.status,'open') <> 'resolved';

  if to_regclass('public.project_delivery_release') is not null then
    select coalesce(bool_or(dues_cleared),false), coalesce(bool_or(revoked_at is not null),false)
      into v_dues, v_revoked from public.project_delivery_release where project_id = p_project;
  end if;

  if to_regclass('public.project_shoot_sessions') is not null then
    select count(*) filter (where status<>'cancelled'),
           count(*) filter (where status='completed'),
           count(*) filter (where status in ('confirmed','planned')),
           count(*) filter (where status='in_progress')
      into v_shoot_total, v_shoot_done, v_shoot_sched, v_shoot_prog
      from public.project_shoot_sessions where project_id = p_project and coalesce(is_deleted,false)=false;
  end if;

  -- A project past production (by stage OR by an approved/final deliverable) cannot
  -- still read "not started" for filming — infer completed.
  v_advanced := coalesce(v_stage,'') in ('post_production','internal_review','client_review','revision','approved','delivered','closed')
                or v_final or v_approved
                or v_status in ('shooting_completed','editing','ready_for_review','delivered');

  -- SHOOTING
  v_shoot := case
    when v_advanced or v_shoot_done > 0 then 'completed'
    when v_shoot_prog > 0 or coalesce(v_stage,'')='in_production' or v_status='filming' then 'in_progress'
    when v_shoot_sched > 0 or coalesce(v_stage,'') in ('ready','scheduled') or v_status='shooting_scheduled' then 'scheduled'
    else 'not_started' end;

  -- REVIEW
  v_review := case
    when v_final or (v_approved and v_unresolved = 0) then 'approved'
    when v_revreq or v_unresolved > 0 then 'revision_requested'
    when v_clirev then 'awaiting_client_review'
    when v_intrev then 'internal_review'
    else 'not_started' end;

  -- DELIVERY
  v_delivery := case
    when v_revoked then 'revoked'
    when v_final and v_dues then 'delivered'
    when v_final and not v_dues then 'payment_pending'
    when v_approved then 'ready_for_delivery'
    else 'not_ready' end;

  -- LIFECYCLE STEPS (10-step client timeline) — state from the current index.
  v_cur_idx := case coalesce(v_stage,'')
    when 'lead_approved' then 0 when 'project_created' then 0
    when 'planning' then 1 when 'ready' then 2 when 'scheduled' then 2
    when 'in_production' then 3 when 'post_production' then 5
    when 'internal_review' then 6 when 'client_review' then 7 when 'revision' then 7
    when 'approved' then 8 when 'delivered' then 9 when 'closed' then 9
    else case coalesce(v_status,'')
      when 'request_received' then 0 when 'pre_production' then 1 when 'shooting_scheduled' then 2
      when 'filming' then 3 when 'shooting_completed' then 4 when 'editing' then 5
      when 'ready_for_review' then 6 when 'delivered' then 9 else 0 end
    end;
  -- A final-delivered deliverable forces the timeline to complete.
  if v_final then v_cur_idx := greatest(v_cur_idx, 9); end if;

  select jsonb_agg(jsonb_build_object(
    'key', s.key, 'label_ar', s.ar, 'label_en', s.en,
    'state', case
      when v_state in ('cancelled','archived') then 'not_applicable'
      when s.idx < v_cur_idx then 'completed'
      when s.idx = v_cur_idx then (case when v_cur_idx = 9 then 'completed' else 'current' end)
      else 'upcoming' end
  ) order by s.idx) into steps
  from (values
    (0,'request_received','استلام الطلب','Request Received'),
    (1,'pre_production','مرحلة التحضير','Pre-Production'),
    (2,'shooting_scheduled','جدولة التصوير','Shooting Scheduled'),
    (3,'filming','مرحلة التصوير','Filming'),
    (4,'shooting_completed','اكتمال التصوير','Shooting Completed'),
    (5,'editing','مرحلة المونتاج','Editing'),
    (6,'ready_for_review','جاهز للمراجعة','Ready for Review'),
    (7,'client_review','بانتظار اعتماد العميل','Awaiting Client Approval'),
    (8,'approved','معتمد','Approved'),
    (9,'delivered','تم التسليم','Delivered')
  ) as s(idx,key,ar,en);

  return jsonb_build_object(
    'overall_progress', v_pct,
    'current_phase', coalesce(v_stage, v_status),
    'lifecycle_status', v_state,
    'shooting_status', v_shoot,
    'review_status', v_review,
    'delivery_status', v_delivery,
    'payment_release_status', case when v_revoked then 'revoked' when v_dues then 'released' when v_final then 'pending' else 'not_applicable' end,
    'current_version', v_curver,
    'unresolved_comments', v_unresolved,
    'progress_breakdown', v_prog->'phases',
    'overridden', coalesce((v_prog->>'overridden')::boolean, false),
    'lifecycle_steps', coalesce(steps, '[]'::jsonb)
  );
end $$;

revoke all on function public.project_operational_snapshot(uuid) from public, anon;
grant execute on function public.project_operational_snapshot(uuid) to authenticated;

do $v$
begin
  if to_regprocedure('public.project_operational_snapshot(uuid)') is null then raise exception 'فشل: project_operational_snapshot'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
