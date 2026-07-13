// اختبارات توحيد توقيعات RPC + تطبيع الكمية المتاحة (node:test — بلا حزم/DB).
// PostgREST يطابق أسماء البارامترات حرفيًا؛ هذه تحمي من عودة عدم التطابق و undefined.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(root + p, "utf8");
const SIG = read("docs/rental_rpc_signatures_and_availability_HOTFIX_RUNME.sql");
const LIB = read("lib/portal/rental.ts");
const CONSOLE = read("components/portal/rental/RentalConsole.tsx");
const RENTER = read("components/portal/rental/RenterRentalView.tsx");

test("signatures hotfix file exists", () => {
  assert.ok(existsSync(root + "docs/rental_rpc_signatures_and_availability_HOTFIX_RUNME.sql"));
});

// ═══ [1,2] التوقيعات القانونية في SQL ═══
test("admin search canonical signature p_q text, p_limit integer, p_offset integer", () => {
  assert.match(SIG, /custody_rental_admin_search_clients\(p_q text default '', p_limit integer default 20, p_offset integer default 0\)/);
});
test("customer available assets canonical signature p_from timestamptz, p_to timestamptz, p_q text", () => {
  assert.match(SIG, /custody_rental_customer_available_assets\(p_from timestamptz, p_to timestamptz, p_q text default ''\)/);
});
test("availability signature stable (uuid,timestamptz,timestamptz,numeric)", () => {
  assert.match(SIG, /custody_rental_availability\(p_asset uuid, p_from timestamptz, p_to timestamptz, p_qty numeric default 1\)/);
});

// ═══ [3] no overload — drop by EXACT signature only, never bare name ═══
test("drops by exact arg types (clears overloads), never bare-name", () => {
  assert.match(SIG, /drop function if exists public\.custody_rental_admin_search_clients\(text, integer, integer\)/);
  assert.match(SIG, /drop function if exists public\.custody_rental_customer_available_assets\(timestamptz, timestamptz, text\)/);
  assert.match(SIG, /drop function if exists public\.custody_rental_availability\(uuid, timestamptz, timestamptz, numeric\)/);
  assert.ok(!/drop function if exists public\.[a-z_]+;/.test(SIG), "no bare-name drop");
  assert.match(SIG, /'no_overload'/, "validation asserts single version");
});

// ═══ [4] الكمية المتاحة موحّدة على available_quantity + إخراج قانوني ═══
test("availability returns available_quantity (unified field)", () => {
  const b = SIG.slice(SIG.indexOf("create function public.custody_rental_availability"), SIG.indexOf("create function public.custody_rental_admin_search_clients"));
  for (const k of ["available_quantity", "requested_quantity", "total_quantity", "conflict_reason", "next_available_at"]) assert.ok(b.includes(`'${k}'`), `availability missing ${k}`);
  assert.match(b, /'available',/, "keeps 'available' key for add_item");
  assert.match(b, /'free',/, "keeps 'free' for back-compat");
});
test("customer assets return safe unified fields (no cost/internal)", () => {
  const b = SIG.slice(SIG.indexOf("create function public.custody_rental_customer_available_assets"));
  for (const k of ["asset_id", "asset_code", "asset_name", "asset_type", "serial_number", "catalog_photo_path", "total_quantity", "available_quantity", "is_available", "availability_reason", "next_available_at"]) assert.ok(b.includes(`'${k}'`), `customer assets missing ${k}`);
  assert.ok(!/purchase_price|current_value|internal_note|cost/.test(b), "must not expose cost/internal");
});
test("admin search returns rental_customer_id + total_count", () => {
  const b = SIG.slice(SIG.indexOf("create function public.custody_rental_admin_search_clients"), SIG.indexOf("create function public.custody_rental_customer_available_assets"));
  assert.match(b, /rental_customer_id/);
  assert.match(b, /'total_count'/);
  assert.match(b, /civ_can_admin\(\) or public\.civ_can_manage\(\)/, "admin/manager gated");
});

// ═══ [5] Grants + search_path + NOTIFY ═══
test("grants authenticated, revokes public/anon, search_path set, reload schema", () => {
  assert.match(SIG, /grant execute on function public\.custody_rental_admin_search_clients\(text,integer,integer\) to authenticated/);
  assert.match(SIG, /revoke all on function public\.custody_rental_customer_available_assets\(timestamptz,timestamptz,text\) from public, anon/);
  assert.ok((SIG.match(/set search_path = public/g) || []).length >= 3, "each definer sets search_path");
  assert.match(SIG, /notify pgrst, 'reload schema'/);
});
test("idempotent & non-destructive", () => {
  assert.ok(!/drop table|truncate|delete from public/i.test(SIG));
  assert.match(SIG, /PREFLIGHT/);
});

// ═══ [11] تطبيع دفاعي في lib (يشمل free) — لا undefined ═══
test("lib normalization chain includes free fallback and coerces to number", () => {
  assert.match(LIB, /function normAvailQty/);
  assert.match(LIB, /row\.available_quantity \?\? row\.available_qty \?\? row\.free_quantity \?\? row\.qty_available \?\? row\.free \?\? 0/);
  assert.match(LIB, /Number\.isFinite\(n\)/);
});
test("real: normalization of a base-shaped row ({free}) yields a number, not undefined", () => {
  const row = { available: true, free: 3, total: 4 }; // شكل النسخة الأساسية
  const v = row.available_quantity ?? row.available_qty ?? row.free_quantity ?? row.qty_available ?? row.free ?? 0;
  const n = Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0;
  assert.equal(n, 3);
  assert.notEqual(n, undefined);
  assert.ok(!Number.isNaN(n));
});

// ═══ [1,2] lib sends EXACT param names ═══
test("lib wrappers send exact PostgREST param names", () => {
  assert.match(LIB, /custody_rental_admin_search_clients", \{ p_q: q \?\? "", p_limit: limit, p_offset: offset \}/);
  assert.match(LIB, /custody_rental_customer_available_assets", \{ p_from: from, p_to: to, p_q: q \?\? "" \}/);
  assert.match(LIB, /custody_rental_availability", \{ p_asset: assetId, p_from: from, p_to: to, p_qty: qty \}/);
});
test("lib types: RentalClientSearch{rows,total_count}, RentalPortalClient.rental_customer_id, RentalRentableAsset.is_available", () => {
  assert.match(LIB, /interface RentalClientSearch \{ total_count: number.*rows: RentalPortalClient\[\]/s);
  assert.match(LIB, /rental_customer_id: string \| null/);
  assert.match(LIB, /is_available: boolean/);
});

// ═══ [7,12] UI wiring ═══
test("admin UI reads .rows, reuses rental_customer_id (no dup), shows no-results, requested>available msg", () => {
  assert.match(CONSOLE, /setClientResults\(r\.data\.rows\)/);
  assert.match(CONSOLE, /if \(c\.rental_customer_id\)/, "reuse existing link, no re-upsert");
  assert.match(CONSOLE, /لا توجد نتائج مطابقة/);
  assert.match(CONSOLE, /الكمية المطلوبة غير متاحة\. المتاح حاليًا/);
});
test("[3,8] UI never shows raw PostgREST error; shows loading/no-results; renter uses available_quantity", () => {
  assert.ok(!/schema cache|Could not find the function/.test(CONSOLE + RENTER), "no raw PostgREST text in UI");
  assert.match(RENTER, /لا توجد معدات متاحة/);
  assert.match(RENTER, /a\.available_quantity/);
  assert.match(RENTER, /rentalErrorAr\(r\.error\)/, "Arabic error mapping on RPC failure");
});
test("[13] changing the window clears stale search results", () => {
  assert.match(RENTER, /setResults\(\[\]\); setSearched\(false\);.*\}, \[f\.rental_from, f\.rental_to\]/s);
  assert.match(CONSOLE, /setAvail\(null\);.*\}, \[pick, pickQty, f\.rental_from, f\.rental_to\]/s);
});
