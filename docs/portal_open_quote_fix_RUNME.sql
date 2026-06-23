-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — "Open quote" fix. ADDITIVE (function replacement only).
--
-- list_pending_quote_requests() previously returned only has_quote (boolean), so
-- the admin UI had to GUESS the linked quote by client-side matching — which fails
-- when that quote isn't in the currently-loaded list. This returns the ACTUAL
-- linked quote id + number + Zoho estimate fields so the button opens it directly.
--
-- No tables/columns added; no data changed. Depends on portal_quotes_invoices_*
-- + portal_zoho_estimates_RUNME (quotes incl. zoho_estimate_id/estimate_number/url).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.list_pending_quote_requests();

create or replace function public.list_pending_quote_requests()
returns table (
  id uuid, reference text, services text[], email text, city text, budget_range text,
  status text, created_at timestamptz, has_quote boolean,
  linked_quote_id uuid, quote_number text, zoho_estimate_id text, estimate_number text, estimate_url text
) language sql stable security definer set search_path = public as $$
  select qr.id, qr.reference, qr.services, p.email, qr.city, qr.budget_range, qr.status, qr.created_at,
         (lq.id is not null) as has_quote,
         lq.id, lq.quote_number, lq.zoho_estimate_id, lq.estimate_number, lq.estimate_url
  from public.quote_requests qr
  left join public.profiles p on p.id = qr.user_id
  left join lateral (
    select q.id, q.quote_number, q.zoho_estimate_id, q.estimate_number, q.estimate_url
    from public.quotes q
    where q.quote_request_id = qr.id and not q.is_deleted
    order by q.created_at desc
    limit 1
  ) lq on true
  where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
    and qr.status in ('new','in_review','quoted')
  order by qr.created_at desc;
$$;
revoke execute on function public.list_pending_quote_requests() from public, anon;
grant  execute on function public.list_pending_quote_requests() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restore the has_quote-only version):
-- begin;
--   create or replace function public.list_pending_quote_requests()
--   returns table (id uuid, reference text, services text[], email text, city text, budget_range text,
--                  status text, created_at timestamptz, has_quote boolean)
--   language sql stable security definer set search_path = public as $$
--     select qr.id, qr.reference, qr.services, p.email, qr.city, qr.budget_range, qr.status, qr.created_at,
--            exists (select 1 from public.quotes q where q.quote_request_id = qr.id and not q.is_deleted)
--     from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
--     where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
--       and qr.status in ('new','in_review','quoted')
--     order by qr.created_at desc;
--   $$;
-- commit;
