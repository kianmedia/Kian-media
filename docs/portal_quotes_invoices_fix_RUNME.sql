-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Quotes & Invoices corrective patch. ADDITIVE + REVERSIBLE.
--
--   1. Link formal quotes to quote_requests (convert flow + client_id resolution).
--   2. Pending-requests feed for the admin quotes screen.
--   3. Block sending / showing an EMPTY or ZERO-total quote (RPC + RLS hardening).
--   4. Zoho Books invoice READ-ONLY upsert (no official invoice is ever created here).
--
-- Depends on: docs/portal_quotes_invoices_RUNME.sql (already run — quotes/quote_items/
-- invoices + can_manage_quotes()/can_see_invoices()) + phase0 (quote_requests, clients,
-- profiles, my_client_id(), notify()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- DEPLOY ORDER: run THIS SQL **before** deploying the updated code — create_quote is
-- widened (now takes p_title) and the convert/pending/Zoho-sync RPCs are new, so the
-- updated UI calls them; an old DB without this patch would 404 those calls.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Additive columns ════════════════════════════════════════════════
alter table public.quotes   add column if not exists title  text;
alter table public.invoices add column if not exists zoho_customer_id text;
alter table public.invoices add column if not exists source text not null default 'manual';  -- 'manual' | 'zoho'
grant execute on function public.can_see_invoices() to authenticated;  -- callable by the sync route gate

-- ════════ 2) client_id resolution by email (RLS-safe; SECURITY DEFINER) ══════
create or replace function public.resolve_client_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clients c join public.profiles p on p.id = c.user_id
  where p_email is not null and lower(p.email) = lower(p_email) and c.is_deleted = false
  limit 1;
$$;
revoke execute on function public.resolve_client_id_by_email(text) from public, anon;
grant  execute on function public.resolve_client_id_by_email(text) to authenticated, service_role;

-- ════════ 3) Harden quotes_read RLS — a client never sees an empty/zero quote ═
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes()
    or (client_id = public.my_client_id()
        and (public_portal_visible or status in ('sent','accepted'))
        and total > 0
        and exists (select 1 from public.quote_items qi where qi.quote_id = quotes.id))
  ));

-- ════════ 4) Widen create_quote with a title (drop the prior 7-arg) ══════════
drop function if exists public.create_quote(uuid, uuid, uuid, date, text, numeric, text);
create or replace function public.create_quote(
  p_client uuid, p_project uuid, p_quote_request uuid, p_valid_until date, p_currency text, p_vat_rate numeric, p_notes text,
  p_title text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  v_num := 'Q-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 5, '0');
  insert into public.quotes (quote_number, client_id, project_id, quote_request_id, title, valid_until, currency, vat_rate, notes, created_by)
  values (v_num, p_client, p_project, p_quote_request, nullif(p_title,''), p_valid_until,
          coalesce(nullif(p_currency,''),'SAR'), coalesce(p_vat_rate,15), nullif(p_notes,''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'quote_number', v_num);
end; $$;
revoke execute on function public.create_quote(uuid,uuid,uuid,date,text,numeric,text,text) from public, anon;
grant  execute on function public.create_quote(uuid,uuid,uuid,date,text,numeric,text,text) to authenticated;

-- ════════ 5) Convert a quote_request → formal quote (prefilled + linked) ══════
create or replace function public.convert_quote_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req record; v_email text; v_client uuid; v_id uuid; v_num text; v_title text;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select qr.id, qr.user_id, qr.services, qr.description, coalesce(qr.is_deleted,false) as del
    into v_req from public.quote_requests qr where qr.id = p_request;
  if not found or v_req.del then raise exception 'request not found'; end if;
  select email into v_email from public.profiles where id = v_req.user_id;
  -- client_id: (a) membership via the request's user, else (b) email match.
  select id into v_client from public.clients where user_id = v_req.user_id and is_deleted = false limit 1;
  if v_client is null then v_client := public.resolve_client_id_by_email(v_email); end if;
  -- Reuse an existing draft quote already linked to this request (don't duplicate).
  select id, quote_number into v_id, v_num from public.quotes
   where quote_request_id = p_request and not is_deleted and status in ('draft','internal_review')
   order by created_at desc limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'quote_number', v_num, 'reused', true); end if;
  v_title := coalesce(nullif(array_to_string(v_req.services, '، '),''), 'عرض سعر');
  v_num := 'Q-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 5, '0');
  insert into public.quotes (quote_number, client_id, lead_id, quote_request_id, title, notes, currency, vat_rate, created_by)
  values (v_num, v_client, v_req.user_id, p_request, v_title, nullif(v_req.description,''), 'SAR', 15, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'quote_number', v_num, 'client_id', v_client, 'reused', false);
end; $$;
revoke execute on function public.convert_quote_request(uuid) from public, anon;
grant  execute on function public.convert_quote_request(uuid) to authenticated;

-- ════════ 6) Pending quote_requests awaiting pricing (for the admin screen) ══
create or replace function public.list_pending_quote_requests()
returns table (id uuid, reference text, services text[], email text, city text, budget_range text,
               status text, created_at timestamptz, has_quote boolean)
language sql stable security definer set search_path = public as $$
  select qr.id, qr.reference, qr.services, p.email, qr.city, qr.budget_range, qr.status, qr.created_at,
         exists (select 1 from public.quotes q where q.quote_request_id = qr.id and not q.is_deleted)
  from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
  where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
    and qr.status in ('new','in_review','quoted')
  order by qr.created_at desc;
$$;
revoke execute on function public.list_pending_quote_requests() from public, anon;
grant  execute on function public.list_pending_quote_requests() to authenticated;

-- ════════ 7) Guard: no EMPTY/ZERO quote may be sent/accepted/made visible ════
create or replace function public.set_quote_status(p_quote uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text; v_total numeric; v_items int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  if p_status not in ('draft','internal_review','approved','sent','accepted','rejected','expired') then raise exception 'invalid status'; end if;
  if p_status in ('sent','accepted') then
    select total, (select count(*) from public.quote_items qi where qi.quote_id = p_quote) into v_total, v_items from public.quotes where id = p_quote;
    if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then
      raise exception 'empty_or_zero_quote';  -- add line items with a total > 0 first
    end if;
  end if;
  update public.quotes set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         public_portal_visible = case when p_status in ('sent','accepted') then true else public_portal_visible end,
         updated_at = now()
   where id = p_quote and not is_deleted
   returning client_id, quote_number into v_client, v_num;
  if not found then raise exception 'quote not found'; end if;
  if p_status = 'sent' then
    select user_id into v_uid from public.clients where id = v_client;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote, 'عرض سعر جديد جاهز: ' || coalesce(v_num,''), 'A new quote is ready: ' || coalesce(v_num,''));
    end if;
  end if;
  return true;
end; $$;
revoke execute on function public.set_quote_status(uuid,text) from public, anon;
grant  execute on function public.set_quote_status(uuid,text) to authenticated;

create or replace function public.set_quote_visibility(p_quote uuid, p_visible boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_items int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  if coalesce(p_visible,false) then
    select total, (select count(*) from public.quote_items qi where qi.quote_id = p_quote) into v_total, v_items from public.quotes where id = p_quote;
    if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;
  end if;
  update public.quotes set public_portal_visible = coalesce(p_visible,false), updated_at = now() where id = p_quote and not is_deleted;
  return found;
end; $$;
revoke execute on function public.set_quote_visibility(uuid,boolean) from public, anon;
grant  execute on function public.set_quote_visibility(uuid,boolean) to authenticated;

create or replace function public.client_accept_quote(p_quote uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text; v_total numeric; v_items int;
begin
  select total, (select count(*) from public.quote_items qi where qi.quote_id = p_quote) into v_total, v_items
    from public.quotes where id = p_quote and not is_deleted and client_id = public.my_client_id() and status in ('sent','approved');
  if not found then raise exception 'quote not available'; end if;
  if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;
  update public.quotes set status = 'accepted', public_portal_visible = true, updated_at = now() where id = p_quote
   returning quote_number into v_num;
  perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote, 'قبل العميل عرض السعر: ' || coalesce(v_num,''), 'Client accepted quote: ' || coalesce(v_num,''));
  return true;
end; $$;
revoke execute on function public.client_accept_quote(uuid) from public, anon;
grant  execute on function public.client_accept_quote(uuid) to authenticated;

-- ════════ 8) Zoho Books invoice upsert — READ-ONLY mirror (service_role) ═════
-- Called by the server sync route after it READS invoices from Zoho Books. This
-- NEVER creates/sends/voids anything in Zoho — it only stores a display record.
create or replace function public.upsert_zoho_invoice(
  p_zoho_invoice_id text, p_zoho_customer_id text, p_email text, p_invoice_number text, p_status text,
  p_currency text, p_subtotal numeric, p_vat numeric, p_total numeric, p_due_date date, p_pdf_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_id uuid;
begin
  if p_zoho_invoice_id is null or length(trim(p_zoho_invoice_id)) = 0 then raise exception 'zoho_invoice_id required'; end if;
  v_client := public.resolve_client_id_by_email(p_email);
  select id into v_id from public.invoices where zoho_invoice_id = p_zoho_invoice_id limit 1;
  if v_id is not null then
    -- Update facts; PRESERVE finance's manual visibility choice on re-sync.
    update public.invoices set
      zoho_customer_id = coalesce(nullif(p_zoho_customer_id,''), zoho_customer_id),
      client_id = coalesce(v_client, client_id),
      invoice_number = coalesce(nullif(p_invoice_number,''), invoice_number),
      status = coalesce(nullif(p_status,''), status), currency = coalesce(nullif(p_currency,''), currency),
      subtotal = coalesce(p_subtotal, subtotal), vat = coalesce(p_vat, vat), total = coalesce(p_total, total),
      due_date = coalesce(p_due_date, due_date), pdf_url = coalesce(nullif(p_pdf_url,''), pdf_url),
      source = 'zoho', updated_at = now()
    where id = v_id;
  else
    insert into public.invoices (zoho_invoice_id, zoho_customer_id, client_id, invoice_number, status, currency,
                                 subtotal, vat, total, due_date, pdf_url, source, public_portal_visible)
    values (p_zoho_invoice_id, nullif(p_zoho_customer_id,''), v_client, nullif(p_invoice_number,''),
            coalesce(nullif(p_status,''),'sent'), coalesce(nullif(p_currency,''),'SAR'),
            coalesce(p_subtotal,0), coalesce(p_vat,0), coalesce(p_total,0), p_due_date, nullif(p_pdf_url,''),
            'zoho', true)  -- official issued invoices are shown to the matched client by default
    returning id into v_id;
  end if;
  return v_id;
end; $$;
revoke execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text) from public, anon, authenticated;
grant  execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the prior create_quote/status/visibility/accept + quotes_read
-- policy; leaves the additive columns + new read RPCs — they are harmless):
-- begin;
--   drop function if exists public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text);
--   drop function if exists public.list_pending_quote_requests();
--   drop function if exists public.convert_quote_request(uuid);
--   drop function if exists public.resolve_client_id_by_email(text);
--   drop function if exists public.create_quote(uuid,uuid,uuid,date,text,numeric,text,text);
--   -- (re-create the prior create_quote 7-arg + set_quote_status/visibility/client_accept_quote
--   --  WITHOUT the empty/zero guard, and the quotes_read policy WITHOUT total>0, from
--   --  docs/portal_quotes_invoices_RUNME.sql if you truly need to revert the guards.)
--   -- alter table public.quotes drop column if exists title;
--   -- alter table public.invoices drop column if exists zoho_customer_id, drop column if exists source;
-- commit;
