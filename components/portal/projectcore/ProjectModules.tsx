"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويبات وحدات المشروع: الفريق، المخرجات، التكاليف، المخاطر،
// الاجتماعات، جلسات التصوير، الجدول الزمني. كلها Functional End-to-End عبر RPCs.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { PROJECT_STAFF_ROLES, STAFF_ROLE_LABELS } from "@/lib/portal/roles";
import {
  pcListMembers, pcMemberAdd, pcMemberRemove, pcListStaff, pcListDeliverables,
  pcListCosts, pcCostAdd, pcCostDelete, pcListRisks, pcRiskUpsert,
  pcListMeetings, pcMeetingUpsert, pcListShoots, pcShootUpsert, pcListStatusHistory,
  PC_STAGE_LABELS, SEVERITY_LABELS, RISK_STATUS_LABELS, SHOOT_STATUS_LABELS, DLV_LABEL, pcErr,
  type ProjectMemberRow, type StaffLite, type Deliverable, type ProjectCost, type ProjectRisk,
  type ProjectMeeting, type ShootSession, type StatusHistoryRow, type PcStage,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
type Flash = (m: string) => void;
const money = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

// ─── الفريق ───
export function TeamTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [uid, setUid] = useState("");
  const [role, setRole] = useState("kian_editor");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [m, s] = await Promise.all([pcListMembers(projectId), pcListStaff()]);
    if (m.ok) setMembers(m.data.filter((x) => x.role.startsWith("kian_")));
    if (s.ok) setStaff(s.data);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  const nameOf = (id: string) => staff.find((s) => s.id === id)?.full_name || id.slice(0, 8);
  async function add() { if (busy || !uid) return; setBusy(true); const r = await pcMemberAdd(projectId, uid, role); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setUid(""); await load(); }
  async function remove(m: ProjectMemberRow) { if (!window.confirm(t({ ar: "إزالة العضو؟", en: "Remove member?" }))) return; const r = await pcMemberRemove(projectId, m.user_id); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  const roleLabel = (r: string) => PROJECT_STAFF_ROLES.find((x) => x.key === r)?.ar ?? r;
  const assigned = new Set(members.map((m) => m.user_id));
  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <select value={uid} onChange={(e) => setUid(e.target.value)} className={`${inp} flex-1 min-w-[150px]`} style={{ colorScheme: "dark" }}>
            <option value="">{t({ ar: "— اختر موظفًا —", en: "— select staff —" })}</option>
            {staff.filter((s) => !assigned.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.full_name || s.id.slice(0, 8)}{s.staff_role ? ` (${t(STAFF_ROLE_LABELS[s.staff_role] ?? { ar: s.staff_role, en: s.staff_role })})` : ""}</option>)}
          </select>
          <select value={role} onChange={(e) => setRole(e.target.value)} className={inp} style={{ colorScheme: "dark" }}>
            {PROJECT_STAFF_ROLES.map((r) => <option key={r.key} value={r.key}>{t(r)}</option>)}
          </select>
          <button disabled={busy || !uid} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}
      {members.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا يوجد أعضاء فريق بعد.", en: "No team members yet." })}</p>}
      {members.map((m) => (
        <div key={m.id} className={`${card} p-3 flex items-center justify-between`}>
          <div><span className="text-sm text-stone-200">{nameOf(m.user_id)}</span><span className="mr-2 text-[11px] text-stone-500">· {roleLabel(m.role)}</span></div>
          {canManage && <button onClick={() => void remove(m)} className="text-stone-600 hover:text-red-400 text-xs">{t({ ar: "إزالة", en: "Remove" })}</button>}
        </div>
      ))}
    </div>
  );
}

// ─── المخرجات (قراءة من نظام المخرجات الحالي) ───
export function DeliverablesTab({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Deliverable[]>([]);
  useEffect(() => { void pcListDeliverables(projectId).then((r) => { if (r.ok) setRows(r.data); }); }, [projectId]);
  if (rows.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا توجد مخرجات بعد. تُدار المخرجات من صفحة المشروع في «المشاريع».", en: "No deliverables yet. Managed from the Projects page." })}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((d) => (
        <div key={d.id} className={`${card} p-3 flex items-center justify-between gap-2`}>
          <div className="min-w-0"><div className="text-sm text-stone-200 truncate">{d.title}</div><div className="text-[11px] text-stone-500">v{d.version} · {d.type}</div></div>
          <span className="text-[11px] px-2 py-0.5 rounded bg-stone-800 text-stone-300 shrink-0">{t(DLV_LABEL[d.status] ?? { ar: d.status, en: d.status })}</span>
        </div>
      ))}
    </div>
  );
}

// ─── التكاليف (مالية) ───
export function CostsTab({ projectId, flash }: { projectId: string; flash: Flash }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const [rows, setRows] = useState<ProjectCost[]>([]);
  const [amount, setAmount] = useState(""); const [desc, setDesc] = useState(""); const [cat, setCat] = useState("general");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListCosts(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  if (!caps.canSeeFinancials) return <p className="text-xs text-stone-500">{t({ ar: "التكاليف متاحة للإدارة/المالية فقط.", en: "Costs are visible to management/finance only." })}</p>;
  const total = rows.reduce((s, r) => s + Number(r.amount), 0);
  const CATS = ["general", "crew", "equipment", "transport", "location", "post", "licensing", "other"];
  async function add() { if (busy || !amount) return; setBusy(true); const r = await pcCostAdd(projectId, { amount, description: desc, category: cat }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setAmount(""); setDesc(""); await load(); }
  async function del(c: ProjectCost) { if (!window.confirm(t({ ar: "حذف التكلفة؟", en: "Delete cost?" }))) return; const r = await pcCostDelete(c.id); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  return (
    <div className="space-y-3">
      <div className={`${card} p-3 flex items-center justify-between`}><span className="text-xs text-stone-400">{t({ ar: "إجمالي التكاليف", en: "Total costs" })}</span><span className="text-lg font-bold text-stone-200" dir="ltr">{money(total)} SAR</span></div>
      <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
        <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t({ ar: "المبلغ", en: "Amount" })} className={`${inp} w-28`} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} className={inp} style={{ colorScheme: "dark" }}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t({ ar: "الوصف", en: "Description" })} className={`${inp} flex-1 min-w-[120px]`} />
        <button disabled={busy || !amount} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
      </div>
      {rows.map((c) => (
        <div key={c.id} className={`${card} p-2.5 flex items-center justify-between gap-2 text-xs`}>
          <div><span className="text-stone-200" dir="ltr">{money(Number(c.amount))} SAR</span><span className="mr-2 text-stone-500">· {c.category}{c.description ? ` · ${c.description}` : ""}</span></div>
          <div className="flex items-center gap-2"><span className="text-stone-600" dir="ltr">{c.cost_date}</span><button onClick={() => void del(c)} className="text-stone-600 hover:text-red-400">✕</button></div>
        </div>
      ))}
    </div>
  );
}

// ─── المخاطر ───
export function RisksTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProjectRisk[]>([]);
  const [title, setTitle] = useState(""); const [sev, setSev] = useState("medium"); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListRisks(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function add() { if (busy || !title.trim()) return; setBusy(true); const r = await pcRiskUpsert(projectId, { title: title.trim(), severity: sev }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setTitle(""); await load(); }
  async function setStatus(risk: ProjectRisk, status: string) { const r = await pcRiskUpsert(projectId, { id: risk.id, status }); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  const sevCls: Record<string, string> = { low: "text-stone-400", medium: "text-sky-400", high: "text-amber-400", critical: "text-red-400" };
  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "خطر جديد…", en: "New risk…" })} className={`${inp} flex-1 min-w-[140px]`} />
          <select value={sev} onChange={(e) => setSev(e.target.value)} className={inp} style={{ colorScheme: "dark" }}>{Object.keys(SEVERITY_LABELS).map((s) => <option key={s} value={s}>{t(SEVERITY_LABELS[s])}</option>)}</select>
          <button disabled={busy || !title.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد مخاطر مسجّلة.", en: "No risks logged." })}</p>}
      {rows.map((r) => (
        <div key={r.id} className={`${card} p-3 text-xs`}>
          <div className="flex items-center justify-between gap-2">
            <div><span className="text-stone-200">{r.title}</span><span className={`mr-2 ${sevCls[r.severity]}`}>● {t(SEVERITY_LABELS[r.severity])}</span></div>
            {canManage ? (
              <select value={r.status} onChange={(e) => void setStatus(r, e.target.value)} className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }}>
                {Object.keys(RISK_STATUS_LABELS).map((s) => <option key={s} value={s}>{t(RISK_STATUS_LABELS[s])}</option>)}
              </select>
            ) : <span className="text-stone-400">{t(RISK_STATUS_LABELS[r.status])}</span>}
          </div>
          {r.mitigation && <div className="text-[11px] text-stone-500 mt-1">{r.mitigation}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── الاجتماعات ───
export function MeetingsTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProjectMeeting[]>([]);
  const [title, setTitle] = useState(""); const [at, setAt] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListMeetings(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function add() { if (busy || !title.trim()) return; setBusy(true); const r = await pcMeetingUpsert(projectId, { title: title.trim(), scheduled_at: at || undefined }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setTitle(""); setAt(""); await load(); }
  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "عنوان الاجتماع…", en: "Meeting title…" })} className={`${inp} flex-1 min-w-[140px]`} />
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className={inp} style={{ colorScheme: "dark" }} />
          <button disabled={busy || !title.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد اجتماعات.", en: "No meetings." })}</p>}
      {rows.map((m) => (
        <div key={m.id} className={`${card} p-3 text-xs flex items-center justify-between`}>
          <span className="text-stone-200">{m.title}</span>
          {m.scheduled_at && <span className="text-stone-500" dir="ltr">{new Date(m.scheduled_at).toLocaleString("ar")}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── جلسات التصوير ───
export function ShootsTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ShootSession[]>([]);
  const [title, setTitle] = useState(""); const [date, setDate] = useState(""); const [loc, setLoc] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListShoots(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function add() { if (busy || !title.trim()) return; setBusy(true); const r = await pcShootUpsert(projectId, { title: title.trim(), session_date: date || undefined, location: loc || undefined }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setTitle(""); setDate(""); setLoc(""); await load(); }
  async function setStatus(sh: ShootSession, status: string) { const r = await pcShootUpsert(projectId, { id: sh.id, status }); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); }
  const stCls: Record<string, string> = { planned: "text-stone-400", confirmed: "text-sky-400", in_progress: "text-amber-400", completed: "text-emerald-400", cancelled: "text-red-400" };
  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 space-y-2`}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "اسم الجلسة…", en: "Session name…" })} className={`${inp} w-full`} />
          <div className="flex flex-wrap gap-2 items-end">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} style={{ colorScheme: "dark" }} />
            <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder={t({ ar: "الموقع", en: "Location" })} className={`${inp} flex-1 min-w-[120px]`} />
            <button disabled={busy || !title.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
          </div>
        </div>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد جلسات تصوير.", en: "No shoot sessions." })}</p>}
      {rows.map((sh) => (
        <div key={sh.id} className={`${card} p-3 text-xs`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0"><span className="text-stone-200">{sh.title}</span>{sh.location && <span className="mr-2 text-stone-500">· {sh.location}</span>}</div>
            {canManage ? (
              <select value={sh.status} onChange={(e) => void setStatus(sh, e.target.value)} className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }}>
                {Object.keys(SHOOT_STATUS_LABELS).map((s) => <option key={s} value={s}>{t(SHOOT_STATUS_LABELS[s])}</option>)}
              </select>
            ) : <span className={stCls[sh.status]}>{t(SHOOT_STATUS_LABELS[sh.status])}</span>}
          </div>
          {sh.session_date && <div className="text-[11px] text-stone-600 mt-0.5" dir="ltr">{sh.session_date}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── الجدول الزمني (سجل انتقالات المراحل) ───
export function TimelineTab({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<StatusHistoryRow[]>([]);
  useEffect(() => { void pcListStatusHistory(projectId).then((r) => { if (r.ok) setRows(r.data); }); }, [projectId]);
  const label = (s: string | null) => s ? t(PC_STAGE_LABELS[s as PcStage] ?? { ar: s, en: s }) : "—";
  if (rows.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا يوجد سجل مراحل بعد.", en: "No stage history yet." })}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((h) => (
        <div key={h.id} className={`${card} p-2.5 text-xs`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-stone-200">{label(h.from_stage)} <span className="text-stone-600">→</span> {label(h.to_stage)}</span>
            <span className="text-[10px] text-stone-600" dir="ltr">{new Date(h.created_at).toLocaleString("ar")}</span>
          </div>
          {h.note && <div className="text-[11px] text-stone-500 mt-0.5">{h.note}</div>}
        </div>
      ))}
    </div>
  );
}
