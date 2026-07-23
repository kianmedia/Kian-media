"use client";
// ════════════════════════════════════════════════════════════════════════════
// HierarchyTree — Batch 6B. عرض شجريّ للمشاريع: المستقلة عادية، والرئيسية قابلة
// للطيّ/التوسيع مع فروعها. البيانات مصفّاة من الخادم (project_hierarchy_tree)،
// والفروع تُجلب عند التوسيع فقط (Lazy) عبر project_subprojects_summary القائمة.
// بنية البطاقة: <div> خارجي + رابط على العنوان فقط ⇒ لا زرّ داخل <a> (HTML صالح).
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { projectSubprojectsSummary, PC_STAGE_LABELS, HEALTH_LABELS, type Subproject, type PcStage, type PcHealth } from "@/lib/portal/projectCore";
import { projectHierarchyTree, SCOPE_LABELS, SCOPE_COLOR, hierErr, type TreeRow, type ProjectScope } from "@/lib/portal/projectHierarchy";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const HEALTH_CLR: Record<string, string> = { on_track: "#16a34a", at_risk: "#d97706", off_track: "#dc2626" };
type ScopeFilter = "all" | "standalone" | "master" | "subproject";
const SCOPE_TABS: { k: ScopeFilter; ar: string; en: string }[] = [
  { k: "all", ar: "الكل", en: "All" }, { k: "standalone", ar: "مستقل", en: "Standalone" },
  { k: "master", ar: "رئيسي", en: "Master" }, { k: "subproject", ar: "فرعي", en: "Subproject" },
];

export default function HierarchyTree({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<TreeRow[]>([]);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [delayed, setDelayed] = useState(false);
  const [critical, setCritical] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const childFiltersOff = scope === "standalone" || scope === "subproject";   // لا فروع في هذين النطاقين
  const reqSeq = useRef(0); const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++reqSeq.current; setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        projectHierarchyTree({ scope, search: applied || undefined, has_delayed_children: delayed, has_critical_children: critical, limit: 50, offset }),
        new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("tree_timeout")), 20000); }),
      ]);
      if (!mountedRef.current || my !== reqSeq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[hierarchy-tree]", r.error); setErr(hierErr(r.error)); setPhase("error"); return; }
      setRows(r.data.rows ?? []); setHasMore(!!r.data.has_more); setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(e instanceof Error && e.message === "tree_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : hierErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [scope, applied, delayed, critical, offset, t]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center overflow-auto p-2 sm:p-4" onClick={onClose}>
      <div className="w-full max-w-4xl bg-stone-950 border border-stone-800 rounded-2xl my-2" dir="rtl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-3 border-b border-stone-800 sticky top-0 bg-stone-950 z-10">
          <h3 className="text-sm font-semibold text-stone-100">{t({ ar: "شجرة المشاريع", en: "Project tree" })}</h3>
          <button onClick={onClose} className="text-stone-400 hover:text-white text-lg" aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>

        {/* فلاتر Server-side */}
        <div className="p-3 space-y-2 border-b border-stone-800">
          <div className="flex gap-1 flex-wrap" role="tablist" aria-label={t({ ar: "نوع المشروع", en: "Scope" })}>
            {SCOPE_TABS.map((s) => (
              <button key={s.k} role="tab" aria-selected={scope === s.k}
                onClick={() => {
                  setScope(s.k); setOffset(0);
                  // «فروع متأخرة/حرجة» بلا معنى لنطاق لا يملك فروعًا ⇒ تُمسح بدل نتيجة فارغة دائمة.
                  if (s.k === "standalone" || s.k === "subproject") { setDelayed(false); setCritical(false); }
                }}
                className={`text-[11px] px-3 py-1 rounded-lg border ${scope === s.k ? "bg-stone-800 border-sky-700 text-white" : "bg-stone-900 border-stone-700 text-stone-400 hover:text-white"}`}>
                {t({ ar: s.ar, en: s.en })}
              </button>
            ))}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { setApplied(search.trim()); setOffset(0); } }}
              placeholder={t({ ar: "بحث (يشمل اسم الفرع)…", en: "Search (includes child names)…" })}
              className="flex-1 min-w-[160px] bg-stone-900 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200" />
            <button onClick={() => { setApplied(search.trim()); setOffset(0); }} className="text-[11px] text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5">{t({ ar: "بحث", en: "Search" })}</button>
            <label className={`flex items-center gap-1 text-[11px] ${childFiltersOff ? "text-stone-600" : "text-stone-400"}`}><input type="checkbox" disabled={childFiltersOff} checked={delayed} onChange={(e) => { setDelayed(e.target.checked); setOffset(0); }} />{t({ ar: "فروع متأخرة", en: "Delayed children" })}</label>
            <label className={`flex items-center gap-1 text-[11px] ${childFiltersOff ? "text-stone-600" : "text-stone-400"}`}><input type="checkbox" disabled={childFiltersOff} checked={critical} onChange={(e) => { setCritical(e.target.checked); setOffset(0); }} />{t({ ar: "فروع حرجة", en: "Critical children" })}</label>
          </div>
        </div>

        <div className="p-3 space-y-1.5">
          {phase === "loading" && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
          {phase === "error" && (
            <div className="py-8 text-center space-y-2">
              <p className="text-sm text-red-300">{err || t({ ar: "تعذّر التحميل.", en: "Failed." })}</p>
              <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة", en: "Retry" })}</button>
            </div>
          )}
          {phase === "ready" && rows.length === 0 && <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "لا مشاريع مطابقة.", en: "No matching projects." })}</p>}
          {phase === "ready" && rows.map((r) => <TreeNode key={r.project_id} row={r} />)}

          {phase === "ready" && (offset > 0 || hasMore) && (
            <div className="flex items-center justify-between pt-2">
              <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "السابق", en: "Prev" })}</button>
              <span className="text-[10px] text-stone-600">{t({ ar: "من", en: "from" })} {offset + 1}</span>
              <button disabled={!hasMore} onClick={() => setOffset(offset + 50)} className="text-[11px] text-stone-300 border border-stone-700 rounded px-3 py-1 disabled:opacity-40">{t({ ar: "التالي", en: "Next" })}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// عقدة الشجرة — بطاقة <div> والرابط على العنوان فقط (لا زرّ داخل <a>).
function TreeNode({ row }: { row: TreeRow }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [kids, setKids] = useState<Subproject[] | null>(null);
  const [kidsErr, setKidsErr] = useState("");
  const [loadingKids, setLoadingKids] = useState(false);
  const isMaster = row.project_scope === "master";
  const panelId = `subtree-${row.project_id}`;

  const loadKids = useCallback(async () => {
    if (loadingKids) return;                    // حارس الطلب الجاري: طيّ/توسيع سريع كان يُطلق نداءين
    setLoadingKids(true); setKidsErr("");
    const r = await projectSubprojectsSummary(row.project_id);
    setLoadingKids(false);
    // فشل الجلب لا يُخزَّن كـ«لا فروع»: تبقى kids=null ليُعاد المحاولة، ويُعرض الخطأ صراحةً.
    if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[hierarchy-kids]", r.error); setKidsErr(hierErr(r.error)); return; }
    setKids(r.data.subprojects ?? []);
  }, [loadingKids, row.project_id]);

  async function toggle() {
    const next = !open; setOpen(next);
    if (next && kids === null && !loadingKids) await loadKids();   // Lazy: تُجلب مرّة واحدة عند أول توسيع
  }

  return (
    <div className={card}>
      <div className="p-3">
        <div className="flex items-start gap-2">
          {isMaster ? (
            <button onClick={() => void toggle()} aria-expanded={open} aria-controls={panelId}
              className="shrink-0 w-6 h-6 rounded border border-stone-700 text-stone-300 hover:text-white text-xs leading-none"
              aria-label={open ? t({ ar: "طيّ الفروع", en: "Collapse" }) : t({ ar: "توسيع الفروع", en: "Expand" })}>
              {open ? "▾" : "▸"}
            </button>
          ) : <span className="shrink-0 w-6" aria-hidden="true" />}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/client-portal/project-core/${row.project_id}`} className="text-sm text-stone-100 hover:text-sky-300 truncate max-w-[240px]" dir="auto">
                {row.project_name || t({ ar: "بلا اسم", en: "Untitled" })}
              </Link>
              {/* النوع نصًّا لا لونًا فقط */}
              <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: SCOPE_COLOR[row.project_scope] + "22", color: SCOPE_COLOR[row.project_scope] }}>
                {t(SCOPE_LABELS[row.project_scope as ProjectScope])}
              </span>
              {isMaster && <span className="text-[10px] text-stone-400">{row.children_total} {t({ ar: "فرع", en: "children" })}</span>}
            </div>
            <div className="text-[11px] text-stone-500 truncate">{row.client_name || t({ ar: "بلا عميل", en: "No client" })}{row.manager_name ? ` · ${t({ ar: "مدير", en: "PM" })}: ${row.manager_name}` : ` · ${t({ ar: "بلا مدير", en: "no PM" })}`}</div>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px]">
              {row.core_stage && <span className="px-1.5 py-0.5 rounded bg-stone-800 text-stone-300">{t(PC_STAGE_LABELS[row.core_stage as PcStage] ?? { ar: row.core_stage, en: row.core_stage })}</span>}
              {row.health && <span style={{ color: HEALTH_CLR[row.health] ?? "#78716c" }}>● {t(HEALTH_LABELS[row.health as PcHealth] ?? { ar: row.health, en: row.health })}</span>}
              {row.due_date && <span className="text-stone-500" dir="ltr">⏱ {row.due_date}</span>}
              {row.open_tasks > 0 && <span className="text-stone-400">{row.open_tasks} {t({ ar: "مهمة", en: "tasks" })}</span>}
              {isMaster && row.children_delayed > 0 && <span className="text-red-400">{row.children_delayed} {t({ ar: "فرع متأخر", en: "delayed" })}</span>}
              {isMaster && row.children_critical > 0 && <span className="text-red-400">{row.children_critical} {t({ ar: "فرع حرج", en: "critical" })}</span>}
              {isMaster && row.children_active > 0 && <span className="text-emerald-400">{row.children_active} {t({ ar: "نشط", en: "active" })}</span>}
            </div>
          </div>

          <div className="shrink-0 text-left">
            <div className="text-xs text-stone-400" dir="ltr">{row.progress_pct}%</div>
            <div className="w-16 h-1.5 bg-stone-800 rounded mt-1 overflow-hidden"><div className="h-full bg-red-600" style={{ width: `${row.progress_pct}%` }} /></div>
          </div>
        </div>
      </div>

      {isMaster && open && (
        <div id={panelId} className="border-t border-stone-800 bg-stone-950/60 px-3 py-2 space-y-1">
          {loadingKids && <p className="text-[11px] text-stone-500">{t({ ar: "جارٍ تحميل الفروع…", en: "Loading children…" })}</p>}
          {!loadingKids && kidsErr && (
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[11px] text-red-300">{kidsErr}</p>
              <button onClick={() => void loadKids()} className="text-[10px] text-stone-200 border border-stone-700 rounded px-2 py-0.5">{t({ ar: "إعادة", en: "Retry" })}</button>
            </div>
          )}
          {!loadingKids && !kidsErr && kids !== null && kids.length === 0 && (
            <p className="text-[11px] text-stone-500">{t({ ar: "لا مشاريع فرعية بعد — افتح المشروع لإضافة فرع.", en: "No subprojects yet — open the project to add one." })}</p>
          )}
          {!loadingKids && (kids ?? []).map((k) => (
            <div key={k.project_id} className="flex items-center gap-2 text-[11px] border-r-2 border-sky-900 pr-2 py-0.5">
              <span className="text-[9px] text-stone-600">↳</span>
              <Link href={`/client-portal/project-core/${k.project_id}`} className="text-stone-200 hover:text-sky-300 truncate max-w-[200px]" dir="auto">{k.name}</Link>
              {k.core_stage && <span className="text-stone-500">{t(PC_STAGE_LABELS[k.core_stage as PcStage] ?? { ar: k.core_stage, en: k.core_stage })}</span>}
              {k.health && <span style={{ color: HEALTH_CLR[k.health] ?? "#78716c" }}>● {t(HEALTH_LABELS[k.health as PcHealth] ?? { ar: k.health, en: k.health })}</span>}
              <span className="text-stone-400">{k.progress_pct}%</span>
              {(k.critical_risks ?? 0) > 0 && <span className="text-red-400">{t({ ar: "مخاطر", en: "risks" })} {k.critical_risks}</span>}
              <span className="text-stone-600 ms-auto">{k.manager_name ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
