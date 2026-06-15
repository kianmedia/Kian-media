"use client";
// Account-status gates: blocked = full-stop screen; inactive = read-only banner.
import { useI18n } from "@/lib/i18n";
import { logout } from "@/lib/portal/auth";

const WA = "https://wa.me/966503422999";

export function BlockedScreen() {
  const { t } = useI18n();
  return (
    <div className="mx-auto text-center" style={{ maxWidth: "460px", padding: "60px 0 100px" }}>
      <div style={{ width: "64px", height: "64px", margin: "0 auto 24px", borderRadius: "50%", background: "rgba(227,30,36,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E31E24" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10" /><path d="M4.9 4.9l14.2 14.2" /></svg>
      </div>
      <h2 className="editorial text-white" style={{ fontSize: "26px", marginBottom: "12px" }}>
        {t({ ar: "الحساب موقوف", en: "Account Suspended" })}
      </h2>
      <p className="text-white/55" style={{ fontSize: "14.5px", lineHeight: 1.85, marginBottom: "28px" }}>
        {t({
          ar: "تم إيقاف هذا الحساب. للاستفسار أو إعادة التفعيل تواصل مع فريق كيان ميديا.",
          en: "This account has been suspended. Please contact the Kian Media team to inquire or reactivate.",
        })}
      </p>
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <a href={WA} target="_blank" rel="noopener noreferrer" className="btn-wa" style={{ justifyContent: "center" }}>
          <span>{t({ ar: "تواصل عبر واتساب", en: "Contact on WhatsApp" })}</span>
        </a>
        <button onClick={() => { void logout().then(() => window.location.reload()); }} className="btn-ghost" style={{ justifyContent: "center" }}>
          <span>{t({ ar: "تسجيل الخروج", en: "Sign Out" })}</span>
        </button>
      </div>
    </div>
  );
}

export function InactiveBanner() {
  const { t } = useI18n();
  return (
    <div className="max-w-5xl mx-auto px-5 sm:px-6 mb-8">
      <div className="f-sans" style={{ padding: "13px 16px", fontSize: "13px", color: "#ffd28a", background: "rgba(255,166,0,0.08)", border: "1px solid rgba(255,166,0,0.3)", borderRadius: "3px", lineHeight: 1.7 }}>
        {t({
          ar: "حسابك في وضع القراءة فقط حالياً — يمكنك تصفح بياناتك دون إجراء تعديلات. للاستفسار تواصل مع كيان ميديا.",
          en: "Your account is currently read-only — you can browse your data but not make changes. Contact Kian Media for details.",
        })}
      </div>
    </div>
  );
}
