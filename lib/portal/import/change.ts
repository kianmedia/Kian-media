// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/change.ts — CHANGE / CONFLICT DETECTION.
//
// THE PROBLEM THIS FILE EXISTS TO SOLVE
//   The key strategy is DELIBERATE and unchanged: normalized title + occurrence
//   (see keys.ts). It survives the single most common spreadsheet edit — adding
//   or removing a row — because nothing in a key depends on the row number.
//   It leaves exactly ONE hole: editing a row's TITLE changes its key. A naive
//   re-import would then see "a key I have never met" and CREATE a second
//   deliverable, while the original is stranded with nobody pointing at it.
//   That silent duplicate is the failure this module makes impossible.
//
// THE FIVE OUTCOMES — every incoming row lands in exactly one:
//   1. unchanged           same key, same content        → write nothing
//   2. update              same key, different content   → NEEDS confirmation
//   3. source_row_conflict same (project, source row), key CHANGED, and the old
//                          key is claimed by NO row in the new file → the
//                          renamed-title case. NEVER auto-created.
//   4. create              new key AND no stranded row underneath it
//   5. missing_from_file   an existing key no row in the file claims → REPORTED,
//                          never deleted.
//
// WHY (3) DOES NOT FIRE WHEN A ROW IS INSERTED AT THE TOP
//   Inserting a row above everything shifts every source_row_number below it by
//   one, so "the existing row at this row number has a different key" is TRUE for
//   every shifted row. Flagging those would be a catastrophe of false positives.
//   The second half of the rule is what makes it safe: the existing key at that
//   row number must be ORPHANED — absent from the whole new file. A shifted row
//   still carries its own key somewhere in the file, so it is never orphaned, and
//   the inserted row is a plain create. Renaming a title orphans the old key, and
//   only then does the conflict fire.
//
// Pure functions only: no network, no clock, no database. Everything here is
// decided from the plan plus whatever the lookup could honestly supply.
// ════════════════════════════════════════════════════════════════════════════
import type { MappedDeliverable } from "./types";
import { KEY_SEPARATOR } from "./keys";
import { normalizeForMatch } from "./text";

/**
 * One already-imported row, as the database reported it. Every field beyond the
 * key is OPTIONAL because the lookup degrades: before the richer RPC exists we
 * know only `external_key` + `content_hash`, and the engine must then say which
 * checks it could NOT perform rather than guess.
 */
export interface ExistingRowInfo {
  external_key: string;
  id: string | null;
  content_hash: string | null;
  /** The file row this record was imported from, when the database keeps it. */
  source_row_number: number | null;
  title: string | null;
  /** Comparable field values, when the database exposes them. */
  fields?: Record<string, unknown> | null;
}

/** The map shape callers may pass: legacy (key→hash) or the full row info. */
export type ExistingInput = Record<string, Partial<ExistingRowInfo> & { id?: string | null; content_hash?: string | null }>;

export interface FieldChange {
  field: string;
  /** Arabic label of the field, for the operator. */
  label: string;
  from: string;
  to: string;
}

/** The fields a change is reported on. Order fixed ⇒ diffs read the same twice. */
export const COMPARABLE_FIELDS = [
  "title",
  "content_type_raw",
  "type",
  "platforms",
  "execution_details",
  "proposed_caption",
  "notes",
  "assignee_hint",
  "priority",
  "quantity",
  "due_date",
  "level_path",
  "schedule_status",
  "status",
] as const;

export const FIELD_LABEL_AR: Record<string, string> = {
  title: "العنوان",
  content_type_raw: "نوع المحتوى",
  type: "التصنيف",
  platforms: "المنصات",
  execution_details: "تفاصيل التنفيذ",
  proposed_caption: "نص الوصف المقترح",
  notes: "ملاحظات",
  assignee_hint: "المسؤول",
  priority: "الأولوية",
  quantity: "العدد",
  due_date: "تاريخ التسليم",
  level_path: "الموقع في الهيكل",
  schedule_status: "حالة الجدولة",
  status: "الحالة",
};

/** Every value becomes ONE comparable string. Lists join, nulls become "". */
export function comparableValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map((x) => comparableValue(x)).filter((s) => s !== "").join(" ، ");
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v).trim();
}

/** The row as the file wants it, reduced to the comparable field set. */
export function comparableFields(d: MappedDeliverable): Record<string, string> {
  const out: Record<string, string> = {};
  const src = d as unknown as Record<string, unknown>;
  for (const f of COMPARABLE_FIELDS) out[f] = comparableValue(src[f]);
  return out;
}

/**
 * Which fields differ between the stored row and the incoming row.
 *
 * ONLY fields the database actually reported are compared. A field the lookup
 * did not send is NOT claimed as "changed" — an empty diff means "we know the
 * content differs (the hashes differ) but not which field", and the caller says
 * exactly that instead of inventing a field name.
 */
export function diffFields(prior: ExistingRowInfo, next: MappedDeliverable): FieldChange[] {
  const before = prior.fields;
  const changes: FieldChange[] = [];
  const now = comparableFields(next);
  if (before && typeof before === "object") {
    for (const f of COMPARABLE_FIELDS) {
      if (!(f in before)) continue;
      const from = comparableValue((before as Record<string, unknown>)[f]);
      const to = now[f];
      if (from !== to) changes.push({ field: f, label: FIELD_LABEL_AR[f] ?? f, from, to });
    }
    return changes;
  }
  // No field payload at all: the ONE thing we can still compare honestly is the
  // title, which the lookup does carry.
  const priorTitle = comparableValue(prior.title);
  if (priorTitle !== "" && normalizeForMatch(priorTitle) !== normalizeForMatch(next.title)) {
    changes.push({ field: "title", label: FIELD_LABEL_AR.title, from: priorTitle, to: next.title });
  }
  return changes;
}

/** Structural keys (hierarchy nodes, the parent project) are not deliverables. */
export function isStructuralKey(key: string): boolean {
  const last = key.split(KEY_SEPARATOR).pop() ?? "";
  return last.startsWith("#");
}

export interface ExistingIndex {
  byKey: Map<string, ExistingRowInfo>;
  /** source_row_number → the existing row imported from it. */
  byRow: Map<number, ExistingRowInfo>;
  /** Every deliverable key of the project is present ⇒ "missing" is computable. */
  complete: boolean;
  /** At least one existing row carries a row number ⇒ conflicts are computable. */
  rowNumbersKnown: boolean;
  /** At least one existing row carries field values ⇒ per-field diffs possible. */
  fieldsKnown: boolean;
}

/**
 * Normalise whatever the lookup returned into one index. Accepts the legacy
 * `{key: {id, content_hash}}` map unchanged, so every existing caller keeps
 * working and simply gets `complete=false` (no conflict / missing detection).
 */
export function buildExistingIndex(existing: ExistingInput | undefined, complete: boolean): ExistingIndex {
  const byKey = new Map<string, ExistingRowInfo>();
  const byRow = new Map<number, ExistingRowInfo>();
  let rowNumbersKnown = false;
  let fieldsKnown = false;
  for (const key of Object.keys(existing ?? {})) {
    const raw = (existing as ExistingInput)[key] ?? {};
    const srn = typeof raw.source_row_number === "number" && Number.isFinite(raw.source_row_number) ? raw.source_row_number : null;
    const info: ExistingRowInfo = {
      external_key: key,
      id: raw.id ?? null,
      content_hash: raw.content_hash ?? null,
      source_row_number: srn,
      title: typeof raw.title === "string" ? raw.title : null,
      fields: raw.fields ?? null,
    };
    byKey.set(key, info);
    if (info.fields && typeof info.fields === "object") fieldsKnown = true;
    if (srn !== null && !isStructuralKey(key)) {
      rowNumbersKnown = true;
      // First writer wins: if two records claim one row number the database is
      // already inconsistent, and picking the later one would be arbitrary.
      if (!byRow.has(srn)) byRow.set(srn, info);
    }
  }
  return { byKey, byRow, complete, rowNumbersKnown, fieldsKnown };
}

export type ChangeOutcome = "unchanged" | "update" | "source_row_conflict" | "create";

export interface RowClassification {
  outcome: ChangeOutcome;
  existingId: string | null;
  /** Populated for "update". Empty when the database sent no field values. */
  changes: FieldChange[];
  /** Populated for "source_row_conflict": the stranded record. */
  conflictWith: ExistingRowInfo | null;
  /** Arabic explanation, always present for update / conflict. */
  reason: string | null;
}

export interface ClassifyInput {
  external_key: string;
  content_hash: string;
  source_row_number: number;
  mapped: MappedDeliverable;
  index: ExistingIndex;
  /** EVERY key this file produced — the orphan test depends on it. */
  fileKeys: Set<string>;
}

/** Classify ONE incoming row. See the header for the rules and the reasoning. */
export function classifyRow(input: ClassifyInput): RowClassification {
  const { index } = input;
  const prior = index.byKey.get(input.external_key);
  if (prior) {
    if (prior.content_hash !== null && prior.content_hash === input.content_hash) {
      return { outcome: "unchanged", existingId: prior.id, changes: [], conflictWith: null, reason: null };
    }
    const changes = diffFields(prior, input.mapped);
    return {
      outcome: "update",
      existingId: prior.id,
      changes,
      conflictWith: null,
      reason:
        changes.length > 0
          ? `اختلاف عن السجل المحفوظ في: ${changes.map((c) => c.label).join(" ، ")}.`
          : "محتوى السطر يختلف عن السجل المحفوظ (تفاصيل الحقول غير متاحة من قاعدة البيانات).",
    };
  }

  // A key we have never seen. Is it a RENAME of the record that already occupies
  // this file row, or a genuinely new row?
  const occupant = index.byRow.get(input.source_row_number);
  if (occupant && occupant.external_key !== input.external_key && !input.fileKeys.has(occupant.external_key)) {
    return {
      outcome: "source_row_conflict",
      existingId: null,
      changes: [],
      conflictWith: occupant,
      reason: `السطر ${input.source_row_number} مسجَّل سابقًا باسم «${occupant.title ?? occupant.external_key}» ولم يعد أي سطر في الملف يطابق ذلك السجل. تغيير العنوان يغيّر المعرّف، فالاستيراد المباشر كان سيُنشئ نسخة ثانية ويترك الأصل معلّقًا.`,
    };
  }
  return { outcome: "create", existingId: null, changes: [], conflictWith: null, reason: null };
}
