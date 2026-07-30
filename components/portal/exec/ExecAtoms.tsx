"use client";
// ════════════════════════════════════════════════════════════════════════════
// ExecAtoms — القطع المشتركة للّوحة التنفيذية. Mobile-first، RTL/LTR، وثنائية
// اللغة بالكامل (كلّ نصّ يمرّ بـ t({ar,en})).
//
// ثلاث قواعد مكتوبة هنا لأنّها تُخترق في الواجهة عادةً لا في القاعدة:
//   ★ (١) بطاقة المؤشّر **لا تعرض رقمًا** إن لم تكن الحالة ok. تعرض شارة الحالة
//         وسببها. لا يوجد في هذا الملفّ `?? 0` ولا `|| 0` ولا أيّ استبدال آخر:
//         صفرٌ على الشاشة يعني صفرًا جاء من القاعدة، لا «موديول غير مطبَّق».
//   ★ (٢) «بانتظار تفعيل قاعدة البيانات» ≠ «لا تملك صلاحية» ≠ خطأ. ثلاث شاشات
//         مختلفة النصّ والأيقونة، ولا واحدة منها تُستعمل مكان الأخرى.
//   ★ (٣) لا رقم بلا طابع زمنيّ. شريط الطزاجة مثبَّت أعلى اللوحة، ويصبح تحذيرًا
//         أحمر متى صارت الأرقام قديمة.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import {
  type ExecDashboard, type ExecKpi, type ExecState, type Lang,
  freshnessLabel, isStale, kpiText, kpiWhyText, stampLabel,
} from "@/lib/portal/execReport";

export const card = "bg-stone-900 border border-stone-800 rounded-xl";

export const tapBtn =
  "min-h-[44px] px-4 py-2.5 rounded-lg text-sm font-medium transition-colors " +
  "disabled:opacity-40 disabled:cursor-not-allowed";
export const btnPrimary = `${tapBtn} bg-red-700 hover:bg-red-600 text-white`;
export const btnGhost = `${tapBtn} bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700`;
export const fieldCls =
  "w-full min-h-[44px] bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 " +
  "text-sm text-stone-100 focus:outline-none focus:border-stone-500";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="py-10 text-center">
      <div
        className="inline-block w-5 h-5 border-2 border-stone-600 border-t-transparent rounded-full animate-spin"
        aria-label={label ?? "loading"}
      />
    </div>
  );
}

/** الشاشة التي يراها المالك حين يُدفع الكود قبل تشغيل الـSQL. ليست خطأ. */
export function MigrationPending({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="status">
      <div className="text-2xl" aria-hidden>🗄️</div>
      <h3 className="text-stone-100 text-base font-medium">
        {t({ ar: "الميزة بانتظار تفعيل قاعدة البيانات", en: "Waiting for its database migration" })}
      </h3>
      <p className="text-sm text-stone-400 leading-7 max-w-md mx-auto">{message}</p>
      <p className="text-xs text-stone-500 leading-6 max-w-md mx-auto">
        {t({
          ar: "شغّل الحزمة بالترتيب: PREFLIGHT ← RUNME ← POSTCHECK. هذه ليست مشكلة في حسابك ولا في صلاحياتك.",
          en: "Run the package in order: PREFLIGHT → RUNME → POSTCHECK. Nothing is wrong with your account or permissions.",
        })}
      </p>
    </div>
  );
}

export function Denied({ message }: { message: string }) {
  const { t } = useI18n();
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="alert">
      <div className="text-2xl" aria-hidden>🔒</div>
      <h3 className="text-stone-100 text-base font-medium">
        {t({ ar: "لا تملك صلاحية", en: "You do not have permission" })}
      </h3>
      <p className="text-sm text-stone-400 leading-7 max-w-md mx-auto">{message}</p>
      <p className="text-xs text-stone-500 leading-6 max-w-md mx-auto">
        {t({
          ar: "اللوحة تُفتح بمفتاح exec_report.view، والمؤشّرات المالية والهوامش مقصورة على المالك ولا تُمنَح بمفتاح إطلاقًا.",
          en: "The dashboard opens with exec_report.view. Financial KPIs and margins are owner-only and are never grantable by key.",
        })}
      </p>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className={`${card} p-5 text-center space-y-3`} role="alert">
      <p className="text-sm text-red-300 leading-7">{message}</p>
      {onRetry && (
        <button className={btnGhost} onClick={onRetry}>
          {t({ ar: "إعادة المحاولة", en: "Try again" })}
        </button>
      )}
    </div>
  );
}

export function Empty({ message }: { message: string }) {
  return <p className="py-8 text-center text-sm text-stone-500">{message}</p>;
}

/** يعرض الحالة الرباعية كما هي دون طمس الفروق بينها. */
export function StateView<T>({
  st, onRetry, children,
}: {
  st: ExecState<T> | null;
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
export function useExecLoad<T>(
  fn: () => Promise<ExecState<T>>,
  deps: unknown[],
  timeoutMs = 25000,
): { st: ExecState<T> | null; reload: () => void; busy: boolean } {
  const [st, setSt] = useState<ExecState<T> | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const load = useCallback(async () => {
    const my = ++seq.current;
    setBusy(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        fn(),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error("exec_timeout")), timeoutMs);
        }),
      ]);
      if (!mounted.current || my !== seq.current) return;
      setSt(r);
    } catch {
      if (!mounted.current || my !== seq.current) return;
      setSt({
        state: "error",
        message: "تأخّر الطلب أكثر من المتوقّع. تحقّق من الشبكة وأعد المحاولة. / The request took too long.",
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (mounted.current && my === seq.current) setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { st, reload: () => { void load(); }, busy };
}

// ─── شارات الحالة ──────────────────────────────────────────────────────────

const STATE_STYLE: Record<string, string> = {
  ok: "bg-emerald-950 text-emerald-300 border-emerald-900",
  unavailable: "bg-stone-800 text-stone-300 border-stone-700",
  restricted: "bg-amber-950 text-amber-300 border-amber-900",
  no_basis: "bg-sky-950 text-sky-300 border-sky-900",
  filtered_out: "bg-stone-900 text-stone-500 border-stone-800",
  error: "bg-red-950 text-red-300 border-red-900",
};

const STATE_TEXT: Record<string, { ar: string; en: string }> = {
  ok: { ar: "رقم حقيقيّ", en: "Live figure" },
  unavailable: { ar: "غير متاح — الموديول غير مطبَّق", en: "Unavailable — module not installed" },
  restricted: { ar: "محجوب", en: "Withheld" },
  no_basis: { ar: "لا أساس للحساب", en: "No basis" },
  filtered_out: { ar: "خارج المرشّح", en: "Filtered out" },
  error: { ar: "خطأ", en: "Error" },
};

export function StateBadge({ state }: { state: string }) {
  const { t } = useI18n();
  const s = STATE_TEXT[state] ?? { ar: state, en: state };
  return (
    <span className={`inline-block text-[10px] px-2 py-0.5 rounded border ${STATE_STYLE[state] ?? STATE_STYLE.error}`}>
      {t(s)}
    </span>
  );
}

// ─── بطاقة المؤشّر ─────────────────────────────────────────────────────────

/**
 * ★ البطاقة التي يقوم عليها كلّ العقد ★
 * حين لا تكون الحالة ok لا يُطبع رقم إطلاقًا: تُطبع شارة الحالة ونصّ السبب.
 * هذا هو الفرق بين لوحة تقول «لا نعرف» وأخرى تقول «صفر» فتُقرأ «لا مشاكل».
 */
export function KpiCard({
  kpi, title, currency = "SAR", onOpen,
}: {
  kpi: ExecKpi;
  title: string;
  currency?: string;
  onOpen?: () => void;
}) {
  const { t, lang } = useI18n();
  const L = lang as Lang;
  const ok = kpi.state === "ok";
  const why = kpiWhyText(kpi, L);
  const lower = (kpi.detail as { is_lower_bound?: boolean })?.is_lower_bound === true;
  const scopeNote =
    kpi.date_scope === "filtered" ? null
    : t({
        ar: "الحالة الراهنة — لا يتأثّر بمرشّح التاريخ",
        en: "Current state — not affected by the date filter",
      });

  return (
    <div className={`${card} p-4 flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] text-stone-500 leading-5">{title}</div>
        {kpi.sensitive && (
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-amber-900 bg-amber-950 text-amber-300 shrink-0">
            {t({ ar: "المالك فقط", en: "Owner only" })}
          </span>
        )}
      </div>

      {ok ? (
        <div className="text-2xl font-medium text-stone-100 leading-none" dir="auto">
          {kpiText(kpi, L, currency)}
        </div>
      ) : (
        <div className="pt-1">
          <StateBadge state={kpi.state} />
        </div>
      )}

      {ok && lower && (
        <p className="text-[10px] text-amber-400 leading-5">
          {t({
            ar: "حدّ أدنى: المصدر قصّ النتائج، والعدد الحقيقيّ قد يكون أكبر.",
            en: "Lower bound: the source truncated its results; the real count may be higher.",
          })}
        </p>
      )}
      {!ok && why && <p className="text-[11px] text-stone-400 leading-6">{why}</p>}
      {ok && scopeNote && <p className="text-[10px] text-stone-600 leading-5">{scopeNote}</p>}

      {onOpen && ok && (
        <button className="text-[11px] text-stone-400 hover:text-stone-200 text-start" onClick={onOpen}>
          {t({ ar: "التفاصيل", en: "Details" })}
        </button>
      )}
    </div>
  );
}

// ─── شريط الطزاجة ──────────────────────────────────────────────────────────

/**
 * ★ لا رقم بلا طابع ★ — يُعرض الطابع النسبيّ والمطلق معًا. حين تصير الأرقام
 * قديمة يتحوّل الشريط إلى تحذير أحمر صريح بدل شارة رمادية تُتجاهَل.
 */
export function FreshnessBar({
  d, busy, onRefresh,
}: {
  d: ExecDashboard | null;
  busy?: boolean;
  onRefresh?: () => void;
}) {
  const { t, lang } = useI18n();
  const L = lang as Lang;
  const stale = isStale(d);
  return (
    <div
      className={`${card} p-3 flex flex-wrap items-center gap-x-4 gap-y-2 justify-between ${
        stale ? "border-red-900 bg-red-950/30" : ""
      }`}
      role="status"
    >
      <div className="min-w-0">
        <div className={`text-xs ${stale ? "text-red-300" : "text-stone-300"}`}>
          {stale
            ? t({ ar: "⚠️ أرقام قديمة — لا تُقرأ على أنّها حيّة", en: "⚠️ Stale numbers — do not read them as live" })
            : t({ ar: "أرقام محدَّثة", en: "Numbers are current" })}
          {" · "}
          {freshnessLabel(d, L)}
        </div>
        <div className="text-[10px] text-stone-500 mt-0.5" dir="ltr">
          {t({ ar: "وقت الحساب: ", en: "Computed at: " })}{stampLabel(d, L)}
          {d?.from_cache ? t({ ar: " · من الذاكرة المؤقّتة", en: " · from cache" }) : ""}
        </div>
        {d?.is_stale && (d.stale_message_ar || d.stale_message_en) && (
          <div className="text-[11px] text-red-300 mt-1 leading-6">
            {L === "ar" ? d.stale_message_ar : d.stale_message_en}
          </div>
        )}
      </div>
      {onRefresh && (
        <button className={btnGhost} onClick={onRefresh} disabled={busy}>
          {busy ? t({ ar: "جارٍ التحديث…", en: "Refreshing…" }) : t({ ar: "تحديث الآن", en: "Refresh now" })}
        </button>
      )}
    </div>
  );
}

export function SectionTitle({ children, note }: { children: ReactNode; note?: string }) {
  return (
    <div className="mb-3">
      <h2 className="text-sm font-medium text-stone-200">{children}</h2>
      {note && <p className="text-[11px] text-stone-500 mt-1 leading-6">{note}</p>}
    </div>
  );
}
