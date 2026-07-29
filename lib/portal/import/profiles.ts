// ════════════════════════════════════════════════════════════════════════════
// lib/portal/import/profiles.ts — the profile REGISTRY.
//
// The engine ships exactly ONE built-in profile: the generic one, whose synonym
// lists already cover the ordinary Arabic/English column names. Every other
// mapping profile is DATA that arrives at runtime — discovered from the profile
// directory by the server, or handed in by the caller as a plain object.
//
// WHY NOT `import someProfile from ".../someClient.json"`:
//   naming a specific client's file inside platform code makes that client part
//   of the platform. A profile id is data; it must never be a symbol in lib/.
//   The consequence is a hard rule that this file keeps: NOTHING here knows the
//   name of any project, client or sheet.
// ════════════════════════════════════════════════════════════════════════════
import type { ImportProfile } from "./types";
import { DEFAULT_PROFILE, ImportProfileError, normalizeProfile } from "./profile";

const REGISTRY = new Map<string, ImportProfile>();
/** Registration order, kept as an array (ES5 target ⇒ no Map iteration). */
const ORDER: ImportProfile[] = [];

function put(p: ImportProfile): void {
  if (!REGISTRY.has(p.id)) ORDER.push(p);
  else ORDER[ORDER.findIndex((x) => x.id === p.id)] = p;
  REGISTRY.set(p.id, p);
}
put(DEFAULT_PROFILE);

/**
 * Validate and register a profile that arrived as JSON data. Re-registering the
 * same id replaces it (a redeploy or an edited file wins). Throws an Arabic
 * error when the data is malformed — a bad profile must never load silently.
 */
export function registerProfile(raw: unknown): ImportProfile {
  const p = normalizeProfile(raw);
  put(p);
  return p;
}

export interface ProfileSummary {
  id: string;
  label: string;
  description: string | null;
  version: number;
  levels: { key: string; label: string }[];
  keyStrategy: string;
  builtIn: boolean;
}

export function listProfiles(): ProfileSummary[] {
  return ORDER.map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description ?? null,
    version: p.version,
    levels: p.levels.map((l) => ({ key: l.key, label: l.label })),
    keyStrategy: p.keyStrategy,
    builtIn: p.id === DEFAULT_PROFILE.id,
  }));
}

export function hasProfile(id: string): boolean {
  return REGISTRY.has(id);
}

/** Look up a registered profile, or throw an Arabic error naming the choices. */
export function getProfile(id: string | null | undefined): ImportProfile {
  const key = (id ?? "").trim() || DEFAULT_PROFILE.id;
  const p = REGISTRY.get(key);
  if (!p) {
    throw new ImportProfileError(`ملف التعيين «${key}» غير معروف. الملفات المتاحة: ${ORDER.map((x) => x.id).join(" / ")}.`);
  }
  return p;
}

/**
 * Accept a caller-supplied profile object (the UI can post the JSON it holds)
 * or the id of a registered one.
 */
export function resolveProfile(input: unknown): ImportProfile {
  if (input && typeof input === "object") return normalizeProfile(input);
  return getProfile(typeof input === "string" ? input : null);
}
