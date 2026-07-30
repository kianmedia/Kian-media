// ════════════════════════════════════════════════════════════════════════════
// GET /api/public/case-studies   (PUBLIC — قراءة فقط)
//
// موجود لسبب واحد: الصفحة الرئيسية مكوّن عميل ("use client")، فلا تستطيع
// استدعاء طبقة الخادم مباشرةً. هذا المسار يمنحها قراءةً واحدة مكشوفة الحدود
// كي يظهر قسم دراسات الحالة **فقط** حين تكون الميزة مفعّلة ويوجد محتوى منشور.
//
// ★ ما لا يفعله ★
//  • لا يكتب شيئًا. GET فقط، ولا طريقة أخرى معرَّفة.
//  • لا مفتاح خدمة. المفتاح العامّ وحده، والدوالّ المستدعاة تُطبّق البوّابة.
//  • لا يقبل أيّ مُدخَل حرّ: قطاع/خدمة بشكل slug مقيَّد، وصفحة رقمية محدودة.
//  • لا يعيد شيئًا غير ما أعادته الدالّة العامّة — ولا حقل داخليّ فيها أصلًا.
//
// ★ الفشل يُخفي القسم ★ ترحيلة غير مطبَّقة أو ميزة مطفأة ⇒ enabled:false،
//   والمكوّن يعرض **لا شيء**. لا صفر مضلّل ولا «قريبًا» فوق فراغ.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { publicCaseStudyIndex } from "@/lib/server/publicCaseStudies";
import { rateLimit, clientKey } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const revalidate = 300;

/** كريم لزائر حقيقي، ضيّق على من يريد استعمال المسار مضخّةً. */
const PER_IP = { limit: 120, windowMs: 60 * 60_000 };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const OFF = { enabled: false, total: 0, items: [], sectors: [], services: [] };

export async function GET(req: Request) {
  const verdict = rateLimit(`case-studies:ip:${clientKey(req)}`, PER_IP.limit, PER_IP.windowMs);
  if (!verdict.allowed) {
    // 200 + enabled:false عمدًا: المكوّن يخفي القسم بدل أن يعرض خطأً تقنيًّا
    // لزائر لا يملك ما يفعله به.
    return NextResponse.json(OFF, { status: 200 });
  }

  let url: URL;
  try { url = new URL(req.url); } catch { return NextResponse.json(OFF, { status: 200 }); }

  const sector = url.searchParams.get("sector") ?? "";
  const service = url.searchParams.get("service") ?? "";
  const featured = url.searchParams.get("featured") === "true";
  const pageRaw = Number(url.searchParams.get("page") ?? "1");
  const page = Number.isFinite(pageRaw) ? Math.min(Math.max(Math.trunc(pageRaw), 1), 200) : 1;

  const data = await publicCaseStudyIndex({
    sector: SLUG.test(sector) ? sector : undefined,
    service: SLUG.test(service) ? service : undefined,
    featured,
    page,
  });

  // ⚠️ لا نضع Cache-Control هنا: next.config.js يفرض no-store على /api/(.*)
  //    كي لا يُخزَّن ردّ مرتبط بمستخدم في وسيط مشترك. وضع ترويسة مضادّة هنا
  //    كان سيكون ادّعاءً لا أثر له. التخزين الحقيقيّ في طبقة الخادم:
  //    lib/server/publicCaseStudies.ts يقرأ من القاعدة مرّة كلّ خمس دقائق.
  return NextResponse.json(data, { status: 200 });
}
