-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-6/P0-7: INSPECTION PHOTO RULES BY ACTOR (admin bypass)  (RUN ONCE)
--
-- Rule (server-side):
--   • Custody Manager (civ_can_manage but NOT civ_can_admin): inspection photo stays
--     MANDATORY — per changed/damaged item + one overall when any item is accepted.
--   • Admin / Owner / Super Admin (civ_can_admin): the inspection photo is OPTIONAL —
--     they may complete the decision WITHOUT a new inspection photo, but ONLY with a
--     non-empty decision reason (p_reason), and the bypass is AUDITED
--     (log_activity 'custody.inspection_photo_bypassed').
--
-- This is a faithful CREATE OR REPLACE of custody_inv_admin_inspect_return — body
-- COPIED verbatim from custody_return_inspection_FINAL_FIX_RUNME.sql:76-204 with
-- only: (1) new p_reason param, (2) the two photo-required checks relaxed for admins
-- with a reason, (3) an audit event on bypass. All stock/maintenance/lost/state-
-- machine logic is unchanged. The old 2-arg signature is dropped so PostgREST has a
-- single unambiguous function; 2-arg callers resolve to the new default (p_reason
-- null → managers still require photos).
--
-- Idempotent · non-destructive · preserves all data + audit. Depends on the inspect
-- RPC being present (custody_return_inspection_FINAL_FIX_RUNME.sql), civ_can_admin(),
-- log_activity.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regprocedure('public.custody_inv_admin_inspect_return(uuid,jsonb)') is null
     and to_regprocedure('public.custody_inv_admin_inspect_return(uuid,jsonb,text)') is null
    then miss := miss || ' custody_inv_admin_inspect_return (شغّل custody_return_inspection_FINAL_FIX أولًا)'; end if;
  if to_regprocedure('public.civ_can_admin()') is null then miss := miss || ' civ_can_admin()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- single unambiguous signature: drop the legacy 2-arg, create the 3-arg.
drop function if exists public.custody_inv_admin_inspect_return(uuid,jsonb);

create or replace function public.custody_inv_admin_inspect_return(p_assignment uuid, p_items jsonb, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid; v_status text; elem jsonb; v_item uuid; v_res text; v_qty numeric; v_new numeric;
  rec record; ast record; v_has_accept boolean;
  v_accepted int := 0; v_resolved int := 0; v_rejected int := 0; v_open int; v_new_status text;
  v_admin boolean; v_can_bypass boolean; v_bypassed boolean := false;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  v_admin := public.civ_can_admin();
  v_can_bypass := v_admin and coalesce(btrim(p_reason),'') <> '';   -- P0-6: admin may skip the photo WITH a reason

  select employee_user_id, status into v_owner, v_status
    from public.custody_inventory_assignments where id = p_assignment and is_deleted = false for update;
  if v_owner is null then raise exception 'not_found'; end if;
  if v_status not in ('return_requested','under_inspection','partially_returned') then raise exception 'not_inspectable'; end if;

  if jsonb_typeof(coalesce(p_items,'[]'::jsonb)) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;

  select bool_or((value->>'result') is distinct from 'rejected_return') into v_has_accept
    from jsonb_array_elements(p_items) as t(value);
  if coalesce(v_has_accept,false) and not exists (
        select 1 from public.custody_inventory_evidence
         where assignment_id = p_assignment and evidence_stage in ('return_inspection','inspection_item') and is_deleted = false) then
    if v_can_bypass then v_bypassed := true; else raise exception 'overall_inspection_photo_required'; end if;
  end if;

  for elem in select value from jsonb_array_elements(p_items) as t(value)
              order by (select asset_id from public.custody_inventory_assignment_items where id = (value->>'assignment_item_id')::uuid) loop
    v_item := (elem->>'assignment_item_id')::uuid;
    v_res  := elem->>'result';
    if v_res not in ('accepted_good','accepted_damaged','maintenance_required','missing','rejected_return','partial_return')
      then raise exception 'bad_result'; end if;

    select * into rec from public.custody_inventory_assignment_items where id = v_item and assignment_id = p_assignment for update;
    if rec.id is null then raise exception 'item_not_found'; end if;
    if rec.status <> 'return_requested' then raise exception 'item_not_pending_return'; end if;

    if v_res in ('accepted_damaged','maintenance_required','missing','partial_return')
       and not exists (select 1 from public.custody_inventory_evidence
                       where assignment_item_id = v_item and evidence_stage in ('return_inspection','inspection_item') and is_deleted = false) then
      if v_can_bypass then v_bypassed := true; else raise exception 'item_inspection_photo_required'; end if;
    end if;

    v_qty := coalesce(nullif(elem->>'quantity','')::numeric, rec.quantity - rec.quantity_returned);
    if v_qty <= 0 or v_qty > (rec.quantity - rec.quantity_returned) then raise exception 'bad_quantity'; end if;

    select * into ast from public.custody_inventory_assets where id = rec.asset_id for update;

    if v_res in ('accepted_good','accepted_damaged','partial_return') then
      v_new := least(ast.quantity_total, ast.quantity_available + v_qty);
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

    else -- rejected_return
      update public.custody_inventory_assignment_items set status = 'active',
        return_notes = coalesce(nullif(elem->>'note',''), return_notes), updated_at = now() where id = v_item;
      insert into public.custody_inventory_movements(asset_id, assignment_id, assignment_item_id, movement_type, from_employee_id, reason, created_by)
        values (rec.asset_id, p_assignment, v_item, 'manual_correction', v_owner, coalesce(nullif(elem->>'note',''),'رفض إرجاع — إعادة للموظف'), auth.uid());
      v_rejected := v_rejected + 1;
    end if;
  end loop;

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

  -- P0-6/P0-7: audit an administrative photo bypass (with the required reason).
  if v_bypassed then
    begin perform public.log_activity(auth.uid(), 'admin', 'custody.inspection_photo_bypassed', 'custody_inventory', p_assignment,
      jsonb_build_object('reason', left(coalesce(p_reason,''),500), 'by_role', 'admin')); exception when others then null; end;
  end if;

  if v_new_status = 'rejected' then
    perform public.civ_notify(v_owner, 'civ_return_rejected', p_assignment, 'رُفض طلب إرجاع عهدتك — صحّح وأعد الإرسال', 'Your return was rejected — correct and resubmit');
  else
    perform public.civ_notify(v_owner, 'civ_return_accepted', p_assignment, 'تم فحص إرجاع عهدتك', 'Your custody return was inspected');
  end if;
  perform public.civ_notify_managers('civ_return_inspected', p_assignment, 'تم فحص إرجاع عهدة', 'Custody return inspected');

  return jsonb_build_object('ok', true, 'status', v_new_status, 'accepted', v_accepted, 'resolved', v_resolved,
                            'rejected', v_rejected, 'closed', v_new_status = 'returned', 'photo_bypassed', v_bypassed);
end $$;
revoke all on function public.custody_inv_admin_inspect_return(uuid,jsonb,text) from public, anon;
grant  execute on function public.custody_inv_admin_inspect_return(uuid,jsonb,text) to authenticated;

do $v$
begin
  if to_regprocedure('public.custody_inv_admin_inspect_return(uuid,jsonb,text)') is null then raise exception 'فشل: inspect_return(uuid,jsonb,text)'; end if;
  if to_regprocedure('public.custody_inv_admin_inspect_return(uuid,jsonb)') is not null then raise exception 'فشل: توقيع مزدوج (2-arg ما زال موجودًا)'; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
