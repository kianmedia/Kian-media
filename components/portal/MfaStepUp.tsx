"use client";
// ════════════════════════════════════════════════════════════════════════════
// Step-up: raise an existing aal1 session to aal2 with an authenticator code.
//
// SHIPPED BEFORE ANYTHING CAN DENY — on purpose. The recovery UI must exist before
// the failure it recovers from. Nothing currently triggers this modal, because no
// write is gated yet (enforcement mode is 'off' and 'enforced' is not even a legal
// value in the database constraint). When S4 adds gates, they return a clear
// `mfa_required` error and the caller raises this — never a blank screen.
//
// This component is UX, NOT a security boundary. The boundary is the SQL gate. A user
// who dismisses this modal simply does not get the elevated token; they cannot get
// past a gate by closing a dialog.
//
// Nothing here logs, and no secret is involved: step-up uses an EXISTING factor, so
// there is no QR and no secret to display.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { getValidSession } from "@/lib/portalAuth";
import { useI18n } from "@/lib/i18n";
import { mfaStepUp, mfaErrorText } from "@/lib/portal/mfa";

export default function MfaStepUp({
  open, onCancel, onVerified, reason,
}: {
  open: boolean;
  onCancel: () => void;
  onVerified: () => void;
  /** Optional: what the user was trying to do, so the ask has context. */
  reason?: string;
}) {
  const { t, isAr } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) { setCode(""); setErr(""); setTimeout(() => inputRef.current?.focus(), 60); }
  }, [open]);

  if (!open) return null;

  async function submit() {
    setBusy(true); setErr("");
    const s = await getValidSession();
    if (!s) {
      // Session expired mid-flow. Say so plainly rather than blaming the code.
      setErr(t({ ar: "انتهت جلستك. سجّل الدخول مرة أخرى.", en: "Your session expired. Please sign in again." }));
      setBusy(false); return;
    }
    const r = await mfaStepUp(s, code);
    setBusy(false);
    if (!r.ok) {
      setErr(r.error === "mfa_factor_not_found"
        ? t({ ar: "لا يوجد تطبيق مصادقة مُفعَّل على حسابك.", en: "No authenticator is enabled on your account." })
        : mfaErrorText(r.error, isAr));
      setCode("");
      return;
    }
    onVerified();
  }

  return (
    <div role="dialog" aria-modal="true" dir={isAr ? "rtl" : "ltr"}
      style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.72)", padding: 18 }}>
      <div style={{ width: "100%", maxWidth: 400, background: "#0d0d0d", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: 24 }}>
        <h3 className="editorial text-white" style={{ fontSize: 19, marginBottom: 8 }}>
          {t({ ar: "تأكيد الهوية", en: "Confirm it's you" })}
        </h3>
        <p className="text-white/60" style={{ fontSize: 13.5, lineHeight: 1.8, marginBottom: 16 }}>
          {reason
            ? t({ ar: `للمتابعة (${reason}) أدخل الرمز من تطبيق المصادقة.`, en: `To continue (${reason}), enter the code from your authenticator app.` })
            : t({ ar: "هذه عملية حسّاسة. أدخل الرمز من تطبيق المصادقة للمتابعة.", en: "This is a sensitive action. Enter the code from your authenticator app to continue." })}
        </p>

        {err && <p style={{ color: "#ff6b6b", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}

        <input ref={inputRef} dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6 && !busy) void submit(); }}
          aria-label={t({ ar: "رمز التحقق", en: "Verification code" })}
          style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 3, padding: "13px 15px", color: "#fff", fontSize: 21, letterSpacing: 7, textAlign: "center", outline: "none" }} />

        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button onClick={submit} disabled={code.length !== 6 || busy} className="btn-red"
            style={{ flex: 1, justifyContent: "center", opacity: code.length !== 6 || busy ? 0.55 : 1 }}>
            <span>{busy ? "…" : t({ ar: "تأكيد", en: "Confirm" })}</span>
          </button>
          <button onClick={onCancel} className="f-sans"
            style={{ padding: "0 18px", fontSize: 13.5, color: "rgba(255,255,255,0.6)", background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, cursor: "pointer" }}>
            {t({ ar: "إلغاء", en: "Cancel" })}
          </button>
        </div>

        <p className="text-white/40" style={{ fontSize: 12, marginTop: 14, lineHeight: 1.7 }}>
          {t({
            ar: "فقدت جهازك؟ تواصل مع مالك الحساب — يمكنه إزالة العامل من لوحة Supabase مباشرة.",
            en: "Lost your device? Contact the account owner — they can remove the factor directly from the Supabase dashboard.",
          })}
        </p>
      </div>
    </div>
  );
}
