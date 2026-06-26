"use client";
// ════════════════════════════════════════════════════════════════════════
// Client read-only view of FORMAL priced quotes. A client sees a quote only when
// it's visible (public_portal_visible OR status sent/accepted) — enforced by RLS.
// They can Accept or Request-revision; they can NEVER edit prices.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { listQuotes, getQuoteItems, requestQuoteRevision, respondToQuote, promoteByEmail, openEstimatePdf } from "@/lib/portal/quotes";
import { listMyIntake } from "@/lib/portal/intake";
import { FORMAL_QUOTE_STATUS_LABELS, type Quote, type QuoteItem } from "@/lib/portal/types";

const money = (n: number | null | undefined, cur: string) =>
  `${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;

export default function ClientQuotesList() {
  const { t, isAr } = useI18n();
  const { readOnly } = usePortal();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, QuoteItem[]>>({});
  const [busy, setBusy] = useState(false);
  const [revBox, setRevBox] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2800); };

  const [hasRequest, setHasRequest] = useState(false);
  const reload = useCallback(async () => {
    const r = await listQuotes();
    setQuotes(r.ok ? r.data : []);
    setPhase(r.ok ? "ready" : "error");
  }, []);
  useEffect(() => {
    // Best-effort: a same-email visitor/lead gets their email-matched quotes linked
    // to their client context, then we load (visibility itself works via email-match RLS).
    (async () => {
      try { await promoteByEmail(); } catch { /* non-blocking */ }
      try { const ir = await listMyIntake(); if (ir.ok) setHasRequest(ir.data.length > 0); } catch { /* non-blocking */ }
      await reload();
    })();
  }, [reload]);

  async function toggle(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!items[id]) {
      const r = await getQuoteItems(id);
      if (r.ok) setItems((p) => ({ ...p, [id]: r.data }));
    }
  }
  async function viewPdf(q: Quote) {
    flash(t({ ar: "جارٍ فتح PDF…", en: "Opening PDF…" }));
    const r = await openEstimatePdf(q.id);
    if (!r.ok) {
      flash(r.error === "zoho_not_configured"
        ? t({ ar: "نسخة PDF غير متاحة حالياً — تواصل مع فريق كيان.", en: "PDF not available yet — please contact Kian's team." })
        : (isAr ? "تعذّر فتح PDF: " : "Couldn't open PDF: ") + r.error);
    }
  }
  async function respond(q: Quote, response: "accepted" | "declined") {
    if (readOnly) return;
    // Rejection notes are required (parity with request-revision).
    if (response === "declined" && !(revBox[q.id] || "").trim()) {
      flash(t({ ar: "اكتب سبب الرفض أولاً", en: "Write the reason for declining first" })); return;
    }
    const ask = response === "accepted" ? t({ ar: "تأكيد قبول عرض السعر؟", en: "Accept this quote?" }) : t({ ar: "تأكيد رفض عرض السعر؟", en: "Decline this quote?" });
    if (!window.confirm(ask)) return;
    setBusy(true);
    const r = await respondToQuote(q.id, response, (revBox[q.id] || "").trim(), q.zoho_estimate_id);
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    setRevBox((p) => ({ ...p, [q.id]: "" }));
    await reload();
    flash(response === "accepted"
      ? t({ ar: "تم قبول العرض. سيتواصل فريق كيان معك.", en: "Quote accepted. Kian's team will follow up." })
      : t({ ar: "تم تسجيل رفضك. شكرًا لملاحظتك.", en: "Your decline was recorded. Thank you for the note." }));
  }
  async function revise(id: string) {
    if (readOnly) return;
    const note = (revBox[id] || "").trim();
    if (!note) { flash(t({ ar: "اكتب ملاحظتك أولاً", en: "Write your note first" })); return; }
    setBusy(true); const r = await requestQuoteRevision(id, note); setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    setRevBox((p) => ({ ...p, [id]: "" }));
    flash(t({ ar: "أُرسل طلب التعديل لفريق كيان.", en: "Revision request sent to Kian's team." }));
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
  const btn = (bg: string, disabled = false): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 600, padding: "8px 14px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", background: bg, color: "#fff", opacity: disabled ? 0.5 : 1, textDecoration: "none", display: "inline-block" });

  return (
    <div style={{ marginTop: 36 }}>
      <div className="eyebrow mb-1">{t({ ar: "عروض الأسعار الرسمية", en: "Official Quotes" })}</div>
      <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 12.5, margin: "0 0 14px", lineHeight: 1.7 }}>
        {t({ ar: "عروض الأسعار الجاهزة للمراجعة من فريق كيان (تختلف عن طلباتك أعلاه).", en: "Priced quotes ready for your review (distinct from your requests above)." })}
      </p>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: 13.5 }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}

      {phase !== "loading" && quotes.length === 0 && (
        <div style={{ padding: "26px 22px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.14)", borderRadius: 8 }}>
          <p className="text-white/60" style={{ fontSize: 14, lineHeight: 1.9, maxWidth: 560 }}>
            {hasRequest
              ? t({ ar: "تم استلام طلبك، وسيظهر عرض السعر هنا بعد مراجعته واعتماده من فريق كيان.", en: "Your request was received — the quote will appear here after Kian's team reviews and approves it." })
              : t({ ar: "لا توجد عروض أسعار حتى الآن. يمكنك طلب عرض سعر جديد وسيتابع فريق كيان معك.", en: "No quotes yet. Request a quote and Kian's team will follow up with you." })}
          </p>
          {!hasRequest && <Link href="/quote-request" style={{ ...btn("#E31E24"), marginTop: 14 }}>{t({ ar: "اطلب عرض سعر", en: "Request a Quote" })}</Link>}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {quotes.map((q) => {
          const st = FORMAL_QUOTE_STATUS_LABELS[q.status] ?? { ar: q.status, en: q.status };
          const open = openId === q.id;
          const canAccept = q.status === "sent" || q.status === "approved";
          return (
            <div key={q.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, overflow: "hidden" }}>
              <button onClick={() => void toggle(q.id)} style={{ width: "100%", textAlign: isAr ? "right" : "left", background: "transparent", border: "none", cursor: "pointer", padding: "13px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}>{q.quote_number || q.id.slice(0, 8)}</strong>
                {q.title && <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12.5 }}>{q.title}</span>}
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "rgba(227,30,36,0.16)", color: "#ff9ea1" }}>{t(st)}</span>
                {q.valid_until && <span style={{ fontSize: 11, color: "rgba(255,255,255,0.45)" }}>{t({ ar: "صالح حتى", en: "valid until" })} {q.valid_until}</span>}
                <span style={{ marginInlineStart: "auto", color: "#fff", fontWeight: 700 }}>{money(q.total, q.currency)}</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{open ? "▲" : "▼"}</span>
              </button>

              {open && (
                <div style={{ padding: "0 16px 16px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 12 }}>
                    <thead>
                      <tr style={{ color: "rgba(255,255,255,0.4)", textAlign: isAr ? "right" : "left" }}>
                        <th style={{ padding: "6px 4px", fontWeight: 500 }}>{t({ ar: "البند", en: "Item" })}</th>
                        <th style={{ padding: "6px 4px", fontWeight: 500, textAlign: "center" }}>{t({ ar: "الكمية", en: "Qty" })}</th>
                        <th style={{ padding: "6px 4px", fontWeight: 500, textAlign: isAr ? "left" : "right" }}>{t({ ar: "السعر", en: "Unit" })}</th>
                        <th style={{ padding: "6px 4px", fontWeight: 500, textAlign: isAr ? "left" : "right" }}>{t({ ar: "الإجمالي", en: "Total" })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(items[q.id] ?? []).map((it) => (
                        <tr key={it.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)" }}>
                          <td style={{ padding: "7px 4px" }}>
                            <div style={{ color: "#fff" }}>{it.title}</div>
                            {it.description && <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{it.description}</div>}
                          </td>
                          <td style={{ padding: "7px 4px", textAlign: "center" }}>{it.quantity}</td>
                          <td style={{ padding: "7px 4px", textAlign: isAr ? "left" : "right" }}>{money(it.unit_price, q.currency)}</td>
                          <td style={{ padding: "7px 4px", textAlign: isAr ? "left" : "right" }}>{money(it.total, q.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12, fontSize: 13, maxWidth: 280, marginInlineStart: "auto" }}>
                    <Row l={t({ ar: "المجموع الفرعي", en: "Subtotal" })} v={money(q.subtotal, q.currency)} />
                    <Row l={`${t({ ar: "الضريبة", en: "VAT" })} (${q.vat_rate}%)`} v={money(q.vat, q.currency)} />
                    <Row l={t({ ar: "الإجمالي", en: "Total" })} v={money(q.total, q.currency)} bold />
                  </div>
                  {q.notes && <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 12.5, marginTop: 12, lineHeight: 1.8 }}>{q.notes}</p>}

                  {/* Official Zoho estimate → stream the real Zoho Books PDF to the authorized client. */}
                  {q.source === "zoho" && q.zoho_estimate_id && (
                    <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <button onClick={() => void viewPdf(q)} style={btn("rgba(37,211,102,0.18)")}>
                        {t({ ar: "عرض PDF", en: "View PDF" })}
                      </button>
                      <span style={{ color: "rgba(255,255,255,0.45)", fontSize: 11.5 }}>
                        {t({ ar: "عرض رسمي من Zoho Books", en: "Official Zoho Books estimate" })}
                        {q.published_at ? ` · ${t({ ar: "نُشر", en: "published" })} ${new Date(q.published_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}` : ""}
                      </span>
                    </div>
                  )}

                  {q.client_response && q.client_response !== "pending" ? (
                    <div style={{ marginTop: 16 }}>
                      <span style={{ ...btn(q.client_response === "accepted" ? "rgba(37,211,102,0.18)" : "rgba(227,30,36,0.18)"), cursor: "default" }}>
                        {q.client_response === "accepted" ? `✓ ${t({ ar: "تم القبول", en: "Accepted" })}` : `✗ ${t({ ar: "تم الرفض", en: "Declined" })}`}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div style={{ marginTop: 12 }}>
                        <textarea value={revBox[q.id] || ""} onChange={(e) => setRevBox((p) => ({ ...p, [q.id]: e.target.value }))} rows={2}
                          placeholder={t({ ar: "ملاحظة — مطلوبة عند الرفض أو طلب التعديل…", en: "Note — required when you decline or request a revision…" })} style={inp} />
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                        {canAccept && <button onClick={() => void respond(q, "accepted")} disabled={busy || readOnly} style={btn("#25D366", busy || readOnly)}>{t({ ar: "قبول العرض", en: "Accept" })}</button>}
                        {canAccept && <button onClick={() => void respond(q, "declined")} disabled={busy || readOnly} style={btn("rgba(227,30,36,0.7)", busy || readOnly)}>{t({ ar: "رفض العرض", en: "Decline" })}</button>}
                        <button onClick={() => void revise(q.id)} disabled={busy || readOnly} style={btn("rgba(255,255,255,0.10)", busy || readOnly)}>
                          {t({ ar: "طلب تعديل", en: "Request Revision" })}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {toast && <div style={{ position: "fixed", insetInlineEnd: 20, bottom: 20, background: "rgba(0,0,0,0.92)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#fff", zIndex: 50, maxWidth: 360 }}>{toast}</div>}
    </div>
  );
}

function Row({ l, v, bold }: { l: string; v: string; bold?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: bold ? "#fff" : "rgba(255,255,255,0.7)", fontWeight: bold ? 700 : 400, borderTop: bold ? "1px solid rgba(255,255,255,0.12)" : "none", paddingTop: bold ? 6 : 0 }}>
      <span>{l}</span><span>{v}</span>
    </div>
  );
}
