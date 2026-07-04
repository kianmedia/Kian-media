-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — EQUIPMENT CUSTODY & RENTAL (عهدة وتأجير المعدات) — Phase 1
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
--
-- ADDS (fully additive — touches NOTHING existing except widening the
-- notifications type CHECK with custody types, the established superset pattern):
--   • Tables: renter_profiles, custody_records, custody_items, custody_events
--   • Helpers: is_renter(), can_manage_custody(), custody_client_ip(),
--     custody_notify(), custody_notify_admins()
--   • Guarded RPCs: upsert_renter_profile, submit_checkout, submit_rental_request,
--     submit_return, admin_approve_handover, admin_close_custody,
--     admin_reject_custody, admin_add_custody_note
--   • Storage: private bucket custody-evidence (10MB, images only) + RLS policies
--   • Sequence custody_record_no_seq → record_no 'KM-0001'
--
-- DECISIONS ENCODED (approved defaults):
--   admin  = is_owner() OR staff_role='manager'  (can_manage_custody)
--   employee = any staff (is_staff())            renter = lead/client + renter_profiles row
--   Reject allowed ONLY from review_handover.    Urgency = distinct type custody_return_shortage.
--   REUSES existing notifications + notify() — does NOT create a new notifications
--   table and does NOT redefine notify() (its production definition is preserved).
--
-- SAFETY: SECURITY DEFINER + set search_path=public everywhere; revoke/grant per
-- function; RLS on every new table + RESTRICTIVE live-rows policy; no service-role
-- dependency; no WhatsApp/email/n8n objects (webhook staging lives in app code,
-- disabled by default). Does NOT touch quotes/billing/projects/deliverables.
--
-- NOTE (section 8 fallback): on some Supabase projects `create policy on
-- storage.objects` requires the storage owner role. If section 8 errors with
-- "must be owner of table objects", create the SAME two policies from
-- Dashboard → Storage → custody-evidence → Policies (expressions below) and the
-- bucket from Dashboard → Storage; everything else in this file is unaffected.
--
-- ⚠ FUTURE-MIGRATION RULE: this file widens notifications_type_check to 28 types.
-- Any LATER migration that recreates that constraint (e.g. an old copy of
-- whatsapp_inbox_RUNME.sql) MUST include the full 28-type superset — always
-- regenerate from the LIVE constraint (pg_get_constraintdef) before running.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Role helpers ════════════════════════════════════════════════════
create or replace function public.can_manage_custody() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager');
$$;
revoke execute on function public.can_manage_custody() from public, anon;
grant  execute on function public.can_manage_custody() to authenticated;

-- (is_renter() is created AFTER renter_profiles exists — sql-language bodies are
--  validated at creation time; see section 4.)

-- Client IP from PostgREST request headers (evidence for ack_ip). Never throws.
create or replace function public.custody_client_ip() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  v := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1);
  return nullif(trim(v), '');
exception when others then return null;
end; $$;
revoke execute on function public.custody_client_ip() from public, anon;
grant  execute on function public.custody_client_ip() to authenticated;

-- ════════ 2) notifications type CHECK — preserve the live 20, add 8 custody ══
-- (superset pattern; precedent: production_restore_latest_quotes_zoho_RUNME.sql)
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
  'project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed',
  -- custody & rental (NEW — in-app only; delivery layer rides later):
  'custody_checkout_new','rental_request_new','custody_return_submitted',
  'custody_return_shortage','custody_handover_approved','custody_closed',
  'custody_rejected','custody_note_new'));

-- ════════ 3) record_no sequence ══════════════════════════════════════════════
create sequence if not exists public.custody_record_no_seq;

-- ════════ 4) Tables ══════════════════════════════════════════════════════════

-- Renter KYC (mandatory before any rental handover).
create table if not exists public.renter_profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null,
  id_number  text not null,
  phone      text not null,
  email      text not null,
  address    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists t_renter_profiles_touch on public.renter_profiles;
create trigger t_renter_profiles_touch before update on public.renter_profiles
  for each row execute function public.touch_updated_at();

-- Renter = an active account that completed the KYC row above.
create or replace function public.is_renter() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.renter_profiles rp where rp.user_id = auth.uid())
         and public.is_active();
$$;
revoke execute on function public.is_renter() from public, anon;
grant  execute on function public.is_renter() to authenticated;

-- One row per custody/rental lifecycle.
create table if not exists public.custody_records (
  id                  uuid primary key,                    -- client-generated (upload paths precede the row)
  record_no           text unique not null,
  kind                text not null check (kind in ('custody','rental')),
  party_user_id       uuid not null references auth.users(id),
  party_name          text not null,                       -- snapshot at creation
  party_phone         text,                                -- snapshot at creation
  party_role          text not null check (party_role in ('employee','renter')),
  status              text not null check (status in
    ('out','review_handover','rented','review_return','closed','rejected','flagged')),
  shortage            boolean not null default false,
  shortage_note       text,
  admin_note          text,
  overall_before_path text,
  overall_after_path  text,
  ack_signed          boolean not null default false,
  ack_signature       text,
  ack_signed_at       timestamptz,
  ack_type            text check (ack_type is null or ack_type in ('custody','rental_contract')),
  ack_ip              text,
  is_deleted          boolean not null default false,
  deleted_at          timestamptz,
  deleted_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
drop trigger if exists t_custody_records_touch on public.custody_records;
create trigger t_custody_records_touch before update on public.custody_records
  for each row execute function public.touch_updated_at();
create index if not exists idx_custody_records_party  on public.custody_records(party_user_id, created_at desc);
create index if not exists idx_custody_records_status on public.custody_records(status);
create index if not exists custody_records_live_idx   on public.custody_records(is_deleted) where is_deleted = false;

-- One row per piece of equipment (per-item before/after photos).
create table if not exists public.custody_items (
  id                uuid primary key default gen_random_uuid(),
  record_id         uuid not null references public.custody_records(id) on delete cascade,
  name              text not null,
  qty               integer not null default 1 check (qty > 0),
  photo_before_path text,
  photo_after_path  text,
  position          integer not null default 0
);
create index if not exists idx_custody_items_record on public.custody_items(record_id, position);

-- Append-only audit trail (NO soft delete, NO updates).
create table if not exists public.custody_events (
  id            uuid primary key default gen_random_uuid(),
  record_id     uuid not null references public.custody_records(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  body          text not null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_custody_events_record on public.custody_events(record_id, created_at);

-- ════════ 5) RLS + grants (read-only; ALL writes via SECURITY DEFINER RPCs) ══
alter table public.renter_profiles enable row level security;
alter table public.custody_records enable row level security;
alter table public.custody_items   enable row level security;
alter table public.custody_events  enable row level security;
grant select on public.renter_profiles, public.custody_records,
                public.custody_items, public.custody_events to authenticated;

drop policy if exists renter_profiles_read on public.renter_profiles;
create policy renter_profiles_read on public.renter_profiles for select to authenticated
  using (user_id = auth.uid() or public.can_manage_custody());

drop policy if exists custody_records_read on public.custody_records;
create policy custody_records_read on public.custody_records for select to authenticated
  using (party_user_id = auth.uid() or public.can_manage_custody());
drop policy if exists custody_records_live on public.custody_records;
create policy custody_records_live on public.custody_records as restrictive for select to authenticated
  using (is_deleted = false or public.can_manage_custody());

drop policy if exists custody_items_read on public.custody_items;
create policy custody_items_read on public.custody_items for select to authenticated
  using (exists (select 1 from public.custody_records r
                 where r.id = record_id
                   and (r.party_user_id = auth.uid() or public.can_manage_custody())
                   and (r.is_deleted = false or public.can_manage_custody())));

drop policy if exists custody_events_read on public.custody_events;
create policy custody_events_read on public.custody_events for select to authenticated
  using (exists (select 1 from public.custody_records r
                 where r.id = record_id
                   and (r.party_user_id = auth.uid() or public.can_manage_custody())
                   and (r.is_deleted = false or public.can_manage_custody())));

-- ════════ 6) Notification wrappers (REUSE public.notify — never redefined) ═══
-- Per-user or admin-broadcast row for a custody event.
create or replace function public.custody_notify(
  p_recipient uuid, p_type text, p_record uuid, p_ar text, p_en text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(
    p_recipient,
    case when p_recipient is null then 'admin' else 'user' end,
    p_type, 'custody_record', p_record, p_ar, p_en);
end; $$;
revoke execute on function public.custody_notify(uuid,text,uuid,text,text) from public, anon, authenticated;

-- All custody managers: broadcast covers account_type='admin' (is_admin sees it);
-- per-user rows cover super_admin/manager staff (they can't see admin broadcasts).
create or replace function public.custody_notify_admins(
  p_type text, p_record uuid, p_ar text, p_en text
) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  perform public.custody_notify(null, p_type, p_record, p_ar, p_en);
  for r in select id from public.profiles
            where account_status = 'active' and account_type <> 'admin'
              and staff_role in ('super_admin','manager') loop
    perform public.custody_notify(r.id, p_type, p_record, p_ar, p_en);
  end loop;
end; $$;
revoke execute on function public.custody_notify_admins(text,uuid,text,text) from public, anon, authenticated;

-- ════════ 7) Guarded RPCs ════════════════════════════════════════════════════

-- 7a) Renter self-registration / update (KYC gate before the rental tab opens).
create or replace function public.upsert_renter_profile(
  p_full_name text, p_id_number text, p_phone text, p_email text, p_address text
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not public.is_active() then raise exception 'account not active'; end if;
  if coalesce(nullif(trim(p_full_name),''), null) is null then raise exception 'renter_name_required'; end if;
  if coalesce(nullif(trim(p_id_number),''), null) is null then raise exception 'renter_id_required'; end if;
  if coalesce(nullif(trim(p_phone),''), null)     is null then raise exception 'renter_phone_required'; end if;
  if coalesce(nullif(trim(p_email),''), null)     is null or position('@' in p_email) = 0
    then raise exception 'renter_email_required'; end if;
  if coalesce(nullif(trim(p_address),''), null)   is null then raise exception 'renter_address_required'; end if;
  insert into public.renter_profiles (user_id, full_name, id_number, phone, email, address)
  values (auth.uid(), trim(p_full_name), trim(p_id_number), trim(p_phone), lower(trim(p_email)), trim(p_address))
  on conflict (user_id) do update set
    full_name = excluded.full_name, id_number = excluded.id_number, phone = excluded.phone,
    email = excluded.email, address = excluded.address, updated_at = now();
  return true;
end; $$;
revoke execute on function public.upsert_renter_profile(text,text,text,text,text) from public, anon;
grant  execute on function public.upsert_renter_profile(text,text,text,text,text) to authenticated;

-- Internal: validate an evidence path belongs to (caller, record, stage) AND that
-- the object was ACTUALLY uploaded — prevents pointing records at another user's/
-- record's files, reusing before-photos as after-evidence, or fabricating paths.
create or replace function public.custody_path_ok(p_record uuid, p_path text, p_stage text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_path is not null
     and p_path like (auth.uid()::text || '/' || p_record::text || '/' || p_stage || '/%')
     and exists (select 1 from storage.objects o
                 where o.bucket_id = 'custody-evidence' and o.name = p_path);
$$;
revoke execute on function public.custody_path_ok(uuid,text,text) from public, anon, authenticated;

-- Internal: shared creation core for checkout / rental request.
create or replace function public.custody_create_record(
  p_record uuid, p_kind text, p_party_role text, p_status text, p_ack_type text,
  p_party_name text, p_party_phone text, p_items jsonb, p_overall_before text
) returns text
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_no text; v_pos int := 0; v_count int := 0; v_seq bigint;
begin
  if p_record is null then raise exception 'record_id_required'; end if;
  if exists (select 1 from public.custody_records where id = p_record) then raise exception 'record_exists'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb)) = 0
    then raise exception 'items_required'; end if;
  if not public.custody_path_ok(p_record, p_overall_before, 'before') then raise exception 'overall_photo_required'; end if;

  -- Pad to 4 but NEVER truncate (KM-0001 … KM-9999, then KM-10000+).
  v_seq := nextval('public.custody_record_no_seq');
  v_no := 'KM-' || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');

  insert into public.custody_records
    (id, record_no, kind, party_user_id, party_name, party_phone, party_role, status,
     overall_before_path, ack_signed, ack_signature, ack_signed_at, ack_type, ack_ip)
  values
    (p_record, v_no, p_kind, auth.uid(), p_party_name, p_party_phone, p_party_role, p_status,
     p_overall_before, true, p_party_name, now(), p_ack_type, public.custody_client_ip());

  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(nullif(trim(it->>'name'),''), null) is null then raise exception 'item_name_required'; end if;
    if not public.custody_path_ok(p_record, it->>'photo_before_path', 'before') then raise exception 'item_photo_required'; end if;
    insert into public.custody_items (record_id, name, qty, photo_before_path, position)
    values (p_record, trim(it->>'name'),
            greatest(coalesce((it->>'qty')::int, 1), 1),
            it->>'photo_before_path', v_pos);
    v_pos := v_pos + 1; v_count := v_count + 1;
  end loop;

  return v_no;
end; $$;
revoke execute on function public.custody_create_record(uuid,text,text,text,text,text,text,jsonb,text) from public, anon, authenticated;

-- 7b) Employee checkout — status goes straight to 'out' (signed custody ack).
create or replace function public.submit_checkout(
  p_record uuid, p_items jsonb, p_overall_before text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text; v_phone text; v_no text;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select coalesce(nullif(trim(full_name),''), email), mobile into v_name, v_phone
    from public.profiles where id = auth.uid();
  if v_name is null then raise exception 'profile_name_missing'; end if;

  v_no := public.custody_create_record(p_record, 'custody', 'employee', 'out', 'custody',
                                       v_name, v_phone, p_items, p_overall_before);

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'استلام عهدة — خروج معدات باسم ' || v_name);

  perform public.custody_notify_admins('custody_checkout_new', p_record,
    'عهدة جديدة ' || v_no || ' — استلمها ' || v_name,
    'New custody ' || v_no || ' — taken by ' || v_name);
  perform public.custody_notify(auth.uid(), 'custody_checkout_new', p_record,
    'تم تسجيل عهدتك ' || v_no || ' — أنت مسؤول عنها حتى الإقفال',
    'Your custody ' || v_no || ' is recorded — you are responsible until closure');

  return jsonb_build_object('ok', true, 'record_no', v_no);
end; $$;
revoke execute on function public.submit_checkout(uuid,jsonb,text) from public, anon;
grant  execute on function public.submit_checkout(uuid,jsonb,text) to authenticated;

-- 7c) Renter rental request — status 'review_handover' (signed rental contract).
create or replace function public.submit_rental_request(
  p_record uuid, p_items jsonb, p_overall_before text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_name text; v_phone text; v_no text;
begin
  if not public.is_renter() then raise exception 'renter_registration_required'; end if;
  select full_name, phone into v_name, v_phone from public.renter_profiles where user_id = auth.uid();

  v_no := public.custody_create_record(p_record, 'rental', 'renter', 'review_handover', 'rental_contract',
                                       v_name, v_phone, p_items, p_overall_before);

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'طلب تأجير معدات من ' || v_name || ' — بانتظار اعتماد التسليم');

  perform public.custody_notify_admins('rental_request_new', p_record,
    'طلب تأجير جديد ' || v_no || ' من ' || v_name || ' — بانتظار اعتماد التسليم',
    'New rental request ' || v_no || ' from ' || v_name || ' — awaiting handover approval');
  perform public.custody_notify(auth.uid(), 'rental_request_new', p_record,
    'استلمنا طلب تأجيرك ' || v_no || ' — سيراجعه فريق كيان قبل التسليم',
    'Your rental request ' || v_no || ' was received — Kian will review before handover');

  return jsonb_build_object('ok', true, 'record_no', v_no);
end; $$;
revoke execute on function public.submit_rental_request(uuid,jsonb,text) from public, anon;
grant  execute on function public.submit_rental_request(uuid,jsonb,text) to authenticated;

-- 7d) Party return — after-evidence for EVERY item + overall; → review_return.
create or replace function public.submit_return(
  p_record uuid, p_after jsonb, p_overall_after text, p_shortage boolean, p_note text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; it jsonb;
begin
  select * into r from public.custody_records
   where id = p_record and not is_deleted and party_user_id = auth.uid();
  if not found then raise exception 'record not available'; end if;
  if not ((r.kind = 'custody' and r.status = 'out') or (r.kind = 'rental' and r.status = 'rented'))
    then raise exception 'return_not_allowed_in_status'; end if;
  if not public.custody_path_ok(p_record, p_overall_after, 'after') then raise exception 'overall_after_required'; end if;
  if coalesce(p_shortage, false) and coalesce(nullif(trim(p_note),''), null) is null
    then raise exception 'shortage_note_required'; end if;
  if jsonb_typeof(coalesce(p_after,'[]'::jsonb)) <> 'array' then raise exception 'after_photos_required'; end if;

  for it in select * from jsonb_array_elements(p_after) loop
    if not public.custody_path_ok(p_record, it->>'path', 'after') then raise exception 'item_after_photo_invalid'; end if;
    update public.custody_items set photo_after_path = it->>'path'
     where id = (it->>'item_id')::uuid and record_id = p_record;
  end loop;
  -- Ground truth (duplicate-proof): EVERY item of this record must now carry
  -- an after photo — counters can be gamed with repeated item_ids, this can't.
  if exists (select 1 from public.custody_items
             where record_id = p_record and photo_after_path is null)
    then raise exception 'after_photo_missing_for_items'; end if;

  update public.custody_records set
    status = 'review_return', overall_after_path = p_overall_after,
    shortage = coalesce(p_shortage, false),
    shortage_note = case when coalesce(p_shortage,false) then trim(p_note) else null end,
    updated_at = now()
  where id = p_record;

  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(),
          case when coalesce(p_shortage,false)
               then 'إرجاع — بلاغ نقص/تلف: ' || trim(p_note)
               else 'إرجاع العدة — بانتظار مراجعة الإدارة' end);

  if coalesce(p_shortage, false) then
    perform public.custody_notify_admins('custody_return_shortage', p_record,
      '⚠ إرجاع مع بلاغ نقص/تلف — ' || r.record_no || ' (' || r.party_name || '): ' || trim(p_note),
      '⚠ Return with shortage/damage — ' || r.record_no || ' (' || r.party_name || '): ' || trim(p_note));
  else
    perform public.custody_notify_admins('custody_return_submitted', p_record,
      'إرجاع ' || r.record_no || ' من ' || r.party_name || ' — بانتظار المراجعة والإقفال',
      'Return of ' || r.record_no || ' by ' || r.party_name || ' — awaiting review & closure');
  end if;
  perform public.custody_notify(auth.uid(), 'custody_return_submitted', p_record,
    'استلمنا إرجاعك لـ ' || r.record_no || ' — الإقفال النهائي بعد مراجعة الإدارة',
    'Your return of ' || r.record_no || ' was received — final closure after admin review');

  return true;
end; $$;
revoke execute on function public.submit_return(uuid,jsonb,text,boolean,text) from public, anon;
grant  execute on function public.submit_return(uuid,jsonb,text,boolean,text) to authenticated;

-- 7e) Admin: approve rental handover (review_handover → rented).
create or replace function public.admin_approve_handover(p_record uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.can_manage_custody() then raise exception 'not authorized'; end if;
  select * into r from public.custody_records
   where id = p_record and not is_deleted and kind = 'rental' and status = 'review_handover';
  if not found then raise exception 'record not in review_handover'; end if;

  update public.custody_records set status = 'rented', updated_at = now() where id = p_record;
  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'اعتمدت الإدارة التسليم — المعدات بعهدة المستأجر');
  perform public.custody_notify(r.party_user_id, 'custody_handover_approved', p_record,
    'تم اعتماد تسليم ' || r.record_no || ' — المعدات الآن في عهدتك حسب عقد الإيجار',
    'Handover of ' || r.record_no || ' approved — the equipment is now in your custody per the rental contract');
  return true;
end; $$;
revoke execute on function public.admin_approve_handover(uuid) from public, anon;
grant  execute on function public.admin_approve_handover(uuid) to authenticated;

-- 7f) Admin: close after return review (review_return → closed | flagged-if-shortage).
create or replace function public.admin_close_custody(p_record uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; v_final text;
begin
  if not public.can_manage_custody() then raise exception 'not authorized'; end if;
  select * into r from public.custody_records
   where id = p_record and not is_deleted and status = 'review_return';
  if not found then raise exception 'record not in review_return'; end if;

  v_final := case when r.shortage then 'flagged' else 'closed' end;
  update public.custody_records set status = v_final, updated_at = now() where id = p_record;
  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(),
          case when r.shortage then 'إقفال مع مطالبة — يوجد نقص/تلف موثّق' else 'إقفال العهدة — الإرجاع سليم وكامل' end);
  perform public.custody_notify(r.party_user_id, 'custody_closed', p_record,
    case when r.shortage
         then 'أُقفلت ' || r.record_no || ' مع مطالبة بسبب نقص/تلف — سيتواصل معك فريق كيان'
         else 'أُقفلت عهدتك ' || r.record_no || ' — شكرًا لالتزامك' end,
    case when r.shortage
         then r.record_no || ' closed WITH a claim (shortage/damage) — Kian will contact you'
         else 'Your custody ' || r.record_no || ' is closed — thank you' end);
  return true;
end; $$;
revoke execute on function public.admin_close_custody(uuid) from public, anon;
grant  execute on function public.admin_close_custody(uuid) to authenticated;

-- 7g) Admin: reject a rental request (ONLY from review_handover — approved decision).
create or replace function public.admin_reject_custody(p_record uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; v_note text;
begin
  if not public.can_manage_custody() then raise exception 'not authorized'; end if;
  select * into r from public.custody_records
   where id = p_record and not is_deleted and status = 'review_handover';
  if not found then raise exception 'reject_only_from_review_handover'; end if;

  v_note := coalesce(nullif(trim(p_note),''), 'بدون سبب محدد');
  update public.custody_records set status = 'rejected', admin_note = v_note, updated_at = now()
   where id = p_record;
  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'رفض الطلب: ' || v_note);
  perform public.custody_notify(r.party_user_id, 'custody_rejected', p_record,
    'نعتذر — رُفض طلبك ' || r.record_no || ': ' || v_note,
    'Sorry — your request ' || r.record_no || ' was rejected: ' || v_note);
  return true;
end; $$;
revoke execute on function public.admin_reject_custody(uuid,text) from public, anon;
grant  execute on function public.admin_reject_custody(uuid,text) to authenticated;

-- 7h) Admin: add a note (any live record; note text preserved in the audit trail).
create or replace function public.admin_add_custody_note(p_record uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare r record; v_note text;
begin
  if not public.can_manage_custody() then raise exception 'not authorized'; end if;
  v_note := coalesce(nullif(trim(p_note),''), null);
  if v_note is null then raise exception 'note_required'; end if;
  select * into r from public.custody_records where id = p_record and not is_deleted;
  if not found then raise exception 'record not found'; end if;

  update public.custody_records set admin_note = v_note, updated_at = now() where id = p_record;
  insert into public.custody_events (record_id, actor_user_id, body)
  values (p_record, auth.uid(), 'ملاحظة من الإدارة: ' || v_note);
  perform public.custody_notify(r.party_user_id, 'custody_note_new', p_record,
    'ملاحظة من الإدارة على ' || r.record_no || ': ' || v_note,
    'Admin note on ' || r.record_no || ': ' || v_note);
  return true;
end; $$;
revoke execute on function public.admin_add_custody_note(uuid,text) from public, anon;
grant  execute on function public.admin_add_custody_note(uuid,text) to authenticated;

commit;

-- ════════ 8) Storage — private evidence bucket + policies ════════════════════
-- (outside the transaction: storage schema writes are safe standalone/idempotent)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custody-evidence','custody-evidence', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = 10485760,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Paths are OWNER-FIRST: {user_id}/{record_id}/before|after/... — a party may
-- upload/read only inside their own folder; custody managers read everything.
drop policy if exists "custody evidence read" on storage.objects;
create policy "custody evidence read" on storage.objects for select to authenticated
using (
  bucket_id = 'custody-evidence'
  and (public.can_manage_custody() or (storage.foldername(name))[1] = auth.uid()::text)
);
drop policy if exists "custody evidence upload" on storage.objects;
create policy "custody evidence upload" on storage.objects for insert to authenticated
with check (
  bucket_id = 'custody-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);
-- Deliberately NO update/delete policies → evidence is immutable (append-only).

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run after; each should return the expected value)
-- 1) Tables exist:
select to_regclass('public.renter_profiles')  as renter_profiles,
       to_regclass('public.custody_records')  as custody_records,
       to_regclass('public.custody_items')    as custody_items,
       to_regclass('public.custody_events')   as custody_events;
-- 2) All 8 RPCs + helpers exist:
select proname from pg_proc where proname in
 ('upsert_renter_profile','submit_checkout','submit_rental_request','submit_return',
  'admin_approve_handover','admin_close_custody','admin_reject_custody','admin_add_custody_note',
  'can_manage_custody','is_renter','custody_notify','custody_notify_admins') order by 1;
-- 3) notifications CHECK now includes custody types AND kept the old 20:
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
-- 4) Bucket + policies:
select id, public, file_size_limit from storage.buckets where id = 'custody-evidence';
select policyname from pg_policies where tablename = 'objects' and policyname like 'custody evidence%';
-- 5) RLS on:
select tablename, rowsecurity from pg_tables
 where tablename in ('renter_profiles','custody_records','custody_items','custody_events');
-- ════════════════════════════════════════════════════════════════════════════
