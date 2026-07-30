"use client";
// ════════════════════════════════════════════════════════════════════════════
// CrmOpportunityPanel — بطاقة الفرصة: المرحلة · الاحتمال · الأنشطة ·
// مرجع عرض السعر (قراءة فقط) · الإغلاق · جاهزية التحويل · **عقد التسليم**.
//
// ★★ لا زرّ «إنشاء مشروع» في هذه الشاشة، ولا في أيّ شاشة أخرى من الوحدة.
//    بعد الربح تظهر بطاقة «جاهزة لإنشاء المشروع يدويًّا» ومعها ما ينقص، ثمّ
//    زرّ واحد اسمه «تسجيل أنّ المشروع أُنشئ يدويًّا» — تسجيل لا أتمتة.
// ★  العمولة تظهر فقط لمن يملك رؤيتها؛ غيره يرى سبب الإخفاء لا شاشة فارغة.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  crmOpportunityDetail, crmOpportunityUpsert, crmOpportunitySetStage, crmOpportunityClose,
  crmOpportunityReopen, crmOpportunityDelete, crmHandoffConfirm, crmActivityLog,
  crmOpportunityLinkQuote, crmLookups,
  OPP_STATUS_AR, OPP_STATUS_COLOR, ACTIVITY_AR, LOST_REASON_AR, HANDOFF_AR,
  OPP_STATUS_EN, ACTIVITY_EN, LOST_REASON_EN, HANDOFF_EN, crmLabel,
  crmDate, crmDateTime, crmMoney,
  type CrmAccess, type CrmOppDetail, type CrmRow, type CrmLookups,
} from "@/lib/portal/crm";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Empty, Flash, Field,
  StateView, useCrmLoad, useCrmT, Section, ContractNote, Bar,
} from "./CrmAtoms";

const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const N = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v ?? 0)) || 0);

export default function CrmOpportunityPanel({
  oppId, acc, onBack,
}: { oppId: string; acc: CrmAccess; onBack: () => void }) {
  const { st, reload } = useCrmLoad<CrmOppDetail>(() => crmOpportunityDetail(oppId), [oppId]);
  const { st: lkSt } = useCrmLoad<CrmLookups>(() => crmLookups(), []);
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);
  const flash = (x: string, tone: "ok" | "bad") => setMsg({ t: x, tone });
  const { t, isAr } = useCrmT();

  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={onBack}>
        {isAr ? "◂ " : "‹ "}{t({ ar: "رجوع للقائمة", en: "Back to list" })}
      </button>
      {msg && <Flash text={msg.t} tone={msg.tone} />}
      <StateView st={st} onRetry={reload}>
        {(d) => {
          const o = d.opportunity as CrmRow;
          const status = String(o.status);
          const stages = lkSt?.state === "ok" ? lkSt.data.stages ?? [] : [];
          return (
            <div className="space-y-4">
              <div className={`${card} p-4 space-y-2`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base text-stone-100">{S(o.title)}</h2>
                    <p className="text-[11px] text-stone-500 mt-1">
                      {S(o.opp_code)} · {S(d.company?.name)} · {S(d.stage?.name_ar)}
                    </p>
                  </div>
                  <span className={`text-sm shrink-0 ${OPP_STATUS_COLOR[status as keyof typeof OPP_STATUS_COLOR] ?? "text-stone-300"}`}>
                    {crmLabel(OPP_STATUS_AR, OPP_STATUS_EN, status, isAr)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip>{crmMoney(N(o.estimated_value), String(o.currency))}</Chip>
                  <Chip tone={N(o.probability) >= 70 ? "good" : "neutral"}>{N(o.probability)}%</Chip>
                  <Chip>
                    {t({ ar: "مرجَّح", en: "weighted" })}{" "}
                    {crmMoney((N(o.estimated_value) * N(o.probability)) / 100, String(o.currency))}
                  </Chip>
                  {o.expected_close_date
                    ? <Chip>{t({ ar: "إغلاق", en: "close" })} {crmDate(String(o.expected_close_date))}</Chip>
                    : null}
                  {o.probability_is_manual
                    ? <Chip tone="warn">{t({ ar: "احتمال محرَّر يدويًّا", en: "Manually set probability" })}</Chip>
                    : null}
                </div>
                <div className="text-[11px] text-stone-500 leading-6">
                  {o.next_action
                    ? `${t({ ar: "الإجراء التالي:", en: "Next action:" })} ${S(o.next_action)}`
                    : t({ ar: "لا إجراء تالٍ مسجَّل", en: "No next action recorded" })}
                  {o.next_action_due ? ` (${crmDate(String(o.next_action_due))})` : ""}
                  {o.last_activity_at
                    ? ` · ${t({ ar: "آخر نشاط", en: "last activity" })} ${crmDateTime(String(o.last_activity_at))}`
                    : ` · ${t({ ar: "بلا نشاط بعد", en: "no activity yet" })}`}
                </div>
                {status === "lost" && (
                  <p className="text-xs text-red-300 leading-6">
                    {t({ ar: "سبب الخسارة:", en: "Lost reason:" })}{" "}
                    {crmLabel(LOST_REASON_AR, LOST_REASON_EN, String(o.lost_reason), isAr)}
                    {d.competitor ? ` · ${t({ ar: "المنافس:", en: "Competitor:" })} ${S(d.competitor.name)}` : ""}
                    {o.lost_reason_note ? ` — ${S(o.lost_reason_note)}` : ""}
                  </p>
                )}
              </div>

              {/* ─── مرجع عرض السعر: قراءة فقط ─── */}
              <Section title={t({ ar: "مرجع عرض السعر", en: "Quote reference" })} defaultOpen>
                {d.quote?.available
                  ? (
                    <div className="text-sm text-stone-300 space-y-1">
                      <div>
                        {t({ ar: "المرجع:", en: "Reference:" })} <span dir="ltr">{S(d.quote.reference)}</span>
                      </div>
                      <div className="text-xs text-stone-500">
                        {t({ ar: "الحالة:", en: "Status:" })} {S(d.quote.status)} ·{" "}
                        {t({ ar: "أُنشئ", en: "created" })} {crmDate(d.quote.created_at)}
                      </div>
                    </div>
                  )
                  : <Empty message={d.quote?.reason === "quote_requests_absent"
                      ? t({ ar: "وحدة طلبات الأسعار غير مفعّلة في هذه القاعدة.",
                            en: "The quote-requests module is not enabled on this database." })
                      : d.quote
                        ? t({ ar: "تعذّر قراءة طلب عرض السعر المرتبط.",
                              en: "The linked quote request could not be read." })
                        : t({ ar: "لا عرض سعر مرتبط.", en: "No quote linked." })} />}
                {d.can_edit && acc.quotes_available && (
                  <LinkQuote oppId={oppId} onDone={(t, tone) => { flash(t, tone); reload(); }} />
                )}
                <ContractNote>
                  {t({ ar: "عرض السعر يُقرأ ولا يُعدَّل من هنا إطلاقًا: مصدر الحقيقة يبقى في وحدة طلبات الأسعار.",
                       en: "The quote is read and never edited here: the source of truth stays in the quote-requests module." })}
                </ContractNote>
              </Section>

              {/* ─── المرحلة ─── */}
              {d.can_edit && status === "open" && (
                <Section title={t({ ar: "المرحلة والاحتمال", en: "Stage & probability" })} defaultOpen>
                  <StageMove oppId={oppId} current={String(o.stage_id)} stages={stages}
                             onDone={(t, tone) => { flash(t, tone); reload(); }} />
                  <EditFields opp={o} onDone={(t, tone) => { flash(t, tone); reload(); }} />
                </Section>
              )}

              {/* ─── الأنشطة ─── */}
              <Section title={t({ ar: "الأنشطة", en: "Activities" })} defaultOpen count={(d.activities ?? []).length}>
                {d.can_edit && <ActivityForm oppId={oppId} onDone={(t, tone) => { flash(t, tone); reload(); }} />}
                {(d.activities ?? []).length === 0
                  ? <Empty message={t({ ar: "لا أنشطة — فرصة بلا نشاط تُصبح راكدة سريعًا.",
                                        en: "No activities — an opportunity without activity goes stale quickly." })} />
                  : (d.activities ?? []).map((a) => (
                    <div key={String(a.id)} className="border-t border-stone-800 pt-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm text-stone-200">{S(a.subject)}</span>
                        <Chip>{crmLabel(ACTIVITY_AR, ACTIVITY_EN, String(a.kind), isAr)}</Chip>
                      </div>
                      {a.body ? <p className="text-xs text-stone-400 mt-1 leading-6 whitespace-pre-wrap">{S(a.body)}</p> : null}
                      <p className="text-[11px] text-stone-500 mt-1">{crmDateTime(String(a.occurred_at))}</p>
                    </div>
                  ))}
              </Section>

              {/* ─── تاريخ المراحل ─── */}
              <Section title={t({ ar: "تاريخ المراحل", en: "Stage history" })} count={(d.stage_history ?? []).length}>
                {(d.stage_history ?? []).map((h, i) => (
                  <div key={i} className="text-[11px] text-stone-400 border-t border-stone-800 pt-2 leading-6">
                    {crmDateTime(String(h.at))} — {S(h.from) === "—" ? t({ ar: "بداية", en: "start" }) : S(h.from)}
                    {isAr ? " ← " : " → "}{S(h.to)}
                    {h.note ? ` · ${S(h.note)}` : ""}
                  </div>
                ))}
                {(d.stage_history ?? []).length === 0 && (
                  <Empty message={t({ ar: "لا تاريخ.", en: "No history." })} />
                )}
              </Section>

              {/* ─── جاهزية التحويل ─── */}
              <Section title={t({ ar: "جاهزية التسليم", en: "Handoff readiness" })} defaultOpen>
                <Bar score={d.readiness?.score ?? 0} good={100} warn={60} />
                <ul className="space-y-1">
                  {(d.readiness?.checks ?? []).map((c) => (
                    <li key={c.key} className="flex items-center justify-between text-xs">
                      <span className={c.ok ? "text-stone-200" : c.required ? "text-red-300" : "text-stone-500"}>
                        {c.ok ? "✓" : "○"} {c.ar}
                      </span>
                      <span className="text-[10px] text-stone-600">
                        {c.required ? t({ ar: "إلزاميّ", en: "required" }) : t({ ar: "اختياريّ", en: "optional" })}
                      </span>
                    </li>
                  ))}
                </ul>
                <ContractNote>{d.readiness?.contract}</ContractNote>
              </Section>

              {/* ─── الإغلاق ─── */}
              {d.can_edit && status === "open" && (
                <Section title={t({ ar: "إغلاق الفرصة", en: "Close the opportunity" })} defaultOpen>
                  <CloseForm oppId={oppId}
                             competitors={lkSt?.state === "ok" ? lkSt.data.competitors ?? [] : []}
                             onDone={(t, tone) => { flash(t, tone); reload(); }} />
                </Section>
              )}

              {/* ─── ★★ عقد التسليم ─── */}
              {status === "won" && (
                <div className={`${card} p-4 space-y-3 border-amber-900`}>
                  <div className="flex items-center gap-2">
                    <Chip tone={String(o.handoff_state) === "manually_created" ? "good" : "warn"}>
                      {crmLabel(HANDOFF_AR, HANDOFF_EN, String(o.handoff_state), isAr)}
                    </Chip>
                    {o.handoff_ready_at ? (
                      <span className="text-[11px] text-stone-500">
                        {t({ ar: "منذ", en: "since" })} {crmDate(String(o.handoff_ready_at))}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-stone-300 leading-7">
                    {isAr ? (
                      <>هذه الفرصة مربوحة، وسُجِّل أنّها <strong className="text-stone-100">جاهزة لإنشاء العميل/المشروع يدويًّا</strong>.
                      وحدة المبيعات لا تُنشئ مشاريع ولا تكتب في منصّة المشاريع؛ الإنشاء يتمّ من منصّة المشاريع بيد إنسان،
                      ثمّ يُسجَّل هنا رقمه للربط والمتابعة.</>
                    ) : (
                      <>This deal is won and recorded as <strong className="text-stone-100">ready for manual client/project creation</strong>.
                      The CRM creates no project and writes nothing to the project platform; a human creates it there,
                      then records its id here for linkage and follow-up.</>
                    )}
                  </p>
                  {o.handoff_note ? (
                    <p className="text-xs text-stone-400 leading-6">
                      {t({ ar: "ملاحظة التسليم:", en: "Handoff note:" })} {S(o.handoff_note)}
                    </p>
                  ) : null}
                  {d.handoff_project_name ? (
                    <p className="text-xs text-emerald-300 leading-6">
                      {t({ ar: "المشروع المرتبط:", en: "Linked project:" })} {d.handoff_project_name}
                    </p>
                  ) : null}
                  {d.can_edit && String(o.handoff_state) !== "manually_created" && (
                    <HandoffForm oppId={oppId} projectsAvailable={acc.projects_available}
                                 onDone={(t, tone) => { flash(t, tone); reload(); }} />
                  )}
                </div>
              )}

              {/* ─── العمولة ─── */}
              <Section title={t({ ar: "العمولة", en: "Commission" })}>
                {d.commission_visible
                  ? ((d.commission ?? []).length === 0
                      ? <Empty message={t({
                          ar: "لا سجلّ عمولة لهذه الفرصة (لا خطّة سارية للمالك، أو الفرصة غير مربوحة).",
                          en: "No commission record for this opportunity (no active plan for its owner, or it is not won).",
                        })} />
                      : (d.commission ?? []).map((r, i) => (
                        <div key={i} className="text-sm text-stone-300 flex justify-between border-t border-stone-800 pt-2">
                          <span>
                            {t({ ar: "أساس", en: "basis" })} {crmMoney(N(r.basis_value), String(r.currency))} × {N(r.rate_pct)}%
                          </span>
                          <span className="text-emerald-300 tabular-nums">{crmMoney(N(r.amount), String(r.currency))}</span>
                        </div>
                      )))
                  : <ContractNote>
                      {t({ ar: "عمولة مالك هذه الفرصة ونسبتها خارج صلاحيتك. هذا منع من قاعدة البيانات لا إخفاء في الواجهة، ولا يُغيّره كونك مدير مبيعات — رؤية عمولات الآخرين مفتاح حسّاس مستقلّ.",
                           en: "The owner's commission and rate for this opportunity are outside your permission. That is a database refusal, not a UI hide, and being a sales manager does not change it — seeing others' commission is a separate sensitive key." })}
                    </ContractNote>}
              </Section>

              {acc.can_manage && (
                <Section title={t({ ar: "إجراءات إدارية", en: "Administrative actions" })}>
                  <AdminActions oppId={oppId} status={status}
                                onDone={(t, tone, back) => { flash(t, tone); if (back) onBack(); else reload(); }} />
                </Section>
              )}
            </div>
          );
        }}
      </StateView>
    </div>
  );
}

function LinkQuote({ oppId, onDone }: { oppId: string; onDone: (t: string, tone: "ok" | "bad") => void }) {
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useCrmT();
  return (
    <div className="flex flex-wrap gap-2 items-end pt-2">
      <div className="flex-1 min-w-[220px]">
        <Field label={t({ ar: "معرّف طلب عرض السعر (UUID)", en: "Quote request id (UUID)" })}>
          <input className={fieldCls} dir="ltr" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await crmOpportunityLinkQuote(oppId, id.trim() || null);
        setBusy(false);
        onDone(r.state === "ok"
          ? t({ ar: "رُبط المرجع (قراءة فقط).", en: "Reference linked (read-only)." })
          : r.message, r.state === "ok" ? "ok" : "bad");
      }}>{t({ ar: "ربط", en: "Link" })}</button>
    </div>
  );
}

function StageMove({ oppId, current, stages, onDone }: {
  oppId: string; current: string;
  stages: { stage_id: string; name_ar: string; name_en?: string; is_won: boolean; is_lost: boolean }[];
  onDone: (msg: string, tone: "ok" | "bad") => void;
}) {
  const [busy, setBusy] = useState(false);
  const { t, isAr } = useCrmT();
  const open = stages.filter((s) => !s.is_won && !s.is_lost);
  return (
    <div className="flex flex-wrap gap-2">
      {open.map((s) => (
        <button key={s.stage_id} disabled={busy || s.stage_id === current}
          className={`${btnGhost} ${s.stage_id === current ? "ring-1 ring-red-700" : ""}`}
          onClick={async () => {
            setBusy(true);
            const r = await crmOpportunitySetStage(oppId, s.stage_id);
            setBusy(false);
            const label = isAr ? s.name_ar : (s.name_en || s.name_ar);
            onDone(r.state === "ok"
              ? t({ ar: `نُقلت إلى «${label}».`, en: `Moved to “${label}”.` })
              : r.message, r.state === "ok" ? "ok" : "bad");
          }}>{isAr ? s.name_ar : (s.name_en || s.name_ar)}</button>
      ))}
    </div>
  );
}

function EditFields({ opp, onDone }: { opp: CrmRow; onDone: (t: string, tone: "ok" | "bad") => void }) {
  const [f, setF] = useState<Record<string, string>>({
    estimated_value: String(opp.estimated_value ?? ""),
    probability: String(opp.probability ?? ""),
    expected_close_date: String(opp.expected_close_date ?? ""),
    next_action: String(opp.next_action ?? ""),
    next_action_due: String(opp.next_action_due ?? ""),
  });
  const [busy, setBusy] = useState(false);
  const { t } = useCrmT();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3 pt-3 border-t border-stone-800">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t({ ar: "القيمة المتوقّعة", en: "Estimated value" })}>
          <input type="number" className={fieldCls} value={f.estimated_value} onChange={(e) => set("estimated_value", e.target.value)} />
        </Field>
        <Field label={t({ ar: "الاحتمال %", en: "Probability %" })}
               hint={t({ ar: "تحريره يدويًّا يُثبِّته: لن يتغيّر تلقائيًّا مع المرحلة بعدها.",
                         en: "Editing it pins it: it will no longer follow the stage automatically." })}>
          <input type="number" min={0} max={100} className={fieldCls} value={f.probability} onChange={(e) => set("probability", e.target.value)} />
        </Field>
        <Field label={t({ ar: "تاريخ الإغلاق المتوقّع", en: "Expected close date" })}>
          <input type="date" className={fieldCls} value={f.expected_close_date} onChange={(e) => set("expected_close_date", e.target.value)} />
        </Field>
        <Field label={t({ ar: "الإجراء التالي", en: "Next action" })}>
          <input className={fieldCls} value={f.next_action} onChange={(e) => set("next_action", e.target.value)} />
        </Field>
        <Field label={t({ ar: "تاريخ الإجراء التالي", en: "Next action due" })}>
          <input type="date" className={fieldCls} value={f.next_action_due} onChange={(e) => set("next_action_due", e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await crmOpportunityUpsert({ id: String(opp.id), ...f });
        setBusy(false);
        onDone(r.state === "ok" ? t({ ar: "حُفظت التعديلات.", en: "Changes saved." }) : r.message,
               r.state === "ok" ? "ok" : "bad");
      }}>{t({ ar: "حفظ", en: "Save" })}</button>
    </div>
  );
}

function ActivityForm({ oppId, onDone }: { oppId: string; onDone: (t: string, tone: "ok" | "bad") => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ kind: "call", subject: "", body: "", follow_up_due: "" });
  const [busy, setBusy] = useState(false);
  const { t, isAr } = useCrmT();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  if (!open) {
    return (
      <button className={btnGhost} onClick={() => setOpen(true)}>
        {t({ ar: "تسجيل نشاط", en: "Log an activity" })}
      </button>
    );
  }
  return (
    <div className="space-y-3 pb-3 border-b border-stone-800">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t({ ar: "النوع", en: "Kind" })}>
          <select className={fieldCls} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            {Object.keys(ACTIVITY_AR).map((k) => (
              <option key={k} value={k}>{crmLabel(ACTIVITY_AR, ACTIVITY_EN, k, isAr)}</option>
            ))}
          </select>
        </Field>
        <Field label={t({ ar: "الموضوع", en: "Subject" })}><input className={fieldCls} value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
        <Field label={t({ ar: "متابعة في", en: "Follow up on" })}><input type="date" className={fieldCls} value={f.follow_up_due} onChange={(e) => set("follow_up_due", e.target.value)} /></Field>
        <Field label={t({ ar: "الإجراء التالي", en: "Next action" })}><input className={fieldCls} value={f.next_action ?? ""} onChange={(e) => set("next_action", e.target.value)} /></Field>
      </div>
      <textarea className={`${fieldCls} min-h-[80px]`} placeholder={t({ ar: "التفاصيل", en: "Details" })}
                value={f.body} onChange={(e) => set("body", e.target.value)} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy || !f.subject.trim()} onClick={async () => {
          setBusy(true);
          const r = await crmActivityLog({ ...f, opportunity_id: oppId, occurred_at: new Date().toISOString() });
          setBusy(false); setOpen(false);
          onDone(r.state === "ok" ? t({ ar: "سُجِّل النشاط.", en: "Activity logged." }) : r.message,
                 r.state === "ok" ? "ok" : "bad");
        }}>{t({ ar: "حفظ", en: "Save" })}</button>
        <button className={btnGhost} onClick={() => setOpen(false)}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
      </div>
      <ContractNote>
        {t({ ar: "«ملاحظة واتساب» و«بريد» تسجيلان لما جرى — لا تُرسل هذه الشاشة رسالة إلى أحد.",
             en: "“WhatsApp note” and “Email note” record what happened — this screen sends no message to anyone." })}
      </ContractNote>
    </div>
  );
}

function CloseForm({ oppId, competitors, onDone }: {
  oppId: string; competitors: { id: string; name: string }[];
  onDone: (t: string, tone: "ok" | "bad") => void;
}) {
  const [mode, setMode] = useState<"won" | "lost" | "abandoned">("won");
  const [f, setF] = useState<Record<string, string>>({ lost_reason: "price", final_value: "", handoff_note: "", lost_reason_note: "", competitor_id: "" });
  const [busy, setBusy] = useState(false);
  const { t, isAr } = useCrmT();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["won", "lost", "abandoned"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`${btnGhost} ${mode === m ? "ring-1 ring-red-700" : ""}`}>
            {crmLabel(OPP_STATUS_AR, OPP_STATUS_EN, m, isAr)}
          </button>
        ))}
      </div>
      {mode === "won" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t({ ar: "القيمة النهائية", en: "Final value" })}><input type="number" className={fieldCls} value={f.final_value} onChange={(e) => set("final_value", e.target.value)} /></Field>
          <Field label={t({ ar: "ملاحظة التسليم للفريق التنفيذيّ", en: "Handoff note for the delivery team" })}
                 hint={t({ ar: "تظهر لمن سيُنشئ المشروع يدويًّا.",
                           en: "Shown to whoever creates the project manually." })}>
            <input className={fieldCls} value={f.handoff_note} onChange={(e) => set("handoff_note", e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={t({ ar: "سبب الخسارة *", en: "Lost reason *" })}>
            <select className={fieldCls} value={f.lost_reason} onChange={(e) => set("lost_reason", e.target.value)}>
              {Object.keys(LOST_REASON_AR).map((k) => (
                <option key={k} value={k}>{crmLabel(LOST_REASON_AR, LOST_REASON_EN, k, isAr)}</option>
              ))}
            </select>
          </Field>
          <Field label={t({ ar: "المنافس (إن وُجد)", en: "Competitor (if any)" })}>
            <select className={fieldCls} value={f.competitor_id} onChange={(e) => set("competitor_id", e.target.value)}>
              <option value="">—</option>
              {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label={t({ ar: "تفصيل", en: "Detail" })}><input className={fieldCls} value={f.lost_reason_note} onChange={(e) => set("lost_reason_note", e.target.value)} /></Field>
        </div>
      )}
      <button className={btnPrimary} disabled={busy} onClick={async () => {
        setBusy(true);
        const payload = mode === "won"
          ? { final_value: f.final_value || undefined, handoff_note: f.handoff_note || undefined }
          : { lost_reason: f.lost_reason, lost_reason_note: f.lost_reason_note || undefined,
              competitor_id: f.competitor_id || undefined };
        const r = await crmOpportunityClose(oppId, mode, payload);
        setBusy(false);
        onDone(r.state === "ok"
          ? (r.data.contract ?? t({ ar: "أُغلقت الفرصة.", en: "Opportunity closed." }))
          : r.message, r.state === "ok" ? "ok" : "bad");
      }}>{t({ ar: "تأكيد الإغلاق", en: "Confirm close" })}</button>
      {mode === "won" && (
        <ContractNote>
          {t({ ar: "الربح يسجّل الجاهزية فقط. لن يُنشأ مشروع تلقائيًّا، ولن تُكتب أيّ بيانات في منصّة المشاريع.",
               en: "Winning records readiness only. No project is created automatically, and nothing is written to the project platform." })}
        </ContractNote>
      )}
    </div>
  );
}

function HandoffForm({ oppId, projectsAvailable, onDone }: {
  oppId: string; projectsAvailable: boolean; onDone: (t: string, tone: "ok" | "bad") => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useCrmT();
  return (
    <div className="space-y-3 pt-3 border-t border-stone-800">
      {projectsAvailable ? (
        <Field label={t({ ar: "معرّف المشروع الذي أُنشئ يدويًّا (اختياريّ)",
                          en: "Id of the manually created project (optional)" })}
               hint={t({ ar: "يُتحقّق من وجوده قبل الحفظ. تركه فارغًا يسجّل التسليم بلا ربط.",
                         en: "Verified to exist before saving. Leaving it empty records the handoff without a link." })}>
          <input className={fieldCls} dir="ltr" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
        </Field>
      ) : (
        <ContractNote>
          {t({ ar: "منصّة المشاريع غير متاحة في هذه القاعدة — سيُسجَّل التسليم بلا ربط.",
               en: "The project platform is not available on this database — the handoff will be recorded without a link." })}
        </ContractNote>
      )}
      <Field label={t({ ar: "ملاحظة", en: "Note" })}>
        <input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button className={btnPrimary} disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await crmHandoffConfirm(oppId, {
          handoff_project_id: projectId.trim() || undefined, handoff_note: note || undefined,
        });
        setBusy(false);
        onDone(r.state === "ok" ? r.data.contract : r.message, r.state === "ok" ? "ok" : "bad");
      }}>{t({ ar: "تسجيل أنّ المشروع أُنشئ يدويًّا", en: "Record that the project was created manually" })}</button>
    </div>
  );
}

function AdminActions({ oppId, status, onDone }: {
  oppId: string; status: string; onDone: (t: string, tone: "ok" | "bad", back?: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useCrmT();
  return (
    <div className="space-y-3">
      <Field label={t({ ar: "السبب", en: "Reason" })}
             hint={t({ ar: "مطلوب لإعادة الفتح وللحذف — كلاهما مُدقَّق باسم فاعله.",
                       en: "Required to reopen and to delete — both are audited under the actor's name." })}>
        <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {status !== "open" && (
          <button className={btnGhost} disabled={busy || reason.trim().length < 3} onClick={async () => {
            setBusy(true);
            const r = await crmOpportunityReopen(oppId, reason);
            setBusy(false);
            onDone(r.state === "ok" ? t({ ar: "أُعيد فتح الفرصة.", en: "Opportunity reopened." }) : r.message,
                   r.state === "ok" ? "ok" : "bad");
          }}>{t({ ar: "إعادة الفتح", en: "Reopen" })}</button>
        )}
        <button className={btnGhost} disabled={busy || reason.trim().length < 3} onClick={async () => {
          setBusy(true);
          const r = await crmOpportunityDelete(oppId, reason);
          setBusy(false);
          onDone(r.state === "ok" ? t({ ar: "حُذفت الفرصة.", en: "Opportunity deleted." }) : r.message,
                 r.state === "ok" ? "ok" : "bad", r.state === "ok");
        }}>{t({ ar: "حذف الفرصة", en: "Delete opportunity" })}</button>
      </div>
    </div>
  );
}
