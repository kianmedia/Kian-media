"use client";
import { useI18n } from "@/lib/i18n";

/**
 * Shared success card showing the reference number (Issue 11).
 * Used by all three form pages for consistency.
 */
export default function SuccessCard({ reference }: { reference: string }) {
  const { t } = useI18n();
  const WA = "+966503422999";
  return (
    <div className="text-center" style={{ padding: "50px 30px", background: "rgba(227,30,36,0.05)", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "4px" }}>
      <div style={{ width: "64px", height: "64px", margin: "0 auto 24px", borderRadius: "50%", background: "rgba(227,30,36,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#E31E24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
      </div>

      <h3 className="editorial text-white" style={{ fontSize: "26px", marginBottom: "10px" }}>{t({ ar: "شكراً لك", en: "Thank You" })}</h3>
      <p className="text-white/65" style={{ fontSize: "15px", lineHeight: 1.7, maxWidth: "440px", margin: "0 auto 22px" }}>
        {t({ ar: "تم استلام طلبك بنجاح.", en: "Your request has been received successfully." })}
      </p>

      {/* Reference number */}
      <div style={{ display: "inline-block", padding: "14px 28px", marginBottom: "22px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "4px" }}>
        <div className="f-sans" style={{ fontSize: "11px", letterSpacing: "2px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginBottom: "6px" }}>
          {t({ ar: "رقم الطلب", en: "Reference Number" })}
        </div>
        <div className="f-display" style={{ fontSize: "22px", color: "#E31E24", letterSpacing: "2px", direction: "ltr" }}>{reference}</div>
      </div>

      <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.7, maxWidth: "420px", margin: "0 auto 20px" }}>
        {t({ ar: "سيتم التواصل معك خلال ساعات العمل الرسمية.", en: "Our team will contact you during business hours." })}
      </p>

      {/* WhatsApp */}
      <a href={`https://wa.me/966503422999`} target="_blank" rel="noopener noreferrer"
        className="inline-flex items-center gap-2" style={{ fontSize: "14px", fontWeight: 600, color: "#25D366", direction: "ltr" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14.4c-.3-.1-1.7-.8-2-1-.3-.1-.5-.1-.7.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.6-.8-2.7-1.4-3.8-3.2-.3-.5.3-.5.8-1.5.1-.2 0-.4 0-.5 0-.1-.7-1.7-.9-2.3-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.1 3.2 5.1 4.5 1.9.8 2.6.9 3.5.7.6-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.3zM12 2C6.5 2 2 6.5 2 12c0 1.7.5 3.4 1.3 4.9L2 22l5.2-1.4c1.5.8 3.1 1.2 4.8 1.2 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
        {WA}
      </a>
    </div>
  );
}
