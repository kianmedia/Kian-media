// ════════════════════════════════════════════════════════════════════════════
// tests/ai_retrieval_isolation.test.js — WHO MAY READ WHAT, AND NOTHING ELSE.
//
// Four separations, each of which would be a real leak if it failed:
//   1. CROSS-CLIENT   — one client can never retrieve another client's material,
//                       and the mechanism is stronger than a filter: no client
//                       material is in the registry at all, and the external
//                       roles are capped at 'public' by a table CHECK.
//   2. CROSS-ROLE     — sales cannot reach operations procedures or HR policy;
//                       collections cannot reach costs or pricing; operations
//                       cannot reach margin; marketing cannot reach restricted
//                       compliance material.
//   3. SENSITIVITY    — 'restricted' is owner-only, by CHECK, not by convention.
//   4. APPROVAL       — an unapproved source is not merely filtered out of the
//                       results: it is NEVER INDEXED, so there is nothing to
//                       retrieve in the first place.
//
// And one rule that is easy to break by accident and is therefore pinned:
// ⛔ PROJECT MEMBERSHIP IS NEVER A GATE. Not in the roles, not in retrieval,
//    not in RLS. The brief forbids it, and a project-membership join here would
//    silently make the assistant's reach depend on staffing decisions.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, FILES, fnBody, seedBlock, stripComments } = require("./ai_helpers");

const RUNME = R(FILES.RUNME);
const SEARCH = fnBody(RUNME, "ai_search_sources");
const PERMITTED = fnBody(RUNME, "ai_source_permitted_for");
const ROLES_FN = fnBody(RUNME, "ai_actor_roles");
const PUBLIC_ASK = fnBody(RUNME, "ai_public_ask");
const MATRIX = seedBlock(RUNME, "ai_role_source_access");

/** Parse the seeded access matrix into rows: [role, source_type, max_sensitivity]. */
function matrixRows() {
  const rows = [];
  const re = /\('([a-z_]+)','([a-z_]+)','([a-z]+)'/g;
  let m;
  while ((m = re.exec(MATRIX)) !== null) rows.push({ role: m[1], type: m[2], max: m[3] });
  return rows;
}

const RANK = { public: 0, internal: 1, restricted: 2 };
const reach = (role, type) => {
  const r = matrixRows().find((x) => x.role === role && x.type === type);
  return r ? RANK[r.max] : null;    // null = the role has NO entry ⇒ no access at all
};

// ─── 0) the matrix is real ──────────────────────────────────────────────────

test("the access matrix is seeded as DATA, and covers all seven roles", () => {
  const rows = matrixRows();
  assert.ok(rows.length >= 40, `the matrix must actually be seeded (found ${rows.length})`);
  for (const role of ["owner", "sales", "operations", "collections", "marketing", "client", "anonymous"]) {
    assert.ok(rows.some((r) => r.role === role), `the matrix must place ${role}`);
  }
});

// ─── 1) CROSS-CLIENT ────────────────────────────────────────────────────────

test("★ cross-client retrieval is impossible: the registry holds no client-scoped material at all", () => {
  // The strongest form of isolation is absence. ai_knowledge_sources has no
  // client_id, no project_id, no deliverable reference — so there is no client
  // material to leak between clients, and no filter that could be forgotten.
  const table = RUNME.slice(
    RUNME.indexOf("create table if not exists public.ai_knowledge_sources"),
    RUNME.indexOf("create index if not exists ai_sources_status_idx"),
  );
  assert.ok(table.length > 500, "the table definition was found");
  for (const forbidden of ["client_id", "project_id", "deliverable_id", "invoice_id", "quote_id", "opportunity_id"]) {
    assert.ok(!table.includes(forbidden), `the knowledge registry must not carry ${forbidden}`);
  }
});

test("★ a client account can only ever reach PUBLIC material — enforced by a CHECK, not a convention", () => {
  assert.match(
    RUNME,
    /ai_sources_external_public_only[\s\S]{0,400}?not \(allowed_roles && array\['client','anonymous'\]::text\[\]\) or sensitivity = 'public'/,
    "a source shared with client/anonymous must be public — enforced on the row itself",
  );
  assert.match(
    RUNME,
    /ai_role_source_access_external_public_only[\s\S]{0,300}?assistant_role not in \('client','anonymous'\) or max_sensitivity = 'public'/,
    "and the access matrix cannot grant them anything higher either",
  );
  // Both halves matter: the first stops a bad SOURCE, the second stops a bad MATRIX row.
  for (const role of ["client", "anonymous"]) {
    for (const row of matrixRows().filter((r) => r.role === role)) {
      assert.strictEqual(row.max, "public", `${role} must not reach ${row.max} (${row.type})`);
    }
  }
});

test("a non-staff account is classified 'client' no matter which gates answer true", () => {
  const code = stripComments(ROLES_FN);
  assert.match(
    code,
    /if not v_staff and not \('owner' = any\(v_roles\)\) then return array\['client'\]::text\[\]; end if;/,
    "internal roles are never derived for a non-staff caller",
  );
});

test("★ the client-facing assistant is not reachable from a client session at all", () => {
  const canUse = fnBody(RUNME, "ai_can_use_internal");
  assert.match(canUse, /if auth\.uid\(\) is null then return false; end if;/, "anonymous is refused");
  assert.match(canUse, /if not coalesce\(public\.ai_is_staff\(\), false\) then return false; end if;/,
    "a non-staff (client) session is refused before anything else is considered");
});

// ─── 2) CROSS-ROLE ──────────────────────────────────────────────────────────

test("★ sales cannot reach operations procedures, equipment procedures or HR policy", () => {
  for (const t of ["operations_procedure", "equipment_procedure", "hr_policy", "compliance_guide"]) {
    assert.strictEqual(reach("sales", t), null, `sales must have no entry for ${t}`);
  }
});

test("★ sales cannot reach pricing guidance — the margin/cost boundary", () => {
  assert.strictEqual(reach("sales", "pricing_guidance"), null,
    "pricing guidance is restricted and owner-only; sales must not have an entry for it");
});

test("★ collections reaches the collections workflow only — no cost, no margin, no pricing", () => {
  for (const t of ["pricing_guidance", "sales_guide", "operations_procedure", "equipment_procedure", "hr_policy", "approved_case_study"]) {
    assert.strictEqual(reach("collections", t), null, `collections must have no entry for ${t}`);
  }
});

test("★ operations cannot reach pricing guidance, sales guides or HR policy", () => {
  for (const t of ["pricing_guidance", "sales_guide", "hr_policy"]) {
    assert.strictEqual(reach("operations", t), null, `operations must have no entry for ${t}`);
  }
});

test("★ marketing reaches public content and approved case studies — not restricted compliance", () => {
  assert.strictEqual(reach("marketing", "compliance_guide"), null, "no compliance access");
  assert.strictEqual(reach("marketing", "hr_policy"), null, "no HR access");
  assert.strictEqual(reach("marketing", "pricing_guidance"), null, "no pricing access");
  assert.ok(reach("marketing", "approved_case_study") !== null, "but approved case studies are reachable");
});

test("only the owner reaches restricted material, and pricing guidance is one of them", () => {
  const restricted = matrixRows().filter((r) => r.max === "restricted");
  assert.ok(restricted.length > 0, "there is restricted material in the matrix");
  for (const r of restricted) {
    assert.strictEqual(r.role, "owner", `only the owner may hold a restricted entry (found ${r.role}/${r.type})`);
  }
  assert.strictEqual(reach("owner", "pricing_guidance"), RANK.restricted, "pricing guidance is owner+restricted");
});

test("the role gate map is DATA, is shape-constrained, and a missing gate never grants", () => {
  assert.match(RUNME, /ai_role_gate_map_signature_shape[\s\S]{0,300}?\^\[a-z_\]\[a-z0-9_\]\*\\\.\[a-z_\]\[a-z0-9_\]\*\\\(\\\)\$/,
    "only a zero-argument function signature may be stored");
  const gate = fnBody(RUNME, "ai_gate");
  assert.match(gate, /if v_oid is null then return false; end if;/, "an absent gate returns false");
  assert.match(gate, /exception when others then return false; end;/, "a raising gate returns false");
  assert.match(gate, /return coalesce\(v_ok, false\);/,
    "★ and a NULL from the gate collapses to FALSE — an undefined predicate is not a permission");
});

// ─── 3) SENSITIVITY ─────────────────────────────────────────────────────────

test("★ 'restricted' is owner-only on the row itself", () => {
  assert.match(
    RUNME,
    /ai_sources_restricted_owner_only[\s\S]{0,300}?sensitivity <> 'restricted' or allowed_roles <@ array\['owner'\]::text\[\]/,
    "a restricted source cannot name any role but owner",
  );
});

test("★ the retrieval predicate compares sensitivity RANKS — a higher class is never returned", () => {
  assert.match(
    PERMITTED,
    /ai_sensitivity_rank\(a\.max_sensitivity\) >= public\.ai_sensitivity_rank\(p_sensitivity\)/,
    "the caller's ceiling must be at least the source's sensitivity",
  );
  const rank = fnBody(RUNME, "ai_sensitivity_rank");
  assert.match(rank, /when 'public' then 0 when 'internal' then 1 else 2/, "the ordering is explicit");
  assert.match(rank, /coalesce\(p_sensitivity, 'restricted'\)/,
    "★ an unknown/NULL sensitivity is treated as the MOST restricted, never the least");
});

test("the permission predicate returns an explicit boolean and never NULL", () => {
  assert.match(PERMITTED, /select coalesce\(/, "the whole expression is wrapped in coalesce");
  assert.match(PERMITTED, /,\s*false\);/, "with false as the fallback — undefined is not permission");
  assert.match(PERMITTED, /stable security definer set search_path = public/, "definer with a pinned search_path");
  assert.ok(!/immutable/i.test(PERMITTED.split("$$")[0]),
    "it must be STABLE, not IMMUTABLE: it reads the access matrix and current_date, and caching that would keep a revoked grant alive");
});

// ─── 4) APPROVAL ────────────────────────────────────────────────────────────

test("★ an unapproved source is NEVER INDEXED — there is nothing to retrieve", () => {
  const reindex = fnBody(RUNME, "ai_source_reindex");
  assert.match(reindex, /delete from public\.ai_source_chunks where source_id = p_source_id;/,
    "reindex always clears the old index first");
  assert.match(reindex, /if s\.status <> 'approved' then return 0; end if;/,
    "★ and returns without writing a single chunk unless the source is approved");
  // Reject / archive / expire all re-run it, so the index cannot outlive approval.
  for (const fn of ["ai_source_reject", "ai_source_archive", "ai_sources_expire_due", "ai_source_upsert"]) {
    assert.match(fnBody(RUNME, fn), /ai_source_reindex/, `${fn} must re-run the indexer so the index cannot go stale`);
  }
});

test("retrieval requires approved + in-window + not archived, and matches the CURRENT version only", () => {
  assert.match(PERMITTED, /p_status = 'approved'/, "approved only");
  assert.match(PERMITTED, /p_archived_at is null/, "not archived");
  assert.match(PERMITTED, /p_effective_from is null or p_effective_from <= current_date/, "not before its start date");
  assert.match(PERMITTED, /p_expires_at is null or p_expires_at >= current_date/, "not after its expiry");
  assert.match(SEARCH, /c\.source_version = s\.version/,
    "★ chunks from a superseded version can never surface as current content");
});

test("approval is a complete act, and the approver is never the submitter", () => {
  assert.match(
    RUNME,
    /ai_sources_approved_is_complete[\s\S]{0,400}?approved_by is not null and approved_at is not null[\s\S]{0,120}?checksum is not null/,
    "approved requires an approver, a timestamp, a checksum and real content",
  );
  assert.match(
    RUNME,
    /ai_sources_approver_not_submitter[\s\S]{0,250}?approved_by <> submitted_by/,
    "and the approver may not be the submitter — a table constraint, not a UI rule",
  );
  const approve = fnBody(RUNME, "ai_source_approve");
  assert.match(approve, /approver_is_submitter/, "the RPC refuses it with a named reason before the constraint fires");
  assert.match(approve, /ai_forbidden_content/, "and re-scans the content for secrets AT APPROVAL, not only at entry");
});

test("editing an approved source drops it back to draft and bumps the version", () => {
  const upsert = fnBody(RUNME, "ai_source_upsert");
  assert.match(upsert, /v_status := case when s\.status = 'approved' then 'draft' else s\.status end/,
    "new content cannot keep an old approval stamp");
  assert.match(upsert, /version = case when s\.status = 'approved' then version \+ 1 else version end/,
    "and the version moves, so the old index no longer matches");
  assert.match(upsert, /approved_by = case when s\.status = 'approved' then null else approved_by end/,
    "the approver is cleared too");
});

// ─── 5) DOUBLE FILTERING + NO PROJECT MEMBERSHIP ────────────────────────────

test("★ permission filtering is applied TWICE: in RLS and again inside the retrieval WHERE", () => {
  assert.match(SEARCH, /where public\.ai_source_permitted_for\(/,
    "the retrieval function filters explicitly, not trusting RLS alone");
  assert.match(RUNME, /create policy ai_source_chunks_read on public\.ai_source_chunks for select to authenticated\s*\n\s*using \(coalesce\(public\.ai_source_is_permitted\(source_id\), false\)\)/,
    "and the chunk table has its own RLS policy over the same predicate");
});

test("★ the public surface pins retrieval to ['anonymous'] — the caller cannot name a role", () => {
  assert.match(
    PUBLIC_ASK,
    /ai_search_sources\(v_q, array\['anonymous'\]::text\[\]/,
    "the roles array is a literal in the function body",
  );
  const sig = PUBLIC_ASK.slice(0, PUBLIC_ASK.indexOf("as $$"));
  assert.ok(!/text\[\]/.test(sig), "and there is no roles parameter on the public function at all");
  const route = R(FILES.ROUTE);
  assert.ok(!/p_roles/.test(route), "nor does the HTTP route ever send one");
});

test("⛔ project membership is NEVER used as a gate anywhere in this module", () => {
  const code = stripComments(RUNME);
  for (const forbidden of ["project_members", "can_access_project", "pc_can_read_project", "project_team"]) {
    assert.ok(!code.includes(forbidden), `the assistant must not gate on ${forbidden}`);
  }
  assert.ok(!/project_id/.test(stripComments(SEARCH + PERMITTED + ROLES_FN)),
    "and no project reference appears in the roles or retrieval path");
});
