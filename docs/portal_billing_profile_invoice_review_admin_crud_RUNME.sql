-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — Billing profile + invoice review + admin quote/invoice CRUD
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
--
-- ADDS (quote/invoice/billing ONLY — nothing else):
--   • billing_profiles table (individual / business e-invoice data) + RLS + index
--   • quotes.billing_profile_id linkage
--   • invoices review columns: review_status / internal_notes / client_note
--   • invoice_notes table (client ⇄ admin notes on an invoice) + RLS + index
--   • quotes cancel columns: cancelled_at / cancel_reason
--   • RPCs (all SECURITY DEFINER, search_path=public, gated):
--       upsert_client_billing_profile        (client owner OR can_manage_quotes)
--       set_billing_profile_zoho             (service_role — records Zoho sync)
--       accept_quote_with_billing_profile    (client owner OR admin; requires synced profile)
--       admin_update_quote_safe              (can_manage_quotes; blocks accepted/invoiced)
--       admin_set_quote_items_safe           (can_manage_quotes; blocks accepted/invoiced; recomputes totals)
--       admin_soft_delete_or_cancel_quote    (can_manage_quotes; soft-delete draft / cancel accepted)
--       submit_invoice_note                  (client owner OR admin)
--       admin_mark_invoice_note_resolved     (can_see_invoices)
--       admin_update_invoice_review_state    (can_see_invoices)
--       admin_hide_or_soft_delete_invoice    (can_see_invoices; never deletes the Zoho invoice)
--
-- SAFETY:
--   • Idempotent (create-or-replace / if-not-exists / add-column-if-not-exists / drop-policy-if-exists).
--   • Reuses EXISTING helpers only: is_owner(), staff_role(), is_admin(), my_client_id(),
--     my_email(), can_manage_quotes(), can_see_invoices(), resolve_client_id_by_email(), notify().
--   • Does NOT redefine any project/review/deliverable function, nor any existing quote/Zoho
--     RPC, nor any notification-delivery object. No hard deletes. RLS never broadly weakened.
--   • In-app notify() only (no external WhatsApp/email/n8n delivery).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) billing_profiles ═══════════════════════════════════════════════
create table if not exists public.billing_profiles (
  id                uuid primary key default gen_random_uuid(),
  client_id         uuid not null references public.clients(id) on delete cascade,
  customer_type     text not null default 'individual' check (customer_type in ('individual','business')),
  -- shared
  full_name         text,
  email             text,
  phone             text,
  city              text,
  country           text not null default 'Saudi Arabia',
  notes             text,
  -- business
  legal_name        text,   -- اسم المنشأة
  contact_person    text,
  vat_number        text,   -- الرقم الضريبي
  cr_number         text,   -- السجل التجاري
  po_reference      text,
  finance_email     text,
  -- Saudi national address
  building_number   text,
  street            text,
  district          text,
  postal_code       text,
  additional_number text,
  -- Zoho Books contact/customer sync
  zoho_customer_id  text,
  zoho_sync_status  text not null default 'pending' check (zoho_sync_status in ('pending','synced','failed')),
  zoho_sync_error   text,
  zoho_synced_at    timestamptz,
  -- housekeeping
  is_deleted        boolean not null default false,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
-- Idempotent column adds (in case a partial table already exists).
alter table public.billing_profiles add column if not exists customer_type     text not null default 'individual';
alter table public.billing_profiles add column if not exists full_name         text;
alter table public.billing_profiles add column if not exists email             text;
alter table public.billing_profiles add column if not exists phone             text;
alter table public.billing_profiles add column if not exists city              text;
alter table public.billing_profiles add column if not exists country           text not null default 'Saudi Arabia';
alter table public.billing_profiles add column if not exists notes             text;
alter table public.billing_profiles add column if not exists legal_name        text;
alter table public.billing_profiles add column if not exists contact_person    text;
alter table public.billing_profiles add column if not exists vat_number        text;
alter table public.billing_profiles add column if not exists cr_number         text;
alter table public.billing_profiles add column if not exists po_reference      text;
alter table public.billing_profiles add column if not exists finance_email     text;
alter table public.billing_profiles add column if not exists building_number   text;
alter table public.billing_profiles add column if not exists street            text;
alter table public.billing_profiles add column if not exists district          text;
alter table public.billing_profiles add column if not exists postal_code       text;
alter table public.billing_profiles add column if not exists additional_number text;
alter table public.billing_profiles add column if not exists zoho_customer_id  text;
alter table public.billing_profiles add column if not exists zoho_sync_status  text not null default 'pending';
alter table public.billing_profiles add column if not exists zoho_sync_error   text;
alter table public.billing_profiles add column if not exists zoho_synced_at    timestamptz;
alter table public.billing_profiles add column if not exists is_deleted        boolean not null default false;

-- One active billing profile per client.
create unique index if not exists uq_billing_profiles_client on public.billing_profiles(client_id) where is_deleted = false;

alter table public.billing_profiles enable row level security;
grant select on public.billing_profiles to authenticated;
drop policy if exists billing_profiles_read on public.billing_profiles;
create policy billing_profiles_read on public.billing_profiles for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes() or public.can_see_invoices() or client_id = public.my_client_id()
  )
);

-- ════════ 2) quotes.billing_profile_id + cancel columns ═════════════════════
alter table public.quotes add column if not exists billing_profile_id uuid references public.billing_profiles(id) on delete set null;
alter table public.quotes add column if not exists cancelled_at timestamptz;
alter table public.quotes add column if not exists cancel_reason text;

-- ════════ 3) invoices review columns ════════════════════════════════════════
alter table public.invoices add column if not exists review_status text not null default 'draft'
  check (review_status in ('draft','in_review','awaiting_client_notes','ready_to_issue','issued','cancelled'));
alter table public.invoices add column if not exists internal_notes text;
alter table public.invoices add column if not exists client_note    text;

-- ════════ 4) invoice_notes ══════════════════════════════════════════════════
create table if not exists public.invoice_notes (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.invoices(id) on delete cascade,
  author_id    uuid references auth.users(id) on delete set null,
  author_role  text not null default 'client' check (author_role in ('client','admin')),
  body         text not null,
  is_resolved  boolean not null default false,
  resolved_by  uuid references auth.users(id) on delete set null,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists idx_invoice_notes_invoice on public.invoice_notes(invoice_id, created_at);
alter table public.invoice_notes enable row level security;
grant select on public.invoice_notes to authenticated;
drop policy if exists invoice_notes_read on public.invoice_notes;
create policy invoice_notes_read on public.invoice_notes for select to authenticated using (
  public.can_see_invoices() or exists (
    select 1 from public.invoices i
     where i.id = invoice_id and not i.is_deleted
       and i.client_id = public.my_client_id() and i.public_portal_visible
  )
);

-- ════════ 5) RPCs ═══════════════════════════════════════════════════════════

-- 5a) Upsert the client's billing profile (from the accept-quote flow). Client owner
--     of the quote OR a quote-manager may call it. Validates by customer_type, links the
--     quote, and marks the Zoho sync as pending. Returns the profile context as jsonb.
create or replace function public.upsert_client_billing_profile(
  p_quote uuid, p_type text,
  p_full_name text default null, p_email text default null, p_phone text default null,
  p_city text default null, p_country text default null, p_notes text default null,
  p_legal_name text default null, p_contact_person text default null,
  p_vat_number text default null, p_cr_number text default null,
  p_po_reference text default null, p_finance_email text default null,
  p_building_number text default null, p_street text default null, p_district text default null,
  p_postal_code text default null, p_additional_number text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_qemail text; v_owner boolean; v_profile uuid; v_existing_zoho text;
begin
  -- Resolve the quote + its client, and verify caller may act on it.
  select client_id, email into v_client, v_qemail from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;

  v_owner := (v_client is not null and v_client = public.my_client_id())
             or (v_qemail is not null and lower(v_qemail) = lower(coalesce(public.my_email(),'__none__')));
  if not (v_owner or public.can_manage_quotes()) then raise exception 'not authorized'; end if;

  -- The billing profile needs a client row. Prefer the quote's client, else the caller's.
  v_client := coalesce(v_client, public.my_client_id(), public.resolve_client_id_by_email(coalesce(v_qemail, public.my_email())));
  if v_client is null then raise exception 'no_client_context'; end if;

  if p_type not in ('individual','business') then raise exception 'invalid_customer_type'; end if;

  -- Validation by type (authoritative — the UI validates too).
  if p_type = 'individual' then
    if coalesce(nullif(trim(p_full_name),''), null) is null then raise exception 'individual_name_required'; end if;
    if coalesce(nullif(trim(p_email),''), nullif(trim(p_phone),'')) is null then raise exception 'individual_contact_required'; end if;
  else
    if coalesce(nullif(trim(p_legal_name),''), null) is null then raise exception 'business_legal_name_required'; end if;
    if coalesce(nullif(trim(p_vat_number),''), null) is null then raise exception 'business_vat_required'; end if;
    if coalesce(nullif(trim(p_building_number),''), null) is null
       or coalesce(nullif(trim(p_street),''), null) is null
       or coalesce(nullif(trim(p_district),''), null) is null
       or coalesce(nullif(trim(p_city),''), null) is null
       or coalesce(nullif(trim(p_postal_code),''), null) is null
      then raise exception 'business_address_required'; end if;
  end if;

  -- Preserve any existing Zoho customer id so we UPDATE rather than duplicate the contact.
  select id, zoho_customer_id into v_profile, v_existing_zoho
    from public.billing_profiles where client_id = v_client and not is_deleted limit 1;

  if v_profile is null then
    insert into public.billing_profiles (
      client_id, customer_type, full_name, email, phone, city, country, notes,
      legal_name, contact_person, vat_number, cr_number, po_reference, finance_email,
      building_number, street, district, postal_code, additional_number,
      zoho_sync_status, created_by)
    values (
      v_client, p_type, nullif(trim(p_full_name),''), nullif(trim(p_email),''), nullif(trim(p_phone),''),
      nullif(trim(p_city),''), coalesce(nullif(trim(p_country),''),'Saudi Arabia'), nullif(trim(p_notes),''),
      nullif(trim(p_legal_name),''), nullif(trim(p_contact_person),''), nullif(trim(p_vat_number),''),
      nullif(trim(p_cr_number),''), nullif(trim(p_po_reference),''), nullif(trim(p_finance_email),''),
      nullif(trim(p_building_number),''), nullif(trim(p_street),''), nullif(trim(p_district),''),
      nullif(trim(p_postal_code),''), nullif(trim(p_additional_number),''),
      'pending', auth.uid())
    returning id into v_profile;
  else
    update public.billing_profiles set
      customer_type = p_type,
      full_name = nullif(trim(p_full_name),''), email = nullif(trim(p_email),''), phone = nullif(trim(p_phone),''),
      city = nullif(trim(p_city),''), country = coalesce(nullif(trim(p_country),''),'Saudi Arabia'), notes = nullif(trim(p_notes),''),
      legal_name = nullif(trim(p_legal_name),''), contact_person = nullif(trim(p_contact_person),''),
      vat_number = nullif(trim(p_vat_number),''), cr_number = nullif(trim(p_cr_number),''),
      po_reference = nullif(trim(p_po_reference),''), finance_email = nullif(trim(p_finance_email),''),
      building_number = nullif(trim(p_building_number),''), street = nullif(trim(p_street),''),
      district = nullif(trim(p_district),''), postal_code = nullif(trim(p_postal_code),''),
      additional_number = nullif(trim(p_additional_number),''),
      zoho_sync_status = 'pending', zoho_sync_error = null, updated_at = now()
    where id = v_profile;
  end if;

  update public.quotes set billing_profile_id = v_profile, updated_at = now() where id = p_quote;

  return jsonb_build_object(
    'profile_id', v_profile, 'client_id', v_client, 'customer_type', p_type,
    'zoho_customer_id', v_existing_zoho,
    'email', nullif(trim(p_email),''), 'phone', nullif(trim(p_phone),''),
    'name', coalesce(nullif(trim(p_legal_name),''), nullif(trim(p_full_name),'')),
    'contact_person', nullif(trim(p_contact_person),''),
    'vat_number', nullif(trim(p_vat_number),''), 'cr_number', nullif(trim(p_cr_number),''),
    'city', nullif(trim(p_city),''), 'country', coalesce(nullif(trim(p_country),''),'Saudi Arabia'),
    'building_number', nullif(trim(p_building_number),''), 'street', nullif(trim(p_street),''),
    'district', nullif(trim(p_district),''), 'postal_code', nullif(trim(p_postal_code),''),
    'additional_number', nullif(trim(p_additional_number),''));
end; $$;
revoke execute on function public.upsert_client_billing_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
grant  execute on function public.upsert_client_billing_profile(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

-- 5b) Record the Zoho contact/customer sync result (called by the server route with the
--     service key AFTER it upserts the Zoho contact). Also mirrors the customer id onto the quote.
create or replace function public.set_billing_profile_zoho(
  p_profile uuid, p_customer_id text, p_status text, p_error text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if p_status not in ('pending','synced','failed') then raise exception 'invalid_status'; end if;
  update public.billing_profiles set
    zoho_customer_id = coalesce(nullif(trim(p_customer_id),''), zoho_customer_id),
    zoho_sync_status = p_status,
    zoho_sync_error  = nullif(trim(p_error),''),
    zoho_synced_at   = case when p_status = 'synced' then now() else zoho_synced_at end,
    updated_at = now()
  where id = p_profile
  returning client_id into v_client;
  if not found then raise exception 'profile not found'; end if;
  -- Keep future invoices pointing at the right Zoho customer.
  if p_status = 'synced' and nullif(trim(p_customer_id),'') is not null and v_client is not null then
    update public.quotes set zoho_customer_id = p_customer_id
     where billing_profile_id = p_profile and coalesce(zoho_customer_id,'') = '';
  end if;
  return true;
end; $$;
revoke execute on function public.set_billing_profile_zoho(uuid,text,text,text) from public, anon, authenticated;
grant  execute on function public.set_billing_profile_zoho(uuid,text,text,text) to service_role;

-- 5c) Mark the quote accepted — ONLY when a Zoho-synced billing profile exists. This is the
--     DB-level gate: acceptance cannot happen before billing + Zoho succeed. Mirrors the
--     accept branch of client_respond_quote (same ownership + visibility + non-empty rules).
create or replace function public.accept_quote_with_billing_profile(p_quote uuid, p_note text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text; v_bp uuid; v_sync text; r record;
begin
  select billing_profile_id into v_bp from public.quotes q
   where q.id = p_quote and not q.is_deleted
     and (q.client_id = public.my_client_id() or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')) or public.can_manage_quotes())
     and (q.public_portal_visible or q.status in ('sent','accepted'))
     and q.total > 0 and exists (select 1 from public.quote_items qi where qi.quote_id = q.id);
  if not found then raise exception 'quote not available'; end if;
  if v_bp is null then raise exception 'billing_profile_missing'; end if;
  select zoho_sync_status into v_sync from public.billing_profiles where id = v_bp and not is_deleted;
  if coalesce(v_sync,'') <> 'synced' then raise exception 'billing_not_synced'; end if;

  update public.quotes set client_response = 'accepted', status = 'accepted', public_portal_visible = true,
         invoice_approval_status = case when invoice_approval_status in ('none','invoice_creation_failed')
                                        then 'invoice_approval_pending' else invoice_approval_status end,
         updated_at = now()
   where id = p_quote returning coalesce(estimate_number, quote_number) into v_num;

  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.quote_revision_requests (quote_id, author_id, note) values (p_quote, auth.uid(), trim(p_note));
  end if;

  perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote,
                        'قبل العميل العرض (مع بيانات الفاتورة): ' || coalesce(v_num,''),
                        'Client accepted quote (with billing details): ' || coalesce(v_num,''));
  for r in select id from public.profiles where account_status = 'active'
            and (account_type = 'admin' or staff_role in ('manager','super_admin','finance')) loop
    perform public.notify(r.id, 'user', 'invoice_approval_required', 'quote', p_quote,
                          'موافقة على إنشاء فاتورة ضريبية مطلوبة: ' || coalesce(v_num,''),
                          'Tax invoice approval required: ' || coalesce(v_num,''));
  end loop;
  return true;
end; $$;
revoke execute on function public.accept_quote_with_billing_profile(uuid,text) from public, anon;
grant  execute on function public.accept_quote_with_billing_profile(uuid,text) to authenticated;

-- 5d) Safe quote META edit (title/notes/valid_until/visibility). Blocked once the client
--     accepted or an invoice exists → caller must use a revision/cancel flow instead.
create or replace function public.admin_update_quote_safe(
  p_quote uuid, p_title text default null, p_notes text default null,
  p_valid_until date default null, p_visible boolean default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_status text; v_resp text; v_inv int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select status, client_response into v_status, v_resp from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;
  select count(*) into v_inv from public.invoices where quote_id = p_quote and not is_deleted;
  if v_status = 'accepted' or v_resp = 'accepted' or v_inv > 0 then raise exception 'quote_locked'; end if;
  update public.quotes set
    title = coalesce(nullif(trim(p_title),''), title),
    notes = coalesce(p_notes, notes),
    valid_until = coalesce(p_valid_until, valid_until),
    public_portal_visible = coalesce(p_visible, public_portal_visible),
    updated_at = now()
  where id = p_quote;
  return true;
end; $$;
revoke execute on function public.admin_update_quote_safe(uuid,text,text,date,boolean) from public, anon;
grant  execute on function public.admin_update_quote_safe(uuid,text,text,date,boolean) to authenticated;

-- 5e) Safe line-item edit (recomputes totals) — blocked once accepted/invoiced.
create or replace function public.admin_set_quote_items_safe(p_quote uuid, p_items jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_pos int := 0; v_sub numeric(14,2) := 0; v_rate numeric(5,2); v_line numeric(14,2);
        v_status text; v_resp text; v_inv int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select status, client_response into v_status, v_resp from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;
  select count(*) into v_inv from public.invoices where quote_id = p_quote and not is_deleted;
  if v_status = 'accepted' or v_resp = 'accepted' or v_inv > 0 then raise exception 'quote_locked'; end if;
  delete from public.quote_items where quote_id = p_quote;
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_line := round(coalesce((it->>'quantity')::numeric,1) * coalesce((it->>'unit_price')::numeric,0), 2);
    insert into public.quote_items (quote_id, title, description, quantity, unit_price, total, position)
    values (p_quote, coalesce(nullif(it->>'title',''),'-'), nullif(it->>'description',''),
            coalesce((it->>'quantity')::numeric,1), coalesce((it->>'unit_price')::numeric,0), v_line, v_pos);
    v_sub := v_sub + v_line; v_pos := v_pos + 1;
  end loop;
  select vat_rate into v_rate from public.quotes where id = p_quote;
  update public.quotes set subtotal = v_sub, vat = round(v_sub * coalesce(v_rate,15) / 100, 2),
         total = v_sub + round(v_sub * coalesce(v_rate,15) / 100, 2), updated_at = now()
   where id = p_quote;
  return true;
end; $$;
revoke execute on function public.admin_set_quote_items_safe(uuid,jsonb) from public, anon;
grant  execute on function public.admin_set_quote_items_safe(uuid,jsonb) to authenticated;

-- 5f) Soft-delete a draft quote, or CANCEL (hide, keep record) an accepted/invoiced one.
--     Never hard-deletes; never touches the Zoho estimate/invoice. Returns the action taken.
create or replace function public.admin_soft_delete_or_cancel_quote(p_quote uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_status text; v_resp text; v_inv int; v_num text; v_action text;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select status, client_response, quote_number into v_status, v_resp, v_num
    from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;
  select count(*) into v_inv from public.invoices where quote_id = p_quote and not is_deleted;

  if v_status = 'accepted' or v_resp = 'accepted' or v_inv > 0 then
    -- Safe cancel: keep the record for audit, hide from the client.
    update public.quotes set cancelled_at = now(), cancel_reason = nullif(trim(p_reason),''),
           public_portal_visible = false, updated_at = now()
     where id = p_quote;
    v_action := 'cancelled';
  else
    -- Draft/unaccepted: soft-delete.
    update public.quotes set is_deleted = true, public_portal_visible = false,
           cancel_reason = nullif(trim(p_reason),''), updated_at = now()
     where id = p_quote;
    v_action := 'deleted';
  end if;

  insert into public.quote_revision_requests (quote_id, author_id, note)
  values (p_quote, auth.uid(), '[' || v_action || '] ' || coalesce(nullif(trim(p_reason),''),'—'));
  perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote,
                        'تم ' || case when v_action='cancelled' then 'إلغاء' else 'حذف' end || ' العرض: ' || coalesce(v_num,''),
                        'Quote ' || v_action || ': ' || coalesce(v_num,''));
  return jsonb_build_object('ok', true, 'action', v_action);
end; $$;
revoke execute on function public.admin_soft_delete_or_cancel_quote(uuid,text) from public, anon;
grant  execute on function public.admin_soft_delete_or_cancel_quote(uuid,text) to authenticated;

-- 5g) Submit a note on an invoice (client owner or admin/finance). Author role is derived.
create or replace function public.submit_invoice_note(p_invoice uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_admin boolean; v_ok boolean; v_note uuid; v_num text;
begin
  if coalesce(nullif(trim(p_body),''), null) is null then raise exception 'empty_note'; end if;
  v_admin := public.can_see_invoices();
  if v_admin then
    if not exists (select 1 from public.invoices where id = p_invoice and not is_deleted) then raise exception 'invoice not found'; end if;
  else
    select true into v_ok from public.invoices
      where id = p_invoice and not is_deleted and client_id = public.my_client_id() and public_portal_visible;
    if not found then raise exception 'not authorized'; end if;
  end if;
  insert into public.invoice_notes (invoice_id, author_id, author_role, body)
  values (p_invoice, auth.uid(), case when v_admin then 'admin' else 'client' end, trim(p_body))
  returning id into v_note;
  -- In-app notify the finance team when a CLIENT leaves a note (no external delivery).
  if not v_admin then
    select invoice_number into v_num from public.invoices where id = p_invoice;
    perform public.notify(null, 'admin', 'invoice_visible', 'invoice', p_invoice,
                          'ملاحظة عميل على الفاتورة: ' || coalesce(v_num,''),
                          'Client note on invoice: ' || coalesce(v_num,''));
  end if;
  return v_note;
end; $$;
revoke execute on function public.submit_invoice_note(uuid,text) from public, anon;
grant  execute on function public.submit_invoice_note(uuid,text) to authenticated;

-- 5h) Resolve / unresolve a client invoice note (finance/admin).
create or replace function public.admin_mark_invoice_note_resolved(p_note uuid, p_resolved boolean default true)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_invoices() then raise exception 'not authorized'; end if;
  update public.invoice_notes set
    is_resolved = coalesce(p_resolved, true),
    resolved_by = case when coalesce(p_resolved,true) then auth.uid() else null end,
    resolved_at = case when coalesce(p_resolved,true) then now() else null end
  where id = p_note;
  if not found then raise exception 'note not found'; end if;
  return true;
end; $$;
revoke execute on function public.admin_mark_invoice_note_resolved(uuid,boolean) from public, anon;
grant  execute on function public.admin_mark_invoice_note_resolved(uuid,boolean) to authenticated;

-- 5i) Update portal invoice review metadata (status / internal + client note / visibility).
--     Portal metadata only — never edits the official Zoho invoice.
create or replace function public.admin_update_invoice_review_state(
  p_invoice uuid, p_review_status text default null, p_internal_notes text default null,
  p_client_note text default null, p_visible boolean default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_invoices() then raise exception 'not authorized'; end if;
  if p_review_status is not null and p_review_status not in
     ('draft','in_review','awaiting_client_notes','ready_to_issue','issued','cancelled')
    then raise exception 'invalid_review_status'; end if;
  update public.invoices set
    review_status = coalesce(p_review_status, review_status),
    internal_notes = coalesce(p_internal_notes, internal_notes),
    client_note = coalesce(p_client_note, client_note),
    public_portal_visible = coalesce(p_visible, public_portal_visible),
    updated_at = now()
  where id = p_invoice and not is_deleted;
  if not found then raise exception 'invoice not found'; end if;
  return true;
end; $$;
revoke execute on function public.admin_update_invoice_review_state(uuid,text,text,text,boolean) from public, anon;
grant  execute on function public.admin_update_invoice_review_state(uuid,text,text,text,boolean) to authenticated;

-- 5j) Hide / unhide / soft-delete a portal invoice record. Never deletes the Zoho invoice.
create or replace function public.admin_hide_or_soft_delete_invoice(p_invoice uuid, p_action text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_see_invoices() then raise exception 'not authorized'; end if;
  if p_action not in ('hide','unhide','soft_delete') then raise exception 'invalid_action'; end if;
  if p_action = 'soft_delete' then
    update public.invoices set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(),
           public_portal_visible = false, updated_at = now()
     where id = p_invoice and not is_deleted;
  else
    update public.invoices set public_portal_visible = (p_action = 'unhide'), updated_at = now()
     where id = p_invoice and not is_deleted;
  end if;
  if not found then raise exception 'invoice not found'; end if;
  return true;
end; $$;
revoke execute on function public.admin_hide_or_soft_delete_invoice(uuid,text) from public, anon;
grant  execute on function public.admin_hide_or_soft_delete_invoice(uuid,text) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run after; all should succeed)
--   select to_regclass('public.billing_profiles'), to_regclass('public.invoice_notes');
--   select column_name from information_schema.columns
--    where table_name='invoices' and column_name in ('review_status','internal_notes','client_note') order by 1;
--   select column_name from information_schema.columns
--    where table_name='quotes' and column_name in ('billing_profile_id','cancelled_at','cancel_reason') order by 1;
--   -- all new RPCs present (should return 10 rows):
--   select proname from pg_proc where proname in (
--     'upsert_client_billing_profile','set_billing_profile_zoho','accept_quote_with_billing_profile',
--     'admin_update_quote_safe','admin_set_quote_items_safe','admin_soft_delete_or_cancel_quote',
--     'submit_invoice_note','admin_mark_invoice_note_resolved','admin_update_invoice_review_state',
--     'admin_hide_or_soft_delete_invoice') order by 1;
--   -- RLS present on new tables:
--   select tablename, policyname from pg_policies where tablename in ('billing_profiles','invoice_notes') order by 1;
--   -- existing quote/invoice/project functions still intact (not redefined here):
--   select proname from pg_proc where proname in
--    ('client_respond_quote','approve_invoice_creation','upsert_zoho_invoice','notify','set_quote_items') order by 1;
-- ════════════════════════════════════════════════════════════════════════════
