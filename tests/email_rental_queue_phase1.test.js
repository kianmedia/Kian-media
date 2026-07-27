// ════════════════════════════════════════════════════════════════════════════
// tests/email_rental_queue_phase1.test.js — P1.4 · RENTAL ONTO THE QUEUE (FLAG OFF)
//
// Rental was the last email path leaving without a queue row: civ_notify deliberately
// excludes rental_% (custody_notification_matrix_RUNME.sql:51) because rental bodies
// carry money. Consequence: no idempotency key, no retry, no dead-letter, invisible to
// the monitor.
//
// This builds the CAPABILITY only. The owner's constraints, pinned here:
//   - flag ships OFF; no cutover before the Apps Script handler is deployed and a real
//     notification is observed reaching 'sent'
//   - the existing direct path is neither stopped nor deleted
//   - allowed in email: agreed amount, VAT, total, deposit, deposit/payment STATUS
//   - forbidden: internal cost, profit margin, supplier pricing, bank/payment details,
//     and any amount or address in logs
//   - the recipient must be verified server-side as actually linked to the rental
//
// The switch matters: running the queued path ALONGSIDE the direct path would
// double-send every rental notification, so exactly one executes.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/email_backbone_phase1_rental_RUNME.sql");
const ROUTE = R("app/api/integrations/rental/notify/route.ts");
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const routeCode = ROUTE.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// helper: isolate one SQL function body
const fnBody = (name) => {
  const i = code.indexOf(`function public.${name}`);
  assert.ok(i > 0, `${name} must be defined`);
  const start = code.indexOf("$$", i);
  const end = code.indexOf("$$;", start + 2);
  return code.slice(start, end);
};

// ─── (A) no cutover — the flag ships OFF ─────────────────────────────────────

test("P1.4 the flag is added defaulting to false", () => {
  assert.match(
    code,
    /add column if not exists rental_email_queue_enabled boolean not null default false/i,
    "the capability must ship inert",
  );
});

test("P1.4 the file refuses to commit if the flag is not OFF", () => {
  assert.match(code, /civ_rental_email_queue_enabled\(\)\s+into\s+v_flag/i);
  assert.match(code, /if v_flag is not false then[\s\S]{0,160}?raise exception/i,
    "a file that silently switched rental email over would be a cutover, which is forbidden here");
});

test("P1.4 no new table — the existing settings table is reused", () => {
  assert.ok(!/create table/i.test(code), "custody_inventory_settings already exists; a parallel table is forbidden");
  assert.match(code, /alter table public\.custody_inventory_settings/i);
});

// ─── (B) the financial content policy is enforced in SQL, not the UI ─────────

test("P1.4 the body carries exactly the five allowed financial fields", () => {
  const body = fnBody("civ_rental_email_body");
  for (const col of ["subtotal", "vat_amount", "grand_total", "deposit_amount", "deposit_status"]) {
    assert.ok(new RegExp(`\\b${col}\\b`).test(body), `allowed field missing: ${col}`);
  }
});

test("P1.4 payment instrument details are excluded, not merely unused", () => {
  const body = fnBody("civ_rental_email_body");
  // deposit_method = how they paid, deposit_ref_no = the transfer reference. Both are
  // payment-sensitive data, NOT the "payment status the client needs".
  assert.ok(!/deposit_method/.test(body), "deposit_method is payment-sensitive and must never be emailed");
  assert.ok(!/deposit_ref_no/.test(body), "deposit_ref_no is a transfer reference and must never be emailed");
});

test("P1.4 no internal cost, margin or supplier pricing can reach the body", () => {
  const body = fnBody("civ_rental_email_body");
  for (const forbidden of ["cost", "margin", "profit", "supplier", "vendor", "purchase_value", "iban", "bank"]) {
    assert.ok(
      !new RegExp(forbidden, "i").test(body),
      `forbidden concept '${forbidden}' appears in the email body builder`,
    );
  }
});

test("P1.4 the body is built in SQL so the route cannot leak a field", () => {
  assert.match(code, /function public\.civ_rental_email_body/i);
  // The route must not compose money itself.
  for (const forbidden of ["grand_total", "vat_amount", "deposit_amount", "subtotal"]) {
    assert.ok(
      !new RegExp(forbidden).test(routeCode),
      `${forbidden} must not be assembled in the route — SQL is the single place the policy is enforced`,
    );
  }
});

// ─── (C) server-side recipient verification ─────────────────────────────────

test("P1.4 an unlinked recipient is refused before any insert", () => {
  const enq = fnBody("civ_rental_enqueue_email");
  const guardAt = enq.indexOf("civ_rental_email_recipient_allowed");
  const insertAt = enq.indexOf("nt_enqueue_email_idem");
  assert.ok(guardAt > 0, "the linkage guard must be called");
  assert.ok(insertAt > guardAt, "the guard must run BEFORE the enqueue, not after");
  assert.match(enq, /not_linked/);
});

test("P1.4 linkage covers the renter and authorised staff only", () => {
  const g = fnBody("civ_rental_email_recipient_allowed");
  assert.match(g, /custody_rental_customers/, "the renter is matched through the rental's own customer row");
  assert.match(g, /auth\.users/, "including the email on their portal account");
  assert.match(g, /account_status = 'active'/, "inactive staff must not receive rental mail");
  assert.match(g, /custody_officer|finance/, "the staff audience must match the direct path's");
});

test("P1.4 the self-check proves an unlinked address is rejected", () => {
  assert.match(code, /definitely-not-linked@example\.invalid/);
  assert.match(code, /raise exception 'فشل أمني: قُبل مستلِم غير مرتبط/);
});

// ─── (D) idempotency ─────────────────────────────────────────────────────────

test("P1.4 the key is stable and unique per event x rental x recipient", () => {
  const enq = fnBody("civ_rental_enqueue_email");
  assert.match(
    enq,
    /v_key\s*:=\s*'rental:'[\s\S]{0,200}?p_rental::text[\s\S]{0,80}?v_email/,
    "all three identity components must be in the key",
  );
  // Nothing time-varying may enter the key or retries would create new rows.
  assert.ok(!/now\(\)|clock_timestamp|random/i.test(enq.slice(enq.indexOf("v_key :="), enq.indexOf("perform"))),
    "a time-varying key would defeat dedupe on every retry");
});

test("P1.4 the delivery id is read back so the caller can drain exactly those rows", () => {
  const enq = fnBody("civ_rental_enqueue_email");
  assert.match(enq, /select id into v_id from public\.email_deliveries where idempotency_key = v_key/i);
  assert.match(enq, /'delivery_id', v_id/);
  assert.match(routeCode, /q\.data\?\.delivery_id/, "the route must collect them");
  assert.match(routeCode, /processQueue\(ids\.length, \{ deliveryIds: ids \}\)/, "and drain by exact id");
});

// ─── (E) it is a switch, not an addition ────────────────────────────────────

test("P1.4 exactly one path runs — the queued branch returns", () => {
  const i = routeCode.indexOf("civ_rental_email_queue_enabled");
  assert.ok(i > 0, "the route must read the flag");
  const branch = routeCode.slice(i, routeCode.indexOf("const url = emailEndpoint()", i));
  assert.match(branch, /return NextResponse\.json/, "the queued branch must return, or both paths would send");
});

test("P1.4 the direct path is preserved intact", () => {
  assert.match(ROUTE, /_type:\s*"portal_notify"/, "the direct send must still exist");
  assert.match(ROUTE, /interpretRelayResponse/, "including its provider confirmation");
  assert.match(ROUTE, /custodyEmailEnabled\(\)/, "and its existing enable check");
});

// ─── (F) logs leak nothing ──────────────────────────────────────────────────

test("P1.4 no amount or recipient address is logged", () => {
  const i = routeCode.indexOf("rental_email_queued");
  assert.ok(i > 0, "the queued path must log something");
  const line = routeCode.slice(i, routeCode.indexOf("\n", i));
  assert.ok(!/\bto\b\s*[,:}]|recipient_email|renterEmail/.test(line), "addresses must not be logged");
  for (const f of ["total", "vat", "deposit", "amount"]) {
    assert.ok(!new RegExp(f, "i").test(line), `'${f}' must not be logged`);
  }
  assert.match(line, /recipient_count/, "counts are fine");
});

test("P1.4 the SQL error path logs only a SQLSTATE", () => {
  const enq = fnBody("civ_rental_enqueue_email");
  const i = enq.indexOf("exception when others");
  const tail = enq.slice(i);
  assert.match(tail, /raise warning[^;]*sqlstate/i);
  assert.ok(!/v_body|v_email|p_recipient_email/.test(tail), "never log the body or the address");
});

// ─── (G) retention redacts, never deletes ───────────────────────────────────

test("P1.4 retention redacts the body and keeps the row", () => {
  const f = fnBody("civ_rental_email_redact_old");
  assert.match(f, /set body_text = '\[redacted-by-retention-policy\]'/);
  assert.ok(!/delete from/i.test(code), "deleting production rows is forbidden; the audit trail must survive");
  assert.match(f, /can_manage_projects/, "admin-gated");
  assert.match(f, /greatest\(coalesce\(p_days, 90\), 7\)/, "a floor prevents redacting mail that is still operational");
  assert.match(f, /left\(coalesce\(idempotency_key, ''\), 7\) = 'rental:'/, "scoped to rental rows only");
});

test("P1.4 retention is not wired to any cron", () => {
  const crons = JSON.parse(R("vercel.json")).crons ?? [];
  assert.equal(crons.length, 3, "no new cron may be added");
  for (const f of ["app/api/cron/notify-email/route.ts", "app/api/cron/custody-alerts/route.ts"]) {
    assert.ok(!/civ_rental_email_redact_old/.test(R(f)), "running it must stay an explicit admin decision");
  }
});

// ─── (H) privileges ─────────────────────────────────────────────────────────

test("P1.4 no logged-in account can enqueue rental email directly", () => {
  assert.match(
    code,
    /revoke all on function public\.civ_rental_enqueue_email\([^)]*\) from public, anon, authenticated/i,
  );
  assert.match(code, /grant\s+execute on function public\.civ_rental_enqueue_email\([^)]*\) to service_role/i);
  assert.match(code, /has_function_privilege\('authenticated'[\s\S]{0,180}?raise exception 'فشل أمني/);
});

test("P1.4 the body and linkage helpers are service-only too", () => {
  for (const fn of ["civ_rental_email_body", "civ_rental_email_recipient_allowed"]) {
    assert.match(
      code,
      new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated`, "i"),
      `${fn} must not be callable by a logged-in account`,
    );
  }
});

// ─── (I) safety envelope ────────────────────────────────────────────────────

test("P1.4 is additive and reuses the existing pipeline", () => {
  assert.ok(!/\bdrop\s+(table|function|column)\b/i.test(code), "no DROP");
  assert.ok(!/\btruncate\b/i.test(code), "no truncate");
  assert.match(code, /nt_enqueue_email_idem/, "reuses the single enqueue helper — no second queue");
  assert.ok(!/create table/i.test(code), "no new table");
  const definers = code.match(/security definer set search_path = public/gi) ?? [];
  assert.ok(definers.length >= 4, `all SECURITY DEFINER functions must pin search_path; found ${definers.length}`);
});

test("P1.4 rental email failure can never fail the rental operation", () => {
  assert.match(fnBody("civ_rental_enqueue_email"), /exception when others/i);
});
