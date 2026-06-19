-- ════════════════════════════════════════════════════════════════════════
-- Kian WhatsApp — quote-request full fields + Zoho Books estimate link.
-- ADDITIVE + REVERSIBLE. No table/column drops, no data deletes.
--
-- Adds the remaining quote-detail columns the inbox modal + public form collect,
-- widens the status set for the estimate lifecycle, separates Zoho CRM (lead) from
-- Zoho Books (estimate) with dedicated estimate columns, and ships the RPCs for:
--   • staff create with FULL fields            (wa_create_quote_request, widened)
--   • staff edit of an existing open request   (wa_update_quote_request, new)
--   • public link-back with FULL fields        (wa_link_quote_request_public, widened)
--   • server write-back of a Books estimate     (wa_set_books_estimate, service_role)
--   • Books-estimate create permission gate     (wa_can_create_books_estimate)
--   • Books-estimate attempt audit              (whatsapp_books_estimate_audit)
--
-- Depends on: docs/whatsapp_ops_batch_RUNME.sql + docs/whatsapp_quote_request_schema_fix_RUNME.sql
-- (whatsapp_quote_requests, wa_link_quote_request_public 8-arg, wa_can_read_dept/routed,
-- wa_create_quote_request 8-arg). Run those first.
--
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- DEPLOY ORDER: run THIS SQL **before** deploying the updated route/page/inbox code.
-- All added RPC params are trailing + nullable-with-default, so the OLD callers keep
-- working during the window; a NEW caller hitting an OLD signature would 404 in PostgREST.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Additive columns ════════════════════════════════════════════════
alter table public.whatsapp_quote_requests add column if not exists email                       text;
alter table public.whatsapp_quote_requests add column if not exists priority                    text;
alter table public.whatsapp_quote_requests add column if not exists lead_source                 text;
alter table public.whatsapp_quote_requests add column if not exists duration                    text;
alter table public.whatsapp_quote_requests add column if not exists assigned_department         text;
alter table public.whatsapp_quote_requests add column if not exists internal_notes              text;
-- Zoho Books estimate (the financial quote/estimate — distinct from the CRM lead):
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_id       text;
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_number   text;
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_url      text;
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_status   text;
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_total    numeric(14,2);
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_currency text;
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_created_by uuid references auth.users(id) on delete set null;
alter table public.whatsapp_quote_requests add column if not exists zoho_books_estimate_created_at timestamptz;
create index if not exists idx_wa_quote_estimate
  on public.whatsapp_quote_requests(zoho_books_estimate_id) where zoho_books_estimate_id is not null;

-- ════════ 2) Widen the status set (additive — keeps all existing values) ══════
-- Original (whatsapp_ops_batch_RUNME.sql): new/in_review/quoted/accepted/rejected/archived.
-- Add the estimate lifecycle: draft/approved/sent/converted/cancelled.
alter table public.whatsapp_quote_requests drop constraint if exists whatsapp_quote_requests_status_check;
alter table public.whatsapp_quote_requests add constraint whatsapp_quote_requests_status_check
  check (status in ('new','in_review','quoted','accepted','rejected','archived',
                    'draft','approved','sent','converted','cancelled'));

-- ════════ 3) Books-estimate attempt audit (additive) ═════════════════════════
create table if not exists public.whatsapp_books_estimate_audit (
  id                uuid primary key default gen_random_uuid(),
  quote_request_id  uuid references public.whatsapp_quote_requests(id) on delete cascade,
  conversation_id   uuid references public.whatsapp_conversations(id) on delete set null,
  actor_id          uuid references auth.users(id) on delete set null,
  action            text not null default 'create_draft'
                      check (action in ('prepare','create_draft','write_back','skipped','blocked','failed')),
  status            text,
  reason            text,
  zoho_books_estimate_id text,
  http_status       int,
  created_at        timestamptz not null default now()
);
create index if not exists idx_wa_books_audit_quote on public.whatsapp_books_estimate_audit(quote_request_id, created_at);
alter table public.whatsapp_books_estimate_audit enable row level security;
drop policy if exists wa_books_audit_read on public.whatsapp_books_estimate_audit;
create policy wa_books_audit_read on public.whatsapp_books_estimate_audit for select to authenticated
  using (public.is_staff() and (public.is_owner() or public.staff_role() in ('manager','finance')));
grant select on public.whatsapp_books_estimate_audit to authenticated;

-- ════════ 4) Permission gate: who may CREATE a Books estimate ════════════════
-- Owner/admin + finance + manager. Sales is PREPARE-ONLY (excluded here).
create or replace function public.wa_can_create_books_estimate()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_staff() and (public.is_owner() or public.staff_role() in ('finance','manager'));
$$;
revoke execute on function public.wa_can_create_books_estimate() from public, anon;
grant  execute on function public.wa_can_create_books_estimate() to authenticated;

-- ════════ 5) Staff create — FULL fields (replace the 8-arg version) ══════════
drop function if exists public.wa_create_quote_request(uuid, text, text, text[], text, date, text, text);
create or replace function public.wa_create_quote_request(
  p_conversation uuid, p_full_name text, p_company text, p_services text[], p_city text,
  p_preferred_date date, p_message text, p_category text,
  p_email text default null, p_budget_range text default null, p_lead_source text default null,
  p_priority text default null, p_duration text default null, p_internal_notes text default null,
  p_assigned_department text default null, p_phone text default null
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
    (whatsapp_conversation_id, whatsapp_contact_id, phone, full_name, company, services, category, city,
     preferred_date, message, budget_range, email, lead_source, priority, duration, internal_notes,
     assigned_department, crm_lead_id, source, created_by)
  values (p_conversation, v_contact, coalesce(nullif(p_phone,''), v_phone), coalesce(nullif(p_full_name,''), v_name), nullif(p_company,''),
          coalesce(p_services,'{}'), nullif(p_category,''), nullif(p_city,''), p_preferred_date,
          nullif(p_message,''), nullif(p_budget_range,''), nullif(p_email,''), nullif(p_lead_source,''),
          nullif(p_priority,''), nullif(p_duration,''), nullif(p_internal_notes,''),
          coalesce(nullif(p_assigned_department,''), v_dept), v_lead, 'whatsapp', auth.uid())
  returning id into v_id;

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
revoke execute on function public.wa_create_quote_request(uuid,text,text,text[],text,date,text,text,text,text,text,text,text,text,text,text) from public, anon;
grant  execute on function public.wa_create_quote_request(uuid,text,text,text[],text,date,text,text,text,text,text,text,text,text,text,text) to authenticated;

-- ════════ 6) Staff edit an existing open request (new) ═══════════════════════
create or replace function public.wa_update_quote_request(
  p_quote_id uuid, p_full_name text, p_company text, p_services text[], p_city text,
  p_preferred_date date, p_message text, p_category text, p_email text, p_budget_range text,
  p_lead_source text, p_priority text, p_duration text, p_internal_notes text,
  p_assigned_department text, p_status text default null, p_phone text default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_conv uuid; v_assigned uuid; v_dept text; v_cat text; v_status text; v_routed text[];
begin
  select q.whatsapp_conversation_id into v_conv from public.whatsapp_quote_requests q where q.id = p_quote_id;
  if not found then raise exception 'quote not found'; end if;
  select c.assigned_to, c.assigned_department, c.category, c.status, c.routed_departments
    into v_assigned, v_dept, v_cat, v_status, v_routed
    from public.whatsapp_conversations c where c.id = v_conv;
  if not (public.wa_can_read_dept(v_assigned, v_dept, v_cat, v_status) or public.wa_can_read_routed(v_routed)) then
    raise exception 'not authorized'; end if;
  if p_status is not null and p_status <> '' and p_status not in
     ('new','in_review','quoted','accepted','rejected','archived','draft','approved','sent','converted','cancelled') then
    raise exception 'invalid status'; end if;

  update public.whatsapp_quote_requests set
    full_name           = coalesce(nullif(p_full_name,''), full_name),
    phone               = coalesce(nullif(p_phone,''), phone),
    company             = coalesce(nullif(p_company,''), company),
    services            = case when coalesce(array_length(p_services,1),0) > 0 then p_services else services end,
    city                = coalesce(nullif(p_city,''), city),
    preferred_date      = coalesce(p_preferred_date, preferred_date),
    message             = coalesce(nullif(p_message,''), message),
    category            = coalesce(nullif(p_category,''), category),
    email               = coalesce(nullif(p_email,''), email),
    budget_range        = coalesce(nullif(p_budget_range,''), budget_range),
    lead_source         = coalesce(nullif(p_lead_source,''), lead_source),
    priority            = coalesce(nullif(p_priority,''), priority),
    duration            = coalesce(nullif(p_duration,''), duration),
    internal_notes      = coalesce(nullif(p_internal_notes,''), internal_notes),
    assigned_department = coalesce(nullif(p_assigned_department,''), assigned_department),
    status              = coalesce(nullif(p_status,''), status),
    updated_at          = now()
  where id = p_quote_id;
  return true;
end; $$;
revoke execute on function public.wa_update_quote_request(uuid,text,text,text[],text,date,text,text,text,text,text,text,text,text,text,text,text) from public, anon;
grant  execute on function public.wa_update_quote_request(uuid,text,text,text[],text,date,text,text,text,text,text,text,text,text,text,text,text) to authenticated;

-- ════════ 7) Public link-back — FULL fields (replace the 8-arg version) ══════
drop function if exists public.wa_link_quote_request_public(uuid, text, text, text[], text, text, text, text);
create or replace function public.wa_link_quote_request_public(
  p_conversation uuid, p_full_name text, p_phone text, p_services text[], p_city text, p_message text,
  p_external_request_id text default null, p_budget_range text default null,
  p_company text default null, p_email text default null, p_lead_source text default null,
  p_priority text default null, p_duration text default null, p_preferred_date date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_contact uuid; v_lead text;
begin
  select contact_id, crm_lead_id into v_contact, v_lead from public.whatsapp_conversations where id = p_conversation;
  if v_contact is null then raise exception 'conversation not found'; end if;
  -- Reuse an existing OPEN request for this conversation (avoid duplicates); else insert.
  -- "open" = not yet resolved: new / in_review / draft. quoted/accepted/converted/etc. → new row.
  select id into v_id from public.whatsapp_quote_requests
   where whatsapp_conversation_id = p_conversation and status in ('new','in_review','draft')
   order by created_at desc limit 1;
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
  return v_id;
end; $$;
revoke execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text,text,text,text,text,text,date) from public, anon, authenticated;
grant  execute on function public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text,text,text,text,text,text,date) to service_role;

-- ════════ 8) Server write-back of a Books estimate (service_role) ════════════
create or replace function public.wa_set_books_estimate(
  p_quote_id uuid, p_estimate_id text, p_estimate_number text, p_estimate_url text,
  p_estimate_status text, p_estimate_total numeric, p_estimate_currency text, p_actor uuid
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_conv uuid;
begin
  select whatsapp_conversation_id into v_conv from public.whatsapp_quote_requests where id = p_quote_id;
  if v_conv is null then raise exception 'quote not found'; end if;
  update public.whatsapp_quote_requests set
    zoho_books_estimate_id       = nullif(p_estimate_id,''),
    zoho_books_estimate_number   = nullif(p_estimate_number,''),
    zoho_books_estimate_url      = nullif(p_estimate_url,''),
    zoho_books_estimate_status   = coalesce(nullif(p_estimate_status,''), 'draft'),
    zoho_books_estimate_total    = p_estimate_total,
    zoho_books_estimate_currency = nullif(p_estimate_currency,''),
    zoho_books_estimate_created_by = p_actor,
    zoho_books_estimate_created_at = now(),
    status = case when status in ('new','in_review') then 'draft' else status end,
    updated_at = now()
  where id = p_quote_id;
  insert into public.whatsapp_books_estimate_audit (quote_request_id, conversation_id, actor_id, action, status, zoho_books_estimate_id)
  values (p_quote_id, v_conv, p_actor, 'write_back', coalesce(nullif(p_estimate_status,''),'draft'), nullif(p_estimate_id,''));
  return true;
end; $$;
revoke execute on function public.wa_set_books_estimate(uuid,text,text,text,text,numeric,text,uuid) from public, anon, authenticated;
grant  execute on function public.wa_set_books_estimate(uuid,text,text,text,text,numeric,text,uuid) to service_role;

-- ════════ 9) Books-estimate audit logger (service_role) ══════════════════════
create or replace function public.wa_log_books_estimate(
  p_quote_id uuid, p_conversation uuid, p_actor uuid, p_action text, p_status text, p_reason text, p_http int
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.whatsapp_books_estimate_audit (quote_request_id, conversation_id, actor_id, action, status, reason, http_status)
  values (p_quote_id, p_conversation, p_actor,
          coalesce(nullif(p_action,''),'create_draft'), nullif(p_status,''), nullif(p_reason,''), p_http);
end; $$;
revoke execute on function public.wa_log_books_estimate(uuid,uuid,uuid,text,text,text,int) from public, anon, authenticated;
grant  execute on function public.wa_log_books_estimate(uuid,uuid,uuid,text,text,text,int) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the 8-arg create + 8-arg link RPCs and the original 6-value
-- status CHECK; leaves the additive columns + audit table in place — they are
-- harmless. Drop them too only if you really want to):
-- begin;
--   drop function if exists public.wa_log_books_estimate(uuid,uuid,uuid,text,text,text,int);
--   drop function if exists public.wa_set_books_estimate(uuid,text,text,text,text,numeric,text,uuid);
--   drop function if exists public.wa_update_quote_request(uuid,text,text,text[],text,date,text,text,text,text,text,text,text,text,text,text,text);
--   drop function if exists public.wa_can_create_books_estimate();
--   drop function if exists public.wa_create_quote_request(uuid,text,text,text[],text,date,text,text,text,text,text,text,text,text,text,text);
--   drop function if exists public.wa_link_quote_request_public(uuid,text,text,text[],text,text,text,text,text,text,text,text,text,date);
--   -- (re-create the prior wa_create_quote_request 8-arg + wa_link_quote_request_public 8-arg from
--   --  docs/whatsapp_ops_batch_RUNME.sql + docs/whatsapp_quote_request_schema_fix_RUNME.sql)
--   alter table public.whatsapp_quote_requests drop constraint if exists whatsapp_quote_requests_status_check;
--   alter table public.whatsapp_quote_requests add constraint whatsapp_quote_requests_status_check
--     check (status in ('new','in_review','quoted','accepted','rejected','archived'));
--   -- drop table if exists public.whatsapp_books_estimate_audit cascade;
--   -- (columns are additive; drop only if required:)
--   -- alter table public.whatsapp_quote_requests
--   --   drop column if exists email, drop column if exists priority, drop column if exists lead_source,
--   --   drop column if exists duration, drop column if exists assigned_department, drop column if exists internal_notes,
--   --   drop column if exists zoho_books_estimate_id, drop column if exists zoho_books_estimate_number,
--   --   drop column if exists zoho_books_estimate_url, drop column if exists zoho_books_estimate_status,
--   --   drop column if exists zoho_books_estimate_total, drop column if exists zoho_books_estimate_currency,
--   --   drop column if exists zoho_books_estimate_created_by, drop column if exists zoho_books_estimate_created_at;
-- commit;
