"use client";
// ════════════════════════════════════════════════════════════════════════
// Notifications — clickable cards. Each card opens a detail modal (title,
// type, time, read status) + a context-aware "Open related section" button
// that routes by entity_type/entity_id. Personally-targeted unread items are
// marked read on click. Works for lead/client (own) and admin (own +
// broadcasts), all RLS-filtered. No SQL.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { listNotifications, markRead, markAllRead } from "@/lib/portal/notifications";
import type { NotificationRow, NotificationType } from "@/lib/portal/types";

const TYPE_LABEL: Record<NotificationType, { ar: string; en: string }> = {
  quote_request_new:           { ar: "طلب عرض سعر", en: "Quote Request" },
  message_new:                 { ar: "رسالة",        en: "Message" },
  file_link_new:               { ar: "ملف / رابط",   en: "File / Link" },
  project_note_new:            { ar: "ملاحظة مشروع", en: "Project Note" },
  deliverable_new:             { ar: "مخرَج جديد",   en: "New Deliverable" },
  revision_requested:          { ar: "طلب تعديل",    en: "Revision Requested" },
  deliverable_approved:        { ar: "اعتماد مخرَج", en: "Deliverable Approved" },
  deliverable_final_delivered: { ar: "تسليم نهائي",  en: "Final Delivered" },
  project_status_changed:      { ar: "تحديث حالة المشروع", en: "Project Status" },
  opportunity_new:             { ar: "طلب فرصة جديد", en: "New Opportunity" },
};

/** Where a notification links to, from entity_type/entity_id (exact when possible). */
function routeFor(n: NotificationRow): string | null {
  const id = n.entity_id;
  switch (n.entity_type) {
    case "project":        return id ? `/client-portal/projects/${id}` : "/client-portal/projects";
    case "quote_request":  return id ? `/client-portal/quotes?open=${id}` : "/client-portal/quotes";
    case "message":        return "/client-portal/messages";
    case "file_link":      return "/client-portal/files";
    case "deliverable":    return "/client-portal/projects";   // exact project needs a resolve → section
    case "project_note":   return "/client-portal/projects";
    case "opportunity":    return "/client-portal/opportunities";
    default:               return null;
  }
}

function sectionLabel(n: NotificationRow): { ar: string; en: string } | null {
  switch (n.entity_type) {
    case "project": case "deliverable": case "project_note": return { ar: "فتح المشروع", en: "Open Project" };
    case "quote_request": return { ar: "فتح الطلب", en: "Open Request" };
    case "message":       return { ar: "فتح الرسائل", en: "Open Messages" };
    case "file_link":     return { ar: "فتح الملفات", en: "Open Files" };
    case "opportunity":   return { ar: "فتح مركز الفرص", en: "Open Opportunities" };
    default:              return null;
  }
}

export default function NotificationsView() {
  const { t, isAr } = useI18n();
  const router = useRouter();
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<NotificationRow | null>(null);

  async function load() {
    const r = await listNotifications(50);
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setRows(r.data);
    setPhase("ready");
  }
  useEffect(() => { void load(); }, []);

  async function openCard(n: NotificationRow) {
    setDetail(n);
    // Mark read on open (only personally-targeted; broadcasts have no per-user state)
    if (n.recipient_role === "user" && !n.read_at) {
      setRows((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      const r = await markRead(n.id);
      if (!r.ok) void load();
    }
  }

  async function onMarkAll() {
    setBusy(true);
    await markAllRead();
    setBusy(false);
    void load();
  }

  const hasUnreadOwn = rows.some((n) => n.recipient_role === "user" && !n.read_at);

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-8">
        <div>
          <div className="eyebrow mb-4">{t({ ar: "الإشعارات", en: "Notifications" })}</div>
          <h1 className="editorial text-white" style={{ fontSize: "clamp(24px,4vw,34px)", lineHeight: 1.25 }}>
            {t({ ar: "آخر التحديثات", en: "Latest Updates" })}
          </h1>
        </div>
        {phase === "ready" && hasUnreadOwn && (
          <button onClick={onMarkAll} disabled={busy} className="f-sans"
            style={{ fontSize: "10.5px", letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(255,255,255,0.6)", background: "none", border: "1px solid rgba(255,255,255,0.15)", padding: "8px 14px", borderRadius: "3px", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
            {t({ ar: "تعليم الكل كمقروء", en: "Mark all read" })}
          </button>
        )}
      </div>

      {phase === "loading" && <div className="f-sans" style={{ fontSize: "12px", letterSpacing: "2px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", padding: "20px 0" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</div>}
      {phase === "error" && <div className="f-sans" style={{ padding: "14px", fontSize: "13px", color: "#ff8a8e", background: "rgba(227,30,36,0.08)", border: "1px solid rgba(227,30,36,0.3)", borderRadius: "3px" }}>{err}</div>}

      {phase === "ready" && rows.length === 0 && (
        <div className="text-center" style={{ padding: "70px 24px", border: "1px dashed rgba(255,255,255,0.12)", borderRadius: "4px" }}>
          <p className="text-white/55" style={{ fontSize: "15px", lineHeight: 1.85 }}>
            {t({ ar: "لا توجد إشعارات بعد — ستظهر هنا تحديثات طلباتك ومشاريعك.", en: "No notifications yet — updates on your requests and projects will appear here." })}
          </p>
        </div>
      )}

      {phase === "ready" && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {rows.map((n) => {
            const unread = !n.read_at;
            const label = TYPE_LABEL[n.type] ?? { ar: n.type, en: n.type };
            return (
              <button key={n.id} type="button" onClick={() => void openCard(n)}
                className="pt-card"
                style={{
                  display: "flex", alignItems: "flex-start", gap: "12px", width: "100%", textAlign: isAr ? "right" : "left",
                  padding: "14px 16px", cursor: "pointer", transition: "background 0.3s, border-color 0.3s",
                  background: unread ? "rgba(227,30,36,0.06)" : "rgba(255,255,255,0.02)",
                  border: `1px solid ${unread ? "rgba(227,30,36,0.25)" : "rgba(255,255,255,0.07)"}`,
                  borderRadius: "4px",
                }}>
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", marginTop: "6px", flexShrink: 0, background: unread ? "#E31E24" : "rgba(255,255,255,0.15)" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="flex items-center gap-2 flex-wrap" style={{ marginBottom: "3px" }}>
                    <span className="text-white" style={{ fontSize: "14px", fontWeight: 600 }}>{isAr ? n.title_ar : n.title_en}</span>
                    <span className="f-sans" style={{ fontSize: "8.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", padding: "2px 7px", borderRadius: "2px" }}>{t(label)}</span>
                  </div>
                  <div className="f-sans" style={{ fontSize: "11px", color: "rgba(255,255,255,0.35)", direction: "ltr", textAlign: isAr ? "right" : "left" }}>
                    {new Date(n.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
                <span className="f-sans" style={{ fontSize: "9.5px", letterSpacing: "1px", textTransform: "uppercase", color: "rgba(227,30,36,0.85)", whiteSpace: "nowrap", marginTop: "3px" }}>
                  {t({ ar: "عرض التفاصيل", en: "Open" })}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <div onClick={() => setDetail(null)}
          style={{ position: "fixed", inset: 0, zIndex: 120, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "100%", maxWidth: "440px", background: "#0c0c0c", border: "1px solid rgba(227,30,36,0.25)", borderRadius: "6px", padding: "26px 24px" }}>
            <div className="flex items-center justify-between gap-3 mb-4">
              <span className="f-sans" style={{ fontSize: "9px", letterSpacing: "1.5px", textTransform: "uppercase", color: "#E31E24", background: "rgba(227,30,36,0.1)", border: "1px solid rgba(227,30,36,0.3)", padding: "4px 9px", borderRadius: "2px" }}>
                {t(TYPE_LABEL[detail.type] ?? { ar: detail.type, en: detail.type })}
              </span>
              <button onClick={() => setDetail(null)} className="f-sans" style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: "12px", letterSpacing: "1px", cursor: "pointer" }}>✕</button>
            </div>
            <h3 className="text-white" style={{ fontSize: "18px", fontWeight: 700, lineHeight: 1.4, marginBottom: "10px" }}>
              {isAr ? detail.title_ar : detail.title_en}
            </h3>
            <div className="f-sans" style={{ fontSize: "12px", color: "rgba(255,255,255,0.45)", lineHeight: 1.8, marginBottom: "20px" }}>
              <div style={{ direction: "ltr", textAlign: isAr ? "right" : "left" }}>
                {new Date(detail.created_at).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "medium", timeStyle: "short" })}
              </div>
              <div>{detail.read_at ? t({ ar: "الحالة: مقروء", en: "Status: read" }) : t({ ar: "الحالة: غير مقروء", en: "Status: unread" })}</div>
            </div>
            <div className="flex gap-3">
              {routeFor(detail) && sectionLabel(detail) && (
                <button onClick={() => { const to = routeFor(detail); setDetail(null); if (to) router.push(to); }} className="btn-red" style={{ justifyContent: "center", flex: 1 }}>
                  <span>{t(sectionLabel(detail)!)}</span>
                </button>
              )}
              <button onClick={() => setDetail(null)} className="btn-ghost" style={{ justifyContent: "center", flex: routeFor(detail) ? "0 0 auto" : 1 }}>
                <span>{t({ ar: "إغلاق", en: "Close" })}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
