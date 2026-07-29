"use client";
// ════════════════════════════════════════════════════════════════════════════
// LargeProjectDashboard — لوحة مشروع كبير (رئيسيّ + مراحله الفرعية).
//
// عامّة تمامًا: لا عدد مراحل مفترضًا، ولا عدد مخرجات، ولا نوع محتوى مفترضًا.
// تعمل على مشروع مستقلّ صغير كما تعمل على مشروع بعشر مراحل ومئات المخرجات.
//
// كلّ مصدر ثانويّ (الحوكمة، النشاط، project_core) يُجلب بأفضل جهد: فشله يُذكر
// صراحةً في شريط «تدهور جزئيّ» ولا يمنع الصفحة من الظهور.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  lpLoadSnapshot, lpStaffOptions, lpResetCapabilities, lpErr, lpClassify, lpIsMigrationPending, lpLogError,
  lpMigrationNotice, lpProgress, lpCounters, lpStageBreakdown, lpGroupsOf,
  lpProjectScheduleStatus, lpTodayISO, lpServerProgress, lpDueLabel, LP_STATUS_LABELS, LP_SCHEDULE_LABELS,
  type LpSnapshot, type LpFilters, type LpServerProgress,
} from "@/lib/portal/large-projects";
import {
  lpCard, LpSection, LpNotice, LpKpi, LpProgressBar, LargeProjectBreadcrumbs,
} from "@/components/portal/LargeProjectAtoms";
import DeliverableMatrix from "@/components/portal/DeliverableMatrix";
import LargeProjectHierarchy from "@/components/portal/LargeProjectHierarchy";
import { pcListActivity, PC_STAGE_LABELS, type ProjectActivity, type PcStage } from "@/lib/portal/projectCore";
import { projectGovernanceDashboard, type GovernanceDashboard } from "@/lib/portal/projectGovernance";

export type LargeProjectTab = "overview" | "deliverables" | "hierarchy";
type Tab = LargeProjectTab;

/**
 * `initialTab` يسمح بتركيب اللوحة نفسها كتبويبين في ProjectOps: «لوحة المشروع
 * الكبير» تفتح على النظرة العامة، و«مصفوفة المخرجات» تفتح مباشرةً على سطح
 * الإدخال الجماعيّ. لا نسخة ثانية من المنطق، ولا حالة مشتركة بين التبويبين
 * (تبديل التبويب في ProjectOps يُفكّك المكوّن فتُطبَّق القيمة الابتدائية).
 */
export default function LargeProjectDashboard({ projectId, initialTab }: { projectId: string; initialTab?: LargeProjectTab }) {
  const { t } = useI18n();
  const [snap, setSnap] = useState<LpSnapshot | null>(null);
  const [staff, setStaff] = useState<{ id: string; full_name: string | null }[]>([]);
  const [gov, setGov] = useState<GovernanceDashboard | null>(null);
  const [activity, setActivity] = useState<ProjectActivity[]>([]);
  // نسبة الخادم متى توفّرت = مصدر واحد للحقيقة؛ قبل الترحيلة تبقى null ويعمل المحرّك المحلّيّ.
  const [server, setServer] = useState<LpServerProgress | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  // هل سبب الفشل هو غياب الترحيلة (جدول/دالّة/عمود) لا عطلًا حقيقيًّا؟
  const [migrationPending, setMigrationPending] = useState(false);
  const [tab, setTab] = useState<Tab>(initialTab ?? "overview");
  const [filters, setFilters] = useState<LpFilters>({});
  const today = useMemo(() => lpTodayISO(), []);

  const seq = useRef(0);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (force?: boolean) => {
    const my = ++seq.current;
    setPhase("loading"); setErr("");
    if (force) lpResetCapabilities();
    const r = await lpLoadSnapshot(projectId);
    if (!alive.current || my !== seq.current) return;
    if (!r.ok) {
      lpLogError("load large-project dashboard snapshot", { table: "projects" }, r.error, r.status);
      // «الترحيل معلّق» فقط حين يكون جدول أو دالّة غائبًا فعلًا. 42703 (عمود
      // طلبه استعلامنا) مستثنى عمدًا: عرضه كترحيلة معلّقة أرسل المالك يبحث عن
      // ترحيلة سليمة بينما كان الاستعلام هو الخطأ.
      const k = lpClassify(r.error, r.status);
      setMigrationPending(lpIsMigrationPending(k));
      setErr(lpErr(r.error, r.status)); setPhase("error"); return;
    }
    setMigrationPending(false);
    setSnap(r.data); setPhase("ready");

    // مصادر ثانوية — بأفضل جهد، بعد ظهور اللوحة.
    void lpStaffOptions().then((s) => { if (alive.current && my === seq.current) setStaff(s); });
    void projectGovernanceDashboard(projectId).then((g) => {
      if (alive.current && my === seq.current) setGov(g.ok ? g.data : null);
    });
    void pcListActivity(projectId, 12).then((a) => {
      if (alive.current && my === seq.current) setActivity(a.ok ? (a.data ?? []) : []);
    });
    void lpServerProgress(projectId).then((p) => {
      if (alive.current && my === seq.current) setServer(p);
    });
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

  if (phase === "loading" && !snap) {
    return <div className={`${lpCard} p-8 text-center text-xs text-stone-500`} dir="rtl">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</div>;
  }
  if (phase === "error" || !snap) {
    // فشل من صنف «الترحيلة غير مطبّقة» ليس عطلًا: يُعرض كحالة معلومة مسمّاة
    // «الترحيل معلّق» لا كخطأ أحمر مبهم، لأن الشيفرة تُنشر قبل تطبيق الـSQL.
    return (
      <div className={`${lpCard} p-8 text-center space-y-2`} dir="rtl">
        {migrationPending && (
          <p className="text-xs font-semibold text-amber-200">
            <span className="inline-block rounded px-1.5 py-0.5 bg-amber-500/15 border border-amber-500/30">
              {t({ ar: "الترحيل معلّق", en: "Migration pending" })}
            </span>
          </p>
        )}
        <p className={`text-sm ${migrationPending ? "text-stone-400" : "text-red-300"}`}>{err || t({ ar: "تعذّر التحميل.", en: "Failed to load." })}</p>
        <button type="button" onClick={() => void load(true)} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">
          {t({ ar: "إعادة المحاولة", en: "Retry" })}
        </button>
      </div>
    );
  }

  return <Loaded snap={snap} staff={staff} gov={gov} activity={activity} today={today} server={server}
    tab={tab} setTab={setTab} filters={filters} setFilters={setFilters} reload={load} />;
}

function Loaded({
  snap, staff, gov, activity, today, server, tab, setTab, filters, setFilters, reload,
}: {
  snap: LpSnapshot; staff: { id: string; full_name: string | null }[];
  gov: GovernanceDashboard | null; activity: ProjectActivity[]; today: string;
  server: LpServerProgress | null;
  tab: Tab; setTab: (t: Tab) => void;
  filters: LpFilters; setFilters: (f: LpFilters) => void;
  reload: (force?: boolean) => void | Promise<void>;
}) {
  const { t, lang } = useI18n();
  const rows = snap.deliverables;
  const core = snap.coreByProject[snap.project.id];
  const closed = core?.core_stage === "closed";

  // ── الأرقام: تُحسب مرّة لكلّ تغيّر في الصفوف، لا في كلّ رسم ──
  const counters = useMemo(() => lpCounters(rows, today), [rows, today]);
  const local = useMemo(
    () => lpProgress(rows, { closed, frozenPct: core?.progress_pct ?? null }),
    [rows, closed, core?.progress_pct],
  );
  // بعد تطبيق الترحيلة يحسب الخادم النسبة نفسها بالقواعد نفسها. نعرض رقمه حين
  // يتوفّر حتى لا يظهر رقمان لنسبة واحدة، ونُبقي التفاصيل (الوزن/المحتسَب) محلّية.
  const progress = useMemo(
    () => (server && server.calculation_method
      ? { ...local, pct: server.pct, method: server.calculation_method, frozen: !!server.frozen }
      : local),
    [server, local],
  );
  const stageRows = useMemo(() => lpStageBreakdown(snap.stages, rows, today), [snap.stages, rows, today]);
  const groups = useMemo(() => lpGroupsOf(rows), [rows]);
  const schedule = useMemo(() => lpProjectScheduleStatus(rows), [rows]);
  const notice = useMemo(() => lpMigrationNotice(snap.caps), [snap.caps]);

  const crumbs = useMemo(() => {
    const list: { id: string; label: string }[] = [];
    if (snap.parent) list.push({ id: snap.parent.id, label: snap.parent.project_name ?? "—" });
    list.push({ id: snap.project.id, label: snap.project.project_name ?? "—" });
    return list;
  }, [snap.parent, snap.project]);

  /** نقرة على بطاقة رقم = فلتر. تنقل المستخدم إلى تبويب المخرجات مباشرة. */
  const jump = useCallback((f: LpFilters) => { setFilters(f); setTab("deliverables"); }, [setFilters, setTab]);

  return (
    <div className="space-y-2 sm:space-y-3" dir="rtl">
      {/* ── الترويسة ── */}
      <div className={`${lpCard} p-3 sm:p-4 space-y-2`}>
        <LargeProjectBreadcrumbs items={crumbs} />
        <div className="flex items-start justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-semibold text-stone-100 truncate" dir="auto">
              {snap.project.project_name ?? t({ ar: "بلا اسم", en: "Untitled" })}
            </h2>
            <div className="text-[11px] text-stone-500 flex items-center gap-2 flex-wrap mt-0.5">
              <span>{t({ ar: "العميل", en: "Client" })}: {snap.clientName ?? "—"}</span>
              <span>· {t({ ar: "مدير المشروع", en: "PM" })}: {snap.managerName ?? t({ ar: "غير محدَّد", en: "unassigned" })}</span>
              <span>· {t({ ar: "الحالة", en: "Status" })}: {core?.core_stage
                ? t(PC_STAGE_LABELS[core.core_stage as PcStage] ?? { ar: core.core_stage, en: core.core_stage })
                : (snap.project.status ?? "—")}</span>
              <span className={schedule.total > 0 && schedule.key === "awaiting_schedule" ? "text-sky-300" : ""}>
                {/* مشروع بلا مخرجات لا يُوصف بأنه «مجدول» — لا شيء ليُجدوَل بعد. */}
                · {t({ ar: "الجدولة", en: "Schedule" })}: {schedule.total === 0 ? "—" : t(LP_SCHEDULE_LABELS[schedule.key])}
                {schedule.awaiting > 0 && <span dir="ltr"> ({schedule.awaiting})</span>}
              </span>
            </div>
          </div>
          <button type="button" onClick={() => void reload(true)}
            className="text-[11px] text-stone-300 border border-stone-700 rounded-lg px-3 py-1.5 whitespace-nowrap">
            {t({ ar: "تحديث + إعادة فحص القدرات", en: "Refresh + re-probe" })}
          </button>
        </div>
        <LpProgressBar progress={progress} />
        <p className="text-[10px] text-stone-600">
          {t({ ar: "طريقة الحساب", en: "Method" })}: <span dir="ltr">{progress.method}</span>
          {" · "}{server ? t({ ar: "المصدر: الخادم", en: "source: server" }) : t({ ar: "المصدر: حساب محلّيّ (الترحيلة غير مطبّقة)", en: "source: local (migration pending)" })}
          {" · "}{t({ ar: "محتسَب", en: "counted" })} <span dir="ltr">{progress.counted}</span>
          {progress.excluded > 0 && <> · {t({ ar: "مستبعَد (مؤرشف)", en: "excluded (archived)" })} <span dir="ltr">{progress.excluded}</span></>}
        </p>
      </div>

      {/* حالة «الترحيل معلّق» صريحة ومسمّاة: الشاشة تعمل بالحقول الأساسية قبل
          تطبيق الـSQL، ولا تنهار ولا تظهر فارغة — لكن يجب أن يعرف المستخدم
          لماذا بعض الأعمدة والإجراءات الجماعية غائبة. */}
      {notice && (
        <LpNotice kind="warn">
          <span className="inline-block rounded px-1.5 py-0.5 ms-1 bg-amber-500/15 border border-amber-500/30 text-amber-200 text-[10px] font-semibold align-middle">
            {t({ ar: "الترحيل معلّق", en: "Migration pending" })}
          </span>
          {notice}
        </LpNotice>
      )}
      {snap.truncated && (
        <LpNotice kind="warn">
          {t({ ar: "عدد المخرجات تجاوز سقف الجلب — الأرقام أدناه جزئية.", en: "Deliverable count exceeded the fetch limit — the numbers below are partial." })}
        </LpNotice>
      )}
      {snap.degraded.length > 0 && (
        <LpNotice kind="info">
          {t({ ar: "تعذّر جلب بعض المصادر الثانوية", en: "Some secondary sources failed" })}: <span dir="ltr">{snap.degraded.join(", ")}</span>
        </LpNotice>
      )}

      {/* ── التبويبات ── */}
      <div className="flex gap-1 flex-wrap" role="tablist">
        {([
          ["overview", t({ ar: "نظرة عامة", en: "Overview" })],
          ["deliverables", `${t({ ar: "المخرجات", en: "Deliverables" })} (${rows.length})`],
          ["hierarchy", t({ ar: "الهيكل", en: "Hierarchy" })],
        ] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={`text-[11px] px-3 py-1.5 rounded-lg border ${tab === k ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-2 sm:space-y-3">
          {/* بطاقات الأرقام — شبكة تتكيّف مع الجوال */}
          <LpSection title={t({ ar: "الأرقام", en: "Numbers" })}>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-1.5">
              <LpKpi label={t({ ar: "المراحل", en: "Stages" })} value={snap.stages.length} />
              <LpKpi label={t({ ar: "المجموعات", en: "Groups" })} value={groups.length}
                hint={groups.length === 0 ? t({ ar: "لا مجموعات", en: "none" }) : undefined} />
              <LpKpi label={t({ ar: "المخرجات", en: "Deliverables" })} value={counters.total}
                onClick={() => jump({})} />
              <LpKpi label={t({ ar: "بانتظار الجدولة", en: "Awaiting schedule" })} value={counters.awaiting_schedule}
                tone="info" active={!!filters.awaitingSchedule} onClick={() => jump({ awaitingSchedule: true })}
                hint={t({ ar: "ليست متأخّرة", en: "not overdue" })} />
              <LpKpi label={t({ ar: "متأخّر", en: "Overdue" })} value={counters.overdue}
                tone={counters.overdue > 0 ? "danger" : "neutral"} active={!!filters.overdue}
                onClick={() => jump({ overdue: true })}
                hint={t({ ar: "بلا «بانتظار الجدولة»", en: "excludes awaiting" })} />
              <LpKpi label={t({ ar: "خلال ٧ أيام", en: "Due in 7d" })} value={counters.due_soon} tone="warn" />
              <LpKpi label={t({ ar: "مراجعة داخلية", en: "Internal review" })} value={counters.waiting_for_internal_review}
                onClick={() => jump({ statuses: ["internal_review"] })} />
              <LpKpi label={t({ ar: "لدى العميل", en: "With client" })} value={counters.waiting_for_client}
                active={!!filters.waitingForClient} onClick={() => jump({ waitingForClient: true })} />
              <LpKpi label={t({ ar: "طلب تعديل", en: "Revision" })} value={counters.revision_requested}
                tone={counters.revision_requested > 0 ? "warn" : "neutral"}
                onClick={() => jump({ statuses: ["revision_requested"] })} />
              <LpKpi label={t({ ar: "معتمد", en: "Approved" })} value={counters.approved} tone="ok"
                onClick={() => jump({ statuses: ["approved"] })} />
              <LpKpi label={t({ ar: "سُلِّم نهائيًّا", en: "Final delivered" })} value={counters.final_delivered} tone="ok"
                onClick={() => jump({ statuses: ["final_delivered"] })} />
              <LpKpi label={t({ ar: "بلا مسؤول", en: "Unassigned" })} value={counters.unassigned} />
            </div>
          </LpSection>

          {/* توزيع الحالات — كل الحالات، بلا افتراض */}
          <LpSection title={t({ ar: "المخرجات حسب الحالة", en: "Deliverables by status" })}>
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(counters.by_status).length === 0 && (
                <span className="text-[11px] text-stone-500">{t({ ar: "لا مخرجات.", en: "None." })}</span>
              )}
              {Object.entries(counters.by_status).sort((a, b) => b[1] - a[1]).map(([st, n]) => (
                <button key={st} type="button" onClick={() => jump({ statuses: [st] })}
                  className="text-[10px] px-2 py-1 rounded-lg border border-stone-700 bg-stone-950 text-stone-300 hover:border-stone-500">
                  {LP_STATUS_LABELS[st] ? t(LP_STATUS_LABELS[st]) : st} · <span dir="ltr">{n}</span>
                </button>
              ))}
            </div>
          </LpSection>

          {/* تقدّم كلّ مرحلة — بالوزن نفسه، والمرحلة الفارغة «غير متاح» */}
          <LpSection title={t({ ar: "تقدّم المراحل", en: "Progress by stage" })}>
            <div className="space-y-1.5">
              {stageRows.map(({ stage, progress: p, counters: c }) => (
                <div key={stage.project_id} className="flex items-center gap-2 flex-wrap border-b border-stone-800/60 pb-1.5 last:border-0">
                  <span className="text-[11px] text-stone-200 truncate max-w-[150px] sm:max-w-[220px]" dir="auto">
                    {stage.name ?? "—"}{stage.is_master ? ` · ${t({ ar: "رئيسيّ", en: "master" })}` : ""}
                  </span>
                  <span className="text-[10px] text-stone-500"><span dir="ltr">{c.total}</span> {t({ ar: "مخرج", en: "items" })}</span>
                  {/* الموعد النهائيّ للمرحلة/المشروع الفرعيّ. مصدره الوحيد
                      project_core.due_date عبر lpLoadSnapshot — لا projects.due_date
                      (عمود لم يوجد قطّ، وطلبُه هو ما كسر اللوحة على الإنتاج).
                      غيابه حالة صحيحة تُقال صراحةً «غير محدَّد». */}
                  <span className="text-[10px] text-stone-500">
                    {t({ ar: "الموعد", en: "Due" })} <span dir="ltr">{lpDueLabel(stage.due_date, lang)}</span>
                  </span>
                  {c.awaiting_schedule > 0 && <span className="text-[10px] text-sky-300"><span dir="ltr">{c.awaiting_schedule}</span> {t({ ar: "بانتظار الجدولة", en: "awaiting" })}</span>}
                  {c.overdue > 0 && <span className="text-[10px] text-red-300"><span dir="ltr">{c.overdue}</span> {t({ ar: "متأخّر", en: "overdue" })}</span>}
                  <span className="ms-auto min-w-[120px]"><LpProgressBar progress={p} compact /></span>
                </div>
              ))}
            </div>
          </LpSection>

          {/* الحوكمة — أفضل جهد */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
            <LpSection title={t({ ar: "المخاطر المفتوحة", en: "Open risks" })}>
              {!gov ? (
                <p className="text-[11px] text-stone-600">{t({ ar: "وحدة الحوكمة غير متاحة أو لا صلاحية.", en: "Governance module unavailable or not permitted." })}</p>
              ) : (gov.risks ?? []).length === 0 ? (
                <p className="text-[11px] text-stone-600">{t({ ar: "لا مخاطر مفتوحة.", en: "No open risks." })}</p>
              ) : (
                <ul className="space-y-1">
                  {(gov.risks ?? []).slice(0, 6).map((r) => (
                    <li key={r.id} className="flex items-center gap-2 text-[11px]">
                      <span className="text-stone-200 truncate" dir="auto">{r.title}</span>
                      <span className="text-stone-500 ms-auto">{r.severity}</span>
                    </li>
                  ))}
                </ul>
              )}
            </LpSection>

            <LpSection title={t({ ar: "قرارات وطلبات تغيير حديثة", en: "Recent decisions & change requests" })}>
              {!gov ? (
                <p className="text-[11px] text-stone-600">{t({ ar: "غير متاحة.", en: "Unavailable." })}</p>
              ) : (
                <div className="space-y-1">
                  {(gov.decisions ?? []).slice(0, 4).map((d) => (
                    <div key={d.id} className="flex items-center gap-2 text-[11px]">
                      <span className="text-[9px] px-1 rounded bg-stone-800 text-stone-400">{t({ ar: "قرار", en: "decision" })}</span>
                      <span className="text-stone-200 truncate" dir="auto">{d.title}</span>
                      <span className="text-stone-500 ms-auto">{d.status}</span>
                    </div>
                  ))}
                  {(gov.change_requests ?? []).slice(0, 4).map((c) => (
                    <div key={c.id} className="flex items-center gap-2 text-[11px]">
                      <span className="text-[9px] px-1 rounded bg-stone-800 text-stone-400">{t({ ar: "تغيير", en: "change" })}</span>
                      <span className="text-stone-200 truncate" dir="auto">{c.title}</span>
                      <span className="text-stone-500 ms-auto">{c.status}</span>
                    </div>
                  ))}
                  {(gov.decisions ?? []).length === 0 && (gov.change_requests ?? []).length === 0 && (
                    <p className="text-[11px] text-stone-600">{t({ ar: "لا شيء بعد.", en: "Nothing yet." })}</p>
                  )}
                </div>
              )}
            </LpSection>
          </div>

          <LpSection title={t({ ar: "النشاط الأخير", en: "Recent activity" })}>
            {activity.length === 0 ? (
              <p className="text-[11px] text-stone-600">{t({ ar: "لا نشاط مسجَّل.", en: "No recorded activity." })}</p>
            ) : (
              <ul className="space-y-1">
                {activity.slice(0, 10).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-[11px] text-stone-400">
                    <span className="text-stone-200">{a.action}</span>
                    <span className="text-stone-600 truncate">{a.entity_type ?? ""}</span>
                    <span className="ms-auto text-stone-600" dir="ltr">{String(a.created_at ?? "").slice(0, 16).replace("T", " ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </LpSection>
        </div>
      )}

      {tab === "deliverables" && (
        <DeliverableMatrix
          rows={rows} stages={snap.stages} caps={snap.caps} staff={staff}
          filters={filters} onFilters={setFilters} truncated={snap.truncated}
          onChanged={() => void reload()}
        />
      )}

      {tab === "hierarchy" && (
        <LargeProjectHierarchy snapshot={snap}
          onFocusStage={(id) => { setFilters({ stageIds: [id] }); setTab("deliverables"); }} />
      )}
    </div>
  );
}
