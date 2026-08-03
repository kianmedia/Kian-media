// ════════════════════════════════════════════════════════════════════════════
// POST /api/portal/ops/media-url — رابط موقَّع قصير العمر لوسيط تشغيل.
//
// Wave 3 · V2-3.4-B / V2-3.2-A
//
// ★ لماذا يوجد هذا المسار أصلًا ★
// `ops_media` تخزّن `bucket` و`path` — **لا رابطًا**. لأنّ رابطًا دائمًا مخزَّنًا
// في صفّ هو تسريب مؤجَّل: يخرج في أيّ تصدير أو لقطة شاشة أو سجلّ، ويبقى صالحًا
// بعد سحب صلاحية صاحبه. فالرابط يُصنع عند الطلب وينتهي بعد خمس دقائق.
//
// ★ الترتيب مقصود: الصلاحية تُفحص في القاعدة قبل استعمال مفتاح الخدمة ★
// أوّلًا `prodops_media_list` **بتوكن المستخدم** — فتُطبَّق RLS و`prodops_can_view`.
// ولا يُلمس مفتاح الخدمة إلّا بعد أن تُثبت القاعدة أنّ هذا الوسيط مرئيّ له.
// عكس الترتيب كان سيجعل المفتاح يوقّع أيّ مسار يُرسَل — وهو ثقب مباشر.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
/** خمس دقائق. رابط أطول يعيش في سجلّ المتصفّح بعد أن يفقد صاحبه صلاحيته. */
const SIGN_TTL = 300;

const enabled = () => process.env.NEXT_PUBLIC_SHOW_OPS_PERMITS_REGISTRY === "true";
const bad = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status });

export async function POST(req: Request) {
  if (!enabled()) return bad("not_found", 404);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return bad("server_not_configured", 500);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return bad("unauthorized", 401);

  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return bad("bad_request", 400); }

  const mediaId = typeof body.media_id === "string" ? body.media_id.trim() : "";
  const ownerKind = body.owner_kind === "location" || body.owner_kind === "permit" ? body.owner_kind : "";
  const ownerId = typeof body.owner_id === "string" ? body.owner_id.trim() : "";
  if (!mediaId || !ownerKind || !ownerId) return bad("bad_request", 400);

  // ─── ١) هل يراه هذا المستخدم؟ تُجيب القاعدة، لا هذا الملفّ. ──────────────
  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/prodops_media_list`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_owner_kind: ownerKind, p_owner_id: ownerId }),
    cache: "no-store",
  });
  if (!listRes.ok) {
    const t = await listRes.text().catch(() => "");
    if (/PGRST202|42883|does not exist/i.test(t)) return bad("needs_migration", 409);
    return bad("denied", 403);
  }
  const payload = (await listRes.json().catch(() => null)) as { rows?: Array<{ id: string; bucket: string; path: string }> } | null;
  // 🔴 المسار يُؤخذ من ردّ القاعدة، لا من الطلب. مسار قادم من العميل يعني
  //    توقيع أيّ ملفّ في الدلو.
  const row = (payload?.rows ?? []).find((r) => r.id === mediaId);
  if (!row) return bad("not_found", 404);

  // ─── ٢) الآن فقط يُستعمل مفتاح الخدمة، ولمسار أثبتته القاعدة. ───────────
  const signRes = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${row.bucket}/${encodeURI(row.path)}`,
    {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: SIGN_TTL }),
      cache: "no-store",
    },
  );
  if (!signRes.ok) return bad("sign_failed", 502);
  const signed = (await signRes.json().catch(() => null)) as { signedURL?: string } | null;
  if (!signed?.signedURL) return bad("sign_failed", 502);

  return NextResponse.json(
    { ok: true, url: `${SUPABASE_URL}/storage/v1${signed.signedURL}`, expires_in: SIGN_TTL },
    { headers: { "cache-control": "no-store", "referrer-policy": "no-referrer" } },
  );
}
