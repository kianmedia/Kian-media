// ════════════════════════════════════════════════════════════════════════════
// tests/email_config_truth_phase1.test.js — P1.0 · SHIPPED ARTIFACTS THAT LIED
//
// None of these changed a code path. They are pinned because each one was a live
// trap that would cost real delivery:
//
//  1. .env.example shipped `PROJECT_EMAIL_ALERTS_ENABLED=false`. The channel is
//     opt-OUT (projectNotify.ts:24 disables only on the literal "false"), so an
//     operator copying .env.example verbatim darkened the entire project email
//     channel — reintroducing the exact Batch 9D defect that projectNotify.ts:9-12
//     exists to document.
//  2. CRON_SECRET appeared ZERO times in .env.example, while three cron routes
//     fail closed with HTTP 500 without it.
//  3. Two docs still advertised paste-ready Apps Script handlers that SEND the mail
//     but reply in a shape our relay reader cannot acknowledge — so the row is never
//     marked sent, never burns an attempt, and re-sends daily for a week
//     (~7 duplicates per notification). Strictly worse than no handler at all.
//  4. Two custody docs claimed the alerts cron runs hourly; vercel.json schedules it
//     daily at 03:00.
//  5. The drain route's header claimed to be "the PRIMARY (immediate) email path"
//     fired by "any authenticated action" — it has no caller at all.
//
// String-pin style, matching tests/relay_handler_batch11.test.js. No DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const ENV = R(".env.example");
const WORKER = R("lib/server/notifyWorker.ts");
const CRON = R("app/api/cron/notify-email/route.ts");
const DRAIN = R("app/api/integrations/notify/drain/route.ts");
const PROJNOTIFY = R("lib/server/projectNotify.ts");
const VERCEL = R("vercel.json");

// ─── (1) the opt-out foot-gun ───

test("P1.0 .env.example must not ship the one value that disables project email", () => {
  const active = ENV.split("\n").filter((l) => !l.trim().startsWith("#"));
  const offender = active.find((l) => /^\s*PROJECT_EMAIL_ALERTS_ENABLED\s*=\s*false\s*$/i.test(l));
  assert.equal(
    offender,
    undefined,
    "copying .env.example verbatim would darken the whole project email channel",
  );
});

test("P1.0 the kill switch really is opt-out (the reason the above matters)", () => {
  assert.match(
    PROJNOTIFY,
    /PROJECT_EMAIL_ALERTS_ENABLED\s*\?\?\s*""\)\s*\.trim\(\)\s*!==\s*"false"/,
    "only the literal string 'false' disables it — so shipping that literal is the whole bug",
  );
});

test("P1.0 .env.example documents the env vars the email path needs", () => {
  for (const name of ["CRON_SECRET", "PORTAL_NOTIFY_ENDPOINT", "PORTAL_PUBLIC_URL"]) {
    assert.ok(new RegExp(`^\\s*${name}\\s*=`, "m").test(ENV), `${name} must be declared`);
  }
});

test("P1.0 .env.example still carries no secret values", () => {
  const assigned = ENV.split("\n")
    .filter((l) => !l.trim().startsWith("#"))
    .filter((l) => /^\s*(CRON_SECRET|PORTAL_NOTIFY_ENDPOINT|PORTAL_PUBLIC_URL)\s*=\s*\S/.test(l));
  assert.deepEqual(assigned, [], "these must be declared empty — an example file must never hold real values");
});

// ─── (2) cron budget ───

test("P1.0 the email cron declares maxDuration", () => {
  assert.match(CRON, /export\s+const\s+maxDuration\s*=\s*\d+/, "mirrors app/api/cron/zoho-sync/route.ts");
});

// ─── (3) the backoff comment matched the code ───

test("P1.0 the worker's backoff comment matches its own formula", () => {
  const formula = WORKER.match(/const\s+backoffMin\s*=\s*(\d+)\s*\*\s*Math\.pow\(2,\s*attempts\)/);
  assert.ok(formula, "the backoff expression must still exist");
  assert.equal(formula[1], "5", "code computes 5 * 2^attempts");
  const header = WORKER.split("\n").slice(0, 25).join("\n");
  assert.ok(!/10m·2\^attempts/.test(header), "the stale '10m·2^attempts' claim must be gone");
  assert.match(header, /5m·2\^attempts/, "the comment must state the real base");
});

// ─── (4) the duplicate-generating snippets are marked ───

for (const [file, label] of [
  ["docs/custody/apps_script_custody_email_SETUP.md", "custody setup"],
  ["docs/portal_email_notifications.md", "portal email notifications"],
]) {
  test(`P1.0 ${label} is marked superseded and points at the supported handler`, () => {
    const doc = R(file);
    assert.ok(
      /متجاوَز|SUPERSEDED/.test(doc),
      `${file} still reads as paste-ready; its snippet causes ~7 duplicate emails per notification`,
    );
    assert.ok(
      /apps_script_portal_notify_HANDLER\.gs/.test(doc),
      `${file} must redirect the reader to the supported handler`,
    );
  });
}

test("P1.0 the supported handler is the one that replies with an identifiable receipt", () => {
  // This is what makes the superseded snippets dangerous rather than merely old.
  assert.match(R("docs/apps_script_portal_notify_HANDLER.gs"), /handler:\s*["']portal_notify["']/);
  assert.match(
    PROJNOTIFY,
    /obj\.handler\s*===\s*["']portal_notify["']/,
    "only the tagged reply is accepted as proof of delivery",
  );
});

// ─── (5) cron schedule claims match vercel.json ───

test("P1.0 custody docs no longer claim an hourly cron", () => {
  const crons = JSON.parse(VERCEL).crons ?? [];
  const custody = crons.find((c) => String(c.path).includes("custody-alerts"));
  assert.ok(custody, "the custody cron must exist in vercel.json");
  assert.equal(custody.schedule, "0 3 * * *", "it is daily at 03:00");
  for (const f of ["docs/CUSTODY_ENTERPRISE_ADMIN_GUIDE_AR.md", "docs/CUSTODY_ENTERPRISE_SQL_RUN_ORDER.md"]) {
    assert.ok(!/كل ساعة/.test(R(f)), `${f} must not claim hourly scheduling`);
  }
});

test("P1.0 there is still exactly one email cron (no per-module cron)", () => {
  const crons = JSON.parse(VERCEL).crons ?? [];
  const emailCrons = crons.filter((c) => /notify-email/.test(String(c.path)));
  assert.equal(emailCrons.length, 1, "the owner constraint forbids a second email cron");
});

// ─── (6) the drain route describes itself accurately ───

test("P1.0 the drain route no longer claims to be the primary email path", () => {
  const header = DRAIN.split("\n").slice(0, 30).join("\n");
  assert.ok(
    !/the PRIMARY \(immediate\) email path/.test(header),
    "it has no automatic caller; describing it as primary sends the next reader down a dead path",
  );
  assert.match(header, /ADMIN-ONLY manual escape hatch/i);
});

test("P1.0 the drain route really does have no in-repo caller", () => {
  // If this ever fails, the header above became wrong and must be updated.
  const searchRoots = ["app", "lib", "components"];
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const body = R(rel);
        // the route's own file is not a caller
        if (rel.includes(path.join("notify", "drain"))) continue;
        if (/integrations\/notify\/drain/.test(body)) hits.push(rel);
      }
    }
  };
  searchRoots.forEach(walk);
  assert.deepEqual(hits, [], "a caller appeared — the drain route header must be corrected");
});
