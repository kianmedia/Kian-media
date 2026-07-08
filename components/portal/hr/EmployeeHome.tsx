"use client";
// ════════════════════════════════════════════════════════════════════════
// بوابة الموظف — لوحة اليوم (حضور/انصراف بموقع لحظة الضغط فقط + نص الموافقة
// الواضح)، مهامي الميدانية (بدء/إنهاء بموقع + ملاحظة + صور اختيارية)، طلباتي
// (إجازة/إذن + الحالة + إلغاء)، ملفي، وعهدتي (رابط لنظام العهدة دون تعديله).
// Mobile-first: أزرار كبيرة وبطاقات تلتف — الموظف يستخدمها ميدانياً من الجوال.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  hrMyProfile, listMyRecentSessions, findOpenSession, listMyAttendance, listMyLeaves,
  listMyAssignments, listTasksByIds, listMyVisibleEvents, hrCheckIn, hrCheckOut,
  hrSubmitLeave, hrCancelMyLeave, hrStartTask, hrCompleteTask, hrGetSettings,
  getPositionOnce, uploadHrFile, hrFilePath, emitHrEvent,
  CONSENT_TEXT, LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, TASK_STATUS_LABELS,
  TASK_TYPE_LABELS, TASK_PRIORITY_LABELS,
  type HrMyProfile, type HrAttendance, type HrLeave, type HrTask, type HrAssignee,
  type HrEvent, type LeaveType,
} from "@/lib/portal/hr";
import { listMyCustodyRecords, type CustodyRecord } from "@/lib/portal/custody";

const GEO_ERR = {
  permission_denied: { ar: "يلزم السماح بالوصول للموقع لإتمام العملية — فعّل إذن الموقع للمتصفح ثم أعد المحاولة.", en: "Location permission is required — enable it and retry." },
  timeout:           { ar: "تعذّر تحديد الموقع في الوقت المناسب — حاول مجددًا في مكان مكشوف.", en: "Couldn't get your location in time — retry." },
  unavailable:       { ar: "تعذّر تحديد الموقع — تأكد من تفعيل GPS.", en: "Location unavailable — check GPS." },
  geolocation_unsupported: { ar: "متصفحك لا يدعم تحديد الموقع.", en: "Your browser doesn't support geolocation." },
} as Record<string, { ar: string; en: string }>;

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";

function todayRiyadh(): string {
  // yyyy-mm-dd بتوقيت الرياض (يطابق hr_today() في القاعدة)
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}
function daysAgoRiyadh(n: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date(Date.now() - n * 86400000));
}
const fmtTime = (iso: string | null, isAr: boolean) =>
  iso ? new Date(iso).toLocaleTimeString(isAr ? "ar-SA" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

export default function EmployeeHome() {
  const { t, isAr } = useI18n();
  const { profile, readOnly } = usePortal();
  const uid = profile.id;

  const [me, setMe] = useState<HrMyProfile | null>(null);
  const [sessions, setSessions] = useState<HrAttendance[]>([]);
  const [leaveEnabled, setLeaveEnabled] = useState(false);
  const [attendance, setAttendance] = useState<HrAttendance[]>([]);
  const [leaves, setLeaves] = useState<HrLeave[]>([]);
  const [assignments, setAssignments] = useState<HrAssignee[]>([]);
  const [tasks, setTasks] = useState<Record<string, HrTask>>({});
  const [events, setEvents] = useState<HrEvent[]>([]);
  const [custody, setCustody] = useState<CustodyRecord[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errDetail, setErrDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 4200); };

  const reload = useCallback(async () => {
    const prof = await hrMyProfile();
    if (!prof.ok) { setErrDetail(prof.error); setPhase("error"); return; }
    setMe(prof.data);
    const [att, ses, st, lv, asg, ev, cu] = await Promise.all([
      listMyAttendance(20), listMyRecentSessions(uid, daysAgoRiyadh(1)), hrGetSettings(), listMyLeaves(),
      listMyAssignments(uid), listMyVisibleEvents(uid),
      listMyCustodyRecords("custody", uid),
    ]);
    if (att.ok) setAttendance(att.data);
    if (ses.ok) setSessions(ses.data);
    // فشل قراءة الإعدادات (قبل تشغيل PATCH مثلاً) ⇒ يبقى قسم الإجازات مخفيًا (الافتراضي الآمن).
    setLeaveEnabled(st.ok && st.data.employee_leave_requests_enabled === true);
    if (lv.ok) setLeaves(lv.data);
    if (ev.ok) setEvents(ev.data);
    if (cu.ok) setCustody(cu.data);
    if (asg.ok) {
      setAssignments(asg.data);
      const ids = Array.from(new Set(asg.data.map((a) => a.task_id)));
      const tk = await listTasksByIds(ids);
      if (tk.ok) {
        const map: Record<string, HrTask> = {};
        tk.data.forEach((x) => { map[x.id] = x; });
        setTasks(map);
      }
    }
    setPhase("ready");
  }, [uid]);
  useEffect(() => { void reload(); }, [reload]);

  // ─── الحضور والانصراف (موقع عند الضغط فقط) ───
  async function doAttendance(kind: "in" | "out") {
    if (readOnly || busy) return;
    setBusy(true);
    const pos = await getPositionOnce();
    if (!pos.ok) { setBusy(false); flash(t(GEO_ERR[pos.error] ?? { ar: "تعذّر تحديد الموقع.", en: "Location failed." })); return; }
    const r = kind === "in" ? await hrCheckIn(pos.data) : await hrCheckOut(pos.data);
    setBusy(false);
    if (!r.ok) {
      const msg = /session_already_open|already_checked_in/.test(r.error)
        ? t({ ar: "لديك جلسة حضور مفتوحة — سجّل الانصراف أولاً ثم يمكنك تسجيل حضور جديد.", en: "You have an open session — check out first." })
        : /no_open_check_in/.test(r.error) ? t({ ar: "لا توجد جلسة حضور مفتوحة لتسجيل الانصراف.", en: "No open check-in session." })
        : (t({ ar: "تعذّر: ", en: "Failed: " })) + r.error;
      flash(msg); return;
    }
    emitHrEvent({
      event: kind === "in" ? "hr_check_in" : "hr_check_out",
      entity_id: r.data.record_id,
      title: (kind === "in" ? "حضور: " : "انصراف: ") + (me?.full_name || "") + " — " + new Date().toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" }),
      employee_name: me?.full_name || "",
    });
    await reload();
    flash(kind === "in" ? t({ ar: "فُتحت جلسة حضور جديدة — يومًا موفقًا!", en: "New session opened — have a great day!" })
      : t({ ar: "أُغلقت الجلسة وسُجّل انصرافك — شكراً لجهدك.", en: "Session closed — thank you." }));
  }

  // ─── المهام ───
  const [taskNote, setTaskNote] = useState<Record<string, string>>({});
  const [taskFiles, setTaskFiles] = useState<Record<string, { file: File; preview: string }[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickFor, setPickFor] = useState<string | null>(null);

  async function doStartTask(a: HrAssignee) {
    if (readOnly || busy) return;
    setBusy(true);
    const pos = await getPositionOnce();
    if (!pos.ok) { setBusy(false); flash(t(GEO_ERR[pos.error] ?? { ar: "تعذّر تحديد الموقع.", en: "Location failed." })); return; }
    const r = await hrStartTask(a.task_id, pos.data);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر بدء المهمة: ", en: "Couldn't start: " })) + r.error); return; }
    emitHrEvent({ event: "hr_task_started", entity_id: a.task_id, title: "بدء مهمة: " + (tasks[a.task_id]?.title || ""), employee_name: me?.full_name || "" });
    await reload();
    flash(t({ ar: "بدأت المهمة — بالتوفيق!", en: "Task started!" }));
  }

  async function doCompleteTask(a: HrAssignee) {
    if (readOnly || busy) return;
    // صورة واحدة على الأقل إلزامية لتسليم المهمة (والقاعدة تفرضها أيضًا).
    const files = taskFiles[a.task_id] ?? [];
    if (files.length === 0) {
      emitHrEvent({ event: "hr_task_completion_photo_required", entity_id: a.task_id, employee_name: me?.full_name || "" });
      flash(t({ ar: "لا يمكن إنهاء المهمة بدون صورة — أضف صورة واحدة على الأقل من موقع التنفيذ ثم أعد المحاولة.", en: "At least one photo is required to complete the task." }));
      return;
    }
    setBusy(true);
    const pos = await getPositionOnce();
    if (!pos.ok) { setBusy(false); flash(t(GEO_ERR[pos.error] ?? { ar: "تعذّر تحديد الموقع.", en: "Location failed." })); return; }
    // ارفع الصور أولاً — مفتاح فريد لكل محاولة (لا سياسة update على
    // التخزين، فإعادة المحاولة بنفس المسار سترفض؛ المفتاح الفريد يحل ذلك).
    const attempt = Date.now().toString(36);
    const paths: string[] = [];
    for (let j = 0; j < files.length; j++) {
      const p = hrFilePath(uid, a.task_id, `photo-${attempt}-${j}`);
      const up = await uploadHrFile(p, files[j].file);
      if (!up.ok) { setBusy(false); flash(t({ ar: "تعذّر رفع إحدى الصور — حاول مجددًا.", en: "Couldn't upload a photo — retry." })); return; }
      paths.push(p);
    }
    const r = await hrCompleteTask(a.task_id, pos.data, (taskNote[a.task_id] || "").trim(), paths);
    setBusy(false);
    if (!r.ok) {
      const msg = /completion_photo_required/.test(r.error)
        ? t({ ar: "لا يمكن إنهاء المهمة بدون صورة واحدة على الأقل.", en: "A photo is required to complete the task." })
        : (t({ ar: "تعذّر إنهاء المهمة: ", en: "Couldn't complete: " })) + r.error;
      flash(msg); return;
    }
    emitHrEvent({ event: "hr_task_submitted", entity_id: a.task_id, title: "تسليم مهمة: " + (tasks[a.task_id]?.title || ""), employee_name: me?.full_name || "" });
    setTaskNote((p) => ({ ...p, [a.task_id]: "" }));
    setTaskFiles((p) => ({ ...p, [a.task_id]: [] }));
    await reload();
    flash(t({ ar: "سُلّمت المهمة — بانتظار اعتماد الإدارة.", en: "Task submitted — awaiting admin approval." }));
  }

  // ─── الطلبات ───
  const [lv, setLv] = useState<{ type: LeaveType; start: string; end: string; startTime: string; endTime: string; reason: string }>({
    type: "annual", start: "", end: "", startTime: "", endTime: "", reason: "",
  });
  const needsTime = lv.type === "permission" || lv.type === "late" || lv.type === "early_exit";
  async function doSubmitLeave() {
    if (readOnly || busy) return;
    if (!lv.start) { flash(t({ ar: "حدد تاريخ البداية.", en: "Pick the start date." })); return; }
    if (!lv.reason.trim()) { flash(t({ ar: "اكتب سبب الطلب.", en: "Write the reason." })); return; }
    setBusy(true);
    const r = await hrSubmitLeave({
      type: lv.type, start: lv.start, end: lv.end || null,
      startTime: needsTime ? (lv.startTime || null) : null, endTime: needsTime ? (lv.endTime || null) : null,
      reason: lv.reason.trim(),
    });
    setBusy(false);
    if (!r.ok) {
      const msg = /leave_requests_disabled/.test(r.error)
        ? t({ ar: "طلبات الإجازة/الإذن غير مفعّلة حاليًا — تواصل مع الإدارة.", en: "Leave requests are currently disabled — contact management." })
        : (t({ ar: "تعذّر إرسال الطلب: ", en: "Couldn't submit: " })) + r.error;
      flash(msg); return;
    }
    emitHrEvent({ event: "hr_leave_new", entity_id: r.data.id, title: "طلب إجازة/إذن جديد من " + (me?.full_name || ""), employee_name: me?.full_name || "" });
    setLv({ type: "annual", start: "", end: "", startTime: "", endTime: "", reason: "" });
    await reload();
    flash(t({ ar: "أُرسل طلبك — سيُراجع من الإدارة.", en: "Request sent — awaiting review." }));
  }
  async function doCancelLeave(id: string) {
    if (busy || readOnly) return;
    setBusy(true); const r = await hrCancelMyLeave(id); setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر الإلغاء: ", en: "Couldn't cancel: " })) + r.error); return; }
    await reload(); flash(t({ ar: "أُلغي الطلب.", en: "Cancelled." }));
  }

  if (phase === "loading") return <p className="text-stone-500 text-sm">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className="text-red-400 text-sm">
      {t({ ar: "تعذّر التحميل — شغّل ترحيل قاعدة البيانات (portal_hr_employee_portal_RUNME.sql) أولاً.", en: "Couldn't load — run the HR DB migration first." })}
      <span className="block mt-1 text-stone-500 text-xs font-mono" dir="ltr">{errDetail}</span>
    </div>
  );

  const todayStr = todayRiyadh();
  const todaySessions = sessions.filter((s) => s.work_date === todayStr).slice().reverse(); // زمنيًا تصاعديًا
  const openSession = findOpenSession(sessions);
  const myOpenTasks = assignments.filter((a) => a.status === "assigned" || a.status === "in_progress");
  const openCustody = custody.filter((c) => !["closed", "rejected"].includes(c.status));

  return (
    <div className="space-y-6">
      {/* ═══ لوحة اليوم ═══ */}
      <section className={card}>
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h2 className="text-base font-medium text-stone-100">{t({ ar: "لوحة اليوم", en: "Today" })}</h2>
          <span className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
            openSession ? "bg-emerald-950 text-emerald-300 border-emerald-800"
            : todaySessions.length > 0 ? "bg-stone-800 text-stone-300 border-stone-700"
            : "bg-amber-950 text-amber-300 border-amber-800"}`}>
            {openSession ? t({ ar: "حاضر — جلسة مفتوحة", en: "Present — open session" })
              : todaySessions.length > 0 ? t({ ar: "منصرف", en: "Checked out" })
              : t({ ar: "لم يسجّل حضور", en: "Not checked in" })}
          </span>
          <span className="ms-auto font-mono text-xs text-stone-500" dir="ltr">{todayStr}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <button type="button" disabled={busy || readOnly || !!openSession} onClick={() => void doAttendance("in")}
            className={`${btnRed} py-3.5 text-base`}>
            {busy ? "…" : t({ ar: "تسجيل حضور", en: "Check in" })}
          </button>
          <button type="button" disabled={busy || readOnly || !openSession} onClick={() => void doAttendance("out")}
            className={`${btnGhost} py-3.5 text-base ${openSession ? "border-red-800 text-red-300" : ""}`}>
            {busy ? "…" : t({ ar: "تسجيل انصراف", en: "Check out" })}
          </button>
        </div>
        {/* جلسات اليوم — أوقات فقط. لا روابط/إحداثيات موقع هنا: تظهر للإدارة فقط. */}
        <div className="text-[11px] text-stone-500 space-y-1">
          <div className="text-stone-400 font-medium">
            {t({ ar: "جلسات اليوم", en: "Today's sessions" })} ({todaySessions.length})
          </div>
          {todaySessions.length === 0 && <div className="font-mono">—</div>}
          {todaySessions.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 flex-wrap font-mono">
              <span className="text-stone-600">#{i + 1}</span>
              <span>{t({ ar: "حضور", en: "In" })} {fmtTime(s.check_in_at, isAr)}</span>
              <span>
                {t({ ar: "انصراف", en: "Out" })}{" "}
                {s.check_out_at ? fmtTime(s.check_out_at, isAr)
                  : <span className="text-emerald-400 font-sans">{t({ ar: "جلسة مفتوحة", en: "open" })}</span>}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-stone-500 leading-relaxed border-t border-stone-800 pt-2">
          🔒 {t(CONSENT_TEXT)}
        </p>
      </section>

      {/* ═══ مهامي ═══ */}
      <section className={card}>
        <h2 className="text-base font-medium text-stone-100 mb-3">
          {t({ ar: "مهامي الميدانية", en: "My field tasks" })}
          <span className="text-stone-500 text-xs font-normal"> ({myOpenTasks.length} {t({ ar: "مفتوحة", en: "open" })})</span>
        </h2>
        {assignments.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا توجد مهام مسندة لك.", en: "No tasks assigned to you." })}</p>}
        <div className="space-y-2.5">
          {assignments.map((a) => {
            const tk = tasks[a.task_id];
            const st = TASK_STATUS_LABELS[a.status as keyof typeof TASK_STATUS_LABELS] ?? { ar: a.status, en: a.status };
            return (
              <div key={a.id} className="bg-stone-950 border border-stone-800 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-stone-100">{tk?.title || "—"}</span>
                  <span className="inline-block rounded-full border border-stone-700 bg-stone-800 px-2 py-0.5 text-[10.5px] text-stone-300">{t(st)}</span>
                  {tk?.task_type && (
                    <span className="inline-block rounded-full border border-stone-700 bg-stone-800 px-2 py-0.5 text-[10.5px] text-sky-300">
                      {t(TASK_TYPE_LABELS[tk.task_type] ?? { ar: tk.task_type, en: tk.task_type })}
                    </span>
                  )}
                  {tk?.priority && tk.priority !== "normal" && (
                    <span className={`inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${
                      tk.priority === "urgent" ? "bg-red-950 text-red-300 border-red-800"
                      : tk.priority === "high" ? "bg-amber-950 text-amber-300 border-amber-800"
                      : "bg-stone-800 text-stone-400 border-stone-700"}`}>
                      {t(TASK_PRIORITY_LABELS[tk.priority] ?? { ar: tk.priority, en: tk.priority })}
                    </span>
                  )}
                </div>
                {(tk?.client_name || tk?.project_name || tk?.city || tk?.location_name) && (
                  <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-stone-400">
                    {tk?.client_name && <span>{t({ ar: "العميل: ", en: "Client: " })}<span className="text-stone-300">{tk.client_name}</span></span>}
                    {tk?.project_name && <span>{t({ ar: "المشروع: ", en: "Project: " })}<span className="text-stone-300">{tk.project_name}</span></span>}
                    {tk?.city && <span>{t({ ar: "المدينة: ", en: "City: " })}<span className="text-stone-300">{tk.city}</span></span>}
                    {tk?.location_name && <span>📍 {tk.location_name}</span>}
                    {tk?.maps_url && (
                      <a className="text-sky-400 underline" href={tk.maps_url} target="_blank" rel="noopener noreferrer">
                        {t({ ar: "موقع المهمة على الخرائط", en: "Task location on Maps" })}
                      </a>
                    )}
                  </div>
                )}
                {tk?.description && <p className="text-xs text-stone-400 leading-relaxed">{tk.description}</p>}
                {tk?.equipment_needed && (
                  <p className="text-[11px] text-stone-400">🎥 {t({ ar: "المعدات المطلوبة: ", en: "Equipment: " })}{tk.equipment_needed}</p>
                )}
                {tk?.special_requirements && (
                  <p className="text-[11px] text-amber-300/80">⚠️ {t({ ar: "متطلبات خاصة: ", en: "Special requirements: " })}{tk.special_requirements}</p>
                )}
                {tk?.execution_notes && (
                  <p className="text-[11px] text-stone-400">📝 {t({ ar: "ملاحظات التنفيذ: ", en: "Execution notes: " })}{tk.execution_notes}</p>
                )}
                {(tk?.expected_start_at || tk?.expected_end_at) && (
                  <div className="text-[10.5px] font-mono text-stone-500" dir="ltr">
                    {tk?.expected_start_at ? new Date(tk.expected_start_at).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : ""}
                    {tk?.expected_end_at ? " ← " + new Date(tk.expected_end_at).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : ""}
                  </div>
                )}
                {a.status === "assigned" && (
                  <button type="button" disabled={busy || readOnly} onClick={() => void doStartTask(a)}
                    className={`${btnRed} w-full py-2.5`}>{t({ ar: "بدء المهمة (بموقعي الآن)", en: "Start task (with my location)" })}</button>
                )}
                {a.status === "in_progress" && (
                  <div className="space-y-2">
                    <textarea value={taskNote[a.task_id] || ""} onChange={(e) => setTaskNote((p) => ({ ...p, [a.task_id]: e.target.value }))}
                      rows={2} placeholder={t({ ar: "ملاحظة عن التنفيذ (اختياري)", en: "Completion note (optional)" })} className={inp} />
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(taskFiles[a.task_id] ?? []).map((f, i) => (
                        <span key={i} className="relative">
                          <img src={f.preview} alt="" className="w-12 h-10 rounded-md object-cover border border-red-500" />
                          <button type="button" onClick={() => setTaskFiles((p) => ({ ...p, [a.task_id]: (p[a.task_id] ?? []).filter((_, k) => k !== i) }))}
                            className="absolute -top-1.5 -end-1.5 w-4 h-4 rounded-full bg-stone-900 border border-stone-600 text-stone-300 text-[9px] leading-none">×</button>
                        </span>
                      ))}
                      <button type="button" onClick={() => { setPickFor(a.task_id); fileRef.current?.click(); }}
                        className="w-12 h-10 rounded-md border border-dashed border-stone-600 text-stone-400 text-lg">+</button>
                      <span className="text-[10px] text-stone-500">{t({ ar: "الصور — صورة واحدة على الأقل إلزامية للإنهاء", en: "Photos — at least one is required to complete" })}</span>
                    </div>
                    <button type="button" disabled={busy || readOnly} onClick={() => void doCompleteTask(a)}
                      className={`${btnRed} w-full py-2.5`}>{t({ ar: "إنهاء المهمة (بموقعي الآن)", en: "Complete task (with my location)" })}</button>
                    {(taskFiles[a.task_id] ?? []).length === 0 && (
                      <p className="text-[10.5px] text-amber-400/90">{t({ ar: "⚠️ أضف صورة من موقع التنفيذ قبل الإنهاء.", en: "⚠️ Add a photo before completing." })}</p>
                    )}
                  </div>
                )}
                {a.employee_note && a.status !== "in_progress" && (
                  <p className="text-[11px] text-stone-500">{t({ ar: "ملاحظتي: ", en: "My note: " })}{a.employee_note}</p>
                )}
                {a.admin_note && <p className="text-[11px] text-red-300/80">{t({ ar: "ملاحظة الإدارة: ", en: "Admin note: " })}{a.admin_note}</p>}
              </div>
            );
          })}
        </div>
        <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && pickFor) setTaskFiles((p) => ({ ...p, [pickFor]: [...(p[pickFor] ?? []), { file: f, preview: URL.createObjectURL(f) }] }));
            e.target.value = "";
          }} />
      </section>

      {/* ═══ طلباتي — يظهر فقط عندما تفعّله الإدارة (hr_settings) ═══ */}
      {leaveEnabled && (
      <section className={card}>
        <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "طلباتي (إجازة / إذن)", en: "My requests" })}</h2>
        <div className="space-y-2 mb-4">
          <select value={lv.type} onChange={(e) => setLv({ ...lv, type: e.target.value as LeaveType })} className={inp}>
            {(Object.keys(LEAVE_TYPE_LABELS) as LeaveType[]).map((k) => (
              <option key={k} value={k}>{isAr ? LEAVE_TYPE_LABELS[k].ar : LEAVE_TYPE_LABELS[k].en}</option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "من تاريخ", en: "From" })}</label>
              <input type="date" value={lv.start} onChange={(e) => setLv({ ...lv, start: e.target.value })} className={inp} dir="ltr" />
            </div>
            <div>
              <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "إلى تاريخ (اختياري)", en: "To (optional)" })}</label>
              <input type="date" value={lv.end} onChange={(e) => setLv({ ...lv, end: e.target.value })} className={inp} dir="ltr" />
            </div>
          </div>
          {needsTime && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "من الساعة", en: "From time" })}</label>
                <input type="time" value={lv.startTime} onChange={(e) => setLv({ ...lv, startTime: e.target.value })} className={inp} dir="ltr" />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "إلى الساعة", en: "To time" })}</label>
                <input type="time" value={lv.endTime} onChange={(e) => setLv({ ...lv, endTime: e.target.value })} className={inp} dir="ltr" />
              </div>
            </div>
          )}
          <textarea value={lv.reason} onChange={(e) => setLv({ ...lv, reason: e.target.value })} rows={2}
            placeholder={t({ ar: "سبب الطلب…", en: "Reason…" })} className={inp} />
          <button type="button" disabled={busy || readOnly} onClick={() => void doSubmitLeave()} className={`${btnRed} w-full py-2.5`}>
            {busy ? "…" : t({ ar: "إرسال الطلب", en: "Submit request" })}
          </button>
        </div>
        {leaves.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا توجد طلبات سابقة.", en: "No previous requests." })}</p>}
        <div className="space-y-1.5">
          {leaves.map((l) => (
            <div key={l.id} className="flex items-center gap-2 flex-wrap bg-stone-950 border border-stone-800 rounded-lg px-3 py-2 text-xs">
              <span className="text-stone-200">{t(LEAVE_TYPE_LABELS[l.leave_type])}</span>
              <span className="font-mono text-stone-500" dir="ltr">{l.start_date}{l.end_date ? ` → ${l.end_date}` : ""}</span>
              <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] ${
                l.status === "approved" ? "bg-emerald-950 text-emerald-300 border-emerald-800"
                : l.status === "rejected" ? "bg-red-950 text-red-300 border-red-800"
                : l.status === "cancelled" ? "bg-stone-800 text-stone-400 border-stone-700"
                : "bg-sky-950 text-sky-300 border-sky-800"}`}>{t(LEAVE_STATUS_LABELS[l.status])}</span>
              {l.decision_note && <span className="text-stone-500">— {l.decision_note}</span>}
              {l.status === "pending" && (
                <button type="button" disabled={busy || readOnly} onClick={() => void doCancelLeave(l.id)}
                  className="ms-auto text-red-400 underline text-[11px] disabled:opacity-50">{t({ ar: "إلغاء", en: "Cancel" })}</button>
              )}
            </div>
          ))}
        </div>
      </section>
      )}

      {/* ═══ ملفي + عهدتي + آخر الحضور ═══ */}
      <div className="grid gap-4 sm:grid-cols-2">
        <section className={card}>
          <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "ملفي", en: "My profile" })}</h2>
          <div className="text-xs text-stone-400 leading-loose">
            <div><span className="text-stone-500">{t({ ar: "الاسم: ", en: "Name: " })}</span>{me?.full_name}</div>
            <div><span className="text-stone-500">{t({ ar: "الوظيفة: ", en: "Job: " })}</span>{me?.job_title || "—"}{me?.department ? ` · ${me.department}` : ""}</div>
            <div><span className="text-stone-500">{t({ ar: "الدور: ", en: "Role: " })}</span>{me?.staff_role_snapshot || profile.staff_role || "—"}</div>
            <div><span className="text-stone-500">{t({ ar: "الجوال: ", en: "Phone: " })}</span><span dir="ltr">{me?.phone || "—"}</span></div>
            <div><span className="text-stone-500">{t({ ar: "البريد: ", en: "Email: " })}</span><span dir="ltr">{me?.email || "—"}</span></div>
            <div><span className="text-stone-500">{t({ ar: "الانضمام: ", en: "Joined: " })}</span><span dir="ltr">{me?.joined_at || "—"}</span></div>
          </div>
          {me?.notes_visible_to_employee && (
            <div className="mt-2 bg-stone-800 rounded-lg p-2.5 text-xs text-stone-300 border-r-2 border-red-600">
              {t({ ar: "ملاحظة الموارد البشرية: ", en: "HR note: " })}{me.notes_visible_to_employee}
            </div>
          )}
          {events.length > 0 && (
            <div className="mt-2 space-y-1">
              {events.slice(0, 5).map((ev) => (
                <div key={ev.id} className="text-[11px] text-stone-500 border-t border-stone-800 pt-1">{ev.title}</div>
              ))}
            </div>
          )}
        </section>

        <section className={card}>
          <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "عهدتي", en: "My custody" })}</h2>
          <p className="text-xs text-stone-400 leading-relaxed mb-2">
            {openCustody.length > 0
              ? t({ ar: `لديك ${openCustody.length} عهدة مفتوحة باسمك.`, en: `You have ${openCustody.length} open custody record(s).` })
              : t({ ar: "لا توجد عهدة مفتوحة باسمك.", en: "No open custody in your name." })}
          </p>
          {openCustody.slice(0, 3).map((c) => (
            <div key={c.id} className="text-[11px] font-mono text-stone-500"><span dir="ltr">{c.record_no}</span> — {c.status}</div>
          ))}
          <Link href="/client-portal/equipment" className={`${btnGhost} inline-block mt-3 px-4 py-2`}>
            {t({ ar: "فتح نظام العهدة", en: "Open custody system" })}
          </Link>
        </section>
      </div>

      {/* آخر الحضور */}
      <section className={card}>
        <h2 className="text-base font-medium text-stone-100 mb-3">{t({ ar: "آخر جلسات الحضور", en: "Recent attendance sessions" })}</h2>
        {attendance.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا سجلات بعد.", en: "No records yet." })}</p>}
        <div className="space-y-1">
          {attendance.map((a) => (
            <div key={a.id} className="flex items-center gap-3 flex-wrap text-[11.5px] font-mono text-stone-400 border-t border-stone-800 py-1.5">
              <span dir="ltr">{a.work_date}</span>
              <span>{t({ ar: "حضور", en: "In" })} {fmtTime(a.check_in_at, isAr)}</span>
              <span>{t({ ar: "انصراف", en: "Out" })} {fmtTime(a.check_out_at, isAr)}</span>
              {a.status === "manual_adjusted" && <span className="text-amber-400">{t({ ar: "مُعدّل إدارياً", en: "Adjusted" })}</span>}
            </div>
          ))}
        </div>
      </section>

      {toast && (
        <div className="fixed bottom-5 z-50 bg-black/90 border border-stone-700 rounded-xl px-4 py-2.5 text-sm text-white max-w-sm" style={{ insetInlineEnd: 20 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
