// ════════════════════════════════════════════════════════════════════════════
// tests/liveops_helpers.js — shared readers for the LIVE OPERATIONS package.
//
// Every liveops test reads the SHIPPED artefacts, not a copy of them. If a file
// is renamed or deleted the require() below throws and the suite fails loudly
// rather than silently asserting nothing — a test that passes because it found
// nothing is worse than no test.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const FILES = {
  RUNME: "docs/live_operations_dashboard_RUNME.sql",
  PREFLIGHT: "docs/live_operations_dashboard_PREFLIGHT.sql",
  POSTCHECK: "docs/live_operations_dashboard_POSTCHECK.sql",
  ROLLBACK: "docs/live_operations_dashboard_ROLLBACK.sql",
  LIB: "lib/portal/liveOps.ts",
  ROUTE: "app/api/public/live-status/route.ts",
  PUBLIC_PAGE: "app/live-status/page.tsx",
  CENTER: "components/portal/liveops/LiveOpsCenter.tsx",
  ATOMS: "components/portal/liveops/LiveOpsAtoms.tsx",
  PORTAL_PAGE: "app/client-portal/live-operations/page.tsx",
  NAV: "components/portal/nav.ts",
};

/**
 * Extract one `create or replace function public.<name>` body from the RUNME.
 * Returns "" when absent so a caller can assert absence explicitly instead of
 * crashing on undefined.
 */
function fnBody(sql, name) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  if (start < 0) return "";
  // The body is delimited by the first dollar-tag after the signature.
  const tagMatch = /\$([a-zA-Z_0-9]*)\$/.exec(sql.slice(start));
  if (!tagMatch) return "";
  const tag = tagMatch[0];
  const bodyStart = sql.indexOf(tag, start) + tag.length;
  const bodyEnd = sql.indexOf(tag, bodyStart);
  if (bodyEnd < 0) return "";
  return sql.slice(start, bodyEnd);
}

/** Columns that must never appear inside the client payload builder. */
const FORBIDDEN_IN_CLIENT_PAYLOAD = [
  // internal notes & contact details
  "internal_notes", "primary_contact_name", "primary_contact_phone",
  "emergency_contact_name", "emergency_contact_phone",
  // credentials & topology
  "token_hash", "adapter_id",
  // internal-only report halves
  "delivered_files_internal", "internal_summary", "incident_summary_internal",
  // raw network numbers (read as failure evidence by a client)
  "upload_kbps", "latency_ms", "packet_loss_pct",
  "current_bitrate_kbps", "target_bitrate_kbps",
  // internal logistics & identifiers
  "venue", "control_room", "session_code", "internal_ref",
  "mitigation", "operations_manager_id", "broadcast_director_id",
  "technical_director_id", "assigned_name", "prodops_job_id", "project_id",
];

module.exports = { root, R, FILES, fnBody, FORBIDDEN_IN_CLIENT_PAYLOAD };
