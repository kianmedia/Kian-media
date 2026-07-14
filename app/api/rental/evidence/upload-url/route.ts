// ════════════════════════════════════════════════════════════════════════════
// POST /api/rental/evidence/upload-url   (SERVER-ONLY)
// يمنح Signed Upload URL قصيرة المدة لرفع دليل تأجير — لا يعتمد على سياسة Storage
// للمستأجر (يوقّع الخادم بمفتاح الخدمة). يبني المسار بنفسه (لا يقبل path من المتصفح)،
// ويتحقق من الجلسة والملكية/الدور وحالة الطلب والبند. بعد الرفع: /finalize.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, selectAsService, createSignedUploadUrl, adminConfigured } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "rental-evidence";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const STAGES = new Set(["request", "handover", "return_request", "return_inspection"]);
const STAGE_FOLDER: Record<string, string> = { request: "request", handover: "handover", return_request: "return", return_inspection: "return" };

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const rentalId = str(b.rental_id);
  const itemId = str(b.rental_item_id);
  const stage = str(b.stage);
  const evType = str(b.evidence_type);
  const mime = str(b.mime_type);
  const size = typeof b.file_size === "number" ? b.file_size : Number(b.file_size) || 0;
  if (!rentalId || !STAGES.has(stage)) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  if (!["item_photo", "overall_photo", "signature"].includes(evType)) return NextResponse.json({ ok: false, error: "invalid_evidence_type" }, { status: 400 });
  if (evType === "item_photo" && !itemId) return NextResponse.json({ ok: false, error: "item_required" }, { status: 400 });
  if (evType !== "item_photo" && itemId) return NextResponse.json({ ok: false, error: "overall_no_item" }, { status: 400 });
  if (!mime.startsWith("image/")) return NextResponse.json({ ok: false, error: "bad_mime" }, { status: 400 });
  if (size > 21_000_000) return NextResponse.json({ ok: false, error: "too_large" }, { status: 400 });

  const caller = await authGetUserId(bearer);
  if (!caller) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // الطلب + العميل.
  const rq = await selectAsService<{ id: string; status: string; customer_id: string | null }[]>(
    `custody_rental_requests?id=eq.${encodeURIComponent(rentalId)}&select=id,status,customer_id&limit=1`);
  if (!rq.ok || !rq.data[0]) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const r = rq.data[0];
  let ownerUid = "";
  if (r.customer_id) {
    const c = await selectAsService<{ user_id: string | null }[]>(`custody_rental_customers?id=eq.${encodeURIComponent(r.customer_id)}&select=user_id&limit=1`);
    if (c.ok && c.data[0]) ownerUid = str(c.data[0].user_id);
  }
  const prof = await selectAsService<{ account_type: string | null; staff_role: string | null }[]>(
    `profiles?id=eq.${encodeURIComponent(caller)}&select=account_type,staff_role&limit=1`);
  const p = prof.ok ? prof.data[0] : undefined;
  const isStaff = !!p && (p.account_type === "admin" || ["super_admin", "manager", "custody_officer"].includes(p.staff_role ?? ""));
  const isOwner = ownerUid !== "" && ownerUid === caller;
  if (!isStaff && !isOwner) return NextResponse.json({ ok: false, error: "not_authorized" }, { status: 403 });

  // صلاحية الدور + حالة الطلب حسب المرحلة.
  const s = r.status;
  const okStage =
    stage === "request" ? (isOwner ? s === "draft" : isStaff)
    : stage === "return_request" ? (isOwner ? ["active", "overdue", "return_requested"].includes(s) : isStaff)
    : stage === "handover" ? (isStaff && ["scheduled", "preparing", "ready_for_handover"].includes(s))
    : /* return_inspection */ (isStaff && s === "inspection_pending");
  if (!okStage) return NextResponse.json({ ok: false, error: "not_editable" }, { status: 409 });

  // البند ينتمي للطلب.
  if (evType === "item_photo") {
    const it = await selectAsService<{ id: string }[]>(`custody_rental_items?id=eq.${encodeURIComponent(itemId)}&request_id=eq.${encodeURIComponent(rentalId)}&select=id&limit=1`);
    if (!it.ok || !it.data[0]) return NextResponse.json({ ok: false, error: "item_not_in_request" }, { status: 400 });
  }

  // الخادم يبني المسار (لا يقبله من المتصفح).
  const folder = STAGE_FOLDER[stage];
  const uuid = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const path = evType === "item_photo" ? `rental/${rentalId}/${folder}/items/${itemId}/${uuid}.jpg`
    : evType === "signature" ? `rental/${rentalId}/${folder}/signature/${uuid}.png`
    : `rental/${rentalId}/${folder}/overall/${uuid}.jpg`;

  const signed = await createSignedUploadUrl(BUCKET, path);
  if (!signed.ok) return NextResponse.json({ ok: false, error: "sign_failed" }, { status: 502 });
  return NextResponse.json({ ok: true, bucket: BUCKET, path, signed_url: signed.data.signed_url, token: signed.data.token, stage, evidence_type: evType, expires_in: 120 });
}
