"use client";
// ════════════════════════════════════════════════════════════════════════════
// OwnerPricingPanel — ★ سطح المالك وحده ★
//
// هذا المكوّن يُركَّب فقط حين يقول الخادم `internal_visible: true`، لكنّ ذلك
// **ليس** هو الحماية: الحماية أنّ كلّ نداء هنا يذهب إلى دالّة تشترط
// sq_can_view_cost() وتردّ 42501 لغير المالك. لو رُكّب المكوّن خطأً لموظّف
// مبيعات فسيرى «لا تملك صلاحية» — لا أرقامًا ولا أصفارًا.
//
// إخفاء زرّ ليس تفويضًا. هذا المبدأ مكتوب في معمارية المشروع، وهذا الملفّ
// أحد أوضح تطبيقاته: لا يوجد فيه سطر يقرّر «هل يحقّ له؟».
//
// ★ ما يُعرض هنا ولا يُعرض في أيّ مكان آخر ★
//   التكلفة · الحدّ الأدنى · الهامش · الربح · المعادلة · أجور المورّدين ·
//   عدّاد محاولات التسعير تحت الحدّ الأدنى.
// ════════════════════════════════════════════════════════════════════════════
import { useCallback, useEffect, useState } from "react";
import {
  fetchQuoteInternal, recomputeQuote, setSupplierCost, publishRange, unpublishRange,
  type QuoteInternalDetail, type SqState,
} from "@/lib/portal/quoting";
import {
  card, btnPrimary, btnGhost, fieldCls, Spinner, StateView, Money, Pct,
  SectionTitle, Field,
} from "./QuotingAtoms";

export default function OwnerPricingPanel({
  quoteId, rangePublished, onChanged,
}: { quoteId: string; rangePublished: boolean; onChanged?: () => void }) {
  const [state, setState] = useState<SqState<QuoteInternalDetail> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [supplier, setSupplier] = useState("");

  const load = useCallback(async () => {
    setState(await fetchQuoteInternal(quoteId));
  }, [quoteId]);

  useEffect(() => { void load(); }, [load]);

  const act = useCallback(async (fn: () => Promise<SqState<unknown>>, okMsg: string) => {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    setMsg(r.state === "ok" ? okMsg : r.message);
    if (r.state === "ok") { await load(); onChanged?.(); }
  }, [load, onChanged]);

  if (!state) return <Spinner />;

  return (
    <div className={`${card} p-4 border-amber-900/50`} dir="rtl">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-sm font-medium text-amber-200">لوحة المالك — التكلفة والربحية</h3>
        <span className="text-[11px] text-amber-300/70">
          مقصورة على المالك بنيويًّا · لا مفتاح صلاحية لها
        </span>
      </div>

      <StateView state={state} onRetry={() => void load()}>
        {(d) => (
          <div className="space-y-4">
            {!d.costed ? (
              <div className="space-y-3">
                <p className="text-sm text-stone-400 leading-7">{d.note_ar}</p>
                <button
                  className={btnPrimary}
                  disabled={busy}
                  onClick={() => void act(() => recomputeQuote(quoteId), "أُعيد الحساب.")}
                >
                  احسب التكلفة والربحية
                </button>
              </div>
            ) : (
              <>
                {/* ★ اكتمال التكلفة قبل أيّ رقم ربحية ★ بندٌ بلا سعر تكلفة
                    يُقرأ هامشًا عاليًا — وهي كذبة يتصرّف المالك بناءً عليها. */}
                {d.cost_breakdown && d.cost_breakdown.cost_complete === false && (
                  <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900/60 rounded-lg p-3 leading-6">
                    ⚠️ {String(d.cost_breakdown.uncosted_lines ?? "بعض")} بندًا بلا سعر تكلفة في النسخة
                    المثبَّتة. الأرقام أدناه **تقدّر التكلفة أقلّ من حقيقتها**، فيبدو الهامش أعلى
                    ممّا هو. أكمِل أسعار التكلفة قبل الاعتماد.
                  </p>
                )}

                {d.below_floor && (
                  <p className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg p-3 leading-6">
                    ★ السعر الحاليّ تحت الحدّ الأدنى المقبول (<Money value={d.min_price} />).
                  </p>
                )}

                {d.floor_probe_count > 0 && (
                  <p className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900/60 rounded-lg p-3 leading-6">
                    🔎 سُجّلت {d.floor_probe_count} محاولة تسعير تحت الحدّ الأدنى من حساب لا يرى
                    الحدّ الأدنى. الحدّ لم يُكشف — لكنّ تكرار المحاولات قد يعني محاولة استكشافه
                    عبر قراراتك أنت. يستحقّ نظرة.
                  </p>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <Row label="التكلفة الأساسية" v={<Money value={d.base_cost} />} />
                  <Row label="رسوم الظروف" v={<Money value={d.surcharge_cost} />} />
                  <Row label="تكلفة مورّد خارجيّ" v={<Money value={d.external_supplier_cost} />} />
                  <Row label={`الطوارئ (${d.contingency_pct !== null ? Math.round(d.contingency_pct * 100) : "—"}٪)`} v={<Money value={d.contingency_amount} />} />
                  <Row label="التقدير الداخليّ للتكلفة" v={<Money value={d.internal_cost_estimate} emphasis />} />
                  <Row label="الهامش المستهدف" v={<Pct value={d.target_margin_pct} />} />
                  <Row label="السعر المقترَح" v={<Money value={d.recommended_price} />} />
                  <Row label="★ الحدّ الأدنى المعتمَد" v={<Money value={d.min_price} emphasis />} />
                  <Row label="الربح الإجماليّ" v={<Money value={d.gross_profit} />} />
                  <Row label="نسبة الهامش" v={<Pct value={d.margin_pct} />} />
                  <Row label="صافي الربح التقديريّ" v={<Money value={d.est_net_profit} />} />
                  <Row label="تحميل المصاريف العامّة" v={<Pct value={d.overhead_alloc_pct} />} />
                </div>

                <details className="text-xs text-stone-400">
                  <summary className="cursor-pointer text-stone-300 py-2">المعادلة المستعملة</summary>
                  <pre className="mt-2 p-3 bg-stone-950 border border-stone-800 rounded-lg overflow-x-auto text-[11px] leading-6" dir="ltr">
{JSON.stringify(d.formula_snapshot, null, 2)}
                  </pre>
                </details>

                <div className="flex gap-2 flex-wrap pt-2 border-t border-stone-800">
                  <button
                    className={btnGhost}
                    disabled={busy}
                    onClick={() => void act(() => recomputeQuote(quoteId), "أُعيد الحساب.")}
                  >
                    إعادة الحساب
                  </button>
                  {!rangePublished ? (
                    <button
                      className={btnGhost}
                      disabled={busy}
                      onClick={() => void act(() => publishRange(quoteId), "نُشر المدى الإرشاديّ.")}
                    >
                      انشر المدى الإرشاديّ
                    </button>
                  ) : (
                    <button
                      className={btnGhost}
                      disabled={busy}
                      onClick={() => void act(() => unpublishRange(quoteId), "أُلغي نشر المدى.")}
                    >
                      ألغِ نشر المدى
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-stone-500 leading-6">
                  المدى الإرشاديّ يُحسب من سعر البيع وحده ويُدوَّر إلى مضاعفات خشنة، ولا يُشتقّ من
                  الحدّ الأدنى ولا يدلّ عليه. والخادم يرفض مدًى أضيق من خطوة التدوير لأنّ مدًى
                  بهذا الضيق سعرٌ نهائيّ متنكّر.
                </p>
              </>
            )}

            <div className="pt-3 border-t border-stone-800">
              <SectionTitle note="يُدخله المالك وحده. لو أدخله بانِ العرض لعرف أحد طرفَي المعادلة، ولاستخرج نسبة الربح من السعر المقترَح ثمّ عكسها على كلّ عرض آخر.">
                تكلفة المورّد الخارجيّ
              </SectionTitle>
              <div className="flex gap-2 items-end flex-wrap">
                <div className="flex-1 min-w-[160px]">
                  <Field label="المبلغ (ر.س)">
                    <input
                      className={fieldCls} type="number" min="0" step="0.01"
                      value={supplier} onChange={(e) => setSupplier(e.target.value)}
                      placeholder="0.00"
                    />
                  </Field>
                </div>
                <button
                  className={btnGhost}
                  disabled={busy || supplier === ""}
                  onClick={() => void act(
                    () => setSupplierCost(quoteId, Number(supplier)),
                    "سُجّلت تكلفة المورّد. أعِد الحساب لتحديث الربحية.",
                  )}
                >
                  حفظ
                </button>
              </div>
            </div>

            {msg && <p className="text-xs text-stone-300 leading-6 pt-2">{msg}</p>}
          </div>
        )}
      </StateView>
    </div>
  );
}

function Row({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2 py-1.5 border-b border-stone-800/60">
      <span className="text-stone-400 text-xs">{label}</span>
      <span className="text-sm">{v}</span>
    </div>
  );
}
