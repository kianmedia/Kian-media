-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — §6 SECURE PROJECT TIMELINE (RUN ONCE)
--
-- A single chronological, role-scoped projection of project history. Reuses the
-- existing activity_log (admin-only RLS) safely via a SECURITY DEFINER RPC that
-- classifies every event's visibility (admin / internal / client) and returns
-- only what the caller may see. The client NEVER receives financial, staff, or
-- internal events. No new event store — it unions activity_log + the review /
-- version / download records so the timeline is complete without backfilling
-- triggers everywhere.
--
--   project_timeline(project, limit) → [{ ts, actor, actor_name, role,
--     event_type, entity_type, entity_id, visibility, meta }]  newest-first.
--
-- Scope: admin/super/staff-read-all → all; project staff → internal + client;
-- project client → client-visible only. Idempotent, read-only, non-destructive.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.activity_log')          is null then miss := miss || ' activity_log'; end if;
  if to_regclass('public.deliverables')          is null then miss := miss || ' deliverables'; end if;
  if to_regclass('public.deliverable_reviews')   is null then miss := miss || ' deliverable_reviews'; end if;
  if to_regclass('public.deliverable_versions')  is null then miss := miss || ' deliverable_versions (شغّل deliverable_versions_RUNME.sql)'; end if;
  if to_regclass('public.deliverable_downloads') is null then miss := miss || ' deliverable_downloads'; end if;
  if to_regprocedure('public.is_admin()') is null then miss := miss || ' is_admin()'; end if;
  if to_regprocedure('public.project_role(uuid)') is null then miss := miss || ' project_role(uuid)'; end if;
  if to_regprocedure('public.is_client_side(uuid)') is null then miss := miss || ' is_client_side(uuid)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

create or replace function public.project_timeline(p_project uuid, p_limit int default 200)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_scope text; v jsonb;
begin
  if public.is_admin() or public.staff_reads_all_projects() then v_scope := 'admin';
  elsif public.project_role(p_project) is not null then v_scope := 'internal';
  elsif public.is_client_side(p_project) then v_scope := 'client';
  else raise exception 'not authorized'; end if;

  with dlv as (select id from public.deliverables where project_id = p_project),
  ev as (
    -- (1) activity_log rows tied to this project or its deliverables
    select a.created_at as ts, a.actor_id, a.actor_role as role, a.action as event_type,
      coalesce(nullif(a.entity_type,''),'') as entity_type, a.entity_id,
      case
        when a.action like 'delivery.payment%' or a.action like 'delivery.release%'
          or a.action like 'finance%' or a.action like 'expense%' or a.action like '%budget%'
          or a.action like '%invoice%' or a.action like '%quote%' then 'admin'
        when a.action in ('review.requested','deliverable.final_delivered','deliverable.uploaded',
                          'deliverable.version_added','deliverable.final_version_set','deliverable.note_resolved') then 'client'
        else 'internal' end as visibility,
      a.metadata as meta
    from public.activity_log a
    where (a.entity_type = 'project' and a.entity_id = p_project)
       or (a.entity_type = 'deliverable' and a.entity_id in (select id from dlv))
    union all
    -- (2) client review decisions (always client-visible)
    select r.created_at, r.reviewer_id, 'client', 'client.'||r.decision, 'deliverable', r.deliverable_id, 'client',
      jsonb_build_object('version_id', r.version_id, 'note', left(coalesce(r.comments,''),200))
    from public.deliverable_reviews r
    where r.deliverable_id in (select id from dlv) and coalesce(r.is_deleted,false) = false
    union all
    -- (3) version uploads
    select dv.uploaded_at, dv.uploaded_by, 'kian_editor', 'deliverable.version_uploaded', 'deliverable', dv.deliverable_id, 'client',
      jsonb_build_object('version', dv.version_no, 'is_final', dv.is_final)
    from public.deliverable_versions dv
    where dv.deliverable_id in (select id from dlv) and dv.is_deleted = false
    union all
    -- (4) download started (issuance) — client sees their own; staff/admin see all
    select dd.downloaded_at, dd.user_id, 'client', 'deliverable.download_started', 'deliverable', dd.deliverable_id, 'client', '{}'::jsonb
    from public.deliverable_downloads dd where dd.project_id = p_project
  )
  select coalesce(jsonb_agg(jrow order by ts desc), '[]'::jsonb) into v from (
    select ts, jsonb_build_object(
      'ts', ts, 'actor', actor_id,
      'actor_name', (select full_name from public.profiles p where p.id = actor_id),
      'role', role, 'event_type', event_type, 'entity_type', entity_type, 'entity_id', entity_id,
      'visibility', visibility, 'meta', meta) as jrow
    from ev
    where (v_scope = 'admin')
       or (v_scope = 'internal' and visibility in ('internal','client'))
       or (v_scope = 'client' and visibility = 'client')
    order by ts desc
    limit least(coalesce(p_limit,200), 500)
  ) x;
  return v;
end $$;

revoke all on function public.project_timeline(uuid,int) from public, anon;
grant execute on function public.project_timeline(uuid,int) to authenticated;

do $v$
begin
  if to_regprocedure('public.project_timeline(uuid,int)') is null then raise exception 'فشل: project_timeline غير موجودة'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
