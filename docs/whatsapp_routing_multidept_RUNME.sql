-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — multi-department routing (re-route on EVERY message). ADDITIVE.
--
-- Problem: assigned_department was set once (creation) and only updated when still
-- 'unassigned', so a later finance message on a sales conversation never became
-- visible to Finance. Fix: a routed_departments[] set that ACCUMULATES every
-- department a message routes to, and RLS/filters that read it — without removing
-- the conversation from its original department.
--
-- ADDITIVE + REVERSIBLE: new columns (add-if-not-exists), CREATE OR REPLACE
-- functions (privileges preserved), DROP POLICY + recreate (non-destructive),
-- and a one-time backfill UPDATE (no deletes). Rollback block at the bottom.
--
-- Depends on docs/whatsapp_routing_phase2b_RUNME.sql (assigned_department,
-- wa_can_read_dept, the action RPCs). ⚠️ CHECKPOINT (أ): review, then YOU run it.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) New columns ──────────────────────────────────────────────────────────
alter table public.whatsapp_conversations add column if not exists routed_departments text[] not null default '{}';
alter table public.whatsapp_conversations add column if not exists routing_locked boolean not null default false;
alter table public.whatsapp_conversations add column if not exists last_routed_department text;
alter table public.whatsapp_conversations add column if not exists last_routing_reason text;
create index if not exists idx_wa_conv_routed on public.whatsapp_conversations using gin (routed_departments);

-- Backfill: seed routed_departments with the current assigned_department so old
-- conversations stay visible to their department through the new predicate too.
update public.whatsapp_conversations
   set routed_departments = array[assigned_department]
 where assigned_department is not null and assigned_department <> 'unassigned'
   and (routed_departments is null or routed_departments = '{}');

-- ─── 2) Routed-department read predicate (ADDED alongside wa_can_read_dept) ────
create or replace function public.wa_can_read_routed(p_routed text[])
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and p_routed is not null and (
       (public.staff_role() = 'sales'   and 'sales_marketing' = any(p_routed))
    or (public.staff_role() = 'finance' and 'finance'         = any(p_routed))
    or (public.staff_role() = 'support' and 'support'         = any(p_routed))
    or (public.staff_role() = 'hr'      and 'hr'              = any(p_routed))
    or (public.staff_role() = 'editor'  and 'operations'      = any(p_routed))
  );
$$;
grant execute on function public.wa_can_read_routed(text[]) to authenticated;

-- ─── 3) Recreate SELECT policies: assigned_department OR routed_departments ────
drop policy if exists wa_conv_read on public.whatsapp_conversations;
create policy wa_conv_read on public.whatsapp_conversations for select to authenticated
  using (public.wa_can_read_dept(assigned_to, assigned_department, category, status)
         or public.wa_can_read_routed(routed_departments));

drop policy if exists wa_contacts_read on public.whatsapp_contacts;
create policy wa_contacts_read on public.whatsapp_contacts for select to authenticated
  using (
       (public.is_staff() and (public.is_owner() or public.staff_role() in ('manager','super_admin')))
    or exists (select 1 from public.whatsapp_conversations c
                where c.contact_id = whatsapp_contacts.id
                  and (public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)
                       or public.wa_can_read_routed(c.routed_departments)))
  );

drop policy if exists wa_msg_read on public.whatsapp_messages;
create policy wa_msg_read on public.whatsapp_messages for select to authenticated
  using (exists (select 1 from public.whatsapp_conversations c
                  where c.id = whatsapp_messages.conversation_id
                    and (public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)
                         or public.wa_can_read_routed(c.routed_departments))));

drop policy if exists wa_assign_read on public.whatsapp_assignments;
create policy wa_assign_read on public.whatsapp_assignments for select to authenticated
  using (exists (select 1 from public.whatsapp_conversations c
                  where c.id = whatsapp_assignments.conversation_id
                    and (public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)
                         or public.wa_can_read_routed(c.routed_departments))));

drop policy if exists wa_notes_read on public.whatsapp_internal_notes;
create policy wa_notes_read on public.whatsapp_internal_notes for select to authenticated
  using (exists (select 1 from public.whatsapp_conversations c
                  where c.id = whatsapp_internal_notes.conversation_id
                    and (public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)
                         or public.wa_can_read_routed(c.routed_departments))));

-- ─── 4) Action RPCs: allow routed-department staff to act too (read+act) ──────
create or replace function public.wa_send_message(p_conversation uuid, p_body text, p_status text default 'queued')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid; v_assigned uuid; v_dept text; v_cat text; v_status text; v_routed text[];
begin
  if p_body is null or length(trim(p_body)) = 0 then raise exception 'empty body'; end if;
  select contact_id, assigned_to, assigned_department, category, status, routed_departments
    into v_contact, v_assigned, v_dept, v_cat, v_status, v_routed
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not ((public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status) or public.wa_can_read_routed(v_routed))
          and coalesce(public.staff_role(),'x') <> 'readonly') then raise exception 'not authorized'; end if;
  insert into public.whatsapp_messages (conversation_id, contact_id, direction, message_type, body, status, sent_by, sent_at)
  values (p_conversation, v_contact, 'outgoing', 'text', p_body, coalesce(nullif(p_status,''),'queued'), auth.uid(), now())
  returning id into v_id;
  update public.whatsapp_conversations set last_message_at = now(), last_message_preview = left(p_body,160), updated_at = now() where id = p_conversation;
  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'outbound_recorded', jsonb_build_object('by', auth.uid(), 'status', coalesce(nullif(p_status,''),'queued'), 'message_id', v_id));
  return v_id;
end; $$;

create or replace function public.wa_add_note(p_conversation uuid, p_note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_assigned uuid; v_dept text; v_cat text; v_status text; v_routed text[];
begin
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'note is empty'; end if;
  select assigned_to, assigned_department, category, status, routed_departments
    into v_assigned, v_dept, v_cat, v_status, v_routed
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not (public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status) or public.wa_can_read_routed(v_routed)) then raise exception 'not authorized'; end if;
  insert into public.whatsapp_internal_notes (conversation_id, author_id, note) values (p_conversation, auth.uid(), p_note) returning id into v_id;
  return v_id;
end; $$;

create or replace function public.wa_mark_read(p_conversation uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_assigned uuid; v_dept text; v_cat text; v_status text; v_routed text[];
begin
  select assigned_to, assigned_department, category, status, routed_departments
    into v_assigned, v_dept, v_cat, v_status, v_routed
    from public.whatsapp_conversations where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not (public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status) or public.wa_can_read_routed(v_routed)) then raise exception 'not authorized'; end if;
  update public.whatsapp_conversations set unread_count = 0 where id = p_conversation;
  return true;
end; $$;

-- ─── 5) Manual department set → also LOCKS routing + unions routed_departments ─
create or replace function public.wa_set_department(p_conversation uuid, p_department text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.wa_is_triager() then raise exception 'not authorized'; end if;
  if p_department not in ('sales_marketing','finance','support','hr','operations','owner_admin','unassigned') then
    raise exception 'invalid department'; end if;
  update public.whatsapp_conversations
     set assigned_department = p_department,
         routing_locked = true,
         routed_departments = (select array(select distinct e from unnest(coalesce(routed_departments,'{}') || array[p_department]) e
                                            where e is not null and e <> 'unassigned')),
         updated_at = now()
   where id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'department_changed', jsonb_build_object('by', auth.uid(), 'department', p_department, 'locked', true));
  return true;
end; $$;

-- ─── 6) Per-message routing accumulator (service_role; called after ingest) ───
-- Unions the message's departments into routed_departments, records the decision,
-- sets assigned_department only when still unassigned & not locked, and notifies
-- the staff of any ADDITIONAL departments (ingest already handled the primary).
create or replace function public.wa_route_message(
  p_conversation uuid, p_departments text[], p_primary text, p_reason text, p_notified text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare d text; r record; v_routed text[]; v_prev text;
begin
  if p_conversation is null then return '{}'::jsonb; end if;

  select assigned_department into v_prev from public.whatsapp_conversations where id = p_conversation;

  update public.whatsapp_conversations
     set routed_departments = (select array(select distinct e from unnest(coalesce(routed_departments,'{}') || coalesce(p_departments,'{}')) e
                                            where e is not null and e <> 'unassigned')),
         last_routed_department = nullif(p_primary,''),
         last_routing_reason = p_reason,
         assigned_department = case when not coalesce(routing_locked,false) and coalesce(assigned_department,'unassigned') = 'unassigned'
                                    then coalesce(nullif(p_primary,''),'unassigned') else assigned_department end,
         updated_at = now()
   where id = p_conversation
   returning routed_departments into v_routed;

  if not found then return '{}'::jsonb; end if;

  -- Notify additional departments only (ingest already notified the primary +
  -- managers + admin broadcast). Never notify every employee.
  foreach d in array coalesce(p_departments, '{}') loop
    if d is not null and d <> 'unassigned' and d is distinct from p_notified then
      for r in select id from public.profiles where account_status = 'active'
                and ( (d='sales_marketing' and staff_role='sales')
                   or (d='finance' and staff_role='finance')
                   or (d='support' and staff_role='support')
                   or (d='hr' and staff_role='hr')
                   or (d='operations' and staff_role='editor') ) loop
        perform public.notify(r.id, 'user', 'whatsapp_new', 'whatsapp_conversation', p_conversation,
                              'واتساب — تم توجيه محادثة إلى قسمك', 'WhatsApp conversation routed to your department');
      end loop;
    end if;
  end loop;

  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (p_conversation, 'routing_decision',
          jsonb_build_object('departments', p_departments, 'primary', p_primary, 'reason', p_reason,
                             'previous_department', v_prev, 'routed', v_routed));
  return jsonb_build_object('routed_departments', v_routed, 'previous_department', v_prev);
end; $$;
revoke execute on function public.wa_route_message(uuid,text[],text,text,text) from public, anon, authenticated;
grant  execute on function public.wa_route_message(uuid,text[],text,text,text) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.wa_route_message(uuid,text[],text,text,text);
--   -- restore the phase2b SELECT policies (without the routed OR) from
--   -- docs/whatsapp_routing_phase2b_RUNME.sql sections 3+4, then:
--   drop function if exists public.wa_can_read_routed(text[]);
--   alter table public.whatsapp_conversations drop column if exists last_routing_reason;
--   alter table public.whatsapp_conversations drop column if exists last_routed_department;
--   alter table public.whatsapp_conversations drop column if exists routing_locked;
--   alter table public.whatsapp_conversations drop column if exists routed_departments;
-- commit;
