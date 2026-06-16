-- ════════════════════════════════════════════════════════════════════════
-- RUN ME — Staff Roles & Task Assignment (صلاحيات الموظفين وتوزيع المهام)
-- Owner-approved execution version. Copy EVERYTHING from `begin;` to `commit;`
-- into the Supabase SQL Editor and run once. Re-runnable (idempotent): columns
-- use IF NOT EXISTS, functions use CREATE OR REPLACE, policies are dropped-if-
-- exists then recreated. Rollback is a SEPARATE commented block at the bottom —
-- it does NOT run when you paste this file.
--
-- SAFETY CONFIRMATIONS (verified against main @ a1ae103 + adversarial review):
--   • Does NOT weaken RLS: every NEW staff SELECT policy ANDs `is_deleted=false`,
--     and section 3b adds RESTRICTIVE "live rows only" policies so soft-deleted
--     rows stay hidden under ALL policies. No existing policy is dropped/altered.
--   • Does NOT use a service-role key: pure DB objects; all writes go through
--     SECURITY DEFINER RPCs; NO table INSERT/UPDATE/DELETE grants to staff.
--   • Protects existing admin/owner access: only ADDS new functions/policies with
--     new names; existing is_admin()/RLS/RPCs are untouched.
--   • contact@kianmedia.com is NOT owner/super_admin: this script grants NO staff
--     roles to anyone and does NOT widen the admin-email allow-list. Owner stays
--     anchored to account_type='admin' = kianalebtikar@gmail.com + manager@kianmedia.com.
--   • HR role is included (staff_role enum) but excluded from all financial/
--     project/deliverable reads here (its scope = the future Opportunities Center).
--   • final_delivered / تم التسليم النهائي is settable ONLY by owner/admin/manager.
--   • editor: assigned projects only; review workflow only; CANNOT see financials
--     or set final_delivered. support/sales/readonly scoped per the helpers below.
--
-- NOT INCLUDED in this run (deferred on purpose — safe to add later):
--   • Section 6 (assigned-editor notification): requires editing the EXISTING
--     trg_review_created() body; left out so we don't risk its current logic.
--   • Section 7 (HR ↔ Opportunities Center RLS/RPCs): the tables don't exist yet.
--   • No app/UI changes — those come after this runs.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Staff role column ─────────────────────────────────────────────────────
-- Separate from account_type (stays lead|client|admin). NULL = not staff.
-- account_type='admin' for the protected emails remains the hard owner anchor.
alter table public.profiles
  add column if not exists staff_role text
  check (staff_role is null or staff_role in
         ('super_admin','manager','support','editor','sales','hr','readonly'));

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

-- Owner = existing admin anchor (account_type='admin' = the two protected emails)
-- OR an explicit super_admin. NO separate email list here (single source of truth
-- = the deployed admin_set_account). contact@kianmedia.com is therefore NOT owner.
create or replace function public.is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.profiles
                 where id = auth.uid() and account_status='active' and staff_role = 'super_admin');
$$;

-- Operational managers: owner OR manager. The set that may set final_delivered.
create or replace function public.can_manage_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager');
$$;
create or replace function public.can_final_deliver() returns boolean
language sql stable security definer set search_path = public as $$
  select public.can_manage_projects();           -- super_admin/admin/manager ONLY
$$;

-- Only the owner may assign staff roles (no self-escalation; enforced in the RPC).
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

-- Who may read financial/sales data (quotes/offers/pricing): owner/manager/sales.
create or replace function public.can_see_financials() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','sales');
$$;

-- Who may read/handle client support comms (messages + file_links): owner/manager/support.
create or replace function public.can_support() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','support');
$$;

-- Broad read-only staff (managers/support/readonly read all projects;
-- editor/sales read only assigned).
create or replace function public.staff_reads_all_projects() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','support','readonly');
$$;

-- ─── 3) Role-scoped READ policies (ADD only; existing client/owner policies stay)
-- SAFETY: each carries `and is_deleted = false` so a new permissive policy can
-- never expose soft-deleted rows (permissive policies are OR'd). drop-if-exists
-- first so this section is safely re-runnable.
drop policy if exists "projects staff read" on public.projects;
create policy "projects staff read" on public.projects for select to authenticated
  using ((public.staff_reads_all_projects() or public.project_role(id) is not null) and is_deleted = false);

drop policy if exists "deliverables staff read" on public.deliverables;
create policy "deliverables staff read" on public.deliverables for select to authenticated
  using ((public.staff_reads_all_projects() or public.project_role(project_id) is not null) and is_deleted = false);

drop policy if exists "reviews staff read" on public.deliverable_reviews;
create policy "reviews staff read" on public.deliverable_reviews for select to authenticated
  using ((public.staff_reads_all_projects()
         or exists (select 1 from public.deliverables d
                    where d.id = deliverable_id and d.is_deleted = false and public.project_role(d.project_id) is not null))
         and is_deleted = false);

drop policy if exists "client_comments staff read" on public.client_comments;
create policy "client_comments staff read" on public.client_comments for select to authenticated
  using ((public.staff_reads_all_projects()
         or exists (select 1 from public.deliverables d
                    where d.id = deliverable_id and d.is_deleted = false and public.project_role(d.project_id) is not null))
         and is_deleted = false);

drop policy if exists "project_messages staff read" on public.project_messages;
create policy "project_messages staff read" on public.project_messages for select to authenticated
  using ((public.staff_reads_all_projects() or public.project_role(project_id) is not null) and is_deleted = false);

-- Support: client support messages + file links.
drop policy if exists "messages support read" on public.messages;
create policy "messages support read" on public.messages for select to authenticated
  using (public.can_support() and is_deleted = false);

drop policy if exists "file_links support read" on public.file_links;
create policy "file_links support read" on public.file_links for select to authenticated
  using ((public.can_support() or public.staff_reads_all_projects()) and is_deleted = false);

-- Sales: leads + quote requests (editor/support/hr/readonly are excluded here).
drop policy if exists "quotes financial read" on public.quote_requests;
create policy "quotes financial read" on public.quote_requests for select to authenticated
  using (public.can_see_financials() and is_deleted = false);

-- ─── 3b) RESTRICTIVE "live rows only" hardening on the touched tables ──────────
-- RESTRICTIVE policies are AND'd with everything, so soft-deleted rows are hidden
-- under ALL policies (admins keep visibility via `or is_admin()`). They never
-- broaden access. Mirrors the existing projects/clients pattern; closes the gap
-- for the tables this addendum exposes to staff.
drop policy if exists "deliverables live rows only" on public.deliverables;
create policy "deliverables live rows only" on public.deliverables as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
drop policy if exists "reviews live rows only" on public.deliverable_reviews;
create policy "reviews live rows only" on public.deliverable_reviews as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
drop policy if exists "client_comments live rows only" on public.client_comments;
create policy "client_comments live rows only" on public.client_comments as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
drop policy if exists "project_messages live rows only" on public.project_messages;
create policy "project_messages live rows only" on public.project_messages as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
drop policy if exists "messages live rows only" on public.messages;
create policy "messages live rows only" on public.messages as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
drop policy if exists "file_links live rows only" on public.file_links;
create policy "file_links live rows only" on public.file_links as restrictive for select to authenticated using (is_deleted = false or public.is_admin());
drop policy if exists "quote_requests live rows only" on public.quote_requests;
create policy "quote_requests live rows only" on public.quote_requests as restrictive for select to authenticated using (is_deleted = false or public.is_admin());

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
  -- Never alter an owner-class account (account_type='admin' anchor = the two
  -- protected emails, plus any explicit super_admin). Matches admin_set_account.
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
-- Add a review deliverable on an ASSIGNED project (editor status: draft|
-- internal_review|client_review only). Owner/manager keep the existing admin_* RPCs.
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

-- Update a review deliverable on an assigned project. HARD BLOCK on
-- final_delivered/archived unless can_final_deliver() (owner/admin/manager).
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

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ✅ DONE. After this runs, the DB enforces the staff-role layer. App/UI wiring
--    is a separate step (no UI changed yet). To assign roles/projects later:
--    select public.admin_set_staff_role('<user-uuid>', 'editor');   -- owner only
--    -- assignment to a project already exists (from the linking addendum):
--    select public.admin_add_project_member('<project-uuid>', '<user-uuid>', 'kian_editor');
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — DO NOT RUN unless you are reverting this change.
-- (Kept fully commented so pasting this file never executes it.)
-- ────────────────────────────────────────────────────────────────────────
-- begin;
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
--   drop function if exists public.staff_reads_all_projects();
--   drop function if exists public.can_support();
--   drop function if exists public.can_see_financials();
--   drop function if exists public.can_edit_project(uuid);
--   drop function if exists public.can_manage_staff();
--   drop function if exists public.can_final_deliver();
--   drop function if exists public.can_manage_projects();
--   drop function if exists public.is_owner();
--   drop function if exists public.is_staff();
--   drop function if exists public.staff_role();
--   alter table public.profiles drop column if exists staff_role;
-- commit;
-- ════════════════════════════════════════════════════════════════════════
