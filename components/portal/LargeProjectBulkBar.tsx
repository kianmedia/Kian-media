"use client";
// ════════════════════════════════════════════════════════════════════════════
// LargeProjectBulkBar — الإجراءات الجماعية منخفضة الخطورة.
//
// ثوابت لا يجوز كسرها:
//   1. الصلاحية تُتحقَّق على **الخادم** لكلّ عنصر (الدالّة SECURITY DEFINER)،
//      والواجهة لا تدّعي صلاحية ولا تُخفي رفضًا.
//   2. عدد العناصر المتأثّرة معروض دائمًا قبل التنفيذ.
//   3. أثر كبير (فوق LP_BULK_CONFIRM_THRESHOLD) ⇒ تأكيد ثانٍ صريح بكتابة العدد.
//   4. السبب إلزاميّ — هو نصّ أثر التدقيق.
//   5. النتيجة تُعرض لكلّ عنصر: نجح/فشل + السبب. **لا يُخفى فشل جزئيّ أبدًا**،
//      ولا يُعرض «تم» ما لم يؤكّد الخادم كل عنصر.
//   6. تعذّر تسجيل أثر التدقيق ⇒ تحذير ظاهر، لا صمت.
//
// وإذا لم تكن دالّة التعديل الجماعي مطبّقة: الشريط يظهر **معطَّلًا** برسالة صريحة.
// لا مسار التفافيّ يكتب في الجدول مباشرةً بلا أثر تدقيق.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  lpBulkApply, lpErr, LP_BULK_LABELS, LP_BULK_REQUIRES, LP_BULK_CONFIRM_THRESHOLD,
  LP_PRIORITIES, LP_PRIORITY_LABELS, LP_STATUSES, LP_STATUS_LABELS, LP_REQUIREMENTS,
  LP_REQUIREMENT_LABELS,
  type LpBulkAction, type LpBulkKind, type LpBulkOutcome, type LpCapabilities,
  type LpStage, type LpPriority, type LpDeliverableStatus, type LpRequirement,
} from "@/lib/portal/large-projects";
import { lpCard, LpNotice } from "@/components/portal/LargeProjectAtoms";

const KINDS: LpBulkKind[] = [
  "assign_owner", "set_priority", "set_status", "set_client_visibility",
  "set_schedule", "clear_schedule", "move_to_stage", "set_requirements",
];

export default function LargeProjectBulkBar({
  ids, caps, stages, staff, onApplied, onClose,
}: {
  ids: string[];
  caps: LpCapabilities;
  stages: LpStage[];
  staff: { id: string; full_name: string | null }[];
  /** يُسلَّم التقرير إلى الأب ليبقى ظاهرًا بعد اختفاء التحديد (وبالتالي هذا الشريط). */
  onApplied: (outcome: LpBulkOutcome) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<LpBulkKind>("assign_owner");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState<LpPriority>("normal");
  const [status, setStatus] = useState<LpDeliverableStatus>("internal_review");
  const [visible, setVisible] = useState(true);
  const [dueDate, setDueDate] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [stageId, setStageId] = useState(stages[0]?.project_id ?? "");
  const [requires, setRequires] = useState<Partial<Record<LpRequirement, boolean>>>({});
  const [reason, setReason] = useState("");
  const [typedCount, setTypedCount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const count = ids.length;
  const big = count > LP_BULK_CONFIRM_THRESHOLD;
  const missing = LP_BULK_REQUIRES[kind].filter((c) => !caps.columns[c]);
  const blocked = !caps.bulk || missing.length > 0;

  function build(): LpBulkAction | null {
    switch (kind) {
      case "assign_owner": return { kind, assignee_id: assignee || null };
      case "set_priority": return { kind, priority };
      case "set_status": return { kind, status };
      case "set_client_visibility": return { kind, visible };
      // الحفظ بلا تاريخ مسموح: يعود المخرج إلى «بانتظار الجدولة» ولا يُرفَض الطلب.
      case "set_schedule": return { kind, due_date: dueDate || null, planned_start_date: plannedStart || null };
      case "clear_schedule": return { kind };
      case "move_to_stage": return stageId ? { kind, stage_id: stageId } : null;
      case "set_requirements": {
        const picked = Object.keys(requires).length > 0;
        return picked ? { kind, requires } : null;
      }
      default: return null;
    }
  }

  async function apply() {
    setErr("");
    const action = build();
    if (!action) { setErr(t({ ar: "أكمل بيانات الإجراء أوّلًا.", en: "Complete the action fields first." })); return; }
    if (!reason.trim()) { setErr(t({ ar: "السبب إلزاميّ — يُسجَّل في أثر التدقيق.", en: "A reason is required for the audit trail." })); return; }
    if (big && typedCount.trim() !== String(count)) {
      setErr(t({ ar: `أثر كبير: اكتب العدد ${count} للتأكيد.`, en: `Large impact: type ${count} to confirm.` }));
      return;
    }
    setBusy(true);
    const r = await lpBulkApply(ids, action, reason.trim(), caps);
    setBusy(false);
    if (!r.ok) { setErr(lpErr(r.error, r.status)); return; }
    setTypedCount("");
    // التقرير يُرفَع إلى الأب: تفريغ التحديد بعد التنفيذ يُخفي هذا الشريط، وإبقاء
    // التقرير هنا كان سيبتلع نتيجة الفشل الجزئيّ قبل أن يراها المستخدم.
    onApplied(r.data);
  }

  return (
    <div className={`${lpCard} p-2.5 sm:p-3 space-y-2 border-sky-900`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-stone-100">
          {t({ ar: "إجراء جماعيّ على", en: "Bulk action on" })} <span className="text-sky-300" dir="ltr">{count}</span> {t({ ar: "مخرجًا", en: "items" })}
        </span>
        <button type="button" onClick={onClose} className="text-[11px] text-stone-400 hover:text-white">
          {t({ ar: "إغلاق", en: "Close" })}
        </button>
      </div>

      {!caps.bulk && (
        <LpNotice kind="warn">
          {t({
            ar: "الإجراءات الجماعية معطَّلة: دالّة التعديل الجماعي غير مطبّقة في قاعدة البيانات. لا يمكن تنفيذها من المتصفّح بلا تحقّق صلاحية وأثر تدقيق على الخادم.",
            en: "Bulk actions are disabled: the server-side bulk function is not deployed. They cannot run from the browser without server-side authorization and an audit entry.",
          })}
        </LpNotice>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <select value={kind} onChange={(e) => { setKind(e.target.value as LpBulkKind); setErr(""); }}
          className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200">
          {KINDS.map((k) => <option key={k} value={k}>{t(LP_BULK_LABELS[k])}</option>)}
        </select>

        {kind === "assign_owner" && (
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)}
            className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200 max-w-[200px]">
            <option value="">{t({ ar: "بلا مسؤول", en: "Unassigned" })}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id.slice(0, 8)}</option>)}
          </select>
        )}

        {kind === "set_priority" && (
          <select value={priority} onChange={(e) => setPriority(e.target.value as LpPriority)}
            className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200">
            {LP_PRIORITIES.map((p) => <option key={p} value={p}>{t(LP_PRIORITY_LABELS[p])}</option>)}
          </select>
        )}

        {kind === "set_status" && (
          <select value={status} onChange={(e) => setStatus(e.target.value as LpDeliverableStatus)}
            className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200">
            {LP_STATUSES.map((s) => <option key={s} value={s}>{t(LP_STATUS_LABELS[s])}</option>)}
          </select>
        )}

        {kind === "set_client_visibility" && (
          <select value={visible ? "1" : "0"} onChange={(e) => setVisible(e.target.value === "1")}
            className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200">
            <option value="1">{t({ ar: "إظهار للعميل", en: "Show to client" })}</option>
            <option value="0">{t({ ar: "إخفاء عن العميل", en: "Hide from client" })}</option>
          </select>
        )}

        {kind === "set_schedule" && (
          <>
            <label className="text-[10px] text-stone-500">{t({ ar: "البدء", en: "Start" })}
              <input type="date" value={plannedStart} onChange={(e) => setPlannedStart(e.target.value)} dir="ltr"
                className="ms-1 bg-stone-950 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200" />
            </label>
            <label className="text-[10px] text-stone-500">{t({ ar: "التسليم", en: "Due" })}
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} dir="ltr"
                className="ms-1 bg-stone-950 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200" />
            </label>
            <span className="text-[9px] text-sky-300">
              {t({ ar: "اتركه فارغًا = يبقى «بانتظار الجدولة» (يُقبَل الحفظ)", en: "Leave empty = stays awaiting schedule (save still succeeds)" })}
            </span>
          </>
        )}

        {kind === "move_to_stage" && (
          <select value={stageId} onChange={(e) => setStageId(e.target.value)}
            className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200 max-w-[200px]">
            {stages.map((s) => <option key={s.project_id} value={s.project_id}>{s.name ?? s.project_id.slice(0, 8)}</option>)}
          </select>
        )}

        {kind === "set_requirements" && LP_REQUIREMENTS.map((r) => (
          <label key={r} className="flex items-center gap-1 text-[10px] text-stone-400">
            <input type="checkbox" checked={requires[r] === true}
              onChange={(e) => setRequires((prev) => ({ ...prev, [r]: e.target.checked }))} />
            {t(LP_REQUIREMENT_LABELS[r])}
          </label>
        ))}
      </div>

      {missing.length > 0 && caps.bulk && (
        <LpNotice kind="warn">
          {t({ ar: `هذا الإجراء يحتاج عمودًا غير مطبّق بعد: ${missing.join("، ")}.`, en: `This action needs a column that is not deployed yet: ${missing.join(", ")}.` })}
        </LpNotice>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={t({ ar: "السبب (إلزاميّ — يُسجَّل في أثر التدقيق)", en: "Reason (required — written to the audit trail)" })}
          className="flex-1 min-w-[160px] bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200" />
        {big && (
          <input value={typedCount} onChange={(e) => setTypedCount(e.target.value)} dir="ltr"
            placeholder={t({ ar: `اكتب ${count} للتأكيد`, en: `Type ${count} to confirm` })}
            className="w-[130px] bg-stone-950 border border-amber-800 rounded-lg px-2 py-1.5 text-[11px] text-amber-200" />
        )}
        <button type="button" onClick={() => void apply()} disabled={busy || blocked}
          className="text-[11px] bg-red-700 disabled:opacity-40 text-white rounded-lg px-4 py-1.5 whitespace-nowrap">
          {busy ? t({ ar: "جارٍ التنفيذ…", en: "Applying…" }) : `${t({ ar: "تنفيذ على", en: "Apply to" })} ${count}`}
        </button>
      </div>

      {big && <p className="text-[10px] text-amber-300">{t({ ar: "أثر كبير: سيُعدَّل أكثر من ٢٥ مخرجًا دفعة واحدة.", en: "Large impact: more than 25 items will change at once." })}</p>}
      {err && <LpNotice kind="error">{err}</LpNotice>}
    </div>
  );
}

/**
 * تقرير النتيجة — صريح، بلا تجميل. يُعرَض من المكوّن الأب (جدول المخرجات) لا من
 * داخل الشريط، ليبقى ظاهرًا بعد أن يُفرَّغ التحديد ويختفي الشريط.
 */
export function DeliverableBulkReport({ outcome, onDismiss }: { outcome: LpBulkOutcome; onDismiss: () => void }) {
  const { t } = useI18n();
  const [expand, setExpand] = useState(false);
  const failures = outcome.results.filter((r) => !r.ok);

  if (outcome.detailUnknown) {
    return (
      <div className="space-y-1.5">
        <div className="flex justify-end">
          <button type="button" onClick={onDismiss} className="text-[10px] text-stone-500 hover:text-white">
            {t({ ar: "إخفاء التقرير", en: "Dismiss report" })}
          </button>
        </div>
        <LpNotice kind="warn">
          {t({
            ar: "نُفِّذ الطلب لكنّ الخادم لم يُرجع نتيجة لكلّ عنصر — لا يمكن تأكيد نجاح أيّ عنصر. أعد التحميل وتحقّق يدويًّا.",
            en: "The call ran but the server returned no per-item result — no item can be confirmed. Reload and verify manually.",
          })}
        </LpNotice>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex justify-end">
        <button type="button" onClick={onDismiss} className="text-[10px] text-stone-500 hover:text-white">
          {t({ ar: "إخفاء التقرير", en: "Dismiss report" })}
        </button>
      </div>
      <LpNotice kind={outcome.failed === 0 ? "ok" : outcome.applied === 0 ? "error" : "warn"}>
        {t({ ar: "نجح", en: "Succeeded" })}: <span dir="ltr">{outcome.applied}</span>
        {" · "}{t({ ar: "فشل", en: "Failed" })}: <span dir="ltr">{outcome.failed}</span>
        {" · "}{t({ ar: "من أصل", en: "of" })} <span dir="ltr">{outcome.requested}</span>
        {outcome.failed > 0 && ` — ${t({ ar: "نجاح جزئيّ: العناصر الفاشلة لم تتغيّر.", en: "Partial success: failed items were not changed." })}`}
      </LpNotice>

      {!outcome.audited && (
        <LpNotice kind="warn">
          {t({
            ar: "لم يؤكّد الخادم كتابة أثر التدقيق لهذه العملية. أبلغ المسؤول قبل الاعتماد عليها.",
            en: "The server did not confirm an audit entry for this operation. Report it before relying on it.",
          })}
        </LpNotice>
      )}

      {failures.length > 0 && (
        <div className="text-[10px] text-stone-400">
          <button type="button" onClick={() => setExpand((v) => !v)} className="underline">
            {expand ? t({ ar: "إخفاء التفاصيل", en: "Hide details" }) : t({ ar: "تفاصيل الفشل", en: "Failure details" })} (<span dir="ltr">{failures.length}</span>)
          </button>
          {expand && (
            <ul className="mt-1 space-y-0.5 max-h-40 overflow-auto">
              {failures.map((f) => (
                <li key={f.id} className="flex gap-2">
                  <span className="text-stone-600 shrink-0" dir="ltr">{f.id.slice(0, 8)}</span>
                  <span className="text-red-300 break-all">{f.error ?? t({ ar: "سبب غير معروف", en: "unknown reason" })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
