// ════════════════════════════════════════════════════════════════════════════
// tests/liveops_no_fake_telemetry.test.js — ⛔ NO DEVICE CONNECTION IN V1.
//
// The brief is explicit twice:
//   "⛔ NO direct device connection in V1 — updates are manual or via a future
//    adapter."
//   "⚠️ NEVER present manual entries as live telemetry."
//   "⚠️ Do NOT report uptime as a real number without telemetry — label it
//    manual_estimate or telemetry_verified."
//
// The temptation this module resists is the green dot. A dashboard that shows
// «البثّ سليم» in green, sourced from a number an exhausted operator typed
// forty minutes ago, is worse than no dashboard: someone will trust it during a
// live broadcast. So the honesty is STRUCTURAL — a database constraint makes
// the false claim unrepresentable — and not a matter of remembering a caption.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, FILES, fnBody } = require("./liveops_helpers");

const RUNME = R(FILES.RUNME);
const LIB = R(FILES.LIB);
const PAGE = R(FILES.PUBLIC_PAGE);
const CENTER = R(FILES.CENTER);
const ATOMS = R(FILES.ATOMS);

test("★★ a 'verified' reading is UNREPRESENTABLE without a named adapter", () => {
  assert.match(RUNME,
    /constraint liveops_health_source_honest check \(source <> 'telemetry_verified' or adapter_id is not null\)/,
    "the database itself refuses the claim");
  // ...and the reverse: a manual entry may not carry an adapter id, so the two
  // can never be blurred together.
  assert.match(RUNME,
    /constraint liveops_health_manual_no_adapter check \(source <> 'manual_status' or adapter_id is null\)/);
});

test("★ the only write path refuses 'telemetry_verified' outright", () => {
  const rec = fnBody(RUNME, "liveops_health_record");
  assert.match(rec, /if v_src not in \('manual_status','adapter_unavailable','telemetry_not_connected'\) then/);
  assert.match(rec, /لا يوجد مسار يدويّ يُنتج قراءة موثَّقة/);
  // adapter_id is hard-coded NULL on this path — not taken from the caller.
  assert.match(rec, /v_src, null, case when v_src = 'manual_status' then now\(\) else null end/);
  assert.match(rec, /'telemetry_connected', false/, "the response states the truth every time");
});

test("the four source values are distinct states, and each means something different", () => {
  assert.match(RUNME, /check \(source in \('manual_status','adapter_unavailable','telemetry_not_connected','telemetry_verified'\)\)/);
  // The TypeScript vocabulary mirrors it exactly — no fifth value, no "live".
  const decl = /export type LiveOpsHealthSource =([\s\S]*?);/.exec(LIB)?.[1] ?? "";
  assert.match(decl, /"manual_status" \| "adapter_unavailable" \| "telemetry_not_connected" \| "telemetry_verified"/);
  // Exactly four members — no fifth, and in particular nothing called "live".
  const members = decl.match(/"[a-z_]+"/g) ?? [];
  assert.strictEqual(members.length, 4, `the source vocabulary must stay at four, found ${members.join(", ")}`);
  assert.ok(!members.includes('"live"') && !members.includes('"realtime"'),
    "there is no 'live' telemetry source to choose (the session STATUS 'live' is a different vocabulary)");
});

test("the TypeScript layer refuses a verified reading before it ever leaves the browser", () => {
  assert.match(LIB, /if \(source === "telemetry_verified"\) \{[\s\S]{0,300}state: "error" as const/);
  assert.match(LIB, /لا يوجد مُحوِّل أجهزة في هذه النسخة/);
});

test("the UI offers only the three honest sources in its dropdown", () => {
  const select = CENTER.slice(CENTER.indexOf('setSource(e.target.value as LiveOpsHealthSource)'));
  assert.match(select, /<option value="manual_status">/);
  assert.match(select, /<option value="adapter_unavailable">/);
  assert.match(select, /<option value="telemetry_not_connected">/);
  assert.ok(!/<option value="telemetry_verified">/.test(CENTER),
    "there is no control anywhere that lets a human claim instrumentation");
});

test("★ every technical value is rendered with its basis attached", () => {
  // The atom exists precisely so the basis cannot be forgotten.
  assert.match(ATOMS, /export function TelemetryBasis/);
  assert.match(ATOMS, /telemetryLabelAr\(source\)/);
  // ...and it is used on every screen that shows a technical value.
  const uses = CENTER.match(/<TelemetryBasis/g) ?? [];
  assert.ok(uses.length >= 3, `expected the basis line on every technical surface, found ${uses.length}`);
  // The client page carries it too.
  assert.match(PAGE, /مصدر هذه الحالات: \{BASIS_AR\[data\.technical\.basis\]/);
  assert.match(PAGE, /لا يوجد اتصال مباشر بأجهزة البثّ في هذه النسخة/);
});

test("the honest labels never contain a word that implies instrumentation for a manual entry", () => {
  const fn = LIB.slice(LIB.indexOf("export function telemetryLabelAr"), LIB.indexOf("/** Uptime may never"));
  assert.match(fn, /case "manual_status":\s*return "إدخال بشريّ — ليست قراءة من الجهاز";/);
  assert.match(fn, /case "telemetry_not_connected":\s*return "القياسات غير موصولة";/);
  // The default is the pessimistic one — an unknown source is not assumed good.
  assert.match(fn, /default:\s*return "القياسات غير موصولة";/);
});

test("★ uptime can never be reported as a bare number", () => {
  // 1. The column carries its basis, and the basis vocabulary is exactly two words.
  assert.match(RUNME, /uptime_basis\s+text not null default 'manual_estimate'\s*\n\s*check \(uptime_basis in \('manual_estimate','telemetry_verified'\)\)/);

  // 2. A trigger DOWNGRADES a claimed verification when no verified reading exists.
  const guard = fnBody(RUNME, "liveops_report_uptime_guard");
  assert.match(guard, /if new\.uptime_basis = 'telemetry_verified'/);
  assert.match(guard, /and h\.source = 'telemetry_verified'\s*\n\s*and h\.adapter_id is not null/);
  assert.match(guard, /new\.uptime_basis := 'manual_estimate'/);
  assert.match(RUNME, /create trigger liveops_reports_uptime before insert or update on public\.liveops_reports/);

  // 3. The write RPC hard-codes manual_estimate; the caller cannot set it.
  const upsert = fnBody(RUNME, "liveops_report_upsert");
  assert.match(upsert, /public\.liveops_num\(p_input,'uptime_pct'\), 'manual_estimate',/);
  assert.match(upsert, /'uptime_basis','manual_estimate'/);

  // 4. The payload always ships the basis next to the number.
  const payload = fnBody(RUNME, "liveops_client_payload");
  assert.match(payload, /'uptime_pct', v_rep_uptime,/);
  assert.match(payload, /'uptime_basis', v_rep_basis,/);

  // 5. Both renderers refuse to print the number alone.
  assert.match(LIB, /export function uptimeLabelAr/);
  assert.match(LIB, /const b = basis === "telemetry_verified" \? "موثَّقة بالقياس" : "تقدير بشريّ";/);
  assert.match(PAGE, /تقدير بشريّ لا قياس آليّ/);
});

test("★ a missing technical value is 'unknown', never zero and never 'OK'", () => {
  const payload = fnBody(RUNME, "liveops_client_payload");
  assert.match(payload, /if v_h_source is null then/);
  assert.match(payload, /v_stream := 'unknown'; v_recording := 'unknown'; v_connection := 'unknown';\s*\n\s*v_basis := 'telemetry_not_connected'/,
    "with no reading at all the answer is 'unknown' + 'not connected' — never 'nominal'");

  // The internal client refuses to coerce an empty input into 0.
  assert.match(CENTER, /if \(!raw\) return null;\s+\/\/ ⚠️ فارغ = غير معروف، لا صفر/);
  // The atom prints «غير معروف» for null.
  assert.match(ATOMS, /if \(v === null \|\| v === undefined\) \{\s*\n\s*return <span style=\{\{ color: LC\.dim \}\}>غير معروف<\/span>;/);
  assert.match(LIB, /export function numOrUnknownAr[\s\S]{0,200}return "غير معروف";/);
  // And the empty-reading screen says so instead of showing green.
  assert.match(CENTER, /لا يجوز عرض «سليم» في هذه الحالة/);
});

test("'last checked' is described as a human action, never as a device response", () => {
  const setState = fnBody(RUNME, "liveops_inventory_set_state");
  assert.match(setState, /'update_kind', 'manual_status'/);
  assert.match(setState, /هذه قيمة أدخلها إنسان الآن، وليست قراءة من الجهاز/);
  assert.match(CENTER, /«آخر فحص» هو آخر مرّة ضغط فيها أحدهم زرًّا — لا آخر مرّة استجاب فيها الجهاز/);
});

test("no code path anywhere opens a socket or reaches out to a device", () => {
  for (const [name, src] of Object.entries({ RUNME, LIB, CENTER, PAGE })) {
    assert.ok(!/\bWebSocket\b|\bEventSource\b|\bonvif\b|\bmqtt\b/i.test(src),
      `${name}: V1 talks to no device — no socket, no subscription, no device protocol client`);
  }
  // The database never reaches the network either.
  assert.ok(!/\bdblink\b|\bhttp_get\b|\bpg_net\b|\bnet\.http/i.test(RUNME),
    "no outbound call from SQL; the only 'adapter' is a future one that does not exist yet");
  // The one place a streaming protocol IS named is the secret scanner, whose job
  // is to REFUSE those strings in client-facing text.
  const scanner = fnBody(RUNME, "liveops_secret_reason");
  assert.match(scanner, /rtmps\?\|srt\|rist\|udp\|rtsp\|ndi/,
    "protocols appear once in the codebase: in the pattern that blocks them from client text");
});

test("the detail RPC declares the telemetry state explicitly rather than staying silent", () => {
  const detail = fnBody(RUNME, "liveops_session_detail");
  assert.match(detail, /'telemetry', jsonb_build_object\(\s*\n\s*'connected', false, 'adapter', null, 'state','telemetry_not_connected'/);
  assert.match(detail, /لا يوجد اتصال بأجهزة البثّ في هذه النسخة/);
});
