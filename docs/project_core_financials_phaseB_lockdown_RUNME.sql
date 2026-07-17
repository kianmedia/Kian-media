-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — PROJECT_CORE FINANCIALS · PHASE B (RUN AFTER FRONTEND DEPLOY)
--
-- Zero-downtime rollout, step 2 of 2. This is the actual column lockdown. It
-- REVOKES the table-wide SELECT on project_core and re-grants SELECT on only the
-- non-financial columns, so budget_amount / estimated_cost / actual_cost become
-- unreadable by a direct PostgREST call from the `authenticated` role.
--
-- ⚠ DEPLOYMENT ORDER — DO NOT RUN THIS BEFORE THE NEW FRONTEND IS LIVE.
--   The old frontend reads project_core with `select=*` / `project_core(*)`.
--   After this revoke, `select=*` expands to include the now-ungranted money
--   columns → PostgREST returns "permission denied for column" → the project-core
--   list AND detail pages break for EVERYONE (managers/finance included).
--   The new frontend (pcGetProjectCore → PC_CORE_COLS + pc_project_financials())
--   never does `select=*`, so it is unaffected.
--
-- Preconditions enforced below: Phase A (pc_project_financials) must already exist.
-- Idempotent: re-running is a no-op (revoke of an absent grant + re-grant of the
-- same columns), and the validation re-proves the end state.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_core') is null then miss := miss || ' project_core'; end if;
  -- Phase A must have run first — the RPC is the only remaining read path.
  if to_regprocedure('public.pc_project_financials(uuid)') is null then
    raise exception 'شغّل Phase A أولاً (pc_project_financials غير موجودة): docs/project_core_financials_phaseA_RUNME.sql';
  end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- Drop the table-wide SELECT (a column-level REVOKE is a NO-OP against it) and
-- re-grant SELECT on the non-financial columns only. The three money columns then
-- have no grant at either level. Owner-run SECURITY DEFINER functions (dashboards,
-- set_meta, finance reports, pc_project_financials) keep their column privileges,
-- so aggregates and writes are unaffected.
revoke select on public.project_core from authenticated;
revoke select on public.project_core from anon;
grant select (
  project_id, core_stage, priority, health, start_date, due_date, delivery_date,
  currency, progress_pct, project_type, created_at, updated_at, updated_by
) on public.project_core to authenticated;

do $v$
begin
  -- has_column_privilege() honors the real runtime check (table-level OR
  -- column-level): the money columns must be unreadable, the rest still readable.
  if has_column_privilege('authenticated', 'public.project_core', 'budget_amount',  'SELECT')
     or has_column_privilege('authenticated', 'public.project_core', 'estimated_cost', 'SELECT')
     or has_column_privilege('authenticated', 'public.project_core', 'actual_cost',   'SELECT') then
    raise exception 'فشل: أعمدة project_core المالية ما زالت قابلة للقراءة المباشرة من authenticated';
  end if;
  if not has_column_privilege('authenticated', 'public.project_core', 'core_stage', 'SELECT') then
    raise exception 'فشل: أعمدة project_core غير المالية أصبحت غير مقروءة من authenticated';
  end if;
end $v$;

notify pgrst, 'reload schema';
commit;
