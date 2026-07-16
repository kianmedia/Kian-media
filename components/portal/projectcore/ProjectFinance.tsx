"use client";
// ════════════════════════════════════════════════════════════════════════════
// Project Core — حسابات المشروع (Batch 5). للأدوار المالية فقط (المالك/المالية/محاسب
// المشروع) — RLS + RPC تفرضان العزل؛ هذه دفاع طبقة إضافية. أرقام dir=ltr.
// ملخّص + تنبيهات + المصروفات (دورة اعتماد) + ميزانيات المراحل + الإيرادات + الإعدادات.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePortal } from "@/components/portal/PortalShell";
import {
  pcFinanceSummary, pcFinanceSettings, pcFinanceSettingsSet, pcFinanceAssignAccountant, pcListFinanceStaff,
  pcListExpenses, pcExpenseCreate, pcExpenseTransition, pcExpenseDelete, pcListPhaseBudgets, pcPhaseBudgetUpsert,
  pcListRevenue, pcRevenueUpsert, pcListFinAlerts, pcFinAlertsRecompute, pcErr, EXPENSE_STATUS_LABELS,
  pcFinanceReport, pcFinanceClosureChecklist, pcFinanceClose, pcFinanceReopen, pcExpenseRefund,
  type FinanceSummary, type FinanceSettings, type ProjectExpense, type PhaseBudget, type RevenueRow, type FinAlert, type StaffLite,
  type FinanceReport, type ClosureChecklist,
} from "@/lib/portal/projectCore";

const card = "bg-stone-900 border border-stone-800 rounded-xl";
const inp = "bg-stone-800 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-red-500";
const btnRed = "rounded-lg bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium";
const btnGhost = "rounded-lg bg-stone-800 border border-stone-700 text-stone-200 text-sm disabled:opacity-50";
const money = (n: number | null | undefined, cur = "SAR") => `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Math.round(n ?? 0))} ${cur}`;

export function FinanceTab({ projectId, flash }: { projectId: string; flash: (m: string) => void }) {
  const { t } = useI18n();
  const { profile, caps } = usePortal();
  const isFinance = caps.isOwner || profile.staff_role === "finance";
  const canAdmin = caps.isOwner || profile.staff_role === "finance";  // تعديل الإعدادات المالية العليا
  const [sum, setSum] = useState<FinanceSummary | null>(null);
  const [alerts, setAlerts] = useState<FinAlert[]>([]);
  const [sub, setSub] = useState<"expenses" | "budgets" | "revenue" | "report" | "closure" | "settings">("expenses");
  const [phase, setPhase] = useState<"loading" | "ready" | "denied">("loading");

  const loadTop = useCallback(async () => {
    const [s, a] = await Promise.all([pcFinanceSummary(projectId), pcListFinAlerts(projectId)]);
    if (!s.ok) { if (/not authorized/i.test(s.error)) { setPhase("denied"); return; } flash(pcErr(s.error)); }
    else setSum(s.data);
    if (a.ok) setAlerts(a.data);
    setPhase("ready");
  }, [projectId, flash]);
  useEffect(() => { void loadTop(); }, [loadTop]);

  async function recompute() { const r = await pcFinAlertsRecompute(projectId); if (!r.ok) { flash(pcErr(r.error)); return; } await loadTop(); }

  if (!isFinance) return <p className="text-xs text-stone-500">{t({ ar: "حسابات المشروع متاحة للأدوار المالية فقط.", en: "Project accounts are finance-only." })}</p>;
  if (phase === "loading") return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  if (phase === "denied") return <p className="text-xs text-stone-500">{t({ ar: "لا تملك صلاحية عرض حسابات هذا المشروع.", en: "No finance access to this project." })}</p>;

  const cur = sum?.currency ?? "SAR";
  const cards = sum ? [
    { ar: "قيمة المشروع (صافي)", v: money(sum.net_revenue, cur) },
    { ar: "الميزانية المعتمدة", v: money(sum.approved_budget, cur) },
    { ar: "التكلفة الفعلية", v: money(sum.actual_cost, cur), cls: "text-amber-400" },
    { ar: "الالتزامات", v: money(sum.committed_cost, cur) },
    { ar: "المتبقي من الميزانية", v: money(sum.remaining_budget, cur), cls: sum.remaining_budget < 0 ? "text-red-400" : "text-emerald-400" },
    { ar: "استهلاك الميزانية", v: `${sum.budget_used_pct}%`, cls: sum.budget_used_pct >= 100 ? "text-red-400" : sum.budget_used_pct >= 80 ? "text-amber-400" : "text-stone-300" },
    { ar: "المحصّل", v: money(sum.collected, cur), cls: "text-emerald-400" },
    { ar: "المستحق على العميل", v: money(sum.receivable, cur), cls: "text-sky-400" },
    { ar: "الربح الفعلي", v: money(sum.actual_profit, cur), cls: sum.actual_profit < 0 ? "text-red-400" : "text-emerald-400" },
    { ar: "الربح المتوقع", v: money(sum.projected_profit, cur), cls: sum.projected_profit < 0 ? "text-red-400" : "text-emerald-400" },
    { ar: "هامش الربح الفعلي", v: `${sum.actual_margin_pct}%`, cls: sum.actual_margin_pct < 0 ? "text-red-400" : "text-stone-300" },
    { ar: "هامش الربح المتوقع", v: `${sum.projected_margin_pct}%`, cls: sum.projected_margin_pct < sum.target_margin_pct ? "text-amber-400" : "text-emerald-400" },
  ] : [];

  return (
    <div className="space-y-4">
      {sum?.projected_loss && <div className="bg-red-950/50 border border-red-900 rounded-lg p-3 text-sm text-red-300">⚠ {t({ ar: "المشروع متوقع أن يحقق خسارة.", en: "Projected loss." })}</div>}
      {alerts.length > 0 && (
        <div className="space-y-1.5">
          {alerts.map((a) => <div key={a.id} className={`${card} p-2.5 text-xs flex items-center gap-2 ${a.level === "critical" ? "border-red-900/60" : a.level === "warning" ? "border-amber-900/50" : ""}`}>
            <span className={a.level === "critical" ? "text-red-400" : a.level === "warning" ? "text-amber-400" : "text-sky-400"}>●</span>
            <span className="text-stone-200 flex-1">{a.message}</span>{a.pct != null && <span className="text-stone-500" dir="ltr">{a.pct}%</span>}</div>)}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {cards.map((c, i) => <div key={i} className={`${card} p-2.5`}><div className={`text-sm font-bold ${c.cls ?? "text-stone-200"}`} dir="ltr">{c.v}</div><div className="text-[10px] text-stone-500">{c.ar}</div></div>)}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">{(["expenses", "budgets", "revenue", "report", "closure", "settings"] as const).map((k) => <button key={k} onClick={() => setSub(k)} className={`px-2.5 py-1 rounded-lg text-[11px] ${sub === k ? "bg-red-600 text-white" : "bg-stone-800 border border-stone-700 text-stone-300"}`}>{t(k === "expenses" ? { ar: "المصروفات", en: "Expenses" } : k === "budgets" ? { ar: "ميزانيات المراحل", en: "Phase Budgets" } : k === "revenue" ? { ar: "الإيرادات", en: "Revenue" } : k === "report" ? { ar: "التقارير", en: "Reports" } : k === "closure" ? { ar: "الإغلاق المالي", en: "Closure" } : { ar: "الإعدادات", en: "Settings" })}</button>)}</div>
        <button onClick={() => void recompute()} className="text-[11px] text-stone-400 hover:text-white">↻ {t({ ar: "تحديث التنبيهات", en: "Refresh alerts" })}</button>
      </div>
      {sub === "expenses" && <ExpensesSection projectId={projectId} settings={sum} onChanged={loadTop} flash={flash} />}
      {sub === "budgets" && <BudgetsSection projectId={projectId} canEdit={canAdmin} onChanged={loadTop} flash={flash} />}
      {sub === "revenue" && <RevenueSection projectId={projectId} onChanged={loadTop} flash={flash} />}
      {sub === "report" && <FinReportSection projectId={projectId} flash={flash} />}
      {sub === "closure" && <FinClosureSection projectId={projectId} isOwner={caps.isOwner} onChanged={loadTop} flash={flash} />}
      {sub === "settings" && <SettingsSection projectId={projectId} canAdmin={canAdmin} isOwner={caps.isOwner} onChanged={loadTop} flash={flash} />}
    </div>
  );
}

function ExpensesSection({ projectId, settings, onChanged, flash }: { projectId: string; settings: FinanceSummary | null; onChanged: () => Promise<void>; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<ProjectExpense[]>([]);
  const [f, setF] = useState({ description: "", amount_excl_vat: "", category: "other", supplier: "", phase: "" });
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListExpenses(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  const cur = settings?.currency ?? "SAR";
  const CATS = ["crew", "freelancer", "equipment", "rental", "studio", "drone", "permits", "travel", "hospitality", "supplier", "post", "music", "storage", "shipping", "insurance", "admin", "other"];
  async function add() { if (busy || !f.amount_excl_vat) return; setBusy(true); const r = await pcExpenseCreate(projectId, { description: f.description.trim() || undefined, amount_excl_vat: f.amount_excl_vat, category: f.category, supplier: f.supplier.trim() || undefined, phase: f.phase.trim() || undefined }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setF({ description: "", amount_excl_vat: "", category: "other", supplier: "", phase: "" }); await load(); await onChanged(); }
  async function tr(x: ProjectExpense, action: string) {
    let reason: string | undefined, override = false;
    if (action === "reject") { const p = window.prompt(t({ ar: "سبب الرفض (إلزامي):", en: "Reject reason:" })); if (p === null) return; if (!p.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; } reason = p.trim(); }
    if (action === "pay") { const p = window.prompt(t({ ar: "طريقة الدفع (اختياري):", en: "Payment method:" })); if (p === null) return; reason = p.trim() || undefined; }
    const r = await pcExpenseTransition(x.id, action, reason, override);
    if (!r.ok) {
      if (/over_budget|override_required/.test(r.error) && action === "approve") {
        if (!window.confirm(t({ ar: "الاعتماد يتجاوز الميزانية. المتابعة (المالك فقط)؟", en: "Exceeds budget. Continue (owner only)?" }))) return;
        const rs = window.prompt(t({ ar: "سبب التجاوز (إلزامي):", en: "Override reason:" })); if (!rs || !rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
        const r2 = await pcExpenseTransition(x.id, "approve", rs.trim(), true); if (!r2.ok) { flash(pcErr(r2.error)); return; }
      } else { flash(pcErr(r.error)); return; }
    }
    await load(); await onChanged();
  }
  async function del(x: ProjectExpense) { const p = window.prompt(t({ ar: "سبب الحذف (إلزامي):", en: "Delete reason:" })); if (!p || !p.trim()) return; const r = await pcExpenseDelete(x.id, p.trim()); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); await onChanged(); }
  const actionsFor = (st: string): { a: string; ar: string; en: string }[] => st === "draft" ? [{ a: "submit", ar: "تقديم", en: "Submit" }]
    : st === "submitted" ? [{ a: "review", ar: "مراجعة", en: "Review" }, { a: "approve", ar: "اعتماد", en: "Approve" }, { a: "reject", ar: "رفض", en: "Reject" }]
    : st === "under_review" ? [{ a: "approve", ar: "اعتماد", en: "Approve" }, { a: "reject", ar: "رفض", en: "Reject" }]
    : st === "approved" || st === "scheduled_for_payment" ? [{ a: "pay", ar: "دفع", en: "Pay" }] : [];
  // استرداد مصروف مدفوع (Reversal) — يبقى متاحًا حتى بعد الإغلاق المالي.
  async function refund(x: ProjectExpense) {
    const p = window.prompt(t({ ar: `استرداد «${x.description ?? x.category}» — السبب (إلزامي):`, en: "Refund reason:" }));
    if (p === null) return; if (!p.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    const r = await pcExpenseRefund(x.id, p.trim());
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "سُجّل الاسترداد.", en: "Refunded." })); await load(); await onChanged();
  }
  return (
    <div className="space-y-3">
      <div className={`${card} p-3 space-y-2`}>
        <div className="flex flex-wrap gap-2">
          <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder={t({ ar: "وصف المصروف", en: "Description" })} className={`${inp} flex-1 min-w-[140px]`} />
          <input type="number" min={0} value={f.amount_excl_vat} onChange={(e) => setF({ ...f, amount_excl_vat: e.target.value })} placeholder={t({ ar: "المبلغ قبل الضريبة", en: "Amount (excl VAT)" })} className={`${inp} w-32`} />
        </div>
        <div className="flex flex-wrap gap-2 items-end">
          <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inp} style={{ colorScheme: "dark" }}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} placeholder={t({ ar: "المورد", en: "Supplier" })} className={`${inp} flex-1 min-w-[100px]`} />
          <input value={f.phase} onChange={(e) => setF({ ...f, phase: e.target.value })} placeholder={t({ ar: "المرحلة", en: "Phase" })} className={`${inp} w-28`} />
          <button disabled={busy || !f.amount_excl_vat} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
        </div>
      </div>
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا مصروفات.", en: "No expenses." })}</p>}
      {rows.map((x) => (
        <div key={x.id} className={`${card} p-2.5 text-xs`}>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0"><span className="text-stone-200" dir="ltr">{money(x.amount_incl_vat, cur)}</span><span className="mr-2 text-stone-500">· {x.category}{x.description ? ` · ${x.description}` : ""}{x.supplier ? ` · ${x.supplier}` : ""}</span></div>
            <span className={`px-1.5 py-0.5 rounded text-[10px] shrink-0 ${x.status === "paid" ? "bg-emerald-900/40 text-emerald-300" : x.status === "rejected" || x.status === "voided" ? "bg-red-900/40 text-red-300" : x.status === "approved" ? "bg-sky-900/40 text-sky-300" : "bg-amber-900/40 text-amber-300"}`}>{t(EXPENSE_STATUS_LABELS[x.status] ?? { ar: x.status, en: x.status })}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-stone-600" dir="ltr">{x.expense_date}{x.phase ? ` · ${x.phase}` : ""}</span>
            <div className="flex-1" />
            {actionsFor(x.status).map((ac) => <button key={ac.a} onClick={() => void tr(x, ac.a)} className={`${ac.a === "reject" ? "text-red-400" : ac.a === "approve" || ac.a === "pay" ? "text-emerald-400" : "text-sky-400"} text-[11px]`}>{t({ ar: ac.ar, en: ac.en })}</button>)}
            {x.status === "paid" && <button onClick={() => void refund(x)} className="text-amber-400 text-[11px]">{t({ ar: "استرداد", en: "Refund" })}</button>}
            {x.status !== "paid" && <button onClick={() => void del(x)} className="text-stone-600 hover:text-red-400 text-[11px]">{t({ ar: "حذف", en: "Del" })}</button>}
          </div>
          {x.reject_reason && <div className="text-[10px] text-red-400 mt-0.5">{x.reject_reason}</div>}
        </div>
      ))}
    </div>
  );
}

function BudgetsSection({ projectId, canEdit, onChanged, flash }: { projectId: string; canEdit: boolean; onChanged: () => Promise<void>; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<PhaseBudget[]>([]);
  const [phase, setPhase] = useState(""); const [amt, setAmt] = useState(""); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListPhaseBudgets(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function add() { if (busy || !phase.trim()) return; setBusy(true); const r = await pcPhaseBudgetUpsert(projectId, phase.trim(), Number(amt || 0)); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setPhase(""); setAmt(""); await load(); await onChanged(); }
  const total = rows.reduce((s, r) => s + Number(r.allocated), 0);
  return (
    <div className="space-y-2">
      {canEdit && <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
        <input value={phase} onChange={(e) => setPhase(e.target.value)} placeholder={t({ ar: "المرحلة", en: "Phase" })} className={`${inp} flex-1 min-w-[120px]`} />
        <input type="number" min={0} value={amt} onChange={(e) => setAmt(e.target.value)} placeholder={t({ ar: "المبلغ", en: "Amount" })} className={`${inp} w-32`} />
        <button disabled={busy || !phase.trim()} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "حفظ", en: "Save" })}</button>
      </div>}
      <div className={`${card} p-3 flex items-center justify-between text-xs`}><span className="text-stone-400">{t({ ar: "إجمالي توزيع المراحل", en: "Total allocated" })}</span><span className="text-stone-200 font-bold" dir="ltr">{money(total)}</span></div>
      {rows.map((r) => <div key={r.id} className={`${card} p-2.5 text-xs flex items-center justify-between`}><span className="text-stone-200">{r.phase}</span><span className="text-stone-300" dir="ltr">{money(Number(r.allocated))}</span></div>)}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا ميزانيات مراحل.", en: "No phase budgets." })}</p>}
    </div>
  );
}

function RevenueSection({ projectId, onChanged, flash }: { projectId: string; onChanged: () => Promise<void>; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [rows, setRows] = useState<RevenueRow[]>([]);
  const [f, setF] = useState({ name: "", amount_excl_vat: "", due_date: "" }); const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const r = await pcListRevenue(projectId); if (r.ok) setRows(r.data); }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function add() { if (busy || !f.name.trim() || !f.amount_excl_vat) return; setBusy(true); const r = await pcRevenueUpsert(projectId, { name: f.name.trim(), amount_excl_vat: f.amount_excl_vat, due_date: f.due_date || undefined }); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } setF({ name: "", amount_excl_vat: "", due_date: "" }); await load(); await onChanged(); }
  async function collect(x: RevenueRow) { const p = window.prompt(t({ ar: "المبلغ المحصّل:", en: "Collected amount:" }), String(x.amount_incl_vat)); if (p === null) return; const r = await pcRevenueUpsert(projectId, { id: x.id, collected_amount: p, collected_date: new Date().toISOString().slice(0, 10), status: "paid" }); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); await onChanged(); }
  const REV_LBL: Record<string, string> = { planned: "مخطّطة", invoice_pending: "بانتظار فاتورة", invoiced: "مفوترة", partially_paid: "محصّلة جزئيًا", paid: "محصّلة", overdue: "متأخرة", cancelled: "ملغاة", refunded: "مستردة" };
  return (
    <div className="space-y-2">
      <div className={`${card} p-3 flex flex-wrap gap-2 items-end`}>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={t({ ar: "اسم الدفعة", en: "Payment name" })} className={`${inp} flex-1 min-w-[120px]`} />
        <input type="number" min={0} value={f.amount_excl_vat} onChange={(e) => setF({ ...f, amount_excl_vat: e.target.value })} placeholder={t({ ar: "المبلغ قبل الضريبة", en: "Amount" })} className={`${inp} w-32`} />
        <input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} className={inp} style={{ colorScheme: "dark" }} />
        <button disabled={busy || !f.name.trim() || !f.amount_excl_vat} onClick={() => void add()} className={`${btnRed} px-4 py-2`}>{t({ ar: "إضافة", en: "Add" })}</button>
      </div>
      {rows.map((x) => (
        <div key={x.id} className={`${card} p-2.5 text-xs flex items-center justify-between gap-2`}>
          <div className="min-w-0"><span className="text-stone-200">{x.name}</span><span className="mr-2 text-stone-500" dir="ltr">{money(Number(x.amount_incl_vat))}</span>{x.due_date && <span className="text-stone-600" dir="ltr">· {x.due_date}</span>}</div>
          <div className="flex items-center gap-2 shrink-0"><span className={`text-[10px] ${x.status === "paid" ? "text-emerald-400" : x.status === "overdue" ? "text-red-400" : "text-amber-400"}`}>{REV_LBL[x.status] ?? x.status}</span>{x.status !== "paid" && <button onClick={() => void collect(x)} className="text-emerald-400 text-[11px]">{t({ ar: "تحصيل", en: "Collect" })}</button>}</div>
        </div>
      ))}
      {rows.length === 0 && <p className="text-xs text-stone-500">{t({ ar: "لا دفعات.", en: "No payments." })}</p>}
    </div>
  );
}

// حقل بمستوى الوحدة (هوية ثابتة) — لتفادي فقدان التركيز أثناء الكتابة.
function FinRow({ f, setk, k, ar, disabled }: { f: Record<string, string>; setk: (k: string, v: string) => void; k: string; ar: string; disabled?: boolean }) {
  return <label className="block"><span className="text-[10px] text-stone-500">{ar}</span><input type="number" min={0} disabled={disabled} value={f[k] ?? ""} onChange={(e) => setk(k, e.target.value)} className="bg-stone-800 border border-stone-700 rounded-lg px-2.5 py-1.5 text-sm text-stone-200 w-full mt-0.5 focus:outline-none focus:ring-2 focus:ring-red-500" /></label>;
}

function SettingsSection({ projectId, canAdmin, isOwner, onChanged, flash }: { projectId: string; canAdmin: boolean; isOwner: boolean; onChanged: () => Promise<void>; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [s, setS] = useState<FinanceSettings | null>(null);
  const [staff, setStaff] = useState<StaffLite[]>([]);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [r, st] = await Promise.all([pcFinanceSettings(projectId), pcListFinanceStaff()]);
    if (r.ok) { setS(r.data); const d = r.data; setF({ contract_value_excl_vat: String(d?.contract_value_excl_vat ?? ""), discount: String(d?.discount ?? ""), vat_rate: String(d?.vat_rate ?? 15), approved_budget: String(d?.approved_budget ?? ""), estimated_remaining_cost: String(d?.estimated_remaining_cost ?? ""), target_margin_pct: String(d?.target_margin_pct ?? 25), approve_limit_accountant: String(d?.approve_limit_accountant ?? ""), approve_limit_admin: String(d?.approve_limit_admin ?? "") }); }
    if (st.ok) setStaff(st.data);
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  async function save() { if (busy) return; setBusy(true); const r = await pcFinanceSettingsSet(projectId, f); setBusy(false); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); await onChanged(); flash(t({ ar: "تم الحفظ.", en: "Saved." })); }
  async function assign(uid: string) { const r = await pcFinanceAssignAccountant(projectId, uid || null); if (!r.ok) { flash(pcErr(r.error)); return; } await load(); await onChanged(); }
  const setk = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3">
      <div className={`${card} p-3`}>
        <span className="text-[10px] text-stone-500">{t({ ar: "محاسب المشروع (قسم المالية)", en: "Project accountant" })}</span>
        <select disabled={!canAdmin} value={s?.accountant_id ?? ""} onChange={(e) => void assign(e.target.value)} className={`${inp} w-full mt-0.5`} style={{ colorScheme: "dark" }}>
          <option value="">{t({ ar: "— بدون —", en: "— none —" })}</option>
          {staff.map((x) => <option key={x.id} value={x.id}>{x.full_name || x.id.slice(0, 8)}</option>)}
        </select>
      </div>
      <div className={`${card} p-3 grid grid-cols-2 gap-2`}>
        <FinRow f={f} setk={setk} k="contract_value_excl_vat" ar="قيمة المشروع (قبل الضريبة)" disabled={!canAdmin} />
        <FinRow f={f} setk={setk} k="discount" ar="الخصم" disabled={!canAdmin} />
        <FinRow f={f} setk={setk} k="vat_rate" ar="نسبة الضريبة %" disabled={!canAdmin} />
        <FinRow f={f} setk={setk} k="approved_budget" ar="الميزانية المعتمدة" disabled={!canAdmin} />
        <FinRow f={f} setk={setk} k="estimated_remaining_cost" ar="التكلفة المتبقية المقدّرة" />
        <FinRow f={f} setk={setk} k="target_margin_pct" ar="هامش الربح المستهدف %" disabled={!canAdmin} />
        <FinRow f={f} setk={setk} k="approve_limit_accountant" ar="حدّ اعتماد المحاسب" disabled={!isOwner} />
        <FinRow f={f} setk={setk} k="approve_limit_admin" ar="حدّ اعتماد الأدمن" disabled={!isOwner} />
      </div>
      <button disabled={busy} onClick={() => void save()} className={`${btnRed} px-4 py-2`}>{t({ ar: "حفظ الإعدادات", en: "Save settings" })}</button>
    </div>
  );
}

// ─── التقارير المالية: ربحية/ميزانية/فئات/موردون/تحصيل/تدفق شهري + طباعة وCSV ───
function csvDownload(name: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\n");   // BOM ليفتح عربيًا في Excel
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `${name}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
const FIN_PRINT_CSS = `@page { size: A4; margin: 16mm 14mm 20mm 14mm; }
@media print { body * { visibility: hidden !important; } #fin-report-print, #fin-report-print * { visibility: visible !important; } #fin-report-print { position: absolute; top: 0; left: 0; right: 0; background: #fff !important; color: #111 !important; padding: 16px; } #fin-report-print .no-print { display: none !important; }
#fin-report-print table { width: 100%; border-collapse: collapse; font-size: 11px; } #fin-report-print th, #fin-report-print td { border: 1px solid #ddd; padding: 3px 6px; text-align: right; color: #111; } #fin-report-print h4 { color: #E31E24; margin: 10px 0 4px; } }`;

function FinReportSection({ projectId, flash }: { projectId: string; flash: (m: string) => void }) {
  const { t } = useI18n();
  const { profile } = usePortal();
  const [rep, setRep] = useState<FinanceReport | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    const r = await pcFinanceReport(projectId);
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    setRep(r.data);
  }, [projectId, flash]);
  useEffect(() => { void load(); }, [load]);
  if (busy && !rep) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ تجهيز التقرير…", en: "Loading…" })}</p>;
  if (!rep) return <p className="text-xs text-stone-500">{t({ ar: "تعذّر تحميل التقرير.", en: "Failed." })}</p>;
  const cur = rep.summary.currency;
  const Th = ({ c }: { c: string[] }) => <thead><tr className="text-stone-500 border-b border-stone-800">{c.map((x) => <th key={x} className="p-1.5 text-right">{x}</th>)}</tr></thead>;
  const exportAll = () => {
    csvDownload(`finance-report`, [
      ["التقرير المالي", "", ""], ["", "", ""],
      ["الملخص", "", ""],
      ["قيمة المشروع (صافي)", rep.summary.net_revenue, cur], ["الميزانية المعتمدة", rep.summary.approved_budget, cur],
      ["التكلفة الفعلية", rep.summary.actual_cost, cur], ["الالتزامات", rep.summary.committed_cost, cur],
      ["المحصّل", rep.summary.collected, cur], ["المستحق", rep.summary.receivable, cur],
      ["الربح الفعلي", rep.summary.actual_profit, cur], ["الربح المتوقع", rep.summary.projected_profit, cur],
      ["", "", ""], ["حسب الفئة", "التكلفة المدفوعة", "الالتزامات"],
      ...rep.by_category.map((x) => [x.category, x.cost ?? 0, x.committed ?? 0]),
      ["", "", ""], ["حسب المورد", "التكلفة", "عدد"],
      ...rep.by_supplier.map((x) => [x.supplier, x.cost, x.count]),
      ["", "", ""], ["المرحلة", "المخصص", "المصروف"],
      ...rep.by_phase.map((x) => [x.phase, x.allocated, x.spent]),
      ["", "", ""], ["الدفعة", "المبلغ", "المحصّل"],
      ...rep.revenue.map((x) => [x.name, x.amount_incl_vat, x.collected]),
      ["", "", ""], ["الشهر", "مدفوعات صادرة", "تحصيل وارد"],
      ...rep.cashflow_monthly.map((x) => [x.month, x.paid_out, x.collected_in]),
    ]);
  };
  return (
    <div className="space-y-3" id="fin-report-print">
      <style dangerouslySetInnerHTML={{ __html: FIN_PRINT_CSS }} />
      <div className="flex gap-2 no-print">
        <button onClick={() => window.print()} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "طباعة / PDF", en: "Print / PDF" })}</button>
        <button onClick={exportAll} className={`${btnGhost} px-3 py-1.5 text-xs`}>{t({ ar: "تصدير CSV (Excel)", en: "CSV" })}</button>
        <button onClick={() => void load()} className={`${btnGhost} px-3 py-1.5 text-xs`}>↻</button>
      </div>
      <div className="hidden print:block" style={{ fontSize: 12 }}>
        <b style={{ color: "#E31E24" }}>كيان ميديا · التقرير المالي للمشروع</b>
        <div dir="ltr">Generated by {profile.full_name ?? "—"} · {new Date(rep.generated_at).toLocaleString("en-GB")}</div>
      </div>
      <div className="overflow-x-auto"><h4 className="text-xs text-stone-400 mb-1">{t({ ar: "الميزانية مقابل الفعلي حسب المرحلة", en: "Budget vs Actual by phase" })}</h4>
        <table className="w-full text-xs"><Th c={["المرحلة", "المخصص", "المصروف", "الانحراف"]} /><tbody>
          {rep.by_phase.map((x, i) => <tr key={i} className="border-b border-stone-800/40"><td className="p-1.5 text-stone-200">{x.phase}</td><td className="p-1.5" dir="ltr">{money(x.allocated, cur)}</td><td className="p-1.5" dir="ltr">{money(x.spent, cur)}</td><td className={`p-1.5 ${x.spent > x.allocated && x.allocated > 0 ? "text-red-400" : "text-emerald-400"}`} dir="ltr">{money(x.allocated - x.spent, cur)}</td></tr>)}
          {rep.by_phase.length === 0 && <tr><td className="p-2 text-stone-600" colSpan={4}>{t({ ar: "لا ميزانيات مراحل.", en: "None." })}</td></tr>}
        </tbody></table></div>
      <div className="overflow-x-auto"><h4 className="text-xs text-stone-400 mb-1">{t({ ar: "المصروفات حسب الفئة", en: "By category" })}</h4>
        <table className="w-full text-xs"><Th c={["الفئة", "عدد", "مدفوع", "التزامات"]} /><tbody>
          {rep.by_category.map((x, i) => <tr key={i} className="border-b border-stone-800/40"><td className="p-1.5 text-stone-200">{x.category}</td><td className="p-1.5" dir="ltr">{x.count}</td><td className="p-1.5" dir="ltr">{money(x.cost, cur)}</td><td className="p-1.5" dir="ltr">{money(x.committed, cur)}</td></tr>)}
        </tbody></table></div>
      <div className="overflow-x-auto"><h4 className="text-xs text-stone-400 mb-1">{t({ ar: "المصروفات حسب المورد", en: "By supplier" })}</h4>
        <table className="w-full text-xs"><Th c={["المورد", "عدد", "التكلفة"]} /><tbody>
          {rep.by_supplier.map((x, i) => <tr key={i} className="border-b border-stone-800/40"><td className="p-1.5 text-stone-200">{x.supplier}</td><td className="p-1.5" dir="ltr">{x.count}</td><td className="p-1.5" dir="ltr">{money(x.cost, cur)}</td></tr>)}
        </tbody></table></div>
      <div className="overflow-x-auto"><h4 className="text-xs text-stone-400 mb-1">{t({ ar: "جدول دفعات العميل والتحصيل", en: "Client payments & receivables" })}</h4>
        <table className="w-full text-xs"><Th c={["الدفعة", "الاستحقاق", "المبلغ", "المحصّل", "المتبقي", "الحالة"]} /><tbody>
          {rep.revenue.map((x, i) => <tr key={i} className={`border-b border-stone-800/40 ${x.overdue ? "bg-red-950/20" : ""}`}><td className="p-1.5 text-stone-200">{x.name}</td><td className="p-1.5" dir="ltr">{x.due_date ?? "—"}{x.overdue ? " ⚠" : ""}</td><td className="p-1.5" dir="ltr">{money(x.amount_incl_vat, cur)}</td><td className="p-1.5 text-emerald-400" dir="ltr">{money(x.collected, cur)}</td><td className="p-1.5 text-sky-400" dir="ltr">{money(x.outstanding, cur)}</td><td className="p-1.5 text-stone-400">{x.status}</td></tr>)}
        </tbody></table></div>
      <div className="overflow-x-auto"><h4 className="text-xs text-stone-400 mb-1">{t({ ar: "التدفق النقدي الشهري", en: "Monthly cashflow" })}</h4>
        <table className="w-full text-xs"><Th c={["الشهر", "مدفوعات صادرة", "تحصيل وارد", "الصافي"]} /><tbody>
          {rep.cashflow_monthly.map((x, i) => <tr key={i} className="border-b border-stone-800/40"><td className="p-1.5" dir="ltr">{x.month}</td><td className="p-1.5 text-amber-400" dir="ltr">{money(x.paid_out, cur)}</td><td className="p-1.5 text-emerald-400" dir="ltr">{money(x.collected_in, cur)}</td><td className={`p-1.5 ${x.collected_in - x.paid_out < 0 ? "text-red-400" : "text-emerald-400"}`} dir="ltr">{money(x.collected_in - x.paid_out, cur)}</td></tr>)}
          {rep.cashflow_monthly.length === 0 && <tr><td className="p-2 text-stone-600" colSpan={4}>{t({ ar: "لا حركة نقدية بعد.", en: "None yet." })}</td></tr>}
        </tbody></table></div>
    </div>
  );
}

// ─── الإغلاق المالي: Checklist + إغلاق (تجاوز المالك بسبب) + Snapshot + إعادة فتح ───
function FinClosureSection({ projectId, isOwner, onChanged, flash }: { projectId: string; isOwner: boolean; onChanged: () => Promise<void>; flash: (m: string) => void }) {
  const { t } = useI18n();
  const [chk, setChk] = useState<ClosureChecklist | null>(null);
  const [snap, setSnap] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [c, s] = await Promise.all([pcFinanceClosureChecklist(projectId), pcFinanceSettings(projectId)]);
    if (c.ok) setChk(c.data); else flash(pcErr(c.error));
    if (s.ok) setSnap((s.data as unknown as { closed_snapshot?: Record<string, unknown> | null })?.closed_snapshot ?? null);
  }, [projectId, flash]);
  useEffect(() => { void load(); }, [load]);

  async function close(withOverride: boolean) {
    if (busy) return;
    let reason: string | undefined;
    if (withOverride) {
      const rs = window.prompt(t({ ar: "تجاوز الإغلاق (المالك) — السبب الإلزامي:", en: "Owner override reason:" }));
      if (rs === null) return; if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
      reason = rs.trim();
    }
    if (!window.confirm(t({ ar: "إغلاق حسابات المشروع نهائيًا؟ سيُمنع أي تعديل مالي (عدا استرداد/إلغاء) وسيُحفظ Snapshot.", en: "Close finances?" }))) return;
    setBusy(true);
    const r = await pcFinanceClose(projectId, withOverride, reason);
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "أُغلقت الحسابات وحُفظ الـSnapshot.", en: "Closed." }));
    await load(); await onChanged();
  }
  async function reopen() {
    const rs = window.prompt(t({ ar: "إعادة فتح الحسابات (المالك) — السبب الإلزامي:", en: "Reopen reason:" }));
    if (rs === null) return; if (!rs.trim()) { flash(t({ ar: "السبب إلزامي.", en: "Reason required." })); return; }
    setBusy(true);
    const r = await pcFinanceReopen(projectId, rs.trim());
    setBusy(false);
    if (!r.ok) { flash(pcErr(r.error)); return; }
    flash(t({ ar: "أُعيد فتح الحسابات — الـSnapshot السابقة محفوظة في السجل.", en: "Reopened." }));
    await load(); await onChanged();
  }

  if (!chk) return <p className="text-xs text-stone-500">{t({ ar: "جارٍ التحميل…", en: "Loading…" })}</p>;
  const snapSum = snap ? (snap as { summary?: Record<string, number | string> }).summary : null;

  return (
    <div className="space-y-3">
      {chk.closed && snap && (
        <div className="bg-emerald-950/40 border border-emerald-900 rounded-xl p-3 text-xs space-y-1">
          <div className="text-emerald-300 font-semibold">✓ {t({ ar: "الحسابات مُغلقة — Snapshot نهائية غير قابلة للتعديل الصامت", en: "Closed — immutable snapshot" })}</div>
          <div className="text-stone-400" dir="ltr">{String((snap as { closed_at?: string }).closed_at ?? "")}</div>
          {snapSum && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
              {[["net_revenue", "صافي القيمة"], ["actual_cost", "التكلفة الفعلية"], ["collected", "المحصّل"], ["actual_profit", "الربح النهائي"], ["actual_margin_pct", "الهامش %"], ["approved_budget", "الميزانية"], ["receivable", "المتبقي على العميل"], ["committed_cost", "الالتزامات"]].map(([k, ar]) => (
                <div key={k} className="bg-stone-950/60 rounded p-1.5"><div className="text-stone-200 font-bold" dir="ltr">{String(snapSum[k] ?? "—")}</div><div className="text-[10px] text-stone-500">{ar}</div></div>
              ))}
            </div>
          )}
          {(snap as { override?: { reason?: string } }).override?.reason && <div className="text-amber-400">{t({ ar: "أُغلق بتجاوز — السبب:", en: "Override:" })} {(snap as { override: { reason: string } }).override.reason}</div>}
          {isOwner && <button disabled={busy} onClick={() => void reopen()} className={`${btnGhost} px-3 py-1.5 mt-1`}>{t({ ar: "إعادة فتح بسبب (المالك)", en: "Reopen" })}</button>}
          <p className="text-[10px] text-stone-500">{t({ ar: "بعد الإغلاق: أي تعديل مالي مرفوض عدا استرداد/إلغاء مصروف. التعديلات تتطلب إعادة فتح موثقة.", en: "Post-closure edits require reopen." })}</p>
        </div>
      )}
      <div className="space-y-1.5">
        <div className="text-xs text-stone-400">{t({ ar: "قائمة تدقيق الإغلاق", en: "Closure checklist" })}</div>
        {chk.items.map((it) => (
          <div key={it.key} className={`${card} p-2.5 text-xs flex items-center gap-2 ${!it.ok && it.critical ? "border-red-900/60" : ""}`}>
            <span className={it.ok ? "text-emerald-400" : it.critical ? "text-red-400" : "text-amber-400"}>{it.ok ? "✓" : "●"}</span>
            <span className="text-stone-200 flex-1">{it.ar}</span>
            {typeof it.count === "number" && it.count > 0 && <span className="text-stone-400" dir="ltr">{it.count}</span>}
            {typeof it.amount === "number" && it.amount > 0 && <span className="text-stone-500" dir="ltr">{money(it.amount)}</span>}
            {!it.ok && it.critical && <span className="text-[10px] text-red-400">{t({ ar: "حرج", en: "critical" })}</span>}
          </div>
        ))}
      </div>
      {!chk.closed && (
        <div className="flex gap-2 flex-wrap">
          <button disabled={busy || !chk.can_close} onClick={() => void close(false)} className={`${btnRed} px-4 py-2 text-xs`}>
            {t({ ar: "إغلاق الحسابات وإنشاء Snapshot", en: "Close & snapshot" })}
          </button>
          {!chk.can_close && isOwner && (
            <button disabled={busy} onClick={() => void close(true)} className={`${btnGhost} px-4 py-2 text-xs text-amber-300 border-amber-900/60`}>
              {t({ ar: `تجاوز الإغلاق بسبب (${chk.critical_count} بند حرج)`, en: "Owner override" })}
            </button>
          )}
          {!chk.can_close && !isOwner && <p className="text-[11px] text-amber-400 self-center">{t({ ar: "بنود حرجة مفتوحة — عالجها أو اطلب تجاوز المالك.", en: "Critical items open." })}</p>}
        </div>
      )}
    </div>
  );
}
