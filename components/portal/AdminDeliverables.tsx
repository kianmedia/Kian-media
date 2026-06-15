"use client";
// ════════════════════════════════════════════════════════════════════════
// Admin deliverable management for a project (S6-lite). Add a review item via
// admin_add_deliverable (S1) and change status via admin_set_deliverable.
// Setting status to client_review notifies the client (DB trigger). Admin sees
// all states (deliverables RLS for admin). No invented columns; version is
// fixed to v1 by the RPC (no version param). No final-asset/download flow here.
// ════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { listDeliverables } from "@/lib/portal/deliverables";
import { adminAddDeliverable, adminSetDeliverable } from "@/lib/portal/admin";
import { DELIVERABLE_STATUSES } from "@/components/portal/projectMeta";
import type { Deliverable, DeliverableType, DeliverableStatus } from "@/lib/portal/types";

const ADD_STATUSES = ["draft", "internal_review", "client_review"] as const;
const TYPES: { v: DeliverableType; ar: string; en: string }[] = [
  { v: "video", ar: "فيديو", en: "Video" },
  { v: "photo", ar: "صورة", en: "Image" },
  { v: "other", ar: "أخرى", en: "Other" },
];

export default function AdminDeliverables({ projectId }: { projectId: string }) {
  const { t, isAr } = useI18n();
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [items, setItems] = useState<Deliverable[]>([]);
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ id: string; kind: "ok" | "err"; text: string } | null>(null);

  // add form
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DeliverableType>("video");
  const [previewUrl, setPreviewUrl] = useState("");
  const [vimeoUrl, setVimeoUrl] = useState("");
  const [addStatus, setAddStatus] = useState<(typeof ADD_STATUSES)[number]>("client_review");
  const [adding, setAdding] = useState(false);

  async function load() {
    const r = await listDeliverables(projectId);
    if (!r.ok) { setErr(r.error); setPhase("error"); return; }
    setItems(r.data);
    setPhase("ready");
  }
  useEffect(() => { void load(); /* eslint-disable-next-line */ }, [projectId]);

  async function add() {
    if (!title.trim()) { setFlash({ id: "add", kind: "err", text: t({ ar: "العنوان مطلوب", en: "Title required" }) }); return; }
    setAdding(true); setFlash(null);
    const r = await adminAddDeliverable({
      projectId, title: title.trim(), type,
      previewUrl: previewUrl.trim() || undefined,
      vimeoUrl: vimeoUrl.trim() || undefined,
      status: addStatus,
    });
    setAdding(false);
    if (!r.ok) { setFlash({ id: "add", kind: "err", text: t({ ar: "تعذّر الإضافة: ", en: "Add failed: " }) + r.error }); return; }
    setTitle(""); setPreviewUrl(""); setVimeoUrl(""); setType("video"); setAddStatus("client_review");
    setFlash({ id: "add", kind: "ok", text: t({ ar: "تمت إضافة المخرَج ✓", en: "Deliverable added ✓" }) });
    void load();
  }

  async function setStatus(d: Deliverable, status: DeliverableStatus) {
    if (status === d.status) return;
    setBusyId(d.id); setFlash(null);
    const r = await adminSetDeliverable({ deliverableId: d.id, status });
    setBusyId(null);
    if (!r.ok || !r.data) { setFlash({ id: d.id, kind: "err", text: t({ ar: "تعذّر التحديث: ", en: "Update failed: " }) + (r.ok ? "blocked (check workflow order)" : r.error) }); void load(); return; }
    setFlash({ id: d.id, kind: "ok", text: t({ ar: "تم تحديث الحالة ✓", en: "Status updated ✓" }) });
    void load();
  }

  const input: React.CSSProperties = { width: "100%", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "3px", padding: "11px 13px", color: "#fff", fontSize: "14px", fontFamily: "var(--sans)", outline: "none", colorScheme: "dark" };

  return (
    <div>
      {/* Add form */}
      <div style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "4px", padding: "18px", marginBottom: "18px" }}>
        <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "2px", color: "rgba(124,252,154,0.8)", textTransform: "uppercase", fontWeight: 600, marginBottom: "12px" }}>
          {t({ ar: "إضافة مخرَج للمراجعة", en: "Add Review Deliverable" })}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "عنوان المخرَج *", en: "Title *" })} style={input} />
          <div className="form-row" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <select value={type} onChange={(e) => setType(e.target.value as DeliverableType)} style={input}>
              {TYPES.map((x) => <option key={x.v} value={x.v} style={{ background: "#0a0a0a" }}>{isAr ? x.ar : x.en}</option>)}
            </select>
            <select value={addStatus} onChange={(e) => setAddStatus(e.target.value as (typeof ADD_STATUSES)[number])} style={input}>
              {ADD_STATUSES.map((s) => {
                const m = DELIVERABLE_STATUSES.find((x) => x.key === s)!;
                return <option key={s} value={s} style={{ background: "#0a0a0a" }}>{isAr ? m.ar : m.en}</option>;
              })}
            </select>
          </div>
          <input value={previewUrl} onChange={(e) => setPreviewUrl(e.target.value)} type="url" dir="ltr" placeholder="Preview URL (YouTube/Vimeo/Drive...)" style={input} />
          <input value={vimeoUrl} onChange={(e) => setVimeoUrl(e.target.value)} type="url" dir="ltr" placeholder="Vimeo review URL (optional)" style={input} />
          <button onClick={add} disabled={adding} className="btn-red" style={{ justifyContent: "center", opacity: adding ? 0.6 : 1 }}>
            <span>{adding ? "..." : t({ ar: "إضافة", en: "Add" })}</span>
          </button>
          {flash && flash.id === "add" && <div className="f-sans" style={{ fontSize: "12px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
          <p className="f-sans" style={{ fontSize: "10.5px", color: "rgba(255,255,255,0.35)", lineHeight: 1.6 }}>
            {t({ ar: "اختيار حالة «مراجعة العميل» يُشعر العميل تلقائياً. (الإصدار يبدأ من v1.)", en: "Choosing “Client Review” notifies the client automatically. (Version starts at v1.)" })}
          </p>
        </div>
      </div>

      {/* Existing deliverables */}
      {phase === "loading" && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "جارٍ التحميل...", en: "Loading..." })}</p>}
      {phase === "error" && <div className="f-sans" style={{ fontSize: "13px", color: "#ff8a8e" }}>{err}</div>}
      {phase === "ready" && items.length === 0 && <p className="text-white/45" style={{ fontSize: "13.5px" }}>{t({ ar: "لا توجد مخرجات بعد.", en: "No deliverables yet." })}</p>}
      {phase === "ready" && items.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {items.map((d) => (
            <div key={d.id} style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "3px", padding: "14px 16px" }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div style={{ minWidth: 0 }}>
                  <div className="text-white" style={{ fontSize: "14px", fontWeight: 600 }}>{d.title}</div>
                  <div className="f-sans" style={{ fontSize: "10px", letterSpacing: "1px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginTop: "3px" }}>{d.type} · v{d.version}</div>
                </div>
                <select value={d.status} disabled={busyId === d.id} onChange={(e) => setStatus(d, e.target.value as DeliverableStatus)} style={{ ...input, width: "auto" }}>
                  {DELIVERABLE_STATUSES.map((s) => <option key={s.key} value={s.key} style={{ background: "#0a0a0a" }}>{isAr ? s.ar : s.en}</option>)}
                </select>
              </div>
              {flash && flash.id === d.id && <div className="f-sans" style={{ fontSize: "12px", marginTop: "8px", color: flash.kind === "ok" ? "#7CFC9A" : "#ff8a8e" }}>{flash.text}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
