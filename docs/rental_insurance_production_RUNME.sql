-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental & Insurance Portal V1 — STANDALONE PRODUCTION RUNME
--   (data + logic + security). ملف إنتاج واحد idempotent — Standalone بالكامل:
--   يعمل على قاعدة لا تحتوي custody_enterprise_05 مسبقًا (ينشئ جداول التأجير/التأمين
--   الأساسية إن غابت)، ثم يرقّيها لطبقة V1 التشغيلية.
-- يعيد استخدام (لا ينشئها — متطلبات أساسية يتحقق منها PREFLIGHT بـ to_regclass/to_regprocedure):
--   جداول: custody_inventory_assets/reservations/movements، custody_enterprise_settings، notifications.
--   دوال: civ_flag(text)/civ_can_manage()/civ_can_finance()/civ_can_admin()/civ_gen_no(text)/
--     civ_notify_managers(text,uuid,text,text)/civ_set_avail(uuid)/civ_client_ip().
--   اختياري (تحذير فقط، لا يوقف): is_staff() للمسار القديم، و custody_incidents (enterprise_03)
--     للربط بوحدة الحوادث — insurance_claims.incident_id يُنشأ بلا FK إن غابت، ولا يعتمد التأجير عليها.
--   طبّق custody_inventory v1 + custody_enterprise_00/01 + طبقة الصلاحيات civ_* قبل هذا الملف.
-- لا hard delete. لا DROP TABLE / TRUNCATE / حذف بيانات / إعادة تسمية Legacy.
--   لا يلمس: العهدة/الأصول، HR، Zoho، الفواتير، العروض، العهدة/التأجير القديم.
-- ترتيب التنفيذ: PREFLIGHT → extensions/helpers (متطلبات) → FOUNDATION tables +
--   base RPCs + base RLS → أعلام + إعدادات → أعمدة/قيود V1 → جداول V1 الجديدة →
--   دوال الأمان + آلة الحالات → دوال دورة الحياة الإدارية → أنواع الإشعارات →
--   تشديد RLS → storage buckets/policies → دوال التشغيل → grants → NOTIFY → Validation.
-- آمن للتكرار. كل قسم داخل transaction؛ storage في قسم منفصل (لا يمكن دمجه بأمان مع الباقي).
-- ════════════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════════════════
-- PREFLIGHT — متطلبات أساسية يجب أن تكون مطبّقة مسبقًا (custody v1 + enterprise_00..04).
--   هذا الملف لا ينشئ العهدة/المخزون/الدوال المساعدة؛ إن غابت يتوقف بخطأ واضح بدل
--   ترك القاعدة نصف مطبّقة. أمّا جداول التأجير/التأمين (enterprise_05) فينشئها هذا
--   الملف أدناه إن غابت (لهذا هو Standalone) — غيابها لا يوقف التنفيذ.
-- ════════════════════════════════════════════════════════════════════════════
-- تصنيف واضح:
--   • External required TABLES — جداول موجودة فعلًا في نظام العهدة/المخزون ولا ينشئها هذا
--     الملف؛ غيابها يوقف التنفيذ (فحص to_regclass). لا تتضمن custody_incidents (وحدة
--     الحوادث enterprise_03) لأن دورة التأجير لا تعتمد عليها — الربط بها اختياري أدناه.
--   • External required FUNCTIONS — دوال مساعدة موجودة قبل هذا الملف؛ غيابها يوقف التنفيذ
--     (فحص to_regprocedure بالتوقيع الكامل، لا بالاسم المجرد).
--   • Optional legacy — تحذير فقط، لا يوقف (is_staff للمسار القديم المعطّل بعلمه).
--   • Created by this RUNME — لا تُفحَص هنا (تُنشأ لاحقًا داخل الملف): جداول/دوال/buckets التأجير والتأمين.
do $$
declare
  v_req_tables text[] := array[
    'public.custody_enterprise_settings',      -- هدف ALTER الأعلام
    'public.custody_inventory_assets',         -- FK بنود التأجير + policy_assets، ومرجع RPCs
    'public.custody_inventory_reservations',   -- FK custody_rental_items.reservation_id
    'public.custody_inventory_movements',      -- توسيع CHECK + حركات rental_out/return
    'public.notifications'];                   -- توسيع notifications_type_check
  v_req_funcs text[] := array[
    'public.civ_flag(text)','public.civ_can_manage()','public.civ_can_finance()',
    'public.civ_can_admin()','public.civ_gen_no(text)',
    'public.civ_notify_managers(text,uuid,text,text)','public.civ_set_avail(uuid)',
    'public.civ_client_ip()'];
  v_miss_t text[] := '{}'; v_have_t text[] := '{}';
  v_miss_f text[] := '{}'; v_have_f text[] := '{}';
  x text;
begin
  foreach x in array v_req_tables loop
    if to_regclass(x) is null then v_miss_t := v_miss_t || x; else v_have_t := v_have_t || x; end if;
  end loop;
  foreach x in array v_req_funcs loop
    if to_regprocedure(x) is null then v_miss_f := v_miss_f || x; else v_have_f := v_have_f || x; end if;
  end loop;

  raise notice '─────────────── PREFLIGHT REPORT ───────────────';
  raise notice 'External TABLES موجودة   : %', coalesce(array_to_string(v_have_t,', '),'(لا شيء)');
  raise notice 'External TABLES مفقودة   : %', coalesce(array_to_string(v_miss_t,', '),'(لا شيء)');
  raise notice 'External FUNCTIONS موجودة: %', coalesce(array_to_string(v_have_f,', '),'(لا شيء)');
  raise notice 'External FUNCTIONS مفقودة: %', coalesce(array_to_string(v_miss_f,', '),'(لا شيء)');
  if to_regprocedure('public.is_staff()') is null then
    raise notice 'Optional legacy مفقود   : public.is_staff() — المسار القديم custody_rental_create_request سيبقى معطّلًا (V1 غير متأثرة).';
  end if;
  if to_regclass('public.custody_incidents') is null then
    raise notice 'Optional link مفقود     : public.custody_incidents — سيُنشأ insurance_claims بعمود incident_id دون FK (لا اعتماد على وحدة الحوادث).';
  end if;
  raise notice 'سيُنشئ هذا الملف: custody_rental_{customers,requests,contracts,items,inspections,settings,events,charges,evidence} + asset_insurance_policies/policy_assets/insurance_claims(+evidence,+actions) + 30 RPC + 3 buckets خاصة + أعلام التأجير.';
  raise notice '────────────────────────────────────────────────';

  if coalesce(array_length(v_miss_t,1),0) > 0 or coalesce(array_length(v_miss_f,1),0) > 0 then
    raise exception E'PREFLIGHT FAILED — متطلبات أساسية خارجية مفقودة.\n  جداول: [%]\n  دوال : [%]\n  طبّق custody_inventory v1 + custody_enterprise_00/01 + طبقة الصلاحيات (civ_*، بما فيها civ_can_finance) قبل هذا الملف. (custody_incidents/enterprise_03 غير مطلوبة للتأجير.)',
      coalesce(array_to_string(v_miss_t,', '),'(لا شيء)'), coalesce(array_to_string(v_miss_f,', '),'(لا شيء)');
  end if;
  raise notice 'PREFLIGHT OK ✓ — المتطلبات الخارجية موجودة. المتابعة إلى إنشاء الأساس.';
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- FOUNDATION — جداول التأجير والتأمين الأساسية (مدمجة حرفيًا من custody_enterprise_05،
--   جُعلت idempotent). تجعل هذا الملف Standalone. إن كانت الجداول موجودة (Patch 05
--   مطبّق) تُترك كما هي دون تعديل بيانات — CREATE IF NOT EXISTS فقط. لا DROP/TRUNCATE.
--   أعمدة V1 الإضافية تُضاف في الأقسام 1..3 أدناه عبر ADD COLUMN IF NOT EXISTS.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- FND-1) بوابة التأجير — الجداول الأساسية (enterprise_05 §1).
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

-- إنشاء طلب تأجير (المسار القديم من patch 05 — مُبقى للتوافق؛ V1 يستخدم admin_upsert أدناه).
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

-- FND-2) التأمين والمطالبات — الجداول الأساسية (enterprise_05 §2).
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
  incident_id   uuid,   -- ربط اختياري بوحدة الحوادث (custody_incidents/enterprise_03) — FK يُضاف شرطيًا أدناه إن كانت مطبّقة. لا يعتمد التأجير عليها.
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

-- ربط اختياري: أضف FK من insurance_claims.incident_id إلى وحدة الحوادث فقط إن كانت مطبّقة
--   (enterprise_03). idempotent (يتحقق من وجود القيد). غيابها لا يكسر التأجير — العمود يبقى
--   uuid حرًّا. هكذا لا يعتمد تشغيل بوابة التأجير على وحدة خارجية غير مطبّقة.
do $$ begin
  if to_regclass('public.custody_incidents') is not null
     and not exists (select 1 from pg_constraint where conname = 'insurance_claims_incident_id_fkey') then
    alter table public.insurance_claims
      add constraint insurance_claims_incident_id_fkey foreign key (incident_id) references public.custody_incidents(id);
  end if;
end $$;

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

-- FND-3) RLS + سياسات القراءة الأساسية + المنح (enterprise_05 §3).
--   ملاحظة: القسم 7 من V1 أدناه يشدّد قراءة الطلبات/العقود/البنود لمدير/مالية فقط
--   (يزيل قراءة العميل المباشرة لتفادي تسريب الأعمدة الداخلية) — تشغيلها بعد هذا مقصود.
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
revoke execute on function public.custody_rental_create_request(jsonb), public.custody_insurance_create_claim(jsonb) from public, anon;
grant execute on function public.custody_rental_create_request(jsonb) to authenticated;
grant execute on function public.custody_insurance_create_claim(jsonb) to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- V1 UPGRADE — أعلام + إعدادات + أعمدة/قيود/جداول V1 فوق الأساس أعلاه.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 0) أعلام المزايا (تُضاف إلى custody_enterprise_settings ذي الصف الواحد id=1) ───
alter table public.custody_enterprise_settings add column if not exists rental_insurance_enabled       boolean not null default false;
alter table public.custody_enterprise_settings add column if not exists rental_customer_portal_enabled boolean not null default false;
alter table public.custody_enterprise_settings add column if not exists rental_whatsapp_enabled        boolean not null default false;
alter table public.custody_enterprise_settings add column if not exists rental_finance_enabled         boolean not null default false;

-- إعدادات التأجير (ضريبة/عملة/نص العقد القابل للإصدار) — صف واحد.
create table if not exists public.custody_rental_settings (
  id                int primary key default 1 check (id = 1),
  vat_rate          numeric not null default 15,
  currency          text not null default 'SAR',
  contract_terms_ar text,
  contract_terms_en text,
  contract_version  int not null default 1,
  updated_by        uuid references auth.users(id),
  updated_at        timestamptz not null default now()
);
insert into public.custody_rental_settings (id, contract_terms_ar)
  values (1, 'قالب عقد يحتاج مراجعة واعتمادًا قانونيًا قبل الاستخدام الخارجي النهائي. يتم إضافة ضريبة القيمة المضافة إلى الفاتورة النهائية.')
  on conflict (id) do nothing;

-- ─── 1) توسيع جدول العملاء (PII بالحد الأدنى؛ المستندات الحساسة في bucket خاص) ───
alter table public.custody_rental_customers add column if not exists id_type          text check (id_type is null or id_type in ('national_id','iqama','cr','passport','other'));
alter table public.custody_rental_customers add column if not exists tax_number       text;
alter table public.custody_rental_customers add column if not exists address          text;
alter table public.custody_rental_customers add column if not exists authorized_person text;
alter table public.custody_rental_customers add column if not exists emergency_contact text;
alter table public.custody_rental_customers add column if not exists updated_at       timestamptz not null default now();

-- ─── 2) توسيع جدول طلب/عقد التأجير (هو كيان دورة الحياة) ───
-- 2-أ) آلة الحالات: نوسّع CHECK لتشمل الحالات القديمة + حالات V1 (لا نكسر صفوفًا قائمة).
alter table public.custody_rental_requests drop constraint if exists custody_rental_requests_status_check;
alter table public.custody_rental_requests add constraint custody_rental_requests_status_check check (status in (
  -- قديمة (patch 05) — مُبقاة للتوافق
  'requested','reviewing','quoted','contracted','under_inspection',
  -- V1 state machine
  'draft','pending_approval','rejected','approved','awaiting_customer_confirmation',
  'contract_pending_signature','scheduled','preparing','ready_for_handover','active',
  'return_requested','inspection_pending','charges_pending','closed','cancelled','overdue'));

-- 2-ب) التسعير + الودائع + التواريخ + التشغيل (كلها ALTER — لا جدول جديد).
alter table public.custody_rental_requests add column if not exists rate_type            text check (rate_type is null or rate_type in ('daily','weekly','monthly','fixed'));
alter table public.custody_rental_requests add column if not exists subtotal             numeric not null default 0 check (subtotal >= 0);
alter table public.custody_rental_requests add column if not exists discount_total       numeric not null default 0 check (discount_total >= 0);
alter table public.custody_rental_requests add column if not exists additional_total     numeric not null default 0 check (additional_total >= 0);
alter table public.custody_rental_requests add column if not exists vat_rate             numeric not null default 15;
alter table public.custody_rental_requests add column if not exists vat_amount           numeric not null default 0 check (vat_amount >= 0);
alter table public.custody_rental_requests add column if not exists grand_total          numeric not null default 0 check (grand_total >= 0);
alter table public.custody_rental_requests add column if not exists currency             text not null default 'SAR';
-- الوديعة/الضمان (مستقل عن insurance_claims الخاص بتأمين الأصول)
alter table public.custody_rental_requests add column if not exists deposit_amount       numeric not null default 0 check (deposit_amount >= 0);
alter table public.custody_rental_requests add column if not exists deposit_status       text not null default 'not_required'
  check (deposit_status in ('not_required','pending','received','held','partially_applied','fully_applied','release_pending','released','refunded','forfeited'));
alter table public.custody_rental_requests add column if not exists deposit_received     numeric not null default 0 check (deposit_received >= 0);
alter table public.custody_rental_requests add column if not exists deposit_method       text;
alter table public.custody_rental_requests add column if not exists deposit_ref_no       text;
alter table public.custody_rental_requests add column if not exists deposit_received_at  timestamptz;
alter table public.custody_rental_requests add column if not exists deposit_applied      numeric not null default 0 check (deposit_applied >= 0);
alter table public.custody_rental_requests add column if not exists deposit_released     numeric not null default 0 check (deposit_released >= 0);
alter table public.custody_rental_requests add column if not exists deposit_released_at  timestamptz;
alter table public.custody_rental_requests add column if not exists deposit_note         text;
-- التواريخ التشغيلية
alter table public.custody_rental_requests add column if not exists actual_handover_at   timestamptz;
alter table public.custody_rental_requests add column if not exists actual_return_at     timestamptz;
alter table public.custody_rental_requests add column if not exists operator_user_id     uuid references auth.users(id);
alter table public.custody_rental_requests add column if not exists customer_note        text;
alter table public.custody_rental_requests add column if not exists internal_note        text;
alter table public.custody_rental_requests add column if not exists approved_by          uuid references auth.users(id);
alter table public.custody_rental_requests add column if not exists ready_for_zoho       boolean not null default false;
create index if not exists idx_rental_req_status on public.custody_rental_requests(status) where status not in ('closed','cancelled','rejected');
create index if not exists idx_rental_req_window on public.custody_rental_requests(rental_from, rental_to);

-- 2-ج) بنود التأجير: تسعير البند + الحجز + التسلسلي.
alter table public.custody_rental_items add column if not exists reservation_id  uuid references public.custody_inventory_reservations(id);
alter table public.custody_rental_items add column if not exists rate            numeric not null default 0 check (rate >= 0);
alter table public.custody_rental_items add column if not exists rate_unit       text check (rate_unit is null or rate_unit in ('day','week','month','fixed'));
alter table public.custody_rental_items add column if not exists units_count     numeric not null default 1 check (units_count > 0);
alter table public.custody_rental_items add column if not exists line_discount   numeric not null default 0 check (line_discount >= 0);
alter table public.custody_rental_items add column if not exists line_total      numeric not null default 0 check (line_total >= 0);
alter table public.custody_rental_items add column if not exists serial_number   text;
alter table public.custody_rental_items add column if not exists returned_qty    numeric not null default 0 check (returned_qty >= 0);
create index if not exists idx_rental_items_asset on public.custody_rental_items(asset_id);
create index if not exists idx_rental_items_request on public.custody_rental_items(request_id);

-- 2-د) العقود: إصدارات + توقيع + hash + snapshot ثابت.
alter table public.custody_rental_contracts add column if not exists version            int not null default 1;
alter table public.custody_rental_contracts add column if not exists snapshot           jsonb;
alter table public.custody_rental_contracts add column if not exists contract_hash      text;
alter table public.custody_rental_contracts add column if not exists consent_text       text;
alter table public.custody_rental_contracts add column if not exists customer_signed_name text;
alter table public.custody_rental_contracts add column if not exists customer_signed_ip   text;
alter table public.custody_rental_contracts add column if not exists customer_signed_ua   text;
alter table public.custody_rental_contracts add column if not exists signed_by_user     uuid references auth.users(id);
alter table public.custody_rental_contracts add column if not exists superseded_by      uuid references public.custody_rental_contracts(id);

-- ─── 3) جداول جديدة (لا مقابل لها في patch 05) ───
-- 3-أ) سجل تدقيق انتقالات الحالة (append-only).
create table if not exists public.custody_rental_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.custody_rental_requests(id) on delete cascade,
  from_status text,
  to_status   text not null,
  actor_id    uuid references auth.users(id),
  reason      text,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_rental_events_req on public.custody_rental_events(request_id, created_at desc);

-- 3-ب) الرسوم/المطالبات (تلف/نقص/تأخير) — اعتمادها المالي منفصل عن التسجيل.
create table if not exists public.custody_rental_charges (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.custody_rental_requests(id) on delete cascade,
  item_id       uuid references public.custody_rental_items(id),
  charge_type   text not null check (charge_type in ('damage','missing_item','missing_accessory','late_return','misuse','cleaning','other')),
  description   text,
  estimate      numeric not null default 0 check (estimate >= 0),
  approved_amount numeric check (approved_amount is null or approved_amount >= 0),
  status        text not null default 'reported' check (status in ('reported','approved','rejected','settled')),
  from_deposit  numeric not null default 0 check (from_deposit >= 0),
  additional_due numeric not null default 0 check (additional_due >= 0),
  reported_by   uuid references auth.users(id),
  approved_by   uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_rental_charges_req on public.custody_rental_charges(request_id);

-- 3-ج) أدلة التسليم/الإرجاع (bucket rental-evidence — منفصل عن صور كتالوج الأصول).
create table if not exists public.custody_rental_evidence (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.custody_rental_requests(id) on delete cascade,
  item_id     uuid references public.custody_rental_items(id),
  stage       text not null check (stage in ('handover','return_request','return_inspection')),
  file_path   text not null,
  condition   text,
  note        text,
  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index if not exists idx_rental_evidence_req on public.custody_rental_evidence(request_id);

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) الأدلة الأمنية: أعلام + صلاحية عرض الطلب + التوفّر المانع للتعارض + آلة الحالات
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- 4-أ) بوابة العلم (fail-safe مثل civ_flag).
create or replace function public.rental_enabled() returns boolean
language sql stable security definer set search_path = public as $$
  select public.civ_flag('rental_insurance_enabled');
$$;

-- 4-ب) هل يرى المستخدم هذا الطلب؟ (مدير عهدة/مالية/مالك أو صاحب الطلب).
create or replace function public.rental_can_view(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.civ_can_manage() or public.civ_can_finance() or exists (
    select 1 from public.custody_rental_requests r
    join public.custody_rental_customers c on c.id = r.customer_id
    where r.id = p_request and c.user_id = auth.uid());
$$;

-- 4-ج) التوفّر المانع للتعارض حسب نافذة زمنية (يُحتسب المصروف من كل المصادر).
--     يعيد jsonb: {available boolean, free numeric, total, committed, reason}.
--     committed = تأجيرات متداخلة (blocking) + عهدة نشطة + صيانة + محجوز عهدة، ضمن [from,to].
create or replace function public.custody_rental_availability(p_asset uuid, p_from timestamptz, p_to timestamptz, p_qty numeric default 1)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_rent numeric; v_res numeric; v_committed numeric; v_free numeric;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'bad_window'; end if;
  select * into a from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if a.id is null then raise exception 'asset_not_found'; end if;
  if a.availability_status in ('lost','retired') then
    return jsonb_build_object('available', false, 'reason', 'asset_'||a.availability_status, 'total', a.quantity_total, 'free', 0);
  end if;
  -- كمية التأجير المتداخلة زمنيًا في حالات حاجزة.
  -- quantity_available = المتاح فعليًا الآن (يستثني المصروف عهدةً + التأجير المُسلَّم + الصيانة).
  -- حجوزات تأجير غير مُسلَّمة (status='reserved') متداخلة زمنيًا — لم تُخصم بعد من المتاح.
  -- (issued/return_requested مُسلَّمة فعليًا ⇒ مخصومة من quantity_available؛ لا تُحتسب مرتين).
  -- draft/pending أيضًا 'reserved' ⇒ محسوبة (منع الازدواج قبل الاعتماد).
  select coalesce(sum(i.quantity),0) into v_rent
    from public.custody_rental_items i
    join public.custody_rental_requests r on r.id = i.request_id
   where i.asset_id = p_asset
     and i.status = 'reserved'
     and r.status not in ('cancelled','rejected','closed')
     and r.rental_from is not null and r.rental_to is not null
     and r.rental_from < p_to and r.rental_to > p_from;
  -- محجوز العهدة الداخلية المتداخل زمنيًا (لم يُخصم من المتاح بعد).
  select coalesce(sum(res.quantity),0) into v_res
    from public.custody_inventory_reservations res
   where res.asset_id = p_asset and res.status = 'active'
     and coalesce(res.reserved_from, p_from) < p_to and coalesce(res.reserved_to, p_to) > p_from;
  v_free := a.quantity_available - v_rent - v_res;
  v_committed := a.quantity_total - v_free;
  return jsonb_build_object(
    'available', v_free >= coalesce(p_qty,1), 'free', v_free, 'total', a.quantity_total,
    'committed', v_committed, 'rented_overlap', v_rent, 'reserved_overlap', v_res,
    'asset_type', a.asset_type, 'reason', case when v_free >= coalesce(p_qty,1) then 'ok' else 'insufficient' end);
end; $$;

-- 4-د) آلة الحالات: الانتقالات المسموحة + الدور، وتسجيل الحدث. (النقلات التلقائية داخل
--      دوال دورة الحياة؛ هذه للنقلات الإدارية اليدوية: اعتماد/رفض/إلغاء/تجهيز…)
create or replace function public.custody_rental_transition(p_request uuid, p_to text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_from text; v_ok boolean := false; v_admin boolean; v_manage boolean;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  v_manage := public.civ_can_manage(); v_admin := public.civ_can_admin();
  if not v_manage then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  v_from := r.status;
  -- خريطة النقلات اليدوية المسموحة (النقلات المالية/التوقيع/التسليم عبر دوالها المخصّصة).
  v_ok := case
    when v_from = 'draft'                         and p_to in ('pending_approval','cancelled') then true
    when v_from = 'pending_approval'              and p_to in ('approved','rejected','cancelled') then true
    when v_from = 'approved'                      and p_to in ('awaiting_customer_confirmation','cancelled') then true
    when v_from = 'awaiting_customer_confirmation' and p_to in ('contract_pending_signature','cancelled') then true
    when v_from = 'scheduled'                     and p_to in ('preparing','cancelled') then true
    when v_from = 'preparing'                     and p_to in ('ready_for_handover','cancelled') then true
    when v_from = 'ready_for_handover'            and p_to in ('preparing','cancelled') then true
    when v_from in ('active','overdue')           and p_to = 'return_requested' then true
    when v_from = 'return_requested'              and p_to = 'inspection_pending' then true
    else false end;
  -- الإلغاء بعد الاعتماد يتطلب أدمن.
  if p_to = 'cancelled' and v_from not in ('draft','pending_approval') and not v_admin then raise exception 'cancel_requires_admin'; end if;
  if not v_ok then raise exception 'illegal_transition: % -> %', v_from, p_to; end if;

  update public.custody_rental_requests set status = p_to, updated_at = now(),
    approved_by = case when p_to = 'approved' then auth.uid() else approved_by end
    where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason)
    values (p_request, v_from, p_to, auth.uid(), nullif(trim(p_reason),''));
  begin perform public.custody_audit('rental_transition','custody_rental_request', p_request, jsonb_build_object('from',v_from,'to',p_to));
    exception when undefined_function then null; when others then null; end;
  -- إشعارات لأحداث مختارة (الأنواع مضافة في CHECK بالأسفل).
  if p_to = 'approved' then perform public.civ_notify_managers('rental_approved', p_request, 'اعتُمد طلب تأجير '||r.request_number, 'Rental approved: '||r.request_number);
  elsif p_to = 'rejected' then perform public.civ_notify_managers('rental_rejected', p_request, 'رُفض طلب تأجير '||r.request_number, 'Rental rejected: '||r.request_number);
  end if;
  return jsonb_build_object('ok', true, 'from', v_from, 'to', p_to);
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) دوال دورة الحياة (كلها SECURITY DEFINER، بوابة علم، دور، تدقيق)
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- 5-أ) إنشاء/تحديث طلب (مسودة) — إداري.
create or replace function public.custody_rental_admin_upsert_request(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_no text; v_cust uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_cust := nullif(p_data->>'customer_id','')::uuid;
  if v_cust is null and coalesce(trim(p_data->>'full_name'),'') <> '' then
    insert into public.custody_rental_customers(party_type, full_name, company_name, phone, email, id_type, id_number_ref, tax_number, address, authorized_person, created_by)
      values (coalesce(nullif(p_data->>'party_type',''),'individual'), trim(p_data->>'full_name'), nullif(trim(p_data->>'company_name'),''),
              nullif(trim(p_data->>'phone'),''), nullif(trim(p_data->>'email'),''), nullif(p_data->>'id_type',''), nullif(trim(p_data->>'id_number_ref'),''),
              nullif(trim(p_data->>'tax_number'),''), nullif(trim(p_data->>'address'),''), nullif(trim(p_data->>'authorized_person'),''), auth.uid())
      returning id into v_cust;
  end if;
  v_id := nullif(p_data->>'id','')::uuid;
  if v_id is null then
    v_no := public.civ_gen_no('RNT');
    insert into public.custody_rental_requests(request_number, customer_id, status, rental_from, rental_to, rate_type, purpose, customer_note, internal_note, created_by)
      values (v_no, v_cust, 'draft', nullif(p_data->>'rental_from','')::timestamptz, nullif(p_data->>'rental_to','')::timestamptz,
              nullif(p_data->>'rate_type',''), nullif(trim(p_data->>'purpose'),''), nullif(trim(p_data->>'customer_note'),''), nullif(trim(p_data->>'internal_note'),''), auth.uid())
      returning id into v_id;
    insert into public.custody_rental_events(request_id, to_status, actor_id, reason) values (v_id, 'draft', auth.uid(), 'created');
    perform public.civ_notify_managers('rental_request_created', v_id, 'طلب تأجير جديد '||v_no, 'New rental request '||v_no);
  else
    update public.custody_rental_requests set
      customer_id = coalesce(v_cust, customer_id),
      rental_from = coalesce(nullif(p_data->>'rental_from','')::timestamptz, rental_from),
      rental_to   = coalesce(nullif(p_data->>'rental_to','')::timestamptz, rental_to),
      rate_type   = coalesce(nullif(p_data->>'rate_type',''), rate_type),
      purpose     = coalesce(nullif(trim(p_data->>'purpose'),''), purpose),
      customer_note = case when p_data ? 'customer_note' then nullif(trim(p_data->>'customer_note'),'') else customer_note end,
      internal_note = case when p_data ? 'internal_note' then nullif(trim(p_data->>'internal_note'),'') else internal_note end,
      updated_at = now()
    where id = v_id and status in ('draft','pending_approval');
    if not found then raise exception 'not_editable'; end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

-- 5-ب) إضافة بند (مع فحص توفّر النافذة الزمنية) — إداري.
create or replace function public.custody_rental_admin_add_item(p_request uuid, p_asset uuid, p_qty numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; av jsonb;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('draft','pending_approval','approved') then raise exception 'not_editable'; end if;
  if r.rental_from is null or r.rental_to is null then raise exception 'set_dates_first'; end if;
  -- تسلسل الحجز على الأصل: يقفل صف الأصل كي تتوالى نداءات add_item المتزامنة لنفس الأصل
  -- (منع write-skew — قفل صف الطلب وحده لا يحمي). ثم يُعاد فحص التوفّر داخل نفس المعاملة.
  perform 1 from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  av := public.custody_rental_availability(p_asset, r.rental_from, r.rental_to, coalesce(p_qty,1));
  if not (av->>'available')::boolean then raise exception 'not_available: %', av->>'reason'; end if;
  insert into public.custody_rental_items(request_id, asset_id, quantity, units_count, status)
    values (p_request, p_asset, coalesce(p_qty,1), coalesce(p_qty,1), 'reserved');
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.custody_rental_admin_remove_item(p_item uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare it record; r record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into it from public.custody_rental_items where id = p_item;
  if it.id is null then raise exception 'not_found'; end if;
  select * into r from public.custody_rental_requests where id = it.request_id;
  if r.status not in ('draft','pending_approval','approved') then raise exception 'not_editable'; end if;
  if it.status <> 'reserved' then raise exception 'item_active'; end if;
  delete from public.custody_rental_items where id = p_item;
  return true;
end; $$;

-- 5-ج) التسعير + الوديعة — مالية فقط.
create or replace function public.custody_rental_finance_price(p_request uuid, p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_vat numeric; v_sub numeric; v_disc numeric; v_add numeric; v_base numeric; v_vatamt numeric;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_finance() then raise exception 'not authorized: finance only'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status in ('closed','cancelled') then raise exception 'not_editable'; end if;
  -- لا إعادة تسعير بعد توقيع العقد (تنحرف عن نسخة العقد المجمّدة) — أعد توليد عقد جديد بدلًا من ذلك.
  if exists (select 1 from public.custody_rental_contracts where request_id = p_request and status = 'signed') then raise exception 'contract_signed_reprice_forbidden'; end if;
  v_sub  := round(greatest(0, coalesce((p_data->>'subtotal')::numeric, r.subtotal)), 2);
  v_disc := round(greatest(0, coalesce((p_data->>'discount_total')::numeric, r.discount_total)), 2);
  v_add  := round(greatest(0, coalesce((p_data->>'additional_total')::numeric, r.additional_total)), 2);
  v_vat  := greatest(0, coalesce((p_data->>'vat_rate')::numeric, r.vat_rate));
  -- تقريب الصافي أولًا ثم الضريبة، ثم الإجمالي = الصافي + الضريبة (كي تتطابق الفاتورة دائمًا).
  v_base   := round(greatest(0, v_sub - v_disc + v_add), 2);
  v_vatamt := round(v_base * v_vat / 100.0, 2);
  update public.custody_rental_requests set
    subtotal = v_sub, discount_total = v_disc, additional_total = v_add, vat_rate = v_vat,
    vat_amount = v_vatamt, grand_total = v_base + v_vatamt,
    deposit_amount = greatest(0, coalesce((p_data->>'deposit_amount')::numeric, r.deposit_amount)),
    deposit_status = case when coalesce((p_data->>'deposit_amount')::numeric, r.deposit_amount) > 0 and r.deposit_status = 'not_required' then 'pending' else r.deposit_status end,
    currency = coalesce(nullif(p_data->>'currency',''), currency), ready_for_zoho = true, updated_at = now()
  where id = p_request;
  begin perform public.custody_audit('rental_priced','custody_rental_request', p_request, jsonb_build_object('grand', v_base + v_vatamt)); exception when others then null; end;
  return jsonb_build_object('ok', true);
end; $$;

-- 5-د) تسجيل استلام/تسوية الوديعة — مالية فقط (حراسة حالات + مقادير مُقيَّدة).
create or replace function public.custody_rental_finance_deposit(p_request uuid, p_action text, p_amount numeric, p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_remaining numeric; v_rel numeric;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_finance() then raise exception 'not authorized: finance only'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;

  if p_action = 'receive' then
    if r.deposit_status not in ('not_required','pending','received') then raise exception 'deposit_already_held'; end if;
    if coalesce(p_amount,0) <= 0 then raise exception 'amount_required'; end if;
    update public.custody_rental_requests set deposit_received = round(p_amount,2), deposit_status = 'held',
      deposit_method = nullif(p_data->>'method',''), deposit_ref_no = nullif(p_data->>'ref',''), deposit_received_at = now(), updated_at = now()
      where id = p_request;

  elsif p_action = 'release' then
    if r.deposit_status not in ('held','partially_applied','release_pending') then raise exception 'bad_deposit_state'; end if;
    v_remaining := greatest(0, r.deposit_received - r.deposit_applied - r.deposit_released);
    v_rel := least(round(coalesce(p_amount, v_remaining),2), v_remaining);   -- لا يتجاوز المتبقّي
    if v_rel <= 0 then raise exception 'nothing_to_release'; end if;
    update public.custody_rental_requests set deposit_released = r.deposit_released + v_rel, deposit_released_at = now(),
      deposit_status = case when (r.deposit_released + v_rel + r.deposit_applied) >= r.deposit_received then 'released' else 'release_pending' end,
      updated_at = now() where id = p_request;

  elsif p_action = 'forfeit' then
    if r.deposit_status not in ('held','partially_applied','release_pending') then raise exception 'bad_deposit_state'; end if;
    update public.custody_rental_requests set deposit_status = 'forfeited', updated_at = now() where id = p_request;

  else raise exception 'bad_action'; end if;
  begin perform public.custody_audit('rental_deposit_'||p_action,'custody_rental_request', p_request, jsonb_build_object('amount', p_amount)); exception when others then null; end;
  return jsonb_build_object('ok', true);
end; $$;

-- 5-هـ) قراءة العميل الآمنة (أعمدة العميل فقط — بلا internal_note/مرجع الوديعة/ملاحظات مالية).
create or replace function public.custody_rental_customer_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'request_number', r.request_number, 'status', r.status,
      'rental_from', r.rental_from, 'rental_to', r.rental_to,
      'subtotal', r.subtotal, 'discount_total', r.discount_total, 'additional_total', r.additional_total,
      'vat_rate', r.vat_rate, 'vat_amount', r.vat_amount, 'grand_total', r.grand_total, 'currency', r.currency,
      'deposit_amount', r.deposit_amount, 'deposit_status', r.deposit_status, 'customer_note', r.customer_note,
      'created_at', r.created_at) order by r.created_at desc)
    from public.custody_rental_requests r
    join public.custody_rental_customers c on c.id = r.customer_id
    where c.user_id = auth.uid()), '[]'::jsonb);
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) الإشعارات: توسيع CHECK بالحفاظ على كل الأنواع + أنواع التأجير الجديدة
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'quote_request_new','message_new','file_link_new','project_note_new','deliverable_new',
  'revision_requested','deliverable_approved','deliverable_final_delivered','project_status_changed',
  'opportunity_new','whatsapp_new','project_brief_new','portal_request_new',
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed',
  'custody_checkout_new','rental_request_new','custody_return_submitted','custody_return_shortage',
  'custody_handover_approved','custody_closed','custody_rejected','custody_note_new',
  'custody_claim_pending','custody_claim_acknowledged',
  'hr_check_in','hr_check_out','hr_leave_new','hr_leave_decided','hr_task_new',
  'hr_task_started','hr_task_submitted','hr_task_closed','hr_attendance_adjusted','hr_note_new',
  'civ_asset_created','civ_asset_updated','civ_assignment_created','civ_confirm_pending',
  'civ_employee_confirmed','civ_employee_rejected','civ_return_requested','civ_return_accepted',
  'civ_return_rejected','civ_return_inspected','civ_damage_reported','civ_lost_reported','civ_maintenance_opened',
  'civ_maintenance_closed','civ_audit_started','civ_audit_approved','civ_audit_variance',
  'civ_stock_correction','civ_reservation_created','civ_custodian_changed',
  'civ_legacy_visibility_changed','civ_return_overdue','civ_warranty_expiring','civ_self_issue',
  'qr_reissued','kit_issued','kit_returned','custody_due_soon','custody_overdue','custody_escalated',
  'custody_incident_reported','custody_incident_updated','custody_signature_completed',
  'custody_location_started','custody_location_stopped','custody_offline_conflict',
  'rental_request_created','rental_contract_signed','rental_overdue',
  'maintenance_estimate_requested','maintenance_cost_approved','maintenance_completed',
  'purchase_request_created','purchase_request_approved','insurance_expiring','insurance_claim_updated','zoho_sync_failed',
  -- rental V1 (جديد) — مع الحفاظ على كل ما سبق
  'rental_pending_approval','rental_approved','rental_rejected','rental_contract_ready','rental_handover_scheduled',
  'rental_activated','rental_due_soon','rental_return_requested','rental_return_inspection_required',
  'rental_damage_reported','rental_charges_pending','rental_deposit_release_pending','rental_closed'
));
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) RLS + الصلاحيات (القراءة بالسياسات؛ الكتابة عبر الدوال SECURITY DEFINER فقط)
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.custody_rental_settings   enable row level security;
alter table public.custody_rental_events     enable row level security;
alter table public.custody_rental_charges    enable row level security;
alter table public.custody_rental_evidence   enable row level security;

drop policy if exists rental_settings_read on public.custody_rental_settings;
create policy rental_settings_read on public.custody_rental_settings for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());

drop policy if exists rental_events_read on public.custody_rental_events;
create policy rental_events_read on public.custody_rental_events for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());

-- الرسوم المالية: للمدراء/المالية فقط (لا يراها المستأجر مباشرة).
drop policy if exists rental_charges_read on public.custody_rental_charges;
create policy rental_charges_read on public.custody_rental_charges for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());

-- الأدلة: مدير عهدة/مالية فقط (لا قراءة مباشرة للعميل — يقرأ عبر RPC آمن).
drop policy if exists rental_evidence_read on public.custody_rental_evidence;
create policy rental_evidence_read on public.custody_rental_evidence for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());

-- تشديد سياسات القراءة الموروثة من enterprise_05: إزالة قراءة العميل المباشرة (كانت تسرّب
-- أعمدة داخلية: internal_note/تسعير/مرجع الوديعة). العميل يقرأ عبر RPC آمن يعيد أعمدة العميل فقط.
drop policy if exists civ_rental_req_read on public.custody_rental_requests;
create policy civ_rental_req_read on public.custody_rental_requests for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
drop policy if exists civ_rental_contract_read on public.custody_rental_contracts;
create policy civ_rental_contract_read on public.custody_rental_contracts for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());
drop policy if exists civ_rental_items_read on public.custody_rental_items;
create policy civ_rental_items_read on public.custody_rental_items for select to authenticated using (public.civ_can_manage() or public.civ_can_finance());

-- منح القراءة (RLS تحكم الصفوف).
grant select on public.custody_rental_settings, public.custody_rental_events, public.custody_rental_charges, public.custody_rental_evidence to authenticated;

-- منح تنفيذ الدوال.
revoke all on function public.rental_enabled() from public, anon;
revoke all on function public.rental_can_view(uuid) from public, anon;
revoke all on function public.custody_rental_availability(uuid,timestamptz,timestamptz,numeric) from public, anon;
revoke all on function public.custody_rental_transition(uuid,text,text) from public, anon;
revoke all on function public.custody_rental_admin_upsert_request(jsonb) from public, anon;
revoke all on function public.custody_rental_admin_add_item(uuid,uuid,numeric) from public, anon;
revoke all on function public.custody_rental_admin_remove_item(uuid) from public, anon;
revoke all on function public.custody_rental_finance_price(uuid,jsonb) from public, anon;
revoke all on function public.custody_rental_finance_deposit(uuid,text,numeric,jsonb) from public, anon;
revoke all on function public.custody_rental_customer_list() from public, anon;
grant execute on function public.rental_enabled() to authenticated;
grant execute on function public.rental_can_view(uuid) to authenticated;
grant execute on function public.custody_rental_availability(uuid,timestamptz,timestamptz,numeric) to authenticated;
grant execute on function public.custody_rental_transition(uuid,text,text) to authenticated;
grant execute on function public.custody_rental_admin_upsert_request(jsonb) to authenticated;
grant execute on function public.custody_rental_admin_add_item(uuid,uuid,numeric) to authenticated;
grant execute on function public.custody_rental_admin_remove_item(uuid) to authenticated;
grant execute on function public.custody_rental_finance_price(uuid,jsonb) to authenticated;
grant execute on function public.custody_rental_finance_deposit(uuid,text,numeric,jsonb) to authenticated;
grant execute on function public.custody_rental_customer_list() to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) التخزين: buckets خاصة (append-only: select+insert فقط) — منفصلة عن كتالوج الأصول
-- ════════════════════════════════════════════════════════════════════════════
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('rental-evidence','rental-evidence', false, 10485760, array['image/jpeg','image/png','image/webp']),
  ('rental-contracts','rental-contracts', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp']),
  ('rental-private-documents','rental-private-documents', false, 10485760, array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;

-- أدلة التسليم/الإرجاع: مدير عهدة يقرأ/يكتب (المسار المنظّم rental/{rental_id}/handover/{item}/{uuid}.ext).
drop policy if exists "rental evidence read"  on storage.objects;
drop policy if exists "rental evidence write" on storage.objects;
create policy "rental evidence read"  on storage.objects for select to authenticated using (bucket_id='rental-evidence' and public.civ_can_manage());
create policy "rental evidence write" on storage.objects for insert to authenticated with check (bucket_id='rental-evidence' and public.civ_can_manage());

-- العقود: مدير عهدة أو مالية.
drop policy if exists "rental contracts read"  on storage.objects;
drop policy if exists "rental contracts write" on storage.objects;
create policy "rental contracts read"  on storage.objects for select to authenticated using (bucket_id='rental-contracts' and (public.civ_can_manage() or public.civ_can_finance()));
create policy "rental contracts write" on storage.objects for insert to authenticated with check (bucket_id='rental-contracts' and public.civ_can_manage());

-- المستندات الخاصة (هوية/سجل/تأمين): مالية أو مالك/أدمن فقط (لا أمين عهدة).
drop policy if exists "rental private read"  on storage.objects;
drop policy if exists "rental private write" on storage.objects;
create policy "rental private read"  on storage.objects for select to authenticated using (bucket_id='rental-private-documents' and (public.civ_can_finance() or public.civ_can_admin()));
create policy "rental private write" on storage.objects for insert to authenticated with check (bucket_id='rental-private-documents' and (public.civ_can_finance() or public.civ_can_admin()));
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 9) دورة الحياة التشغيلية: العقد/التسليم/الإرجاع/الفحص/الرسوم/الإغلاق + القراءات
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- توسيع حركات المخزون بنوعَي التأجير (مع الحفاظ على كل الأنواع السابقة).
alter table public.custody_inventory_movements drop constraint if exists custody_inventory_movements_movement_type_check;
alter table public.custody_inventory_movements add constraint custody_inventory_movements_movement_type_check check (movement_type in (
  'initial_stock','stock_adjustment','issue_to_employee','employee_confirmed',
  'return_requested','return_to_stock','partial_return','transfer_location','transfer_to_maintenance',
  'return_from_maintenance','damaged','lost','retired','cancelled_issue','manual_correction',
  'rental_out','rental_return'));

-- ─── 9-أ) العقد: توليد نسخة/إصدار (snapshot ثابت) ───
create or replace function public.custody_rental_generate_contract(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_no text; v_id uuid; v_ver int; v_snap jsonb; v_terms text; v_items jsonb;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('approved','awaiting_customer_confirmation','contract_pending_signature') then raise exception 'bad_status'; end if;
  if not exists (select 1 from public.custody_rental_items where request_id = p_request) then raise exception 'no_items'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('asset_id', i.asset_id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
           'serial_number', coalesce(i.serial_number, a.serial_number), 'quantity', i.quantity, 'rate', i.rate, 'rate_unit', i.rate_unit, 'line_total', i.line_total)), '[]'::jsonb)
    into v_items from public.custody_rental_items i join public.custody_inventory_assets a on a.id = i.asset_id where i.request_id = p_request;
  select coalesce(contract_terms_ar,'') into v_terms from public.custody_rental_settings where id = 1;
  v_snap := jsonb_build_object(
    'request_number', r.request_number, 'customer', (select to_jsonb(c) from public.custody_rental_customers c where c.id = r.customer_id),
    'items', v_items, 'rental_from', r.rental_from, 'rental_to', r.rental_to,
    'subtotal', r.subtotal, 'discount_total', r.discount_total, 'additional_total', r.additional_total,
    'vat_rate', r.vat_rate, 'vat_amount', r.vat_amount, 'grand_total', r.grand_total, 'currency', r.currency,
    'deposit_amount', r.deposit_amount, 'generated_at', now());
  select coalesce(max(version),0)+1 into v_ver from public.custody_rental_contracts where request_id = p_request;
  -- أبطل أي مسودة سابقة غير موقّعة (إصدار جديد).
  update public.custody_rental_contracts set status = 'cancelled' where request_id = p_request and status = 'draft';
  v_no := public.civ_gen_no('RCT');
  insert into public.custody_rental_contracts(contract_number, request_id, customer_id, terms_snapshot, snapshot, consent_text, version, status, created_by)
    values (v_no, p_request, r.customer_id, v_terms, v_snap, v_terms, v_ver, 'draft', auth.uid()) returning id into v_id;
  update public.custody_rental_requests set status = 'contract_pending_signature', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason)
    values (p_request, r.status, 'contract_pending_signature', auth.uid(), 'contract v'||v_ver);
  perform public.civ_notify_managers('rental_contract_ready', p_request, 'عقد جاهز للتوقيع '||r.request_number, 'Contract ready '||r.request_number);
  return jsonb_build_object('ok', true, 'contract_id', v_id, 'contract_number', v_no, 'version', v_ver);
end; $$;

-- ─── 9-ب) توقيع العقد (العميل صاحب الطلب أو موظف مخوّل) — تجميد النسخة + hash ───
create or replace function public.custody_rental_sign_contract(p_contract uuid, p_signer_name text, p_signature_path text, p_ua text default null, p_consent text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ct record; r record; v_is_customer boolean; v_hash text;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select * into ct from public.custody_rental_contracts where id = p_contract for update;
  if ct.id is null then raise exception 'not_found'; end if;
  if ct.status <> 'draft' then raise exception 'already_signed'; end if;
  select * into r from public.custody_rental_requests where id = ct.request_id for update;
  if r.status <> 'contract_pending_signature' then raise exception 'bad_status'; end if;   -- لا توقيع لطلب ملغى/غير منتظر
  v_is_customer := exists (select 1 from public.custody_rental_customers c where c.id = ct.customer_id and c.user_id = auth.uid());
  if not (public.civ_can_manage() or v_is_customer) then raise exception 'not authorized'; end if;
  if coalesce(trim(p_signer_name),'') = '' or coalesce(trim(p_signature_path),'') = '' then raise exception 'signature_required'; end if;
  v_hash := encode(sha256(convert_to(coalesce(ct.snapshot::text,''),'UTF8')), 'hex');
  update public.custody_rental_contracts set status = 'signed', signed_at = now(),
    customer_signature_path = p_signature_path, customer_signed_name = trim(p_signer_name),
    customer_signed_ip = public.civ_client_ip(), customer_signed_ua = left(coalesce(p_ua,''),400),
    signed_by_user = auth.uid(), consent_text = coalesce(nullif(trim(p_consent),''), consent_text), contract_hash = v_hash
    where id = p_contract;
  update public.custody_rental_requests set status = 'scheduled', updated_at = now() where id = ct.request_id;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason)
    values (ct.request_id, r.status, 'scheduled', auth.uid(), 'contract signed');
  perform public.civ_notify_managers('rental_contract_signed', ct.request_id, 'وُقّع عقد '||r.request_number, 'Contract signed '||r.request_number);
  return jsonb_build_object('ok', true, 'hash', v_hash);
end; $$;

-- ─── 9-ج) التسليم: فتح جلسة / إضافة دليل قطعة / إكمال (تفعيل) ───
create or replace function public.custody_rental_start_handover(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('scheduled','preparing','ready_for_handover') then raise exception 'bad_status'; end if;
  update public.custody_rental_requests set status = 'preparing', updated_at = now() where id = p_request;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.custody_rental_add_handover_evidence(p_request uuid, p_item uuid, p_path text, p_condition text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_path),'') = '' then raise exception 'path_required'; end if;
  select * into it from public.custody_rental_items where id = p_item and request_id = p_request;
  if it.id is null then raise exception 'item_not_in_request'; end if;
  insert into public.custody_rental_evidence(request_id, item_id, stage, file_path, condition, note, uploaded_by)
    values (p_request, p_item, 'handover', p_path, nullif(p_condition,''), nullif(trim(p_note),''), auth.uid());
  update public.custody_rental_items set condition_out = coalesce(nullif(p_condition,''), condition_out), serial_number = coalesce(serial_number, (select serial_number from public.custody_inventory_assets a where a.id = it.asset_id))
    where id = p_item;
  return jsonb_build_object('ok', true);
end; $$;

-- إكمال التسليم: يتحقق من الأدلة/الحالات/التوقيعين + التوفّر، يقفل الأصول (بترتيب asset_id)،
-- يخصم المتاح ويسجّل حركة rental_out، ويحوّل البنود issued والطلب active.
create or replace function public.custody_rental_complete_handover(p_request uuid, p_customer_sig text, p_staff_sig text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; it record; v_missing int;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status not in ('preparing','ready_for_handover') then raise exception 'bad_status'; end if;
  if coalesce(trim(p_customer_sig),'') = '' or coalesce(trim(p_staff_sig),'') = '' then raise exception 'signatures_required'; end if;
  -- عقد موقّع.
  if not exists (select 1 from public.custody_rental_contracts where request_id = p_request and status = 'signed') then raise exception 'contract_not_signed'; end if;
  -- كل بند: حالة قبل التسليم + دليل واحد على الأقل.
  select count(*) into v_missing from public.custody_rental_items i
   where i.request_id = p_request and (i.condition_out is null
     or not exists (select 1 from public.custody_rental_evidence e where e.item_id = i.id and e.stage = 'handover'));
  if v_missing > 0 then raise exception 'items_incomplete: %', v_missing; end if;
  -- قفل الأصول بترتيب asset_id (تفادي الجمود) + التحقق من توفّر المخزون الفعلي (لا نستدعي
  -- دالة التوفّر لأنها تحتسب حجز هذا البند نفسه فتزدوج) + خصم المتاح.
  for it in select * from public.custody_rental_items where request_id = p_request order by asset_id loop
    perform 1 from public.custody_inventory_assets where id = it.asset_id and is_deleted = false for update;
    if (select quantity_available from public.custody_inventory_assets where id = it.asset_id) < it.quantity then
      raise exception 'insufficient_stock_at_handover: %', it.asset_id;
    end if;
    update public.custody_inventory_assets set quantity_available = quantity_available - it.quantity, updated_by = auth.uid(), updated_at = now() where id = it.asset_id;
    perform public.civ_set_avail(it.asset_id);
    insert into public.custody_inventory_movements(asset_id, movement_type, quantity_before, quantity_change, quantity_after, reason, created_by, reference_type, reference_id)
      select it.asset_id, 'rental_out', a2.quantity_available + it.quantity, -it.quantity, a2.quantity_available, 'تأجير '||r.request_number, auth.uid(), 'rental', p_request
      from public.custody_inventory_assets a2 where a2.id = it.asset_id;
    update public.custody_rental_items set status = 'issued' where id = it.id;
  end loop;
  update public.custody_rental_requests set status = 'active', actual_handover_at = now(), updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, r.status, 'active', auth.uid(), 'handover complete');
  perform public.civ_notify_managers('rental_activated', p_request, 'تفعيل تأجير '||r.request_number, 'Rental activated '||r.request_number);
  return jsonb_build_object('ok', true);
end; $$;

-- ─── 9-د) الإرجاع: طلب / بدء فحص / فحص قطعة / إكمال ───
create or replace function public.custody_rental_request_return(p_request uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_is_customer boolean;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  v_is_customer := exists (select 1 from public.custody_rental_customers c where c.id = r.customer_id and c.user_id = auth.uid());
  if not (public.civ_can_manage() or v_is_customer) then raise exception 'not authorized'; end if;
  if r.status not in ('active','overdue') then raise exception 'bad_status'; end if;
  update public.custody_rental_requests set status = 'return_requested', customer_note = coalesce(nullif(trim(p_note),''), customer_note), updated_at = now() where id = p_request;
  update public.custody_rental_items set status = 'return_requested' where request_id = p_request and status = 'issued';
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, r.status, 'return_requested', auth.uid(), nullif(trim(p_note),''));
  perform public.civ_notify_managers('rental_return_requested', p_request, 'طلب إرجاع '||r.request_number, 'Return requested '||r.request_number);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.custody_rental_start_inspection(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'return_requested' then raise exception 'bad_status'; end if;
  update public.custody_rental_requests set status = 'inspection_pending', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id) values (p_request, r.status, 'inspection_pending', auth.uid());
  perform public.civ_notify_managers('rental_return_inspection_required', p_request, 'فحص إرجاع '||r.request_number, 'Return inspection '||r.request_number);
  return jsonb_build_object('ok', true);
end; $$;

-- فحص قطعة: يوجّه الأصل إلى الحالة الصحيحة (لا يعود available إلا بعد اعتماد الفحص هنا).
create or replace function public.custody_rental_inspect_item(p_item uuid, p_result text, p_condition_in text, p_returned_qty numeric, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it record; r record; v_qty numeric;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_result not in ('available','maintenance_required','damaged','missing','quarantine') then raise exception 'bad_result'; end if;
  -- قفل صف البند (FOR UPDATE) لمنع الفحص المزدوج المتزامن الذي يضاعف تعديل المخزون.
  select * into it from public.custody_rental_items where id = p_item for update;
  if it.id is null then raise exception 'not_found'; end if;
  select * into r from public.custody_rental_requests where id = it.request_id;
  if r.status <> 'inspection_pending' then raise exception 'bad_status'; end if;
  if it.status not in ('return_requested','issued') then raise exception 'item_not_returnable'; end if;
  v_qty := least(coalesce(p_returned_qty, it.quantity), it.quantity);
  perform 1 from public.custody_inventory_assets where id = it.asset_id for update;
  if p_result = 'available' then
    -- أرجع الجزء السليم للمتاح؛ الجزء غير المسترجَع (نقص) يُخصم من الإجمالي (لا يبقى معلّقًا).
    update public.custody_inventory_assets set quantity_available = quantity_available + v_qty,
      quantity_total = greatest(0, quantity_total - greatest(0, it.quantity - v_qty)), updated_by = auth.uid(), updated_at = now() where id = it.asset_id;
    update public.custody_rental_items set status = 'returned', condition_in = nullif(p_condition_in,''), returned_qty = v_qty where id = p_item;
  elsif p_result in ('maintenance_required','damaged','quarantine') then
    update public.custody_inventory_assets set quantity_in_maintenance = quantity_in_maintenance + v_qty, condition_status = case when asset_type='serialized' then 'damaged' else condition_status end, updated_by = auth.uid(), updated_at = now() where id = it.asset_id;
    update public.custody_rental_items set status = case when p_result='damaged' then 'damaged' else 'returned' end, condition_in = nullif(p_condition_in,''), returned_qty = v_qty where id = p_item;
  elsif p_result = 'missing' then
    update public.custody_inventory_assets set quantity_total = greatest(0, quantity_total - v_qty), condition_status = case when asset_type='serialized' then 'lost' else condition_status end, updated_by = auth.uid(), updated_at = now() where id = it.asset_id;
    update public.custody_rental_items set status = 'missing', returned_qty = 0 where id = p_item;
  end if;
  perform public.civ_set_avail(it.asset_id);
  insert into public.custody_inventory_movements(asset_id, movement_type, reason, created_by, reference_type, reference_id)
    values (it.asset_id, case when p_result='missing' then 'lost' else 'rental_return' end, 'إرجاع تأجير '||r.request_number||' ('||p_result||')', auth.uid(), 'rental', r.id);
  insert into public.custody_rental_inspections(contract_id, item_id, result, note, inspected_by)
    values (it.contract_id, p_item, p_result, nullif(trim(p_note),''), auth.uid());
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.custody_rental_complete_return(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_pending int;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'inspection_pending' then raise exception 'bad_status'; end if;
  select count(*) into v_pending from public.custody_rental_items where request_id = p_request and status in ('issued','return_requested');
  if v_pending > 0 then raise exception 'items_not_inspected: %', v_pending; end if;
  update public.custody_rental_requests set status = 'charges_pending', actual_return_at = now(), updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id) values (p_request, r.status, 'charges_pending', auth.uid());
  return jsonb_build_object('ok', true);
end; $$;

-- ─── 9-هـ) الرسوم/المطالبات: تسجيل (أمين عهدة) / اعتماد (مالية) ───
create or replace function public.custody_rental_add_charge(p_request uuid, p_item uuid, p_type text, p_desc text, p_estimate numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_id uuid;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_type not in ('damage','missing_item','missing_accessory','late_return','misuse','cleaning','other') then raise exception 'bad_type'; end if;
  select * into r from public.custody_rental_requests where id = p_request;
  if r.id is null then raise exception 'not_found'; end if;
  insert into public.custody_rental_charges(request_id, item_id, charge_type, description, estimate, status, reported_by)
    values (p_request, nullif(p_item::text,'')::uuid, p_type, nullif(trim(p_desc),''), greatest(0, coalesce(p_estimate,0)), 'reported', auth.uid()) returning id into v_id;
  perform public.civ_notify_managers('rental_damage_reported', p_request, 'رسم/تلف على '||r.request_number, 'Charge on '||r.request_number);
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;

create or replace function public.custody_rental_approve_charge(p_charge uuid, p_approved numeric, p_from_deposit numeric default 0, p_additional numeric default 0, p_reject boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ch record; r record; v_remaining numeric; v_apply numeric; v_approved numeric;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_finance() then raise exception 'not authorized: finance only'; end if;
  select * into ch from public.custody_rental_charges where id = p_charge for update;
  if ch.id is null then raise exception 'not_found'; end if;
  if ch.status <> 'reported' then raise exception 'already_decided'; end if;
  if p_reject then
    update public.custody_rental_charges set status = 'rejected', approved_by = auth.uid(), updated_at = now() where id = p_charge;
    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;
  -- قيِّد الخصم من الوديعة بالمتبقّي فعلًا، واحسب المستحق الإضافي = المعتمد − المخصوم (لا تسرّب إيراد).
  v_approved := greatest(0, coalesce(p_approved,0));
  select * into r from public.custody_rental_requests where id = ch.request_id for update;
  v_remaining := greatest(0, r.deposit_received - r.deposit_applied - r.deposit_released);
  v_apply := least(greatest(0, coalesce(p_from_deposit,0)), v_remaining, v_approved);
  update public.custody_rental_charges set status = 'approved', approved_amount = v_approved,
    from_deposit = v_apply, additional_due = greatest(0, v_approved - v_apply), approved_by = auth.uid(), updated_at = now() where id = p_charge;
  if v_apply > 0 then
    update public.custody_rental_requests set deposit_applied = r.deposit_applied + v_apply,
      deposit_status = case when r.deposit_status = 'held' then 'partially_applied' else r.deposit_status end, updated_at = now() where id = ch.request_id;
  end if;
  begin perform public.custody_audit('rental_charge_approved','custody_rental_charge', p_charge, jsonb_build_object('approved', p_approved)); exception when others then null; end;
  return jsonb_build_object('ok', true, 'status', 'approved');
end; $$;

-- ─── 9-و) الإغلاق / الإلغاء / التأخير ───
create or replace function public.custody_rental_close(p_request uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not (public.civ_can_manage() or public.civ_can_finance()) then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'charges_pending' then raise exception 'bad_status'; end if;
  if exists (select 1 from public.custody_rental_items where request_id = p_request and status in ('issued','return_requested')) then raise exception 'items_open'; end if;
  if exists (select 1 from public.custody_rental_charges where request_id = p_request and status = 'reported') then raise exception 'charges_open'; end if;
  if r.deposit_status not in ('not_required','released','refunded','forfeited','fully_applied') then raise exception 'deposit_unsettled'; end if;
  update public.custody_rental_requests set status = 'closed', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id) values (p_request, r.status, 'closed', auth.uid());
  perform public.civ_notify_managers('rental_closed', p_request, 'إغلاق تأجير '||r.request_number, 'Rental closed '||r.request_number);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.custody_rental_cancel(p_request uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.rental_enabled() then raise exception 'rental_disabled'; end if;
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status in ('closed','cancelled') then raise exception 'terminal'; end if;
  if r.status = 'active' or r.status = 'overdue' then raise exception 'cancel_active_forbidden'; end if;  -- النشط يُرجَع لا يُلغى
  if r.status not in ('draft','pending_approval') and not public.civ_can_admin() then raise exception 'cancel_requires_admin'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  -- حرّر الحجوزات (البنود لم تُسلَّم بعد ⇒ لا خصم متاح لإرجاعه) + أبطل العقود القائمة.
  update public.custody_rental_items set status = 'returned' where request_id = p_request and status = 'reserved';
  update public.custody_inventory_reservations set status = 'cancelled' where id in (select reservation_id from public.custody_rental_items where request_id = p_request and reservation_id is not null);
  update public.custody_rental_contracts set status = 'cancelled' where request_id = p_request and status in ('draft','signed');
  update public.custody_rental_requests set status = 'cancelled', updated_at = now() where id = p_request;
  insert into public.custody_rental_events(request_id, from_status, to_status, actor_id, reason) values (p_request, r.status, 'cancelled', auth.uid(), trim(p_reason));
  return jsonb_build_object('ok', true);
end; $$;

-- تعليم المتأخرات (يُستدعى من كرون custody_run_alerts أو يدويًا) — لا يلغي active.
create or replace function public.custody_rental_mark_overdue() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int := 0; r record;
begin
  -- يسمح لكرون الخدمة (auth.uid()=null عبر service_role) أو للمدير؛ لا يُتاح للـauthenticated العادي.
  if auth.uid() is not null and not public.civ_can_manage() then raise exception 'not authorized'; end if;
  for r in select id, request_number from public.custody_rental_requests where status = 'active' and rental_to is not null and rental_to < now() loop
    update public.custody_rental_requests set status = 'overdue', updated_at = now() where id = r.id;
    insert into public.custody_rental_events(request_id, from_status, to_status, reason) values (r.id, 'active', 'overdue', 'auto overdue');
    perform public.civ_notify_managers('rental_overdue', r.id, 'تأجير متأخر '||r.request_number, 'Rental overdue '||r.request_number);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'marked', v_n);
end; $$;

-- ─── 9-ز) القراءات: لوحة / تفاصيل / تقويم / قراءة عميل مفردة ───
create or replace function public.custody_rental_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.civ_can_manage() or public.civ_can_finance()) then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'new', (select count(*) from public.custody_rental_requests where status='draft'),
    'pending_approval', (select count(*) from public.custody_rental_requests where status='pending_approval'),
    'pending_signature', (select count(*) from public.custody_rental_requests where status='contract_pending_signature'),
    'handover_today', (select count(*) from public.custody_rental_requests where status in ('scheduled','preparing','ready_for_handover') and rental_from::date = (now() at time zone 'Asia/Riyadh')::date),
    'return_today', (select count(*) from public.custody_rental_requests where status in ('active','overdue') and rental_to::date = (now() at time zone 'Asia/Riyadh')::date),
    'active', (select count(*) from public.custody_rental_requests where status='active'),
    'overdue', (select count(*) from public.custody_rental_requests where status='overdue'),
    'open_charges', (select count(*) from public.custody_rental_charges where status='reported'),
    'deposits_held', (select count(*) from public.custody_rental_requests where deposit_status in ('held','partially_applied')),
    'deposits_release_pending', (select count(*) from public.custody_rental_requests where deposit_status='release_pending'));
end; $$;

create or replace function public.custody_rental_get(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; j jsonb;
begin
  if not (public.civ_can_manage() or public.civ_can_finance()) then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests where id = p_request;
  if r.id is null then raise exception 'not_found'; end if;
  j := to_jsonb(r) || jsonb_build_object(
    'customer', (select to_jsonb(c) from public.custody_rental_customers c where c.id = r.customer_id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'asset_id', i.asset_id, 'asset_code', a.asset_code, 'asset_name', a.asset_name,
        'quantity', i.quantity, 'status', i.status, 'condition_out', i.condition_out, 'condition_in', i.condition_in, 'rate', i.rate, 'line_total', i.line_total, 'serial_number', i.serial_number) order by a.asset_name), '[]'::jsonb)
      from public.custody_rental_items i join public.custody_inventory_assets a on a.id = i.asset_id where i.request_id = p_request),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('from', e.from_status, 'to', e.to_status, 'reason', e.reason, 'at', e.created_at) order by e.created_at desc), '[]'::jsonb) from public.custody_rental_events e where e.request_id = p_request),
    'charges', (select coalesce(jsonb_agg(to_jsonb(ch) order by ch.created_at desc), '[]'::jsonb) from public.custody_rental_charges ch where ch.request_id = p_request),
    'contract', (select to_jsonb(ct) from public.custody_rental_contracts ct where ct.request_id = p_request and ct.status = 'signed' order by ct.version desc limit 1),
    'latest_contract', (select to_jsonb(ct) from public.custody_rental_contracts ct where ct.request_id = p_request order by ct.version desc limit 1));
  return j;
end; $$;

create or replace function public.custody_rental_calendar(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', r.id, 'request_number', r.request_number, 'status', r.status, 'from', r.rental_from, 'to', r.rental_to,
    'customer', (select coalesce(company_name, full_name) from public.custody_rental_customers c where c.id = r.customer_id))
    order by r.rental_from)
    from public.custody_rental_requests r
    where r.status not in ('cancelled','rejected') and r.rental_from is not null and r.rental_to is not null
      and r.rental_from < p_to and r.rental_to > p_from), '[]'::jsonb);
end; $$;

create or replace function public.custody_rental_customer_get(p_request uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if auth.uid() is null then raise exception 'not authorized'; end if;
  select * into r from public.custody_rental_requests req join public.custody_rental_customers c on c.id = req.customer_id
    where req.id = p_request and c.user_id = auth.uid();
  if r.id is null then raise exception 'not_found'; end if;
  return jsonb_build_object(
    'id', r.id, 'request_number', r.request_number, 'status', r.status, 'rental_from', r.rental_from, 'rental_to', r.rental_to,
    'subtotal', r.subtotal, 'discount_total', r.discount_total, 'additional_total', r.additional_total, 'vat_rate', r.vat_rate, 'vat_amount', r.vat_amount, 'grand_total', r.grand_total, 'currency', r.currency,
    'deposit_amount', r.deposit_amount, 'deposit_status', r.deposit_status, 'customer_note', r.customer_note,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('asset_name', a.asset_name, 'quantity', i.quantity, 'status', i.status) order by a.asset_name), '[]'::jsonb)
      from public.custody_rental_items i join public.custody_inventory_assets a on a.id = i.asset_id where i.request_id = p_request),
    'contract', (select jsonb_build_object('id', ct.id, 'contract_number', ct.contract_number, 'status', ct.status, 'signed_at', ct.signed_at, 'contract_pdf_path', ct.contract_pdf_path, 'consent_text', ct.consent_text)
      from public.custody_rental_contracts ct where ct.request_id = p_request order by ct.version desc limit 1));
end; $$;

-- الصلاحيات للدوال الجديدة.
do $$ declare fn text; begin
  for fn in select unnest(array[
    'custody_rental_generate_contract(uuid)','custody_rental_sign_contract(uuid,text,text,text,text)',
    'custody_rental_start_handover(uuid)','custody_rental_add_handover_evidence(uuid,uuid,text,text,text)',
    'custody_rental_complete_handover(uuid,text,text)','custody_rental_request_return(uuid,text)',
    'custody_rental_start_inspection(uuid)','custody_rental_inspect_item(uuid,text,text,numeric,text)',
    'custody_rental_complete_return(uuid)','custody_rental_add_charge(uuid,uuid,text,text,numeric)',
    'custody_rental_approve_charge(uuid,numeric,numeric,numeric,boolean)','custody_rental_close(uuid)',
    'custody_rental_cancel(uuid,text)','custody_rental_mark_overdue()','custody_rental_dashboard()',
    'custody_rental_get(uuid)','custody_rental_calendar(timestamptz,timestamptz)','custody_rental_customer_get(uuid)'])
  loop
    execute format('revoke all on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 9b) ربط عميل البوابة (مدمج من rental_client_linking_HOTFIX — كي لا تعود مشكلة الربط
--     في أي تثبيت جديد). مفتاح ثابت user_id + توقيع قانوني p_profile_id + رد قانوني.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create unique index if not exists uq_rental_customer_user on public.custody_rental_customers(user_id) where user_id is not null;
drop function if exists public.custody_rental_admin_link_portal_client(uuid);
create function public.custody_rental_admin_link_portal_client(p_profile_id uuid) returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare pr record; v_id uuid; v_party text;
begin
  if not (public.civ_can_admin() or public.civ_can_manage()) then raise exception 'not authorized'; end if;
  select id, full_name, company, email, mobile, account_type, account_status into pr from public.profiles where id = p_profile_id;
  if pr.id is null then raise exception 'profile_not_found'; end if;
  if pr.account_status <> 'active' or pr.account_type not in ('client','admin') then raise exception 'invalid_account'; end if;
  v_party := case when coalesce(pr.company,'') <> '' then 'company' else 'individual' end;
  insert into public.custody_rental_customers(user_id, party_type, full_name, company_name, phone, email, created_by)
    values (p_profile_id, v_party, coalesce(nullif(trim(pr.full_name),''), pr.email, 'عميل'), nullif(trim(pr.company),''), pr.mobile, pr.email, auth.uid())
  on conflict (user_id) where user_id is not null do update set updated_at = now()
  returning id into v_id;
  return jsonb_build_object('rental_customer_id', v_id, 'profile_id', pr.id, 'full_name', pr.full_name,
    'company', pr.company, 'email', pr.email, 'mobile', pr.mobile, 'account_type', pr.account_type);
end; $$;
revoke all on function public.custody_rental_admin_link_portal_client(uuid) from public, anon;
grant execute on function public.custody_rental_admin_link_portal_client(uuid) to authenticated;
commit;

-- إعادة تحميل مخطط PostgREST.
notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 9) Validation (SELECT فقط)
-- ════════════════════════════════════════════════════════════════════════════
select 'flags' as k, rental_insurance_enabled, rental_customer_portal_enabled, rental_finance_enabled from public.custody_enterprise_settings where id=1;
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
  ('rental_enabled','rental_can_view','custody_rental_availability','custody_rental_transition',
   'custody_rental_admin_upsert_request','custody_rental_admin_add_item','custody_rental_finance_price','custody_rental_finance_deposit')
order by p.proname;
select 'new_tables' as k,
  to_regclass('public.custody_rental_events') is not null as events,
  to_regclass('public.custody_rental_charges') is not null as charges,
  to_regclass('public.custody_rental_evidence') is not null as evidence,
  to_regclass('public.custody_rental_settings') is not null as settings;
select 'buckets' as k, count(*) from storage.buckets where id in ('rental-evidence','rental-contracts','rental-private-documents');
select 'status_check_widened' as k, count(*) from pg_constraint where conname='custody_rental_requests_status_check';

-- (8) تحقق Standalone الموسّع: وجود كل الجداول الأساسية + الدوال + الأعلام + RLS + الفهارس.
-- 8-أ) الجداول الأساسية العشرة (foundation) — يجب أن تكون كلها true.
select 'foundation_tables' as k,
  to_regclass('public.custody_rental_customers')   is not null as rental_customers,
  to_regclass('public.custody_rental_requests')    is not null as rental_requests,
  to_regclass('public.custody_rental_items')       is not null as rental_items,
  to_regclass('public.custody_rental_contracts')   is not null as rental_contracts,
  to_regclass('public.custody_rental_inspections') is not null as rental_inspections,
  to_regclass('public.asset_insurance_policies')   is not null as ins_policies,
  to_regclass('public.policy_assets')              is not null as policy_assets,
  to_regclass('public.insurance_claims')           is not null as ins_claims,
  to_regclass('public.insurance_claim_evidence')   is not null as ins_claim_evidence,
  to_regclass('public.insurance_claim_actions')    is not null as ins_claim_actions;
-- 8-ب) دوال المفتاح موجودة (dashboard + availability).
select 'key_rpcs' as k,
  to_regprocedure('public.custody_rental_dashboard()') is not null as dashboard,
  to_regprocedure('public.custody_rental_availability(uuid,timestamptz,timestamptz,numeric)') is not null as availability;
-- 8-ج) عدد دوال التأجير/التأمين (يشمل الأساس + V1 التشغيلي — المتوقّع 30).
select 'rental_rpc_count' as k, count(*) as n
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and (p.proname like 'custody_rental\_%' or p.proname like 'rental\_%' or p.proname like 'custody_insurance\_%');
-- 8-د) private buckets ليست عامة.
select 'private_buckets' as k, id, public from storage.buckets
where id in ('rental-evidence','rental-contracts','rental-private-documents') order by id;
-- 8-هـ) RLS مفعّل على كل جداول التأجير/التأمين + الجداول الجديدة.
select 'rls_enabled' as k, c.relname, c.relrowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in (
  'custody_rental_customers','custody_rental_requests','custody_rental_items','custody_rental_contracts',
  'custody_rental_inspections','custody_rental_events','custody_rental_charges','custody_rental_evidence',
  'custody_rental_settings','asset_insurance_policies','policy_assets','insurance_claims',
  'insurance_claim_evidence','insurance_claim_actions')
order by c.relname;
-- 8-و) القيود والفهارس الحرجة (status check موسّع + حركة rental_* + فهارس التأجير).
select 'critical_constraints' as k,
  (select count(*) from pg_constraint where conname='custody_rental_requests_status_check') as status_check,
  (select count(*) from pg_constraint where conname='custody_inventory_movements_movement_type_check') as movement_check,
  (select count(*) from pg_constraint where conname='notifications_type_check') as notif_check,
  (select count(*) from pg_indexes where schemaname='public' and indexname in
     ('idx_rental_req_status','idx_rental_req_window','idx_rental_items_asset','idx_rental_items_request',
      'idx_rental_events_req','idx_rental_charges_req','idx_rental_evidence_req',
      'idx_civ_rental_req_customer','idx_civ_rental_items_contract')) as rental_indexes;
-- 8-ز) الأعلام (كلها false افتراضيًا — لا تُفعّل على Production قبل اختبار Preview).
select 'flags_full' as k, rental_insurance_enabled, rental_customer_portal_enabled, rental_whatsapp_enabled, rental_finance_enabled
from public.custody_enterprise_settings where id=1;
