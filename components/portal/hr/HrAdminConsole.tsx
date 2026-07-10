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
  hrListEmployeeEvents, hrAdminListStaff, hrAdminUpsertEmployee,
  hrAdminAdjustAttendance, hrAdminDecideLeave,
  hrAdminCloseTask, hrAdminAddEmployeeEvent, hrGetSettings,
  hrAdminSoftDeleteLeave, hrAdminUpdateLeave, hrAdminVoidAttendance, hrAdminSoftDeleteTask,
  hrAdminUpdateEmployeeStatus, hrOwnerSoftDeleteEmployee, hrAdminReviewTask, hrListTaskReviews,
  hrListDeviceUsers, hrListCorrections, hrAdminLongOpenSessions, hrAdminExpiringDocuments,
  hrListSupervisorLinks, hrAdminSetSupervisorLink, hrTaskAssignDispatch,
  hrAdminRequestRevision, hrListTaskEvidence, signHrFiles,
  emitHrEvent, mapsLink, DEFAULT_HR_SETTINGS,
  LEAVE_TYPE_LABELS, LEAVE_STATUS_LABELS, TASK_STATUS_LABELS, TASK_TYPE_LABELS, TASK_PRIORITY_LABELS,
  DOCUMENT_TYPE_LABELS, EVIDENCE_MODE_LABELS,
  type HrEmployee, type HrAttendance, type HrLeave, type HrTask, type HrAssignee,
  type HrEvent, type HrStaffOption, type EmploymentStatus, type AttendanceStatus,
  type TaskType, type TaskPriority, type HrSettings, type HrTaskReview, type HrDeviceUser,
  type HrLongOpenSession, type HrExpiringDoc, type HrSupervisorLink,
  type EvidenceMode, type HrTaskEvidence,
} from "@/lib/portal/hr";
import { listMyCustodyRecords, type CustodyRecord } from "@/lib/portal/custody";
import HrSettingsPanel from "@/components/portal/hr/HrSettingsPanel";
import HrMonthlyReport from "@/components/portal/hr/HrMonthlyReport";
import HrDevices from "@/components/portal/hr/HrDevices";
import HrCorrectionRequests from "@/components/portal/hr/HrCorrectionRequests";
import HrCalendar from "@/components/portal/hr/HrCalendar";
import HrPayrollReport from "@/components/portal/hr/HrPayrollReport";
import HrAuditLog from "@/components/portal/hr/HrAuditLog";
import HrEmployeeDocuments from "@/components/portal/hr/HrEmployeeDocuments";

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
const toLocalInput = (iso: string | null) => {
  // ISO → قيمة datetime-local بالمنطقة المحلية (لتعبئة نموذج التعديل)
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

type Tab = "overview" | "employees" | "attendance" | "corrections" | "leaves" | "tasks"
  | "monthly" | "payroll" | "documents" | "devices" | "calendar" | "audit" | "supervisors" | "settings";
type EmpFilter = "" | "active" | "not_today";
type AttFilter = "" | "today" | "open_now";

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
  const [settings, setSettings] = useState<HrSettings>(DEFAULT_HR_SETTINGS);
  // فلاتر الكروت التفاعلية (v3) — شارة أعلى كل تبويب + زر "عرض الكل".
  const [empFilter, setEmpFilter] = useState<EmpFilter>("");
  const [attFilter, setAttFilter] = useState<AttFilter>("");
  const [leaveFilter, setLeaveFilter] = useState<"" | "pending">("");
  const [taskFilter, setTaskFilter] = useState<"" | "open">("");
  const [corrPendingOnly, setCorrPendingOnly] = useState(false);
  // عدّادات/بيانات v3.1 التشغيلية.
  const [pendingCorrections, setPendingCorrections] = useState(0);
  const [longOpen, setLongOpen] = useState<HrLongOpenSession[]>([]);
  const [expiring, setExpiring] = useState<HrExpiringDoc[]>([]);
  const [supLinks, setSupLinks] = useState<HrSupervisorLink[]>([]);

  const reload = useCallback(async () => {
    const td = todayRiyadh();
    const [emp, st, att, tdAtt, lv, tk, cfg, corr, lo, exp, sl] = await Promise.all([
      hrListEmployees(), hrAdminListStaff(),
      hrListAttendance(attFrom, attTo, attUser || undefined),
      hrListAttendance(td, td),
      hrListLeaves(), hrListTasks(), hrGetSettings(),
      hrListCorrections("pending"), hrAdminLongOpenSessions(), hrAdminExpiringDocuments(90), hrListSupervisorLinks(),
    ]);
    if (!emp.ok) { setPhase("error"); return; }
    setEmployees(emp.data);
    if (st.ok) setStaff(st.data);
    if (att.ok) setAttendance(att.data);
    if (tdAtt.ok) setTodayAttendance(tdAtt.data);
    if (lv.ok) setLeaves(lv.data);
    if (tk.ok) setTasks(tk.data);
    // فشل القراءة (قبل تشغيل PATCH) ⇒ القيم الافتراضية الآمنة.
    setSettings(cfg.ok ? { ...DEFAULT_HR_SETTINGS, ...cfg.data } : DEFAULT_HR_SETTINGS);
    setPendingCorrections(corr.ok ? corr.data.length : 0);
    setLongOpen(lo.ok ? lo.data.rows : []);
    setExpiring(exp.ok ? exp.data.rows : []);
    setSupLinks(sl.ok ? sl.data : []);
    setPhase("ready");
  }, [attFrom, attTo, attUser]);
  useEffect(() => { void reload(); }, [reload]);
  // سجل تشغيلي مرة واحدة عند أول تحميل: جلسات مفتوحة طويلة + وثائق قرب انتهائها (بلا جدولة).
  const [opsLogged, setOpsLogged] = useState(false);
  useEffect(() => {
    if (opsLogged || phase !== "ready") return;
    if (longOpen.length > 0) emitHrEvent({ event: "hr_long_open_session_detected", entity_id: "overview", title: `${longOpen.length} جلسة مفتوحة طويلة` });
    if (expiring.length > 0) emitHrEvent({ event: "hr_document_expiring", entity_id: "overview", title: `${expiring.length} وثيقة قرب الانتهاء` });
    setOpsLogged(true);
  }, [phase, longOpen, expiring, opsLogged]);

  const byUser = useMemo(() => {
    const m: Record<string, HrEmployee> = {};
    employees.forEach((e) => { if (e.user_id) m[e.user_id] = e; });
    return m;
  }, [employees]);
  const empName = (userId: string) => byUser[userId]?.full_name || userId.slice(0, 8);

  // ─── نظرة عامة (من جلبة اليوم المستقلة) ───
  // v2: جلسات متعددة لكل موظف يوميًا — نعدّ الموظفين المميزين لا الصفوف (بلا الملغاة).
  const activeCount = employees.filter((e) => e.employment_status === "active").length;
  const checkedTodaySet = useMemo(
    () => new Set(todayAttendance.filter((a) => a.check_in_at && !a.is_voided).map((a) => a.user_id)),
    [todayAttendance]);
  const presentNow = new Set(todayAttendance.filter((a) => a.check_in_at && !a.check_out_at && !a.is_voided).map((a) => a.user_id)).size;
  const checkedToday = checkedTodaySet.size;
  const pendingLeaves = leaves.filter((l) => l.status === "pending");
  const openTasks = tasks.filter((x) => ["assigned", "in_progress", "submitted"].includes(x.status));

  // كرت تفاعلي: ينتقل للتبويب الصحيح ويطبّق الفلتر ويسجّل الأثر (سجل فقط — لا بريد).
  function openCard(target: Tab, apply: () => void, filterKey: string, label: string) {
    apply();
    setTab(target);
    emitHrEvent({ event: "hr_dashboard_filter_applied", entity_id: filterKey, title: label });
  }
  // فتح نموذج التعديل/الإلغاء لجلسة مفتوحة طويلة — نُركّب سجلًا من بيانات التنبيه
  // لأن الجلسة قد تكون بتاريخ سابق غير محمّل في جلبة حضور اليوم.
  function openLongSession(s: HrLongOpenSession) {
    const wd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date(s.check_in_at));
    const synthetic: HrAttendance = {
      id: s.record_id, employee_id: s.employee_id, user_id: s.user_id, work_date: wd,
      check_in_at: s.check_in_at, check_out_at: null,
      check_in_lat: null, check_in_lng: null, check_in_accuracy: null,
      check_out_lat: null, check_out_lng: null, check_out_accuracy: null,
      status: "present", admin_adjusted_by: null, admin_adjustment_reason: null,
      is_voided: false, source: "app", created_at: s.check_in_at, updated_at: s.check_in_at,
    };
    setAdjFor(synthetic);
    setAdj({ checkIn: "", checkOut: "", status: "", reason: "" });
    setTab("attendance");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

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

  // ─── v3: حذف إداري لطلب إجازة (soft) + تعديل إداري ───
  const [delLeave, setDelLeave] = useState<{ id: string; reason: string } | null>(null);
  async function doDeleteLeave(l: HrLeave) {
    const reason = (delLeave?.reason || "").trim();
    if (!reason) { flash(t({ ar: "سبب الحذف إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await hrAdminSoftDeleteLeave(l.id, reason);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر الحذف: ", en: "Delete failed: " })) + r.error); return; }
    emitHrEvent({ event: "hr_leave_deleted", entity_id: l.id, title: "حذف إداري لطلب إجازة — " + empName(l.user_id), employee_name: empName(l.user_id), employee_user_id: l.user_id });
    setDelLeave(null);
    await reload();
    flash(t({ ar: "حُذف الطلب (حذف آمن موثّق).", en: "Soft-deleted." }));
  }
  const [lvEdit, setLvEdit] = useState<{ leave: HrLeave; type: string; start: string; end: string; startTime: string; endTime: string; note: string } | null>(null);
  async function saveLeaveEdit() {
    if (!lvEdit) return;
    if (!lvEdit.start) { flash(t({ ar: "تاريخ البداية مطلوب.", en: "Start date required." })); return; }
    setBusy(true);
    const r = await hrAdminUpdateLeave(lvEdit.leave.id, {
      type: lvEdit.type as HrLeave["leave_type"], start: lvEdit.start, end: lvEdit.end || null,
      startTime: lvEdit.startTime || null, endTime: lvEdit.endTime || null, note: lvEdit.note.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) {
      const msg = /leave_not_editable/.test(r.error)
        ? t({ ar: "يُعدَّل الطلب المعلّق فقط.", en: "Only pending requests can be edited." })
        : (t({ ar: "تعذّر التعديل: ", en: "Edit failed: " })) + r.error;
      flash(msg); return;
    }
    emitHrEvent({ event: "hr_leave_updated", entity_id: lvEdit.leave.id, title: "تعديل إداري لطلب إجازة — " + empName(lvEdit.leave.user_id), employee_user_id: lvEdit.leave.user_id });
    setLvEdit(null);
    await reload();
    flash(t({ ar: "عُدّل الطلب وأُشعر الموظف.", en: "Updated & employee notified." }));
  }

  // ─── v3: إلغاء إداري لسجل حضور (لا حذف نهائي) ───
  async function doVoidAttendance() {
    if (!adjFor) return;
    if (!adj.reason.trim()) { flash(t({ ar: "سبب الإلغاء إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await hrAdminVoidAttendance(adjFor.id, adj.reason.trim());
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر الإلغاء: ", en: "Void failed: " })) + r.error); return; }
    emitHrEvent({ event: "hr_attendance_voided", entity_id: adjFor.id, title: "إلغاء إداري لسجل حضور " + adjFor.work_date, employee_name: empName(adjFor.user_id), employee_user_id: adjFor.user_id });
    setAdjFor(null); setAdj({ checkIn: "", checkOut: "", status: "", reason: "" });
    await reload();
    flash(t({ ar: "أُلغي السجل (يبقى موثّقًا بعلامة ملغى).", en: "Voided (kept for audit)." }));
  }

  // ─── v3: حذف مهمة (soft) + تقييم أداء ───
  const [delTask, setDelTask] = useState<{ id: string; reason: string } | null>(null);
  async function doDeleteTask(tk: HrTask) {
    const reason = (delTask?.reason || "").trim();
    if (!reason) { flash(t({ ar: "سبب الحذف إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    let ids = (assigneesByTask[tk.id] ?? []).map((a) => a.user_id);
    if (ids.length === 0) {
      const ar = await hrListAssignees(tk.id);
      if (ar.ok) ids = ar.data.map((a) => a.user_id);
    }
    const r = await hrAdminSoftDeleteTask(tk.id, reason);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر الحذف: ", en: "Delete failed: " })) + r.error); return; }
    emitHrEvent({ event: "hr_task_deleted", entity_id: tk.id, title: "حذف إداري لمهمة: " + tk.title, employee_user_ids: ids });
    setDelTask(null);
    await reload();
    flash(t({ ar: "حُذفت المهمة (حذف آمن) وأُشعر المسندون.", en: "Task soft-deleted." }));
  }
  const [reviewsByTask, setReviewsByTask] = useState<Record<string, HrTaskReview[]>>({});
  const [revFor, setRevFor] = useState<{ taskId: string; employeeId: string; userId: string } | null>(null);
  const [revForm, setRevForm] = useState({ p: 0, q: 0, c: 0, note: "" });
  async function saveReview() {
    if (!revFor) return;
    setBusy(true);
    const r = await hrAdminReviewTask(revFor.taskId, revFor.employeeId, {
      punctuality: revForm.p || null, quality: revForm.q || null,
      communication: revForm.c || null, note: revForm.note.trim() || undefined,
    });
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر حفظ التقييم: ", en: "Review failed: " })) + r.error); return; }
    const rv = await hrListTaskReviews(revFor.taskId);
    if (rv.ok) setReviewsByTask((p) => ({ ...p, [revFor.taskId]: rv.data }));
    setRevFor(null); setRevForm({ p: 0, q: 0, c: 0, note: "" });
    flash(t({ ar: "حُفظ التقييم (داخلي للإدارة).", en: "Review saved (internal)." }));
  }

  // ─── v3: حالة الموظف + حذف المالك بسبب + عهدة/أجهزة الموظف (قراءة فقط) ───
  const [statusForm, setStatusForm] = useState<{ empId: string; status: EmploymentStatus; reason: string } | null>(null);
  async function saveStatus(e: HrEmployee) {
    if (!statusForm || !statusForm.reason.trim()) { flash(t({ ar: "سبب التغيير إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await hrAdminUpdateEmployeeStatus(e.id, statusForm.status, statusForm.reason.trim());
    setBusy(false);
    if (!r.ok) {
      const msg = /status_unchanged/.test(r.error) ? t({ ar: "الحالة لم تتغير.", en: "Status unchanged." })
        : (t({ ar: "تعذّر التغيير: ", en: "Failed: " })) + r.error;
      flash(msg); return;
    }
    emitHrEvent({ event: "hr_employee_status_updated", entity_id: e.id, title: "تغيير حالة موظف: " + e.full_name + " ← " + statusForm.status, employee_name: e.full_name, employee_user_id: e.user_id || undefined });
    setStatusForm(null);
    await reload();
    flash(t({ ar: "حُدّثت حالة الموظف ووُثّقت.", en: "Status updated." }));
  }
  const [delEmp, setDelEmp] = useState<{ id: string; reason: string } | null>(null);
  async function doDeleteEmployee(e: HrEmployee) {
    const reason = (delEmp?.reason || "").trim();
    if (!reason) { flash(t({ ar: "سبب الحذف إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await hrOwnerSoftDeleteEmployee(e.id, reason);
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّر الحذف: ", en: "Delete failed: " })) + r.error); return; }
    setDelEmp(null); setOpenEmp(null);
    await reload();
    flash(t({ ar: "حُذف ملف الموظف (حذف آمن موثّق).", en: "Employee soft-deleted." }));
  }
  // ─── المشرف الميداني لكل موظف (mapping) ───
  const [supFor, setSupFor] = useState<Record<string, string>>({});
  const currentSupervisorOf = (employeeId: string): string =>
    supLinks.find((l) => l.employee_id === employeeId && l.is_active)?.supervisor_employee_id ?? "";
  async function saveSupervisor(e: HrEmployee) {
    const chosen = supFor[e.id] ?? currentSupervisorOf(e.id);
    const prev = currentSupervisorOf(e.id);
    if (chosen === prev) { flash(t({ ar: "لا تغيير على المشرف.", en: "No change." })); return; }
    setBusy(true);
    // أوقف رابط المشرف السابق أولاً (وإلا يظل نشطًا ويصبح للموظف مشرفان)، ثم فعّل الجديد.
    if (prev) {
      const d = await hrAdminSetSupervisorLink(prev, e.id, false);
      if (!d.ok) { setBusy(false); flash((t({ ar: "تعذّر إيقاف الإشراف السابق: ", en: "Failed to unset previous: " })) + d.error); return; }
    }
    if (chosen) {
      const r = await hrAdminSetSupervisorLink(chosen, e.id, true);
      if (!r.ok) { setBusy(false); flash((t({ ar: "تعذّر: ", en: "Failed: " })) + r.error); return; }
    }
    setBusy(false);
    emitHrEvent({ event: "hr_supervisor_link_updated", entity_id: e.id, title: "تحديث إشراف: " + e.full_name, employee_name: e.full_name, employee_user_id: e.user_id || undefined });
    await reload();
    flash(t({ ar: "حُدّث الإشراف الميداني.", en: "Supervisor updated." }));
  }
  const [custodyByEmp, setCustodyByEmp] = useState<Record<string, CustodyRecord[] | "error">>({});
  const [deviceUsersByEmp, setDeviceUsersByEmp] = useState<Record<string, HrDeviceUser[]>>({});
  async function loadEmployeeExtras(e: HrEmployee) {
    if (e.user_id && custodyByEmp[e.id] === undefined) {
      const c = await listMyCustodyRecords("custody", e.user_id);
      setCustodyByEmp((p) => ({ ...p, [e.id]: c.ok ? c.data : "error" }));
    }
    if (deviceUsersByEmp[e.id] === undefined) {
      const d = await hrListDeviceUsers({ employeeId: e.id });
      if (d.ok) setDeviceUsersByEmp((p) => ({ ...p, [e.id]: d.data }));
    }
  }
  // فلاتر الـ Timeline داخل ملف الموظف.
  const [evType, setEvType] = useState("");
  const [evSearch, setEvSearch] = useState("");
  function filterEvents(list: HrEvent[]): HrEvent[] {
    return list.filter((ev) => {
      const et = ev.event_type;
      const typeOk = !evType
        || (evType === "attendance" && (et.startsWith("attendance") || et.startsWith("device_check")))
        || (evType === "leave" && et.startsWith("leave"))
        || (evType === "task" && et.startsWith("task"))
        || (evType === "note" && et === "hr_note")
        || (evType === "status" && (et === "status_changed" || et === "employee_deleted"))
        || (evType === "device" && et.startsWith("device"));
      const q = evSearch.trim();
      return typeOk && (!q || ev.title.includes(q) || (ev.description || "").includes(q));
    });
  }

  // ─── المهام ───
  const emptyTf = {
    title: "", desc: "", location: "", mapsUrl: "", city: "", clientName: "", projectName: "",
    taskType: "photo" as TaskType, priority: "normal" as TaskPriority,
    evidenceMode: "" as EvidenceMode | "",   // "" = حسب الإعداد العام (لا يتغيّر سلوك المهام الافتراضي)
    equipment: "", requirements: "", execNotes: "", start: "", end: "", assignees: [] as string[],
  };
  const [tf, setTf] = useState(emptyTf);
  const [tfId, setTfId] = useState<string | null>(null); // ≠ null ⇒ وضع تعديل مهمة قائمة
  const [openTask, setOpenTask] = useState<string | null>(null);
  async function saveTask() {
    if (!tf.title.trim()) { flash(t({ ar: "عنوان المهمة مطلوب.", en: "Title required." })); return; }
    if (!tfId && tf.assignees.length === 0) { flash(t({ ar: "اختر موظفاً واحداً على الأقل.", en: "Pick at least one employee." })); return; }
    setBusy(true);
    const base = {
      title: tf.title.trim(), description: tf.desc.trim() || undefined, location: tf.location.trim() || undefined,
      mapsUrl: tf.mapsUrl.trim() || undefined, city: tf.city.trim() || undefined,
      clientName: tf.clientName.trim() || undefined, projectName: tf.projectName.trim() || undefined,
      taskType: tf.taskType, priority: tf.priority,
      equipment: tf.equipment.trim() || undefined, requirements: tf.requirements.trim() || undefined,
      execNotes: tf.execNotes.trim() || undefined,
      expectedStart: tf.start ? new Date(tf.start).toISOString() : null,
      expectedEnd: tf.end ? new Date(tf.end).toISOString() : null,
    };
    // عملية خادمية واحدة تُنتظر: تحفظ المهمة/المسندين ثم توزّع الإشعارات (بوابة+بريد)
    // من الخادم — لا اعتماد على emitHrEvent الهش من المتصفح.
    const r = await hrTaskAssignDispatch({
      action: tfId ? "update" : "create", task_id: tfId ?? undefined,
      assignees: tfId ? undefined : [...tf.assignees], evidence_mode: tf.evidenceMode, ...base,
    });
    setBusy(false);
    if (!r.ok) {
      const msg = /task_not_editable/.test(r.error) ? t({ ar: "لا يمكن تعديل مهمة مُسلّمة أو مغلقة.", en: "Submitted/closed tasks can't be edited." })
        : /not_authorized/.test(r.error) ? t({ ar: "لا تملك صلاحية إدارة المهام.", en: "Not authorized." })
        : (t({ ar: "تعذّر: ", en: "Failed: " })) + r.error;
      flash(msg); return;
    }
    const e = r.data.email;
    setTf(emptyTf); setTfId(null);
    await reload();
    flash(t({
      ar: `${tfId ? "عُدّلت المهمة" : "أُنشئت المهمة"} — بريد: موظفون ${e.employees_sent}، مشرفون ${e.supervisors_sent}، إدارة ${e.admins_sent}${e.employees_resolved === 0 ? " (لا بريد للموظف — أُنشئ إشعار بوابة)" : ""}`,
      en: `${tfId ? "Updated" : "Created"} — email emp ${e.employees_sent}/sup ${e.supervisors_sent}/admin ${e.admins_sent}`,
    }));
  }
  // زر الأدمن: إعادة إرسال إشعار الإسناد لمهمة قائمة (بلا إعادة إنشاء) — لاختبار الإيميل.
  async function doResendAssignment(tk: HrTask) {
    if (busy) return;
    setBusy(true);
    const r = await hrTaskAssignDispatch({ action: "resend", task_id: tk.id, title: tk.title,
      clientName: tk.client_name || undefined, projectName: tk.project_name || undefined,
      location: tk.location_name || undefined, city: tk.city || undefined, priority: tk.priority });
    setBusy(false);
    if (!r.ok) { flash((t({ ar: "تعذّرت إعادة الإرسال: ", en: "Resend failed: " })) + r.error); return; }
    const e = r.data.email;
    flash(e.employees_resolved === 0
      ? t({ ar: "لا يوجد بريد للموظف — أُنشئ إشعار بوابة فقط.", en: "No employee email — portal notification only." })
      : t({ ar: `أُعيد الإرسال — موظفون: ${e.employees_sent}، مشرفون: ${e.supervisors_sent}، إدارة: ${e.admins_sent}`, en: `Resent — emp ${e.employees_sent}/sup ${e.supervisors_sent}/admin ${e.admins_sent}` }));
  }
  function startEditTask(tk: HrTask) {
    setTfId(tk.id);
    setTf({
      title: tk.title, desc: tk.description || "", location: tk.location_name || "",
      mapsUrl: tk.maps_url || "", city: tk.city || "",
      clientName: tk.client_name || "", projectName: tk.project_name || "",
      taskType: (tk.task_type || "other") as TaskType, priority: (tk.priority || "normal") as TaskPriority,
      evidenceMode: (tk.completion_evidence_mode || "") as EvidenceMode | "",
      equipment: tk.equipment_needed || "", requirements: tk.special_requirements || "",
      execNotes: tk.execution_notes || "",
      start: toLocalInput(tk.expected_start_at), end: toLocalInput(tk.expected_end_at), assignees: [],
    });
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
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
  // ─── طلب تعديل + أدلة التسليم (ملف/رابط) ───
  const [revFor2, setRevFor2] = useState<{ id: string; note: string } | null>(null);
  const [evidenceByTask, setEvidenceByTask] = useState<Record<string, HrTaskEvidence[]>>({});
  async function doRequestRevision(tk: HrTask) {
    const note = (revFor2?.note || "").trim();
    if (!note) { flash(t({ ar: "ملاحظة التعديل إلزامية.", en: "Revision note required." })); return; }
    setBusy(true);
    let ids = (assigneesByTask[tk.id] ?? []).map((a) => a.user_id);
    if (ids.length === 0) {
      const ar = await hrListAssignees(tk.id);
      if (ar.ok) ids = ar.data.map((a) => a.user_id);
    }
    const r = await hrAdminRequestRevision(tk.id, note);
    setBusy(false);
    if (!r.ok) {
      const msg = /task_not_revisable/.test(r.error) ? t({ ar: "لا يمكن طلب تعديل لهذه المهمة الآن.", en: "Task not revisable." })
        : (t({ ar: "تعذّر: ", en: "Failed: " })) + r.error;
      flash(msg); return;
    }
    emitHrEvent({ event: "hr_task_revision_requested", entity_id: tk.id, title: "طلب تعديل: " + tk.title,
      employee_user_ids: ids, subject: "طلب تعديل على مهمتك — كيان",
      message: "طُلب تعديل على مهمتك: " + tk.title + "\nالملاحظة: " + note + "\n\nافتح بوابة الموظف لإعادة التنفيذ." });
    setRevFor2(null);
    await reload();
    flash(t({ ar: "أُرسل طلب التعديل وأُعيدت المهمة للتنفيذ.", en: "Revision requested." }));
  }
  async function openEvidenceFile(ev: HrTaskEvidence) {
    if (!ev.file_path) return;
    setBusy(true);
    const map = await signHrFiles([ev.file_path]);
    setBusy(false);
    const url = map[ev.file_path];
    if (!url) { flash(t({ ar: "تعذّر فتح الملف.", en: "Couldn't open file." })); return; }
    window.open(url, "_blank", "noopener,noreferrer");
  }
  async function toggleTask(id: string) {
    if (openTask === id) { setOpenTask(null); return; }
    setOpenTask(id);
    if (!assigneesByTask[id]) {
      const r = await hrListAssignees(id);
      if (r.ok) setAssigneesByTask((p) => ({ ...p, [id]: r.data }));
    }
    if (!evidenceByTask[id]) {
      const ev = await hrListTaskEvidence(id);
      if (ev.ok) setEvidenceByTask((p) => ({ ...p, [id]: ev.data }));
    }
    const tk = tasks.find((x) => x.id === id);
    if (tk && ["completed", "cancelled"].includes(tk.status) && !reviewsByTask[id]) {
      const rv = await hrListTaskReviews(id);
      if (rv.ok) setReviewsByTask((p) => ({ ...p, [id]: rv.data }));
    }
  }

  if (phase === "loading") return <p className="text-stone-500 text-sm">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return <p className="text-red-400 text-sm">{t({ ar: "تعذّر التحميل — شغّل ترحيل قاعدة البيانات (portal_hr_employee_portal_RUNME.sql) أولاً.", en: "Couldn't load — run the HR migration first." })}</p>;

  const TABS: { key: Tab; ar: string; en: string; badge?: number }[] = [
    { key: "overview",    ar: "نظرة عامة",      en: "Overview" },
    { key: "employees",   ar: "الموظفون",       en: "Employees" },
    { key: "attendance",  ar: "الحضور",         en: "Attendance" },
    { key: "corrections", ar: "تعديل الحضور",   en: "Corrections", badge: pendingCorrections },
    { key: "leaves",      ar: "الإجازات",       en: "Leaves", badge: pendingLeaves.length },
    { key: "tasks",       ar: "المهام",         en: "Tasks" },
    { key: "monthly",     ar: "التقرير الشهري",  en: "Monthly" },
    { key: "payroll",     ar: "الخصومات",       en: "Payroll" },
    { key: "documents",   ar: "الوثائق",        en: "Documents" },
    { key: "devices",     ar: "الأجهزة",        en: "Devices" },
    { key: "calendar",    ar: "التقويم",        en: "Calendar" },
    { key: "audit",       ar: "سجل العمليات",   en: "Audit log" },
    { key: "supervisors", ar: "المشرفون",       en: "Supervisors" },
    { key: "settings",    ar: "الإعدادات",      en: "Settings" },
  ];
  // شارة الفلتر النشط + زر "عرض الكل" — تظهر أعلى القائمة في التبويب المفلتر.
  const FilterBadge = ({ label, onClear }: { label: string; onClear: () => void }) => (
    <div className="flex items-center gap-2 flex-wrap bg-stone-900 border border-red-900/60 rounded-lg px-3 py-2">
      <span className={chip("bg-red-950 text-red-300 border-red-800")}>🔎 {label}</span>
      <button type="button" onClick={onClear} className="ms-auto text-xs text-stone-300 underline">
        {t({ ar: "عرض الكل", en: "Show all" })}
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* sub-tabs — قائمة منسدلة على الجوال (تبويبات كثيرة)، أزرار على الشاشات الأكبر */}
      <div className="sm:hidden">
        <select value={tab} onChange={(e) => setTab(e.target.value as Tab)} className={inp}>
          {TABS.map((x) => (
            <option key={x.key} value={x.key}>{t({ ar: x.ar, en: x.en })}{x.badge ? ` (${x.badge})` : ""}</option>
          ))}
        </select>
      </div>
      <div className="hidden sm:flex gap-1.5 flex-wrap">
        {TABS.map((x) => (
          <button key={x.key} type="button" onClick={() => setTab(x.key)}
            className={`rounded-lg px-3.5 py-2 text-xs font-medium border ${tab === x.key ? "bg-red-600 border-red-600 text-white" : "bg-stone-900 border-stone-700 text-stone-300"}`}>
            {t({ ar: x.ar, en: x.en })}
            {x.badge ? <span className="ms-1.5 bg-white/20 rounded-full px-1.5">{x.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ═══ نظرة عامة — كروت تفاعلية: كل كرت يفتح تبويبه بفلتر حقيقي ═══ */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
            {([
              { l: t({ ar: "موظفون نشطون", en: "Active staff" }), v: activeCount,
                go: () => openCard("employees", () => setEmpFilter("active"), "employees_active", "موظفون نشطون") },
              { l: t({ ar: "سجّلوا حضوراً اليوم", en: "Checked in today" }), v: `${checkedToday}/${activeCount}`,
                go: () => openCard("attendance", () => { setAttFrom(todayRiyadh()); setAttTo(todayRiyadh()); setAttUser(""); setAttFilter("today"); }, "attendance_today", "سجّلوا حضوراً اليوم") },
              { l: t({ ar: "حاضرون الآن", en: "Present now" }), v: presentNow,
                go: () => openCard("attendance", () => { setAttFrom(todayRiyadh()); setAttTo(todayRiyadh()); setAttUser(""); setAttFilter("open_now"); }, "attendance_open_now", "حاضرون الآن") },
              { l: t({ ar: "إجازات معلّقة", en: "Pending leaves" }), v: pendingLeaves.length,
                go: () => openCard("leaves", () => setLeaveFilter("pending"), "leaves_pending", "إجازات معلّقة") },
              { l: t({ ar: "مهام مفتوحة", en: "Open tasks" }), v: openTasks.length,
                go: () => openCard("tasks", () => setTaskFilter("open"), "tasks_open", "مهام مفتوحة") },
              { l: t({ ar: "لم يسجّلوا اليوم", en: "Not checked in" }), v: Math.max(activeCount - employees.filter((e) => e.employment_status === "active" && e.user_id && checkedTodaySet.has(e.user_id)).length, 0),
                go: () => openCard("employees", () => setEmpFilter("not_today"), "employees_not_today", "لم يسجّلوا اليوم") },
              { l: t({ ar: "طلبات تعديل حضور معلّقة", en: "Correction requests" }), v: pendingCorrections,
                go: () => openCard("corrections", () => setCorrPendingOnly(true), "corrections_pending", "طلبات تعديل حضور معلّقة") },
              { l: t({ ar: "وثائق ستنتهي قريبًا", en: "Docs expiring soon" }), v: expiring.filter((d) => d.days_left <= 30).length,
                go: () => openCard("documents", () => {}, "docs_expiring", "وثائق ستنتهي قريبًا") },
              { l: t({ ar: "جلسات مفتوحة طويلة", en: "Long open sessions" }), v: longOpen.length,
                go: () => openCard("overview", () => { if (typeof document !== "undefined") document.getElementById("long-open-section")?.scrollIntoView({ behavior: "smooth" }); }, "long_open", "جلسات مفتوحة طويلة") },
              { l: t({ ar: "روابط إشراف ميداني", en: "Supervisor links" }), v: supLinks.length,
                go: () => openCard("supervisors", () => {}, "supervisors", "المشرفون الميدانيون") },
              { l: t({ ar: "سجل العمليات", en: "Audit log" }), v: "↗",
                go: () => openCard("audit", () => {}, "audit_open", "سجل العمليات") },
            ] as { l: string; v: number | string; go: () => void }[]).map((c, i) => (
              <button key={i} type="button" onClick={c.go}
                className={card + " text-center transition-colors hover:border-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 cursor-pointer"}>
                <div className="text-2xl font-bold text-white">{c.v}</div>
                <div className="text-[11px] text-stone-500 mt-1">{c.l}</div>
                <div className="text-[10px] text-red-400/80 mt-1.5">{t({ ar: "اضغط للفتح ↗", en: "Open ↗" })}</div>
              </button>
            ))}
          </div>

          {/* جلسات مفتوحة طويلة */}
          {longOpen.length > 0 && (
            <section id="long-open-section" className={card}>
              <h3 className="text-sm font-medium text-stone-100 mb-2">
                ⏱ {t({ ar: "جلسات مفتوحة طويلة", en: "Long open sessions" })}
                <span className="text-stone-500 text-xs font-normal"> ({t({ ar: "أكثر من", en: "over" })} {settings.open_session_alert_hours} {t({ ar: "ساعة", en: "h" })})</span>
              </h3>
              <div className="space-y-1.5">
                {longOpen.map((s) => (
                  <div key={s.record_id} className="flex items-center gap-2 flex-wrap bg-stone-950 border border-amber-900/40 rounded-lg px-3 py-2 text-xs">
                    <span className="text-stone-100 font-medium">{s.full_name}</span>
                    <span className="font-mono text-stone-500" dir="ltr">{fmtDT(s.check_in_at, isAr)}</span>
                    <span className="text-amber-400 font-mono">{s.hours_open} {t({ ar: "ساعة مفتوحة", en: "h open" })}</span>
                    <button type="button" className="ms-auto text-red-300 underline"
                      onClick={() => openLongSession(s)}>
                      {t({ ar: "تعديل/إغلاق", en: "Adjust/close" })}
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* وثائق ستنتهي قريبًا */}
          {expiring.length > 0 && (
            <section className={card}>
              <h3 className="text-sm font-medium text-stone-100 mb-2">📄 {t({ ar: "وثائق قريبة من الانتهاء", en: "Documents expiring soon" })}</h3>
              <div className="flex gap-1.5 flex-wrap mb-2 text-[10.5px]">
                <span className={chip("bg-red-950 text-red-300 border-red-800")}>≤30 {t({ ar: "يوم", en: "d" })}: {expiring.filter((d) => d.days_left <= 30).length}</span>
                <span className={chip("bg-amber-950 text-amber-300 border-amber-800")}>≤60: {expiring.filter((d) => d.days_left <= 60).length}</span>
                <span className={chip("bg-stone-800 text-stone-400 border-stone-700")}>≤90: {expiring.length}</span>
              </div>
              <div className="space-y-1">
                {expiring.slice(0, 12).map((d) => (
                  <div key={d.id} className="flex items-center gap-2 flex-wrap text-[11.5px] border-t border-stone-800 py-1">
                    <span className="text-stone-200">{d.full_name}</span>
                    <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{t(DOCUMENT_TYPE_LABELS[d.document_type] ?? { ar: d.document_type, en: d.document_type })}</span>
                    <span className="text-stone-400">{d.title}</span>
                    <span className={`font-mono ms-auto ${d.days_left <= 30 ? "text-red-400" : d.days_left <= 60 ? "text-amber-400" : "text-stone-500"}`} dir="ltr">
                      {d.expiry_date} · {d.days_left} {t({ ar: "يوم", en: "d" })}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10.5px] text-stone-600 mt-2">{t({ ar: "تظهر هنا عند فتح اللوحة (بلا جدولة تلقائية).", en: "Shown on panel open (no scheduled job)." })}</p>
            </section>
          )}
        </div>
      )}

      {/* ═══ الموظفون ═══ */}
      {tab === "employees" && (
        <div className="space-y-4">
          {empFilter && (
            <FilterBadge
              label={empFilter === "active" ? t({ ar: "الموظفون النشطون فقط", en: "Active only" }) : t({ ar: "لم يسجّلوا حضورًا اليوم", en: "Not checked in today" })}
              onClear={() => setEmpFilter("")} />
          )}
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
            {employees
              .filter((e) => empFilter !== "active" || e.employment_status === "active")
              .filter((e) => empFilter !== "not_today" || (e.employment_status === "active" && (!e.user_id || !checkedTodaySet.has(e.user_id))))
              .map((e) => (
              <div key={e.id} className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
                <button type="button" className="w-full flex items-center gap-2 p-3 text-start flex-wrap"
                  onClick={() => { const v = openEmp === e.id ? null : e.id; setOpenEmp(v); if (v) { void loadEvents(e.id); void loadEmployeeExtras(e); } }}>
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
                    <div className="flex gap-2 flex-wrap items-center">
                      <button type="button" className={`${btnGhost} px-3 py-1.5 text-xs`}
                        onClick={() => setForm({ id: e.id, userId: e.user_id || "", fullName: e.full_name, email: e.email || "", phone: e.phone || "", jobTitle: e.job_title || "", department: e.department || "", status: e.employment_status, joined: e.joined_at || "", notesInternal: e.notes_internal || "", notesVisible: e.notes_visible_to_employee || "" })}>
                        {t({ ar: "تعديل", en: "Edit" })}
                      </button>
                      <button type="button" className={`${btnGhost} px-3 py-1.5 text-xs`}
                        onClick={() => setStatusForm(statusForm?.empId === e.id ? null : { empId: e.id, status: e.employment_status, reason: "" })}>
                        {t({ ar: "تغيير الحالة", en: "Change status" })}
                      </button>
                      {caps.isOwner && (
                        <button type="button" disabled={busy} className="text-[11px] text-stone-500 hover:text-red-400 underline"
                          onClick={() => setDelEmp(delEmp?.id === e.id ? null : { id: e.id, reason: "" })}>
                          {t({ ar: "حذف (للمالك)", en: "Delete (owner)" })}
                        </button>
                      )}
                    </div>
                    {/* تغيير الحالة الوظيفية — سبب إلزامي، يُوثّق ويُشعر */}
                    {statusForm?.empId === e.id && (
                      <div className="flex gap-2 flex-wrap items-center bg-stone-950 border border-stone-800 rounded-lg p-2">
                        <select value={statusForm.status} onChange={(ev2) => setStatusForm({ ...statusForm, status: ev2.target.value as EmploymentStatus })}
                          className={inp} style={{ width: "auto" }}>
                          <option value="active">{t({ ar: "نشط", en: "Active" })}</option>
                          <option value="suspended">{t({ ar: "موقوف", en: "Suspended" })}</option>
                          <option value="left">{t({ ar: "انتهت خدمته", en: "Left" })}</option>
                        </select>
                        <input value={statusForm.reason} onChange={(ev2) => setStatusForm({ ...statusForm, reason: ev2.target.value })}
                          placeholder={t({ ar: "سبب التغيير (إلزامي)", en: "Reason (required)" })} className={inp + " flex-1 min-w-[160px]"} style={{ width: "auto" }} />
                        <button type="button" disabled={busy} onClick={() => void saveStatus(e)} className={`${btnRed} px-4 py-2 text-xs`}>{t({ ar: "حفظ", en: "Save" })}</button>
                      </div>
                    )}
                    {/* حذف المالك — سبب إلزامي (soft delete) */}
                    {caps.isOwner && delEmp?.id === e.id && (
                      <div className="flex gap-2 flex-wrap items-center bg-red-950/30 border border-red-900 rounded-lg p-2">
                        <input value={delEmp.reason} onChange={(ev2) => setDelEmp({ id: e.id, reason: ev2.target.value })}
                          placeholder={t({ ar: "سبب حذف الملف (إلزامي)", en: "Delete reason (required)" })} className={inp + " flex-1 min-w-[160px]"} style={{ width: "auto" }} />
                        <button type="button" disabled={busy} onClick={() => void doDeleteEmployee(e)} className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-xs px-4 py-2 disabled:opacity-50">
                          {t({ ar: "تأكيد الحذف الآمن", en: "Confirm soft delete" })}
                        </button>
                      </div>
                    )}
                    {/* عهدة الموظف — قراءة فقط من نظام العهدة دون أي تعديل عليه */}
                    <div className="bg-stone-950 border border-stone-800 rounded-lg p-2.5 text-[11px]">
                      <span className="text-stone-400 font-medium">{t({ ar: "عهدة الموظف: ", en: "Custody: " })}</span>
                      {!e.user_id || custodyByEmp[e.id] === "error" ? (
                        <span className="text-stone-500">{t({ ar: "لا توجد عهد مرتبطة أو لا يمكن تحميلها الآن.", en: "No linked custody or unavailable." })}</span>
                      ) : custodyByEmp[e.id] === undefined ? (
                        <span className="text-stone-600">…</span>
                      ) : (
                        (() => {
                          const list = custodyByEmp[e.id] as CustodyRecord[];
                          const open = list.filter((c) => !["closed", "rejected"].includes(c.status)).length;
                          const closed = list.filter((c) => c.status === "closed").length;
                          const claims = list.reduce((s, c) => s + (c.claim_amount || 0), 0);
                          return (
                            <>
                              <span className="text-stone-300">{t({ ar: `مفتوحة: ${open} · مقفلة: ${closed}`, en: `open: ${open} · closed: ${closed}` })}</span>
                              {claims > 0 && <span className="text-amber-400"> · {t({ ar: "مطالبات: ", en: "claims: " })}{claims} ﷼</span>}
                              <a href="/client-portal/equipment" className="text-sky-400 underline ms-2">{t({ ar: "فتح العهدة", en: "Open custody" })}</a>
                            </>
                          );
                        })()
                      )}
                    </div>
                    {/* معرفات أجهزة الحضور — للأدمن فقط */}
                    {(deviceUsersByEmp[e.id] ?? []).length > 0 && (
                      <div className="bg-stone-950 border border-stone-800 rounded-lg p-2.5 text-[11px]">
                        <span className="text-stone-400 font-medium">{t({ ar: "معرفات الأجهزة: ", en: "Device IDs: " })}</span>
                        {(deviceUsersByEmp[e.id] ?? []).map((du) => (
                          <span key={du.id} className="font-mono text-stone-300 me-2" dir="ltr">
                            {du.device_user_identifier}{du.card_id ? ` (💳 ${du.card_id})` : ""}
                          </span>
                        ))}
                      </div>
                    )}
                    {/* المشرف الميداني لهذا الموظف */}
                    <div className="bg-stone-950 border border-stone-800 rounded-lg p-2.5 text-[11px] flex gap-2 flex-wrap items-center">
                      <span className="text-stone-400 font-medium">{t({ ar: "المشرف الميداني:", en: "Supervisor:" })}</span>
                      <select value={supFor[e.id] ?? currentSupervisorOf(e.id)} onChange={(ev2) => setSupFor((p) => ({ ...p, [e.id]: ev2.target.value }))}
                        className={inp + " text-[11px]"} style={{ width: "auto", paddingTop: 4, paddingBottom: 4 }}>
                        <option value="">{t({ ar: "— بلا مشرف —", en: "— None —" })}</option>
                        {employees.filter((s) => s.id !== e.id).map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                      </select>
                      <button type="button" disabled={busy} onClick={() => void saveSupervisor(e)} className={`${btnGhost} px-3 py-1 text-[11px]`}>{t({ ar: "حفظ", en: "Save" })}</button>
                    </div>
                    {/* وثائق الموظف */}
                    <HrEmployeeDocuments employee={e} busy={busy} setBusy={setBusy} flash={flash} />
                    {/* Timeline الموظف — فلاتر بالنوع + بحث نصي + إضافة ملاحظة */}
                    <div className="border-t border-stone-800 pt-2 space-y-1">
                      <div className="flex gap-2 flex-wrap items-center pb-1">
                        <span className="text-[11px] text-stone-400 font-medium">{t({ ar: "السجل الزمني", en: "Timeline" })}</span>
                        <select value={evType} onChange={(ev2) => setEvType(ev2.target.value)} className={inp + " text-[11px]"} style={{ width: "auto", paddingTop: 4, paddingBottom: 4 }}>
                          <option value="">{t({ ar: "— كل الأنواع —", en: "— All —" })}</option>
                          <option value="attendance">{t({ ar: "حضور/انصراف", en: "Attendance" })}</option>
                          <option value="leave">{t({ ar: "إجازات", en: "Leaves" })}</option>
                          <option value="task">{t({ ar: "مهام", en: "Tasks" })}</option>
                          <option value="note">{t({ ar: "ملاحظات", en: "Notes" })}</option>
                          <option value="status">{t({ ar: "حالة الموظف", en: "Status" })}</option>
                          <option value="device">{t({ ar: "أجهزة", en: "Devices" })}</option>
                        </select>
                        <input value={evSearch} onChange={(ev2) => setEvSearch(ev2.target.value)}
                          placeholder={t({ ar: "بحث…", en: "Search…" })} className={inp + " text-[11px] flex-1 min-w-[100px]"}
                          style={{ width: "auto", paddingTop: 4, paddingBottom: 4 }} />
                      </div>
                      {filterEvents(empEvents[e.id] ?? []).length === 0 && (
                        <p className="text-[11px] text-stone-600">{t({ ar: "لا أحداث مطابقة.", en: "No matching events." })}</p>
                      )}
                      {filterEvents(empEvents[e.id] ?? []).slice(0, 30).map((ev) => (
                        <div key={ev.id} className="text-[11px] text-stone-500 flex gap-2 flex-wrap">
                          <span className="font-mono" dir="ltr">{fmtDT(ev.created_at, isAr)}</span>
                          <span className="text-stone-400">{ev.title}</span>
                          {ev.description && <span className="text-stone-600">— {ev.description}</span>}
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
          {attFilter && (
            <FilterBadge
              label={attFilter === "open_now" ? t({ ar: "الجلسات المفتوحة الآن", en: "Open sessions now" }) : t({ ar: "حضور اليوم", en: "Today's attendance" })}
              onClear={() => setAttFilter("")} />
          )}
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
            {attendance
              .filter((a) => attFilter !== "open_now" || (!!a.check_in_at && !a.check_out_at && !a.is_voided))
              .map((a) => (
              <div key={a.id} className={`bg-stone-900 border rounded-lg px-3 py-2 flex items-center gap-3 flex-wrap text-xs ${a.is_voided ? "border-stone-800 opacity-60" : "border-stone-800"}`}>
                <span className="text-stone-100 font-medium">{empName(a.user_id)}</span>
                <span className="font-mono text-stone-500" dir="ltr">{a.work_date}</span>
                <span className="font-mono text-stone-400" dir="ltr">{fmtT(a.check_in_at, isAr)} → {fmtT(a.check_out_at, isAr)}</span>
                {a.source === "device" && <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{t({ ar: "جهاز", en: "device" })}</span>}
                {a.is_voided && <span className={chip("bg-red-950 text-red-300 border-red-800")}>{t({ ar: "ملغى", en: "voided" })}{a.void_reason ? ` — ${a.void_reason}` : ""}</span>}
                {mapsLink(a.check_in_lat, a.check_in_lng) && (
                  <a className="text-sky-400 underline" href={mapsLink(a.check_in_lat, a.check_in_lng)!} target="_blank" rel="noopener noreferrer">{t({ ar: "موقع الحضور", en: "In loc" })}</a>
                )}
                {mapsLink(a.check_out_lat, a.check_out_lng) && (
                  <a className="text-sky-400 underline" href={mapsLink(a.check_out_lat, a.check_out_lng)!} target="_blank" rel="noopener noreferrer">{t({ ar: "موقع الانصراف", en: "Out loc" })}</a>
                )}
                {a.status === "manual_adjusted" && <span className="text-amber-400">{t({ ar: "مُعدّل", en: "Adjusted" })}</span>}
                {!a.is_voided && (
                  <button type="button" onClick={() => { setAdjFor(a); setAdj({ checkIn: "", checkOut: "", status: "", reason: "" }); }}
                    className="ms-auto text-red-300 underline">{t({ ar: "تعديل / إلغاء", en: "Adjust / void" })}</button>
                )}
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
                  placeholder={t({ ar: "السبب (إلزامي للتعديل وللإلغاء — يُوثّق ويُشعر الموظف)", en: "Reason (required — audited & employee notified)" })} className={inp} />
                <div className="flex gap-2 flex-wrap">
                  <button type="button" disabled={busy} onClick={() => void saveAdjust()} className={`${btnRed} flex-1 py-2`}>{t({ ar: "حفظ التعديل", en: "Save" })}</button>
                  <button type="button" disabled={busy} onClick={() => void doVoidAttendance()}
                    className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-xs px-4 py-2 disabled:opacity-50">
                    {t({ ar: "إلغاء السجل (voided)", en: "Void record" })}
                  </button>
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
          {leaveFilter === "pending" && (
            <FilterBadge label={t({ ar: "الطلبات المعلّقة فقط", en: "Pending only" })} onClear={() => setLeaveFilter("")} />
          )}
          {leaves.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا توجد طلبات.", en: "No requests." })}</p>}
          {(leaveFilter === "pending" ? pendingLeaves : [...pendingLeaves, ...leaves.filter((l) => l.status !== "pending")]).map((l) => (
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
                  <button type="button" disabled={busy} className={`${btnGhost} px-3 py-2 text-xs`}
                    onClick={() => setLvEdit({ leave: l, type: l.leave_type, start: l.start_date, end: l.end_date || "", startTime: l.start_time || "", endTime: l.end_time || "", note: "" })}>
                    {t({ ar: "تعديل", en: "Edit" })}
                  </button>
                </div>
              )}
              {/* حذف إداري آمن — سبب إلزامي، متاح لأي حالة */}
              <div className="flex gap-2 flex-wrap items-center">
                <button type="button" disabled={busy} className="text-[11px] text-stone-500 hover:text-red-400 underline"
                  onClick={() => setDelLeave(delLeave?.id === l.id ? null : { id: l.id, reason: "" })}>
                  {t({ ar: "حذف السجل (آمن)", en: "Soft delete" })}
                </button>
                {delLeave?.id === l.id && (
                  <>
                    <input value={delLeave.reason} onChange={(e) => setDelLeave({ id: l.id, reason: e.target.value })}
                      placeholder={t({ ar: "سبب الحذف (إلزامي)", en: "Reason (required)" })} className={inp + " flex-1 min-w-[160px]"} style={{ width: "auto" }} />
                    <button type="button" disabled={busy} onClick={() => void doDeleteLeave(l)}
                      className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-[11px] px-3 py-1.5 disabled:opacity-50">
                      {t({ ar: "تأكيد الحذف", en: "Confirm" })}
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {/* تعديل إداري لطلب معلّق */}
          {lvEdit && (
            <div className="fixed inset-0 z-[90] bg-black/80 flex items-center justify-center p-4" onClick={() => setLvEdit(null)}>
              <div className={card + " w-full max-w-md space-y-2"} onClick={(e) => e.stopPropagation()}>
                <h3 className="text-sm font-medium text-stone-100">
                  {t({ ar: "تعديل طلب إجازة — ", en: "Edit leave — " })}{empName(lvEdit.leave.user_id)}
                </h3>
                <select value={lvEdit.type} onChange={(e) => setLvEdit({ ...lvEdit, type: e.target.value })} className={inp}>
                  {(Object.keys(LEAVE_TYPE_LABELS) as HrLeave["leave_type"][]).map((k) => (
                    <option key={k} value={k}>{t(LEAVE_TYPE_LABELS[k])}</option>
                  ))}
                </select>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "من", en: "From" })}</label>
                    <input type="date" value={lvEdit.start} onChange={(e) => setLvEdit({ ...lvEdit, start: e.target.value })} className={inp} dir="ltr" /></div>
                  <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "إلى", en: "To" })}</label>
                    <input type="date" value={lvEdit.end} onChange={(e) => setLvEdit({ ...lvEdit, end: e.target.value })} className={inp} dir="ltr" /></div>
                  <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "من الساعة", en: "From time" })}</label>
                    <input type="time" value={lvEdit.startTime} onChange={(e) => setLvEdit({ ...lvEdit, startTime: e.target.value })} className={inp} dir="ltr" /></div>
                  <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "إلى الساعة", en: "To time" })}</label>
                    <input type="time" value={lvEdit.endTime} onChange={(e) => setLvEdit({ ...lvEdit, endTime: e.target.value })} className={inp} dir="ltr" /></div>
                </div>
                <input value={lvEdit.note} onChange={(e) => setLvEdit({ ...lvEdit, note: e.target.value })}
                  placeholder={t({ ar: "ملاحظة التعديل (تظهر للموظف)", en: "Edit note (shown to employee)" })} className={inp} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void saveLeaveEdit()} className={`${btnRed} flex-1 py-2`}>{t({ ar: "حفظ وإشعار الموظف", en: "Save & notify" })}</button>
                  <button type="button" onClick={() => setLvEdit(null)} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إغلاق", en: "Close" })}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ المهام ═══ */}
      {tab === "tasks" && (
        <div className="space-y-4">
          {taskFilter === "open" && (
            <FilterBadge label={t({ ar: "المهام المفتوحة فقط (مُسندة/قيد التنفيذ/مُسلّمة)", en: "Open tasks only" })} onClear={() => setTaskFilter("")} />
          )}
          <section className={card}>
            <h3 className="text-sm font-medium text-stone-100 mb-3">
              {tfId ? t({ ar: "تعديل مهمة ميدانية", en: "Edit field task" }) : t({ ar: "إنشاء مهمة ميدانية", en: "Create field task" })}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={tf.title} onChange={(e) => setTf({ ...tf, title: e.target.value })} placeholder={t({ ar: "عنوان المهمة *", en: "Title *" })} className={inp} />
              <input value={tf.clientName} onChange={(e) => setTf({ ...tf, clientName: e.target.value })} placeholder={t({ ar: "اسم العميل", en: "Client name" })} className={inp} />
              <input value={tf.projectName} onChange={(e) => setTf({ ...tf, projectName: e.target.value })} placeholder={t({ ar: "اسم المشروع (اختياري)", en: "Project (optional)" })} className={inp} />
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "نوع المهمة", en: "Type" })}</label>
                  <select value={tf.taskType} onChange={(e) => setTf({ ...tf, taskType: e.target.value as TaskType })} className={inp}>
                    {(Object.keys(TASK_TYPE_LABELS) as TaskType[]).map((k) => (
                      <option key={k} value={k}>{isAr ? TASK_TYPE_LABELS[k].ar : TASK_TYPE_LABELS[k].en}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "الأولوية", en: "Priority" })}</label>
                  <select value={tf.priority} onChange={(e) => setTf({ ...tf, priority: e.target.value as TaskPriority })} className={inp}>
                    {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((k) => (
                      <option key={k} value={k}>{isAr ? TASK_PRIORITY_LABELS[k].ar : TASK_PRIORITY_LABELS[k].en}</option>
                    ))}
                  </select>
                </div>
              </div>
              <input value={tf.location} onChange={(e) => setTf({ ...tf, location: e.target.value })} placeholder={t({ ar: "اسم الموقع (مثل: استوديو العميل — حي الياسمين)", en: "Location name" })} className={inp} />
              <input value={tf.city} onChange={(e) => setTf({ ...tf, city: e.target.value })} placeholder={t({ ar: "المدينة", en: "City" })} className={inp} />
              <input value={tf.mapsUrl} onChange={(e) => setTf({ ...tf, mapsUrl: e.target.value })} placeholder={t({ ar: "رابط Google Maps (اختياري)", en: "Google Maps URL (optional)" })} dir="ltr" className={inp + " sm:col-span-2"} />
              <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "بداية متوقعة", en: "Expected start" })}</label>
                <input type="datetime-local" value={tf.start} onChange={(e) => setTf({ ...tf, start: e.target.value })} className={inp} dir="ltr" /></div>
              <div><label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "نهاية متوقعة", en: "Expected end" })}</label>
                <input type="datetime-local" value={tf.end} onChange={(e) => setTf({ ...tf, end: e.target.value })} className={inp} dir="ltr" /></div>
            </div>
            <textarea value={tf.desc} onChange={(e) => setTf({ ...tf, desc: e.target.value })} rows={2}
              placeholder={t({ ar: "وصف المهمة / تفاصيل", en: "Description / details" })} className={inp + " mt-2"} />
            <textarea value={tf.equipment} onChange={(e) => setTf({ ...tf, equipment: e.target.value })} rows={2}
              placeholder={t({ ar: "المعدات المطلوبة (نصيًا — مثال: كاميرا A7S3، إضاءتان، ميكروفونان)", en: "Equipment needed (text)" })} className={inp + " mt-2"} />
            <textarea value={tf.requirements} onChange={(e) => setTf({ ...tf, requirements: e.target.value })} rows={2}
              placeholder={t({ ar: "متطلبات خاصة (اختياري)", en: "Special requirements (optional)" })} className={inp + " mt-2"} />
            <textarea value={tf.execNotes} onChange={(e) => setTf({ ...tf, execNotes: e.target.value })} rows={2}
              placeholder={t({ ar: "ملاحظات التنفيذ (اختياري)", en: "Execution notes (optional)" })} className={inp + " mt-2"} />
            <div className="mt-2">
              <label className="block text-[11px] text-stone-500 mb-1">{t({ ar: "دليل التسليم المطلوب من الموظف", en: "Required delivery evidence" })}</label>
              <select value={tf.evidenceMode} onChange={(e) => setTf({ ...tf, evidenceMode: e.target.value as EvidenceMode | "" })} className={inp}>
                <option value="">{t({ ar: "حسب الإعداد العام (افتراضي)", en: "Follow global setting (default)" })}</option>
                {(Object.keys(EVIDENCE_MODE_LABELS) as EvidenceMode[]).map((k) => (
                  <option key={k} value={k}>{isAr ? EVIDENCE_MODE_LABELS[k].ar : EVIDENCE_MODE_LABELS[k].en}</option>
                ))}
              </select>
            </div>
            {!tfId && (
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
            )}
            {tfId && (
              <p className="mt-2 text-[11px] text-stone-500">{t({ ar: "الإسناد لا يتغير من نموذج التعديل — سيُشعر المسندون الحاليون بالتحديث.", en: "Assignment doesn't change here — current assignees will be notified." })}</p>
            )}
            <div className="flex gap-2 mt-3">
              <button type="button" disabled={busy} onClick={() => void saveTask()} className={`${btnRed} px-5 py-2`}>
                {tfId ? t({ ar: "حفظ التعديل وإشعار المسندين", en: "Save & notify assignees" }) : t({ ar: "إنشاء وإسناد", en: "Create & assign" })}
              </button>
              {tfId && (
                <button type="button" onClick={() => { setTf(emptyTf); setTfId(null); }} className={`${btnGhost} px-4 py-2`}>
                  {t({ ar: "إلغاء التعديل", en: "Cancel edit" })}
                </button>
              )}
            </div>
          </section>

          <div className="space-y-2">
            {tasks
              .filter((tk) => taskFilter !== "open" || ["assigned", "in_progress", "submitted"].includes(tk.status))
              .map((tk) => {
              const st = TASK_STATUS_LABELS[tk.status] ?? { ar: tk.status, en: tk.status };
              const open = openTask === tk.id;
              return (
                <div key={tk.id} className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
                  <button type="button" onClick={() => void toggleTask(tk.id)} className="w-full flex items-center gap-2 p-3 text-start flex-wrap">
                    <span className="text-sm font-medium text-stone-100">{tk.title}</span>
                    <span className={chip("bg-stone-800 text-stone-300 border-stone-700")}>{t(st)}</span>
                    {tk.task_type && <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{t(TASK_TYPE_LABELS[tk.task_type] ?? { ar: tk.task_type, en: tk.task_type })}</span>}
                    {tk.priority && tk.priority !== "normal" && (
                      <span className={chip(tk.priority === "urgent" ? "bg-red-950 text-red-300 border-red-800" : tk.priority === "high" ? "bg-amber-950 text-amber-300 border-amber-800" : "bg-stone-800 text-stone-400 border-stone-700")}>
                        {t(TASK_PRIORITY_LABELS[tk.priority] ?? { ar: tk.priority, en: tk.priority })}
                      </span>
                    )}
                    {tk.client_name && <span className="text-[11px] text-stone-500">{tk.client_name}</span>}
                    {tk.location_name && <span className="text-[11px] text-stone-500">📍 {tk.location_name}</span>}
                    <span className="ms-auto text-stone-500 text-xs">{open ? "▲" : "▼"}</span>
                  </button>
                  {open && (
                    <div className="px-3 pb-3 space-y-2">
                      {(tk.project_name || tk.city || tk.maps_url) && (
                        <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[11px] text-stone-400">
                          {tk.project_name && <span>{t({ ar: "المشروع: ", en: "Project: " })}<span className="text-stone-300">{tk.project_name}</span></span>}
                          {tk.city && <span>{t({ ar: "المدينة: ", en: "City: " })}<span className="text-stone-300">{tk.city}</span></span>}
                          {tk.maps_url && <a className="text-sky-400 underline" href={tk.maps_url} target="_blank" rel="noopener noreferrer">{t({ ar: "موقع المهمة على الخرائط", en: "Maps" })}</a>}
                        </div>
                      )}
                      {tk.description && <p className="text-xs text-stone-400">{tk.description}</p>}
                      {tk.equipment_needed && <p className="text-[11px] text-stone-400">🎥 {t({ ar: "المعدات: ", en: "Equipment: " })}{tk.equipment_needed}</p>}
                      {tk.special_requirements && <p className="text-[11px] text-amber-300/80">⚠️ {t({ ar: "متطلبات خاصة: ", en: "Requirements: " })}{tk.special_requirements}</p>}
                      {tk.execution_notes && <p className="text-[11px] text-stone-400">📝 {t({ ar: "ملاحظات التنفيذ: ", en: "Exec notes: " })}{tk.execution_notes}</p>}
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
                          {["draft", "assigned", "in_progress"].includes(tk.status) && (
                            <button type="button" disabled={busy} onClick={() => startEditTask(tk)} className={`${btnGhost} px-4 py-2 text-xs`}>
                              {t({ ar: "تعديل المهمة", en: "Edit task" })}
                            </button>
                          )}
                          <button type="button" disabled={busy} onClick={() => void closeTask(tk, "complete")} className={`${btnRed} px-4 py-2 text-xs`}>
                            {t({ ar: "اعتماد الإغلاق", en: "Approve closure" })}
                          </button>
                          {["submitted", "in_progress"].includes(tk.status) && (
                            <button type="button" disabled={busy} className={`${btnGhost} px-4 py-2 text-xs`}
                              onClick={() => setRevFor2(revFor2?.id === tk.id ? null : { id: tk.id, note: "" })}>
                              {t({ ar: "طلب تعديل", en: "Request revision" })}
                            </button>
                          )}
                          <button type="button" disabled={busy} onClick={() => void closeTask(tk, "cancel")} className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-xs px-4 py-2 disabled:opacity-50">
                            {t({ ar: "إلغاء المهمة", en: "Cancel task" })}
                          </button>
                          {/* إعادة توزيع إشعار الإسناد (بوابة+بريد) من الخادم — دون إعادة إنشاء المهمة */}
                          <button type="button" disabled={busy} onClick={() => void doResendAssignment(tk)} className={`${btnGhost} px-4 py-2 text-xs`}
                            title={t({ ar: "إعادة إرسال إشعار الإسناد للموظف والمشرف والإدارة", en: "Re-send assignment notification" })}>
                            {t({ ar: "إعادة إرسال الإشعار", en: "Re-send notice" })}
                          </button>
                        </div>
                      )}
                      {/* طلب تعديل — يُعيد المهمة للتنفيذ بملاحظة إلزامية */}
                      {revFor2?.id === tk.id && (
                        <div className="flex gap-2 flex-wrap items-center bg-stone-950 border border-stone-800 rounded-lg p-2">
                          <input value={revFor2.note} onChange={(e) => setRevFor2({ id: tk.id, note: e.target.value })}
                            placeholder={t({ ar: "ملاحظة التعديل المطلوب (إلزامية)", en: "Revision note (required)" })} className={inp + " flex-1 min-w-[180px]"} style={{ width: "auto" }} />
                          <button type="button" disabled={busy} onClick={() => void doRequestRevision(tk)} className={`${btnRed} px-4 py-1.5 text-xs`}>
                            {t({ ar: "إرسال طلب التعديل", en: "Send revision" })}
                          </button>
                        </div>
                      )}
                      {/* أدلة التسليم (صور/ملفات/روابط) */}
                      {(evidenceByTask[tk.id] ?? []).length > 0 && (
                        <div className="flex gap-1.5 flex-wrap items-center text-[11px] border-t border-stone-800 pt-1.5">
                          <span className="text-stone-500">{t({ ar: "أدلة التسليم:", en: "Evidence:" })}</span>
                          {(evidenceByTask[tk.id] ?? []).map((ev) => ev.kind === "link" ? (
                            <a key={ev.id} href={ev.link_url || "#"} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline">🔗 {t({ ar: "رابط", en: "Link" })}</a>
                          ) : (
                            <button key={ev.id} type="button" className="text-sky-400 underline" onClick={() => void openEvidenceFile(ev)}>
                              📎 {ev.file_name || t({ ar: "ملف", en: "File" })}
                            </button>
                          ))}
                        </div>
                      )}
                      {/* حذف إداري آمن للمهمة — سبب إلزامي */}
                      <div className="flex gap-2 flex-wrap items-center">
                        <button type="button" disabled={busy} className="text-[11px] text-stone-500 hover:text-red-400 underline"
                          onClick={() => setDelTask(delTask?.id === tk.id ? null : { id: tk.id, reason: "" })}>
                          {t({ ar: "حذف المهمة (آمن)", en: "Soft delete task" })}
                        </button>
                        {delTask?.id === tk.id && (
                          <>
                            <input value={delTask.reason} onChange={(e) => setDelTask({ id: tk.id, reason: e.target.value })}
                              placeholder={t({ ar: "سبب الحذف (إلزامي)", en: "Reason (required)" })} className={inp + " flex-1 min-w-[160px]"} style={{ width: "auto" }} />
                            <button type="button" disabled={busy} onClick={() => void doDeleteTask(tk)}
                              className="rounded-lg bg-stone-900 border border-red-900 text-red-400 text-[11px] px-3 py-1.5 disabled:opacity-50">
                              {t({ ar: "تأكيد الحذف", en: "Confirm" })}
                            </button>
                          </>
                        )}
                      </div>
                      {/* تقييم الأداء (داخلي) — بعد إغلاق المهمة */}
                      {["completed", "cancelled"].includes(tk.status) && (
                        <div className="border-t border-stone-800 pt-2 space-y-1.5">
                          <div className="text-[11px] text-stone-400 font-medium">
                            {t({ ar: "تقييم الأداء (داخلي للإدارة)", en: "Performance review (internal)" })}
                            {!settings.show_performance_reviews_enabled && (
                              <span className="text-stone-600"> — {t({ ar: "مخفي عن الموظفين", en: "hidden from employees" })}</span>
                            )}
                          </div>
                          {(assigneesByTask[tk.id] ?? []).map((a) => {
                            const rv = (reviewsByTask[tk.id] ?? []).find((x) => x.employee_id === a.employee_id);
                            const active = revFor?.taskId === tk.id && revFor?.employeeId === a.employee_id;
                            return (
                              <div key={a.id} className="text-[11px] text-stone-400 space-y-1">
                                <div className="flex gap-2 flex-wrap items-center">
                                  <span className="text-stone-200">{empName(a.user_id)}</span>
                                  {rv ? (
                                    <span className="font-mono text-amber-300">
                                      ⏱{rv.punctuality_rating ?? "—"} · 🎯{rv.quality_rating ?? "—"} · 💬{rv.communication_rating ?? "—"}
                                    </span>
                                  ) : <span className="text-stone-600">{t({ ar: "بلا تقييم", en: "no review" })}</span>}
                                  {rv?.admin_review_note && <span className="text-stone-500">— {rv.admin_review_note}</span>}
                                  <button type="button" disabled={busy} className="text-red-300 underline"
                                    onClick={() => {
                                      if (active) { setRevFor(null); return; }
                                      setRevFor({ taskId: tk.id, employeeId: a.employee_id, userId: a.user_id });
                                      setRevForm({ p: rv?.punctuality_rating ?? 0, q: rv?.quality_rating ?? 0, c: rv?.communication_rating ?? 0, note: rv?.admin_review_note ?? "" });
                                    }}>
                                    {rv ? t({ ar: "تعديل التقييم", en: "Edit review" }) : t({ ar: "تقييم", en: "Review" })}
                                  </button>
                                </div>
                                {active && (
                                  <div className="flex gap-2 flex-wrap items-center bg-stone-950 border border-stone-800 rounded-lg p-2">
                                    {([["p", "الانضباط"], ["q", "الجودة"], ["c", "التواصل"]] as const).map(([k, lbl]) => (
                                      <label key={k} className="flex items-center gap-1 text-[11px] text-stone-400">
                                        {lbl}
                                        <select value={revForm[k]} onChange={(e) => setRevForm({ ...revForm, [k]: Number(e.target.value) })}
                                          className={inp} style={{ width: "auto", paddingTop: 4, paddingBottom: 4 }}>
                                          <option value={0}>—</option>
                                          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                                        </select>
                                      </label>
                                    ))}
                                    <input value={revForm.note} onChange={(e) => setRevForm({ ...revForm, note: e.target.value })}
                                      placeholder={t({ ar: "ملاحظة التقييم", en: "Note" })} className={inp + " flex-1 min-w-[120px]"} style={{ width: "auto", paddingTop: 4, paddingBottom: 4 }} />
                                    <button type="button" disabled={busy} onClick={() => void saveReview()} className={`${btnRed} px-3 py-1.5 text-[11px]`}>
                                      {t({ ar: "حفظ", en: "Save" })}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                          })}
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

      {/* ═══ طلبات تعديل الحضور ═══ */}
      {tab === "corrections" && (
        <HrCorrectionRequests employees={employees} pendingOnly={corrPendingOnly}
          onClearFilter={() => setCorrPendingOnly(false)} busy={busy} setBusy={setBusy} flash={flash} onChanged={reload} />
      )}

      {/* ═══ التقرير الشهري ═══ */}
      {tab === "monthly" && (
        <HrMonthlyReport employees={employees} busy={busy} setBusy={setBusy} flash={flash} />
      )}

      {/* ═══ الخصومات / الرواتب ═══ */}
      {tab === "payroll" && (
        <HrPayrollReport employees={employees} busy={busy} setBusy={setBusy} flash={flash} />
      )}

      {/* ═══ الوثائق — عرض الوثائق القريبة من الانتهاء + إدارتها من ملف الموظف ═══ */}
      {tab === "documents" && (
        <div className="space-y-3">
          <section className={card}>
            <h3 className="text-sm font-medium text-stone-100 mb-2">📄 {t({ ar: "وثائق قريبة من الانتهاء (خلال 90 يومًا)", en: "Documents expiring within 90 days" })}</h3>
            {expiring.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا وثائق قريبة من الانتهاء.", en: "No documents expiring soon." })}</p>}
            <div className="space-y-1">
              {expiring.map((d) => (
                <div key={d.id} className="flex items-center gap-2 flex-wrap text-[11.5px] border-t border-stone-800 py-1.5">
                  <span className="text-stone-100">{d.full_name}</span>
                  <span className={chip("bg-stone-800 text-sky-300 border-stone-700")}>{t(DOCUMENT_TYPE_LABELS[d.document_type] ?? { ar: d.document_type, en: d.document_type })}</span>
                  <span className="text-stone-400">{d.title}</span>
                  <span className={`font-mono ms-auto ${d.days_left <= 30 ? "text-red-400" : d.days_left <= 60 ? "text-amber-400" : "text-stone-500"}`} dir="ltr">
                    {d.expiry_date} · {d.days_left} {t({ ar: "يوم", en: "d" })}
                  </span>
                  <button type="button" className="text-red-300 underline text-[11px]"
                    onClick={() => { setTab("employees"); setEmpFilter(""); setOpenEmp(d.employee_id); const emp = employees.find((x) => x.id === d.employee_id); if (emp) void loadEmployeeExtras(emp); void loadEvents(d.employee_id); }}>
                    {t({ ar: "فتح ملف الموظف", en: "Open file" })}
                  </button>
                </div>
              ))}
            </div>
          </section>
          <p className="text-[11px] text-stone-500">{t({ ar: "لإضافة/تعديل وثائق موظف افتح تبويب «الموظفون» ثم ملف الموظف.", en: "Add/edit documents from the Employees tab → employee file." })}</p>
        </div>
      )}

      {/* ═══ أجهزة الحضور ═══ */}
      {tab === "devices" && (
        <HrDevices employees={employees} settings={settings} busy={busy} setBusy={setBusy} flash={flash} />
      )}

      {/* ═══ التقويم ═══ */}
      {tab === "calendar" && (
        <HrCalendar busy={busy} setBusy={setBusy} flash={flash} onChanged={reload} />
      )}

      {/* ═══ سجل العمليات ═══ */}
      {tab === "audit" && (
        <HrAuditLog employees={employees} busy={busy} setBusy={setBusy} flash={flash} />
      )}

      {/* ═══ المشرفون الميدانيون ═══ */}
      {tab === "supervisors" && (
        <div className="space-y-3">
          <section className={card}>
            <h3 className="text-sm font-medium text-stone-100 mb-2">👥 {t({ ar: "بنية الإشراف الميداني", en: "Field supervision" })}</h3>
            <p className="text-[11px] text-stone-500 mb-3">{t({ ar: "لتعيين مشرف لموظف: افتح تبويب «الموظفون» ← ملف الموظف ← المشرف الميداني. المشرف يرى فريقه فقط في بوابته (بلا وثائق/رواتب/مواقع).",
                 en: "Assign supervisors from a staff file. A supervisor sees only their team in the portal." })}</p>
            {supLinks.length === 0 && <p className="text-stone-500 text-sm">{t({ ar: "لا روابط إشراف نشطة.", en: "No active supervisor links." })}</p>}
            <div className="space-y-3">
              {Array.from(new Set(supLinks.map((l) => l.supervisor_employee_id))).map((supId) => {
                const sup = employees.find((e) => e.id === supId);
                const team = supLinks.filter((l) => l.supervisor_employee_id === supId);
                return (
                  <div key={supId} className="bg-stone-950 border border-stone-800 rounded-lg p-3">
                    <div className="text-sm text-stone-100 mb-1.5">🧭 {sup?.full_name || supId.slice(0, 8)}
                      <span className="text-stone-500 text-xs font-normal"> — {team.length} {t({ ar: "من الفريق", en: "team member(s)" })}</span>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                      {team.map((l) => {
                        const m = employees.find((e) => e.id === l.employee_id);
                        return <span key={l.id} className={chip("bg-stone-800 text-stone-300 border-stone-700")}>{m?.full_name || l.employee_id.slice(0, 8)}</span>;
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {/* ═══ الإعدادات ═══ */}
      {tab === "settings" && (
        <HrSettingsPanel settings={settings} busy={busy} setBusy={setBusy} flash={flash} onSaved={reload} />
      )}

      {toast && (
        <div className="fixed bottom-5 z-50 bg-black/90 border border-stone-700 rounded-xl px-4 py-2.5 text-sm text-white max-w-sm" style={{ insetInlineEnd: 20 }}>
          {toast}
        </div>
      )}
    </div>
  );
}
