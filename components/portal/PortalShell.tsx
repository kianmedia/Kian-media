"use client";
// ════════════════════════════════════════════════════════════════════════
// Kian Portal — shell: session→profile bootstrap, account gates, tab nav.
// Wraps every /client-portal/* route (see app/client-portal/layout.tsx).
// ════════════════════════════════════════════════════════════════════════
import { globalSearchEnabled } from "@/lib/portal/client";
import CommandPalette from "./CommandPalette";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { getValidSession, getMyProfile, logout } from "@/lib/portal/auth";
import { mfaMyAssurance, shouldChallengeMfa, mfaRoleOf } from "@/lib/portal/mfa";
import MfaLoginChallenge from "@/components/portal/MfaLoginChallenge";
import { updateMyProfile, type EditableProfileFields } from "@/lib/portal/account";
import { unreadCount } from "@/lib/portal/notifications";
import type { Profile } from "@/lib/portal/types";
import { caps as deriveCaps, type Caps } from "@/lib/portal/roles";
import { tabsForViewer, MY_OPPORTUNITIES_TAB } from "@/components/portal/nav";
import { listMyOpportunityRequests } from "@/lib/opportunities";
import { syncProjectsForCurrentUser } from "@/lib/portal/projects";
import AuthTabs from "@/components/portal/AuthTabs";
import { BlockedScreen, InactiveBanner } from "@/components/portal/StatusScreens";
import PortalMobileNav from "@/components/portal/PortalMobileNav";
import { noteActiveUser, onSignOutClearCaches } from "@/lib/pwa/privateCache";

// Signup form fields stashed locally until the first confirmed login,
// then synced into the (trigger-created) profile row.
const PENDING_KEY = "kian_portal_pending_profile";

/** Stash signup fields tied to the signup EMAIL, so they can only ever sync
 *  back into that same account (prevents cross-account contamination). */
export function stashPendingProfile(email: string, fields: EditableProfileFields) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ email, fields })); } catch {}
}

type PortalCtx = {
  profile: Profile;
  /** Role/capability flags (mirrors DB enforcement; UI gating only). */
  caps: Caps;
  /** True when the logged-in email matches ≥1 opportunity request (shows "طلباتي"). */
  hasMyOpportunities: boolean;
  /** account_status === 'inactive' → hide/disable every mutating control */
  readOnly: boolean;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<PortalCtx | null>(null);

export function usePortal(): PortalCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("usePortal must be used inside PortalShell");
  return c;
}

// S3.5: "mfa_challenge" is shown INSTEAD of the portal when a privileged account holds
// a verified TOTP factor but the session is still aal1. It is added here, rather than as
// a route, precisely because every portal page mounts this shell — so a pasted deep link
// during an aal1 session lands on the challenge instead of the page.
//
// It is safe to put in this union ONLY because entry is conditional on the user having
// their OWN verified factor. An admin with no factor never reaches this phase, so
// enrollment mode cannot lock anyone out of their own account.
type Phase = "loading" | "auth" | "blocked" | "error" | "mfa_challenge" | "ready";

export default function PortalShell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  const { t, isAr } = useI18n();
  const wrap = wide ? "max-w-7xl mx-auto px-4 sm:px-6" : "max-w-5xl mx-auto px-5 sm:px-6";
  const pathname = usePathname();
  const [phase, setPhase] = useState<Phase>("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  const [unread, setUnread] = useState(0);
  const [hasMyOpps, setHasMyOpps] = useState(false);

  const bootstrap = useCallback(async () => {
    setPhase("loading");
    const session = await getValidSession();
    if (!session) { setPhase("auth"); return; }

    // PWA · USER SWITCH. Runs BEFORE the first byte of account data is fetched:
    // if the identity behind this browser changed, every PWA cache is destroyed
    // first, so a second employee on a shared device can never be served
    // anything stored while the first one was signed in. Best-effort and never
    // blocking — a cache that refuses to clear must not stop a login.
    try { await noteActiveUser(session.user_id); } catch { /* non-blocking */ }

    const r = await getMyProfile();
    if (!r.ok) {
      if (r.status === 401) { setPhase("auth"); return; }
      setErr(r.error); setPhase("error"); return;
    }
    if (!r.data) { setErr("profile_missing"); setPhase("error"); return; }

    let p = r.data;
    if (p.account_status === "blocked") { setProfile(p); setPhase("blocked"); return; }

    // First confirmed login after signup: sync stashed signup fields → profile,
    // but ONLY into the same account that signed up (email-scoped) and only when
    // the profile has no name yet. Always clear the stash afterward.
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      if (raw) {
        const stash = JSON.parse(raw) as { email?: string; fields?: EditableProfileFields };
        const sameAccount = !!stash.email && stash.email.toLowerCase() === p.email.toLowerCase();
        if (sameAccount && stash.fields && !p.full_name && p.account_status === "active") {
          const u = await updateMyProfile(stash.fields);
          if (u.ok && u.data) p = u.data;
        }
        localStorage.removeItem(PENDING_KEY); // consume / discard stale or foreign stash
      }
    } catch {}

    setProfile(p);

    // ─── S3.5 · privileged login MFA challenge ──────────────────────────────
    // The whole decision lives in shouldChallengeMfa() — a pure function in
    // lib/portal/mfa.ts with a full truth-table test. It requires ALL of:
    //   enforcement_mode = 'enrollment'  AND  role ∈ {owner, super_admin, admin}
    //   AND has_verified_factor          AND  aal1
    //
    // enforcement_mode is checked FIRST, which makes
    //     update public.mfa_settings set enforcement_mode = 'off' where id = 1;
    // a real kill switch: one UPDATE from the Supabase SQL editor — a credential path a
    // portal lockout cannot touch — and this screen is gone on the next load. An earlier
    // version of this block ignored the mode entirely, so that lever silently did
    // nothing; keeping the decision inline is what let that slip through unnoticed.
    //
    // A FAILED read is never treated as "protected". We log a non-identifying marker and
    // fall through, because stranding a legitimate admin on a screen we cannot resolve is
    // the worse failure — but the log makes the degraded state visible rather than silent.
    try {
      const a = await mfaMyAssurance();
      if (a.ok) {
        if (shouldChallengeMfa({
          role: mfaRoleOf(p),
          enforcementMode: a.data.enforcement_mode,
          hasVerifiedFactor: a.data.has_verified_factor,
          isAal2: a.data.is_aal2,
        })) {
          setPhase("mfa_challenge");
          return;
        }
      } else {
        // No user id, no email, no token, no claim — just the failure code.
        console.warn(JSON.stringify({ tag: "MFA_ASSURANCE_UNAVAILABLE", reason: a.error }));
      }
    } catch {
      console.warn(JSON.stringify({ tag: "MFA_ASSURANCE_UNAVAILABLE", reason: "exception" }));
    }

    setPhase("ready");

    // Applicant tab: show "طلباتي" only if this email matches ≥1 opportunity
    // request. Best-effort — before the applicant addendum is run the RPC errors,
    // so the tab stays hidden (graceful). Staff use the admin Opportunities Center.
    try {
      const mo = await listMyOpportunityRequests();
      setHasMyOpps(mo.ok && mo.data.length > 0);
    } catch { setHasMyOpps(false); }

    // Attach any pending (admin-created, no-account) projects matched by this
    // verified email, and repair memberships. Best-effort — graceful if the
    // production project SQL hasn't been run yet.
    try { await syncProjectsForCurrentUser(); } catch { /* non-blocking */ }
  }, []);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  // Unread badge — poll lightly: on ready, on route change, on window focus,
  // and every 60s. No realtime subscriptions (deferred to a later phase).
  useEffect(() => {
    if (phase !== "ready") return;
    let alive = true;
    const refresh = async () => {
      const r = await unreadCount();
      if (alive && r.ok) setUnread(r.data);
    };
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(refresh, 60000);
    return () => { alive = false; window.removeEventListener("focus", onFocus); window.clearInterval(id); };
  }, [phase, pathname]);

  const signOut = useCallback(async () => {
    await logout();
    // PWA · LOGOUT. The session is gone from localStorage, but a service-worker
    // cache is separate storage that outlives it — so it is destroyed here too,
    // and the remembered identity is forgotten so the next login is compared
    // against nothing. Best-effort: a failure here must never trap a user in a
    // session they asked to leave.
    try { await onSignOutClearCaches(); } catch { /* non-blocking */ }
    setProfile(null);
    setPhase("auth");
  }, []);

  // The password-reset page is reached from an email link with a recovery token
  // (no session yet), so it must bypass the auth gate and render its own flow.
  if (pathname === "/client-portal/reset-password") return <>{children}</>;

  // ─── Gates ───
  if (phase === "loading") {
    return (
      <div className="text-center" style={{ padding: "140px 0" }}>
        <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "3px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase" }}>
          {t({ ar: "جارٍ التحميل...", en: "Loading..." })}
        </div>
      </div>
    );
  }
  if (phase === "auth") return <AuthTabs onAuthed={() => void bootstrap()} />;
  if (phase === "blocked") return <BlockedScreen />;
  // Re-running bootstrap() after a successful verify re-reads assurance from Postgres
  // rather than trusting the modal's own word for it, and lands the user on whatever
  // route they originally requested — the shell never navigated away from it.
  if (phase === "mfa_challenge") {
    return (
      <MfaLoginChallenge
        email={profile?.email ?? ""}
        onVerified={() => void bootstrap()}
        onSignOut={() => void signOut()}
      />
    );
  }
  if (phase === "error") {
    return (
      <div className="text-center" style={{ padding: "120px 24px" }}>
        <p className="text-white/60" style={{ fontSize: "15px", marginBottom: "20px" }}>
          {t({ ar: "تعذّر تحميل حسابك.", en: "Couldn't load your account." })}
        </p>
        <p className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.35)", direction: "ltr", marginBottom: "24px" }}>{err}</p>
        <button onClick={() => void bootstrap()} className="btn-ghost">
          {t({ ar: "إعادة المحاولة", en: "Retry" })}
        </button>
      </div>
    );
  }

  const p = profile!;
  const readOnly = p.account_status === "inactive";
  const cps = deriveCaps(p);
  const tabs = [...tabsForViewer(p), ...(hasMyOpps ? [MY_OPPORTUNITIES_TAB] : [])];

  return (
    <Ctx.Provider value={{ profile: p, caps: cps, hasMyOpportunities: hasMyOpps, readOnly, reload: bootstrap, signOut }}>
      {readOnly && <InactiveBanner />}

      {/* ─── Tab bar (desktop/tablet; hidden <768px in favour of PortalMobileNav) ─── */}
      <div className={wrap}>
        <div className="pt-tabbar flex flex-wrap items-center gap-2 mb-10" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "14px" }}>
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className="f-sans pt-tab inline-flex items-center gap-1.5"
                style={{
                  fontSize: "11.5px", letterSpacing: "1.5px", fontWeight: 600, textTransform: "uppercase",
                  padding: "9px 15px", borderRadius: "3px", textDecoration: "none",
                  color: active ? "#fff" : "rgba(255,255,255,0.5)",
                  background: active ? "rgba(227,30,36,0.14)" : "transparent",
                  border: `1px solid ${active ? "rgba(227,30,36,0.5)" : "rgba(255,255,255,0.08)"}`,
                  transition: "all 0.3s",
                }}
              >
                {t({ ar: tab.ar, en: tab.en })}
                {tab.key === "notifications" && unread > 0 && (
                  <span aria-label={`${unread} unread`} style={{
                    minWidth: "17px", height: "17px", padding: "0 5px", borderRadius: "9px",
                    background: "#E31E24", color: "#fff", fontSize: "10px", fontWeight: 700,
                    display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                  }}>
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
          <span style={{ flex: 1 }} />
          <button
            onClick={() => void signOut()}
            className="f-sans"
            style={{ fontSize: "10.5px", letterSpacing: "2px", textTransform: "uppercase", color: "rgba(255,255,255,0.45)", background: "none", border: "1px solid rgba(255,255,255,0.12)", padding: "9px 16px", borderRadius: "3px", cursor: "pointer" }}
          >
            {t({ ar: "تسجيل الخروج", en: "Sign Out" })}
          </button>
        </div>
      </div>

      <div className={`${wrap} pt-shell-body`}>{children}</div>
      {/* Wave 7 · V2-7.1 — العلم مطفأ ⇒ لا مكوّن ولا مستمع لوحة مفاتيح ولا طلب. */}
      {globalSearchEnabled() && <CommandPalette />}

      {/* ─── Mobile navigation (<768px) ───
          Rendered next to the strip above, never instead of it by a separate
          condition: one CSS breakpoint decides which of the two is visible, so
          there is no state in which a phone has no navigation at all. */}
      <PortalMobileNav
        tabs={tabs}
        pathname={pathname}
        unread={unread}
        label={t}
        onSignOut={() => void signOut()}
      />
    </Ctx.Provider>
  );
}
