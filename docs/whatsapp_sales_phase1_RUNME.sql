-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp Sales — Phase 1 migration (ADDITIVE + REVERSIBLE).
--
-- Adds: a sales pipeline stage to conversations, an outbound-message recorder
-- RPC (for "reply from portal"), and a sales-stage setter RPC. It does NOT drop
-- or alter any existing column/policy/RPC and deletes no data.
--
-- Depends on docs/whatsapp_inbox_RUNME.sql (tables, wa_can_read, wa_is_triager,
-- staff_role, notify) — which is already applied in production.
--
-- ⚠️ CHECKPOINT (أ): review this file, then run it yourself in Supabase →
-- SQL Editor. Re-runnable (IF NOT EXISTS / CREATE OR REPLACE). Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) Sales pipeline stage (separate from the inbox triage `status`) ────────
-- Kept as its own column so existing inbox statuses (new/open/.../spam) are
-- untouched. This is the column that mirrors Zoho sales stages (Phase 2).
alter table public.whatsapp_conversations
  add column if not exists sales_stage text not null default 'new'
    check (sales_stage in ('new','collecting','quote_requested','awaiting_sales_review',
                           'quote_sent','follow_up','converted','rejected'));

create index if not exists idx_wa_conv_sales_stage on public.whatsapp_conversations(sales_stage);

-- ─── 2) Outbound message recorder (the "reply from portal" write path) ────────
-- SECURITY DEFINER + guarded: only staff who can READ the conversation and are
-- not read-only may reply. The actual WhatsApp Cloud API call happens in the
-- server route /api/integrations/whatsapp/send (server-only token); this RPC only
-- records the message + bumps the conversation. p_status lets the route mark
-- 'dry_run' (recorded, not sent), 'queued' (about to send), 'sent', or 'failed'.
create or replace function public.wa_send_message(
  p_conversation uuid,
  p_body text,
  p_status text default 'queued'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_contact uuid;
  v_assigned uuid;
  v_cat text;
  v_status text;
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'empty body'; end if;

  select contact_id, assigned_to, category, status
    into v_contact, v_assigned, v_cat, v_status
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;

  -- Authorization: can read this conversation AND is staff but not read-only.
  if not (public.wa_can_read(v_assigned, v_cat, v_status)
          and coalesce(public.staff_role(), 'x') <> 'readonly') then
    raise exception 'not authorized';
  end if;

  insert into public.whatsapp_messages
    (conversation_id, contact_id, direction, message_type, body, status, sent_by, sent_at)
  values
    (p_conversation, v_contact, 'outgoing', 'text', p_body,
     coalesce(nullif(p_status,''), 'queued'), auth.uid(), now())
  returning id into v_id;

  update public.whatsapp_conversations
     set last_message_at      = now(),
         last_message_preview = left(p_body, 160),
         updated_at           = now()
   where id = p_conversation;

  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'outbound_recorded',
          jsonb_build_object('by', auth.uid(), 'status', coalesce(nullif(p_status,''),'queued'), 'message_id', v_id));

  return v_id;
end; $$;
revoke execute on function public.wa_send_message(uuid,text,text) from public, anon;
grant  execute on function public.wa_send_message(uuid,text,text) to authenticated;

-- Mark an outbound message's delivery status after the send attempt (used by the
-- server route to flip 'queued' → 'sent'/'failed' and store the WA message id).
create or replace function public.wa_mark_message_status(
  p_message uuid, p_status text, p_wa_message_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_assigned uuid; v_cat text; v_cstatus text;
begin
  select m.conversation_id into v_conv from public.whatsapp_messages m where m.id = p_message;
  if not found then raise exception 'message not found'; end if;
  select assigned_to, category, status into v_assigned, v_cat, v_cstatus
    from public.whatsapp_conversations where id = v_conv;
  if not (public.wa_can_read(v_assigned, v_cat, v_cstatus)
          and coalesce(public.staff_role(),'x') <> 'readonly') then
    raise exception 'not authorized';
  end if;
  update public.whatsapp_messages
     set status = coalesce(nullif(p_status,''), status),
         whatsapp_message_id = coalesce(p_wa_message_id, whatsapp_message_id)
   where id = p_message and direction = 'outgoing';
  return true;
end; $$;
revoke execute on function public.wa_mark_message_status(uuid,text,text) from public, anon;
grant  execute on function public.wa_mark_message_status(uuid,text,text) to authenticated;

-- ─── 3) Sales-stage setter (owner/manager triage) ────────────────────────────
create or replace function public.wa_set_sales_stage(p_conversation uuid, p_stage text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_is_triager() then raise exception 'not authorized'; end if;
  if p_stage not in ('new','collecting','quote_requested','awaiting_sales_review',
                     'quote_sent','follow_up','converted','rejected') then
    raise exception 'invalid stage';
  end if;
  update public.whatsapp_conversations
     set sales_stage = p_stage, updated_at = now()
   where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'sales_stage_changed', jsonb_build_object('by', auth.uid(), 'stage', p_stage));
  return true;
end; $$;
revoke execute on function public.wa_set_sales_stage(uuid,text) from public, anon;
grant  execute on function public.wa_set_sales_stage(uuid,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (uncomment to fully reverse Phase 1):
-- begin;
--   drop function if exists public.wa_set_sales_stage(uuid,text);
--   drop function if exists public.wa_mark_message_status(uuid,text,text);
--   drop function if exists public.wa_send_message(uuid,text,text);
--   drop index if exists public.idx_wa_conv_sales_stage;
--   alter table public.whatsapp_conversations drop column if exists sales_stage;
-- commit;
