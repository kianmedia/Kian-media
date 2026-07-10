// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/custody-inventory/notify   (SERVER-ONLY, best-effort email)
//
// إشعارات البوابة تُنشأ في القاعدة (RPCs عبر civ_notify). هذا المسار يرسل البريد فقط
// لأطراف الحدث. يُنتظر من الواجهة بعد نجاح الـ RPC — لكن فشله لا يفشل الحركة (الحركة
// حُفظت في القاعدة أصلًا). بريد الموظف: auth.users أولًا ثم profiles؛ لا يُستخدم بريد
// الإدارة كبديل للموظف؛ إزالة تكرار. لا يُسجَّل بريد/JWT/مفاتيح.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, selectAsUser, selectAsService, authAdminEmails, adminConfigured } from "@/lib/server/supabaseAdmin";
import { sendHrEmail, hrEmailEndpoint, hrRuntimeEnv } from "@/lib/server/hrNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const enc = (v: string) => encodeURIComponent(v);

// الأحداث المسموح إطلاقها + عنوان البريد لكل حدث.
const SUBJECTS: Record<string, string> = {
  civ_self_issue: "تم صرف عهدة ذاتية جديدة — كيان",
  civ_assignment_created: "تم صرف عهدة مسجلة جديدة — كيان",
  civ_confirm_pending: "عهدة بانتظار تأكيد استلامك — كيان",
  civ_employee_confirmed: "تأكيد استلام عهدة — كيان",
  civ_employee_rejected: "اعتراض على عهدة — كيان",
  civ_return_requested: "طلب إرجاع عهدة — كيان",
  civ_return_accepted: "قبول إرجاع عهدة — كيان",
  civ_return_rejected: "رفض إرجاع عهدة — كيان",
  civ_maintenance_opened: "فتح صيانة أصل — كيان",
  civ_maintenance_closed: "إغلاق صيانة أصل — كيان",
  civ_asset_created: "أصل جديد في المخزون — كيان",
  civ_stock_correction: "تصحيح مخزون — كيان",
  civ_audit_started: "بدء جرد — كيان",
  civ_audit_approved: "اعتماد جرد — كيان",
};
const AUDIENCE_MANAGERS = new Set([
  "civ_self_issue", "civ_assignment_created", "civ_employee_confirmed", "civ_employee_rejected", "civ_return_requested",
  "civ_asset_created", "civ_stock_correction", "civ_audit_started", "civ_audit_approved",
  "civ_maintenance_opened", "civ_maintenance_closed",
]);
const AUDIENCE_EMPLOYEE = new Set(["civ_self_issue", "civ_confirm_pending", "civ_return_accepted", "civ_return_rejected", "civ_assignment_created"]);

export async function GET() {
  return NextResponse.json({
    ok: true, runtime_env: hrRuntimeEnv(), has_endpoint: hrEmailEndpoint().startsWith("https://"),
    service_key_present: adminConfigured(),
  });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const event = str(b.event);
  const assignmentId = str(b.assignment_id);
  const title = str(b.title) || event;
  if (!SUBJECTS[event]) return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });

  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  log("CUSTODY_INV_PORTAL_NOTIFICATION_CREATED", { event, has_assignment: !!assignmentId, service_key_present: adminConfigured() });

  // مقاومة التزوير: لو الحدث مرتبط بعهدة، يجب أن يراها المُرسِل (RLS).
  let employeeUserId = "";
  if (assignmentId) {
    const rec = await selectAsUser<{ employee_user_id: string }[]>(
      `custody_inventory_assignments?id=eq.${enc(assignmentId)}&select=employee_user_id&limit=1`, bearer);
    if (!rec.ok || !rec.data[0]) return NextResponse.json({ ok: false, error: "not_visible" }, { status: 403 });
    employeeUserId = rec.data[0].employee_user_id;
  }
  if (!adminConfigured()) return NextResponse.json({ ok: true, email: false, reason: "server_not_configured" }, { status: 200 });

  const valid = (e?: string | null): e is string => !!e && e.includes("@");
  const lc = (e: string) => e.toLowerCase();

  // بريد الموظف: auth.users أولًا ثم profiles.email.
  let employeeEmails: string[] = [];
  if (AUDIENCE_EMPLOYEE.has(event) && employeeUserId) {
    const authMap = await authAdminEmails([employeeUserId]);
    let e = authMap[employeeUserId];
    if (!valid(e)) {
      const pr = await selectAsService<{ email: string | null }[]>(`profiles?id=eq.${enc(employeeUserId)}&select=email&limit=1`);
      if (pr.ok && pr.data[0]) e = pr.data[0].email ?? undefined;
    }
    if (valid(e)) employeeEmails = [lc(e)];
  }

  // بريد الإدارة/أمناء العهدة (لا يُستخدم كبديل للموظف).
  let managerEmails: string[] = [];
  if (AUDIENCE_MANAGERS.has(event)) {
    const st = await selectAsService<{ email: string | null }[]>(
      `profiles?select=email&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,custody_officer))`);
    if (st.ok) managerEmails = Array.from(new Set(st.data.map((x) => x.email).filter(valid).map(lc)));
  }
  // إزالة التكرار: بريد الموظف له الأولوية، فلا يُكرَّر في قائمة الإدارة.
  managerEmails = managerEmails.filter((e) => !employeeEmails.includes(e));

  const link = (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "") + "/client-portal/asset-custody";
  const subject = SUBJECTS[event];
  const msgBody = title + "\n\nافتح النظام: " + link;

  const send = async (audience: string, recipients: string[]) => {
    if (recipients.length === 0) return { audience, sent: false, count: 0, reason: "no_recipients" };
    log("CUSTODY_INV_EMAIL_ATTEMPT", { event, audience, recipient_count: recipients.length });
    const r = await sendHrEmail({ event: "hr_note_new", entity_id: assignmentId || event, subject, title, message: msgBody, recipients });
    log(r.sent ? "CUSTODY_INV_EMAIL_SUCCESS" : "CUSTODY_INV_EMAIL_FAILED", { event, audience, recipient_count: recipients.length, reason: r.reason });
    return { audience, sent: r.sent, count: recipients.length, reason: r.reason };
  };
  const employee = await send("employee", employeeEmails);
  const managers = await send("managers", managerEmails);

  return NextResponse.json({ ok: true, email: { employee, managers } }, { status: 200 });
}
