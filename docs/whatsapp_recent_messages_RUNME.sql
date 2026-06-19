-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — wa_recent_messages RPC (REQUIRED fix for the AUTO Zoho summary).
--
-- WHY THIS IS NEEDED (root cause): the whatsapp_* tables grant SELECT to the
-- `authenticated` role only — `service_role` has NO direct SELECT on them. So the
-- automatic ingest route (which runs as service_role) could not read the message
-- history and silently fell back to the latest message. Manual "Sync to Zoho"
-- works because it reads as the authenticated user. The ingest RPC works because
-- it is SECURITY DEFINER (runs as the owner).
--
-- This adds ONE SECURITY DEFINER function so the service-role ingest path can read
-- the recent message history (+ sales_stage) for a conversation — consistent with
-- the existing "service_role calls SECURITY DEFINER functions" model (no broad
-- direct table grant to service_role). Includes the conversation→contact fallback.
--
-- ADDITIVE + REVERSIBLE. No table/column/data change. Re-runnable.
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

begin;

create or replace function public.wa_recent_messages(
  p_conversation_id uuid,
  p_contact_id uuid default null,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_msgs jsonb;
  v_count integer;
  v_stage text;
  v_fallback text := 'conversation';
begin
  if p_conversation_id is null then
    return jsonb_build_object('sales_stage', null, 'messages', '[]'::jsonb, 'count', 0, 'fallback', 'none');
  end if;

  select sales_stage into v_stage from public.whatsapp_conversations where id = p_conversation_id;
  select count(*) into v_count from public.whatsapp_messages where conversation_id = p_conversation_id;

  -- Fallback (per spec): if the conversation has ≤1 message but the contact has
  -- more (e.g. split across conversations), read by contact_id instead.
  if v_count <= 1 and p_contact_id is not null then
    v_fallback := 'contact';
    select coalesce(jsonb_agg(j), '[]'::jsonb) into v_msgs from (
      select jsonb_build_object('body', body, 'direction', direction, 'created_at', created_at) j
        from public.whatsapp_messages
       where contact_id = p_contact_id
       order by created_at desc
       limit greatest(p_limit, 1)
    ) s;
  else
    select coalesce(jsonb_agg(j), '[]'::jsonb) into v_msgs from (
      select jsonb_build_object('body', body, 'direction', direction, 'created_at', created_at) j
        from public.whatsapp_messages
       where conversation_id = p_conversation_id
       order by created_at desc
       limit greatest(p_limit, 1)
    ) s;
  end if;

  return jsonb_build_object(
    'sales_stage', v_stage,
    'messages', coalesce(v_msgs, '[]'::jsonb),
    'count', coalesce(jsonb_array_length(v_msgs), 0),
    'fallback', v_fallback
  );
end; $$;

-- service_role ONLY (the auto ingest path). Not anon/authenticated/public.
revoke execute on function public.wa_recent_messages(uuid,uuid,integer) from public, anon, authenticated;
grant  execute on function public.wa_recent_messages(uuid,uuid,integer) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
--   begin; drop function if exists public.wa_recent_messages(uuid,uuid,integer); commit;
--
-- ALTERNATIVE (if you prefer a grant over a function — also valid, less consistent
-- with the codebase's definer-RPC model):
--   grant select on public.whatsapp_messages, public.whatsapp_conversations to service_role;
-- ════════════════════════════════════════════════════════════════════════
