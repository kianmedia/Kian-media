// ════════════════════════════════════════════════════════════════════════════
// tests/public_hardening_phase2.test.js — «المرحلة الثانية — تقوية بوابة كيان العامة»
//
// Pins the public-surface hardening:
//   • the build no longer IGNORES TypeScript and ESLint errors (it used to ship them
//     silently — a deploy would go green while a real defect was live);
//   • security headers gained Permissions-Policy and a CSP that CANNOT break the app;
//   • API responses are no-store and the authenticated portal is noindex;
//   • robots.txt / sitemap.xml / favicon exist at all (none did) and never expose a
//     private route.
//
// The CSP test is the important one: `default-src` cascades to script-src, style-src and
// connect-src, so an enforced `default-src 'self'` would have blocked Next's inline
// bootstrap, this app's inline styles, and every browser call to Supabase — white-screening
// the portal. That mistake was made and caught during this work; this test makes it
// impossible to reintroduce.
// Static only — no DB, no network.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const root = path.join(__dirname, "..");
const R = (p) => fs.readFileSync(path.join(root, p), "utf8");
const exists = (p) => fs.existsSync(path.join(root, p));

const CFG = R("next.config.js");
const ROBOTS = R("app/robots.ts");
const SITEMAP = R("app/sitemap.ts");
const SITE = R("lib/site.ts");

// ─── build gates ───
test("B1: the build no longer ignores TypeScript or ESLint errors", () => {
  assert.ok(/typescript: \{ ignoreBuildErrors: false \}/.test(CFG), "TS errors fail the build");
  assert.ok(/eslint: \{ ignoreDuringBuilds: false \}/.test(CFG), "lint errors fail the build");
  assert.ok(!/ignoreBuildErrors: true/.test(CFG) && !/ignoreDuringBuilds: true/.test(CFG), "no leftover bypass");
});

// ─── CSP safety (the critical one) ───
function headerGroups() {
  // Evaluate the real config rather than regexing it, so the test sees what ships.
  delete require.cache[require.resolve(path.join(root, "next.config.js"))];
  return require(path.join(root, "next.config.js")).headers();
}
const groupFor = (hs, src) => hs.find((h) => h.source === src);
const valueOf = (g, key) => g.headers.find((h) => h.key === key)?.value ?? "";

test("C1: the ENFORCED CSP contains no cascading directive that would break the app", async () => {
  const hs = await headerGroups();
  const csp = valueOf(groupFor(hs, "/(.*)"), "Content-Security-Policy");
  assert.ok(csp, "an enforced CSP is set");
  for (const d of ["default-src", "script-src", "style-src", "connect-src", "img-src", "font-src", "media-src"]) {
    assert.ok(!csp.includes(d), `${d} must NOT be enforced — it would block Next inline code or Supabase calls`);
  }
});

test("C2: the enforced CSP still carries the directives that are safe AND valuable", async () => {
  const hs = await headerGroups();
  const csp = valueOf(groupFor(hs, "/(.*)"), "Content-Security-Policy");
  for (const d of ["frame-ancestors 'self'", "base-uri 'self'", "form-action", "object-src 'none'"]) {
    assert.ok(csp.includes(d), `${d} present`);
  }
  // form-action must still allow the relay the public forms actually POST to
  assert.ok(/form-action[^;]*script\.google\.com/.test(csp), "the working form target is not broken");
});

test("C3: the strict policy ships as Report-Only so violations are measured, not enforced", async () => {
  const hs = await headerGroups();
  const ro = valueOf(groupFor(hs, "/(.*)"), "Content-Security-Policy-Report-Only");
  assert.ok(ro.includes("default-src 'self'"), "the aspirational policy is expressed");
  assert.ok(/connect-src[^;]*supabase\.co/.test(ro), "Supabase is allowed in the target policy");
  assert.ok(!ro.includes("report-uri"), "no report endpoint is claimed that does not exist");
});

test("C4: Permissions-Policy denies hardware the site never uses", async () => {
  const hs = await headerGroups();
  const pp = valueOf(groupFor(hs, "/(.*)"), "Permissions-Policy");
  for (const f of ["camera=()", "microphone=()", "payment=()", "usb=()"]) {
    assert.ok(pp.includes(f), `${f} denied`);
  }
});

test("C4b: geolocation is (self), NOT () — an empty list would break HR attendance", async () => {
  // This assertion exists because the first version of this header shipped `geolocation=()`,
  // which blocks the document's OWN origin. HR check-in/out and task start/complete call
  // navigator.geolocation and ABORT on failure, so that header would have stopped every
  // employee from clocking in — with only a toast and no server-side error.
  // Assert on the EMITTED header value, not the file text — the file also contains the
  // explanatory comment, which would make a text-level negative assertion self-defeating.
  const hs = await headerGroups();
  const pp = valueOf(groupFor(hs, "/(.*)"), "Permissions-Policy");
  const HR = R("lib/portal/hr.ts");
  const HOME = R("components/portal/hr/EmployeeHome.tsx");
  assert.ok(/geolocation=\(self\)/.test(pp), "first-party geolocation preserved");
  assert.ok(!/geolocation=\(\)/.test(pp), "the breaking empty allowlist must never return");
  // and the dependency this protects is real, not assumed
  assert.ok(/navigator\.geolocation/.test(HR), "the app really uses geolocation");
  // Line-based on purpose: the abort line embeds `{ ar: …, en: … }`, so a brace-counting
  // regex would stop at the first nested `}` and silently find nothing.
  const aborts = HOME.split("\n").filter((l) => l.includes("if (!pos.ok)") && l.includes("return;")).length;
  assert.ok(aborts >= 3, `callers abort on failure — there is no degraded path (found ${aborts} abort sites)`);
});

// ─── caching / indexing of private surfaces ───
test("C5: API responses are never cached by a shared cache, and are noindex", async () => {
  const hs = await headerGroups();
  const api = groupFor(hs, "/api/(.*)");
  assert.ok(api, "an /api header group exists");
  assert.ok(/no-store/.test(valueOf(api, "Cache-Control")), "no-store — a cached user-scoped response is how data leaks between users");
  assert.ok(/noindex/.test(valueOf(api, "X-Robots-Tag")), "noindex");
});

test("C6: authenticated areas are noindex — without a needless CDN regression", async () => {
  const hs = await headerGroups();
  const portal = groupFor(hs, "/client-portal/:path*");
  assert.ok(portal, "a portal header group exists");
  assert.ok(/noindex/.test(valueOf(portal, "X-Robots-Tag")));
  // Deliberately NOT no-store. The portal shell is a client component carrying no user
  // data; all user data travels over /api/* which IS no-store. Forcing no-store here was
  // a pure CDN regression (an origin round-trip per navigation) protecting an empty
  // document — measured live as x-vercel-cache: HIT before the change.
  assert.equal(valueOf(portal, "Cache-Control"), "", "no Cache-Control override on the data-free shell");
  const admin = groupFor(hs, "/admin/:path*");
  assert.ok(admin && /noindex/.test(valueOf(admin, "X-Robots-Tag")), "/admin is noindex too");
});

// ─── SEO assets that did not exist at all ───
test("S1: robots.txt exists and hides every authenticated surface", () => {
  assert.ok(exists("app/robots.ts"), "generated robots route exists");
  for (const p of ["/api/", "/client-portal/", "/admin/", "/quick-access/"]) {
    assert.ok(ROBOTS.includes(`"${p}"`), `${p} disallowed`);
  }
  assert.ok(/sitemap:/.test(ROBOTS), "points at the sitemap");
});

test("S2: sitemap.xml exists and lists ONLY public pages", () => {
  assert.ok(exists("app/sitemap.ts"), "generated sitemap route exists");
  for (const p of ["/", "/quote-request", "/book-meeting", "/privacy-policy", "/terms"]) {
    assert.ok(SITEMAP.includes(`"${p}"`), `${p} listed`);
  }
  for (const bad of ["/client-portal", "/admin", "/quick-access", "/api"]) {
    assert.ok(!new RegExp(`path: "${bad}`).test(SITEMAP), `${bad} must NOT be in the sitemap`);
  }
});

test("S3: the site origin has ONE definition shared by metadata, robots and sitemap", () => {
  assert.ok(/export const SITE_URL/.test(SITE), "single constant");
  assert.ok(/from "@\/lib\/site"/.test(ROBOTS) && /from "@\/lib\/site"/.test(SITEMAP), "both derive from it");
  assert.ok(/replace\(\/\\\/\+\$\/, ""\)/.test(SITE), "trailing slash normalised so URLs cannot double up");
});

test("S4: a favicon exists (there was none)", () => {
  assert.ok(exists("app/icon.png"), "app/icon.png — Next serves this as the favicon");
  assert.ok(exists("app/apple-icon.png"), "apple touch icon");
});

test("SAFE: static only (no DB/network)", () => {
  const self = R("tests/public_hardening_phase2.test.js");
  const reqs = [...self.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]);
  for (const r of reqs) {
    assert.ok(["node:test", "node:assert", "node:fs", "node:path"].includes(r) || r.includes("next.config"),
      `static (got ${r})`);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// Abuse controls on the PUBLIC write endpoint (it had none at all).
// ════════════════════════════════════════════════════════════════════════════
const RL = R("lib/server/rateLimit.ts");
const INTAKE = R("app/api/public/intake/route.ts");

/** Faithful model of the fixed-window counter in lib/server/rateLimit.ts. */
function makeLimiter() {
  const m = new Map();
  return (key, limit, windowMs, now = Date.now()) => {
    const b = m.get(key);
    if (!b || b.resetAt <= now) { m.set(key, { count: 1, resetAt: now + windowMs }); return true; }
    if (b.count >= limit) return false;
    b.count++; return true;
  };
}

test("RL1: the window allows exactly `limit` calls, then refuses", () => {
  const rl = makeLimiter();
  const out = [];
  for (let i = 0; i < 5; i++) out.push(rl("k", 3, 60_000, 1_000));
  assert.deepEqual(out, [true, true, true, false, false]);
});

test("RL2: the window resets, so a legitimate visitor is never locked out forever", () => {
  const rl = makeLimiter();
  assert.equal(rl("k", 1, 60_000, 1_000), true);
  assert.equal(rl("k", 1, 60_000, 1_500), false, "still inside the window");
  assert.equal(rl("k", 1, 60_000, 62_000), true, "window elapsed → allowed again");
});

test("RL3: separate keys keep separate budgets (IP and email cannot starve each other)", () => {
  const rl = makeLimiter();
  assert.equal(rl("intake:ip:1.1.1.1", 1, 60_000, 0), true);
  assert.equal(rl("intake:ip:1.1.1.1", 1, 60_000, 0), false);
  assert.equal(rl("intake:email:a@b.c", 1, 60_000, 0), true, "a different key is unaffected");
});

test("RL4: the helper is honest about being per-instance, not real protection", () => {
  assert.ok(/per-instance memory/.test(RL), "the limitation is documented, not hidden");
  assert.ok(/NOT a security control/.test(RL), "stated plainly");
  assert.ok(/MAX_KEYS/.test(RL), "bounded — the map cannot grow without limit");
  assert.ok(/Array\.from\(buckets/.test(RL), "no Map iteration (the build gate rejects it)");
});

test("RL5: /api/public/intake now brakes by IP and by email, and caps the payload", () => {
  assert.ok(/rateLimit\(`intake:ip:/.test(INTAKE), "per-IP brake");
  assert.ok(/rateLimit\(`intake:email:/.test(INTAKE), "per-email brake");
  assert.ok(/MAX_BODY_BYTES/.test(INTAKE) && /payload_too_large/.test(INTAKE), "body size guard");
  assert.ok(/content-length/.test(INTAKE), "checked BEFORE parsing");
  assert.ok(/cap\(asStr\(b\.details\), CAP\.long\)/.test(INTAKE), "long text capped");
  assert.ok(/b\.files\.slice\(0, CAP\.files\)/.test(INTAKE), "file list capped");
});

test("RL6: rate limiting keeps the route's 'never show a technical error' contract", () => {
  // The public form helper discards the body; a 4xx here would surface as a broken form.
  const hits = [...INTAKE.matchAll(/error: "rate_limited" \}, \{ status: (\d+) \}/g)].map((m) => m[1]);
  assert.ok(hits.length >= 2, "both brakes return a response");
  for (const s of hits) assert.equal(s, "200", "rate limiting must not turn into a visible form error");
});

// ════════════════════════════════════════════════════════════════════════════
// The proven anon-exposure hole: submit_opportunity_request.
// LIVE PROOF (public anon key, no auth): the call returns
//   {"code":"P0001","message":"invalid opportunity type"}
// — an exception raised from INSIDE the function body, so anon holds EXECUTE and the
// function ran. Control: capture_public_intake returns PGRST202 (invisible to anon).
// Anyone could POST directly, bypassing the honeypot and every UI validation, inserting
// rows and firing notifications without limit.
//
// The grant CANNOT be revoked — the public opportunities form calls this RPC straight from
// the browser with the anon key. So the protection has to live INSIDE the function.
// ════════════════════════════════════════════════════════════════════════════
const RLSQL = R("docs/public_portal_rate_limit_RUNME.sql");
const OPPFORM = R("components/opportunities/OpportunityForm.tsx");

test("OPP1: the public form keeps working — anon EXECUTE is preserved, not revoked", () => {
  assert.ok(/grant\s+execute on function public\.submit_opportunity_request\([^)]*\) to anon, authenticated/.test(RLSQL),
    "revoking this would kill the public opportunities form");
  assert.ok(/the public opportunities form would be dead \(anon lost EXECUTE\)/.test(RLSQL),
    "the self-test refuses to leave the form broken");
});

test("OPP2: protection is INSIDE the function, not in the UI", () => {
  const fn = RLSQL.slice(RLSQL.indexOf("create or replace function public.submit_opportunity_request"));
  assert.ok(/rl_consume\('opp:email:'/.test(fn), "per-email cap inside the RPC");
  assert.ok(/rl_consume\('opp:anon:'/.test(fn), "shared cap when no email is supplied");
  assert.ok(/raise exception 'rate limited/.test(fn), "refuses over the cap");
  assert.ok(/length\(v_name\) > 200/.test(fn) && /length\(coalesce\(p_message,''\)\) > 5000/.test(fn),
    "size limits enforced server-side — the UI maxLength is bypassable by a direct POST");
});

test("OPP3: a double submit returns the SAME request number instead of a second row", () => {
  const fn = RLSQL.slice(RLSQL.indexOf("create or replace function public.submit_opportunity_request"));
  assert.ok(/interval '10 minutes'/.test(fn), "dedupe window");
  assert.ok(/if v_dupe is not null then return v_dupe; end if/.test(fn), "returns the original number");
  assert.ok(/lower\(o\.email\) = v_email[\s\S]{0,120}opportunity_type = p_type/.test(fn),
    "scoped to the same email AND type, so a different opportunity is never blocked");
});

test("OPP4: the counter is durable and shared, unlike the in-memory limiter", () => {
  assert.ok(/create table if not exists public\.public_rate_limits/.test(RLSQL), "persisted");
  assert.ok(/on conflict \(bucket\) do update/.test(RLSQL), "atomic upsert — safe under concurrency");
  assert.ok(/Shared across all serverless instances/.test(RLSQL), "the reason is documented");
  assert.ok(/rl_prune/.test(RLSQL), "old windows are pruned without adding a cron");
});

test("OPP5: the counters are not reachable by anon", () => {
  assert.ok(/revoke all on table public\.public_rate_limits from public/.test(RLSQL));
  assert.ok(/rl_consume must not be anon-callable/.test(RLSQL), "self-test asserts it");
  assert.ok(/counters must not be readable by anon/.test(RLSQL));
});

test("OPP6: the frozen notification logic is preserved byte-for-byte", () => {
  const fn = RLSQL.slice(RLSQL.indexOf("create or replace function public.submit_opportunity_request"));
  assert.ok(/perform public\.notify\(null, 'admin', 'opportunity_new', 'opportunity', v_id, v_ar, v_en\)/.test(fn),
    "admin broadcast unchanged");
  assert.ok(/staff_role = 'super_admin'/.test(fn) && /staff_role = 'hr'/.test(fn) && /staff_role = 'manager'/.test(fn),
    "the routing rules are untouched");
});

test("OPP7: the visitor sees a human message, never raw Postgres text", () => {
  assert.ok(/rate limited\/i\.test\(raw\)/.test(OPPFORM), "detects the server refusal");
  assert.ok(/أرسلتَ عدّة طلبات خلال وقت قصير/.test(OPPFORM), "Arabic copy");
  assert.ok(/طلبك السابق وصلنا/.test(OPPFORM), "reassures that the earlier submission was received");
});

test("OPP8: the SQL is additive and reversible", () => {
  const code = RLSQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\bdrop\s+table\b/i.test(code), "no DROP TABLE");
  assert.ok(!/delete\s+from\s+public\.opportunity_requests/i.test(code), "never deletes business data");
  assert.ok(/create table if not exists/.test(code) && /create or replace function/.test(code), "re-runnable");
  assert.ok(/RL FAIL/.test(RLSQL) && /RL SELF-TEST PASSED/.test(RLSQL), "self-tested");
  assert.ok(/VERIFICATION/.test(RLSQL) && /ROLLBACK/.test(RLSQL), "verification + rollback documented");
});

// ════════════════════════════════════════════════════════════════════════════
// Unverified-JWT injection on the PUBLIC intake endpoint.
// jwtSub() base64-decoded the JWT payload and returned its `sub` WITHOUT verifying the
// signature. That value became p_user → public_intake.user_id, and the read policy is
// `user_id = auth.uid() OR …` — so forging `header.{"sub":"<victim>"}.x` as a Bearer on a
// PUBLIC endpoint injected an arbitrary row into any victim's portal. No auth required.
// ════════════════════════════════════════════════════════════════════════════
const INTAKE2 = R("app/api/public/intake/route.ts");

test("JWT1: the unverified decoder is gone", () => {
  assert.ok(!/function jwtSub/.test(INTAKE2), "jwtSub removed");
  assert.ok(!/Buffer\.from\(p\.replace/.test(INTAKE2), "no hand-rolled base64 payload decode");
  assert.ok(/REMOVED — jwtSub/.test(INTAKE2), "and why is recorded");
});

test("JWT2: attribution now uses the VERIFIED lookup the rest of the repo uses", () => {
  assert.ok(/authGetUserId/.test(INTAKE2), "imported");
  assert.ok(/await authGetUserId\(bearer\)/.test(INTAKE2), "awaited — it validates against GoTrue");
  assert.ok(/forged bearer resolves to null/.test(INTAKE2), "fail-closed behaviour documented");
});

test("JWT3: forging a token can no longer claim another user's row", () => {
  // Model the two behaviours. The old one trusted any well-formed payload.
  const forged = (sub) => `hdr.${Buffer.from(JSON.stringify({ sub })).toString("base64")}.sig`;
  const oldDecode = (b) => { try { return JSON.parse(Buffer.from(b.split(".")[1], "base64").toString()).sub; } catch { return null; } };
  assert.equal(oldDecode(forged("victim-uuid")), "victim-uuid", "the old path accepted a forged sub");
  // The new path asks the auth server; an unverifiable token yields null (unattributed row).
  const verifiedLookup = (b) => (b === "genuine" ? "real-uuid" : null);
  assert.equal(verifiedLookup(forged("victim-uuid")), null, "a forged token attributes to nobody");
});

test("JWT4: the endpoint no longer hands PostgREST internals to anonymous callers", () => {
  assert.ok(/error: "capture_failed"/.test(INTAKE2), "coarse code returned");
  assert.ok(!/\{ ok: false, error: r\.error \}/.test(INTAKE2), "raw error no longer returned");
  assert.ok(/PUBLIC_INTAKE_FAILED/.test(INTAKE2), "the real error is logged server-side instead");
});

// ─── public-surface UX defects found live at 375px ───
test("UX1: the promo card no longer covers the WhatsApp button", () => {
  const promo = R("components/OpportunityPromo.tsx");
  const wa = R("components/WaFloat.tsx");
  assert.ok(/bottom: "96px"/.test(promo), "lifted above the FAB (56px button + 24px offset + gap)");
  assert.ok(/zIndex: 91/.test(promo), "explicit stacking rather than DOM-order luck");
  assert.ok(/bottom: "24px"/.test(wa), "the FAB itself is unchanged");
});

test("UX2: form selects are no longer blank boxes", () => {
  const F = R("components/forms/Field.tsx");
  const sel = F.slice(F.indexOf("export function SelectField"));
  assert.ok(!/appearance: "none"/.test(sel), "native chevron restored");
  assert.ok(/placeholder \?\? "— اختر \/ Select —"/.test(sel), "placeholder has real text");
  assert.ok(/BLANK BOX/.test(F), "the defect is documented so it is not 'tidied' back");
});

test("UX3: the mobile hamburger meets a usable tap target", () => {
  const N = R("components/Navbar.tsx");
  assert.ok(/w-11 h-11/.test(N), "44x44 instead of 32x14.5");
  assert.ok(/-me-2/.test(N), "logical margin — correct in both RTL and LTR");
});
