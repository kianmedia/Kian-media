-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — make PUBLISHED estimates actually visible to the client.
-- ADDITIVE + idempotent. SUPERSEDES docs/portal_guest_quote_publish_fix_RUNME.sql
-- (re-includes its publish/revision/published_at changes, so run THIS one file).
--
-- ROOT CAUSE: the client never saw the official estimate card because quotes_read
-- and quote_items_read are MUTUALLY RECURSIVE — quotes_read contains
-- `exists(select 1 from quote_items ...)` and quote_items_read contains
-- `exists(select 1 from quotes ...)`. When a NON-admin reads quotes, PostgreSQL
-- applies quote_items' RLS to that subquery, which re-applies quotes' RLS, … →
-- "infinite recursion detected in policy for relation quotes". The query ERRORS,
-- and the client UI silently falls back to the empty state. The ADMIN is unaffected
-- because can_manage_quotes() is the first OR term and short-circuits before the
-- recursive subquery is reached — which is why "admin works, client sees nothing".
--
-- FIX: drop the `exists(quote_items)` term from quotes_read (total>0 already implies a
-- priced quote, and the publish guard requires line items). quote_items_read only
-- references quotes, so once quotes_read no longer references quote_items the cycle is
-- broken for BOTH directions. Visibility gate (matching + visible + total>0) is kept,
-- so unpublished/internal estimates stay hidden (requirement: do not expose them).
--
-- Also (from the prior publish fix, re-applied here): approve_quote_for_client resolves
-- + links the client by VERIFIED email when client_id is NULL and notifies the correct
-- user (dedupe via published_at); client_request_quote_revision gains the email-match
-- branch so guest-origin quotes can be revised; quotes.published_at column.
--
-- Depends on portal_zoho_estimates_RUNME (quotes mirror, my_email/my_client_id/
-- resolve_client_id_by_email, the policies being replaced) + portal_quotes_invoices_RUNME
-- (quote_revision_requests, can_manage_quotes, notifications.type CHECK). Does NOT touch
-- the invoice flow or the admin create/sync/open-estimate flow.
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) BREAK THE RLS RECURSION (the real fix for the missing client card) ═
-- quotes_read WITHOUT the exists(quote_items) term (kept everything else identical).
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes()
    or ((client_id = public.my_client_id()
         or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (public_portal_visible or status in ('sent','accepted'))
        and total > 0)
  ));
-- quote_items_read references ONLY quotes (no self-reference), so it is now non-recursive.
-- Re-declared here verbatim so the live policy is explicit + known-good.
drop policy if exists quote_items_read on public.quote_items;
create policy quote_items_read on public.quote_items for select to authenticated using (
  exists (select 1 from public.quotes q where q.id = quote_items.quote_id and not q.is_deleted and (
    public.can_manage_quotes()
    or ((q.client_id = public.my_client_id()
         or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (q.public_portal_visible or q.status in ('sent','accepted')) and q.total > 0)
  )));

-- ════════ 2) Publish audit/dedupe column ═════════════════════════════════════
alter table public.quotes add column if not exists published_at timestamptz;
update public.quotes set published_at = admin_approved_at
  where admin_approved_at is not null and published_at is null;

-- ════════ 3) Publish → resolve + link + notify the client by verified email ═══
create or replace function public.approve_quote_for_client(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_client uuid; v_email text; v_num text; v_items int;
        v_uid uuid; v_was_published boolean;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;

  select q.total, q.client_id, lower(coalesce(q.email,'')), coalesce(q.estimate_number, q.quote_number),
         (select count(*) from public.quote_items qi where qi.quote_id = q.id),
         (q.published_at is not null)
    into v_total, v_client, v_email, v_num, v_items, v_was_published
    from public.quotes q where q.id = p_quote and not q.is_deleted;
  if not found then raise exception 'quote not found'; end if;
  if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;

  if v_client is null and v_email <> '' then
    v_client := public.resolve_client_id_by_email(v_email);
    if v_client is not null then
      update public.quotes set client_id = v_client where id = p_quote and client_id is null;
    end if;
  end if;

  update public.quotes
     set public_portal_visible = true,
         admin_approved_at = now(), admin_approved_by = auth.uid(),
         published_at = coalesce(published_at, now()),
         status = case when status in ('draft','internal_review','approved') then 'sent' else status end,
         updated_at = now()
   where id = p_quote;

  if v_client is not null then
    select user_id into v_uid from public.clients where id = v_client;
  end if;
  if v_uid is null and v_email <> '' then
    select id into v_uid from public.profiles where lower(email) = v_email and account_status <> 'blocked' limit 1;
  end if;

  if v_uid is not null and not v_was_published then
    perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote,
                          'تم إصدار عرض سعر جديد: ' || coalesce(v_num,''),
                          'A new quote has been issued: ' || coalesce(v_num,''));
  end if;

  return jsonb_build_object('ok', true, 'client_id', v_client,
                            'notified', (v_uid is not null and not v_was_published),
                            'recipient', v_uid, 'published', true);
end; $$;
revoke execute on function public.approve_quote_for_client(uuid) from public, anon;
grant  execute on function public.approve_quote_for_client(uuid) to authenticated;

-- ════════ 4) Request revision: email-match so guest quotes work; note required ═
create or replace function public.client_request_quote_revision(p_quote uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'note required'; end if;
  if not exists (
    select 1 from public.quotes q
     where q.id = p_quote and not q.is_deleted
       and (q.client_id = public.my_client_id()
            or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
       and (q.public_portal_visible or q.status in ('sent','accepted'))
       and q.total > 0)
  then raise exception 'quote not available'; end if;
  insert into public.quote_revision_requests (quote_id, author_id, note)
    values (p_quote, auth.uid(), trim(p_note));
  select coalesce(estimate_number, quote_number) into v_num from public.quotes where id = p_quote;
  perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote,
                        'طلب العميل تعديل عرض السعر: ' || coalesce(v_num,''),
                        'Client requested a quote revision: ' || coalesce(v_num,''));
  return true;
end; $$;
revoke execute on function public.client_request_quote_revision(uuid,text) from public, anon;
grant  execute on function public.client_request_quote_revision(uuid,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (run as the SQL Editor / service role — shows the raw fields the client
-- RLS needs; if all of public_portal_visible=true, status in sent/accepted, total>0,
-- item_count>0 and the email matches the client's profile, the card will now show):
--   select q.id, q.quote_number, q.estimate_number, q.email, q.client_id,
--          q.public_portal_visible, q.status, q.total,
--          (select count(*) from public.quote_items qi where qi.quote_id = q.id) as item_count,
--          q.published_at, q.source, q.zoho_estimate_id
--     from public.quotes q where q.source = 'zoho' order by q.created_at desc limit 10;
--   -- email match check (replace the client email):
--   select q.id, q.email as quote_email, p.email as profile_email,
--          (lower(q.email) = lower(p.email)) as email_match
--     from public.quotes q join public.profiles p on lower(p.email) = lower(q.email)
--    where q.source = 'zoho' order by q.created_at desc limit 10;
--
-- ROLLBACK (restores the recursive policies — only if you must revert):
-- begin;
--   drop policy if exists quotes_read on public.quotes;
--   create policy quotes_read on public.quotes for select to authenticated using (
--     not is_deleted and (public.can_manage_quotes() or ((client_id = public.my_client_id()
--       or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__')))
--       and (public_portal_visible or status in ('sent','accepted')) and total > 0
--       and exists (select 1 from public.quote_items qi where qi.quote_id = quotes.id))));
--   -- approve_quote_for_client / client_request_quote_revision: restore from their original files.
--   alter table public.quotes drop column if exists published_at;
-- commit;
