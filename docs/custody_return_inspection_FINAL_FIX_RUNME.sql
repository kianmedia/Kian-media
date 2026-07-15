-- ════════════════════════════════════════════════════════════════════════════
-- HOTFIX — فحص وإرجاع العهدة (custody_inventory) — نهائي، Idempotent، غير هدّام.
-- يعالج مشكلتين حيّتين:
--   (1) «تعذّر تنفيذ الفحص» عند ضغط «اعتماد الفحص»: النسخة الحالية من
--       custody_inv_admin_inspect_return تشترط صورة فحص لكل قطعة (inspection_photo_required)
--       بينما واجهة الأدمن لا ترفع أي صورة فحص إطلاقًا → كل نداء يفشل.
--   (2) لا انتقال واضح return_requested → under_inspection (كان الفحص يقفز مباشرة).
--
-- هذا الملف:
--   • يضيف أعمدة رأس العهدة (returned_at, inspection_started_at/by) — idempotent.
--   • RPC بدء الفحص: custody_inv_admin_start_inspection (return_requested → under_inspection).
--   • يعيد تعريف RPC اعتماد الفحص custody_inv_admin_inspect_return بتوقيع واحد فقط
--     (uuid, jsonb) — نفس ما تستدعيه الواجهة — مع منطق أدلّة واقعي:
--       - صورة فحص إجمالية إلزامية عند وجود أي قبول/معالجة.
--       - صورة فحص لكل قطعة فقط عند ضرر/صيانة/فقد/إرجاع جزئي (لا للسليمة ولا للرفض).
--       - حدّ إرجاع المخزون least(quantity_total, available + qty) — لا تجاوز للسقف.
--       - منع Double Return عبر حصر البنود في status='return_requested' وقفل FOR UPDATE.
--       - الحالة النهائية returned (+returned_at) عند اكتمال الجميع، وإلا partially_returned/rejected.
--   • لا يلمس التأجير ولا المشاريع ولا أي نظام آخر. لا حذف بيانات. لا Foundation. لا fixtures.
--
-- آلة الحالات الفعلية (custody_inventory_assignments):
--   pending_employee_confirmation → active → return_requested → under_inspection → returned
--   (وجزئيًا: under_inspection → partially_returned). لا يوجد inspection_pending ولا closed.
-- ════════════════════════════════════════════════════════════════════════════

begin;

-- ─── 0) أعمدة رأس العهدة (idempotent — لا تُنشأ إن وُجدت) ───
alter table public.custody_inventory_assignments add column if not exists returned_at           timestamptz;
alter table public.custody_inventory_assignments add column if not exists inspection_started_at timestamptz;
alter table public.custody_inventory_assignments add column if not exists inspection_started_by uuid references auth.users(id);

-- تنظيف أي overload قديم قد يُربك PostgREST (نبقي توقيعًا واحدًا فقط: uuid,jsonb).
drop function if exists public.custody_inv_admin_inspect_return(uuid, jsonb, text);

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) بدء فحص الإرجاع — return_requested → under_inspection
--    owner/super_admin/admin/manager/custody_officer (civ_can_manage). Idempotent:
--    إن كانت العهدة تحت الفحص أصلًا يعيد ok دون تغيير (يمنع الأثر المكرّر).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.custody_inv_admin_start_inspection(p_assignment uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select * into r from public.custody_inventory_assignments where id = p_assignment and is_deleted = false for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status = 'under_inspection' then
    return jsonb_build_object('ok', true, 'status', 'under_inspection', 'noop', true);
  end if;
  if r.status <> 'return_requested' then raise exception 'not_returnable'; end if;

  update public.custody_inventory_assignments
     set status = 'under_inspection',
         inspection_started_at = now(),
         inspection_started_by = auth.uid(),
         custodian_note = coalesce(nullif(btrim(p_note),''), custodian_note),
         updated_at = now()
   where id = p_assignment;

  perform public.civ_notify(r.employee_user_id, 'civ_return_inspected', p_assignment,
    'بدأ فحص إرجاع عهدتك '||coalesce(r.assignment_number,''), 'Inspection of your custody return has started');
  perform public.civ_notify_managers('civ_return_inspected', p_assignment,
    'بدء فحص إرجاع عهدة '||coalesce(r.assignment_number,''), 'Custody return inspection started '||coalesce(r.assignment_number,''));
  return jsonb_build_object('ok', true, 'status', 'under_inspection');
end $$;
revoke all on function public.custody_inv_admin_start_inspection(uuid,text) from public, anon;
grant  execute on function public.custody_inv_admin_start_inspection(uuid,text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2) اعتماد الفحص وإكمال الإرجاع — التوقيع الوحيد (p_assignment uuid, p_items jsonb)
--    p_items = [{assignment_item_id, result, quantity?, note?, to_location_id?}, ...]
--    result ∈ accepted_good | accepted_damaged | maintenance_required | missing
--            | rejected_return | partial_return
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function public.custody_inv_admin_inspect_return(p_assignment uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_status text; elem jsonb; v_item uuid; v_res text; v_qty numeric; v_new numeric;
  rec record; ast record; v_has_accept boolean;
  v_accepted int := 0; v_resolved int := 0; v_rejected int := 0; v_open int; v_new_status text;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;

  -- قفل رأس العهدة (يمنع تنفيذين متوازيين على نفس العهدة).
  select employee_user_id, status into v_owner, v_status
    from public.custody_inventory_assignments where id = p_assignment and is_deleted = false for update;
  if v_owner is null then raise exception 'not_found'; end if;
  if v_status not in ('return_requested','under_inspection','partially_returned') then raise exception 'not_inspectable'; end if;

  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;

  -- هل يوجد أي بند مقبول/معالَج (أي نتيجة غير rejected_return)؟ إن نعم تلزم صورة فحص إجمالية.
  select bool_or((value->>'result') is distinct from 'rejected_return') into v_has_accept
    from jsonb_array_elements(p_items) as t(value);
  if coalesce(v_has_accept,false) and not exists (
        select 1 from public.custody_inventory_evidence
         where assignment_id = p_assignment and evidence_stage in ('return_inspection','inspection_item') and is_deleted = false)
    then raise exception 'overall_inspection_photo_required'; end if;

  for elem in select value from jsonb_array_elements(p_items) as t(value)
              order by (select asset_id from public.custody_inventory_assignment_items where id = (value->>'assignment_item_id')::uuid) loop
    v_item := (elem->>'assignment_item_id')::uuid;
    v_res  := elem->>'result';
    if v_res not in ('accepted_good','accepted_damaged','maintenance_required','missing','rejected_return','partial_return')
      then raise exception 'bad_result'; end if;

    select * into rec from public.custody_inventory_assignment_items where id = v_item and assignment_id = p_assignment for update;
    if rec.id is null then raise exception 'item_not_found'; end if;
    if rec.status <> 'return_requested' then raise exception 'item_not_pending_return'; end if;  -- يُفحَص فقط ما قُدّم للإرجاع (منع Double Return)

    -- صورة فحص لكل قطعة إلزامية فقط عند اختلاف/ضرر (لا للسليمة ولا للرفض).
    if v_res in ('accepted_damaged','maintenance_required','missing','partial_return')
       and not exists (select 1 from public.custody_inventory_evidence
                       where assignment_item_id = v_item and evidence_stage in ('return_inspection','inspection_item') and is_deleted = false)
      then raise exception 'item_inspection_photo_required'; end if;

    v_qty := coalesce(nullif(elem->>'quantity','')::numeric, rec.quantity - rec.quantity_returned);
    if v_qty <= 0 or v_qty > (rec.quantity - rec.quantity_returned) then raise exception 'bad_quantity'; end if;

    select * into ast from public.custody_inventory_assets where id = rec.asset_id for update;

    if v_res in ('accepted_good','accepted_damaged','partial_return') then
      v_new := least(ast.quantity_total, ast.quantity_available + v_qty);   -- حدّ السقف: لا تجاوز quantity_total
      update public.custody_inventory_assets set quantity_available = v_new,
        condition_status = case when v_res = 'accepted_damaged' then 'damaged' else condition_status end,
        warehouse_location_id = coalesce(nullif(elem->>'to_location_id','')::uuid, warehouse_location_id) where id = ast.id;
      perform public.civ_set_avail(ast.id);
      update public.custody_inventory_assignment_items set quantity_returned = quantity_returned + v_qty, returned_at = now(),
        condition_at_return = case when v_res='accepted_damaged' then 'damaged' else coalesce(condition_at_return,'good') end,
        return_notes = coalesce(nullif(elem->>'note',''), return_notes),
        status = case when (quantity_returned + v_qty) >= quantity then 'returned' else 'return_requested' end, updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, quantity_before, quantity_change, quantity_after, from_employee_id, condition_after, reason, created_by)
        values (ast.id, p_assignment, v_item, case when v_res='partial_return' then 'partial_return' else 'return_to_stock' end,
          ast.quantity_available, v_new - ast.quantity_available, v_new, v_owner,
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

    else -- rejected_return: يعود البند لعهدة الموظف ليصحّح ويعيد الإرسال (لا يعود للمخزون).
      update public.custody_inventory_assignment_items set status = 'active',
        return_notes = coalesce(nullif(elem->>'note',''), return_notes), updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, from_employee_id, reason, created_by)
        values (rec.asset_id, p_assignment, v_item, 'manual_correction', v_owner, coalesce(nullif(elem->>'note',''),'رفض إرجاع — إعادة للموظف'), auth.uid());
      v_rejected := v_rejected + 1;
    end if;
  end loop;

  -- آلة الحالات من تاريخ العهدة كاملًا + عدّادات هذا النداء:
  --   لا بنود مفتوحة ⇒ مُرجعة. وُجد أي قبول/معالجة هذه الجولة (حتى لو جزئيًا فبقي البند
  --   مفتوحًا) أو بند نهائي (مُرجع/تالف/مفقود) ⇒ إرجاع جزئي. وإلا (كل البنود رُفضت) ⇒ مرفوضة.
  select count(*) into v_open from public.custody_inventory_assignment_items
    where assignment_id = p_assignment and status in ('pending','active','return_requested','disputed');
  v_new_status := case
    when v_open = 0 then 'returned'
    when (v_accepted + v_resolved) > 0
      or exists (select 1 from public.custody_inventory_assignment_items
                 where assignment_id = p_assignment and status in ('returned','damaged','missing')) then 'partially_returned'
    else 'rejected' end;

  update public.custody_inventory_assignments
    set status = v_new_status,
        returned_at = case when v_new_status = 'returned' then now() else returned_at end,
        approved_by = case when v_new_status in ('returned','partially_returned') then auth.uid() else approved_by end,
        approved_at = case when v_new_status in ('returned','partially_returned') then now() else approved_at end,
        updated_at = now()
    where id = p_assignment;

  if v_new_status = 'rejected' then
    perform public.civ_notify(v_owner, 'civ_return_rejected', p_assignment, 'رُفض طلب إرجاع عهدتك — صحّح وأعد الإرسال', 'Your return was rejected — correct and resubmit');
  else
    perform public.civ_notify(v_owner, 'civ_return_accepted', p_assignment, 'تم فحص إرجاع عهدتك', 'Your custody return was inspected');
  end if;
  perform public.civ_notify_managers('civ_return_inspected', p_assignment, 'تم فحص إرجاع عهدة', 'Custody return inspected');

  return jsonb_build_object('ok', true, 'status', v_new_status, 'accepted', v_accepted, 'resolved', v_resolved,
                            'rejected', v_rejected, 'closed', v_new_status = 'returned');
end $$;
revoke all on function public.custody_inv_admin_inspect_return(uuid,jsonb) from public, anon;
grant  execute on function public.custody_inv_admin_inspect_return(uuid,jsonb) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION (للقراءة فقط — شغّلها بعد التطبيق للتحقق)
-- ════════════════════════════════════════════════════════════════════════════
-- (أ) نسخة واحدة فقط من كل دالة + التوقيع + صلاحية authenticated:
select proname, pg_get_function_identity_arguments(oid) as args,
       has_function_privilege('authenticated', oid, 'execute') as auth_exec,
       has_function_privilege('anon', oid, 'execute')          as anon_exec
  from pg_proc
 where proname in ('custody_inv_admin_start_inspection','custody_inv_admin_inspect_return')
 order by proname;
-- المتوقع: صفّان فقط. anon_exec=false للاثنين. inspect_return توقيع واحد (uuid, jsonb).

-- (ب) الأعمدة الجديدة موجودة:
select column_name from information_schema.columns
 where table_name = 'custody_inventory_assignments'
   and column_name in ('returned_at','inspection_started_at','inspection_started_by')
 order by column_name;

-- (ج) قيم النتائج المقبولة موثّقة هنا (تُفحَص داخل الدالة، لا CHECK منفصل):
--     accepted_good | accepted_damaged | maintenance_required | missing | rejected_return | partial_return
