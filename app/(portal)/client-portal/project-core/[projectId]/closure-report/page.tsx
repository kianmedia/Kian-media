"use client";
// ════════════════════════════════════════════════════════════════════════════
// /client-portal/project-core/[projectId]/closure-report — Phase 5C.
// تقرير الإغلاق + «محضر التسليم والقبول النهائي» — صفحة صديقة للطباعة (CSS print).
// بيانات حقيقية عبر project_closure_report + project_acceptance_certificate. لا مكتبة PDF.
// ════════════════════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import { projectClosureReport, projectAcceptanceCertificate, closureErr, type Dict } from "@/lib/portal/projectClosure";

type Phase = "loading" | "denied" | "error" | "ready";

export default function ClosureReportPage() {
  const projectId = useParams<{ projectId: string }>().projectId;
  const { t } = useI18n();
  const { caps } = usePortal();
  const [report, setReport] = useState<Dict | null>(null);
  const [cert, setCert] = useState<Dict | null>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!(caps.isStaff || caps.isAdminArea)) { setPhase("denied"); return; }
    let alive = true;
    void Promise.all([projectClosureReport(projectId), projectAcceptanceCertificate(projectId)]).then(([r, c]) => {
      if (!alive) return;
      if (!r.ok) { setErr(closureErr(r.error)); setPhase("error"); return; }
      setReport(r.data); setCert(c.ok ? c.data : null); setPhase("ready");
    });
    return () => { alive = false; };
  }, [projectId, caps.isStaff, caps.isAdminArea]);

  if (phase === "loading") return <p className="p-8 text-center text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "denied") return <p className="p-8 text-center text-red-600">{t({ ar: "غير مصرّح.", en: "Not authorized." })}</p>;
  if (phase === "error") return <p className="p-8 text-center text-red-600">{err}</p>;
  if (!report) return null;

  const ov = (report.overview ?? {}) as Dict;
  const cr = (report.closure_request ?? {}) as Dict;
  const acc = (cert?.acceptance ?? report.client_acceptance ?? {}) as Dict;
  const dlv = (cert?.deliverables ?? []) as Dict[];
  const lessons = (report.lessons_learned ?? []) as Dict[];
  const dqw = (report.data_quality_warnings ?? []) as Dict[];
  const s = (v: unknown) => (v == null ? "—" : String(v));

  return (
    <div dir="rtl" className="closure-doc mx-auto max-w-3xl bg-white text-stone-900 p-8 print:p-0" style={{ minHeight: "100vh" }}>
      <style>{`@media print { @page { margin: 18mm; } .no-print { display:none !important; } body { background:#fff; } .closure-doc { max-width:100% !important; box-shadow:none !important; } }`}</style>

      <div className="no-print mb-4 flex justify-end gap-2">
        <button onClick={() => window.print()} className="text-sm bg-stone-800 text-white rounded px-4 py-2">{t({ ar: "طباعة", en: "Print" })}</button>
      </div>

      <header className="border-b-2 border-stone-800 pb-3 mb-4">
        <h1 className="text-xl font-bold">{t({ ar: "محضر التسليم والقبول النهائي", en: "Final Delivery & Acceptance Record" })}</h1>
        <p className="text-sm text-stone-600 mt-1">{s(ov.name)}</p>
        <div className="grid grid-cols-2 gap-1 text-xs text-stone-600 mt-2">
          <span>{t({ ar: "رقم الطلب", en: "Request no." })}: {s(cr.request_no)}</span>
          <span>{t({ ar: "المرحلة", en: "Stage" })}: {s(ov.core_stage)}</span>
          <span>{t({ ar: "تاريخ الطلب", en: "Requested" })}: {s(cr.requested_at)}</span>
          <span>{t({ ar: "تاريخ الإغلاق", en: "Closed" })}: {s(cr.actual_closure_date)}</span>
        </div>
      </header>

      <Section title={t({ ar: "المخرجات المقبولة", en: "Accepted deliverables" })}>
        {dlv.length === 0 ? <p className="text-xs text-stone-500">{t({ ar: "لا مخرجات معتمدة.", en: "None." })}</p> : (
          <table className="w-full text-xs border-collapse">
            <thead><tr className="border-b border-stone-300"><th className="text-right py-1">{t({ ar: "المخرج", en: "Deliverable" })}</th><th className="text-right py-1">{t({ ar: "الحالة", en: "Status" })}</th></tr></thead>
            <tbody>{dlv.map((x, i) => <tr key={i} className="border-b border-stone-100"><td className="py-1">{s(x.title)}</td><td className="py-1">{s(x.status)}</td></tr>)}</tbody>
          </table>
        )}
      </Section>

      <Section title={t({ ar: "إقرار القبول", en: "Acceptance" })}>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span>{t({ ar: "النوع", en: "Type" })}: {s(acc.acceptance_type)}</span>
          <span>{t({ ar: "الحالة", en: "Status" })}: {s(acc.status)}</span>
          <span>{t({ ar: "تاريخ القبول", en: "Accepted at" })}: {s(acc.accepted_at)}</span>
          <span>{t({ ar: "النطاق", en: "Scope" })}: {s(acc.acceptance_scope)}</span>
        </div>
        {acc.acceptance_comment ? <p className="text-xs text-stone-600 mt-1">{t({ ar: "ملاحظة", en: "Note" })}: {s(acc.acceptance_comment)}</p> : null}
      </Section>

      <Section title={t({ ar: "ملخّص المشروع", en: "Project summary" })}>
        <div className="grid grid-cols-3 gap-1 text-xs">
          <span>{t({ ar: "المخرجات", en: "Deliverables" })}: {s((report.deliverables_summary as Dict)?.approved)}/{s((report.deliverables_summary as Dict)?.total)}</span>
          <span>{t({ ar: "المهام", en: "Tasks" })}: {s((report.tasks_summary as Dict)?.done)}/{s((report.tasks_summary as Dict)?.total)}</span>
          <span>{t({ ar: "الإنجاز", en: "Progress" })}: {s(ov.progress_pct)}%</span>
        </div>
      </Section>

      {lessons.length > 0 && (
        <Section title={t({ ar: "الدروس المستفادة", en: "Lessons learned" })}>
          <ul className="text-xs list-disc pr-4 space-y-0.5">{lessons.map((l, i) => <li key={i}><b>{s(l.category)}:</b> {s(l.title)}{l.recommendation ? ` — ${s(l.recommendation)}` : ""}</li>)}</ul>
        </Section>
      )}

      {report.exceptions_overrides ? (
        <Section title={t({ ar: "الاستثناءات والتجاوزات", en: "Exceptions & overrides" })}>
          <pre className="text-[10px] text-stone-600 whitespace-pre-wrap">{JSON.stringify((report.exceptions_overrides as Dict).override_snapshot ?? report.exceptions_overrides, null, 1)}</pre>
        </Section>
      ) : null}

      {dqw.length > 0 && (
        <Section title={t({ ar: "ملاحظات جودة البيانات", en: "Data quality" })}>
          {dqw.map((w, i) => <p key={i} className="text-[11px] text-amber-700">· {s(w.ar)}</p>)}
        </Section>
      )}

      <footer className="mt-8 pt-4 border-t border-stone-300 grid grid-cols-2 gap-8 text-xs">
        <div><p className="mb-6">{t({ ar: "عن كيان ميديا", en: "For Kian Media" })}</p><div className="border-t border-stone-400 pt-1">{t({ ar: "التوقيع", en: "Signature" })}</div></div>
        <div><p className="mb-6">{t({ ar: "عن العميل", en: "For Client" })}</p><div className="border-t border-stone-400 pt-1">{t({ ar: "التوقيع", en: "Signature" })}</div></div>
      </footer>
      <p className="text-[9px] text-stone-400 mt-3">{t({ ar: "وُلّد آليًّا من نظام إدارة المشاريع — كيان ميديا.", en: "Auto-generated by the project management system." })} {s(report.generated_at)}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h2 className="text-sm font-semibold border-b border-stone-300 pb-1 mb-2">{title}</h2>
      {children}
    </section>
  );
}
