"use client";
// /client-portal/invoices — read-only invoices.
//   owner/manager/finance (can_see_invoices) → AdminInvoicesManager (add display
//     records + toggle client visibility). Official invoices stay in Zoho Books.
//   client → their OWN invoices, read-only, only when public_portal_visible (RLS).
//   lead → no clients row → RLS returns nothing → professional empty state.
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { listInvoices } from "@/lib/portal/finance";
import AdminInvoicesManager from "@/components/portal/AdminInvoicesManager";
import type { Invoice } from "@/lib/portal/types";

const money = (n: number | null | undefined, cur: string | null) =>
  `${Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur || "SAR"}`;

export default function InvoicesPage() {
  const { t, isAr } = useI18n();
  const { caps } = usePortal();
  const manage = caps.canSeeInvoices;
  const allowed = manage || caps.view === "client";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = useState<Invoice[]>([]);
  const [openInv, setOpenInv] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed || manage) { setPhase("ready"); return; } // managers render the manager component
    let alive = true;
    (async () => {
      const r = await listInvoices();
      if (!alive) return;
      setRows(r.ok ? r.data : []);
      setPhase(r.ok ? "ready" : "error");
    })();
    return () => { alive = false; };
  }, [allowed, manage]);

  if (!allowed) {
    return (
      <div className="text-center" style={{ padding: "80px 24px" }}>
        <p className="text-white/55" style={{ fontSize: "15px" }}>{t({ ar: "لا تملك صلاحية الوصول للفواتير.", en: "You don't have access to invoices." })}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <div className="eyebrow mb-4">{t({ ar: "المالية", en: "Finance" })}</div>
        <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
          {t({ ar: "الفواتير", en: "Invoices" })}
        </h1>
        {!manage && (
          <p className="text-white/50" style={{ fontSize: "13px", marginTop: "10px", lineHeight: 1.8, maxWidth: 560 }}>
            {t({ ar: "الفواتير الرسمية تُصدر عبر Zoho Books وتُعرض هنا للقراءة فقط.", en: "Official invoices are issued via Zoho Books and shown here read-only." })}
          </p>
        )}
      </div>

      {manage ? (
        <AdminInvoicesManager />
      ) : (
        <>
          {phase === "loading" && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}

          {phase === "ready" && rows.length === 0 && (
            <div style={{ padding: "28px 24px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.14)", borderRadius: "6px" }}>
              <h2 className="text-white" style={{ fontSize: "17px", fontWeight: 700, marginBottom: "10px" }}>
                {t({ ar: "لا توجد فواتير بعد", en: "No invoices yet" })}
              </h2>
              <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.9, maxWidth: "560px" }}>
                {t({
                  ar: "ستظهر فواتيرك هنا بعد إصدارها من Zoho Books واعتمادها من فريق كيان.",
                  en: "Your invoices will appear here after they are issued from Zoho Books and made available by Kian's team.",
                })}
              </p>
            </div>
          )}

          {phase === "ready" && rows.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {rows.map((inv) => {
                const items = inv.line_items ?? [];
                const open = openInv === inv.id;
                return (
                  <div key={inv.id} style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", overflow: "hidden" }}>
                    <button onClick={() => setOpenInv(open ? null : inv.id)} style={{ width: "100%", background: "transparent", border: "none", cursor: "pointer", textAlign: isAr ? "right" : "left", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="text-white" style={{ fontSize: "14px", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>{inv.invoice_number || t({ ar: "فاتورة", en: "Invoice" })}</div>
                        <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
                          {inv.status ? inv.status : ""}
                          {inv.due_date ? ` · ${t({ ar: "الاستحقاق", en: "due" })} ${new Date(inv.due_date).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
                        <span className="text-white" style={{ fontSize: "14px", fontWeight: 700 }}>{money(inv.total, inv.currency)}</span>
                        <span style={{ color: "rgba(255,255,255,0.4)" }}>{open ? "▲" : "▼"}</span>
                      </div>
                    </button>
                    {open && (
                      <div style={{ padding: "0 16px 16px", borderTop: "1px solid rgba(255,255,255,0.07)" }}>
                        {items.length > 0 ? (
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, marginTop: 12 }}>
                            <thead><tr style={{ color: "rgba(255,255,255,0.4)", textAlign: isAr ? "right" : "left" }}>
                              <th style={{ padding: "6px 4px", fontWeight: 500 }}>{t({ ar: "البند", en: "Item" })}</th>
                              <th style={{ padding: "6px 4px", fontWeight: 500, textAlign: "center" }}>{t({ ar: "الكمية", en: "Qty" })}</th>
                              <th style={{ padding: "6px 4px", fontWeight: 500, textAlign: isAr ? "left" : "right" }}>{t({ ar: "السعر", en: "Unit" })}</th>
                              <th style={{ padding: "6px 4px", fontWeight: 500, textAlign: isAr ? "left" : "right" }}>{t({ ar: "الإجمالي", en: "Total" })}</th>
                            </tr></thead>
                            <tbody>{items.map((it, i) => (
                              <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.85)" }}>
                                <td style={{ padding: "7px 4px" }}><div style={{ color: "#fff" }}>{it.title}</div>{it.description && <div style={{ color: "rgba(255,255,255,0.45)", fontSize: 11 }}>{it.description}</div>}</td>
                                <td style={{ padding: "7px 4px", textAlign: "center" }}>{it.quantity}</td>
                                <td style={{ padding: "7px 4px", textAlign: isAr ? "left" : "right" }}>{money(it.unit_price, inv.currency)}</td>
                                <td style={{ padding: "7px 4px", textAlign: isAr ? "left" : "right" }}>{money(it.total, inv.currency)}</td>
                              </tr>
                            ))}</tbody>
                          </table>
                        ) : <p className="text-white/45" style={{ fontSize: 12, marginTop: 12 }}>{t({ ar: "بنود الفاتورة في Zoho Books.", en: "Line items are in Zoho Books." })}</p>}
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 12, fontSize: 13, maxWidth: 280, marginInlineStart: "auto" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(255,255,255,0.7)" }}><span>{t({ ar: "المجموع الفرعي", en: "Subtotal" })}</span><span>{money(inv.subtotal, inv.currency)}</span></div>
                          <div style={{ display: "flex", justifyContent: "space-between", color: "rgba(255,255,255,0.7)" }}><span>{t({ ar: "الضريبة", en: "VAT" })}</span><span>{money(inv.vat, inv.currency)}</span></div>
                          <div style={{ display: "flex", justifyContent: "space-between", color: "#fff", fontWeight: 700, borderTop: "1px solid rgba(255,255,255,0.12)", paddingTop: 6 }}><span>{t({ ar: "الإجمالي", en: "Total" })}</span><span>{money(inv.total, inv.currency)}</span></div>
                        </div>
                        {inv.pdf_url && (
                          <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ display: "inline-block", marginTop: 14, fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.18)", padding: "8px 12px", borderRadius: "6px", textDecoration: "none" }}>
                            {t({ ar: "عرض / تحميل PDF", en: "View / Download PDF" })}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل الفواتير.", en: "Couldn't load invoices." })}</div>}
        </>
      )}
    </div>
  );
}
