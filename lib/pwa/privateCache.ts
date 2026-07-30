// ════════════════════════════════════════════════════════════════════════════
// Cache lifecycle tied to IDENTITY, not to the tab.
//
// THE FAILURE THIS PREVENTS
//   A shared laptop. Employee A signs out, employee B signs in. Anything the
//   worker stored under A's session is still on disk and still served by URL —
//   the cache has no idea a different human is now looking at the screen. So
//   identity changes must destroy storage, and they must do it in BOTH
//   directions: on sign-out and on the switch itself (a switch can happen with
//   no sign-out at all, e.g. a session restored from a different account).
//
// V1 caches nothing user-scoped by construction (see lib/pwa/config.ts), so
// this is defence in depth rather than the only line.
//
// This is a full purge on purpose: proving "this entry is not private" for
// every entry is harder, and gets harder every release, than dropping
// everything and letting the network re-warm three static files.
//
// Everything here is best-effort and NEVER throws. A cache that refuses to
// clear must not be able to block a sign-out.
// ════════════════════════════════════════════════════════════════════════════
import { CACHE_PREFIX, MSG } from "./config";

/** localStorage key holding the last identity this browser rendered. */
export const LAST_USER_KEY = "kian_pwa_last_user";

export type PurgeResult = {
  ok: boolean;
  /** Cache names actually deleted (empty is a valid, healthy answer). */
  cleared: string[];
  /** Distinct, honest reason when nothing could be done — never a silent false. */
  reason?: "unsupported" | "no_window" | "error";
};

function hasCacheApi(): boolean {
  return typeof window !== "undefined" && typeof caches !== "undefined";
}

/**
 * Destroy every cache this app owns.
 *
 * Deletes from the PAGE as well as asking the worker, because the two can
 * disagree: on a first load the worker is installed but not yet controlling, so
 * postMessage reaches nobody — while `caches` in the page still sees the same
 * storage. Doing both makes the purge independent of controller state.
 */
export async function clearPrivateCaches(): Promise<PurgeResult> {
  if (typeof window === "undefined") return { ok: false, cleared: [], reason: "no_window" };
  if (!hasCacheApi()) return { ok: false, cleared: [], reason: "unsupported" };

  const cleared: string[] = [];
  try {
    const names = await caches.keys();
    for (const name of names) {
      if (!name.startsWith(CACHE_PREFIX)) continue;
      const gone = await caches.delete(name);
      if (gone) cleared.push(name);
    }
  } catch {
    return { ok: false, cleared, reason: "error" };
  }

  // Belt and braces: the worker purges its own view too.
  try {
    const ctrl = navigator.serviceWorker?.controller;
    if (ctrl) ctrl.postMessage({ type: MSG.PURGE_ALL });
  } catch {
    /* controller absent or messaging blocked — the page-side delete already ran */
  }

  return { ok: true, cleared };
}

/**
 * Record who is signed in, and purge if it is not who it was.
 *
 * Call as early as possible in the authenticated bootstrap — before any account
 * data is fetched or rendered — so a switch can never be observed with the
 * previous identity's storage still live.
 *
 * @returns whether a switch was detected (and therefore a purge performed).
 */
export async function noteActiveUser(userId: string | null): Promise<{ switched: boolean }> {
  if (typeof window === "undefined") return { switched: false };
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(LAST_USER_KEY);
  } catch {
    previous = null;
  }

  const next = userId && userId.length > 0 ? userId : null;
  const switched = previous !== null && next !== null && previous !== next;

  if (switched) {
    await clearPrivateCaches();
  }

  try {
    if (next) localStorage.setItem(LAST_USER_KEY, next);
  } catch {
    /* private mode / quota — identity tracking degrades, nothing breaks */
  }

  return { switched };
}

/**
 * Sign-out hook: forget the identity AND destroy storage.
 *
 * The key is removed so the NEXT sign-in cannot be compared against a stale
 * identity, and so a purge is not skipped just because the same person came
 * back.
 */
export async function onSignOutClearCaches(): Promise<PurgeResult> {
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    /* ignore */
  }
  return clearPrivateCaches();
}
