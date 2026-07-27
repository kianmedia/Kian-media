"use client";
// ════════════════════════════════════════════════════════════════════════════
// TOTP enrollment / management for the signed-in user.
//
// SECRET HANDLING — the owner's hard constraint, enforced by construction:
//   • The otpauth URI and base32 secret live in React state for the duration of the
//     enrollment dialog and nowhere else. They are never written to localStorage,
//     never sent to any /api route, never stored in Postgres, never logged.
//   • The QR is rendered client-side by lib/qr/qr.ts (the already-installed `qrcode`
//     package), so the secret never leaves the browser to become an image.
//   • clearEnrollment() drops both as soon as the dialog closes or verification
//     succeeds, so they do not linger in memory behind a closed dialog.
//   • There is no console.* anywhere in this component.
//
// STATE MODEL: a factor is UNVERIFIED until a correct code is entered. Abandoning
// enrollment leaves the account exactly as it was — the safe failure direction.
//
// This component does not enforce anything. Enrollment is voluntary at this stage;
// the enforcement mode ships 'off' and 'enforced' is not even a legal value in the
// database constraint.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { getValidSession } from "@/lib/portalAuth";
import { qrSvg } from "@/lib/qr/qr";
import { useI18n } from "@/lib/i18n";
import {
  mfaListFactors, mfaEnrollTotp, mfaChallenge, mfaVerify, mfaUnenroll,
  mfaErrorText, type MfaFactor,
} from "@/lib/portal/mfa";

type Stage = "idle" | "loading" | "showing_qr" | "verifying";

export default function MfaEnrollment() {
  const { t, isAr } = useI18n();
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [stage, setStage] = useState<Stage>("loading");
  const [err, setErr] = useState("");
  const [notice, setNotice] = useState("");

  // Enrollment-only state. Never persisted.
  const [factorId, setFactorId] = useState("");
  const [secret, setSecret] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");

  const clearEnrollment = useCallback(() => {
    setFactorId(""); setSecret(""); setQr(""); setCode("");
  }, []);

  const refresh = useCallback(async () => {
    setErr("");
    const s = await getValidSession();
    if (!s) { setErr(t({ ar: "انتهت جلستك.", en: "Your session expired." })); setStage("idle"); return; }
    const r = await mfaListFactors(s.access_token);
    if (!r.ok) { setErr(mfaErrorText(r.error, isAr)); setStage("idle"); return; }
    setFactors(r.data.filter((f) => f.factor_type === "totp"));
    setStage("idle");
  }, [isAr, t]);

  useEffect(() => { void refresh(); }, [refresh]);

  const verified = factors.filter((f) => f.status === "verified");

  async function startEnroll() {
    setErr(""); setNotice(""); setStage("loading");
    const s = await getValidSession();
    if (!s) { setErr(t({ ar: "انتهت جلستك.", en: "Your session expired." })); setStage("idle"); return; }
    const r = await mfaEnrollTotp(s.access_token);
    if (!r.ok) { setErr(mfaErrorText(r.error, isAr)); setStage("idle"); return; }
    setFactorId(r.data.factorId);
    setSecret(r.data.secret);
    setQr(r.data.uri ? await qrSvg(r.data.uri, 190) : "");
    setStage("showing_qr");
  }

  async function submitCode() {
    setErr(""); setStage("verifying");
    const s = await getValidSession();
    if (!s) { setErr(t({ ar: "انتهت جلستك.", en: "Your session expired." })); setStage("idle"); return; }
    const ch = await mfaChallenge(s.access_token, factorId);
    if (!ch.ok) { setErr(mfaErrorText(ch.error, isAr)); setStage("showing_qr"); return; }
    const v = await mfaVerify(s, factorId, ch.data.challengeId, code);
    if (!v.ok) { setErr(mfaErrorText(v.error, isAr)); setStage("showing_qr"); return; }
    // Verified. The new aal2 token is already in the single session store.
    clearEnrollment();
    setNotice(t({
      ar: "تم التفعيل. سيُطلب رمز التطبيق عند العمليات الإدارية الحسّاسة.",
      en: "Enabled. Your authenticator code will be requested for sensitive admin actions.",
    }));
    await refresh();
  }

  async function remove(id: string) {
    if (!window.confirm(t({
      ar: "إزالة هذا العامل؟ سيتوقّف طلب رمز التطبيق منك.",
      en: "Remove this factor? You will no longer be asked for an authenticator code.",
    }))) return;
    setErr(""); setStage("loading");
    const s = await getValidSession();
    if (!s) { setErr(t({ ar: "انتهت جلستك.", en: "Your session expired." })); setStage("idle"); return; }
    const r = await mfaUnenroll(s.access_token, id);
    if (!r.ok) { setErr(mfaErrorText(r.error, isAr)); setStage("idle"); return; }
    setNotice(t({ ar: "أُزيل العامل.", en: "Factor removed." }));
    await refresh();
  }

  const box: React.CSSProperties = {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 4, padding: 18,
  };

  return (
    <section dir={isAr ? "rtl" : "ltr"} style={{ ...box, marginTop: 18 }}>
      <h3 className="editorial text-white" style={{ fontSize: 18, marginBottom: 6 }}>
        {t({ ar: "التحقّق بخطوتين (TOTP)", en: "Two-step verification (TOTP)" })}
      </h3>
      <p className="text-white/60" style={{ fontSize: 13.5, lineHeight: 1.8, marginBottom: 14 }}>
        {t({
          ar: "يضيف رمزًا من تطبيق مصادقة على جهازك عند تنفيذ العمليات الإدارية الحسّاسة. لا يؤثّر على تصفّح البوابة أو قراءة بياناتك.",
          en: "Adds a code from an authenticator app on your device when performing sensitive admin actions. It does not affect browsing the portal or reading your data.",
        })}
      </p>

      {err && <p style={{ color: "#ff6b6b", fontSize: 13.5, marginBottom: 12 }}>{err}</p>}
      {notice && <p style={{ color: "#6ee7b7", fontSize: 13.5, marginBottom: 12 }}>{notice}</p>}

      {/* ── existing factors ── */}
      {stage !== "showing_qr" && stage !== "verifying" && (
        <>
          {verified.length === 0 ? (
            <p className="text-white/50" style={{ fontSize: 13.5, marginBottom: 14 }}>
              {t({ ar: "لا يوجد تطبيق مصادقة مُفعَّل على حسابك.", en: "No authenticator is enabled on your account." })}
            </p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 14px" }}>
              {verified.map((f) => (
                <li key={f.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.28)", borderRadius: 4, marginBottom: 8 }}>
                  <span style={{ fontSize: 13.5, color: "#6ee7b7" }}>
                    ✓ {f.friendly_name || t({ ar: "تطبيق مصادقة", en: "Authenticator" })}
                  </span>
                  <button onClick={() => remove(f.id)} className="f-sans"
                    style={{ fontSize: 12.5, color: "rgba(255,255,255,0.55)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                    {t({ ar: "إزالة", en: "Remove" })}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button onClick={startEnroll} disabled={stage === "loading"} className="btn-red"
            style={{ justifyContent: "center", opacity: stage === "loading" ? 0.6 : 1 }}>
            <span>{stage === "loading" ? "…" : verified.length === 0
              ? t({ ar: "تفعيل التحقّق بخطوتين", en: "Enable two-step verification" })
              : t({ ar: "إضافة جهاز آخر", en: "Add another device" })}</span>
          </button>
        </>
      )}

      {/* ── enrollment dialog ── */}
      {(stage === "showing_qr" || stage === "verifying") && (
        <div>
          <ol className="text-white/70" style={{ fontSize: 13.5, lineHeight: 2, paddingInlineStart: 20, marginBottom: 12 }}>
            <li>{t({ ar: "افتح تطبيق المصادقة (Google Authenticator أو ما شابه).", en: "Open your authenticator app (Google Authenticator or similar)." })}</li>
            <li>{t({ ar: "امسح رمز QR أدناه، أو أدخل المفتاح يدويًا.", en: "Scan the QR below, or enter the key manually." })}</li>
            <li>{t({ ar: "أدخل الرمز المكوَّن من 6 أرقام لتأكيد التفعيل.", en: "Enter the 6-digit code to confirm." })}</li>
          </ol>

          {qr && (
            <div style={{ background: "#fff", padding: 10, borderRadius: 4, width: "fit-content", margin: "0 auto 14px" }}
              dangerouslySetInnerHTML={{ __html: qr }} />
          )}

          {secret && (
            <div style={{ marginBottom: 14 }}>
              <div className="f-sans" style={{ fontSize: 11.5, letterSpacing: 1.4, color: "rgba(255,255,255,0.45)", textTransform: "uppercase", marginBottom: 5 }}>
                {t({ ar: "المفتاح اليدوي", en: "Manual key" })}
              </div>
              <code dir="ltr" style={{ display: "block", fontSize: 13, wordBreak: "break-all", background: "rgba(255,255,255,0.05)", padding: "9px 12px", borderRadius: 3, color: "#e5e5e5" }}>
                {secret}
              </code>
              <p className="text-white/40" style={{ fontSize: 12, marginTop: 6 }}>
                {t({ ar: "يظهر مرة واحدة فقط، ولا يُحفَظ لدينا.", en: "Shown once only, and not stored by us." })}
              </p>
            </div>
          )}

          <label htmlFor="mfa-code" className="f-sans" style={{ display: "block", fontSize: 12.5, color: "rgba(255,255,255,0.7)", marginBottom: 6 }}>
            {t({ ar: "الرمز (6 أرقام)", en: "Code (6 digits)" })}
          </label>
          <input id="mfa-code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            style={{ width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 3, padding: "12px 15px", color: "#fff", fontSize: 19, letterSpacing: 6, textAlign: "center", outline: "none" }} />

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button onClick={submitCode} disabled={code.length !== 6 || stage === "verifying"} className="btn-red"
              style={{ flex: 1, justifyContent: "center", opacity: code.length !== 6 || stage === "verifying" ? 0.55 : 1 }}>
              <span>{stage === "verifying" ? "…" : t({ ar: "تأكيد", en: "Confirm" })}</span>
            </button>
            <button onClick={() => { clearEnrollment(); setStage("idle"); setErr(""); }} className="f-sans"
              style={{ padding: "0 18px", fontSize: 13.5, color: "rgba(255,255,255,0.6)", background: "none", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 3, cursor: "pointer" }}>
              {t({ ar: "إلغاء", en: "Cancel" })}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
