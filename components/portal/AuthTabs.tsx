"use client";
// ════════════════════════════════════════════════════════════════════════
// Kian Portal — auth gate: login tab + active signup tab + confirm-email
// state. Email confirmation is ON, so signup normally ends in "check your
// inbox"; signup profile fields are stashed locally and synced to the
// profile row on the first confirmed login (see PortalShell).
// ════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { login, signup, requestPasswordReset, type AuthErrorCode } from "@/lib/portal/auth";
import { isValidMobile } from "@/lib/submitForm";
import { stashPendingProfile } from "@/components/portal/PortalShell";

// Kian sales/support WhatsApp (Saudi number, wa.me intl format) + prefilled help text.
const WA_SUPPORT_URL =
  "https://wa.me/966503422999?text=" +
  encodeURIComponent("مرحباً كيان، أحتاج مساعدة في الدخول إلى بوابة العملاء.");

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "3px",
  padding: "13px 15px",
  color: "#fff",
  fontSize: "15px",
  outline: "none",
};

function FieldLabel({ children, htmlFor, required }: { children: React.ReactNode; htmlFor: string; required?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="f-sans" style={{ display: "block", marginBottom: "7px", fontSize: "12.5px", fontWeight: 600, color: "rgba(255,255,255,0.7)" }}>
      {children}{required && <span style={{ color: "#E31E24", marginInlineStart: "4px" }}>*</span>}
    </label>
  );
}

export default function AuthTabs({ onAuthed }: { onAuthed: () => void }) {
  const { t, isAr } = useI18n();
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null);
  // Forgot-password feedback (kept separate from login errors).
  const [reset, setReset] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // login fields
  const [lEmail, setLEmail] = useState("");
  const [lPass, setLPass] = useState("");
  // signup fields
  const [sName, setSName] = useState("");
  const [sCompany, setSCompany] = useState("");
  const [sMobile, setSMobile] = useState("");
  const [sEmail, setSEmail] = useState("");
  const [sPass, setSPass] = useState("");
  const [sPass2, setSPass2] = useState("");
  const [sMarketing, setSMarketing] = useState(false);
  const [sConsent, setSConsent] = useState(false);

  const authError = (code: AuthErrorCode, raw: string): string => {
    switch (code) {
      case "invalid_credentials":  return t({ ar: "بيانات الدخول غير صحيحة", en: "Invalid email or password" });
      case "email_not_confirmed":  return t({ ar: "فضلاً فعّل بريدك الإلكتروني أولاً من رابط التحقق المرسل لك.", en: "Please verify your email first via the verification link we sent you." });
      case "user_already_exists":  return t({ ar: "هذا البريد مسجّل مسبقاً — جرّب تسجيل الدخول", en: "This email is already registered — try signing in" });
      case "weak_password":        return t({ ar: "كلمة المرور ضعيفة — استخدم ٨ أحرف على الأقل", en: "Weak password — use at least 8 characters" });
      case "rate_limited":         return t({ ar: "محاولات كثيرة — انتظر دقيقة ثم أعد المحاولة", en: "Too many attempts — wait a minute and try again" });
      case "not_configured":       return t({ ar: "البوابة غير مهيأة حالياً", en: "Portal is not configured" });
      default:                     return raw || t({ ar: "حدث خطأ غير متوقع", en: "Unexpected error" });
    }
  };

  async function onLogin() {
    setErr("");
    if (!lEmail || !lPass) { setErr(t({ ar: "أدخل البريد وكلمة المرور", en: "Enter email and password" })); return; }
    setBusy(true);
    const r = await login(lEmail.trim(), lPass);
    setBusy(false);
    if (!r.ok) { setErr(authError(r.code, r.error)); return; }
    onAuthed();
  }

  async function onForgot() {
    setErr(""); setReset(null);
    if (!lEmail.trim()) {
      setReset({ kind: "err", text: t({ ar: "فضلاً أدخل البريد الإلكتروني أولاً.", en: "Please enter your email first." }) });
      return;
    }
    setBusy(true);
    const redirectTo = typeof window !== "undefined" ? `${window.location.origin}/client-portal/reset-password` : undefined;
    let r: Awaited<ReturnType<typeof requestPasswordReset>>;
    try { r = await requestPasswordReset(lEmail.trim(), redirectTo); }
    catch { r = { ok: true }; } // network hiccup → still show generic message (no enumeration)
    setBusy(false);
    if (!r.ok && r.code === "rate_limited") {
      setReset({ kind: "err", text: authError("rate_limited", "") });
      return;
    }
    // Always show the same generic message — never reveal whether the email exists.
    setReset({ kind: "ok", text: t({
      ar: "تم إرسال رابط إعادة تعيين كلمة المرور إلى بريدك الإلكتروني إذا كان الحساب موجودًا.",
      en: "If an account exists, a password reset link has been sent to your email.",
    }) });
  }

  async function onSignup() {
    setErr("");
    if (!sName.trim()) { setErr(t({ ar: "أدخل الاسم الكامل", en: "Enter your full name" })); return; }
    if (!sEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sEmail.trim())) {
      setErr(t({ ar: "البريد الإلكتروني غير صحيح", en: "Invalid email address" })); return;
    }
    if (!sMobile.trim()) { setErr(t({ ar: "رقم الجوال مطلوب", en: "Mobile number is required" })); return; }
    if (!isValidMobile(sMobile)) { setErr(t({ ar: "رقم الجوال غير صحيح — استخدم رقماً سعودياً (٠٥xxxxxxxx) أو دولياً", en: "Invalid mobile number — use a Saudi (05xxxxxxxx) or international format" })); return; }
    if (sPass.length < 8) { setErr(t({ ar: "كلمة المرور ٨ أحرف على الأقل", en: "Password must be at least 8 characters" })); return; }
    if (sPass !== sPass2) { setErr(t({ ar: "كلمتا المرور غير متطابقتين", en: "Passwords do not match" })); return; }
    if (!sConsent) { setErr(t({ ar: "يجب الموافقة على سياسة الخصوصية وشروط الاستخدام للمتابعة", en: "You must accept the Privacy Policy and Terms to continue" })); return; }

    setBusy(true);
    // Stash profile fields tied to this signup email; synced only into the same
    // account after its first confirmed login (see PortalShell).
    stashPendingProfile(sEmail.trim(), {
      full_name: sName.trim(),
      company: sCompany.trim() || null as unknown as string,
      mobile: sMobile.trim() || null as unknown as string,
      marketing_opt_in: sMarketing,
    });
    const nowIso = new Date().toISOString();
    // After confirming, the email link returns the user to the portal sign-in.
    const confirmRedirect = typeof window !== "undefined" ? `${window.location.origin}/client-portal` : undefined;
    const r = await signup(sEmail.trim(), sPass, {
      full_name: sName.trim(), company: sCompany.trim(), mobile: sMobile.trim(), marketing_opt_in: sMarketing,
      // Consent record (durable DB columns proposed in S5-DB addendum; stored in
      // GoTrue user metadata for now so it's captured at signup time).
      privacy_accepted_at: nowIso, terms_accepted_at: nowIso, consent_version: "2026-06-14",
    }, confirmRedirect);
    setBusy(false);
    if (!r.ok) { setErr(authError(r.code, r.error)); return; }
    if (r.needsConfirmation) { setConfirmEmailFor(sEmail.trim()); return; }
    onAuthed(); // autoconfirm projects land here
  }

  // ─── Confirm-email state ───
  if (confirmEmailFor) {
    return (
      <div className="mx-auto text-center" style={{ maxWidth: "460px", padding: "40px 0 80px" }}>
        <div style={{ width: "64px", height: "64px", margin: "0 auto 24px", borderRadius: "50%", background: "rgba(227,30,36,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E31E24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><path d="M22 6l-10 7L2 6" /></svg>
        </div>
        <h2 className="editorial text-white" style={{ fontSize: "26px", marginBottom: "12px" }}>
          {t({ ar: "تحقق من بريدك الإلكتروني", en: "Check your email" })}
        </h2>
        <p className="text-white/75" style={{ fontSize: "15px", lineHeight: 1.9, marginBottom: "18px" }}>
          {t({
            ar: "تم إنشاء الحساب. فضلاً تحقق من بريدك الإلكتروني لتفعيل الدخول إلى بوابة العملاء.",
            en: "Account created. Please check your email to verify and unlock access to the client portal.",
          })}
        </p>
        <p className="text-white/60" style={{ fontSize: "14.5px", lineHeight: 1.8, marginBottom: "8px" }}>
          {t({ ar: "أرسلنا رابط تفعيل إلى:", en: "We sent a confirmation link to:" })}
        </p>
        <p className="f-sans text-white" style={{ fontSize: "15px", direction: "ltr", marginBottom: "24px" }}>{confirmEmailFor}</p>
        <p className="text-white/45" style={{ fontSize: "13px", lineHeight: 1.8, marginBottom: "28px" }}>
          {t({
            ar: "افتح الرابط لتفعيل حسابك ثم عُد لتسجيل الدخول. تحقق من مجلد الرسائل غير المرغوبة إن لم تجده.",
            en: "Open the link to activate your account, then come back and sign in. Check spam if you can't find it.",
          })}
        </p>
        <button onClick={() => { setConfirmEmailFor(null); setTab("login"); }} className="btn-red" style={{ justifyContent: "center" }}>
          <span>{t({ ar: "العودة لتسجيل الدخول", en: "Back to Sign In" })}</span>
        </button>
      </div>
    );
  }

  // ─── Login / Signup tabs ───
  return (
    <div className="mx-auto" style={{ maxWidth: "460px", paddingBottom: "60px" }}>
      <div className="text-center mb-8">
        <div className="eyebrow mb-5 mx-auto">{t({ ar: "بوابة العملاء", en: "Client Portal" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(30px,5vw,44px)", lineHeight: 1.25, marginBottom: "10px" }}>
          {tab === "login" ? t({ ar: "تسجيل الدخول", en: "Sign In" }) : t({ ar: "إنشاء حساب", en: "Create Account" })}
        </h1>
        <p className="text-white/55" style={{ fontSize: "14.5px", lineHeight: 1.7 }}>
          {t({ ar: "تابع طلباتك ومشاريعك مع كيان ميديا.", en: "Track your requests and projects with Kian Media." })}
        </p>
      </div>

      {/* Tab switch */}
      <div className="flex mb-7" style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", overflow: "hidden" }}>
        {(["login", "signup"] as const).map((k) => (
          <button key={k} onClick={() => { setTab(k); setErr(""); setReset(null); }}
            className="f-sans"
            style={{
              flex: 1, padding: "12px 0", fontSize: "12px", letterSpacing: "2px", fontWeight: 600, textTransform: "uppercase",
              cursor: "pointer", border: "none", transition: "all 0.3s",
              background: tab === k ? "rgba(227,30,36,0.14)" : "transparent",
              color: tab === k ? "#fff" : "rgba(255,255,255,0.45)",
            }}>
            {k === "login" ? t({ ar: "دخول", en: "Sign In" }) : t({ ar: "حساب جديد", en: "Sign Up" })}
          </button>
        ))}
      </div>

      {tab === "login" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <FieldLabel htmlFor="le" required>{t({ ar: "البريد الإلكتروني", en: "Email" })}</FieldLabel>
            <input id="le" type="email" dir="ltr" value={lEmail} onChange={(e) => setLEmail(e.target.value)} style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter") void onLogin(); }} />
          </div>
          <div>
            <FieldLabel htmlFor="lp" required>{t({ ar: "كلمة المرور", en: "Password" })}</FieldLabel>
            <input id="lp" type="password" dir="ltr" value={lPass} onChange={(e) => setLPass(e.target.value)} style={inputStyle}
              onKeyDown={(e) => { if (e.key === "Enter") void onLogin(); }} />
          </div>
          {err && <ErrorBox msg={err} />}
          <button onClick={() => void onLogin()} disabled={busy} className="btn-red" style={{ width: "100%", justifyContent: "center", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
            <span>{busy ? "..." : t({ ar: "دخول", en: "Sign In" })}</span>
          </button>
          <div className="text-center" style={{ display: "flex", flexDirection: "column", gap: "9px", marginTop: "2px" }}>
            <div className="f-sans" style={{ fontSize: "12.5px", color: "rgba(255,255,255,0.45)", lineHeight: 1.7 }}>
              <button type="button" onClick={() => void onForgot()} disabled={busy}
                style={{ background: "none", border: "none", padding: 0, color: "rgba(255,255,255,0.75)", textDecoration: "underline", fontSize: "12.5px", cursor: busy ? "wait" : "pointer", fontFamily: "inherit" }}>
                {t({ ar: "نسيت كلمة المرور؟", en: "Forgot your password?" })}
              </button>
              <span style={{ margin: "0 8px", color: "rgba(255,255,255,0.25)" }}>·</span>
              <a href={WA_SUPPORT_URL} target="_blank" rel="noopener noreferrer"
                style={{ color: "#25D366", textDecoration: "none", fontSize: "12.5px" }}>
                {t({ ar: "تواصل معنا عبر واتساب", en: "Contact us on WhatsApp" })}
              </a>
            </div>
            {reset && (
              <div className="f-sans" style={{ fontSize: "12.5px", lineHeight: 1.6, color: reset.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>
                {reset.text}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          <div>
            <FieldLabel htmlFor="sn" required>{t({ ar: "الاسم الكامل", en: "Full Name" })}</FieldLabel>
            <input id="sn" value={sName} onChange={(e) => setSName(e.target.value)} style={inputStyle} />
          </div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div>
              <FieldLabel htmlFor="sc">{t({ ar: "الشركة / الجهة", en: "Company" })}</FieldLabel>
              <input id="sc" value={sCompany} onChange={(e) => setSCompany(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <FieldLabel htmlFor="sm" required>{t({ ar: "رقم الجوال", en: "Mobile" })}</FieldLabel>
              <input id="sm" type="tel" dir="ltr" inputMode="tel" placeholder="05XXXXXXXX" value={sMobile} onChange={(e) => setSMobile(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div>
            <FieldLabel htmlFor="se" required>{t({ ar: "البريد الإلكتروني", en: "Email" })}</FieldLabel>
            <input id="se" type="email" dir="ltr" value={sEmail} onChange={(e) => setSEmail(e.target.value)} style={inputStyle} />
          </div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
            <div>
              <FieldLabel htmlFor="sp" required>{t({ ar: "كلمة المرور", en: "Password" })}</FieldLabel>
              <input id="sp" type="password" dir="ltr" value={sPass} onChange={(e) => setSPass(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <FieldLabel htmlFor="sp2" required>{t({ ar: "تأكيد كلمة المرور", en: "Confirm Password" })}</FieldLabel>
              <input id="sp2" type="password" dir="ltr" value={sPass2} onChange={(e) => setSPass2(e.target.value)} style={inputStyle} />
            </div>
          </div>

          <label htmlFor="smk" className="f-sans" style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "13px", color: "rgba(255,255,255,0.6)", lineHeight: 1.6 }}>
            <input id="smk" type="checkbox" checked={sMarketing} onChange={(e) => setSMarketing(e.target.checked)}
              style={{ width: "16px", height: "16px", marginTop: "2px", accentColor: "#E31E24", cursor: "pointer", flexShrink: 0 }} />
            {t({
              ar: "أوافق على استلام العروض والأخبار التسويقية من كيان ميديا (اختياري).",
              en: "I agree to receive marketing offers and news from Kian Media (optional).",
            })}
          </label>

          {/* Required consent — signup is blocked until checked */}
          <label htmlFor="sconsent" className="f-sans" style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", fontSize: "13px", color: "rgba(255,255,255,0.7)", lineHeight: 1.7 }}>
            <input id="sconsent" type="checkbox" checked={sConsent} onChange={(e) => setSConsent(e.target.checked)}
              style={{ width: "16px", height: "16px", marginTop: "2px", accentColor: "#E31E24", cursor: "pointer", flexShrink: 0 }} />
            <span>
              {isAr ? (
                <>أوافق على <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "#E31E24", textDecoration: "underline" }}>سياسة الخصوصية</a> و<a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#E31E24", textDecoration: "underline" }}>شروط استخدام</a> بوابة كيان.</>
              ) : (
                <>I agree to the <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "#E31E24", textDecoration: "underline" }}>Privacy Policy</a> and <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "#E31E24", textDecoration: "underline" }}>Client Portal Terms</a>.</>
              )}
              <span style={{ color: "#E31E24", marginInlineStart: "4px" }}>*</span>
            </span>
          </label>

          {err && <ErrorBox msg={err} />}
          <button onClick={() => void onSignup()} disabled={busy} className="btn-red" style={{ width: "100%", justifyContent: "center", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}>
            <span>{busy ? "..." : t({ ar: "إنشاء الحساب", en: "Create Account" })}</span>
          </button>
          <p className="f-sans text-center" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.35)", lineHeight: 1.7 }}>
            {t({
              ar: "بإنشاء الحساب توافق على تواصلنا معك بخصوص طلباتك.",
              en: "By creating an account you agree we may contact you about your requests.",
            })}
          </p>
        </div>
      )}

      {/* Legal links — visible on both tabs */}
      <p className="f-sans text-center" style={{ marginTop: "22px", fontSize: "11px", color: "rgba(255,255,255,0.4)", letterSpacing: "0.3px" }}>
        <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>{t({ ar: "سياسة الخصوصية", en: "Privacy Policy" })}</a>
        <span style={{ margin: "0 8px", color: "rgba(255,255,255,0.25)" }}>·</span>
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "none" }}>{t({ ar: "شروط الاستخدام", en: "Terms" })}</a>
      </p>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="f-sans" style={{ padding: "12px 14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>
      {msg}
    </div>
  );
}
