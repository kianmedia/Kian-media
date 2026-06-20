-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — quote link modes + auto price-intent link + customer confirm.
-- ADDITIVE + REVERSIBLE. No table/column drops, no data deletes.
--
--   • wa_link_quote_request_public: add p_mode ('auto'|'new'|'update') + p_quote_id,
--     and RETURN jsonb (id + fields) so the route can send customer confirmations.
--   • whatsapp_quote_notify_audit: one audit table for auto-link + confirmations.
--   • wa_should_auto_quote: cooldown + open-quote lookup for the auto price reply.
--   • wa_record_outgoing: record an auto-sent message / internal note in the thread.
--   • wa_log_quote_notify: append an audit row (service_role).
--
-- Depends on: whatsapp_ops_batch_RUNME, whatsapp_quote_request_schema_fix_RUNME,
-- whatsapp_quote_books_fix_RUNME (whatsapp_quote_requests + the 14-arg
-- wa_link_quote_request_public + wa_can_read_dept/routed). Run those first.
--
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- DEPLOY ORDER: run THIS SQL **before** deploying the updated route/page/inbox code
-- (the link RPC return type changes uuid → jsonb; an old caller would still work as
-- it ignores the body, but the new route expects the jsonb shape).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Audit table for quote notifications (auto-link + confirmations) ══
create table if not exists public.whatsapp_quote_notify_audit (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid references public.whatsapp_conversations(id) on delete set null,
  quote_request_id uuid references public.whatsapp_quote_requests(id) on delete set null,
  channel          text not null check (channel in ('auto_link','email_confirm','whatsapp_confirm')),
  phone            text,
  email            text,
  keyword          text,
  mode             text,
  status           text not null check (status in ('skipped','dry_run','sent','failed','blocked')),
  reason           text,
  created_at       timestamptz not null default now()
);
create index if not exists idx_wa_quote_notify_conv on public.whatsapp_quote_notify_audit(conversation_id, created_at);
alter table public.whatsapp_quote_notify_audit enable row level security;
drop policy if exists wa_quote_notify_read on public.whatsapp_quote_notify_audit;
create policy wa_quote_notify_read on public.whatsapp_quote_notify_audit for select to authenticated
  using (public.is_staff() and (public.is_owner() or public.staff_role() in ('manager','finance')));
grant select on public.whatsapp_quote_notify_audit to authenticated;

create or replace function public.wa_log_quote_notify(
  p_conversation uuid, p_quote uuid, p_channel text, p_phone text, p_email text,
  p_keyword text, p_mode text, p_status text, p_reason text
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.whatsapp_quote_notify_audit
    (conversation_id, quote_request_id, channel, phone, email, keyword, mode, status, reason)
  values (p_conversation, p_quote, p_channel, nullif(p_phone,''), nullif(p_email,''),
          nullif(p_keyword,''), nullif(p_mode,''), coalesce(nullif(p_status,''),'skipped'), nullif(p_reason,''));
end; $$;
revoke execute on function public.wa_log_quote_notify(uuid,uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
grant  execute on function public.wa_log_quote_notify(uuid,uuid,text,text,text,text,text,text,text) to service_role;

-- ════════ 2) Cooldown + open-quote lookup for the auto price reply ════════════
-- Returns { allowed, open_quote_id, external_request_id }. allowed=false when an
-- auto_link was sent/dry_run for this conversation within p_cooldown_hours.
create or replace function public.wa_should_auto_quote(p_conversation uuid, p_cooldown_hours int default 6)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_recent int; v_qid uuid; v_ext text;
begin
  select count(*) into v_recent from public.whatsapp_quote_notify_audit
   where conversation_id = p_conversation and channel = 'auto_link' and status in ('sent','dry_run')
     and created_at > now() - make_interval(hours => greatest(coalesce(p_cooldown_hours,6), 0));
  select id, external_request_id into v_qid, v_ext from public.whatsapp_quote_requests
   where whatsapp_conversation_id = p_conversation and status in ('new','in_review','draft')
   order by created_at desc limit 1;
  return jsonb_build_object('allowed', v_recent = 0, 'open_quote_id', v_qid, 'external_request_id', v_ext);
end; $$;
revoke execute on function public.wa_should_auto_quote(uuid,int) from public, anon, authenticated;
grant  execute on function public.wa_should_auto_quote(uuid,int) to service_role;

-- ════════ 3) Record an auto-sent message / internal note in the thread ═══════
create or replace function public.wa_record_outgoing(
  p_conversation uuid, p_body text, p_direction text, p_status text, p_wa_message_id text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_contact uuid; v_msg uuid; v_dir text;
begin
  select contact_id into v_contact from public.whatsapp_conversations where id = p_conversation;
  if v_contact is null then raise exception 'conversation not found'; end if;
  v_dir := case when p_direction = 'internal_note' then 'internal_note' else 'outgoing' end;
  insert into public.whatsapp_messages (conversation_id, contact_id, direction, message_type, body, status, sent_by, sent_at, whatsapp_message_id)
  values (p_conversation, v_contact, v_dir, 'text', p_body, coalesce(nullif(p_status,''),'sent'), null, now(), nullif(p_wa_message_id,''))
  returning id into v_msg;
  update public.whatsapp_conversations
     set last_message_at = now(), last_message_preview = left(coalesce(p_body,''),160), updated_at = now()
   where id = p_conversation;
  return v_msg;
end; $$;
revoke execute on function public.wa_record_outgoing(uuid,text,text,text,text) from public, anon, authenticated;
grant  execute on function public.wa_record_outgoing(uuid,text,text,text,text) to service_role;

-- ════════ 4) Public link-back — add modes + return jsonb ═════════════════════
drop function if exists public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text,text,text,text,text,text,date);
create or replace function public.wa_link_quote_request_public(
  p_conversation uuid, p_full_name text, p_phone text, p_services text[], p_city text, p_message text,
  p_external_request_id text default null, p_budget_range text default null,
  p_company text default null, p_email text default null, p_lead_source text default null,
  p_priority text default null, p_duration text default null, p_preferred_date date default null,
  p_mode text default 'auto', p_quote_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid; v_lead text; v_row record;
begin
  select contact_id, crm_lead_id into v_contact, v_lead from public.whatsapp_conversations where id = p_conversation;
  if v_contact is null then raise exception 'conversation not found'; end if;

  if p_mode = 'update' and p_quote_id is not null then
    -- Update EXACTLY this quote (must belong to the conversation).
    select id into v_id from public.whatsapp_quote_requests
     where id = p_quote_id and whatsapp_conversation_id = p_conversation;
  elsif p_mode = 'new' then
    v_id := null;  -- force a fresh insert below
  else
    -- 'auto' (default + legacy links): reuse the newest OPEN request, else insert.
    select id into v_id from public.whatsapp_quote_requests
     where whatsapp_conversation_id = p_conversation and status in ('new','in_review','draft')
     order by created_at desc limit 1;
  end if;

  if v_id is not null then
    update public.whatsapp_quote_requests set
      full_name           = coalesce(nullif(p_full_name,''), full_name),
      phone               = coalesce(nullif(p_phone,''), phone),
      services            = case when coalesce(array_length(p_services,1),0) > 0 then p_services else services end,
      city                = coalesce(nullif(p_city,''), city),
      message             = coalesce(nullif(p_message,''), message),
      external_request_id = coalesce(nullif(p_external_request_id,''), external_request_id),
      budget_range        = coalesce(nullif(p_budget_range,''), budget_range),
      company             = coalesce(nullif(p_company,''), company),
      email               = coalesce(nullif(p_email,''), email),
      lead_source         = coalesce(nullif(p_lead_source,''), lead_source),
      priority            = coalesce(nullif(p_priority,''), priority),
      duration            = coalesce(nullif(p_duration,''), duration),
      preferred_date      = coalesce(p_preferred_date, preferred_date),
      updated_at          = now()
    where id = v_id;
  else
    insert into public.whatsapp_quote_requests
      (whatsapp_conversation_id, whatsapp_contact_id, phone, full_name, services, city, message,
       crm_lead_id, source, external_request_id, budget_range, company, email, lead_source, priority, duration, preferred_date)
    values (p_conversation, v_contact, nullif(p_phone,''), nullif(p_full_name,''), coalesce(p_services,'{}'),
            nullif(p_city,''), nullif(p_message,''), v_lead, 'whatsapp', nullif(p_external_request_id,''),
            nullif(p_budget_range,''), nullif(p_company,''), nullif(p_email,''), nullif(p_lead_source,''),
            nullif(p_priority,''), nullif(p_duration,''), p_preferred_date)
    returning id into v_id;
  end if;

  perform public.notify(null, 'admin', 'quote_request_new', 'whatsapp_conversation', p_conversation,
                        'طلب عرض سعر من واتساب', 'New WhatsApp quote request');

  select id, external_request_id, phone, email, full_name, company, city, preferred_date,
         array_to_string(services, '، ') as services_text
    into v_row from public.whatsapp_quote_requests where id = v_id;
  return jsonb_build_object(
    'id', v_row.id, 'external_request_id', v_row.external_request_id, 'phone', v_row.phone,
    'email', v_row.email, 'full_name', v_row.full_name, 'company', v_row.company, 'city', v_row.city,
    'preferred_date', v_row.preferred_date, 'services', v_row.services_text);
end; $$;
revoke execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text,text,text,text,text,text,date,text,uuid) from public, anon, authenticated;
grant  execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text,text,text,text,text,text,date,text,uuid) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the 14-arg uuid-returning link RPC; leaves the audit table +
-- helper RPCs in place — they are harmless. Drop them too only if required):
-- begin;
--   drop function if exists public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text,text,text,text,text,text,date,text,uuid);
--   -- re-create the 14-arg uuid version from docs/whatsapp_quote_books_fix_RUNME.sql
--   drop function if exists public.wa_record_outgoing(uuid,text,text,text,text);
--   drop function if exists public.wa_should_auto_quote(uuid,int);
--   drop function if exists public.wa_log_quote_notify(uuid,uuid,text,text,text,text,text,text,text);
--   drop table if exists public.whatsapp_quote_notify_audit cascade;
-- commit;
