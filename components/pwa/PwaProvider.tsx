"use client";
// ════════════════════════════════════════════════════════════════════════════
// PWA runtime: registration, honest update indicator, offline notice, and an
// install prompt that is only ever shown — never fired — on its own.
//
// THREE DELIBERATE REFUSALS
//   1. The worker is NEVER auto-updated mid-session. A new worker waits; the
//      user is told; the swap happens on their click. Silently swapping a
//      worker under an open form is how half-submitted work disappears.
//   2. beforeinstallprompt is captured and preventDefault()-ed, but prompt()
//      is called ONLY from a click handler. An unprompted install dialog is a
//      dark pattern, and Chrome penalises it anyway.
//   3. No permission is requested for anything. Push is FOUNDATION ONLY —
//      DISABLED (docs/PWA_PUSH_CONTRACT.md); notifications are not requested,
//      not subscribed and not delivered.
//
// The version shown is the version the ACTIVE worker reports, not the one this
// bundle shipped with. Those differ exactly when an update is pending, which is
// the only moment the number matters.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import {
  MSG,
  OFFLINE_NOTICE,
  PWA_BUILD_ID,
  PWA_VERSION,
  SW_SCOPE,
  SW_URL,
} from "@/lib/pwa/config";
import InstallGuide from "./InstallGuide";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "kian_pwa_install_dismissed";

export default function PwaProvider() {
  const [online, setOnline] = useState(true);
  const [updateReady, setUpdateReady] = useState(false);
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const [installEvt, setInstallEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(true);
  const regRef = useRef<ServiceWorkerRegistration | null>(null);
  const reloadingRef = useRef(false);

  // ─── Connectivity ─────────────────────────────────────────────────────────
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  // ─── Registration + update detection ──────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // `next dev` serves un-hashed chunks that a worker must not be allowed to
    // hold on to; registering only outside development keeps the dev loop sane
    // without weakening anything in production.
    if (process.env.NODE_ENV === "development") return;

    let cancelled = false;

    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
      reg.addEventListener("updatefound", () => {
        const incoming = reg.installing;
        if (!incoming) return;
        incoming.addEventListener("statechange", () => {
          // `controller` present ⇒ this is a REPLACEMENT, not a first install.
          // Without that check the very first visit would announce an "update".
          if (incoming.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        });
      });
    };

    navigator.serviceWorker
      .register(SW_URL, { scope: SW_SCOPE })
      .then((reg) => {
        if (cancelled) return;
        regRef.current = reg;
        watch(reg);
        void askVersion();
      })
      .catch(() => {
        // Registration can legitimately fail (private mode, unsupported, policy).
        // The app is a normal website in that case — nothing degrades.
      });

    const onControllerChange = () => {
      if (!reloadingRef.current) return;
      reloadingRef.current = false;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    // Look for a new build on focus and hourly — never more aggressively.
    const check = () => { void regRef.current?.update().catch(() => {}); };
    window.addEventListener("focus", check);
    const timer = window.setInterval(check, 60 * 60 * 1000);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      window.removeEventListener("focus", check);
      window.clearInterval(timer);
    };
  }, []);

  /** Ask the ACTIVE worker what it is running (not what this bundle claims). */
  const askVersion = useCallback(async () => {
    try {
      const ctrl = navigator.serviceWorker?.controller;
      if (!ctrl) return;
      const answer = await new Promise<string | null>((resolve) => {
        const ch = new MessageChannel();
        const to = window.setTimeout(() => resolve(null), 2000);
        ch.port1.onmessage = (e) => {
          window.clearTimeout(to);
          resolve(typeof e.data?.version === "string" ? e.data.version : null);
        };
        ctrl.postMessage({ type: MSG.GET_VERSION }, [ch.port2]);
      });
      setActiveVersion(answer);
      if (answer && answer !== PWA_VERSION) setUpdateReady(true);
    } catch {
      setActiveVersion(null);
    }
  }, []);

  const applyUpdate = useCallback(() => {
    const reg = regRef.current;
    if (!reg?.waiting) {
      window.location.reload();
      return;
    }
    reloadingRef.current = true;
    reg.waiting.postMessage({ type: MSG.SKIP_WAITING });
  }, []);

  // ─── Install prompt (captured, never auto-fired) ──────────────────────────
  useEffect(() => {
    try {
      setInstallDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setInstallDismissed(false);
    }
    const onBip = (e: Event) => {
      e.preventDefault(); // hold it; the user decides when
      setInstallEvt(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvt(null);
      try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
      setInstallDismissed(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const runInstall = useCallback(async () => {
    if (!installEvt) { setGuideOpen(true); return; }
    try {
      await installEvt.prompt();          // user-gesture only
      await installEvt.userChoice;
    } catch {
      /* the browser may refuse a stale event — the guide still explains the manual path */
    }
    setInstallEvt(null);
  }, [installEvt]);

  const dismissInstall = useCallback(() => {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch {}
    setInstallDismissed(true);
  }, []);

  const showInstallCard = !!installEvt && !installDismissed;

  return (
    <>
      {/* build identifier — machine readable, zero visual weight */}
      <span hidden data-kian-pwa-build={PWA_BUILD_ID} data-kian-pwa-active={activeVersion ?? "unknown"} />

      {/* ─── Offline notice ─── */}
      {!online && (
        <div
          role="status"
          aria-live="polite"
          dir="rtl"
          style={{
            position: "fixed", insetInlineStart: 0, insetInlineEnd: 0, top: 0, zIndex: 120,
            background: "rgba(120,20,22,0.97)", color: "#fff",
            fontSize: "12.5px", lineHeight: 1.7, textAlign: "center",
            padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.14)",
          }}
        >
          {OFFLINE_NOTICE}
        </div>
      )}

      {/* ─── Update available ─── */}
      {updateReady && (
        <div
          role="status"
          dir="rtl"
          style={{
            position: "fixed", insetInlineStart: "16px", bottom: "16px", zIndex: 120,
            maxWidth: "330px", background: "rgba(10,10,10,0.97)", color: "#fff",
            border: "1px solid rgba(227,30,36,0.45)", borderRadius: "4px", padding: "14px 16px",
          }}
        >
          <p style={{ fontSize: "13px", lineHeight: 1.8, marginBottom: "4px" }}>
            يتوفّر تحديث جديد للتطبيق.
          </p>
          <p dir="ltr" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.4)", marginBottom: "10px" }}>
            {activeVersion ? `${activeVersion} → ${PWA_VERSION}` : PWA_BUILD_ID}
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={applyUpdate}
              style={{
                fontSize: "10.5px", letterSpacing: "1.6px", textTransform: "uppercase", color: "#fff",
                background: "rgba(227,30,36,0.18)", border: "1px solid rgba(227,30,36,0.5)",
                padding: "8px 15px", borderRadius: "3px", cursor: "pointer",
              }}
            >
              تحديث الآن
            </button>
            <button
              type="button"
              onClick={() => setUpdateReady(false)}
              style={{
                fontSize: "10.5px", letterSpacing: "1.6px", textTransform: "uppercase",
                color: "rgba(255,255,255,0.5)", background: "none",
                border: "1px solid rgba(255,255,255,0.14)", padding: "8px 15px",
                borderRadius: "3px", cursor: "pointer",
              }}
            >
              لاحقًا
            </button>
          </div>
        </div>
      )}

      {/* ─── Install card ─── */}
      {showInstallCard && !updateReady && (
        <div
          dir="rtl"
          style={{
            position: "fixed", insetInlineStart: "16px", bottom: "16px", zIndex: 115,
            maxWidth: "330px", background: "rgba(10,10,10,0.97)", color: "#fff",
            border: "1px solid rgba(255,255,255,0.14)", borderRadius: "4px", padding: "14px 16px",
          }}
        >
          <p style={{ fontSize: "13px", lineHeight: 1.8, marginBottom: "10px" }}>
            ثبّت بوابة كيان على جهازك للوصول السريع.
          </p>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => void runInstall()}
              style={{
                fontSize: "10.5px", letterSpacing: "1.6px", textTransform: "uppercase", color: "#fff",
                background: "rgba(227,30,36,0.18)", border: "1px solid rgba(227,30,36,0.5)",
                padding: "8px 15px", borderRadius: "3px", cursor: "pointer",
              }}
            >
              تثبيت
            </button>
            <button
              type="button"
              onClick={() => setGuideOpen(true)}
              style={{
                fontSize: "10.5px", letterSpacing: "1.6px", textTransform: "uppercase",
                color: "rgba(255,255,255,0.55)", background: "none",
                border: "1px solid rgba(255,255,255,0.14)", padding: "8px 15px",
                borderRadius: "3px", cursor: "pointer",
              }}
            >
              كيف؟
            </button>
            <button
              type="button"
              onClick={dismissInstall}
              style={{
                fontSize: "10.5px", letterSpacing: "1.6px", textTransform: "uppercase",
                color: "rgba(255,255,255,0.35)", background: "none", border: "none",
                padding: "8px 6px", cursor: "pointer",
              }}
            >
              إخفاء
            </button>
          </div>
        </div>
      )}

      <InstallGuide open={guideOpen} onClose={() => setGuideOpen(false)} />
    </>
  );
}
