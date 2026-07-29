// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/rpc.ts — the DATABASE CONTRACT of the import engine, plus
// the feature detection that keeps the site alive while the SQL is not applied.
//
// The owner deploys code first and runs SQL later. During that window every
// import RPC is missing, and PostgREST answers PGRST202. This module turns that
// into an explicit, translated "migration pending" state instead of a crash.
//
// ── CONTRACT (implemented by the import migration; names are stable) ────────
//  project_import_capabilities() → jsonb
//      { ok:true, version:int, writes:bool }
//
//  project_import_lookup(p_project uuid, p_profile text, p_keys text[]) → jsonb
//      { rows: [ { external_key text, content_hash text, id uuid } ] }
//      Read-only. Used to classify create / update / unchanged. May legitimately
//      be absent — the preview then reports existingLookupAvailable = false.
//
//  ── WHERE external_key LIVES (and why it is not on `deliverables`) ─────────
//      The key, the batch id, the source trail and the internal notes live on
//      public.deliverable_internal — a 1:1 side table keyed by deliverable_id
//      with a staff-only RLS policy and the partial UNIQUE index
//      ux_deliverable_internal_external_key (WHERE external_key IS NOT NULL)
//      that makes re-import idempotent. They are NOT columns on
//      public.deliverables, because RLS filters rows and not columns: with every
//      app user on the single `authenticated` role, a client could otherwise
//      read them with `?select=internal_notes,external_key`. Both RPCs above
//      resolve the key through the side table; this file's contract is unchanged.
//
//  project_import_execute(p_payload jsonb) → jsonb
//      p_payload = {
//        mode: 'dry_run' | 'commit',
//        profile_id, profile_version, project_key,
//        project_id uuid|null, parent_project: {key,title}|null,
//        source_file, batch_label,
//        nodes: [ {key, level_index, level_key, title, parent_key, sequence} ],
//        rows:  [ {external_key, content_hash, source_row_number, title, type,
//                  content_type_raw, platforms[], execution_details,
//                  proposed_caption, notes, assignee_hint, priority, quantity,
//                  due_date|null, schedule_status, status, level_path[],
//                  level_keys[], parent_key, extra{}} ]
//      }
//      MUST be atomic: on any row failure it either reports every row's outcome
//      or rolls the whole batch back. It MUST upsert on external_key so a
//      re-import is idempotent.
//      → { ok, batch_id, mode, rolled_back, results:[{external_key, action:
//          'created'|'updated'|'unchanged'|'failed', id, error}] , created,
//          updated, unchanged, failed }
// ════════════════════════════════════════════════════════════════════════════

export type RpcOutcome<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

/** Injected transport: the API route passes a service/user-token fetcher, the
 *  browser passes `prpc`, and tests pass a stub. The engine stays pure. */
export type RpcCaller = <T>(fn: string, args: Record<string, unknown>) => Promise<RpcOutcome<T>>;

export const IMPORT_RPC = {
  capabilities: "project_import_capabilities",
  lookup: "project_import_lookup",
  execute: "project_import_execute",
} as const;

export type MissingKind = "function" | "column" | "table" | null;

/**
 * Classify a PostgREST/Postgres error as "the migration has not run yet".
 * PGRST202 = function not found, PGRST204/42703 = column not found,
 * PGRST205/42P01 = table not found. The message text is matched too because the
 * shared REST client flattens the error body to a string.
 */
export function classifyMissing(error: string | null | undefined, status?: number): MissingKind {
  const e = (error ?? "").toLowerCase();
  if (!e) return null;
  if (e.includes("pgrst202") || e.includes("42883") || e.includes("could not find the function") || e.includes("function not found")) return "function";
  if (e.includes("pgrst205") || e.includes("42p01") || e.includes("does not exist: relation") || e.includes("could not find the table")) return "table";
  if (e.includes("pgrst204") || e.includes("42703") || (e.includes("column") && e.includes("does not exist"))) return "column";
  if (status === 404 && e.includes("not found")) return "function";
  return null;
}

export const MIGRATION_PENDING_AR =
  "قاعدة البيانات لم تُحدَّث بعد لدعم الاستيراد. المعاينة تعمل كاملةً، أمّا التنفيذ فسيبقى معطّلًا حتى تشغيل ملف الترحيل الخاص بالاستيراد.";

/**
 * Which write protocol the database actually exposes.
 *  "batch"  — the staging-batch functions (import_batch_*): create → load →
 *             preview → dry-run/execute → report. This is what the project's
 *             import migration installs.
 *  "single" — the single-payload contract documented at the top of this file.
 *  null     — neither: the migration has not been applied yet.
 */
export type ImportProtocol = "batch" | "single";

export interface BackendState {
  available: boolean;
  protocol: ImportProtocol | null;
  /** Contract version reported by the database, when available. */
  version: number | null;
  /** Arabic explanation shown when available = false. */
  reason: string | null;
  /** True when the read-side lookup RPC works (create/update classification). */
  lookupAvailable: boolean;
}

const DENIED_AR = "لا تملك صلاحية تنفيذ الاستيراد.";
const isDenied = (error: string, status?: number): boolean =>
  status === 401 || status === 403 || /not authorized|permission denied/i.test(error);

/**
 * Probe the database once. NEVER throws — a missing backend is a DISABLED state
 * with an explanation, never an exception in the operator's face. The batch
 * protocol is probed first because that is what this project ships; the
 * single-call contract is the documented fallback.
 */
export async function detectBackend(call: RpcCaller): Promise<BackendState> {
  const off = (reason: string): BackendState => ({ available: false, protocol: null, version: null, reason, lookupAvailable: false });

  // 1) staging-batch protocol — a cheap, read-only listing call.
  try {
    const batch = await call<unknown>("import_batch_list", { p_limit: 1, p_offset: 0 });
    if (batch.ok) return { available: true, protocol: "batch", version: null, reason: null, lookupAvailable: true };
    if (isDenied(batch.error, batch.status)) return off(DENIED_AR);
    if (!classifyMissing(batch.error, batch.status)) return off(`تعذّر التحقّق من دعم الاستيراد: ${batch.error}`);
  } catch (e) {
    return off(`تعذّر الاتصال بقاعدة البيانات (${String(e)}).`);
  }

  // 2) single-payload contract.
  let res: RpcOutcome<{ ok?: boolean; version?: number; writes?: boolean }>;
  try {
    res = await call<{ ok?: boolean; version?: number; writes?: boolean }>(IMPORT_RPC.capabilities, {});
  } catch (e) {
    return off(`تعذّر الاتصال بقاعدة البيانات (${String(e)}).`);
  }
  if (!res.ok) {
    if (classifyMissing(res.error, res.status)) return off(MIGRATION_PENDING_AR);
    if (isDenied(res.error, res.status)) return off(DENIED_AR);
    return off(`تعذّر التحقّق من دعم الاستيراد: ${res.error}`);
  }
  const version = typeof res.data?.version === "number" ? res.data.version : null;
  if (res.data?.ok === false) return off(MIGRATION_PENDING_AR);
  return { available: true, protocol: "single", version, reason: null, lookupAvailable: true };
}

/**
 * Fetch the already-imported rows for these keys. A missing RPC is NOT an error:
 * the caller degrades to "everything looks new" and says so in the UI.
 */
export async function lookupExisting(
  call: RpcCaller,
  args: { projectId: string | null; profileId: string; keys: string[] },
): Promise<{ available: boolean; existing: Record<string, { id: string | null; content_hash: string | null }>; reason: string | null }> {
  if (args.keys.length === 0) return { available: true, existing: {}, reason: null };
  let res: RpcOutcome<{ rows?: { external_key?: string; content_hash?: string | null; id?: string | null }[] }>;
  try {
    res = await call(IMPORT_RPC.lookup, { p_project: args.projectId, p_profile: args.profileId, p_keys: args.keys });
  } catch (e) {
    return { available: false, existing: {}, reason: `تعذّر الاتصال بقاعدة البيانات (${String(e)}).` };
  }
  if (!res.ok) {
    const kind = classifyMissing(res.error, res.status);
    return { available: false, existing: {}, reason: kind ? MIGRATION_PENDING_AR : `تعذّر جلب السجلّات السابقة: ${res.error}` };
  }
  const existing: Record<string, { id: string | null; content_hash: string | null }> = {};
  for (const row of res.data?.rows ?? []) {
    if (!row?.external_key) continue;
    existing[row.external_key] = { id: row.id ?? null, content_hash: row.content_hash ?? null };
  }
  return { available: true, existing, reason: null };
}
