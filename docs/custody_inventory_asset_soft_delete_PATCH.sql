-- ════════════════════════════════════════════════════════════════════════════
-- Kian — Custody Inventory: حذف/استعادة الأصل الآمن (Soft delete) — admin فقط (idempotent)
-- ────────────────────────────────────────────────────────────────────────────
-- • الحذف والاستعادة حصرًا لدور admin الحقيقي (account_type='admin' نشط) — ليس
--   super_admin ولا manager ولا custody_officer ولا أي دور آخر. مُنفَّذ في القاعدة.
-- • Soft delete فقط — لا hard delete: يبقى السجل والصور والحركات والعهد التاريخية.
-- • قواعد منع صارمة (عهدة/حجز/صيانة/جرد + وحدات enterprise إن وُجدت).
-- • لا يلمس: العهدة اليدوية القديمة، التأجير القديم، Zoho، الفواتير، عروض الأسعار.
-- يُشغَّل بعد: v1 + self_service + enterprise_00/01 + asset_editing (+ photos_backfill).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) أعمدة تتبّع الحذف/الاستعادة على الأصول (deleted_* موجودة مسبقًا) ───
alter table public.custody_inventory_assets add column if not exists previous_availability_status text;
alter table public.custody_inventory_assets add column if not exists restored_at   timestamptz;
alter table public.custody_inventory_assets add column if not exists restored_by   uuid references auth.users(id);
alter table public.custody_inventory_assets add column if not exists restore_reason text;

-- ─── 2) توسيع CHECK لأنواع أحداث سجل التغييرات (نملك هذا الجدول) ───
alter table public.custody_inventory_asset_changes drop constraint if exists custody_inventory_asset_changes_action_check;
alter table public.custody_inventory_asset_changes add constraint custody_inventory_asset_changes_action_check
  check (action in ('update','stock_correction','image_added','image_archived','primary_image_changed','asset_deleted','asset_restored'));

-- ─── 3) صلاحية الحذف: admin الحقيقي فقط ───
-- ملاحظة نموذج الأدوار: "admin" في هذا النظام = account_type='admin' (الحساب الإداري
-- الرئيسي). super_admin هو staff_role وليس admin ⇒ مستبعَد. لا نستخدم civ_can_admin/
-- civ_can_manage لأنهما يسمحان بأدوار أخرى. يجب: مسجّل دخول + نشط + account_type='admin'.
create or replace function public.civ_can_delete_asset() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and account_status = 'active' and account_type = 'admin'
  );
$$;
revoke execute on function public.civ_can_delete_asset() from public, anon;
grant  execute on function public.civ_can_delete_asset() to authenticated;

-- دالة صغيرة للواجهة: هل يملك المستخدم صلاحية الحذف؟
create or replace function public.custody_inv_can_delete() returns boolean
language sql stable security definer set search_path = public as $$
  select public.civ_can_delete_asset();
$$;
revoke execute on function public.custody_inv_can_delete() from public, anon;
grant  execute on function public.custody_inv_can_delete() to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) دوال الحذف/الاستعادة/القائمة
-- ════════════════════════════════════════════════════════════════════════════
begin;

-- ─── 4.1) حذف أصل (Soft delete) — admin فقط + قواعد منع + تدقيق ───
create or replace function public.custody_inv_admin_delete_asset(p_asset_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v_flag boolean;
begin
  -- صلاحية admin حصرًا — سجّل المحاولة المرفوضة (best-effort) ثم ارفض.
  if not public.civ_can_delete_asset() then
    begin
      perform public.custody_audit('asset_delete_denied', 'custody_inventory_asset', p_asset_id,
        jsonb_build_object('role', public.staff_role(), 'reason', 'not_admin'));
    exception when undefined_function then null; when others then null; end;
    raise exception 'permission_denied';
  end if;
  if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'reason_too_short'; end if;

  select * into a from public.custody_inventory_assets where id = p_asset_id and is_deleted = false for update;
  if a.id is null then raise exception 'not_found'; end if;

  -- ── قواعد المنع (أساسية — موجودة دائمًا) ──
  if exists (select 1 from public.custody_inventory_assignment_items i
             join public.custody_inventory_assignments asg on asg.id = i.assignment_id
             where i.asset_id = p_asset_id and i.status in ('pending','active','return_requested','disputed') and asg.is_deleted = false)
    then raise exception 'asset_on_active_custody'; end if;
  if exists (select 1 from public.custody_inventory_reservations where asset_id = p_asset_id and status = 'active')
    then raise exception 'asset_has_active_reservation'; end if;
  if exists (select 1 from public.custody_inventory_maintenance where asset_id = p_asset_id and status not in ('completed','cancelled'))
    then raise exception 'asset_in_open_maintenance'; end if;   -- allowlist: 'cancelled' هو أيضًا حالة منتهية
  if a.quantity_in_maintenance > 0 then raise exception 'asset_in_open_maintenance'; end if;
  if exists (select 1 from public.custody_inventory_audit_items ai
             join public.custody_inventory_audits au on au.id = ai.audit_id
             where ai.asset_id = p_asset_id and au.status in ('draft','in_progress'))
    then raise exception 'asset_in_open_audit'; end if;
  -- الأصل الكمي: لا كمية مصروفة/محجوزة/في الصيانة (المصروف = الإجمالي − المتاح − الصيانة).
  if a.asset_type = 'quantity_based' and (a.quantity_total - a.quantity_available - a.quantity_in_maintenance) > 0
    then raise exception 'asset_has_assigned_quantity'; end if;

  -- ── قواعد المنع (وحدات enterprise — تُفحص فقط إن كانت الجداول موجودة) ──
  if to_regclass('public.custody_incidents') is not null then
    -- allowlist للحالات المفتوحة فعليًا (converted_*/employee_liability/closed_no_action = منتهية).
    execute 'select exists(select 1 from public.custody_incidents where asset_id = $1 and status in (''open'',''under_review'',''legal_followup''))'
      into v_flag using p_asset_id;
    if v_flag then raise exception 'asset_has_open_incident'; end if;
  end if;
  if to_regclass('public.custody_rental_items') is not null then
    -- allowlist للتأجير الجاري (returned/damaged/missing = منتهية بعد التسوية).
    execute 'select exists(select 1 from public.custody_rental_items where asset_id = $1 and status in (''reserved'',''issued'',''return_requested'',''inspected''))'
      into v_flag using p_asset_id;
    if v_flag then raise exception 'asset_in_active_rental'; end if;
  end if;
  if to_regclass('public.custody_inventory_kit_items') is not null then
    execute 'select exists(select 1 from public.custody_inventory_kit_items where asset_id = $1 and is_deleted = false)'
      into v_flag using p_asset_id;
    if v_flag then raise exception 'asset_in_kit'; end if;
  end if;

  -- ── التنفيذ: soft delete — لا تصفير للكميات، لا حذف للسجل ──
  update public.custody_inventory_assets set
    is_deleted = true,
    previous_availability_status = availability_status,
    availability_status = 'retired',
    deleted_at = now(), deleted_by = auth.uid(), delete_reason = trim(p_reason),
    updated_by = auth.uid(), updated_at = now()
  where id = p_asset_id;

  -- إبطال QR تشغيليًا (إن وُجد عمود qr_status من enterprise_01) — مع حفظ سجل الإصدار.
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='custody_inventory_assets' and column_name='qr_status') then
    execute 'update public.custody_inventory_assets set qr_status = ''revoked'' where id = $1' using p_asset_id;
  end if;

  -- تدقيق: سجل التغييرات + سجل النشاط (best-effort).
  insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
    values (p_asset_id, auth.uid(), 'asset_deleted',
      jsonb_build_array(jsonb_build_object('field','availability_status','old', a.availability_status,'new','retired'),
                        jsonb_build_object('field','is_deleted','old', false,'new', true)), trim(p_reason));
  begin
    perform public.custody_audit('asset_deleted', 'custody_inventory_asset', p_asset_id,
      jsonb_build_object('asset_code', a.asset_code, 'reason', trim(p_reason)));
  exception when undefined_function then null; when others then null; end;

  return jsonb_build_object('ok', true, 'asset_code', a.asset_code);
end; $$;

-- ─── 4.2) استعادة أصل محذوف — admin فقط، لا تعود available تلقائيًا ───
create or replace function public.custody_inv_admin_restore_asset(p_asset_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record;
begin
  if not public.civ_can_delete_asset() then
    begin
      perform public.custody_audit('asset_restore_denied', 'custody_inventory_asset', p_asset_id,
        jsonb_build_object('role', public.staff_role()));
    exception when undefined_function then null; when others then null; end;
    raise exception 'permission_denied';
  end if;
  if length(trim(coalesce(p_reason,''))) < 10 then raise exception 'reason_too_short'; end if;

  select * into a from public.custody_inventory_assets where id = p_asset_id and is_deleted = true for update;
  if a.id is null then raise exception 'not_found_or_not_deleted'; end if;

  -- إعادة التحقق من التفرّد بين الأصول الحيّة (التسلسلي غير مقيّد بـUNIQUE؛ الباركود/الكود مقيّدان بالقاعدة).
  if a.serial_number is not null and exists (
       select 1 from public.custody_inventory_assets
       where serial_number = a.serial_number and id <> p_asset_id and is_deleted = false)
    then raise exception 'serial_in_use'; end if;
  if a.barcode is not null and exists (
       select 1 from public.custody_inventory_assets
       where barcode = a.barcode and id <> p_asset_id and is_deleted = false)
    then raise exception 'barcode_in_use'; end if;

  -- الاستعادة إلى حالة آمنة (retired) — تتطلّب مراجعة الأدمن قبل الإتاحة للصرف؛ لا available تلقائي.
  update public.custody_inventory_assets set
    is_deleted = false,
    availability_status = 'retired',
    restored_at = now(), restored_by = auth.uid(), restore_reason = trim(p_reason),
    updated_by = auth.uid(), updated_at = now()
  where id = p_asset_id;

  insert into public.custody_inventory_asset_changes(asset_id, actor_id, action, changes, reason)
    values (p_asset_id, auth.uid(), 'asset_restored',
      jsonb_build_array(jsonb_build_object('field','is_deleted','old', true,'new', false),
                        jsonb_build_object('field','availability_status','old','retired','new','retired')), trim(p_reason));
  begin
    perform public.custody_audit('asset_restored', 'custody_inventory_asset', p_asset_id,
      jsonb_build_object('asset_code', a.asset_code, 'reason', trim(p_reason)));
  exception when undefined_function then null; when others then null; end;

  return jsonb_build_object('ok', true, 'asset_code', a.asset_code);
end; $$;

-- ─── 4.3) قائمة الأصول المحذوفة — admin فقط ───
create or replace function public.custody_inv_admin_list_deleted_assets() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_delete_asset() then raise exception 'permission_denied'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'asset_code', a.asset_code, 'asset_name', a.asset_name, 'asset_type', a.asset_type,
      'serial_number', a.serial_number, 'quantity_total', a.quantity_total, 'quantity_available', a.quantity_available,
      'previous_availability_status', a.previous_availability_status, 'delete_reason', a.delete_reason,
      'deleted_at', a.deleted_at, 'deleted_by', a.deleted_by,
      'deleted_by_name', (select full_name from public.profiles where id = a.deleted_by))
      order by a.deleted_at desc nulls last)
    from public.custody_inventory_assets a where a.is_deleted = true), '[]'::jsonb);
end; $$;

-- ─── 4.4) تحصين archive القديمة إلى صلاحية الحذف (admin فقط) — كي لا يوجد مسار soft-delete آخر ───
create or replace function public.custody_inv_admin_archive_asset(p_id uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.civ_can_delete_asset() then raise exception 'permission_denied'; end if;
  if coalesce(trim(p_reason),'') = '' then raise exception 'reason_required'; end if;
  if exists (select 1 from public.custody_inventory_assignment_items i
              join public.custody_inventory_assignments a on a.id = i.assignment_id
             where i.asset_id = p_id and i.status in ('pending','active','return_requested','disputed') and a.is_deleted = false)
    then raise exception 'asset_on_active_custody'; end if;
  update public.custody_inventory_assets
    set is_deleted = true, previous_availability_status = availability_status, availability_status = 'retired',
        deleted_at = now(), deleted_by = auth.uid(), delete_reason = trim(p_reason)
    where id = p_id and is_deleted = false;
  if not found then raise exception 'not_found'; end if;
  return true;
end; $$;

-- ─── 4.5) تحديث تفاصيل الأصل: عرض الأصول المحذوفة أيضًا (للمراجعة) + منع تعديلها ───
create or replace function public.custody_inv_get_asset_details(p_asset uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a record; v_fin boolean; v_assigned numeric; v_reserved numeric; j jsonb;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into a from public.custody_inventory_assets where id = p_asset;   -- يشمل المحذوف (للمراجعة)
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
    'created_at', a.created_at, 'updated_at', a.updated_at, 'is_deleted', a.is_deleted, 'delete_reason', a.delete_reason,
    'created_by', a.created_by, 'created_by_name', (select full_name from public.profiles where id = a.created_by),
    'updated_by', a.updated_by, 'updated_by_name', (select full_name from public.profiles where id = a.updated_by),
    'can_edit', (public.civ_can_admin() and not a.is_deleted), 'can_finance', v_fin,
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
revoke execute on function public.custody_inv_get_asset_details(uuid) from public, anon;
grant  execute on function public.custody_inv_get_asset_details(uuid) to authenticated;

-- ─── 5) الصلاحيات ───
revoke execute on function public.custody_inv_admin_delete_asset(uuid,text)  from public, anon;
revoke execute on function public.custody_inv_admin_restore_asset(uuid,text) from public, anon;
revoke execute on function public.custody_inv_admin_list_deleted_assets()    from public, anon;
grant  execute on function public.custody_inv_admin_delete_asset(uuid,text)  to authenticated;
grant  execute on function public.custody_inv_admin_restore_asset(uuid,text) to authenticated;
grant  execute on function public.custody_inv_admin_list_deleted_assets()    to authenticated;

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) تحقق (SELECT فقط)
-- ════════════════════════════════════════════════════════════════════════════
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in
  ('civ_can_delete_asset','custody_inv_can_delete','custody_inv_admin_delete_asset',
   'custody_inv_admin_restore_asset','custody_inv_admin_list_deleted_assets')
order by p.proname;
select 'previous_availability_status col' as check,
       exists (select 1 from information_schema.columns
               where table_name='custody_inventory_assets' and column_name='previous_availability_status') as ok;
