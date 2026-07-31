// ════════════════════════════════════════════════════════════════════════════
// THE authenticated CONTRACT ON public.notification_preferences
//
// WHY THIS FILE EXISTS
//   A production run of docs/communications_hub_RUNME.sql aborted before COMMIT
//   with "HUB FAIL: the revoke stripped authenticated of SELECT/UPDATE on
//   notification_preferences". That message named the wrong culprit. §13.b's
//   revokes are `from anon` and `from public`; neither can remove a grant whose
//   grantee is `authenticated`. What actually happened:
//
//     docs/phase0_migration.sql:781
//       grant update (portal_enabled, email_enabled, whatsapp_enabled)
//         on public.notification_preferences to authenticated;
//
//   UPDATE exists ONLY at COLUMN level. has_table_privilege() answers for the
//   table as a whole and is FALSE for a column-only grant — that is exactly why
//   PostgreSQL also ships has_any_column_privilege(). The guard, the preserve
//   loop and the PREFLIGHT probe were all built on the table-level question, so
//   all three were structurally unable to see the grant they were asserting.
//
// WHAT IS BEING LOCKED DOWN HERE
//   The contract, derived from the CODE rather than from that error message:
//     lib/portal/account.ts:32   GET   ?user_id=eq.<uid>&select=*   → table SELECT
//     lib/portal/account.ts:42   PATCH ?user_id=eq.<uid>            → UPDATE on
//         exactly portal_enabled, email_enabled, whatsapp_enabled, plus SELECT
//         again (lib/portal/client.ts:131 sends Prefer: return=representation)
//   INSERT is NOT part of it: the row is created at signup by the SECURITY
//   DEFINER trigger handle_new_user() (phase0_migration.sql:515), never by the
//   browser. DELETE is not part of it. No sequence, no function EXECUTE.
//
// SAFE: static only. Reads the SQL files off disk; no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
"use strict";

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
const ACCOUNT = R("lib/portal/account.ts");
const CLIENT = R("lib/portal/client.ts");
const PHASE0 = R("docs/phase0_migration.sql");

const stripComments = (sql) => sql.replace(/--[^\n]*/g, " ");
const flat = (s) => stripComments(s).replace(/\s+/g, " ");

const TABLE = "public.notification_preferences";
const PREF_COLS = ["portal_enabled", "email_enabled", "whatsapp_enabled"];
const GRANT_SELECT = `grant select on table ${TABLE} to authenticated`;
const GRANT_UPDATE = `grant update (${PREF_COLS.join(", ")}) on table ${TABLE} to authenticated`;

// ─── ASSERTIONS AS FUNCTIONS ────────────────────────────────────────────────
// Every check below takes the SQL text as an argument rather than closing over
// the file. That is what makes the non-vacuity section possible: the SAME
// assertion is re-run against a deliberately broken copy, and it must fail.
// A check that cannot be made to fail is not evidence of anything.

function assertDirectSelectGranted(runme) {
  assert.ok(
    flat(runme).includes(GRANT_SELECT),
    "§13.b must grant SELECT on the table DIRECTLY to authenticated — lib/portal/account.ts:32 " +
      "reads it through PostgREST with select=*, and account.ts:42 needs it again to return the " +
      "PATCHed row (Prefer: return=representation)"
  );
}

function assertDirectUpdateGranted(runme) {
  assert.ok(
    flat(runme).includes(GRANT_UPDATE),
    `§13.b must grant UPDATE on exactly (${PREF_COLS.join(", ")}) DIRECTLY to authenticated — ` +
      "lib/portal/account.ts:42 PATCHes exactly those three fields"
  );
}

// The grants must be DIRECT. `to public` would satisfy has_table_privilege()
// and leave the caller one PUBLIC revocation away from breaking — which is the
// hazard this whole section exists to remove.
function assertGrantsAreDirectNotPublic(runme) {
  const f = flat(runme);
  const re = new RegExp(
    `grant\\s+([a-z][a-z, ()_]*?)\\s+on\\s+table\\s+${TABLE.replace(".", "\\.")}\\s+to\\s+(\\w+)`,
    "gi"
  );
  const grantees = [...f.matchAll(re)].map((m) => m[2].toLowerCase());
  assert.ok(grantees.length > 0, "no grant on notification_preferences at all");
  for (const g of grantees) {
    assert.equal(
      g,
      "authenticated",
      `the contract is granted to '${g}'. A privilege reaching authenticated through PUBLIC is ` +
        "removed by the very revoke this section performs"
    );
  }
}

// The other half of an allowlist: nothing beyond the two entries.
function assertNoExtraPrivilegeGranted(runme) {
  const f = flat(runme);
  const re = new RegExp(
    `grant\\s+([a-z][a-z, ()_]*?)\\s+on\\s+table\\s+${TABLE.replace(".", "\\.")}\\s+to\\s+`,
    "gi"
  );
  for (const m of f.matchAll(re)) {
    const what = m[1].trim().toLowerCase();
    assert.ok(
      what === "select" || /^update\s*\(/.test(what),
      `§13.b grants '${what}' on notification_preferences. No code path uses it, so nothing would ` +
        "ever fail if it were wrong — that is a standing hole, not a spare capability"
    );
  }
}

// The verification must read the ACL, not has_table_privilege(): only the ACL
// can distinguish a DIRECT grant from an inherited one, and only pg_attribute
// can see a column-level grant at all.
function assertVerificationIsAclBasedAndColumnAware(runme) {
  const f = flat(runme);
  assert.match(f, /aclexplode\(c\.relacl\)/,
    "the table-level verification must read pg_class.relacl, so a grant inherited via PUBLIC cannot satisfy it");
  assert.match(f, /aclexplode\(at\.attacl\)/,
    "the column-level verification must read pg_attribute.attacl — the catalogue the failed guard never opened");
  assert.match(f, /a\.grantee = 'authenticated'::regrole/,
    "the verification must demand the grantee literally be `authenticated`");
  assert.match(f, /HUB FAIL: authenticated has no DIRECT table SELECT on notification_preferences/,
    "a missing direct SELECT must abort the migration, loudly and with the real reason");
  assert.match(f, /HUB FAIL: authenticated has no DIRECT column UPDATE on notification_preferences/,
    "a missing direct column UPDATE must abort the migration");
}

function assertForbiddenPrivilegesChecked(runme) {
  const f = flat(runme);
  for (const priv of ["TRUNCATE", "REFERENCES", "TRIGGER"]) {
    assert.ok(
      new RegExp(`'${priv}'`).test(f),
      `${priv} must be named in the forbidden list — TRUNCATE in particular is not restricted by RLS`
    );
  }
  assert.match(f, /has_any_column_privilege\('authenticated'/,
    "the forbidden check must also ask the COLUMN-level question, or a column grant slips past it");
  assert.match(f, /HUB FAIL: authenticated holds privilege\(s\) on notification_preferences that no code path/,
    "an unexpected privilege must abort the migration, not merely be reported");
}

function assertAnonAndPublicTakenToZero(runme) {
  const f = flat(runme);
  assert.match(f, /revoke all privileges on table public\.%I from anon/, "anon must be revoked");
  assert.match(f, /revoke all privileges on table public\.%I from public/, "PUBLIC must be revoked separately");
  assert.match(f, /revoke %s \(%I\) on table public\.%I from %s/,
    "column-level ACLs must be cleared too; a table-level revoke is not depended upon to reach them");
  assert.match(f, /HUB FAIL: anon\/PUBLIC still hold table OR COLUMN privilege\(s\) after the revoke/,
    "the result must be verified at BOTH granularities in the same transaction");
}

function assertRowIsolationChecked(runme) {
  const f = flat(runme);
  assert.match(f, /HUB FAIL: row level security is OFF on notification_preferences/,
    "a table privilege with RLS off exposes every row; that must abort");
  assert.match(f, /HUB FAIL: notification_preferences has a permissive policy that is not scoped/,
    "an unconditionally-true policy must abort — that is how one user rewrites another's row");
  assert.match(f, /HUB FAIL: notification_preferences has no own-row SELECT policy keyed on auth\.uid\(\)/,
    "cross-user READ must be structurally impossible");
  assert.match(f, /HUB FAIL: notification_preferences has no own-row UPDATE policy keyed on auth\.uid\(\)/,
    "cross-user WRITE must be structurally impossible");
  assert.match(f, /polwithcheck/,
    "a grant without a correct WITH CHECK is how a user rewrites someone else's row — it must be inspected");
}

// ─── 1. WHAT THE CALLER ACTUALLY NEEDS, READ FROM THE CODE ──────────────────

test("the caller reaches notification_preferences through PostgREST with a user JWT, not through an RPC", () => {
  assert.match(ACCOUNT, /pget<NotificationPreferences\[\]>\(`notification_preferences\?user_id=eq/,
    "getMyPrefs must still be a direct PostgREST read — if it became an RPC the table grant would be unnecessary");
  assert.match(ACCOUNT, /ppatch<NotificationPreferences\[\]>\(`notification_preferences\?user_id=eq/,
    "updateMyPrefs must still be a direct PostgREST write");
  // pget/ppatch carry the session access token, i.e. they execute as `authenticated`.
  assert.match(CLIENT, /rest\/v1\/\$\{query\}/, "pget/ppatch must still target PostgREST");
  assert.match(CLIENT, /representation: true/, "ppatch must still ask for the row back, which requires SELECT");
});

test("authenticated can read and update its own preferences: the RUNME grants exactly that, directly", () => {
  assertDirectSelectGranted(RUNME);
  assertDirectUpdateGranted(RUNME);
  assertGrantsAreDirectNotPublic(RUNME);
  assertVerificationIsAclBasedAndColumnAware(RUNME);
});

test("the updatable column set is exactly what account.ts patches — no wider, no narrower", () => {
  // The TypeScript signature is the source of truth for the column list.
  const sig = ACCOUNT.slice(ACCOUNT.indexOf("export async function updateMyPrefs"));
  for (const c of PREF_COLS) {
    assert.ok(new RegExp(`"${c}"`).test(sig), `account.ts no longer patches ${c}; the grant would be too wide`);
  }
  const patched = [...sig.matchAll(/"(\w+)"/g)].map((m) => m[1]).filter((n) => n.endsWith("_enabled"));
  assert.deepEqual(
    [...new Set(patched)].sort(),
    [...PREF_COLS].sort(),
    "account.ts patches a different set of columns than the RUNME grants"
  );
});

// ─── 2. FIRST-ROW CREATION ──────────────────────────────────────────────────

test("first-row creation is a SECURITY DEFINER trigger, so authenticated needs no INSERT", () => {
  // The specific question: does the preference centre CREATE a row on first use?
  // It does not. updateMyPrefs issues a PATCH; there is no POST anywhere.
  assert.ok(
    !/ppost<[^>]*>\(`notification_preferences/.test(ACCOUNT),
    "account.ts now POSTs to notification_preferences; that path needs an INSERT grant AND an INSERT policy, " +
      "and it has neither — it would fail silently for first-time users"
  );
  // The row comes from the signup trigger, which runs as the function owner.
  const trg = PHASE0.slice(PHASE0.indexOf("function public.handle_new_user()"));
  assert.match(trg, /insert into public\.notification_preferences \(user_id\) values \(new\.id\)/,
    "handle_new_user() no longer creates the preference row; first-time users would see blank toggles");
  assert.match(trg.slice(0, 300), /security definer/,
    "handle_new_user() must be SECURITY DEFINER, or the row creation itself would need a grant");
  // And older accounts were backfilled.
  assert.match(PHASE0, /insert into public\.notification_preferences \(user_id\)\s+select id from auth\.users/,
    "accounts predating Phase 0 must be backfilled, or their toggles render blank");
  // The RUNME must NOT hand out INSERT to paper over any of that.
  assertNoExtraPrivilegeGranted(RUNME);
  // And the operator is told to look.
  assert.match(PRE, /NP ROWS/, "PREFLIGHT must report whether any user is missing a preference row");
});

// ─── 3. CROSS-USER ACCESS ───────────────────────────────────────────────────

test("cannot read or update another user's row: row isolation is checked, not assumed", () => {
  assertRowIsolationChecked(RUNME);
  // The strongest guarantee is structural: user_id is not in the updatable set,
  // so the row cannot be re-pointed even if a policy were wrong.
  assert.ok(!PREF_COLS.includes("user_id"), "user_id must never be in the updatable column list");
  assert.match(flat(RUNME), /HUB FAIL: authenticated can UPDATE notification_preferences\.user_id/,
    "a writable user_id lets one user hand its preference row to another; that must abort");
  // Phase 0's policies are the ones the grant operates under.
  assert.match(PHASE0, /create policy "own prefs update" on public\.notification_preferences for update to authenticated/);
  assert.match(PHASE0, /using \(user_id = auth\.uid\(\) and public\.is_not_blocked\(\)\) with check \(user_id = auth\.uid\(\)\)/,
    "the UPDATE policy must carry a WITH CHECK keyed on auth.uid()");
});

test("POSTCHECK proves cross-user read and update are denied structurally", () => {
  for (const id of ["H.np_cross_user_read_denied", "H.np_cross_user_update_denied", "H.np_row_isolation_rls"]) {
    assert.ok(POST.includes(id), `POSTCHECK is missing ${id}`);
  }
  const tail = POST.slice(POST.indexOf("FATAL SUMMARY"));
  for (const id of ["H.np_cross_user_update_denied", "H.np_row_isolation_rls"]) {
    assert.ok(tail.includes(id), `${id} must be FATAL, not merely reported`);
  }
  assert.match(POST, /polwithcheck/, "the POSTCHECK must inspect WITH CHECK, not just USING");
});

// ─── 4/5. anon AND PUBLIC AT ZERO ───────────────────────────────────────────

test("anon has zero table grants, and PUBLIC has zero, at both granularities", () => {
  assertAnonAndPublicTakenToZero(RUNME);
  for (const id of ["H.np_anon_zero", "H.np_public_zero"]) {
    assert.ok(POST.includes(id), `POSTCHECK is missing ${id}`);
  }
  assert.ok(POST.slice(POST.indexOf("FATAL SUMMARY")).includes("H.np_anon_or_public_hold_privileges"),
    "anon/PUBLIC holding anything here must be FATAL");
  // Column ACLs specifically — the catalogue a table-only sweep never reads.
  assert.match(POST, /np_col_acl/, "POSTCHECK must read pg_attribute.attacl for anon and PUBLIC too");
});

// ─── 6. FORBIDDEN PRIVILEGES ────────────────────────────────────────────────

test("authenticated lacks TRUNCATE, REFERENCES and TRIGGER", () => {
  assertForbiddenPrivilegesChecked(RUNME);
  assert.ok(POST.includes("H.np_authenticated_forbidden_zero"), "POSTCHECK is missing the forbidden-privilege row");
  assert.ok(
    POST.slice(POST.indexOf("FATAL SUMMARY")).includes("H.np_authenticated_forbidden_privileges"),
    "a forbidden privilege must be FATAL"
  );
});

// ─── 7. A GRANT VIA PUBLIC MUST NOT SATISFY THE CHECK ───────────────────────

test("a privilege arriving via PUBLIC does not satisfy the check", () => {
  const f = flat(RUNME);
  // The required-privilege verification must not be satisfiable by
  // has_table_privilege() alone: that function answers true for an inherited
  // privilege, which is precisely the state the revoke destroys.
  // Anchored on a STATEMENT, not on a comment: flat() strips comments, so a
  // comment anchor would silently resolve to -1 and slice the whole file.
  const anchor = f.indexOf(GRANT_UPDATE);
  assert.ok(anchor > 0, "the allowlist grant must be present for this check to mean anything");
  const verify = f.slice(anchor);
  assert.match(verify, /a\.grantee = 'authenticated'::regrole/,
    "the required-privilege check must read the ACL grantee, or a PUBLIC-derived privilege would pass it");
  assert.ok(
    !/if not \(has_table_privilege\('authenticated', 'public\.notification_preferences', 'SELECT'\)/.test(f),
    "the old table-level-only guard is back; it cannot tell DIRECT from INHERITED"
  );
  // Same requirement in the POSTCHECK.
  const h = POST.slice(POST.indexOf("H.np_authenticated_direct_select"));
  assert.match(h, /to_regrole\('authenticated'\)::oid|grantee_name = 'authenticated'/,
    "the POSTCHECK must assert a DIRECT grant, not merely an effective one");
  assert.match(POST, /only EFFECTIVE, not DIRECT/,
    "the POSTCHECK must report the inherited case as a distinct, named failure");
});

// ─── 8/9/10/11. NON-VACUITY — BREAK IT, CONFIRM THE FAILURE, RESTORE ────────
// Each mutation below is surgical: exactly one thing is broken in a COPY of the
// file, the corresponding assertion must reject it, and the unmutated file must
// still pass afterwards. Without this, every assertion above could be a regex
// that matches nothing and reports success.

test("NON-VACUITY: removing the direct SELECT grant makes the SELECT check FAIL", () => {
  const mutant = RUNME.replace(GRANT_SELECT, "grant select on table public.some_other_table to authenticated");
  assert.notEqual(mutant, RUNME, "the mutation did not apply — the assertion below would prove nothing");
  assert.throws(() => assertDirectSelectGranted(mutant), /must grant SELECT on the table DIRECTLY/);
  // Surgical: the UPDATE half is untouched.
  assertDirectUpdateGranted(mutant);
  // Restore.
  assertDirectSelectGranted(RUNME);
});

test("NON-VACUITY: removing the direct column UPDATE grant makes the UPDATE check FAIL", () => {
  const mutant = RUNME.replace(GRANT_UPDATE, `grant update on table ${TABLE} to authenticated`);
  assert.notEqual(mutant, RUNME, "the mutation did not apply");
  assert.throws(() => assertDirectUpdateGranted(mutant), /must grant UPDATE on exactly/);
  // A table-wide UPDATE is not merely "different", it is WIDER: it would make
  // user_id and updated_at writable. The allowlist check must reject it too.
  assert.throws(() => assertNoExtraPrivilegeGranted(mutant), /grants 'update'/);
  assertDirectSelectGranted(mutant);
  assertDirectUpdateGranted(RUNME);
});

test("NON-VACUITY: an extra privilege makes the allowlist check FAIL", () => {
  const mutant = RUNME.replace(GRANT_SELECT, `${GRANT_SELECT}'; execute 'grant delete on table ${TABLE} to authenticated`);
  assert.notEqual(mutant, RUNME, "the mutation did not apply");
  assert.throws(() => assertNoExtraPrivilegeGranted(mutant), /grants 'delete'/);
  // Surgical: the two required grants are still found.
  assertDirectSelectGranted(mutant);
  assertDirectUpdateGranted(mutant);
  assertNoExtraPrivilegeGranted(RUNME);
});

test("NON-VACUITY: granting the contract to PUBLIC instead of authenticated makes the DIRECT check FAIL", () => {
  const mutant = RUNME.replace(GRANT_SELECT, `grant select on table ${TABLE} to public`);
  assert.notEqual(mutant, RUNME, "the mutation did not apply");
  assert.throws(() => assertGrantsAreDirectNotPublic(mutant), /the contract is granted to 'public'/);
  assert.throws(() => assertDirectSelectGranted(mutant), /must grant SELECT on the table DIRECTLY/);
  assertGrantsAreDirectNotPublic(RUNME);
});

test("NON-VACUITY: dropping the column-level probe makes the preserve check FAIL", () => {
  // This is the exact defect that aborted the production run: a preserve step
  // that only asks the table-level question cannot see phase0's column grant.
  const mutant = RUNME.replace(/has_column_privilege\('authenticated'/g, "has_table_privilege('authenticated'");
  assert.notEqual(mutant, RUNME, "the mutation did not apply");
  assert.throws(
    () => assertVerificationIsAclBasedAndColumnAware(RUNME.replace(/aclexplode\(at\.attacl\)/g, "aclexplode(x)")),
    /pg_attribute\.attacl/
  );
  assert.ok(
    !/has_column_privilege\('authenticated'/.test(mutant),
    "the mutant must genuinely have lost the column-level probe"
  );
  assertVerificationIsAclBasedAndColumnAware(RUNME);
});

test("NON-VACUITY: removing the anon/PUBLIC column revoke makes the zero check FAIL", () => {
  const mutant = RUNME.replace("revoke %s (%I) on table public.%I from %s", "-- removed");
  assert.notEqual(mutant, RUNME, "the mutation did not apply");
  assert.throws(() => assertAnonAndPublicTakenToZero(mutant), /column-level ACLs must be cleared too/);
  assertAnonAndPublicTakenToZero(RUNME);
});

// ─── 12/13. THE SAFETY CLAIMS THIS PACKAGE MUST NOT LOSE ────────────────────

test("the legacy mirror is never counted as live, and never live itself", () => {
  assert.match(RUNME, /comms_outbox_mirror_never_live_ck/, "the mirror-never-live constraint must exist");
  const tail = POST.slice(POST.indexOf("FATAL SUMMARY"));
  assert.ok(tail.includes("P.mirror_never_live"), "a mirrored row reading as live must be FATAL");
  assert.ok(tail.includes("D.legacy_mirror_is_terminal_only"), "a mirrored row must never be runnable");
  assert.match(AFV, /V5\.no_legacy_row_is_live/, "the after-failure verify must answer the same question");
});

test("nothing can send: every channel ships disabled and dry_run", () => {
  assert.match(RUNME, /HUB FAIL: email\/whatsapp must ship DISABLED/, "email/whatsapp must ship disabled");
  assert.match(RUNME, /HUB FAIL: every channel must ship dry_run = true/, "every channel must ship dry_run");
  assert.ok(POST.slice(POST.indexOf("FATAL SUMMARY")).includes("B.channels_safe"),
    "a channel that could send must be FATAL");
  assert.match(AFV, /V3\.channels_disabled/, "the after-failure verify must confirm it too");
});

test("the anonymous relay is closed, and the one allowlisted public RPC survives", () => {
  assert.match(RUNME, /revoke execute on function public\.%I\(%s\) from public/,
    "anonymous EXECUTE must be revoked from every communications function");
  assert.match(RUNME, /submit_opportunity_request\(text,text,text,text,text,text,jsonb,boolean\)/,
    "the single-entry function allowlist must still be named by signature");
  assert.ok(POST.slice(POST.indexOf("FATAL SUMMARY")).includes("G5.allowlisted_public_rpc_intact"),
    "breaking the one legitimate public form must be FATAL");
});

// ─── THE READ-ONLY FILES CARRY THE SAME STORY ───────────────────────────────

test("PREFLIGHT reports DIRECT and INHERITED separately, at table AND column granularity", () => {
  for (const marker of ["DIRECT · table-level", "DIRECT · column-level", "INHERITED", "absent"]) {
    assert.ok(PRE.includes(marker), `the PREFLIGHT privilege map is missing the '${marker}' state`);
  }
  assert.match(PRE, /aclexplode\(c\.relacl\)/, "DIRECT must be read from the ACL, not from information_schema");
  assert.match(PRE, /aclexplode\(at\.attacl\)/, "column-level DIRECT must be read from pg_attribute.attacl");
  assert.match(PRE, /NP CONTRACT/, "the PREFLIGHT must prove what notification_preferences actually needs");
  assert.match(PRE, /IF THOSE TWO DISAGREE/,
    "the PREFLIGHT must put the table-level and column-level answers side by side and say what a disagreement means");
});

test("AFTER_FAILURE_VERIFY reveals the trace of THIS attempt", () => {
  assert.match(AFV, /V8\.np_failure_fingerprint/, "the fingerprint of this specific failure must be reported");
  assert.match(AFV, /V8\.np_table_level_acl/, "the table-level ACL must be printed");
  assert.match(AFV, /V8\.np_column_level_acl/, "the column-level ACL — the one never read — must be printed");
  assert.match(AFV, /the revoke stripped authenticated of SELECT\/UPDATE/,
    "the exact error text must be quoted so the operator can match it to what they saw");
  assert.match(AFV, /NAMED THE WRONG CULPRIT/,
    "and it must say plainly that the message was wrong, rather than repeating it as fact");
  assert.match(AFV, /V8\.np_no_partial_privilege_state/, "it must show whether the abort left anything behind");
});

test("SAFE: static only (no DB/network)", () => {
  const self = R("tests/comms_notification_preferences_contract.test.js");
  for (const bad of ["node-fetch", "pg", "createClient", "https://"]) {
    assert.ok(!self.includes(`require("${bad}")`), `this test must not reach out via ${bad}`);
  }
  assert.ok(!/fetch\(/.test(self), "this test must not perform network calls");
});
