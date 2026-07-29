// ════════════════════════════════════════════════════════════════════════════
// tests/misbar10_private_paths.js — where the OWNER'S REAL FILES live, and what
// to do when they do not.
// (NOT a test file: `node --test tests/` only picks up *.test.js.)
//
// The real client workbook and everything extracted from it are LOCAL ONLY —
// they are git-ignored so no client content ever enters the repository's
// history. Two consequences this module exists to make honest:
//
//   1. PATHS. The private location is authoritative; the historical in-repo
//      location is accepted as a fallback so a half-finished migration (or a
//      machine that still has the old layout) keeps working.
//   2. ABSENCE IS NORMAL. On CI, on Vercel and in a fresh clone the files are
//      simply not there. Tests that need them must SKIP — loudly — never fail
//      and never quietly pass. A test that never ran must not look like a test
//      that passed, so every caller gets a skip REASON that names the missing
//      file, and a banner is printed to stderr once per run.
//
// The structural coverage that does NOT need client data lives in
// tests/misbar10_acceptance.test.js over tests/fixtures/misbar10_sanitized.json
// and runs everywhere, always.
// ════════════════════════════════════════════════════════════════════════════
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

/** Private (git-ignored) location first, historical in-repo location second. */
const CANDIDATES = {
  workbook: ["docs/input/private/MISBAR10_PLAN.xlsx", "docs/input/MISBAR10_PLAN.xlsx"],
  payload: ["docs/private-imports/misbar10_import_payload.json", "docs/misbar10_import_payload.json"],
  csv: ["docs/private-imports/misbar10_import_ready.csv", "docs/misbar10_import_ready.csv"],
  extract: ["docs/private-imports/misbar10_real.json", "tests/fixtures/misbar10_real.json"],
};

/** First existing candidate for `name`, or null. Absolute path. */
function resolveInput(name) {
  const list = CANDIDATES[name];
  if (!list) throw new Error(`unknown private input «${name}»`);
  for (const rel of list) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

const announced = new Set();

/**
 * Resolve every input a local-acceptance suite needs.
 *
 * @param {string} suite   the suite's own file name, for the banner
 * @param {string[]} names keys of CANDIDATES
 * @returns {{present: boolean, paths: Record<string, string|null>, missing: string[], opts: object, reason: string|null}}
 *   `opts` is `{}` when everything is present and `{ skip: <reason> }` when it
 *   is not — pass it straight to node:test's `test(name, opts, fn)` so the
 *   runner prints an explicit SKIP line carrying the reason.
 */
function localAcceptanceInputs(suite, names) {
  const paths = {};
  const missing = [];
  for (const n of names) {
    const p = resolveInput(n);
    paths[n] = p;
    if (p === null) missing.push(CANDIDATES[n][0]);
  }
  const present = missing.length === 0;
  const reason = present
    ? null
    : `SKIPPED — local acceptance only. Real client inputs are absent: ${missing.join(", ")}. ` +
      "They are git-ignored on purpose, so CI, Vercel and fresh clones are EXPECTED to skip this. " +
      "Structural coverage still runs in tests/misbar10_acceptance.test.js. " +
      "| تخطٍّ مقصود: ملفات العميل الحقيقية غير موجودة (محليّة فقط ولا تدخل Git).";

  if (!present && !announced.has(suite)) {
    announced.add(suite);
    // stderr, so it shows up in `npm test` output next to the SKIP lines.
    process.stderr.write(
      `\n[misbar10] ${suite}: SKIPPING every real-data test — missing ${missing.join(", ")}\n` +
        "[misbar10] this is expected without the owner's local files; nothing here silently passed.\n\n",
    );
  }
  return { present, paths, missing, reason, opts: present ? {} : { skip: reason } };
}

module.exports = { ROOT, CANDIDATES, resolveInput, localAcceptanceInputs };
