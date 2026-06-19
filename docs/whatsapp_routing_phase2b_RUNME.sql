-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — Inbox hardening: department routing + dept-scoped RLS + unread
-- + dept-aware notifications + staff-alert settings. ADDITIVE + REVERSIBLE.
--
-- No DROP of any table/column, no data deletion. RLS policies are dropped+recreated
-- (standard, non-destructive — same pattern as docs/whatsapp_inbox_RUNME.sql).
-- Functions are CREATE OR REPLACE (privileges are preserved). New columns use
-- `add column if not exists`.
--
-- Depends on: docs/whatsapp_inbox_RUNME.sql, docs/whatsapp_sales_phase1_RUNME.sql
-- (sales_stage), docs/whatsapp_zoho_phase2_RUNME.sql (crm_synced_at).
--
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor.
-- Re-runnable. Rollback block at the very bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) New columns (additive) ───────────────────────────────────────────────
alter table public.whatsapp_conversations
  add column if not exists assigned_department text not null default 'unassigned'
    check (assigned_department in
      ('sales_marketing','finance','support','hr','operations','owner_admin','unassigned'));
alter table public.whatsapp_conversations
  add column if not exists unread_count integer not null default 0;
create index if not exists idx_wa_conv_department on public.whatsapp_conversations(assigned_department);
create index if not exists idx_wa_conv_unread     on public.whatsapp_conversations(unread_count);

-- ─── 2) Department-aware read predicate (the visibility core) ─────────────────
-- owner/super_admin/manager → all. Any staff → anything assigned to them.
-- Department staff → their department. When a conversation has no department yet
-- ('unassigned'), fall back to category-based routing (legacy rows). Read-only /
-- clients / leads never match.
create or replace function public.wa_can_read_dept(
  p_assigned uuid, p_department text, p_category text, p_status text)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff() and (
        public.is_owner()
     or public.staff_role() in ('manager','super_admin')
     or (p_assigned = auth.uid() and coalesce(public.staff_role(),'') <> 'readonly')
     or (public.staff_role() = 'sales'   and p_department = 'sales_marketing')
     or (public.staff_role() = 'finance' and p_department = 'finance')
     or (public.staff_role() = 'support' and p_department = 'support')
     or (public.staff_role() = 'hr'      and p_department = 'hr')
     or (public.staff_role() = 'editor'  and p_department = 'operations')
     or (coalesce(p_department,'') in ('','unassigned') and (
            (public.staff_role() = 'sales'   and p_category in ('sales','pricing_request'))
         or (public.staff_role() = 'finance' and p_category = 'finance')
         or (public.staff_role() = 'support' and p_category in ('project_support','unknown'))
         or (public.staff_role() = 'hr'      and p_category in ('job_request','training_request','supplier_request'))
        ))
  );
$$;
grant execute on function public.wa_can_read_dept(uuid,text,text,text) to authenticated;

-- ─── 3) Recreate SELECT policies to be department-aware ───────────────────────
drop policy if exists wa_conv_read on public.whatsapp_conversations;
create policy wa_conv_read on public.whatsapp_conversations
  for select to authenticated
  using (public.wa_can_read_dept(assigned_to, assigned_department, category, status));

drop policy if exists wa_contacts_read on public.whatsapp_contacts;
create policy wa_contacts_read on public.whatsapp_contacts
  for select to authenticated
  using (
       (public.is_staff() and (public.is_owner() or public.staff_role() in ('manager','super_admin')))
    or exists (select 1 from public.whatsapp_conversations c
                where c.contact_id = whatsapp_contacts.id
                  and public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status))
  );

drop policy if exists wa_msg_read on public.whatsapp_messages;
create policy wa_msg_read on public.whatsapp_messages
  for select to authenticated
  using (exists (select 1 from public.whatsapp_conversations c
                  where c.id = whatsapp_messages.conversation_id
                    and public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)));

drop policy if exists wa_assign_read on public.whatsapp_assignments;
create policy wa_assign_read on public.whatsapp_assignments
  for select to authenticated
  using (exists (select 1 from public.whatsapp_conversations c
                  where c.id = whatsapp_assignments.conversation_id
                    and public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)));

drop policy if exists wa_notes_read on public.whatsapp_internal_notes;
create policy wa_notes_read on public.whatsapp_internal_notes
  for select to authenticated
  using (exists (select 1 from public.whatsapp_conversations c
                  where c.id = whatsapp_internal_notes.conversation_id
                    and public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)));

-- ─── 4) Mutation RPCs updated to the dept-aware read check ────────────────────
-- (CREATE OR REPLACE preserves the existing EXECUTE grants to authenticated.)
create or replace function public.wa_send_message(
  p_conversation uuid, p_body text, p_status text default 'queued'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid; v_assigned uuid; v_dept text; v_cat text; v_status text;
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'empty body'; end if;
  select contact_id, assigned_to, assigned_department, category, status
    into v_contact, v_assigned, v_dept, v_cat, v_status
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not (public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status)
          and coalesce(public.staff_role(),'x') <> 'readonly') then
    raise exception 'not authorized';
  end if;
  insert into public.whatsapp_messages
    (conversation_id, contact_id, direction, message_type, body, status, sent_by, sent_at)
  values (p_conversation, v_contact, 'outgoing', 'text', p_body,
          coalesce(nullif(p_status,''), 'queued'), auth.uid(), now())
  returning id into v_id;
  update public.whatsapp_conversations
     set last_message_at = now(), last_message_preview = left(p_body,160), updated_at = now()
   where id = p_conversation;
  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'outbound_recorded',
          jsonb_build_object('by', auth.uid(), 'status', coalesce(nullif(p_status,''),'queued'), 'message_id', v_id));
  return v_id;
end; $$;

create or replace function public.wa_add_note(p_conversation uuid, p_note text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_assigned uuid; v_dept text; v_cat text; v_status text;
begin
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'note is empty'; end if;
  select assigned_to, assigned_department, category, status into v_assigned, v_dept, v_cat, v_status
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status) then raise exception 'not authorized'; end if;
  insert into public.whatsapp_internal_notes (conversation_id, author_id, note)
  values (p_conversation, auth.uid(), p_note) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.wa_mark_message_status(
  p_message uuid, p_status text, p_wa_message_id text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_assigned uuid; v_dept text; v_cat text; v_cstatus text;
begin
  select m.conversation_id into v_conv from public.whatsapp_messages m where m.id = p_message;
  if not found then raise exception 'message not found'; end if;
  select assigned_to, assigned_department, category, status into v_assigned, v_dept, v_cat, v_cstatus
    from public.whatsapp_conversations where id = v_conv;
  if not (public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_cstatus)
          and coalesce(public.staff_role(),'x') <> 'readonly') then
    raise exception 'not authorized';
  end if;
  update public.whatsapp_messages
     set status = coalesce(nullif(p_status,''), status),
         whatsapp_message_id = coalesce(p_wa_message_id, whatsapp_message_id)
   where id = p_message and direction = 'outgoing';
  return true;
end; $$;

-- ─── 5) Set department (owner/manager triage) + mark-read (any reader) ────────
create or replace function public.wa_set_department(p_conversation uuid, p_department text)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_is_triager() then raise exception 'not authorized'; end if;
  if p_department not in ('sales_marketing','finance','support','hr','operations','owner_admin','unassigned') then
    raise exception 'invalid department';
  end if;
  update public.whatsapp_conversations set assigned_department = p_department, updated_at = now()
   where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'department_changed', jsonb_build_object('by', auth.uid(), 'department', p_department));
  return true;
end; $$;
revoke execute on function public.wa_set_department(uuid,text) from public, anon;
grant  execute on function public.wa_set_department(uuid,text) to authenticated;

create or replace function public.wa_mark_read(p_conversation uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_assigned uuid; v_dept text; v_cat text; v_status text;
begin
  select assigned_to, assigned_department, category, status into v_assigned, v_dept, v_cat, v_status
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status) then raise exception 'not authorized'; end if;
  update public.whatsapp_conversations set unread_count = 0 where id = p_conversation;
  return true;
end; $$;
revoke execute on function public.wa_mark_read(uuid) from public, anon;
grant  execute on function public.wa_mark_read(uuid) to authenticated;

-- ─── 6) Ingest RPC — add department routing + unread + dept-aware notifications
--      + preview-bearing titles + return crm_lead_id. Same 12-arg signature, so
--      grants/overloads are unchanged. (Full body re-stated.)
create or replace function public.whatsapp_ingest_message(
  p_wa_id text, p_phone text, p_display_name text, p_message_id text,
  p_message_type text, p_body text, p_timestamp text, p_raw_payload jsonb,
  p_category text default 'unknown', p_priority text default 'normal',
  p_ai_summary text default null, p_ai_confidence numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid; v_conv uuid; v_new_conv boolean := false; v_inserted boolean := false;
  v_preview text; v_sent_at timestamptz; v_existing uuid; v_department text; r record;
begin
  if p_wa_id is null or length(trim(p_wa_id)) = 0 then raise exception 'wa_id is required'; end if;

  if p_message_id is not null and length(p_message_id) > 0 then
    select id into v_existing from public.whatsapp_messages where whatsapp_message_id = p_message_id limit 1;
    if found then
      select conversation_id, contact_id into v_conv, v_contact
        from public.whatsapp_messages where whatsapp_message_id = p_message_id limit 1;
      return jsonb_build_object('ok', true, 'conversation_id', v_conv, 'contact_id', v_contact,
                                'message_inserted', false, 'duplicate', true);
    end if;
  end if;

  v_preview := left(coalesce(nullif(trim(p_body), ''), '[' || coalesce(p_message_type,'text') || ']'), 160);
  begin v_sent_at := to_timestamp(nullif(p_timestamp,'')::bigint); exception when others then v_sent_at := now(); end;
  if v_sent_at is null then v_sent_at := now(); end if;

  -- department from existing classification (editable later via wa_set_department)
  v_department := case
    when coalesce(p_category,'') in ('sales','pricing_request') then 'sales_marketing'
    when p_category = 'finance' then 'finance'
    when p_category = 'project_support' then 'support'
    when p_category in ('job_request','training_request','supplier_request') then 'hr'
    else 'unassigned' end;

  insert into public.whatsapp_contacts (wa_id, phone, display_name, last_seen_at)
  values (p_wa_id, p_phone, nullif(trim(coalesce(p_display_name,'')),''), now())
  on conflict (wa_id) do update
    set phone = coalesce(excluded.phone, public.whatsapp_contacts.phone),
        display_name = coalesce(excluded.display_name, public.whatsapp_contacts.display_name),
        last_seen_at = now()
  returning id into v_contact;

  select id into v_conv from public.whatsapp_conversations
   where contact_id = v_contact and status not in ('closed','spam')
   order by coalesce(last_message_at, created_at) desc limit 1;

  if v_conv is null then
    insert into public.whatsapp_conversations
      (contact_id, status, category, priority, assigned_department, unread_count,
       last_message_at, last_message_preview, ai_summary, ai_confidence)
    values
      (v_contact, 'new', coalesce(nullif(p_category,''),'unknown'),
       coalesce(nullif(p_priority,''),'normal'), v_department, 0,
       v_sent_at, v_preview, p_ai_summary, p_ai_confidence)
    returning id into v_conv;
    v_new_conv := true;
  end if;

  insert into public.whatsapp_messages
    (conversation_id, contact_id, direction, whatsapp_message_id, message_type, body, raw_payload, status, sent_at)
  values
    (v_conv, v_contact, 'incoming', nullif(p_message_id,''), coalesce(nullif(p_message_type,''),'text'),
     p_body, p_raw_payload, 'received', v_sent_at)
  on conflict (whatsapp_message_id) do nothing;
  v_inserted := found;

  update public.whatsapp_conversations
     set last_message_at      = greatest(coalesce(last_message_at, v_sent_at), v_sent_at),
         last_message_preview = v_preview,
         assigned_department  = case when coalesce(assigned_department,'unassigned') = 'unassigned'
                                     then v_department else assigned_department end,
         unread_count         = unread_count + (case when v_inserted then 1 else 0 end),
         ai_summary           = coalesce(p_ai_summary, ai_summary),
         ai_confidence        = coalesce(p_ai_confidence, ai_confidence),
         updated_at           = now()
   where id = v_conv;

  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (v_conv, case when v_inserted then 'message_ingested' else 'message_duplicate' end,
          jsonb_build_object('wa_id', p_wa_id, 'message_id', p_message_id,
                             'message_type', p_message_type, 'new_conversation', v_new_conv,
                             'department', v_department));

  if v_inserted then
    perform public.notify(null, 'admin', 'whatsapp_new', 'whatsapp_conversation', v_conv,
                          'واتساب: ' || left(v_preview, 60), 'WhatsApp: ' || left(v_preview, 60));
    for r in
      select id from public.profiles
       where account_status = 'active'
         and ( staff_role in ('manager','super_admin')
            or (v_department = 'sales_marketing' and staff_role = 'sales')
            or (v_department = 'finance'         and staff_role = 'finance')
            or (v_department = 'support'         and staff_role = 'support')
            or (v_department = 'hr'              and staff_role = 'hr')
            or (v_department = 'operations'      and staff_role = 'editor') )
    loop
      perform public.notify(r.id, 'user', 'whatsapp_new', 'whatsapp_conversation', v_conv,
                            'واتساب: ' || left(v_preview, 60), 'WhatsApp: ' || left(v_preview, 60));
    end loop;
  end if;

  return jsonb_build_object('ok', true, 'conversation_id', v_conv, 'contact_id', v_contact,
                            'message_inserted', v_inserted, 'new_conversation', v_new_conv,
                            'crm_lead_id', (select crm_lead_id from public.whatsapp_conversations where id = v_conv));
end; $$;

-- ─── 7) Staff WhatsApp-alert settings (schema/UI-ready; NO real sending yet) ──
create table if not exists public.whatsapp_staff_alert_settings (
  user_id               uuid primary key references auth.users(id) on delete cascade,
  whatsapp_alert_phone  text,
  whatsapp_alert_enabled boolean not null default false,
  whatsapp_alert_departments text[] not null default '{}',
  updated_at            timestamptz not null default now()
);
alter table public.whatsapp_staff_alert_settings enable row level security;

drop policy if exists wa_alert_self_read on public.whatsapp_staff_alert_settings;
create policy wa_alert_self_read on public.whatsapp_staff_alert_settings
  for select to authenticated
  using (user_id = auth.uid() or public.is_owner() or public.staff_role() = 'manager');

grant select on public.whatsapp_staff_alert_settings to authenticated;

-- Upsert own settings (or owner/manager sets anyone's).
create or replace function public.wa_set_staff_alert(
  p_user uuid, p_phone text, p_enabled boolean, p_departments text[] default '{}'
) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  v_target := coalesce(p_user, auth.uid());
  if v_target <> auth.uid() and not public.wa_is_triager() then raise exception 'not authorized'; end if;
  insert into public.whatsapp_staff_alert_settings (user_id, whatsapp_alert_phone, whatsapp_alert_enabled, whatsapp_alert_departments, updated_at)
  values (v_target, p_phone, coalesce(p_enabled,false), coalesce(p_departments,'{}'), now())
  on conflict (user_id) do update
    set whatsapp_alert_phone = excluded.whatsapp_alert_phone,
        whatsapp_alert_enabled = excluded.whatsapp_alert_enabled,
        whatsapp_alert_departments = excluded.whatsapp_alert_departments,
        updated_at = now();
  return true;
end; $$;
revoke execute on function public.wa_set_staff_alert(uuid,text,boolean,text[]) from public, anon;
grant  execute on function public.wa_set_staff_alert(uuid,text,boolean,text[]) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (reverses this migration; restores category-based policies):
-- begin;
--   drop function if exists public.wa_set_staff_alert(uuid,text,boolean,text[]);
--   drop table if exists public.whatsapp_staff_alert_settings cascade;
--   drop function if exists public.wa_mark_read(uuid);
--   drop function if exists public.wa_set_department(uuid,text);
--   -- restore category-based SELECT policies:
--   drop policy if exists wa_conv_read on public.whatsapp_conversations;
--   create policy wa_conv_read on public.whatsapp_conversations for select to authenticated
--     using (public.wa_can_read(assigned_to, category, status));
--   -- (repeat the wa_*_read policies from docs/whatsapp_inbox_RUNME.sql for messages/
--   --  notes/assignments/contacts), then:
--   drop function if exists public.wa_can_read_dept(uuid,text,text,text);
--   alter table public.whatsapp_conversations drop column if exists unread_count;
--   alter table public.whatsapp_conversations drop column if exists assigned_department;
--   -- (the ingest/wa_send_message/wa_add_note/wa_mark_message_status bodies can be
--   --  re-applied from their prior migrations if a full revert is required.)
-- commit;
