-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Zoho Books Estimates as the source of truth for official quotes.
-- ADDITIVE + REVERSIBLE. No table/column drops, no data deletes.
--
-- The portal MIRRORS Zoho estimates into the existing `quotes` table (kept as the
-- local cache/fallback; legacy local quotes stay as source='local'). A client sees
-- an estimate only when an admin approves it (public_portal_visible) AND it has
-- line items AND total>0. Same-email visibility: a logged-in user sees a quote
-- whose email == their VERIFIED profile email (signup confirms email), with NO
-- risky auto-creation of a clients row.
--
-- Depends on: portal_quotes_invoices_RUNME.sql + portal_quotes_invoices_fix_RUNME.sql
-- (quotes/quote_items, can_manage_quotes(), resolve_client_id_by_email()). Run those
-- first. This file re-creates resolve_client_id_by_email() idempotently so it is safe
-- even if the fix patch hasn't been applied yet.
--
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- DEPLOY ORDER: run THIS SQL before deploying the updated code.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Mirror columns on quotes (idempotent; title too in case the fix
--             patch wasn't run yet) ═══════════════════════════════════════════
alter table public.quotes add column if not exists title             text;
alter table public.quotes add column if not exists email             text;
alter table public.quotes add column if not exists zoho_customer_id  text;
alter table public.quotes add column if not exists zoho_estimate_id  text;
alter table public.quotes add column if not exists estimate_number   text;
alter table public.quotes add column if not exists estimate_url      text;
alter table public.quotes add column if not exists source            text not null default 'local';  -- 'local' | 'zoho'
alter table public.quotes add column if not exists client_response   text not null default 'pending'
                                                     check (client_response in ('pending','accepted','declined'));
alter table public.quotes add column if not exists admin_approved_at timestamptz;
alter table public.quotes add column if not exists admin_approved_by uuid references auth.users(id) on delete set null;
alter table public.quotes add column if not exists synced_at         timestamptz;
alter table public.quotes add column if not exists raw_payload       jsonb;
create index if not exists idx_quotes_zoho_estimate on public.quotes(zoho_estimate_id) where zoho_estimate_id is not null;
create index if not exists idx_quotes_email on public.quotes(lower(email));

-- ════════ 2) Helpers (idempotent) ════════════════════════════════════════════
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select email from public.profiles where id = auth.uid();
$$;
revoke execute on function public.my_email() from public, anon;
grant  execute on function public.my_email() to authenticated;

create or replace function public.resolve_client_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clients c join public.profiles p on p.id = c.user_id
  where p_email is not null and lower(p.email) = lower(p_email) and c.is_deleted = false
  limit 1;
$$;
revoke execute on function public.resolve_client_id_by_email(text) from public, anon;
grant  execute on function public.resolve_client_id_by_email(text) to authenticated, service_role;

-- ════════ 3) RLS — own (client_id OR verified email) + visible + non-empty ════
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes()
    or ((client_id = public.my_client_id()
         or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (public_portal_visible or status in ('sent','accepted'))
        and total > 0
        and exists (select 1 from public.quote_items qi where qi.quote_id = quotes.id))
  ));

drop policy if exists quote_items_read on public.quote_items;
create policy quote_items_read on public.quote_items for select to authenticated using (
  exists (select 1 from public.quotes q where q.id = quote_items.quote_id and not q.is_deleted and (
    public.can_manage_quotes()
    or ((q.client_id = public.my_client_id()
         or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (q.public_portal_visible or q.status in ('sent','accepted')) and q.total > 0)
  )));

-- ════════ 4) Read a quote_request's contact + services (for the create route) ═
create or replace function public.get_quote_request_for_estimate(p_request uuid)
returns table (email text, full_name text, company text, phone text, services text[], description text)
language sql stable security definer set search_path = public as $$
  select p.email, p.full_name, p.company, p.mobile, qr.services, qr.description
  from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
  where qr.id = p_request and coalesce(qr.is_deleted,false) = false;
$$;
revoke execute on function public.get_quote_request_for_estimate(uuid) from public, anon, authenticated;
grant  execute on function public.get_quote_request_for_estimate(uuid) to service_role;

-- ════════ 5) Mirror a Zoho estimate into quotes (+ line items) (service_role) ═
create or replace function public.upsert_zoho_estimate(
  p_zoho_estimate_id text, p_zoho_customer_id text, p_quote_request uuid, p_email text,
  p_estimate_number text, p_zoho_status text, p_currency text, p_subtotal numeric, p_vat numeric,
  p_total numeric, p_estimate_url text, p_items jsonb, p_raw jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid; v_status text; it jsonb; v_pos int := 0;
begin
  if p_zoho_estimate_id is null or length(trim(p_zoho_estimate_id)) = 0 then raise exception 'zoho_estimate_id required'; end if;
  v_client := public.resolve_client_id_by_email(p_email);
  if v_client is null and p_quote_request is not null then
    select id into v_client from public.clients where user_id = (select user_id from public.quote_requests where id = p_quote_request) and is_deleted = false limit 1;
  end if;
  v_status := case lower(coalesce(p_zoho_status,''))
                when 'draft' then 'draft' when 'sent' then 'sent' when 'accepted' then 'accepted'
                when 'declined' then 'rejected' when 'invoiced' then 'accepted' when 'expired' then 'expired'
                else 'internal_review' end;

  select id into v_id from public.quotes where zoho_estimate_id = p_zoho_estimate_id limit 1;
  if v_id is not null then
    update public.quotes set
      zoho_customer_id = coalesce(nullif(p_zoho_customer_id,''), zoho_customer_id),
      client_id = coalesce(v_client, client_id), email = coalesce(nullif(p_email,''), email),
      quote_request_id = coalesce(p_quote_request, quote_request_id),
      estimate_number = coalesce(nullif(p_estimate_number,''), estimate_number),
      estimate_url = coalesce(nullif(p_estimate_url,''), estimate_url),
      status = v_status, currency = coalesce(nullif(p_currency,''), currency),
      subtotal = coalesce(p_subtotal, subtotal), vat = coalesce(p_vat, vat), total = coalesce(p_total, total),
      source = 'zoho', synced_at = now(), raw_payload = coalesce(p_raw, raw_payload), updated_at = now()
      -- PRESERVE public_portal_visible / admin_approved_* / client_response on re-sync.
    where id = v_id;
  else
    insert into public.quotes (quote_number, client_id, email, quote_request_id, zoho_customer_id, zoho_estimate_id,
      estimate_number, estimate_url, status, currency, subtotal, vat, total, source, synced_at, raw_payload, public_portal_visible)
    values (coalesce(nullif(p_estimate_number,''), 'EST-' || left(p_zoho_estimate_id,8)), v_client, nullif(p_email,''),
      p_quote_request, nullif(p_zoho_customer_id,''), p_zoho_estimate_id, nullif(p_estimate_number,''),
      nullif(p_estimate_url,''), v_status, coalesce(nullif(p_currency,''),'SAR'), coalesce(p_subtotal,0),
      coalesce(p_vat,0), coalesce(p_total,0), 'zoho', now(), p_raw, false)  -- hidden until admin approves
    returning id into v_id;
  end if;

  -- Mirror line items (display) from Zoho.
  delete from public.quote_items where quote_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.quote_items (quote_id, title, description, quantity, unit_price, total, position)
    values (v_id, coalesce(nullif(it->>'title',''),'-'), nullif(it->>'description',''),
            coalesce((it->>'quantity')::numeric,1), coalesce((it->>'unit_price')::numeric,0),
            coalesce((it->>'total')::numeric, round(coalesce((it->>'quantity')::numeric,1)*coalesce((it->>'unit_price')::numeric,0),2)), v_pos);
    v_pos := v_pos + 1;
  end loop;
  return v_id;
end; $$;
revoke execute on function public.upsert_zoho_estimate(text,text,uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb,jsonb) from public, anon, authenticated;
grant  execute on function public.upsert_zoho_estimate(text,text,uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb,jsonb) to service_role;

-- ════════ 6) Admin approval → expose to client (validates non-empty) ═════════
create or replace function public.approve_quote_for_client(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text; v_total numeric; v_items int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select total, client_id, coalesce(estimate_number, quote_number),
         (select count(*) from public.quote_items qi where qi.quote_id = p_quote)
    into v_total, v_client, v_num, v_items from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;
  if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;
  update public.quotes set public_portal_visible = true, admin_approved_at = now(), admin_approved_by = auth.uid(),
         status = case when status in ('draft','internal_review','approved') then 'sent' else status end, updated_at = now()
   where id = p_quote;
  select user_id into v_uid from public.clients where id = v_client;
  if v_uid is not null then
    perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote, 'عرض سعر جاهز للمراجعة: ' || coalesce(v_num,''), 'A quote is ready for review: ' || coalesce(v_num,''));
  end if;
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.approve_quote_for_client(uuid) from public, anon;
grant  execute on function public.approve_quote_for_client(uuid) to authenticated;

-- ════════ 7) Client accept / decline (own by client_id OR verified email) ════
create or replace function public.client_respond_quote(p_quote uuid, p_response text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if p_response not in ('accepted','declined') then raise exception 'invalid response'; end if;
  if not exists (select 1 from public.quotes q where q.id = p_quote and not q.is_deleted
                 and (q.client_id = public.my_client_id() or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
                 and (q.public_portal_visible or q.status in ('sent','accepted'))
                 and q.total > 0 and exists (select 1 from public.quote_items qi where qi.quote_id = q.id))
  then raise exception 'quote not available'; end if;
  update public.quotes set client_response = p_response,
         status = case when p_response = 'accepted' then 'accepted' else 'rejected' end, updated_at = now()
   where id = p_quote returning coalesce(estimate_number, quote_number) into v_num;
  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.quote_revision_requests (quote_id, author_id, note) values (p_quote, auth.uid(), trim(p_note));
  end if;
  if p_response = 'accepted' then
    perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote, 'قبل العميل العرض: ' || coalesce(v_num,''), 'Client accepted quote: ' || coalesce(v_num,''));
  else
    perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote, 'رفض/طلب تعديل العرض: ' || coalesce(v_num,''), 'Client declined / requested revision: ' || coalesce(v_num,''));
  end if;
  return true;
end; $$;
revoke execute on function public.client_respond_quote(uuid,text,text) from public, anon;
grant  execute on function public.client_respond_quote(uuid,text,text) to authenticated;

-- ════════ 8) Same-email linking (no risky clients-row creation) ══════════════
-- Backfills client_id on email-matched quotes when the user already has a clients
-- row, so their quotes attach to their client context. Visibility itself works via
-- the email-match RLS above even without a clients row.
create or replace function public.promote_and_link_by_email() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text; v_client uuid; v_linked int := 0; v_recognized boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into v_email from public.profiles where id = auth.uid();
  v_recognized := exists (select 1 from public.quotes q where lower(coalesce(q.email,'')) = lower(coalesce(v_email,'')) and not q.is_deleted)
               or exists (select 1 from public.quote_requests qr join public.profiles p on p.id = qr.user_id where lower(p.email) = lower(coalesce(v_email,'')));
  select id into v_client from public.clients where user_id = auth.uid() and is_deleted = false limit 1;
  if v_client is not null and v_email is not null then
    update public.quotes set client_id = v_client, updated_at = now()
     where client_id is null and lower(coalesce(email,'')) = lower(v_email) and not is_deleted;
    get diagnostics v_linked = row_count;
  end if;
  return jsonb_build_object('recognized', v_recognized, 'linked', v_linked, 'has_client', v_client is not null);
end; $$;
revoke execute on function public.promote_and_link_by_email() from public, anon;
grant  execute on function public.promote_and_link_by_email() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the prior quotes_read/quote_items_read policies; leaves the
-- additive columns + new RPCs — they are harmless):
-- begin;
--   drop function if exists public.promote_and_link_by_email();
--   drop function if exists public.client_respond_quote(uuid,text,text);
--   drop function if exists public.approve_quote_for_client(uuid);
--   drop function if exists public.upsert_zoho_estimate(text,text,uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb,jsonb);
--   drop function if exists public.get_quote_request_for_estimate(uuid);
--   drop function if exists public.my_email();
--   -- re-create quotes_read / quote_items_read WITHOUT the email-match branch from
--   -- docs/portal_quotes_invoices_fix_RUNME.sql if you need to revert visibility.
--   -- alter table public.quotes drop column if exists zoho_estimate_id, ... (optional)
-- commit;
