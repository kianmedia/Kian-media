-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0: CUSTODY EVIDENCE BUNDLE STAGE-MAPPING FIX + BACKFILL  (RUN ONCE)
--
-- ROOT CAUSE (confirmed): the employee self-service flow
-- (portal_custody_inventory_employee_self_service_PATCH.sql) writes evidence with
-- the GRANULAR stages issue_item / issue_group / return_item / return_group /
-- inspection_item (the CHECK constraint was expanded to allow them). But
-- custody_inv_evidence_bundle queried ONLY the legacy stages (issue_admin,
-- issue_employee ; return_employee ; return_inspection, damage). So every photo an
-- employee uploaded via self-service issue/return was DROPPED by the bundle → the
-- issue and return comparison columns were empty even though the rows exist and are
-- correctly linked (issue_item/return_item carry assignment_item_id; the *_group
-- overall rows carry neither asset_id nor assignment_item_id).
--
-- Fix (no data rewrite of stages — legacy values preserved):
--   1) ONE normalization layer: civ_evidence_norm_stage(stage) → the four UI groups
--      (issue|return|inspection|other); civ_evidence_group() returns a group with an
--      EXPLICIT scope + safe unique-asset fallback (never filename-inferred).
--   2) custody_inv_evidence_bundle rewritten to map EVERY legacy + granular stage:
--        issue      ← issue_admin, issue_employee, issue_item, issue_group
--        return     ← return_employee, return_item, return_group
--        inspection ← return_inspection, inspection_item, damage
--      per-asset match = assignment_item_id = item OR (item_id null AND asset_id =
--      item.asset AND that asset is UNIQUE in the assignment); overall = item_id null
--      AND asset_id null; ambiguous asset-linked rows go to an 'unlinked' warning
--      section (never silently dropped).
--   3) custody_inv_evidence_diagnostics(assignment) — admin-only raw + normalized view.
--   4) BACKFILL: set assignment_item_id for rows with assignment_id + asset_id whose
--      asset matches EXACTLY ONE item (item_id currently null). Ambiguous/zero-match
--      rows are left untouched and reported. No stage/scope/path/uploader/time change.
--
-- Idempotent · non-destructive · preserves all evidence/paths/uploaders/timestamps/
-- audit. Depends on: custody_inventory_evidence/_assignment_items/_assets/_asset_files/
-- _assignments, civ_can_manage(), profiles.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.custody_inventory_evidence')         is null then miss := miss || ' custody_inventory_evidence'; end if;
  if to_regclass('public.custody_inventory_assignment_items') is null then miss := miss || ' custody_inventory_assignment_items'; end if;
  if to_regprocedure('public.civ_can_manage()') is null then miss := miss || ' civ_can_manage()'; end if;
  if to_regprocedure('public.custody_inv_evidence_bundle(uuid)') is null then miss := miss || ' custody_inv_evidence_bundle (شغّل custody_evidence_bundle_RUNME.sql أولًا)'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) طبقة التطبيع الوحيدة: مرحلة → مجموعة UI ═══
create or replace function public.civ_evidence_norm_stage(p_stage text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_stage in ('issue_admin','issue_employee','issue_item','issue_group','issue','receipt') then 'issue'
    when p_stage in ('return_employee','return_item','return_group','return','employee_return')    then 'return'
    when p_stage in ('return_inspection','inspection_item','inspection','damage')                  then 'inspection'
    else 'other' end;
$$;

-- ═══ 2) مجموعة أدلة كـ jsonb — ربط صريح بالبند/الأصل، بلا استنتاج من اسم الملف ═══
-- p_item set  → per-asset: assignment_item_id = item OR (item null AND asset match AND unique).
-- p_item null → overall  : assignment_item_id null AND asset_id null.
create or replace function public.civ_evidence_group(
  p_assignment uuid, p_item uuid, p_asset uuid, p_asset_unique boolean, p_stages text[], p_owner uuid, p_is_mgr boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'evidence_id', e.id, 'stage', e.evidence_stage, 'group', public.civ_evidence_norm_stage(e.evidence_stage),
      'scope', case when e.assignment_item_id is null and e.asset_id is null then 'overall' else 'per_asset' end,
      'assignment_id', e.assignment_id, 'assignment_item_id', e.assignment_item_id, 'asset_id', e.asset_id,
      'bucket', 'custody-inventory-evidence', 'path', e.file_path, 'name', e.file_name,
      'mime', e.mime_type, 'size', e.size_bytes, 'note', e.note, 'uploaded_at', e.created_at,
      'uploaded_by', e.uploaded_by,
      'uploaded_by_name', (select full_name from public.profiles where id = e.uploaded_by),
      'uploaded_by_role', case when e.uploaded_by = p_owner then 'employee' else 'staff' end
    ) order by e.created_at), '[]'::jsonb)
  from public.custody_inventory_evidence e
  where e.assignment_id = p_assignment
    and e.evidence_stage = any(p_stages)
    and e.is_deleted = false
    and (p_is_mgr or e.uploaded_by = p_owner)
    and (
      (p_item is null and e.assignment_item_id is null and e.asset_id is null)
      or (p_item is not null and (
            e.assignment_item_id = p_item
            or (e.assignment_item_id is null and p_asset is not null and e.asset_id = p_asset and p_asset_unique)))
    );
$$;

-- ═══ 3) الحزمة الكاملة — مراحل موسّعة + قسم "أدلة غير مربوطة" ═══
create or replace function public.custody_inv_evidence_bundle(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare a record; v_is_mgr boolean; v_is_emp boolean; v_items jsonb; v_overall jsonb; v_unlinked jsonb;
  ISSUE text[]  := array['issue_admin','issue_employee','issue_item','issue_group'];
  RET   text[]  := array['return_employee','return_item','return_group'];
  INSP  text[]  := array['return_inspection','inspection_item','damage'];
begin
  select asg.*, (select full_name from public.profiles where id = asg.issued_by) as issued_by_name,
         (select full_name from public.profiles where id = asg.employee_user_id) as employee_name,
         (select project_name from public.projects where id = asg.project_id) as project_name
    into a from public.custody_inventory_assignments asg where asg.id = p_assignment and asg.is_deleted = false;
  if a.id is null then raise exception 'not_found'; end if;
  v_is_mgr := public.civ_can_manage();
  v_is_emp := (auth.uid() = a.employee_user_id);
  if not (v_is_mgr or v_is_emp) then raise exception 'not authorized'; end if;

  select coalesce(jsonb_agg(row_to_json(x) order by x.asset_code), '[]'::jsonb) into v_items from (
    select
      i.id as item_id, i.asset_id, ast.asset_code, ast.asset_name, ast.serial_number, ast.qr_code_value,
      ast.brand, ast.model, ast.condition_status as registered_condition,
      (select name from public.custody_inventory_categories where id = ast.category_id) as category,
      i.quantity, i.quantity_returned, i.status as item_status,
      i.condition_at_issue, i.issue_notes, i.condition_at_return, i.return_notes, i.returned_at,
      (select coalesce(jsonb_agg(jsonb_build_object(
          'bucket','custody-inventory-assets','path',f.file_path,'name',f.file_name,'mime',f.mime_type,
          'size',f.size_bytes,'description',f.description,'is_primary',coalesce(f.is_primary,false),
          'uploaded_at',f.created_at,'uploaded_by_name',(select full_name from public.profiles where id=f.uploaded_by),
          'uploaded_by_role','staff') order by coalesce(f.is_primary,false) desc, f.created_at), '[]'::jsonb)
        from public.custody_inventory_asset_files f
        where f.asset_id = i.asset_id and f.file_type = 'asset_photo' and f.is_deleted = false) as registered_images,
      public.civ_evidence_group(p_assignment, i.id, i.asset_id, (u.n = 1), ISSUE, a.employee_user_id, v_is_mgr) as issue_images,
      public.civ_evidence_group(p_assignment, i.id, i.asset_id, (u.n = 1), RET,   a.employee_user_id, v_is_mgr) as return_images,
      case when v_is_mgr then public.civ_evidence_group(p_assignment, i.id, i.asset_id, (u.n = 1), INSP, a.employee_user_id, v_is_mgr) else '[]'::jsonb end as inspection_images
    from public.custody_inventory_assignment_items i
    join public.custody_inventory_assets ast on ast.id = i.asset_id
    join lateral (select count(*) as n from public.custody_inventory_assignment_items i2
                  where i2.assignment_id = p_assignment and i2.asset_id = i.asset_id) u on true
    where i.assignment_id = p_assignment
  ) x;

  v_overall := jsonb_build_object(
    'issue',      public.civ_evidence_group(p_assignment, null, null, false, ISSUE, a.employee_user_id, v_is_mgr),
    'return',     public.civ_evidence_group(p_assignment, null, null, false, RET,   a.employee_user_id, v_is_mgr),
    'inspection', case when v_is_mgr then public.civ_evidence_group(p_assignment, null, null, false, INSP, a.employee_user_id, v_is_mgr) else '[]'::jsonb end);

  -- unlinked: asset-tagged rows with no item link that don't map to exactly one item
  -- (ambiguous or foreign asset) — surfaced for admin, never silently dropped.
  if v_is_mgr then
    select coalesce(jsonb_agg(jsonb_build_object(
        'evidence_id', e.id, 'stage', e.evidence_stage, 'group', public.civ_evidence_norm_stage(e.evidence_stage),
        'asset_id', e.asset_id, 'bucket','custody-inventory-evidence','path', e.file_path, 'name', e.file_name,
        'uploaded_at', e.created_at, 'uploaded_by_name',(select full_name from public.profiles where id=e.uploaded_by),
        'reason', case when (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id = p_assignment and i.asset_id = e.asset_id) = 0
                       then 'asset_not_in_assignment' else 'ambiguous_multiple_items_same_asset' end) order by e.created_at), '[]'::jsonb)
      into v_unlinked
    from public.custody_inventory_evidence e
    where e.assignment_id = p_assignment and e.is_deleted = false
      and e.assignment_item_id is null and e.asset_id is not null
      and (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id = p_assignment and i.asset_id = e.asset_id) <> 1;
  else
    v_unlinked := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', a.id, 'number', a.assignment_number, 'status', a.status, 'assignment_type', a.assignment_type,
      'employee_user_id', a.employee_user_id, 'employee_name', a.employee_name, 'project_name', a.project_name,
      'issued_at', a.issued_at, 'issued_by_name', a.issued_by_name,
      'accepted_at', a.employee_confirmed_at, 'ack_name', a.ack_name, 'expected_return_at', a.expected_return_at),
    'items', v_items, 'overall', v_overall, 'unlinked', v_unlinked, 'is_manager', v_is_mgr);
end $$;

-- ═══ 4) تشخيص إداري: كل صف خام + التطبيع + البند المطابق + سبب عدم التطابق ═══
create or replace function public.custody_inv_evidence_diagnostics(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at) from (
    select e.id as evidence_id, e.evidence_stage as raw_stage, public.civ_evidence_norm_stage(e.evidence_stage) as norm_group,
      case when e.assignment_item_id is null and e.asset_id is null then 'overall' else 'per_asset' end as norm_scope,
      e.assignment_id, e.assignment_item_id, e.asset_id, e.file_path as path, e.file_name,
      e.uploaded_by, e.created_at, e.is_deleted,
      (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id = e.assignment_id and i.asset_id = e.asset_id) as items_with_asset,
      (select i.id from public.custody_inventory_assignment_items i where i.assignment_id = e.assignment_id and i.asset_id = e.asset_id limit 1) as candidate_item,
      case
        when e.assignment_item_id is not null then 'linked'
        when e.asset_id is null then 'overall_no_asset'
        when (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id = e.assignment_id and i.asset_id = e.asset_id) = 1 then 'matchable_unique'
        when (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id = e.assignment_id and i.asset_id = e.asset_id) = 0 then 'unlinked_asset_not_in_assignment'
        else 'unlinked_ambiguous' end as match_state
    from public.custody_inventory_evidence e where e.assignment_id = p_assignment
  ) x), '[]'::jsonb);
end $$;

-- ═══ 5) BACKFILL — ربط الصفوف القابلة للربط بأمان فقط ═══
with safe as (
  select e.id, (select i.id from public.custody_inventory_assignment_items i
                where i.assignment_id = e.assignment_id and i.asset_id = e.asset_id) as item_id
  from public.custody_inventory_evidence e
  where e.assignment_item_id is null and e.asset_id is not null and e.assignment_id is not null and e.is_deleted = false
    and (select count(*) from public.custody_inventory_assignment_items i
         where i.assignment_id = e.assignment_id and i.asset_id = e.asset_id) = 1
)
update public.custody_inventory_evidence e set assignment_item_id = safe.item_id
from safe where e.id = safe.id;

-- ═══ 6) الصلاحيات + التحقق ═══
do $g$
declare f text;
begin
  execute 'revoke all on function public.civ_evidence_group(uuid,uuid,uuid,boolean,text[],uuid,boolean) from public, anon, authenticated';
  execute 'revoke all on function public.civ_evidence_norm_stage(text) from public, anon';
  execute 'grant execute on function public.civ_evidence_norm_stage(text) to authenticated';
  foreach f in array array['public.custody_inv_evidence_bundle(uuid)','public.custody_inv_evidence_diagnostics(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- retire the superseded 5-arg helper (function-body refs are not hard deps; the new bundle uses civ_evidence_group)
  execute 'drop function if exists public.civ_evidence_json(uuid,uuid,text[],uuid,boolean)';
end $g$;

do $v$
declare miss text := '';
begin
  if to_regprocedure('public.custody_inv_evidence_bundle(uuid)')       is null then miss := miss || ' bundle'; end if;
  if to_regprocedure('public.custody_inv_evidence_diagnostics(uuid)')  is null then miss := miss || ' diagnostics'; end if;
  if to_regprocedure('public.civ_evidence_group(uuid,uuid,uuid,boolean,text[],uuid,boolean)') is null then miss := miss || ' civ_evidence_group'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;

-- ─── فحوص ما بعد التطبيق (للتقرير) ───
-- عدد الصفوف المربوطة بالباك-فيل (شغّلها قبل/بعد؛ الفرق = المربوط):
--   select count(*) from public.custody_inventory_evidence where assignment_item_id is not null;
-- الصفوف الغامضة المتبقّية (تحتاج مراجعة يدوية — لا تُعدَّل):
--   select e.id, e.assignment_id, e.asset_id, e.evidence_stage,
--          (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id=e.assignment_id and i.asset_id=e.asset_id) as items_with_asset
--   from public.custody_inventory_evidence e
--   where e.assignment_item_id is null and e.asset_id is not null and e.is_deleted=false
--     and (select count(*) from public.custody_inventory_assignment_items i where i.assignment_id=e.assignment_id and i.asset_id=e.asset_id) <> 1;
-- تحقّق من الحزمة لعهدة بها صور موظف:
--   select public.custody_inv_evidence_bundle('<assignment_id>');
--   select public.custody_inv_evidence_diagnostics('<assignment_id>');
