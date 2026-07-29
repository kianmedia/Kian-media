"use client";
// ════════════════════════════════════════════════════════════════════════════
// LargeProjectAtoms — ذرّات عرض مشتركة بين شاشات المشاريع الكبيرة.
// كلّها RTL أصلًا (لا اتجاه مثبَّت داخلها) وتعمل على الجوال (flex-wrap + مقاسات
// صغيرة). لا تجلب بيانات ولا تعرف مشروعًا بعينه.
// ════════════════════════════════════════════════════════════════════════════
import { memo, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";
import {
  LP_STATUS_LABELS, LP_STATUS_COLOR, LP_SCHEDULE_LABELS, LP_PRIORITY_LABELS,
  lpIsAwaitingSchedule, lpIsOverdue, lpTodayISO, type LpDeliverable, type LpProgress,
} from "@/lib/portal/large-projects";

export const lpCard = "bg-stone-900 border border-stone-800 rounded-xl";

export function LpSection({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className={`${lpCard} p-3 sm:p-4`}>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <h3 className="text-xs sm:text-sm font-semibold text-stone-100">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function LpNotice({ kind, children }: { kind: "info" | "warn" | "error" | "ok"; children: ReactNode }) {
  const cls =
    kind === "error" ? "border-red-900 bg-red-950/40 text-red-200"
    : kind === "warn" ? "border-amber-900 bg-amber-950/30 text-amber-200"
    : kind === "ok" ? "border-emerald-900 bg-emerald-950/30 text-emerald-200"
    : "border-sky-900 bg-sky-950/30 text-sky-200";
  return <div className={`text-[11px] leading-relaxed rounded-lg border px-3 py-2 ${cls}`}>{children}</div>;
}

/** بطاقة رقم. `onClick` يجعلها فلترًا بنقرة واحدة. */
export const LpKpi = memo(function LpKpi({
  label, value, tone, active, onClick, hint,
}: {
  label: string; value: number | string; tone?: "neutral" | "danger" | "info" | "ok" | "warn";
  active?: boolean; onClick?: () => void; hint?: string;
}) {
  const color =
    tone === "danger" ? "text-red-300" : tone === "ok" ? "text-emerald-300"
    : tone === "info" ? "text-sky-300" : tone === "warn" ? "text-amber-300" : "text-stone-100";
  const body = (
    <>
      <div className={`text-base sm:text-lg font-semibold ${color}`} dir="ltr">{value}</div>
      <div className="text-[10px] sm:text-[11px] text-stone-400 leading-tight">{label}</div>
      {hint && <div className="text-[9px] text-stone-600 leading-tight mt-0.5">{hint}</div>}
    </>
  );
  const base = `rounded-lg border p-2 text-center min-w-0 ${active ? "border-sky-700 bg-stone-800" : "border-stone-800 bg-stone-950"}`;
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button type="button" onClick={onClick} aria-pressed={!!active} className={`${base} hover:border-stone-600 w-full`}>
      {body}
    </button>
  );
});

/** شريط التقدّم. null ⇒ «غير متاح» نصًّا — لا شريط صفريّ مضلِّل. */
export function LpProgressBar({ progress, compact }: { progress: LpProgress; compact?: boolean }) {
  const { t } = useI18n();
  if (progress.pct == null) {
    return <span className="text-[10px] text-stone-500">{t({ ar: "غير متاح — لا مخرجات محتسَبة", en: "N/A — nothing countable" })}</span>;
  }
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className={`${compact ? "w-16" : "w-full max-w-[220px]"} h-1.5 bg-stone-800 rounded overflow-hidden`}>
        <div className="h-full bg-red-600" style={{ width: `${Math.max(0, Math.min(100, progress.pct))}%` }} />
      </div>
      <span className="text-[11px] text-stone-300 shrink-0" dir="ltr">{progress.pct}%</span>
      {progress.frozen && <span className="text-[9px] text-stone-500 shrink-0">{t({ ar: "مُجمَّد عند الإغلاق", en: "frozen at closure" })}</span>}
      {progress.estimated && !progress.frozen && <span className="text-[9px] text-amber-400/80 shrink-0">{t({ ar: "تقديريّ", en: "estimated" })}</span>}
    </div>
  );
}

export const DeliverableStatusBadge = memo(function DeliverableStatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  const lbl = LP_STATUS_LABELS[status];
  const color = LP_STATUS_COLOR[status] ?? "#78716c";
  return (
    <span className="text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap"
      style={{ background: `${color}22`, color }}>
      {lbl ? t(lbl) : status}
    </span>
  );
});

/**
 * شارة الجدولة. «بانتظار الجدولة» بلون معلوماتيّ (سماويّ) — **لا أحمر أبدًا**:
 * غياب التاريخ وضع مشروع مشروع، وليس خطأً ولا تأخّرًا.
 */
export const DeliverableScheduleBadge = memo(function DeliverableScheduleBadge({
  d, today,
}: { d: Partial<LpDeliverable>; today?: string }) {
  const { t } = useI18n();
  const iso = today ?? lpTodayISO();
  if (lpIsAwaitingSchedule(d)) {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap bg-sky-500/10 text-sky-300 border border-sky-900/60">
        {t(LP_SCHEDULE_LABELS.awaiting_schedule)}
      </span>
    );
  }
  const late = lpIsOverdue(d, iso);
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${late ? "bg-red-500/10 text-red-300 border border-red-900/60" : "bg-stone-800 text-stone-300"}`}>
      <span dir="ltr">{String(d.due_date ?? d.planned_start_date ?? "").slice(0, 10)}</span>
      {late && <span className="ms-1">{t({ ar: "متأخّر", en: "overdue" })}</span>}
    </span>
  );
});

export const DeliverablePriorityBadge = memo(function DeliverablePriorityBadge({ priority }: { priority?: string | null }) {
  const { t } = useI18n();
  if (!priority) return null;
  const lbl = LP_PRIORITY_LABELS[priority];
  const cls = priority === "urgent" ? "text-red-300 bg-red-500/10"
    : priority === "high" ? "text-amber-300 bg-amber-500/10"
    : priority === "low" ? "text-stone-400 bg-stone-800" : "text-stone-300 bg-stone-800";
  return <span className={`text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap ${cls}`}>{lbl ? t(lbl) : priority}</span>;
});

/** فتات الخبز — يُبقي أثر العلاقة الأصلية ظاهرًا في كلّ شاشة. */
export function LargeProjectBreadcrumbs({
  items, onSelect,
}: { items: { id: string; label: string }[]; onSelect?: (id: string) => void }) {
  return (
    <nav className="flex items-center gap-1 flex-wrap text-[11px] text-stone-400 min-w-0" aria-label="breadcrumbs">
      {items.map((it, i) => (
        <span key={it.id} className="flex items-center gap-1 min-w-0">
          {i > 0 && <span className="text-stone-700" aria-hidden="true">/</span>}
          {onSelect && i < items.length - 1 ? (
            <button type="button" onClick={() => onSelect(it.id)} className="truncate max-w-[140px] sm:max-w-[220px] hover:text-sky-300" dir="auto">{it.label}</button>
          ) : (
            <span className={`truncate max-w-[140px] sm:max-w-[220px] ${i === items.length - 1 ? "text-stone-200" : ""}`} dir="auto">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
