"use client";
// ════════════════════════════════════════════════════════════════════════════
// ExecDashboard — اللوحة التنفيذية (المرحلة ٥).
//
// تقرأ من mgmt_* ولا تحسب رقمًا واحدًا بنفسها. كلّ ما تفعله: ترتيب، وتسمية،
// وتصدير، وطباعة — والقرار في القاعدة.
//
// ★ ما لا تفعله هذه الشاشة أبدًا ★
//   • لا تستبدل مؤشّرًا محجوبًا أو غير مطبَّق بصفر (البطاقة ترفض طباعة رقم
//     خارج الحالة ok، والمنطق كلّه في KpiCard).
//   • لا تخفي مؤشّرًا لأنّه محجوب: تعرضه بحالته كي يُرى الحجب لا أن يُنسى.
//   • لا تعرض رقمًا بلا طابع زمنيّ (FreshnessBar مثبَّت أعلى الشاشة وفي الطباعة).
//   • لا تقرّر صلاحية: مِجَسّ mgmt_access للتجميل فقط، والدوالّ تمنع بنفسها.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  execAccess, execDashboard, execExport, execRefresh, execSources,
  execCsvDownload, execRowsToCsv, departmentLabel, kpiLabel, isStale,
  freshnessLabel, stampLabel,
  execRevenueBasis, revenueBasisWhy, currencyNote, vatNote,
  EXEC_DEPARTMENTS, REVENUE_BASIS_LABEL,
  type ExecAccess, type ExecAlert, type ExecDashboard as ExecDash,
  type ExecDepartment, type ExecFilters, type ExecKpi, type ExecRevenueBasis,
  type ExecSources, type Lang,
} from "@/lib/portal/execReport";
import {
  Denied, Empty, ErrorBox, FreshnessBar, KpiCard, MigrationPending, SectionTitle,
  Spinner, StateBadge, StateView, btnGhost, btnPrimary, card, fieldCls, useExecLoad,
} from "./ExecAtoms";

const PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #exec-print, #exec-print * { visibility: visible !important; }
  #exec-print { position: absolute; top: 0; inset-inline-start: 0; width: 100%;
                margin: 0; padding: 16px; background: #fff !important; color: #111 !important; }
  #exec-print .no-print { display: none !important; }
  #exec-print .p-card { border: 1px solid #ccc !important; background: #fff !important;
                        break-inside: avoid; page-break-inside: avoid; }
  #exec-print .p-ink { color: #111 !important; }
  #exec-print .p-muted { color: #555 !important; }
  #exec-print .p-grid { display: grid !important; grid-template-columns: repeat(3, minmax(0,1fr)) !important; }
}`;

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const daysAgo = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

const ORDER: Record<ExecDepartment, string[]> = {
  communications: [
    "notifications_pending", "notifications_failed",
    "ai_knowledge_approved", "ai_leads_pending_review",
  ],
  production: [
    "operational_readiness", "resource_conflicts", "upcoming_jobs",
    "live_sessions_active", "live_open_incidents",
  ],
  sales: ["new_leads", "pipeline_value", "weighted_forecast", "stalled_opportunities"],
  finance: ["expenses", "commitments", "overdue_collections", "estimated_profitability"],
};

export default function ExecDashboard() {
  const { t, lang } = useI18n();
  const L = lang as Lang;

  const [from, setFrom] = useState<string>(daysAgo(29));
  const [to, setTo] = useState<string>(iso(new Date()));
  const [depts, setDepts] = useState<ExecDepartment[]>([...EXEC_DEPARTMENTS]);
  const [nonce, setNonce] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  const [showSources, setShowSources] = useState(false);

  const filters: ExecFilters = useMemo(
    () => ({ from, to, departments: depts }),
    [from, to, depts],
  );

  const access = useExecLoad<ExecAccess>(() => execAccess(L), [L]);
  const dash = useExecLoad<ExecDash>(
    () => execDashboard(filters, false, L),
    [from, to, depts.join(","), nonce, L],
  );

  const onRefresh = useCallback(async () => {
    await execRefresh(filters, L);
    setNonce((n) => n + 1);
  }, [filters, L]);

  const toggleDept = (d: ExecDepartment) => {
    setDepts((cur) => {
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
      // قائمة فارغة تعني «الكلّ» في القاعدة؛ إبقاؤها فارغة هنا يُربك القارئ.
      return next.length === 0 ? [...EXEC_DEPARTMENTS] : next;
    });
  };

  const onExport = async (dataset: "kpis" | "alerts") => {
    setExporting(dataset);
    setExportMsg(null);
    const r = await execExport(dataset, filters, L);
    setExporting(null);
    if (r.state !== "ok") { setExportMsg(r.message); return; }
    const body = execRowsToCsv(r.data.columns, r.data.rows, L);
    execCsvDownload(
      `kian-exec-${dataset}-${from}_${to}`,
      body,
      { generatedAt: r.data.generated_at, isStale: !!r.data.is_stale, filters: r.data.filters },
      L,
    );
    setExportMsg(
      t({
        ar: "تمّ التنزيل. ترويسة الملفّ تحمل وقت حساب الأرقام — لا وقت التصدير.",
        en: "Downloaded. The file header carries when the numbers were computed, not when they were exported.",
      }),
    );
  };

  // ─── المِجَسّ: العميل والمحروم يُصرَّح لهما بالسبب لا بشاشة فارغة ─────────
  if (access.st === null) return <Spinner />;
  if (access.st.state === "needs_migration") return <MigrationPending message={access.st.message} />;
  if (access.st.state === "error") return <ErrorBox message={access.st.message} onRetry={access.reload} />;
  if (access.st.state === "denied") return <Denied message={access.st.message} />;

  const a = access.st.data;
  if (!a.authenticated) {
    return <Denied message={(L === "ar" ? a.message_ar : a.message_en) ?? EXEC_SIGNIN[L]} />;
  }
  if (a.is_client || !a.can_view) {
    return <Denied message={(L === "ar" ? a.message_ar : a.message_en) ?? EXEC_SIGNIN[L]} />;
  }

  return (
    <div className="space-y-4" dir={L === "ar" ? "rtl" : "ltr"}>
      <style>{PRINT_CSS}</style>

      {/* ─── المرشّحات ─────────────────────────────────────────────────── */}
      <div className={`${card} p-4 space-y-3 no-print`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="block">
            <span className="text-[11px] text-stone-500 block mb-1">{t({ ar: "من", en: "From" })}</span>
            <input type="date" className={fieldCls} value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="block">
            <span className="text-[11px] text-stone-500 block mb-1">{t({ ar: "إلى", en: "To" })}</span>
            <input type="date" className={fieldCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-end gap-2">
            {[7, 30, 90].map((n) => (
              <button
                key={n}
                className={btnGhost}
                onClick={() => { setFrom(daysAgo(n - 1)); setTo(iso(new Date())); }}
              >
                {t({ ar: `آخر ${n} يومًا`, en: `Last ${n} days` })}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-[11px] text-stone-500 block mb-2">{t({ ar: "الأقسام", en: "Departments" })}</span>
          <div className="flex flex-wrap gap-2">
            {EXEC_DEPARTMENTS.map((d) => {
              const on = depts.includes(d);
              return (
                <button
                  key={d}
                  onClick={() => toggleDept(d)}
                  aria-pressed={on}
                  className={`min-h-[40px] px-3 py-2 rounded-lg text-xs border transition-colors ${
                    on
                      ? "bg-stone-700 border-stone-600 text-stone-100"
                      : "bg-stone-950 border-stone-800 text-stone-500"
                  }`}
                >
                  {departmentLabel(d, L)}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button className={btnGhost} onClick={() => setShowSources((s) => !s)}>
            {t({ ar: "حالة المصادر", en: "Source status" })}
          </button>
          <button className={btnGhost} onClick={() => onExport("kpis")} disabled={!a.can_export || exporting !== null}>
            {t({ ar: "تصدير المؤشّرات CSV", en: "Export KPIs (CSV)" })}
          </button>
          <button className={btnGhost} onClick={() => onExport("alerts")} disabled={!a.can_export || exporting !== null}>
            {t({ ar: "تصدير التنبيهات CSV", en: "Export alerts (CSV)" })}
          </button>
          <button className={btnPrimary} onClick={() => window.print()}>
            {t({ ar: "طباعة التقرير", en: "Print report" })}
          </button>
        </div>
        {!a.can_export && (
          <p className="text-[11px] text-stone-500 leading-6">
            {t({
              ar: "التصدير يحتاج مفتاح exec_report.export. الأزرار معطّلة هنا، والقاعدة ترفضه أصلًا حتى لو فُعِّلت.",
              en: "Export requires exec_report.export. The buttons are disabled here, and the database refuses it regardless.",
            })}
          </p>
        )}
        {exportMsg && <p className="text-[11px] text-stone-400 leading-6">{exportMsg}</p>}
      </div>

      {showSources && <SourcesPanel />}

      {/* ─── اللوحة ────────────────────────────────────────────────────── */}
      <StateView st={dash.st} onRetry={dash.reload}>
        {(d) => (
          <div id="exec-print" className="space-y-4">
            <PrintHeader d={d} />

            <FreshnessBar d={d} busy={dash.busy} onRefresh={onRefresh} />

            {d.filters?.fallback && (
              <div className={`${card} p-3 border-amber-900 bg-amber-950/30`} role="alert">
                <p className="text-[11px] text-amber-300 leading-6">
                  {L === "ar" ? d.filters.fallback_reason_ar : d.filters.fallback_reason_en}
                </p>
              </div>
            )}

            {(d.filters?.unknown_departments?.length ?? 0) > 0 && (
              <div className={`${card} p-3 border-amber-900 bg-amber-950/30`} role="alert">
                <p className="text-[11px] text-amber-300 leading-6">
                  {t({
                    ar: `أقسام غير معروفة أُهمِلت: ${d.filters.unknown_departments.join("، ")}`,
                    en: `Unknown departments were ignored: ${d.filters.unknown_departments.join(", ")}`,
                  })}
                </p>
              </div>
            )}

            {!d.sensitive_visible && (
              <div className={`${card} p-3`} role="note">
                <p className="text-[11px] text-stone-400 leading-6">
                  🙈{" "}
                  {(L === "ar" ? d.sensitive_message_ar : d.sensitive_message_en) ??
                    t({
                      ar: "المؤشّرات المالية والهوامش مقصورة على المالك. تظهر هنا بحالة «محجوب» ولا تظهر أصفارًا.",
                      en: "Financial KPIs and margins are owner-only. They appear as “withheld”, never as zeros.",
                    })}
                </p>
              </div>
            )}

            <AlertsPanel alerts={d.alerts ?? []} />
            <RevenueBasisPanel from={from} to={to} />

            {EXEC_DEPARTMENTS.map((dep) => {
              const keys = ORDER[dep];
              const rows = keys
                .map((k) => (d.kpis ?? []).find((x) => x.key === k))
                .filter((x): x is ExecKpi => !!x);
              if (rows.length === 0) return null;
              const allOut = rows.every((r) => r.state === "filtered_out");
              if (allOut) return null;
              return (
                <section key={dep}>
                  <SectionTitle>{departmentLabel(dep, L)}</SectionTitle>
                  <div className="p-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {rows.map((k) => (
                      <div key={k.key} className="p-card">
                        <KpiCard kpi={k} title={kpiLabel(k.key, L)} />
                      </div>
                    ))}
                  </div>
                </section>
              );
            })}

            <PrintFooter d={d} />
          </div>
        )}
      </StateView>
    </div>
  );
}

const EXEC_SIGNIN: Record<Lang, string> = {
  ar: "اللوحة التنفيذية داخلية بالكامل ولا تُتاح لحسابات العملاء.",
  en: "The executive dashboard is internal only and is not available to client accounts.",
};

// ─── التنبيهات ─────────────────────────────────────────────────────────────

function AlertsPanel({ alerts }: { alerts: ExecAlert[] }) {
  const { t, lang } = useI18n();
  const L = lang as Lang;
  const tone = (s: string) =>
    s === "high" ? "border-red-900 bg-red-950/30 text-red-300"
    : s === "medium" ? "border-amber-900 bg-amber-950/30 text-amber-300"
    : "border-stone-800 bg-stone-900 text-stone-300";

  return (
    <section>
      <SectionTitle
        note={t({
          ar: "التنبيهات مشتقّة من المؤشّرات أعلاه فقط. مؤشّر لا يُقرأ لا يولّد تنبيه «سليم» — بل يظهر ضمن «مؤشّرات لا تُقرأ».",
          en: "Alerts are derived only from the KPIs above. An unreadable KPI never produces an “all clear” — it surfaces under “KPIs that cannot be read”.",
        })}
      >
        {t({ ar: "تنبيهات الإدارة", en: "Management alerts" })}
      </SectionTitle>
      {alerts.length === 0 ? (
        <div className={`${card} p-4 p-card`}>
          <p className="text-sm text-stone-400 leading-7 p-muted">
            {t({
              ar: "لا تنبيهات ضمن المؤشّرات المقروءة في هذا النطاق. هذا لا يعني «لا مشاكل» في مؤشّر لم يُقرأ — راجع حالة المصادر.",
              en: "No alerts among the KPIs that could be read in this scope. This says nothing about KPIs that could not be read — check source status.",
            })}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {alerts.map((al, i) => (
            <li key={`${al.key}-${i}`} className={`${card} p-card p-3 border ${tone(al.severity)}`}>
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium p-ink">{L === "ar" ? al.title_ar : al.title_en}</span>
                <span className="text-[10px] shrink-0 opacity-80">
                  {departmentLabel(al.department, L)}
                </span>
              </div>
              <p className="text-xs mt-1 leading-6 opacity-90 p-muted">
                {L === "ar" ? al.detail_ar : al.detail_en}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── حالة المصادر ──────────────────────────────────────────────────────────

// ─── أسس المبالغ ───────────────────────────────────────────────────────────
//
// ★ كانت mgmt_revenue_basis مطبَّقة على الإنتاج وممنوحة لـauthenticated ولا
//   سطرَ في التطبيق يناديها: خلفيّةٌ بلا واجهة. المالك لم يكن يرى الفصل الذي
//   بُني له، ولا كان بند القبول «اقرأ وسوم الإيراد» قابلًا للتنفيذ أصلًا.
//
// أربعة مقاييس **لا يُجمع أيّها في رقم اسمه «الإيراد»**. والقيمة الغائبة تُقال
// «غير متاح» مع سببها، ولا تُعرض صفرًا. والدالّة owner-only: غير المالك يتلقّى
// ok:false ⇒ تظهر شاشة المنع، ولا تُخفى الشاشة تجميلًا.
function RevenueBasisPanel({ from, to }: { from: string; to: string }) {
  const { t, lang } = useI18n();
  const L = lang as Lang;
  const { st, reload } = useExecLoad<ExecRevenueBasis>(
    () => execRevenueBasis(from, to, L), [from, to, L]);

  const KEYS: (keyof ExecRevenueBasis)[] = [
    "contract_value_net", "invoiced_revenue_net",
    "collected_revenue_net", "recognized_revenue_net",
  ];

  return (
    <div className={`${card} p-4`}>
      <SectionTitle
        note={t({
          ar: "العقد ≠ المفوتَر ≠ المحصَّل ≠ المعترَف به. أربعة مقاييس مختلفة، ولا يُقرأ أيّها «إيرادًا».",
          en: "Contract ≠ invoiced ≠ collected ≠ recognized. Four different measures; none of them is “revenue”.",
        })}
      >
        {t({ ar: "أسس المبالغ", en: "Revenue basis" })}
      </SectionTitle>

      <StateView st={st} onRetry={reload}>
        {(b) => (
          <div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {KEYS.map((k) => {
                const v = b[k] as number | null;
                const why = revenueBasisWhy(b, k as string, L);
                return (
                  <div key={k as string} className="bg-stone-950 border border-stone-800 rounded-lg p-3">
                    <div className="text-[11px] text-stone-500 mb-1">
                      {REVENUE_BASIS_LABEL[k as string]?.[L] ?? (k as string)}
                    </div>
                    <div className={v === null ? "text-sm text-stone-500" : "text-lg text-stone-100"}>
                      {v === null
                        ? t({ ar: "غير متاح", en: "Unavailable" })
                        : new Intl.NumberFormat(L === "ar" ? "ar-SA" : "en-US",
                            { maximumFractionDigits: 2 }).format(v)}
                    </div>
                    {why && <div className="text-[11px] text-stone-600 mt-1 leading-relaxed">{why}</div>}
                  </div>
                );
              })}
            </div>

            <ul className="mt-3 space-y-1 text-[11px] text-stone-500 leading-relaxed">
              <li>{vatNote(b, L)}</li>
              <li>{currencyNote(b, L)}</li>
              <li>
                {b.basis_complete
                  ? t({ ar: "الأساس مكتمل: المصادر الثلاثة مقروءة.",
                        en: "Basis complete: all three sources were readable." })
                  : t({ ar: "الأساس ناقص — رقمٌ غائب يبقى «غير متاح» ولا يُقرأ صفرًا، والربح لا يُشتقّ.",
                        en: "Basis incomplete — a missing figure stays “unavailable”, never zero, and profit is not inferred." })}
              </li>
              {b.freshness_at && (
                <li>
                  {t({ ar: "وقت الحساب: ", en: "Computed at: " })}
                  <span dir="ltr">{new Date(b.freshness_at).toLocaleString(L === "ar" ? "ar-SA" : "en-US")}</span>
                </li>
              )}
            </ul>
          </div>
        )}
      </StateView>
    </div>
  );
}

function SourcesPanel() {
  const { t, lang } = useI18n();
  const L = lang as Lang;
  const { st, reload } = useExecLoad<ExecSources>(() => execSources(L), [L]);
  return (
    <div className={`${card} p-4 no-print`}>
      <SectionTitle
        note={t({
          ar: "«غير مطبَّق» ليس صفرًا. هذه الشاشة تقول أيّ ملفّ SQL ينقص، وأيّ موديول يرفض قراءتك.",
          en: "“Not installed” is not zero. This panel names the missing SQL file and the modules that deny you.",
        })}
      >
        {t({ ar: "حالة المصادر", en: "Source status" })}
      </SectionTitle>
      <StateView st={st} onRetry={reload}>
        {(s) =>
          s.sources.length === 0 ? (
            <Empty message={t({ ar: "لا مصادر معرَّفة.", en: "No sources defined." })} />
          ) : (
            <ul className="space-y-2">
              {s.sources.map((src) => (
                <li key={src.module} className="border border-stone-800 rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-stone-200">{departmentLabel(src.module, L)}</span>
                    <span className="flex items-center gap-2">
                      <StateBadge state={src.installed ? "ok" : "unavailable"} />
                      {src.installed && src.authorized === false && <StateBadge state="restricted" />}
                      {src.installed && src.authorized === null && <StateBadge state="error" />}
                    </span>
                  </div>
                  {(L === "ar" ? src.note_ar : src.note_en) && (
                    <p className="text-[11px] text-stone-400 mt-1 leading-6">
                      {L === "ar" ? src.note_ar : src.note_en}
                    </p>
                  )}
                  {!src.installed && (
                    <p className="text-[10px] text-stone-600 mt-1" dir="ltr">{src.runme}</p>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </StateView>
    </div>
  );
}

// ─── الطباعة ───────────────────────────────────────────────────────────────

function PrintHeader({ d }: { d: ExecDash }) {
  const { t, lang } = useI18n();
  const L = lang as Lang;
  return (
    <div className="hidden print:block p-ink" style={{ marginBottom: 12 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>
        {t({ ar: "تقرير كيان التنفيذيّ", en: "Kian Executive Report" })}
      </h1>
      <p className="p-muted" style={{ fontSize: 11, marginTop: 4 }}>
        {t({ ar: "المدى: ", en: "Range: " })}
        {d.filters?.from} → {d.filters?.to}
        {" · "}
        {t({ ar: "الأقسام: ", en: "Departments: " })}
        {(d.filters?.departments ?? []).map((x) => departmentLabel(x, L)).join(" · ")}
      </p>
      <p className="p-muted" style={{ fontSize: 11, marginTop: 2 }}>
        {t({ ar: "وقت حساب الأرقام: ", en: "Numbers computed at: " })}
        {stampLabel(d, L)} ({freshnessLabel(d, L)})
        {isStale(d) ? t({ ar: " — ⚠️ أرقام قديمة", en: " — WARNING: stale" }) : ""}
      </p>
      {!d.sensitive_visible && (
        <p className="p-muted" style={{ fontSize: 11, marginTop: 2 }}>
          {t({
            ar: "نسخة بلا المؤشّرات المالية (مقصورة على المالك).",
            en: "Copy without financial KPIs (owner-only).",
          })}
        </p>
      )}
    </div>
  );
}

function PrintFooter({ d }: { d: ExecDash }) {
  const { t, lang } = useI18n();
  const L = lang as Lang;
  return (
    <p className="text-[10px] text-stone-600 leading-6 p-muted">
      {t({
        ar: "كلّ رقم في هذا التقرير مقروء من موديوله لحظةَ الحساب المذكور أعلاه، لا لحظةَ الطباعة. المؤشّر الذي ظهر «غير متاح» يعني أنّ مصدره غير مطبَّق — ولا يعني صفرًا.",
        en: "Every figure here was read from its own module at the computation time stated above, not at print time. A KPI shown as “unavailable” means its source is not installed — it does not mean zero.",
      })}
      {" "}
      {stampLabel(d, L)}
    </p>
  );
}
