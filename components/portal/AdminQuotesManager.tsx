"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin/finance/sales manager for FORMAL priced quotes: create a quote, edit its
// line items (auto totals), set status (sent → notifies + reveals to client),
// toggle client visibility, and read client revision requests. All writes go
// through SECURITY DEFINER RPCs (can_manage_quotes). Read-only price safety for
// clients lives in the DB; this panel is staff-only (gated by the page).
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  listQuotes, getQuoteItems, listQuoteRevisions, listQuoteClients,
  createQuote, setQuoteItems, setQuoteStatus, setQuoteVisibility,
  listPendingQuoteRequests, convertQuoteRequest, createEstimateFromRequest, syncEstimate, approveQuote,
  type QuoteItemInput, type PendingQuoteRequest,
} from "@/lib/portal/quotes";
import { FORMAL_QUOTE_STATUS_LABELS, type Quote, type QuoteRevisionRequest } from "@/lib/portal/types";

const STATUSES: Quote["status"][] = ["draft", "internal_review", "approved", "sent", "accepted", "rejected", "expired"];
const money = (n: number, cur: string) => `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const emptyItem = (): QuoteItemInput => ({ title: "", description: "", quantity: 1, unit_price: 0 });

export default function AdminQuotesManager() {
  const { t, isAr } = useI18n();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<{ client_id: string; label: string }[]>([]);
  const [pending, setPending] = useState<PendingQuoteRequest[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<Record<string, QuoteItemInput[]>>({});
  const [revs, setRevs] = useState<Record<string, QuoteRevisionRequest[]>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2800); };
  const emptyOrZero = (q: Quote) => (q.total <= 0); // server also enforces (items + total>0)
  const guardMsg = () => t({ ar: "أضف بنودًا بإجمالي أكبر من صفر قبل الإرسال أو الإظهار.", en: "Add line items with a total greater than zero before sending or showing." });

  // Create form
  const [cf, setCf] = useState({ clientId: "", title: "", validUntil: "", notes: "", vatRate: "15" });

  const reload = useCallback(async () => {
    const [q, c, pr] = await Promise.all([listQuotes(), listQuoteClients(), listPendingQuoteRequests()]);
    setQuotes(q.ok ? q.data : []);
    setClients(c.ok ? c.data : []);
    setPending(pr.ok ? pr.data : []);
    setPhase(q.ok ? "ready" : "error");
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function doCreate() {
    if (!cf.clientId) { flash(t({ ar: "اختر العميل", en: "Pick a client" })); return; }
    setBusy(true);
    const r = await createQuote({ clientId: cf.clientId, title: cf.title, validUntil: cf.validUntil || null, notes: cf.notes, vatRate: Number(cf.vatRate) || 15 });
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    setCf({ clientId: "", title: "", validUntil: "", notes: "", vatRate: "15" });
    await reload();
    setOpenId(r.data.id);
    setEditItems((p) => ({ ...p, [r.data.id]: [emptyItem()] }));
    flash(t({ ar: "أُنشئ العرض، أضف البنود.", en: "Quote created — add line items." }));
  }

  async function loadEditItems(quoteId: string) {
    if (editItems[quoteId]) return;
    const it = await getQuoteItems(quoteId);
    setEditItems((p) => ({ ...p, [quoteId]: it.ok && it.data.length ? it.data.map((x) => ({ title: x.title, description: x.description ?? "", quantity: x.quantity, unit_price: x.unit_price })) : [emptyItem()] }));
  }

  // Open the formal quote already linked to a request (fixes the "Open quote" button).
  async function openLinkedQuote(reqId: string) {
    const q = quotes.find((x) => x.quote_request_id === reqId);
    if (!q) { flash(t({ ar: "لم يُعثر على العرض المرتبط — جرّب التحديث.", en: "Linked quote not found — try refreshing." })); await reload(); return; }
    setOpenId(q.id);
    await loadEditItems(q.id);
    if (typeof document !== "undefined") document.getElementById(`quote-${q.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Create a DRAFT Zoho estimate from the request; fall back to a LOCAL draft if Zoho is off.
  async function createEstimate(reqId: string) {
    setBusy(true);
    const r = await createEstimateFromRequest(reqId);
    if (r.ok) {
      setBusy(false);
      await reload();
      if (r.quoteId) { setOpenId(r.quoteId); await loadEditItems(r.quoteId); }
      flash(t({ ar: `أُنشئت مسودة تقدير في Zoho (${r.estimateNumber || ""}). راجع الأسعار واعتمدها.`, en: `Draft estimate created in Zoho (${r.estimateNumber || ""}). Review prices, then approve.` }));
      return;
    }
    if (r.configured === false) {
      // Zoho not configured → local fallback so the admin can still work.
      const c = await convertQuoteRequest(reqId);
      setBusy(false);
      if (!c.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + c.error); return; }
      await reload();
      setOpenId(c.data.id); await loadEditItems(c.data.id);
      flash(t({ ar: "Zoho غير مهيأ — أُنشئ عرض محلي مؤقت. أضف الأسعار، وفعّل Zoho لاحقًا للمصدر الرسمي.", en: "Zoho not configured — created a local draft. Add prices; enable Zoho later for the official source." }));
      return;
    }
    setBusy(false);
    flash((isAr ? "تعذّر إنشاء التقدير: " : "Estimate failed: ") + r.reason);
  }

  async function approve(q: Quote) {
    if (q.total <= 0) { flash(guardMsg()); return; }
    setBusy(true);
    const r = await approveQuote(q.id, q.zoho_estimate_id);
    setBusy(false);
    if (!r.ok) { flash(r.reason === "empty_or_zero_quote" ? guardMsg() : ((isAr ? "تعذّر: " : "Failed: ") + r.reason)); return; }
    await reload();
    flash(t({ ar: "اعتُمد العرض وأصبح ظاهرًا للعميل.", en: "Approved — now visible to the client." }));
  }
  async function resync(q: Quote) {
    if (!q.zoho_estimate_id) return;
    setBusy(true);
    const r = await syncEstimate(q.id, q.zoho_estimate_id);
    setBusy(false);
    if (!r.ok) { flash(r.configured === false ? t({ ar: "Zoho غير مهيأ.", en: "Zoho not configured." }) : ((isAr ? "تعذّر: " : "Failed: ") + r.reason)); return; }
    await reload();
    flash(t({ ar: "تمت إعادة المزامنة من Zoho.", en: "Re-synced from Zoho." }));
  }

  async function expand(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!editItems[id]) {
      const r = await getQuoteItems(id);
      setEditItems((p) => ({ ...p, [id]: r.ok && r.data.length ? r.data.map((x) => ({ title: x.title, description: x.description ?? "", quantity: x.quantity, unit_price: x.unit_price })) : [emptyItem()] }));
    }
    const rv = await listQuoteRevisions(id);
    if (rv.ok) setRevs((p) => ({ ...p, [id]: rv.data }));
  }
  const setItem = (id: string, i: number, patch: Partial<QuoteItemInput>) =>
    setEditItems((p) => ({ ...p, [id]: (p[id] || []).map((x, j) => j === i ? { ...x, ...patch } : x) }));

  async function saveItems(id: string) {
    setBusy(true);
    const items = (editItems[id] || []).filter((x) => x.title.trim());
    const r = await setQuoteItems(id, items);
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    await reload();
    flash(t({ ar: "حُفظت البنود وحُسبت الإجماليات.", en: "Items saved & totals computed." }));
  }

  async function status(id: string, s: string) {
    const q = quotes.find((x) => x.id === id);
    if ((s === "sent" || s === "accepted") && q && emptyOrZero(q)) { flash(guardMsg()); return; }
    setBusy(true); const r = await setQuoteStatus(id, s); setBusy(false);
    if (!r.ok) { flash(r.error === "empty_or_zero_quote" ? guardMsg() : ((isAr ? "تعذّر: " : "Failed: ") + r.error)); return; }
    await reload(); flash(t({ ar: "حُدّثت الحالة.", en: "Status updated." }));
  }
  async function visibility(id: string, v: boolean) {
    const q = quotes.find((x) => x.id === id);
    if (v && q && emptyOrZero(q)) { flash(guardMsg()); return; }
    setBusy(true); const r = await setQuoteVisibility(id, v); setBusy(false);
    if (!r.ok) { flash(r.error === "empty_or_zero_quote" ? guardMsg() : ((isAr ? "تعذّر: " : "Failed: ") + r.error)); return; }
    await reload();
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
  const btn = (bg: string, disabled = false): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", background: bg, color: "#fff", opacity: disabled ? 0.5 : 1 });

  return (
    <div style={{ marginTop: 36 }}>
      <div className="eyebrow mb-3">{t({ ar: "إدارة عروض الأسعار", en: "Manage Quotes" })}</div>

      {/* Quote requests awaiting pricing → convert to a formal quote */}
      {pending.length > 0 && (
        <div style={{ background: "rgba(227,30,36,0.06)", border: "1px solid rgba(227,30,36,0.22)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
          <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "طلبات عروض سعر بانتظار التسعير", en: "Quote requests awaiting pricing" })} ({pending.length})</strong>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {pending.map((pr) => (
              <div key={pr.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "9px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, fontSize: 12.5 }}>
                <strong style={{ color: "#fff", fontFamily: "ui-monospace, Menlo, monospace" }}>{pr.reference || pr.id.slice(0, 8)}</strong>
                {(pr.services?.length ?? 0) > 0 && <span style={{ color: "rgba(255,255,255,0.7)" }}>{pr.services.join("، ")}</span>}
                {pr.email && <span style={{ color: "rgba(255,255,255,0.45)" }}>{pr.email}</span>}
                {pr.city && <span style={{ color: "rgba(255,255,255,0.45)" }}>· {pr.city}</span>}
                <span style={{ marginInlineStart: "auto", display: "inline-flex", gap: 8, alignItems: "center" }}>
                  {pr.has_quote && <span style={{ fontSize: 10, color: "#25D366" }}>{t({ ar: "مرتبط بعرض", en: "linked" })}</span>}
                  <button onClick={() => pr.has_quote ? void openLinkedQuote(pr.id) : void createEstimate(pr.id)} disabled={busy} style={btn(pr.has_quote ? "rgba(255,255,255,0.10)" : "#E31E24", busy)}>
                    {pr.has_quote ? t({ ar: "فتح العرض", en: "Open quote" }) : t({ ar: "إنشاء تقدير من هذا الطلب", en: "Create estimate from this request" })}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Create blank */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "إنشاء عرض سعر جديد", en: "New quote" })}</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
          <select value={cf.clientId} onChange={(e) => setCf({ ...cf, clientId: e.target.value })} style={inp}>
            <option value="">{t({ ar: "— اختر العميل —", en: "— Select client —" })}</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.label}</option>)}
          </select>
          <input value={cf.title} onChange={(e) => setCf({ ...cf, title: e.target.value })} placeholder={t({ ar: "عنوان العرض/المشروع", en: "Quote / project title" })} style={inp} />
          <input type="date" value={cf.validUntil} onChange={(e) => setCf({ ...cf, validUntil: e.target.value })} style={inp} />
          <input value={cf.vatRate} onChange={(e) => setCf({ ...cf, vatRate: e.target.value })} placeholder={t({ ar: "ضريبة %", en: "VAT %" })} style={inp} />
          <input value={cf.notes} onChange={(e) => setCf({ ...cf, notes: e.target.value })} placeholder={t({ ar: "ملاحظات", en: "Notes" })} style={inp} />
        </div>
        <button onClick={() => void doCreate()} disabled={busy} style={{ ...btn("#E31E24", busy), marginTop: 12 }}>{t({ ar: "إنشاء", en: "Create" })}</button>
      </div>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: 13.5 }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && <p style={{ fontSize: 13, color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل العروض (شغّل ترحيل قاعدة البيانات أولاً).", en: "Couldn't load quotes (run the DB migration first)." })}</p>}
      {phase === "ready" && quotes.length === 0 && <p className="text-white/50" style={{ fontSize: 13.5 }}>{t({ ar: "لا توجد عروض بعد.", en: "No quotes yet." })}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {quotes.map((q) => {
          const st = FORMAL_QUOTE_STATUS_LABELS[q.status] ?? { ar: q.status, en: q.status };
          const open = openId === q.id;
          const rows = editItems[q.id] || [];
          return (
            <div key={q.id} id={`quote-${q.id}`} style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${open ? "rgba(227,30,36,0.4)" : "rgba(255,255,255,0.09)"}`, borderRadius: 10, overflow: "hidden" }}>
              <button onClick={() => void expand(q.id)} style={{ width: "100%", textAlign: isAr ? "right" : "left", background: "transparent", border: "none", cursor: "pointer", padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}>{q.estimate_number || q.quote_number || q.id.slice(0, 8)}</strong>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: q.source === "zoho" ? "rgba(37,211,102,0.16)" : "rgba(255,255,255,0.08)", color: q.source === "zoho" ? "#25D366" : "rgba(255,255,255,0.5)" }}>{q.source === "zoho" ? "Zoho" : t({ ar: "محلي", en: "Local" })}</span>
                {q.title && <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 12.5 }}>{q.title}</span>}
                {q.quote_request_id && <span style={{ fontSize: 10, color: "rgba(255,255,255,0.4)" }}>🔗 {t({ ar: "من طلب", en: "from request" })}</span>}
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "rgba(227,30,36,0.16)", color: "#ff9ea1" }}>{t(st)}</span>
                {q.client_response && q.client_response !== "pending" && <span style={{ fontSize: 10, color: q.client_response === "accepted" ? "#25D366" : "#ff9ea1" }}>{q.client_response === "accepted" ? t({ ar: "✓ قبله العميل", en: "✓ accepted" }) : t({ ar: "✗ رفضه العميل", en: "✗ declined" })}</span>}
                <span style={{ fontSize: 11, color: q.public_portal_visible ? "#25D366" : "rgba(255,255,255,0.4)" }}>{q.public_portal_visible ? t({ ar: "👁 ظاهر للعميل", en: "👁 visible" }) : t({ ar: "مخفي", en: "hidden" })}</span>
                <span style={{ marginInlineStart: "auto", color: "#fff", fontWeight: 700 }}>{money(q.total, q.currency)}</span>
                <span style={{ color: "rgba(255,255,255,0.4)" }}>{open ? "▲" : "▼"}</span>
              </button>

              {open && (
                <div style={{ padding: "0 16px 16px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                  {/* Line items editor */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 12 }}>
                    {rows.map((it, i) => (
                      <div key={i} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        <span style={{ flex: 3 }}><input value={it.title} onChange={(e) => setItem(q.id, i, { title: e.target.value })} placeholder={t({ ar: "البند", en: "Item" })} style={inp} /></span>
                        <span style={{ flex: 1 }}><input value={String(it.quantity)} onChange={(e) => setItem(q.id, i, { quantity: Number(e.target.value) || 0 })} placeholder={t({ ar: "كمية", en: "Qty" })} style={inp} /></span>
                        <span style={{ flex: 1.4 }}><input value={String(it.unit_price)} onChange={(e) => setItem(q.id, i, { unit_price: Number(e.target.value) || 0 })} placeholder={t({ ar: "السعر", en: "Unit" })} style={inp} /></span>
                        <button onClick={() => setEditItems((p) => ({ ...p, [q.id]: (p[q.id] || []).filter((_, j) => j !== i) }))} style={{ ...btn("rgba(255,255,255,0.08)"), padding: "6px 9px" }}>×</button>
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => setEditItems((p) => ({ ...p, [q.id]: [...(p[q.id] || []), emptyItem()] }))} style={btn("rgba(255,255,255,0.08)")}>+ {t({ ar: "بند", en: "Line" })}</button>
                      <button onClick={() => void saveItems(q.id)} disabled={busy} style={btn("#E31E24", busy)}>{t({ ar: "حفظ البنود + حساب الإجمالي", en: "Save items + totals" })}</button>
                      <span style={{ marginInlineStart: "auto", color: "rgba(255,255,255,0.6)", fontSize: 12.5, alignSelf: "center" }}>{t({ ar: "الإجمالي", en: "Total" })}: <strong style={{ color: "#fff" }}>{money(q.total, q.currency)}</strong> ({t({ ar: "ضريبة", en: "VAT" })} {money(q.vat, q.currency)})</span>
                    </div>
                  </div>

                  {/* Status + visibility */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 14, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                    <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{t({ ar: "الحالة", en: "Status" })}:</span>
                    <select value={q.status} onChange={(e) => void status(q.id, e.target.value)} disabled={busy} style={{ ...inp, width: "auto" }}>
                      {STATUSES.map((s) => <option key={s} value={s}>{isAr ? FORMAL_QUOTE_STATUS_LABELS[s].ar : FORMAL_QUOTE_STATUS_LABELS[s].en}</option>)}
                    </select>
                    <button onClick={() => void visibility(q.id, !q.public_portal_visible)} disabled={busy} style={btn(q.public_portal_visible ? "rgba(255,255,255,0.10)" : "#25D366", busy)}>
                      {q.public_portal_visible ? t({ ar: "إخفاء عن العميل", en: "Hide from client" }) : t({ ar: "إظهار للعميل", en: "Show to client" })}
                    </button>
                  </div>

                  {/* Approve / Zoho actions */}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
                    <button onClick={() => void approve(q)} disabled={busy} style={btn("#E31E24", busy)}>
                      {t({ ar: "اعتماد وإظهار للعميل", en: "Approve & show to client" })}
                    </button>
                    {q.source === "zoho" && q.zoho_estimate_id && (
                      <button onClick={() => void resync(q)} disabled={busy} style={btn("rgba(255,255,255,0.10)", busy)}>
                        {t({ ar: "إعادة مزامنة من Zoho", en: "Re-sync from Zoho" })}
                      </button>
                    )}
                    {q.estimate_url && (
                      <a href={q.estimate_url} target="_blank" rel="noopener noreferrer" style={{ ...btn("rgba(255,255,255,0.10)"), textDecoration: "none" }}>
                        {t({ ar: "فتح في Zoho ↗", en: "Open in Zoho ↗" })}
                      </a>
                    )}
                    <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
                      {q.source === "zoho"
                        ? t({ ar: "السعر يُعدّل في Zoho ثم أعد المزامنة. الاعتماد يُظهره للعميل.", en: "Edit prices in Zoho, then re-sync. Approve to reveal to the client." })
                        : t({ ar: "الاعتماد/الإرسال يُظهر العرض ويُنبّه العميل.", en: "Approve/Send reveals the quote + notifies the client." })}
                    </span>
                  </div>

                  {/* Revision requests */}
                  {(revs[q.id]?.length ?? 0) > 0 && (
                    <div style={{ marginTop: 14 }}>
                      <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11, textTransform: "uppercase" }}>{t({ ar: "طلبات التعديل من العميل", en: "Client revision requests" })}</span>
                      {(revs[q.id] || []).map((rv) => (
                        <div key={rv.id} style={{ marginTop: 6, padding: "8px 10px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 8, fontSize: 12.5, color: "rgba(255,255,255,0.8)" }}>
                          “{rv.note}” <span style={{ color: "rgba(255,255,255,0.35)" }}>· {new Date(rv.created_at).toLocaleDateString()}</span>
                        </div>
                      ))}
                    </div>
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
