// ════════════════════════════════════════════════════════════════════════════
// tests/liveops_client_safe_view.test.js — ★ THE SHARPEST SURFACE ★
//
// The client-safe view may show ONLY: event status, current and remaining time,
// current/next segment, a SAFE count of active cameras, general stream /
// recording / connection status, approved responsible names, published
// bulletins, and the approved final report.
//
// It must NEVER expose IP addresses, stream keys, credentials, internal
// incidents, sensitive failure detail, internal usernames, storage paths,
// equipment serial numbers, costs, internal notes or backup topology.
//
// These tests assert that the restriction is STRUCTURAL — a whitelist in one
// database function plus a save-time pattern scanner — and not a matter of the
// UI choosing not to render something it received.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, FILES, fnBody, FORBIDDEN_IN_CLIENT_PAYLOAD } = require("./liveops_helpers");

const RUNME = R(FILES.RUNME);
const ROUTE = R(FILES.ROUTE);
const PAGE = R(FILES.PUBLIC_PAGE);
const PAYLOAD = fnBody(RUNME, "liveops_client_payload");

test("the client payload builder exists and is the ONLY assembler of client data", () => {
  assert.ok(PAYLOAD.length > 500, "liveops_client_payload must exist in the RUNME");

  // Both consumers must call the same builder — two builders means silent drift.
  const view = fnBody(RUNME, "liveops_client_view");
  const preview = fnBody(RUNME, "liveops_client_preview");
  assert.match(view, /liveops_client_payload/, "the token surface uses the shared builder");
  assert.match(preview, /liveops_client_payload/, "the staff preview uses the SAME builder");

  // And the route must not assemble its own object from the payload's parts.
  assert.match(ROUTE, /return NextResponse\.json\(payload,/,
    "the API route passes the payload through verbatim — it makes no redaction decision of its own");
});

test("★ not one forbidden column is even NAMED inside the client payload builder", () => {
  const leaks = FORBIDDEN_IN_CLIENT_PAYLOAD.filter((c) => PAYLOAD.includes(c));
  assert.deepStrictEqual(leaks, [],
    `the client payload must not reference these columns at all: ${leaks.join(", ")}`);
});

test("the payload is a whitelist, never a select *", () => {
  assert.ok(!/select \*/i.test(PAYLOAD),
    "a select * would silently start shipping every future column added to a table");
  // Named-column selects only.
  assert.match(PAYLOAD, /select s\.title, s\.client_status/, "the session read names its columns");
});

test("★ the internal incident description never reaches the client; only an APPROVED summary does", () => {
  assert.ok(!/\bi\.description\b/.test(PAYLOAD), "the internal incident description is never selected");
  assert.match(PAYLOAD, /i\.client_summary_approved = true/,
    "only incidents whose client summary was explicitly approved appear at all");
  assert.match(PAYLOAD, /'summary', i\.client_summary/,
    "the client sees the summary written FOR them, not the internal description");
});

test("★ the internal root cause is withheld unless it was explicitly released", () => {
  assert.match(
    PAYLOAD,
    /'root_cause', case when i\.root_cause_released then i\.root_cause else null end/,
    "root_cause is NULL unless root_cause_released is true",
  );

  // Releasing is a management decision, needs a written reason, is audited, and
  // — crucially — the released text is scanned before it can ever be shown.
  const release = fnBody(RUNME, "liveops_incident_release_root_cause");
  assert.match(release, /liveops_can_reveal_root_cause/, "release is manager-only");
  assert.match(release, /سبب الإفراج إلزاميّ/, "a written reason is mandatory");
  assert.match(release, /liveops_has_secret\(i\.root_cause\)/,
    "the released text passes the secret scanner — otherwise release would bypass the whole guard");
  assert.match(release, /liveops_log\('incident_root_cause_release'/, "the release is audited");
});

test("★ the report reaches a client only once APPROVED — a draft is nothing", () => {
  assert.match(PAYLOAD, /'report', case when v_rep_status is distinct from 'approved' then null else/,
    "draft and pending_approval both render as null, not as partial content");
  // ...and approval demands a client-facing summary, so an approved report is never empty.
  const approve = fnBody(RUNME, "liveops_report_approve");
  assert.match(approve, /الملخّص المخصَّص للعميل إلزاميّ قبل الاعتماد/);
  assert.match(approve, /liveops_can_approve_report/);
});

test("the camera figure is a COUNT and nothing else — no labels, roles or serials", () => {
  assert.match(PAYLOAD, /'cameras', jsonb_build_object\('active', coalesce\(v_cams,0\), 'planned', coalesce\(v_cams_total,0\)\)/);
  assert.ok(!/i\.label/.test(PAYLOAD), "no inventory label is ever emitted to a client");
  assert.ok(!/i\.assigned_user_id/.test(PAYLOAD), "no internal user id is ever emitted");
});

test("network figures are collapsed to coarse words, never numbers", () => {
  for (const word of ["nominal", "degraded", "interrupted", "unknown"]) {
    assert.ok(PAYLOAD.includes(`'${word}'`), `the coarse vocabulary must include ${word}`);
  }
  for (const n of ["upload_kbps", "latency_ms", "packet_loss_pct"]) {
    assert.ok(!PAYLOAD.includes(n), `${n} is operational detail and must not leave the building`);
  }
});

// ─── The save-time pattern scanner ──────────────────────────────────────────

test("★★ a secret pasted into a client-facing field is refused at SAVE time", () => {
  const scanner = fnBody(RUNME, "liveops_secret_reason");
  assert.ok(scanner.length > 200, "the scanner must exist");

  // Every class named in the brief has a rule.
  for (const cls of [
    "ip_address",        // IP addresses
    "stream_endpoint",   // rtmp/srt/... ingest URLs
    "stream_key",        // stream keys
    "credential",        // passwords / API keys / tokens
    "storage_path",      // storage paths
    "serial_number",     // equipment serial numbers
    "financial",         // costs
    "contact_identifier",// internal usernames / emails / phone numbers
    "backup_topology",   // detailed backup topology
  ]) {
    assert.ok(scanner.includes(`'${cls}'`), `the scanner must classify ${cls}`);
  }

  // NULL text is not a secret — a scanner that fires on NULL blocks every insert.
  assert.match(scanner, /when p_text is null or btrim\(p_text\) = '' then null/);
});

test("★★ the scanner is wired as a trigger on EVERY table holding client-readable text", () => {
  const guard = fnBody(RUNME, "liveops_client_text_guard");
  // Session title AND client notes: both are emitted by the payload builder.
  assert.match(guard, /when 'liveops_sessions'\s+then array\['title','client_notes'\]/,
    "the session title reaches the client, so it must be scanned too");
  assert.match(guard, /when 'liveops_incidents'\s+then array\['client_summary'\]/);
  assert.match(guard, /when 'liveops_bulletins'\s+then array\['title','body'\]/);
  assert.match(guard, /when 'liveops_client_people' then array\['display_name','role_label'\]/);
  assert.match(guard, /when 'liveops_reports'\s+then array\['client_summary','incident_summary_client'/);

  // And the trigger is actually attached to all seven.
  const attached = RUNME.match(/'liveops_sessions','liveops_incidents','liveops_bulletins',\s*\n\s*'liveops_client_people','liveops_reports','liveops_rundown','liveops_inventory'/g);
  assert.ok(attached && attached.length >= 1, "the seven tables are looped over when attaching _secret_scan");
  assert.match(RUNME, /create trigger %I before insert or update on public\.%I for each row execute function public\.liveops_client_text_guard\(\)/);
});

test("the rundown/inventory scan runs only when the row is actually client-visible", () => {
  const guard = fnBody(RUNME, "liveops_client_text_guard");
  assert.match(guard, /tg_table_name in \('liveops_rundown','liveops_inventory'\)/);
  assert.match(guard, /client_visible'\)::boolean, false\) = false/,
    "an internal-only rundown item may name equipment freely — it never leaves the building");
});

test("the guard reads the row via to_jsonb, not by passing a RECORD into EXECUTE", () => {
  const guard = fnBody(RUNME, "liveops_client_text_guard");
  assert.match(guard, /v_row := to_jsonb\(new\)/);
  assert.ok(!/using new/.test(guard),
    "passing a RECORD as a query parameter fails at runtime with 'could not determine data type'");
});

test("client visibility defaults to FALSE everywhere — nothing is exposed by forgetting", () => {
  assert.match(RUNME, /client_visible boolean not null default false/);
  // Two tables carry the flag; both default to hidden.
  const occurrences = RUNME.match(/client_visible\s+boolean not null default false/g) ?? [];
  assert.ok(occurrences.length >= 2, "both rundown and inventory default to hidden");
});

// ─── The rendered page ──────────────────────────────────────────────────────

test("the public page renders only the closed list, and no forbidden field name appears in it", () => {
  for (const c of ["internal_notes", "root_cause_internal", "token_hash", "storage_path", "serial"]) {
    assert.ok(!PAGE.includes(`data.${c}`), `the page must not read ${c}`);
  }
  // The permitted surface is present.
  for (const frag of ["data.event.status", "data.segments.current", "data.cameras.active",
                      "data.technical.stream", "data.people", "data.bulletins", "data.report"]) {
    assert.ok(PAGE.includes(frag), `the client page should render ${frag}`);
  }
});

test("the page shows a root cause ONLY when the payload carried one", () => {
  assert.match(PAGE, /\{x\.root_cause && \(/,
    "no placeholder, no 'unavailable' text — an unreleased root cause simply does not render");
});
