"use client";
// ════════════════════════════════════════════════════════════════════════════
// DeliverableMatrix — جدول المخرجات المصفّى + التحديد + الإجراءات الجماعية.
//
// الأداء (المطلوب: مئتا مخرج بلا تهدّج):
//   • الترشيح في useMemo واحد بتمريرة O(n) — لا بحث متداخل.
//   • خرائط (Map) للمرحلة والمسؤول تُبنى مرّة، لا .find() داخل .map().
//   • صفّ الجدول memo وخصائصه بدائية (نصّ/منطقيّ) ⇒ تغيير التحديد يُعيد رسم
//     الصفّ المتغيّر وحده، لا القائمة كلّها.
//   • عرض متدرّج (50 صفًّا ثم «عرض المزيد») لتقييد DOM على الجوال.
//
// السلامة: تغيير أيّ فلتر يمسح التحديد. الإجراء الجماعيّ لا يقع أبدًا على صفوف
// خارج ما يراه المستخدم الآن، والعدد المعروض هو العدد المتأثّر بالضبط.
// ════════════════════════════════════════════════════════════════════════════
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
// ملاحظة على النصّ الحرّ: `execution_details` و`proposed_caption` و
// `internal_notes` كانت تُجلَب في اللقطة ولا تُعرض في أيّ شاشة على الإطلاق.
// ملفّات التعيين في docs/import_profiles تستورد الحقول الثلاثة، والـSQL المطبَّق
// (project_bulk_import_RUNME.sql §4) يكتب الأوّلَين على public.deliverables
// والثالث على public.deliverable_internal — فكانت الخطّة المستورَدة تصل قائمةَ
// عناوين بلا بريف تنفيذ ولا نصّ منشور ولا ملاحظات. تُعرض الآن للقراءة فقط، من
// البيانات المجلوبة أصلًا: بلا طلب جديد، وبلا عمود جديد.
import { useI18n } from "@/lib/i18n";
import {
  lpFilter, lpFiltersActive, lpGroupsOf, lpStageIdOf, lpPlatformsOf, lpTypesOf, lpTodayISO,
  lpIsRecurring, lpGroupOf, lpTypeOf, LP_STATUSES, LP_STATUS_LABELS, LP_PRIORITIES, LP_PRIORITY_LABELS,
  LP_REQUIREMENTS, LP_REQUIREMENT_LABELS, LP_UNASSIGNED,
  type LpDeliverable, type LpFilters, type LpStage, type LpCapabilities, type LpRequirement,
  type LpBulkOutcome,
} from "@/lib/portal/large-projects";
import {
  lpCard, LpNotice, DeliverableStatusBadge, DeliverableScheduleBadge, DeliverablePriorityBadge,
} from "@/components/portal/LargeProjectAtoms";
import LargeProjectBulkBar, { DeliverableBulkReport } from "@/components/portal/LargeProjectBulkBar";

const PAGE = 50;

export default function DeliverableMatrix({
  rows, stages, caps, staff, filters, onFilters, onChanged, truncated,
}: {
  rows: LpDeliverable[];
  stages: LpStage[];
  caps: LpCapabilities;
  staff: { id: string; full_name: string | null }[];
  filters: LpFilters;
  onFilters: (f: LpFilters) => void;
  onChanged: () => void;
  truncated?: boolean;
}) {
  const { t } = useI18n();
  const today = useMemo(() => lpTodayISO(), []);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState(PAGE);
  const [showFilters, setShowFilters] = useState(false);
  // تقرير آخر إجراء جماعيّ يعيش هنا لا داخل الشريط: تفريغ التحديد بعد التنفيذ
  // يُخفي الشريط، ولو كان التقرير بداخله لضاع الفشل الجزئيّ قبل أن يُقرأ.
  const [lastOutcome, setLastOutcome] = useState<LpBulkOutcome | null>(null);

  const filtered = useMemo(() => lpFilter(rows, filters, today), [rows, filters, today]);

  // مفتاح الفلاتر: أيّ تغيير يمسح التحديد ويعيد الصفحة إلى أوّلها.
  const filterKey = JSON.stringify(filters);
  useEffect(() => { setSelected(new Set()); setShown(PAGE); }, [filterKey]);

  // التحديد يُقلَّم عند تغيّر مجموعة الصفوف (حذف/تحديث) — لا يبقى مُعرّف يتيم.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(rows.map((r) => r.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => { if (live.has(id)) next.add(id); else changed = true; });
      return changed ? next : prev;
    });
  }, [rows]);

  const stageName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stages) m.set(s.project_id, s.name ?? "—");
    return m;
  }, [stages]);
  const staffName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staff) m.set(s.id, s.full_name ?? s.id.slice(0, 8));
    return m;
  }, [staff]);

  const groups = useMemo(() => lpGroupsOf(rows), [rows]);
  const platforms = useMemo(() => lpPlatformsOf(rows), [rows]);
  const types = useMemo(() => lpTypesOf(rows), [rows]);

  const toggleOne = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const selectAllFiltered = useCallback(() => setSelected(new Set(filtered.map((d) => d.id))), [filtered]);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const patch = useCallback((p: Partial<LpFilters>) => onFilters({ ...filters, ...p }), [filters, onFilters]);
  const toggleIn = useCallback((key: "statuses" | "types" | "platforms" | "priorities", v: string) => {
    const cur = filters[key] ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onFilters({ ...filters, [key]: next.length ? next : undefined });
  }, [filters, onFilters]);
  const toggleReq = useCallback((v: LpRequirement) => {
    const cur = filters.requires ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onFilters({ ...filters, requires: next.length ? next : undefined });
  }, [filters, onFilters]);

  const activeCount = lpFiltersActive(filters);
  const visible = filtered.slice(0, shown);
  const selectedIds = useMemo(() => filtered.filter((d) => selected.has(d.id)).map((d) => d.id), [filtered, selected]);

  return (
    <div className="space-y-2">
      {/* ── شريط الفلاتر ── */}
      <div className={`${lpCard} p-2 sm:p-3 space-y-2`}>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={filters.search ?? ""}
            onChange={(e) => patch({ search: e.target.value || undefined })}
            placeholder={t({ ar: "بحث في العنوان/المفتاح/المجموعة…", en: "Search title / key / group…" })}
            className="flex-1 min-w-[150px] bg-stone-950 border border-stone-700 rounded-lg px-3 py-1.5 text-xs text-stone-200"
          />
          <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
            className="text-[11px] text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-3 py-1.5 whitespace-nowrap">
            {t({ ar: "الفلاتر", en: "Filters" })}{activeCount ? ` (${activeCount})` : ""}
          </button>
          {activeCount > 0 && (
            <button type="button" onClick={() => onFilters({})}
              className="text-[11px] text-stone-400 hover:text-white border border-stone-800 rounded-lg px-2 py-1.5 whitespace-nowrap">
              {t({ ar: "مسح", en: "Clear" })}
            </button>
          )}
        </div>

        {/* مفاتيح سريعة — دائمة الظهور لأنها الأكثر استعمالًا */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip on={!!filters.awaitingSchedule} onClick={() => patch({ awaitingSchedule: filters.awaitingSchedule ? undefined : true })}
            tone="info" label={t({ ar: "بانتظار الجدولة", en: "Awaiting schedule" })} />
          <Chip on={!!filters.overdue} onClick={() => patch({ overdue: filters.overdue ? undefined : true })}
            tone="danger" label={t({ ar: "متأخّر", en: "Overdue" })} />
          <Chip on={!!filters.waitingForClient} onClick={() => patch({ waitingForClient: filters.waitingForClient ? undefined : true })}
            label={t({ ar: "لدى العميل", en: "With client" })} />
          <Chip on={!!filters.recurring} onClick={() => patch({ recurring: filters.recurring ? undefined : true })}
            label={t({ ar: "متكرّر", en: "Recurring" })} disabled={!caps.columns.recurrence_type}
            hint={t({ ar: "يحتاج الترحيلة", en: "needs migration" })} />
        </div>

        {showFilters && (
          <div className="space-y-2 pt-1 border-t border-stone-800">
            <Row label={t({ ar: "المرحلة", en: "Stage" })}>
              <select value={filters.stageIds?.[0] ?? ""} onChange={(e) => patch({ stageIds: e.target.value ? [e.target.value] : undefined })}
                className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200 max-w-[220px]">
                <option value="">{t({ ar: "كل المراحل", en: "All stages" })}</option>
                {stages.map((s) => <option key={s.project_id} value={s.project_id}>{s.name ?? s.project_id.slice(0, 8)}</option>)}
              </select>
            </Row>

            {groups.length > 0 && (
              <Row label={t({ ar: "المجموعة", en: "Group" })}>
                <select value={filters.stageGroups?.[0] ?? ""} onChange={(e) => patch({ stageGroups: e.target.value ? [e.target.value] : undefined })}
                  className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200 max-w-[220px]">
                  <option value="">{t({ ar: "كل المجموعات", en: "All groups" })}</option>
                  {groups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </Row>
            )}

            <Row label={t({ ar: "الحالة", en: "Status" })}>
              {LP_STATUSES.map((s) => (
                <Chip key={s} on={(filters.statuses ?? []).includes(s)} onClick={() => toggleIn("statuses", s)} label={t(LP_STATUS_LABELS[s])} />
              ))}
            </Row>

            <Row label={t({ ar: "النوع", en: "Type" })}>
              {types.length === 0 && <span className="text-[10px] text-stone-600">{t({ ar: "لا أنواع", en: "none" })}</span>}
              {types.map((ty) => <Chip key={ty} on={(filters.types ?? []).includes(ty)} onClick={() => toggleIn("types", ty)} label={ty} />)}
            </Row>

            <Row label={t({ ar: "المنصّة", en: "Platform" })}>
              {!caps.columns.platforms && <span className="text-[10px] text-stone-600">{t({ ar: "يحتاج الترحيلة", en: "needs migration" })}</span>}
              {caps.columns.platforms && platforms.length === 0 && <span className="text-[10px] text-stone-600">{t({ ar: "لا منصّات مسجَّلة", en: "none recorded" })}</span>}
              {platforms.map((p) => <Chip key={p} on={(filters.platforms ?? []).includes(p)} onClick={() => toggleIn("platforms", p)} label={p} />)}
            </Row>

            <Row label={t({ ar: "المسؤول", en: "Assignee" })}>
              <select value={filters.assignees?.[0] ?? ""} onChange={(e) => patch({ assignees: e.target.value ? [e.target.value] : undefined })}
                className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200 max-w-[220px]">
                <option value="">{t({ ar: "الجميع", en: "Anyone" })}</option>
                <option value={LP_UNASSIGNED}>{t({ ar: "بلا مسؤول", en: "Unassigned" })}</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name ?? s.id.slice(0, 8)}</option>)}
              </select>
            </Row>

            <Row label={t({ ar: "الأولوية", en: "Priority" })}>
              {!caps.columns.priority && <span className="text-[10px] text-stone-600">{t({ ar: "يحتاج الترحيلة", en: "needs migration" })}</span>}
              {caps.columns.priority && LP_PRIORITIES.map((p) => (
                <Chip key={p} on={(filters.priorities ?? []).includes(p)} onClick={() => toggleIn("priorities", p)} label={t(LP_PRIORITY_LABELS[p])} />
              ))}
            </Row>

            <Row label={t({ ar: "ظهور العميل", en: "Client visibility" })}>
              {!caps.columns.client_visible ? (
                <span className="text-[10px] text-stone-600">{t({ ar: "يحتاج الترحيلة", en: "needs migration" })}</span>
              ) : (
                <select value={filters.clientVisibility ?? "any"} onChange={(e) => patch({ clientVisibility: e.target.value as LpFilters["clientVisibility"] })}
                  className="bg-stone-950 border border-stone-700 rounded-lg px-2 py-1 text-[11px] text-stone-200">
                  <option value="any">{t({ ar: "الكل", en: "Any" })}</option>
                  <option value="visible">{t({ ar: "ظاهر للعميل", en: "Visible" })}</option>
                  <option value="hidden">{t({ ar: "مخفيّ عن العميل", en: "Hidden" })}</option>
                </select>
              )}
            </Row>

            <Row label={t({ ar: "المتطلّبات", en: "Requirements" })}>
              {!caps.columns.requires_shooting ? (
                <span className="text-[10px] text-stone-600">{t({ ar: "يحتاج الترحيلة", en: "needs migration" })}</span>
              ) : LP_REQUIREMENTS.map((r) => (
                <Chip key={r} on={(filters.requires ?? []).includes(r)} onClick={() => toggleReq(r)} label={t(LP_REQUIREMENT_LABELS[r])} />
              ))}
            </Row>
          </div>
        )}
      </div>

      {/* ── التحديد + الإجراءات الجماعية ── */}
      <div className="flex items-center gap-2 flex-wrap text-[11px] text-stone-400">
        <span>{t({ ar: "النتائج", en: "Results" })}: <span dir="ltr">{filtered.length}</span> / <span dir="ltr">{rows.length}</span></span>
        <button type="button" onClick={selectAllFiltered} className="border border-stone-700 rounded px-2 py-0.5 hover:text-white">
          {t({ ar: "تحديد كل النتائج", en: "Select all results" })} (<span dir="ltr">{filtered.length}</span>)
        </button>
        {selected.size > 0 && (
          <button type="button" onClick={clearSelection} className="border border-stone-700 rounded px-2 py-0.5 hover:text-white">
            {t({ ar: "إلغاء التحديد", en: "Clear selection" })}
          </button>
        )}
        {selected.size > 0 && <span className="text-sky-300">{t({ ar: "محدَّد", en: "Selected" })}: <span dir="ltr">{selectedIds.length}</span></span>}
      </div>

      {truncated && (
        <LpNotice kind="warn">
          {t({
            ar: "بلغ الجلب سقفه — بعض المخرجات غير معروضة والأرقام أدناه جزئية. ضيّق الفلاتر.",
            en: "Fetch limit reached — some deliverables are not shown and the numbers are partial.",
          })}
        </LpNotice>
      )}

      {lastOutcome && <DeliverableBulkReport outcome={lastOutcome} onDismiss={() => setLastOutcome(null)} />}

      {selectedIds.length > 0 && (
        <LargeProjectBulkBar
          ids={selectedIds} caps={caps} stages={stages} staff={staff}
          onClose={clearSelection}
          onApplied={(o) => {
            // حتى النجاح الجزئيّ غيّر بيانات ⇒ إعادة التحميل إلزامية لتعكس القائمة الواقع.
            setLastOutcome(o); clearSelection(); onChanged();
          }}
        />
      )}

      {/* ── القائمة ── */}
      {filtered.length === 0 ? (
        <div className={`${lpCard} p-6 text-center text-[11px] text-stone-500`}>
          {rows.length === 0
            ? t({ ar: "لا مخرجات في هذا المشروع بعد.", en: "No deliverables yet." })
            : t({ ar: "لا نتائج مطابقة للفلاتر الحالية.", en: "No results for the current filters." })}
        </div>
      ) : (
        <div className="space-y-1">
          {visible.map((d) => (
            <DeliverableRow
              key={d.id} d={d} today={today}
              selected={selected.has(d.id)} onToggle={toggleOne}
              stage={stageName.get(lpStageIdOf(d)) ?? "—"}
              assignee={d.assignee_id ? (staffName.get(d.assignee_id) ?? d.assignee_id.slice(0, 8)) : null}
              group={lpGroupOf(d)} type={lpTypeOf(d)} showVisibility={!!caps.columns.client_visible}
              details={txt(d.execution_details)} caption={txt(d.proposed_caption)}
              note={txt(d.internal_notes)} sourceKey={txt(d.external_key)}
            />
          ))}
          {shown < filtered.length && (
            <button type="button" onClick={() => setShown((s) => s + PAGE)}
              className="w-full text-[11px] text-stone-300 bg-stone-900 border border-stone-800 rounded-lg py-2 hover:border-stone-600">
              {t({ ar: "عرض المزيد", en: "Show more" })} (<span dir="ltr">{filtered.length - shown}</span>)
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** نصّ حرّ قابل للعرض، أو null. الفراغ والمسافات وحدها = لا شيء. */
const txt = (v: unknown): string | null => {
  const s = v == null ? "" : String(v).trim();
  return s === "" ? null : s;
};

// ─── صفّ واحد: memo + خصائص بدائية ⇒ لا إعادة رسم للقائمة كلّها عند التحديد ───
const DeliverableRow = memo(function DeliverableRow({
  d, selected, onToggle, stage, assignee, today, group, type, showVisibility,
  details, caption, note, sourceKey,
}: {
  d: LpDeliverable; selected: boolean; onToggle: (id: string) => void;
  stage: string; assignee: string | null; today: string;
  group: string | null; type: string; showVisibility: boolean;
  /** deliverables.execution_details — «تفاصيل التنفيذ» من ملفّ الخطّة. */
  details: string | null;
  /** deliverables.proposed_caption — «نصّ الوصف المقترح». */
  caption: string | null;
  /** deliverable_internal.internal_notes — كوادر فقط (العميل يحصل على صفر صفوف). */
  note: string | null;
  /** deliverable_internal.external_key — أثر السطر المصدر، مفيد عند تصحيح الملفّ. */
  sourceKey: string | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const units = typeof d.expected_units === "number" && d.expected_units > 0
    ? `${d.completed_units ?? 0}/${d.expected_units}` : null;
  const hasBody = !!(details || caption || note);
  return (
    <div className={`${lpCard} p-2 sm:p-2.5 ${selected ? "border-sky-800 bg-stone-800/60" : ""}`}>
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={selected} onChange={() => onToggle(d.id)} className="mt-1 shrink-0"
          aria-label={t({ ar: "تحديد", en: "Select" })} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-stone-100 truncate max-w-[210px] sm:max-w-none" dir="auto">{d.title ?? "—"}</span>
            <DeliverableStatusBadge status={String(d.status)} />
            <DeliverableScheduleBadge d={d} today={today} />
            <DeliverablePriorityBadge priority={d.priority} />
            {showVisibility && d.client_visible !== true && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{t({ ar: "مخفيّ عن العميل", en: "Hidden" })}</span>
            )}
            {lpIsRecurring(d) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 text-stone-400">{t({ ar: "متكرّر", en: "Recurring" })}</span>
            )}
          </div>
          <div className="text-[10px] text-stone-500 truncate mt-0.5">
            <span dir="auto">{stage}</span>
            {group ? <> · <span dir="auto">{group}</span></> : null}
            {type ? <> · {type}</> : null}
            {units ? <> · {t({ ar: "وحدات", en: "units" })} <span dir="ltr">{units}</span></> : null}
            {" · "}{assignee ?? t({ ar: "بلا مسؤول", en: "unassigned" })}
          </div>
          {Array.isArray(d.platforms) && d.platforms.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1">
              {d.platforms.slice(0, 6).map((p) => (
                <span key={String(p)} className="text-[9px] px-1 py-0.5 rounded bg-stone-800 text-stone-400">{String(p)}</span>
              ))}
            </div>
          )}

          {/* النصّ الحرّ للمخرَج — مطويّ افتراضيًّا حتى لا يتضخّم DOM في قائمة
              بمئات الصفوف، ومفتوح بنقرة واحدة. لا شيء يُجلب هنا: الحقول موجودة
              في اللقطة أصلًا. غياب الثلاثة معًا ⇒ لا زرّ ولا سطر فارغ. */}
          {hasBody && (
            <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
              className="mt-1 text-[10px] text-sky-300 hover:text-sky-200 underline">
              {open ? t({ ar: "إخفاء التفاصيل", en: "Hide details" }) : t({ ar: "عرض التفاصيل", en: "Show details" })}
            </button>
          )}
          {open && hasBody && (
            <div className="mt-1 space-y-1.5 border-s-2 border-stone-800 ps-2">
              {details && <Field label={t({ ar: "تفاصيل التنفيذ", en: "Execution details" })} value={details} />}
              {caption && <Field label={t({ ar: "نصّ الوصف المقترح", en: "Proposed caption" })} value={caption} />}
              {note && <Field label={t({ ar: "ملاحظات داخلية (لا يراها العميل)", en: "Internal notes (staff only)" })} value={note} />}
              {sourceKey && (
                <p className="text-[9px] text-stone-600">
                  {t({ ar: "معرّف المصدر", en: "Source key" })} <span dir="ltr">{sourceKey}</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/** حقل نصّ حرّ: يحترم اتجاه النصّ، ويحافظ على أسطر الجدول كما كُتبت. */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] text-stone-500">{label}</div>
      <p className="text-[11px] text-stone-300 leading-relaxed whitespace-pre-wrap break-words" dir="auto">{value}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 flex-wrap">
      <span className="text-[10px] text-stone-500 w-[74px] shrink-0 pt-1">{label}</span>
      <div className="flex items-center gap-1 flex-wrap flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Chip({ on, onClick, label, tone, disabled, hint }: {
  on: boolean; onClick: () => void; label: string;
  tone?: "danger" | "info"; disabled?: boolean; hint?: string;
}) {
  const active = on
    ? tone === "danger" ? "border-red-700 bg-red-950/50 text-red-200"
      : tone === "info" ? "border-sky-700 bg-sky-950/50 text-sky-200"
      : "border-sky-700 bg-stone-800 text-white"
    : "border-stone-700 bg-stone-950 text-stone-400";
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-pressed={on} title={disabled ? hint : undefined}
      className={`text-[10px] px-2 py-1 rounded-lg border whitespace-nowrap ${active} ${disabled ? "opacity-40" : "hover:text-white"}`}>
      {label}
    </button>
  );
}
