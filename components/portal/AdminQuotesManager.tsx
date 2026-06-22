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
  createQuote, setQuoteItems, setQuoteStatus, setQuoteVisibility, type QuoteItemInput,
} from "@/lib/portal/quotes";
import { FORMAL_QUOTE_STATUS_LABELS, type Quote, type QuoteRevisionRequest } from "@/lib/portal/types";

const STATUSES: Quote["status"][] = ["draft", "internal_review", "approved", "sent", "accepted", "rejected", "expired"];
const money = (n: number, cur: string) => `${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const emptyItem = (): QuoteItemInput => ({ title: "", description: "", quantity: 1, unit_price: 0 });

export default function AdminQuotesManager() {
  const { t, isAr } = useI18n();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<{ client_id: string; label: string }[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editItems, setEditItems] = useState<Record<string, QuoteItemInput[]>>({});
  const [revs, setRevs] = useState<Record<string, QuoteRevisionRequest[]>>({});
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2800); };

  // Create form
  const [cf, setCf] = useState({ clientId: "", validUntil: "", notes: "", vatRate: "15" });

  const reload = useCallback(async () => {
    const [q, c] = await Promise.all([listQuotes(), listQuoteClients()]);
    setQuotes(q.ok ? q.data : []);
    setClients(c.ok ? c.data : []);
    setPhase(q.ok ? "ready" : "error");
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function doCreate() {
    if (!cf.clientId) { flash(t({ ar: "اختر العميل", en: "Pick a client" })); return; }
    setBusy(true);
    const r = await createQuote({ clientId: cf.clientId, validUntil: cf.validUntil || null, notes: cf.notes, vatRate: Number(cf.vatRate) || 15 });
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    setCf({ clientId: "", validUntil: "", notes: "", vatRate: "15" });
    await reload();
    setOpenId(r.data.id);
    setEditItems((p) => ({ ...p, [r.data.id]: [emptyItem()] }));
    flash(t({ ar: "أُنشئ العرض، أضف البنود.", en: "Quote created — add line items." }));
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
    setBusy(true); const r = await setQuoteStatus(id, s); setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    await reload(); flash(t({ ar: "حُدّثت الحالة.", en: "Status updated." }));
  }
  async function visibility(id: string, v: boolean) {
    setBusy(true); const r = await setQuoteVisibility(id, v); setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    await reload();
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
  const btn = (bg: string, disabled = false): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", background: bg, color: "#fff", opacity: disabled ? 0.5 : 1 });

  return (
    <div style={{ marginTop: 36 }}>
      <div className="eyebrow mb-3">{t({ ar: "إدارة عروض الأسعار", en: "Manage Quotes" })}</div>

      {/* Create */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "إنشاء عرض سعر جديد", en: "New quote" })}</strong>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10, marginTop: 12 }}>
          <select value={cf.clientId} onChange={(e) => setCf({ ...cf, clientId: e.target.value })} style={inp}>
            <option value="">{t({ ar: "— اختر العميل —", en: "— Select client —" })}</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.label}</option>)}
          </select>
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
            <div key={q.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, overflow: "hidden" }}>
              <button onClick={() => void expand(q.id)} style={{ width: "100%", textAlign: isAr ? "right" : "left", background: "transparent", border: "none", cursor: "pointer", padding: "12px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <strong style={{ color: "#fff", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}>{q.quote_number || q.id.slice(0, 8)}</strong>
                <span style={{ fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 6, background: "rgba(227,30,36,0.16)", color: "#ff9ea1" }}>{t(st)}</span>
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
                    <span style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{t({ ar: "الإرسال يُظهر العرض ويُنبّه العميل تلقائيًا", en: "'Sent' reveals the quote + notifies the client" })}</span>
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
