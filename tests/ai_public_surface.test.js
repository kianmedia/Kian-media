// ════════════════════════════════════════════════════════════════════════════
// tests/ai_public_surface.test.js — THE UNAUTHENTICATED DOOR.
//
// This repo has already been burned once by an anon key that could read real
// company data (see the authz incident note). So the public assistant is judged
// by the strictest available standard:
//
//   ⛔ ZERO anon grants — on any ai_* table, and on any ai_* function. Not
//      "restricted by RLS": NOT GRANTED. RLS on an ungranted object is a second
//      lock on a door that was never installed, which is the correct order.
//   ⛔ THE RELAY STAYS CLOSED — nothing on this path sends email, WhatsApp or
//      a notification, and the caller can never name a recipient.
//   ⛔ A DRAFT IS ONLY A DRAFT — no client, no opportunity, no project, no
//      quote, no binding price.
//   ⛔ RATE LIMITED IN THE DATABASE, not only in per-instance memory — the
//      memory brake dies with a cold start, so it cannot be the real limit.
//   ⛔ CAPTCHA FAILS CLOSED — required-but-unimplemented must refuse, because
//      accepting would write a row that LOOKS verified.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, FILES, fnBody, stripComments } = require("./ai_helpers");

const RUNME = R(FILES.RUNME);
const ROUTE = R(FILES.ROUTE);
const PAGE = R(FILES.PUBLIC_PAGE);
const LEAD = fnBody(RUNME, "ai_public_lead_draft");
const PUBLIC_ASK = fnBody(RUNME, "ai_public_ask");

// ─── 1) NO ANON, ANYWHERE ──────────────────────────────────────────────────

test("★ every ai_* table is revoked from anon, and never granted back", () => {
  const grants = RUNME.slice(RUNME.indexOf("do $g$"), RUNME.indexOf("do $seed$"));
  assert.match(grants, /revoke all on public\.%I from anon/, "anon is revoked on every table in the list");
  // The only grant loop must target authenticated, and only SELECT.
  assert.match(grants, /grant select on public\.%I to authenticated/, "authenticated gets SELECT only");
  assert.ok(!/grant \w+ on public\.%I to anon/.test(grants), "no table is ever granted to anon");
  assert.ok(!/to anon/.test(grants.replace(/revoke all on (?:public\.%I|function %s) from anon/g, "")),
    "the string 'to anon' appears nowhere in the grant section");
});

test("★ every ai_* function is revoked from anon and from PUBLIC", () => {
  const grants = RUNME.slice(RUNME.indexOf("-- كلّ الدوالّ"), RUNME.indexOf("insert into public.ai_role_gate_map"));
  assert.match(grants, /revoke all on function %s from public/, "PUBLIC loses execute");
  assert.match(grants, /revoke all on function %s from anon/, "anon loses execute");
  assert.ok(!/grant execute on function %s to anon/.test(grants), "and is never granted it back");
});

test("★ the migration REFUSES to install if anon can reach anything", () => {
  assert.match(RUNME, /has_function_privilege\('anon', p\.oid, 'execute'\)/,
    "the self-test checks function privileges for anon");
  assert.ok(RUNME.includes("table_name like 'ai\\_%' and grantee = 'anon'"),
    "and table grants for anon");
  assert.match(RUNME, /anon-ينفّذ/, "a violation fails the migration");
  assert.match(RUNME, /anon-على-جدول/, "for both cases");
});

test("★ the public RPCs are granted to service_role ONLY — the browser cannot reach them", () => {
  // Anchor the slice on the pg_roles guard itself. (The literal "service_role"
  // also appears inside ai_forbidden_content's secret patterns, and indexing on
  // the first occurrence silently sliced the wrong region.)
  const svcStart = RUNME.indexOf("if exists (select 1 from pg_roles where rolname = 'service_role')");
  assert.ok(svcStart > 0, "the service_role grant block exists");
  const svc = RUNME.slice(svcStart, RUNME.indexOf("end $g$;", svcStart));
  assert.match(svc, /public\.ai_public_ask\(text,text\)/, "ai_public_ask is service-role only");
  assert.match(svc, /public\.ai_public_lead_draft\(jsonb,text,text,text,text\)/, "and so is the lead draft");

  // And they are NOT in the authenticated grant list.
  const authList = RUNME.slice(RUNME.indexOf("-- الداخليّ: للمستخدم المصادَق"), RUNME.indexOf("-- ★ السطح العامّ يمرّ عبر الخادم"));
  assert.ok(!authList.includes("ai_public_ask"), "ai_public_ask is not granted to authenticated");
  assert.ok(!authList.includes("ai_public_lead_draft"), "nor is the lead draft");

  // The browser layer must not even know their names.
  const lib = stripComments(R(FILES.LIB));
  assert.ok(!lib.includes("ai_public_ask"), "the browser client never calls the public ask");
  assert.ok(!lib.includes("ai_public_lead_draft"), "nor the public lead draft");
});

test("the rate-limit table is granted to NOBODY — it is not readable over REST at all", () => {
  const grants = RUNME.slice(RUNME.indexOf("do $g$"), RUNME.indexOf("do $seed$"));
  const selectLoop = grants.slice(grants.indexOf("-- قراءة فقط"));
  assert.ok(!selectLoop.includes("'ai_public_rate_limits'"),
    "★ ai_public_rate_limits is deliberately absent from the SELECT grant list — a rate-limit table is an abuse oracle");
  assert.match(RUNME, /ai_public_rate_limits: بلا أيّ سياسة/, "and the decision is documented where it is made");
});

// ─── 2) THE RELAY STAYS CLOSED ─────────────────────────────────────────────

test("★ the public lead path sends NOTHING — no relay, no queue, no notification", () => {
  for (const forbidden of [
    "notify_", "email_outbox", "send_email", "comms_send", "comms_enqueue",
    "whatsapp", "sendProjectEmail", "processQueue",
  ]) {
    assert.ok(!LEAD.toLowerCase().includes(forbidden.toLowerCase()), `the lead RPC must not touch ${forbidden}`);
    assert.ok(!PUBLIC_ASK.toLowerCase().includes(forbidden.toLowerCase()), `nor may the public ask touch ${forbidden}`);
  }
  assert.match(LEAD, /'email_sent', false/, "and the response states plainly that nothing was sent");
  assert.match(RUNME, /السطح-العامّ-يرسل/, "the migration self-tests this and refuses to install a sending public surface");
});

test("the HTTP route sends nothing either, and says so in its response", () => {
  const code = stripComments(ROUTE);
  for (const forbidden of ["nodemailer", "sendMail", "notifyEmail", "sendProjectEmail", "commsProvider", "whatsapp"]) {
    assert.ok(!code.includes(forbidden), `the route must not import or call ${forbidden}`);
  }
  assert.match(ROUTE, /email_sent: false/, "the response asserts it");
  assert.match(ROUTE, /notification_sent: false/, "for notifications too");
  assert.match(ROUTE, /converted_to_client: false/, "and states no client was created");
  assert.match(ROUTE, /quote_issued: false/, "and no quote");
  assert.match(ROUTE, /binding_price: false/, "and no binding price");
});

test("★ the caller can never name a recipient — the payload is CLOSED on both sides", () => {
  assert.match(LEAD, /where k not in \('full_name','email','phone','company','service_interest','message','locale'\)/,
    "the database rejects any key outside the closed list");
  assert.match(LEAD, /'ok', false, 'error', 'unknown_fields'/, "and refuses the whole request rather than dropping the field");
  assert.match(ROUTE, /const LEAD_KEYS = \["full_name", "email", "phone", "company", "service_interest", "message", "locale"\]/,
    "the route enforces the same closed list");
  assert.match(ROUTE, /error: "unknown_fields"/, "and also refuses rather than ignores");

  // A recipient-shaped field must not exist anywhere on this path.
  for (const forbidden of ["notify_email", "recipient", "send_to", "assigned_to", "cc", "bcc"]) {
    assert.ok(!LEAD.includes(`'${forbidden}'`), `the lead payload must not accept ${forbidden}`);
    assert.ok(!stripComments(PAGE).includes(forbidden), `and the public page must not offer ${forbidden}`);
  }
});

test("a draft stays a draft: pending_human_review, awaiting_human, nothing else", () => {
  assert.match(LEAD, /'pending_human_review', 'awaiting_human'/, "the inserted state is fixed");
  assert.match(LEAD, /⛔ لا إشعار ولا بريد ولا واتساب هنا/, "and the decision is documented at the point of insert");
  assert.match(RUNME, /ai_lead_drafts_status_known[\s\S]{0,200}?'pending_human_review','accepted','rejected','spam'/,
    "the status vocabulary is closed");
});

test("the public surface never creates an operational entity", () => {
  for (const forbidden of ["insert into public.clients", "insert into public.crm_leads", "insert into public.projects", "insert into public.opportunity_requests", "insert into public.sq_quotes"]) {
    assert.ok(!LEAD.includes(forbidden), `the lead RPC must not ${forbidden}`);
  }
});

// ─── 3) RATE LIMITING AND ABUSE ────────────────────────────────────────────

test("★ rate limiting lives in the DATABASE — three windows, not one", () => {
  assert.match(LEAD, /'pub_lead_h:' \|\| coalesce\(p_ip_hash, 'unknown'\)[\s\S]{0,160}?interval '1 hour'/, "per-IP hourly");
  assert.match(LEAD, /'pub_lead_d:' \|\| coalesce\(p_ip_hash, 'unknown'\)[\s\S]{0,160}?interval '1 day'/, "per-IP daily");
  assert.match(LEAD, /'pub_lead_g'[\s\S]{0,160}?interval '1 day'/,
    "★ and a GLOBAL daily ceiling — the per-IP limits alone are useless against a distributed flood");
  assert.match(PUBLIC_ASK, /ai_rate_take\('pub_ask:'/, "the public ask is limited too");
});

test("the rate limiter fails CLOSED and is not fooled by a zero limit", () => {
  const take = fnBody(RUNME, "ai_rate_take");
  assert.match(take, /if coalesce\(p_limit, 0\) <= 0 then return false; end if;/,
    "★ a zero or NULL limit denies — it does not mean 'unlimited'");
  assert.match(take, /on conflict \(bucket_key, window_start\) do update set hits = public\.ai_public_rate_limits\.hits \+ 1/,
    "the counter is atomic — two parallel requests cannot both read the same count");
  assert.match(take, /return coalesce\(v_hits, p_limit \+ 1\) <= p_limit;/,
    "and an unreadable counter denies rather than allows");
});

test("a rate-limited attempt is recorded as abuse, on both public surfaces", () => {
  assert.match(LEAD, /insert into public\.ai_abuse_log \(surface, reason, ip_hash\) values \('public_lead', 'rate_limited'/, "lead");
  assert.match(PUBLIC_ASK, /insert into public\.ai_abuse_log \(surface, reason, ip_hash\) values \('public_ask', 'rate_limited'/, "ask");
});

test("the route's in-memory brake is documented as a brake, NOT as the limit", () => {
  assert.match(ROUTE, /HONEST LIMITS/, "the route says what its own limiter is worth");
  assert.match(ROUTE, /The REAL limit is in the database/, "and points at the real one");
  assert.match(ROUTE, /rateLimit\(`ai-public:\$\{action\}:\$\{clientKey\(req\)\}`/, "the brake exists and is per action");
  assert.match(ROUTE, /status: 429/, "and answers 429, a code distinct from a failure or a denial");
});

test("★ rate limiting is NOT reported as an outage or a permission problem", () => {
  assert.match(ROUTE, /error: "rate_limited"/, "the route returns a distinct code");
  assert.match(PAGE, /rate_limited: "عدد المحاولات تجاوز الحدّ المسموح/, "and the page words it as a limit");
  // The four causes stay four causes on the public page too.
  for (const code of ["feature_not_enabled", "server_not_configured", "rate_limited", "request_failed"]) {
    assert.ok(PAGE.includes(`${code}:`), `the page distinguishes ${code}`);
  }
});

// ─── 4) CAPTCHA, IDEMPOTENCY, PERSONAL DATA ────────────────────────────────

test("★ CAPTCHA fails CLOSED: required-but-unimplemented refuses and stores nothing", () => {
  const cap = fnBody(RUNME, "ai_captcha_verify");
  assert.match(cap, /if coalesce\(st\.captcha_provider, ''\) = '' then/, "an unconfigured provider is detected");
  assert.match(cap, /'verdict', 'not_configured'/, "and reported as such — not as verified");
  assert.match(LEAD, /coalesce\(v_cap->>'verdict', ''\) <> 'verified'/, "only a verified verdict may pass");
  assert.match(LEAD, /'ok', false, 'error', 'captcha_not_verified'/, "everything else refuses");
  assert.match(RUNME, /CAPTCHA-بلا-فشل-مغلق/, "and the migration self-tests it");
  // The insert must be AFTER the captcha branch, so a refusal cannot write a row.
  const capIdx = LEAD.indexOf("captcha_not_verified");
  const insIdx = LEAD.indexOf("insert into public.ai_lead_drafts");
  assert.ok(capIdx > 0 && insIdx > capIdx, "the refusal is returned before any row is written");
});

test("idempotency returns the SAME draft — never a second row, never an error", () => {
  assert.match(LEAD, /select id into v_id from public\.ai_lead_drafts where idempotency_key = p_idempotency_key;/, "the key is looked up first");
  assert.match(LEAD, /'duplicate', true/, "a repeat is reported as a duplicate");
  assert.match(RUNME, /idempotency_key text unique/, "and the column is UNIQUE, so a race cannot double-insert");
  assert.match(PAGE, /idempotency_key: idem/, "the page sends one key per page load");
});

test("★ no raw IP and no raw user-agent is ever stored — only salted hashes", () => {
  assert.match(ROUTE, /createHash\("sha256"\)/, "the route hashes");
  assert.match(ROUTE, /const salt = process\.env\.AI_PUBLIC_FP_SALT/, "with a salt");
  const code = stripComments(ROUTE);
  assert.ok(!/p_ip:\s|p_ip_address|rawIp|p_user_agent:/.test(code), "no raw value is passed to the database");
  assert.match(RUNME, /ip_hash text/, "the column itself is named a hash");
  assert.match(RUNME, /user_agent_hash text/, "for both values");
});

test("field caps exist on BOTH sides, and the contact requirement is explicit", () => {
  assert.match(RUNME, /ai_lead_drafts_field_caps/, "the database caps every field");
  assert.match(RUNME, /ai_lead_drafts_has_a_contact[\s\S]{0,200}?coalesce\(email, ''\) <> '' or coalesce\(phone, ''\) <> ''/,
    "and requires one contact channel");
  assert.match(ROUTE, /const CAP = \{ question: 1_000, name: 120/, "the route caps the same fields");
  assert.match(ROUTE, /error: "contact_required"/, "and names the reason rather than failing generically");
});

test("the privacy notice is shown to the visitor AND versioned in the row", () => {
  assert.match(PAGE, /const PRIVACY_AR =/, "the page states it");
  assert.match(PAGE, /\{PRIVACY_AR\}/, "and renders it before the submit button");
  assert.match(RUNME, /privacy_notice_version text not null default 'v1'/, "the row records which version was shown");
  assert.match(LEAD, /coalesce\(st\.privacy_notice_version, 'v1'\)/, "taken from settings, not hard-coded at the call site");
});

// ─── 5) THE ROUTE ADDS NO DECISION OF ITS OWN ──────────────────────────────

test("★ the ask route passes the database payload through VERBATIM", () => {
  assert.match(ROUTE, /return NextResponse\.json\(r\.data, \{ status: 200, headers: NO_STORE \}\)/,
    "no field is added, removed or re-worded on the ask path — the redaction decision lives in ONE place");
});

test("the route never hands a raw PostgREST message to an anonymous caller", () => {
  assert.match(ROUTE, /console\.log\(JSON\.stringify\(\{ tag: "AI_PUBLIC_FAILED"/, "the server log keeps the truncated original");
  assert.match(ROUTE, /error: "request_failed"/, "and the caller gets a coarse code");
  // Look only at what is RETURNED. The server-side console line legitimately
  // carries the truncated original — that is the point of keeping it there.
  const failure = ROUTE.slice(ROUTE.indexOf("function failure("));
  const returned = (failure.match(/NextResponse\.json\([\s\S]*?\)/g) || []).join("\n");
  assert.ok(returned.length > 0, "the failure helper returns responses");
  assert.ok(!/\braw\b/.test(returned), "no returned body contains the raw upstream message");
  for (const code of ["server_not_configured", "feature_not_enabled", "not_permitted", "request_failed"]) {
    assert.ok(returned.includes(code), `and each cause has its own coarse code (${code})`);
  }
});

test("a missing migration is reported as a missing migration, not as 'no answer'", () => {
  assert.match(ROUTE, /lower\.includes\("pgrst202"\)/, "the route recognises an absent function");
  assert.match(ROUTE, /error: "feature_not_enabled"/, "and says the feature is not enabled");
  assert.match(PAGE, /feature_not_enabled: "هذه الخدمة لم تُفعَّل بعد/, "the page words it honestly for a visitor");
});

test("the public page never renders a fabricated answer when the server refused", () => {
  assert.match(PAGE, /\{ans\.answer \|\| ERR_AR\.no_approved_source\}/,
    "it shows the server's sentence, or the exact same constant — never an invented reply");
  assert.ok(!/dangerouslySetInnerHTML/.test(PAGE), "and it never injects HTML");
});
