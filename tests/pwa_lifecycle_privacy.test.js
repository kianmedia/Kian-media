// ════════════════════════════════════════════════════════════════════════════
// tests/pwa_lifecycle_privacy.test.js
//
// Storage must follow IDENTITY, not the tab. The scenario is concrete: a shared
// laptop in the office, employee A signs out, employee B signs in. Any cache
// entry that survives that hand-over is one employee reading another's screen.
// Also covers mobile navigation and RTL, because a nav that disappears on a
// phone makes the installed app unusable for the people who install it.
// ════════════════════════════════════════════════════════════════════════════
const { test } = require("node:test");
const assert = require("node:assert");
const { R, loadServiceWorker } = require("./pwa_helpers");

const PRIVATE = R("lib/pwa/privateCache.ts");
const SHELL = R("components/portal/PortalShell.tsx");
const MNAV = R("components/portal/PortalMobileNav.tsx");
const CSS = R("app/globals.css");
const SW = R("public/sw.js");
const { ctx, listeners, sandbox } = loadServiceWorker();

// ─── LOGOUT CLEARS PRIVATE CACHES ───────────────────────────────────────────

test("sign-out clears every cache this app owns", () => {
  assert.ok(/export async function onSignOutClearCaches/.test(PRIVATE), "a named sign-out hook exists");
  assert.ok(/return clearPrivateCaches\(\)/.test(PRIVATE), "it purges");
  assert.ok(/localStorage\.removeItem\(LAST_USER_KEY\)/.test(PRIVATE),
    "and forgets the identity, so the next login is not compared against a stale one");
});

test("the purge deletes only this app's caches, and deletes ALL of them", () => {
  assert.ok(/name\.startsWith\(CACHE_PREFIX\)/.test(PRIVATE), "scoped to kian-pwa-* caches");
  assert.ok(/continue;/.test(PRIVATE), "a foreign cache is skipped, never deleted");
  assert.ok(/caches\.delete\(name\)/.test(PRIVATE), "and every matching cache is removed");
  // A selective purge would need per-entry proof of non-privacy — harder, and it
  // rots with every new route. The contract records the choice.
  assert.ok(/full purge/i.test(PRIVATE) || /FULL purge/.test(PRIVATE), "the full-purge choice is documented");
});

test("the purge runs from the PAGE as well as the worker — a non-controlling worker hears nothing", () => {
  assert.ok(/await caches\.keys\(\)/.test(PRIVATE), "the page deletes directly");
  assert.ok(/navigator\.serviceWorker\?\.controller/.test(PRIVATE), "and messages the worker when there is one");
  assert.ok(/MSG\.PURGE_ALL/.test(PRIVATE), "using the shared message name");
  assert.ok(/MSG_PURGE_ALL/.test(SW), "which the worker handles");
});

test("the worker's own purge really removes every kian-pwa cache", async () => {
  sandbox.caches._deleted.length = 0;
  const cleared = await ctx.purgeAllAppCaches();
  assert.ok(cleared.includes("kian-pwa-static-v0.9.0"), "old version purged");
  assert.ok(cleared.includes("kian-pwa-public-v1.0.0"), "CURRENT version purged too — this is a full purge");
  assert.ok(!cleared.includes("other-app-cache"), "another app's cache is untouched");
});

test("the purge never throws and reports a DISTINCT reason when it cannot run", () => {
  assert.ok(/reason\?: "unsupported" \| "no_window" \| "error"/.test(PRIVATE),
    "unsupported / no-window / error are separate answers, not one silent false");
  assert.ok(/catch \{/.test(PRIVATE), "every branch is guarded");
  assert.ok(!/throw /.test(PRIVATE), "and nothing is ever thrown — a stuck cache must not trap a sign-out");
});

test("PortalShell calls the sign-out purge, without letting it block the sign-out", () => {
  assert.ok(/onSignOutClearCaches/.test(SHELL), "the shell imports and calls it");
  const signOutBlock = SHELL.slice(SHELL.indexOf("const signOut = useCallback"), SHELL.indexOf("// The password-reset page"));
  assert.ok(/await logout\(\)/.test(signOutBlock), "the session is cleared first");
  assert.ok(/try \{ await onSignOutClearCaches\(\); \} catch/.test(signOutBlock), "then caches, best-effort");
  assert.ok(/setPhase\("auth"\)/.test(signOutBlock), "and the user is signed out regardless of the result");
});

// ★ REGRESSION (final cross-module audit) ★
// The portal has MORE THAN ONE sign-out button. PortalShell's was wired to the
// purge; the suspended-account screen's was not — it called logout() and
// reloaded, leaving the service-worker caches and the remembered identity
// behind on exactly the device most likely to change hands. Asserting only the
// shell let that second door stay open, so the rule is now stated as a rule:
// EVERY module that calls logout() must also call the purge.
test("every sign-out path purges caches — not just the main one", () => {
  const STATUS = R("components/portal/StatusScreens.tsx");
  assert.ok(/onSignOutClearCaches/.test(STATUS),
    "the suspended-account screen signs out too, so it must purge too");
  assert.ok(/await logout\(\)[\s\S]{0,200}onSignOutClearCaches/.test(STATUS),
    "session first, then caches — the same order as the shell");
  assert.ok(/try \{ await onSignOutClearCaches\(\); \} catch/.test(STATUS),
    "best-effort: a stuck cache must never trap a suspended user in a session");

  // The general rule, enforced across the whole portal rather than file by file.
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "components", "portal");
  const offenders = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".tsx")) continue;
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    // A file that IMPORTS logout from the auth module owns a sign-out path.
    if (!/import \{[^}]*\blogout\b[^}]*\} from "@\/lib\/portal\/auth"/.test(src)) continue;
    if (!/onSignOutClearCaches/.test(src)) offenders.push(f);
  }
  assert.deepEqual(offenders, [],
    `these components sign out without purging the private caches: ${offenders.join(", ")}`);
});

// ─── USER SWITCH CLEARS CACHES ──────────────────────────────────────────────

test("a user switch purges caches BEFORE any account data is fetched", () => {
  assert.ok(/export async function noteActiveUser/.test(PRIVATE), "a named switch detector exists");
  assert.ok(/previous !== null && next !== null && previous !== next/.test(PRIVATE),
    "a switch is a change between two known identities");
  assert.ok(/if \(switched\) \{\s*await clearPrivateCaches\(\);/.test(PRIVATE), "and it purges");

  const boot = SHELL.slice(SHELL.indexOf("const bootstrap = useCallback"), SHELL.indexOf("const r = await getMyProfile()"));
  assert.ok(/noteActiveUser\(session\.user_id\)/.test(boot),
    "the shell records the identity from the SESSION (authoritative), not from a profile row");
  assert.ok(boot.indexOf("noteActiveUser") < boot.length,
    "and does so before the profile fetch — the first byte of account data must not precede the purge");
});

test("the switch check is keyed on the auth user id and survives a failed write", () => {
  assert.ok(/LAST_USER_KEY = "kian_pwa_last_user"/.test(PRIVATE), "a dedicated key, not shared with the session");
  assert.ok(/catch \{\s*previous = null;/.test(PRIVATE), "an unreadable store degrades to 'unknown', not to 'same user'");
  assert.ok(/localStorage\.setItem\(LAST_USER_KEY, next\)/.test(PRIVATE), "the new identity is remembered");
});

test("the same user signing back in is not treated as a switch (no pointless purge)", () => {
  // previous === next ⇒ switched === false. Pinned so the condition is not
  // 'simplified' into previous !== next, which would purge on every first login
  // (previous null) and hide real switch bugs behind constant purging.
  assert.ok(/previous !== null && next !== null/.test(PRIVATE),
    "a first-ever login (previous === null) is not a switch");
});

// ─── Mobile navigation + RTL ────────────────────────────────────────────────

test("a mobile navigation exists and is rendered by the portal shell", () => {
  assert.ok(/PortalMobileNav/.test(SHELL), "the shell mounts it");
  assert.ok(/tabs=\{tabs\}/.test(SHELL), "with the SAME entitled tab list the desktop strip uses");
  assert.ok(/onSignOut=\{\(\) => void signOut\(\)\}/.test(SHELL), "and a working sign-out");
});

test("the mobile nav computes no entitlement of its own", () => {
  for (const banned of ["tabsForViewer", "SETS", "account_type", "staff_role", "caps("]) {
    assert.ok(!MNAV.includes(banned),
      `PortalMobileNav must not derive visibility itself (${banned}) — that would be a second, drifting permission model`);
  }
  assert.ok(/tabs: PortalTab\[\]/.test(MNAV), "it renders the list it is given");
});

test("exactly one breakpoint decides which navigation is visible — a phone is never left with none", () => {
  assert.ok(/\.pt-mnav \{ display: none; \}/.test(CSS), "the mobile bar is hidden by default");
  assert.ok(/@media \(max-width: 767px\)/.test(CSS), "one breakpoint");
  const mq = CSS.slice(CSS.indexOf("@media (max-width: 767px)"), CSS.indexOf("@media (max-width: 767px)") + 400);
  assert.ok(/\.pt-tabbar \{ display: none !important; \}/.test(mq), "below it the desktop strip hides");
  assert.ok(/\.pt-mnav\s+\{ display: flex; \}/.test(mq), "and the mobile bar appears");
  assert.ok(/pt-tabbar/.test(SHELL) && /pt-shell-body/.test(SHELL), "the shell carries both hooks");
  assert.ok(/padding-bottom: calc\(74px \+ env\(safe-area-inset-bottom/.test(mq),
    "content is padded so the fixed bar never covers the last row");
});

test("every entitled tab stays reachable on a phone, including sign-out", () => {
  assert.ok(/PRIMARY_MAX/.test(MNAV), "the bar shows a few primary tabs");
  assert.ok(/tabs\.map\(\(tb\) => \{/.test(MNAV), "and the sheet lists ALL of them");
  assert.ok(/تسجيل الخروج/.test(MNAV), "sign-out lives in the sheet, since the desktop strip is hidden");
  assert.ok(/aria-modal="true"/.test(MNAV) && /role="dialog"/.test(MNAV), "the sheet is a proper dialog");
  assert.ok(/setSheet\(false\); \}, \[pathname\]\)/.test(MNAV), "navigating closes it");
  assert.ok(/document\.body\.style\.overflow = prev/.test(MNAV), "and the scroll lock is restored exactly as found");
});

test("RTL and Arabic throughout the PWA surfaces", () => {
  for (const [name, src] of [
    ["offline screen", R("components/pwa/OfflineScreen.tsx")],
    ["pwa provider", R("components/pwa/PwaProvider.tsx")],
    ["install guide", R("components/pwa/InstallGuide.tsx")],
  ]) {
    assert.ok(/dir="rtl"/.test(src), `${name} declares RTL`);
    assert.ok(/[؀-ۿ]/.test(src), `${name} is written in Arabic`);
  }
  // Physical left/right would break under RTL; logical properties must be used.
  for (const [name, src] of [["provider", R("components/pwa/PwaProvider.tsx")], ["mobile nav", MNAV]]) {
    assert.ok(/insetInlineStart/.test(src), `${name} positions with logical inline properties`);
    assert.ok(!/(^|[^a-zA-Z])left:\s*["'0-9]/.test(src), `${name} uses no physical left offset`);
    assert.ok(!/(^|[^a-zA-Z])right:\s*["'0-9]/.test(src), `${name} uses no physical right offset`);
  }
  assert.ok(/env\(safe-area-inset-bottom/.test(MNAV), "the bar respects the iOS home indicator");
  // Wave 1 (D-3): the single root layout became three, one per locale, all
  // rendering components/RootDocument.tsx. Same guarantee, two halves now:
  // the Arabic root asks for ar/rtl, and the shell is what puts them on <html>.
  assert.ok(/lang="ar" dir="rtl"/.test(R("app/(ar)/layout.tsx")), "the Arabic document is Arabic/RTL");
  assert.ok(/<html lang=\{lang\} dir=\{dir\}>/.test(R("components/RootDocument.tsx")),
    "the shell must put lang/dir on <html>");
});

// ─── Install prompt handling ────────────────────────────────────────────────

test("the install prompt is captured but NEVER fired automatically", () => {
  const P = R("components/pwa/PwaProvider.tsx");
  assert.ok(/addEventListener\("beforeinstallprompt", onBip\)/.test(P), "the event is captured");
  assert.ok(/e\.preventDefault\(\)/.test(P), "and held");
  // prompt() must appear exactly once, inside the click-driven callback.
  const promptCalls = (P.match(/installEvt\.prompt\(\)/g) || []).length;
  assert.equal(promptCalls, 1, "prompt() is called from exactly one place");
  const runInstall = P.slice(P.indexOf("const runInstall"), P.indexOf("const dismissInstall"));
  assert.ok(/installEvt\.prompt\(\)/.test(runInstall), "and that place is the click handler");
  assert.ok(/onClick=\{\(\) => void runInstall\(\)\}/.test(P), "bound to a button");
  assert.ok(!/useEffect\([^)]*\)\s*=>\s*\{[^}]*prompt\(\)/.test(P), "never from an effect");
});

test("the install card can be dismissed for good, and disappears once installed", () => {
  const P = R("components/pwa/PwaProvider.tsx");
  assert.ok(/DISMISS_KEY/.test(P), "the dismissal is remembered");
  assert.ok(/addEventListener\("appinstalled"/.test(P), "installation is observed");
  assert.ok(/setInstallEvt\(null\)/.test(P), "and the card stops offering an install that already happened");
});

test("no permission of any kind is requested by the PWA layer", () => {
  for (const f of [
    "components/pwa/PwaProvider.tsx",
    "components/pwa/InstallGuide.tsx",
    "components/pwa/OfflineScreen.tsx",
    "lib/pwa/privateCache.ts",
    "lib/pwa/config.ts",
  ]) {
    const src = R(f);
    for (const banned of ["requestPermission", "pushManager", "getUserMedia", "geolocation"]) {
      assert.ok(!src.includes(banned), `${f} must not call ${banned}`);
    }
  }
});

test("registration is skipped in development so a worker cannot pin stale dev chunks", () => {
  const P = R("components/pwa/PwaProvider.tsx");
  assert.ok(/process\.env\.NODE_ENV === "development"\) return;/.test(P), "dev is excluded");
  assert.ok(/\.catch\(\(\) => \{/.test(P), "a refused registration degrades to a plain website, silently and safely");
});

test("the worker registers exactly the four listeners it needs", () => {
  assert.deepEqual(Object.keys(listeners).sort(), ["activate", "fetch", "install", "message"]);
});
