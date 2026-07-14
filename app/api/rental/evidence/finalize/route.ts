// ════════════════════════════════════════════════════════════════════════════
// POST /api/rental/evidence/finalize   (SERVER-ONLY)
// بعد رفع الملف إلى Signed URL: يتحقق (عبر RPC كمستخدم) من الملكية/المسار/وجود الكائن/
// عدم التكرار ثم ينشئ سطر custody_rental_evidence. إن فشل يحذف الملف اليتيم بمفتاح الخدمة.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { authGetUserId, rpcAsUser, deleteStorageObjectAsService, adminConfigured } from "@/lib/server/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "rental-evidence";
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const STAGES = new Set(["request", "handover", "return_request", "return_inspection"]);

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!bearer) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!adminConfigured()) return NextResponse.json({ ok: false, error: "server_not_configured" }, { status: 500 });

  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 }); }
  const rentalId = str(b.rental_id);
  const itemId = str(b.rental_item_id) || null;
  const stage = str(b.stage);
  const evType = str(b.evidence_type);
  const path = str(b.storage_path);
  const mime = str(b.mime_type) || null;
  const size = typeof b.file_size === "number" ? b.file_size : (Number(b.file_size) || null);
  const condition = str(b.condition) || null;
  if (!rentalId || !path || !STAGES.has(stage)) return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });

  const caller = await authGetUserId(bearer);
  if (!caller) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

  // إنشاء السطر عبر RPC كمستخدم (auth.uid) — تفرض الملكية والتحققات داخليًا.
  const r = await rpcAsUser<{ ok: boolean; duplicate?: boolean }>("custody_rental_finalize_evidence", {
    p_rental_id: rentalId, p_rental_item_id: itemId, p_stage: stage, p_evidence_type: evType,
    p_storage_path: path, p_mime_type: mime, p_file_size: size, p_condition: condition,
  }, bearer);

  if (!r.ok) {
    // نظّف الملف اليتيم (best-effort) ثم أعد الخطأ.
    void deleteStorageObjectAsService(BUCKET, path);
    return NextResponse.json({ ok: false, error: r.error, status: r.status }, { status: r.status >= 400 ? r.status : 400 });
  }
  return NextResponse.json({ ok: true, duplicate: !!r.data?.duplicate });
}
