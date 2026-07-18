-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — CUSTODY ⇄ PROFESSION BRIDGE + ACCESS DIAGNOSTIC (RUN ONCE) [P0-1/2]
--
-- ROOT CAUSE of "secondary professions grant no module access" and "Custody Manager
-- upload fails": the custody module's single authorization gate civ_can_manage()
-- checks staff_role only:
--     is_owner() OR staff_role() IN ('manager','custody_officer')
-- It never consulted the professions system, so a "Custody Manager" PROFESSION
-- (employee_professions → perm_manage_custody) was rejected by every custody RPC AND
-- by the Storage policies "civ assets bucket upload"/"read" (both call civ_can_manage).
--
-- Fix (one function, propagates everywhere): civ_can_manage() now ALSO returns true
-- for a user holding an active profession with perm_manage_custody (emp_can, which is
-- the UNION of ALL active professions — never the primary only). This fixes custody
-- module access AND asset-image upload in one place. Backfills perm_manage_custody
-- for the custody profession(s) so it takes effect immediately.
--
-- Also adds emp_effective_access() — a server diagnostic proving, for any user, the
-- system role + active profession ids/keys + the UNION of capabilities + custody
-- permissions. Idempotent. Grants no new powers beyond what a profession already
-- carries; never grants Owner/Admin.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.civ_can_manage()') is null then miss := miss || ' civ_can_manage() (شغّل portal_custody_inventory_system_v1_RUNME.sql)'; end if;
  if to_regprocedure('public.emp_can(text,uuid)') is null then miss := miss || ' emp_can (شغّل employee_professions_RUNME.sql)'; end if;
  if to_regclass('public.professions') is null then miss := miss || ' professions'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- Bridge: the custody-management gate now honors the manage_custody profession
-- capability (UNION of all active professions), in addition to the legacy roles.
create or replace function public.civ_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner()
      or public.staff_role() in ('manager','custody_officer')
      or public.emp_can('manage_custody');
$$;
revoke execute on function public.civ_can_manage() from public, anon;
grant  execute on function public.civ_can_manage() to authenticated;

-- Make the bridge effective: the custody profession(s) must carry perm_manage_custody.
update public.professions set perm_manage_custody = true
 where perm_manage_custody = false
   and (key ilike '%custody%' or key = 'custody_officer'
        or name_en ilike '%custody%' or name_ar like '%عهد%');

-- Server-side effective-access diagnostic (admin/manager may inspect any user; a user
-- may inspect themselves). Proves the UNION, not just the UI summary.
create or replace function public.emp_effective_access(p_user uuid default auth.uid())
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare uid uuid := coalesce(p_user, auth.uid()); v jsonb;
begin
  if uid is null then raise exception 'not authorized'; end if;
  if uid <> auth.uid() and not (public.is_admin() or public.can_manage_projects()) then
    raise exception 'not authorized';
  end if;
  select jsonb_build_object(
    'user_id', uid,
    'system_role', (select staff_role from public.profiles where id = uid),
    'account_type', (select account_type from public.profiles where id = uid),
    'active_profession_ids', to_jsonb(public.emp_profession_ids(uid)),
    'active_profession_keys', coalesce((
       select jsonb_agg(pr.key order by pr.key)
       from public.employee_professions ep join public.professions pr on pr.id = ep.profession_id
       where ep.profile_id = uid and pr.is_active), '[]'::jsonb),
    'capabilities', jsonb_build_object(
       'view_all_tasks',       public.emp_can('view_all_tasks', uid),
       'manage_preproduction', public.emp_can('manage_preproduction', uid),
       'manage_shoots',        public.emp_can('manage_shoots', uid),
       'manage_custody',       public.emp_can('manage_custody', uid)),
    -- Custody module resolution for THIS caller (civ_can_manage/delete run as auth.uid()):
    'custody', case when uid = auth.uid() then jsonb_build_object(
       'can_manage', public.civ_can_manage(),
       'can_delete_asset', (to_regprocedure('public.civ_can_delete_asset()') is not null and public.civ_can_delete_asset()))
      else null end,
    'note', 'capabilities = UNION of all active professions; primary is display-only; no profession grants Owner/Admin'
  ) into v;
  return v;
end $$;
revoke all on function public.emp_effective_access(uuid) from public, anon;
grant execute on function public.emp_effective_access(uuid) to authenticated;

do $v$
begin
  if to_regprocedure('public.emp_effective_access(uuid)') is null then raise exception 'فشل: emp_effective_access'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
