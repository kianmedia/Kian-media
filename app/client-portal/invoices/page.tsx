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
              {rows.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between gap-3 flex-wrap" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "8px", padding: "14px 16px" }}>
                  <div style={{ minWidth: 0 }}>
                    <div className="text-white" style={{ fontSize: "14px", fontWeight: 600, fontFamily: "ui-monospace, Menlo, monospace" }}>{inv.invoice_number || t({ ar: "فاتورة", en: "Invoice" })}</div>
                    <div className="f-sans" style={{ fontSize: "11.5px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
                      {inv.status ? inv.status : ""}
                      {inv.due_date ? ` · ${t({ ar: "الاستحقاق", en: "due" })} ${new Date(inv.due_date).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3" style={{ flexWrap: "wrap" }}>
                    <span className="text-white" style={{ fontSize: "14px", fontWeight: 700 }}>{money(inv.total, inv.currency)}</span>
                    {inv.pdf_url && (
                      <a href={inv.pdf_url} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.18)", padding: "8px 12px", borderRadius: "6px", textDecoration: "none", whiteSpace: "nowrap" }}>
                        {t({ ar: "عرض / تحميل PDF", en: "View / Download PDF" })}
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل الفواتير.", en: "Couldn't load invoices." })}</div>}
        </>
      )}
    </div>
  );
}
