// ════════════════════════════════════════════════════════════════════════════
// tests/comms_anon_zero_access.test.js
// PHASE 1 — ANONYMOUS DIRECT ACCESS TO THE COMMUNICATIONS TABLES IS ZERO.
//
// The owner's decision this file encodes: an earlier pass revoked only
// REFERENCES / TRIGGER / TRUNCATE and deliberately left SELECT / INSERT /
// UPDATE / DELETE in place "in case a public form needs it". No caller ever
// used them. A privilege nothing exercises cannot be caught by a regression
// test, so it is not a spare capability — it is a standing hole. All seven
// table privilege types, plus the sequence privileges, are now revoked from
// BOTH anon and PUBLIC.
//
// STRUCTURE. Every coverage test is paired with a NON-VACUITY test that mutates
// the migration text and proves the same assertion then FAILS. A green check
// that cannot go red is not evidence, and this file refuses to ship one.
//
// No DB, no network, no email. Pure text analysis of the SQL package.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/communications_hub_RUNME.sql");
const PRE = R("docs/communications_hub_PREFLIGHT.sql");
const POST = R("docs/communications_hub_POSTCHECK.sql");
const AFV = R("docs/communications_hub_AFTER_FAILURE_VERIFY.sql");
const ROLLBACK = R("docs/communications_hub_ROLLBACK.sql");

// The seven table privilege types PostgreSQL defines. Named explicitly so that
// adding a type to this list is what forces a new assertion — the tests are
// driven by the list, never by whatever the file happens to mention.
const TABLE_PRIVS = ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"];
const SEQ_PRIVS = ["USAGE", "SELECT", "UPDATE"];
const GRANTEES = ["anon", "public"];

// ─── helpers ────────────────────────────────────────────────────────────────

const stripComments = (sql) => sql.replace(/--[^\n]*/g, " ");
const flat = (s) => stripComments(s).replace(/\s+/g, " ");

function block(sql, tag) {
  const start = sql.indexOf(`do $${tag}$`);
  const end = sql.indexOf(`end $${tag}$;`);
  assert.ok(start !== -1 && end > start, `RUNME must contain the $${tag}$ block`);
  return sql.slice(start, end);
}

// Parse every REVOKE in a block into {types, grantee, object}. `all privileges`
// expands to the full type list for that object class, which is how the file
// actually behaves.
function parseRevokes(blockText) {
  const out = [];
  const re = /revoke\s+(.+?)\s+on\s+(table|sequence)\s+[^\s]+\s+from\s+(anon|public)\b/gi;
  let m;
  const src = flat(blockText);
  while ((m = re.exec(src)) !== null) {
    const rawTypes = m[1].trim();
    const object = m[2].toLowerCase();
    const grantee = m[3].toLowerCase();
    let types;
    if (/^all(\s+privileges)?$/i.test(rawTypes)) {
      types = object === "sequence" ? [...SEQ_PRIVS] : [...TABLE_PRIVS];
    } else {
      types = rawTypes.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
    }
    out.push({ types: new Set(types), grantee, object });
  }
  return out;
}

// Which (privilege, grantee) pairs a set of parsed revokes covers, per object class.
function coverage(revokes, object) {
  const cov = {};
  for (const r of revokes) {
    if (r.object !== object) continue;
    for (const t of r.types) cov[`${t}|${r.grantee}`] = true;
  }
  return cov;
}

const TABLE_BLOCK = block(RUNME, "anon_tables");
const FN_BLOCK = block(RUNME, "anon_functions");
const TABLE_REVOKES = parseRevokes(TABLE_BLOCK);

// ─── 1. COVERAGE: one test per privilege type ───────────────────────────────

for (const priv of TABLE_PRIVS) {
  test(`anon holds no ${priv}: RUNME revokes ${priv} on the communications tables from anon AND PUBLIC`, () => {
    const cov = coverage(TABLE_REVOKES, "table");
    for (const g of GRANTEES) {
      assert.ok(
        cov[`${priv}|${g}`],
        `§13.b must revoke ${priv} on table from '${g}'. A privilege held via PUBLIC is not ` +
          `removed by revoking from anon, and vice versa — both statements are required.`
      );
    }
  });
}

// ─── 2. NON-VACUITY: the same assertion must be able to fail ────────────────
// Each test removes exactly one privilege type from the parsed revokes and
// proves the coverage check then reports that type as uncovered — while the
// other six stay covered. This is what distinguishes "the file revokes SELECT"
// from "my regex matches anything".

for (const priv of TABLE_PRIVS) {
  test(`non-vacuity for ${priv}: dropping ${priv} from the revokes makes the check FAIL, and only for ${priv}`, () => {
    const mutant = TABLE_REVOKES.map((r) => ({
      ...r,
      types: new Set([...r.types].filter((t) => t !== priv)),
    }));
    const cov = coverage(mutant, "table");

    for (const g of GRANTEES) {
      assert.ok(
        !cov[`${priv}|${g}`],
        `the ${priv} check is VACUOUS: it still passes for '${g}' after ${priv} was removed from every revoke`
      );
    }
    // The mutation must be surgical, not a wrecking ball. If removing one type
    // silenced the others, the detector is coupled and proves nothing per-type.
    for (const other of TABLE_PRIVS.filter((p) => p !== priv)) {
      for (const g of GRANTEES) {
        assert.ok(
          cov[`${other}|${g}`],
          `removing ${priv} must not affect ${other}/${g} — the per-type detector is coupled`
        );
      }
    }
  });
}

// ─── 3. SEQUENCES ───────────────────────────────────────────────────────────

for (const priv of SEQ_PRIVS) {
  test(`anon holds no sequence ${priv}: RUNME revokes it from anon AND PUBLIC`, () => {
    const cov = coverage(TABLE_REVOKES, "sequence");
    for (const g of GRANTEES) {
      assert.ok(
        cov[`${priv}|${g}`],
        `§13.b must revoke ${priv} on sequence from '${g}'. 'revoke all on table' does NOT ` +
          `reach a sequence, and comms_audit.id is an identity column that owns one.`
      );
    }
  });
}

test("non-vacuity for sequences: the sequence check fails when the sequence revokes are removed", () => {
  const mutant = TABLE_REVOKES.filter((r) => r.object !== "sequence");
  const cov = coverage(mutant, "sequence");
  for (const priv of SEQ_PRIVS) {
    for (const g of GRANTEES) {
      assert.ok(!cov[`${priv}|${g}`], `the sequence ${priv}/${g} check is vacuous`);
    }
  }
  // and the table coverage is untouched by that mutation
  const tcov = coverage(mutant, "table");
  for (const priv of TABLE_PRIVS) {
    assert.ok(tcov[`${priv}|anon`], "removing sequence revokes must not disturb table coverage");
  }
});

test("sequences are discovered through pg_depend, not by guessing a _id_seq name", () => {
  const f = flat(TABLE_BLOCK);
  assert.ok(/pg_depend/.test(f), "sequence discovery must join pg_depend");
  assert.ok(/relkind = 'S'/.test(f), "sequence discovery must filter relkind = 'S'");
  assert.ok(
    !/_id_seq/.test(f),
    "a hardcoded _id_seq name misses identity-column sequences, which are named by the server"
  );
});

// ─── 4. TABLE PRIVILEGES AND FUNCTION EXECUTE STAY IN SEPARATE STATEMENTS ───
// The brief's explicit requirement: revoking a table privilege must not
// accidentally break an allowlisted public RPC.

test("the table-revoke block never touches EXECUTE", () => {
  for (const r of parseRevokes(TABLE_BLOCK)) {
    assert.ok(!r.types.has("EXECUTE"), "§13.b must not revoke EXECUTE — that is §13.c's job");
  }
  assert.ok(
    !/revoke\s+[^;]*\bexecute\b[^;]*\bon\s+function/i.test(flat(TABLE_BLOCK)),
    "§13.b must contain no `revoke execute on function`"
  );
});

test("the function-allowlist block never touches a table or sequence privilege", () => {
  const f = flat(FN_BLOCK);
  assert.ok(!/revoke\s+[^;]*\bon\s+table\b/i.test(f), "§13.c must not revoke a table privilege");
  assert.ok(!/revoke\s+[^;]*\bon\s+sequence\b/i.test(f), "§13.c must not revoke a sequence privilege");
  assert.ok(/revoke execute on function/i.test(f), "§13.c must revoke EXECUTE on functions");
});

// ─── 5. THE PUBLIC-CALLABLE ALLOWLIST ───────────────────────────────────────

test("the allowlist is explicit, by name AND signature, and has exactly one entry", () => {
  const f = flat(FN_BLOCK);
  const m = f.match(/v_allowlist\s+text\[\]\s*:=\s*array\[(.*?)\]\s*;/i);
  assert.ok(m, "§13.c must declare an explicit v_allowlist array");
  // Split on QUOTED LITERALS, not on commas: every signature contains commas of
  // its own, so a comma split shreds one entry into eight and would report a
  // bare name as if the signature were missing.
  const entries = m[1].match(/'[^']*'/g) || [];
  assert.equal(entries.length, 1, `exactly one function may be public-callable, found: ${entries.join(" | ")}`);
  assert.ok(
    /^'submit_opportunity_request\(text,text,text,text,text,text,jsonb,boolean\)'$/.test(entries[0]),
    "the allowlist entry must carry a full signature, not just a bare name"
  );
});

test("the allowlisted RPC is verified SECURITY DEFINER with a pinned search_path", () => {
  const f = flat(FN_BLOCK);
  assert.ok(/prosecdef/.test(f), "the migration must assert the allowlisted RPC is SECURITY DEFINER");
  assert.ok(/search_path/.test(f), "the migration must assert its search_path is pinned");
  assert.ok(
    /HUB FAIL: the allowlisted public RPC is not SECURITY DEFINER/.test(f),
    "failing that assertion must abort the migration, not warn"
  );
});

test("the allowlisted RPC keeps anon EXECUTE — the table revoke must not break the public form", () => {
  assert.ok(
    /HUB FAIL: the allowlisted public RPC lost anon EXECUTE/.test(flat(FN_BLOCK)),
    "§13.c must abort if the opportunities form was collaterally broken"
  );
  assert.ok(
    /G5\.allowlisted_public_rpc_intact/.test(POST),
    "POSTCHECK must report the allowlisted RPC's survival"
  );
});

test("no unallowlisted communications function stays anon-callable", () => {
  assert.ok(
    /HUB FAIL: anon\/PUBLIC still hold EXECUTE on communications function\(s\)/.test(flat(FN_BLOCK)),
    "§13.c must verify its own result and abort on any leftover EXECUTE"
  );
});

test("authenticated is re-granted BEFORE PUBLIC is revoked, so staff RPCs survive", () => {
  const f = flat(FN_BLOCK);
  const grant = f.indexOf("grant execute on function public.%I(%s) to authenticated, service_role");
  const revoke = f.indexOf("revoke execute on function public.%I(%s) from public");
  assert.ok(grant !== -1 && revoke !== -1, "both statements must be present");
  assert.ok(
    grant < revoke,
    "authenticated is a member of PUBLIC; revoking from PUBLIC first would strip logged-in staff " +
      "of an RPC they only held via the default grant"
  );
});

// ─── 6. BOTH GRANTEES, ALWAYS ───────────────────────────────────────────────

test("every revoke names anon and PUBLIC separately — neither is assumed to cover the other", () => {
  const byGrantee = { anon: 0, public: 0 };
  for (const r of TABLE_REVOKES) byGrantee[r.grantee]++;
  assert.ok(byGrantee.anon > 0 && byGrantee.public > 0, "both grantees must be revoked from");
  assert.equal(
    byGrantee.anon,
    byGrantee.public,
    "an asymmetry means one grantee keeps a privilege the other lost — the classic silent survivor"
  );
});

// ─── 7. SCOPE: every named table is in range ────────────────────────────────

test("scope covers the five legacy tables and every comms_* table", () => {
  const f = flat(TABLE_BLOCK);
  for (const t of [
    "notifications",
    "notification_events",
    "notification_preferences",
    "notification_delivery_log",
    "email_deliveries",
  ]) {
    assert.ok(new RegExp(`'${t}'`).test(f), `${t} must be in scope`);
  }
  assert.ok(
    /relname like 'comms\\_%'/.test(f),
    "comms_* tables must be discovered from the catalogue, so a new one is covered automatically"
  );
});

// ─── 8. THE MIGRATION VERIFIES ITSELF, AND CANNOT PASS VACUOUSLY ────────────

test("§13.b verifies its own result in the same transaction, with no privilege_type filter", () => {
  const f = flat(TABLE_BLOCK);
  assert.ok(
    /HUB FAIL: anon\/PUBLIC still hold table privilege\(s\) after the revoke/.test(f),
    "the block must re-read the catalogue and abort if anything survived"
  );
  const verify = f.slice(f.indexOf("role_table_grants"));
  assert.ok(
    !/privilege_type\s+in\s*\(/i.test(verify),
    "the verification must NOT filter on privilege_type — that turns an allowlist back into a denylist"
  );
});

test("the RUNME self-test is non-vacuous: it aborts if the anon probe sees nothing anywhere", () => {
  assert.ok(
    /the anon privilege probe returned nothing anywhere in public/.test(RUNME),
    "a catalogue query that is broken returns zero rows exactly like a clean database; " +
      "the self-test must be able to tell those apart"
  );
});

test("the old three-type assertion is gone from the self-test", () => {
  assert.ok(
    !/still holds % REFERENCES\/TRIGGER\/TRUNCATE grant/.test(RUNME),
    "the self-test must no longer treat a residual SELECT/INSERT as an acceptable pre-existing condition"
  );
});

// ─── 9. THE READ-ONLY FILES REPORT ALL TYPES ───────────────────────────────

for (const priv of TABLE_PRIVS) {
  test(`POSTCHECK emits a dedicated row for ${priv}, even when clean`, () => {
    assert.ok(
      new RegExp(`G2\\.anon_zero_' \\|\\| lower\\(t\\.pt\\)`).test(POST) || /G2\.anon_zero_/.test(POST),
      "POSTCHECK must carry the per-type G2 family"
    );
    assert.ok(
      new RegExp(`'${priv}'`).test(POST),
      `${priv} must be named in the POSTCHECK's driving type list`
    );
  });
}

test("POSTCHECK's per-type check is LEFT JOINed off the type list, so a clean type still reports", () => {
  const g2 = POST.slice(POST.indexOf("G2.anon_zero_"));
  assert.ok(
    /left join information_schema\.role_table_grants/i.test(g2),
    "an inner join would make a clean privilege type disappear from the report entirely, " +
      "which is indistinguishable from never having checked it"
  );
});

test("POSTCHECK carries a per-type non-vacuity row", () => {
  assert.ok(/G3\.probe_sees_/.test(POST), "each per-type check needs a matching reach check");
  assert.ok(
    /may be vacuous/.test(POST),
    "the non-vacuity row must say plainly when a PASS carries no information"
  );
});

test("POSTCHECK's fatal summary fails on sequences, on a broken allowlist RPC, and on a vacuous probe", () => {
  const tail = POST.slice(POST.indexOf("FATAL SUMMARY"));
  assert.ok(/G4\.anon_zero_on_owned_sequences/.test(tail), "sequence leak must be fatal");
  assert.ok(/G5\.allowlisted_public_rpc_intact/.test(tail), "a broken public RPC must be fatal");
  assert.ok(/G3\.probe_is_vacuous/.test(tail), "a vacuous probe must be fatal, not silently green");
});

test("the POSTCHECK allowlist is a real allowlist and is empty", () => {
  const cte = POST.slice(POST.indexOf("allowed(table_name"), POST.indexOf("legacy_tables(t)"));
  assert.ok(/where false/.test(cte), "the allowlist must contain no entries");
  assert.ok(
    !/privilege_type\s+in\s*\('SELECT'/i.test(cte),
    "the allowlist must not degrade into a list of forbidden verbs"
  );
});

test("PREFLIGHT baselines sequences and proves its own probe is not blind", () => {
  assert.ok(/anon_grant_on_notification_sequence/.test(PRE), "sequences must be baselined too");
  assert.ok(/NON-VACUITY/.test(PRE), "the PREFLIGHT must state whether its probe can see anything at all");
  assert.ok(/PUBLIC CALLER/.test(PRE), "the PREFLIGHT must name the caller that must survive the revoke");
});

test("AFTER_FAILURE_VERIFY reports sequences and one row per privilege type", () => {
  assert.ok(/anon_on_sequences_owned_by_those_tables/.test(AFV), "sequences must appear in the diagnostic");
  assert.ok(/anon_' \|\| lower\(t\.pt\) \|\| '_on_communications_tables/.test(AFV), "per-type rows required");
  assert.ok(
    /left join information_schema\.role_table_grants/i.test(AFV),
    "clean types must still be listed, or the diagnostic hides what it checked"
  );
});

// ─── 10. THE ROLLBACK MUST NOT REOPEN THE HOLE ─────────────────────────────

test("the ROLLBACK never re-grants anything to anon or PUBLIC", () => {
  const f = flat(ROLLBACK);
  const grants = f.match(/grant\s+[^;]*?\bto\s+[^;]*?(anon|public)\b/gi) || [];
  assert.equal(
    grants.length,
    0,
    `removing the hub must not restore anonymous access as a side effect. Found: ${grants.join(" | ")}`
  );
  assert.ok(
    /DOES NOT RESTORE ANONYMOUS ACCESS/.test(ROLLBACK),
    "the rollback must state this decision explicitly rather than leaving it to inference"
  );
});

// ─── 11. THE PROVEN CONTEXT, RE-PROVEN AGAINST THE WORKING TREE ────────────
// The revoke is only safe because nothing calls these tables as anon. That is a
// claim about the repo, so it is tested against the repo — not trusted from a
// comment. If someone later adds a browser-side read of these tables, this test
// fails and the revoke gets revisited instead of silently breaking a page.

// This repo does NOT use the supabase-js `.from('table')` builder. It talks to
// PostgREST directly through lib/server/supabaseAdmin helpers, where the table
// name is the head of a URL path string: selectAsService("email_deliveries?...").
// An earlier version of this test scanned for `.from(` and found nothing, and
// would have reported "no direct access" for a repo that touches
// email_deliveries eight times. The non-vacuity test below is what caught that,
// which is precisely why every scan in this file is paired with one.
const TABLES = [
  "notifications",
  "notification_events",
  "notification_preferences",
  "notification_delivery_log",
  "email_deliveries",
];
// The seven comms_* TABLES, named exactly. A `comms_[a-z_]+` wildcard also
// matches the RPC names (comms_dashboard, comms_health, comms_retry, …), which
// are functions reached through prpc — not table access at all. Matching those
// produced a dozen false positives and would have buried a real finding.
const COMMS_TABLES = [
  "comms_channels",
  "comms_event_catalog",
  "comms_templates",
  "comms_outbox",
  "comms_preferences",
  "comms_rate_counters",
  "comms_audit",
];
// SERVICE identity — SERVICE_KEY, server-only, bypasses RLS. Never anon.
const SERVICE_HELPERS = ["selectAsService", "patchAsService", "rpcAsService", "insertAsService", "deleteAsService"];
// USER identity — lib/portal/client sends `Authorization: Bearer
// <session.access_token>`, so PostgREST resolves the role from the caller's JWT
// and runs as `authenticated`. The anon key travels in the apikey header, but it
// is the JWT that selects the role. rpcAsUser likewise forwards a user bearer.
// These callers are unaffected by a revoke aimed at anon and PUBLIC — but only
// as long as `authenticated` keeps its own explicit grant, which is asserted
// separately below.
const USER_HELPERS = ["pget", "ppatch", "ppost", "prpc", "rpcAsUser"];
const SERVER_HELPERS = [...SERVICE_HELPERS, ...USER_HELPERS];

function walkSources(dirs, exts = /\.(ts|tsx|js|jsx)$/) {
  const files = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".next") continue;
        walk(p);
      } else if (exts.test(e.name)) {
        files.push(p);
      }
    }
  };
  for (const d of dirs) walk(path.join(root, d));
  return files;
}

// Every direct PostgREST reference to a communications table, with the helper
// that issued it (or null when it is not wrapped in a known server helper).
function findTableReferences() {
  const names = [...TABLES, ...COMMS_TABLES].join("|");
  // A bare quoted word is NOT a table reference. "notifications" is also a UI tab
  // key in components/portal/nav.ts, a route segment, and the tail of an import
  // path — matching it produced five false positives that buried the real hits.
  // A reference counts only when it has PostgREST query shape (`table?...`) or is
  // the first argument to a known data-access helper.
  const queryShaped = new RegExp(`[\`"'](${names})\\?`, "g");
  const helperWrapped = new RegExp(
    `(${SERVER_HELPERS.join("|")})\\s*(?:<[^>]*>)?\\s*\\(\\s*[\`"'](${names})(?:[\`"'?])`,
    "g"
  );
  const refs = [];
  for (const p of walkSources(["app", "lib", "components"])) {
    const src = fs.readFileSync(p, "utf8");
    const file = path.relative(root, p);
    const seen = new Set();
    let m;
    // Helper-wrapped first, so a reference gets attributed to its helper.
    while ((m = helperWrapped.exec(src)) !== null) {
      seen.add(m.index + m[0].indexOf(m[2]));
      refs.push({ file, helper: m[1], table: m[2] });
    }
    while ((m = queryShaped.exec(src)) !== null) {
      const at = m.index + 1;
      if (seen.has(at)) continue; // already attributed to a helper
      // Attribute by looking back for a helper call on the same expression.
      const before = src.slice(Math.max(0, m.index - 120), m.index);
      const found = SERVER_HELPERS.filter((h) => new RegExp(`\\b${h}\\b[^;]*$`).test(before)).pop();
      refs.push({ file, helper: found || null, table: m[1] });
    }
    // The supabase-js builder is not used here today, but if someone introduces
    // it against these tables it must still be caught.
    for (const t of TABLES) {
      if (new RegExp(`\\.from\\(\\s*['"\`]${t}['"\`]`).test(src)) {
        refs.push({ file: path.relative(root, p), helper: "supabase-js .from()", table: t });
      }
    }
    for (const t of COMMS_TABLES) {
      if (new RegExp(`\\.from\\(\\s*['"\`]${t}['"\`]`).test(src)) {
        refs.push({ file: path.relative(root, p), helper: "supabase-js .from()", table: t });
      }
    }
  }
  return refs;
}

test("every direct reference to a communications table uses a SERVER identity, never anon", () => {
  const bad = findTableReferences().filter((r) => !SERVER_HELPERS.includes(r.helper));
  assert.deepEqual(
    bad.map((r) => `${r.file} → ${r.table} via ${r.helper || "an unrecognised caller"}`),
    [],
    "a caller reaches a communications table without a proven server-side identity. The Phase 1 " +
      "revoke takes anon to zero, so this would break at runtime. Route it through a SECURITY " +
      "DEFINER RPC rather than weakening the revoke."
  );
});

test("non-vacuity for the caller scan: the scanner actually finds the known references", () => {
  // If the walker or the regex were wrong, the test above would pass by finding
  // nothing at all. email_deliveries is genuinely read and patched by
  // lib/server/notifyWorker.ts and the notify-admin route, so the scanner MUST
  // see those. This is the assertion that caught the original blind scan.
  const refs = findTableReferences();
  assert.ok(
    refs.length > 0,
    "the scanner found no reference to any communications table anywhere — it is blind, so the " +
      "'server identity only' result above proves nothing"
  );
  assert.ok(
    refs.some((r) => r.table === "email_deliveries"),
    `the scanner must see the known email_deliveries callers; it found only: ${
      [...new Set(refs.map((r) => r.table))].join(", ") || "nothing"
    }`
  );
  assert.ok(
    refs.some((r) => /notifyWorker/.test(r.file)),
    "lib/server/notifyWorker.ts is a known caller and must appear in the scan"
  );
});

test("tables read with a user JWT keep an explicit `authenticated` grant", () => {
  // This is the failure mode the revoke could plausibly cause. lib/portal/comms.ts
  // reads comms_event_catalog and lib/portal/account.ts reads/writes
  // notification_preferences, both as `authenticated`. Revoking from anon and
  // PUBLIC is only safe for them because `authenticated` holds its OWN grant. If
  // §13 ever stops granting to authenticated, the portal breaks quietly — the
  // page would render an empty list rather than an error.
  const userTables = new Set(
    findTableReferences()
      .filter((r) => USER_HELPERS.includes(r.helper))
      .map((r) => r.table)
  );
  assert.ok(userTables.size > 0, "the scan must find the known user-JWT table reads");

  for (const t of userTables) {
    if (COMMS_TABLES.includes(t)) {
      assert.ok(
        /grant select on table public\.%I to authenticated/.test(flat(RUNME)),
        `${t} is read as authenticated, so §13 must grant SELECT to authenticated`
      );
    }
    // §13.b DOES revoke from `authenticated` on notification_preferences — that
    // is the normalisation that makes the end state exactly the allowlist. It is
    // only safe because the allowlist is re-granted UNCONDITIONALLY, in the same
    // transaction, immediately afterwards. Anything else revoked from
    // authenticated, or a revoke with no re-grant after it, breaks the caller.
    const f = flat(TABLE_BLOCK);
    const revokeAuth = [...f.matchAll(/revoke\s+(.+?)\s+on\s+table\s+(\S+)\s+from\s+authenticated/gi)];
    for (const m of revokeAuth) {
      assert.match(
        m[2],
        /notification_preferences/,
        `§13.b revoked from 'authenticated' on ${m[2]}, which has no proven contract; only ` +
          `notification_preferences is normalised, and only because every caller of it is known`
      );
    }
    if (revokeAuth.length > 0) {
      const lastRevoke = f.lastIndexOf("from authenticated");
      const grantSel = f.indexOf("grant select on table public.notification_preferences to authenticated");
      const grantUpd = f.indexOf(
        "grant update (portal_enabled, email_enabled, whatsapp_enabled) on table public.notification_preferences to authenticated"
      );
      assert.ok(grantSel > lastRevoke, "the direct SELECT must be re-granted AFTER the last revoke from authenticated");
      assert.ok(grantUpd > lastRevoke, "the direct column UPDATE must be re-granted AFTER the last revoke from authenticated");
    }
  }
});

// ★ REGRESSION (final cross-module audit) ★
// The test above proves §13.b never revokes FROM 'authenticated'. That is not
// the whole hazard. `authenticated` is a MEMBER of PUBLIC, so
// `revoke ... from public` strips any privilege authenticated holds only by
// INHERITANCE — without ever naming the role. §13.c already handles exactly
// that for FUNCTIONS (it re-grants to authenticated BEFORE revoking PUBLIC);
// the table block used to rely instead on a comment asserting the stock
// Supabase grant names authenticated directly. True in all likelihood, unproven
// in fact, and the failure mode is silent: the migration reports success and
// the account preferences screen starts returning empty rows.
test("§13.b preserves authenticated's EFFECTIVE privileges — at BOTH granularities — before revoking PUBLIC", () => {
  const f = flat(RUNME);

  const preserve = f.indexOf("grant %s on table public.%I to authenticated");
  const revoke = f.indexOf("revoke all privileges on table public.%I from public");
  assert.ok(preserve > 0, "§13.b does not preserve authenticated's inherited table privileges at all");
  assert.ok(revoke > 0, "§13.b no longer revokes table privileges from PUBLIC");
  assert.ok(preserve < revoke,
    "the preserve step runs AFTER the PUBLIC revoke — by then the privilege is already gone");

  // It must key off the EFFECTIVE privilege (has_table_privilege sees inherited
  // ones); reading information_schema alone would miss precisely the case that
  // matters.
  assert.match(f, /has_table_privilege\('authenticated'/,
    "the preserve step does not test the EFFECTIVE privilege, so it cannot see an inherited one");

  // ★ THE REGRESSION THAT ABORTED A PRODUCTION RUN ★
  // has_table_privilege() is TABLE-level only. phase0_migration.sql:781 grants
  // UPDATE on notification_preferences at COLUMN level, so a preserve step built
  // on has_table_privilege() alone silently skips it — and the guard built on the
  // same probe then blames a revoke that never named the role.
  assert.match(f, /has_column_privilege\('authenticated'/,
    "the preserve step cannot see a COLUMN-level grant; phase0_migration.sql:781 grants exactly one");
  assert.match(f, /grant %s \(%I\) on table public\.%I to authenticated/,
    "a column-level privilege must be restated column by column — re-granting it table-wide would WIDEN it");

  // And the false explanation must be gone.
  assert.ok(!/HUB FAIL: the revoke stripped authenticated of SELECT\/UPDATE on notification_preferences/.test(f),
    "the guard still blames a revoke that names only anon and public and cannot touch `authenticated`");
});

test("the PREFLIGHT proves the dependency the PUBLIC revoke rests on, at both granularities", () => {
  const pre = flat(PRE);
  assert.match(pre, /has_table_privilege\('authenticated'/,
    "PREFLIGHT does not measure authenticated's effective privileges before the change");
  assert.match(pre, /has_column_privilege\('authenticated'/,
    "PREFLIGHT cannot see a COLUMN-level grant, which is the state that aborted the last run");
  assert.match(pre, /has_any_column_privilege\('authenticated'/,
    "PREFLIGHT must print the table-level and column-level answers side by side, or the disagreement stays invisible");
  assert.match(pre, /INHERITED/,
    "PREFLIGHT does not distinguish a direct grant from one inherited via PUBLIC");
  assert.match(pre, /DIRECT · column-level/,
    "PREFLIGHT does not report a column-level grant as its own state");
  assert.ok(/lib\/portal\/account\.ts/.test(pre),
    "PREFLIGHT does not name the caller whose breakage is being ruled out");
  // Non-vacuity: an all-clear must not simply be a probe that matches nothing.
  assert.ok(/public\.profiles/.test(pre),
    "PREFLIGHT's privilege probe has no non-vacuity control");
  // All three roles, not just the one that broke.
  for (const role of ["anon", "authenticated", "PUBLIC"]) {
    assert.ok(new RegExp(`'${role}'`).test(pre), `PREFLIGHT's privilege map omits ${role}`);
  }
});

test("no browser component touches a communications table", () => {
  const inBrowser = findTableReferences().filter((r) => r.file.startsWith("components/"));
  assert.deepEqual(
    inBrowser.map((r) => `${r.file} → ${r.table}`),
    [],
    "a component runs with the anon/user key in the browser; direct table access there would " +
      "be broken by this revoke"
  );
});

test("the cron route reaches this data as service_role, never as anon", () => {
  const cron = R("app/api/cron/notify-email/route.ts");
  assert.ok(/rpcAsService/.test(cron), "the cron route must use the service identity");
  assert.ok(
    !/ANON_KEY/.test(cron),
    "a cron route holding the anon key would be broken by this revoke"
  );
});
