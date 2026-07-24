"use client";
// ════════════════════════════════════════════════════════════════════════════
// ProgramSlaTab — Batch 8D. ثلاثة أقسام على مصدر واحد مشتقّ من الخادم:
//   الالتزامات (هدف مخزَّن + نتيجة مشتقّة) · مصفوفة التسليم · ما ينتظر العميل.
// لا حساب SLA في المتصفّح، ولا «٠» مكان «غير متاح»، ولا تذكير تلقائيّ.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { csvDownload } from "@/lib/portal/csv";
import { PC_STAGE_LABELS, type PcStage } from "@/lib/portal/projectCore";
import { CLOSURE_STATUS, type ClosureStatus } from "@/lib/portal/projectClosure";
import {
  programCommitmentsList, programCommitmentResults, programSlaForecast,
  programDeliveryMatrix, programClientActions, programCommitmentUpsert, programCommitmentArchive,
  COMMITMENT_TYPE_AR, TARGET_UNIT_AR, PERIOD_TYPE_AR, SLA_STATUS_AR, SLA_STATUS_COLOR,
  MISSING_REASON_AR, forecastReasonAr, slaErr, slaValue,
  type Commitment, type CommitmentResult, type SlaForecast, type DeliveryMatrix,
  type ClientActions, type CommitmentType, type TargetUnit, type PeriodType, type SlaStatus,
} from "@/lib/portal/programSla";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-3 py-2 text-sm text-stone-200 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-xs disabled:opacity-50";
type Section = "commitments" | "matrix" | "client";
const PAGE = 50;

export default function ProgramSlaTab({ projectId, canManage, flash }: {
  projectId: string; canManage: boolean; flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const [sec, setSec] = useState<Section>("commitments");
  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label={t({ ar: "أقسام الالتزامات", en: "SLA sections" })}>
        {([
          ["commitments", "الالتزامات ومؤشّراتها", "Commitments"],
          ["matrix", "مصفوفة التسليم", "Delivery matrix"],
          ["client", "بانتظار العميل", "Client pending"],
        ] as [Section, string, string][]).map(([k, ar, en]) => (
          <button key={k} role="tab" aria-selected={sec === k} onClick={() => setSec(k)}
            className={`px-3 py-1.5 rounded-lg text-xs whitespace-nowrap ${sec === k ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>
            {t({ ar, en })}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {sec === "commitments" && <CommitmentsSection projectId={projectId} canManage={canManage} flash={flash} />}
        {sec === "matrix" && <MatrixSection projectId={projectId} flash={flash} />}
        {sec === "client" && <ClientPendingSection projectId={projectId} />}
      </div>
    </div>
  );
}

// ─────────────────────────── ١) الالتزامات ───────────────────────────
function CommitmentsSection({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<Commitment[]>([]);
  const [res, setRes] = useState<CommitmentResult[]>([]);
  const [fc, setFc] = useState<SlaForecast | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState<Commitment | "new" | null>(null);
  const [resErr, setResErr] = useState("");   // خطأ محرّك القياس يُعرض، ولا يُقرأ كـ«غير متاح»
  const seq = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    const [l, r, f] = await Promise.all([
      programCommitmentsList(projectId), programCommitmentResults(projectId), programSlaForecast(projectId),
    ]);
    if (!alive.current || my !== seq.current) return;
    if (!l.ok) { setErr(slaErr(l.error)); setPhase("error"); return; }
    setRows(l.data);
    setRes(r.ok ? r.data.results : []);
    setFc(f.ok ? f.data : null);
    // رفض الصلاحية أو تعذّر المحرّك ≠ «كل التزام غير متاح»: نعرضه صراحةً.
    setResErr(r.ok ? "" : slaErr(r.error));
    if (!r.ok && process.env.NODE_ENV !== "production") console.error("[8d results]", r.error);
    setPhase("ready");
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function archive(c: Commitment) {
    const reason = window.prompt(t({ ar: `سبب أرشفة «${c.name_ar}» (إلزامي):`, en: "Archive reason (required):" }));
    if (reason === null) return;
    if (!reason.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    const r = await programCommitmentArchive(c.id, reason.trim());
    if (!r.ok) { flash(slaErr(r.error)); return; }
    flash(t({ ar: "أُرشف الالتزام — لم يُحذف أيّ سجلّ.", en: "Archived (nothing deleted)." }));
    void load();
  }

  function exportCsv() {
    const head = ["المفتاح", "الالتزام", "النوع", "الهدف", "الوحدة", "الفعليّ", "البسط", "المقام",
      "الحالة", "حجم العيّنة", "من", "إلى", "المعادلة", "سبب عدم التوفّر", "ظاهر للعميل"];
    const body = res.map((x) => [
      x.commitment_key, x.name_ar, COMMITMENT_TYPE_AR[x.commitment_type] ?? x.commitment_type,
      x.target ?? "", TARGET_UNIT_AR[x.unit] ?? x.unit, x.actual ?? "", x.numerator ?? "", x.denominator ?? "",
      SLA_STATUS_AR[x.status] ?? x.status, x.sample_size, x.period_from ?? "", x.period_to ?? "",
      x.formula_ar ?? x.formula_key,
      x.missing_data_reason ? (MISSING_REASON_AR[x.missing_data_reason] ?? x.missing_data_reason) : "",
      x.client_visible ? "نعم" : "لا",
    ]);
    csvDownload(`program-sla-${new Date().toISOString().slice(0, 10)}`, [head, ...body]);
  }

  if (phase === "loading") return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className={`${card} p-6 text-center space-y-2`} role="alert">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={() => void load()} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );

  const byId = new Map(res.map((x) => [x.commitment_id, x]));
  const fcById = new Map((fc?.forecasts ?? []).map((x) => [x.commitment_id, x]));

  return (
    <div className="space-y-3">
      {fc && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([["met", fc.counters.met], ["warning", fc.counters.warning],
             ["breached", fc.counters.breached], ["unavailable", fc.counters.unavailable]] as [SlaStatus, number][]).map(([k, n]) => (
            <div key={k} className={`${card} p-2.5 text-center`}>
              <div className="text-lg font-bold" style={{ color: SLA_STATUS_COLOR[k] }}>{n}</div>
              <div className="text-[10px] text-stone-500">{SLA_STATUS_AR[k]}</div>
            </div>
          ))}
        </div>
      )}

      {resErr && (
        <div className={`${card} p-3 border-amber-900/60`} role="alert">
          <p className="text-[11px] text-amber-300">{t({ ar: "تعذّر حساب المؤشّرات: ", en: "Could not compute results: " })}{resErr}</p>
          <p className="text-[10px] text-stone-600 mt-0.5">{t({ ar: "التزامات محفوظة لكن أرقامها لم تُحسب — ليست «غير متاحة».", en: "Commitments exist; results were not computed." })}</p>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "التزامات البرنامج", en: "Program commitments" })}</h4>
        <div className="flex gap-2">
          <button onClick={() => void load()} className={`${btnGhost} px-3 py-1.5`}>↻ {t({ ar: "تحديث", en: "Refresh" })}</button>
          {res.length > 0 && <button onClick={exportCsv} className={`${btnGhost} px-3 py-1.5`}>{t({ ar: "تصدير CSV", en: "CSV" })}</button>}
          {canManage && <button onClick={() => setEdit("new")} className="rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs px-3 py-1.5">+ {t({ ar: "التزام جديد", en: "New" })}</button>}
        </div>
      </div>

      {rows.length === 0 && (
        <div className={`${card} p-8 text-center`}>
          <p className="text-sm text-stone-400">{t({ ar: "لا توجد التزامات معرَّفة لهذا البرنامج.", en: "No commitments defined." })}</p>
          <p className="text-[11px] text-stone-600 mt-1">{t({ ar: "عرّف هدفًا واحدًا (عدد الحلقات مثلًا) وسيُقاس تلقائيًّا من الأحداث الموثَّقة.", en: "Define one target; it is measured from recorded events." })}</p>
        </div>
      )}

      {rows.map((c) => {
        const r = byId.get(c.id);
        const f = fcById.get(c.id);
        const st = (r?.status ?? "unavailable") as SlaStatus;
        return (
          <div key={c.id} className={`${card} p-3 space-y-2`}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-stone-100" dir="auto">{c.name_ar}</p>
                <p className="text-[10px] text-stone-500">
                  {COMMITMENT_TYPE_AR[c.commitment_type] ?? c.commitment_type} · {PERIOD_TYPE_AR[c.period_type]}
                  {r?.period_from || r?.period_to ? <span dir="ltr"> · {r?.period_from ?? "…"} → {r?.period_to ?? "…"}</span> : null}
                  {c.client_visible ? ` · ${t({ ar: "ظاهر للعميل", en: "client-visible" })}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {r?.source_quality === "partial" && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-stone-800 text-amber-400">{t({ ar: "جزئيّ", en: "partial" })}</span>
                )}
                <span className="text-[11px] px-2 py-0.5 rounded"
                  style={{ background: SLA_STATUS_COLOR[st] + "22", color: SLA_STATUS_COLOR[st] }}>
                  {SLA_STATUS_AR[st]}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <Mini ar="الهدف" v={slaValue(c.target_value, c.target_unit)} />
              <Mini ar="الفعليّ" v={slaValue(r?.actual ?? null, c.target_unit)} />
              <Mini ar="حجم العيّنة" v={r ? String(r.sample_size) : "—"} />
              <Mini ar="الفرق" v={r?.variance == null ? "—" : String(r.variance)} />
            </div>

            {r?.formula_ar && (
              <p className="text-[10px] text-stone-500" dir="auto">
                <span className="text-stone-600">{t({ ar: "المعادلة: ", en: "Formula: " })}</span>{r.formula_ar}
                {r.numerator != null && r.denominator != null ? ` (${r.numerator} / ${r.denominator})` : ""}
              </p>
            )}
            {r?.missing_data_reason && (
              <p className="text-[10px] text-amber-400" dir="auto">
                {MISSING_REASON_AR[r.missing_data_reason] ?? r.missing_data_reason}
              </p>
            )}
            {f && f.forecast_status === "projected" && f.forecasted_completion && (
              <p className="text-[10px] text-sky-300">
                {t({ ar: "التاريخ المتوقَّع للاكتمال", en: "Projected completion" })}: <span dir="ltr">{f.forecasted_completion}</span>
                {f.forecast_rate_per_30d != null ? ` · ${t({ ar: "المعدّل", en: "rate" })} ${f.forecast_rate_per_30d}/30ي` : ""}
                {f.forecasted_breach ? ` · ${t({ ar: "يتجاوز نهاية الفترة", en: "beyond period end" })}` : ""}
              </p>
            )}
            {f && f.forecast_status !== "projected" && f.forecast_reason && (
              <p className="text-[10px] text-stone-600">{t({ ar: "لا توقّع: ", en: "No forecast: " })}{forecastReasonAr(f.forecast_reason)}</p>
            )}

            {canManage && (
              <div className="flex gap-2 pt-1">
                <button onClick={() => setEdit(c)} className={`${btnGhost} px-3 py-1.5`}>{t({ ar: "تعديل", en: "Edit" })}</button>
                <button onClick={() => void archive(c)} className={`${btnGhost} px-3 py-1.5 text-stone-400`}>{t({ ar: "أرشفة", en: "Archive" })}</button>
              </div>
            )}
          </div>
        );
      })}

      {edit && (
        <CommitmentModal projectId={projectId} initial={edit === "new" ? null : edit}
          onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} flash={flash} />
      )}
    </div>
  );
}

function Mini({ ar, v }: { ar: string; v: string }) {
  return (
    <div className="border border-stone-800 rounded-lg p-2">
      <div className="text-sm font-bold text-stone-100" dir="auto">{v}</div>
      <div className="text-[9px] text-stone-500">{ar}</div>
    </div>
  );
}

const TYPES = Object.keys(COMMITMENT_TYPE_AR) as CommitmentType[];
const UNITS = Object.keys(TARGET_UNIT_AR) as TargetUnit[];
const PERIODS = Object.keys(PERIOD_TYPE_AR) as PeriodType[];

function CommitmentModal({ projectId, initial, onClose, onSaved, flash }: {
  projectId: string; initial: Commitment | null;
  onClose: () => void; onSaved: () => void; flash: (m: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [err, setErr] = useState("");
  const errRef = useRef<HTMLParagraphElement | null>(null);
  const [f, setF] = useState({
    commitment_key: initial?.commitment_key ?? "",
    commitment_type: (initial?.commitment_type ?? "total_unit_volume") as CommitmentType,
    name_ar: initial?.name_ar ?? "",
    description: initial?.description ?? "",
    target_value: initial?.target_value != null ? String(initial.target_value) : "",
    target_unit: (initial?.target_unit ?? "count") as TargetUnit,
    period_type: (initial?.period_type ?? "project") as PeriodType,
    period_start: initial?.period_start ?? "", period_end: initial?.period_end ?? "",
    warning_threshold: initial?.warning_threshold != null ? String(initial.warning_threshold) : "",
    critical_threshold: initial?.critical_threshold != null ? String(initial.critical_threshold) : "",
    client_visible: initial?.client_visible ?? false,
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  useEffect(() => { if (err) errRef.current?.focus(); }, [err]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busyRef.current) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    if (busy) return;
    if (!f.commitment_key.trim()) { setErr(t({ ar: "مفتاح الالتزام إلزامي.", en: "Key required." })); return; }
    if (!f.name_ar.trim()) { setErr(t({ ar: "اسم الالتزام إلزامي.", en: "Name required." })); return; }
    setBusy(true); busyRef.current = true; setErr("");
    const r = await programCommitmentUpsert(projectId, {
      id: initial?.id, commitment_key: f.commitment_key.trim(), commitment_type: f.commitment_type,
      name_ar: f.name_ar.trim(), description: f.description.trim() || null,
      target_value: f.target_value === "" ? null : Number(f.target_value),
      target_unit: f.target_unit, period_type: f.period_type,
      period_start: f.period_start || null, period_end: f.period_end || null,
      warning_threshold: f.warning_threshold === "" ? null : Number(f.warning_threshold),
      critical_threshold: f.critical_threshold === "" ? null : Number(f.critical_threshold),
      client_visible: f.client_visible,
    }, initial?.version);
    setBusy(false); busyRef.current = false;
    if (!r.ok) { setErr(slaErr(r.error)); return; }
    flash(t({ ar: "حُفظ الالتزام. النتيجة تُقاس تلقائيًّا من الأحداث الموثَّقة.", en: "Saved; measured from recorded events." }));
    onSaved();
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-start justify-center overflow-auto p-2 sm:p-4"
      role="dialog" aria-modal="true" aria-label={t({ ar: "التزام البرنامج", en: "Commitment" })}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="w-full max-w-md bg-stone-950 border border-stone-800 rounded-2xl my-2 sm:my-4" dir="rtl"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <div className="flex items-center justify-between p-3 border-b border-stone-800">
          <h3 className="text-sm font-semibold text-white">
            {initial ? t({ ar: "تعديل التزام", en: "Edit commitment" }) : t({ ar: "التزام جديد", en: "New commitment" })}
          </h3>
          <button onClick={onClose} disabled={busy} className="text-stone-400 px-1 disabled:opacity-40"
            aria-label={t({ ar: "إغلاق", en: "Close" })}>✕</button>
        </div>
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="ck">{t({ ar: "المفتاح *", en: "Key *" })}</label>
              <input id="ck" value={f.commitment_key} onChange={(e) => set("commitment_key", e.target.value)} className={`${inp} w-full`} dir="ltr" />
            </div>
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="ct">{t({ ar: "النوع", en: "Type" })}</label>
              <select id="ct" value={f.commitment_type} onChange={(e) => set("commitment_type", e.target.value as CommitmentType)} className={`${inp} w-full`}>
                {TYPES.map((k) => <option key={k} value={k}>{COMMITMENT_TYPE_AR[k]}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="cn">{t({ ar: "الاسم *", en: "Name *" })}</label>
            <input id="cn" value={f.name_ar} onChange={(e) => set("name_ar", e.target.value)} className={`${inp} w-full`} />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="cv">{t({ ar: "الهدف", en: "Target" })}</label>
              <input id="cv" type="number" step="any" value={f.target_value} onChange={(e) => set("target_value", e.target.value)} className={`${inp} w-full`} />
            </div>
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="cu">{t({ ar: "الوحدة", en: "Unit" })}</label>
              <select id="cu" value={f.target_unit} onChange={(e) => set("target_unit", e.target.value as TargetUnit)} className={`${inp} w-full`}>
                {UNITS.map((k) => <option key={k} value={k}>{TARGET_UNIT_AR[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="cp">{t({ ar: "الفترة", en: "Period" })}</label>
              <select id="cp" value={f.period_type} onChange={(e) => set("period_type", e.target.value as PeriodType)} className={`${inp} w-full`}>
                {PERIODS.map((k) => <option key={k} value={k}>{PERIOD_TYPE_AR[k]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="cw">{t({ ar: "عتبة التحذير", en: "Warning" })}</label>
              <input id="cw" type="number" step="any" value={f.warning_threshold} onChange={(e) => set("warning_threshold", e.target.value)} className={`${inp} w-full`} />
            </div>
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="cc">{t({ ar: "عتبة الخرق", en: "Critical" })}</label>
              <input id="cc" type="number" step="any" value={f.critical_threshold} onChange={(e) => set("critical_threshold", e.target.value)} className={`${inp} w-full`} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="cs">{t({ ar: "بداية الفترة", en: "From" })}</label>
              <input id="cs" type="date" value={f.period_start} onChange={(e) => set("period_start", e.target.value)} className={`${inp} w-full`} />
            </div>
            <div>
              <label className="text-[11px] text-stone-500 mb-1 block" htmlFor="ce">{t({ ar: "نهاية الفترة", en: "To" })}</label>
              <input id="ce" type="date" value={f.period_end} onChange={(e) => set("period_end", e.target.value)} className={`${inp} w-full`} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-stone-400">
            <input type="checkbox" checked={f.client_visible} onChange={(e) => set("client_visible", e.target.checked)} />
            {t({ ar: "إظهار هذا الالتزام للعميل في بوابة البرنامج", en: "Show to the client" })}
          </label>
          {err && <p ref={errRef} tabIndex={-1} role="alert" className="text-[11px] text-red-300">{err}</p>}
        </div>
        <div className="flex gap-2 justify-end p-3 border-t border-stone-800">
          <button onClick={onClose} disabled={busy} className={`${btnGhost} px-3 py-2`}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
          <button onClick={() => void save()} disabled={busy}
            className="rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white text-sm px-5 py-2">
            {busy ? t({ ar: "جارٍ الحفظ…", en: "Saving…" }) : t({ ar: "حفظ", en: "Save" })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── ٢) مصفوفة التسليم ───────────────────────────
const MATRIX_PRINT_CSS = `@media print {
  @page { size: A4; margin: 14mm; }
  body * { visibility: hidden !important; }
  #pgm-matrix-print, #pgm-matrix-print * { visibility: visible !important; }
  #pgm-matrix-print { position: absolute; inset: 0; color: #000 !important; background: #fff !important; }
  #pgm-matrix-print * { color: #000 !important; background: transparent !important; border-color: #999 !important; }
  #pgm-matrix-print .no-print { display: none !important; }
}`;
const MATRIX_FILTERS: [string, string][] = [
  ["", "الكل"], ["late", "متأخّرة"], ["awaiting_client", "بانتظار العميل"],
  ["delivered", "مُسلَّمة"], ["closed", "مغلقة"],
  ["no_planned_date", "بلا موعد مخطَّط"], ["unavailable_data", "بيانات ناقصة"],
];

function MatrixSection({ projectId, flash }: { projectId: string; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [data, setData] = useState<DeliveryMatrix | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const seq = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async (st: string, q: string, off: number) => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    const r = await programDeliveryMatrix(projectId, {
      status: st || undefined, search: q || undefined, limit: PAGE, offset: off,
    });
    if (!alive.current || my !== seq.current) return;
    if (!r.ok) { setErr(slaErr(r.error)); setPhase("error"); return; }
    setData(r.data); setPhase("ready");
  }, [projectId]);
  useEffect(() => { void load(status, search, offset); }, [load, status, offset]);   // البحث بزرّ/Enter

  function exportCsv() {
    if (!data) return;
    const head = ["رقم الوحدة", "الرمز", "الاسم", "المرحلة", "التقدّم٪", "المدير",
      "بداية مخطَّطة", "نهاية مخطَّطة", "نشر مخطَّط", "التسليم الفعليّ", "فرق الأيام",
      "المخرج الحالي", "بانتظار العميل", "تعديل مطلوب", "يحتاج نسخة نهائية",
      "اعتمادات معلّقة", "حالة الإغلاق", "بيانات ناقصة"];
    const body = data.rows.map((r) => [
      r.unit_number ?? "", r.unit_code ?? "", r.project_name,
      r.core_stage ? t(PC_STAGE_LABELS[r.core_stage as PcStage] ?? { ar: r.core_stage, en: r.core_stage }) : "",
      r.progress_pct ?? "", r.manager_name ?? "",
      r.planned_start ?? "", r.planned_end ?? "", r.planned_release_date ?? "",
      r.actual_delivery_at ?? "", r.days_early_late ?? "",
      r.current_deliverable?.title ?? "",
      r.awaiting_client ? "نعم" : "", r.revision_requested ? "نعم" : "",
      r.needs_final_master ? "نعم" : "", r.pending_approvals || "",
      r.closure_status ?? "", (r.missing_data ?? []).join(" | "),
    ]);
    csvDownload(`delivery-matrix-${new Date().toISOString().slice(0, 10)}`, [head, ...body]);
    flash(t({ ar: `صُدِّرت ${data.rows.length} وحدة من الصفحة الحالية.`, en: `Exported ${data.rows.length} rows.` }));
  }

  return (
    <div className="space-y-3" id="pgm-matrix-print">
      <style>{MATRIX_PRINT_CSS}</style>
      <div className="flex gap-2 flex-wrap items-center no-print">
        <select value={status} onChange={(e) => { setOffset(0); setStatus(e.target.value); }} className={inp}
          aria-label={t({ ar: "فلتر الحالة", en: "Status filter" })}>
          {MATRIX_FILTERS.map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
        </select>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setOffset(0); void load(status, search, 0); } }}
          placeholder={t({ ar: "بحث بالاسم أو الرمز…", en: "Search…" })} className={`${inp} flex-1 min-w-[10rem]`} />
        <button onClick={() => { setOffset(0); void load(status, search, 0); }} className={`${btnGhost} px-3 py-2`}>{t({ ar: "بحث", en: "Search" })}</button>
        {data && data.rows.length > 0 && <button onClick={exportCsv} className={`${btnGhost} px-3 py-2`}>{t({ ar: "تصدير CSV", en: "CSV" })}</button>}
        {data && <button onClick={() => window.print()} className={`${btnGhost} px-3 py-2`}>{t({ ar: "طباعة", en: "Print" })}</button>}
      </div>

      {phase === "loading" && <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>}
      {phase === "error" && (
        <div className={`${card} p-6 text-center space-y-2`} role="alert">
          <p className="text-sm text-red-300">{err}</p>
          <button onClick={() => void load(status, search, offset)} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
        </div>
      )}
      {phase === "ready" && data && data.rows.length === 0 && (
        <div className={`${card} p-8 text-center text-sm text-stone-400`}>{t({ ar: "لا وحدات مطابقة.", en: "No matching units." })}</div>
      )}

      {/* بطاقات على الجوال، وجدول أفقيّ قابل للتمرير على الشاشات الأكبر */}
      <div className="space-y-1.5">
        {(data?.rows ?? []).map((r) => (
          <div key={r.project_id} className={`${card} p-3 space-y-1.5`}>
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm text-stone-100 truncate" dir="auto">
                  {r.unit_number != null ? <span className="text-stone-500">#{r.unit_number} </span> : null}
                  {r.project_name}
                  {r.unit_code ? <span className="text-[10px] text-stone-600" dir="ltr"> {r.unit_code}</span> : null}
                </p>
                <p className="text-[10px] text-stone-500">
                  {r.core_stage ? t(PC_STAGE_LABELS[r.core_stage as PcStage] ?? { ar: r.core_stage, en: r.core_stage }) : "—"}
                  {r.manager_name ? ` · ${r.manager_name}` : ""}
                  {r.progress_pct != null ? ` · ${r.progress_pct}%` : ""}
                </p>
              </div>
              <div className="text-left shrink-0 text-[10px]">
                <div className="text-stone-500">{t({ ar: "نشر مخطَّط", en: "planned" })}: <span dir="ltr">{r.planned_release_date ?? r.planned_end ?? "—"}</span></div>
                <div className={r.actual_delivery_at ? "text-emerald-300" : "text-stone-600"}>
                  {t({ ar: "تسليم فعليّ", en: "actual" })}: <span dir="ltr">{r.actual_delivery_at ? r.actual_delivery_at.slice(0, 10) : t({ ar: "غير موثَّق", en: "not recorded" })}</span>
                </div>
                {r.days_early_late != null && (
                  <div style={{ color: r.days_early_late > 0 ? "#dc2626" : "#16a34a" }}>
                    {r.days_early_late > 0
                      ? t({ ar: `متأخّر ${r.days_early_late} يوم`, en: `${r.days_early_late}d late` })
                      : t({ ar: `مبكّر ${Math.abs(r.days_early_late)} يوم`, en: `${Math.abs(r.days_early_late)}d early` })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {r.awaiting_client && <Chip ar="بانتظار العميل" c="#0ea5e9" />}
              {r.revision_requested && <Chip ar="تعديل مطلوب" c="#d97706" />}
              {r.needs_final_master && <Chip ar="يحتاج نسخة نهائية" c="#a855f7" />}
              {r.pending_approvals > 0 && <Chip ar={`${r.pending_approvals} اعتماد معلّق`} c="#d97706" />}
              {r.closure_status && r.closure_status !== "closure_not_started" && (
                <Chip ar={CLOSURE_STATUS[r.closure_status as ClosureStatus]?.ar ?? r.closure_status}
                      c={CLOSURE_STATUS[r.closure_status as ClosureStatus]?.color ?? "#16a34a"} />
              )}
              {(r.missing_data ?? []).map((m) => <Chip key={m} ar={MISSING_AR[m] ?? m} c="#78716c" />)}
            </div>
          </div>
        ))}
      </div>

      {data && data.total > PAGE && (
        <div className="flex items-center justify-between gap-2 text-xs">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className={`${btnGhost} px-3 py-2`}>‹ {t({ ar: "السابق", en: "Prev" })}</button>
          <span className="text-stone-500">{offset + 1}–{Math.min(offset + PAGE, data.total)} {t({ ar: "من", en: "of" })} {data.total}</span>
          <button disabled={!data.has_more} onClick={() => setOffset(offset + PAGE)} className={`${btnGhost} px-3 py-2`}>{t({ ar: "التالي", en: "Next" })} ›</button>
        </div>
      )}
    </div>
  );
}

const MISSING_AR: Record<string, string> = {
  no_planned_date: "بلا موعد مخطَّط",
  delivered_without_recorded_timestamp: "مُسلَّم بلا طابع زمنيّ موثَّق",
  no_unit_number: "بلا رقم وحدة",
};
function Chip({ ar, c }: { ar: string; c: string }) {
  return <span className="px-1.5 py-0.5 rounded" style={{ background: c + "22", color: c }}>{ar}</span>;
}

// ─────────────────────────── ٣) بانتظار العميل ───────────────────────────
function ClientPendingSection({ projectId }: { projectId: string }) {
  const { t } = useI18n();
  const [data, setData] = useState<ClientActions | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const seq = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++seq.current; setPhase("loading"); setErr("");
    const r = await programClientActions(projectId, {});
    if (!alive.current || my !== seq.current) return;
    if (!r.ok) { setErr(slaErr(r.error)); setPhase("error"); return; }
    setData(r.data); setPhase("ready");
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  if (phase === "loading") return <p className="text-xs text-stone-500 py-8 text-center">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "error") return (
    <div className={`${card} p-6 text-center space-y-2`} role="alert">
      <p className="text-sm text-red-300">{err}</p>
      <button onClick={() => void load()} className={`${btnGhost} px-4 py-2`}>{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!data || data.rows.length === 0) return (
    <div className={`${card} p-8 text-center text-sm text-stone-400`}>{t({ ar: "لا شيء ينتظر العميل حاليًّا.", en: "Nothing pending with the client." })}</div>
  );

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] text-stone-600">{data.note}</p>
      {data.rows.map((r) => (
        <div key={r.deliverable_id} className={`${card} p-3`}>
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="min-w-0">
              <p className="text-sm text-stone-100 truncate" dir="auto">{r.deliverable_title}</p>
              <p className="text-[10px] text-stone-500" dir="auto">
                {r.unit_number != null ? `#${r.unit_number} · ` : ""}{r.project_name}
              </p>
            </div>
            <div className="text-left shrink-0 text-[10px]">
              <div className={r.stale ? "text-amber-400" : "text-stone-400"}>
                {r.kind === "awaiting_client_decision"
                  ? t({ ar: "بانتظار قرار العميل", en: "Awaiting client decision" })
                  : t({ ar: "تعديل مطلوب — لم تُرسَل نسخة جديدة", en: "Revision — no new version sent" })}
              </div>
              <div className="text-stone-600">
                {r.days_waiting == null
                  ? t({ ar: "مدّة الانتظار غير موثَّقة", en: "waiting time not recorded" })
                  : t({ ar: `منذ ${r.days_waiting} يوم`, en: `${r.days_waiting}d` })}
              </div>
              {r.open_client_comments > 0 && (
                <div className="text-sky-300">{r.open_client_comments} {t({ ar: "ملاحظة مفتوحة", en: "open notes" })}</div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
