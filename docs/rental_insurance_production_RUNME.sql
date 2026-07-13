-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Rental & Insurance Portal V1 — FOUNDATION (data + logic + security)
-- ملف إنتاج واحد idempotent. يوسّع جداول custody_enterprise_05 (لا ينشئ نظامًا موازيًا).
-- يعيد استخدام: custody_inventory_assets (المعدات)، civ_can_manage/civ_can_finance،
--   civ_gen_no، civ_notify_managers، custody_audit، civ_flag، نمط FOR UPDATE.
-- لا hard delete. لا يلمس: العهدة/الأصول، HR، Zoho، الفواتير، العروض، العهدة/التأجير القديم.
-- شغّل بعد أن تكون قاعدة custody_inventory v1 + enterprise_00 (flags) + enterprise_05
--   (جداول التأجير) مطبّقة. آمن للتكرار. Validation في النهاية.
-- ملاحظة النطاق: هذا هو أساس V1 (المخطط + المنطق + الأمان). واجهات الإدارة/المستأجر
--   وتدفقات التسليم/الإرجاع تُبنى فوق هذا الأساس بعد التحقق.
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
  -- يُحتسب البند حاجزًا للسعة على أي طلب غير منتهٍ (يشمل draft/pending كي لا يزدوج الحجز
  -- قبل الاعتماد)؛ يُستثنى فقط cancelled/rejected/closed.
  select coalesce(sum(i.quantity),0) into v_rent
    from public.custody_rental_items i
    join public.custody_rental_requests r on r.id = i.request_id
   where i.asset_id = p_asset
     and i.status in ('reserved','issued','return_requested')
     and r.status not in ('cancelled','rejected','closed')
     and r.rental_from is not null and r.rental_to is not null
     and r.rental_from < p_to and r.rental_to > p_from;
  -- محجوز العهدة الداخلية المتداخل زمنيًا.
  select coalesce(sum(res.quantity),0) into v_res
    from public.custody_inventory_reservations res
   where res.asset_id = p_asset and res.status = 'active'
     and coalesce(res.reserved_from, p_from) < p_to and coalesce(res.reserved_to, p_to) > p_from;
  -- المصروف كعهدة + الصيانة (نقطة زمنية — تحفّظًا).
  v_committed := v_rent + v_res + (a.quantity_total - a.quantity_available - a.quantity_in_maintenance) + a.quantity_in_maintenance;
  v_free := a.quantity_total - v_committed;
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
