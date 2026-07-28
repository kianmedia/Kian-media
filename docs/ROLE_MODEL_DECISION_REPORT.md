<!-- تقرير قرار معماري — تحليل فقط. لا Migration، ولا ربط بوّابات، ولا SQL يُشغَّل. -->
<!-- الحالة: S4: BLOCKED — ROLE MODEL DECISION REQUIRED -->

# ARCHITECTURE DECISION REPORT — Kian Portal Role Hierarchy

**Scope:** analysis only. No file was written, edited, or created. No SQL is proposed for execution. Every count below is repo-file analysis; where production truth cannot be derived from files, I say so.

---

## 1. THE REAL CURRENT MODEL

The schema knows **two** privileged tiers, and they are not layered — they are **duplicates**.

**Owner** = `profiles.account_type = 'admin'` AND `account_status = 'active'`.
Encoded as `is_admin()` — `docs/phase0_migration.sql:325-328`, body `select exists (...)`.
It is a **closed set of exactly two rows**, enforced twice: seeded at `docs/phase0_migration.sql:133-134`, and gated at `docs/phase1_addendum_s1.sql:152-157`, which raises `admin role is restricted to the two approved emails` unless the target's `lower(email)` is `kianalebtikar@gmail.com` or `manager@kianmedia.com`. Column default is `'lead'` and the signup trigger inserts only `(id, email)`, so no row acquires it by accident. **No RPC can create a third Owner.**

**Super Admin** = `profiles.staff_role = 'super_admin'` AND `account_status = 'active'`.

**Where super_admin is treated AS owner — plainly:**

```sql
-- docs/staff_roles_task_assignment_RUNME.sql:58-63
create or replace function public.is_owner() returns boolean ... as $$
  select public.is_admin()
      or exists (select 1 from public.profiles
                 where id = auth.uid() and account_status='active'
                   and staff_role = 'super_admin');
$$;
```

That single `or` is the entire tier collapse. From that line forward, **every authorization decision in the platform that says "owner" means "owner or super_admin."** `can_manage_staff() = coalesce(is_owner(), false)` (`docs/project_platform_authz_hardening_RUNME.sql:76`), so a super_admin can grant staff roles. `civ_can_admin()`, `pc_finance_is_admin()`, `mfa_admin_set_mode()`, project soft-delete/restore, HR employee deletion, sensitive-permission granting — all of it.

**A real Admin tier does not exist.** There is no `'admin'` value in the 12-role `staff_role` allow-list (verified live winner, `docs/portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:33-37` and `:45-47`), and `account_type` cannot host it (`check (account_type in ('lead','client','admin'))`, and `'admin'` there already means Owner).

**Three asymmetries worth knowing before anything is designed:**

- **super_admin is owner-equivalent for authorization but not for account repair.** `admin_set_account` gates on `is_admin()`, not `is_owner()`. A super_admin cannot restore a broken owner account.
- **Granting super_admin is a one-way door.** `admin_set_staff_role` refuses any target already holding `account_type='admin'` or `staff_role='super_admin'` ("protected owner account"). Demotion is impossible through any RPC, including the true owner's. It requires direct SQL.
- **super_admin proliferation is currently unbounded.** `can_manage_staff()` includes super_admin, so any super_admin can mint further super_admins without limit. The fix — `assert_can_grant_role()` at `docs/authz_identity_hardening_s4pre_RUNME.sql:63-89`, which restricts granting `'super_admin'` to `account_type='admin'` — **exists, is written, is reviewed, and is wired to nothing.** Its own self-test at `:115` says so.

**And the UI already contradicts the requested hierarchy in both directions:**
- `lib/portal/roles.ts:80` labels `super_admin` as **`ar: "مالك"`** — Arabic for *Owner*.
- `lib/portal/mfa.ts:573-575` maps `staff_role='super_admin'` → `"super_admin"` and `account_type='admin'` → `"admin"`, ranking the two protected owner emails **below** super_admin. The `"owner"` arm of `MfaRole` is unreachable.

---

## 2. THE GAP

| Owner wants | Schema has |
|---|---|
| **Owner** | `account_type='admin'` — 2 hardcoded emails, not grantable |
| **Super Admin** | `staff_role='super_admin'` — **but `is_owner()` makes it identical to Owner** |
| **Admin** | **nothing** — no value, no column, no predicate |
| **Manager** | `staff_role='manager'` — real, named in `can_manage_projects()` |
| **Employee** | `staff_role` ∈ 9 other values, or the 117-permission model |

Three distinct gaps, of different kinds:

1. **A missing value, not a missing predicate.** The Admin tier has nowhere to live. This is a vocabulary decision before it is an engineering one.
2. **A collapsed boundary.** Owner and Super Admin are the same thing to 99 authorization sites. The hierarchy the owner wants requires *separating* them, which is the expensive half.
3. **`staff_role` is a single column.** A super_admin cannot simultaneously be a `'manager'`. So if `is_owner()` stopped matching super_admin, that account would fail **every** `is_owner() or staff_role() in (...)` disjunct at once — it does not become an Admin, it drops **below Manager**. This single mechanical fact governs the rest of the report.

---

## 3. EVERY PLACE `is_owner()` IS USED — CLASSIFIED

### The counting, honestly

`grep -rn "is_owner" docs/*.sql` → **184 lines, 54 files**. That number is inflated. Filtering comments, `to_regprocedure` preflights, exception strings, the two definition headers, the unrelated `rental_evidence_is_owner(text,boolean)`, and the unrelated plpgsql local `v_is_owner` (which means "this renter owns this rental row"):

| Unit | Count |
|---|---|
| Genuine invocation **lines** in live files | **99** |
| …of which are dead (superseded by `project_platform_authz_hardening_RUNME.sql`) | 5 |
| **Distinct live OBJECTS with a direct `is_owner()`** | **74** (63 functions + 11 RLS policies) |
| **Distinct functions whose behaviour changes for a super_admin (transitive)** | **~387** |
| **Distinct RLS policies whose behaviour changes (transitive)** | **~116** (110 SELECT, 6 `for all`) |

The 99→74 collapse is duplicate definitions of the same object across files (`civ_can_finance` ×3, `project_core_set_stage` ×3, `wa_contacts_read` ×3, and six more ×2) plus multiple lines inside one function body.

**The 74 is the right unit for "how many places would I edit." The ~387 / ~116 is the right unit for "what breaks."** Both matter, and the second is the one that decides this report.

### Classification of the 99 invocation lines

| Class | Meaning | Count |
|---|---|---|
| **(a) genuinely Owner** | top authority, sole gate | **12** |
| **(b) actually "a privileged admin"** | super_admin inclusion is **load-bearing** | **71** |
| **(c) ambiguous** | intent never written down | **16** |

**Of the 71 class-(b) sites, exactly 2 objects are already immune**, because a later author named `'super_admin'` explicitly alongside `is_owner()`:

```sql
-- docs/whatsapp_routing_phase2b_RUNME.sql:38-40
select public.is_staff() and (
      public.is_owner()
   or public.staff_role() in ('manager','super_admin')
```

(also `whatsapp_routing_multidept_RUNME.sql:56`). The older `wa_can_read` at `whatsapp_inbox_RUNME.sql:142` has only `'manager'` and is **not** immune. So later authors had *started* separating the tiers by hand — evidence the collapse was always felt as a defect, and evidence of how slow the manual path is.

### The class-(a) list — the only 12 sites a narrowing is actually *for*

`pc_finance_settings_set` approve-limits (`project_core_FINANCE_RUNME.sql:224,225`) · approve-above-limit (`:304`) · over-budget override (`:312`) · delete approved/paid expense (`:346`) · finance-closure override (`project_core_ABSOLUTE_FINAL_RUNME.sql:1493`) · `pc_finance_reopen` (`:1519`) · `hr_owner_delete_employee` (`portal_hr_employee_portal_RUNME.sql:651`) · owner-only claims probe (`mfa_probe_claims_s1b_RUNME.sql:43`) · `mfa_admin_set_mode` (`mfa_foundation_batch_s1_RUNME.sql:148`) · `can_manage_staff` (`project_platform_authz_hardening_RUNME.sql:76`).

### The class-(b) shape — why it dominates

27 of the 99 sites are **derived-predicate definitions** where `is_owner()` is the first disjunct. Their own occurrence counts across `docs/*.sql`:

```
can_manage_projects 250   civ_can_manage 249   can_edit_project 108
emp_has_permission   78   can_manage_hr   70   civ_can_finance  66
civ_can_admin        50   staff_reads_all 46   can_manage_quotes 36
can_see_financials   27   pc_can_see_finance 27  exec_can 19
can_manage_custody   18   can_see_invoices 15   wa_can_read 12
```

The authors' own comments settle intent: `project_core_FINANCE_RUNME.sql:174` — `select public.is_owner()  -- owner/super_admin/admin(account)`; `portal_custody_inventory_system_v1_RUNME.sql:21` — *"طبقة الإدارة العليا (مالك/سوبر/أدمن)"*; `permission_catalog_RUNME.sql:396` raises **"الصلاحيات الحساسة يمنحها المالك/السوبر-أدمن فقط"** — narrow `is_owner()` and a super_admin gets an error telling them the action is reserved for super_admins.

### RLS: the silent-failure surface

All **11 distinct policies** that name `is_owner()` directly are `for select` — verified individually. Transitively, **110 of the 116 affected policies are SELECT**. An RLS `using` clause that stops matching returns **an empty result set, not an error**. Only 6 policies (`project_costs_write`, `project_tags_write`, `project_templates_write`, `project_tag_map_write`, `project_deliverable_versions_write`, `task_files_write`, all `for all` in `project_core_FINAL_RUNME.sql`) would fail loudly.

Worst case found: `portal_hr_employee_portal_RUNME.sql:262` — `using (can_manage_hr() and (is_deleted = false or is_owner()))`. **Double break**: `can_manage_hr()` also narrows, so a super_admin loses the entire HR table, not just soft-deleted rows.

One more mechanic: `is_staff() = is_admin() or staff_role() is not null`. A narrowed super_admin **still passes** every outer `is_staff()` guard and then fails the inner `is_owner()` — they remain "staff" while seeing nothing.

> **THE BLAST RADIUS NUMBER: redefining `is_owner()` changes the behaviour of ~387 functions and ~116 RLS policies, 110 of which fail silently. It is not a role change. It is a platform-wide de-privileging.**

---

## 4. THE THREE OPTIONS

### OPTION A — new `staff_role` value for the Admin tier

*(Assessed under a **non-colliding** value. The literal string `'admin'` is assessed separately in §5 and is disqualifying.)*

**Advantages**
- **Inert by construction.** No existing predicate uses a catch-all — every one enumerates roles literally (`staff_role() in ('manager')`, `in ('manager','hr')`, `in ('manager','custody_officer')`). A new value therefore grants **nothing, anywhere**, on day one. Every capability is an explicit, individually-reviewed addition.
- Uses the column the platform already treats as the staff tier axis; 38 TS files already agree on that vocabulary.
- Appears in the existing Staff dropdown — the owner *sees* the hierarchy.
- Under a non-colliding name, the **compiler enforces** one critical edit (`components/portal/nav.ts:36`, `Record<ViewRole, string[]>`).

**Change size — hard blockers (tier does not exist / cannot be assigned without these): 6 sites**

| # | Site | Failure if missed |
|---|---|---|
| 1 | `docs/portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:33-37` — `profiles_staff_role_check` | CHECK violation on write |
| 2 | same file `:45-47` — `admin_set_staff_role` allow-list | `invalid staff role: %` |
| 3 | `lib/portal/types.ts:14-16` — `StaffRole` union | compile error downstream |
| 4 | `components/portal/nav.ts:36` — `Record<ViewRole,string[]>` | **compile error (the good kind)** |
| 5 | `lib/portal/roles.ts:100-102` — `STAFF_ROLE_OPTIONS` | silent: tier unassignable in UI |
| 6 | `lib/portal/roles.ts:79-92` — `STAFF_ROLE_LABELS` | **runtime TypeError** — `AdminStaff.tsx:115` does `STAFF_ROLE_LABELS[k].ar` with no `?.`, crashing the only page where the role can be set |

**Revert hazards — 4 stale shipped copies of the same vocabulary**: `docs/staff_roles_task_assignment_RUNME.sql:39-41` (7 roles) and `:178-179`; `docs/staff_assignment_notifications_finance_ADDENDUM.sql:20-23` (8 roles) and `:31-32`. Re-running either **narrows** the CHECK and strips `finance, photographer, lighting_tech, camera_assistant, custody_officer`.

**Decision surface — ~62 sites** (50 distinct functions + 12 policy definition sites) where "does Admin belong here?" is an owner ruling with **no compiler and no error**. 119 non-comment lines carry a `staff_role` literal comparison across 40 SQL files. 16 of those 50 functions call **no helper predicate at all** and can never inherit anything.

**RLS impact:** **zero on day one.** 12 policy sites inline a `staff_role()` literal; all 12 are `for select`; none needs editing unless Admin is granted that read. 264 `create policy` statements gate on a helper predicate and inherit any future widening for free.

**RPC impact:** 1 mandatory (`admin_set_staff_role` allow-list). Everything else optional and incremental.

**Effect on existing accounts:** **none.** Additive CHECK, matches zero rows. No backfill required *for the value*. (Migrating today's super_admins **down** into the new tier is a different question — see Reversibility.)

**Reversibility:** high. `update profiles set staff_role = <previous>` for the handful of accounts; drop the value from the CHECK. Nothing else changed.

**Lockout probability:** **near zero** — `is_owner()`, `is_admin()`, and `admin_set_account` are untouched.

**MFA/S4 compatibility:** **requires an edit, or the tier is silently exempt.** `lib/portal/mfa.ts:576` routes any unrecognised `staff_role` to `"employee"`, and `shouldChallengeMfa` (`:562`) admits only `owner|super_admin|admin`. A new privileged tier would **never be challenged**, with no error and no log line. The server gate has the same shape at `docs/mfa_write_gate_s4a_RUNME.sql:75`. Both must move in the same change.

---

### OPTION B — new column on `profiles` (e.g. `privilege_tier`)

**Advantages**
- No collision with the `staff_role` vocabulary that 38 TS files already share.
- Orthogonal: an Admin could also be a `finance` or `hr` role.

**Risks**
- **Reproduces the governing incident's shape.** A new column defaults to NULL on every existing row. `privilege_tier = 'admin'` yields **NULL**, not false, and three-valued logic propagates it through `OR`/`AND` chains into `SECURITY DEFINER` gates. In the repo's dominant guard form — `if not public.gate() then raise exception ...` — `NOT NULL` is NULL, **the raise never fires**, and the guard becomes dead code inside a function that bypasses RLS. That is verbatim the `company_execution_report` mechanism. Mitigable (`not null default 'none'` + `coalesce` everywhere), but each of ~30 function edits is a fresh chance to reintroduce it.
- **A second privilege axis.** Two columns now answer "how privileged is this account," and they can disagree.
- **Silent deserialization failure.** The column is absent from every explicit PostgREST `select=` list until each is edited (`lib/portal/auth.ts`, `lib/portal/admin.ts`, `lib/server/hrAuth.ts:57-64`, `app/api/integrations/hr/my-tasks/route.ts:35`, `app/api/rental/evidence/upload-url/route.ts:50`, `app/api/integrations/project/notify-admin/route.ts:130`, `lib/whatsapp/inbox.ts:80`, `lib/portal/projectCore.ts:448,760`, + 8 recipient queries). Absent ⇒ `undefined` ⇒ falsy ⇒ **the tier appears not to exist rather than erroring.**

**Change size:** ~34 files to edit, ~**30 mandatory functions** — *more* than A, not fewer. The 13 base gates plus the ~17 functions that inline a `staff_role` list and never call `is_owner()`, which structurally cannot inherit a base-gate change.

**RLS impact:** identical to A — the same 12 inline SELECT policies, none of which reads a new column any more than they read a widened `staff_role`.
**RPC impact:** a new grant RPC must be built (`admin_set_staff_role` does not manage this column).
**Effect on existing accounts:** every row gets a new column; the default value *is* the migration.
**Reversibility:** moderate — drop the column, but only after unwinding ~30 function edits.
**Lockout probability:** low-to-moderate; the NULL-collapse path is the exposure.
**MFA/S4:** same required edits as A, **plus** `mfaRoleOf` must learn to read a second field.

**And it still cannot avoid `ViewRole`** — `nav.ts:36` keys tabs by `ViewRole`, so a synthetic view value must be minted regardless, and `STAFF_ROLE_OPTIONS`/`AdminStaff.tsx` would not expose the tier at all, requiring a **second admin control to be built**.

---

### OPTION C — stay at two tiers; express "Admin" through the permission engine

**Advantages**
- **Zero SQL files, zero functions, zero policies, zero TS types.** Only an optional display label.
- The extension point exists **and is already spliced into a coarse gate**: `docs/custody_profession_bridge_RUNME.sql:39-42` defines `civ_can_manage()` as `is_owner() OR staff_role() IN (...) OR emp_can(...)` — written for exactly this case. `emp_has_permission(uuid,text)` (`permission_catalog_RUNME.sql:212`, caller-defaulted overload at `:246`) is designed to be callable inside RLS.
- 117 normalized permissions already exist and are already administered through a UI.

**Risks**
- **It does not deliver what the owner asked for.** The Staff dropdown shows `مدير` (Manager). There is no visible "Admin" tier. The commercial hierarchy exists only as a profession name.
- Permission grants are **rewritable by a Manager today** — `permission_catalog_RUNME.sql:219,258` gate on `is_admin() or can_manage_projects()`, and `can_manage_projects()` includes `staff_role='manager'`. A tier boundary expressed purely as permissions is editable by a role two levels below it, until `can_manage_identity()` is wired.
- Sensitive-permission propagation **fails silently** for non-owners: `permission_catalog_RUNME.sql:424,440` filter with `and (p.sensitivity = 'normal' or public.is_owner())` — the copy/template operation reports success while quietly dropping every sensitive row.

**Change size:** 0 files / 0 functions. **RLS:** 0. **RPC:** 0. **Accounts:** 0. **Reversibility:** trivial. **Lockout:** 0. **MFA/S4:** no change required — but also **no MFA challenge for the new "Admins,"** since they remain `manager`.

---

## 5. RECOMMENDATION

> **Adopt Option A — a new `staff_role` value — but NOT named `'admin'`, and grant its powers through Option C's permission engine rather than by adding the value to 62 literal role lists.**

The owner's preliminary preference is A. I endorse the direction, with two mandatory corrections. Here is the reasoning, tied to blast radius.

**Why A wins.** The decisive property is **inertness**. Because every predicate in this codebase enumerates roles literally, a new `staff_role` value grants nothing anywhere until someone writes it down. That makes the day-one blast radius **6 sites**, all enumerable, one of them compiler-enforced. Nothing about `is_owner()` moves, so the ~387-function / ~116-policy surface stays exactly where it is. The owner can *see* the tier in the UI, assign it to a real person, and decide what it may do afterwards — which is the correct order.

**Why B loses.** It is strictly more expensive (~30 mandatory functions vs 6 sites), it introduces a second privilege axis defaulting to NULL — the exact shape of the incident that let an unauthenticated caller read company data — and it fails *silently* where A fails *loudly*. Its one advantage (no vocabulary collision) is obtained more cheaply by simply not naming the value `'admin'`.

**Why C loses as the sole answer.** C is genuinely free and genuinely correct as a *capability* mechanism. It fails only on the requirement actually stated: the owner asked for a **named commercial tier**, and C leaves the portal saying "Manager." I do not recommend paying zero for something that does not answer the question.

**The hybrid is the real recommendation.** Use A for **identity and vocabulary** (a tier exists, is assignable, is displayed, is MFA-challenged) and C for **capability** (its powers arrive via `emp_can(...)` disjuncts and profession permission sets, not by editing 62 literal role lists). This avoids the single largest cost in *both* A and B — the ~62 per-site product rulings — and the precedent for it is already live in `civ_can_manage()`.

### The `'admin'` name collision — explicitly, and it is non-negotiable

`lib/portal/roles.ts:12` — `export type ViewRole = "admin" | "client" | "lead" | StaffRole;`

TypeScript unions are **sets**. Adding `"admin"` to `StaffRole` adds **no new member** to `ViewRole`. Traced end to end:

- `roles.ts:15` `if (p.account_type === "admin") return "admin"` — does **not** fire (a tier-3 Admin cannot hold `account_type='admin'`; it is capped at two emails).
- `roles.ts:16` `if (p.staff_role) return p.staff_role` — returns the string `"admin"`.
- `roles.ts:46` `const isOwner = view === "admin" || view === "super_admin"` → **true**.

Cascade: `isAdminArea`, `canManageStaff`, `canFinalDeliver`, `canSeeFinancials`, `canSupportComms`, `staffReadsAll`, `canSeeInvoices`, `canSeeOpportunities`, `canCreateBooksEstimate`, `canPrepareBooksEstimate` — **ten flags true**. And `nav.ts:37` serves `SETS.admin`, a **strict superset of `SETS.super_admin`** (it alone contains `"accounts"`). The new bottom privileged tier gets more tabs than the tier above it. Incoherently, `roles.ts:48` also makes it `isStaff: false`.

**And it worse than "adds a risk" — it deletes Option A's only compile-time guard.** `nav.ts:36` is the **sole** exhaustive `Record` over a role union in the codebase (`STAFF_ROLE_LABELS` is `Record<string,…>`; `STAFF_ROLE_OPTIONS` is an array; `Record<StaffRole,…>` does not exist anywhere). Because the union gains no member, the `Record` requires no new key and **the build stays green**. Under the name `'admin'`, Option A has **zero** compile-time guards.

**Renaming restores it.** A genuinely new value (`'org_admin'`) widens `ViewRole`, so `nav.ts:36` **fails to compile** until a tab set is assigned, and `roles.ts:46` stops matching. The rename converts a silent privilege escalation into a build error, at zero additional migration cost.

Beyond the type system, `'admin'` already carries **six distinct meanings** in this schema — `profiles.account_type` (Owner), `notifications.recipient_role` (owner broadcast, strictly `is_admin()`), `activity_log.actor_role`, `messages.sender_role`, `project_tasks.visibility`, `custody_purchase_approvals.level` — plus the namespaced `project_members.role = 'kian_admin'`, which is the one place the repo already solved this. A seventh meaning, **on the `profiles` table itself**, in a repo whose own recorded lesson is *never invent DB vocabulary*, is not a preference call.

One trap worth naming: `docs/activity_log_role_hardening_RUNME.sql:36-40` whitelists `'admin'` but **not** `'super_admin'`, silently NULLing anything outside the list. A caller passing the staff_role variable would log tier-3 as `'admin'` successfully while tier-2 logs as `NULL` — an audit trail that records the lower tier and drops the higher one.

*I do not choose the value string — that is the owner's decision. `'org_admin'`, `'administrator'`, and `'ops_admin'` are all safe. `'admin'` is not.*

**Uncertainty I want on the record:** I cannot tell from files how many `super_admin` accounts exist in production. **No seed or backfill anywhere in the repo grants `super_admin`** — every one was created at runtime by a human. If that population is large, the value of a middle tier rises sharply; if it is one or two, Option C's cost/benefit improves. **Run preflight P1 before ratifying this recommendation.**

---

## 6. PREDICATE SEPARATION PLAN — SEVEN FUNCTIONS

**Governing rule: `is_owner()` is frozen. It is never narrowed as a step in this plan.** Narrowing is the one operation that changes ~387 functions and ~116 policies simultaneously, silently, with no compiler and no error.

| # | Predicate | New / Existing | Means | True for | Wired to, on day one |
|---|---|---|---|---|---|
| 1 | `is_owner()` | **EXISTS — FREEZE** | "holds top-tier privilege." Name is historically wrong; it means *privileged admin*. | Owner, Super Admin | everything (~387 fns / ~116 policies) — unchanged |
| 2 | `is_strict_owner()` | **NEW (alias)** | one of the two protected owner accounts, active | Owner only | nothing yet |
| 3 | `is_super_admin()` | **NEW** | holds the granted top staff role | Super Admin only | **nothing** |
| 4 | `is_org_admin()` | **NEW** | holds the new third tier | Admin only | **nothing** |
| 5 | `can_manage_identity()` | **EXISTS, UNWIRED** | may create/modify accounts, roles, permission grants | Owner, Super Admin | **nothing — zero callers today** |
| 6 | `can_change_security_settings()` | **NEW** | may change platform security posture | Owner only | nothing yet |
| 7 | `can_manage_staff()` | **EXISTS — do not redefine** | may assign staff roles | Owner, Super Admin | `admin_set_staff_role` (1 live site) |

**Notes that matter:**

**(2) `is_strict_owner()` must be `coalesce(public.is_admin(), false)` — an alias, not a re-implementation.** It is definitionally identical to `is_admin()` today. Aliasing keeps the two-email anchor single-sourced. Note `assert_can_grant_role` currently **inlines this exact query** at `authz_identity_hardening_s4pre_RUNME.sql:81-83` — that inline copy should become a call. Zero existing callers, NULL-collapse impossible (`exists`-based).

**(3) `is_super_admin()` exists solely so that a *future* narrowing of `is_owner()` becomes a one-line edit at one site instead of a 74-object rewrite.** It is the enabling move, not a step that changes behaviour.

⚠️ **The decomposition trap.** If `is_owner()` is ever rewritten as `is_strict_owner() or is_super_admin()`, `is_super_admin()` **must** include `account_status = 'active'`. Current `is_owner()` has it; `is_admin()` has it independently. Omitting it silently grants top-tier privilege to **inactive and blocked** super_admin accounts across all ~387 sites at once — deactivating a compromised super_admin would stop revoking their access.

**(5) `can_manage_identity()` is the cheapest lever in the entire system.** It exists, it is reviewed, and it has zero callers — so pointing it anywhere costs nothing. It should be wired **before** the tier work, because a tier hierarchy is meaningless while `permission_catalog_RUNME.sql:219,258,262` and `employee_professions_RUNME.sql:142,149` accept `can_manage_projects()` — i.e. **`staff_role='manager'` can currently rewrite another employee's permission grants.**

**(6) `can_change_security_settings()` is the crux of the hierarchy.** Super Admin is a *grantable* role. If Super Admin can change MFA `enforcement_mode`, then whoever can grant Super Admin can indirectly disable MFA. Pinning security posture to `is_strict_owner()` is what stops role-granting from being an escalation path into the security controls. Targets (each a genuine narrowing, each shipped **one site at a time**): `mfa_admin_set_mode` (`mfa_foundation_batch_s1_RUNME.sql:148`), the MFA probe (`mfa_probe_claims_s1b_RUNME.sql:43`), sensitive-permission branches (`permission_catalog_RUNME.sql:396,457`). Safe to narrow **because** the documented break-glass (`update public.mfa_settings set enforcement_mode='off' where id=1`, run in the SQL editor under `service_role`) does not pass through any of these predicates.

**(7) The right move for `can_manage_staff()` is not a predicate change.** Make `admin_set_staff_role` call `assert_can_grant_role(p_user, p_role)` as its first statement. Blast radius: one function body. Tier rules for *granting* belong in a **grantor→grantable-role matrix inside that one function**, not in more boolean predicates — encoding them as predicates is what produced the current 48-file sprawl.

**Not one of the seven:** `can_manage_projects()` is correct as written (`is_owner() or staff_role() in ('manager')`). Its defect is at the **consumer** — identity RPCs accepting it as identity authority. Fix it there (via #5), never here.

### Migration strategy — incremental, not big-bang, and not feature-flagged

**Big-bang narrow-and-rewrite is not deliverable here.** All three preconditions are absent: (a) an atomic deploy — SQL ships as RUNME files pasted by hand, and this project's own records show many files written but never applied; (b) an authoritative inventory of what is live — `admin_set_staff_role` has four competing definitions and the winner had to be identified forensically; (c) an automated per-role authorization test suite against Postgres — the 603 tests are TypeScript unit tests. Partial application would leave `is_owner()` narrowed while class-(b) sites still call it, locking Super Admin out of finance, HR, custody, WhatsApp and permissions simultaneously, with the UI still offering the controls.

**A feature-flagged `is_owner()` should be rejected outright, not deferred.** Reading a flag inside the predicate would (i) reintroduce NULL-collapse in the hottest gate in the system (missing settings row ⇒ NULL), (ii) make every RLS policy time-varying so "who can read this table" has no stable answer, (iii) destroy auditability — `pg_get_functiondef` would no longer tell you who can do what, and (iv) repeat the MFA S3.5 defect fixed one commit ago in `dd260f3`, where a documented `enforcement_mode` lever was never read by the code that depended on it. If a flag is wanted, it belongs at the **call site**, never inside the predicate.

**Mandatory construction rules for every new predicate:** `security definer` · `set search_path = public` · body either `exists(...)`-based or wrapped in `coalesce(..., false)` · `revoke all ... from public, anon` then `grant execute ... to authenticated, service_role` · **acceptance test = call it unauthenticated and assert it returns `false`, not `null`.** Never write `is_owner() or staff_role() in (...)` without `coalesce` — `staff_role()` legitimately returns NULL and that is the incident.

---

## 7. GRANT MATRIX

### Who may grant what

| Grantor ↓ / Target role → | Owner | Super Admin | Admin | Manager | Employee roles | NULL (revoke) |
|---|---|---|---|---|---|---|
| **Owner** (`is_strict_owner`) | ✗ *(no RPC path — two emails, direct SQL only)* | ✓ | ✓ | ✓ | ✓ | ✓ |
| **Super Admin** | ✗ | ✗ | ✓ | ✓ | ✓ | ✓ (not Super Admin/Owner) |
| **Admin** | ✗ | ✗ | ✗ | ✗ *(owner ruling — see §10 Q3)* | ✓ | ✓ (Employee only) |
| **Manager** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **Everyone else** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

### The six rules — as design, expressed as guard clauses inside one function

All six belong in a single `assert_can_grant_role(p_target uuid, p_role text)`, called as the **first statement** of `admin_set_staff_role`. Not scattered across predicates.

**R1 — No self-promotion.** `if p_target = auth.uid() then deny`. *Already written* (`s4pre:74-77`). Must not be removed from `admin_set_staff_role` either — the guard should not depend on the caller.

**R2 — No vertical escalation (creating a peer or a superior).** Granting `'super_admin'` requires `is_strict_owner()`, **not** `is_owner()`. *Already written* (`s4pre:80-88`) — this is the fix for the currently-live unbounded super_admin proliferation. Extend the same rule to the new tier: granting `'org_admin'` requires `is_owner()` (Owner or Super Admin), never an Admin.

**R3 — No horizontal escalation.** A grantor may never grant a role at or above their own rank. Expressed as an explicit **rank table** — `owner=100, super_admin=80, org_admin=60, manager=40, employee=20` — with the rule `rank(p_role) < rank(caller)`. A rank table is data and reviewable at a glance; a chain of `if` statements is not.

**R4 — No editing a higher-ranked account.** The current check is `if exists (... account_type='admin' or staff_role='super_admin') then raise 'protected owner account'` (`portal_custody_v2_..._PATCH_RUNME.sql:50-53`). It protects only the two existing tiers. It must become **rank-based on the target's current role**: `rank(target.current_role) < rank(caller)`. Without this, **a new Admin is unprotected on day one** — any caller passing `can_manage_staff()` could silently demote one, because `staff_role='org_admin'` matches neither existing branch.

**R5 — No unknown roles.** Keep the explicit allow-list array (`invalid staff role: %`). Do **not** replace it with a catch-all or a lookup that could return NULL. Note this must stay in sync with `profiles_staff_role_check` and with `STAFF_ROLE_OPTIONS`.

**R6 — No Owner from an RPC, ever.** `account_type='admin'` remains reachable only through `admin_set_account`, which remains gated on `is_admin()` **and** the two-email allow-list (`phase1_addendum_s1.sql:152-157`). No new RPC may write `account_type`. This is what keeps the top of the hierarchy out of reach of the hierarchy.

**Failure semantics for all six:** `raise exception 'authorization_denied' using errcode = 'P0003'` — a raise, never a silent no-op, never a filtered row. Every denial must be distinguishable from "nothing happened."

---

## 8. MIGRATION PLAN — ORDERED, NOT EXECUTED

### Phase 0 — Preflight (read-only; answers questions the repo cannot)

Run all of these against production **before designing anything further**. Every one is a `SELECT`.

```sql
-- P1 ★ THE query. The complete privileged population — unknown from source.
select id, email, account_type, staff_role, account_status, created_at
  from public.profiles
 where account_type = 'admin' or staff_role = 'super_admin'
 order by account_type desc, staff_role, email;

-- P2 ★ STOP-THE-LINE. If active_owners < 1, the lockout in §9 is ALREADY live.
select count(*) filter (where account_status = 'active')  as active_owners,
       count(*) filter (where account_status <> 'active') as broken_owners
  from public.profiles where account_type = 'admin';

-- P3. Owner rows outside the hardcoded allow-list (drift the RPC could not create).
select id, email, account_status from public.profiles
 where account_type = 'admin'
   and lower(email) not in ('kianalebtikar@gmail.com','manager@kianmedia.com');

-- P4. Full staff distribution — how many rows any re-tiering touches.
select coalesce(staff_role,'(none)') as staff_role, account_status, count(*)
  from public.profiles group by 1,2 order by 1,2;

-- P5. Values already violating the current CHECK (drift detector).
select id, email, staff_role from public.profiles
 where staff_role is not null and staff_role not in
  ('super_admin','manager','support','editor','sales','hr','readonly','finance',
   'photographer','lighting_tech','camera_assistant','custody_officer');

-- P6 ★ Which admin_set_staff_role is ACTUALLY deployed (4 competing copies in docs/).
select pg_get_functiondef(to_regprocedure('public.admin_set_staff_role(uuid,text)'));

-- P7. Byte-for-byte source of every predicate in scope. Compare to the repo —
--     do NOT assume any file is live.
select p.proname, pg_get_functiondef(p.oid)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname='public' and p.proname in
  ('is_admin','is_owner','can_manage_staff','can_manage_projects','staff_role',
   'can_manage_identity','assert_can_grant_role','can_manage_hr','can_see_invoices',
   'can_see_opportunities','can_manage_quotes','can_manage_custody','civ_can_manage');

-- P8. Is assert_can_grant_role wired? Empty result = orphaned = proliferation open now.
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%assert_can_grant_role%'
   and p.proname <> 'assert_can_grant_role';

-- P9. Live blast-radius census. Compare against the repo's 74 objects / 11 policies.
select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and pg_get_functiondef(p.oid) ilike '%is_owner%';
select schemaname, tablename, policyname, cmd from pg_policies
 where qual ilike '%is_owner%' or with_check ilike '%is_owner%';

-- P10 ★ The governing incident's signature. Must return ZERO rows. Re-run as an
--       acceptance gate AFTER every step.
select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon_exec
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public'
   and p.proname in ('is_admin','is_owner','can_manage_staff','admin_set_staff_role',
                     'admin_set_account','can_manage_identity','assert_can_grant_role',
                     'can_manage_hr','can_manage_custody','can_see_invoices',
                     'can_see_opportunities','can_manage_quotes','civ_can_manage')
   and has_function_privilege('anon', p.oid, 'execute');
```

**Also verify before Phase 1:** that a **named human currently holds working Supabase Dashboard credentials** for the production project. If the only path is the portal owner account, there is **no recovery path** and nothing below should run.

**Snapshot:** take a Supabase point-in-time / manual backup immediately before Phase 2, and separately export `select id, email, account_type, staff_role, account_status from public.profiles` to a file. The second is what you actually restore from — it is 5 columns and it is the only state this migration changes.

### Phase 1 — Close the open holes first (independent of the tier decision; ship regardless)

1. Wire `assert_can_grant_role` into `admin_set_staff_role`. **Blast radius: 1 function body.** Closes unbounded super_admin proliferation.
2. Wire `can_manage_identity()` into `permission_catalog` (`:219, :258, :262, :396, :424, :440, :457`) and `employee_professions` (`:142, :149`), replacing `can_manage_projects()`. **Zero existing callers ⇒ zero blast radius.** Stops a Manager rewriting permission grants.
3. Add `coalesce(..., false)` to the six predicates the July hardening missed — `can_manage_hr`, `can_see_invoices`, `can_see_opportunities`, `can_manage_quotes`, `can_manage_custody`, `civ_can_manage`. These carry the incident's exact NULL-collapse shape and are consumed by `if not <pred> then raise` gates that **fail open**. Confirm with P10 whether `anon` holds EXECUTE on the consuming RPCs; that determines whether this is a latent defect or a live one.

> **Phase 1 is the highest-value work in this report and does not depend on any tier decision.** If the owner defers the hierarchy entirely, do Phase 1 anyway.

### Phase 2 — Introduce the tier (inert)

4. **Schema/constraint:** widen `profiles_staff_role_check` to 13 values, adding the chosen non-colliding string. Additive; matches zero rows. **Must supersede all four stale copies** — the new file must state its required run order relative to `portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql`, and the stale 7-role/8-role files must be marked superseded so re-running one cannot narrow the constraint.
5. **RPC:** add the value to the `admin_set_staff_role` allow-list; upgrade the protected-account check from two hardcoded branches to the **rank comparison (R4)**.
6. **Functions:** **none.** No existing predicate learns the new value. This is the point.
7. **RLS:** **none.** No policy edits in Phase 2.
8. **TS types:** `lib/portal/types.ts` `StaffRole`; then fix the compile error at `components/portal/nav.ts:36` by assigning a deliberate tab set (**not** a copy of `super_admin`, and definitely not of `admin`).
9. **UI selectors:** `STAFF_ROLE_OPTIONS` and `STAFF_ROLE_LABELS` in `lib/portal/roles.ts`. Recommend re-typing the label map as `Record<StaffRole, …>` — that converts the `AdminStaff.tsx:115` runtime crash into a build failure, permanently.
10. **MFA:** extend `mfaRoleOf` (`lib/portal/mfa.ts:573-577`) and `shouldChallengeMfa` (`:562`), **and** the server gate at `docs/mfa_write_gate_s4a_RUNME.sql:75`, in this same change. Otherwise the tier ships silently exempt.
11. **API validation:** the three routes that re-implement role gates in TypeScript — `app/api/integrations/project/notify-admin/route.ts:130-133`, `app/api/rental/evidence/upload-url/route.ts:50-54`, `app/api/integrations/hr/my-tasks/route.ts:35-38`. Preferred fix is to convert them to the `lib/server/hrAuth.ts` pattern (ask the DB via `rpcAsUser`, and distinguish 503/transport from 403/denied), not to add another literal.
12. **Notification recipients:** the 8 PostgREST filter strings (`rental/notify:97`, `hr/notify:172,253`, `custody/notify:113`, `custody-inventory/notify:115`, `cron/custody-alerts:30`, `hrTaskDispatch.ts:51`, `notifyEvent.ts:78`). Not authorization, but an Admin added nowhere else receives **zero notifications**.
13. **Audit:** confirm `docs/activity_log_role_hardening_RUNME.sql` is live (P7). It maps out-of-vocabulary roles to NULL and swallows logging errors, so a new value will not abort transactions — but this must be **verified on production**, not assumed. Consider adding the new value to the `activity_log.actor_role` whitelist so the audit trail records it rather than NULLing it. *(Note: `'super_admin'` is currently NULLed there — a pre-existing audit gap worth fixing in the same pass.)*

**Backfill: none.** Nobody is assigned the tier in Phase 2. **Accounts that change: zero.**

### Phase 3 — Grant the tier its powers (incremental, one decision at a time)

14. Assign the tier to **one** real person. Observe: they should see a portal with the correct tabs and essentially no elevated capability.
15. For each capability the owner wants Admin to have, prefer a **permission grant** through the 117-permission model (`emp_can` / `emp_has_permission`) over adding the role literal to a predicate. Where a coarse gate must learn the tier, follow the `civ_can_manage()` precedent and add an `emp_can(...)` disjunct rather than a role literal.
16. **Never** in this phase: narrow `is_owner()`. That remains a separate, later, individually-argued decision — and per §3 it may never be worth doing at all.

### Maintenance window

**Not required for Phases 1–2.** Every change is additive or a single-function replacement; no table rewrite, no lock beyond a brief `ALTER TABLE ... ADD CONSTRAINT` on `profiles`. **One sequencing requirement:** perform the role work while MFA `enforcement_mode = 'off'`, and restore it afterwards — otherwise the population that gets challenged and the population that can turn the challenge off change in the same instant, from two code paths (SQL and TypeScript) that must agree.

### Kill switch

- **Tier rollback:** `update public.profiles set staff_role = <previous> where staff_role = '<new>'`, then re-run the 12-role CHECK. Restores the exact prior state.
- **Phase-1 rollback:** re-apply the prior definition of the one edited function. Each Phase-1 item is a single `create or replace`.
- **Total lockout break-glass:** Supabase Dashboard SQL editor, authenticated by the **Supabase project owner's own login** — not by any portal profile: `update public.profiles set account_status='active', account_type='admin' where lower(email) = '…'`. Secondary: `SUPABASE_SERVICE_ROLE_KEY` **direct table UPDATE only** — calling `admin_set_account` under the service key still fails, because `auth.uid()` is NULL so `is_admin()` is false.
- **MFA break-glass (unchanged, independent of all predicates):** `update public.mfa_settings set enforcement_mode='off' where id=1`.

### Tests — per role, and the ones that actually catch this class of bug

Existing coverage is 603 TypeScript unit tests; **none exercises role × surface against Postgres**. Minimum additions:

- **Unauthenticated (`anon`) predicate test — the most important test in the set.** For every new or edited predicate, assert it returns **`false`, not `null`**, and assert `anon` has no EXECUTE (P10). This is the governing incident's exact signature.
- **Row-count comparison per tier, not a login check.** For Owner / Super Admin / Admin / Manager / Employee / Client, capture `count(*)` on the ~15 highest-value tables **before and after** each phase. Because 110 of the 116 affected policies are SELECT, a smoke test that checks "can I log in and see the dashboard" **passes while the data underneath is gone**.
- **Grant-matrix test:** for each (grantor, target-role) pair in §7, assert allow or `authorization_denied`. Explicitly include: Admin granting Admin (deny), Admin granting Manager (owner decision — Q3), Super Admin granting Super Admin (deny), anyone granting Owner (deny), self-grant (deny), editing a higher-ranked target (deny).
- **MFA test:** an account holding the new tier with a verified factor **is** challenged.
- **TS type test:** confirm the new value produces a `ViewRole` member — i.e. that removing its `nav.ts` entry **breaks the build**. This is the guard the `'admin'` name would have silently deleted.

### Manual acceptance (cannot be automated; the owner must do these)

1. Log in as the tier holder; confirm the tab set is exactly as designed and the "accounts" tab is **absent**.
2. Attempt one owner-only action (e.g. change MFA mode) and confirm a clear denial, not a silent no-op.
3. Confirm the MFA challenge appears at login.
4. Confirm the Arabic label reads correctly and is distinguishable from `مدير` (Manager) and `مالك` (currently Super Admin).
5. Confirm no notification regression: trigger one HR, one custody and one project notification and check recipients.

---

## 9. RISKS — RANKED

**1 · CRITICAL — Narrowing `is_owner()` causes a silent, platform-wide privilege collapse, not a re-tiering.**
Because `staff_role` is one column and super_admin is never named in the derived predicates, removing it from `is_owner()` drops it **below Manager**. ~387 functions and ~116 RLS policies change behaviour at once; 110 of those policies are SELECT and return **empty result sets, not errors**. `is_staff()` still passes, so the account remains "staff" while seeing nothing. *Mitigation: freeze `is_owner()`. This plan never narrows it.*

**2 · CRITICAL — A no-quorum lockout is already reachable, and no portal user can recover from it.**
`admin_set_account` gates on `is_admin()`, not `is_owner()`. If both owner emails go non-active, is_admin() is false for every human alive: super_admins cannot restore them (wrong predicate), cannot create a replacement owner (email allow-list reached only after `is_admin()` passes), and cannot repair roles (`admin_set_staff_role` refuses any already-privileged target). Recovery exists **only** via the Supabase Dashboard or a direct service-role table UPDATE. *Mitigation: P2 is stop-the-line; confirm a named human holds Dashboard credentials before Phase 1.*

**3 · CRITICAL — Naming the value `'admin'` silently promotes every Admin to Owner in the UI and deletes Option A's only compiler guard.**
`ViewRole` deduplicates; `roles.ts:46` returns `isOwner: true`; ten caps flip; `nav.ts` serves the owner tab set; **the build stays green**. *Mitigation: a non-colliding value. Non-negotiable.*

**4 · CRITICAL — Six predicates outside the July hardening still carry the incident's NULL-collapse shape, in fail-open guards.**
`can_manage_hr`, `can_see_invoices`, `can_see_opportunities`, `can_manage_quotes`, `can_manage_custody`, `civ_can_manage` are `is_owner() or staff_role() in (...)` with no `coalesce`. For an unauthenticated caller that is `false OR NULL` = NULL, and `if not NULL then raise` **never fires** — dead gates in HR, custody, invoices, quotes and opportunities. Exploitability depends entirely on whether EXECUTE was revoked from `anon`, which was defect 2 of the original incident. *Probe with P10 before anything else.*

**5 · CRITICAL — super_admin proliferation is live and unbounded right now.**
Any super_admin can mint further super_admins, each fully owner-equivalent across ~387 sites. The written, reviewed fix (`assert_can_grant_role`) is deployed as an orphan. *Mitigation: Phase 1, item 1 — one function body.*

**6 · HIGH — A new tier is unprotected against demotion on day one.**
The "protected owner account" check matches only `account_type='admin'` or `staff_role='super_admin'`. A new value matches neither. *Mitigation: rule R4, rank-based.*

**7 · HIGH — An unregistered tier is silently exempt from MFA.**
`mfa.ts:576` routes any unrecognised `staff_role` to `"employee"`; `:562` challenges only owner/super_admin/admin. No error, no log, no screen. *Mitigation: Phase 2 item 10, same commit.*

**8 · HIGH — Four stale copies of the role vocabulary can revert the migration.**
7-role and 8-role arrays in two shipped files, each using `drop constraint ... add constraint`. Re-running one strips five existing roles while the UI still offers them. *Mitigation: mark superseded, state run order.*

**9 · HIGH — A tier boundary is meaningless while a Manager can rewrite permission grants.**
`permission_catalog_RUNME.sql:219,258` accept `can_manage_projects()`, which includes `manager`. *Mitigation: Phase 1, item 2.*

**10 · MEDIUM — Existing super_admins cannot be re-tiered by any RPC.**
Demotion requires raw `UPDATE public.profiles`, bypassing the RPC's validation and the normal audit path — on the most security-sensitive table in the system. *Mitigation: do it under snapshot, log it manually, and treat it as a separate owner-approved step.*

**11 · MEDIUM — Sensitive-permission propagation degrades silently for non-owners.**
`permission_catalog_RUNME.sql:424,440` filter rather than raise — a copy/template operation reports success while dropping every sensitive row. A re-tiered Admin would appear to configure permissions correctly and produce a silently under-privileged profession.

**12 · MEDIUM — 16 class-(c) sites will change behaviour in ways nobody has decided.**
Stage-skip overrides, subtask gates, soft-delete visibility, custody deletion, and four cron guards written as `... or auth.uid() is null` (where the service-role branch means the `is_owner()` disjunct is not even the operative one). Each needs an explicit ruling before it is touched.

**13 · LOW — Arabic labels are already inverted and will contradict the hierarchy.**
`super_admin` renders as `مالك` (Owner); `account_type='admin'` renders as `مدير` (Manager) in `ProfileSettings.tsx:26`; `manager` is also `مدير`. In an Arabic-primary portal this is where the owner reasons about who outranks whom. Cosmetic in code, not cosmetic in operation.

---

## 10. THE DECISION THE OWNER MUST MAKE

**Q1 — What is the exact string for the new tier?**
It must **not** be `'admin'` — that word already means *Owner* in `profiles.account_type` and collapses the TypeScript role union, silently granting owner-grade UI. Safe candidates: `'org_admin'`, `'administrator'`, `'ops_admin'`. *Also pick its Arabic label; `مالك` and `مدير` are both already taken.*
→ **Answer format: one string, plus one Arabic word.**

**Q2 — Do today's `super_admin` accounts stay Super Admin, or become the new Admin?**
This decides whether the migration touches zero accounts (additive only) or requires direct SQL against protected rows outside any audited RPC. **This question cannot be answered until preflight P1 tells us how many super_admins exist — the repo cannot say, because nothing in it ever granted one.**
→ **Answer format: "all stay" / "these named people become Admin" — after P1.**

**Q3 — What may an Admin actually DO on day one?**
The tier is inert by construction. Name the smallest useful set. Specifically: (a) may an Admin assign staff roles at all, and if so which ones? (b) may an Admin see financials? (c) may an Admin manage HR or custody? Each "yes" is a per-site ruling with no compiler and no error to catch a wrong answer.
→ **Answer format: 3-8 named capabilities, or "none — assign it and let me look first."** *(The second answer is a good answer.)*

**Q4 — May I ship Phase 1 (the three open holes) regardless of how Q1–Q3 are answered?**
Wiring `assert_can_grant_role`, wiring `can_manage_identity()`, and `coalesce`-hardening the six missed predicates are each single-function changes with near-zero blast radius, and they close live defects: unbounded super_admin creation, Managers rewriting permission grants, and six fail-open authorization gates of the same shape as the incident that leaked company data.
→ **Answer format: yes / no.**

---

### Key file references

`docs/staff_roles_task_assignment_RUNME.sql:58-63` (`is_owner`) · `docs/phase0_migration.sql:325-328` (`is_admin`) · `docs/phase1_addendum_s1.sql:152-157` (two-email cap) · `docs/portal_custody_v2_claims_photos_roles_PATCH_RUNME.sql:33-56` (**live** CHECK + `admin_set_staff_role`) · `docs/project_platform_authz_hardening_RUNME.sql:51-90` (winning derived predicates) · `docs/authz_identity_hardening_s4pre_RUNME.sql:55-89` (`can_manage_identity`, `assert_can_grant_role` — **written, unwired**) · `docs/permission_catalog_RUNME.sql:212-262,396-457` (permission engine) · `docs/custody_profession_bridge_RUNME.sql:39-42` (the `emp_can` splice precedent) · `lib/portal/roles.ts:12,15-16,46,79-102` · `lib/portal/types.ts:7,14-16` · `components/portal/nav.ts:36-52` · `components/portal/AdminStaff.tsx:94,108-116` · `lib/portal/mfa.ts:523,562,573-577` · `lib/server/hrAuth.ts:43,96-107` (the reference implementation for a correct role gate).