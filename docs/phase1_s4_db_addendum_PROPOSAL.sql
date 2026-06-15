-- ═══════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — S4-DB ADDENDUM (PROPOSAL ONLY — NOT RUN, awaiting approval)
--
-- IMPORTANT: The S4 admin inbox + admin replies WORK WITHOUT THIS FILE.
-- The deployed RLS already lets admins read every message and reply to any
-- thread, and the trigger notifies the client. This addendum only adds the
-- OPTIONAL niceties that genuinely need schema/grants:
--   Part A — persisted thread status (new/open/replied/closed) + admin mark-read
--   Part B — staff roles foundation (sales/support/production/manager/read-only)
--
-- Run nothing until reviewed and approved. Part A is small and low-risk;
-- Part B is a design outline to be finalized before implementation.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───────────────────────────────────────────────────────────────────────────
-- PART A — Message status + admin mark-read (optional, low-risk, additive)
-- ───────────────────────────────────────────────────────────────────────────
-- Adds an explicit thread status so admins can mark open/replied/closed instead
-- of relying only on the derived "latest sender" signal the UI uses today.

alter table public.messages
  add column if not exists status text not null default 'new'
    check (status in ('new','open','replied','closed'));

-- Allow admins (only) to update status + read_at. The existing
-- "admin all messages" RLS policy already restricts WHO; this grant restricts
-- WHICH columns. Non-admins have no UPDATE policy on messages, so they remain
-- unable to update regardless of the grant.
grant update (status, read_at) on public.messages to authenticated;

-- Optional: auto-advance status via the existing message trigger.
-- (Extends trg_message_created — shown as a REPLACEMENT for review.)
/*
create or replace function public.trg_message_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.log_activity(coalesce(auth.uid(), new.user_id),
          case when new.sender = 'user' then 'user' else 'admin' end,
          'message.sent', 'message', new.id, '{}');
  if new.sender = 'user' then
    -- a client message (re)opens the thread for the team
    update public.messages set status = 'open'
      where user_id = new.user_id and status = 'closed' and id <> new.id;
    perform public.notify(null, 'admin', 'message_new', 'message', new.id,
                          'رسالة جديدة', 'New message');
  else
    -- an admin reply marks the thread replied
    update public.messages set status = 'replied'
      where user_id = new.user_id and status in ('new','open') and id <> new.id;
    perform public.notify(new.user_id, 'user', 'message_new', 'message', new.id,
                          'رد جديد من كيان', 'New reply from Kian');
  end if;
  return new;
end; $$;
*/


-- ───────────────────────────────────────────────────────────────────────────
-- PART B — Staff roles foundation (DESIGN OUTLINE — finalize before running)
-- ───────────────────────────────────────────────────────────────────────────
-- Goal: let non-admin Kian staff use the inbox with scoped permissions, without
-- granting global 'admin' (which stays restricted to the two approved emails).
--
-- Approach: a separate staff-role flag on profiles + helper predicates, so the
-- 3-value account_type enum is NOT touched.
--
--   alter table public.profiles
--     add column if not exists staff_role text
--       check (staff_role in ('manager','sales','support','production','readonly'));
--
--   create or replace function public.is_staff() returns boolean
--   language sql stable security definer set search_path = public as $$
--     select exists (select 1 from public.profiles
--                    where id = auth.uid() and account_status = 'active'
--                      and (account_type = 'admin' or staff_role is not null));
--   $$;
--
--   create or replace function public.staff_can_reply() returns boolean ...
--     -- true for admin/manager/sales/support; false for readonly/production-only
--
-- Then messages policies gain staff variants, e.g.:
--   • read:  is_admin() OR (is_staff() AND staff_role in ('manager','sales','support'))
--   • reply: staff_can_reply()
--   • production staff: NO access to general support messages; project_messages only
--
-- Assignment (thread → staff member) would need a new column or table:
--   alter table public.messages add column assigned_to uuid references auth.users(id);
--   + an admin RPC admin_assign_thread(p_user uuid, p_staff uuid).
--
-- Close/assign actions would be is_admin()/manager-guarded RPCs (same pattern as
-- the S1 admin RPCs). This is Phase-3 scope; documented here so the data model
-- can absorb it without rework.
