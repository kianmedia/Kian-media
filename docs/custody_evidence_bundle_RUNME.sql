-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0: CUSTODY RETURN-INSPECTION EVIDENCE BUNDLE  (RUN ONCE)
--
-- Serves the COMPLETE evidence set for one custody assignment so the authorized
-- decision-maker can compare condition across all four groups per asset:
--   A) registered  = custody_inventory_asset_files (file_type='asset_photo', bucket
--      custody-inventory-assets)
--   B) issue        = custody_inventory_evidence stage issue_admin/issue_employee
--   C) return       = custody_inventory_evidence stage return_employee
--   D) inspection   = custody_inventory_evidence stage return_inspection (+ damage)
-- scope is DERIVED (assignment_item_id IS NULL → 'overall', else 'per_asset') — the
-- stage is NEVER inferred from the filename. Each image carries bucket + path (the
-- UI mints short-lived signed URLs via civSignFiles — no public URL), name, mime,
-- size, note, uploaded_by name + role (employee vs staff), uploaded_at, is_primary.
--
-- SERVER-SIDE ACCESS: civ_can_manage() (owner/admin/super-admin/manager/custody_officer)
-- OR the assignment's own employee. For the employee it REDACTS — only their own
-- issue/return evidence + employee-visible inspection note; no internal fields.
-- (Managers get the full set incl. per-item decisions.) Signed-URL minting stays on
-- the client against the two PRIVATE buckets; this RPC returns only paths.
--
-- Also adds custody_inv_request_more_evidence(assignment, note) — the inspector asks
-- the employee for additional evidence (portal + email via civ_notify).
--
-- Idempotent · non-destructive · no schema change (evidence table already carries
-- mime/size/uploaded_by/note/deleted_at). Depends on: custody_inventory_evidence,
-- custody_inventory_asset_files, custody_inventory_assignments/_items/_assets,
-- civ_can_manage(), civ_notify, profiles, staff_role().
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.custody_inventory_evidence')   is null then miss := miss || ' custody_inventory_evidence'; end if;
  if to_regclass('public.custody_inventory_asset_files') is null then miss := miss || ' custody_inventory_asset_files'; end if;
  if to_regprocedure('public.civ_can_manage()') is null then miss := miss || ' civ_can_manage()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- helper: one evidence group as jsonb (per item when p_item set, else overall). Redacts
-- for the employee: they only see their own uploads. Defined BEFORE the bundle that calls it.
create or replace function public.civ_evidence_json(p_assignment uuid, p_item uuid, p_stages text[], p_owner uuid, p_is_mgr boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'stage', e.evidence_stage,
      'scope', case when e.assignment_item_id is null then 'overall' else 'per_asset' end,
      'bucket', 'custody-inventory-evidence',
      'path', e.file_path, 'name', e.file_name, 'mime', e.mime_type, 'size', e.size_bytes, 'note', e.note,
      'uploaded_at', e.created_at,
      'uploaded_by_name', (select full_name from public.profiles where id = e.uploaded_by),
      'uploaded_by_role', case when e.uploaded_by = p_owner then 'employee' else 'staff' end
    ) order by e.created_at), '[]'::jsonb)
  from public.custody_inventory_evidence e
  where e.assignment_id = p_assignment
    and ((p_item is null and e.assignment_item_id is null) or e.assignment_item_id = p_item)
    and e.evidence_stage = any(p_stages)
    and e.is_deleted = false
    and (p_is_mgr or e.uploaded_by = p_owner);
$$;

create or replace function public.custody_inv_evidence_bundle(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_is_mgr boolean; v_is_emp boolean; v_items jsonb; v_overall jsonb;
begin
  select asg.*, (select full_name from public.profiles where id = asg.issued_by) as issued_by_name,
         (select full_name from public.profiles where id = asg.employee_user_id) as employee_name,
         (select project_name from public.projects where id = asg.project_id) as project_name
    into a from public.custody_inventory_assignments asg where asg.id = p_assignment and asg.is_deleted = false;
  if a.id is null then raise exception 'not_found'; end if;
  v_is_mgr := public.civ_can_manage();
  v_is_emp := (auth.uid() = a.employee_user_id);
  if not (v_is_mgr or v_is_emp) then raise exception 'not authorized'; end if;

  -- per-asset groups
  select coalesce(jsonb_agg(row_to_json(x) order by x.asset_code), '[]'::jsonb) into v_items from (
    select
      i.id as item_id, i.asset_id, ast.asset_code, ast.asset_name, ast.serial_number, ast.qr_code_value,
      ast.brand, ast.model, ast.condition_status as registered_condition,
      (select name from public.custody_inventory_categories where id = ast.category_id) as category,
      i.quantity, i.quantity_returned, i.status as item_status,
      i.condition_at_issue, i.issue_notes, i.condition_at_return, i.return_notes, i.returned_at,
      -- A) registered images (assets bucket)
      (select coalesce(jsonb_agg(jsonb_build_object(
          'bucket','custody-inventory-assets','path',f.file_path,'name',f.file_name,'mime',f.mime_type,
          'size',f.size_bytes,'description',f.description,'is_primary',coalesce(f.is_primary,false),
          'uploaded_at',f.created_at,'uploaded_by_name',(select full_name from public.profiles where id=f.uploaded_by),
          'uploaded_by_role','staff') order by coalesce(f.is_primary,false) desc, f.created_at), '[]'::jsonb)
        from public.custody_inventory_asset_files f
        where f.asset_id = i.asset_id and f.file_type = 'asset_photo' and f.is_deleted = false) as registered_images,
      -- B) issue evidence (per this item)
      public.civ_evidence_json(p_assignment, i.id, array['issue_admin','issue_employee'], a.employee_user_id, v_is_mgr) as issue_images,
      -- C) return evidence (per this item)
      public.civ_evidence_json(p_assignment, i.id, array['return_employee'], a.employee_user_id, v_is_mgr) as return_images,
      -- D) inspection evidence (per this item) — managers only see inspection; employee sees none per-item
      case when v_is_mgr then public.civ_evidence_json(p_assignment, i.id, array['return_inspection','damage'], a.employee_user_id, v_is_mgr) else '[]'::jsonb end as inspection_images
    from public.custody_inventory_assignment_items i
    join public.custody_inventory_assets ast on ast.id = i.asset_id
    where i.assignment_id = p_assignment
  ) x;

  -- overall (assignment-level) groups
  v_overall := jsonb_build_object(
    'issue',      public.civ_evidence_json(p_assignment, null, array['issue_admin','issue_employee'], a.employee_user_id, v_is_mgr),
    'return',     public.civ_evidence_json(p_assignment, null, array['return_employee'], a.employee_user_id, v_is_mgr),
    'inspection', case when v_is_mgr then public.civ_evidence_json(p_assignment, null, array['return_inspection','damage'], a.employee_user_id, v_is_mgr) else '[]'::jsonb end);

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', a.id, 'number', a.assignment_number, 'status', a.status, 'assignment_type', a.assignment_type,
      'employee_user_id', a.employee_user_id, 'employee_name', a.employee_name, 'project_name', a.project_name,
      'issued_at', a.issued_at, 'issued_by_name', a.issued_by_name,
      'accepted_at', a.employee_confirmed_at, 'ack_name', a.ack_name, 'expected_return_at', a.expected_return_at),
    'items', v_items,
    'overall', v_overall,
    'is_manager', v_is_mgr);
end $$;

-- الفاحص يطلب أدلة إضافية من الموظف (إشعار منصّة + بريد).
create or replace function public.custody_inv_request_more_evidence(p_assignment uuid, p_note text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_owner uuid;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  perform public.civ_notify(v_owner, 'custody_more_evidence_requested', p_assignment,
    'الإدارة تطلب أدلة/صورًا إضافية على عهدتك'||coalesce(': '||nullif(btrim(p_note),''),''),
    'Additional evidence is requested for your custody'||coalesce(': '||nullif(btrim(p_note),''),''));
  begin perform public.log_activity(auth.uid(), 'admin', 'custody.more_evidence_requested', 'custody_inventory', p_assignment, '{}'::jsonb); exception when others then null; end;
  return true;
end $$;

do $g$
declare f text;
begin
  execute 'revoke all on function public.civ_evidence_json(uuid,uuid,text[],uuid,boolean) from public, anon, authenticated';  -- internal helper
  foreach f in array array['public.custody_inv_evidence_bundle(uuid)','public.custody_inv_request_more_evidence(uuid,text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

do $v$
declare miss text := '';
begin
  if to_regprocedure('public.custody_inv_evidence_bundle(uuid)')          is null then miss := miss || ' custody_inv_evidence_bundle'; end if;
  if to_regprocedure('public.custody_inv_request_more_evidence(uuid,text)') is null then miss := miss || ' custody_inv_request_more_evidence'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
