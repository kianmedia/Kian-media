"use client";
// ════════════════════════════════════════════════════════════════════════════
// TransitionApprovalsPanel — «طلبات الانتقال»: صندوق القرار.
//
// من يراه: كوادر كيان المعنيّون. **زرّ الاعتماد لا يُرسَم للمونتير ولا للعميل
// إطلاقًا** (trCanDecide)، والطالب يرى طلبه بحالته فقط. وهذا كلّه عرض: البتّ
// الحقيقيّ داخل دالّة SECURITY DEFINER على الخادم، ورفضها نهائيّ مهما رُسم هنا.
//
// قبل الاعتماد تُعرض مقارنة «الحالي ← بعد الاعتماد» صريحة، لأنّ الموافقة وحدها
// هي ما ينفّذ التغيير فعليًّا. الإشعارات داخل البوّابة فقط — ولا يُبلَّغ العميل.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import {
  trCanDecide, trDecide, trErr, trFallbackLabel, trKindLabel, trStatusLabel, trUnavailableAr, trWhen,
  TR_STATUS_TONE, type TrRequest,
} from "@/lib/portal/transitions";
import {
  trCard, TrBadge, TrBeforeAfter, TrField, TrNotice, TrUnavailable, useTransitionRequests,
} from "@/components/portal/TransitionAtoms";

const inp = "w-full bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200";

export default function TransitionApprovalsPanel({ projectId }: { projectId: string }) {
  const { role, caps, rows, loading, error, reload, recheck } = useTransitionRequests(projectId);
  const [only, setOnly] = useState<"pending" | "all">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const canDecide = trCanDecide(role);

  const shown = useMemo(
    () => (only === "pending" ? rows.filter((r) => r.status === "pending") : rows),
    [rows, only],
  );
  const pendingCount = useMemo(() => rows.filter((r) => r.status === "pending").length, [rows]);

  // «غير مفعَّل» يُقاس بما يحتاجه هذا السطح فعلًا: القراءة والبتّ.
  const unavailable = trUnavailableAr(caps, "decide");
  if (unavailable) {
    return (
      <div dir="rtl" className="space-y-2">
        <TrUnavailable message={unavailable} onRecheck={recheck} busy={loading} />
      </div>
    );
  }

  async function decide(r: TrRequest, decision: "approve" | "reject", note: string) {
    if (busyId) return;
    if (decision === "reject" && note.trim() === "") { setFlash("سبب الرفض إلزاميّ."); return; }
    setBusyId(r.id); setFlash(null);
    const res = await trDecide(r.id, decision, note);
    setBusyId(null);
    if (!res.ok) { setFlash(trErr(res.error, res.status)); return; }
    if (res.data.ok !== true) {
      setFlash(res.data.message ?? "لم يؤكّد الخادم تنفيذ القرار — أعد التحميل وتحقّق.");
      reload(); return;
    }
    setFlash(decision === "approve"
      ? (res.data.applied === true
          ? "اعتُمد الطلب ونُفِّذ التغيير."
          : "اعتُمد الطلب، لكنّ الخادم لم يؤكّد تنفيذ التغيير — تحقّق من العنصر.")
      : "رُفض الطلب وسُجِّلت الملاحظة.");
    reload();
  }

  return (
    <div dir="rtl" className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {(["pending", "all"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setOnly(k)} aria-pressed={only === k}
              className={`text-[11px] px-3 py-1.5 rounded-lg border ${only === k ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400"}`}>
              {k === "pending" ? `بانتظار الموافقة (${pendingCount})` : "كل الطلبات"}
            </button>
          ))}
        </div>
        <button type="button" onClick={reload} disabled={loading}
          className="text-[11px] text-stone-300 border border-stone-700 rounded-lg px-3 py-1.5 disabled:opacity-40">
          {loading ? "جارٍ التحديث…" : "تحديث"}
        </button>
      </div>

      <p className="text-[10px] text-stone-500">
        {canDecide
          ? "الموافقة وحدها هي ما ينفّذ التغيير. الإشعارات داخل البوّابة فقط، ولا يُبلَّغ العميل بأيّ طلب أو قرار."
          : "هذه طلباتك ومسارها. الاعتماد من صلاحية المالك/المدير، ولا يُبلَّغ العميل بشيء."}
      </p>
      {/* حدّ معلَن لا مفاجأة: طلب المخرَج يُسجَّل على مشروع المخرَج نفسه، فطلبات
          المراحل (المشاريع الفرعية) تُعرض في صفحاتها. والإشعار داخل البوّابة يصل
          صاحب القرار في كلّ الأحوال، فلا يضيع طلب لأنّ الصفحة المفتوحة غير صفحته. */}
      <p className="text-[10px] text-stone-600">
        تعرض هذه القائمة طلبات هذا المشروع. طلبات مخرجات المشاريع الفرعية تظهر في صفحة كلّ مشروع فرعيّ،
        ويصل إشعارها داخل البوّابة على أيّ حال.
      </p>

      {error && <TrNotice kind="error">{trErr(error)}</TrNotice>}
      {flash && <TrNotice kind="info">{flash}</TrNotice>}

      {shown.length === 0 ? (
        <div className={`${trCard} p-6 text-center text-[11px] text-stone-500`}>
          {loading ? "جارٍ التحميل…" : only === "pending" ? "لا طلبات بانتظار الموافقة." : "لا طلبات مسجَّلة."}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map((r) => (
            <RequestCard key={r.id} r={r} canDecide={canDecide} busy={busyId === r.id}
              onDecide={(d, note) => void decide(r, d, note)} />
          ))}
        </div>
      )}
    </div>
  );
}

function RequestCard({
  r, canDecide, busy, onDecide,
}: {
  r: TrRequest; canDecide: boolean; busy: boolean;
  onDecide: (decision: "approve" | "reject", note: string) => void;
}) {
  const [stage, setStage] = useState<"idle" | "approve" | "reject">("idle");
  const [note, setNote] = useState("");
  const before = r.from_label ?? trFallbackLabel(r.kind, r.from_value);
  const after = r.to_label ?? trFallbackLabel(r.kind, r.to_value);
  const isPending = r.status === "pending";

  return (
    <div className={`${trCard} p-3 space-y-2`}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-stone-100">{trKindLabel(r.kind)}</span>
        <TrBadge text={trStatusLabel(r.status)} tone={TR_STATUS_TONE[r.status] ?? "info"} />
        <span className="text-[10px] text-stone-500 ms-auto" dir="auto">{trWhen(r.requested_at)}</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <TrField label="مُقدِّم الطلب">{r.requester_name ?? "—"}</TrField>
        <TrField label="المشروع">{r.project_name ?? "—"}</TrField>
        <TrField label="المخرج">{r.deliverable_title ?? (r.deliverable_id ? "—" : "المشروع نفسه")}</TrField>
      </div>

      <TrBeforeAfter label="الحالي ← المطلوب" before={before} after={after} />

      <TrField label="السبب">
        <span className="whitespace-pre-wrap break-words">{r.reason || "—"}</span>
      </TrField>

      {!isPending && (
        <div className="grid grid-cols-2 gap-2 border-t border-stone-800 pt-2">
          <TrField label="القرار من">{r.decider_name ?? "—"}</TrField>
          <TrField label="وقت القرار">{trWhen(r.decided_at)}</TrField>
          {r.decision_note && (
            <div className="col-span-2">
              <TrField label="ملاحظة القرار">
                <span className="whitespace-pre-wrap break-words">{r.decision_note}</span>
              </TrField>
            </div>
          )}
        </div>
      )}

      {/* زرّ الاعتماد غائب تمامًا لغير المخوَّل — لا معطَّلًا ولا مخفيًّا بـCSS. */}
      {isPending && canDecide && (
        <div className="border-t border-stone-800 pt-2 space-y-2">
          {stage === "idle" ? (
            <div className="flex gap-2 flex-wrap">
              <button type="button" onClick={() => setStage("approve")} disabled={busy}
                className="text-[11px] bg-emerald-800 disabled:opacity-40 text-white rounded-lg px-3 py-1.5">
                مراجعة واعتماد
              </button>
              <button type="button" onClick={() => setStage("reject")} disabled={busy}
                className="text-[11px] bg-stone-800 border border-red-900 text-red-200 disabled:opacity-40 rounded-lg px-3 py-1.5">
                رفض
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {stage === "approve" && (
                <TrNotice kind="warn">
                  بالاعتماد يُنفَّذ التغيير فورًا على {r.deliverable_title ? "المخرج" : "المشروع"}:
                  {" "}«{before}» ← «{after}». راجع المقارنة أعلاه قبل التأكيد.
                </TrNotice>
              )}
              <label className="block">
                <span className="text-[10px] text-stone-500">
                  {stage === "reject" ? "سبب الرفض (إلزاميّ — يصل الطالب)" : "ملاحظة القرار (اختيارية — تصل الطالب)"}
                </span>
                <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={`${inp} resize-y`} />
              </label>
              <div className="flex gap-2 flex-wrap">
                <button type="button" disabled={busy || (stage === "reject" && note.trim() === "")}
                  onClick={() => onDecide(stage === "approve" ? "approve" : "reject", note)}
                  className={`text-[11px] text-white rounded-lg px-3 py-1.5 disabled:opacity-40 ${stage === "approve" ? "bg-emerald-700" : "bg-red-700"}`}>
                  {busy ? "جارٍ…" : stage === "approve" ? "تأكيد الاعتماد والتنفيذ" : "تأكيد الرفض"}
                </button>
                <button type="button" onClick={() => { setStage("idle"); setNote(""); }} disabled={busy}
                  className="text-[11px] bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-3 py-1.5">
                  تراجع
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
