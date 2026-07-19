-- ════════════════════════════════════════════════════════════════════════════
-- KIAN — P0-4: CUSTODY DASHBOARD BUCKETS + UNIFIED CASE TIMELINE  (RUN ONCE)
--
-- Additive read RPCs (do NOT rewrite the existing custody_admin_custody_dashboard):
--   • custody_dashboard_buckets()      — one call returning every status bucket the
--     spec lists, incl. the liability buckets (pending / hidden / visible / disputed).
--     civ_can_manage() only.
--   • custody_case_timeline(assignment) — chronological merge of issue / accept /
--     return / inspection / maintenance movements + liability events for one case.
--     civ_can_manage() sees all; the case's own EMPLOYEE sees a REDACTED timeline
--     (no amounts, no internal notes, liability events only when show_to_employee).
--
-- Idempotent · non-destructive. Depends on: custody_inventory_assignments/_items/
-- _movements, custody_liabilities/_events (custody_liability_RUNME), civ_can_manage().
-- Run AFTER custody_liability_RUNME.sql.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.custody_inventory_assignments') is null then miss := miss || ' custody_inventory_assignments'; end if;
  if to_regclass('public.custody_inventory_movements')   is null then miss := miss || ' custody_inventory_movements'; end if;
  if to_regprocedure('public.civ_can_manage()') is null then miss := miss || ' civ_can_manage()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات (%).', miss; end if;
end $pf$;

begin;

-- ═══ 1) عدّادات لوحة العهد الكاملة ═══
create or replace function public.custody_dashboard_buckets()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare has_liab boolean := to_regclass('public.custody_liabilities') is not null;
        liab jsonb := '{}'::jsonb;
begin
  if not public.civ_can_manage() then raise exception 'not authorized'; end if;
  if has_liab then
    select jsonb_build_object(
      'liability_pending',  count(*) filter (where status in ('draft','pending_admin_approval')),
      'liability_hidden',   count(*) filter (where show_to_employee = false and status not in ('closed','waived')),
      'liability_visible',  count(*) filter (where show_to_employee = true  and status not in ('closed','waived')),
      'liability_disputed', count(*) filter (where status = 'disputed')
    ) into liab from public.custody_liabilities where deleted_at is null;
  else
    liab := jsonb_build_object('liability_pending',0,'liability_hidden',0,'liability_visible',0,'liability_disputed',0);
  end if;

  return (
    select jsonb_build_object(
      'pending_acceptance', count(*) filter (where a.status = 'pending_employee_confirmation'),
      'active_issued',      count(*) filter (where a.status = 'active'),
      'due_soon',           count(*) filter (where a.status in ('active','partially_returned')
                                              and a.expected_return_at is not null
                                              and a.expected_return_at between now() and now() + interval '3 days'),
      'overdue',            count(*) filter (where a.expected_return_at is not null and a.expected_return_at < now()
                                              and a.status in ('active','return_requested','under_inspection','partially_returned')),
      'return_requested',   count(*) filter (where a.status = 'return_requested'),
      'under_inspection',   count(*) filter (where a.status = 'under_inspection'),
      'rejected_return',    count(*) filter (where a.status = 'rejected'),
      'disputed',           count(*) filter (where a.status = 'disputed'),
      'recently_closed',    count(*) filter (where a.status in ('returned','cancelled') and a.updated_at >= now() - interval '14 days'),
      'maintenance_required', (select count(*) from public.custody_inventory_assignment_items i where i.status = 'damaged' and exists (
                                  select 1 from public.custody_inventory_maintenance m where m.assignment_id = i.assignment_id and m.status = 'opened')),
      'damaged',            (select count(*) from public.custody_inventory_assignment_items i where i.status = 'damaged'),
      'missing',            (select count(*) from public.custody_inventory_assignment_items i where i.status = 'missing')
    ) || liab
    from public.custody_inventory_assignments a where a.is_deleted = false
  );
end $$;

-- ═══ 2) تايملاين الحالة الموحّد ═══
create or replace function public.custody_case_timeline(p_assignment uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_owner uuid; v_is_mgr boolean; v_is_emp boolean; has_liab boolean := to_regclass('public.custody_liabilities') is not null;
        v jsonb;
begin
  select employee_user_id into v_owner from public.custody_inventory_assignments where id = p_assignment and is_deleted = false;
  if v_owner is null then raise exception 'not_found'; end if;
  v_is_mgr := public.civ_can_manage();
  v_is_emp := (auth.uid() = v_owner);
  if not (v_is_mgr or v_is_emp) then raise exception 'not authorized'; end if;

  with events as (
    -- movements (issue / accept / return / inspection / maintenance / lost / ...)
    select m.created_at as ts, 'movement' as kind, m.movement_type as event_type,
           m.reason as detail, m.created_by as actor_id, null::text as extra
    from public.custody_inventory_movements m where m.assignment_id = p_assignment
    union all
    -- liability events (redacted for the employee: no amount/internal note in detail)
    select e.created_at, 'liability', e.event_type,
           case when v_is_mgr then coalesce(e.metadata->>'note', e.new_status)
                else null end,
           e.actor_id,
           case when v_is_mgr then e.new_status else null end
    from public.custody_liability_events e
    join public.custody_liabilities l on l.id = e.liability_id
    where has_liab and l.assignment_id = p_assignment
      and (v_is_mgr or l.show_to_employee)      -- employee sees only visible-liability events
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.ts), '[]'::jsonb) into v from (
    select ev.ts, ev.kind, ev.event_type, ev.detail, ev.extra,
           (select full_name from public.profiles where id = ev.actor_id) as actor_name
    from events ev
  ) x;
  return v;
end $$;

-- ═══ 3) Grants + VALIDATION ═══
do $g$
declare f text;
begin
  foreach f in array array['public.custody_dashboard_buckets()','public.custody_case_timeline(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $g$;

do $v$
declare miss text := '';
begin
  if to_regprocedure('public.custody_dashboard_buckets()')      is null then miss := miss || ' custody_dashboard_buckets'; end if;
  if to_regprocedure('public.custody_case_timeline(uuid)')      is null then miss := miss || ' custody_case_timeline'; end if;
  if miss <> '' then raise exception 'فشل التحقق:%', miss; end if;
end $v$;

notify pgrst, 'reload schema';
commit;
