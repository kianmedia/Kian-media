-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp Sales — Phase 2 (Zoho CRM wiring). ADDITIVE + REVERSIBLE.
--
-- Adds crm_synced_at columns + a service-role-only RPC to write the Zoho lead id
-- back onto the contact + conversation. crm_lead_id ALREADY EXISTS on both tables
-- (docs/whatsapp_inbox_RUNME.sql) — not re-added. No drops, no data deletion.
--
-- ⚠️ CHECKPOINT (أ): review, then run yourself in Supabase → SQL Editor.
-- Re-runnable. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- 1) Sync timestamps (visibility of last successful CRM sync).
alter table public.whatsapp_contacts       add column if not exists crm_synced_at timestamptz;
alter table public.whatsapp_conversations    add column if not exists crm_synced_at timestamptz;

-- 2) Write-back RPC — called ONLY by the server (service_role) after a Zoho
--    upsert. SECURITY DEFINER + pinned search_path; revoked from anon/authenticated.
create or replace function public.wa_set_crm_lead(
  p_contact_id uuid,
  p_conversation_id uuid,
  p_crm_lead_id text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_crm_lead_id is null or length(trim(p_crm_lead_id)) = 0 then return; end if;
  update public.whatsapp_contacts
     set crm_lead_id = p_crm_lead_id, crm_synced_at = now(), updated_at = now()
   where id = p_contact_id;
  update public.whatsapp_conversations
     set crm_lead_id = p_crm_lead_id, crm_synced_at = now(), updated_at = now()
   where id = p_conversation_id;
end; $$;

revoke all     on function public.wa_set_crm_lead(uuid,uuid,text) from public, anon, authenticated;
grant  execute on function public.wa_set_crm_lead(uuid,uuid,text) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.wa_set_crm_lead(uuid,uuid,text);
--   alter table public.whatsapp_conversations drop column if exists crm_synced_at;
--   alter table public.whatsapp_contacts      drop column if exists crm_synced_at;
-- commit;
