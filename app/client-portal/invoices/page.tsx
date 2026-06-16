"use client";
// /client-portal/invoices — Invoices. RLS scopes rows: owner/admin/manager/finance
// see all; a client sees only their own. Rows are written server-side by the Zoho
// sync (docs/zoho_books_portal_integration_PROPOSAL.md) — empty until that ships,
// so we show a placeholder. Table + RLS exist (staff_assignment_notifications_finance_ADDENDUM.sql).
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { listInvoices } from "@/lib/portal/finance";
import type { Invoice } from "@/lib/portal/types";

export default function InvoicesPage() {
  const { t, isAr } = useI18n();
  const { caps } = usePortal();
  // Staff financiers (owner/admin/manager/finance) OR a client (own invoices via RLS).
  // Leads are excluded: they have no clients row, so RLS returns nothing — and they
  // get no invoices tab either (nav). This matches the spec scope.
  const allowed = caps.canSeeInvoices || caps.view === "client";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [rows, setRows] = useState<Invoice[]>([]);

  useEffect(() => {
    if (!allowed) { setPhase("ready"); return; }
    let alive = true;
    (async () => {
      const r = await listInvoices();
      if (!alive) return;
      setRows(r.ok ? r.data : []);
      setPhase(r.ok ? "ready" : "error");
    })();
    return () => { alive = false; };
  }, [allowed]);

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
      </div>

      {phase === "loading" && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}

      {phase === "ready" && rows.length === 0 && (
        <div style={{ padding: "28px 24px", background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.14)", borderRadius: "6px" }}>
          <h2 className="text-white" style={{ fontSize: "17px", fontWeight: 700, marginBottom: "10px" }}>
            {t({ ar: "لا توجد فواتير بعد", en: "No invoices yet" })}
          </h2>
          <p className="text-white/55" style={{ fontSize: "14px", lineHeight: 1.9, maxWidth: "560px" }}>
            {t({
              ar: "ستظهر فواتيرك هنا فور إصدارها عبر Zoho Books (تكامل من جهة الخادم فقط). الوصول مقصور على المالك والمدير والمالية، ويرى كل عميل فواتيره فقط.",
              en: "Invoices appear here once issued via Zoho Books (server-side only integration). Access is limited to owner, manager, and finance — and each client sees only their own.",
            })}
          </p>
        </div>
      )}

      {phase === "ready" && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {rows.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-3 flex-wrap" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "14px 16px" }}>
              <div style={{ minWidth: 0 }}>
                <div className="text-white" style={{ fontSize: "14px", fontWeight: 600 }}>{inv.number || t({ ar: "فاتورة", en: "Invoice" })}</div>
                <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.45)", marginTop: "3px" }}>
                  {inv.status ? inv.status + " · " : ""}{inv.amount != null ? `${inv.amount} ${inv.currency || "SAR"}` : ""}{inv.issued_at ? ` · ${new Date(inv.issued_at).toLocaleDateString(isAr ? "ar-SA" : "en-GB")}` : ""}
                </div>
              </div>
              {inv.url && (
                <a href={inv.url} target="_blank" rel="noopener noreferrer" className="f-sans" style={{ fontSize: "11px", letterSpacing: "0.5px", color: "rgba(255,255,255,0.8)", border: "1px solid rgba(255,255,255,0.18)", padding: "8px 12px", borderRadius: "3px", textDecoration: "none", whiteSpace: "nowrap" }}>
                  {t({ ar: "عرض الفاتورة", en: "View Invoice" })}
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{t({ ar: "تعذّر تحميل الفواتير.", en: "Couldn't load invoices." })}</div>}
    </div>
  );
}
