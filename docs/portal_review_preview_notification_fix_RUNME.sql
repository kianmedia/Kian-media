-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Review/Preview save fails for unlinked/pending clients (RUN ONCE)
--
-- Bug: adding a review/preview deliverable with status "مراجعة العميل"
-- (client_review) to a project whose client is NOT linked to a portal account
-- (pending / no-email / unlinked — clients.user_id IS NULL) failed with:
--   new row for relation "notifications" violates check constraint "recipient_shape"
--
-- Root cause: the deliverables trigger notifies each client recipient via
--   for r in select * from public.project_client_user_ids(new.project_id) loop
--     perform public.notify(r.user_id, 'user', 'deliverable_new', ...);
-- project_client_user_ids() returns clients.user_id, which since the pending-client
-- feature can be NULL (admin created the project without an account). notify() then
-- inserts (recipient_id=NULL, recipient_role='user'), violating
--   recipient_shape: (recipient_role='admin') = (recipient_id is null)
-- so the whole deliverable INSERT (admin_add_deliverable) rolls back.
--
-- Fix (minimal, root-cause; does NOT weaken the constraint or RLS):
--   1) project_client_user_ids() returns only REAL user recipients (user_id NOT NULL)
--      → a pending/unlinked project yields zero recipients → the notification is
--      simply skipped and the deliverable saves. Linked clients still get notified.
--   2) notify() defensively skips a 'user' notification with a NULL recipient
--      (belt-and-suspenders — no caller can ever violate recipient_shape this way).
-- Both are create-or-replace (idempotent, safe to rerun). Also fixes the same latent
-- issue for project_status_changed / final_delivered notifications (same helper).
-- Does NOT touch WhatsApp/n8n/Meta/Resend/email/Zoho/delivery-processor objects.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- 1) Only include client recipients that actually have an account (user_id NOT NULL).
--    project_members.user_id is already NOT NULL by schema; the clients branch is the
--    one that can now be NULL for pending/unlinked clients.
create or replace function public.project_client_user_ids(p_project uuid)
returns table (user_id uuid) language sql stable security definer set search_path = public as $$
  select pm.user_id from public.project_members pm
   where pm.project_id = p_project and pm.role like 'client\_%' and pm.is_deleted = false
     and pm.user_id is not null
  union
  select c.user_id from public.clients c
   join public.projects p on p.client_id = c.id
   where p.id = p_project and c.is_deleted = false
     and c.user_id is not null;
$$;

-- 2) Harden notify(): a 'user' notification requires a real recipient. Skip safely
--    instead of violating recipient_shape (admin broadcasts — role='admin',
--    recipient=NULL — are unaffected). Preference gate is preserved.
create or replace function public.notify(
  p_recipient uuid, p_role text, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- A user notification with no recipient is meaningless (and would break
  -- recipient_shape) → skip. Admin broadcasts (role='admin') keep NULL recipient.
  if p_role = 'user' and p_recipient is null then
    return;
  end if;
  if p_role = 'user' and exists (select 1 from public.notification_preferences
                                 where user_id = p_recipient and portal_enabled = false) then
    return;
  end if;
  insert into public.notifications (recipient_id, recipient_role, type, entity_type, entity_id, title_ar, title_en)
  values (p_recipient, p_role, p_type, p_etype, p_eid, p_ar, p_en);
end; $$;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   -- The constraint still exists (NOT weakened):
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.notifications'::regclass and conname = 'recipient_shape';
--   -- A pending/unlinked project now yields NO client recipients (was a NULL row):
--   select * from public.project_client_user_ids('<unlinked_project_id>');   -- expect 0 rows
--   -- A linked project still yields its client user_id(s):
--   select * from public.project_client_user_ids('<linked_project_id>');     -- expect ≥1 row
--   -- End-to-end (as admin): adding a client_review deliverable to an unlinked
--   -- project now succeeds (no recipient_shape error) and skips the notification:
--   select public.admin_add_deliverable('<unlinked_project_id>', 'Test preview', 'video', 'https://x', null, 'client_review');
-- ════════════════════════════════════════════════════════════════════════
