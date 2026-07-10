// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/hr/tasks/assign   (SERVER-ONLY)
//
// عملية إسناد المهمة وتوزيع إشعاراتها كاملةً من الخادم — الواجهة تستدعيه مرة
// واحدة وتنتظره (لا emitHrEvent هش من المتصفح). action:
//   create  → ينشئ المهمة (RPC) + يضبط وضع الدليل + يُشعر المشرفين (بوابة) + بريد.
//   update  → يحدّث المهمة (RPC) + يُشعر المشرفين + بريد.
//   resend  → يعيد إنشاء إشعارات البوابة للجميع + بريد (بلا إعادة إنشاء المهمة).
// إشعارات البوابة تُنشأ في القاعدة (RPCs)، والبريد عبر hrTaskDispatch (من auth.users).
// فشل البريد لا يفشل حفظ المهمة. لا يُسجَّل بريد/JWT/مفاتيح.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, selectAsService, rpcAsUser, adminConfigured } from "@/lib/server/supabaseAdmin";
import { dispatchTaskAssignmentEmail } from "@/lib/server/hrTaskDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const enc = (v: string) => encodeURIComponent(v);

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const action = str(b.action) || "create";

  // هوية المُرسِل من الـ JWT (لا من profiles) + التحقق أنه إداري HR.
  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  log("HR_TASK_ASSIGNMENT_REQUEST_RECEIVED", { action, actor_present: !!uid, service_key_present: adminConfigured(), endpoint_present: true });
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });
  // نفس منطق can_manage_hr() في القاعدة: (admin) أو staff_role∈(super_admin,manager,hr) — وبحساب نشِط فقط.
  const me = await selectAsService<{ staff_role: string | null; account_type: string; account_status: string }[]>(
    `profiles?id=eq.${enc(uid)}&select=staff_role,account_type,account_status&limit=1`);
  const p = me.ok ? me.data[0] : undefined;
  const isHrAdmin = !!p && p.account_status === "active" && (p.account_type === "admin" || ["super_admin", "manager", "hr"].includes(p.staff_role ?? ""));
  if (!isHrAdmin) {
    log("HR_TASK_ASSIGNMENT_FORBIDDEN", { action, by: uid });
    return NextResponse.json({ ok: false, error: "not_authorized" }, { status: 403 });
  }

  // ─── 1) حفظ المهمة/المسندين (أو لا شيء عند resend) عبر RPCs بجلسة الأدمن ───
  let taskId = str(b.task_id);
  let assignmentSaved = false;
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
      return NextResponse.json({ ok: false, error: create.ok ? "create_failed" : create.error }, { status: 400 });
    }
    taskId = create.data.id; assignmentSaved = true;
    log("HR_TASK_ASSIGNMENT_SAVED", { action, task_id: taskId, assignees: create.data.assignees });
    await rpcAsUser("hr_admin_set_task_evidence_mode", { p_task: taskId, p_mode: str(b.evidence_mode) || null }, bearer);
    await rpcAsUser("hr_notify_task_supervisors", { p_task: taskId }, bearer); // بوابة المشرفين (يُتجاهل إن غاب)
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
    if (!upd.ok) return NextResponse.json({ ok: false, error: upd.error }, { status: 400 });
    assignmentSaved = true;
    log("HR_TASK_ASSIGNMENT_SAVED", { action, task_id: taskId });
    await rpcAsUser("hr_admin_set_task_evidence_mode", { p_task: taskId, p_mode: str(b.evidence_mode) || null }, bearer);
    await rpcAsUser("hr_notify_task_supervisors", { p_task: taskId }, bearer);
  } else if (action === "resend") {
    if (!taskId) return NextResponse.json({ ok: false, error: "task_id_required" }, { status: 400 });
    // إعادة إنشاء إشعارات البوابة للجميع (RPC جديد؛ إن غاب لا يفشل البريد).
    const rn = await rpcAsUser<number>("hr_notify_task_assignment", { p_task: taskId }, bearer);
    if (!rn.ok) log("HR_TASK_ASSIGNMENT_PORTAL_RENOTIFY_SKIPPED", { task_id: taskId, reason: rn.error });
    assignmentSaved = true;
  } else {
    return NextResponse.json({ ok: false, error: "invalid_action" }, { status: 400 });
  }

  // ─── 2) إعادة قراءة المسندين (إثبات الحفظ) ───
  const rows = await selectAsService<{ user_id: string }[]>(
    `hr_field_task_assignees?task_id=eq.${enc(taskId)}&select=user_id`);
  const assignedUserCount = rows.ok ? rows.data.length : 0;
  log("HR_TASK_ASSIGNMENT_ROWS_LOADED", { task_id: taskId, assigned_user_count: assignedUserCount });

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

  log("HR_TASK_ASSIGNMENT_PORTAL_CREATED", {
    task_id: taskId, employee_portal_count: email.assigned_count, admin_portal_count: email.admin_count, supervisor_portal_count: email.supervisor_count,
  });
  log("HR_TASK_ASSIGNMENT_COMPLETED", { action, task_id: taskId, assignment_saved: assignmentSaved,
    employee_email_count: email.employee_email_count, admin_email_count: email.admin_email_count, supervisor_email_count: email.supervisor_email_count });

  return NextResponse.json({
    ok: true, task_id: taskId, assignment_saved: assignmentSaved,
    portal: { employees: email.assigned_count, supervisors: email.supervisor_count, admins: email.admin_count },
    email: {
      employees_resolved: email.employees_resolved, employees_sent: email.employees_sent ? email.employee_email_count : 0,
      supervisors_sent: email.supervisors_sent ? email.supervisor_email_count : 0,
      admins_sent: email.admins_sent ? email.admin_email_count : 0,
      employee_email_source: email.employee_email_source, skipped: email.skipped,
    },
  }, { status: 200 });
}
