"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — تبويب «الموارد» (Phase 4 · 4B). عبء الفريق + الحجوزات + التعارضات +
// خط زمني للموارد + إنشاء/تأكيد/إلغاء حجز — كله عبر RPCs حقيقية (لا بيانات وهمية).
// العميل لا يصل لهذه الشاشة (سطح داخلي + RLS). التوقيت الافتراضي Asia/Riyadh.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  projectResourcesDashboard, resourceTimelineSnapshot, resourceBookingCreate, resourceBookingCancel,
  resourceBookingConfirm, resourceCheckConflicts, planningResourcesSync, resErr,
  WORKLOAD_LABELS, BOOKING_STATUS_LABELS, BOOKING_TYPE_LABELS,
  type ResourcesDashboard, type ResourceTimeline, type WorkloadSnapshot, type BookingType, type BookingConflict,
} from "@/lib/portal/projectResources";
import ResourceLabel from "./ResourceLabel";
import PlanningHealthCard from "./PlanningHealthCard";
import ConflictCenter from "./ConflictCenter";
import PlanningReports from "./PlanningReports";

const todayISO = () => new Date().toISOString().slice(0, 10);
const addDaysISO = (iso: string, n: number) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayMs = 86400000;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / dayMs);
// عرض الأوقات بتوقيت الشركة (Asia/Riyadh) لا UTC الخام
const fmtDT = (iso: string) => { try { return new Date(iso).toLocaleString("en-GB", { timeZone: "Asia/Riyadh", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); } catch { return iso.slice(0, 16).replace("T", " "); } };

export default function ProjectResources({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(addDaysISO(todayISO(), 30));
  const [dash, setDash] = useState<ResourcesDashboard | null>(null);
  const [tl, setTl] = useState<ResourceTimeline | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const reqSeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++reqSeq.current;
    setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, r) => { timer = setTimeout(() => r(new Error("res_timeout")), 20000); });
    try {
      // مهلة واحدة للطلبين معًا (لا تسرّب مؤقّتات). الخط الزمني بلا فلتر مشروع كي يوفّر
      // قائمة الموارد الكاملة لنموذج الحجز + وعيًا بالتعارضات عبر المشاريع.
      const [d, timeline] = await Promise.race([
        Promise.all([projectResourcesDashboard(projectId, from, to), resourceTimelineSnapshot(from, to, {})]),
        timeout,
      ]);
      if (!mountedRef.current || my !== reqSeq.current) return;
      if (!d.ok) { if (process.env.NODE_ENV !== "production") console.error("[resources] dashboard:", d.error); setErr(resErr(d.error)); setPhase("error"); return; }
      setDash(d.data);
      setTl(timeline.ok ? timeline.data : null);
      setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(e instanceof Error && e.message === "res_timeout" ? t({ ar: "انتهت مهلة تحميل الموارد.", en: "Timed out." }) : resErr(String(e)));
      setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [projectId, from, to, t]);
  useEffect(() => { void load(); }, [load]);

  async function sync() {
    if (busy) return; setBusy(true);
    const r = await planningResourcesSync(); setBusy(false);
    if (!r.ok) { flash(resErr(r.error)); return; }
    flash(t({ ar: `سُجّل ${r.data.employees_added} موظف و${r.data.equipment_added} معدة كموارد.`, en: `Synced ${r.data.employees_added} employees, ${r.data.equipment_added} equipment.` }));
    await load();
  }
  async function cancelBooking(id: string, version: number) {
    const reason = window.prompt(t({ ar: "سبب الإلغاء:", en: "Cancel reason:" })); if (reason === null) return;
    const r = await resourceBookingCancel(id, reason, version);
    if (!r.ok) { flash(resErr(r.error)); return; }
    flash(t({ ar: "أُلغي الحجز.", en: "Cancelled." })); await load();
  }
  async function confirmBooking(id: string, version: number) {
    const r = await resourceBookingConfirm(id, version);
    if (!r.ok) { flash(resErr(r.error)); return; }
    flash(t({ ar: "تم تأكيد الحجز.", en: "Confirmed." })); await load();
  }

  if (phase === "loading") return <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ تحميل الموارد…", en: "Loading resources…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-red-300">{t({ ar: "تعذّر تحميل الموارد.", en: "Couldn't load resources." })}</p>
      {err && <p className="text-[11px] text-stone-500">{err}</p>}
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2 hover:border-stone-500">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );

  return (
    <div className="space-y-4" dir="rtl">
      {/* شريط الفترة + الأدوات */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <label className="flex items-center gap-1"><span className="text-stone-500">{t({ ar: "من", en: "From" })}</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }} /></label>
        <label className="flex items-center gap-1"><span className="text-stone-500">{t({ ar: "إلى", en: "To" })}</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }} /></label>
        {canManage && <button onClick={() => setShowForm((s) => !s)} className="text-sky-300 border border-sky-800 rounded px-2.5 py-1">{t({ ar: "حجز مورد", en: "Book" })}</button>}
        {canManage && <button disabled={busy} onClick={() => void sync()} className="text-stone-300 border border-stone-700 rounded px-2.5 py-1" title={t({ ar: "تسجيل الموظفين/المعدات كموارد", en: "Register employees/equipment" })}>{t({ ar: "مزامنة الموارد", en: "Sync" })}</button>}
        <button onClick={() => setShowConflicts(true)} className="text-red-300 border border-red-900 rounded px-2.5 py-1">{t({ ar: "مركز التعارضات", en: "Conflicts" })}</button>
        <button onClick={() => setShowReports(true)} className="text-green-300 border border-green-900 rounded px-2.5 py-1">{t({ ar: "التقارير", en: "Reports" })}</button>
      </div>

      {/* §11 بطاقة الصحّة الموحّدة */}
      <PlanningHealthCard projectId={projectId} />

      {showForm && tl && <BookingForm projectId={projectId} resources={tl.resources.map((r) => r.resource)} defaultFrom={from} flash={flash}
        onDone={() => { setShowForm(false); void load(); }} onClose={() => setShowForm(false)} />}
      {showConflicts && <ConflictCenter projectId={projectId} onClose={() => { setShowConflicts(false); void load(); }} />}
      {showReports && <PlanningReports projectId={projectId} onClose={() => setShowReports(false)} />}

      {/* التعارضات */}
      {dash && dash.conflicts.length > 0 && (
        <section className="border border-red-900/60 bg-red-950/20 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between"><h4 className="text-xs font-semibold text-red-300">{t({ ar: "تعارضات الحجوزات", en: "Booking conflicts" })} ({dash.conflicts.length})</h4>
            <button onClick={() => setShowConflicts(true)} className="text-[10px] text-red-300 underline">{t({ ar: "معالجة", en: "Resolve" })}</button></div>
          {dash.conflicts.map((c) => (
            <div key={c.booking_id} className="text-[11px] text-red-200 flex items-center gap-1 flex-wrap">
              <ResourceLabel r={c.resource} size="xs" />
              {(c.conflicts ?? []).map((cf, i) => <span key={i} className="text-red-300/80"> · {cf.explanation_ar}</span>)}
            </div>
          ))}
        </section>
      )}

      {/* عبء الفريق */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "عبء الفريق", en: "Team workload" })}</h4>
        {dash && dash.team.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا أعضاء مُسند إليهم مهام في هذه الفترة.", en: "No members with tasks in this range." })}</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {dash?.team.map((w) => <WorkloadCard key={w.user_id} w={w} />)}
        </div>
      </section>

      {/* الخط الزمني للموارد */}
      {tl && tl.resources.length > 0 && <ResourceTimelineView tl={tl} from={from} to={to} />}

      {/* الحجوزات القادمة */}
      <section className="space-y-2">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "الحجوزات", en: "Bookings" })} ({dash?.bookings.length ?? 0})</h4>
        {dash && dash.bookings.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا حجوزات في هذه الفترة.", en: "No bookings in this range." })}</p>}
        <div className="space-y-1">
          {dash?.bookings.map((b) => {
            const st = BOOKING_STATUS_LABELS[b.status];
            return (
              <div key={b.id} className="flex items-center gap-2 text-[11px] border border-stone-800 rounded-lg px-2.5 py-1.5 bg-stone-950">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: st.color }} />
                <ResourceLabel r={b.resource} size="xs" />
                <span className="text-stone-500">{BOOKING_TYPE_LABELS[b.booking_type as BookingType]}</span>
                <span className="text-stone-500">{fmtDT(b.starts_at)} → {fmtDT(b.ends_at)}</span>
                {b.overridden && <span className="text-amber-400" title={t({ ar: "تم تجاوز تعارض", en: "Conflict overridden" })}>⚠ تجاوز</span>}
                <span className="text-stone-400">{t({ ar: st.ar, en: b.status })}</span>
                {canManage && b.status !== "confirmed" && b.status !== "cancelled" && (
                  <button onClick={() => void confirmBooking(b.id, b.version)} className="text-green-400 hover:text-green-300 ms-auto">{t({ ar: "تأكيد", en: "Confirm" })}</button>
                )}
                {canManage && b.status !== "cancelled" && (
                  <button onClick={() => void cancelBooking(b.id, b.version)} className={`text-red-400 hover:text-red-300 ${b.status === "confirmed" ? "ms-auto" : ""}`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* مهام غير معيّنة */}
      {dash && dash.unassigned_tasks.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-xs font-semibold text-amber-300">{t({ ar: "مهام بلا مورد معيّن", en: "Unassigned tasks" })} ({dash.unassigned_tasks.length})</h4>
          <div className="flex flex-wrap gap-1">
            {dash.unassigned_tasks.map((u) => <span key={u.id} className="text-[10px] text-amber-200/80 border border-amber-900/50 rounded px-2 py-0.5" dir="auto">{u.title}</span>)}
          </div>
        </section>
      )}
    </div>
  );
}

function WorkloadCard({ w }: { w: WorkloadSnapshot }) {
  const { t } = useI18n();
  const lbl = WORKLOAD_LABELS[w.classification];
  const pct = Math.min(w.utilization_percent ?? 0, 130);
  return (
    <div className="border border-stone-800 rounded-xl p-2.5 bg-stone-950 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-stone-200 font-medium truncate" dir="auto">{w.full_name ?? "—"}</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded" style={{ background: lbl.color + "22", color: lbl.color }}>{lbl.ar}</span>
      </div>
      {w.job_title && <p className="text-[10px] text-stone-500" dir="auto">{w.job_title}</p>}
      <div className="h-1.5 bg-stone-800 rounded overflow-hidden"><div style={{ width: `${pct}%`, background: lbl.color, height: "100%" }} /></div>
      <div className="grid grid-cols-3 gap-1 text-[9px] text-stone-400">
        <span>{t({ ar: "مخطّط", en: "Planned" })}: <b className="text-stone-200">{w.planned_hours}h</b></span>
        <span>{t({ ar: "متاح", en: "Avail" })}: <b className="text-stone-200">{w.available_hours}h</b></span>
        <span>{t({ ar: "استغلال", en: "Util" })}: <b className="text-stone-200">{w.utilization_percent ?? "—"}%</b></span>
      </div>
      <div className="flex gap-2 text-[9px] text-stone-500">
        <span>{t({ ar: "مهام", en: "Tasks" })}: {w.active_tasks}</span>
        {w.overdue_tasks > 0 && <span className="text-red-400">{t({ ar: "متأخرة", en: "Overdue" })}: {w.overdue_tasks}</span>}
        {w.conflict_count > 0 && <span className="text-amber-400">{t({ ar: "تعارضات", en: "Conflicts" })}: {w.conflict_count}</span>}
      </div>
      {w.warnings.map((wn, i) => <p key={i} className="text-[9px] text-amber-400/90">{wn.ar}</p>)}
    </div>
  );
}

function ResourceTimelineView({ tl, from, to }: { tl: ResourceTimeline; from: string; to: string }) {
  const { t } = useI18n();
  const totalDays = Math.max(daysBetween(from, to) + 1, 1);
  const colW = 100 / totalDays;
  const posOf = (iso: string) => {
    const d = Math.max(0, Math.min(totalDays, daysBetween(from, iso.slice(0, 10))));
    return (d / totalDays) * 100;
  };
  return (
    <section className="space-y-1">
      <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "الخط الزمني للموارد", en: "Resource timeline" })}</h4>
      <div className="border border-stone-800 rounded-xl overflow-hidden bg-stone-950">
        <div className="relative" style={{ minHeight: 20 }}>
          {/* رأس التواريخ */}
          <div className="flex border-b border-stone-800 text-[8px] text-stone-600">
            <div className="shrink-0 border-e border-stone-800 px-1 py-0.5" style={{ width: 120 }}>{t({ ar: "المورد", en: "Resource" })}</div>
            <div className="flex-1 flex">
              {Array.from({ length: Math.min(totalDays, 31) }).map((_, i) => <span key={i} className="flex-1 text-center border-e border-stone-900/50 py-0.5">{addDaysISO(from, Math.round(i * totalDays / Math.min(totalDays, 31))).slice(5)}</span>)}
            </div>
          </div>
          {tl.resources.slice(0, 40).map((r) => (
            <div key={r.resource.id} className="flex border-b border-stone-900 items-stretch" style={{ minHeight: 26 }}>
              <div className="shrink-0 border-e border-stone-800 px-1 py-1 self-center overflow-hidden" style={{ width: 120 }}><ResourceLabel r={r.resource} size="xs" /></div>
              <div className="flex-1 relative">
                {r.bookings.map((b) => {
                  const left = posOf(b.starts_at); const right = posOf(b.ends_at);
                  const st = BOOKING_STATUS_LABELS[b.status];
                  return <div key={b.id} className="absolute top-1 bottom-1 rounded" title={`${b.project_name ?? ""} · ${fmtDT(b.starts_at)}→${fmtDT(b.ends_at)}${b.overridden ? " ⚠" : ""}`}
                    style={{ insetInlineStart: `${left}%`, width: `${Math.max(right - left, 1.5)}%`, background: st.color + "cc", border: `1px solid ${st.color}` }} />;
                })}
                {r.unavailability.map((u, i) => {
                  const left = posOf(u.starts_at); const right = posOf(u.ends_at);
                  return <div key={"u" + i} className="absolute top-0 bottom-0" title={u.reason_type} style={{ insetInlineStart: `${left}%`, width: `${Math.max(right - left, 1)}%`, background: "rgba(120,113,108,0.25)", backgroundImage: "repeating-linear-gradient(45deg,transparent,transparent 3px,rgba(255,255,255,0.06) 3px,rgba(255,255,255,0.06) 6px)" }} />;
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-[9px] text-stone-600">{t({ ar: "مرّر فوق الأشرطة للتفاصيل. سحب/تغيير المدة عبر نموذج الحجز.", en: "Hover bars for details." })}</p>
    </section>
  );
}

function BookingForm({ projectId, resources, defaultFrom, onDone, onClose, flash }: {
  projectId: string; resources: ResourcesDashboard["bookings"][number]["resource"][]; defaultFrom: string;
  onDone: () => void; onClose: () => void; flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const [resourceId, setResourceId] = useState(resources[0]?.id ?? "");
  const [type, setType] = useState<BookingType>("equipment");
  const [starts, setStarts] = useState(defaultFrom + "T09:00");
  const [ends, setEnds] = useState(defaultFrom + "T17:00");
  const [qty, setQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<BookingConflict[]>([]);
  const [overrideReason, setOverrideReason] = useState("");
  const sorted = useMemo(() => [...resources].sort((a, b) => a.resource_type.localeCompare(b.resource_type)), [resources]);

  async function submit(doOverride: boolean) {
    if (!resourceId) { flash(t({ ar: "اختر موردًا.", en: "Pick a resource." })); return; }
    if (doOverride && !overrideReason.trim()) { flash(t({ ar: "سبب التجاوز إلزامي.", en: "Override reason required." })); return; }
    const startsISO = new Date(starts).toISOString(), endsISO = new Date(ends).toISOString();
    if (endsISO <= startsISO) { flash(t({ ar: "النهاية يجب أن تكون بعد البداية.", en: "End must be after start." })); return; }
    setSaving(true);
    // افحص التعارضات أولًا (ما لم يكن تجاوزًا): إن وُجد حاجب اعرضه وأتِح التجاوز للمخوّل.
    if (!doOverride) {
      const chk = await resourceCheckConflicts(resourceId, startsISO, endsISO, qty);
      if (chk.ok) {
        const cf = chk.data.conflicts ?? [];
        if (cf.some((c) => c.severity === "hard_conflict" || c.severity === "capacity_conflict")) { setConflicts(cf); setSaving(false); return; }
      }
    }
    const r = await resourceBookingCreate({
      resource_id: resourceId, project_id: projectId, booking_type: type,
      starts_at: startsISO, ends_at: endsISO, quantity: qty, status: "hold",
      override: doOverride, override_reason: overrideReason || null,
    });
    setSaving(false);
    if (!r.ok) { flash(resErr(r.error)); return; }
    flash(t({ ar: "أُنشئ الحجز.", en: "Booking created." })); onDone();
  }

  return (
    <section className="border border-sky-900/50 bg-sky-950/10 rounded-xl p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between"><h4 className="font-semibold text-sky-300">{t({ ar: "حجز مورد", en: "Book a resource" })}</h4>
        <button onClick={onClose} className="text-stone-500 hover:text-stone-300">✕</button></div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "المورد", en: "Resource" })}</span>
          <select value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }}>
            {sorted.map((r) => <option key={r.id} value={r.id}>{r.display_name} ({r.resource_type}){r.asset ? ` · ${r.asset.availability_status}` : ""}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "النوع", en: "Type" })}</span>
          <select value={type} onChange={(e) => setType(e.target.value as BookingType)} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }}>
            {(["equipment", "studio", "vehicle", "shooting", "task", "employee_shift", "other"] as BookingType[]).map((k) => <option key={k} value={k}>{BOOKING_TYPE_LABELS[k]}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "من", en: "Start" })}</span>
          <input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }} /></label>
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "إلى", en: "End" })}</span>
          <input type="datetime-local" value={ends} min={starts} onChange={(e) => setEnds(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }} /></label>
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الكمية", en: "Qty" })}</span>
          <input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" /></label>
      </div>
      {conflicts.length > 0 && (
        <div className="border border-red-900/50 bg-red-950/20 rounded p-2 space-y-1">
          <p className="text-red-300 text-[11px]">{t({ ar: "تعارضات:", en: "Conflicts:" })}</p>
          {conflicts.map((c, i) => <p key={i} className="text-red-200 text-[10px]">· {c.explanation_ar} ({c.severity})</p>)}
          {conflicts.some((c) => c.can_override) && (
            <div className="flex gap-2 items-center mt-1">
              <input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder={t({ ar: "سبب التجاوز (إلزامي)", en: "Override reason" })} className="flex-1 bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200 text-[10px]" />
              <button disabled={saving || !overrideReason} onClick={() => void submit(true)} className="text-amber-300 border border-amber-800 rounded px-2 py-1 text-[10px] disabled:opacity-50">{t({ ar: "تجاوز وحجز", en: "Override & book" })}</button>
            </div>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="text-stone-400 px-3 py-1">{t({ ar: "إلغاء", en: "Cancel" })}</button>
        <button disabled={saving} onClick={() => void submit(false)} className="bg-sky-700 text-white rounded px-3 py-1 disabled:opacity-50">{t({ ar: "حجز", en: "Book" })}</button>
      </div>
    </section>
  );
}
