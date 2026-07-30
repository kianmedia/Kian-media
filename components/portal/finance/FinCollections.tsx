"use client";
// ════════════════════════════════════════════════════════════════════════════
// FinCollections — سطح التحصيل. **ليس نسخة مقصوصة من المركز المالي.**
//
// هذه الشاشة تقرأ finops_collections_list وحدها. لا تستدعي finops_receivables
// ولا finops_dashboard ولا finops_costs_list، ولا تملك مسارًا إليها أصلًا:
// حاملُ مفاتيح التحصيل لا يقرأ صفًّا واحدًا من أيّ جدول fin_* في القاعدة، فحتى
// استدعاء PostgREST مباشرةً من المتصفّح يعيد صفرًا.
//
// ★ لماذا سطح مستقلّ ولم يُكتفَ بإخفاء أعمدة ★
//   إخفاء عمود في الواجهة ليس تفويضًا. القسمة الحقيقية في القاعدة: طرف الإيراد
//   (المستحقّ) يصل هذا الدور، وطرف التكلفة لا يصله بأيّ طريق — فلا يجتمع لديه
//   طرفا الطرح الذي يقارب الهامش. ما يظهر هنا هو حرفيًّا ما تعيده الدالّة.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  AGING_AR, COLLECTION_COLOR, COLLECTION_STATUS_AR,
  FIN_COLLECTIONS_SCOPE_AR, finAmount, finCollectionRecord, finCollectionsList,
  finDate, finExport, finExportCsv, finIsoDay,
  type FinCollections as FinCollectionsData, type FinRow, type FinState,
} from "@/lib/portal/financeOps";
import {
  btnGhost, btnPrimary, card, Chip, Empty, fieldCls, Flash, Scroller, Section,
  StateView, Stat, useFinLoad,
} from "./FinAtoms";
import { FORM_SPECS, FinForm } from "./FinForms";

const STATUS_FILTERS = [
  { key: "", ar: "الكلّ" },
  { key: "overdue", ar: "متأخّرة" },
  { key: "due", ar: "مستحقّة" },
  { key: "partially_collected", ar: "محصَّلة جزئيًّا" },
  { key: "not_due", ar: "غير مستحقّة" },
];

export default function FinCollectionsCenter({
  canRecord, canExport,
}: { canRecord: boolean; canExport: boolean }) {
  const [tick, setTick] = useState(0);
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");
  const [status, setStatus] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [target, setTarget] = useState<FinRow | null>(null);
  const [flash, setFlash] = useState<{ msg: string; tone: "ok" | "bad" } | null>(null);

  const filters = {
    q: applied || undefined,
    collection_status: status || undefined,
    only_overdue: onlyOverdue ? "true" : undefined,
  };
  const { st, reload } = useFinLoad<FinCollectionsData>(
    () => finCollectionsList(filters),
    [tick, applied, status, onlyOverdue],
  );

  const onExport = async () => {
    // ★ تصدير قائمة التحصيل وحده ★ — مجموعة مستقلّة بمفتاح مستقلّ على الخادم.
    // لا تُستدعى هنا أيّ مجموعة أخرى، ولو استُدعيت لردّ الخادم 42501.
    const r = await finExport("collections_queue", filters);
    if (r.state !== "ok") {
      setFlash({ msg: r.message, tone: "bad" });
      return;
    }
    const blob = new Blob(["﻿" + finExportCsv(r.data)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `collections_${finIsoDay()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <p className="text-[11px] text-stone-500 leading-6">{FIN_COLLECTIONS_SCOPE_AR}</p>
      <Flash msg={flash?.msg ?? null} tone={flash?.tone ?? "ok"} />

      <StateView st={st} onRetry={reload}>
        {(d) => (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="مستحقّ (إجمالي)" value={finAmount(d.totals.due_gross)} />
              <Stat label="محصَّل" value={finAmount(d.totals.collected_gross)} tone="good" />
              <Stat label="متبقٍّ" value={finAmount(d.totals.outstanding_gross)} tone="warn" />
              <Stat
                label="متأخّر"
                value={finAmount(d.totals.overdue_gross)}
                hint={`${d.totals.overdue_count} فاتورة`}
                tone={d.totals.overdue_gross > 0 ? "bad" : "normal"}
              />
            </div>

            <Section title="أعمار الديون" note="المتبقّي موزّعًا على شرائح التأخّر — مشتقّ من الدفعات المسجّلة.">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {Object.entries(d.totals.aging ?? {}).map(([k, v]) => (
                  <Stat key={k} label={AGING_AR[k] ?? k} value={finAmount(Number(v ?? 0))} />
                ))}
              </div>
            </Section>

            <div className="flex flex-wrap gap-2 items-center">
              <input
                className={fieldCls}
                style={{ maxWidth: 220 }}
                placeholder="بحث: العميل أو رقم الفاتورة"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") setApplied(q.trim()); }}
              />
              <button className={btnGhost} onClick={() => setApplied(q.trim())}>بحث</button>
              <Scroller>
                <div className="flex gap-1.5">
                  {STATUS_FILTERS.map((f) => (
                    <button
                      key={f.key || "all"}
                      onClick={() => setStatus(f.key)}
                      className={`whitespace-nowrap min-h-[40px] px-3 rounded-lg text-xs border ${
                        status === f.key
                          ? "bg-red-800 border-red-700 text-white"
                          : "bg-stone-900 border-stone-800 text-stone-300"
                      }`}
                    >
                      {f.ar}
                    </button>
                  ))}
                </div>
              </Scroller>
              <label className="text-xs text-stone-300 flex items-center gap-1.5">
                <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} />
                المتأخّر فقط
              </label>
              {canExport && (
                <button className={btnGhost} onClick={() => void onExport()}>تصدير CSV</button>
              )}
            </div>

            {d.rows.length === 0 ? (
              <Empty message="لا توجد فواتير مفتوحة تطابق البحث." />
            ) : (
              <div className="space-y-2">
                {d.rows.map((r) => (
                  <CollectionRow
                    key={String(r.id)}
                    row={r}
                    canRecord={canRecord}
                    onRecord={() => setTarget(r)}
                  />
                ))}
              </div>
            )}

            <p className="text-[11px] text-stone-600 leading-6">{d.note}</p>
          </div>
        )}
      </StateView>

      {target && (
        <FinForm
          spec={FORM_SPECS.collection}
          initial={{ receivable_id: target.id, collected_on: finIsoDay() }}
          lookups={null}
          onClose={() => setTarget(null)}
          onSubmit={async (payload): Promise<FinState<unknown>> => {
            const r = await finCollectionRecord({ ...payload, receivable_id: target.id });
            if (r.state === "ok") {
              setFlash({ msg: "سُجّلت الدفعة.", tone: "ok" });
              setTarget(null);
              setTick((t) => t + 1);
            }
            return r;
          }}
        />
      )}
    </div>
  );
}

function CollectionRow({
  row, canRecord, onRecord,
}: { row: FinRow; canRecord: boolean; onRecord: () => void }) {
  const status = String(row.collection_status ?? "");
  const days = Number(row.days_overdue ?? 0);
  const currency = String(row.currency ?? "SAR");
  const [open, setOpen] = useState(false);
  const notes = Array.isArray(row.collection_notes) ? (row.collection_notes as FinRow[]) : [];

  return (
    <div className={`${card} p-3 space-y-2`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm text-stone-100 truncate">{String(row.client_label ?? "—")}</div>
          <div className="text-[11px] text-stone-500">
            {String(row.invoice_ref ?? row.doc_no ?? "—")} · {String(row.title ?? "")}
          </div>
        </div>
        <Chip text={COLLECTION_STATUS_AR[status] ?? status} tone={COLLECTION_COLOR[status] ?? "neutral"} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
        <Field label="المستحقّ" value={finAmount(Number(row.amount_due_gross ?? 0), currency)}
               hint={`ضريبة ${finAmount(Number(row.vat_amount ?? 0), currency)}`} />
        <Field label="المحصَّل" value={finAmount(Number(row.collected ?? 0), currency)} />
        <Field label="المتبقّي" value={finAmount(Number(row.outstanding ?? 0), currency)} />
        <Field
          label="الاستحقاق"
          value={finDate(row.due_date as string | null)}
          hint={days > 0 ? `متأخّر ${days} يومًا` : undefined}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {canRecord && (
          <button className={btnPrimary} onClick={onRecord}>تسجيل تحصيل</button>
        )}
        {notes.length > 0 && (
          <button className={btnGhost} onClick={() => setOpen((o) => !o)}>
            {open ? "إخفاء الدفعات" : `الدفعات وملاحظاتها (${notes.length})`}
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-1.5 border-t border-stone-800 pt-2">
          {notes.map((n) => (
            <div key={String(n.id)} className="text-[11px] text-stone-400 leading-6">
              {finDate(n.collected_on as string | null)} ·{" "}
              {finAmount(Number(n.amount_gross ?? 0), String(n.currency ?? currency))} ·{" "}
              {String(n.method ?? "")}
              {n.reference ? ` · مرجع ${String(n.reference)}` : ""}
              {n.note ? ` — ${String(n.note)}` : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="leading-6">
      <div className="text-stone-500">{label}</div>
      <div className="text-stone-100 text-sm">{value}</div>
      {hint && <div className="text-stone-600">{hint}</div>}
    </div>
  );
}
