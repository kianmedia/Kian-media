-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — WhatsApp consent + quote/signup fan-out (RUN ONCE in Supabase)
--
-- SUPERSEDES docs/portal_notification_fanout_addendum_RUNME.sql — running THIS
-- file alone is sufficient (it re-includes the signup trigger). If you already
-- ran the fanout addendum, running this is still safe (idempotent).
--
-- What it does:
--   1) Adds quote_requests.whatsapp_consent (per-request WhatsApp opt-in).
--   2) Quote request → staff alert (unchanged) + client EMAIL (pref-aware) + client
--      WhatsApp ONLY with explicit per-request consent (else skip 'consent_missing').
--   3) New account signup → owner/admin alert + client welcome.
--   4) Staff-missing-mobile diagnostic (masked) + an UPDATE template.
--
-- Additive, idempotent, transactional. Does NOT touch Zoho/invoices/RLS/quote
-- approval/WhatsApp-inbound. enqueue_delivery() is NOT modified (no signature
-- change) — a dedicated consent-aware WhatsApp enqueuer is added instead.
-- Requires the Stage-2 objects (enqueue_delivery, notif_emit_staff, notif_resolve_staff).
-- ════════════════════════════════════════════════════════════════════════
begin;

-- ── 1) Per-request WhatsApp consent column ───────────────────────────────────
alter table public.quote_requests add column if not exists whatsapp_consent boolean not null default false;

-- ── 2) Consent-aware client WhatsApp enqueuer (one row; idempotent) ──────────
-- Sends ONLY with explicit per-request consent; otherwise records a clear skip so
-- the Delivery Log explains why. Per-request consent intentionally overrides the
-- global whatsapp preference (the requester opted in for THIS request).
create or replace function public.enqueue_client_whatsapp_consent(
  p_event text, p_entity_type text, p_entity_id uuid, p_user uuid, p_phone text,
  p_consent boolean, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_key text; v_status text; v_reason text; v_dest_p text; v_digits text;
begin
  v_dest_p := nullif(p_phone, '');
  v_digits := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');
  if v_dest_p is null or length(v_digits) < 9 then v_status := 'skipped'; v_reason := 'no_phone';
  elsif coalesce(p_consent, false) = false then  v_status := 'skipped'; v_reason := 'consent_missing';
  else v_status := 'pending'; v_reason := null;   -- explicit consent → send (overrides global pref)
  end if;
  v_key := p_event || ':' || coalesce(p_entity_id::text,'') || ':'
           || coalesce(p_user::text, lower(coalesce(p_phone,'none'))) || ':whatsapp';
  insert into public.notification_deliveries
    (event_type, entity_type, entity_id, recipient_user_id, recipient_role, channel,
     destination_email, destination_phone, status, skip_reason, provider, payload, idempotency_key)
  values (p_event, p_entity_type, p_entity_id, p_user, 'client', 'whatsapp',
          null, v_dest_p, v_status, v_reason, null, p_payload, v_key)
  on conflict (idempotency_key) do nothing;
exception when others then null;
end; $$;

-- ── 3) Quote request trigger: staff + client email + consent-gated WhatsApp ───
create or replace function public.trg_nd_quote_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_payload jsonb;
begin
  begin perform public.notif_emit_staff('new_quote_request', 'quote_request', NEW.id); exception when others then null; end;
  begin
    v_payload := jsonb_build_object('event','new_quote_request','entity_type','quote_request','entity_id',NEW.id);
    -- Email confirmation to the requester (pref-aware), guest or client.
    perform public.enqueue_delivery('new_quote_request','quote_request',NEW.id,'client',
                                    NEW.user_id, NEW.email, NEW.phone, array['email']::text[], true, v_payload);
    -- WhatsApp confirmation ONLY with explicit per-request consent.
    perform public.enqueue_client_whatsapp_consent('new_quote_request','quote_request',NEW.id,
                                    NEW.user_id, NEW.phone, NEW.whatsapp_consent, v_payload);
  exception when others then null; end;
  return NEW;
end; $$;
drop trigger if exists t_nd_quote_request on public.quote_requests;
create trigger t_nd_quote_request after insert on public.quote_requests
  for each row execute function public.trg_nd_quote_request();

-- ── 4) New account signup → staff alert + client welcome (public signups only) ─
create or replace function public.trg_nd_new_account() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; v_payload jsonb;
begin
  if NEW.account_type = 'admin' or NEW.staff_role is not null then
    return NEW;  -- ignore staff/admin provisioning; welcome only public signups
  end if;
  v_payload := jsonb_build_object('event','new_account_signup','entity_type','profile','entity_id',NEW.id);
  begin
    for r in select * from public.notif_resolve_staff() where role in ('owner','admin') loop
      perform public.enqueue_delivery('new_account_signup','profile',NEW.id, r.role, r.user_id,
                                      r.email, r.phone, array['portal','email','whatsapp'], false, v_payload);
    end loop;
  exception when others then null; end;
  begin
    perform public.enqueue_delivery('new_account_signup','profile',NEW.id, 'client', NEW.id,
                                    NEW.email, NEW.mobile, array['email','whatsapp'], true, v_payload);
  exception when others then null; end;
  return NEW;
end; $$;
drop trigger if exists t_nd_new_account on public.profiles;
create trigger t_nd_new_account after insert on public.profiles
  for each row execute function public.trg_nd_new_account();

commit;

-- ════════════════════════════════════════════════════════════════════════
-- 5) STAFF MOBILE DIAGNOSTIC — run this SELECT to see who is missing a mobile
--    (number is MASKED to the last 4 digits; never exposes the full number):
--
--   select
--     case when account_type='admin' or staff_role='super_admin' then 'owner'
--          when staff_role is not null then staff_role else account_type end as role,
--     email,
--     case when coalesce(mobile,'')='' then '— MISSING —'
--          else '••••' || right(regexp_replace(mobile,'[^0-9]','','g'),4) end as mobile_masked,
--     (coalesce(mobile,'')='') as missing_mobile
--   from public.profiles
--   where account_type='admin' or staff_role in ('super_admin','manager','sales','finance','hr')
--   order by missing_mobile desc, role;
--
--    Then set the real numbers (E.164, e.g. Saudi 9665XXXXXXXX) per user — do NOT guess:
--
--   update public.profiles set mobile='9665XXXXXXXX' where email='owner@kianmedia.com';
--   update public.profiles set mobile='9665XXXXXXXX' where email='sales@kianmedia.com';
-- ════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   begin;
--     drop trigger if exists t_nd_new_account on public.profiles;
--     drop function if exists public.trg_nd_new_account();
--     drop function if exists public.enqueue_client_whatsapp_consent(text,text,uuid,uuid,text,boolean,jsonb);
--     create or replace function public.trg_nd_quote_request() returns trigger
--     language plpgsql security definer set search_path = public as $$
--     begin
--       begin perform public.notif_emit_staff('new_quote_request','quote_request',NEW.id); exception when others then null; end;
--       return NEW;
--     end; $$;
--     -- (optional) alter table public.quote_requests drop column if exists whatsapp_consent;
--   commit;
-- ════════════════════════════════════════════════════════════════════════
