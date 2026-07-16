"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تعديل المشروع الكامل. Optimistic Lock عبر project_core.updated_at،
// عزل الحقول حسب الدور (المالية/العميل للمصرّح)، منع Double Submit، تحديث فوري.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { getProject } from "@/lib/portal/projects";
import {
  pcGetProjectCore, pcUpdateProject, pcListClients, PRIORITY_LABELS, HEALTH_LABELS, pcErr,
  type ProjectCore, type ClientLite, type PcPriority, type PcHealth,
} from "@/lib/portal/projectCore";

const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const lbl = "text-[11px] text-stone-500 mb-1 block";
const PRIORITIES: PcPriority[] = ["low", "normal", "high", "urgent"];
const HEALTHS: PcHealth[] = ["on_track", "at_risk", "off_track"];

export default function EditProjectModal({ projectId, onClose, onSaved }: { projectId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const [core, setCore] = useState<ProjectCore | null>(null);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let alive = true;
    (async () => {
      const [p, c] = await Promise.all([getProject(projectId), pcGetProjectCore(projectId)]);
      if (!alive) return;
      // فشل قراءة الملخّص = لا يجوز الحفظ (يتجاوز قفل التزامن ويقد يمسح بيانات). c.ok مع data=null = لا صفّ بعد (الحفظ يُنشئه).
      if (!c.ok) { setErr(pcErr(c.error)); setLoadFailed(true); }
      if (c.ok) setCore(c.data);
      setF({
        project_name: (p.ok && p.data?.project_name) || "",
        description: (p.ok && (p.data as { notes?: string } | null)?.notes) || "",
        client_id: (p.ok && p.data?.client_id) || "",
        priority: c.ok ? c.data?.priority ?? "normal" : "normal",
        health: c.ok ? c.data?.health ?? "on_track" : "on_track",
        project_type: c.ok ? c.data?.project_type ?? "" : "",
        start_date: c.ok ? c.data?.start_date ?? "" : "",
        due_date: c.ok ? c.data?.due_date ?? "" : "",
        delivery_date: c.ok ? c.data?.delivery_date ?? "" : "",
        budget_amount: c.ok && c.data?.budget_amount != null ? String(c.data.budget_amount) : "",
      });
      setLoaded(true);
    })();
    if (caps.isOwner) void pcListClients().then((r) => { if (r.ok) setClients(r.data); });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { alive = false; window.removeEventListener("keydown", onKey); };
  }, [projectId, onClose, caps.isOwner]);

  async function save() {
    if (busy || loadFailed || !f.project_name?.trim()) return;
    setBusy(true); setErr("");
    const patch: Record<string, unknown> = {
      project_name: f.project_name.trim(), description: f.description ?? "",
      priority: f.priority, health: f.health, project_type: f.project_type ?? "",
      start_date: f.start_date ?? "", due_date: f.due_date ?? "", delivery_date: f.delivery_date ?? "",
      ...(caps.canSeeFinancials ? { budget_amount: f.budget_amount ?? "" } : {}),
      ...(caps.isOwner && f.client_id ? { client_id: f.client_id } : {}),
    };
    const r = await pcUpdateProject(projectId, core?.updated_at ?? null, patch);
    setBusy(false);
    if (!r.ok) { setErr(pcErr(r.error)); return; }
    setCore(r.data); onSaved(); onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (!busy && e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-4 bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 rounded-t-2xl">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "تعديل المشروع", en: "Edit Project" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-sm">✕</button>
        </div>
        {!loaded ? <div className="p-8 text-center text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</div> : loadFailed ? (
          <div className="p-6 text-center space-y-2"><p className="text-sm text-red-300">{err || t({ ar: "تعذّر تحميل بيانات المشروع — لا يمكن التعديل الآن.", en: "Couldn't load project data — editing unavailable." })}</p></div>
        ) : (
          <div className="p-4 space-y-3">
            <div><span className={lbl}>{t({ ar: "اسم المشروع *", en: "Name *" })}</span><input value={f.project_name ?? ""} onChange={(e) => set("project_name", e.target.value)} className={inp} /></div>
            {caps.isOwner && clients.length > 0 && (
              <div><span className={lbl}>{t({ ar: "العميل", en: "Client" })}</span>
                <select value={f.client_id ?? ""} onChange={(e) => set("client_id", e.target.value)} className={inp} style={{ colorScheme: "dark" }}>
                  <option value="">{t({ ar: "— بدون تغيير —", en: "— unchanged —" })}</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{[c.full_name, c.company].filter(Boolean).join(" — ") || c.id.slice(0, 8)}</option>)}
                </select></div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div><span className={lbl}>{t({ ar: "الأولوية", en: "Priority" })}</span><select value={f.priority ?? "normal"} onChange={(e) => set("priority", e.target.value)} className={inp} style={{ colorScheme: "dark" }}>{PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}</select></div>
              <div><span className={lbl}>{t({ ar: "الصحة", en: "Health" })}</span><select value={f.health ?? "on_track"} onChange={(e) => set("health", e.target.value)} className={inp} style={{ colorScheme: "dark" }}>{HEALTHS.map((h) => <option key={h} value={h}>{t(HEALTH_LABELS[h])}</option>)}</select></div>
              <div><span className={lbl}>{t({ ar: "نوع المشروع", en: "Type" })}</span><input value={f.project_type ?? ""} onChange={(e) => set("project_type", e.target.value)} className={inp} /></div>
              <div><span className={lbl}>{t({ ar: "تاريخ البداية", en: "Start" })}</span><input type="date" value={f.start_date ?? ""} onChange={(e) => set("start_date", e.target.value)} className={inp} style={{ colorScheme: "dark" }} /></div>
              <div><span className={lbl}>{t({ ar: "الموعد النهائي", en: "Due" })}</span><input type="date" value={f.due_date ?? ""} onChange={(e) => set("due_date", e.target.value)} className={inp} style={{ colorScheme: "dark" }} /></div>
              <div><span className={lbl}>{t({ ar: "تاريخ التسليم", en: "Delivery" })}</span><input type="date" value={f.delivery_date ?? ""} onChange={(e) => set("delivery_date", e.target.value)} className={inp} style={{ colorScheme: "dark" }} /></div>
              {caps.canSeeFinancials && <div><span className={lbl}>{t({ ar: "الميزانية", en: "Budget" })}</span><input type="number" min={0} value={f.budget_amount ?? ""} onChange={(e) => set("budget_amount", e.target.value)} className={inp} /></div>}
            </div>
            <div><span className={lbl}>{t({ ar: "الوصف", en: "Description" })}</span><textarea value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} className={`${inp} min-h-[60px]`} /></div>
            {err && <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded p-2">{err}</div>}
          </div>
        )}
        <div className="flex gap-2 px-4 py-3 border-t border-stone-800 sticky bottom-0 bg-stone-950 rounded-b-2xl">
          <button disabled={busy || !loaded || loadFailed || !f.project_name?.trim()} onClick={() => void save()} className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2.5">{busy ? "…" : t({ ar: "حفظ التعديلات", en: "Save" })}</button>
          <button disabled={busy} onClick={onClose} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-300 text-sm px-4">{t({ ar: "إلغاء", en: "Cancel" })}</button>
        </div>
      </div>
    </div>
  );
}
