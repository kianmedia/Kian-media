"use client";
// ════════════════════════════════════════════════════════════════════════════
// CsubAtoms — القطع المشتركة لسطح «رصيدي الإنتاجي». Mobile-first وRTL أصلًا.
//
// ثلاث قواعد مكتوبة هنا لأنّها تُخترق في الواجهة عادةً لا في القاعدة:
//   ١) «بانتظار تفعيل قاعدة البيانات» ≠ «لا تملك صلاحية» ≠ خطأ ≠ «لا اشتراك».
//      أربع شاشات مختلفة بأربع رسائل مختلفة. طيّها في «لا توجد بيانات» يجعل
//      العميل يظنّ أنّ رصيده ضاع.
//   ٢) ★ CreditStat لا يقبل قيمة غير معروفة ★ — لا يستقبل null ولا undefined،
//      فلا يمكن أن يعرض «٠» عن رقم لا يعرفه أحد. من لا يملك الرقم يعرض
//      UnknownBalance بدلًا منه.
//   ٣) الحجب والغياب يُقالان صراحةً بنصّ، لا بفراغ ولا بصفر.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { CsubState } from "@/lib/portal/commercial";

export const card = "bg-stone-900 border border-stone-800 rounded-xl";

/** زرّ بمساحة لمس ≥44px — الصفحة تُستعمل من الجوّال أوّلًا. */
export const tapBtn =
  "min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium transition-colors " +
  "disabled:opacity-40 disabled:cursor-not-allowed";
export const btnPrimary = `${tapBtn} bg-red-700 hover:bg-red-600 text-white`;
export const btnGhost = `${tapBtn} bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700`;
export const fieldCls =
  "w-full min-h-[44px] bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 " +
  "text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-stone-500";
export const labelCls = "block text-xs text-stone-400 mb-1.5";

export function Spinner({ label = "جارٍ التحميل" }: { label?: string }) {
  return (
    <div className="py-10 text-center">
      <div
        className="inline-block w-5 h-5 border-2 border-stone-600 border-t-transparent rounded-full animate-spin"
        aria-label={label}
      />
    </div>
  );
}

/** الشاشة قبل تشغيل الـSQL. ليست خطأً، وليست رصيدًا صفرًا. */
export function MigrationPending({ message }: { message: string }) {
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="status" dir="rtl">
      <div className="text-2xl" aria-hidden>🗄️</div>
      <h3 className="text-stone-100 text-base font-medium">الميزة بانتظار تفعيل قاعدة البيانات</h3>
      <p className="text-sm text-stone-400 leading-7 max-w-md mx-auto">{message}</p>
      <p className="text-xs text-amber-300/80 leading-6 max-w-md mx-auto">
        لم يُعرض لك أيّ رقم لأنّ الأرقام غير متاحة بعد — ولا يعني ذلك أنّ رصيدك صفر.
      </p>
    </div>
  );
}

export function Denied({ message }: { message: string }) {
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="alert" dir="rtl">
      <div className="text-2xl" aria-hidden>🔒</div>
      <h3 className="text-stone-100 text-base font-medium">لا تملك صلاحية</h3>
      <p className="text-sm text-stone-400 leading-7 max-w-md mx-auto">{message}</p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="alert" dir="rtl">
      <p className="text-sm text-red-300 leading-7">{message}</p>
      {onRetry && <button className={btnGhost} onClick={onRetry}>إعادة المحاولة</button>}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-stone-500" dir="rtl">{message}</p>;
}

/**
 * ★ الرقم غير المعروف ★ — البديل الوحيد المسموح عن رقم رصيد. يُستعمل حين لا
 * يوجد اشتراك، أو لم تُسجَّل حركة، أو لم تُطبَّق الترحيلة. لا صفر مكانه.
 */
export function UnknownBalance({ title, reason }: { title: string; reason: string }) {
  return (
    <div className={`${card} p-5 space-y-2`} role="note" dir="rtl">
      <h3 className="text-stone-200 text-sm font-medium">{title}</h3>
      <p className="text-sm text-stone-400 leading-7">{reason}</p>
      <p className="text-xs text-stone-500 leading-6">
        لم نعرض لك رقمًا لأنّنا لا نملك رقمًا نعرضه. عرض «٠» هنا سيكون معلومة خاطئة.
      </p>
    </div>
  );
}

/** يعرض الحالة الرباعية كما هي دون طمس الفروق بينها. */
export function StateView<T>({
  st, onRetry, children,
}: {
  st: CsubState<T> | null;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
}) {
  if (st === null) return <Spinner />;
  if (st.state === "needs_migration") return <MigrationPending message={st.message} />;
  if (st.state === "denied") return <Denied message={st.message} />;
  if (st.state === "error") return <ErrorBox message={st.message} onRetry={onRetry} />;
  return <>{children(st.data)}</>;
}

/** محمّل موحّد: تسلسل الطلبات (آخر طلب يفوز) + مهلة + حارس Unmount. */
export function useCsubLoad<T>(
  fn: () => Promise<CsubState<T>>,
  deps: unknown[],
  timeoutMs = 20000,
): { st: CsubState<T> | null; reload: () => void } {
  const [st, setSt] = useState<CsubState<T> | null>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const load = useCallback(async () => {
    const my = ++seq.current;
    setSt(null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        fn(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("csub_timeout")), timeoutMs); }),
      ]);
      if (!mounted.current || my !== seq.current) return;
      setSt(r);
    } catch {
      if (!mounted.current || my !== seq.current) return;
      setSt({ state: "error", message: "تأخّر الطلب أكثر من المتوقّع. تحقّق من الشبكة وأعد المحاولة." });
    } finally {
      if (timer) clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { st, reload: () => { void load(); } };
}

/**
 * ★ بطاقة رقم رصيد ★ — `value` من نوع number لا غير: لا null ولا undefined،
 * فلا يمكن بناءً على النوع نفسه أن تعرض هذه البطاقة صفرًا عن رقم مجهول.
 */
export function CreditStat({ label, value, hint, tone = "normal" }: {
  label: string; value: string; hint?: string; tone?: "normal" | "warn" | "bad" | "good";
}) {
  const color =
    tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300"
      : tone === "good" ? "text-emerald-300" : "text-stone-100";
  return (
    <div className={`${card} p-3`} dir="rtl">
      <div className="text-[11px] text-stone-500 mb-1">{label}</div>
      <div className={`text-base font-medium ${color}`}>{value}</div>
      {hint && <div className="text-[10px] text-stone-600 mt-1 leading-5">{hint}</div>}
    </div>
  );
}

export function Chip({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "warn" | "good" | "bad" }) {
  const cls =
    tone === "bad" ? "bg-red-950 text-red-300 border-red-900"
      : tone === "warn" ? "bg-amber-950 text-amber-300 border-amber-900"
        : tone === "good" ? "bg-emerald-950 text-emerald-300 border-emerald-900"
          : "bg-stone-800 text-stone-300 border-stone-700";
  return <span className={`inline-block text-[11px] px-2 py-0.5 rounded border ${cls}`}>{text}</span>;
}

export function Section({ title, note, children, actions }: {
  title: string; note?: string; children: ReactNode; actions?: ReactNode;
}) {
  return (
    <section className="space-y-3" dir="rtl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-stone-100 text-sm font-medium">{title}</h2>
          {note && <p className="text-[11px] text-stone-500 mt-1 leading-6">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** جدول يمرّر أفقيًّا داخل حاويته — الصفحة نفسها لا تمرّر أفقيًّا أبدًا. */
export function ScrollBox({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto -mx-1 px-1">{children}</div>;
}
