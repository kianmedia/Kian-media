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

// ─── error classification (engine-local BY DESIGN) ──────────────────────────
//
// The app-wide classifier is lib/portal/pgerror.ts, and this is the same
// decision table written again here — deliberately, because the engine may not
// import from the rest of the app (tests/import_contract.test.js: "the engine
// imports nothing from the rest of the app"). The two are pinned to identical
// behaviour by tests/pg_error_classification.test.js, which fails the moment
// they drift.
//
// WHY THE TABLE HAS NINE ROWS INSTEAD OF THREE: a 42703 ("column X does not
// exist") used to be filed under the same "migration pending" banner as a
// PGRST202. On the large-project dashboard a select asked public.projects for a
// due_date column that has never existed there — the deadline lives on
// public.project_core.due_date — and the banner sent the owner hunting an
// unapplied migration for a migration that was fine. A cause may only be
// asserted when the evidence supports it.

/** Precise cause of one failed call. */
export type PgKind =
  /** PGRST202 / 42883 — the function is absent from the database. */
  | "function"
  /** 42P01 — the relation is absent from the database. */
  | "table"
  /** 42703 — a column named in OUR request does not exist. */
  | "column"
  /** PGRST204 / PGRST205 — the schema cache is stale ("reload schema"). */
  | "cache"
  /** 42501 / 401 / 403 — authorisation, never a schema story. */
  | "permission"
  /** 42601 / PGRST100 — the request itself is malformed. */
  | "invalid"
  /** 401 — the session is gone. */
  | "auth"
  /** The transport never reached Postgres. */
  | "network"
  /** Honestly unlabelled. */
  | "other";

/**
 * Order is deliberate: authorisation is decided BEFORE any schema question so a
 * permission denial can never surface as a missing column, and the function case
 * is decided before the cache case because PGRST202's own text says "in the
 * schema cache".
 */
export function pgKindOf(error: string | null | undefined, status?: number): PgKind {
  const e = (error ?? "").toLowerCase();
  if (status === 0 || /failed to fetch|networkerror|load failed|econnrefused|etimedout/.test(e)) return "network";
  if (status === 401 || /\bnot_authenticated\b|session_expired|\bjwt\b|invalid (?:token|claim)/.test(e)) return "auth";
  if (status === 403 || /\b42501\b|permission denied|insufficient_privilege|row-level security|not authorized|not_authorized|admin only/.test(e)) return "permission";
  if (/\bpgrst202\b|\b42883\b|could not find the function|function not found|no function matches/.test(e)) return "function";
  if (/\bpgrst204\b/.test(e)) return "cache";
  if (/\bpgrst205\b/.test(e)) return "cache";
  if (/schema cache/.test(e)) return "cache";
  if (/\b42703\b/.test(e) || /column\s+.*does not exist/.test(e)) return "column";
  if (/\b42p01\b/.test(e) || /relation\s+.*does not exist/.test(e)) return "table";
  if (/\b42601\b|syntax error/.test(e)) return "invalid";
  if (/\bpgrst100\b|failed to parse|unexpected .*expecting|parse error/.test(e)) return "invalid";
  return "other";
}

/** The column named by the error, when the message carries one. */
export function pgColumnOf(error: string | null | undefined): string | null {
  const e = String(error ?? "");
  const m =
    /column\s+"([^"]+)"\s+of\s+relation/i.exec(e) ??
    /column\s+(?:"([^"]+)"|([A-Za-z0-9_.]+))\s+does not exist/i.exec(e) ??
    /could not find the '([^']+)' column/i.exec(e);
  if (!m) return null;
  for (let i = 1; i < m.length; i++) if (m[i]) return m[i];
  return null;
}

/** Never log a token, a key, an address or a row id. */
function redact(s: string): string {
  return String(s ?? "")
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}(?:\.[A-Za-z0-9_-]+)?/g, "<jwt>")
    .replace(/\b(apikey|api_key|access_token|refresh_token|authorization|bearer|password|secret|token|key)\b\s*[:=]\s*[^\s,;&)"']+/gi, "$1=<redacted>")
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b\d{9,}\b/g, "<number>");
}

/** Injected transport: the API route passes a service/user-token fetcher, the
 *  browser passes `prpc`, and tests pass a stub. The engine stays pure. */
export type RpcCaller = <T>(fn: string, args: Record<string, unknown>) => Promise<RpcOutcome<T>>;

export const IMPORT_RPC = {
  capabilities: "project_import_capabilities",
  lookup: "project_import_lookup",
  execute: "project_import_execute",
} as const;

/**
 * project_import_project_rows(p_project uuid, p_profile text) → jsonb
 *   { complete: bool, rows: [ { external_key, content_hash, id,
 *                               source_row_number, title, fields:{…} } ] }
 *
 * Read-only, project-scoped, and OPTIONAL — deliberately declared OUTSIDE
 * IMPORT_RPC, whose three names are the frozen v1 contract. It answers the two
 * questions the key-scoped lookup structurally cannot: "what is already stored
 * at this file row?" (the renamed-title conflict) and "what is stored that this
 * file no longer contains?" (missing rows). When it is absent the engine falls
 * back to the key-scoped lookup and REPORTS which checks it could not run.
 */
export const PROJECT_ROWS_RPC = "project_import_project_rows";

export type MissingKind = "function" | "column" | "table" | null;

/**
 * WHICH SCHEMA OBJECT the error names — a shape, NOT a verdict about migrations.
 * That distinction is the whole point: the same 42703 that means "the import
 * migration has not run" can equally mean "our own SELECT asked for a column
 * that never existed", and phrasing both as «الترحيلة غير مطبّقة» once cost a
 * production debugging cycle on the large-project dashboard. Use this to decide
 * WHICH capability to switch off; use importFailureReason() for what to SAY.
 *
 * Codes are matched as well as message text: the server caller keeps a
 * "CODE | message" prefix while the browser client flattens the body to just
 * `message`.
 */
export function classifyMissing(error: string | null | undefined, status?: number): MissingKind {
  const e = (error ?? "").toLowerCase();
  if (!e) return null;
  const kind = pgKindOf(error, status);
  if (kind === "function") return "function";
  if (kind === "table") return "table";
  if (kind === "column") return "column";
  // PGRST204/205 = stale schema cache. It names an object, so it still gates the
  // same capability, but it is NOT the same cause and never says "run the SQL".
  if (kind === "cache") return pgColumnOf(error) ? "column" : "table";
  if (status === 404 && e.includes("not found")) return "function";
  return null;
}

export const MIGRATION_PENDING_AR =
  "قاعدة البيانات لم تُحدَّث بعد لدعم الاستيراد. المعاينة تعمل كاملةً، أمّا التنفيذ فسيبقى معطّلًا حتى تشغيل ملف الترحيل الخاص بالاستيراد.";

/**
 * The sentence to SHOW for a failed import call. Only a genuinely absent
 * function or table is reported as "the migration has not run"; a stale schema
 * cache asks for a reload, and a missing column names the column and points at
 * the request first. The technical code always travels with the message so the
 * real error is never swallowed.
 */
export function importFailureReason(error: string | null | undefined, status?: number): string {
  const kind = pgKindOf(error, status);
  const col = pgColumnOf(error);
  switch (kind) {
    // The exact, unadorned sentence for the real "SQL not run yet" case: the
    // technical code reaches the developer through logImportFailure(), not
    // through the operator's banner.
    case "function":
    case "table":
      return MIGRATION_PENDING_AR;
    case "cache":
      return "الخادم يقرأ نسخة قديمة من مخطط قاعدة البيانات. أعِد تحميل المخطط (Reload schema) ثم أعد المحاولة.";
    case "column":
      return `طلب الاستيراد عمودًا غير موجود${col ? ` («${col}»)` : ""}. هذا خطأ في الطلب نفسه غالبًا وليس ترحيلة ناقصة — أبلغ الفريق التقنيّ باسم العمود. (42703)`;
    case "invalid":
      return "طلب غير صالح (خطأ برمجيّ، لا نقص في قاعدة البيانات). أبلغ الفريق التقنيّ.";
    case "permission":
      return DENIED_AR;
    case "auth":
      return "انتهت الجلسة — سجّل الدخول من جديد.";
    case "network":
      return "تعذّر الاتصال بقاعدة البيانات. تحقّق من الشبكة وأعد المحاولة.";
    default:
      return `تعذّر تنفيذ الطلب: ${redact(String(error ?? ""))}`;
  }
}

/**
 * TRUE only when the import's SQL genuinely has not run — an absent function or
 * table. A 42703 (missing column) and a PGRST204/205 (stale cache) are excluded
 * on purpose: telling an operator to "run the migration" for those sends them
 * hunting a file that is already applied.
 */
export function isMigrationPending(error: string | null | undefined, status?: number): boolean {
  const kind = pgKindOf(error, status);
  return kind === "function" || kind === "table";
}

/**
 * Log one import failure for the developer: the RPC, the precise cause, the
 * missing column when the message names one, and WHY the request was made.
 * Never a token, a key, an address, a row id or a URL — the message is redacted
 * first, and the RPC name is logged instead of the path.
 */
export function logImportFailure(rpc: string, purpose: string, error: string | null | undefined, status?: number): void {
  const kind = pgKindOf(error, status);
  const col = pgColumnOf(error);
  const bits = [
    "[pg] import",
    `rpc:${String(rpc).split("?")[0]}`,
    `purpose="${purpose}"`,
    `kind=${kind}`,
    `migration_pending=${isMigrationPending(error, status)}`,
  ];
  if (col) bits.push(`column=${col}`);
  if (typeof status === "number") bits.push(`http=${status}`);
  bits.push(`message="${redact(String(error ?? ""))}"`);
  if (kind === "column") bits.push('note="42703 = the column named in OUR request does not exist. Check the request BEFORE suspecting a migration."');
  try {
    if (kind === "column" || kind === "invalid") console.error(bits.join(" "));
    else console.warn(bits.join(" "));
  } catch { /* a console-less runtime must never break an import */ }
}

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
    logImportFailure("import_batch_list", "probe the staging-batch import protocol", batch.error, batch.status);
    if (isDenied(batch.error, batch.status)) return off(DENIED_AR);
    // A 42703 (a column OUR request named) or a stale schema cache is a REAL and
    // DIFFERENT failure of a backend that exists. Falling through to the
    // single-payload probe would end at «الترحيل معلّق» — the deployed protocol
    // is this one, so the other probe fails by design — and that sentence would
    // send the owner hunting a migration that is already applied. Say the truth
    // here instead; only a genuinely absent function/table may fall through.
    const batchKind = pgKindOf(batch.error, batch.status);
    if (batchKind === "column" || batchKind === "cache" || batchKind === "invalid") {
      return off(importFailureReason(batch.error, batch.status));
    }
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
    logImportFailure(IMPORT_RPC.capabilities, "probe the single-payload import contract", res.error, res.status);
    // Only a genuinely absent function/table is phrased as "the SQL has not run";
    // a stale cache or a bad column says what it really is.
    if (classifyMissing(res.error, res.status)) return off(importFailureReason(res.error, res.status));
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
    logImportFailure(IMPORT_RPC.lookup, "match file rows against already-imported rows", res.error, res.status);
    // An ABSENT lookup object is NOT "the import migration has not run".
    //
    // This RPC belongs to the single-payload contract and is optional by its own
    // documentation above; the deployed database exposes the staging-batch
    // protocol instead, so PGRST202 here is the NORMAL production answer. Phrasing
    // it with MIGRATION_PENDING_AR printed «التنفيذ معطّل حتى تشغيل ملف الترحيل»
    // directly beneath «قاعدة البيانات جاهزة للاستيراد» and an ENABLED execute
    // button — two contradictory claims, the second false, sending the operator
    // to hunt a migration that is already applied. That is the exact failure
    // class lib/portal/pgerror.ts exists to prevent.
    //
    // So: report NO reason for an absent object (identical to lookupProjectRows
    // below) and let the caller state the only consequence the evidence supports
    // — matching is unavailable, so every row reads as new. A permission, network
    // or malformed-request failure still carries its real message.
    const kind = classifyMissing(res.error, res.status);
    return { available: false, existing: {}, reason: kind ? null : `تعذّر جلب السجلّات السابقة: ${res.error}` };
  }
  const existing: Record<string, { id: string | null; content_hash: string | null }> = {};
  for (const row of res.data?.rows ?? []) {
    if (!row?.external_key) continue;
    existing[row.external_key] = { id: row.id ?? null, content_hash: row.content_hash ?? null };
  }
  return { available: true, existing, reason: null };
}

/** What `existing` carries once the project-wide lookup is available. */
export type ExistingRowMap = Record<
  string,
  { id: string | null; content_hash: string | null; source_row_number?: number | null; title?: string | null; fields?: Record<string, unknown> | null }
>;

export interface ProjectRowsResult {
  available: boolean;
  /** True only when the answer covers EVERY imported record of the project. */
  complete: boolean;
  existing: ExistingRowMap;
  reason: string | null;
}

interface RawProjectRow {
  external_key?: string;
  content_hash?: string | null;
  id?: string | null;
  source_row_number?: number | string | null;
  title?: string | null;
  fields?: Record<string, unknown> | null;
}

const asRowNumber = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

/**
 * Fetch EVERY imported row of one project (key + source row + comparable
 * fields), which is what change/conflict detection needs.
 *
 * Feature-detected exactly like the rest of the engine: a missing RPC is not an
 * error, it is a reduced capability. The caller then falls back to the
 * key-scoped `lookupExisting`, keeps create/update/unchanged classification, and
 * the preview states plainly which checks it could not perform. Nothing here
 * uses a service-role key: the injected caller is the operator's own token.
 */
export async function lookupProjectRows(call: RpcCaller, args: { projectId: string | null; profileId: string }): Promise<ProjectRowsResult> {
  const none = (reason: string | null): ProjectRowsResult => ({ available: false, complete: false, existing: {}, reason });
  // Without a target project the RPC has nothing to scope to, and a project-wide
  // answer for "no project" would be a lie.
  if (!args.projectId) return none(null);
  let res: RpcOutcome<{ rows?: RawProjectRow[]; complete?: boolean }>;
  try {
    res = await call(PROJECT_ROWS_RPC, { p_project: args.projectId, p_profile: args.profileId });
  } catch (e) {
    return none(`تعذّر الاتصال بقاعدة البيانات (${String(e)}).`);
  }
  if (!res.ok) {
    logImportFailure(PROJECT_ROWS_RPC, "read every already-imported row of the project", res.error, res.status);
    const kind = classifyMissing(res.error, res.status);
    return none(kind ? null : `تعذّر جلب سجلات المشروع السابقة: ${res.error}`);
  }
  const existing: ExistingRowMap = {};
  for (const row of res.data?.rows ?? []) {
    if (!row?.external_key) continue;
    existing[row.external_key] = {
      id: row.id ?? null,
      content_hash: row.content_hash ?? null,
      source_row_number: asRowNumber(row.source_row_number),
      title: typeof row.title === "string" ? row.title : null,
      fields: row.fields && typeof row.fields === "object" ? row.fields : null,
    };
  }
  // `complete:false` from the database (a truncated answer) is honoured: partial
  // knowledge must never be reported as "these records are missing".
  return { available: true, complete: res.data?.complete !== false, existing, reason: null };
}
