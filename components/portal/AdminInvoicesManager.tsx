"use client";
// ════════════════════════════════════════════════════════════════════════
// Owner/finance manager for invoice DISPLAY records. Official invoices are issued
// in Zoho Books — never here. This only creates/syncs read-only records (number,
// amounts, due date, PDF link) and controls client visibility. Writes go through
// SECURITY DEFINER RPCs (can_see_invoices). Gated by the page.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listInvoices, createInvoiceDisplay, setInvoiceVisibility, syncZohoInvoices, updateInvoiceReviewState, hideOrSoftDeleteInvoice } from "@/lib/portal/finance";
import { listQuoteClients } from "@/lib/portal/quotes";
import InvoiceNotes from "@/components/portal/InvoiceNotes";
import { INVOICE_REVIEW_STATUS_LABELS, type Invoice, type InvoiceReviewStatus } from "@/lib/portal/types";

const money = (n: number | null | undefined, cur: string | null) =>
  `${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || "SAR"}`;

export default function AdminInvoicesManager() {
  const { t, isAr } = useI18n();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<{ client_id: string; label: string }[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3600); };
  const [f, setF] = useState({ clientId: "", invoiceNumber: "", status: "sent", subtotal: "", vat: "", total: "", dueDate: "", pdfUrl: "", zohoInvoiceId: "", visible: true });
  // Zoho sync
  const [syncEmail, setSyncEmail] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [zohoMsg, setZohoMsg] = useState<string | null>(null);
  // Review panel
  const [openId, setOpenId] = useState<string | null>(null);
  const [rev, setRev] = useState<{ status: string; internal: string; clientNote: string }>({ status: "", internal: "", clientNote: "" });
  function openReview(r: Invoice) {
    if (openId === r.id) { setOpenId(null); return; }
    setOpenId(r.id);
    setRev({ status: r.review_status || "draft", internal: r.internal_notes || "", clientNote: r.client_note || "" });
  }
  async function saveReview(id: string) {
    setBusy(true);
    const r = await updateInvoiceReviewState(id, { reviewStatus: rev.status, internalNotes: rev.internal, clientNote: rev.clientNote });
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    await reload();
    flash(t({ ar: "حُفظت حالة المراجعة.", en: "Review state saved." }));
  }
  async function hideDelete(id: string, action: "hide" | "unhide" | "soft_delete") {
    if (action === "soft_delete" && !window.confirm(t({ ar: "إخفاء سجل الفاتورة من البوابة؟ (لا يُحذف من Zoho)", en: "Hide this invoice record from the portal? (not deleted from Zoho)" }))) return;
    setBusy(true);
    const r = await hideOrSoftDeleteInvoice(id, action);
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    await reload();
  }

  const reload = useCallback(async () => {
    const [inv, c] = await Promise.all([listInvoices(), listQuoteClients()]);
    setRows(inv.ok ? inv.data : []);
    setClients(c.ok ? c.data : []);
    setPhase(inv.ok ? "ready" : "error");
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function create() {
    if (!f.clientId) { flash(t({ ar: "اختر العميل", en: "Pick a client" })); return; }
    setBusy(true);
    const r = await createInvoiceDisplay({
      clientId: f.clientId, invoiceNumber: f.invoiceNumber, status: f.status,
      subtotal: Number(f.subtotal) || 0, vat: Number(f.vat) || 0, total: Number(f.total) || 0,
      dueDate: f.dueDate || null, pdfUrl: f.pdfUrl, zohoInvoiceId: f.zohoInvoiceId, visible: f.visible,
    });
    setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    setF({ clientId: "", invoiceNumber: "", status: "sent", subtotal: "", vat: "", total: "", dueDate: "", pdfUrl: "", zohoInvoiceId: "", visible: true });
    await reload();
    flash(t({ ar: "أُضيفت الفاتورة (عرض فقط).", en: "Invoice display record added." }));
  }
  async function toggle(id: string, v: boolean) {
    setBusy(true); const r = await setInvoiceVisibility(id, v); setBusy(false);
    if (!r.ok) { flash((isAr ? "تعذّر: " : "Failed: ") + r.error); return; }
    await reload();
  }
  async function syncZoho() {
    if (!syncEmail.trim()) { flash(t({ ar: "أدخل بريد العميل", en: "Enter the customer email" })); return; }
    setSyncing(true); setZohoMsg(null);
    const r = await syncZohoInvoices(syncEmail.trim());
    setSyncing(false);
    if (!r.ok && r.configured === false) {
      setZohoMsg(t({ ar: "Zoho Books غير مهيأ بعد. أضف متغيرات البيئة (ZOHO_CLIENT_ID / SECRET / REFRESH_TOKEN / ORGANIZATION_ID / API_BASE_URL / ACCOUNTS_BASE_URL) ثم أعد المحاولة.", en: "Zoho Books isn't configured yet. Add the env vars (ZOHO_CLIENT_ID / SECRET / REFRESH_TOKEN / ORGANIZATION_ID / API_BASE_URL / ACCOUNTS_BASE_URL) and retry." }));
      return;
    }
    if (!r.ok) { flash((isAr ? "تعذّر المزامنة: " : "Sync failed: ") + r.reason); return; }
    await reload();
    flash(!r.customerFound
      ? t({ ar: "لا يوجد عميل بهذا البريد في Zoho.", en: "No Zoho customer found for that email." })
      : t({ ar: `تمت مزامنة ${r.synced} فاتورة من Zoho (للعرض فقط).`, en: `Synced ${r.synced} invoice(s) from Zoho (read-only).` }));
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
  const btn = (bg: string, disabled = false): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", background: bg, color: "#fff", opacity: disabled ? 0.5 : 1 });

  return (
    <div style={{ marginTop: 24 }}>
      {/* Primary flow: pull official invoices from Zoho Books (read-only) */}
      <div style={{ background: "rgba(37,211,102,0.06)", border: "1px solid rgba(37,211,102,0.22)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "مزامنة الفواتير من Zoho Books بالبريد", en: "Sync invoices from Zoho by customer email" })}</strong>
        <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11.5, margin: "6px 0 12px" }}>
          {t({ ar: "يُقرأ من Zoho Books فقط — لا يُنشئ أو يرسل أو يلغي أي فاتورة. الفواتير الرسمية تبقى مصدرها Zoho Books.", en: "Reads from Zoho Books only — never creates, sends, or voids an invoice. Zoho Books stays the source of official invoices." })}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input value={syncEmail} onChange={(e) => setSyncEmail(e.target.value)} placeholder={t({ ar: "بريد العميل", en: "Customer email" })} style={{ ...inp, maxWidth: 280 }} />
          <button onClick={() => void syncZoho()} disabled={syncing} style={btn("#25D366", syncing)}>{syncing ? "…" : t({ ar: "مزامنة", en: "Sync" })}</button>
        </div>
        {zohoMsg && <p style={{ color: "rgba(255,220,160,0.95)", fontSize: 12, marginTop: 10, lineHeight: 1.7 }}>{zohoMsg}</p>}
      </div>

      {/* Fallback: manual display record */}
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "سجل فاتورة يدوي (احتياطي)", en: "Manual display record / fallback" })}</strong>
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11.5, margin: "6px 0 12px" }}>
          {t({ ar: "استخدمه فقط عند تعذّر المزامنة من Zoho. للعرض داخل البوابة فقط — لا يُصدر فاتورة رسمية.", en: "Use only when Zoho sync isn't available. Read-only portal record — does not issue an official invoice." })}
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
          <select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} style={inp}>
            <option value="">{t({ ar: "— العميل —", en: "— Client —" })}</option>
            {clients.map((c) => <option key={c.client_id} value={c.client_id}>{c.label}</option>)}
          </select>
          <input value={f.invoiceNumber} onChange={(e) => setF({ ...f, invoiceNumber: e.target.value })} placeholder={t({ ar: "رقم الفاتورة", en: "Invoice #" })} style={inp} />
          <input value={f.subtotal} onChange={(e) => setF({ ...f, subtotal: e.target.value })} placeholder={t({ ar: "المجموع الفرعي", en: "Subtotal" })} style={inp} />
          <input value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value })} placeholder={t({ ar: "الضريبة", en: "VAT" })} style={inp} />
          <input value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} placeholder={t({ ar: "الإجمالي", en: "Total" })} style={inp} />
          <input type="date" value={f.dueDate} onChange={(e) => setF({ ...f, dueDate: e.target.value })} style={inp} />
          <input value={f.pdfUrl} onChange={(e) => setF({ ...f, pdfUrl: e.target.value })} placeholder={t({ ar: "رابط PDF", en: "PDF URL" })} style={inp} />
          <input value={f.zohoInvoiceId} onChange={(e) => setF({ ...f, zohoInvoiceId: e.target.value })} placeholder="Zoho ID" style={inp} />
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: "rgba(255,255,255,0.8)", cursor: "pointer" }}>
          <input type="checkbox" checked={f.visible} onChange={(e) => setF({ ...f, visible: e.target.checked })} />
          {t({ ar: "ظاهرة للعميل فورًا", en: "Visible to client immediately" })}
        </label>
        <button onClick={() => void create()} disabled={busy} style={{ ...btn("#E31E24", busy), marginTop: 12 }}>{t({ ar: "إضافة", en: "Add" })}</button>
      </div>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: 13.5 }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && <p style={{ fontSize: 13, color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل الفواتير (شغّل ترحيل قاعدة البيانات أولاً).", en: "Couldn't load invoices (run the DB migration first)." })}</p>}
      {phase === "ready" && rows.length === 0 && <p className="text-white/50" style={{ fontSize: 13.5 }}>{t({ ar: "لا توجد فواتير بعد.", en: "No invoices yet." })}</p>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => {
          const open = openId === r.id;
          return (
            <div key={r.id} style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "11px 14px", fontSize: 12.5 }}>
                <strong style={{ color: "#fff", fontFamily: "ui-monospace, Menlo, monospace" }}>{r.invoice_number || r.id.slice(0, 8)}</strong>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: r.source === "zoho" ? "rgba(37,211,102,0.16)" : "rgba(255,255,255,0.08)", color: r.source === "zoho" ? "#25D366" : "rgba(255,255,255,0.5)" }}>{r.source === "zoho" ? "Zoho" : t({ ar: "يدوي", en: "Manual" })}</span>
                <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.7)" }}>{t(INVOICE_REVIEW_STATUS_LABELS[(r.review_status as InvoiceReviewStatus) || "draft"] ?? { ar: r.review_status || "—", en: r.review_status || "—" })}</span>
                {r.due_date && <span style={{ color: "rgba(255,255,255,0.45)" }}>{t({ ar: "الاستحقاق", en: "due" })} {r.due_date}</span>}
                {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>PDF ↗</a>}
                <span style={{ marginInlineStart: "auto", color: "#fff", fontWeight: 700 }}>{money(r.total, r.currency)}</span>
                <button onClick={() => void toggle(r.id, !r.public_portal_visible)} disabled={busy} style={btn(r.public_portal_visible ? "rgba(255,255,255,0.10)" : "#25D366", busy)}>
                  {r.public_portal_visible ? t({ ar: "👁 ظاهرة", en: "👁 visible" }) : t({ ar: "إظهار", en: "Show" })}
                </button>
                <button onClick={() => openReview(r)} style={btn("rgba(255,255,255,0.08)")}>{open ? t({ ar: "إغلاق", en: "Close" }) : t({ ar: "مراجعة", en: "Review" })}</button>
              </div>
              {open && (
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "12px 14px" }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>{t({ ar: "حالة المراجعة", en: "Review status" })}</label>
                      <select value={rev.status} onChange={(e) => setRev((p) => ({ ...p, status: e.target.value }))} style={inp}>
                        {(Object.keys(INVOICE_REVIEW_STATUS_LABELS) as InvoiceReviewStatus[]).map((s) => (
                          <option key={s} value={s}>{isAr ? INVOICE_REVIEW_STATUS_LABELS[s].ar : INVOICE_REVIEW_STATUS_LABELS[s].en}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <label style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>{t({ ar: "ملاحظات داخلية (لا تظهر للعميل)", en: "Internal notes (not shown to client)" })}</label>
                    <textarea value={rev.internal} onChange={(e) => setRev((p) => ({ ...p, internal: e.target.value }))} rows={2} style={inp} />
                  </div>
                  <div style={{ marginTop: 10 }}>
                    <label style={{ display: "block", fontSize: 11, color: "rgba(255,255,255,0.55)", marginBottom: 4 }}>{t({ ar: "ملاحظة للعميل (اختياري)", en: "Client-facing note (optional)" })}</label>
                    <textarea value={rev.clientNote} onChange={(e) => setRev((p) => ({ ...p, clientNote: e.target.value }))} rows={2} style={inp} />
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                    <button onClick={() => void saveReview(r.id)} disabled={busy} style={btn("#E31E24", busy)}>{t({ ar: "حفظ المراجعة", en: "Save review" })}</button>
                    <button onClick={() => void hideDelete(r.id, r.public_portal_visible ? "hide" : "unhide")} disabled={busy} style={btn("rgba(255,255,255,0.10)", busy)}>{r.public_portal_visible ? t({ ar: "إخفاء عن العميل", en: "Hide from client" }) : t({ ar: "إظهار للعميل", en: "Show to client" })}</button>
                    <button onClick={() => void hideDelete(r.id, "soft_delete")} disabled={busy} style={btn("rgba(227,30,36,0.55)", busy)}>{t({ ar: "حذف السجل (بالبوابة)", en: "Soft-delete record" })}</button>
                  </div>
                  <p style={{ color: "rgba(255,255,255,0.38)", fontSize: 10.5, marginTop: 8 }}>{t({ ar: "لا يُعدَّل أو يُحذف من Zoho Books — سجل البوابة فقط.", en: "Never edits/deletes in Zoho Books — portal record only." })}</p>
                  <InvoiceNotes invoiceId={r.id} canResolve />
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
