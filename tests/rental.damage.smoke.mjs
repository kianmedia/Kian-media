// اختبارات تسوية الضرر + الفاتورة التلقائية + الملف الموحّد (node:test — بلا حزم/DB).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const DMG = read("docs/rental_damage_invoice_HOTFIX_RUNME.sql");
const UNI = read("docs/rental_v1_final_production_RUNME.sql");
const LIB = read("lib/portal/rental.ts");
const RENTER = read("components/portal/rental/RenterRentalView.tsx");

test("damage/invoice hotfix + unified file exist, idempotent, non-destructive", () => {
  for (const p of ["docs/rental_damage_invoice_HOTFIX_RUNME.sql", "docs/rental_v1_final_production_RUNME.sql"]) assert.ok(existsSync(root + p));
  for (const s of [DMG, UNI]) { assert.ok(!/drop table|truncate|delete from public\./i.test(s)); assert.match(s, /notify pgrst, 'reload schema'/); }
});

// ═══ خصم التأمين + فاتورة الفرق ═══
test("approve_charge: deposit clamp + additional_due + auto-invoice on excess", () => {
  const b = DMG.slice(DMG.indexOf("function public.custody_rental_approve_charge"));
  assert.match(b, /v_apply := least\(greatest\(0, coalesce\(p_from_deposit,0\)\), v_remaining, v_approved\)/);
  assert.match(b, /v_due := greatest\(0, v_approved - v_apply\)/);
  // فاتورة فقط عند الفرق وخلف علم المالية
  assert.match(b, /if v_due > 0 and public\.civ_flag\('rental_finance_enabled'\)/);
  assert.match(b, /insert into public\.invoices/);
  assert.match(b, /'rental_damage_charge'/);
  assert.match(b, /ready_for_zoho/);
  assert.match(b, /update public\.custody_rental_charges set invoice_id = v_inv/);
});
test("deposit status → partially/fully_applied", () => {
  const b = DMG.slice(DMG.indexOf("function public.custody_rental_approve_charge"));
  assert.match(b, /fully_applied/);
  assert.match(b, /partially_applied/);
});
test("invoice reuses invoices table (no parallel finance) + VAT + rental link cols", () => {
  for (const c of ["source", "rental_id", "rental_customer_id", "rental_claim_id", "ready_for_zoho"]) assert.match(DMG, new RegExp(`add column if not exists ${c}`));
  const b = DMG.slice(DMG.indexOf("function public.custody_rental_approve_charge"));
  assert.match(b, /v_vat := round\(v_due \* v_vatrate \/ 100\.0, 2\)/);
  assert.match(b, /subtotal, vat, total/);
});
test("wider damage types + objection; renter invoice read is ownership-scoped", () => {
  assert.match(DMG, /'dirty','scratch','dent','broken'/);
  assert.match(DMG, /function public\.custody_rental_charge_objection/);
  const inv = DMG.slice(DMG.indexOf("function public.custody_rental_customer_invoices"));
  assert.match(inv, /c\.user_id = auth\.uid\(\)/);
  assert.match(inv, /source = 'rental_damage_charge'/);
  assert.ok(!/purchase_price|internal_note/.test(inv));
});
test("close does NOT block on Zoho (ready_for_zoho only) ", () => {
  assert.ok(!/zoho_sync|await zoho|zoho_invoice_id :=/i.test(DMG.replace(/--.*$/gm, "")));
});

// ═══ الملف الموحّد ═══
test("unified file concatenates the 5 parts in dependency order", () => {
  const order = ["rental_portal_operational_HOTFIX", "rental_rpc_signatures_and_availability_HOTFIX", "rental_client_linking_HOTFIX", "rental_renter_binding_evidence_HOTFIX", "rental_damage_invoice_HOTFIX"];
  let last = -1;
  for (const p of order) { const i = UNI.indexOf(p); assert.ok(i > last, `part out of order: ${p}`); last = i; }
  assert.match(UNI, /شغّله بعد docs\/rental_insurance_production_RUNME\.sql/);
});

// ═══ lib + UI ═══
test("lib + UI: renter sees damage invoices; admin sees deposit split", () => {
  assert.match(LIB, /export const rentalCustomerInvoices/);
  assert.match(LIB, /export interface RentalDamageInvoice/);
  assert.match(RENTER, /فواتير الأضرار/);
  assert.match(RENTER, /rentalCustomerInvoices\(requestId\)/);
});
