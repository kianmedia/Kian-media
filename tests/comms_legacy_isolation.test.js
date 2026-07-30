// ════════════════════════════════════════════════════════════════════════════
// tests/comms_legacy_isolation.test.js — the browser may never reach a mail
// provider, and a public anonymous page may never trigger a relay at all.
//
// This pins the closure of the single most serious finding in
// docs/NOTIFICATIONS_CURRENT_STATE_AUDIT.md §5 (path D5): a no-cors POST fired
// from the browser straight at the Google Apps Script mail relay, including
// from the PUBLIC, ANONYMOUS opportunities page.
//
// Static only. No database, no network, no email — reading files is the whole
// method, exactly like the other comms_* suites.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const NOTIFY = R("lib/portal/notifyEmail.ts");
const ROUTE = R("app/api/comms/legacy-notify/route.ts");
const OPP = R("components/opportunities/OpportunityForm.tsx");
const ADAPTER = R("lib/server/commsLegacyAdapter.ts");
const KILL = R("lib/server/commsKillSwitch.ts");
const PROVIDER = R("lib/server/commsProvider.ts");
const ADMINSTAFF = R("components/portal/AdminStaff.tsx");
const HUBUI = R("components/portal/CommunicationsHub.tsx");
const RUNME = R("docs/communications_hub_RUNME.sql");
const GAS = R("docs/apps_script_portal_notify_HANDLER.gs");

/** Strip line and block comments so an assertion can never be satisfied — or
 *  defeated — by prose. A test that passes because of a comment is not a test. */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
}

const NOTIFY_CODE = code(NOTIFY);
const OPP_CODE = code(OPP);
const ROUTE_CODE = code(ROUTE);

// ─── 1. THE NO-CORS SENDER IS GONE ──────────────────────────────────────────

test("the browser no-cors relay sender is REMOVED, not merely discouraged", () => {
  assert.ok(!/mode\s*:\s*["']no-cors["']/.test(NOTIFY_CODE), "no no-cors request remains in the code");
  assert.ok(!/SHEETS_ENDPOINT/.test(NOTIFY_CODE), "the relay endpoint is not even imported any more");
  assert.ok(!/from\s+["']@\/lib\/submitForm["']/.test(NOTIFY_CODE), "no import of the form relay module");
});

test("no browser module reaches a mail provider directly", () => {
  const browserFiles = [
    "lib/portal/notifyEmail.ts",
    "lib/portal/comms.ts",
    "components/portal/CommunicationsHub.tsx",
    "components/portal/CommsPreferences.tsx",
    "components/opportunities/OpportunityForm.tsx",
    "components/portal/AdminStaff.tsx",
  ];
  for (const f of browserFiles) {
    const src = code(R(f));
    assert.ok(!/script\.google\.com/.test(src), `${f} does not name the relay host`);
    assert.ok(!/mode\s*:\s*["']no-cors["']/.test(src), `${f} makes no opaque cross-origin request`);
    assert.ok(!/SHEETS_ENDPOINT/.test(src), `${f} does not use the relay endpoint`);
    assert.ok(!/_type\s*:\s*["']portal_notify["']/.test(src), `${f} does not build a relay payload`);
  }
});

test("the provider layer is server-only and refuses to load in a browser", () => {
  assert.ok(PROVIDER.includes('throw new Error("lib/server/commsProvider must never be imported in the browser")'),
    "the provider guards against browser import");
  assert.ok(!/fetch\s*\(/.test(code(PROVIDER)), "and still contains no network call at all");
});

// ─── 2. NO PUBLIC ANONYMOUS EMAIL RELAY ─────────────────────────────────────

test("NO PUBLIC ANONYMOUS EMAIL RELAY: the public page imports no notification sender", () => {
  assert.ok(!/notifyEmail/.test(OPP_CODE), "the public opportunities form imports nothing from notifyEmail");
  assert.ok(!/notifyOpportunity(New|Ack)/.test(OPP_CODE), "and calls neither opportunity helper");
  assert.ok(!/fetch\s*\(/.test(OPP_CODE), "and makes no direct fetch of its own");
});

test("the opportunity helpers are refusing stubs — no request under ANY session state", () => {
  const i = NOTIFY_CODE.indexOf("export function notifyOpportunityNew");
  assert.ok(i > -1, "notifyOpportunityNew still exists (removing it would break callers silently)");
  const tail = NOTIFY_CODE.slice(i);
  assert.ok(!/fetch\s*\(/.test(tail), "no fetch after the opportunity helpers begin");
  assert.ok(/return Promise\.resolve\(SERVER_SIDE_ONLY\)/.test(tail), "both return a constant refusal");
  assert.ok(/SERVER_SIDE_ONLY: LegacyNotifyOutcome = \{ ok: false, code: "suppressed_server_side", sent: false \}/.test(NOTIFY_CODE),
    "and that refusal carries an honest, specific code");
  assert.ok(NOTIFY_CODE.includes("export function notifyOpportunityAck"), "the ack helper exists too");
});

test("the server route has NO anonymous door", () => {
  assert.ok(/if\s*\(!token\)/.test(ROUTE_CODE), "a missing Bearer token is rejected outright");
  assert.ok(/not_authenticated/.test(ROUTE_CODE) && /status:\s*401/.test(ROUTE_CODE), "with 401");
  assert.ok(/authGetUserId/.test(ROUTE_CODE), "the token is resolved to a real user");
  assert.ok(!/CRON_SECRET/.test(ROUTE_CODE), "no shared-secret bypass door on a UI route");
  assert.ok(/ANONYMOUS_ORIGIN_EVENTS/.test(ROUTE_CODE) && /event_not_relayable_from_browser/.test(ROUTE_CODE),
    "the two anonymous-origin events are refused by name");
});

test("the browser without a session makes no request at all", () => {
  const i = NOTIFY_CODE.indexOf("async function postNotify");
  assert.ok(i > -1, "the sender helper exists");
  const body = NOTIFY_CODE.slice(i, NOTIFY_CODE.indexOf("\n}", i));
  const guard = body.indexOf("suppressed_anonymous");
  const call = body.indexOf("fetch(");
  assert.ok(guard > -1 && call > -1 && guard < call,
    "the no-session guard returns BEFORE any fetch is issued");
});

// ─── 3. AUTHORIZATION IS RE-CHECKED IN THE DATABASE ─────────────────────────

test("the route re-authorizes in the database, as the user — a session is not enough", () => {
  assert.ok(/rpcAsUser<boolean>\("comms_is_staff"/.test(ROUTE_CODE), "comms_is_staff, run as the caller");
  assert.ok(/staff\.data !== true/.test(ROUTE_CODE) && /not_authorized/.test(ROUTE_CODE), "non-staff is refused");
  assert.ok(!/rpcAsService\(/.test(ROUTE_CODE), "the route never escalates to the service role to decide access");
});

test("a missing migration is reported as a missing migration, never as a permission problem", () => {
  assert.ok(/hubNotInstalled\(err\)/.test(ROUTE_CODE), "the PostgREST 'function missing' answer is classified");
  const i = ROUTE_CODE.indexOf("hubNotInstalled(err)");
  const seg = ROUTE_CODE.slice(i, ROUTE_CODE.indexOf("}, { status: 200 });", i));
  assert.ok(/HUB_NOT_INSTALLED/.test(seg), "and mapped to its own code");
  assert.ok(/بانتظار تفعيل قاعدة البيانات/.test(seg), "with the Arabic waiting notice");
  assert.ok(!/not_authorized/.test(seg), "and never collapsed into an authorization error");
  // The two states are also physically different codes with different HTTP status.
  assert.ok(/code: "not_authorized", sent: false,[\s\S]{0,200}status: 403/.test(ROUTE_CODE),
    "an authorization failure is a 403, not a migration notice");
});

// ─── 4. THE BROWSER CANNOT CHOOSE A RECIPIENT ───────────────────────────────

test("a caller-supplied recipient is discarded, not honoured", () => {
  assert.ok(/legacy_to_discarded/.test(ROUTE_CODE), "the discard is recorded on the row");
  assert.ok(/const droppedTo = clean\(body\.to/.test(ROUTE_CODE), "the field is read only for the audit trail");
  const enqueue = ROUTE_CODE.slice(ROUTE_CODE.indexOf("await observeInHub"));
  assert.ok(!/recipient/.test(enqueue.slice(0, 600)), "no recipient is passed into the enqueue call");
});

test("payload.direct — the resolver's open door — can never be set from a browser", () => {
  assert.ok(!/body\.direct|payload\.direct|direct:/.test(ROUTE_CODE),
    "the route never reads or forwards a direct[] array");
  // And the vars handed to the template are a closed, named set.
  assert.ok(/const vars = \{/.test(ROUTE_CODE), "template variables are constructed explicitly");
  for (const k of ["project_name", "entity_label", "actor_name", "details"]) {
    assert.ok(new RegExp(`${k}: clean\\(`).test(ROUTE_CODE), `${k} is sanitized`);
  }
  assert.ok(!/\.\.\.body/.test(ROUTE_CODE), "the request body is never spread into the payload");
});

test("legacy events are a CLOSED vocabulary, and every key exists in the catalogue", () => {
  assert.ok(/const LEGACY_EVENT_MAP: Record<string, \{ hub: string; entity: string \}>/.test(ROUTE),
    "the map is explicit");
  assert.ok(/unknown_legacy_event/.test(ROUTE_CODE), "anything else is refused");
  const keys = ["deliverable.preview_sent", "deliverable.final_ready", "project.member_assigned",
                "project.assignment_note", "deliverable.client_commented"];
  for (const k of keys) {
    assert.ok(ROUTE_CODE.includes(k), `${k} is mapped`);
    assert.ok(RUNME.includes(`'${k}'`), `${k} is seeded in the event catalogue`);
  }
  assert.ok(/legacy-adapter event % is missing from the catalogue/.test(RUNME),
    "and the migration self-test fails loudly if one is dropped");
});

test("assignment events stay internal — a private note to staff is not client-facing", () => {
  assert.ok(/assignment events must stay internal-only/.test(RUNME), "the migration asserts it");
  const line = RUNME.split("\n").find((l) => l.includes("'project.assignment_note'") && l.includes("array["));
  assert.ok(line, "the catalogue row exists");
  assert.ok(/'internal'/.test(line), "and its audience is internal");
  assert.ok(/false,\s*false/.test(line) || /,\s*false,/.test(line), "and it is not financial");
});

test("the idempotency entity is never null for a repeatable event", () => {
  // The SQL key is event + entity + user + channel. A null entity collapses two
  // genuinely different events into one key, and the second is dropped as a
  // "duplicate" — a silent loss that looks exactly like working deduplication.
  assert.ok(/const effectiveEntityId = entityId \|\| \(mapped\.entity === "project" \? projectId : ""\)/.test(ROUTE_CODE),
    "a project-scoped event falls back to the project id");
  assert.ok(/entity_id: effectiveEntityId \|\| null/.test(ROUTE_CODE), "and that value is what is enqueued");
  const N = code(NOTIFY);
  assert.ok(/noteId\?: string \| null;/.test(N), "an assignment note can carry its own id");
  assert.ok(/entity_id: input\.noteId \?\? null/.test(N), "and passes it as the entity");
  assert.ok(/deliverableId\?: string \| null;/.test(N), "deliverable events can carry the deliverable id");
  assert.ok((N.match(/entity_id: input\.deliverableId \?\? null/g) || []).length >= 3,
    "on preview, final and review-update alike");
  assert.ok(/noteId: r\.data \?\? null/.test(code(ADMINSTAFF)), "and the caller actually supplies it");
});

// ─── 5. NOTHING SENDS, AND NOTHING CLAIMS TO ────────────────────────────────

test("the route contacts no provider and never reports a send", () => {
  assert.ok(!/script\.google\.com/.test(ROUTE_CODE), "no relay host");
  assert.ok(!/SHEETS_ENDPOINT|PORTAL_NOTIFY_ENDPOINT/.test(ROUTE_CODE), "no relay endpoint");
  assert.ok(/sent: false/.test(ROUTE_CODE), "every answer carries sent:false");
  assert.ok(!/sent: true/.test(ROUTE_CODE), "and none carries sent:true");
});

test("provider-unavailable honesty: asking for a real relay does not fake one", () => {
  assert.ok(/COMMS_LEGACY_RELAY_ENABLED/.test(ROUTE_CODE), "the flag is read");
  assert.ok(/provider_unavailable/.test(ROUTE_CODE), "and answers provider_unavailable, not success");
  assert.ok(/dry_run_completed/.test(ROUTE_CODE), "the normal answer is an explicit dry-run state");
  assert.ok(/APPS_SCRIPT_DEPLOYMENT_GUIDE/.test(ROUTE), "and points at the deployment guide");
});

test("the client-side outcome type cannot express a delivery", () => {
  assert.ok(/sent: false;/.test(NOTIFY_CODE), "LegacyNotifyOutcome.sent is the literal type false");
  for (const c of ["dry_run_completed", "provider_unavailable", "relay_handler_missing",
                   "hub_not_installed", "suppressed_anonymous", "suppressed_server_side"]) {
    assert.ok(NOTIFY_CODE.includes(`"${c}"`), `the honest state ${c} exists`);
  }
  assert.ok(!/"sent"/.test(NOTIFY_CODE.slice(NOTIFY_CODE.indexOf("LegacyNotifyCode"),
                                             NOTIFY_CODE.indexOf("LegacyNotifyOutcome"))),
    "'sent' is not one of the outcome codes");
});

// ─── 6. THE REQUIRED DRY-RUN SENTENCE ───────────────────────────────────────

test("every send surface carries «وضع تجريبي — لن يتم إرسال رسالة حقيقية»", () => {
  const SENTENCE = "وضع تجريبي — لن يتم إرسال رسالة حقيقية";
  assert.ok(NOTIFY.includes(`COMMS_DRY_RUN_NOTICE_AR = "${SENTENCE}"`), "defined once, in one place");
  assert.ok(ROUTE.includes(SENTENCE), "the server answer says it");
  assert.ok(HUBUI.includes("COMMS_DRY_RUN_NOTICE_AR"), "the hub dashboard shows it");
  assert.ok(ADMINSTAFF.includes("COMMS_DRY_RUN_NOTICE_AR"), "the assignment screen shows it");
  // Two places in the hub: the header, and beside the retry/cancel actions.
  const hits = HUBUI.split("COMMS_DRY_RUN_NOTICE_AR").length - 1;
  assert.ok(hits >= 3, `the hub renders it beside its actions (found ${hits} references)`);
});

test("no surface claims a staff member was notified when nothing was sent", () => {
  const src = code(ADMINSTAFF);
  assert.ok(!/staff notified/i.test(src), "the forged 'staff notified' claim is gone");
  assert.ok(!/سيصل إشعار للموظف/.test(src), "and its Arabic twin is gone");
  assert.ok(/const n = await notifyStaffAssigned/.test(ADMINSTAFF), "the real outcome is awaited");
  assert.ok(/n\.ok \? COMMS_DRY_RUN_NOTICE_AR/.test(ADMINSTAFF), "and reported honestly");
});

// ─── 7. MUTUAL EXCLUSION — ONE EVENT, ONE PIPELINE ──────────────────────────

test("the route uses the RECORD-ONLY adapter, so it can never be half of a double-send", () => {
  assert.ok(/observeInHub/.test(ROUTE_CODE), "record-only entry point");
  assert.ok(!/notifyViaHubOrLegacy/.test(ROUTE_CODE), "it does not also run the legacy sender");
  assert.ok(!/emitEventEmail/.test(ROUTE_CODE), "nor call the legacy emitter directly");
  const i = ADAPTER.indexOf("export async function observeInHub");
  const body = ADAPTER.slice(i);
  assert.ok(!/emitEventEmail/.test(body), "observeInHub itself never calls the legacy sender");
});

test("one kill switch stops every legacy sender, and can only ever turn them OFF", () => {
  assert.ok(/COMMS_LEGACY_SENDERS_ENABLED/.test(KILL), "the switch exists");
  assert.ok(/!== "false"/.test(KILL), "unset keeps today's behaviour");
  for (const f of ["lib/server/projectNotify.ts", "lib/server/custodyNotify.ts", "lib/server/hrNotify.ts"]) {
    const src = code(R(f));
    assert.ok(/legacySendersEnabled\(\)/.test(src), `${f} consults the kill switch`);
    assert.ok(/if \(!legacySendersEnabled\(\)\) return false;/.test(src),
      `${f} uses it one-way: it can disable, never enable`);
  }
});

test("the rental queue flag is still not touched by this phase", () => {
  assert.ok(!/rental_email_queue_enabled/.test(ROUTE), "the route does not mention it");
  assert.ok(!/rental_email_queue_enabled/.test(RUNME), "and neither does the migration");
});

// ─── 8. THE APPS SCRIPT CONTRACT (written, NOT deployed) ────────────────────

test("the handler is paste-ready and this repository does not deploy it", () => {
  assert.ok(/function kianHandlePortalNotify_/.test(GAS), "the handler function exists");
  assert.ok(/portal_notify/.test(GAS), "it branches on the portal_notify type");
  assert.ok(/handler: "portal_notify"/.test(GAS), "and tags its reply so delivery can be proven");
  // Nothing in the repo may push this file anywhere.
  const files = fs.readdirSync(path.join(root, "app/api"), { recursive: true }).join(" ");
  assert.ok(!/clasp|apps_script_deploy/.test(files), "no deployment route exists");
});

test("the signature contract matches the server, byte for byte, with NO real secret", () => {
  // Same fields, same order, as canonicalSigningString() in commsProvider.ts.
  const order = ["contract_version", "_type", "Event", "To", "IdempotencyKey", "CorrelationId"];
  const i = GAS.indexOf("function kianCanonicalString_");
  const canon = GAS.slice(i, GAS.indexOf("}", GAS.indexOf("join(\"\\n\")", i)));
  let at = -1;
  for (const f of order) {
    const next = canon.indexOf(f, at + 1);
    assert.ok(next > at, `${f} appears in the canonical string, in order`);
    at = next;
  }
  assert.ok(/kian\.body/.test(GAS) && /kian\.body/.test(PROVIDER), "both sides hash the body with the same fixed key");
  assert.ok(/PropertiesService/.test(GAS), "the secret comes from Script Properties");
  assert.ok(!/KIAN_PORTAL_NOTIFY_SECRET\s*=\s*["'][^"']+["']/.test(GAS), "and is NOT written in the file");
  assert.ok(/COMMS_RELAY_SIGNING_SECRET/.test(GAS), "the guide names the matching server variable");
});

test("the handler resists replay, deduplicates, and never double-sends on a retry", () => {
  assert.ok(/signature_expired/.test(GAS), "a stale SignedAt is refused");
  assert.ok(/KIAN_PORTAL_SIGNATURE_WINDOW_MS/.test(GAS), "with an explicit window");
  assert.ok(/bad_signature/.test(GAS), "a wrong signature is refused");
  assert.ok(/kianSafeEquals_/.test(GAS), "compared in constant time");
  assert.ok(/CacheService/.test(GAS) && /duplicate = true|duplicate: true|replay\.duplicate/.test(GAS),
    "a repeated IdempotencyKey replays the earlier acknowledgment");
  const i = GAS.indexOf("var prior = cache.get(cacheKey)");
  const seg = GAS.slice(i, i + 600);
  assert.ok(/return replay;/.test(seg), "and returns BEFORE any MailApp.sendEmail call");
  assert.ok(!/MailApp\.sendEmail/.test(seg), "no send happens on the duplicate path");
});

test("the handler refuses to claim a send it did not make", () => {
  assert.ok(/if \(result\.sent === 0\) result\.ok = false;/.test(GAS),
    "zero recipients mailed is reported as a failure, not a success");
  assert.ok(/no_valid_recipients/.test(GAS), "an empty recipient list is named");
  const i = GAS.indexOf("if (cache && cacheKey && result.sent > 0)");
  assert.ok(i > -1, "only a genuine send is remembered as a completed delivery");
});

// ─── 9. SAFE STATIC SUITE ───────────────────────────────────────────────────

test("SAFE: this suite reads files only — no DB, no network, no email", () => {
  const self = R("tests/comms_legacy_isolation.test.js");
  const requires = (self.match(/require\(["'][^"']+["']\)/g) || []).sort();
  assert.deepStrictEqual(
    Array.from(new Set(requires)),
    ['require("node:assert")', 'require("node:fs")', 'require("node:path")', 'require("node:test")'],
    "the only modules this suite loads are test, assert, fs and path",
  );
});
