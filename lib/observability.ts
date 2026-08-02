// ════════════════════════════════════════════════════════════════════════════
// lib/observability.ts — error capture façade.
//
// Wave 0 · V2-0.5-A  (MASTER_BRIEF_v2.1.md §4 WAVE 0)
//
// ★ HONEST SCOPE — read this before assuming Sentry is live ★
// ────────────────────────────────────────────────────────────
// v2.1 V2-0.5-A asks for `@sentry/nextjs`, active only when SENTRY_DSN is set.
// That package is NOT installed in this repo, and Wave 0 did not install it:
//
//   • G12 (dependency budget) requires every new package to be justified in the
//     wave report, and `@sentry/nextjs` pulls a large tree that changes the
//     build output — not something to add in the same commit as a privacy fix.
//   • The install could not be verified end-to-end here (no network guarantee),
//     and shipping an unresolvable `import "@sentry/nextjs"` would break
//     `npm run build` for everyone — a hard fail against Definition of Done.
//
// So this file is the SEAM, not the vendor. It is dependency-free, it is a
// genuine no-op when SENTRY_DSN is absent, and it gives every call site a stable
// API so wiring the real transport later touches exactly ONE file.
//
// docs/OBSERVABILITY.md carries the exact install + config steps for Khaled.
// Until they are done, `isObservabilityConfigured()` returns false and this
// module claims nothing it cannot prove — the failure mode the whole repo is
// built around (see lib/portal/pgerror.ts).
//
// ★ REDACTION IS NOT OPTIONAL ★
// Everything here routes through pgRedact() from lib/portal/pgerror.ts, which
// strips JWTs, api keys, bearer tokens, passwords, e-mail addresses, UUIDs,
// long digit runs and WHOLE URLs (a PostgREST URL carries filter values, i.e.
// real customer data). G5 forbids a secret reaching any log or report, and an
// error tracker is a log that leaves the building — so the bar is higher, not
// lower. Never bypass captureError() with a raw console.error of an exception.
// ════════════════════════════════════════════════════════════════════════════

import { pgRedact } from "@/lib/portal/pgerror";

/** Severity, matching the vocabulary every transport understands. */
export type Severity = "fatal" | "error" | "warning" | "info";

/** Where the event came from and what was being attempted. Never row data. */
export interface CaptureContext {
  /** Component, route or job name, e.g. "api/public/intake". */
  where: string;
  /** What was being attempted, in plain words. */
  purpose?: string;
  /** Low-cardinality labels only. Values are redacted before they leave. */
  tags?: Record<string, string | number | boolean>;
}

/**
 * TRUE only when a transport is genuinely configured. Deliberately checks the
 * DSN rather than NODE_ENV: a preview deployment with a DSN should report, and
 * a production deployment without one must not pretend it does.
 */
export function isObservabilityConfigured(): boolean {
  return typeof process.env.SENTRY_DSN === "string" && process.env.SENTRY_DSN.trim().length > 0;
}

/** Redact a context bag. Keys survive; values are scrubbed. */
function safeTags(tags?: CaptureContext["tags"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tags) return out;
  for (const [k, v] of Object.entries(tags)) out[k] = pgRedact(String(v)).slice(0, 200);
  return out;
}

/** Normalise anything throwable into a redacted, bounded string. */
function safeMessage(err: unknown): string {
  const raw =
    err instanceof Error ? `${err.name}: ${err.message}`
    : typeof err === "string" ? err
    : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
  return pgRedact(raw).slice(0, 1_000);
}

/**
 * Record an error. Safe to call from anywhere, on server or client, configured
 * or not — it never throws, and it never blocks the caller's happy path.
 *
 * With no DSN it emits ONE structured, redacted line so failures are still
 * greppable in the Vercel log today. That is strictly better than the status quo
 * (nothing at all) and costs no dependency.
 */
export function captureError(err: unknown, ctx: CaptureContext, level: Severity = "error"): void {
  try {
    const event = {
      tag: "OBSERVE",
      level,
      where: ctx.where,
      purpose: ctx.purpose ?? "",
      message: safeMessage(err),
      tags: safeTags(ctx.tags),
      // Lets a log reader tell "no transport configured" apart from "transport
      // configured but the event never arrived" — two very different bugs.
      transport: isObservabilityConfigured() ? "configured" : "none",
    };
    // eslint-disable-next-line no-console
    (level === "warning" || level === "info" ? console.warn : console.error)(JSON.stringify(event));

    // ── WIRE THE REAL TRANSPORT HERE, AND ONLY HERE ──────────────────────────
    // After `npm i @sentry/nextjs` and the config files in docs/OBSERVABILITY.md:
    //   if (isObservabilityConfigured()) Sentry.captureException(err, { level, tags: safeTags(ctx.tags) });
    // Keep the redaction above — Sentry's own scrubbing is a different, weaker
    // allowlist and does not know about PostgREST URLs carrying filter values.
  } catch {
    /* An observability layer that can break the request it observes is a bug. */
  }
}

/** Breadcrumb-style note. Same guarantees; never throws. */
export function captureMessage(message: string, ctx: CaptureContext, level: Severity = "info"): void {
  captureError(message, ctx, level);
}
