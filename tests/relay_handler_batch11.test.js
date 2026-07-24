// ════════════════════════════════════════════════════════════════════════════
// tests/relay_handler_batch11.test.js — BATCH 11 · THE ACTUAL EMAIL ROOT CAUSE
//
// Production truth: NO portal email ever arrived (projects, custody, rental, HR,
// for every recipient role) while quote-request email DID. Cause: the Google Apps
// Script that owns the mail credentials handled ONLY _type:"quote"
//   (docs/apps_script_email_patch.gs → `if (String(data._type||"") !== "quote") return;`)
// and every portal sender posts _type:"portal_notify" → silently dropped, HTTP 200,
// opaque body → the repo "trusted the 2xx" and marked the row 'sent'. Silent false
// success is why every queue/worker/resolver repair could not fix delivery.
//
// This pins: (1) the payload/handler mismatch is real; (2) an unacknowledged relay is
// NEVER reported as delivered; (3) the shipped Apps Script handler satisfies the new
// contract for arbitrary recipients; (4) the failure is channel-level (defer, no
// attempt burn, no dead-letter, no duplicate); (5) the owner gets a one-click diagnosis.
// No DB, no network, no real email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const PROJNOTIFY = R("lib/server/projectNotify.ts");
const HRNOTIFY = R("lib/server/hrNotify.ts");
const WORKER = R("lib/server/notifyWorker.ts");
const HANDLER = R("docs/apps_script_portal_notify_HANDLER.gs");
const OLDPATCH = R("docs/apps_script_email_patch.gs");
const ADMIN = R("app/api/integrations/project/notify-admin/route.ts");
const MONITOR = R("components/portal/projectcore/NotifyMonitor.tsx");

// ─── (A) the mismatch is real ───
test("11.1 ROOT CAUSE: the old Apps Script emails ONLY _type=quote", () => {
  assert.ok(/!==\s*["']quote["']\s*\)\s*return/.test(OLDPATCH), "the script returns early for anything that is not a quote");
});
test("11.1 ROOT CAUSE: every portal sender posts _type=portal_notify (never 'quote')", () => {
  assert.ok(/_type:\s*["']portal_notify["']/.test(PROJNOTIFY), "projects/custody/rental path sends portal_notify");
  assert.ok(/_type:\s*["']portal_notify["']/.test(HRNOTIFY), "HR path sends portal_notify");
  // => with the old script, BOTH are dropped without sending. That is the outage.
});

// ─── (B) faithful verdict model (mirrors interpretRelayResponse + sendProjectEmail) ───
function verdict(text) {
  const t = (text ?? "").trim();
  if (!t) return { rejected: false, handlerPresent: false, reason: "relay_handler_missing" };
  let obj = null;
  try { const p = JSON.parse(t); obj = p && typeof p === "object" ? p : null; } catch { obj = null; }
  if (!obj) return { rejected: false, handlerPresent: false, reason: "relay_handler_missing" };
  const flag = obj.ok ?? obj.success ?? obj.accepted;
  const errStr = typeof obj.error === "string" ? obj.error : (typeof obj.message === "string" && flag === false ? obj.message : "");
  const isPortal = obj.handler === "portal_notify";
  const sentCount = typeof obj.sent === "number" ? obj.sent : undefined;
  if (flag === false || obj.sent === false || (errStr && errStr.length > 0)) return { rejected: true, handlerPresent: isPortal, reason: "provider_rejected" };
  if (isPortal) return sentCount !== undefined && sentCount <= 0
    ? { rejected: true, handlerPresent: true, reason: "provider_rejected" }
    : { rejected: false, handlerPresent: true, sentCount };
  return { rejected: false, handlerPresent: false, reason: "relay_handler_missing" };
}
const delivered = (v) => !v.rejected && v.handlerPresent;

test("11.2 an un-patched relay (opaque 200) is NEVER reported as delivered", () => {
  for (const body of ["", "   ", "<html><body>ok</body></html>", "The script completed but did not return anything.", "not json at all"]) {
    assert.equal(delivered(verdict(body)), false, `must not claim delivery for: ${JSON.stringify(body.slice(0, 24))}`);
    assert.equal(verdict(body).reason, "relay_handler_missing");
  }
});
test("11.2 the patched relay's acknowledgment IS delivery", () => {
  assert.equal(delivered(verdict(JSON.stringify({ ok: true, handler: "portal_notify", sent: 1 }))), true);
  assert.equal(delivered(verdict(JSON.stringify({ ok: true, handler: "portal_notify", sent: 3 }))), true);
});
test("11.2 handler present but nothing mailed → rejection, not success", () => {
  assert.equal(delivered(verdict(JSON.stringify({ ok: false, handler: "portal_notify", sent: 0, error: "no_valid_recipients" }))), false);
});
test("11.2 the deployed script's HEALTH BANNER is not delivery (live-probe fact)", () => {
  // A read-only probe of the live /exec returns: {"ok":true,"message":"Kian Media forms
  // API is live"}. Accepting a generic truthy `ok` would mark every portal email 'sent'
  // again — only the tagged portal_notify acknowledgment may count as delivery.
  assert.equal(delivered(verdict(JSON.stringify({ ok: true, message: "Kian Media forms API is live" }))), false);
  assert.equal(delivered(verdict(JSON.stringify({ ok: true }))), false, "untagged ok is not a send receipt");
  assert.ok(/handler.*portal_notify|A GENERIC/.test(PROJNOTIFY), "the implementation documents why");
});
test("11.2 explicit provider failure stays a rejection", () => {
  assert.equal(delivered(verdict(JSON.stringify({ ok: false, error: "quota exceeded" }))), false);
  assert.equal(delivered(verdict(JSON.stringify({ success: false }))), false);
});

// ─── (C) the shipped handler satisfies the contract for EVERY recipient role ───
test("11.3 handler honors an arbitrary To (client/renter/employee), not a hardcoded list", () => {
  assert.ok(/data\.To\s*\|\|\s*data\.to/.test(HANDLER), "reads the To field the portal sends");
  assert.ok(/KIAN_PORTAL_FALLBACK_TO/.test(HANDLER), "falls back only when To is empty");
  // The OLD quote-only handler mailed a hardcoded constant and ignored To entirely —
  // so it could never have reached a client, renter or employee.
  assert.ok(/MailApp\.sendEmail\(KIAN_NOTIFY_TO/.test(OLDPATCH), "old handler hardcoded its recipients");
});
test("11.3 handler returns the positive JSON ack the new contract requires", () => {
  assert.ok(/handler:\s*["']portal_notify["']/.test(HANDLER), "tags its reply so delivery is provable");
  assert.ok(/result\.sent\+\+/.test(HANDLER), "counts real sends");
  assert.ok(/if \(result\.sent === 0\) result\.ok = false/.test(HANDLER), "zero sends is reported as failure, never success");
  assert.ok(/ContentService[\s\S]*MimeType\.JSON/.test(HANDLER), "replies as JSON");
});
test("11.3 handler is additive and safe (never breaks the working quote path)", () => {
  assert.ok(/!==\s*["']portal_notify["']\)\s*return null/.test(HANDLER), "returns null for non-portal payloads → existing flow continues");
  assert.ok(/try\s*{/.test(HANDLER) && /catch/.test(HANDLER), "never throws into doPost");
  assert.ok(/for \(var j = 0; j < to\.length; j\+\+\)/.test(HANDLER), "one email per recipient — no cross-disclosure of addresses");
});

// ─── (D) channel-level handling: no attempt burn, no dead-letter, no duplicates ───
test("11.4 relay_handler_missing is treated as a CHANNEL condition in the worker", () => {
  assert.ok(/res\.reason === "relay_handler_missing"/.test(WORKER), "recognized alongside disabled/no_endpoint");
  const i = WORKER.indexOf('relay_handler_missing');
  const block = WORKER.slice(i - 400, i + 500);
  assert.ok(/status:\s*"pending"/.test(block), "row stays pending (nothing lost)");
  assert.ok(!/attempts:/.test(block), "no attempt is burned → cannot dead-letter into oblivion");
  assert.ok(/30 \* 60_000/.test(block), "short defer so the queue self-heals after the handler is applied");
});
test("11.4 both senders return the channel reason instead of a false success", () => {
  assert.ok(/return \{ sent: false, reason: "relay_handler_missing" \}/.test(PROJNOTIFY), "project/custody/rental sender");
  assert.ok(/reason: "relay_handler_missing"/.test(HRNOTIFY), "HR sender no longer trusts a bare HTTP 2xx");
  assert.ok(/interpretRelayResponse/.test(HRNOTIFY), "HR sender uses the shared confirmation");
});

// ─── (E) one-click diagnosis for the owner ───
test("11.5 self-test names the real blocker and the exact fix", () => {
  assert.ok(/relay_handler_missing/.test(ADMIN) && /relay_fix/.test(ADMIN), "route surfaces the diagnosis + remedy");
  assert.ok(/apps_script_portal_notify_HANDLER\.gs/.test(ADMIN), "points at the file to apply");
  assert.ok(/relay_handler_missing/.test(MONITOR), "monitor renders it");
  assert.ok(/portal_notify/.test(MONITOR), "explains WHICH handler is missing");
});

// ─── (F) SQL-independent fallback: email works even with NO Batch-10/9G SQL applied ───
const EVENT = R("lib/server/notifyEvent.ts");
const REVIEW = R("app/api/integrations/project/review/route.ts");

test("11.7 fallback triggers ONLY when the RPC is not deployed (not on real errors)", () => {
  assert.ok(/function rpcNotDeployed/.test(EVENT), "explicit not-deployed detector");
  assert.ok(/PGRST202/.test(EVENT), "recognizes PostgREST's missing-function code");
  assert.ok(/if \(!enq\.ok && rpcNotDeployed\(out\.error\)\) return await emitViaFallback/.test(EVENT),
    "a genuine runtime failure still reports EMAIL_ENQUEUE_FAILED instead of silently re-sending");
});
test("11.7 fallback resolves recipients from BASE tables only", () => {
  assert.ok(/profiles\?select=id,email&account_status=eq\.active/.test(EVENT), "management from profiles");
  assert.ok(/staff_role\.in\.\(super_admin,manager\)/.test(EVENT), "owner/super_admin/manager included");
  assert.ok(/project_members\?select=user_id/.test(EVENT) && /role=eq\.kian_manager/.test(EVENT), "project manager included");
  assert.ok(/authAdminEmails/.test(EVENT), "auth.users is authoritative for email (profiles.email is often blank)");
  assert.ok(/project_client_user_ids/.test(EVENT), "client users for client-facing events");
  assert.ok(!/notification_resolve_recipients|notify_emit_event/.test(EVENT.slice(EVENT.indexOf("resolveRecipientsNoSql"), EVENT.indexOf("emitViaFallback"))),
    "the resolver fallback needs none of the new SQL");
});
test("11.7 fallback uses the SAME single provider (no second channel)", () => {
  assert.ok(/sendProjectEmail/.test(EVENT), "same sender as the canonical path");
  assert.ok(!/nodemailer|smtp|resend|sendgrid/i.test(EVENT), "no parallel provider introduced");
});
test("11.7 the client-decision route falls back so management is emailed with NO SQL applied", () => {
  assert.ok(/emitEventEmail/.test(REVIEW), "review route can dispatch via the shared helper");
  assert.ok(/reviewContext/.test(REVIEW), "resolves project context from base tables");
  assert.ok(/deliverable_versions\?id=eq\./.test(REVIEW) && /deliverables\?id=eq\./.test(REVIEW), "base-table lookups only");
  assert.ok(/PGRST202/.test(REVIEW), "only when the enqueue RPC is missing");
  assert.ok(/notification\.error = emit\.error \?\? undefined/.test(REVIEW), "no stale RPC error left on a successful fallback");
});
test("11.7 the decision itself is still never affected by any of this", () => {
  const afterSave = REVIEW.slice(REVIEW.indexOf("now SAVED"));
  assert.ok(!/action_saved:\s*false/.test(afterSave), "a saved decision is never reported as failed");
  assert.ok(/try\s*{[\s\S]*catch/.test(afterSave), "all notification work stays inside the guarded block");
});

// ─── (G) ROOT CAUSE #2: projects.name does not exist (42703) ───
// Proven against production: GET /rest/v1/projects?select=name → 42703. The column is
// project_name. Every enqueue function read `name`, so the RPC aborted and ZERO email
// rows were created for a client approval or a preview — upstream of the relay entirely.
test("11.8 no enqueue SQL reads the non-existent projects.name column", () => {
  for (const f of ["docs/project_review_decouple_batch10_RUNME.sql", "docs/event_bound_email_dispatch_batch9g_RUNME.sql"]) {
    const sql = R(f);
    assert.ok(!/select\s+name\s+into\s+v_proj\s+from\s+public\.projects/.test(sql), `${f}: must not select the missing 'name' column`);
    assert.ok(/select\s+project_name\s+into\s+v_proj\s+from\s+public\.projects/.test(sql), `${f}: uses the real column project_name`);
  }
});
test("11.8 the TS fallback also uses project_name (same drift, same fix)", () => {
  assert.ok(/projects\?id=eq\.\$\{encodeURIComponent\(projectId\)\}&select=project_name/.test(REVIEW), "base-table lookup uses the real column");
  assert.ok(!/select=name&limit/.test(REVIEW), "no query for the missing column");
});

// ─── (H) every remaining sender must stop forging success ───
test("11.9 custody and rental senders require the acknowledgment too", () => {
  const CUSTODY = R("lib/server/custodyNotify.ts");
  const RENTAL = R("app/api/integrations/rental/notify/route.ts");
  for (const [name, src] of [["custody", CUSTODY], ["rental", RENTAL]]) {
    assert.ok(/interpretRelayResponse/.test(src), `${name}: reads the relay reply`);
    assert.ok(/relay_handler_missing/.test(src), `${name}: reports the real blocker`);
    // the old forged-success shape must be gone
    assert.ok(!/if \(res\.ok \|\| res\.status === 302\) \{ log\("(custody|rental)_email_success/.test(src), `${name}: no bare-2xx success`);
  }
});

test("11.6 safety: static only (no DB/network/real email)", () => {
  const self = R("tests/relay_handler_batch11.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r), `static (got ${r})`);
});
