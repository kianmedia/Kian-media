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
import VersionHistory from "@/components/portal/VersionHistory";
import DeliverableNotesPanel from "@/components/portal/DeliverableNotesPanel";
import {
  pcListMembers, pcMemberAdd, pcMemberRemove, pcListStaff, pcListDeliverables,
  pcListCosts, pcCostAdd, pcListRisks, pcRiskUpsert, pcEntityDelete, type TrashEntity,
  pcListMeetings, pcMeetingUpsert, pcListShoots, pcShootUpsert, pcListStatusHistory, pcGetCallSheetMeta,
  pcListDeliverableVersions, pcDeliverableVersionAdd, pcMeetingToTask,
  pcDeliverableUpsert, pcDeliverableReview, pcDeliverableComment, pcListDeliverableComments,
  pcDeliverableUpload, pcSignDeliverableFiles,
  type DlvReviewAction, type InternalComment,
  pcEquipSearch, pcEquipAvailability, pcShootEquipList, pcShootReserve,
  pcReservationCancel, pcReservationApprove, pcReservationToCustody,
  CUSTODY_ASSIGN_LABELS, RESV_STATUS_LABELS,
  type EquipAsset, type EquipReservation,
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
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", type: "video", assignee: "", due: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListDeliverables(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); void pcListStaff().then((r) => { if (r.ok) setStaff(r.data); }); }, [load]);
  async function add() {
    if (busy || !f.title.trim()) return; setBusy(true);
    const r = await pcDeliverableUpsert(projectId, { title: f.title.trim(), type: f.type, assignee_id: f.assignee || null, due_date: f.due || null });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setF({ title: "", type: "video", assignee: "", due: "" }); await load();
  }
  const staffName = (id: string | null | undefined) => id ? (staff.find((x) => x.id === id)?.full_name ?? "—") : null;
  return (
    <div className="space-y-1.5">
      {canManage && (
        <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
          <input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t({ ar: "مخرَج جديد…", en: "New deliverable…" })} className={`${inp} flex-1 min-w-[140px]`} />
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={inp} style={{ colorScheme: "dark" }}>
            {["video", "photo", "other"].map((x) => <option key={x} value={x}>{t(x === "video" ? { ar: "فيديو", en: "Video" } : x === "photo" ? { ar: "صور", en: "Photo" } : { ar: "أخرى", en: "Other" })}</option>)}
          </select>
          <select value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} className={inp} style={{ colorScheme: "dark" }}>
            <option value="">{t({ ar: "— المكلَّف —", en: "— assignee —" })}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id.slice(0, 6)}</option>)}
          </select>
          <input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} className={inp} style={{ colorScheme: "dark" }} />
          <button disabled={busy || !f.title.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      )}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا توجد مخرجات بعد.", en: "No deliverables yet." })}</p>}
      {rows.map((d) => (
        <div key={d.id} className={`${card} p-3`}>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <button onClick={() => setOpen(open === d.id ? null : d.id)} className="min-w-0 text-right flex-1">
              <div className="text-sm text-stone-200 truncate">{d.title}</div>
              <div className="text-[11px] text-stone-500">
                {d.type}{staffName(d.assignee_id) ? ` · ${staffName(d.assignee_id)}` : ""}{d.due_date ? <span dir="ltr"> · {d.due_date}</span> : ""}
                {d.watermark_required && <span> · {t({ ar: "علامة مائية", en: "WM" })}</span>}
                {!d.allow_download && <span> · {t({ ar: "التنزيل ممنوع", en: "No DL" })}</span>}
              </div>
            </button>
            <span className={`text-[11px] px-2 py-0.5 rounded shrink-0 ${d.status === "approved" ? "bg-emerald-900/40 text-emerald-300" : d.status === "final_delivered" ? "bg-emerald-800/60 text-emerald-200" : d.status === "revision_requested" ? "bg-amber-900/40 text-amber-300" : d.status === "client_review" ? "bg-sky-900/40 text-sky-300" : "bg-stone-800 text-stone-300"}`}>{t(DLV_LABEL[d.status] ?? { ar: d.status, en: d.status })}</span>
          </div>
          {open === d.id && (
            <div className="mt-2 space-y-3">
              {/* Client review thread — the SAME shared components used in the client
                  portal / admin deliverables, so المخرجات shows the full versioned
                  conversation (V1/V2/…/Final) with every client comment + Kian reply. */}
              <VersionHistory deliverable={d} mode="admin" onChanged={load} />
              <DeliverableNotesPanel deliverable={d} canResolve t={t} />
              {/* internal staff working versions (separate from the client thread) */}
              <DeliverableVersions d={d} canManage={canManage} flash={flash} onChanged={load} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DeliverableVersions({ d, canManage, flash, onChanged }: { d: Deliverable; canManage: boolean; flash: Flash; onChanged: () => Promise<void> }) {
  const { t } = useI18n();
  const [vers, setVers] = useState<DeliverableVersion[]>([]);
  const [comments, setComments] = useState<InternalComment[]>([]);
  const [url, setUrl] = useState(""); const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [cBody, setCBody] = useState(""); const [cTc, setCTc] = useState("");
  const load = useCallback(async () => {
    const [v, c] = await Promise.all([pcListDeliverableVersions(d.id), pcListDeliverableComments(d.id)]);
    if (v.ok) {
      setVers(v.data);
      const paths = v.data.map((x) => x.file_path).filter(Boolean) as string[];
      if (paths.length) setSigned(await pcSignDeliverableFiles(paths));
    }
    if (c.ok) setComments(c.data);
  }, [d.id]);
  useEffect(() => { void load(); }, [load]);
  const final = d.status === "final_delivered";
  async function add() {
    if (busy) return; setBusy(true);
    const r = await pcDeliverableVersionAdd(d.id, { preview_url: url.trim() || undefined, note: note.trim() || undefined });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setUrl(""); setNote(""); await load(); await onChanged();
  }
  async function upload(file: File) {
    if (busy) return; setBusy(true);
    const up = await pcDeliverableUpload(d.project_id, d.id, file);
    if (!up.ok) { setBusy(false); flash(t({ ar: "فشل رفع الملف.", en: "Upload failed." })); return; }
    const r = await pcDeliverableVersionAdd(d.id, { file_path: up.data.path, note: note.trim() || file.name });
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setNote(""); await load(); await onChanged();
    flash(t({ ar: "رُفع الملف وأُنشئت نسخة.", en: "Uploaded." }));
  }
  async function review(v: DeliverableVersion, action: DlvReviewAction) {
    if (busy) return;
    let noteTxt: string | undefined, force = false;
    if (action === "revision" || action === "reject") {
      const p = window.prompt(t({ ar: "ملاحظات التعديل/الرفض (إلزامية):", en: "Revision note:" }));
      if (p === null) return; if (!p.trim()) { flash(t({ ar: "الملاحظة إلزامية.", en: "Required." })); return; }
      noteTxt = p.trim();
    }
    setBusy(true);
    let r = await pcDeliverableReview(v.id, action, noteTxt, force);
    if (!r.ok && /old_version/.test(r.error) && (action === "approve" || action === "final")) {
      setBusy(false);
      if (!window.confirm(t({ ar: `v${v.version} ليست الأحدث — تأكيد ${action === "final" ? "التسليم النهائي" : "الاعتماد"} لنسخة أقدم؟`, en: "Older version — confirm?" }))) return;
      setBusy(true);
      r = await pcDeliverableReview(v.id, action, noteTxt, true);
    }
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    await load(); await onChanged();
  }
  async function addComment() {
    if (busy || !cBody.trim()) return; setBusy(true);
    const tc = cTc.trim() ? (() => { const p = cTc.trim().split(":").map(Number); return p.length === 2 ? p[0] * 60 + p[1] : Number(cTc); })() : undefined;
    const r = await pcDeliverableComment(d.id, cBody.trim(), Number.isFinite(tc) ? tc : undefined);
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setCBody(""); setCTc(""); await load();
  }
  const tcFmt = (s: number | null) => s == null ? null : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2 text-xs">
      <div className="text-[11px] text-stone-500">{t({ ar: "الإصدارات ودورة الاعتماد", en: "Versions & approvals" })}</div>
      {vers.map((v) => (
        <div key={v.id} className="bg-stone-950 border border-stone-800 rounded p-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-stone-200">v{v.version}</span>
            {v.approved_at && !v.superseded && <span className="text-[10px] px-1.5 rounded bg-emerald-900/40 text-emerald-300">✓ {t({ ar: "معتمدة", en: "Approved" })}</span>}
            {v.superseded && <span className="text-[10px] px-1.5 rounded bg-stone-800 text-stone-500">{t({ ar: "مستبدلة", en: "Superseded" })}</span>}
            {v.is_final && <span className="text-[10px] px-1.5 rounded bg-emerald-800/60 text-emerald-200">{t({ ar: "تسليم نهائي", en: "Final" })}</span>}
            {v.client_visible && <span className="text-[10px] px-1.5 rounded bg-sky-900/40 text-sky-300">{t({ ar: "مرئية للعميل", en: "Client" })}</span>}
            {v.note && <span className="text-stone-500 truncate">· {v.note}</span>}
            <span className="flex-1" />
            {(v.file_path && signed[v.file_path]) ? <a href={signed[v.file_path]} target="_blank" rel="noreferrer" className="text-sky-400 shrink-0">{t({ ar: "معاينة (موقّعة)", en: "Preview" })}</a>
              : v.preview_url ? <a href={v.preview_url} target="_blank" rel="noreferrer" className="text-sky-400 shrink-0" dir="ltr">{t({ ar: "معاينة", en: "Preview" })}</a> : null}
          </div>
          {canManage && !final && (
            <div className="mt-1 flex gap-2 flex-wrap text-[10px]">
              {!v.approved_at && <button disabled={busy} onClick={() => void review(v, "approve")} className="text-emerald-400">{t({ ar: "اعتماد", en: "Approve" })}</button>}
              <button disabled={busy} onClick={() => void review(v, "revision")} className="text-amber-400">{t({ ar: "طلب تعديل", en: "Revision" })}</button>
              {v.client_visible
                ? <button disabled={busy} onClick={() => void review(v, "unshare")} className="text-stone-400">{t({ ar: "إخفاء عن العميل", en: "Unshare" })}</button>
                : <button disabled={busy} onClick={() => void review(v, "send_client")} className="text-sky-400">{t({ ar: "إرسال لمراجعة العميل", en: "Send to client" })}</button>}
              {v.approved_at && !v.superseded && <button disabled={busy} onClick={() => void review(v, "final")} className="text-emerald-300 font-semibold">{t({ ar: "تسليم نهائي", en: "Final delivery" })}</button>}
            </div>
          )}
        </div>
      ))}
      {vers.length === 0 && <p className="text-stone-600">{t({ ar: "لا إصدارات.", en: "No versions." })}</p>}
      {canManage && !final && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap gap-1.5">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t({ ar: "رابط معاينة خارجي", en: "Preview URL" })} className={`${inp} flex-1 min-w-[120px] py-1`} dir="ltr" />
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t({ ar: "ملاحظة النسخة", en: "Note" })} className={`${inp} flex-1 min-w-[100px] py-1`} />
            <button disabled={busy || (!url.trim() && !note.trim())} onClick={() => void add()} className={`${btnRed} px-3 py-1`}>{t({ ar: "+ نسخة", en: "+ Version" })}</button>
            <label className={`${btnGhost} px-3 py-1 cursor-pointer`}>
              {busy ? "…" : t({ ar: "رفع ملف ↑", en: "Upload" })}
              <input type="file" className="hidden" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) void upload(fl); e.target.value = ""; }} />
            </label>
          </div>
          <p className="text-[10px] text-stone-600">{t({ ar: "الملفات تُخزن في مخزن خاص بالموظفين وتُعرض بروابط موقّتة (Signed URLs).", en: "Private storage; signed URLs." })}</p>
        </div>
      )}
      {final && canManage && <button onClick={() => vers[0] && void review(vers[0], "archive")} className={`${btnGhost} px-3 py-1 text-[10px]`}>{t({ ar: "أرشفة المخرَج", en: "Archive" })}</button>}
      <div className="pt-1 border-t border-stone-800/60">
        <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "تعليقات داخلية (بكود زمني اختياري)", en: "Internal comments (timecode)" })}</div>
        {comments.map((c) => (
          <div key={c.id} className="flex items-start gap-2 text-stone-300 py-0.5">
            {c.timecode_seconds != null && <span className="text-[10px] text-amber-400 shrink-0" dir="ltr">[{tcFmt(c.timecode_seconds)}]</span>}
            <span className="flex-1" dir="auto">{c.body}</span>
            <span className="text-[10px] text-stone-600 shrink-0" dir="ltr">{fmtDT(c.created_at)}</span>
          </div>
        ))}
        <div className="flex gap-1.5 mt-1">
          <input value={cTc} onChange={(e) => setCTc(e.target.value)} placeholder="mm:ss" className={`${inp} w-20 py-1`} dir="ltr" />
          <input value={cBody} onChange={(e) => setCBody(e.target.value)} placeholder={t({ ar: "تعليق…", en: "Comment…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void addComment(); }} />
          <button disabled={busy || !cBody.trim()} onClick={() => void addComment()} className={`${btnGhost} px-2`}>↵</button>
        </div>
      </div>
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

// ─── المعدات والتجهيزات (جسر نظام العهدة — الحجز لا يخصم المخزون؛ الصرف عبر دورة العهدة) ───
function ShootEquipment({ sh, canManage, flash }: { sh: ShootSession; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const { caps, profile } = usePortal();
  // civ_can_manage = المالك أو manager/custody_officer — نطابق الخادم لتجنّب أزرار ميتة.
  const civMgr = caps.isOwner || ["manager", "custody_officer"].includes(profile.staff_role ?? "");
  const [rows, setRows] = useState<EquipReservation[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<EquipAsset[]>([]);
  const [sel, setSel] = useState<EquipAsset | null>(null);
  const [avail, setAvail] = useState<{ free: number; now: number; blocked: boolean } | null>(null);
  const [qty, setQty] = useState("1");
  const [emp, setEmp] = useState("");
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [busy, setBusy] = useState(false);

  // نافذة الحجز — تُحسب مرة واحدة وتُمرَّر صراحة لفحص التوفر وللحجز معًا (لا انزياح).
  const winFrom = sh.call_time ?? (sh.session_date ? new Date(`${sh.session_date}T00:00:00`).toISOString() : null);
  const winTo = sh.wrap_time ?? (winFrom ? new Date(new Date(winFrom).getTime() + 86400000).toISOString() : null);

  const load = useCallback(async () => {
    const r = await pcShootEquipList(sh.id);
    if (!r.ok) { setErr(pcErr(r.error)); return; }
    setErr(null); setRows(r.data.items);
  }, [sh.id]);
  useEffect(() => { void load(); void pcListStaff().then((r) => { if (r.ok) setStaff(r.data); }); }, [load]);

  async function search() {
    const r = await pcEquipSearch(q.trim());
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setResults(r.data.items); setSel(null); setAvail(null);
  }
  async function pick(a: EquipAsset) {
    setSel(a); setAvail(null); setQty("1");
    if (!winFrom || !winTo) { setAvail({ free: -1, now: -1, blocked: false }); return; }
    const r = await pcEquipAvailability(a.id, winFrom, winTo);
    if (r.ok) setAvail({ free: r.data.free_window, now: r.data.available_now, blocked: r.data.blocked });
    else setAvail({ free: -1, now: -1, blocked: false });
  }
  async function reserve() {
    if (busy || !sel) return; setBusy(true);
    // نفس النافذة المفحوصة تُرسل للحجز — لا اعتماد على افتراضات الخادم.
    const r = await pcShootReserve(sh.id, sel.id, Math.max(1, Number(qty) || 1), winFrom ?? undefined, winTo ?? undefined, emp || undefined);
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "تم الحجز — لا يُخصم المخزون إلا عند صرف العهدة.", en: "Reserved." }));
    setSel(null); setResults([]); setQ(""); void load();
  }
  async function cancel(x: EquipReservation) {
    const rs = window.prompt(t({ ar: `إلغاء حجز «${x.name}» — السبب (إلزامي):`, en: "Cancel reason:" }));
    if (rs === null) return; if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    const r = await pcReservationCancel(x.id, rs.trim());
    if (!r.ok) { flash(pcErr(r.error)); return; } void load();
  }
  async function approve(x: EquipReservation) {
    const r = await pcReservationApprove(x.id);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "اعتُمد الحجز.", en: "Approved." })); void load();
  }
  async function toCustody(x: EquipReservation) {
    if (!window.confirm(t({ ar: `إنشاء طلب عهدة وصرف «${x.name}» (×${x.qty})؟ سيُخصم المخزون.`, en: "Issue custody?" }))) return;
    const r = await pcReservationToCustody(x.id);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: `أُنشئت العهدة ${r.data.assignment_number} — بانتظار تأكيد الموظف.`, en: "Custody created." })); void load();
  }

  return (
    <div className="mt-2 pt-2 border-t border-stone-800 space-y-2 text-xs">
      <div className="text-[11px] text-stone-500">{t({ ar: "المعدات والتجهيزات (نظام العهدة)", en: "Equipment (custody system)" })}</div>
      {err && <p className="text-red-400 text-[11px]">{err}</p>}

      {rows.map((x) => (
        <div key={x.id} className="bg-stone-950 border border-stone-800 rounded p-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-stone-200">{x.name}</span>
            <span className="text-[10px] text-stone-600" dir="ltr">{x.code}</span>
            <span className="text-[10px] text-stone-500" dir="ltr">×{x.qty}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] ${x.status === "active" ? "bg-sky-900/40 text-sky-300" : x.status === "fulfilled" ? "bg-emerald-900/40 text-emerald-300" : "bg-stone-800 text-stone-400"}`}>
              {t(RESV_STATUS_LABELS[x.status] ?? { ar: x.status, en: x.status })}
            </span>
            {x.approved_at && x.status === "active" && <span className="text-[10px] text-emerald-400">✓ {t({ ar: "معتمد", en: "Approved" })}</span>}
            {x.assignment_no && (
              <span className="text-[10px] text-amber-300" dir="ltr">{x.assignment_no}
                <span className="text-stone-500" dir="rtl"> · {t(CUSTODY_ASSIGN_LABELS[x.assignment_status ?? ""] ?? { ar: x.assignment_status ?? "", en: x.assignment_status ?? "" })}</span>
              </span>
            )}
            <span className="flex-1" />
            {x.status === "active" && canManage && <button onClick={() => void cancel(x)} className="text-[10px] text-red-400">{t({ ar: "إلغاء", en: "Cancel" })}</button>}
            {x.status === "active" && civMgr && !x.approved_at && <button onClick={() => void approve(x)} className="text-[10px] text-emerald-400">{t({ ar: "اعتماد", en: "Approve" })}</button>}
            {x.status === "active" && civMgr && (
              x.employee_id
                ? <button onClick={() => void toCustody(x)} className="text-[10px] text-amber-400">{t({ ar: "صرف عهدة", en: "Issue custody" })}</button>
                : <span className="text-[10px] text-stone-600" title={t({ ar: "لا مستلم محددًا — ألغِ الحجز وأعد إنشاءه مع مستلم.", en: "No recipient set." })}>{t({ ar: "صرف عهدة (يتطلب مستلمًا)", en: "Needs recipient" })}</span>
            )}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-600 flex gap-3 flex-wrap">
            {x.employee_name && <span>{t({ ar: "المستلم", en: "Recipient" })}: {x.employee_name}</span>}
            {x.from && <span dir="ltr">{fmtDT(x.from)} ← {x.to ? fmtDT(x.to) : "—"}</span>}
            {x.note && <span>{x.note}</span>}
          </div>
        </div>
      ))}
      {rows.length === 0 && !err && <p className="text-stone-600">{t({ ar: "لا معدات محجوزة لهذه الجلسة.", en: "No reservations." })}</p>}

      {canManage && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t({ ar: "ابحث بالاسم/الكود/الرقم التسلسلي…", en: "Search…" })} className={`${inp} flex-1 py-1`} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} />
            <button onClick={() => void search()} className={`${btnGhost} px-3 py-1`}>{t({ ar: "بحث", en: "Search" })}</button>
          </div>
          {results.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-1">
              {results.map((a) => (
                <button key={a.id} onClick={() => void pick(a)} className={`w-full text-right bg-stone-950 border rounded p-1.5 ${sel?.id === a.id ? "border-red-600" : "border-stone-800"}`}>
                  <span className="text-stone-200">{a.name}</span>
                  <span className="mr-2 text-[10px] text-stone-600" dir="ltr">{a.code}{a.serial ? ` · ${a.serial}` : ""}</span>
                  <span className="mr-2 text-[10px] text-stone-500" dir="ltr">{a.available}/{a.total}</span>
                  <span className="mr-1 text-[10px] text-stone-500">{a.condition}</span>
                </button>
              ))}
            </div>
          )}
          {sel && (
            <div className="bg-stone-950 border border-stone-800 rounded p-2 space-y-1.5">
              <div className="text-[11px] text-stone-400">{sel.name} — {avail === null
                ? t({ ar: "جارٍ فحص التوفر…", en: "Checking…" })
                : avail.blocked
                  ? <span className="text-red-400">{t({ ar: "الأصل غير متاح (حالته لا تسمح).", en: "Blocked." })}</span>
                  : avail.free < 0
                    ? <span className="text-amber-400">{t({ ar: "حدّد تاريخ الجلسة أولًا لفحص التوفر.", en: "Set session date first." })}</span>
                    : <span><span className="text-emerald-400" dir="ltr">{avail.free}</span> {t({ ar: "متاح في فترة الجلسة", en: "free in window" })} · <span className="text-stone-500" dir="ltr">{avail.now}</span> {t({ ar: "في المستودع الآن", en: "in stock now" })}</span>}
              </div>
              <div className="flex flex-wrap gap-1.5 items-center">
                {sel.type === "quantity_based" && <input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} className={`${inp} w-20 py-1`} dir="ltr" />}
                <select value={emp} onChange={(e) => setEmp(e.target.value)} className={`${inp} py-1 text-[11px]`} style={{ colorScheme: "dark" }}>
                  <option value="">{t({ ar: "— المستلم (اختياري للحجز) —", en: "— recipient —" })}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id.slice(0, 6)}</option>)}
                </select>
                <button disabled={busy || (avail?.blocked ?? false)} onClick={() => void reserve()} className={`${btnRed} px-3 py-1`}>{busy ? "…" : t({ ar: "حجز", en: "Reserve" })}</button>
              </div>
              <p className="text-[10px] text-stone-600">{t({ ar: "الحجز لا يخصم المخزون — الخصم يتم عند «صرف عهدة» عبر دورة العهدة.", en: "Reservation doesn't deduct stock." })}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ShootsTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: Flash }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ShootSession[]>([]);
  const [title, setTitle] = useState(""); const [date, setDate] = useState(""); const [loc, setLoc] = useState(""); const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [openCS, setOpenCS] = useState<string | null>(null);
  const [openEq, setOpenEq] = useState<string | null>(null);
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
            <button onClick={() => setOpenEq(openEq === sh.id ? null : sh.id)} className={`${btnGhost} px-2.5 py-1 text-[11px] text-lime-300`}>
              {t({ ar: "المعدات والتجهيزات", en: "Equipment" })} {openEq === sh.id ? "▴" : "▾"}
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
          {openEq === sh.id && <ShootEquipment sh={sh} canManage={canManage} flash={flash} />}
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
