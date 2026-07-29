// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/preview.ts — the PLANNER. Reads a sheet + a profile and
// produces the complete, honest picture of what an import would do. It performs
// ZERO writes and has ZERO network calls, so:
//   • "dry run" is just this function (full validation + full plan), and
//   • the preview keeps working in the browser even when the import SQL has not
//     been applied yet — the only thing that degrades is create/update matching,
//     which is flagged by existingLookupAvailable.
//
// Everything the operator needs to trust the result is reported: which columns
// were mapped, which were ignored, which rows were skipped and why, which rows
// are duplicates, which are invalid, and every warning per row.
// ════════════════════════════════════════════════════════════════════════════
import type {
  ChangeDetection,
  ImportContext,
  ImportPlan,
  ImportProfile,
  ImportWarning,
  InvalidRow,
  MappedDeliverable,
  MissingFromFile,
  PlannedDeliverable,
  PlannedNode,
  Sheet,
  SheetRow,
  SourceRowConflict,
  UpdateCandidate,
} from "./types";
import { buildMapping, parseDateStrict, parseIntStrict, type SheetMapping } from "./mapping";
import { canonicalType, CORE_FIELDS } from "./profile";
import { cleanCell, headerKey, isBlank, normalizeForMatch, splitMulti } from "./text";
import { contentHash, externalKey, nodeKey, parentProjectKey, stableSlug } from "./keys";
import { buildExistingIndex, classifyRow, isStructuralKey } from "./change";

export const MAX_IMPORT_ROWS = 5000;
/**
 * A warning per row on a 5000-row sheet is a 10 MB response nobody reads. Past
 * this many we stop listing and report the remainder as a count — the numbers
 * stay exact, only the listing is bounded.
 */
export const MAX_LISTED_WARNINGS = 500;
/**
 * Same discipline for the change lists: a 5000-row sheet where everything
 * changed must not become a 10 MB response. The COUNTS stay exact — they are
 * derived from the rows themselves, not from the length of these lists — only
 * the listing is bounded, and the UI says so.
 */
export const MAX_LISTED_CHANGES = 500;

export interface BuildPlanInput {
  sheet: Sheet;
  profile: ImportProfile;
  context: ImportContext;
  fileName?: string;
  /** Warnings raised earlier (file parsing, sheet selection). */
  carriedWarnings?: ImportWarning[];
  maxRows?: number;
}

interface RowReader {
  get(field: string): string;
  has(field: string): boolean;
  nonEmptyCount: number;
}

function readerFor(row: SheetRow, mapping: SheetMapping): RowReader {
  const get = (field: string): string => {
    const i = mapping.byField.get(field);
    if (i === undefined) return "";
    return cleanCell(row.cells[i] ?? "");
  };
  return {
    get,
    has: (field) => mapping.byField.has(field),
    nonEmptyCount: row.cells.reduce((n, c) => (isBlank(c) ? n : n + 1), 0),
  };
}

/** Build the full plan. Pure: same input ⇒ byte-identical output (bar the timestamp). */
export function buildPlan(input: BuildPlanInput): ImportPlan {
  const { sheet, profile, context } = input;
  const maxRows = input.maxRows ?? MAX_IMPORT_ROWS;
  const warnings: ImportWarning[] = [...(input.carriedWarnings ?? [])];
  let suppressedWarnings = 0;
  const warn = (w: ImportWarning): void => {
    if (warnings.length >= MAX_LISTED_WARNINGS) suppressedWarnings++;
    else warnings.push(w);
  };
  const invalidRows: InvalidRow[] = [];
  const skippedRows: { rowNumber: number; reason: string }[] = [];
  const duplicateRows: { rowNumber: number; external_key: string; reason: string }[] = [];
  const deliverables: PlannedDeliverable[] = [];

  const mapping = buildMapping(sheet, profile);
  const existing = context.existing ?? {};
  const existingLookupAvailable = context.existingLookupAvailable !== false && context.existing !== undefined;
  const projectKey = context.projectKey;
  const updateCandidates: UpdateCandidate[] = [];
  const sourceRowConflicts: SourceRowConflict[] = [];
  const missingFromFile: MissingFromFile[] = [];
  // The index answers the three questions the key alone cannot: does this key
  // already exist, what already sits at this file row, and what is stored that
  // the file no longer mentions.
  const existingIndex = buildExistingIndex(existing, existingLookupAvailable && context.existingSetComplete === true);
  const changeDetection: ChangeDetection = {
    existingLookupAvailable,
    existingSetComplete: existingIndex.complete,
    sourceRowNumbersKnown: existingIndex.rowNumbersKnown,
    fieldLevelDiffAvailable: existingIndex.fieldsKnown,
    note: null,
  };

  for (const col of mapping.unmapped) {
    warnings.push({ code: "unmapped_column", column: col, message: `العمود «${col}» غير معروف في ملف التعيين، ولم يُستورد.` });
  }
  for (const dup of mapping.duplicateColumns) {
    warnings.push({ code: "unmapped_column", column: dup.header, message: `العمود «${dup.header}» يكرّر الحقل نفسه، وقد اعتُمد العمود الأول فقط.` });
  }

  const base: ImportPlan = {
    ok: true,
    fatalMessage: null,
    profileId: profile.id,
    profileVersion: profile.version,
    projectKey,
    fileName: input.fileName ?? sheet.name,
    sheetName: sheet.name,
    mapping: mapping.columns.map((c) => ({ column: c.header, index: c.index, field: c.field })),
    unmappedColumns: mapping.unmapped,
    parentProject: null,
    nodes: [],
    deliverables,
    counts: {
      parentProjectsToCreate: 0,
      stagesToCreate: 0,
      subgroupsToCreate: 0,
      deliverablesToCreate: 0,
      deliverablesToUpdate: 0,
      deliverablesUnchanged: 0,
      accepted: 0,
      skipped: 0,
      duplicate: 0,
      invalid: 0,
      toCreate: 0,
      unchanged: 0,
      updateCandidates: 0,
      sourceRowConflicts: 0,
      missingFromFile: 0,
      warnings: 0,
    },
    skippedRows,
    duplicateRows,
    invalidRows,
    warnings,
    updateCandidates,
    sourceRowConflicts,
    missingFromFile,
    changeDetection,
    existingLookupAvailable,
    generatedAt: new Date().toISOString(),
  };

  if (!mapping.byField.has("title")) {
    base.counts.warnings = warnings.length;
    return {
      ...base,
      ok: false,
      fatalMessage: `تعذّر إيجاد عمود العنوان في الملف. العناوين المقبولة: ${profile.fields.title.synonyms.slice(0, 6).join(" / ")}.`,
    };
  }

  // ─── row scan ────────────────────────────────────────────────────────────
  const levels = profile.levels;
  const carry: (string | null)[] = levels.map(() => null);
  const skipSet = new Set(profile.skipRowValues.map((v) => headerKey(v)).filter(Boolean));
  const headerSignature = mapping.columns.map((c) => headerKey(c.header)).join("|");
  /** identity → the rows already accepted under it (occurrence + duplicate logic). */
  const identitySeen = new Map<string, { hash: string; rowNumber: number; key: string }[]>();
  const keysSeen = new Map<string, number>();
  let dataRows = 0;

  // ── BANNER ROWS ──────────────────────────────────────────────────────────
  // REAL-FILE CASE: a planning sheet almost never carries a "stage" COLUMN. It
  // writes the stage as a full-width BANNER ROW — the stage title alone in the
  // first content column, every other column blank — and the rows beneath it
  // belong to that stage. Without this, each banner became a phantom deliverable
  // with no stage, the whole file collapsed onto one level, and two genuinely
  // different rows that share a title in DIFFERENT stages were reported as an
  // in-file duplicate and one of them was dropped.
  //
  // Deliberately narrow, so a sheet that really does have a stage column (the
  // path the section-row logic below already covers) is untouched:
  //   • only for a level the profile declares with sectionRows AND whose column
  //     is genuinely ABSENT from this sheet (outermost such level wins),
  //   • only when the sheet carries ≥2 content columns — otherwise a plain list
  //     of titles would turn every one of its rows into a banner, and
  //   • only when the title cell is the row's ONLY non-blank cell.
  // Every banner is reported in skippedRows, so nothing disappears silently.
  const contentFieldCount = mapping.columns.filter((c) => c.field && !levels.some((l) => l.field === c.field)).length;
  let bannerLevel = -1;
  for (let li = 0; li < levels.length; li++) {
    if (levels[li].sectionRows && !mapping.byField.has(levels[li].field)) {
      bannerLevel = li;
      break;
    }
  }
  const bannerEnabled = bannerLevel >= 0 && contentFieldCount >= 2;

  // Start at row 0, not at the header row: the FIRST banner of a real sheet sits
  // ABOVE the column-header row, and everything above that row used to be
  // discarded with no skipped entry and no warning at all.
  for (let i = 0; i < sheet.rows.length; i++) {
    if (i === mapping.headerRowIndex) continue;
    const beforeHeader = i < mapping.headerRowIndex;
    const row = sheet.rows[i];
    const r = readerFor(row, mapping);

    if (r.nonEmptyCount === 0) {
      skippedRows.push({ rowNumber: row.rowNumber, reason: "سطر فارغ" });
      continue;
    }
    if (!beforeHeader && dataRows >= maxRows) {
      warnings.push({ code: "truncated", message: `تجاوز الملف الحدّ الأقصى (${maxRows} سطرًا)؛ لم تُقرأ الأسطر التالية.`, rowNumber: row.rowNumber });
      break;
    }

    // A repeated header (very common when sheets are concatenated).
    if (row.cells.map((c) => headerKey(c)).join("|") === headerSignature) {
      skippedRows.push({ rowNumber: row.rowNumber, reason: "سطر عناوين مكرّر" });
      continue;
    }
    const firstNonEmpty = row.cells.find((c) => !isBlank(c)) ?? "";
    if (skipSet.has(headerKey(firstNonEmpty))) {
      skippedRows.push({ rowNumber: row.rowNumber, reason: `سطر تجميعي («${cleanCell(firstNonEmpty)}»)` });
      continue;
    }

    // A banner row DEFINES the level for the rows that follow it (see above).
    // Checked after the totals/repeated-header guards so a lone «الإجمالي» stays
    // a totals row rather than becoming a stage.
    if (bannerEnabled && r.nonEmptyCount === 1) {
      const bannerTitle = r.get("title");
      if (bannerTitle !== "") {
        carry[bannerLevel] = bannerTitle;
        for (let k = bannerLevel + 1; k < levels.length; k++) carry[k] = null;
        skippedRows.push({ rowNumber: row.rowNumber, reason: `سطر يعرّف ${levels[bannerLevel].label}: «${bannerTitle}»` });
        continue;
      }
    }

    // Anything else above the header row is decoration (a document title, a logo
    // row). It is NOT imported — but it is now REPORTED instead of vanishing.
    if (beforeHeader) {
      skippedRows.push({ rowNumber: row.rowNumber, reason: "سطر قبل صف العناوين — لم يُقرأ" });
      continue;
    }

    // ── hierarchy context ──
    let explicitLevel = -1;
    const levelPath: (string | null)[] = [];
    for (let li = 0; li < levels.length; li++) {
      const v = levels[li].field ? r.get(levels[li].field) : "";
      if (v !== "") {
        carry[li] = v;
        explicitLevel = li;
        // A new value at this level invalidates every deeper carried value —
        // otherwise a sub-group would silently leak into the next stage.
        for (let k = li + 1; k < levels.length; k++) carry[k] = null;
      }
    }
    for (let li = 0; li < levels.length; li++) {
      const own = levels[li].field ? r.get(levels[li].field) : "";
      if (own !== "") levelPath.push(own);
      else if (levels[li].carryForward) levelPath.push(carry[li]);
      else levelPath.push(null);
    }

    const title = r.get("title");

    // A "section row" carries ONLY level information and defines the context.
    // A row that has a stage AND real content but no title is NOT a section row —
    // it is a broken data row, and reporting it as "skipped" would hide the loss.
    let contentCells = 0;
    for (const col of mapping.columns) {
      if (!col.field) continue;
      if (levels.some((l) => l.field === col.field)) continue;
      if (!isBlank(row.cells[col.index])) contentCells++;
    }
    if (title === "" && explicitLevel >= 0 && levels[explicitLevel].sectionRows && contentCells === 0) {
      skippedRows.push({ rowNumber: row.rowNumber, reason: `سطر يعرّف ${levels[explicitLevel].label}: «${carry[explicitLevel] ?? ""}»` });
      continue;
    }

    dataRows++;

    if (title === "") {
      invalidRows.push({ rowNumber: row.rowNumber, code: "missing_required", field: "title", message: "العنوان مفقود — لا يمكن إنشاء مخرَج بلا عنوان." });
      continue;
    }
    const titleMax = profile.fields.title.maxLength ?? 500;
    if (title.length > titleMax) {
      invalidRows.push({ rowNumber: row.rowNumber, code: "value_too_long", field: "title", value: title.slice(0, 40), message: `العنوان أطول من الحدّ المسموح (${titleMax} حرفًا).` });
      continue;
    }
    let levelMissing = false;
    for (let li = 0; li < levels.length; li++) {
      if (levels[li].required && !levelPath[li]) {
        invalidRows.push({ rowNumber: row.rowNumber, code: "no_level_context", field: levels[li].field, message: `${levels[li].label} مطلوبة ولم تُحدَّد لهذا السطر.` });
        levelMissing = true;
        break;
      }
    }
    if (levelMissing) continue;

    // ── field mapping ──
    const contentTypeRaw = r.get("content_type");
    const typed = contentTypeRaw === "" ? { type: "other" as const, matched: false } : canonicalType(contentTypeRaw, profile);
    if (contentTypeRaw !== "" && !typed.matched) {
      warn({
        code: "unknown_content_type",
        rowNumber: row.rowNumber,
        value: contentTypeRaw,
        message: `نوع المحتوى «${contentTypeRaw}» غير معروف؛ حُفظ نصّه كما هو ووُضع تحت النوع «أخرى».`,
      });
    }

    let dueDate: string | null = null;
    const dueRaw = r.get("due_date");
    if (dueRaw !== "") {
      const parsed = parseDateStrict(dueRaw);
      dueDate = parsed.iso;
      if (!parsed.iso) {
        warn({
          code: "unparsed_date",
          rowNumber: row.rowNumber,
          value: dueRaw,
          message:
            parsed.reason === "ambiguous_number"
              ? `القيمة «${dueRaw}» في عمود التاريخ رقم وليست تاريخًا؛ تُرك تاريخ التسليم فارغًا (لن يُخترع تاريخ).`
              : `تعذّرت قراءة التاريخ «${dueRaw}»؛ تُرك تاريخ التسليم فارغًا (لن يُخترع تاريخ). الصيغ المقبولة: yyyy-mm-dd أو dd/mm/yyyy.`,
        });
      }
    }

    let quantity: number | null = null;
    if (r.has("quantity")) {
      const q = parseIntStrict(r.get("quantity"));
      quantity = q.value;
      if (!q.ok) {
        warn({ code: "missing_optional", rowNumber: row.rowNumber, value: r.get("quantity"), message: `تعذّرت قراءة العدد «${r.get("quantity")}»؛ تُرك فارغًا.` });
      }
    }

    const extra: Record<string, string> = {};
    for (const col of mapping.columns) {
      const field = col.field;
      if (!field) continue;
      if ((CORE_FIELDS as readonly string[]).includes(field)) continue;
      if (levels.some((l) => l.field === field)) continue;
      const v = r.get(field);
      if (v !== "") extra[field] = v;
    }

    const levelKeys = levelPath.map((v) => (v ? stableSlug(v, 40) : null));
    const mapped: MappedDeliverable = {
      external_key: "",
      content_hash: "",
      source_row_number: row.rowNumber,
      level_path: levelPath,
      level_keys: levelKeys,
      title,
      type: typed.type,
      content_type_raw: contentTypeRaw === "" ? null : contentTypeRaw,
      platforms: splitMulti(r.get("platforms")),
      execution_details: r.get("execution_details") || null,
      proposed_caption: r.get("proposed_caption") || null,
      notes: r.get("notes") || null,
      assignee_hint: r.get("assignee") || null,
      priority: r.get("priority") || null,
      quantity,
      due_date: dueDate,
      schedule_status: profile.defaultScheduleStatus,
      status: profile.defaultStatus,
      extra,
    };
    const hash = contentHash(mapped);

    const identity = `${levelKeys.map((k) => k ?? "").join("/")}|${normalizeForMatch(title)}`;
    const previous = identitySeen.get(identity) ?? [];
    const twin = previous.find((p) => p.hash === hash);
    if (twin) {
      // Byte-identical repeat of a row already accepted → an accidental copy.
      // (A repeat with DIFFERENT content is a legitimate second deliverable and
      // is kept, distinguished by its occurrence ordinal.)
      duplicateRows.push({ rowNumber: row.rowNumber, external_key: twin.key, reason: `يكرّر السطر ${twin.rowNumber} بالكامل («${title}») — استُبعد.` });
      warn({ code: "duplicate_in_file", rowNumber: row.rowNumber, value: title, message: `تكرار كامل للسطر ${twin.rowNumber} داخل الملف.` });
      continue;
    }
    const occurrence = previous.length + 1;

    const { key } = externalKey({
      profileId: profile.id,
      projectKey,
      levelKeys,
      row: {
        strategy: profile.keyStrategy,
        explicit: r.get("external_key") || null,
        levelKeys,
        title,
        occurrence,
        rowNumber: row.rowNumber,
      },
    });

    const firstRow = keysSeen.get(key);
    if (firstRow !== undefined) {
      duplicateRows.push({ rowNumber: row.rowNumber, external_key: key, reason: `المعرّف «${key}» مستخدَم في السطر ${firstRow} — استُبعد هذا السطر.` });
      warn({ code: "duplicate_in_file", rowNumber: row.rowNumber, value: key, message: `معرّف مكرّر داخل الملف (السطر ${firstRow}).` });
      continue;
    }
    keysSeen.set(key, row.rowNumber);
    identitySeen.set(identity, previous.concat([{ hash, rowNumber: row.rowNumber, key }]));

    mapped.external_key = key;
    mapped.content_hash = hash;
    // The ACTION is decided after the scan, not here: the renamed-title test
    // needs the complete key set of the file (see the second pass below), and
    // deciding early would mean deciding without it.
    deliverables.push({
      ...mapped,
      parentKey: levelKeys.some(Boolean) ? nodeKey(profile.id, projectKey, levelKeys) : null,
      action: "create",
      existingId: null,
      changedFields: [],
      conflictWith: null,
      changeReason: null,
    });
  }

  // ─── SECOND PASS: change / conflict detection ────────────────────────────
  // Runs on the finished row set because two of the five outcomes are only
  // decidable with the WHOLE file in hand:
  //   • a renamed title is a conflict only if the old key is claimed by NO row,
  //   • a stored record is "missing" only if NO row claims it.
  const fileKeys = new Set(deliverables.map((d) => d.external_key));
  /** Existing keys a conflict already explains — never double-reported below. */
  const explainedByConflict = new Set<string>();
  for (const d of deliverables) {
    const verdict = classifyRow({
      external_key: d.external_key,
      content_hash: d.content_hash,
      source_row_number: d.source_row_number,
      mapped: d,
      index: existingIndex,
      fileKeys,
    });
    d.action = verdict.outcome;
    d.existingId = verdict.existingId;
    d.changedFields = verdict.changes;
    d.changeReason = verdict.reason;
    d.conflictWith = verdict.conflictWith
      ? {
          external_key: verdict.conflictWith.external_key,
          id: verdict.conflictWith.id,
          title: verdict.conflictWith.title,
          source_row_number: verdict.conflictWith.source_row_number,
        }
      : null;
    if (verdict.outcome === "update") {
      if (updateCandidates.length < MAX_LISTED_CHANGES) {
        updateCandidates.push({
          rowNumber: d.source_row_number,
          external_key: d.external_key,
          existingId: verdict.existingId,
          title: d.title,
          changes: verdict.changes,
          reason: verdict.reason ?? "",
        });
      }
    } else if (verdict.outcome === "source_row_conflict" && verdict.conflictWith) {
      // Recorded even past the listing cap: this set decides what is reported as
      // "missing from the file", and a truncated set would double-report rows.
      explainedByConflict.add(verdict.conflictWith.external_key);
      if (sourceRowConflicts.length < MAX_LISTED_CHANGES) {
        sourceRowConflicts.push({
          rowNumber: d.source_row_number,
          newKey: d.external_key,
          newTitle: d.title,
          existingKey: verdict.conflictWith.external_key,
          existingTitle: verdict.conflictWith.title,
          existingId: verdict.conflictWith.id,
          reason: verdict.reason ?? "",
        });
      }
    }
  }

  // ── outcome 5: stored records the file no longer contains ──
  // ONLY when the lookup covered the whole project. Otherwise we would report
  // rows as "missing" merely because we never asked about them. NOTHING is
  // deleted here or anywhere downstream — this list is a report.
  let missingCount = 0;
  if (existingIndex.complete) {
    for (const entry of Array.from(existingIndex.byKey.entries())) {
      const key = entry[0];
      const info = entry[1];
      if (isStructuralKey(key)) continue; // hierarchy nodes are not deliverables
      if (fileKeys.has(key)) continue;
      if (explainedByConflict.has(key)) continue; // already reported as a conflict
      missingCount++;
      if (missingFromFile.length >= MAX_LISTED_CHANGES) continue;
      missingFromFile.push({
        external_key: key,
        id: info.id,
        title: info.title,
        source_row_number: info.source_row_number,
        reason: `سجل محفوظ${info.source_row_number ? ` (كان في السطر ${info.source_row_number})` : ""} لا يقابله أي سطر في الملف الجديد. لم يُحذف شيء — راجعه بنفسك.`,
      });
    }
    missingFromFile.sort((a, b) => (a.source_row_number ?? 0) - (b.source_row_number ?? 0) || a.external_key.localeCompare(b.external_key));
  }

  // The listings above are capped; the counts below are not. Say so rather than
  // letting a short list imply a small problem.
  if (updateCandidates.length >= MAX_LISTED_CHANGES || sourceRowConflicts.length >= MAX_LISTED_CHANGES || missingFromFile.length >= MAX_LISTED_CHANGES) {
    warnings.push({
      code: "truncated",
      message: `عُرض أول ${MAX_LISTED_CHANGES} عنصر فقط في قوائم التعديلات/التعارضات/السجلات الغائبة؛ الأعداد المعروضة كاملة وصحيحة.`,
    });
  }

  // ── say what could NOT be checked, instead of implying it was ──
  if (existingLookupAvailable && (!existingIndex.complete || !existingIndex.rowNumbersKnown)) {
    const missingChecks: string[] = [];
    if (!existingIndex.rowNumbersKnown) missingChecks.push("كشف تعارض تغيير العنوان (لا تتوفّر أرقام الأسطر المحفوظة)");
    if (!existingIndex.complete) missingChecks.push("كشف السجلات الغائبة عن الملف (لم تُجلب كل سجلات المشروع)");
    changeDetection.note = `تعذّر إجراء: ${missingChecks.join(" ، ")}. الأرقام المعروضة صحيحة فيما تغطّيه، ولا تدّعي ما لم يُفحص.`;
    warnings.push({ code: "change_detection_unavailable", message: changeDetection.note });
  }

  // ─── hierarchy nodes (derived from accepted rows only) ───────────────────
  const nodes: PlannedNode[] = [];
  const nodeIndex = new Map<string, PlannedNode>();
  const seqByParent = new Map<string, number>();
  for (const d of deliverables) {
    for (let li = 0; li < levels.length; li++) {
      const value = d.level_path[li];
      const slug = d.level_keys[li];
      if (!value || !slug) continue;
      const prefix = d.level_keys.slice(0, li + 1);
      const key = nodeKey(profile.id, projectKey, prefix);
      const parent = li === 0 ? null : nodeKey(profile.id, projectKey, d.level_keys.slice(0, li));
      let node = nodeIndex.get(key);
      if (!node) {
        const parentBucket = parent ?? "#root";
        const seq = (seqByParent.get(parentBucket) ?? 0) + 1;
        seqByParent.set(parentBucket, seq);
        node = { key, levelIndex: li, levelKey: levels[li].key, title: value, parentKey: parent, sequence: seq, deliverableCount: 0 };
        nodeIndex.set(key, node);
        nodes.push(node);
      }
      node.deliverableCount++;
    }
  }

  // ─── parent project ──────────────────────────────────────────────────────
  let parentProject: ImportPlan["parentProject"] = null;
  const parentTitle = cleanCell(context.parentProjectTitle ?? "");
  if (parentTitle !== "") {
    const key = parentProjectKey(profile.id, projectKey);
    parentProject = { key, title: parentTitle, exists: !!context.projectId || !!existing[key] };
  }

  if (suppressedWarnings > 0) {
    warnings.push({
      code: "truncated",
      message: `عُرضت أول ${MAX_LISTED_WARNINGS} تنبيه فقط؛ هناك ${suppressedWarnings} تنبيهًا إضافيًّا لم تُدرَج (الأعداد أدناه كاملة وصحيحة).`,
    });
  }

  // ─── counts ──────────────────────────────────────────────────────────────
  const counts = base.counts;
  // The seven first-class outcomes. `toCreate` deliberately EXCLUDES conflicts:
  // a conflict is not a creation waiting to happen, it is a question.
  counts.toCreate = deliverables.filter((d) => d.action === "create").length;
  counts.unchanged = deliverables.filter((d) => d.action === "unchanged").length;
  // Counted from the rows themselves, never from the (capped) listings above.
  counts.updateCandidates = deliverables.filter((d) => d.action === "update").length;
  counts.sourceRowConflicts = deliverables.filter((d) => d.action === "source_row_conflict").length;
  counts.missingFromFile = missingCount;
  counts.warnings = warnings.length;
  // Legacy names kept alive so every existing reader keeps working.
  counts.deliverablesToCreate = counts.toCreate;
  counts.deliverablesToUpdate = counts.updateCandidates;
  counts.deliverablesUnchanged = counts.unchanged;
  counts.accepted = deliverables.length;
  counts.skipped = skippedRows.length;
  counts.duplicate = duplicateRows.length;
  counts.invalid = invalidRows.length;
  counts.stagesToCreate = nodes.filter((n) => n.levelIndex === 0 && !existing[n.key]).length;
  counts.subgroupsToCreate = nodes.filter((n) => n.levelIndex === 1 && !existing[n.key]).length;
  counts.parentProjectsToCreate = parentProject && !parentProject.exists ? 1 : 0;

  if (deliverables.length === 0) {
    return {
      ...base,
      nodes,
      parentProject,
      ok: false,
      fatalMessage:
        invalidRows.length > 0
          ? "لا يوجد أي سطر صالح للاستيراد في الملف — راجع قائمة الأسطر غير الصالحة."
          : "لم يُعثر على أي سطر بيانات بعد صف العناوين.",
    };
  }
  return { ...base, nodes, parentProject };
}
