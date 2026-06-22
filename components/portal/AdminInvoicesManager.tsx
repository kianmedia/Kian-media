"use client";
// ════════════════════════════════════════════════════════════════════════
// Owner/finance manager for invoice DISPLAY records. Official invoices are issued
// in Zoho Books — never here. This only creates/syncs read-only records (number,
// amounts, due date, PDF link) and controls client visibility. Writes go through
// SECURITY DEFINER RPCs (can_see_invoices). Gated by the page.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listInvoices, createInvoiceDisplay, setInvoiceVisibility } from "@/lib/portal/finance";
import { listQuoteClients } from "@/lib/portal/quotes";
import type { Invoice } from "@/lib/portal/types";

const money = (n: number | null | undefined, cur: string | null) =>
  `${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || "SAR"}`;

export default function AdminInvoicesManager() {
  const { t, isAr } = useI18n();
  const [rows, setRows] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<{ client_id: string; label: string }[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 2800); };
  const [f, setF] = useState({ clientId: "", invoiceNumber: "", status: "sent", subtotal: "", vat: "", total: "", dueDate: "", pdfUrl: "", zohoInvoiceId: "", visible: true });

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

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 13, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };
  const btn = (bg: string, disabled = false): React.CSSProperties => ({ fontSize: 12.5, fontWeight: 600, padding: "7px 13px", borderRadius: 8, border: "none", cursor: disabled ? "not-allowed" : "pointer", background: bg, color: "#fff", opacity: disabled ? 0.5 : 1 });

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <strong style={{ color: "#fff", fontSize: 13 }}>{t({ ar: "إضافة فاتورة (عرض فقط)", en: "Add invoice display record" })}</strong>
        <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 11.5, margin: "6px 0 12px" }}>
          {t({ ar: "الفواتير الرسمية تُصدر من Zoho Books فقط. هذه نسخة للعرض داخل البوابة.", en: "Official invoices are issued only in Zoho Books. This is a read-only record for the portal." })}
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
        {rows.map((r) => (
          <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "11px 14px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, fontSize: 12.5 }}>
            <strong style={{ color: "#fff", fontFamily: "ui-monospace, Menlo, monospace" }}>{r.invoice_number || r.id.slice(0, 8)}</strong>
            <span style={{ color: "rgba(255,255,255,0.6)" }}>{r.status}</span>
            {r.due_date && <span style={{ color: "rgba(255,255,255,0.45)" }}>{t({ ar: "الاستحقاق", en: "due" })} {r.due_date}</span>}
            {r.pdf_url && <a href={r.pdf_url} target="_blank" rel="noopener noreferrer" style={{ color: "#3b82f6", textDecoration: "none" }}>PDF ↗</a>}
            <span style={{ marginInlineStart: "auto", color: "#fff", fontWeight: 700 }}>{money(r.total, r.currency)}</span>
            <button onClick={() => void toggle(r.id, !r.public_portal_visible)} disabled={busy} style={btn(r.public_portal_visible ? "rgba(255,255,255,0.10)" : "#25D366", busy)}>
              {r.public_portal_visible ? t({ ar: "👁 ظاهرة", en: "👁 visible" }) : t({ ar: "إظهار", en: "Show" })}
            </button>
          </div>
        ))}
      </div>

      {toast && <div style={{ position: "fixed", insetInlineEnd: 20, bottom: 20, background: "rgba(0,0,0,0.92)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "#fff", zIndex: 50, maxWidth: 360 }}>{toast}</div>}
    </div>
  );
}
