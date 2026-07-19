# Project Hierarchy — SQL Run Order

Master / subproject hierarchy on `public.projects` (self-reference `parent_project_id`).
Apply each file **once**, in order, in the Supabase SQL Editor. Every file is
idempotent, additive, and non-destructive (no data deletion, no column rename).
Do **not** assume a later file ran before an earlier one — each has its own preflight.

> Do **not** run `project_core_financials_phaseB_lockdown_RUNME.sql` (Phase B) and do
> not modify Zoho as part of this program.

| Order | File | Batch | What it does | Run manually in Supabase? |
|---|---|---|---|---|
| 1 | `docs/project_hierarchy_schema_RUNME.sql` | **1 — Schema + Compatibility** | Adds hierarchy columns to `projects` (`project_scope`, `parent_project_id`, sequence/code/labels, rollup/progress-mode, operational_stage, client_visibility, closure/reopen), CHECK constraints, indexes, the cross-row integrity trigger, the backfill (existing → `standalone`), and the `project_hierarchy_settings` feature flag (default **OFF**) + get/update/`enabled` RPCs. | **Yes** |
| 2 | `docs/project_hierarchy_security_RUNME.sql` | 2 — RLS & Access | *(pending)* client-visibility inheritance + direct-link protection + master/subproject access helpers. | pending |
| 3 | `docs/project_hierarchy_templates_RUNME.sql` | 3 — Templates & Creation | *(pending)* templates tables + create-master/create-subproject/clone RPCs + code generation + `projects.template_id` FK. | pending |
| 4 | `docs/project_hierarchy_progress_RUNME.sql` | 5 — Progress | *(pending)* leaf progress modes + weighted master rollup RPC/view + verification query. | pending |
| 5 | `docs/project_hierarchy_closure_RUNME.sql` | 5 — Closure | *(pending)* subproject/master closure checklist + approval + reopen + audit + snapshot. | pending |
| 6 | `docs/project_hierarchy_financials_RUNME.sql` | 7 — Financials | *(pending)* master contract value vs subproject budget allocation + payment milestones. | pending |
| 7 | `docs/project_hierarchy_portal_RUNME.sql` | 6 — Portal | *(pending)* `client_project_access` + portal RLS for masters/subprojects. | pending |
| 8 | `docs/project_hierarchy_reports_RUNME.sql` | 6 — Reports | *(pending)* report read views for master status / subproject closure. | pending |
| — | `docs/project_hierarchy_events_RUNME.sql` | 7 — Integration | *(pending)* outbox event contract (master_project_created … payment_milestone_ready) for n8n/Zoho. | pending |

## Batch 1 — post-run checks (run these in the SQL Editor after file 1)
```sql
-- 1) every existing project is now a valid standalone with no parent
select project_scope, count(*) from public.projects group by 1;      -- expect: standalone = total, no master/subproject
select count(*) from public.projects where parent_project_id is not null;   -- expect: 0

-- 2) feature flag is OFF (nothing behaves differently yet)
select public.project_hierarchy_enabled();                            -- expect: false

-- 3) constraints + trigger present
select conname from pg_constraint where conname like 'projects_%_ck';  -- expect the 8 hierarchy CHECKs
select tgname from pg_trigger where tgname = 'trg_projects_hierarchy_guard';   -- expect 1 row
```
**Success markers:** all existing projects show `standalone`; `parent_project_id` all NULL; flag `false`; no error opening/editing/creating a normal project.

## Rollback (Batch 1)
Batch 1 is additive; a full rollback is rarely needed. If required:
```sql
begin;
drop trigger if exists trg_projects_hierarchy_guard on public.projects;
drop function if exists public.projects_hierarchy_guard();
-- (optional) drop the flag surface
drop function if exists public.project_hierarchy_enabled();
drop function if exists public.project_hierarchy_get_flags();
drop function if exists public.project_hierarchy_admin_update_flags(jsonb);
drop table if exists public.project_hierarchy_settings;
-- (optional, only if you must fully revert schema — data-preserving; drops unused columns)
alter table public.projects
  drop constraint if exists projects_scope_ck,
  drop constraint if exists projects_no_self_parent_ck,
  drop constraint if exists projects_scope_parent_ck,
  drop constraint if exists projects_client_visibility_ck,
  drop constraint if exists projects_closure_status_ck,
  drop constraint if exists projects_progress_mode_ck,
  drop constraint if exists projects_rollup_weight_ck,
  drop constraint if exists projects_operational_stage_ck;
drop index if exists public.idx_projects_parent;
drop index if exists public.idx_projects_scope;
drop index if exists public.ux_projects_parent_seq;
drop index if exists public.ux_projects_company_code;
-- leaving the columns in place is harmless (they are inert until later batches);
-- drop them only if you truly must revert:
-- alter table public.projects drop column if exists parent_project_id, drop column if exists project_scope, ... ;
commit;
```
> Because Batch 1 creates no project rows and no master/subproject exists yet, dropping
> the columns cannot orphan anything. Prefer leaving the columns (inert) over dropping.

## Do-not-run-twice notes
Everything is `if not exists` / `on conflict do nothing` / guarded `add constraint`, so
re-running any file is safe. The only "one-way" effect is the backfill (`project_scope
= 'standalone'`), which is idempotent.
