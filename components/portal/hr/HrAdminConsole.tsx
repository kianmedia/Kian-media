"use client";
// ════════════════════════════════════════════════════════════════════════
// لوحة الموارد البشرية (owner/manager/hr) — أقسام داخلية: نظرة عامة، الموظفون
// (إنشاء/تعديل/ربط حساب/ملاحظات/سجل)، الحضور (فلترة + روابط خرائط + تعديل
// إداري بسبب إلزامي)، الإجازات (قبول/رفض بسبب)، المهام الميدانية (إنشاء/إسناد/
// اعتماد إغلاق). كل الأزرار تستدعي RPCs محمية — واجهة فقط.
// ════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  hrListEmployees, hrListAttendance, hrListLeaves, hrListTasks, hrListAssignees,
  hrListEmployeeEvents, hrAdminListStaff, hrAdminUpsertEmployee, hrOwnerDeleteEmployee,
  hrAdminAdjustAttendance, hrAdminDecideLeave, hrAdminCreateTask, hrAdminCloseTask,
  hrAdminAddEmployeeEvent, emitHrEvent, mapsLink,
  LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, TASK_STATUS_LABELS,
  type HrEmployee, type HrAttendance, type HrLeave, type HrTask, type HrAssignee,
  type HrEvent, type HrStaffOption, type EmploymentStatus, type AttendanceStatus,
} from "@/lib/portal/hr";

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const inp = "w-full bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const chip = (cls: string) => `inline-block rounded-full border px-2 py-0.5 text-[10.5px] ${cls}`;

function todayRiyadh(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
}
const fmtDT = (iso: string | null, isAr: boolean) =>
  iso ? new Date(iso).toLocaleString(isAr ? "ar-SA" : "en-GB", { dateStyle: "short", timeStyle: "short" }) : "—";
const fmtT = (iso: string | null, isAr: boolean) =>
  iso ? new Date(iso).toLocaleTimeString(isAr ? "ar-SA" : "en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

type Tab = "overview" | "employees" | "attendance" | "leaves" | "tasks";

export default function HrAdminConsole() {
  const { t, isAr } = useI18n();
  const { caps } = usePortal();
  const [tab, setTab] = useState<Tab>("overview");
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [staff, setStaff] = useState<HrStaffOption[]>([]);
  const [attendance, setAttendance] = useState<HrAttendance[]>([]);
  const [leaves, setLeaves] = useState<HrLeave[]>([]);
  const [tasks, setTasks] = useState<HrTask[]>([]);
  const [assigneesByTask, setAssigneesByTask] = useState<Record<string, HrAssignee[]>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const flash = (m: string) => { setToast(m); window.setTimeout(() => setToast(null), 3800); };

  const [attFrom, setAttFrom] = useState(todayRiyadh());
  const [attTo, setAttTo] = useState(todayRiyadh());
  const [attUser, setAttUser] = useState("");
  // عدّادات النظرة العامة تُحسب من جلبة "اليوم" المستقلة — لا تتأثر بفلتر تبويب الحضور.
  const [todayAttendance, setTodayAttendance] = useState<HrAttendance[]>([]);

  const reload = useCallback(async () => {
    const td = todayRiyadh();
    const [emp, st, att, tdAtt, lv, tk] = await Promise.all([
      hrListEmployees(), hrAdminListStaff(),
      hrListAttendance(attFrom, attTo, attUser || undefined),
      hrListAttendance(td, td),
      hrListLeaves(), hrListTasks(),
    ]);
    if (!emp.ok) { setPhase("error"); return; }
    setEmployees(emp.data);
    if (st.ok) setStaff(st.data);
    if (att.ok) setAttendance(att.data);
    if (tdAtt.ok) setTodayAttendance(tdAtt.data);
    if (lv.ok) setLeaves(lv.data);
    if (tk.ok) setTasks(tk.data);
    setPhase("ready");
  }, [attFrom, attTo, attUser]);
  useEffect(() => { void reload(); }, [reload]);

  const byUser = useMemo(() => {
    const m: Record<string, HrEmployee> = {};
    employees.forEach((e) => { if (e.user_id) m[e.user_id] = e; });
    return m;
  }, [employees]);
  const empName = (userId: string) => byUser[userId]?.full_name || userId.slice(0, 8);

  // ─── نظرة عامة (من جلبة اليوم المستقلة) ───
  const activeCount = employees.filter((e) => e.employment_status === "active").length;
  const presentNow = todayAttendance.filter((a) => a.check_in_at && !a.check_out_at).length;
  const checkedToday = todayAttendance.filter((a) => a.check_in_at).length;
  const pendingLeaves = leaves.filter((l) => l.status === "pending");
  const openTasks = tasks.filter((x) => ["assigned", "in_progress", "submitted"].includes(x.status));

  // ─── الموظفون ───
  const emptyForm = { id: "", userId: "", fullName: "", email: "", phone: "", jobTitle: "", department: "", status: "active" as EmploymentStatus, joined: "", notesInternal: "", notesVisible: "" };
  const [form, setForm] = useState(emptyForm);
  const [openEmp, setOpenEmp] = useState<string | null>(null);
  const [empEvents, setEmpEvents] = useState<Record<string, HrEvent[]>>({});
  const [noteForm, setNoteForm] = useState({ title: "", desc: "", visible: false });

  async function saveEmployee() {
    if (!form.fullName.trim()) { flash(t({ ar: "الاسم مطلوب.", en: "Name required." })); return; }
    setBusy(true);
    const r = await hrAdminUpsertEmployee({
      id: form.id || null, userId: form.userId || null, fullName: form.fullName.trim(),
      email: form.email, phone: form.phone, jobTitle: form.jobTitle, department: form.department,
      status: form.status, joined: form.joined || null,
      notesInternal: form.notesInternal, notesVisible: form.notesVisible,
    });
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    setForm(emptyForm);
    await reload();
    flash(t({ ar: "حُفظ ملف الموظف.", en: "Employee saved." }));
  }
  async function loadEvents(empId: string) {
    const r = await hrListEmployeeEvents(empId);
    if (r.ok) setEmpEvents((p) => ({ ...p, [empId]: r.data }));
  }
  async function addNote(emp: HrEmployee) {
    if (!noteForm.title.trim()) { flash(t({ ar: "اكتب عنوان الملاحظة.", en: "Note title required." })); return; }
    setBusy(true);
    const r = await hrAdminAddEmployeeEvent(emp.id, noteForm.title.trim(), noteForm.desc.trim() || undefined, noteForm.visible);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    if (noteForm.visible && emp.user_id) {
      emitHrEvent({ event: "hr_note_new", entity_id: emp.id, title: "ملاحظة HR: " + noteForm.title.trim(), employee_name: emp.full_name, employee_user_id: emp.user_id });
    }
    setNoteForm({ title: "", desc: "", visible: false });
    await loadEvents(emp.id);
    flash(t({ ar: "أُضيفت الملاحظة.", en: "Note added." }));
  }

  // ─── الحضور: تعديل إداري ───
  const [adjFor, setAdjFor] = useState<HrAttendance | null>(null);
  const [adj, setAdj] = useState({ checkIn: "", checkOut: "", status: "" as AttendanceStatus | "", reason: "" });
  async function saveAdjust() {
    if (!adjFor) return;
    if (!adj.reason.trim()) { flash(t({ ar: "سبب التعديل إلزامي.", en: "Reason is required." })); return; }
    setBusy(true);
    const r = await hrAdminAdjustAttendance(adjFor.id, {
      checkIn: adj.checkIn ? new Date(adj.checkIn).toISOString() : null,
      checkOut: adj.checkOut ? new Date(adj.checkOut).toISOString() : null,
      status: (adj.status || null) as AttendanceStatus | null,
      reason: adj.reason.trim(),
    });
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    emitHrEvent({ event: "hr_attendance_adjusted", entity_id: adjFor.id, title: "تعديل حضور " + adjFor.work_date, employee_name: empName(adjFor.user_id), employee_user_id: adjFor.user_id });
    setAdjFor(null); setAdj({ checkIn: "", checkOut: "", status: "", reason: "" });
    await reload();
    flash(t({ ar: "عُدّل السجل ووُثّق السبب.", en: "Adjusted & audited." }));
  }

  // ─── الإجازات ───
  const [decNote, setDecNote] = useState<Record<string, string>>({});
  async function decide(l: HrLeave, approve: boolean) {
    const note = (decNote[l.id] || "").trim();
    if (!approve && !note) { flash(t({ ar: "سبب الرفض إلزامي.", en: "Rejection reason required." })); return; }
    setBusy(true);
    const r = await hrAdminDecideLeave(l.id, approve, note || undefined);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    emitHrEvent({ event: "hr_leave_decided", entity_id: l.id, title: (approve ? "اعتماد إجازة " : "رفض إجازة ") + empName(l.user_id), employee_name: empName(l.user_id), employee_user_id: l.user_id });
    setDecNote((p) => ({ ...p, [l.id]: "" }));
    await reload();
    flash(approve ? t({ ar: "اعتُمد الطلب.", en: "Approved." }) : t({ ar: "رُفض الطلب.", en: "Rejected." }));
  }

  // ─── المهام ───
  const [tf, setTf] = useState({ title: "", desc: "", location: "", start: "", end: "", assignees: [] as string[] });
  const [openTask, setOpenTask] = useState<string | null>(null);
  async function createTask() {
    if (!tf.title.trim()) { flash(t({ ar: "عنوان المهمة مطلوب.", en: "Title required." })); return; }
    if (tf.assignees.length === 0) { flash(t({ ar: "اختر موظفاً واحداً على الأقل.", en: "Pick at least one employee." })); return; }
    setBusy(true);
    const assignedIds = [...tf.assignees];   // نلتقطها قبل تصفير النموذج — لإيميلات المسندين
    const r = await hrAdminCreateTask({
      title: tf.title.trim(), description: tf.desc.trim() || undefined, location: tf.location.trim() || undefined,
      expectedStart: tf.start ? new Date(tf.start).toISOString() : null,
      expectedEnd: tf.end ? new Date(tf.end).toISOString() : null,
      assignees: assignedIds,
    });
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    emitHrEvent({ event: "hr_task_new", entity_id: r.data.id, title: "مهمة جديدة: " + tf.title.trim(), employee_user_ids: assignedIds });
    setTf({ title: "", desc: "", location: "", start: "", end: "", assignees: [] });
    await reload();
    flash(t({ ar: "أُنشئت المهمة وأُشعر المسندون.", en: "Task created & assignees notified." }));
  }
  async function closeTask(tk: HrTask, action: "complete" | "cancel") {
    setBusy(true);
    // اجلب المسندين (إن لم يكونوا محمّلين) حتى تصلهم إيميلات الإغلاق.
    let ids = (assigneesByTask[tk.id] ?? []).map((a) => a.user_id);
    if (ids.length === 0) {
      const ar = await hrListAssignees(tk.id);
      if (ar.ok) { setAssigneesByTask((p) => ({ ...p, [tk.id]: ar.data })); ids = ar.data.map((a) => a.user_id); }
    }
    const r = await hrAdminCloseTask(tk.id, action);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    emitHrEvent({ event: "hr_task_closed", entity_id: tk.id, title: (action === "complete" ? "إغلاق مهمة: " : "إلغاء مهمة: ") + tk.title, employee_user_ids: ids });
    await reload();
    flash(action === "complete" ? t({ ar: "أُغلقت المهمة.", en: "Closed." }) : t({ ar: "أُلغيت المهمة.", en: "Cancelled." }));
  }
  async function toggleTask(id: string) {
    if (openTask === id) { setOpenTask(null); return; }
    setOpenTask(id);
    if (!assigneesByTask[id]) {
      const r = await hrListAssignees(id);
      if (r.ok) setAssigneesByTask((p) => ({ ...p, [id]: r.data }));
    }
  }

  if (phase === "loading") return <p className="text-stone-500 text-sm">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return <p className="text-red-400 text-sm">{t({ ar: "تعذّر التحميل — شغّل ترحيل قاعدة البيانات (portal_hr_employee_portal_RUNME.sql) أولاً.", en: "Couldn't load — run the HR migration first." })}</p>;

  const TABS: { key: Tab; ar: string; en: string }[] = [
    { key: "overview",   ar: "نظرة عامة", en: "Overview" },
    { key: "employees",  ar: "الموظفون",  en: "Employees" },
    { key: "attendance", ar: "الحضور",    en: "Attendance" },
    { key: "leaves",     ar: "الإجازات",  en: "Leaves" },
    { key: "tasks",      ar: "المهام",    en: "Tasks" },
  ];

  return (
    <div className="space-y-4">
      {/* sub-tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {TABS.map((x) => (
          <button key={x.key} type="button" onClick={() => setTab(x.key)}
            className={`rounded-lg px-3.5 py-2 text-xs font-medium border ${tab === x.key ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"}`}>
            {t({ ar: x.ar, en: x.en })}
            {x.key === "leaves" && pendingLeaves.length > 0 && <span className="ms-1.5 bg-white/20 rounded-full px-1.5">{pendingLeaves.length}</span>}
          </button>
        ))}
      </div>

      {/* ═══ نظرة عامة ═══ */}
      {tab === "overview" && (
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {[
            { l: t({ ar: "موظفون نشطون", en: "Active staff" }), v: activeCount },
            { l: t({ ar: "سجّلوا حضوراً اليوم", en: "Checked in today" }), v: `${checkedToday}/${activeCount}` },
            { l: t({ ar: "حاضرون الآن", en: "Present now" }), v: presentNow },
            { l: t({ ar: "إجازات معلّقة", en: "Pending leaves" }), v: pendingLeaves.length },
            { l: t({ ar: "مهام مفتوحة", en: "Open tasks" }), v: openTasks.length },
            { l: t({ ar: "لم يسجّلوا اليوم", en: "Not checked in" }), v: Math.max(activeCount - checkedToday, 0) },
          ].map((c, i) => (
            <div key={i} className={card + " text-center"}>
              <div className="text-2xl font-bold text-white">{c.v}</div>
              <div className="text-[11px] text-stone-500 mt-1">{c.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ الموظفون ═══ */}
      {tab === "employees" && (
        <div className="space-y-4">
          <section className={card}>
            <h3 className="text-sm font-medium text-stone-100 mb-3">{form.id ? t({ ar: "تعديل ملف موظف", en: "Edit employee" }) : t({ ar: "إضافة موظف", en: "Add employee" })}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} placeholder={t({ ar: "الاسم الكامل *", en: "Full name *" })} className={inp} />
              <select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} className={inp}>
                <option value="">{t({ ar: "— ربط بحساب بوابة (اختياري) —", en: "— Link portal account (optional) —" })}</option>
                {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.full_name || s.email} ({s.staff_role || "admin"})</option>)}
              </select>
              <input value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} placeholder={t({ ar: "المسمى الوظيفي", en: "Job title" })} className={inp} />
              <input value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} placeholder={t({ ar: "القسم", en: "Department" })} className={inp} />
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder={t({ ar: "الجوال", en: "Phone" })} dir="ltr" className={inp} />
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder={t({ ar: "البريد", en: "Email" })} dir="ltr" className={inp} />
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "تاريخ الانضمام", en: "Joined" })}</label>
                <input type="date" value={form.joined} onChange={(e) => setForm({ ...form, joined: e.target.value })} className={inp} dir="ltr" />
              </div>
              <div>
                <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "الحالة", en: "Status" })}</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as EmploymentStatus })} className={inp}>
                  <option value="active">{t({ ar: "نشط", en: "Active" })}</option>
                  <option value="suspended">{t({ ar: "موقوف", en: "Suspended" })}</option>
                  <option value="left">{t({ ar: "انتهت خدمته", en: "Left" })}</option>
                </select>
              </div>
            </div>
            <textarea value={form.notesVisible} onChange={(e) => setForm({ ...form, notesVisible: e.target.value })} rows={2}
              placeholder={t({ ar: "ملاحظة تظهر للموظف (اختياري)", en: "Note visible to employee (optional)" })} className={inp + " mt-2"} />
            <textarea value={form.notesInternal} onChange={(e) => setForm({ ...form, notesInternal: e.target.value })} rows={2}
              placeholder={t({ ar: "ملاحظات داخلية (لا تظهر للموظف)", en: "Internal notes (HR only)" })} className={inp + " mt-2"} />
            <div className="flex gap-2 mt-3">
              <button type="button" disabled={busy} onClick={() => void saveEmployee()} className={`${btnRed} px-5 py-2`}>{t({ ar: "حفظ", en: "Save" })}</button>
              {form.id && <button type="button" onClick={() => setForm(emptyForm)} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إلغاء التعديل", en: "Cancel edit" })}</button>}
            </div>
          </section>

          <div className="space-y-2">
            {employees.map((e) => (
              <div key={e.id} className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
                <button type="button" className="w-full flex items-center gap-2 p-3 text-start flex-wrap"
                  onClick={() => { const v = openEmp === e.id ? null : e.id; setOpenEmp(v); if (v) void loadEvents(e.id); }}>
                  <span className="text-sm font-medium text-stone-100">{e.full_name}</span>
                  <span className="text-[11px] text-stone-500">{e.job_title || e.staff_role_snapshot || ""}</span>
                  <span className={chip(e.employment_status === "active" ? "bg-emerald-950 text-emerald-300 border-emerald-800" : e.employment_status === "suspended" ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-stone-800 text-stone-400 border-stone-700")}>
                    {e.employment_status === "active" ? t({ ar: "نشط", en: "Active" }) : e.employment_status === "suspended" ? t({ ar: "موقوف", en: "Suspended" }) : t({ ar: "انتهت خدمته", en: "Left" })}
                  </span>
                  {!e.user_id && <span className={chip("bg-sky-950 text-sky-300 border-sky-800")}>{t({ ar: "غير مرتبط بحساب", en: "Unlinked" })}</span>}
                  <span className="ms-auto text-stone-500 text-xs">{openEmp === e.id ? "▲" : "▼"}</span>
                </button>
                {openEmp === e.id && (
                  <div className="px-3 pb-3 space-y-2">
                    <div className="text-[11px] font-mono text-stone-500">
                      <span dir="ltr">{e.phone || "—"}</span> • <span dir="ltr">{e.email || "—"}</span> • {t({ ar: "انضم", en: "Joined" })}: <span dir="ltr">{e.joined_at || "—"}</span>
                    </div>
                    {e.notes_internal && <div className="text-[11px] text-amber-300/80">{t({ ar: "داخلي: ", en: "Internal: " })}{e.notes_internal}</div>}
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className={`${btnGhost} px-3 py-1.5 text-xs`}
                        onClick={() => setForm({ id: e.id, userId: e.user_id || "", fullName: e.full_name, email: e.email || "", phone: e.phone || "", jobTitle: e.job_title || "", department: e.department || "", status: e.employment_status, joined: e.joined_at || "", notesInternal: e.notes_internal || "", notesVisible: e.notes_visible_to_employee || "" })}>
                        {t({ ar: "تعديل", en: "Edit" })}
                      </button>
                      {caps.isOwner && (
                        <button type="button" disabled={busy} className="text-[11px] text-stone-500 hover:text-red-400 underline"
                          onClick={() => { if (window.confirm(t({ ar: `حذف ملف ${e.full_name}؟`, en: `Delete ${e.full_name}?` }))) void (async () => { const r = await hrOwnerDeleteEmployee(e.id); if (r.ok) { await reload(); flash(t({ ar: "حُذف.", en: "Deleted." })); } else flash(r.error); })(); }}>
                          {t({ ar: "حذف (للمالك)", en: "Delete (owner)" })}
                        </button>
                      )}
                    </div>
                    {/* سجل الموظف + ملاحظة */}
                    <div className="border-t border-stone-800 pt-2 space-y-1">
                      {(empEvents[e.id] ?? []).slice(0, 10).map((ev) => (
                        <div key={ev.id} className="text-[11px] text-stone-500 flex gap-2 flex-wrap">
                          <span className="font-mono" dir="ltr">{fmtDT(ev.created_at, isAr)}</span>
                          <span className="text-stone-400">{ev.title}</span>
                          {ev.visible_to_employee && <span className="text-emerald-500">({t({ ar: "مرئي له", en: "visible" })})</span>}
                        </div>
                      ))}
                      <div className="flex gap-2 flex-wrap items-center pt-1">
                        <input value={noteForm.title} onChange={(ev2) => setNoteForm({ ...noteForm, title: ev2.target.value })}
                          placeholder={t({ ar: "ملاحظة HR جديدة…", en: "New HR note…" })} className={inp + " flex-1 min-w-[160px]"} style={{ width: "auto" }} />
                        <label className="flex items-center gap-1 text-[11px] text-stone-400 cursor-pointer whitespace-nowrap">
                          <input type="checkbox" checked={noteForm.visible} onChange={(ev2) => setNoteForm({ ...noteForm, visible: ev2.target.checked })} className="accent-red-600" />
                          {t({ ar: "تظهر للموظف", en: "Visible" })}
                        </label>
                        <button type="button" disabled={busy} onClick={() => void addNote(e)} className={`${btnGhost} px-3 py-2 text-xs`}>{t({ ar: "إضافة", en: "Add" })}</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ الحضور ═══ */}
      {tab === "attendance" && (
        <div className="space-y-3">
          <div className={card}>
            <div className="grid gap-2 sm:grid-cols-3">
              <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "من", en: "From" })}</label>
                <input type="date" value={attFrom} onChange={(e) => setAttFrom(e.target.value)} className={inp} dir="ltr" /></div>
              <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "إلى", en: "To" })}</label>
                <input type="date" value={attTo} onChange={(e) => setAttTo(e.target.value)} className={inp} dir="ltr" /></div>
              <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "الموظف", en: "Employee" })}</label>
                <select value={attUser} onChange={(e) => setAttUser(e.target.value)} className={inp}>
                  <option value="">{t({ ar: "— الكل —", en: "— All —" })}</option>
                  {employees.filter((e) => e.user_id).map((e) => <option key={e.id} value={e.user_id!}>{e.full_name}</option>)}
                </select></div>
            </div>
          </div>
          {attendance.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا سجلات في هذا النطاق.", en: "No records in range." })}</p>}
          <div className="space-y-1.5">
            {attendance.map((a) => (
              <div key={a.id} className="bg-stone-900 border border-stone-800 rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap text-xs">
                <span className="text-stone-100 font-medium">{empName(a.user_id)}</span>
                <span className="font-mono text-stone-500" dir="ltr">{a.work_date}</span>
                <span className="font-mono text-stone-400" dir="ltr">{fmtT(a.check_in_at, isAr)} → {fmtT(a.check_out_at, isAr)}</span>
                {mapsLink(a.check_in_lat, a.check_in_lng) && (
                  <a className="text-sky-400 underline" href={mapsLink(a.check_in_lat, a.check_in_lng)!} target="_blank" rel="noopener noreferrer">{t({ ar: "موقع الحضور", en: "In loc" })}</a>
                )}
                {mapsLink(a.check_out_lat, a.check_out_lng) && (
                  <a className="text-sky-400 underline" href={mapsLink(a.check_out_lat, a.check_out_lng)!} target="_blank" rel="noopener noreferrer">{t({ ar: "موقع الانصراف", en: "Out loc" })}</a>
                )}
                {a.status === "manual_adjusted" && <span className="text-amber-400">{t({ ar: "مُعدّل", en: "Adjusted" })}</span>}
                <button type="button" onClick={() => { setAdjFor(a); setAdj({ checkIn: "", checkOut: "", status: "", reason: "" }); }}
                  className="ms-auto text-red-300 underline">{t({ ar: "تعديل إداري", en: "Adjust" })}</button>
              </div>
            ))}
          </div>

          {adjFor && (
            <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4" onClick={() => setAdjFor(null)}>
              <div className={card + " w-full max-w-md space-y-2"} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-sm font-medium text-stone-100">
                  {t({ ar: "تعديل إداري — ", en: "Adjust — " })}{empName(adjFor.user_id)} <span className="font-mono text-stone-500" dir="ltr">{adjFor.work_date}</span>
                </h3>
                <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "وقت الحضور الجديد (اتركه فارغاً بلا تغيير)", en: "New check-in (blank = keep)" })}</label>
                  <input type="datetime-local" value={adj.checkIn} onChange={(e) => setAdj({ ...adj, checkIn: e.target.value })} className={inp} dir="ltr" /></div>
                <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "وقت الانصراف الجديد", en: "New check-out" })}</label>
                  <input type="datetime-local" value={adj.checkOut} onChange={(e) => setAdj({ ...adj, checkOut: e.target.value })} className={inp} dir="ltr" /></div>
                <select value={adj.status} onChange={(e) => setAdj({ ...adj, status: e.target.value as AttendanceStatus | "" })} className={inp}>
                  <option value="">{t({ ar: "— الحالة (اختياري) —", en: "— Status (optional) —" })}</option>
                  <option value="present">{t({ ar: "حاضر", en: "Present" })}</option>
                  <option value="late">{t({ ar: "متأخر", en: "Late" })}</option>
                  <option value="absent">{t({ ar: "غائب", en: "Absent" })}</option>
                  <option value="half_day">{t({ ar: "نصف يوم", en: "Half day" })}</option>
                </select>
                <textarea value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} rows={2}
                  placeholder={t({ ar: "سبب التعديل (إلزامي — يُوثّق ويُشعر الموظف)", en: "Reason (required — audited & employee notified)" })} className={inp} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void saveAdjust()} className={`${btnRed} flex-1 py-2`}>{t({ ar: "حفظ التعديل", en: "Save" })}</button>
                  <button type="button" onClick={() => setAdjFor(null)} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إغلاق", en: "Close" })}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ الإجازات ═══ */}
      {tab === "leaves" && (
        <div className="space-y-2">
          {leaves.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا توجد طلبات.", en: "No requests." })}</p>}
          {[...pendingLeaves, ...leaves.filter((l) => l.status !== "pending")].map((l) => (
            <div key={l.id} className="bg-stone-900 border border-stone-800 rounded-xl p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <span className="text-stone-100 font-medium">{empName(l.user_id)}</span>
                <span className="text-stone-400">{t(LEAVE_TYPE_LABELS[l.leave_type])}</span>
                <span className="font-mono text-stone-500" dir="ltr">{l.start_date}{l.end_date ? ` → ${l.end_date}` : ""}{l.start_time ? ` (${l.start_time}${l.end_time ? `–${l.end_time}` : ""})` : ""}</span>
                <span className={chip(l.status === "approved" ? "bg-emerald-950 text-emerald-300 border-emerald-800" : l.status === "rejected" ? "bg-red-950 text-red-300 border-red-800" : l.status === "cancelled" ? "bg-stone-800 text-stone-400 border-stone-700" : "bg-sky-950 text-sky-300 border-sky-800")}>
                  {t(LEAVE_STATUS_LABELS[l.status])}
                </span>
              </div>
              <p className="text-xs text-stone-400">{l.reason}</p>
              {l.decision_note && <p className="text-[11px] text-stone-500">{t({ ar: "قرار: ", en: "Decision: " })}{l.decision_note}</p>}
              {l.status === "pending" && (
                <div className="flex gap-2 flex-wrap items-center">
                  <input value={decNote[l.id] || ""} onChange={(e) => setDecNote((p) => ({ ...p, [l.id]: e.target.value }))}
                    placeholder={t({ ar: "ملاحظة القرار (إلزامية عند الرفض)", en: "Decision note (required to reject)" })} className={inp + " flex-1 min-w-[180px]"} style={{ width: "auto" }} />
                  <button type="button" disabled={busy} onClick={() => void decide(l, true)} className={`${btnRed} px-4 py-2 text-xs`}>{t({ ar: "اعتماد", en: "Approve" })}</button>
                  <button type="button" disabled={busy} onClick={() => void decide(l, false)} className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-xs px-4 py-2 disabled:opacity-50">{t({ ar: "رفض", en: "Reject" })}</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ═══ المهام ═══ */}
      {tab === "tasks" && (
        <div className="space-y-4">
          <section className={card}>
            <h3 className="text-sm font-medium text-stone-100 mb-3">{t({ ar: "إنشاء مهمة ميدانية", en: "Create field task" })}</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={tf.title} onChange={(e) => setTf({ ...tf, title: e.target.value })} placeholder={t({ ar: "عنوان المهمة *", en: "Title *" })} className={inp} />
              <input value={tf.location} onChange={(e) => setTf({ ...tf, location: e.target.value })} placeholder={t({ ar: "موقع المهمة (اسم/وصف)", en: "Location" })} className={inp} />
              <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "بداية متوقعة", en: "Expected start" })}</label>
                <input type="datetime-local" value={tf.start} onChange={(e) => setTf({ ...tf, start: e.target.value })} className={inp} dir="ltr" /></div>
              <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "نهاية متوقعة", en: "Expected end" })}</label>
                <input type="datetime-local" value={tf.end} onChange={(e) => setTf({ ...tf, end: e.target.value })} className={inp} dir="ltr" /></div>
            </div>
            <textarea value={tf.desc} onChange={(e) => setTf({ ...tf, desc: e.target.value })} rows={2}
              placeholder={t({ ar: "تفاصيل / ملاحظات", en: "Details / notes" })} className={inp + " mt-2"} />
            <div className="mt-2">
              <div className="text-[11px] text-stone-500 mb-1">{t({ ar: "المسندون *", en: "Assignees *" })}</div>
              <div className="flex gap-1.5 flex-wrap">
                {staff.map((s) => {
                  const on = tf.assignees.includes(s.user_id);
                  return (
                    <button key={s.user_id} type="button"
                      onClick={() => setTf({ ...tf, assignees: on ? tf.assignees.filter((x) => x !== s.user_id) : [...tf.assignees, s.user_id] })}
                      className={`rounded-full border px-3 py-1 text-[11px] ${on ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"}`}>
                      {s.full_name || s.email}
                    </button>
                  );
                })}
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => void createTask()} className={`${btnRed} mt-3 px-5 py-2`}>{t({ ar: "إنشاء وإسناد", en: "Create & assign" })}</button>
          </section>

          <div className="space-y-2">
            {tasks.map((tk) => {
              const st = TASK_STATUS_LABELS[tk.status] ?? { ar: tk.status, en: tk.status };
              const open = openTask === tk.id;
              return (
                <div key={tk.id} className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
                  <button type="button" onClick={() => void toggleTask(tk.id)} className="w-full flex items-center gap-2 p-3 text-start flex-wrap">
                    <span className="text-sm font-medium text-stone-100">{tk.title}</span>
                    <span className={chip("bg-stone-800 text-stone-300 border-stone-700")}>{t(st)}</span>
                    {tk.location_name && <span className="text-[11px] text-stone-500">📍 {tk.location_name}</span>}
                    <span className="ms-auto text-stone-500 text-xs">{open ? "▲" : "▼"}</span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 space-y-2">
                      {tk.description && <p className="text-xs text-stone-400">{tk.description}</p>}
                      <div className="space-y-1">
                        {(assigneesByTask[tk.id] ?? []).map((a) => (
                          <div key={a.id} className="text-[11px] text-stone-400 flex gap-2 flex-wrap items-center border-t border-stone-800 pt-1.5">
                            <span className="text-stone-200">{empName(a.user_id)}</span>
                            <span className={chip("bg-stone-800 text-stone-400 border-stone-700")}>{t(TASK_STATUS_LABELS[a.status as keyof typeof TASK_STATUS_LABELS] ?? { ar: a.status, en: a.status })}</span>
                            {a.started_at && <span className="font-mono" dir="ltr">▶ {fmtDT(a.started_at, isAr)}</span>}
                            {mapsLink(a.start_lat, a.start_lng) && <a className="text-sky-400 underline" href={mapsLink(a.start_lat, a.start_lng)!} target="_blank" rel="noopener noreferrer">{t({ ar: "موقع البدء", en: "Start loc" })}</a>}
                            {a.ended_at && <span className="font-mono" dir="ltr">■ {fmtDT(a.ended_at, isAr)}</span>}
                            {mapsLink(a.end_lat, a.end_lng) && <a className="text-sky-400 underline" href={mapsLink(a.end_lat, a.end_lng)!} target="_blank" rel="noopener noreferrer">{t({ ar: "موقع الإنهاء", en: "End loc" })}</a>}
                            {a.employee_note && <span className="text-stone-500">— {a.employee_note}</span>}
                          </div>
                        ))}
                      </div>
                      {["assigned", "in_progress", "submitted"].includes(tk.status) && (
                        <div className="flex gap-2 flex-wrap pt-1">
                          <button type="button" disabled={busy} onClick={() => void closeTask(tk, "complete")} className={`${btnRed} px-4 py-2 text-xs`}>
                            {t({ ar: "اعتماد الإغلاق", en: "Approve closure" })}
                          </button>
                          <button type="button" disabled={busy} onClick={() => void closeTask(tk, "cancel")} className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-xs px-4 py-2 disabled:opacity-50">
                            {t({ ar: "إلغاء المهمة", en: "Cancel task" })}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 z-50 bg-black/90 border border-stone-700 rounded-xl px-4 py-2.5 text-sm text-white max-w-sm" style={{ insetInlineEnd: 20 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
