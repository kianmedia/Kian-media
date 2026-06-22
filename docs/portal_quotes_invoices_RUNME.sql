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
