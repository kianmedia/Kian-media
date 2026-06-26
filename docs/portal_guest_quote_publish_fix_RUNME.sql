-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — fix publish-to-client for GUEST-origin quotes. ADDITIVE + idempotent.
--
-- PROBLEM: when admin clicks "اعتماد وإظهار للعميل", approve_quote_for_client sets
-- public_portal_visible=true but only notifies if the quote's client_id resolves to a
-- clients.user_id. A guest-origin quote has client_id = NULL (the lead had no clients
-- row when the estimate was created) and only an inline email, so NO client
-- notification is ever sent — the client never knows the estimate is waiting. (The
-- estimate is actually VISIBLE via the email-match RLS once total>0 + has items, but
-- the client is never told to look.) Also client_request_quote_revision matched ONLY
-- client_id = my_client_id() (no email branch), so "طلب تعديل" failed for guest quotes.
--
-- FIX (focused; does NOT touch the invoice pipeline):
--   1) approve_quote_for_client: resolve+link the client by VERIFIED email when
--      client_id is NULL, set published_at, and notify the correct user (clients.user_id
--      first, else the signed-up profile matched by verified email). Dedupe on published_at
--      so re-clicking publish does not re-notify.
--   2) client_request_quote_revision: add the email-match branch (like client_respond_quote)
--      so a guest-origin published quote can be revised; require the note.
--   3) add quotes.published_at (audit + dedupe key).
--
-- Visibility RLS is NOT changed (the email-match branch already grants exactly the right
-- access). No clients-row creation. Depends on portal_zoho_estimates_RUNME (quotes mirror,
-- my_email/my_client_id/resolve_client_id_by_email, approve_quote_for_client v1,
-- quotes_read RLS), portal_quotes_invoices_RUNME (quote_revision_requests, can_manage_quotes).
-- Does NOT depend on portal_invoice_approval_RUNME (invoice flow untouched here).
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Publish audit/dedupe column ═════════════════════════════════════
alter table public.quotes add column if not exists published_at timestamptz;
-- Treat already-approved quotes as already-published so they don't re-notify on next publish.
update public.quotes set published_at = admin_approved_at
  where admin_approved_at is not null and published_at is null;

-- ════════ 2) Publish → resolve + link + notify the client by verified email ═══
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

  -- Guest-origin: link the client by VERIFIED email when there is no client_id yet
  -- (only links to an existing clients row; never creates one; never overwrites a real link).
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

  -- Resolve the recipient: the linked client's user, else the signed-up profile by verified email.
  if v_client is not null then
    select user_id into v_uid from public.clients where id = v_client;
  end if;
  if v_uid is null and v_email <> '' then
    select id into v_uid from public.profiles where lower(email) = v_email and account_status <> 'blocked' limit 1;
  end if;

  -- Notify the client ONLY on the first publish (dedupe via published_at).
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

-- ════════ 3) Request revision: add email-match so guest quotes work ══════════
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
       and q.total > 0 and exists (select 1 from public.quote_items qi where qi.quote_id = q.id))
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
-- VERIFY (after running):
--   -- publish a Zoho estimate whose email matches a signed-up user → that user gets
--   -- a 'quote_sent' notification and quotes.client_id is linked + published_at set.
--   select id, estimate_number, client_id, public_portal_visible, published_at, total
--     from public.quotes where source='zoho' order by created_at desc limit 5;
--
-- ROLLBACK:
-- begin;
--   -- restore prior bodies from their original files:
--   --   approve_quote_for_client        → docs/portal_zoho_estimates_RUNME.sql
--   --   client_request_quote_revision   → docs/portal_quotes_invoices_RUNME.sql
--   alter table public.quotes drop column if exists published_at;
-- commit;
