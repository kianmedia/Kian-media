"use client";
// ════════════════════════════════════════════════════════════════════════════
// GovernanceTab — Phase 5A. تبويب «الحوكمة» داخل المشروع: صحّة الحوكمة + بوابة المرحلة +
// الاعتمادات المعلّقة (قرار) + سجل المخاطر + Risk Matrix 5×5 + المشكلات/القرارات/التغييرات.
// بيانات حقيقية عبر project_governance_dashboard (RPC واحد، بلا N+1). العميل معزول (RLS + بوابات).
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import {
  projectGovernanceDashboard, pcApprovalDecide, pcRiskUpsert, pcRiskToIssue, pcIssueUpsert, pcDecisionUpsert,
  pcChangeRequestUpsert, govErr, GOV_HEALTH, RISK_SEV,
  type GovernanceDashboard, type GovRisk,
} from "@/lib/portal/projectGovernance";

export default function GovernanceTab({ projectId, canManage, flash }: { projectId: string; canManage: boolean; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [d, setD] = useState<GovernanceDashboard | null>(null);
  const [phase, setPhase] = useState<"loading" | "error" | "ready">("loading");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [matrixCell, setMatrixCell] = useState<string | null>(null);
  const [showRiskForm, setShowRiskForm] = useState(false);
  const reqSeq = useRef(0);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const load = useCallback(async () => {
    const my = ++reqSeq.current;
    setPhase("loading"); setErr("");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([projectGovernanceDashboard(projectId), new Promise<never>((_, rej) => { timer = setTimeout(() => rej(new Error("gov_timeout")), 20000); })]);
      if (!mountedRef.current || my !== reqSeq.current) return;
      if (!r.ok) { if (process.env.NODE_ENV !== "production") console.error("[governance]", r.error); setErr(govErr(r.error)); setPhase("error"); return; }
      setD(r.data); setPhase("ready");
    } catch (e) {
      if (!mountedRef.current || my !== reqSeq.current) return;
      setErr(e instanceof Error && e.message === "gov_timeout" ? t({ ar: "انتهت المهلة.", en: "Timed out." }) : govErr(String(e))); setPhase("error");
    } finally { if (timer) clearTimeout(timer); }
  }, [projectId, t]);
  useEffect(() => { void load(); }, [load]);

  async function decide(id: string, action: string) {
    let note: string | undefined;
    if (action !== "approve") { const r = window.prompt(t({ ar: "ملاحظة/سبب:", en: "Note/reason:" })); if (r === null) return; note = r; }
    setBusy(true); const r = await pcApprovalDecide(id, action, note); setBusy(false);
    if (!r.ok) { flash(govErr(r.error)); return; } flash(t({ ar: "تم البتّ.", en: "Decided." })); await load();
  }
  async function convertRisk(id: string) {
    if (!window.confirm(t({ ar: "تحويل هذه المخاطرة إلى مشكلة محقّقة؟", en: "Convert risk to issue?" }))) return;
    const r = await pcRiskToIssue(id); if (!r.ok) { flash(govErr(r.error)); return; }
    flash(t({ ar: "أُنشئت مشكلة من المخاطرة.", en: "Issue created." })); await load();
  }
  async function quickAdd(kind: "issue" | "decision" | "change") {
    const title = window.prompt(t({ ar: "العنوان:", en: "Title:" })); if (!title || !title.trim()) return;
    const fn = kind === "issue" ? pcIssueUpsert : kind === "decision" ? pcDecisionUpsert : pcChangeRequestUpsert;
    const r = await fn(projectId, { title }); if (!r.ok) { flash(govErr(r.error)); return; }
    flash(t({ ar: "أُضيف.", en: "Added." })); await load();
  }

  if (phase === "loading") return <p className="text-xs text-stone-500 py-6 text-center">{t({ ar: "جارٍ تحميل الحوكمة…", en: "Loading governance…" })}</p>;
  if (phase === "error") return (
    <div className="py-8 text-center space-y-3">
      <p className="text-sm text-red-300">{t({ ar: "تعذّر تحميل الحوكمة.", en: "Couldn't load governance." })}</p>
      {err && <p className="text-[11px] text-stone-500">{err}</p>}
      <button onClick={() => void load()} className="text-xs text-stone-200 bg-stone-800 border border-stone-700 rounded-lg px-4 py-2">{t({ ar: "إعادة المحاولة", en: "Retry" })}</button>
    </div>
  );
  if (!d) return null;
  const h = d.health, hs = GOV_HEALTH[h.health_status] ?? GOV_HEALTH.healthy;
  const filteredRisks = matrixCell ? d.risks.filter((r) => `${r.probability}x${r.impact}` === matrixCell) : d.risks;

  return (
    <div className="space-y-4" dir="rtl">
      {/* صحّة الحوكمة */}
      <section className="border border-stone-800 rounded-xl p-3 bg-stone-950 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-xs font-semibold text-stone-200">{t({ ar: "صحّة الحوكمة", en: "Governance Health" })}</h4>
          <div className="flex items-center gap-2">
            <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: hs.color + "22", color: hs.color }}>{hs.ar} · {h.health_score}/100</span>
            <button onClick={() => void load()} className="text-xs text-stone-500 hover:text-white" aria-label="refresh">↻</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {[["مخاطر حرجة", h.counts.critical_risks, "#dc2626"], ["مشكلات حرجة", h.counts.critical_issues, "#dc2626"], ["اعتمادات متأخرة", h.counts.overdue_approvals, "#d97706"], ["تغييرات معلّقة", h.counts.pending_changes, "#0891b2"], ["قرارات للمراجعة", h.counts.stale_decisions, "#0284c7"], ["افتراضات غير مؤكّدة", h.counts.expired_assumptions, "#78716c"]].map(([lbl, n, c], i) => (
            <span key={i} className="px-2 py-0.5 rounded border border-stone-800" style={{ color: (n as number) > 0 ? (c as string) : "#78716c" }}>{lbl as string}: <b>{n as number}</b></span>
          ))}
        </div>
        {h.reasons.map((r, i) => <p key={i} className="text-[10px] text-stone-500">· {r.ar}</p>)}
        {/* بوابة المرحلة */}
        {d.stage_gate.blocked && (
          <div className="border-t border-stone-800 pt-2">
            <p className="text-[11px] text-amber-300">{t({ ar: "بوابة المرحلة", en: "Stage gate" })} ({d.stage_gate.stage_gate_mode}): {d.stage_gate.note_ar}</p>
            {d.stage_gate.gate_blockers.map((b, i) => <p key={i} className="text-[10px] text-amber-400/80">· {b.ar}</p>)}
          </div>
        )}
      </section>

      {/* الاعتمادات المعلّقة */}
      <section className="space-y-1">
        <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "اعتمادات معلّقة", en: "Pending approvals" })} ({d.pending_approvals.length})</h4>
        {d.pending_approvals.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا اعتمادات معلّقة.", en: "None pending." })}</p>}
        {d.pending_approvals.map((a) => (
          <div key={a.id} className="flex items-center gap-2 text-[11px] border border-stone-800 rounded-lg px-2.5 py-1.5 bg-stone-950 flex-wrap">
            <span className="text-stone-200">{a.title ?? a.approval_type}</span>
            <span className="text-stone-500">{a.approval_type}</span>
            {a.overdue && <span className="text-red-400">{t({ ar: "متأخر", en: "overdue" })}</span>}
            {canManage && <span className="flex items-center gap-2 ms-auto">
              <button disabled={busy} onClick={() => void decide(a.id, "approve")} className="text-green-400 hover:text-green-300">{t({ ar: "اعتماد", en: "Approve" })}</button>
              <button disabled={busy} onClick={() => void decide(a.id, "request_changes")} className="text-amber-400 hover:text-amber-300">{t({ ar: "طلب تعديل", en: "Changes" })}</button>
              <button disabled={busy} onClick={() => void decide(a.id, "reject")} className="text-red-400 hover:text-red-300">{t({ ar: "رفض", en: "Reject" })}</button>
            </span>}
          </div>
        ))}
      </section>

      {/* المخاطر + Matrix */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-stone-300">{t({ ar: "سجل المخاطر", en: "Risk register" })} ({d.risks.length})</h4>
          {canManage && <button onClick={() => setShowRiskForm((s) => !s)} className="text-[11px] text-sky-300 border border-sky-800 rounded px-2 py-1">{t({ ar: "مخاطرة جديدة", en: "New risk" })}</button>}
        </div>
        {showRiskForm && <RiskForm projectId={projectId} flash={flash} onDone={() => { setShowRiskForm(false); void load(); }} />}
        <RiskMatrix matrix={d.risk_matrix} active={matrixCell} onCell={(c) => setMatrixCell(matrixCell === c ? null : c)} />
        {matrixCell && <p className="text-[10px] text-sky-400">{t({ ar: "مُصفّى على الخلية", en: "Filtered:" })} {matrixCell} <button onClick={() => setMatrixCell(null)} className="underline">✕</button></p>}
        <div className="space-y-1">
          {filteredRisks.map((r) => {
            const sv = RISK_SEV[r.severity];
            return (
              <div key={r.id} className="flex items-center gap-2 text-[11px] border-b border-stone-900 py-1 flex-wrap">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: sv.color }} />
                <span className="text-stone-200 truncate max-w-[220px]" dir="auto">{r.title}</span>
                <span className="text-stone-500">{r.category}</span>
                <span style={{ color: sv.color }}>{sv.ar} ({r.probability}×{r.impact}={r.risk_score})</span>
                <span className="text-stone-500">{r.status}</span>
                {r.client_visible && <span className="text-[8px] text-sky-400">👁 عميل</span>}
                {canManage && r.status !== "occurred" && <button onClick={() => void convertRisk(r.id)} className="text-orange-400 hover:text-orange-300 ms-auto">{t({ ar: "→ مشكلة", en: "→ issue" })}</button>}
              </div>
            );
          })}
          {filteredRisks.length === 0 && <p className="text-[11px] text-stone-500">{t({ ar: "لا مخاطر.", en: "No risks." })}</p>}
        </div>
      </section>

      {/* المشكلات / القرارات / التغييرات — قوائم مضغوطة + إضافة سريعة */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Register title={t({ ar: "المشكلات", en: "Issues" })} items={d.issues.map((i) => ({ id: i.id, label: i.title, sub: `${RISK_SEV[i.severity]?.ar ?? i.severity} · ${i.status}` }))} canAdd={canManage} onAdd={() => void quickAdd("issue")} />
        <Register title={t({ ar: "القرارات", en: "Decisions" })} items={d.decisions.map((x) => ({ id: x.id, label: x.title, sub: x.status }))} canAdd={canManage} onAdd={() => void quickAdd("decision")} />
        <Register title={t({ ar: "طلبات التغيير", en: "Changes" })} items={d.change_requests.map((c) => ({ id: c.id, label: `${c.request_no ?? ""} ${c.title}`, sub: `${c.change_type} · ${c.status}` }))} canAdd={canManage} onAdd={() => void quickAdd("change")} />
      </div>
      <p className="text-[9px] text-stone-600">{t({ ar: "بيانات حية عبر project_governance_dashboard. العميل لا يرى الحوكمة الداخلية.", en: "Live governance data; client sees nothing internal." })}</p>
    </div>
  );
}

function Register({ title, items, canAdd, onAdd }: { title: string; items: { id: string; label: string; sub: string }[]; canAdd: boolean; onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <section className="border border-stone-800 rounded-xl p-2 bg-stone-950 space-y-1">
      <div className="flex items-center justify-between"><h5 className="text-[11px] font-semibold text-stone-300">{title} ({items.length})</h5>
        {canAdd && <button onClick={onAdd} className="text-[10px] text-sky-400 hover:text-sky-300">+ {t({ ar: "إضافة", en: "Add" })}</button>}</div>
      {items.length === 0 && <p className="text-[10px] text-stone-600">{t({ ar: "لا عناصر.", en: "None." })}</p>}
      {items.slice(0, 8).map((i) => <div key={i.id} className="text-[10px] border-b border-stone-900 py-0.5"><span className="text-stone-300 block truncate" dir="auto">{i.label}</span><span className="text-stone-600">{i.sub}</span></div>)}
    </section>
  );
}

function RiskMatrix({ matrix, active, onCell }: { matrix: Record<string, number>; active: string | null; onCell: (cell: string) => void }) {
  const { t } = useI18n();
  const scoreColor = (p: number, i: number) => { const s = p * i; return s >= 20 ? "#dc2626" : s >= 12 ? "#d97706" : s >= 5 ? "#0284c7" : "#16a34a"; };
  return (
    <div className="overflow-x-auto">
      <table className="text-[9px] border-collapse" role="grid" aria-label={t({ ar: "مصفوفة المخاطر", en: "Risk matrix" })}>
        <tbody>
          {[5, 4, 3, 2, 1].map((imp) => (
            <tr key={imp}>
              <th className="text-stone-500 pe-1 text-end w-6">{imp}</th>
              {[1, 2, 3, 4, 5].map((prob) => {
                const cell = `${prob}x${imp}`, cnt = matrix[cell] ?? 0, col = scoreColor(prob, imp);
                return (
                  <td key={prob} className="p-0">
                    <button onClick={() => onCell(cell)} title={`${t({ ar: "احتمالية", en: "P" })} ${prob} × ${t({ ar: "أثر", en: "I" })} ${imp} = ${prob * imp}`}
                      className={`w-9 h-8 flex items-center justify-center border ${active === cell ? "ring-2 ring-white" : "border-stone-800"}`}
                      style={{ background: col + (cnt > 0 ? "44" : "11"), color: cnt > 0 ? "#fff" : "#57534e" }}>
                      {cnt > 0 ? cnt : "·"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
          <tr><th></th>{[1, 2, 3, 4, 5].map((p) => <td key={p} className="text-center text-stone-500">{p}</td>)}</tr>
        </tbody>
      </table>
      <p className="text-[8px] text-stone-600 mt-0.5">{t({ ar: "الصفوف: الأثر ↑ · الأعمدة: الاحتمالية → · الرقم = عدد المخاطر", en: "Rows: impact · Cols: probability · number = risk count" })}</p>
    </div>
  );
}

function RiskForm({ projectId, flash, onDone }: { projectId: string; flash: (m: string) => void; onDone: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(""); const [category, setCategory] = useState("operational");
  const [probability, setProbability] = useState(3); const [impact, setImpact] = useState(3);
  const [response, setResponse] = useState("mitigate"); const [clientVisible, setClientVisible] = useState(false); const [saving, setSaving] = useState(false);
  async function save() {
    if (!title.trim()) { flash(t({ ar: "العنوان مطلوب.", en: "Title required." })); return; }
    setSaving(true);
    const r = await pcRiskUpsert(projectId, { title, category, probability, impact, response_strategy: response, client_visible: clientVisible });
    setSaving(false);
    if (!r.ok) { flash(govErr(r.error)); return; } onDone();
  }
  return (
    <section className="border border-sky-900/50 bg-sky-950/10 rounded-xl p-3 space-y-2 text-xs">
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t({ ar: "عنوان المخاطرة", en: "Risk title" })} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" dir="auto" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الفئة", en: "Category" })}</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }}>
            {["schedule", "resource", "equipment", "technical", "quality", "client", "financial_reference", "legal", "safety", "operational", "supplier", "reputation", "other"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الاحتمالية 1-5", en: "Probability" })}</span>
          <input type="number" min={1} max={5} value={probability} onChange={(e) => setProbability(Math.min(5, Math.max(1, Number(e.target.value) || 3)))} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" /></label>
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الأثر 1-5", en: "Impact" })}</span>
          <input type="number" min={1} max={5} value={impact} onChange={(e) => setImpact(Math.min(5, Math.max(1, Number(e.target.value) || 3)))} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" /></label>
        <label className="space-y-1"><span className="text-stone-500">{t({ ar: "الاستجابة", en: "Response" })}</span>
          <select value={response} onChange={(e) => setResponse(e.target.value)} className="w-full bg-stone-900 border border-stone-700 rounded px-2 py-1 text-stone-200" style={{ colorScheme: "dark" }}>
            {["avoid", "mitigate", "transfer", "accept", "exploit", "enhance"].map((c) => <option key={c} value={c}>{c}</option>)}
          </select></label>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-stone-500">{t({ ar: "الدرجة", en: "Score" })}: <b style={{ color: (probability * impact) >= 20 ? "#dc2626" : (probability * impact) >= 12 ? "#d97706" : "#0284c7" }}>{probability * impact}</b></span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={clientVisible} onChange={(e) => setClientVisible(e.target.checked)} /><span className="text-stone-400">{t({ ar: "مرئي للعميل", en: "Client-visible" })}</span></label>
        <button disabled={saving} onClick={() => void save()} className="bg-sky-700 text-white rounded px-3 py-1 disabled:opacity-50">{t({ ar: "حفظ", en: "Save" })}</button>
      </div>
    </section>
  );
}
