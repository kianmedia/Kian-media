"use client";
// ════════════════════════════════════════════════════════════════════════════
// QuotingAtoms — القطع المشتركة لسطح التسعير. Mobile-first وRTL أصلًا.
//
// ثلاث قواعد مكتوبة هنا لأنّها تُخترق في الواجهة عادةً لا في القاعدة:
//
//   ١) «بانتظار تفعيل قاعدة البيانات» ≠ «لا تملك صلاحية» ≠ خطأ ≠ «لا بيانات».
//      أربع شاشات بأربع رسائل. طيّها في «لا توجد بيانات» يجعل الموظّف يظنّ
//      أنّه لا عروض لديه بينما القاعدة ترفضه أو الترحيلة لم تُطبَّق.
//
//   ٢) ★ Money لا تعرض صفرًا عن رقم لا تعرفه ★ — تستقبل `number | null`،
//      والـnull تُعرض نصًّا («لم يُعتمد سعر بعد»). سعرٌ لم يعتمده المالك ليس
//      «٠ ريال»: الفرق بينهما صفقة تُعرض على عميل بسعر خاطئ.
//
//   ٣) ★ الضريبة تُعرض حقلًا مستقلًّا دائمًا ★ — VatBreakdown تعرض الثلاثة:
//      الإجمالي قبل الضريبة، الضريبة، الإجمالي بعدها. لا طيّ ولا اختصار.
// ════════════════════════════════════════════════════════════════════════════
import type { ReactNode } from "react";
import { sar, pct, type SqState, type QuoteStatus, QUOTE_STATUS_AR, quoteStatusNoteAr } from "@/lib/portal/quoting";

export const card = "bg-stone-900 border border-stone-800 rounded-xl";

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

/** الشاشة قبل تشغيل الـSQL. ليست خطأً، وليست «لا عروض». */
export function MigrationPending({ message }: { message: string }) {
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="status" dir="rtl">
      <div className="text-2xl" aria-hidden>🗄️</div>
      <h3 className="text-stone-100 text-base font-medium">الميزة بانتظار تفعيل قاعدة البيانات</h3>
      <p className="text-sm text-stone-400 leading-7 max-w-md mx-auto">{message}</p>
      <p className="text-xs text-amber-300/80 leading-6 max-w-md mx-auto">
        لم يُعرض عليك رقم واحد لأنّ الأرقام غير متاحة بعد — لا لأنّها أصفار.
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
 * غلاف الحالة الرباعية. كلّ سطح في هذا الموديول يمرّ من هنا، فلا يمكن لشاشة
 * أن «تنسى» التمييز بين ترحيلة ناقصة ومنعِ صلاحية.
 */
export function StateView<T>({
  state, children, onRetry, emptyWhen, emptyMessage,
}: {
  state: SqState<T>;
  children: (data: T) => ReactNode;
  onRetry?: () => void;
  emptyWhen?: (data: T) => boolean;
  emptyMessage?: string;
}) {
  if (state.state === "needs_migration") return <MigrationPending message={state.message} />;
  if (state.state === "denied") return <Denied message={state.message} />;
  if (state.state === "error") return <ErrorBox message={state.message} onRetry={onRetry} />;
  if (emptyWhen && emptyWhen(state.data)) {
    return <Empty message={emptyMessage ?? "لا توجد بيانات ضمن صلاحيتك."} />;
  }
  return <>{children(state.data)}</>;
}

/**
 * ★ رقمٌ ماليّ ★ — `null` لا تصير صفرًا أبدًا. النصّ البديل يقول السبب
 * الحقيقيّ الذي يمرّره المستدعي («لم يُعتمد بعد» / «غير محدَّد»).
 */
export function Money({
  value, unknownText = "غير محدَّد", className = "", emphasis = false,
}: { value: number | null | undefined; unknownText?: string; className?: string; emphasis?: boolean }) {
  const known = value !== null && value !== undefined && !Number.isNaN(value);
  return (
    <span
      className={`${className} ${known ? (emphasis ? "text-stone-50 font-semibold" : "text-stone-200") : "text-stone-500 italic text-xs"}`}
      dir="ltr"
      style={{ unicodeBidi: "embed" }}
    >
      {known ? sar(value) : unknownText}
    </span>
  );
}

export function Pct({ value, unknownText = "—" }: { value: number | null | undefined; unknownText?: string }) {
  const known = value !== null && value !== undefined && !Number.isNaN(value);
  return (
    <span className={known ? "text-stone-200" : "text-stone-500 italic text-xs"} dir="ltr" style={{ unicodeBidi: "embed" }}>
      {known ? pct(value) : unknownText}
    </span>
  );
}

/**
 * ★ الضريبة حقل مستقلّ ★ ثلاثة أسطر دائمًا — لا يُطوى الوعاء الضريبيّ في
 * الإجمالي ولو ضاقت الشاشة.
 */
export function VatBreakdown({
  net, vatRate, vatAmount, total, netUnknownText = "لم يُحدَّد سعر بعد",
}: {
  net: number | null; vatRate: number | null; vatAmount: number | null;
  total: number | null; netUnknownText?: string;
}) {
  return (
    <dl className="text-sm space-y-2" dir="rtl">
      <div className="flex justify-between gap-3">
        <dt className="text-stone-400">الإجمالي قبل الضريبة</dt>
        <dd><Money value={net} unknownText={netUnknownText} /></dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt className="text-stone-400">
          ضريبة القيمة المضافة{vatRate !== null && vatRate !== undefined ? ` (${pct(vatRate)})` : ""}
        </dt>
        <dd><Money value={vatAmount} unknownText="—" /></dd>
      </div>
      <div className="flex justify-between gap-3 pt-2 border-t border-stone-800">
        <dt className="text-stone-200 font-medium">الإجمالي بعد الضريبة</dt>
        <dd><Money value={total} unknownText="—" emphasis /></dd>
      </div>
    </dl>
  );
}

const STATUS_TONE: Record<QuoteStatus, string> = {
  draft: "bg-stone-800 text-stone-300 border-stone-700",
  internal_review: "bg-sky-950 text-sky-300 border-sky-900",
  pending_owner_approval: "bg-amber-950 text-amber-300 border-amber-900",
  approved: "bg-emerald-950 text-emerald-300 border-emerald-900",
  sent_placeholder: "bg-indigo-950 text-indigo-300 border-indigo-900",
  accepted: "bg-emerald-900 text-emerald-200 border-emerald-800",
  rejected: "bg-red-950 text-red-300 border-red-900",
  expired: "bg-stone-950 text-stone-500 border-stone-800",
  superseded: "bg-stone-950 text-stone-500 border-stone-800",
};

/**
 * ★ الحالة sent_placeholder تُكتب «معتمد وجاهز للإرسال اليدوي» ★
 * ولا تُختصر إلى «أُرسل» ولو ضاق المكان: «أُرسل» تجعل الفريق يتوقّف عن
 * المتابعة على رسالة لم تغادر أبدًا.
 */
export function StatusPill({ status }: { status: QuoteStatus }) {
  return (
    <span
      className={`inline-block px-2.5 py-1 rounded-md text-[11px] border whitespace-nowrap ${STATUS_TONE[status] ?? STATUS_TONE.draft}`}
      title={quoteStatusNoteAr(status) || undefined}
      dir="rtl"
    >
      {QUOTE_STATUS_AR[status] ?? status}
    </span>
  );
}

/** لافتة أمانة التسليم — تظهر حيثما ظهرت الحالة sent_placeholder. */
export function ManualSendNotice() {
  return (
    <p className="text-xs text-indigo-300/80 leading-6 bg-indigo-950/40 border border-indigo-900/60 rounded-lg p-3" dir="rtl">
      لم يُرسل النظام أيّ رسالة. العرض معتمد وجاهز لترسله بنفسك إلى العميل، ولن تُسجَّل
      حالة «أُرسل» ما لم يُثبت مزوّدٌ تسليمًا فعليًّا.
    </p>
  );
}

export function SectionTitle({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-3" dir="rtl">
      <h3 className="text-sm font-medium text-stone-200">{children}</h3>
      {note && <p className="text-xs text-stone-500 mt-1 leading-6">{note}</p>}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div dir="rtl">
      <label className={labelCls}>{label}</label>
      {children}
      {hint && <p className="text-[11px] text-stone-500 mt-1 leading-5">{hint}</p>}
    </div>
  );
}
