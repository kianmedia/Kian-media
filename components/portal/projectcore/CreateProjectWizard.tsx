"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — معالج إنشاء مشروع. ينشئ project + project_core + عضوية المدير +
// سجل الحالة + النشاط في معاملة واحدة (project_core_create_project)، ثم يفتح المشروع.
// منع Double Submit. عميل مسجّل أو عميل خارجي. الحقول المالية للمصرّح فقط.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  pcCreateProject, pcListClients, PC_STAGES, PC_STAGE_LABELS, PRIORITY_LABELS, pcErr,
  type ClientLite, type PcPriority, type PcStage,
} from "@/lib/portal/projectCore";
import { projectHierarchyMastersList, SCOPE_LABELS, hierErr, type ProjectScope, type MasterLite } from "@/lib/portal/projectHierarchy";

const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const lbl = "text-[11px] text-stone-500 mb-1 block";
const PRIORITIES: PcPriority[] = ["low", "normal", "high", "urgent"];
const SCOPES: ProjectScope[] = ["standalone", "master", "subproject"];

// 6A: props اختيارية — «إضافة مشروع فرعي» من صفحة المشروع الرئيسي تمرّ parentProjectId فيُحدَّد تلقائيًّا.
export default function CreateProjectWizard({ onClose, onCreated, parentProjectId, initialScope }:
  { onClose: () => void; onCreated: () => void; parentProjectId?: string; initialScope?: ProjectScope }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const router = useRouter();
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [clientsFailed, setClientsFailed] = useState(false);
  const [external, setExternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [masters, setMasters] = useState<MasterLite[]>([]);
  const [mastersErr, setMastersErr] = useState("");
  const [inherit, setInherit] = useState({ manager: true, team: false, governance: false });
  const [f, setF] = useState({
    project_name: "", client_id: "", client_name: "", client_company: "", project_type: "",
    priority: "normal" as PcPriority, core_stage: "planning" as PcStage,
    start_date: "", due_date: "", budget_amount: "", description: "",
    project_scope: (initialScope ?? (parentProjectId ? "subproject" : "standalone")) as ProjectScope,
    parent_project_id: parentProjectId ?? "",
  });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));
  const isSub = f.project_scope === "subproject";

  useEffect(() => {
    void pcListClients().then((r) => { if (r.ok) setClients(r.data); else setClientsFailed(true); });
  }, []);
  // قائمة المشاريع الرئيسية المرئية لاختيار الأب (RPC مخصّص — لا نمسّ دشبورد المشاريع).
  // الفشل يُعرَض للمستخدم بدل قائمة فارغة وزر معطّل بلا تفسير.
  useEffect(() => {
    if (!isSub || parentProjectId) return;
    setMastersErr("");
    void projectHierarchyMastersList().then((r) => { if (r.ok) setMasters(r.data.masters); else setMastersErr(hierErr(r.error)); });
  }, [isSub, parentProjectId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const useExternal = external || clientsFailed;   // إن تعذّر جلب قائمة العملاء (RLS) → إدخال يدوي
  // الفرع يرث العميل من أبيه إلزاميًّا (قاعدة «نفس العميل») ⇒ لا يُطلب اختيار عميل له.
  const ready = !!f.project_name.trim() && (isSub ? !!f.parent_project_id : (useExternal ? !!f.client_name.trim() : !!f.client_id));

  async function submit() {
    if (busy || !ready) return;
    setBusy(true); setErr("");
    const payload: Record<string, unknown> = {
      project_name: f.project_name.trim(), project_type: f.project_type.trim() || undefined,
      priority: f.priority, core_stage: f.core_stage,
      start_date: f.start_date || undefined, due_date: f.due_date || undefined,
      description: f.description.trim() || undefined,
      project_scope: f.project_scope,
      ...(caps.canSeeFinancials && f.budget_amount ? { budget_amount: f.budget_amount } : {}),
      // الفرع: الأب + الوراثة الاختيارية (لا ميزانية/تواريخ/مهام/مخرجات). غير الفرع: العميل.
      ...(isSub
        ? { parent_project_id: f.parent_project_id, inherit_manager: inherit.manager, inherit_team: inherit.team, inherit_governance: inherit.governance }
        : (useExternal ? { client_name: f.client_name.trim(), client_company: f.client_company.trim() || undefined } : { client_id: f.client_id })),
    };
    const r = await pcCreateProject(payload);
    setBusy(false);
    if (!r.ok) { setErr(/hierarchy|parent|scope|circular|master/i.test(r.error) ? hierErr(r.error) : pcErr(r.error)); return; }
    onCreated();
    router.push(`/client-portal/project-core/${r.data.project_id}`);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg my-4 bg-stone-950 border border-stone-800 rounded-2xl shadow-2xl" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800 sticky top-0 bg-stone-950 rounded-t-2xl">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "إنشاء مشروع جديد", en: "Create Project" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-sm">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <span className={lbl}>{t({ ar: "اسم المشروع *", en: "Project name *" })}</span>
            <input value={f.project_name} onChange={(e) => set("project_name", e.target.value)} className={inp} placeholder={t({ ar: "مثال: تغطية مؤتمر…", en: "e.g. Conference coverage…" })} />
          </div>

          {/* 6A: نوع المشروع */}
          <div>
            <span className={lbl}>{t({ ar: "نوع المشروع *", en: "Project type *" })}</span>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t({ ar: "نوع المشروع", en: "Project type" })}>
              {SCOPES.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={f.project_scope === s}
                  disabled={!!parentProjectId && s !== "subproject"}
                  onClick={() => { set("project_scope", s); if (s !== "subproject") set("parent_project_id", ""); }}
                  className={`text-[11px] rounded-lg px-2 py-2 border ${f.project_scope === s ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400 hover:text-white"} disabled:opacity-40`}>
                  {t(SCOPE_LABELS[s])}
                </button>
              ))}
            </div>
          </div>

          {/* 6A: المشروع الرئيسي (يظهر فقط للفرعي) */}
          {isSub && (
            <div className="space-y-2 border border-sky-900/50 bg-sky-950/10 rounded-lg p-2.5">
              <div>
                <span className={lbl}>{t({ ar: "المشروع الرئيسي *", en: "Master project *" })}</span>
                {parentProjectId ? (
                  <p className="text-xs text-sky-300">{t({ ar: "محدَّد تلقائيًّا من صفحة المشروع الرئيسي.", en: "Auto-selected from the master project." })}</p>
                ) : (
                  <>
                    <select value={f.parent_project_id} onChange={(e) => set("parent_project_id", e.target.value)} className={inp} style={{ colorScheme: "dark" }}>
                      <option value="">{t({ ar: "— اختر مشروعًا رئيسيًّا —", en: "— select master —" })}</option>
                      {masters.map((m) => <option key={m.id} value={m.id}>{m.project_name}</option>)}
                    </select>
                    {mastersErr && <p className="text-[10px] text-red-300 mt-1">{mastersErr}</p>}
                    {!mastersErr && masters.length === 0 && <p className="text-[10px] text-amber-400/80 mt-1">{t({ ar: "لا مشاريع رئيسية متاحة — رقِّ مشروعًا إلى «رئيسي» أولًا.", en: "No masters available — promote a project first." })}</p>}
                  </>
                )}
                <p className="text-[10px] text-stone-500 mt-1">{t({ ar: "العميل يُورَّث إلزاميًّا من المشروع الرئيسي.", en: "Client is inherited from the master." })}</p>
              </div>
              <div>
                <span className={lbl}>{t({ ar: "وراثة اختيارية", en: "Optional inheritance" })}</span>
                <div className="flex flex-wrap gap-3 text-[11px] text-stone-300">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={inherit.manager} onChange={(e) => setInherit((p) => ({ ...p, manager: e.target.checked }))} />{t({ ar: "مدير المشروع", en: "Manager" })}</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={inherit.team} onChange={(e) => setInherit((p) => ({ ...p, team: e.target.checked }))} />{t({ ar: "أعضاء الفريق", en: "Team" })}</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={inherit.governance} onChange={(e) => setInherit((p) => ({ ...p, governance: e.target.checked }))} />{t({ ar: "إعدادات الحوكمة", en: "Governance" })}</label>
                </div>
                <p className="text-[10px] text-stone-600 mt-1">{t({ ar: "لا تُورَث الميزانية ولا التواريخ ولا المهام ولا المخرجات.", en: "Budget, dates, tasks and deliverables are never inherited." })}</p>
              </div>
            </div>
          )}

          {/* العميل (غير الفرعي — الفرع يرث عميل أبيه) */}
          {!isSub && <div>
            <div className="flex items-center justify-between">
              <span className={lbl}>{t({ ar: "العميل *", en: "Client *" })}</span>
              {!clientsFailed && <button type="button" onClick={() => setExternal((v) => !v)} className="text-[11px] text-sky-400">{external ? t({ ar: "اختيار عميل مسجّل", en: "Pick registered" }) : t({ ar: "عميل خارجي جديد", en: "New external" })}</button>}
            </div>
            {external || clientsFailed ? (
              <div className="space-y-2">
                <input value={f.client_name} onChange={(e) => set("client_name", e.target.value)} className={inp} placeholder={t({ ar: "اسم العميل", en: "Client name" })} />
                <input value={f.client_company} onChange={(e) => set("client_company", e.target.value)} className={inp} placeholder={t({ ar: "الشركة (اختياري)", en: "Company (optional)" })} />
              </div>
            ) : (
              <select value={f.client_id} onChange={(e) => set("client_id", e.target.value)} className={inp} style={{ colorScheme: "dark" }}>
                <option value="">{t({ ar: "— اختر عميلًا —", en: "— select client —" })}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{[c.full_name, c.company].filter(Boolean).join(" — ") || c.id.slice(0, 8)}</option>)}
              </select>
            )}
          </div>}

          <div className="grid grid-cols-2 gap-3">
            <div><span className={lbl}>{t({ ar: "تصنيف المشروع", en: "Category" })}</span><input value={f.project_type} onChange={(e) => set("project_type", e.target.value)} className={inp} placeholder={t({ ar: "فيديو / تصوير…", en: "Video / Photo…" })} /></div>
            <div><span className={lbl}>{t({ ar: "الأولوية", en: "Priority" })}</span>
              <select value={f.priority} onChange={(e) => set("priority", e.target.value)} className={inp} style={{ colorScheme: "dark" }}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{t(PRIORITY_LABELS[p])}</option>)}
              </select></div>
            <div><span className={lbl}>{t({ ar: "المرحلة الابتدائية", en: "Initial stage" })}</span>
              <select value={f.core_stage} onChange={(e) => set("core_stage", e.target.value)} className={inp} style={{ colorScheme: "dark" }}>
                {PC_STAGES.slice(0, 5).map((s) => <option key={s} value={s}>{t(PC_STAGE_LABELS[s])}</option>)}
              </select></div>
            <div><span className={lbl}>{t({ ar: "تاريخ البداية", en: "Start date" })}</span><input type="date" value={f.start_date} onChange={(e) => set("start_date", e.target.value)} className={inp} style={{ colorScheme: "dark" }} /></div>
            <div><span className={lbl}>{t({ ar: "الموعد النهائي", en: "Due date" })}</span><input type="date" value={f.due_date} onChange={(e) => set("due_date", e.target.value)} className={inp} style={{ colorScheme: "dark" }} /></div>
            {caps.canSeeFinancials && <div><span className={lbl}>{t({ ar: "الميزانية (SAR)", en: "Budget (SAR)" })}</span><input type="number" min={0} value={f.budget_amount} onChange={(e) => set("budget_amount", e.target.value)} className={inp} /></div>}
          </div>
          <div><span className={lbl}>{t({ ar: "الوصف", en: "Description" })}</span><textarea value={f.description} onChange={(e) => set("description", e.target.value)} className={`${inp} min-h-[64px]`} /></div>

          {err && <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/50 rounded p-2">{err}</div>}
        </div>
        <div className="flex gap-2 px-4 py-3 border-t border-stone-800 sticky bottom-0 bg-stone-950 rounded-b-2xl">
          <button disabled={busy || !ready} onClick={() => void submit()} className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium py-2.5">{busy ? "…" : t({ ar: "إنشاء وفتح المشروع", en: "Create & open" })}</button>
          <button disabled={busy} onClick={onClose} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-300 text-sm px-4">{t({ ar: "إلغاء", en: "Cancel" })}</button>
        </div>
      </div>
    </div>
  );
}
