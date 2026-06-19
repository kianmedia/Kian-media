-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — quote-request schema fix. ADDITIVE + REVERSIBLE.
--
-- Adds a human-friendly request number (external_request_id) to
-- whatsapp_quote_requests so the inbox card can show a real number that ties
-- back to the public quote form's Sheets reference, and lets older rows fall
-- back to a short id. Also threads that reference through the PUBLIC link-back
-- RPC. No table is created or dropped; no existing column is altered/removed.
--
-- Depends on: docs/whatsapp_ops_batch_RUNME.sql (creates whatsapp_quote_requests
-- + wa_link_quote_request_public). Run that first.
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
--
-- DEPLOY ORDER: run THIS SQL **before/with** deploying the updated route+form.
-- The new RPC keeps all added params nullable-with-default, so it serves BOTH the
-- old caller (6 keys) and the new caller (8 keys). The reverse (new route hitting
-- the old 6-arg RPC) would fail, so SQL-first is the safe order.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 1) New nullable column. Existing rows get NULL → the card falls back to a short id.
alter table public.whatsapp_quote_requests
  add column if not exists external_request_id text;

-- 2) Recreate the PUBLIC link-back RPC with a trailing nullable p_external_request_id.
-- Drop the old 6-arg signature first so PostgREST has exactly one candidate (the
-- route is updated in the same change to always send the new param). Behavior is
-- identical when the reference is absent (defaults to NULL).
drop function if exists public.wa_link_quote_request_public(uuid, text, text, text[], text, text);

create or replace function public.wa_link_quote_request_public(
  p_conversation uuid, p_full_name text, p_phone text, p_services text[], p_city text, p_message text,
  p_external_request_id text default null, p_budget_range text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid; v_lead text;
begin
  select contact_id, crm_lead_id into v_contact, v_lead from public.whatsapp_conversations where id = p_conversation;
  if v_contact is null then raise exception 'conversation not found'; end if;
  select id into v_id from public.whatsapp_quote_requests
   where whatsapp_conversation_id = p_conversation and status = 'new' order by created_at desc limit 1;
  if v_id is not null then
    update public.whatsapp_quote_requests
       set full_name = coalesce(nullif(p_full_name,''), full_name), phone = coalesce(nullif(p_phone,''), phone),
           services = case when coalesce(array_length(p_services,1),0) > 0 then p_services else services end,
           city = coalesce(nullif(p_city,''), city), message = coalesce(nullif(p_message,''), message),
           external_request_id = coalesce(nullif(p_external_request_id,''), external_request_id),
           budget_range = coalesce(nullif(p_budget_range,''), budget_range), updated_at = now()
     where id = v_id;
  else
    insert into public.whatsapp_quote_requests
      (whatsapp_conversation_id, whatsapp_contact_id, phone, full_name, services, city, message, crm_lead_id, source, external_request_id, budget_range)
    values (p_conversation, v_contact, nullif(p_phone,''), nullif(p_full_name,''), coalesce(p_services,'{}'),
            nullif(p_city,''), nullif(p_message,''), v_lead, 'whatsapp', nullif(p_external_request_id,''), nullif(p_budget_range,''))
    returning id into v_id;
  end if;
  perform public.notify(null, 'admin', 'quote_request_new', 'whatsapp_conversation', p_conversation,
                        'طلب عرض سعر من واتساب', 'New WhatsApp quote request');
  return v_id;
end; $$;
revoke execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text) from public, anon, authenticated;
grant  execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the original 6-arg RPC; leaves the column in place — it is
-- additive and harmless. Drop the column too only if you really want to):
-- begin;
--   drop function if exists public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text);
--   create or replace function public.wa_link_quote_request_public(
--     p_conversation uuid, p_full_name text, p_phone text, p_services text[], p_city text, p_message text
--   ) returns uuid language plpgsql security definer set search_path = public as $$
--   declare v_id uuid; v_contact uuid; v_lead text;
--   begin
--     select contact_id, crm_lead_id into v_contact, v_lead from public.whatsapp_conversations where id = p_conversation;
--     if v_contact is null then raise exception 'conversation not found'; end if;
--     select id into v_id from public.whatsapp_quote_requests
--      where whatsapp_conversation_id = p_conversation and status = 'new' order by created_at desc limit 1;
--     if v_id is not null then
--       update public.whatsapp_quote_requests
--          set full_name = coalesce(nullif(p_full_name,''), full_name), phone = coalesce(nullif(p_phone,''), phone),
--              services = case when coalesce(array_length(p_services,1),0) > 0 then p_services else services end,
--              city = coalesce(nullif(p_city,''), city), message = coalesce(nullif(p_message,''), message), updated_at = now()
--        where id = v_id;
--     else
--       insert into public.whatsapp_quote_requests
--         (whatsapp_conversation_id, whatsapp_contact_id, phone, full_name, services, city, message, crm_lead_id, source)
--       values (p_conversation, v_contact, nullif(p_phone,''), nullif(p_full_name,''), coalesce(p_services,'{}'),
--               nullif(p_city,''), nullif(p_message,''), v_lead, 'whatsapp')
--       returning id into v_id;
--     end if;
--     perform public.notify(null, 'admin', 'quote_request_new', 'whatsapp_conversation', p_conversation,
--                           'طلب عرض سعر من واتساب', 'New WhatsApp quote request');
--     return v_id;
--   end; $$;
--   revoke execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text) from public, anon, authenticated;
--   grant  execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text) to service_role;
--   -- alter table public.whatsapp_quote_requests drop column if exists external_request_id;
-- commit;
