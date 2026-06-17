-- ════════════════════════════════════════════════════════════════════════
-- Kian Media — WhatsApp Inbox + CRM routing foundation (RUN ME in Supabase SQL).
--
-- ADDITIVE ONLY. This migration creates six new public.whatsapp_* tables, their
-- RLS policies, a service-role ingest RPC, and a few owner/manager mutation RPCs.
-- It does NOT touch any existing table, policy, trigger, RPC, or grant. The only
-- change to an existing object is widening notifications_type_check to allow one
-- new notification type ('whatsapp_new') — all previous values are preserved.
--
-- Re-runnable: every object uses IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY
-- IF EXISTS, so applying it twice is safe.
--
-- Depends on helpers already deployed by:
--   • docs/phase0_migration.sql              (notify(), touch_updated_at(), is_admin())
--   • docs/staff_roles_task_assignment_RUNME (is_owner(), is_staff(), staff_role())
-- A rollback block is at the very bottom (commented out).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) TABLES ──────────────────────────────────────────────────────────────

-- 1.1 Contacts (one row per WhatsApp identity).
create table if not exists public.whatsapp_contacts (
  id            uuid primary key default gen_random_uuid(),
  wa_id         text unique not null,
  phone         text,
  display_name  text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  source        text not null default 'whatsapp',
  crm_lead_id   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 1.2 Conversations (a triage/routing unit for a contact).
create table if not exists public.whatsapp_conversations (
  id                   uuid primary key default gen_random_uuid(),
  contact_id           uuid not null references public.whatsapp_contacts(id) on delete cascade,
  status               text not null default 'new'
                         check (status in ('new','open','pending','assigned','closed','spam')),
  category             text not null default 'unknown'
                         check (category in ('sales','project_support','pricing_request','job_request',
                                             'training_request','supplier_request','finance','spam','unknown')),
  priority             text not null default 'normal'
                         check (priority in ('low','normal','high','urgent')),
  assigned_to          uuid references auth.users(id) on delete set null,
  linked_client_id     uuid,
  linked_project_id    uuid,
  crm_lead_id          text,
  last_message_at      timestamptz,
  last_message_preview text,
  ai_summary           text,
  ai_confidence        numeric,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_wa_conv_contact   on public.whatsapp_conversations(contact_id);
create index if not exists idx_wa_conv_status     on public.whatsapp_conversations(status);
create index if not exists idx_wa_conv_category   on public.whatsapp_conversations(category);
create index if not exists idx_wa_conv_assigned   on public.whatsapp_conversations(assigned_to);
create index if not exists idx_wa_conv_lastmsg    on public.whatsapp_conversations(last_message_at desc);

-- 1.3 Messages (incoming / outgoing / internal_note). Dedup on whatsapp_message_id.
create table if not exists public.whatsapp_messages (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid not null references public.whatsapp_conversations(id) on delete cascade,
  contact_id          uuid not null references public.whatsapp_contacts(id) on delete cascade,
  direction           text not null check (direction in ('incoming','outgoing','internal_note')),
  whatsapp_message_id text unique,
  message_type        text not null default 'text',
  body                text,
  raw_payload         jsonb,
  status              text not null default 'received',
  sent_by             uuid references auth.users(id) on delete set null,
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_wa_msg_conv on public.whatsapp_messages(conversation_id, created_at);

-- 1.4 Assignment history (audit trail of who was assigned, by whom, why).
create table if not exists public.whatsapp_assignments (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  assigned_to     uuid not null references auth.users(id) on delete cascade,
  assigned_by     uuid references auth.users(id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists idx_wa_assign_conv on public.whatsapp_assignments(conversation_id, created_at);

-- 1.5 Internal notes (staff-only; never sent to the customer).
create table if not exists public.whatsapp_internal_notes (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  author_id       uuid not null references auth.users(id) on delete cascade,
  note            text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_wa_note_conv on public.whatsapp_internal_notes(conversation_id, created_at);

-- 1.6 Raw event log (ingest, status callbacks, etc. — owner/manager only).
create table if not exists public.whatsapp_events (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  event_type      text not null,
  event_payload   jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists idx_wa_events_conv on public.whatsapp_events(conversation_id, created_at);

-- ─── 2) updated_at TRIGGERS (reuse the existing public.touch_updated_at()) ────
drop trigger if exists t_wa_contacts_touch on public.whatsapp_contacts;
create trigger t_wa_contacts_touch before update on public.whatsapp_contacts
  for each row execute function public.touch_updated_at();

drop trigger if exists t_wa_conv_touch on public.whatsapp_conversations;
create trigger t_wa_conv_touch before update on public.whatsapp_conversations
  for each row execute function public.touch_updated_at();

-- ─── 3) RLS — enable on all six, NO public access, reads gated by role ─────────
alter table public.whatsapp_contacts        enable row level security;
alter table public.whatsapp_conversations   enable row level security;
alter table public.whatsapp_messages        enable row level security;
alter table public.whatsapp_assignments     enable row level security;
alter table public.whatsapp_internal_notes  enable row level security;
alter table public.whatsapp_events          enable row level security;

-- Central read predicate. Centralises the routing rules so every table's policy
-- stays consistent. SECURITY DEFINER + stable so it can be used inside policies.
--   • owner/super_admin and manager  → read everything
--   • any staff                      → read anything assigned to them
--   • sales (unassigned)             → sales / pricing_request
--   • finance (unassigned)           → finance
--   • support (unassigned)           → project_support / unknown (triage queue)
-- Plain client/lead accounts (is_staff() = false) never match → no access.
create or replace function public.wa_can_read(p_assigned uuid, p_category text, p_status text)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (
        public.is_owner()
     or public.staff_role() = 'manager'
     or p_assigned = auth.uid()
     or (public.staff_role() = 'sales'   and p_assigned is null and p_category in ('sales','pricing_request'))
     or (public.staff_role() = 'finance' and p_assigned is null and p_category = 'finance')
     or (public.staff_role() = 'support' and p_assigned is null and p_category in ('project_support','unknown'))
  );
$$;
grant execute on function public.wa_can_read(uuid,text,text) to authenticated;

-- conversations: SELECT only (writes go through SECURITY DEFINER RPCs / service role)
drop policy if exists wa_conv_read on public.whatsapp_conversations;
create policy wa_conv_read on public.whatsapp_conversations
  for select to authenticated
  using (public.wa_can_read(assigned_to, category, status));

-- contacts: readable to full readers, or if the viewer can read ≥1 of their conversations
drop policy if exists wa_contacts_read on public.whatsapp_contacts;
create policy wa_contacts_read on public.whatsapp_contacts
  for select to authenticated
  using (
       (public.is_staff() and (public.is_owner() or public.staff_role() = 'manager'))
    or exists (
         select 1 from public.whatsapp_conversations c
          where c.contact_id = whatsapp_contacts.id
            and public.wa_can_read(c.assigned_to, c.category, c.status)
       )
  );

-- messages: readable iff the parent conversation is readable
drop policy if exists wa_msg_read on public.whatsapp_messages;
create policy wa_msg_read on public.whatsapp_messages
  for select to authenticated
  using (exists (
    select 1 from public.whatsapp_conversations c
     where c.id = whatsapp_messages.conversation_id
       and public.wa_can_read(c.assigned_to, c.category, c.status)
  ));

-- assignment history: same readers as the parent conversation
drop policy if exists wa_assign_read on public.whatsapp_assignments;
create policy wa_assign_read on public.whatsapp_assignments
  for select to authenticated
  using (exists (
    select 1 from public.whatsapp_conversations c
     where c.id = whatsapp_assignments.conversation_id
       and public.wa_can_read(c.assigned_to, c.category, c.status)
  ));

-- internal notes: same readers as the parent conversation (staff-only by construction)
drop policy if exists wa_notes_read on public.whatsapp_internal_notes;
create policy wa_notes_read on public.whatsapp_internal_notes
  for select to authenticated
  using (exists (
    select 1 from public.whatsapp_conversations c
     where c.id = whatsapp_internal_notes.conversation_id
       and public.wa_can_read(c.assigned_to, c.category, c.status)
  ));

-- raw events: owner / manager only
drop policy if exists wa_events_read on public.whatsapp_events;
create policy wa_events_read on public.whatsapp_events
  for select to authenticated
  using (public.is_staff() and (public.is_owner() or public.staff_role() = 'manager'));

-- NOTE: there are intentionally NO insert/update/delete policies. Every write is
-- performed by a SECURITY DEFINER function (runs as the table owner, bypassing
-- RLS) or by the service_role ingest path. The anon/public keys can do nothing.

-- ─── 4) NOTIFICATIONS — allow one new in-portal type ──────────────────────────
-- Re-create the inline CHECK with the existing 10 values + 'whatsapp_new'.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed',
  'opportunity_new',
  'whatsapp_new'));

-- ─── 5) INGEST RPC — service_role ONLY (called by /api/.../whatsapp/incoming) ──
-- Atomic implementation of Phase-3 steps: upsert contact → find-open-or-create
-- conversation → insert (deduped) message → bump conversation → log event →
-- route notifications. Returns ok / conversation_id / contact_id / inserted.
-- Idempotent on whatsapp_message_id so a re-delivered webhook never duplicates.
create or replace function public.whatsapp_ingest_message(
  p_wa_id        text,
  p_phone        text,
  p_display_name text,
  p_message_id   text,
  p_message_type text,
  p_body         text,
  p_timestamp    text,
  p_raw_payload  jsonb,
  p_category     text default 'unknown',
  p_priority     text default 'normal',
  p_ai_summary   text default null,
  p_ai_confidence numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_contact   uuid;
  v_conv      uuid;
  v_new_conv  boolean := false;
  v_inserted  boolean := false;
  v_preview   text;
  v_sent_at   timestamptz;
  v_existing  uuid;
  r record;
begin
  if p_wa_id is null or length(trim(p_wa_id)) = 0 then
    raise exception 'wa_id is required';
  end if;

  -- Idempotency: a message we already stored → return its conversation, no writes.
  if p_message_id is not null and length(p_message_id) > 0 then
    select id, conversation_id, contact_id
      into v_existing
      from public.whatsapp_messages
     where whatsapp_message_id = p_message_id
     limit 1;
    if found then
      select conversation_id, contact_id into v_conv, v_contact
        from public.whatsapp_messages where whatsapp_message_id = p_message_id limit 1;
      return jsonb_build_object('ok', true, 'conversation_id', v_conv,
                                'contact_id', v_contact, 'message_inserted', false, 'duplicate', true);
    end if;
  end if;

  -- Derive preview + sent_at defensively (WA timestamps are unix seconds as text).
  v_preview := left(coalesce(nullif(trim(p_body), ''), '[' || coalesce(p_message_type,'text') || ']'), 160);
  begin
    v_sent_at := to_timestamp(nullif(p_timestamp,'')::bigint);
  exception when others then
    v_sent_at := now();
  end;
  if v_sent_at is null then v_sent_at := now(); end if;

  -- (2) Upsert contact by wa_id.
  insert into public.whatsapp_contacts (wa_id, phone, display_name, last_seen_at)
  values (p_wa_id, p_phone, nullif(trim(coalesce(p_display_name,'')),''), now())
  on conflict (wa_id) do update
    set phone        = coalesce(excluded.phone, public.whatsapp_contacts.phone),
        display_name = coalesce(excluded.display_name, public.whatsapp_contacts.display_name),
        last_seen_at = now()
  returning id into v_contact;

  -- (3) Find an open conversation (not closed/spam) or create a new one.
  select id into v_conv
    from public.whatsapp_conversations
   where contact_id = v_contact and status not in ('closed','spam')
   order by coalesce(last_message_at, created_at) desc
   limit 1;

  if v_conv is null then
    insert into public.whatsapp_conversations
      (contact_id, status, category, priority, last_message_at, last_message_preview,
       ai_summary, ai_confidence)
    values
      (v_contact, 'new',
       coalesce(nullif(p_category,''),'unknown'),
       coalesce(nullif(p_priority,''),'normal'),
       v_sent_at, v_preview, p_ai_summary, p_ai_confidence)
    returning id into v_conv;
    v_new_conv := true;
  end if;

  -- (4) Insert the incoming message (deduped by the unique whatsapp_message_id).
  insert into public.whatsapp_messages
    (conversation_id, contact_id, direction, whatsapp_message_id, message_type,
     body, raw_payload, status, sent_at)
  values
    (v_conv, v_contact, 'incoming', nullif(p_message_id,''), coalesce(nullif(p_message_type,''),'text'),
     p_body, p_raw_payload, 'received', v_sent_at)
  on conflict (whatsapp_message_id) do nothing;
  v_inserted := found;

  -- (5) Bump the conversation. Keep human-set status/category; refresh AI fields.
  --     Only nudge status back toward 'new' when it is a brand-new conversation.
  update public.whatsapp_conversations
     set last_message_at      = greatest(coalesce(last_message_at, v_sent_at), v_sent_at),
         last_message_preview = v_preview,
         ai_summary           = coalesce(p_ai_summary, ai_summary),
         ai_confidence        = coalesce(p_ai_confidence, ai_confidence),
         updated_at           = now()
   where id = v_conv;

  -- (6) Event log row (best-effort audit; never the source of truth).
  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (v_conv,
          case when v_inserted then 'message_ingested' else 'message_duplicate' end,
          jsonb_build_object('wa_id', p_wa_id, 'message_id', p_message_id,
                             'message_type', p_message_type, 'new_conversation', v_new_conv));

  -- (7) Notifications — only for a genuinely new inbound message.
  if v_inserted then
    -- Always: admin broadcast feed entry.
    perform public.notify(null, 'admin', 'whatsapp_new', 'whatsapp_conversation', v_conv,
                          'رسالة واتساب جديدة', 'New WhatsApp message');
    -- Sales routing: notify each active sales user on a NEW sales/pricing thread.
    if v_new_conv and coalesce(p_category,'') in ('sales','pricing_request') then
      for r in select id from public.profiles
                where staff_role = 'sales' and account_status = 'active' loop
        perform public.notify(r.id, 'user', 'whatsapp_new', 'whatsapp_conversation', v_conv,
                              'عميل محتمل جديد على واتساب', 'New WhatsApp sales lead');
      end loop;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv,
                            'contact_id', v_contact, 'message_inserted', v_inserted,
                            'new_conversation', v_new_conv);
end; $$;

-- The ingest RPC is callable ONLY by the service_role (the server route's key).
revoke execute on function public.whatsapp_ingest_message(text,text,text,text,text,text,text,jsonb,text,text,numeric)
  from public, anon, authenticated;
grant execute on function public.whatsapp_ingest_message(text,text,text,text,text,text,text,jsonb,text,text,numeric)
  to service_role;

-- ─── 6) UI MUTATION RPCs (owner/manager triage; notes for any reader) ──────────
-- Guarded SECURITY DEFINER so the anon-key frontend can mutate safely without
-- any table write-grant. wa_is_triager() = the staff allowed to change routing.
create or replace function public.wa_is_triager()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() = 'manager';
$$;
grant execute on function public.wa_is_triager() to authenticated;

-- Update any subset of status / category / priority / assigned_to. Records an
-- assignment-history row + notifies the assignee whenever assigned_to changes.
create or replace function public.wa_set_conversation(
  p_conversation uuid,
  p_status   text default null,
  p_category text default null,
  p_priority text default null,
  p_assigned uuid default null,
  p_clear_assignment boolean default false,
  p_reason   text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_prev_assigned uuid;
  v_new_assigned  uuid;
begin
  if not public.wa_is_triager() then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.whatsapp_conversations where id = p_conversation) then
    raise exception 'conversation not found';
  end if;

  select assigned_to into v_prev_assigned
    from public.whatsapp_conversations where id = p_conversation;

  -- Resolve the target assignee (explicit clear wins over a NULL "no change").
  v_new_assigned := case when p_clear_assignment then null
                         when p_assigned is not null then p_assigned
                         else v_prev_assigned end;

  update public.whatsapp_conversations
     set status      = coalesce(nullif(p_status,''),   status),
         category    = coalesce(nullif(p_category,''), category),
         priority    = coalesce(nullif(p_priority,''), priority),
         assigned_to = v_new_assigned,
         updated_at  = now()
   where id = p_conversation;

  -- Assignment changed → history row + notify the new assignee.
  if v_new_assigned is distinct from v_prev_assigned and v_new_assigned is not null then
    insert into public.whatsapp_assignments (conversation_id, assigned_to, assigned_by, reason)
    values (p_conversation, v_new_assigned, auth.uid(), p_reason);
    perform public.notify(v_new_assigned, 'user', 'whatsapp_new', 'whatsapp_conversation', p_conversation,
                          'تم إسناد محادثة واتساب إليك', 'A WhatsApp conversation was assigned to you');
  end if;

  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'conversation_updated',
          jsonb_build_object('by', auth.uid(), 'status', p_status, 'category', p_category,
                             'priority', p_priority, 'assigned_to', v_new_assigned));
  return true;
end; $$;
revoke execute on function public.wa_set_conversation(uuid,text,text,text,uuid,boolean,text) from public, anon;
grant  execute on function public.wa_set_conversation(uuid,text,text,text,uuid,boolean,text) to authenticated;

-- Convenience wrapper for pure (re)assignment with a reason.
create or replace function public.wa_assign_conversation(
  p_conversation uuid, p_assigned uuid, p_reason text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  return public.wa_set_conversation(p_conversation, null, null, null, p_assigned, false, p_reason);
end; $$;
revoke execute on function public.wa_assign_conversation(uuid,uuid,text) from public, anon;
grant  execute on function public.wa_assign_conversation(uuid,uuid,text) to authenticated;

-- Add an internal note. Allowed for anyone who can READ the conversation.
create or replace function public.wa_add_note(p_conversation uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_assigned uuid; v_cat text; v_status text;
begin
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'note is empty'; end if;
  select assigned_to, category, status into v_assigned, v_cat, v_status
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not public.wa_can_read(v_assigned, v_cat, v_status) then raise exception 'not authorized'; end if;

  insert into public.whatsapp_internal_notes (conversation_id, author_id, note)
  values (p_conversation, auth.uid(), p_note)
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.wa_add_note(uuid,text) from public, anon;
grant  execute on function public.wa_add_note(uuid,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (uncomment + run to fully remove this feature). Order matters.
-- ════════════════════════════════════════════════════════════════════════
-- begin;
--   drop function if exists public.wa_add_note(uuid,text);
--   drop function if exists public.wa_assign_conversation(uuid,uuid,text);
--   drop function if exists public.wa_set_conversation(uuid,text,text,text,uuid,boolean,text);
--   drop function if exists public.wa_is_triager();
--   drop function if exists public.whatsapp_ingest_message(text,text,text,text,text,text,text,jsonb,text,text,numeric);
--   drop function if exists public.wa_can_read(uuid,text,text);
--   drop table if exists public.whatsapp_events cascade;
--   drop table if exists public.whatsapp_internal_notes cascade;
--   drop table if exists public.whatsapp_assignments cascade;
--   drop table if exists public.whatsapp_messages cascade;
--   drop table if exists public.whatsapp_conversations cascade;
--   drop table if exists public.whatsapp_contacts cascade;
--   -- revert the notifications CHECK to its pre-WhatsApp set (keep 'opportunity_new'):
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check check (type in (
--     'quote_request_new','message_new','file_link_new','project_note_new',
--     'deliverable_new','revision_requested','deliverable_approved',
--     'deliverable_final_delivered','project_status_changed','opportunity_new'));
-- commit;
