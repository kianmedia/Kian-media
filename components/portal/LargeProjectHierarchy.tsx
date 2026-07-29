"use client";
// ════════════════════════════════════════════════════════════════════════════
// LargeProjectHierarchy — الشجرة + فتات الخبز.
//
// نموذج العمق (القرار موثَّق في lib/portal/large-projects.ts §9):
//   مشروع رئيسيّ  →  مشروع فرعيّ (مرحلة)  →  مجموعة داخل المرحلة  →  مخرج
// المستويان الأوّلان حقيقيّان في قاعدة البيانات (projects.parent_project_id).
// المستوى الثالث **مجموعة** لا مشروع: المنصّة تمنع بنيويًّا أن يكون الفرع أبًا
// (parent_must_be_master + only_standalone_can_be_promoted)، وفتحه يمسّ ما يقارب
// خمسين سياسة RLS والتجميعات والإغلاق. لذلك لا نُسطّح البيانات ولا نفقد العلاقة
// الأصلية: المخرج يبقى مرتبطًا بمشروعه الفرعيّ، والمجموعة بُعد تجميع داخله.
// ════════════════════════════════════════════════════════════════════════════
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  lpGroupByStage, lpGroupOf, lpProgress, lpCounters, lpTodayISO, LP_HIERARCHY_MAX_DEPTH,
  type LpDeliverable, type LpStage, type LpSnapshot,
} from "@/lib/portal/large-projects";
import {
  lpCard, LpNotice, LpProgressBar, LargeProjectBreadcrumbs,
} from "@/components/portal/LargeProjectAtoms";

export default function LargeProjectHierarchy({
  snapshot, onFocusStage,
}: {
  snapshot: LpSnapshot;
  onFocusStage?: (projectId: string) => void;
}) {
  const { t } = useI18n();
  const today = useMemo(() => lpTodayISO(), []);
  const byStage = useMemo(() => lpGroupByStage(snapshot.deliverables), [snapshot.deliverables]);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  const crumbs = useMemo(() => {
    const list: { id: string; label: string }[] = [];
    if (snapshot.parent) list.push({ id: snapshot.parent.id, label: snapshot.parent.project_name ?? "—" });
    list.push({ id: snapshot.project.id, label: snapshot.project.project_name ?? "—" });
    return list;
  }, [snapshot.parent, snapshot.project]);

  const master = snapshot.stages.find((s) => s.is_master);
  const children = snapshot.stages.filter((s) => !s.is_master);

  return (
    <div className="space-y-2">
      <LargeProjectBreadcrumbs items={crumbs} />

      {!snapshot.caps.hierarchy && (
        <LpNotice kind="info">
          {t({
            ar: "أعمدة الهرمية غير مطبّقة في قاعدة البيانات — تُعرض بيانات هذا المشروع وحده بلا مراحل فرعية.",
            en: "Hierarchy columns are not deployed — showing this project alone, without subprojects.",
          })}
        </LpNotice>
      )}

      {master && (
        <NodeCard
          title={master.name ?? "—"}
          subtitle={t({ ar: "مشروع رئيسيّ", en: "Master project" })}
          rows={byStage.get(master.project_id) ?? []}
          today={today}
          onFocus={onFocusStage ? () => onFocusStage(master.project_id) : undefined}
          level={0}
        />
      )}

      {children.length === 0 && snapshot.caps.hierarchy && (
        <div className={`${lpCard} p-4 text-center text-[11px] text-stone-500`}>
          {t({ ar: "لا مراحل (مشاريع فرعية) تحت هذا المشروع.", en: "No stages (subprojects) under this project." })}
        </div>
      )}

      {children.map((s) => {
        const rows = byStage.get(s.project_id) ?? [];
        const isOpen = open[s.project_id] === true;
        return (
          <div key={s.project_id} className="space-y-1">
            <NodeCard
              title={s.name ?? "—"}
              subtitle={t({ ar: "مرحلة (مشروع فرعيّ)", en: "Stage (subproject)" })}
              rows={rows}
              today={today}
              onFocus={onFocusStage ? () => onFocusStage(s.project_id) : undefined}
              level={1}
              expandable
              expanded={isOpen}
              onToggle={() => setOpen((p) => ({ ...p, [s.project_id]: !p[s.project_id] }))}
            />
            {isOpen && <GroupList stage={s} rows={rows} today={today} />}
          </div>
        );
      })}

      <p className="text-[10px] text-stone-600 leading-relaxed px-1">
        {t({
          ar: `عمق الهرمية في المنصّة مستويان (${LP_HIERARCHY_MAX_DEPTH}) بقرار موثَّق: الفرع لا يصلح أبًا في قاعدة البيانات. المستوى الثالث يُمثَّل كمجموعة داخل المرحلة، ويبقى ارتباط المخرج بمشروعه الفرعيّ كما هو.`,
          en: `Platform hierarchy depth is ${LP_HIERARCHY_MAX_DEPTH} by a documented decision: a subproject cannot be a parent in the database. The third level is a group inside the stage; the deliverable keeps its real subproject link.`,
        })}
      </p>
    </div>
  );
}

function NodeCard({
  title, subtitle, rows, today, onFocus, level, expandable, expanded, onToggle,
}: {
  title: string; subtitle: string; rows: LpDeliverable[]; today: string;
  onFocus?: () => void; level: number;
  expandable?: boolean; expanded?: boolean; onToggle?: () => void;
}) {
  const { t } = useI18n();
  const progress = useMemo(() => lpProgress(rows), [rows]);
  const counters = useMemo(() => lpCounters(rows, today), [rows, today]);
  return (
    <div className={`${lpCard} p-2.5 sm:p-3`} style={{ marginInlineStart: level === 0 ? 0 : 12 }}>
      <div className="flex items-start gap-2">
        {expandable ? (
          <button type="button" onClick={onToggle} aria-expanded={!!expanded}
            className="shrink-0 w-6 h-6 rounded border border-stone-700 text-stone-300 text-xs leading-none"
            aria-label={expanded ? t({ ar: "طيّ", en: "Collapse" }) : t({ ar: "توسيع", en: "Expand" })}>
            {expanded ? "▾" : "▸"}
          </button>
        ) : <span className="shrink-0 w-6" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-stone-100 truncate max-w-[200px] sm:max-w-none" dir="auto">{title}</span>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{subtitle}</span>
            {onFocus && (
              <button type="button" onClick={onFocus} className="text-[10px] text-sky-300 hover:text-sky-200 underline">
                {t({ ar: "عرض مخرجاتها", en: "Show its deliverables" })}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-1 text-[10px] text-stone-500">
            <span>{t({ ar: "مخرجات", en: "deliverables" })}: <span dir="ltr">{counters.total}</span></span>
            {counters.awaiting_schedule > 0 && (
              <span className="text-sky-300">{t({ ar: "بانتظار الجدولة", en: "awaiting schedule" })}: <span dir="ltr">{counters.awaiting_schedule}</span></span>
            )}
            {counters.overdue > 0 && (
              <span className="text-red-300">{t({ ar: "متأخّر", en: "overdue" })}: <span dir="ltr">{counters.overdue}</span></span>
            )}
          </div>
          <div className="mt-1"><LpProgressBar progress={progress} /></div>
        </div>
      </div>
    </div>
  );
}

/** المستوى الثالث: مجموعات داخل المرحلة (وليس مشاريع). */
function GroupList({ stage, rows, today }: { stage: LpStage; rows: LpDeliverable[]; today: string }) {
  const { t } = useI18n();
  const groups = useMemo(() => {
    const m = new Map<string, LpDeliverable[]>();
    for (const d of rows) {
      const key = lpGroupOf(d) ?? "__ungrouped__";
      const arr = m.get(key);
      if (arr) arr.push(d); else m.set(key, [d]);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [rows]);

  if (rows.length === 0) {
    return (
      <p className="text-[10px] text-stone-600 ps-10">
        {t({ ar: "لا مخرجات في هذه المرحلة — التقدّم «غير متاح» ولا يؤثّر في نسبة المشروع.", en: "No deliverables in this stage — progress is N/A and does not affect the project." })}
      </p>
    );
  }
  // مجموعة واحدة بلا اسم = لا تجميع داخل المرحلة أصلًا ⇒ لا مستوى ثالث يُعرَض.
  if (groups.length === 1 && groups[0][0] === "__ungrouped__") {
    return (
      <p className="text-[10px] text-stone-600 ps-10">
        {t({ ar: "لا مجموعات داخل هذه المرحلة — المخرجات مباشرة تحتها.", en: "No groups inside this stage — deliverables sit directly under it." })}
      </p>
    );
  }

  return (
    <div className="space-y-1 ps-10">
      {groups.map(([key, list]) => {
        const progress = lpProgress(list);
        const counters = lpCounters(list, today);
        return (
          <div key={`${stage.project_id}:${key}`} className="flex items-center gap-2 flex-wrap text-[10px] border-e-2 border-sky-900 pe-2 py-0.5">
            <span className="text-stone-600" aria-hidden="true">↳</span>
            <span className="text-stone-200 truncate max-w-[160px]" dir="auto">
              {key === "__ungrouped__" ? t({ ar: "بلا مجموعة", en: "Ungrouped" }) : key}
            </span>
            <span className="text-stone-500"><span dir="ltr">{counters.total}</span> {t({ ar: "مخرج", en: "items" })}</span>
            {counters.awaiting_schedule > 0 && <span className="text-sky-300"><span dir="ltr">{counters.awaiting_schedule}</span> {t({ ar: "بانتظار الجدولة", en: "awaiting" })}</span>}
            {counters.overdue > 0 && <span className="text-red-300"><span dir="ltr">{counters.overdue}</span> {t({ ar: "متأخّر", en: "overdue" })}</span>}
            <span className="ms-auto"><LpProgressBar progress={progress} compact /></span>
          </div>
        );
      })}
    </div>
  );
}
