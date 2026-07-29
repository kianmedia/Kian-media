# Platform readiness audit — large multi-stage project acceptance

**Date:** 2026-07-29 · **Branch:** `main` · **Method:** static read of the actual code and SQL in
this repository. **No production database was queried and no live UI run was performed**, so every
verdict below is "what the code says it does", not "what a person saw happen". Where behaviour
could not be verified, the row says so explicitly.

**Acceptance dataset:** `tests/fixtures/misbar10_structure.json` is **SYNTHETIC**. The owner's real
Excel workbook is not in this repository. The eleven Arabic stage names are real (owner-supplied);
every deliverable title, platform, date and quantity in the fixture was invented to exercise
platform shapes. The owner's expectation of **11 stages / 79 deliverables** is recorded in the
fixture as **unverified** and must be re-checked against the real workbook before acceptance.

**Architectural note (holds for every row):** a "stage" is not a new entity. It is a **subproject**
(`projects.project_scope='subproject'`, `parent_project_id=<parent>`, ordered by `sequence_number`),
and deliverables hang off the **stage** subproject, not the parent. Nothing in this audit asks for a
project-specific table, column, or component.

---

## 1. Verdict table (23 paths)

| # | Path | Verdict | Evidence (file:line) | Honest note |
|---|------|---------|----------------------|-------------|
| 1 | Create parent project | READY | `components/portal/projectcore/CreateProjectWizard.tsx:104-113` (scope radio incl. "master"), `:80` → `lib/portal/projectCore.ts:413` `project_core_create_project`; SQL `docs/project_hierarchy_batch6a_RUNME.sql:271,310` | Code path is complete and transactional. Not run live. |
| 2 | Link client | READY | `CreateProjectWizard.tsx:147-163` (registered picker + external fallback), payload `:78`; `pcListClients` `lib/portal/projectCore.ts:443` | Registered-client list is capped at `limit=300` (`projectCore.ts:444`); fine now, silently truncating later. Subproject client is inherited and cannot diverge (`project_hierarchy_batch6a_RUNME.sql:118`). |
| 3 | Create sub-project via parent_id | READY | `CreateProjectWizard.tsx:23-24` (`parentProjectId` prop), `:116-133` (master picker), `:77` (payload); entry point `SubprojectsTab.tsx:131-133`; SQL `project_hierarchy_batch6a_RUNME.sql:279-282` | Creating 11 stages = 11 passes through the wizard. There is no "create N subprojects" path in this wizard (bulk child creation lives in the 8B program planner, outside this flow). |
| 4 | Multiple sub-levels | BLOCKER | `project_hierarchy_batch6a_RUNME.sql:117` (`parent_must_be_master`), `:430` (`only_standalone_can_be_promoted`), depth guard `:121-126` | **The platform is deliberately two levels.** A subproject can never become a master, so a stage can never own sub-stages. Parent + 11 stages fits; anything needing a third level does not. This is a design constraint, not a defect — but it must be an accepted constraint, not a surprise. |
| 5 | Stage ordering | PARTIAL | `sequence_number` + unique index `project_hierarchy_batch6a_RUNME.sql:89-90`; atomic reorder RPC `lib/portal/projectHierarchy.ts:49`; UI `SubprojectsTab.tsx:71-79` | Correctness is good (whole-order atomic RPC, no `max()+1` races). Usability is not: ordering is ↑/↓ **one position per click, one round trip per click**. Moving stage 11 to position 1 is 10 clicks and 10 network calls. `@dnd-kit` is already a dependency (`package.json`) and is unused here. |
| 6 | Edit stage | PARTIAL | `EditProjectModal` mounted at `app/client-portal/project-core/[projectId]/page.tsx:79`; `pcUpdateProject` `lib/portal/projectCore.ts:450` (optimistic concurrency via `p_expected_updated_at`) | Editing works, but only from inside the stage's own page. There is no inline rename in the parent's stage list, so renaming 11 stages is 11 navigations. |
| 7 | List stages of a parent | READY | `SubprojectsTab.tsx:36` (`project_subprojects_summary` + `project_hierarchy_parent_dashboard`), tab gated on master at `ProjectOps.tsx:191` | Rollup is explicitly derived-only and never written back to the parent (`SubprojectsTab.tsx:125`). No pagination, which is fine at 11 rows. |
| 8 | Add many deliverables | BLOCKER | UI A: `components/portal/projectcore/ProjectModules.tsx:114-127` (one inline row at a time). UI B: `components/portal/AdminDeliverables.tsx:189-253` (modal, one at a time). Bulk exists only server-side: `docs/project_core_ABSOLUTE_FINAL_RUNME.sql:1862-1871` | **Two independent blockers.** (a) No bulk/paste/CSV entry anywhere in the UI — 79 deliverables is 79 form submissions across 11 stage pages. (b) The one bulk path (template apply) writes `type` straight through at `project_core_ABSOLUTE_FINAL_RUNME.sql:1868` while `docs/phase0_migration.sql:219` constrains `type IN ('video','photo','other')`, so a spec containing `design`/`print`/`live_stream` raises `23514` and **aborts the entire apply**, leaving a partial project. Same exposure in `pc_deliverable_upsert` (`:1655`) for any importer. |
| 9 | Versions / files / links | PARTIAL | System A: `project_deliverable_versions` — `lib/portal/projectCore.ts:506-510`, upload + `file_path`. System B: `deliverable_versions` — `lib/portal/deliverables.ts:165-170` (`deliverable_version_summary`). Both render in the same panel: `ProjectModules.tsx:147` and `:150` | Everything asked for exists (new version never overwrites, storage-backed files, external links, final master upload `deliverables.ts:213-227`). The defect is that **two separately-numbered version lists are shown for the same deliverable in the same tab**. A v2 in one list is not the v2 in the other. This is a real correctness-of-understanding hazard during review, not a missing feature. |
| 10 | General + timecode comments | READY | Client: `lib/portal/deliverables.ts:50-72` (`timecode_seconds`, `page_number`, `pos_x/pos_y`), helpers `:13-30`. Staff-internal: `lib/portal/projectCore.ts:518` (`pc_deliverable_comment`, `p_timecode`). UI grouping + resolve: `components/portal/DeliverableNotesPanel.tsx:33-43`, `lib/portal/deliverables.ts:85-89` | Comments are grouped per version and each is resolvable with a Kian response. Verified by reading the code only. |
| 11 | Internal review | READY | Status in the CHECK: `docs/phase0_migration.sql:226`; adding a version resets to `internal_review`: `project_core_ABSOLUTE_FINAL_RUNME.sql:1703`; clients cannot see it: RLS `phase0_migration.sql:886-891` | |
| 12 | Client review | READY | RLS exposure `phase0_migration.sql:886-891`; client UI `components/portal/DeliverableReview.tsx:27,120`; decision path `lib/portal/deliverables.ts:173-193` → `/api/integrations/project/review` → `client_review_version` | Only the client **owner** may decide (`canApprove` → `is_client_owner`, `phase0_migration.sql:376`). |
| 13 | Revision request | READY | `VersionHistory.tsx` decide-flow; mandatory note on the staff path `ProjectModules.tsx:196-200`; decision recorded on the version *and* the deliverable | |
| 14 | Approval | READY | Single safe path documented at `lib/portal/deliverables.ts:112-118` | That comment records a real historical trap: the removed direct insert into `deliverable_reviews` set the deliverable to `approved` without setting `deliverable_versions.decision`, after which `admin_set_final_version` raised `version_not_approved` **forever**. Only the RPC path is wired now. Do not reintroduce a direct insert. |
| 15 | Final delivery | READY | `setFinalVersion` `lib/portal/deliverables.ts:194`; gate `:125-134`; admin control `AdminDeliverables.tsx:326-408`; server route `app/api/portal/deliverable-download` | Final download requires `final_delivered` **and** an explicit admin payment confirmation, plus an optional window/limit policy. Intentionally strict; make sure the owner expects the second gate. |
| 16 | Progress calculation | PARTIAL | `docs/project_progress_RUNME.sql:69-79`; parent rollup `lib/portal/projectHierarchy.ts:36-39`, `SubprojectsTab.tsx:100-125` | Two honest behaviours worth keeping: an empty child set yields `null` → "غير متاح", never a fake 0%; and the rollup is display-only. The gap: progress counts a deliverable as a **whole unit** (approved/final fraction). A recurring item at 3 of 7 units, or a 300-copy print run, contributes nothing partial. For a project whose value is mostly recurring output, headline progress will understate reality. |
| 17 | Search and filters | BLOCKER | Project level: `ProjectCoreDashboard.tsx:40-41,66,150-156` (server-side search + real filter cards). Deliverable level: `ProjectModules.tsx:112-155` renders the entire list with **no** search, status filter, stage filter or sort; `pcListDeliverables` `lib/portal/projectCore.ts:440` has no `limit` and only `order=created_at.desc` | With 79 rows the deliverables tab is a scroll-only list ordered by creation time — the one ordering nobody wants. Finding "the design item in stage 08" is manual scanning. Project-level search is READY and server-side; only the deliverable level is blocked. |
| 18 | Permissions | READY | `can_manage_projects()` / `can_edit_project()` `docs/project_platform_authz_hardening_RUNME.sql:81-87`, enforced in `pc_deliverable_upsert` (`:1651`), version add (`:1689`), review (`:1717`); client decisions owner-only (`phase0_migration.sql:376`) | Every deliverable mutation is gated server-side, not just in the UI. Note for later: the granular permission layer (`emp_has_permission`) is **not** applied to deliverables — they still use the coarse `staff_role` model. Not an escalation, but an inconsistency. |
| 19 | Client visibility | PARTIAL | `public.deliverables` has **no** `client_visible` column (`docs/phase0_migration.sql:215-231`); visibility is derived from status alone (`:886-891`). Versions *do* have `client_visible` (`lib/portal/projectCore.ts:503`, `ProjectModules.tsx:240`). Client project list is flat: `lib/portal/projects.ts:12` (`projects?select=*`, no scope/parent handling) | Two consequences. (a) "Visible to the client but not yet under review" is unrepresentable — a deliverable is either hidden or already in a client workflow state. (b) Because a subproject inherits the master's `client_id`, the client sees **12 sibling project cards** (1 parent + 11 stages) with no hierarchy grouping. That is the single most visible client-facing gap. |
| 20 | Internal notes | READY | Table + staff-only RLS `project_core_ABSOLUTE_FINAL_RUNME.sql:1641-1644`; write `lib/portal/projectCore.ts:518`; read `:520`; UI inside `ProjectModules.tsx` `DeliverableVersions` | Read is capped at `limit=100` per deliverable — acceptable, worth knowing. |
| 21 | Working with NO due_date | READY | Column is nullable: `project_core_ABSOLUTE_FINAL_RUNME.sql:1615`; upsert stores null `:1657`; the reminder scan requires `due_date is not null` `:2137`; UI renders the date only when present `ProjectModules.tsx:135` | **This works correctly**: a dateless deliverable is never treated as overdue and never triggers reminder mail. The residual gap is semantic, not broken — there is no explicit "awaiting schedule" state, so "no date yet" and "someone forgot the date" look identical, and no view lists the undated set. |
| 22 | Performance at 79–200 deliverables | BLOCKER | Scoped to the **legacy admin screen**; the project-core tab is fine. `components/portal/AdminDeliverables.tsx:157` and `:163` mount `VersionHistory` **and** `DeliverableNotesPanel` for **every** row unconditionally; each fires on mount (`VersionHistory.tsx:43-47`; `DeliverableNotesPanel.tsx:33-43`, 2–3 calls). `DeliverableReview.tsx:45-50` loops `downloadState()` **sequentially** per final deliverable. `lib/portal/deliverables.ts:76-82,104-110` build `in.(...)` with every id in the URL. No pagination (`projectCore.ts:440`) | 79 rows ≈ 300 concurrent PostgREST calls on one page load; 200 rows ≈ 800. 200 UUIDs in an `in.(...)` query string is ≈ 7.5 KB, near common 8 KB header limits. **Measured statically from the call graph — not reproduced at runtime.** By contrast the project-core deliverables tab is safe: its panels only mount inside `open === d.id` (`ProjectModules.tsx:142`). |
| 23 | RTL and mobile | PARTIAL | `app/layout.tsx:117` `<html lang="ar" dir="rtl">`; `dir="rtl"` on panels (`SubprojectsTab.tsx:91`, `CreateProjectWizard.tsx:89`); mobile tab `<select>` at `ProjectOps.tsx:455` (`sm:hidden`) and scrollable desktop bar `:479`; logical properties e.g. `AdminDeliverables.tsx:100` (`marginInlineEnd`) | Layout and direction are genuinely good. The weak spot is `window.prompt`-driven flows: `SubprojectsTab.tsx:50,61,64` and the promote/demote prompts in `ProjectOps.tsx`. Worst case is "move subproject", which prints a numbered list into a `prompt()` and asks the user to **type the number** — near-unusable on a phone with 11 stages. |

---

## 2. What is ready

The **spine of the workflow is real and server-enforced**, not UI theatre:

- Parent → stage → deliverable structure exists, with the client inherited down and immutable.
- The full review chain — internal review → client review → revision → approval → final delivery —
  is implemented end to end, with the decision, the note and the version decision written together
  by one RPC. The historically broken direct-insert path has been removed and documented.
- Versioning never overwrites; files land in a private bucket and finals are served via short-lived
  signed URLs behind a payment gate.
- Comments support general, timecode, page and pin anchoring, grouped per version and resolvable.
- Authorization is enforced in SQL on every mutation, and RLS keeps clients out of internal states.
- **Dateless deliverables are handled correctly** — nullable column, no false overdue, no reminder
  spam.
- Rollups refuse to fake a number: no visible children yields "غير متاح", not 0%.
- RTL is global and the layout is responsive.

## 3. Real blockers

Four, in order of how hard they hit go-live:

1. **Bulk deliverable entry does not exist (path 8).** 79 items = 79 manual form submissions spread
   over 11 stage pages. This alone makes the acceptance dataset impractical to enter by hand.
2. **The one bulk path corrupts on mixed types (path 8).** `type` is passed through unvalidated
   into a three-value CHECK, so an import containing `design`/`print`/`live_stream` aborts the whole
   template apply with `23514`. Whoever builds the importer must map to `video|photo|other` (the
   fixture ships that mapping table) or the CHECK must be widened deliberately.
3. **No deliverable-level search, filter or sort (path 17).** A 79-row creation-ordered list is not
   an operable surface.
4. **The legacy admin deliverables screen fans out per row (path 22).** ~300 requests at 79 rows.
   This is the one blocker that can look like "the site is broken" rather than "the site is clumsy".

Two constraints that are not defects but must be **accepted explicitly**, not discovered later:

- The hierarchy is **two levels, permanently** (path 4).
- A deliverable's client visibility **is** its status; there is no independent flag (path 19), and
  the client sees the parent and its stages as flat siblings.

## 4. What was fixed

**Nothing.** This task owned three files only — this audit, the fixture, and the acceptance tests.
No platform code, SQL, or component was modified. Every blocker above is reported, not repaired.

## 5. What was deferred, and why

| Deferred | Why |
|---|---|
| All platform fixes for paths 4, 8, 17, 19, 22 | Out of scope for this task; they touch shared components and SQL owned by other work. Each needs its own review. |
| Widening `deliverables.type` | A CHECK change is a production migration with data implications. The fixture instead ships an explicit `kind → db_type` mapping so an importer can be correct **without** touching the schema. |
| Any real `MISBAR 10` project, import, or data load | Explicitly prohibited. The fixture is synthetic and marked as such in three places. |
| Runtime verification of every verdict | No live environment was available. Rows that could not be observed say so. |
| Asserting 79 as a required count | The real workbook is absent; 79 is recorded as an unverified owner expectation. The fixture deliberately carries a different count so the two can never be confused. |

## 6. Impact on go-live

- **Can the platform model this project's shape today?** Yes. Parent + 11 ordered stages + per-stage
  deliverables + versioned client review is exactly what the platform already does, and it does it
  generically.
- **Can a person actually load and run it today?** Not comfortably. Data entry (blockers 1–2) and
  finding anything afterwards (blocker 3) are the practical barriers; the admin-screen fan-out
  (blocker 4) is the reliability risk.
- **Recommended order:** bulk entry + type mapping first (they unblock loading anything at all),
  then deliverable search/filter, then lazy-mount the legacy admin panels. Client-facing hierarchy
  grouping (path 19b) is the highest-value cosmetic fix once the operational ones land.
- **Before acceptance:** re-open the owner's real workbook and confirm the true stage and deliverable
  counts against `owner_expectation` in the fixture. Until that happens, 11/79 is a claim, not a fact.
