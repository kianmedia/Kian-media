"use client";
// ════════════════════════════════════════════════════════════════════════════
// TransitionRequestButton — زرّ «طلب انتقال» ونافذته.
//
// يُركَّب مكان زرّ التنفيذ المباشر لمن يجب أن يمرّ عبر الطلب. لا يقرّر صلاحية:
// المُركِّب هو من يقرّر عرضه (trMustRequest)، والخادم هو الحدّ الحقيقيّ.
//
// الحالات الثلاث المعروضة صراحةً:
//   • جاهز        → «طلب انتقال»
//   • له طلب معلَّق → شارة «بانتظار الموافقة» **بجانب** الزرّ لا بدله: منع الفتح
//     كان سيحجب طلبًا بقيمة أخرى، والقاعدة تمنع المطابق بالقيمة نفسها فقط.
//   • غير مفعَّل   → معطَّل بتلميح عربيّ صريح سببه من lib/portal/pgerror.ts
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { trCapabilities, trUnavailableAr, type TrCapabilities } from "@/lib/portal/transitions";
import TransitionRequestModal, { type TrKindOption, type TrTarget } from "@/components/portal/TransitionRequestModal";

export default function TransitionRequestButton({
  contextLabel, kinds, targets, pending, onDone, label = "طلب انتقال", className,
}: {
  contextLabel: string;
  kinds: TrKindOption[];
  targets: TrTarget[];
  pending?: (kind: string, deliverableId: string | null, toValue?: string | null) => boolean;
  onDone?: () => void;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [caps, setCaps] = useState<TrCapabilities | null>(null);

  useEffect(() => {
    let alive = true;
    void trCapabilities().then((c) => { if (alive) setCaps(c); });
    return () => { alive = false; };
  }, []);

  // شارة فقط: يوجد طلب معلَّق واحد على الأقل على هذه الأهداف.
  const anyPending = pending !== undefined && targets.length > 0
    && targets.some((tg) => kinds.some((k) => pending(k.kind, tg.deliverableId) === true));

  const unavailable = trUnavailableAr(caps, "request");
  const disabled = targets.length === 0 || (caps !== null && unavailable !== null);
  const base = className
    ?? "text-[11px] rounded-lg px-3 py-1.5 border whitespace-nowrap disabled:opacity-40 bg-stone-800 border-amber-900 text-amber-200";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={disabled} className={base}
        title={unavailable ?? undefined}>
        {label}
      </button>
      {anyPending && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-900 bg-amber-950/30 text-amber-200">
          بانتظار الموافقة
        </span>
      )}
      {open && (
        <TransitionRequestModal
          contextLabel={contextLabel} kinds={kinds} targets={targets} pending={pending}
          onClose={() => setOpen(false)} onDone={onDone}
        />
      )}
    </>
  );
}
