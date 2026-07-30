"use client";
// ════════════════════════════════════════════════════════════════════════════
// CrmAtoms — القطع المشتركة لوحدة المبيعات. Mobile-first وRTL أصلًا.
//
// كلّ حالة غير عادية لها شكل صريح هنا: «بانتظار تفعيل قاعدة البيانات» ليست
// «لا تملك صلاحية»، وليست شاشة فارغة. خلطهما سبق أن أرسل المالك يبحث عن
// ترحيلة ناقصة بينما كانت المشكلة صلاحية، والعكس.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { type CrmState } from "@/lib/portal/crm";

export const card = "bg-stone-900 border border-stone-800 rounded-xl";

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

/** الشاشة التي يراها المالك حين يُنشر الكود قبل تشغيل الـSQL. ليست خطأ. */
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
      <p className="text-xs text-stone-500 leading-6">
        صلاحيات المبيعات تُمنح بمفاتيح صريحة (crm.view · crm.manage) من شاشة الصلاحيات.
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

/** يعرض الحالة الثلاثية كما هي دون طمس الفروق بينها. */
export function StateView<T>({
  st, onRetry, children, emptyMsg,
}: {
  st: CrmState<T> | null;
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
 * المهلة تمنع «دوران أبديّ» حين يتأخّر الخادم بلا ردّ.
 */
export function useCrmLoad<T>(
  fn: () => Promise<CrmState<T>>,
  deps: unknown[],
  timeoutMs = 20000,
): { st: CrmState<T> | null; reload: () => void } {
  const [st, setSt] = useState<CrmState<T> | null>(null);
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
          timer = setTimeout(() => rej(new Error("crm_timeout")), timeoutMs);
        }),
      ]);
      if (!mounted.current || my !== seq.current) return;
      setSt(r);
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      setSt({
        state: "error",
        message: e instanceof Error && e.message === "crm_timeout"
          ? "انتهت المهلة — الشبكة بطيئة أو الخادم لا يستجيب."
          : "تعذّر تنفيذ الطلب.",
      });
    } finally { if (timer) clearTimeout(timer); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { st, reload: load };
}

export function Chip({ children, tone = "neutral" }: {
  children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const c =
    tone === "good" ? "bg-emerald-950/60 text-emerald-300 border-emerald-900"
    : tone === "warn" ? "bg-amber-950/60 text-amber-300 border-amber-900"
    : tone === "bad" ? "bg-red-950/60 text-red-300 border-red-900"
    : "bg-stone-800 text-stone-300 border-stone-700";
  return <span className={`inline-block px-2 py-0.5 rounded-md border text-[11px] ${c}`}>{children}</span>;
}

export function Counter({
  label, value, tone = "neutral", active, onClick, hint,
}: {
  label: string; value: number | string;
  tone?: "neutral" | "good" | "warn" | "bad";
  active?: boolean; onClick?: () => void; hint?: string;
}) {
  const ring = active ? "ring-2 ring-red-700" : "";
  const col =
    tone === "good" ? "text-emerald-300" : tone === "warn" ? "text-amber-300"
    : tone === "bad" ? "text-red-300" : "text-stone-100";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      title={hint}
      className={`${card} ${ring} p-3 text-center min-h-[72px] w-full transition-colors ${onClick ? "hover:border-stone-700" : "cursor-default"}`}
    >
      <div className={`text-lg font-semibold tabular-nums ${col}`}>{value}</div>
      <div className="text-[11px] text-stone-400 mt-1 leading-4">{label}</div>
    </button>
  );
}

/** شريط نسبة — القيمة تأتي من الخادم ولا تُحسب هنا كي لا تنحرف. */
export function Bar({ score, good = 90, warn = 60 }: { score: number; good?: number; warn?: number }) {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  const bg = s >= good ? "bg-emerald-600" : s >= warn ? "bg-amber-600" : "bg-red-700";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-stone-800 overflow-hidden">
        <div className={`h-full ${bg}`} style={{ width: `${s}%` }} />
      </div>
      <span className="text-xs text-stone-400 tabular-nums">{s}%</span>
    </div>
  );
}

export function Section({
  title, action, children, defaultOpen = false, count,
}: {
  title: string; action?: ReactNode; children: ReactNode;
  defaultOpen?: boolean; count?: number;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          className="flex-1 text-right min-h-[44px] flex items-center gap-2"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="text-stone-500 text-xs">{open ? "▾" : "◂"}</span>
          <span className="text-sm text-stone-100">{title}</span>
          {typeof count === "number" && <Chip>{count}</Chip>}
        </button>
        {open && action}
      </div>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

/** رسالة عابرة موحّدة — النجاح والفشل بنفس الوضوح. */
export function Flash({ text, tone }: { text: string; tone: "ok" | "bad" }) {
  if (!text) return null;
  return (
    <p
      role="status"
      className={`text-sm rounded-lg px-3 py-2 leading-6 ${
        tone === "ok" ? "bg-emerald-950/50 text-emerald-300" : "bg-red-950/50 text-red-300"
      }`}
    >
      {text}
    </p>
  );
}

/** حقل مُسمّى — التسمية مربوطة بالحقل فعليًّا لا بصريًّا فقط. */
export function Field({
  label, children, hint,
}: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-stone-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-stone-500 leading-5">{hint}</span>}
    </label>
  );
}

/** جدول يمرّ أفقيًّا داخل حاويته — الصفحة نفسها لا تمرّ أفقيًّا أبدًا. */
export function Scroller({ children }: { children: ReactNode }) {
  return <div className="overflow-x-auto -mx-4 px-4">{children}</div>;
}

/** ملاحظة عقد ثابتة: تُعرض حيث يظنّ المستخدم أنّ شيئًا سيُنشأ تلقائيًّا. */
export function ContractNote({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] text-stone-500 leading-6 border-r-2 border-stone-700 pr-3">
      {children}
    </p>
  );
}
