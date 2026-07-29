// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/server.ts — server-side glue for the import API routes.
//
// SECURITY POSTURE
//   • Every database call runs AS THE CALLER (the browser's Bearer token) so RLS
//     and the RPC's own permission checks decide what may be written. The
//     service-role key is never used by the import path — an import must not be
//     able to reach past the operator's own permissions.
//   • The route NEVER trusts a plan sent by the browser. It re-derives the plan
//     from the uploaded bytes. Because the engine is deterministic, the plan the
//     user approved and the plan the server executes are the same object.
// ════════════════════════════════════════════════════════════════════════════
import fs from "node:fs";
import path from "node:path";
import type { ImportPlan, ImportProfile } from "./types";
import type { RpcCaller, RpcOutcome } from "./rpc";
import { lookupExisting, lookupProjectRows } from "./rpc";
import { parseWorkbook, pickSheet } from "./parse";
import { registerProfile, resolveProfile } from "./profiles";
import { buildPlan } from "./preview";
import { deriveProjectKey, stableSlug } from "./keys";
import { cleanCell } from "./text";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const IMPORT_SERVER_CONFIGURED = Boolean(SUPABASE_URL && ANON_KEY);

/** Max upload accepted by the routes (the parser enforces its own limit too). */
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

// ─── mapping profiles discovered as DATA ───────────────────────────────────
// Profiles live as JSON files in a directory. The code names the DIRECTORY, never
// a file: which sheets a given client uses is data, and data must never become a
// symbol inside the platform. Discovery is best effort — if the directory is not
// present in the deployed bundle we keep the built-in generic profile (whose
// synonyms already cover the usual Arabic headers) and SAY SO, instead of
// throwing at the operator.
const PROFILE_DIR = path.join("docs", "import_profiles");

export interface ProfileDiscovery {
  loaded: string[];
  directory: string | null;
  errors: string[];
}

let discovery: ProfileDiscovery | null = null;

function candidateRoots(): string[] {
  const roots = [process.cwd()];
  // Walk up from this module too: in a bundled server build cwd is not the repo.
  let dir = typeof __dirname === "string" ? __dirname : "";
  for (let i = 0; i < 6 && dir; i++) {
    roots.push(dir);
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return roots;
}

/** Register every profile JSON found on disk. Idempotent and never throws. */
export function ensureDiskProfiles(): ProfileDiscovery {
  if (discovery) return discovery;
  const result: ProfileDiscovery = { loaded: [], directory: null, errors: [] };
  for (const root of candidateRoots()) {
    const dir = path.join(root, PROFILE_DIR);
    let names: string[];
    try {
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
      names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".json"));
    } catch {
      continue;
    }
    result.directory = dir;
    for (const name of names.sort()) {
      try {
        const p = registerProfile(JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
        result.loaded.push(p.id);
      } catch (e) {
        // A malformed profile disables ITSELF, never the importer.
        result.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    break;
  }
  discovery = result;
  return result;
}

export function bearerOf(req: Request): string {
  const auth = req.headers.get("authorization") ?? "";
  return auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
}

/**
 * PostgREST RPC caller bound to one user token. Error strings keep the PostgREST
 * `code` so classifyMissing() can recognise "migration not applied yet".
 */
export function createRpcCaller(token: string): RpcCaller {
  return async <T,>(fn: string, args: Record<string, unknown>): Promise<RpcOutcome<T>> => {
    if (!IMPORT_SERVER_CONFIGURED) return { ok: false, error: "server_not_configured", status: 0 };
    let res: Response;
    try {
      res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
        cache: "no-store",
      });
    } catch (e) {
      return { ok: false, error: String(e), status: 0 };
    }
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const b = (body ?? {}) as Record<string, unknown>;
      const parts = [b.code, b.message, b.details, b.hint].filter((x) => typeof x === "string" && x) as string[];
      return { ok: false, error: parts.length ? parts.join(" | ") : `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, data: body as T };
  };
}

export interface ImportRequestInput {
  bytes: Uint8Array | null;
  text: string | null;
  fileName: string;
  profileId: string | null;
  /** A whole profile posted as data (wins over profileId when present). */
  profile: unknown;
  projectId: string | null;
  projectKey: string | null;
  parentProjectTitle: string | null;
  sheet: string | null;
  mode: "dry_run" | "commit";
  skipInvalidRows: boolean;
  includeUnchanged: boolean;
  /** Explicit confirmation that stored records may be overwritten. */
  applyUpdates: boolean;
  /** Explicit answer for renamed-title conflicts; null = not answered ⇒ refuse. */
  conflictResolution: "skip" | "create" | null;
  batchLabel: string | null;
}

const asBool = (v: unknown): boolean => v === true || v === "true" || v === "1";
/** Only the two literal answers count. Anything else means "not answered". */
const asConflictChoice = (v: unknown): "skip" | "create" | null => (v === "skip" ? "skip" : v === "create" ? "create" : null);
/** A profile may be posted as an object (JSON body) or a JSON string (form). */
const parseInlineProfile = (v: unknown): unknown => {
  if (v && typeof v === "object") return v;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      return JSON.parse(v);
    } catch {
      return null;
    }
  }
  return null;
};
const asStr = (v: unknown): string | null => {
  if (v == null) return null;
  const s = cleanCell(String(v));
  return s === "" ? null : s;
};

/**
 * Read either a multipart upload (field `file`) or a JSON body carrying inline
 * CSV text (field `text`) — the latter keeps the engine testable and lets the UI
 * support paste-a-table without a second code path.
 */
export async function readImportRequest(req: Request): Promise<{ ok: true; input: ImportRequestInput } | { ok: false; error: string; status: number }> {
  const ctype = req.headers.get("content-type") ?? "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return { ok: false, error: "لم يُرفَع أي ملف.", status: 400 };
      if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "حجم الملف يتجاوز الحدّ المسموح (12 ميجابايت).", status: 413 };
      const bytes = new Uint8Array(await file.arrayBuffer());
      const g = (k: string): unknown => form.get(k);
      return {
        ok: true,
        input: {
          bytes,
          text: null,
          fileName: file.name || "import",
          profileId: asStr(g("profileId")),
          profile: parseInlineProfile(g("profile")),
          projectId: asStr(g("projectId")),
          projectKey: asStr(g("projectKey")),
          parentProjectTitle: asStr(g("parentProjectTitle")),
          sheet: asStr(g("sheet")),
          mode: g("mode") === "commit" ? "commit" : "dry_run",
          skipInvalidRows: asBool(g("skipInvalidRows")),
          includeUnchanged: asBool(g("includeUnchanged")),
          applyUpdates: asBool(g("applyUpdates")),
          conflictResolution: asConflictChoice(g("conflictResolution")),
          batchLabel: asStr(g("batchLabel")),
        },
      };
    }
    const body = (await req.json()) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text : null;
    if (!text) return { ok: false, error: "لا يوجد ملف ولا نصّ جدول في الطلب.", status: 400 };
    if (text.length > MAX_UPLOAD_BYTES) return { ok: false, error: "حجم النص يتجاوز الحدّ المسموح.", status: 413 };
    return {
      ok: true,
      input: {
        bytes: null,
        text,
        fileName: asStr(body.fileName) ?? "import.csv",
        profileId: asStr(body.profileId),
        profile: parseInlineProfile(body.profile),
        projectId: asStr(body.projectId),
        projectKey: asStr(body.projectKey),
        parentProjectTitle: asStr(body.parentProjectTitle),
        sheet: asStr(body.sheet),
        mode: body.mode === "commit" ? "commit" : "dry_run",
        skipInvalidRows: asBool(body.skipInvalidRows),
        includeUnchanged: asBool(body.includeUnchanged),
        applyUpdates: asBool(body.applyUpdates),
        conflictResolution: asConflictChoice(body.conflictResolution),
        batchLabel: asStr(body.batchLabel),
      },
    };
  } catch (e) {
    return { ok: false, error: `تعذّرت قراءة الطلب: ${String(e)}`, status: 400 };
  }
}

/**
 * The project key that anchors every external key. Explicit wins; then the
 * parent project title; then the project id. It is a SLUG, never a UUID, so the
 * same file re-imported before and after the project row exists keeps its keys.
 */
export function resolveProjectKey(input: { projectKey: string | null; parentProjectTitle: string | null; projectId: string | null }, profile: ImportProfile): string {
  if (input.projectKey) return stableSlug(input.projectKey, 40) || deriveProjectKey(input.projectKey, profile);
  if (input.parentProjectTitle) return deriveProjectKey(input.parentProjectTitle, profile);
  if (input.projectId) return `p-${input.projectId.slice(0, 8)}`;
  return `${profile.id}-default`;
}

export interface PlanBuildOutput {
  plan: ImportPlan;
  profile: ImportProfile;
  lookupReason: string | null;
}

/**
 * Parse → map → plan, with a best-effort lookup of previously imported rows.
 * A missing lookup RPC degrades the plan (everything reads as "new") but never
 * fails the preview: that is exactly the deploy-before-migrate window.
 */
export async function planFromInput(input: ImportRequestInput, call: RpcCaller | null): Promise<PlanBuildOutput> {
  ensureDiskProfiles();
  const profile = resolveProfile(input.profile ?? input.profileId);
  const wb = parseWorkbook(input.bytes ?? (input.text as string), input.fileName);
  const picked = pickSheet(wb, input.sheet ?? profile.sheet);
  const projectKey = resolveProjectKey(input, profile);

  // Pass 1: plan with no knowledge of existing rows — this yields the key set.
  const dryPlan = buildPlan({
    sheet: picked.sheet,
    profile,
    context: { projectId: input.projectId, projectKey, parentProjectTitle: input.parentProjectTitle, existingLookupAvailable: false },
    fileName: input.fileName,
    carriedWarnings: [...wb.warnings, ...picked.warnings],
  });
  if (!call || !dryPlan.ok) return { plan: dryPlan, profile, lookupReason: null };

  // Prefer the PROJECT-WIDE read: it is the only one that can see a record the
  // file no longer mentions, or a record already sitting on this file row under
  // a different key (the renamed-title conflict). When that RPC is not deployed
  // yet we fall back to the key-scoped lookup — classification still works and
  // the plan states which checks were impossible.
  const wide = await lookupProjectRows(call, { projectId: input.projectId, profileId: profile.id });
  let existing = wide.existing;
  let existingSetComplete = wide.complete;
  let lookupReason: string | null = wide.reason;
  if (!wide.available) {
    const keys = [...dryPlan.deliverables.map((d) => d.external_key), ...dryPlan.nodes.map((n) => n.key)];
    const found = await lookupExisting(call, { projectId: input.projectId, profileId: profile.id, keys });
    if (!found.available) return { plan: dryPlan, profile, lookupReason: found.reason ?? lookupReason };
    existing = found.existing;
    existingSetComplete = false;
    lookupReason = null;
  }

  // Pass 2: same deterministic plan, now classified across all five outcomes.
  const plan = buildPlan({
    sheet: picked.sheet,
    profile,
    context: {
      projectId: input.projectId,
      projectKey,
      parentProjectTitle: input.parentProjectTitle,
      existing,
      existingLookupAvailable: true,
      existingSetComplete,
    },
    fileName: input.fileName,
    carriedWarnings: [...wb.warnings, ...picked.warnings],
  });
  return { plan, profile, lookupReason };
}
