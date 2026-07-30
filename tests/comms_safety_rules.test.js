// ════════════════════════════════════════════════════════════════════════════
// tests/comms_safety_rules.test.js — the TWO HARD RULES + NULL discipline.
//
//   R1  A client must never receive an internal notification.
//   R2  No internal or financial content may reach a client.
//
// Both must be enforced SERVER-SIDE, and in two independent places, so that a
// caller mistake and a direct service_role INSERT are both caught. These tests
// pin that structure. No DB, no network, no email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/communications_hub_RUNME.sql");
const POST = R("docs/communications_hub_POSTCHECK.sql");

/** Exact body of ONE function: from its CREATE to the FIRST `$$;` that closes it.
 *  A looser slice would run past a `language sql` function into the next one and
 *  make an assertion pass on somebody else's code — which is worse than no test. */
const fnBody = (name) => {
  const i = RUNME.indexOf(`create or replace function public.${name}(`);
  assert.ok(i > -1, `${name} exists`);
  const open = RUNME.indexOf("as $$", i);
  assert.ok(open > i, `${name} has a $$ body`);
  const end = RUNME.indexOf("$$;", open + 5);
  assert.ok(end > open, `${name} body is terminated`);
  return RUNME.slice(i, end);
};

// ─── R1 ─────────────────────────────────────────────────────────────────────

test("R1 is enforced TWICE: in the enqueue filter and again in the outbox trigger", () => {
  const guard = fnBody("comms_outbox_guard");
  assert.ok(/audience_scope = 'internal' and new\.recipient_is_external/.test(guard),
    "the trigger refuses an internal message to an external recipient");
  assert.ok(/COMMS R1/.test(guard), "the raise is labelled R1");

  const enq = fnBody("comms_enqueue");
  assert.ok(/if v_ext and cat\.audience = 'internal' then/.test(enq),
    "the enqueue drops external recipients from internal events before ever inserting");
  assert.ok(/recipient_blocked_r1/.test(enq), "the drop is audited, not silent");
});

test("R1 cannot be bypassed by a direct INSERT: the trigger RECOMPUTES externality", () => {
  const guard = fnBody("comms_outbox_guard");
  assert.ok(/new\.recipient_is_external\s*:=\s*public\.comms_is_external\(new\.recipient_user_id\)/.test(guard),
    "the column is overwritten from the database, so a caller cannot lie about it");
  // and a row with no identifiable user is treated as external
  assert.ok(/coalesce\(new\.recipient_is_external, true\)/.test(guard),
    "an unidentifiable recipient defaults to external (fail closed)");
  // The trigger must be attached, and with NO `update of <columns>` list: the
  // guard also derives provenance, which changes when comms_settle writes
  // status/provider/provider_state, and a column list would let those writes
  // slip past the derivation and leave a stale mirror flag behind.
  assert.ok(/create trigger t_comms_outbox_guard\s+before insert or update on public\.comms_outbox/.test(RUNME),
    "the guard is attached BEFORE INSERT OR UPDATE on every column");
  assert.ok(!/create trigger t_comms_outbox_guard\s+before insert or update of/.test(RUNME),
    "no column list — a settle must not be able to bypass the guard");
  assert.ok(/on public\.comms_outbox/.test(RUNME.slice(RUNME.indexOf("create trigger t_comms_outbox_guard"))),
    "attached to comms_outbox");
});

// ─── R2 ─────────────────────────────────────────────────────────────────────

test("R2 is enforced TWICE and covers both the catalogue flag and the rendered text", () => {
  const guard = fnBody("comms_outbox_guard");
  assert.ok(/COMMS R2/.test(guard), "the trigger raises R2");
  assert.ok(/comms_body_has_restricted_content\(coalesce\(new\.subject,''\) \|\| ' ' \|\| coalesce\(new\.body,''\)\)/.test(guard),
    "subject AND body are both scanned");

  const enq = fnBody("comms_enqueue");
  assert.ok(/if v_ext and \(cat\.is_financial/.test(enq),
    "a financial event never reaches an external recipient, whatever the text says");
  assert.ok(/content_blocked_r2/.test(enq), "the block is audited");
});

test("R2 scanner looks for high-confidence markers in BOTH languages and never returns NULL", () => {
  const scan = fnBody("comms_body_has_restricted_content");
  assert.ok(/coalesce\(/.test(scan), "coalesced — cannot return NULL");
  for (const marker of ["iban", "profit margin", "cost price", "supplier price", "internal only", "correlation_id"]) {
    assert.ok(scan.includes(marker), `English marker present: ${marker}`);
  }
  for (const marker of ["الآيبان", "هامش الربح", "سعر التكلفة", "سعر المورد", "داخلي فقط"]) {
    assert.ok(scan.includes(marker), `Arabic marker present: ${marker}`);
  }
  assert.ok(/lower\(coalesce\(p_text, ''\)\)/.test(scan), "the English scan is case-insensitive");
});

test("client-scoped templates are only generated for client-visible events", () => {
  const seed = RUNME.slice(RUNME.indexOf("do $seed_tpl$"), RUNME.indexOf("end $seed_tpl$"));
  assert.ok(/if r\.audience in \('client','both'\) then/.test(seed),
    "a client template is seeded only when the catalogue says the event is client-visible");
  assert.ok(RUNME.includes("HUB FAIL: a client template exists for an internal-only event"),
    "the migration refuses to finish if one ever appears");
  assert.ok(POST.includes("C.no_client_template_for_internal_event"), "postcheck re-proves it");
});

test("the client template carries no amounts, no ids and no correlation id", () => {
  const seed = RUNME.slice(RUNME.indexOf("do $seed_tpl$"), RUNME.indexOf("end $seed_tpl$"));
  const clientBlocks = seed.split("'client', 1,").slice(1).map((s) => s.slice(0, 400));
  assert.ok(clientBlocks.length >= 2, "there are Arabic and English client templates");
  const FORBIDDEN = ["{{amount}}", "{{cost}}", "{{correlation", "{{entity_id}}", "{{actor_name}}"];
  for (const b of clientBlocks) {
    for (const f of FORBIDDEN) {
      assert.ok(!b.includes(f), `client template must not interpolate ${f}`);
    }
  }
});

// ─── NULL discipline ────────────────────────────────────────────────────────

test("every predicate coalesces — a NULL predicate caused a real fail-open incident here", () => {
  for (const fn of ["comms_is_external", "comms_is_staff", "comms_can_view",
                    "comms_can_admin", "comms_body_has_restricted_content"]) {
    const i = RUNME.indexOf(`create or replace function public.${fn}(`);
    const body = RUNME.slice(i, RUNME.indexOf("$$;", i));
    assert.ok(/coalesce\s*\(/i.test(body), `${fn} coalesces`);
    assert.ok(/returns boolean/.test(body), `${fn} returns boolean`);
  }
  assert.ok(RUNME.includes("does not coalesce — it can return NULL"),
    "the migration itself refuses to install a predicate that can return NULL");
});

test("comms_is_external fails CLOSED: an unknown user is EXTERNAL, not internal", () => {
  const body = fnBody("comms_is_external");
  // the coalesce default must be `true` (external), never `false`
  assert.ok(/coalesce\([\s\S]*,\s*true\)/.test(body),
    "the fallback for an unknown user is true (external)");
  assert.ok(!/coalesce\([\s\S]*,\s*false\)\s*;/.test(body),
    "it must never default to false — that would leak internal mail to an unknown identity");
  assert.ok(RUNME.includes("HUB FAIL: comms_is_external must default an unknown user to TRUE (external)"),
    "pinned by the migration self-test");
  assert.ok(POST.includes("C.external_fails_closed"), "and re-proved by the postcheck against live data");
});

test("the safety rules are surfaced, not swallowed: blocks are counted and auditable", () => {
  const health = fnBody("comms_health");
  assert.ok(/blocked_external_total/.test(health), "health exposes a blocked counter");
  assert.ok(/recipient_blocked_r1','content_blocked_r2/.test(health.replace(/\s+/g, "")) ||
            /recipient_blocked_r1'\s*,\s*'content_blocked_r2'/.test(health),
    "the counter reads the audit rows written by the two rules");
  assert.ok(POST.includes("C.blocked_recipients"), "postcheck reports them as INFO, not as a failure");
});

test("the legacy adapter cannot re-send a mirrored row (the classic double-send)", () => {
  const retry = fnBody("comms_retry");
  assert.ok(/legacy_delivery_id is not null/.test(retry), "mirrored rows are detected");
  assert.ok(/legacy_mirror_not_retryable/.test(retry), "and refused with a named reason");
  const imp = fnBody("comms_adapter_import_legacy");
  assert.ok(/status in \('sent','failed','bounced'\)/.test(imp), "only terminal legacy rows are mirrored");
  assert.ok(!/update public\.email_deliveries|insert into public\.email_deliveries|delete from public\.email_deliveries/i.test(imp),
    "the adapter never writes to the legacy queue");
});
