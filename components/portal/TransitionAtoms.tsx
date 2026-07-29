"use client";
// ════════════════════════════════════════════════════════════════════════════
// TransitionAtoms — ذرّات العرض المشتركة بين شاشتَي «طلب انتقال» و«طلبات
// الانتقال». RTL أصلًا (لا اتجاه مثبَّت) وتعمل على الجوال (flex-wrap ومقاسات
// صغيرة). لا تجلب بيانات ولا تتّخذ قرار صلاحية.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePortal } from "@/components/portal/PortalShell";
import type { Caps as RoleCaps } from "@/lib/portal/roles";
import {
  trCapabilities, trList, trResetCapabilities, trCanDecide, trCanRequest,
  type TrCapabilities, type TrRequest,
} from "@/lib/portal/transitions";

export const trCard = "bg-stone-900 border border-stone-800 rounded-xl";

// ─────────────────────────────────────────────────────────────────────────────
// خطّافات مشتركة
// ─────────────────────────────────────────────────────────────────────────────

/**
 * أدوار المستخدم كما يراها الغلاف. **يفشل مغلقًا**: خارج PortalShell تعود null،
 * فلا يُعرض مسار الطلب ولا زرّ الاعتماد — ولا يُفتح شيء بالخطأ. القرار الحقيقيّ
 * للخادم في الحالتين.
 */
export function useTrRoleCaps(): RoleCaps | null {
  // useContext يُنفَّذ دائمًا داخل usePortal قبل رمي الاستثناء، فترتيب الخطّافات ثابت.
  try { return usePortal().caps; } catch { return null; }
}

export interface TrRequestsState {
  role: RoleCaps | null;
  caps: TrCapabilities | null;
  rows: TrRequest[];
  loading: boolean;
  /** خطأ قراءة القائمة (لا يشمل «غير مفعَّل» — ذاك في caps). */
  error: string | null;
  /**
   * هل يوجد طلب معلَّق مطابق؟ حارس واجهة؛ الحارس القاطع فهرس فريد جزئيّ في
   * قاعدة البيانات على (المشروع، المخرج، النوع، **القيمة المطلوبة**). لذلك
   * تمرير toValue يطابق مفتاح الفهرس تمامًا، وتركُه يعني «أيّ طلب من هذا النوع».
   */
  pending: (kind: string, deliverableId: string | null, toValue?: string | null) => boolean;
  reload: () => void;
  /** إعادة فحص وجود الحزمة (بعد تطبيق الـSQL بلا إعادة تحميل الصفحة). */
  recheck: () => void;
}

/** أقصى عدد مشاريع تُقرأ طلباتها دفعةً — سقف تشغيليّ لا حدّ أمنيّ. */
const TR_MAX_PROJECTS = 20;

/**
 * حالة «طلبات الانتقال»: القدرات + الصفوف + حارس التكرار.
 * لا تُستدعى أبدًا لمن لا شأن له بالمسار (عميل/مشاهدة فقط) — فلا طلب زائد.
 *
 * تقبل **مشروعًا أو عدّة**: دالّة القائمة على الخادم تُصفّي بـproject_id تمامًا،
 * وطلب مخرَجٍ يُسجَّل على مشروع المخرج نفسه (المرحلة) لا على المشروع الرئيسيّ —
 * فقراءة الرئيسيّ وحده كانت ستُسقط طلبات المراحل من الشارات.
 *
 * وما يُقرأ هنا **استرشاديّ**: المنع القاطع للتكرار فهرس فريد في القاعدة، ودالّة
 * الإنشاء تعيد duplicate=true بدل صفّ ثانٍ. لذلك سقف المشاريع أعلاه لا يفتح شيئًا.
 */
export function useTransitionRequests(project: string | string[], enabled = true): TrRequestsState {
  const role = useTrRoleCaps();
  const active = enabled === true && (trCanRequest(role) === true || trCanDecide(role) === true);
  const idsKey = (Array.isArray(project) ? project : [project])
    .filter((x): x is string => typeof x === "string" && x !== "")
    .filter((x, i, a) => a.indexOf(x) === i)
    .slice(0, TR_MAX_PROJECTS)
    .sort()
    .join(",");
  const [caps, setCaps] = useState<TrCapabilities | null>(null);
  const [rows, setRows] = useState<TrRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    if (!active || idsKey === "") { setCaps(null); setRows([]); return; }
    let mine = true;
    setLoading(true); setError(null);
    void (async () => {
      const c = await trCapabilities();
      if (!mine || !alive.current) return;
      setCaps(c);
      if (!c.table || !c.listRpc) { setRows([]); setLoading(false); return; }
      const ids = idsKey.split(",");
      const results = await Promise.all(ids.map((id) => trList(id, "all", 200)));
      if (!mine || !alive.current) return;
      setLoading(false);
      const failed = results.find((r) => !r.ok);
      const merged = new Map<string, TrRequest>();
      for (const r of results) if (r.ok) for (const row of r.data) merged.set(row.id, row);
      // فشل مشروع واحد لا يُخفي طلبات البقية، ولا يُبتلع: يُذكر ويُعرض ما وصل.
      if (failed && !failed.ok) setError(failed.error);
      setRows(Array.from(merged.values()).sort((a, b) => String(b.requested_at ?? "").localeCompare(String(a.requested_at ?? ""))));
    })();
    return () => { mine = false; };
  }, [idsKey, active, tick]);

  const pending = useCallback((kind: string, deliverableId: string | null, toValue?: string | null): boolean => {
    for (const r of rows) {
      if (r.status !== "pending") continue;
      if (r.kind !== kind) continue;
      if ((r.deliverable_id ?? null) !== (deliverableId ?? null)) continue;
      // مفتاح الفهرس الفريد يشمل to_value: منعُ ما لا تمنعه القاعدة يحجب عملًا مشروعًا.
      if (toValue !== undefined && (r.to_value ?? null) !== (toValue ?? null)) continue;
      return true;
    }
    return false;
  }, [rows]);

  const reload = useCallback(() => setTick((x) => x + 1), []);
  const recheck = useCallback(() => { trResetCapabilities(); setTick((x) => x + 1); }, []);

  return { role, caps, rows, loading, error, pending, reload, recheck };
}

export function TrNotice({ kind, children }: { kind: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls =
    kind === "error" ? "border-red-900 bg-red-950/40 text-red-200"
    : kind === "warn" ? "border-amber-900 bg-amber-950/30 text-amber-200"
    : kind === "ok" ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
    : "border-sky-900 bg-sky-950/30 text-sky-200";
  return <div className={`text-[11px] leading-relaxed rounded-lg border px-3 py-2 ${cls}`}>{children}</div>;
}

/**
 * حالة «غير متاح» الصريحة. تُعرض بدل الانهيار أو الشاشة الفارغة حين لا تكون
 * حزمة قاعدة البيانات مطبَّقة بعد — أو حين يكون السبب صلاحيةً أو شبكة، وحينها
 * **لا يُقال إن الترحيلة ناقصة** (النصّ يأتي جاهزًا من trUnavailableAr).
 */
export function TrUnavailable({ message, onRecheck, busy }: { message: string; onRecheck?: () => void; busy?: boolean }) {
  return (
    <div className={`${trCard} p-3 space-y-2`}>
      <TrNotice kind="warn">{message}</TrNotice>
      {onRecheck && (
        <button type="button" onClick={onRecheck} disabled={busy === true}
          className="rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-[11px] px-3 py-1.5 disabled:opacity-50">
          {busy === true ? "جارٍ إعادة الفحص…" : "إعادة الفحص"}
        </button>
      )}
    </div>
  );
}

/** بند «قبل ← بعد». على الجوال يلتفّ إلى سطرين بدل أن يُقصّ. */
export function TrBeforeAfter({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950 p-2">
      <div className="text-[10px] text-stone-500 mb-1">{label}</div>
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="rounded px-2 py-0.5 bg-stone-800 border border-stone-700 text-stone-300 line-through decoration-stone-600">
          {before}
        </span>
        <span className="text-stone-500" aria-hidden="true">←</span>
        <span className="rounded px-2 py-0.5 bg-emerald-950/40 border border-emerald-900 text-emerald-200 font-medium">
          {after}
        </span>
      </div>
    </div>
  );
}

export function TrField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-stone-500 mb-0.5">{label}</div>
      <div className="text-[11px] text-stone-200 break-words">{children}</div>
    </div>
  );
}

export function TrBadge({ text, tone }: { text: string; tone: "info" | "ok" | "error" | "warn" }) {
  const cls =
    tone === "ok" ? "bg-emerald-950/40 border-emerald-900 text-emerald-200"
    : tone === "error" ? "bg-red-950/40 border-red-900 text-red-200"
    : tone === "warn" ? "bg-amber-950/30 border-amber-900 text-amber-200"
    : "bg-sky-950/30 border-sky-900 text-sky-200";
  return <span className={`inline-block rounded border px-1.5 py-0.5 text-[10px] ${cls}`}>{text}</span>;
}

/** غلاف نافذة مركزية يعمل على الجوال (يملأ العرض ويمرّر عموديًّا). */
export function TrModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-stone-900 border border-stone-800 rounded-t-2xl sm:rounded-2xl p-3 sm:p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-stone-100">{title}</h3>
          <button type="button" onClick={onClose} aria-label="إغلاق"
            className="text-stone-400 hover:text-white text-xs px-2 py-1">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
