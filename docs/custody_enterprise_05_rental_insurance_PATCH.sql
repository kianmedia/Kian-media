-- ════════════════════════════════════════════════════════════════════════════
-- Custody Enterprise Suite — Patch 05: New Rental portal + Insurance & Claims
-- يُشغَّل بعد patch 04. idempotent. جداول جديدة بـ namespace منفصل — لا يلمس التأجير القديم.
-- التأجير خلف flag client_rental_portal_enabled (معطّل)، التأمين خلف insurance_claims_enabled.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) بوابة التأجير الجديدة ───
create table if not exists public.custody_rental_customers (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id),   -- إن كان له حساب بوابة
  party_type   text not null default 'individual' check (party_type in ('individual','company')),
  full_name    text not null,
  company_name text,
  phone        text,
  email        text,
  id_number_ref text,                            -- مرجع هوية (لا نخزّن أكثر من اللازم)
  notes        text,
  is_deleted   boolean not null default false,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);
create table if not exists public.custody_rental_requests (
  id            uuid primary key default gen_random_uuid(),
  request_number text not null unique,
  customer_id   uuid references public.custody_rental_customers(id),
  status        text not null default 'requested'
                check (status in ('requested','reviewing','quoted','approved','contracted','active','return_requested','under_inspection','closed','cancelled')),
  rental_from   timestamptz,
  rental_to     timestamptz,
  deposit_ref   numeric,
  purpose       text,
  notes         text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.custody_rental_contracts (
  id            uuid primary key default gen_random_uuid(),
  contract_number text not null unique,
  request_id    uuid references public.custody_rental_requests(id),
  customer_id   uuid references public.custody_rental_customers(id),
  terms_snapshot text,
  contract_pdf_path text,
  customer_signature_path text,
  staff_signature_path text,
  signed_at     timestamptz,
  status        text not null default 'draft' check (status in ('draft','signed','active','closed','cancelled')),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create table if not exists public.custody_rental_items (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid references public.custody_rental_requests(id),
  contract_id   uuid references public.custody_rental_contracts(id),
  asset_id      uuid references public.custody_inventory_assets(id),
  quantity      numeric not null default 1 check (quantity > 0),
  condition_out text, condition_in text,
  status        text not null default 'reserved' check (status in ('reserved','issued','return_requested','inspected','returned','damaged','missing')),
  created_at    timestamptz not null default now()
);
create table if not exists public.custody_rental_inspections (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid references public.custody_rental_contracts(id),
  item_id       uuid references public.custody_rental_items(id),
  result        text, damage_fee_ref numeric, late_fee_ref numeric, note text,
  inspected_by  uuid references auth.users(id),
  inspected_at  timestamptz not null default now()
);
create index if not exists idx_civ_rental_req_customer on public.custody_rental_requests(customer_id);
create index if not exists idx_civ_rental_items_contract on public.custody_rental_items(contract_id);

-- إنشاء طلب تأجير (عميل/موظف). خلف flag.
create or replace function public.custody_rental_create_request(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_no text; v_id uuid; v_cust uuid;
begin
  if not public.civ_flag('client_rental_portal_enabled') then raise exception 'rental_disabled'; end if;
  if not (public.is_staff() or auth.uid() is not null) then raise exception 'unauthenticated'; end if;
  v_cust := nullif(p_data->>'customer_id','')::uuid;
  if v_cust is null and public.is_staff() then
    insert into public.custody_rental_customers(full_name, company_name, phone, email, party_type, created_by)
      values (coalesce(nullif(trim(p_data->>'full_name'),''),'—'), nullif(trim(p_data->>'company_name'),''), nullif(trim(p_data->>'phone'),''),
        nullif(trim(p_data->>'email'),''), coalesce(nullif(p_data->>'party_type',''),'individual'), auth.uid()) returning id into v_cust;
  end if;
  v_no := public.civ_gen_no('RNT');
  insert into public.custody_rental_requests(request_number, customer_id, rental_from, rental_to, purpose, notes, created_by)
    values (v_no, v_cust, nullif(p_data->>'rental_from','')::timestamptz, nullif(p_data->>'rental_to','')::timestamptz,
      nullif(trim(p_data->>'purpose'),''), nullif(trim(p_data->>'notes'),''), auth.uid()) returning id into v_id;
  perform public.civ_notify_managers('rental_request_created', v_id, 'طلب تأجير جديد ' || v_no, 'New rental request ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_id, 'request_number', v_no);
end; $$;

-- ─── 2) التأمين والمطالبات ───
create table if not exists public.asset_insurance_policies (
  id            uuid primary key default gen_random_uuid(),
  policy_number text not null unique,
  provider      text,
  start_date    date, end_date date,
  coverage_amount numeric, deductible numeric,
  terms         text, contact text,
  documents     jsonb not null default '[]',
  is_deleted    boolean not null default false,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create table if not exists public.policy_assets (
  id         uuid primary key default gen_random_uuid(),
  policy_id  uuid not null references public.asset_insurance_policies(id) on delete cascade,
  asset_id   uuid not null references public.custody_inventory_assets(id),
  constraint uq_policy_asset unique (policy_id, asset_id)
);
create table if not exists public.insurance_claims (
  id            uuid primary key default gen_random_uuid(),
  claim_number  text not null unique,
  policy_id     uuid references public.asset_insurance_policies(id),
  incident_id   uuid references public.custody_incidents(id),
  asset_id      uuid references public.custody_inventory_assets(id),
  damage_type   text, report text, estimate_cost numeric,
  claimed_amount numeric, approved_amount numeric, received_amount_ref numeric,
  status        text not null default 'open' check (status in ('open','submitted','under_review','approved','rejected','paid','closed')),
  reject_reason text,
  submitted_at  timestamptz,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.insurance_claim_evidence (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.insurance_claims(id) on delete cascade,
  file_path text not null, note text, uploaded_by uuid references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.insurance_claim_actions (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.insurance_claims(id) on delete cascade,
  action_type text not null, note text, created_by uuid references auth.users(id), created_at timestamptz not null default now()
);

create or replace function public.custody_insurance_create_claim(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_no text; v_id uuid;
begin
  if not (public.civ_can_manage() or public.civ_can_finance()) then raise exception 'not authorized'; end if;
  if not public.civ_flag('insurance_claims_enabled') then raise exception 'insurance_disabled'; end if;
  v_no := public.civ_gen_no('CLM');
  insert into public.insurance_claims(claim_number, policy_id, incident_id, asset_id, damage_type, report, estimate_cost, claimed_amount, status, created_by)
    values (v_no, nullif(p_data->>'policy_id','')::uuid, nullif(p_data->>'incident_id','')::uuid, nullif(p_data->>'asset_id','')::uuid,
      nullif(trim(p_data->>'damage_type'),''), nullif(trim(p_data->>'report'),''), nullif(p_data->>'estimate_cost','')::numeric,
      nullif(p_data->>'claimed_amount','')::numeric, 'open', auth.uid()) returning id into v_id;
  perform public.civ_notify_managers('insurance_claim_updated', v_id, 'مطالبة تأمين جديدة ' || v_no, 'New insurance claim ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_id, 'claim_number', v_no);
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) RLS + GRANTS (التأجير: العميل صفوفه؛ التأمين: مالي/إدارة فقط)
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.custody_rental_customers   enable row level security;
alter table public.custody_rental_requests    enable row level security;
alter table public.custody_rental_contracts   enable row level security;
alter table public.custody_rental_items       enable row level security;
alter table public.custody_rental_inspections enable row level security;
alter table public.asset_insurance_policies   enable row level security;
alter table public.policy_assets              enable row level security;
alter table public.insurance_claims           enable row level security;
alter table public.insurance_claim_evidence   enable row level security;
alter table public.insurance_claim_actions    enable row level security;

drop policy if exists civ_rental_cust_read on public.custody_rental_customers;
create policy civ_rental_cust_read on public.custody_rental_customers for select to authenticated using (public.civ_can_manage() or user_id = auth.uid());
drop policy if exists civ_rental_req_read on public.custody_rental_requests;
create policy civ_rental_req_read on public.custody_rental_requests for select to authenticated
  using (public.civ_can_manage() or exists (select 1 from public.custody_rental_customers c where c.id = customer_id and c.user_id = auth.uid()));
drop policy if exists civ_rental_contract_read on public.custody_rental_contracts;
create policy civ_rental_contract_read on public.custody_rental_contracts for select to authenticated
  using (public.civ_can_manage() or exists (select 1 from public.custody_rental_customers c where c.id = customer_id and c.user_id = auth.uid()));
drop policy if exists civ_rental_items_read on public.custody_rental_items;
create policy civ_rental_items_read on public.custody_rental_items for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_rental_insp_read on public.custody_rental_inspections;
create policy civ_rental_insp_read on public.custody_rental_inspections for select to authenticated using (public.civ_can_manage());
-- التأمين: للإدارة/المالي فقط.
drop policy if exists civ_ins_policy_read on public.asset_insurance_policies;
create policy civ_ins_policy_read on public.asset_insurance_policies for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
drop policy if exists civ_policy_assets_read on public.policy_assets;
create policy civ_policy_assets_read on public.policy_assets for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
drop policy if exists civ_claims_read on public.insurance_claims;
create policy civ_claims_read on public.insurance_claims for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
drop policy if exists civ_claim_ev_read on public.insurance_claim_evidence;
create policy civ_claim_ev_read on public.insurance_claim_evidence for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
drop policy if exists civ_claim_act_read on public.insurance_claim_actions;
create policy civ_claim_act_read on public.insurance_claim_actions for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());

grant select on public.custody_rental_customers, public.custody_rental_requests, public.custody_rental_contracts,
  public.custody_rental_items, public.custody_rental_inspections, public.asset_insurance_policies, public.policy_assets,
  public.insurance_claims, public.insurance_claim_evidence, public.insurance_claim_actions to authenticated;
grant execute on function public.custody_rental_create_request(jsonb) to authenticated;
grant execute on function public.custody_insurance_create_claim(jsonb) to authenticated;
commit;

notify pgrst, 'reload schema';

-- VALIDATION
select 'rental_tables' as k, count(*) from information_schema.tables where table_name like 'custody_rental_%';
select 'insurance_tables' as k, count(*) from information_schema.tables where table_name in ('asset_insurance_policies','insurance_claims');
