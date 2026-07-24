"use client";
// ════════════════════════════════════════════════════════════════════════════
// ClientProgramSummary — Batch 8D. سطح العميل الوحيد لبرنامج متعدّد الوحدات.
// المستهلك الوحيد لـproject_program_client_summary. يظهر فقط حين:
//   · المشروع رئيسيّ (برنامج)، · المُشاهِد جهة عميل، · وتفعيل البرنامج للعميل في
//   إعدادات البرنامج (client_program_view_enabled) — تفرضه بوّابة الخادم.
// لا مخاطر/حوكمة/موارد/مالية/التزامات غير معلَنة — كلّها محجوبة في الخادم.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState } from "react";
import {
  programClientSummary, SLA_STATUS_AR, SLA_STATUS_COLOR, slaValue, slaErr,
  type ClientProgramSummary as Summary, type SlaStatus,
} from "@/lib/portal/programSla";
import { useI18n } from "@/lib/i18n";

const card = "bg-stone-900 border border-stone-800 rounded-xl";

export default function ClientProgramSummary({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [d, setD] = useState<Summary | null>(null);
  const [phase, setPhase] = useState<"loading" | "hidden" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  useEffect(() => {
    void (async () => {
      const r = await programClientSummary(projectId);
      if (!alive.current) return;
      if (!r.ok) {
        // «غير مفعَّل» أو «ليس برنامجًا» ليست خطأً للعميل — نُخفي القسم بهدوء.
        if (/client_program_view_disabled|program_requires_master|not authorized/.test(r.error)) { setPhase("hidden"); return; }
        setErr(slaErr(r.error)); setPhase("error"); return;
      }
      setD(r.data); setPhase("ready");
    })();
  }, [projectId]);

  if (phase === "hidden" || phase === "loading") return null;   // لا نُظهر هيكلًا فارغًا
  if (phase === "error") return (
    <section className={`${card} p-4`} role="alert">
      <p className="text-sm text-red-300">{err}</p>
    </section>
  );
  if (!d) return null;

  return (
    <section className={`${card} p-4 space-y-3`} dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-white" dir="auto">{t({ ar: "برنامجك", en: "Your program" })}: {d.program_name}</h3>
        {d.next_release_date && (
          <span className="text-[11px] text-sky-300">{t({ ar: "الإصدار القادم", en: "Next release" })}: <span dir="ltr">{d.next_release_date}</span></span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Mini n={d.units_total} ar="إجمالي الوحدات" />
        <Mini n={d.units_delivered} ar="مُسلَّمة" ok />
        <Mini n={d.units_awaiting_you} ar="بانتظار مراجعتك" warn />
      </div>

      {d.commitments.length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "التزامات الخدمة", en: "Service commitments" })}</h4>
          {d.commitments.map((c, i) => (
            <div key={i} className="flex items-center justify-between gap-2 text-[11px] border border-stone-800 rounded-lg px-2 py-1.5">
              <span className="text-stone-300" dir="auto">{c.name_ar}</span>
              <span className="flex items-center gap-2">
                <span className="text-stone-500">{t({ ar: "الفعليّ", en: "actual" })} {slaValue(c.actual, c.unit)} / {t({ ar: "الهدف", en: "target" })} {slaValue(c.target, c.unit)}</span>
                <span className="px-1.5 py-0.5 rounded" style={{ background: SLA_STATUS_COLOR[c.status as SlaStatus] + "22", color: SLA_STATUS_COLOR[c.status as SlaStatus] }}>
                  {SLA_STATUS_AR[c.status as SlaStatus] ?? c.status}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "الوحدات", en: "Units" })}</h4>
        {d.units.map((u) => (
          <div key={u.project_id} className="flex items-center justify-between gap-2 text-[11px] border border-stone-800 rounded-lg px-2 py-1.5">
            <span className="min-w-0 truncate" dir="auto">
              {u.unit_number != null ? <span className="text-stone-500">#{u.unit_number} </span> : null}
              <span className="text-stone-200">{u.project_name}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0">
              {u.awaiting_your_review && <span className="px-1.5 py-0.5 rounded bg-sky-900/40 text-sky-300">{t({ ar: "بانتظار مراجعتك", en: "review" })}</span>}
              {u.available_deliverables > 0 && <span className="text-stone-500">{u.available_deliverables} {t({ ar: "مخرج", en: "files" })}</span>}
              <span className="text-stone-400">{u.stage_label_ar}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Mini({ n, ar, ok, warn }: { n: number; ar: string; ok?: boolean; warn?: boolean }) {
  return (
    <div className="border border-stone-800 rounded-lg p-2">
      <div className="text-base font-bold" style={{ color: warn && n > 0 ? "#0ea5e9" : ok ? "#16a34a" : "#e7e5e4" }}>{n}</div>
      <div className="text-[9px] text-stone-500 leading-tight">{ar}</div>
    </div>
  );
}
