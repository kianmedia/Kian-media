-- ════════════════════════════════════════════════════════════════════════
-- PROPOSAL — NOT RUN. Staff assignment notes + finance role + invoice visibility.
-- Builds on docs/staff_roles_task_assignment_RUNME.sql (already run). Copy the
-- `begin;`…`commit;` block into the Supabase SQL Editor after approval. Re-runnable
-- (IF [NOT] EXISTS / CREATE OR REPLACE / drop-then-create policies). Rollback is a
-- SEPARATE commented block at the bottom (never runs on paste).
--
-- SAFETY: does NOT weaken RLS (every new read policy ANDs is_deleted=false + a
-- RESTRICTIVE live-rows policy); no service-role key; no table INSERT/UPDATE/DELETE
-- grants to anyone (all writes go through SECURITY DEFINER RPCs / server-side Zoho
-- sync); existing owner/admin access untouched; finance is added to the role
-- enum/allow-list (no other role changed). Invoices are written server-side only.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Finance role ──────────────────────────────────────────────────────────
-- Extend the staff_role CHECK (re-create the auto-named constraint) + the
-- admin_set_staff_role allow-list to accept 'finance'. No other role changes.
alter table public.profiles drop constraint if exists profiles_staff_role_check;
alter table public.profiles add constraint profiles_staff_role_check
  check (staff_role is null or staff_role in
         ('super_admin','manager','support','editor','sales','hr','readonly','finance'));

create or replace function public.admin_set_staff_role(p_user uuid, p_role text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_manage_staff() then raise exception 'owner only'; end if;
  if p_user = auth.uid() then raise exception 'cannot change your own staff role'; end if;
  if p_role is not null and p_role <> all (array[
       'super_admin','manager','support','editor','sales','hr','readonly','finance']) then
    raise exception 'invalid staff role: %', p_role;
  end if;
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

-- ─── 2) Invoice-visibility helper ─────────────────────────────────────────────
-- Owner/admin/manager/finance may read invoices (the related client sees only
-- their own via the invoices RLS below).
create or replace function public.can_see_invoices() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','finance');
$$;

-- ─── 3) Assignment notes (admin/manager → assigned staff; never clients) ──────
create table if not exists public.assignment_notes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id),
  staff_user_id uuid not null references public.profiles(id),
  author_id     uuid not null references public.profiles(id),
  body          text not null,
  is_deleted    boolean not null default false,
  deleted_at    timestamptz,
  deleted_by    uuid,
  created_at    timestamptz not null default now()
);
create index if not exists assignment_notes_project_idx on public.assignment_notes (project_id);
create index if not exists assignment_notes_staff_idx   on public.assignment_notes (staff_user_id, created_at desc);

alter table public.assignment_notes enable row level security;
grant select on public.assignment_notes to authenticated;  -- read only; writes via RPC

-- Read: owner/admin/managers see all; assigned staff see their OWN notes; clients
-- never. is_deleted guard + RESTRICTIVE live-rows (defense in depth).
drop policy if exists "assignment_notes read" on public.assignment_notes;
create policy "assignment_notes read" on public.assignment_notes for select to authenticated
  using ((public.can_manage_projects() or staff_user_id = auth.uid()) and is_deleted = false);
drop policy if exists "assignment_notes live rows only" on public.assignment_notes;
create policy "assignment_notes live rows only" on public.assignment_notes as restrictive for select to authenticated
  using (is_deleted = false or public.is_admin());

-- RPC: add an assignment note (owner/admin/manager) + notify the staff in-portal.
create or replace function public.add_assignment_note(p_project uuid, p_staff uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_manage_projects() then raise exception 'managers/owner only'; end if;
  if coalesce(btrim(p_body),'') = '' then raise exception 'note body required'; end if;
  if not exists (select 1 from public.project_members pm
                 where pm.project_id = p_project and pm.user_id = p_staff and pm.is_deleted = false) then
    raise exception 'staff is not assigned to this project';
  end if;
  insert into public.assignment_notes (project_id, staff_user_id, author_id, body)
  values (p_project, p_staff, auth.uid(), btrim(p_body))
  returning id into v_id;
  perform public.notify(p_staff, 'user', 'project_note_new', 'project', p_project,
                        'ملاحظة جديدة على تكليفك', 'New note on your assignment');
  return v_id;
end; $$;
revoke execute on function public.add_assignment_note(uuid,uuid,text) from public, anon;
grant  execute on function public.add_assignment_note(uuid,uuid,text) to authenticated;

-- Soft-delete an assignment note (owner/manager). soft_delete() already covers
-- admins; add assignment_notes to its whitelist too (optional — see note).
create or replace function public.remove_assignment_note(p_note uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_manage_projects() then raise exception 'managers/owner only'; end if;
  update public.assignment_notes
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid()
   where id = p_note and is_deleted = false;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end; $$;
revoke execute on function public.remove_assignment_note(uuid) from public, anon;
grant  execute on function public.remove_assignment_note(uuid) to authenticated;

-- ─── 4) Invoices (placeholder; populated server-side by the Zoho sync) ─────────
-- Visible to owner/admin/manager/finance, and to the related client (own only).
-- NO write grants: rows are inserted/updated by the server-side Zoho integration
-- (see docs/zoho_books_portal_integration_PROPOSAL.md), never from the browser.
create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid references public.clients(id),
  user_id         uuid references public.profiles(id),
  project_id      uuid references public.projects(id),
  zoho_invoice_id  text,
  zoho_estimate_id text,
  number          text,
  status          text,                 -- e.g. draft|sent|paid|overdue|void (Zoho-mirrored)
  amount          numeric,
  currency        text default 'SAR',
  url             text,                  -- Zoho hosted invoice/estimate link
  issued_at       date,
  is_deleted      boolean not null default false,
  deleted_at      timestamptz,
  deleted_by      uuid,
  created_at      timestamptz not null default now()
);
create index if not exists invoices_client_idx on public.invoices (client_id);
create index if not exists invoices_user_idx   on public.invoices (user_id);

alter table public.invoices enable row level security;
grant select on public.invoices to authenticated;  -- read only

drop policy if exists "invoices read" on public.invoices;
create policy "invoices read" on public.invoices for select to authenticated
  using ((public.can_see_invoices() or user_id = auth.uid() or client_id = public.my_client_id())
         and is_deleted = false);
drop policy if exists "invoices live rows only" on public.invoices;
create policy "invoices live rows only" on public.invoices as restrictive for select to authenticated
  using (is_deleted = false or public.is_admin());

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ✅ After this runs:
--   • finance becomes a selectable staff role (add "finance" to STAFF_ROLE_OPTIONS
--     in lib/portal/roles.ts to surface it in the dropdown).
--   • assignment notes work: add_assignment_note(project, staff, body); staff read
--     their own via the assignment_notes RLS (frontend: pget assignment_notes?...).
--   • invoices table + RLS exist, ready for the server-side Zoho sync.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — DO NOT RUN unless reverting (kept commented).
-- ────────────────────────────────────────────────────────────────────────
-- begin;
--   drop policy if exists "invoices read" on public.invoices;
--   drop policy if exists "invoices live rows only" on public.invoices;
--   drop table if exists public.invoices;
--   drop function if exists public.remove_assignment_note(uuid);
--   drop function if exists public.add_assignment_note(uuid,uuid,text);
--   drop policy if exists "assignment_notes read" on public.assignment_notes;
--   drop policy if exists "assignment_notes live rows only" on public.assignment_notes;
--   drop table if exists public.assignment_notes;
--   drop function if exists public.can_see_invoices();
--   -- revert the staff_role enum + admin_set_staff_role to the 7-role set:
--   alter table public.profiles drop constraint if exists profiles_staff_role_check;
--   alter table public.profiles add constraint profiles_staff_role_check
--     check (staff_role is null or staff_role in
--            ('super_admin','manager','support','editor','sales','hr','readonly'));
--   -- (re-create admin_set_staff_role with the 7-role array — see RUNME.)
-- commit;
-- ════════════════════════════════════════════════════════════════════════
