"use client";
// ════════════════════════════════════════════════════════════════════════════
// OpsSunWeather — الضوء والطقس والتحذير الإرشادي على ورقة النداء.
//
// Wave 3 · V2-3.1-D/E/F/H
//
// ★★ هذا المكوّن لا يملك أن يكسر ورقة نداء ★★
// «فشل الطقس لا يمنع فتح أو تعديل أو حفظ أو طباعة Call Sheet.»
//
// ولذلك:
//  • لا يجلب شيئًا عند العرض — يقرأ ما وصل مع الورقة أصلًا. فتح الورقة لا يصدر
//    طلب شبكة واحدًا، ومزوّد ساقط لا يؤخّر ظهورها ولو مِلّي ثانية.
//  • التحديث فعل صريح بزرّ، ونتيجته محصورة في هذا الصندوق.
//  • الساعة الذهبية حساب محلّيّ بحت: تعمل بلا إنترنت، وتُطبع في الموقع.
//  • ثلاثة أقسام مستقلّة: سقوط أحدها لا يُخفي الآخرين.
//
// ⛔ خلف علم مطفأ لا يُعرض شيء إطلاقًا — لا صندوق فارغ ولا عنوان بلا محتوى.
//    (الحارس في المستدعي، فلا يظهر فاصل قبل صندوق لن يأتي.)
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  enrichCallSheet, sunReasonAr, STALE_AFTER_HOURS,
  type CallSheetEnrichment,
} from "@/lib/production/callSheet";
import { btnGhost } from "./OpsAtoms";

/** هل تُعرض كتلة الشمس والطقس أصلًا؟ الافتراض **مطفأ**. */
export const opsSunWeatherEnabled = (): boolean =>
  process.env.NEXT_PUBLIC_SHOW_OPS_SUN_WEATHER === "true";

type Phase =
  | { k: "idle" }
  | { k: "loading" }
  | { k: "offline" }
  | { k: "denied" }
  | { k: "needs_migration" }
  | { k: "unavailable" }          // المزوّد لم يُجب — لا خطأ في النظام
  | { k: "beyond_horizon" }
  | { k: "no_coordinates" }
  | { k: "error"; msg: string }
  | { k: "done" };

const PHASE_AR: Record<string, string> = {
  offline: "لا اتصال بالشبكة — الساعة الذهبية أعلاه محسوبة محليًّا وتبقى صحيحة.",
  denied: "لا تملك صلاحية تحديث الطقس في مركز التشغيل.",
  needs_migration: "تحديث الطقس يحتاج ترحيلة قاعدة لم تُطبَّق بعد.",
  unavailable: "مزوّد الطقس لم يستجب. لم يُسجَّل شيء — والحقل يبقى كما هو.",
  beyond_horizon: "التاريخ أبعد من ٤٨ ساعة. لا يُسجَّل توقّع بعيد يُقرأ كأنّه معلومة.",
  no_coordinates: "الموقع بلا إحداثيات — أضف lat/lng في سجلّ المواقع.",
};

const Row = ({ label, value }: { label: string; value: string | null }) =>
  value === null ? null : (
    <div className="flex justify-between gap-3 text-[12.5px] py-[3px]">
      <span className="text-stone-400">{label}</span>
      <span className="text-stone-100 tabular-nums" dir="ltr">{value}</span>
    </div>
  );

export default function OpsSunWeather({
  data, jobId, canManage, onRecorded,
}: {
  data: { sheet?: Record<string, unknown> | null; location?: Record<string, unknown> | null; weather?: Record<string, unknown> | null } | null;
  jobId: string;
  canManage: boolean;
  onRecorded?: () => void;
}) {
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const e: CallSheetEnrichment = enrichCallSheet(data);

  const lat = Number((data?.location as Record<string, unknown> | null)?.lat);
  const lng = Number((data?.location as Record<string, unknown> | null)?.lng);
  const sheetDate = typeof data?.sheet?.sheet_date === "string" ? data.sheet.sheet_date : null;
  const canRefresh =
    canManage && sheetDate !== null && Number.isFinite(lat) && Number.isFinite(lng);

  async function refresh() {
    // الحالة دون اتصال تُقال قبل المحاولة، لا بعد مهلة طويلة.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setPhase({ k: "offline" });
      return;
    }
    setPhase({ k: "loading" });
    try {
      // نفس مخزن الجلسة الذي يستعمله lib/portal/client.ts — لا مسار مصادقة ثانٍ.
      const { getValidSession } = await import("@/lib/portalAuth");
      const session = await getValidSession();
      const token = session?.access_token;
      if (!token) { setPhase({ k: "denied" }); return; }

      const res = await fetch("/api/portal/ops/weather", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ job_id: jobId, date: sheetDate, lat, lng }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (res.ok && j.ok) { setPhase({ k: "done" }); onRecorded?.(); return; }

      switch (j.error) {
        case "denied":                  setPhase({ k: "denied" }); break;
        case "needs_migration":         setPhase({ k: "needs_migration" }); break;
        case "forecast_unavailable":    setPhase({ k: "unavailable" }); break;
        case "beyond_forecast_horizon": setPhase({ k: "beyond_horizon" }); break;
        case "no_coordinates":          setPhase({ k: "no_coordinates" }); break;
        case "not_found":               setPhase({ k: "needs_migration" }); break;
        default:                        setPhase({ k: "error", msg: "تعذّر تحديث الطقس." });
      }
    } catch {
      // شبكة سقطت أثناء الطلب — لا تُعرض كخطأ نظام.
      setPhase({ k: "offline" });
    }
  }

  const notice = phase.k in PHASE_AR ? PHASE_AR[phase.k] : null;

  return (
    <div className="space-y-3">
      {/* ─── الضوء · محسوب محليًّا، بلا شبكة، ويُطبع ─── */}
      <section>
        <h2 className="text-[13px] font-semibold text-stone-200 mb-1">الضوء</h2>
        {e.sun.available ? (
          <>
            <Row label="الشروق" value={e.sun.sunrise} />
            <Row label="الذهبية — صباحًا" value={e.sun.goldenMorning} />
            <Row label="الذهبية — مساءً" value={e.sun.goldenEvening} />
            <Row label="الزرقاء — مساءً" value={e.sun.blueEvening} />
            <Row label="الغروب" value={e.sun.sunset} />
            <p className="text-[10.5px] text-stone-500 mt-1 leading-relaxed">
              نافذة ارتفاع شمسيّ محسوبة للموقع والتاريخ — ليست ٦٠ دقيقة ثابتة.
            </p>
          </>
        ) : (
          <p className="text-[11.5px] text-stone-500">
            {e.sun.reason ? sunReasonAr(e.sun.reason) : "غير متاح."}
          </p>
        )}
      </section>

      {/* ─── الطقس · قسم مستقلّ: سقوطه لا يمسّ ما فوقه ─── */}
      <section className="border-t border-stone-800 pt-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-stone-200">الطقس</h2>
          {canRefresh && (
            <button
              className={`${btnGhost} ops-noprint text-[11px] px-2 py-1`}
              onClick={refresh}
              disabled={phase.k === "loading"}
            >
              {phase.k === "loading" ? "جارٍ التحديث…" : "تحديث"}
            </button>
          )}
        </div>

        {e.weather.available ? (
          <>
            <Row label="الحالة" value={e.weather.condition} />
            <Row label="الحرارة" value={e.weather.tempC === null ? null : `${e.weather.tempC}°`} />
            <Row label="الرياح" value={e.weather.windKph === null ? null : `${e.weather.windKph} كم/س`} />
            <Row label="الهبّات" value={e.weather.gustKph === null ? null : `${e.weather.gustKph} كم/س`} />
            <Row label="احتمال المطر" value={e.weather.precipPct === null ? null : `${e.weather.precipPct}%`} />
            <p className="text-[10.5px] text-stone-500 mt-1">
              المصدر: {e.weather.source === "open_meteo" ? "Open-Meteo" : e.weather.source === "manual" ? "إدخال يدويّ" : "غير محدّد"}
              {e.weather.stale && (
                <span className="text-amber-500">
                  {" "}· توقّع أقدم من {STALE_AFTER_HOURS} ساعة — حدّثه قبل الاعتماد عليه.
                </span>
              )}
            </p>
          </>
        ) : (
          <p className="text-[11.5px] text-stone-500">
            لا توقّع مسجَّل لهذا اليوم. {canRefresh ? "" : "التحديث يحتاج موقعًا بإحداثيات وصلاحية تشغيل."}
          </p>
        )}

        {notice && <p className="text-[11.5px] text-amber-500 mt-1 leading-relaxed">{notice}</p>}
        {phase.k === "error" && (
          <p className="text-[11.5px] text-red-400 mt-1">
            {phase.msg}{" "}
            <button className="underline ops-noprint" onClick={refresh}>إعادة المحاولة</button>
          </p>
        )}
        {phase.k === "done" && (
          <p className="text-[11.5px] text-emerald-500 mt-1">سُجّل التوقّع. أعِد تحميل الورقة لعرضه.</p>
        )}
      </section>

      {/* ─── 🔴 التحذير الإرشادي · ليس تصريح طيران ─── */}
      {e.drone && (
        <section
          className="border-t border-stone-800 pt-2"
          role={e.drone.level === "severe" || e.drone.level === "warning" ? "alert" : undefined}
        >
          <h2 className="text-[13px] font-semibold text-stone-200 mb-1">تصوير جوّي</h2>
          <p
            className={`text-[12.5px] leading-relaxed ${
              e.drone.level === "severe" ? "text-red-400"
              : e.drone.level === "warning" ? "text-amber-400"
              : e.drone.level === "caution" ? "text-amber-300" : "text-stone-300"
            }`}
          >
            {e.drone.messageAr}
          </p>
          <p className="text-[10.5px] text-stone-500 mt-1 leading-relaxed">{e.drone.disclaimerAr}</p>
        </section>
      )}

      {/* ─── التاريخ البديل · إعلان نيّة لا حجز ─── */}
      {e.backup && (
        <section className="border-t border-stone-800 pt-2">
          <Row label={e.backup.labelAr} value={e.backup.date} />
          <p className="text-[10.5px] text-stone-500 leading-relaxed">{e.backup.noticeAr}</p>
        </section>
      )}
    </div>
  );
}
