"use client";
// ════════════════════════════════════════════════════════════════════════════
// ProjectActionsMenu — «إجراءات المشروع»
//
// WHY: project_core_hold_action was deployed and granted, but NOTHING in the product
// called it — hold / resume / cancel were unreachable from the actual project page. This
// menu is that missing surface.
//
// DESIGN RULE (explicit requirement): on_hold and cancelled are ADMINISTRATIVE ACTIONS,
// not steps on the stage bar. They live here, beside the timeline — never inside it.
//
// Every action: mandatory reason → impact shown → final confirmation → existing RPC →
// immediate refresh. Authorization is enforced server-side inside each RPC; the menu only
// decides what to OFFER. Audit and notifications are written by the RPCs themselves.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { pcHoldAction, pcErr, type PcHoldAction } from "@/lib/portal/projectCore";
import { projectReopenRequestCreate, closureErr } from "@/lib/portal/projectClosure";
import { isAdminState, adminStateColor, lifecycleLabel } from "@/lib/project-core/lifecycle";

type Kind = PcHoldAction | "reopen";

const COPY: Record<Kind, {
  label: { ar: string; en: string };
  title: { ar: string; en: string };
  impact: { ar: string; en: string };
  confirm: { ar: string; en: string };
  tone: string;
}> = {
  hold: {
    label: { ar: "تعليق المشروع", en: "Put on hold" },
    title: { ar: "تعليق المشروع مؤقتًا", en: "Put the project on hold" },
    impact: {
      ar: "سيتوقّف تقدّم المراحل، وتبقى المواعيد والتسليمات كما هي دون تعديل تلقائي. لا تُحذف أي بيانات، ويمكن الاستئناف لاحقًا إلى المرحلة نفسها.",
      en: "Stage progress stops. Dates and deliveries are left untouched — nothing is auto-shifted. No data is deleted and the project can be resumed to the same stage.",
    },
    confirm: { ar: "تأكيد التعليق", en: "Confirm hold" },
    tone: "amber",
  },
  resume: {
    label: { ar: "استئناف المشروع", en: "Resume project" },
    title: { ar: "استئناف المشروع", en: "Resume the project" },
    impact: {
      ar: "سيعود المشروع إلى المرحلة التي كان فيها قبل التعليق تحديدًا (تُقرأ من سجلّ الحالات) — لا إلى مرحلة ثابتة.",
      en: "The project returns to exactly the stage it was in before the hold (read from the status history) — not to a fixed stage.",
    },
    confirm: { ar: "تأكيد الاستئناف", en: "Confirm resume" },
    tone: "emerald",
  },
  cancel: {
    label: { ar: "إلغاء المشروع", en: "Cancel project" },
    title: { ar: "إلغاء المشروع", en: "Cancel the project" },
    impact: {
      ar: "⚠️ الإلغاء لا يحذف شيئًا: تبقى المخرجات والملفات والتعليقات والاعتمادات وسجلّ التدقيق محفوظة كاملة. لكن تتوقّف العمليات التشغيلية على المشروع.",
      en: "⚠️ Cancelling deletes nothing: deliverables, files, comments, approvals and the audit log are all kept. Operational work on the project stops.",
    },
    confirm: { ar: "تأكيد الإلغاء", en: "Confirm cancellation" },
    tone: "red",
  },
  reopen: {
    label: { ar: "إعادة فتح المشروع", en: "Reopen project" },
    title: { ar: "طلب إعادة فتح المشروع", en: "Request project reopen" },
    impact: {
      ar: "المشروع مُغلق والتعديل عليه ممنوع. إعادة الفتح تمرّ عبر طلب مُسجَّل يعتمده المالك، ويُسجَّل السبب في سجلّ التدقيق.",
      en: "The project is closed and locked. Reopening goes through a recorded request approved by the owner, and the reason is written to the audit log.",
    },
    confirm: { ar: "إرسال طلب إعادة الفتح", en: "Submit reopen request" },
    tone: "sky",
  },
};

const TONE: Record<string, string> = {
  amber: "border-amber-700 text-amber-300 hover:bg-amber-950",
  emerald: "border-emerald-700 text-emerald-300 hover:bg-emerald-950",
  red: "border-red-800 text-red-300 hover:bg-red-950",
  sky: "border-sky-700 text-sky-300 hover:bg-sky-950",
};

export default function ProjectActionsMenu({
  projectId, coreStage, canManage, isOwner, onChanged, flash,
}: {
  projectId: string;
  coreStage: string | null | undefined;
  canManage: boolean;
  isOwner: boolean;
  onChanged: () => void;
  flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const stage = coreStage ?? "";
  const onHold = stage === "on_hold";
  const cancelled = stage === "cancelled";
  const closed = stage === "closed";

  // What is OFFERED. The server re-checks all of it.
  const available: Kind[] = [];
  if (canManage) {
    if (!onHold && !cancelled && !closed) available.push("hold");
    if (onHold) available.push("resume");
    if (!cancelled && !closed) available.push("cancel");
  }
  if (closed && isOwner) available.push("reopen");

  async function run(kind: Kind) {
    const txt = reason.trim();
    if (!txt) { flash(t({ ar: "السبب إلزامي.", en: "A reason is required." })); return; }
    setBusy(true);
    const r = kind === "reopen"
      ? await projectReopenRequestCreate(projectId, txt, "delivered")
      : await pcHoldAction(projectId, kind, txt);
    setBusy(false);
    if (!r.ok) {
      flash(kind === "reopen" ? closureErr(r.error) : pcErr(r.error));
      return;
    }
    flash(t(
      kind === "hold" ? { ar: "عُلّق المشروع.", en: "Project put on hold." }
      : kind === "resume" ? { ar: "استُؤنف المشروع.", en: "Project resumed." }
      : kind === "cancel" ? { ar: "أُلغي المشروع. البيانات محفوظة.", en: "Project cancelled. Data retained." }
      : { ar: "أُرسل طلب إعادة الفتح للاعتماد.", en: "Reopen request submitted for approval." }
    ));
    setOpen(null); setReason("");
    onChanged();
  }

  const badgeColor = adminStateColor(stage);

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Current administrative state, stated in Arabic — never a raw key. */}
      {badgeColor && (
        <span className="text-[10px] px-2 py-0.5 rounded font-semibold"
          style={{ background: badgeColor + "22", color: badgeColor }}>
          {t(lifecycleLabel(stage))}
        </span>
      )}

      {available.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] text-stone-500">{t({ ar: "إجراءات المشروع:", en: "Project actions:" })}</span>
          {available.map((k) => (
            <button key={k} type="button" onClick={() => { setOpen(k); setReason(""); }}
              className={`text-[10px] rounded px-2 py-1 border ${TONE[COPY[k].tone]}`}>
              {t(COPY[k].label)}
            </button>
          ))}
        </div>
      )}

      {/* Why an action is unavailable — never a silently missing button. */}
      {canManage && cancelled && (
        <span className="text-[10px] text-stone-500">{t({ ar: "المشروع ملغى — لا إجراءات تشغيلية.", en: "Project cancelled — no operational actions." })}</span>
      )}
      {closed && !isOwner && (
        <span className="text-[10px] text-stone-500">{t({ ar: "المشروع مغلق — إعادة الفتح للمالك فقط.", en: "Closed — only the owner may reopen." })}</span>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" role="dialog" aria-modal="true">
          <div className="w-full max-w-md bg-stone-950 border border-stone-800 rounded-xl p-4 space-y-3" dir="rtl">
            <h4 className="text-sm font-semibold text-stone-100">{t(COPY[open].title)}</h4>
            <p className="text-[11px] text-stone-300 leading-relaxed">{t(COPY[open].impact)}</p>

            <label className="block text-[11px] text-stone-400">
              {t({ ar: "السبب (إلزامي)", en: "Reason (required)" })}
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} dir="auto"
                className="w-full mt-1 bg-stone-900 border border-stone-700 rounded px-2 py-1.5 text-[12px] text-stone-100"
                placeholder={t({ ar: "اكتب سببًا واضحًا — يُسجَّل في سجلّ التدقيق.", en: "Write a clear reason — it is written to the audit log." })} />
            </label>

            <div className="flex items-center gap-2 pt-1">
              <button disabled={busy || !reason.trim()} onClick={() => void run(open)}
                className={`text-[11px] rounded px-3 py-1.5 border disabled:opacity-40 ${TONE[COPY[open].tone]}`}>
                {busy ? t({ ar: "جارٍ التنفيذ…", en: "Working…" }) : t(COPY[open].confirm)}
              </button>
              <button disabled={busy} onClick={() => { setOpen(null); setReason(""); }}
                className="text-[11px] rounded px-3 py-1.5 border border-stone-700 text-stone-400">
                {t({ ar: "تراجع", en: "Cancel" })}
              </button>
              {!reason.trim() && <span className="text-[9px] text-stone-600">{t({ ar: "اكتب السبب لتفعيل التأكيد.", en: "Enter a reason to enable." })}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** True when the linear stage bar must be locked (administrative state or closed). */
export function stageBarLocked(coreStage: string | null | undefined): boolean {
  return isAdminState(coreStage) || coreStage === "closed";
}
