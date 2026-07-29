// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/batchBackend.ts — driver for the STAGING-BATCH database
// protocol (import_batch_*): create → load rows → preview → dry-run/execute →
// report. The database owns the transaction, the idempotency (external_key) and
// the row-level outcome; this file owns the translation and the honesty.
//
// TRANSLATION RULES THAT MATTER
//  • Vocabulary belongs to the DATABASE. status / schedule_status / priority /
//    content_type are validated server-side against fixed lists and a catalog
//    table; sending an unrecognised value would make the row INVALID. So a value
//    we cannot map is OMITTED (the column keeps its own default) and the
//    original text is preserved in `metadata` — never guessed, never dropped.
//  • This protocol models ONE sub-level (stage). A profile with deeper levels
//    still imports: the deeper path is recorded in `metadata.level_path` and the
//    operator is told, instead of the engine silently inventing entities.
//  • A target project is REQUIRED by the database; we refuse early, in Arabic,
//    rather than letting the batch fail after it was created.
//  • WHERE THE INTERNAL FIELDS LAND: `internal_notes` and `metadata` (and the
//    key/batch/source trail the database adds itself) do NOT live on
//    public.deliverables — they live on public.deliverable_internal, a 1:1 side
//    table with a staff-only RLS policy. Reason: Postgres RLS filters ROWS, not
//    COLUMNS, and every app user shares the single `authenticated` role, so any
//    column on `deliverables` is readable by a client with a hand-written
//    `select=internal_notes,external_key`. The payload keys below are unchanged
//    — import_batch_execute routes them to the side table — so a client never
//    sees a row of it, let alone a column.
// ════════════════════════════════════════════════════════════════════════════
import type { ImportPlan, ImportProfile, PlannedDeliverable } from "./types";
import type { RpcCaller } from "./rpc";
import { classifyMissing, MIGRATION_PENDING_AR } from "./rpc";
import { headerKey } from "./text";

export const BATCH_RPC = {
  list: "import_batch_list",
  create: "import_batch_create",
  loadRows: "import_batch_load_rows",
  preview: "import_batch_preview",
  dryRun: "import_batch_dry_run",
  execute: "import_batch_execute",
  report: "import_batch_report",
  cancel: "import_batch_cancel",
} as const;

/** Values the database accepts. Mirrored ONLY so we never send a rejected one. */
export const DB_STATUS = ["draft", "internal_review"] as const;
export const DB_SCHEDULE_STATUS = ["awaiting_schedule", "scheduled", "in_progress", "done", "on_hold", "cancelled"] as const;
export const DB_PRIORITY = ["low", "normal", "high", "urgent"] as const;
/** A real, always-present catalog key — the safe landing spot for unknown kinds. */
export const DB_CONTENT_TYPE_FALLBACK = "custom";
/** The database refuses more than this many staging rows in one batch. */
export const BATCH_ROW_LIMIT = 5000;

/**
 * Staging-payload keys the database writes to public.deliverable_internal
 * (staff-only side table) rather than to public.deliverables. Declared so the
 * routing is a stated contract, not folklore: anything added here must never be
 * selectable from `deliverables`, or the client can read it directly.
 */
export const DB_INTERNAL_TABLE = "deliverable_internal";
export const DB_INTERNAL_PAYLOAD_KEYS = ["internal_notes", "metadata"] as const;

export interface BatchRow {
  row_number: number;
  entity_type: "stage" | "deliverable";
  external_key: string;
  payload: Record<string, unknown>;
}

function pickVocab(raw: string | null, map: Record<string, string[]> | undefined, allowed: readonly string[]): string | null {
  const v = (raw ?? "").trim();
  if (v === "") return null;
  const direct = v.toLowerCase();
  if (allowed.indexOf(direct) !== -1) return direct;
  if (!map) return null;
  const k = headerKey(v);
  for (const key of Object.keys(map)) {
    for (const syn of map[key] ?? []) {
      if (headerKey(syn) === k) return key;
    }
  }
  return null;
}

/** Free-text kind → a key from the database's content-type catalog (profile data). */
export function contentTypeKeyFor(d: PlannedDeliverable, profile: ImportProfile): { key: string; matched: boolean } {
  const raw = d.content_type_raw ?? "";
  if (raw.trim() === "") return { key: DB_CONTENT_TYPE_FALLBACK, matched: false };
  const map = profile.contentTypeKeys;
  if (map) {
    const k = headerKey(raw);
    for (const key of Object.keys(map)) {
      for (const syn of map[key] ?? []) {
        const s = headerKey(syn);
        if (s && (k === s || (s.length >= 4 && k.includes(s)))) return { key, matched: true };
      }
    }
    if (map[headerKey(raw)]) return { key: headerKey(raw), matched: true };
  }
  return { key: DB_CONTENT_TYPE_FALLBACK, matched: false };
}

export interface BuildBatchRowsResult {
  rows: BatchRow[];
  /** batch row_number → the plan row it came from (for honest reporting). */
  index: Map<number, { source_row_number: number; title: string; external_key: string }>;
  /** Levels below the first that this protocol cannot model as entities. */
  deeperLevelsRecordedAsMetadata: boolean;
  unmappedContentTypes: string[];
}

/**
 * Translate a plan into staging rows: level-0 nodes become `stage` rows, every
 * planned deliverable becomes a `deliverable` row. Row numbers are sequential
 * (the database uses them for ordering); the true file line stays in the payload
 * and in the returned index.
 */
export function buildBatchRows(plan: ImportPlan, profile: ImportProfile, opts: { includeUnchanged?: boolean } = {}): BuildBatchRowsResult {
  const rows: BatchRow[] = [];
  const index = new Map<number, { source_row_number: number; title: string; external_key: string }>();
  const unmapped: string[] = [];
  let n = 0;

  const stages = plan.nodes.filter((node) => node.levelIndex === 0);
  for (const node of stages) {
    n++;
    rows.push({
      row_number: n,
      entity_type: "stage",
      external_key: node.key,
      payload: { name: node.title, stage_order: node.sequence, schedule_status: "awaiting_schedule" },
    });
    index.set(n, { source_row_number: 0, title: node.title, external_key: node.key });
  }

  const attempted = plan.deliverables.filter((d) => (opts.includeUnchanged ? true : d.action !== "unchanged"));
  let deeper = false;
  for (const d of attempted) {
    n++;
    const stageKey = d.level_keys[0] ? stages.find((s) => s.title === d.level_path[0])?.key ?? null : null;
    const ct = contentTypeKeyFor(d, profile);
    if (!ct.matched && d.content_type_raw && unmapped.indexOf(d.content_type_raw) === -1) unmapped.push(d.content_type_raw);
    if (d.level_path.length > 1 && d.level_path.slice(1).some((v) => !!v)) deeper = true;

    const priority = pickVocab(d.priority, profile.priorityKeys, DB_PRIORITY);
    const schedule = pickVocab(d.schedule_status, undefined, DB_SCHEDULE_STATUS) ?? "awaiting_schedule";
    const status = pickVocab(d.status, undefined, DB_STATUS) ?? "draft";

    const payload: Record<string, unknown> = {
      title: d.title,
      content_type: ct.key,
      status,
      schedule_status: schedule,
      platforms: d.platforms,
      execution_details: d.execution_details,
      proposed_caption: d.proposed_caption,
      internal_notes: d.notes,
      // A date is sent ONLY when the file carried one; null keeps the column empty.
      due_date: d.due_date,
      expected_units: d.quantity,
      sort_order: n,
      stage_external_key: stageKey,
      metadata: {
        import_profile: plan.profileId,
        import_profile_version: plan.profileVersion,
        source_row_number: d.source_row_number,
        content_hash: d.content_hash,
        content_type_raw: d.content_type_raw,
        level_path: d.level_path,
        level_keys: d.level_keys,
        priority_raw: d.priority,
        assignee_hint: d.assignee_hint,
        extra: d.extra,
      },
    };
    if (priority) payload.priority = priority;
    rows.push({ row_number: n, entity_type: "deliverable", external_key: d.external_key, payload });
    index.set(n, { source_row_number: d.source_row_number, title: d.title, external_key: d.external_key });
  }
  return { rows, index, deeperLevelsRecordedAsMetadata: deeper, unmappedContentTypes: unmapped };
}

// ─── protocol driver ───────────────────────────────────────────────────────

export interface BatchStepFailure {
  step: string;
  error: string;
  status?: number;
  missing: ReturnType<typeof classifyMissing>;
  notAuthorized: boolean;
}

const isDenied = (e: string): boolean => /not authorized|permission denied/i.test(e);

async function step<T>(call: RpcCaller, name: string, args: Record<string, unknown>): Promise<{ ok: true; data: T } | { ok: false; failure: BatchStepFailure }> {
  let res;
  try {
    res = await call<T>(name, args);
  } catch (e) {
    return { ok: false, failure: { step: name, error: String(e), missing: null, notAuthorized: false } };
  }
  if (res.ok) return { ok: true, data: res.data };
  return {
    ok: false,
    failure: { step: name, error: res.error, status: res.status, missing: classifyMissing(res.error, res.status), notAuthorized: isDenied(res.error) || res.status === 401 || res.status === 403 },
  };
}

export interface BatchReportRow {
  row_number?: number;
  entity_type?: string;
  external_key?: string | null;
  action?: string;
  status?: string;
  error?: string | null;
  result_id?: string | null;
}

export interface BatchRunOutcome {
  batchId: string | null;
  /** Per staging row, as the database reported it. */
  reportRows: BatchReportRow[];
  /** Summary object returned by dry-run/execute. */
  summary: Record<string, unknown> | null;
  failure: BatchStepFailure | null;
  /** Arabic note surfaced by the database itself, when present. */
  noteAr: string | null;
}

/**
 * Run the whole protocol. Returns the raw outcome; turning it into an
 * ExecuteResult (and deciding what counts as success) is execute.ts's job.
 */
export async function runBatchProtocol(
  args: {
    profileId: string;
    sourceFile: string;
    targetProjectId: string;
    notes?: string | null;
    rows: BatchRow[];
    mode: "dry_run" | "commit";
    allowPartial: boolean;
    reportLimit?: number;
  },
  call: RpcCaller,
): Promise<BatchRunOutcome> {
  const out: BatchRunOutcome = { batchId: null, reportRows: [], summary: null, failure: null, noteAr: null };

  const created = await step<{ batch_id?: string }>(call, BATCH_RPC.create, {
    p_profile: args.profileId,
    p_source_file_name: args.sourceFile,
    p_target_project: args.targetProjectId,
    p_notes: args.notes ?? null,
  });
  if (!created.ok) {
    out.failure = created.failure;
    return out;
  }
  const batchId = created.data?.batch_id ?? null;
  out.batchId = batchId;
  if (!batchId) {
    out.failure = { step: BATCH_RPC.create, error: "batch_id_missing", missing: null, notAuthorized: false };
    return out;
  }

  const loaded = await step(call, BATCH_RPC.loadRows, { p_batch: batchId, p_rows: args.rows });
  if (!loaded.ok) {
    out.failure = loaded.failure;
    return out;
  }
  const previewed = await step(call, BATCH_RPC.preview, { p_batch: batchId });
  if (!previewed.ok) {
    out.failure = previewed.failure;
    return out;
  }

  const run = await step<Record<string, unknown>>(call, args.mode === "commit" ? BATCH_RPC.execute : BATCH_RPC.dryRun, {
    p_batch: batchId,
    p_allow_partial: args.allowPartial,
  });
  if (!run.ok) {
    out.failure = run.failure;
    // Still fetch the report so the operator sees WHICH rows the database refused.
    const rep = await step<{ rows?: BatchReportRow[] }>(call, BATCH_RPC.report, { p_batch: batchId, p_limit: args.reportLimit ?? 500 });
    if (rep.ok) out.reportRows = rep.data?.rows ?? [];
    return out;
  }
  out.summary = run.data ?? null;
  out.noteAr = typeof run.data?.note_ar === "string" ? (run.data.note_ar as string) : null;

  const rep = await step<{ rows?: BatchReportRow[] }>(call, BATCH_RPC.report, { p_batch: batchId, p_limit: args.reportLimit ?? 500 });
  if (rep.ok) out.reportRows = rep.data?.rows ?? [];
  else out.failure = rep.failure;
  return out;
}

export const NO_TARGET_PROJECT_AR =
  "الاستيراد يحتاج مشروعًا هدفًا موجودًا مسبقًا. اختر المشروع الذي ستُضاف إليه المراحل والمخرجات ثم أعد المحاولة.";

export const TOO_MANY_ROWS_AR = (n: number): string =>
  `عدد صفوف الدفعة ${n} يتجاوز الحدّ الذي تقبله قاعدة البيانات (${BATCH_ROW_LIMIT}). قسّم الملفّ ثم أعد المحاولة.`;

export { MIGRATION_PENDING_AR };
