// ════════════════════════════════════════════════════════════════════════════
// tests/mfa_foundation_s1.test.js — P2 · S1 · MFA FOUNDATION (INERT)
//
// S1 enforces nothing. It exists to carry the mode, to write audit rows safely, and
// above all to PROVE whether Postgres can see the `aal` claim in this project before
// any enforcement is written — `grep "auth\.jwt" docs/` returns zero hits across 169
// SQL files, so claim reading has never been demonstrated here.
//
// The pins below encode the lock-out-prevention rules. Several are deliberately
// inverted from this repo's usual instincts, and each carries the reason, because a
// future reviewer "correcting" them would create an outage:
//
//   - 'enforced' must be REJECTED BY A CHECK CONSTRAINT, not by convention.
//   - The writer gate is is_owner() ONLY. can_manage_projects() includes
//     staff_role='manager', which would let any manager disable MFA.
//   - activity_log.actor_role has a CLOSED CHECK that does NOT contain super_admin,
//     manager, custody_officer or finance. Passing a real staff role raises 23514 and
//     aborts the transaction — the exact log_activity failure this repo has hit before.
//     mfa_audit must always pass 'system'.
//   - NOTHING in this file may redefine a shared role gate. Those anchor ~50 RLS
//     SELECT policies; an assurance term there blanks the owner's screen with no error.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/mfa_foundation_batch_s1_RUNME.sql");
const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

const fnBody = (name) => {
  const i = code.indexOf(`function public.${name}`);
  assert.ok(i > 0, `${name} must be defined`);
  const s = code.indexOf("$$", i);
  return code.slice(s, code.indexOf("$$;", s + 2));
};

// ─── (A) 'enforced' is impossible, not merely discouraged ───────────────────

test("S1 the mode CHECK admits exactly off and enrollment", () => {
  const m = code.match(/check \(enforcement_mode in \(([^)]*)\)\)/i);
  assert.ok(m, "the constraint must exist");
  const vals = m[1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
  assert.deepEqual(vals, ["enrollment", "off"], "'enforced' must not be a legal value");
});

test("S1 the default mode is off", () => {
  assert.match(code, /enforcement_mode text not null default 'off'/i);
});

test("S1 the file never activates anything", () => {
  // A trailing "set enforcement_mode = 'enrollment'" would make running the file a
  // cutover. The only UPDATE touching the mode must be inside mfa_admin_set_mode, plus
  // the self-check's deliberate rejection probe.
  const updates = [...code.matchAll(/update public\.mfa_settings[\s\S]{0,120}?enforcement_mode\s*=\s*'([a-z]+)'/gi)]
    .map((m) => m[1]);
  assert.ok(!updates.includes("enrollment"), "running this file must not switch anything on");
});

test("S1 the self-check proves the constraint actually rejects enforced", () => {
  assert.match(code, /update public\.mfa_settings set enforcement_mode = 'enforced'/i,
    "it must ATTEMPT the illegal write");
  assert.match(code, /when check_violation then null/i, "and expect the constraint to stop it");
  assert.match(code, /raise exception 'فشل أمني: القيد قَبِل enforced/,
    "and fail loudly if the database accepted it");
});

// ─── (B) the writer gate cannot be widened by accident ──────────────────────

test("S1 only the owner can change the mode", () => {
  const f = fnBody("mfa_admin_set_mode");
  assert.match(f, /public\.is_owner\(\)/, "must gate on is_owner");
  assert.ok(!/can_manage_projects/.test(f),
    "can_manage_projects includes staff_role='manager' — any manager could disable MFA");
  assert.ok(!/is_staff\(\)/.test(f), "is_staff is far too wide for a security control");
});

test("S1 gate results are coalesced — NULL must not read as permission", () => {
  // is_owner()/is_staff() are `select a or b` and can return NULL. This repo's governing
  // incident was exactly that: false OR NULL = NULL, so `if not NULL then raise` never
  // fired and an unauthenticated caller read real company data.
  for (const fn of ["mfa_admin_set_mode", "mfa_settings_get"]) {
    assert.match(fnBody(fn), /coalesce\(public\.is_(owner|staff)\(\), false\)/,
      `${fn} must not let a NULL gate result pass`);
  }
});

test("S1 an unknown mode is rejected explicitly", () => {
  const f = fnBody("mfa_admin_set_mode");
  assert.match(f, /v_mode not in \('off','enrollment'\)/);
  assert.match(f, /raise exception/);
});

// ─── (C) the audit CHECK trap ───────────────────────────────────────────────

test("S1 mfa_audit passes a role value the CHECK actually permits", () => {
  const f = fnBody("mfa_audit");
  assert.match(f, /'system'/, "'system' is in activity_log.actor_role's closed CHECK");
  for (const role of ["super_admin", "manager", "custody_officer", "finance", "staff_role"]) {
    assert.ok(!new RegExp(role).test(f),
      `passing '${role}' would violate the actor_role CHECK, raise 23514 and abort the transaction`);
  }
});

test("S1 the actor_role CHECK really is closed and really lacks staff roles", () => {
  // Proves the test above is guarding something real rather than a hypothetical.
  const phase0 = R("docs/phase0_migration.sql");
  const m = phase0.match(/actor_role\s+text check \(actor_role in \(([\s\S]*?)\)\)/i);
  assert.ok(m, "the CHECK must exist");
  const vals = m[1].replace(/[\s'\n]/g, "").split(",");
  assert.ok(vals.includes("system"), "'system' must be legal");
  for (const role of ["super_admin", "manager", "custody_officer", "finance"]) {
    assert.ok(!vals.includes(role), `${role} is NOT permitted — that is why mfa_audit cannot pass it`);
  }
});

test("S1 a mode change that cannot be audited fails loudly", () => {
  const f = fnBody("mfa_admin_set_mode");
  assert.match(f, /perform public\.mfa_audit\('mode_changed'/);
  assert.ok(!/exception when others then null/i.test(f),
    "swallowing the audit would let the security mode change with no record of it");
});

// ─── (D) the probe must be incapable of breaking anything ───────────────────

test("S1 the probe is read-only and cannot raise", () => {
  const f = fnBody("mfa_claim_probe");
  assert.match(code, /function public\.mfa_claim_probe\(\)\s*\nreturns jsonb language plpgsql stable/i,
    "must be STABLE — it reads, never writes");
  assert.match(f, /exception when others then/, "it must have a terminal handler");
  assert.ok(!/insert into|update |delete from/i.test(f), "a probe must not mutate anything");
});

test("S1 the probe reads the GUC directly rather than depending on auth.jwt()", () => {
  const f = fnBody("mfa_claim_probe");
  assert.match(f, /current_setting\('request\.jwt\.claims', true\)/,
    "same data, no dependency on the auth schema wrapper existing");
  assert.match(f, /'aal',\s*v_j ->> 'aal'/, "the whole point is to report whether aal arrives");
});

test("S1 the probe's claim reads are individually exception-isolated", () => {
  const f = fnBody("mfa_claim_probe");
  const inner = (f.match(/begin v_\w+ :=[\s\S]{0,120}?exception when others then/g) ?? []).length;
  assert.ok(inner >= 2, `each read must be isolated; found ${inner}`);
});

// ─── (E) the architectural rule that prevents the worst lock-out ────────────

test("S1 redefines NO shared role gate", () => {
  // These anchor ~50 RLS SELECT policies and one RESTRICTIVE policy. An assurance term
  // in any of them blanks the owner's entire screen with no error message at all.
  const forbidden = ["is_admin", "is_owner", "is_staff", "staff_role",
                     "can_manage_projects", "staff_reads_all_projects", "pc_can_read_project"];
  for (const fn of forbidden) {
    assert.ok(
      !new RegExp(`create or replace function public\\.${fn}\\b`, "i").test(code),
      `${fn} must never be redefined here — reads are never gated on assurance`,
    );
  }
});

test("S1 defines no enforcement predicate yet", () => {
  assert.ok(!/function public\.mfa_ok/i.test(code), "S1 ships inert; enforcement is S4");
});

// ─── (F) privileges and safety envelope ─────────────────────────────────────

test("S1 anon can execute nothing, and the audit writer is service-only", () => {
  assert.match(code, /revoke all on function public\.mfa_claim_probe\(\)\s+from public, anon/i);
  assert.match(code, /revoke all on function public\.mfa_audit\(text,uuid,jsonb\)\s+from public, anon, authenticated/i);
  assert.match(code, /grant\s+execute on function public\.mfa_audit\(text,uuid,jsonb\)\s+to service_role/i);
});

test("S1 the settings table is RPC-only", () => {
  assert.match(code, /alter table public\.mfa_settings enable row level security/i);
  assert.match(code, /revoke all on table public\.mfa_settings from anon, authenticated/i);
  assert.ok(!/create policy[\s\S]{0,80}on public\.mfa_settings[\s\S]{0,60}for select/i.test(code),
    "no read policy — the RPC is the only door");
});

test("S1 the self-check verifies anon holds nothing", () => {
  assert.match(code, /has_function_privilege\('anon', p\.oid, 'execute'\)/i);
  assert.match(code, /raise exception 'فشل أمني: anon يملك EXECUTE/);
});

test("S1 is additive and idempotent", () => {
  assert.match(code, /create table if not exists public\.mfa_settings/i);
  assert.match(code, /on conflict \(id\) do nothing/i);
  assert.ok(!/\bdrop\s+(table|function|column|constraint)\b/i.test(code), "no DROP");
  assert.ok(!/\bdelete\s+from\b/i.test(code), "no data deletion");
  assert.ok(!/\btruncate\b/i.test(code), "no truncate");
});

test("S1 every SECURITY DEFINER function pins search_path", () => {
  const defs = (code.match(/security definer/gi) ?? []).length;
  const pinned = (code.match(/security definer set search_path = public/gi) ?? []).length;
  assert.equal(pinned, defs, `all ${defs} definer functions must pin search_path; ${pinned} do`);
});

test("S1 carries the break-glass card", () => {
  assert.match(SQL, /enforcement_mode = 'off' where id = 1/, "the instant-revert lever");
  assert.match(SQL, /delete from auth\.mfa_factors where user_id/, "and the lost-device recovery");
  assert.match(SQL, /Supabase/, "both must run on a credential path independent of the portal");
});

// ─── (G) no secret ever touches our storage ─────────────────────────────────

test("S1 stores no TOTP secret, code or token", () => {
  for (const f of ["secret", "totp_secret", "otp", "recovery_code", "backup_code"]) {
    assert.ok(!new RegExp(`\\b${f}\\b`, "i").test(code),
      `'${f}' must never appear — factors live in auth.mfa_factors, managed by GoTrue`);
  }
});

// ─── (H) S1b · the probe must be callable from a REAL session, not the SQL editor ──

const S1B = R("docs/mfa_probe_claims_s1b_RUNME.sql");
const ROUTE = R("app/api/admin/mfa-probe/route.ts");
const PAGE = R("app/client-portal/mfa-diagnostics/page.tsx");
const s1b = S1B.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

test("S1b the probe reports the four claims the owner asked to see", () => {
  for (const c of ["sub", "role", "aal", "session_id"]) {
    assert.match(s1b, new RegExp(`'${c}',\\s*v_j ->> '${c}'`), `must report ${c}`);
  }
});

test("S1b the probe is owner-gated, with NULL treated as denial", () => {
  assert.match(s1b, /coalesce\(public\.is_owner\(\), false\)/,
    "is_owner() is a bare OR and can return NULL; NULL must not read as permission");
});

test("S1b the signature is unchanged, so CREATE OR REPLACE cannot fork it", () => {
  const defs = s1b.match(/create or replace function public\.mfa_claim_probe\(([^)]*)\)/g) ?? [];
  assert.equal(defs.length, 1);
  assert.match(defs[0], /mfa_claim_probe\(\)/, "no parameters — a second signature would risk 42725");
});

test("S1b is read-only and leaks no claim content in errors", () => {
  assert.match(s1b, /stable security definer set search_path = public/i);
  assert.ok(!/insert into|update |delete from/i.test(s1b), "a probe must not mutate");
  assert.match(s1b, /'probe_error', sqlstate/, "errors surface a SQLSTATE, never the payload");
});

test("S1b the diagnostic route is owner-only and verifies identity properly", () => {
  assert.match(ROUTE, /authGetUserId\(bearer\)/, "identity comes from GoTrue, not from decoding the token");
  assert.ok(!/atob|Buffer\.from\([^)]*base64/.test(ROUTE),
    "decoding a JWT payload without verifying the signature is forgeable and must never gate access");
  assert.match(ROUTE, /rpcAsUser<boolean>\("is_owner", \{\}, bearer\)/);
  assert.match(ROUTE, /owner\.data !== true/, "a NULL or missing result must not pass");
  assert.match(ROUTE, /forbidden_owner_only/);
});

test("S1b the probe runs under the caller's own JWT — the entire point", () => {
  assert.match(ROUTE, /rpcAsUser<Record<string, unknown>>\("mfa_claim_probe", \{\}, bearer\)/,
    "rpcAsService would run as service_role and carry no session claims, answering the wrong question");
});

test("S1b neither the route nor the page logs a token or claim payload", () => {
  const logged = [...ROUTE.matchAll(/log\("[A-Z_]+",\s*\{([^}]*)\}/g)].map((m) => m[1]).join(" ");
  for (const f of ["sub", "session_id", "bearer", "access_token", "claims:", "probe.data"]) {
    assert.ok(!new RegExp(f.replace(/[.:]/g, "\\$&")).test(logged), `'${f}' must not be logged`);
  }
  assert.match(logged, /aal/, "only the assurance level and a boolean are logged");
  assert.ok(!/console\.(log|error)/.test(PAGE), "the page must not log anything");
  assert.ok(!/access_token/.test(PAGE.replace(/Authorization: `Bearer \$\{s\.access_token\}`/, "")),
    "the token is used for the request and never rendered or stored");
});

test("S1b the route is uncacheable", () => {
  assert.match(ROUTE, /no-store/);
});
