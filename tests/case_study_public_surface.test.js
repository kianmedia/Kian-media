// ════════════════════════════════════════════════════════════════════════════
// tests/case_study_public_surface.test.js — CASE STUDIES · THE PUBLIC PAGES
//
// The rule the brief repeats: the public site must work with the SQL UNAPPLIED.
// Hide the section or show a safe "coming soon" — never crash, never fake data,
// never a misleading zero, and never break the existing portfolio.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");

const RUNME = R("docs/case_studies_platform_RUNME.sql");
const SERVER = R("lib/server/publicCaseStudies.ts");
const API = R("app/api/public/case-studies/route.ts");
const INDEX_PAGE = R("app/case-studies/page.tsx");
const DETAIL_PAGE = R("app/case-studies/[slug]/page.tsx");
const TEASER = R("components/CaseStudiesTeaser.tsx");
const INDEX_CLIENT = R("components/CaseStudiesIndexClient.tsx");
const DETAIL_CLIENT = R("components/CaseStudyDetailClient.tsx");
const SITEMAP = R("app/sitemap.ts");
const HOME = R("app/page.tsx");
const PORTFOLIO = R("components/Portfolio.tsx");

test("the server read layer degrades to 'not enabled', never to 'zero results'", () => {
  assert.ok(/const EMPTY_INDEX[\s\S]{0,200}enabled: false/.test(SERVER));
  assert.ok(/if \(!res\.ok\) return null;/.test(SERVER), "an unapplied migration (404/PGRST202) returns null");
  assert.ok(/catch \{\s*\n\s*return null;/.test(SERVER), "a network failure returns null, not an exception");
  assert.ok(/data\.enabled !== true\) return EMPTY_INDEX/.test(SERVER),
    "the caller can never mistake 'off' for 'no work'");
});

test("the public read layer uses the anon key only and never throws", () => {
  assert.ok(!/service_role|SERVICE_ROLE|SUPABASE_SERVICE/.test(SERVER));
  assert.ok(/apikey: ANON_KEY/.test(SERVER));
  assert.ok(/if \(!SUPABASE_URL \|\| !ANON_KEY\) return null;/.test(SERVER), "missing env is handled, not thrown");
});

test("the index page shows an honest coming-soon and refuses to be indexed while empty", () => {
  assert.ok(/function ComingSoon/.test(INDEX_PAGE));
  assert.ok(/robots: live \? \{ index: true, follow: true \} : \{ index: false, follow: true \}/.test(INDEX_PAGE),
    "an empty page is noindex");
  assert.ok(/data\.enabled && data\.items\.length > 0/.test(INDEX_PAGE), "'live' means enabled AND has content");
  // No invented counters or placeholder cards.
  assert.ok(!/\b(٤٠٠٠|4000|2000|20\+)\b/.test(INDEX_PAGE), "no hardcoded statistics on the case-study page");
});

test("a non-public slug is a 404, not an 'unavailable' page that confirms it exists", () => {
  assert.ok(/notFound\(\)/.test(DETAIL_PAGE));
  assert.ok(/robots: \{ index: false, follow: false \}/.test(DETAIL_PAGE), "the not-found metadata is noindex");
  assert.ok(/dynamicParams = true/.test(DETAIL_PAGE), "publication is a decision that changes; no stale prerender list");
});

test("the homepage teaser renders NOTHING when the feature is off or empty", () => {
  assert.ok(/if \(items === null \|\| items\.length === 0\) return null;/.test(TEASER));
  assert.ok(/j\?\.enabled === true && Array\.isArray\(j\.items\)/.test(TEASER));
  assert.ok(/catch \{[\s\S]{0,60}setItems\(\[\]\)/.test(TEASER), "a failed fetch hides the section");
  // Comments may discuss the rule; the rendered code must not contain the banner.
  const teaserCode = TEASER.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert.ok(!/قريبًا/.test(teaserCode), "no 'coming soon' banner over an empty homepage section");
});

test("the existing portfolio grid is untouched and still rendered", () => {
  assert.ok(/ITEMS/.test(PORTFOLIO), "the hardcoded works grid still exists");
  assert.ok(/<Portfolio/.test(HOME), "the homepage still renders it");
  assert.ok(/CaseStudiesTeaser/.test(HOME), "the case-study section is additive");
  const teaserIdx = HOME.indexOf("<CaseStudiesTeaser");
  const portfolioIdx = HOME.indexOf("<Portfolio");
  assert.ok(teaserIdx > -1 && portfolioIdx > -1 && teaserIdx !== portfolioIdx,
    "two separate sections; the teaser does not replace the portfolio");
});

test("the public API route is read-only, rate limited and fails to 'hidden'", () => {
  assert.ok(/export async function GET/.test(API));
  assert.ok(!/export async function (POST|PUT|PATCH|DELETE)/.test(API), "no write method exists");
  assert.ok(/rateLimit\(/.test(API));
  assert.ok(/const OFF = \{ enabled: false/.test(API));
  assert.ok(/status: 200/.test(API), "a limited visitor gets a hidden section, not a technical error");
  assert.ok(/SLUG = \/\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$\//.test(API), "filters are shape-constrained");
  assert.ok(!/service_role/.test(API));
});

test("the sitemap adds only published slugs and degrades to the static list", () => {
  assert.ok(/publicCaseStudySlugs/.test(SITEMAP));
  assert.ok(/if \(studies\.length === 0\) return base;/.test(SITEMAP), "nothing published ⇒ the original list");
  assert.ok(/Number\.isNaN\(d\.getTime\(\)\)/.test(SITEMAP), "a malformed date cannot throw during generation");
  const slugFn = RUNME.slice(RUNME.indexOf("create or replace function public.cs_public_slugs("));
  assert.ok(/cs_is_public\(/.test(slugFn.slice(0, 1200)), "the RPC only emits publicly visible studies");
  assert.ok(!/storage|project_id/.test(slugFn.slice(0, 1200)), "and emits nothing but slug + updated_at");
});

test("the public RPCs gate on the owner's switch before anything else", () => {
  for (const fn of ["cs_public_index", "cs_public_study", "cs_public_slugs"]) {
    const body = RUNME.slice(RUNME.indexOf(`create or replace function public.${fn}(`));
    const head = body.slice(0, 1400);
    assert.ok(/public_enabled/.test(head), `${fn} checks the public switch`);
    assert.ok(/'enabled', false/.test(head), `${fn} returns enabled:false rather than an empty success`);
  }
  assert.ok(/public_enabled\s+boolean not null default false/.test(RUNME), "the switch is OFF by default");
});

test("the rendered pages carry bilingual SEO, canonical, OG and structured data", () => {
  assert.ok(/alternates: \{ canonical:/.test(INDEX_PAGE) && /alternates: \{ canonical:/.test(DETAIL_PAGE));
  assert.ok(/openGraph/.test(INDEX_PAGE) && /openGraph/.test(DETAIL_PAGE));
  assert.ok(/application\/ld\+json/.test(DETAIL_PAGE) || /application\/ld\+json/.test(DETAIL_CLIENT),
    "structured data is emitted on the detail page");
  assert.ok(/isAr|dir=/.test(INDEX_CLIENT), "the index is language/direction aware");
  assert.ok(/isAr|dir=/.test(DETAIL_CLIENT), "the detail page is language/direction aware");
});

test("filters and CTAs exist on the public index", () => {
  assert.ok(/sector/.test(INDEX_CLIENT) && /service/.test(INDEX_CLIENT), "sector and service filters");
  assert.ok(/featured/.test(INDEX_CLIENT), "featured filter");
  assert.ok(/quote-request/.test(INDEX_CLIENT) || /quote-request/.test(INDEX_PAGE), "quote CTA");
  assert.ok(/book-meeting/.test(DETAIL_CLIENT) || /book-meeting/.test(DETAIL_PAGE), "meeting CTA");
});

test("nothing internal appears in any public component", () => {
  for (const f of [TEASER, INDEX_CLIENT, DETAIL_CLIENT, INDEX_PAGE, DETAIL_PAGE, API, SERVER]) {
    assert.ok(!/project_id/.test(f), "no project reference reaches a public surface");
    assert.ok(!/internal_notes|source_note|permission_reference/.test(f), "no internal field is referenced");
    assert.ok(!/client-portal/.test(f), "no internal link leaks into public markup");
  }
});
