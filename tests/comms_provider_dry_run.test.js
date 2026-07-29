// ════════════════════════════════════════════════════════════════════════════
// tests/comms_provider_dry_run.test.js — NOTHING MAY SEND.
//
// This is the file that must fail loudly if anybody ever wires a real send into
// this phase. It EXECUTES the provider (via sucrase, like the import engine
// tests) rather than only reading its text, because "the mock returns ack:false"
// is a behavioural claim and asserting it against source text would prove
// nothing.
//
// It also pins the signature contract and the relay-response classification, so
// the wire format is fixed BEFORE any implementation exists.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { loadTs, TS_AVAILABLE } = require("./import_engine_loader");

const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const PROVIDER_SRC = R("lib/server/commsProvider.ts");
const HUB_SRC = R("lib/server/commsHub.ts");
const RUNME = R("docs/communications_hub_RUNME.sql");
const ROUTE = R("app/api/comms/process/route.ts");
const ADAPTER = R("lib/server/commsLegacyAdapter.ts");

// ─── The hard guarantee, checked structurally (always runs) ─────────────────

test("the provider contains NO network call at all", () => {
  const stripped = PROVIDER_SRC
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .join("\n");
  for (const forbidden of ["fetch(", "XMLHttpRequest", "http.request", "https.request", "axios", "nodemailer"]) {
    assert.ok(!stripped.includes(forbidden), `provider must not contain ${forbidden}`);
  }
  assert.ok(/REAL SEND WOULD GO HERE/.test(PROVIDER_SRC), "the future insertion point is marked, not implemented");
});

test("the hub's drain reaches the provider and nothing else — no direct sender import", () => {
  assert.ok(HUB_SRC.includes('from "@/lib/server/commsProvider"'), "drain uses the provider layer");
  for (const forbidden of ["sendProjectEmail", "sendCustodyEvent", "sendHrEvent", "fetch("]) {
    assert.ok(!HUB_SRC.includes(forbidden), `the hub must not call ${forbidden} directly`);
  }
});

test("channels ship SAFE: email and whatsapp disabled, every channel dry_run", () => {
  const seed = RUNME.slice(RUNME.indexOf("insert into public.comms_channels"), RUNME.indexOf("on conflict (channel) do nothing"));
  assert.ok(/\('email',\s*false,\s*true/.test(seed), "email seeded disabled + dry_run");
  assert.ok(/\('whatsapp',\s*false,\s*true/.test(seed), "whatsapp seeded disabled + dry_run");
  assert.ok(/\('portal',\s*true,\s*true/.test(seed), "portal seeded enabled but still dry_run");
  assert.ok(RUNME.includes("HUB FAIL: email/whatsapp must ship DISABLED"), "self-tested");
  assert.ok(RUNME.includes("HUB FAIL: every channel must ship dry_run = true"), "self-tested");
});

test("the rental queue flag is NOT touched by this phase", () => {
  assert.ok(!/rental_email_queue_enabled/.test(RUNME), "the migration never mentions the rental flag");
  assert.ok(!/rental_email_queue_enabled/.test(HUB_SRC + PROVIDER_SRC + ADAPTER),
    "no TypeScript in this module flips it either");
});

test("the drain route says plainly that nothing sends, and never claims otherwise", () => {
  assert.ok(/sends_anything: false/.test(ROUTE), "the diagnostic is explicit");
  assert.ok(/apps_script_handler_deployed: false/.test(ROUTE), "and honest about the undeployed relay");
  assert.ok(/live_sent_expected: 0/.test(ROUTE), "the POST response states the expectation");
  assert.ok(!/"sent": true|sent: true/.test(ROUTE), "the route never asserts a send");
});

test("the adapter is mutually exclusive: the hub and the legacy sender never both run", () => {
  assert.ok(/if \(hub\.ok && hub\.queued_by_channel\.email > 0\) \{/.test(ADAPTER),
    "hub ownership is decided by evidence (an actual email row), not a guess");
  const i = ADAPTER.indexOf("if (hub.ok && hub.queued_by_channel.email > 0)");
  const j = ADAPTER.indexOf("await emitEventEmail(input)");
  assert.ok(i > -1 && j > i, "the legacy call lives AFTER the early return");
  const between = ADAPTER.slice(i, j);
  assert.ok(/return \{ owner: "hub"/.test(between), "the hub branch returns before the legacy sender is reached");
  assert.ok(/observeInHub/.test(ADAPTER), "a record-only mode exists that calls neither sender");
  const obs = ADAPTER.slice(ADAPTER.indexOf("export async function observeInHub"));
  assert.ok(!obs.includes("emitEventEmail"), "observeInHub can never be half of a double-send");
});

// ─── Behavioural, executed ──────────────────────────────────────────────────

const provider = TS_AVAILABLE ? loadTs("lib/server/commsProvider.ts") : null;
const skip = TS_AVAILABLE ? false : "sucrase unavailable — cannot execute TypeScript here";

const msg = (over = {}) => ({
  id: "11111111-2222-3333-4444-555555555555",
  channel: "email",
  event_key: "deliverable.preview_sent",
  correlation_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  idempotency_key: "deliverable.preview_sent:e1:u1:email",
  recipient_address: "person@example.com",
  recipient_user_id: "u1",
  locale: "ar",
  subject: "عملك جاهز للمعاينة",
  body: "مرحبًا،\nالعمل جاهز.",
  action_url: "/client-portal/projects/1",
  audience_scope: "client",
  dry_run: true,
  ...over,
});

test("mockSend NEVER acknowledges — so the database can never mark a live row as sent", { skip }, () => {
  const r = provider.mockSend(msg());
  assert.strictEqual(r.provider, "mock");
  assert.strictEqual(r.providerResponse.ack, false, "ack MUST be false");
  assert.strictEqual(r.providerResponse.dry_run, true);
  assert.strictEqual(r.providerResponse.simulated, true);
  assert.ok(String(r.providerResponse.note).includes("nothing was transmitted"));
});

test("mockSend masks the recipient — a full address never reaches the response metadata", { skip }, () => {
  const r = provider.mockSend(msg({ recipient_address: "khaled@kianmedia.com" }));
  assert.strictEqual(r.providerResponse.would_send_to, "k***@kianmedia.com");
  assert.ok(!JSON.stringify(r.providerResponse).includes("khaled@"), "the local part is not present");
});

test("deliver() routes whatsapp to a placeholder that defers instead of pretending", { skip }, async () => {
  const r = await provider.deliver(msg({ channel: "whatsapp", recipient_address: null }));
  assert.strictEqual(r.outcome, "channel_deferred");
  assert.strictEqual(r.error, "whatsapp_not_implemented");
  assert.strictEqual(r.providerResponse.ack, false);
});

test("the wire payload is complete, deterministic and carries the idempotency key", { skip }, () => {
  const p = provider.buildRelayPayload(msg());
  assert.strictEqual(p._type, "portal_notify");
  assert.strictEqual(p.contract_version, provider.COMMS_CONTRACT_VERSION);
  assert.strictEqual(p.To, "person@example.com");
  assert.strictEqual(p.IdempotencyKey, "deliverable.preview_sent:e1:u1:email");
  assert.ok(p.Link.startsWith("https://"), "the deep link is absolute");
  assert.ok(p.Link.endsWith("/client-portal/projects/1"));
  // determinism: same input, same output (minus the timestamp, which is absent unsigned)
  assert.deepStrictEqual(provider.buildRelayPayload(msg()), p);
});

test("Arabic and Unicode survive the payload and the byte count is measured in UTF-8", { skip }, () => {
  const arabic = "تم تسليم النسخة النهائية — مشروع «كيان» ✅";
  const p = provider.buildRelayPayload(msg({ subject: arabic, body: arabic + "\nسطر ثانٍ" }));
  assert.strictEqual(p.Subject, arabic, "Arabic subject is untouched");
  assert.ok(p.Body.includes("«كيان»") && p.Body.includes("✅"), "guillemets and emoji survive");
  const r = provider.mockSend(msg({ subject: arabic, body: arabic }));
  const bytes = r.providerResponse.payload_bytes;
  assert.ok(typeof bytes === "number" && bytes > arabic.length,
    "byte length is UTF-8 bytes, not JS string length — Arabic is multi-byte");
});

test("signature: absent without a secret, deterministic with one, and verified constant-time", { skip }, () => {
  const p = provider.buildRelayPayload(msg());
  assert.strictEqual(p.Signature, undefined, "unsigned mode is valid and is the default");

  const prev = process.env.COMMS_RELAY_SIGNING_SECRET;
  process.env.COMMS_RELAY_SIGNING_SECRET = "test-secret-not-a-real-one";
  try {
    const base = { ...provider.buildRelayPayload(msg()) };
    delete base.Signature; delete base.SignedAt;
    const at = "2026-07-30T00:00:00.000Z";
    const s1 = provider.signRelayPayload(base, at);
    const s2 = provider.signRelayPayload(base, at);
    assert.ok(s1 && s2);
    assert.strictEqual(s1.signature, s2.signature, "same input + same timestamp ⇒ same signature");
    assert.ok(provider.verifyRelaySignature(base, s1.signature, at), "verifies");
    assert.ok(!provider.verifyRelaySignature(base, s1.signature, "2026-07-30T00:00:01.000Z"),
      "a different timestamp does not verify (replay window is the relay's job)");
    assert.ok(!provider.verifyRelaySignature({ ...base, To: "someone.else@example.com" }, s1.signature, at),
      "changing the recipient breaks the signature");
    const arabicChanged = { ...base };
    const canon = provider.canonicalSigningString(base, at);
    assert.ok(!canon.includes(base.Body), "the body is hashed into the canonical string, never included verbatim");
    assert.strictEqual(canon.split("\n").length, 8, "the canonical string has exactly the 8 documented fields");
    assert.ok(!provider.verifyRelaySignature({ ...arabicChanged, Subject: "مختلف" }, s1.signature, at),
      "changing the subject breaks the signature");
  } finally {
    if (prev === undefined) delete process.env.COMMS_RELAY_SIGNING_SECRET;
    else process.env.COMMS_RELAY_SIGNING_SECRET = prev;
  }
});

test("relay classification: only a tagged handler reply with sent>0 counts as delivery", { skip }, () => {
  const ok = provider.classifyRelayBody(JSON.stringify({ ok: true, handler: "portal_notify", sent: 1 }));
  assert.strictEqual(ok.outcome, "sent");
  assert.strictEqual(ok.providerResponse.ack, true);

  // the live health banner that fooled the old code
  const banner = provider.classifyRelayBody(JSON.stringify({ ok: true, message: "Kian Media forms API is live" }));
  assert.strictEqual(banner.outcome, "channel_deferred", "a bare ok:true is NOT delivery");
  assert.strictEqual(banner.error, "relay_handler_missing");
  assert.strictEqual(banner.providerResponse.ack, false);

  const html = provider.classifyRelayBody("<!doctype html><html>…</html>");
  assert.strictEqual(html.outcome, "channel_deferred", "an opaque body is NOT delivery");

  const empty = provider.classifyRelayBody("");
  assert.strictEqual(empty.outcome, "channel_deferred", "an empty body is NOT delivery");

  const zero = provider.classifyRelayBody(JSON.stringify({ ok: true, handler: "portal_notify", sent: 0 }));
  assert.strictEqual(zero.outcome, "failed", "the handler ran but mailed nobody ⇒ failure");

  const rejected = provider.classifyRelayBody(JSON.stringify({ ok: false, error: "quota" }));
  assert.strictEqual(rejected.outcome, "failed");
  assert.strictEqual(rejected.providerResponse.ack, false);
});

test("classification reuses the PROVEN classifier rather than reimplementing it", () => {
  assert.ok(/import \{ interpretRelayResponse \} from "@\/lib\/server\/projectNotify"/.test(PROVIDER_SRC),
    "imports lib/server/projectNotify's classifier so the two cannot drift");
});
