-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — PRODUCTION RESTORE: latest Quote Requests / Quotes / Zoho flow
-- Run ONCE in the Supabase SQL Editor (idempotent — safe to rerun).
--
-- WHAT THIS RESTORES (from release/portal-whatsapp-final, quote/Zoho/intake ONLY):
--   • quotes / quote_items / quote_revision_requests tables + RLS
--   • invoices display table (Zoho Books is the source of truth) + RLS
--   • public_intake bridge (guest website requests → portal, email-keyed) + RLS
--   • quote_requests intake columns (email/name/company/phone/source/…)
--   • admin quote workflow RPCs: list_pending_quote_requests, get_quote_admin,
--     convert_quote_request, create_quote, set_quote_items, set_quote_status,
--     set_quote_visibility, list_quote_clients, can_manage_quotes
--   • Zoho estimate flow: get_quote_request_for_estimate, upsert_zoho_estimate,
--     approve_quote_for_client, client_respond_quote, promote_and_link_by_email
--   • client quote actions: client_accept_quote, client_request_quote_revision
--   • invoice flow: create_invoice_display, set_invoice_visibility, can_see_invoices,
--     approve_invoice_creation, set_quote_invoice_status, upsert_zoho_invoice
--   • intake/link: capture_public_intake, link_my_records_by_email,
--     resolve_client_id_by_email, my_email
--   • notifications.type CHECK widened to include quote/invoice in-app types
--
-- This file is the 10 release quote/Zoho/intake migrations concatenated in their
-- original chronological (last-definition-wins) order. Each section is its own
-- transaction (begin/commit) and individually idempotent (create-or-replace /
-- if-not-exists / drop-policy-if-exists). SECURITY DEFINER functions set
-- search_path = public and are gated by existing admin/role helpers
-- (can_manage_quotes / can_see_invoices / is_client_owner). RLS is scoped, never
-- broadly weakened.
--
-- SAFELY EXCLUDED (NOT in this file):
--   • notification DELIVERY (notification_deliveries table / delivery processor)
--   • WhatsApp outbound/inbound, n8n, Meta templates, Resend/email SENDING
--   • media / audio / Google Drive / final-delivery worker
--   • Opportunities Center, forum, asset custody, visitor dashboard
--   The only "whatsapp"/"opportunity" tokens below are literals inside the
--   in-app notifications.type CHECK list — no delivery logic is created.
--   ("email linking" = matching records by the user's VERIFIED email; it does
--    NOT send email.)
--
-- DOES NOT TOUCH (verified) the project/review/deliverable objects already fixed
-- on main: notify(), project_client_user_ids(), is_admin(), soft_delete(),
-- admin_set_deliverable(), admin_soft_delete_deliverable(). Those are preserved.
--
-- Chronological (last-wins) run order of the merged sections:
--   1) portal_quotes_invoices               6) portal_invoice_approval
--   2) portal_quotes_invoices_fix           7) portal_email_linking
--   3) portal_zoho_estimates                8) portal_intake_to_quoterequests_bridge
--   4) portal_open_quote_fix                9) portal_guest_quote_publish_fix
--   5) portal_open_quote_admin_get         10) portal_client_quote_visibility_fix
-- ════════════════════════════════════════════════════════════════════════════


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  1/10 — portal_quotes_invoices                                  ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — formal Quotes + Invoices (read-only in the client portal).
-- ADDITIVE + REVERSIBLE. No table/column drops, no data deletes.
--
-- These are the FORMAL priced documents Kian issues, distinct from the existing
-- lightweight quote_requests (the customer's intake request). A quote may link
-- to a quote_request/project; an invoice is a DISPLAY record only — official
-- invoices are issued in Zoho Books, never auto-created here.
--
--   • quotes / quote_items          — priced quote + line items (admin/finance/sales).
--   • quote_revision_requests       — a client's "please revise" note.
--   • invoices                      — read-only invoice display records (owner/finance).
--   • RPCs                          — all writes (no table write grants); notify() on events.
--
-- Visibility: a client sees a quote only when public_portal_visible OR status in
-- (sent,accepted); an invoice only when public_portal_visible. Staff visibility via
-- can_manage_quotes()/can_see_invoices(). Clients can Accept / Request-revision but
-- can NEVER edit prices.
--
-- Depends on: phase0_migration.sql (clients, profiles, notify(), is_admin(),
-- my_client_id(), soft_delete) + staff_roles_task_assignment_RUNME.sql (is_owner(),
-- is_staff(), staff_role(), can_see_financials()). All already live.
-- NOTE: this migration OWNS the public.invoices table (the finance ADDENDUM's
-- invoices block was never run); do NOT also run that PROPOSAL's invoices section.
--
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 0) Helpers (defensive create-or-replace; safe if they already exist) ═
-- Quote managers: owner/admin + manager + sales + finance.
create or replace function public.can_manage_quotes() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','sales','finance');
$$;
-- Invoice viewers/managers: owner/admin + manager + finance (mirrors the finance addendum).
create or replace function public.can_see_invoices() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','finance');
$$;

-- ════════ 1) Notifications type CHECK — preserve the live 13, add 4 ══════════
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
  'project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible'));

-- ════════ 2) quotes + quote_items ════════════════════════════════════════════
create sequence if not exists public.quote_number_seq;
create table if not exists public.quotes (
  id                   uuid primary key default gen_random_uuid(),
  quote_number         text unique,
  client_id            uuid references public.clients(id),
  lead_id              uuid references auth.users(id) on delete set null,
  project_id           uuid references public.projects(id) on delete set null,
  quote_request_id     uuid references public.quote_requests(id) on delete set null,
  status               text not null default 'draft'
                         check (status in ('draft','internal_review','approved','sent','accepted','rejected','expired')),
  currency             text not null default 'SAR',
  subtotal             numeric(14,2) not null default 0,
  vat                  numeric(14,2) not null default 0,
  total                numeric(14,2) not null default 0,
  vat_rate             numeric(5,2)  not null default 15,
  valid_until          date,
  notes                text,
  created_by           uuid references auth.users(id) on delete set null,
  approved_by          uuid references auth.users(id) on delete set null,
  public_portal_visible boolean not null default false,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_quotes_client on public.quotes(client_id, created_at);
create index if not exists idx_quotes_status on public.quotes(status);

create table if not exists public.quote_items (
  id           uuid primary key default gen_random_uuid(),
  quote_id     uuid not null references public.quotes(id) on delete cascade,
  title        text not null,
  description  text,
  quantity     numeric(12,2) not null default 1,
  unit_price   numeric(14,2) not null default 0,
  total        numeric(14,2) not null default 0,
  position     int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists idx_quote_items_quote on public.quote_items(quote_id, position);

create table if not exists public.quote_revision_requests (
  id          uuid primary key default gen_random_uuid(),
  quote_id    uuid not null references public.quotes(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  note        text not null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_quote_rev_quote on public.quote_revision_requests(quote_id, created_at);

-- ════════ 3) invoices (display records; official invoices live in Zoho Books) ═
create table if not exists public.invoices (
  id                   uuid primary key default gen_random_uuid(),
  invoice_number       text,
  zoho_invoice_id      text,
  client_id            uuid references public.clients(id),
  project_id           uuid references public.projects(id) on delete set null,
  status               text not null default 'draft',
  currency             text not null default 'SAR',
  subtotal             numeric(14,2) not null default 0,
  vat                  numeric(14,2) not null default 0,
  total                numeric(14,2) not null default 0,
  due_date             date,
  pdf_url              text,
  public_portal_visible boolean not null default false,
  created_by           uuid references auth.users(id) on delete set null,
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
-- Idempotent column adds (in case a partial invoices table already exists).
alter table public.invoices add column if not exists invoice_number text;
alter table public.invoices add column if not exists subtotal numeric(14,2) not null default 0;
alter table public.invoices add column if not exists vat numeric(14,2) not null default 0;
alter table public.invoices add column if not exists total numeric(14,2) not null default 0;
alter table public.invoices add column if not exists due_date date;
alter table public.invoices add column if not exists pdf_url text;
alter table public.invoices add column if not exists public_portal_visible boolean not null default false;
alter table public.invoices add column if not exists updated_at timestamptz not null default now();
create index if not exists idx_invoices_client on public.invoices(client_id, created_at);

-- ════════ 4) RLS (read-only grants; all writes via SECURITY DEFINER RPCs) ════
alter table public.quotes                  enable row level security;
alter table public.quote_items             enable row level security;
alter table public.quote_revision_requests enable row level security;
alter table public.invoices                enable row level security;
grant select on public.quotes, public.quote_items, public.quote_revision_requests, public.invoices to authenticated;

drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes()
    or (client_id = public.my_client_id() and (public_portal_visible or status in ('sent','accepted')))
  ));

drop policy if exists quote_items_read on public.quote_items;
create policy quote_items_read on public.quote_items for select to authenticated using (
  exists (select 1 from public.quotes q where q.id = quote_items.quote_id and not q.is_deleted and (
    public.can_manage_quotes()
    or (q.client_id = public.my_client_id() and (q.public_portal_visible or q.status in ('sent','accepted')))
  )));

drop policy if exists quote_rev_read on public.quote_revision_requests;
create policy quote_rev_read on public.quote_revision_requests for select to authenticated using (
  public.can_manage_quotes() or author_id = auth.uid());

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated using (
  not is_deleted and (
    public.can_see_invoices()
    or (client_id = public.my_client_id() and public_portal_visible)
  ));

-- ════════ 5) Read RPC: client picker for the admin quote builder ═════════════
create or replace function public.list_quote_clients()
returns table (client_id uuid, label text) language sql stable security definer set search_path = public as $$
  select c.id, coalesce(nullif(p.company,''), nullif(p.full_name,''), p.email)
  from public.clients c join public.profiles p on p.id = c.user_id
  where c.is_deleted = false and public.can_manage_quotes()
  order by 2;
$$;
revoke execute on function public.list_quote_clients() from public, anon;
grant  execute on function public.list_quote_clients() to authenticated;

-- ════════ 6) Quote write RPCs (managers) ═════════════════════════════════════
create or replace function public.create_quote(
  p_client uuid, p_project uuid, p_quote_request uuid, p_valid_until date, p_currency text, p_vat_rate numeric, p_notes text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  v_num := 'Q-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 5, '0');
  insert into public.quotes (quote_number, client_id, project_id, quote_request_id, valid_until, currency, vat_rate, notes, created_by)
  values (v_num, p_client, p_project, p_quote_request, p_valid_until,
          coalesce(nullif(p_currency,''),'SAR'), coalesce(p_vat_rate,15), nullif(p_notes,''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'quote_number', v_num);
end; $$;
revoke execute on function public.create_quote(uuid,uuid,uuid,date,text,numeric,text) from public, anon;
grant  execute on function public.create_quote(uuid,uuid,uuid,date,text,numeric,text) to authenticated;

-- Replace ALL items for a quote (managers) + recompute subtotal/vat/total.
create or replace function public.set_quote_items(p_quote uuid, p_items jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare it jsonb; v_pos int := 0; v_sub numeric(14,2) := 0; v_rate numeric(5,2); v_line numeric(14,2);
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.quotes where id = p_quote and not is_deleted) then raise exception 'quote not found'; end if;
  delete from public.quote_items where quote_id = p_quote;
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    v_line := round(coalesce((it->>'quantity')::numeric,1) * coalesce((it->>'unit_price')::numeric,0), 2);
    insert into public.quote_items (quote_id, title, description, quantity, unit_price, total, position)
    values (p_quote, coalesce(nullif(it->>'title',''),'-'), nullif(it->>'description',''),
            coalesce((it->>'quantity')::numeric,1), coalesce((it->>'unit_price')::numeric,0), v_line, v_pos);
    v_sub := v_sub + v_line; v_pos := v_pos + 1;
  end loop;
  select vat_rate into v_rate from public.quotes where id = p_quote;
  update public.quotes set subtotal = v_sub, vat = round(v_sub * coalesce(v_rate,15) / 100, 2),
         total = v_sub + round(v_sub * coalesce(v_rate,15) / 100, 2), updated_at = now()
   where id = p_quote;
  return true;
end; $$;
revoke execute on function public.set_quote_items(uuid,jsonb) from public, anon;
grant  execute on function public.set_quote_items(uuid,jsonb) to authenticated;

-- Set status (managers). On 'sent' → make visible + notify the client.
create or replace function public.set_quote_status(p_quote uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  if p_status not in ('draft','internal_review','approved','sent','accepted','rejected','expired') then raise exception 'invalid status'; end if;
  update public.quotes set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         public_portal_visible = case when p_status in ('sent','accepted') then true else public_portal_visible end,
         updated_at = now()
   where id = p_quote and not is_deleted
   returning client_id, quote_number into v_client, v_num;
  if not found then raise exception 'quote not found'; end if;
  if p_status = 'sent' then
    select user_id into v_uid from public.clients where id = v_client;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote, 'عرض سعر جديد جاهز: ' || coalesce(v_num,''), 'A new quote is ready: ' || coalesce(v_num,''));
    end if;
  end if;
  return true;
end; $$;
revoke execute on function public.set_quote_status(uuid,text) from public, anon;
grant  execute on function public.set_quote_status(uuid,text) to authenticated;

create or replace function public.set_quote_visibility(p_quote uuid, p_visible boolean) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  update public.quotes set public_portal_visible = coalesce(p_visible,false), updated_at = now() where id = p_quote and not is_deleted;
  return found;
end; $$;
revoke execute on function public.set_quote_visibility(uuid,boolean) from public, anon;
grant  execute on function public.set_quote_visibility(uuid,boolean) to authenticated;

-- ════════ 7) Client actions (own + visible quote; NEVER edits price) ═════════
create or replace function public.client_accept_quote(p_quote uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  update public.quotes set status = 'accepted', public_portal_visible = true, updated_at = now()
   where id = p_quote and not is_deleted and client_id = public.my_client_id()
     and status in ('sent','approved')
   returning quote_number into v_num;
  if not found then raise exception 'quote not available'; end if;
  perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote, 'قبل العميل عرض السعر: ' || coalesce(v_num,''), 'Client accepted quote: ' || coalesce(v_num,''));
  return true;
end; $$;
revoke execute on function public.client_accept_quote(uuid) from public, anon;
grant  execute on function public.client_accept_quote(uuid) to authenticated;

create or replace function public.client_request_quote_revision(p_quote uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if not exists (select 1 from public.quotes where id = p_quote and not is_deleted and client_id = public.my_client_id()
                 and (public_portal_visible or status in ('sent','accepted'))) then raise exception 'quote not available'; end if;
  insert into public.quote_revision_requests (quote_id, author_id, note) values (p_quote, auth.uid(), coalesce(nullif(p_note,''),'-'));
  select quote_number into v_num from public.quotes where id = p_quote;
  perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote, 'طلب العميل تعديل عرض السعر: ' || coalesce(v_num,''), 'Client requested a quote revision: ' || coalesce(v_num,''));
  return true;
end; $$;
revoke execute on function public.client_request_quote_revision(uuid,text) from public, anon;
grant  execute on function public.client_request_quote_revision(uuid,text) to authenticated;

-- ════════ 8) Invoice display records (owner/finance; NO official issuing) ═════
create or replace function public.create_invoice_display(
  p_client uuid, p_project uuid, p_invoice_number text, p_status text, p_subtotal numeric, p_vat numeric,
  p_total numeric, p_currency text, p_due_date date, p_pdf_url text, p_zoho_invoice_id text, p_visible boolean
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_uid uuid;
begin
  if not public.can_see_invoices() then raise exception 'not authorized'; end if;
  insert into public.invoices (client_id, project_id, invoice_number, status, subtotal, vat, total, currency,
                               due_date, pdf_url, zoho_invoice_id, public_portal_visible, created_by)
  values (p_client, p_project, nullif(p_invoice_number,''), coalesce(nullif(p_status,''),'draft'),
          coalesce(p_subtotal,0), coalesce(p_vat,0), coalesce(p_total,0), coalesce(nullif(p_currency,''),'SAR'),
          p_due_date, nullif(p_pdf_url,''), nullif(p_zoho_invoice_id,''), coalesce(p_visible,false), auth.uid())
  returning id into v_id;
  if coalesce(p_visible,false) then
    select user_id into v_uid from public.clients where id = p_client;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'invoice_visible', 'invoice', v_id, 'فاتورة جديدة متاحة: ' || coalesce(p_invoice_number,''), 'A new invoice is available: ' || coalesce(p_invoice_number,''));
    end if;
  end if;
  return v_id;
end; $$;
revoke execute on function public.create_invoice_display(uuid,uuid,text,text,numeric,numeric,numeric,text,date,text,text,boolean) from public, anon;
grant  execute on function public.create_invoice_display(uuid,uuid,text,text,numeric,numeric,numeric,text,date,text,text,boolean) to authenticated;

create or replace function public.set_invoice_visibility(p_invoice uuid, p_visible boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text; v_was boolean;
begin
  if not public.can_see_invoices() then raise exception 'not authorized'; end if;
  select public_portal_visible, client_id, invoice_number into v_was, v_client, v_num from public.invoices where id = p_invoice and not is_deleted;
  if not found then raise exception 'invoice not found'; end if;
  update public.invoices set public_portal_visible = coalesce(p_visible,false), updated_at = now() where id = p_invoice;
  if coalesce(p_visible,false) and not coalesce(v_was,false) then
    select user_id into v_uid from public.clients where id = v_client;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'invoice_visible', 'invoice', p_invoice, 'فاتورة جديدة متاحة: ' || coalesce(v_num,''), 'A new invoice is available: ' || coalesce(v_num,''));
    end if;
  end if;
  return true;
end; $$;
revoke execute on function public.set_invoice_visibility(uuid,boolean) from public, anon;
grant  execute on function public.set_invoice_visibility(uuid,boolean) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the prior notifications CHECK; leaves the additive tables +
-- helpers — they are harmless. Drop them too only if you really want to):
-- begin;
--   drop function if exists public.set_invoice_visibility(uuid,boolean);
--   drop function if exists public.create_invoice_display(uuid,uuid,text,text,numeric,numeric,numeric,text,date,text,text,boolean);
--   drop function if exists public.client_request_quote_revision(uuid,text);
--   drop function if exists public.client_accept_quote(uuid);
--   drop function if exists public.set_quote_visibility(uuid,boolean);
--   drop function if exists public.set_quote_status(uuid,text);
--   drop function if exists public.set_quote_items(uuid,jsonb);
--   drop function if exists public.create_quote(uuid,uuid,uuid,date,text,numeric,text);
--   drop function if exists public.list_quote_clients();
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check check (type in (
--     'quote_request_new','message_new','file_link_new','project_note_new',
--     'deliverable_new','revision_requested','deliverable_approved',
--     'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
--     'project_brief_new','portal_request_new'));
--   -- drop table if exists public.quote_revision_requests cascade;
--   -- drop table if exists public.quote_items cascade;
--   -- drop table if exists public.quotes cascade;
--   -- drop table if exists public.invoices cascade;       -- ONLY if no Zoho data yet
--   -- drop sequence if exists public.quote_number_seq;
--   -- drop function if exists public.can_manage_quotes();
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  2/10 — portal_quotes_invoices_fix                              ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Quotes & Invoices corrective patch. ADDITIVE + REVERSIBLE.
--
--   1. Link formal quotes to quote_requests (convert flow + client_id resolution).
--   2. Pending-requests feed for the admin quotes screen.
--   3. Block sending / showing an EMPTY or ZERO-total quote (RPC + RLS hardening).
--   4. Zoho Books invoice READ-ONLY upsert (no official invoice is ever created here).
--
-- Depends on: docs/portal_quotes_invoices_RUNME.sql (already run — quotes/quote_items/
-- invoices + can_manage_quotes()/can_see_invoices()) + phase0 (quote_requests, clients,
-- profiles, my_client_id(), notify()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- DEPLOY ORDER: run THIS SQL **before** deploying the updated code — create_quote is
-- widened (now takes p_title) and the convert/pending/Zoho-sync RPCs are new, so the
-- updated UI calls them; an old DB without this patch would 404 those calls.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Additive columns ════════════════════════════════════════════════
alter table public.quotes   add column if not exists title  text;
alter table public.invoices add column if not exists zoho_customer_id text;
alter table public.invoices add column if not exists source text not null default 'manual';  -- 'manual' | 'zoho'
grant execute on function public.can_see_invoices() to authenticated;  -- callable by the sync route gate

-- ════════ 2) client_id resolution by email (RLS-safe; SECURITY DEFINER) ══════
create or replace function public.resolve_client_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clients c join public.profiles p on p.id = c.user_id
  where p_email is not null and lower(p.email) = lower(p_email) and c.is_deleted = false
  limit 1;
$$;
revoke execute on function public.resolve_client_id_by_email(text) from public, anon;
grant  execute on function public.resolve_client_id_by_email(text) to authenticated, service_role;

-- ════════ 3) Harden quotes_read RLS — a client never sees an empty/zero quote ═
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes()
    or (client_id = public.my_client_id()
        and (public_portal_visible or status in ('sent','accepted'))
        and total > 0
        and exists (select 1 from public.quote_items qi where qi.quote_id = quotes.id))
  ));

-- ════════ 4) Widen create_quote with a title (drop the prior 7-arg) ══════════
drop function if exists public.create_quote(uuid, uuid, uuid, date, text, numeric, text);
create or replace function public.create_quote(
  p_client uuid, p_project uuid, p_quote_request uuid, p_valid_until date, p_currency text, p_vat_rate numeric, p_notes text,
  p_title text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_num text;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  v_num := 'Q-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 5, '0');
  insert into public.quotes (quote_number, client_id, project_id, quote_request_id, title, valid_until, currency, vat_rate, notes, created_by)
  values (v_num, p_client, p_project, p_quote_request, nullif(p_title,''), p_valid_until,
          coalesce(nullif(p_currency,''),'SAR'), coalesce(p_vat_rate,15), nullif(p_notes,''), auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'quote_number', v_num);
end; $$;
revoke execute on function public.create_quote(uuid,uuid,uuid,date,text,numeric,text,text) from public, anon;
grant  execute on function public.create_quote(uuid,uuid,uuid,date,text,numeric,text,text) to authenticated;

-- ════════ 5) Convert a quote_request → formal quote (prefilled + linked) ══════
create or replace function public.convert_quote_request(p_request uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_req record; v_email text; v_client uuid; v_id uuid; v_num text; v_title text;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select qr.id, qr.user_id, qr.services, qr.description, coalesce(qr.is_deleted,false) as del
    into v_req from public.quote_requests qr where qr.id = p_request;
  if not found or v_req.del then raise exception 'request not found'; end if;
  select email into v_email from public.profiles where id = v_req.user_id;
  -- client_id: (a) membership via the request's user, else (b) email match.
  select id into v_client from public.clients where user_id = v_req.user_id and is_deleted = false limit 1;
  if v_client is null then v_client := public.resolve_client_id_by_email(v_email); end if;
  -- Reuse an existing draft quote already linked to this request (don't duplicate).
  select id, quote_number into v_id, v_num from public.quotes
   where quote_request_id = p_request and not is_deleted and status in ('draft','internal_review')
   order by created_at desc limit 1;
  if v_id is not null then return jsonb_build_object('id', v_id, 'quote_number', v_num, 'reused', true); end if;
  v_title := coalesce(nullif(array_to_string(v_req.services, '، '),''), 'عرض سعر');
  v_num := 'Q-' || to_char(now(),'YYYY') || '-' || lpad(nextval('public.quote_number_seq')::text, 5, '0');
  insert into public.quotes (quote_number, client_id, lead_id, quote_request_id, title, notes, currency, vat_rate, created_by)
  values (v_num, v_client, v_req.user_id, p_request, v_title, nullif(v_req.description,''), 'SAR', 15, auth.uid())
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'quote_number', v_num, 'client_id', v_client, 'reused', false);
end; $$;
revoke execute on function public.convert_quote_request(uuid) from public, anon;
grant  execute on function public.convert_quote_request(uuid) to authenticated;

-- ════════ 6) Pending quote_requests awaiting pricing (for the admin screen) ══
create or replace function public.list_pending_quote_requests()
returns table (id uuid, reference text, services text[], email text, city text, budget_range text,
               status text, created_at timestamptz, has_quote boolean)
language sql stable security definer set search_path = public as $$
  select qr.id, qr.reference, qr.services, p.email, qr.city, qr.budget_range, qr.status, qr.created_at,
         exists (select 1 from public.quotes q where q.quote_request_id = qr.id and not q.is_deleted)
  from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
  where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
    and qr.status in ('new','in_review','quoted')
  order by qr.created_at desc;
$$;
revoke execute on function public.list_pending_quote_requests() from public, anon;
grant  execute on function public.list_pending_quote_requests() to authenticated;

-- ════════ 7) Guard: no EMPTY/ZERO quote may be sent/accepted/made visible ════
create or replace function public.set_quote_status(p_quote uuid, p_status text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text; v_total numeric; v_items int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  if p_status not in ('draft','internal_review','approved','sent','accepted','rejected','expired') then raise exception 'invalid status'; end if;
  if p_status in ('sent','accepted') then
    select total, (select count(*) from public.quote_items qi where qi.quote_id = p_quote) into v_total, v_items from public.quotes where id = p_quote;
    if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then
      raise exception 'empty_or_zero_quote';  -- add line items with a total > 0 first
    end if;
  end if;
  update public.quotes set status = p_status,
         approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
         public_portal_visible = case when p_status in ('sent','accepted') then true else public_portal_visible end,
         updated_at = now()
   where id = p_quote and not is_deleted
   returning client_id, quote_number into v_client, v_num;
  if not found then raise exception 'quote not found'; end if;
  if p_status = 'sent' then
    select user_id into v_uid from public.clients where id = v_client;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote, 'عرض سعر جديد جاهز: ' || coalesce(v_num,''), 'A new quote is ready: ' || coalesce(v_num,''));
    end if;
  end if;
  return true;
end; $$;
revoke execute on function public.set_quote_status(uuid,text) from public, anon;
grant  execute on function public.set_quote_status(uuid,text) to authenticated;

create or replace function public.set_quote_visibility(p_quote uuid, p_visible boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_items int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  if coalesce(p_visible,false) then
    select total, (select count(*) from public.quote_items qi where qi.quote_id = p_quote) into v_total, v_items from public.quotes where id = p_quote;
    if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;
  end if;
  update public.quotes set public_portal_visible = coalesce(p_visible,false), updated_at = now() where id = p_quote and not is_deleted;
  return found;
end; $$;
revoke execute on function public.set_quote_visibility(uuid,boolean) from public, anon;
grant  execute on function public.set_quote_visibility(uuid,boolean) to authenticated;

create or replace function public.client_accept_quote(p_quote uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text; v_total numeric; v_items int;
begin
  select total, (select count(*) from public.quote_items qi where qi.quote_id = p_quote) into v_total, v_items
    from public.quotes where id = p_quote and not is_deleted and client_id = public.my_client_id() and status in ('sent','approved');
  if not found then raise exception 'quote not available'; end if;
  if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;
  update public.quotes set status = 'accepted', public_portal_visible = true, updated_at = now() where id = p_quote
   returning quote_number into v_num;
  perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote, 'قبل العميل عرض السعر: ' || coalesce(v_num,''), 'Client accepted quote: ' || coalesce(v_num,''));
  return true;
end; $$;
revoke execute on function public.client_accept_quote(uuid) from public, anon;
grant  execute on function public.client_accept_quote(uuid) to authenticated;

-- ════════ 8) Zoho Books invoice upsert — READ-ONLY mirror (service_role) ═════
-- Called by the server sync route after it READS invoices from Zoho Books. This
-- NEVER creates/sends/voids anything in Zoho — it only stores a display record.
create or replace function public.upsert_zoho_invoice(
  p_zoho_invoice_id text, p_zoho_customer_id text, p_email text, p_invoice_number text, p_status text,
  p_currency text, p_subtotal numeric, p_vat numeric, p_total numeric, p_due_date date, p_pdf_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_id uuid;
begin
  if p_zoho_invoice_id is null or length(trim(p_zoho_invoice_id)) = 0 then raise exception 'zoho_invoice_id required'; end if;
  v_client := public.resolve_client_id_by_email(p_email);
  select id into v_id from public.invoices where zoho_invoice_id = p_zoho_invoice_id limit 1;
  if v_id is not null then
    -- Update facts; PRESERVE finance's manual visibility choice on re-sync.
    update public.invoices set
      zoho_customer_id = coalesce(nullif(p_zoho_customer_id,''), zoho_customer_id),
      client_id = coalesce(v_client, client_id),
      invoice_number = coalesce(nullif(p_invoice_number,''), invoice_number),
      status = coalesce(nullif(p_status,''), status), currency = coalesce(nullif(p_currency,''), currency),
      subtotal = coalesce(p_subtotal, subtotal), vat = coalesce(p_vat, vat), total = coalesce(p_total, total),
      due_date = coalesce(p_due_date, due_date), pdf_url = coalesce(nullif(p_pdf_url,''), pdf_url),
      source = 'zoho', updated_at = now()
    where id = v_id;
  else
    insert into public.invoices (zoho_invoice_id, zoho_customer_id, client_id, invoice_number, status, currency,
                                 subtotal, vat, total, due_date, pdf_url, source, public_portal_visible)
    values (p_zoho_invoice_id, nullif(p_zoho_customer_id,''), v_client, nullif(p_invoice_number,''),
            coalesce(nullif(p_status,''),'sent'), coalesce(nullif(p_currency,''),'SAR'),
            coalesce(p_subtotal,0), coalesce(p_vat,0), coalesce(p_total,0), p_due_date, nullif(p_pdf_url,''),
            'zoho', true)  -- official issued invoices are shown to the matched client by default
    returning id into v_id;
  end if;
  return v_id;
end; $$;
revoke execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text) from public, anon, authenticated;
grant  execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the prior create_quote/status/visibility/accept + quotes_read
-- policy; leaves the additive columns + new read RPCs — they are harmless):
-- begin;
--   drop function if exists public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text);
--   drop function if exists public.list_pending_quote_requests();
--   drop function if exists public.convert_quote_request(uuid);
--   drop function if exists public.resolve_client_id_by_email(text);
--   drop function if exists public.create_quote(uuid,uuid,uuid,date,text,numeric,text,text);
--   -- (re-create the prior create_quote 7-arg + set_quote_status/visibility/client_accept_quote
--   --  WITHOUT the empty/zero guard, and the quotes_read policy WITHOUT total>0, from
--   --  docs/portal_quotes_invoices_RUNME.sql if you truly need to revert the guards.)
--   -- alter table public.quotes drop column if exists title;
--   -- alter table public.invoices drop column if exists zoho_customer_id, drop column if exists source;
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  3/10 — portal_zoho_estimates                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Zoho Books Estimates as the source of truth for official quotes.
-- ADDITIVE + REVERSIBLE. No table/column drops, no data deletes.
--
-- The portal MIRRORS Zoho estimates into the existing `quotes` table (kept as the
-- local cache/fallback; legacy local quotes stay as source='local'). A client sees
-- an estimate only when an admin approves it (public_portal_visible) AND it has
-- line items AND total>0. Same-email visibility: a logged-in user sees a quote
-- whose email == their VERIFIED profile email (signup confirms email), with NO
-- risky auto-creation of a clients row.
--
-- Depends on: portal_quotes_invoices_RUNME.sql + portal_quotes_invoices_fix_RUNME.sql
-- (quotes/quote_items, can_manage_quotes(), resolve_client_id_by_email()). Run those
-- first. This file re-creates resolve_client_id_by_email() idempotently so it is safe
-- even if the fix patch hasn't been applied yet.
--
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- DEPLOY ORDER: run THIS SQL before deploying the updated code.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Mirror columns on quotes (idempotent; title too in case the fix
--             patch wasn't run yet) ═══════════════════════════════════════════
alter table public.quotes add column if not exists title             text;
alter table public.quotes add column if not exists email             text;
alter table public.quotes add column if not exists zoho_customer_id  text;
alter table public.quotes add column if not exists zoho_estimate_id  text;
alter table public.quotes add column if not exists estimate_number   text;
alter table public.quotes add column if not exists estimate_url      text;
alter table public.quotes add column if not exists source            text not null default 'local';  -- 'local' | 'zoho'
alter table public.quotes add column if not exists client_response   text not null default 'pending'
                                                     check (client_response in ('pending','accepted','declined'));
alter table public.quotes add column if not exists admin_approved_at timestamptz;
alter table public.quotes add column if not exists admin_approved_by uuid references auth.users(id) on delete set null;
alter table public.quotes add column if not exists synced_at         timestamptz;
alter table public.quotes add column if not exists raw_payload       jsonb;
create index if not exists idx_quotes_zoho_estimate on public.quotes(zoho_estimate_id) where zoho_estimate_id is not null;
create index if not exists idx_quotes_email on public.quotes(lower(email));

-- ════════ 2) Helpers (idempotent) ════════════════════════════════════════════
create or replace function public.my_email() returns text
language sql stable security definer set search_path = public as $$
  select email from public.profiles where id = auth.uid();
$$;
revoke execute on function public.my_email() from public, anon;
grant  execute on function public.my_email() to authenticated;

create or replace function public.resolve_client_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clients c join public.profiles p on p.id = c.user_id
  where p_email is not null and lower(p.email) = lower(p_email) and c.is_deleted = false
  limit 1;
$$;
revoke execute on function public.resolve_client_id_by_email(text) from public, anon;
grant  execute on function public.resolve_client_id_by_email(text) to authenticated, service_role;

-- ════════ 3) RLS — own (client_id OR verified email) + visible + non-empty ════
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes()
    or ((client_id = public.my_client_id()
         or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (public_portal_visible or status in ('sent','accepted'))
        and total > 0
        and exists (select 1 from public.quote_items qi where qi.quote_id = quotes.id))
  ));

drop policy if exists quote_items_read on public.quote_items;
create policy quote_items_read on public.quote_items for select to authenticated using (
  exists (select 1 from public.quotes q where q.id = quote_items.quote_id and not q.is_deleted and (
    public.can_manage_quotes()
    or ((q.client_id = public.my_client_id()
         or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (q.public_portal_visible or q.status in ('sent','accepted')) and q.total > 0)
  )));

-- ════════ 4) Read a quote_request's contact + services (for the create route) ═
create or replace function public.get_quote_request_for_estimate(p_request uuid)
returns table (email text, full_name text, company text, phone text, services text[], description text)
language sql stable security definer set search_path = public as $$
  select p.email, p.full_name, p.company, p.mobile, qr.services, qr.description
  from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
  where qr.id = p_request and coalesce(qr.is_deleted,false) = false;
$$;
revoke execute on function public.get_quote_request_for_estimate(uuid) from public, anon, authenticated;
grant  execute on function public.get_quote_request_for_estimate(uuid) to service_role;

-- ════════ 5) Mirror a Zoho estimate into quotes (+ line items) (service_role) ═
create or replace function public.upsert_zoho_estimate(
  p_zoho_estimate_id text, p_zoho_customer_id text, p_quote_request uuid, p_email text,
  p_estimate_number text, p_zoho_status text, p_currency text, p_subtotal numeric, p_vat numeric,
  p_total numeric, p_estimate_url text, p_items jsonb, p_raw jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_client uuid; v_status text; it jsonb; v_pos int := 0;
begin
  if p_zoho_estimate_id is null or length(trim(p_zoho_estimate_id)) = 0 then raise exception 'zoho_estimate_id required'; end if;
  v_client := public.resolve_client_id_by_email(p_email);
  if v_client is null and p_quote_request is not null then
    select id into v_client from public.clients where user_id = (select user_id from public.quote_requests where id = p_quote_request) and is_deleted = false limit 1;
  end if;
  v_status := case lower(coalesce(p_zoho_status,''))
                when 'draft' then 'draft' when 'sent' then 'sent' when 'accepted' then 'accepted'
                when 'declined' then 'rejected' when 'invoiced' then 'accepted' when 'expired' then 'expired'
                else 'internal_review' end;

  select id into v_id from public.quotes where zoho_estimate_id = p_zoho_estimate_id limit 1;
  if v_id is not null then
    update public.quotes set
      zoho_customer_id = coalesce(nullif(p_zoho_customer_id,''), zoho_customer_id),
      client_id = coalesce(v_client, client_id), email = coalesce(nullif(p_email,''), email),
      quote_request_id = coalesce(p_quote_request, quote_request_id),
      estimate_number = coalesce(nullif(p_estimate_number,''), estimate_number),
      estimate_url = coalesce(nullif(p_estimate_url,''), estimate_url),
      status = v_status, currency = coalesce(nullif(p_currency,''), currency),
      subtotal = coalesce(p_subtotal, subtotal), vat = coalesce(p_vat, vat), total = coalesce(p_total, total),
      source = 'zoho', synced_at = now(), raw_payload = coalesce(p_raw, raw_payload), updated_at = now()
      -- PRESERVE public_portal_visible / admin_approved_* / client_response on re-sync.
    where id = v_id;
  else
    insert into public.quotes (quote_number, client_id, email, quote_request_id, zoho_customer_id, zoho_estimate_id,
      estimate_number, estimate_url, status, currency, subtotal, vat, total, source, synced_at, raw_payload, public_portal_visible)
    values (coalesce(nullif(p_estimate_number,''), 'EST-' || left(p_zoho_estimate_id,8)), v_client, nullif(p_email,''),
      p_quote_request, nullif(p_zoho_customer_id,''), p_zoho_estimate_id, nullif(p_estimate_number,''),
      nullif(p_estimate_url,''), v_status, coalesce(nullif(p_currency,''),'SAR'), coalesce(p_subtotal,0),
      coalesce(p_vat,0), coalesce(p_total,0), 'zoho', now(), p_raw, false)  -- hidden until admin approves
    returning id into v_id;
  end if;

  -- Mirror line items (display) from Zoho.
  delete from public.quote_items where quote_id = v_id;
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.quote_items (quote_id, title, description, quantity, unit_price, total, position)
    values (v_id, coalesce(nullif(it->>'title',''),'-'), nullif(it->>'description',''),
            coalesce((it->>'quantity')::numeric,1), coalesce((it->>'unit_price')::numeric,0),
            coalesce((it->>'total')::numeric, round(coalesce((it->>'quantity')::numeric,1)*coalesce((it->>'unit_price')::numeric,0),2)), v_pos);
    v_pos := v_pos + 1;
  end loop;
  return v_id;
end; $$;
revoke execute on function public.upsert_zoho_estimate(text,text,uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb,jsonb) from public, anon, authenticated;
grant  execute on function public.upsert_zoho_estimate(text,text,uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb,jsonb) to service_role;

-- ════════ 6) Admin approval → expose to client (validates non-empty) ═════════
create or replace function public.approve_quote_for_client(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text; v_total numeric; v_items int;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select total, client_id, coalesce(estimate_number, quote_number),
         (select count(*) from public.quote_items qi where qi.quote_id = p_quote)
    into v_total, v_client, v_num, v_items from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;
  if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;
  update public.quotes set public_portal_visible = true, admin_approved_at = now(), admin_approved_by = auth.uid(),
         status = case when status in ('draft','internal_review','approved') then 'sent' else status end, updated_at = now()
   where id = p_quote;
  select user_id into v_uid from public.clients where id = v_client;
  if v_uid is not null then
    perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote, 'عرض سعر جاهز للمراجعة: ' || coalesce(v_num,''), 'A quote is ready for review: ' || coalesce(v_num,''));
  end if;
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.approve_quote_for_client(uuid) from public, anon;
grant  execute on function public.approve_quote_for_client(uuid) to authenticated;

-- ════════ 7) Client accept / decline (own by client_id OR verified email) ════
create or replace function public.client_respond_quote(p_quote uuid, p_response text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if p_response not in ('accepted','declined') then raise exception 'invalid response'; end if;
  if not exists (select 1 from public.quotes q where q.id = p_quote and not q.is_deleted
                 and (q.client_id = public.my_client_id() or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
                 and (q.public_portal_visible or q.status in ('sent','accepted'))
                 and q.total > 0 and exists (select 1 from public.quote_items qi where qi.quote_id = q.id))
  then raise exception 'quote not available'; end if;
  update public.quotes set client_response = p_response,
         status = case when p_response = 'accepted' then 'accepted' else 'rejected' end, updated_at = now()
   where id = p_quote returning coalesce(estimate_number, quote_number) into v_num;
  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.quote_revision_requests (quote_id, author_id, note) values (p_quote, auth.uid(), trim(p_note));
  end if;
  if p_response = 'accepted' then
    perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote, 'قبل العميل العرض: ' || coalesce(v_num,''), 'Client accepted quote: ' || coalesce(v_num,''));
  else
    perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote, 'رفض/طلب تعديل العرض: ' || coalesce(v_num,''), 'Client declined / requested revision: ' || coalesce(v_num,''));
  end if;
  return true;
end; $$;
revoke execute on function public.client_respond_quote(uuid,text,text) from public, anon;
grant  execute on function public.client_respond_quote(uuid,text,text) to authenticated;

-- ════════ 8) Same-email linking (no risky clients-row creation) ══════════════
-- Backfills client_id on email-matched quotes when the user already has a clients
-- row, so their quotes attach to their client context. Visibility itself works via
-- the email-match RLS above even without a clients row.
create or replace function public.promote_and_link_by_email() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text; v_client uuid; v_linked int := 0; v_recognized boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select email into v_email from public.profiles where id = auth.uid();
  v_recognized := exists (select 1 from public.quotes q where lower(coalesce(q.email,'')) = lower(coalesce(v_email,'')) and not q.is_deleted)
               or exists (select 1 from public.quote_requests qr join public.profiles p on p.id = qr.user_id where lower(p.email) = lower(coalesce(v_email,'')));
  select id into v_client from public.clients where user_id = auth.uid() and is_deleted = false limit 1;
  if v_client is not null and v_email is not null then
    update public.quotes set client_id = v_client, updated_at = now()
     where client_id is null and lower(coalesce(email,'')) = lower(v_email) and not is_deleted;
    get diagnostics v_linked = row_count;
  end if;
  return jsonb_build_object('recognized', v_recognized, 'linked', v_linked, 'has_client', v_client is not null);
end; $$;
revoke execute on function public.promote_and_link_by_email() from public, anon;
grant  execute on function public.promote_and_link_by_email() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restores the prior quotes_read/quote_items_read policies; leaves the
-- additive columns + new RPCs — they are harmless):
-- begin;
--   drop function if exists public.promote_and_link_by_email();
--   drop function if exists public.client_respond_quote(uuid,text,text);
--   drop function if exists public.approve_quote_for_client(uuid);
--   drop function if exists public.upsert_zoho_estimate(text,text,uuid,text,text,text,text,numeric,numeric,numeric,text,jsonb,jsonb);
--   drop function if exists public.get_quote_request_for_estimate(uuid);
--   drop function if exists public.my_email();
--   -- re-create quotes_read / quote_items_read WITHOUT the email-match branch from
--   -- docs/portal_quotes_invoices_fix_RUNME.sql if you need to revert visibility.
--   -- alter table public.quotes drop column if exists zoho_estimate_id, ... (optional)
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  4/10 — portal_open_quote_fix                                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — "Open quote" fix. ADDITIVE (function replacement only).
--
-- list_pending_quote_requests() previously returned only has_quote (boolean), so
-- the admin UI had to GUESS the linked quote by client-side matching — which fails
-- when that quote isn't in the currently-loaded list. This returns the ACTUAL
-- linked quote id + number + Zoho estimate fields so the button opens it directly.
--
-- No tables/columns added; no data changed. Depends on portal_quotes_invoices_*
-- + portal_zoho_estimates_RUNME (quotes incl. zoho_estimate_id/estimate_number/url).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

begin;

drop function if exists public.list_pending_quote_requests();

create or replace function public.list_pending_quote_requests()
returns table (
  id uuid, reference text, services text[], email text, city text, budget_range text,
  status text, created_at timestamptz, has_quote boolean,
  linked_quote_id uuid, quote_number text, zoho_estimate_id text, estimate_number text, estimate_url text
) language sql stable security definer set search_path = public as $$
  select qr.id, qr.reference, qr.services, p.email, qr.city, qr.budget_range, qr.status, qr.created_at,
         (lq.id is not null) as has_quote,
         lq.id, lq.quote_number, lq.zoho_estimate_id, lq.estimate_number, lq.estimate_url
  from public.quote_requests qr
  left join public.profiles p on p.id = qr.user_id
  left join lateral (
    select q.id, q.quote_number, q.zoho_estimate_id, q.estimate_number, q.estimate_url
    from public.quotes q
    where q.quote_request_id = qr.id and not q.is_deleted
    order by q.created_at desc
    limit 1
  ) lq on true
  where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
    and qr.status in ('new','in_review','quoted')
  order by qr.created_at desc;
$$;
revoke execute on function public.list_pending_quote_requests() from public, anon;
grant  execute on function public.list_pending_quote_requests() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restore the has_quote-only version):
-- begin;
--   create or replace function public.list_pending_quote_requests()
--   returns table (id uuid, reference text, services text[], email text, city text, budget_range text,
--                  status text, created_at timestamptz, has_quote boolean)
--   language sql stable security definer set search_path = public as $$
--     select qr.id, qr.reference, qr.services, p.email, qr.city, qr.budget_range, qr.status, qr.created_at,
--            exists (select 1 from public.quotes q where q.quote_request_id = qr.id and not q.is_deleted)
--     from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
--     where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
--       and qr.status in ('new','in_review','quoted')
--     order by qr.created_at desc;
--   $$;
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  5/10 — portal_open_quote_admin_get                             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — admin single-quote getter (fixes "Open quote"). ADDITIVE.
--
-- The admin "Open quote" flow read the quote via the quotes table (RLS). For some
-- staff viewers that direct SELECT returns 0 rows even though they manage quotes
-- (they CAN see the linkage via list_pending_quote_requests(), a SECURITY DEFINER
-- function gated by can_manage_quotes()). This getter uses the SAME gate so any
-- quote-manager can open ANY quote (incl. draft / zero-total) for review — exactly
-- like the pending list. No RLS change; no tables/columns/data changed.
--
-- Depends on portal_quotes_invoices_* (quotes/quote_items, can_manage_quotes()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- Returns { quote: {...}, items: [...] } for a quote-manager; null if not found.
create or replace function public.get_quote_admin(p_quote uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_quote jsonb; v_items jsonb;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;
  select to_jsonb(q.*) into v_quote from public.quotes q where q.id = p_quote and not q.is_deleted;
  if v_quote is null then return null; end if;
  select coalesce(jsonb_agg(to_jsonb(i.*) order by i.position, i.created_at), '[]'::jsonb)
    into v_items from public.quote_items i where i.quote_id = p_quote;
  return jsonb_build_object('quote', v_quote, 'items', v_items);
end; $$;
revoke execute on function public.get_quote_admin(uuid) from public, anon;
grant  execute on function public.get_quote_admin(uuid) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.get_quote_admin(uuid);
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  6/10 — portal_invoice_approval                                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — Tax-invoice approval flow after estimate acceptance. ADDITIVE.
--
-- When a client ACCEPTS a Zoho estimate, NO invoice is auto-created. Instead the
-- quote is marked invoice_approval_pending and owner/admin/finance/manager are
-- notified to approve creating the official tax invoice. An authorized user then
-- approves; the server creates the invoice in Zoho Books (if env/scopes allow) and
-- mirrors it locally read-only. Duplicate creation is prevented. Zoho Books stays
-- the source of truth; nothing is emailed to the client automatically.
--
-- Depends on portal_quotes_invoices_* + portal_zoho_estimates_RUNME (quotes/invoices,
-- can_see_invoices(), client_respond_quote, upsert_zoho_invoice, notify()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. DEPLOY ORDER:
-- run this BEFORE deploying the code (client_respond_quote + upsert_zoho_invoice change).
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Columns ═════════════════════════════════════════════════════════
alter table public.quotes add column if not exists invoice_approval_status text not null default 'none'
  check (invoice_approval_status in ('none','invoice_approval_pending','invoice_creation_approved','invoice_created','invoice_creation_failed'));
alter table public.quotes add column if not exists invoice_approved_by uuid references auth.users(id) on delete set null;
alter table public.quotes add column if not exists invoice_approved_at timestamptz;
alter table public.quotes add column if not exists linked_invoice_id uuid references public.invoices(id) on delete set null;

alter table public.invoices add column if not exists quote_id uuid references public.quotes(id) on delete set null;
alter table public.invoices add column if not exists zoho_estimate_id text;
alter table public.invoices add column if not exists line_items jsonb;
create index if not exists idx_invoices_zoho_estimate on public.invoices(zoho_estimate_id) where zoho_estimate_id is not null;
create index if not exists idx_invoices_quote on public.invoices(quote_id) where quote_id is not null;

-- ════════ 2) Notifications CHECK — preserve live 17, add 3 ═══════════════════
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new',
  'deliverable_new','revision_requested','deliverable_approved',
  'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
  'project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed'));

-- ════════ 3) client_respond_quote — on accept, queue invoice approval ════════
create or replace function public.client_respond_quote(p_quote uuid, p_response text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text; r record;
begin
  if p_response not in ('accepted','declined') then raise exception 'invalid response'; end if;
  if not exists (select 1 from public.quotes q where q.id = p_quote and not q.is_deleted
                 and (q.client_id = public.my_client_id() or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
                 and (q.public_portal_visible or q.status in ('sent','accepted'))
                 and q.total > 0 and exists (select 1 from public.quote_items qi where qi.quote_id = q.id))
  then raise exception 'quote not available'; end if;
  update public.quotes set client_response = p_response,
         status = case when p_response = 'accepted' then 'accepted' else 'rejected' end,
         invoice_approval_status = case when p_response = 'accepted' and invoice_approval_status in ('none','invoice_creation_failed')
                                        then 'invoice_approval_pending' else invoice_approval_status end,
         updated_at = now()
   where id = p_quote returning coalesce(estimate_number, quote_number) into v_num;
  if p_note is not null and length(trim(p_note)) > 0 then
    insert into public.quote_revision_requests (quote_id, author_id, note) values (p_quote, auth.uid(), trim(p_note));
  end if;
  if p_response = 'accepted' then
    perform public.notify(null, 'admin', 'quote_accepted', 'quote', p_quote, 'قبل العميل العرض: ' || coalesce(v_num,''), 'Client accepted quote: ' || coalesce(v_num,''));
    -- Tax-invoice approval required → owner/admin/manager/finance (in-portal).
    for r in select id from public.profiles where account_status='active'
              and (account_type='admin' or staff_role in ('manager','super_admin','finance')) loop
      perform public.notify(r.id, 'user', 'invoice_approval_required', 'quote', p_quote,
                            'موافقة على إنشاء فاتورة ضريبية مطلوبة: ' || coalesce(v_num,''), 'Tax invoice approval required: ' || coalesce(v_num,''));
    end loop;
  else
    perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote, 'رفض/طلب تعديل العرض: ' || coalesce(v_num,''), 'Client declined / requested revision: ' || coalesce(v_num,''));
  end if;
  return true;
end; $$;
revoke execute on function public.client_respond_quote(uuid,text,text) from public, anon;
grant  execute on function public.client_respond_quote(uuid,text,text) to authenticated;

-- ════════ 4) Approve tax-invoice creation (owner/finance/manager) ════════════
create or replace function public.approve_invoice_creation(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_est text; v_email text; v_status text; v_existing uuid; v_resp text;
begin
  if not public.can_see_invoices() then raise exception 'not authorized'; end if;
  select zoho_estimate_id, email, invoice_approval_status, client_response
    into v_est, v_email, v_status, v_resp from public.quotes where id = p_quote and not is_deleted;
  if not found then raise exception 'quote not found'; end if;
  if v_resp <> 'accepted' then raise exception 'quote not accepted by client'; end if;
  -- Dedup: an invoice already created from this estimate/quote?
  select id into v_existing from public.invoices
   where not is_deleted and (quote_id = p_quote or (zoho_estimate_id is not null and zoho_estimate_id = v_est))
   order by created_at desc limit 1;
  update public.quotes set invoice_approval_status = case when v_existing is not null then 'invoice_created' else 'invoice_creation_approved' end,
         invoice_approved_by = auth.uid(), invoice_approved_at = now(),
         linked_invoice_id = coalesce(v_existing, linked_invoice_id), updated_at = now()
   where id = p_quote;
  return jsonb_build_object('ok', true, 'zoho_estimate_id', v_est, 'email', v_email,
                            'existing_invoice_id', v_existing, 'already_created', v_status = 'invoice_created');
end; $$;
revoke execute on function public.approve_invoice_creation(uuid) from public, anon;
grant  execute on function public.approve_invoice_creation(uuid) to authenticated;

-- ════════ 5) Server write-back of the invoice-creation outcome (service_role) ═
create or replace function public.set_quote_invoice_status(p_quote uuid, p_status text, p_invoice uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_uid uuid; v_num text;
begin
  if p_status not in ('invoice_approval_pending','invoice_creation_approved','invoice_created','invoice_creation_failed') then raise exception 'invalid status'; end if;
  update public.quotes set invoice_approval_status = p_status, linked_invoice_id = coalesce(p_invoice, linked_invoice_id), updated_at = now()
   where id = p_quote returning client_id, coalesce(estimate_number, quote_number) into v_client, v_num;
  if not found then raise exception 'quote not found'; end if;
  if p_status = 'invoice_created' then
    select user_id into v_uid from public.clients where id = v_client;
    if v_uid is not null then
      perform public.notify(v_uid, 'user', 'invoice_visible', 'invoice', p_invoice, 'فاتورتك الضريبية متاحة في البوابة', 'Your tax invoice is available in the portal');
    end if;
    perform public.notify(null, 'admin', 'invoice_created', 'invoice', p_invoice, 'أُنشئت فاتورة ضريبية: ' || coalesce(v_num,''), 'Tax invoice created: ' || coalesce(v_num,''));
  elsif p_status = 'invoice_creation_failed' then
    perform public.notify(null, 'admin', 'invoice_creation_failed', 'quote', p_quote, 'فشل إنشاء الفاتورة الضريبية: ' || coalesce(v_num,''), 'Tax invoice creation failed: ' || coalesce(v_num,''));
  end if;
  return true;
end; $$;
revoke execute on function public.set_quote_invoice_status(uuid,text,uuid) from public, anon, authenticated;
grant  execute on function public.set_quote_invoice_status(uuid,text,uuid) to service_role;

-- ════════ 6) Widen upsert_zoho_invoice with quote_id/estimate/line_items ═════
drop function if exists public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text);
create or replace function public.upsert_zoho_invoice(
  p_zoho_invoice_id text, p_zoho_customer_id text, p_email text, p_invoice_number text, p_status text,
  p_currency text, p_subtotal numeric, p_vat numeric, p_total numeric, p_due_date date, p_pdf_url text,
  p_quote_id uuid default null, p_zoho_estimate_id text default null, p_line_items jsonb default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_client uuid; v_id uuid;
begin
  if p_zoho_invoice_id is null or length(trim(p_zoho_invoice_id)) = 0 then raise exception 'zoho_invoice_id required'; end if;
  v_client := public.resolve_client_id_by_email(p_email);
  if v_client is null and p_quote_id is not null then select client_id into v_client from public.quotes where id = p_quote_id; end if;
  select id into v_id from public.invoices where zoho_invoice_id = p_zoho_invoice_id limit 1;
  if v_id is not null then
    update public.invoices set
      zoho_customer_id = coalesce(nullif(p_zoho_customer_id,''), zoho_customer_id),
      client_id = coalesce(v_client, client_id),
      quote_id = coalesce(p_quote_id, quote_id),
      zoho_estimate_id = coalesce(nullif(p_zoho_estimate_id,''), zoho_estimate_id),
      invoice_number = coalesce(nullif(p_invoice_number,''), invoice_number),
      status = coalesce(nullif(p_status,''), status), currency = coalesce(nullif(p_currency,''), currency),
      subtotal = coalesce(p_subtotal, subtotal), vat = coalesce(p_vat, vat), total = coalesce(p_total, total),
      due_date = coalesce(p_due_date, due_date), pdf_url = coalesce(nullif(p_pdf_url,''), pdf_url),
      line_items = coalesce(p_line_items, line_items), source = 'zoho', updated_at = now()
    where id = v_id;
  else
    insert into public.invoices (zoho_invoice_id, zoho_customer_id, client_id, quote_id, zoho_estimate_id,
                                 invoice_number, status, currency, subtotal, vat, total, due_date, pdf_url,
                                 line_items, source, public_portal_visible)
    values (p_zoho_invoice_id, nullif(p_zoho_customer_id,''), v_client, p_quote_id, nullif(p_zoho_estimate_id,''),
            nullif(p_invoice_number,''), coalesce(nullif(p_status,''),'sent'), coalesce(nullif(p_currency,''),'SAR'),
            coalesce(p_subtotal,0), coalesce(p_vat,0), coalesce(p_total,0), p_due_date, nullif(p_pdf_url,''),
            p_line_items, 'zoho', true)  -- official issued invoice → shown to the matched client
    returning id into v_id;
  end if;
  return v_id;
end; $$;
revoke execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text,uuid,text,jsonb) from public, anon, authenticated;
grant  execute on function public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text,uuid,text,jsonb) to service_role;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK (restore the prior client_respond_quote, 11-arg upsert_zoho_invoice and
-- the 17-value notifications CHECK; the additive columns are harmless to leave):
-- begin;
--   drop function if exists public.set_quote_invoice_status(uuid,text,uuid);
--   drop function if exists public.approve_invoice_creation(uuid);
--   drop function if exists public.upsert_zoho_invoice(text,text,text,text,text,text,numeric,numeric,numeric,date,text,uuid,text,jsonb);
--   -- (re-create the 11-arg upsert_zoho_invoice + the prior client_respond_quote from
--   --  portal_quotes_invoices_fix_RUNME.sql / portal_zoho_estimates_RUNME.sql)
--   alter table public.notifications drop constraint if exists notifications_type_check;
--   alter table public.notifications add constraint notifications_type_check check (type in (
--     'quote_request_new','message_new','file_link_new','project_note_new',
--     'deliverable_new','revision_requested','deliverable_approved',
--     'deliverable_final_delivered','project_status_changed','opportunity_new','whatsapp_new',
--     'project_brief_new','portal_request_new',
--     'quote_sent','quote_accepted','quote_revision_requested','invoice_visible'));
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  7/10 — portal_email_linking                                    ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — email-based auto-linking of guest submissions. ADDITIVE.
--
-- Problem: a visitor's quote/meeting/file submission only went to Google Sheets,
-- so after they sign up with the SAME verified email the portal had nothing to
-- show. This captures those submissions into public_intake (email-keyed) and links
-- them — plus their email-matched quotes — to the user on login.
--
-- Visibility is by the VERIFIED email (public.my_email() = the auth user's profile
-- email, set from auth at signup) OR a matching user_id OR staff. Anon can only
-- WRITE via the SECURITY DEFINER capture RPC (called server-side); never READ.
--
-- Depends on phase0 (profiles, notify), portal_zoho_estimates_RUNME (my_email(),
-- quotes.email), staff helpers (is_staff()).
-- ⚠️ CHECKPOINT (أ): review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) public_intake — guest/lead submissions keyed by email ═══════════
create table if not exists public.public_intake (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid references auth.users(id) on delete set null,
  request_type      text not null check (request_type in ('quote','meeting','call','files','contact','other')),
  reference         text,
  email             text not null,
  phone             text,
  full_name         text,
  company           text,
  city              text,
  services          text[] not null default '{}',
  details           text,
  preferred_date    text,
  preferred_contact text,
  file_links        jsonb,   -- [{label,url}] from the upload-files form
  status            text not null default 'new' check (status in ('new','reviewing','quoted','scheduled','completed','closed')),
  source            text,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists idx_public_intake_email on public.public_intake(lower(email), created_at);
create index if not exists idx_public_intake_user  on public.public_intake(user_id);
alter table public.public_intake enable row level security;
-- Read: own (by user_id OR verified email) + staff. Anon (no email/uid) sees nothing.
drop policy if exists public_intake_read on public.public_intake;
create policy public_intake_read on public.public_intake for select to authenticated using (
  not is_deleted and (
    user_id = auth.uid()
    or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__'))
    or public.is_staff()));
grant select on public.public_intake to authenticated;
-- NO insert/update/delete grants — writes go through the SECURITY DEFINER RPCs below.

-- ════════ 2) Capture a public submission (server-side; sets user_id if known) ═
create or replace function public.capture_public_intake(
  p_user uuid, p_type text, p_email text, p_phone text, p_name text, p_company text, p_city text,
  p_reference text, p_services text[], p_details text, p_preferred_date text, p_preferred_contact text,
  p_source text, p_files jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text;
begin
  if p_email is null or position('@' in p_email) = 0 then raise exception 'valid email required'; end if;
  v_type := case when p_type in ('quote','meeting','call','files','contact','other') then p_type else 'other' end;
  insert into public.public_intake
    (user_id, request_type, reference, email, phone, full_name, company, city, services, details,
     preferred_date, preferred_contact, file_links, source)
  values (p_user, v_type, nullif(p_reference,''), lower(trim(p_email)), nullif(p_phone,''), nullif(p_name,''),
          nullif(p_company,''), nullif(p_city,''), coalesce(p_services,'{}'), nullif(p_details,''),
          nullif(p_preferred_date,''), nullif(p_preferred_contact,''), p_files, nullif(p_source,''))
  returning id into v_id;
  -- Notify owner/admin + sales/manager of the new website request.
  perform public.notify(null, 'admin', 'quote_request_new', 'public_intake', v_id, 'طلب جديد من الموقع', 'New request from the website');
  return v_id;
end; $$;
revoke execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) from public, anon, authenticated;
grant  execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) to service_role;

-- ════════ 3) Link my email-matched records on login (authenticated) ══════════
create or replace function public.link_my_records_by_email() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_email text; v_client uuid; v_intake int := 0; v_quotes int := 0;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  v_email := lower(trim(coalesce((select email from public.profiles where id = auth.uid()), '')));
  if v_email = '' then return jsonb_build_object('linked_intake', 0, 'linked_quotes', 0, 'has_client', false); end if;
  -- Attach guest intake rows submitted with this verified email.
  update public.public_intake set user_id = auth.uid(), updated_at = now()
   where user_id is null and lower(coalesce(email,'')) = v_email and not is_deleted;
  get diagnostics v_intake = row_count;
  -- Attach email-matched quotes/estimates to the client context (if a clients row exists).
  select id into v_client from public.clients where user_id = auth.uid() and is_deleted = false limit 1;
  if v_client is not null then
    update public.quotes set client_id = v_client, updated_at = now()
     where client_id is null and lower(coalesce(email,'')) = v_email and not is_deleted;
    get diagnostics v_quotes = row_count;
  end if;
  return jsonb_build_object('linked_intake', v_intake, 'linked_quotes', v_quotes, 'has_client', v_client is not null,
                           'recognized', (v_intake > 0 or exists (select 1 from public.quotes q where lower(coalesce(q.email,'')) = v_email and not q.is_deleted)));
end; $$;
revoke execute on function public.link_my_records_by_email() from public, anon;
grant  execute on function public.link_my_records_by_email() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK:
-- begin;
--   drop function if exists public.link_my_records_by_email();
--   drop function if exists public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb);
--   drop table if exists public.public_intake cascade;
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  8/10 — portal_intake_to_quoterequests_bridge                   ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — bridge guest website quote requests (public_intake) into the
-- existing admin quote workflow (quote_requests). ADDITIVE + idempotent.
--
-- PROBLEM: guest quote submissions land in public_intake (email-keyed, nullable
-- user_id) and show in the CLIENT portal, but the ADMIN "Quote Requests" list,
-- the pending-list RPC, and the Zoho estimate-create pipeline all read only the
-- canonical quote_requests path — so admins never see the new requests and can't
-- click "إنشاء تقدير من هذا الطلب".
--
-- FIX (smallest safe bridge = PROMOTION): copy each request_type='quote' intake
-- row into quote_requests (every downstream surface already speaks quote_requests:
-- the inbox, list_pending_quote_requests, the ?open deep-link, the Zoho create
-- route, the "فتح العرض" flip, and client-visibility rules). Made safe by:
--   • making quote_requests.user_id NULLABLE (a guest has no account yet),
--   • adding inline contact columns (email/full_name/company/phone/...) so the two
--     contact-resolving RPCs no longer depend on a profiles row,
--   • a source_intake_id idempotency key (one intake → at most one request → at
--     most one Zoho estimate),
--   • teaching get_quote_request_for_estimate / list_pending_quote_requests to
--     COALESCE inline columns over the (absent) profile.
-- Promotion creates a 'new' quote_requests row ONLY — it NEVER creates a Zoho
-- estimate (that still happens only when an admin clicks the button).
--
-- Depends on: portal_email_linking_RUNME (public_intake, capture_public_intake),
-- phase0 (quote_requests, notify), portal_zoho_estimates_RUNME (get_quote_request_for_estimate),
-- portal_open_quote_fix_RUNME (list_pending_quote_requests), can_manage_quotes().
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Make quote_requests guest-capable (additive) ════════════════════
alter table public.quote_requests alter column user_id drop not null;
alter table public.quote_requests add column if not exists email             text;
alter table public.quote_requests add column if not exists full_name         text;
alter table public.quote_requests add column if not exists company           text;
alter table public.quote_requests add column if not exists phone             text;
alter table public.quote_requests add column if not exists preferred_contact text;
alter table public.quote_requests add column if not exists source            text;
alter table public.quote_requests add column if not exists source_intake_id  uuid references public.public_intake(id) on delete set null;
-- Idempotency key: one public_intake row → one quote_request. NULLs are distinct,
-- so existing (manual) requests with NULL source_intake_id are unaffected.
create unique index if not exists uq_quote_requests_source_intake
  on public.quote_requests(source_intake_id);

-- RLS note: the existing policies are (user_id = auth.uid()) OR is_admin(). A guest
-- row has user_id NULL, so it NEVER matches the client-facing policy and is reachable
-- only via is_admin()/can_manage_quotes() (SECURITY DEFINER) paths — exactly intended.
-- Do NOT add any authenticated SELECT policy that would match user_id IS NULL rows.

-- ════════ 2) Promote one intake quote row → a quote_request (service-side) ════
create or replace function public.promote_intake_to_quote_request(p_intake uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_pi record; v_qr uuid;
begin
  -- Dedupe: already promoted?
  select id into v_qr from public.quote_requests where source_intake_id = p_intake limit 1;
  if v_qr is not null then return v_qr; end if;

  select * into v_pi from public.public_intake
    where id = p_intake and request_type = 'quote' and not is_deleted;
  if not found then return null; end if;

  insert into public.quote_requests
    (user_id, reference, services, description, city, preferred_date,
     email, full_name, company, phone, preferred_contact, source, source_intake_id, status)
  values (v_pi.user_id,
          coalesce(nullif(v_pi.reference,''), 'WEB-' || left(p_intake::text, 8)),
          coalesce(v_pi.services, '{}'),
          v_pi.details, v_pi.city,
          case when v_pi.preferred_date ~ '^\d{4}-\d{2}-\d{2}$' then v_pi.preferred_date::date else null end,
          lower(v_pi.email), v_pi.full_name, v_pi.company, v_pi.phone, v_pi.preferred_contact,
          coalesce(nullif(v_pi.source,''), 'website'), p_intake, 'new')
  on conflict (source_intake_id) do nothing
  returning id into v_qr;

  if v_qr is null then  -- lost a race; re-read the winner
    select id into v_qr from public.quote_requests where source_intake_id = p_intake limit 1;
  end if;

  -- Tidy: reflect that the intake has entered the quote workflow (non-breaking; MyRequests still reads it).
  update public.public_intake set status = 'reviewing', updated_at = now()
    where id = p_intake and status = 'new';
  return v_qr;
end; $$;
revoke execute on function public.promote_intake_to_quote_request(uuid) from public, anon, authenticated;
grant  execute on function public.promote_intake_to_quote_request(uuid) to service_role;

-- ════════ 3) Capture → auto-promote quote rows + deep-link the notification ═══
-- (Replaces the body from portal_email_linking_RUNME.sql. Same 14-arg signature.)
create or replace function public.capture_public_intake(
  p_user uuid, p_type text, p_email text, p_phone text, p_name text, p_company text, p_city text,
  p_reference text, p_services text[], p_details text, p_preferred_date text, p_preferred_contact text,
  p_source text, p_files jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_type text; v_qr uuid;
begin
  if p_email is null or position('@' in p_email) = 0 then raise exception 'valid email required'; end if;
  v_type := case when p_type in ('quote','meeting','call','files','contact','other') then p_type else 'other' end;
  insert into public.public_intake
    (user_id, request_type, reference, email, phone, full_name, company, city, services, details,
     preferred_date, preferred_contact, file_links, source)
  values (p_user, v_type, nullif(p_reference,''), lower(trim(p_email)), nullif(p_phone,''), nullif(p_name,''),
          nullif(p_company,''), nullif(p_city,''), coalesce(p_services,'{}'), nullif(p_details,''),
          nullif(p_preferred_date,''), nullif(p_preferred_contact,''), p_files, nullif(p_source,''))
  returning id into v_id;

  if v_type = 'quote' then
    -- Make it appear in the admin quote workflow. This does NOT create a Zoho estimate.
    -- The t_quote_created trigger on the new quote_requests row already emits the admin
    -- notification with entity_type='quote_request' (deep-links to ?open=<id>), so we do
    -- NOT notify again here (avoids a duplicate). Fallback only if promotion yields nothing.
    v_qr := public.promote_intake_to_quote_request(v_id);
    if v_qr is null then
      perform public.notify(null, 'admin', 'quote_request_new', 'public_intake', v_id,
                            'طلب جديد من الموقع', 'New request from the website');
    end if;
  else
    perform public.notify(null, 'admin', 'quote_request_new', 'public_intake', v_id,
                          'طلب جديد من الموقع', 'New request from the website');
  end if;
  return v_id;
end; $$;
revoke execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) from public, anon, authenticated;
grant  execute on function public.capture_public_intake(uuid,text,text,text,text,text,text,text,text[],text,text,text,text,jsonb) to service_role;

-- ════════ 4) Estimate-create contact resolver: COALESCE inline over profile ═══
-- Guest rows have user_id NULL (no profile) → must read email/name/company/phone
-- from the inline quote_requests columns, else the Zoho create returns "no email".
create or replace function public.get_quote_request_for_estimate(p_request uuid)
returns table (email text, full_name text, company text, phone text, services text[], description text)
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(qr.email,''),      p.email),
         coalesce(nullif(qr.full_name,''),  p.full_name),
         coalesce(nullif(qr.company,''),    p.company),
         coalesce(nullif(qr.phone,''),      p.mobile),
         qr.services, qr.description
  from public.quote_requests qr left join public.profiles p on p.id = qr.user_id
  where qr.id = p_request and coalesce(qr.is_deleted,false) = false;
$$;
revoke execute on function public.get_quote_request_for_estimate(uuid) from public, anon, authenticated;
grant  execute on function public.get_quote_request_for_estimate(uuid) to service_role;

-- ════════ 5) Pending list: show the guest email (inline over profile) ═════════
-- Same return signature as portal_open_quote_fix_RUNME — only the email source changes.
create or replace function public.list_pending_quote_requests()
returns table (
  id uuid, reference text, services text[], email text, city text, budget_range text,
  status text, created_at timestamptz, has_quote boolean,
  linked_quote_id uuid, quote_number text, zoho_estimate_id text, estimate_number text, estimate_url text
) language sql stable security definer set search_path = public as $$
  select qr.id, qr.reference, qr.services, coalesce(nullif(qr.email,''), p.email) as email,
         qr.city, qr.budget_range, qr.status, qr.created_at,
         (lq.id is not null) as has_quote,
         lq.id, lq.quote_number, lq.zoho_estimate_id, lq.estimate_number, lq.estimate_url
  from public.quote_requests qr
  left join public.profiles p on p.id = qr.user_id
  left join lateral (
    select q.id, q.quote_number, q.zoho_estimate_id, q.estimate_number, q.estimate_url
    from public.quotes q
    where q.quote_request_id = qr.id and not q.is_deleted
    order by q.created_at desc
    limit 1
  ) lq on true
  where public.can_manage_quotes() and coalesce(qr.is_deleted,false) = false
    and qr.status in ('new','in_review','quoted')
  order by qr.created_at desc;
$$;
grant execute on function public.list_pending_quote_requests() to authenticated;

-- ════════ 6) BACKFILL existing guest quote intake rows ═══════════════════════
-- Idempotent via the unique source_intake_id index (re-runnable; skips done rows).
-- Each inserted row fires t_quote_created → one admin "New quote request" notification,
-- which is desirable here: it surfaces the previously-invisible test requests to the admin.
insert into public.quote_requests
  (user_id, reference, services, description, city, preferred_date,
   email, full_name, company, phone, preferred_contact, source, source_intake_id, status)
select pi.user_id,
       coalesce(nullif(pi.reference,''), 'WEB-' || left(pi.id::text, 8)),
       coalesce(pi.services, '{}'),
       pi.details, pi.city,
       case when pi.preferred_date ~ '^\d{4}-\d{2}-\d{2}$' then pi.preferred_date::date else null end,
       lower(pi.email), pi.full_name, pi.company, pi.phone, pi.preferred_contact,
       coalesce(nullif(pi.source,''), 'website'), pi.id, 'new'
from public.public_intake pi
where pi.request_type = 'quote' and not pi.is_deleted
on conflict (source_intake_id) do nothing;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (run after):
--   select id, reference, email, source, source_intake_id, user_id, status
--     from public.quote_requests where source_intake_id is not null order by created_at desc;
--   -- each backfilled/captured guest quote should appear; admin inbox + pending list now show them.
--
-- ROLLBACK:
-- begin;
--   -- restore prior RPC bodies from their original files:
--   --   capture_public_intake          → docs/portal_email_linking_RUNME.sql (§2)
--   --   get_quote_request_for_estimate → docs/portal_zoho_estimates_RUNME.sql
--   --   list_pending_quote_requests    → docs/portal_open_quote_fix_RUNME.sql
--   drop function if exists public.promote_intake_to_quote_request(uuid);
--   delete from public.quote_requests where source_intake_id is not null;  -- remove promoted rows
--   drop index if exists public.uq_quote_requests_source_intake;
--   alter table public.quote_requests drop column if exists source_intake_id;
--   alter table public.quote_requests drop column if exists source;
--   alter table public.quote_requests drop column if exists preferred_contact;
--   alter table public.quote_requests drop column if exists phone;
--   alter table public.quote_requests drop column if exists company;
--   alter table public.quote_requests drop column if exists full_name;
--   alter table public.quote_requests drop column if exists email;
--   -- (only after confirming no guest rows remain) alter table public.quote_requests alter column user_id set not null;
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION  9/10 — portal_guest_quote_publish_fix                          ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — fix publish-to-client for GUEST-origin quotes. ADDITIVE + idempotent.
--
-- PROBLEM: when admin clicks "اعتماد وإظهار للعميل", approve_quote_for_client sets
-- public_portal_visible=true but only notifies if the quote's client_id resolves to a
-- clients.user_id. A guest-origin quote has client_id = NULL (the lead had no clients
-- row when the estimate was created) and only an inline email, so NO client
-- notification is ever sent — the client never knows the estimate is waiting. (The
-- estimate is actually VISIBLE via the email-match RLS once total>0 + has items, but
-- the client is never told to look.) Also client_request_quote_revision matched ONLY
-- client_id = my_client_id() (no email branch), so "طلب تعديل" failed for guest quotes.
--
-- FIX (focused; does NOT touch the invoice pipeline):
--   1) approve_quote_for_client: resolve+link the client by VERIFIED email when
--      client_id is NULL, set published_at, and notify the correct user (clients.user_id
--      first, else the signed-up profile matched by verified email). Dedupe on published_at
--      so re-clicking publish does not re-notify.
--   2) client_request_quote_revision: add the email-match branch (like client_respond_quote)
--      so a guest-origin published quote can be revised; require the note.
--   3) add quotes.published_at (audit + dedupe key).
--
-- Visibility RLS is NOT changed (the email-match branch already grants exactly the right
-- access). No clients-row creation. Depends on portal_zoho_estimates_RUNME (quotes mirror,
-- my_email/my_client_id/resolve_client_id_by_email, approve_quote_for_client v1,
-- quotes_read RLS), portal_quotes_invoices_RUNME (quote_revision_requests, can_manage_quotes).
-- Does NOT depend on portal_invoice_approval_RUNME (invoice flow untouched here).
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) Publish audit/dedupe column ═════════════════════════════════════
alter table public.quotes add column if not exists published_at timestamptz;
-- Treat already-approved quotes as already-published so they don't re-notify on next publish.
update public.quotes set published_at = admin_approved_at
  where admin_approved_at is not null and published_at is null;

-- ════════ 2) Publish → resolve + link + notify the client by verified email ═══
create or replace function public.approve_quote_for_client(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_client uuid; v_email text; v_num text; v_items int;
        v_uid uuid; v_was_published boolean;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;

  select q.total, q.client_id, lower(coalesce(q.email,'')), coalesce(q.estimate_number, q.quote_number),
         (select count(*) from public.quote_items qi where qi.quote_id = q.id),
         (q.published_at is not null)
    into v_total, v_client, v_email, v_num, v_items, v_was_published
    from public.quotes q where q.id = p_quote and not q.is_deleted;
  if not found then raise exception 'quote not found'; end if;
  if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;

  -- Guest-origin: link the client by VERIFIED email when there is no client_id yet
  -- (only links to an existing clients row; never creates one; never overwrites a real link).
  if v_client is null and v_email <> '' then
    v_client := public.resolve_client_id_by_email(v_email);
    if v_client is not null then
      update public.quotes set client_id = v_client where id = p_quote and client_id is null;
    end if;
  end if;

  update public.quotes
     set public_portal_visible = true,
         admin_approved_at = now(), admin_approved_by = auth.uid(),
         published_at = coalesce(published_at, now()),
         status = case when status in ('draft','internal_review','approved') then 'sent' else status end,
         updated_at = now()
   where id = p_quote;

  -- Resolve the recipient: the linked client's user, else the signed-up profile by verified email.
  if v_client is not null then
    select user_id into v_uid from public.clients where id = v_client;
  end if;
  if v_uid is null and v_email <> '' then
    select id into v_uid from public.profiles where lower(email) = v_email and account_status <> 'blocked' limit 1;
  end if;

  -- Notify the client ONLY on the first publish (dedupe via published_at).
  if v_uid is not null and not v_was_published then
    perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote,
                          'تم إصدار عرض سعر جديد: ' || coalesce(v_num,''),
                          'A new quote has been issued: ' || coalesce(v_num,''));
  end if;

  return jsonb_build_object('ok', true, 'client_id', v_client,
                            'notified', (v_uid is not null and not v_was_published),
                            'recipient', v_uid, 'published', true);
end; $$;
revoke execute on function public.approve_quote_for_client(uuid) from public, anon;
grant  execute on function public.approve_quote_for_client(uuid) to authenticated;

-- ════════ 3) Request revision: add email-match so guest quotes work ══════════
create or replace function public.client_request_quote_revision(p_quote uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'note required'; end if;
  if not exists (
    select 1 from public.quotes q
     where q.id = p_quote and not q.is_deleted
       and (q.client_id = public.my_client_id()
            or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
       and (q.public_portal_visible or q.status in ('sent','accepted'))
       and q.total > 0 and exists (select 1 from public.quote_items qi where qi.quote_id = q.id))
  then raise exception 'quote not available'; end if;
  insert into public.quote_revision_requests (quote_id, author_id, note)
    values (p_quote, auth.uid(), trim(p_note));
  select coalesce(estimate_number, quote_number) into v_num from public.quotes where id = p_quote;
  perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote,
                        'طلب العميل تعديل عرض السعر: ' || coalesce(v_num,''),
                        'Client requested a quote revision: ' || coalesce(v_num,''));
  return true;
end; $$;
revoke execute on function public.client_request_quote_revision(uuid,text) from public, anon;
grant  execute on function public.client_request_quote_revision(uuid,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (after running):
--   -- publish a Zoho estimate whose email matches a signed-up user → that user gets
--   -- a 'quote_sent' notification and quotes.client_id is linked + published_at set.
--   select id, estimate_number, client_id, public_portal_visible, published_at, total
--     from public.quotes where source='zoho' order by created_at desc limit 5;
--
-- ROLLBACK:
-- begin;
--   -- restore prior bodies from their original files:
--   --   approve_quote_for_client        → docs/portal_zoho_estimates_RUNME.sql
--   --   client_request_quote_revision   → docs/portal_quotes_invoices_RUNME.sql
--   alter table public.quotes drop column if exists published_at;
-- commit;


-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║ SECTION 10/10 — portal_client_quote_visibility_fix                      ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ════════════════════════════════════════════════════════════════════════
-- Kian Portal — make PUBLISHED estimates actually visible to the client.
-- ADDITIVE + idempotent. SUPERSEDES docs/portal_guest_quote_publish_fix_RUNME.sql
-- (re-includes its publish/revision/published_at changes, so run THIS one file).
--
-- ROOT CAUSE: the client never saw the official estimate card because quotes_read
-- and quote_items_read are MUTUALLY RECURSIVE — quotes_read contains
-- `exists(select 1 from quote_items ...)` and quote_items_read contains
-- `exists(select 1 from quotes ...)`. When a NON-admin reads quotes, PostgreSQL
-- applies quote_items' RLS to that subquery, which re-applies quotes' RLS, … →
-- "infinite recursion detected in policy for relation quotes". The query ERRORS,
-- and the client UI silently falls back to the empty state. The ADMIN is unaffected
-- because can_manage_quotes() is the first OR term and short-circuits before the
-- recursive subquery is reached — which is why "admin works, client sees nothing".
--
-- FIX: drop the `exists(quote_items)` term from quotes_read (total>0 already implies a
-- priced quote, and the publish guard requires line items). quote_items_read only
-- references quotes, so once quotes_read no longer references quote_items the cycle is
-- broken for BOTH directions. Visibility gate (matching + visible + total>0) is kept,
-- so unpublished/internal estimates stay hidden (requirement: do not expose them).
--
-- Also (from the prior publish fix, re-applied here): approve_quote_for_client resolves
-- + links the client by VERIFIED email when client_id is NULL and notifies the correct
-- user (dedupe via published_at); client_request_quote_revision gains the email-match
-- branch so guest-origin quotes can be revised; quotes.published_at column.
--
-- Depends on portal_zoho_estimates_RUNME (quotes mirror, my_email/my_client_id/
-- resolve_client_id_by_email, the policies being replaced) + portal_quotes_invoices_RUNME
-- (quote_revision_requests, can_manage_quotes, notifications.type CHECK). Does NOT touch
-- the invoice flow or the admin create/sync/open-estimate flow.
-- ⚠️ CHECKPOINT: review, then YOU run it in Supabase → SQL Editor. Rollback at bottom.
-- ════════════════════════════════════════════════════════════════════════

begin;

-- ════════ 1) BREAK THE RLS RECURSION (the real fix for the missing client card) ═
-- quotes_read WITHOUT the exists(quote_items) term (kept everything else identical).
drop policy if exists quotes_read on public.quotes;
create policy quotes_read on public.quotes for select to authenticated using (
  not is_deleted and (
    public.can_manage_quotes()
    or ((client_id = public.my_client_id()
         or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (public_portal_visible or status in ('sent','accepted'))
        and total > 0)
  ));
-- quote_items_read references ONLY quotes (no self-reference), so it is now non-recursive.
-- Re-declared here verbatim so the live policy is explicit + known-good.
drop policy if exists quote_items_read on public.quote_items;
create policy quote_items_read on public.quote_items for select to authenticated using (
  exists (select 1 from public.quotes q where q.id = quote_items.quote_id and not q.is_deleted and (
    public.can_manage_quotes()
    or ((q.client_id = public.my_client_id()
         or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
        and (q.public_portal_visible or q.status in ('sent','accepted')) and q.total > 0)
  )));

-- ════════ 2) Publish audit/dedupe column ═════════════════════════════════════
alter table public.quotes add column if not exists published_at timestamptz;
update public.quotes set published_at = admin_approved_at
  where admin_approved_at is not null and published_at is null;

-- ════════ 3) Publish → resolve + link + notify the client by verified email ═══
create or replace function public.approve_quote_for_client(p_quote uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_client uuid; v_email text; v_num text; v_items int;
        v_uid uuid; v_was_published boolean;
begin
  if not public.can_manage_quotes() then raise exception 'not authorized'; end if;

  select q.total, q.client_id, lower(coalesce(q.email,'')), coalesce(q.estimate_number, q.quote_number),
         (select count(*) from public.quote_items qi where qi.quote_id = q.id),
         (q.published_at is not null)
    into v_total, v_client, v_email, v_num, v_items, v_was_published
    from public.quotes q where q.id = p_quote and not q.is_deleted;
  if not found then raise exception 'quote not found'; end if;
  if coalesce(v_total,0) <= 0 or coalesce(v_items,0) = 0 then raise exception 'empty_or_zero_quote'; end if;

  if v_client is null and v_email <> '' then
    v_client := public.resolve_client_id_by_email(v_email);
    if v_client is not null then
      update public.quotes set client_id = v_client where id = p_quote and client_id is null;
    end if;
  end if;

  update public.quotes
     set public_portal_visible = true,
         admin_approved_at = now(), admin_approved_by = auth.uid(),
         published_at = coalesce(published_at, now()),
         status = case when status in ('draft','internal_review','approved') then 'sent' else status end,
         updated_at = now()
   where id = p_quote;

  if v_client is not null then
    select user_id into v_uid from public.clients where id = v_client;
  end if;
  if v_uid is null and v_email <> '' then
    select id into v_uid from public.profiles where lower(email) = v_email and account_status <> 'blocked' limit 1;
  end if;

  if v_uid is not null and not v_was_published then
    perform public.notify(v_uid, 'user', 'quote_sent', 'quote', p_quote,
                          'تم إصدار عرض سعر جديد: ' || coalesce(v_num,''),
                          'A new quote has been issued: ' || coalesce(v_num,''));
  end if;

  return jsonb_build_object('ok', true, 'client_id', v_client,
                            'notified', (v_uid is not null and not v_was_published),
                            'recipient', v_uid, 'published', true);
end; $$;
revoke execute on function public.approve_quote_for_client(uuid) from public, anon;
grant  execute on function public.approve_quote_for_client(uuid) to authenticated;

-- ════════ 4) Request revision: email-match so guest quotes work; note required ═
create or replace function public.client_request_quote_revision(p_quote uuid, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_num text;
begin
  if p_note is null or length(trim(p_note)) = 0 then raise exception 'note required'; end if;
  if not exists (
    select 1 from public.quotes q
     where q.id = p_quote and not q.is_deleted
       and (q.client_id = public.my_client_id()
            or lower(coalesce(q.email,'')) = lower(coalesce(public.my_email(),'__none__')))
       and (q.public_portal_visible or q.status in ('sent','accepted'))
       and q.total > 0)
  then raise exception 'quote not available'; end if;
  insert into public.quote_revision_requests (quote_id, author_id, note)
    values (p_quote, auth.uid(), trim(p_note));
  select coalesce(estimate_number, quote_number) into v_num from public.quotes where id = p_quote;
  perform public.notify(null, 'admin', 'quote_revision_requested', 'quote', p_quote,
                        'طلب العميل تعديل عرض السعر: ' || coalesce(v_num,''),
                        'Client requested a quote revision: ' || coalesce(v_num,''));
  return true;
end; $$;
revoke execute on function public.client_request_quote_revision(uuid,text) from public, anon;
grant  execute on function public.client_request_quote_revision(uuid,text) to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════
-- VERIFY (run as the SQL Editor / service role — shows the raw fields the client
-- RLS needs; if all of public_portal_visible=true, status in sent/accepted, total>0,
-- item_count>0 and the email matches the client's profile, the card will now show):
--   select q.id, q.quote_number, q.estimate_number, q.email, q.client_id,
--          q.public_portal_visible, q.status, q.total,
--          (select count(*) from public.quote_items qi where qi.quote_id = q.id) as item_count,
--          q.published_at, q.source, q.zoho_estimate_id
--     from public.quotes q where q.source = 'zoho' order by q.created_at desc limit 10;
--   -- email match check (replace the client email):
--   select q.id, q.email as quote_email, p.email as profile_email,
--          (lower(q.email) = lower(p.email)) as email_match
--     from public.quotes q join public.profiles p on lower(p.email) = lower(q.email)
--    where q.source = 'zoho' order by q.created_at desc limit 10;
--
-- ROLLBACK (restores the recursive policies — only if you must revert):
-- begin;
--   drop policy if exists quotes_read on public.quotes;
--   create policy quotes_read on public.quotes for select to authenticated using (
--     not is_deleted and (public.can_manage_quotes() or ((client_id = public.my_client_id()
--       or lower(coalesce(email,'')) = lower(coalesce(public.my_email(),'__none__')))
--       and (public_portal_visible or status in ('sent','accepted')) and total > 0
--       and exists (select 1 from public.quote_items qi where qi.quote_id = quotes.id))));
--   -- approve_quote_for_client / client_request_quote_revision: restore from their original files.
--   alter table public.quotes drop column if exists published_at;
-- commit;


-- ════════════════════════════════════════════════════════════════════════════
-- Reload PostgREST schema cache so the new RPCs are callable immediately.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (run after; all should succeed)
--   -- core tables exist:
--   select to_regclass('public.quotes'), to_regclass('public.quote_items'),
--          to_regclass('public.quote_revision_requests'), to_regclass('public.invoices'),
--          to_regclass('public.public_intake');
--   -- every RPC the portal calls is present (should return 26 rows):
--   select proname from pg_proc where proname in (
--     'list_pending_quote_requests','get_quote_admin','convert_quote_request','create_quote',
--     'set_quote_items','set_quote_status','set_quote_visibility','list_quote_clients',
--     'client_accept_quote','client_request_quote_revision','approve_quote_for_client',
--     'client_respond_quote','upsert_zoho_estimate','get_quote_request_for_estimate',
--     'promote_and_link_by_email','create_invoice_display','set_invoice_visibility',
--     'approve_invoice_creation','set_quote_invoice_status','upsert_zoho_invoice',
--     'capture_public_intake','link_my_records_by_email','resolve_client_id_by_email',
--     'my_email','can_manage_quotes','can_see_invoices') order by 1;
--   -- notifications CHECK widened (includes quote/invoice types, keeps existing ones):
--   select pg_get_constraintdef(oid) from pg_constraint
--    where conrelid='public.notifications'::regclass and conname='notifications_type_check';
--   -- project/review/deliverable fixes NOT reverted (still present):
--   select oid::regprocedure from pg_proc
--    where proname in ('notify','project_client_user_ids','admin_set_deliverable','admin_soft_delete_deliverable');
-- ════════════════════════════════════════════════════════════════════════════
