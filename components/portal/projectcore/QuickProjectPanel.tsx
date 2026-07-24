"use client";
// ════════════════════════════════════════════════════════════════════════════
// QuickProjectPanel — Batch 8C. لوحة المشروع الصغير: كل ما فيها **مشتقّ** من
// project_quick_snapshot (مهام/جلسات/مخرجات/مراجعات/جاهزية إغلاق). لا تخزين
// لقائمة الإنجاز ولا للإجراء التالي، ولا عمود Boolean واحد.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { PC_STAGE_LABELS, HEALTH_LABELS, type PcStage, type PcHealth } from "@/lib/portal/projectCore";
import {
  projectQuickSnapshot, projectSetOperatingExperience, NEXT_ACTION_META, quickTypeLabel, fastlaneErr,
  type QuickSnapshot,
} from "@/lib/portal/fastlane";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const HEALTH_CLR: Record<string, string> = { on_track: "#16a34a", at_risk: "#d97706", off_track: "#dc2626" };

export default function QuickProjectPanel({ projectId, canManage, onGoTab, onOpenLifecycle, onSwitchedToStandard, flash }: {
  projectId: string; canManage: boolean;
  onGoTab: (tab: string) => void;
  /** «انقل المرحلة إلى مُسلَّم» لا يتمّ من أيّ تبويب — وجهته شريط دورة الحياة. */
  onOpenLifecycle: () => void;
  onSwitchedToStandard: () => void;
  flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const [snap, setSnap] = useState<QuickSnapshot | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        projectQuickSnapshot(projectId),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("quick_timeout")), 20000); }),
      ]);
      if (!mounted.current || my !== seq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[quick]", r.error); setErr(fastlaneErr(r.error)); setPhase("error"); return; }
      setSnap(r.data); setPhase("ready");
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      setErr(e instanceof Error && e.message === "quick_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : fastlaneErr(String(e)));
      setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [projectId, t]);
  useEffect(() => { void load(); }, [load]);

  async function switchToStandard() {
    if (busy) return;
    setBusy(true);
    const r = await projectSetOperatingExperience(projectId, "standard");
    setBusy(false);
    if (!r.ok) { flash(fastlaneErr(r.error)); return; }
    flash(t({ ar: "تم التحويل إلى الإدارة القياسية — لم تتغيّر أيّ بيانات.", en: "Switched to standard — no data changed." }));
    onSwitchedToStandard();
  }

  if (phase === "loading") return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-2" role="alert">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!snap) return null;

  // خادم أحدث قد يعيد إجراءً لا تعرفه هذه النسخة — لا نُسقط اللوحة كلّها بسببه.
  const next = NEXT_ACTION_META[snap.next_action] ?? NEXT_ACTION_META.none;
  const done = snap.checklist.filter((c) => c.done === true).length;
  const known = snap.checklist.filter((c) => c.done !== null).length;

  return (
    <div className="space-y-3">
      {/* الإجراء التالي أوّلًا (الجوال قبل كل شيء) */}
      <section className={`${card} p-3 border-red-900/50`}>
        <p className="text-[10px] text-stone-500 mb-1">{t({ ar: "الإجراء التالي", en: "Next action" })}</p>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-sm text-stone-100">{next.ar}</p>
          {(next.tab || next.lifecycle) && (
            <button onClick={() => (next.lifecycle ? onOpenLifecycle() : onGoTab(next.tab as string))}
              className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs px-4 py-2">
              {t({ ar: "افتح", en: "Open" })}
            </button>
          )}
        </div>
      </section>

      <section className={`${card} p-3 space-y-2`}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm text-stone-100 truncate" dir="auto">{snap.project_name}</p>
            <p className="text-[11px] text-stone-500 truncate" dir="auto">
              {snap.client_name ?? t({ ar: "بلا عميل", en: "No client" })}
              {snap.manager_name ? ` · ${t({ ar: "مدير", en: "PM" })}: ${snap.manager_name}` : ""}
            </p>
          </div>
          <button onClick={() => void load()} className="text-[11px] text-stone-400 hover:text-white">↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px]">
          {quickTypeLabel(snap.project_type) && (
            <span className="px-2 py-0.5 rounded bg-teal-900/40 text-teal-300">{quickTypeLabel(snap.project_type)}</span>
          )}
          <span className="px-2 py-0.5 rounded bg-stone-800 text-stone-300">
            {t(PC_STAGE_LABELS[snap.core_stage as PcStage] ?? { ar: snap.core_stage, en: snap.core_stage })}
          </span>
          {snap.health && (
            <span style={{ color: HEALTH_CLR[snap.health] ?? "#78716c" }}>
              ● {t(HEALTH_LABELS[snap.health as PcHealth] ?? { ar: snap.health, en: snap.health })}
            </span>
          )}
          {snap.start_date && <span className="text-stone-500" dir="ltr">▶ {snap.start_date}</span>}
          {snap.due_date && <span className="text-stone-500" dir="ltr">⏱ {snap.due_date}</span>}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <Mini n={snap.tasks.open} ar="مهام مفتوحة" />
          <Mini n={snap.tasks.overdue} ar="مهام متأخرة" danger />
          <Mini n={snap.deliverables_total} ar="مخرجات" />
          <Mini n={snap.shoots_total} ar="جلسات" />
        </div>

        {snap.next_shoot && (
          <button onClick={() => onGoTab("shoots")} className="w-full text-right text-[11px] text-stone-300 border border-stone-800 rounded-lg px-2 py-1.5 hover:border-stone-600">
            {t({ ar: "الجلسة القادمة", en: "Next shoot" })}: <b dir="auto">{snap.next_shoot.title}</b>
            {snap.next_shoot.session_date ? <span dir="ltr"> — {snap.next_shoot.session_date}</span> : null}
          </button>
        )}
        {snap.current_deliverable && (
          <button onClick={() => onGoTab("deliverables")} className="w-full text-right text-[11px] text-stone-300 border border-stone-800 rounded-lg px-2 py-1.5 hover:border-stone-600">
            {t({ ar: "المخرج الحالي", en: "Current deliverable" })}: <b dir="auto">{snap.current_deliverable.title}</b>
            <span className="text-stone-500"> — {DELIVERABLE_STATUS_AR[snap.current_deliverable.status] ?? snap.current_deliverable.status}</span>
          </button>
        )}
      </section>

      {/* قائمة الإنجاز المشتقّة — «غير متاح» ليست «مكتملة» ولا «ناقصة» */}
      <section className={`${card} p-3 space-y-1.5`}>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "قائمة الإنجاز", en: "Completion checklist" })}</h4>
          <span className="text-[10px] text-stone-500">{done}/{known}</span>
        </div>
        {snap.checklist.map((c) => (
          <div key={c.code} className="flex items-center gap-2 text-[11px]">
            <span aria-hidden="true" className="w-4 text-center">
              {c.done === null ? "–" : c.done ? "✓" : "○"}
            </span>
            <span className={c.done === null ? "text-stone-600" : c.done ? "text-emerald-300" : "text-stone-400"}>{c.ar}</span>
            {/* الحالة نصًّا لا لونًا فقط */}
            <span className="text-[9px] text-stone-600 ms-auto">
              {c.done === null ? t({ ar: "غير متاح", en: "n/a" }) : c.done ? t({ ar: "تم", en: "done" }) : t({ ar: "لم يتم", en: "pending" })}
            </span>
          </div>
        ))}
        {snap.closure.readiness_percent != null && (
          <p className="text-[10px] text-stone-500 pt-1">{t({ ar: "جاهزية الإغلاق", en: "Closure readiness" })}: {snap.closure.readiness_percent}%</p>
        )}
      </section>

      {canManage && (
        <button onClick={() => void switchToStandard()} disabled={busy}
          className="w-full text-[11px] text-stone-300 border border-stone-700 rounded-lg px-3 py-2 disabled:opacity-40">
          {busy ? t({ ar: "جارٍ…", en: "…" }) : t({ ar: "التحويل إلى الإدارة القياسية (لا يغيّر أيّ بيانات)", en: "Switch to standard view (no data changes)" })}
        </button>
      )}
    </div>
  );
}

const DELIVERABLE_STATUS_AR: Record<string, string> = {
  draft: "مسودّة", internal_review: "مراجعة داخلية", client_review: "لدى العميل",
  revision_requested: "تعديل مطلوب", approved: "معتمد", final_delivered: "مُسلَّم", archived: "مؤرشف",
};

function Mini({ n, ar, danger }: { n: number; ar: string; danger?: boolean }) {
  return (
    <div className="border border-stone-800 rounded-lg p-2">
      <div className="text-base font-bold" style={{ color: danger && n > 0 ? "#dc2626" : "#e7e5e4" }}>{n}</div>
      <div className="text-[9px] text-stone-500 leading-tight">{ar}</div>
    </div>
  );
}
