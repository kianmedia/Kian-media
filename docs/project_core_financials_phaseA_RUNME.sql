-- ════════════════════════════════════════════════════════════════════════════
-- KIAN PORTAL — PROJECT_CORE FINANCIALS · PHASE A (RUN BEFORE FRONTEND DEPLOY)
--
-- Zero-downtime rollout, step 1 of 2. This phase ONLY creates the finance-gated
-- read RPC. It deliberately does NOT change any grant, so it is forward-compatible
-- with BOTH:
--   • the currently-deployed frontend (still uses project_core `select=*` — the
--     table-wide SELECT grant is untouched, so it keeps working), and
--   • the new frontend (pcGetProjectCore selects only non-financial columns and
--     merges financials from pc_project_financials()).
--
-- The actual column lockdown (revoke table SELECT + re-grant non-financial columns)
-- is PHASE B — run it ONLY AFTER the new frontend is live, or it breaks the old
-- frontend's `select=*`. See docs/project_core_financials_phaseB_lockdown_RUNME.sql.
--
-- Idempotent & additive. Safe to run while the old frontend serves traffic.
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

-- The only sanctioned read path for the three money columns. Returns the values
-- solely to a caller who can read the project AND is finance/manager; everyone
-- else (including non-members) gets a NULL row — never a leak.
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
    return query select null::numeric, null::numeric, null::numeric;
  end if;
end $$;

revoke all on function public.pc_project_financials(uuid) from public, anon;
grant execute on function public.pc_project_financials(uuid) to authenticated;

do $v$
begin
  if to_regprocedure('public.pc_project_financials(uuid)') is null then
    raise exception 'فشل: pc_project_financials'; end if;
  -- Phase A must NOT have restricted the table yet (that is Phase B). Assert the
  -- money columns are still directly readable, so the old frontend is unbroken.
  if not has_column_privilege('authenticated', 'public.project_core', 'budget_amount', 'SELECT') then
    raise exception 'Phase A يجب ألا يقيّد الأعمدة — استُخدم ملف Phase B بالخطأ؟';
  end if;
end $v$;

notify pgrst, 'reload schema';
commit;
