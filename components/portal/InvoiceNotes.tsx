"use client";
// ════════════════════════════════════════════════════════════════════════
// Notes thread on an invoice. Clients leave notes on a draft/review invoice;
// finance/admin see them and can mark them resolved. Reads are RLS-scoped.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listInvoiceNotes, submitInvoiceNote, markInvoiceNoteResolved } from "@/lib/portal/billing";
import type { InvoiceNote } from "@/lib/portal/types";

export default function InvoiceNotes({ invoiceId, canResolve = false }: { invoiceId: string; canResolve?: boolean }) {
  const { t, isAr } = useI18n();
  const [notes, setNotes] = useState<InvoiceNote[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await listInvoiceNotes(invoiceId);
    if (r.ok) setNotes(r.data);
  }, [invoiceId]);
  useEffect(() => { void load(); }, [load]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    const r = await submitInvoiceNote(invoiceId, body.trim());
    setBusy(false);
    if (!r.ok) { setMsg((isAr ? "تعذّر الإرسال: " : "Couldn't send: ") + r.error); return; }
    setBody(""); setMsg(null); void load();
  }
  async function resolve(id: string, resolved: boolean) {
    const r = await markInvoiceNoteResolved(id, resolved);
    if (r.ok) void load();
  }

  const inp: React.CSSProperties = { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 7, padding: "8px 10px", color: "#fff", fontSize: 12.5, width: "100%", boxSizing: "border-box", fontFamily: "inherit" };

  return (
    <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 12 }}>
      <div style={{ fontSize: 11.5, color: "rgba(255,255,255,0.5)", fontWeight: 600, marginBottom: 8 }}>
        {t({ ar: "ملاحظات الفاتورة", en: "Invoice notes" })}
      </div>
      {notes.length === 0 && <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 12, margin: "0 0 8px" }}>{t({ ar: "لا توجد ملاحظات بعد.", en: "No notes yet." })}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
        {notes.map((n) => (
          <div key={n.id} style={{ background: n.author_role === "admin" ? "rgba(37,211,102,0.07)" : "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, padding: "8px 10px" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 3, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, fontWeight: 600, color: n.author_role === "admin" ? "#7CFC9A" : "rgba(255,255,255,0.6)" }}>
                {n.author_role === "admin" ? t({ ar: "فريق كيان", en: "Kian team" }) : t({ ar: "العميل", en: "Client" })}
              </span>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,0.35)" }}>{new Date(n.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB")}</span>
              {n.is_resolved && <span style={{ fontSize: 10, color: "#7CFC9A" }}>✓ {t({ ar: "تمت المعالجة", en: "resolved" })}</span>}
              {canResolve && !n.is_resolved && n.author_role === "client" && (
                <button onClick={() => void resolve(n.id, true)} style={{ marginInlineStart: "auto", fontSize: 10.5, background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 6, padding: "2px 8px", cursor: "pointer" }}>
                  {t({ ar: "تحديد كمُعالجة", en: "Mark resolved" })}
                </button>
              )}
            </div>
            <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{n.body}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder={t({ ar: "أضف ملاحظة على الفاتورة…", en: "Add a note on this invoice…" })} style={inp} />
        <button onClick={() => void send()} disabled={busy || !body.trim()} style={{ padding: "8px 14px", borderRadius: 7, border: "none", cursor: busy ? "wait" : "pointer", background: "#25D366", color: "#fff", fontSize: 12.5, fontWeight: 600, opacity: busy || !body.trim() ? 0.5 : 1, whiteSpace: "nowrap" }}>
          {t({ ar: "إرسال", en: "Send" })}
        </button>
      </div>
      {msg && <p style={{ color: "#ff9ea1", fontSize: 11.5, marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
