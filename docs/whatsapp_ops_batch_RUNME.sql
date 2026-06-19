-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — operational batch: internal alerts + quote linking + start
-- conversation. ADDITIVE + REVERSIBLE. No DROP of tables/columns, no deletes.
--
-- Depends on: whatsapp_inbox_RUNME, whatsapp_routing_phase2b_RUNME (wa_can_read_dept,
-- whatsapp_staff_alert_settings), whatsapp_routing_multidept_RUNME (wa_can_read_routed,
-- routed_departments), whatsapp_phaseABC_RUNME. Run those first.
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ PART 1 — Internal WhatsApp staff alerts ════════════════════════════
create table if not exists public.whatsapp_internal_alert_audit (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid references public.whatsapp_conversations(id) on delete set null,
  contact_id          uuid references public.whatsapp_contacts(id) on delete set null,
  recipient_user_id   uuid references auth.users(id) on delete set null,
  recipient_phone     text,
  status              text not null check (status in ('skipped','dry_run','sent','failed','blocked')),
  reason              text,
  whatsapp_message_id text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_wa_internal_audit_conv on public.whatsapp_internal_alert_audit(conversation_id, created_at);
alter table public.whatsapp_internal_alert_audit enable row level security;
drop policy if exists wa_internal_audit_read on public.whatsapp_internal_alert_audit;
create policy wa_internal_audit_read on public.whatsapp_internal_alert_audit for select to authenticated
  using (public.is_staff() and (public.is_owner() or public.staff_role() = 'manager'));
grant select on public.whatsapp_internal_alert_audit to authenticated;

-- Recipients for an internal alert: active staff with alerts enabled + an alert
-- phone, who are owner/admin/manager OR the assignee OR routed-department staff.
create or replace function public.wa_internal_alert_recipients(p_conversation uuid, p_departments text[] default '{}')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_assigned uuid; v_routed text[]; v_depts text[]; v jsonb;
begin
  select assigned_to, coalesce(routed_departments,'{}') into v_assigned, v_routed
    from public.whatsapp_conversations where id = p_conversation;
  v_depts := (select array(select distinct e from unnest(coalesce(p_departments,'{}')||coalesce(v_routed,'{}')) e
                            where e is not null and e <> 'unassigned'));
  select coalesce(jsonb_agg(jsonb_build_object('user_id', p.id, 'phone', s.whatsapp_alert_phone)), '[]'::jsonb) into v
    from public.profiles p
    join public.whatsapp_staff_alert_settings s on s.user_id = p.id
   where p.account_status = 'active' and s.whatsapp_alert_enabled = true
     and s.whatsapp_alert_phone is not null and length(trim(s.whatsapp_alert_phone)) > 0
     and ( p.account_type = 'admin'
        or p.staff_role in ('manager','super_admin')
        or p.id = v_assigned
        or (p.staff_role = 'sales'   and 'sales_marketing' = any(v_depts))
        or (p.staff_role = 'finance' and 'finance'         = any(v_depts))
        or (p.staff_role = 'support' and 'support'         = any(v_depts))
        or (p.staff_role = 'hr'      and 'hr'              = any(v_depts))
        or (p.staff_role = 'editor'  and 'operations'      = any(v_depts)) );
  return v;
end; $$;
revoke execute on function public.wa_internal_alert_recipients(uuid,text[]) from public, anon, authenticated;
grant  execute on function public.wa_internal_alert_recipients(uuid,text[]) to service_role;

create or replace function public.wa_log_internal_alert(
  p_conversation uuid, p_contact uuid, p_user uuid, p_phone text, p_status text, p_reason text, p_wa_message_id text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.whatsapp_internal_alert_audit
    (conversation_id, contact_id, recipient_user_id, recipient_phone, status, reason, whatsapp_message_id)
  values (p_conversation, p_contact, p_user, p_phone, coalesce(nullif(p_status,''),'skipped'), nullif(p_reason,''), nullif(p_wa_message_id,''));
end; $$;
revoke execute on function public.wa_log_internal_alert(uuid,uuid,uuid,text,text,text,text) from public, anon, authenticated;
grant  execute on function public.wa_log_internal_alert(uuid,uuid,uuid,text,text,text,text) to service_role;

-- ════════ PART 2 — WhatsApp-originated quote requests (separate table) ═══════
create table if not exists public.whatsapp_quote_requests (
  id                      uuid primary key default gen_random_uuid(),
  whatsapp_conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  whatsapp_contact_id     uuid references public.whatsapp_contacts(id) on delete set null,
  phone                   text,
  full_name               text,
  company                 text,
  services                text[] not null default '{}',
  category                text,
  city                    text,
  preferred_date          date,
  message                 text,
  budget_range            text,
  status                  text not null default 'new'
                            check (status in ('new','in_review','quoted','accepted','rejected','archived')),
  crm_lead_id             text,
  source                  text not null default 'whatsapp',
  created_by              uuid references auth.users(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_wa_quote_conv on public.whatsapp_quote_requests(whatsapp_conversation_id, created_at);
alter table public.whatsapp_quote_requests enable row level security;
-- Readable by anyone who can read the parent conversation (dept/routed/owner).
drop policy if exists wa_quote_read on public.whatsapp_quote_requests;
create policy wa_quote_read on public.whatsapp_quote_requests for select to authenticated
  using (exists (select 1 from public.whatsapp_conversations c
                  where c.id = whatsapp_quote_requests.whatsapp_conversation_id
                    and (public.wa_can_read_dept(c.assigned_to, c.assigned_department, c.category, c.status)
                         or public.wa_can_read_routed(c.routed_departments))));
grant select on public.whatsapp_quote_requests to authenticated;

-- Staff-initiated create (must be able to read the conversation). Pulls phone +
-- contact + crm_lead_id from the conversation; notifies sales + owner/admin/manager.
create or replace function public.wa_create_quote_request(
  p_conversation uuid, p_full_name text, p_company text, p_services text[],
  p_city text, p_preferred_date date, p_message text, p_category text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid; v_assigned uuid; v_dept text; v_cat text; v_status text; v_routed text[];
        v_phone text; v_lead text; v_name text; r record;
begin
  select c.contact_id, c.assigned_to, c.assigned_department, c.category, c.status, c.routed_departments, c.crm_lead_id
    into v_contact, v_assigned, v_dept, v_cat, v_status, v_routed, v_lead
    from public.whatsapp_conversations c where c.id = p_conversation;
  if not found then raise exception 'conversation not found'; end if;
  if not (public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status) or public.wa_can_read_routed(v_routed)) then
    raise exception 'not authorized'; end if;
  select coalesce(phone, wa_id), display_name into v_phone, v_name from public.whatsapp_contacts where id = v_contact;

  insert into public.whatsapp_quote_requests
    (whatsapp_conversation_id, whatsapp_contact_id, phone, full_name, company, services, category, city, preferred_date, message, crm_lead_id, source, created_by)
  values (p_conversation, v_contact, v_phone, coalesce(nullif(p_full_name,''), v_name), nullif(p_company,''),
          coalesce(p_services,'{}'), nullif(p_category,''), nullif(p_city,''), p_preferred_date, nullif(p_message,''),
          v_lead, 'whatsapp', auth.uid())
  returning id into v_id;

  -- Notify sales/marketing + owner/admin/manager (+ finance if finance category).
  perform public.notify(null, 'admin', 'quote_request_new', 'whatsapp_conversation', p_conversation,
                        'طلب عرض سعر من واتساب', 'New WhatsApp quote request');
  for r in select id from public.profiles where account_status='active'
            and ( staff_role in ('manager','super_admin','sales')
               or (coalesce(p_category,'')='finance' and staff_role='finance') ) loop
    perform public.notify(r.id, 'user', 'quote_request_new', 'whatsapp_conversation', p_conversation,
                          'طلب عرض سعر من واتساب', 'New WhatsApp quote request');
  end loop;
  return v_id;
end; $$;
revoke execute on function public.wa_create_quote_request(uuid,text,text,text[],text,date,text,text) from public, anon;
grant  execute on function public.wa_create_quote_request(uuid,text,text,text[],text,date,text,text) to authenticated;

-- Public self-submit (anon → via service_role server route). Links to an existing
-- conversation only; dedupes by reusing an open 'new' request for that conversation.
create or replace function public.wa_link_quote_request_public(
  p_conversation uuid, p_full_name text, p_phone text, p_services text[], p_city text, p_message text
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
           city = coalesce(nullif(p_city,''), city), message = coalesce(nullif(p_message,''), message), updated_at = now()
     where id = v_id;
  else
    insert into public.whatsapp_quote_requests
      (whatsapp_conversation_id, whatsapp_contact_id, phone, full_name, services, city, message, crm_lead_id, source)
    values (p_conversation, v_contact, nullif(p_phone,''), nullif(p_full_name,''), coalesce(p_services,'{}'),
            nullif(p_city,''), nullif(p_message,''), v_lead, 'whatsapp')
    returning id into v_id;
  end if;
  perform public.notify(null, 'admin', 'quote_request_new', 'whatsapp_conversation', p_conversation,
                        'طلب عرض سعر من واتساب', 'New WhatsApp quote request');
  return v_id;
end; $$;
revoke execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text) from public, anon, authenticated;
grant  execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text) to service_role;

-- ════════ PART 3 — Start a new conversation (template) ═══════════════════════
create table if not exists public.whatsapp_template_audit (
  id                  uuid primary key default gen_random_uuid(),
  conversation_id     uuid references public.whatsapp_conversations(id) on delete set null,
  contact_id          uuid references public.whatsapp_contacts(id) on delete set null,
  user_id             uuid references auth.users(id) on delete set null,
  phone               text,
  template            text,
  status              text not null check (status in ('skipped','dry_run','sent','failed','blocked')),
  reason              text,
  whatsapp_message_id text,
  created_at          timestamptz not null default now()
);
create index if not exists idx_wa_template_audit_conv on public.whatsapp_template_audit(conversation_id, created_at);
alter table public.whatsapp_template_audit enable row level security;
drop policy if exists wa_template_audit_read on public.whatsapp_template_audit;
create policy wa_template_audit_read on public.whatsapp_template_audit for select to authenticated
  using (public.is_staff() and (public.is_owner() or public.staff_role() = 'manager'));
grant select on public.whatsapp_template_audit to authenticated;

-- Create/attach contact + conversation for an OUTBOUND-initiated chat, and record
-- the template message. Triager-only. Dedupe by wa_id (digits-only msisdn).
create or replace function public.wa_start_conversation(
  p_wa_id text, p_phone text, p_name text, p_company text, p_department text,
  p_reason text, p_template text, p_preview text, p_status text default 'queued'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_contact uuid; v_conv uuid; v_msg uuid; v_dept text;
begin
  if not public.wa_is_triager() then raise exception 'not authorized'; end if;
  if p_wa_id is null or length(trim(p_wa_id)) = 0 then raise exception 'phone required'; end if;
  v_dept := case when p_department in ('sales_marketing','finance','support','hr','operations','owner_admin')
                 then p_department else 'unassigned' end;

  insert into public.whatsapp_contacts (wa_id, phone, display_name, last_seen_at)
  values (p_wa_id, nullif(p_phone,''), nullif(trim(coalesce(p_name,'')),''), now())
  on conflict (wa_id) do update
    set phone = coalesce(public.whatsapp_contacts.phone, excluded.phone),
        display_name = coalesce(public.whatsapp_contacts.display_name, excluded.display_name),
        last_seen_at = now()
  returning id into v_contact;

  select id into v_conv from public.whatsapp_conversations
   where contact_id = v_contact and status not in ('closed','spam')
   order by coalesce(last_message_at, created_at) desc limit 1;
  if v_conv is null then
    insert into public.whatsapp_conversations
      (contact_id, status, category, priority, assigned_department, routed_departments, last_message_at, last_message_preview)
    values (v_contact, 'new', 'unknown', 'normal', v_dept,
            case when v_dept = 'unassigned' then '{}'::text[] else array[v_dept] end, now(), left(coalesce(p_preview,''),160))
    returning id into v_conv;
  end if;

  insert into public.whatsapp_messages (conversation_id, contact_id, direction, message_type, body, status, sent_by, sent_at)
  values (v_conv, v_contact, 'outgoing', 'template', coalesce(p_preview,''), coalesce(nullif(p_status,''),'queued'), auth.uid(), now())
  returning id into v_msg;

  update public.whatsapp_conversations set last_message_at = now(), last_message_preview = left(coalesce(p_preview,''),160), updated_at = now()
   where id = v_conv;

  insert into public.whatsapp_events (conversation_id, event_type, event_payload)
  values (v_conv, 'conversation_started', jsonb_build_object('by', auth.uid(), 'template', p_template, 'reason', p_reason, 'department', v_dept));

  return jsonb_build_object('conversation_id', v_conv, 'contact_id', v_contact, 'message_id', v_msg);
end; $$;
revoke execute on function public.wa_start_conversation(text,text,text,text,text,text,text,text,text) from public, anon;
grant  execute on function public.wa_start_conversation(text,text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.wa_log_template_audit(
  p_conversation uuid, p_contact uuid, p_phone text, p_template text, p_status text, p_reason text, p_message uuid, p_wa_message_id text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_message is not null then
    update public.whatsapp_messages set status = coalesce(nullif(p_status,''), status),
           whatsapp_message_id = coalesce(nullif(p_wa_message_id,''), whatsapp_message_id)
     where id = p_message and direction = 'outgoing';
  end if;
  insert into public.whatsapp_template_audit (conversation_id, contact_id, user_id, phone, template, status, reason, whatsapp_message_id)
  values (p_conversation, p_contact, auth.uid(), p_phone, nullif(p_template,''), coalesce(nullif(p_status,''),'skipped'), nullif(p_reason,''), nullif(p_wa_message_id,''));
end; $$;
revoke execute on function public.wa_log_template_audit(uuid,uuid,text,text,text,text,uuid,text) from public, anon;
grant  execute on function public.wa_log_template_audit(uuid,uuid,text,text,text,text,uuid,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.wa_log_template_audit(uuid,uuid,text,text,text,text,uuid,text);
--   drop function if exists public.wa_start_conversation(text,text,text,text,text,text,text,text,text);
--   drop table if exists public.whatsapp_template_audit cascade;
--   drop function if exists public.wa_link_quote_request_public(uuid,text,text,text[],text,text);
--   drop function if exists public.wa_create_quote_request(uuid,text,text,text[],text,date,text,text);
--   drop table if exists public.whatsapp_quote_requests cascade;
--   drop function if exists public.wa_log_internal_alert(uuid,uuid,uuid,text,text,text,text);
--   drop function if exists public.wa_internal_alert_recipients(uuid,text[]);
--   drop table if exists public.whatsapp_internal_alert_audit cascade;
-- commit;
