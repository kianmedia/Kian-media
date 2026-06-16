-- ════════════════════════════════════════════════════════════════════════
-- ADDENDUM — NOT RUN. Applicant tracking for the Opportunities Center: a
-- logged-in user whose email matches opportunity_requests.email can see THEIR
-- requests + message Kian. Builds on docs/opportunities_center_RUNME.sql (run).
-- Copy the begin;…commit; block into the Supabase SQL Editor after approval.
-- Re-runnable. Rollback is a SEPARATE commented block at the bottom.
--
-- SECURITY MODEL: applicant READS go through SECURITY DEFINER RPCs that return
-- ONLY applicant-safe columns and are filtered to lower(email)=the caller's email
-- (NO raw-table applicant policy → assigned_to/priority/internal notes are never
-- exposed). Staff (owner/admin/manager/hr) read the message thread via RLS. All
-- writes go through guarded RPCs. No existing object weakened; no RLS loosened.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 1) Caller's email (lowercased) from their profile row.
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from public.profiles where id = auth.uid();
$$;

-- 2) Applicant ⇄ Kian message thread (separate from internal opportunity_request_notes).
create table if not exists public.opportunity_messages (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.opportunity_requests(id),
  sender      text not null check (sender in ('applicant','kian')),
  author_id   uuid references public.profiles(id),
  body        text not null,
  is_deleted  boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists opportunity_messages_request_idx on public.opportunity_messages (request_id, created_at);

alter table public.opportunity_messages enable row level security;
grant select on public.opportunity_messages to authenticated;  -- staff read (below); applicant reads via RPC
-- STAFF read only at the table level (applicants use the safe RPC, never the raw table).
drop policy if exists "opp msgs staff read" on public.opportunity_messages;
create policy "opp msgs staff read" on public.opportunity_messages for select to authenticated
  using (public.can_see_opportunities() and is_deleted = false);
drop policy if exists "opp msgs live rows only" on public.opportunity_messages;
create policy "opp msgs live rows only" on public.opportunity_messages as restrictive for select to authenticated
  using (is_deleted = false or public.is_admin());

-- 3) Ensure the in-portal notification type exists (idempotent superset; identical
--    to docs/opportunities_notifications_addendum_RUNME.sql so order doesn't matter).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new'));

-- 4) Applicant-safe READS (SECURITY DEFINER; email-filtered; safe columns only).
create or replace function public.list_my_opportunity_requests()
returns table (id uuid, request_number text, opportunity_type text, status text, message text, details jsonb, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.request_number, r.opportunity_type, r.status, r.message, r.details, r.created_at
  from public.opportunity_requests r
  where r.is_deleted = false
    and public.my_email() is not null and public.my_email() <> ''
    and lower(r.email) = public.my_email()
  order by r.created_at desc;
$$;
revoke execute on function public.list_my_opportunity_requests() from public, anon;
grant  execute on function public.list_my_opportunity_requests() to authenticated;

-- Messages for ONE of the caller's own requests (no author_id exposed).
create or replace function public.list_my_opportunity_messages(p_request uuid)
returns table (id uuid, sender text, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select m.id, m.sender, m.body, m.created_at
  from public.opportunity_messages m
  join public.opportunity_requests r on r.id = m.request_id
  where m.request_id = p_request and m.is_deleted = false
    and public.my_email() is not null and public.my_email() <> ''
    and lower(r.email) = public.my_email()
  order by m.created_at asc;
$$;
revoke execute on function public.list_my_opportunity_messages(uuid) from public, anon;
grant  execute on function public.list_my_opportunity_messages(uuid) to authenticated;

-- 5) Applicant SENDS a message on their own request → notifies routed staff.
create or replace function public.add_opportunity_message(p_request uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text; v_num text; v_name text; v_ar text; v_en text; r record;
begin
  if coalesce(trim(p_body),'') = '' then raise exception 'message body required'; end if;
  select opportunity_type, request_number, full_name into v_type, v_num, v_name
  from public.opportunity_requests
  where id = p_request and is_deleted = false
    and public.my_email() is not null and lower(email) = public.my_email();
  if v_type is null then raise exception 'request not found for this account'; end if;

  insert into public.opportunity_messages (request_id, sender, author_id, body)
  values (p_request, 'applicant', auth.uid(), trim(p_body)) returning id into v_id;

  v_ar := 'رسالة جديدة من مقدّم طلب — ' || coalesce(v_name,'') || ' (' || coalesce(v_num,'') || ')';
  v_en := 'New message from an applicant — ' || coalesce(v_name,'') || ' (' || coalesce(v_num,'') || ')';
  perform public.notify(null, 'admin', 'opportunity_new', 'opportunity', p_request, v_ar, v_en);  -- owner/admin
  for r in
    select id from public.profiles
    where account_status = 'active' and (
      staff_role = 'super_admin'
      or (staff_role = 'hr'      and v_type in ('job_application','training','freelancer','talent','volunteer'))
      or (staff_role = 'manager' and v_type in ('collaboration','co_production','media_partnership','sponsorship','supplier'))
    )
  loop
    perform public.notify(r.id, 'user', 'opportunity_new', 'opportunity', p_request, v_ar, v_en);
  end loop;
  return v_id;
end; $$;
revoke execute on function public.add_opportunity_message(uuid,text) from public, anon;
grant  execute on function public.add_opportunity_message(uuid,text) to authenticated;

-- 6) Staff (owner/admin/manager/hr) posts a PUBLIC reply → notifies the applicant
--    in-portal if they have an account with the matching email.
create or replace function public.add_opportunity_reply(p_request uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text; v_email text; v_uid uuid;
begin
  if not public.can_see_opportunities() then raise exception 'opportunities staff only'; end if;
  if coalesce(trim(p_body),'') = '' then raise exception 'reply body required'; end if;
  select request_number, lower(email) into v_num, v_email
  from public.opportunity_requests where id = p_request and is_deleted = false;
  if v_num is null and v_email is null then raise exception 'request not found'; end if;

  insert into public.opportunity_messages (request_id, sender, author_id, body)
  values (p_request, 'kian', auth.uid(), trim(p_body)) returning id into v_id;

  if v_email is not null then
    select id into v_uid from public.profiles where lower(email) = v_email limit 1;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'opportunity_new', 'opportunity', p_request,
        'رد من فريق كيان على طلبك (' || coalesce(v_num,'') || ')',
        'Kian replied to your request (' || coalesce(v_num,'') || ')');
    end if;
  end if;
  return v_id;
end; $$;
revoke execute on function public.add_opportunity_reply(uuid,text) from public, anon;
grant  execute on function public.add_opportunity_reply(uuid,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ✅ After this runs: a logged-in user whose email matches gets a "طلباتي" tab
--    (the app queries list_my_opportunity_requests on load). They see their own
--    requests + status timeline + the Kian message thread, and can send messages
--    (add_opportunity_message). Staff see the thread + reply (add_opportunity_reply)
--    in the Opportunities Center detail panel. Internal notes stay staff-only.
-- ════════════════════════════════════════════════════════════════════════


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — DO NOT RUN unless reverting (kept commented).
-- ────────────────────────────────────────────────────────────────────────
-- begin;
--   drop function if exists public.add_opportunity_reply(uuid,text);
--   drop function if exists public.add_opportunity_message(uuid,text);
--   drop function if exists public.list_my_opportunity_messages(uuid);
--   drop function if exists public.list_my_opportunity_requests();
--   drop policy if exists "opp msgs staff read" on public.opportunity_messages;
--   drop policy if exists "opp msgs live rows only" on public.opportunity_messages;
--   drop table if exists public.opportunity_messages;
--   drop function if exists public.my_email();
--   -- (leave notifications_type_check as the 9 + opportunity_new superset.)
-- commit;
-- ════════════════════════════════════════════════════════════════════════
