// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/index.ts — public surface of the generic import engine.
//
// One import site for UI components and API routes; the internals (ZIP, inflate,
// XML, hashing) stay private so they can change without breaking callers.
// ════════════════════════════════════════════════════════════════════════════
export type {
  CanonicalField,
  ChangeDetection,
  FieldSpec,
  ImportContext,
  ImportPlan,
  ImportPlanCounts,
  ImportProfile,
  ImportWarning,
  InvalidRow,
  LevelSpec,
  MappedDeliverable,
  MissingFromFile,
  ParsedWorkbook,
  PlannedDeliverable,
  PlannedNode,
  RowAction,
  Sheet,
  SheetRow,
  SourceRowConflict,
  UpdateCandidate,
} from "./types";

export { ImportParseError, parseWorkbook, pickSheet, sheetIsEmpty } from "./parse";
export { parseCsv, detectDelimiter } from "./csvParse";
export { parseXlsx, looksLikeXlsx, serialToIso, colIndex } from "./xlsx";
export { DEFAULT_PROFILE, ImportProfileError, canonicalType, normalizeProfile, synonymIndex, CORE_FIELDS } from "./profile";
export { getProfile, hasProfile, listProfiles, registerProfile, resolveProfile, type ProfileSummary } from "./profiles";
export { buildMapping, detectHeaderRow, parseDateStrict, parseIntStrict, type ColumnMapping, type SheetMapping } from "./mapping";
export { canonicalJson, contentHash, deriveProjectKey, externalKey, levelPathKey, nodeKey, parentProjectKey, rowKey, stableSlug, KEY_SEPARATOR, LEVEL_SEPARATOR } from "./keys";
export { buildPlan, MAX_IMPORT_ROWS, type BuildPlanInput } from "./preview";
export { buildExecutePayload, executeImport, gatePlanForWrite, normalizeExecuteResponse, type ExecuteCode, type ExecuteOptions, type ExecuteResult, type RowOutcome, type WriteGate } from "./execute";
export {
  buildExistingIndex,
  classifyRow,
  comparableFields,
  comparableValue,
  diffFields,
  isStructuralKey,
  COMPARABLE_FIELDS,
  FIELD_LABEL_AR,
  type ChangeOutcome,
  type ExistingIndex,
  type ExistingRowInfo,
  type FieldChange,
  type RowClassification,
} from "./change";
export {
  classifyMissing,
  detectBackend,
  importFailureReason,
  isMigrationPending,
  logImportFailure,
  lookupExisting,
  lookupProjectRows,
  IMPORT_RPC,
  PROJECT_ROWS_RPC,
  MIGRATION_PENDING_AR,
  type BackendState,
  type ExistingRowMap,
  type ImportProtocol,
  type ProjectRowsResult,
  type RpcCaller,
  type RpcOutcome,
} from "./rpc";
export {
  BATCH_RPC,
  BATCH_ROW_LIMIT,
  buildBatchRows,
  contentTypeKeyFor,
  runBatchProtocol,
  DB_CONTENT_TYPE_FALLBACK,
  DB_PRIORITY,
  DB_SCHEDULE_STATUS,
  DB_STATUS,
  NO_TARGET_PROJECT_AR,
  type BatchRow,
  type BatchReportRow,
} from "./batchBackend";
export { normalizeBatchReport } from "./execute";
export { sha256, shortHash } from "./sha256";
export { cleanCell, headerKey, normalizeForMatch, slugify, splitMulti, toAsciiDigits } from "./text";
