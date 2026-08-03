"use client";
// ════════════════════════════════════════════════════════════════════════════
// OpsCallSheetPrint — ورقة النداء للطباعة. HTML صالح للطباعة، **لا PDF**:
// لا مكتبة توليد، ولا رفع ملفّ، ولا خطّ خارجيّ. window.print() والمتصفّح يتولّى
// الباقي، فتخرج الورقة من أيّ جهاز في الموقع بلا اعتماد على شبكة.
//
// الصدق في المصدر: كلّ سطر هنا يأتي من prodops_call_sheet، وهي التي تفحص
// prodops_can_read_job قبل أن تقرأ صفًّا واحدًا. فرد الطاقم في مهمّة أخرى لا
// يستطيع طباعة هذه الورقة، لأنّ الخادم لا يعطيه بياناتها أصلًا — لا لأنّ الزرّ
// مخفيّ عنه.
//
// الطباعة تنقلب إلى أسود على أبيض: ورقة الموقع تُقرأ تحت الشمس، والحبر الأسود
// على خلفية داكنة يستهلك الطابعة ويخرج غير مقروء.
// ════════════════════════════════════════════════════════════════════════════
import {
  opsCallSheet, opsReadiness, CREW_ROLE_AR, CREW_STATUS_AR, HSE_STATUS_AR, JOB_TYPE_AR,
  opsDate, opsTime, opsDateTime,
  type OpsCallSheetData, type OpsJobType, type OpsReadiness,
} from "@/lib/portal/opsCenter";
import { btnGhost, btnPrimary, StateView, useOpsLoad } from "./OpsAtoms";
import OpsSunWeather, { opsSunWeatherEnabled } from "./OpsSunWeather";

const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

/** أنماط الطباعة: نطاقها هذه الورقة وحدها (‎.ops-print‎) فلا تُلوّث بقيّة البوّابة. */
const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  .ops-print, .ops-print * { visibility: visible !important; }
  .ops-print {
    position: absolute !important; inset: 0 auto auto 0; width: 100%;
    background: #fff !important; color: #000 !important; padding: 0 !important;
  }
  .ops-print * { background: transparent !important; color: #000 !important; border-color: #999 !important; }
  .ops-print table { border-collapse: collapse; width: 100%; }
  .ops-print th, .ops-print td { border: 1px solid #999 !important; padding: 4px 6px; font-size: 11pt; }
  .ops-noprint { display: none !important; }
  .ops-print h1 { font-size: 16pt; }
  .ops-print h2 { font-size: 12pt; margin-top: 10pt; }
  @page { margin: 12mm; }
}
`;

export default function OpsCallSheetPrint({
  jobId, sheetDate, onClose,
}: { jobId: string; sheetDate?: string | null; onClose: () => void }) {
  const { st, reload } = useOpsLoad<OpsCallSheetData>(
    () => opsCallSheet(jobId, sheetDate ?? null), [jobId, sheetDate],
  );
  // النواقص تُطبع مع الورقة: من يمسكها في الموقع يحتاج أن يعرف ما لم يكتمل،
  // لا أن يكتشفه عند البوّابة. المصدر هو محرّك الجاهزية نفسه لا قائمة ثانية.
  const { st: rdSt } = useOpsLoad<OpsReadiness>(() => opsReadiness(jobId), [jobId]);
  const readiness = rdSt && rdSt.state === "ok" ? rdSt.data : null;
  return (
    <div className="space-y-3">
      <style>{PRINT_CSS}</style>
      <div className="ops-noprint flex flex-wrap gap-2">
        <button className={btnGhost} onClick={onClose}>إغلاق</button>
        <button className={btnPrimary} onClick={() => window.print()}>طباعة</button>
        <span className="text-[11px] text-stone-500 self-center">
          تُطبَع كصفحة HTML عبر المتصفّح — لا يُنشئ النظام ملفّ PDF.
        </span>
      </div>
      <StateView st={st} onRetry={reload}>{(d) => <Sheet d={d} readiness={readiness} jobId={jobId} />}</StateView>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-stone-400 shrink-0">{label}:</span>
      <span className="text-stone-100">{value}</span>
    </div>
  );
}

function Sheet({ d, readiness, jobId }: { d: OpsCallSheetData; readiness: OpsReadiness | null; jobId: string }) {
  const cs = d.sheet;
  const job = d.job;
  const loc = d.location as Record<string, unknown> | null;
  const w = d.weather as Record<string, unknown> | null;
  const missing = (readiness?.checks ?? []).filter((c) => c.required && !c.ok);

  return (
    <div
      dir="rtl"
      lang="ar"
      className="ops-print bg-stone-900 border border-stone-800 rounded-xl p-5 space-y-4"
    >
      <header className="space-y-1 border-b border-stone-700 pb-3">
        <h1 className="text-lg text-stone-50 font-semibold">
          ورقة نداء — {S(job.title)} ({S(job.job_code)})
        </h1>
        <div className="text-xs text-stone-400">
          {JOB_TYPE_AR[job.job_type as OpsJobType] ?? S(job.job_type)}
          {" · "}
          {cs ? `تاريخ الورقة ${opsDate(String(cs.sheet_date ?? ""))} — نسخة ${S(cs.version)}` : "بلا ورقة محفوظة"}
          {cs ? ` · ${cs.status === "published" ? "منشورة" : "مسوّدة (غير نهائية)"}` : ""}
        </div>
        {!cs && (
          // صدق: الطباعة بلا ورقة محفوظة ممكنة، لكن لا تُقدَّم كأنّها معتمدة.
          <p className="text-[11px] text-amber-300">
            لا Call Sheet محفوظة لهذه المهمّة. ما يلي مُجمَّع من بيانات المهمّة نفسها ولم يُعتمد بنشر.
          </p>
        )}
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
        <Row label="العميل" value={S(job.client_label)} />
        <Row label="المشروع" value={S(job.project_name)} />
        <Row label="بداية التنفيذ" value={opsDateTime(job.scheduled_start)} />
        <Row label="نهاية التنفيذ" value={opsDateTime(job.scheduled_end)} />
        <Row label="الحضور العامّ" value={cs ? opsTime(String(cs.general_call_time ?? "")) : "—"} />
        <Row label="الموقع" value={loc ? S(loc.name) : "—"} />
        <Row label="العنوان" value={loc ? S(loc.address) : "—"} />
        <Row label="مسؤول الموقع" value={loc ? `${S(loc.contact_name)} · ${S(loc.contact_phone)}` : "—"} />
        <Row label="الدخول" value={loc ? S(loc.access_notes) : "—"} />
        <Row label="المواقف" value={cs ? S(cs.parking_note) : loc ? S(loc.parking_notes) : "—"} />
      </section>

      {/* النواقص الإلزامية — تُطبع كما هي، ولا تُخفى لتبدو الورقة مكتملة. */}
      <section className="border border-stone-700 rounded-lg p-3 space-y-1">
        <h2 className="text-sm text-stone-100">
          النواقص الإلزامية{readiness ? ` (${readiness.passed ?? 0}/${readiness.required ?? 0} مكتمل)` : ""}
        </h2>
        {!readiness ? (
          <p className="text-xs text-stone-500">تعذّر حساب الجاهزية — لا تُقرأ الورقة على أنّها مكتملة.</p>
        ) : missing.length === 0 ? (
          <p className="text-xs text-stone-300">لا نواقص إلزامية.</p>
        ) : (
          <ul className="text-sm text-stone-100 space-y-1">
            {missing.map((c) => <li key={c.key}>✗ {c.ar}</li>)}
          </ul>
        )}
      </section>

      <section className="border border-stone-700 rounded-lg p-3 space-y-1">
        <h2 className="text-sm text-stone-100">الطوارئ</h2>
        <Row label="أقرب مستشفى" value={cs ? S(cs.hospital_name) : "—"} />
        <Row label="عنوان المستشفى" value={cs ? S(cs.hospital_address) : "—"} />
        <Row
          label="مسؤول الطوارئ"
          value={cs ? `${S(cs.emergency_contact_name)} · ${S(cs.emergency_contact_phone)}` : "—"}
        />
      </section>

      <section>
        <h2 className="text-sm text-stone-100 mb-2">الطاقم ({d.crew.length})</h2>
        {d.crew.length === 0 ? (
          <p className="text-xs text-stone-500">لا طاقم مُسنَد.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-stone-400 text-xs">
                  <th className="text-right py-1">الدور</th>
                  <th className="text-right py-1">الاسم</th>
                  <th className="text-right py-1">الجوّال</th>
                  <th className="text-right py-1">الحضور</th>
                  <th className="text-right py-1">الانصراف</th>
                  <th className="text-right py-1">الحالة</th>
                </tr>
              </thead>
              <tbody>
                {d.crew.map((c, i) => (
                  <tr key={`${c.user_id ?? c.name ?? "crew"}-${i}`} className="text-stone-100">
                    <td className="py-1">{CREW_ROLE_AR[c.crew_role] ?? S(c.crew_role)}</td>
                    <td className="py-1">{S(c.name)}</td>
                    <td className="py-1">{S(c.phone)}</td>
                    <td className="py-1">{opsTime(c.call_time)}</td>
                    <td className="py-1">{opsTime(c.wrap_time)}</td>
                    <td className="py-1">{CREW_STATUS_AR[c.status] ?? S(c.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm text-stone-100 mb-2">المركبات ({d.vehicles.length})</h2>
        {d.vehicles.length === 0 ? (
          <p className="text-xs text-stone-500">لا مركبات.</p>
        ) : (
          <ul className="text-sm text-stone-100 space-y-1">
            {d.vehicles.map((v, i) => (
              <li key={String(v.id ?? i)}>
                {S(v.vehicle_label)} · السائق {S(v.driver_name)} · مغادرة {opsDateTime(v.depart_at as string)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="text-sm text-stone-100 mb-2">السلامة ({d.hse.length})</h2>
        {d.hse.length === 0 ? (
          <p className="text-xs text-stone-500">لا قائمة سلامة.</p>
        ) : (
          <ul className="text-sm text-stone-100 space-y-1">
            {d.hse.map((h, i) => (
              <li key={`${h.item_ar}-${i}`}>
                {h.is_required ? "★ " : ""}{S(h.item_ar)} — {HSE_STATUS_AR[h.status] ?? S(h.status)}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-stone-700 pt-3 space-y-1">
        {/* ⛔ العلم مطفأ ⇒ هذا القسم كما كان بالضبط، حرفًا بحرف. Wave 3 لا تغيّر
            ورقة نداء قائمة إلّا بقرار صريح بتفعيل العلم. */}
        {!opsSunWeatherEnabled() ? (
          <>
            <h2 className="text-sm text-stone-100">الطقس</h2>
            {w ? (
              <Row
                label={opsDate(String(w.for_date ?? ""))}
                value={`${S(w.condition)} · ${S(w.temp_c)}°م · رياح ${S(w.wind_kph)} كم/س · احتمال مطر ${S(w.precip_pct)}%`}
              />
            ) : (
              <p className="text-xs text-stone-500">لا إدخال طقس.</p>
            )}
            {/* الطقس هنا إدخال بشريّ داخل النظام — ولا يُدَّعى مصدر آليّ. */}
          </>
        ) : (
          /* 🔴 عرض فقط في الطباعة: canManage=false ⇒ لا زرّ تحديث على ورقة تُطبع.
             والساعة الذهبية محسوبة محليًّا فتظهر ولو انقطعت الشبكة في الموقع. */
          <OpsSunWeather data={d} jobId={jobId} canManage={false} />
        )}
        <p className="text-[11px] text-stone-500">{S(d.weather_note)}</p>
        {cs && S(cs.notes) !== "—" && (
          <p className="text-sm text-stone-200 leading-6 pt-2">{S(cs.notes)}</p>
        )}
      </section>
    </div>
  );
}
