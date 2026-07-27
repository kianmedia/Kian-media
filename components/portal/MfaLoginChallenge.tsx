"use client";
// ════════════════════════════════════════════════════════════════════════════
// S3.5 — the login-time MFA challenge screen.
//
// Shown INSTEAD of the portal when a privileged account (owner / super_admin /
// admin) holds a verified TOTP factor but the current session is still aal1. It
// renders inside PortalShell, so every portal route mounts it — which is what makes
// pasting a deep link during an aal1 session land here rather than on the page.
//
// ANTI-LOCKOUT, and this is the part that matters most:
//   • Sign-out is ALWAYS available on this screen. A user can never be trapped.
//   • An admin with NO verified factor is never routed here at all — they go
//     straight in and can enrol at their own pace. Enrollment mode must not lock
//     anyone out of their own account.
//   • The lost-device recovery path is named on screen.
//
// HONEST SCOPE: this gates the login FLOW, not the data. It is a client-side
// decision and a determined caller could bypass it by talking to PostgREST directly
// with an aal1 token. That is expected at this stage and is exactly why S4 adds
// server-side SQL gates on the sensitive writes. Hiding a screen is not protection;
// this screen exists so the flow is real and testable before the gates land.
//
// Nothing here is logged — no code, no token, no GoTrue response body.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { getValidSession } from "@/lib/portalAuth";
import { useI18n } from "@/lib/i18n";
import { mfaStepUp, mfaErrorText } from "@/lib/portal/mfa";

export default function MfaLoginChallenge({
  email, onVerified, onSignOut,
}: {
  email: string;
  onVerified: () => void;
  onSignOut: () => void;
}) {
  const { t, isAr } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofocus so the flow is one action: open app, type code.
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  async function submit() {
    if (code.length !== 6 || busy) return;
    setBusy(true); setErr("");
    // Refresh first: a page reload or a slow authenticator lookup can outlive the
    // access token, and "your code is wrong" would be a lie in that case.
    const s = await getValidSession();
    if (!s) {
      setErr(t({
        ar: "انتهت جلستك أثناء التحقّق. سجّل الدخول مرة أخرى.",
        en: "Your session expired during verification. Please sign in again.",
      }));
      setBusy(false);
      return;
    }
    // mfaStepUp issues a FRESH challenge on every attempt, so an expired challenge
    // resolves itself by retrying — there is no stale challenge id to get stuck on.
    const r = await mfaStepUp(s, code);
    setBusy(false);
    setCode("");
    if (!r.ok) {
      setAttempts((n) => n + 1);
      setErr(r.error === "not_found"
        ? t({ ar: "لم نجد تطبيق مصادقة مُفعَّلًا على حسابك.", en: "No verified authenticator was found on your account." })
        : mfaErrorText(r.error, isAr));
      inputRef.current?.focus();
      return;
    }
    onVerified();
  }

  return (
    <div dir={isAr ? "rtl" : "ltr"} style={{ minHeight: "70vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ width: "100%", maxWidth: 420, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: 28 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>
          {t({ ar: "خطوة تحقّق إضافية", en: "One more step" })}
        </div>
        <h2 className="editorial text-white" style={{ fontSize: 22, marginBottom: 8, lineHeight: 1.35 }}>
          {t({ ar: "أدخل رمز تطبيق المصادقة", en: "Enter your authenticator code" })}
        </h2>
        <p className="text-white/60" style={{ fontSize: 13.5, lineHeight: 1.8, marginBottom: 6 }}>
          {t({
            ar: "حسابك إداريّ ومحميّ بالتحقّق بخطوتين. أدخل الرمز المكوَّن من 6 أرقام لإكمال الدخول.",
            en: "Your account is an administrative one protected by two-step verification. Enter the 6-digit code to finish signing in.",
          })}
        </p>
        {email && (
          <p className="f-sans" dir="ltr" style={{ fontSize: 12.5, color: "rgba(255,255,255,0.4)", marginBottom: 18, textAlign: isAr ? "right" : "left" }}>
            {email}
          </p>
        )}

        {err && (
          <div style={{ padding: "10px 13px", borderRadius: 3, marginBottom: 14, fontSize: 13.5, color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)" }}>
            {err}
          </div>
        )}

        <label htmlFor="mfa-login-code" className="f-sans" style={{ display: "block", fontSize: 12.5, color: "rgba(255,255,255,0.7)", marginBottom: 7 }}>
          {t({ ar: "الرمز (6 أرقام)", en: "Code (6 digits)" })}
        </label>
        <input id="mfa-login-code" ref={inputRef} dir="ltr" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} value={code} disabled={busy}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          aria-label={t({ ar: "رمز التحقق", en: "Verification code" })}
          style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "13px 15px", color: "#fff", fontSize: 22, letterSpacing: 8, textAlign: "center", outline: "none", opacity: busy ? 0.6 : 1 }} />

        <button onClick={submit} disabled={code.length !== 6 || busy} className="btn-red"
          style={{ width: "100%", justifyContent: "center", marginTop: 16, opacity: code.length !== 6 || busy ? 0.55 : 1 }}>
          <span>{busy ? "…" : t({ ar: "تأكيد ومتابعة", en: "Verify and continue" })}</span>
        </button>

        {attempts >= 2 && (
          <p className="text-white/50" style={{ fontSize: 12.5, marginTop: 14, lineHeight: 1.7 }}>
            {t({
              ar: "تأكّد أن وقت جهازك مضبوط تلقائيًا — الرموز تعتمد على الوقت، وفارق دقيقة يُبطلها.",
              en: "Check that your device clock is set automatically — these codes are time-based, and a minute of drift invalidates them.",
            })}
          </p>
        )}

        <hr style={{ border: "none", borderTop: "1px solid rgba(255,255,255,0.08)", margin: "20px 0 14px" }} />

        {/* ALWAYS available. This is the guarantee that nobody is ever trapped here. */}
        <button onClick={onSignOut} className="f-sans"
          style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline", padding: 0 }}>
          {t({ ar: "تسجيل الخروج", en: "Sign out" })}
        </button>

        <p className="text-white/40" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.75 }}>
          {t({
            ar: "فقدت جهازك؟ يمكن إزالة العامل من لوحة Supabase مباشرة — مسار مستقل عن البوابة لا يمنعه هذا التحقّق.",
            en: "Lost your device? The factor can be removed directly from the Supabase dashboard — a path independent of the portal that this screen cannot block.",
          })}
        </p>
      </div>
    </div>
  );
}
