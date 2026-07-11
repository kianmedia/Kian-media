-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody Inventory: Asset Details + Secure Admin Editing (idempotent PATCH)
-- ────────────────────────────────────────────────────────────────────────────
-- يضيف: سجل تغييرات الأصل + دوال (تفاصيل كاملة / تعديل آمن / تصحيح مخزون آمن /
--       إدارة الصور / قراءة سجل التغييرات). لا يلمس العهدة اليدوية القديمة، ولا
--       التأجير القديم، ولا Zoho، ولا الفواتير، ولا عروض الأسعار.
-- يُشغَّل بعد: portal_custody_inventory_system_v1_RUNME.sql
--            (+ portal_custody_inventory_employee_self_service_PATCH.sql)
--            (+ custody_enterprise_00_feature_flags_PATCH.sql — لأجل civ_can_finance؛
--              ومع ذلك نعرّفها هنا احتياطيًا ليعمل الملف مستقلًّا).
-- آمن للتكرار: create table if not exists / add column if not exists /
--             create or replace function / سياسات محروسة بـ pg_policies.
-- التحقق النهائي في نهاية الملف (SELECT فقط).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 0) civ_can_finance احتياطيًا (مطابقة لتعريف enterprise patch 00) ───
create or replace function public.civ_can_finance() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_owner() or public.staff_role() = 'finance';
$$;
revoke execute on function public.civ_can_finance() from public, anon;
grant  execute on function public.civ_can_finance() to authenticated;

-- ─── 1) جدول سجل تغييرات الأصل (per-field audit) ───
create table if not exists public.custody_inventory_asset_changes (
  id         uuid primary key default gen_random_uuid(),
  asset_id   uuid not null references public.custody_inventory_assets(id) on delete cascade,
  actor_id   uuid references auth.users(id),
  action     text not null check (action in ('update','stock_correction','image_added','image_archived','primary_image_changed')),
  changes    jsonb not null default '[]'::jsonb,   -- [{field, old, new}]
  reason     text,
  created_at timestamptz not null default now()
);
create index if not exists idx_civ_asset_changes on public.custody_inventory_asset_changes(asset_id, created_at desc);
-- فروق الحقول المالية تُخزَّن منفصلة كي لا تتسرّب لغير أصحاب الصلاحية المالية.
alter table public.custody_inventory_asset_changes add column if not exists changes_finance jsonb not null default '[]'::jsonb;
alter table public.custody_inventory_asset_changes enable row level security;
-- لا وصول مباشر عبر PostgREST — القراءة حصريًا عبر custody_inv_get_asset_changes (SECURITY DEFINER)
-- الذي يُخفي الفروق المالية عن غير أصحاب الصلاحية المالية. (منع تسرّب مباشر للـ changes_finance.)
revoke all on public.custody_inventory_asset_changes from anon, authenticated;
-- سياسة قراءة محروسة (تبقى لكن الوصول المباشر ممنوع بالـ revoke أعلاه — دفاع بالعمق).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public'
                 and tablename='custody_inventory_asset_changes' and policyname='civ_asset_changes_read') then
    create policy civ_asset_changes_read on public.custody_inventory_asset_changes
      for select using (public.civ_can_finance());   -- حتى لو أُعيد المنح لاحقًا: مالية فقط
  end if;
end $$;

-- ─── 2) عمود الصورة الأساسية على ملفات الأصل ───
alter table public.custody_inventory_asset_files add column if not exists is_primary boolean not null default false;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) الدوال (كلها SECURITY DEFINER، search_path=public)
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 3.1) تفاصيل الأصل الكاملة (عرض للمدراء؛ الحقول المالية لأصحاب صلاحية مالية) ───
--     المخزون المصروف = الإجمالي − المتاح − الصيانة (مشتق؛ لا يُخزَّن عمودًا).
create or replace function public.custody_inv_get_asset_details(p_asset uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v_fin boolean; v_assigned numeric; v_reserved numeric; j jsonb;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into a from public.custody_inventory_assets where id = p_asset and is_deleted = false;
  if a.id is null then raise exception 'not_found'; end if;
  v_fin := public.civ_can_finance();
  select coalesce(sum(quantity),0) into v_reserved
    from public.custody_inventory_reservations where asset_id = p_asset and status = 'active';
  v_assigned := greatest(0, a.quantity_total - a.quantity_available - a.quantity_in_maintenance);

  j := jsonb_build_object(
    'id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name, 'barcode', a.barcode,
    'qr_code_value', a.qr_code_value, 'category_id', a.category_id, 'brand', a.brand, 'model', a.model,
    'serial_number', a.serial_number, 'description', a.description, 'ownership_type', a.ownership_type,
    'asset_type', a.asset_type, 'unit', a.unit, 'condition_status', a.condition_status,
    'availability_status', a.availability_status, 'warehouse_location_id', a.warehouse_location_id,
    'storage_location_text', a.storage_location_text, 'notes', a.notes, 'minimum_stock_level', a.minimum_stock_level,
    'quantity_total', a.quantity_total, 'quantity_available', a.quantity_available,
    'quantity_in_maintenance', a.quantity_in_maintenance, 'quantity_assigned', v_assigned, 'quantity_reserved', v_reserved,
    'created_at', a.created_at, 'updated_at', a.updated_at,
    'created_by', a.created_by, 'created_by_name', (select full_name from public.profiles where id = a.created_by),
    'updated_by', a.updated_by, 'updated_by_name', (select full_name from public.profiles where id = a.updated_by),
    'can_edit', public.civ_can_admin(), 'can_finance', v_fin,
    'active_assignments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'assignment_number', asg.assignment_number, 'employee_user_id', asg.employee_user_id,
        'employee_name', (select full_name from public.profiles where id = asg.employee_user_id),
        'quantity', it.quantity, 'status', it.status, 'issued_at', asg.issued_at,
        'expected_return_at', asg.expected_return_at) order by asg.issued_at desc), '[]'::jsonb)
      from public.custody_inventory_assignment_items it
      join public.custody_inventory_assignments asg on asg.id = it.assignment_id
      where it.asset_id = p_asset and it.status in ('pending','active','return_requested','disputed') and asg.is_deleted = false),
    'reservations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'quantity', quantity, 'reserved_from', reserved_from, 'reserved_to', reserved_to, 'note', note)
        order by reserved_from asc nulls last), '[]'::jsonb)
      from public.custody_inventory_reservations where asset_id = p_asset and status = 'active'),
    'maintenance', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'maintenance_number', maintenance_number, 'status', status, 'issue_description', issue_description,
        'sent_at', sent_at, 'expected_return_at', expected_return_at) order by created_at desc), '[]'::jsonb)
      from public.custody_inventory_maintenance where asset_id = p_asset and status <> 'completed')
  );

  -- الحقول المالية لأصحاب الصلاحية المالية فقط.
  if v_fin then
    j := j || jsonb_build_object(
      'purchase_date', a.purchase_date, 'purchase_price', a.purchase_price, 'current_value', a.current_value,
      'supplier_name', a.supplier_name, 'invoice_number', a.invoice_number, 'warranty_expiry_date', a.warranty_expiry_date);
  else
    j := j || jsonb_build_object(
      'purchase_date', null, 'purchase_price', null, 'current_value', null,
      'supplier_name', null, 'invoice_number', null, 'warranty_expiry_date', null);
  end if;
  return j;
end; $$;

-- ─── 3.2) تعديل بيانات الأصل — آمن (Owner/Super Admin/Admin فقط = civ_can_admin) ───
--     • لا يمسّ asset_code ولا asset_type ولا الكميات (الكمية عبر correct_stock فقط).
--     • الحقول المالية تُطبَّق فقط لصاحب صلاحية مالية (تُجرَّد وإلا).
--     • يمنع تكرار الرقم التسلسلي عبر أصل آخر.
--     • يسجّل الفروق (قبل/بعد) في سجل التغييرات، ويشعر المدراء.
create or replace function public.custody_inv_admin_update_asset(p_id uuid, p_data jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  old record; v_fin boolean; v_data jsonb; v_serial text; v_reason text;
  v_old jsonb; v_new jsonb; v_changes jsonb := '[]'::jsonb; v_changes_fin jsonb := '[]'::jsonb; k text;
  audited text[] := array['asset_name','barcode','category_id','brand','model','serial_number','description',
    'ownership_type','unit','condition_status','warehouse_location_id','storage_location_text','notes',
    'minimum_stock_level','purchase_date','purchase_price','current_value','supplier_name','invoice_number','warranty_expiry_date'];
  fin_fields text[] := array['purchase_date','purchase_price','current_value','supplier_name','invoice_number','warranty_expiry_date'];
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  select * into old from public.custody_inventory_assets where id = p_id and is_deleted = false for update;
  if old.id is null then raise exception 'not_found'; end if;
  v_fin  := public.civ_can_finance();
  v_data := coalesce(p_data, '{}'::jsonb);
  v_reason := nullif(trim(v_data->>'_reason'), '');

  -- تجريد الحقول المالية إن لم يكن صاحب صلاحية مالية.
  if not v_fin then
    v_data := v_data - 'purchase_date' - 'purchase_price' - 'current_value'
                     - 'supplier_name' - 'invoice_number' - 'warranty_expiry_date';
  end if;

  -- منع تكرار الرقم التسلسلي.
  if v_data ? 'serial_number' then
    v_serial := nullif(trim(v_data->>'serial_number'), '');
    if v_serial is not null and v_serial is distinct from old.serial_number
       and exists (select 1 from public.custody_inventory_assets
                   where serial_number = v_serial and id <> p_id and is_deleted = false) then
      raise exception 'serial_in_use';
    end if;
  end if;

  update public.custody_inventory_assets set
    asset_name            = coalesce(nullif(trim(v_data->>'asset_name'),''), asset_name),
    barcode               = case when v_data ? 'barcode' then nullif(trim(v_data->>'barcode'),'') else barcode end,
    category_id           = case when v_data ? 'category_id' then nullif(v_data->>'category_id','')::uuid else category_id end,
    brand                 = case when v_data ? 'brand' then nullif(trim(v_data->>'brand'),'') else brand end,
    model                 = case when v_data ? 'model' then nullif(trim(v_data->>'model'),'') else model end,
    serial_number         = case when v_data ? 'serial_number' then nullif(trim(v_data->>'serial_number'),'') else serial_number end,
    description           = case when v_data ? 'description' then nullif(trim(v_data->>'description'),'') else description end,
    ownership_type        = coalesce(nullif(v_data->>'ownership_type',''), ownership_type),
    unit                  = coalesce(nullif(v_data->>'unit',''), unit),
    condition_status      = coalesce(nullif(v_data->>'condition_status',''), condition_status),
    warehouse_location_id = case when v_data ? 'warehouse_location_id' then nullif(v_data->>'warehouse_location_id','')::uuid else warehouse_location_id end,
    storage_location_text = case when v_data ? 'storage_location_text' then nullif(trim(v_data->>'storage_location_text'),'') else storage_location_text end,
    notes                 = case when v_data ? 'notes' then nullif(trim(v_data->>'notes'),'') else notes end,
    minimum_stock_level   = case when v_data ? 'minimum_stock_level' then nullif(v_data->>'minimum_stock_level','')::numeric else minimum_stock_level end,
    purchase_date         = case when v_data ? 'purchase_date' then nullif(v_data->>'purchase_date','')::date else purchase_date end,
    purchase_price        = case when v_data ? 'purchase_price' then nullif(v_data->>'purchase_price','')::numeric else purchase_price end,
    current_value         = case when v_data ? 'current_value' then nullif(v_data->>'current_value','')::numeric else current_value end,
    supplier_name         = case when v_data ? 'supplier_name' then nullif(trim(v_data->>'supplier_name'),'') else supplier_name end,
    invoice_number        = case when v_data ? 'invoice_number' then nullif(trim(v_data->>'invoice_number'),'') else invoice_number end,
    warranty_expiry_date  = case when v_data ? 'warranty_expiry_date' then nullif(v_data->>'warranty_expiry_date','')::date else warranty_expiry_date end,
    updated_by = auth.uid(), updated_at = now()
  where id = p_id and is_deleted = false;

  perform public.civ_set_avail(p_id);

  -- حساب الفروق (قبل/بعد) للحقول المُدقَّقة فقط.
  v_old := to_jsonb(old);
  select to_jsonb(t) into v_new from public.custody_inventory_assets t where id = p_id;
  foreach k in array audited loop
    if (v_old->k) is distinct from (v_new->k) then
      if k = any(fin_fields) then
        v_changes_fin := v_changes_fin || jsonb_build_object('field', k, 'old', v_old->k, 'new', v_new->k);
      else
        v_changes := v_changes || jsonb_build_object('field', k, 'old', v_old->k, 'new', v_new->k);
      end if;
    end if;
  end loop;

  if v_changes <> '[]'::jsonb or v_changes_fin <> '[]'::jsonb then
    insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, changes_finance, reason)
      values (p_id, auth.uid(), 'update', v_changes, v_changes_fin, v_reason);
    perform public.civ_notify_managers('civ_asset_updated', p_id,
      'تعديل بيانات أصل: ' || old.asset_code, 'Asset updated: ' || old.asset_code);
  end if;
  return true;
exception
  when unique_violation then raise exception 'duplicate_value';   -- تعارض barcode/qr → رسالة ودّية
end; $$;

-- ─── 3.3) تصحيح المخزون — آمن (Owner/Super Admin/Admin فقط) ───
--     الوضعان: 'delta' (زيادة/نقص المتاح والإجمالي معًا) أو 'set_total' (إجمالي جديد،
--     يُشتقّ المتاح مع الحفاظ على المصروف/المحجوز/الصيانة). يقفل الصف FOR UPDATE،
--     ويمنع الكمية السالبة أو النزول تحت المصروف أو تضخيم المتاح.
create or replace function public.custody_inv_admin_correct_stock(
  p_asset uuid, p_mode text, p_value numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v_committed numeric; v_total numeric; v_avail numeric; v_reserved numeric;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  if p_value is null then raise exception 'value_required'; end if;
  select * into a from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  if a.id is null then raise exception 'not_found'; end if;
  if a.asset_type = 'serialized' then raise exception 'serialized_qty_fixed'; end if;

  v_committed := a.quantity_total - a.quantity_available;   -- مصروف+محجوز+صيانة (كل ما ليس متاحًا)

  if p_mode = 'delta' then
    v_total := a.quantity_total + p_value;
    v_avail := a.quantity_available + p_value;   -- الدلتا تمسّ المخزون المتاح فقط
  elsif p_mode = 'set_total' then
    if p_value < 0 then raise exception 'negative_quantity'; end if;
    v_total := p_value;
    v_avail := p_value - v_committed;             -- حافظ على المصروف/المحجوز/الصيانة
  else
    raise exception 'bad_mode';
  end if;

  if v_total < 0 then raise exception 'negative_total'; end if;
  if v_avail < 0 then raise exception 'below_committed'; end if;   -- لا تنزل تحت المصروف
  if v_avail > v_total then raise exception 'available_exceeds_total'; end if;
  -- الحجوزات محمولة داخل المتاح (soft-hold): لا تنزل بالمتاح تحت مجموع الحجوزات النشطة.
  select coalesce(sum(quantity),0) into v_reserved from public.custody_inventory_reservations where asset_id = p_asset and status = 'active';
  if v_avail < v_reserved then raise exception 'reserved_shortage'; end if;

  update public.custody_inventory_assets
    set quantity_total = v_total, quantity_available = v_avail, updated_by = auth.uid(), updated_at = now()
    where id = p_asset;
  perform public.civ_set_avail(p_asset);

  insert into public.custody_inventory_movements(
    asset_id, movement_type, quantity_before, quantity_change, quantity_after, reason, created_by)
    values (p_asset, 'manual_correction', a.quantity_available, v_avail - a.quantity_available, v_avail, trim(p_reason), auth.uid());
  insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
    values (p_asset, auth.uid(), 'stock_correction', jsonb_build_array(
      jsonb_build_object('field','quantity_total','old',a.quantity_total,'new',v_total),
      jsonb_build_object('field','quantity_available','old',a.quantity_available,'new',v_avail)), trim(p_reason));
  perform public.civ_notify_managers('civ_stock_correction', p_asset,
    'تصحيح مخزون: ' || a.asset_code, 'Stock correction: ' || a.asset_code);
  return jsonb_build_object('ok', true, 'quantity_total', v_total, 'quantity_available', v_avail);
end; $$;

-- ─── 3.4) تحصين adjust_stock القديمة (دفاع بالعمق — نفس التوقيع) ───
--     تُبقى للتوافق لكن تُصبح مضادّة للفساد: تمنع تضخيم المتاح والنزول تحت المصروف،
--     وتُقيَّد على civ_can_admin وتسجّل في سجل التغييرات.
create or replace function public.custody_inv_admin_adjust_stock(
  p_asset uuid, p_new_total numeric, p_new_available numeric, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare ast record; v_total numeric; v_avail numeric; v_committed numeric; v_reserved numeric;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  select * into ast from public.custody_inventory_assets where id = p_asset and is_deleted = false for update;
  if ast.id is null then raise exception 'not_found'; end if;
  v_total := coalesce(p_new_total, ast.quantity_total);
  v_avail := coalesce(p_new_available, ast.quantity_available);
  if v_total < 0 or v_avail < 0 then raise exception 'negative_quantity'; end if;
  if v_avail > v_total then raise exception 'available_exceeds_total'; end if;
  if ast.asset_type = 'serialized' and v_total <> 1 then raise exception 'serialized_total_must_be_1'; end if;
  v_committed := ast.quantity_total - ast.quantity_available;
  if v_total < v_committed then raise exception 'total_below_committed'; end if;
  if (v_avail - ast.quantity_available) > (v_total - ast.quantity_total) then raise exception 'cannot_inflate_available'; end if;
  -- الحجوزات النشطة محمولة داخل المتاح: امنع النزول بالمتاح تحتها.
  select coalesce(sum(quantity),0) into v_reserved from public.custody_inventory_reservations where asset_id = p_asset and status = 'active';
  if v_avail < v_reserved then raise exception 'reserved_shortage'; end if;
  update public.custody_inventory_assets set quantity_total = v_total, quantity_available = v_avail,
    updated_by = auth.uid(), updated_at = now() where id = p_asset;
  perform public.civ_set_avail(p_asset);
  insert into public.custody_inventory_movements(
    asset_id, movement_type, quantity_before, quantity_change, quantity_after, reason, created_by)
    values (p_asset, 'manual_correction', ast.quantity_available, v_avail - ast.quantity_available, v_avail, trim(p_reason), auth.uid());
  insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
    values (p_asset, auth.uid(), 'stock_correction', jsonb_build_array(
      jsonb_build_object('field','quantity_total','old',ast.quantity_total,'new',v_total),
      jsonb_build_object('field','quantity_available','old',ast.quantity_available,'new',v_avail)), trim(p_reason));
  perform public.civ_notify_managers('civ_stock_correction', p_asset,
    'تصحيح مخزون يدوي: ' || ast.asset_code, 'Manual stock correction: ' || ast.asset_code);
  return true;
end; $$;

-- ─── 3.5) قراءة سجل تغييرات الأصل (للمدراء) ───
create or replace function public.custody_inv_get_asset_changes(p_asset uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_fin boolean;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_fin := public.civ_can_finance();   -- الفروق المالية تُدمج فقط لأصحاب الصلاحية المالية
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'action', c.action,
      'changes', case when v_fin then (c.changes || c.changes_finance) else c.changes end,
      'reason', c.reason, 'created_at', c.created_at,
      'actor_id', c.actor_id, 'actor_name', (select full_name from public.profiles where id = c.actor_id))
      order by c.created_at desc)
    from public.custody_inventory_asset_changes c where c.asset_id = p_asset), '[]'::jsonb);
end; $$;

-- ─── 3.6) إضافة ملف/صورة أصل (يُبقي التوقيع؛ يضيف تسجيل التدقيق) ───
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
  insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
    values (p_asset, auth.uid(), 'image_added', jsonb_build_array(jsonb_build_object('field','file','old',null,'new',p_name)), null);
  return v_id;
end; $$;

-- ─── 3.7) أرشفة صورة/ملف أصل (soft delete — Owner/Admin) ───
create or replace function public.custody_inv_admin_archive_asset_file(p_file uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  select * into f from public.custody_inventory_asset_files where id = p_file and is_deleted = false;
  if f.id is null then raise exception 'not_found'; end if;
  update public.custody_inventory_asset_files set is_deleted = true, is_primary = false where id = p_file;
  insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
    values (f.asset_id, auth.uid(), 'image_archived', jsonb_build_array(jsonb_build_object('field','file','old',f.file_name,'new',null)), nullif(trim(p_reason),''));
  return true;
end; $$;

-- ─── 3.8) تعيين الصورة الأساسية للكتالوج (Owner/Admin) ───
create or replace function public.custody_inv_admin_set_primary_photo(p_file uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare f record;
begin
  if not public.civ_can_admin() then raise exception 'not authorized'; end if;
  select * into f from public.custody_inventory_asset_files where id = p_file and is_deleted = false;
  if f.id is null then raise exception 'not_found'; end if;
  update public.custody_inventory_asset_files set is_primary = false where asset_id = f.asset_id;
  update public.custody_inventory_asset_files set is_primary = true  where id = p_file;
  insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
    values (f.asset_id, auth.uid(), 'primary_image_changed', jsonb_build_array(jsonb_build_object('field','primary_image','old',null,'new',f.file_name)), null);
  return true;
end; $$;

-- ─── 4) الصلاحيات (revoke من العام؛ grant للموثّقين) ───
revoke execute on function public.custody_inv_get_asset_details(uuid)                 from public, anon;
revoke execute on function public.custody_inv_admin_update_asset(uuid,jsonb)          from public, anon;
revoke execute on function public.custody_inv_admin_correct_stock(uuid,text,numeric,text) from public, anon;
revoke execute on function public.custody_inv_admin_adjust_stock(uuid,numeric,numeric,text) from public, anon;
revoke execute on function public.custody_inv_get_asset_changes(uuid)                 from public, anon;
revoke execute on function public.custody_inv_attach_asset_file(uuid,text,text,text,text,bigint,text) from public, anon;
revoke execute on function public.custody_inv_admin_archive_asset_file(uuid,text)     from public, anon;
revoke execute on function public.custody_inv_admin_set_primary_photo(uuid)           from public, anon;

grant execute on function public.custody_inv_get_asset_details(uuid)                  to authenticated;
grant execute on function public.custody_inv_admin_update_asset(uuid,jsonb)           to authenticated;
grant execute on function public.custody_inv_admin_correct_stock(uuid,text,numeric,text)  to authenticated;
grant execute on function public.custody_inv_admin_adjust_stock(uuid,numeric,numeric,text) to authenticated;
grant execute on function public.custody_inv_get_asset_changes(uuid)                  to authenticated;
grant execute on function public.custody_inv_attach_asset_file(uuid,text,text,text,text,bigint,text) to authenticated;
grant execute on function public.custody_inv_admin_archive_asset_file(uuid,text)      to authenticated;
grant execute on function public.custody_inv_admin_set_primary_photo(uuid)            to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) تحقق (SELECT فقط — لا يغيّر بيانات)
-- ════════════════════════════════════════════════════════════════════════════
-- الجدول والعمود موجودان:
select 'asset_changes table' as check,
       to_regclass('public.custody_inventory_asset_changes') is not null as ok;
select 'is_primary column' as check,
       exists (select 1 from information_schema.columns
               where table_name='custody_inventory_asset_files' and column_name='is_primary') as ok;
-- الدوال موجودة:
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in (
  'custody_inv_get_asset_details','custody_inv_admin_update_asset','custody_inv_admin_correct_stock',
  'custody_inv_admin_adjust_stock','custody_inv_get_asset_changes','custody_inv_admin_archive_asset_file',
  'custody_inv_admin_set_primary_photo')
order by p.proname;
-- نوعا الإشعار مستخدمان وموجودان في CHECK (يجب ألا يرمي هذا خطأً عند الإدراج لاحقًا):
select 'civ_asset_updated + civ_stock_correction preserved' as note;
