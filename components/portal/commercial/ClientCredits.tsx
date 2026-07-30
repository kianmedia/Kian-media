"use client";
// ════════════════════════════════════════════════════════════════════════════
// ClientCredits — صفحة «رصيدي الإنتاجي» للعميل.
//
// ما تعرضه: الخطّة الحالية · تاريخا البداية والنهاية · تاريخ التجديد · الرصيد
// لكلّ وحدة إنتاج (المخصَّص والمستهلَك والمحجوز والمتاح والمنتهي) · الوحدات
// المشمولة والخدمات الإضافية وسياسة التجاوز · كشف الحركات · الطلبات الحالية ·
// الشروط والقيود · وزرّ طلب إنتاج جديد.
//
// ★★ ما لا تعرضه هذه الشاشة، ولا تستطيع عرضه ★★
//   لا سعر ولا ضريبة ولا ملاحظة داخلية ولا سبب قرار داخليّ ولا سجلّ تدقيق.
//   ليس لأنّ الواجهة تُخفيها، بل لأنّ الخادم لا يرسلها: csub_my_credits_page
//   تُسقِط هذه الحقول بالاسم من المصدر. إخفاء عمود في JSX ليس عزلًا.
//
// ★★ ولا تعرض صفرًا عن رقم لا تعرفه ★★
//   أربع حقائق مختلفة لا تُطوى في «٠»:
//     • لا ملفّ عميل مرتبط بالحساب.
//     • لا اشتراك مفعّل.
//     • اشتراك بلا وحدات مُسنَدة بعد.
//     • وحدة بلا أيّ حركة في الدفتر.
//   ولكلّ واحدة نصّها. عميل يقرأ «٠ وحدة» بينما الحقيقة إحدى هذه الأربع
//   سيتّصل يشكو خطأ فوترة — وسيكون محقًّا، لأنّ الشاشة كذبت عليه.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  getMyCreditsPage, cancelServiceRequest, csubUnits, csubDate, csubReasonAr,
  CSUB_STATUS_AR, CSUB_STATUS_TONE, CSUB_ENTRY_AR, CSUB_TERMINAL,
  type CsubCreditsPage, type CsubServiceRequest, type CsubUnitBalance,
} from "@/lib/portal/commercial";
import {
  card, btnPrimary, btnGhost, Section, StateView, useCsubLoad,
  CreditStat, Chip, Empty, UnknownBalance, ScrollBox, ErrorBox,
} from "./CsubAtoms";
import ProductionRequestForm from "./ProductionRequestForm";

export default function ClientCredits() {
  const { st, reload } = useCsubLoad<CsubCreditsPage>(() => getMyCreditsPage(), []);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<CsubServiceRequest | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const cancel = async (r: CsubServiceRequest) => {
    setActionErr(null);
    setBusyId(r.id);
    const res = await cancelServiceRequest(r.id, "إلغاء بطلب العميل من البوّابة");
    setBusyId(null);
    if (res.state !== "ok") { setActionErr(res.message); return; }
    reload();
  };

  return (
    <StateView st={st} onRetry={reload}>
      {(d) => {
        const sub = d.subscription;
        const balances = d.balances;
        const statement = d.statement ?? [];
        const requests = d.requests ?? [];
        const open = requests.filter((r) => !CSUB_TERMINAL.includes(r.status));
        const closed = requests.filter((r) => CSUB_TERMINAL.includes(r.status));

        // ─── لا ملفّ عميل مرتبط بالحساب ──────────────────────────────────
        if (!d.has_client_profile) {
          return (
            <UnknownBalance
              title="لا يوجد ملفّ عميل مرتبط بحسابك"
              reason={csubReasonAr("no_client_profile")}
            />
          );
        }

        return (
          <div className="space-y-8">
            {/* ─── الخطّة والمُدد ─────────────────────────────────────── */}
            {!d.has_subscription || !sub ? (
              <UnknownBalance
                title="لا يوجد اشتراك إنتاج مفعّل"
                reason={csubReasonAr("no_active_subscription")}
              />
            ) : (
              <Section
                title="اشتراكك الحاليّ"
                note={sub.code ? `المرجع ${sub.code}` : undefined}
                actions={
                  <div className="flex gap-2 items-center flex-wrap">
                    <Chip
                      text={sub.is_expired ? "منتهٍ" : sub.status === "active" ? "مفعّل"
                        : sub.status === "suspended" ? "موقوف" : sub.status}
                      tone={sub.is_expired ? "bad" : sub.status === "active" ? "good" : "warn"}
                    />
                    {!formOpen && sub.status === "active" && (
                      <button className={btnPrimary} onClick={() => { setDraft(null); setFormOpen(true); }}>
                        طلب إنتاج جديد
                      </button>
                    )}
                  </div>
                }
              >
                <div className={`${card} p-4 space-y-3`} dir="rtl">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-stone-100 text-base font-medium">
                      {sub.plan_name ?? "خطّة غير مسمّاة"}
                    </span>
                    {sub.contract_reference && (
                      <span className="text-[11px] text-stone-600">عقد {sub.contract_reference}</span>
                    )}
                  </div>
                  {sub.description && (
                    <p className="text-sm text-stone-400 leading-7">{sub.description}</p>
                  )}
                  <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                    <CreditStat label="تاريخ البداية" value={csubDate(sub.start_date)} />
                    <CreditStat label="تاريخ الانتهاء" value={csubDate(sub.end_date)}
                                tone={sub.is_expired ? "bad" : "normal"} />
                    <CreditStat label="تاريخ التجديد" value={csubDate(sub.renewal_date)} />
                    <CreditStat
                      label="المتبقّي من المدّة"
                      value={sub.days_remaining === null ? "غير محدّد"
                        : sub.days_remaining < 0 ? "انتهت المدّة"
                        : `${sub.days_remaining} يومًا`}
                      tone={sub.days_remaining !== null && sub.days_remaining < 15 ? "warn" : "normal"}
                    />
                  </div>
                  <p className="text-[11px] text-stone-500 leading-6 border-t border-stone-800 pt-3">
                    التجديد التلقائيّ: {sub.auto_renew ? "منصوص عليه في العقد" : "غير منصوص عليه"} —{" "}
                    {sub.auto_renew_note}
                    {sub.grace_period_days > 0 && ` · مهلة سماح ${sub.grace_period_days} يومًا بعد الانتهاء.`}
                  </p>
                </div>
              </Section>
            )}

            {/* ─── الأرصدة لكلّ وحدة ───────────────────────────────────── */}
            {d.has_subscription && (
              <Section
                title="رصيد الإنتاج"
                note="الرصيد محسوب من دفتر الحركات — كلّ رقم هنا مسنود بحركات ظاهرة في «كشف الحركات» أدناه."
              >
                {balances === null || balances.length === 0 ? (
                  <UnknownBalance
                    title="لم تُسنَد وحدات إنتاج إلى اشتراكك بعد"
                    reason={csubReasonAr("no_units_on_subscription")}
                  />
                ) : (
                  <div className="space-y-4">
                    {balances.map((b) => <UnitBalanceCard key={b.unit_type} b={b} />)}
                  </div>
                )}
              </Section>
            )}

            {/* ─── الوحدات المشمولة والخدمات الإضافية ──────────────────── */}
            {d.has_subscription && sub && (
              <Section
                title="الخدمات الإضافية والتجاوز"
                note="ما هو مشمول في كلّ فترة، وما يحدث حين يُطلب أكثر منه."
              >
                <div className={`${card} p-4 space-y-3`} dir="rtl">
                  {balances && balances.some((b) => b.entitlement_per_period !== null) ? (
                    <ul className="space-y-1">
                      {balances.filter((b) => b.entitlement_per_period !== null).map((b) => (
                        <li key={b.unit_type} className="text-sm text-stone-300">
                          {b.label_ar}:{" "}
                          <span className="text-stone-100">
                            {csubUnits(Number(b.entitlement_per_period), b.uom_ar)}
                          </span>{" "}
                          <span className="text-stone-600 text-xs">لكلّ فترة</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-stone-500">لم تُحدَّد كمّيات مشمولة لكلّ فترة على اشتراكك.</p>
                  )}
                  <p className="text-xs text-stone-400 leading-7 border-t border-stone-800 pt-3">
                    {sub.allow_overage
                      ? sub.overage_requires_approval
                        ? "يسمح اشتراكك بطلب خدمات تتجاوز رصيدك، ويحتاج التجاوز اعتمادًا من كيان قبل التنفيذ. لا يُخصم شيء قبل الاعتماد."
                        : "يسمح اشتراكك بطلب خدمات تتجاوز رصيدك، وتُحتسب الزيادة عليك حسب العقد."
                      : "اشتراكك لا يسمح بتجاوز الرصيد. الطلب الذي يتجاوز المتاح يحتاج ترتيبًا تعاقديًّا معنا أوّلًا."}
                  </p>
                  {sub.limitations && (
                    <p className="text-xs text-stone-400 leading-7">{sub.limitations}</p>
                  )}
                </div>
              </Section>
            )}

            {/* ─── النموذج ─────────────────────────────────────────────── */}
            {formOpen && sub && (
              <ProductionRequestForm
                subscriptionId={sub.id}
                balances={balances}
                draft={draft}
                onCancel={() => { setFormOpen(false); setDraft(null); }}
                onDone={() => { setFormOpen(false); setDraft(null); reload(); }}
              />
            )}

            {/* ─── الطلبات الحالية ─────────────────────────────────────── */}
            <Section
              title="طلباتي الحالية"
              note="من التقديم حتى التنفيذ. اعتماد الطلب لا يُنشئ مشروعًا — إنشاء المشروع خطوة يدويّة يقوم بها فريق كيان."
              actions={
                d.has_subscription && sub?.status === "active" && !formOpen ? (
                  <button className={btnGhost} onClick={() => { setDraft(null); setFormOpen(true); }}>
                    طلب جديد
                  </button>
                ) : undefined
              }
            >
              {actionErr && <ErrorBox message={actionErr} />}
              {open.length === 0 ? (
                <Empty message="لا توجد طلبات قيد المعالجة." />
              ) : (
                <div className="space-y-3">
                  {open.map((r) => (
                    <RequestCard
                      key={r.id} r={r} busy={busyId === r.id}
                      onCancel={() => void cancel(r)}
                      onEdit={r.status === "draft" ? () => { setDraft(r); setFormOpen(true); } : undefined}
                    />
                  ))}
                </div>
              )}
            </Section>

            {/* ─── كشف الحركات ─────────────────────────────────────────── */}
            {d.has_subscription && (
              <Section title="كشف الحركات" note="كلّ حركة على رصيدك، بترتيب زمنيّ عكسيّ.">
                {statement.length === 0 ? (
                  <Empty message="لا توجد حركات على رصيدك حتى الآن." />
                ) : (
                  <ScrollBox>
                    <table className="w-full text-xs min-w-[620px]" dir="rtl">
                      <thead>
                        <tr className="text-stone-500 text-right">
                          <th className="py-2 px-2 font-normal">#</th>
                          <th className="py-2 px-2 font-normal">التاريخ</th>
                          <th className="py-2 px-2 font-normal">الحركة</th>
                          <th className="py-2 px-2 font-normal">الوحدة</th>
                          <th className="py-2 px-2 font-normal">الكمّية</th>
                          <th className="py-2 px-2 font-normal">المتاح بعدها</th>
                          <th className="py-2 px-2 font-normal">الطلب</th>
                          <th className="py-2 px-2 font-normal">الوصف</th>
                        </tr>
                      </thead>
                      <tbody>
                        {statement.map((e) => (
                          <tr key={e.entry_no} className="border-t border-stone-800 align-top">
                            <td className="py-2 px-2 text-stone-600">{e.entry_no}</td>
                            <td className="py-2 px-2 text-stone-400 whitespace-nowrap">{csubDate(e.usage_date)}</td>
                            <td className="py-2 px-2 text-stone-200">{CSUB_ENTRY_AR[e.entry_type] ?? e.entry_type}</td>
                            <td className="py-2 px-2 text-stone-400">{e.unit_type}</td>
                            <td className="py-2 px-2 text-stone-300 whitespace-nowrap">{csubUnits(Number(e.quantity), "")}</td>
                            <td className="py-2 px-2 text-stone-300 whitespace-nowrap">
                              {csubUnits(Number(e.running_available), "")}
                            </td>
                            <td className="py-2 px-2 text-stone-500 whitespace-nowrap">{e.service_request_ref ?? "—"}</td>
                            <td className="py-2 px-2 text-stone-400 leading-6">{e.description ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollBox>
                )}
              </Section>
            )}

            {/* ─── الطلبات المنتهية ────────────────────────────────────── */}
            {closed.length > 0 && (
              <Section title="طلبات منتهية">
                <div className="space-y-3">
                  {closed.map((r) => <RequestCard key={r.id} r={r} busy={false} />)}
                </div>
              </Section>
            )}

            {/* ─── الشروط ──────────────────────────────────────────────── */}
            {sub?.terms && (
              <Section title="شروط الخطّة" note="الشروط كما هي في اشتراكك.">
                <div className={`${card} p-4`} dir="rtl">
                  <p className="text-sm text-stone-300 leading-8 whitespace-pre-wrap">{sub.terms}</p>
                </div>
              </Section>
            )}
          </div>
        );
      }}
    </StateView>
  );
}

// ─── بطاقة رصيد وحدة ────────────────────────────────────────────────────────

function UnitBalanceCard({ b }: { b: CsubUnitBalance }) {
  // ★ لا حركة ⇒ لا رقم ★ — الوحدة موجودة على الاشتراك ولم يُخصَّص لها شيء بعد.
  if (!b.has_entries) {
    return (
      <UnknownBalance
        title={b.label_ar}
        reason="لم تُسجَّل أيّ حركة على هذه الوحدة بعد، فلا يوجد رصيد نعرضه. هذا ليس رصيدًا صفرًا."
      />
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap" dir="rtl">
        <span className="text-sm text-stone-100">{b.label_ar}</span>
        <span className="text-[11px] text-stone-600">{b.uom_ar}</span>
        {b.is_overage && <Chip text="تجاوز معتمَد" tone="bad" />}
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        <CreditStat label="المخصَّص" value={csubUnits(Number(b.allocated), b.uom_ar)} />
        <CreditStat label="المستهلَك" value={csubUnits(Number(b.used), b.uom_ar)} />
        <CreditStat label="المحجوز" value={csubUnits(Number(b.reserved), b.uom_ar)} tone="warn"
                    hint="محجوز لطلبات قيد التنفيذ" />
        <CreditStat label="المنتهي" value={csubUnits(Number(b.expired), b.uom_ar)}
                    tone={Number(b.expired) > 0 ? "bad" : "normal"} />
        <CreditStat
          label="المتاح"
          value={csubUnits(Number(b.available), b.uom_ar)}
          tone={b.is_overage ? "bad" : Number(b.available) > 0 ? "good" : "warn"}
        />
      </div>
      {b.is_overage && (
        <p className="text-xs text-red-300 leading-6" dir="rtl">
          المتاح سالب لأنّ استهلاكًا متجاوِزًا اعتُمد لك. وضع مسجَّل ومعروف، وليس خطأ حساب.
        </p>
      )}
      <p className="text-[11px] text-stone-600 leading-6" dir="rtl">
        المتاح = المخصَّص − المستهلَك − المحجوز − المنتهي · عدد الحركات {b.entries}
      </p>
    </div>
  );
}

// ─── بطاقة طلب ──────────────────────────────────────────────────────────────

function RequestCard({ r, busy, onCancel, onEdit }: {
  r: CsubServiceRequest; busy: boolean; onCancel?: () => void; onEdit?: () => void;
}) {
  const terminal = CSUB_TERMINAL.includes(r.status);
  return (
    <div className={`${card} p-4 space-y-3`} dir="rtl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-stone-100">{r.unit_label_ar ?? r.unit_type}</span>
            <Chip text={CSUB_STATUS_AR[r.status]} tone={CSUB_STATUS_TONE[r.status]} />
            {r.is_urgent && <Chip text="عاجل" tone="warn" />}
          </div>
          <div className="text-[11px] text-stone-600">{r.code ?? r.id.slice(0, 8)}</div>
        </div>
        <div className="flex gap-2">
          {onEdit && <button className={btnGhost} onClick={onEdit} disabled={busy}>تعديل</button>}
          {onCancel && !terminal && (
            <button className={btnGhost} onClick={onCancel} disabled={busy}>
              {busy ? "…" : "إلغاء الطلب"}
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 text-xs">
        <Field label="عدد الوحدات" value={csubUnits(Number(r.units), "")} />
        <Field label="المدينة" value={r.city ?? "—"} />
        <Field label="التاريخ المفضّل" value={csubDate(r.preferred_date)} />
        <Field label="تاريخ بديل" value={csubDate(r.alternative_date)} />
        <Field label="الرصيد المطلوب" value={csubUnits(Number(r.credits_required), "")} />
        <Field
          label="تقدير التجاوز"
          value={Number(r.overage_estimate_units) > 0
            ? csubUnits(Number(r.overage_estimate_units), "")
            : "لا تجاوز"}
        />
        {r.scheduled_date && <Field label="موعد التنفيذ" value={csubDate(r.scheduled_date)} />}
        {r.location_text && <Field label="الموقع" value={r.location_text} />}
      </div>

      {r.description && <p className="text-xs text-stone-400 leading-6">{r.description}</p>}

      {r.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-[11px] text-stone-600">بيانات مرفقات:</span>
          {r.attachments.map((a) => <Chip key={a.id} text={a.file_name} />)}
        </div>
      )}

      {r.status === "needs_overage_approval" && (
        <p className="text-xs text-amber-300 leading-6">
          هذا الطلب يتجاوز رصيدك المتاح وينتظر اعتمادًا من كيان قبل تنفيذه. لم يُخصم من رصيدك شيء.
        </p>
      )}
      {r.status === "credit_reserved" && (
        <p className="text-xs text-stone-400 leading-6">
          حُجز الرصيد لهذا الطلب. الحجز ليس استهلاكًا — يُخصم فعليًّا عند التنفيذ، ويعود إليك إن أُلغي الطلب.
        </p>
      )}
      {r.status === "approved" && (
        <p className="text-xs text-emerald-300/90 leading-6">
          اعتُمد الطلب. إنشاء المشروع خطوة يدويّة منفصلة يقوم بها فريق كيان، ولا تتمّ تلقائيًّا بالاعتماد.
        </p>
      )}
      {r.client_decision_note && (
        <p className="text-xs text-stone-300 leading-6 border-t border-stone-800 pt-2">
          {r.client_decision_note}
        </p>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] text-stone-600">{label}</div>
      <div className="text-stone-300">{value}</div>
    </div>
  );
}
