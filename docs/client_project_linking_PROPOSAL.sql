-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL ONLY — NOT RUN. Admin client→project linking (hotfix/client-project-linking).
--
-- WHY THIS IS A PROPOSAL, NOT A UI CHANGE
-- The browser uses the anon key only (no service role). PostgREST needs BOTH a
-- table GRANT and a passing RLS policy for a write. Today:
--   • public.projects        — RLS "admin all projects" EXISTS, but there is NO
--                              INSERT/UPDATE grant to authenticated (zero-grant
--                              table by design — see phase0_migration.sql:765-767).
--   • public.project_members — RLS "members admin write" EXISTS, granted SELECT
--                              only, NO INSERT/UPDATE/DELETE grant to authenticated.
-- So an admin CANNOT create a project or add a member from the browser. There is
-- also no admin_create_project / admin_add_project_member RPC. Per the hotfix
-- rule, the linking UI is therefore DEFERRED until these RPCs are approved + run.
--
-- ALREADY SUPPORTED TODAY (no SQL needed):
--   • تحويل إلى عميل  — admin_set_account(p_user, p_type=>'client')  [live in AdminAccounts]
--   • فك الربط        — soft_delete('project_members', <member_id>)  [admin path in soft_delete()]
--   • all reads       — adminListProjects / adminListProfiles / adminListClientsByIds /
--                       listMembers (legacy SELECT grants on projects/clients exist;
--                       the live Phase-1 portal already reads them).
--
-- VISIBILITY MODEL (how a linked client sees the project — unchanged, already works):
--   can_access_project(p) = is_admin()
--     OR project_role(p) IS NOT NULL            -- a project_members row for auth.uid()
--     OR projects.client_id = my_client_id()    -- the legacy clients link
--   → We recommend the project_members path as canonical: it keys on the user's
--     auth uid (which we already have as profiles.id), needs no clients row, and
--     RLS (is_client_side / is_client_owner / project_client_user_ids) already
--     honors it for reads, approvals, chat, and notifications.
--
-- Run in the Supabase SQL editor ONLY after owner approval. Mirrors the style of
-- docs/phase1_addendum_s1.sql (SECURITY DEFINER + is_admin() guard + grants).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Create a project for a client ────────────────────────────────────────
-- p_client is the clients.id (legacy link, optional). p_company is companies.id
-- (optional). status defaults to request_received; validated to the 7 live values.
create or replace function public.admin_create_project(
  p_title    text,
  p_client   uuid default null,
  p_company  uuid default null,
  p_status   text default 'request_received',
  p_notes    text default null,         -- "description" (projects has a notes column)
  p_shooting date default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if coalesce(btrim(p_title),'') = '' then raise exception 'project title required'; end if;
  if p_status <> all (array['request_received','pre_production','shooting_scheduled',
                            'shooting_completed','editing','ready_for_review','delivered']) then
    raise exception 'invalid project status: %', p_status;
  end if;
  if p_client is not null and not exists (
        select 1 from public.clients where id = p_client and is_deleted = false) then
    raise exception 'client not found or deleted';
  end if;
  if p_company is not null and not exists (
        select 1 from public.companies where id = p_company and is_deleted = false) then
    raise exception 'company not found or deleted';
  end if;

  insert into public.projects (project_name, status, client_id, company_id, notes, shooting_date)
  values (btrim(p_title), p_status, p_client, p_company, nullif(btrim(coalesce(p_notes,'')),''), p_shooting)
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.admin_create_project(text,uuid,uuid,text,text,date) from public, anon;
grant  execute on function public.admin_create_project(text,uuid,uuid,text,text,date) to authenticated;

-- ─── 2) Link a registered user (lead/client) to a project as owner/member ─────
-- p_user = profiles.id (auth uid). Canonical link via project_members. Idempotent:
-- re-linking an existing active membership just updates the role.
create or replace function public.admin_add_project_member(
  p_project uuid,
  p_user    uuid,
  p_role    text default 'client_owner'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  if p_role <> all (array['client_owner','client_member',
                          'kian_admin','kian_manager','kian_editor',
                          'kian_photographer','kian_viewer']) then
    raise exception 'invalid project role: %', p_role;
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project and p.is_deleted = false) then
    raise exception 'project not found or deleted';
  end if;
  if not exists (select 1 from public.profiles pr where pr.id = p_user) then
    raise exception 'user not found';
  end if;

  -- Reactivate / update an existing membership instead of duplicating it.
  update public.project_members
     set role = p_role, is_deleted = false, deleted_at = null, deleted_by = null
   where project_id = p_project and user_id = p_user
   returning id into v_id;

  if v_id is null then
    insert into public.project_members (project_id, user_id, role, added_by)
    values (p_project, p_user, p_role, auth.uid())
    returning id into v_id;
  end if;
  return v_id;
end; $$;
revoke execute on function public.admin_add_project_member(uuid,uuid,text) from public, anon;
grant  execute on function public.admin_add_project_member(uuid,uuid,text) to authenticated;

-- ─── 3) Unlink — OPTIONAL convenience wrapper ────────────────────────────────
-- Not strictly needed: soft_delete('project_members', <id>) already works for an
-- admin (SECURITY DEFINER, is_admin → predicate 'true', project_members
-- whitelisted). Provided only if a project_id+user_id signature is preferred.
create or replace function public.admin_remove_project_member(
  p_project uuid, p_user uuid
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.is_admin() then raise exception 'admin only'; end if;
  update public.project_members
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid()
   where project_id = p_project and user_id = p_user and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_remove_project_member(uuid,uuid) from public, anon;
grant  execute on function public.admin_remove_project_member(uuid,uuid) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- FRONTEND WIRING (after this addendum is approved + run) — no SQL, for reference:
--   lib/portal/admin.ts:
--     adminCreateProject({title, clientId?, companyId?, status?, notes?, shootingDate?})
--                                          → rpc admin_create_project   → returns project id
--     adminAddProjectMember({projectId, userId, role?})  → rpc admin_add_project_member
--     adminRemoveProjectMember({projectId, userId})      → rpc admin_remove_project_member
--                                          (or softDelete('project_members', memberId))
--   components/portal/AdminAccounts.tsx — add per-account section "ربط العميل بالمشروع":
--     • تحويل إلى عميل      (already works: adminSetAccount{type:'client'})
--     • إنشاء مشروع لهذا العميل   (adminCreateProject → then adminAddProjectMember owner)
--     • ربط بمشروع موجود   (pick from adminListProjects → adminAddProjectMember)
--     • فك الربط           (adminRemoveProjectMember / softDelete)
--     • show linked projects (listMembers per project / filter by user)
--   No RLS weakening, no service-role key — every write stays behind an
--   is_admin()-guarded SECURITY DEFINER RPC, exactly like the existing admin_* set.
-- ════════════════════════════════════════════════════════════════════════
