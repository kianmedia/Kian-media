-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — Phase B (send audit) + Phase C (email recipient RPC). ADDITIVE.
--
-- B) whatsapp_send_audit table + wa_record_send_audit RPC: every outbound reply
--    attempt (dry_run/sent/failed/blocked) is recorded, and the outgoing message's
--    status is updated in the same call.
-- C) wa_alert_recipients RPC: returns the EMAILS to notify for a new message
--    (owner/admin/manager + routed-department staff + assigned user) — fixes the
--    service_role-cannot-SELECT-profiles issue (same class as the messages bug).
--
-- ADDITIVE + REVERSIBLE. No DROP of tables/columns, no data deletion.
-- Depends on: whatsapp_inbox_RUNME, whatsapp_routing_phase2b_RUNME (wa_can_read_dept),
-- whatsapp_routing_multidept_RUNME (wa_can_read_routed). Run those first.
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback below.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── B) Outbound send audit ──────────────────────────────────────────────────
create table if not exists public.whatsapp_send_audit (
  id                  uuid primary key default gen_random_uuid(),
  message_id          uuid references public.whatsapp_messages(id) on delete set null,
  conversation_id     uuid references public.whatsapp_conversations(id) on delete set null,
  contact_id          uuid references public.whatsapp_contacts(id) on delete set null,
  user_id             uuid references auth.users(id) on delete set null,
  target_phone        text,
  result              text not null check (result in ('dry_run','queued','sent','failed','blocked')),
  whatsapp_message_id text,
  error               text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_wa_send_audit_conv on public.whatsapp_send_audit(conversation_id, created_at);
alter table public.whatsapp_send_audit enable row level security;

drop policy if exists wa_send_audit_read on public.whatsapp_send_audit;
create policy wa_send_audit_read on public.whatsapp_send_audit for select to authenticated
  using (public.is_staff() and (public.is_owner() or public.staff_role() = 'manager'));
grant select on public.whatsapp_send_audit to authenticated;

-- Record a send attempt + update the outgoing message status. Caller = the acting
-- user (auth.uid()); authorized iff they can act on the conversation.
create or replace function public.wa_record_send_audit(
  p_message uuid, p_status text, p_wa_message_id text,
  p_conversation uuid, p_contact uuid, p_phone text, p_error text
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_assigned uuid; v_dept text; v_cat text; v_st text; v_routed text[];
begin
  select assigned_to, assigned_department, category, status, routed_departments
    into v_assigned, v_dept, v_cat, v_st, v_routed
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not ((public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_st) or public.wa_can_read_routed(v_routed))
          and coalesce(public.staff_role(),'x') <> 'readonly') then
    raise exception 'not authorized';
  end if;

  if p_message is not null then
    update public.whatsapp_messages
       set status = coalesce(nullif(p_status,''), status),
           whatsapp_message_id = coalesce(p_wa_message_id, whatsapp_message_id)
     where id = p_message and direction = 'outgoing';
  end if;

  insert into public.whatsapp_send_audit
    (message_id, conversation_id, contact_id, user_id, target_phone, result, whatsapp_message_id, error)
  values
    (p_message, p_conversation, p_contact, auth.uid(), p_phone,
     coalesce(nullif(p_status,''),'dry_run'), nullif(p_wa_message_id,''), nullif(p_error,''));
  return true;
end; $$;
revoke execute on function public.wa_record_send_audit(uuid,text,text,uuid,uuid,text,text) from public, anon;
grant  execute on function public.wa_record_send_audit(uuid,text,text,uuid,uuid,text,text) to authenticated;

-- ─── C) Email-alert recipient resolver (service_role; fixes profiles read) ────
-- Returns the distinct emails to notify for a new message: owner/admin/manager +
-- the staff of the conversation's routed departments (∪ the message's departments)
-- + the assigned user. NOT every employee. SECURITY DEFINER bypasses the
-- service_role direct-SELECT limitation on profiles.
create or replace function public.wa_alert_recipients(p_conversation uuid, p_departments text[] default '{}')
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_assigned uuid; v_routed text[]; v_depts text[]; v jsonb;
begin
  select assigned_to, coalesce(routed_departments,'{}') into v_assigned, v_routed
    from public.whatsapp_conversations where id = p_conversation;
  v_depts := (select array(select distinct e
                from unnest(coalesce(p_departments,'{}') || coalesce(v_routed,'{}')) e
               where e is not null and e <> 'unassigned'));
  select coalesce(jsonb_agg(distinct p.email), '[]'::jsonb) into v
    from public.profiles p
   where p.account_status = 'active' and p.email is not null and (
        p.account_type = 'admin'
     or p.staff_role in ('manager','super_admin')
     or p.id = v_assigned
     or (p.staff_role = 'sales'   and 'sales_marketing' = any(v_depts))
     or (p.staff_role = 'finance' and 'finance'         = any(v_depts))
     or (p.staff_role = 'support' and 'support'         = any(v_depts))
     or (p.staff_role = 'hr'      and 'hr'              = any(v_depts))
     or (p.staff_role = 'editor'  and 'operations'      = any(v_depts))
   );
  return v;
end; $$;
revoke execute on function public.wa_alert_recipients(uuid,text[]) from public, anon, authenticated;
grant  execute on function public.wa_alert_recipients(uuid,text[]) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.wa_alert_recipients(uuid,text[]);
--   drop function if exists public.wa_record_send_audit(uuid,text,text,uuid,uuid,text,text);
--   drop table if exists public.whatsapp_send_audit cascade;
-- commit;
