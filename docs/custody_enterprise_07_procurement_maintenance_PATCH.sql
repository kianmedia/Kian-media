-- ════════════════════════════════════════════════════════════════════════════
-- Custody Enterprise Suite — Patch 07: Procurement + Maintenance vendor billing
-- يُشغَّل بعد patch 06. idempotent. المشتريات خلف flag purchase_requests_enabled.
-- توسيع الصيانة الموجودة بأعمدة (لا يكسر custody_inv_admin_open/close_maintenance).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) الموردون ───
create table if not exists public.custody_vendors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  contact_name  text, phone text, email text,
  vendor_type   text,   -- maintenance|supplier|both
  zoho_vendor_id text,
  is_deleted    boolean not null default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);

-- ─── 2) طلبات الشراء ───
create table if not exists public.custody_purchase_requests (
  id            uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  reason        text, project_number text, priority text default 'normal' check (priority in ('low','normal','high','urgent')),
  status        text not null default 'draft'
                check (status in ('draft','submitted','manager_review','approved','rejected','ordered','received','closed','cancelled')),
  budget_expected numeric, suggested_vendor text, notes text,
  requested_by  uuid references auth.users(id),
  approved_by   uuid references auth.users(id), approved_at timestamptz, reject_reason text,
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.custody_purchase_request_items (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.custody_purchase_requests(id) on delete cascade,
  description  text not null, specs text, quantity numeric not null default 1 check (quantity > 0),
  expected_price numeric, link text, sort_order int not null default 0
);
create table if not exists public.custody_purchase_approvals (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custody_purchase_requests(id) on delete cascade,
  level text not null, decision text not null check (decision in ('approved','rejected','changes_requested')),
  note text, decided_by uuid references auth.users(id), decided_at timestamptz not null default now()
);
create table if not exists public.custody_purchase_vendor_quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custody_purchase_requests(id) on delete cascade,
  vendor_id uuid references public.custody_vendors(id), vendor_name text,
  amount numeric, attachment_path text, note text, is_selected boolean not null default false,
  created_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.custody_purchase_receiving (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.custody_purchase_requests(id) on delete cascade,
  note text, created_asset_ids jsonb not null default '[]',
  received_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists idx_civ_pr_status on public.custody_purchase_requests(status) where is_deleted = false;

create or replace function public.custody_pr_create(p_data jsonb, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_no text; v_id uuid; elem jsonb;
begin
  if not public.is_staff() then raise exception 'not authorized'; end if;
  if not public.civ_flag('purchase_requests_enabled') then raise exception 'procurement_disabled'; end if;
  v_no := public.civ_gen_no('PR');
  insert into public.custody_purchase_requests(request_number, reason, project_number, priority, budget_expected, suggested_vendor, notes, requested_by, status)
    values (v_no, nullif(trim(p_data->>'reason'),''), nullif(trim(p_data->>'project_number'),''), coalesce(nullif(p_data->>'priority',''),'normal'),
      nullif(p_data->>'budget_expected','')::numeric, nullif(trim(p_data->>'suggested_vendor'),''), nullif(trim(p_data->>'notes'),''), auth.uid(), 'submitted')
    returning id into v_id;
  for elem in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.custody_purchase_request_items(request_id, description, specs, quantity, expected_price, link)
      values (v_id, coalesce(nullif(trim(elem->>'description'),''),'—'), nullif(trim(elem->>'specs'),''), coalesce((elem->>'quantity')::numeric,1),
        nullif(elem->>'expected_price','')::numeric, nullif(trim(elem->>'link'),''));
  end loop;
  perform public.civ_notify_managers('purchase_request_created', v_id, 'طلب شراء جديد ' || v_no, 'New purchase request ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_id, 'request_number', v_no);
end; $$;

create or replace function public.custody_pr_decide(p_request uuid, p_decision text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;   -- المالك/الأدمن يعتمد
  if p_decision not in ('approved','rejected','changes_requested') then raise exception 'bad_decision'; end if;
  update public.custody_purchase_requests set
    status = case p_decision when 'approved' then 'approved' when 'rejected' then 'rejected' else 'manager_review' end,
    approved_by = case when p_decision='approved' then auth.uid() else approved_by end,
    approved_at = case when p_decision='approved' then now() else approved_at end,
    reject_reason = case when p_decision='rejected' then nullif(trim(p_note),'') else reject_reason end, updated_at = now()
    where id = p_request and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  insert into public.custody_purchase_approvals(request_id, level, decision, note, decided_by) values (p_request, 'admin', p_decision, nullif(trim(p_note),''), auth.uid());
  perform public.custody_audit('pr_decided', 'custody_purchase_requests', p_request, jsonb_build_object('decision', p_decision));
  if p_decision = 'approved' then perform public.civ_notify_managers('purchase_request_approved', p_request, 'اعتماد طلب شراء', 'Purchase request approved'); end if;
  return true;
end; $$;

-- ─── 3) توسيع الصيانة (أعمدة إضافية — لا تكسر الدوال الحالية) ───
alter table public.custody_inventory_maintenance add column if not exists vendor_id uuid references public.custody_vendors(id);
alter table public.custody_inventory_maintenance add column if not exists technician text;
alter table public.custody_inventory_maintenance add column if not exists diagnosis text;
alter table public.custody_inventory_maintenance add column if not exists repair_action text;
alter table public.custody_inventory_maintenance add column if not exists parts_used text;
alter table public.custody_inventory_maintenance add column if not exists estimated_cost numeric;
alter table public.custody_inventory_maintenance add column if not exists approved_cost numeric;
alter table public.custody_inventory_maintenance add column if not exists final_cost numeric;
alter table public.custody_inventory_maintenance add column if not exists invoice_number text;
alter table public.custody_inventory_maintenance add column if not exists invoice_date date;
alter table public.custody_inventory_maintenance add column if not exists warranty_on_repair text;
alter table public.custody_inventory_maintenance add column if not exists next_service_date date;
alter table public.custody_inventory_maintenance add column if not exists external_reference text;
alter table public.custody_inventory_maintenance add column if not exists zoho_bill_id text;

-- اعتماد تكلفة الصيانة (مالي/إدارة).
create or replace function public.custody_maintenance_approve_cost(p_id uuid, p_approved_cost numeric, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not (public.civ_can_manage() or public.civ_can_finance()) then raise exception 'not authorized'; end if;
  if not public.civ_flag('maintenance_vendor_billing_enabled') then raise exception 'billing_disabled'; end if;
  update public.custody_inventory_maintenance set approved_cost = p_approved_cost, result_note = coalesce(nullif(trim(p_note),''), result_note), updated_at = now() where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public.civ_notify_managers('maintenance_cost_approved', p_id, 'اعتماد تكلفة صيانة', 'Maintenance cost approved');
  return true;
end; $$;

commit;

begin;
alter table public.custody_vendors                    enable row level security;
alter table public.custody_purchase_requests          enable row level security;
alter table public.custody_purchase_request_items     enable row level security;
alter table public.custody_purchase_approvals         enable row level security;
alter table public.custody_purchase_vendor_quotes     enable row level security;
alter table public.custody_purchase_receiving         enable row level security;
drop policy if exists civ_vendors_read on public.custody_vendors;
create policy civ_vendors_read on public.custody_vendors for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
-- طلب الشراء: صاحبه يراه + الإدارة.
drop policy if exists civ_pr_read on public.custody_purchase_requests;
create policy civ_pr_read on public.custody_purchase_requests for select to authenticated using (public.civ_can_manage() or requested_by = auth.uid());
drop policy if exists civ_pr_items_read on public.custody_purchase_request_items;
create policy civ_pr_items_read on public.custody_purchase_request_items for select to authenticated
  using (public.civ_can_manage() or exists (select 1 from public.custody_purchase_requests r where r.id = request_id and r.requested_by = auth.uid()));
drop policy if exists civ_pr_appr_read on public.custody_purchase_approvals;
create policy civ_pr_appr_read on public.custody_purchase_approvals for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_pr_quotes_read on public.custody_purchase_vendor_quotes;
create policy civ_pr_quotes_read on public.custody_purchase_vendor_quotes for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
drop policy if exists civ_pr_recv_read on public.custody_purchase_receiving;
create policy civ_pr_recv_read on public.custody_purchase_receiving for select to authenticated using (public.civ_can_manage());

grant select on public.custody_vendors, public.custody_purchase_requests, public.custody_purchase_request_items,
  public.custody_purchase_approvals, public.custody_purchase_vendor_quotes, public.custody_purchase_receiving to authenticated;
grant execute on function public.custody_pr_create(jsonb,jsonb) to authenticated;
grant execute on function public.custody_pr_decide(uuid,text,text) to authenticated;
grant execute on function public.custody_maintenance_approve_cost(uuid,numeric,text) to authenticated;
commit;

notify pgrst, 'reload schema';

-- VALIDATION
select 'procurement_tables' as k, count(*) from information_schema.tables where table_name like 'custody_purchase_%';
select 'vendors' as k, count(*) from information_schema.tables where table_name='custody_vendors';
select 'maint_cols' as k, count(*) from information_schema.columns where table_name='custody_inventory_maintenance' and column_name in ('vendor_id','final_cost','invoice_number','zoho_bill_id');
