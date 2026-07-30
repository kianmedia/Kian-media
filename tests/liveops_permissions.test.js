// ════════════════════════════════════════════════════════════════════════════
// tests/liveops_permissions.test.js — who may do what, and the ONE rule that
// the brief states in capitals: **A CLIENT MAY NEVER CHANGE STATUS.**
//
// A rule enforced in one place is a rule waiting to be bypassed. This module
// enforces it three times:
//   1. no UPDATE policy exists for anybody, so PostgREST has no write path;
//   2. the RPC gates on liveops_can_operate_session, which returns false for a
//      client in its SECOND line, before any permission key is consulted;
//   3. a BEFORE UPDATE trigger recomputes the answer from the database and
//      raises — so it holds even against a policy someone adds by mistake in
//      2027, and even against a direct table write.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, FILES, fnBody } = require("./liveops_helpers");

const RUNME = R(FILES.RUNME);
const NAV = R(FILES.NAV);
const LIB = R(FILES.LIB);
const CENTER = R(FILES.CENTER);

// ─── layer 1: no write policy at all ────────────────────────────────────────

test("★ layer 1 — there is NO insert/update/delete policy on any table in the module", () => {
  const policies = RUNME.match(/create policy[\s\S]{0,200}?;/g) ?? [];
  for (const p of policies) {
    assert.ok(/for select/i.test(p), `every policy must be SELECT-only, found: ${p.slice(0, 120)}`);
  }
  // The self-test enforces the same thing against the live catalogue.
  assert.match(RUNME, /from pg_policies\s*\n\s*where schemaname='public' and tablename like 'liveops\\_%' and cmd <> 'SELECT'/);
  assert.match(RUNME, /وُجدت % سياسة كتابة — الكتابة يجب أن تمرّ بالدوالّ/);
});

test("RLS is enabled on all twelve tables, and FORCE is deliberately NOT used", () => {
  assert.match(RUNME, /alter table public\.%I enable row level security/);
  assert.ok(!/force row level security/.test(RUNME.replace(/--.*$/gm, "")),
    "FORCE would subject the table owner to the policies, and every policy targets `authenticated`; " +
    "a SECURITY DEFINER function running as the owner would then read zero rows and the module would break");
  // ...and the self-test fails loudly if someone turns it on later.
  assert.match(RUNME, /FORCE RLS مفعّلة على % — ستُصفّر قراءات الدوالّ/);
});

// ─── layer 2: the function gate ─────────────────────────────────────────────

test("★ layer 2 — liveops_can_operate_session refuses a client before anything else", () => {
  const fn = fnBody(RUNME, "liveops_can_operate_session");
  const lines = fn.split("\n").map((l) => l.trim()).filter(Boolean);
  const nullLine = lines.findIndex((l) => l.includes("p_session is null"));
  const clientLine = lines.findIndex((l) => l.includes("liveops_is_client"));
  const manageLine = lines.findIndex((l) => l.includes("liveops_can_manage"));
  const permLine = lines.findIndex((l) => l.includes("liveops_perm"));

  assert.ok(clientLine > nullLine, "the client check comes right after the null check");
  assert.ok(clientLine < manageLine, "a client is refused BEFORE any privilege is considered");
  assert.ok(clientLine < permLine, "a permission key can never rescue a client account");
  assert.match(fn, /when coalesce\(public\.liveops_is_client\(\), true\) then false/,
    "unknown identity is treated as a client — fail closed");
});

test("the status RPC gates on the per-session operator predicate", () => {
  const fn = fnBody(RUNME, "liveops_session_set_status");
  const gateIdx = fn.indexOf("liveops_can_operate_session");
  const updateIdx = fn.indexOf("update public.liveops_sessions");
  assert.ok(gateIdx > -1 && gateIdx < updateIdx, "authorise before writing");
  assert.match(fn, /liveops_log\('session_set_status','liveops_session',p_session,p_session,false/,
    "a denial is audited too");
});

// ─── layer 3: the trigger ───────────────────────────────────────────────────

test("★★ layer 3 — a BEFORE UPDATE trigger re-checks and raises, whatever the policies say", () => {
  const guard = fnBody(RUNME, "liveops_session_guard");
  assert.match(guard, /new\.status is distinct from old\.status/);
  assert.match(guard, /new\.client_status is distinct from old\.client_status/,
    "the client-facing status is guarded too — it is what a client would most want to change");
  assert.match(guard, /if coalesce\(public\.liveops_is_client\(\), true\) then/);
  assert.match(guard, /raise exception 'not authorized: تغيير حالة جلسة مباشرة ليس متاحًا لحساب عميل\.'/);
  assert.match(guard, /liveops_log\('status_change_denied_client'/, "the attempt is recorded");

  // And it is actually attached.
  assert.match(RUNME, /create trigger liveops_sessions_guard before update on public\.liveops_sessions\s*\n\s*for each row execute function public\.liveops_session_guard\(\)/);
});

test("the trigger also enforces the state machine, not just the identity", () => {
  const guard = fnBody(RUNME, "liveops_session_guard");
  assert.match(guard, /liveops_status_allowed\(old\.status, new\.status\)/);
  const machine = fnBody(RUNME, "liveops_status_allowed");
  // All eleven states are reachable in the map, and archived is terminal.
  for (const s of ["draft", "readiness_review", "ready", "rehearsal", "live", "paused",
                   "degraded", "interrupted", "completed", "post_event_review", "archived"]) {
    assert.ok(machine.includes(s), `${s} must appear in the transition map`);
  }
  assert.ok(!/'archived>/.test(machine), "archived is terminal — no transition leaves it");
  assert.match(machine, /when p_from = p_to then true/, "a no-op update is not a transition");
});

test("a SQL-editor session (auth.uid() NULL) is allowed but audited, and is not a client", () => {
  const guard = fnBody(RUNME, "liveops_session_guard");
  assert.match(guard, /if auth\.uid\(\) is not null and not coalesce\(public\.liveops_can_operate_session\(old\.id\), false\)/);
  assert.match(guard, /liveops_log\('status_change_no_session_context'/);
  const isClient = fnBody(RUNME, "liveops_is_client");
  assert.match(isClient, /when auth\.uid\(\) is null then false/,
    "'nobody' is not a client; anon is stopped by grants, not by this predicate");
});

// ─── the predicate family ───────────────────────────────────────────────────

test("every predicate returns an explicit boolean and can never return NULL", () => {
  const preds = [
    "liveops_is_client", "liveops_can_view", "liveops_can_manage", "liveops_can_operate",
    "liveops_can_operate_session", "liveops_can_read_session", "liveops_can_issue_client_link",
    "liveops_can_reveal_root_cause", "liveops_can_approve_report", "liveops_perm",
  ];
  for (const p of preds) {
    const fn = fnBody(RUNME, p);
    assert.ok(fn.length > 0, `${p} must exist`);
    assert.match(fn, /returns boolean/, `${p} must return boolean`);
    assert.ok(/coalesce|case/.test(fn), `${p} must never evaluate to NULL`);
    assert.match(fn, /set search_path = public/, `${p} must pin its search_path`);
  }
});

test("the permission engine is feature-detected and fails CLOSED when broken", () => {
  const perm = fnBody(RUNME, "liveops_perm");
  assert.match(perm, /if to_regprocedure\('public\.emp_has_permission\(uuid,text\)'\) is null then return false/);
  assert.match(perm, /exception when others then\s*\n\s*return false/,
    "a broken permission engine must deny, never open");
});

test("the internal dashboard is staff-only and excludes a client explicitly", () => {
  const canView = fnBody(RUNME, "liveops_can_view");
  assert.match(canView, /not coalesce\(public\.liveops_is_client\(\), true\)/);
  assert.match(canView, /auth\.uid\(\) is not null/);
});

test("the five sensitive actions each have their own gate — none is implied by 'operate'", () => {
  const map = {
    liveops_incident_release_root_cause: "liveops_can_reveal_root_cause",
    liveops_report_approve: "liveops_can_approve_report",
    liveops_link_create: "liveops_can_issue_client_link",
    liveops_link_issue: "liveops_can_issue_client_link",
    liveops_link_revoke: "liveops_can_issue_client_link",
  };
  for (const [fn, gate] of Object.entries(map)) {
    assert.match(fnBody(RUNME, fn), new RegExp(gate), `${fn} must gate on ${gate}`);
  }
  // Approving a client-facing summary and publishing a bulletin are MANAGEMENT
  // decisions, not operational ones.
  assert.match(fnBody(RUNME, "liveops_incident_update"), /liveops_can_manage\(\), false\) then[\s\S]{0,200}اعتماد ملخّص يراه العميل/);
  assert.match(fnBody(RUNME, "liveops_bulletin_upsert"), /نشر تنبيه يراه العميل يتطلّب صلاحية إدارة/);
  assert.match(fnBody(RUNME, "liveops_client_person_upsert"), /liveops_can_manage/);
});

test("anon receives nothing at all, and no function is granted to PUBLIC", () => {
  assert.match(RUNME, /revoke all on public\.%I from anon/);
  assert.match(RUNME, /revoke all on public\.%I from public/);
  assert.ok(!/to anon/.test(RUNME.replace(/--.*$/gm, "")), "no grant to anon anywhere");
  // The self-test proves it against the live catalogue.
  assert.match(RUNME, /anon يملك % منحًا على جداول الوحدة/);
});

test("every write RPC is SECURITY DEFINER with a pinned search_path", () => {
  const writes = RUNME.match(/create or replace function public\.liveops_[a-z_]+\([^)]*\)\s*\nreturns jsonb[\s\S]{0,160}?as \$fn\$/g) ?? [];
  assert.ok(writes.length > 20, `expected the full RPC surface, found ${writes.length}`);
  for (const w of writes) {
    assert.match(w, /security definer set search_path = public/, `missing pin: ${w.slice(0, 90)}`);
  }
});

test("the five permission keys are seeded only when a catalogue exists", () => {
  for (const k of ["live_ops.view", "live_ops.operate", "live_ops.manage",
                   "live_ops.client_link", "live_ops.report_approve"]) {
    assert.ok(RUNME.includes(`'${k}'`), `${k} must be seeded`);
  }
  assert.match(RUNME, /if to_regclass\('public\.permissions'\) is not null then/,
    "the catalogue is composed with, never created here");
  assert.match(RUNME, /on conflict \(key\) do update set/, "re-running must not duplicate keys");
});

// ─── the UI is a courtesy, never a control ──────────────────────────────────

test("the tab is absent from the client and lead navigation sets", () => {
  const clientSet = /client:\s*\[([^\]]*)\]/.exec(NAV)?.[1] ?? "";
  const leadSet = /lead:\s*\[([^\]]*)\]/.exec(NAV)?.[1] ?? "";
  assert.ok(!clientSet.includes("live_ops"), "a client never sees the internal dashboard tab");
  assert.ok(!leadSet.includes("live_ops"), "a lead never sees it either");
  // It IS present for the internal roles that run live events.
  for (const role of ["admin", "super_admin", "manager", "editor", "photographer"]) {
    const set = new RegExp(`${role}:\\s*\\[([^\\]]*)\\]`).exec(NAV)?.[1] ?? "";
    assert.ok(set.includes("live_ops"), `${role} should have the tab`);
  }
});

test("hiding a button in the UI is never presented as the control", () => {
  assert.match(CENTER, /إخفاء زرّ هنا مجاملة؛ المنع في القاعدة/);
  assert.match(CENTER, /المنع في القاعدة لا في هذه الشاشة/);
  // The permissions object drives visibility, and it comes FROM the database.
  assert.match(CENTER, /d\.permissions\.can_operate/);
  assert.match(CENTER, /d\.permissions\.can_manage/);
  assert.match(LIB, /hiding a button here is a courtesy, never a\s*\n\/\/ control/);
});

test("a permission denial is rendered as a denial — never as a pending migration", () => {
  assert.match(LIB, /if \(pgIsMigrationPending\(d\)\) return \{ state: "needs_migration"/);
  assert.match(LIB, /if \(d\.kind === "permission_denied"\)[\s\S]{0,120}state: "denied"/);
  assert.match(LIB, /if \(d\.kind === "network"\)[\s\S]{0,120}state: "offline"/);
  const atoms = R(FILES.ATOMS);
  assert.match(atoms, /هذا ليس نقصًا في التطبيق ولا ترحيلة معلّقة/);
});
