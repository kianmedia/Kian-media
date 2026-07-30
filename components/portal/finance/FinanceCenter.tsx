"use client";
// ════════════════════════════════════════════════════════════════════════════
// FinanceCenter — المركز المالي (Phase 4).
//
// الشاشة تسأل الخادم أوّلًا «من أنا هنا؟» (finops_access) ثمّ ترسم ما يناسب،
// لكنّها **لا تعتمد** على ذلك في المنع: كلّ استدعاء لاحق مُبوَّب على الخادم،
// وإخفاء تبويب ليس تفويضًا. لو زُوّرت الحالة في المتصفّح لعادت 42501 كما هي.
//
// ثلاث طبقات رؤية متمايزة عمدًا:
//   • can_view         → المركز المالي (تكاليف · ميزانيات · ذمم · شراء · مورّدون).
//   • can_view_profit  → ★ أضيق ★ العقود والإيراد والاشتراكات والهوامش والربحية.
//   • can_request فقط  → شاشة «طلباتي» وحدها، بلا رقم واحد من مال الشركة.
// العميل لا يصل إلى هنا إطلاقًا: finops_can_view يشترط is_staff().
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  AGING_AR, BUDGET_STATUS_AR, COLLECTION_COLOR, COLLECTION_STATUS_AR, COMMITMENT_AR,
  COST_TYPE_AR, EXPENSE_STATUS_AR, PO_STATUS_AR, PURCHASE_STATUS_AR,
  finAccess, finAmount, finAuditList, finBudgetLineUpsert, finBudgetUpsert, finBudgetVariance,
  finBudgetsList, finCategoryUpsert, finCollectionRecord, finContractUpsert, finCostCenterUpsert,
  finCostUpsert, finCostsList, finDashboard, finDate, finDateTime, finExpenseDecide,
  finExpenseMarkPaid, finExpenseRequestsList, finExpenseSecondApprove, finExport, finExportCsv,
  finIsoDay, finLookups, finMilestoneUpsert, finPct, finPoItemUpsert,
  finPoSetStatus, finPoUpsert, finProfitability, finPurchaseDecide, finPurchaseItemUpsert,
  finPurchaseList, finReceivableUpsert, finReceivables, finRetainerUpsert, finRevenueUpsert,
  finRowDelete, finSupplierUpsert, finSuppliersList, finThresholdUpsert,
  finZohoDiagnostic, finZohoEnqueue, finZohoReplay,
  type FinAccess, type FinDashboard, type FinExportDataset, type FinLookups, type FinProfit,
  type FinProfitability, type FinReceivables, type FinRow, type FinState, type FinVariance,
  type FinDeleteKind,
} from "@/lib/portal/financeOps";
import {
  btnGhost, btnPrimary, card, Chip, Denied, Empty, ErrorBox, Field, fieldCls, Flash, Masked,
  MigrationPending, MoneyCell, Scroller, Section, Spinner, StateView, Stat, useFinLoad,
} from "./FinAtoms";
import { FORM_SPECS, FinForm, ReasonDialog, type FormSpec } from "./FinForms";
import FinMyRequests from "./FinMyRequests";

type TabKey =
  | "dashboard" | "costs" | "budgets" | "purchases" | "receivables"
  | "suppliers" | "profit" | "approvals" | "settings" | "audit" | "zoho" | "mine";

const TABS: { key: TabKey; ar: string }[] = [
  { key: "dashboard", ar: "اللوحة" },
  { key: "costs", ar: "التكاليف" },
  { key: "budgets", ar: "الميزانيات" },
  { key: "purchases", ar: "الشراء" },
  { key: "receivables", ar: "الذمم والتحصيل" },
  { key: "profit", ar: "الربحية" },
  { key: "approvals", ar: "الاعتمادات" },
  { key: "suppliers", ar: "المورّدون" },
  { key: "settings", ar: "الإعدادات" },
  { key: "audit", ar: "التدقيق" },
  { key: "zoho", ar: "Zoho Books" },
  { key: "mine", ar: "طلباتي" },
];

export default function FinanceCenter() {
  const { st, reload } = useFinLoad<FinAccess>(() => finAccess(), []);
  if (st === null) return <Spinner />;
  if (st.state === "needs_migration") return <MigrationPending message={st.message} />;
  if (st.state === "denied") return <Denied message={st.message} />;
  if (st.state === "error") return <ErrorBox message={st.message} onRetry={reload} />;

  const a = st.data;
  if (!a.authenticated) return <Denied message="سجّل الدخول للوصول إلى المركز المالي." />;
  // العميل/الزائر: الخادم يمنعه أصلًا، والشاشة تقول السبب بدل أن تُظهر تبويبات فارغة.
  if (a.is_client) {
    return <Denied message={a.message ?? "المركز المالي داخليّ بالكامل ولا يُتاح لحسابات العملاء."} />;
  }
  // موظّف بلا صلاحية مالية: شاشة طلباته وحدها. ليست نسخة مقصوصة من المركز،
  // بل سطح مختلف يقرأ دوالّ أخرى لا تعرف عن مال الشركة شيئًا.
  if (!a.can_view) {
    if (!a.can_request) return <Denied message={a.message ?? "لا تملك صلاحية في المركز المالي."} />;
    return (
      <div className="space-y-4">
        <p className="text-[11px] text-stone-500 leading-6">{a.message}</p>
        <FinMyRequests />
      </div>
    );
  }
  return <FinanceTabs a={a} />;
}

function FinanceTabs({ a }: { a: FinAccess }) {
  const [tab, setTab] = useState<TabKey>("dashboard");
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const look = useFinLoad<FinLookups>(() => finLookups(), [tick]);
  const lookups = look.st?.state === "ok" ? look.st.data : null;

  const visible = TABS.filter((t) => {
    if (t.key === "profit") return a.can_view_profit;
    if (t.key === "audit" || t.key === "zoho") return a.can_manage;
    if (t.key === "settings") return a.can_manage;
    return true;
  });

  return (
    <div className="space-y-5">
      <Scroller>
        <div className="flex gap-1.5 pb-1" role="tablist" dir="rtl">
          {visible.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap min-h-[40px] px-3 rounded-lg text-xs border transition-colors ${
                tab === t.key
                  ? "bg-red-800 border-red-700 text-white"
                  : "bg-stone-900 border-stone-800 text-stone-300 hover:bg-stone-800"
              }`}
            >
              {t.ar}
            </button>
          ))}
        </div>
      </Scroller>

      {tab === "dashboard" && <DashboardTab tick={tick} canExport={a.can_export} />}
      {tab === "costs" && <CostsTab lookups={lookups} canManage={a.can_manage} tick={tick} onChange={refresh} />}
      {tab === "budgets" && <BudgetsTab lookups={lookups} canManage={a.can_manage} tick={tick} onChange={refresh} />}
      {tab === "purchases" && <PurchasesTab lookups={lookups} canManage={a.can_manage} tick={tick} onChange={refresh} />}
      {tab === "receivables" && <ReceivablesTab lookups={lookups} canManage={a.can_manage_receivables} tick={tick} onChange={refresh} />}
      {tab === "profit" && <ProfitTab lookups={lookups} canManage={a.can_manage} tick={tick} onChange={refresh} />}
      {tab === "approvals" && <ApprovalsTab canApprove={a.can_approve} canManage={a.can_manage} tick={tick} onChange={refresh} />}
      {tab === "suppliers" && <SuppliersTab lookups={lookups} canManage={a.can_manage} tick={tick} onChange={refresh} />}
      {tab === "settings" && <SettingsTab lookups={lookups} tick={tick} onChange={refresh} />}
      {tab === "audit" && <AuditTab tick={tick} />}
      {tab === "zoho" && <ZohoTab tick={tick} onChange={refresh} />}
      {tab === "mine" && <FinMyRequests />}
    </div>
  );
}

// ─── اللوحة ────────────────────────────────────────────────────────────────

function DashboardTab({ tick, canExport }: { tick: number; canExport: boolean }) {
  const { st, reload } = useFinLoad<FinDashboard>(() => finDashboard({}), [tick]);
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat label="تكلفة فعلية (إجمالي)" value={finAmount(d.counters.actual_cost_gross)}
              hint={`من ${finDate(d.from)} إلى ${finDate(d.to)}`} />
            <Stat label="التزامات قائمة" value={finAmount(d.counters.committed_cost_gross)}
              hint="أوامر شراء صادرة وطلبات صرف معتمدة لم تُصرَف بعد." />
            <Stat label="ذمم قائمة" value={finAmount(d.counters.outstanding_gross)} />
            <Stat label="متأخّرات" value={finAmount(d.counters.overdue_gross)}
              tone={Number(d.counters.overdue_gross) > 0 ? "bad" : "good"}
              hint={`${d.counters.overdue_count ?? 0} ذمّة متأخّرة`} />
            <Stat label="طلبات صرف بانتظار قرار" value={String(d.counters.expense_pending ?? 0)}
              tone={Number(d.counters.expense_pending) > 0 ? "warn" : "normal"} />
            <Stat label="طلبات شراء بانتظار قرار" value={String(d.counters.purchase_pending ?? 0)}
              tone={Number(d.counters.purchase_pending) > 0 ? "warn" : "normal"} />
            <Stat label="أوامر شراء مفتوحة" value={String(d.counters.open_po ?? 0)} />
            <Stat label="ميزانيات تجاوزت" value={String(d.counters.budgets_over ?? 0)}
              tone={Number(d.counters.budgets_over) > 0 ? "bad" : "good"} />
          </div>

          <Section title="أعمار الذمم" note="المبالغ المتبقّية موزّعة على شرائح التأخّر — مشتقّة من الدفعات المسجَّلة.">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {Object.entries(d.aging ?? {}).map(([k, v]) => (
                <Stat key={k} label={AGING_AR[k.replace(/^d/, "")] ?? AGING_AR[k] ?? k} value={finAmount(v)} />
              ))}
            </div>
          </Section>

          {/* ★ الربحية: تُعرض أو يُقال إنّها محجوبة — لا أصفار تبدو كحقيقة ★ */}
          {d.profit_visible && d.profit
            ? <Section title="الربحية" note={d.profit.note}><ProfitCard p={d.profit} /></Section>
            : <Masked title="الربحية محجوبة" message={d.profit_message ?? "الربحية والهوامش مقصورة على المالك وفريق المالية."} />}

          <Section title="ميزانيات تجاوزت المخطَّط">
            {d.over_budget?.length
              ? <ul className="space-y-2">
                  {d.over_budget.map((b) => {
                    const v = (b.variance ?? {}) as unknown as FinVariance;
                    return (
                      <li key={String(b.id)} className={`${card} p-3 text-xs`} dir="rtl">
                        <div className="text-stone-200">{String(b.title ?? "")} <span className="text-stone-500" dir="ltr">{String(b.code ?? "")}</span></div>
                        <div className="text-stone-500 mt-1">
                          مخطَّط {finAmount(v.planned_gross)} · مستهلَك {finAmount(v.consumed_gross)} · انحراف{" "}
                          <span className="text-red-300">{finAmount(v.variance_gross)}</span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              : <Empty message="لا ميزانية متجاوَزة." />}
          </Section>

          <Section title="طلبات صرف بانتظار قرار">
            {d.pending_expenses?.length
              ? <Scroller>
                  <table className="w-full text-xs" dir="rtl">
                    <tbody>
                      {d.pending_expenses.map((r) => (
                        <tr key={String(r.id)} className={card}>
                          <td className="p-2 text-stone-400" dir="ltr">{String(r.request_no ?? "")}</td>
                          <td className="p-2 text-stone-200">{String(r.title ?? "")}</td>
                          <td className="p-2 text-stone-400">{String(r.requester_name ?? "—")}</td>
                          <td className="p-2"><MoneyCell row={r} /></td>
                          <td className="p-2 text-stone-500">{finDate(r.created_at as string)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroller>
              : <Empty message="لا طلبات معلّقة." />}
          </Section>

          {canExport && <ExportBar />}
        </div>
      )}
    </StateView>
  );
}

function ProfitCard({ p }: { p: FinProfit }) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Stat label="الإيراد (صافي قبل الضريبة)" value={finAmount(p.revenue_net)} />
        <Stat label="التكلفة المباشرة (صافي)" value={finAmount(p.direct_cost_net)} />
        <Stat label="مجمل الربح" value={finAmount(p.gross_profit_net)}
          tone={p.gross_profit_net >= 0 ? "good" : "bad"} hint={`هامش ${finPct(p.gross_margin_pct)}`} />
        <Stat label="صافي الربح التقديريّ" value={finAmount(p.estimated_net_profit)}
          tone={p.estimated_net_profit >= 0 ? "good" : "bad"}
          hint={`تحميل غير مباشر ${finPct(p.overhead_rate_pct)} · هامش ${finPct(p.estimated_net_margin_pct)}`} />
      </div>
      <p className="text-[10px] text-stone-600 leading-6">
        الأساس: <span dir="ltr">{p.basis}</span> — الضريبة تُحصَّل لصالح الدولة ولا تدخل ربحًا ولا تكلفة.
        {p.is_estimate ? " صافي الربح تقديريّ ولا يقوم مقام الدفاتر المحاسبية." : ""}
      </p>
    </div>
  );
}

// ─── التصدير ───────────────────────────────────────────────────────────────

const DATASETS: { key: FinExportDataset; ar: string }[] = [
  { key: "costs", ar: "التكاليف" },
  { key: "receivables", ar: "الذمم" },
  { key: "collections", ar: "التحصيلات" },
  { key: "budget_lines", ar: "بنود الميزانيات" },
  { key: "expense_requests", ar: "طلبات الصرف" },
  { key: "purchase_orders", ar: "أوامر الشراء" },
  { key: "revenue", ar: "الإيراد" },
];

function ExportBar() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const run = async (ds: FinExportDataset) => {
    setBusy(ds); setMsg(null);
    const r = await finExport(ds, {});
    setBusy(null);
    if (r.state !== "ok") { setMsg({ text: r.message, tone: "bad" }); return; }
    const csv = finExportCsv(r.data);
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = `kian-${ds}-${finIsoDay()}.csv`;
      el.click();
      URL.revokeObjectURL(url);
      setMsg({ text: `صُدِّر ${r.data.rows.length} صفًّا. ${r.data.note}`, tone: "ok" });
    } catch {
      setMsg({ text: "تعذّر إنشاء الملفّ في هذا المتصفّح.", tone: "bad" });
    }
  };
  return (
    <Section title="التصدير" note="مجموعات محدَّدة سلفًا فقط، وكلّ تصدير واقعة مُدقَّقة: من صدَّر ماذا ومتى.">
      <div className="flex flex-wrap gap-2">
        {DATASETS.map((d) => (
          <button key={d.key} className={btnGhost} disabled={busy !== null} onClick={() => void run(d.key)}>
            {busy === d.key ? "جارٍ…" : d.ar}
          </button>
        ))}
      </div>
      {msg && <Flash msg={msg.text} tone={msg.tone} />}
    </Section>
  );
}

// ─── مُساعد النماذج ────────────────────────────────────────────────────────

function useDialog() {
  const [open, setOpen] = useState<{ spec: FormSpec; initial?: FinRow; submit: (p: Record<string, unknown>) => Promise<FinState<unknown>> } | null>(null);
  return { open, setOpen };
}

function DeleteBtn({ kind, id, onDone }: { kind: FinDeleteKind; id: string; onDone: () => void }) {
  const [ask, setAsk] = useState(false);
  return (
    <>
      <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`} onClick={() => setAsk(true)}>حذف</button>
      {ask && (
        <ReasonDialog
          title="حذف السجلّ"
          label="سبب الحذف"
          onClose={() => { setAsk(false); onDone(); }}
          onConfirm={(reason) => finRowDelete(kind, id, reason)}
        />
      )}
    </>
  );
}

// ─── التكاليف ──────────────────────────────────────────────────────────────

function CostsTab({ lookups, canManage, tick, onChange }: {
  lookups: FinLookups | null; canManage: boolean; tick: number; onChange: () => void;
}) {
  const [f, setF] = useState<{ from: string; to: string; commitment: string; cost_type: string }>({
    from: "", to: "", commitment: "", cost_type: "",
  });
  const { st, reload } = useFinLoad<{ ok: boolean; rows: FinRow[] }>(
    () => finCostsList({ from: f.from, to: f.to, commitment: f.commitment, cost_type: f.cost_type }),
    [tick, f.from, f.to, f.commitment, f.cost_type],
  );
  const d = useDialog();
  return (
    <Section
      title="دفتر التكلفة"
      note="جدول واحد لكلّ أنواع التكلفة: طاقم · مستقلّون · سفر · تأجير معدّات · مشتريات إنتاج. التمييز بين «التزام» و«فعليّ» هو ما يجعل الانحراف رقمًا صادقًا."
      actions={canManage ? (
        <button className={btnPrimary} onClick={() => d.setOpen({ spec: FORM_SPECS.cost, submit: finCostUpsert })}>
          تكلفة جديدة
        </button>
      ) : null}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Field label="من"><input type="date" className={fieldCls} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
        <Field label="إلى"><input type="date" className={fieldCls} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
        <Field label="الطبيعة">
          <select className={fieldCls} value={f.commitment} onChange={(e) => setF({ ...f, commitment: e.target.value })}>
            <option value="">الكلّ</option>
            <option value="actual">فعليّ</option>
            <option value="committed">التزام</option>
          </select>
        </Field>
        <Field label="النوع">
          <select className={fieldCls} value={f.cost_type} onChange={(e) => setF({ ...f, cost_type: e.target.value })}>
            <option value="">الكلّ</option>
            {Object.entries(COST_TYPE_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
      </div>

      <StateView st={st} onRetry={reload}>
        {(data) => data.rows.length === 0 ? <Empty message="لا تكاليف ضمن هذا النطاق." /> : (
          <Scroller>
            <table className="w-full text-xs" dir="rtl">
              <thead className="text-stone-500">
                <tr className="text-right">
                  <th className="p-2 font-normal">الرقم</th>
                  <th className="p-2 font-normal">الوصف</th>
                  <th className="p-2 font-normal">النوع</th>
                  <th className="p-2 font-normal">الطبيعة</th>
                  <th className="p-2 font-normal">التاريخ</th>
                  <th className="p-2 font-normal">المبلغ</th>
                  <th className="p-2 font-normal">المشروع</th>
                  {canManage && <th className="p-2 font-normal">إجراء</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={String(r.id)} className={card}>
                    <td className="p-2 text-stone-500" dir="ltr">{String(r.cost_no ?? "")}</td>
                    <td className="p-2 text-stone-200">
                      {String(r.title ?? "")}
                      <div className="text-[10px] text-stone-600">{String(r.supplier ?? r.person_label ?? "")}</div>
                    </td>
                    <td className="p-2 text-stone-400">{COST_TYPE_AR[r.cost_type as keyof typeof COST_TYPE_AR] ?? String(r.cost_type ?? "")}</td>
                    <td className="p-2">
                      <Chip text={COMMITMENT_AR[r.commitment as "committed" | "actual"] ?? String(r.commitment ?? "")}
                        tone={r.commitment === "committed" ? "warn" : "neutral"} />
                    </td>
                    <td className="p-2 text-stone-400">{finDate(r.incurred_on as string)}</td>
                    <td className="p-2"><MoneyCell row={r} /></td>
                    <td className="p-2 text-stone-500">{String(r.project_label ?? "—")}</td>
                    {canManage && (
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                            onClick={() => d.setOpen({ spec: FORM_SPECS.cost, initial: r, submit: (p) => finCostUpsert({ ...p, id: r.id }) })}>
                            تعديل
                          </button>
                          <DeleteBtn kind="cost" id={String(r.id)} onDone={onChange} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </StateView>

      {d.open && (
        <FinForm spec={d.open.spec} initial={d.open.initial} lookups={lookups}
          onSubmit={d.open.submit} onClose={() => { d.setOpen(null); onChange(); }} />
      )}
    </Section>
  );
}

// ─── الميزانيات ────────────────────────────────────────────────────────────

function BudgetsTab({ lookups, canManage, tick, onChange }: {
  lookups: FinLookups | null; canManage: boolean; tick: number; onChange: () => void;
}) {
  const { st, reload } = useFinLoad<{ ok: boolean; rows: FinRow[] }>(() => finBudgetsList({}), [tick]);
  const [detail, setDetail] = useState<string | null>(null);
  const d = useDialog();
  return (
    <Section
      title="الميزانيات والانحراف"
      note="المخطَّط من بنود الميزانية، والملتزَم والفعليّ من دفتر التكلفة. الانحراف مشتقّ وقت القراءة ولا يُخزَّن، فلا ينحرف رقمان عن بعضهما بصمت."
      actions={canManage ? (
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={() => d.setOpen({ spec: FORM_SPECS.budget, submit: finBudgetUpsert })}>ميزانية جديدة</button>
          <button className={btnGhost} onClick={() => d.setOpen({ spec: FORM_SPECS.budget_line, submit: finBudgetLineUpsert })}>بند ميزانية</button>
        </div>
      ) : null}
    >
      <StateView st={st} onRetry={reload}>
        {(data) => data.rows.length === 0 ? <Empty message="لا ميزانيات بعد." /> : (
          <div className="space-y-2">
            {data.rows.map((b) => {
              const v = (b.variance ?? {}) as unknown as FinVariance;
              return (
                <div key={String(b.id)} className={`${card} p-3 space-y-2`} dir="rtl">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div>
                      <div className="text-sm text-stone-100">{String(b.title ?? "")}</div>
                      <div className="text-[11px] text-stone-500">
                        <span dir="ltr">{String(b.code ?? "")}</span> · {BUDGET_STATUS_AR[String(b.status)] ?? String(b.status)}
                        {b.project_label ? ` · ${String(b.project_label)}` : ""}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                        onClick={() => setDetail(detail === String(b.id) ? null : String(b.id))}>
                        {detail === String(b.id) ? "إخفاء البنود" : "البنود والانحراف"}
                      </button>
                      {canManage && (
                        <>
                          <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                            onClick={() => d.setOpen({ spec: FORM_SPECS.budget, initial: b, submit: (p) => finBudgetUpsert({ ...p, id: b.id }) })}>
                            تعديل
                          </button>
                          <DeleteBtn kind="budget" id={String(b.id)} onDone={onChange} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                    <Stat label="المخطَّط" value={finAmount(v.planned_gross)} />
                    <Stat label="الملتزَم" value={finAmount(v.committed_gross)} />
                    <Stat label="الفعليّ" value={finAmount(v.actual_gross)} />
                    <Stat label="المستهلَك" value={finAmount(v.consumed_gross)} hint={finPct(v.consumed_pct)} />
                    <Stat label="الانحراف" value={finAmount(v.variance_gross)} tone={v.over_budget ? "bad" : "good"} />
                  </div>
                  {detail === String(b.id) && <BudgetLines budgetId={String(b.id)} />}
                </div>
              );
            })}
          </div>
        )}
      </StateView>
      {d.open && (
        <FinForm spec={d.open.spec} initial={d.open.initial} lookups={lookups}
          onSubmit={d.open.submit} onClose={() => { d.setOpen(null); onChange(); }} />
      )}
    </Section>
  );
}

function BudgetLines({ budgetId }: { budgetId: string }) {
  const { st, reload } = useFinLoad<{ ok: boolean; variance: FinVariance }>(
    () => finBudgetVariance(budgetId), [budgetId],
  );
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => !d.variance.lines?.length ? <Empty message="لا بنود في هذه الميزانية." /> : (
        <Scroller>
          <table className="w-full text-[11px]" dir="rtl">
            <thead className="text-stone-500">
              <tr className="text-right">
                <th className="p-2 font-normal">البند</th>
                <th className="p-2 font-normal">المخطَّط</th>
                <th className="p-2 font-normal">الملتزَم</th>
                <th className="p-2 font-normal">الفعليّ</th>
              </tr>
            </thead>
            <tbody>
              {d.variance.lines.map((l) => (
                <tr key={String(l.line_id)} className="border-t border-stone-800">
                  <td className="p-2 text-stone-200">
                    {String(l.label ?? "")}
                    <span className="text-stone-600"> · {String(l.category ?? "بلا بند")}</span>
                  </td>
                  <td className="p-2">
                    <MoneyCell row={{ amount_net: l.planned_net, vat_amount: l.planned_vat, amount_gross: l.planned_gross }} />
                  </td>
                  <td className="p-2 text-amber-300">{finAmount(l.committed_gross)}</td>
                  <td className="p-2 text-stone-200">{finAmount(l.actual_gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Scroller>
      )}
    </StateView>
  );
}

// ─── الشراء ────────────────────────────────────────────────────────────────

function PurchasesTab({ lookups, canManage, tick, onChange }: {
  lookups: FinLookups | null; canManage: boolean; tick: number; onChange: () => void;
}) {
  const { st, reload } = useFinLoad<{ ok: boolean; requests: FinRow[]; purchase_orders: FinRow[] }>(
    () => finPurchaseList({}), [tick],
  );
  const d = useDialog();
  const [statusFor, setStatusFor] = useState<FinRow | null>(null);
  return (
    <Section
      title="طلبات الشراء وأوامر الشراء"
      note="إصدار أمر الشراء يُنشئ التزامًا في دفتر التكلفة، والاستلام الكامل يحوّل الالتزام نفسه إلى تكلفة فعلية — لا صفّ ثانٍ ولا احتساب مزدوج."
      actions={canManage ? (
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={() => d.setOpen({ spec: FORM_SPECS.purchase_order, submit: finPoUpsert })}>أمر شراء</button>
        </div>
      ) : null}
    >
      <StateView st={st} onRetry={reload}>
        {(data) => (
          <div className="space-y-5">
            <div className="space-y-2">
              <h3 className="text-stone-300 text-xs">طلبات الشراء</h3>
              {data.requests.length === 0 ? <Empty message="لا طلبات شراء." /> : (
                <Scroller>
                  <table className="w-full text-xs" dir="rtl">
                    <tbody>
                      {data.requests.map((r) => (
                        <tr key={String(r.id)} className={`${card} align-top`}>
                          <td className="p-2 text-stone-500" dir="ltr">{String(r.request_no ?? "")}</td>
                          <td className="p-2 text-stone-200">
                            {String(r.title ?? "")}
                            <div className="text-[10px] text-stone-600">{String(r.requester_name ?? "")}</div>
                            {Array.isArray(r.items) && r.items.length > 0 && (
                              <ul className="mt-1 space-y-0.5">
                                {(r.items as FinRow[]).map((i) => (
                                  <li key={String(i.id)} className="text-[10px] text-stone-500">
                                    {String(i.description ?? "")} × {String(i.quantity ?? "")} —{" "}
                                    {finAmount(i.line_net)} + ضريبة {finAmount(i.vat_amount)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="p-2"><MoneyCell row={r} /></td>
                          <td className="p-2"><Chip text={PURCHASE_STATUS_AR[String(r.status)] ?? String(r.status)} /></td>
                          {canManage && (
                            <td className="p-2">
                              <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                onClick={() => d.setOpen({
                                  spec: FORM_SPECS.purchase_item,
                                  submit: (p) => finPurchaseItemUpsert({ ...p, request_id: r.id }),
                                })}>
                                إضافة بند
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroller>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-stone-300 text-xs">أوامر الشراء</h3>
              {data.purchase_orders.length === 0 ? <Empty message="لا أوامر شراء." /> : (
                <Scroller>
                  <table className="w-full text-xs" dir="rtl">
                    <tbody>
                      {data.purchase_orders.map((o) => (
                        <tr key={String(o.id)} className={`${card} align-top`}>
                          <td className="p-2 text-stone-500" dir="ltr">{String(o.po_no ?? "")}</td>
                          <td className="p-2 text-stone-200">
                            {String(o.supplier ?? "—")}
                            <div className="text-[10px] text-stone-600">{finDate(o.issue_date as string)}</div>
                          </td>
                          <td className="p-2"><MoneyCell row={o} /></td>
                          <td className="p-2">
                            <Chip text={PO_STATUS_AR[String(o.status)] ?? String(o.status)}
                              tone={o.status === "cancelled" ? "bad" : o.status === "received" ? "good" : "neutral"} />
                          </td>
                          {canManage && (
                            <td className="p-2">
                              <div className="flex gap-1 flex-wrap">
                                <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                  onClick={() => d.setOpen({
                                    spec: FORM_SPECS.po_item,
                                    submit: (p) => finPoItemUpsert({ ...p, po_id: o.id }),
                                  })}>بند</button>
                                <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                  onClick={() => setStatusFor(o)}>الحالة</button>
                                <DeleteBtn kind="purchase_order" id={String(o.id)} onDone={onChange} />
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroller>
              )}
            </div>
          </div>
        )}
      </StateView>

      {statusFor && <PoStatusDialog po={statusFor} onClose={() => { setStatusFor(null); onChange(); }} />}
      {d.open && (
        <FinForm spec={d.open.spec} initial={d.open.initial} lookups={lookups}
          onSubmit={d.open.submit} onClose={() => { d.setOpen(null); onChange(); }} />
      )}
    </Section>
  );
}

function PoStatusDialog({ po, onClose }: { po: FinRow; onClose: () => void }) {
  const [status, setStatus] = useState<"issued" | "partially_received" | "received" | "closed" | "cancelled">("issued");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4" dir="rtl" role="dialog" aria-modal="true">
      <div className={`${card} w-full sm:max-w-md p-4 space-y-3`}>
        <h3 className="text-stone-100 text-sm">حالة أمر الشراء <span dir="ltr">{String(po.po_no ?? "")}</span></h3>
        <Flash msg={err} tone="bad" />
        <Field label="الحالة الجديدة" hint="الإلغاء يتطلّب سببًا، ويُبطل التزام الأمر في دفتر التكلفة.">
          <select className={fieldCls} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {Object.entries(PO_STATUS_AR).filter(([k]) => k !== "draft").map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </Field>
        <Field label="ملاحظة/سبب">
          <textarea className={fieldCls} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <div className="flex gap-2">
          <button className={btnPrimary} disabled={busy}
            onClick={async () => {
              setBusy(true); setErr(null);
              const r = await finPoSetStatus(String(po.id), status, note.trim() || undefined);
              setBusy(false);
              if (r.state === "ok") onClose(); else setErr(r.message);
            }}>{busy ? "جارٍ…" : "تطبيق"}</button>
          <button className={btnGhost} onClick={onClose} disabled={busy}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}

// ─── الذمم والتحصيل ────────────────────────────────────────────────────────

function ReceivablesTab({ lookups, canManage, tick, onChange }: {
  lookups: FinLookups | null; canManage: boolean; tick: number; onChange: () => void;
}) {
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const { st, reload } = useFinLoad<FinReceivables>(
    () => finReceivables({ only_overdue: onlyOverdue ? "true" : "" }), [tick, onlyOverdue],
  );
  const d = useDialog();
  return (
    <Section
      title="الذمم وحالة التحصيل"
      note="المحصَّل والمتبقّي والتأخّر تُحسب من الدفعات المسجَّلة وقت القراءة. لا عمود محفوظ يمكن أن يفترق عن مجموع الدفعات."
      actions={canManage ? (
        <div className="flex gap-2">
          <button className={btnPrimary} onClick={() => d.setOpen({ spec: FORM_SPECS.receivable, submit: finReceivableUpsert })}>ذمّة جديدة</button>
          <button className={btnGhost} onClick={() => d.setOpen({ spec: FORM_SPECS.milestone, submit: finMilestoneUpsert })}>دفعة عقد</button>
        </div>
      ) : null}
    >
      <label className="flex items-center gap-2 text-xs text-stone-400">
        <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
        المتأخّرات فقط
      </label>

      <StateView st={st} onRetry={reload}>
        {(data) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="المفوتَر" value={finAmount(data.totals.invoiced_gross)} />
              <Stat label="المحصَّل" value={finAmount(data.totals.collected_gross)} tone="good" />
              <Stat label="المتبقّي" value={finAmount(data.totals.outstanding_gross)} />
              <Stat label="المتأخّر" value={finAmount(data.totals.overdue_gross)}
                tone={data.totals.overdue_gross > 0 ? "bad" : "good"}
                hint={`${data.totals.overdue_count} ذمّة`} />
            </div>

            {data.rows.length === 0 ? <Empty message="لا ذمم." /> : (
              <Scroller>
                <table className="w-full text-xs" dir="rtl">
                  <thead className="text-stone-500">
                    <tr className="text-right">
                      <th className="p-2 font-normal">المستند</th>
                      <th className="p-2 font-normal">العميل</th>
                      <th className="p-2 font-normal">الاستحقاق</th>
                      <th className="p-2 font-normal">القيمة</th>
                      <th className="p-2 font-normal">المحصَّل / المتبقّي</th>
                      <th className="p-2 font-normal">الحالة</th>
                      {canManage && <th className="p-2 font-normal">إجراء</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => {
                      const cs = String(r.collection_status ?? "");
                      return (
                        <tr key={String(r.id)} className={card}>
                          <td className="p-2 text-stone-500" dir="ltr">{String(r.doc_no ?? "")}</td>
                          <td className="p-2 text-stone-200">
                            {String(r.client_label ?? "—")}
                            <div className="text-[10px] text-stone-600">{String(r.title ?? "")}</div>
                          </td>
                          <td className="p-2 text-stone-400">
                            {finDate(r.due_date as string)}
                            {Number(r.days_overdue) > 0 && (
                              <div className="text-[10px] text-red-300">متأخّر {String(r.days_overdue)} يومًا</div>
                            )}
                          </td>
                          <td className="p-2"><MoneyCell row={r} /></td>
                          <td className="p-2 text-stone-300">
                            <div>{finAmount(r.collected)}</div>
                            <div className="text-[11px] text-stone-500">متبقٍّ {finAmount(r.outstanding)}</div>
                          </td>
                          <td className={`p-2 ${COLLECTION_COLOR[cs] ?? "text-stone-300"}`}>
                            {COLLECTION_STATUS_AR[cs] ?? cs}
                            <div className="text-[10px] text-stone-600">{AGING_AR[String(r.aging_bucket)] ?? ""}</div>
                          </td>
                          {canManage && (
                            <td className="p-2">
                              <div className="flex gap-1 flex-wrap">
                                <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                  onClick={() => d.setOpen({
                                    spec: FORM_SPECS.collection,
                                    submit: (p) => finCollectionRecord({ ...p, receivable_id: r.id }),
                                  })}>تحصيل</button>
                                <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                  onClick={() => d.setOpen({
                                    spec: FORM_SPECS.receivable, initial: r,
                                    submit: (p) => finReceivableUpsert({ ...p, id: r.id }),
                                  })}>تعديل</button>
                                <DeleteBtn kind="receivable" id={String(r.id)} onDone={onChange} />
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Scroller>
            )}
            <p className="text-[10px] text-stone-600 leading-6">{data.note}</p>
          </div>
        )}
      </StateView>

      {d.open && (
        <FinForm spec={d.open.spec} initial={d.open.initial} lookups={lookups}
          onSubmit={d.open.submit} onClose={() => { d.setOpen(null); onChange(); }} />
      )}
    </Section>
  );
}

// ─── الربحية ───────────────────────────────────────────────────────────────

function ProfitTab({ lookups, canManage, tick, onChange }: {
  lookups: FinLookups | null; canManage: boolean; tick: number; onChange: () => void;
}) {
  const { st, reload } = useFinLoad<FinProfitability>(() => finProfitability({}), [tick]);
  const d = useDialog();
  return (
    <Section
      title="الربحية والعقود"
      note="مجمل الربح = الإيراد الصافي − التكلفة المباشرة الصافية. الضريبة خارج الحساب لأنّها تُحصَّل لصالح الدولة. صافي الربح تقديريّ ويُعلن ذلك في كلّ عرض."
      actions={canManage ? (
        <div className="flex gap-2 flex-wrap">
          <button className={btnPrimary} onClick={() => d.setOpen({ spec: FORM_SPECS.contract, submit: finContractUpsert })}>عقد</button>
          <button className={btnGhost} onClick={() => d.setOpen({ spec: FORM_SPECS.revenue, submit: finRevenueUpsert })}>إيراد</button>
          <button className={btnGhost} onClick={() => d.setOpen({ spec: FORM_SPECS.retainer, submit: finRetainerUpsert })}>اشتراك شهريّ</button>
        </div>
      ) : null}
    >
      <StateView st={st} onRetry={reload}>
        {(data) => (
          <div className="space-y-5">
            <ProfitCard p={data.company} />

            <div className="space-y-2">
              <h3 className="text-stone-300 text-xs">الربحية بحسب المشروع</h3>
              {data.by_project.length === 0 ? <Empty message="لا مشاريع لها إيراد أو تكلفة." /> : (
                <Scroller>
                  <table className="w-full text-xs" dir="rtl">
                    <thead className="text-stone-500">
                      <tr className="text-right">
                        <th className="p-2 font-normal">المشروع</th>
                        <th className="p-2 font-normal">الإيراد الصافي</th>
                        <th className="p-2 font-normal">التكلفة الصافية</th>
                        <th className="p-2 font-normal">مجمل الربح</th>
                        <th className="p-2 font-normal">الهامش</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_project.map((p) => (
                        <tr key={String(p.project_id)} className={card}>
                          <td className="p-2 text-stone-200">{p.project_label ?? String(p.project_id).slice(0, 8)}</td>
                          <td className="p-2 text-stone-300">{finAmount(p.revenue_net)}</td>
                          <td className="p-2 text-stone-300">{finAmount(p.direct_cost_net)}</td>
                          <td className={`p-2 ${p.gross_profit_net >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                            {finAmount(p.gross_profit_net)}
                          </td>
                          <td className="p-2 text-stone-400">{finPct(p.gross_margin_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroller>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-stone-300 text-xs">العقود والرصيد المتبقّي</h3>
              {data.contracts.length === 0 ? <Empty message="لا عقود." /> : (
                <Scroller>
                  <table className="w-full text-xs" dir="rtl">
                    <tbody>
                      {data.contracts.map((c) => {
                        const s = (c.state ?? {}) as Record<string, unknown>;
                        return (
                          <tr key={String(c.id)} className={card}>
                            <td className="p-2 text-stone-500" dir="ltr">{String(c.contract_no ?? "")}</td>
                            <td className="p-2 text-stone-200">
                              {String(c.title ?? "")}
                              <div className="text-[10px] text-stone-600">{String(c.client_label ?? "")}</div>
                            </td>
                            <td className="p-2"><MoneyCell row={c} label="قيمة العقد" /></td>
                            <td className="p-2 text-stone-300">
                              <div className="text-[11px]">مفوتَر {finAmount(s.invoiced)}</div>
                              <div className="text-[11px]">محصَّل {finAmount(s.collected)}</div>
                              <div className="text-[11px] text-amber-300">متبقٍّ من العقد {finAmount(s.remaining_balance)}</div>
                            </td>
                            {canManage && (
                              <td className="p-2">
                                <DeleteBtn kind="contract" id={String(c.id)} onDone={onChange} />
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Scroller>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-stone-300 text-xs">الاشتراكات الشهرية</h3>
              {data.retainers.length === 0 ? <Empty message="لا اشتراكات." /> : (
                <Scroller>
                  <table className="w-full text-xs" dir="rtl">
                    <tbody>
                      {data.retainers.map((t) => (
                        <tr key={String(t.id)} className={card}>
                          <td className="p-2 text-stone-200">
                            {String(t.title ?? "")}
                            <div className="text-[10px] text-stone-600">{String(t.client_label ?? "")}</div>
                          </td>
                          <td className="p-2 text-stone-400">
                            {finDate(t.start_month as string)} → {t.end_month ? finDate(t.end_month as string) : "مفتوح"}
                          </td>
                          <td className="p-2"><MoneyCell row={t} label="شهريًّا" /></td>
                          <td className="p-2 text-stone-400">يوم الفوترة {String(t.billing_day ?? "—")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Scroller>
              )}
            </div>
          </div>
        )}
      </StateView>

      {d.open && (
        <FinForm spec={d.open.spec} initial={d.open.initial} lookups={lookups}
          onSubmit={d.open.submit} onClose={() => { d.setOpen(null); onChange(); }} />
      )}
    </Section>
  );
}

// ─── الاعتمادات ────────────────────────────────────────────────────────────

function ApprovalsTab({ canApprove, canManage, tick, onChange }: {
  canApprove: boolean; canManage: boolean; tick: number; onChange: () => void;
}) {
  const { st, reload } = useFinLoad<{ ok: boolean; rows: FinRow[] }>(
    () => finExpenseRequestsList({}), [tick],
  );
  const [dec, setDec] = useState<{ row: FinRow; action: "approved" | "rejected" | "returned" } | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);

  const act = async (fn: () => Promise<FinState<unknown>>, okText: string) => {
    const r = await fn();
    setFlash(r.state === "ok" ? { text: okText, tone: "ok" } : { text: r.message, tone: "bad" });
    onChange();
  };

  return (
    <Section
      title="اعتماد الطلبات"
      note="لا أحد يعتمد طلبه هو، والسقف مفروض في القاعدة لا في الشاشة: مبلغ فوق سقفك يُردّ برسالة صريحة حتى لو ضُغط الزرّ."
    >
      {flash && <Flash msg={flash.text} tone={flash.tone} />}
      <StateView st={st} onRetry={reload}>
        {(data) => data.rows.length === 0 ? <Empty message="لا طلبات." /> : (
          <Scroller>
            <table className="w-full text-xs" dir="rtl">
              <thead className="text-stone-500">
                <tr className="text-right">
                  <th className="p-2 font-normal">الرقم</th>
                  <th className="p-2 font-normal">الطلب</th>
                  <th className="p-2 font-normal">المبلغ</th>
                  <th className="p-2 font-normal">الحدّ المنطبق</th>
                  <th className="p-2 font-normal">الحالة</th>
                  <th className="p-2 font-normal">إجراء</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const th = (r.threshold ?? {}) as Record<string, unknown>;
                  const stx = String(r.status ?? "");
                  return (
                    <tr key={String(r.id)} className={`${card} align-top`}>
                      <td className="p-2 text-stone-500" dir="ltr">{String(r.request_no ?? "")}</td>
                      <td className="p-2 text-stone-200">
                        {String(r.title ?? "")}
                        <div className="text-[10px] text-stone-600">
                          {String(r.requester_name ?? "")} · {finDate(r.spent_on as string)}
                          {r.project_label ? ` · ${String(r.project_label)}` : ""}
                        </div>
                      </td>
                      <td className="p-2"><MoneyCell row={r} /></td>
                      <td className="p-2 text-stone-400 text-[11px] leading-5">
                        {String(th.required_role ?? "—") === "owner" ? "يتطلّب المالك" : "المالية"}
                        {th.requires_second ? " · اعتماد ثانٍ" : ""}
                        {th.matched === false && <div className="text-amber-300">{String(th.message ?? "")}</div>}
                      </td>
                      <td className="p-2">
                        <Chip text={EXPENSE_STATUS_AR[stx] ?? stx}
                          tone={stx === "approved" || stx === "paid" ? "good" : stx === "rejected" ? "bad" : "warn"} />
                        {r.needs_second_approval ? <div className="text-[10px] text-amber-300 mt-1">ينتظر اعتمادًا ثانيًا</div> : null}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1 flex-wrap">
                          {canApprove && stx === "submitted" && (
                            <>
                              <button className={`${btnPrimary} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                onClick={() => void act(() => finExpenseDecide(String(r.id), "approved"), "اعتُمد الطلب وأُنشئ التزام في دفتر التكلفة.")}>
                                اعتماد
                              </button>
                              <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                onClick={() => setDec({ row: r, action: "rejected" })}>رفض</button>
                              <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                                onClick={() => setDec({ row: r, action: "returned" })}>إعادة</button>
                            </>
                          )}
                          {canApprove && stx === "approved" && r.needs_second_approval ? (
                            <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                              onClick={() => void act(() => finExpenseSecondApprove(String(r.id)), "سُجّل الاعتماد الثاني.")}>
                              اعتماد ثانٍ
                            </button>
                          ) : null}
                          {canManage && stx === "approved" && (
                            <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                              onClick={() => void act(() => finExpenseMarkPaid(String(r.id)), "سُجّل الصرف وتحوّل الالتزام إلى تكلفة فعلية.")}>
                              تسجيل الصرف
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Scroller>
        )}
      </StateView>

      <PurchaseApprovals canApprove={canApprove} tick={tick} onChange={onChange} />

      {dec && (
        <ReasonDialog
          title={dec.action === "rejected" ? "رفض الطلب" : "إعادة الطلب لصاحبه"}
          label="السبب (يصل إلى مُقدِّم الطلب ويُحفظ في التدقيق)"
          onClose={() => { setDec(null); onChange(); }}
          onConfirm={(reason) => finExpenseDecide(String(dec.row.id), dec.action, reason)}
        />
      )}
    </Section>
  );
}

function PurchaseApprovals({ canApprove, tick, onChange }: {
  canApprove: boolean; tick: number; onChange: () => void;
}) {
  const { st, reload } = useFinLoad<{ ok: boolean; requests: FinRow[]; purchase_orders: FinRow[] }>(
    () => finPurchaseList({ status: "submitted" }), [tick],
  );
  const [dec, setDec] = useState<FinRow | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  return (
    <div className="space-y-2">
      <h3 className="text-stone-300 text-xs">طلبات شراء بانتظار قرار</h3>
      {flash && <Flash msg={flash.text} tone={flash.tone} />}
      <StateView st={st} onRetry={reload}>
        {(d) => d.requests.length === 0 ? <Empty message="لا طلبات شراء معلّقة." /> : (
          <Scroller>
            <table className="w-full text-xs" dir="rtl">
              <tbody>
                {d.requests.map((r) => (
                  <tr key={String(r.id)} className={card}>
                    <td className="p-2 text-stone-500" dir="ltr">{String(r.request_no ?? "")}</td>
                    <td className="p-2 text-stone-200">{String(r.title ?? "")}</td>
                    <td className="p-2"><MoneyCell row={r} /></td>
                    {canApprove && (
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button className={`${btnPrimary} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                            onClick={async () => {
                              const x = await finPurchaseDecide(String(r.id), "approved");
                              setFlash(x.state === "ok"
                                ? { text: "اعتُمد طلب الشراء.", tone: "ok" }
                                : { text: x.message, tone: "bad" });
                              onChange();
                            }}>اعتماد</button>
                          <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                            onClick={() => setDec(r)}>رفض</button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </StateView>
      {dec && (
        <ReasonDialog
          title="رفض طلب الشراء"
          label="السبب"
          onClose={() => { setDec(null); onChange(); }}
          onConfirm={(reason) => finPurchaseDecide(String(dec.id), "rejected", reason)}
        />
      )}
    </div>
  );
}

// ─── المورّدون ─────────────────────────────────────────────────────────────

function SuppliersTab({ lookups, canManage, tick, onChange }: {
  lookups: FinLookups | null; canManage: boolean; tick: number; onChange: () => void;
}) {
  const [q, setQ] = useState("");
  const { st, reload } = useFinLoad<{ ok: boolean; rows: FinRow[] }>(() => finSuppliersList({ q }), [tick, q]);
  const d = useDialog();
  return (
    <Section
      title="المورّدون"
      note="لا يُخزَّن رقم حساب بنكيّ كامل: المرجع البنكيّ تعريفيّ فقط، فتسريب هذا الجدول لا يسلّم بيانات دفع صالحة للاستعمال."
      actions={canManage ? (
        <button className={btnPrimary} onClick={() => d.setOpen({ spec: FORM_SPECS.supplier, submit: finSupplierUpsert })}>مورّد جديد</button>
      ) : null}
    >
      <Field label="بحث"><input className={fieldCls} value={q} onChange={(e) => setQ(e.target.value)} placeholder="الاسم أو الرمز" /></Field>
      <StateView st={st} onRetry={reload}>
        {(data) => data.rows.length === 0 ? <Empty message="لا مورّدين." /> : (
          <Scroller>
            <table className="w-full text-xs" dir="rtl">
              <thead className="text-stone-500">
                <tr className="text-right">
                  <th className="p-2 font-normal">المورّد</th>
                  <th className="p-2 font-normal">النوع</th>
                  <th className="p-2 font-normal">مهلة السداد</th>
                  <th className="p-2 font-normal">الإنفاق الفعليّ</th>
                  <th className="p-2 font-normal">أوامر مفتوحة</th>
                  {canManage && <th className="p-2 font-normal">إجراء</th>}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((s) => (
                  <tr key={String(s.id)} className={card}>
                    <td className="p-2 text-stone-200">
                      {String(s.name ?? "")}
                      <div className="text-[10px] text-stone-600" dir="ltr">{String(s.code ?? "")}</div>
                    </td>
                    <td className="p-2 text-stone-400">{String(s.supplier_type ?? "")}</td>
                    <td className="p-2 text-stone-400">{String(s.payment_terms_days ?? 0)} يومًا</td>
                    <td className="p-2 text-stone-200">{finAmount(s.spend_actual_gross)}</td>
                    <td className="p-2 text-stone-400">{String(s.open_po_count ?? 0)}</td>
                    {canManage && (
                      <td className="p-2">
                        <div className="flex gap-1">
                          <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                            onClick={() => d.setOpen({ spec: FORM_SPECS.supplier, initial: s, submit: (p) => finSupplierUpsert({ ...p, id: s.id }) })}>
                            تعديل
                          </button>
                          <DeleteBtn kind="supplier" id={String(s.id)} onDone={onChange} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </StateView>
      {d.open && (
        <FinForm spec={d.open.spec} initial={d.open.initial} lookups={lookups}
          onSubmit={d.open.submit} onClose={() => { d.setOpen(null); onChange(); }} />
      )}
    </Section>
  );
}

// ─── الإعدادات: مراكز التكلفة · البنود · حدود الاعتماد ─────────────────────

function SettingsTab({ lookups, tick, onChange }: {
  lookups: FinLookups | null; tick: number; onChange: () => void;
}) {
  const { st, reload } = useFinLoad<FinLookups>(() => finLookups(), [tick]);
  const d = useDialog();
  return (
    <Section
      title="الإعدادات المالية"
      note="حدود الاعتماد يضبطها المالك وحده. قبل ضبطها كلّ مبلغ يتطلّب اعتماد المالك — افتراض مقصود لا عطل."
      actions={
        <div className="flex gap-2 flex-wrap">
          <button className={btnPrimary} onClick={() => d.setOpen({ spec: FORM_SPECS.cost_center, submit: finCostCenterUpsert })}>مركز تكلفة</button>
          <button className={btnGhost} onClick={() => d.setOpen({ spec: FORM_SPECS.category, submit: finCategoryUpsert })}>بند مصروف</button>
          <button className={btnGhost} onClick={() => d.setOpen({ spec: FORM_SPECS.threshold, submit: finThresholdUpsert })}>حدّ اعتماد</button>
        </div>
      }
    >
      <StateView st={st} onRetry={reload}>
        {(data) => (
          <div className="grid md:grid-cols-3 gap-4">
            <SimpleList title="مراكز التكلفة" empty="لا مراكز."
              rows={data.cost_centers.map((c) => ({ id: c.id, main: c.name_ar, sub: c.code }))}
              kind="cost_center" onDone={onChange} />
            <SimpleList title="بنود المصروف" empty="لا بنود."
              rows={data.categories.map((c) => ({ id: c.id, main: c.name_ar, sub: `${c.key} · ضريبة ${c.default_vat_rate}٪` }))}
              kind="category" onDone={onChange} />
            <SimpleList title="حدود الاعتماد" empty="لا حدود مضبوطة — كلّ مبلغ يتطلّب المالك."
              rows={data.thresholds.map((t) => ({
                id: String(t.id),
                main: `${t.scope === "expense" ? "صرف" : "شراء"} · ${finAmount(t.min_amount)} → ${t.max_amount ? finAmount(t.max_amount) : "بلا سقف"}`,
                sub: `${t.required_role === "owner" ? "المالك" : "المالية"}${t.requires_second_approval ? " · اعتماد ثانٍ" : ""}`,
              }))}
              kind="threshold" onDone={onChange} />
          </div>
        )}
      </StateView>
      {d.open && (
        <FinForm spec={d.open.spec} initial={d.open.initial} lookups={lookups}
          onSubmit={d.open.submit} onClose={() => { d.setOpen(null); onChange(); }} />
      )}
    </Section>
  );
}

function SimpleList({ title, rows, empty, kind, onDone }: {
  title: string;
  rows: { id: string; main: string; sub: string }[];
  empty: string;
  kind: FinDeleteKind;
  onDone: () => void;
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-stone-300 text-xs">{title}</h3>
      {rows.length === 0 ? <Empty message={empty} /> : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.id} className={`${card} p-2 flex items-center justify-between gap-2`} dir="rtl">
              <div>
                <div className="text-xs text-stone-200">{r.main}</div>
                <div className="text-[10px] text-stone-600" dir="ltr">{r.sub}</div>
              </div>
              <DeleteBtn kind={kind} id={r.id} onDone={onDone} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── التدقيق ───────────────────────────────────────────────────────────────

function AuditTab({ tick }: { tick: number }) {
  const { st, reload } = useFinLoad<{ ok: boolean; rows: FinRow[] }>(() => finAuditList({}), [tick]);
  return (
    <Section title="سجلّ التدقيق" note="كلّ كتابة حسّاسة مسجَّلة: من فعل ماذا ومتى، بما في ذلك كلّ عملية تصدير.">
      <StateView st={st} onRetry={reload}>
        {(d) => d.rows.length === 0 ? <Empty message="لا سجلّات بعد." /> : (
          <Scroller>
            <table className="w-full text-[11px]" dir="rtl">
              <tbody>
                {d.rows.map((r) => (
                  <tr key={String(r.id)} className={card}>
                    <td className="p-2 text-stone-500 whitespace-nowrap">{finDateTime(r.created_at as string)}</td>
                    <td className="p-2 text-stone-300" dir="ltr">{String(r.action ?? "")}</td>
                    <td className="p-2 text-stone-500" dir="ltr">{String(r.entity_type ?? "")}</td>
                    <td className="p-2 text-stone-400">{String(r.actor_name ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroller>
        )}
      </StateView>
    </Section>
  );
}

// ─── Zoho Books: تشخيص صادق، بلا اتصال ─────────────────────────────────────

function ZohoTab({ tick, onChange }: { tick: number; onChange: () => void }) {
  const { st, reload } = useFinLoad(() => finZohoDiagnostic(), [tick]);
  const [flash, setFlash] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  return (
    <Section
      title="Zoho Books — تشخيص الاتصال"
      note="التكامل غير مبنيّ. هذه الشاشة تقرأ صندوق صادر محلّيًّا ولا تفتح أيّ اتصال خارجيّ ولا تقرأ أيّ بيانات اعتماد. التفاصيل في docs/ZOHO_BOOKS_INTEGRATION_CONTRACT.md."
    >
      {flash && <Flash msg={flash.text} tone={flash.tone} />}
      <StateView st={st} onRetry={reload}>
        {(d) => (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="الحالة" value={d.connected ? "متّصل" : "غير متّصل"} tone={d.connected ? "good" : "warn"}
                hint={d.integration_state} />
              <Stat label="محجوز في الصادر" value={String(d.outbox.held)} />
              <Stat label="بانتظار" value={String(d.outbox.pending)} />
              <Stat label="أُرسل فعلًا" value={String(d.outbox.delivered)} hint={d.outbox.note} />
            </div>
            <ul className="space-y-1">
              {d.checks.map((c) => (
                <li key={c.key} className={`${card} p-2 text-[11px]`} dir="rtl">
                  <span className="text-stone-200" dir="ltr">{c.key}</span>
                  <span className="text-stone-500"> — {c.status}</span>
                  <div className="text-stone-500 leading-5">{c.detail}</div>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-amber-300 leading-6">{d.message}</p>
            <div className="flex gap-2 flex-wrap">
              <button className={btnGhost}
                onClick={async () => {
                  const r = await finZohoEnqueue({ event_type: "vendor.upsert", entity_type: "diagnostic" });
                  setFlash(r.state === "ok"
                    ? { text: r.data.message, tone: "ok" }
                    : { text: r.message, tone: "bad" });
                  onChange();
                }}>
                إدراج حدث تجريبيّ في الصادر
              </button>
              <ReplayBox onDone={(m, ok) => { setFlash({ text: m, tone: ok ? "ok" : "bad" }); onChange(); }} />
            </div>
          </div>
        )}
      </StateView>
    </Section>
  );
}

function ReplayBox({ onDone }: { onDone: (msg: string, ok: boolean) => void }) {
  const [id, setId] = useState("");
  return (
    <div className="flex gap-2 items-end">
      <Field label="إعادة جدولة صفّ (معرّفه)">
        <input className={fieldCls} value={id} onChange={(e) => setId(e.target.value)} dir="ltr" />
      </Field>
      <button className={btnGhost} disabled={!id.trim()}
        onClick={async () => {
          const r = await finZohoReplay(id.trim());
          onDone(r.state === "ok" ? r.data.message : r.message, r.state === "ok");
          setId("");
        }}>
        إعادة الجدولة
      </button>
    </div>
  );
}
