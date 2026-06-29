-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Notification fan-out addendum (RUN ONCE in Supabase SQL editor)
--
-- Builds on docs/portal_notification_delivery_stage2_RUNME.sql. Fixes:
--   1) Quote requests notified STAFF only — the requester (portal client OR guest)
--      got no confirmation. Now the trigger ALSO emits a client confirmation
--      (email + WhatsApp) using the inline contact on the quote_requests row.
--   2) New account signups produced NO delivery rows at all. Now a new account
--      notifies owner/admin (portal+email+WhatsApp) AND welcomes the new user
--      (email + WhatsApp).
--
-- Safe to run: additive, idempotent (create-or-replace + ON CONFLICT keys),
-- exception-safe (a notify failure never blocks the business write), and it does
-- NOT touch quotes/Zoho/invoices/RLS/WhatsApp-inbound logic. No data is deleted.
-- Requires the Stage-2 objects (enqueue_delivery, notif_resolve_staff,
-- notif_emit_staff, notif_emit_client) to already exist.
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1) Quote request: notify STAFF (unchanged) + the REQUESTER (new) ─────────
-- notif_emit_client already maps 'new_quote_request' → [email, whatsapp]. We just
-- need to call it with the requester's contact, which lives inline on the row
-- (NEW.email / NEW.phone) for guests AND now for portal clients (leads.ts stores it).
create or replace function public.trg_nd_quote_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.notif_emit_staff('new_quote_request', 'quote_request', NEW.id); exception when others then null; end;
  begin perform public.notif_emit_client('new_quote_request', 'quote_request', NEW.id, NEW.user_id, NEW.email, NEW.phone); exception when others then null; end;
  return NEW;
end; $$;
-- trigger already exists from Stage 2 (t_nd_quote_request after insert) — re-bind defensively.
drop trigger if exists t_nd_quote_request on public.quote_requests;
create trigger t_nd_quote_request after insert on public.quote_requests
  for each row execute function public.trg_nd_quote_request();

-- ── 2) New account signup → staff alert + client welcome ─────────────────────
-- Self-contained (does not depend on the big CASE dispatchers). Fires only for
-- public signups (lead/client) so staff/admin provisioning stays quiet. Email
-- copy + WhatsApp template for 'new_account_signup' are handled in
-- lib/server/deliveryRender.ts. The welcome WhatsApp needs an approved Meta
-- template (env WHATSAPP_TEMPLATE_WELCOME_AR) — until set it cleanly skips.
create or replace function public.trg_nd_new_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_payload jsonb;
begin
  if NEW.account_type = 'admin' or NEW.staff_role is not null then
    return NEW;  -- ignore staff/admin provisioning; welcome only public signups
  end if;
  v_payload := jsonb_build_object('event','new_account_signup','entity_type','profile','entity_id',NEW.id);
  -- Staff: owner + admin, all channels.
  begin
    for r in select * from public.notif_resolve_staff() where role in ('owner','admin') loop
      perform public.enqueue_delivery('new_account_signup','profile',NEW.id, r.role, r.user_id,
                                      r.email, r.phone, array['portal','email','whatsapp'], false, v_payload);
    end loop;
  exception when others then null; end;
  -- Client: welcome the new user (email + WhatsApp). mobile is usually null at
  -- signup → WhatsApp row cleanly skips 'no_phone' until they add one.
  begin
    perform public.enqueue_delivery('new_account_signup','profile',NEW.id, 'client', NEW.id,
                                    NEW.email, NEW.mobile, array['email','whatsapp'], true, v_payload);
  exception when others then null; end;
  return NEW;
end; $$;
drop trigger if exists t_nd_new_account on public.profiles;
create trigger t_nd_new_account after insert on public.profiles
  for each row execute function public.trg_nd_new_account();

-- ── 3) (OPTIONAL — CONSENT) Enable WhatsApp for existing CLIENT accounts ──────
-- Logged-in clients were backfilled with WhatsApp pref OFF (consent default), so
-- their client WhatsApp rows skip 'pref_off'. Guests are unaffected (no prefs).
-- Uncomment to opt every existing lead/client into WhatsApp notifications. Only
-- do this if you have the recipients' consent per WhatsApp Business policy.
-- update public.notification_preferences np
--    set whatsapp_enabled = true, updated_at = now()
--  from public.profiles p
--  where np.user_id = p.id and p.account_type in ('lead','client');

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (run to undo this addendum):
--   begin;
--     drop trigger if exists t_nd_new_account on public.profiles;
--     drop function if exists public.trg_nd_new_account();
--     -- restore the Stage-2 staff-only quote trigger body:
--     create or replace function public.trg_nd_quote_request() returns trigger
--     language plpgsql security definer set search_path = public as $$
--     begin
--       begin perform public.notif_emit_staff('new_quote_request', 'quote_request', NEW.id); exception when others then null; end;
--       return NEW;
--     end; $$;
--   commit;
-- ════════════════════════════════════════════════════════════════════════
