// ════════════════════════════════════════════════════════════════════════════
// /api/integrations/rental/notify   (SERVER-ONLY)
//
// يُطلَق من المتصفح بعد إجراء تأجير ناجح. يعيد استخدام قناة البريد نفسها
// (PORTAL_NOTIFY_ENDPOINT / Apps Script) — لا خدمة بريد ثانية. صفوف البوابة تكتبها
// دوال SQL (civ_notify/civ_notify_managers). هنا نُرسل البريد فقط، بمستلمين حسب الحدث،
// مع رابط مباشر للطلب. لا نرسل مستند هوية أو ملاحظات داخلية.
//
// GET  → تشخيص بيئة آمن (بلا أسرار).
// POST → { event, request_id }. يتحقق أن المرسل موظف مخوّل أو صاحب الطلب عبر service-role،
//        ثم يحلّ المستلمين ويرسل. الفشل لا يكسر الإجراء لكنه يُسجَّل دائمًا.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, selectAsService, authAdminEmails, adminConfigured } from "@/lib/server/supabaseAdmin";
import { emailEndpoint, emailEndpointHost, custodyEmailEnabled, runtimeEnv } from "@/lib/server/custodyNotify";
import { interpretRelayResponse } from "@/lib/server/projectNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));

// الأحداث المسموح إطلاقها + عنوان بريد لكل حدث.
const SUBJECTS: Record<string, string> = {
  rental_request_created: "تم استلام طلب التأجير — كيان",
  rental_pending_approval: "طلب تأجير بانتظار الاعتماد — كيان",
  rental_approved: "اعتماد طلب تأجير — كيان",
  rental_rejected: "اعتذار عن طلب تأجير — كيان",
  rental_revision_requested: "مطلوب تعديل على طلب تأجير — كيان",
  rental_handover_scheduled: "موعد تسليم معدات — كيان",
  rental_activated: "تفعيل تأجير المعدات — كيان",
  rental_due_soon: "قرب موعد إرجاع معدات — كيان",
  rental_overdue: "تأخّر إرجاع معدات — كيان",
  rental_return_requested: "طلب إرجاع معدات — كيان",
  rental_return_inspection_required: "فحص إرجاع معدات — كيان",
  rental_damage_reported: "بلاغ تلف/نقص في تأجير — كيان",
  rental_charges_pending: "رسوم/مطالبات تأجير — كيان",
  rental_deposit_release_pending: "تسوية تأمين تأجير — كيان",
  rental_closed: "إقفال تأجير المعدات — كيان",
};
// أحداث تشمل المستأجر ضمن المستلمين.
const RENTER_EVENTS = new Set([
  "rental_request_created", "rental_approved", "rental_rejected", "rental_revision_requested",
  "rental_handover_scheduled", "rental_activated", "rental_due_soon", "rental_overdue",
  "rental_return_inspection_required", "rental_charges_pending", "rental_closed",
  // Batch 9D: a staff-initiated return request must tell the renter to bring the
  // equipment back — the renter was previously excluded from this event.
  "rental_return_requested",
]);
// أحداث تشمل المالية.
const FINANCE_EVENTS = new Set(["rental_charges_pending", "rental_deposit_release_pending"]);

function publicBase(): string {
  return (process.env.PORTAL_PUBLIC_URL || "https://www.kianmedia.com").replace(/\/+$/, "");
}

export async function GET() {
  return NextResponse.json({
    ok: true, runtime_env: runtimeEnv(), email_enabled: custodyEmailEnabled(),
    has_endpoint: emailEndpoint().startsWith("https://"), endpoint_host: emailEndpointHost(),
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
  const requestId = str(b.request_id);
  if (!SUBJECTS[event] || !requestId) return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });

  const caller = await authGetUserId(bearer);
  if (!caller) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // السجل + العميل عبر service-role (المستأجر لا يرى custody_rental_requests بالـRLS).
  const reqRes = await selectAsService<{ id: string; request_number: string; status: string; customer_id: string | null }[]>(
    `custody_rental_requests?id=eq.${encodeURIComponent(requestId)}&select=id,request_number,status,customer_id&limit=1`);
  if (!reqRes.ok || !reqRes.data[0]) {
    log("rental_email_skipped", { reason: "record_not_found", event, request_id: requestId });
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const rr = reqRes.data[0];
  let renterUserId = ""; let renterEmail = ""; let partyName = "";
  if (rr.customer_id) {
    const cRes = await selectAsService<{ user_id: string | null; email: string | null; full_name: string | null; company_name: string | null }[]>(
      `custody_rental_customers?id=eq.${encodeURIComponent(rr.customer_id)}&select=user_id,email,full_name,company_name&limit=1`);
    if (cRes.ok && cRes.data[0]) { renterUserId = str(cRes.data[0].user_id); renterEmail = str(cRes.data[0].email); partyName = str(cRes.data[0].company_name) || str(cRes.data[0].full_name); }
  }

  // موظفو كيان (owner/super_admin/admin/manager/custody_officer/finance).
  const staff = await selectAsService<{ id: string; email: string | null; account_type: string | null; staff_role: string | null }[]>(
    `profiles?select=id,email,account_type,staff_role&account_status=eq.active&or=(account_type.eq.admin,staff_role.in.(super_admin,manager,custody_officer,finance))`);
  const staffRows = staff.ok ? staff.data : [];

  // تحقق الهوية: موظف مخوّل أو صاحب الطلب.
  const isStaff = staffRows.some((p) => p.id === caller);
  const isOwner = renterUserId !== "" && renterUserId === caller;
  if (!isStaff && !isOwner) {
    log("rental_email_skipped", { reason: "not_authorized", event, request_id: requestId });
    return NextResponse.json({ ok: false, error: "not_visible" }, { status: 403 });
  }

  log("rental_notify_event_created", {
    event_type: event, request_no: rr.request_number, email_enabled: custodyEmailEnabled(),
    has_endpoint: emailEndpoint().startsWith("https://"), service_key_present: adminConfigured(), runtime_env: runtimeEnv(),
  });

  // ── حل المستلمين ──
  const recipients = new Set<string>();
  const financeIds: string[] = [];
  const staffIds: string[] = [];
  for (const p of staffRows) {
    const isFinance = p.staff_role === "finance";
    if (isFinance) financeIds.push(p.id); else staffIds.push(p.id);
    // موظفو الإدارة يستلمون كل الأحداث؛ المالية فقط أحداث المالية.
    if (!isFinance || FINANCE_EVENTS.has(event)) {
      if (p.email && p.email.includes("@")) recipients.add(p.email);
    }
  }
  // بريد الموظفين الذين لا بريد لهم في profiles (من auth.users).
  const needIds = staffRows.filter((p) => !p.email && (p.staff_role !== "finance" || FINANCE_EVENTS.has(event))).map((p) => p.id);
  if (needIds.length) { const em = await authAdminEmails(needIds); for (const e of Object.values(em)) recipients.add(e); }
  // المستأجر.
  if (RENTER_EVENTS.has(event)) {
    if (renterEmail && renterEmail.includes("@")) recipients.add(renterEmail);
    else if (renterUserId) { const em = await authAdminEmails([renterUserId]); for (const e of Object.values(em)) recipients.add(e); }
  }

  const to = Array.from(recipients);
  const url = emailEndpoint();
  if (!custodyEmailEnabled() || !url.startsWith("https://")) {
    log("rental_email_skipped", { reason: !custodyEmailEnabled() ? "disabled" : "no_endpoint", event, request_no: rr.request_number, recipient_count: to.length });
    return NextResponse.json({ ok: true, sent: false, recipient_count: to.length }); // البوابة كتبت الصفوف؛ البريد فقط مُتخطّى
  }

  log("rental_email_attempt", { event, request_no: rr.request_number, recipient_count: to.length, endpoint_host: emailEndpointHost(), runtime_env: runtimeEnv() });
  try {
    const res = await fetch(url, {
      method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, cache: "no-store", redirect: "follow",
      body: JSON.stringify({
        _type: "portal_notify",
        To: to.join(","),
        Subject: SUBJECTS[event],
        Event: event,
        Record: rr.request_number,
        Kind: "تأجير معدات",
        Party: partyName,
        Message: "حدث تحديث على طلب تأجير المعدات. افتح البوابة للتفاصيل.",
        Link: `${publicBase()}/client-portal/rentals`,
      }),
    });
    if (res.ok || res.status === 302) {
      // Batch 11 — a bare HTTP 2xx is not delivery: the relay answers 200 even when it
      // silently drops a portal_notify payload. Require its tagged acknowledgment.
      let bodyText = "";
      try { bodyText = await res.text(); } catch { bodyText = ""; }
      const conf = interpretRelayResponse(bodyText);
      if (conf.rejected || !conf.handlerPresent) {
        const reason = conf.rejected ? (conf.reason ?? "provider_rejected") : "relay_handler_missing";
        log("rental_email_failed", { event, request_no: rr.request_number, reason });
        return NextResponse.json({ ok: true, sent: false, reason });
      }
      log("rental_email_success", { event, request_no: rr.request_number, http_status: res.status, recipient_count: to.length, delivered: conf.sentCount ?? to.length });
      return NextResponse.json({ ok: true, sent: true, recipient_count: to.length });
    }
    log("rental_email_failed", { event, request_no: rr.request_number, http_status: res.status });
    return NextResponse.json({ ok: true, sent: false, http_status: res.status });
  } catch (e) {
    log("rental_email_failed", { event, request_no: rr.request_number, error: String(e).slice(0, 200) });
    return NextResponse.json({ ok: true, sent: false, error: "network" });
  }
}
