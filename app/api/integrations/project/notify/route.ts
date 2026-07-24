// ════════════════════════════════════════════════════════════════════════
// POST /api/integrations/project/notify   (SERVER-ONLY, immediate email)
//
// Batch 9D — the project/preview email producer that was MISSING. Portal rows
// are written server-side (client via the legacy deliverable trigger; internal
// staff via the 9D trg_preview_staff_notify trigger). THIS route sends the
// EMAIL immediately (the daily cron never carried preview email, and the old
// browser no-cors POST was a documented no-op).
//
// Recipient resolution is CANONICAL: notification_resolve_recipients(...) —
// management (owner/super_admin/admin) + project manager + the deliverable
// assignee + the actor (as a confirmation) + the authorized client. Emails come
// from auth.users first (fixes the null-profiles.email management gap). Every
// journey is written to notification_delivery_log for the admin trace.
// Failure never blocks the business action. No secrets/tokens logged.
// ════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, selectAsUser, selectAsService, rpcAsService, adminConfigured } from "@/lib/server/supabaseAdmin";
import { sendProjectEmail, projectEmailEnabled } from "@/lib/server/projectNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const log = (tag: string, extra: Record<string, unknown>) => console.log(JSON.stringify({ tag, ...extra }));
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const enc = (v: string) => encodeURIComponent(v);

// Best-effort per-(user,deliverable,event) rate limit — stops double-click / scripted
// floods without blocking distinct legitimate sends (abuse-prevention, not security).
const lastCall = new Map<string, number>();
const RATE_MS = 3000;

// Events this route may fire (must be client-facing project/deliverable events).
const ALLOWED = new Set(["deliverable.preview_sent", "deliverable.final_ready", "project.delivery_recorded"]);

interface ResolvedRow {
  user_id: string; email: string | null; role: string; recipient_reason: string;
  portal_allowed: boolean; email_allowed: boolean; action_url: string | null; locale: string | null;
}

export async function GET() {
  return NextResponse.json({ ok: true, email_enabled: projectEmailEnabled(), service_key_present: adminConfigured() });
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const event = str(b.event);
  const deliverableId = str(b.deliverable_id);
  if (!ALLOWED.has(event)) return NextResponse.json({ ok: false, error: "invalid_event" }, { status: 400 });
  if (!deliverableId) return NextResponse.json({ ok: false, error: "missing_deliverable" }, { status: 400 });

  const uid = await authGetUserId(bearer);
  if (!uid) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // Anti-forgery: the caller must be able to SEE this deliverable (RLS via their bearer).
  const vis = await selectAsUser<{ id: string; project_id: string }[]>(
    `deliverables?id=eq.${enc(deliverableId)}&select=id,project_id&limit=1`, bearer);
  if (!vis.ok || !vis.data[0]) return NextResponse.json({ ok: false, error: "not_visible" }, { status: 403 });
  const projectId = vis.data[0].project_id;
  if (!adminConfigured()) return NextResponse.json({ ok: true, email: false, reason: "server_not_configured" }, { status: 200 });

  // AUTHORIZATION: sending a preview is a STAFF action. A client can SEE their own
  // deliverable (read RLS), so visibility alone is NOT enough — gate on is_staff
  // (= is_admin OR staff_role present) so a client can't trigger/flood internal-
  // staff email. Read the profile directly (no dependence on RPC exposure).
  const prof = await selectAsService<{ account_type: string | null; staff_role: string | null; account_status: string | null }[]>(
    `profiles?id=eq.${enc(uid)}&select=account_type,staff_role,account_status&limit=1`);
  const me = prof.ok ? prof.data[0] : null;
  const isStaff = !!me && me.account_status === "active" && (me.account_type === "admin" || (me.staff_role != null && me.staff_role !== ""));
  if (!isStaff) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  // Rate limit (per user+event+deliverable).
  const rlKey = `${uid}:${event}:${deliverableId}`;
  const nowMs = Date.now();
  if (nowMs - (lastCall.get(rlKey) ?? 0) < RATE_MS) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });
  lastCall.set(rlKey, nowMs);

  // Deliverable + project context (service read — assignee_id is optional/defensive).
  let title = ""; let assignee: string | null = null;
  const dl = await selectAsService<{ title: string | null; assignee_id: string | null }[]>(
    `deliverables?id=eq.${enc(deliverableId)}&select=title,assignee_id&limit=1`);
  if (dl.ok && dl.data[0]) { title = dl.data[0].title ?? ""; assignee = dl.data[0].assignee_id ?? null; }
  else {
    const dl2 = await selectAsService<{ title: string | null }[]>(`deliverables?id=eq.${enc(deliverableId)}&select=title&limit=1`);
    if (dl2.ok && dl2.data[0]) title = dl2.data[0].title ?? "";
  }
  let projectName = "";
  const pr = await selectAsService<{ name: string | null }[]>(`projects?id=eq.${enc(projectId)}&select=name&limit=1`);
  if (pr.ok && pr.data[0]) projectName = pr.data[0].name ?? "";

  // Canonical recipient resolution (management + PM + assignee + actor + client).
  const direct: { user_id: string; reason: string }[] = [{ user_id: uid, reason: "actor_confirmation" }];
  if (assignee && assignee !== uid) direct.push({ user_id: assignee, reason: "assignee" });
  const staffUrl = `/client-portal/project-core/${projectId}?tab=deliverables`;
  const clientUrl = `/client-portal/projects/${projectId}`;
  const resolved = await rpcAsService<ResolvedRow[]>("notification_resolve_recipients", {
    p_event: event, p_entity_type: "deliverable", p_entity_id: deliverableId, p_project: projectId,
    p_actor: uid, p_payload: { action_url: staffUrl, client_action_url: clientUrl, direct },
  });
  if (!resolved.ok || !Array.isArray(resolved.data)) {
    log("PROJECT_NOTIFY_RESOLVE_FAILED", { event, error: String((resolved as { error?: string }).error ?? "").slice(0, 200) });
    return NextResponse.json({ ok: false, error: "resolve_failed" }, { status: 200 });
  }

  // Dedupe by user; split staff vs client. Only rows with a valid email get an email.
  const seen = new Set<string>();
  const staff: ResolvedRow[] = []; const client: ResolvedRow[] = [];
  for (const r of resolved.data) {
    if (!r.user_id || seen.has(r.user_id)) continue;
    seen.add(r.user_id);
    (r.recipient_reason === "client" || r.recipient_reason === "renter" ? client : staff).push(r);
  }
  const emailsOf = (rows: ResolvedRow[]) =>
    Array.from(new Set(rows.map((r) => (r.email ?? "").toLowerCase()).filter((e) => e.includes("@"))));
  const staffEmails = emailsOf(staff.filter((r) => r.email_allowed));
  const clientEmails = emailsOf(client.filter((r) => r.email_allowed));

  const proj = projectName || "مشروع";
  const isFinal = event === "deliverable.final_ready" || event === "project.delivery_recorded";
  const staffSubject = isFinal
    ? `تم تسليم الملفات النهائية للعميل — ${proj}`
    : `تم إرسال رابط معاينة للعميل — ${proj}`;
  const staffBody = isFinal
    ? `المشروع: ${proj}\nالمخرَج: ${title || "—"}\nتم تسليم الملفات النهائية للعميل.`
    : `المشروع: ${proj}\nالمخرَج: ${title || "—"}\nتم إرسال المعاينة للعميل للمراجعة.\nافتح المخرجات لمتابعة رد العميل.`;
  const clientSubject = isFinal
    ? `ملفاتك النهائية جاهزة — ${proj}`
    : `معاينة جديدة متاحة لمشروعك — ${proj}`;
  const clientBody = isFinal
    ? `مشروعك: ${proj}\nأصبحت الملفات النهائية «${title || "المخرَج"}» جاهزة.\nافتح صفحة المشروع لتنزيلها.`
    : `مشروعك: ${proj}\nأصبحت معاينة «${title || "المخرَج"}» متاحة للمراجعة.\nافتح صفحة المشروع لمشاهدتها واعتمادها أو طلب تعديل.`;

  const trace: Record<string, unknown>[] = [];
  let staffSent = false; let clientSent = false;

  if (staffEmails.length > 0) {
    const res = await sendProjectEmail({ to: staffEmails, subject: staffSubject, body: staffBody, directUrl: staffUrl, eventType: event });
    staffSent = res.sent;
    for (const r of staff) trace.push({ event_type: event, entity_type: "deliverable", entity_id: deliverableId, project_id: projectId, actor_user_id: uid, recipient_id: r.user_id, recipient_role: r.role, recipient_reason: r.recipient_reason, channel: "email", outcome: res.sent ? "email_sent" : "email_failed", error_class: res.sent ? null : (res.reason ?? "send_failed") });
    log(res.sent ? "PROJECT_NOTIFY_STAFF_SENT" : "PROJECT_NOTIFY_STAFF_FAILED", { event, recipient_count: staffEmails.length, reason: res.reason });
  }
  if (clientEmails.length > 0) {
    const res = await sendProjectEmail({ to: clientEmails, subject: clientSubject, body: clientBody, directUrl: clientUrl, eventType: event });
    clientSent = res.sent;
    for (const r of client) trace.push({ event_type: event, entity_type: "deliverable", entity_id: deliverableId, project_id: projectId, actor_user_id: uid, recipient_id: r.user_id, recipient_role: r.role, recipient_reason: r.recipient_reason, channel: "email", outcome: res.sent ? "email_sent" : "email_failed", error_class: res.sent ? null : (res.reason ?? "send_failed") });
    log(res.sent ? "PROJECT_NOTIFY_CLIENT_SENT" : "PROJECT_NOTIFY_CLIENT_FAILED", { event, recipient_count: clientEmails.length, reason: res.reason });
  }
  // Best-effort delivery trace (never blocks).
  if (trace.length > 0) { try { await rpcAsService("notification_trace", { p_rows: trace }); } catch { /* trace is telemetry */ } }

  return NextResponse.json({
    ok: true,
    resolved: { staff: staff.length, client: client.length },
    email: { staff: { count: staffEmails.length, sent: staffSent }, client: { count: clientEmails.length, sent: clientSent } },
  }, { status: 200 });
}
