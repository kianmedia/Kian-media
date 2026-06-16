-- ════════════════════════════════════════════════════════════════════════
-- RUN ME — Kian Opportunities Center (مركز الفرص). Copy the begin;…commit; block
-- into the Supabase SQL Editor and run once. Re-runnable (IF [NOT] EXISTS /
-- CREATE OR REPLACE / drop-then-create policies). Rollback is a SEPARATE commented
-- block at the bottom — it does NOT run on paste.
--
-- SAFETY: public submission goes through a SECURITY DEFINER RPC granted to `anon`
-- (NO anon table grants); reads are limited by RLS to owner/admin/manager/hr only
-- (clients/leads/editor/finance/support/sales/readonly are excluded); every read
-- policy ANDs is_deleted=false + a RESTRICTIVE live-rows policy; all writes go
-- through is_*()-guarded RPCs; no service-role key; no existing object altered.
-- Builds on is_owner()/staff_role()/is_admin() from the staff-roles migrations.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Tables ────────────────────────────────────────────────────────────────
create sequence if not exists public.opportunity_seq;

create table if not exists public.opportunity_requests (
  id               uuid primary key default gen_random_uuid(),
  request_number   text unique,
  opportunity_type text not null check (opportunity_type in (
                     'job_application','training','collaboration','co_production',
                     'freelancer','supplier','media_partnership','talent',
                     'sponsorship','volunteer')),
  full_name        text not null,
  email            text,
  phone            text,
  city             text,
  message          text,
  details          jsonb not null default '{}'::jsonb,   -- type-specific fields
  status           text not null default 'new' check (status in (
                     'new','under_review','shortlisted','contacted',
                     'interview_scheduled','accepted','rejected','archived')),
  priority         text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to      uuid references public.profiles(id),
  consent          boolean not null default false,
  source           text default 'public',
  is_deleted       boolean not null default false,
  deleted_at       timestamptz,
  deleted_by       uuid,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists opportunity_requests_type_idx   on public.opportunity_requests (opportunity_type, created_at desc);
create index if not exists opportunity_requests_status_idx on public.opportunity_requests (status, created_at desc);

create table if not exists public.opportunity_request_notes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.opportunity_requests(id),
  author_id   uuid not null references public.profiles(id),
  body        text not null,
  is_deleted  boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists opportunity_notes_request_idx on public.opportunity_request_notes (request_id, created_at desc);

-- ─── 2) Visibility helper ─────────────────────────────────────────────────────
-- Owner/admin/manager/HR only. Everyone else (client/lead/editor/finance/support/
-- sales/readonly) is excluded.
create or replace function public.can_see_opportunities() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','hr');
$$;

-- ─── 3) RLS (read-only via grants; writes via RPC) ────────────────────────────
alter table public.opportunity_requests       enable row level security;
alter table public.opportunity_request_notes  enable row level security;
grant select on public.opportunity_requests      to authenticated;
grant select on public.opportunity_request_notes to authenticated;
-- (NO insert/update/delete grants, and NO anon grants — public submit is the RPC.)

drop policy if exists "opps read" on public.opportunity_requests;
create policy "opps read" on public.opportunity_requests for select to authenticated
  using (public.can_see_opportunities() and is_deleted = false);
drop policy if exists "opps live rows only" on public.opportunity_requests;
create policy "opps live rows only" on public.opportunity_requests as restrictive for select to authenticated
  using (is_deleted = false or public.is_admin());

drop policy if exists "opp notes read" on public.opportunity_request_notes;
create policy "opp notes read" on public.opportunity_request_notes for select to authenticated
  using (public.can_see_opportunities() and is_deleted = false);
drop policy if exists "opp notes live rows only" on public.opportunity_request_notes;
create policy "opp notes live rows only" on public.opportunity_request_notes as restrictive for select to authenticated
  using (is_deleted = false or public.is_admin());

-- ─── 4) Public submit RPC (anon-callable; validates + inserts + numbers) ───────
create or replace function public.submit_opportunity_request(
  p_type text, p_full_name text, p_email text default null, p_phone text default null,
  p_city text default null, p_message text default null,
  p_details jsonb default '{}'::jsonb, p_consent boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text;
begin
  if p_type <> all (array['job_application','training','collaboration','co_production',
                          'freelancer','supplier','media_partnership','talent',
                          'sponsorship','volunteer']) then
    raise exception 'invalid opportunity type';
  end if;
  if coalesce(trim(p_full_name),'') = '' then raise exception 'full name required'; end if;
  if p_consent is not true then raise exception 'consent required'; end if;

  v_num := 'OPP-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.opportunity_seq')::text, 5, '0');
  insert into public.opportunity_requests
    (request_number, opportunity_type, full_name, email, phone, city, message, details, consent, source)
  values
    (v_num, p_type, trim(p_full_name), nullif(trim(coalesce(p_email,'')),''),
     nullif(trim(coalesce(p_phone,'')),''), nullif(trim(coalesce(p_city,'')),''),
     nullif(trim(coalesce(p_message,'')),''), coalesce(p_details,'{}'::jsonb), true, 'public')
  returning id into v_id;
  return v_num;
end; $$;
revoke execute on function public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean) from public;
grant  execute on function public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean) to anon, authenticated;

-- ─── 5) Admin/HR write RPCs (can_see_opportunities-guarded) ───────────────────
create or replace function public.update_opportunity_status(p_request uuid, p_status text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_see_opportunities() then raise exception 'opportunities staff only'; end if;
  if p_status <> all (array['new','under_review','shortlisted','contacted',
                            'interview_scheduled','accepted','rejected','archived']) then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.opportunity_requests set status = p_status, updated_at = now() where id = p_request;
  get diagnostics v_rows = row_count; return v_rows > 0;
end; $$;
revoke execute on function public.update_opportunity_status(uuid,text) from public, anon;
grant  execute on function public.update_opportunity_status(uuid,text) to authenticated;

create or replace function public.update_opportunity_priority(p_request uuid, p_priority text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_see_opportunities() then raise exception 'opportunities staff only'; end if;
  if p_priority <> all (array['low','normal','high','urgent']) then raise exception 'invalid priority: %', p_priority; end if;
  update public.opportunity_requests set priority = p_priority, updated_at = now() where id = p_request;
  get diagnostics v_rows = row_count; return v_rows > 0;
end; $$;
revoke execute on function public.update_opportunity_priority(uuid,text) from public, anon;
grant  execute on function public.update_opportunity_priority(uuid,text) to authenticated;

-- Assign to an HR/staff member (optional). p_staff must be staff (has staff_role)
-- or an admin; null clears the assignment.
create or replace function public.assign_opportunity(p_request uuid, p_staff uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_see_opportunities() then raise exception 'opportunities staff only'; end if;
  if p_staff is not null and not exists (
       select 1 from public.profiles where id = p_staff and (account_type = 'admin' or staff_role is not null)) then
    raise exception 'assignee must be a staff member';
  end if;
  update public.opportunity_requests set assigned_to = p_staff, updated_at = now() where id = p_request;
  get diagnostics v_rows = row_count; return v_rows > 0;
end; $$;
revoke execute on function public.assign_opportunity(uuid,uuid) from public, anon;
grant  execute on function public.assign_opportunity(uuid,uuid) to authenticated;

create or replace function public.add_opportunity_note(p_request uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.can_see_opportunities() then raise exception 'opportunities staff only'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'note body required'; end if;
  insert into public.opportunity_request_notes (request_id, author_id, body)
  values (p_request, auth.uid(), trim(p_body)) returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.add_opportunity_note(uuid,text) from public, anon;
grant  execute on function public.add_opportunity_note(uuid,text) to authenticated;

create or replace function public.archive_opportunity_request(p_request uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_rows int;
begin
  if not public.can_see_opportunities() then raise exception 'opportunities staff only'; end if;
  update public.opportunity_requests
     set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), updated_at = now()
   where id = p_request and is_deleted = false;
  get diagnostics v_rows = row_count; return v_rows > 0;
end; $$;
revoke execute on function public.archive_opportunity_request(uuid) from public, anon;
grant  execute on function public.archive_opportunity_request(uuid) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ✅ After this runs: the public /opportunities page submits via
--    submit_opportunity_request (anon); owner/admin/manager/hr read & manage via
--    the Opportunities Center at /client-portal/opportunities. Notification emails
--    use the existing Apps Script portal_notify path (events opportunity_new /
--    opportunity_ack — see docs/portal_email_notifications.md).
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — DO NOT RUN unless reverting (kept commented).
-- ────────────────────────────────────────────────────────────────────────
-- begin;
--   drop function if exists public.archive_opportunity_request(uuid);
--   drop function if exists public.add_opportunity_note(uuid,text);
--   drop function if exists public.assign_opportunity(uuid,uuid);
--   drop function if exists public.update_opportunity_priority(uuid,text);
--   drop function if exists public.update_opportunity_status(uuid,text);
--   drop function if exists public.submit_opportunity_request(text,text,text,text,text,text,jsonb,boolean);
--   drop policy if exists "opp notes read" on public.opportunity_request_notes;
--   drop policy if exists "opp notes live rows only" on public.opportunity_request_notes;
--   drop policy if exists "opps read" on public.opportunity_requests;
--   drop policy if exists "opps live rows only" on public.opportunity_requests;
--   drop function if exists public.can_see_opportunities();
--   drop table if exists public.opportunity_request_notes;
--   drop table if exists public.opportunity_requests;
--   drop sequence if exists public.opportunity_seq;
-- commit;
-- ════════════════════════════════════════════════════════════════════════
