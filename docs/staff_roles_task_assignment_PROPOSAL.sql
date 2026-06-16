-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL ONLY — NOT RUN. Staff Roles & Task Assignment
-- (صلاحيات الموظفين وتوزيع المهام) — feature/staff-roles-task-assignment.
--
-- WHY THIS IS A PROPOSAL (and the UI is NOT built yet)
-- The rule for this phase: every permission MUST be enforced by DB/RLS/RPC, never
-- UI-only. The current DB cannot enforce staff roles, so per Step 2 we stop at a
-- proposal. Verified against docs/phase0_migration.sql + docs/phase1_addendum_s1.sql
-- + docs/client_project_linking_PROPOSAL.sql (run) on main @ a1ae103:
--   • profiles has NO staff_role. account_type is CHECK-locked to
--     ('lead','client','admin') — you cannot even store 'editor'/'support'/'hr'.
--   • is_admin() = (account_type='admin' AND account_status='active'). No notion
--     of manager/support/editor/sales/hr/readonly.
--   • Sensitive tables (quote_requests, offers, messages, file_links) are
--     is_admin()-or-owner gated → no role-scoped staff access exists.
--   • Deliverable writes (admin_add_deliverable / admin_set_deliverable) are
--     is_admin()-only → an editor cannot add preview links or move review status.
--   • trg_review_created notifies admins only (recipient_role='admin') → assigned
--     editors are not notified on client approve/revision.
-- ALREADY SUPPORTED (reused, no change): project_members carries the kian_* roles
--   and admin_add_project_member()/admin_remove_project_member() (run via the
--   linking addendum) already let an admin ASSIGN/UNASSIGN staff to a project.
--   is_kian_member(p) already grants assigned-project READ at the RLS layer.
--
-- Run in the Supabase SQL editor ONLY after owner approval. Mirrors the existing
-- style: SECURITY DEFINER + role guards + revoke/grant; no service-role key; no
-- table INSERT/UPDATE grants to staff (all writes go through RPCs).
-- Supersedes/operationalizes docs/staff_roles_permissions_PROPOSAL.md.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Staff role column ─────────────────────────────────────────────────────
-- Separate from account_type (which stays lead|client|admin). NULL = not staff.
-- account_type='admin' for the protected emails remains the hard owner anchor.
alter table public.profiles
  add column if not exists staff_role text
  check (staff_role is null or staff_role in
         ('super_admin','manager','support','editor','sales','hr','readonly'));
-- NOTE: 'admin' as a staff tier maps to account_type='admin' (the two/three
-- protected emails). 'super_admin' is the owner. managers/support/editor/sales/
-- hr/readonly are non-admin staff identified solely by staff_role.

-- ─── 2) Role helper functions (security definer, stable) ──────────────────────
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = public as $$
  select staff_role from public.profiles
   where id = auth.uid() and account_status = 'active';
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.staff_role() is not null;
$$;

-- Owner = the existing admin anchor (account_type='admin' = the protected
-- emails, per the already-deployed admin_set_account) OR an explicit super_admin.
-- We do NOT introduce a separate email allow-list here: that would diverge from
-- admin_set_account's protected list and could grant owner powers to an account
-- that is not actually account_type='admin'. To make contact@kianmedia.com an
-- owner, either grant it staff_role='super_admin' via admin_set_staff_role, OR
-- widen admin_set_account's admin-email allow-list to include it (see note below).
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.profiles
                 where id = auth.uid() and account_status='active' and staff_role = 'super_admin');
$$;
-- NOTE (contact@kianmedia.com): only if it should be an account_type='admin'
-- owner, widen the admin-email allow-list in phase1_addendum_s1.sql
-- admin_set_account from ('kianalebtikar@gmail.com','manager@kianmedia.com') to
-- also include 'contact@kianmedia.com'. Otherwise leave it as the deployed two.

-- Operational managers: owner OR manager. This is the set that may set final_delivered.
create or replace function public.can_manage_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager');
$$;
create or replace function public.can_final_deliver() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_projects();           -- super_admin/admin/manager ONLY
$$;

-- Only the owner may assign staff roles (no self-escalation; see RPC below).
create or replace function public.can_manage_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner();
$$;

-- Editor may act ONLY on projects where they hold a kian_editor membership.
create or replace function public.can_edit_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_projects()
      or (public.staff_role() = 'editor' and public.project_role(p_project) = 'kian_editor');
$$;

-- Who may read financial/sales data (quotes/offers/pricing).
create or replace function public.can_see_financials() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','sales');
$$;

-- Who may read/handle client support comms (messages + file_links).
create or replace function public.can_support() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','support');
$$;

-- Broad read-only staff (managers/support/readonly see all projects;
-- editor/sales see only assigned). Used by the widened project read policies.
create or replace function public.staff_reads_all_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','support','readonly');
$$;

-- ─── 3) RLS additions (ADD policies; do NOT loosen existing client/owner ones) ─
-- CRITICAL: PostgreSQL permissive policies are OR'd, so every new staff SELECT
-- policy MUST itself carry `and is_deleted = false` (admins keep full visibility
-- through the existing admin-all policies). Without this guard a staff role could
-- read soft-deleted rows that the existing client/owner policies hide — i.e. it
-- would WEAKEN existing RLS. See section 3b for the recommended belt-and-suspenders
-- RESTRICTIVE hardening that makes this automatic for these tables.
--
-- Projects: assigned staff (any kian_* membership) already pass is_kian_member;
-- managers/support/readonly additionally read all. Editors/sales: assigned only.
-- (projects already has a RESTRICTIVE "live rows only" policy, but we still guard.)
create policy "projects staff read" on public.projects for select to authenticated
  using ((public.staff_reads_all_projects() or public.project_role(id) is not null) and is_deleted = false);

-- Deliverables / reviews / client_comments / project_messages: staff read scoped
-- to projects they can access (assigned or all-reading staff).
create policy "deliverables staff read" on public.deliverables for select to authenticated
  using ((public.staff_reads_all_projects() or public.project_role(project_id) is not null) and is_deleted = false);
create policy "reviews staff read" on public.deliverable_reviews for select to authenticated
  using ((public.staff_reads_all_projects()
         or exists (select 1 from public.deliverables d
                    where d.id = deliverable_id and d.is_deleted = false and public.project_role(d.project_id) is not null))
         and is_deleted = false);
create policy "client_comments staff read" on public.client_comments for select to authenticated
  using ((public.staff_reads_all_projects()
         or exists (select 1 from public.deliverables d
                    where d.id = deliverable_id and d.is_deleted = false and public.project_role(d.project_id) is not null))
         and is_deleted = false);
create policy "project_messages staff read" on public.project_messages for select to authenticated
  using ((public.staff_reads_all_projects() or public.project_role(project_id) is not null) and is_deleted = false);

-- Support: messages + file_links. (Existing admin/own policies stay; ADD support.)
create policy "messages support read" on public.messages for select to authenticated
  using (public.can_support() and is_deleted = false);
create policy "file_links support read" on public.file_links for select to authenticated
  using ((public.can_support() or public.staff_reads_all_projects()) and is_deleted = false);

-- Sales: leads + quotes. (Existing admin-only policy stays; ADD financial-readers.)
create policy "quotes financial read" on public.quote_requests for select to authenticated
  using (public.can_see_financials() and is_deleted = false);

-- ─── 3b) RECOMMENDED hardening: RESTRICTIVE "live rows only" on the touched
-- tables, so soft-deleted rows are hidden under ALL policies (mirrors the
-- existing projects/clients pattern). RESTRICTIVE policies are AND'd, so they
-- never broaden access; admins keep visibility via `or is_admin()`. Phase 0 only
-- added these to projects/clients — adding them here closes the systemic gap for
-- the tables this addendum exposes to staff.
create policy "deliverables live rows only"   on public.deliverables       as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
create policy "reviews live rows only"        on public.deliverable_reviews as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
create policy "client_comments live rows only" on public.client_comments   as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
create policy "project_messages live rows only" on public.project_messages as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
create policy "messages live rows only"       on public.messages          as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
create policy "file_links live rows only"     on public.file_links        as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
create policy "quote_requests live rows only" on public.quote_requests    as restrictive for select to authenticated using (is_deleted = false or public.is_admin());

-- IMPORTANT: editor/support/hr/readonly are deliberately EXCLUDED from
-- quote_requests/offers/financial reads (can_see_financials() is false for them).
-- HR sees NONE of projects/quotes/offers/deliverables here — HR scope is the
-- Opportunities Center tables (section 7), gated separately when that ships.
-- No new INSERT/UPDATE/DELETE grants to staff anywhere — writes go via RPC only.

-- ─── 4) RPC: assign a staff role (owner-only, no self-escalation) ─────────────
create or replace function public.admin_set_staff_role(p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_manage_staff() then raise exception 'owner only'; end if;
  if p_user = auth.uid() then raise exception 'cannot change your own staff role'; end if;
  if p_role is not null and p_role <> all (array[
       'super_admin','manager','support','editor','sales','hr','readonly']) then
    raise exception 'invalid staff role: %', p_role;
  end if;
  -- Never alter an owner-class account via this RPC (the account_type='admin'
  -- anchor = the protected emails, plus any explicit super_admin). This matches
  -- the deployed admin_set_account anchor — no divergent email list.
  if exists (select 1 from public.profiles where id = p_user
             and (account_type = 'admin' or staff_role = 'super_admin')) then
    raise exception 'protected owner account';
  end if;
  update public.profiles set staff_role = p_role where id = p_user;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.admin_set_staff_role(uuid,text) from public, anon;
grant  execute on function public.admin_set_staff_role(uuid,text) to authenticated;

-- ─── 5) Editor-safe deliverable RPCs (review workflow only, NEVER final) ──────
-- Add a review deliverable on an ASSIGNED project. Editors may set status only
-- up to client_review; approved/revision_requested are client-driven; final is
-- impossible here. Managers/owner may use the existing admin_* RPCs as today.
create or replace function public.staff_add_deliverable(
  p_project uuid, p_title text, p_type text default 'video',
  p_preview_url text default null, p_vimeo_url text default null,
  p_status text default 'client_review')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_ver int;
begin
  if not public.can_edit_project(p_project) then raise exception 'not assigned to this project'; end if;
  if p_status <> all (array['draft','internal_review','client_review']) then
    raise exception 'editor may set only draft|internal_review|client_review';
  end if;
  select coalesce(max(version),0)+1 into v_ver from public.deliverables where project_id = p_project;
  insert into public.deliverables (project_id, title, type, version, preview_url, vimeo_review_url, status)
  values (p_project, p_title, coalesce(p_type,'video'), v_ver, p_preview_url, p_vimeo_url, coalesce(p_status,'client_review'))
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.staff_add_deliverable(uuid,text,text,text,text,text) from public, anon;
grant  execute on function public.staff_add_deliverable(uuid,text,text,text,text,text) to authenticated;

-- Update a review deliverable on an assigned project. HARD BLOCK on final_delivered
-- (and archived) unless can_final_deliver(); editors are restricted to the review set.
create or replace function public.staff_set_deliverable(
  p_dlv uuid, p_status text default null,
  p_preview_url text default null, p_vimeo_url text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_proj uuid; v_rows int;
begin
  select project_id into v_proj from public.deliverables where id = p_dlv and is_deleted = false;
  if v_proj is null then raise exception 'deliverable not found'; end if;
  if not public.can_edit_project(v_proj) then raise exception 'not assigned to this project'; end if;
  if p_status is not null then
    if p_status in ('final_delivered','archived') and not public.can_final_deliver() then
      raise exception 'final_delivered/archived requires super_admin/admin/manager';
    end if;
    if not public.can_final_deliver()
       and p_status <> all (array['draft','internal_review','client_review','revision_requested','approved']) then
      raise exception 'editor may not set status %', p_status;
    end if;
  end if;
  update public.deliverables
     set status           = coalesce(p_status, status),
         preview_url      = coalesce(p_preview_url, preview_url),
         vimeo_review_url = coalesce(p_vimeo_url, vimeo_review_url)
   where id = p_dlv and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.staff_set_deliverable(uuid,text,text,text) from public, anon;
grant  execute on function public.staff_set_deliverable(uuid,text,text,text) to authenticated;

-- FINAL-DELIVERY RULE (restated, enforced above): final_delivered is reachable
-- ONLY through admin_set_deliverable (is_admin) or staff_set_deliverable guarded
-- by can_final_deliver() = super_admin/admin/manager. Editors: never.

-- ─── 6) Assigned-editor email on client review (extend the existing trigger) ──
-- Replace trg_review_created so that, in addition to the existing admin
-- notification, each kian_editor assigned to the project gets an in-portal
-- notification. (Email itself goes through the existing Apps Script portal_notify
-- path from the browser — see the app-side plan below; this trigger covers the
-- in-portal bell + gives the editor user_ids to email.)
-- create or replace function public.trg_review_created() ... (same body as today)
--   + after the admin notify():
--   for r in select pm.user_id from public.project_members pm
--            join public.deliverables d on d.id = new.deliverable_id
--            where pm.project_id = d.project_id and pm.role = 'kian_editor'
--              and pm.is_deleted = false loop
--     perform public.notify(r.user_id, 'user',
--             case when new.decision='revision_requested' then 'revision_requested'
--                  else 'deliverable_approved' end,
--             'deliverable', new.deliverable_id,
--             'تحديث مراجعة من العميل', 'Client review update on your project');
--   end loop;

-- ─── 7) FUTURE: HR / Opportunities Center integration (not built now) ─────────
-- When Opportunities Center ships, its request tables (e.g. opportunity_requests
-- with type in job_application|training|freelancer|cooperation) get RLS:
--   create policy "hr reads hr requests" on public.opportunity_requests
--     for select to authenticated using (public.is_owner() or public.staff_role()='hr');
-- + RPCs hr_set_request_status() / hr_add_note() gated on staff_role()='hr'.
-- HR sees ONLY those tables — never projects/quotes/offers/deliverables/financials
-- (the helpers above already exclude hr from all of them).

commit;

-- ════════════════════════════════════════════════════════════════════════
-- APP-SIDE PLAN (after this addendum is approved + run) — no SQL, for reference:
--   lib/portal/admin.ts: adminSetStaffRole({userId, role}); staffAddDeliverable(...);
--     staffSetDeliverable(...); (assignment already exists: adminAddProjectMember
--     with role kian_manager|kian_editor|kian_support|kian_sales|kian_viewer,
--     adminRemoveProjectMember).
--   nav.ts / PortalShell: role-aware routing — super_admin/admin/manager → full
--     admin area; editor → simplified "assigned projects" view (no quotes/offers/
--     accounts/settings, deliverable controls WITHOUT final_delivered); support →
--     messages+files; sales → leads/quotes; hr → Opportunities (when built);
--     readonly → view-only. Every hidden control is ALSO blocked at the RPC/RLS
--     layer above (UI hiding is cosmetic only).
--   Staff page: list profiles with staff_role, change role (adminSetStaffRole),
--     assign/unassign to projects; project detail shows assigned staff; staff
--     detail shows assigned projects.
--   Editor email: on client approve/revision, emit portal_notify (Apps Script)
--     to the assigned editor — resolve the editor email server-side in Apps
--     Script (never expose staff emails in client code), event editor_review_update
--     with project name, deliverable title, action, exact note, portal link.
--
-- ROLLBACK (if needed):
--   drop function if exists public.staff_set_deliverable(uuid,text,text,text);
--   drop function if exists public.staff_add_deliverable(uuid,text,text,text,text,text);
--   drop function if exists public.admin_set_staff_role(uuid,text);
--   drop policy if exists "projects staff read" on public.projects;
--   drop policy if exists "deliverables staff read" on public.deliverables;
--   drop policy if exists "reviews staff read" on public.deliverable_reviews;
--   drop policy if exists "client_comments staff read" on public.client_comments;
--   drop policy if exists "project_messages staff read" on public.project_messages;
--   drop policy if exists "messages support read" on public.messages;
--   drop policy if exists "file_links support read" on public.file_links;
--   drop policy if exists "quotes financial read" on public.quote_requests;
--   drop policy if exists "deliverables live rows only" on public.deliverables;
--   drop policy if exists "reviews live rows only" on public.deliverable_reviews;
--   drop policy if exists "client_comments live rows only" on public.client_comments;
--   drop policy if exists "project_messages live rows only" on public.project_messages;
--   drop policy if exists "messages live rows only" on public.messages;
--   drop policy if exists "file_links live rows only" on public.file_links;
--   drop policy if exists "quote_requests live rows only" on public.quote_requests;
--   drop function if exists public.can_edit_project(uuid), public.can_final_deliver(),
--        public.can_manage_projects(), public.can_manage_staff(), public.can_support(),
--        public.can_see_financials(), public.staff_reads_all_projects(),
--        public.is_owner(), public.is_staff(), public.staff_role();
--   -- restore trg_review_created() to its original body;
--   alter table public.profiles drop column if exists staff_role;
-- ════════════════════════════════════════════════════════════════════════
