// ════════════════════════════════════════════════════════════════════════════
// POST /api/portal/ops/weather — يجلب توقّع Open-Meteo ويسجّله على مهمّة.
//
// Wave 3 · V2-3.1-E  (MASTER_BRIEF_v2.1.md §4 WAVE 3)
//
// ★ لماذا مسار خادميّ وليس نداءً من المتصفّح ★
// لأنّ الكتابة تمرّ عبر `prodops_weather_record` **بتوكن المستخدم نفسه**، فتُفرَض
// `prodops_can_manage()` داخل القاعدة. لو جلب المتصفّح مباشرةً لصار على الواجهة
// أن تقرّر من يحقّ له الكتابة — وهو حارس في المكان الخطأ.
//
// ★ العزل هو الميزة ★
// «فشل الطقس لا يمنع فتح أو تعديل أو حفظ أو طباعة Call Sheet.» هذا المسار
// منفصل تمامًا عن `prodops_call_sheet`: سقوطه لا يمسّ الورقة، وأقصى أثره أن
// يبقى حقل الطقس فارغًا. ولذلك **لا يُستدعى تلقائيًّا عند فتح الورقة** — بل
// بفعل صريح من مستخدم يملك الصلاحية.
//
// ⛔ لا مفتاح ولا سرّ: نقطة Open-Meteo غير موثَّقة. ولا Service Key هنا إطلاقًا —
//    الكتابة بصلاحية المستخدم، فلا تجاوز للحُرّاس.
// ⛔ ولا يُشغَّل إلّا والعلم مرفوع: SQL هذه الموجة لم يُطبَّق بعد.
// ════════════════════════════════════════════════════════════════════════════
import { NextResponse } from "next/server";
import { fetchForecast, withinHorizon, HORIZON_HOURS } from "@/lib/production/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** العلم نفسه الذي يحكم واجهة الطقس. مطفأ ⇒ المسار غير موجود عمليًّا. */
const enabled = () =>
  process.env.NEXT_PUBLIC_SHOW_OPS_SUN_WEATHER === "true";

const bad = (error: string, status: number) =>
  NextResponse.json({ ok: false, error }, { status });

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function POST(req: Request) {
  // 🔴 خلف علم مطفأ يُرجع 404 لا 403: مسار معطَّل لا يجب أن يُقرّ بوجوده.
  if (!enabled()) return bad("not_found", 404);
  if (!SUPABASE_URL || !ANON_KEY) return bad("server_not_configured", 500);

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return bad("unauthorized", 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return bad("bad_request", 400);
  }

  const jobId = typeof body.job_id === "string" ? body.job_id.trim() : "";
  const date = typeof body.date === "string" ? body.date.trim() : "";
  const lat = Number(body.lat);
  const lng = Number(body.lng);

  if (!jobId || !ISO_DAY.test(date)) return bad("bad_request", 400);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    // إحداثيات ناقصة سببها موقع بلا lat/lng — رسالة تقول ما يُصلَح.
    return NextResponse.json({ ok: false, error: "no_coordinates" }, { status: 422 });
  }
  // الأفق يُفحص هنا **وفي القاعدة**. حدٌّ في مكان واحد يلتفّ عليه أوّل مستدعٍ جديد.
  if (!withinHorizon(date)) {
    return NextResponse.json(
      { ok: false, error: "beyond_forecast_horizon", horizon_hours: HORIZON_HOURS },
      { status: 422 },
    );
  }

  // ─── الجلب. مهلة صريحة: مزوّد بطيء لا يُعلّق طلب المستخدم. ───────────────
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  let f;
  try {
    f = await fetchForecast({ lat, lng, date }, ac.signal);
  } finally {
    clearTimeout(timer);
  }
  // ⛔ لا يُختلق توقّع عند الفشل. الحقل يبقى فارغًا — وهو صادق.
  if (!f) return NextResponse.json({ ok: false, error: "forecast_unavailable" }, { status: 502 });

  // ─── التسجيل بصلاحية المستخدم — القاعدة هي من تفرض prodops_can_manage. ──
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/prodops_weather_record`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_job_id: jobId, p_for_date: date,
      p_condition: f.conditionAr, p_temp_c: f.tempMaxC,
      p_wind_kph: f.windMaxKph, p_gust_kph: f.windGustKph,
      p_precip_pct: f.precipProbMaxPct, p_lat: lat, p_lng: lng,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // 42501 = رفض صلاحية · 42883/PGRST202 = الدالّة غير مطبَّقة بعد.
    if (res.status === 403 || /42501|not authorized/i.test(text)) return bad("denied", 403);
    if (/PGRST202|42883|does not exist/i.test(text)) return bad("needs_migration", 409);
    // ⛔ لا يُعاد نصّ القاعدة للعميل: قد يكشف أسماء وبنية.
    return bad("record_failed", 502);
  }

  return NextResponse.json({
    ok: true,
    forecast: {
      condition: f.conditionAr, temp_c: f.tempMaxC,
      wind_kph: f.windMaxKph, wind_gust_kph: f.windGustKph,
      precip_pct: f.precipProbMaxPct,
    },
  });
}
