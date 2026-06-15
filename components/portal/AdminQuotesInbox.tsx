"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin Quote Requests inbox. Reads ALL quote_requests (admin-all RLS) +
// sender profiles. Cards expand into a detail panel (no separate route).
// No submission form for admins. No fake data.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { adminListQuotes, adminListSenders, type SenderProfile } from "@/lib/portal/admin";
import { SERVICES, QUOTE_STATUS_LABELS, labelFor } from "@/components/portal/quoteOptions";
import type { QuoteRequest } from "@/lib/portal/types";

export default function AdminQuotesInbox() {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [senders, setSenders] = useState<Record<string, SenderProfile>>({});
  const [err, setErr] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  async function load() {
    const r = await adminListQuotes();
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setQuotes(r.data);
    const ids = Array.from(new Set(r.data.map((q) => q.user_id)));
    const sp = await adminListSenders(ids);
    if (sp.ok) {
      const map: Record<string, SenderProfile> = {};
      sp.data.forEach((p) => { map[p.id] = p; });
      setSenders(map);
    }
    setPhase("ready");
  }
  useEffect(() => { void load(); }, []);

  // Deep-link from a notification: /client-portal/quotes?open=<quoteId> auto-expands it.
  useEffect(() => {
    try {
      const id = new URLSearchParams(window.location.search).get("open");
      if (id) setOpenId(id);
    } catch { /* ignore */ }
  }, []);

  function senderLine(q: QuoteRequest): string {
    const s = senders[q.user_id];
    if (!s) return q.user_id.slice(0, 8) + "…";
    const name = s.full_name || s.email;
    return s.company ? `${name} · ${s.company}` : name;
  }

  const stats = useMemo(() => {
    const newCount = quotes.filter((q) => q.status === "new").length;
    return { total: quotes.length, newCount };
  }, [quotes]);

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "طلبات عروض السعر", en: "Quote Requests" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "طلبات العملاء", en: "Client Requests" })}
        </h1>
        {phase === "ready" && (
          <p className="text-white/45" style={{ fontSize: "12.5px", marginTop: "8px" }}>
            {t({ ar: `${stats.total} طلب · ${stats.newCount} جديد`, en: `${stats.total} total · ${stats.newCount} new` })}
          </p>
        )}
      </div>

      {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {phase === "error" && <div className="f-sans" style={{ padding: "14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{err}</div>}
      {phase === "ready" && quotes.length === 0 && <p className="text-white/45" style={{ fontSize: "14px" }}>{t({ ar: "لا توجد طلبات بعد.", en: "No requests yet." })}</p>}

      {phase === "ready" && quotes.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {quotes.map((q) => {
            const st = QUOTE_STATUS_LABELS[q.status] ?? { ar: q.status, en: q.status };
            const open = openId === q.id;
            return (
              <div key={q.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", overflow: "hidden" }}>
                {/* Card header (clickable) */}
                <button onClick={() => setOpenId(open ? null : q.id)} className="f-sans"
                  style={{ width: "100%", textAlign: isAr ? "right" : "left", padding: "15px 18px", background: "none", border: "none", cursor: "pointer" }}>
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="f-display" style={{ fontSize: "15px", color: "#E31E24", letterSpacing: "1px", direction: "ltr" }}>{q.reference}</span>
                    <span style={{ fontSize: "10px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", padding: "5px 10px", borderRadius: "2px", whiteSpace: "nowrap" }}>{t(st)}</span>
                  </div>
                  <div className="text-white" style={{ fontSize: "14px", fontWeight: 600, marginBottom: "3px" }}>{senderLine(q)}</div>
                  <div className="text-white/55" style={{ fontSize: "12.5px", lineHeight: 1.5 }}>
                    {q.services.map((s) => labelFor(SERVICES, s, isAr)).join(isAr ? "، " : ", ")}
                  </div>
                  <div className="flex items-center gap-2 mt-2" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)" }}>
                    <span style={{ direction: "ltr" }}>{new Date(q.created_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}</span>
                    <span>·</span>
                    <span>{open ? t({ ar: "إغلاق ▲", en: "Close ▲" }) : t({ ar: "التفاصيل ▼", en: "Details ▼" })}</span>
                  </div>
                </button>

                {/* Detail panel */}
                {open && (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", padding: "18px" }}>
                    <DetailGrid q={q} sender={senders[q.user_id]} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DetailGrid({ q, sender }: { q: QuoteRequest; sender?: SenderProfile }) {
  const { t, isAr } = useI18n();
  const row = (label: string, value: string | null | undefined, opts?: { ltr?: boolean; pre?: boolean }) => (
    <div style={{ padding: "11px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
      <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1.5px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: "5px" }}>{label}</div>
      <div className="text-white/85" style={{ fontSize: "13.5px", lineHeight: 1.6, direction: opts?.ltr ? "ltr" : undefined, whiteSpace: opts?.pre ? "pre-wrap" : undefined }}>
        {value || <span className="text-white/30">{t({ ar: "—", en: "—" })}</span>}
      </div>
    </div>
  );

  const zoho = (id: string | null | undefined) =>
    id ? id : t({ ar: "غير مزامن بعد (لاحقاً)", en: "Not synced yet (future)" });

  return (
    <div>
      {row(t({ ar: "رقم الطلب", en: "Reference" }), q.reference, { ltr: true })}
      {row(t({ ar: "العميل", en: "Client" }), sender ? (sender.full_name || sender.email) : q.user_id)}
      {row(t({ ar: "الشركة", en: "Company" }), sender?.company)}
      {row(t({ ar: "البريد", en: "Email" }), sender?.email, { ltr: true })}
      {row(t({ ar: "الخدمات", en: "Services" }), q.services.map((s) => labelFor(SERVICES, s, isAr)).join(isAr ? "، " : ", "))}
      {row(t({ ar: "الوصف (يشمل العنوان/التواصل/الملاحظات)", en: "Description (incl. title/contact/notes)" }), q.description, { pre: true })}
      {row(t({ ar: "المدينة", en: "City" }), q.city)}
      {row(t({ ar: "الميزانية", en: "Budget" }), q.budget_range)}
      {row(t({ ar: "التاريخ المفضّل", en: "Preferred Date" }), q.preferred_date, { ltr: true })}
      {row(t({ ar: "الحالة", en: "Status" }), t(QUOTE_STATUS_LABELS[q.status] ?? { ar: q.status, en: q.status }))}
      {row(t({ ar: "تاريخ الإنشاء", en: "Created" }), new Date(q.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB"), { ltr: true })}
      {row(t({ ar: "النسخة الاحتياطية (Google Sheet)", en: "Backup (Google Sheet)" }), q.sheet_mirrored ? t({ ar: "تم النسخ ✓", en: "Mirrored ✓" }) : t({ ar: "لم يتم", en: "Not mirrored" }))}
      {row("Zoho CRM", zoho(q.zoho_deal_id), { ltr: true })}
      {row("Zoho Books", zoho(q.zoho_books_estimate_id), { ltr: true })}
    </div>
  );
}
