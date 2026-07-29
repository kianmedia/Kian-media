// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/keys.ts — DETERMINISTIC identity. No UUIDs, no Date.now(),
// no counters that depend on when the import ran.
//
// KEY SHAPE (4 colon-separated segments, exactly as specified):
//     <profile>:<project-key>:<level-path>:<row-key>
// e.g.  content-plan:kian-2026-social:الاطلاق/اليوم-الاول:i-9f3c2a71b0d4
//
// WHY THE ROW-KEY IS *IDENTITY*, NOT *CONTENT*, BY DEFAULT
//   A key built from the whole row's content changes the moment anyone edits a
//   caption — the re-import would then create a second row instead of updating
//   the first. So the row key is derived from IDENTITY fields only (level path +
//   title + the ordinal of repeated identical titles). Content changes are
//   detected separately by `content_hash`, which is what makes "re-import after
//   editing one row updates exactly that row" true.
//   Profiles that carry a real reference column use keyStrategy "external_key";
//   profiles over positional sheets can use "row".
// ════════════════════════════════════════════════════════════════════════════
import type { ImportProfile, KeyStrategy, MappedDeliverable } from "./types";
import { normalizeForMatch, slugify } from "./text";
import { shortHash } from "./sha256";

export const KEY_SEPARATOR = ":";
export const LEVEL_SEPARATOR = "/";
const ROOT = "root";

/** Stable JSON: object keys sorted, so hashing is order-independent. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/**
 * Slug that stays readable AND unique: long Arabic titles are truncated, then a
 * short hash of the FULL text is appended so two long titles sharing a prefix
 * never collapse onto one key.
 */
export function stableSlug(text: string, maxLen: number = 40): string {
  const norm = normalizeForMatch(text);
  if (norm === "") return "";
  const slug = slugify(text, maxLen);
  const full = slugify(text, 10_000);
  if (slug === full && slug !== "") return slug;
  return `${slug}~${shortHash(norm, 6)}`;
}

/** The level-path segment of a key. Empty levels collapse to "root". */
export function levelPathKey(levelKeys: (string | null)[]): string {
  const parts = levelKeys.filter((k): k is string => !!k && k !== "");
  return parts.length === 0 ? ROOT : parts.join(LEVEL_SEPARATOR);
}

/** Key for a hierarchy node (stage, sub-group, …). */
export function nodeKey(profileId: string, projectKey: string, levelKeys: (string | null)[]): string {
  return [profileId, projectKey, levelPathKey(levelKeys), "#node"].join(KEY_SEPARATOR);
}

/** Key for the parent project a file declares. */
export function parentProjectKey(profileId: string, projectKey: string): string {
  return [profileId, projectKey, ROOT, "#project"].join(KEY_SEPARATOR);
}

export interface RowKeyInput {
  strategy: KeyStrategy;
  /** Value of the mapped external_key column, when the profile has one. */
  explicit?: string | null;
  levelKeys: (string | null)[];
  title: string;
  /** 1-based ordinal among rows with the same identity (handles honest repeats). */
  occurrence: number;
  rowNumber: number;
}

/** The 4th key segment. Identical inputs ⇒ identical output, forever. */
export function rowKey(input: RowKeyInput): { key: string; strategyUsed: KeyStrategy } {
  if (input.strategy === "external_key") {
    const explicit = (input.explicit ?? "").trim();
    if (explicit !== "") return { key: `k-${stableSlug(explicit, 40)}`, strategyUsed: "external_key" };
    // Fall through to identity — a blank reference must NOT become a random id.
  }
  if (input.strategy === "row") return { key: `r${input.rowNumber}`, strategyUsed: "row" };
  const identity = canonicalJson({
    l: input.levelKeys.map((k) => k ?? ""),
    t: normalizeForMatch(input.title),
    n: input.occurrence,
  });
  return { key: `i-${shortHash(identity, 12)}`, strategyUsed: "identity" };
}

export interface ExternalKeyInput {
  profileId: string;
  projectKey: string;
  levelKeys: (string | null)[];
  row: RowKeyInput;
}

export function externalKey(input: ExternalKeyInput): { key: string; strategyUsed: KeyStrategy } {
  const rk = rowKey(input.row);
  return {
    key: [input.profileId, input.projectKey, levelPathKey(input.levelKeys), rk.key].join(KEY_SEPARATOR),
    strategyUsed: rk.strategyUsed,
  };
}

/**
 * Fingerprint of everything the import WRITES for one row. Used only to decide
 * create / update / unchanged — never to build the key.
 */
export function contentHash(d: Omit<MappedDeliverable, "content_hash" | "external_key" | "source_row_number">): string {
  return shortHash(
    canonicalJson({
      title: d.title,
      type: d.type,
      content_type_raw: d.content_type_raw ?? "",
      platforms: [...d.platforms],
      execution_details: d.execution_details ?? "",
      proposed_caption: d.proposed_caption ?? "",
      notes: d.notes ?? "",
      assignee_hint: d.assignee_hint ?? "",
      priority: d.priority ?? "",
      quantity: d.quantity ?? null,
      due_date: d.due_date ?? null,
      schedule_status: d.schedule_status,
      status: d.status,
      level_path: d.level_path.map((v) => v ?? ""),
      extra: d.extra,
    }),
    16,
  );
}

/** A project key the operator did not supply: derived from the project title. */
export function deriveProjectKey(title: string, profile: ImportProfile): string {
  const s = stableSlug(title, 40);
  return s === "" ? `${profile.id}-project` : s;
}
