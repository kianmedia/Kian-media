"use client";
// ════════════════════════════════════════════════════════════════════════════
// CrmLeadPanel — بطاقة العميل المحتمل: التأهيل · الدرجة المفصَّلة · الأنشطة ·
// التكرار · التحويل إلى فرصة.
//
// ★ الدرجة تُعرض ببنودها كلّها (مطابِقة وغير مطابِقة) لأنّ رقمًا بلا تفسير هو
//   صندوق أسود، والمطلوب صراحةً أن تكون صريحة وقابلة للتحرير.
// ★ «تحويل» يُنشئ **فرصة بيعية داخل المبيعات فقط** — لا مشروع ولا عميل في
//   منصّة المشاريع.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  crmLeadDetail, crmLeadSetStatus, crmLeadScoreAdjust, crmLeadConvert, crmActivityLog,
  crmLeadUpsert, crmLeadDelete,
  LEAD_STATUS_AR, SOURCE_AR, BUDGET_AR, AUTHORITY_AR, NEED_AR, TIMELINE_AR, ACTIVITY_AR,
  GRADE_AR, GRADE_COLOR, crmDate, crmDateTime, crmMoney, scoreColor, crmIsoDay,
  type CrmAccess, type CrmLeadDetail, type CrmLeadStatus, type CrmRow,
} from "@/lib/portal/crm";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Empty, Flash, Field,
  StateView, useCrmLoad, Section, ContractNote, Bar,
} from "./CrmAtoms";

const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

export default function CrmLeadPanel({
  leadId, acc, onBack, onOpenOpp,
}: {
  leadId: string; acc: CrmAccess; onBack: () => void; onOpenOpp: (id: string) => void;
}) {
  const { st, reload } = useCrmLoad<CrmLeadDetail>(() => crmLeadDetail(leadId), [leadId]);
  const [msg, setMsg] = useState<{ t: string; tone: "ok" | "bad" } | null>(null);
  const flash = (t: string, tone: "ok" | "bad") => setMsg({ t, tone });

  return (
    <div className="space-y-4">
      <button className={btnGhost} onClick={onBack}>◂ رجوع للقائمة</button>
      {msg && <Flash text={msg.t} tone={msg.tone} />}
      <StateView st={st} onRetry={reload}>
        {(d) => {
          const l = d.lead as CrmRow;
          const status = String(l.status) as CrmLeadStatus;
          return (
            <div className="space-y-4">
              <div className={`${card} p-4 space-y-2`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base text-stone-100">{S(l.contact_name)}</h2>
                    <p className="text-[11px] text-stone-500 mt-1">
                      {S(l.lead_code)} · {S(l.company_name)} · {SOURCE_AR[String(l.source)] ?? S(l.source)}
                    </p>
                  </div>
                  <div className="text-left shrink-0">
                    <div className={`text-xl tabular-nums ${scoreColor(d.score?.score ?? 0)}`}>{d.score?.score ?? 0}</div>
                    <div className={`text-[10px] ${GRADE_COLOR[d.score?.grade ?? "cold"]}`}>
                      {GRADE_AR[d.score?.grade ?? "cold"]}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip>{LEAD_STATUS_AR[status] ?? status}</Chip>
                  <Chip>{BUDGET_AR[String(l.budget_band)] ?? S(l.budget_band)}</Chip>
                  <Chip>{AUTHORITY_AR[String(l.authority)] ?? S(l.authority)}</Chip>
                  <Chip>{NEED_AR[String(l.need_level)] ?? S(l.need_level)}</Chip>
                  <Chip>{TIMELINE_AR[String(l.timeline)] ?? S(l.timeline)}</Chip>
                  {l.estimated_value ? <Chip>{crmMoney(Number(l.estimated_value), String(l.currency))}</Chip> : null}
                </div>
                <div className="text-[11px] text-stone-500 leading-6" dir="auto">
                  {S(l.email)} · {S(l.phone)}
                  {l.next_action ? ` · الإجراء التالي: ${S(l.next_action)}` : ""}
                  {l.next_action_due ? ` (${crmDate(String(l.next_action_due))})` : ""}
                </div>
                {!d.can_edit && (
                  <ContractNote>هذا السجلّ للاطّلاع فقط بصلاحيتك — التحرير لمالكه أو لمدير المبيعات.</ContractNote>
                )}
              </div>

              {/* ─── الدرجة المفصَّلة ─── */}
              <Section title="درجة العميل — بنودها كاملة" defaultOpen count={d.score?.components?.length ?? 0}>
                <Bar score={d.score?.score ?? 0} good={70} warn={40} />
                <p className="text-[11px] text-stone-500 leading-6">{d.score?.explain}</p>
                <ul className="space-y-1">
                  {(d.score?.components ?? []).map((c) => (
                    <li key={c.key} className="flex items-center justify-between text-xs">
                      <span className={c.matched ? "text-stone-200" : "text-stone-600"}>
                        {c.matched ? "✓" : "○"} {c.label_ar}
                      </span>
                      <span className={`tabular-nums ${c.matched ? (c.points >= 0 ? "text-emerald-300" : "text-red-300") : "text-stone-600"}`}>
                        {c.points > 0 ? `+${c.points}` : c.points}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="text-[11px] text-stone-400 pt-2 border-t border-stone-800 space-y-1">
                  <div>مجموع القواعد: <span className="tabular-nums">{d.score?.rules_total ?? 0}</span></div>
                  <div>
                    تعديل يدويّ: <span className="tabular-nums">{d.score?.manual_adjust ?? 0}</span>
                    {d.score?.manual_reason ? ` — ${d.score.manual_reason}` : ""}
                  </div>
                  {d.score?.override !== null && d.score?.override !== undefined && (
                    <div className="text-amber-300">
                      تجاوز يدويّ: {d.score.override} — {S(d.score.override_reason)}
                    </div>
                  )}
                </div>
                {d.can_edit && <ScoreAdjust leadId={leadId} acc={acc} onDone={(t, tone) => { flash(t, tone); reload(); }} />}
              </Section>

              {/* ─── التأهيل ─── */}
              {d.can_edit && (
                <Section title="التأهيل والحالة">
                  <QualifyForm lead={l} onDone={(t, tone) => { flash(t, tone); reload(); }} />
                </Section>
              )}

              {/* ─── الأنشطة ─── */}
              <Section title="الأنشطة" defaultOpen count={(d.activities ?? []).length}>
                {d.can_edit && <ActivityForm leadId={leadId} onDone={(t, tone) => { flash(t, tone); reload(); }} />}
                {(d.activities ?? []).length === 0
                  ? <Empty message="لا أنشطة بعد — أوّل اتصال يُسجَّل هنا." />
                  : (d.activities ?? []).map((a) => (
                    <div key={String(a.id)} className="border-t border-stone-800 pt-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm text-stone-200">{S(a.subject)}</span>
                        <Chip>{ACTIVITY_AR[String(a.kind) as keyof typeof ACTIVITY_AR] ?? S(a.kind)}</Chip>
                      </div>
                      {a.body ? <p className="text-xs text-stone-400 mt-1 leading-6 whitespace-pre-wrap">{S(a.body)}</p> : null}
                      <p className="text-[11px] text-stone-500 mt-1">
                        {crmDateTime(String(a.occurred_at))}
                        {a.follow_up_due ? ` · متابعة ${crmDate(String(a.follow_up_due))}` : ""}
                      </p>
                    </div>
                  ))}
              </Section>

              {/* ─── التكرار ─── */}
              <Section title="سجلّات مشابهة" count={(d.duplicates?.candidates ?? []).length}>
                {(d.duplicates?.candidates ?? []).length === 0
                  ? <Empty message={d.duplicates?.checked === false
                      ? (d.duplicates?.message ?? "لا مُعرِّف كافٍ للفحص.")
                      : "لا سجلّ مشابه ضمن نافذة الفحص."} />
                  : (d.duplicates?.candidates ?? []).map((c) => (
                    <div key={c.lead_id} className="text-[11px] text-stone-400 border-t border-stone-800 pt-2 leading-6">
                      {c.visible
                        ? <>مطابقة على {c.match_on === "email" ? "البريد" : c.match_on === "phone" ? "الهاتف" : "الشركة والاسم"} — {S(c.lead_code)} · {S(c.contact_name)} · {crmDate(c.created_at)}</>
                        : <>{c.note}</>}
                    </div>
                  ))}
              </Section>

              {/* ─── الفرص والتحويل ─── */}
              <Section title="الفرص المرتبطة" defaultOpen count={(d.opportunities ?? []).length}>
                {(d.opportunities ?? []).map((o) => (
                  <button key={String(o.id)} className={`${btnGhost} w-full justify-between text-right`}
                          onClick={() => onOpenOpp(String(o.id))}>
                    {S(o.opp_code)} · {S(o.title)} — {crmMoney(Number(o.estimated_value))}
                  </button>
                ))}
                {(d.opportunities ?? []).length === 0 && <Empty message="لا فرص بعد." />}
                {d.can_edit && status !== "converted" && (
                  <ConvertForm leadId={leadId} onDone={(t, tone, oppId) => {
                    flash(t, tone); reload(); if (oppId) onOpenOpp(oppId);
                  }} />
                )}
                <ContractNote>
                  التحويل يُنشئ فرصة بيعية داخل وحدة المبيعات فقط. لا يُنشئ مشروعًا ولا عميلًا في منصّة المشاريع —
                  ذلك يبقى قرارًا وإجراءً يدويًّا بعد ربح الفرصة.
                </ContractNote>
              </Section>

              {acc.can_manage && (
                <Section title="إجراءات إدارية">
                  <DangerDelete leadId={leadId} onDone={(t, tone) => { flash(t, tone); if (tone === "ok") onBack(); }} />
                </Section>
              )}
            </div>
          );
        }}
      </StateView>
    </div>
  );
}

function ScoreAdjust({ leadId, acc, onDone }: {
  leadId: string; acc: CrmAccess; onDone: (t: string, tone: "ok" | "bad") => void;
}) {
  const [adj, setAdj] = useState("");
  const [reason, setReason] = useState("");
  const [ovr, setOvr] = useState("");
  const [ovrReason, setOvrReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(kind: "adjust" | "override") {
    setBusy(true);
    const payload: Record<string, unknown> = { lead_id: leadId };
    if (kind === "adjust") { payload.score_manual_adjust = adj === "" ? 0 : Number(adj); payload.reason = reason; }
    else { payload.score_override = ovr === "" ? null : Number(ovr); payload.override_reason = ovrReason; }
    const r = await crmLeadScoreAdjust(payload);
    setBusy(false);
    onDone(r.state === "ok" ? "حُدِّثت الدرجة." : r.message, r.state === "ok" ? "ok" : "bad");
  }

  return (
    <div className="pt-3 border-t border-stone-800 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="تعديل يدويّ (−٥٠ … ٥٠)" hint="يتطلّب سببًا مكتوبًا يظهر لكلّ من يقرأ السجلّ.">
          <input type="number" className={fieldCls} value={adj} onChange={(e) => setAdj(e.target.value)} />
        </Field>
        <Field label="سبب التعديل">
          <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={() => void save("adjust")}>حفظ التعديل</button>

      {acc.can_manage_scoring && (
        <div className="pt-3 border-t border-stone-800 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="تجاوز الدرجة (٠…١٠٠)" hint="يحلّ محلّ القواعد كلّها ويُعرض بسببه دائمًا.">
              <input type="number" className={fieldCls} value={ovr} onChange={(e) => setOvr(e.target.value)} />
            </Field>
            <Field label="سبب التجاوز">
              <input className={fieldCls} value={ovrReason} onChange={(e) => setOvrReason(e.target.value)} />
            </Field>
          </div>
          <button className={btnGhost} disabled={busy} onClick={() => void save("override")}>حفظ التجاوز</button>
        </div>
      )}
    </div>
  );
}

function QualifyForm({ lead, onDone }: { lead: CrmRow; onDone: (t: string, tone: "ok" | "bad") => void }) {
  const [f, setF] = useState<Record<string, string>>({
    budget_band: String(lead.budget_band ?? "unknown"),
    authority: String(lead.authority ?? "unknown"),
    need_level: String(lead.need_level ?? "unknown"),
    timeline: String(lead.timeline ?? "unknown"),
    estimated_value: lead.estimated_value ? String(lead.estimated_value) : "",
    next_action: String(lead.next_action ?? ""),
    next_action_due: String(lead.next_action_due ?? ""),
  });
  const [status, setStatus] = useState<CrmLeadStatus>(String(lead.status) as CrmLeadStatus);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function saveFields() {
    setBusy(true);
    const r = await crmLeadUpsert({ id: String(lead.id), ...f });
    setBusy(false);
    onDone(r.state === "ok" ? "حُفظ التأهيل." : r.message, r.state === "ok" ? "ok" : "bad");
  }
  async function saveStatus() {
    setBusy(true);
    const r = await crmLeadSetStatus(String(lead.id), status, reason || undefined);
    setBusy(false);
    onDone(r.state === "ok" ? "حُدِّثت الحالة." : r.message, r.state === "ok" ? "ok" : "bad");
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="الميزانية">
          <select className={fieldCls} value={f.budget_band} onChange={(e) => set("budget_band", e.target.value)}>
            {Object.entries(BUDGET_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
          </select>
        </Field>
        <Field label="سلطة القرار">
          <select className={fieldCls} value={f.authority} onChange={(e) => set("authority", e.target.value)}>
            {Object.entries(AUTHORITY_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
          </select>
        </Field>
        <Field label="مستوى الحاجة">
          <select className={fieldCls} value={f.need_level} onChange={(e) => set("need_level", e.target.value)}>
            {Object.entries(NEED_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
          </select>
        </Field>
        <Field label="الإطار الزمنيّ">
          <select className={fieldCls} value={f.timeline} onChange={(e) => set("timeline", e.target.value)}>
            {Object.entries(TIMELINE_AR).map(([k, ar]) => <option key={k} value={k}>{ar}</option>)}
          </select>
        </Field>
        <Field label="القيمة المتوقّعة">
          <input type="number" className={fieldCls} value={f.estimated_value}
                 onChange={(e) => set("estimated_value", e.target.value)} />
        </Field>
        <Field label="الإجراء التالي">
          <input className={fieldCls} value={f.next_action} onChange={(e) => set("next_action", e.target.value)} />
        </Field>
        <Field label="تاريخ الإجراء التالي">
          <input type="date" className={fieldCls} value={f.next_action_due}
                 onChange={(e) => set("next_action_due", e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={() => void saveFields()}>حفظ التأهيل</button>

      <div className="pt-3 border-t border-stone-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="الحالة">
          <select className={fieldCls} value={status} onChange={(e) => setStatus(e.target.value as CrmLeadStatus)}>
            {(["new", "contacted", "working", "qualified", "unqualified", "dropped"] as const).map((k) => (
              <option key={k} value={k}>{LEAD_STATUS_AR[k]}</option>
            ))}
          </select>
        </Field>
        <Field label="السبب" hint="إلزاميّ عند «غير مؤهَّل» أو «مُسقَط» — بلا سبب لا يتعلّم أحد شيئًا.">
          <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={() => void saveStatus()}>تحديث الحالة</button>
    </div>
  );
}

function ActivityForm({ leadId, onDone }: { leadId: string; onDone: (t: string, tone: "ok" | "bad") => void }) {
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
        <Field label="متابعة في"><input type="date" className={fieldCls} value={f.follow_up_due}
               onChange={(e) => set("follow_up_due", e.target.value)} /></Field>
        <Field label="الإجراء التالي"><input className={fieldCls} value={f.next_action ?? ""}
               onChange={(e) => set("next_action", e.target.value)} /></Field>
      </div>
      <textarea className={`${fieldCls} min-h-[80px]`} placeholder="التفاصيل" value={f.body}
                onChange={(e) => set("body", e.target.value)} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy || !f.subject.trim()} onClick={async () => {
          setBusy(true);
          const r = await crmActivityLog({ ...f, lead_id: leadId, occurred_at: new Date().toISOString() });
          setBusy(false); setOpen(false);
          onDone(r.state === "ok" ? "سُجِّل النشاط." : r.message, r.state === "ok" ? "ok" : "bad");
        }}>حفظ</button>
        <button className={btnGhost} onClick={() => setOpen(false)}>إلغاء</button>
      </div>
    </div>
  );
}

function ConvertForm({ leadId, onDone }: {
  leadId: string; onDone: (t: string, tone: "ok" | "bad", oppId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [close, setClose] = useState(crmIsoDay());
  const [busy, setBusy] = useState(false);
  if (!open) return <button className={btnPrimary} onClick={() => setOpen(true)}>تحويل إلى فرصة</button>;
  return (
    <div className="space-y-3 pt-3 border-t border-stone-800">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="عنوان الفرصة"><input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="القيمة المتوقّعة"><input type="number" className={fieldCls} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label="تاريخ الإغلاق المتوقّع"><input type="date" className={fieldCls} value={close} onChange={(e) => setClose(e.target.value)} /></Field>
      </div>
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await crmLeadConvert(leadId, {
            title: title || undefined, estimated_value: value || undefined, expected_close_date: close || undefined,
          });
          setBusy(false); setOpen(false);
          if (r.state === "ok") onDone(r.data.note ?? "أُنشئت الفرصة.", "ok", r.data.opportunity_id);
          else onDone(r.message, "bad");
        }}>تحويل</button>
        <button className={btnGhost} onClick={() => setOpen(false)}>إلغاء</button>
      </div>
    </div>
  );
}

function DangerDelete({ leadId, onDone }: { leadId: string; onDone: (t: string, tone: "ok" | "bad") => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Field label="سبب الحذف" hint="الحذف منطقيّ (soft) ومُدقَّق — السجلّ يبقى في القاعدة بسببه وفاعله.">
        <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <button className={btnGhost} disabled={busy || reason.trim().length < 3} onClick={async () => {
        setBusy(true);
        const r = await crmLeadDelete(leadId, reason);
        setBusy(false);
        onDone(r.state === "ok" ? "حُذف السجلّ." : r.message, r.state === "ok" ? "ok" : "bad");
      }}>حذف العميل المحتمل</button>
    </div>
  );
}
