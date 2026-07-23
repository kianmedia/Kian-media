"use client";
// ════════════════════════════════════════════════════════════════════════════
// OperationsCenter — Batch 7B. لوحة التشغيل اليومية الموحّدة (staff فقط، role-aware).
// تُركّب المصادر القائمة عبر 4 دوال قراءة (operations_*): لا نظام مهام/إشعارات/
// اعتمادات موازٍ. الإجراءات التنفيذية التي لها مراكزها (الإغلاق/الاعتمادات/المخرجات)
// تُفتح في مكانها الحقيقي عبر روابط مباشرة — لا نكرّر منطق الاعتماد هنا.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import NotificationsView from "@/components/portal/NotificationsView";
import {
  operationsCommandCenter, operationsMyWork, operationsAttentionQueue, operationsSchedule,
  URGENCY_META, SCHED_TYPE_AR, opsErr,
  type OperationsCenter as OpsCenter, type OperationsMyWork, type OperationsAttention,
  type OperationsSchedule, type OpsFilters, type MaybeCount, type OpsUrgency,
} from "@/lib/portal/operations";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
type Tab = "overview" | "mywork" | "attention" | "schedule" | "notifications";
const TABS: { k: Tab; ar: string; en: string }[] = [
  { k: "overview", ar: "نظرة عامة", en: "Overview" },
  { k: "mywork", ar: "عملي اليوم", en: "My work" },
  { k: "attention", ar: "تحتاج انتباهك", en: "Attention" },
  { k: "schedule", ar: "الجدول القادم", en: "Schedule" },
  { k: "notifications", ar: "الإشعارات", en: "Notifications" },
];
const PRIO_AR: Record<string, string> = { low: "منخفضة", normal: "عادية", high: "عالية", urgent: "عاجلة" };
const plink = (id: string) => `/client-portal/project-core/${id}`;
// وقت الرياض (لا UTC) — يتّسق مع تنسيق الجدول.
const riyadhTime = (iso: string) => { try { return new Date(iso).toLocaleTimeString("ar", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }); } catch { return iso.slice(11, 16); } };

// ─── حالة تحميل موحّدة: تسلسل الطلبات + مهلة + حارس Unmount (نفس نمط المنصّة) ───
function useLoader<T>(fn: () => Promise<{ ok: boolean; data?: T; error?: string }>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const seq = useRef(0); const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        fn(),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("ops_timeout")), 20000); }),
      ]);
      if (!mounted.current || my !== seq.current) return;   // آخر-طلب-يفوز
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[operations]", r.error); setErr(opsErr(r.error ?? "")); setPhase("error"); return; }
      setData(r.data as T); setPhase("ready");
    } catch (e) {
      if (!mounted.current || my !== seq.current) return;
      setErr(e instanceof Error && e.message === "ops_timeout" ? "انتهت المهلة." : opsErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { void load(); }, [load]);
  return { data, phase, err, reload: load };
}

function Shell({ phase, err, reload, empty, emptyMsg, children }:
  { phase: string; err: string; reload: () => void; empty?: boolean; emptyMsg?: string; children: React.ReactNode }) {
  const { t } = useI18n();
  if (phase === "loading") return <div className="py-10 text-center"><div className="inline-block w-5 h-5 border-2 border-stone-600 border-t-transparent rounded-full animate-spin" aria-label={t({ ar: "جارٍ التحميل", en: "Loading" })} /></div>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-2" role="alert">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={reload} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (empty) return <p className="text-xs text-stone-500 py-10 text-center">{emptyMsg ?? t({ ar: "لا عناصر.", en: "Nothing here." })}</p>;
  return <>{children}</>;
}

export type OpsPanel = "executive" | "closure" | "conflicts" | "templates" | "create";

export default function OperationsCenter({ onClose, onNavigate }:
  { onClose: () => void; onNavigate?: (panel: OpsPanel) => void }) {
  const { t } = useI18n();
  const { caps } = usePortal();
  const [tab, setTab] = useState<Tab>("overview");
  const [filters, setFilters] = useState<OpsFilters>({});
  const [showFilters, setShowFilters] = useState(false);

  const dateStr = new Date().toLocaleDateString("ar", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-1 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-5xl bg-stone-950 border border-stone-800 rounded-2xl my-1 sm:my-3" dir="rtl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between gap-2 p-3 border-b border-stone-800 sticky top-0 bg-stone-950 z-10 flex-wrap">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "مركز العمليات", en: "Operations center" })}</h3>
            <p className="text-[10px] text-stone-500" dir="auto">{dateStr}</p>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <button onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
              className="text-[11px] text-stone-300 border border-stone-700 rounded-lg px-2.5 py-1">{t({ ar: "الفلاتر", en: "Filters" })}</button>
            <button onClick={onClose} className="text-stone-400 hover:text-white text-lg leading-none px-1" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
          </div>
        </div>

        {showFilters && <FilterBar filters={filters} onApply={(f) => setFilters(f)} onClear={() => setFilters({})} />}

        {/* Tabs */}
        <div className="flex gap-1 flex-wrap p-2 border-b border-stone-800 overflow-x-auto" role="tablist" aria-label={t({ ar: "أقسام العمليات", en: "Operations sections" })}>
          {TABS.map((x) => (
            <button key={x.k} role="tab" id={`ops-tab-${x.k}`} aria-controls="ops-panel" aria-selected={tab === x.k} onClick={() => setTab(x.k)}
              className={`text-[11px] px-3 py-1 rounded-lg border whitespace-nowrap ${tab === x.k ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400 hover:text-white"}`}>
              {t({ ar: x.ar, en: x.en })}
            </button>
          ))}
        </div>

        <div className="p-3" id="ops-panel" role="tabpanel" aria-labelledby={`ops-tab-${tab}`}>
          {tab === "overview" && <OverviewTab filters={filters} caps={caps} onGoto={setTab} onNavigate={onNavigate} onClose={onClose} />}
          {tab === "mywork" && <MyWorkTab filters={filters} />}
          {tab === "attention" && <AttentionTab filters={filters} setFilters={setFilters} />}
          {tab === "schedule" && <ScheduleTab filters={filters} setFilters={setFilters} />}
          {tab === "notifications" && <NotificationsView />}
        </div>
      </div>
    </div>
  );
}

// ════════════════ الفلاتر (Server-side؛ تُمرَّر إلى exec_visible_projects) ════════════════
function FilterBar({ filters, onApply, onClear }: { filters: OpsFilters; onApply: (f: OpsFilters) => void; onClear: () => void }) {
  const { t } = useI18n();
  const [f, setF] = useState<OpsFilters>(filters);
  useEffect(() => setF(filters), [filters]);
  const set = (k: keyof OpsFilters, v: unknown) => setF((p) => ({ ...p, [k]: v === "" || v === false ? undefined : v }));
  const sel = "bg-stone-900 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200";
  return (
    <div className="p-3 border-b border-stone-800 flex flex-wrap gap-2 items-center bg-stone-950/60">
      <select aria-label={t({ ar: "الحالة الصحّية", en: "Health" })} value={String(f.health ?? "")} onChange={(e) => set("health", e.target.value)} className={sel}>
        <option value="">{t({ ar: "كل الصحّة", en: "Any health" })}</option>
        <option value="off_track">{t({ ar: "حرج", en: "Off track" })}</option>
        <option value="at_risk">{t({ ar: "معرّض", en: "At risk" })}</option>
        <option value="on_track">{t({ ar: "سليم", en: "On track" })}</option>
      </select>
      <select aria-label={t({ ar: "الأولوية", en: "Priority" })} value={String(f.priority ?? "")} onChange={(e) => set("priority", e.target.value)} className={sel}>
        <option value="">{t({ ar: "كل الأولويات", en: "Any priority" })}</option>
        {["urgent", "high", "normal", "low"].map((p) => <option key={p} value={p}>{PRIO_AR[p]}</option>)}
      </select>
      <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={!!f.overdue_only} onChange={(e) => set("overdue_only", e.target.checked)} />{t({ ar: "المتأخر فقط", en: "Overdue only" })}</label>
      <label className="flex items-center gap-1 text-[11px] text-stone-400"><input type="checkbox" checked={!!f.masters_only} onChange={(e) => set("masters_only", e.target.checked)} />{t({ ar: "الرئيسية فقط", en: "Masters only" })}</label>
      <button onClick={() => onApply(f)} className="text-[11px] text-white bg-red-600 hover:bg-red-700 rounded-lg px-3 py-1">{t({ ar: "تطبيق", en: "Apply" })}</button>
      <button onClick={() => { setF({}); onClear(); }} className="text-[11px] text-stone-400 border border-stone-700 rounded-lg px-3 py-1">{t({ ar: "مسح", en: "Clear" })}</button>
    </div>
  );
}

// ════════════════ نظرة عامة: بطاقات الملخّص + التحذيرات + إجراءات سريعة ════════════════
function OverviewTab({ filters, caps, onGoto, onNavigate, onClose }:
  { filters: OpsFilters; caps: { isAdminArea: boolean }; onGoto: (t: Tab) => void; onNavigate?: (p: OpsPanel) => void; onClose: () => void }) {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader<OpsCenter>(() => operationsCommandCenter(filters), [filters]);

  return (
    <Shell phase={phase} err={err} reload={reload}>
      {data && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-[10px] text-stone-500">
              {data.viewer.is_management ? t({ ar: "عرض الإدارة", en: "Management view" }) : data.viewer.reads_all ? t({ ar: "عرض موسّع", en: "Broad view" }) : t({ ar: "عرضي الشخصي", en: "My view" })}
              {" · "}{data.viewer.visible_project_count} {t({ ar: "مشروع", en: "projects" })}
              {" · "}<span dir="ltr">{riyadhTime(data.generated_at)}</span>
            </p>
            <button onClick={reload} className="text-[11px] text-stone-400 hover:text-white">↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
          </div>

          {data.warnings.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {data.warnings.map((w) => (
                <span key={w.code} className="text-[11px] px-2 py-1 rounded-lg border border-amber-900/60 bg-amber-950/20 text-amber-300">{w.ar}: {w.count}</span>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <Sc n={data.summary.tasks_today} ar="مهام اليوم" onClick={() => onGoto("mywork")} />
            <Sc n={data.summary.tasks_overdue} ar="مهام متأخرة" red onClick={() => onGoto("mywork")} />
            <Sc n={data.summary.tasks_blocked} ar="مهام محجوبة" onClick={() => onGoto("mywork")} />
            <Sc n={data.summary.tasks_unassigned} ar="مهام بلا مسؤول" />
            <Sc n={data.summary.reviews_pending} ar="مراجعات مطلوبة" onClick={() => onGoto("mywork")} />
            <Sc n={data.summary.approvals_mine} ar="اعتمادات تنتظر قراري" onClick={() => onGoto("mywork")} />
            <Sc n={data.summary.approvals_overdue} ar="اعتمادات متأخرة" red />
            <Sc n={data.summary.projects_attention} ar="مشاريع متعثّرة (متأخرة/حرجة)" red onClick={() => onGoto("attention")} />
            <Sc n={data.summary.deliverables_client_review} ar="مخرجات لدى العميل" />
            <Sc n={data.summary.shoots_today} ar="تصوير اليوم" onClick={() => onGoto("schedule")} />
            <Sc n={data.summary.shoots_next7} ar="تصوير خلال ٧ أيام" onClick={() => onGoto("schedule")} />
            <Sc n={data.summary.bookings_today} ar="حجوزات اليوم" />
            <Sc n={data.summary.resource_conflicts} ar="تعارضات الموارد" red />
            <Sc n={data.summary.risks_critical} ar="مخاطر حرجة" red onClick={() => onGoto("attention")} />
            <Sc n={data.summary.issues_critical} ar="مشكلات حرجة" red onClick={() => onGoto("attention")} />
            <Sc n={data.summary.change_requests_pending} ar="طلبات تغيير معلّقة" />
            <Sc n={data.summary.closures_pending} ar="إغلاقات معلّقة" onClick={() => onGoto("mywork")} />
            <Sc n={data.summary.notifications_unread} ar="إشعارات غير مقروءة" onClick={() => onGoto("notifications")} />
          </div>

          {onNavigate && <QuickActions caps={caps} onNavigate={onNavigate} onClose={onClose} />}
        </div>
      )}
    </Shell>
  );
}

// n قد يكون MaybeCount؛ نعرض "—" لغير المتاح، والأحمر يعتمد على القيمة الرقمية لا نصّها.
function Sc({ n, ar, red, onClick }: { n: number | MaybeCount; ar: string; red?: boolean; onClick?: () => void }) {
  const danger = red && typeof n === "number" && n > 0;
  const Inner = (
    <>
      <div className="text-lg font-bold" style={{ color: danger ? "#dc2626" : "#e7e5e4" }}>{n === "unavailable" ? "—" : n}</div>
      <div className="text-[10px] text-stone-500 leading-tight">{ar}</div>
    </>
  );
  if (onClick) return (
    <button onClick={onClick} className={`${card} p-2.5 text-right hover:border-stone-600 transition`}>{Inner}</button>
  );
  return <div className={`${card} p-2.5`}>{Inner}</div>;
}

// كل إجراء يفتح لوحة حقيقية قائمة في الدشبورد (لا رابط إلى صفحة/مُعامِل غير موجود).
function QuickActions({ caps, onNavigate, onClose }: { caps: { isAdminArea: boolean }; onNavigate: (p: OpsPanel) => void; onClose: () => void }) {
  const { t } = useI18n();
  const go = (p: OpsPanel) => { onClose(); onNavigate(p); };
  const acts: { ar: string; en: string; p: OpsPanel; admin?: boolean }[] = [
    { ar: "إنشاء مشروع", en: "New project", p: "create", admin: true },
    { ar: "من قالب", en: "From template", p: "templates", admin: true },
    { ar: "الإدارة التنفيذية", en: "Executive", p: "executive", admin: true },
    { ar: "مركز الإغلاق", en: "Closure", p: "closure", admin: true },
    { ar: "مركز التعارضات", en: "Conflicts", p: "conflicts", admin: true },
  ];
  const visible = acts.filter((a) => !a.admin || caps.isAdminArea);
  if (visible.length === 0) return null;
  return (
    <div>
      <h4 className="text-[11px] font-semibold text-stone-400 mb-1.5">{t({ ar: "إجراءات سريعة", en: "Quick actions" })}</h4>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((a) => (
          <button key={a.p} onClick={() => go(a.p)} className="text-[11px] text-stone-200 border border-stone-700 hover:border-stone-500 rounded-lg px-3 py-1.5">{t({ ar: a.ar, en: a.en })}</button>
        ))}
      </div>
    </div>
  );
}

// ════════════════ عملي اليوم ════════════════
function MyWorkTab({ filters }: { filters: OpsFilters }) {
  const { t } = useI18n();
  const { data, phase, err, reload } = useLoader<OperationsMyWork>(() => operationsMyWork(filters), [filters]);
  const BUCKET_AR: Record<string, string> = { blocked: "محجوبة", overdue: "متأخرة", today: "اليوم", upcoming: "قادمة", later: "لاحقًا" };
  const BUCKET_CLR: Record<string, string> = { blocked: "#dc2626", overdue: "#dc2626", today: "#d97706", upcoming: "#0891b2", later: "#78716c" };
  const clos = data?.closure ?? {};
  const closRows = [
    ...(clos.closure_requests ?? []).map((c) => ({ id: `cr-${String(c.id)}`, title: String(c.project_name ?? c.request_no ?? "—"), sub: t({ ar: "طلب إغلاق", en: "Closure request" }), url: `${plink(String(c.project_id))}?tab=closure` })),
    ...(clos.acceptances ?? []).map((a) => ({ id: `ac-${String(a.id)}`, title: String(a.project_name ?? "—"), sub: t({ ar: "قبول نهائي", en: "Final acceptance" }), url: `${plink(String(a.project_id))}?tab=closure` })),
    ...(clos.reopen_requests ?? []).map((r) => ({ id: `ro-${String(r.id)}`, title: String(r.project_name ?? "—"), sub: t({ ar: "إعادة فتح", en: "Reopen" }), url: `${plink(String(r.project_id))}?tab=closure` })),
  ];
  const empty = data && data.tasks.length === 0 && data.task_reviews.length === 0 && data.shoot_sessions.length === 0
    && data.resource_bookings.length === 0 && data.approvals.length === 0 && closRows.length === 0;

  return (
    <Shell phase={phase} err={err} reload={reload} empty={!!empty} emptyMsg={t({ ar: "لا مهام أو عناصر مسنَدة إليك اليوم.", en: "Nothing assigned to you today." })}>
      {data && (
        <div className="space-y-4">
          {data.tasks.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-stone-300 mb-1.5">{t({ ar: "مهامي", en: "My tasks" })} ({data.tasks.length})</h4>
              <div className="space-y-1">
                {data.tasks.map((tk) => (
                  <div key={tk.id} className={`${card} p-2 flex items-center gap-2 flex-wrap`}>
                    <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: (BUCKET_CLR[tk.bucket] ?? "#57534e") + "22", color: BUCKET_CLR[tk.bucket] ?? "#a8a29e" }}>{BUCKET_AR[tk.bucket]}</span>
                    <Link href={tk.action_url} className="text-xs text-stone-100 hover:text-sky-300 truncate flex-1 min-w-0" dir="auto">{tk.title}</Link>
                    <span className="text-[10px] text-stone-500 truncate max-w-[120px]" dir="auto">{tk.project_name ?? "—"}</span>
                    {tk.due_date && <span className="text-[10px] text-stone-500" dir="ltr">⏱ {tk.due_date}</span>}
                    <span className="text-[10px] text-stone-500">{PRIO_AR[tk.priority] ?? tk.priority}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
          <MiniList title={t({ ar: "مراجعات مطلوبة منّي", en: "My reviews" })} rows={data.task_reviews.map((r) => ({ id: r.id, title: r.title, sub: r.project_name, url: r.action_url }))} />
          <MiniList title={t({ ar: "جلساتي القادمة", en: "My shoots" })} rows={data.shoot_sessions.map((s) => ({ id: s.id, title: s.title, sub: s.session_date ?? s.project_name, url: s.action_url }))} />
          <MiniList title={t({ ar: "حجوزاتي", en: "My bookings" })} rows={data.resource_bookings.map((b) => ({ id: b.id, title: b.resource ?? "—", sub: b.starts_at.slice(0, 16).replace("T", " "), url: b.action_url }))} />
          <MiniList title={t({ ar: "إغلاق/قبول/إعادة فتح مطلوب منّي", en: "Closure awaiting me" })} rows={closRows} />
          {data.approvals.length > 0 && (
            <section>
              <h4 className="text-xs font-semibold text-stone-300 mb-1.5">{t({ ar: "اعتمادات تنتظر قراري", en: "Approvals awaiting me" })} ({data.approvals.length})</h4>
              <div className="space-y-1">
                {data.approvals.map((a, i) => (
                  <div key={String(a.id ?? i)} className={`${card} p-2 flex items-center gap-2 flex-wrap`}>
                    <Link href={`${plink(String(a.project_id))}?tab=governance`} className="text-xs text-stone-100 hover:text-sky-300 truncate flex-1 min-w-0" dir="auto">{String(a.title ?? a.approval_type ?? "—")}</Link>
                    <span className="text-[10px] text-stone-500 truncate max-w-[120px]" dir="auto">{String(a.project_name ?? "")}</span>
                    {a.overdue ? <span className="text-[10px] text-red-400">{t({ ar: "متأخر", en: "overdue" })}</span> : null}
                    <Link href={`${plink(String(a.project_id))}?tab=governance`} className="text-[10px] text-sky-300 border border-sky-900 rounded px-2 py-0.5">{t({ ar: "فتح", en: "Open" })}</Link>
                  </div>
                ))}
              </div>
              <p className="text-[9px] text-stone-600 mt-1">{t({ ar: "الاعتماد/الرفض يتمّ من صفحة المشروع حيث تعيش تلك الإجراءات.", en: "Approve/reject happens on the project page where those actions live." })}</p>
            </section>
          )}
        </div>
      )}
    </Shell>
  );
}

function MiniList({ title, rows }: { title: string; rows: { id: string; title: string; sub?: string | null; url?: string | null }[] }) {
  if (rows.length === 0) return null;
  return (
    <section>
      <h4 className="text-xs font-semibold text-stone-300 mb-1.5">{title} ({rows.length})</h4>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.id} className={`${card} p-2 flex items-center gap-2`}>
            {r.url ? <Link href={r.url} className="text-xs text-stone-100 hover:text-sky-300 truncate flex-1 min-w-0" dir="auto">{r.title}</Link>
                   : <span className="text-xs text-stone-100 truncate flex-1 min-w-0" dir="auto">{r.title}</span>}
            {r.sub && <span className="text-[10px] text-stone-500 truncate max-w-[160px]" dir="auto">{r.sub}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

// ════════════════ تحتاج انتباهك ════════════════
function AttentionTab({ filters, setFilters }: { filters: OpsFilters; setFilters: (f: OpsFilters) => void }) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [filters.urgency, filters]);
  const { data, phase, err, reload } = useLoader<OperationsAttention>(
    () => operationsAttentionQueue({ ...filters, limit: 50, offset }), [filters, offset]);
  const URG: OpsUrgency[] = ["critical", "high", "medium", "low"];

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setFilters({ ...filters, urgency: undefined })} className={`text-[11px] px-2.5 py-1 rounded-lg border ${!filters.urgency ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400"}`}>{t({ ar: "الكل", en: "All" })}</button>
        {URG.map((u) => (
          <button key={u} onClick={() => setFilters({ ...filters, urgency: u })}
            className={`text-[11px] px-2.5 py-1 rounded-lg border ${filters.urgency === u ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400"}`}
            style={filters.urgency === u ? { color: URGENCY_META[u].color } : undefined}>{URGENCY_META[u].ar}</button>
        ))}
      </div>
      <Shell phase={phase} err={err} reload={reload} empty={data?.items.length === 0} emptyMsg={t({ ar: "لا شيء يحتاج انتباهك الآن — عمل جيّد.", en: "Nothing needs attention — nice." })}>
        {data && (
          <div className="space-y-1">
            {/* مفتاح يشمل reason_code: مشروع off_track ومتأخر ينتج عنصرين بنفس (entity_type,entity_id) */}
            {data.items.map((it) => (
              <Link key={`${it.entity_type}-${it.entity_id}-${it.reason_code}`} href={it.action_url} className={`${card} p-2 flex items-center gap-2 flex-wrap hover:border-stone-600`}>
                <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: URGENCY_META[it.urgency].color + "22", color: URGENCY_META[it.urgency].color }}>{URGENCY_META[it.urgency].ar}</span>
                <span className="text-xs text-stone-100 flex-1 min-w-0" dir="auto">{it.reason_ar}</span>
                <span className="text-[10px] text-stone-500 truncate max-w-[140px]" dir="auto">{it.project_name ?? "—"}</span>
                {it.age_days != null && it.age_days > 0 && <span className="text-[10px] text-stone-500">{it.age_days} {t({ ar: "يوم", en: "d" })}</span>}
              </Link>
            ))}
            {(offset > 0 || data.has_more) && (
              <div className="flex items-center justify-between pt-2">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "السابق", en: "Prev" })}</button>
                <span className="text-[10px] text-stone-600">{data.total} {t({ ar: "عنصر", en: "items" })}</span>
                <button disabled={!data.has_more} onClick={() => setOffset(offset + 50)} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "التالي", en: "Next" })}</button>
              </div>
            )}
          </div>
        )}
      </Shell>
    </div>
  );
}

// ════════════════ الجدول القادم ════════════════
function ScheduleTab({ filters, setFilters }: { filters: OpsFilters; setFilters: (f: OpsFilters) => void }) {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const win = filters.window ?? "7d";
  useEffect(() => setOffset(0), [filters.window, filters.entity_type, filters]);
  const { data, phase, err, reload } = useLoader<OperationsSchedule>(
    () => operationsSchedule({ ...filters, window: win, limit: 100, offset }), [filters, win, offset]);
  const WINS: { k: NonNullable<OpsFilters["window"]>; ar: string }[] = [
    { k: "today", ar: "اليوم" }, { k: "tomorrow", ar: "غدًا" }, { k: "7d", ar: "٧ أيام" }, { k: "30d", ar: "٣٠ يومًا" },
  ];
  const fmt = (iso: string) => { try { return new Date(iso).toLocaleString("ar", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }); } catch { return iso.slice(0, 16); } };

  return (
    <div className="space-y-2">
      <div className="flex gap-1.5 flex-wrap">
        {WINS.map((w) => (
          <button key={w.k} onClick={() => setFilters({ ...filters, window: w.k })}
            className={`text-[11px] px-2.5 py-1 rounded-lg border ${win === w.k ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400"}`}>{w.ar}</button>
        ))}
        <select aria-label={t({ ar: "نوع الحدث", en: "Event type" })} value={String(filters.entity_type ?? "")} onChange={(e) => setFilters({ ...filters, entity_type: e.target.value || undefined })} className="bg-stone-900 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-300">
          <option value="">{t({ ar: "كل الأنواع", en: "All types" })}</option>
          {Object.entries(SCHED_TYPE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <Shell phase={phase} err={err} reload={reload} empty={data?.events.length === 0} emptyMsg={t({ ar: "لا أحداث في هذه الفترة.", en: "No events in this window." })}>
        {data && (
          <div className="space-y-1">
            {data.events.map((ev) => (
              <Link key={`${ev.entity_type}-${ev.entity_id}`} href={ev.action_url} className={`${card} p-2 flex items-center gap-2 flex-wrap hover:border-stone-600`}>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{SCHED_TYPE_AR[ev.entity_type] ?? ev.entity_type}</span>
                <span className="text-xs text-stone-100 flex-1 min-w-0 truncate" dir="auto">{ev.title ?? "—"}</span>
                <span className="text-[10px] text-stone-500 truncate max-w-[130px]" dir="auto">{ev.project_name ?? ""}</span>
                <span className="text-[10px] text-stone-400" dir="ltr">{fmt(ev.at)}</span>
              </Link>
            ))}
            {(offset > 0 || data.has_more) && (
              <div className="flex items-center justify-between pt-2">
                <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "السابق", en: "Prev" })}</button>
                <span className="text-[10px] text-stone-600">{data.total} {t({ ar: "حدث", en: "events" })}</span>
                <button disabled={!data.has_more} onClick={() => setOffset(offset + 100)} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "التالي", en: "Next" })}</button>
              </div>
            )}
          </div>
        )}
      </Shell>
    </div>
  );
}
