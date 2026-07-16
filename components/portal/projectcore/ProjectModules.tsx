"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويبات وحدات المشروع: الفريق، المخرجات، التكاليف، المخاطر،
// الاجتماعات، جلسات التصوير، الجدول الزمني. كلها Functional End-to-End عبر RPCs.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { PROJECT_STAFF_ROLES, STAFF_ROLE_LABELS } from "@/lib/portal/roles";
import { CallSheetManager } from "./CallSheet";
import {
  pcListMembers, pcMemberAdd, pcMemberRemove, pcListStaff, pcListDeliverables,
  pcListCosts, pcCostAdd, pcListRisks, pcRiskUpsert, pcEntityDelete, type TrashEntity,
  pcListMeetings, pcMeetingUpsert, pcListShoots, pcShootUpsert, pcListStatusHistory, pcGetCallSheetMeta,
  pcListDeliverableVersions, pcDeliverableVersionAdd, pcMeetingToTask,
  PC_STAGE_LABELS, SEVERITY_LABELS, RISK_STATUS_LABELS, SHOOT_STATUS_LABELS, DLV_LABEL, pcErr, fmtDT,
  type ProjectMemberRow, type StaffLite, type Deliverable, type ProjectCost, type ProjectRisk,
  type ProjectMeeting, type ShootSession, type StatusHistoryRow, type PcStage, type DeliverableVersion,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
type Flash = (m: string) => void;
const money = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

// حذف موحّد بسبب إلزامي (Soft Delete قابل للاستعادة من تبويب «المحذوفات»).
async function delWithReason(entity: TrashEntity, id: string, label: string,
  t: (v: { ar: string; en: string }) => string, flash: Flash, after: () => void | Promise<void>) {
  const rs = window.prompt(t({ ar: `حذف «${label}» — سبب الحذف (إلزامي):`, en: "Delete reason (required):" }));
  if (rs === null) return;
  if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
  const r = await pcEntityDelete(entity, id, rs.trim());
  if (!r.ok) { flash(pcErr(r.error)); return; }
  flash(t({ ar: "حُذف (استعادة من تبويب المحذوفات).", en: "Deleted (restorable from Trash)." }));
  await after();
}

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

// ─── المخرجات (من نظام المخرجات الحالي) + إدارة الإصدارات ───
export function DeliverablesTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Deliverable[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { void pcListDeliverables(projectId).then((r) => { if (r.ok) setRows(r.data); }); }, [projectId]);
  if (rows.length === 0) return <p className="text-xs text-stone-500">{t({ ar: "لا توجد مخرجات بعد. تُنشأ المخرجات من صفحة المشروع في «المشاريع»؛ وتُدار إصداراتها هنا.", en: "No deliverables yet — created from the Projects page; versions managed here." })}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((d) => (
        <div key={d.id} className={`${card} p-3`}>
          <div className="flex items-center justify-between gap-2">
            <button onClick={() => setOpen(open === d.id ? null : d.id)} className="min-w-0 text-right flex-1"><div className="text-sm text-stone-200 truncate">{d.title}</div><div className="text-[11px] text-stone-500">v{d.version} · {d.type}</div></button>
            <span className="text-[11px] px-2 py-0.5 rounded bg-stone-800 text-stone-300 shrink-0">{t(DLV_LABEL[d.status] ?? { ar: d.status, en: d.status })}</span>
          </div>
          {open === d.id && <DeliverableVersions deliverableId={d.id} canManage={canManage} flash={flash} />}
        </div>
      ))}
    </div>
  );
}

function DeliverableVersions({ deliverableId, canManage, flash }: { deliverableId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [vers, setVers] = useState<DeliverableVersion[]>([]);
  const [url, setUrl] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListDeliverableVersions(deliverableId); if (r.ok) setVers(r.data); }, [deliverableId]);
  useEffect(() => { void load(); }, [load]);
  async function add() { if (busy) return; setBusy(true); const r = await pcDeliverableVersionAdd(deliverableId, { preview_url: url.trim() || undefined, note: note.trim() || undefined }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setUrl(""); setNote(""); await load(); }
  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2 text-xs">
      <div className="text-[11px] text-stone-500">{t({ ar: "الإصدارات", en: "Versions" })}</div>
      {vers.map((v) => (
        <div key={v.id} className="bg-stone-950 border border-stone-800 rounded p-2 flex items-center justify-between gap-2">
          <div className="min-w-0"><span className="text-stone-200">v{v.version}</span>{v.note && <span className="mr-2 text-stone-500">· {v.note}</span>}</div>
          {v.preview_url && <a href={v.preview_url} target="_blank" rel="noreferrer" className="text-sky-400 shrink-0" dir="ltr">{t({ ar: "معاينة", en: "Preview" })}</a>}
        </div>
      ))}
      {vers.length === 0 && <p className="text-stone-600">{t({ ar: "لا إصدارات.", en: "No versions." })}</p>}
      {canManage && (
        <div className="flex flex-wrap gap-1.5">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t({ ar: "رابط المعاينة", en: "Preview URL" })} className={`${inp} flex-1 min-w-[120px] py-1`} dir="ltr" />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t({ ar: "ملاحظة", en: "Note" })} className={`${inp} flex-1 min-w-[100px] py-1`} />
          <button disabled={busy || (!url.trim() && !note.trim())} onClick={() => void add()} className={`${btnRed} px-3 py-1`}>{t({ ar: "+ نسخة", en: "+ Version" })}</button>
        </div>
      )}
    </div>
  );
}

// ─── التكاليف (مالية) ───
export function CostsTab({ projectId, canManage = true, flash }: { projectId: string; canManage?: boolean; flash: Flash }) {
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
  const del = (c: ProjectCost) => delWithReason("cost", c.id, c.description ?? c.category, t, flash, load);
  return (
    <div className="space-y-3">
      <div className={`${card} p-3 flex items-center justify-between`}><span className="text-xs text-stone-400">{t({ ar: "إجمالي التكاليف", en: "Total costs" })}</span><span className="text-lg font-bold text-stone-200" dir="ltr">{money(total)} SAR</span></div>
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={t({ ar: "المبلغ", en: "Amount" })} className={`${inp} w-28`} />
          <select value={cat} onChange={(e) => setCat(e.target.value)} className={inp} style={{ colorScheme: "dark" }}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={t({ ar: "الوصف", en: "Description" })} className={`${inp} flex-1 min-w-[120px]`} />
          <button disabled={busy || !amount} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}
      {rows.map((c) => (
        <div key={c.id} className={`${card} p-2.5 flex items-center justify-between gap-2 text-xs`}>
          <div><span className="text-stone-200" dir="ltr">{money(Number(c.amount))} SAR</span><span className="mr-2 text-stone-500">· {c.category}{c.description ? ` · ${c.description}` : ""}</span></div>
          <div className="flex items-center gap-2"><span className="text-stone-600" dir="ltr">{c.cost_date}</span>{canManage && <button onClick={() => void del(c)} className="text-stone-600 hover:text-red-400">✕</button>}</div>
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
          {canManage && <div className="mt-1 text-left"><button onClick={() => void delWithReason("risk", r.id, r.title, t, flash, load)} className="text-[10px] text-stone-600 hover:text-red-400">{t({ ar: "حذف بسبب", en: "Delete" })}</button></div>}
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
  async function toTask(m: ProjectMeeting) {
    if (busy) return;
    const tl = window.prompt(t({ ar: "بند العمل → عنوان المهمة:", en: "Action item → task title:" }), m.title);
    if (!tl || !tl.trim()) return;
    setBusy(true);
    const r = await pcMeetingToTask(m.id, tl.trim());
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "أُنشئت مهمة مرتبطة بالاجتماع.", en: "Task created from meeting." }));
  }
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
        <div key={m.id} className={`${card} p-3 text-xs flex items-center justify-between gap-2`}>
          <span className="text-stone-200 min-w-0 truncate">{m.title}{m.scheduled_at && <span className="mr-2 text-stone-500" dir="ltr">{fmtDT(m.scheduled_at)}</span>}</span>
          {canManage && (
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={() => void toTask(m)} className="text-[11px] text-sky-400 hover:text-sky-300">{t({ ar: "→ مهمة", en: "→ Task" })}</button>
              <button onClick={() => void delWithReason("meeting", m.id, m.title, t, flash, load)} className="text-[11px] text-stone-600 hover:text-red-400">{t({ ar: "حذف", en: "Delete" })}</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── جلسات التصوير ───
const shootLines = (arr: unknown[] | undefined) => (arr ?? []).map((x) => typeof x === "string" ? x : JSON.stringify(x)).join("\n");
const shootArr = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
// timestamptz → قيمة datetime-local بالمنطقة المحلية (وليس UTC) — حتى يطابق ما يظهر في البطاقة.
const timeLocal = (s: string | null | undefined) => {
  if (!s) return "";
  const d = new Date(s); const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
// قيمة datetime-local (محلية) → ISO للتخزين.
const timeIso = (s: string) => s ? new Date(s).toISOString() : null;

// محرّر تفاصيل الجلسة (Module-scope — لا فقدان تركيز): أوقات + طاقم + معدات + لقطات + حضور + تقرير.
function ShootDetail({ projectId, sh, onSaved, flash }: { projectId: string; sh: ShootSession; onSaved: () => void; flash: Flash }) {
  const { t } = useI18n();
  const [f, setF] = useState({
    session_date: sh.session_date ?? "", call_time: timeLocal(sh.call_time), start_time: timeLocal(sh.start_time),
    wrap_time: timeLocal(sh.wrap_time), location: sh.location ?? "", client_contact: sh.client_contact ?? "",
    permits: sh.permits ?? "", safety_notes: sh.safety_notes ?? "", weather_note: sh.weather_note ?? "",
    crew: shootLines(sh.crew), equipment: shootLines(sh.equipment), vehicles: shootLines(sh.vehicles),
    shot_list: shootLines(sh.shot_list), attendance: shootLines(sh.attendance), completion_report: sh.completion_report ?? "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    if (busy) return; setBusy(true);
    const r = await pcShootUpsert(projectId, {
      id: sh.id, session_date: f.session_date || undefined,
      call_time: timeIso(f.call_time), start_time: timeIso(f.start_time), wrap_time: timeIso(f.wrap_time),
      location: f.location.trim() || undefined, client_contact: f.client_contact.trim() || undefined,
      permits: f.permits.trim() || undefined, safety_notes: f.safety_notes.trim() || undefined,
      weather_note: f.weather_note.trim() || undefined,
      crew: shootArr(f.crew), equipment: shootArr(f.equipment), vehicles: shootArr(f.vehicles),
      shot_list: shootArr(f.shot_list), attendance: shootArr(f.attendance),
      completion_report: f.completion_report.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "حُفظت تفاصيل الجلسة.", en: "Session saved." })); onSaved();
  }
  const Fld = (k: string, ar: string, en: string, type = "text") => (
    <label className="block"><span className="text-[10px] text-stone-500">{t({ ar, en })}</span>
      <input type={type} value={(f as Record<string, string>)[k]} onChange={(e) => set(k, e.target.value)} className={`${inp} w-full mt-0.5`} style={type !== "text" ? { colorScheme: "dark" } : {}} /></label>
  );
  const Area = (k: string, ar: string, en: string) => (
    <label className="block"><span className="text-[10px] text-stone-500">{t({ ar, en })} <span className="text-stone-600">({t({ ar: "سطر لكل عنصر", en: "one per line" })})</span></span>
      <textarea value={(f as Record<string, string>)[k]} onChange={(e) => set(k, e.target.value)} className={`${inp} w-full mt-0.5 min-h-[48px]`} /></label>
  );
  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {Fld("session_date", "التاريخ", "Date", "date")}
        {Fld("call_time", "Call Time", "Call Time", "datetime-local")}
        {Fld("start_time", "بداية التصوير", "Start", "datetime-local")}
        {Fld("wrap_time", "Wrap", "Wrap", "datetime-local")}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {Fld("location", "الموقع", "Location")}
        {Fld("client_contact", "مسؤول العميل", "Client contact")}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {Area("crew", "الفريق", "Crew")}{Area("equipment", "المعدات والتجهيزات", "Equipment")}
        {Area("vehicles", "المركبات", "Vehicles")}{Area("shot_list", "قائمة اللقطات", "Shot list")}
        {Area("attendance", "الحضور", "Attendance")}
        <label className="block"><span className="text-[10px] text-stone-500">{t({ ar: "تقرير الإكمال", en: "Completion report" })}</span>
          <textarea value={f.completion_report} onChange={(e) => set("completion_report", e.target.value)} className={`${inp} w-full mt-0.5 min-h-[48px]`} /></label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {Fld("permits", "التصاريح", "Permits")}{Fld("safety_notes", "السلامة", "Safety")}{Fld("weather_note", "الطقس", "Weather")}
      </div>
      <button disabled={busy} onClick={() => void save()} className={`${btnRed} px-4 py-2`}>{busy ? "…" : t({ ar: "حفظ التفاصيل", en: "Save" })}</button>
    </div>
  );
}

export function ShootsTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ShootSession[]>([]);
  const [title, setTitle] = useState(""); const [date, setDate] = useState(""); const [loc, setLoc] = useState(""); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [openCS, setOpenCS] = useState<string | null>(null);
  const [deepCS, setDeepCS] = useState<string | null>(null);
  const load = useCallback(async () => { const r = await pcListShoots(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  // رابط عميق: ?tab=shoots&entity=call_sheet&id=… → افتح الجلسة الحاضنة ومعاينة النسخة.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const id = sp.get("entity") === "call_sheet" ? sp.get("id") : null;
    if (!id) return;
    void pcGetCallSheetMeta(id).then((r) => {
      if (r.ok && r.data) { setOpenCS(r.data.shoot_session_id); setDeepCS(id); }
    });
  }, []);
  async function add() { if (busy || !title.trim()) return; setBusy(true); const r = await pcShootUpsert(projectId, { title: title.trim(), session_date: date || undefined, location: loc || undefined }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setTitle(""); setDate(""); setLoc(""); await load(); }
  async function setStatus(sh: ShootSession, status: string) {
    let reason: string | undefined;
    if (status === "cancelled") {
      const rs = window.prompt(t({ ar: "سبب إلغاء الجلسة (إلزامي):", en: "Cancel reason (required):" }));
      if (rs === null) return;
      if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
      reason = rs.trim();
    }
    const r = await pcShootUpsert(projectId, { id: sh.id, status, ...(reason ? { cancel_reason: reason } : {}) });
    if (!r.ok) { flash(pcErr(r.error)); return; }
    await load();
  }
  const stBadge: Record<string, string> = {
    planned: "bg-stone-800 text-stone-300", confirmed: "bg-sky-900/40 text-sky-300", in_progress: "bg-amber-900/40 text-amber-300",
    completed: "bg-emerald-900/40 text-emerald-300", cancelled: "bg-red-900/40 text-red-300",
  };
  const timeStr = (s: string | null | undefined) => s ? fmtDT(s).slice(11) || fmtDT(s) : "—";
  return (
    <div className="space-y-3">
      {canManage && (
        <div className={`${card} p-3 space-y-2`}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "اسم الجلسة…", en: "Session name…" })} className={`${inp} w-full`} />
          <div className="flex flex-wrap gap-2 items-end">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} style={{ colorScheme: "dark" }} />
            <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder={t({ ar: "الموقع", en: "Location" })} className={`${inp} flex-1 min-w-[120px]`} />
            <button disabled={busy || !title.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة جلسة", en: "Add session" })}</button>
          </div>
        </div>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد جلسات تصوير.", en: "No shoot sessions." })}</p>}
      {rows.map((sh) => (
        <div key={sh.id} className={`${card} p-3 text-xs`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="min-w-0 flex-1">
              <span className="text-sm text-stone-100 font-medium">{sh.title}</span>
              <span className={`mr-2 px-1.5 py-0.5 rounded text-[10px] ${stBadge[sh.status] ?? "bg-stone-800 text-stone-300"}`}>{t(SHOOT_STATUS_LABELS[sh.status] ?? { ar: sh.status, en: sh.status })}</span>
            </div>
            {canManage && (
              <select value={sh.status} onChange={(e) => void setStatus(sh, e.target.value)} className="bg-stone-800 border border-stone-700 rounded px-1.5 py-1 text-[11px] text-stone-200" style={{ colorScheme: "dark" }} title={t({ ar: "تغيير حالة الجلسة", en: "Change status" })}>
                {Object.keys(SHOOT_STATUS_LABELS).map((s) => <option key={s} value={s}>{t(SHOOT_STATUS_LABELS[s])}</option>)}
              </select>
            )}
          </div>
          <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] text-stone-500">
            <span>{t({ ar: "التاريخ", en: "Date" })}: <span dir="ltr" className="text-stone-300">{sh.session_date ? fmtDT(sh.session_date).slice(0, 10) : "—"}</span></span>
            <span>Call: <span dir="ltr" className="text-stone-300">{timeStr(sh.call_time)}</span></span>
            <span>{t({ ar: "البداية", en: "Start" })}: <span dir="ltr" className="text-stone-300">{timeStr(sh.start_time)}</span></span>
            <span>Wrap: <span dir="ltr" className="text-stone-300">{timeStr(sh.wrap_time)}</span></span>
            <span className="col-span-2">{t({ ar: "الموقع", en: "Location" })}: <span className="text-stone-300">{sh.location ?? "—"}</span></span>
            <span>{t({ ar: "الفريق", en: "Crew" })}: <span className="text-stone-300" dir="ltr">{(sh.crew ?? []).length}</span></span>
            <span>{t({ ar: "المعدات", en: "Equip." })}: <span className="text-stone-300" dir="ltr">{(sh.equipment ?? []).length}</span></span>
          </div>
          {sh.status === "cancelled" && sh.cancel_reason && <div className="mt-1 text-[10px] text-red-400">{t({ ar: "سبب الإلغاء", en: "Cancelled" })}: {sh.cancel_reason}</div>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => setOpen(open === sh.id ? null : sh.id)} className={`${btnGhost} px-2.5 py-1 text-[11px]`}>
              {open === sh.id ? t({ ar: "إغلاق التفاصيل", en: "Close" }) : t({ ar: "فتح / تعديل التفاصيل", en: "Open / edit" })}
            </button>
            <button onClick={() => setOpenCS(openCS === sh.id ? null : sh.id)} className={`${btnGhost} px-2.5 py-1 text-[11px] text-sky-300`}>
              Call Sheet {openCS === sh.id ? "▴" : "▾"}
            </button>
            {canManage && <button onClick={() => void delWithReason("shoot", sh.id, sh.title, t, flash, load)} className={`${btnGhost} px-2.5 py-1 text-[11px] text-red-400 border-red-900/50`}>{t({ ar: "حذف بسبب", en: "Delete" })}</button>}
          </div>
          {open === sh.id && canManage && <ShootDetail projectId={projectId} sh={sh} onSaved={() => void load()} flash={flash} />}
          {open === sh.id && !canManage && (
            <div className="mt-2 pt-2 border-t border-stone-800 space-y-1 text-[11px] text-stone-400">
              {(sh.crew ?? []).length > 0 && <div>{t({ ar: "الفريق", en: "Crew" })}: {shootLines(sh.crew).split("\n").join("، ")}</div>}
              {(sh.equipment ?? []).length > 0 && <div>{t({ ar: "المعدات", en: "Equipment" })}: {shootLines(sh.equipment).split("\n").join("، ")}</div>}
              {sh.completion_report && <div>{t({ ar: "تقرير الإكمال", en: "Report" })}: {sh.completion_report}</div>}
            </div>
          )}
          {openCS === sh.id && <CallSheetManager shoot={sh} canManage={canManage} flash={flash} initialPreviewId={deepCS ?? undefined} />}
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
            <span className="text-[10px] text-stone-600" dir="ltr">{fmtDT(h.created_at)}</span>
          </div>
          {h.note && <div className="text-[11px] text-stone-500 mt-0.5">{h.note}</div>}
        </div>
      ))}
    </div>
  );
}
