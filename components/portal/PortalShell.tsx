"use client";
// ════════════════════════════════════════════════════════════════════════
// Kian Portal — shell: session→profile bootstrap, account gates, tab nav.
// Wraps every /client-portal/* route (see app/client-portal/layout.tsx).
// ════════════════════════════════════════════════════════════════════════
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { getValidSession, getMyProfile, logout } from "@/lib/portal/auth";
import { updateMyProfile, type EditableProfileFields } from "@/lib/portal/account";
import { unreadCount } from "@/lib/portal/notifications";
import type { Profile } from "@/lib/portal/types";
import { caps as deriveCaps, type Caps } from "@/lib/portal/roles";
import { tabsForViewer, MY_OPPORTUNITIES_TAB } from "@/components/portal/nav";
import { listMyOpportunityRequests } from "@/lib/opportunities";
import { syncProjectsForCurrentUser } from "@/lib/portal/projects";
import AuthTabs from "@/components/portal/AuthTabs";
import { BlockedScreen, InactiveBanner } from "@/components/portal/StatusScreens";

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

type Phase = "loading" | "auth" | "blocked" | "error" | "ready";

export default function PortalShell({ children }: { children: ReactNode }) {
  const { t, isAr } = useI18n();
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

      {/* ─── Tab bar ─── */}
      <div className="max-w-5xl mx-auto px-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 mb-10" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "14px" }}>
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

      <div className="max-w-5xl mx-auto px-5 sm:px-6">{children}</div>
    </Ctx.Provider>
  );
}
