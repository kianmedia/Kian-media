// ════════════════════════════════════════════════════════════════════════════
// tests/comms_permissions.test.js — Communications Hub · PERMISSION MATRIX
//
// Proves, from the migration text and the route source, that authorization is
// real: the write surface is unreachable from a browser session, every
// authorized RPC re-checks inside the database, and anon holds nothing.
// No DB, no network, no email.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/communications_hub_RUNME.sql");
const POST = R("docs/communications_hub_POSTCHECK.sql");
const ROUTE = R("app/api/comms/process/route.ts");
const HUB_UI = R("components/portal/CommunicationsHub.tsx");

// ─── The matrix itself ──────────────────────────────────────────────────────

test("permission matrix: the hub defines its OWN predicates and does not gate on can_manage_projects", () => {
  for (const fn of ["comms_is_external", "comms_is_staff", "comms_can_view", "comms_can_admin"]) {
    assert.ok(new RegExp(`create or replace function public\\.${fn}\\s*\\(`).test(RUNME), `${fn} is defined`);
  }
  // The brief forbids gating this module on the project platform's predicate.
  const bodies = RUNME.split("create or replace function public.comms_can_");
  for (const b of bodies.slice(1)) {
    const head = b.slice(0, 600);
    assert.ok(!/can_manage_projects\s*\(/.test(head), "comms_can_* must not delegate to can_manage_projects()");
  }
});

test("permission matrix: view tier is wider than admin tier, and admin is strictly a subset", () => {
  const view = RUNME.slice(RUNME.indexOf("function public.comms_can_view"), RUNME.indexOf("function public.comms_can_admin"));
  const admin = RUNME.slice(RUNME.indexOf("function public.comms_can_admin"));
  // viewer roles
  for (const role of ["super_admin", "manager", "support", "readonly", "finance"]) {
    assert.ok(view.includes(`'${role}'`), `view tier includes ${role}`);
  }
  // admin roles: only super_admin + manager (+ account_type admin)
  const adminHead = admin.slice(0, 500);
  assert.ok(adminHead.includes("'super_admin'") && adminHead.includes("'manager'"), "admin tier is super_admin/manager");
  for (const role of ["support", "readonly", "finance"]) {
    assert.ok(!adminHead.includes(`'${role}'`), `admin tier must NOT include ${role}`);
  }
});

test("owner/manager can administer; support/readonly/finance can only read", () => {
  // Every mutating RPC gates on comms_can_admin, never on comms_can_view.
  for (const fn of ["comms_retry", "comms_cancel", "comms_channel_set",
                    "comms_template_publish", "comms_adapter_import_legacy"]) {
    const i = RUNME.indexOf(`function public.${fn}(`);
    assert.ok(i > -1, `${fn} exists`);
    const body = RUNME.slice(i, i + 1400);
    assert.ok(/if not public\.comms_can_admin\(\)/.test(body), `${fn} re-checks comms_can_admin()`);
    assert.ok(/'not_authorized'/.test(body), `${fn} returns an honest not_authorized`);
  }
  // Read RPCs gate on the view tier.
  for (const fn of ["comms_dashboard", "comms_health", "comms_preview"]) {
    const i = RUNME.indexOf(`function public.${fn}(`);
    const body = RUNME.slice(i, i + 1200);
    assert.ok(/if not public\.comms_can_view\(\)/.test(body), `${fn} re-checks comms_can_view()`);
  }
});

test("client denial: a client cannot read the outbox, the catalogue, the templates or the audit", () => {
  // RLS on every read surface uses a staff predicate, never `true`.
  const policies = [
    ["comms_outbox_read", "comms_can_view"],
    ["comms_channels_read", "comms_can_view"],
    ["comms_templates_read", "comms_can_view"],
    ["comms_catalog_read", "comms_is_staff"],
    ["comms_audit_read", "comms_can_admin"],
  ];
  for (const [policy, pred] of policies) {
    const i = RUNME.indexOf(`create policy ${policy}`);
    assert.ok(i > -1, `${policy} exists`);
    const body = RUNME.slice(i, i + 260);
    assert.ok(body.includes(`public.${pred}()`), `${policy} uses ${pred}()`);
    assert.ok(!/using \(true\)/.test(body), `${policy} must not be using (true)`);
  }
  // The one thing a non-staff user may touch is their OWN preference row.
  const own = RUNME.slice(RUNME.indexOf("create policy comms_prefs_own_read"), RUNME.indexOf("create policy comms_audit_read"));
  assert.ok(own.includes("user_id = auth.uid()"), "preferences are scoped to the owner of the row");
});

test("employee denial: an ordinary employee is not in the view tier by default", () => {
  const view = RUNME.slice(RUNME.indexOf("function public.comms_can_view"), RUNME.indexOf("function public.comms_can_admin"));
  // Membership is by an explicit role list — never "staff_role is not null".
  assert.ok(/staff_role in \(/.test(view), "view tier is an explicit allow-list of roles");
  assert.ok(!/staff_role is not null/.test(view), "an arbitrary staff_role must NOT grant dashboard access");
});

// ─── Direct API bypass ──────────────────────────────────────────────────────

test("direct API bypass: the write surface is REVOKED from authenticated and granted only to service_role", () => {
  const grants = RUNME.slice(RUNME.indexOf("-- SERVICE-ONLY"), RUNME.indexOf("-- Pure helpers"));
  for (const fn of ["comms_enqueue", "comms_claim", "comms_settle", "comms_reap",
                    "comms_resolve", "comms_rate_check", "comms_audit_write"]) {
    assert.ok(grants.includes(`public.${fn}(`), `${fn} is in the service-only grant loop`);
  }
  assert.ok(/revoke all on function %s from public, anon, authenticated/.test(grants),
    "service-only functions are revoked from authenticated as well as anon");
  assert.ok(/grant execute on function %s to service_role/.test(grants), "service_role keeps EXECUTE");
  // and the migration refuses to finish if that ever regresses
  assert.ok(RUNME.includes("HUB FAIL: % must not be callable by authenticated"), "self-test pins it");
});

test("direct API bypass: hiding a button is not authorization — the UI's own admin flag comes from the server", () => {
  // The dashboard's is_admin is whatever comms_dashboard() computed server-side.
  assert.ok(/is_admin.*public\.comms_can_admin\(\)/s.test(RUNME.slice(RUNME.indexOf("function public.comms_dashboard("))),
    "comms_dashboard computes is_admin from comms_can_admin()");
  assert.ok(/setIsAdmin\(dv\.is_admin\)/.test(HUB_UI), "the UI trusts the server's flag, not a local guess");
  // and every button it guards calls an RPC that re-checks anyway
  for (const call of ["commsRetry", "commsCancel", "commsChannelSet", "commsImportLegacy"]) {
    assert.ok(HUB_UI.includes(call), `${call} is wired`);
  }
});

test("direct API bypass: the drain route has exactly two doors and both are closed by default", () => {
  assert.ok(/CRON_SECRET/.test(ROUTE), "cron door");
  assert.ok(/rpcAsUser<boolean>\("comms_can_admin", \{\}, token\)/.test(ROUTE),
    "human door is verified IN THE DATABASE as that user, not inferred");
  assert.ok(/if \(!via\) return NextResponse\.json\(\{ ok: false, error: "unauthorized" \}, \{ status: 401 \}\)/.test(ROUTE),
    "no door ⇒ 401 and no work");
  // A missing CRON_SECRET must not accidentally authorize an empty token.
  const i = ROUTE.indexOf("const secret =");
  const body = ROUTE.slice(i, i + 400);
  assert.ok(/if \(secret && provided === secret\)/.test(body),
    "an unset CRON_SECRET can never match an empty provided token");
});

// ─── Anon ───────────────────────────────────────────────────────────────────

test("no anon grants: revoked on every table and every function, and pinned by a self-test", () => {
  assert.ok(/revoke all on table public\.%I from public, anon/.test(RUNME), "tables revoked from public+anon");
  assert.ok(RUNME.includes("HUB FAIL: anon/PUBLIC holds a grant on a comms_* table"), "table self-test");
  assert.ok(RUNME.includes("HUB FAIL: anon/PUBLIC holds EXECUTE on a comms_* function"), "function self-test");
  // grants to authenticated are SELECT-only except the user's own preferences
  assert.ok(/grant select on table public\.%I to authenticated/.test(RUNME), "authenticated gets SELECT only");
  assert.ok(/grant insert, update on table public\.comms_preferences to authenticated/.test(RUNME),
    "the only direct write is the user's own preference row");
  assert.ok(!/grant (insert|update|delete)[^\n]*comms_outbox[^\n]*authenticated/i.test(RUNME),
    "authenticated may never write the outbox directly");
  // POSTCHECK re-proves it against the live catalogue
  assert.ok(POST.includes("A.no_anon_comms_tables") && POST.includes("A.no_anon_comms_functions"),
    "postcheck re-proves anon exposure on the comms_* surface");
});

test("rate limiter table is unreachable: RLS on with no policy = deny all", () => {
  assert.ok(RUNME.includes("alter table public.comms_rate_counters  enable row level security"),
    "RLS is enabled on the counter table");
  assert.ok(!/create policy [a-z_]*rate/.test(RUNME), "no policy exists for it");
  assert.ok(/comms_rate_counters gets NO policy: RLS on with zero policies = deny all/.test(RUNME),
    "the intent is documented so nobody 'fixes' it later");
});

test("every SECURITY DEFINER function pins search_path, and the migration refuses otherwise", () => {
  const defs = RUNME.match(/security definer[^\n]*/g) ?? [];
  assert.ok(defs.length > 10, "there are SECURITY DEFINER functions to check");
  for (const d of defs) {
    assert.ok(/set search_path = public/.test(d), `unpinned search_path: ${d.trim().slice(0, 80)}`);
  }
  assert.ok(RUNME.includes("SECURITY DEFINER comms_* function(s) without a pinned search_path"),
    "self-test enforces it against the live catalogue too");
});
