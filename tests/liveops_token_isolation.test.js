// ════════════════════════════════════════════════════════════════════════════
// tests/liveops_token_isolation.test.js — the client-follow-up LINK.
//
// Requirements under test:
//   • the HASH is stored, never the token
//   • expiry, revocation, optional max opens
//   • NO directory listing — one link reaches one session and nothing else
//   • session-scoped
//   • ★ an IDENTICAL response for unknown and expired, so the link can never be
//     used as an oracle that tells an attacker they are getting warmer
//
// The oracle rule is the subtle one. A helpful "this link expired" message tells
// a stranger that the token they guessed EXISTS. Three separate layers here must
// all refuse to be helpful: the SQL function, the API route, and the page.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, FILES, fnBody } = require("./liveops_helpers");

const RUNME = R(FILES.RUNME);
const ROUTE = R(FILES.ROUTE);
const PAGE = R(FILES.PUBLIC_PAGE);
const LIB = R(FILES.LIB);
const VIEW = fnBody(RUNME, "liveops_client_view");
const ISSUE = fnBody(RUNME, "liveops_link_issue");
const LIST = fnBody(RUNME, "liveops_link_list");

test("★ the raw token is never stored — only a sha256 hash and a 6-char hint", () => {
  assert.match(ISSUE, /v_hash\s+:= encode\(sha256\(convert_to\(v_token,'utf8'\)\),'hex'\)/);
  assert.match(ISSUE, /set token_hash = v_hash, token_hint = right\(v_token,6\)/);

  // The column shape is constrained so a raw token cannot be smuggled into it.
  assert.match(RUNME, /constraint liveops_link_hash_shape check \(token_hash is null or token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(RUNME, /constraint liveops_link_hint_shape check \(token_hint is null or length\(token_hint\) <= 6\)/);

  // Re-issuing is refused: a token shown once cannot be shown again.
  assert.match(ISSUE, /صدر رمز لهذا الرابط ولا يُعاد إظهاره/);
});

test("the token carries 256 bits of system randomness", () => {
  assert.match(ISSUE, /'klv_' \|\| replace\(gen_random_uuid\(\)::text,'-',''\) \|\| replace\(gen_random_uuid\(\)::text,'-',''\)/,
    "two v4 UUIDs = 244 bits of entropy; guessing is not the attack to worry about");
});

test("★★ every refusal returns the SAME response — the link is not an oracle", () => {
  // One constant, used by every denial path.
  assert.match(VIEW, /DENY constant jsonb := jsonb_build_object\('ok', false, 'reason','invalid_or_expired'\)/);

  const denies = VIEW.match(/return DENY;/g) ?? [];
  assert.ok(denies.length >= 3, `expected every refusal path to return DENY, found ${denies.length}`);

  // No path builds its own refusal — that is how a reason leaks.
  assert.ok(!/return jsonb_build_object\('ok', *false/.test(VIEW),
    "a hand-built refusal would carry a distinguishing reason");

  // The word appears exactly once: inside the constant.
  const occurrences = VIEW.match(/invalid_or_expired/g) ?? [];
  assert.strictEqual(occurrences.length, 1, "one refusal wording, defined once");
});

test("the four distinct denial CAUSES are recorded internally but never returned", () => {
  // They exist for the audit trail...
  for (const cause of ["revoked", "not_active", "not_started", "expired", "exhausted", "unknown_token", "malformed_token"]) {
    assert.ok(VIEW.includes(`'${cause}'`), `${cause} must be distinguishable in the audit log`);
  }
  // ...and are written to the log, not to the caller.
  assert.match(VIEW, /insert into public\.liveops_link_access_log\(link_id, session_id, allowed, denied_reason, fingerprint\)/);
});

test("a rejected attempt is logged BEFORE the refusal — including a completely unknown token", () => {
  assert.match(VIEW, /values \(null, null, false, 'unknown_token', v_fp\)/,
    "an unknown token still produces a log row (link_id null) so probing is visible");
  assert.match(VIEW, /values \(null, null, false, 'malformed_token', v_fp\)/);
  const audit = fnBody(RUNME, "liveops_link_audit");
  assert.match(audit, /يشمل المحاولات المرفوضة عمدًا/,
    "the audit view states that denials are included, on purpose");
});

test("expiry, revocation and the optional open limit are all enforced before any data is read", () => {
  assert.match(VIEW, /when g\.status = 'revoked' then 'revoked'/);
  assert.match(VIEW, /when g\.starts_at > now\(\) then 'not_started'/);
  assert.match(VIEW, /when g\.expires_at <= now\(\) then 'expired'/);
  assert.match(VIEW, /when g\.max_opens is not null and g\.opens_used >= g\.max_opens then 'exhausted'/,
    "max_opens is OPTIONAL: a null means unlimited, and null >= n must not be treated as exhausted");

  // The payload builder is only reached after the deny ladder.
  const denyIdx = VIEW.indexOf("v_deny is not null");
  const payloadIdx = VIEW.indexOf("liveops_client_payload");
  assert.ok(denyIdx > -1 && payloadIdx > denyIdx, "authorise first, read second");
});

test("a link is session-scoped and offers no directory", () => {
  assert.match(VIEW, /return public\.liveops_client_payload\(g\.session_id\)/,
    "the session comes from the LINK ROW, never from anything the caller sent");
  // liveops_client_view takes a token and a fingerprint. Nothing else.
  assert.match(RUNME, /create or replace function public\.liveops_client_view\(p_token text, p_fingerprint text default null\)/);
  // No listing function is reachable without staff authority.
  const sessionList = fnBody(RUNME, "liveops_session_list");
  assert.match(sessionList, /liveops_can_view/, "listing sessions requires staff authority");
});

test("★ the external function is granted to service_role ONLY", () => {
  assert.match(RUNME, /revoke all on function\s*\n\s*public\.liveops_client_view\(text,text\),\s*\n\s*public\.liveops_client_payload\(uuid\)\s*\n\s*from public, anon, authenticated;/);
  assert.match(RUNME, /grant execute on function public\.liveops_client_view\(text,text\) to service_role;/);
  assert.ok(!/grant execute on function public\.liveops_client_view\(text,text\) to (anon|authenticated)/.test(RUNME));
});

test("the links table and its access log are never readable directly", () => {
  // They get RLS but no SELECT policy and no grant, so the hash cannot be read
  // even by an authenticated staff member going around the RPC.
  const policyLoop = RUNME.slice(RUNME.indexOf("§13"), RUNME.indexOf("§14"));
  assert.ok(!/liveops_client_links'\][\s\S]{0,200}create policy/.test(policyLoop));
  const grantBlock = RUNME.slice(RUNME.indexOf("§19"), RUNME.indexOf("§20"));
  const grantList = /grant select on public\.%I to authenticated[\s\S]*?end \$gr\$/.exec(RUNME);
  assert.ok(grantList, "the grant loop exists");
  // The grant loop enumerates ten tables; the two link tables are not among them.
  const loopSrc = grantBlock.slice(grantBlock.lastIndexOf("foreach t in array array["));
  assert.ok(!loopSrc.includes("liveops_client_links"), "no SELECT grant on the links table");
  assert.ok(!loopSrc.includes("liveops_link_access_log"), "no SELECT grant on the access log");
});

test("the listing RPC exposes the hint but never the hash", () => {
  assert.ok(!/'token_hash'/.test(LIST), "the hash must never be serialised out");
  assert.match(LIST, /'token_hint', l\.token_hint/);
  assert.match(LIST, /⛔ token_hash لا يخرج أبدًا/, "the intent is written where the next editor will read it");
});

test("nothing in the system sends the link — it is handed over by a human", () => {
  assert.match(ISSUE, /'delivery_enabled', false/);
  assert.match(ISSUE, /النظام لا يرسل بريدًا ولا رسالة/);
  assert.ok(!/comms_enqueue|send_email|sendEmail|notify_email/.test(fnBody(RUNME, "liveops_link_issue")),
    "issuing a link must not trigger any delivery path");
});

// ─── the server route ───────────────────────────────────────────────────────

test("the API route is POST-only, rate limited, and never caches", () => {
  assert.match(ROUTE, /export async function POST/);
  assert.ok(!/export async function (GET|PUT|PATCH|DELETE)/.test(ROUTE),
    "a GET would put the token in the URL and therefore in access logs");
  assert.match(ROUTE, /rateLimit\(`live-status:\$\{clientKey\(req\)\}`/);
  assert.match(ROUTE, /"Cache-Control": "no-store, no-cache, must-revalidate"/);
  assert.match(ROUTE, /"X-Robots-Tag": "noindex, nofollow"/);
});

test("★ the route collapses every refusal to the same reason, exactly like the database", () => {
  assert.match(ROUTE, /\{ ok: false, reason: "invalid_or_expired" \}/);
  // A malformed token gets the SAME shape as an unknown one.
  const malformed = ROUTE.slice(ROUTE.indexOf("token.length < 32"));
  assert.match(malformed, /reason: "invalid_or_expired"/);
  // It must not forward a server-supplied reason verbatim.
  assert.ok(!/reason: String\(payload/.test(ROUTE),
    "forwarding the payload's reason would reintroduce the oracle if the DB ever became chatty");
});

test("the route keeps 'not deployed' distinct from 'invalid link' and from 'network'", () => {
  assert.match(ROUTE, /PGRST202\|could not find the function/i);
  assert.match(ROUTE, /error: "pending_migration"/);
  assert.match(ROUTE, /error: "server_not_configured"/);
  assert.match(ROUTE, /error: "upstream_error"/);
  // The page keeps them distinct too.
  assert.match(PAGE, /pending_migration: "هذه الخدمة لم تُفعَّل بعد على الخادم/);
});

test("the service key never leaves the server, and never appears in the browser bundle", () => {
  assert.match(ROUTE, /export const runtime = "nodejs"/);
  assert.match(ROUTE, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.ok(!/SERVICE_ROLE|service_role/.test(LIB), "the browser client is anon-key only");
  assert.ok(!/SERVICE_ROLE|service_role/.test(PAGE), "the public page never sees a service key");
});

test("the visitor fingerprint is salted and hashed — no raw IP or user-agent is stored", () => {
  assert.match(ROUTE, /createHash\("sha256"\)\.update\(`\$\{salt\}\|\$\{ip\}\|\$\{ua\}`\)/);
  assert.match(RUNME, /fingerprint\s+text check \(fingerprint is null or fingerprint ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    "the column only accepts a hash shape, so a raw IP cannot be written into it");
  const audit = fnBody(RUNME, "liveops_link_audit");
  assert.match(audit, /left\(coalesce\(a\.fingerprint,''\),12\)/, "even the hash is truncated when displayed");
});

// ─── the page ───────────────────────────────────────────────────────────────

test("★ the token travels in the URL FRAGMENT and is POSTed in the body", () => {
  assert.match(PAGE, /window\.location\.hash\.replace\(\/\^#\/, ""\)/);
  assert.match(PAGE, /body: JSON\.stringify\(\{ token: tk \}\)/);
  assert.ok(!/\?token=|searchParams/.test(PAGE),
    "a query string would leak the token into access logs and the Referer header");
});

test("the page shows ONE denial message and never guesses a cause", () => {
  const denialBranch = PAGE.slice(PAGE.indexOf("// ⛔ ONE message"));
  assert.match(denialBranch, /هذا الرابط غير صالح أو انتهت صلاحيته/);
  // No per-reason dictionary exists that could reintroduce the distinction.
  assert.ok(!/DENY_AR\s*:\s*Record|const DENY_AR/.test(PAGE),
    "a reason→message map would be a leak waiting to be filled in");
});

test("the share URL helper puts the token after the hash", () => {
  assert.match(LIB, /return `\$\{base\}\/live-status#\$\{token\}`/);
});
