// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/hr/tasks/assign   (SERVER-ONLY)
//
// عملية إسناد المهمة وتوزيع إشعاراتها كاملةً من الخادم — الواجهة تستدعيه مرة
// واحدة وتنتظره (لا emitHrEvent هش من المتصفح). action:
//   create  → ينشئ المهمة (RPC) + يضبط وضع الدليل + يُشعر المشرفين (بوابة) + بريد.
//   update  → يحدّث المهمة (RPC) + يُشعر المشرفين + بريد.
//   resend  → يعيد إنشاء إشعارات البوابة للجميع + بريد (بلا إعادة إنشاء المهمة).
//
// الصلاحية: assertHrAdmin() الموحّد — قراره من can_manage_hr() في القاعدة (نفس ما
// تفرضه الـ RPCs)، محصّن ضد فشل قراءة profiles. إشعارات البوابة تُنشأ في القاعدة
// (RPCs)، والبريد عبر hrTaskDispatch (من auth.users). فشل البريد لا يفشل حفظ المهمة.
// يُرجِع خريطة مراحل (stages) لكل تنفيذ: حفظ/إسناد/بوابة/بريد الموظف/الإدارة/المشرف.
// لا يُسجَّل بريد/JWT/مفاتيح.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { selectAsService, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { assertHrAdmin } from "@/lib/server/hrAuth";
import { dispatchTaskAssignmentEmail } from "@/lib/server/hrTaskDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const enc = (v: string) => encodeURIComponent(v);

type Stage = { status: "ok" | "failed" | "skipped"; count?: number; reason?: string };

export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : "";

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const action = str(b.action) || "create";

  log("HR_TASK_ASSIGNMENT_REQUEST_RECEIVED", { action, bearer_present: !!bearer, service_key_present: adminConfigured() });

  // ─── الصلاحية الموحّدة (can_manage_hr عبر جلسة المستخدم) ───
  const auth = await assertHrAdmin(bearer, "hr_tasks_assign");
  if (!auth.ok) {
    // 403 not_authorized = رفض حقيقي؛ 503 auth_check_failed = عطل تحقق مؤقت (ليس رفض صلاحية).
    return NextResponse.json({ ok: false, error: auth.error, failed_on: auth.failedOn }, { status: auth.status });
  }

  const stages: Record<string, Stage> = { auth: { status: "ok" } };

  // ─── 1) حفظ المهمة/المسندين (أو لا شيء عند resend) عبر RPCs بجلسة المستخدم ───
  let taskId = str(b.task_id);
  const asArr = (v: unknown): string[] => Array.isArray(v) ? (v as unknown[]).map((x) => str(x)).filter(Boolean) : [];

  if (action === "create") {
    const create = await rpcAsUser<{ ok: boolean; id: string; assignees: number }>("hr_admin_create_field_task", {
      p_title: str(b.title), p_description: str(b.description) || null, p_location: str(b.location) || null,
      p_maps_url: str(b.maps_url) || null, p_city: str(b.city) || null,
      p_client_name: str(b.client_name) || null, p_project_name: str(b.project_name) || null,
      p_task_type: str(b.task_type) || "other", p_priority: str(b.priority) || "normal",
      p_equipment: str(b.equipment) || null, p_requirements: str(b.requirements) || null, p_exec_notes: str(b.exec_notes) || null,
      p_expected_start: str(b.expected_start) || null, p_expected_end: str(b.expected_end) || null,
      p_assignees: asArr(b.assignees),
    }, bearer);
    if (!create.ok || !create.data?.id) {
      log("HR_TASK_ASSIGNMENT_SAVE_FAILED", { action, reason: create.ok ? "no_id" : create.error });
      return NextResponse.json({ ok: false, error: create.ok ? "create_failed" : create.error, stages: { ...stages, task_saved: { status: "failed", reason: create.ok ? "no_id" : create.error } } }, { status: 400 });
    }
    taskId = create.data.id;
    stages.task_saved = { status: "ok", count: create.data.assignees };
    log("HR_TASK_ASSIGNMENT_SAVED", { action, task_id: taskId, assignees: create.data.assignees });
    await rpcAsUser("hr_admin_set_task_evidence_mode", { p_task: taskId, p_mode: str(b.evidence_mode) || null }, bearer);
    const sup = await rpcAsUser("hr_notify_task_supervisors", { p_task: taskId }, bearer); // بوابة المشرفين (يُتجاهل إن غاب)
    stages.portal_notify = sup.ok ? { status: "ok" } : { status: "skipped", reason: sup.error };
  } else if (action === "update") {
    if (!taskId) return NextResponse.json({ ok: false, error: "task_id_required" }, { status: 400 });
    const upd = await rpcAsUser<boolean>("hr_admin_update_field_task", {
      p_task: taskId, p_title: str(b.title), p_description: str(b.description) || null, p_location: str(b.location) || null,
      p_maps_url: str(b.maps_url) || null, p_city: str(b.city) || null,
      p_client_name: str(b.client_name) || null, p_project_name: str(b.project_name) || null,
      p_task_type: str(b.task_type) || null, p_priority: str(b.priority) || null,
      p_equipment: str(b.equipment) || null, p_requirements: str(b.requirements) || null, p_exec_notes: str(b.exec_notes) || null,
      p_expected_start: str(b.expected_start) || null, p_expected_end: str(b.expected_end) || null,
    }, bearer);
    if (!upd.ok) return NextResponse.json({ ok: false, error: upd.error, stages: { ...stages, task_saved: { status: "failed", reason: upd.error } } }, { status: 400 });
    stages.task_saved = { status: "ok" };
    log("HR_TASK_ASSIGNMENT_SAVED", { action, task_id: taskId });
    await rpcAsUser("hr_admin_set_task_evidence_mode", { p_task: taskId, p_mode: str(b.evidence_mode) || null }, bearer);
    const sup = await rpcAsUser("hr_notify_task_supervisors", { p_task: taskId }, bearer);
    stages.portal_notify = sup.ok ? { status: "ok" } : { status: "skipped", reason: sup.error };
  } else if (action === "resend") {
    if (!taskId) return NextResponse.json({ ok: false, error: "task_id_required" }, { status: 400 });
    stages.task_saved = { status: "skipped", reason: "resend" };
    // إعادة إنشاء إشعارات البوابة للجميع (RPC جديد؛ إن غاب لا يفشل البريد).
    const rn = await rpcAsUser<number>("hr_notify_task_assignment", { p_task: taskId }, bearer);
    if (!rn.ok) log("HR_TASK_ASSIGNMENT_PORTAL_RENOTIFY_SKIPPED", { task_id: taskId, reason: rn.error });
    stages.portal_notify = rn.ok ? { status: "ok" } : { status: "skipped", reason: rn.error };
  } else {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  // ─── 2) إعادة قراءة المسندين (إثبات — تقريري فقط، لا يحكم على ok) ───
  // فشل القراءة (service-role) يُعامَل «تعذّر التحقق» لا «فشل» — حتى لا نعيد نفس
  // الخطأ الجذري (قراءة profiles الفاشلة كانت تُترجم رفضًا). لا يؤثر على ok إطلاقًا.
  const rows = await selectAsService<{ user_id: string }[]>(
    `hr_field_task_assignees?task_id=eq.${enc(taskId)}&select=user_id`);
  const assignedUserCount = rows.ok ? rows.data.length : 0;
  stages.assignment_rows = !rows.ok ? { status: "skipped", reason: "reread_failed" }
    : assignedUserCount > 0 ? { status: "ok", count: assignedUserCount }
    : { status: "failed", count: 0, reason: "no_assignee_rows" };
  log("HR_TASK_ASSIGNMENT_ROWS_LOADED", { task_id: taskId, assigned_user_count: assignedUserCount, rows_read_ok: rows.ok });

  // ─── 3) البريد (من auth.users، مفصول الجمهور، بلا تكرار) ───
  const title = str(b.title);
  const detailParts = [
    title && "المهمة: " + title,
    str(b.client_name) && "العميل: " + str(b.client_name),
    str(b.project_name) && "المشروع: " + str(b.project_name),
    [str(b.location), str(b.city)].filter(Boolean).join(" — ") && "الموقع: " + [str(b.location), str(b.city)].filter(Boolean).join(" — "),
    str(b.expected_start) && "الوقت المتوقع: " + str(b.expected_start),
    str(b.priority) && "الأولوية: " + str(b.priority),
    str(b.requirements) && "متطلبات: " + str(b.requirements),
  ].filter(Boolean).join("\n");
  const email = await dispatchTaskAssignmentEmail({ taskId, bearer, title, details: detailParts });

  const emailStage = (sent: boolean, resolved: number, count: number, reason: string): Stage =>
    sent ? { status: "ok", count } : resolved === 0 ? { status: "skipped", count: 0, reason } : { status: "failed", count: 0, reason };
  stages.employee_email = emailStage(email.employees_sent, email.employees_resolved, email.employee_email_count, "no_employee_email");
  stages.supervisor_email = emailStage(email.supervisors_sent, email.supervisor_email_count, email.supervisor_email_count, "no_supervisor_email");
  stages.admin_email = emailStage(email.admins_sent, email.admin_email_count, email.admin_email_count, "no_admin_email");

  log("HR_TASK_ASSIGNMENT_PORTAL_CREATED", {
    task_id: taskId, employee_portal_count: email.assigned_count, admin_portal_count: email.admin_count, supervisor_portal_count: email.supervisor_count,
  });

  // ok = نجاح العملية الأساسية: الوصول هنا يعني أن create/update نجحا (يرجعان 400 عند
  // الفشل) أو أن resend نُفّذ — فالبريد/البوابة/إعادة القراءة كلها best-effort ولا تُفشِل
  // الطلب مطلقًا (تصحيح: كانت تُرجع ok:false على HTTP 200 فتظهر «HTTP 200» للمستخدم).
  // complete = «الست مراحل» كلها ok (بوابة + بريد الموظف/المشرف/الإدارة) — إشارة الاكتمال.
  const complete = Object.values(stages).every((s) => s.status === "ok");
  const incompleteStages = Object.entries(stages).filter(([, v]) => v.status !== "ok").map(([k]) => k);

  log("HR_TASK_ASSIGNMENT_COMPLETED", {
    action, task_id: taskId, ok: true, complete, incomplete_stages: incompleteStages,
    stages: Object.fromEntries(Object.entries(stages).map(([k, v]) => [k, v.status])),
    employee_email_count: email.employee_email_count, admin_email_count: email.admin_email_count, supervisor_email_count: email.supervisor_email_count,
    employee_email_source: email.employee_email_source,
  });

  return NextResponse.json({
    ok: true, complete, incomplete_stages: incompleteStages,
    task_id: taskId, assignment_saved: stages.task_saved?.status === "ok",
    stages,
    portal: { employees: email.assigned_count, supervisors: email.supervisor_count, admins: email.admin_count },
    email: {
      employees_resolved: email.employees_resolved, employees_sent: email.employees_sent ? email.employee_email_count : 0,
      supervisors_sent: email.supervisors_sent ? email.supervisor_email_count : 0,
      admins_sent: email.admins_sent ? email.admin_email_count : 0,
      employee_email_source: email.employee_email_source, skipped: email.skipped,
    },
  }, { status: 200 });
}
