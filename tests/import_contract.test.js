// ════════════════════════════════════════════════════════════════════════════
// tests/import_contract.test.js — the ARCHITECTURAL guards.
//
// The engine is supposed to be reusable for ANY Kian project. These tests fail
// the moment it stops being: a client name leaking into the code, a hard-coded
// stage list, a random id in a key, a heavyweight dependency sneaking into
// package.json, a route reaching for the service-role key, or a new capability
// shipped without the "migration pending" fallback.
// ════════════════════════════════════════════════════════════════════════════
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadTs, ROOT } = require("./import_engine_loader");

const ENGINE_DIR = path.join(ROOT, "lib/portal/import");
const ROUTE_DIR = path.join(ROOT, "app/api/portal/import");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const engineFiles = fs.readdirSync(ENGINE_DIR).filter((f) => f.endsWith(".ts"));
const engineSrc = Object.fromEntries(engineFiles.map((f) => [f, fs.readFileSync(path.join(ENGINE_DIR, f), "utf8")]));
/** Code only — a word inside a comment does not make it a dependency. */
const codeOf = (s) =>
  s
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");

// ─── the engine is generic ─────────────────────────────────────────────────
test("no client/project name appears anywhere in the engine — not even in a comment", () => {
  // Deliberately scans comments too: an example key in a header comment is how
  // a client name gets copied into real code six months later.
  for (const [file, src] of Object.entries(engineSrc)) {
    assert.equal((src.match(/misbar/gi) ?? []).length, 0, `${file} names a specific project`);
  }
  for (const r of ["preview", "execute", "profiles"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROUTE_DIR, r, "route.ts"), "utf8"), /misbar/i, `route ${r} names a specific project`);
  }
});

test("mapping profiles are discovered as data — the code names a directory, never a file", () => {
  const { ensureDiskProfiles } = loadTs("lib/portal/import/server.ts");
  const { listProfiles, getProfile } = loadTs("lib/portal/import/profiles.ts");
  const found = ensureDiskProfiles();
  assert.deepEqual(found.errors, [], "every shipped profile file must be valid");
  assert.ok(found.directory && found.directory.endsWith(path.join("docs", "import_profiles")));
  assert.ok(found.loaded.length >= 1, "the profile directory must yield at least one profile");
  for (const id of found.loaded) assert.equal(getProfile(id).id, id);
  assert.ok(listProfiles().some((p) => p.builtIn), "the generic profile stays available whatever is on disk");
  // calling it again is a no-op, not a re-read
  assert.deepEqual(ensureDiskProfiles(), found);
});

test("the engine hard-codes no stage list, no deliverable count and no platform list", () => {
  const forbidden = [/\b79\b/, /\b11\s*(stages|مرحلة)/i, /const\s+STAGES\b/, /const\s+PLATFORMS\b/, /\bإنستغرام\b/, /"انستغرام"/];
  for (const [file, src] of Object.entries(engineSrc)) {
    if (file === "profile.ts") continue; // holds the DEFAULT profile, which IS data
    const code = codeOf(src);
    for (const re of forbidden) assert.doesNotMatch(code, re, `${file} hard-codes project content (${re})`);
  }
  // Even the default profile keeps its vocabulary inside the data structures.
  const p = loadTs("lib/portal/import/profile.ts").DEFAULT_PROFILE;
  assert.ok(Array.isArray(p.levels), "levels are data");
  assert.ok(p.levels.length >= 1);
  assert.equal(typeof p.typeMap.video[0], "string");
});

test("depth is profile-driven — the engine never assumes exactly one sub-level", () => {
  const { normalizeProfile } = loadTs("lib/portal/import/profile.ts");
  const { buildPlan } = loadTs("lib/portal/import/preview.ts");
  const { parseCsv } = loadTs("lib/portal/import/csvParse.ts");
  const threeLevels = normalizeProfile({
    id: "deep",
    fields: {
      title: { synonyms: ["البند"] },
      season: { synonyms: ["الموسم"] },
      episode: { synonyms: ["الحلقة"] },
      scene: { synonyms: ["المشهد"] },
    },
    levels: [
      { key: "season", label: "الموسم", field: "season" },
      { key: "episode", label: "الحلقة", field: "episode" },
      { key: "scene", label: "المشهد", field: "scene" },
    ],
  });
  const sheet = parseCsv("الموسم,الحلقة,المشهد,البند\nالأول,1,أ,لقطة افتتاحية\nالأول,1,ب,لقطة ثانية\n");
  const plan = buildPlan({ sheet, profile: threeLevels, context: { projectKey: "k" } });
  assert.equal(plan.counts.accepted, 2);
  assert.equal(plan.deliverables[0].level_path.length, 3);
  assert.equal(plan.nodes.filter((n) => n.levelIndex === 2).length, 2, "the third level is materialised too");

  const flat = normalizeProfile({ id: "flat", fields: { title: { synonyms: ["البند"] } }, levels: [] });
  const flatPlan = buildPlan({ sheet: parseCsv("البند\nمهمة\n"), profile: flat, context: { projectKey: "k" } });
  assert.equal(flatPlan.counts.accepted, 1, "a flat sheet with no levels at all must import");
  assert.equal(flatPlan.deliverables[0].parentKey, null);
  assert.equal(flatPlan.nodes.length, 0);
});

test("nothing in the engine assumes a deliverable is a video or has a date", () => {
  const { normalizeProfile } = loadTs("lib/portal/import/profile.ts");
  const { buildPlan } = loadTs("lib/portal/import/preview.ts");
  const { parseCsv } = loadTs("lib/portal/import/csvParse.ts");
  const p = normalizeProfile({ id: "min", fields: { title: { synonyms: ["البند"] } }, levels: [] });
  const plan = buildPlan({ sheet: parseCsv("البند\nطباعة كتيّب\n"), profile: p, context: { projectKey: "k" } });
  const d = plan.deliverables[0];
  assert.equal(d.type, "other");
  assert.equal(d.due_date, null);
  assert.deepEqual(d.platforms, []);
  assert.equal(d.schedule_status, "awaiting_schedule");
});

// ─── determinism ───────────────────────────────────────────────────────────
test("key generation contains no randomness and no clock", () => {
  // `new Date(…)` with arguments is calendar arithmetic (validating a parsed
  // date); `new Date()` with none is a clock read and is what must never touch
  // a key or a value.
  for (const file of ["keys.ts", "sha256.ts", "mapping.ts", "text.ts"]) {
    const code = codeOf(engineSrc[file]);
    assert.doesNotMatch(code, /Math\.random|randomUUID|Date\.now|new Date\(\)/, `${file} must be deterministic`);
  }
  // preview.ts may stamp generatedAt, but nothing else may read the clock.
  const preview = codeOf(engineSrc["preview.ts"]);
  assert.equal((preview.match(/new Date\(\)/g) ?? []).length, 1);
  assert.match(preview, /generatedAt: new Date\(\)\.toISOString\(\)/);
  assert.doesNotMatch(preview, /Math\.random|randomUUID/);
  // and no file may quietly stamp "today" onto a row
  for (const [file, src] of Object.entries(engineSrc)) {
    assert.doesNotMatch(codeOf(src), /due_date\s*[:=]\s*(new Date|today)/i, `${file} fabricates a due date`);
  }
});

test("the stored type always stays inside the live CHECK domain", () => {
  const { canonicalType } = loadTs("lib/portal/import/profile.ts");
  const { DEFAULT_PROFILE } = loadTs("lib/portal/import/profile.ts");
  const allowed = ["video", "photo", "other"];
  const code = codeOf(engineSrc["profile.ts"]);
  const domain = code.match(/\["video", "photo", "other"\]|"video" \| "photo" \| "other"/g) ?? [];
  assert.ok(domain.length >= 1, "the domain must be stated explicitly in code");
  for (const s of ["", "شيء", "video", "PHOTO", "فيديو 4K", "ريلز طويل"]) {
    assert.ok(allowed.includes(canonicalType(s, DEFAULT_PROFILE).type));
  }
});

// ─── dependencies ──────────────────────────────────────────────────────────
test("no spreadsheet/zip dependency was added to package.json", () => {
  const pkg = JSON.parse(read("package.json"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const banned of ["xlsx", "exceljs", "jszip", "adm-zip", "pako", "node-xlsx", "fflate", "papaparse"]) {
    assert.equal(deps[banned], undefined, `${banned} must not be a dependency — the engine reads xlsx natively`);
  }
});

test("the engine imports nothing from the rest of the app", () => {
  for (const [file, src] of Object.entries(engineSrc)) {
    const imports = [...codeOf(src).matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      // Only sibling modules, plus node: builtins in the server-only helper.
      const ok = spec.startsWith("./") || (file === "server.ts" && spec.startsWith("node:"));
      assert.ok(ok, `${file} imports ${spec} — the engine must stay self-contained (other agents edit those files)`);
    }
    assert.doesNotMatch(codeOf(src), /lib\/portal\/(mfa|useSensitiveWrite|MfaStepUp)/, `${file} touches frozen security code`);
  }
});

// ─── the mapping profile is data ───────────────────────────────────────────
test("the shipped profile file is pure JSON data, not code", () => {
  const raw = read("docs/import_profiles/misbar10.json");
  const parsed = JSON.parse(raw); // throws if it is not valid JSON
  const allowedTop = ["$comment", "id", "version", "label", "description", "sheet", "headerRow", "levels", "fields", "typeMap", "contentTypeKeys", "priorityKeys", "skipRowValues", "keyStrategy", "defaultScheduleStatus", "defaultStatus"];
  for (const k of Object.keys(parsed)) assert.ok(allowedTop.includes(k), `unknown profile key «${k}» — a profile is data with a fixed shape`);
  assert.equal(parsed.defaultScheduleStatus, "awaiting_schedule");
  assert.equal(parsed.keyStrategy, "identity");
  assert.deepEqual(Object.keys(parsed.typeMap).sort(), ["$comment", "other", "photo", "video"]);
  for (const level of parsed.levels) assert.ok(parsed.fields[level.field], `level ${level.key} points at a missing field`);
  const { listProfiles } = loadTs("lib/portal/import/profiles.ts");
  assert.ok(listProfiles().some((p) => p.id === parsed.id));
});

test("the CSV template exists, is BOM-prefixed for Excel, and matches the profile", () => {
  const bytes = fs.readFileSync(path.join(ROOT, "docs/templates/project_import_template.csv"));
  assert.deepEqual([bytes[0], bytes[1], bytes[2]], [0xef, 0xbb, 0xbf], "Excel needs the UTF-8 BOM to read Arabic");
  const header = bytes.toString("utf8").replace(/^﻿/, "").split("\r\n")[0];
  for (const col of ["المحتوى", "نوع المحتوى", "المنصات", "تفاصيل التنفيذ", "نص الوصف المقترح"]) {
    assert.ok(header.includes(col), `the template is missing the «${col}» column`);
  }
});

// ─── routes ────────────────────────────────────────────────────────────────
test("all three API routes exist and are server-only", () => {
  for (const r of ["preview", "execute", "profiles"]) {
    const p = path.join(ROUTE_DIR, r, "route.ts");
    assert.ok(fs.existsSync(p), `missing route ${r}`);
    const src = fs.readFileSync(p, "utf8");
    assert.match(src, /export const runtime = "nodejs"/);
    assert.match(src, /export const dynamic = "force-dynamic"/);
  }
});

test("routes require the caller's own token and never use the service-role key", () => {
  for (const r of ["preview", "execute", "profiles"]) {
    const src = fs.readFileSync(path.join(ROUTE_DIR, r, "route.ts"), "utf8");
    assert.match(src, /bearerOf\(req\)/, `${r} does not read a Bearer token`);
    assert.match(src, /status: 401/, `${r} does not reject an anonymous caller`);
    assert.doesNotMatch(src, /SERVICE_ROLE/, `${r} must run as the user, never as service-role`);
  }
  assert.doesNotMatch(read("lib/portal/import/server.ts"), /SERVICE_ROLE/, "the import path must never hold service-role power");
});

test("the preview route stays read-only and the execute route re-derives the plan", () => {
  const preview = read("app/api/portal/import/preview/route.ts");
  assert.doesNotMatch(codeOf(preview), /executeImport|project_import_execute/, "the preview route must never write");
  const exec = read("app/api/portal/import/execute/route.ts");
  assert.match(exec, /planFromInput\(read\.input, call\)/, "execute must rebuild the plan from the uploaded bytes");
  assert.doesNotMatch(codeOf(exec), /body\.plan|input\.plan/, "a plan supplied by the client must never be trusted");
});

// ─── server helpers ────────────────────────────────────────────────────────
test("project keys are slugs, never UUIDs, so keys survive project creation", () => {
  const { resolveProjectKey, ensureDiskProfiles } = loadTs("lib/portal/import/server.ts");
  const { getProfile } = loadTs("lib/portal/import/profiles.ts");
  const profile = getProfile(ensureDiskProfiles().loaded[0]);
  assert.equal(resolveProjectKey({ projectKey: "حملة الوعي", parentProjectTitle: null, projectId: null }, profile), "حملة-الوعي");
  assert.equal(resolveProjectKey({ projectKey: null, parentProjectTitle: "حملة الوعي", projectId: null }, profile), "حملة-الوعي");
  const fromId = resolveProjectKey({ projectKey: null, parentProjectTitle: null, projectId: "0f7f1b12-1111-4000-8000-000000000001" }, profile);
  assert.equal(fromId, "p-0f7f1b12");
  assert.equal(resolveProjectKey({ projectKey: null, parentProjectTitle: null, projectId: null }, profile), `${profile.id}-default`);
});

test("the request reader defaults to dry_run — a commit must be asked for", async () => {
  const { readImportRequest } = loadTs("lib/portal/import/server.ts");
  const jsonReq = (body) => new Request("https://example.test/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const a = await readImportRequest(jsonReq({ text: "البند\nمهمة\n" }));
  assert.equal(a.ok, true);
  assert.equal(a.input.mode, "dry_run");
  const b = await readImportRequest(jsonReq({ text: "البند\nمهمة\n", mode: "commit", skipInvalidRows: true }));
  assert.equal(b.input.mode, "commit");
  assert.equal(b.input.skipInvalidRows, true);
  const missing = await readImportRequest(jsonReq({}));
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);
  assert.match(missing.error, /لا يوجد ملف/);
});

test("planFromInput runs the two-pass plan and degrades when the lookup is absent", async () => {
  const { planFromInput, ensureDiskProfiles } = loadTs("lib/portal/import/server.ts");
  const csv = "المرحلة,المحتوى,المنصات\nالتمهيد,لقطة أولى,انستغرام\nالتمهيد,لقطة ثانية,انستغرام\n";
  const input = {
    bytes: null,
    text: csv,
    fileName: "x.csv",
    profileId: ensureDiskProfiles().loaded[0],
    profile: null,
    projectId: null,
    projectKey: "مشروع",
    parentProjectTitle: null,
    sheet: null,
    mode: "dry_run",
    skipInvalidRows: false,
    includeUnchanged: false,
    batchLabel: null,
  };

  // no caller at all (pure client-side preview)
  const offline = await planFromInput(input, null);
  assert.equal(offline.plan.counts.accepted, 2);
  assert.equal(offline.plan.existingLookupAvailable, false);

  // lookup RPC missing → the plan is still complete, and NO cause is invented.
  // The consequence the UI states is the true one ("matching unavailable, every
  // row reads as new"); asserting «الترحيلة غير مطبّقة» here contradicted the
  // green «قاعدة البيانات جاهزة للاستيراد» produced by detectBackend() on the
  // very same screen, because production runs the staging-batch protocol and has
  // never had project_import_lookup.
  const missing = await planFromInput(input, async () => ({ ok: false, error: "PGRST202 could not find the function", status: 404 }));
  assert.equal(missing.plan.counts.accepted, 2);
  assert.equal(missing.plan.existingLookupAvailable, false);
  assert.equal(missing.lookupReason, null, "★ عاد ادّعاء «الترحيلة غير مطبّقة» إلى المعاينة");

  // lookup available → the second pass classifies the known row as unchanged
  const firstKey = offline.plan.deliverables[0].external_key;
  const firstHash = offline.plan.deliverables[0].content_hash;
  const live = await planFromInput(input, async (fn) => {
    assert.equal(fn, "project_import_lookup");
    return { ok: true, data: { rows: [{ external_key: firstKey, content_hash: firstHash, id: "existing-1" }] } };
  });
  assert.equal(live.plan.counts.deliverablesUnchanged, 1);
  assert.equal(live.plan.counts.deliverablesToCreate, 1);
  assert.equal(live.plan.existingLookupAvailable, true);

  // a profile posted as DATA wins over the registered id (client-side preview)
  const inline = await planFromInput(
    { ...input, profileId: null, profile: { id: "posted", fields: { title: { synonyms: ["المحتوى"] } }, levels: [] } },
    null,
  );
  assert.equal(inline.profile.id, "posted");
  assert.ok(inline.plan.deliverables[0].external_key.startsWith("posted:"));
});

// ─── the public surface stays stable ───────────────────────────────────────
test("the engine's index exports the whole documented surface", () => {
  const api = loadTs("lib/portal/import/index.ts");
  for (const name of [
    "parseWorkbook",
    "pickSheet",
    "parseCsv",
    "parseXlsx",
    "buildPlan",
    "buildExecutePayload",
    "executeImport",
    "normalizeExecuteResponse",
    "detectBackend",
    "lookupExisting",
    "classifyMissing",
    "getProfile",
    "listProfiles",
    "resolveProfile",
    "externalKey",
    "contentHash",
    "MIGRATION_PENDING_AR",
    "IMPORT_RPC",
  ]) {
    assert.ok(api[name] !== undefined, `index.ts does not export ${name}`);
  }
  assert.deepEqual(api.IMPORT_RPC, {
    capabilities: "project_import_capabilities",
    lookup: "project_import_lookup",
    execute: "project_import_execute",
  });
});

test("every RPC the engine calls is declared in one place per protocol", () => {
  const rpc = read("lib/portal/import/rpc.ts");
  for (const name of ["project_import_capabilities", "project_import_lookup", "project_import_execute"]) {
    assert.ok(rpc.includes(name), `${name} is not documented in rpc.ts`);
  }
  const batch = read("lib/portal/import/batchBackend.ts");
  for (const name of ["import_batch_create", "import_batch_load_rows", "import_batch_preview", "import_batch_dry_run", "import_batch_execute", "import_batch_report"]) {
    assert.ok(batch.includes(name), `${name} is not declared in batchBackend.ts`);
  }
  // Call sites use the registries, not loose strings. The single exception is
  // rpc.ts's capability probe, which cannot import batchBackend (cycle).
  for (const [file, src] of Object.entries(engineSrc)) {
    if (file === "rpc.ts" || file === "batchBackend.ts") continue;
    assert.doesNotMatch(codeOf(src), /"(project_import|import_batch)_[a-z_]+"/, `${file} hard-codes an RPC name instead of using the registry`);
  }
});

test("both write protocols are detected, and neither is assumed", () => {
  const { detectBackend } = loadTs("lib/portal/import/rpc.ts");
  assert.equal(typeof detectBackend, "function");
  const exec = read("lib/portal/import/execute.ts");
  assert.match(exec, /backend\.protocol === "batch"/, "execute must dispatch on the detected protocol");
  // the batch driver never writes without being told which project to write into
  const batch = read("lib/portal/import/batchBackend.ts");
  assert.match(batch, /NO_TARGET_PROJECT_AR/);
  // …and it never sends a value the database's CHECKs would reject
  for (const list of ["DB_STATUS", "DB_SCHEDULE_STATUS", "DB_PRIORITY"]) assert.ok(batch.includes(list), `${list} missing`);
  assert.match(batch, /DB_CONTENT_TYPE_FALLBACK = "custom"/, "unknown kinds must land on a real catalog key");
});
