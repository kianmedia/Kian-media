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
  crmDate, crmDateTime, crmMoney,
  type CrmAccess, type CrmOppDetail, type CrmRow, type CrmLookups,
} from "@/lib/portal/crm";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Empty, Flash, Field,
  StateView, useCrmLoad, Section, ContractNote, Bar,
} from "./CrmAtoms";

const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));
const N = (v: unknown): number => (typeof v === "number" ? v : parseFloat(String(v ?? 0)) || 0);

export default function CrmOpportunityPanel({
  oppId, acc, onBack,
}: { oppId: string; acc: CrmAccess; onBack: () => void }) {
  const { st, reload } = useCrmLoad<CrmOppDetail>(() => crmOpportunityDetail(oppId), [oppId]);
  const { st: lkSt } = useCrmLoad<CrmLookups>(() => crmLookups(), []);
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);
  const flash = (t: string, tone: "ok" | "bad") => setMsg({ t, tone });

  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={onBack}>◂ رجوع للقائمة</button>
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
                    {OPP_STATUS_AR[status as keyof typeof OPP_STATUS_AR] ?? status}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip>{crmMoney(N(o.estimated_value), String(o.currency))}</Chip>
                  <Chip tone={N(o.probability) >= 70 ? "good" : "neutral"}>{N(o.probability)}%</Chip>
                  <Chip>مرجَّح {crmMoney((N(o.estimated_value) * N(o.probability)) / 100, String(o.currency))}</Chip>
                  {o.expected_close_date ? <Chip>إغلاق {crmDate(String(o.expected_close_date))}</Chip> : null}
                  {o.probability_is_manual ? <Chip tone="warn">احتمال محرَّر يدويًّا</Chip> : null}
                </div>
                <div className="text-[11px] text-stone-500 leading-6">
                  {o.next_action ? `الإجراء التالي: ${S(o.next_action)}` : "لا إجراء تالٍ مسجَّل"}
                  {o.next_action_due ? ` (${crmDate(String(o.next_action_due))})` : ""}
                  {o.last_activity_at ? ` · آخر نشاط ${crmDateTime(String(o.last_activity_at))}` : " · بلا نشاط بعد"}
                </div>
                {status === "lost" && (
                  <p className="text-xs text-red-300 leading-6">
                    سبب الخسارة: {LOST_REASON_AR[String(o.lost_reason)] ?? S(o.lost_reason)}
                    {d.competitor ? ` · المنافس: ${S(d.competitor.name)}` : ""}
                    {o.lost_reason_note ? ` — ${S(o.lost_reason_note)}` : ""}
                  </p>
                )}
              </div>

              {/* ─── مرجع عرض السعر: قراءة فقط ─── */}
              <Section title="مرجع عرض السعر" defaultOpen>
                {d.quote?.available
                  ? (
                    <div className="text-sm text-stone-300 space-y-1">
                      <div>المرجع: <span dir="ltr">{S(d.quote.reference)}</span></div>
                      <div className="text-xs text-stone-500">
                        الحالة: {S(d.quote.status)} · أُنشئ {crmDate(d.quote.created_at)}
                      </div>
                    </div>
                  )
                  : <Empty message={d.quote?.reason === "quote_requests_absent"
                      ? "وحدة طلبات الأسعار غير مفعّلة في هذه القاعدة."
                      : d.quote ? "تعذّر قراءة طلب عرض السعر المرتبط." : "لا عرض سعر مرتبط."} />}
                {d.can_edit && acc.quotes_available && (
                  <LinkQuote oppId={oppId} onDone={(t, tone) => { flash(t, tone); reload(); }} />
                )}
                <ContractNote>
                  عرض السعر يُقرأ ولا يُعدَّل من هنا إطلاقًا: مصدر الحقيقة يبقى في وحدة طلبات الأسعار.
                </ContractNote>
              </Section>

              {/* ─── المرحلة ─── */}
              {d.can_edit && status === "open" && (
                <Section title="المرحلة والاحتمال" defaultOpen>
                  <StageMove oppId={oppId} current={String(o.stage_id)} stages={stages}
                             onDone={(t, tone) => { flash(t, tone); reload(); }} />
                  <EditFields opp={o} onDone={(t, tone) => { flash(t, tone); reload(); }} />
                </Section>
              )}

              {/* ─── الأنشطة ─── */}
              <Section title="الأنشطة" defaultOpen count={(d.activities ?? []).length}>
                {d.can_edit && <ActivityForm oppId={oppId} onDone={(t, tone) => { flash(t, tone); reload(); }} />}
                {(d.activities ?? []).length === 0
                  ? <Empty message="لا أنشطة — فرصة بلا نشاط تُصبح راكدة سريعًا." />
                  : (d.activities ?? []).map((a) => (
                    <div key={String(a.id)} className="border-t border-stone-800 pt-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm text-stone-200">{S(a.subject)}</span>
                        <Chip>{ACTIVITY_AR[String(a.kind) as keyof typeof ACTIVITY_AR] ?? S(a.kind)}</Chip>
                      </div>
                      {a.body ? <p className="text-xs text-stone-400 mt-1 leading-6 whitespace-pre-wrap">{S(a.body)}</p> : null}
                      <p className="text-[11px] text-stone-500 mt-1">{crmDateTime(String(a.occurred_at))}</p>
                    </div>
                  ))}
              </Section>

              {/* ─── تاريخ المراحل ─── */}
              <Section title="تاريخ المراحل" count={(d.stage_history ?? []).length}>
                {(d.stage_history ?? []).map((h, i) => (
                  <div key={i} className="text-[11px] text-stone-400 border-t border-stone-800 pt-2 leading-6">
                    {crmDateTime(String(h.at))} — {S(h.from) === "—" ? "بداية" : S(h.from)} ← {S(h.to)}
                    {h.note ? ` · ${S(h.note)}` : ""}
                  </div>
                ))}
                {(d.stage_history ?? []).length === 0 && <Empty message="لا تاريخ." />}
              </Section>

              {/* ─── جاهزية التحويل ─── */}
              <Section title="جاهزية التسليم" defaultOpen>
                <Bar score={d.readiness?.score ?? 0} good={100} warn={60} />
                <ul className="space-y-1">
                  {(d.readiness?.checks ?? []).map((c) => (
                    <li key={c.key} className="flex items-center justify-between text-xs">
                      <span className={c.ok ? "text-stone-200" : c.required ? "text-red-300" : "text-stone-500"}>
                        {c.ok ? "✓" : "○"} {c.ar}
                      </span>
                      <span className="text-[10px] text-stone-600">{c.required ? "إلزاميّ" : "اختياريّ"}</span>
                    </li>
                  ))}
                </ul>
                <ContractNote>{d.readiness?.contract}</ContractNote>
              </Section>

              {/* ─── الإغلاق ─── */}
              {d.can_edit && status === "open" && (
                <Section title="إغلاق الفرصة" defaultOpen>
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
                      {HANDOFF_AR[String(o.handoff_state) as keyof typeof HANDOFF_AR] ?? S(o.handoff_state)}
                    </Chip>
                    {o.handoff_ready_at ? (
                      <span className="text-[11px] text-stone-500">منذ {crmDate(String(o.handoff_ready_at))}</span>
                    ) : null}
                  </div>
                  <p className="text-sm text-stone-300 leading-7">
                    هذه الفرصة مربوحة، وسُجِّل أنّها <strong className="text-stone-100">جاهزة لإنشاء العميل/المشروع يدويًّا</strong>.
                    وحدة المبيعات لا تُنشئ مشاريع ولا تكتب في منصّة المشاريع؛ الإنشاء يتمّ من منصّة المشاريع بيد إنسان،
                    ثمّ يُسجَّل هنا رقمه للربط والمتابعة.
                  </p>
                  {o.handoff_note ? (
                    <p className="text-xs text-stone-400 leading-6">ملاحظة التسليم: {S(o.handoff_note)}</p>
                  ) : null}
                  {d.handoff_project_name ? (
                    <p className="text-xs text-emerald-300 leading-6">المشروع المرتبط: {d.handoff_project_name}</p>
                  ) : null}
                  {d.can_edit && String(o.handoff_state) !== "manually_created" && (
                    <HandoffForm oppId={oppId} projectsAvailable={acc.projects_available}
                                 onDone={(t, tone) => { flash(t, tone); reload(); }} />
                  )}
                </div>
              )}

              {/* ─── العمولة ─── */}
              <Section title="العمولة">
                {d.commission_visible
                  ? ((d.commission ?? []).length === 0
                      ? <Empty message="لا سجلّ عمولة لهذه الفرصة (لا خطّة سارية للمالك، أو الفرصة غير مربوحة)." />
                      : (d.commission ?? []).map((r, i) => (
                        <div key={i} className="text-sm text-stone-300 flex justify-between border-t border-stone-800 pt-2">
                          <span>أساس {crmMoney(N(r.basis_value), String(r.currency))} × {N(r.rate_pct)}%</span>
                          <span className="text-emerald-300 tabular-nums">{crmMoney(N(r.amount), String(r.currency))}</span>
                        </div>
                      )))
                  : <ContractNote>
                      عمولة مالك هذه الفرصة ونسبتها خارج صلاحيتك. هذا منع من قاعدة البيانات لا إخفاء في الواجهة،
                      ولا يُغيّره كونك مدير مبيعات — رؤية عمولات الآخرين مفتاح حسّاس مستقلّ.
                    </ContractNote>}
              </Section>

              {acc.can_manage && (
                <Section title="إجراءات إدارية">
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
  return (
    <div className="flex flex-wrap gap-2 items-end pt-2">
      <div className="flex-1 min-w-[220px]">
        <Field label="معرّف طلب عرض السعر (UUID)">
          <input className={fieldCls} dir="ltr" value={id} onChange={(e) => setId(e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await crmOpportunityLinkQuote(oppId, id.trim() || null);
        setBusy(false);
        onDone(r.state === "ok" ? "رُبط المرجع (قراءة فقط)." : r.message, r.state === "ok" ? "ok" : "bad");
      }}>ربط</button>
    </div>
  );
}

function StageMove({ oppId, current, stages, onDone }: {
  oppId: string; current: string;
  stages: { stage_id: string; name_ar: string; is_won: boolean; is_lost: boolean }[];
  onDone: (t: string, tone: "ok" | "bad") => void;
}) {
  const [busy, setBusy] = useState(false);
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
            onDone(r.state === "ok" ? `نُقلت إلى «${s.name_ar}».` : r.message, r.state === "ok" ? "ok" : "bad");
          }}>{s.name_ar}</button>
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
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3 pt-3 border-t border-stone-800">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="القيمة المتوقّعة">
          <input type="number" className={fieldCls} value={f.estimated_value} onChange={(e) => set("estimated_value", e.target.value)} />
        </Field>
        <Field label="الاحتمال %" hint="تحريره يدويًّا يُثبِّته: لن يتغيّر تلقائيًّا مع المرحلة بعدها.">
          <input type="number" min={0} max={100} className={fieldCls} value={f.probability} onChange={(e) => set("probability", e.target.value)} />
        </Field>
        <Field label="تاريخ الإغلاق المتوقّع">
          <input type="date" className={fieldCls} value={f.expected_close_date} onChange={(e) => set("expected_close_date", e.target.value)} />
        </Field>
        <Field label="الإجراء التالي">
          <input className={fieldCls} value={f.next_action} onChange={(e) => set("next_action", e.target.value)} />
        </Field>
        <Field label="تاريخ الإجراء التالي">
          <input type="date" className={fieldCls} value={f.next_action_due} onChange={(e) => set("next_action_due", e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await crmOpportunityUpsert({ id: String(opp.id), ...f });
        setBusy(false);
        onDone(r.state === "ok" ? "حُفظت التعديلات." : r.message, r.state === "ok" ? "ok" : "bad");
      }}>حفظ</button>
    </div>
  );
}

function ActivityForm({ oppId, onDone }: { oppId: string; onDone: (t: string, tone: "ok" | "bad") => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<Record<string, string>>({ kind: "call", subject: "", body: "", follow_up_due: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  if (!open) return <button className={btnGhost} onClick={() => setOpen(true)}>تسجيل نشاط</button>;
  return (
    <div className="space-y-3 pb-3 border-b border-stone-800">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="النوع">
          <select className={fieldCls} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            {Object.entries(ACTIVITY_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
          </select>
        </Field>
        <Field label="الموضوع"><input className={fieldCls} value={f.subject} onChange={(e) => set("subject", e.target.value)} /></Field>
        <Field label="متابعة في"><input type="date" className={fieldCls} value={f.follow_up_due} onChange={(e) => set("follow_up_due", e.target.value)} /></Field>
        <Field label="الإجراء التالي"><input className={fieldCls} value={f.next_action ?? ""} onChange={(e) => set("next_action", e.target.value)} /></Field>
      </div>
      <textarea className={`${fieldCls} min-h-[80px]`} placeholder="التفاصيل" value={f.body} onChange={(e) => set("body", e.target.value)} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy || !f.subject.trim()} onClick={async () => {
          setBusy(true);
          const r = await crmActivityLog({ ...f, opportunity_id: oppId, occurred_at: new Date().toISOString() });
          setBusy(false); setOpen(false);
          onDone(r.state === "ok" ? "سُجِّل النشاط." : r.message, r.state === "ok" ? "ok" : "bad");
        }}>حفظ</button>
        <button className={btnGhost} onClick={() => setOpen(false)}>إلغاء</button>
      </div>
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
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {(["won", "lost", "abandoned"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)}
            className={`${btnGhost} ${mode === m ? "ring-1 ring-red-700" : ""}`}>
            {OPP_STATUS_AR[m]}
          </button>
        ))}
      </div>
      {mode === "won" ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="القيمة النهائية"><input type="number" className={fieldCls} value={f.final_value} onChange={(e) => set("final_value", e.target.value)} /></Field>
          <Field label="ملاحظة التسليم للفريق التنفيذيّ" hint="تظهر لمن سيُنشئ المشروع يدويًّا.">
            <input className={fieldCls} value={f.handoff_note} onChange={(e) => set("handoff_note", e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="سبب الخسارة *">
            <select className={fieldCls} value={f.lost_reason} onChange={(e) => set("lost_reason", e.target.value)}>
              {Object.entries(LOST_REASON_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
            </select>
          </Field>
          <Field label="المنافس (إن وُجد)">
            <select className={fieldCls} value={f.competitor_id} onChange={(e) => set("competitor_id", e.target.value)}>
              <option value="">—</option>
              {competitors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="تفصيل"><input className={fieldCls} value={f.lost_reason_note} onChange={(e) => set("lost_reason_note", e.target.value)} /></Field>
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
        onDone(r.state === "ok" ? (r.data.contract ?? "أُغلقت الفرصة.") : r.message, r.state === "ok" ? "ok" : "bad");
      }}>تأكيد الإغلاق</button>
      {mode === "won" && (
        <ContractNote>
          الربح يسجّل الجاهزية فقط. لن يُنشأ مشروع تلقائيًّا، ولن تُكتب أيّ بيانات في منصّة المشاريع.
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
  return (
    <div className="space-y-3 pt-3 border-t border-stone-800">
      {projectsAvailable ? (
        <Field label="معرّف المشروع الذي أُنشئ يدويًّا (اختياريّ)"
               hint="يُتحقّق من وجوده قبل الحفظ. تركه فارغًا يسجّل التسليم بلا ربط.">
          <input className={fieldCls} dir="ltr" value={projectId} onChange={(e) => setProjectId(e.target.value)} />
        </Field>
      ) : (
        <ContractNote>منصّة المشاريع غير متاحة في هذه القاعدة — سيُسجَّل التسليم بلا ربط.</ContractNote>
      )}
      <Field label="ملاحظة">
        <input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <button className={btnPrimary} disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await crmHandoffConfirm(oppId, {
          handoff_project_id: projectId.trim() || undefined, handoff_note: note || undefined,
        });
        setBusy(false);
        onDone(r.state === "ok" ? r.data.contract : r.message, r.state === "ok" ? "ok" : "bad");
      }}>تسجيل أنّ المشروع أُنشئ يدويًّا</button>
    </div>
  );
}

function AdminActions({ oppId, status, onDone }: {
  oppId: string; status: string; onDone: (t: string, tone: "ok" | "bad", back?: boolean) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <Field label="السبب" hint="مطلوب لإعادة الفتح وللحذف — كلاهما مُدقَّق باسم فاعله.">
        <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {status !== "open" && (
          <button className={btnGhost} disabled={busy || reason.trim().length < 3} onClick={async () => {
            setBusy(true);
            const r = await crmOpportunityReopen(oppId, reason);
            setBusy(false);
            onDone(r.state === "ok" ? "أُعيد فتح الفرصة." : r.message, r.state === "ok" ? "ok" : "bad");
          }}>إعادة الفتح</button>
        )}
        <button className={btnGhost} disabled={busy || reason.trim().length < 3} onClick={async () => {
          setBusy(true);
          const r = await crmOpportunityDelete(oppId, reason);
          setBusy(false);
          onDone(r.state === "ok" ? "حُذفت الفرصة." : r.message, r.state === "ok" ? "ok" : "bad", r.state === "ok");
        }}>حذف الفرصة</button>
      </div>
    </div>
  );
}
