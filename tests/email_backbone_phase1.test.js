// ════════════════════════════════════════════════════════════════════════════
// tests/email_backbone_phase1.test.js — P1.1 · QUEUE-INJECTION HOLE
//
// The defect this pins, confirmed live on production before the fix:
//   docs/review_thread_email_RUNME.sql:40 granted EXECUTE on nt_enqueue_email to
//   `authenticated`. That function is SECURITY DEFINER and takes recipient,
//   subject and body as fully caller-controlled parameters, inserting them
//   straight into the email_deliveries send queue. Portal signup is open, so ANY
//   account could (a) send arbitrary mail from Kian Media's own identity — a
//   ready-made phishing relay carrying the company's name — and (b) exhaust the
//   ~100/day Gmail ceiling and black out every portal notification.
//
//   Live probe before the fix: anon → 42501 (correctly revoked), but the grant to
//   `authenticated` was present in the applied SQL.
//
// It also pins the two traps that make the obvious fix wrong:
//   • 42725 `function is not unique` — adding a 5th DEFAULT parameter to the
//     existing 4-arg function leaves both signatures resolvable and breaks all 7
//     existing producers. The new helper therefore has a DISTINCT NAME and NO
//     defaults.
//   • 42P10 — uq_edel_idem is a PARTIAL unique index, so ON CONFLICT must restate
//     `where idempotency_key is not null` or Postgres cannot infer the index.
//
// String-pin style, matching tests/relay_handler_batch11.test.js. No DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/email_backbone_phase1_enqueue_RUNME.sql");
const LEGACY = R("docs/review_thread_email_RUNME.sql");

// strip SQL comments so a pin can never be satisfied by prose that merely
// discusses the thing it is asserting. This suite's own header would otherwise
// match several of the patterns below.
const code = SQL
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

// ─── (A) the hole is real and this file is what closes it ───

test("P1.1 the legacy file really did grant the queue helper to authenticated", () => {
  assert.match(
    LEGACY,
    /grant\s+execute\s+on\s+function\s+public\.nt_enqueue_email\(text,text,text,text\)\s+to\s+authenticated/i,
    "the vulnerable grant must still be visible in the legacy file — this is the thing being revoked",
  );
});

test("P1.1 revokes EXECUTE from authenticated on the legacy 4-arg signature", () => {
  assert.match(
    code,
    /revoke\s+all\s+on\s+function\s+public\.nt_enqueue_email\(text,text,text,text\)\s+from[^;]*authenticated/i,
    "authenticated must lose EXECUTE on the caller-controlled enqueue helper",
  );
});

test("P1.1 the new helper is never exposed to anon or authenticated", () => {
  assert.match(
    code,
    /revoke\s+all\s+on\s+function\s+public\.nt_enqueue_email_idem\([^)]*\)\s+from[^;]*public[^;]*authenticated/i,
    "PostgreSQL grants EXECUTE to PUBLIC by default on a new function, so it must be revoked explicitly",
  );
});

test("P1.1 the legitimate caller keeps working", () => {
  assert.match(code, /grant\s+execute\s+on\s+function\s+public\.nt_enqueue_email\(text,text,text,text\)\s+to\s+service_role/i);
  assert.match(code, /grant\s+execute\s+on\s+function\s+public\.nt_enqueue_email_idem\([^)]*\)\s+to\s+service_role/i);
});

// ─── (B) the 42725 trap: no default parameters, distinct name ───

test("P1.1 the new helper declares NO default parameter (42725 regression guard)", () => {
  const sig = code.match(/create\s+or\s+replace\s+function\s+public\.nt_enqueue_email_idem\s*\(([\s\S]*?)\)\s*returns/i);
  assert.ok(sig, "nt_enqueue_email_idem must be defined in this file");
  assert.ok(
    !/\bdefault\b/i.test(sig[1]),
    "a DEFAULT here would make the 4-arg and 6-arg forms both resolvable → 42725 function is not unique, " +
      "breaking all 7 existing producers",
  );
});

test("P1.1 the original 4-arg signature is preserved, not replaced", () => {
  assert.match(
    code,
    /create\s+or\s+replace\s+function\s+public\.nt_enqueue_email\s*\(\s*p_email\s+text\s*,\s*p_subject\s+text\s*,\s*p_body\s+text\s*,\s*p_url\s+text\s*\)/i,
    "the 7 existing SQL producers call the 4-arg form and must keep compiling untouched",
  );
  assert.ok(!/\bdrop\s+function\b/i.test(code), "DROP is forbidden by the owner constraints");
});

test("P1.1 the legacy function delegates rather than holding a second INSERT", () => {
  const wrapper = code.match(
    /create\s+or\s+replace\s+function\s+public\.nt_enqueue_email\s*\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/i,
  );
  assert.ok(wrapper, "the 4-arg wrapper body must be present");
  assert.match(wrapper[1], /perform\s+public\.nt_enqueue_email_idem/i, "it must delegate");
  assert.ok(
    !/insert\s+into\s+public\.email_deliveries/i.test(wrapper[1]),
    "there must be exactly ONE insert site for this path",
  );
});

// ─── (C) the 42P10 trap: partial index inference ───

test("P1.1 ON CONFLICT restates the partial index predicate (42P10 guard)", () => {
  assert.match(
    code,
    /on\s+conflict\s*\(\s*idempotency_key\s*\)\s*where\s+idempotency_key\s+is\s+not\s+null\s+do\s+nothing/i,
    "uq_edel_idem is PARTIAL; omitting the predicate raises 42P10 at runtime",
  );
});

test("P1.1 an empty idempotency key is stored as NULL, not as an empty string", () => {
  // '' would be a real value and would collide across unrelated events on the
  // unique index, silently suppressing every second email.
  assert.match(code, /nullif\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*p_idem/i);
});

// ─── (D) safety envelope ───

test("P1.1 is additive and idempotent", () => {
  assert.match(code, /add\s+column\s+if\s+not\s+exists\s+idempotency_key/i);
  assert.match(code, /create\s+unique\s+index\s+if\s+not\s+exists\s+uq_edel_idem/i);
  assert.ok(!/\bdrop\s+(table|column|index|constraint)\b/i.test(code), "no destructive DDL");
  assert.ok(!/\bdelete\s+from\b/i.test(code), "no data deletion");
  assert.ok(!/\btruncate\b/i.test(code), "no truncate");
});

test("P1.1 both functions pin search_path (SECURITY DEFINER hygiene)", () => {
  const defs = code.match(/security\s+definer\s+set\s+search_path\s*=\s*public/gi) ?? [];
  assert.ok(defs.length >= 2, `both functions must pin search_path; found ${defs.length}`);
});

test("P1.1 email failure can never fail the originating transaction", () => {
  assert.match(code, /exception\s+when\s+others\s+then\s+null/i);
});

// ─── (E) the self-check must actually be able to fail ───

test("P1.1 self-check refuses to commit if authenticated still holds EXECUTE", () => {
  assert.match(
    code,
    /has_function_privilege\s*\(\s*'authenticated'\s*,\s*'public\.nt_enqueue_email\(text,text,text,text\)'\s*,\s*'execute'\s*\)/i,
    "the file must verify the hole is closed rather than assume it",
  );
  assert.match(code, /raise\s+exception\s+'فشل أمني/i, "and abort the transaction if it is not");
});

test("P1.1 self-check also proves the legitimate path survived", () => {
  assert.match(
    code,
    /has_function_privilege\s*\(\s*'service_role'[\s\S]{0,140}?raise\s+exception/i,
    "a revoke that also broke real sending would be a regression, so assert service_role kept EXECUTE",
  );
});

test("P1.1 the transaction is explicit", () => {
  assert.match(code, /^\s*begin\s*;/im);
  assert.match(code, /^\s*commit\s*;/im);
});
