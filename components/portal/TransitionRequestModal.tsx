"use client";
// ════════════════════════════════════════════════════════════════════════════
// TransitionRequestModal — «طلب انتقال».
//
// يحلّ محلّ التنفيذ المباشر لمن لا يملك قرار الانتقال (المونتير مثالًا): بدل زرّ
// ينقل المخرج بين المراحل أو يغيّر حالته أو يُظهره للعميل، يُسجَّل **طلب** ولا
// يقع أيّ تغيير حتى يوافق صاحب الصلاحية.
//
// ثوابت هذه الشاشة:
//   1. السبب إلزاميّ — لا إرسال بلا سبب مكتوب.
//   2. «الحالي ← المطلوب» ظاهر لكلّ عنصر قبل الإرسال، بلا اختصار مضلِّل.
//   3. تحذير صريح بأن التنفيذ يحتاج موافقة، وأن شيئًا لم يتغيّر بعد.
//   4. طلب معلَّق مطابق ⇒ لا إرسال ثانٍ (والحارس القاطع فهرس فريد في القاعدة).
//   5. الحزمة غير مطبَّقة ⇒ حالة «معطَّل» عربية صريحة، لا انهيار ولا شاشة فارغة،
//      ولا ادّعاء «ترحيلة ناقصة» حين يكون السبب صلاحيةً أو شبكة (lib/portal/pgerror.ts).
//   6. النتيجة تُعرض لكلّ عنصر: سُجِّل / معلَّق أصلًا / فشل + السبب. لا فشل صامت.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from "react";
import {
  trCapabilities, trCreateMany, trErr, trUnavailableAr, TR_MAX_BATCH,
  type TrCapabilities, type TrKind, type TrBatchResult,
} from "@/lib/portal/transitions";
import { TrBeforeAfter, TrModalShell, TrNotice, TrUnavailable } from "@/components/portal/TransitionAtoms";

/** هدف واحد للطلب: مخرج بعينه، أو المشروع نفسه (deliverableId = null). */
export interface TrTarget {
  key: string;
  deliverableId: string | null;
  /** المشروع المالك للهدف — مشروع المخرج نفسه لا المشروع الرئيسيّ. */
  projectId: string;
  label: string;
}

/** نوع انتقال معروض في النافذة، بقيمه الممكنة وقيمته الحالية لكلّ هدف. */
export interface TrKindOption {
  kind: TrKind;
  label: string;
  /** ملاحظة قصيرة تشرح أثر هذا النوع (يراها الطالب قبل الإرسال). */
  hint?: string;
  options: { value: string; label: string }[];
  from: (t: TrTarget) => { value: string | null; label: string };
}

const inp = "w-full bg-stone-950 border border-stone-700 rounded-lg px-2 py-1.5 text-[11px] text-stone-200";

export default function TransitionRequestModal({
  contextLabel, kinds, targets, pending, onClose, onDone,
}: {
  /** ما يقع عليه الطلب في جملة واحدة (اسم المشروع/المرحلة). */
  contextLabel: string;
  kinds: TrKindOption[];
  targets: TrTarget[];
  /** حارس التكرار — يطابق مفتاح الفهرس الفريد (نوع + مخرج + القيمة المطلوبة). */
  pending?: (kind: string, deliverableId: string | null, toValue?: string | null) => boolean;
  onClose: () => void;
  /** يُستدعى بعد تسجيل طلب واحد على الأقل — لإعادة تحميل القوائم. */
  onDone?: () => void;
}) {
  const [caps, setCaps] = useState<TrCapabilities | null>(null);
  const [checking, setChecking] = useState(false);
  const [kindIdx, setKindIdx] = useState(0);
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [results, setResults] = useState<TrBatchResult[] | null>(null);

  useEffect(() => {
    let alive = true;
    void trCapabilities().then((c) => { if (alive) setCaps(c); });
    return () => { alive = false; };
  }, []);

  async function recheck() {
    setChecking(true);
    const c = await trCapabilities(true);
    setChecking(false); setCaps(c);
  }

  const active = kinds[Math.min(kindIdx, kinds.length - 1)];

  // تغيير النوع يُصفّر القيمة المطلوبة: قيم نوعٍ لا تصلح لنوع آخر.
  useEffect(() => { setTo(""); setResults(null); setErr(""); }, [kindIdx]);

  const split = useMemo(() => {
    const blocked: TrTarget[] = [];
    const noop: TrTarget[] = [];
    const ready: TrTarget[] = [];
    if (!active) return { blocked, noop, ready };
    for (const tg of targets) {
      // «مطابق» = النوع نفسه والقيمة المطلوبة نفسها، تمامًا كمفتاح الفهرس الفريد
      // في القاعدة. قبل اختيار القيمة لا يُمنع شيء (لا يوجد طلب بعد ليكون مطابقًا).
      if (to !== "" && pending && pending(active.kind, tg.deliverableId, to) === true) { blocked.push(tg); continue; }
      if (to !== "" && active.from(tg).value === to) { noop.push(tg); continue; }
      ready.push(tg);
    }
    return { blocked, noop, ready };
  }, [targets, active, to, pending]);

  const unavailable = trUnavailableAr(caps, "request");
  const overCap = split.ready.length > TR_MAX_BATCH;
  const canSubmit = !busy && !unavailable && to !== "" && reason.trim() !== "" && split.ready.length > 0 && !overCap;

  async function submit() {
    if (!active || !canSubmit) return;
    setErr(""); setBusy(true);
    const r = await trCreateMany(split.ready.map((tg) => ({
      key: tg.key,
      label: tg.label,
      projectId: tg.projectId,
      deliverableId: tg.deliverableId,
      kind: active.kind,
      fromValue: active.from(tg).value,
      toValue: to,
      reason: reason.trim(),
    })));
    setBusy(false);
    if (!r.ok) { setErr(trErr(r.error, r.status)); return; }
    setResults(r.data);
    // نجاح واحد على الأقل ⇒ القوائم تغيّرت (طلب معلَّق جديد) فتُعاد قراءتها.
    if (r.data.some((x) => x.outcome?.ok === true || x.outcome?.duplicate === true)) onDone?.();
  }

  const title = active ? active.label : "طلب انتقال";

  return (
    <TrModalShell title={title} onClose={onClose}>
      <div dir="rtl" className="space-y-3">
        {unavailable ? (
          <TrUnavailable message={unavailable} onRecheck={() => void recheck()} busy={checking} />
        ) : (
          <>
            <TrNotice kind="warn">
              هذا <strong>طلب</strong> لا تنفيذ: لن تتغيّر المرحلة ولا الحالة، ولن يظهر شيء للعميل،
              حتى يوافق صاحب الصلاحية. ستجد الطلب بعد الإرسال بحالة «بانتظار الموافقة».
            </TrNotice>

            <div className="text-[11px] text-stone-300">
              <span className="text-stone-500">المشروع:</span> <span dir="auto">{contextLabel}</span>
              {" · "}
              <span className="text-stone-500">العناصر:</span> <span dir="ltr">{targets.length}</span>
            </div>

            {kinds.length > 1 && (
              <label className="block">
                <span className="text-[10px] text-stone-500">نوع الانتقال المطلوب</span>
                <select value={kindIdx} onChange={(e) => setKindIdx(Number(e.target.value))} className={inp} style={{ colorScheme: "dark" }}>
                  {kinds.map((k, i) => <option key={k.kind} value={i}>{k.label}</option>)}
                </select>
              </label>
            )}
            {active?.hint && <p className="text-[10px] text-stone-500">{active.hint}</p>}

            <label className="block">
              <span className="text-[10px] text-stone-500">القيمة المطلوبة</span>
              <select value={to} onChange={(e) => { setTo(e.target.value); setResults(null); }} className={inp} style={{ colorScheme: "dark" }}>
                <option value="">— اختر —</option>
                {(active?.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>

            {/* قبل ← بعد لكلّ عنصر: لا يُرسل شيء قبل أن يرى الطالب أثر طلبه. */}
            {to !== "" && split.ready.length > 0 && active && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {split.ready.slice(0, 5).map((tg) => (
                  <TrBeforeAfter key={tg.key} label={tg.label}
                    before={active.from(tg).label}
                    after={active.options.find((o) => o.value === to)?.label ?? to} />
                ))}
                {split.ready.length > 5 && (
                  <p className="text-[10px] text-stone-500">
                    و<span dir="ltr">{split.ready.length - 5}</span> عنصرًا آخر بالطلب نفسه.
                  </p>
                )}
              </div>
            )}

            {split.blocked.length > 0 && (
              <TrNotice kind="info">
                <span dir="ltr">{split.blocked.length}</span> عنصرًا له طلب معلَّق <strong>بالقيمة نفسها</strong> («بانتظار الموافقة») — لن يُرسل مرّة ثانية.
              </TrNotice>
            )}
            {split.noop.length > 0 && (
              <TrNotice kind="info">
                <span dir="ltr">{split.noop.length}</span> عنصرًا في القيمة المطلوبة أصلًا — لا طلب له.
              </TrNotice>
            )}
            {overCap && (
              <TrNotice kind="error">
                الحدّ الأقصى <span dir="ltr">{TR_MAX_BATCH}</span> عنصرًا في الطلب الواحد. ضيّق التحديد ثم أعد المحاولة.
              </TrNotice>
            )}

            <label className="block">
              <span className="text-[10px] text-stone-500">السبب (إلزاميّ — يقرؤه صاحب القرار ويُحفظ مع الطلب)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
                placeholder="لماذا تطلب هذا الانتقال الآن؟"
                className={`${inp} resize-y`} />
            </label>

            {err && <TrNotice kind="error">{err}</TrNotice>}

            {results && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {results.map((x) => (
                  <div key={x.key} className="text-[10px] flex gap-2 items-start">
                    <span className="text-stone-400 shrink-0" dir="auto">{x.label}</span>
                    <span className={x.error ? "text-red-300" : x.outcome?.duplicate ? "text-amber-300" : x.outcome?.ok ? "text-emerald-300" : "text-red-300"}>
                      {x.error
                        ? x.error
                        : x.outcome?.duplicate
                          ? "طلب معلَّق مطابق موجود — لم يُنشأ طلب ثانٍ."
                          : x.outcome?.ok
                            ? "سُجِّل الطلب — بانتظار الموافقة."
                            : (x.outcome?.message ?? "لم يؤكّد الخادم تسجيل الطلب.")}
                    </span>
                  </div>
                ))}
                <p className="text-[10px] text-stone-500 pt-1">
                  الطلبات المسجَّلة تظهر لأصحاب القرار في «طلبات الانتقال» داخل البوّابة. لا يُبلَّغ العميل بشيء.
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => void submit()} disabled={!canSubmit}
                className="flex-1 text-[11px] bg-red-700 disabled:opacity-40 text-white rounded-lg px-4 py-2">
                {busy ? "جارٍ التسجيل…" : `تسجيل الطلب (${split.ready.length})`}
              </button>
              <button type="button" onClick={onClose}
                className="text-[11px] bg-stone-800 border border-stone-700 text-stone-200 rounded-lg px-4 py-2">
                {results ? "إغلاق" : "إلغاء"}
              </button>
            </div>
          </>
        )}
      </div>
    </TrModalShell>
  );
}
