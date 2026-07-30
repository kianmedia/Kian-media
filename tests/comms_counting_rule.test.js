// ════════════════════════════════════════════════════════════════════════════
// tests/comms_counting_rule.test.js — THE COUNTING RULE.
//
//   A row counts as a LIVE SEND only on real evidence: provider acceptance or
//   delivery evidence. None of these may EVER count as live —
//     legacy_mirror · dry_run · imported · migrated · provider_unavailable ·
//     relay_handler_missing · queued · processing · retrying
//   — and each gets its own honestly named bucket instead.
//
// METHOD. These tests do not restate the rule in JavaScript and then check the
// restatement, which would prove nothing. They EXTRACT the actual
// `count(*) filter (where …)` predicates from public.comms_health as written in
// docs/communications_hub_RUNME.sql, parse them, and evaluate them over the
// whole space of plausible outbox rows. Delete a conjunct from the migration and
// the evaluated predicate changes and these tests fail — which is the only kind
// of test worth having here, given the module exists to stop forged success.
//
// No database, no network, no email. The parser deliberately understands only
// the small closed subset of SQL these predicates use; anything else throws,
// so a silently mis-extracted predicate becomes a loud failure.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const RUNME = fs.readFileSync(path.join(root, "docs/communications_hub_RUNME.sql"), "utf8");

// ─── Locate comms_health and strip its comments ─────────────────────────────
// An assertion that can be satisfied by prose is not an assertion. Every
// comms_* suite in this repo strips comments first; so does this one.
function healthBody() {
  const i = RUNME.indexOf("create or replace function public.comms_health(");
  assert.ok(i > -1, "comms_health exists");
  const open = RUNME.indexOf("as $$", i);
  const end = RUNME.indexOf("$$;", open + 5);
  assert.ok(open > i && end > open, "comms_health has a terminated body");
  return RUNME.slice(i, end).replace(/--[^\n]*/g, " ");
}
const HEALTH = healthBody();

/** The predicate of ONE `count(*) filter (where …)` bucket, by its jsonb key.
 *  Found by balanced-paren scan, so a predicate containing parentheses (they
 *  all do) is captured whole rather than truncated at the first ')'. That
 *  truncation is the exact bug that aborted the production run. */
function bucketPredicate(name) {
  const at = HEALTH.indexOf(`'${name}',`);
  assert.ok(at > -1, `comms_health reports a '${name}' bucket`);
  const f = HEALTH.indexOf("filter (where", at);
  assert.ok(f > -1, `'${name}' is a count(*) filter`);
  const open = HEALTH.indexOf("(", f);
  let depth = 0, i = open;
  for (; i < HEALTH.length; i++) {
    if (HEALTH[i] === "(") depth++;
    else if (HEALTH[i] === ")") { depth--; if (depth === 0) break; }
  }
  assert.ok(depth === 0, `'${name}' filter parentheses are balanced`);
  return HEALTH.slice(open + 1, i).trim().replace(/^where\s+/i, "");
}

// ─── A tiny, strict SQL boolean evaluator ───────────────────────────────────
function tokenize(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'") {
      let j = i + 1, v = "";
      while (j < s.length) {
        if (s[j] === "'" && s[j + 1] === "'") { v += "'"; j += 2; continue; }
        if (s[j] === "'") break;
        v += s[j]; j++;
      }
      out.push({ t: "str", v }); i = j + 1; continue;
    }
    if (c === "(" || c === ")" || c === ",") { out.push({ t: c }); i++; continue; }
    if (s.startsWith("<>", i)) { out.push({ t: "op", v: "<>" }); i += 2; continue; }
    if (c === "=") { out.push({ t: "op", v: "=" }); i++; continue; }
    const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(s.slice(i));
    if (m) { out.push({ t: "id", v: m[0].toLowerCase() }); i += m[0].length; continue; }
    throw new Error(`unsupported character ${JSON.stringify(c)} in predicate: ${s}`);
  }
  return out;
}

function parse(sql) {
  const tk = tokenize(sql);
  let p = 0;
  const peek = () => tk[p];
  const isId = (v) => tk[p] && tk[p].t === "id" && tk[p].v === v;
  const take = (t) => {
    if (!tk[p] || tk[p].t !== t) throw new Error(`expected ${t} at token ${p} of: ${sql}`);
    return tk[p++];
  };
  const value = () => {
    if (isId("coalesce")) {
      p++; take("("); const col = take("id").v; take(","); const dflt = take("str").v; take(")");
      return (row) => (row[col] === null || row[col] === undefined ? dflt : row[col]);
    }
    const col = take("id").v;
    return (row) => {
      if (!(col in row)) throw new Error(`predicate reads unknown column ${col}`);
      return row[col];
    };
  };
  const primary = () => {
    if (peek() && peek().t === "(") { p++; const e = expr(); take(")"); return e; }
    const v = value();
    // comparison?
    if (peek() && peek().t === "op") {
      const op = take("op").v; const lit = take("str").v;
      return (row) => (op === "=" ? v(row) === lit : v(row) !== lit);
    }
    let negated = false;
    if (isId("not") && tk[p + 1] && tk[p + 1].t === "id" && tk[p + 1].v === "in") { negated = true; p++; }
    if (isId("in")) {
      p++; take("("); const set = [take("str").v];
      while (peek() && peek().t === ",") { p++; set.push(take("str").v); }
      take(")");
      return (row) => (negated ? !set.includes(v(row)) : set.includes(v(row)));
    }
    // bare boolean column
    return (row) => {
      const b = v(row);
      if (typeof b !== "boolean") throw new Error("expected a boolean column in predicate");
      return b;
    };
  };
  const notExpr = () => { if (isId("not")) { p++; const e = notExpr(); return (row) => !e(row); } return primary(); };
  const andExpr = () => {
    let e = notExpr();
    while (isId("and")) { p++; const r = notExpr(); const l = e; e = (row) => l(row) && r(row); }
    return e;
  };
  const expr = () => {
    let e = andExpr();
    while (isId("or")) { p++; const r = andExpr(); const l = e; e = (row) => l(row) || r(row); }
    return e;
  };
  const e = expr();
  if (p !== tk.length) throw new Error(`unconsumed tokens in predicate: ${sql}`);
  return e;
}

const BUCKETS = ["sent_live", "delivered", "sent_dry_run", "mirrored_legacy", "imported",
                 "provider_unavailable", "relay_handler_missing", "claimed_sent_without_evidence",
                 "queued", "processing", "retrying", "failed", "dead_letter", "cancelled"];
const PRED = Object.fromEntries(BUCKETS.map((b) => [b, parse(bucketPredicate(b))]));
const LIVE = ["sent_live", "delivered"];
/** Explicitly the categories the brief forbids from ever counting as live. */
const NEVER_LIVE = ["sent_dry_run", "mirrored_legacy", "imported", "provider_unavailable",
                    "relay_handler_missing", "claimed_sent_without_evidence",
                    "queued", "processing", "retrying"];

// ─── The row space ──────────────────────────────────────────────────────────
// Every combination the database can actually hold. delivery_mode and
// is_legacy_mirror are DERIVED here exactly as the CHECK constraints in §2.4b
// force them to be, and rows R0 forbids are excluded — modelling states the
// database rejects would prove nothing about the states it accepts.
const STATUSES = ["queued", "processing", "retrying", "sent", "delivered", "failed", "dead_letter", "cancelled"];
const SOURCES = ["native", "legacy_mirror", "imported"];
const PSTATES = ["none", "attempted", "accepted", "delivered", "unavailable", "relay_handler_missing"];
const PROVIDERS = [null, "relay", "legacy_email_deliveries"];

function rowSpace({ adversarial }) {
  const rows = [];
  for (const status of STATUSES)
    for (const dry_run of [true, false])
      for (const declared of SOURCES)
        for (const provider_state of PSTATES)
          for (const provider of PROVIDERS) {
            if (adversarial) {
              // Every combination the columns can physically hold, INCLUDING the
              // ones the CHECK constraints and the guard trigger forbid — so
              // is_legacy_mirror varies independently of source_kind (that pair
              // is tied only by comms_outbox_provenance_consistent_ck). These
              // are the states defence in depth exists for: reachable only if a
              // constraint is dropped or a trigger disabled, and a conjunct that
              // earns its keep only there is still earning it.
              for (const is_legacy_mirror of [true, false])
                rows.push({ status, dry_run, source_kind: declared, is_legacy_mirror,
                            provider_state, provider,
                            delivery_mode: dry_run ? "dry_run" : "live" });
              continue;
            }
            // The states the database can actually reach, derived exactly as
            // comms_outbox_guard() derives them and filtered by R0.
            const is_legacy_mirror =
              declared === "legacy_mirror" || provider === "legacy_email_deliveries";
            const source_kind = is_legacy_mirror ? "legacy_mirror" : declared;
            if (is_legacy_mirror && ["accepted", "delivered"].includes(provider_state)) continue;
            rows.push({ status, dry_run, source_kind, is_legacy_mirror, provider_state, provider,
                        delivery_mode: dry_run ? "dry_run" : "live" });
          }
  return rows;
}
const ROWS = rowSpace({ adversarial: false });
const ROWS_ADVERSARIAL = rowSpace({ adversarial: true });
const buckets = (row) => BUCKETS.filter((b) => PRED[b](row));
const isLive = (row) => LIVE.some((b) => PRED[b](row));
const describe = (r) =>
  `status=${r.status} dry_run=${r.dry_run} source_kind=${r.source_kind} provider_state=${r.provider_state} provider=${r.provider}`;

test("the row space is real and the predicates were extracted, not guessed", () => {
  assert.ok(ROWS.length > 500, `the property tests cover ${ROWS.length} rows`);
  // Non-vacuity: at least one row IS live, otherwise "nothing is live" would
  // make every exclusion test below pass for the wrong reason.
  assert.ok(ROWS.some(isLive), "some row in the space does count as a live send");
  assert.ok(ROWS.some((r) => !isLive(r)), "and some row does not");
});

// ─── The nine categories that may never count as live ───────────────────────

test("a legacy mirrored row is NEVER counted as a live send", () => {
  const mirrors = ROWS.filter((r) => r.is_legacy_mirror || r.provider === "legacy_email_deliveries");
  assert.ok(mirrors.length > 0, "the space contains mirrored rows");
  for (const r of mirrors) assert.ok(!isLive(r), `mirrored row counted live: ${describe(r)}`);
  // and it is reported under its own name rather than vanishing
  for (const r of mirrors) assert.ok(PRED.mirrored_legacy(r), `mirror not reported: ${describe(r)}`);
});

test("a dry_run row is NEVER counted as a live send", () => {
  const dry = ROWS.filter((r) => r.dry_run);
  assert.ok(dry.length > 0);
  for (const r of dry) assert.ok(!isLive(r), `dry_run row counted live: ${describe(r)}`);
  // a simulated terminal row is reported as a simulation, not as nothing
  for (const r of dry.filter((x) => ["sent", "delivered"].includes(x.status) && !x.is_legacy_mirror))
    assert.ok(PRED.sent_dry_run(r), `simulated send not reported: ${describe(r)}`);
});

test("relay_handler_missing is NEVER live — an undeployed Apps Script is not a delivery", () => {
  const rows = ROWS.filter((r) => r.provider_state === "relay_handler_missing");
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(!isLive(r), `relay_handler_missing counted live: ${describe(r)}`);
  for (const r of rows) assert.ok(PRED.relay_handler_missing(r), "and it has its own bucket");
});

test("provider_unavailable is NEVER live", () => {
  const rows = ROWS.filter((r) => r.provider_state === "unavailable");
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(!isLive(r), `provider_unavailable counted live: ${describe(r)}`);
  for (const r of rows.filter((x) => !x.is_legacy_mirror))
    assert.ok(PRED.provider_unavailable(r), "and it has its own bucket");
});

test("an imported row is NEVER live", () => {
  const rows = ROWS.filter((r) => r.source_kind === "imported");
  assert.ok(rows.length > 0);
  for (const r of rows) assert.ok(!isLive(r), `imported row counted live: ${describe(r)}`);
  for (const r of rows) assert.ok(PRED.imported(r), "and it has its own bucket");
});

test("a row that is not in a terminal success state is NEVER live", () => {
  for (const r of ROWS.filter((x) => ["queued", "processing", "retrying", "failed", "dead_letter", "cancelled"].includes(x.status)))
    assert.ok(!isLive(r), `non-terminal row counted live: ${describe(r)}`);
});

// ─── Evidence is required, in both directions ───────────────────────────────

test("'sent' counts as live ONLY with real provider evidence", () => {
  for (const r of ROWS.filter((x) => PRED.sent_live(x))) {
    assert.ok(["accepted", "delivered"].includes(r.provider_state),
      `sent_live without provider evidence: ${describe(r)}`);
    assert.strictEqual(r.status, "sent");
    assert.strictEqual(r.source_kind, "native");
    assert.strictEqual(r.dry_run, false);
    assert.notStrictEqual(r.provider, "legacy_email_deliveries");
  }
  // and the converse: a native live 'sent' WITH evidence is actually counted,
  // otherwise the rule would be "nothing is ever live", which is not honesty.
  assert.ok(PRED.sent_live({ status: "sent", dry_run: false, delivery_mode: "live", source_kind: "native",
                             is_legacy_mirror: false, provider_state: "accepted", provider: "relay" }),
    "a genuine acknowledged send IS counted live");
});

test("'delivered' requires DELIVERY evidence — acceptance is not delivery", () => {
  for (const r of ROWS.filter((x) => PRED.delivered(x))) {
    assert.strictEqual(r.provider_state, "delivered", `delivered without delivery evidence: ${describe(r)}`);
    assert.strictEqual(r.status, "delivered");
  }
  const acceptedOnly = { status: "delivered", dry_run: false, delivery_mode: "live", source_kind: "native",
                         is_legacy_mirror: false, provider_state: "accepted", provider: "relay" };
  assert.ok(!PRED.delivered(acceptedOnly), "an accepted-but-unconfirmed row is not reported as delivered");
  assert.ok(PRED.claimed_sent_without_evidence(acceptedOnly),
    "and it is surfaced as a claim without evidence rather than silently dropped");
});

test("a claim of success with no evidence at all is surfaced, never counted", () => {
  const forged = { status: "sent", dry_run: false, delivery_mode: "live", source_kind: "native",
                   is_legacy_mirror: false, provider_state: "none", provider: "relay" };
  assert.ok(!isLive(forged), "a bare claim is not a live send");
  assert.ok(PRED.claimed_sent_without_evidence(forged), "it is reported under its own name");
});

// ─── No double counting ─────────────────────────────────────────────────────

test("no double counting: live and never-live are disjoint for every possible row", () => {
  for (const r of ROWS) {
    if (!isLive(r)) continue;
    for (const b of NEVER_LIVE)
      assert.ok(!PRED[b](r), `row counted BOTH live and ${b}: ${describe(r)}`);
  }
});

test("no double counting: sent_live and delivered never fire on the same row", () => {
  for (const r of ROWS)
    assert.ok(!(PRED.sent_live(r) && PRED.delivered(r)), `counted twice: ${describe(r)}`);
});

test("no double counting: the never-live delivery buckets do not overlap each other", () => {
  const exclusive = ["sent_dry_run", "mirrored_legacy", "sent_live", "delivered"];
  for (const r of ROWS) {
    const hits = exclusive.filter((b) => PRED[b](r));
    assert.ok(hits.length <= 1, `row is in ${hits.join(" + ")}: ${describe(r)}`);
  }
});

test("every native live terminal row lands in EXACTLY ONE of the three outcome buckets", () => {
  // Totality matters as much as disjointness: a row that falls through every
  // bucket is invisible on the dashboard, and invisible is how a problem is
  // discovered by a client instead of by us.
  for (const r of ROWS.filter((x) => x.source_kind === "native" && !x.dry_run &&
                                     ["sent", "delivered"].includes(x.status))) {
    const hits = ["sent_live", "delivered", "claimed_sent_without_evidence"].filter((b) => PRED[b](r));
    assert.strictEqual(hits.length, 1, `expected exactly one bucket, got [${hits}]: ${describe(r)}`);
  }
});

test("live_total is the SUM of the two disjoint live buckets and nothing else", () => {
  const m = HEALTH.match(/'live_total',([\s\S]*?);/);
  assert.ok(m, "live_total is computed in comms_health");
  assert.match(m[1], /coalesce\(\(v->>'sent_live'\)::int, 0\) \+ coalesce\(\(v->>'delivered'\)::int, 0\)/,
    "live_total is sent_live + delivered");
  for (const b of NEVER_LIVE)
    assert.ok(!m[1].includes(b), `live_total absorbs the ${b} bucket`);
});

// ─── The exclusions are load-bearing: remove one and a non-send goes live ───

test("each exclusion on sent_live is REQUIRED — removing it lets a non-send through", () => {
  const src = bucketPredicate("sent_live");
  const conjuncts = [
    "source_kind = 'native'",
    "not is_legacy_mirror",
    "delivery_mode = 'live'",
    "provider_state in ('accepted','delivered')",
    "coalesce(provider,'') <> 'legacy_email_deliveries'",
  ];
  for (const c of conjuncts) {
    assert.ok(src.includes(c), `sent_live still carries: ${c}`);
    // Delete exactly this conjunct and prove the weakened predicate now admits
    // a row it must refuse. Evaluated over the ADVERSARIAL space on purpose:
    // several of these conjuncts are redundant while every constraint holds —
    // that redundancy IS the defence in depth, and a test that only looked at
    // constraint-satisfying rows would call them decoration and invite their
    // removal, which is how a single dropped CHECK becomes a forged success.
    const weakened = parse(src.replace(new RegExp(`\\s*and\\s+${c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), ""));
    const admitted = ROWS_ADVERSARIAL.filter((r) => weakened(r) && !PRED.sent_live(r));
    assert.ok(admitted.length > 0,
      `removing "${c}" changes nothing — it is decoration, not an exclusion`);
    // and what it lets through must be something that is genuinely not a send
    assert.ok(admitted.some((r) => r.is_legacy_mirror || r.dry_run ||
                                   r.source_kind !== "native" ||
                                   !["accepted", "delivered"].includes(r.provider_state) ||
                                   r.provider === "legacy_email_deliveries"),
      `removing "${c}" admits only genuine sends — the conjunct is misdescribed`);
  }
});
