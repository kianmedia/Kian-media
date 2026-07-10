-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — Custody Inventory System v1  (نظام مخزون الأصول والعهد المسجلة)
-- ملف مستقل تمامًا. شغّله مرة واحدة في Supabase SQL Editor (idempotent قدر الإمكان).
--
-- نظام منفصل كليًا عن نظام العهدة اليدوية القديم (custody_records/…): جداول جديدة
-- بادئتها custody_inventory_*، دوال بادئتها custody_inv_*، bucketان جديدان خاصّان.
-- لا يلمس: custody_records/items/photos/events/renter_profiles، ولا HR، ولا Zoho،
-- ولا الفوترة/العروض/الفرص، ولا Apps Script/WhatsApp/n8n. لا يعدّل أي SQL قديم.
--
-- الأمان: كل الكتابة عبر RPCs (SECURITY DEFINER, set search_path=public) بأقفال صفوف
-- تمنع الصرف المزدوج والكميات السالبة. RLS محكم: الموظف يرى عهده فقط، أمين العهدة/
-- الأدمن/المالك يرون الكل، العميل ممنوع. الصور في bucketين خاصّين (signed URL فقط).
-- لا hard delete — كل حذف soft delete بسبب إلزامي. سجل الحركات غير قابل للتعديل.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 0) صلاحيات النظام (تُبنى على الأدوار القائمة دون كسر قيد staff_role) ───
-- أمين العهدة = staff_role 'custody_officer' (الموجود فعلًا). المدير/المالك/الأدمن أعلى.
-- civ_can_manage(): طبقة التشغيل (مالك/أدمن/سوبر/مدير/أمين عهدة) — إضافة/صرف/فحص/صيانة/جرد.
-- civ_can_admin():  طبقة الإدارة العليا (مالك/سوبر/أدمن) — الإعدادات والاعتمادات الحساسة.
-- civ_is_employee(): أي موظف (is_staff) — يرى عهده فقط.
create or replace function public.civ_can_manage() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() in ('manager','custody_officer');
$$;
create or replace function public.civ_can_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner();
$$;
create or replace function public.civ_is_employee() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_staff();
$$;
revoke execute on function public.civ_can_manage()  from public, anon;
revoke execute on function public.civ_can_admin()   from public, anon;
revoke execute on function public.civ_is_employee() from public, anon;
grant  execute on function public.civ_can_manage()  to authenticated;
grant  execute on function public.civ_can_admin()   to authenticated;
grant  execute on function public.civ_is_employee() to authenticated;

-- IP للأدلة (لا يرمي أبدًا) — على غرار hr_client_ip.
create or replace function public.civ_client_ip() returns text
language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  v := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ''), ',', 1);
  return nullif(trim(v), '');
exception when others then return null;
end; $$;

-- ─── 1) الإعدادات (تشمل مفتاح إظهار/إخفاء العهدة اليدوية للموظف) ───
-- جدول مستقل حتى لا نلمس hr_settings/hr_get_settings (SQL قديم). سطر واحد id=1.
create table if not exists public.custody_inventory_settings (
  id                              int primary key default 1 check (id = 1),
  legacy_custody_employee_visible boolean not null default true,   -- true = العهدة اليدوية ظاهرة للموظف (سلوك قديم)
  show_purchase_value_to_employee boolean not null default false,  -- إخفاء قيمة الشراء عن الموظف افتراضيًا
  updated_by                      uuid references auth.users(id),
  updated_at                      timestamptz not null default now()
);
insert into public.custody_inventory_settings (id) values (1) on conflict (id) do nothing;
alter table public.custody_inventory_settings enable row level security;
-- لا سياسات قراءة على الجدول — القراءة عبر RPC فقط.

-- ─── 2) التصنيفات ───
create table if not exists public.custody_inventory_categories (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  sort_order   int not null default 0,
  is_deleted   boolean not null default false,
  deleted_at   timestamptz,
  deleted_by   uuid references auth.users(id),
  delete_reason text,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_civ_categories_live on public.custody_inventory_categories(sort_order) where is_deleted = false;

-- ─── 3) المواقع/المستودعات ───
create table if not exists public.custody_inventory_locations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  location_type      text not null default 'warehouse'
                     check (location_type in ('warehouse','studio','office','vehicle','external_site','maintenance_center','other')),
  city               text,
  address            text,
  responsible_user_id uuid references auth.users(id),
  notes              text,
  is_active          boolean not null default true,
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users(id),
  delete_reason      text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_civ_locations_live on public.custody_inventory_locations(is_active) where is_deleted = false;

-- ─── 4) الأصول ───
create table if not exists public.custody_inventory_assets (
  id                   uuid primary key default gen_random_uuid(),
  asset_code           text not null unique,
  barcode              text unique,
  qr_code_value        text unique,
  asset_name           text not null,
  category_id          uuid references public.custody_inventory_categories(id),
  brand                text,
  model                text,
  serial_number        text,
  description          text,
  ownership_type       text not null default 'owned'
                       check (ownership_type in ('owned','leased','client_owned','other')),
  asset_type           text not null default 'serialized'
                       check (asset_type in ('serialized','quantity_based')),
  quantity_total       numeric not null default 1 check (quantity_total >= 0),
  quantity_available   numeric not null default 1 check (quantity_available >= 0),
  quantity_in_maintenance numeric not null default 0 check (quantity_in_maintenance >= 0),
  unit                 text not null default 'قطعة',
  purchase_date        date,
  purchase_price       numeric check (purchase_price is null or purchase_price >= 0),
  current_value        numeric check (current_value is null or current_value >= 0),
  supplier_name        text,
  invoice_number       text,
  warranty_expiry_date date,
  condition_status     text not null default 'good'
                       check (condition_status in ('new','excellent','good','fair','damaged','under_maintenance','lost','retired')),
  availability_status  text not null default 'available'
                       check (availability_status in ('available','partially_assigned','assigned','reserved','maintenance','lost','retired')),
  warehouse_location_id uuid references public.custody_inventory_locations(id),
  storage_location_text text,
  notes                text,
  minimum_stock_level  numeric,
  created_by           uuid references auth.users(id),
  updated_by           uuid references auth.users(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  is_deleted           boolean not null default false,
  deleted_at           timestamptz,
  deleted_by           uuid references auth.users(id),
  delete_reason        text,
  -- ثبات المخزون: المتاح لا يتجاوز الإجمالي ولا يقلّ عن صفر (CHECK أعلاه + هذا).
  constraint civ_asset_qty_bound check (quantity_available <= quantity_total),
  -- الأصل المتسلسل كميته الإجمالية 1.
  constraint civ_asset_serialized_qty check (asset_type <> 'serialized' or quantity_total = 1)
);
create index if not exists idx_civ_assets_live      on public.custody_inventory_assets(availability_status) where is_deleted = false;
create index if not exists idx_civ_assets_category   on public.custody_inventory_assets(category_id) where is_deleted = false;
create index if not exists idx_civ_assets_location   on public.custody_inventory_assets(warehouse_location_id) where is_deleted = false;
create index if not exists idx_civ_assets_code_lower on public.custody_inventory_assets(lower(asset_code));

-- ─── 5) صور/وثائق الأصل ───
create table if not exists public.custody_inventory_asset_files (
  id          uuid primary key default gen_random_uuid(),
  asset_id    uuid not null references public.custody_inventory_assets(id) on delete cascade,
  file_type   text not null default 'asset_photo'
              check (file_type in ('asset_photo','invoice','warranty','purchase_document','manual','maintenance_report','other')),
  file_path   text not null,
  file_name   text,
  mime_type   text,
  size_bytes  bigint,
  description text,
  uploaded_by uuid references auth.users(id),
  created_at  timestamptz not null default now(),
  is_deleted  boolean not null default false,
  deleted_at  timestamptz,
  deleted_by  uuid references auth.users(id),
  delete_reason text
);
create index if not exists idx_civ_asset_files on public.custody_inventory_asset_files(asset_id) where is_deleted = false;

-- ─── 6) رأس العهدة ───
create table if not exists public.custody_inventory_assignments (
  id                    uuid primary key default gen_random_uuid(),
  assignment_number     text not null unique,
  employee_id           uuid,                                   -- hr_employee_profiles.id إن توفّر (اختياري)
  employee_user_id      uuid not null references auth.users(id),
  assignment_type       text not null default 'permanent'
                        check (assignment_type in ('permanent','temporary','project','field_task','replacement')),
  project_id            uuid,
  field_task_id         uuid,
  purpose               text,
  expected_return_at    timestamptz,
  issued_by             uuid references auth.users(id),
  issued_at             timestamptz not null default now(),
  employee_confirmed_at timestamptz,
  ack_snapshot          text,                                   -- نص الإقرار وقت الاستلام (snapshot)
  ack_name              text,
  ack_ip                text,
  status                text not null default 'pending_employee_confirmation'
                        check (status in ('draft','pending_employee_confirmation','active','return_requested','under_inspection','partially_returned','returned','rejected','disputed','cancelled')),
  employee_note         text,
  custodian_note        text,
  admin_note_internal   text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  is_deleted            boolean not null default false,
  deleted_at            timestamptz,
  deleted_by            uuid references auth.users(id),
  delete_reason         text
);
create index if not exists idx_civ_assign_emp    on public.custody_inventory_assignments(employee_user_id) where is_deleted = false;
create index if not exists idx_civ_assign_status on public.custody_inventory_assignments(status) where is_deleted = false;

-- ─── 7) تفاصيل العهدة (البنود) ───
create table if not exists public.custody_inventory_assignment_items (
  id                 uuid primary key default gen_random_uuid(),
  assignment_id      uuid not null references public.custody_inventory_assignments(id) on delete cascade,
  asset_id           uuid not null references public.custody_inventory_assets(id),
  quantity           numeric not null default 1 check (quantity > 0),
  quantity_returned  numeric not null default 0 check (quantity_returned >= 0),
  condition_at_issue text,
  issue_notes        text,
  condition_at_return text,
  return_notes       text,
  issued_at          timestamptz not null default now(),
  returned_at        timestamptz,
  status             text not null default 'pending'
                     check (status in ('pending','active','return_requested','inspected','returned','damaged','missing','disputed')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint civ_item_returned_bound check (quantity_returned <= quantity)
);
create index if not exists idx_civ_items_assign on public.custody_inventory_assignment_items(assignment_id);
create index if not exists idx_civ_items_asset  on public.custody_inventory_assignment_items(asset_id);
-- منع الصرف المزدوج للأصل المتسلسل: بند نشط واحد كحدّ أقصى لكل asset متسلسل.
-- (يُفرض أيضًا داخل RPC تحت قفل الصف؛ هذا الفهرس حاجز إضافي على مستوى القاعدة.)
create unique index if not exists uq_civ_serialized_active_item
  on public.custody_inventory_assignment_items(asset_id)
  where status in ('pending','active','return_requested','disputed');

-- ─── 8) أدلة الصور (استلام/إرجاع/فحص/تلف/صيانة) ───
create table if not exists public.custody_inventory_evidence (
  id                 uuid primary key default gen_random_uuid(),
  assignment_id      uuid references public.custody_inventory_assignments(id) on delete cascade,
  assignment_item_id uuid references public.custody_inventory_assignment_items(id) on delete cascade,
  asset_id           uuid references public.custody_inventory_assets(id),
  evidence_stage     text not null
                     check (evidence_stage in ('issue_admin','issue_employee','return_employee','return_inspection','damage','maintenance')),
  file_path          text not null,
  file_name          text,
  mime_type          text,
  size_bytes         bigint,
  note               text,
  uploaded_by        uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  is_deleted         boolean not null default false,
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users(id),
  delete_reason      text
);
create index if not exists idx_civ_evidence_assign on public.custody_inventory_evidence(assignment_id) where is_deleted = false;
create index if not exists idx_civ_evidence_item   on public.custody_inventory_evidence(assignment_item_id) where is_deleted = false;

-- ─── 9) سجل حركات المخزون (غير قابل للحذف/التعديل — تصحيح بحركة جديدة فقط) ───
create table if not exists public.custody_inventory_movements (
  id                 uuid primary key default gen_random_uuid(),
  asset_id           uuid not null references public.custody_inventory_assets(id),
  assignment_id      uuid references public.custody_inventory_assignments(id),
  assignment_item_id uuid references public.custody_inventory_assignment_items(id),
  movement_type      text not null
                     check (movement_type in ('initial_stock','stock_adjustment','issue_to_employee','employee_confirmed',
                       'return_requested','return_to_stock','partial_return','transfer_location','transfer_to_maintenance',
                       'return_from_maintenance','damaged','lost','retired','cancelled_issue','manual_correction')),
  quantity_before    numeric,
  quantity_change    numeric,
  quantity_after     numeric,
  from_location_id   uuid references public.custody_inventory_locations(id),
  to_location_id     uuid references public.custody_inventory_locations(id),
  from_employee_id   uuid,
  to_employee_id     uuid,
  condition_before   text,
  condition_after    text,
  reference_type     text,
  reference_id       uuid,
  reason             text,
  created_by         uuid references auth.users(id),
  created_at         timestamptz not null default now()
);
create index if not exists idx_civ_movements_asset  on public.custody_inventory_movements(asset_id, created_at desc);
create index if not exists idx_civ_movements_assign on public.custody_inventory_movements(assignment_id);

-- ─── 10) الصيانة ───
create table if not exists public.custody_inventory_maintenance (
  id                 uuid primary key default gen_random_uuid(),
  maintenance_number text not null unique,
  asset_id           uuid not null references public.custody_inventory_assets(id),
  assignment_id      uuid references public.custody_inventory_assignments(id),
  quantity           numeric not null default 1 check (quantity > 0),   -- عدد الوحدات في هذه الصيانة (للأصناف الكمية)
  maintenance_type   text not null default 'repair'
                     check (maintenance_type in ('preventive','repair','inspection','calibration','other')),
  issue_description  text,
  provider_name      text,
  sent_at            timestamptz,
  expected_return_at timestamptz,
  returned_at        timestamptz,
  cost               numeric check (cost is null or cost >= 0),
  status             text not null default 'opened'
                     check (status in ('opened','sent','in_progress','completed','cancelled')),
  result_note        text,
  created_by         uuid references auth.users(id),
  closed_by          uuid references auth.users(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_civ_maint_asset on public.custody_inventory_maintenance(asset_id);
create index if not exists idx_civ_maint_status on public.custody_inventory_maintenance(status);

-- ─── 11) الحجوزات ───
create table if not exists public.custody_inventory_reservations (
  id            uuid primary key default gen_random_uuid(),
  asset_id      uuid not null references public.custody_inventory_assets(id),
  quantity      numeric not null default 1 check (quantity > 0),
  employee_id   uuid,
  project_id    uuid,
  field_task_id uuid,
  reserved_from timestamptz,
  reserved_to   timestamptz,
  status        text not null default 'active'
                check (status in ('active','fulfilled','cancelled','expired')),
  note          text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_civ_reservations_asset on public.custody_inventory_reservations(asset_id, status);

-- ─── 12) الجرد ───
create table if not exists public.custody_inventory_audits (
  id           uuid primary key default gen_random_uuid(),
  audit_number text not null unique,
  location_id  uuid references public.custody_inventory_locations(id),
  status       text not null default 'draft'
               check (status in ('draft','in_progress','completed','approved','cancelled')),
  started_by   uuid references auth.users(id),
  started_at   timestamptz,
  completed_at timestamptz,
  approved_by  uuid references auth.users(id),
  approved_at  timestamptz,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create table if not exists public.custody_inventory_audit_items (
  id                uuid primary key default gen_random_uuid(),
  audit_id          uuid not null references public.custody_inventory_audits(id) on delete cascade,
  asset_id          uuid not null references public.custody_inventory_assets(id),
  expected_quantity numeric,
  counted_quantity  numeric,
  variance          numeric,
  expected_location uuid references public.custody_inventory_locations(id),
  actual_location   uuid references public.custody_inventory_locations(id),
  condition_found   text,
  scanned_at        timestamptz,
  counted_by        uuid references auth.users(id),
  note              text,
  created_at        timestamptz not null default now(),
  constraint uq_civ_audit_item unique (audit_id, asset_id)
);
create index if not exists idx_civ_audit_items on public.custody_inventory_audit_items(audit_id);

-- idempotency: أعمدة أُضيفت في v1 — تضمن إعادة التشغيل على قاعدة أنشأت الجداول سابقًا.
alter table public.custody_inventory_assets add column if not exists quantity_in_maintenance numeric not null default 0;
alter table public.custody_inventory_maintenance add column if not exists quantity numeric not null default 1;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 13) الإشعارات — توسيع CHECK إلى السوبرست الكامل (40 نوعًا قائمًا) + أنواع النظام
-- الجديد civ_*. القاعدة: أي هجرة توسّع NOTIFICATIONS_TYPE_CHECK تعيد إعلان القائمة
-- كاملة. القائمة الأربعون أدناه هي أوسع نسخة منشورة (portal_hr_employee_portal_RUNME).
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  -- base(9)
  'quote_request_new','message_new','file_link_new','project_note_new','deliverable_new',
  'revision_requested','deliverable_approved','deliverable_final_delivered','project_status_changed',
  -- added(4)
  'opportunity_new','whatsapp_new','project_brief_new','portal_request_new',
  -- quote/invoice(7)
  'quote_sent','quote_accepted','quote_revision_requested','invoice_visible',
  'invoice_approval_required','invoice_created','invoice_creation_failed',
  -- custody legacy(10)
  'custody_checkout_new','rental_request_new','custody_return_submitted','custody_return_shortage',
  'custody_handover_approved','custody_closed','custody_rejected','custody_note_new',
  'custody_claim_pending','custody_claim_acknowledged',
  -- hr(10)
  'hr_check_in','hr_check_out','hr_leave_new','hr_leave_decided','hr_task_new',
  'hr_task_started','hr_task_submitted','hr_task_closed','hr_attendance_adjusted','hr_note_new',
  -- custody inventory v1 (new)
  'civ_asset_created','civ_asset_updated','civ_assignment_created','civ_confirm_pending',
  'civ_employee_confirmed','civ_employee_rejected','civ_return_requested','civ_return_accepted',
  'civ_return_rejected','civ_return_inspected','civ_damage_reported','civ_lost_reported','civ_maintenance_opened',
  'civ_maintenance_closed','civ_audit_started','civ_audit_approved','civ_audit_variance',
  'civ_stock_correction','civ_reservation_created','civ_custodian_changed',
  'civ_legacy_visibility_changed','civ_return_overdue','civ_warranty_expiring'
));

-- إشعار بوابة لمستخدم واحد (entity_type='custody_inventory'). آمن الفشل: لا يُفشِل الحركة.
create or replace function public.civ_notify(p_recipient uuid, p_type text, p_entity uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_recipient is null then return; end if;
  perform public.notify(p_recipient, 'user', p_type, 'custody_inventory', p_entity, p_ar, p_en);
exception when others then return;  -- الإشعار best-effort — لا يكسر حركة المخزون/العهدة
end; $$;

-- فان-آوت لطبقة الإدارة/أمناء العهدة (صفوف شخصية لكل مدير).
create or replace function public.civ_notify_managers(p_type text, p_entity uuid, p_ar text, p_en text)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select id from public.profiles
     where account_status = 'active'
       and (account_type = 'admin' or staff_role in ('super_admin','manager','custody_officer'))
  loop
    perform public.civ_notify(r.id, p_type, p_entity, p_ar, p_en);
  end loop;
exception when others then return;
end; $$;

revoke execute on function public.civ_notify(uuid,text,uuid,text,text) from public, anon, authenticated;
revoke execute on function public.civ_notify_managers(text,uuid,text,text) from public, anon, authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 14) دوال مساعدة داخلية + الإعدادات + التصنيفات + المواقع + الأصول
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- إعادة حساب حالة الإتاحة من الكمية/الحالة. الأولوية للكمية المتاحة: أي وحدة متاحة
-- تعني قابلية الصرف حتى لو كانت وحدات أخرى في الصيانة (مهم للأصناف الكمية).
create or replace function public.civ_set_avail(p_asset uuid) returns void
language sql security definer set search_path = public as $$
  update public.custody_inventory_assets set availability_status = case
      when condition_status = 'retired' then 'retired'
      when condition_status = 'lost' then 'lost'
      when quantity_available > 0 and quantity_available < quantity_total then 'partially_assigned'
      when quantity_available > 0 then 'available'
      when quantity_in_maintenance >= quantity_total then 'maintenance'   -- كل الوحدات في الصيانة
      when condition_status = 'under_maintenance' then 'maintenance'
      else 'assigned' end,                                                 -- 0 متاح والباقي على عهدة
    updated_at = now()
  where id = p_asset;
$$;
revoke execute on function public.civ_set_avail(uuid) from public, anon, authenticated;

-- رقم فريد بادئة معطاة، بلا تسلسل: PFX-YYMMDD-XXXXX.
create or replace function public.civ_gen_no(p_prefix text) returns text
language sql volatile set search_path = public as $$
  -- 8 محارف hex (~32 بت) — احتمال تصادم مهمل حتى مع استيراد مجمّع في اليوم نفسه.
  select p_prefix || '-' || to_char(now(),'YYMMDD') || '-' || upper(substr(md5(gen_random_uuid()::text),1,8));
$$;

-- ─── الإعدادات ───
create or replace function public.custody_inv_get_settings() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if not public.civ_is_employee() then raise exception 'staff only'; end if;
  select * into r from public.custody_inventory_settings where id = 1;
  return jsonb_build_object(
    'legacy_custody_employee_visible', coalesce(r.legacy_custody_employee_visible, true),
    'show_purchase_value_to_employee', coalesce(r.show_purchase_value_to_employee, false)
  );
end; $$;

create or replace function public.custody_inv_admin_update_settings(p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare k text; v_prev boolean;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;  -- مالك/سوبر/أدمن فقط
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'patch_required'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('legacy_custody_employee_visible','show_purchase_value_to_employee')
      then raise exception 'invalid_setting_key: %', k; end if;
  end loop;
  select legacy_custody_employee_visible into v_prev from public.custody_inventory_settings where id = 1;
  update public.custody_inventory_settings set
    legacy_custody_employee_visible = case when p_patch ? 'legacy_custody_employee_visible'
      then coalesce((p_patch->>'legacy_custody_employee_visible')::boolean, legacy_custody_employee_visible) else legacy_custody_employee_visible end,
    show_purchase_value_to_employee = case when p_patch ? 'show_purchase_value_to_employee'
      then coalesce((p_patch->>'show_purchase_value_to_employee')::boolean, show_purchase_value_to_employee) else show_purchase_value_to_employee end,
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
  if p_patch ? 'legacy_custody_employee_visible' then
    perform public.log_activity(auth.uid(), 'admin', 'legacy_custody_visibility_updated', 'custody_inventory', null,
      jsonb_build_object('to', p_patch->>'legacy_custody_employee_visible'));
    perform public.civ_notify_managers('civ_legacy_visibility_changed', null,
      'تغيير إظهار العهدة اليدوية للموظفين: ' || (p_patch->>'legacy_custody_employee_visible'),
      'Legacy custody visibility changed: ' || (p_patch->>'legacy_custody_employee_visible'));
  end if;
  return public.custody_inv_get_settings();
end; $$;

-- ─── التصنيفات ───
create or replace function public.custody_inv_admin_upsert_category(p_id uuid, p_name text, p_sort int)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'name_required'; end if;
  if p_id is null then
    insert into public.custody_inventory_categories(name, sort_order, created_by)
      values (trim(p_name), coalesce(p_sort,0), auth.uid()) returning id into v_id;
  else
    update public.custody_inventory_categories
      set name = trim(p_name), sort_order = coalesce(p_sort, sort_order), updated_at = now()
      where id = p_id and is_deleted = false returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.custody_inv_admin_archive_category(p_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  if exists (select 1 from public.custody_inventory_assets where category_id = p_id and is_deleted = false)
    then raise exception 'category_in_use'; end if;
  update public.custody_inventory_categories
    set is_deleted = true, deleted_at = now(), deleted_by = auth.uid(), delete_reason = trim(p_reason)
    where id = p_id and is_deleted = false;
  return true;
end; $$;

-- ─── المواقع ───
create or replace function public.custody_inv_admin_upsert_location(
  p_id uuid, p_name text, p_type text, p_city text, p_address text, p_responsible uuid, p_notes text, p_active boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'name_required'; end if;
  if p_id is null then
    insert into public.custody_inventory_locations(name, location_type, city, address, responsible_user_id, notes, is_active, created_by)
      values (trim(p_name), coalesce(nullif(p_type,''),'warehouse'), p_city, p_address, p_responsible, p_notes, coalesce(p_active,true), auth.uid())
      returning id into v_id;
  else
    update public.custody_inventory_locations set
      name = trim(p_name), location_type = coalesce(nullif(p_type,''), location_type), city = p_city,
      address = p_address, responsible_user_id = p_responsible, notes = p_notes, is_active = coalesce(p_active, is_active), updated_at = now()
      where id = p_id and is_deleted = false returning id into v_id;
    if v_id is null then raise exception 'not_found'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.custody_inv_admin_archive_location(p_id uuid, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  if exists (select 1 from public.custody_inventory_assets where warehouse_location_id = p_id and is_deleted = false)
    then raise exception 'location_in_use'; end if;
  update public.custody_inventory_locations
    set is_deleted = true, is_active = false, deleted_at = now(), deleted_by = auth.uid(), delete_reason = trim(p_reason)
    where id = p_id and is_deleted = false;
  return true;
end; $$;

-- ─── الأصول ───
-- إنشاء أصل: يولّد كودًا إن لم يُعطَ، يضبط الكميات حسب النوع، ويسجّل حركة المخزون الأولية.
create or replace function public.custody_inv_admin_create_asset(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code text; v_type text; v_qty numeric; v_loc uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_data->>'asset_name'),'') = '' then raise exception 'name_required'; end if;
  v_type := coalesce(nullif(p_data->>'asset_type',''),'serialized');
  v_qty  := coalesce((p_data->>'quantity_total')::numeric, 1);
  if v_type = 'serialized' then v_qty := 1; end if;
  if v_qty < 0 then raise exception 'negative_quantity'; end if;
  v_code := coalesce(nullif(trim(p_data->>'asset_code'),''), public.civ_gen_no('KIAN'));
  v_loc  := nullif(p_data->>'warehouse_location_id','')::uuid;
  insert into public.custody_inventory_assets(
    asset_code, barcode, qr_code_value, asset_name, category_id, brand, model, serial_number, description,
    ownership_type, asset_type, quantity_total, quantity_available, unit, purchase_date, purchase_price, current_value,
    supplier_name, invoice_number, warranty_expiry_date, condition_status, warehouse_location_id, storage_location_text,
    notes, minimum_stock_level, created_by, updated_by
  ) values (
    v_code, nullif(trim(p_data->>'barcode'),''), coalesce(nullif(trim(p_data->>'qr_code_value'),''), v_code),
    trim(p_data->>'asset_name'), nullif(p_data->>'category_id','')::uuid, nullif(trim(p_data->>'brand'),''),
    nullif(trim(p_data->>'model'),''), nullif(trim(p_data->>'serial_number'),''), nullif(trim(p_data->>'description'),''),
    coalesce(nullif(p_data->>'ownership_type',''),'owned'), v_type, v_qty, v_qty,
    coalesce(nullif(p_data->>'unit',''),'قطعة'), nullif(p_data->>'purchase_date','')::date,
    nullif(p_data->>'purchase_price','')::numeric, nullif(p_data->>'current_value','')::numeric,
    nullif(trim(p_data->>'supplier_name'),''), nullif(trim(p_data->>'invoice_number'),''),
    nullif(p_data->>'warranty_expiry_date','')::date, coalesce(nullif(p_data->>'condition_status',''),'good'),
    v_loc, nullif(trim(p_data->>'storage_location_text'),''), nullif(trim(p_data->>'notes'),''),
    nullif(p_data->>'minimum_stock_level','')::numeric, auth.uid(), auth.uid()
  ) returning id into v_id;
  perform public.civ_set_avail(v_id);
  insert into public.custody_inventory_movements(asset_id, movement_type, quantity_before, quantity_change, quantity_after, to_location_id, reason, created_by)
    values (v_id, 'initial_stock', 0, v_qty, v_qty, v_loc, 'إضافة أصل للمخزون', auth.uid());
  perform public.civ_notify_managers('civ_asset_created', v_id, 'أصل جديد في المخزون: ' || trim(p_data->>'asset_name'), 'New asset: ' || trim(p_data->>'asset_name'));
  return jsonb_build_object('ok', true, 'id', v_id, 'asset_code', v_code);
end; $$;

-- تحديث بيانات أصل (لا يغيّر الكميات — الكمية عبر adjust_stock فقط).
create or replace function public.custody_inv_admin_update_asset(p_id uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_inventory_assets set
    asset_name = coalesce(nullif(trim(p_data->>'asset_name'),''), asset_name),
    barcode = case when p_data ? 'barcode' then nullif(trim(p_data->>'barcode'),'') else barcode end,
    qr_code_value = case when p_data ? 'qr_code_value' then nullif(trim(p_data->>'qr_code_value'),'') else qr_code_value end,
    category_id = case when p_data ? 'category_id' then nullif(p_data->>'category_id','')::uuid else category_id end,
    brand = case when p_data ? 'brand' then nullif(trim(p_data->>'brand'),'') else brand end,
    model = case when p_data ? 'model' then nullif(trim(p_data->>'model'),'') else model end,
    serial_number = case when p_data ? 'serial_number' then nullif(trim(p_data->>'serial_number'),'') else serial_number end,
    description = case when p_data ? 'description' then nullif(trim(p_data->>'description'),'') else description end,
    ownership_type = coalesce(nullif(p_data->>'ownership_type',''), ownership_type),
    unit = coalesce(nullif(p_data->>'unit',''), unit),
    purchase_date = case when p_data ? 'purchase_date' then nullif(p_data->>'purchase_date','')::date else purchase_date end,
    purchase_price = case when p_data ? 'purchase_price' then nullif(p_data->>'purchase_price','')::numeric else purchase_price end,
    current_value = case when p_data ? 'current_value' then nullif(p_data->>'current_value','')::numeric else current_value end,
    supplier_name = case when p_data ? 'supplier_name' then nullif(trim(p_data->>'supplier_name'),'') else supplier_name end,
    invoice_number = case when p_data ? 'invoice_number' then nullif(trim(p_data->>'invoice_number'),'') else invoice_number end,
    warranty_expiry_date = case when p_data ? 'warranty_expiry_date' then nullif(p_data->>'warranty_expiry_date','')::date else warranty_expiry_date end,
    condition_status = coalesce(nullif(p_data->>'condition_status',''), condition_status),
    warehouse_location_id = case when p_data ? 'warehouse_location_id' then nullif(p_data->>'warehouse_location_id','')::uuid else warehouse_location_id end,
    storage_location_text = case when p_data ? 'storage_location_text' then nullif(trim(p_data->>'storage_location_text'),'') else storage_location_text end,
    notes = case when p_data ? 'notes' then nullif(trim(p_data->>'notes'),'') else notes end,
    minimum_stock_level = case when p_data ? 'minimum_stock_level' then nullif(p_data->>'minimum_stock_level','')::numeric else minimum_stock_level end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_id and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  perform public.civ_set_avail(p_id);
  return true;
end; $$;

-- أرشفة أصل (soft delete) — تُمنع إن كان على عهدة نشطة.
create or replace function public.custody_inv_admin_archive_asset(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  if exists (select 1 from public.custody_inventory_assignment_items i
              join public.custody_inventory_assignments a on a.id = i.assignment_id
             where i.asset_id = p_id and i.status in ('pending','active','return_requested','disputed') and a.is_deleted = false)
    then raise exception 'asset_on_active_custody'; end if;
  update public.custody_inventory_assets
    set is_deleted = true, availability_status = 'retired', deleted_at = now(), deleted_by = auth.uid(), delete_reason = trim(p_reason)
    where id = p_id and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  return true;
end; $$;

-- ربط ملف/صورة أصل (بعد رفع المسار إلى Storage).
create or replace function public.custody_inv_attach_asset_file(
  p_asset uuid, p_type text, p_path text, p_name text, p_mime text, p_size bigint, p_desc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_path),'') = '' then raise exception 'path_required'; end if;
  insert into public.custody_inventory_asset_files(asset_id, file_type, file_path, file_name, mime_type, size_bytes, description, uploaded_by)
    values (p_asset, coalesce(nullif(p_type,''),'asset_photo'), p_path, p_name, p_mime, p_size, p_desc, auth.uid())
    returning id into v_id;
  return v_id;
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 15) دورة العهدة: صرف / تأكيد الموظف / طلب إرجاع / فحص الإرجاع / تعديل مخزون / نقل
--     كل العمليات الحرجة تقفل صفوف الأصول (FOR UPDATE) بترتيب asset_id لمنع الجمود،
--     وتمنع الكمية السالبة والصرف المزدوج للأصل المتسلسل.
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ربط دليل صورة (استلام/إرجاع/فحص/تلف). يتحقق من ملكية العهدة حسب الدور والمرحلة.
create or replace function public.custody_inv_attach_evidence(
  p_assignment uuid, p_item uuid, p_stage text, p_path text, p_name text, p_mime text, p_size bigint, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_asset uuid; v_id uuid;
begin
  if coalesce(trim(p_path),'') = '' then raise exception 'path_required'; end if;
  if p_stage not in ('issue_admin','issue_employee','return_employee','return_inspection','damage','maintenance')
    then raise exception 'bad_stage'; end if;
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'assignment_not_found'; end if;
  -- المرحلة الموظفية: صاحب العهدة فقط. المراحل الإدارية: أمين العهدة/الأدمن.
  if p_stage in ('issue_employee','return_employee') then
    if auth.uid() <> v_owner then raise exception 'not_your_assignment'; end if;
  else
    if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  end if;
  if p_item is not null then select asset_id into v_asset from public.custody_inventory_assignment_items where id = p_item and assignment_id = p_assignment; end if;
  insert into public.custody_inventory_evidence(assignment_id, assignment_item_id, asset_id, evidence_stage, file_path, file_name, mime_type, size_bytes, note, uploaded_by)
    values (p_assignment, p_item, v_asset, p_stage, p_path, p_name, p_mime, p_size, p_note, auth.uid()) returning id into v_id;
  return v_id;
end; $$;

-- صرف عهدة: يقفل الأصول، يخصم المتاح، ينشئ الرأس والبنود والحركات، ثم يُشعر.
create or replace function public.custody_inv_admin_create_assignment(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid; v_empid uuid; v_no text; v_aid uuid; v_items jsonb; elem jsonb;
        v_asset uuid; v_qty numeric; rec record; v_count int := 0; v_reserved numeric;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_emp := nullif(p_data->>'employee_user_id','')::uuid;
  if v_emp is null then raise exception 'employee_required'; end if;
  v_items := coalesce(p_data->'items','[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'items_required'; end if;
  -- محاولة ربط ملف الموظف (اختياري، للقراءة فقط — لا يعدّل HR).
  if to_regclass('public.hr_employee_profiles') is not null then
    execute 'select id from public.hr_employee_profiles where user_id = $1 and is_deleted = false limit 1' into v_empid using v_emp;
  end if;
  v_no := public.civ_gen_no('CIV');
  insert into public.custody_inventory_assignments(
    assignment_number, employee_id, employee_user_id, assignment_type, project_id, field_task_id, purpose, expected_return_at, issued_by, status)
  values (v_no, v_empid, v_emp, coalesce(nullif(p_data->>'assignment_type',''),'permanent'),
    nullif(p_data->>'project_id','')::uuid, nullif(p_data->>'field_task_id','')::uuid, nullif(trim(p_data->>'purpose'),''),
    nullif(p_data->>'expected_return_at','')::timestamptz, auth.uid(), 'pending_employee_confirmation')
  returning id into v_aid;
  -- قفل الأصول بترتيب ثابت (asset_id) لمنع الجمود، ثم الخصم.
  for elem in select value from jsonb_array_elements(v_items) order by (value->>'asset_id') loop
    v_asset := (elem->>'asset_id')::uuid;
    v_qty   := coalesce((elem->>'quantity')::numeric, 1);
    select * into rec from public.custody_inventory_assets where id = v_asset and is_deleted = false for update;
    if rec.id is null then raise exception 'asset_not_found: %', v_asset; end if;
    if rec.availability_status in ('maintenance','lost','retired') then raise exception 'asset_unavailable: %', rec.asset_code; end if;
    if rec.asset_type = 'serialized' then
      v_qty := 1;
      if exists (select 1 from public.custody_inventory_assignment_items
                 where asset_id = v_asset and status in ('pending','active','return_requested','disputed'))
        then raise exception 'asset_already_assigned: %', rec.asset_code; end if;
    end if;
    if v_qty <= 0 then raise exception 'bad_quantity'; end if;
    if v_qty > rec.quantity_available then raise exception 'insufficient_stock: % (متاح %)', rec.asset_code, rec.quantity_available; end if;
    -- احترام الحجوزات النشطة لغير هذا الموظف: لا يُصرف ما يترك أقل من الكمية المحجوزة.
    select coalesce(sum(quantity),0) into v_reserved from public.custody_inventory_reservations
      where asset_id = v_asset and status = 'active' and (reserved_to is null or reserved_to >= now())
        and (employee_id is null or employee_id is distinct from v_emp);
    if (rec.quantity_available - v_qty) < v_reserved then raise exception 'reserved_shortage: % (محجوز %)', rec.asset_code, v_reserved; end if;
    update public.custody_inventory_assets set quantity_available = quantity_available - v_qty where id = v_asset;
    perform public.civ_set_avail(v_asset);
    insert into public.custody_inventory_assignment_items(assignment_id, asset_id, quantity, condition_at_issue, issue_notes, status)
      values (v_aid, v_asset, v_qty, nullif(elem->>'condition_at_issue',''), nullif(elem->>'issue_notes',''), 'pending');
    insert into public.custody_inventory_movements(asset_id, assignment_id, movement_type, quantity_before, quantity_change, quantity_after,
        from_location_id, to_employee_id, condition_before, reason, created_by, reference_type, reference_id)
      values (v_asset, v_aid, 'issue_to_employee', rec.quantity_available, -v_qty, rec.quantity_available - v_qty,
        rec.warehouse_location_id, v_emp, rec.condition_status, 'صرف عهدة ' || v_no, auth.uid(), 'assignment', v_aid);
    v_count := v_count + 1;
  end loop;
  perform public.civ_notify(v_emp, 'civ_confirm_pending', v_aid, 'عهدة جديدة بانتظار تأكيد استلامك: ' || v_no, 'New custody awaiting your confirmation: ' || v_no);
  perform public.civ_notify_managers('civ_assignment_created', v_aid, 'تم صرف عهدة ' || v_no, 'Custody issued: ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_aid, 'assignment_number', v_no, 'items', v_count);
end; $$;

-- تأكيد الموظف: يتطلب صورة استلام واحدة على الأقل لكل بند.
create or replace function public.custody_inv_employee_confirm_assignment(p_assignment uuid, p_ack text, p_ack_name text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_status text; r record;
begin
  select employee_user_id, status into v_owner, v_status from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  if auth.uid() <> v_owner then raise exception 'not_your_assignment'; end if;
  if v_status <> 'pending_employee_confirmation' then raise exception 'not_pending'; end if;
  if coalesce(trim(p_ack),'') = '' then raise exception 'ack_required'; end if;
  for r in select id from public.custody_inventory_assignment_items where assignment_id = p_assignment loop
    if not exists (select 1 from public.custody_inventory_evidence
                   where assignment_item_id = r.id and evidence_stage = 'issue_employee' and is_deleted = false)
      then raise exception 'evidence_required_per_item'; end if;
  end loop;
  update public.custody_inventory_assignments
    set status = 'active', employee_confirmed_at = now(), ack_snapshot = p_ack, ack_name = nullif(trim(p_ack_name),''),
        ack_ip = public.civ_client_ip(), employee_note = nullif(trim(p_note),''), updated_at = now()
    where id = p_assignment;
  update public.custody_inventory_assignment_items set status = 'active', updated_at = now() where assignment_id = p_assignment and status = 'pending';
  insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, reason, created_by, to_employee_id)
    select i.asset_id, i.assignment_id, i.id, 'employee_confirmed', 'تأكيد استلام الموظف', auth.uid(), v_owner
      from public.custody_inventory_assignment_items i where i.assignment_id = p_assignment;
  perform public.civ_notify_managers('civ_employee_confirmed', p_assignment, 'أكّد الموظف استلام العهدة', 'Employee confirmed custody');
  return true;
end; $$;

-- طلب إرجاع من الموظف: يتطلب صورة إرجاع واحدة على الأقل لكل بند مُرجَع.
create or replace function public.custody_inv_employee_request_return(p_assignment uuid, p_items jsonb, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_status text; elem jsonb; v_item uuid; v_qty numeric; rec record;
begin
  select employee_user_id, status into v_owner, v_status from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  if auth.uid() <> v_owner then raise exception 'not_your_assignment'; end if;
  if v_status not in ('active','partially_returned') then raise exception 'not_returnable'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;
  for elem in select value from jsonb_array_elements(p_items) loop
    v_item := (elem->>'assignment_item_id')::uuid;
    v_qty  := coalesce((elem->>'quantity')::numeric, null);
    select * into rec from public.custody_inventory_assignment_items where id = v_item and assignment_id = p_assignment;
    if rec.id is null then raise exception 'item_not_found'; end if;
    if v_qty is null then v_qty := rec.quantity - rec.quantity_returned; end if;
    if v_qty <= 0 or v_qty > (rec.quantity - rec.quantity_returned) then raise exception 'bad_return_quantity'; end if;
    if not exists (select 1 from public.custody_inventory_evidence
                   where assignment_item_id = v_item and evidence_stage = 'return_employee' and is_deleted = false)
      then raise exception 'evidence_required_per_item'; end if;
    update public.custody_inventory_assignment_items
      set status = 'return_requested', condition_at_return = nullif(elem->>'condition',''), return_notes = nullif(elem->>'note',''), updated_at = now()
      where id = v_item;
    insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, reason, created_by, from_employee_id)
      values (rec.asset_id, p_assignment, v_item, 'return_requested', 'طلب إرجاع', auth.uid(), v_owner);
  end loop;
  update public.custody_inventory_assignments set status = 'return_requested', employee_note = coalesce(nullif(trim(p_note),''), employee_note), updated_at = now() where id = p_assignment;
  perform public.civ_notify_managers('civ_return_requested', p_assignment, 'طلب إرجاع عهدة بانتظار الفحص', 'Custody return awaiting inspection');
  return true;
end; $$;

-- فحص الإرجاع: يقفل الأصول ويطبّق النتيجة لكل بند. يتطلب صورة فحص لكل بند.
create or replace function public.custody_inv_admin_inspect_return(p_assignment uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; elem jsonb; v_item uuid; v_res text; v_qty numeric; rec record; ast record;
        v_accepted int := 0; v_other int := 0; v_remaining int;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;
  -- ترتيب حسب asset_id لقفل ثابت.
  for elem in select value from jsonb_array_elements(p_items) as t(value)
              order by (select asset_id from public.custody_inventory_assignment_items where id = (value->>'assignment_item_id')::uuid) loop
    v_item := (elem->>'assignment_item_id')::uuid;
    v_res  := elem->>'result';
    if v_res not in ('accepted_good','accepted_damaged','maintenance_required','missing','rejected_return','partial_return')
      then raise exception 'bad_result'; end if;
    select * into rec from public.custody_inventory_assignment_items where id = v_item and assignment_id = p_assignment;
    if rec.id is null then raise exception 'item_not_found'; end if;
    if not exists (select 1 from public.custody_inventory_evidence
                   where assignment_item_id = v_item and evidence_stage = 'return_inspection' and is_deleted = false)
      then raise exception 'inspection_photo_required'; end if;
    v_qty := coalesce((elem->>'quantity')::numeric, rec.quantity - rec.quantity_returned);
    if v_qty <= 0 or v_qty > (rec.quantity - rec.quantity_returned) then raise exception 'bad_quantity'; end if;
    select * into ast from public.custody_inventory_assets where id = rec.asset_id for update;

    if v_res in ('accepted_good','accepted_damaged','partial_return') then
      update public.custody_inventory_assets set quantity_available = quantity_available + v_qty,
        condition_status = case when v_res = 'accepted_damaged' then 'damaged' else condition_status end,
        warehouse_location_id = coalesce(nullif(elem->>'to_location_id','')::uuid, warehouse_location_id) where id = ast.id;
      perform public.civ_set_avail(ast.id);
      update public.custody_inventory_assignment_items set quantity_returned = quantity_returned + v_qty,
        returned_at = now(), return_notes = coalesce(nullif(elem->>'note',''), return_notes),
        status = case when (quantity_returned + v_qty) >= quantity then (case when v_res='partial_return' then 'returned' else 'returned' end) else 'return_requested' end,
        updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, quantity_before, quantity_change, quantity_after, from_employee_id, condition_after, reason, created_by)
        values (ast.id, p_assignment, v_item, case when v_res='partial_return' then 'partial_return' else 'return_to_stock' end,
          ast.quantity_available, v_qty, ast.quantity_available + v_qty, v_owner,
          case when v_res='accepted_damaged' then 'damaged' else ast.condition_status end, coalesce(nullif(elem->>'note',''),'قبول إرجاع'), auth.uid());
      v_accepted := v_accepted + 1;

    elsif v_res = 'maintenance_required' then
      -- الوحدة المُرجَعة تدخل الصيانة (لا المخزون المتاح). نتتبّعها بـ quantity_in_maintenance
      -- وننشئ سجل صيانة يحمل الكمية ليعيدها close_maintenance لاحقًا. لا نقلب حالة الأصل
      -- الكمي كله (متسلسل فقط تُضبط حالته under_maintenance عبر civ_set_avail من الكمية).
      update public.custody_inventory_assets set quantity_in_maintenance = quantity_in_maintenance + v_qty,
        condition_status = case when asset_type = 'serialized' then 'under_maintenance' else condition_status end where id = ast.id;
      perform public.civ_set_avail(ast.id);
      insert into public.custody_inventory_maintenance(maintenance_number, asset_id, assignment_id, quantity, maintenance_type, issue_description, status, created_by)
        values (public.civ_gen_no('MNT'), ast.id, p_assignment, v_qty, 'repair', coalesce(nullif(elem->>'note',''),'إرجاع بحاجة صيانة'), 'opened', auth.uid());
      update public.custody_inventory_assignment_items set
        status = case when (quantity_returned + v_qty) >= quantity then 'damaged' else 'return_requested' end,
        quantity_returned = quantity_returned + v_qty, returned_at = now(),
        return_notes = coalesce(nullif(elem->>'note',''), return_notes), updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, from_employee_id, condition_after, reason, created_by)
        values (ast.id, p_assignment, v_item, 'transfer_to_maintenance', v_owner, 'under_maintenance', coalesce(nullif(elem->>'note',''),'تحويل للصيانة'), auth.uid());
      v_other := v_other + 1;

    elsif v_res = 'missing' then
      -- مفقود: لا يعود للمخزون. متسلسل → lost للأصل كله؛ كمي → إنقاص الإجمالي بمقدار المفقود.
      update public.custody_inventory_assets set
        condition_status = case when asset_type='serialized' then 'lost' else condition_status end,
        quantity_total   = case when asset_type='serialized' then quantity_total else greatest(0, quantity_total - v_qty) end
        where id = ast.id;
      perform public.civ_set_avail(ast.id);
      update public.custody_inventory_assignment_items set
        status = case when (quantity_returned + v_qty) >= quantity then 'missing' else 'return_requested' end,
        quantity_returned = quantity_returned + v_qty, returned_at = now(), updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, quantity_change, from_employee_id, reason, created_by)
        values (ast.id, p_assignment, v_item, 'lost', -v_qty, v_owner, coalesce(nullif(elem->>'note',''),'مفقود'), auth.uid());
      v_other := v_other + 1;

    else -- rejected_return: يبقى على عهدة الموظف
      update public.custody_inventory_assignment_items set status = 'active', updated_at = now() where id = v_item;
      v_other := v_other + 1;
    end if;
  end loop;

  -- إعادة حساب حالة العهدة.
  select count(*) into v_remaining from public.custody_inventory_assignment_items
    where assignment_id = p_assignment and status in ('pending','active','return_requested','disputed');
  update public.custody_inventory_assignments
    set status = case when v_remaining = 0 then 'returned' else 'partially_returned' end, updated_at = now()
    where id = p_assignment;
  perform public.civ_notify(v_owner, 'civ_return_accepted', p_assignment, 'تم فحص إرجاع عهدتك', 'Your custody return was inspected');
  perform public.civ_notify_managers('civ_return_inspected', p_assignment, 'تم فحص إرجاع عهدة', 'Custody return inspected');
  return jsonb_build_object('ok', true, 'accepted', v_accepted, 'other', v_other, 'assignment_closed', v_remaining = 0);
end; $$;

-- تعديل مخزون يدوي (تصحيح) — يقفل الأصل ويمنع الكمية السالبة وتجاوز الإجمالي.
create or replace function public.custody_inv_admin_adjust_stock(p_asset uuid, p_new_total numeric, p_new_available numeric, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ast record; v_total numeric; v_avail numeric;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into ast from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  if ast.id is null then raise exception 'not_found'; end if;
  v_total := coalesce(p_new_total, ast.quantity_total);
  v_avail := coalesce(p_new_available, ast.quantity_available);
  if v_total < 0 or v_avail < 0 then raise exception 'negative_quantity'; end if;
  if v_avail > v_total then raise exception 'available_exceeds_total'; end if;
  if ast.asset_type = 'serialized' and v_total <> 1 then raise exception 'serialized_total_must_be_1'; end if;
  update public.custody_inventory_assets set quantity_total = v_total, quantity_available = v_avail, updated_by = auth.uid(), updated_at = now() where id = p_asset;
  perform public.civ_set_avail(p_asset);
  insert into public.custody_inventory_movements(asset_id, movement_type, quantity_before, quantity_change, quantity_after, reason, created_by)
    values (p_asset, 'manual_correction', ast.quantity_available, v_avail - ast.quantity_available, v_avail, trim(p_reason), auth.uid());
  perform public.civ_notify_managers('civ_stock_correction', p_asset, 'تصحيح مخزون يدوي: ' || ast.asset_code, 'Manual stock correction: ' || ast.asset_code);
  return true;
end; $$;

-- نقل موقع أصل.
create or replace function public.custody_inv_admin_transfer_asset(p_asset uuid, p_to_location uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ast record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into ast from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  if ast.id is null then raise exception 'not_found'; end if;
  update public.custody_inventory_assets set warehouse_location_id = p_to_location, updated_by = auth.uid(), updated_at = now() where id = p_asset;
  insert into public.custody_inventory_movements(asset_id, movement_type, from_location_id, to_location_id, reason, created_by)
    values (p_asset, 'transfer_location', ast.warehouse_location_id, p_to_location, coalesce(nullif(trim(p_reason),''),'نقل موقع'), auth.uid());
  return true;
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 16) الصيانة + الحجوزات + الجرد
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- فتح صيانة استباقية لأصل في المخزون: تنقل p_qty من المتاح إلى الصيانة (لا تقلب حالة
-- الأصل الكمي كله). المتسلسل p_qty=1 وتُضبط حالته under_maintenance عبر civ_set_avail.
create or replace function public.custody_inv_admin_open_maintenance(p_asset uuid, p_qty numeric, p_type text, p_desc text, p_provider text, p_expected timestamptz) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ast record; v_no text; v_id uuid; v_qty numeric;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into ast from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  if ast.id is null then raise exception 'not_found'; end if;
  v_qty := coalesce(p_qty, 1);
  if ast.asset_type = 'serialized' then v_qty := 1; end if;
  if v_qty <= 0 then raise exception 'bad_quantity'; end if;
  if v_qty > ast.quantity_available then raise exception 'insufficient_available: %', ast.asset_code; end if;
  v_no := public.civ_gen_no('MNT');
  insert into public.custody_inventory_maintenance(maintenance_number, asset_id, quantity, maintenance_type, issue_description, provider_name, sent_at, expected_return_at, status, created_by)
    values (v_no, p_asset, v_qty, coalesce(nullif(p_type,''),'repair'), p_desc, p_provider, now(), p_expected, 'sent', auth.uid()) returning id into v_id;
  update public.custody_inventory_assets set quantity_available = quantity_available - v_qty, quantity_in_maintenance = quantity_in_maintenance + v_qty,
    condition_status = case when asset_type = 'serialized' then 'under_maintenance' else condition_status end where id = p_asset;
  perform public.civ_set_avail(p_asset);
  insert into public.custody_inventory_movements(asset_id, movement_type, quantity_before, quantity_change, quantity_after, condition_after, reason, created_by, reference_type, reference_id)
    values (p_asset, 'transfer_to_maintenance', ast.quantity_available, -v_qty, ast.quantity_available - v_qty, 'under_maintenance', 'فتح صيانة ' || v_no, auth.uid(), 'maintenance', v_id);
  perform public.civ_notify_managers('civ_maintenance_opened', p_asset, 'فتح صيانة للأصل ' || ast.asset_code, 'Maintenance opened: ' || ast.asset_code);
  return jsonb_build_object('ok', true, 'id', v_id, 'maintenance_number', v_no);
end; $$;

-- إغلاق صيانة: يعيد كمية الصيانة إلى المخزون (good/damaged) أو يشطبها (retired/lost).
create or replace function public.custody_inv_admin_close_maintenance(p_id uuid, p_result text, p_return_condition text, p_cost numeric, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare mnt record; ast record; v_cond text; v_qty numeric;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into mnt from public.custody_inventory_maintenance where id = p_id;
  if mnt.id is null then raise exception 'not_found'; end if;
  if mnt.status = 'completed' then raise exception 'already_closed'; end if;
  select * into ast from public.custody_inventory_assets where id = mnt.asset_id for update;
  v_cond := coalesce(nullif(p_return_condition,''), 'good');   -- good|damaged|retired|lost
  v_qty  := coalesce(mnt.quantity, 1);
  update public.custody_inventory_maintenance set status = coalesce(nullif(p_result,''),'completed'), returned_at = now(),
    cost = p_cost, result_note = p_note, closed_by = auth.uid(), updated_at = now() where id = p_id;
  if v_cond in ('retired','lost') then
    -- لا تعود للمخزون: تُشطب من الصيانة ومن الإجمالي.
    update public.custody_inventory_assets set quantity_in_maintenance = greatest(0, quantity_in_maintenance - v_qty),
      quantity_total = case when asset_type='serialized' then quantity_total else greatest(0, quantity_total - v_qty) end,
      condition_status = case when asset_type='serialized' then (case v_cond when 'retired' then 'retired' else 'lost' end) else condition_status end
      where id = mnt.asset_id;
  else
    -- تعود للمخزون المتاح.
    update public.custody_inventory_assets set quantity_in_maintenance = greatest(0, quantity_in_maintenance - v_qty),
      quantity_available = least(quantity_total, quantity_available + v_qty),
      condition_status = case when asset_type='serialized' then (case v_cond when 'damaged' then 'damaged' else 'good' end) else condition_status end
      where id = mnt.asset_id;
  end if;
  perform public.civ_set_avail(mnt.asset_id);
  insert into public.custody_inventory_movements(asset_id, movement_type, quantity_change, condition_before, condition_after, reason, created_by, reference_type, reference_id)
    values (mnt.asset_id, 'return_from_maintenance', case when v_cond in ('retired','lost') then 0 else v_qty end, 'under_maintenance', v_cond, coalesce(nullif(p_note,''),'إغلاق صيانة'), auth.uid(), 'maintenance', p_id);
  perform public.civ_notify_managers('civ_maintenance_closed', mnt.asset_id, 'إغلاق صيانة الأصل ' || ast.asset_code, 'Maintenance closed: ' || ast.asset_code);
  return true;
end; $$;

create or replace function public.custody_inv_admin_create_reservation(p_asset uuid, p_qty numeric, p_employee uuid, p_project uuid, p_task uuid, p_from timestamptz, p_to timestamptz, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare ast record; v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into ast from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if ast.id is null then raise exception 'not_found'; end if;
  if coalesce(p_qty,1) <= 0 or coalesce(p_qty,1) > ast.quantity_total then raise exception 'bad_quantity'; end if;
  insert into public.custody_inventory_reservations(asset_id, quantity, employee_id, project_id, field_task_id, reserved_from, reserved_to, note, created_by)
    values (p_asset, coalesce(p_qty,1), p_employee, p_project, p_task, p_from, p_to, p_note, auth.uid()) returning id into v_id;
  perform public.civ_notify_managers('civ_reservation_created', p_asset, 'حجز أصل ' || ast.asset_code, 'Asset reserved: ' || ast.asset_code);
  return v_id;
end; $$;

create or replace function public.custody_inv_admin_cancel_reservation(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  update public.custody_inventory_reservations set status = 'cancelled', note = coalesce(nullif(p_reason,''), note), updated_at = now()
    where id = p_id and status = 'active';
  return found;
end; $$;

-- الجرد: بدء (يبذر البنود من أصول الموقع) / تسجيل عدّ / اعتماد (يطبّق الفروقات فقط عند الاعتماد).
create or replace function public.custody_inv_admin_start_audit(p_location uuid, p_notes text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_no text; v_id uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_no := public.civ_gen_no('AUD');
  insert into public.custody_inventory_audits(audit_number, location_id, status, started_by, started_at, notes)
    values (v_no, p_location, 'in_progress', auth.uid(), now(), p_notes) returning id into v_id;
  -- المتوقع = المتاح فعليًا في الموقع (لا الإجمالي) — فالوحدات على عهدة الموظفين ليست
  -- حاضرة في المستودع، فلا تُحسب نقصًا كاذبًا عند العدّ.
  insert into public.custody_inventory_audit_items(audit_id, asset_id, expected_quantity, expected_location)
    select v_id, a.id, a.quantity_available, a.warehouse_location_id from public.custody_inventory_assets a
     where a.is_deleted = false and (p_location is null or a.warehouse_location_id = p_location);
  perform public.civ_notify_managers('civ_audit_started', v_id, 'بدء جرد ' || v_no, 'Audit started: ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_id, 'audit_number', v_no);
end; $$;

create or replace function public.custody_inv_admin_count_audit_item(p_audit uuid, p_asset uuid, p_counted numeric, p_actual_location uuid, p_condition text, p_note text) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_expected numeric;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select expected_quantity into v_expected from public.custody_inventory_audit_items where audit_id = p_audit and asset_id = p_asset;
  insert into public.custody_inventory_audit_items(audit_id, asset_id, expected_quantity, counted_quantity, variance, actual_location, condition_found, scanned_at, counted_by, note)
    values (p_audit, p_asset, coalesce(v_expected,(select quantity_total from public.custody_inventory_assets where id=p_asset)),
      p_counted, p_counted - coalesce(v_expected,0), p_actual_location, p_condition, now(), auth.uid(), p_note)
  on conflict (audit_id, asset_id) do update set counted_quantity = excluded.counted_quantity,
    variance = excluded.counted_quantity - coalesce(custody_inventory_audit_items.expected_quantity,0),
    actual_location = excluded.actual_location, condition_found = excluded.condition_found, scanned_at = now(), counted_by = auth.uid(), note = excluded.note;
  return true;
end; $$;

create or replace function public.custody_inv_admin_approve_audit(p_audit uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_applied int := 0; ast record;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;  -- الاعتماد للمالك/الأدمن فقط
  if not exists (select 1 from public.custody_inventory_audits where id = p_audit and status = 'in_progress') then raise exception 'not_in_progress'; end if;
  for r in select * from public.custody_inventory_audit_items where audit_id = p_audit and counted_quantity is not null and coalesce(variance,0) <> 0 loop
    select * into ast from public.custody_inventory_assets where id = r.asset_id for update;
    if ast.id is null then continue; end if;
    -- تطبيق الفرق على المتاح (والإجمالي بنفس المقدار) بعد الاعتماد فقط — لا تعديل صامت.
    -- المتسلسل لا يُخفَّض إجماليه دون 1 (قيد serialized): النقص = فقدان الوحدة (lost).
    if ast.asset_type = 'serialized' then
      if r.variance < 0 then
        update public.custody_inventory_assets set condition_status = 'lost', quantity_available = 0 where id = r.asset_id;
      end if;  -- الزيادة للأصل المتسلسل غير منطقية → تُتجاهل
    else
      update public.custody_inventory_assets
        set quantity_total = greatest(0, quantity_total + r.variance),
            quantity_available = greatest(0, least(quantity_available + r.variance, greatest(0, quantity_total + r.variance)))
        where id = r.asset_id;
    end if;
    perform public.civ_set_avail(r.asset_id);
    insert into public.custody_inventory_movements(asset_id, movement_type, quantity_change, reason, created_by, reference_type, reference_id)
      values (r.asset_id, 'stock_adjustment', r.variance, 'فرق جرد معتمد', auth.uid(), 'audit', p_audit);
    v_applied := v_applied + 1;
  end loop;
  update public.custody_inventory_audits set status = 'approved', completed_at = coalesce(completed_at, now()), approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = p_audit;
  perform public.civ_notify_managers('civ_audit_approved', p_audit, 'اعتماد جرد وتطبيق الفروقات', 'Audit approved & variances applied');
  return jsonb_build_object('ok', true, 'variances_applied', v_applied);
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 17) قراءات مجمّعة: عهد الموظف / تايملاين الأصل / لوحة المؤشرات / التقارير
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- عهد الموظف الحالي (نفسه فقط) مع بنودها وأدلتها.
create or replace function public.custody_inv_get_my_assignments() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.issued_at desc) from (
      select a.id, a.assignment_number, a.status, a.assignment_type, a.purpose, a.expected_return_at, a.issued_at,
             a.employee_confirmed_at, a.employee_note, a.ack_snapshot,
             (select jsonb_agg(jsonb_build_object('id', i.id, 'asset_id', i.asset_id, 'asset_name', ast.asset_name,
                'asset_code', ast.asset_code, 'quantity', i.quantity, 'quantity_returned', i.quantity_returned,
                'status', i.status, 'condition_at_issue', i.condition_at_issue))
              from public.custody_inventory_assignment_items i join public.custody_inventory_assets ast on ast.id = i.asset_id
              where i.assignment_id = a.id) as items
      from public.custody_inventory_assignments a
      where a.employee_user_id = v_uid and a.is_deleted = false
    ) x
  ), '[]'::jsonb);
end; $$;

-- تايملاين أصل (حركات + صيانة) — للإدارة/أمين العهدة.
create or replace function public.custody_inv_get_asset_timeline(p_asset uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'movements', coalesce((select jsonb_agg(row_to_json(m) order by m.created_at desc)
       from public.custody_inventory_movements m where m.asset_id = p_asset), '[]'::jsonb),
    'maintenance', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc)
       from public.custody_inventory_maintenance x where x.asset_id = p_asset), '[]'::jsonb),
    'stats', (select jsonb_build_object('times_issued',
        (select count(*) from public.custody_inventory_movements where asset_id = p_asset and movement_type='issue_to_employee'))));
end; $$;

-- لوحة المؤشرات — للإدارة/أمين العهدة.
create or replace function public.custody_inv_admin_get_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'total_assets',       (select count(*) from public.custody_inventory_assets where is_deleted=false),
    'total_value',        (select coalesce(sum(coalesce(current_value, purchase_price, 0)),0) from public.custody_inventory_assets where is_deleted=false),
    'available',          (select count(*) from public.custody_inventory_assets where is_deleted=false and availability_status in ('available','partially_assigned')),
    'assigned',           (select count(*) from public.custody_inventory_assets where is_deleted=false and availability_status in ('assigned','partially_assigned')),
    'reserved',           (select count(distinct asset_id) from public.custody_inventory_reservations where status='active'),
    'maintenance',        (select count(*) from public.custody_inventory_assets where is_deleted=false and availability_status='maintenance'),
    'damaged',            (select count(*) from public.custody_inventory_assets where is_deleted=false and condition_status='damaged'),
    'lost',               (select count(*) from public.custody_inventory_assets where is_deleted=false and condition_status='lost'),
    'active_assignments', (select count(*) from public.custody_inventory_assignments where is_deleted=false and status in ('active','partially_returned')),
    'overdue',            (select count(*) from public.custody_inventory_assignments where is_deleted=false and status in ('active','partially_returned') and expected_return_at is not null and expected_return_at < now()),
    'pending_returns',    (select count(*) from public.custody_inventory_assignments where is_deleted=false and status='return_requested'),
    'pending_confirm',    (select count(*) from public.custody_inventory_assignments where is_deleted=false and status='pending_employee_confirmation'),
    'warranty_soon',      (select count(*) from public.custody_inventory_assets where is_deleted=false and warranty_expiry_date is not null and warranty_expiry_date between current_date and current_date + 30),
    'audit_variances',    (select count(*) from public.custody_inventory_audit_items ai join public.custody_inventory_audits au on au.id=ai.audit_id where au.status='in_progress' and coalesce(ai.variance,0)<>0)
  );
end; $$;

-- تقارير مرنة — للإدارة/أمين العهدة. p_kind يختار التقرير؛ p_filters وسائط اختيارية.
create or replace function public.custody_inv_admin_get_report(p_kind text, p_filters jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if p_kind = 'stock' then
    return coalesce((select jsonb_agg(row_to_json(x)) from (
      select a.id, a.asset_code, a.asset_name, c.name as category, a.asset_type, a.quantity_total, a.quantity_available,
             a.availability_status, a.condition_status, l.name as location, coalesce(a.current_value,a.purchase_price) as value
      from public.custody_inventory_assets a
      left join public.custody_inventory_categories c on c.id=a.category_id
      left join public.custody_inventory_locations l on l.id=a.warehouse_location_id
      where a.is_deleted=false
        and (f->>'category_id' is null or a.category_id=(f->>'category_id')::uuid)
        and (f->>'location_id' is null or a.warehouse_location_id=(f->>'location_id')::uuid)
        and (f->>'availability_status' is null or a.availability_status=f->>'availability_status')
      order by a.asset_name) x), '[]'::jsonb);
  elsif p_kind = 'active_assignments' then
    return coalesce((select jsonb_agg(row_to_json(x)) from (
      select a.id, a.assignment_number, a.employee_user_id, a.status, a.issued_at, a.expected_return_at,
             (a.expected_return_at is not null and a.expected_return_at < now()) as overdue,
             (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id=a.id) as item_count
      from public.custody_inventory_assignments a where a.is_deleted=false and a.status in ('active','partially_returned','return_requested')
      order by a.issued_at desc) x), '[]'::jsonb);
  elsif p_kind = 'overdue' then
    return coalesce((select jsonb_agg(row_to_json(x)) from (
      select a.assignment_number, a.employee_user_id, a.expected_return_at,
             extract(day from now() - a.expected_return_at)::int as days_overdue
      from public.custody_inventory_assignments a where a.is_deleted=false and a.status in ('active','partially_returned')
        and a.expected_return_at is not null and a.expected_return_at < now() order by a.expected_return_at) x), '[]'::jsonb);
  elsif p_kind = 'damage_lost' then
    return coalesce((select jsonb_agg(row_to_json(x)) from (
      select a.asset_code, a.asset_name, a.condition_status, coalesce(a.current_value,a.purchase_price) as value, a.updated_at
      from public.custody_inventory_assets a where a.is_deleted=false and a.condition_status in ('damaged','lost') order by a.updated_at desc) x), '[]'::jsonb);
  elsif p_kind = 'maintenance' then
    return coalesce((select jsonb_agg(row_to_json(x)) from (
      select m.maintenance_number, a.asset_code, a.asset_name, m.status, m.maintenance_type, m.sent_at, m.expected_return_at, m.cost
      from public.custody_inventory_maintenance m join public.custody_inventory_assets a on a.id=m.asset_id order by m.created_at desc) x), '[]'::jsonb);
  elsif p_kind = 'warranty' then
    return coalesce((select jsonb_agg(row_to_json(x)) from (
      select asset_code, asset_name, warranty_expiry_date, (warranty_expiry_date - current_date) as days_left
      from public.custody_inventory_assets where is_deleted=false and warranty_expiry_date is not null
        and warranty_expiry_date <= current_date + coalesce((f->>'within_days')::int, 90) order by warranty_expiry_date) x), '[]'::jsonb);
  elsif p_kind = 'value' then
    return (select jsonb_build_object(
      'purchase_total', coalesce(sum(purchase_price),0), 'current_total', coalesce(sum(current_value),0),
      'assigned_value', coalesce(sum(case when availability_status in ('assigned','partially_assigned') then coalesce(current_value,purchase_price) else 0 end),0),
      'lost_damaged_value', coalesce(sum(case when condition_status in ('lost','damaged') then coalesce(current_value,purchase_price) else 0 end),0))
      from public.custody_inventory_assets where is_deleted=false);
  elsif p_kind = 'movements' then
    return coalesce((select jsonb_agg(row_to_json(x)) from (
      select m.created_at, m.movement_type, a.asset_code, m.quantity_change, m.reason
      from public.custody_inventory_movements m join public.custody_inventory_assets a on a.id=m.asset_id
      where (f->>'asset_id' is null or m.asset_id=(f->>'asset_id')::uuid)
        and (f->>'from' is null or m.created_at >= (f->>'from')::timestamptz)
        and (f->>'to' is null or m.created_at <= (f->>'to')::timestamptz)
      order by m.created_at desc limit 1000) x), '[]'::jsonb);
  else
    raise exception 'unknown_report_kind';
  end if;
end; $$;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 18) RLS + GRANTS
--   القراءة المباشرة: الإدارة/أمين العهدة يرون الكل؛ الموظف يرى عهده وبنودها وأدلتها
--   فقط (لا يرى مخزون الشركة). كل الكتابة عبر RPCs (SECURITY DEFINER) — لا سياسات
--   insert/update/delete فيُمنع أي كتابة مباشرة من المتصفح (deny افتراضي).
-- ════════════════════════════════════════════════════════════════════════════
begin;
alter table public.custody_inventory_categories        enable row level security;
alter table public.custody_inventory_locations         enable row level security;
alter table public.custody_inventory_assets            enable row level security;
alter table public.custody_inventory_asset_files       enable row level security;
alter table public.custody_inventory_assignments       enable row level security;
alter table public.custody_inventory_assignment_items  enable row level security;
alter table public.custody_inventory_evidence          enable row level security;
alter table public.custody_inventory_movements         enable row level security;
alter table public.custody_inventory_maintenance       enable row level security;
alter table public.custody_inventory_reservations      enable row level security;
alter table public.custody_inventory_audits            enable row level security;
alter table public.custody_inventory_audit_items       enable row level security;

-- إدارة/أمين العهدة: قراءة كل الجداول.
drop policy if exists civ_categories_read on public.custody_inventory_categories;
create policy civ_categories_read on public.custody_inventory_categories for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_locations_read on public.custody_inventory_locations;
create policy civ_locations_read on public.custody_inventory_locations for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_assets_read on public.custody_inventory_assets;
create policy civ_assets_read on public.custody_inventory_assets for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_asset_files_read on public.custody_inventory_asset_files;
create policy civ_asset_files_read on public.custody_inventory_asset_files for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_movements_read on public.custody_inventory_movements;
create policy civ_movements_read on public.custody_inventory_movements for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_maint_read on public.custody_inventory_maintenance;
create policy civ_maint_read on public.custody_inventory_maintenance for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_resv_read on public.custody_inventory_reservations;
create policy civ_resv_read on public.custody_inventory_reservations for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_audits_read on public.custody_inventory_audits;
create policy civ_audits_read on public.custody_inventory_audits for select to authenticated using (public.civ_can_manage());
drop policy if exists civ_audit_items_read on public.custody_inventory_audit_items;
create policy civ_audit_items_read on public.custody_inventory_audit_items for select to authenticated using (public.civ_can_manage());

-- العهد: الإدارة الكل، والموظف صفوفه فقط.
drop policy if exists civ_assign_read on public.custody_inventory_assignments;
create policy civ_assign_read on public.custody_inventory_assignments for select to authenticated
  using (public.civ_can_manage() or employee_user_id = auth.uid());
drop policy if exists civ_items_read on public.custody_inventory_assignment_items;
create policy civ_items_read on public.custody_inventory_assignment_items for select to authenticated
  using (public.civ_can_manage() or exists (
    select 1 from public.custody_inventory_assignments a where a.id = assignment_id and a.employee_user_id = auth.uid()));
drop policy if exists civ_evidence_read on public.custody_inventory_evidence;
create policy civ_evidence_read on public.custody_inventory_evidence for select to authenticated
  using (public.civ_can_manage() or exists (
    select 1 from public.custody_inventory_assignments a where a.id = assignment_id and a.employee_user_id = auth.uid()));

-- GRANTS: القراءة (RLS يقيّد الصفوف) + تنفيذ الـ RPCs.
grant select on public.custody_inventory_categories, public.custody_inventory_locations, public.custody_inventory_assets,
  public.custody_inventory_asset_files, public.custody_inventory_assignments, public.custody_inventory_assignment_items,
  public.custody_inventory_evidence, public.custody_inventory_movements, public.custody_inventory_maintenance,
  public.custody_inventory_reservations, public.custody_inventory_audits, public.custody_inventory_audit_items to authenticated;

grant execute on function public.custody_inv_get_settings() to authenticated;
grant execute on function public.custody_inv_admin_update_settings(jsonb) to authenticated;
grant execute on function public.custody_inv_admin_upsert_category(uuid,text,int) to authenticated;
grant execute on function public.custody_inv_admin_archive_category(uuid,text) to authenticated;
grant execute on function public.custody_inv_admin_upsert_location(uuid,text,text,text,text,uuid,text,boolean) to authenticated;
grant execute on function public.custody_inv_admin_archive_location(uuid,text) to authenticated;
grant execute on function public.custody_inv_admin_create_asset(jsonb) to authenticated;
grant execute on function public.custody_inv_admin_update_asset(uuid,jsonb) to authenticated;
grant execute on function public.custody_inv_admin_archive_asset(uuid,text) to authenticated;
grant execute on function public.custody_inv_attach_asset_file(uuid,text,text,text,text,bigint,text) to authenticated;
grant execute on function public.custody_inv_attach_evidence(uuid,uuid,text,text,text,text,bigint,text) to authenticated;
grant execute on function public.custody_inv_admin_create_assignment(jsonb) to authenticated;
grant execute on function public.custody_inv_employee_confirm_assignment(uuid,text,text,text) to authenticated;
grant execute on function public.custody_inv_employee_request_return(uuid,jsonb,text) to authenticated;
grant execute on function public.custody_inv_admin_inspect_return(uuid,jsonb) to authenticated;
grant execute on function public.custody_inv_admin_adjust_stock(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.custody_inv_admin_transfer_asset(uuid,uuid,text) to authenticated;
grant execute on function public.custody_inv_admin_open_maintenance(uuid,numeric,text,text,text,timestamptz) to authenticated;
grant execute on function public.custody_inv_admin_close_maintenance(uuid,text,text,numeric,text) to authenticated;
grant execute on function public.custody_inv_admin_create_reservation(uuid,numeric,uuid,uuid,uuid,timestamptz,timestamptz,text) to authenticated;
grant execute on function public.custody_inv_admin_cancel_reservation(uuid,text) to authenticated;
grant execute on function public.custody_inv_admin_start_audit(uuid,text) to authenticated;
grant execute on function public.custody_inv_admin_count_audit_item(uuid,uuid,numeric,uuid,text,text) to authenticated;
grant execute on function public.custody_inv_admin_approve_audit(uuid) to authenticated;
grant execute on function public.custody_inv_get_my_assignments() to authenticated;
grant execute on function public.custody_inv_get_asset_timeline(uuid) to authenticated;
grant execute on function public.custody_inv_admin_get_dashboard() to authenticated;
grant execute on function public.custody_inv_admin_get_report(text,jsonb) to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 19) STORAGE — bucketان خاصّان (signed URL فقط). لا public.
--   custody-inventory-assets:   صور/وثائق كتالوج الأصول — الإدارة/أمين العهدة فقط.
--   custody-inventory-evidence: أدلة الاستلام/الإرجاع/الفحص — المسار يبدأ بـ user_id
--     صاحب العهدة؛ فيقرؤها الموظف (مجلده) والإدارة (الكل)، ويرفع الطرفان.
-- ════════════════════════════════════════════════════════════════════════════
begin;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custody-inventory-assets','custody-inventory-assets', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf'];
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('custody-inventory-evidence','custody-inventory-evidence', false, 10485760,
        array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false, file_size_limit=10485760,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- كتالوج الأصول: الإدارة/أمين العهدة فقط (قراءة + رفع). لا update/delete (صور ثابتة).
drop policy if exists "civ assets bucket read" on storage.objects;
create policy "civ assets bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'custody-inventory-assets' and public.civ_can_manage());
drop policy if exists "civ assets bucket upload" on storage.objects;
create policy "civ assets bucket upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'custody-inventory-assets' and public.civ_can_manage());

-- الأدلة: قراءة = إدارة أو صاحب المجلد (user_id صاحب العهدة). رفع = إدارة أو صاحب المجلد.
drop policy if exists "civ evidence read" on storage.objects;
create policy "civ evidence read" on storage.objects for select to authenticated
  using (bucket_id = 'custody-inventory-evidence'
         and (public.civ_can_manage() or (storage.foldername(name))[1] = auth.uid()::text));
drop policy if exists "civ evidence upload" on storage.objects;
create policy "civ evidence upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'custody-inventory-evidence'
         and (public.civ_can_manage() or (storage.foldername(name))[1] = auth.uid()::text));
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- 20) VALIDATION — شغّل هذه الاستعلامات بعد التطبيق للتأكد.
-- ════════════════════════════════════════════════════════════════════════════
-- 1) الجداول (يجب 13 — تشمل جدول الإعدادات):
select count(*) as civ_tables from information_schema.tables
 where table_schema='public' and table_name like 'custody_inventory_%';
-- 2) الـ RPCs (يجب 28):
select count(*) as civ_rpcs from pg_proc where proname like 'custody_inv_%';
-- 3) RLS مفعّل على كل الجداول:
select relname, relrowsecurity from pg_class where relname like 'custody_inventory_%' order by relname;
-- 4) الـ buckets خاصّة:
select id, public from storage.buckets where id in ('custody-inventory-assets','custody-inventory-evidence');
-- 5) الإعداد موجود (صف واحد):
select id, legacy_custody_employee_visible from public.custody_inventory_settings;
-- 6) نوع الإشعار الجديد ضمن CHECK:
select 'civ types in check' as k, (select count(*) from pg_constraint where conname='notifications_type_check') as present;
-- 7) لا كمية متاحة سالبة ولا تتجاوز الإجمالي:
select count(*) as bad_qty from public.custody_inventory_assets where quantity_available < 0 or quantity_available > quantity_total;
-- 8) لا عهد مرتبطة بأصل محذوف نهائيًا (لا يوجد hard delete أصلًا):
select count(*) as orphan_items from public.custody_inventory_assignment_items i
  left join public.custody_inventory_assets a on a.id = i.asset_id where a.id is null;
-- 9) لا صرف مزدوج نشط لأصل متسلسل (يجب 0):
select count(*) as dup_serialized from (
  select i.asset_id from public.custody_inventory_assignment_items i
  join public.custody_inventory_assets a on a.id=i.asset_id
  where a.asset_type='serialized' and i.status in ('pending','active','return_requested','disputed')
  group by i.asset_id having count(*) > 1) d;
-- ════════════════════════════════════════════════════════════════════════════
