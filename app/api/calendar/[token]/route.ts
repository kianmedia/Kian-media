// ════════════════════════════════════════════════════════════════════════════
// GET /api/calendar/<token>.ics — تغذية تقويم أيام التصوير برمز قابل للإلغاء.
//
// Wave 3 · V2-3.6-A/B
//
// ★ الرمز الخامّ لا يصل القاعدة أبدًا ★
// يُهشَّم هنا (sha256) وتُرسَل **البصمة** إلى prodops_calendar_feed. تسريب سجلّ
// قاعدة أو نسخة احتياطية لا يمنح أحدًا رابطًا صالحًا.
//
// ★ لماذا مفتاح anon هنا تحديدًا ★
// عملاء التقويم (Google · Apple · Outlook) يجلبون بلا جلسة ولا كوكيز. فالرمز
// **هو** بيان الاعتماد، والحارس كلّه داخل الدالّة: شكل البصمة، الحالة، الانتهاء،
// سقف الفتحات، والنطاق المقيَّم على **صاحب الرمز** لا على المستدعي المجهول.
// ⛔ ولا Service Key هنا بحال — سيتجاوز ذلك الحارس بالكامل.
//
// ★ الردّ موحَّد عمدًا ★
// رمز غير صالح · ملغى · منتهٍ · مستنفد ⇒ **404 واحد بنفس النصّ**. تمييزها يمنح
// من يجرّب الرموز مقياسًا يعرف به أنّه اقترب.
// ════════════════════════════════════════════════════════════════════════════
import { createHash } from "node:crypto";
import { buildIcs, type IcsEvent } from "@/lib/production/ics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** الافتراض **مطفأ**: SQL هذه الميزة لم يُطبَّق بعد. */
const enabled = () => process.env.NEXT_PUBLIC_ENABLE_OPS_CALENDAR_FEED === "true";

/** ردّ واحد لكلّ حالات الرفض — لا يفرّق بين «غير موجود» و«ملغى». */
const gone = () =>
  new Response("رابط التقويم غير صالح أو أُلغي.", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  if (!enabled()) return gone();
  if (!SUPABASE_URL || !ANON_KEY) return gone();

  const { token: rawParam } = await ctx.params;
  // يُقبل ‎<token>‎ و‎<token>.ics‎ — عملاء التقويم يفضّلون الامتداد.
  const raw = (rawParam ?? "").replace(/\.ics$/i, "").trim();
  // الشكل يُفحص قبل أيّ عمل: ٦٤ محرفًا ست عشريًّا، لا غير.
  if (!/^[0-9a-f]{64}$/.test(raw)) return gone();

  const hash = createHash("sha256").update(raw).digest("hex");

  let payload: { ok?: boolean; reason?: string; events?: IcsEvent[] };
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/prodops_calendar_feed`, {
      method: "POST",
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token_hash: hash }),
      cache: "no-store",
    });
    if (!res.ok) return gone();
    payload = (await res.json()) as typeof payload;
  } catch {
    return gone();
  }

  if (!payload?.ok) return gone();

  const ics = buildIcs(payload.events ?? []);
  return new Response(ics, {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="kian-shoot-days.ics"',
      // ⛔ لا تخزين وسيط: الرمز قد يُلغى في أيّ لحظة، ونسخة مُخبَّأة تُبقيه حيًّا.
      "cache-control": "no-store, no-cache, must-revalidate, private",
      // ⛔ ولا يُفهرَس رابط يحمل بيان اعتماد.
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
    },
  });
}
