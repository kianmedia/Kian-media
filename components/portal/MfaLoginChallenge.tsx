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
//   • The real emergency lever is named on screen: the owner sets enforcement_mode
//     to 'off' in the Supabase SQL editor and this screen is gone on the next load.
//     Deleting a factor row is NOT the escape hatch — that is a formal, audited
//     administrative action for a genuinely lost device.
//
// HONEST SCOPE: this gates the login FLOW, not the data. It is a client-side
// decision and a determined caller could bypass it by talking to PostgREST directly
// with an aal1 token. That is expected at this stage and is exactly why S4 adds
// server-side SQL gates on the sensitive writes. Hiding a screen is not protection;
// this screen exists so the flow is real and testable before the gates land.
//
// Nothing here is logged — no code, no token, no GoTrue response body.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { getValidSession } from "@/lib/portalAuth";
import { useI18n } from "@/lib/i18n";
import { mfaStepUp, mfaUsableFactors, mfaErrorText, type MfaFactor } from "@/lib/portal/mfa";

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
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [chosen, setChosen] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  // Guards a double-submit: without it, auto-submit-on-6-digits plus an Enter press or
  // a fast second click would fire two challenge/verify round-trips for one code.
  const inFlight = useRef(false);

  // Load the selectable factors once. The list is ALSO re-fetched inside mfaStepUp on
  // every attempt, so a factor removed mid-session can never be used from here.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const s = await getValidSession();
      if (!s || !alive) return;
      const r = await mfaUsableFactors(s.access_token);
      if (!alive || !r.ok) return;
      setFactors(r.data);
      if (r.data.length === 1) setChosen(r.data[0].id);
    })();
    return () => { alive = false; };
  }, []);

  // Autofocus so the flow is one action: open app, type code.
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 80); }, []);

  const submit = useCallback(async function submit(value?: string) {
    const entered = (value ?? code).replace(/\D/g, "").slice(0, 6);
    if (entered.length !== 6 || inFlight.current) return;
    // With several factors the user must pick one — never guess on their behalf.
    if (!chosen) {
      setErr(t({ ar: "اختر تطبيق المصادقة أولًا.", en: "Choose an authenticator first." }));
      return;
    }
    inFlight.current = true;
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
      inFlight.current = false;
      return;
    }
    // mfaStepUp re-lists factors and issues a FRESH challenge on every attempt, so an
    // expired challenge or a factor changed since page load resolves itself by retrying —
    // there is no stale id to get stuck on.
    const r = await mfaStepUp(s, entered, chosen);
    setBusy(false);
    inFlight.current = false;
    setCode("");
    if (!r.ok) {
      setAttempts((n) => n + 1);
      setErr(r.error === "mfa_factor_not_found"
        ? t({ ar: "لم نجد تطبيق مصادقة مُفعَّلًا على حسابك.", en: "No verified authenticator was found on your account." })
        : mfaErrorText(r.error, isAr));
      inputRef.current?.focus();
      return;
    }
    onVerified();
  }, [code, chosen, isAr, t, onVerified]);

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

        {factors.length > 1 && (
          <div style={{ marginBottom: 14 }}>
            <div className="f-sans" style={{ fontSize: 12.5, color: "rgba(255,255,255,0.7)", marginBottom: 7 }}>
              {t({ ar: "اختر تطبيق المصادقة", en: "Choose an authenticator" })}
            </div>
            {/* friendly_name only — the factor id is never rendered. */}
            {factors.map((f, i) => (
              <button key={f.id} type="button" onClick={() => setChosen(f.id)} className="f-sans"
                style={{ display: "block", width: "100%", textAlign: isAr ? "right" : "left", marginBottom: 6,
                  padding: "10px 13px", fontSize: 13.5, borderRadius: 3, cursor: "pointer",
                  background: chosen === f.id ? "rgba(227,30,36,0.12)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${chosen === f.id ? "rgba(227,30,36,0.45)" : "rgba(255,255,255,0.1)"}`,
                  color: chosen === f.id ? "#fff" : "rgba(255,255,255,0.6)" }}>
                {f.friendly_name || t({ ar: `تطبيق ${i + 1}`, en: `Authenticator ${i + 1}` })}
              </button>
            ))}
          </div>
        )}

        <label htmlFor="mfa-login-code" className="f-sans" style={{ display: "block", fontSize: 12.5, color: "rgba(255,255,255,0.7)", marginBottom: 7 }}>
          {t({ ar: "الرمز (6 أرقام)", en: "Code (6 digits)" })}
        </label>
        <input id="mfa-login-code" ref={inputRef} dir="ltr" inputMode="numeric" autoComplete="one-time-code"
          maxLength={6} value={code} disabled={busy}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "").slice(0, 6);
            setCode(v);
            // Auto-submit on the 6th digit (covers pasting a code too). Safe because
            // inFlight guards re-entry and the field is disabled while busy.
            if (v.length === 6) void submit(v);
          }}
          onPaste={(e) => {
            const v = (e.clipboardData.getData("text") || "").replace(/\D/g, "").slice(0, 6);
            if (v.length === 6) { e.preventDefault(); setCode(v); void submit(v); }
          }}
          onKeyDown={(e) => { if (e.key === "Enter") void submit(); }}
          aria-label={t({ ar: "رمز التحقق", en: "Verification code" })}
          style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "13px 15px", color: "#fff", fontSize: 22, letterSpacing: 8, textAlign: "center", outline: "none", opacity: busy ? 0.6 : 1 }} />

        <button onClick={() => void submit()} disabled={code.length !== 6 || busy} className="btn-red"
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
            ar: "تعذّر عليك المتابعة؟ يستطيع مالك النظام إيقاف هذا التحقّق فورًا من لوحة Supabase — مسار مستقل عن البوابة لا تمنعه هذه الشاشة. أمّا إعادة تسجيل جهاز مفقود فإجراء إداري منفصل.",
            en: "Stuck? The system owner can switch this check off immediately from the Supabase dashboard — a path independent of the portal that this screen cannot block. Re-registering a lost device is a separate administrative step.",
          })}
        </p>
      </div>
    </div>
  );
}
