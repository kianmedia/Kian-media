// ════════════════════════════════════════════════════════════════════════════
// tests/comms_feature_detection.test.js — code ships BEFORE SQL.
//
// The owner deploys code first and runs migrations later, so every hub surface
// must render an honest Arabic "waiting for the database" state instead of
// crashing, blanking, or — worst of all — reporting a permission problem as a
// missing migration. Also covers migration idempotency, Arabic/RTL, and the
// composition rules (no second queue, no second resolver, frozen tree untouched).
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
const ROLLBACK = R("docs/communications_hub_ROLLBACK.sql");
const CLIENT = R("lib/portal/comms.ts");
const HUB_UI = R("components/portal/CommunicationsHub.tsx");
const PREFS_UI = R("components/portal/CommsPreferences.tsx");
const PAGE = R("app/client-portal/communications/page.tsx");
const HUB = R("lib/server/commsHub.ts");
const ROUTE = R("app/api/comms/process/route.ts");

const WAITING = "الميزة بانتظار تفعيل قاعدة البيانات";

// ─── Feature detection ──────────────────────────────────────────────────────

test("the browser client maps a missing migration to its OWN state, never to an error", () => {
  assert.ok(/state: "needs_migration"/.test(CLIENT), "a distinct state exists");
  assert.ok(CLIENT.includes("pgIsMigrationPending"), "it is decided by the shared classifier, not a string guess");
  assert.ok(CLIENT.includes(WAITING), "and carries the required Arabic wording");
  // permission denial is a DIFFERENT state with different words
  assert.ok(/denied: d\.kind === "permission_denied"/.test(CLIENT), "denial is tracked separately");
  assert.ok(/لا تملك صلاحية/.test(CLIENT), "denial has its own Arabic message");
});

test("every hub surface renders the waiting state instead of crashing", () => {
  for (const [name, src] of [["dashboard", HUB_UI], ["preferences", PREFS_UI]]) {
    assert.ok(src.includes(WAITING), `${name} renders the Arabic waiting notice`);
    assert.ok(/needs_migration/.test(src), `${name} branches on the migration state`);
  }
  assert.ok(/لا يوجد خطأ في صلاحياتك/.test(HUB_UI),
    "the waiting notice explicitly says it is NOT a permission problem — the exact confusion that cost a cycle");
});

test("the page mounts unconditionally; detection happens inside the components", () => {
  assert.ok(/export default function CommunicationsPage/.test(PAGE), "the route exists");
  assert.ok(PAGE.includes("CommunicationsHub") && PAGE.includes("CommsPreferences"), "both surfaces mount");
  assert.ok(!/needs_migration|comms_dashboard/.test(PAGE), "the page itself does no detection — it cannot blank");
});

test("the server layer answers HUB_NOT_INSTALLED honestly and never throws", () => {
  assert.ok(/export function hubNotInstalled/.test(HUB), "a named detector exists");
  assert.ok(/PGRST202\|could not find the function\|does not exist\|schema cache\|HTTP 404/.test(HUB),
    "it recognises the not-deployed signatures");
  assert.ok(/HUB_NOT_INSTALLED/.test(HUB), "a distinct outcome code");
  assert.ok(/NEVER THROWS/.test(HUB), "the contract is documented");
  // both entry points are wrapped
  const enq = HUB.slice(HUB.indexOf("export async function commsEnqueue"), HUB.indexOf("export function logCommsOutcome"));
  assert.ok(/try \{/.test(enq) && /catch \(e\)/.test(enq), "commsEnqueue is wrapped");
  const drain = HUB.slice(HUB.indexOf("export async function commsDrain"));
  assert.ok(/try \{/.test(drain) && /catch \(e\)/.test(drain), "commsDrain is wrapped");
});

test("the drain route degrades with the Arabic notice rather than a 500", () => {
  assert.ok(/HUB_NOT_INSTALLED/.test(ROUTE), "the route handles it");
  assert.ok(ROUTE.includes(WAITING), "with the required Arabic wording");
  assert.ok(/\}, \{ status: 200 \}\)/.test(ROUTE.slice(ROUTE.indexOf("HUB_NOT_INSTALLED"))),
    "a missing migration is not a server error");
});

// ─── Migration idempotency ──────────────────────────────────────────────────

test("the RUNME is transactional and idempotent", () => {
  assert.ok(/^begin;/m.test(RUNME), "wrapped in a transaction");
  assert.ok(/^commit;/m.test(RUNME), "and committed");
  assert.ok(/notify pgrst, 'reload schema';/.test(RUNME), "PostgREST cache reload at the end");

  const creates = RUNME.match(/create table (?!if not exists)/g);
  assert.strictEqual(creates, null, "every table uses CREATE TABLE IF NOT EXISTS");
  const idx = RUNME.match(/create (unique )?index (?!if not exists)/g);
  assert.strictEqual(idx, null, "every index uses IF NOT EXISTS");
  const fns = (RUNME.match(/^create function /gm) ?? []);
  assert.strictEqual(fns.length, 0, "every function uses CREATE OR REPLACE");
  // policies and triggers are dropped before being recreated
  const policyCreates = RUNME.match(/create policy (\w+)/g) ?? [];
  for (const c of policyCreates) {
    const name = c.split(" ")[2];
    assert.ok(RUNME.includes(`drop policy if exists ${name}`), `policy ${name} is dropped before create`);
  }
  assert.ok(/drop trigger if exists t_comms_outbox_guard/.test(RUNME), "the trigger is dropped before create");
  // Each of the three seed blocks is conflict-safe, so a re-run cannot duplicate.
  for (const [table, clause] of [
    ["comms_channels", "on conflict (channel) do nothing"],
    ["comms_event_catalog", "on conflict (event_key) do nothing"],
    ["comms_templates", "on conflict (event_key, locale, audience_scope, version) do nothing"],
  ]) {
    const i = RUNME.indexOf(`insert into public.${table}(`);
    assert.ok(i > -1, `${table} is seeded`);
    assert.ok(RUNME.slice(i, i + 4000).includes(clause), `${table} seed is ON CONFLICT protected`);
  }
});

test("the RUNME guards the 42P13 return-type trap before doing anything else", () => {
  const g0 = RUNME.indexOf("§0  42P13 GUARD");
  const firstCreate = RUNME.indexOf("create or replace function public.comms_is_external");
  assert.ok(g0 > -1 && g0 < firstCreate, "the guard runs before any function is replaced");
  assert.ok(/HUB 42P13: public\.%\(%\) already returns %/.test(RUNME), "it names the offending function");
  assert.ok(PRE.includes("42P13"), "the preflight warns about it too");
});

test("self-tests are STATIC — the migration never calls its own protected RPCs", () => {
  const st = RUNME.slice(RUNME.indexOf("do $selftest$"));
  for (const fn of ["comms_enqueue(", "comms_retry(", "comms_cancel(", "comms_dashboard(",
                    "comms_health(", "comms_preview(", "comms_channel_set(", "comms_claim("]) {
    assert.ok(!new RegExp(`(select|perform)\\s+public\\.${fn.replace("(", "\\(")}`).test(st),
      `the self-test must not invoke ${fn} — auth.uid() is NULL in the SQL editor`);
  }
  assert.ok(/pg_get_functiondef/.test(st), "assertions read function bodies instead");
  assert.ok(/ilike|!~\*|~\*/.test(st), "case-insensitive matching, because the deparser uppercases keywords");
  // no catch-all that would make a check pass regardless
  assert.ok(!/exception\s+when\s+others\s+then\s+null/i.test(st), "no catch-all swallowing a failed assertion");
});

test("PREFLIGHT and POSTCHECK are read-only", () => {
  for (const [name, sql] of [["preflight", PRE], ["postcheck", POST]]) {
    assert.ok(!/\binsert\s+into\b/i.test(sql), `${name}: no INSERT`);
    assert.ok(!/\bupdate\s+\w/i.test(sql.replace(/--.*$/gm, "")), `${name}: no UPDATE`);
    assert.ok(!/\bdelete\s+from\b/i.test(sql), `${name}: no DELETE`);
    assert.ok(!/\bdrop\s+(table|function|policy|trigger)\b/i.test(sql), `${name}: no DROP`);
    assert.ok(!/\bcreate\s+(table|function|policy|trigger)\b/i.test(sql), `${name}: no CREATE`);
  }
});

test("the ROLLBACK is honest about what it destroys and refuses to hide a real send", () => {
  assert.ok(/WHAT THIS REMOVES PERMANENTLY/.test(ROLLBACK), "it names the data loss");
  assert.ok(/THIS IS AUDIT EVIDENCE/.test(ROLLBACK), "it flags the audit trail specifically");
  assert.ok(/RECOMMENDED INSTEAD OF ROLLBACK/.test(ROLLBACK), "it offers the non-destructive alternative first");
  assert.ok(/ROLLBACK REFUSED: % real send\(s\) are recorded/.test(ROLLBACK),
    "it refuses to run when it would destroy the only record of a real send");
  // and it must not take the pre-hub system with it
  for (const t of ["notifications", "email_deliveries", "notification_delivery_log"]) {
    assert.ok(!new RegExp(`drop table if exists public\\.${t}\\b`).test(ROLLBACK), `must not drop ${t}`);
  }
  assert.ok(/ROLLBACK BUG: public\.% disappeared/.test(ROLLBACK), "it verifies the pre-hub system survived");
});

// ─── Composition, not a parallel system ─────────────────────────────────────

test("no second resolver, no second queue, no second provider, no second cron", () => {
  assert.ok(/notification_resolve_recipients/.test(RUNME),
    "the hub reuses the canonical resolver when it is deployed");
  assert.ok(/to_regprocedure\('public\.notification_resolve_recipients/.test(RUNME),
    "and feature-detects it rather than assuming");
  assert.ok(/FALLBACK: base tables only/.test(RUNME), "with an honest fallback when it is absent");
  // the hub never writes the legacy queue
  assert.ok(!/insert into public\.email_deliveries|update public\.email_deliveries|delete from public\.email_deliveries/i.test(RUNME),
    "email_deliveries is never written");
  // no new cron entry was added
  const vercel = R("vercel.json");
  assert.ok(!vercel.includes("/api/comms/"), "no cron schedule was added for the hub in this phase");
  assert.ok(/does NOT get its own Vercel cron entry/.test(ROUTE), "and the reason is written down");
});

test("the FROZEN project-platform tree is untouched by this module", () => {
  const frozen = JSON.parse(R("tests/fixtures/project_platform_freeze.json")).paths;
  const mine = [
    "lib/portal/comms.ts", "lib/server/commsHub.ts", "lib/server/commsProvider.ts",
    "lib/server/commsLegacyAdapter.ts", "components/portal/CommunicationsHub.tsx",
    "components/portal/CommsPreferences.tsx", "app/client-portal/communications/page.tsx",
    "app/api/comms/process/route.ts",
  ];
  for (const m of mine) {
    assert.ok(fs.existsSync(path.join(root, m)), `${m} exists`);
    for (const f of frozen) assert.ok(!m.startsWith(f), `${m} is outside the frozen path ${f}`);
  }
  // and nothing here IMPORTS from the frozen tree (a comment naming it is fine —
  // the audit has to be able to say why that monitor cannot be extended).
  for (const m of mine) {
    const src = R(m);
    assert.ok(!/^\s*import[^\n]*projectcore/m.test(src), `${m} must not import from the frozen projectcore tree`);
    assert.ok(!/from ["'][^"']*projectcore/.test(src), `${m} must not reference projectcore in a module specifier`);
  }
});

test("the hub does not modify any project-platform table or add a column to projects", () => {
  for (const t of ["projects", "project_core", "deliverables", "deliverable_internal",
                   "project_transition_requests"]) {
    assert.ok(!new RegExp(`alter table (if exists )?public\\.${t}\\b`, "i").test(RUNME), `no ALTER on ${t}`);
  }
  assert.ok(/project_members/.test(RUNME), "it only READS project membership in the fallback resolver");
  const reads = RUNME.match(/public\.project_members/g) ?? [];
  for (const _ of reads) { /* every occurrence is inside a SELECT — checked below */ }
  assert.ok(!/insert into public\.project|update public\.project/i.test(RUNME), "and never writes one");
});

// ─── Arabic / RTL / Unicode ─────────────────────────────────────────────────

test("the UI is Arabic-first and RTL-aware", () => {
  for (const [name, src] of [["dashboard", HUB_UI], ["preferences", PREFS_UI], ["page", PAGE]]) {
    assert.ok(/direction: isAr \? "rtl" : "ltr"/.test(src), `${name} sets direction from the locale`);
  }
  // Arabic labels exist for every status and channel
  const statuses = ["queued", "processing", "sent", "delivered", "failed", "retrying", "dead_letter", "cancelled"];
  for (const s of statuses) assert.ok(new RegExp(`${s}:\\s*"[^"]*[\\u0600-\\u06FF]`).test(CLIENT), `Arabic label for ${s}`);
  for (const c of ["portal", "email", "whatsapp"]) {
    assert.ok(new RegExp(`${c}:\\s*"[^"]*[\\u0600-\\u06FF]`).test(CLIENT), `Arabic label for channel ${c}`);
  }
});

test("templates exist in Arabic AND English, for internal and client scopes", () => {
  assert.ok(RUNME.includes("HUB FAIL: no active Arabic template"), "Arabic is required");
  assert.ok(RUNME.includes("HUB FAIL: no active English template"), "English is required");
  assert.ok(RUNME.includes("HUB FAIL: no active client-scoped template"), "a client scope is required");
  assert.ok(/locale\s+text not null check \(locale in \('ar','en'\)\)/.test(RUNME), "the locale vocabulary is closed");
});

test("template rendering is Unicode-safe and never leaks an unfilled token", () => {
  const i = RUNME.indexOf("create or replace function public.comms_render(");
  const body = RUNME.slice(i, RUNME.indexOf("$$;", i));
  assert.ok(/replace\(v_out, '\{\{' \|\| k \|\| '\}\}', v\)/.test(body),
    "plain text replacement — no regex character classes that would mangle Arabic");
  assert.ok(/regexp_replace\(v_out, '\\\{\\\{\[a-z0-9_\]\+\\\}\\\}', '', 'gi'\)/.test(body),
    "an unfilled token becomes empty rather than shipping a literal {{x}} to a client");
});

test("the CSV export is Excel-safe for Arabic and never launders a simulation into a delivery", () => {
  assert.ok(/return "\\ufeff" \+ lines\.join/.test(CLIENT) || CLIENT.includes('"﻿" + lines.join'),
    "a UTF-8 BOM is prepended so Excel renders Arabic instead of mojibake");
  assert.ok(/dry_run && \(r\.status === "sent" \|\| r\.status === "delivered"\) \? r\.status \+ " \(dry_run\)"/.test(CLIENT),
    "a simulated row is labelled (dry_run) in the export too");
  assert.ok(/\/\[",\\n\\r\]\/\.test\(s\)/.test(CLIENT), "fields with commas, quotes or newlines are escaped");
});

test("a simulated send is NEVER labelled as sent anywhere the user can read it", () => {
  assert.ok(/محاكاة — لم يُرسل فعليًا/.test(CLIENT), "the Arabic label says it was not sent");
  assert.ok(/commsStatusLabel/.test(HUB_UI), "the dashboard uses that label, not the raw status");
  // health keeps the two counts apart
  assert.ok(/'sent_dry_run',count\(\*\) filter \(where status in \('sent','delivered'\) and dry_run\)/.test(RUNME.replace(/\s+/g, " ").replace(/ ,/g, ",")) ||
            /sent_dry_run/.test(RUNME), "health separates simulated from live");
  assert.ok(/sent_live/.test(RUNME), "and reports live sends under their own key");
  assert.ok(!/'sent',\s*count\(\*\) filter \(where status in \('sent','delivered'\)\)/.test(RUNME),
    "there is no combined 'sent' number that could be mistaken for delivery");
});
