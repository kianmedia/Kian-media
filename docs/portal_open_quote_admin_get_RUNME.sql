-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — admin single-quote getter (fixes "Open quote"). ADDITIVE.
--
-- The admin "Open quote" flow read the quote via the quotes table (RLS). For some
-- staff viewers that direct SELECT returns 0 rows even though they manage quotes
-- (they CAN see the linkage via list_pending_quote_requests(), a SECURITY DEFINER
-- function gated by can_manage_quotes()). This getter uses the SAME gate so any
-- quote-manager can open ANY quote (incl. draft / zero-total) for review — exactly
-- like the pending list. No RLS change; no tables/columns/data changed.
--
-- Depends on portal_quotes_invoices_* (quotes/quote_items, can_manage_quotes()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- Returns { quote: {...}, items: [...] } for a quote-manager; null if not found.
create or replace function public.get_quote_admin(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_quote jsonb; v_items jsonb;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select to_jsonb(q.*) into v_quote from public.quotes q where q.id = p_quote and not q.is_deleted;
  if v_quote is null then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(i.*) order by i.position, i.created_at), '[]'::jsonb)
    into v_items from public.quote_items i where i.quote_id = p_quote;
  return jsonb_build_object('quote', v_quote, 'items', v_items);
end; $$;
revoke execute on function public.get_quote_admin(uuid) from public, anon;
grant  execute on function public.get_quote_admin(uuid) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.get_quote_admin(uuid);
-- commit;
