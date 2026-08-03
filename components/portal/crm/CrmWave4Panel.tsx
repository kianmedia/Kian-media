"use client";
// ════════════════════════════════════════════════════════════════════════════
// CrmWave4Panel — لوحة الفوز · الموسمية · صحّة العميل · العملاء الصامتون.
//
// Wave 4 · V2-4.1-C · V2-4.4-A · V2-4.4-C · V2-4.5-A
//
// ★ لا لوحة CRM ثانية ★
// كلّ رقم هنا يأتي من محرّك CRM القائم عبر `crm_*` RPCs، ومن **عرض مشتقّ**
// لصحّة العميل. لا جدول درجات، ولا نسخة ثانية من المبيعات.
//
// ★★ ثلاثة أشياء ترفض هذه اللوحة أن تفعلها ★★
//  ١. **لا تُظهر هامشًا لغير المخوَّل ماليًّا** — والقاعدة هي من تقرّر، لا هذه
//     الواجهة. وحين يُحجب تقول «محجوب» لا تعرض صفرًا.
//  ٢. **لا تُرسل شيئًا.** قائمة «الصامتون» اقتراح يقرؤه إنسان، لا طابور تنفيذ،
//     والخادم يعيد `auto_sent: false` صراحةً وهي تُعرض للمستخدم.
//  ٣. **لا تستنتج ربحًا ولا خسارة** من بيانات ناقصة — قرار W4-1.
//
// ⛔ خلف علم مطفأ لا تُركَّب أصلًا (الحارس في المستدعي).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  crmWinRateReport, crmSeasonalityReport, crmSilentClients,
  type CrmWinRate, type CrmClientHealth,
} from "@/lib/portal/crm";

type Phase<T> =
  | { k: "loading" }
  | { k: "error"; msg: string }
  | { k: "denied"; msg: string }
  | { k: "needs_migration"; msg: string }
  | { k: "ok"; data: T };

/** يحوّل CrmState إلى طور عرض — الحالات نفسها التي تستعملها بقيّة البوّابة. */
function useCrm<T>(load: () => Promise<{ state: string; data?: T; message?: string }>, deps: unknown[]) {
  const [p, setP] = useState<Phase<T>>({ k: "loading" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  const reload = useCallback(() => {
    let alive = true;
    setP({ k: "loading" });
    run().then((r) => {
      if (!alive) return;
      if (r.state === "ok" && r.data !== undefined) setP({ k: "ok", data: r.data });
      else if (r.state === "denied") setP({ k: "denied", msg: r.message ?? "لا تملك صلاحية." });
      else if (r.state === "needs_migration") setP({ k: "needs_migration", msg: r.message ?? "تحتاج ترحيلة قاعدة." });
      else setP({ k: "error", msg: r.message ?? "تعذّر التحميل." });
    });
    return () => { alive = false; };
  }, [run]);
  useEffect(() => reload(), [reload]);
  return { p, reload };
}

const card = "bg-stone-900 border border-stone-800 rounded-xl p-4";
const num = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US");

function Shell<T>({ p, reload, children }: { p: Phase<T>; reload: () => void; children: (d: T) => React.ReactNode }) {
  if (p.k === "loading") return <p className="text-[12px] text-stone-500">جارٍ التحميل…</p>;
  if (p.k === "denied") return <p className="text-[12px] text-stone-400">{p.msg}</p>;
  // «تحتاج ترحيلة» حالة مستقلّة عن المنع — لا تُقرأ كمشكلة في حساب المستخدم.
  if (p.k === "needs_migration") return <p className="text-[12px] text-amber-500">{p.msg}</p>;
  if (p.k === "error") return (
    <p className="text-[12px] text-red-400">
      {p.msg} <button className="underline" onClick={reload}>إعادة المحاولة</button>
    </p>
  );
  return <>{children(p.data)}</>;
}

// ─── نسبة الفوز ─────────────────────────────────────────────────────────────

function WinRate() {
  const { p, reload } = useCrm<CrmWinRate>(() => crmWinRateReport({}), []);
  return (
    <section className={card}>
      <h3 className="text-[13px] text-stone-100 mb-2">نسبة الفوز والقيمة</h3>
      <Shell p={p} reload={reload}>
        {(d) => (
          <div className="space-y-1 text-[12.5px]">
            <div className="grid grid-cols-2 gap-2">
              <div className="text-stone-400">فرص محسومة<span className="text-stone-100 block tabular-nums">{num(d.won + d.lost)}</span></div>
              <div className="text-stone-400">نسبة الفوز
                <span className="text-stone-100 block tabular-nums">
                  {d.win_rate_pct === null ? "—" : `${d.win_rate_pct}%`}
                </span>
              </div>
              <div className="text-stone-400">مربوحة<span className="text-stone-100 block tabular-nums">{num(d.won)}</span></div>
              <div className="text-stone-400">مخسورة<span className="text-stone-100 block tabular-nums">{num(d.lost)}</span></div>
            </div>
            {/* النسبة على المحسوم فقط — إدخال المفتوحة في المقام يجعل الرقم
                يتحسّن كلّما أُهملت الصفقات. */}
            {d.win_rate_pct === null && (
              <p className="text-[11px] text-stone-500">لا فرص محسومة في المدة — لا تُحتسب نسبة.</p>
            )}
            <div className="border-t border-stone-800 pt-2 mt-2">
              <div className="text-stone-400 text-[12px]">قيمة المربوحة
                <span className="text-stone-100 block tabular-nums" dir="ltr">{num(d.won_value)}</span>
              </div>
              {/* 🔴 الهامش: القاعدة قرّرت. محجوب ⇒ يُقال محجوب، لا يُعرض صفر. */}
              <p className="text-[11px] mt-2 text-stone-500">
                متوسط الهامش:{" "}
                {d.margin_visible
                  ? (d.avg_margin_pct === null
                      ? "غير محسوب — مصدر التكلفة غير محسوم (W4-1)"
                      : `${d.avg_margin_pct}%`)
                  : "🔒 محجوب — يحتاج صلاحية مالية"}
              </p>
            </div>
          </div>
        )}
      </Shell>
    </section>
  );
}

// ─── الموسمية ───────────────────────────────────────────────────────────────

const MONTH_AR = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

function Seasonality() {
  const { p, reload } = useCrm<{ ok: boolean; unavailable?: boolean; rows: { year: number; month: number; shoot_days: number }[] }>(
    () => crmSeasonalityReport(3), []);
  return (
    <section className={card}>
      <h3 className="text-[13px] text-stone-100 mb-2">الموسمية — أيام التصوير</h3>
      <Shell p={p} reload={reload}>
        {(d) =>
          // جدول غير مطبَّق ⇒ يُعلَن، ولا يُعرض صفر يُقرأ كأنّه «لا عمل».
          d.unavailable ? <p className="text-[12px] text-amber-500">مصدر جلسات التصوير غير مطبَّق بعد.</p>
          : d.rows.length === 0 ? <p className="text-[12px] text-stone-500">لا جلسات تصوير مسجَّلة في المدة.</p>
          : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead><tr className="text-stone-500"><th className="text-start py-1">الشهر</th><th className="text-start">السنة</th><th className="text-start">أيام</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={`${r.year}-${r.month}`} className="border-t border-stone-800">
                      <td className="py-1 text-stone-300">{MONTH_AR[r.month - 1] ?? r.month}</td>
                      <td className="text-stone-400 tabular-nums" dir="ltr">{r.year}</td>
                      <td className="text-stone-100 tabular-nums">{r.shoot_days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Shell>
    </section>
  );
}

// ─── العملاء الصامتون ───────────────────────────────────────────────────────

function SilentClients() {
  const { p, reload } = useCrm<{ ok: boolean; threshold_days: number; suggested: CrmClientHealth[]; auto_sent: boolean }>(
    () => crmSilentClients(180), []);
  return (
    <section className={card}>
      <h3 className="text-[13px] text-stone-100 mb-1">متابعة مقترحة</h3>
      {/* 🔒 السطر التالي ليس تزيينًا: القاعدة تعيد auto_sent=false، ويُعرض. */}
      <p className="text-[11px] text-stone-500 mb-2">
        اقتراح للقراءة — **لا يُرسَل شيء تلقائيًّا**، والمتابعة قرار بشريّ.
      </p>
      <Shell p={p} reload={reload}>
        {(d) => (
          <>
            {d.auto_sent && (
              <p className="text-[11px] text-red-400">🔴 الخادم أعلن إرسالًا تلقائيًّا — خالف العقد.</p>
            )}
            {d.suggested.length === 0 ? (
              <p className="text-[12px] text-stone-500">
                لا عميل صامت أكثر من {d.threshold_days} يومًا. لا إجراء مطلوب.
              </p>
            ) : (
              <ul className="space-y-1">
                {d.suggested.map((c) => (
                  <li key={c.company_id} className="flex justify-between gap-3 text-[12.5px] border-t border-stone-800 pt-1">
                    <span className="text-stone-200 truncate">{c.company_name}</span>
                    <span className="text-amber-500 tabular-nums shrink-0">{c.days_silent} يومًا</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Shell>
    </section>
  );
}

export default function CrmWave4Panel() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      <WinRate />
      <Seasonality />
      <SilentClients />
    </div>
  );
}
