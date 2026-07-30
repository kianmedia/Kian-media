"use client";
// ════════════════════════════════════════════════════════════════════════════
// FinAtoms — القطع المشتركة للمركز المالي. Mobile-first وRTL أصلًا.
//
// ثلاث قواعد مكتوبة في هذا الملفّ لأنّها تُخترق في الواجهة عادةً لا في القاعدة:
//   ١) «بانتظار تفعيل قاعدة البيانات» ≠ «لا تملك صلاحية» ≠ خطأ. ثلاث شاشات.
//   ٢) ★ الضريبة تُعرض دائمًا ★: MoneyCell تكتب الصافي والضريبة والإجمالي معًا،
//      ولا يوجد مكوّن يعرض الإجمالي وحده. إخفاء الضريبة في العرض هو أوّل خطوة
//      نحو رقم لا أحد يعرف كيف تكوّن.
//   ٣) الحجب يُقال صراحةً: حين لا يملك المستخدم بوّابة الربحية تظهر بطاقة
//      «محجوب» لا أصفار تبدو كحقيقة.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { finAmount, finMoneyParts, type FinRow, type FinState } from "@/lib/portal/financeOps";

export const card = "bg-stone-900 border border-stone-800 rounded-xl";

/** زرّ بمساحة لمس ≥44px — المركز يُستعمل من الجوّال أيضًا. */
export const tapBtn =
  "min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium transition-colors " +
  "disabled:opacity-40 disabled:cursor-not-allowed";
export const btnPrimary = `${tapBtn} bg-red-700 hover:bg-red-600 text-white`;
export const btnGhost = `${tapBtn} bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700`;
export const fieldCls =
  "w-full min-h-[44px] bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 " +
  "text-sm text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-stone-500";

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

/** الشاشة التي يراها المالك حين يُدفع الكود قبل تشغيل الـSQL. ليست خطأ. */
export function MigrationPending({ message }: { message: string }) {
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="status">
      <div className="text-2xl" aria-hidden>🗄️</div>
      <h3 className="text-stone-100 text-base font-medium">الميزة بانتظار تفعيل قاعدة البيانات</h3>
      <p className="text-sm text-stone-400 leading-7 max-w-md mx-auto">{message}</p>
      <p className="text-xs text-stone-500 leading-6 max-w-md mx-auto">
        شغّل الحزمة بالترتيب: PREFLIGHT ← RUNME ← POSTCHECK. هذه ليست مشكلة في حسابك
        ولا في صلاحياتك.
      </p>
    </div>
  );
}

export function Denied({ message }: { message: string }) {
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="alert">
      <div className="text-2xl" aria-hidden>🔒</div>
      <h3 className="text-stone-100 text-base font-medium">لا تملك صلاحية</h3>
      <p className="text-sm text-stone-400 leading-7 max-w-md mx-auto">{message}</p>
      <p className="text-xs text-stone-500 leading-6 max-w-md mx-auto">
        صلاحيات المركز المالي تُمنح بمفاتيح صريحة (finance_ops.*) أو بدور المالية،
        ولا تُشتقّ من صلاحية إدارة المشاريع.
      </p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="alert">
      <p className="text-sm text-red-300 leading-7">{message}</p>
      {onRetry && <button className={btnGhost} onClick={onRetry}>إعادة المحاولة</button>}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-stone-500">{message}</p>;
}

/** بطاقة «محجوب» — تُقال صراحةً بدل عرض أصفار تبدو كحقيقة. */
export function Masked({ title, message }: { title: string; message: string }) {
  return (
    <div className={`${card} p-5 text-center space-y-2`} role="note">
      <div className="text-xl" aria-hidden>🙈</div>
      <h3 className="text-stone-200 text-sm font-medium">{title}</h3>
      <p className="text-xs text-stone-500 leading-6 max-w-md mx-auto">{message}</p>
    </div>
  );
}

/** يعرض الحالة الثلاثية كما هي دون طمس الفروق بينها. */
export function StateView<T>({
  st, onRetry, children, emptyMsg,
}: {
  st: FinState<T> | null;
  onRetry?: () => void;
  children: (data: T) => ReactNode;
  emptyMsg?: string;
}) {
  if (st === null) return <Spinner />;
  if (st.state === "needs_migration") return <MigrationPending message={st.message} />;
  if (st.state === "denied") return <Denied message={st.message} />;
  if (st.state === "error") return <ErrorBox message={st.message} onRetry={onRetry} />;
  if (!st.data && emptyMsg) return <Empty message={emptyMsg} />;
  return <>{children(st.data)}</>;
}

/**
 * محمّل موحّد: تسلسل الطلبات (آخر طلب يفوز) + مهلة + حارس Unmount.
 * المهلة تمنع «دورانًا أبديًّا» يُقرأ كعطل بينما الشبكة وحدها هي المشكلة.
 */
export function useFinLoad<T>(
  fn: () => Promise<FinState<T>>,
  deps: unknown[],
  timeoutMs = 20000,
): { st: FinState<T> | null; reload: () => void } {
  const [st, setSt] = useState<FinState<T> | null>(null);
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
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error("fin_timeout")), timeoutMs);
        }),
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

// ─── عرض المال ─────────────────────────────────────────────────────────────

/**
 * ★ خليّة المال ★ — الصافي والضريبة والإجمالي، ثلاثتها ظاهرة دائمًا.
 * لا يوجد وضع «مختصر» يُخفي الضريبة: الاختصار هو كيف تختفي الضريبة من تقرير.
 */
export function MoneyCell({ row, label }: { row: FinRow | null | undefined; label?: string }) {
  const m = finMoneyParts(row);
  return (
    <div className="text-right leading-6" dir="rtl">
      {label && <div className="text-[11px] text-stone-500">{label}</div>}
      <div className="text-sm text-stone-100">{finAmount(m.gross, m.currency)}</div>
      <div className="text-[11px] text-stone-500">
        صافٍ {finAmount(m.net, m.currency)} · ضريبة {finAmount(m.vat, m.currency)}
      </div>
    </div>
  );
}

/** ثلاثة أسطر صريحة — يُستعمل في النماذج قبل الحفظ كي يرى المُدخِل ما سيُحفَظ. */
export function MoneyBreakdown({ net, vatRate, currency = "SAR" }: {
  net: number; vatRate: number; currency?: string;
}) {
  const safeNet = Number.isFinite(net) ? net : 0;
  const safeRate = Number.isFinite(vatRate) ? vatRate : 0;
  const vat = Math.round(safeNet * safeRate) / 100;
  return (
    <div className={`${card} p-3 text-xs text-stone-400 space-y-1`} dir="rtl">
      <div className="flex justify-between"><span>الصافي قبل الضريبة</span><span className="text-stone-200">{finAmount(safeNet, currency)}</span></div>
      <div className="flex justify-between"><span>الضريبة ({safeRate}٪)</span><span className="text-stone-200">{finAmount(vat, currency)}</span></div>
      <div className="flex justify-between border-t border-stone-800 pt-1">
        <span>الإجمالي</span><span className="text-stone-100">{finAmount(safeNet + vat, currency)}</span>
      </div>
      <p className="text-[10px] text-stone-600 leading-5">
        الإجمالي يُحسب في القاعدة كعمود مولَّد، ولا يُرسَل من هذه الشاشة إطلاقًا.
      </p>
    </div>
  );
}

export function Stat({ label, value, hint, tone = "normal" }: {
  label: string; value: string; hint?: string; tone?: "normal" | "warn" | "bad" | "good";
}) {
  const color =
    tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300"
      : tone === "good" ? "text-emerald-300" : "text-stone-100";
  return (
    <div className={`${card} p-3`}>
      <div className="text-[11px] text-stone-500 mb-1">{label}</div>
      <div className={`text-base font-medium ${color}`} dir="rtl">{value}</div>
      {hint && <div className="text-[10px] text-stone-600 mt-1 leading-5">{hint}</div>}
    </div>
  );
}

export function Chip({ text, tone = "neutral" }: { text: string; tone?: string }) {
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
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-stone-100 text-sm font-medium">{title}</h2>
          {note && <p className="text-[11px] text-stone-500 mt-1 leading-6 max-w-2xl">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** جدول يمرّر أفقيًّا على الجوّال بدل أن يكسر الصفحة. */
export function Scroller({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto -mx-1 px-1">{children}</div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] text-stone-400">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-stone-600 leading-5">{hint}</span>}
    </label>
  );
}

/** شريط نتيجة عمليّة — ينقل رسالة الخادم كما هي ولا يعيد صياغتها. */
export function Flash({ msg, tone }: { msg: string | null; tone: "ok" | "bad" }) {
  if (!msg) return null;
  return (
    <div
      role="status"
      className={`text-xs rounded-lg px-3 py-2 leading-6 ${
        tone === "ok" ? "bg-emerald-950 text-emerald-300" : "bg-red-950 text-red-300"
      }`}
    >
      {msg}
    </div>
  );
}
