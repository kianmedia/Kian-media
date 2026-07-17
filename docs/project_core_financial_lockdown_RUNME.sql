-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — PROJECT_CORE FINANCIAL COLUMN LOCKDOWN (RUN ONCE)
--
-- Closes a direct-API financial leak surfaced by the §5 adversarial authz review:
-- project_core.budget_amount / estimated_cost / actual_cost were SELECT-granted to
-- the `authenticated` role, and the row policy (pc_read) gates only on project
-- membership. A non-finance staff member (e.g. an editor) who is a member of a
-- project could therefore read that project's budget / cost / margin with a direct
-- PostgREST call — violating the requirement "an editor must not retrieve financial
-- data through direct API calls".
--
-- RLS cannot filter individual COLUMNS, so this uses column-level privileges:
--   • REVOKE SELECT on the three money columns from authenticated/anon.
--   • Expose them ONLY through pc_project_financials(project) — a SECURITY DEFINER
--     RPC that returns the values solely to a caller who can read the project AND
--     (can_manage_projects() OR can_see_financials()); everyone else gets NULLs.
--
-- SECURITY DEFINER functions that read these columns internally (pc_dashboard,
-- project_core_set_meta, finance reports) run as the table owner and keep their
-- column privileges, so aggregates and writes are unaffected. Idempotent & additive
-- — it neither drops data nor rewrites the base project_core migration.
-- ════════════════════════════════════════════════════════════════════════════

do $pf$
declare miss text := '';
begin
  if to_regclass('public.project_core') is null then miss := miss || ' project_core'; end if;
  if to_regprocedure('public.pc_can_read_project(uuid)')  is null then miss := miss || ' pc_can_read_project(uuid)'; end if;
  if to_regprocedure('public.can_manage_projects()')      is null then miss := miss || ' can_manage_projects()'; end if;
  if to_regprocedure('public.can_see_financials()')       is null then miss := miss || ' can_see_financials()'; end if;
  if miss <> '' then raise exception 'نقص في الاعتمادات:%', miss; end if;
end $pf$;

begin;

-- 1) Block direct column reads by the client roles (owner-run functions keep theirs).
--    A column-level REVOKE is a NO-OP against a table-wide GRANT SELECT (Postgres
--    allows a column read if the role holds SELECT on the table OR the column), so
--    we must drop the table-wide grant and re-grant SELECT on the non-financial
--    columns only. The three money columns then have no grant at either level.
revoke select on public.project_core from authenticated;
revoke select on public.project_core from anon;
grant select (
  project_id, core_stage, priority, health, start_date, due_date, delivery_date,
  currency, progress_pct, project_type, created_at, updated_at, updated_by
) on public.project_core to authenticated;

-- 2) The only sanctioned read path for the three money columns.
create or replace function public.pc_project_financials(p_project uuid)
returns table (budget_amount numeric, estimated_cost numeric, actual_cost numeric)
language plpgsql stable security definer set search_path = public as $$
begin
  if public.pc_can_read_project(p_project)
     and (public.can_manage_projects() or public.can_see_financials()) then
    return query
      select pc.budget_amount, pc.estimated_cost, pc.actual_cost
      from public.project_core pc where pc.project_id = p_project;
    if not found then
      return query select null::numeric, null::numeric, null::numeric;
    end if;
  else
    -- unauthorized (or non-member): never leak — return a NULL row.
    return query select null::numeric, null::numeric, null::numeric;
  end if;
end $$;

revoke all on function public.pc_project_financials(uuid) from public, anon;
grant execute on function public.pc_project_financials(uuid) to authenticated;

-- 3) Validate.
do $v$
begin
  if to_regprocedure('public.pc_project_financials(uuid)') is null then
    raise exception 'فشل: pc_project_financials'; end if;
  -- has_column_privilege() honors the real runtime check (table-level OR
  -- column-level), so it proves the money columns are truly unreadable and the
  -- non-financial columns are still readable by the authenticated role.
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
