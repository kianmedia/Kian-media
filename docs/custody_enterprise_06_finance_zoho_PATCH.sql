-- ════════════════════════════════════════════════════════════════════════════
-- Custody Enterprise Suite — Patch 06: Depreciation/Usage finance + Zoho asset adapter
-- يُشغَّل بعد patch 05. idempotent. الإهلاك تقرير إداري (لا قيد محاسبي). Zoho outbox
-- بلا إرسال تلقائي (خلف flag zoho_asset_sync_enabled + اعتماد صريح).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) حقول مالية/إهلاك على الأصل (purchase_price = تكلفة الشراء الموجودة) ───
alter table public.custody_inventory_assets add column if not exists useful_life_months int;
alter table public.custody_inventory_assets add column if not exists residual_value numeric;
alter table public.custody_inventory_assets add column if not exists depreciation_method text default 'straight_line'
  check (depreciation_method is null or depreciation_method in ('straight_line','usage_based','none'));
alter table public.custody_inventory_assets add column if not exists accumulated_depreciation numeric;
alter table public.custody_inventory_assets add column if not exists book_value numeric;
alter table public.custody_inventory_assets add column if not exists replacement_cost numeric;
alter table public.custody_inventory_assets add column if not exists currency text default 'SAR';
alter table public.custody_inventory_assets add column if not exists zoho_asset_id text;

-- حساب الإهلاك الخطي (تقرير — لا قيد). للمالية/الإدارة فقط.
create or replace function public.custody_finance_compute_depreciation(p_asset uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v_months numeric; v_monthly numeric; v_elapsed numeric; v_acc numeric; v_book numeric;
begin
  if not public.civ_can_finance() then raise exception 'not authorized'; end if;
  if not public.civ_flag('depreciation_enabled') then raise exception 'depreciation_disabled'; end if;
  select * into a from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if a.id is null then raise exception 'not_found'; end if;
  v_months := nullif(a.useful_life_months, 0);
  if a.purchase_price is null or v_months is null or a.purchase_date is null then
    return jsonb_build_object('ok', true, 'computable', false, 'reason', 'missing_inputs');
  end if;
  v_monthly := (a.purchase_price - coalesce(a.residual_value,0)) / v_months;
  v_elapsed := least(v_months, greatest(0, extract(epoch from age(now(), a.purchase_date::timestamp)) / (30.44*86400)));
  v_acc := round(v_monthly * v_elapsed, 2);
  v_book := round(greatest(coalesce(a.residual_value,0), a.purchase_price - v_acc), 2);
  update public.custody_inventory_assets set accumulated_depreciation = v_acc, book_value = v_book, updated_by = auth.uid(), updated_at = now() where id = p_asset;
  return jsonb_build_object('ok', true, 'computable', true, 'monthly', round(v_monthly,2), 'months_elapsed', round(v_elapsed,1),
    'accumulated_depreciation', v_acc, 'book_value', v_book, 'currency', a.currency);
end; $$;

-- مؤشرات الاستخدام والتكلفة (المالية للمخوّل فقط).
create or replace function public.custody_finance_asset_usage(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_fin boolean;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_fin := public.civ_can_finance();
  return jsonb_build_object(
    'times_issued', (select count(*) from public.custody_inventory_movements where asset_id=p_asset and movement_type='issue_to_employee'),
    'projects', (select count(distinct a.project_number) from public.custody_inventory_assignment_items i join public.custody_inventory_assignments a on a.id=i.assignment_id where i.asset_id=p_asset and a.project_number is not null),
    'incidents', (select count(*) from public.custody_incidents where asset_id=p_asset and is_deleted=false),
    'maintenance_count', (select count(*) from public.custody_inventory_maintenance where asset_id=p_asset),
    'last_used', (select max(created_at) from public.custody_inventory_movements where asset_id=p_asset and movement_type='issue_to_employee'),
    'maintenance_cost', case when v_fin then (select coalesce(sum(cost),0) from public.custody_inventory_maintenance where asset_id=p_asset) else null end,
    'purchase_price', case when v_fin then (select purchase_price from public.custody_inventory_assets where id=p_asset) else null end,
    'book_value', case when v_fin then (select book_value from public.custody_inventory_assets where id=p_asset) else null end
  );
end; $$;

-- ─── 2) Zoho asset outbox (لا إرسال تلقائي — إدراج فقط ثم مسار adapter يرسل بعد اعتماد) ───
create table if not exists public.custody_zoho_sync_outbox (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,     -- vendor|maintenance_bill|asset|rental_customer|estimate
  entity_id    uuid not null,
  operation    text not null,     -- create|update
  payload      jsonb,
  status       text not null default 'pending' check (status in ('pending','sent','failed','skipped')),
  external_id  text,
  attempts     int not null default 0,
  last_error   text,
  approved_by  uuid references auth.users(id),
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  last_attempt_at timestamptz
);
create index if not exists idx_civ_zoho_outbox_status on public.custody_zoho_sync_outbox(status, created_at);
create table if not exists public.custody_zoho_sync_log (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references public.custody_zoho_sync_outbox(id),
  result text, message text, created_at timestamptz not null default now()
);

-- إدراج في outbox بعد اعتماد المخوّل (لا يُرسل هنا؛ المسار adapter يرسل).
create or replace function public.custody_zoho_enqueue(p_entity_type text, p_entity_id uuid, p_operation text, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not (public.civ_can_finance() or public.civ_can_admin()) then raise exception 'not authorized'; end if;
  insert into public.custody_zoho_sync_outbox(entity_type, entity_id, operation, payload, approved_by, created_by)
    values (p_entity_type, p_entity_id, coalesce(nullif(p_operation,''),'create'), p_payload, auth.uid(), auth.uid()) returning id into v_id;
  perform public.custody_audit('zoho_enqueue', p_entity_type, p_entity_id, jsonb_build_object('op', p_operation));
  return v_id;
end; $$;

commit;

begin;
alter table public.custody_zoho_sync_outbox enable row level security;
alter table public.custody_zoho_sync_log    enable row level security;
drop policy if exists civ_zoho_outbox_read on public.custody_zoho_sync_outbox;
create policy civ_zoho_outbox_read on public.custody_zoho_sync_outbox for select to authenticated using (public.civ_can_finance() or public.civ_can_admin());
drop policy if exists civ_zoho_log_read on public.custody_zoho_sync_log;
create policy civ_zoho_log_read on public.custody_zoho_sync_log for select to authenticated using (public.civ_can_finance() or public.civ_can_admin());
grant select on public.custody_zoho_sync_outbox, public.custody_zoho_sync_log to authenticated;
grant execute on function public.custody_finance_compute_depreciation(uuid) to authenticated;
grant execute on function public.custody_finance_asset_usage(uuid) to authenticated;
grant execute on function public.custody_zoho_enqueue(text,uuid,text,jsonb) to authenticated;
commit;

notify pgrst, 'reload schema';

-- VALIDATION
select 'depr_cols' as k, count(*) from information_schema.columns where table_name='custody_inventory_assets' and column_name in ('useful_life_months','book_value','zoho_asset_id');
select 'zoho_outbox' as k, count(*) from information_schema.tables where table_name='custody_zoho_sync_outbox';
select 'finance_rpcs' as k, count(*) from pg_proc where proname in ('custody_finance_compute_depreciation','custody_finance_asset_usage','custody_zoho_enqueue');
