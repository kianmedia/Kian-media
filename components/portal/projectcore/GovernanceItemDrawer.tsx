"use client";
// ════════════════════════════════════════════════════════════════════════════
// GovernanceItemDrawer — V1 CLOSURE.
// Completes the governance registers that were create-only: an issue or decision could
// be created from a one-line prompt and then never updated, resolved or closed, and a
// change request could never leave 'draft' — so a title-only draft blocked project
// closure forever.
//
// This drawer edits the THREE existing entities through their EXISTING RPCs
// (pc_issue_upsert / pc_decision_upsert / pc_change_request_upsert) plus the existing
// approval and apply RPCs. No new table, RPC, route or register — every field below is
// one the server already accepts.
//
// Rules enforced here AND server-side:
//   • resolving/closing an issue requires a resolution summary;
//   • rejecting a change request requires a reason;
//   • a change request advances draft → internal_review → client_pending →
//     approved/rejected → implemented, one legal step at a time;
//   • applying an approved change request is idempotent (the server returns
//     already_applied on a retry — we surface its note verbatim).
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  pcIssueUpsert, pcDecisionUpsert, pcChangeRequestUpsert, projectChangeRequestApply,
  projectChangeImpactPreview, govErr,
} from "@/lib/portal/projectGovernance";

export type GovKind = "issue" | "decision" | "change";
export interface GovItemSeed { id?: string; [k: string]: unknown }

const ISSUE_STATUS = ["open", "in_progress", "resolved", "closed", "rejected"] as const;
const DECISION_STATUS = ["proposed", "approved", "rejected", "superseded"] as const;
/** The change-request lifecycle, as legal next-steps per current status. */
export const CR_NEXT: Record<string, string[]> = {
  draft: ["internal_review", "cancelled"],
  internal_review: ["client_pending", "rejected", "cancelled"],
  client_pending: ["approved", "rejected", "cancelled"],
  approved: ["implemented"],
  rejected: [], cancelled: [], implemented: [],
};
const CR_LABEL: Record<string, { ar: string; en: string }> = {
  draft: { ar: "مسودة", en: "Draft" },
  internal_review: { ar: "مراجعة داخلية", en: "Internal review" },
  client_pending: { ar: "بانتظار العميل", en: "Client pending" },
  approved: { ar: "معتمد", en: "Approved" },
  rejected: { ar: "مرفوض", en: "Rejected" },
  cancelled: { ar: "ملغى", en: "Cancelled" },
  implemented: { ar: "مُنفَّذ", en: "Implemented" },
};
/** A status that ends the issue — the server demands a resolution summary for these. */
const ISSUE_TERMINAL = new Set(["resolved", "closed", "rejected"]);

const inp = "w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-[11px] text-stone-200";
const btn = "text-[10px] rounded px-2 py-1 border";

export default function GovernanceItemDrawer({
  projectId, kind, item, canManage, onClose, onSaved, flash,
}: {
  projectId: string; kind: GovKind; item: GovItemSeed | null; canManage: boolean;
  onClose: () => void; onSaved: () => void; flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState<Record<string, unknown>>(() => ({ ...(item ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [impact, setImpact] = useState<string | null>(null);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const s = (k: string) => (typeof f[k] === "string" ? (f[k] as string) : "");
  const status = s("status") || (kind === "issue" ? "open" : kind === "decision" ? "proposed" : "draft");
  const isNew = !item?.id;

  async function save(extra: Record<string, unknown> = {}) {
    if (busy) return;
    const payload = { ...f, ...extra };
    if (!String(payload.title ?? "").trim()) { flash(t({ ar: "العنوان إلزامي.", en: "Title is required." })); return; }
    // Client-side mirror of the server rule, so the user gets a clean message first.
    if (kind === "issue" && ISSUE_TERMINAL.has(String(payload.status ?? "")) && !String(payload.resolution_summary ?? "").trim()) {
      flash(t({ ar: "سبب الإغلاق/الحل إلزامي.", en: "A resolution summary is required to close." })); return;
    }
    if (kind === "change" && String(payload.status ?? "") === "rejected" && !String(payload.reason ?? "").trim()) {
      flash(t({ ar: "سبب الرفض إلزامي.", en: "A rejection reason is required." })); return;
    }
    setBusy(true);
    const fn = kind === "issue" ? pcIssueUpsert : kind === "decision" ? pcDecisionUpsert : pcChangeRequestUpsert;
    const r = await fn(projectId, payload);
    setBusy(false);
    if (!r.ok) { flash(govErr(r.error)); return; }
    flash(t({ ar: "حُفظ.", en: "Saved." }));
    onSaved(); onClose();
  }

  /** Move a change request one legal step. Rejection demands a reason. */
  async function advance(to: string) {
    if (!CR_NEXT[status]?.includes(to)) { flash(t({ ar: "انتقال غير مسموح.", en: "Transition not allowed." })); return; }
    let reason = s("reason");
    if (to === "rejected") {
      const p = window.prompt(t({ ar: "سبب الرفض (إلزامي):", en: "Rejection reason (required):" }));
      if (p === null) return;
      if (!p.trim()) { flash(t({ ar: "سبب الرفض إلزامي.", en: "Reason required." })); return; }
      reason = p.trim();
    }
    if (to === "client_pending" && !window.confirm(t({
      ar: "إرسال طلب التغيير إلى العميل؟ سيراه في بوابته.",
      en: "Send this change request to the client? It becomes visible to them.",
    }))) return;
    await save({ status: to, ...(reason ? { reason } : {}) });
  }

  /** Apply an APPROVED change request. The server is idempotent; we show its note. */
  async function apply() {
    if (!item?.id) return;
    if (!window.confirm(t({
      ar: "تطبيق طلب التغيير المعتمد على المشروع؟",
      en: "Apply the approved change request to the project?",
    }))) return;
    setBusy(true);
    const r = await projectChangeRequestApply(String(item.id), null);
    setBusy(false);
    if (!r.ok) { flash(govErr(r.error)); return; }
    // note_ar explains exactly what the server did (and says when edits stay manual).
    flash(r.data?.note_ar || t({ ar: "طُبِّق.", en: "Applied." }));
    onSaved(); onClose();
  }

  async function preview() {
    if (!item?.id) return;
    setBusy(true);
    const r = await projectChangeImpactPreview(String(item.id));
    setBusy(false);
    setImpact(r.ok ? JSON.stringify(r.data, null, 1).slice(0, 800) : govErr(r.error));
  }

  const title = kind === "issue" ? t({ ar: "مشكلة", en: "Issue" })
    : kind === "decision" ? t({ ar: "قرار", en: "Decision" })
    : t({ ar: "طلب تغيير", en: "Change request" });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-2" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg max-h-[88vh] overflow-y-auto bg-stone-950 border border-stone-800 rounded-xl p-3 space-y-2" dir="rtl">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-stone-200">{isNew ? t({ ar: "إضافة ", en: "New " }) : t({ ar: "تعديل ", en: "Edit " })}{title}</h4>
          <button onClick={onClose} className="text-[11px] text-stone-400 hover:text-stone-200">✕</button>
        </div>

        <label className="block text-[10px] text-stone-500">{t({ ar: "العنوان *", en: "Title *" })}
          <input className={inp} value={s("title")} onChange={(e) => set("title", e.target.value)} dir="auto" /></label>

        {kind === "issue" && (<>
          <label className="block text-[10px] text-stone-500">{t({ ar: "الوصف", en: "Description" })}
            <textarea className={inp} rows={2} value={s("description")} onChange={(e) => set("description", e.target.value)} dir="auto" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] text-stone-500">{t({ ar: "الخطورة", en: "Severity" })}
              <select className={inp} value={s("severity") || "medium"} onChange={(e) => set("severity", e.target.value)}>
                {["low", "medium", "high", "critical"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select></label>
            <label className="block text-[10px] text-stone-500">{t({ ar: "الموعد", en: "Due date" })}
              <input type="date" className={inp} value={s("due_date")} onChange={(e) => set("due_date", e.target.value)} /></label>
          </div>
          <label className="block text-[10px] text-stone-500">{t({ ar: "السبب الجذري", en: "Root cause" })}
            <input className={inp} value={s("root_cause")} onChange={(e) => set("root_cause", e.target.value)} dir="auto" /></label>
          <label className="block text-[10px] text-stone-500">{t({ ar: "خطة المعالجة", en: "Resolution plan" })}
            <input className={inp} value={s("resolution_plan")} onChange={(e) => set("resolution_plan", e.target.value)} dir="auto" /></label>
          <label className="block text-[10px] text-stone-500">{t({ ar: "الحالة", en: "Status" })}
            <select className={inp} value={status} onChange={(e) => set("status", e.target.value)}>
              {ISSUE_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
            </select></label>
          {ISSUE_TERMINAL.has(status) && (
            <label className="block text-[10px] text-amber-400">{t({ ar: "سبب الإغلاق / ملخّص الحل * (إلزامي)", en: "Resolution summary * (required)" })}
              <textarea className={inp} rows={2} value={s("resolution_summary")} onChange={(e) => set("resolution_summary", e.target.value)} dir="auto" /></label>
          )}
        </>)}

        {kind === "decision" && (<>
          <label className="block text-[10px] text-stone-500">{t({ ar: "القرار", en: "Decision" })}
            <textarea className={inp} rows={2} value={s("decision")} onChange={(e) => set("decision", e.target.value)} dir="auto" /></label>
          <label className="block text-[10px] text-stone-500">{t({ ar: "المبرّر", en: "Rationale" })}
            <textarea className={inp} rows={2} value={s("rationale")} onChange={(e) => set("rationale", e.target.value)} dir="auto" /></label>
          <label className="block text-[10px] text-stone-500">{t({ ar: "البدائل المدروسة", en: "Alternatives considered" })}
            <input className={inp} value={s("alternatives_considered")} onChange={(e) => set("alternatives_considered", e.target.value)} dir="auto" /></label>
          <label className="block text-[10px] text-stone-500">{t({ ar: "الأثر", en: "Impact" })}
            <input className={inp} value={s("impact")} onChange={(e) => set("impact", e.target.value)} dir="auto" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] text-stone-500">{t({ ar: "الحالة", en: "Status" })}
              <select className={inp} value={status} onChange={(e) => set("status", e.target.value)}>
                {DECISION_STATUS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select></label>
            <label className="block text-[10px] text-stone-500">{t({ ar: "تاريخ المراجعة", en: "Review date" })}
              <input type="date" className={inp} value={s("review_date")} onChange={(e) => set("review_date", e.target.value)} /></label>
          </div>
        </>)}

        {kind === "change" && (<>
          <div className="text-[10px] text-stone-400">
            {t({ ar: "الحالة الحالية: ", en: "Current status: " })}
            <span className="text-stone-200">{t(CR_LABEL[status] ?? { ar: status, en: status })}</span>
          </div>
          <label className="block text-[10px] text-stone-500">{t({ ar: "الوصف", en: "Description" })}
            <textarea className={inp} rows={2} value={s("description")} onChange={(e) => set("description", e.target.value)} dir="auto" /></label>
          <label className="block text-[10px] text-stone-500">{t({ ar: "سبب الطلب", en: "Reason" })}
            <textarea className={inp} rows={2} value={s("reason")} onChange={(e) => set("reason", e.target.value)} dir="auto" /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] text-stone-500">{t({ ar: "النوع", en: "Type" })}
              <select className={inp} value={s("change_type") || "scope"} onChange={(e) => set("change_type", e.target.value)}>
                {["scope", "schedule", "cost", "quality", "resource"].map((v) => <option key={v} value={v}>{v}</option>)}
              </select></label>
            <label className="block text-[10px] text-stone-500">{t({ ar: "أيام إضافية", en: "Extra days" })}
              <input type="number" className={inp} value={s("schedule_impact_days")} onChange={(e) => set("schedule_impact_days", e.target.value === "" ? "" : Number(e.target.value))} /></label>
          </div>
          <label className="block text-[10px] text-stone-500">{t({ ar: "أثر النطاق", en: "Scope impact" })}
            <input className={inp} value={s("scope_impact")} onChange={(e) => set("scope_impact", e.target.value)} dir="auto" /></label>
          <label className="block text-[10px] text-stone-500">{t({ ar: "خطة التنفيذ", en: "Implementation plan" })}
            <input className={inp} value={s("implementation_plan")} onChange={(e) => set("implementation_plan", e.target.value)} dir="auto" /></label>
          {impact && <pre className="text-[9px] text-stone-400 bg-stone-900 rounded p-1 overflow-x-auto max-h-32" dir="ltr">{impact}</pre>}
        </>)}

        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-stone-800">
          <button disabled={busy || !canManage} onClick={() => void save()} className={`${btn} border-sky-700 text-sky-300 hover:bg-sky-950`}>
            {t({ ar: "حفظ", en: "Save" })}</button>

          {kind === "change" && !isNew && (<>
            <button disabled={busy} onClick={() => void preview()} className={`${btn} border-stone-700 text-stone-300`}>
              {t({ ar: "معاينة الأثر", en: "Impact preview" })}</button>
            {(CR_NEXT[status] ?? []).map((to) => (
              <button key={to} disabled={busy || !canManage} onClick={() => void advance(to)}
                className={`${btn} ${to === "rejected" || to === "cancelled" ? "border-red-800 text-red-300 hover:bg-red-950" : "border-emerald-800 text-emerald-300 hover:bg-emerald-950"}`}>
                {t(CR_LABEL[to] ?? { ar: to, en: to })}
              </button>
            ))}
            {status === "approved" && (
              <button disabled={busy || !canManage} onClick={() => void apply()} className={`${btn} border-amber-700 text-amber-300 hover:bg-amber-950`}>
                {t({ ar: "تطبيق على المشروع", en: "Apply to project" })}</button>
            )}
          </>)}
          <button onClick={onClose} className={`${btn} border-stone-700 text-stone-400`}>{t({ ar: "إغلاق", en: "Close" })}</button>
        </div>
        {!canManage && <p className="text-[9px] text-amber-500">{t({ ar: "عرض فقط — لا تملك صلاحية التعديل.", en: "Read-only — you lack edit permission." })}</p>}
      </div>
    </div>
  );
}
