"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — «طباعة حزمة المشروع»: اختيار الأقسام + نطاق المستلم
// (إدارة/مدير/موظف/طاقم/عميل) — كل نسخة تعرض فقط البيانات المسموح بها.
// لا بيانات مالية في الحزمة إطلاقًا (المالية لها تقاريرها المعزولة).
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  pcGetProjectCore, pcScheduleFeed, pcListTasks, pcListMembers, pcListStaff, pcListShoots,
  pcListDeliverables, pcListRisks, pcListLocations, pcProgress, fmtDT,
  PC_STAGE_LABELS, TASK_STATUS_LABELS, SHOOT_STATUS_LABELS, SCHED_TYPE_LABELS, SCHED_STATUS_LABELS, DLV_LABEL, SEVERITY_LABELS,
  type ProjectCore, type ScheduleItem, type PcTask, type ProjectMemberRow, type StaffLite,
  type ShootSession, type Deliverable, type ProjectRisk, type ProjectLocation, type PcStage, type ScheduleStatus, type ScheduleEventType,
} from "@/lib/portal/projectCore";

const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";

type Scope = "management" | "pm" | "employee" | "crew" | "client";
type SectionKey = "summary" | "schedule" | "tasks" | "team" | "shoots" | "deliverables" | "risks" | "locations";
const SCOPE_LABELS: Record<Scope, { ar: string; en: string }> = {
  management: { ar: "الإدارة", en: "Management" }, pm: { ar: "مدير المشروع", en: "Project Manager" },
  employee: { ar: "موظف", en: "Employee" }, crew: { ar: "طاقم التصوير", en: "Shoot Crew" }, client: { ar: "العميل", en: "Client" },
};
const SECTION_LABELS: Record<SectionKey, { ar: string; en: string }> = {
  summary: { ar: "ملخّص المشروع", en: "Summary" }, schedule: { ar: "الخطة الزمنية", en: "Schedule" },
  tasks: { ar: "المهام", en: "Tasks" }, team: { ar: "الفريق", en: "Team" }, shoots: { ar: "جلسات التصوير", en: "Shoots" },
  deliverables: { ar: "المخرجات", en: "Deliverables" }, risks: { ar: "المخاطر", en: "Risks" }, locations: { ar: "المواقع", en: "Locations" },
};
// الأقسام المسموحة لكل نطاق — العميل: لا مهام/فريق/مخاطر/مواقع داخلية.
const SCOPE_SECTIONS: Record<Scope, SectionKey[]> = {
  management: ["summary", "schedule", "tasks", "team", "shoots", "deliverables", "risks", "locations"],
  pm:         ["summary", "schedule", "tasks", "team", "shoots", "deliverables", "risks", "locations"],
  employee:   ["summary", "schedule", "tasks", "team", "shoots", "deliverables", "locations"],
  crew:       ["summary", "schedule", "shoots", "locations", "team"],
  client:     ["summary", "schedule", "shoots", "deliverables"],
};

export function ProjectPrintPack({ projectId, projectName, onClose }: { projectId: string; projectName: string; onClose: () => void }) {
  const { t } = useI18n();
  const { profile } = usePortal();
  const [scope, setScope] = useState<Scope>("management");
  const [sel, setSel] = useState<Set<SectionKey>>(new Set(SCOPE_SECTIONS.management));
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [core, setCore] = useState<ProjectCore | null>(null);
  const [prog, setProg] = useState<number | null>(null);
  const [sched, setSched] = useState<ScheduleItem[]>([]);
  const [tasks, setTasks] = useState<PcTask[]>([]);
  const [members, setMembers] = useState<ProjectMemberRow[]>([]);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [shoots, setShoots] = useState<ShootSession[]>([]);
  const [dlvs, setDlvs] = useState<Deliverable[]>([]);
  const [risks, setRisks] = useState<ProjectRisk[]>([]);
  const [locs, setLocs] = useState<ProjectLocation[]>([]);

  const allowed = SCOPE_SECTIONS[scope];
  useEffect(() => { setSel(new Set(SCOPE_SECTIONS[scope])); }, [scope]);
  const toggle = (k: SectionKey) => setSel((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  async function build() {
    if (busy) return; setBusy(true);
    const [c, p, s, tk, m, st, sh, d, r, l] = await Promise.all([
      pcGetProjectCore(projectId), pcProgress(projectId), pcScheduleFeed(projectId),
      pcListTasks(projectId), pcListMembers(projectId), pcListStaff(), pcListShoots(projectId),
      pcListDeliverables(projectId), pcListRisks(projectId), pcListLocations(projectId),
    ]);
    setBusy(false);
    if (c.ok) setCore(c.data);
    if (p.ok) setProg(p.data.final);
    if (s.ok) setSched(s.data.items);
    if (tk.ok) setTasks(tk.data);
    if (m.ok) setMembers(m.data);
    if (st.ok) setStaff(st.data);
    if (sh.ok) setShoots(sh.data);
    if (d.ok) setDlvs(d.data);
    if (r.ok) setRisks(r.data);
    if (l.ok) setLocs(l.data);
    setReady(true);
  }
  const staffName = (id: string | null) => id ? (staff.find((x) => x.id === id)?.full_name ?? "—") : "—";
  // نطاق العميل: عناصر الخطة المرئية له فقط + لا ملاحظات داخلية.
  const schedRows = sched.filter((x) => !x.deleted && (scope !== "client" || x.client_visible));
  const genAt = fmtDT(new Date().toISOString());
  const has = (k: SectionKey) => sel.has(k) && allowed.includes(k);

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/80 p-3 sm:p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{`@page { size: A4; margin: 16mm 14mm 20mm 14mm; }
        @media print { body * { visibility: hidden !important; } .pack-print, .pack-print * { visibility: visible !important; } .pack-print { position: absolute; top: 0; left: 0; right: 0; margin: 0; padding: 20px; background: #fff; color: #111; } .pack-noprint { display: none !important; }
        .pack-foot { position: fixed; bottom: 0; left: 0; right: 0; visibility: visible !important; display: flex !important; justify-content: space-between; font-size: 9px; color: #888; border-top: 1px solid #ddd; padding: 3px 8px; background: #fff; } }
        .pack-foot { display: none; }
        .pack-print h2 { font-size: 19px; font-weight: 800; border-bottom: 2px solid #E31E24; padding-bottom: 6px; margin-bottom: 10px; }
        .pack-print h3 { font-size: 14px; font-weight: 700; color: #E31E24; margin: 14px 0 6px; page-break-after: avoid; }
        .pack-print table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
        .pack-print th, .pack-print td { border: 1px solid #e5e5e5; padding: 4px 6px; text-align: right; }
        .pack-print th { background: #f7f7f7; font-weight: 700; }
        .pack-print tr { page-break-inside: avoid; }
        .pack-print .kv { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 14px; font-size: 12px; }
        .pack-print .kv div { border-bottom: 1px solid #eee; padding: 3px 0; }`}</style>

      <div className="w-full max-w-3xl my-4 bg-stone-950 border border-stone-800 rounded-2xl overflow-hidden" dir="rtl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="pack-noprint flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <h3 className="text-sm font-semibold text-white">{t({ ar: "طباعة حزمة المشروع", en: "Project Print Pack" })}</h3>
          <button onClick={onClose} className="text-stone-400 text-sm">✕</button>
        </div>
        <div className="pack-noprint p-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-stone-500">{t({ ar: "نسخة المستلم:", en: "Recipient:" })}</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} className={`${inp} py-1`} style={{ colorScheme: "dark" }}>
              {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => <option key={s} value={s}>{t(SCOPE_LABELS[s])}</option>)}
            </select>
            <span className="text-[10px] text-stone-600">{t({ ar: "كل نسخة تعرض فقط البيانات المسموح بها — لا بيانات مالية في الحزمة.", en: "Scope-filtered. No financials." })}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SECTION_LABELS) as SectionKey[]).map((k) => (
              <label key={k} className={`flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-lg border ${allowed.includes(k) ? "border-stone-700 text-stone-300" : "border-stone-800 text-stone-700 line-through"}`}>
                <input type="checkbox" disabled={!allowed.includes(k)} checked={has(k)} onChange={() => toggle(k)} />
                {t(SECTION_LABELS[k])}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => void build()} className={`${btnGhost} px-4 py-2 text-xs`}>{busy ? "…" : t({ ar: "تجهيز المعاينة", en: "Build preview" })}</button>
            <button disabled={!ready} onClick={() => window.print()} className={`${btnRed} px-4 py-2 text-xs`}>{t({ ar: "طباعة / حفظ PDF", en: "Print / PDF" })}</button>
          </div>
        </div>

        {ready && (
          <div className="pack-print bg-white text-stone-900 p-6" dir="rtl">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontWeight: 800, color: "#E31E24", fontSize: 16 }}>كيان ميديا · Kian Media</span>
              <span style={{ fontSize: 11, color: "#666" }}>{t({ ar: "حزمة المشروع", en: "Project Pack" })} · {t(SCOPE_LABELS[scope])}</span>
            </div>
            <h2>{projectName}</h2>

            {has("summary") && core && (
              <section>
                <h3>{t(SECTION_LABELS.summary)}</h3>
                <div className="kv">
                  <div><b>{t({ ar: "المرحلة", en: "Stage" })}:</b> {t(PC_STAGE_LABELS[core.core_stage as PcStage] ?? { ar: core.core_stage, en: core.core_stage })}</div>
                  <div><b>{t({ ar: "التقدّم", en: "Progress" })}:</b> <span dir="ltr">{prog ?? core.progress_pct}%</span></div>
                  <div><b>{t({ ar: "النوع", en: "Type" })}:</b> {core.project_type ?? "—"}</div>
                  <div><b>{t({ ar: "البداية", en: "Start" })}:</b> <span dir="ltr">{core.start_date ? fmtDT(core.start_date).slice(0, 10) : "—"}</span></div>
                  <div><b>{t({ ar: "الموعد النهائي", en: "Due" })}:</b> <span dir="ltr">{core.due_date ? fmtDT(core.due_date).slice(0, 10) : "—"}</span></div>
                  <div><b>{t({ ar: "التسليم", en: "Delivery" })}:</b> <span dir="ltr">{core.delivery_date ? fmtDT(core.delivery_date).slice(0, 10) : "—"}</span></div>
                </div>
              </section>
            )}

            {has("schedule") && schedRows.length > 0 && (
              <section>
                <h3>{t(SECTION_LABELS.schedule)}</h3>
                <table><thead><tr><th>{t({ ar: "النوع", en: "Type" })}</th><th>{t({ ar: "العنوان", en: "Title" })}</th><th>{t({ ar: "البداية", en: "Start" })}</th><th>{t({ ar: "النهاية", en: "End" })}</th><th>{t({ ar: "الحالة", en: "Status" })}</th></tr></thead>
                  <tbody>{schedRows.map((x, i) => (
                    <tr key={i}>
                      <td>{t(SCHED_TYPE_LABELS[x.event_type as ScheduleEventType] ?? { ar: x.event_type, en: x.event_type })}</td>
                      <td>{x.is_milestone ? "◆ " : ""}{x.title}</td>
                      <td dir="ltr">{x.all_day ? fmtDT(x.start_at).slice(0, 10) : fmtDT(x.start_at)}</td>
                      <td dir="ltr">{x.end_at ? fmtDT(x.end_at).slice(0, 10) : "—"}</td>
                      <td>{t(SCHED_STATUS_LABELS[x.status as ScheduleStatus] ?? TASK_STATUS_LABELS[x.status as keyof typeof TASK_STATUS_LABELS] ?? { ar: x.status, en: x.status })}</td>
                    </tr>
                  ))}</tbody></table>
              </section>
            )}

            {has("tasks") && tasks.length > 0 && (
              <section>
                <h3>{t(SECTION_LABELS.tasks)}</h3>
                <table><thead><tr><th>{t({ ar: "المهمة", en: "Task" })}</th><th>{t({ ar: "المكلَّف", en: "Assignee" })}</th><th>{t({ ar: "الموعد", en: "Due" })}</th><th>{t({ ar: "الحالة", en: "Status" })}</th><th>%</th></tr></thead>
                  <tbody>{tasks.map((x) => (
                    <tr key={x.id}><td>{x.title}</td><td>{staffName(x.assignee_id)}</td><td dir="ltr">{x.due_date ?? "—"}</td><td>{t(TASK_STATUS_LABELS[x.status])}</td><td dir="ltr">{x.progress_pct}%</td></tr>
                  ))}</tbody></table>
              </section>
            )}

            {has("team") && members.length > 0 && (
              <section>
                <h3>{t(SECTION_LABELS.team)}</h3>
                <table><thead><tr><th>{t({ ar: "الاسم", en: "Name" })}</th><th>{t({ ar: "الدور", en: "Role" })}</th></tr></thead>
                  <tbody>{members.map((m) => <tr key={m.id}><td>{staffName(m.user_id)}</td><td>{m.role.replace("kian_", "")}</td></tr>)}</tbody></table>
              </section>
            )}

            {has("shoots") && shoots.length > 0 && (
              <section>
                <h3>{t(SECTION_LABELS.shoots)}</h3>
                <table><thead><tr><th>{t({ ar: "الجلسة", en: "Session" })}</th><th>{t({ ar: "التاريخ", en: "Date" })}</th><th>Call</th><th>{t({ ar: "الموقع", en: "Location" })}</th><th>{t({ ar: "الحالة", en: "Status" })}</th></tr></thead>
                  <tbody>{shoots.map((s) => (
                    <tr key={s.id}><td>{s.title}</td><td dir="ltr">{s.session_date ?? "—"}</td><td dir="ltr">{s.call_time ? fmtDT(s.call_time).slice(11) : "—"}</td><td>{s.location ?? "—"}</td><td>{t(SHOOT_STATUS_LABELS[s.status] ?? { ar: s.status, en: s.status })}</td></tr>
                  ))}</tbody></table>
              </section>
            )}

            {has("deliverables") && dlvs.length > 0 && (
              <section>
                <h3>{t(SECTION_LABELS.deliverables)}</h3>
                <table><thead><tr><th>{t({ ar: "المخرَج", en: "Deliverable" })}</th><th>{t({ ar: "النوع", en: "Type" })}</th><th>{t({ ar: "الحالة", en: "Status" })}</th></tr></thead>
                  <tbody>{dlvs.map((d) => <tr key={d.id}><td>{d.title}</td><td>{d.type}</td><td>{t(DLV_LABEL[d.status] ?? { ar: d.status, en: d.status })}</td></tr>)}</tbody></table>
              </section>
            )}

            {has("risks") && risks.length > 0 && (
              <section>
                <h3>{t(SECTION_LABELS.risks)}</h3>
                <table><thead><tr><th>{t({ ar: "الخطر", en: "Risk" })}</th><th>{t({ ar: "الشدة", en: "Severity" })}</th><th>{t({ ar: "الحالة", en: "Status" })}</th></tr></thead>
                  <tbody>{risks.map((r) => <tr key={r.id}><td>{r.title}</td><td>{t(SEVERITY_LABELS[r.severity] ?? { ar: r.severity, en: r.severity })}</td><td>{r.status}</td></tr>)}</tbody></table>
              </section>
            )}

            {has("locations") && locs.length > 0 && (
              <section>
                <h3>{t(SECTION_LABELS.locations)}</h3>
                <table><thead><tr><th>{t({ ar: "الموقع", en: "Location" })}</th><th>{t({ ar: "العنوان", en: "Address" })}</th></tr></thead>
                  <tbody>{locs.map((l) => <tr key={l.id}><td>{l.name}</td><td dir="ltr">{l.address ?? "—"}</td></tr>)}</tbody></table>
              </section>
            )}

            <div className="pack-foot" dir="rtl">
              <span>كيان ميديا · {projectName} · {t(SCOPE_LABELS[scope])}</span>
              <span dir="ltr">Generated by {profile.full_name ?? "—"} · {genAt}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
