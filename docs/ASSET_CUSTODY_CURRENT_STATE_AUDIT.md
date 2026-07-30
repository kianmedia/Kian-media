# Asset & Custody — Current State Audit (Phase 1)

Read-only audit of what is already built. No SQL was run; every claim below is
taken from the SQL and TSX files named beside it. Repo `Kian-media`, branch
`main`, HEAD `d4cfadb`.

**The one-line finding: a complete asset/custody system already exists.** It has
57+ tables, ~120 RPCs, a live console with 14 tabs, private storage buckets, QR,
kits, audits, maintenance, incidents, liabilities, rentals and insurance. The
work ahead is *reconciliation and a small number of additive extensions*, not a
new asset module. Building `asset_*` beside `custody_inventory_*` would create a
second source of truth for the same camera body.

---

## 1. The two families, and which one is the system of record

### 1.1 `custody_inventory_*` — the real asset system (v1, 2025)
Created by `docs/portal_custody_inventory_system_v1_RUNME.sql` (1379 lines).
Its own header states it is deliberately separate from the older manual custody.

| Table | What it actually holds |
|---|---|
| `custody_inventory_assets` | The asset master. `asset_code` (unique), `barcode` (unique), `qr_code_value` (unique), `asset_name`, `category_id`, `brand`, `model`, `serial_number`, `ownership_type` (owned/leased/client_owned/other), `asset_type` (`serialized`/`quantity_based`), `quantity_total`/`quantity_available`/`quantity_in_maintenance`, `unit`, `purchase_date`, `purchase_price`, `current_value`, `supplier_name`, `invoice_number`, `warranty_expiry_date`, `condition_status` (8 values), `availability_status` (7 values), `warehouse_location_id`, `minimum_stock_level`, soft-delete quad. Two CHECKs guard stock integrity: `quantity_available <= quantity_total`, and serialized ⇒ `quantity_total = 1`. Later patches add `useful_life_months`, `book_value`, `zoho_asset_id` (`custody_enterprise_06`). |
| `custody_inventory_categories` | Flat category list, soft-delete. No tree, no parent_id. |
| `custody_inventory_locations` | Warehouses/studios/vehicles/sites, `responsible_user_id`. |
| `custody_inventory_asset_files` | Catalogue photos + invoice/warranty/manual docs. `is_primary` with a partial unique index `uniq_civ_primary_photo` (one primary photo per asset). |
| `custody_inventory_assignments` | Custody header. `assignment_number`, `employee_user_id`, `assignment_type`, `expected_return_at`, `ack_snapshot`/`ack_name`/`ack_ip`, 10-value `status`. |
| `custody_inventory_assignment_items` | Line items: `quantity`, `quantity_returned`, `condition_at_issue`/`condition_at_return` (free text), 8-value `status`. Partial unique index `uq_civ_serialized_active_item` = a serialized asset can have at most one live line. |
| `custody_inventory_evidence` | Photo evidence keyed by 6-value `evidence_stage` (`issue_admin`, `issue_employee`, `return_employee`, `return_inspection`, `damage`, `maintenance`). |
| `custody_inventory_movements` | Append-only stock ledger, 15 movement types, before/change/after quantities, from/to location and employee. **This is the audit spine of the whole module.** |
| `custody_inventory_maintenance` | One row per maintenance *event*: type, provider, `sent_at`, `expected_return_at`, `cost`, 5-value status. |
| `custody_inventory_reservations` | asset + qty + optional employee/project + `reserved_from`/`reserved_to` + status. |
| `custody_inventory_audits` / `_audit_items` | Stock counts: expected vs counted vs variance, per-location, with approval. |
| `custody_inventory_settings` | Single row: `legacy_custody_employee_visible`, `show_purchase_value_to_employee`. |
| `custody_inventory_asset_changes` | Per-field edit audit (`custody_inventory_asset_editing_PATCH`), with financial diffs split into `changes_finance` so they can be masked. |

### 1.2 Enterprise patches, layered on top of the same assets
`custody_enterprise_00…07` add, without forking the asset table:
`custody_enterprise_settings` (20 feature flags), `custody_qr_events`,
`custody_inventory_asset_components` (accessory tree, `required_on_issue`/
`required_on_return`), `custody_inventory_kits` + `_kit_items` + `_kit_versions`
+ `_kit_movements`, `custody_signatures`, `custody_condition_reports`,
`custody_incidents` + `_incident_actions`, `custody_alert_deliveries` (dedup
key), `custody_gps_sessions`/`_gps_points`, `custody_external_trackers`,
`custody_offline_operations` (idempotency by `client_operation_id`),
`custody_vendors`, `custody_purchase_requests` + items/approvals/quotes/
receiving, `custody_zoho_sync_outbox` + `_log`, plus the rental/insurance
tables. `custody_liabilities`/`_liability_events` come from
`custody_liability_RUNME.sql`.

### 1.3 `custody_*` (old family) — the manual custody/rental ledger
`docs/portal_equipment_custody_rental_RUNME.sql`: `custody_records` (a paper-form
row: `record_no`, `kind` custody|rental, `party_user_id`, before/after overall
photos, `ack_signed`), `custody_items` (free-text `name` + `qty` + two photo
paths — **no `asset_id` at all**), `custody_events`, `renter_profiles`, plus
`custody_photos` (v2 patch). UI: `components/portal/custody/*` at
`/client-portal/equipment`.

**These two families do not share a row.** The old one records *typed item
names*; the new one records *catalogued assets*. They are reconciled only by a
visibility switch (`legacy_custody_employee_visible`) that hides the old one
from employees.

---

## 2. Functions and RPCs

~46 `custody_inv_*` RPCs in the v1 file plus ~25 more across patches, ~20
`custody_*` enterprise RPCs, and the legacy `submit_checkout`/`submit_return`/
`admin_approve_handover`/`admin_close_custody` set. Notable ones:

- Lifecycle: `custody_inv_admin_create_assignment(jsonb)`,
  `custody_inv_employee_confirm_assignment`, `custody_inv_employee_request_return`,
  `custody_inv_employee_submit_return`, `custody_inv_admin_start_inspection`,
  `custody_inv_admin_inspect_return`, `custody_inv_admin_cancel_assignment`,
  `custody_inv_employee_self_issue` (self-service patch).
- Stock: `custody_inv_admin_adjust_stock`, `_correct_stock`, `_transfer_asset`,
  and the internal `civ_set_avail(asset)` which *derives* `availability_status`
  from quantities + condition. Availability is never set by hand.
- Evidence: `custody_inv_attach_evidence`, `custody_inv_evidence_bundle`,
  `custody_inv_request_more_evidence`, `custody_inv_evidence_diagnostics`.
- Read models: `custody_inv_admin_get_dashboard`, `custody_dashboard_buckets`,
  `custody_case_timeline`, `custody_admin_custody_dashboard`,
  `custody_inv_get_asset_details`, `_get_asset_timeline`, `_get_asset_changes`.
- Enterprise: `custody_inv_resolve_qr`, `_reissue_qr`, `_log_label_print`,
  `_upsert_kit`, `_snapshot_kit`, `_get_kit_resolved`, `_employee_issue_kit`,
  `custody_inv_record_condition`, `_record_signature`,
  `custody_inv_employee_report_incident`, `custody_run_alerts`,
  `custody_finance_compute_depreciation`, `custody_finance_asset_usage`,
  `custody_pr_create`/`_decide`, `custody_offline_claim`/`_finalize`.

TS wrappers: `lib/portal/custodyInventory.ts` (475 lines, fully typed),
`lib/portal/custodyEnterprise.ts` (100), `lib/portal/custody.ts` (287, legacy),
`lib/portal/rental.ts` (427).

---

## 3. Permission model

Four gates, all `security definer` + pinned `search_path`:

| Gate | Meaning | Winning definition |
|---|---|---|
| `civ_can_manage()` | operate the module (add/issue/inspect/maintain/audit) | `authz_fixC_null_failopen_gates_RUNME.sql:135` — `coalesce(is_owner() or staff_role() in ('manager','custody_officer') or emp_can('manage_custody'), false)` |
| `civ_can_admin()` | settings + sensitive approvals | `= is_owner()` (`is_admin()` or `staff_role='super_admin'`) |
| `civ_can_finance()` | see money (purchase price, book value, maintenance cost, financial diffs) | `is_owner() or staff_role() = 'finance'` |
| `civ_can_delete_asset()` | soft-delete an asset | `account_type='admin'` or `staff_role='super_admin'`, active only |
| `civ_is_employee()` | see own custody | `= is_staff()` |

The profession bridge (`custody_profession_bridge_RUNME.sql`) is what lets a
*Custody Manager profession* (not just a staff_role) operate the module; it also
backfills `perm_manage_custody` on custody-like professions. `emp_can` is the
UNION of all active professions, not the primary one.

RLS: every `custody_inventory_*` table has RLS on and **only SELECT policies** —
all writes go through RPCs. Assets/categories/locations/movements/maintenance/
reservations/audits are readable by `civ_can_manage()` only; employees never
select the asset table directly, they call `custody_inv_employee_list_available`.
`custody_inventory_asset_changes` is additionally `revoke all … from anon,
authenticated`. Storage: two private buckets, `custody-inventory-assets`
(manage-only read+upload) and `custody-inventory-evidence` (read/upload by
managers *or* the owner of the first path segment = `auth.uid()`).

---

## 4. Checkout and return flow (what actually happens)

**Issue** — `custody_inv_admin_create_assignment(jsonb)`: gate check → header row
in `pending_employee_confirmation` → loop items **ordered by `asset_id`** (fixed
lock order, no deadlock) with `select … for update` → reject if
maintenance/lost/retired, if a serialized asset already has a live line, if
`qty > quantity_available`, and if the remainder would fall below the sum of
*active reservations belonging to someone else* → decrement
`quantity_available` → `civ_set_avail` → insert item + a
`issue_to_employee` movement row → notify employee + managers.

**Confirm** — employee confirms; `ack_snapshot`, `ack_name`, `ack_ip`
(`civ_client_ip()`) are captured; signatures optionally recorded in
`custody_signatures` with `ack_hash`. Admin fallback exists
(`admin_confirmed_by`/`_reason`, `custody_confirmation_return_FINAL_FIX`).

**Return** — employee `request_return` → `submit_return` (photos + fields added
by `custody_employee_return_fields_FIX`) → admin `start_inspection`
(`inspection_started_at/_by`) → `inspect_return` with a per-item result from
`accepted_good | accepted_damaged | maintenance_required | missing |
rejected_return | partial_return`. **Stock returns to `quantity_available` only
at inspection**, never at the employee's submission — the same rule the rental
close-out file re-states at `rental_closeout_FINAL_RUNME.sql:82`.

Every step writes a movement row, so `custody_inventory_movements` alone can
reconstruct the history of any asset.

---

## 5. Photo / evidence path

Client asks for a signed upload URL → uploads to
`custody-inventory-evidence/{owner_user_id}/…` → calls
`custody_inv_attach_evidence` which inserts the row. Catalogue photos go to
`custody-inventory-assets/{asset_id}/asset_photo/…` +
`custody_inv_attach_asset_file` (first photo becomes primary, unique-violation
race falls back to non-primary; non-image MIME rejected server-side for
`asset_photo`).

`custody_asset_photos_production_RUNME.sql` also back-fills orphaned storage
objects into `custody_inventory_asset_files` and normalises `is_primary`, and
tightens the file read policy so invoices/warranties are finance-only.

Comparison UI: `CustodyEvidenceComparison.tsx` (before/after),
`custody_inv_evidence_bundle` + `civ_evidence_norm_stage` normalise the stage
vocabulary, and `custody_inv_evidence_diagnostics` exists precisely because
evidence↔item matching has historically been fragile.

**Known-good, proven the hard way:** the rental evidence path had a real
production failure — the renter could not SELECT their own request, so the
storage owner sub-query returned empty and the upload 403'd. Fixed by
`rental_evidence_storage_rls_FIX_RUNME.sql` with a `security definer`
`rental_evidence_is_owner()`. **Any new storage policy must not re-introduce an
owner sub-query that runs under the uploader's own RLS.**

---

## 6. Delete and edit behaviour

- **No hard delete anywhere in the new family.** Soft delete quad
  (`is_deleted`, `deleted_at`, `deleted_by`, `delete_reason`) on assets, files,
  categories, locations, assignments, evidence, kits, incidents.
- `custody_inv_admin_delete_asset(asset, reason)` requires
  `civ_can_delete_asset()`, a reason of ≥10 characters, logs *denied* attempts,
  and refuses if the asset is on live custody, has an active reservation, is in
  open maintenance, has `quantity_in_maintenance > 0`, is in a draft/in-progress
  audit, has an open incident, or (quantity assets) has any issued quantity.
  Restore exists (`custody_inv_admin_restore_asset`).
- Edits go through `custody_inv_admin_update_asset` and are recorded field-by-
  field in `custody_inventory_asset_changes`, with money fields in a separate
  `changes_finance` column so non-finance staff cannot read them.
- Movements and audit rows have no delete path at all — corrections are made by
  writing a new `manual_correction` / `stock_adjustment` movement.

---

## 7. Reservations and conflict handling — the weakest area

What exists: the table, `custody_inv_admin_create_reservation`,
`_cancel_reservation`, and the reservation check inside issue.

What is missing, concretely:
1. `create_reservation` validates only `0 < qty <= quantity_total`. **It does not
   check other reservations.** Two reservations for the whole stock in the same
   window are both accepted; the clash only surfaces when someone tries to issue.
2. The issue-time check ignores `reserved_from` — it filters on
   `reserved_to is null or reserved_to >= now()`. A reservation for *next month*
   therefore blocks an issue *today*.
3. Nothing converts a reservation into an assignment; `status='fulfilled'`
   exists in the CHECK but no RPC ever sets it.
4. `availability_status = 'reserved'` is in the CHECK list but `civ_set_avail`
   can never produce it.
5. There is **no reservations tab** in `CustodyInventoryConsole.tsx` (tabs are
   dashboard, assets, photos, qr, categories, locations, issue, custody,
   liability, maintenance, audits, reports, enterprise, settings). The RPC and
   the type `CivReservation` exist with no screen behind them.

---

## 8. What works / what is partial

**Works:** asset catalogue with photos and per-field edit audit; issue → confirm
→ return → inspect with locking, evidence and an append-only ledger; soft delete
with restore and hard preconditions; QR resolve/reissue/label printing; kits with
versioned snapshots; incidents; liabilities with employee dispute; audits with
variance and approval; alerts with dedup (`custody_run_alerts` +
`custody_alert_deliveries`, wired to `app/api/cron/custody-alerts/route.ts`);
depreciation; rental with pricing, contracts, evidence and stock coupling;
feature flags for the risky modules (GPS, offline, Zoho, insurance are OFF by
default).

**Partial:** reservations (§7); maintenance is event-only, there is no plan or
schedule; costing stops at depreciation + maintenance cost, nothing rolls it up
per asset or per project; utilization is not computed anywhere; condition is
recorded in three different vocabularies (§9.5); the enterprise tab surfaces
flags but several enterprise RPCs (components, purchase requests, GPS, offline)
have wrappers in `custodyEnterprise.ts` with no screen.

---

## 9. Duplication between the families — where a second source of truth appears

**9.1 Rental tables are created twice.** `custody_rental_requests`,
`_items`, `_customers`, `_contracts`, `_inspections`, `insurance_claims` and
`asset_insurance_policies` are each defined by **both**
`docs/custody_enterprise_05_rental_insurance_PATCH.sql` **and**
`docs/rental_insurance_production_RUNME.sql`, both with `create table if not
exists`. Whichever ran first wins the base shape. The production file defends
itself with 52 `add column if not exists` statements; the enterprise patch does
**not** reconcile in the other direction. Run order therefore changes the schema.

**9.2 Two custody ledgers.** `custody_records`/`custody_items` (free-text item
names, no `asset_id`) vs `custody_inventory_assignments`/`_items` (real
`asset_id`). Both are employee-facing; the only reconciliation is the
`legacy_custody_employee_visible` flag. A camera issued on the old form is
invisible to the new stock arithmetic.

**9.3 Three booking calendars over the same equipment.**
`custody_inventory_reservations`, rental `custody_rental_items.status='reserved'`,
and `planning_bookings` from `docs/project_resources_batch4b_RUNME.sql` (whose
`planning_resources` registry points at `custody_inventory_assets` by
`source_type='custody_inventory_assets'` + `source_id`). The 4B file contains
**zero references** to `custody_inventory_assignments` or `custody_rental_*` — so
its conflict engine cannot see a camera that is on an employee's custody or out
on rent. Rental *does* respect both custody and reservations
(`rental_insurance_production_RUNME.sql:492`: `free = quantity_available - rented
- reserved`), which makes 4B the only blind participant.

**9.4 Two project linkages on one row.** `custody_inventory_assignments` has
`project_id uuid` (v1, no FK) *and* `project_number text` + `project_name` +
`project_company_id` (`custody_enterprise_02`). `custody_finance_asset_usage`
counts `distinct a.project_number`; `custody_inv_admin_project_dashboard` keys on
`project_number`; the create RPC only ever writes `project_id`. Two answers to
"which project used this camera".

**9.5 Three condition vocabularies.** `assets.condition_status` (8:
new/excellent/good/fair/damaged/under_maintenance/lost/retired),
`custody_condition_reports.grade` (9: excellent/good/used/has_notes/
partially_damaged/damaged/unusable/incomplete/missing), and
`assignment_items.condition_at_issue`/`_at_return` (free text).

**9.6 Photo tables.** `custody_photos` (legacy), `custody_inventory_asset_files`
+ `custody_inventory_evidence` (new), `custody_rental_evidence` (rental).
Three buckets, three policies — this is defensible as separation of concerns,
but any "all photos of this asset" feature must union three sources.

**9.7 Gate functions redefined in many files.** `civ_can_manage()` has 4
definitions, `civ_can_finance()` 3, `civ_can_delete_asset()` 3. Last file run
wins, silently. See §11.

---

## 10. Data-loss risks

1. **Re-running an old file silently changes behaviour.** The RUNME files use
   `create or replace function` with no version guard, so replaying
   `portal_custody_inventory_system_v1_RUNME.sql` reverts both the profession
   bridge and the null-collapse fix (§11.1).
2. **`ROLLBACK` scripts that drop columns now drop real custody history**, because
   these tables are live and hold issued equipment. Any rollback we write must
   say so in capitals rather than presenting itself as reversible.
3. **Movements/audit rows have no soft delete.** That is correct as a design, but
   it also means no recovery path if a superuser deletes them outside the RPCs.
4. **Storage objects outlive their rows.** Deleting an evidence row is soft; the
   object stays in the bucket. `custody_asset_photos_production_RUNME.sql`
   back-fills orphan objects, which is only possible because the path convention
   `{asset_id}/asset_photo/…` was respected. Any new path convention breaks it.
5. **Enterprise-05-first ordering** (§9.1) leaves the rental tables without the
   pricing/deposit columns until the production file's ALTERs run — features
   would read as "column missing" on real rows.

---

## 11. Authorization-bypass risks

**11.1 The live one — `if not civ_can_manage()` is fail-open when the gate
returns NULL.** `staff_role()` is a bare scalar sub-select and returns NULL for a
user with no active profile row. In the pre-fix definition
`select is_owner() or staff_role() in (...)`, `false or NULL` = **NULL**. Inside
every RPC the guard is written `if not public.civ_can_manage() then raise
exception 'not authorized'; end if;` — and `not NULL` is NULL, which is not
true, so **the exception is skipped and the RPC proceeds**. This is why
`authz_fixC_null_failopen_gates_RUNME.sql` wraps the whole expression in
`coalesce(…, false)`. Consequence for us: *any* file we write that re-declares
`civ_can_manage()` without the coalesce re-opens the hole across ~120 call
sites. Our SQL must not redefine it at all.

**11.2 `civ_can_finance()` and the enterprise gates are not coalesce-wrapped.**
`select is_owner() or staff_role() = 'finance'` can return NULL. It is safe
*today* only because it is consumed either as a value (`v_fin`, NULL then falls
to the masked branch) or inside RLS (NULL = deny). The moment someone writes
`if not civ_can_finance() then raise` it becomes a fail-open. `civ_can_admin()`,
`civ_can_delete_asset()` and `civ_is_employee()` are safe — they reduce to
`exists(...)`, which is never NULL.

**11.3 Evidence-bucket ownership by path prefix.** Evidence read/write is granted
when `(storage.foldername(name))[1] = auth.uid()::text`. It is a string compare,
not a join to the assignment — so an employee can read *their own* folder even
for an assignment that has since been reassigned. Low severity, worth knowing
before we extend the bucket.

**11.4 Ordering dependency between the bridge and the fix.** Running the
profession bridge *after* the authz fix restores the non-coalesced body. The
correct final body (bridge branch **and** coalesce) exists only in
`authz_fixC_null_failopen_gates_RUNME.sql:135`.

**11.5 `civ_can_manage()` is a single very wide gate.** It covers reading the
whole catalogue including `purchase_price` (masked separately), issuing to any
employee, adjusting stock, and uploading to the assets bucket. A profession
carrying `manage_custody` gets all of it. Any finer capability we add should be
a *new narrow predicate*, never a widening of this one.

---

## 12. Additive extension plan — smallest blast radius

Verdict per capability in the brief. "EXISTS" means do not build it.

| Capability | Verdict | Evidence / what is actually needed |
|---|---|---|
| **Asset codes** | **EXISTS** | `custody_inventory_assets.asset_code` unique, auto-generated `KIAN-YYMMDD-XXXXXXXX` by `civ_gen_no('KIAN')` when not supplied; `barcode` and `qr_code_value` also unique, with `idx_civ_assets_code_lower`. Only add a column if a *category-sequential* scheme is required — one optional `code_scheme text` on the categories table, nothing more. |
| **QR** | **EXISTS** | `qr_code_value` on the asset, `custody_qr_events` (printed/reissued/revoked/scanned), `custody_inv_resolve_qr` / `_admin_reissue_qr` / `_log_label_print`, UI `CustodyQrLabels.tsx`, flag `qr_scanning_enabled`. |
| **Condition grades** | **NEEDS RECONCILIATION, NOT A TABLE** | `custody_condition_reports.grade` (9 grades, per stage, with photos + video) is already the richest record. Add one **derived** mapping function grade → `condition_status`, and optionally one column `custody_inventory_assets.condition_grade text` kept in step with the newest `inspector_final` report. Do **not** create a grades table. |
| **Kits** | **EXISTS** | `custody_inventory_kits` + `_kit_items` + `_kit_versions` (jsonb snapshot) + `_kit_movements`, `custody_inv_admin_upsert_kit`/`_snapshot_kit`/`_get_kit_resolved`/`custody_inv_employee_issue_kit`, `assignments.kit_id` + `kit_snapshot`. Missing only a management screen. |
| **Status machine** | **EXISTS (implicit)** | `assignments.status` (10), `assignment_items.status` (8), `assets.availability_status` (7) derived by `civ_set_avail`, `condition_status` (8). Transitions are enforced inside each RPC, not declared. Additive improvement: one read-only `civ_allowed_transitions(entity, from)` function so the UI stops guessing. No table. |
| **Checkout / return** | **EXISTS, complete** | §4. Locking, double-issue guard, evidence, inspection, ledger, notifications, admin fallback. Do not touch. |
| **Reservations** | **NEEDS COLUMNS + GUARDS, table exists** | `custody_inventory_reservations` exists. Add: overlap validation inside a *new* `custody_inv_admin_create_reservation_v2` (never redefine v1 in place), honour `reserved_from`, a `fulfilled_by_assignment_id uuid` column so fulfilment is recordable, and a reservations tab in the console. |
| **Maintenance plans** | **NEEDS A NEW TABLE** | `custody_inventory_maintenance` is strictly per-event. Nothing holds "service every 6 months / every 500 hours". New: `custody_inventory_maintenance_plans` (asset_id or category_id, interval_months, interval_meter, last_done_at, next_due_at derived). It links *to* the existing maintenance table; it does not replace it. |
| **Usage metering** | **NEEDS A NEW TABLE** | Nothing anywhere stores a meter reading (shutter count, hours, kilometres). `custody_finance_asset_usage` counts issue events only. New: `custody_inventory_meter_readings` (asset_id, meter_type, value, recorded_at, source, recorded_by) — append-only, same shape discipline as `_movements`. |
| **Costing** | **MOSTLY EXISTS — derived RPC only** | Already present: `purchase_price`, `current_value`, `book_value`, `useful_life_months`, `custody_finance_compute_depreciation`, `maintenance.cost`, `custody_maintenance_approve_cost`, rental `custody_rental_charges`, purchase requests with quotes. Missing is only a roll-up. Add a **read-only** `custody_inv_asset_cost_summary(asset)` masked by `civ_can_finance()`. Optional single column `salvage_value numeric`. No new table. |
| **Utilization** | **DERIVED RPC ONLY** | The data is already in `custody_inventory_movements` (issue/return timestamps) + assignments + rental items. Add `custody_inv_asset_utilization(asset, from, to)` returning days-out / days-in-period / idle days / times issued. No new table, no new column. |

### 12.1 Net new objects proposed
Two tables — `custody_inventory_maintenance_plans`,
`custody_inventory_meter_readings` — because nothing exists to hold a *schedule*
or a *meter reading*. Three or four optional columns
(`reservations.fulfilled_by_assignment_id`, `assets.condition_grade`,
`assets.salvage_value`, `categories.code_scheme`). Everything else is a new
read-only RPC over tables that already exist.

### 12.2 Rules the extension must follow
- Prefix new objects `custody_inventory_*` / `custody_inv_*`. **Never `asset_*`.**
- Never redefine `civ_can_manage()`, `civ_can_finance()` or
  `civ_can_delete_asset()` — reference them. If a narrower capability is needed,
  declare a *new* predicate that `coalesce(…, false)` and returns an explicit
  boolean on every path.
- Never write to `quantity_available` outside a locked (`for update`) block that
  also writes a `custody_inventory_movements` row.
- PREFLIGHT must FAIL, not warn, if `custody_inventory_assets`,
  `custody_inventory_movements` or `civ_can_manage()` is absent.
- POSTCHECK must be structural and static (`pg_get_functiondef` + `ilike`), never
  a live protected-RPC call — the SQL editor runs as `postgres` with
  `auth.uid() = NULL`, so a real call raises `not authorized` and aborts.
- Anything a technician uses on location is Arabic, RTL and mobile-first.

### 12.3 Reconciliation work that is not a feature, and is worth more than one
1. Decide the winner between `assignments.project_id` and `project_number`
   (§9.4) and make the loser derived.
2. Teach the 4B conflict engine about custody and rental, or state in the UI
   that it only sees planning bookings (§9.3).
3. Publish the rental-table run order (§9.1) so the production file always runs
   after the enterprise patch.
4. Re-assert the coalesced `civ_can_manage()` body as the last statement of any
   package that touches custody (§11.1) — or, better, touch it never.
