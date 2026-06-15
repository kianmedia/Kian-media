"use client";
// ════════════════════════════════════════════════════════════════════════
// /client-portal/reset-password — landing page for the Supabase recovery email.
// GoTrue's recovery link redirects here with a recovery token in the URL hash
// (#access_token=…&type=recovery). We read that token, let the user set a new
// password (PUT /auth/v1/user), then send them back to sign in. This route
// bypasses the PortalShell auth gate (see PortalShell.tsx) because there is no
// session yet — only the one-time recovery token.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { updatePasswordWithToken } from "@/lib/portal/auth";

const inputStyle: React.CSSProperties = {
  width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "3px", padding: "13px 15px", color: "#fff", fontSize: "15px", outline: "none",
};

export default function ResetPasswordPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [linkBad, setLinkBad] = useState(false);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  // Read the recovery token from the URL hash (or query, defensively).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hp = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const sp = new URLSearchParams(window.location.search);
    const get = (k: string) => hp.get(k) || sp.get(k);
    if (get("error") || get("error_description")) { setLinkBad(true); return; }
    const at = get("access_token");
    const type = get("type");
    if (at && (!type || type === "recovery")) {
      setToken(at);
      // Strip the token from the visible URL (don't leave it in history).
      try { window.history.replaceState(null, "", window.location.pathname); } catch { /* noop */ }
    } else {
      setLinkBad(true);
    }
  }, []);

  async function submit() {
    setErr("");
    if (pass.length < 8) { setErr(t({ ar: "كلمة المرور ٨ أحرف على الأقل", en: "Password must be at least 8 characters" })); return; }
    if (pass !== pass2) { setErr(t({ ar: "كلمتا المرور غير متطابقتين", en: "Passwords do not match" })); return; }
    if (!token) { setLinkBad(true); return; }
    setBusy(true);
    const r = await updatePasswordWithToken(token, pass);
    setBusy(false);
    if (!r.ok) {
      setErr(t({ ar: "تعذّر تحديث كلمة المرور — قد يكون الرابط منتهي الصلاحية. اطلب رابطاً جديداً.", en: "Couldn't update the password — the link may have expired. Request a new one." }));
      return;
    }
    setDone(true);
    setTimeout(() => router.push("/client-portal"), 1800);
  }

  return (
    <div className="mx-auto" style={{ maxWidth: "460px", paddingBottom: "80px" }}>
      <div className="text-center mb-8">
        <div className="eyebrow mb-5 mx-auto">{t({ ar: "بوابة العملاء", en: "Client Portal" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(28px,5vw,40px)", lineHeight: 1.25, marginBottom: "10px" }}>
          {t({ ar: "إعادة تعيين كلمة المرور", en: "Reset Password" })}
        </h1>
      </div>

      {done ? (
        <div className="text-center">
          <p className="f-sans" style={{ fontSize: "14px", color: "#7CFC9A", lineHeight: 1.8, marginBottom: "20px" }}>
            {t({ ar: "تم تحديث كلمة المرور بنجاح. سيتم تحويلك لتسجيل الدخول...", en: "Password updated. Redirecting you to sign in..." })}
          </p>
          <button onClick={() => router.push("/client-portal")} className="btn-red" style={{ justifyContent: "center" }}>
            <span>{t({ ar: "الذهاب لتسجيل الدخول", en: "Go to Sign In" })}</span>
          </button>
        </div>
      ) : linkBad ? (
        <div className="text-center">
          <p className="text-white/60" style={{ fontSize: "14.5px", lineHeight: 1.8, marginBottom: "24px" }}>
            {t({ ar: "رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رابطاً جديداً من صفحة الدخول.", en: "This reset link is invalid or has expired. Request a new one from the sign-in page." })}
          </p>
          <button onClick={() => router.push("/client-portal")} className="btn-red" style={{ justifyContent: "center" }}>
            <span>{t({ ar: "العودة لتسجيل الدخول", en: "Back to Sign In" })}</span>
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <p className="text-white/55 text-center" style={{ fontSize: "14px", lineHeight: 1.7, marginBottom: "4px" }}>
            {t({ ar: "أدخل كلمة المرور الجديدة لحسابك.", en: "Enter a new password for your account." })}
          </p>
          <div>
            <label htmlFor="np" className="f-sans" style={{ display: "block", marginBottom: "7px", fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
              {t({ ar: "كلمة المرور الجديدة", en: "New Password" })}
            </label>
            <input id="np" type="password" dir="ltr" value={pass} onChange={(e) => setPass(e.target.value)} style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
          </div>
          <div>
            <label htmlFor="np2" className="f-sans" style={{ display: "block", marginBottom: "7px", fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
              {t({ ar: "تأكيد كلمة المرور", en: "Confirm Password" })}
            </label>
            <input id="np2" type="password" dir="ltr" value={pass2} onChange={(e) => setPass2(e.target.value)} style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
          </div>
          {err && (
            <div className="f-sans" style={{ padding: "12px 14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>
              {err}
            </div>
          )}
          <button onClick={() => void submit()} disabled={busy} className="btn-red" style={{ width: "100%", justifyContent: "center", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
            <span>{busy ? "..." : t({ ar: "تحديث كلمة المرور", en: "Update Password" })}</span>
          </button>
        </div>
      )}
    </div>
  );
}
