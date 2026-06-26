-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Notification Delivery Layer, STAGE 1 (foundation + observability).
-- ADDITIVE + idempotent. NO real email/WhatsApp is sent — this only LOGS delivery
-- rows so we can verify routing before any external sender is enabled.
--
-- SAFETY MODEL (requirement A): the existing notify()/notifications are UNTOUCHED.
-- Events are wired via NEW, additive AFTER triggers whose bodies swallow every
-- exception, so a delivery-layer failure can NEVER roll back the business event or
-- the portal notification. No existing RPC is rewritten.
--
-- Depends on: phase0 (profiles, notification_preferences, notify), staff_roles
-- (staff_role/is_owner/is_admin), portal_quotes_invoices (quotes, quote_items,
-- quote_revision_requests, can_manage_quotes), portal_zoho_estimates / client_quote_
-- visibility_fix (quotes.email/client_id/published_at/synced_at/client_response).
-- Invoice events (7,8) are CONFIGURED in the dispatcher but NOT trigger-wired here
-- (invoice conversion is deferred) — they get hooked when that flow is built.
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Delivery log table ══════════════════════════════════════════════
create table if not exists public.notification_deliveries (
  id                uuid primary key default gen_random_uuid(),
  event_type        text not null,
  entity_type       text,
  entity_id         uuid,
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_role    text not null check (recipient_role in ('client','admin','owner','sales','finance','system')),
  channel           text not null check (channel in ('portal','email','whatsapp')),
  destination_email text,
  destination_phone text,
  status            text not null default 'pending' check (status in ('pending','sent','failed','skipped','dry_run')),
  skip_reason       text,
  provider          text,
  provider_message_id text,
  error_message     text,
  retry_count       int not null default 0,
  payload           jsonb,
  idempotency_key   text not null,
  created_at        timestamptz not null default now(),
  sent_at           timestamptz,
  updated_at        timestamptz not null default now()
);
create unique index if not exists uq_nd_idempotency on public.notification_deliveries(idempotency_key);
create index if not exists idx_nd_entity  on public.notification_deliveries(entity_type, entity_id);
create index if not exists idx_nd_status  on public.notification_deliveries(status, channel);
create index if not exists idx_nd_created on public.notification_deliveries(created_at desc);

alter table public.notification_deliveries enable row level security;
-- Read: owner + manager/sales/finance (can_manage_quotes()). Clients/other staff: NONE.
drop policy if exists nd_read on public.notification_deliveries;
create policy nd_read on public.notification_deliveries for select to authenticated
  using (public.can_manage_quotes());
grant select on public.notification_deliveries to authenticated;
-- No insert/update grants — all writes go through the SECURITY DEFINER functions below.

-- ════════ 2) Recipient resolvers ════════════════════════════════════════════
-- Active quote/finance-relevant staff, each tagged with one role bucket.
create or replace function public.notif_resolve_staff()
returns table(user_id uuid, role text, email text, phone text)
language sql stable security definer set search_path = public as $$
  select p.id,
    case when p.account_type = 'admin' or p.staff_role = 'super_admin' then 'owner'
         when p.staff_role = 'finance' then 'finance'
         when p.staff_role = 'sales'   then 'sales'
         else 'admin' end as role,                    -- manager → admin bucket
    p.email, p.mobile
  from public.profiles p
  where p.account_status = 'active'
    and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager','sales','finance'));
$$;

-- The client for a quote: profile-first (by client_id or verified email), then quote/request contact.
create or replace function public.notif_resolve_client(p_quote uuid)
returns table(user_id uuid, email text, phone text)
language plpgsql stable security definer set search_path = public as $$
declare v_client uuid; v_email text; v_qr uuid; v_uid uuid; v_pemail text; v_pphone text; v_qphone text;
begin
  select q.client_id, lower(coalesce(q.email,'')), q.quote_request_id
    into v_client, v_email, v_qr from public.quotes q where q.id = p_quote;
  if v_client is not null then select c.user_id into v_uid from public.clients c where c.id = v_client; end if;
  if v_uid is null and v_email <> '' then
    select id into v_uid from public.profiles where lower(email) = v_email and account_status <> 'blocked' limit 1;
  end if;
  if v_uid is not null then select email, mobile into v_pemail, v_pphone from public.profiles where id = v_uid; end if;
  if v_qr is not null then select phone into v_qphone from public.quote_requests where id = v_qr; end if;
  user_id := v_uid;
  email := nullif(coalesce(nullif(v_pemail,''), nullif(v_email,'')), '');
  phone := nullif(coalesce(nullif(v_pphone,''), nullif(v_qphone,'')), '');
  return next;
end; $$;

-- ════════ 3) Low-level enqueue (one row per channel; idempotent; pref-aware) ══
-- STAGE 1: portal → 'sent' (the bell is handled by the existing notify(), this is the log);
-- email/whatsapp sendable rows → 'pending' (no processor runs yet); known skips → 'skipped'.
create or replace function public.enqueue_delivery(
  p_event text, p_entity_type text, p_entity_id uuid, p_role text, p_user uuid,
  p_email text, p_phone text, p_channels text[], p_is_client boolean, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare ch text; v_key text; v_status text; v_reason text; v_provider text; v_dest_e text; v_dest_p text;
        v_p_portal boolean; v_p_email boolean; v_p_wa boolean; v_has_prefs boolean := false;
        v_phone_digits text;
begin
  if p_user is not null then
    select portal_enabled, email_enabled, whatsapp_enabled into v_p_portal, v_p_email, v_p_wa
      from public.notification_preferences where user_id = p_user;
    v_has_prefs := found;
  end if;
  v_phone_digits := regexp_replace(coalesce(p_phone,''), '[^0-9]', '', 'g');

  foreach ch in array p_channels loop
    v_status := 'pending'; v_reason := null; v_provider := null; v_dest_e := null; v_dest_p := null;

    if ch = 'portal' then
      v_provider := 'portal';
      if v_has_prefs and coalesce(v_p_portal, true) = false then v_status := 'skipped'; v_reason := 'pref_off';
      else v_status := 'sent'; end if;

    elsif ch = 'email' then
      v_dest_e := nullif(p_email, '');
      if v_dest_e is null or position('@' in v_dest_e) = 0 then v_status := 'skipped'; v_reason := 'no_email';
      elsif v_has_prefs and coalesce(v_p_email, false) = false then v_status := 'skipped'; v_reason := 'pref_off';
      else v_status := 'pending'; end if;

    elsif ch = 'whatsapp' then
      v_dest_p := nullif(p_phone, '');
      if v_dest_p is null or length(v_phone_digits) < 9 then v_status := 'skipped'; v_reason := 'no_phone';
      elsif p_is_client and p_event in ('estimate_published','official_invoice_issued') then
        v_status := 'skipped'; v_reason := 'no_approved_template';
      elsif v_has_prefs and coalesce(v_p_wa, false) = false then v_status := 'skipped'; v_reason := 'pref_off';
      else v_status := 'pending'; end if;
    else
      continue;
    end if;

    v_key := p_event || ':' || coalesce(p_entity_id::text, '') || ':'
             || coalesce(p_user::text, lower(coalesce(p_email, p_phone, 'none'))) || ':' || ch;

    insert into public.notification_deliveries
      (event_type, entity_type, entity_id, recipient_user_id, recipient_role, channel,
       destination_email, destination_phone, status, skip_reason, provider, payload, idempotency_key)
    values (p_event, p_entity_type, p_entity_id, p_user, p_role, ch,
            v_dest_e, v_dest_p, v_status, v_reason, v_provider, p_payload, v_key)
    on conflict (idempotency_key) do nothing;
  end loop;
exception when others then
  null;  -- enqueue must NEVER break the caller / business transaction
end; $$;

-- ════════ 4) Dispatcher: event → recipients → channels (the matrix) ══════════
create or replace function public.notif_emit(p_event text, p_entity_type text, p_entity_id uuid, p_quote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_staff_roles text[]; v_staff_ch text[]; v_client boolean := false; v_client_ch text[];
        r record; c record; v_payload jsonb;
begin
  case p_event
    when 'new_quote_request'        then v_staff_roles := array['owner','admin','sales']; v_staff_ch := array['portal','email','whatsapp'];
    when 'estimate_created'         then v_staff_roles := array['owner','admin'];          v_staff_ch := array['portal','email'];
    when 'estimate_synced'          then v_staff_roles := array['owner','admin'];          v_staff_ch := array['portal','email'];
    when 'estimate_published'       then v_client := true; v_client_ch := array['portal','email','whatsapp'];
    when 'client_approved'          then v_staff_roles := array['owner','admin','finance']; v_staff_ch := array['portal','email','whatsapp'];
    when 'client_rejected'          then v_staff_roles := array['owner','admin'];          v_staff_ch := array['portal','email','whatsapp'];
    when 'client_requested_revision'then v_staff_roles := array['owner','admin'];          v_staff_ch := array['portal','email','whatsapp'];
    when 'draft_invoice_created'    then v_staff_roles := array['owner','admin','finance']; v_staff_ch := array['portal','email'];
    when 'official_invoice_issued'  then v_staff_roles := array['owner','admin','finance']; v_staff_ch := array['portal','email']; v_client := true; v_client_ch := array['portal','email','whatsapp'];
    else return;
  end case;

  v_payload := jsonb_build_object('event', p_event, 'entity_type', p_entity_type, 'entity_id', p_entity_id);

  if v_staff_roles is not null then
    for r in select * from public.notif_resolve_staff() where role = any(v_staff_roles) loop
      perform public.enqueue_delivery(p_event, p_entity_type, p_entity_id, r.role, r.user_id, r.email, r.phone, v_staff_ch, false, v_payload);
    end loop;
  end if;

  if v_client and p_quote is not null then
    select * into c from public.notif_resolve_client(p_quote);
    if c.user_id is not null or c.email is not null or c.phone is not null then
      perform public.enqueue_delivery(p_event, p_entity_type, p_entity_id, 'client', c.user_id, c.email, c.phone, v_client_ch, true, v_payload);
    end if;
  end if;
exception when others then
  null;  -- dispatcher must NEVER break the caller
end; $$;
revoke execute on function public.notif_emit(text,text,uuid,uuid) from public, anon;
grant  execute on function public.notif_emit(text,text,uuid,uuid) to service_role, authenticated;

-- ════════ 5) notify_multi() — spec wrapper for future callsites ══════════════
-- Calls the existing notify() (portal, unchanged) then enqueues delivery rows,
-- swallowing ONLY the enqueue errors. Provided per spec; existing RPCs are wired via
-- the triggers below, so they are not rewritten.
create or replace function public.notify_multi(
  p_recipient uuid, p_role text, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text,
  p_event text default null, p_quote uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(p_recipient, p_role, p_type, p_etype, p_eid, p_ar, p_en);  -- unchanged portal behavior
  if p_event is not null then
    begin perform public.notif_emit(p_event, p_etype, p_eid, p_quote); exception when others then null; end;
  end if;
end; $$;
revoke execute on function public.notify_multi(uuid,text,text,text,uuid,text,text,text,uuid) from public, anon;
grant  execute on function public.notify_multi(uuid,text,text,text,uuid,text,text,text,uuid) to service_role;

-- ════════ 6) Additive AFTER triggers (events 1-6) — exception-safe ═══════════
-- new quote request
create or replace function public.trg_nd_quote_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.notif_emit('new_quote_request', 'quote_request', NEW.id, null); exception when others then null; end;
  return NEW;
end; $$;
drop trigger if exists t_nd_quote_request on public.quote_requests;
create trigger t_nd_quote_request after insert on public.quote_requests
  for each row execute function public.trg_nd_quote_request();

-- estimate created (a new Zoho-mirrored quote)
create or replace function public.trg_nd_quote_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.source = 'zoho' then
    begin perform public.notif_emit('estimate_created', 'quote', NEW.id, NEW.id); exception when others then null; end;
  end if;
  return NEW;
end; $$;
drop trigger if exists t_nd_quote_ins on public.quotes;
create trigger t_nd_quote_ins after insert on public.quotes
  for each row execute function public.trg_nd_quote_ins();

-- estimate synced / published / client approved / client rejected
create or replace function public.trg_nd_quote_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if OLD.published_at is null and NEW.published_at is not null then
      perform public.notif_emit('estimate_published', 'quote', NEW.id, NEW.id);
    end if;
    if NEW.client_response is distinct from OLD.client_response then
      if NEW.client_response = 'accepted' then perform public.notif_emit('client_approved', 'quote', NEW.id, NEW.id);
      elsif NEW.client_response = 'declined' then perform public.notif_emit('client_rejected', 'quote', NEW.id, NEW.id);
      end if;
    end if;
    if NEW.synced_at is distinct from OLD.synced_at and NEW.source = 'zoho' then
      perform public.notif_emit('estimate_synced', 'quote', NEW.id, NEW.id);
    end if;
  exception when others then null;
  end;
  return NEW;
end; $$;
drop trigger if exists t_nd_quote_upd on public.quotes;
create trigger t_nd_quote_upd after update on public.quotes
  for each row execute function public.trg_nd_quote_upd();

-- client requested revision (skip when the quote is a decline-with-note; that fires client_rejected instead)
create or replace function public.trg_nd_revision() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_resp text;
begin
  begin
    select client_response into v_resp from public.quotes where id = NEW.quote_id;
    if coalesce(v_resp, 'pending') <> 'declined' then
      perform public.notif_emit('client_requested_revision', 'quote', NEW.quote_id, NEW.quote_id);
    end if;
  exception when others then null;
  end;
  return NEW;
end; $$;
drop trigger if exists t_nd_revision on public.quote_revision_requests;
create trigger t_nd_revision after insert on public.quote_revision_requests
  for each row execute function public.trg_nd_revision();

-- ════════ 7) Admin read RPC (delivery status) ════════════════════════════════
create or replace function public.list_deliveries(p_limit int default 200, p_entity uuid default null)
returns setof public.notification_deliveries
language sql stable security definer set search_path = public as $$
  select * from public.notification_deliveries
   where public.can_manage_quotes()
     and (p_entity is null or entity_id = p_entity)
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit,200), 1000));
$$;
revoke execute on function public.list_deliveries(int,uuid) from public, anon;
grant  execute on function public.list_deliveries(int,uuid) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (after running):
--   -- submit a guest quote / publish an estimate / accept it, then:
--   select event_type, recipient_role, channel, status, skip_reason, destination_email,
--          destination_phone, created_at
--     from public.notification_deliveries order by created_at desc limit 50;
--   -- portal rows = sent; email/whatsapp = pending (sendable) or skipped (no_email/no_phone/
--   -- pref_off/no_approved_template). NOTE: email/whatsapp prefs default OFF for accounts, so
--   -- staff/client email rows show skipped/pref_off until you enable them, e.g.:
--   --   update public.notification_preferences set email_enabled = true where user_id = '<id>';
--
-- ROLLBACK:
-- begin;
--   drop trigger if exists t_nd_quote_request on public.quote_requests;
--   drop trigger if exists t_nd_quote_ins on public.quotes;
--   drop trigger if exists t_nd_quote_upd on public.quotes;
--   drop trigger if exists t_nd_revision on public.quote_revision_requests;
--   drop function if exists public.trg_nd_quote_request(), public.trg_nd_quote_ins(),
--        public.trg_nd_quote_upd(), public.trg_nd_revision(),
--        public.list_deliveries(int,uuid), public.notify_multi(uuid,text,text,text,uuid,text,text,text,uuid),
--        public.notif_emit(text,text,uuid,uuid),
--        public.enqueue_delivery(text,text,uuid,text,uuid,text,text,text[],boolean,jsonb),
--        public.notif_resolve_client(uuid), public.notif_resolve_staff();
--   drop table if exists public.notification_deliveries;
-- commit;
