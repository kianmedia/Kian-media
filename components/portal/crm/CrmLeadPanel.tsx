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
  LEAD_STATUS_EN, SOURCE_EN, BUDGET_EN, AUTHORITY_EN, NEED_EN, TIMELINE_EN, ACTIVITY_EN,
  GRADE_EN, crmLabel,
  GRADE_AR, GRADE_COLOR, crmDate, crmDateTime, crmMoney, scoreColor, crmIsoDay,
  type CrmAccess, type CrmLeadDetail, type CrmLeadStatus, type CrmRow,
} from "@/lib/portal/crm";
import {
  card, btnGhost, btnPrimary, fieldCls, Chip, Empty, Flash, Field,
  StateView, useCrmLoad, useCrmT, Section, ContractNote, Bar,
} from "./CrmAtoms";

const S = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

export default function CrmLeadPanel({
  leadId, acc, onBack, onOpenOpp,
}: {
  leadId: string; acc: CrmAccess; onBack: () => void; onOpenOpp: (id: string) => void;
}) {
  const { st, reload } = useCrmLoad<CrmLeadDetail>(() => crmLeadDetail(leadId), [leadId]);
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
          const l = d.lead as CrmRow;
          const status = String(l.status) as CrmLeadStatus;
          return (
            <div className="space-y-4">
              <div className={`${card} p-4 space-y-2`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base text-stone-100">{S(l.contact_name)}</h2>
                    <p className="text-[11px] text-stone-500 mt-1">
                      {S(l.lead_code)} · {S(l.company_name)} · {crmLabel(SOURCE_AR, SOURCE_EN, String(l.source), isAr)}
                    </p>
                  </div>
                  <div className="text-end shrink-0">
                    <div className={`text-xl tabular-nums ${scoreColor(d.score?.score ?? 0)}`}>{d.score?.score ?? 0}</div>
                    <div className={`text-[10px] ${GRADE_COLOR[d.score?.grade ?? "cold"]}`}>
                      {crmLabel(GRADE_AR, GRADE_EN, d.score?.grade ?? "cold", isAr)}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Chip>{crmLabel(LEAD_STATUS_AR, LEAD_STATUS_EN, status, isAr)}</Chip>
                  <Chip>{crmLabel(BUDGET_AR, BUDGET_EN, String(l.budget_band), isAr)}</Chip>
                  <Chip>{crmLabel(AUTHORITY_AR, AUTHORITY_EN, String(l.authority), isAr)}</Chip>
                  <Chip>{crmLabel(NEED_AR, NEED_EN, String(l.need_level), isAr)}</Chip>
                  <Chip>{crmLabel(TIMELINE_AR, TIMELINE_EN, String(l.timeline), isAr)}</Chip>
                  {l.estimated_value ? <Chip>{crmMoney(Number(l.estimated_value), String(l.currency))}</Chip> : null}
                </div>
                <div className="text-[11px] text-stone-500 leading-6" dir="auto">
                  {S(l.email)} · {S(l.phone)}
                  {l.next_action ? ` · ${t({ ar: "الإجراء التالي:", en: "Next action:" })} ${S(l.next_action)}` : ""}
                  {l.next_action_due ? ` (${crmDate(String(l.next_action_due))})` : ""}
                </div>
                {!d.can_edit && (
                  <ContractNote>
                    {t({ ar: "هذا السجلّ للاطّلاع فقط بصلاحيتك — التحرير لمالكه أو لمدير المبيعات.",
                         en: "This record is read-only for you — editing belongs to its owner or a sales manager." })}
                  </ContractNote>
                )}
              </div>

              {/* ─── الدرجة المفصَّلة ─── */}
              <Section title={t({ ar: "درجة العميل — بنودها كاملة", en: "Lead score — every component" })}
                       defaultOpen count={d.score?.components?.length ?? 0}>
                <Bar score={d.score?.score ?? 0} good={70} warn={40} />
                <p className="text-[11px] text-stone-500 leading-6">{d.score?.explain}</p>
                <ul className="space-y-1">
                  {(d.score?.components ?? []).map((c) => (
                    <li key={c.key} className="flex items-center justify-between text-xs">
                      <span className={c.matched ? "text-stone-200" : "text-stone-600"}>
                        {c.matched ? "✓" : "○"} {isAr ? c.label_ar : (c.label_en || c.label_ar)}
                      </span>
                      <span className={`tabular-nums ${c.matched ? (c.points >= 0 ? "text-emerald-300" : "text-red-300") : "text-stone-600"}`}>
                        {c.points > 0 ? `+${c.points}` : c.points}
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="text-[11px] text-stone-400 pt-2 border-t border-stone-800 space-y-1">
                  <div>
                    {t({ ar: "مجموع القواعد:", en: "Rules total:" })}{" "}
                    <span className="tabular-nums">{d.score?.rules_total ?? 0}</span>
                  </div>
                  <div>
                    {t({ ar: "تعديل يدويّ:", en: "Manual adjustment:" })}{" "}
                    <span className="tabular-nums">{d.score?.manual_adjust ?? 0}</span>
                    {d.score?.manual_reason ? ` — ${d.score.manual_reason}` : ""}
                  </div>
                  {d.score?.override !== null && d.score?.override !== undefined && (
                    <div className="text-amber-300">
                      {t({ ar: "تجاوز يدويّ:", en: "Manual override:" })} {d.score.override} — {S(d.score.override_reason)}
                    </div>
                  )}
                </div>
                {d.can_edit && <ScoreAdjust leadId={leadId} acc={acc} onDone={(t, tone) => { flash(t, tone); reload(); }} />}
              </Section>

              {/* ─── التأهيل ─── */}
              {d.can_edit && (
                <Section title={t({ ar: "التأهيل والحالة", en: "Qualification & status" })}>
                  <QualifyForm lead={l} onDone={(t, tone) => { flash(t, tone); reload(); }} />
                </Section>
              )}

              {/* ─── الأنشطة ─── */}
              <Section title={t({ ar: "الأنشطة", en: "Activities" })} defaultOpen count={(d.activities ?? []).length}>
                {d.can_edit && <ActivityForm leadId={leadId} onDone={(x, tone) => { flash(x, tone); reload(); }} />}
                {(d.activities ?? []).length === 0
                  ? <Empty message={t({ ar: "لا أنشطة بعد — أوّل اتصال يُسجَّل هنا.",
                                        en: "No activities yet — the first call is recorded here." })} />
                  : (d.activities ?? []).map((a) => (
                    <div key={String(a.id)} className="border-t border-stone-800 pt-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm text-stone-200">{S(a.subject)}</span>
                        <Chip>{crmLabel(ACTIVITY_AR, ACTIVITY_EN, String(a.kind), isAr)}</Chip>
                      </div>
                      {a.body ? <p className="text-xs text-stone-400 mt-1 leading-6 whitespace-pre-wrap">{S(a.body)}</p> : null}
                      <p className="text-[11px] text-stone-500 mt-1">
                        {crmDateTime(String(a.occurred_at))}
                        {a.follow_up_due
                          ? ` · ${t({ ar: "متابعة", en: "follow-up" })} ${crmDate(String(a.follow_up_due))}`
                          : ""}
                      </p>
                    </div>
                  ))}
              </Section>

              {/* ─── التكرار ─── */}
              <Section title={t({ ar: "سجلّات مشابهة", en: "Similar records" })}
                       count={(d.duplicates?.candidates ?? []).length}>
                {(d.duplicates?.candidates ?? []).length === 0
                  ? <Empty message={d.duplicates?.checked === false
                      ? (d.duplicates?.message ?? t({ ar: "لا مُعرِّف كافٍ للفحص.",
                                                      en: "Not enough identifying data to check." }))
                      : t({ ar: "لا سجلّ مشابه ضمن نافذة الفحص.",
                            en: "No similar record within the matching window." })} />
                  : (d.duplicates?.candidates ?? []).map((c) => (
                    <div key={c.lead_id} className="text-[11px] text-stone-400 border-t border-stone-800 pt-2 leading-6">
                      {c.visible
                        ? <>{t({ ar: "مطابقة على", en: "Matched on" })}{" "}
                            {c.match_on === "email" ? t({ ar: "البريد", en: "email" })
                              : c.match_on === "phone" ? t({ ar: "الهاتف", en: "phone" })
                              : t({ ar: "الشركة والاسم", en: "company + name" })} — {S(c.lead_code)} · {S(c.contact_name)} · {crmDate(c.created_at)}</>
                        : <>{c.note}</>}
                    </div>
                  ))}
              </Section>

              {/* ─── الفرص والتحويل ─── */}
              <Section title={t({ ar: "الفرص المرتبطة", en: "Linked opportunities" })}
                       defaultOpen count={(d.opportunities ?? []).length}>
                {(d.opportunities ?? []).map((o) => (
                  <button key={String(o.id)} className={`${btnGhost} w-full justify-between text-start`}
                          onClick={() => onOpenOpp(String(o.id))}>
                    {S(o.opp_code)} · {S(o.title)} — {crmMoney(Number(o.estimated_value))}
                  </button>
                ))}
                {(d.opportunities ?? []).length === 0 && (
                  <Empty message={t({ ar: "لا فرص بعد.", en: "No opportunities yet." })} />
                )}
                {d.can_edit && status !== "converted" && (
                  <ConvertForm leadId={leadId} onDone={(x, tone, oppId) => {
                    flash(x, tone); reload(); if (oppId) onOpenOpp(oppId);
                  }} />
                )}
                <ContractNote>
                  {t({ ar: "التحويل يُنشئ فرصة بيعية داخل وحدة المبيعات فقط. لا يُنشئ مشروعًا ولا عميلًا في منصّة المشاريع — ذلك يبقى قرارًا وإجراءً يدويًّا بعد ربح الفرصة.",
                       en: "Converting creates a sales opportunity inside the CRM only. It creates no project and no client in the project platform — that stays a manual decision after the deal is won." })}
                </ContractNote>
              </Section>

              {acc.can_manage && (
                <Section title={t({ ar: "إجراءات إدارية", en: "Administrative actions" })}>
                  <DangerDelete leadId={leadId} onDone={(x, tone) => { flash(x, tone); if (tone === "ok") onBack(); }} />
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
  const { t } = useCrmT();

  async function save(kind: "adjust" | "override") {
    setBusy(true);
    const payload: Record<string, unknown> = { lead_id: leadId };
    if (kind === "adjust") { payload.score_manual_adjust = adj === "" ? 0 : Number(adj); payload.reason = reason; }
    else { payload.score_override = ovr === "" ? null : Number(ovr); payload.override_reason = ovrReason; }
    const r = await crmLeadScoreAdjust(payload);
    setBusy(false);
    onDone(r.state === "ok" ? t({ ar: "حُدِّثت الدرجة.", en: "Score updated." }) : r.message,
           r.state === "ok" ? "ok" : "bad");
  }

  return (
    <div className="pt-3 border-t border-stone-800 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t({ ar: "تعديل يدويّ (−٥٠ … ٥٠)", en: "Manual adjustment (−50 … 50)" })}
               hint={t({ ar: "يتطلّب سببًا مكتوبًا يظهر لكلّ من يقرأ السجلّ.",
                         en: "Requires a written reason, shown to everyone who reads the record." })}>
          <input type="number" className={fieldCls} value={adj} onChange={(e) => setAdj(e.target.value)} />
        </Field>
        <Field label={t({ ar: "سبب التعديل", en: "Adjustment reason" })}>
          <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={() => void save("adjust")}>
        {t({ ar: "حفظ التعديل", en: "Save adjustment" })}
      </button>

      {acc.can_manage_scoring && (
        <div className="pt-3 border-t border-stone-800 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t({ ar: "تجاوز الدرجة (٠…١٠٠)", en: "Score override (0…100)" })}
                   hint={t({ ar: "يحلّ محلّ القواعد كلّها ويُعرض بسببه دائمًا.",
                             en: "Replaces every rule and is always shown with its reason." })}>
              <input type="number" className={fieldCls} value={ovr} onChange={(e) => setOvr(e.target.value)} />
            </Field>
            <Field label={t({ ar: "سبب التجاوز", en: "Override reason" })}>
              <input className={fieldCls} value={ovrReason} onChange={(e) => setOvrReason(e.target.value)} />
            </Field>
          </div>
          <button className={btnGhost} disabled={busy} onClick={() => void save("override")}>
            {t({ ar: "حفظ التجاوز", en: "Save override" })}
          </button>
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
  const { t, isAr } = useCrmT();
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function saveFields() {
    setBusy(true);
    const r = await crmLeadUpsert({ id: String(lead.id), ...f });
    setBusy(false);
    onDone(r.state === "ok" ? t({ ar: "حُفظ التأهيل.", en: "Qualification saved." }) : r.message,
           r.state === "ok" ? "ok" : "bad");
  }
  async function saveStatus() {
    setBusy(true);
    const r = await crmLeadSetStatus(String(lead.id), status, reason || undefined);
    setBusy(false);
    onDone(r.state === "ok" ? t({ ar: "حُدِّثت الحالة.", en: "Status updated." }) : r.message,
           r.state === "ok" ? "ok" : "bad");
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t({ ar: "الميزانية", en: "Budget" })}>
          <select className={fieldCls} value={f.budget_band} onChange={(e) => set("budget_band", e.target.value)}>
            {Object.keys(BUDGET_AR).map((k) => (
              <option key={k} value={k}>{crmLabel(BUDGET_AR, BUDGET_EN, k, isAr)}</option>
            ))}
          </select>
        </Field>
        <Field label={t({ ar: "سلطة القرار", en: "Decision authority" })}>
          <select className={fieldCls} value={f.authority} onChange={(e) => set("authority", e.target.value)}>
            {Object.keys(AUTHORITY_AR).map((k) => (
              <option key={k} value={k}>{crmLabel(AUTHORITY_AR, AUTHORITY_EN, k, isAr)}</option>
            ))}
          </select>
        </Field>
        <Field label={t({ ar: "مستوى الحاجة", en: "Need level" })}>
          <select className={fieldCls} value={f.need_level} onChange={(e) => set("need_level", e.target.value)}>
            {Object.keys(NEED_AR).map((k) => (
              <option key={k} value={k}>{crmLabel(NEED_AR, NEED_EN, k, isAr)}</option>
            ))}
          </select>
        </Field>
        <Field label={t({ ar: "الإطار الزمنيّ", en: "Timeline" })}>
          <select className={fieldCls} value={f.timeline} onChange={(e) => set("timeline", e.target.value)}>
            {Object.keys(TIMELINE_AR).map((k) => (
              <option key={k} value={k}>{crmLabel(TIMELINE_AR, TIMELINE_EN, k, isAr)}</option>
            ))}
          </select>
        </Field>
        <Field label={t({ ar: "القيمة المتوقّعة", en: "Estimated value" })}>
          <input type="number" className={fieldCls} value={f.estimated_value}
                 onChange={(e) => set("estimated_value", e.target.value)} />
        </Field>
        <Field label={t({ ar: "الإجراء التالي", en: "Next action" })}>
          <input className={fieldCls} value={f.next_action} onChange={(e) => set("next_action", e.target.value)} />
        </Field>
        <Field label={t({ ar: "تاريخ الإجراء التالي", en: "Next action due" })}>
          <input type="date" className={fieldCls} value={f.next_action_due}
                 onChange={(e) => set("next_action_due", e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={() => void saveFields()}>
        {t({ ar: "حفظ التأهيل", en: "Save qualification" })}
      </button>

      <div className="pt-3 border-t border-stone-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t({ ar: "الحالة", en: "Status" })}>
          <select className={fieldCls} value={status} onChange={(e) => setStatus(e.target.value as CrmLeadStatus)}>
            {(["new", "contacted", "working", "qualified", "unqualified", "dropped"] as const).map((k) => (
              <option key={k} value={k}>{crmLabel(LEAD_STATUS_AR, LEAD_STATUS_EN, k, isAr)}</option>
            ))}
          </select>
        </Field>
        <Field label={t({ ar: "السبب", en: "Reason" })}
               hint={t({ ar: "إلزاميّ عند «غير مؤهَّل» أو «مُسقَط» — بلا سبب لا يتعلّم أحد شيئًا.",
                         en: "Required for “Unqualified” or “Dropped” — without a reason nobody learns anything." })}>
          <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
      <button className={btnGhost} disabled={busy} onClick={() => void saveStatus()}>
        {t({ ar: "تحديث الحالة", en: "Update status" })}
      </button>
    </div>
  );
}

function ActivityForm({ leadId, onDone }: { leadId: string; onDone: (t: string, tone: "ok" | "bad") => void }) {
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
        <Field label={t({ ar: "متابعة في", en: "Follow up on" })}><input type="date" className={fieldCls} value={f.follow_up_due}
               onChange={(e) => set("follow_up_due", e.target.value)} /></Field>
        <Field label={t({ ar: "الإجراء التالي", en: "Next action" })}><input className={fieldCls} value={f.next_action ?? ""}
               onChange={(e) => set("next_action", e.target.value)} /></Field>
      </div>
      <textarea className={`${fieldCls} min-h-[80px]`} placeholder={t({ ar: "التفاصيل", en: "Details" })} value={f.body}
                onChange={(e) => set("body", e.target.value)} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy || !f.subject.trim()} onClick={async () => {
          setBusy(true);
          const r = await crmActivityLog({ ...f, lead_id: leadId, occurred_at: new Date().toISOString() });
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

function ConvertForm({ leadId, onDone }: {
  leadId: string; onDone: (t: string, tone: "ok" | "bad", oppId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [close, setClose] = useState(crmIsoDay());
  const [busy, setBusy] = useState(false);
  const { t } = useCrmT();
  if (!open) {
    return (
      <button className={btnPrimary} onClick={() => setOpen(true)}>
        {t({ ar: "تحويل إلى فرصة", en: "Convert to opportunity" })}
      </button>
    );
  }
  return (
    <div className="space-y-3 pt-3 border-t border-stone-800">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label={t({ ar: "عنوان الفرصة", en: "Opportunity title" })}><input className={fieldCls} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label={t({ ar: "القيمة المتوقّعة", en: "Estimated value" })}><input type="number" className={fieldCls} value={value} onChange={(e) => setValue(e.target.value)} /></Field>
        <Field label={t({ ar: "تاريخ الإغلاق المتوقّع", en: "Expected close date" })}><input type="date" className={fieldCls} value={close} onChange={(e) => setClose(e.target.value)} /></Field>
      </div>
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy} onClick={async () => {
          setBusy(true);
          const r = await crmLeadConvert(leadId, {
            title: title || undefined, estimated_value: value || undefined, expected_close_date: close || undefined,
          });
          setBusy(false); setOpen(false);
          if (r.state === "ok") {
            onDone(r.data.note ?? t({ ar: "أُنشئت الفرصة.", en: "Opportunity created." }), "ok", r.data.opportunity_id);
          } else onDone(r.message, "bad");
        }}>{t({ ar: "تحويل", en: "Convert" })}</button>
        <button className={btnGhost} onClick={() => setOpen(false)}>{t({ ar: "إلغاء", en: "Cancel" })}</button>
      </div>
    </div>
  );
}

function DangerDelete({ leadId, onDone }: { leadId: string; onDone: (t: string, tone: "ok" | "bad") => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { t } = useCrmT();
  return (
    <div className="space-y-2">
      <Field label={t({ ar: "سبب الحذف", en: "Deletion reason" })}
             hint={t({ ar: "الحذف منطقيّ (soft) ومُدقَّق — السجلّ يبقى في القاعدة بسببه وفاعله.",
                       en: "The delete is soft and audited — the row stays in the database with its reason and actor." })}>
        <input className={fieldCls} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <button className={btnGhost} disabled={busy || reason.trim().length < 3} onClick={async () => {
        setBusy(true);
        const r = await crmLeadDelete(leadId, reason);
        setBusy(false);
        onDone(r.state === "ok" ? t({ ar: "حُذف السجلّ.", en: "Record deleted." }) : r.message,
               r.state === "ok" ? "ok" : "bad");
      }}>{t({ ar: "حذف العميل المحتمل", en: "Delete lead" })}</button>
    </div>
  );
}
