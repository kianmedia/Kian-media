-- ════════════════════════════════════════════════════════════════════════════
-- Kian Portal — Custody Inventory: Employee Self-Service (PATCH)
-- ملف Patch مستقل idempotent. يُشغَّل بعد docs/portal_custody_inventory_system_v1_RUNME.sql.
-- لا يعدّل ملف الـ migration الأساسي ولا يلمس العهدة اليدوية القديمة/التأجير.
--
-- التحوّل: الموظف/المصور يصرف المعدات بنفسه فورًا (عهدة Active مباشرة، بلا موافقة
-- مسبقة) — بينما لا يُغلق الإرجاع إلا بعد فحص أمين العهدة/الأدمن/المالك.
-- كل صلاحيات الموظف عبر RPCs جديدة منفصلة (لا توسيع لأي RPC إدارة قائمة).
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 1) مراحل أدلة جديدة (نُبقي القديمة للتوافق) ───
alter table public.custody_inventory_evidence drop constraint if exists custody_inventory_evidence_evidence_stage_check;
alter table public.custody_inventory_evidence add constraint custody_inventory_evidence_evidence_stage_check
  check (evidence_stage in (
    'issue_admin','issue_employee','return_employee','return_inspection','damage','maintenance',
    'issue_item','issue_group','return_item','return_group','inspection_item'));

-- ─── 2) أعمدة اعتماد الفحص على رأس العهدة (idempotent) ───
alter table public.custody_inventory_assignments add column if not exists approved_by uuid references auth.users(id);
alter table public.custody_inventory_assignments add column if not exists approved_at timestamptz;
alter table public.custody_inventory_assignments add column if not exists issue_source text not null default 'admin'
  check (issue_source in ('admin','employee_self'));

-- ─── 2ب) تصحيح فهرس منع الصرف المزدوج ليقتصر على الأصل المتسلسل فقط ───
-- الفهرس الأساسي uq_civ_serialized_active_item كان يمنع أي أصل (حتى الكمي) من وجود
-- أكثر من بند نشط — فيكسر تعدّد حاملي الصنف الكمي. نُضيف عمود is_serialized (يُضبط
-- تلقائيًا بمُشغّل لكل إدراج) ونعيد بناء الفهرس بشرط is_serialized فقط.
alter table public.custody_inventory_assignment_items add column if not exists is_serialized boolean not null default false;
update public.custody_inventory_assignment_items i set is_serialized = true
  from public.custody_inventory_assets a where a.id = i.asset_id and a.asset_type = 'serialized' and i.is_serialized = false;
create or replace function public.civ_item_set_serialized() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  select coalesce((asset_type = 'serialized'), false) into new.is_serialized
    from public.custody_inventory_assets where id = new.asset_id;
  new.is_serialized := coalesce(new.is_serialized, false);
  return new;
end; $$;
drop trigger if exists trg_civ_item_serialized on public.custody_inventory_assignment_items;
create trigger trg_civ_item_serialized before insert on public.custody_inventory_assignment_items
  for each row execute function public.civ_item_set_serialized();
drop index if exists uq_civ_serialized_active_item;
create unique index if not exists uq_civ_serialized_active_item
  on public.custody_inventory_assignment_items(asset_id)
  where is_serialized and status in ('pending','active','return_requested','disputed');

-- ─── 3) نوع إشعار جديد للصرف الذاتي (إعادة إعلان القائمة كاملةً — لا حذف أي نوع) ───
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
  'civ_legacy_visibility_changed','civ_return_overdue','civ_warranty_expiring',
  'civ_self_issue'   -- جديد: صرف ذاتي بواسطة الموظف
));

commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 4) قراءة الأصول المتاحة للموظف (بلا كشف قيمة الشراء) — RPC آمن، is_staff فقط.
-- ════════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.custody_inv_employee_list_available(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;   -- العميل/lead ممنوع
  return coalesce((select jsonb_agg(row_to_json(x) order by x.asset_name) from (
    select a.id, a.asset_code, a.asset_name, a.serial_number, a.asset_type, a.quantity_available, a.unit,
           c.name as category, l.name as location,
           (select f.file_path from public.custody_inventory_asset_files f
             where f.asset_id = a.id and f.file_type = 'asset_photo' and f.is_deleted = false
             order by f.created_at asc limit 1) as photo_path
      from public.custody_inventory_assets a
      left join public.custody_inventory_categories c on c.id = a.category_id
      left join public.custody_inventory_locations l on l.id = a.warehouse_location_id
     where a.is_deleted = false and a.availability_status in ('available','partially_assigned') and a.quantity_available > 0
       and (nullif(trim(p_q),'') is null
            or a.asset_name ilike '%'||p_q||'%' or a.asset_code ilike '%'||p_q||'%'
            or coalesce(a.serial_number,'') ilike '%'||p_q||'%' or coalesce(c.name,'') ilike '%'||p_q||'%')
  ) x), '[]'::jsonb);
end; $$;
revoke execute on function public.custody_inv_employee_list_available(text) from public, anon;
grant  execute on function public.custody_inv_employee_list_available(text) to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 5) صرف ذاتي فوري بواسطة الموظف — عهدة Active مباشرة (بلا موافقة مسبقة).
--    الموظف = auth.uid() إلزامًا (لا يُمرَّر معرّف غيره). صورة لكل قطعة + صورة مجموعة.
--    Transaction + FOR UPDATE بترتيب asset_id يمنع السباق والصرف المزدوج.
-- p_data = { items:[{asset_id, quantity, condition_at_issue, item_photos:[path...]}],
--            group_photos:[path...], note }
-- ════════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.custody_inv_employee_self_issue(p_data jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_emp uuid := auth.uid(); v_empid uuid; v_no text; v_aid uuid;
        v_items jsonb; elem jsonb; v_path text; v_asset uuid; v_qty numeric; rec record;
        v_reserved numeric; v_count int := 0; v_name text;
begin
  if v_emp is null then raise exception 'unauthenticated'; end if;
  if not public.is_staff() then raise exception 'not authorized'; end if;   -- العميل/lead ممنوع تمامًا
  v_items := coalesce(p_data->'items','[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then raise exception 'items_required'; end if;
  if jsonb_array_length(coalesce(p_data->'group_photos','[]'::jsonb)) < 1 then raise exception 'group_photo_required'; end if;
  -- صورة إلزامية لكل قطعة.
  for elem in select value from jsonb_array_elements(v_items) loop
    if jsonb_array_length(coalesce(elem->'item_photos','[]'::jsonb)) < 1 then raise exception 'item_photo_required'; end if;
  end loop;

  select full_name into v_name from public.profiles where id = v_emp;
  if to_regclass('public.hr_employee_profiles') is not null then
    execute 'select id from public.hr_employee_profiles where user_id = $1 and is_deleted = false limit 1' into v_empid using v_emp;
  end if;

  v_no := public.civ_gen_no('CIV');
  insert into public.custody_inventory_assignments(
    assignment_number, employee_id, employee_user_id, assignment_type, purpose, issued_by,
    issued_at, employee_confirmed_at, status, issue_source, employee_note)
  values (v_no, v_empid, v_emp, 'field_task', nullif(trim(p_data->>'note'),''), v_emp,
    now(), now(), 'active', 'employee_self', nullif(trim(p_data->>'note'),''))
  returning id into v_aid;

  -- قفل الأصول بترتيب ثابت ثم الخصم.
  for elem in select value from jsonb_array_elements(v_items) order by (value->>'asset_id') loop
    v_asset := (elem->>'asset_id')::uuid;
    v_qty   := coalesce((elem->>'quantity')::numeric, 1);
    select * into rec from public.custody_inventory_assets where id = v_asset and is_deleted = false for update;
    if rec.id is null then raise exception 'asset_not_found'; end if;
    if rec.availability_status in ('maintenance','lost','retired') then raise exception 'asset_unavailable: %', rec.asset_code; end if;
    if rec.asset_type = 'serialized' then
      v_qty := 1;
      if exists (select 1 from public.custody_inventory_assignment_items
                 where asset_id = v_asset and status in ('pending','active','return_requested','disputed'))
        then raise exception 'asset_already_assigned: %', rec.asset_code; end if;
    end if;
    if v_qty <= 0 then raise exception 'bad_quantity'; end if;
    if v_qty > rec.quantity_available then raise exception 'insufficient_stock: % (متاح %)', rec.asset_code, rec.quantity_available; end if;
    select coalesce(sum(quantity),0) into v_reserved from public.custody_inventory_reservations
      where asset_id = v_asset and status = 'active' and (reserved_to is null or reserved_to >= now())
        and (employee_id is null or employee_id is distinct from v_emp);
    if (rec.quantity_available - v_qty) < v_reserved then raise exception 'reserved_shortage: %', rec.asset_code; end if;

    update public.custody_inventory_assets set quantity_available = quantity_available - v_qty where id = v_asset;
    perform public.civ_set_avail(v_asset);
    insert into public.custody_inventory_assignment_items(assignment_id, asset_id, quantity, condition_at_issue, status)
      values (v_aid, v_asset, v_qty, nullif(elem->>'condition_at_issue',''), 'active');
    insert into public.custody_inventory_movements(asset_id, assignment_id, movement_type, quantity_before, quantity_change, quantity_after,
        from_location_id, to_employee_id, condition_before, reason, created_by, reference_type, reference_id)
      values (v_asset, v_aid, 'issue_to_employee', rec.quantity_available, -v_qty, rec.quantity_available - v_qty,
        rec.warehouse_location_id, v_emp, rec.condition_status, 'صرف ذاتي ' || v_no, v_emp, 'assignment', v_aid);
    v_count := v_count + 1;
  end loop;

  -- ربط صور القطع (issue_item) بكل بند + صور المجموعة (issue_group) بالعهدة.
  for elem in select value from jsonb_array_elements(v_items) loop
    for v_path in select value from jsonb_array_elements_text(coalesce(elem->'item_photos','[]'::jsonb)) loop
      if split_part(v_path,'/',1) <> v_emp::text then raise exception 'bad_evidence_path'; end if;   -- المسار في مجلد الموظف
      insert into public.custody_inventory_evidence(assignment_id, assignment_item_id, asset_id, evidence_stage, file_path, uploaded_by)
      select v_aid, i.id, i.asset_id, 'issue_item', v_path, v_emp
        from public.custody_inventory_assignment_items i
       where i.assignment_id = v_aid and i.asset_id = (elem->>'asset_id')::uuid
       limit 1;
    end loop;
  end loop;
  for v_path in select value from jsonb_array_elements_text(coalesce(p_data->'group_photos','[]'::jsonb)) loop
    if split_part(v_path,'/',1) <> v_emp::text then raise exception 'bad_evidence_path'; end if;
    insert into public.custody_inventory_evidence(assignment_id, evidence_stage, file_path, uploaded_by)
      values (v_aid, 'issue_group', v_path, v_emp);
  end loop;

  -- إشعار: الموظف + أمناء العهدة/الأدمن/المالك (civ_notify_managers يشمل المالك عبر is_owner).
  perform public.civ_notify(v_emp, 'civ_self_issue', v_aid, 'تم صرف عهدتك رقم ' || v_no, 'Your custody ' || v_no || ' is issued');
  perform public.civ_notify_managers('civ_self_issue', v_aid,
    'صرف ذاتي جديد بواسطة ' || coalesce(v_name,'موظف') || ' — عهدة ' || v_no,
    'Self-issue by ' || coalesce(v_name,'employee') || ' — ' || v_no);
  return jsonb_build_object('ok', true, 'id', v_aid, 'assignment_number', v_no, 'items', v_count);
end; $$;
revoke execute on function public.custody_inv_employee_self_issue(jsonb) from public, anon;
grant  execute on function public.custody_inv_employee_self_issue(jsonb) to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 6) تقديم طلب إرجاع بواسطة الموظف — لا يعيد للمخزون ولا يغلق العهدة.
-- p_items = [{assignment_item_id, quantity, condition, note, item_photos:[path...]}]
--   condition ∈ good|has_notes|damaged|incomplete|missing ؛ الملاحظة إلزامية إن ≠ good.
-- p_group = { general_condition, note, group_photos:[path...] }
-- ════════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.custody_inv_employee_submit_return(p_assignment uuid, p_items jsonb, p_group jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_status text; elem jsonb; v_path text; v_item uuid; v_qty numeric; v_cond text; v_note text; rec record; v_count int := 0;
begin
  select employee_user_id, status into v_owner, v_status from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  if auth.uid() <> v_owner then raise exception 'not_your_assignment'; end if;
  if v_status not in ('active','partially_returned','rejected') then raise exception 'not_returnable'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;
  if jsonb_array_length(coalesce(p_group->'group_photos','[]'::jsonb)) < 1 then raise exception 'group_photo_required'; end if;

  for elem in select value from jsonb_array_elements(p_items) loop
    v_item := (elem->>'assignment_item_id')::uuid;
    v_qty  := coalesce((elem->>'quantity')::numeric, null);
    v_cond := nullif(elem->>'condition','');
    v_note := nullif(trim(elem->>'note'),'');
    select * into rec from public.custody_inventory_assignment_items where id = v_item and assignment_id = p_assignment;
    if rec.id is null then raise exception 'item_not_found'; end if;
    if v_qty is null then v_qty := rec.quantity - rec.quantity_returned; end if;
    if v_qty <= 0 or v_qty > (rec.quantity - rec.quantity_returned) then raise exception 'bad_return_quantity'; end if;
    if v_cond is null or v_cond not in ('good','has_notes','damaged','incomplete','missing') then raise exception 'condition_required'; end if;
    if v_cond <> 'good' and v_note is null then raise exception 'note_required_for_condition'; end if;
    if jsonb_array_length(coalesce(elem->'item_photos','[]'::jsonb)) < 1 then raise exception 'return_photo_required'; end if;

    update public.custody_inventory_assignment_items
      set status = 'return_requested', condition_at_return = v_cond, return_notes = v_note, updated_at = now()
      where id = v_item;
    for v_path in select value from jsonb_array_elements_text(elem->'item_photos') loop
      if split_part(v_path,'/',1) <> v_owner::text then raise exception 'bad_evidence_path'; end if;
      insert into public.custody_inventory_evidence(assignment_id, assignment_item_id, asset_id, evidence_stage, file_path, note, uploaded_by)
        values (p_assignment, v_item, rec.asset_id, 'return_item', v_path, v_note, v_owner);
    end loop;
    insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, from_employee_id, condition_after, reason, created_by)
      values (rec.asset_id, p_assignment, v_item, 'return_requested', v_owner, v_cond, 'طلب إرجاع (فحص معلّق)', v_owner);
    v_count := v_count + 1;
  end loop;
  for v_path in select value from jsonb_array_elements_text(coalesce(p_group->'group_photos','[]'::jsonb)) loop
    if split_part(v_path,'/',1) <> v_owner::text then raise exception 'bad_evidence_path'; end if;
    insert into public.custody_inventory_evidence(assignment_id, evidence_stage, file_path, note, uploaded_by)
      values (p_assignment, 'return_group', v_path, nullif(trim(p_group->>'note'),''), v_owner);
  end loop;

  update public.custody_inventory_assignments
    set status = 'return_requested', employee_note = coalesce(nullif(trim(p_group->>'note'),''), employee_note), updated_at = now()
    where id = p_assignment;
  perform public.civ_notify(v_owner, 'civ_return_requested', p_assignment, 'أُرسل طلب إرجاع عهدتك للفحص', 'Your return request was submitted');
  perform public.civ_notify_managers('civ_return_requested', p_assignment, 'طلب إرجاع عهدة بانتظار الفحص', 'Custody return awaiting inspection');
  return jsonb_build_object('ok', true, 'items', v_count);
end; $$;
revoke execute on function public.custody_inv_employee_submit_return(uuid,jsonb,jsonb) from public, anon;
grant  execute on function public.custody_inv_employee_submit_return(uuid,jsonb,jsonb) to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 7) فحص واعتماد الإرجاع (إدارة/أمين عهدة) — نسخة محسّنة لآلة الحالات:
--    كل البنود مرفوضة ⇒ العهدة 'rejected' (يعيدها الموظف)؛ بعضها مقبول ⇒ 'partially_returned'؛
--    كل البنود مُعالَجة ⇒ 'returned' (مغلقة). يقبل دليل الفحص inspection_item أو return_inspection.
--    يسجّل approved_by/approved_at. (يستبدل نسخة migration الأساسية — لا يوسّع أي صلاحية.)
-- ════════════════════════════════════════════════════════════════════════════
begin;
create or replace function public.custody_inv_admin_inspect_return(p_assignment uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_owner uuid; elem jsonb; v_item uuid; v_res text; v_qty numeric; rec record; ast record;
        v_accepted int := 0; v_resolved int := 0; v_rejected int := 0; v_open int; v_new_status text;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;

  for elem in select value from jsonb_array_elements(p_items) as t(value)
              order by (select asset_id from public.custody_inventory_assignment_items where id = (value->>'assignment_item_id')::uuid) loop
    v_item := (elem->>'assignment_item_id')::uuid;
    v_res  := elem->>'result';
    if v_res not in ('accepted_good','accepted_damaged','maintenance_required','missing','rejected_return','partial_return')
      then raise exception 'bad_result'; end if;
    select * into rec from public.custody_inventory_assignment_items where id = v_item and assignment_id = p_assignment;
    if rec.id is null then raise exception 'item_not_found'; end if;
    if rec.status <> 'return_requested' then raise exception 'item_not_pending_return'; end if;   -- لا يُفحَص إلا ما قدّمه الموظف للإرجاع
    if not exists (select 1 from public.custody_inventory_evidence
                   where assignment_item_id = v_item and evidence_stage in ('return_inspection','inspection_item') and is_deleted = false)
      then raise exception 'inspection_photo_required'; end if;
    v_qty := coalesce((elem->>'quantity')::numeric, rec.quantity - rec.quantity_returned);
    if v_qty <= 0 or v_qty > (rec.quantity - rec.quantity_returned) then raise exception 'bad_quantity'; end if;
    select * into ast from public.custody_inventory_assets where id = rec.asset_id for update;

    if v_res in ('accepted_good','accepted_damaged','partial_return') then
      update public.custody_inventory_assets set quantity_available = quantity_available + v_qty,
        condition_status = case when v_res = 'accepted_damaged' then 'damaged' else condition_status end,
        warehouse_location_id = coalesce(nullif(elem->>'to_location_id','')::uuid, warehouse_location_id) where id = ast.id;
      perform public.civ_set_avail(ast.id);
      update public.custody_inventory_assignment_items set quantity_returned = quantity_returned + v_qty, returned_at = now(),
        return_notes = coalesce(nullif(elem->>'note',''), return_notes),
        status = case when (quantity_returned + v_qty) >= quantity then 'returned' else 'return_requested' end, updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, quantity_before, quantity_change, quantity_after, from_employee_id, condition_after, reason, created_by)
        values (ast.id, p_assignment, v_item, case when v_res='partial_return' then 'partial_return' else 'return_to_stock' end,
          ast.quantity_available, v_qty, ast.quantity_available + v_qty, v_owner,
          case when v_res='accepted_damaged' then 'damaged' else ast.condition_status end, coalesce(nullif(elem->>'note',''),'قبول إرجاع'), auth.uid());
      v_accepted := v_accepted + 1;

    elsif v_res = 'maintenance_required' then
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
      v_resolved := v_resolved + 1;

    elsif v_res = 'missing' then
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
      v_resolved := v_resolved + 1;

    else -- rejected_return: يبقى على الموظف ليصححه ويعيد الإرسال
      update public.custody_inventory_assignment_items set status = 'active',
        return_notes = coalesce(nullif(elem->>'note',''), return_notes), updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, from_employee_id, reason, created_by)
        values (rec.asset_id, p_assignment, v_item, 'manual_correction', v_owner, coalesce(nullif(elem->>'note',''),'رفض إرجاع — إعادة للموظف'), auth.uid());
      v_rejected := v_rejected + 1;
    end if;
  end loop;

  -- آلة الحالات (من تاريخ العهدة كاملًا لا من عدّادات هذا النداء فقط):
  --   لا بنود مفتوحة ⇒ مغلقة؛ وُجد بند مُعالَج (أُرجع/تلف/مفقود) ⇒ جزئية؛ وإلا رفض.
  select count(*) into v_open from public.custody_inventory_assignment_items
    where assignment_id = p_assignment and status in ('pending','active','return_requested','disputed');
  v_new_status := case
    when v_open = 0 then 'returned'
    when exists (select 1 from public.custody_inventory_assignment_items
                 where assignment_id = p_assignment and status in ('returned','damaged','missing')) then 'partially_returned'
    else 'rejected' end;
  update public.custody_inventory_assignments
    set status = v_new_status,
        approved_by = case when v_new_status in ('returned','partially_returned') then auth.uid() else approved_by end,
        approved_at = case when v_new_status in ('returned','partially_returned') then now() else approved_at end,
        updated_at = now()
    where id = p_assignment;

  if v_new_status = 'rejected' then
    perform public.civ_notify(v_owner, 'civ_return_rejected', p_assignment, 'رُفض طلب إرجاع عهدتك — يرجى التصحيح وإعادة الإرسال', 'Your return was rejected — please correct and resubmit');
  else
    perform public.civ_notify(v_owner, 'civ_return_accepted', p_assignment, 'تم فحص إرجاع عهدتك', 'Your custody return was inspected');
  end if;
  perform public.civ_notify_managers('civ_return_inspected', p_assignment, 'تم فحص إرجاع عهدة', 'Custody return inspected');
  return jsonb_build_object('ok', true, 'status', v_new_status, 'accepted', v_accepted, 'resolved', v_resolved, 'rejected', v_rejected, 'closed', v_new_status = 'returned');
end; $$;
grant execute on function public.custody_inv_admin_inspect_return(uuid,jsonb) to authenticated;
commit;

-- ════════════════════════════════════════════════════════════════════════════
-- 8) Storage — الموظف يقرأ صور الكتالوج فقط (مجلد asset_photo)، لا الفواتير/الضمانات/
--    وثائق الشراء (تبقى للإدارة فقط عبر civ_can_manage). المسار {assetId}/{fileType}/...
--    فـ foldername(name)[2] = نوع الملف. الرفع يبقى للإدارة فقط.
-- ════════════════════════════════════════════════════════════════════════════
begin;
drop policy if exists "civ assets bucket read" on storage.objects;
create policy "civ assets bucket read" on storage.objects for select to authenticated
  using (bucket_id = 'custody-inventory-assets'
         and (public.civ_can_manage()
              or (public.is_staff() and (storage.foldername(name))[2] = 'asset_photo')));
commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION
-- 1) الدوال الثلاث الجديدة موجودة:
select proname from pg_proc where proname in
  ('custody_inv_employee_list_available','custody_inv_employee_self_issue','custody_inv_employee_submit_return') order by proname;
-- 2) مراحل الأدلة الجديدة ضمن CHECK:
select conname from pg_constraint where conname = 'custody_inventory_evidence_evidence_stage_check';
-- 3) نوع civ_self_issue ضمن CHECK notifications:
select 1 where exists (select 1 from pg_constraint where conname='notifications_type_check');
-- 4) أعمدة الاعتماد + مصدر الصرف مضافة:
select column_name from information_schema.columns
 where table_name='custody_inventory_assignments' and column_name in ('approved_by','approved_at','issue_source') order by column_name;
-- 5) لا كمية متاحة سالبة:
select count(*) as bad_qty from public.custody_inventory_assets where quantity_available < 0 or quantity_available > quantity_total;
-- 6) لا صرف مزدوج نشط لأصل متسلسل:
select count(*) as dup_serialized from (
  select i.asset_id from public.custody_inventory_assignment_items i
  join public.custody_inventory_assets a on a.id=i.asset_id
  where a.asset_type='serialized' and i.status in ('pending','active','return_requested','disputed')
  group by i.asset_id having count(*) > 1) d;
-- ════════════════════════════════════════════════════════════════════════════
