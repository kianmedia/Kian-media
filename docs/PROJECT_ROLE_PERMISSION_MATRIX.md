# PROJECT ROLE PERMISSION MATRIX — مصفوفة الأدوار والصلاحيات (منصّة المشاريع)

**Basis**: what the deployed code does **today**. Every cell was derived from a `file:line`
already cited in `docs/PROJECT_EDITOR_PERMISSION_AUDIT.md`.
**Marking**: unmarked cells are **CURRENT**. Cells marked `⛔CURRENT` are current behaviour
that the audit flags as wrong. Cells marked `→PROPOSED` state the intended end state and are
**not** implemented. No role is widened anywhere in this document.

---

## 0. The role vocabulary that actually exists

Three *different* axes are often called "role". Conflating them is how the editor defect
became invisible. Do not invent values outside these lists.

### Axis A — identity (`profiles.account_type`)
`lead` · `client` · `admin`. CHECK at `docs/phase0_migration.sql` (profiles).
`account_type='admin'` = the protected owner emails = `is_admin()`
(`docs/phase0_migration.sql:325`).

### Axis B — staff tier (`profiles.staff_role`, nullable)
CHECK (`docs/staff_roles_task_assignment_RUNME.sql:37`) + widened by later patches; the
selectable list is `lib/portal/roles.ts:133`:
`super_admin` · `org_admin` *(feature-flagged OFF, `lib/portal/roles.ts:126`)* · `manager` ·
`support` · `editor` · `sales` · `hr` · `readonly` · `finance` · `photographer` ·
`lighting_tech` · `camera_assistant` · `custody_officer`.

> **There is no `designer` staff role and no `project_manager` staff role.** See §4.

### Axis C — project membership (`project_members.role`)
CHECK `docs/phase0_migration.sql:143`; the assignable subset is `lib/portal/roles.ts:137`:
`kian_admin` · `kian_manager` · `kian_editor` · `kian_photographer` · `kian_viewer` ·
`client_owner` · `client_member`.

### Axis D — professions & permissions (orthogonal to A–C)
`professions` × `profession_permissions` × `employee_professions` × per-user
`employee_permission_overrides`, resolved by `emp_has_permission`
(`docs/permission_catalog_RUNME.sql:212`). Profession **templates** shipped:
`photographer` · `videographer` · `editor` · `motion_graphics` · `custody_manager` ·
`project_manager` · `finance` · `logistics` (`docs/permission_catalog_RUNME.sql:277`–`:317`).

---

## 1. Who each column means

| Column | Exact definition today | Predicate |
|---|---|---|
| **Owner** | `account_type='admin'` (protected emails) | `is_admin()` `docs/phase0_migration.sql:325` |
| **Super admin** | `staff_role='super_admin'` | `is_owner()` `docs/staff_roles_task_assignment_RUNME.sql:57` — *identical powers to Owner in every project predicate* |
| **Org admin** | `staff_role='org_admin'` | **No inherent power.** Absent from `caps()` by design (`lib/portal/roles.ts:47`–`:51`); not in `can_manage_projects`. Selectable only if `NEXT_PUBLIC_ORG_ADMIN_ROLE_ENABLED=true` |
| **Manager** | `staff_role='manager'` | `can_manage_projects()` `docs/project_platform_authz_hardening_RUNME.sql:51` |
| **Project manager** | **not a staff role** — `project_members.role='kian_manager'` (+ optional `project_manager` profession template) | `is_kian_member()` only. **Gets no manager powers from the membership itself** |
| **Editor / مونتير** | `staff_role='editor'` **and** `project_members.role='kian_editor'` on that project | `can_edit_project()` `docs/project_platform_authz_hardening_RUNME.sql:81` |
| **Photographer** | `staff_role='photographer'` and/or `kian_photographer` membership | `is_kian_member()` only — **no `can_edit_project`** |
| **Designer** | **does not exist.** Nearest shipped construct: the `motion_graphics` profession template (`docs/permission_catalog_RUNME.sql:298`). A designer today is a general employee + that profession | — |
| **General employee** | `staff_role` NULL or a non-project tier, with an employee profile + professions | `emp_has_permission()` only |
| **Client** | `account_type='client'`, linked via `clients.user_id` or a `client_*` membership | `is_client_side()` / `is_client_owner()` `docs/phase0_migration.sql:365`, `:376` |

`kian_viewer` is not a column — it is a **membership modifier** that, today, silently confers
the Photographer row's write powers (see §3).

---

## 2. Capability matrix — CURRENT state

Legend: `✅` allowed · `❌` denied · `👁` read-only · `🔶` allowed only with an explicit
granular permission · `⛔` **allowed today and should not be** · `—` not applicable.
"Assigned" means the actor holds a membership row on that project.

| # | Capability | Owner | Super admin | Org admin | Manager | Project manager (`kian_manager`) | Editor (`kian_editor`) | Photographer | Designer | General employee | Client |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | See the project platform at all | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ (own portal only) |
| 2 | Read **all** projects | ✅ | ✅ | ❌ | ✅ | ❌ (assigned) | ❌ (assigned) | ❌ (assigned) | ❌ | ❌ | ❌ |
| 3 | Read an assigned project | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 🔶 | 🔶 | 👁 own, filtered |
| 4 | Create a project | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 5 | Edit project meta (priority/health/dates) | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 6 | Edit project **budget** | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 7 | Advance stage forward one step | ✅ | ✅ | ❌ | ✅ | ❌ | ⛔ **YES** | ❌ | ❌ | ❌ | ❌ |
| 8 | Move stage backwards / to `closed` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 9 | Set stage `delivered` | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 10 | Skip more than one stage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 11 | Bypass the readiness gate | ✅ | ✅ | ❌ | ⛔ via direct RPC | ❌ | ⛔ via direct RPC | ❌ | ❌ | ❌ | ❌ |
| 12 | Promote/demote master ↔ standalone, add subproject | ✅ | ✅ | ❌ | ✅ | ❌ | ⛔ UI offers it | ❌ | ❌ | ❌ | ❌ |
| 13 | Create / edit / delete tasks | ✅ | ✅ | 🔶 | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | ❌ |
| 14 | Assign a task to another employee | ✅ | ✅ | 🔶 | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | ❌ |
| 15 | Auto-schedule / edit task dates & constraints | ✅ | ✅ | 🔶 | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | ❌ |
| 16 | Set the schedule **baseline** | ✅ | ✅ | 🔶 | ✅ | 🔶 | ❌ | ❌ | ❌ | 🔶 | ❌ |
| 17 | Create a deliverable **version** | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ | ✅* | ❌ | ⛔ if a project member |
| 18 | Upload preview / revision, internal comments | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ | ✅* | ❌ | ❌ |
| 19 | Resolve client / timecode comments | ✅ | ✅ | ✅* | ✅ | ✅ | ✅ | ✅ | ✅* | ❌ | ⛔ if a project member |
| 20 | **Move a deliverable between stages** | ✅ | ✅ | ❌ | ✅ | ⛔ **YES** | ⛔ **YES** | ⛔ **YES** | ❌ | ❌ | ❌ |
| 21 | **Change deliverable status** (→ approved) | ✅ | ✅ | ❌ | ✅ | ⛔ **YES** | ⛔ **YES** | ⛔ **YES** | ❌ | ❌ | ❌ |
| 22 | **Set status `final_delivered`** (via bulk) | ✅ | ✅ | ❌ | ✅ | ⛔ **YES** | ⛔ **YES** | ⛔ **YES** | ❌ | ❌ | ❌ |
| 23 | Set final version / final master (hardened path) | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 24 | **Toggle `client_visible`** | ✅ | ✅ | ❌ | ✅ | ⛔ **YES** | ⛔ **YES** | ⛔ **YES** | ❌ | ❌ | ❌ |
| 25 | Approve a deliverable as the client | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ `client_owner` only |
| 26 | Download the gated final file | ✅ | ❌** | ❌ | ❌** | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ after payment gate |
| 27 | Add a team member | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 28 | Add a member **as `kian_manager`** | ✅ | ✅ | ❌ | ✅ | ❌ | ⛔ **YES (not self)** | ❌ | ❌ | ❌ | ❌ |
| 29 | Remove a team member incl. the manager | ✅ | ✅ | ❌ | ✅ | ❌ | ⛔ **YES** | ❌ | ❌ | ❌ | ❌ |
| 30 | Grant a client portal access to a project | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 31 | Bulk **import** deliverables from a file | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ (tab visible, all calls denied) | ❌ | ❌ | ❌ | ❌ |
| 32 | Bulk edit via the deliverable matrix | ✅ | ✅ | ❌ | ✅ | ⛔ | ⛔ | ⛔ | ❌ | ❌ | ❌ |
| 33 | Risks / issues / decisions (non-sensitive) | ✅ | ✅ | 🔶 | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | ❌ |
| 34 | Approve a decision / apply a change request | ✅ | ✅ | 🔶 | ✅ | 🔶 | ❌ | ❌ | ❌ | 🔶 | ❌ |
| 35 | Override a stage gate / reassign an approval | ✅ | ✅ | 🔶 | ✅ | 🔶 | ❌ | ❌ | ❌ | 🔶 | ❌ |
| 36 | Decide an internal approval | ✅ | ✅ | 🔶 | ✅ | 🔶 | ❌ | ❌ | ❌ | 🔶 | — |
| 37 | Decide a **client** approval | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ `client_owner` |
| 38 | Meetings / locations / shoot sessions CRUD | ✅ | ✅ | 🔶 | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | ❌ |
| 39 | Pre-production create / edit / internal-approve | ✅ | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | 🔶 | 🔶 | ❌ |
| 40 | Share pre-production with the client | ✅ | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | 🔶 | 🔶 | 👁 |
| 41 | Resource booking / conflict resolution | ✅ | ✅ | 🔶 | ✅ | 🔶 | 🔶 | 🔶 | 🔶 | 🔶 | ❌ |
| 42 | Soft-delete an entity **with a reason** | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| 43 | **Hard DELETE** risks/meetings/locations/shoots/deps/task-files via PostgREST | ✅ | ✅ | ❌ | ✅ | ❌ | ⛔ **YES** | ❌ | ❌ | ❌ | ❌ |
| 44 | Restore from Trash | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ (tab is `canManage`) | ❌ | ❌ | ❌ | ❌ |
| 45 | Read project costs / financial summary | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔶 finance perms | ❌ |
| 46 | Write project costs | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | 🔶 | ❌ |
| 47 | Confirm payment / set release policy | ✅ | ❌*** | ❌ | ❌*** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 48 | Read the project activity log | ✅ | ✅ | 👁 | ✅ | 👁 | 👁 | 👁 | 👁 | 👁 | ❌ |
| 49 | Manage staff roles | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 50 | Manage professions / permissions / overrides | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 51 | Executive portfolio & KPI dashboards | ✅ | ✅ | 🔶 | ✅ | 🔶 | ❌ | ❌ | ❌ | 🔶 | ❌ |
| 52 | Final project close / reopen | ✅ | ✅ | ❌ | ✅ | ❌ | ❌ (may request) | ❌ | ❌ | ❌ | ❌ |

\* `org_admin` and "Designer" reach rows 17–19 **only** through a `kian_*` project membership
(gate is `project_role(...) is not null`, `docs/deliverable_versions_RUNME.sql:119`), not
through their tier.
\** `get_deliverable_download` excludes **all** staff, including managers and super admins —
only `is_admin()` (Owner) or the project's client side
(`docs/project_delivery_release_policy_RUNME.sql:67`–`:91`).
\*** `admin_set_release_policy` / `admin_confirm_project_payment` are `is_admin()` only, so a
`super_admin` who is not `account_type='admin'` is excluded
(`docs/project_delivery_release_policy_RUNME.sql:154`, `:169`).

---

## 3. The `kian_viewer` problem, stated plainly

`kian_viewer` is offered to the owner in the team picker as *"مشاهدة / Viewer"*
(`lib/portal/roles.ts:140`). Because `is_kian_member` matches on the `kian\_%` prefix
(`docs/phase0_migration.sql:384`) and `project_units_can_write` ends on that predicate
(`docs/project_platform_large_projects_RUNME.sql:1179`), a `kian_viewer` today holds rows
20, 21, 22, 24 and 32 of the matrix — deliverable stage moves, status changes including
`final_delivered`, and client visibility. **A viewer is a writer.** Any owner reading the
team screen would conclude the opposite.

---

## 4. Roles this document deliberately did **not** create

| Asked-for role | Reality | What to use instead today |
|---|---|---|
| `project_manager` | Not a `staff_role`. It is (a) `project_members.role='kian_manager'` and (b) a profession **template** name (`docs/permission_catalog_RUNME.sql:302`) | `kian_manager` membership for reporting/notifications; `staff_role='manager'` for actual manager powers |
| `designer` | Does not exist on any axis | General employee + the `motion_graphics` profession template |
| "current admin role" | `org_admin` exists in the CHECK and in `STAFF_ROLE_LABELS`, but is deliberately powerless and feature-flagged off (`lib/portal/roles.ts:47`–`:51`, `:126`) | `super_admin` for owner-grade, `manager` for operations |

Adding any of these as a new `staff_role` would require the DB CHECK **and**
`admin_set_staff_role`'s own hardcoded array to change — the code comment at
`lib/portal/roles.ts:120` records that the migration alone is not enough.

---

## 5. Intended end state — `→PROPOSED`, not implemented

Only the `⛔` cells change. Every `✅` above stays `✅`.

| Matrix rows | Proposed rule | Rationale |
|---|---|---|
| 20, 21, 22, 24, 32 | New predicates `can_move_deliverable(p)`, `can_send_to_client_review(p)`, `can_finalize_deliverable(p)` gate the three forbidden patch keys per-key inside the bulk RPC. Editor: ❌. Manager/Owner: ✅. Others unchanged | Least privilege at the exact action, without touching `project_units_can_write`'s other callers |
| 7, 11 | New `can_move_project_stage(p)`; readiness override stays owner/permission-only, and `project_core_set_stage` stops being a public back door | Lifecycle is a management decision |
| 28 | `pc_member_add` requires `can_manage_projects()` for the `kian_manager` role for **any** target, not just self | Closes reciprocal promotion |
| 29 | `pc_member_remove` refuses to remove a `kian_manager` unless `can_manage_projects()` | Preserves oversight |
| 43 | Revoke `delete` (keep `insert, update`) on the eight tables from `authenticated`; deletion goes through `pc_entity_delete` | Restores the mandatory reason + audit trail |
| 17, 19 (client cells) | Replace `project_role(p) is not null` with `is_kian_member(p)` in the four `admin_*` deliverable RPCs | A client must never write internal artefacts |
| all client cells | `is_kian_member` / `is_client_side` / `is_client_owner` wrapped so they return `false`, never NULL | Removes five fail-open call sites |
| 12, 31, and the UI generally | `ProjectOps.canManage` splits into `canManageProject` (isAdminArea) and `canEditAssigned` (editor **on this project**); the large-project surface receives a real role prop | The screen must tell the truth about the server |

**Editors keep**: rows 5, 13, 14, 15, 17, 18, 19, 27, 33, 38, 39, 42, 44 on their assigned
projects. The proposal removes six capabilities and adds none.

---

*Companion documents*: `docs/PROJECT_EDITOR_PERMISSION_AUDIT.md` (findings with `file:line`),
`docs/project_editor_permissions_DIAGNOSTIC.sql` (per-user evidence, read-only),
`docs/project_editor_permissions_PREFLIGHT.sql` (pre-change state proof).
