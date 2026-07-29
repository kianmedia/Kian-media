// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/execute.ts — the WRITE path.
//
// THREE PROMISES THIS FILE KEEPS
//  1. Idempotent: the payload is keyed by external_key, so running the same file
//     twice touches nothing the second time.
//  2. Never a silent half-import: the batch goes to the database as ONE call.
//     Either the response accounts for EVERY row we sent, or the result is
//     reported as ambiguous and the operator is told to verify the batch — we
//     never print "تم بنجاح" over an unverified write.
//  3. Never a surprise: rows the preview marked invalid are refused unless the
//     operator explicitly chose to skip them.
//
// Nothing here is project-specific and nothing here invents data.
// ════════════════════════════════════════════════════════════════════════════
import type { ImportPlan, ImportProfile, PlannedDeliverable } from "./types";
import { classifyMissing, detectBackend, IMPORT_RPC, MIGRATION_PENDING_AR, type RpcCaller } from "./rpc";
import {
  BATCH_ROW_LIMIT,
  buildBatchRows,
  NO_TARGET_PROJECT_AR,
  runBatchProtocol,
  TOO_MANY_ROWS_AR,
  type BatchReportRow,
} from "./batchBackend";

export type ExecuteCode =
  | "COMMITTED"
  | "DRY_RUN_OK"
  | "NOTHING_TO_DO"
  | "MIGRATION_PENDING"
  | "REFUSED_INVALID_PLAN"
  | "REFUSED_INVALID_ROWS"
  | "REFUSED_DUPLICATES"
  | "NOT_AUTHORIZED"
  | "ROLLED_BACK"
  | "PARTIAL_REPORTED"
  | "AMBIGUOUS_RESULT"
  | "TRANSPORT_FAILED";

export interface RowOutcome {
  external_key: string;
  source_row_number: number;
  title: string;
  action: "created" | "updated" | "unchanged" | "failed" | "not_attempted";
  id: string | null;
  error: string | null;
}

export interface ExecuteResult {
  ok: boolean;
  code: ExecuteCode;
  /** Arabic, user-facing, always populated. */
  message: string;
  mode: "dry_run" | "commit";
  batchId: string | null;
  rolledBack: boolean;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  notAttempted: number;
  rows: RowOutcome[];
}

export interface ExecuteOptions {
  mode: "dry_run" | "commit";
  /** Target project id when importing into an existing project. */
  projectId?: string | null;
  sourceFile?: string;
  batchLabel?: string;
  /** Required acknowledgement when the plan contains invalid rows. */
  skipInvalidRows?: boolean;
  /** Send rows whose action is "unchanged" too (default: skip them). */
  includeUnchanged?: boolean;
  /**
   * The profile the plan was built with. Required by the staging-batch protocol
   * to translate free text onto the database's own vocabularies.
   */
  profile?: ImportProfile;
}

/** The exact JSON handed to project_import_execute. Pure ⇒ snapshot-testable. */
export function buildExecutePayload(plan: ImportPlan, opts: ExecuteOptions): {
  payload: Record<string, unknown>;
  attempted: PlannedDeliverable[];
} {
  const attempted = plan.deliverables.filter((d) => (opts.includeUnchanged ? true : d.action !== "unchanged"));
  // Every node is sent, always: the hierarchy is created/ensured before rows are
  // written, and a node whose only row is "unchanged" must still exist.
  const payload: Record<string, unknown> = {
    mode: opts.mode,
    contract: 1,
    profile_id: plan.profileId,
    profile_version: plan.profileVersion,
    project_key: plan.projectKey,
    project_id: opts.projectId ?? null,
    parent_project: plan.parentProject ? { key: plan.parentProject.key, title: plan.parentProject.title } : null,
    source_file: opts.sourceFile ?? plan.fileName,
    batch_label: opts.batchLabel ?? plan.fileName,
    nodes: plan.nodes.map((n) => ({
      key: n.key,
      level_index: n.levelIndex,
      level_key: n.levelKey,
      title: n.title,
      parent_key: n.parentKey,
      sequence: n.sequence,
    })),
    rows: attempted.map((d) => ({
      external_key: d.external_key,
      content_hash: d.content_hash,
      source_row_number: d.source_row_number,
      parent_key: d.parentKey,
      level_path: d.level_path,
      level_keys: d.level_keys,
      title: d.title,
      type: d.type,
      content_type_raw: d.content_type_raw,
      platforms: d.platforms,
      execution_details: d.execution_details,
      proposed_caption: d.proposed_caption,
      notes: d.notes,
      assignee_hint: d.assignee_hint,
      priority: d.priority,
      quantity: d.quantity,
      // NEVER a fabricated date: null here means "the file did not say".
      due_date: d.due_date,
      schedule_status: d.schedule_status,
      status: d.status,
      extra: d.extra,
    })),
  };
  return { payload, attempted };
}

interface RawExecuteResponse {
  ok?: boolean;
  batch_id?: string | null;
  mode?: string;
  rolled_back?: boolean;
  results?: { external_key?: string; action?: string; id?: string | null; error?: string | null }[];
  error?: string | null;
}

const ACTIONS = new Set(["created", "updated", "unchanged", "failed"]);

/**
 * Turn the database answer into an honest report. Pure ⇒ every branch is tested.
 * A response that does not account for every attempted row is NOT success.
 */
export function normalizeExecuteResponse(raw: RawExecuteResponse | null, attempted: PlannedDeliverable[], mode: "dry_run" | "commit"): ExecuteResult {
  const byKey = new Map(attempted.map((d) => [d.external_key, d]));
  const rows: RowOutcome[] = [];
  const seen = new Set<string>();
  for (const r of raw?.results ?? []) {
    const key = String(r?.external_key ?? "");
    const src = byKey.get(key);
    if (!src || seen.has(key)) continue; // ignore rows we never sent / repeats
    seen.add(key);
    const action = ACTIONS.has(String(r?.action)) ? (String(r?.action) as RowOutcome["action"]) : "failed";
    rows.push({
      external_key: key,
      source_row_number: src.source_row_number,
      title: src.title,
      action,
      id: r?.id ?? null,
      error: action === "failed" ? String(r?.error ?? "سبب غير محدّد من قاعدة البيانات") : null,
    });
  }
  for (const d of attempted) {
    if (!seen.has(d.external_key)) {
      rows.push({ external_key: d.external_key, source_row_number: d.source_row_number, title: d.title, action: "not_attempted", id: null, error: null });
    }
  }
  rows.sort((a, b) => a.source_row_number - b.source_row_number);

  const created = rows.filter((r) => r.action === "created").length;
  const updated = rows.filter((r) => r.action === "updated").length;
  const unchanged = rows.filter((r) => r.action === "unchanged").length;
  const failed = rows.filter((r) => r.action === "failed").length;
  const notAttempted = rows.filter((r) => r.action === "not_attempted").length;
  const rolledBack = raw?.rolled_back === true;

  const totals = { created, updated, unchanged, failed, notAttempted, rows, batchId: raw?.batch_id ?? null, mode, rolledBack };

  if (rolledBack) {
    // Nothing was written, so nothing may be counted as written — a per-row
    // "created" inside a rolled-back batch describes an attempt, not a result.
    return {
      ...totals,
      created: 0,
      updated: 0,
      unchanged: 0,
      ok: false,
      code: "ROLLED_BACK",
      message: `تراجعت قاعدة البيانات عن الدفعة بالكامل ولم يُكتب أي سطر. عدد الأسطر الفاشلة: ${failed}. صحّح الملف ثم أعد المحاولة.`,
    };
  }
  if (notAttempted > 0) {
    // The database answered without covering every row we sent. We cannot claim
    // success and we must not claim failure — say exactly that.
    return {
      ...totals,
      ok: false,
      code: "AMBIGUOUS_RESULT",
      message: `ردّت قاعدة البيانات دون تغطية كل الأسطر المُرسَلة (${notAttempted} من ${rows.length} بلا نتيجة). لا تعتبر الاستيراد ناجحًا — راجع الدفعة ${raw?.batch_id ?? ""} قبل إعادة المحاولة.`,
    };
  }
  if (failed > 0) {
    return {
      ...totals,
      ok: false,
      code: "PARTIAL_REPORTED",
      message: `فشل ${failed} سطرًا ونجح ${created + updated}. النتيجة مفصّلة لكل سطر أدناه؛ أعد رفع الملف بعد تصحيح الأسطر الفاشلة (الاستيراد لا يكرّر ما نجح).`,
    };
  }
  if (mode === "dry_run") {
    return { ...totals, ok: true, code: "DRY_RUN_OK", message: `تشغيل تجريبي ناجح: ${created} إنشاء و${updated} تحديث و${unchanged} دون تغيير. لم يُكتب أي شيء.` };
  }
  if (created + updated === 0) {
    return { ...totals, ok: true, code: "NOTHING_TO_DO", message: "لا جديد: كل الأسطر مطابقة لما هو مسجَّل بالفعل." };
  }
  return { ...totals, ok: true, code: "COMMITTED", message: `تمّ الاستيراد: ${created} مخرَجًا جديدًا و${updated} تحديثًا${unchanged ? ` و${unchanged} دون تغيير` : ""}.` };
}

function refusal(code: ExecuteCode, message: string, mode: "dry_run" | "commit"): ExecuteResult {
  return { ok: false, code, message, mode, batchId: null, rolledBack: false, created: 0, updated: 0, unchanged: 0, failed: 0, notAttempted: 0, rows: [] };
}

// ─── staging-batch protocol ────────────────────────────────────────────────

/**
 * Turn the database's per-staging-row report into the same honest ExecuteResult
 * every caller already understands. Pure ⇒ every branch is tested.
 *
 * status mapping (the database's words → ours):
 *   applied            → created
 *   skipped            → unchanged   (the row already existed: idempotency)
 *   failed | invalid   → failed
 *   valid | pending    → in a DRY RUN this is the plan ("would be created" or
 *                        "would be skipped", read from `action`); after a COMMIT
 *                        it means the row was never decided ⇒ not_attempted,
 *                        which is what makes the result AMBIGUOUS rather than a
 *                        claimed success.
 */
export function normalizeBatchReport(
  reportRows: BatchReportRow[],
  index: Map<number, { source_row_number: number; title: string; external_key: string }>,
  mode: "dry_run" | "commit",
  batchId: string | null,
): ExecuteResult {
  const rows: RowOutcome[] = [];
  const seen = new Set<number>();
  for (const r of reportRows) {
    const n = typeof r.row_number === "number" ? r.row_number : -1;
    const src = index.get(n);
    if (!src || seen.has(n)) continue;
    seen.add(n);
    const status = String(r.status ?? "");
    const action = String(r.action ?? "");
    let outcome: RowOutcome["action"];
    if (status === "applied") outcome = "created";
    else if (status === "skipped") outcome = "unchanged";
    else if (status === "failed" || status === "invalid") outcome = "failed";
    else if (mode === "dry_run") outcome = action === "skip" ? "unchanged" : "created";
    else outcome = "not_attempted";
    rows.push({
      external_key: src.external_key,
      source_row_number: src.source_row_number,
      title: src.title,
      action: outcome,
      id: r.result_id ?? null,
      error: outcome === "failed" ? String(r.error ?? "سبب غير محدّد من قاعدة البيانات") : null,
    });
  }
  for (const entry of Array.from(index.entries())) {
    if (!seen.has(entry[0])) {
      rows.push({ external_key: entry[1].external_key, source_row_number: entry[1].source_row_number, title: entry[1].title, action: "not_attempted", id: null, error: null });
    }
  }
  rows.sort((a, b) => a.source_row_number - b.source_row_number);

  const created = rows.filter((r) => r.action === "created").length;
  const updated = 0; // this protocol creates or skips; it never rewrites a row
  const unchanged = rows.filter((r) => r.action === "unchanged").length;
  const failed = rows.filter((r) => r.action === "failed").length;
  const notAttempted = rows.filter((r) => r.action === "not_attempted").length;
  const totals = { created, updated, unchanged, failed, notAttempted, rows, batchId, mode, rolledBack: false };

  if (notAttempted > 0) {
    return {
      ...totals,
      ok: false,
      code: "AMBIGUOUS_RESULT",
      message: `ردّت قاعدة البيانات دون حسم كل الأسطر المُرسَلة (${notAttempted} من ${rows.length} بلا نتيجة). لا تعتبر الاستيراد ناجحًا — راجع الدفعة ${batchId ?? ""} قبل إعادة المحاولة.`,
    };
  }
  if (failed > 0) {
    return {
      ...totals,
      ok: false,
      code: mode === "dry_run" ? "REFUSED_INVALID_ROWS" : "PARTIAL_REPORTED",
      message:
        mode === "dry_run"
          ? `رفضت قاعدة البيانات ${failed} سطرًا في الفحص التجريبي. صحّحها ثم أعد المحاولة — لم يُكتب أي شيء.`
          : `فشل ${failed} سطرًا ونجح ${created}. النتيجة مفصّلة لكل سطر أدناه؛ أعد رفع الملف بعد التصحيح (الاستيراد لا يكرّر ما نجح).`,
    };
  }
  if (mode === "dry_run") {
    return { ...totals, ok: true, code: "DRY_RUN_OK", message: `تشغيل تجريبي ناجح: ${created} إنشاء و${unchanged} موجود مسبقًا. لم يُكتب أي شيء.` };
  }
  if (created === 0) {
    return { ...totals, ok: true, code: "NOTHING_TO_DO", message: `لا جديد: ${unchanged} سطرًا موجودة بالفعل ولم يُنشأ شيء.` };
  }
  return { ...totals, ok: true, code: "COMMITTED", message: `تمّ الاستيراد: ${created} سجلًّا جديدًا${unchanged ? ` و${unchanged} كان موجودًا مسبقًا` : ""}.` };
}

async function executeViaBatch(plan: ImportPlan, opts: ExecuteOptions, call: RpcCaller): Promise<ExecuteResult> {
  const mode = opts.mode;
  const profile = opts.profile;
  if (!profile) {
    return refusal("REFUSED_INVALID_PLAN", "تعذّر تحديد ملف التعيين المستخدَم في التخطيط؛ أعد المعاينة ثم نفّذ.", mode);
  }
  const targetProjectId = (opts.projectId ?? "").trim();
  if (!targetProjectId) return refusal("REFUSED_INVALID_PLAN", NO_TARGET_PROJECT_AR, mode);

  const built = buildBatchRows(plan, profile, { includeUnchanged: opts.includeUnchanged });
  if (built.rows.length === 0) {
    return { ...refusal("NOTHING_TO_DO", "لا يوجد ما يُنفَّذ: كل الأسطر مطابقة لما هو مسجَّل بالفعل.", mode), ok: true };
  }
  if (built.rows.length > BATCH_ROW_LIMIT) return refusal("REFUSED_INVALID_PLAN", TOO_MANY_ROWS_AR(built.rows.length), mode);

  const run = await runBatchProtocol(
    {
      profileId: plan.profileId,
      sourceFile: opts.sourceFile ?? plan.fileName,
      targetProjectId,
      notes: opts.batchLabel ?? null,
      rows: built.rows,
      mode,
      allowPartial: opts.skipInvalidRows === true,
    },
    call,
  );

  if (run.failure) {
    const f = run.failure;
    const where = `أثناء «${f.step}»`;
    const partial = normalizeBatchReport(run.reportRows, built.index, mode, run.batchId);
    const base = { ...partial, rows: partial.rows, batchId: run.batchId };
    if (f.missing) return { ...base, ok: false, code: "MIGRATION_PENDING", message: MIGRATION_PENDING_AR, created: 0, updated: 0, unchanged: 0 };
    if (f.notAuthorized) return { ...base, ok: false, code: "NOT_AUTHORIZED", message: `لا تملك صلاحية تنفيذ الاستيراد (${where}).`, created: 0, updated: 0, unchanged: 0 };
    return {
      ...base,
      ok: false,
      code: mode === "commit" ? "AMBIGUOUS_RESULT" : "TRANSPORT_FAILED",
      created: 0,
      updated: 0,
      unchanged: 0,
      message:
        mode === "commit"
          ? `توقّف التنفيذ ${where}: ${f.error}. راجع الدفعة ${run.batchId ?? ""} في سجلّ الاستيراد قبل إعادة المحاولة — لا تفترض أنّ شيئًا كُتب أو لم يُكتب.`
          : `تعذّر الفحص التجريبي ${where}: ${f.error}. لم يُكتب أي شيء.`,
    };
  }

  const result = normalizeBatchReport(run.reportRows, built.index, mode, run.batchId);
  const notes: string[] = [];
  if (built.deeperLevelsRecordedAsMetadata) {
    notes.push("الملف يحتوي مستويات أعمق من «المرحلة»؛ سُجِّلت داخل بيانات المخرَج (metadata) لأن قاعدة البيانات تدعم مستوى فرعيًّا واحدًا.");
  }
  if (built.unmappedContentTypes.length > 0) {
    notes.push(`أنواع محتوى غير معروفة سُجِّلت كـ«نوع مخصّص» مع الاحتفاظ بنصّها: ${built.unmappedContentTypes.slice(0, 5).join(" ، ")}.`);
  }
  if (run.noteAr) notes.push(run.noteAr);
  return notes.length === 0 ? result : { ...result, message: `${result.message} ${notes.join(" ")}` };
}

/**
 * Run the import. `call` is injected so this works from an API route (user
 * token), from the browser, or from a test with no network at all.
 */
export async function executeImport(plan: ImportPlan, opts: ExecuteOptions, call: RpcCaller): Promise<ExecuteResult> {
  const mode = opts.mode;
  if (!plan.ok) return refusal("REFUSED_INVALID_PLAN", plan.fatalMessage ?? "الملف غير صالح للاستيراد.", mode);
  if (plan.invalidRows.length > 0 && !opts.skipInvalidRows) {
    return refusal(
      "REFUSED_INVALID_ROWS",
      `يحتوي الملف على ${plan.invalidRows.length} سطرًا غير صالح. صحّحها أولًا، أو أكّد صراحةً تجاهلها قبل التنفيذ.`,
      mode,
    );
  }

  const backend = await detectBackend(call);
  if (!backend.available) {
    return refusal(backend.reason === MIGRATION_PENDING_AR ? "MIGRATION_PENDING" : "NOT_AUTHORIZED", backend.reason ?? MIGRATION_PENDING_AR, mode);
  }
  if (backend.protocol === "batch") return executeViaBatch(plan, opts, call);

  const { payload, attempted } = buildExecutePayload(plan, opts);
  if (attempted.length === 0) {
    return { ...refusal("NOTHING_TO_DO", "لا يوجد ما يُنفَّذ: كل الأسطر مطابقة لما هو مسجَّل بالفعل.", mode), ok: true };
  }

  let res;
  try {
    res = await call<RawExecuteResponse>(IMPORT_RPC.execute, { p_payload: payload });
  } catch (e) {
    return refusal("TRANSPORT_FAILED", `تعذّر الاتصال بقاعدة البيانات أثناء التنفيذ: ${String(e)}. لم يُؤكَّد أي سطر — تحقّق قبل إعادة المحاولة.`, mode);
  }
  if (!res.ok) {
    if (classifyMissing(res.error, res.status)) return refusal("MIGRATION_PENDING", MIGRATION_PENDING_AR, mode);
    if (res.status === 401 || res.status === 403) return refusal("NOT_AUTHORIZED", "لا تملك صلاحية تنفيذ الاستيراد على هذا المشروع.", mode);
    return refusal("TRANSPORT_FAILED", `فشل التنفيذ: ${res.error}. راجع الدفعة قبل إعادة المحاولة.`, mode);
  }
  const raw = (res.data ?? null) as RawExecuteResponse | null;
  if (raw && raw.ok === false && !Array.isArray(raw.results)) {
    return refusal("TRANSPORT_FAILED", `رفضت قاعدة البيانات الدفعة: ${raw.error ?? "سبب غير محدّد"}.`, mode);
  }
  return normalizeExecuteResponse(raw, attempted, mode);
}
