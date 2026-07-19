-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-3: EMPLOYEE RETURN-REVIEW SHOWS SUBMITTED CONDITION/NOTES  (RUN ONCE)
--
-- Reproducible defect: custody_inv_get_my_assignments (in the already-applied
-- portal_custody_inventory_system_v1_RUNME.sql) builds each item WITHOUT
-- condition_at_return / return_notes / returned_at. The employee's read-only
-- Returns-under-review cards render exactly i.condition_at_return and
-- i.return_notes (components/portal/custody-inventory/EmployeeCustodyReturn.tsx),
-- so after an employee submits a return with a condition + note (persisted to
-- custody_inventory_assignment_items), their own card shows those fields BLANK.
--
-- Fix: additive CREATE OR REPLACE of custody_inv_get_my_assignments only — adds
-- the three existing columns to the item jsonb. Same signature, same authz
-- (self only, SECURITY DEFINER), no schema change, nothing else touched.
-- Idempotent · non-destructive.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
begin
  if to_regprocedure('public.custody_inv_get_my_assignments()') is null then
    raise exception 'نقص: custody_inv_get_my_assignments (شغّل custody v1 أولًا)';
  end if;
end $pf$;

begin;

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
                'status', i.status, 'condition_at_issue', i.condition_at_issue,
                -- P0-3 fix: expose the employee's submitted return evidence fields.
                'condition_at_return', i.condition_at_return, 'return_notes', i.return_notes, 'returned_at', i.returned_at))
              from public.custody_inventory_assignment_items i join public.custody_inventory_assets ast on ast.id = i.asset_id
              where i.assignment_id = a.id) as items
      from public.custody_inventory_assignments a
      where a.employee_user_id = v_uid and a.is_deleted = false
    ) x
  ), '[]'::jsonb);
end; $$;

do $v$
begin
  if to_regprocedure('public.custody_inv_get_my_assignments()') is null then
    raise exception 'فشل التحقق: custody_inv_get_my_assignments';
  end if;
end $v$;

notify pgrst, 'reload schema';
commit;
