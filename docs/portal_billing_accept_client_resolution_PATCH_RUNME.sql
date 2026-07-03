-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — PATCH: billing-acceptance client resolution
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
--
-- BUG: a client who can SEE a quote by EMAIL match (public/guest-request origin,
-- quotes.client_id still NULL, and no clients row yet for their auth user) could
-- not accept it — upsert_client_billing_profile raised 'no_client_context' because
-- my_client_id() / resolve_client_id_by_email() require a pre-existing clients row.
--
-- FIX: a safe SECURITY DEFINER helper ensure_my_client_id() that resolves the
-- caller's own client row — claiming a pending (unlinked, real-email) row matched by
-- the caller's VERIFIED email, or creating a fresh one — then re-create
-- upsert_client_billing_profile + accept_quote_with_billing_profile to use ownership
-- by (client match OR verified-email match OR manager) and attach to the caller's
-- OWN client. A user can still never act on another customer's quote.
--
-- Only touches quote/billing acceptance. No WhatsApp/email/n8n/media. Reuses existing
-- helpers (my_client_id, my_email, can_manage_quotes, resolve_client_id_by_email,
-- gen_pending_email, notify). Redefines only the two billing RPCs added by
-- docs/portal_billing_profile_invoice_review_admin_crud_RUNME.sql (same signatures).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ── ensure_my_client_id(): resolve/claim/create the CALLER's own client row ──
create or replace function public.ensure_my_client_id() returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_email text; v_name text; v_client uuid;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'not authenticated'; end if;

  -- 1) An existing client row already linked to this user.
  select id into v_client from public.clients
   where user_id = v_uid and is_deleted = false order by created_at limit 1;
  if v_client is not null then return v_client; end if;

  select email, full_name into v_email, v_name from public.profiles where id = v_uid;
  v_email := lower(trim(coalesce(v_email, '')));

  -- 2) Claim a pending (unlinked, real-email) client row that matches the verified email.
  if v_email <> '' then
    update public.clients set user_id = v_uid, updated_at = now()
     where user_id is null and is_deleted = false and coalesce(email_is_placeholder,false) = false
       and lower(coalesce(email,'')) = v_email
     returning id into v_client;
    if v_client is not null then
      update public.profiles set account_type = 'client' where id = v_uid and account_type = 'lead';
      return v_client;
    end if;
  end if;

  -- 3) Create a fresh client row for this user (mirrors the existing intake pattern).
  insert into public.clients (user_id, full_name, email, email_is_placeholder)
  values (v_uid, nullif(trim(coalesce(v_name,'')),''),
          coalesce(nullif(v_email,''), public.gen_pending_email()), (v_email = ''))
  returning id into v_client;
  update public.profiles set account_type = 'client' where id = v_uid and account_type = 'lead';
  return v_client;
end; $$;
revoke execute on function public.ensure_my_client_id() from public, anon;
grant  execute on function public.ensure_my_client_id() to authenticated;

-- ── upsert_client_billing_profile(): robust ownership + client resolution ──
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
declare v_qclient uuid; v_qemail text; v_self uuid; v_attach uuid; v_owner_self boolean;
        v_profile uuid; v_existing_zoho text;
begin
  select client_id, email into v_qclient, v_qemail from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;

  -- The caller's own client row (if any), WITHOUT the account_type filter my_client_id uses.
  select id into v_self from public.clients where user_id = auth.uid() and is_deleted = false order by created_at limit 1;

  v_owner_self := (v_qclient is not null and v_qclient = v_self)
                  or (v_qemail is not null and lower(v_qemail) = lower(coalesce(public.my_email(),'__none__')));

  if v_owner_self then
    -- Caller is the client → attach to their OWN row (create/claim it if missing).
    v_attach := public.ensure_my_client_id();
  elsif public.can_manage_quotes() then
    -- Staff acting on behalf → use the quote's client (or resolve by the quote's email).
    v_attach := coalesce(v_qclient, public.resolve_client_id_by_email(v_qemail));
    if v_attach is null then raise exception 'no_client_context'; end if;
  else
    raise exception 'not_owner';
  end if;

  if p_type not in ('individual','business') then raise exception 'invalid_customer_type'; end if;
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

  -- Link the quote to the resolved client if it was email-only.
  update public.quotes set client_id = coalesce(client_id, v_attach), updated_at = now() where id = p_quote;

  select id, zoho_customer_id into v_profile, v_existing_zoho
    from public.billing_profiles where client_id = v_attach and not is_deleted limit 1;

  if v_profile is null then
    insert into public.billing_profiles (
      client_id, customer_type, full_name, email, phone, city, country, notes,
      legal_name, contact_person, vat_number, cr_number, po_reference, finance_email,
      building_number, street, district, postal_code, additional_number, zoho_sync_status, created_by)
    values (
      v_attach, p_type, nullif(trim(p_full_name),''), nullif(trim(p_email),''), nullif(trim(p_phone),''),
      nullif(trim(p_city),''), coalesce(nullif(trim(p_country),''),'Saudi Arabia'), nullif(trim(p_notes),''),
      nullif(trim(p_legal_name),''), nullif(trim(p_contact_person),''), nullif(trim(p_vat_number),''),
      nullif(trim(p_cr_number),''), nullif(trim(p_po_reference),''), nullif(trim(p_finance_email),''),
      nullif(trim(p_building_number),''), nullif(trim(p_street),''), nullif(trim(p_district),''),
      nullif(trim(p_postal_code),''), nullif(trim(p_additional_number),''), 'pending', auth.uid())
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
    'profile_id', v_profile, 'client_id', v_attach, 'customer_type', p_type,
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

-- ── accept_quote_with_billing_profile(): ownership by self-client OR verified email OR manager ──
create or replace function public.accept_quote_with_billing_profile(p_quote uuid, p_note text default null)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text; v_bp uuid; v_sync text; v_self uuid; r record;
begin
  select id into v_self from public.clients where user_id = auth.uid() and is_deleted = false order by created_at limit 1;

  select billing_profile_id into v_bp from public.quotes q
   where q.id = p_quote and not q.is_deleted
     and (public.can_manage_quotes()
          or (q.client_id is not null and q.client_id = v_self)
          or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
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

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
--   select proname from pg_proc where proname in
--     ('ensure_my_client_id','upsert_client_billing_profile','accept_quote_with_billing_profile') order by 1;
--   -- As the affected client (or check the row): after clicking Accept the client should
--   -- now have a clients row; confirm no 'no_client_context':
--   --   select id, user_id, email from public.clients where user_id = '<auth_user_id>';
--   -- Security: a quote whose email/client belongs to someone else must still raise
--   -- 'not_owner' for a non-manager caller.
-- ════════════════════════════════════════════════════════════════════════════
