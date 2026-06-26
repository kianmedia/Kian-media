-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Notification Delivery Layer, STAGE 2 (real sending foundation).
-- ADDITIVE + idempotent. SUPERSEDES docs/portal_notification_delivery_stage1_RUNME.sql
-- (re-creates the table/functions/triggers + adds claim/mark/retry RPCs, generalized
-- staff+client dispatch, and the expanded event triggers). Run THIS one file.
--
-- This migration only sets up the QUEUE + claim/mark plumbing + event wiring. The
-- actual sending happens in the server processor route (POST /api/integrations/
-- deliveries/process), which is env-gated and dry-run by default. Triggers remain
-- exception-safe AFTER triggers so a delivery failure can NEVER roll back the
-- business event or the existing notify()/notifications (which are untouched).
--
-- Depends on: phase0 (profiles, notification_preferences, notify, messages,
-- file_links, projects, deliverables, project_client_user_ids), staff_roles
-- (staff_role/is_owner), portal_quotes_invoices (quotes/quote_items/quote_revision_
-- requests, can_manage_quotes), portal_email_linking (public_intake).
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Delivery log table (+ Stage-2 claim columns) ════════════════════
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
alter table public.notification_deliveries add column if not exists claimed_at timestamptz;
create unique index if not exists uq_nd_idempotency on public.notification_deliveries(idempotency_key);
create index if not exists idx_nd_entity  on public.notification_deliveries(entity_type, entity_id);
create index if not exists idx_nd_status  on public.notification_deliveries(status, channel);
create index if not exists idx_nd_claim   on public.notification_deliveries(status, channel, claimed_at);
create index if not exists idx_nd_created on public.notification_deliveries(created_at desc);

alter table public.notification_deliveries enable row level security;
drop policy if exists nd_read on public.notification_deliveries;
create policy nd_read on public.notification_deliveries for select to authenticated
  using (public.can_manage_quotes());
grant select on public.notification_deliveries to authenticated;

-- ════════ 2) Recipient resolvers ════════════════════════════════════════════
create or replace function public.notif_resolve_staff()
returns table(user_id uuid, role text, email text, phone text)
language sql stable security definer set search_path = public as $$
  select p.id,
    case when p.account_type = 'admin' or p.staff_role = 'super_admin' then 'owner'
         when p.staff_role = 'finance' then 'finance'
         when p.staff_role = 'sales'   then 'sales'
         else 'admin' end,
    p.email, p.mobile
  from public.profiles p
  where p.account_status = 'active'
    and (p.account_type = 'admin' or p.staff_role in ('super_admin','manager','sales','finance','hr'));
$$;

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
-- Client WhatsApp is enqueued 'pending'; the PROCESSOR enforces approved-template-only
-- (skips no_approved_template when no template is mapped for the event).
create or replace function public.enqueue_delivery(
  p_event text, p_entity_type text, p_entity_id uuid, p_role text, p_user uuid,
  p_email text, p_phone text, p_channels text[], p_is_client boolean, p_payload jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare ch text; v_key text; v_status text; v_reason text; v_provider text; v_dest_e text; v_dest_p text;
        v_p_portal boolean; v_p_email boolean; v_p_wa boolean; v_has_prefs boolean := false; v_phone_digits text;
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
      elsif v_has_prefs and coalesce(v_p_wa, false) = false then v_status := 'skipped'; v_reason := 'pref_off';
      else v_status := 'pending'; end if;
    else continue;
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
exception when others then null;
end; $$;

-- ════════ 4) Dispatch: staff side + client side (the matrix) ═════════════════
-- STAFF recipients for an event.
create or replace function public.notif_emit_staff(p_event text, p_entity_type text, p_entity_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_roles text[]; v_ch text[]; r record; v_payload jsonb;
begin
  case p_event
    when 'new_quote_request'         then v_roles := array['owner','admin','sales']; v_ch := array['portal','email','whatsapp'];
    when 'booking_request'           then v_roles := array['owner','admin','sales']; v_ch := array['portal','email','whatsapp'];
    when 'contact_request'           then v_roles := array['owner','admin'];          v_ch := array['portal','email'];
    when 'files_received'            then v_roles := array['owner','admin'];          v_ch := array['portal','email'];
    when 'client_message'            then v_roles := array['owner','admin'];          v_ch := array['portal','email'];
    when 'client_file_upload'        then v_roles := array['owner','admin'];          v_ch := array['portal','email'];
    when 'estimate_created'          then v_roles := array['owner','admin'];          v_ch := array['portal','email'];
    when 'estimate_synced'           then v_roles := array['owner','admin'];          v_ch := array['portal','email'];
    when 'client_approved'           then v_roles := array['owner','admin','finance']; v_ch := array['portal','email','whatsapp'];
    when 'client_rejected'           then v_roles := array['owner','admin'];          v_ch := array['portal','email','whatsapp'];
    when 'client_requested_revision' then v_roles := array['owner','admin'];          v_ch := array['portal','email','whatsapp'];
    when 'draft_invoice_created'     then v_roles := array['owner','admin','finance']; v_ch := array['portal','email'];
    when 'official_invoice_issued'   then v_roles := array['owner','admin','finance']; v_ch := array['portal','email'];
    when 'project_created'           then v_roles := array['owner','admin'];          v_ch := array['portal','email'];
    when 'opportunity_received'      then v_roles := array['owner','admin','hr'];      v_ch := array['portal','email'];
    else return;  -- client-only events (estimate_published, project_status_changed, deliverable_*) have no staff side
  end case;
  v_payload := jsonb_build_object('event', p_event, 'entity_type', p_entity_type, 'entity_id', p_entity_id);
  for r in select * from public.notif_resolve_staff() where role = any(v_roles) loop
    perform public.enqueue_delivery(p_event, p_entity_type, p_entity_id, r.role, r.user_id, r.email, r.phone, v_ch, false, v_payload);
  end loop;
exception when others then null;
end; $$;

-- CLIENT recipient for an event (caller resolves + passes the contact).
create or replace function public.notif_emit_client(
  p_event text, p_entity_type text, p_entity_id uuid, p_user uuid, p_email text, p_phone text
) returns void language plpgsql security definer set search_path = public as $$
declare v_ch text[]; v_payload jsonb;
begin
  case p_event
    when 'estimate_published'      then v_ch := array['portal','email','whatsapp'];
    when 'official_invoice_issued' then v_ch := array['portal','email','whatsapp'];
    when 'project_status_changed'  then v_ch := array['portal','email'];
    when 'deliverable_ready'       then v_ch := array['portal','email'];
    when 'deliverable_final'       then v_ch := array['portal','email','whatsapp'];
    when 'new_quote_request'       then v_ch := array['email','whatsapp'];   -- website confirmation to the requester
    when 'booking_request'         then v_ch := array['email','whatsapp'];
    when 'files_received'          then v_ch := array['email'];
    when 'contact_request'         then v_ch := array['email'];
    else return;
  end case;
  if p_user is null and p_email is null and p_phone is null then return; end if;
  v_payload := jsonb_build_object('event', p_event, 'entity_type', p_entity_type, 'entity_id', p_entity_id);
  perform public.enqueue_delivery(p_event, p_entity_type, p_entity_id, 'client', p_user, p_email, p_phone, v_ch, true, v_payload);
exception when others then null;
end; $$;

-- Convenience wrapper used by the quote triggers (staff + quote-resolved client).
create or replace function public.notif_emit(p_event text, p_entity_type text, p_entity_id uuid, p_quote uuid)
returns void language plpgsql security definer set search_path = public as $$
declare c record;
begin
  perform public.notif_emit_staff(p_event, p_entity_type, p_entity_id);
  if p_quote is not null then
    select * into c from public.notif_resolve_client(p_quote);
    perform public.notif_emit_client(p_event, p_entity_type, p_entity_id, c.user_id, c.email, c.phone);
  end if;
exception when others then null;
end; $$;
revoke execute on function public.notif_emit(text,text,uuid,uuid) from public, anon;
grant  execute on function public.notif_emit(text,text,uuid,uuid) to service_role, authenticated;

-- ════════ 5) notify_multi() — spec wrapper for future callsites ══════════════
create or replace function public.notify_multi(
  p_recipient uuid, p_role text, p_type text, p_etype text, p_eid uuid, p_ar text, p_en text,
  p_event text default null, p_quote uuid default null
) returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(p_recipient, p_role, p_type, p_etype, p_eid, p_ar, p_en);
  if p_event is not null then
    begin perform public.notif_emit(p_event, p_etype, p_eid, p_quote); exception when others then null; end;
  end if;
end; $$;
revoke execute on function public.notify_multi(uuid,text,text,text,uuid,text,text,text,uuid) from public, anon;
grant  execute on function public.notify_multi(uuid,text,text,text,uuid,text,text,text,uuid) to service_role;

-- ════════ 6) Processor plumbing: claim / mark / retry ════════════════════════
-- Claim pending email/whatsapp rows with a 10-min lease (FOR UPDATE SKIP LOCKED) so
-- concurrent processor runs never grab the same row. 'sent' rows (status<>'pending')
-- are never reclaimed → idempotent.
create or replace function public.claim_deliveries(p_limit int default 25, p_channels text[] default array['email','whatsapp'])
returns setof public.notification_deliveries
language sql security definer set search_path = public as $$
  update public.notification_deliveries d set claimed_at = now()
   where d.id in (
     select id from public.notification_deliveries
      where status = 'pending' and channel = any(p_channels)
        and (claimed_at is null or claimed_at < now() - interval '10 minutes')
      order by created_at asc
      limit greatest(1, least(coalesce(p_limit, 25), 200))
      for update skip locked)
  returning d.*;
$$;
revoke execute on function public.claim_deliveries(int,text[]) from public, anon, authenticated;
grant  execute on function public.claim_deliveries(int,text[]) to service_role;

create or replace function public.mark_delivery_result(
  p_id uuid, p_status text, p_provider text default null, p_message_id text default null,
  p_error text default null, p_bump_retry boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.notification_deliveries set
    status = p_status,
    provider = coalesce(p_provider, provider),
    provider_message_id = coalesce(p_message_id, provider_message_id),
    error_message = p_error,
    retry_count = retry_count + case when p_bump_retry then 1 else 0 end,
    sent_at = case when p_status in ('sent','dry_run') then now() else sent_at end,
    claimed_at = null,
    updated_at = now()
  where id = p_id;
end; $$;
revoke execute on function public.mark_delivery_result(uuid,text,text,text,text,boolean) from public, anon, authenticated;
grant  execute on function public.mark_delivery_result(uuid,text,text,text,text,boolean) to service_role;

-- Admin "retry failed": requeue a failed row (gated can_manage_quotes).
create or replace function public.retry_delivery(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  update public.notification_deliveries
     set status = 'pending', claimed_at = null, error_message = null, updated_at = now()
   where id = p_id and status in ('failed','skipped');
  return found;
end; $$;
revoke execute on function public.retry_delivery(uuid) from public, anon;
grant  execute on function public.retry_delivery(uuid) to authenticated;

-- ════════ 7) Admin read RPC ══════════════════════════════════════════════════
create or replace function public.list_deliveries(p_limit int default 300, p_entity uuid default null)
returns setof public.notification_deliveries
language sql stable security definer set search_path = public as $$
  select * from public.notification_deliveries
   where public.can_manage_quotes()
     and (p_entity is null or entity_id = p_entity)
   order by created_at desc
   limit greatest(1, least(coalesce(p_limit,300), 1000));
$$;
revoke execute on function public.list_deliveries(int,uuid) from public, anon;
grant  execute on function public.list_deliveries(int,uuid) to authenticated;

-- ════════ 8) Event triggers — all additive + exception-safe (return NEW) ═════
-- (a) QUOTE events (1-6) — same as Stage 1.
create or replace function public.trg_nd_quote_request() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.notif_emit_staff('new_quote_request', 'quote_request', NEW.id); exception when others then null; end;
  return NEW;
end; $$;
drop trigger if exists t_nd_quote_request on public.quote_requests;
create trigger t_nd_quote_request after insert on public.quote_requests for each row execute function public.trg_nd_quote_request();

create or replace function public.trg_nd_quote_ins() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.source = 'zoho' then
    begin perform public.notif_emit('estimate_created', 'quote', NEW.id, NEW.id); exception when others then null; end;
  end if;
  return NEW;
end; $$;
drop trigger if exists t_nd_quote_ins on public.quotes;
create trigger t_nd_quote_ins after insert on public.quotes for each row execute function public.trg_nd_quote_ins();

create or replace function public.trg_nd_quote_upd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if OLD.published_at is null and NEW.published_at is not null then perform public.notif_emit('estimate_published', 'quote', NEW.id, NEW.id); end if;
    if NEW.client_response is distinct from OLD.client_response then
      if NEW.client_response = 'accepted' then perform public.notif_emit('client_approved', 'quote', NEW.id, NEW.id);
      elsif NEW.client_response = 'declined' then perform public.notif_emit('client_rejected', 'quote', NEW.id, NEW.id); end if;
    end if;
    if NEW.synced_at is distinct from OLD.synced_at and NEW.source = 'zoho' then perform public.notif_emit('estimate_synced', 'quote', NEW.id, NEW.id); end if;
  exception when others then null;
  end;
  return NEW;
end; $$;
drop trigger if exists t_nd_quote_upd on public.quotes;
create trigger t_nd_quote_upd after update on public.quotes for each row execute function public.trg_nd_quote_upd();

create or replace function public.trg_nd_revision() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_resp text;
begin
  begin
    select client_response into v_resp from public.quotes where id = NEW.quote_id;
    if coalesce(v_resp, 'pending') <> 'declined' then perform public.notif_emit('client_requested_revision', 'quote', NEW.quote_id, NEW.quote_id); end if;
  exception when others then null;
  end;
  return NEW;
end; $$;
drop trigger if exists t_nd_revision on public.quote_revision_requests;
create trigger t_nd_revision after insert on public.quote_revision_requests for each row execute function public.trg_nd_revision();

-- (b) WEBSITE intake events (public_intake): booking / files / contact (+ requester confirm).
-- 'quote' intakes are already covered by the quote_requests promotion trigger, so skip them here.
create or replace function public.trg_nd_public_intake() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_event text;
begin
  begin
    v_event := case NEW.request_type
                 when 'meeting' then 'booking_request' when 'call' then 'booking_request'
                 when 'files' then 'files_received' when 'contact' then 'contact_request' else null end;
    if v_event is not null then
      perform public.notif_emit_staff(v_event, 'public_intake', NEW.id);
      perform public.notif_emit_client(v_event, 'public_intake', NEW.id, NEW.user_id, lower(NEW.email), NEW.phone);
    end if;
  exception when others then null;
  end;
  return NEW;
end; $$;
drop trigger if exists t_nd_public_intake on public.public_intake;
create trigger t_nd_public_intake after insert on public.public_intake for each row execute function public.trg_nd_public_intake();

-- (c) Client portal MESSAGE (sender='user' → notify staff).
create or replace function public.trg_nd_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if NEW.sender = 'user' then
    begin perform public.notif_emit_staff('client_message', 'message', NEW.id); exception when others then null; end;
  end if;
  return NEW;
end; $$;
drop trigger if exists t_nd_message on public.messages;
create trigger t_nd_message after insert on public.messages for each row execute function public.trg_nd_message();

-- (d) Client FILE/link upload → notify staff.
create or replace function public.trg_nd_file() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin perform public.notif_emit_staff('client_file_upload', 'file_link', NEW.id); exception when others then null; end;
  return NEW;
end; $$;
drop trigger if exists t_nd_file on public.file_links;
create trigger t_nd_file after insert on public.file_links for each row execute function public.trg_nd_file();

-- (e) PROJECT created / status changed.
create or replace function public.trg_nd_project() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record; v_email text; v_phone text;
begin
  begin
    if TG_OP = 'INSERT' then
      perform public.notif_emit_staff('project_created', 'project', NEW.id);
    elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
      for u in select user_id from public.project_client_user_ids(NEW.id) loop
        select email, mobile into v_email, v_phone from public.profiles where id = u.user_id;
        perform public.notif_emit_client('project_status_changed', 'project', NEW.id, u.user_id, v_email, v_phone);
      end loop;
    end if;
  exception when others then null;
  end;
  return NEW;
end; $$;
drop trigger if exists t_nd_project on public.projects;
create trigger t_nd_project after insert or update on public.projects for each row execute function public.trg_nd_project();

-- (f) DELIVERABLE ready-for-review / final-delivered → notify project clients.
create or replace function public.trg_nd_deliverable() returns trigger
language plpgsql security definer set search_path = public as $$
declare u record; v_email text; v_phone text; v_event text;
begin
  begin
    v_event := case when NEW.status = 'client_review' and (TG_OP = 'INSERT' or NEW.status is distinct from OLD.status) then 'deliverable_ready'
                    when NEW.status = 'final_delivered' and (TG_OP = 'INSERT' or NEW.status is distinct from OLD.status) then 'deliverable_final'
                    else null end;
    if v_event is not null then
      for u in select user_id from public.project_client_user_ids(NEW.project_id) loop
        select email, mobile into v_email, v_phone from public.profiles where id = u.user_id;
        perform public.notif_emit_client(v_event, 'deliverable', NEW.id, u.user_id, v_email, v_phone);
      end loop;
    end if;
  exception when others then null;
  end;
  return NEW;
end; $$;
drop trigger if exists t_nd_deliverable on public.deliverables;
create trigger t_nd_deliverable after insert or update on public.deliverables for each row execute function public.trg_nd_deliverable();

-- NOTE: Opportunities events (opportunity_received) are mapped in notif_emit_staff for
-- when that module is wired; NO trigger is added here (Opportunities Portal not built now).
-- Invoice events (draft_invoice_created / official_invoice_issued) are mapped but wired
-- when the invoice-conversion flow is built (it will call notif_emit at that point).

-- ════════ 9) Preference defaults backfill (staff on; client email on) ════════
-- Staff: email + WhatsApp ON (they have contact + are internal). Clients/leads: email ON.
-- Client WhatsApp is intentionally LEFT as-is (off by default) — enable only with consent.
update public.notification_preferences np set email_enabled = true, whatsapp_enabled = true, updated_at = now()
  from public.profiles p
 where p.id = np.user_id and p.account_status = 'active'
   and (p.account_type = 'admin' or p.staff_role is not null)
   and (np.email_enabled = false or np.whatsapp_enabled = false);
update public.notification_preferences np set email_enabled = true, updated_at = now()
  from public.profiles p
 where p.id = np.user_id and p.account_type in ('client','lead') and np.email_enabled = false;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY:
--   select event_type, recipient_role, channel, status, skip_reason, claimed_at, provider,
--          provider_message_id, retry_count, created_at
--     from public.notification_deliveries order by created_at desc limit 60;
--   -- After enabling the processor, email/whatsapp 'pending' rows become 'sent'/'failed'/
--   -- 'skipped'/'dry_run'. claim_deliveries leases for 10 min; 'sent' rows are never reclaimed.
--
-- ROLLBACK:
-- begin;
--   drop trigger if exists t_nd_quote_request on public.quote_requests;
--   drop trigger if exists t_nd_quote_ins on public.quotes;
--   drop trigger if exists t_nd_quote_upd on public.quotes;
--   drop trigger if exists t_nd_revision on public.quote_revision_requests;
--   drop trigger if exists t_nd_public_intake on public.public_intake;
--   drop trigger if exists t_nd_message on public.messages;
--   drop trigger if exists t_nd_file on public.file_links;
--   drop trigger if exists t_nd_project on public.projects;
--   drop trigger if exists t_nd_deliverable on public.deliverables;
--   drop function if exists public.claim_deliveries(int,text[]), public.mark_delivery_result(uuid,text,text,text,text,boolean),
--        public.retry_delivery(uuid), public.notif_emit_staff(text,text,uuid), public.notif_emit_client(text,text,uuid,uuid,text,text),
--        public.trg_nd_public_intake(), public.trg_nd_message(), public.trg_nd_file(), public.trg_nd_project(), public.trg_nd_deliverable();
--   alter table public.notification_deliveries drop column if exists claimed_at;
--   -- (notification_deliveries + the Stage-1 functions/triggers can be dropped via the Stage-1 rollback)
-- commit;
