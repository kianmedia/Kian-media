-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — log_activity ROLE HARDENING (RUN ONCE)  [P0-7 root-cause fix]
--
-- activity_log.actor_role has a CHECK limiting it to a fixed vocabulary
-- ('user','lead','client','client_owner','client_member','kian_admin',
--  'kian_manager','kian_editor','kian_photographer','kian_viewer','admin','system').
-- Several SECURITY DEFINER RPCs audit with public.staff_role() as the actor role,
-- whose values ('super_admin','manager','editor','finance','photographer',…) are
-- NOT in that vocabulary. The CHECK violation aborts the whole RPC transaction, so
-- e.g. admin_upsert_profession / admin_set_employee_professions / emp_update_task_status
-- silently roll back — the confirmed "professions don't save" defect.
--
-- Fix (single point, covers every caller): make log_activity defensive —
--   1) map an out-of-vocabulary role to NULL (allowed by the CHECK), and
--   2) swallow any logging error, because AUDIT LOGGING MUST NEVER BREAK the
--      operation it records.
-- Idempotent (CREATE OR REPLACE), behaviour-preserving for valid roles.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
begin
  if to_regclass('public.activity_log') is null then
    raise exception 'نقص في الاعتمادات: activity_log';
  end if;
end $pf$;

begin;

create or replace function public.log_activity(
  p_actor uuid, p_role text, p_action text, p_etype text, p_eid uuid, p_meta jsonb default '{}')
returns void language plpgsql security definer set search_path = public as $$
declare v_role text;
begin
  -- Only the CHECK-approved vocabulary is stored; anything else (staff_role
  -- values, nulls, typos) becomes NULL so the insert can never violate the CHECK.
  v_role := case
    when p_role in ('user','lead','client','client_owner','client_member',
                    'kian_admin','kian_manager','kian_editor','kian_photographer',
                    'kian_viewer','admin','system')
    then p_role else null end;
  insert into public.activity_log (actor_id, actor_role, action, entity_type, entity_id, metadata)
  values (p_actor, v_role, p_action, p_etype, p_eid, coalesce(p_meta, '{}'));
exception when others then
  -- never propagate an audit-logging failure to the caller
  null;
end $$;

revoke all on function public.log_activity(uuid,text,text,text,uuid,jsonb) from public, anon;
grant execute on function public.log_activity(uuid,text,text,text,uuid,jsonb) to authenticated;

do $v$
begin
  if to_regprocedure('public.log_activity(uuid,text,text,text,uuid,jsonb)') is null then
    raise exception 'فشل: log_activity'; end if;
  -- prove a staff_role value that previously aborted now logs without error
  perform public.log_activity(null, 'super_admin', 'selftest.role_hardening', 'system', null, '{}'::jsonb);
end $v$;

notify pgrst, 'reload schema';
commit;
