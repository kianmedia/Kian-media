"use client";
// ════════════════════════════════════════════════════════════════════════════
// CrmCenter — وحدة المبيعات. Mobile-first، وتبويب «فرصي» هو الافتراضيّ لغير
// المدير لأنّه ما يُفتح يوميًّا.
//
// البوّابة الحقيقية في القاعدة (crm_can_view = موظّف + مفتاح صريح). ما هنا
// تجميل: حتى لو زُوِّرت الحالة في المتصفّح فكلّ استدعاء يُرفض من الخادم.
//
// ★ لا شيء في هذا الملفّ يُنشئ مشروعًا. ربح الفرصة يُظهر بطاقة «جاهزة لإنشاء
//   يدويّ» ورابطًا إلى docs/CRM_PROJECT_HANDOFF_CONTRACT.md — لا زرّ إنشاء.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  crmAccess, crmDashboard, crmLeadsList, crmOpportunitiesList,
  crmStaleAlerts, crmActivitiesList, crmTargetsList, crmCommissionList, crmLookups,
  crmExport, crmImportLeads, crmImportKey, crmLeadUpsertRaw, crmTargetUpsert,
  LEAD_STATUS_AR, OPP_STATUS_AR, OPP_STATUS_COLOR, SOURCE_AR,
  BUDGET_AR, AUTHORITY_AR, ACTIVITY_AR, HANDOFF_AR,
  GRADE_AR, GRADE_COLOR, STALE_REASON_AR,
  crmDate, crmDateTime, crmMoney, scoreColor,
  type CrmAccess, type CrmDashboard, type CrmLeadRow, type CrmOppRow, type CrmBoard,
  type CrmStale, type CrmRow, type CrmLookups, type CrmCommissionList, type CrmDuplicates,
} from "@/lib/portal/crm";
import { csvDownload } from "@/lib/portal/csv";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Counter, Empty, Flash, Field,
  StateView, useCrmLoad, Denied, Section, Scroller, ContractNote, Bar,
} from "./CrmAtoms";
import CrmLeadPanel from "./CrmLeadPanel";
import CrmOpportunityPanel from "./CrmOpportunityPanel";

type Tab = "board" | "opps" | "leads" | "activities" | "stale" | "targets" | "commission" | "tools";
const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const N = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v ?? 0)) || 0);

export default function CrmCenter() {
  const { st: accSt, reload: reloadAcc } = useCrmLoad<CrmAccess>(() => crmAccess(), []);
  const [tab, setTab] = useState<Tab | null>(null);
  const [openLead, setOpenLead] = useState<string | null>(null);
  const [openOpp, setOpenOpp] = useState<string | null>(null);

  return (
    <StateView st={accSt} onRetry={reloadAcc}>
      {(acc) => {
        if (!acc.can_view) {
          return (
            <Denied
              message={
                acc.authenticated
                  ? (acc.message ?? "وحدة المبيعات مخصّصة لفريق العمل الداخليّ.")
                  : "سجّل الدخول للوصول إلى وحدة المبيعات."
              }
            />
          );
        }
        const tabs: { k: Tab; ar: string }[] = [
          { k: "board", ar: "خطّ الأنابيب" },
          { k: "opps", ar: "الفرص" },
          { k: "leads", ar: "العملاء المحتملون" },
          { k: "activities", ar: "الأنشطة" },
          { k: "stale", ar: "تنبيهات الركود" },
          { k: "targets", ar: "الأهداف" },
          { k: "commission", ar: "العمولات" },
          ...(acc.can_manage || acc.can_import ? [{ k: "tools" as Tab, ar: "أدوات" }] : []),
        ];
        const active: Tab = tab ?? "board";

        if (openLead) {
          return <CrmLeadPanel leadId={openLead} acc={acc} onBack={() => setOpenLead(null)}
                               onOpenOpp={(id) => { setOpenLead(null); setOpenOpp(id); }} />;
        }
        if (openOpp) return <CrmOpportunityPanel oppId={openOpp} acc={acc} onBack={() => setOpenOpp(null)} />;

        return (
          <div className="space-y-4">
            {/* شريط صدق الصلاحيات: يقول للمستخدم ما يراه ولماذا، بلا غموض */}
            <div className={`${card} px-4 py-3 flex flex-wrap items-center gap-2`}>
              <Chip tone={acc.can_manage ? "good" : "neutral"}>
                {acc.can_manage ? "مدير مبيعات" : "موظّف مبيعات"}
              </Chip>
              <Chip tone={acc.can_view_team ? "good" : "neutral"}>
                {acc.can_manage ? "يرى كلّ السجلّات"
                  : acc.can_view_team ? "يرى فريقه"
                  : acc.team_key_exists ? "يرى سجلّاته هو (بلا صلاحية الفريق)"
                  : "يرى سجلّاته هو"}
              </Chip>
              <Chip tone={acc.can_view_others_commission ? "warn" : "neutral"}>
                {acc.can_view_others_commission ? "يرى عمولات الآخرين" : "يرى عمولته هو فقط"}
              </Chip>
              {!acc.quotes_available && <Chip tone="warn">مرجع عروض السعر غير متاح</Chip>}
            </div>

            {/* تبويبات قابلة للتمرير أفقيًّا — لا تنكسر على شاشة 360px */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {tabs.map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k)}
                  className={`min-h-[44px] px-4 rounded-lg text-sm whitespace-nowrap border ${
                    active === t.k
                      ? "bg-red-800 border-red-700 text-white"
                      : "bg-stone-900 border-stone-800 text-stone-300"
                  }`}
                >
                  {t.ar}
                </button>
              ))}
            </div>

            {active === "board" && <BoardTab onOpenOpp={setOpenOpp} />}
            {active === "opps" && <OppsTab acc={acc} onOpen={setOpenOpp} />}
            {active === "leads" && <LeadsTab acc={acc} onOpen={setOpenLead} />}
            {active === "activities" && <ActivitiesTab />}
            {active === "stale" && <StaleTab onOpen={setOpenOpp} />}
            {active === "targets" && <TargetsTab acc={acc} />}
            {active === "commission" && <CommissionTab acc={acc} />}
            {active === "tools" && <ToolsTab acc={acc} />}
          </div>
        );
      }}
    </StateView>
  );
}

// ─── خطّ الأنابيب + اللوحة ─────────────────────────────────────────────────
function BoardTab({ onOpenOpp }: { onOpenOpp: (id: string) => void }) {
  const { st, reload } = useCrmLoad<CrmDashboard>(() => crmDashboard(), []);
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => {
        const c = d.counters ?? {};
        const cur = d.currency ?? "SAR";
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <Counter label="فرص مفتوحة" value={c.opps_open ?? 0} />
              <Counter label="قيمة خطّ الأنابيب" value={crmMoney(c.pipeline_value, cur)} />
              <Counter label="القيمة المرجَّحة" value={crmMoney(c.weighted_value, cur)}
                       hint="القيمة × الاحتمال" />
              <Counter label="مربوحة (٩٠ يومًا)" value={crmMoney(c.won_value_90d, cur)} tone="good" />
              <Counter label="بانتظار الإنشاء اليدويّ" value={c.awaiting_handoff ?? 0}
                       tone={(c.awaiting_handoff ?? 0) > 0 ? "warn" : "neutral"}
                       hint="فرص مربوحة سُجِّلت كجاهزة، ولم يُسجَّل بعد إنشاء مشروعها يدويًّا" />
              <Counter label="إجراءاتي المستحقّة" value={c.my_due_actions ?? 0}
                       tone={(c.my_due_actions ?? 0) > 0 ? "warn" : "good"} />
            </div>

            <BoardColumns board={d.pipeline} onOpenOpp={onOpenOpp} />

            <Section title="التنبّؤ الشهريّ" defaultOpen>
              <p className="text-[11px] text-stone-500 leading-6">{d.forecast?.method}</p>
              <Scroller>
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-stone-400 text-xs">
                      <th className="text-right py-2">الشهر</th>
                      <th className="text-right">عدد</th>
                      <th className="text-right">خطّ الأنابيب</th>
                      <th className="text-right">مرجَّح</th>
                      <th className="text-right">ملتزم</th>
                      <th className="text-right">مربوح</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d.forecast?.months ?? []).map((m) => (
                      <tr key={m.month} className="border-t border-stone-800">
                        <td className="py-2 text-stone-200 tabular-nums">{m.month}</td>
                        <td className="text-stone-300 tabular-nums">{m.count}</td>
                        <td className="text-stone-300 tabular-nums">{crmMoney(m.pipeline_value, cur)}</td>
                        <td className="text-amber-300 tabular-nums">{crmMoney(m.weighted_value, cur)}</td>
                        <td className="text-sky-300 tabular-nums">{crmMoney(m.committed_value, cur)}</td>
                        <td className="text-emerald-300 tabular-nums">{crmMoney(m.won_value, cur)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroller>
              {(d.forecast?.no_close_date?.count ?? 0) > 0 && (
                <p className="text-xs text-amber-300 leading-6">
                  {d.forecast.no_close_date.count} فرصة بلا تاريخ إغلاق متوقّع
                  ({crmMoney(d.forecast.no_close_date.pipeline_value, cur)}) — معروضة على حدة ولا تدخل أيّ شهر.
                </p>
              )}
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title="القُمع" defaultOpen count={d.funnel?.leads ?? 0}>
                <div className="space-y-2">
                  {([["leads", "عملاء محتملون"], ["qualified", "مؤهَّلون"],
                     ["converted", "محوَّلون"], ["won", "مربوحون"]] as const).map(([k, ar]) => (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-xs text-stone-400 w-28">{ar}</span>
                      <div className="flex-1">
                        <Bar score={(d.funnel?.leads ?? 0) === 0 ? 0
                          : (100 * (d.funnel?.[k] ?? 0)) / (d.funnel?.leads ?? 1)} good={101} warn={0} />
                      </div>
                      <span className="text-sm text-stone-200 tabular-nums w-10 text-left">{d.funnel?.[k] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </Section>
              <Section title="المصادر" defaultOpen count={(d.sources ?? []).length}>
                {(d.sources ?? []).length === 0 ? <Empty message="لا مصادر بعد." /> : (
                  <ul className="space-y-1">
                    {(d.sources ?? []).map((s) => (
                      <li key={s.source} className="flex justify-between text-sm">
                        <span className="text-stone-300">{SOURCE_AR[s.source] ?? s.source}</span>
                        <span className="text-stone-400 tabular-nums">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            {(d.my_targets ?? []).length > 0 && (
              <Section title="هدفي الحاليّ" defaultOpen>
                {(d.my_targets ?? []).map((t, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-stone-300">{crmDate(t.period_start)} — {crmDate(t.period_end)}</span>
                      <span className="text-stone-200 tabular-nums">
                        {crmMoney(t.achieved_value, cur)} / {crmMoney(t.target_value, cur)}
                      </span>
                    </div>
                    <Bar score={N(t.target_value) === 0 ? 0 : (100 * N(t.achieved_value)) / N(t.target_value)}
                         good={100} warn={60} />
                    <ContractNote>
                      هدفك يضعه المالك أو من يملك صلاحية الأهداف — لا يُحرَّر من هذه الشاشة ولا من أيّ شاشة أخرى بحسابك.
                    </ContractNote>
                  </div>
                ))}
              </Section>
            )}
          </div>
        );
      }}
    </StateView>
  );
}

function BoardColumns({ board, onOpenOpp }: { board: CrmBoard; onOpenOpp: (id: string) => void }) {
  const { st, reload } = useCrmLoad<{ ok: boolean; rows: CrmOppRow[]; weighted_total: number; can_manage: boolean }>(
    () => crmOpportunitiesList({ status: "open", limit: 400 }), []);
  const cols = (board?.columns ?? []).filter((c) => !c.is_lost);
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (
        <Scroller>
          <div className="flex gap-3 min-w-max pb-2">
            {cols.map((c) => {
              const rows = (d.rows ?? []).filter((r) => r.stage_id === c.stage_id);
              return (
                <div key={c.stage_id} className={`${card} p-3 w-[240px] shrink-0`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-stone-100">{c.name_ar}</span>
                    <Chip tone={c.is_won ? "good" : "neutral"}>{c.count}</Chip>
                  </div>
                  <p className="text-[11px] text-stone-500 mb-2 tabular-nums">
                    {crmMoney(c.value, board.currency)} · مرجَّح {crmMoney(c.weighted, board.currency)}
                  </p>
                  <div className="space-y-2 max-h-[340px] overflow-y-auto">
                    {rows.length === 0 && <p className="text-[11px] text-stone-600 py-2">لا فرص</p>}
                    {rows.map((r) => (
                      <button key={r.id} onClick={() => onOpenOpp(r.id)}
                        className="w-full text-right bg-stone-950 border border-stone-800 rounded-lg p-2 hover:border-stone-700">
                        <div className="text-xs text-stone-100 leading-5">{r.title}</div>
                        <div className="text-[11px] text-stone-500 mt-1 tabular-nums">
                          {crmMoney(r.estimated_value, r.currency)} · {r.probability}%
                        </div>
                        {r.next_action_due && (
                          <div className={`text-[11px] mt-1 ${
                            new Date(r.next_action_due) < new Date() ? "text-red-300" : "text-stone-500"}`}>
                            الإجراء التالي: {crmDate(r.next_action_due)}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Scroller>
      )}
    </StateView>
  );
}

// ─── الفرص ──────────────────────────────────────────────────────────────────
function OppsTab({ acc, onOpen }: { acc: CrmAccess; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const { st, reload } = useCrmLoad<{ ok: boolean; rows: CrmOppRow[]; weighted_total: number; can_manage: boolean }>(
    () => crmOpportunitiesList({ status: status || undefined, q: q || undefined, limit: 300 }), [status, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${fieldCls} flex-1 min-w-[180px]`} placeholder="بحث بالعنوان أو الرمز"
               value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${fieldCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كلّ الحالات</option>
          {Object.entries(OPP_STATUS_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
        </select>
      </div>
      <StateView st={st} onRetry={reload}>
        {(d) => (d.rows ?? []).length === 0 ? <Empty message="لا فرص ضمن صلاحيتك بهذه الفلاتر." /> : (
          <div className="space-y-2">
            <p className="text-xs text-stone-400">
              المجموع المرجَّح للمعروض: <span className="tabular-nums text-amber-300">{crmMoney(d.weighted_total)}</span>
            </p>
            {(d.rows ?? []).map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)}
                className={`${card} w-full text-right p-3 hover:border-stone-700`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-stone-100 truncate">{r.title}</div>
                    <div className="text-[11px] text-stone-500 mt-1">
                      {r.opp_code} · {S(r.company_name)} · {r.stage_name_ar}
                    </div>
                  </div>
                  <span className={`text-xs shrink-0 ${OPP_STATUS_COLOR[r.status] ?? "text-stone-300"}`}>
                    {OPP_STATUS_AR[r.status] ?? r.status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Chip>{crmMoney(r.estimated_value, r.currency)}</Chip>
                  <Chip tone={r.probability >= 70 ? "good" : "neutral"}>{r.probability}%</Chip>
                  <Chip>مرجَّح {crmMoney(r.weighted_value, r.currency)}</Chip>
                  {r.expected_close_date && <Chip>إغلاق {crmDate(r.expected_close_date)}</Chip>}
                  {r.status === "won" && (
                    <Chip tone={r.handoff_state === "manually_created" ? "good" : "warn"}>
                      {HANDOFF_AR[r.handoff_state] ?? r.handoff_state}
                    </Chip>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </StateView>
      {acc.can_view && (
        <ContractNote>
          ربح الفرصة يسجّل أنّها «جاهزة لإنشاء المشروع يدويًّا». هذه الوحدة لا تُنشئ مشاريع ولا تكتب في منصّة المشاريع.
        </ContractNote>
      )}
    </div>
  );
}

// ─── العملاء المحتملون ──────────────────────────────────────────────────────
function LeadsTab({ acc, onOpen }: { acc: CrmAccess; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const { st, reload } = useCrmLoad<{ ok: boolean; rows: CrmLeadRow[]; can_manage: boolean }>(
    () => crmLeadsList({ status: status || undefined, q: q || undefined, due_only: dueOnly, limit: 300 }),
    [status, q, dueOnly]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${fieldCls} flex-1 min-w-[180px]`} placeholder="بحث بالاسم أو الشركة أو البريد"
               value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${fieldCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كلّ الحالات</option>
          {Object.entries(LEAD_STATUS_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
        </select>
        <button className={btnGhost} onClick={() => setDueOnly((v) => !v)}>
          {dueOnly ? "الكلّ" : "المستحقّ اليوم"}
        </button>
        <button className={btnPrimary} onClick={() => setCreating((v) => !v)}>
          {creating ? "إغلاق" : "عميل جديد"}
        </button>
      </div>

      {creating && <NewLeadForm onDone={() => { setCreating(false); reload(); }} />}

      <StateView st={st} onRetry={reload}>
        {(d) => (d.rows ?? []).length === 0 ? <Empty message="لا عملاء محتملون ضمن صلاحيتك بهذه الفلاتر." /> : (
          <div className="space-y-2">
            {(d.rows ?? []).map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)}
                className={`${card} w-full text-right p-3 hover:border-stone-700`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-stone-100 truncate">{r.contact_name}</div>
                    <div className="text-[11px] text-stone-500 mt-1">
                      {r.lead_code} · {S(r.company_name)} · {SOURCE_AR[r.source] ?? r.source}
                    </div>
                  </div>
                  <div className="text-left shrink-0">
                    <div className={`text-sm tabular-nums ${scoreColor(r.score)}`}>{r.score}</div>
                    <div className={`text-[10px] ${GRADE_COLOR[r.grade] ?? "text-stone-400"}`}>
                      {GRADE_AR[r.grade] ?? r.grade}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Chip>{LEAD_STATUS_AR[r.status] ?? r.status}</Chip>
                  <Chip>{BUDGET_AR[r.budget_band] ?? r.budget_band}</Chip>
                  <Chip>{AUTHORITY_AR[r.authority] ?? r.authority}</Chip>
                  {r.next_action_due && (
                    <Chip tone={new Date(r.next_action_due) < new Date() ? "bad" : "neutral"}>
                      متابعة {crmDate(r.next_action_due)}
                    </Chip>
                  )}
                  {r.duplicate_of_id && <Chip tone="warn">مُعلَّم كتكرار</Chip>}
                </div>
              </button>
            ))}
          </div>
        )}
      </StateView>
      {!acc.can_manage && (
        <ContractNote>تعرض هذه القائمة سجلّاتك أنت. سجلّات الزملاء خارج صلاحيتك ولا تظهر هنا ولا في التصدير.</ContractNote>
      )}
    </div>
  );
}

/** نموذج إنشاء عميل — يعرض المطابقات المحتملة قبل الإنشاء لا بعده. */
function NewLeadForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState<Record<string, string>>({ contact_name: "", company_name: "", email: "", phone: "", source: "website" });
  const [dups, setDups] = useState<CrmDuplicates | null>(null);
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(confirm: boolean) {
    setBusy(true); setMsg(null);
    const r = await crmLeadUpsertRaw({ ...f, confirm_duplicate: confirm });
    setBusy(false);
    if (r.kind === "ok") { setMsg({ t: "أُنشئ العميل المحتمل.", tone: "ok" }); onDone(); return; }
    if (r.kind === "duplicate") { setDups(r.duplicates); setMsg({ t: r.message, tone: "bad" }); return; }
    setMsg({ t: r.state.state === "ok" ? "" : r.state.message, tone: "bad" });
  }

  return (
    <div className={`${card} p-4 space-y-3`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="اسم الشخص *"><input className={fieldCls} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></Field>
        <Field label="الشركة"><input className={fieldCls} value={f.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
        <Field label="البريد"><input className={fieldCls} dir="ltr" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="الهاتف"><input className={fieldCls} dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="المصدر">
          <select className={fieldCls} value={f.source} onChange={(e) => set("source", e.target.value)}>
            {Object.entries(SOURCE_AR).filter(([k]) => k !== "import").map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
          </select>
        </Field>
        <Field label="تفصيل المصدر"><input className={fieldCls} value={f.source_detail ?? ""} onChange={(e) => set("source_detail", e.target.value)} /></Field>
      </div>
      {msg && <Flash text={msg.t} tone={msg.tone} />}
      {dups && (dups.candidates ?? []).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-amber-300">مطابقات محتملة ({dups.candidates.length}):</p>
          {dups.candidates.map((c) => (
            <div key={c.lead_id} className="text-[11px] text-stone-400 bg-stone-950 border border-stone-800 rounded-lg p-2">
              {c.visible
                ? <>مطابقة على {c.match_on === "email" ? "البريد" : c.match_on === "phone" ? "الهاتف" : "الشركة والاسم"} — {S(c.lead_code)} · {S(c.contact_name)} · {S(c.company_name)} · {crmDate(c.created_at)}</>
                : <>{c.note}</>}
            </div>
          ))}
          <button className={btnGhost} disabled={busy} onClick={() => void submit(true)}>
            راجعتُها — أنشئ سجلًّا جديدًا رغم ذلك
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy || !f.contact_name.trim()} onClick={() => void submit(false)}>
          إنشاء
        </button>
      </div>
    </div>
  );
}

// ─── الأنشطة ────────────────────────────────────────────────────────────────
function ActivitiesTab() {
  const [kind, setKind] = useState("");
  const [dueOnly, setDueOnly] = useState(false);
  const { st, reload } = useCrmLoad<{ ok: boolean; rows: CrmRow[] }>(
    () => crmActivitiesList({ kind: kind || undefined, follow_up_due_only: dueOnly, limit: 200 }), [kind, dueOnly]);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={`${fieldCls} w-auto`} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">كلّ الأنواع</option>
          {Object.entries(ACTIVITY_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
        </select>
        <button className={btnGhost} onClick={() => setDueOnly((v) => !v)}>
          {dueOnly ? "الكلّ" : "متابعات مستحقّة"}
        </button>
      </div>
      <StateView st={st} onRetry={reload}>
        {(d) => (d.rows ?? []).length === 0 ? <Empty message="لا أنشطة ضمن صلاحيتك." /> : (
          <div className="space-y-2">
            {(d.rows ?? []).map((a) => (
              <div key={String(a.id)} className={`${card} p-3`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-stone-100">{S(a.subject)}</span>
                  <Chip>{ACTIVITY_AR[String(a.kind) as keyof typeof ACTIVITY_AR] ?? S(a.kind)}</Chip>
                </div>
                {a.body ? <p className="text-xs text-stone-400 mt-1 leading-6 whitespace-pre-wrap">{S(a.body)}</p> : null}
                <div className="text-[11px] text-stone-500 mt-2">
                  {crmDateTime(String(a.occurred_at))}
                  {a.follow_up_due ? ` · متابعة ${crmDate(String(a.follow_up_due))}` : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </StateView>
    </div>
  );
}

// ─── تنبيهات الركود ─────────────────────────────────────────────────────────
function StaleTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { st, reload } = useCrmLoad<CrmStale>(() => crmStaleAlerts(), []);
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (d.rows ?? []).length === 0
        ? <Empty message="لا فرص راكدة — كلّ الفرص المفتوحة عليها نشاط وإجراء تالٍ." />
        : (
          <div className="space-y-2">
            <p className="text-xs text-stone-400">
              العتبة: {d.stale_days} يومًا بلا نشاط · {d.stage_days} يومًا بلا تغيير مرحلة.
            </p>
            {(d.rows ?? []).map((r) => (
              <button key={r.opportunity_id} onClick={() => onOpen(r.opportunity_id)}
                className={`${card} w-full text-right p-3 hover:border-stone-700`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-stone-100 truncate">{r.title}</span>
                  <span className="text-[11px] text-stone-500 shrink-0">{r.opp_code}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(r.reasons ?? []).map((x) => (
                    <Chip key={x} tone={x === "close_date_passed" ? "bad" : "warn"}>{STALE_REASON_AR[x] ?? x}</Chip>
                  ))}
                </div>
                <div className="text-[11px] text-stone-500 mt-2">
                  {r.stage_name_ar} · في المرحلة {r.days_in_stage} يومًا ·
                  {r.days_since_activity === null ? " بلا نشاط إطلاقًا" : ` آخر نشاط قبل ${r.days_since_activity} يومًا`}
                </div>
              </button>
            ))}
          </div>
        )}
    </StateView>
  );
}

// ─── الأهداف ────────────────────────────────────────────────────────────────
function TargetsTab({ acc }: { acc: CrmAccess }) {
  const { st, reload } = useCrmLoad<{ ok: boolean; rows: CrmRow[]; can_manage_targets: boolean }>(
    () => crmTargetsList(), []);
  const [form, setForm] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);

  async function save() {
    const r = await crmTargetUpsert(form);
    if (r.state === "ok") { setMsg({ t: "حُفظ الهدف.", tone: "ok" }); setForm({}); reload(); }
    else setMsg({ t: r.message, tone: "bad" });
  }

  return (
    <div className="space-y-3">
      <StateView st={st} onRetry={reload}>
        {(d) => (
          <div className="space-y-2">
            {(d.rows ?? []).length === 0 && <Empty message="لا أهداف مسجّلة ضمن صلاحيتك." />}
            {(d.rows ?? []).map((t) => {
              const tv = N(t.target_value), av = N(t.achieved_value);
              return (
                <div key={String(t.id)} className={`${card} p-3 space-y-2`}>
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-200">{crmDate(String(t.period_start))} — {crmDate(String(t.period_end))}</span>
                    <span className="text-stone-300 tabular-nums">{crmMoney(av, String(t.currency))} / {crmMoney(tv, String(t.currency))}</span>
                  </div>
                  <Bar score={tv === 0 ? 0 : (100 * av) / tv} good={100} warn={60} />
                  <div className="flex justify-between text-[11px] text-stone-500">
                    <span>صفقات: {N(t.achieved_count)} / {N(t.target_count)}</span>
                    <span>{t.can_edit ? "قابل للتحرير من حسابك" : "غير قابل للتحرير من حسابك"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </StateView>

      {acc.can_manage_targets ? (
        <div className={`${card} p-4 space-y-3`}>
          <h3 className="text-sm text-stone-100">تعيين هدف لموظّف</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="معرّف الموظّف (UUID)">
              <input className={fieldCls} dir="ltr" value={form.owner_user_id ?? ""}
                     onChange={(e) => setForm((p) => ({ ...p, owner_user_id: e.target.value }))} />
            </Field>
            <Field label="نوع الفترة">
              <select className={fieldCls} value={form.period_type ?? "month"}
                      onChange={(e) => setForm((p) => ({ ...p, period_type: e.target.value }))}>
                <option value="month">شهر</option><option value="quarter">ربع</option><option value="year">سنة</option>
              </select>
            </Field>
            <Field label="من"><input type="date" className={fieldCls} value={form.period_start ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, period_start: e.target.value }))} /></Field>
            <Field label="إلى"><input type="date" className={fieldCls} value={form.period_end ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, period_end: e.target.value }))} /></Field>
            <Field label="قيمة الهدف"><input type="number" className={fieldCls} value={form.target_value ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, target_value: e.target.value }))} /></Field>
            <Field label="عدد الصفقات"><input type="number" className={fieldCls} value={form.target_count ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, target_count: e.target.value }))} /></Field>
          </div>
          {msg && <Flash text={msg.t} tone={msg.tone} />}
          <button className={btnPrimary} onClick={() => void save()}>حفظ الهدف</button>
          <ContractNote>
            الخادم يرفض تعيين هدف لنفسك ما لم تكن المالك. الرفض يأتي من قاعدة البيانات لا من هذه الشاشة.
          </ContractNote>
        </div>
      ) : (
        <ContractNote>الأهداف تُعرض ولا تُحرَّر من حسابك. تعيينها صلاحية منفصلة (crm.manage_targets).</ContractNote>
      )}
    </div>
  );
}

// ─── العمولات ───────────────────────────────────────────────────────────────
function CommissionTab({ acc }: { acc: CrmAccess }) {
  const { st, reload } = useCrmLoad<CrmCommissionList>(() => crmCommissionList(), []);
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (
        <div className="space-y-3">
          {d.note && <p className="text-xs text-stone-400 leading-6">{d.note}</p>}
          {(d.rows ?? []).length === 0 ? <Empty message="لا سجلّات عمولة ضمن صلاحيتك." /> : (
            <Scroller>
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-stone-400 text-xs">
                    <th className="text-right py-2">الفرصة</th>
                    <th className="text-right">الأساس</th>
                    <th className="text-right">النسبة</th>
                    <th className="text-right">المبلغ</th>
                    <th className="text-right">الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.rows ?? []).map((r) => (
                    <tr key={String(r.id)} className="border-t border-stone-800">
                      <td className="py-2 text-stone-200">{S(r.opp_code)} · {S(r.title)}</td>
                      <td className="text-stone-300 tabular-nums">{crmMoney(N(r.basis_value), String(r.currency))}</td>
                      <td className="text-stone-300 tabular-nums">{N(r.rate_pct)}%</td>
                      <td className="text-emerald-300 tabular-nums">{crmMoney(N(r.amount), String(r.currency))}</td>
                      <td className="text-stone-400">{S(r.status) === "approved" ? "معتمدة" : S(r.status) === "void" ? "ملغاة" : "مسوّدة"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroller>
          )}
          {d.plans && (
            <Section title="خطط العمولات" count={d.plans.length}>
              {d.plans.length === 0 ? <Empty message="لا خطط." /> : (
                <ul className="space-y-2">
                  {d.plans.map((p) => (
                    <li key={String(p.id)} className="text-sm text-stone-300 flex justify-between">
                      <span>{S(p.name)}</span>
                      <span className="tabular-nums text-stone-400">{N(p.rate_pct)}% · عتبة {crmMoney(N(p.threshold_value), String(p.currency))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}
          {!acc.can_view_others_commission && (
            <ContractNote>
              نِسَب الخطط وعمولات الزملاء لا تُعرض لك ولا تخرج في أيّ تصدير. هذه صلاحية حسّاسة مستقلّة (crm.view_commission)
              ولا يمنحها كونك مدير مبيعات.
            </ContractNote>
          )}
        </div>
      )}
    </StateView>
  );
}

// ─── أدوات: تصدير · استيراد · قواعد الدرجة ─────────────────────────────────
function ToolsTab({ acc }: { acc: CrmAccess }) {
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const { st } = useCrmLoad<CrmLookups>(() => crmLookups(), []);

  async function doExport(entity: "leads" | "opportunities" | "activities") {
    setBusy(true); setMsg(null);
    const r = await crmExport(entity);
    setBusy(false);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    const rows = [r.data.columns as unknown as (string | number | null)[], ...(r.data.rows ?? [])];
    csvDownload(`crm_${entity}_${new Date().toISOString().slice(0, 10)}`, rows);
    setMsg({ t: `صُدِّر ${r.data.rows.length} صفًّا. ${r.data.note}`, tone: "ok" });
  }

  async function doImport(file: File) {
    setBusy(true); setMsg(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) { setBusy(false); setMsg({ t: "الملفّ فارغ أو غير مقروء.", tone: "bad" }); return; }
    const key = crmImportKey(file.name, parsed.length, String(parsed[0].contact_name ?? ""));
    const r = await crmImportLeads(parsed, key);
    setBusy(false);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    setMsg({
      t: r.data.idempotent
        ? `هذه الدفعة مُستوردة سابقًا بنفس المفتاح — لم يُدرج شيء جديد (أُدرج سابقًا ${r.data.inserted}).`
        : `أُدرج ${r.data.inserted} · تكرار ${r.data.duplicates} · أخطاء ${r.data.errors}.`,
      tone: "ok",
    });
  }

  return (
    <div className="space-y-4">
      <Section title="التصدير (CSV)" defaultOpen>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} disabled={busy} onClick={() => void doExport("leads")}>العملاء المحتملون</button>
          <button className={btnGhost} disabled={busy} onClick={() => void doExport("opportunities")}>الفرص</button>
          <button className={btnGhost} disabled={busy} onClick={() => void doExport("activities")}>الأنشطة</button>
        </div>
        <ContractNote>
          التصدير يخرج بما تراه أنت فقط، ولا يحتوي أعمدة عمولة أو نِسَب إطلاقًا. كلّ تصدير مُدقَّق في سجلّ التدقيق.
        </ContractNote>
      </Section>

      {acc.can_import && (
        <Section title="الاستيراد (CSV)" defaultOpen>
          <p className="text-xs text-stone-400 leading-6">
            الأعمدة المتوقّعة: contact_name · company_name · email · phone · city · industry · source_detail · notes ·
            external_ref. الصفوف المطابقة لسجلّ قائم تُعدّ تكرارًا ولا تُدرج.
          </p>
          <input type="file" accept=".csv,text/csv" className={fieldCls} disabled={busy}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) void doImport(f); }} />
          <ContractNote>
            مفتاح التكرار يُشتقّ من اسم الملفّ وعدد صفوفه؛ رفع الملفّ نفسه مرّتين يعيد نتيجة المرّة الأولى ولا يُدرج نسخًا.
          </ContractNote>
        </Section>
      )}

      <Section title="قواعد درجة العميل">
        <StateView st={st}>
          {(l) => (
            <div className="space-y-2">
              <p className="text-xs text-stone-400 leading-6">
                الدرجة ليست صندوقًا أسود: هي مجموع القواعد المطابقة أدناه، زائد أيّ تعديل يدويّ معلَن بسببه.
              </p>
              <Scroller>
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-stone-400 text-xs">
                      <th className="text-right py-2">القاعدة</th>
                      <th className="text-right">الحقل</th>
                      <th className="text-right">الشرط</th>
                      <th className="text-right">النقاط</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(l.score_rules ?? []).map((r) => (
                      <tr key={String(r.id)} className="border-t border-stone-800">
                        <td className="py-2 text-stone-200">{S(r.label_ar)}</td>
                        <td className="text-stone-400 text-xs">{S(r.field)}</td>
                        <td className="text-stone-400 text-xs">{S(r.operator)}</td>
                        <td className={`tabular-nums ${N(r.points) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{N(r.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroller>
              {!acc.can_manage_scoring && (
                <ContractNote>تحرير القواعد صلاحية مستقلّة (crm.manage_scoring).</ContractNote>
              )}
            </div>
          )}
        </StateView>
      </Section>

      {msg && <Flash text={msg.t} tone={msg.tone} />}
    </div>
  );
}

/**
 * قارئ CSV بسيط للاستيراد: يدعم الاقتباس المزدوج والفواصل داخل الحقول وسطور
 * CRLF وBOM. عمدًا بلا اعتماد خارجيّ، وعمدًا يتعامل مع النصّ كنصّ — لا يُقيَّم
 * ولا يُحقن في أيّ استعلام (الإدراج يمرّ بـRPC واحدة بمعاملات مربوطة).
 */
export function parseCsv(text: string): Record<string, string>[] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let cur: string[] = [], val = "", q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { val += '"'; i++; } else q = false; }
      else val += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { cur.push(val); val = ""; }
    else if (ch === "\n") { cur.push(val); rows.push(cur); cur = []; val = ""; }
    else if (ch === "\r") { /* تُتجاهل: CRLF */ }
    else val += ch;
  }
  if (val !== "" || cur.length) { cur.push(val); rows.push(cur); }
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const o: Record<string, string> = {};
      head.forEach((h, i) => { if (h) o[h] = (r[i] ?? "").trim(); });
      return o;
    });
}
