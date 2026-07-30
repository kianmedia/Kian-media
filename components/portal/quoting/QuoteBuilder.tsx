"use client";
// ════════════════════════════════════════════════════════════════════════════
// QuoteBuilder — بناء عرض سعر واحد: النطاق، البنود، السعر، الدفعات، الشروط.
//
// ★ ما لا يوجد في هذا الملفّ ★
//   لا تكلفة، ولا هامش، ولا حدّ أدنى، ولا استدعاء لأيّ دالّة تقرؤها. لوحة
//   المالك مكوّن منفصل (OwnerPricingPanel) بنداءات منفصلة تردّ 42501 لغير
//   المالك. الفصل هنا يطابق الفصل في القاعدة عمدًا: لو جمعناهما في مكوّن
//   واحد لصار «أخفِ الحقل إن لم يكن مالكًا» — وإخفاء حقل ليس حجبًا.
//
// ★ المدى المسموح ليس الحدّ الأدنى ★
//   permitted_min = السقف × (١ − صلاحية خصمي). سقفه سعر القائمة أو المعتمَد،
//   وصلاحية الخصم سُلّم سياسة معلَن. لا أحدهما مشتقّ من التكلفة، ولا يدلّ
//   عليها. الموظّف يعرف هذين الرقمين عن نفسه سلفًا.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  fetchQuote, fetchQuoteLines, fetchQuoteMilestones, fetchCatalog,
  setQuoteLine, deleteQuoteLine, setQuotePrice, setQuoteTerms, setQuoteMilestones,
  submitQuote, markReadyForManualSend, recordClientDecision, newQuoteVersion,
  fetchQuoteActivity, sar,
  type QuoteDetail, type QuoteLine, type QuoteMilestone, type CatalogItem,
  type QuoteActivity, type SqState,
} from "@/lib/portal/quoting";
import {
  card, btnPrimary, btnGhost, fieldCls, labelCls, Spinner, StateView, Money,
  VatBreakdown, StatusPill, ManualSendNotice, SectionTitle, Field, Empty,
} from "./QuotingAtoms";
import OwnerPricingPanel from "./OwnerPricingPanel";

export default function QuoteBuilder({ quoteId, onBack }: { quoteId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<SqState<QuoteDetail> | null>(null);
  const [lines, setLines] = useState<QuoteLine[]>([]);
  const [milestones, setMilestones] = useState<QuoteMilestone[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [activity, setActivity] = useState<QuoteActivity[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [newQty, setNewQty] = useState("1");
  const [newCatalog, setNewCatalog] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [exclusions, setExclusions] = useState("");

  const load = useCallback(async () => {
    const d = await fetchQuote(quoteId);
    setDetail(d);
    if (d.state === "ok") {
      setAssumptions(d.data.assumptions ?? "");
      setExclusions(d.data.exclusions ?? "");
      if (d.data.proposed_price !== null) setPriceInput(String(d.data.proposed_price));
      const [l, m, a] = await Promise.all([
        fetchQuoteLines(quoteId), fetchQuoteMilestones(quoteId), fetchQuoteActivity(quoteId, 20),
      ]);
      if (l.state === "ok") setLines(l.data);
      if (m.state === "ok") setMilestones(m.data);
      if (a.state === "ok") setActivity(a.data);
    }
  }, [quoteId]);

  useEffect(() => {
    void load();
    void fetchCatalog().then((c) => { if (c.state === "ok") setCatalog(c.data); });
  }, [load]);

  const act = useCallback(async (fn: () => Promise<SqState<unknown>>, okMsg: string) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    setMsg(r.state === "ok" ? okMsg : r.message);
    if (r.state === "ok") await load();
  }, [load]);

  if (!detail) return <Spinner />;

  return (
    <div className="space-y-4" dir="rtl">
      <button className={btnGhost} onClick={onBack}>◀ رجوع إلى القائمة</button>

      <StateView state={detail} onRetry={() => void load()}>
        {(q) => {
          const editable = q.status === "draft" || q.status === "internal_review";
          return (
            <div className="space-y-4">
              {/* ─── الرأس ─────────────────────────────────────────────── */}
              <div className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-stone-100 text-base font-medium">{q.title}</h2>
                    <p className="text-xs text-stone-500 mt-1">
                      {q.code} · نسخة {q.version_no} · {q.tier}
                    </p>
                  </div>
                  <StatusPill status={q.status} />
                </div>

                {q.status === "sent_placeholder" && (
                  <div className="mt-3"><ManualSendNotice /></div>
                )}

                {q.status === "pending_owner_approval" && (
                  <p className="mt-3 text-xs text-amber-300/90 leading-6 bg-amber-950/30 border border-amber-900/50 rounded-lg p-3">
                    بانتظار اعتماد المالك. كلّ عرض يمرّ بهذا المسار بلا استثناء
                    {q.approval_reason_public ? ` — السبب المسجَّل: ${q.approval_reason_public}` : ""}.
                  </p>
                )}
              </div>

              {/* ─── المال — سطح البيع وحده ─────────────────────────────── */}
              <div className={`${card} p-4`}>
                <SectionTitle note="أرقام البيع فقط. التكلفة والهامش والحدّ الأدنى ليست في هذه الشاشة ولا في أيّ نداء تصدره.">
                  المال
                </SectionTitle>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-400">مجموع البنود (سعر القائمة)</span>
                      <Money value={q.list_price} unknownText="لا بنود بعد" />
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-400">السعر المقترَح</span>
                      <Money value={q.proposed_price} unknownText="لم يُقترح بعد" />
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-stone-400">★ سعر البيع المعتمَد</span>
                      <Money value={q.authorized_price} unknownText="لم يعتمد المالك سعرًا بعد" emphasis />
                    </div>
                    <div className="flex justify-between gap-3 pt-2 border-t border-stone-800">
                      <span className="text-stone-400">المدى المسموح لي</span>
                      <span className="text-xs text-stone-300" dir="ltr">
                        {q.permitted_min !== null && q.permitted_max !== null
                          ? `${sar(q.permitted_min)} — ${sar(q.permitted_max)}`
                          : "غير محدَّد"}
                      </span>
                    </div>
                    <p className="text-[11px] text-stone-500 leading-5">
                      قاع المدى = السقف ناقص صلاحية خصمك ({Math.round(q.my_discount_allowance * 100)}٪).
                      سُلّم الخصم سياسة معلَنة ولا يُشتقّ من أيّ رقم داخليّ.
                    </p>
                  </div>

                  <div className="md:border-r md:border-stone-800 md:pr-4">
                    <VatBreakdown
                      net={q.gross_before_vat} vatRate={q.vat_rate}
                      vatAmount={q.vat_amount} total={q.total_after_vat}
                    />
                  </div>
                </div>

                {editable && (
                  <div className="mt-4 pt-3 border-t border-stone-800 flex gap-2 items-end flex-wrap">
                    <div className="flex-1 min-w-[160px]">
                      <Field
                        label="السعر المقترَح (ر.س)"
                        hint="تجاوز صلاحية خصمك يعني طلب اعتماد، لا رفضًا نهائيًّا."
                      >
                        <input
                          className={fieldCls} type="number" min="0" step="0.01"
                          value={priceInput} onChange={(e) => setPriceInput(e.target.value)}
                        />
                      </Field>
                    </div>
                    <button
                      className={btnGhost} disabled={busy || priceInput === ""}
                      onClick={() => void act(
                        () => setQuotePrice(quoteId, Number(priceInput)), "حُفظ السعر المقترَح.",
                      )}
                    >
                      حفظ السعر
                    </button>
                  </div>
                )}
              </div>

              {/* ─── البنود ────────────────────────────────────────────── */}
              <div className={`${card} p-4`}>
                <SectionTitle note="سعر بيع الوحدة يأتي من النسخة المنشورة من دفتر الأسعار، لا من لوحة المفاتيح.">
                  البنود
                </SectionTitle>

                {lines.length === 0 ? (
                  <Empty message="لا بنود بعد. أضِف خدمة من الكتالوج." />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-stone-500 border-b border-stone-800">
                          <th className="text-right py-2 font-normal">البند</th>
                          <th className="text-right py-2 font-normal">الكمّية</th>
                          <th className="text-right py-2 font-normal">سعر الوحدة</th>
                          <th className="text-right py-2 font-normal">الإجمالي</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.id} className="border-b border-stone-800/60">
                            <td className="py-2 text-stone-200">{l.label}</td>
                            <td className="py-2 text-stone-400">{l.qty} {l.uom ?? ""}</td>
                            <td className="py-2"><Money value={l.unit_sell_rate} /></td>
                            <td className="py-2"><Money value={l.line_total} /></td>
                            <td className="py-2 text-left">
                              {editable && (
                                <button
                                  className="text-xs text-red-400 hover:text-red-300 min-h-[44px] px-2"
                                  disabled={busy}
                                  onClick={() => void act(() => deleteQuoteLine(l.id), "حُذف البند.")}
                                >
                                  حذف
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {editable && (
                  <div className="mt-4 pt-3 border-t border-stone-800 flex gap-2 items-end flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <label className={labelCls}>الخدمة</label>
                      <select
                        className={fieldCls} value={newCatalog}
                        onChange={(e) => setNewCatalog(e.target.value)}
                      >
                        <option value="">— اختر —</option>
                        {catalog.map((c) => (
                          <option key={c.id} value={c.id}>{c.name_ar}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-24">
                      <label className={labelCls}>الكمّية</label>
                      <input
                        className={fieldCls} type="number" min="0" step="0.001"
                        value={newQty} onChange={(e) => setNewQty(e.target.value)}
                      />
                    </div>
                    <button
                      className={btnGhost} disabled={busy || !newCatalog}
                      onClick={() => void act(
                        () => setQuoteLine({ quoteId, catalogId: newCatalog, qty: Number(newQty) }),
                        "أُضيف البند.",
                      )}
                    >
                      إضافة
                    </button>
                  </div>
                )}
              </div>

              {/* ─── الدفعات ───────────────────────────────────────────── */}
              <div className={`${card} p-4`}>
                <SectionTitle note="الضريبة محسوبة لكلّ دفعة على حدة كحقل مستقلّ.">
                  دفعات السداد
                </SectionTitle>
                {milestones.length === 0 ? (
                  <div className="space-y-3">
                    <Empty message="لا دفعات بعد." />
                    {editable && q.gross_before_vat !== null && (
                      <button
                        className={btnGhost} disabled={busy}
                        onClick={() => void act(() => setQuoteMilestones(quoteId, [
                          { label: "دفعة أولى عند التوقيع", pct: 0.5, due_rule: "on_signature" },
                          { label: "دفعة ثانية عند التسليم", pct: 0.5, due_rule: "on_delivery" },
                        ]), "أُنشئت دفعتان ٥٠٪ / ٥٠٪.")}
                      >
                        أنشئ دفعتين ٥٠٪ / ٥٠٪
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    {milestones.map((m) => (
                      <div key={m.id} className="flex justify-between gap-3 py-2 border-b border-stone-800/60">
                        <span className="text-stone-300">{m.seq}. {m.label}</span>
                        <span className="text-xs text-stone-400" dir="ltr">
                          {sar(m.amount_net)} + {sar(m.vat_amount)} = {sar(m.amount_gross)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ─── الشروط ────────────────────────────────────────────── */}
              <div className={`${card} p-4`}>
                <SectionTitle>الافتراضات والاستثناءات</SectionTitle>
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="الافتراضات">
                    <textarea
                      className={`${fieldCls} min-h-[90px]`} value={assumptions}
                      disabled={!editable} onChange={(e) => setAssumptions(e.target.value)}
                    />
                  </Field>
                  <Field label="الاستثناءات">
                    <textarea
                      className={`${fieldCls} min-h-[90px]`} value={exclusions}
                      disabled={!editable} onChange={(e) => setExclusions(e.target.value)}
                    />
                  </Field>
                </div>
                <p className="text-[11px] text-stone-500 mt-2">
                  صلاحية العرض: {q.validity_days} يومًا{q.valid_until ? ` · حتى ${q.valid_until}` : ""}
                </p>
                {editable && (
                  <button
                    className={`${btnGhost} mt-3`} disabled={busy}
                    onClick={() => void act(
                      () => setQuoteTerms({ quoteId, assumptions, exclusions }), "حُفظت الشروط.",
                    )}
                  >
                    حفظ الشروط
                  </button>
                )}
              </div>

              {/* ─── الإجراءات ─────────────────────────────────────────── */}
              <div className={`${card} p-4 space-y-3`}>
                <SectionTitle>الإجراءات</SectionTitle>
                <div className="flex gap-2 flex-wrap">
                  {editable && (
                    <button
                      className={btnPrimary} disabled={busy || q.proposed_price === null}
                      onClick={() => void act(() => submitQuote(quoteId), "رُفع العرض لاعتماد المالك.")}
                    >
                      ارفع لاعتماد المالك
                    </button>
                  )}
                  {q.status === "approved" && (
                    <button
                      className={btnPrimary} disabled={busy}
                      onClick={() => void act(
                        () => markReadyForManualSend(quoteId),
                        "الحالة الآن «معتمد وجاهز للإرسال اليدوي». لم يُرسل النظام شيئًا.",
                      )}
                    >
                      علّمه جاهزًا للإرسال اليدوي
                    </button>
                  )}
                  {(q.status === "approved" || q.status === "sent_placeholder") && (
                    <>
                      <button
                        className={btnGhost} disabled={busy}
                        onClick={() => void act(
                          () => recordClientDecision(quoteId, "accepted"), "سُجّل قبول العميل.",
                        )}
                      >
                        سجّل قبول العميل
                      </button>
                      <button
                        className={btnGhost} disabled={busy}
                        onClick={() => void act(
                          () => recordClientDecision(quoteId, "rejected"), "سُجّل رفض العميل.",
                        )}
                      >
                        سجّل رفض العميل
                      </button>
                    </>
                  )}
                  {q.status !== "superseded" && (
                    <button
                      className={btnGhost} disabled={busy}
                      onClick={() => void act(() => newQuoteVersion(quoteId), "أُنشئت نسخة جديدة.")}
                    >
                      أنشئ نسخة جديدة
                    </button>
                  )}
                </div>
                {msg && <p className="text-xs text-stone-300 leading-6">{msg}</p>}
              </div>

              {/* ─── لوحة المالك — نداءات منفصلة ───────────────────────── */}
              {q.internal_visible && (
                <OwnerPricingPanel
                  quoteId={quoteId}
                  rangePublished={q.range_published}
                  onChanged={() => void load()}
                />
              )}

              {/* ─── النشاط ────────────────────────────────────────────── */}
              {activity.length > 0 && (
                <div className={`${card} p-4`}>
                  <SectionTitle note="أحداث سطح البيع فقط — بلا حمولة وبلا أحداث التسعير الداخليّ.">
                    النشاط
                  </SectionTitle>
                  <ul className="text-xs text-stone-400 space-y-1.5">
                    {activity.map((a, i) => (
                      <li key={i} className="flex justify-between gap-3 border-b border-stone-800/50 py-1.5">
                        <span>{a.action}</span>
                        <span className="text-stone-600" dir="ltr">{new Date(a.at).toLocaleString("ar-SA")}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        }}
      </StateView>
    </div>
  );
}
