# PROJECT EDITOR PERMISSION AUDIT — تدقيق صلاحيات المونتير على منصّة المشاريع

**Scope**: every authorization surface reachable from the project platform (project-core,
large projects, deliverables, planning, governance, closure), traced from the account
identity down to the RPC/RLS that actually decides.
**Method**: static trace of the deployed SQL under `docs/` plus the UI gates under
`components/` and `lib/`. Nothing was executed against a database. Every claim below
carries a `file:line`.
**Status vocabulary**: `CURRENT` = what the code does today. `PROPOSED` = would need a new,
separate, additive SQL file — nothing here is a change instruction.

> Ownership note: this document owns **only** the audit and the matrix. It does not edit
> `docs/project_platform_large_projects_RUNME.sql` or `docs/project_bulk_import_RUNME.sql`
> (both applied on production).

---

## 0. Verification of the reported root cause

All three legs of the reported chain were re-derived from source and **hold**.

| Claim | Verdict | Evidence |
|---|---|---|
| `project_units_can_write` = `is_admin() OR can_manage_projects() OR is_kian_member(p)` | **CONFIRMED** | `docs/project_platform_large_projects_RUNME.sql:1168`–`1179` |
| `is_kian_member` passes any `kian_*` project role | **CONFIRMED** | `docs/phase0_migration.sql:384`–`387` |
| bulk-update allowlist contains `stage_id`, `status`, `client_visible` | **CONFIRMED** | `docs/project_platform_large_projects_RUNME.sql:1195`–`1198`; gate applied per row at `:1228` |
| `can_manage_projects()` never includes `editor` | **CONFIRMED (all 3 definitions)** | `docs/phase0_migration.sql` has none; `docs/staff_roles_task_assignment_RUNME.sql:66`, `docs/staff_roles_task_assignment_PROPOSAL.sql:75`, `docs/project_platform_authz_hardening_RUNME.sql:51` — each is `is_owner() OR staff_role() in ('manager')` |
| RLS on `deliverables` has no staff UPDATE policy → direct PostgREST PATCH is already blocked | **CONFIRMED** | `docs/phase0_migration.sql:886` (SELECT) and `:892` (`admin all dlv` = `is_admin()`); the read policy is re-created **read-only** at `docs/project_platform_large_projects_RUNME.sql:1299` and `docs/staff_roles_task_assignment_RUNME.sql:116`. Same shape on `projects` (`docs/phase0_migration.sql:807`, `:811`) |
| `ProjectOps.tsx` treats an editor as a manager | **CONFIRMED** | `components/portal/projectcore/ProjectOps.tsx:125` |

The chain is real and server-side. The sections below extend it.

---

## 1. Where an editor's capability actually comes from

Five independent grant sources feed the project platform. They are **not** layered — any
one of them alone is sufficient for most writes.

| # | Source | Definition | What it means for `staff_role='editor'` |
|---|---|---|---|
| S1 | `account_type` | `docs/phase0_migration.sql:325` (`is_admin`) | Not granted. `is_admin()` is `account_type='admin'` only. |
| S2 | `staff_role` | column CHECK `docs/staff_roles_task_assignment_RUNME.sql:37`; reader `:44` | `'editor'` is a valid staff tier. Feeds `can_edit_project` only. |
| S3 | Project membership | `project_role()` `docs/phase0_migration.sql:352`; role CHECK `docs/phase0_migration.sql:143` | `kian_editor` → `is_kian_member` **and** `can_edit_project`. |
| S4 | Professions / permissions | `emp_has_permission` `docs/permission_catalog_RUNME.sql:212` | Independent of staff_role entirely. |
| S5 | Per-user overrides | `employee_permission_overrides` `docs/permission_catalog_RUNME.sql:63` | Explicit `deny` wins, then explicit `allow`, then profession union. |

**S4/S5 have no staff anchor of their own** — `emp_has_permission` checks overrides and
professions and nothing else (`docs/permission_catalog_RUNME.sql:212`–`243`). Every caller
must add its own `is_staff()`/membership anchor; some do (`gov_can`
`docs/project_governance_batch5a_RUNME.sql:386`, `res_can`
`docs/project_resources_batch4b_RUNME.sql:251`), some do not (see F-13).

---

## 2. Findings

Severity: **C**ritical / **H**igh / **M**edium / **L**ow / **OK** (verified-safe).

### F-01 · C · `is_kian_member` collapses four distinct project roles into one
`docs/phase0_migration.sql:384`
```
select public.is_admin() or public.project_role(p_project) like 'kian\_%';
```
**Grant source**: S3. **Impact**: `kian_manager`, `kian_editor`, `kian_photographer` **and
`kian_viewer`** are indistinguishable to every gate built on it. `kian_viewer` is offered
in the team picker as a *view-only* project role (`lib/portal/roles.ts:129`) yet inherits
full write through F-02. `kian_admin` is also in the CHECK (`docs/phase0_migration.sql:143`)
and matches the prefix.

### F-02 · C · `project_units_can_write` inherits F-01
`docs/project_platform_large_projects_RUNME.sql:1168`. The function itself is exemplary —
every branch is `coalesce(...,false)` inside `begin/exception`, and it returns `false`, never
NULL (`:1177`, `:1179`). The defect is purely the third branch being `is_kian_member`.
**Impact**: any `kian_*` member gets manager-grade write on the large-project surface.

### F-03 · C · `large_project_deliverables_bulk_update` bypasses the strong delivery path
`docs/project_platform_large_projects_RUNME.sql:1181`; allowlist `:1195`–`1198`; per-row gate
`:1228`. Three forbidden fields are in the allowlist and **`status` has no value allowlist**
(`:1236` writes whatever string arrives, subject only to the table CHECK).
**Impact, stated precisely**: the hardened path to `final_delivered` is
`admin_set_final_version`, which requires `is_admin() OR can_final_deliver()` (owner/manager
only — `docs/deliverable_final_master_RUNME.sql:116`), an **approved** version (`:120`) and a
present clean master (`:129`). An editor calling `bulk_update` with
`{"status":"final_delivered"}` reaches the same end state with **none** of those three
checks. `client_visible` likewise publishes to the client with no review step, and `stage_id`
moves work between production stages. `reason` is mandatory (`:1219`) and the action is
audited (`:1264`), so the act is *recorded* — it is not *prevented*.

### F-04 · H · the stage trigger validates shape, not authority
`docs/project_platform_large_projects_RUNME.sql:776` (`deliverables_stage_guard`, trigger at
`:796`). It checks the stage belongs to the deliverable's project. It performs **no**
authorization, so it cannot compensate for F-03.

### F-05 · H · `can_edit_project` is a broad gate, not a narrow one
`docs/project_platform_authz_hardening_RUNME.sql:81` (identical logic at
`docs/staff_roles_task_assignment_RUNME.sql:82`). Correctly `coalesce(...,false)` and
correctly scoped to *assigned* projects — but it is the write gate for **40+ RPCs and 8 RLS
policies**. Call-site audit (all confirmed `can_manage_projects() OR can_edit_project(...)`):

| Capability it unlocks for an editor | Site |
|---|---|
| Project lifecycle stage | `docs/project_stage_sync_RUNME.sql:96` (winning `project_core_set_stage`) |
| Priority / health / dates / type / progress | `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1311` |
| Soft-delete task, comment, meeting, risk, location, cost, shoot | `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:505`+ (`pc_entity_delete`, one gate per branch: `:518`, `:532`, `:538`, `:544`, `:550`, `:556`) |
| Add / remove team members | `docs/project_platform_authz_hardening2_RUNME.sql:130`; `docs/project_core_UI_COMPLETION_RUNME.sql:278` |
| Costs, risks, meetings, shoots, locations, tags CRUD | `docs/project_core_UI_COMPLETION_RUNME.sql:222`, `:264`, `:278`, `:321`, `:346`, `:372`; `docs/project_core_REMAINING_MODULES_FINAL_RUNME.sql:55`, `:123`, `:163`, `:184` |
| Tasks: create / edit / assign / re-parent | `docs/project_tasks_batch3a_RUNME.sql:147`, `:189`, `:251`, `:286` |
| Auto-schedule, task dates, constraints | `docs/project_planning_batch4a_RUNME.sql:183`, `:212`, `:239`; `docs/project_planning_batch4c_closure_RUNME.sql:174` |
| Governance: risks, issues, decisions, non-sensitive keys | `docs/project_governance_batch5a_RUNME.sql:392` |
| Closure: non-sensitive keys | `docs/project_governance_batch5c_RUNME.sql:320` |
| Templates: apply a template to the project | `docs/project_templates_batch7a_RUNME.sql:180` |
| Fast-lane operating experience | `docs/project_fastlane_batch8c_RUNME.sql:113` |
| Program planner child creation | `docs/project_program_planner_batch8b_RUNME.sql:382`, `:395` |

Two of these are correctly **carved out** and deserve credit: `gov_can`
(`docs/project_governance_batch5a_RUNME.sql:386`) and the 5C closure gate
(`docs/project_governance_batch5c_RUNME.sql:320`) both exclude the `can_edit_project` branch
for sensitive keys (`governance.manage_roles`, `changes.approve`, `changes.apply`,
`decisions.approve`, `stage_gates.override`, `approvals.override`, `approvals.reassign`).
**That carve-out is the pattern the rest of the platform is missing.**

### F-06 · H · an editor can create a project manager
`docs/project_platform_authz_hardening2_RUNME.sql:127`. Gate is `can_manage_projects() OR
can_edit_project(p_project)`; roles allowed are all four `kian_*` (`:131`). The
self-promotion guard (`:134`) only fires when `p_user = auth.uid()` **and**
`p_role = 'kian_manager'`. **Impact**: editor A may promote *any other* user — including
editor B — to `kian_manager`, and B may reciprocate. `kian_manager` is what
`project_core_set_stage` requires before `ready` (`docs/project_stage_sync_RUNME.sql:115`),
what dashboards report as the project manager
(`docs/project_core_UI_COMPLETION_RUNME.sql:73`–`74`,
`docs/project_portfolio_ux_batch9b_RUNME.sql:60`) and who notifications escalate to
(`docs/notifications_e2e_repair_batch9d_RUNME.sql:210`).

### F-07 · H · an editor can remove the project manager
`docs/project_core_UI_COMPLETION_RUNME.sql:275`:
```
if not public.can_manage_projects() and not public.can_edit_project(p_project) then ...
update public.project_members set is_deleted = true where ... and role like 'kian_%';
```
No role protection, no self-protection, no last-manager check. **Impact**: an editor can
strip the manager (and every other staff member) off a project — a denial-of-oversight, and
it directly defeats the `need_manager` precondition on `ready`.

### F-08 · H · an editor can drive the project lifecycle to `approved`
`docs/project_stage_sync_RUNME.sql:96` (gate), `:111`–`:114` (restrictions). Only three
things need `can_manage_projects()`: a **backward** move, `closed`, and `delivered`. Skipping
more than one step needs `is_owner()`. Everything else is open to the editor, so the reachable
walk is `planning → ready → scheduled → in_production → post_production → internal_review →
client_review → revision → approved`. `client_review` is a client-facing state change.

### F-09 · H · direct PostgREST **hard DELETE** for editors on eight tables
`docs/project_core_FINAL_RUNME.sql:461`–`464` grants `insert, update, delete` to
`authenticated`; `:470`–`478` and `:494`–`509` then create `for all` policies whose
`using`/`with check` is `can_manage_projects() OR can_edit_project(project_id)` on
`project_risks`, `project_meetings`, `project_locations`, `project_shoot_sessions`,
`project_dependencies`, `project_tag_map`, and (via a join) `project_deliverable_versions`
and `task_files`. **Impact**: `DELETE /rest/v1/project_risks?id=eq...` succeeds for an editor
and **bypasses `pc_entity_delete` entirely** — no mandatory reason
(`docs/project_core_ABSOLUTE_FINAL_RUNME.sql:509`), no soft delete, no `pc_log` row. The row
is gone with no audit trail. The Trash tab can never show it.

### F-10 · C · NULL fail-open in the client-side / member predicates *(not editor-specific)*
Three predicates return **NULL**, not `false`, for a user who is neither admin nor a member:

| Predicate | Definition | NULL when |
|---|---|---|
| `is_kian_member` | `docs/phase0_migration.sql:384` | `false OR (NULL like 'kian_%')` |
| `is_client_side` | `docs/phase0_migration.sql:365` | `(NULL like 'client_%') OR false` |
| `is_client_owner` | `docs/phase0_migration.sql:376` | same shape |

`docs/authz_fixC_null_failopen_gates_RUNME.sql` repaired `can_manage_hr`, `can_see_invoices`,
`can_see_opportunities`, `can_manage_quotes`, `can_manage_custody`, `civ_can_manage` — these
three were **not** in that file (verified by grep: they do not appear in it).

In RLS this is safe (a NULL `using` clause denies). In **PL/pgSQL** it is a fail-open, because
`if not (NULL) then raise exception` never enters the branch:

| Reachable fail-open | Site | Effect |
|---|---|---|
| `client_confirm_final_receipt` | `docs/deliverable_final_receipt_RUNME.sql:66` | **WRITE** — any authenticated stranger inserts a receipt row on any `final_delivered` deliverable and fires an admin notification |
| `client_open_final_preview` | `docs/deliverable_delivery_audit_RUNME.sql:50` | **WRITE** — inserts `deliverable_final_opens` + `activity_log` rows (audit pollution) |
| `project_payment_cleared` | `docs/project_delivery_payment_gate_RUNME.sql:112` | READ — leaks a project's payment-cleared flag |
| `deliverable_receipt` | `docs/deliverable_final_receipt_RUNME.sql:90` | READ — leaks receipt state |
| `client_project_access_list` | `docs/project_hierarchy_security_RUNME.sql:210` | READ — leaks grantee user ids and names |

This is the same class as the documented NULL-collapse incident, in five functions that the
earlier fix did not cover.

### F-11 · H · `admin_*` deliverable RPCs accept **client** project members
Gate shape `is_admin() OR staff_reads_all_projects() OR project_role(p) is not null`:

| RPC | Site |
|---|---|
| `admin_add_deliverable_version` | `docs/deliverable_versions_RUNME.sql:119` |
| `admin_resolve_note` | `docs/deliverable_comments_resolution_RUNME.sql:107` |
| `deliverable_final_master_state` | `docs/deliverable_final_master_RUNME.sql:179` |
| `deliverable_delivery_audit` | `docs/deliverable_delivery_audit_RUNME.sql:66` |

`project_role()` returns `client_owner` / `client_member` too (CHECK at
`docs/phase0_migration.sql:143`). **Impact**: a client added to `project_members` can create
internal deliverable versions and resolve internal notes — a client→staff boundary crossing,
not just an editor problem. `kian_viewer` passes as well.

### F-12 · M · the deliverables permission catalog is decorative
`docs/permission_catalog_RUNME.sql:129`–`144` defines `deliverables.send_client_review`,
`deliverables.internal_approve`, `deliverables.mark_final`, `deliverables.create_version`,
`deliverables.download_internal_files` (+8 more), and the `editor` template grants
`send_client_review` and `send_internal_review` (`:292`). A repo-wide grep for those keys
outside the catalog file returns **zero enforcement call sites**.
**Impact, both directions**: granting the key changes nothing, and *revoking* it does not stop
an editor — the real gate is `project_units_can_write` / `can_edit_project`. The permission
screen shows the owner a switch that is not wired to anything.

### F-13 · M · `pc_authz` / `pp_can` membership branch is not kian-scoped
`docs/permission_enforcement_RUNME.sql:100` and `:124`:
`project_role(p_project) is not null AND emp_has_permission(auth.uid(), p_key)`. Combined with
F-14 (professions are keyed by `profile_id` with no staff test,
`docs/permission_catalog_RUNME.sql:75`+ / `docs/employee_professions_RUNME.sql:75`), a client
who is a project member and holds a profession would pass. `is_kian_member` is the intended
predicate here. Note the sibling `pp_can_manage` at
`docs/preproduction_center_RUNME.sql:106` has the same shape.

### F-14 · M · `emp_has_permission` has no staff anchor
`docs/permission_catalog_RUNME.sql:212`. It resolves overrides → professions and returns.
The cross-user probe guard (`:216`) is correct. But nothing requires the subject to be staff,
so the anchor is delegated to every caller and is inconsistently applied (see F-13).

### F-15 · H(UI) · `ProjectOps.canManage` equates editor with manager — *and is unscoped*
`components/portal/projectcore/ProjectOps.tsx:125` → `caps.isAdminArea || caps.isEditor`,
where `caps.isEditor` is `view === "editor"` (`lib/portal/roles.ts:62`) — a **global**
staff_role with **no project scoping at all**. It gates: tab filter incl. Import and Trash
(`:201`), Add subproject / promote / demote (`:384`–`:395`), Save-as-template (`:396`), the
**stage bar buttons** (`:402`–`:404`), priority / health / due / delivery / budget inputs
(`:435`–`:447`), and is passed as `canManage` into ~22 module tabs (`:515`–`:566`).
Two distinct failures live here:
* **Security failure** — the stage bar is visible *and* the API accepts it (F-08).
* **Honesty failure** — the Import tab is visible to an editor but every server call inside it
  is rejected: `import_can_manage()` is `can_manage_projects()` only
  (`docs/project_bulk_import_RUNME.sql:200`–`209`, enforced at `:252`, `:275`, `:756`, `:788`,
  `:817`), and stage creation additionally re-checks it (`:212`, error string at `:394`).
  An editor who is **not** a member of the project also sees every write control enabled and
  is then denied by `can_edit_project`.

### F-16 · H(UI) · the large-project surface carries no role gate at all
`components/portal/LargeProjectDashboard.tsx` imports no capability helper.
`components/portal/DeliverableMatrix.tsx` and `components/portal/LargeProjectBulkBar.tsx`
use a variable named `caps`, but it is **column** capability, not role capability
(`LargeProjectBulkBar.tsx:62`–`63`, `DeliverableMatrix.tsx:150`, `:186`, `:208`). The only
gate is the route: `caps.isStaff || caps.isAdminArea`
(`app/client-portal/project-core/[projectId]/page.tsx:30`). **Impact**: `sales`, `hr`,
`readonly`, `support`, `photographer` staff all see the bulk action bar; the server then
decides via `project_units_can_write`, so any of them holding *any* `kian_*` membership can
execute it (F-01+F-02). `ProjectOps.tsx:553` mounts this component with **no** `canManage`
prop, so the UI never even attempts to reflect the server rule.

### F-17 · M · the readiness gate is advisory and directly bypassable
`docs/project_phase3_closure_RUNME.sql:76` (`project_stage_advance`) enforces readiness and
requires `is_owner() OR emp_has_permission('projects.override_stage_readiness')` to override
(`:88`–`:91`). It then delegates to `project_core_set_stage` (`:96`) — which is **granted to
`authenticated` directly** (`docs/project_stage_sync_RUNME.sql:235`). An editor who calls
`project_core_set_stage` instead of `project_stage_advance` skips readiness entirely and never
writes the `stage_readiness_override` audit row.

### F-18 · OK · verified-safe surfaces (do not "fix" these)
* Direct PostgREST write to `deliverables` / `projects` — denied (see §0).
* `deliverable_assets` — admin-only policy, `docs/phase0_migration.sql:896`.
* `get_deliverable_download` — staff get **nothing**; only `is_admin()` or the project's
  client side, plus `dues_cleared`, release window and download limit
  (`docs/project_delivery_release_policy_RUNME.sql:67`–`91`). The download route is
  server-only and mints a 300 s signed URL (`app/api/portal/deliverable-download/route.ts`).
* `admin_set_final_version` / `admin_set_version_final_master` — `is_admin() OR
  can_final_deliver()`, i.e. owner/manager (`docs/deliverable_final_master_RUNME.sql:79`,
  `:116`).
* `client_review_version` — `is_client_owner` only (`docs/deliverable_versions_RUNME.sql:164`).
* `deliverable_reviews` insert policy — client_owner, only in `client_review`
  (`docs/phase0_migration.sql:934`); the direct-insert policy was correctly removed
  (`docs/project_platform_authz_hardening2_RUNME.sql` self-test).
* `internal_comments` — kian members + admin, clients can never read
  (`docs/phase0_migration.sql:917`, `:921`).
* `admin_set_release_policy`, `admin_confirm_project_payment` — `is_admin()` only
  (`docs/project_delivery_release_policy_RUNME.sql:154`, `:169`).
* Bulk import — `can_manage_projects()` throughout (see F-15).
* `pc_approval_decide` — client kind → client_owner; internal → `gov_can(...,'approvals.decide')`
  with self-approval blocked (`docs/project_governance_batch5a_RUNME.sql:789`–`:796`).
* `trCanDecide` explicitly excludes the editor at the UI layer, deliberately and with a
  comment saying why (`lib/portal/transitions.ts:151`–`159`) — this is the right pattern.

---

## 3. The 30-row question set

**Legend** — *UI visible?* = does a control render for `staff_role='editor'` assigned as
`kian_editor`. *Server allowed?* = does the API accept it. *Result*: `PASS` = UI and server
agree with intent · `FAIL-OPEN` = server accepts what it should refuse · `FAIL-HIDDEN` = the
button is hidden or the tab is a dead end but the API is reachable / the mismatch misleads ·
`PASS(noisy)` = correctly denied but the UI offered it.
A hidden button with a reachable API is scored **FAIL**, per instruction.

| # | Action | UI visible to editor? | Server allowed? | Deciding RPC / RLS | Editor expected | Owner expected | Result | Fix required |
|---|---|---|---|---|---|---|---|---|
| 1 | Create project | No (`ProjectCoreDashboard.tsx:129` = isAdminArea) | No | `project_core_create_project` → `can_manage_projects` `docs/project_core_UI_COMPLETION_RUNME.sql:157` | No | Yes | PASS | — |
| 2 | Edit project meta (priority/health/dates) | Yes (`ProjectOps.tsx:435`–`443`) | **Yes** | `project_core_set_meta` `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1311` | Own assigned project only | Yes | PASS (scoped) | — |
| 3 | Edit project **budget** | Yes if `canSeeFinancials` | No (value silently kept) | same, `v_fin` branch `:1327`–`:1329` | No | Yes | PASS | — |
| 4 | Archive / delete project | No (`project-core/[projectId]/page.tsx:76`) | No | admin-only | No | Yes | PASS | — |
| 5 | Promote to master / demote / add subproject | **Yes** (`ProjectOps.tsx:384`–`392`, `canManage`) | Depends on hierarchy RPC gate | `docs/project_hierarchy_batch6a_RUNME.sql` promote/demote | No | Yes | FAIL-HIDDEN (UI offers a structural op to an editor) | Yes — UI |
| 6 | Advance project stage one step | **Yes** (stage bar `ProjectOps.tsx:402`) | **Yes** | `project_core_set_stage` `docs/project_stage_sync_RUNME.sql:96` | No | Yes | **FAIL-OPEN** (F-08) | Yes |
| 7 | Move project stage to `delivered` / `closed` | Button rendered | No | same, `:113`–`:114` | No | Yes | PASS(noisy) | UI only |
| 8 | Move project stage **backwards** | Button rendered | No | same, `:111`–`:112` | No | Yes | PASS(noisy) | UI only |
| 9 | Bypass stage-readiness gate | n/a | **Yes** | call `project_core_set_stage` instead of `project_stage_advance`; grant at `docs/project_stage_sync_RUNME.sql:235` | No | Yes | **FAIL-OPEN** (F-17) | Yes |
| 10 | Create / edit / delete tasks | Yes | **Yes** | `docs/project_tasks_batch3a_RUNME.sql:147`, `:189` | Yes (assigned project) | Yes | PASS | — |
| 11 | Assign a task to another employee | Yes | **Yes** | `:251` | Borderline — currently yes | Yes | PASS (documented) | — |
| 12 | Reorder / re-schedule tasks, auto-schedule | Yes | **Yes** | `docs/project_planning_batch4a_RUNME.sql:183`, `:212` | Yes | Yes | PASS | — |
| 13 | Move a deliverable between **stages** | **Yes** (matrix bulk bar, no role gate — F-16) | **Yes** | `large_project_deliverables_bulk_update` → `project_units_can_write` `:1228` | **No** | Yes | **FAIL-OPEN** (F-03) | Yes |
| 14 | Change deliverable **status** (→ approved) | **Yes** (same bar) | **Yes** | same | **No** | Yes | **FAIL-OPEN** (F-03) | Yes |
| 15 | Set deliverable status → `final_delivered` | **Yes** (same bar) | **Yes**, with none of the final-delivery preconditions | same, vs `docs/deliverable_final_master_RUNME.sql:116`–`129` | **No** | Yes | **FAIL-OPEN — worst case** | Yes |
| 16 | Toggle `client_visible` (reveal to client) | **Yes** (`DeliverableMatrix.tsx:208`) | **Yes** | same | **No** | Yes | **FAIL-OPEN** (F-03) | Yes |
| 17 | Set the final master file / final version | No | No | `admin_set_final_version` = `is_admin() OR can_final_deliver()` `docs/deliverable_final_master_RUNME.sql:116` | No | Yes | PASS | — |
| 18 | Create a deliverable **version** | Yes | **Yes** | `admin_add_deliverable_version` `docs/deliverable_versions_RUNME.sql:119` — and **any** project member incl. client passes | Yes | Yes | PASS for editor / **FAIL-OPEN for clients** (F-11) | Yes |
| 19 | Read / write internal comments | Yes | Yes | RLS `docs/phase0_migration.sql:917`, `:921` (`is_kian_member`) | Yes | Yes | PASS | — |
| 20 | Resolve a client comment / timecode note | Yes | **Yes** | `admin_resolve_note` `docs/deliverable_comments_resolution_RUNME.sql:107` — client members pass too | Yes | Yes | PASS for editor / **FAIL-OPEN for clients** (F-11) | Yes |
| 21 | Download the client-facing **final file** | No | No | `get_deliverable_download` `docs/project_delivery_release_policy_RUNME.sql:67` — staff excluded | No | Yes | PASS | — |
| 22 | Hard-DELETE risks / meetings / locations / shoots / deps / task files | No button | **Yes via raw PostgREST** | `for all` RLS `docs/project_core_FINAL_RUNME.sql:470`–`509` + grants `:461` | No (soft delete w/ reason only) | Yes | **FAIL-HIDDEN → FAIL-OPEN** (F-09) | Yes |
| 23 | Soft-delete task/comment/meeting/risk/location/cost/shoot (with reason) | Yes | **Yes** | `pc_entity_delete` `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:505`+ | Yes (assigned project) | Yes | PASS | — |
| 24 | Decide an internal approval | No (`trCanDecide` excludes editor, `lib/portal/transitions.ts:158`) | No | `gov_can(...,'approvals.decide')` + self-approval block `docs/project_governance_batch5a_RUNME.sql:791`, `:796` | No | Yes | PASS | — |
| 25 | Add a team member — **as `kian_manager`** | Yes (Team tab, `canManage`) | **Yes** for any user other than self | `pc_member_add` `docs/project_platform_authz_hardening2_RUNME.sql:130`–`:137` | No | Yes | **FAIL-OPEN** (F-06) | Yes |
| 26 | Remove the project manager from the team | Yes | **Yes** | `pc_member_remove` `docs/project_core_UI_COMPLETION_RUNME.sql:278`–`:279` | No | Yes | **FAIL-OPEN** (F-07) | Yes |
| 27 | Bulk **import** deliverables from a file | **Yes — tab renders** (`ProjectOps.tsx:201`, `:557`) | **No** | `import_can_manage` = `can_manage_projects` `docs/project_bulk_import_RUNME.sql:200`, `:252`, `:275`, `:756` | No | Yes | **FAIL-HIDDEN (inverted)** — forbidden tab shown, every action dead-ends | Yes — UI only |
| 28 | Governance: risks / issues / decisions (non-sensitive) | Yes | **Yes** | `gov_can` else-branch `docs/project_governance_batch5a_RUNME.sql:392` | Yes | Yes | PASS | — |
| 29 | Governance: approve a decision / apply a change request / override a stage gate | Hidden | **No** | `gov_can` sensitive list `:390`–`:391` | No | Yes | PASS — **reference pattern** | — |
| 30 | Closure: request vs. final close | Partly (`ProjectCoreDashboard.tsx:121` shows Closure to editor) | Non-sensitive keys yes; final close no | `docs/project_governance_batch5c_RUNME.sql:320`; `project_core_set_stage(...,'closed')` needs `can_manage_projects` | Request only | Yes | PASS | — |
| 31 | Meetings / locations / shoot sessions CRUD | Yes | **Yes** | `docs/project_core_UI_COMPLETION_RUNME.sql:346`, `:372`; `docs/project_core_REMAINING_MODULES_FINAL_RUNME.sql:55`+ | Yes | Yes | PASS | — |
| 32 | Resources: book equipment / people, resolve conflicts | Yes | Depends on `res_can` = `is_staff() AND (can_manage_projects OR emp_has_permission)` `docs/project_resources_batch4b_RUNME.sql:251` | Only with an explicit permission | Yes | PASS — **reference pattern** | — |
| 33 | Pre-production items create / edit / approve / share-with-client | Yes | Per-action via `pp_can` `docs/permission_enforcement_RUNME.sql:124` | Per granted key | Yes | PASS for editor / F-13 for client members | Yes (F-13) |
| 34 | Project **costs** create / edit | Tab hidden unless `canSeeFinancials` (`ProjectOps.tsx:201`) | **RLS = `can_manage_projects OR can_see_financials`** `docs/project_core_FINAL_RUNME.sql:481` | No | Yes | PASS | — |
| 35 | Read project financial summary / accounts tab | No (`isFinance`, `ProjectOps.tsx:126`) | No | `can_see_financials` `docs/project_platform_authz_hardening_RUNME.sql:57` | No | Yes | PASS | — |
| 36 | Read the project **activity log** / audit | Yes (tab) | Read-only | `activity_log` admin-read policy `docs/phase0_migration.sql:874`; project feed via `project_activity_feed` (locked to `authenticated` `docs/project_platform_authz_hardening_RUNME.sql:98`) | Read own project | Yes | PASS | — |
| 37 | Manage staff roles / professions / permissions | No (`staff/page.tsx:11`) | No | `can_manage_staff()` = `is_owner()` `docs/project_platform_authz_hardening_RUNME.sql:76` | No | Yes | PASS | — |
| 38 | Confirm project payment / set release policy | No | No | `is_admin()` `docs/project_delivery_release_policy_RUNME.sql:154`, `:169` | No | Yes | PASS | — |
| 39 | Apply a project template / save project as template | Save-as-template needs `isAdminArea` (`ProjectOps.tsx:396`); apply is `canManage` | Apply: **yes** | `docs/project_templates_batch7a_RUNME.sql:180` | Borderline | Yes | PASS (documented) | — |
| 40 | Read another project the editor is not assigned to | No | No | `projects staff read` `docs/staff_roles_task_assignment_RUNME.sql:112` (editor is not in `staff_reads_all_projects`) | No | Yes | PASS | — |

Rows 31–40 extend past the requested 30 to close the remaining modules named in the brief
(resources, pre-production, financial data, audit, staff management, bulk actions).

---

## 4. What a fix must not break (guard rails for whoever implements)

1. `can_manage_projects()` / `is_admin()` / `is_owner()` must keep every capability they have
   today. Nothing below narrows an owner or an admin.
2. **Do not redefine `is_kian_member` or `can_edit_project` in place.** `is_kian_member` is
   referenced by ~20 RLS policies (`docs/phase0_migration.sql:843`, `:889`, `:905`, `:914`,
   `:919`, `:923`, `:932`, `:948`; `docs/deliverable_delivery_audit_RUNME.sql:105`;
   `docs/project_delivery_payment_gate_RUNME.sql:162`, `:167`;
   `docs/deliverable_final_receipt_RUNME.sql:108`;
   `docs/project_hierarchy_security_RUNME.sql:157`) where it correctly means *"can read this
   project's internal surface"*. Narrowing it would blind photographers and viewers to work
   they legitimately read. `can_edit_project` gates 40+ RPCs (F-05). **Add a new, specific
   predicate** (the `PREFLIGHT` file already reserves `can_move_deliverable`,
   `can_send_to_client_review`, `can_finalize_deliverable`, `can_move_project_stage`) and
   apply it only at the three forbidden actions.
3. An editor must keep: versions, previews, internal comments, client-comment handling, tasks,
   pre-production, meetings/locations/shoots, and soft-delete-with-reason on their assigned
   projects. That is their job.
4. Every new predicate must return an explicit `boolean` on every path and **never NULL** —
   wrap each dependency in `coalesce(..., false)` inside `begin/exception when others then
   false`, exactly as `project_units_can_write` already does
   (`docs/project_platform_large_projects_RUNME.sql:1170`–`1179`).
5. Fixes ship as **new, separate, additive** SQL files. The large-projects and bulk-import
   RUNME files are applied on production and must not be edited.
6. The UI must be corrected *alongside* the server, not instead of it: `ProjectOps.tsx:125`
   should stop equating editor with manager, and the large-project surface needs a real role
   prop (F-15, F-16). UI hiding is never the boundary.

## 5. Priority ordering (severity × reachability)

| Rank | Finding | Why first |
|---|---|---|
| 1 | F-03 (+F-01/F-02) | Reachable from a rendered button; bypasses the entire final-delivery hardening |
| 2 | F-10 | Unauthenticated-adjacent fail-open **writes**, five functions, same class as a prior real incident |
| 3 | F-06 / F-07 | Team-membership escalation and removal of oversight |
| 4 | F-11 | Client → internal-write boundary crossing |
| 5 | F-09 | Silent hard deletes with no audit trail |
| 6 | F-08 / F-17 | Lifecycle control and a bypassable readiness gate |
| 7 | F-15 / F-16 | UI honesty; also the reason the problem was invisible |
| 8 | F-12 / F-13 / F-14 | The permission model does not yet decide anything for deliverables |

**Related read-only artifacts**: `docs/project_editor_permissions_DIAGNOSTIC.sql` (per-user
evidence), `docs/PROJECT_ROLE_PERMISSION_MATRIX.md` (role × capability),
`docs/project_editor_permissions_PREFLIGHT.sql` (pre-change state proof).
