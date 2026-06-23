-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Tax-invoice approval flow after estimate acceptance. ADDITIVE.
--
-- When a client ACCEPTS a Zoho estimate, NO invoice is auto-created. Instead the
-- quote is marked invoice_approval_pending and owner/admin/finance/manager are
-- notified to approve creating the official tax invoice. An authorized user then
-- approves; the server creates the invoice in Zoho Books (if env/scopes allow) and
-- mirrors it locally read-only. Duplicate creation is prevented. Zoho Books stays
-- the source of truth; nothing is emailed to the client automatically.
--
-- Depends on portal_quotes_invoices_* + portal_zoho_estimates_RUNME (quotes/invoices,
-- can_see_invoices(), client_respond_quote, upsert_zoho_invoice, notify()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. DEPLOY ORDER:
-- run this BEFORE deploying the code (client_respond_quote + upsert_zoho_invoice change).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Columns ═════════════════════════════════════════════════════════
alter table public.quotes add column if not exists invoice_approval_status text not null default 'none'
  check (invoice_approval_status in ('none','invoice_approval_pending','invoice_creation_approved','invoice_created','invoice_creation_failed'));
alter table public.quotes add column if not exists invoice_approved_by uuid references auth.users(id) on delete set null;
alter table public.quotes add column if not exists invoice_approved_at timestamptz;
alter table public.quotes add column if not exists linked_invoice_id uuid references public.invoices(id) on delete set null;

alter table public.invoices add column if not exists quote_id uuid references public.quotes(id) on delete set null;
alter table public.invoices add column if not exists zoho_estimate_id text;
alter table public.invoices add column if not exists line_items jsonb;
create index if not exists idx_invoices_zoho_estimate on public.invoices(zoho_estimate_id) where zoho_estimate_id is not null;
create index if not exists idx_invoices_quote on public.invoices(quote_id) where quote_id is not null;

-- ════════ 2) Notifications CHECK — preserve live 17, add 3 ═══════════════════
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
  'project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed'));

-- ════════ 3) client_respond_quote — on accept, queue invoice approval ════════
create or replace function public.client_respond_quote(p_quote uuid, p_response text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text; r record;
begin
  if p_response not in ('accepted','declined') then raise exception 'invalid response'; end if;
  if not exists (select 1 from public.quotes q where q.id = p_quote and not q.is_deleted
                 and (q.client_id = public.my_client_id() or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
                 and (q.public_portal_visible or q.status in ('sent','accepted'))
                 and q.total > 0 and exists (select 1 from public.quote_items qi where qi.quote_id = q.id))
  then raise exception 'quote not available'; end if;
  update public.quotes set client_response = p_response,
         status = case when p_response = 'accepted' then 'accepted' else 'rejected' end,
         invoice_approval_status = case when p_response = 'accepted' and invoice_approval_status in ('none','invoice_creation_failed')
                                        then 'invoice_approval_pending' else invoice_approval_status end,
         updated_at = now()
   where id = p_quote returning coalesce(estimate_number, quote_number) into v_num;
  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.quote_revision_requests (quote_id, author_id, note) values (p_quote, auth.uid(), trim(p_note));
  end if;
  if p_response = 'accepted' then
    perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote, 'قبل العميل العرض: ' || coalesce(v_num,''), 'Client accepted quote: ' || coalesce(v_num,''));
    -- Tax-invoice approval required → owner/admin/manager/finance (in-portal).
    for r in select id from public.profiles where account_status='active'
              and (account_type='admin' or staff_role in ('manager','super_admin','finance')) loop
      perform public.notify(r.id, 'user', 'invoice_approval_required', 'quote', p_quote,
                            'موافقة على إنشاء فاتورة ضريبية مطلوبة: ' || coalesce(v_num,''), 'Tax invoice approval required: ' || coalesce(v_num,''));
    end loop;
  else
    perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote, 'رفض/طلب تعديل العرض: ' || coalesce(v_num,''), 'Client declined / requested revision: ' || coalesce(v_num,''));
  end if;
  return true;
end; $$;
revoke execute on function public.client_respond_quote(uuid,text,text) from public, anon;
grant  execute on function public.client_respond_quote(uuid,text,text) to authenticated;

-- ════════ 4) Approve tax-invoice creation (owner/finance/manager) ════════════
create or replace function public.approve_invoice_creation(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_est text; v_email text; v_status text; v_existing uuid; v_resp text;
begin
  if not public.can_see_invoices() then raise exception 'not authorized'; end if;
  select zoho_estimate_id, email, invoice_approval_status, client_response
    into v_est, v_email, v_status, v_resp from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;
  if v_resp <> 'accepted' then raise exception 'quote not accepted by client'; end if;
  -- Dedup: an invoice already created from this estimate/quote?
  select id into v_existing from public.invoices
   where not is_deleted and (quote_id = p_quote or (zoho_estimate_id is not null and zoho_estimate_id = v_est))
   order by created_at desc limit 1;
  update public.quotes set invoice_approval_status = case when v_existing is not null then 'invoice_created' else 'invoice_creation_approved' end,
         invoice_approved_by = auth.uid(), invoice_approved_at = now(),
         linked_invoice_id = coalesce(v_existing, linked_invoice_id), updated_at = now()
   where id = p_quote;
  return jsonb_build_object('ok', true, 'zoho_estimate_id', v_est, 'email', v_email,
                            'existing_invoice_id', v_existing, 'already_created', v_status = 'invoice_created');
end; $$;
revoke execute on function public.approve_invoice_creation(uuid) from public, anon;
grant  execute on function public.approve_invoice_creation(uuid) to authenticated;

-- ════════ 5) Server write-back of the invoice-creation outcome (service_role) ═
create or replace function public.set_quote_invoice_status(p_quote uuid, p_status text, p_invoice uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text;
begin
  if p_status not in ('invoice_approval_pending','invoice_creation_approved','invoice_created','invoice_creation_failed') then raise exception 'invalid status'; end if;
  update public.quotes set invoice_approval_status = p_status, linked_invoice_id = coalesce(p_invoice, linked_invoice_id), updated_at = now()
   where id = p_quote returning client_id, coalesce(estimate_number, quote_number) into v_client, v_num;
  if not found then raise exception 'quote not found'; end if;
  if p_status = 'invoice_created' then
    select user_id into v_uid from public.clients where id = v_client;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'invoice_visible', 'invoice', p_invoice, 'فاتورتك الضريبية متاحة في البوابة', 'Your tax invoice is available in the portal');
    end if;
    perform public.notify(null, 'admin', 'invoice_created', 'invoice', p_invoice, 'أُنشئت فاتورة ضريبية: ' || coalesce(v_num,''), 'Tax invoice created: ' || coalesce(v_num,''));
  elsif p_status = 'invoice_creation_failed' then
    perform public.notify(null, 'admin', 'invoice_creation_failed', 'quote', p_quote, 'فشل إنشاء الفاتورة الضريبية: ' || coalesce(v_num,''), 'Tax invoice creation failed: ' || coalesce(v_num,''));
  end if;
  return true;
end; $$;
revoke execute on function public.set_quote_invoice_status(uuid,text,uuid) from public, anon, authenticated;
grant  execute on function public.set_quote_invoice_status(uuid,text,uuid) to service_role;

-- ════════ 6) Widen upsert_zoho_invoice with quote_id/estimate/line_items ═════
drop function if exists public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text);
create or replace function public.upsert_zoho_invoice(
  p_zoho_invoice_id text, p_zoho_customer_id text, p_email text, p_invoice_number text, p_status text,
  p_currency text, p_subtotal numeric, p_vat numeric, p_total numeric, p_due_date date, p_pdf_url text,
  p_quote_id uuid default null, p_zoho_estimate_id text default null, p_line_items jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_id uuid;
begin
  if p_zoho_invoice_id is null or length(trim(p_zoho_invoice_id)) = 0 then raise exception 'zoho_invoice_id required'; end if;
  v_client := public.resolve_client_id_by_email(p_email);
  if v_client is null and p_quote_id is not null then select client_id into v_client from public.quotes where id = p_quote_id; end if;
  select id into v_id from public.invoices where zoho_invoice_id = p_zoho_invoice_id limit 1;
  if v_id is not null then
    update public.invoices set
      zoho_customer_id = coalesce(nullif(p_zoho_customer_id,''), zoho_customer_id),
      client_id = coalesce(v_client, client_id),
      quote_id = coalesce(p_quote_id, quote_id),
      zoho_estimate_id = coalesce(nullif(p_zoho_estimate_id,''), zoho_estimate_id),
      invoice_number = coalesce(nullif(p_invoice_number,''), invoice_number),
      status = coalesce(nullif(p_status,''), status), currency = coalesce(nullif(p_currency,''), currency),
      subtotal = coalesce(p_subtotal, subtotal), vat = coalesce(p_vat, vat), total = coalesce(p_total, total),
      due_date = coalesce(p_due_date, due_date), pdf_url = coalesce(nullif(p_pdf_url,''), pdf_url),
      line_items = coalesce(p_line_items, line_items), source = 'zoho', updated_at = now()
    where id = v_id;
  else
    insert into public.invoices (zoho_invoice_id, zoho_customer_id, client_id, quote_id, zoho_estimate_id,
                                 invoice_number, status, currency, subtotal, vat, total, due_date, pdf_url,
                                 line_items, source, public_portal_visible)
    values (p_zoho_invoice_id, nullif(p_zoho_customer_id,''), v_client, p_quote_id, nullif(p_zoho_estimate_id,''),
            nullif(p_invoice_number,''), coalesce(nullif(p_status,''),'sent'), coalesce(nullif(p_currency,''),'SAR'),
            coalesce(p_subtotal,0), coalesce(p_vat,0), coalesce(p_total,0), p_due_date, nullif(p_pdf_url,''),
            p_line_items, 'zoho', true)  -- official issued invoice → shown to the matched client
    returning id into v_id;
  end if;
  return v_id;
end; $$;
revoke execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text,uuid,text,jsonb) from public, anon, authenticated;
grant  execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text,uuid,text,jsonb) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restore the prior client_respond_quote, 11-arg upsert_zoho_invoice and
-- the 17-value notifications CHECK; the additive columns are harmless to leave):
-- begin;
--   drop function if exists public.set_quote_invoice_status(uuid,text,uuid);
--   drop function if exists public.approve_invoice_creation(uuid);
--   drop function if exists public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text,uuid,text,jsonb);
--   -- (re-create the 11-arg upsert_zoho_invoice + the prior client_respond_quote from
--   --  portal_quotes_invoices_fix_RUNME.sql / portal_zoho_estimates_RUNME.sql)
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check check (type in (
--     'quote_request_new','message_new','file_link_new','project_note_new',
--     'deliverable_new','revision_requested','deliverable_approved',
--     'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
--     'project_brief_new','portal_request_new',
--     'quote_sent','quote_accepted','quote_revision_requested','invoice_visible'));
-- commit;
