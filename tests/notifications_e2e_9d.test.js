// ════════════════════════════════════════════════════════════════════════════
// tests/notifications_e2e_9d.test.js — BATCH 9D
// Contract analysis (no DB, no real email) proving the three proven-broken
// journeys are repaired end to end: PROJECT PREVIEW, CUSTODY SELF-ISSUE/RETURN,
// RENTAL — via a CANONICAL resolver, immediate email, and a delivery trace.
// Composition only: no third notifications table, no parallel system.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const SQL = R("docs/notifications_e2e_repair_batch9d_RUNME.sql");
const ROUTE_PROJ = R("app/api/integrations/project/notify/route.ts");
const ROUTE_ADMIN = R("app/api/integrations/project/notify-admin/route.ts");
const ROUTE_CUST = R("app/api/integrations/custody-inventory/notify/route.ts");
const ROUTE_RENT = R("app/api/integrations/rental/notify/route.ts");
const ROUTE_CRON = R("app/api/cron/notify-email/route.ts");
const WORKER = R("lib/server/notifyWorker.ts");
const PROJNOTIFY = R("lib/server/projectNotify.ts");
const NOTIFYEMAIL = R("lib/portal/notifyEmail.ts");
const PROJCORE = R("lib/portal/projectCore.ts");
const MONITOR = R("components/portal/projectcore/NotifyMonitor.tsx");
const ADMIN_DLV = R("components/portal/AdminDeliverables.tsx");
const EDITOR_DLV = R("components/portal/EditorDeliverables.tsx");
const VERSIONS = R("components/portal/VersionHistory.tsx");

const codeOf = (sql) => sql.split("\n").map((l) => { const i = l.indexOf("--"); return i >= 0 ? l.slice(0, i) : l; }).join("\n");
function fnBody(sql, name) {
  const i = sql.indexOf("function public." + name + "(");
  if (i < 0) return "";
  // Detect the actual opening dollar-quote tag ($$ or $rn$ etc.) after "as".
  const m = sql.slice(i).match(/\bas\s+(\$[a-z0-9_]*\$)/i);
  if (!m) return "";
  const tag = m[1];
  const bodyStart = i + m.index + m[0].length;
  const close = sql.indexOf(tag, bodyStart);
  return close < 0 ? sql.slice(bodyStart) : sql.slice(bodyStart, close);
}
const CODE = codeOf(SQL);

// ─── 1. RUNME structure + composition (no third table, no parallel) ───
test("RUNME: preflight + transactional + self-test + schema reload", () => {
  assert.match(SQL, /do \$pre\$/); assert.match(SQL, /9D PREFLIGHT:/);
  assert.match(SQL, /\bbegin;/); assert.match(SQL, /\bcommit;/);
  assert.match(SQL, /9D FAIL/); assert.match(SQL, /notify pgrst, 'reload schema'/);
});
test("composition: reuses notifications inbox; only telemetry table is created", () => {
  assert.ok(SQL.includes("public.notify(")); // reuses the existing inbox writer
  const created = [...CODE.matchAll(/create table if not exists (public\.\w+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(created, ["public.notification_delivery_log"], "only the delivery-trace telemetry table is created");
  assert.ok(!/create table[^;]*public\.notifications\b/.test(CODE), "does not recreate a notifications table");
});

// ─── 2. Canonical resolver: management via auth.users (the management-miss fix) ───
test("resolver: management = admin OR super_admin, email via auth.users (fixes null profiles.email)", () => {
  const b = fnBody(SQL, "notification_resolve_recipients");
  assert.ok(b.includes("auth.users"), "reads auth.users for authoritative email");
  assert.ok(b.includes("account_type = 'admin'") && b.includes("staff_role = 'super_admin'"), "owner/super_admin/admin management set");
  assert.ok(b.includes("coalesce(nullif(btrim(au.email"), "prefers auth.users email over profiles.email");
  assert.ok(b.includes("'custody_officer'") && b.includes("'finance'"), "resolves custody officer + finance");
  assert.ok(b.includes("project_client_user_ids"), "client via explicit allowlist");
  assert.ok(b.includes("custody_rental_customers"), "renter via own contract");
});
test("resolver: client only for client-facing events; renter only for rental.*", () => {
  const b = fnBody(SQL, "notification_resolve_recipients");
  assert.ok(b.includes("v_client_facing") && b.includes("deliverable.preview_sent"), "client gated to client-facing events");
  assert.ok(/left\(p_event, ?7\) = 'rental\.'/.test(b), "renter gated to rental events");
});
test("resolver: service-only (revoked from authenticated)", () => {
  const g = SQL.slice(SQL.indexOf("$grants$"));
  assert.ok(g.includes("notification_resolve_recipients(text,text,uuid,uuid,uuid,jsonb)"), "resolver listed for revoke");
  assert.ok(g.includes("from public, anon, authenticated"), "revokes from authenticated");
});

// ─── 3. Preview producer: portal (trigger) + immediate email (route) + all 3 UI paths ───
test("preview: staff-notify trigger fires on status→client_review for all paths", () => {
  const b = fnBody(SQL, "pc_preview_staff_notify");
  assert.ok(b.includes("client_review"), "keyed on client_review");
  assert.ok(b.includes("notification_dispatch_portal") && b.includes("'staff'"), "notifies internal staff via dispatch");
  assert.ok(b.includes("actor_confirmation"), "includes the actor as a confirmation (no self-suppression)");
  assert.ok(b.includes("exception when others then return new"), "never fails the deliverable status change");
  assert.ok(SQL.includes("after insert or update of status on public.deliverables"), "covers insert + status update (all send paths)");
});
test("preview: server route resolves canonical recipients + sends immediately + traces", () => {
  assert.ok(ROUTE_PROJ.includes("notification_resolve_recipients"), "uses the canonical resolver");
  assert.ok(ROUTE_PROJ.includes("sendProjectEmail"), "sends email immediately (not via the daily cron)");
  assert.ok(ROUTE_PROJ.includes("notification_trace"), "writes the delivery trace");
  assert.ok(ROUTE_PROJ.includes("staffSubject") && ROUTE_PROJ.includes("clientSubject"), "distinct staff vs client subject");
  assert.ok(ROUTE_PROJ.includes("selectAsUser") && ROUTE_PROJ.includes("not_visible"), "anti-forgery visibility check");
  // A client can SEE their own deliverable, so preview-send is gated on is_staff
  // (blocks a client triggering/flooding internal-staff email) + rate limited.
  assert.ok(ROUTE_PROJ.includes("isStaff") && ROUTE_PROJ.includes("forbidden"), "staff-only gate (visibility alone is insufficient)");
  assert.ok(ROUTE_PROJ.includes("rate_limited") && ROUTE_PROJ.includes("RATE_MS"), "rate limited against floods");
});
test("preview: ALL THREE send paths fire the producer (admin/editor/version)", () => {
  assert.ok(ADMIN_DLV.includes("emitProjectDeliverableEvent"), "admin path wired");
  assert.ok(EDITOR_DLV.includes("emitProjectDeliverableEvent") && /status === "client_review"[\s\S]{0,120}emitProjectDeliverableEvent/.test(EDITOR_DLV), "editor path wired on client_review");
  assert.ok(VERSIONS.includes("emitProjectDeliverableEvent"), "add-version path wired");
  // No longer relying on the no-op no-cors client-only email (import removed).
  assert.ok(!/import[^;]*\bnotifyReviewReady\b/.test(ADMIN_DLV), "admin no longer imports the no-op review email");
});
test("preview: the helper posts to the authenticated route (not the no-cors no-op)", () => {
  assert.ok(NOTIFYEMAIL.includes("emitProjectDeliverableEvent"), "helper exported");
  assert.ok(NOTIFYEMAIL.includes("/api/integrations/project/notify") && NOTIFYEMAIL.includes("Authorization"), "authenticated POST");
});

// ─── 4. Channel fix: project email is now opt-OUT (delivers by default) ───
test("channel: projectEmailEnabled flipped to opt-out (code, not env)", () => {
  assert.ok(/!==\s*"false"/.test(PROJNOTIFY), "opt-out default like custody/HR");
  assert.ok(!/===\s*"true"/.test(PROJNOTIFY.slice(PROJNOTIFY.indexOf("projectEmailEnabled"))), "no longer opt-in disabled");
});

// ─── 5. Custody self-issue/return: management via resolver + missing events added ───
test("custody: managers resolved via canonical resolver with safe fallback", () => {
  assert.ok(ROUTE_CUST.includes("notification_resolve_recipients"), "uses resolver (auth.users emails)");
  assert.ok(ROUTE_CUST.includes("account_type.eq.admin,staff_role.in.(super_admin,manager,custody_officer)"), "keeps the old query as fallback (no regression pre-apply)");
  assert.ok(ROUTE_CUST.includes("civ_return_accepted") && ROUTE_CUST.includes("AUDIENCE_MANAGERS"), "return outcomes now reach management");
  // Regression fix: fall back when the resolver returns an EMPTY set, not only on error.
  assert.ok(ROUTE_CUST.includes("managerEmails.length === 0"), "empty resolver result cannot silently suppress the audience");
});
test("resolver: staff_role='manager' included for custody/rental (matches civ_notify_managers)", () => {
  const b = fnBody(SQL, "notification_resolve_recipients");
  assert.ok(b.includes("staff_role in ('manager', 'custody_officer')"), "custody/rental officer branch includes manager (no email<portal regression)");
});

// ─── 6. Rental: staff-initiated return notifies the renter; finance handled ───
test("rental: return_requested added to RENTER_EVENTS; finance covered", () => {
  assert.ok(ROUTE_RENT.includes("rental_return_requested"), "renter told on staff-initiated return");
  assert.ok(ROUTE_RENT.includes("finance") && ROUTE_RENT.includes("FINANCE_EVENTS"), "finance recipients handled");
  assert.ok(ROUTE_RENT.includes("authAdminEmails"), "auth.users email fallback for staff/renter");
});
test("rental: renter portal producer folds the missing transitions (contract/active/overdue/closed)", () => {
  const b = fnBody(SQL, "rental_notify_renter_transition");
  for (const st of ["contract_pending_signature", "active", "overdue", "closed"]) assert.ok(b.includes(`'${st}'`), `handles ${st}`);
  assert.ok(b.includes("custody_rental_customers") && b.includes("civ_notify("), "renter via own contract, portal-only for rental_");
  assert.ok(b.includes("exception when others then return new"), "never fails the rental transition");
});

// ─── 7. Worker shared by cron + admin; no double-send; bounded ───
test("worker: extracted + reused by cron and admin process-now", () => {
  assert.ok(WORKER.includes("export async function processQueue"), "shared worker exported");
  assert.ok(ROUTE_CRON.includes('from "@/lib/server/notifyWorker"'), "cron imports the shared worker");
  assert.ok(ROUTE_ADMIN.includes('from "@/lib/server/notifyWorker"'), "admin imports the shared worker");
  assert.ok(WORKER.includes("status=eq.pending") && WORKER.includes('{ status: "processing" }'), "optimistic lock (no double-send)");
  assert.ok(WORKER.includes("attempts >= 5"), "dead-letter after max attempts");
});

// ─── 8. Delivery trace: table + admin reader + monitor surfacing ───
test("trace: telemetry table + admin-gated reader + monitor UI", () => {
  assert.ok(SQL.includes("create table if not exists public.notification_delivery_log"), "trace table");
  assert.ok(SQL.includes("policy ndl_admin_read"), "admin-only RLS");
  const rd = fnBody(SQL, "notification_delivery_trace_list");
  assert.ok(rd.includes("can_manage_projects"), "reader admin-gated");
  assert.ok(rd.includes("exclusion_reason") && rd.includes("outcome"), "trace exposes why/where");
  assert.ok(MONITOR.includes("notificationDeliveryTrace") && MONITOR.includes("trace"), "monitor consumes the trace");
});

// ─── 9. Admin tools: auth-gated + rate-limited + self-only ───
test("admin tools: can_manage_projects gate + rate limit + self-only self-test", () => {
  assert.ok(ROUTE_ADMIN.includes("can_manage_projects"), "authorization gate");
  assert.ok(ROUTE_ADMIN.includes("rate_limited") && ROUTE_ADMIN.includes("RATE_MS"), "rate limited");
  assert.ok(ROUTE_ADMIN.includes("notification_admin_self_test"), "self-test writes to caller only via dedicated RPC");
  const st = fnBody(SQL, "notification_admin_self_test");
  assert.ok(st.includes("p_user") && !st.includes("account_type = 'admin'"), "self-test targets only the passed user, no fan-out");
  assert.ok(MONITOR.includes('runAdmin("self_test")') && MONITOR.includes('runAdmin("process_now")'), "monitor exposes both tools");
});

// ─── 10. Security / constraints ───
test("security: no secrets, no third table, no env writes, no business mutation in SQL", () => {
  for (const r of [ROUTE_PROJ, ROUTE_ADMIN, ROUTE_CUST, ROUTE_RENT]) {
    assert.ok(!/CRON_SECRET|SERVICE_ROLE_KEY|service_role_key/.test(r), "no secret literals in routes");
  }
  assert.ok(!SQL.includes("PROJECT_EMAIL_ALERTS_ENABLED"), "SQL never touches env");
  // §0 widens the type CHECK (no data delete); the only DELETE is trace pruning.
  const deletes = [...CODE.matchAll(/delete from (public\.\w+)/g)].map((m) => m[1]);
  assert.deepStrictEqual(Array.from(new Set(deletes)), ["public.notification_delivery_log"], "only trace telemetry is pruned");
});
test("type CHECK: §0 replaces the drifting enum with a lenient format guard (unblocks liability/receipt)", () => {
  const g = SQL.slice(SQL.indexOf("$type_guard$"));
  assert.ok(g.includes("drop constraint if exists notifications_type_check"), "drops the drifting enum");
  assert.ok(g.includes("~ '^[a-z][a-z0-9_]{2,60}$'"), "lenient format guard");
  assert.ok(g.includes("type !~") && g.includes("raise notice"), "guarded against nonconforming rows (no data loss)");
});

// ─── 11. Test-safety: purely static ───
test("test safety: only node builtins required (no DB, no network, no real email)", () => {
  const self = R("tests/notifications_e2e_9d.test.js");
  const requires = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  const allow = new Set(["node:test", "node:assert", "node:fs", "node:path"]);
  for (const r of requires) assert.ok(allow.has(r), `only static builtins (got ${r})`);
});
