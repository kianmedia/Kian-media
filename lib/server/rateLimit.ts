// ════════════════════════════════════════════════════════════════════════════
// lib/server/rateLimit.ts — the smallest useful abuse brake for PUBLIC endpoints.
//
// The in-memory sliding counter used by the admin diagnostics routes was copied inline in
// three places and existed nowhere for the PUBLIC surface, so /api/public/intake — an
// unauthenticated write endpoint — had no brake at all and could be hammered to fill the
// intake table with garbage.
//
// ⚠️ HONEST LIMITS. This is per-instance memory on a serverless platform:
//   • it does NOT survive a cold start, and each concurrent instance keeps its own map;
//   • a distributed attacker, or enough parallelism, will get through.
// It is a brake on casual abuse and accidental double-submits, NOT a security control.
// Real protection would need a shared store or an edge WAF rule — deliberately out of
// scope here, since this phase must not introduce a new service. Recorded as a residual
// risk rather than dressed up as a solution.
//
// Authorization is NEVER expressed through this module: every caller still does its own
// authentication and authorization. This only limits how OFTEN a caller may try.
// ════════════════════════════════════════════════════════════════════════════

interface Bucket { count: number; resetAt: number }

/** One map per module instance. Pruned opportunistically so it cannot grow without bound. */
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5_000;

function prune(now: number): void {
  if (buckets.size < MAX_KEYS) return;
  // Array.from rather than iterating the Map directly: this project's tsconfig target
  // predates downlevelIteration, and the newly-enforced build gate rejects that.
  for (const [k, v] of Array.from(buckets.entries())) {
    if (v.resetAt <= now) buckets.delete(k);
  }
  // Still oversized (a burst of distinct keys) → drop the oldest half rather than grow.
  if (buckets.size >= MAX_KEYS) {
    const keys = Array.from(buckets.keys());
    for (let i = 0; i < Math.floor(keys.length / 2); i++) buckets.delete(keys[i]);
  }
}

export interface RateVerdict {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Fixed-window counter. `key` should already include the endpoint name so different
 * endpoints never share a budget.
 */
export function rateLimit(key: string, limit: number, windowMs: number): RateVerdict {
  const now = Date.now();
  prune(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterMs: 0 };
  }
  if (b.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterMs: Math.max(0, b.resetAt - now) };
  }
  b.count++;
  return { allowed: true, remaining: limit - b.count, retryAfterMs: 0 };
}

/**
 * Best-effort client identifier for a public request. Behind Vercel the left-most
 * x-forwarded-for entry is the real client. Falls back to a constant so a request with no
 * usable header is still counted (shared budget) rather than escaping the limit entirely.
 */
export function clientKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const first = xff.split(",")[0]?.trim();
  return first || req.headers.get("x-real-ip") || "unknown";
}
