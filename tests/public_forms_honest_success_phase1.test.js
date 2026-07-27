// ════════════════════════════════════════════════════════════════════════════
// tests/public_forms_honest_success_phase1.test.js — P1.6 · FALSE SUCCESS
//
// submitToSheets posts with mode:"no-cors", so the response is opaque BY
// CONSTRUCTION — the browser cannot read the status — and it hard-returns {ok:true}
// as long as the request did not throw. All three public forms then set their success
// state unconditionally and showed a client-minted reference number.
//
// A durable mirror did exist (captureIntake -> /api/public/intake -> capture_public_intake)
// but it returned Promise<void>, never read the body, and swallowed every error. And the
// route answers HTTP 200 on EVERY outcome by design, so res.ok discriminates nothing —
// only the parsed body does.
//
// Worst case before this: captureIntake returns early when the email lacks "@", and email
// was OPTIONAL on /book-meeting and /upload-files. An emailless submission that Apps
// Script dropped left ZERO record anywhere while the visitor held a confident reference.
//
// Note the deliberate design choice pinned below: a failed mirror must NOT read as a hard
// failure. The Apps Script leg may well have succeeded — we simply cannot know — so the
// copy says "we could not confirm" and routes the visitor to WhatsApp, keeping their
// reference. Turning an unknown into a red error would be a different kind of lie.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SUBMIT = R("lib/submitForm.ts");
const CARD = R("components/forms/SuccessCard.tsx");
const PAGES = {
  "quote-request": R("app/quote-request/page.tsx"),
  "book-meeting": R("app/book-meeting/page.tsx"),
  "upload-files": R("app/upload-files/page.tsx"),
};
const strip = (s) => s.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");

// ─── (A) the mirror reports its outcome ─────────────────────────────────────

test("P1.6 captureIntake no longer returns void", () => {
  assert.ok(
    !/export async function captureIntake\([^)]*\): Promise<void>/.test(SUBMIT),
    "a void return is why every caller had to assume success",
  );
  assert.match(SUBMIT, /export async function captureIntake\([^)]*\): Promise<IntakeResult>/);
  assert.match(SUBMIT, /export interface IntakeResult \{ ok: boolean/);
});

test("P1.6 it reads the body, because the status is meaningless here", () => {
  const fn = SUBMIT.slice(SUBMIT.indexOf("export async function captureIntake"));
  assert.match(fn, /await res\.json\(\)/, "the route returns 200 on every outcome; only the body discriminates");
  assert.match(fn, /data\.ok === true/, "success must be the server's ok flag, not the HTTP status");
  // Strip comments first: the code's own comment explains why the status is useless, and
  // would otherwise satisfy a search for it and fail a test that is actually passing.
  const body = strip(fn.slice(0, fn.indexOf("catch")));
  assert.ok(!/\bres\.ok\b/.test(body), "branching on the HTTP status would always be true and prove nothing");
});

test("P1.6 it still never throws into the form", () => {
  const fn = SUBMIT.slice(SUBMIT.indexOf("export async function captureIntake"));
  assert.match(fn, /catch \{\s*\n?\s*return \{ ok: false, error: "network" \}/,
    "a mirror failure must degrade to a reported outcome, never an exception in the submit handler");
});

test("P1.6 the Apps Script contract is untouched", () => {
  assert.match(SUBMIT, /mode: "no-cors"/, "the sheets POST must keep working exactly as before");
  assert.match(SUBMIT, /_type: type/, "and keep its payload shape — the email contract is frozen");
});

// ─── (B) all three forms gate on the real outcome ───────────────────────────

for (const [name, src] of Object.entries(PAGES)) {
  test(`P1.6 ${name} gates its success card on the mirror result`, () => {
    const code = strip(src);
    assert.match(code, /const mirror = await captureIntake\(/, "the result must be captured, not discarded");
    assert.match(code, /setConfirmed\(mirror\.ok\)/, "and drive the confirmed flag");
    assert.match(code, /<SuccessCard reference=\{reference\} confirmed=\{confirmed\} \/>/);
  });
}

test("P1.6 quote-request no longer fires the mirror and forgets it", () => {
  assert.ok(
    !/void captureIntake\(/.test(PAGES["quote-request"]),
    "`void` discarded the promise entirely, so the outcome could never be known",
  );
});

// ─── (C) email required — what makes the gate meaningful ────────────────────

for (const name of ["book-meeting", "upload-files"]) {
  test(`P1.6 ${name} now requires a valid email`, () => {
    const code = strip(PAGES[name]);
    assert.match(code, /if \(!f\["Email"\] \|\| !isValidEmail\(f\["Email"\]\)\)/,
      "the mirror is email-keyed, so without one a submission leaves no record at all");
    assert.match(code, /htmlFor="em" required/, "and the field must be marked required in the UI");
  });
}

test("P1.6 upload-files no longer treats email as optional-if-present", () => {
  assert.ok(
    !/if \(f\["Email"\] && !isValidEmail/.test(PAGES["upload-files"]),
    "the old guard validated the email only when supplied, allowing an unmirrorable submission",
  );
});

// ─── (D) an unconfirmed result is honest, not alarming ──────────────────────

test("P1.6 SuccessCard distinguishes recorded from unconfirmed", () => {
  assert.match(CARD, /confirmed = true \}: \{ reference: string; confirmed\?: boolean \}/,
    "defaulting to true keeps any caller that has not been updated behaving as before");
});

test("P1.6 an unconfirmed submission is not presented as a failure", () => {
  const i = CARD.indexOf("confirmed\n          ? t(");
  const block = i > 0 ? CARD.slice(i, i + 900) : CARD;
  assert.match(block, /لم نتمكّن من تأكيد|could not confirm/,
    "the honest statement is that we do not know — the Apps Script leg may well have succeeded");
  assert.ok(!/فشل|failed|error/i.test(block), "claiming failure would be a different lie");
});

test("P1.6 the unconfirmed path keeps the reference and offers a working route", () => {
  assert.match(CARD, /\{reference\}/, "the visitor must keep their reference either way");
  assert.match(CARD, /wa\.me/, "and be given a channel that definitely reaches us");
});

// ─── (E) nothing else regressed ─────────────────────────────────────────────

test("P1.6 the intake route still answers 200 on every outcome", () => {
  const route = R("app/api/public/intake/route.ts");
  const statuses = [...route.matchAll(/\{ status: (\d{3}) \}/g)].map((m) => m[1]);
  assert.ok(statuses.every((s) => s === "200" || s === "400"),
    `a public form must not surface technical errors; found statuses ${statuses.join(",")}`);
  assert.match(route, /ok: true, id: r\.data/, "and must return the id the card can show");
});

test("P1.6 rate limiting still degrades to a reassuring message, not a scary one", () => {
  assert.match(R("components/opportunities/OpportunityForm.tsx"), /rate limited/i,
    "the sibling form's reassuring copy is the pattern an honest gate must not undo");
});
