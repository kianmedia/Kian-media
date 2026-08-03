// ════════════════════════════════════════════════════════════════════════════
// lib/attribution.ts — where an enquiry came from.
//
// Wave 1 · V2-1.6-C  (MASTER_BRIEF_v2.1.md §4 WAVE 1)
//
// ★ WHAT THIS SOLVES ★
// Every public form sent a single free-text `source` string ("quote-request",
// "book-meeting", …). That says which FORM was used, not where the visitor came
// from — so there was no way to tell an enquiry driven by a campaign from one
// that arrived by typing the domain. Four forms, four hand-written strings, no
// shared shape.
//
// This reads the standard UTM parameters plus the referrer, once, in the browser.
//
// ★ SCOPE — deliberately small ★
// • Read-only. It sets no cookie and writes to no storage: a first-party
//   attribution cookie is a privacy decision that belongs with the consent work,
//   not a helper. So attribution survives only within the page the visitor
//   landed on, which is the honest limit and is documented as such.
// • It captures NO personal data — campaign labels and an origin, nothing that
//   identifies a person.
// • Values are truncated: these end up in a database column, and an unbounded
//   query string is an easy way to push junk into it.
//
// ⚠️ The columns these map to DO NOT EXIST YET. docs/lead_attribution_utm_
// EXTENSION_RUNME.sql adds them and is UNAPPLIED, so the API drops the extra
// keys today. That is intentional and safe: the enquiry still lands, and no
// attribution is silently invented. RELEASE VERIFICATION PENDING.
// ════════════════════════════════════════════════════════════════════════════

/** Trimmed to what a database column should ever accept from a query string. */
const CAP = 200;

const clean = (v: string | null): string | undefined => {
  const s = (v ?? "").trim();
  if (!s) return undefined;
  return s.length > CAP ? s.slice(0, CAP) : s;
};

export interface Attribution {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
  /** Origin only — never the full referring URL, which can carry a query. */
  referrer?: string;
  /** The page the form was submitted from. Path only, no query, no hash. */
  landing_path?: string;
}

/**
 * Read attribution from the current URL. Safe on the server (returns {}), safe
 * with a malformed URL, and never throws — a broken query string must not be
 * able to stop a form submitting.
 */
export function captureAttribution(): Attribution {
  if (typeof window === "undefined") return {};
  try {
    const q = new URLSearchParams(window.location.search);
    const out: Attribution = {
      utm_source: clean(q.get("utm_source")),
      utm_medium: clean(q.get("utm_medium")),
      utm_campaign: clean(q.get("utm_campaign")),
      utm_term: clean(q.get("utm_term")),
      utm_content: clean(q.get("utm_content")),
      landing_path: clean(window.location.pathname),
    };

    // Origin only. A full referrer URL can contain another site's query string,
    // which may carry their user's data — not ours to store.
    const ref = document.referrer;
    if (ref) {
      try {
        const u = new URL(ref);
        // Self-referrals are noise: they record internal navigation, not a source.
        if (u.origin !== window.location.origin) out.referrer = clean(u.origin);
      } catch { /* unparseable referrer — skip it rather than store junk */ }
    }

    // Drop undefined keys so the payload carries only what was actually present.
    return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Attribution;
  } catch {
    return {};
  }
}

/** True when anything was actually captured — useful for tests and reporting. */
export const hasAttribution = (a: Attribution): boolean => Object.keys(a).length > 0;
