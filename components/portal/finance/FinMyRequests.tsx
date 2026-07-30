"use client";
// ════════════════════════════════════════════════════════════════════════════
// FinMyRequests — ما يراه الموظّف العاديّ من المالية، وهو **كلّ** ما يراه.
//
// طلباته هو: يرفعها، يتابع حالتها، يرفق إيصالها، ويحذف ما لم يُبتّ فيه بعد.
// لا ميزانية · لا تكاليف غيره · لا هوامش · لا ربحية · لا ذمم · لا حدود اعتماد.
// هذا القيد مفروض في القاعدة (finops_my_requests تقيّد بـrequested_by = auth.uid()
// ومراجع الطلب لا تحمل مبالغ)، والشاشة هنا تعكسه ولا تصنعه.
// ════════════════════════════════════════════════════════════════════════════
import { useState } from "react";
import {
  EXPENSE_STATUS_AR, PURCHASE_STATUS_AR, finAttachmentAdd, finDate, finExpenseRequestSubmit,
  finMyRequests, finPurchaseRequestSubmit, finRequestLookups, finRowDelete,
  type FinLookups, type FinMyRequests as MyRequests, type FinRequestLookups, type FinRow,
} from "@/lib/portal/financeOps";
import {
  btnGhost, btnPrimary, card, Chip, Empty, MoneyCell, Scroller, Section, StateView, useFinLoad,
} from "./FinAtoms";
import { FORM_SPECS, FinForm, ReasonDialog } from "./FinForms";

type Dlg =
  | { kind: "expense" }
  | { kind: "purchase" }
  | { kind: "attach"; entity: "expense_request" | "purchase_request"; id: string }
  | { kind: "delete"; entity: "expense_request" | "purchase_request"; id: string }
  | null;

/**
 * مراجع مُقدِّم الطلب تُقدَّم للنموذج في شكل FinLookups، لكنّ المصفوفات المالية
 * فيها **فارغة عمدًا**: الخادم لا يعطي الموظّف ميزانيات ولا مورّدين، والشاشة
 * لا تخترع ما لم يُعطَه.
 */
function asLookups(r: FinRequestLookups | null): FinLookups | null {
  if (!r) return null;
  return {
    ok: true,
    cost_centers: r.cost_centers.map((c) => ({ ...c, kind: "other" })),
    categories: r.categories.map((c) => ({ ...c, cost_nature: "other", default_vat_rate: 15 })),
    suppliers: [],
    budgets: [],
    thresholds: [],
  };
}

export default function FinMyRequests() {
  const [dlg, setDlg] = useState<Dlg>(null);
  const [tick, setTick] = useState(0);
  const mine = useFinLoad<MyRequests>(() => finMyRequests({}), [tick]);
  const look = useFinLoad<FinRequestLookups>(() => finRequestLookups(), []);
  const lookups = look.st?.state === "ok" ? asLookups(look.st.data) : null;
  const refresh = () => setTick((t) => t + 1);

  return (
    <div className="space-y-6">
      <Section
        title="طلباتي المالية"
        note="هذه الشاشة تعرض طلباتك أنت فقط. بيانات الشركة المالية — الميزانيات والتكاليف والهوامش — مقصورة على المالك وفريق المالية، وهذا منع في قاعدة البيانات لا إخفاء في الواجهة."
        actions={
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={() => setDlg({ kind: "expense" })}>طلب صرف</button>
            <button className={btnGhost} onClick={() => setDlg({ kind: "purchase" })}>طلب شراء</button>
          </div>
        }
      >
        <StateView st={mine.st} onRetry={mine.reload}>
          {(d) => (
            <div className="space-y-5">
              <RequestTable
                title="طلبات الصرف"
                rows={d.expense_requests}
                statusAr={EXPENSE_STATUS_AR}
                dateKey="spent_on"
                dateLabel="تاريخ الصرف"
                onAttach={(id) => setDlg({ kind: "attach", entity: "expense_request", id })}
                onDelete={(id) => setDlg({ kind: "delete", entity: "expense_request", id })}
              />
              <RequestTable
                title="طلبات الشراء"
                rows={d.purchase_requests}
                statusAr={PURCHASE_STATUS_AR}
                dateKey="needed_by"
                dateLabel="مطلوب بحلول"
                onAttach={(id) => setDlg({ kind: "attach", entity: "purchase_request", id })}
                onDelete={(id) => setDlg({ kind: "delete", entity: "purchase_request", id })}
              />
              <p className="text-[10px] text-stone-600 leading-6">
                نطاق البيانات المُعاد من الخادم: <span dir="ltr">{d.scope}</span> — صفوفك وحدها.
              </p>
            </div>
          )}
        </StateView>
      </Section>

      {dlg?.kind === "expense" && (
        <FinForm
          spec={FORM_SPECS.expense_request}
          lookups={lookups}
          onClose={() => { setDlg(null); refresh(); }}
          onSubmit={(p) => finExpenseRequestSubmit({ ...p, status: "submitted" })}
        />
      )}
      {dlg?.kind === "purchase" && (
        <FinForm
          spec={FORM_SPECS.purchase_request}
          lookups={lookups}
          onClose={() => { setDlg(null); refresh(); }}
          onSubmit={(p) => finPurchaseRequestSubmit({ ...p, status: "submitted" })}
        />
      )}
      {dlg?.kind === "attach" && (
        <FinForm
          spec={FORM_SPECS.attachment}
          lookups={lookups}
          onClose={() => { setDlg(null); refresh(); }}
          onSubmit={(p) => finAttachmentAdd({ ...p, entity_type: dlg.entity, entity_id: dlg.id })}
        />
      )}
      {dlg?.kind === "delete" && (
        <ReasonDialog
          title="حذف الطلب"
          label="سبب الحذف"
          onClose={() => { setDlg(null); refresh(); }}
          onConfirm={(reason) => finRowDelete(dlg.entity, dlg.id, reason)}
        />
      )}
    </div>
  );
}

function RequestTable({
  title, rows, statusAr, dateKey, dateLabel, onAttach, onDelete,
}: {
  title: string;
  rows: FinRow[];
  statusAr: Record<string, string>;
  dateKey: string;
  dateLabel: string;
  onAttach: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  if (!rows?.length) return (
    <div className="space-y-2">
      <h3 className="text-stone-300 text-xs">{title}</h3>
      <Empty message="لا طلبات بعد." />
    </div>
  );
  return (
    <div className="space-y-2">
      <h3 className="text-stone-300 text-xs">{title}</h3>
      <Scroller>
        <table className="w-full text-xs" dir="rtl">
          <thead className="text-stone-500">
            <tr className="text-right">
              <th className="p-2 font-normal">الرقم</th>
              <th className="p-2 font-normal">الوصف</th>
              <th className="p-2 font-normal">{dateLabel}</th>
              <th className="p-2 font-normal">المبلغ</th>
              <th className="p-2 font-normal">الحالة</th>
              <th className="p-2 font-normal">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const st = String(r.status ?? "");
              const editable = st === "draft" || st === "submitted";
              return (
                <tr key={String(r.id)} className={`${card} align-top`}>
                  <td className="p-2 text-stone-400" dir="ltr">{String(r.request_no ?? "—")}</td>
                  <td className="p-2 text-stone-200">
                    {String(r.title ?? "—")}
                    {r.decision_note ? (
                      <div className="text-[10px] text-stone-500 mt-1 leading-5">ملاحظة القرار: {String(r.decision_note)}</div>
                    ) : null}
                  </td>
                  <td className="p-2 text-stone-400">{finDate(r[dateKey] as string)}</td>
                  <td className="p-2"><MoneyCell row={r} /></td>
                  <td className="p-2">
                    <Chip
                      text={statusAr[st] ?? st}
                      tone={st === "approved" || st === "paid" ? "good" : st === "rejected" ? "bad" : "neutral"}
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1 flex-wrap">
                      <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                        onClick={() => onAttach(String(r.id))}>إرفاق</button>
                      {editable && (
                        <button className={`${btnGhost} !min-h-[32px] !px-2 !py-1 text-[11px]`}
                          onClick={() => onDelete(String(r.id))}>حذف</button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Scroller>
    </div>
  );
}
