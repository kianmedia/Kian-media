// ════════════════════════════════════════════════════════════════════════════
// tests/pwa_push_contract.test.js — PUSH: FOUNDATION ONLY — DISABLED.
//
// Push is the one PWA capability that turns a page into a background actor with
// a permanent receiver on someone's phone. Nothing in V1 requests it, subscribes
// to it, or sends it. This test exists so enabling it later is a deliberate act
// with a failing test to answer to, not a quiet side effect of a refactor.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, R, loadServiceWorker, tsConst } = require("./pwa_helpers");

const SW = R("public/sw.js");
const CONFIG = R("lib/pwa/config.ts");
const DOC = R("docs/PWA_PUSH_CONTRACT.md");
const { listeners } = loadServiceWorker();

test("the status is declared, in the contract and in the code", () => {
  assert.ok(/FOUNDATION ONLY — DISABLED/.test(DOC), "the doc states the status verbatim");
  assert.equal(tsConst(CONFIG, "PUSH_STATUS"), "FOUNDATION ONLY — DISABLED", "and so does the code");
  assert.ok(/export const PUSH_ENABLED = false/.test(CONFIG), "with a machine-checkable flag");
  assert.ok(/FOUNDATION ONLY — DISABLED/.test(SW), "the worker says so at the top too");
});

test("the worker has no push receiver of any kind", () => {
  for (const banned of [
    'addEventListener("push"',
    'addEventListener("pushsubscriptionchange"',
    "showNotification",
    "pushManager",
    "applicationServerKey",
    "getSubscription",
  ]) {
    assert.ok(!SW.includes(banned), `public/sw.js must not contain ${banned}`);
  }
  assert.ok(!listeners.push, "no push listener is registered at runtime");
  assert.ok(!listeners.pushsubscriptionchange, "no pushsubscriptionchange listener either");
});

test("the absence is documented AT the site, so it reads as a decision not an omission", () => {
  assert.ok(/DELIBERATELY ABSENT/.test(SW), "the worker names what is missing and why");
  assert.ok(/PWA_PUSH_CONTRACT\.md/.test(SW), "and points at the contract");
});

/** Scan app/ components/ lib/ for literal tokens. Returns "file → token" hits. */
function scanRepo(tokens) {
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      const src = fs.readFileSync(p, "utf8");
      for (const t of tokens) if (src.includes(t)) hits.push(`${path.relative(ROOT, p)} → ${t}`);
    }
  };
  for (const r of ["app", "components", "lib"]) walk(path.join(ROOT, r));
  return hits;
}

test("no Web Push API is reachable from anywhere in the app", () => {
  // No exemptions on this list. Every one of these tokens exists for exactly
  // one purpose — obtaining or maintaining a push subscription — so a single
  // occurrence anywhere means push is no longer disabled.
  const hits = scanRepo([
    "pushManager", "applicationServerKey", "PushSubscription", "pushsubscriptionchange",
  ]);
  assert.deepEqual(hits, [], "push must have no call site anywhere:\n  " + hits.join("\n  "));
});

// ─── The one exemption, named and self-policing ─────────────────────────────
// The Notifications API and Web Push are NOT the same capability. The WhatsApp
// inbox has shipped a LOCAL desktop alert since before this phase: the open tab
// already received the message over its own live connection and draws a
// notification for it. Nothing is subscribed, no server key exists, and it
// cannot fire while the tab is closed — so it is not a background actor and not
// in this phase's scope. Deleting a working feature to make a grep come out
// clean would be the dishonest fix. It is therefore exempted BY NAME, and the
// exemption pays for itself: the test below re-proves, on every run, that the
// call site is still click-driven and still push-free.
const LOCAL_ALERT_EXEMPTION = "components/whatsapp/WhatsAppInbox.tsx";

test("nothing except the one named local-alert toggle requests notification permission", () => {
  const hits = scanRepo(["Notification.requestPermission"])
    .filter((h) => !h.startsWith(LOCAL_ALERT_EXEMPTION));
  assert.deepEqual(hits, [],
    "only " + LOCAL_ALERT_EXEMPTION + " may request this permission:\n  " + hits.join("\n  "));
  // The PWA layer itself must be clean even of the exempted call.
  assert.deepEqual(
    scanRepo(["Notification.requestPermission"]).filter((h) => h.includes("/pwa/")), [],
    "the PWA layer requests no permission of any kind"
  );
});

test("the exempted local alert is user-driven, permission-gated, and has no push surface", () => {
  const src = R(LOCAL_ALERT_EXEMPTION);
  const toggle = src.slice(src.indexOf("function toggleAlerts()"), src.indexOf("function toggleAlerts()") + 500);
  assert.ok(toggle.length > 0, "the toggle still exists");
  assert.ok(/Notification\.requestPermission/.test(toggle),
    "the request lives inside the toggle — if it moves, this exemption stops applying");
  assert.ok(/Notification\.permission === "default"/.test(toggle),
    "and only fires when the user has not already answered, so it can never re-prompt");
  assert.ok(/onClick=\{toggleAlerts\}/.test(src), "the toggle is bound to a click");
  assert.equal((src.match(/Notification\.requestPermission/g) || []).length, 1,
    "there is exactly one request site in the file");
  // Proving "not in an effect" by proximity is unreliable — an unrelated effect
  // sitting just above the toggle satisfies any windowed regex. Prove it by
  // reachability instead: the toggle is referenced exactly twice, its own
  // declaration and the click binding, and is never invoked programmatically.
  assert.equal((src.match(/toggleAlerts/g) || []).length, 2,
    "toggleAlerts is referenced only by its declaration and its onClick binding");
  assert.ok(!/toggleAlerts\(\)/.test(src.replace("function toggleAlerts()", "")),
    "it is never called from an effect or any other code path — an automatic prompt is what this phase forbids");
  for (const banned of ["pushManager", "applicationServerKey", "PushSubscription"]) {
    assert.ok(!src.includes(banned), `the exempted file must never grow a push surface (${banned})`);
  }
});

test("no VAPID key is present in the repo or advertised in the env template", () => {
  const env = R(".env.example");
  assert.ok(!/VAPID/i.test(env), ".env.example must not advertise a VAPID key while push is disabled");
  assert.ok(!/VAPID/i.test(SW) && !/VAPID/i.test(CONFIG), "no VAPID material in the shipped code");
});

test("the contract states the conditions under which push may later be enabled", () => {
  for (const [what, re] of [
    ["a content rule (no sensitive detail on a lock screen)", /شاشة القفل|عقد محتوى/],
    ["subscription tied to identity and cleared on logout/switch", /تسجيل الخروج/],
    ["permission requested only on an explicit user action", /بضغطة/],
    ["a single kill switch", /مفتاح إيقاف/],
    ["composition with the existing notification layer, not a second channel", /التأليف لا التوازي|قناة/],
    ["a full SQL package with RLS", /PREFLIGHT \/ RUNME \/ POSTCHECK \/ ROLLBACK|RLS/],
  ]) {
    assert.ok(re.test(DOC), `the contract must state: ${what}`);
  }
});

test("this phase ships no SQL package — and does not fake an empty one", () => {
  const doc = R("docs/PWA_V1_CONTRACT.md");
  assert.ok(/CODE-ONLY/.test(doc), "the contract says the phase is code-only");
  for (const suffix of ["PREFLIGHT", "RUNME", "POSTCHECK", "ROLLBACK"]) {
    const p = path.join(ROOT, "docs", `pwa_v1_${suffix}.sql`);
    assert.ok(!fs.existsSync(p), `docs/pwa_v1_${suffix}.sql must not exist — an empty package is a lie about scope`);
  }
});
