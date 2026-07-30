// ════════════════════════════════════════════════════════════════════════════
// tests/comms_outbox_state.test.js — the outbox state machine, idempotency,
// retry/backoff, dead-letter, cancel-before-send, audit and rate limiting.
// Structural pins against the migration. No DB, no network, no email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/communications_hub_RUNME.sql");
const HUB = R("lib/server/commsHub.ts");

/** Exact body of ONE function: CREATE .. first closing `$$;`. A looser slice
 *  would run into the next function and let an assertion pass on foreign code. */
const fnBody = (name) => {
  const i = RUNME.indexOf(`create or replace function public.${name}(`);
  assert.ok(i > -1, `${name} exists`);
  const open = RUNME.indexOf("as $$", i);
  const end = RUNME.indexOf("$$;", open + 5);
  assert.ok(open > i && end > open, `${name} has a terminated body`);
  return RUNME.slice(i, end);
};

const STATES = ["queued", "processing", "sent", "delivered", "failed", "retrying", "dead_letter", "cancelled"];

// ─── The vocabulary ─────────────────────────────────────────────────────────

test("the outbox CHECK carries the full required state vocabulary", () => {
  const table = RUNME.slice(RUNME.indexOf("create table if not exists public.comms_outbox"),
                            RUNME.indexOf("create unique index if not exists uq_comms_outbox_idem"));
  for (const s of STATES) assert.ok(table.includes(`'${s}'`), `status ${s} is allowed`);
  assert.ok(RUNME.includes("HUB FAIL: status % missing from the comms_outbox CHECK"),
    "the migration self-tests the vocabulary against the live constraint");
  // and these are REAL states, not derived-for-display like the legacy queue
  assert.ok(!/retrying.*derived/i.test(table), "retrying is a stored state here, not a report-time derivation");
});

test("the outbox carries every field the brief requires", () => {
  const table = RUNME.slice(RUNME.indexOf("create table if not exists public.comms_outbox"),
                            RUNME.indexOf("create unique index if not exists uq_comms_outbox_idem"));
  for (const col of ["correlation_id", "idempotency_key", "attempts", "max_attempts",
                     "next_attempt_at", "provider", "provider_message_id", "provider_response",
                     "last_error", "error_class", "dry_run", "cancelled_by", "cancel_reason",
                     "template_id", "template_version", "locale", "audience_scope",
                     "recipient_is_external", "legacy_delivery_id"]) {
    assert.ok(new RegExp(`\\n\\s+${col}\\s`).test(table), `column ${col} exists`);
  }
  assert.ok(/provider_response\s+jsonb/.test(table), "provider response metadata is stored as jsonb");
});

// ─── Idempotency ────────────────────────────────────────────────────────────

test("idempotency: a partial unique index, and the ON CONFLICT repeats its predicate", () => {
  assert.ok(/create unique index if not exists uq_comms_outbox_idem\s+on public\.comms_outbox\(idempotency_key\) where idempotency_key is not null/.test(RUNME),
    "partial unique index on idempotency_key");
  const enq = fnBody("comms_enqueue");
  assert.ok(/on conflict \(idempotency_key\) where idempotency_key is not null do nothing/.test(enq),
    "ON CONFLICT repeats the partial predicate — omitting it raises 42P10 and aborts the caller");
  assert.ok(RUNME.includes("HUB FAIL: partial unique idempotency index missing"), "self-tested");
});

test("idempotency key includes the CHANNEL, so portal and email are separate but each is deduped", () => {
  const enq = fnBody("comms_enqueue");
  assert.ok(/v_key := p_event \|\| ':' \|\| coalesce\(p_entity_id::text, '-'\) \|\| ':' \|\| rec\.user_id::text \|\| ':' \|\| ch;/.test(enq),
    "key = event:entity:user:channel");
});

test("duplicate suppression is REPORTED, never silently counted as a new send", () => {
  const enq = fnBody("comms_enqueue");
  assert.ok(/if v_id is null then v_dupe := v_dupe \+ 1;/.test(enq), "a suppressed insert increments the duplicate counter");
  assert.ok(/'duplicates_suppressed', v_dupe/.test(enq), "and is returned to the caller");
  assert.ok(/duplicates_suppressed/.test(HUB), "the TS layer surfaces it");
});

// ─── Claim / settle / backoff / dead-letter ─────────────────────────────────

test("claim is atomic, leased, and burns the attempt AT CLAIM TIME", () => {
  const claim = fnBody("comms_claim");
  assert.ok(/for update skip locked/.test(claim), "concurrent workers cannot claim the same row");
  assert.ok(/status = 'processing', attempts = o\.attempts \+ 1/.test(claim),
    "the attempt is burned at claim, so a worker that dies mid-send cannot make a row immortal");
  assert.ok(/lease_until = now\(\) \+ interval '1 hour'/.test(claim), "a lease bounds in-flight time");
  assert.ok(/o\.attempts < o\.max_attempts/.test(claim), "an exhausted row is never re-claimed");
  assert.ok(/status in \('queued','retrying'\)/.test(claim), "only runnable states are claimed");
});

test("exponential backoff with a max-attempt dead letter", () => {
  const settle = fnBody("comms_settle");
  assert.ok(/make_interval\(mins => \(5 \* power\(2, o\.attempts\)\)::int\)/.test(settle),
    "backoff is 5 * 2^attempts minutes");
  assert.ok(/if o\.attempts >= o\.max_attempts then\s*\n\s*v_status := 'dead_letter'/.test(settle),
    "exhausted attempts land in the dead-letter state");
  assert.ok(/v_status := 'retrying'/.test(settle), "otherwise the row retries");
  const table = RUNME.slice(RUNME.indexOf("create table if not exists public.comms_outbox"));
  assert.ok(/max_attempts\s+int not null default 5/.test(table), "max_attempts defaults to 5");
});

test("a CHANNEL problem defers the row and HANDS THE ATTEMPT BACK", () => {
  const settle = fnBody("comms_settle");
  const i = settle.indexOf("elsif p_outcome = 'channel_deferred'");
  assert.ok(i > -1, "channel_deferred is a distinct outcome");
  const branch = settle.slice(i, i + 700);
  assert.ok(/status = 'queued'/.test(branch), "the row returns to the queue");
  assert.ok(/attempts = greatest\(0, o\.attempts - 1\)/.test(branch),
    "the attempt is handed back — an undeployed relay must not dead-letter the backlog");
  assert.ok(/next_attempt_at = now\(\) \+ interval '30 minutes'/.test(branch), "short defer so it self-heals");
});

test("a live 'sent' without a provider acknowledgment is recorded as FAILED, not sent", () => {
  const settle = fnBody("comms_settle");
  assert.ok(/v_ack := coalesce\(\(p_provider_response->>'ack'\)::boolean, false\)/.test(settle),
    "ack defaults to false — absence is never consent");
  assert.ok(/if p_outcome = 'sent' and not o\.dry_run and not v_ack then/.test(settle),
    "the rule fires for non-dry-run rows");
  assert.ok(/p_error_class := 'no_provider_ack'/.test(settle), "and is named honestly");
});

test("settle refuses to act on a row that was never claimed", () => {
  const settle = fnBody("comms_settle");
  assert.ok(/if o\.status <> 'processing' then[\s\S]{0,160}'not_claimed'/.test(settle),
    "only a claimed row may be settled");
});

test("the reaper classifies rather than looping forever", () => {
  const reap = fnBody("comms_reap");
  assert.ok(/status = 'dead_letter'[\s\S]{0,300}attempts >= max_attempts/.test(reap),
    "an exhausted stuck row terminates in the dead-letter queue");
  assert.ok(/status = 'retrying'[\s\S]{0,300}lease_until < now\(\)/.test(reap),
    "a stuck row with attempts left is returned to a runnable state");
});

test("the drain reaps BEFORE it claims", () => {
  const i = HUB.indexOf("comms_reap");
  const j = HUB.indexOf("comms_claim");
  assert.ok(i > -1 && j > -1 && i < j, "reap runs first, so a crashed row is runnable again before we claim");
});

// ─── Manual retry / cancel ──────────────────────────────────────────────────

test("manual retry resets the row cleanly and is authorized + audited", () => {
  const retry = fnBody("comms_retry");
  assert.ok(/public\.comms_can_admin\(\)/.test(retry), "authorized");
  assert.ok(/status = 'queued', attempts = 0, next_attempt_at = now\(\)/.test(retry), "reset to runnable");
  assert.ok(/cancelled_at = null, cancelled_by = null, cancel_reason = null/.test(retry),
    "retrying a cancelled row clears the cancellation, so the row is not half-cancelled");
  assert.ok(/comms_audit_write\('manual_retry'/.test(retry), "audited with the previous status");
});

test("cancel works ONLY before send, and is audited", () => {
  const cancel = fnBody("comms_cancel");
  assert.ok(/if o\.status not in \('queued','retrying'\) then[\s\S]{0,140}'too_late'/.test(cancel),
    "a claimed or sent row cannot be cancelled — and says so honestly");
  assert.ok(/cancelled_by = auth\.uid\(\)/.test(cancel), "who cancelled is recorded");
  assert.ok(/comms_audit_write\('cancel'/.test(cancel), "audited");
});

// ─── Audit ──────────────────────────────────────────────────────────────────

test("audit covers every sensitive action and can never abort a business action", () => {
  const w = fnBody("comms_audit_write");
  assert.ok(/exception when others then\s*\n\s*return;/.test(w), "the audit writer swallows its own failure");
  for (const action of ["'enqueue'", "'manual_retry'", "'cancel'", "'channel_flag'",
                        "'template_publish'", "'prefs_set'", "'legacy_import'",
                        "'recipient_blocked_r1'", "'content_blocked_r2'", "'enqueue_rate_limited'"]) {
    assert.ok(RUNME.includes(`comms_audit_write(${action}`), `audited: ${action}`);
  }
  const flag = fnBody("comms_channel_set");
  assert.ok(/'from', jsonb_build_object\('enabled', o\.enabled, 'dry_run', o\.dry_run\)/.test(flag),
    "a flag change records the BEFORE value, not just the after");
});

// ─── Rate limiting ──────────────────────────────────────────────────────────

test("rate limiting is a SHARED store, not per-instance memory, and fails closed on bad input", () => {
  assert.ok(/create table if not exists public\.comms_rate_counters/.test(RUNME), "a table, so it survives cold starts");
  const rl = fnBody("comms_rate_check");
  assert.ok(/if p_key is null or p_limit is null or p_limit <= 0 then return false; end if;/.test(rl),
    "a nonsensical limit denies rather than allows");
  assert.ok(/return coalesce\(v_hits, 1\) <= p_limit;/.test(rl), "coalesced — never returns NULL");
  const enq = fnBody("comms_enqueue");
  assert.ok(/if not public\.comms_rate_check\('event:' \|\| p_event, cat\.rate_limit_hour, 3600\)/.test(enq),
    "the enqueue is rate limited per event per hour");
  assert.ok(/'rate_limited'/.test(enq), "and reports it honestly instead of pretending to queue");
});

// ─── Closed vocabulary ──────────────────────────────────────────────────────

test("events are a CLOSED vocabulary: an unknown event is refused, never free-texted into the queue", () => {
  const enq = fnBody("comms_enqueue");
  assert.ok(/select \* into cat from public\.comms_event_catalog where event_key = p_event and active;/.test(enq),
    "the catalogue is consulted first");
  assert.ok(/'event_not_in_catalog'/.test(enq), "an unknown event is refused with a named reason");
});

test("a disabled channel queues NOTHING for that channel — the feature flag does real work", () => {
  const enq = fnBody("comms_enqueue");
  assert.ok(/if not coalesce\(\(select c\.enabled from public\.comms_channels c where c\.channel = ch\), false\) then/.test(enq),
    "the channel flag is checked per channel, coalesced to false");
  assert.ok(/v_skipped_chan := v_skipped_chan \+ 1; continue;/.test(enq), "and the skip is counted");
});

test("mandatory events ignore preferences; optional events honour them", () => {
  const enq = fnBody("comms_enqueue");
  assert.ok(/if not cat\.mandatory then/.test(enq), "preferences are applied only to non-mandatory events");
  assert.ok(/ch <> 'whatsapp'\)\s*\n?\s*then/.test(enq) || /ch <> 'whatsapp'/.test(enq),
    "the default when a user has no row is portal+email yes, whatsapp no");
});

// ─── The legacy mirror must never be reported as a live send ─────────────────
// REGRESSION (adversarial verification): comms_adapter_import_legacy copies
// TERMINAL email_deliveries rows in with dry_run = false and status 'sent'.
// comms_health originally counted those under sent_live, which the dashboard
// paints green as «إرسال فعلي». That is a forged success twice over: the hub
// never sent them, and the legacy queue's own 'sent' is not evidence of
// delivery while the Apps Script portal_notify handler is undeployed.
test("comms_health: mirrored legacy rows are excluded from sent_live and reported separately", () => {
  const h = fnBody("comms_health");
  const live = h.match(/'sent_live',[\s\S]*?'delivered',/);
  assert.ok(live, "sent_live is not computed in comms_health");
  assert.match(live[0], /not is_legacy_mirror/,
    "sent_live still counts rows mirrored from the legacy queue as real sends");
  assert.match(live[0], /legacy_email_deliveries/,
    "sent_live lost the belt-and-braces provider-string exclusion");
  const delivered = h.match(/'delivered',[\s\S]*?'mirrored_legacy',/);
  assert.ok(delivered && /not is_legacy_mirror/.test(delivered[0]),
    "delivered still counts mirrored legacy rows");
  assert.match(h, /'mirrored_legacy',\s*count\(\*\) filter \(where is_legacy_mirror/,
    "the mirror count is not surfaced on its own");
  // The importer is what creates those rows: pin the provenance they carry.
  const imp = fnBody("comms_adapter_import_legacy");
  assert.match(imp, /'legacy_mirror', true, 'live', 'unavailable'/,
    "the importer no longer states provenance, so the exclusions above rest on a free-text string again");
  assert.match(imp, /'legacy_email_deliveries'/, "the legacy provider tag is still written");
});

test("the migration refuses to install a comms_health that launders the legacy mirror", () => {
  assert.match(RUNME, /comms_health\.sent_live lost the/,
    "no static self-test guards the sent_live conditions");
  assert.match(RUNME, /comms_health\.delivered lost the/,
    "no static self-test guards the delivered conditions");
  assert.match(RUNME, /comms_health does not report % as its own bucket/,
    "no static self-test guards the separate never-live buckets");
});
