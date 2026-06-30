"use client";
// ════════════════════════════════════════════════════════════════════════
// Client/lead Quote Requests — form + success card + "my requests" list.
// Source of truth = Supabase quote_requests; Google Sheet mirror is an
// optional backup (handled in lib/portal/leads.createQuote). On success the
// card auto-scrolls into view so the reference number is immediately seen.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { Label, TextField, TextArea, SelectField } from "@/components/forms/Field";
import { listMyQuotes, createQuote, type CreateQuoteResult } from "@/lib/portal/leads";
import { SERVICES, BUDGETS, CONTACT_PREFS, QUOTE_STATUS_LABELS, labelFor } from "@/components/portal/quoteOptions";
import type { QuoteRequest } from "@/lib/portal/types";

export default function ClientQuotes() {
  const { t, isAr } = useI18n();
  const { readOnly, profile } = usePortal();

  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [listPhase, setListPhase] = useState<"loading" | "error" | "ready">("loading");
  const [listErr, setListErr] = useState("");

  const [services, setServices] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState(profile.mobile || "");   // prefilled from profile, editable — drives WhatsApp/SMS notifications
  const [preferredDate, setPreferredDate] = useState("");
  const [contactPref, setContactPref] = useState("");
  const [notes, setNotes] = useState("");
  const [waConsent, setWaConsent] = useState(false);   // explicit per-request WhatsApp consent

  const [sending, setSending] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [success, setSuccess] = useState<CreateQuoteResult | null>(null);
  const successRef = useRef<HTMLDivElement>(null);

  async function loadQuotes() {
    setListPhase("loading");
    const r = await listMyQuotes();
    if (!r.ok) { setListErr(r.error); setListPhase("error"); return; }
    setQuotes(r.data);
    setListPhase("ready");
  }
  useEffect(() => { void loadQuotes(); }, []);

  // Scroll the success card into view so the reference is immediately visible.
  useEffect(() => {
    if (success) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => successRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 120);
    }
  }, [success]);

  function toggleService(en: string) {
    setServices((prev) => prev.includes(en) ? prev.filter((s) => s !== en) : [...prev, en]);
  }
  function resetForm() {
    setServices([]); setTitle(""); setDescription(""); setBudget("");
    setCity(""); setPhone(profile.mobile || ""); setPreferredDate(""); setContactPref(""); setNotes(""); setWaConsent(false);
  }

  async function submit() {
    setFormErr("");
    if (services.length === 0) { setFormErr(t({ ar: "اختر خدمة واحدة على الأقل", en: "Select at least one service" })); return; }
    if (!description.trim()) { setFormErr(t({ ar: "اكتب وصفاً موجزاً لمشروعك", en: "Add a brief project description" })); return; }
    const phoneDigits = phone.replace(/[^\d]/g, "");
    if (phoneDigits.length < 9) { setFormErr(t({ ar: "أدخل رقم جوال صحيح لاستقبال إشعارات طلبك.", en: "Enter a valid mobile number to receive updates on your request." })); return; }

    const extras: string[] = [];
    if (title.trim()) extras.push(`${t({ ar: "العنوان", en: "Title" })}: ${title.trim()}`);
    if (contactPref) extras.push(`${t({ ar: "طريقة التواصل المفضلة", en: "Preferred Contact" })}: ${labelFor(CONTACT_PREFS, contactPref, isAr)}`);
    if (notes.trim()) extras.push(`${t({ ar: "ملاحظات", en: "Notes" })}: ${notes.trim()}`);
    const fullDescription = extras.length ? `${description.trim()}\n\n— ${extras.join("\n")}` : description.trim();

    setSending(true);
    const r = await createQuote({
      services,
      description: fullDescription,
      budget_range: budget || undefined,
      city: city.trim() || undefined,
      preferred_date: preferredDate || undefined,
      // Contact pulled from the logged-in profile → matches the hero form's
      // payload so the Apps Script email notification fires the same way.
      contact: {
        fullName: profile.full_name || "",
        company: profile.company || "",
        mobile: phone.trim() || profile.mobile || "",
        email: profile.email || "",
        preferredContact: contactPref || undefined,
      },
      whatsappConsent: waConsent,
      language: isAr ? "AR" : "EN",
      // Title / contact preference / notes are already folded into the
      // description above, so the Sheet payload stays exactly hero-shaped.
    });
    setSending(false);

    if (!r.ok) { setFormErr(t({ ar: "تعذّر إرسال الطلب: ", en: "Couldn't submit: " }) + r.error); return; }
    setSuccess(r.data);
    resetForm();
    void loadQuotes();
  }

  // ─── Success state (auto-scrolled into view) ───
  if (success) {
    const ref = success.row.reference || "";
    const mirroredOk = success.sheetMirror === "ok";
    // Defense-in-depth: hostname must be localhost AND the build must be non-production.
    // Production builds (NODE_ENV=production) can never render this panel.
    const isLocal = process.env.NODE_ENV !== "production"
      && typeof window !== "undefined"
      && /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    return (
      <div ref={successRef} className="text-center" style={{ padding: "44px 28px", background: "rgba(227,30,36,0.05)", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "4px", maxWidth: "520px", margin: "0 auto", scrollMarginTop: "120px" }}>
        <div style={{ width: "60px", height: "60px", margin: "0 auto 22px", borderRadius: "50%", background: "rgba(227,30,36,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#E31E24" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
        </div>
        <h2 className="editorial text-white" style={{ fontSize: "24px", marginBottom: "10px" }}>{t({ ar: "تم استلام طلبك", en: "Request Received" })}</h2>
        <p className="text-white/65" style={{ fontSize: "14.5px", lineHeight: 1.7, marginBottom: "18px" }}>
          {t({ ar: "سيتواصل معك فريق كيان ميديا قريباً خلال ساعات العمل.", en: "The Kian Media team will reach out soon during business hours." })}
        </p>
        {ref && (
          <div style={{ display: "inline-block", padding: "12px 24px", marginBottom: "18px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "4px" }}>
            <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "2px", color: "rgba(255,255,255,0.5)", textTransform: "uppercase", marginBottom: "5px" }}>{t({ ar: "رقم الطلب", en: "Reference Number" })}</div>
            <div className="f-display" style={{ fontSize: "22px", color: "#E31E24", letterSpacing: "2px", direction: "ltr" }}>{ref}</div>
          </div>
        )}
        {/* Request itself is always saved to Supabase (source of truth) */}
        <div className="f-sans" style={{ fontSize: "11px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#7CFC9A", marginBottom: "12px" }}>
          ✓ {t({ ar: "تم حفظ الطلب", en: "Request Saved" })}
        </div>
        {/* Honest external-notification status (only "ok" when the call actually left the browser) */}
        {mirroredOk ? (
          <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(124,252,154,0.75)", lineHeight: 1.6, marginBottom: "18px" }}>
            {t({ ar: "تم إرسال نسخة التنبيه الخارجي لفريق كيان.", en: "An external alert copy was sent to the Kian team." })}
          </p>
        ) : (
          <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,210,138,0.85)", lineHeight: 1.6, marginBottom: "18px" }}>
            {t({ ar: "تم حفظ الطلب، لكن لم يتم إرسال نسخة التنبيه الخارجي. سيتابع فريق كيان الطلب من لوحة الإدارة.", en: "Request saved, but the external alert copy wasn't sent. The Kian team will follow up from the admin dashboard." })}
          </p>
        )}
        {/* Hard local proof (localhost only — never shown in production) */}
        {isLocal && (
          <div className="f-sans" style={{ textAlign: "left", direction: "ltr", fontSize: "11px", lineHeight: 1.7, color: "rgba(255,255,255,0.6)", background: "rgba(0,0,0,0.45)", border: "1px dashed rgba(255,255,255,0.18)", borderRadius: "4px", padding: "12px 14px", marginBottom: "18px" }}>
            <div style={{ color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: "6px" }}>debug · localhost only</div>
            <div>endpoint present: <b>{String(success.debug.endpointPresent)}</b></div>
            <div>submitToSheets called: <b>{String(success.debug.submitCalled)}</b></div>
            <div>reference: <b>{success.debug.reference}</b></div>
            <div>source: <b>{success.debug.source}</b></div>
            <div>result: <b>{success.debug.resultType}</b></div>
          </div>
        )}
        <div>
          <button onClick={() => setSuccess(null)} className="btn-red" style={{ justifyContent: "center" }}>
            <span>{t({ ar: "طلب آخر / عرض طلباتي", en: "New Request / View Mine" })}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "طلبات السعر", en: "Quote Requests" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "اطلب عرض سعر", en: "Request a Quote" })}
        </h1>
      </div>

      {readOnly ? (
        <div className="f-sans" style={{ padding: "14px 16px", fontSize: "13px", color: "#ffd28a", background: "rgba(255,166,0,0.08)", border: "1px solid rgba(255,166,0,0.3)", borderRadius: "3px", marginBottom: "30px" }}>
          {t({ ar: "حسابك في وضع القراءة فقط — لا يمكن إرسال طلبات جديدة حالياً.", en: "Your account is read-only — new requests can't be submitted right now." })}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "18px", marginBottom: "44px" }}>
          <div>
            <Label required>{t({ ar: "الخدمة / الفئة", en: "Service / Category" })}</Label>
            <p className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.4)", marginBottom: "10px", marginTop: "-2px" }}>
              {t({ ar: "اختر خدمة واحدة أو أكثر", en: "Select one or more services" })}
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }} className="svc-grid">
              {SERVICES.map((s) => {
                const sel = services.includes(s.en);
                return (
                  <button key={s.en} type="button" onClick={() => toggleService(s.en)} className="f-sans"
                    style={{ textAlign: isAr ? "right" : "left", padding: "10px 13px", fontSize: "13px", cursor: "pointer", borderRadius: "3px", transition: "all 0.25s",
                      background: sel ? "rgba(227,30,36,0.1)" : "rgba(255,255,255,0.03)",
                      border: `1px solid ${sel ? "rgba(227,30,36,0.45)" : "rgba(255,255,255,0.1)"}`,
                      color: sel ? "#fff" : "rgba(255,255,255,0.6)", display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ width: "15px", height: "15px", flexShrink: 0, borderRadius: "2px", border: `1px solid ${sel ? "#E31E24" : "rgba(255,255,255,0.3)"}`, background: sel ? "#E31E24" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {sel && <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5"><path d="M20 6L9 17l-5-5" /></svg>}
                    </span>
                    {isAr ? s.ar : s.en}
                  </button>
                );
              })}
            </div>
          </div>

          <div><Label htmlFor="qt">{t({ ar: "عنوان المشروع", en: "Project Title" })}</Label>
            <TextField id="qt" value={title} onChange={setTitle} /></div>
          <div><Label htmlFor="qd" required>{t({ ar: "وصف المشروع", en: "Project Description" })}</Label>
            <TextArea id="qd" value={description} onChange={setDescription} rows={5} /></div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div><Label htmlFor="qb">{t({ ar: "نطاق الميزانية", en: "Budget Range" })}</Label>
              <SelectField id="qb" value={budget} onChange={setBudget} options={BUDGETS.map((b) => ({ value: b.en, label: isAr ? b.ar : b.en }))} /></div>
            <div><Label htmlFor="qc">{t({ ar: "المدينة", en: "City" })}</Label>
              <TextField id="qc" value={city} onChange={setCity} /></div>
          </div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div><Label htmlFor="qph" required>{t({ ar: "رقم الجوال", en: "Mobile Number" })}</Label>
              <TextField id="qph" type="tel" dir="ltr" value={phone} onChange={setPhone} placeholder="05XXXXXXXX" />
              <p className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", marginTop: "5px" }}>
                {t({ ar: "لإرسال إشعارات الواتساب والتواصل بخصوص طلبك.", en: "For WhatsApp updates and follow-up about your request." })}</p></div>
            <div><Label htmlFor="qcp">{t({ ar: "طريقة التواصل المفضلة", en: "Preferred Contact" })}</Label>
              <SelectField id="qcp" value={contactPref} onChange={setContactPref} options={CONTACT_PREFS.map((c) => ({ value: c.en, label: isAr ? c.ar : c.en }))} /></div>
          </div>
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div><Label htmlFor="qpd">{t({ ar: "التاريخ المفضّل", en: "Preferred Date" })}</Label>
              <TextField id="qpd" type="date" dir="ltr" value={preferredDate} onChange={setPreferredDate} /></div>
          </div>
          <div><Label htmlFor="qn">{t({ ar: "ملاحظات إضافية", en: "Additional Notes" })}</Label>
            <TextArea id="qn" value={notes} onChange={setNotes} rows={3} /></div>

          <label htmlFor="qwac" style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer", padding: "12px 14px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "4px" }}>
            <input id="qwac" type="checkbox" checked={waConsent} onChange={(e) => setWaConsent(e.target.checked)}
              style={{ marginTop: "2px", width: "16px", height: "16px", accentColor: "#E31E24", flexShrink: 0, cursor: "pointer" }} />
            <span className="f-sans" style={{ fontSize: "13px", lineHeight: 1.6, color: "rgba(255,255,255,0.75)" }}>
              {t({ ar: "أوافق على استلام تحديثات هذا الطلب عبر واتساب.", en: "I agree to receive updates about this request via WhatsApp." })}
            </span>
          </label>

          {formErr && <div className="f-sans" style={{ padding: "12px 14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{formErr}</div>}

          <button onClick={submit} disabled={sending} className="btn-red" style={{ width: "100%", justifyContent: "center", opacity: sending ? 0.6 : 1, cursor: sending ? "wait" : "pointer" }}>
            <span>{sending ? "..." : t({ ar: "إرسال الطلب", en: "Submit Request" })}</span>
          </button>
        </div>
      )}

      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "3px", color: "rgba(227,30,36,0.85)", textTransform: "uppercase", fontWeight: 600, marginBottom: "14px" }}>
        {t({ ar: "طلباتي السابقة", en: "My Requests" })}
      </div>
      {listPhase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {listPhase === "error" && <div className="f-sans" style={{ padding: "14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{listErr}</div>}
      {listPhase === "ready" && quotes.length === 0 && <p className="text-white/45" style={{ fontSize: "14px" }}>{t({ ar: "لا توجد طلبات بعد.", en: "No requests yet." })}</p>}
      {listPhase === "ready" && quotes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {quotes.map((q) => {
            const st = QUOTE_STATUS_LABELS[q.status] ?? { ar: q.status, en: q.status };
            return (
              <div key={q.id} style={{ padding: "16px 18px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px" }}>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className="f-display" style={{ fontSize: "15px", color: "#E31E24", letterSpacing: "1px", direction: "ltr" }}>{q.reference}</span>
                  <span className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px", borderRadius: "2px", whiteSpace: "nowrap" }}>{t(st)}</span>
                </div>
                <div className="text-white/70" style={{ fontSize: "13px", lineHeight: 1.5, marginBottom: "6px" }}>
                  {q.services.map((s) => labelFor(SERVICES, s, isAr)).join(isAr ? "، " : ", ")}
                </div>
                <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", direction: "ltr", textAlign: isAr ? "right" : "left" }}>
                  {new Date(q.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
