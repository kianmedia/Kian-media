// ════════════════════════════════════════════════════════════════════════
// Kian — SERVER-ONLY: توزيع إشعارات إسناد المهمة (بريد) من الخادم بالكامل.
//
// يُستدعى بعد حفظ المهمة/المسندين (مسار /api/integrations/hr/tasks/assign) —
// لا يعتمد على المتصفح ولا على emitHrEvent الهش. يعيد قراءة المستلمين من القاعدة
// عبر RPC، يحلّ بريد الموظف من auth.users أولًا (Auth Admin API)، يزيل التكرار
// (أولوية موظف>مشرف>إدارة، غير حسّاس لحالة الأحرف)، ويرسل ثلاث رسائل مفصولة.
// فشل البريد لا يفشل المهمة. لا يُسجَّل بريد كامل ولا مفاتيح.
// ════════════════════════════════════════════════════════════════════════
import { rpcAsUser, selectAsService, authAdminEmails, adminConfigured } from "@/lib/server/supabaseAdmin";
import { sendHrEmail, hrEmailEndpoint } from "@/lib/server/hrNotify";

if (typeof window !== "undefined") {
  throw new Error("lib/server/hrTaskDispatch must never be imported in the browser");
}
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

type Rec = { user_id?: string; email?: string | null; full_name?: string | null };
const publicBase = () => (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");

export interface DispatchResult {
  employees_resolved: number; employees_sent: boolean;
  supervisors_sent: boolean; admins_sent: boolean;
  employee_email_count: number; supervisor_email_count: number; admin_email_count: number;
  // أحجام الجماهير (لعدّادات إشعارات البوابة — تُنشأ في القاعدة عبر RPCs).
  assigned_count: number; admin_count: number; supervisor_count: number;
  employee_email_source: "auth" | "profile" | "auth+profile" | "none";
  skipped: string[];
}

/** يرسل بريد إشعار الإسناد لثلاث جماهير من الخادم. taskId + bearer (لأدمن) + محتوى. */
export async function dispatchTaskAssignmentEmail(input: {
  taskId: string; bearer: string; title: string; details: string;
}): Promise<DispatchResult> {
  const { taskId, bearer, title, details } = input;
  log("HR_TASK_ASSIGNMENT_RECIPIENTS_RESOLVE_START", { task_id: taskId, service_key_present: adminConfigured() });

  // 1) المستلمون من القاعدة (RPC بجلسة الأدمن) — إعادة قراءة فعلية لصفوف الإسناد.
  let employees: Rec[] = [], admins: Rec[] = [], supervisors: Rec[] = [];
  const rec = await rpcAsUser<{ employees: Rec[]; admins: Rec[]; supervisors: Rec[] }>(
    "hr_task_assignment_recipients", { p_task: taskId }, bearer);
  if (rec.ok) {   // rec.data is a required object in the ok branch; `&& rec.data` was redundant and blocked narrowing of rec.error in else
    employees = rec.data.employees || []; admins = rec.data.admins || []; supervisors = rec.data.supervisors || [];
  } else if (adminConfigured()) {
    // fallback: أعِد قراءة المسندين مباشرة (service role) + الإدارة بالأدوار.
    log("HR_TASK_ASSIGNMENT_RECIPIENTS_FALLBACK", { task_id: taskId, reason: rec.error });
    const asg = await selectAsService<{ user_id: string }[]>(
      `hr_field_task_assignees?task_id=eq.${encodeURIComponent(taskId)}&select=user_id`);
    if (asg.ok) employees = Array.from(new Set(asg.data.map((a) => a.user_id))).map((id) => ({ user_id: id }));
    const st = await selectAsService<Rec[]>(
      `profiles?select=id,email,full_name&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,hr))`);
    if (st.ok) admins = st.data.map((x) => ({ user_id: (x as { id?: string }).id, email: x.email, full_name: x.full_name }));
  }

  // 2) حلّ البريد. للموظف: auth.users أولًا ثم profiles.email (المتطلّب الصريح —
  //    بريد الموظف الميداني الموثوق في auth.users، و profiles.email قد يكون قديمًا
  //    لأن handle_new_user ينسخه عند التسجيل فقط ولا يُزامنه بعد تغيير البريد).
  //    للمشرف/الإدارة (موظفو مكتب ببريد profiles موثوق): profiles.email أولًا ثم auth.
  const valid = (e?: string | null): e is string => !!e && e.includes("@");
  const uniq = (a: string[]) => Array.from(new Set(a));
  const lc = (e?: string): string | undefined => (valid(e) ? e.toLowerCase() : undefined);
  // نطلب بريد auth لكل موظف (auth-first) + لكل مشرف/إداري تنقصه بريد profiles.
  const empIds = uniq(employees.map((r) => r.user_id).filter((x): x is string => !!x));
  const othersNeedAuth = uniq([...supervisors, ...admins].filter((r) => r.user_id && !valid(r.email)).map((r) => r.user_id as string));
  const needAuth = uniq([...empIds, ...othersNeedAuth]);
  const authMap = needAuth.length ? await authAdminEmails(needAuth) : {};
  // موظف: auth.users → profiles.email.
  const empEmailOf = (r: Rec): string | undefined =>
    lc((r.user_id && authMap[r.user_id]) || (valid(r.email) ? r.email : undefined));
  // مشرف/إداري: profiles.email → auth.users.
  const emailOf = (r: Rec): string | undefined =>
    lc(valid(r.email) ? r.email : (r.user_id ? authMap[r.user_id] : undefined));
  const empEmails = uniq(employees.map(empEmailOf).filter(valid));
  const supEmails = uniq(supervisors.map(emailOf).filter(valid)).filter((e) => !empEmails.includes(e));
  const adminEmails = uniq(admins.map(emailOf).filter(valid)).filter((e) => !empEmails.includes(e) && !supEmails.includes(e));

  // مصدر بريد الموظف: auth إن حُسم من auth، profile إن حُسم من profiles فقط.
  const empFromAuth = employees.filter((r) => r.user_id && valid(authMap[r.user_id])).length;
  const empFromProfileOnly = employees.filter((r) => !(r.user_id && valid(authMap[r.user_id])) && valid(r.email)).length;
  const employee_email_source: DispatchResult["employee_email_source"] =
    empEmails.length === 0 ? "none" : empFromAuth > 0 ? (empFromProfileOnly > 0 ? "auth+profile" : "auth") : "profile";

  log("HR_TASK_ASSIGNMENT_RECIPIENTS_RESOLVED", {
    task_id: taskId, assigned_user_count: employees.length,
    employee_email_count: empEmails.length, supervisor_email_count: supEmails.length, admin_email_count: adminEmails.length,
    auth_email_count: empFromAuth, profile_email_count: empFromProfileOnly, employee_email_source,
    service_key_present: adminConfigured(), endpoint_present: hrEmailEndpoint().startsWith("https://"),
  });

  const link = `${publicBase()}/client-portal/employee`;
  const skipped: string[] = [];
  const send = async (audience: "employee" | "supervisor" | "admin", recipients: string[], subject: string, header: string) => {
    if (recipients.length === 0) {
      if (audience === "employee") { log("HR_TASK_ASSIGNMENT_EMAIL_SKIPPED", { task_id: taskId, audience, reason: "no_employee_email" }); skipped.push("employee:no_email"); }
      return false;
    }
    log("HR_TASK_ASSIGNMENT_EMAIL_ATTEMPT", { task_id: taskId, audience, recipient_count: recipients.length });
    const r = await sendHrEmail({ event: "hr_task_new", entity_id: taskId, subject, title,
      message: header + "\n" + details + "\n\nالرابط: " + link, recipients });
    log(r.sent ? "HR_TASK_ASSIGNMENT_EMAIL_SUCCESS" : "HR_TASK_ASSIGNMENT_EMAIL_FAILED", { task_id: taskId, audience, recipient_count: recipients.length, reason: r.reason });
    if (!r.sent) skipped.push(`${audience}:${r.reason ?? "failed"}`);
    return r.sent;
  };

  const employees_sent = await send("employee", empEmails, "تم إسناد مهمة جديدة لك — كيان", "تم إسناد مهمة ميدانية جديدة لك:");
  const supervisors_sent = await send("supervisor", supEmails, "تم إسناد مهمة جديدة لأحد أفراد فريقك — كيان", "أُسندت مهمة ميدانية لأحد أفراد فريقك:");
  const admins_sent = await send("admin", adminEmails, "تم إنشاء وإسناد مهمة جديدة — كيان", "أُنشئت مهمة ميدانية وأُسندت:");

  return {
    employees_resolved: empEmails.length, employees_sent, supervisors_sent, admins_sent,
    employee_email_count: empEmails.length, supervisor_email_count: supEmails.length, admin_email_count: adminEmails.length,
    assigned_count: employees.length, admin_count: admins.length, supervisor_count: supervisors.length,
    employee_email_source, skipped,
  };
}
