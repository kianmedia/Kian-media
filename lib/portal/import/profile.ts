// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/profile.ts — a mapping PROFILE is DATA, never code.
//
// A profile answers four questions for ONE shape of spreadsheet:
//   • which column header means which canonical field (with synonyms),
//   • which columns define the hierarchy levels and how they repeat,
//   • how free-text content types collapse onto deliverables.type
//     ('video'|'photo'|'other' — the live CHECK constraint), and
//   • how a row's stable identity is derived.
// Adding support for a new client's sheet = adding a JSON file. No engine change,
// no component change, no migration. THE ENGINE NEVER NAMES A PROJECT.
// ════════════════════════════════════════════════════════════════════════════
import type { FieldSpec, ImportProfile, KeyStrategy, LevelSpec } from "./types";
import { headerKey } from "./text";

export class ImportProfileError extends Error {
  readonly arabic: string;
  constructor(arabic: string) {
    super(arabic);
    this.name = "ImportProfileError";
    this.arabic = arabic;
  }
}

/** Canonical fields that have a dedicated slot on MappedDeliverable. */
export const CORE_FIELDS = [
  "external_key",
  "title",
  "content_type",
  "platforms",
  "execution_details",
  "proposed_caption",
  "notes",
  "quantity",
  "priority",
  "assignee",
  "due_date",
] as const;

/**
 * The fallback profile: deliberately broad synonyms so an operator who just
 * downloads the template (or exports from any planning sheet) gets a working
 * mapping without configuring anything.
 */
export const DEFAULT_PROFILE: ImportProfile = {
  id: "generic",
  version: 1,
  label: "تعيين عام (يصلح لأي ملف)",
  description: "ملف تعيين افتراضي يتعرّف على العناوين الشائعة بالعربية والإنجليزية.",
  sheet: null,
  headerRow: null,
  levels: [
    { key: "stage", label: "المرحلة", field: "stage", carryForward: true, sectionRows: true, required: false },
    { key: "subgroup", label: "المجموعة", field: "sub_group", carryForward: true, sectionRows: true, required: false },
  ],
  fields: {
    stage: { synonyms: ["المرحلة", "مرحلة", "المرحلة الإنتاجية", "مراحل العمل", "stage", "phase"] },
    sub_group: { synonyms: ["المجموعة", "المجموعة الفرعية", "القسم", "التصنيف", "المحور", "group", "sub group", "subgroup", "section", "category"] },
    title: {
      synonyms: ["المحتوى", "العنوان", "اسم المخرج", "المخرج", "البند", "العمل المطلوب", "المهمة", "title", "name", "deliverable", "item", "task"],
      required: true,
      maxLength: 500,
    },
    content_type: { synonyms: ["نوع المحتوى", "نوع المخرج", "النوع", "نوع", "content type", "type", "format"] },
    platforms: { synonyms: ["المنصات", "المنصة", "منصات النشر", "قنوات النشر", "platforms", "platform", "channels", "channel"], multi: true },
    execution_details: { synonyms: ["تفاصيل التنفيذ", "التنفيذ", "تفاصيل", "ملاحظات التنفيذ", "وصف التنفيذ", "execution details", "execution", "details", "brief"], maxLength: 4000 },
    proposed_caption: { synonyms: ["نص الوصف المقترح", "الوصف المقترح", "النص المقترح", "الكابشن", "كابشن", "caption", "proposed caption", "copy"], maxLength: 4000 },
    notes: { synonyms: ["ملاحظات", "ملحوظات", "notes", "remarks", "comment"], maxLength: 4000 },
    due_date: { synonyms: ["تاريخ التسليم", "موعد التسليم", "تاريخ النشر", "التاريخ", "due date", "deadline", "date", "delivery date"], date: true },
    quantity: { synonyms: ["العدد", "الكمية", "quantity", "qty", "count"], number: true },
    priority: { synonyms: ["الأولوية", "priority"] },
    assignee: { synonyms: ["المسؤول", "المكلف", "المنفذ", "assignee", "owner", "responsible"] },
    external_key: { synonyms: ["المعرف", "الرقم المرجعي", "الرقم", "كود", "reference", "ref", "external key", "id"] },
  },
  typeMap: {
    video: ["فيديو", "ڤيديو", "مقطع", "مقطع فيديو", "ريلز", "ريل", "reel", "reels", "video", "motion", "موشن", "موشن جرافيك", "فيلم", "تيزر", "teaser", "برومو", "promo", "إعلان مرئي", "تصوير فيديو"],
    photo: ["صورة", "صور", "تصوير", "تصوير فوتوغرافي", "فوتو", "photo", "photos", "photography", "image", "بورتريه", "portrait"],
    other: [],
  },
  skipRowValues: ["الإجمالي", "الاجمالي", "المجموع", "الملخص", "total", "totals", "summary", "grand total"],
  keyStrategy: "identity",
  defaultScheduleStatus: "awaiting_schedule",
  defaultStatus: "draft",
};

function asStringArray(v: unknown, path: string): string[] {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new ImportProfileError(`ملف التعيين غير صالح: «${path}» يجب أن يكون قائمة نصوص.`);
  return v.map((x) => String(x));
}

function normalizeField(raw: unknown, path: string): FieldSpec {
  if (!raw || typeof raw !== "object") throw new ImportProfileError(`ملف التعيين غير صالح: «${path}» يجب أن يكون كائنًا.`);
  const r = raw as Record<string, unknown>;
  const synonyms = asStringArray(r.synonyms, `${path}.synonyms`);
  if (synonyms.length === 0) throw new ImportProfileError(`ملف التعيين غير صالح: الحقل «${path}» بلا مرادفات.`);
  return {
    synonyms,
    required: r.required === true,
    multi: r.multi === true,
    date: r.date === true,
    number: r.number === true,
    maxLength: typeof r.maxLength === "number" && r.maxLength > 0 ? r.maxLength : undefined,
  };
}

function normalizeLevel(raw: unknown, i: number): LevelSpec {
  if (!raw || typeof raw !== "object") throw new ImportProfileError(`ملف التعيين غير صالح: المستوى رقم ${i + 1} غير صحيح.`);
  const r = raw as Record<string, unknown>;
  const key = String(r.key ?? "").trim();
  const field = String(r.field ?? key).trim();
  if (!key) throw new ImportProfileError(`ملف التعيين غير صالح: المستوى رقم ${i + 1} بلا مفتاح (key).`);
  return {
    key,
    label: String(r.label ?? key),
    field,
    carryForward: r.carryForward !== false,
    sectionRows: r.sectionRows !== false,
    required: r.required === true,
  };
}

/**
 * Validate + fill defaults for a profile that arrived as JSON. Throws an Arabic
 * error the UI can show directly. NEVER mutates the input object.
 */
export function normalizeProfile(raw: unknown): ImportProfile {
  if (!raw || typeof raw !== "object") throw new ImportProfileError("ملف التعيين غير صالح: المحتوى ليس كائن JSON.");
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "").trim();
  if (!/^[a-z0-9][a-z0-9_-]{1,40}$/i.test(id)) {
    throw new ImportProfileError("ملف التعيين غير صالح: المعرّف (id) يجب أن يتكوّن من حروف/أرقام إنجليزية بطول 2–41.");
  }
  const fieldsRaw = (r.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, FieldSpec> = {};
  for (const [name, spec] of Object.entries(fieldsRaw)) fields[name] = normalizeField(spec, `fields.${name}`);
  if (!fields.title) throw new ImportProfileError("ملف التعيين غير صالح: الحقل «title» إلزامي في كل ملف تعيين.");
  fields.title.required = true;

  const levels = (Array.isArray(r.levels) ? r.levels : []).map(normalizeLevel);
  for (const l of levels) {
    if (!fields[l.field]) {
      throw new ImportProfileError(`ملف التعيين غير صالح: المستوى «${l.key}» يشير إلى حقل غير معرّف «${l.field}».`);
    }
  }
  const seenLevel = new Set<string>();
  for (const l of levels) {
    if (seenLevel.has(l.key)) throw new ImportProfileError(`ملف التعيين غير صالح: تكرار مفتاح المستوى «${l.key}».`);
    seenLevel.add(l.key);
  }

  const tmRaw = (r.typeMap ?? {}) as Record<string, unknown>;
  const typeMap = {
    video: asStringArray(tmRaw.video, "typeMap.video"),
    photo: asStringArray(tmRaw.photo, "typeMap.photo"),
    other: asStringArray(tmRaw.other, "typeMap.other"),
  };
  const synonymMap = (v: unknown, path: string): Record<string, string[]> | undefined => {
    if (v == null) return undefined;
    if (typeof v !== "object" || Array.isArray(v)) throw new ImportProfileError(`ملف التعيين غير صالح: «${path}» يجب أن يكون كائنًا.`);
    const out: Record<string, string[]> = {};
    for (const entry of Object.entries(v as Record<string, unknown>)) {
      if (entry[0].startsWith("$")) continue; // documentation keys
      out[entry[0]] = asStringArray(entry[1], `${path}.${entry[0]}`);
    }
    return out;
  };
  const strategyRaw = String(r.keyStrategy ?? "identity");
  const keyStrategy: KeyStrategy =
    strategyRaw === "external_key" || strategyRaw === "row" || strategyRaw === "identity" ? (strategyRaw as KeyStrategy) : "identity";

  const version = Number(r.version ?? 1);
  return {
    id,
    version: Number.isFinite(version) && version > 0 ? Math.floor(version) : 1,
    label: String(r.label ?? id),
    description: r.description == null ? undefined : String(r.description),
    sheet: r.sheet == null || r.sheet === "" ? null : String(r.sheet),
    headerRow: typeof r.headerRow === "number" && r.headerRow > 0 ? Math.floor(r.headerRow) : null,
    levels,
    fields,
    typeMap,
    contentTypeKeys: synonymMap(r.contentTypeKeys, "contentTypeKeys"),
    priorityKeys: synonymMap(r.priorityKeys, "priorityKeys"),
    skipRowValues: asStringArray(r.skipRowValues, "skipRowValues"),
    keyStrategy,
    defaultScheduleStatus: String(r.defaultScheduleStatus ?? "awaiting_schedule"),
    defaultStatus: String(r.defaultStatus ?? "draft"),
  };
}

/**
 * headerKey(synonym) → canonical field name, as an ARRAY of pairs in
 * declaration order (first declaration wins). An array, not a Map, because the
 * repo compiles to ES5 where iterating a Map needs downlevelIteration.
 */
export function synonymPairs(profile: ImportProfile): { key: string; field: string }[] {
  const pairs: { key: string; field: string }[] = [];
  const seen: Record<string, boolean> = {};
  const add = (k: string, field: string): void => {
    if (!k || seen[k]) return;
    seen[k] = true;
    pairs.push({ key: k, field });
  };
  for (const entry of Object.entries(profile.fields)) {
    const field = entry[0];
    for (const syn of entry[1].synonyms) add(headerKey(syn), field);
    add(headerKey(field), field);
  }
  return pairs;
}

/** Same index as a Map, for O(1) exact lookups. */
export function synonymIndex(profile: ImportProfile): Map<string, string> {
  const idx = new Map<string, string>();
  synonymPairs(profile).forEach((p) => idx.set(p.key, p.field));
  return idx;
}

/**
 * Collapse free content-type text onto the deliverables.type CHECK domain.
 * The original wording is preserved separately (content_type_raw) — this is a
 * storage constraint, not an editorial decision.
 */
export function canonicalType(raw: string, profile: ImportProfile): { type: "video" | "photo" | "other"; matched: boolean } {
  const k = headerKey(raw);
  if (!k) return { type: "other", matched: false };
  for (const bucket of ["video", "photo", "other"] as const) {
    for (const syn of profile.typeMap[bucket]) {
      const s = headerKey(syn);
      if (!s) continue;
      if (k === s || k.split(" ").includes(s) || (s.length >= 4 && k.includes(s))) return { type: bucket, matched: true };
    }
  }
  return { type: "other", matched: false };
}
