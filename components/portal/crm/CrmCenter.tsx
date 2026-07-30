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
  crmExport, crmImportLeads, crmImportPreview, crmImportKey, crmLeadUpsertRaw, crmTargetUpsert,
  crmOpportunitySetStage, crmApprovalsList, crmApprovalDecide, crmApprovalWithdraw,
  LEAD_STATUS_AR, OPP_STATUS_AR, OPP_STATUS_COLOR, SOURCE_AR,
  BUDGET_AR, AUTHORITY_AR, ACTIVITY_AR, HANDOFF_AR,
  GRADE_AR, GRADE_COLOR, STALE_REASON_AR,
  LEAD_STATUS_EN, OPP_STATUS_EN, SOURCE_EN, ACTIVITY_EN, GRADE_EN, STALE_REASON_EN, HANDOFF_EN,
  APPROVAL_KIND_AR, APPROVAL_KIND_EN, APPROVAL_STATUS_AR, APPROVAL_STATUS_EN,
  IMPORT_DECISION_AR, IMPORT_DECISION_EN, IMPORT_ISSUE_AR, IMPORT_ISSUE_EN,
  crmLabel, crmDate, crmDateTime, crmMoney, scoreColor,
  type CrmAccess, type CrmDashboard, type CrmLeadRow, type CrmOppRow, type CrmBoard,
  type CrmStale, type CrmRow, type CrmLookups, type CrmCommissionList, type CrmDuplicates,
  type CrmApprovals, type CrmImportPreview, type CrmStageColumn,
} from "@/lib/portal/crm";
import { csvDownload } from "@/lib/portal/csv";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Counter, Empty, Flash, Field,
  StateView, useCrmLoad, useCrmT, Denied, Section, Scroller, ContractNote, Bar,
} from "./CrmAtoms";
import CrmLeadPanel from "./CrmLeadPanel";
import CrmOpportunityPanel from "./CrmOpportunityPanel";

type Tab = "board" | "opps" | "leads" | "activities" | "stale" | "targets"
         | "commission" | "approvals" | "tools";
const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const N = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v ?? 0)) || 0);

export default function CrmCenter() {
  const { st: accSt, reload: reloadAcc } = useCrmLoad<CrmAccess>(() => crmAccess(), []);
  const { t } = useCrmT();
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
                  ? (acc.message ?? t({ ar: "وحدة المبيعات مخصّصة لفريق العمل الداخليّ.",
                                        en: "The CRM module is for internal staff only." }))
                  : t({ ar: "سجّل الدخول للوصول إلى وحدة المبيعات.", en: "Sign in to reach the CRM module." })
              }
            />
          );
        }
        const tabs: { k: Tab; label: string; badge?: number }[] = [
          { k: "board", label: t({ ar: "خطّ الأنابيب", en: "Pipeline" }) },
          { k: "opps", label: t({ ar: "الفرص", en: "Opportunities" }) },
          { k: "leads", label: t({ ar: "العملاء المحتملون", en: "Leads" }) },
          { k: "activities", label: t({ ar: "الأنشطة", en: "Activities" }) },
          { k: "stale", label: t({ ar: "تنبيهات الركود", en: "Stale alerts" }) },
          { k: "targets", label: t({ ar: "الأهداف", en: "Targets" }) },
          { k: "commission", label: t({ ar: "العمولات", en: "Commission" }) },
          // صندوق الاعتماد يظهر لمن يعتمد ولمن ينتظر قرارًا — لا لغيرهما.
          ...(acc.can_approve_changes || acc.can_manage_targets || acc.can_manage_commission
            ? [{ k: "approvals" as Tab, label: t({ ar: "اعتماد المالك", en: "Owner approvals" }),
                 badge: acc.approvals_pending }]
            : []),
          ...(acc.can_manage || acc.can_import
            ? [{ k: "tools" as Tab, label: t({ ar: "أدوات", en: "Tools" }) }]
            : []),
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
                {acc.can_manage ? t({ ar: "مدير مبيعات", en: "Sales manager" })
                                : t({ ar: "موظّف مبيعات", en: "Sales employee" })}
              </Chip>
              <Chip tone={acc.can_view_team ? "good" : "neutral"}>
                {acc.can_manage ? t({ ar: "يرى كلّ السجلّات", en: "Sees every record" })
                  : acc.can_view_team ? t({ ar: "يرى فريقه", en: "Sees their team" })
                  : acc.team_key_exists
                    ? t({ ar: "يرى سجلّاته هو (بلا صلاحية الفريق)",
                          en: "Sees own records (no team permission)" })
                    : t({ ar: "يرى سجلّاته هو", en: "Sees own records" })}
              </Chip>
              <Chip tone={acc.can_view_others_commission ? "warn" : "neutral"}>
                {acc.can_view_others_commission
                  ? t({ ar: "يرى عمولات الآخرين", en: "Sees others' commission" })
                  : t({ ar: "يرى عمولته هو فقط", en: "Sees own commission only" })}
              </Chip>
              {/* ★ صدق الاعتماد: من لا يعتمد يعرف ذلك قبل أن يضغط «حفظ» لا بعده */}
              <Chip tone={acc.can_approve_changes ? "good" : "neutral"}>
                {acc.can_approve_changes
                  ? t({ ar: "يعتمد الأهداف والعمولات", en: "Approves targets & commission" })
                  : t({ ar: "الأهداف والعمولات تحتاج اعتماد المالك",
                        en: "Targets & commission need owner approval" })}
              </Chip>
              {!acc.quotes_available && (
                <Chip tone="warn">
                  {t({ ar: "مرجع عروض السعر غير متاح", en: "Quote reference unavailable" })}
                </Chip>
              )}
            </div>

            {/* تبويبات قابلة للتمرير أفقيًّا — لا تنكسر على شاشة 360px */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {tabs.map((tb) => (
                <button
                  key={tb.k}
                  onClick={() => setTab(tb.k)}
                  className={`min-h-[44px] px-4 rounded-lg text-sm whitespace-nowrap border ${
                    active === tb.k
                      ? "bg-red-800 border-red-700 text-white"
                      : "bg-stone-900 border-stone-800 text-stone-300"
                  }`}
                >
                  {tb.label}
                  {typeof tb.badge === "number" && tb.badge > 0 && (
                    <span className="ms-2 inline-block px-1.5 rounded bg-amber-900 text-amber-200 text-[11px] tabular-nums">
                      {tb.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {active === "board" && <BoardTab acc={acc} onOpenOpp={setOpenOpp} />}
            {active === "opps" && <OppsTab acc={acc} onOpen={setOpenOpp} />}
            {active === "leads" && <LeadsTab acc={acc} onOpen={setOpenLead} />}
            {active === "activities" && <ActivitiesTab />}
            {active === "stale" && <StaleTab onOpen={setOpenOpp} />}
            {active === "targets" && <TargetsTab acc={acc} />}
            {active === "commission" && <CommissionTab acc={acc} />}
            {active === "approvals" && <ApprovalsTab acc={acc} />}
            {active === "tools" && <ToolsTab acc={acc} />}
          </div>
        );
      }}
    </StateView>
  );
}

// ─── خطّ الأنابيب + اللوحة ─────────────────────────────────────────────────
function BoardTab({ acc, onOpenOpp }: { acc: CrmAccess; onOpenOpp: (id: string) => void }) {
  const { st, reload } = useCrmLoad<CrmDashboard>(() => crmDashboard(), []);
  const { t, isAr } = useCrmT();
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => {
        const c = d.counters ?? {};
        const cur = d.currency ?? "SAR";
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              <Counter label={t({ ar: "فرص مفتوحة", en: "Open opportunities" })} value={c.opps_open ?? 0} />
              <Counter label={t({ ar: "قيمة خطّ الأنابيب", en: "Pipeline value" })}
                       value={crmMoney(c.pipeline_value, cur)} />
              <Counter label={t({ ar: "القيمة المرجَّحة", en: "Weighted value" })}
                       value={crmMoney(c.weighted_value, cur)}
                       hint={t({ ar: "القيمة × الاحتمال", en: "value × probability" })} />
              <Counter label={t({ ar: "مربوحة (٩٠ يومًا)", en: "Won (90 days)" })}
                       value={crmMoney(c.won_value_90d, cur)} tone="good" />
              <Counter label={t({ ar: "بانتظار الإنشاء اليدويّ", en: "Awaiting manual creation" })}
                       value={c.awaiting_handoff ?? 0}
                       tone={(c.awaiting_handoff ?? 0) > 0 ? "warn" : "neutral"}
                       hint={t({ ar: "فرص مربوحة سُجِّلت كجاهزة، ولم يُسجَّل بعد إنشاء مشروعها يدويًّا",
                                 en: "Won deals marked ready, with no manual project creation recorded yet" })} />
              <Counter label={t({ ar: "إجراءاتي المستحقّة", en: "My due actions" })} value={c.my_due_actions ?? 0}
                       tone={(c.my_due_actions ?? 0) > 0 ? "warn" : "good"} />
            </div>

            <BoardColumns board={d.pipeline} acc={acc} onOpenOpp={onOpenOpp} onMoved={reload} />

            <Section title={t({ ar: "التنبّؤ الشهريّ", en: "Monthly forecast" })} defaultOpen>
              <p className="text-[11px] text-stone-500 leading-6">{d.forecast?.method}</p>
              <Scroller>
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="text-stone-400 text-xs">
                      <th className="text-start py-2">{t({ ar: "الشهر", en: "Month" })}</th>
                      <th className="text-start">{t({ ar: "عدد", en: "Count" })}</th>
                      <th className="text-start">{t({ ar: "خطّ الأنابيب", en: "Pipeline" })}</th>
                      <th className="text-start">{t({ ar: "مرجَّح", en: "Weighted" })}</th>
                      <th className="text-start">{t({ ar: "ملتزم", en: "Committed" })}</th>
                      <th className="text-start">{t({ ar: "مربوح", en: "Won" })}</th>
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
                  {t({
                    ar: `${d.forecast.no_close_date.count} فرصة بلا تاريخ إغلاق متوقّع (${crmMoney(d.forecast.no_close_date.pipeline_value, cur)}) — معروضة على حدة ولا تدخل أيّ شهر.`,
                    en: `${d.forecast.no_close_date.count} opportunities with no expected close date (${crmMoney(d.forecast.no_close_date.pipeline_value, cur)}) — shown separately and counted in no month.`,
                  })}
                </p>
              )}
            </Section>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Section title={t({ ar: "القُمع", en: "Funnel" })} defaultOpen count={d.funnel?.leads ?? 0}>
                <div className="space-y-2">
                  {([["leads", "عملاء محتملون", "Leads"], ["qualified", "مؤهَّلون", "Qualified"],
                     ["converted", "محوَّلون", "Converted"], ["won", "مربوحون", "Won"]] as const).map(([k, ar, en]) => (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-xs text-stone-400 w-28">{t({ ar, en })}</span>
                      <div className="flex-1">
                        <Bar score={(d.funnel?.leads ?? 0) === 0 ? 0
                          : (100 * (d.funnel?.[k] ?? 0)) / (d.funnel?.leads ?? 1)} good={101} warn={0} />
                      </div>
                      <span className="text-sm text-stone-200 tabular-nums w-10 text-left">{d.funnel?.[k] ?? 0}</span>
                    </div>
                  ))}
                </div>
              </Section>
              <Section title={t({ ar: "المصادر", en: "Sources" })} defaultOpen count={(d.sources ?? []).length}>
                {(d.sources ?? []).length === 0
                  ? <Empty message={t({ ar: "لا مصادر بعد.", en: "No sources yet." })} /> : (
                  <ul className="space-y-1">
                    {(d.sources ?? []).map((s) => (
                      <li key={s.source} className="flex justify-between text-sm">
                        <span className="text-stone-300">{crmLabel(SOURCE_AR, SOURCE_EN, s.source, isAr)}</span>
                        <span className="text-stone-400 tabular-nums">{s.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            </div>

            {(d.my_targets ?? []).length > 0 && (
              <Section title={t({ ar: "هدفي الحاليّ", en: "My current target" })} defaultOpen>
                {(d.my_targets ?? []).map((row, i) => (
                  <div key={i} className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-stone-300">{crmDate(row.period_start)} — {crmDate(row.period_end)}</span>
                      <span className="text-stone-200 tabular-nums">
                        {crmMoney(row.achieved_value, cur)} / {crmMoney(row.target_value, cur)}
                      </span>
                    </div>
                    <Bar score={N(row.target_value) === 0 ? 0 : (100 * N(row.achieved_value)) / N(row.target_value)}
                         good={100} warn={60} />
                    <ContractNote>
                      {t({ ar: "هدفك يضعه المالك أو من يملك صلاحية الأهداف، ولا يصير نافذًا إلّا باعتماد المالك — ولا يُحرَّر من هذه الشاشة ولا من أيّ شاشة أخرى بحسابك.",
                           en: "Your target is set by the owner or a targets-permission holder and only takes effect on owner approval — it is not editable from this screen or any other under your account." })}
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

/**
 * ★★ اللوحة بالسحب والإفلات.
 *
 * القاعدة الحاكمة: **الإفلات اقتراح لا قرار.** لا شيء هنا يقرّر أنّ النقل جائز؛
 * كلّ إفلات ينادي crm_opportunity_set_stage، والخادم يعيد فحص:
 *   • crm_can_edit_opportunity (فرصة لست مالكها ⇒ not authorized)
 *   • أنّ المرحلة تتبع خطّ الأنابيب نفسه، وأنّ الفرصة ما زالت مفتوحة
 *   • أنّ مرحلتَي الربح/الخسارة لا تُضبطان بالتحريك
 * ولذلك التفاؤل هنا **محدود ومرتجَع**: البطاقة تنتقل بصريًّا، وإن رفض الخادم
 * تعود إلى مكانها وتظهر رسالته الحرفيّة. إخفاء الرفض أسوأ من منعه.
 *
 * وللمس: السحب لا يعمل على الجوّال، فلكلّ بطاقة قائمة «نقل إلى» تنادي المسار
 * نفسه بالضبط — لا مسار ثانٍ بصلاحيات مختلفة.
 */
function BoardColumns({
  board, acc, onOpenOpp, onMoved,
}: {
  board: CrmBoard; acc: CrmAccess; onOpenOpp: (id: string) => void; onMoved?: () => void;
}) {
  const { st, reload } = useCrmLoad<{ ok: boolean; rows: CrmOppRow[]; weighted_total: number; can_manage: boolean }>(
    () => crmOpportunitiesList({ status: "open", limit: 400 }), []);
  const { t, isAr } = useCrmT();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<string | null>(null);
  /** نقل متفائل مؤقّت — يُمحى فور ردّ الخادم، نجح أو فشل. */
  const [pending, setPending] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);

  const cols = (board?.columns ?? []).filter((c) => !c.is_lost && !c.is_won);
  const closing = (board?.columns ?? []).filter((c) => c.is_won || c.is_lost);

  async function move(oppId: string, stage: CrmStageColumn, fromStage: string) {
    if (stage.stage_id === fromStage) return;
    if (stage.is_won || stage.is_lost) {
      setMsg({ t: t({ ar: "الربح والخسارة يُضبطان من شاشة إغلاق الفرصة لا بتحريك البطاقة.",
                      en: "Won/Lost are set from the close screen, not by moving the card." }), tone: "bad" });
      return;
    }
    setBusyId(oppId);
    setPending((p) => ({ ...p, [oppId]: stage.stage_id }));   // تفاؤل مؤقّت
    setMsg(null);
    const r = await crmOpportunitySetStage(oppId, stage.stage_id);
    setBusyId(null);
    setPending((p) => { const n = { ...p }; delete n[oppId]; return n; });  // ← يُمحى دائمًا
    if (r.state !== "ok") {
      // الرفض يظهر بنصّ الخادم، والبطاقة ترجع لأنّ التفاؤل مُحي قبل هذا السطر.
      setMsg({ t: r.message, tone: "bad" });
      return;
    }
    setMsg({ t: t({ ar: `نُقلت إلى «${stage.name_ar}».`, en: `Moved to “${stage.name_en || stage.name_ar}”.` }), tone: "ok" });
    reload();
    onMoved?.();
  }

  return (
    <StateView st={st} onRetry={reload}>
      {(d) => {
        const rowsOf = (stageId: string) =>
          (d.rows ?? []).filter((r) => (pending[r.id] ?? r.stage_id) === stageId);
        return (
          <div className="space-y-2">
            <p className="text-[11px] text-stone-500 leading-6">
              {acc.can_manage
                ? t({ ar: "اسحب البطاقة بين المراحل — أو استعمل «نقل إلى» على الجوّال. كلّ نقل يُعاد فحصه في الخادم، وإن رُفض تعود البطاقة وتظهر لك رسالة الرفض.",
                      en: "Drag a card between stages — or use “Move to” on mobile. Every move is re-checked on the server; if it is refused the card returns and the refusal is shown." })
                : t({ ar: "تستطيع تحريك فرصك أنت فقط. تحريك فرصة زميل يُرفض من الخادم لا من الشاشة.",
                      en: "You can only move your own opportunities. Moving a colleague's is refused by the server, not by this screen." })}
            </p>
            {msg && <Flash text={msg.t} tone={msg.tone} />}
            <Scroller>
              <div className="flex gap-3 min-w-max pb-2">
                {cols.map((c) => {
                  const rows = rowsOf(c.stage_id);
                  const hot = overStage === c.stage_id && dragId !== null;
                  return (
                    <div
                      key={c.stage_id}
                      onDragOver={(e) => { e.preventDefault(); setOverStage(c.stage_id); }}
                      onDragLeave={() => setOverStage((s) => (s === c.stage_id ? null : s))}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain") || dragId;
                        const from = (d.rows ?? []).find((r) => r.id === id)?.stage_id ?? "";
                        setOverStage(null); setDragId(null);
                        if (id) void move(id, c, from);
                      }}
                      className={`${card} p-3 w-[240px] shrink-0 transition-colors ${
                        hot ? "border-red-700 bg-stone-900/80" : ""}`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-stone-100">{isAr ? c.name_ar : (c.name_en || c.name_ar)}</span>
                        <Chip tone={c.is_won ? "good" : "neutral"}>{c.count}</Chip>
                      </div>
                      <p className="text-[11px] text-stone-500 mb-2 tabular-nums">
                        {crmMoney(c.value, board.currency)} · {t({ ar: "مرجَّح", en: "weighted" })}{" "}
                        {crmMoney(c.weighted, board.currency)}
                      </p>
                      <div className="space-y-2 max-h-[340px] overflow-y-auto">
                        {rows.length === 0 && (
                          <p className="text-[11px] text-stone-600 py-2">
                            {t({ ar: "لا فرص", en: "No opportunities" })}
                          </p>
                        )}
                        {rows.map((r) => (
                          <div
                            key={r.id}
                            draggable={busyId !== r.id}
                            onDragStart={(e) => { setDragId(r.id); e.dataTransfer.setData("text/plain", r.id); }}
                            onDragEnd={() => { setDragId(null); setOverStage(null); }}
                            className={`bg-stone-950 border rounded-lg p-2 ${
                              busyId === r.id ? "opacity-50 border-stone-700" : "border-stone-800 hover:border-stone-700"
                            } ${dragId === r.id ? "ring-1 ring-red-700" : ""}`}
                          >
                            <button type="button" onClick={() => onOpenOpp(r.id)} className="w-full text-start">
                              <div className="text-xs text-stone-100 leading-5">{r.title}</div>
                              <div className="text-[11px] text-stone-500 mt-1 tabular-nums">
                                {crmMoney(r.estimated_value, r.currency)} · {r.probability}%
                              </div>
                              {r.next_action_due && (
                                <div className={`text-[11px] mt-1 ${
                                  new Date(r.next_action_due) < new Date() ? "text-red-300" : "text-stone-500"}`}>
                                  {t({ ar: "الإجراء التالي:", en: "Next action:" })} {crmDate(r.next_action_due)}
                                </div>
                              )}
                            </button>
                            {/* بديل اللمس: المسار نفسه، لا مسار موازٍ بصلاحيات أخرى */}
                            <select
                              aria-label={t({ ar: "نقل إلى مرحلة", en: "Move to stage" })}
                              disabled={busyId === r.id}
                              value=""
                              onChange={(e) => {
                                const target = cols.find((x) => x.stage_id === e.target.value);
                                e.currentTarget.value = "";
                                if (target) void move(r.id, target, r.stage_id);
                              }}
                              className="mt-2 w-full min-h-[36px] bg-stone-900 border border-stone-800 rounded-md px-2 text-[11px] text-stone-300"
                            >
                              <option value="">{t({ ar: "نقل إلى…", en: "Move to…" })}</option>
                              {cols.filter((x) => x.stage_id !== r.stage_id).map((x) => (
                                <option key={x.stage_id} value={x.stage_id}>
                                  {isAr ? x.name_ar : (x.name_en || x.name_ar)}
                                </option>
                              ))}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Scroller>
            {closing.length > 0 && (
              <ContractNote>
                {t({
                  ar: `مرحلتا ${closing.map((c) => c.name_ar).join(" و")} لا تُدرَجان في السحب: الربح والخسارة يُسجَّلان من شاشة الإغلاق بسبب صريح.`,
                  en: `The ${closing.map((c) => c.name_en || c.name_ar).join(" and ")} stages are not drop targets: won/lost are recorded from the close screen with an explicit reason.`,
                })}
              </ContractNote>
            )}
          </div>
        );
      }}
    </StateView>
  );
}

// ─── الفرص ──────────────────────────────────────────────────────────────────
function OppsTab({ acc, onOpen }: { acc: CrmAccess; onOpen: (id: string) => void }) {
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const { t, isAr } = useCrmT();
  const { st, reload } = useCrmLoad<{ ok: boolean; rows: CrmOppRow[]; weighted_total: number; can_manage: boolean }>(
    () => crmOpportunitiesList({ status: status || undefined, q: q || undefined, limit: 300 }), [status, q]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${fieldCls} flex-1 min-w-[180px]`}
               placeholder={t({ ar: "بحث بالعنوان أو الرمز", en: "Search by title or code" })}
               value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${fieldCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t({ ar: "كلّ الحالات", en: "All statuses" })}</option>
          {Object.keys(OPP_STATUS_AR).map((k) => (
            <option key={k} value={k}>{crmLabel(OPP_STATUS_AR, OPP_STATUS_EN, k, isAr)}</option>
          ))}
        </select>
      </div>
      <StateView st={st} onRetry={reload}>
        {(d) => (d.rows ?? []).length === 0
          ? <Empty message={t({ ar: "لا فرص ضمن صلاحيتك بهذه الفلاتر.",
                                en: "No opportunities visible to you with these filters." })} /> : (
          <div className="space-y-2">
            <p className="text-xs text-stone-400">
              {t({ ar: "المجموع المرجَّح للمعروض:", en: "Weighted total of what is shown:" })}{" "}
              <span className="tabular-nums text-amber-300">{crmMoney(d.weighted_total)}</span>
            </p>
            {(d.rows ?? []).map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)}
                className={`${card} w-full text-start p-3 hover:border-stone-700`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-stone-100 truncate">{r.title}</div>
                    <div className="text-[11px] text-stone-500 mt-1">
                      {r.opp_code} · {S(r.company_name)} · {r.stage_name_ar}
                    </div>
                  </div>
                  <span className={`text-xs shrink-0 ${OPP_STATUS_COLOR[r.status] ?? "text-stone-300"}`}>
                    {crmLabel(OPP_STATUS_AR, OPP_STATUS_EN, r.status, isAr)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Chip>{crmMoney(r.estimated_value, r.currency)}</Chip>
                  <Chip tone={r.probability >= 70 ? "good" : "neutral"}>{r.probability}%</Chip>
                  <Chip>{t({ ar: "مرجَّح", en: "weighted" })} {crmMoney(r.weighted_value, r.currency)}</Chip>
                  {r.expected_close_date && (
                    <Chip>{t({ ar: "إغلاق", en: "close" })} {crmDate(r.expected_close_date)}</Chip>
                  )}
                  {r.status === "won" && (
                    <Chip tone={r.handoff_state === "manually_created" ? "good" : "warn"}>
                      {crmLabel(HANDOFF_AR, HANDOFF_EN, r.handoff_state, isAr)}
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
          {t({ ar: "ربح الفرصة يسجّل أنّها «جاهزة لإنشاء المشروع يدويًّا». هذه الوحدة لا تُنشئ مشاريع ولا تكتب في منصّة المشاريع.",
               en: "Winning a deal records it as “ready for manual project creation”. This module creates no project and writes nothing to the project platform." })}
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
  const { t, isAr } = useCrmT();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input className={`${fieldCls} flex-1 min-w-[180px]`}
               placeholder={t({ ar: "بحث بالاسم أو الشركة أو البريد", en: "Search by name, company or email" })}
               value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={`${fieldCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t({ ar: "كلّ الحالات", en: "All statuses" })}</option>
          {Object.keys(LEAD_STATUS_AR).map((k) => (
            <option key={k} value={k}>{crmLabel(LEAD_STATUS_AR, LEAD_STATUS_EN, k, isAr)}</option>
          ))}
        </select>
        <button className={btnGhost} onClick={() => setDueOnly((v) => !v)}>
          {dueOnly ? t({ ar: "الكلّ", en: "All" }) : t({ ar: "المستحقّ اليوم", en: "Due today" })}
        </button>
        <button className={btnPrimary} onClick={() => setCreating((v) => !v)}>
          {creating ? t({ ar: "إغلاق", en: "Close" }) : t({ ar: "عميل جديد", en: "New lead" })}
        </button>
      </div>

      {creating && <NewLeadForm onDone={() => { setCreating(false); reload(); }} />}

      <StateView st={st} onRetry={reload}>
        {(d) => (d.rows ?? []).length === 0
          ? <Empty message={t({ ar: "لا عملاء محتملون ضمن صلاحيتك بهذه الفلاتر.",
                                en: "No leads visible to you with these filters." })} /> : (
          <div className="space-y-2">
            {(d.rows ?? []).map((r) => (
              <button key={r.id} onClick={() => onOpen(r.id)}
                className={`${card} w-full text-start p-3 hover:border-stone-700`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm text-stone-100 truncate">{r.contact_name}</div>
                    <div className="text-[11px] text-stone-500 mt-1">
                      {r.lead_code} · {S(r.company_name)} · {crmLabel(SOURCE_AR, SOURCE_EN, r.source, isAr)}
                    </div>
                  </div>
                  <div className="text-end shrink-0">
                    <div className={`text-sm tabular-nums ${scoreColor(r.score)}`}>{r.score}</div>
                    <div className={`text-[10px] ${GRADE_COLOR[r.grade] ?? "text-stone-400"}`}>
                      {crmLabel(GRADE_AR, GRADE_EN, r.grade, isAr)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  <Chip>{crmLabel(LEAD_STATUS_AR, LEAD_STATUS_EN, r.status, isAr)}</Chip>
                  <Chip>{BUDGET_AR[r.budget_band] ?? r.budget_band}</Chip>
                  <Chip>{AUTHORITY_AR[r.authority] ?? r.authority}</Chip>
                  {r.next_action_due && (
                    <Chip tone={new Date(r.next_action_due) < new Date() ? "bad" : "neutral"}>
                      {t({ ar: "متابعة", en: "follow-up" })} {crmDate(r.next_action_due)}
                    </Chip>
                  )}
                  {r.duplicate_of_id && (
                    <Chip tone="warn">{t({ ar: "مُعلَّم كتكرار", en: "Flagged as duplicate" })}</Chip>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </StateView>
      {!acc.can_manage && (
        <ContractNote>
          {t({ ar: "تعرض هذه القائمة سجلّاتك أنت. سجلّات الزملاء خارج صلاحيتك ولا تظهر هنا ولا في التصدير.",
               en: "This list shows your own records. Colleagues' records are outside your permission and appear neither here nor in an export." })}
        </ContractNote>
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
  const { t, isAr } = useCrmT();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function submit(confirm: boolean) {
    setBusy(true); setMsg(null);
    const r = await crmLeadUpsertRaw({ ...f, confirm_duplicate: confirm });
    setBusy(false);
    if (r.kind === "ok") {
      setMsg({ t: t({ ar: "أُنشئ العميل المحتمل.", en: "Lead created." }), tone: "ok" });
      onDone(); return;
    }
    if (r.kind === "duplicate") { setDups(r.duplicates); setMsg({ t: r.message, tone: "bad" }); return; }
    setMsg({ t: r.state.state === "ok" ? "" : r.state.message, tone: "bad" });
  }

  return (
    <div className={`${card} p-4 space-y-3`}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t({ ar: "اسم الشخص *", en: "Contact name *" })}><input className={fieldCls} value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} /></Field>
        <Field label={t({ ar: "الشركة", en: "Company" })}><input className={fieldCls} value={f.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
        <Field label={t({ ar: "البريد", en: "Email" })}><input className={fieldCls} dir="ltr" value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label={t({ ar: "الهاتف", en: "Phone" })}><input className={fieldCls} dir="ltr" value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label={t({ ar: "المصدر", en: "Source" })}
               hint={t({ ar: "المصدر إلزاميّ: بلا مصدر لا يُعرف من أين يأتي العمل فعلًا.",
                         en: "Source is required: without it you cannot tell where the business actually comes from." })}>
          <select className={fieldCls} value={f.source} onChange={(e) => set("source", e.target.value)}>
            {Object.keys(SOURCE_AR).filter((k) => k !== "import").map((k) => (
              <option key={k} value={k}>{crmLabel(SOURCE_AR, SOURCE_EN, k, isAr)}</option>
            ))}
          </select>
        </Field>
        <Field label={t({ ar: "تفصيل المصدر", en: "Source detail" })}><input className={fieldCls} value={f.source_detail ?? ""} onChange={(e) => set("source_detail", e.target.value)} /></Field>
      </div>
      {msg && <Flash text={msg.t} tone={msg.tone} />}
      {dups && (dups.candidates ?? []).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs text-amber-300">
            {t({ ar: "مطابقات محتملة", en: "Possible matches" })} ({dups.candidates.length}):
          </p>
          {dups.candidates.map((c) => (
            <div key={c.lead_id} className="text-[11px] text-stone-400 bg-stone-950 border border-stone-800 rounded-lg p-2">
              {c.visible
                ? <>{t({ ar: "مطابقة على", en: "Matched on" })}{" "}
                    {c.match_on === "email" ? t({ ar: "البريد", en: "email" })
                      : c.match_on === "phone" ? t({ ar: "الهاتف", en: "phone" })
                      : t({ ar: "الشركة والاسم", en: "company + name" })} — {S(c.lead_code)} · {S(c.contact_name)} · {S(c.company_name)} · {crmDate(c.created_at)}</>
                : <>{c.note}</>}
            </div>
          ))}
          <button className={btnGhost} disabled={busy} onClick={() => void submit(true)}>
            {t({ ar: "راجعتُها — أنشئ سجلًّا جديدًا رغم ذلك",
                 en: "I reviewed them — create a new record anyway" })}
          </button>
        </div>
      )}
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy || !f.contact_name.trim()} onClick={() => void submit(false)}>
          {t({ ar: "إنشاء", en: "Create" })}
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
  const { t, isAr } = useCrmT();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={`${fieldCls} w-auto`} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t({ ar: "كلّ الأنواع", en: "All kinds" })}</option>
          {Object.keys(ACTIVITY_AR).map((k) => (
            <option key={k} value={k}>{crmLabel(ACTIVITY_AR, ACTIVITY_EN, k, isAr)}</option>
          ))}
        </select>
        <button className={btnGhost} onClick={() => setDueOnly((v) => !v)}>
          {dueOnly ? t({ ar: "الكلّ", en: "All" }) : t({ ar: "متابعات مستحقّة", en: "Due follow-ups" })}
        </button>
      </div>
      <StateView st={st} onRetry={reload}>
        {(d) => (d.rows ?? []).length === 0
          ? <Empty message={t({ ar: "لا أنشطة ضمن صلاحيتك.", en: "No activities visible to you." })} /> : (
          <div className="space-y-2">
            {(d.rows ?? []).map((a) => (
              <div key={String(a.id)} className={`${card} p-3`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-stone-100">{S(a.subject)}</span>
                  <Chip>{crmLabel(ACTIVITY_AR, ACTIVITY_EN, String(a.kind), isAr)}</Chip>
                </div>
                {a.body ? <p className="text-xs text-stone-400 mt-1 leading-6 whitespace-pre-wrap">{S(a.body)}</p> : null}
                <div className="text-[11px] text-stone-500 mt-2">
                  {crmDateTime(String(a.occurred_at))}
                  {a.follow_up_due
                    ? ` · ${t({ ar: "متابعة", en: "follow-up" })} ${crmDate(String(a.follow_up_due))}`
                    : ""}
                </div>
              </div>
            ))}
          </div>
        )}
      </StateView>
      <ContractNote>
        {t({ ar: "«ملاحظة واتساب» و«بريد» تسجيلان لما جرى — لا تُرسل هذه الوحدة رسالة واحدة إلى أحد.",
             en: "“WhatsApp note” and “Email note” record what happened — this module sends no message to anyone." })}
      </ContractNote>
    </div>
  );
}

// ─── تنبيهات الركود ─────────────────────────────────────────────────────────
function StaleTab({ onOpen }: { onOpen: (id: string) => void }) {
  const { st, reload } = useCrmLoad<CrmStale>(() => crmStaleAlerts(), []);
  const { t, isAr } = useCrmT();
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (d.rows ?? []).length === 0
        ? <Empty message={t({ ar: "لا فرص راكدة — كلّ الفرص المفتوحة عليها نشاط وإجراء تالٍ.",
                              en: "No stale opportunities — every open one has activity and a next action." })} />
        : (
          <div className="space-y-2">
            <p className="text-xs text-stone-400">
              {t({ ar: `العتبة: ${d.stale_days} يومًا بلا نشاط · ${d.stage_days} يومًا بلا تغيير مرحلة.`,
                   en: `Threshold: ${d.stale_days} days without activity · ${d.stage_days} days without a stage change.` })}
            </p>
            {(d.rows ?? []).map((r) => (
              <button key={r.opportunity_id} onClick={() => onOpen(r.opportunity_id)}
                className={`${card} w-full text-start p-3 hover:border-stone-700`}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-stone-100 truncate">{r.title}</span>
                  <span className="text-[11px] text-stone-500 shrink-0">{r.opp_code}</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(r.reasons ?? []).map((x) => (
                    <Chip key={x} tone={x === "close_date_passed" ? "bad" : "warn"}>
                      {crmLabel(STALE_REASON_AR, STALE_REASON_EN, x, isAr)}
                    </Chip>
                  ))}
                </div>
                <div className="text-[11px] text-stone-500 mt-2">
                  {r.stage_name_ar} ·{" "}
                  {t({ ar: `في المرحلة ${r.days_in_stage} يومًا`, en: `${r.days_in_stage} days in stage` })} ·{" "}
                  {r.days_since_activity === null
                    ? t({ ar: "بلا نشاط إطلاقًا", en: "no activity at all" })
                    : t({ ar: `آخر نشاط قبل ${r.days_since_activity} يومًا`,
                          en: `last activity ${r.days_since_activity} days ago` })}
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
  const { t: tr } = useCrmT();

  /**
   * ★ صدق الحفظ: الخادم يعيد pending_approval لغير المالك، ولم يتغيّر أيّ هدف.
   *   عرض «حُفظ الهدف» هنا كذبٌ يجعل المستخدم يظنّ أنّ رقمه صار نافذًا.
   */
  async function save() {
    const r = await crmTargetUpsert(form);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    if (r.data.pending_approval) {
      setMsg({
        t: r.data.message ?? tr({
          ar: "أُرسل الطلب لاعتماد المالك. لم يتغيّر أيّ هدف بعد.",
          en: "Sent for owner approval. No target has changed yet.",
        }),
        tone: "ok",
      });
      setForm({});
      return;                       // لا reload: لا شيء تغيّر لتُعاد قراءته
    }
    setMsg({ t: tr({ ar: "حُفظ الهدف.", en: "Target saved." }), tone: "ok" });
    setForm({});
    reload();
  }

  return (
    <div className="space-y-3">
      <StateView st={st} onRetry={reload}>
        {(d) => (
          <div className="space-y-2">
            {(d.rows ?? []).length === 0 && (
              <Empty message={tr({ ar: "لا أهداف مسجّلة ضمن صلاحيتك.", en: "No targets visible to you." })} />
            )}
            {(d.rows ?? []).map((row) => {
              const tv = N(row.target_value), av = N(row.achieved_value);
              return (
                <div key={String(row.id)} className={`${card} p-3 space-y-2`}>
                  <div className="flex justify-between text-sm">
                    <span className="text-stone-200">{crmDate(String(row.period_start))} — {crmDate(String(row.period_end))}</span>
                    <span className="text-stone-300 tabular-nums">{crmMoney(av, String(row.currency))} / {crmMoney(tv, String(row.currency))}</span>
                  </div>
                  <Bar score={tv === 0 ? 0 : (100 * av) / tv} good={100} warn={60} />
                  <div className="flex justify-between text-[11px] text-stone-500">
                    <span>{tr({ ar: "صفقات:", en: "Deals:" })} {N(row.achieved_count)} / {N(row.target_count)}</span>
                    <span>
                      {row.can_edit
                        ? tr({ ar: "قابل للتحرير من حسابك", en: "Editable from your account" })
                        : tr({ ar: "غير قابل للتحرير من حسابك", en: "Not editable from your account" })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </StateView>

      {acc.can_manage_targets ? (
        <div className={`${card} p-4 space-y-3`}>
          <h3 className="text-sm text-stone-100">
            {tr({ ar: "تعيين هدف لموظّف", en: "Set a target for an employee" })}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={tr({ ar: "معرّف الموظّف (UUID)", en: "Employee id (UUID)" })}>
              <input className={fieldCls} dir="ltr" value={form.owner_user_id ?? ""}
                     onChange={(e) => setForm((p) => ({ ...p, owner_user_id: e.target.value }))} />
            </Field>
            <Field label={tr({ ar: "نوع الفترة", en: "Period type" })}>
              <select className={fieldCls} value={form.period_type ?? "month"}
                      onChange={(e) => setForm((p) => ({ ...p, period_type: e.target.value }))}>
                <option value="month">{tr({ ar: "شهر", en: "Month" })}</option>
                <option value="quarter">{tr({ ar: "ربع", en: "Quarter" })}</option>
                <option value="year">{tr({ ar: "سنة", en: "Year" })}</option>
              </select>
            </Field>
            <Field label={tr({ ar: "من", en: "From" })}><input type="date" className={fieldCls} value={form.period_start ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, period_start: e.target.value }))} /></Field>
            <Field label={tr({ ar: "إلى", en: "To" })}><input type="date" className={fieldCls} value={form.period_end ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, period_end: e.target.value }))} /></Field>
            <Field label={tr({ ar: "قيمة الهدف", en: "Target value" })}><input type="number" className={fieldCls} value={form.target_value ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, target_value: e.target.value }))} /></Field>
            <Field label={tr({ ar: "عدد الصفقات", en: "Deal count" })}><input type="number" className={fieldCls} value={form.target_count ?? ""}
                   onChange={(e) => setForm((p) => ({ ...p, target_count: e.target.value }))} /></Field>
            <Field label={tr({ ar: "سبب الطلب (يراه المالك)", en: "Request reason (the owner sees it)" })}
                   hint={tr({ ar: "اختياريّ للمالك، ومفيد جدًّا لغيره: القرار بلا سبب يُرفض غالبًا.",
                              en: "Optional for the owner, valuable otherwise: a reasonless request is usually rejected." })}>
              <input className={fieldCls} value={form.request_reason ?? ""}
                     onChange={(e) => setForm((p) => ({ ...p, request_reason: e.target.value }))} />
            </Field>
          </div>
          {msg && <Flash text={msg.t} tone={msg.tone} />}
          <button className={btnPrimary} onClick={() => void save()}>
            {acc.can_approve_changes
              ? tr({ ar: "حفظ الهدف", en: "Save target" })
              : tr({ ar: "إرسال لاعتماد المالك", en: "Send for owner approval" })}
          </button>
          <ContractNote>
            {acc.can_approve_changes
              ? tr({ ar: "أنت المالك: الحفظ هنا يغيّر الهدف فورًا ويُدقَّق باسمك.",
                     en: "You are the owner: saving here changes the target immediately and is audited under your name." })
              : tr({ ar: "الهدف لا يتغيّر بضغطة منك. الزرّ يُنشئ طلبًا، والمالك وحده يعتمده — والاعتماد هو لحظة التغيير.",
                     en: "Your click does not change the target. It creates a request; only the owner approves it — and approval is the moment of change." })}
          </ContractNote>
          <ContractNote>
            {tr({ ar: "الخادم يرفض تعيين هدف لنفسك ما لم تكن المالك. الرفض يأتي من قاعدة البيانات لا من هذه الشاشة.",
                  en: "The server refuses a target you set for yourself unless you are the owner. That refusal comes from the database, not this screen." })}
          </ContractNote>
        </div>
      ) : (
        <ContractNote>
          {tr({ ar: "الأهداف تُعرض ولا تُحرَّر من حسابك. تعيينها صلاحية منفصلة (crm.manage_targets)، واعتمادها للمالك وحده.",
                en: "Targets are shown, not editable from your account. Setting them is a separate permission (crm.manage_targets), and approving them is the owner's alone." })}
        </ContractNote>
      )}
    </div>
  );
}

// ─── العمولات ───────────────────────────────────────────────────────────────
function CommissionTab({ acc }: { acc: CrmAccess }) {
  const { st, reload } = useCrmLoad<CrmCommissionList>(() => crmCommissionList(), []);
  const { t } = useCrmT();
  return (
    <StateView st={st} onRetry={reload}>
      {(d) => (
        <div className="space-y-3">
          {d.note && <p className="text-xs text-stone-400 leading-6">{d.note}</p>}
          {(d.rows ?? []).length === 0
            ? <Empty message={t({ ar: "لا سجلّات عمولة ضمن صلاحيتك.",
                                  en: "No commission records visible to you." })} /> : (
            <Scroller>
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-stone-400 text-xs">
                    <th className="text-start py-2">{t({ ar: "الفرصة", en: "Opportunity" })}</th>
                    <th className="text-start">{t({ ar: "الأساس", en: "Basis" })}</th>
                    <th className="text-start">{t({ ar: "النسبة", en: "Rate" })}</th>
                    <th className="text-start">{t({ ar: "المبلغ", en: "Amount" })}</th>
                    <th className="text-start">{t({ ar: "الحالة", en: "Status" })}</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.rows ?? []).map((r) => (
                    <tr key={String(r.id)} className="border-t border-stone-800">
                      <td className="py-2 text-stone-200">{S(r.opp_code)} · {S(r.title)}</td>
                      <td className="text-stone-300 tabular-nums">{crmMoney(N(r.basis_value), String(r.currency))}</td>
                      <td className="text-stone-300 tabular-nums">{N(r.rate_pct)}%</td>
                      <td className="text-emerald-300 tabular-nums">{crmMoney(N(r.amount), String(r.currency))}</td>
                      <td className="text-stone-400">
                        {S(r.status) === "approved" ? t({ ar: "معتمدة", en: "Approved" })
                          : S(r.status) === "void" ? t({ ar: "ملغاة", en: "Void" })
                          : t({ ar: "مسوّدة", en: "Draft" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Scroller>
          )}
          {d.plans && (
            <Section title={t({ ar: "خطط العمولات", en: "Commission plans" })} count={d.plans.length}>
              {d.plans.length === 0 ? <Empty message={t({ ar: "لا خطط.", en: "No plans." })} /> : (
                <ul className="space-y-2">
                  {d.plans.map((p) => (
                    <li key={String(p.id)} className="text-sm text-stone-300 flex justify-between">
                      <span>{S(p.name)}</span>
                      <span className="tabular-nums text-stone-400">
                        {N(p.rate_pct)}% · {t({ ar: "عتبة", en: "threshold" })}{" "}
                        {crmMoney(N(p.threshold_value), String(p.currency))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <ContractNote>
                {t({ ar: "قاعدة العمولة لا تتغيّر بمفتاح صلاحية: حاملُ crm.manage_commission يقترح، والمالك وحده يعتمد من تبويب «اعتماد المالك».",
                     en: "A commission rule does not change by permission key: a crm.manage_commission holder proposes, and only the owner approves from the “Owner approvals” tab." })}
              </ContractNote>
            </Section>
          )}
          {!acc.can_view_others_commission && (
            <ContractNote>
              {t({ ar: "نِسَب الخطط وعمولات الزملاء لا تُعرض لك ولا تخرج في أيّ تصدير. هذه صلاحية حسّاسة مستقلّة (crm.view_commission) ولا يمنحها كونك مدير مبيعات.",
                   en: "Plan rates and colleagues' commission are not shown to you and never leave in an export. That is a separate sensitive permission (crm.view_commission) — being a sales manager does not grant it." })}
            </ContractNote>
          )}
        </div>
      )}
    </StateView>
  );
}

// ─── ★ صندوق اعتماد المالك ─────────────────────────────────────────────────
/**
 * الطلب المعلَّق **ليس** تغييرًا: لا يظهر في هدف ولا في عمولة ولا في تنبّؤ.
 * ولذلك هذه الشاشة تعرض ما **سيصير** لا ما صار، وتفصل بوضوح بين «مقدَّم منّي»
 * و«بانتظار قراري». من لا يعتمد لا يرى زرّ اعتماد — والمنع الحقيقيّ في الخادم.
 */
function ApprovalsTab({ acc }: { acc: CrmAccess }) {
  const [status, setStatus] = useState("pending");
  const { st, reload } = useCrmLoad<CrmApprovals>(
    () => crmApprovalsList({ status: status || undefined, limit: 200 }), [status]);
  const { t, isAr } = useCrmT();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);

  async function decide(id: string, decision: "approved" | "rejected") {
    setBusy(id); setMsg(null);
    const r = await crmApprovalDecide(id, decision, note[id]);
    setBusy(null);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    setMsg({
      t: decision === "approved"
        ? t({ ar: "اعتُمد الطلب وطُبِّق التغيير.", en: "Approved — the change is now applied." })
        : t({ ar: "رُفض الطلب ولم يتغيّر شيء.", en: "Rejected — nothing changed." }),
      tone: "ok",
    });
    reload();
  }

  async function withdraw(id: string) {
    const reason = note[id];
    if (!reason || reason.trim().length < 3) {
      setMsg({ t: t({ ar: "اكتب سبب السحب (٣ أحرف على الأقلّ).", en: "Write a withdrawal reason (3+ characters)." }), tone: "bad" });
      return;
    }
    setBusy(id); setMsg(null);
    const r = await crmApprovalWithdraw(id, reason);
    setBusy(null);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    setMsg({ t: t({ ar: "سُحب الطلب.", en: "Request withdrawn." }), tone: "ok" });
    reload();
  }

  const money = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className={`${fieldCls} w-auto`} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="pending">{t({ ar: "بانتظار المالك", en: "Awaiting owner" })}</option>
          <option value="approved">{t({ ar: "معتمَد", en: "Approved" })}</option>
          <option value="rejected">{t({ ar: "مرفوض", en: "Rejected" })}</option>
          <option value="withdrawn">{t({ ar: "مسحوب", en: "Withdrawn" })}</option>
          <option value="">{t({ ar: "الكلّ", en: "All" })}</option>
        </select>
      </div>
      {msg && <Flash text={msg.t} tone={msg.tone} />}
      <StateView st={st} onRetry={reload}>
        {(d) => (
          <div className="space-y-2">
            <p className="text-xs text-stone-400 leading-6">{d.note}</p>
            {(d.rows ?? []).length === 0 ? (
              <Empty message={t({ ar: "لا طلبات بهذه الحالة.", en: "No requests in this state." })} />
            ) : (
              (d.rows ?? []).map((r) => {
                const p = (r.payload ?? {}) as Record<string, unknown>;
                return (
                  <div key={r.id} className={`${card} p-3 space-y-2`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip tone={r.status === "pending" ? "warn" : r.status === "approved" ? "good" : "neutral"}>
                        {crmLabel(APPROVAL_STATUS_AR, APPROVAL_STATUS_EN, r.status, isAr)}
                      </Chip>
                      <span className="text-sm text-stone-100">
                        {crmLabel(APPROVAL_KIND_AR, APPROVAL_KIND_EN, r.kind, isAr)}
                      </span>
                      <span className="text-[11px] text-stone-500 ms-auto">{crmDateTime(r.requested_at)}</span>
                    </div>

                    {/* ما سيتغيّر بالضبط — لا «تفاصيل الطلب» غامضة */}
                    <div className="text-[11px] text-stone-400 leading-6 space-y-0.5">
                      {r.subject_user_id && (
                        <div dir="ltr" className="text-start">
                          {t({ ar: "الموظّف", en: "Employee" })}: {r.subject_user_id}
                        </div>
                      )}
                      {"target_value" in p && (
                        <div>{t({ ar: "قيمة الهدف المطلوبة", en: "Requested target value" })}: {money(p.target_value)}</div>
                      )}
                      {"rate_pct" in p && (
                        <div>{t({ ar: "النسبة المطلوبة", en: "Requested rate" })}: {money(p.rate_pct)}%</div>
                      )}
                      {"period_start" in p && (
                        <div>{t({ ar: "الفترة", en: "Period" })}: {money(p.period_start)} — {money(p.period_end)}</div>
                      )}
                      {r.reason && <div>{t({ ar: "السبب", en: "Reason" })}: {r.reason}</div>}
                      {r.apply_error && (
                        <div className="text-red-300">
                          {t({ ar: "تعذّر التطبيق", en: "Apply failed" })}: {r.apply_error}
                        </div>
                      )}
                      {r.decided_at && (
                        <div>
                          {t({ ar: "بُتّ في", en: "Decided" })}: {crmDateTime(r.decided_at)}
                          {r.decision_note ? ` · ${r.decision_note}` : ""}
                        </div>
                      )}
                    </div>

                    {r.status === "pending" && (
                      <div className="space-y-2">
                        <input className={fieldCls} value={note[r.id] ?? ""}
                               placeholder={t({ ar: "ملاحظة القرار / سبب السحب", en: "Decision note / withdrawal reason" })}
                               onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))} />
                        <div className="flex flex-wrap gap-2">
                          {d.can_approve && (
                            <>
                              <button className={btnPrimary} disabled={busy === r.id}
                                      onClick={() => void decide(r.id, "approved")}>
                                {t({ ar: "اعتماد وتطبيق", en: "Approve & apply" })}
                              </button>
                              <button className={btnGhost} disabled={busy === r.id}
                                      onClick={() => void decide(r.id, "rejected")}>
                                {t({ ar: "رفض", en: "Reject" })}
                              </button>
                            </>
                          )}
                          <button className={btnGhost} disabled={busy === r.id} onClick={() => void withdraw(r.id)}>
                            {t({ ar: "سحب الطلب", en: "Withdraw" })}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
            <ContractNote>
              {acc.can_approve_changes
                ? t({ ar: "اعتمادك هو لحظة وقوع التغيير: قبله لم يتغيّر هدف ولا نسبة، وبعده يُدقَّق التغيير باسمك.",
                      en: "Your approval is the moment of change: before it no target or rate moved; after it the change is audited under your name." })
                : t({ ar: "الاعتماد للمالك وحده ولا يُمنح بمفتاح صلاحية. طلبك محفوظ ومرئيّ له، ولا يؤثّر في أيّ رقم قبل قراره.",
                      en: "Approval belongs to the owner alone and cannot be granted by a permission key. Your request is stored and visible to them, and affects no number before their decision." })}
            </ContractNote>
          </div>
        )}
      </StateView>
    </div>
  );
}

// ─── أدوات: تصدير · استيراد · قواعد الدرجة ─────────────────────────────────
function ToolsTab({ acc }: { acc: CrmAccess }) {
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);
  const [busy, setBusy] = useState(false);
  const { st } = useCrmLoad<CrmLookups>(() => crmLookups(), []);
  const { t, isAr } = useCrmT();
  /** الملفّ المُحلَّل + معاينته. لا إدراج ما دام هذا هو كلّ ما لدينا. */
  const [staged, setStaged] = useState<
    { name: string; key: string; rows: Record<string, string>[]; preview: CrmImportPreview } | null>(null);

  async function doExport(entity: "leads" | "opportunities" | "activities") {
    setBusy(true); setMsg(null);
    const r = await crmExport(entity);
    setBusy(false);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    const rows = [r.data.columns as unknown as (string | number | null)[], ...(r.data.rows ?? [])];
    csvDownload(`crm_${entity}_${new Date().toISOString().slice(0, 10)}`, rows);
    setMsg({
      t: t({ ar: `صُدِّر ${r.data.rows.length} صفًّا. ${r.data.note}`,
             en: `Exported ${r.data.rows.length} rows. ${r.data.note}` }),
      tone: "ok",
    });
  }

  /**
   * ★★ الخطوة الأولى: **معاينة فقط**. اختيار الملفّ لم يعد يعني الإدراج.
   *    crm_import_preview دالّة STABLE على الخادم فلا تستطيع الكتابة أصلًا.
   */
  async function doPreview(file: File) {
    setBusy(true); setMsg(null); setStaged(null);
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length === 0) {
      setBusy(false);
      setMsg({ t: t({ ar: "الملفّ فارغ أو غير مقروء.", en: "The file is empty or unreadable." }), tone: "bad" });
      return;
    }
    const key = crmImportKey(file.name, parsed.length, String(parsed[0].contact_name ?? ""));
    const r = await crmImportPreview(parsed, key);
    setBusy(false);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    setStaged({ name: file.name, key, rows: parsed, preview: r.data });
  }

  /** الخطوة الثانية: التنفيذ — بقرار صريح من المستخدم بعد أن رأى الأرقام. */
  async function doExecute() {
    if (!staged) return;
    setBusy(true); setMsg(null);
    const r = await crmImportLeads(staged.rows, staged.key);
    setBusy(false);
    if (r.state !== "ok") { setMsg({ t: r.message, tone: "bad" }); return; }
    setMsg({
      t: r.data.idempotent
        ? t({ ar: `هذه الدفعة مُستوردة سابقًا بنفس المفتاح — لم يُدرج شيء جديد (أُدرج سابقًا ${r.data.inserted}).`,
              en: `This batch was already imported under the same key — nothing new was inserted (${r.data.inserted} previously).` })
        : t({ ar: `أُدرج ${r.data.inserted} · تكرار ${r.data.duplicates} · أخطاء ${r.data.errors}.`,
              en: `Inserted ${r.data.inserted} · duplicates ${r.data.duplicates} · errors ${r.data.errors}.` }),
      tone: "ok",
    });
    setStaged(null);
  }

  return (
    <div className="space-y-4">
      <Section title={t({ ar: "التصدير (CSV)", en: "Export (CSV)" })} defaultOpen>
        <div className="flex flex-wrap gap-2">
          <button className={btnGhost} disabled={busy} onClick={() => void doExport("leads")}>
            {t({ ar: "العملاء المحتملون", en: "Leads" })}
          </button>
          <button className={btnGhost} disabled={busy} onClick={() => void doExport("opportunities")}>
            {t({ ar: "الفرص", en: "Opportunities" })}
          </button>
          <button className={btnGhost} disabled={busy} onClick={() => void doExport("activities")}>
            {t({ ar: "الأنشطة", en: "Activities" })}
          </button>
        </div>
        <ContractNote>
          {t({ ar: "التصدير يخرج بما تراه أنت فقط، ولا يحتوي أعمدة عمولة أو نِسَب إطلاقًا. كلّ تصدير مُدقَّق في سجلّ التدقيق.",
               en: "An export contains only what you can see, and never any commission or rate column. Every export is audited." })}
        </ContractNote>
      </Section>

      {acc.can_import && (
        <Section title={t({ ar: "الاستيراد (CSV) — معاينة ثمّ تنفيذ", en: "Import (CSV) — preview, then execute" })} defaultOpen>
          <p className="text-xs text-stone-400 leading-6">
            {t({ ar: "الأعمدة المتوقّعة: contact_name · company_name · email · phone · city · industry · source_detail · notes · external_ref. الصفوف المطابقة لسجلّ قائم تُعدّ تكرارًا ولا تُدرج.",
                 en: "Expected columns: contact_name · company_name · email · phone · city · industry · source_detail · notes · external_ref. Rows matching an existing record count as duplicates and are not inserted." })}
          </p>
          <input type="file" accept=".csv,text/csv" className={fieldCls} disabled={busy}
                 onChange={(e) => { const f = e.target.files?.[0]; if (f) void doPreview(f); }} />
          <ContractNote>
            {t({ ar: "اختيار الملفّ يُنتج معاينة فقط ولا يكتب صفًّا واحدًا. الإدراج لا يحدث إلّا بضغطك على «تنفيذ الاستيراد» بعد قراءة الأرقام.",
                 en: "Choosing a file produces a preview only and writes nothing. Insertion happens only when you press “Execute import” after reading the numbers." })}
          </ContractNote>

          {staged && (
            <div className={`${card} p-3 space-y-3`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-stone-100">{staged.name}</span>
                <Chip tone="neutral">{t({ ar: "معاينة — لم يُكتب شيء", en: "Preview — nothing written" })}</Chip>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Counter label={t({ ar: "صفوف الملفّ", en: "File rows" })} value={staged.preview.rows} />
                <Counter label={t({ ar: "سيُدرج", en: "Will insert" })} value={staged.preview.will_insert} tone="good" />
                <Counter label={t({ ar: "تكرار قائم", en: "Existing duplicates" })}
                         value={staged.preview.will_skip_duplicate}
                         tone={staged.preview.will_skip_duplicate > 0 ? "warn" : "neutral"} />
                <Counter label={t({ ar: "صفوف غير صالحة", en: "Invalid rows" })}
                         value={staged.preview.will_skip_invalid}
                         tone={staged.preview.will_skip_invalid > 0 ? "warn" : "neutral"} />
              </div>
              {staged.preview.duplicate_within_file > 0 && (
                <Flash tone="bad" text={t({
                  ar: `${staged.preview.duplicate_within_file} صفًّا مكرّرًا داخل الملفّ نفسه — كشف القاعدة لا يراها لأنّها لم تُدرج بعد، وستُنتج نسختين عند التنفيذ.`,
                  en: `${staged.preview.duplicate_within_file} rows duplicate each other inside this file — database matching cannot see them yet, and they will produce two copies on execute.`,
                })} />
              )}
              {staged.preview.already_imported && (
                <Flash tone="ok" text={staged.preview.note} />
              )}
              <Scroller>
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="text-stone-400 text-xs">
                      <th className="text-start py-2">#</th>
                      <th className="text-start">{t({ ar: "جهة الاتصال", en: "Contact" })}</th>
                      <th className="text-start">{t({ ar: "الشركة", en: "Company" })}</th>
                      <th className="text-start">{t({ ar: "القرار", en: "Decision" })}</th>
                      <th className="text-start">{t({ ar: "ملاحظات", en: "Notes" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(staged.preview.result?.rows ?? []).slice(0, 200).map((row) => (
                      <tr key={row.line} className="border-t border-stone-800">
                        <td className="py-2 text-stone-500 tabular-nums">{row.line}</td>
                        <td className="text-stone-200">{row.contact_name ?? "—"}</td>
                        <td className="text-stone-400">{row.company_name ?? "—"}</td>
                        <td className={row.decision === "insert" ? "text-emerald-300" : "text-amber-300"}>
                          {crmLabel(IMPORT_DECISION_AR, IMPORT_DECISION_EN, row.decision, isAr)}
                          {row.matches > 0 ? ` (${row.matches})` : ""}
                        </td>
                        <td className="text-[11px] text-stone-500">
                          {(row.issues ?? []).map((i) => crmLabel(IMPORT_ISSUE_AR, IMPORT_ISSUE_EN, i, isAr)).join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroller>
              {(staged.preview.result?.rows ?? []).length > 200 && (
                <p className="text-[11px] text-stone-500">
                  {t({ ar: "عُرضت أوّل ٢٠٠ صفّ فقط — الأعداد أعلاه تشمل الملفّ كلّه.",
                       en: "Only the first 200 rows are shown — the counters above cover the whole file." })}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button className={btnPrimary} disabled={busy || staged.preview.will_insert === 0}
                        onClick={() => void doExecute()}>
                  {t({ ar: `تنفيذ الاستيراد (${staged.preview.will_insert})`,
                       en: `Execute import (${staged.preview.will_insert})` })}
                </button>
                <button className={btnGhost} disabled={busy} onClick={() => setStaged(null)}>
                  {t({ ar: "إلغاء", en: "Cancel" })}
                </button>
              </div>
              {staged.preview.will_insert === 0 && (
                <ContractNote>
                  {t({ ar: "لا صفّ صالحًا للإدراج في هذا الملفّ — التنفيذ لن يفعل شيئًا، ولذلك هو معطّل.",
                       en: "No insertable row in this file — executing would do nothing, so it is disabled." })}
                </ContractNote>
              )}
            </div>
          )}

          <ContractNote>
            {t({ ar: "مفتاح التكرار يُشتقّ من اسم الملفّ وعدد صفوفه؛ رفع الملفّ نفسه مرّتين يعيد نتيجة المرّة الأولى ولا يُدرج نسخًا.",
                 en: "The batch key is derived from the file name and row count; uploading the same file twice returns the first result and inserts no copies." })}
          </ContractNote>
        </Section>
      )}

      <Section title={t({ ar: "قواعد درجة العميل", en: "Lead scoring rules" })}>
        <StateView st={st}>
          {(l) => (
            <div className="space-y-2">
              <p className="text-xs text-stone-400 leading-6">
                {t({ ar: "الدرجة ليست صندوقًا أسود: هي مجموع القواعد المطابقة أدناه، زائد أيّ تعديل يدويّ معلَن بسببه.",
                     en: "The score is not a black box: it is the sum of the matching rules below, plus any manual adjustment declared with its reason." })}
              </p>
              <Scroller>
                <table className="w-full text-sm min-w-[520px]">
                  <thead>
                    <tr className="text-stone-400 text-xs">
                      <th className="text-start py-2">{t({ ar: "القاعدة", en: "Rule" })}</th>
                      <th className="text-start">{t({ ar: "الحقل", en: "Field" })}</th>
                      <th className="text-start">{t({ ar: "الشرط", en: "Operator" })}</th>
                      <th className="text-start">{t({ ar: "النقاط", en: "Points" })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(l.score_rules ?? []).map((r) => (
                      <tr key={String(r.id)} className="border-t border-stone-800">
                        <td className="py-2 text-stone-200">{S(isAr ? r.label_ar : (r.label_en ?? r.label_ar))}</td>
                        <td className="text-stone-400 text-xs">{S(r.field)}</td>
                        <td className="text-stone-400 text-xs">{S(r.operator)}</td>
                        <td className={`tabular-nums ${N(r.points) >= 0 ? "text-emerald-300" : "text-red-300"}`}>{N(r.points)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Scroller>
              {!acc.can_manage_scoring && (
                <ContractNote>
                  {t({ ar: "تحرير القواعد صلاحية مستقلّة (crm.manage_scoring).",
                       en: "Editing the rules is a separate permission (crm.manage_scoring)." })}
                </ContractNote>
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
