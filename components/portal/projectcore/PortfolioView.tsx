"use client";
// ════════════════════════════════════════════════════════════════════════════
// PortfolioView — Batch 9 Part 2. المحفظة الهرمية: عدّادات مجموعات + ثلاثة أقسام
// (برامج ورئيسية بفروع قابلة للتوسيع / مستقلة قياسية / سريعة). مصدر واحد مشتقّ من
// الخادم (project_portfolio_overview): عزل لكل صفّ، الفرع مرّة واحدة، لا مالية، لا N+1.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { PC_STAGE_LABELS, HEALTH_LABELS, type PcStage, type PcHealth } from "@/lib/portal/projectCore";
import {
  projectPortfolioOverview, portfolioNextAction, portfolioBadge, portfolioErr,
  type PortfolioOverview, type PortfolioMaster, type PortfolioStatus,
} from "@/lib/portal/portfolio";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const HEALTH_CLR: Record<string, string> = { on_track: "#16a34a", at_risk: "#d97706", off_track: "#dc2626" };
const PAGE = 50;

const stageAr = (s: string | null, t: (x: { ar: string; en: string }) => string) =>
  s ? t(PC_STAGE_LABELS[s as PcStage] ?? { ar: s, en: s }) : "—";

export default function PortfolioView({ view, onView }: { view: "grouped" | "flat"; onView: (v: "grouped" | "flat") => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<PortfolioOverview | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<PortfolioStatus | "">("");
  const [mOff, setMOff] = useState(0); const [sOff, setSOff] = useState(0); const [qOff, setQOff] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const seq = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (q: string, st: PortfolioStatus | "", mo: number, so: number, qo: number) => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    const r = await projectPortfolioOverview({ search: q || undefined, status: st || undefined, limit: PAGE,
      master_offset: mo, standalone_offset: so, quick_offset: qo });
    if (!alive.current || my !== seq.current) return;
    if (!r.ok) { setErr(portfolioErr(r.error)); setPhase("error"); return; }
    setData(r.data); setPhase("ready");
    // بحث عن فرع يُظهر رئيسيّه: وسّع كل رئيسيّ يطابق فرعه البحث تلقائيًّا.
    if (q.trim()) setExpanded(new Set(r.data.masters.rows.filter((m) => m.children.some((c) =>
      c.project_name.toLowerCase().includes(q.trim().toLowerCase()) || (c.unit_code ?? "").toLowerCase().includes(q.trim().toLowerCase()))).map((m) => m.id)));
  }, []);
  // البحث يعمل بزرّ/Enter (runSearch)؛ تغيّر الفلتر/أيّ صفحة قسم يعيد التحميل بأحدث بحث.
  useEffect(() => { void load(search, status, mOff, sOff, qOff); }, [load, status, mOff, sOff, qOff]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetPages = () => { setMOff(0); setSOff(0); setQOff(0); };
  const runSearch = () => { resetPages(); void load(search, status, 0, 0, 0); };
  const setFilter = (st: PortfolioStatus | "") => { resetPages(); setStatus(st); };
  const toggle = (id: string) => setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (phase === "loading" && !data) return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className={`${card} p-6 text-center space-y-2`} role="alert">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={() => void load(search, status, mOff, sOff, qOff)} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!data) return null;
  const s = data.summary;

  const FILTERS: [PortfolioStatus | "", string][] = [
    ["", "الكل"], ["late", "المتأخرة"], ["critical", "الحرجة"], ["awaiting_client", "بانتظار العميل"],
    ["near_delivery", "قريبة التسليم"], ["no_manager", "بلا مدير"], ["needs_action", "تحتاج إجرائي"],
  ];

  return (
    <div className="space-y-4">
      {/* الملخّص العلويّ: أربع مجموعات قابلة للنقر */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
        <SummaryGroup ar="البرامج والرئيسية" onClick={() => setFilter("")} active={status === ""}
          rows={[[`${s.programs.programs} برنامج · ${s.programs.masters} رئيسي`, ""], [`${s.programs.units} وحدة/فرع`, ""],
            [`${s.programs.late} متأخر`, s.programs.late ? "#dc2626" : ""], [`${s.programs.critical} حرج`, s.programs.critical ? "#dc2626" : ""],
            [`${s.programs.awaiting_client} ينتظر العميل`, s.programs.awaiting_client ? "#0ea5e9" : ""]]} />
        <SummaryGroup ar="المستقلة القياسية" onClick={() => setFilter("")} active={false}
          rows={[[`${s.standalone.active} نشطة`, "#16a34a"], [`${s.standalone.late} متأخرة`, s.standalone.late ? "#dc2626" : ""],
            [`${s.standalone.awaiting_client} تنتظر العميل`, s.standalone.awaiting_client ? "#0ea5e9" : ""],
            [`${s.standalone.near_delivery} قرب التسليم`, ""], [`${s.standalone.no_manager} بلا مدير`, s.standalone.no_manager ? "#d97706" : ""]]} />
        <SummaryGroup ar="⚡ السريعة" onClick={() => setFilter("")} active={false}
          rows={[[`${s.quick.open} مفتوحة`, "#0d9488"], [`${s.quick.today_tasks} مهمة`, ""],
            [`${s.quick.late} متأخرة`, s.quick.late ? "#dc2626" : ""], [`${s.quick.near_delivery} قرب التسليم`, ""],
            [`${s.quick.ready} جاهزة للتسليم/الإغلاق`, s.quick.ready ? "#16a34a" : ""]]} />
        <SummaryGroup ar="تحتاج تدخلًا" onClick={() => setFilter("needs_action")} active={status === "needs_action"} danger
          rows={[[`${s.needs_intervention.no_manager} بلا مدير`, s.needs_intervention.no_manager ? "#d97706" : ""],
            [`${s.needs_intervention.overdue_tasks} مهام متأخرة`, s.needs_intervention.overdue_tasks ? "#dc2626" : ""],
            [`${s.needs_intervention.critical_health} خطر حرج`, s.needs_intervention.critical_health ? "#dc2626" : ""],
            [`${s.needs_intervention.awaiting_client} مراجعة عميل`, s.needs_intervention.awaiting_client ? "#0ea5e9" : ""],
            [`${s.needs_intervention.overdue_approvals} اعتماد متأخر`, s.needs_intervention.overdue_approvals ? "#d97706" : ""],
            [`${s.needs_intervention.delivered_not_closed} مُسلَّم بلا إغلاق`, s.needs_intervention.delivered_not_closed ? "#d97706" : ""]]} />
      </div>

      {/* أدوات: بحث + فلتر + عرض مجمّع/مسطّح */}
      <div className="flex flex-wrap gap-2 items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") runSearch(); }}
          placeholder={t({ ar: "بحث: رئيسي / فرع / وحدة / كود / عميل / مدير…", en: "Search…" })}
          className="flex-1 min-w-[12rem] bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500" />
        <button onClick={runSearch} className="rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm px-4">{t({ ar: "بحث", en: "Search" })}</button>
        <select value={status} onChange={(e) => setFilter(e.target.value as PortfolioStatus | "")}
          className="bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200" style={{ colorScheme: "dark" }}
          aria-label={t({ ar: "فلتر", en: "Filter" })}>
          {FILTERS.map(([k, ar]) => <option key={k || "all"} value={k}>{ar}</option>)}
        </select>
        <div className="inline-flex rounded-lg border border-stone-700 overflow-hidden">
          <button onClick={() => onView("grouped")} aria-pressed={view === "grouped"}
            className={`px-3 py-2 text-xs ${view === "grouped" ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300"}`}>{t({ ar: "مجمّع", en: "Grouped" })}</button>
          <button onClick={() => onView("flat")} aria-pressed={view === "flat"}
            className={`px-3 py-2 text-xs ${view === "flat" ? "bg-red-600 text-white" : "bg-stone-800 text-stone-300"}`}>{t({ ar: "مسطّح", en: "Flat" })}</button>
        </div>
      </div>

      {view === "grouped" ? (
        <div className="space-y-4">
          <Section title={`البرامج والمشاريع الرئيسية (${data.masters.total})`}>
            {data.masters.rows.length === 0 ? <Empty /> : data.masters.rows.map((m) => (
              <MasterCard key={m.id} m={m} expanded={expanded.has(m.id)} onToggle={() => toggle(m.id)} t={t} search={search} />
            ))}
            <Pager total={data.masters.total} offset={mOff} onPage={setMOff} />
          </Section>
          <Section title={`المشاريع المستقلة (${data.standalone.total})`}>
            {data.standalone.rows.length === 0 ? <Empty /> : data.standalone.rows.map((p) => (
              <Link key={p.id} href={`/client-portal/project-core/${p.id}`} className={`${card} p-3 block hover:border-stone-600`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm text-stone-100 truncate" dir="auto">
                      <Badge b={portfolioBadge("standard")} />{p.is_orphan_child ? <span className="text-[9px] text-stone-500"> ↳ فرع</span> : null} {p.project_name}
                    </p>
                    <p className="text-[11px] text-stone-500 truncate">{p.client_name ?? t({ ar: "بلا عميل", en: "no client" })}{p.manager_name ? ` · ${p.manager_name}` : ` · ${t({ ar: "بلا مدير", en: "no PM" })}`}</p>
                  </div>
                  <RowMeta stage={p.core_stage} health={p.health} due={p.due_date} progress={p.progress_pct} next={p.next_action} t={t} />
                </div>
              </Link>
            ))}
            <Pager total={data.standalone.total} offset={sOff} onPage={setSOff} />
          </Section>
          <Section title={`⚡ المشاريع السريعة (${data.quick.total})`}>
            {data.quick.rows.length === 0 ? <Empty /> : data.quick.rows.map((p) => (
              <Link key={p.id} href={`/client-portal/project-core/${p.id}`} className={`${card} p-3 block hover:border-teal-800`}>
                <div className="flex items-start justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm text-stone-100 truncate" dir="auto"><Badge b={portfolioBadge("quick")} /> {p.project_name}</p>
                    <p className="text-[11px] text-stone-500 truncate">
                      {p.client_name ?? t({ ar: "بلا عميل", en: "no client" })}
                      {p.project_type ? ` · ${p.project_type}` : ""}
                      {p.next_shoot ? ` · ${t({ ar: "جلسة", en: "shoot" })}: ${p.next_shoot.session_date ?? p.next_shoot.title}` : ""}
                    </p>
                  </div>
                  <div className="text-left shrink-0 text-[10px]">
                    <div className="text-stone-400">{stageAr(p.core_stage, t)} · {p.progress_pct}%</div>
                    {p.due_date && <div className="text-stone-500" dir="ltr">⏱ {p.due_date}</div>}
                    <div className="text-teal-300">{portfolioNextAction(p.next_action)}{p.awaiting_client ? ` · ${t({ ar: "ينتظرك العميل", en: "client waiting" })}` : ""}</div>
                  </div>
                </div>
              </Link>
            ))}
            <Pager total={data.quick.total} offset={qOff} onPage={setQOff} />
          </Section>
        </div>
      ) : (
        <FlatList data={data} t={t} />
      )}

    </div>
  );
}

function FlatList({ data, t }: { data: PortfolioOverview; t: (x: { ar: string; en: string }) => string }) {
  // العرض المسطّح: كل المشاريع المصرَّح بها كقائمة واحدة مع شارات النوع.
  const flat: { id: string; name: string; badge: ReturnType<typeof portfolioBadge>; stage: string; health: string; progress: number; due: string | null; next: string; note?: string }[] = [];
  for (const m of data.masters.rows) {
    flat.push({ id: m.id, name: m.project_name, badge: portfolioBadge("master", m.operating_experience), stage: m.core_stage, health: m.health, progress: m.own_progress, due: m.due_date, next: m.next_action });
    for (const c of m.children) flat.push({ id: c.id, name: c.project_name, badge: { ar: "↳ فرعي", color: "#57534e" }, stage: c.core_stage, health: c.health, progress: c.progress_pct, due: c.due_date, next: c.next_action, note: c.unit_code ?? undefined });
  }
  for (const p of data.standalone.rows) flat.push({ id: p.id, name: p.project_name, badge: portfolioBadge("standard"), stage: p.core_stage, health: p.health, progress: p.progress_pct, due: p.due_date, next: p.next_action, note: p.is_orphan_child ? "↳ فرع" : undefined });
  for (const p of data.quick.rows) flat.push({ id: p.id, name: p.project_name, badge: portfolioBadge("quick"), stage: p.core_stage, health: "on_track", progress: p.progress_pct, due: p.due_date, next: p.next_action });
  return (
    <div className="space-y-1.5">
      {flat.map((f) => (
        <Link key={f.id} href={`/client-portal/project-core/${f.id}`} className={`${card} p-3 block hover:border-stone-600`}>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <p className="text-sm text-stone-100 truncate min-w-0" dir="auto">
              <Badge b={f.badge} />{f.note ? <span className="text-[9px] text-stone-500"> {f.note}</span> : null} {f.name}
            </p>
            <RowMeta stage={f.stage} health={f.health} due={f.due} progress={f.progress} next={f.next} t={t} />
          </div>
        </Link>
      ))}
    </div>
  );
}

function MasterCard({ m, expanded, onToggle, t, search }: {
  m: PortfolioMaster; expanded: boolean; onToggle: () => void; t: (x: { ar: string; en: string }) => string; search: string;
}) {
  const q = search.trim().toLowerCase();
  return (
    <div className={`${card} overflow-hidden`} style={{ borderColor: "rgba(124,58,237,0.35)" }}>
      <div className="p-3 flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <Link href={`/client-portal/project-core/${m.id}?tab=${m.operating_experience === "program" ? "program" : "subprojects"}`}
            className="text-sm text-stone-100 hover:text-white truncate block" dir="auto">
            <Badge b={portfolioBadge("master", m.operating_experience)} /> {m.project_name}
          </Link>
          <p className="text-[11px] text-stone-500 truncate">{m.client_name ?? t({ ar: "بلا عميل", en: "no client" })}{m.manager_name ? ` · ${m.manager_name}` : ""}</p>
          <div className="flex flex-wrap gap-2 mt-1 text-[10px]">
            <span style={{ color: HEALTH_CLR[m.health] }}>● {t(HEALTH_LABELS[m.health as PcHealth] ?? { ar: m.health, en: m.health })}</span>
            <span className="text-stone-500">{t({ ar: "إنجاز رئيسي", en: "own" })} {m.own_progress}%</span>
            {m.children_progress != null && <span className="text-stone-500">{t({ ar: "إنجاز الفروع", en: "children" })} {m.children_progress}%</span>}
            <span className="text-stone-400">{m.child_count} {t({ ar: "فرع", en: "units" })}</span>
            {m.late_children > 0 && <span className="text-red-400">{m.late_children} {t({ ar: "متأخر", en: "late" })}</span>}
            {m.critical_children > 0 && <span className="text-red-400">{m.critical_children} {t({ ar: "حرج", en: "critical" })}</span>}
            {m.awaiting_client_children > 0 && <span className="text-sky-400">{m.awaiting_client_children} {t({ ar: "ينتظر العميل", en: "awaiting" })}</span>}
            {m.nearest_due && <span className="text-stone-500" dir="ltr">⏱ {m.nearest_due}</span>}
          </div>
        </div>
        <div className="text-left shrink-0 flex flex-col items-end gap-1">
          <span className="text-[10px] text-stone-400">{portfolioNextAction(m.next_action)}</span>
          {m.child_count > 0 && (
            <button onClick={onToggle} aria-expanded={expanded} className="text-[11px] text-stone-300 border border-stone-700 rounded px-2 py-0.5">
              {expanded ? t({ ar: "طيّ الفروع ▴", en: "Collapse ▴" }) : `${t({ ar: "الفروع", en: "Units" })} (${m.child_count}) ▾`}
            </button>
          )}
        </div>
      </div>
      {expanded && m.children.length > 0 && (
        <div className="border-t border-stone-800 divide-y divide-stone-800/60">
          {m.children.map((c) => {
            const hit = q && (c.project_name.toLowerCase().includes(q) || (c.unit_code ?? "").toLowerCase().includes(q));
            return (
              <Link key={c.id} href={`/client-portal/project-core/${c.id}`}
                className={`flex items-center justify-between gap-2 px-3 py-2 hover:bg-stone-800/40 ${hit ? "bg-amber-950/20" : ""}`}>
                <span className="min-w-0 truncate text-[12px] text-stone-200" dir="auto">
                  <span className="text-[9px] text-stone-500">↳ فرعي</span>
                  {c.unit_number != null ? <span className="text-stone-500"> #{c.unit_number}</span> : null}
                  {c.unit_code ? <span className="text-[9px] text-stone-600" dir="ltr"> {c.unit_code}</span> : null} {c.project_name}
                </span>
                <span className="flex items-center gap-2 shrink-0 text-[10px]">
                  <span style={{ color: HEALTH_CLR[c.health] }}>●</span>
                  <span className="text-stone-500">{c.progress_pct}%</span>
                  <span className="text-stone-400">{stageAr(c.core_stage, t)}</span>
                  {c.late && <span className="text-red-400">{t({ ar: "متأخر", en: "late" })}</span>}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Badge({ b }: { b: { ar: string; color: string } }) {
  return <span className="text-[9px] px-1.5 py-0.5 rounded align-middle" style={{ background: b.color + "22", color: b.color }}>{b.ar}</span>;
}
function RowMeta({ stage, health, due, progress, next, t }: { stage: string; health: string; due: string | null; progress: number; next: string; t: (x: { ar: string; en: string }) => string }) {
  return (
    <div className="text-left shrink-0 text-[10px]">
      <div className="text-stone-400">{stageAr(stage, t)} · {progress}%</div>
      <div style={{ color: HEALTH_CLR[health] ?? "#78716c" }}>● {t(HEALTH_LABELS[health as PcHealth] ?? { ar: health, en: health })}</div>
      {due && <div className="text-stone-500" dir="ltr">⏱ {due}</div>}
      <div className="text-stone-400">{portfolioNextAction(next)}</div>
    </div>
  );
}
function SummaryGroup({ ar, rows, onClick, active, danger }: { ar: string; rows: [string, string][]; onClick: () => void; active: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`${card} p-3 text-right transition ${active ? "ring-2 ring-red-500 border-red-600" : "hover:border-stone-600"} ${danger ? "border-amber-900/50" : ""}`}>
      <div className="text-xs font-semibold text-stone-200 mb-1">{ar}</div>
      <div className="space-y-0.5">
        {rows.map(([txt, clr], i) => <div key={i} className="text-[10px]" style={{ color: clr || "#a8a29e" }}>{txt}</div>)}
      </div>
    </button>
  );
}
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-xs font-semibold text-stone-300">{title}</h3>
      {children}
    </section>
  );
}
function Empty() { const { t } = useI18n(); return <p className="text-[11px] text-stone-600 py-3 text-center">{t({ ar: "لا مشاريع في هذا القسم.", en: "No projects." })}</p>; }
function Pager({ total, offset, onPage }: { total: number; offset: number; onPage: (o: number) => void }) {
  const { t } = useI18n();
  if (total <= PAGE) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-xs pt-1">
      <button disabled={offset === 0} onClick={() => onPage(Math.max(0, offset - PAGE))} className="text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">‹ {t({ ar: "السابق", en: "Prev" })}</button>
      <span className="text-stone-500">{offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
      <button disabled={offset + PAGE >= total} onClick={() => onPage(offset + PAGE)} className="text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "التالي", en: "Next" })} ›</button>
    </div>
  );
}
