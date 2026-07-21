"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويب «المخطط الزمني» (Phase 4 · 4A). Gantt مخصّص CSS/SVG (بلا مكتبة
// خارجية — أخفّ وأكثر تحكّمًا في RTL). مصدر بيانات واحد: project_gantt_snapshot.
// يعرض المهام/المعالم/الاعتماديات/المسار الحرج/خط الأساس + Today + تظليل العطلات + Zoom،
// ويدعم سحب/تمديد المهمة لإعادة الجدولة (Optimistic + Rollback + قفل version).
// الشريط الزمني LTR (الزمن يمضي يسارًا→يمينًا) وعمود المهام على اليسار؛ التسميات عربية.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  projectGanttSnapshot, projectSchedulePreview, projectScheduleApply, pcTaskReschedule, projectBaselineSet, pcErr,
  type GanttSnapshot, type GanttTask,
} from "@/lib/portal/projectCore";

const ROW_H = 30, HEAD_H = 44, LABEL_W = 220;
const ZOOM: Record<"day" | "week" | "month", number> = { day: 26, week: 9, month: 3 };
const PRIO: Record<string, string> = { low: "#78716c", normal: "#0284c7", high: "#d97706", urgent: "#dc2626" };
const parse = (s: string | null) => (s ? new Date(s + "T00:00:00Z") : null);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dayMs = 86400000;
const between = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / dayMs);
const addD = (d: Date, n: number) => new Date(d.getTime() + n * dayMs);
const isWeekend = (d: Date, workDays?: boolean[]) => workDays ? !workDays[d.getUTCDay()] : d.getUTCDay() === 5 || d.getUTCDay() === 6;

export default function ProjectGantt({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [g, setG] = useState<GanttSnapshot | null>(null);
  const [zoom, setZoom] = useState<"day" | "week" | "month">("week");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [drag, setDrag] = useState<{ id: string; mode: "move" | "resize"; startX: number; deltaD: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // مسار تحميل صريح: loading → try → (ready|error). لا يبقى Spinner للأبد مهما كان الخطأ.
  // silent=true لإعادة الجلب بعد عملية ناجحة دون وميض Spinner (لا نضع g في deps تفاديًا لحلقة).
  const load = useCallback(async (silent = false) => {
    if (!silent) setPhase("loading");
    setErr("");
    try {
      const r = await projectGanttSnapshot(projectId, false);
      if (r.ok) { setG(r.data); setPhase("ready"); }
      else { setErr(pcErr(r.error)); setPhase("error"); }
    } catch (e) { setErr(pcErr(String(e))); setPhase("error"); }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  const colW = ZOOM[zoom];
  const model = useMemo(() => {
    if (!g) return null;
    const dates = g.tasks.flatMap((tk) => [parse(tk.start), parse(tk.end), parse(tk.baseline_start), parse(tk.baseline_end)]).filter(Boolean) as Date[];
    const todayD = parse(g.today)!;
    let min = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : todayD;
    let max = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : addD(todayD, 30);
    min = addD(min, -3); max = addD(max, 7);
    if (min > todayD) min = addD(todayD, -3); if (max < todayD) max = addD(todayD, 7);
    const totalDays = Math.max(between(min, max) + 1, 14);
    return { min, max, todayD, totalDays, workDays: g.calendar?.work_days };
  }, [g]);

  // صفوف مرتّبة هرميًا (الأب ثم أبناؤه)، مع طيّ.
  const rows = useMemo(() => {
    if (!g) return [] as { tk: GanttTask; depth: number }[];
    const byParent = new Map<string | null, GanttTask[]>();
    for (const tk of g.tasks) { const k = tk.parent_task_id && g.tasks.some((x) => x.id === tk.parent_task_id) ? tk.parent_task_id : null; (byParent.get(k) ?? byParent.set(k, []).get(k)!).push(tk); }
    const out: { tk: GanttTask; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => { for (const tk of byParent.get(parent) ?? []) { out.push({ tk, depth }); if (!collapsed.has(tk.id)) walk(tk.id, depth + 1); } };
    walk(null, 0);
    return out;
  }, [g, collapsed]);
  const hasChildren = useCallback((id: string) => !!g && g.tasks.some((x) => x.parent_task_id === id), [g]);
  const rowIndex = useMemo(() => { const m = new Map<string, number>(); rows.forEach((r, i) => m.set(r.tk.id, i)); return m; }, [rows]);

  const xOf = useCallback((d: Date | null) => (d && model ? between(model.min, d) * colW : 0), [model, colW]);

  const jumpToday = useCallback(() => { if (scrollRef.current && model) scrollRef.current.scrollLeft = Math.max(0, xOf(model.todayD) - 200); }, [model, xOf]);
  useEffect(() => { jumpToday(); }, [jumpToday]);

  // ── سحب/تمديد ──
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((cur) => cur ? { ...cur, deltaD: Math.round((e.clientX - cur.startX) / colW) } : cur);
    const up = async () => {
      const d = drag; setDrag(null);
      if (!d || d.deltaD === 0 || !g) return;
      const tk = g.tasks.find((x) => x.id === d.id); if (!tk) return;
      const s = parse(tk.start), en = parse(tk.end);
      let ns = s, ne = en;
      if (d.mode === "move") { ns = s ? addD(s, d.deltaD) : null; ne = en ? addD(en, d.deltaD) : null; }
      else { ne = en ? addD(en, d.deltaD) : null; if (ns && ne && ne < ns) ne = ns; }
      const snapshot = g;
      setG({ ...g, tasks: g.tasks.map((x) => x.id === d.id ? { ...x, start: ns ? iso(ns) : null, end: ne ? iso(ne) : null } : x) }); // optimistic
      const r = await pcTaskReschedule(d.id, ns ? iso(ns) : null, ne ? iso(ne) : null, false, tk.version);
      if (!r.ok) { setG(snapshot); flash(pcErr(r.error)); }
      await load(true);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up, { once: true });
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [drag, colW, g, flash, load]);

  async function autoSchedule() {
    if (busy) return; setBusy(true);
    const p = await projectSchedulePreview(projectId); setBusy(false);
    if (!p.ok) { flash(pcErr(p.error)); return; }
    const changed = p.data.tasks.filter((x) => x.changed).length;
    const warns = p.data.warnings.length;
    if (changed === 0) { flash(t({ ar: "لا تغييرات مقترحة.", en: "No changes proposed." })); return; }
    if (!window.confirm(t({ ar: `إعادة جدولة ${changed} مهمة (auto)${warns ? ` — ${warns} تحذير` : ""}؟`, en: `Reschedule ${changed} auto tasks?` }))) return;
    setBusy(true);
    const a = await projectScheduleApply(projectId); setBusy(false);
    if (!a.ok) { flash(pcErr(a.error)); return; }
    flash(t({ ar: `أُعيدت جدولة ${a.data.rescheduled} مهمة.`, en: `Rescheduled ${a.data.rescheduled}.` })); await load(true);
  }
  async function setBaseline() {
    const hasBaseline = !!g?.tasks.some((x) => x.baseline_start);
    const reason = hasBaseline ? window.prompt(t({ ar: "سبب إعادة ضبط خط الأساس (إلزامي):", en: "Baseline reset reason (required):" })) : "";
    if (hasBaseline && (reason === null || !reason.trim())) { if (reason !== null) flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    if (!hasBaseline && !window.confirm(t({ ar: "حفظ خط الأساس للتواريخ الحالية؟", en: "Save baseline?" }))) return;
    const r = await projectBaselineSet(projectId, reason || undefined);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "تم حفظ خط الأساس.", en: "Baseline saved." })); await load(true);
  }

  if (phase === "loading") return <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ تحميل المخطط الزمني…", en: "Loading the schedule…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-red-300">{t({ ar: "تعذّر تحميل المخطط الزمني.", en: "Couldn't load the schedule." })}</p>
      {err && <p className="text-[11px] text-stone-500">{err}</p>}
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 hover:border-stone-500">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!g || !model) return <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ تحميل المخطط الزمني…", en: "Loading…" })}</p>;
  if (g.tasks.length === 0) return (
    <div className="py-8 text-center space-y-2">
      <p className="text-sm text-stone-400">{t({ ar: "لا توجد مهام مجدولة لعرضها.", en: "No scheduled tasks to display." })}</p>
      <p className="text-[11px] text-stone-500">{t({ ar: "أضف مهامًا بتاريخ بداية واستحقاق من تبويب «المهام» لتظهر هنا.", en: "Add tasks with start/due dates from the Tasks tab." })}</p>
    </div>
  );
  const gridW = model.totalDays * colW, totalH = rows.length * ROW_H;
  const cp = g.critical_path;

  return (
    <div className="space-y-2" dir="ltr">
      {/* شريط الأدوات */}
      <div className="flex items-center gap-2 flex-wrap" dir="auto">
        <div className="inline-flex rounded-lg border border-stone-700 overflow-hidden">
          {(["day", "week", "month"] as const).map((z) => <button key={z} onClick={() => setZoom(z)} className={`px-2.5 py-1 text-[11px] ${zoom === z ? "bg-stone-700 text-white" : "text-stone-400"}`}>{t({ ar: z === "day" ? "يومي" : z === "week" ? "أسبوعي" : "شهري", en: z })}</button>)}
        </div>
        <button onClick={jumpToday} className="text-[11px] text-stone-300 border border-stone-700 rounded px-2 py-1">{t({ ar: "اليوم", en: "Today" })}</button>
        {canManage && <button disabled={busy} onClick={() => void autoSchedule()} className="text-[11px] text-sky-300 border border-sky-800 rounded px-2 py-1">{t({ ar: "جدولة آلية", en: "Auto-schedule" })}</button>}
        {canManage && <button onClick={() => void setBaseline()} className="text-[11px] text-amber-300 border border-amber-800 rounded px-2 py-1">{t({ ar: "خط الأساس", en: "Baseline" })}</button>}
        <span className="text-[10px] text-stone-500">
          {cp.computable ? <><span className="text-red-400">■</span> {t({ ar: "المسار الحرج", en: "Critical" })} ({cp.critical_task_ids.length}) · {cp.total_duration_working_days} {t({ ar: "يوم عمل", en: "wd" })}</> : t({ ar: "المسار الحرج غير قابل للحساب (لا اعتماديات كافية)", en: "Critical path N/A" })}
        </span>
      </div>

      <div className="border border-stone-800 rounded-xl overflow-hidden bg-stone-950">
        <div className="flex">
          {/* عمود المهام (Sticky) */}
          <div className="shrink-0 border-e border-stone-800 bg-stone-950 z-10" style={{ width: LABEL_W }}>
            <div style={{ height: HEAD_H }} className="border-b border-stone-800 flex items-end px-2 pb-1 text-[10px] text-stone-500">{t({ ar: "المهمة", en: "Task" })}</div>
            {rows.map(({ tk, depth }) => (
              <div key={tk.id} style={{ height: ROW_H, paddingInlineStart: depth * 12 + 6 }} className="flex items-center gap-1 border-b border-stone-900 text-[11px]">
                {hasChildren(tk.id) ? <button onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(tk.id) ? n.delete(tk.id) : n.add(tk.id); return n; })} className="text-stone-500 w-3">{collapsed.has(tk.id) ? "▸" : "▾"}</button> : <span className="w-3" />}
                {tk.is_milestone && <span className="text-amber-400">◆</span>}
                <span className={`truncate ${tk.status === "done" ? "line-through text-stone-500" : tk.critical ? "text-red-300" : "text-stone-300"}`} dir="auto" title={tk.title}>{tk.title}</span>
                {tk.scheduling_mode === "auto" && <span className="text-[8px] text-sky-500" title={t({ ar: "جدولة آلية", en: "Auto" })}>A</span>}
              </div>
            ))}
          </div>

          {/* الشريط الزمني */}
          <div ref={scrollRef} className="overflow-x-auto flex-1">
            <div style={{ width: gridW, position: "relative" }}>
              {/* الرأس + الشبكة */}
              <div style={{ height: HEAD_H, position: "relative", borderBottom: "1px solid #292524" }}>
                {Array.from({ length: model.totalDays }).map((_, i) => {
                  const d = addD(model.min, i); const we = isWeekend(d, model.workDays);
                  const showLabel = zoom === "day" || (zoom === "week" && d.getUTCDay() === 0) || (zoom === "month" && d.getUTCDate() === 1);
                  return <div key={i} style={{ position: "absolute", left: i * colW, width: colW, height: "100%", background: we ? "rgba(255,255,255,0.03)" : "transparent", borderInlineEnd: showLabel ? "1px solid #292524" : "none" }}>
                    {showLabel && <span style={{ position: "absolute", bottom: 2, insetInlineStart: 3, fontSize: 8, color: "#78716c", whiteSpace: "nowrap" }}>{zoom === "month" ? d.toLocaleDateString("en", { month: "short", year: "2-digit" }) : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`}</span>}
                  </div>;
                })}
              </div>
              {/* منطقة الصفوف */}
              <div style={{ position: "relative", height: totalH }}>
                {/* تظليل العطلات ممتدًّا */}
                {Array.from({ length: model.totalDays }).map((_, i) => { const d = addD(model.min, i); return isWeekend(d, model.workDays) ? <div key={i} style={{ position: "absolute", left: i * colW, width: colW, top: 0, height: totalH, background: "rgba(255,255,255,0.02)" }} /> : null; })}
                {/* خط اليوم */}
                <div style={{ position: "absolute", left: xOf(model.todayD) + colW / 2, top: 0, height: totalH, width: 1.5, background: "#dc2626", opacity: 0.6, zIndex: 5 }} />
                {/* خطوط الاعتماديات (SVG) */}
                <svg width={gridW} height={totalH} style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 4 }}>
                  {g.dependencies.map((dep, k) => {
                    const from = rowIndex.get(dep.depends_on), to = rowIndex.get(dep.task_id);
                    const ft = g.tasks.find((x) => x.id === dep.depends_on), tt = g.tasks.find((x) => x.id === dep.task_id);
                    if (from == null || to == null || !ft || !tt) return null;
                    const x1 = xOf(parse(ft.end)) + colW, y1 = from * ROW_H + ROW_H / 2, x2 = xOf(parse(tt.start)), y2 = to * ROW_H + ROW_H / 2;
                    return <path key={k} d={`M ${x1} ${y1} C ${x1 + 12} ${y1}, ${x2 - 12} ${y2}, ${x2} ${y2}`} stroke="#57534e" strokeWidth={1} fill="none" markerEnd="url(#arr)" />;
                  })}
                  <defs><marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#57534e" /></marker></defs>
                </svg>
                {/* الأشرطة */}
                {rows.map(({ tk }, i) => {
                  const s = parse(tk.start), e = parse(tk.end); if (!s) return null;
                  const x = xOf(s), w = Math.max((e ? between(s, e) + 1 : 1) * colW, colW * 0.6);
                  const bs = parse(tk.baseline_start), be = parse(tk.baseline_end);
                  const canDrag = canManage && !tk.is_milestone;
                  return <div key={tk.id}>
                    {bs && be && <div style={{ position: "absolute", left: xOf(bs), top: i * ROW_H + ROW_H - 6, width: Math.max((between(bs, be) + 1) * colW, 3), height: 3, background: "rgba(180,120,60,0.6)", borderRadius: 2 }} title={t({ ar: "خط الأساس", en: "Baseline" })} />}
                    {tk.is_milestone ? (
                      <div onPointerDown={(ev) => canManage && setDrag({ id: tk.id, mode: "move", startX: ev.clientX, deltaD: 0 })}
                        style={{ position: "absolute", left: x + (drag?.id === tk.id ? drag.deltaD * colW : 0) - 6, top: i * ROW_H + ROW_H / 2 - 6, width: 12, height: 12, background: tk.critical ? "#dc2626" : "#d97706", transform: "rotate(45deg)", cursor: canManage ? "grab" : "default", zIndex: 6 }} title={`◆ ${tk.title}`} />
                    ) : (
                      <div style={{ position: "absolute", left: x + (drag?.id === tk.id && drag.mode === "move" ? drag.deltaD * colW : 0), top: i * ROW_H + 6, width: w + (drag?.id === tk.id && drag.mode === "resize" ? drag.deltaD * colW : 0), height: ROW_H - 12, zIndex: 6 }}>
                        <div onPointerDown={(ev) => { if (canDrag) { ev.preventDefault(); setDrag({ id: tk.id, mode: "move", startX: ev.clientX, deltaD: 0 }); } }}
                          style={{ position: "relative", height: "100%", borderRadius: 4, background: tk.overdue ? "rgba(220,38,38,0.25)" : "rgba(255,255,255,0.06)", border: `1px solid ${tk.critical ? "#dc2626" : tk.overdue ? "#b91c1c" : "#44403c"}`, cursor: canDrag ? "grab" : "default", overflow: "hidden" }} title={`${tk.title} · ${tk.start ?? ""}→${tk.end ?? ""}${tk.float != null && cp.computable ? ` · float ${tk.float}` : ""}`}>
                          <div style={{ height: "100%", width: `${tk.status === "done" ? 100 : tk.progress_pct}%`, background: PRIO[tk.priority] ?? "#0284c7", opacity: 0.5 }} />
                          <span style={{ position: "absolute", insetInlineStart: 4, top: 1, fontSize: 9, color: "#e7e5e4", whiteSpace: "nowrap", pointerEvents: "none" }} dir="auto">{tk.assignee ?? ""}</span>
                          {canDrag && <div onPointerDown={(ev) => { ev.stopPropagation(); ev.preventDefault(); setDrag({ id: tk.id, mode: "resize", startX: ev.clientX, deltaD: 0 }); }} style={{ position: "absolute", insetInlineEnd: 0, top: 0, width: 6, height: "100%", cursor: "ew-resize" }} />}
                        </div>
                      </div>
                    )}
                  </div>;
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
      {cp.warnings.length > 0 && <p className="text-[10px] text-amber-400">{cp.warnings.map((w) => t({ ar: w.ar, en: w.type })).join(" · ")}</p>}
      <p className="text-[10px] text-stone-600" dir="auto">{t({ ar: "اسحب المهمة لنقلها، أو حافتها اليمنى لتغيير المدة. الجدولة الآلية تُعيد جدولة مهام «auto» فقط. على الجوال استخدم تبويب المهام لتغيير التواريخ.", en: "Drag to move / right edge to resize. Auto-schedule affects auto tasks only." })}</p>
    </div>
  );
}
