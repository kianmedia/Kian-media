// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/types.ts — the shared vocabulary of the generic import
// engine. NOTHING here is project-specific: no stage list, no deliverable
// count, no client name. A mapping PROFILE (plain JSON data) supplies all of
// that, so the same engine imports a large social-media plan, a small photo
// shoot, or a long documentary schedule without a code change.
// ════════════════════════════════════════════════════════════════════════════

/** One physical row as read from the file, with its TRUE file row number. */
export interface SheetRow {
  /** 1-based row number in the source sheet (header included). Used in errors. */
  rowNumber: number;
  cells: string[];
}

export interface Sheet {
  name: string;
  rows: SheetRow[];
}

export interface ParsedWorkbook {
  format: "csv" | "xlsx";
  fileName: string;
  sheets: Sheet[];
  /** Non-fatal notes raised while reading the file itself. */
  warnings: ImportWarning[];
}

export type WarningCode =
  | "unmapped_column"
  | "unparsed_date"
  | "unknown_content_type"
  | "duplicate_in_file"
  | "empty_sheet"
  | "extra_sheet_ignored"
  | "truncated"
  | "carry_forward_used"
  | "long_value"
  | "missing_optional"
  | "mixed_separators"
  | "existing_unmatched";

export interface ImportWarning {
  code: WarningCode;
  /** Arabic, user-facing. */
  message: string;
  rowNumber?: number;
  column?: string;
  value?: string;
}

export type InvalidCode =
  | "missing_required"
  | "value_too_long"
  | "invalid_number"
  | "invalid_date"
  | "no_level_context"
  | "row_unreadable";

export interface InvalidRow {
  rowNumber: number;
  code: InvalidCode;
  /** Arabic, user-facing. */
  message: string;
  field?: string;
  value?: string;
}

/** The canonical field names the engine understands. Profiles map to these. */
export type CanonicalField =
  | "external_key"
  | "title"
  | "content_type"
  | "platforms"
  | "execution_details"
  | "proposed_caption"
  | "notes"
  | "quantity"
  | "priority"
  | "assignee"
  | "due_date"
  | "status"
  /** Hierarchy levels are addressed by their profile-declared field names. */
  | string;

/** A profile-declared hierarchy level (stage, sub-group, episode, week …). */
export interface LevelSpec {
  /** Stable machine key used in external keys. */
  key: string;
  /** Arabic label for the UI. */
  label: string;
  /** The canonical field whose value identifies this level on a row. */
  field: string;
  /**
   * Carry the last non-empty value down to following rows (handles sheets that
   * write the stage once on the first row of its block, or use section rows).
   */
  carryForward: boolean;
  /** Rows that fill ONLY this level's column define the level (section rows). */
  sectionRows: boolean;
  /** A level that is optional may legitimately be blank on a row. */
  required: boolean;
}

export interface FieldSpec {
  /** Header texts that mean this field. Matched normalised (Arabic-safe). */
  synonyms: string[];
  required?: boolean;
  /** Cell holds several values (platforms, tags). */
  multi?: boolean;
  /** Interpret as a date. NEVER defaulted when absent or unparseable. */
  date?: boolean;
  /** Interpret as an integer. */
  number?: boolean;
  maxLength?: number;
}

export type KeyStrategy = "external_key" | "identity" | "row";

export interface ImportProfile {
  /** Stable id — first segment of every external key produced by this profile. */
  id: string;
  version: number;
  label: string;
  description?: string;
  /** Optional sheet name; when absent the first non-empty sheet is used. */
  sheet?: string | null;
  /** 1-based header row; when absent it is detected. */
  headerRow?: number | null;
  levels: LevelSpec[];
  fields: Record<string, FieldSpec>;
  /**
   * Maps free-text content types onto the deliverables.type CHECK domain
   * ('video' | 'photo' | 'other'). DATA, not code: extend the JSON, never the
   * engine. The ORIGINAL text is always preserved in content_type_raw.
   */
  typeMap: { video: string[]; photo: string[]; other: string[] };
  /**
   * OPTIONAL, and only used when the database exposes a richer content-type
   * catalog than the three CHECK values: catalogKey → the words that mean it.
   * Unmapped kinds fall back to the catalog's own "custom" key; the original
   * wording is preserved either way. DATA — the engine defines no keys.
   */
  contentTypeKeys?: Record<string, string[]>;
  /** OPTIONAL: databaseKey → the words that mean it (e.g. "عالية" ⇒ high). */
  priorityKeys?: Record<string, string[]>;
  /** Row texts that are decoration and must be skipped (totals, notes…). */
  skipRowValues: string[];
  keyStrategy: KeyStrategy;
  /** Default status for every imported deliverable. Never a date, never today. */
  defaultScheduleStatus: string;
  defaultStatus: string;
}

/** A single mapped, validated deliverable ready to be planned/written. */
export interface MappedDeliverable {
  external_key: string;
  content_hash: string;
  source_row_number: number;
  /** Ordered level values, one per profile level (may contain nulls). */
  level_path: (string | null)[];
  /** Ordered level slugs used to build the key. */
  level_keys: (string | null)[];
  title: string;
  /** deliverables.type — always one of the CHECK values. */
  type: "video" | "photo" | "other";
  /** The user's original wording, never lost. */
  content_type_raw: string | null;
  platforms: string[];
  execution_details: string | null;
  proposed_caption: string | null;
  notes: string | null;
  assignee_hint: string | null;
  priority: string | null;
  quantity: number | null;
  /** ISO yyyy-mm-dd, ONLY when the file actually contained a parseable date. */
  due_date: string | null;
  schedule_status: string;
  status: string;
  /** Everything the profile mapped that has no canonical column of its own. */
  extra: Record<string, string>;
}

export interface PlannedNode {
  /** Deterministic key of this node (same format family as deliverable keys). */
  key: string;
  /** 0 = first declared level (e.g. stage), 1 = second (e.g. sub-group). */
  levelIndex: number;
  levelKey: string;
  /** The exact source text — Arabic preserved. */
  title: string;
  parentKey: string | null;
  /** Position among its siblings, 1-based, in first-seen order. */
  sequence: number;
  deliverableCount: number;
}

export type RowAction = "create" | "update" | "unchanged";

export interface PlannedDeliverable extends MappedDeliverable {
  parentKey: string | null;
  action: RowAction;
  /** Present when the row matched an existing imported record. */
  existingId?: string | null;
}

export interface ImportPlanCounts {
  parentProjectsToCreate: number;
  stagesToCreate: number;
  subgroupsToCreate: number;
  deliverablesToCreate: number;
  deliverablesToUpdate: number;
  deliverablesUnchanged: number;
  accepted: number;
  skipped: number;
  duplicate: number;
  invalid: number;
}

export interface ImportPlan {
  /** false = the file cannot be imported as-is (see fatalMessage/invalidRows). */
  ok: boolean;
  /** Arabic, user-facing. Set only when the whole file is unusable. */
  fatalMessage: string | null;
  profileId: string;
  profileVersion: number;
  projectKey: string;
  fileName: string;
  sheetName: string;
  /** Header row → canonical field, plus the columns nothing claimed. */
  mapping: { column: string; index: number; field: string | null }[];
  unmappedColumns: string[];
  /** Parent project the rows hang under, when the file itself declares one. */
  parentProject: { key: string; title: string; exists: boolean } | null;
  nodes: PlannedNode[];
  deliverables: PlannedDeliverable[];
  counts: ImportPlanCounts;
  skippedRows: { rowNumber: number; reason: string }[];
  duplicateRows: { rowNumber: number; external_key: string; reason: string }[];
  invalidRows: InvalidRow[];
  warnings: ImportWarning[];
  /** True when server-side matching was unavailable (SQL not applied yet). */
  existingLookupAvailable: boolean;
  generatedAt: string;
}

/** What the caller knows about the destination before any write happens. */
export interface ImportContext {
  /** Target project id when importing into an existing project. */
  projectId?: string | null;
  /**
   * Stable slug for the project used INSIDE external keys. Deliberately not the
   * UUID: a re-import must produce identical keys even when run before/after
   * the project row exists.
   */
  projectKey: string;
  /** Optional parent project title declared by the operator or the file. */
  parentProjectTitle?: string | null;
  /** Known existing rows: external_key → {id, content_hash}. */
  existing?: Record<string, { id: string | null; content_hash: string | null }>;
  existingLookupAvailable?: boolean;
}
