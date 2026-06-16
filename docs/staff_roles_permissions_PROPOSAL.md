# Staff roles & permissions — PROPOSAL ONLY (do not implement yet)

Status: **planning document.** No SQL, no RPCs, no UI in this hotfix. This plans
the staff-permissions layer so it can be implemented safely *after* the
client→project linking addendum lands.

## What already exists (reuse, don't reinvent)

- `profiles.account_type` = `lead | client | admin`; `public.is_admin()` ⇔
  `account_type = 'admin'` (admin role is hard-restricted to two approved emails
  in `admin_set_account`).
- `project_members.role` already has Kian-side values:
  `kian_admin | kian_manager | kian_editor | kian_photographer | kian_viewer`
  (plus `client_owner | client_member`).
- `public.is_kian_member(p)` = `is_admin() OR project_role(p) LIKE 'kian\_%'` —
  i.e. a per-project staff membership already grants project READ access via RLS.
- Quotes / offers / financial reads are **admin-only** RLS today (so a non-admin
  staff member already cannot see them).
- Deliverable writes (`admin_add_deliverable`, `admin_set_deliverable`,
  `admin_add_final_asset`) and account/status writes are **`is_admin()`-only**.

**Gap:** there is no *global* staff role beyond `admin`. "Staff" today means
"added as a `kian_*` member on a specific project" (read-only at the table level,
since all staff *writes* go through `is_admin()` RPCs). To give editors scoped
*write* ability without making them full admins, we need (a) a global staff role
and (b) membership-scoped RPCs.

## 1) Role matrix

| Capability | super_admin / owner | admin / manager | support / دعم | editor / مونتير | sales / مبيعات | readonly / مشاهدة |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Manage accounts (type/status/level) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Manage staff roles | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| System settings | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Create / link / unlink projects | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Set project stage | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| See **all** projects | ✅ | ✅ | ✅ | ❌ (assigned only) | ❌ | ✅ (all, read) |
| See **assigned** projects | ✅ | ✅ | ✅ | ✅ | ✅ (own sales) | ✅ |
| Add/upload review preview links | ✅ | ✅ | ❌ | ✅ (assigned) | ❌ | ❌ |
| Set deliverable → client_review / revision | ✅ | ✅ | ❌ | ✅ (assigned) | ❌ | ❌ |
| **Set final_delivered (تم التسليم النهائي)** | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| See client approvals / revisions / notes | ✅ | ✅ | ✅ | ✅ (assigned) | ❌ | ✅ |
| Reply in client/project messages | ✅ | ✅ | ✅ | ✅ (assigned) | ✅ (own) | ❌ |
| See quotes / offers / pricing / financials | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ |
| Delete (soft) projects | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Email on client review (assigned) | ✅ | ✅ | optional | ✅ | ❌ | ❌ |

**Final-delivery rule (hard):** only `super_admin / admin / manager` may set
`final_delivered`. Enforced in the RPC, not just the UI.

## 2) Tables / columns needed

- `profiles.staff_role text` — `null` for non-staff; one of
  `super_admin | admin | manager | support | editor | sales | readonly`.
  (Keep `account_type='admin'` as today for the two owner emails; `staff_role`
  layers richer staff identity on top. `is_admin()` stays = the two emails.)
- New helpers (SQL functions, `security definer`, `stable`):
  - `public.staff_role()` → current user's `profiles.staff_role`.
  - `public.is_staff()` → `staff_role is not null`.
  - `public.can_manage_projects()` → `is_admin() OR staff_role in ('super_admin','admin','manager')`.
  - `public.can_final_deliver()` → same set as above (the final-delivery gate).
  - `public.can_edit_project(p)` → `can_manage_projects() OR (staff_role='editor' AND project_role(p) = 'kian_editor')`.
  - `public.can_see_financials()` → `is_admin() OR staff_role in ('super_admin','admin','manager','sales')`.
- No new join table required — editor↔project assignment reuses
  `project_members` with `role='kian_editor'` (created by the linking RPC from the
  other proposal, generalized to staff users).

## 3) RLS policy changes

- **projects / project_members / deliverables / deliverable_reviews / client_comments /
  project_messages**: widen the existing READ policies from `is_admin()` to
  `is_admin() OR (is_staff()-scoped)`:
  - `support` / `readonly` / managers → read all (no financial tables).
  - `editor` / `sales` → read only rows for projects where they are a `kian_*`
    member (already expressible via `project_role(p) IS NOT NULL`).
- **quote_requests / offers / financial columns**: keep `is_admin() OR
  can_see_financials()` — editors/support/readonly excluded.
- **NEVER** grant table-level INSERT/UPDATE to staff. All staff writes continue
  to go through `security definer` RPCs (defense-in-depth, same pattern as today).
- No policy should be loosened to `to authenticated` unconditionally.

## 4) RPCs needed (all `security definer`, role-checked, `search_path=public`)

- `admin_set_staff_role(p_user uuid, p_role text)` — `super_admin`-only;
  validates the enum; cannot self-escalate to `super_admin`.
- `staff_add_deliverable(p_project, p_title, p_type, p_preview_url, p_vimeo_url, p_status)`
  — allowed if `can_edit_project(p_project)`; **rejects `p_status='final_delivered'`**
  and `'approved'` for editors (editor may only create draft/internal_review/client_review).
- `staff_set_deliverable(p_dlv, p_status, p_preview_url, p_vimeo_url)` — allowed if
  `can_edit_project(deliverable's project)`; **rejects `final_delivered`** unless
  `can_final_deliver()`. (Existing `admin_set_deliverable` stays admin-only and
  remains the only path to `final_delivered`.)
- `admin_add_final_asset` / final-delivery transitions — gate on `can_final_deliver()`.
- Project create/link/unlink — gate on `can_manage_projects()` (supersedes the
  `is_admin()` checks in the linking proposal once staff roles exist).

## 5) UI plan

- **Accounts page** (super_admin only): a "الدور الوظيفي / Staff Role" control per
  account → `admin_set_staff_role`. Hidden for everyone else.
- **Role-aware tabs** (`components/portal/nav.ts`): show Quotes/Offers/Accounts/
  Settings only when the role allows; editors see only Projects (assigned).
- **Project detail**: editors get the deliverable add/preview controls and the
  status dropdown **without** the `final_delivered` option (and without the
  project-stage control); they see the client-notes/review history (read).
- **Server-enforced, not UI-only**: every hidden control must also be impossible
  via RPC for that role — the UI hide is cosmetic; the RPC check is the real gate.

## 6) Email notification plan for the assigned editor

- Today `trg_review_created` notifies admins (`notify(null,'admin',…)`) in-portal
  on client approve/revision. Extend it to also `notify(<editor user_id>, 'user',
  …)` for each `kian_editor` member of that project (in-portal bell).
- Email: reuse the existing **Apps Script `portal_notify`** path
  (`lib/portal/notifyEmail.ts`). On `review_update`, additionally send to the
  assigned editor's email. Two safe options:
  - (preferred) resolve the editor email **server-side** in the Apps Script from a
    small allow-list / lookup, so client code never reads staff emails; or
  - emit the editor's email from an **admin/staff** browser context only (never the
    client's) — the client→admin email already routes to the Kian inbox server-side.
- New event suggestion: `editor_review_update` (assigned-editor copy) with project
  name, deliverable, action, exact note. Delivery still requires the Apps Script
  `doPost` handler (see docs/portal_email_notifications.md). Not live until added.

## 7) Risks of a UI-only implementation (why we will NOT do that)

- **Hiding a button is not a permission.** With direct PostgREST + RLS, any
  authenticated user can call the REST endpoint regardless of what the UI shows.
  If editor restrictions are UI-only, an editor could still hit an admin RPC or a
  granted table write. Permissions MUST be enforced in RLS + `security definer`
  RPC role checks; the UI only mirrors them.
- **Final-delivery leakage:** a UI-only block on `final_delivered` would be
  bypassable — it must be a server check (`can_final_deliver()`), or editors could
  mark final delivery.
- **Financial exposure:** quotes/offers must stay RLS-gated; never rely on hiding
  a tab.
- **Privilege escalation:** staff-role assignment must be `super_admin`-only at the
  RPC layer with no self-escalation, or a manager could grant themselves owner.

## Suggested implementation order (post-hotfix)

1. Run the client→project linking addendum (separate proposal).
2. Add `profiles.staff_role` + helper functions + role-scoped RLS (one migration).
3. Add the staff RPCs (`admin_set_staff_role`, `staff_*_deliverable`).
4. Wire role-aware UI (tabs, account control, editor deliverable controls).
5. Extend review notifications + Apps Script `portal_notify` for assigned editors.
6. QA matrix: verify each role can do exactly its row above — and **cannot** do
   anything outside it — by calling the REST API directly, not just via the UI.
